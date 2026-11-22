"""s57_reader.py - the S-57 cell reader (s57.py), on cells this suite builds byte by byte. Hermetic: no network, no
NOAA file, no console.

WHY BUILT HERE. A real cell exercises what the cell happens to hold; one written here holds each rule the reader must
keep, and nothing else: an edge stored the other way, a ring's edges listed out of order, a hole, two outer rings,
a sounding cluster's depths, the corrections (a moved buoy, a deleted attribute, an inserted pointer, a new object,
a deleted one), a gap in the corrections, an update issued after a day, a ring that does not close. The writer below
encodes ISO 8211 independently of the reader's decoder - its field formats are typed out here, not parsed by s57.py
- so a decoder fault cannot be mirrored by the writer and pass.

The comparison with NOAA's real cells against the console's cached ENCDirect answers is tools/s57_match.py.
"""
import json
import os
import sys


def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)
import s57                                                     # noqa: E402

fails = 0
ran = 0


def check(name, cond, detail=""):
    global fails, ran
    ran += 1
    try:
        ok = bool(cond()) if callable(cond) else bool(cond)
        if callable(detail):
            detail = detail()
    except Exception as e:
        ok = False
        detail = "threw %s: %s" % (type(e).__name__, e)
    print(("  ok   " if ok else "  FAIL ") + name + ("   [" + str(detail) + "]" if detail else ""))
    if not ok:
        fails += 1


sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from s57_writer import _field, _name, COMF, SOMF, CAT, OBJL, ATTL, W, edge_ptr, node_ptr, zipped  # noqa: E402


# ── the base cell ───────────────────────────────────────────────────────────────────────────────────────────────────
INFORM_LONG = "Precautionary area: " + "x" * 280
base = W()
base.node(1, -70.0, 43.0)                                                       # a buoy
base.node(2, 0, 0, cluster=[(-70.01, 43.01, 5.2), (-70.02, 43.02, 7.0), (-70.03, 43.03, 12.4)])
for rid, lo, la in ((10, -70.1, 43.1), (11, -70.1, 43.2), (12, -70.0, 43.2), (13, -70.0, 43.1),
                    (14, -70.06, 43.14), (15, -70.04, 43.14), (16, -70.05, 43.16),
                    (30, -69.5, 43.0), (31, -69.4, 43.0), (32, -69.45, 43.1),
                    (33, -69.0, 43.0), (34, -68.8, 43.0), (35, -68.9, 43.2),
                    (36, -68.92, 43.05), (37, -68.88, 43.05), (38, -68.9, 43.1)):
    base.node(rid, lo, la, rcnm=120)
base.edge(20, 10, 11, [(-70.11, 43.15)])         # 10 -> 11, a bend on the way
base.edge(21, 11, 12, [])
base.edge(22, 13, 12, [(-69.99, 43.15)])          # stored 13 -> 12: the square runs it 12 -> 13 (ORNT 2)
base.edge(23, 13, 10, [])
base.edge(24, 14, 15, [])
base.edge(25, 15, 16, [])
base.edge(26, 16, 14, [])
for rid, a, b in ((40, 30, 31), (41, 31, 32), (42, 32, 30), (43, 33, 34), (44, 34, 35), (45, 35, 33),
                  (46, 36, 37), (47, 37, 38), (48, 38, 36)):
    base.edge(rid, a, b, [])
base.feature(100, "BOYLAT", 1, {"CATLAM": "1", "COLOUR": "3", "OBJNAM": "Test Buoy 1"}, [node_ptr(1)])
base.feature(101, "SOUNDG", 1, {"QUASOU": "1", "EXPSOU": "2"}, [node_ptr(2)])
# the square's edges OUT OF ORDER, one reversed; the hole after them (USAG 2)
base.feature(102, "DEPARE", 3, {"DRVAL1": "2.5", "DRVAL2": "5"},
             [edge_ptr(22, 2), edge_ptr(20), edge_ptr(23), edge_ptr(21),
              edge_ptr(24, 1, 2), edge_ptr(25, 1, 2), edge_ptr(26, 1, 2)])
