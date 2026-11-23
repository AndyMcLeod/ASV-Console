"""ienc_cells.py - THE CORPS' RIVER CHARTS (enc_cells.RiverCells / RiverBuoys, s57.py's inland catalog, asv_console's
river band ENC_RIVER, static/js/keepouts.js asCharted), on river cells this suite builds byte by byte
(tests/lib/s57_writer.py), catalogs of its own - the Corps' XML and NOAA's GeoJSON - and a network that is a function.
Hermetic: no host is asked and nothing is written outside a temp folder.

WHAT IT HOLDS THE SOURCE TO (Andy, 2026-11-23: "add US Army Corps of Engineers (US inland rivers) to the available
charts in the Console" - and, asked where the two overlap, "NOAA harbor wins"):
  1  THE CORPS' CATALOG: each cell's name, edition and update, river and reach, its footprint whichever way round its
     edges are given (U37AR126's are swapped); a cell outside the rivers' reach not read and not counted against a
     refresh, an entry that does not read naming none; a refresh declaring a document type, another catalog, or not XML
     refused - the copy kept and said past its age - and a good one taken;
  2  WHERE THEY CAN REACH: a box outside RIVER_REACH asks nothing of anyone and writes nothing; one inside it that no
     river cell reaches is answered from the catalog, its age said only where a cell reaches, and the buoy overlay -
     whose one footprint is the whole reach - is asked for only where a river cell is;
  3  THE INLAND CLASSES: an inland class named as its IHO twin, as NOAA's cell would name it (the console's roles key
     on the names); an inland side (catlam) and water level (watlev) served as CATLAM and WATLEV where their values mean
     the same, and not where they do not, an IHO attribute given beside its twin its own; a class with no twin its
     own name, `extra`; NOAA's catalog unchanged, and an inland row never read over GDAL's where tables meet;
  4  THE BAND IN THE LAYERS, HIS CALL: after NOAA's harbor chart, before its approach chart - the harbor chart where
     the two overlap, the river chart where it alone is finest, the approach chart around; the buoys where the river
     chart is; its features marked enc_river; the band pick (snap-to-water, the chart card) in the same order, a river
     cell's depth under the inland class (depare) counted; with ENCDirect the source, no river band;
  5  A RIVER BAND THAT CANNOT BE READ IS UNKNOWN, NEVER ENCDIRECT'S: the tile's coverage_failed, its squares unread,
     ENCDirect not asked for it and its breaker not armed; snap-to-water's read and the chart card failed and said as
     the Corps', never read from ENCDirect; NOAA's harbor chart still answers where it is finest;
  6  a river cell or the buoy overlay read from an older copy, or either catalog past its age, said as the Corps' (the
     log too) - and the tile not called whole; a buoy that cannot be built leaves it partial;
  7  a tile kept before the river band: not current inside the rivers' reach, current outside it - and never the
     fallback of a failed read where a river cell may chart the water (7b);
  8  the tile's child is told the console's river folder (--ienc-dir), and reads it;
  9  THE DEPTHS AS CHARTED (keepouts.js, run in node): a river feature's depth area, rock and sounding take no tide
     station's level - risen or fallen - where NOAA's take it, in the floor, the passable rock and the margin layer.

  python tests/ienc_cells.py     # exit 0 = pass, 1 = fail
"""
import contextlib
import csv
import io
import json
import math
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error


def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from s57_writer import W, edge_ptr, node_ptr, zipped    # noqa: E402
import s57                                              # noqa: E402
import enc_cells as E                                   # noqa: E402
import asv_console as A                                 # noqa: E402

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


TMP = tempfile.mkdtemp(prefix="asv_ienc_cells_")
A.ENC_DIR = os.path.join(TMP, "enc")
A.S57_DIR = os.path.join(TMP, "s57")
A.IENC_DIR = os.path.join(TMP, "ienc")
A.ENC_SOURCE = "cells"
A.ENC_TILE_IN_PROCESS = True
os.makedirs(A.ENC_DIR)


# ── the cells ────────────────────────────────────────────────────────────────────────────────────────────────────────
class Cell:
    """A cell being written, with squares, lines and points by coordinates."""
    def __init__(self, name, edtn="1"):
        self.name = name
        self.w = W(name=name + ".000", edtn=edtn)
        self.nid = 1000
        self.fid = 1

    def _node(self, lon, lat, rcnm=120):
        self.nid += 1
        self.w.node(self.nid, lon, lat, rcnm=rcnm)
        return self.nid

    def _edge(self, a, b):
        self.nid += 1
        self.w.edge(self.nid, a, b, [])
        return self.nid

    def area(self, acr, box, attrs=None):
        w_, s_, e_, n_ = box
        c = [self._node(w_, s_), self._node(e_, s_), self._node(e_, n_), self._node(w_, n_)]
        es = [self._edge(c[i], c[(i + 1) % 4]) for i in range(4)]
        return self.feature(acr, 3, attrs, [edge_ptr(e) for e in es])

    def line(self, acr, a, b, attrs=None):
        return self.feature(acr, 2, attrs, [edge_ptr(self._edge(self._node(*a), self._node(*b)))])

    def point(self, acr, p, attrs=None):
        return self.feature(acr, 1, attrs, [node_ptr(self._node(p[0], p[1], rcnm=110))])

    def feature(self, acr, prim, attrs, ptrs):
        self.fid += 1
        self.w.feature(self.fid, acr, prim, attrs, ptrs)
        return self.fid

    def zip(self):
        """The cell's zip as the Corps and NOAA serve it: the base cell under ENC_ROOT."""
        return zipped({"ENC_ROOT/%s/%s.000" % (self.name, self.name): self.w.bytes()})


TILE = [-91.25, 30.5, -91.0, 30.75]       # a tile on a river near the coast: NOAA's charts and the Corps' both reach it
HB = [-91.25, 30.5, -91.15, 30.6]         # NOAA's harbor cell, the tile's south-west corner
AP = [-91.3, 30.45, -90.95, 30.8]         # NOAA's approach cell, under the whole tile
RV = [-91.2, 30.55, -91.05, 30.7]         # the Corps' river cell - its south-west corner under the harbor cell
RB = [-90.5, 31.0, -90.3, 31.2]           # a river cell whose catalog gives its west and east swapped
RC = [-90.0, 32.0, -89.9, 32.1]           # a river cell charting its depth under the inland class (depare)
AP2 = [-90.05, 31.95, -89.85, 32.15]      # NOAA's approach cell under it
FAR = [-70.5, 43.0, -70.4, 43.1]          # a cell outside the rivers' reach (Portsmouth NH)

hb = Cell("US5TSTRH")
hb.area("M_COVR", HB, {"CATCOV": "1"})
hb.area("DEPARE", HB, {"DRVAL1": "5", "DRVAL2": "10"})
HB_OBS = (-91.17, 30.58)                  # under the harbor cell AND the river cell: the harbor chart's, served
hb.point("OBSTRN", HB_OBS, {"VALSOU": "3"})

ap = Cell("US4TSTRA")
ap.area("M_COVR", AP, {"CATCOV": "1"})
ap.area("DEPARE", AP, {"DRVAL1": "1", "DRVAL2": "3"})
AP_IN_RV = (-91.10, 30.65)                # under the river cell: the approach chart's, NOT served there
AP_OUT = (-91.02, 30.72)                  # outside the river cell: the approach chart's, served
ap.point("OBSTRN", AP_IN_RV, {"VALSOU": "1"})
ap.point("OBSTRN", AP_OUT, {"VALSOU": "1"})

ap2 = Cell("US4TSTRB")
ap2.area("M_COVR", AP2, {"CATCOV": "1"})
ap2.area("DEPARE", AP2, {"DRVAL1": "1", "DRVAL2": "3"})

