"""s57_reader.py - the S-57 cell reader (s57.py), on cells this suite builds byte by byte. Hermetic: no network, no
NOAA file, no console.

WHY BUILT HERE. A real cell exercises what the cell happens to hold; one written here holds each rule the reader must
keep, and nothing else: an edge stored the other way, a ring's edges listed out of order, a hole, two outer rings,
a sounding cluster's depths, the corrections (a moved buoy, a deleted attribute, an inserted pointer, a new object,
a deleted one; in a second cell a coordinate and a pointer deleted from the middle, an edge's node moved, a
national and a vector attribute corrected, an object pointer inserted), a boundary at the data limit, a gap in the
corrections, an update issued after a day, a ring that does not close; a pond on an island in a lake, a hole
touching its own ring with another listed first, a re-issued base, a node an update deleted, a code the catalog
does not hold, a national attribute at NOAA's lexical level (1). The writer
(tests/lib/s57_writer.py)
encodes ISO 8211 independently of the reader's decoder - its field formats are typed out there, not parsed by s57.py
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


# Holes in an area of more than one outer ring (review fix 12), a cell of their own
def ring_of(w, nodes, e0):
    """Nodes [(rcid, lon, lat)] as a closed ring of edges e0, e0 + 1, ...; the edge ids."""
    for rid, lo, la in nodes:
        w.node(rid, lo, la, rcnm=120)
    for i in range(len(nodes)):
        w.edge(e0 + i, nodes[i][0], nodes[(i + 1) % len(nodes)][0], [])
    return list(range(e0, e0 + len(nodes)))


def covered(geom, x, y):
    """Is the point the area's: inside an outer ring and none of that ring's holes (how the console reads one)?"""
    polys = [geom["coordinates"]] if geom["type"] == "Polygon" else geom["coordinates"]
    return any(s57._in_ring(p[0], x, y) and not any(s57._in_ring(h, x, y) for h in p[1:]) for p in polys)


hw = W(name="US5TEST3.000")
OA = ring_of(hw, [(1, -70.0, 43.0), (2, -70.0, 43.4), (3, -69.6, 43.4), (4, -69.6, 43.0)], 100)       # an outer ring
LK = ring_of(hw, [(5, -69.9, 43.1), (6, -69.7, 43.1), (7, -69.7, 43.3), (8, -69.9, 43.3)], 110)       # its lake
IS = ring_of(hw, [(9, -69.85, 43.15), (10, -69.85, 43.25), (11, -69.75, 43.25), (12, -69.75, 43.15)], 120)  # an island
PD = ring_of(hw, [(13, -69.82, 43.18), (14, -69.78, 43.18), (15, -69.80, 43.22)], 130)                # its pond
hw.feature(300, "DEPARE", 3, {"DRVAL1": "10", "DRVAL2": "20"}, [edge_ptr(e) for e in OA + IS] +
           [edge_ptr(e, 1, 2) for e in LK + PD])
A2 = ring_of(hw, [(20, -71.0, 43.0), (21, -71.0, 43.2), (22, -70.8, 43.2), (23, -70.8, 43.0)], 200)  # listed first
for rid, lo, la in ((30, -70.4, 43.1), (31, -70.4, 43.0), (32, -70.6, 43.0), (33, -70.6, 43.2), (34, -70.4, 43.2),
                    (35, -70.5, 43.14), (36, -70.5, 43.08)):
    hw.node(rid, lo, la, rcnm=120)
for eid, a, b in ((210, 30, 31), (211, 31, 32), (212, 32, 33), (213, 33, 34), (214, 34, 30),       # B2, node 30 east
                  (220, 30, 35), (221, 35, 36), (222, 36, 30)):                                   # its hole, from 30
    hw.edge(eid, a, b, [])
hw.feature(301, "DEPARE", 3, {"DRVAL1": "10", "DRVAL2": "20"},
           [edge_ptr(e) for e in A2 + [210, 211, 212, 213, 214]] + [edge_ptr(e, 1, 2) for e in (220, 221, 222)])
LONE = ring_of(hw, [(40, -72.0, 43.0), (41, -71.9, 43.1), (42, -71.8, 43.0)], 240)                    # a hole off alone
hw.feature(302, "DEPARE", 3, {"DRVAL1": "10", "DRVAL2": "20"},
           [edge_ptr(e) for e in A2 + [210, 211, 212, 213, 214]] + [edge_ptr(e, 1, 2) for e in LONE])
ch = s57.Cell().read_base(hw.bytes())
fh = by_rcid(ch)
POND = ((-69.82 - 69.78 - 69.80) / 3, (43.18 + 43.18 + 43.22) / 3)
B2_HOLE = ((-70.4 - 70.5 - 70.5) / 3, (43.1 + 43.08 + 43.14) / 3)
check("2s. a hole goes to the INNERMOST outer ring that holds it: the pond on an island in a lake is the island's, so "
      "the pond is not the area's water - the outer ring, listed first, holds it too, and took it",
      lambda: fh[300]["geometry"]["type"] == "MultiPolygon" and not covered(fh[300]["geometry"], *POND)
              and covered(fh[300]["geometry"], -69.84, 43.16) and not covered(fh[300]["geometry"], -69.88, 43.12),
      lambda: [len(p) for p in fh[300]["geometry"]["coordinates"]])
check("2t. a hole TOUCHING its outer ring at its first vertex goes to that ring, not to the first listed: its water is "
      "not the area's (the touching vertex was the test, and the fallback the first ring)",
      lambda: not covered(fh[301]["geometry"], *B2_HOLE) and covered(fh[301]["geometry"], -70.55, 43.05)
              and [len(p) for p in fh[301]["geometry"]["coordinates"]] == [1, 2],
      lambda: [len(p) for p in fh[301]["geometry"]["coordinates"]])
check("2u. a hole no outer ring holds is said",
      lambda: any("302" in p and "no outer ring" in p for p in ch.problems)
              and not any("300" in p or "301" in p for p in ch.problems), lambda: ch.problems)
check("2j. a ring that does not close is NO geometry, and said - never a polygon drawn across the gap",
      lambda: f0[106]["geometry"] is None and any("106" in p and "close" in p for p in c0.problems), lambda: c0.problems)
check("2k. a point whose node is missing is no geometry, and said",
      lambda: f0[107]["geometry"] is None and any("107" in p and "missing" in p for p in c0.problems), lambda: c0.problems)
def deleted(rcnm, rcid):
    """The base with one vector deleted by an update, read: (cell, features by rcid)."""
    u = W(name="US5TEST1.009", updn=9, isdt="20260901")
    u.raw([("VRID", _field("VRID", [(rcnm, rcid, 2, 2)]))])
    c = s57.Cell().read_base(B0).apply_update(u.bytes(), 9)
    return c, by_rcid(c)


cdn, fdn = deleted(120, 12)                     # node 12: the slipway 108's edge 21 ends there, the square 102's 22 too
cde, fde = deleted(130, 24)                     # edge 24 (a side of 102's hole, used by nothing else)
check("2v. what is missing is said as what it is: a NODE an update deleted is that node of its edge, not the edge "
      "(it was said as the edge, which is there) - a line's and an area's - and an edge deleted is the edge",
      lambda: fdn[108]["geometry"] is None and "feature 108: node (120, 12) of edge (130, 21) missing" in cdn.problems
              and fdn[102]["geometry"] is None and "feature 102: node (120, 12) of edge (130, 22) missing" in cdn.problems
              and fde[102]["geometry"] is None and "feature 102: edge (130, 24) missing" in cde.problems,
      lambda: (cdn.problems, cde.problems))
check("2l. a national attribute (NATF, UCS-2) reads as its text",
      lambda: f0[112]["attrs"].get("NOBJNM") == "Île Test", lambda: f0[112]["attrs"])
# NATF at lexical level 1, NOAA's own form (its field control "-A "), corrected by a level-1 update; and level 2 holding
# what Latin-1 cannot. The reader read NATF as UCS-2 always: NOAA's "Continuing use." came out as CJK.
n1 = W(name="US5TEST3.000", nall=1)
n1.node(1, -70.0, 43.0)
n1.feature(1, "LNDARE", 1, None, [node_ptr(1)], natf={"NINFOM": "Continuing use.", "NOBJNM": "Île Basse"})
n1u = W(name="US5TEST3.001", updn=1, isdt="20260401", nall=1)
n1u.raw([("FRID", _field("FRID", [(100, 1, 1, 2, OBJL["LNDARE"], 2, 3)])),
         ("NATF", _field("NATF", [(ATTL["NOBJNM"], "Île Haute"), (ATTL["NINFOM"], DELC)], 1))])
n2 = W(name="US5TEST4.000", nall=2)
n2.node(1, -70.0, 43.0)
n2.feature(1, "LNDARE", 1, None, [node_ptr(1)], natf={"NOBJNM": "Ōkawa"})
fn1 = by_rcid(s57.Cell().read_base(n1.bytes()))[1]["attrs"]
fn1u = by_rcid(s57.Cell().read_base(n1.bytes()).apply_update(n1u.bytes(), 1))[1]["attrs"]
fn2 = by_rcid(s57.Cell().read_base(n2.bytes()))[1]["attrs"]
check("2w. a national attribute is read at the LEXICAL LEVEL ITS FIELD CONTROL SAYS: level 1 (Latin-1, NOAA's form) as "
      "its text - \"Continuing use.\", not CJK - and a level-1 update replaces one and deletes one; level 2 (UCS-2) "
      "holds what Latin-1 cannot",
      lambda: fn1 == {"NINFOM": "Continuing use.", "NOBJNM": "Île Basse"} and fn1u == {"NOBJNM": "Île Haute"}
              and fn2 == {"NOBJNM": "Ōkawa"},
      lambda: ascii((fn1, fn1u, fn2)))                # ascii: a Windows console's code page has no O-macron
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

# A second cell, for the corrections the first does not make (the 2026-11-21 review: a delete taken one place late, an
# edge's node pointer, a boundary truncated at the data limit, a national attribute, a vector's attributes and an
# object pointer were each ignorable and the suite still passed). Each check names the cell before and after.
def lnam(rcid):
    return (550).to_bytes(2, "little") + int(rcid).to_bytes(4, "little") + (1).to_bytes(2, "little")


tb = W(name="US5TEST2.000")
for rid, lo, la in ((1, -70.0, 44.0), (2, -69.9, 44.0), (3, -69.9, 44.1), (4, -70.0, 44.1), (5, -69.8, 44.0)):
    tb.node(rid, lo, la, rcnm=120)
tb.raw([("VRID", _field("VRID", [(110, 6, 1, 1)])),                          # an isolated node, its position quality
        ("ATTV", _field("ATTV", [(ATTL["QUAPOS"], "4"), (ATTL["POSACC"], "10")])),
        ("SG2D", _field("SG2D", [(round(44.05 * COMF), round(-69.95 * COMF))]))])
tb.edge(10, 1, 2, [(-69.97, 43.99), (-69.95, 43.98), (-69.93, 43.99)])
tb.edge(11, 2, 3, [])
tb.edge(12, 3, 4, [])
tb.edge(13, 4, 1, [])
tb.edge(14, 2, 5, [])
tb.feature(200, "COALNE", 2, None, [edge_ptr(10)])
tb.feature(201, "COALNE", 2, None, [edge_ptr(11), edge_ptr(12), edge_ptr(13)])
tb.feature(202, "SLCONS", 2, {"WATLEV": "2"}, [edge_ptr(14)])
tb.feature(203, "DEPARE", 3, {"DRVAL1": "5"},                                # its west side the cell's data limit
           [edge_ptr(10), edge_ptr(11), edge_ptr(12), edge_ptr(13, 1, 3)])
tb.feature(204, "LNDARE", 1, None, [node_ptr(6)], natf={"NOBJNM": "Île Vieille", "NINFOM": "à retirer"})
tb.raw([("FRID", _field("FRID", [(100, 205, 255, 2, OBJL["C_AGGR"], 1, 1)])), ("FOID", _field("FOID", [(550, 205, 1)])),
        ("FFPT", _field("FFPT", [(lnam(200), 2, ""), (lnam(202), 2, "")]))])  # a collection of two
tu = W(name="US5TEST2.001", updn=1, isdt="20260401")
tu.raw([("VRID", _field("VRID", [(130, 10, 2, 3)])), ("SGCC", _field("SGCC", [(2, 2, 1)]))])       # a coordinate deleted
tu.raw([("FRID", _field("FRID", [(100, 201, 2, 2, OBJL["COALNE"], 2, 3)])),                        # a pointer deleted
        ("FSPC", _field("FSPC", [(2, 2, 1)]))])
tu.raw([("VRID", _field("VRID", [(130, 14, 2, 3)])), ("VRPC", _field("VRPC", [(3, 2, 1)])),        # its end node 5 -> 3
        ("VRPT", _field("VRPT", [(_name(120, 3), 255, 255, 2, 255)]))])
tu.raw([("FRID", _field("FRID", [(100, 204, 1, 2, OBJL["LNDARE"], 2, 3)])),                        # renamed, note gone
        ("NATF", _field("NATF", [(ATTL["NOBJNM"], "Île Neuve"), (ATTL["NINFOM"], DELC)]))])
tu.raw([("VRID", _field("VRID", [(110, 6, 2, 3)])),                                                # surveyed now
        ("ATTV", _field("ATTV", [(ATTL["QUAPOS"], "1"), (ATTL["POSACC"], DELC)]))])
tu.raw([("FRID", _field("FRID", [(100, 205, 255, 2, OBJL["C_AGGR"], 2, 3)])),                      # a member inserted
        ("FFPC", _field("FFPC", [(1, 2, 1)])), ("FFPT", _field("FFPT", [(lnam(201), 2, "")]))])
T0, T1 = tb.bytes(), tu.bytes()
ct0 = s57.Cell().read_base(T0)
ct1 = s57.Cell().read_base(T0).apply_update(T1, 1)
t0, t1 = by_rcid(ct0), by_rcid(ct1)
check("3n. an update DELETES a coordinate from the middle of an edge (SGCC 2): the one at its index goes, the rest stay",
      lambda: t0[200]["geometry"]["coordinates"] == [[-70.0, 44.0], [-69.97, 43.99], [-69.95, 43.98], [-69.93, 43.99],
                                                      [-69.9, 44.0]]
      and t1[200]["geometry"]["coordinates"] == [[-70.0, 44.0], [-69.97, 43.99], [-69.93, 43.99], [-69.9, 44.0]],
      lambda: (t0[200]["geometry"], t1[200]["geometry"]))
check("3o. an update deletes a pointer from the middle of a line (FSPC 2): the edge at its index goes, the line in two",
      lambda: t0[201]["geometry"]["coordinates"] == [[-69.9, 44.0], [-69.9, 44.1], [-70.0, 44.1], [-70.0, 44.0]]
      and t1[201]["geometry"] == {"type": "MultiLineString",
                                  "coordinates": [[[-69.9, 44.0], [-69.9, 44.1]], [[-70.0, 44.1], [-70.0, 44.0]]]},
      lambda: (t0[201]["geometry"], t1[201]["geometry"]))
check("3p. an update moves an edge's END to another node (VRPC): the object drawn on it runs to the new node",
      lambda: t0[202]["geometry"]["coordinates"] == [[-69.9, 44.0], [-69.8, 44.0]]
      and t1[202]["geometry"]["coordinates"] == [[-69.9, 44.0], [-69.9, 44.1]],
      lambda: (t0[202]["geometry"], t1[202]["geometry"]))
check("3q. an exterior edge truncated by the cell's data limit (USAG 3) is exterior: the ring closes with it, no hole "
      "is made of it",
      lambda: t0[203]["geometry"]["type"] == "Polygon" and len(t0[203]["geometry"]["coordinates"]) == 1
      and {(-70.0, 44.0), (-69.9, 44.0), (-69.9, 44.1), (-70.0, 44.1)} <= {tuple(p) for p in t0[203]["geometry"]["coordinates"][0]}
      and not any("203" in p for p in ct0.problems), lambda: (t0[203]["geometry"], ct0.problems))
check("3r. an update corrects a national attribute (NATF): the name replaced, a deleted one gone",
      lambda: t0[204]["attrs"] == {"NOBJNM": "Île Vieille", "NINFOM": "à retirer"}
      and t1[204]["attrs"] == {"NOBJNM": "Île Neuve"}, lambda: (t0[204]["attrs"], t1[204]["attrs"]))
# 3s and 3t are on the cell's own record: no answer the console reads carries a vector's attributes or an object's
# pointers to others yet, so the record is held as NOAA corrects it for the day one does.
check("3s. an update corrects a node's own attributes (ATTV): its position quality surveyed, its accuracy deleted",
      lambda: ct0.vectors[(110, 6)]["attv"] == {ATTL["QUAPOS"]: "4", ATTL["POSACC"]: "10"}
      and ct1.vectors[(110, 6)]["attv"] == {ATTL["QUAPOS"]: "1"},
      lambda: (ct0.vectors[(110, 6)]["attv"], ct1.vectors[(110, 6)]["attv"]))
check("3t. an update inserts an object pointer at an index (FFPC): the collection's new member second of three",
      lambda: [p[0] for p in ct0.features[205]["ffpt"]] == [lnam(200), lnam(202)]
      and [p[0] for p in ct1.features[205]["ffpt"]] == [lnam(200), lnam(201), lnam(202)],
      lambda: ([p[0].hex() for p in ct0.features[205]["ffpt"]], [p[0].hex() for p in ct1.features[205]["ffpt"]]))
check("3u. ... and the update read whole: nothing in it said as a problem",
      lambda: not ct1.problems and ct1.updates_applied == [1], lambda: (ct1.problems, ct1.updates_applied))


# A RE-ISSUED base (review fix 12): a .000 whose DSID UPDN is n holds every update through n; the run goes on at n + 1
def reissued(n):
    """The base re-issued at update n: a coastline of three edges, the third inserted by update 1."""
    w = W(name="US5TEST4.000", reissue=n)
    for rid, lo, la in ((10, -70.1, 43.1), (11, -70.1, 43.2), (12, -70.0, 43.2), (13, -70.0, 43.1)):
        w.node(rid, lo, la, rcnm=120)
    for eid, a, b in ((20, 10, 11), (21, 11, 12), (22, 12, 13)):
        w.edge(eid, a, b, [])
    w.feature(103, "COALNE", 2, {"OBJNAM": "Shore"}, [edge_ptr(20), edge_ptr(21), edge_ptr(22)], rver=n + 1)
    return w.bytes()


def up4(n, fields):
    u = W(name="US5TEST4.%03d" % n, updn=n, isdt="2026%02d01" % (n + 1))
    u.raw([("FRID", _field("FRID", [(100, 103, 2, 2, OBJL["COALNE"], n + 1, 3)]))] + fields)
    return u.bytes()


U4_1 = up4(1, [("FSPC", _field("FSPC", [(1, 3, 1)])), ("FSPT", _field("FSPT", [(_name(130, 22), 1, 255, 255)]))])
U4_3 = up4(3, [("ATTF", _field("ATTF", [(ATTL["OBJNAM"], "Shore 3")]))])                  # renamed
LINE3 = [[-70.1, 43.1], [-70.1, 43.2], [-70.0, 43.2], [-70.0, 43.1]]


def read4(files):
    try:
        c = s57.read_zip(zipped({"R/US5TEST4/US5TEST4.%03d" % n: b for n, b in files.items()}))
        return c, {f["rcid"]: f for f in c.features_out()}[103], None
    except s57.S57Error as e:
        return None, None, str(e)


r4a, f4a, e4a = read4({0: reissued(2), 3: U4_3})
r4b, f4b, e4b = read4({0: reissued(1), 1: U4_1})
r4c, f4c, e4c = read4({0: reissued(2), 4: U4_3})
check("3v. a RE-ISSUED base (its DSID UPDN 2) takes its next update, .003: it was refused as missing .001 and .002",
      lambda: e4a is None and r4a.updates_applied == [3] and f4a["attrs"].get("OBJNAM") == "Shore 3",
      lambda: e4a or (r4a.updates_applied, f4a["attrs"]))
check("3w. ... and an update the re-issued base already holds, still in the set, is NOT applied again: the pointer it "
      "inserts is there once - it was inserted twice, the line drawn in two parts",
      lambda: e4b is None and r4b.updates_applied == [] and f4b["geometry"] == {"type": "LineString", "coordinates": LINE3},
      lambda: e4b or (r4b.updates_applied, f4b["geometry"]))
check("3x. ... but a gap after a re-issued base is still refused, naming the base's update (.004 after a base at 2)",
      lambda: e4c is not None and "re-issued at update 002" in e4c, lambda: e4c)

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
check("4v. a code the catalog does not hold is ENCDirect's word where it has one: CATOBS 10 is \"boom\" (it was \"10\"), "
      "alone and in a list",
      lambda: s57.encdirect_value("CATOBS", "10") == "boom" and s57.encdirect_value("CATOBS", "1,10") == "snag/stump,boom",
      lambda: (s57.encdirect_value("CATOBS", "10"), s57.encdirect_value("CATOBS", "1,10")))

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