base.feature(103, "COALNE", 2, None, [edge_ptr(20), edge_ptr(21)])
base.feature(104, "COALNE", 2, None, [edge_ptr(22, 2)])
# two outer rings, the hole inside the SECOND
base.feature(105, "LNDARE", 3, None, [edge_ptr(40), edge_ptr(41), edge_ptr(42), edge_ptr(43), edge_ptr(44),
                                      edge_ptr(45), edge_ptr(46, 1, 2), edge_ptr(47, 1, 2), edge_ptr(48, 1, 2)])
base.feature(106, "DEPARE", 3, {"DRVAL1": "0"}, [edge_ptr(40), edge_ptr(41)])        # a ring that does not close
base.feature(107, "OBSTRN", 1, {"VALSOU": "4.2"}, [node_ptr(999)])                   # a point that is not there
base.feature(108, "SLCONS", 2, {"CATSLC": "4", "WATLEV": "2"}, [edge_ptr(21)])
base.feature(109, "SLCONS", 2, {"WATLEV": "2"}, [edge_ptr(23)])                       # no CATSLC
base.feature(110, "RESARE", 3, {"INFORM": INFORM_LONG, "OBJNAM": "Test Area"},
             [edge_ptr(40), edge_ptr(41), edge_ptr(42)])
base.feature(111, "M_COVR", 3, {"CATCOV": "1"}, [edge_ptr(43), edge_ptr(44), edge_ptr(45)])
base.feature(112, "LNDARE", 1, None, [node_ptr(1)], natf={"NOBJNM": "Île Test"})
base.feature(113, "BOYLAT", 1, {"COLOUR": ""}, [node_ptr(1)])                         # present with no value
base.feature(114, "WRECKS", 1, {"VALSOU": "3.2", "WATLEV": "3"}, [node_ptr(1)])          # no CATWRK
# the square again, edge 22 (stored 13 -> 12) with NO orientation said (ORNT 255): matched by its far end
base.feature(115, "DEPARE", 3, {"DRVAL1": "1"}, [edge_ptr(20), edge_ptr(21), edge_ptr(22, 255), edge_ptr(23)])
# a hole TOUCHING its exterior at node 10, its edges listed right after the exterior edge that ends there (23: 13 -> 10)
base.node(17, -70.08, 43.13, rcnm=120)
base.node(18, -70.07, 43.12, rcnm=120)
base.edge(27, 10, 17, [])
base.edge(28, 17, 18, [])
base.edge(29, 18, 10, [])
base.feature(116, "DEPARE", 3, {"DRVAL1": "1"}, [edge_ptr(23), edge_ptr(27, 1, 2), edge_ptr(28, 1, 2),
                                                 edge_ptr(29, 1, 2), edge_ptr(20), edge_ptr(21), edge_ptr(22, 2)])
# two triangles TOUCHING at node 70, the first ring's edge out of 70 stored the other way (ORNT 2): only the
# orientation tells which of the two edges leaving 70 is the first ring's - unread, the rings join in a figure eight
for rid, lo, la in ((70, -69.7, 43.3), (71, -69.8, 43.25), (72, -69.8, 43.35), (73, -69.6, 43.35), (74, -69.6, 43.25)):
    base.node(rid, lo, la, rcnm=120)
for rid, a, b in ((75, 71, 70), (76, 72, 70), (77, 72, 71), (78, 70, 73), (79, 73, 74), (80, 74, 70)):
    base.edge(rid, a, b, [])
base.feature(117, "DEPARE", 3, {"DRVAL1": "1"}, [edge_ptr(75), edge_ptr(76, 2), edge_ptr(77), edge_ptr(78),
                                                 edge_ptr(79), edge_ptr(80)])

# ── update 001 (issued 2026-02-01) ──────────────────────────────────────────────────────────────────────────────────
DELC = "\x7f"
up1 = W(name="US5TEST1.001", updn=1, isdt="20260201")
up1.raw([("VRID", _field("VRID", [(110, 1, 2, 3)])), ("SGCC", _field("SGCC", [(3, 1, 1)])),
         ("SG2D", _field("SG2D", [(round(43.0 * COMF), round(-70.0005 * COMF))]))])                # the buoy moved
