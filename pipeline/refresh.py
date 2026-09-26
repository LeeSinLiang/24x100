"""Refresh: re-pull every dataset into a new raw cache, re-process, and diff against the previous
processed outputs. Writes data/refresh/latest.json and data/refresh/<YYYY-MM-DDTHHMM>.json.

Refresh never touches data/rules/ (rules are decisions made by people) and never overwrites
data/code/ (with --code it only reports which saved chapters differ from a fresh copy).
"""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import html
import io
import json
import re
import shutil
import subprocess
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable

from . import block as B
from . import money as M
from . import sources as S
from .fetch import RAW_ROOT, REPO, FetchError, RawCache, latest_raw_date

OUT = REPO / "data" / "refresh"
CODE_DIR = REPO / "data" / "code"
FIXTURE = Path("/Users/sllee/coding/ai-horizons-research/design-proposals/plate/data/block_10K_mahon.json")
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

BLOCK_FIELDS = ["addr", "zone", "city.status", "city.status_updated", "city.inventory", "assess.lotarea",
                "assess.use", "assess.yearbuilt", "assess.legal", "deed.front", "deed.depth", "recon.state",
                "built", "mapped_area", "slope25", "undermined"]
CITY_FIELDS = ["addr", "hood", "zone", "city.status", "city.status_updated", "city.inventory", "assess.lotarea",
               "assess.use", "deed.front", "deed.depth", "built", "mapped_area", "streets.names", "neighbors.pins",
               "neighbors.built"]
COMPS_FIELDS = ["counts.transfers", "counts.valid", "counts.valid_1_2_unit", "median", "q1", "q3",
                "newest.addr", "newest.price", "newest.yearbuilt"]
HUD_FIELDS = ["median_family_income"] + [f"l80_{n}" for n in range(1, 9)] + [f"l50_{n}" for n in range(1, 9)]


# ---------------------------------------------------------------------------------------------
# helpers


def get(obj: Any, path: str) -> Any:
    # derived values (what the engine's edge labels depend on)
    if path == "streets.names":
        return sorted({s["name"] for s in (obj or {}).get("streets", [])})
    if path == "neighbors.pins":
        return sorted(n["pin"] for n in (obj or {}).get("neighbors", []))
    if path == "neighbors.built":
        return sorted(n["pin"] for n in (obj or {}).get("neighbors", []) if n.get("built"))
    for part in path.split("."):
        if obj is None:
            return None
        obj = obj.get(part) if isinstance(obj, dict) else None
    return obj


def _load(p: Path) -> Any:
    return json.loads(p.read_text()) if p.exists() else None


def dataset_id(key: str) -> str | None:
    """Group raw-cache keys into datasets: pages and batches collapse into one id."""
    if key.endswith("/count"):
        return None
    k = re.sub(r"/page_\d+$", "", key)
    k = re.sub(r"/assessments_\d+$", "/assessments", k)
    k = re.sub(r"^city/assess/\d+_\d+$", "city/assessments", k)
    k = re.sub(r"^city/assess_extra/assessments$", "city/assessments_extra", k)
    return k


def _rows(cache: RawCache, key: str) -> int | None:
    e = cache.entry(key)
    f = e["file"]
    b = cache.read(key)
    if f.endswith(".csv"):
        return max(0, len(list(csv.reader(io.StringIO(b.decode("utf-8-sig"))))) - 1)
    if f.endswith((".json", ".geojson")):
        j = json.loads(b)
        if isinstance(j, dict):
            if "features" in j:
                return len(j["features"])
            if "result" in j and "records" in j["result"]:
                return len(j["result"]["records"])
            if "elements" in j:
                return len(j["elements"])
    return None


def _content(cache: RawCache, key: str) -> tuple[str, str | None]:
    """(order-insensitive content hash, OSM base timestamp). Feature order, Overpass timestamps and
    other response metadata are not content."""
    e = cache.entry(key)
    b = cache.read(key)
    if e["file"].endswith((".json", ".geojson")):
        j = json.loads(b)
        if isinstance(j, dict):
            if "features" in j:
                items = j["features"]
            elif "result" in j and "records" in j["result"]:
                items = j["result"]["records"]
            elif "elements" in j:
                items = j["elements"]
            else:
                items = [j]
            h = hashlib.sha256("\n".join(sorted(json.dumps(x, sort_keys=True) for x in items)).encode()).hexdigest()
            return h, (j.get("osm3s") or {}).get("timestamp_osm_base") if "elements" in j else None
    if e["file"].endswith(".csv"):
        return hashlib.sha256("\n".join(sorted(b.decode("utf-8-sig").splitlines()[1:])).encode()).hexdigest(), None
    return e["sha256"], None


