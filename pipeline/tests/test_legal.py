from pipeline.legal import addr_display, normalize_street, parse_legal1, pin_lot, split_address


def test_robb_plan_lot_67():
    d = parse_legal1("ROBT ROBB PLAN 67 LOT 24X100 MAHON ST BET KIRKP")
    assert d["plan"] == "Robt Robb Plan"
    assert d["plan_lot"] == "67"
    assert (d["front"], d["depth"]) == (24, 100)
    assert d["part"] is False
    assert d["parsed_from"] == "LEGAL1"


def test_part_lot_64():
    d = parse_legal1("ROBERT ROBB TR PLAN PT 64 LOT 24X100")
    assert d["plan"] == "Robert Robb Tr Plan"
    assert d["plan_lot"] == "64"
    assert d["part"] is True
    assert (d["front"], d["depth"]) == (24, 100)


def test_missing_plan_lot_is_never_inferred():
    d = parse_legal1("LOT 24X100 MAHON ST                             ")
    assert d["plan"] is None
    assert d["plan_lot"] is None
    assert (d["front"], d["depth"]) == (24, 100)


def test_lot_28_24x62():
    d = parse_legal1("ROBERT ROBB TR PLAN PT 70 LOT 24X62 MAHON ST    ")
    assert d["plan_lot"] == "70"
    assert d["part"] is True
    assert (d["front"], d["depth"]) == (24, 62)


def test_no_dimensions_means_no_deed():
    assert parse_legal1("ROBT ROBB PLAN 67 MAHON ST") is None
    assert parse_legal1("") is None
    assert parse_legal1(None) is None


def test_other_block_forms():
    d = parse_legal1("J D MAHON PLAN 79-80-81 LOT 72X100 IN ALL MAHON")
    assert d["plan_lot"] == "79-80-81" and (d["front"], d["depth"]) == (72, 100)
    d = parse_legal1("MAHON PLAN PT 77 LOT 24X54.39 MAHON ST")
    assert d["plan_lot"] == "77" and d["part"] and d["depth"] == 54.39
    d = parse_legal1("MAHON PLAN PT 28  ALL 27 LOT = 31.89X100X32.38")
    assert d["plan_lot"] == "PT 28 ALL 27" and d["front"] == 31.89 and d["dims"] == "31.89X100X32.38"
    d = parse_legal1("PT VACATED UNNAMED ALLEY = 5 X 100 X 5 X 100")
    assert d["plan"] is None and d["part"] is True and (d["front"], d["depth"]) == (5, 100)


def test_pin_lot():
    assert pin_lot("0010K00025000000") == (25, None)
    assert pin_lot("0010K00028000A00") == (28, "A")
    assert pin_lot("0010K00035000A00") == (35, "A")


def test_addresses():
    assert addr_display("0", "MAHON ST") == "Mahon St (no number)"
    assert addr_display("", "HUMBER WAY") == "Humber Way (no number)"
    assert addr_display("2241", "MAHON ST") == "2241 Mahon St"
    assert split_address("2245  MAHON ST") == ("2245", "MAHON ST")
    assert normalize_street("MAHON ST") == "Mahon Street"
    assert normalize_street("WYLIE AV") == "Wylie Avenue"
    assert normalize_street("HUMBER WAY") == "Humber Way"