up1.raw([("VRID", _field("VRID", [(130, 20, 2, 3)])), ("SGCC", _field("SGCC", [(3, 1, 1)])),
         ("SG2D", _field("SG2D", [(round(43.15 * COMF), round(-70.12 * COMF))]))])                  # the bend moved
up1.raw([("FRID", _field("FRID", [(100, 100, 1, 2, OBJL["BOYLAT"], 2, 3)])),
         ("ATTF", _field("ATTF", [(ATTL["COLOUR"], "4"), (ATTL["OBJNAM"], DELC)]))])                # recolored, unnamed
up1.feature(120, "LIGHTS", 1, {"COLOUR": "1"}, [node_ptr(1)])                                        # a new light
up1.raw([("FRID", _field("FRID", [(100, 104, 2, 2, OBJL["COALNE"], 2, 2)]))])                       # a line deleted
up1.raw([("FRID", _field("FRID", [(100, 103, 2, 2, OBJL["COALNE"], 2, 3)])),                        # a pointer inserted
         ("FSPC", _field("FSPC", [(1, 3, 1)])), ("FSPT", _field("FSPT", [(_name(130, 22), 2, 255, 255)]))])

# ── update 002 (issued 2026-03-01) ──────────────────────────────────────────────────────────────────────────────────
up2 = W(name="US5TEST1.002", updn=2, isdt="20260301")
up2.raw([("FRID", _field("FRID", [(100, 120, 1, 2, OBJL["LIGHTS"], 2, 2)]))])                       # the light gone
up2.raw([("FRID", _field("FRID", [(100, 102, 3, 2, OBJL["DEPARE"], 2, 3)])),
         ("ATTF", _field("ATTF", [(ATTL["DRVAL1"], "3")]))])

B0, B1, B2 = base.bytes(), up1.bytes(), up2.bytes()


ZIP = zipped({"ENC_ROOT/CATALOG.031": b"not a cell", "ENC_ROOT/US5TEST1/US5TEST1.000": B0,
              "ENC_ROOT/US5TEST1/US5TEST1.001": B1, "ENC_ROOT/US5TEST1/US5TEST1.002": B2,
              "ENC_ROOT/US5TEST1/US5TEST1.TXT": b"notes"})


def _raises(fn, kind=s57.S57Error):
    try:
        fn()
    except kind:
        return True
    return False


def by_rcid(cell):
    return {f["rcid"]: f for f in cell.features_out()}


def close(a, b, tol=1e-9):
    return all(abs(x - y) <= tol for x, y in zip(a, b)) and len(a) == len(b)


# ── 1. ISO 8211 ─────────────────────────────────────────────────────────────────────────────────────────────────────
print("1. ISO 8211")
check("1a. a format list expands repeat counts and groups: (b11,2b12,A(3),2(b11,A))",
      lambda: s57._parse_formats("(b11,2b12,A(3),2(b11,A))") ==
      [("b", False, 1), ("b", False, 2), ("b", False, 2), ("A", 3), ("b", False, 1), ("A", None), ("b", False, 1), ("A", None)])
check("1b. b24 is a signed four-byte integer, B(40) a five-byte bit field",
      lambda: s57._parse_formats("(b24,B(40))") == [("b", True, 4), ("B", 5)])
check("1c. a file too short to be ISO 8211 is refused, not read as empty",
      lambda: _raises(lambda: s57.read_zip(zipped({"X/US5BAD.000": b"0012"}))))


# ── 2. the base cell ────────────────────────────────────────────────────────────────────────────────────────────────
print("2. the base cell")
c0 = s57.read_zip(ZIP, through=0)
f0 = by_rcid(c0)
check("2a. the dataset's name and its scale factors are read (DSNM; COMF and SOMF NOT NOAA's 1e7 and 10, so a reader "
      "that assumed them would put every point and depth wrong)",
      lambda: (c0.name, c0.comf, c0.somf) == ("US5TEST1.000", COMF, SOMF), lambda: (c0.name, c0.comf, c0.somf))