ra = Cell("U37TSTAA", edtn="52")
ra.area("M_COVR", RV, {"CATCOV": "1"})
ra.area("DEPARE", RV, {"DRVAL1": "0", "DRVAL2": "2.74"})
BCN_IN = ra.point("bcnlat", (-91.10, 30.66), {"catlam": "1"})          # the inland lateral beacon, port hand ...
BCN_IHO = ra.point("BCNLAT", (-91.11, 30.66), {"CATLAM": "1"})         # ... and the IHO one beside it
BCN_ODD = ra.point("bcnlat", (-91.09, 30.67), {"catlam": "22"})        # an inland side with no IHO meaning
BCN_BOTH = ra.point("bcnlat", (-91.095, 30.665), {"catlam": "2", "CATLAM": "1"})   # both sides given: the IHO one is its own
ROCK_IN = ra.point("uwtroc", (-91.08, 30.62), {"watlev": "2"})         # an inland rock, always dry ...
ROCK_IHO = ra.point("UWTROC", (-91.07, 30.62), {"WATLEV": "2"})        # ... and the IHO one
ROCK_AREA = ra.area("uwtroc", [-91.078, 30.612, -91.075, 30.615], {"watlev": "3"})   # an inland rock charted as an area
SLC = ra.line("slcons", (-91.12, 30.60), (-91.12, 30.61))              # a dike, the inland class
PON = ra.area("ponton", [-91.14, 30.62, -91.135, 30.625])
GAG = ra.point("wtwgag", (-91.06, 30.68), {"OBJNAM": "Test gauge"})    # an inland class with no IHO twin
BCN_OVER = ra.point("bcnlat", (-91.17, 30.57), {"catlam": "2"})        # under the harbor cell: NOT served

rb_ = Cell("U37TSTAB", edtn="7")
rb_.area("M_COVR", RB, {"CATCOV": "1"})
rb_.area("DEPARE", RB, {"DRVAL1": "0", "DRVAL2": "3"})

rc_ = Cell("U37TSTAC", edtn="12")
rc_.area("M_COVR", RC, {"CATCOV": "1"})
rc_.area("depare", RC, {"DRVAL1": "0", "DRVAL2": "3"})

bu = Cell("3UABUOYS", edtn="110")
BUOY_IN = bu.point("boylat", (-91.105, 30.645), {"catlam": "2"})       # in the river cell's water: served
BUOY_HB = bu.point("boylat", (-91.22, 30.52), {"catlam": "1"})         # under the harbor cell alone: not
BUOY_AP = bu.point("boylat", (-91.02, 30.73), {"catlam": "1"})         # under the approach cell alone: not


def merc(lon, lat):
    r = 6378137.0
    return [math.radians(lon) * r, r * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))]


def noaa_catalog():
    feats = []
    for name, (w_, s_, e_, n_) in (("US5TSTRH", HB), ("US4TSTRA", AP), ("US4TSTRB", AP2)):
        feats.append({"type": "Feature", "properties": {"enc_ed_up": "%s_ED001_UP000" % name, "scale_band": int(name[2]),
                                                        "title": "Test " + name},
                      "geometry": {"type": "Polygon", "coordinates": [[merc(w_, s_), merc(e_, s_), merc(e_, n_),
                                                                       merc(w_, n_), merc(w_, s_)]]}})
    return json.dumps({"type": "FeatureCollection", "features": feats}).encode("utf-8")


RIVER_CELLS = [("U37TSTAA", "52.0", RV, "Test River", "Mile 0", "Mile 10"),
               ("U37TSTAB", "7.0", (RB[2], RB[1], RB[0], RB[3]), "Swapped River", "Mile 5", "Mile 9"),   # west, east swapped
               ("U37TSTAC", "12.0", RC, "Inland River", "Mile 1", "Mile 2"),
               ("U37TSFAR", "3.0", FAR, "Far River", "Mile 0", "Mile 1")]


def xml_catalog(cells, tag="IENCU37ProductCatalog", doctype=False):
    """A catalog as the Corps publishes it: per cell its name, reach, river, footprint (north, south, east, west) and
    edition.update."""
    out = ['<?xml version="1.0" encoding="UTF-8"?>']
    if doctype:
        out.append('<!DOCTYPE %s [<!ENTITY reach "Mile 0">]>' % tag)
    out.append("<%s><Header><title>Test Catalog</title></Header>" % tag)
    for name, ed, (w_, s_, e_, n_), river, frm, to in cells:
        out.append("<Cell><name>%s</name><location><from>%s</from><to>%s</to></location><river_name>%s</river_name>"
                   "<area><north>%r</north><south>%r</south><east>%r</east><west>%r</west></area><edition>%s</edition>"
                   "</Cell>" % (name, frm, to, river, n_, s_, e_, w_, ed))
    out.append("</%s>" % tag)
    return "\n".join(out).encode("utf-8")


BUOY_CAT = xml_catalog([("3UABUOYS", "110.0", (-96.41727, 29.77866, -79.51481, 44.95899), "", "", "")],
                       tag="IENCBuoyProductCatalog")
FILES = {E.CATALOG_URL: noaa_catalog(), E.CELL_URL % "US5TSTRH": hb.zip(), E.CELL_URL % "US4TSTRA": ap.zip(),
         E.CELL_URL % "US4TSTRB": ap2.zip(),
         E.RIVER_CATALOG_URL: xml_catalog(RIVER_CELLS), E.RIVER_CELL_URL % "U37TSTAA": ra.zip(),
         E.RIVER_CELL_URL % "U37TSTAB": rb_.zip(), E.RIVER_CELL_URL % "U37TSTAC": rc_.zip(),
         E.BUOY_CATALOG_URL: BUOY_CAT, E.BUOY_CELL_URL % "3UABUOYS": bu.zip()}


class Net:
    """The network: url -> bytes. `down` holds the URLs that do not answer; a URL it does not know answers 404."""
    def __init__(self, files=None):
        self.files = dict(files or FILES)
        self.down = set()
        self.calls = []

    def __call__(self, url):
        self.calls.append(url)
        if url in self.down:
            raise urllib.error.URLError("timed out")
        if url not in self.files:
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, io.BytesIO(b""))
        return self.files[url]

    def corps(self):
        return [u for u in self.calls if "ienccloud" in u]


def sources(net, sub):
    """The console's sources - NOAA's cells and the Corps' - on fresh folders under TMP/sub, each asking `net`."""
    root = os.path.join(TMP, sub)
    shutil.rmtree(root, ignore_errors=True)
    A.S57_DIR, A.IENC_DIR = os.path.join(root, "s57"), os.path.join(root, "ienc")
    A._enc_cells_src = E.CellSource(A.S57_DIR, ssl_context=A._enc_ssl, fetch=net)
    A._enc_river_src = (E.RiverCells(A.IENC_DIR, ssl_context=A._enc_ssl, fetch=net),
                        E.RiverBuoys(A.IENC_DIR, ssl_context=A._enc_ssl, fetch=net))
    A._enc_down_until = 0.0
    return A._enc_river_src


def by_oid(feats, cell, rcid):
    pat = re.compile(r"^%s_ED\d{3}_UP\d{3}:%d$" % (cell, rcid))
    return [f for f in feats if pat.match(str(f.get("oid")))]


def one(feats, cell, rcid):
    got = by_oid(feats, cell, rcid)
    return got[0] if len(got) == 1 else {"cls": None, "role": None, "props": {}, "n": len(got)}


def at(feats, p):
    """The point features at p (lon, lat)."""
    return [f for f in feats if f["geometry"]["type"] == "Point"
            and abs(f["geometry"]["coordinates"][0] - p[0]) < 1e-7 and abs(f["geometry"]["coordinates"][1] - p[1]) < 1e-7]


# ENCDirect is never asked here: its coverage, features and chart information are spies that say what was asked
ED = []
_cov0, _feat0, _info0 = A._enc_coverage, A.fetch_enc_features, A.fetch_chart_info


def ed_cov(band, tile):
    ED.append(("coverage", band))
    raise OSError("ENCDirect is not asked in this suite")


def ed_feats(bbox, min_depth=0.0, band=None, extras=True, use_cache=True, source=None):
    if source == "encdirect":
        ED.append(("features", band))
        return {"band": None, "features": [], "failed": True, "note": "ENCDirect is not asked in this suite"}
    return _feat0(bbox, min_depth, band, extras, use_cache, source)


def ed_info(bbox, source=None):
    if source == "encdirect":
        ED.append(("chartinfo", None))
        return {"band": None, "cells": [], "quality": [], "failed": True, "note": "ENCDirect is not asked in this suite"}
    return _info0(bbox, source)


A._enc_coverage, A.fetch_enc_features, A.fetch_chart_info = ed_cov, ed_feats, ed_info
DAY = 86400.0