def dataset_summary(cache: RawCache | None) -> dict[str, dict]:
    if cache is None:
        return {}
    groups: dict[str, list[str]] = {}
    for k in sorted(cache.manifest):
        d = dataset_id(k)
        if d:
            groups.setdefault(d, []).append(k)
    out = {}
    for d, keys in groups.items():
        rows = [_rows(cache, k) for k in keys]
        cont = [_content(cache, k) for k in keys]
        bases = sorted(c[1] for c in cont if c[1])
        out[d] = {
            "rows": None if any(r is None for r in rows) else sum(rows),
            "sha": hashlib.sha256("".join(cache.entry(k)["sha256"] for k in keys).encode()).hexdigest(),
            "content": hashlib.sha256("".join(c[0] for c in cont).encode()).hexdigest(),
            "osm_base": bases[0] if bases else None,
        }
    return out


def diff_records(before: dict[str, dict], after: dict[str, dict], fields: list[str], scope: str,
                 block: str | None) -> list[dict]:
    out = []
    for pin in sorted(set(before) | set(after)):
        b, a = before.get(pin), after.get(pin)
        addr = (a or b or {}).get("addr")
        if b is None:
            out.append({"pin": pin, "addr": addr, "block": block, "scope": scope, "field": "*", "before": None,
                        "after": "present", "kind": "added"})
            continue
        if a is None:
            out.append({"pin": pin, "addr": addr, "block": block, "scope": scope, "field": "*", "before": "present",
                        "after": None, "kind": "removed"})
            continue
        for f in fields:
            vb, va = get(b, f), get(a, f)
            if vb != va:
                out.append({"pin": pin, "addr": addr, "block": block, "scope": scope, "field": f, "before": vb,
                            "after": va, "kind": "changed"})
    return out


def diff_money(before: dict | None, after: dict | None, fields: list[str], name: str) -> list[dict]:
    if before is None or after is None:
        return []
    out = []
    for f in fields:
        vb, va = get(before, f), get(after, f)
        if vb != va:
            out.append({"pin": None, "addr": None, "block": None, "scope": "money", "field": f"{name}.{f}",
                        "before": vb, "after": va, "kind": "changed"})
    if name == "comps":
        kb = {(s["parid"], s["saledate"]): s for s in before.get("sales", [])}
        ka = {(s["parid"], s["saledate"]): s for s in after.get("sales", [])}
        for k in sorted(set(kb) ^ set(ka)):
            s = ka.get(k) or kb.get(k)
            out.append({"pin": s["parid"], "addr": s.get("address"), "block": None, "scope": "money",
                        "field": "comps.sales", "before": None if k in ka else s["price"],
                        "after": s["price"] if k in ka else None, "kind": "added" if k in ka else "removed"})
    return out


def snapshot_outputs() -> dict[str, Any]:
    blocks = {bid: _load(B.OUT_DIR / f"{bid}.json") for bid in B.BLOCKS}
    work = REPO / "data" / "city" / "work" / "lots_work.json"
    return {
        "blocks": blocks,
        "comps": _load(M.OUT_DIR / "comps_ward5.json"),
        "hud": _load(M.OUT_DIR / "hud_fy2026.json"),
        "city": _load(work),
    }


def diff_outputs(before: dict, after: dict) -> list[dict]:
    changes: list[dict] = []
    for bid in B.BLOCKS:
        b, a = before["blocks"].get(bid), after["blocks"].get(bid)
        if b and a:
            changes += diff_records({p["pin"]: p for p in b["parcels"]}, {p["pin"]: p for p in a["parcels"]},
                                    BLOCK_FIELDS, "block", bid)
    if before.get("city") and after.get("city"):
        changes += diff_records({l["pin"]: l for l in before["city"]["lots"]}, {l["pin"]: l for l in after["city"]["lots"]},
                                CITY_FIELDS, "city", None)
    for bid in B.BLOCKS:
        b, a = before["blocks"].get(bid), after["blocks"].get(bid)
        if b and a:
            sb, sa = _street_lengths(b), _street_lengths(a)
            if sb != sa:
                changes.append({"pin": None, "addr": None, "block": bid, "scope": "block", "field": "streets",
                                "before": sb, "after": sa, "kind": "changed"})
    changes += diff_money(before.get("comps"), after.get("comps"), COMPS_FIELDS, "comps")
    changes += diff_money(before.get("hud"), after.get("hud"), HUD_FIELDS, "hud")
    return changes