check("2b. a buoy is a Point at its node, its class and attributes by the catalog's acronyms",
      lambda: f0[100]["acronym"] == "BOYLAT" and f0[100]["geometry"] == {"type": "Point", "coordinates": [-70.0, 43.0]}
      and f0[100]["attrs"] == {"CATLAM": "1", "COLOUR": "3", "OBJNAM": "Test Buoy 1"}, lambda: f0[100])
check("2c. a sounding cluster is a MultiPoint, each with its depth (VE3D / SOMF) as the third coordinate",
      lambda: f0[101]["geometry"]["type"] == "MultiPoint" and
      [p[2] for p in f0[101]["geometry"]["coordinates"]] == [5.2, 7.0, 12.4], lambda: f0[101]["geometry"])
sq = f0[102]["geometry"]
SQUARE = {(-70.1, 43.1), (-70.11, 43.15), (-70.1, 43.2), (-70.0, 43.2), (-69.99, 43.15), (-70.0, 43.1)}
check("2d. an area's edges listed OUT OF ORDER, one stored the other way, assemble into one closed ring of its points",
      lambda: sq["type"] == "Polygon" and sq["coordinates"][0][0] == sq["coordinates"][0][-1]
      and {tuple(p) for p in sq["coordinates"][0]} == SQUARE and len(sq["coordinates"][0]) == 7, lambda: sq)
check("2e. its hole (USAG 2) is its own ring, after the exterior",
      lambda: len(sq["coordinates"]) == 2 and {tuple(p) for p in sq["coordinates"][1]} ==
      {(-70.06, 43.14), (-70.04, 43.14), (-70.05, 43.16)}, lambda: sq["coordinates"][1:])
check("2f. GeoJSON's winding: the exterior counter-clockwise, the hole clockwise (how ENCDirect serves every ring)",
      lambda: s57._ring_area2(sq["coordinates"][0]) > 0 and s57._ring_area2(sq["coordinates"][1]) < 0)
check("2g. a line is its edges joined end to end, the shared node once: 10 -> bend -> 11 -> 12",
      lambda: f0[103]["geometry"] == {"type": "LineString",
                                       "coordinates": [[-70.1, 43.1], [-70.11, 43.15], [-70.1, 43.2], [-70.0, 43.2]]},
      lambda: f0[103]["geometry"])
check("2h. an edge used with ORNT 2 runs end to beginning (13 -> 12 stored, 12 -> 13 drawn)",
      lambda: f0[104]["geometry"]["coordinates"] == [[-70.0, 43.2], [-69.99, 43.15], [-70.0, 43.1]],
      lambda: f0[104]["geometry"])
lnd = f0[105]["geometry"]
check("2i. two outer rings are a MultiPolygon, and the hole goes to the ring that holds it (the second)",
      lambda: lnd["type"] == "MultiPolygon" and len(lnd["coordinates"]) == 2 and len(lnd["coordinates"][0]) == 1
      and len(lnd["coordinates"][1]) == 2 and {round(p[0], 2) for p in lnd["coordinates"][1][1]} == {-68.92, -68.88, -68.9},
      lambda: lnd)
check("2p. a ring edge given with no orientation (ORNT null) is matched by its far end and the ring still closes",
      lambda: {tuple(p) for p in f0[115]["geometry"]["coordinates"][0]} == SQUARE, lambda: f0[115]["geometry"])
check("2q. a hole TOUCHING its exterior at a node stays a hole - the exterior is not stitched through it into a slit",
      lambda: f0[116]["geometry"]["type"] == "Polygon" and len(f0[116]["geometry"]["coordinates"]) == 2
      and {tuple(p) for p in f0[116]["geometry"]["coordinates"][0]} == SQUARE
      and {tuple(p) for p in f0[116]["geometry"]["coordinates"][1]} == {(-70.1, 43.1), (-70.08, 43.13), (-70.07, 43.12)},
      lambda: f0[116]["geometry"])