# ── 1. the Corps' catalog ────────────────────────────────────────────────────────────────────────────────────────────
net1 = Net()
rc1, rb1 = sources(net1, "c1")
cat1 = {e["name"]: e for e in rc1.catalog()}
a1 = cat1.get("U37TSTAA") or {}
check("1. THE CORPS' CATALOG READ: each river cell's name, edition and update (52.0: edition 52, update 0), its key, "
      "the river band, its river and reach as its title, its footprint - and one whose catalog gives its west and east "
      "swapped (U37AR126, measured) read as the box it is, not dropped; a cell outside the rivers' reach not read",
      lambda: sorted(cat1) == ["U37TSTAA", "U37TSTAB", "U37TSTAC"]
              and (a1["ed"], a1["up"], a1["key"], a1["band"], a1["title"], a1["bbox"])
              == (52, 0, "U37TSTAA_ED052_UP000", "enc_river", "Test River: Mile 0 to Mile 10", tuple(RV))
              and cat1["U37TSTAB"]["bbox"] == tuple(RB),
      lambda: "%s; U37TSTAA %s; U37TSTAB %s" % (sorted(cat1), a1, (cat1.get("U37TSTAB") or {}).get("bbox")))

root1b = E.RiverCells._decode_catalog(xml_catalog(
    [("U35TSTZZ", "1.0", RV, "A harbor cell", "", ""), ("U37TSTQQ", "52", RV, "No update", "", ""),
     ("u37tstqr", "1.0", RV, "A lower-case name", "", ""), ("U37TSTAA", "52.0", RV, "Test River", "Mile 0", "Mile 10"),
     ("U37TSFAR", "3.0", FAR, "Far River", "", "")]))
e1b, n1b = E.RiverCells._catalog_entries(root1b)
refused1b = E.RiverCells._catalog_refused(E.RiverCells._decode_catalog(xml_catalog(RIVER_CELLS)),
                                         os.path.join(TMP, "no_such_catalog.xml"))
check("1b. AN ENTRY THAT DOES NOT READ NAMES NO CELL - a cell of another purpose (U35: a harbor's), an edition with no "
      "update, a name that is not a cell's - and counts as one that failed to read; a cell outside the rivers' reach is "
      "no entry that failed (it is said, not read), so a catalog naming one is not refused for it",
      lambda: [e["name"] for e in e1b] == ["U37TSTAA"] and n1b == 4 and refused1b is None,
      lambda: "entries %s of n %d; the four-cell catalog refused: %r" % ([e["name"] for e in e1b], n1b, refused1b))


def refresh1(body):
    """The kept catalog past its age, the next process refreshing it from `body`: (cells, catalog_stale, kept bytes)."""
    path = os.path.join(rc1.root, rc1.CATALOG_FILE)
    with open(path, "wb") as f:
        f.write(FILES[E.RIVER_CATALOG_URL])
    old = time.time() - 2 * DAY
    os.utime(path, (old, old))
    for mk in (rc1.CATALOG_MARK, "down.mark"):
        if os.path.exists(os.path.join(rc1.root, mk)):
            os.remove(os.path.join(rc1.root, mk))
    net1.files[E.RIVER_CATALOG_URL] = body
    src = E.RiverCells(rc1.root, fetch=net1)
    try:
        cells = sorted(e["name"] for e in src.catalog())
    except Exception as e:
        cells = "raised %s: %s" % (type(e).__name__, e)
    with open(path, "rb") as f:
        return cells, src.catalog_stale, f.read()


MORE = RIVER_CELLS + [("U37TSTAD", "1.0", (-91.6, 31.5, -91.5, 31.6), "New River", "Mile 0", "Mile 3")]
r1c = {"doctype": refresh1(xml_catalog(MORE, doctype=True)),
       "other catalog": refresh1(xml_catalog(MORE, tag="IENCU31ProductCatalog")),
       "not xml": refresh1(b"<html><body>Service unavailable</body>"),
       "good": refresh1(xml_catalog(MORE))}
three = ["U37TSTAA", "U37TSTAB", "U37TSTAC"]
check("1c. A REFRESH THAT IS NOT THE CORPS' CATALOG IS REFUSED, the copy kept and said past its age: one declaring a "
      "document type (an entity in one can expand without limit as it is parsed), another catalog's root, an error "
      "page that is not XML - each naming a cell the copy does not, so taking it would show; a good one is taken",
      lambda: all(r1c[k][0] == three and r1c[k][1] and r1c[k][2] == FILES[E.RIVER_CATALOG_URL]
                  for k in ("doctype", "other catalog", "not xml"))
              and r1c["good"][0] == three + ["U37TSTAD"] and r1c["good"][1] is None,
      lambda: "; ".join("%s: %s stale %s" % (k, v[0], v[1]) for k, v in r1c.items()))
net1.files[E.RIVER_CATALOG_URL] = FILES[E.RIVER_CATALOG_URL]

# ── 2. where they can reach ──────────────────────────────────────────────────────────────────────────────────────────
net2 = Net()
rc2, rb2 = sources(net2, "c2")
far2 = A._band_features(A.ENC_RIVER, [-70.8, 43.0, -70.7, 43.1], A._cell_namer(A.ENC_RIVER))
cov2 = A._band_features(A.ENC_RIVER, [-70.8, 43.0, -70.7, 43.1], A._cell_namer(A.ENC_RIVER), only={"M_COVR"})
check("2. A BOX OUTSIDE THE RIVERS' REACH (RIVER_REACH) ASKS NOTHING OF ANYONE: no river cell, no catalog asked, no "
      "folder written - its features and its coverage alike; the coast's charts never wait on, or fail with, a host "
      "they cannot need",
      lambda: far2 == ([], far2[1]) and not far2[1]["cells"] and cov2[0] == [] and net2.calls == []
              and not os.path.exists(A.IENC_DIR),
      lambda: "features %d, asked %s, folder %s" % (len(far2[0]), net2.calls, os.path.exists(A.IENC_DIR)))

# a box inside the reach no river cell reaches (Mobile Bay), the catalog kept and past its age, its refresh failing
for e in rc2.catalog():
    if e["name"] == "U37TSTAA":
        rc2.cell_path(e)
cpath2 = os.path.join(rc2.root, rc2.CATALOG_FILE)
os.utime(cpath2, (time.time() - 2 * DAY,) * 2)
rc2._index = None
net2.down.add(E.RIVER_CATALOG_URL)
n2 = len(net2.calls)
none2 = A._band_features(A.ENC_RIVER, [-88.0, 30.2, -87.9, 30.3], A._cell_namer(A.ENC_RIVER))
asked2 = net2.calls[n2:]
some2 = A._band_features(A.ENC_RIVER, [-91.12, 30.62, -91.08, 30.66], A._cell_namer(A.ENC_RIVER), only={"M_COVR"})
check("2b. INSIDE THE REACH, A BOX NO RIVER CELL REACHES is answered from the catalog: no feature, and the catalog's age "
      "NOT said (no river chart there to be behind) - and the buoy overlay, whose one footprint is the whole reach, not "
      "asked for at all (asked, every coast tile there read it, and failed its river band when the host was silent); "
      "where a river cell reaches, the catalog past its age IS said",
      lambda: none2[0] == [] and none2[1]["catalog_stale"] is None and not none2[1]["cells"]
              and not [u for u in asked2 if "buoys" in u.lower()]
              and some2[1]["cells"] == ["U37TSTAA"] and some2[1]["catalog_stale"],
      lambda: "none: stale %r cells %s asked %s; some: cells %s stale %r" % (
          none2[1]["catalog_stale"], none2[1]["cells"], asked2, some2[1]["cells"], some2[1]["catalog_stale"]))