def _street_lengths(block: dict) -> dict[str, float]:
    from shapely.geometry import LineString

    out: dict[str, float] = {}
    for st in block.get("streets", []):
        out[st["name"]] = out.get(st["name"], 0.0) + LineString(st["line"]).length
    return {k: round(v) for k, v in sorted(out.items())}


def summary_sentence(changes: list[dict], datasets: list[dict], failed: list[str]) -> str:
    changed_ds = [d["id"] for d in datasets if d.get("changed")]
    older = [d["id"] for d in datasets if d.get("osm_older")]
    by_scope: dict[str, int] = {}
    for c in changes:
        by_scope[c["scope"]] = by_scope.get(c["scope"], 0) + 1
    status = sum(1 for c in changes if c["field"] == "city.status")
    if not changes:
        s = "No processed value changed since the previous pull"
    else:
        parts = [f"{n} in {k}" for k, n in sorted(by_scope.items())]
        s = f"{len(changes)} processed value(s) changed since the previous pull ({', '.join(parts)}; {status} City status change(s))"
    s += f"; {len(changed_ds)} of {len(datasets)} raw datasets changed in content"
    if older:
        s += f" (the OSM mirror served older data than the previous pull for {', '.join(older)})"
    if failed:
        s += f"; not re-pulled: {', '.join(failed)}"
    return s + "."


# ---------------------------------------------------------------------------------------------
# ecode360 (--code): fetch honestly or read pages a person saved; never overwrite data/code/


class _Text(HTMLParser):
    BLOCK = {"p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "br", "section", "article", "dd", "dt"}

    def __init__(self):
        super().__init__()
        self.out: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in ("script", "style", "noscript"):
            self.skip += 1
        if tag in ("td", "th"):
            self.out.append(" | ")
        elif tag in self.BLOCK:
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in ("script", "style", "noscript"):
            self.skip = max(0, self.skip - 1)
        elif tag in self.BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def html_to_text(doc: str) -> str:
    p = _Text()
    p.feed(doc)
    text = html.unescape("".join(p.out))
    return "\n".join(line.rstrip() for line in text.splitlines())


def words(text: str) -> list[str]:
    return re.findall(r"[A-Za-z0-9§.,;:()\-]+", text)


def saved_body(path: Path) -> str:
    """Saved chapter text without its 6-line header."""
    return "\n".join(path.read_text().splitlines()[6:])


def chapter_ids() -> dict[str, str]:
    out = {}
    for p in sorted(CODE_DIR.glob("ch*.txt")):
        m = re.search(r"ecode360\.com/(\d+)", p.read_text().splitlines()[1])
        if m:
            out[p.name] = m.group(1)
    return out


def refresh_code(cache: RawCache, code_dir: Path | None) -> list[dict]:
    rows = []
    for name, cid in chapter_ids().items():
        url = f"https://ecode360.com/{cid}"
        entry = {"file": f"data/code/{name}", "url": url}
        doc = None
        if code_dir is not None:
            cand = [p for p in (code_dir / f"{cid}.html", code_dir / f"{name[:-4]}.html") if p.exists()]
            if cand:
                doc = cand[0].read_text(errors="replace")
                entry["fetched_by"] = f"saved by a person: {cand[0].name}"
        elif Path(CHROME).exists():
            # Honest headless Chrome (its own user agent). No attempt to pass a bot check.
            try:
                r = subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--dump-dom", url],
                                   capture_output=True, text=True, timeout=90)
                doc = r.stdout
                entry["fetched_by"] = "headless Chrome, default user agent"
            except Exception as e:  # noqa: BLE001
                entry["error"] = str(e)[:200]
        if not doc or len(words(html_to_text(doc))) < 200:
            why = ("blocked by a Cloudflare challenge page ('Just a moment...'); not bypassed"
                   if doc and re.search(r"<title>\s*Just a moment", doc) else "no usable page (blocked or empty)")
            entry.update({"changed": None, "note": f"{why}. Save the chapter from a browser as {cid}.html and run "
                                                   "refresh --code-dir DIR"})
            rows.append(entry)
            continue
        text = html_to_text(doc)
        dest = cache.dir / "code"
        dest.mkdir(parents=True, exist_ok=True)
        (dest / name).write_text(text)
        a, b = words(saved_body(CODE_DIR / name)), words(text)
        # compare the chapter's own words: the saved body's first section marker to its end
        start = next((i for i, w in enumerate(b) if a and w == a[0]), 0)
        b = b[start:start + len(a) + 50]
        same = a == b[: len(a)]
        entry.update({"changed": not same, "saved_to": f"data/raw/{cache.date}/code/{name}",
                      "note": "word sequence matches the saved text" if same else
                      "word sequence differs from data/code; a person should compare and decide (data/code not overwritten)"})
        rows.append(entry)
    return rows