check("2r. two rings touching at a node stay two polygons: an ORNT 2 edge is read the way the area runs it, so the "
      "first ring takes its own edge out of the shared node, not the second ring's",
      lambda: f0[117]["geometry"]["type"] == "MultiPolygon" and len(f0[117]["geometry"]["coordinates"]) == 2
      and sorted(sorted({tuple(p) for p in poly[0]}) for poly in f0[117]["geometry"]["coordinates"])
      == sorted([sorted({(-69.7, 43.3), (-69.8, 43.25), (-69.8, 43.35)}),
                 sorted({(-69.7, 43.3), (-69.6, 43.35), (-69.6, 43.25)})]),
      lambda: f0[117]["geometry"])
check("2j. a ring that does not close is NO geometry, and said - never a polygon drawn across the gap",
      lambda: f0[106]["geometry"] is None and any("106" in p and "close" in p for p in c0.problems), lambda: c0.problems)
check("2k. a point whose node is missing is no geometry, and said",
      lambda: f0[107]["geometry"] is None and any("107" in p and "missing" in p for p in c0.problems), lambda: c0.problems)
check("2l. a national attribute (NATF, UCS-2) reads as its text",
      lambda: f0[112]["attrs"].get("NOBJNM") == "Île Test", lambda: f0[112]["attrs"])
check("2m. the exchange set's CATALOG.031 and text files are not taken for a cell",
      lambda: c0.name == "US5TEST1.000")
check("2n. a zip of two cells is refused, naming both - not one of them picked",
      lambda: _raises(lambda: s57.read_zip(zipped({"A/US5AAA.000": B0, "B/US5BBB.000": B0}))))
check("2o. ... and reads the one asked for", lambda: s57.read_zip(zipped({"A/US5AAA.000": B0, "B/US5BBB.000": B0}),
                                                                 cell="US5BBB").name == "US5TEST1.000")

# ── 3. the corrections ──────────────────────────────────────────────────────────────────────────────────────────────
print("3. the corrections")
c1 = s57.read_zip(ZIP, through=1)
f1 = by_rcid(c1)
check("3a. update 1 MOVES the buoy (its node's coordinate replaced, SGCC)",
      lambda: close(f1[100]["geometry"]["coordinates"], [-70.0005, 43.0]), lambda: f1[100]["geometry"])
check("3b. ... recolors it (ATTF modified) and deletes its name (the DEL value), leaving the rest",
      lambda: f1[100]["attrs"] == {"CATLAM": "1", "COLOUR": "4"}, lambda: f1[100]["attrs"])
check("3c. ... moves the bend of edge 20, and every object drawn on it moves with it (the area and the line)",
      lambda: [-70.12, 43.15] in f1[103]["geometry"]["coordinates"] and
      (-70.12, 43.15) in {tuple(p) for p in f1[102]["geometry"]["coordinates"][0]}, lambda: f1[103]["geometry"])
check("3d. ... inserts a new object (a light on the buoy's node)",
      lambda: f1.get(120, {}).get("acronym") == "LIGHTS" and close(f1[120]["geometry"]["coordinates"], [-70.0005, 43.0]))
check("3e. ... deletes an object (the second coastline)", lambda: 104 not in f1 and 104 in f0)
check("3f. ... inserts a pointer at an index (FSPC): the first coastline runs on to node 13",
      lambda: f1[103]["geometry"]["coordinates"][-2:] == [[-69.99, 43.15], [-70.0, 43.1]], lambda: f1[103]["geometry"])
c2 = s57.read_zip(ZIP)
f2 = by_rcid(c2)
check("3g. update 2 deletes the light and modifies the depth area: the cell is base + EVERY update, in order",
      lambda: 120 not in f2 and f2[102]["attrs"]["DRVAL1"] == "3" and c2.updates_applied == [1, 2],
      lambda: (sorted(f2), c2.updates_applied))
check("3h. updates given out of order are applied in number order",
      lambda: s57.read_zip(zipped({"X/US5TEST1.002": B2, "X/US5TEST1.000": B0, "X/US5TEST1.001": B1}))
      .updates_applied == [1, 2])
check("3i. a GAP in the updates (.000 and .002) is refused: a cell missing a correction is not the published chart",
      lambda: _raises(lambda: s57.read_zip(zipped({"X/US5TEST1.000": B0, "X/US5TEST1.002": B2}))))
