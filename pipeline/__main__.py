"""CLI.

  uv run python -m pipeline block --id 10K|0124P [--offline]   fetch today's raw cache if missing, process
  uv run python -m pipeline money [--ward 5|12] [--offline] [--hud-file PATH]
  uv run python -m pipeline city [--offline]                    citywide work file + outlines
  uv run python -m pipeline crosscheck --id 10K [--fixture PATH]
  uv run python -m pipeline refresh [--code|--code-dir DIR] [--no-city] [--baseline research-fixture]
  uv run python -m pipeline digest [--dry-run|--send]
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
    ward = int(getattr(args, "ward", 5) or 5)
    required = [f"sales_{M.municode(ward)}/page_000"]
    cache = _cache(args.offline, required, args.date)
    if args.hud_file:
        body = Path(args.hud_file).expanduser().read_bytes()
        if body[:2] != b"PK":
            print(f"{args.hud_file} is not an xlsx file", file=sys.stderr)
            return 2
        cache.offline = False
        cache.put_local("hud_il_fy2026", Path(args.hud_file), S.HUD_IL_XLSX, "xlsx",
                        f"downloaded by hand in a browser from {S.HUD_IL_XLSX}; cached with its sha256")
        cache.offline = args.offline
    if not args.offline:
        try:
            M.fetch_money(cache, ward)
        except FetchError as e:
            # comps can still be written if the sales side is complete; HUD is reported and skipped
            print(f"fetch error: {e}", file=sys.stderr)
    snap = M.build_snapshot(cache, ward)
    comps = M.comps_file(snap)
    p = M.write(comps, M.comps_name(ward))
    c = comps["counts"]
    thin = " (fewer than 30: thin market)" if c["valid_1_2_unit"] < 30 else ""
    print(f"wrote {p.relative_to(M.REPO)}: {c['valid_1_2_unit']} valid 1-2 unit sales since {M.SINCE}{thin}; "
          f"median {comps['median']:,}, IQR {comps['q1']:,}-{comps['q3']:,}; newest {comps['newest']['addr']} "
          f"({comps['newest']['yearbuilt']}, {comps['newest']['price']:,})")
    if args.snapshot:
        sp = Path(args.snapshot)
        sp.parent.mkdir(parents=True, exist_ok=True)
        sp.write_text(M.dumps(snap))
        print(f"wrote snapshot {sp}")
    hud_cache = cache if cache.has("hud_il_fy2026") else None
    if hud_cache is None:
        try:  # the newest raw cache that holds a HUD workbook (it may be an older pull)
            hud_cache = RawCache(latest_raw_date(["hud_il_fy2026"]), offline=True)
        except OfflineMiss:
            hud_cache = None
    if hud_cache is not None:
        hud = M.hud_file(hud_cache)
        hp = M.write(hud, "hud_fy2026.json")
        print(f"wrote {hp.relative_to(M.REPO)} from raw {hud_cache.date}: {hud['hud_area_name']} median "
              f"{hud['median_family_income']:,}; 80% 1..8: {[hud[f'l80_{n}'] for n in range(1, 9)]}")
        return 0
    print("HUD income limits NOT written: no raw cache holds the HUD workbook (huduser.gov challenges "
          "scripts; download it in a browser and run `money --hud-file PATH`)", file=sys.stderr)
    return 1


def cmd_city(args) -> int:
    import time

    from . import city as C

    t = time.time()
    cache = _cache(args.offline, ["city/parcels/page_0000", "city/osm_named_highways", "city_owned"], args.date)
    if not args.offline:
        C.fetch_city(cache)
    out = C.write_all(RawCache(cache.date, offline=True))
    c = out["_work_obj"]["meta"]["counts"]
    for k in ("work", "neighborhoods", "water"):
        print(f"wrote {out[k].relative_to(C.REPO)} ({out[k].stat().st_size / 1e6:.2f} MB)")
    print(f"city: {c['written']} of {c['vacant_land_rows']} City-owned vacant-land rows written, {c['skipped']} skipped "
          f"{c['skipped_by_reason']}; raw {cache.date}; {time.time() - t:.0f} s")
    return 0


def cmd_refresh(args) -> int:
    from . import refresh as R

    if args.baseline:
        if args.baseline != "research-fixture":
            print("--baseline accepts only research-fixture", file=sys.stderr)
            return 2
        rep = R.vs_research_fixture()
        out = R.OUT / "vs-research-fixture.json"
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(B.dumps(rep))
        print(f"wrote {out.relative_to(B.REPO)}: {rep['summary']}")
        return 0
    rep = R.run_refresh(code=bool(args.code or args.code_dir), code_dir=Path(args.code_dir) if args.code_dir else None,
                        city=not args.no_city)
    print(f"wrote data/refresh/latest.json: {rep['summary']}")
    return 1 if rep["meta"]["failed"] and not set(rep["meta"]["failed"]) <= {"fetch HUD"} else 0


def cmd_digest(args) -> int:
    from . import digest as D

    try:
        text = D.build()
    except D.Refused as e:
        print(str(e), file=sys.stderr)
        return 2
    if args.send:
        try:
            sent = D.send(text)
        except D.Refused as e:
            print(str(e), file=sys.stderr)
            return 2
        print(f"digest sent via {', '.join(sent)}")
        return 0
    D.PREVIEW.parent.mkdir(parents=True, exist_ok=True)
    D.PREVIEW.write_text(text)
    print(text)
    print(f"(dry run: wrote {D.PREVIEW.relative_to(B.REPO)}; nothing sent)")
    return 0


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
    m.add_argument("--ward", type=int, default=5, help="City ward (MUNICODE 100 + ward); default 5")
    m.add_argument("--snapshot", help="also write the filtered joined sales snapshot to this path")
    m.add_argument("--hud-file", help="HUD Section8-FY26.xlsx downloaded by hand (huduser.gov challenges scripts)")
    m.set_defaults(fn=cmd_money)
    x = sub.add_parser("crosscheck", help="G1 cross-check of data/blocks/<id>.json vs the research fixture")
    x.add_argument("--id", required=True)
    x.add_argument("--fixture")
    x.set_defaults(fn=cmd_crosscheck)
    c = sub.add_parser("city", help="citywide work file (data/city/work/lots_work.json) + outlines")
    c.add_argument("--offline", action="store_true")
    c.add_argument("--date")
    c.set_defaults(fn=cmd_city)
    r = sub.add_parser("refresh", help="re-pull everything into a new raw cache, re-process, diff")
    r.add_argument("--code", action="store_true", help="also re-fetch the ecode360 chapters (honest headless Chrome)")
    r.add_argument("--code-dir", help="compare ecode360 chapter pages a person saved from a browser (<id>.html)")
    r.add_argument("--no-city", action="store_true", help="skip the citywide pull (about 10 minutes)")
    r.add_argument("--baseline", help="research-fixture: diff Block 10-K against the pre-kickoff fixture only")
    r.set_defaults(fn=cmd_refresh)
    d = sub.add_parser("digest", help="watchlist digest (dry run by default)")
    g = d.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true", help="write data/refresh/digest-preview.md and print it (default)")
    g.add_argument("--send", action="store_true", help="post to Slack / send mail, only if keys are set in .env")
    d.set_defaults(fn=cmd_digest)
    a = sub.add_parser("all", help="blocks 10K and 0124P, money for wards 5 and 12, city")
    a.add_argument("--offline", action="store_true")
    a.add_argument("--date")
    a.add_argument("--no-city", action="store_true")
    a.set_defaults(fn=None)
    args = ap.parse_args(argv)
    if args.cmd in ("digest", "refresh"):
        try:
            from dotenv import load_dotenv

            load_dotenv(B.REPO / ".env")
        except ImportError:
            pass
    try:
        if args.cmd == "all":
            rcs = []
            for bid in B.BLOCKS:
                rcs.append(cmd_block(argparse.Namespace(id=bid, offline=args.offline, date=args.date, fixture=None,
                                                        no_crosscheck=False)))
            for ward in M.WARDS:
                rcs.append(cmd_money(argparse.Namespace(offline=args.offline, date=args.date, snapshot=None,
                                                        hud_file=None, ward=ward)))
            if not args.no_city:
                rcs.append(cmd_city(argparse.Namespace(offline=args.offline, date=args.date)))
            return max(rcs)
        return args.fn(args)
    except (OfflineMiss, FetchError) as e:
        print(f"error: {e}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
