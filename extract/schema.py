"""Typed shapes: what the model returns (ProposedRule), and the rule the app reads (Rule).

`Rule` mirrors the TypeScript `Rule` in engine/src/types.ts field for field (extra keys are
forbidden), so a file that validates here loads in the app. Trust is not a field: it comes from
`verification.level` (every extracted rule is "unreviewed", i.e. pencil).
"""

from __future__ import annotations

from typing import Literal, Union

from pydantic import BaseModel, ConfigDict, Field

RuleField = Literal[
    "min_lot_area",
    "front_setback",
    "rear_setback",
    "side_setback_interior",
    "side_setback_exterior",
    "party_wall_side",
    "contextual_side",
    "contextual_rear",
    "narrow_lot_side_table",
    "max_height_ft",
    "max_stories",
    "use_detached",
    "use_two",
    "use_row",
    "use_three",
    "parking_detached",
    "parking_two",
    "parking_row",
    "parking_three",
    "grading_review",
    "lot_of_record",
]
ALL_FIELDS: list[str] = list(RuleField.__args__)  # type: ignore[attr-defined]

Unit = Literal["ft", "sf", "stories", "spaces_per_unit", "table", "use", "flag"]
AppliesTo = Literal["detached", "two", "row", "three", "row_end", "*"]
UsePermission = Literal["P", "S", "SPR", "N"]

# The unit each field must carry.
FIELD_UNIT: dict[str, str] = {
    "min_lot_area": "sf",
    "front_setback": "ft",
    "rear_setback": "ft",
    "side_setback_interior": "ft",
    "side_setback_exterior": "ft",
    "party_wall_side": "ft",
    "contextual_side": "ft",
    "contextual_rear": "ft",
    "narrow_lot_side_table": "table",
    "max_height_ft": "ft",
    "max_stories": "stories",
    "use_detached": "use",
    "use_two": "use",
    "use_row": "use",
    "use_three": "use",
    "parking_detached": "spaces_per_unit",
    "parking_two": "spaces_per_unit",
    "parking_row": "spaces_per_unit",
    "parking_three": "spaces_per_unit",
    "grading_review": "flag",
    "lot_of_record": "flag",
}


# ── Model output ────────────────────────────────────────────────────────────


class NarrowRowOut(BaseModel):
    max_width: int = Field(description="Lot width in feet for this row (the last row covers this width and below).")
    interior: int = Field(description="Required interior side setback in feet.")
    streetside: int = Field(description="Required streetside setback in feet.")


class ProposedRule(BaseModel):
    """One rule the model proposes, read only from the text it was given."""

    field: RuleField = Field(description="Which rule this is.")
    value_number: float | None = Field(
        default=None,
        description="Numeric value for units ft, sf, stories, spaces_per_unit. Null for use, table, flag, or when the text states no number.",
    )
    value_use: UsePermission | None = Field(default=None, description="For unit 'use' only: P, S, SPR or N.")
    value_table: list[NarrowRowOut] | None = Field(default=None, description="For unit 'table' only: every row of the table.")
    unit: Unit
    applies_to: list[AppliesTo] = Field(
        description="Building types the rule covers: detached, two, three, row (attached rowhouse units), row_end (end unit of a rowhouse group), or * for all."
    )
    condition: str | None = Field(default=None, description="When the rule applies or what limits it, in plain words. Null if unconditional.")
    section: str = Field(description="Most specific section path of the clause holding the quote, e.g. 915.02.A.1 or 903.03.B.2(c).")
    quote: str = Field(description="Exact words copied from the given text, including ' | ' table-cell separators.")
    ambiguous: bool = Field(description="True if the wording leaves a reasonable doubt about what the rule is or whom it covers.")
    question_for_city: str | None = Field(
        default=None, description="A question for the Zoning Administrator when the clause is ambiguous, conditional or cross-referenced; else null."
    )


class ExtractionOut(BaseModel):
    rules: list[ProposedRule]


# ── App rule (engine/src/types.ts) ──────────────────────────────────────────


class Strict(BaseModel):
    model_config = ConfigDict(extra="forbid")


class NarrowRow(Strict):
    max_width: float
    interior: float
    streetside: float


class CityReference(Strict):
    text: str
    date: str
    who: str


class Verification(Strict):
    level: Literal["unreviewed", "source_checked", "city_confirmed"]
    reviewer: str | None
    role: str | None
    at: str | None
    note: str | None
    reference: CityReference | None


class Enacted(Strict):
    ordinance: str
    effective: str
    quote: str


class Rule(Strict):
    id: str
    district: str
    field: RuleField
    value: Union[float, list[NarrowRow], UsePermission, None]
    unit: Unit
    applies_to: list[AppliesTo]
    condition: str | None
    section: str
    quote: str
    source_file: str
    source_url: str | None = None
    retrieved: str | None = None
    origin: Literal["answer_key", "extracted"]
    dagger: bool
    question_for_city: str | None
    verification: Verification
    model: str | None
    prompt_sha: str | None
    enacted: Enacted | None = None


UNREVIEWED = {"level": "unreviewed", "reviewer": None, "role": None, "at": None, "note": None, "reference": None}


class CallLog(Strict):
    section: str  # the call id and the sections it sent, e.g. "dimensional: 903.03.C"
    tokens_in: int
    tokens_out: int
    tokens_reasoning: int = 0
    latency_ms: int
    wall_ms: int | None = None  # including backoff waits between refused attempts
    attempts: int = 1
    retries: list[str] = []
    error: str | None = None


class Meta(Strict):
    provider: str
    model: str
    prompt_sha: str
    run_at: str
    district: str
    sections: list[str]
    tokens_in: int
    tokens_out: int
    tokens_reasoning: int = 0
    latency_ms: int
    wall_ms: int | None = None
    calls: list[CallLog]
    note: str | None = None


class Rejected(BaseModel):
    rule: dict
    reason: str


class ExtractedFile(Strict):
    meta: Meta
    rules: list[Rule]
    rejected: list[Rejected]
    checks: list[dict] = []
    raw: list[dict]