ci = s57.read_zip(ZIP, issued_by="20260215")
check("3j. issued_by: the cell as it stood on a day - update 1 (Feb 1) applied, update 2 (Mar 1) withheld and named",
      lambda: ci.updates_applied == [1] and ci.updates_withheld == [2], lambda: (ci.updates_applied, ci.updates_withheld))
check("3m. ... and an update issued ON the day is applied (the day's chart includes its own corrections)",
      lambda: s57.read_zip(ZIP, issued_by="20260201").updates_applied == [1])
check("3k. through=0 withholds every update", lambda: c0.updates_applied == [] and c0.updates_withheld == [1, 2])
check("3l. an update deleting an object that is not there is said, not silent",
      lambda: any("not there" in p for p in s57.Cell().read_base(B0).apply_update(B2, 2).problems))

# ── 4. ENCDirect's shape ────────────────────────────────────────────────────────────────────────────────────────────
print("4. ENCDirect's shape")
LAYERS = json.load(open(os.path.join(APP, "tests", "fixtures", "enc_layer_maps.json"), encoding="utf-8"))["bands"]
H = LAYERS["enc_harbour"]
check("4a. a layer is the class's catalog name with its primitive: Buoy_Lateral_point, Shoreline_Construction_line",
      lambda: (s57.encdirect_class("BOYLAT", 1, H), s57.encdirect_class("SLCONS", 2, H)) ==
      ("Buoy_Lateral_point", "Shoreline_Construction_line"))
check("4b. ... not doubled where the name ends in the primitive (Depth_Area, Navigation_Line), and the line form apart",
      lambda: (s57.encdirect_class("DEPARE", 3, H), s57.encdirect_class("DEPARE", 2, H),
               s57.encdirect_class("NAVLNE", 2, H)) == ("Depth_Area", "Depth_Area_line", "Navigation_Line"))
check("4c. RESTRICTED AREA per band: Restricted_Area_area in the harbor band, Restricted_Area in the coastal one",
      lambda: (s57.encdirect_class("RESARE", 3, H), s57.encdirect_class("RESARE", 3, LAYERS["enc_coastal"])) ==
      ("Restricted_Area_area", "Restricted_Area"))
check("4d. NOAA's own spellings (the exceptions): Traffice_Separation_Line, Underwater_Awash_Rock_point, Build_Up_Area",
      lambda: (s57.encdirect_class("TSELNE", 2, H), s57.encdirect_class("UWTROC", 1, H),
               s57.encdirect_class("BUAARE", 3, LAYERS["enc_general"])) ==
      ("Traffice_Separation_Line", "Underwater_Awash_Rock_point", "Build_Up_Area"))
check("4e. a class the band publishes no layer for gets none (PONTON in the harbor band) - and the coastal band's does",
      lambda: (s57.encdirect_class("PONTON", 3, H), s57.encdirect_class("PONTON", 2, LAYERS["enc_coastal"])) ==
      (None, "Pontoon_line"))


def _layer_audit():
    """Every published layer of every band is reached by exactly one S-57 class and primitive (the IHO classes - the
    lower-case acronyms are Inland ENC's), but the one NOAA name two classes share."""
    bad = []
    std = [(acr, p) for code, (acr, nm, prims) in CAT["objl"].items() if acr == acr.upper()
           for p in (1, 2, 3)]
    for band, layers in LAYERS.items():
        got = {}
        for acr, p in std:
            L = s57.encdirect_class(acr, p, layers)
            if L:
                got.setdefault(L, []).append((acr, p))
        for L in layers:
            n = len(got.get(L, []))
            if n != 1 and not (L == "Tidal_Stream_Time_Series_point" and n == 2):
                bad.append((band, L, got.get(L)))
    return bad


check("4u. a band publishing BOTH forms of a name (X_Area and X_Area_area) gets neither: refused and counted, never guessed",
      lambda: s57.encdirect_class("RESARE", 3, {"Restricted_Area", "Restricted_Area_area"}) is None)
check("4f. EVERY layer of all six bands (798) is reached by exactly one class and primitive",
      lambda: not _layer_audit(), lambda: _layer_audit()[:6])