# ---------------------------------------------------------------------------------------------
# research-fixture baseline


def vs_research_fixture(fixture: Path = FIXTURE) -> dict[str, Any]:
    fx = json.loads(fixture.read_text())
    ours = json.loads((B.OUT_DIR / "10K.json").read_text())
    fxp = {p["pin"]: p for p in fx["parcels"]}
    op = {p["pin"]: p for p in ours["parcels"]}
    pairs = [("status", lambda p: (p.get("city") or {}).get("status"), lambda p: (p.get("city") or {}).get("status")),
             ("lotarea", lambda p: p.get("lotarea"), lambda p: (p.get("assess") or {}).get("lotarea")),
             ("use", lambda p: p.get("use"), lambda p: (p.get("assess") or {}).get("use")),
             ("yearbuilt", lambda p: p.get("yearbuilt"), lambda p: (p.get("assess") or {}).get("yearbuilt")),
             ("zone", lambda p: p.get("zone"), lambda p: p.get("zone"))]
    changes = []
    for pin in sorted(set(fxp) | set(op)):
        f, o = fxp.get(pin), op.get(pin)
        addr = (o or {}).get("addr") or (f or {}).get("addr")
        if f is None or o is None:
            changes.append({"pin": pin, "addr": addr, "block": "10K", "scope": "block", "field": "*",
                            "before": "present" if f else None, "after": "present" if o else None,
                            "kind": "added" if o else "removed"})
            continue
        for name, gf, go in pairs:
            vb, va = gf(f), go(o)
            if vb != va:
                changes.append({"pin": pin, "addr": addr, "block": "10K", "scope": "block", "field": name,
                                "before": vb, "after": va, "kind": "changed"})
    n_status = sum(1 for c in changes if c["field"] == "status")
    return {
        "meta": {
            "label": "Baseline: the pre-kickoff RESEARCH FIXTURE, not a previous pipeline run",
            "run_at": ours["meta"]["pulled"],
            "from": {"file": "/".join(fixture.parts[-5:]), "pulled": fx.get("meta", {}).get("pulled"),
                     "sha256": hashlib.sha256(fixture.read_bytes()).hexdigest()},
            "to": {"file": "data/blocks/10K.json", "pulled": ours["meta"]["pulled"]},
            "fields": ["status", "lotarea", "use", "yearbuilt", "zone"],
            "note": "The fixture stores City status as the City-Owned status or null; our file as city.status or null.",
        },
        "changes": changes,
        "summary": (f"Block 10-K vs the research fixture: {len(changes)} difference(s) over {len(op)} parcels "
                    f"({n_status} in City status)."),
    }


# ---------------------------------------------------------------------------------------------
# run


def new_raw_date(now: dt.datetime) -> str:
    d = now.date().isoformat()
    if (RAW_ROOT / d).exists():
        d = now.strftime("%Y-%m-%dT%H%M")
    return d