# ── 3. the inland classes ────────────────────────────────────────────────────────────────────────────────────────────
net3 = Net()
sources(net3, "c3")
x3 = A._cells_extract(A.ENC_RIVER, RV)
f3 = x3["features"]
bi, bh, bo = one(f3, "U37TSTAA", BCN_IN), one(f3, "U37TSTAA", BCN_IHO), one(f3, "U37TSTAA", BCN_ODD)
bb = one(f3, "U37TSTAA", BCN_BOTH)
ri, rh = one(f3, "U37TSTAA", ROCK_IN), one(f3, "U37TSTAA", ROCK_IHO)
ra3 = one(f3, "U37TSTAA", ROCK_AREA)
buoy3 = one(f3, "3UABUOYS", BUOY_IN)
check("3. AN INLAND CLASS IS NAMED AS ITS IHO TWIN, AS NOAA'S CELL WOULD NAME IT - the page keys on the names: the "
      "inland rock (uwtroc) Underwater_Awash_Rock_point, a hazard - named by its own catalog's words it was "
      "Underwater_Rock_Awash_Rock_point, a name no role holds, and reached no keep-out - and charted as an AREA, which "
      "the Corps' catalog allows and the IHO's does not, Underwater_Awash_Rock_area, a hazard area (it was "
      "Underwater_Rock_Awash_Rock_area, held by no role); the inland lateral beacon a "
      "channel mark as the IHO one beside it; a dike (slcons) a dock line; a pontoon a dock; a waterway gauge (no "
      "IHO twin) its own name, extra; the buoy overlay's lateral buoy a channel mark, of the river band",
      lambda: (ri["cls"], ri["role"]) == (rh["cls"], rh["role"]) == ("Underwater_Awash_Rock_point", "hazard_point")
              and (ra3["cls"], ra3["role"]) == ("Underwater_Awash_Rock_area", "hazard_area")
              and (bi["cls"], bi["role"]) == (bh["cls"], bh["role"]) == ("Beacon_Lateral_point", "chan_mark")
              and (one(f3, "U37TSTAA", SLC)["cls"], one(f3, "U37TSTAA", SLC)["role"])
              == ("Shoreline_Construction_line", "dock_line")
              and (one(f3, "U37TSTAA", PON)["cls"], one(f3, "U37TSTAA", PON)["role"]) == ("Pontoon_area", "dock")
              and (one(f3, "U37TSTAA", GAG)["cls"], one(f3, "U37TSTAA", GAG)["role"]) == ("Waterway_Gauge_point", "extra")
              and (buoy3["cls"], buoy3["role"]) == ("Buoy_Lateral_point", "chan_mark")
              and x3.get("complete") and x3["cells"] == ["U37TSTAA", "3UABUOYS"],
      lambda: "rock %s/%s (IHO %s), as an area %s/%s; beacon %s/%s; slcons %s; ponton %s; gauge %s; buoy %s/%s; cells %s" % (
          ri["cls"], ri["role"], rh["cls"], ra3["cls"], ra3["role"], bi["cls"], bi["role"], one(f3, "U37TSTAA", SLC)["cls"],
          one(f3, "U37TSTAA", PON)["cls"], one(f3, "U37TSTAA", GAG)["cls"], buoy3["cls"], buoy3["role"], x3.get("cells")))
check("3b. AN INLAND SIDE AND WATER LEVEL ARE SERVED AS THE IHO ATTRIBUTES WHERE THEIR VALUES MEAN THE SAME: the inland "
      "beacon's catlam 1 is CATLAM as the IHO beacon's (the side the channel lane reads), the buoy's catlam 2 too; the "
      "inland rock's watlev 2 is WATLEV as the IHO rock's (always dry: never passed on a sounding) - and an inland side "
      "with no IHO meaning (catlam 22, right-hand side of the waterway) is no CATLAM at all; a beacon giving both keeps "
      "its own CATLAM (1), not its catlam's (2)",
      lambda: bi["props"].get("CATLAM") is not None and bi["props"].get("CATLAM") == bh["props"].get("CATLAM")
              and buoy3["props"].get("CATLAM") == s57.encdirect_value("CATLAM", "2")
              and ri["props"].get("WATLEV") is not None and ri["props"].get("WATLEV") == rh["props"].get("WATLEV")
              and "CATLAM" not in bo["props"] and bb["props"].get("CATLAM") == bh["props"].get("CATLAM"),
      lambda: "beacon %r (IHO %r), buoy %r, rock %r (IHO %r), catlam 22 %r, both given %r" % (
          bi["props"].get("CATLAM"), bh["props"].get("CATLAM"), buoy3["props"].get("CATLAM"), ri["props"].get("WATLEV"),
          rh["props"].get("WATLEV"), bo["props"].get("CATLAM"), bb["props"].get("CATLAM")))

nm3 = A._cell_namer(A.ENC_RIVER)
names3 = {"rule, uwtroc": s57.layer_name("uwtroc", 1), "ENCDirect's, m_vdat area": nm3("m_vdat", 3),
          "harbor facility": nm3("hrbfac", 1), "berth": nm3("berths", 1)}
check("3c. ... BY BOTH OF THE READER'S NAMINGS: the rule's (s57.layer_name - the inland rock Underwater_Awash_Rock_point) "
      "and ENCDirect's own spelling of the twin (the inland vertical datum area Vertical_Datum_of_Data_area, where the "
      "rule says Of); an inland harbor facility Harbour_Facility_point - which the marina speed rule reads "
      "(static/js/speedzones.js), and named by its own catalog's words was Harbour_Facilities_point - and a berth "
      "Berth_point, not Berth_Berths_point",
      lambda: names3 == {"rule, uwtroc": "Underwater_Awash_Rock_point", "ENCDirect's, m_vdat area": "Vertical_Datum_of_Data_area",
                         "harbor facility": "Harbour_Facility_point", "berth": "Berth_point"},
      lambda: names3)

cat3 = s57.catalog()
gdal_objl = {int(r["Code"]): r["Acronym"] for r in s57._table("s57objectclasses.csv") if (r.get("Code") or "").isdigit()}
gdal_attl = {int(r["Code"]): r["Acronym"] for r in s57._table("s57attributes.csv") if (r.get("Code") or "").isdigit()}
gdal_exp = {(int(r["Code"]), int(r["ID"])): r["Meaning"] for r in s57._table("s57expectedinput.csv")
            if (r.get("Code") or "").isdigit() and (r.get("ID") or "").isdigit()}
inland_low = [r["Code"] for t in s57.INLAND_TABLES for r in s57._table(t)
              if (r.get("Code") or "").isdigit() and int(r["Code"]) < s57.INLAND_FIRST_CODE]
# GDAL's tables by acronym as the reader always took them: the later row wins (brgare is in them twice, 17053 and 20536)
gdal_acr_objl = {a: c for c, a in gdal_objl.items()}
gdal_acr_attl = {a: c for c, a in gdal_attl.items()}
off3 = ([("objl", c) for c, a in gdal_objl.items() if cat3["objl"][c][0] != a]
        + [("acr_objl", a) for a, c in gdal_acr_objl.items() if cat3["acr_objl"].get(a) != c]
        + [("attl", c) for c, a in gdal_attl.items() if cat3["attl"][c][0] != a]
        + [("acr_attl", a) for a, c in gdal_acr_attl.items() if cat3["acr_attl"].get(a) != c]
        + [("expected", k) for k, v in gdal_exp.items() if cat3["expected"].get(k) != v])
check("3d. NOAA'S CATALOG UNCHANGED: every class, attribute and value GDAL's tables hold reads as it did - by code and "
      "by acronym, a later row winning as it did (brgare is in them twice), and CLSDEF, CLSNAM and SYMINS, which the "
      "inland catalog names again under codes of its own, still GDAL's 190-192 - and the inland tables hold inland "
      "codes alone",
      lambda: not off3 and gdal_acr_objl.get("brgare") == 20536
              and [cat3["acr_attl"][a] for a in ("CLSDEF", "CLSNAM", "SYMINS")] == [190, 191, 192] and not inland_low,
      lambda: "differ %s; brgare %s; CLSDEF/CLSNAM/SYMINS %s; inland rows under %d: %s" % (
          off3[:6], cat3["acr_objl"].get("brgare"), [cat3["acr_attl"].get(a) for a in ("CLSDEF", "CLSNAM", "SYMINS")],
          s57.INLAND_FIRST_CODE, inland_low[:5]))

# 3e: the shipped tables meet nowhere (3d), so the reader's rule for where they would is held on tables that do
T3E = os.path.join(TMP, "tables3e")
shutil.copytree(s57.TABLES, T3E)


def add_rows(name, rows):
    """Rows added to a copied table, in its own columns (ASCII: the table's encoding, UTF-8 or Latin-1, holds them)."""
    p = os.path.join(T3E, name)
    with open(p, "rb") as f:
        raw = f.read()
    cols = next(csv.reader([raw.decode("latin-1").splitlines()[0]]))
    out = io.StringIO(newline="")
    wr = csv.DictWriter(out, fieldnames=cols, lineterminator="\r\n" if b"\r\n" in raw else "\n")
    for r in rows:
        wr.writerow({c: r.get(c, "") for c in cols})
    with open(p, "wb") as f:
        f.write(raw + (b"" if raw.endswith(b"\n") else b"\n") + out.getvalue().encode("ascii"))