check("4g. values in ENCDirect's types: DRVAL1 a number, CATLAM a whole number, COLOUR the cell's text",
      lambda: (s57.encdirect_value("DRVAL1", "2.5"), s57.encdirect_value("CATLAM", "1"),
               s57.encdirect_value("COLOUR", "1,3")) == (2.5, 1, "1,3"))
check("4h. an unreadable number is absent, never its text (the rule _enc_keep_props keeps)",
      lambda: s57.encdirect_value("VALSOU", "abc") is None and s57.encdirect_value("CATLAM", "x") is None)
check("4i. a value present but empty is absent (ENCDirect serves a Nome beacon's empty COLOUR as none)",
      lambda: s57.encdirect_value("COLOUR", "") is None and s57.encdirect_value("VALSOU", " ") is None)
feats, left = s57.encdirect_features(c2, H)
byc = {}
for ft in feats:
    byc.setdefault(ft["cls"], []).append(ft)
check("4j. a sounding cluster is served one Sounding_point a sounding, the depth its third coordinate",
      lambda: sorted(ft["geometry"]["coordinates"][2] for ft in byc["Sounding_point"]) == [5.2, 7.0, 12.4],
      lambda: byc.get("Sounding_point"))
check("4k. every feature carries the cell's name as DSNM (the coverage read keys on it)",
      lambda: all(ft["properties"].get("DSNM") == "US5TEST1.000" for ft in feats))
check("4l. an object with no geometry or no layer is left out AND counted (the closing-less ring, the missing point)",
      lambda: left.get(("DEPARE", 3)) == 1 and left.get(("OBSTRN", 1)) == 1, lambda: left)

E = {ft["properties"].get("OBJNAM") or (ft["cls"], i): ft for i, ft in enumerate(feats)}
slc = [ft for ft in feats if ft["cls"] == "Shoreline_Construction_line"]
check("4m. ENCDirect's own words for a meaning: CATSLC 4 is \"pier\" (the catalog's \"pier ( jetty)\")",
      lambda: [ft["properties"].get("CATSLC") for ft in slc if ft["properties"].get("CATSLC") != " "] == ["pier"],
      lambda: [ft["properties"] for ft in slc])
check("4n. a meaning-valued attribute the class CARRIES and the object leaves out is served \" \" (the pier line with no "
      "CATSLC) - on a harbor facility with no CATHAF, absent would read as a marina to speedzones.js where "
      "ENCDirect's blank never did",
      lambda: sorted(ft["properties"].get("CATSLC") for ft in slc) == [" ", "pier"], lambda: [ft["properties"] for ft in slc])
check("4o. ... and never added to a class that does not carry it (a buoy gets no CATSLC, no CATREA)",
      lambda: all("CATSLC" not in ft["properties"] and "CATREA" not in ft["properties"]
                  for ft in feats if ft["cls"] == "Buoy_Lateral_point"))
check("4p. a wreck with no CATWRK is served CATWRK '\" \"' (its own blank, as ENCDirect serves it)",
      lambda: [ft["properties"].get("CATWRK") for ft in feats if ft["cls"] == "Wreck_point"] == ['" "'])
check("4q. INFORM is cut at 254 characters, as ENCDirect's field holds it",
      lambda: E["Test Area"]["properties"]["INFORM"] == INFORM_LONG[:254], lambda: len(E["Test Area"]["properties"]["INFORM"]))
check("4r. a sounding carries no attribute but the cell's name (ENCDirect's soundings carry none)",
      lambda: all(ft["properties"] == {"DSNM": "US5TEST1.000"} for ft in byc["Sounding_point"]))
check("4s. the catalog's own words when asked for (wording=None): \"pier ( jetty)\"",
      lambda: s57.encdirect_value("CATSLC", "4", None) == "pier ( jetty)" and s57.encdirect_value("CATSLC", "4") == "pier")
check("4t. a list of codes is each code's meaning, in order (CATREA 9,23)",
      lambda: s57.encdirect_value("CATREA", "9,23") == "military area,ecological reserve",
      lambda: s57.encdirect_value("CATREA", "9,23"))

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