def run_refresh(*, code: bool = False, code_dir: Path | None = None, log: Callable[[str], None] = print,
                city: bool = True) -> dict[str, Any]:
    from . import city as C

    now = dt.datetime.now(dt.timezone.utc).replace(microsecond=0)
    try:
        prev_date = latest_raw_date()
    except Exception:  # noqa: BLE001
        prev_date = None
    before_outputs = snapshot_outputs()
    to_date = new_raw_date(now)
    cache = RawCache(to_date)
    failed: list[str] = []
    errors: dict[str, str] = {}

    def step(name: str, fn: Callable[[], None]) -> bool:
        try:
            log(f"refresh: {name} ...")
            fn()
            return True
        except Exception as e:  # noqa: BLE001 - reported, not hidden
            failed.append(name)
            errors[name] = str(e)[:300]
            log(f"refresh: {name} FAILED: {e}")
            return False

    ok_blocks = {bid: step(f"fetch block {bid}", lambda c=cfg: B.fetch_block(cache, c)) for bid, cfg in B.BLOCKS.items()}
    ok_sales = step("fetch sales", lambda: (S.fetch_sales(cache, M.MUNICODE),
                                            S.fetch_assessments(cache, f"sales_{M.MUNICODE}", _sales_pins(cache))))
    step("fetch HUD", lambda: S.fetch_hud_once(cache))
    ok_city = step("fetch city", lambda: C.fetch_city(cache)) if city else False

    if prev_date:
        _retry_older_osm(RawCache(prev_date, offline=True), cache, log)

    off = RawCache(to_date, offline=True)
    for bid, ok in ok_blocks.items():
        if ok:
            step(f"process block {bid}", lambda b=bid: B.write_block(B.process_block(off, B.BLOCKS[b])))
    if ok_blocks.get("10K") and FIXTURE.exists():
        from . import crosscheck as X

        step("G1 cross-check", lambda: (B.OUT_DIR / "10K.crosscheck.json").write_text(
            B.dumps(X.crosscheck(json.loads((B.OUT_DIR / "10K.json").read_text()), FIXTURE))))
    if ok_sales:
        step("process comps", lambda: M.write(M.comps_file(M.build_snapshot(off)), "comps_ward5.json"))
    if off.has("hud_il_fy2026"):
        step("process HUD", lambda: M.write(M.hud_file(off), "hud_fy2026.json"))
    if ok_city:
        step("process city", lambda: C.write_all(off))

    after_outputs = snapshot_outputs()
    changes = diff_outputs(before_outputs, after_outputs)

    prev = RawCache(prev_date, offline=True) if prev_date else None
    ds_b, ds_a = dataset_summary(prev), dataset_summary(off)
    datasets = []
    for d in sorted(set(ds_b) | set(ds_a)):
        b, a = ds_b.get(d), ds_a.get(d)
        row = {"id": d, "rows_before": b and b["rows"], "rows_after": a and a["rows"],
               "sha_before": b and b["sha"], "sha_after": a and a["sha"],
               "changed": None if (a is None or b is None) else a["content"] != b["content"],
               "bytes_changed": None if (a is None or b is None) else a["sha"] != b["sha"]}
        if (a and a["osm_base"]) or (b and b["osm_base"]):
            row["osm_base_before"] = b and b["osm_base"]
            row["osm_base_after"] = a and a["osm_base"]
            if b and a and b["osm_base"] and a["osm_base"] and a["osm_base"] < b["osm_base"]:
                row["osm_older"] = True
                row["note"] = ("the Overpass mirror answered from an older OSM snapshot than the previous pull; "
                               "street changes in this row may be a step backwards, not new edits")
        if a is None:
            row["note"] = "not re-pulled in this run"
        if b is None:
            row["note"] = "new in this run"
        datasets.append(row)

    code_rows = refresh_code(off, code_dir) if code else [
        {"file": f"data/code/{n}", "changed": False,
         "note": "not re-dumped (ecode360 blocks scripted fetches; run with --code, or --code-dir with pages saved from a browser)"}
        for n in chapter_ids()]
    report = {
        "meta": {"run_at": now.isoformat().replace("+00:00", "Z"), "from": prev_date, "to": to_date,
                 "datasets": datasets, "failed": failed, "errors": errors,
                 "rules_untouched": "refresh never writes data/rules/"},
        "changes": changes,
        "code": code_rows,
        "summary": summary_sentence(changes, datasets, failed),
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "latest.json").write_text(B.dumps(report))
    (OUT / f"{now.strftime('%Y-%m-%dT%H%M')}.json").write_text(B.dumps(report))
    return report


def _osm_base(cache: RawCache, key: str) -> str | None:
    if not cache.has(key):
        return None
    return (json.loads(cache.read(key)).get("osm3s") or {}).get("timestamp_osm_base")


def _retry_older_osm(prev: RawCache, cache: RawCache, log: Callable[[str], None]) -> None:
    """The Overpass mirror has several backends at different replication points. If a pull came
    back older than the previous one, ask once more; keep whichever answer is newer."""
    for key in sorted(k for k in cache.manifest if k.endswith("osm") or k == "city/osm_named_highways"):
        old, new = _osm_base(prev, key), _osm_base(cache, key)
        if not (old and new and new < old):
            continue
        e = dict(cache.manifest[key])
        body_before = cache.read(key)
        log(f"refresh: {key} came from an older OSM snapshot ({new} < {old}); asking once more")
        del cache.manifest[key]
        try:
            cache.get(key, e["url"], e.get("params") or None, method=e.get("method", "GET"), data=e.get("post_data"),
                      timeout=400, retries=1)
        except Exception as ex:  # noqa: BLE001
            log(f"refresh: retry failed ({ex}); keeping the first answer")
        if (_osm_base(cache, key) or "") < new:  # the retry was even older: restore the first answer
            (cache.dir / e["file"]).write_bytes(body_before)
            cache.manifest[key] = e
            cache._save_manifest()


def _sales_pins(cache: RawCache) -> list[str]:
    recs = M._sales_records(cache, M._sales_keys(cache))
    return sorted({r["PARID"] for r in recs if M._is_valid_recent(r)})
