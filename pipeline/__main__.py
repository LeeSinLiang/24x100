"""CLI.

  uv run python -m pipeline block --id 10K        fetch today's raw cache if missing, then process
  uv run python -m pipeline block --id 10K --offline   process the latest raw cache only
  uv run python -m pipeline money [--offline]
  uv run python -m pipeline crosscheck --id 10K [--fixture PATH]
  uv run python -m pipeline all [--offline]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import block as B
from . import crosscheck as X
from . import money as M
from . import sources as S
from .fetch import FetchError, OfflineMiss, RawCache, latest_raw_date


def _block_required(bid: str) -> list[str]:
    return [f"{bid}/osm", f"{bid}/parcels", *[f"{bid}/{k}" for k in S.LAYERS], "city_owned",
            *[f"hist_zoning_{y}" for y in S.HIST_ZONING]]


def _cache(offline: bool, required: list[str], date: str | None) -> RawCache:
    if offline:
        return RawCache(date or latest_raw_date(required), offline=True)
    return RawCache(date)


def cmd_block(args) -> int:
    cfg = B.BLOCKS.get(args.id)
    if cfg is None:
        print(f"unknown block {args.id!r}; known: {', '.join(B.BLOCKS)}", file=sys.stderr)
        return 2
    cache = _cache(args.offline, _block_required(cfg.id), args.date)
    if not args.offline:
        B.fetch_block(cache, cfg)
    block = B.process_block(cache, cfg)
    path = B.write_block(block)
    n = len(block["parcels"])
    states = {}
    for p in block["parcels"]:
        states[p["recon"]["state"]] = states.get(p["recon"]["state"], 0) + 1
    print(f"wrote {path.relative_to(B.REPO)}: {n} parcels, {len(block['buildings'])} buildings, "
          f"{len(block['streets'])} street pieces, rotation {block['meta']['rotation_deg']} deg, "
          f"raw {cache.date}; recon {states}")
    if not args.no_crosscheck and cfg.id == "10K":
        fx = Path(args.fixture) if args.fixture else X.DEFAULT_FIXTURE
        if fx.exists():
            _write_crosscheck(block, fx)
        else:
            print(f"crosscheck skipped: fixture not found at {fx}")
    return 0


def _write_crosscheck(block: dict, fixture: Path) -> None:
    res = X.crosscheck(block, fixture)
    out = B.OUT_DIR / f"{block['meta']['id']}.crosscheck.json"
    out.write_text(B.dumps(res))
    r = res["result"]
    print(f"wrote {out.relative_to(B.REPO)}: G1 pass={r['pass']} (own-frame), "
          f"pass after removing rotation difference={r['pass_after_removing_rotation_difference']}; "
          f"failing {len(r['main_street_row_failing'])}/{r['main_street_row_lots']} main-row lots; "
          f"worst {r['worst_rel_diff_main_row']}")


def cmd_crosscheck(args) -> int:
    p = B.OUT_DIR / f"{args.id}.json"
    block = json.loads(p.read_text())
    _write_crosscheck(block, Path(args.fixture) if args.fixture else X.DEFAULT_FIXTURE)
    return 0


def cmd_money(args) -> int:
    required = [f"sales_{M.MUNICODE}/page_000"]
    cache = _cache(args.offline, required, args.date)
    if not args.offline:
        try:
            M.fetch_money(cache)
        except FetchError as e:
            # comps can still be written if the sales side is complete; HUD is reported and skipped
            print(f"fetch error: {e}", file=sys.stderr)
    snap = M.build_snapshot(cache)
    comps = M.comps_file(snap)
    p = M.write(comps, "comps_ward5.json")
    c = comps["counts"]
    print(f"wrote {p.relative_to(M.REPO)}: {c['valid_1_2_unit']} valid 1-2 unit sales since {M.SINCE}; "
          f"median {comps['median']:,}, IQR {comps['q1']:,}-{comps['q3']:,}; newest {comps['newest']['addr']} "
          f"({comps['newest']['yearbuilt']}, {comps['newest']['price']:,})")
    if args.snapshot:
        sp = Path(args.snapshot)
        sp.parent.mkdir(parents=True, exist_ok=True)
        sp.write_text(M.dumps(snap))
        print(f"wrote snapshot {sp}")
    if cache.has("hud_il_fy2026"):
        hud = M.hud_file(cache)
        hp = M.write(hud, "hud_fy2026.json")
        print(f"wrote {hp.relative_to(M.REPO)}: {hud['hud_area_name']} median {hud['median_family_income']:,}; "
              f"80% 1..8: {[hud[f'l80_{n}'] for n in range(1, 9)]}")
        return 0
    print("HUD income limits NOT written: the raw cache has no HUD file (see fetch error above)", file=sys.stderr)
    return 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m pipeline")
    sub = ap.add_subparsers(dest="cmd", required=True)
    b = sub.add_parser("block", help="fetch + process one block")
    b.add_argument("--id", required=True)
    b.add_argument("--offline", action="store_true", help="process the latest raw cache only; no network")
    b.add_argument("--date", help="use data/raw/<date> instead of today / latest")
    b.add_argument("--fixture", help="research fixture for the G1 cross-check")
    b.add_argument("--no-crosscheck", action="store_true")
    b.set_defaults(fn=cmd_block)
    m = sub.add_parser("money", help="fetch + process comps and HUD income limits")
    m.add_argument("--offline", action="store_true")
    m.add_argument("--date")
    m.add_argument("--snapshot", help="also write the filtered joined sales snapshot to this path")
    m.set_defaults(fn=cmd_money)
    x = sub.add_parser("crosscheck", help="G1 cross-check of data/blocks/<id>.json vs the research fixture")
    x.add_argument("--id", required=True)
    x.add_argument("--fixture")
    x.set_defaults(fn=cmd_crosscheck)
    a = sub.add_parser("all", help="block 10K + money")
    a.add_argument("--offline", action="store_true")
    a.add_argument("--date")
    a.set_defaults(fn=None)
    args = ap.parse_args(argv)
    try:
        if args.cmd == "all":
            rc = cmd_block(argparse.Namespace(id="10K", offline=args.offline, date=args.date, fixture=None,
                                              no_crosscheck=False))
            rc2 = cmd_money(argparse.Namespace(offline=args.offline, date=args.date, snapshot=None))
            return rc or rc2
        return args.fn(args)
    except (OfflineMiss, FetchError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