depare3e = (cat3["acr_objl"]["DEPARE"], cat3["class_attrs"]["DEPARE"])
add_rows("s57expectedinput.csv", [{"Code": "17000", "ID": "1", "Meaning": "GDAL's own meaning"}])
add_rows("ienc_objectclasses.csv", [{"Code": "17000", "ObjectClass": "Inland under GDAL's code", "Acronym": "zzobja"},
                                    {"Code": "29990", "ObjectClass": "Inland under GDAL's acronym", "Acronym": "DEPARE",
                                     "Attribute_A": "zzattr"}])
add_rows("ienc_attributes.csv", [{"Code": "17000", "Attribute": "Inland under GDAL's code", "Acronym": "zzattb",
                                  "Attributetype": "E"}])
add_rows("ienc_expectedinput.csv", [{"Code": "17000", "ID": "1", "Meaning": "the inland meaning"}])
_tab0, _cat0 = s57.TABLES, s57._cat
s57.TABLES, s57._cat = T3E, None
try:
    cat3e = s57.catalog()
finally:
    s57.TABLES, s57._cat = _tab0, _cat0
got3e = {"class 17000": cat3e["objl"][17000][0], "DEPARE's code": cat3e["acr_objl"]["DEPARE"],
         "DEPARE's attributes GDAL's": cat3e["class_attrs"]["DEPARE"] == depare3e[1],
         "attribute 17000": cat3e["attl"][17000][0], "value (17000, 1)": cat3e["expected"][(17000, 1)]}
check("3e. AN INLAND ROW NEVER REPLACES GDAL'S, on tables where they meet (the shipped ones meet nowhere, 3d): an inland "
      "class or attribute under a code GDAL's hold is not read, a class under an acronym GDAL's hold leaves GDAL's code "
      "and attribute list for it, and a value GDAL's give is GDAL's",
      lambda: got3e == {"class 17000": cat3["objl"][17000][0], "DEPARE's code": depare3e[0],
                        "DEPARE's attributes GDAL's": True, "attribute 17000": cat3["attl"][17000][0],
                        "value (17000, 1)": "GDAL's own meaning"} and s57.catalog() is _cat0,
      lambda: got3e)

# ── 4. the band in the layers ────────────────────────────────────────────────────────────────────────────────────────
net4 = Net()
sources(net4, "c4")
del ED[:]
t4 = A._enc_tile_build(TILE)
f4 = t4["features"]
river4 = [f for f in f4 if f.get("band") == A.ENC_RIVER]
check("4. THE RIVER BAND IS READ AFTER NOAA'S HARBOR CHART AND BEFORE ITS APPROACH CHART (his call, 2026-11-23: \"NOAA "
      "harbor wins\"): the harbor chart's obstruction served where the two overlap, the river beacon there not; the "
      "river chart's beacon, rock and buoy where it alone is finest, the approach chart's obstruction there not; the "
      "approach chart's obstruction beyond the river chart served, the buoys under the harbor or the approach chart "
      "alone not; the river features marked enc_river (keepouts.js reads their depths as charted), its depth area "
      "among them; whole, every band from the cells, ENCDirect asked nothing",
      lambda: t4["bands"] == ["enc_harbour", "enc_river", "enc_approach"] and t4.get("complete")
              and t4["sources"].get(A.ENC_RIVER) == "cells" and not t4["unread"] and not t4["unread_failed"]
              and at(f4, HB_OBS) and not by_oid(f4, "U37TSTAA", BCN_OVER)
              and by_oid(f4, "U37TSTAA", BCN_IN) and by_oid(f4, "U37TSTAA", ROCK_IN) and by_oid(f4, "3UABUOYS", BUOY_IN)
              and not at(f4, AP_IN_RV) and at(f4, AP_OUT)
              and not by_oid(f4, "3UABUOYS", BUOY_HB) and not by_oid(f4, "3UABUOYS", BUOY_AP)
              and all(f["band"] == A.ENC_RIVER for f in by_oid(f4, "U37TSTAA", BCN_IN) + by_oid(f4, "3UABUOYS", BUOY_IN))
              and any(f["role"] == "depth_area" for f in river4) and not ED,
      lambda: "bands %s complete %s sources %s unread %s/%s; harbor obs %d, beacon under harbor %d, river beacon %d, "
              "approach obs in river %d / out %d, buoys in %d hb %d ap %d; ENCDirect %s; note %r" % (
                  t4["bands"], t4.get("complete"), t4["sources"].get(A.ENC_RIVER), t4["unread"], t4["unread_failed"],
                  len(at(f4, HB_OBS)), len(by_oid(f4, "U37TSTAA", BCN_OVER)), len(by_oid(f4, "U37TSTAA", BCN_IN)),
                  len(at(f4, AP_IN_RV)), len(at(f4, AP_OUT)), len(by_oid(f4, "3UABUOYS", BUOY_IN)),
                  len(by_oid(f4, "3UABUOYS", BUOY_HB)), len(by_oid(f4, "3UABUOYS", BUOY_AP)), ED, t4.get("note")))

pick4 = {k: A._cells_pick_band(b) for k, b in (("harbor and river", [-91.19, 30.56, -91.16, 30.59]),
                                                ("river alone", [-91.12, 30.62, -91.08, 30.66]),
                                                ("approach alone", [-91.04, 30.71, -91.01, 30.74]),
                                                ("inland depth", [-89.98, 32.02, -89.92, 32.08]))}
check("4b. THE BAND PICK (snap-to-water, the chart card) IN THE SAME ORDER: the harbor chart where it and the river chart "
      "both chart the water, the river chart where it is the finest, the approach chart where it alone does - and a "
      "river cell charting its depth under the inland class (depare) is a river chart there, not passed by for the "
      "approach chart under it",
      lambda: pick4 == {"harbor and river": "enc_harbour", "river alone": "enc_river", "approach alone": "enc_approach",
                        "inland depth": "enc_river"},
      lambda: pick4)
info4 = A.fetch_chart_info([-91.12, 30.62, -91.08, 30.66])
cells4 = [(str(c["props"].get("DSNM"))[:8], c["props"].get("TITLE")) for c in info4.get("cells") or []]
check("4c. THE CHART CARD where the river chart is finest: the river band, its cell named with its title from the "
      "Corps' catalog - the river and its reach - read from the cells, ENCDirect asked nothing",
      lambda: info4.get("band") == A.ENC_RIVER and ("U37TSTAA", "Test River: Mile 0 to Mile 10") in cells4
              and not info4.get("failed") and not ED,
      lambda: "band %s cells %s note %r ENCDirect %s" % (info4.get("band"), cells4, info4.get("note"), ED))
order4 = A._layered_bands()
A.ENC_SOURCE = "encdirect"
try:
    order4e = A._layered_bands()
finally:
    A.ENC_SOURCE = "cells"
check("4d. ... the layered order itself: harbor, river, approach, coastal, general, overview - and with ENCDirect the "
      "source (--enc-source encdirect) no river band: that console reads ENCDirect's charts and nothing more",
      lambda: order4 == ["enc_harbour", "enc_river", "enc_approach", "enc_coastal", "enc_general", "enc_overview"]
              and order4e == A.ENC_BANDS and A.ENC_RIVER not in order4e,
      lambda: "cells %s; encdirect %s" % (order4, order4e))

