"""Processing the raw cache twice gives byte-identical JSON, equal to the committed file."""
import json
from pathlib import Path

import pytest

from pipeline import block as B
from pipeline.fetch import OfflineMiss, RawCache, latest_raw_date
from pipeline.money import comps_file, dumps, summarize

REPO = Path(__file__).resolve().parents[2]


def _cache():
    try:
        return RawCache(latest_raw_date(["10K/osm", "10K/parcels", "city_owned"]), offline=True)
    except OfflineMiss:
        pytest.skip("no raw cache on this machine (data/raw is gitignored); run `python -m pipeline block --id 10K`")


def test_block_twice_identical_and_matches_committed():
    cache = _cache()
    cfg = B.BLOCKS["10K"]
    a = B.dumps(B.process_block(cache, cfg))
    b = B.dumps(B.process_block(RawCache(cache.date, offline=True), cfg))
    assert a == b
    committed = (REPO / "data" / "blocks" / "10K.json").read_text()
    assert a == committed, "committed data/blocks/10K.json differs from processing the raw cache"


def test_comps_twice_identical():
    snap = json.loads((Path(__file__).parent / "fixtures" / "ward5_sales_2026-09-26.json").read_text())
    assert dumps(comps_file(snap)) == dumps(comps_file(json.loads(json.dumps(snap))))
    assert summarize(snap) == summarize(snap)
