"""Saved code text: locate a cited section and check that a quote appears in it word for word.

A line-for-line port of engine/src/source.ts, so the extraction guard and the app agree on what
"the quote is inside the cited section" means. Section paths look like "903.03.C",
"903.03.C.2(c)", "925.06.C". The saved text keeps one structural marker per line: "§ 903.03",
"C. ", "2. ", "(c) ".

Parity notes (JS vs Python):
- JS `\\s` and `String.prototype.trim` use the ECMAScript whitespace set; Python's `\\s` and
  `str.strip` differ at the edges (\\x1c-\\x1f, \\x85, \\ufeff). We use the ECMAScript set explicitly.
- JS `\\d` and `\\b` are ASCII-only without the `u` flag; we compile with re.ASCII.
- JS offsets count UTF-16 code units, Python offsets count code points. Offsets are only used to
  slice the same string they came from, so the checks agree; raw offset numbers may differ.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# ECMAScript WhiteSpace + LineTerminator (what JS `\s` and `trim()` match).
_JS_WS = "\t\n\v\f\r    -     　﻿"
_WS_RUN = re.compile(f"[{_JS_WS}]+")
_TRIM = re.compile(f"^[{_JS_WS}]+|[{_JS_WS}]+$")


def js_trim(s: str) -> str:
    return _TRIM.sub("", s)


def normalize_ws(s: str) -> str:
    """`s.replace(/\\s+/g, ' ').trim()`"""
    return js_trim(_WS_RUN.sub(" ", s))


@dataclass(frozen=True)
class Span:
    start: int
    end: int


def _line_offsets(lines: list[str]) -> list[int]:
    off: list[int] = []
    o = 0
    for line in lines:
        off.append(o)
        o += len(line) + 1
    return off


_PART = re.compile(r"^([A-Za-z0-9]+)((?:\([a-z0-9]+\))*)$", re.ASCII)
_DIGITS = re.compile(r"^\d+$", re.ASCII)
_PAREN = re.compile(r"\([a-z0-9]+\)", re.ASCII)
HEADING = re.compile(r"^§ \d{3}\.\d{2}\b", re.ASCII)
_SECTION = re.compile(r"^(\d{3}\.\d{2})(?:\.(.*))?$", re.ASCII)
_SIB = {
    "letter": re.compile(r"^[A-Z]\.$", re.ASCII),
    "number": re.compile(r"^\d+\.$", re.ASCII),
    "paren": re.compile(r"^\([a-z0-9]+\)$", re.ASCII),
}


def _parse_parts(rest: str) -> list[tuple[str, str]]:
    parts: list[tuple[str, str]] = []
    for tok in [t for t in rest.split(".") if t]:
        m = _PART.match(tok)
        if not m:
            continue
        head = m.group(1)
        parts.append(("number" if _DIGITS.match(head) else "letter", head))
        for p in _PAREN.findall(m.group(2) or ""):
            parts.append(("paren", p[1:-1]))
    return parts


def locate_section(text: str, section: str) -> Span | None:
    """Char span of a section in the saved text, or None when it can't be found."""
    m = _SECTION.match(section)
    if not m:
        return None
    base = m.group(1)
    lines = text.split("\n")
    off = _line_offsets(lines)
    # The body occurrence of "§ 903.03" is the one not immediately followed by another heading.
    s0 = -1
    for i in range(len(lines)):
        if js_trim(lines[i]) != f"§ {base}":
            continue
        j = i + 1
        seen = 0
        heading_soon = False
        while j < len(lines) and seen < 3:
            t = js_trim(lines[j])
            if t:
                seen += 1
                if HEADING.search(t):
                    heading_soon = True
            j += 1
        if not heading_soon:
            s0 = i
            break
    if s0 < 0:
        return None
    e0 = len(lines)
    for i in range(s0 + 1, len(lines)):
        if HEADING.search(js_trim(lines[i])):
            e0 = i
            break
    lo, hi = s0, e0
    for kind, label in _parse_parts(m.group(2) or ""):
        want = f"({label})" if kind == "paren" else f"{label}."
        sib = _SIB[kind]
        s = -1
        for i in range(lo + 1, hi):
            if js_trim(lines[i]) == want:
                s = i
                break
        if s < 0:
            return None
        e = hi
        for i in range(s + 1, hi):
            if sib.match(js_trim(lines[i])):
                e = i
                break
        lo, hi = s, e
    return Span(off[lo], off[hi] if hi < len(lines) else len(text))


@dataclass(frozen=True)
class QuoteCheck:
    ok: bool
    in_file: bool
    in_section: bool
    section_found: bool
    reason: str | None


def check_quote(text: str, section: str, quote: str) -> QuoteCheck:
    q = normalize_ws(quote)
    if not q:
        return QuoteCheck(False, False, False, False, "empty quote")
    in_file = q in normalize_ws(text)
    span = locate_section(text, section)
    in_section = bool(span) and q in normalize_ws(text[span.start : span.end])
    ok = in_file and (in_section if span else False)
    if ok:
        reason = None
    elif not in_file:
        reason = "quote does not appear word for word in the source file"
    elif not span:
        reason = f"section {section} not found in the source file"
    else:
        reason = f"quote appears in the file but not inside §{section}"
    return QuoteCheck(ok, in_file, in_section, bool(span), reason)


def find_quote(text: str, quote: str, within: Span | None = None) -> Span | None:
    """Raw char range of a quote inside the file (for highlighting), tolerant of whitespace."""
    toks = [re.escape(t) for t in normalize_ws(quote).split(" ") if t != ""]
    if not toks:
        return None
    rx = re.compile(f"[{_JS_WS}]+".join(toks))
    hay = text[within.start : within.end] if within else text
    m = rx.search(hay)
    if not m:
        return None
    base = within.start if within else 0
    return Span(base + m.start(), base + m.end())


# ── Saved files ──────────────────────────────────────────────────────────────

_cache: dict[str, str] = {}


def read_code(source_file: str) -> str:
    """Read a saved code file by its repo-relative path (e.g. "data/code/ch903.txt")."""
    if source_file not in _cache:
        _cache[source_file] = (REPO / source_file).read_text(encoding="utf-8")
    return _cache[source_file]


def source_file_for(section: str) -> str:
    """The saved file that holds a section: "903.03.C" -> "data/code/ch903.txt"."""
    m = re.match(r"^(\d{3})\.", section)
    if not m:
        raise ValueError(f"not a section path: {section!r}")
    return f"data/code/ch{m.group(1)}.txt"


@dataclass(frozen=True)
class Header:
    source_url: str | None
    retrieved: str | None


def header(source_file: str) -> Header:
    """Source URL and retrieval date from the saved file's header lines."""
    head = "\n".join(read_code(source_file).split("\n")[:6])
    url = re.search(r"^Source:\s*(\S+)", head, re.M)
    ret = re.search(r"^Retrieved:\s*(\d{4}-\d{2}-\d{2})", head, re.M)
    return Header(url.group(1) if url else None, ret.group(1) if ret else None)


def section_text(section: str, source_file: str | None = None) -> str:
    """The raw text of a section span (what the model is shown)."""
    sf = source_file or source_file_for(section)
    text = read_code(sf)
    span = locate_section(text, section)
    if span is None:
        raise LookupError(f"§{section} not found in {sf}")
    return text[span.start : span.end]