# ── 5. a river band that cannot be read ──────────────────────────────────────────────────────────────────────────────
net5 = Net()
net5.down.add(E.RIVER_CATALOG_URL)
sources(net5, "c5")
del ED[:]
t5 = A._enc_tile_build(TILE)
f5 = t5["features"]
down5 = A._enc_down_until
check("5. THE CORPS' CELLS UNREADABLE (their host silent, no catalog kept) LEAVE THE RIVER BAND UNKNOWN, NEVER "
      "ENCDIRECT'S - which serves NOAA's charts alone, and would put the approach chart in the river chart's place: "
      "coverage_failed names it, its source the cells; ENCDirect asked nothing and its breaker not armed by a host it "
      "never asked; the tile not whole, the water the river chart might chart unread - the approach chart's "
      "obstruction there not served - while NOAA's harbor chart, finer, is read where it charts",
      lambda: A.ENC_RIVER in t5["coverage_failed"] and t5["sources"].get(A.ENC_RIVER) == "cells" and not ED
              and down5 == 0.0 and not t5.get("complete") and t5["unread_failed"] and t5["bands"] == ["enc_harbour"]
              and at(f5, HB_OBS) and not at(f5, AP_OUT) and "the Corps' river cells could not be read" in (t5.get("note") or ""),
      lambda: "coverage_failed %s sources %s ENCDirect %s breaker %s complete %s unread_failed %d bands %s harbor obs %d "
              "approach obs %d note %r" % (t5["coverage_failed"], t5["sources"].get(A.ENC_RIVER), ED, down5,
                                           t5.get("complete"), len(t5["unread_failed"]), t5["bands"], len(at(f5, HB_OBS)),
                                           len(at(f5, AP_OUT)), t5.get("note")))
A._enc_down_until = 0.0
del ED[:]
snap5 = A.fetch_enc_features([-91.12, 30.62, -91.08, 30.66])
card5 = A.fetch_chart_info([-91.12, 30.62, -91.08, 30.66])
harb5 = A.fetch_enc_features([-91.19, 30.56, -91.16, 30.59])
check("5b. ... AND SNAP-TO-WATER'S READ AND THE CHART CARD there are FAILED, said as the Corps' (`river`), never read "
      "from ENCDirect - whose answer would be NOAA's approach chart in the river chart's place - while a box NOAA's "
      "harbor chart charts is answered from it, the river chart never asked",
      lambda: snap5.get("failed") and snap5.get("river") and snap5.get("band") is None
              and snap5.get("note", "").startswith("the Corps' river chart cells could not be read")
              and card5.get("failed") and card5.get("river")
              and card5.get("note", "").startswith("the Corps' river chart cells could not be read")
              and not ED and harb5.get("band") == "enc_harbour" and not harb5.get("failed"),
      lambda: "snap %r (river %s); card %r (river %s); harbor box %s; ENCDirect %s" % (
          snap5.get("note"), snap5.get("river"), card5.get("note"), card5.get("river"), harb5.get("band"), ED))

# ── 6. older copies, and the catalog past its age ────────────────────────────────────────────────────────────────────
net6 = Net(dict(FILES, **{E.RIVER_CATALOG_URL: xml_catalog([("U37TSTAA", "52.1",) + RIVER_CELLS[0][2:]]
                                                             + RIVER_CELLS[1:])}))
rc6, rb6 = sources(net6, "c6")
rc6.catalog()
for e in rb6.catalog():
    rb6.cell_path(e)
os.makedirs(rc6.cells_dir, exist_ok=True)
with open(os.path.join(rc6.cells_dir, "U37TSTAA_ED052_UP000.zip"), "wb") as f:
    f.write(ra.zip())                                 # the copy kept; the catalog names update 1, which will not download
net6.down.add(E.RIVER_CELL_URL % "U37TSTAA")
t6 = A._enc_tile_build(TILE)
check("6. A RIVER CELL READ FROM AN OLDER COPY (its current update would not download) is said as the Corps' - in "
      "`stale`, which the page shows as an older chart in use: \"a correction the Corps issued since\", not NOAA - "
      "named among the stale cells, and the tile not called whole (not kept: read again next time)",
      lambda: "U37TSTAA" in (t6.get("stale") or "") and "a correction the Corps issued since" in t6.get("stale", "")
              and "NOAA issued" not in t6.get("stale", "") and t6.get("stale_cells") == ["U37TSTAA"]
              and not t6.get("complete") and by_oid(t6["features"], "U37TSTAA", BCN_IN),
      lambda: "stale %r stale_cells %s complete %s" % (t6.get("stale"), t6.get("stale_cells"), t6.get("complete")))

net6b = Net()
rc6b, rb6b = sources(net6b, "c6b")
for src in (rc6b, rb6b):
    for e in src.catalog():
        src.cell_path(e)
cp6 = os.path.join(rc6b.root, rc6b.CATALOG_FILE)
old6 = time.time() - 2 * DAY
os.utime(cp6, (old6, old6))
net6b.down.add(E.RIVER_CATALOG_URL)
t6b = A._enc_tile_build(TILE)
card6b = A.fetch_chart_info([-91.12, 30.62, -91.08, 30.66])
day6 = time.strftime("%Y-%m-%d", time.gmtime(old6))
check("6b. THE CORPS' CATALOG PAST ITS AGE (its refresh failing) is said as the Corps' - \"the Corps' river chart "
      "catalog could not be refreshed\", a buoy moved since not in it - its day the tile's catalog_stale, NOAA's "
      "catalog not blamed, and the tile not called whole; the chart card says it as the Corps' too",
      lambda: "the Corps' river chart catalog could not be refreshed" in (t6b.get("stale") or "")
              and day6 in t6b.get("stale", "") and "NOAA's cell catalog" not in t6b.get("stale", "")
              and t6b.get("catalog_stale") == day6 and not t6b.get("complete")
              and "the Corps' cell catalog could not be refreshed" in (card6b.get("note") or "")
              and card6b.get("catalog_stale") == day6,
      lambda: "stale %r catalog_stale %r complete %s; card %r" % (t6b.get("stale"), t6b.get("catalog_stale"),
                                                                 t6b.get("complete"), card6b.get("note")))

BUOY_REACH = (-96.41727, 29.77866, -79.51481, 44.95899)
net6c = Net(dict(FILES, **{E.BUOY_CATALOG_URL: xml_catalog([("3UABUOYS", "110.1", BUOY_REACH, "", "", "")],
                                                           tag="IENCBuoyProductCatalog")}))
rc6c, rb6c = sources(net6c, "c6c")
rc6c.catalog()
rb6c.catalog()
os.makedirs(rb6c.cells_dir, exist_ok=True)
with open(os.path.join(rb6c.cells_dir, "3UABUOYS_ED110_UP000.zip"), "wb") as f:
    f.write(bu.zip())                                 # the copy kept; the catalog names update 1, which will not download
bp6c = os.path.join(rb6c.root, rb6c.CATALOG_FILE)
old6c = time.time() - 2 * DAY
os.utime(bp6c, (old6c, old6c))                        # ... and the buoy catalog past its age, its refresh failing
net6c.down.update((E.BUOY_CATALOG_URL, E.BUOY_CELL_URL % "3UABUOYS"))
log6c = io.StringIO()
with contextlib.redirect_stdout(log6c):
    t6c = A._enc_tile_build(TILE)
day6c = time.strftime("%Y-%m-%d", time.gmtime(old6c))
check("6c. ... THE BUOY OVERLAY TOO: read from an older copy, it is said as the Corps' and named among the stale cells; "
      "its catalog past its age said as the Corps' river chart catalog, its day the tile's catalog_stale - and the log "
      "names the Corps' catalog, not NOAA's; the tile not whole, the buoy still served",
      lambda: t6c.get("stale_cells") == ["3UABUOYS"] and "a correction the Corps issued since" in (t6c.get("stale") or "")
              and "the Corps' river chart catalog could not be refreshed" in t6c.get("stale", "")
              and t6c.get("catalog_stale") == day6c and not t6c.get("complete")
              and by_oid(t6c["features"], "3UABUOYS", BUOY_IN)
              and ("the Corps' catalog not refreshed since " + day6c) in log6c.getvalue()
              and "NOAA's catalog not refreshed" not in log6c.getvalue(),
      lambda: "stale_cells %s stale %r catalog_stale %r complete %s buoy %d; log %r" % (
          t6c.get("stale_cells"), t6c.get("stale"), t6c.get("catalog_stale"), t6c.get("complete"),
          len(by_oid(t6c["features"], "3UABUOYS", BUOY_IN)),
          [l for l in log6c.getvalue().splitlines() if "REFUSING" in l][:1]))

