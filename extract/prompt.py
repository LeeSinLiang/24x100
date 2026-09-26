"""The prompt. Its sha256 (template + the exact section text sent) is recorded on every rule."""

from __future__ import annotations

import hashlib

from .sections import CallPlan, District

SYSTEM = """You read zoning code text for the City of Pittsburgh and turn it into typed rules for a \
feasibility tool. People will check every rule you propose against the text before it counts.

Hard rules:
1. Use ONLY the code text in the user message. Never use your own memory of any zoning code. If \
the text does not state something, leave it null or leave the rule out.
2. `quote` must be copied exactly, word for word, from the text given: same words, numbers, \
punctuation and straight quotes, including the ' | ' separators between table cells (keep empty \
cells as '| |'). Line breaks may be written as single spaces. Never paraphrase, abbreviate or join \
pieces from different places. The quote must contain the words that state the value.
3. `section` is the most specific path of the clause that contains the quote, written \
chapter.section then the markers as printed in the text: capital letter, number, (lowercase \
letter), e.g. 915.02.A.1 or 903.03.B.2(c). Do not include the "§" sign.
4. Units: ft (feet), sf (square feet), stories, spaces_per_unit, use (P/S/SPR/N), table, flag. \
Put numbers in value_number, use codes in value_use, table rows in value_table; leave the others null.
5. applies_to lists the building types the rule covers: detached (single-unit detached house), \
two (two-unit house), three (three-unit house), row (single-unit attached rowhouse units), \
row_end (the end unit of a group of rowhouses), or "*" when it covers all of them. When the wording \
leaves doubt about whether a building type is covered, list only the types it clearly covers, set \
ambiguous = true and ask the City about the others in question_for_city.
6. Set ambiguous = true when a reasonable reader could apply the clause more than one way. Whenever \
a rule is ambiguous, conditional (depends on facts about the lot or its neighbors) or relies on a \
cross-referenced section, write question_for_city: one plain question the Zoning Administrator \
could answer. Otherwise question_for_city is null.
7. Return one rule per requested field at most. Leave a field out if the text given does not \
state it."""

USER = """District: {district} = Use Subdistrict {use} ({use_name}, §{use_section}) + \
Development Subdistrict {density} ({density_name}, §{density_section}).

Fields to extract from this text: {fields}

How to read it: {guidance}

Code text (saved from ecode360; table cells are separated by ' | '):
{sections}"""

SECTION_BLOCK = """
===== §{section} ({source_file}){trimmed} =====
{text}
===== end §{section} ====="""


def build_messages(d: District, c: CallPlan) -> list[tuple[str, str]]:
    blocks = "".join(
        SECTION_BLOCK.format(
            section=s.section,
            source_file=s.source_file,
            trimmed=f"; trimmed: {s.trimmed}" if s.trimmed else "",
            text=s.text.strip("\n"),
        )
        for s in c.sections
    )
    user = USER.format(
        district=d.name,
        use=d.use,
        use_name=d.use_name,
        use_section=d.use_section,
        density=d.density,
        density_name=d.density_name,
        density_section=d.density_section,
        fields=", ".join(c.fields),
        guidance=c.guidance,
        sections=blocks,
    )
    return [("system", SYSTEM), ("human", user)]


def prompt_sha(messages: list[tuple[str, str]]) -> str:
    h = hashlib.sha256()
    for role, text in messages:
        h.update(role.encode())
        h.update(b"\x00")
        h.update(text.encode())
        h.update(b"\x00")
    return h.hexdigest()
