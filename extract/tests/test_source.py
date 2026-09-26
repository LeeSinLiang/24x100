"""The Python locator agrees with the app's (engine/src/source.ts) on the answer key and beyond."""

import hashlib
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from extract.source import REPO, check_quote, find_quote, header, locate_section, normalize_ws, read_code, source_file_for

BASE_FILES = sorted((REPO / "data/rules/base").glob("*.json")) + [REPO / "data/rules/questions.json"]


def answer_key_quotes():
    out = []
    for p in BASE_FILES:
        for r in json.loads(p.read_text()):
            out.append((r["id"], r["source_file"], r["section"], r["quote"]))
    return out


@pytest.mark.parametrize("rid,sf,section,quote", answer_key_quotes(), ids=[q[0] for q in answer_key_quotes()])
def test_every_answer_key_quote_passes(rid, sf, section, quote):
    c = check_quote(read_code(sf), section, quote)
    assert c.ok, f"{rid}: {c.reason}"


def test_answer_key_is_not_empty():
    assert len(answer_key_quotes()) >= 12


def test_rejects_non_verbatim_and_out_of_section():
    t = read_code("data/code/ch903.txt")
    front = "Minimum Front Setback | | R1D, R1A, R2 & R3 Subdistricts | 30 ft. | RM Subdistrict | 25 ft."
    assert check_quote(t, "903.03.C", front).ok
    # paraphrase
    c = check_quote(t, "903.03.C", "Minimum Front Setback | RM Subdistrict | 25 feet")
    assert not c.ok and not c.in_file
    # in the file (Moderate), but not in High Density's table
    c = check_quote(t, "903.03.D", front)
    assert not c.ok and c.in_file and c.section_found and not c.in_section
    assert "not inside §903.03.D" in c.reason
    # unknown section
    c = check_quote(t, "903.03.Z", front)
    assert not c.ok and not c.section_found


def test_whitespace_is_normalized_like_the_app():
    t = read_code("data/code/ch903.txt")
    q = "Minimum Front Setback |\n\n | \nR1D, R1A, R2 & R3 Subdistricts |   30 ft.\t| RM Subdistrict | 25 ft."
    assert check_quote(t, "903.03.C", q).ok
    assert normalize_ws("  a \n  b　") == "a b"


def test_nested_paths():
    t = read_code("data/code/ch903.txt")
    s = locate_section(t, "903.03.C.2(c)")
    body = normalize_ws(t[s.start : s.end])
    assert body.startswith("(c) When a dwelling is")
    # (c) is the last clause of 2., so like the app's locator its span runs on through the table
    assert "Minimum Lot Size" in body
    d = locate_section(t, "903.03.D.2(d)")
    assert normalize_ws(t[d.start : d.end]).startswith("(d) When a dwelling is")
    assert locate_section(t, "903.03.C.2(z)") is None


def test_find_quote_and_header():
    t = read_code("data/code/ch925.txt")
    q = "If lots on either side of the subject lot are vacant,\n the setback"
    sp = find_quote(t, q, locate_section(t, "925.06.I"))
    assert sp and normalize_ws(t[sp.start : sp.end]) == normalize_ws(q)
    h = header("data/code/ch925.txt")
    assert h.source_url == "https://ecode360.com/45479639" and h.retrieved == "2026-09-26"
    assert source_file_for("921.04.A") == "data/code/ch921.txt"


def _parity_cases():
    cases = [{"file": sf, "section": sec, "quote": q} for _, sf, sec, q in answer_key_quotes()]
    front = "Minimum Front Setback | | R1D, R1A, R2 & R3 Subdistricts | 30 ft. | RM Subdistrict | 25 ft."
    cases += [
        {"file": "data/code/ch903.txt", "section": "903.03.D", "quote": front},
        {"file": "data/code/ch903.txt", "section": "903.03.C.2", "quote": front},
        {"file": "data/code/ch903.txt", "section": "903.03.C", "quote": "RM Subdistrict | 25 feet"},
        {"file": "data/code/ch903.txt", "section": "903.03.Q", "quote": front},
        {"file": "data/code/ch903.txt", "section": "903.03.D.2(d)", "quote": "shall be zero on the abutting or party wall side."},
        {"file": "data/code/ch911.txt", "section": "911.02", "quote": "Single-Unit Detached Residential means the use of a zoning lot for one detached housing unit. | P | P"},
        {"file": "data/code/ch911.txt", "section": "911.04.A.69A", "quote": "For lots with Lot Widths of 35 feet or smaller, Single-Unit Attached Uses shall be permitted by right."},
        {"file": "data/code/ch914.txt", "section": "914.02.A", "quote": "Single-Unit Attached | 0 per unit | 4 per unit"},
        {"file": "data/code/ch915.txt", "section": "915.02.A.1.c", "quote": "Cut or filled slopes shall not exceed twenty-five (25) percent unless:"},
        {"file": "data/code/ch921.txt", "section": "921.04.A", "quote": "Vacant Lot."},
        {"file": "data/code/ch925.txt", "section": "925.01.C.2", "quote": "may be approved as an Administrator's Exception"},
        {"file": "data/code/ch925.txt", "section": "925.06.C.1", "quote": "Reduced Setback on Both Sides."},
    ]
    return cases


def test_python_locator_matches_typescript():
    npx = shutil.which("npx")
    if not npx or not (REPO / "node_modules/.bin/tsx").exists():
        pytest.skip("tsx not installed; run `npm install` to enable the TS parity check")
    cases = _parity_cases()
    p = subprocess.run(
        [npx, "tsx", "extract/tests/ts_check.ts"], input=json.dumps(cases), capture_output=True, text=True, cwd=REPO, timeout=120
    )
    assert p.returncode == 0, p.stderr
    ts = json.loads(p.stdout)
    assert len(ts) == len(cases)
    for c, t in zip(cases, ts):
        text = read_code(c["file"])
        py = check_quote(text, c["section"], c["quote"])
        span = locate_section(text, c["section"])
        sha = hashlib.sha256(normalize_ws(text[span.start : span.end]).encode()).hexdigest() if span else None
        got = {"ok": py.ok, "in_file": py.in_file, "in_section": py.in_section, "section_found": py.section_found, "reason": py.reason, "section_sha": sha}
        assert got == t, f"{c['section']} {c['quote'][:40]!r}: python {got} != ts {t}"
    # the negative cases really are negative (the parity test isn't vacuous)
    assert sum(1 for t in ts if not t["ok"]) >= 3