bu6d = Cell("3UABUOYS", edtn="110")
BUOY6D = bu6d.point("boylat", (-91.105, 30.645), {"catlam": "2"})
bu6d.feature("boylat", 1, {"catlam": "1"}, [node_ptr(99999)])    # a buoy whose node is not in the cell: no geometry
net6d = Net(dict(FILES, **{E.BUOY_CELL_URL % "3UABUOYS": bu6d.zip()}))
sources(net6d, "c6d")
t6d = A._enc_tile_build(TILE)
check("6d. ... AND A BUOY WHOSE GEOMETRY CANNOT BE BUILT LEAVES THE TILE PARTIAL, not whole: the lateral buoys named "
      "among the classes not read whole, the buoy that reads still served",
      lambda: "Buoy_Lateral_point" in (t6d.get("partial") or []) and not t6d.get("complete")
              and by_oid(t6d["features"], "3UABUOYS", BUOY6D),
      lambda: "partial %s complete %s buoy %d note %r" % (t6d.get("partial"), t6d.get("complete"),
                                                          len(by_oid(t6d["features"], "3UABUOYS", BUOY6D)), t6d.get("note")))

# ── 7. a tile kept before the river band ─────────────────────────────────────────────────────────────────────────────
TAG = E.reader_tag()
NOAA_ALL = {b: "cells" for b in A.ENC_BANDS + [A.ENC_BERTHING]}
MAINE = [-70.25, 43.0, -70.0, 43.25]
nc7 = {"inside, no river": A._tile_not_current({"tile": TILE, "sources": dict(NOAA_ALL), "cells_reader": TAG}),
       "inside, river": A._tile_not_current({"tile": TILE, "sources": dict(NOAA_ALL, enc_river="cells"),
                                             "cells_reader": TAG}),
       "outside, no river": A._tile_not_current({"tile": MAINE, "sources": dict(NOAA_ALL), "cells_reader": TAG}),
       "no box": A._tile_not_current({"sources": dict(NOAA_ALL), "cells_reader": TAG})}
A.ENC_SOURCE = "encdirect"
try:
    nc7["encdirect, inside"] = A._tile_not_current({"tile": TILE, "sources": {b: "encdirect" for b in NOAA_ALL}})
finally:
    A.ENC_SOURCE = "cells"
RIVER_WHY = ("before the Corps' river charts were read", "it lacks the river chart wherever one charts the water")
check("7. A TILE KEPT BEFORE THE RIVER BAND WAS READ (it names no source for it) is not this console's chart inside the "
      "rivers' reach - read again, and as a fallback said to lack the river chart; outside the reach it lacks nothing "
      "and is current (the coast's tiles kept are not all read again for a chart that cannot reach them); one naming "
      "no box is taken as inside; a tile of the river band is current; the ENCDirect console reads no river band",
      lambda: nc7 == {"inside, no river": RIVER_WHY, "inside, river": None, "outside, no river": None,
                      "no box": RIVER_WHY, "encdirect, inside": None},
      lambda: nc7)


def pre_river(t, fmt=None, **over):
    """A whole tile kept before the river band at `t` - NOAA's charts alone, its one feature a sentinel (oid 4243) on the
    river cell's water - as this reader's format (tile_v4) or an older reader's (`fmt`, ENCDirect's tile_v3: reader 3,
    no sources)."""
    got = dict({"tile": t, "bands": ["enc_approach"], "unread": [], "unread_failed": [], "partial": [], "complete": True,
                "reader": A._ENC_TILE_READER, "read_at": time.time() - 3600, "sources": dict(NOAA_ALL),
                "cells_reader": TAG,
                "features": [{"role": "hazard_point", "cls": "Obstruction_point", "props": {"VALSOU": 1.0}, "oid": 4243,
                              "band": "enc_approach", "geometry": {"type": "Point", "coordinates": list(AP_IN_RV)}}]},
               **over)
    if fmt:
        got = dict(got, reader=3)
        got.pop("sources")
        got.pop("cells_reader")
    A._write_tile_jsonl(os.path.join(A.ENC_DIR, (fmt or A._ENC_TILE_FMT) % A._bbox_key(t)), got)


def clear7(*ts):
    for t in ts:
        with A._enc_tile_locks_lock:
            A._enc_tile_mem.pop(A._bbox_key(t), None)
        for p in [A._tile_path(t)] + A._older_tile_paths(t):
            if os.path.exists(p):
                os.remove(p)


def sent7(d):
    return any(f.get("oid") == 4243 for f in (d or {}).get("features") or [])


V3 = "tile_v3_%s.jsonl"
CTRL = [-89.0, 33.0, -88.75, 33.25]       # inside the reach, no river cell near: NOAA's water alone
net7 = Net()
net7.down.add(E.RIVER_CATALOG_URL)
sources(net7, "c7b")                      # the Corps' host silent, no catalog kept
clear7(TILE, CTRL, MAINE)
pre_river(TILE)
pre_river(TILE, V3)
b7 = A._tile_build_now(TILE)              # the read fails (the river band unknown); its fallback asked
pre_river(MAINE, V3)
o7out = A._older_tile(MAINE)              # outside the reach, no catalog kept: the older copy is the fallback
net7c = Net()
sources(net7c, "c7c")
A._river_sources()[0].catalog()           # the Corps' catalog kept: the river cells' footprints known
o7in = A._older_tile(TILE)
pre_river(CTRL)
o7ctrl = A._older_tile(CTRL)
pre_river(TILE, sources=dict(NOAA_ALL, enc_river="cells"), cells_reader="an earlier build")
o7riv = A._older_tile(TILE)               # a copy naming the river band (an earlier reader's): the fallback
clear7(TILE)
pre_river(TILE, V3)
A.ENC_SOURCE = "encdirect"
try:
    o7ed = A._older_tile(TILE)            # the ENCDirect console reads no river band: its older copy is the fallback
finally:
    A.ENC_SOURCE = "cells"
clear7(TILE, CTRL, MAINE)
check("7b. NO COPY KEPT BEFORE THE RIVER BAND IS THE FALLBACK WHERE A RIVER CELL MAY CHART THE WATER (review, 2026-11-23) "
      "- it has NOAA's coarser chart in the river chart's place, served as a chart to act on: the read that failed is "
      "served (that water unread), not the copy, of this format or ENCDirect's older one - with the Corps' host silent "
      "and no catalog kept (not known not to), and with the catalog kept naming a river cell there; where none reaches "
      "(inside the reach), outside the reach, for a copy naming the river band, and on the ENCDirect console, the copy "
      "is the fallback it always was",
      lambda: not sent7(b7) and b7.get("unread_failed") and not b7.get("complete")
              and "before the Corps' river charts" not in (b7.get("stale") or "")
              and o7in is None
              and sent7(o7ctrl) and "before the Corps' river charts were read" in (o7ctrl.get("stale") or "")
              and sent7(o7out) and sent7(o7riv) and "earlier build of the cell reader" in (o7riv.get("stale") or "")
              and sent7(o7ed),
      lambda: "failed read: copy %s, unread_failed %d, stale %r; catalog naming a river cell: %s; no river cell: %s %r; "
              "outside: %s; naming the river: %s %r; ENCDirect: %s" % (
                  sent7(b7), len(b7.get("unread_failed") or []), b7.get("stale"),
                  "none" if o7in is None else "copy %s" % sent7(o7in), sent7(o7ctrl), (o7ctrl or {}).get("stale"),
                  sent7(o7out), sent7(o7riv), (o7riv or {}).get("stale"), sent7(o7ed)))

# 7c. a river tile is read again after a day (review fix 3): the buoy overlay is reissued most days
_refresh0, _grid_make0, _fetch_tile0 = A._tile_refresh_later, A._grid_make, A.fetch_enc_tile
asked7c = []
A._tile_refresh_later = lambda t: asked7c.append(A._bbox_key(t))
NOW7 = time.time()
RIVER_SRC = dict(NOAA_ALL, enc_river="cells")


def kept7(t, bands, age, src):
    clear7(t)
    A._write_tile_jsonl(A._tile_path(t), {"tile": t, "bands": bands, "unread": [], "unread_failed": [], "partial": [],
                                          "complete": True, "reader": A._ENC_TILE_READER, "read_at": NOW7 - age,
                                          "sources": src, "cells_reader": TAG, "features": []})


try:
    tile7 = {}
    for name, t, bands, age, src in (("river, 2 days", TILE, ["enc_harbour", "enc_river"], 2 * DAY, RIVER_SRC),
                                     ("river, 2 hours", CTRL, ["enc_river"], 7200.0, RIVER_SRC),
                                     ("NOAA's, 2 days", MAINE, ["enc_harbour"], 2 * DAY, dict(NOAA_ALL)),
                                     ("NOAA's, 8 days", [-70.0, 43.0, -69.75, 43.25], ["enc_harbour"], 8 * DAY,
                                      dict(NOAA_ALL))):
        kept7(t, bands, age, src)
        del asked7c[:]
        got7 = A.fetch_enc_tile(t)
        tile7[name] = (got7.get("read_at") == NOW7 - age, bool(asked7c))
    grid7 = {}
    for name, bands, age in (("river, 2 days", ["enc_river"], 2 * DAY), ("NOAA's, 2 days", ["enc_harbour"], 2 * DAY)):
        A._grid_make = lambda t, k, b=bands, a=age: ({"bands": b, "read_at": NOW7 - a, "complete": True}, b"")
        del asked7c[:]
        A.fetch_enc_grid(MAINE)
        grid7[name] = bool(asked7c)
    T7 = A._enc_tiles([-91.2, 30.6, -90.9, 30.65])
    A.fetch_enc_tile = lambda t: {"tile": t, "features": [], "unread": [], "unread_failed": [], "partial": [],
                                  "complete": True, "read_at": NOW7 - 2 * DAY,
                                  "bands": ["enc_river"] if t == T7[0] else ["enc_harbour"]}
    lay7 = A.fetch_enc_layered([-91.2, 30.6, -90.9, 30.65])
finally:
    A._tile_refresh_later, A._grid_make, A.fetch_enc_tile = _refresh0, _grid_make0, _fetch_tile0
    clear7(TILE, CTRL, MAINE, [-70.0, 43.0, -69.75, 43.25])
check("7c. A TILE OF THE CORPS' RIVER CHART IS READ AGAIN AFTER A DAY (review, 2026-11-23: its buoys are reissued most "
      "days as the Coast Guard moves them, and a river tile was served as current a week): a kept river tile two days "
      "old served and read again behind it, two hours old not; NOAA's tiles at their week, as before; the grid by its "
      "header the same; and the layered read's age counts the river tile past its day, apart (aged_river)",
      lambda: tile7 == {"river, 2 days": (True, True), "river, 2 hours": (True, False),
                        "NOAA's, 2 days": (True, False), "NOAA's, 8 days": (True, True)}
              and grid7 == {"river, 2 days": True, "NOAA's, 2 days": False}
              and len(T7) == 2 and (lay7.get("aged"), lay7.get("aged_river")) == (1, 1),
      lambda: "tiles (served, read again) %s; grids %s; layered over %d tiles: aged %r, of the river %r" % (
          tile7, grid7, len(T7), lay7.get("aged"), lay7.get("aged_river")))

# ── 8. the tile's child ──────────────────────────────────────────────────────────────────────────────────────────────
seen8 = {}
_run0 = subprocess.run


def run8(cmd, **kw):
    seen8["cmd"] = list(cmd)
    return subprocess.CompletedProcess(cmd, 1)


A.subprocess.run = run8
try:
    A._enc_tile_build_child(TILE)
finally:
    A.subprocess.run = _run0
cmd8 = seen8.get("cmd") or []
fake8 = os.path.join(TMP, "fake8.json")
with open(fake8, "w") as f:
    json.dump({"crash": True}, f)                     # the worker stops once its arguments are read
other8 = os.path.join(TMP, "ienc_child")
sav8 = (A.ENC_DIR, A.S57_DIR, A.IENC_DIR, A.ENC_SOURCE)
os.environ["ASV_ENC_TILE_FAKE"] = fake8
try:
    rc8 = A._enc_tile_worker_main(["--tile=" + ",".join(repr(float(v)) for v in TILE), "--enc-dir", A.ENC_DIR,
                                   "--out", os.path.join(TMP, "out8"), "--ienc-dir", other8])
    got8 = A.IENC_DIR
finally:
    os.environ.pop("ASV_ENC_TILE_FAKE", None)
    A.ENC_DIR, A.S57_DIR, A.IENC_DIR, A.ENC_SOURCE = sav8
check("8. THE CHILD THAT BUILDS A TILE IS TOLD THE CONSOLE'S RIVER FOLDER (--ienc-dir IENC_DIR), and reads it - a "
      "console given its own state folder read the river cells of the install's otherwise",
      lambda: "--ienc-dir" in cmd8 and cmd8[cmd8.index("--ienc-dir") + 1] == A.IENC_DIR and rc8 == 3 and got8 == other8,
      lambda: "told %s; the worker read %s (exit %s)" % (cmd8[cmd8.index("--ienc-dir") + 1] if "--ienc-dir" in cmd8
                                                         else "nothing", got8, rc8))

# ── 9. the depths as charted (keepouts.js) ───────────────────────────────────────────────────────────────────────────
JS9 = r"""
const K = require(process.argv[2]), G = require(process.argv[3]);
const F = G.planeFrame({ lat: 30.6, lon: -91.1 });
const sq = [[[-91.101, 30.599], [-91.099, 30.599], [-91.099, 30.601], [-91.101, 30.601], [-91.101, 30.599]]];
const area = (band, d1, d2) => ({ role: "depth_area", cls: "Depth_Area", band, props: { DRVAL1: d1, DRVAL2: d2 },
                                  geometry: { type: "Polygon", coordinates: sq } });
const rock = (band, vs) => ({ role: "hazard_point", cls: "Obstruction_point", band, props: { VALSOU: vs },
                              geometry: { type: "Point", coordinates: [-91.1, 30.6] } });
const snd = (band, d) => ({ role: "sounding", cls: "Sounding_point", band, props: {},
                            geometry: { type: "MultiPoint", coordinates: [[-91.1, 30.6, d]] } });
const M = { minDepthM: 2.0, depthRange: { min: 2.0, max: 0 }, marginM: 1.0, waterOffsetM: 1.0 };
const out = {};
for (const band of ["enc_river", "enc_approach"]) {
  out[band] = {
    rise: K.depthExcluded(area(band, 1.0, 1.5), { min: 2.0, max: 0 }, 1.0),
    fall: K.depthExcluded(area(band, 2.2, 2.4), { min: 2.0, max: 0 }, -0.6),
    rock: K.hazPassable(rock(band, 2.5), { minDepthM: 2.0, waterOffsetM: 1.0 }),
    margin: K.deepKeepouts(F, [area(band, 2.5, 3.5)], M).counts.areas,
    rockMargin: K.deepKeepouts(F, [rock(band, 3.2)], M).counts.rocks,
    sounding: K.deepKeepouts(F, [snd(band, 2.5)], M).points.length,
    charted: K.asCharted({ band }, 1.25),
  };
}
console.log(JSON.stringify(out));
"""
js9 = os.path.join(TMP, "as_charted.js")
with open(js9, "w", encoding="utf-8") as f:
    f.write(JS9)
node9 = shutil.which("node")
res9, why9 = {}, "node is not on the PATH"
if node9:
    p9 = subprocess.run([node9, js9, os.path.join(APP, "static", "js", "keepouts.js"),
                         os.path.join(APP, "static", "js", "geodesy.js")], capture_output=True, text=True, timeout=120)
    why9 = (p9.stderr or p9.stdout or "")[-300:]
    try:
        res9 = json.loads(p9.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        res9 = {}
check("9. A RIVER CHART'S DEPTHS ARE READ AS CHARTED (keepouts.js asCharted): below the river's own low-water reference, "
      "they take no tide station's level - a station 1 m over its datum does not make a 1.0-1.5 m river area legal at a "
      "2 m floor, nor 0.6 m under it make a 2.2-2.4 m one a keep-out; a river rock's 2.5 m sounding not passable at "
      "the floor's meter of margin, its depth area and sounding in the margin layer, its 3.2 m rock kept a berth off - "
      "where NOAA's same features, which a tide station's level is measured with, take it each way",
      lambda: res9.get("enc_river") == {"rise": True, "fall": False, "rock": False, "margin": 1, "rockMargin": 1,
                                        "sounding": 1, "charted": 0}
              and res9.get("enc_approach") == {"rise": False, "fall": True, "rock": True, "margin": 0, "rockMargin": 0,
                                               "sounding": 0, "charted": 1.25},
      lambda: res9 or why9)

A._enc_coverage, A.fetch_enc_features, A.fetch_chart_info = _cov0, _feat0, _info0
shutil.rmtree(TMP, ignore_errors=True)
if fails:
    print("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran))
    sys.exit(1)
print("all checks passed (%d)" % ran)
