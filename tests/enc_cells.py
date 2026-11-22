"""enc_cells.py - NOAA's cells as the console's chart source (enc_cells.py, asv_console's cells block), on cells this
suite builds byte by byte (tests/lib/s57_writer.py), a catalog of its own and a network that is a function. Hermetic:
no NOAA host is asked and nothing is written outside a temp folder; one real tile-build child, reading that folder.

WHAT IT HOLDS THE SOURCE TO (Andy, 2026-11-21: "go ahead with phase 2, adding the cells to the console as a chart
source", and "the console should show the pontoons and the other features ENCDirect never served"):
  1  a class read from a cell takes ENCDirect's name for it in that band - the page keys on those names - else another
     band's, else the rule's; the pontoons take the dock roles, the classes ENCDirect never served arrive `extra`;
  2  a tile is built from the cells, every band, through ENCDirect's breaker;
  3  ONE SOURCE A BAND: a band whose cells cannot be read is read from ENCDirect whole - coverage and features - and a
     band the cells answered is never filled from ENCDirect;
  4  a cell read from an older copy is served and never kept, and says so; the current one, once had, replaces it;
     a cell two tiles read at two updates is one feature, the newer update's; at two editions, two, both held;
  5  the catalog and the downloads: refreshed by age, a failed refresh keeps the copy, a download that is not a whole
     cell refused, a cell the catalog does not name never read, the hold-offs kept on disk for the next process; a
     catalog past its age said in every process and what is read through it never kept; one from the future due;
  6  a cell is parsed once: its read kept beside it, by this reader, and read back;
  7  the band pick, snap-to-water's read and the chart card read from the cells, ENCDirect only when they cannot be;
  8  the console's one TLS context; the child that builds a tile reads the console's cells and source;
  9  a tile ENCDirect's reader kept (tile_v3) is the fallback, its clearances kept, saying what it lacks; a re-read
     behind a served tile is not stopped by ENCDirect's breaker.
"""
import io
import json
import math
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.error
import urllib.request


def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from s57_writer import COMF, W, _field, edge_ptr, node_ptr, zipped    # noqa: E402
import s57                                              # noqa: E402
import enc_cells                                        # noqa: E402
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


TMP = tempfile.mkdtemp(prefix="asv_enc_cells_")
A.ENC_DIR = os.path.join(TMP, "enc")
A.S57_DIR = os.path.join(TMP, "s57")
A.ENC_SOURCE = "cells"
A.ENC_TILE_IN_PROCESS = True
os.makedirs(A.ENC_DIR)


# ── the cells ───────────────────────────────────────────────────────────────────────────────────────────────────────
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

    def zip(self, updates=()):
        """The cell's zip as NOAA serves it: the base cell, and each (n, bytes) update after it."""
        files_ = {"ENC_ROOT/%s/%s.000" % (self.name, self.name): self.w.bytes()}
        for n, data in updates:
            files_["ENC_ROOT/%s/%s.%03d" % (self.name, self.name, n)] = data
        return zipped(files_)


TILE = [-70.25, 43.0, -70.0, 43.25]
HA, HB = [-70.20, 43.05, -70.10, 43.15], [-70.10, 43.05, -70.00, 43.15]     # two harbor cells, side by side
AP = [-70.30, 42.95, -69.95, 43.30]                                         # the approach cell under the whole tile
CO = [-71.0, 42.5, -69.5, 43.5]
IN_HA = [-70.17, 43.08, -70.12, 43.13]

ha = Cell("US5TSTAA")
ha.area("M_COVR", HA, {"CATCOV": "1"})
ha.area("DEPARE", HA, {"DRVAL1": "2.5", "DRVAL2": "5"})
ha.area("LNDARE", [-70.19, 43.06, -70.18, 43.07])
PONTON_LINE = ha.line("PONTON", (-70.15, 43.10), (-70.14, 43.10))
PONTON_AREA = ha.area("PONTON", [-70.13, 43.11, -70.125, 43.115])
NEWOBJ = ha.point("NEWOBJ", (-70.16, 43.12), {"OBJNAM": "V-AIS Test"})
ha.area("MAGVAR", HA, {"VALMAG": "-15.2"})
ha.line("PIPSOL", (-70.17, 43.06), (-70.17, 43.14))
ha.area("RESARE", [-70.12, 43.13, -70.11, 43.14], {"CATREA": "27"})
ha.point("TOPMAR", (-70.155, 43.125))
ha.area("M_QUAL", HA, {"CATZOC": "2", "SURSTA": "20010101"})
ha.line("SLCONS", (-70.15, 43.09), (-70.14, 43.09), {"CATSLC": "4"})

hb = Cell("US5TSTAB")
hb.area("M_COVR", HB, {"CATCOV": "1"})
hb.area("DEPARE", HB, {"DRVAL1": "6", "DRVAL2": "10"})

ap = Cell("US4TSTAA")
ap.area("M_COVR", AP, {"CATCOV": "1"})
ap.area("M_COVR", [-70.24, 43.20, -70.22, 43.22], {"CATCOV": "2"})          # "no coverage available": not coverage
ap.area("DEPARE", AP, {"DRVAL1": "10", "DRVAL2": "20"})
ap.area("RESARE", [-70.05, 43.20, -70.04, 43.21])

co = Cell("US3TSTAA")
co.area("M_COVR", CO, {"CATCOV": "1"})
co.area("DEPARE", CO, {"DRVAL1": "20", "DRVAL2": "50"})
co.area("RESARE", [-70.05, 43.20, -70.04, 43.21])

ha2 = Cell("US5TSTAA", edtn="2")                     # the harbor cell's next edition: the pontoon gone, a wharf instead
ha2.area("M_COVR", HA, {"CATCOV": "1"})
ha2.area("DEPARE", HA, {"DRVAL1": "2.5", "DRVAL2": "5"})
ha2.line("SLCONS", (-70.15, 43.10), (-70.14, 43.10), {"CATSLC": "4"})

zz = Cell("US5TSTZZ")                                # a cell the catalog no longer names (canceled), still on disk
zz.area("M_COVR", HA, {"CATCOV": "1"})
zz.area("DEPARE", HA, {"DRVAL1": "0.5", "DRVAL2": "1"})

ZIPS = {"US5TSTAA": ha.zip(), "US5TSTAB": hb.zip(), "US4TSTAA": ap.zip(), "US3TSTAA": co.zip()}
ZIP_ED2 = ha2.zip()
BAND_NO = {"US5": 5, "US4": 4, "US3": 3}
TITLES = {"US5TSTAA": "Test Harbor A", "US5TSTAB": "Test Harbor B", "US4TSTAA": "Test Approach", "US3TSTAA": "Test Coast"}
BOXES = {"US5TSTAA": HA, "US5TSTAB": HB, "US4TSTAA": AP, "US3TSTAA": CO}


def merc(lon, lat):
    r = 6378137.0
    return [math.radians(lon) * r, r * math.log(math.tan(math.pi / 4 + math.radians(lat) / 2))]


def catalog(eds=None, boxes=None):
    """NOAA's catalog as it is shaped: EPSG:3857 footprints, enc_ed_up, scale_band, title. `boxes`: its cells
    (BOXES by default)."""
    eds = eds or {}
    feats = []
    for name, (w_, s_, e_, n_) in (boxes or BOXES).items():
        ed, up = eds.get(name, (1, 0))
        feats.append({"type": "Feature", "properties": {"enc_ed_up": "%s_ED%03d_UP%03d" % (name, ed, up),
                                                        "scale_band": BAND_NO[name[:3]], "title": TITLES.get(name, name)},
                      "geometry": {"type": "Polygon", "coordinates": [[merc(w_, s_), merc(e_, s_), merc(e_, n_),
                                                                       merc(w_, n_), merc(w_, s_)]]}})
    return json.dumps({"type": "FeatureCollection", "features": feats}).encode("utf-8")


class Net:
    """The network: url -> bytes. `down` names what does not answer (a cell, or "catalog"); `bad` cells answer an
    error page; `http` cells answer HTTP 404."""
    def __init__(self, cat=None, zips=None):
        self.cat = cat or catalog()
        self.zips = dict(zips or ZIPS)
        self.down, self.bad, self.http = set(), set(), set()
        self.calls = []

    def __call__(self, url):
        self.calls.append(url)
        what = "catalog" if url == enc_cells.CATALOG_URL else url.rsplit("/", 1)[-1][:-4]
        if what in self.http:
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, io.BytesIO(b""))
        if what in self.down:
            raise urllib.error.URLError("timed out")
        if what == "catalog":
            return self.cat
        if what in self.bad:
            return b"<html>Service unavailable</html>"
        return self.zips[what]

    def asked(self, name):
        return self.calls.count(enc_cells.CELL_URL % name)


def fresh(net, root=None, now=None):
    """A cell source on a clean `root` (the suite's S57_DIR by default), as the console makes it - with `net`."""
    root = root or A.S57_DIR
    shutil.rmtree(root, ignore_errors=True)
    src = enc_cells.CellSource(root, ssl_context=A._enc_ssl, fetch=net, now=now)
    if root == A.S57_DIR:
        A._enc_cells_src = src
    return src


def again(net, root=None, now=None):
    """A second process on the same folder: a new source, nothing in memory, the files as they are."""
    src = enc_cells.CellSource(root or A.S57_DIR, ssl_context=A._enc_ssl, fetch=net, now=now)
    if (root or A.S57_DIR) == A.S57_DIR:
        A._enc_cells_src = src
    return src


def keep_all(src, but=()):
    """Every catalog cell downloaded and kept, but those named."""
    for e in src.catalog():
        if e["name"] not in but:
            src.cell_path(e)


def by_oid(feats, cell, rcid):
    """The features of the cell's record `rcid`, whatever edition and update they were read from."""
    pat = re.compile(r"^%s_ED\d{3}_UP\d{3}:%d$" % (cell, rcid))
    return [f for f in feats if pat.match(str(f.get("oid")))]


def raises(fn, kind=OSError):
    try:
        fn()
    except kind:
        return True
    return False


def files(d):
    try:
        return sorted(os.listdir(d))
    except OSError:
        return []


ENTRY_B = {"name": "US5TSTAB", "key": "US5TSTAB_ED001_UP000", "ed": 1, "up": 0}

# ── 1. names and roles ──────────────────────────────────────────────────────────────────────────────────────────────
net = Net()
fresh(net)
hn, cn = A._cell_namer("enc_harbour"), A._cell_namer("enc_coastal")
names = {"RESARE harbour": hn("RESARE", 3), "RESARE coastal": cn("RESARE", 3), "PONTON line harbour": hn("PONTON", 2),
         "PONTON area": hn("PONTON", 3), "TOPMAR": hn("TOPMAR", 1), "M_QUAL": hn("M_QUAL", 3),
         "BUAARE point": hn("BUAARE", 1), "collection": hn("C_AGGR", 4)}
check("1. A CLASS READ FROM A CELL TAKES ENCDIRECT'S NAME FOR IT IN THAT BAND - the page finds features by these names - "
      "else another band's, else the rule's: a restricted area is Restricted_Area_area in the harbor band and "
      "Restricted_Area in the coastal; a harbor pontoon line Pontoon_line (served in the coastal band only); a pontoon "
      "AREA, which no band served, Pontoon_area by the rule; ENCDirect's own spellings kept (Topmark_point, "
      "Quality_of_Data_area, Builtup_Area_point, where the rule says Top_Mark / Of / Built_Up); a collection, no name",
      lambda: names == {"RESARE harbour": "Restricted_Area_area", "RESARE coastal": "Restricted_Area",
                        "PONTON line harbour": "Pontoon_line", "PONTON area": "Pontoon_area", "TOPMAR": "Topmark_point",
                        "M_QUAL": "Quality_of_Data_area", "BUAARE point": "Builtup_Area_point", "collection": None},
      lambda: names)

ext = A._cells_extract("enc_harbour", HA)
role = {(f["cls"]): f["role"] for f in ext["features"]}
pl = by_oid(ext["features"], "US5TSTAA", PONTON_LINE)
pa = by_oid(ext["features"], "US5TSTAA", PONTON_AREA)
nw = by_oid(ext["features"], "US5TSTAA", NEWOBJ)
dep = [f for f in ext["features"] if f["cls"] == "Depth_Area"]
check("1b. THE PONTOONS ARE DOCKS (kept clear, drawn as structures): Pontoon_line dock_line, Pontoon_area dock - "
      "and what ENCDirect never served besides arrives `extra`, never a keep-out: the virtual AIS mark (New_Object_point, "
      "a broadcast with nothing in the water), magnetic variation, the pipeline; each with its oid <CELL>_ED<n>_UP<n>:<record>, its "
      "numbers numbers (DRVAL1 2.5), the answer whole and named the cells'",
      lambda: [f["role"] for f in pl] == ["dock_line"] and [f["role"] for f in pa] == ["dock"]
              and [(f["cls"], f["role"]) for f in nw] == [("New_Object_point", "extra")]
              and role.get("Magnetic_Variation_area") == "extra" and role.get("Pipeline_Submarine_on_land_line") == "extra"
              and role.get("Shoreline_Construction_line") == "dock_line" and role.get("Restricted_Area_area") == "restricted"
              and sorted(f["props"].get("DRVAL1") for f in dep) == [2.5, 6.0] and ext.get("complete")
              and ext["source"] == "cells" and ext["cells"] == ["US5TSTAA", "US5TSTAB"],
      lambda: "pontoon line %s, area %s, newobj %s, roles %s, depth %s, cells %s"
              % ([f["role"] for f in pl], [f["role"] for f in pa], [(f["cls"], f["role"]) for f in nw],
                 sorted(role.items()), [f["props"].get("DRVAL1") for f in dep], ext.get("cells")))
named = A._cells_extract("enc_harbour", HA, extras=False)
check("1c. ... and a read of the named roles alone (extras False) leaves the `extra` classes out, the pontoons in",
      lambda: not any(f["role"] == "extra" for f in named["features"])
              and by_oid(named["features"], "US5TSTAA", PONTON_LINE) and not by_oid(named["features"], "US5TSTAA", NEWOBJ),
      lambda: sorted({f["role"] for f in named["features"]}))

cov = A._cells_coverage("enc_approach", TILE)
cov_h = A._cells_coverage("enc_harbour", TILE)       # the harbor cells just read WHOLE (1b): their coverage alone still
bbs = lambda cs: sorted(A._geom_bbox({"type": "Polygon", "coordinates": c}) for c in cs)     # noqa: E731
check("1d. A BAND'S COVERAGE from its cells' M_COVR: \"coverage available\" polygons only - the approach cell's "
      "\"no coverage available\" square inside the tile is not coverage; and a band whose cells were just read whole "
      "answers its coverage with the coverage alone, not every area in them",
      lambda: bbs(cov) == [AP] and bbs(cov_h) == [HA, HB],
      lambda: "approach %s; harbor %s" % (bbs(cov), bbs(cov_h)))
near = A._cells_extract("enc_harbour", [-70.152, 43.098, -70.138, 43.102])      # a box round the pontoon line
near_cls = sorted({f["cls"] for f in near["features"]})
check("1e. A READ TAKES WHAT REACHES INTO ITS BOX (ENCDirect's envelope query): round the pontoon line, the pontoon and "
      "the areas the box lies inside - not the virtual mark, the land or the pipeline elsewhere in the cell",
      lambda: near_cls == ["Coverage_area", "Depth_Area", "Magnetic_Variation_area", "Pontoon_line",
                           "Quality_of_Data_area"],
      lambda: near_cls)

# ── 2. a tile from the cells ────────────────────────────────────────────────────────────────────────────────────────
A._enc_down_until = time.monotonic() + 30.0          # ENCDirect's breaker armed: the cells are read through it
t2 = A._enc_tile_build(TILE)
A._enc_down_until = 0.0
fb = {(f["band"], f["cls"]) for f in t2["features"]}
check("2. A TILE FROM THE CELLS, every band, with ENCDirect's breaker ARMED (it stops ENCDirect alone): whole, every "
      "band's source the cells, the harbor chart where its two cells cover and the approach chart around them, the "
      "coastal chart nowhere (the approach chart covers the whole tile), no water unread; the harbor pontoons in, "
      "as docks; written by reader 4, kept as tile_v4",
      lambda: t2.get("complete") and set(t2["sources"].values()) == {"cells"} and len(t2["sources"]) == 6
              and t2["bands"] == ["enc_harbour", "enc_approach"] and not t2["unread"] and not t2["unread_failed"]
              and ("enc_harbour", "Pontoon_line") in fb and ("enc_harbour", "Pontoon_area") in fb
              and t2["reader"] == 4 and A._ENC_TILE_FMT == "tile_v4_%s.jsonl" and not t2.get("stale_cells"),
      lambda: "complete %s sources %s bands %s unread %s/%s note %r" % (
          t2.get("complete"), t2.get("sources"), t2.get("bands"), t2.get("unread"), t2.get("unread_failed"), t2.get("note")))

# ── 3. one source a band ────────────────────────────────────────────────────────────────────────────────────────────
net3 = Net()
src3 = fresh(net3)
keep_all(src3, but=("US5TSTAB",))
net3.down.add("US5TSTAB")                            # one harbor cell cannot be had, and none is kept
asked = {"cov": [], "feats": []}
_cov0, _feat0 = A._enc_coverage, A.fetch_enc_features
SQ_H = [[[HA[0], HA[1]], [HB[2], HA[1]], [HB[2], HA[3]], [HA[0], HA[3]], [HA[0], HA[1]]]]


def encdirect_cov(band, tile):
    asked["cov"].append(band)
    return [SQ_H] if band == "enc_harbour" else []


def feats_spy(region, md=0.0, band=None, extras=True, use_cache=True, source=None):
    asked["feats"].append((band, source))
    if source == "encdirect":
        return {"band": band, "partial": [], "complete": True, "features": [
            {"role": "depth_area", "cls": "Depth_Area", "props": {"DRVAL1": 3.0}, "oid": 9001,
             "geometry": {"type": "Polygon", "coordinates": SQ_H}}]}
    return _feat0(region, md, band=band, extras=extras, use_cache=use_cache, source=source)


A._enc_coverage, A.fetch_enc_features = encdirect_cov, feats_spy
try:
    t3 = A._enc_tile_build(TILE)
finally:
    A._enc_coverage, A.fetch_enc_features = _cov0, _feat0
h3 = [f for f in t3["features"] if f["band"] == "enc_harbour"]
check("3. ONE SOURCE A BAND: a harbor cell that can be neither downloaded nor found kept makes the harbor band "
      "ENCDirect's WHOLE - its coverage asked of ENCDirect and its features too (source encdirect), not one feature of "
      "the harbor cell that WAS had - while the approach band, its cell kept, stays the cells'; the tile NOT whole: "
      "the band ENCDirect's is said (`stale`, `encdirect_bands`), so it is never kept as the cells' chart (review "
      "fix 6)",
      lambda: t3["sources"]["enc_harbour"] == "encdirect" and t3["sources"]["enc_approach"] == "cells"
              and asked["cov"] == ["enc_harbour"] and ("enc_harbour", "encdirect") in asked["feats"]
              and ("enc_approach", "cells") in asked["feats"] and [f["oid"] for f in h3] == [9001]
              and not t3.get("complete") and t3.get("encdirect_bands") == ["enc_harbour"]
              and "for the harbor chart: it is read from NOAA's ENCDirect" in (t3.get("stale") or "")
              and t3.get("note") == t3["stale"] and t3.get("cells_reader") == enc_cells.reader_tag(),
      lambda: "sources %s, ENCDirect coverage asked %s, features asked %s, harbor oids %s, complete %s, from "
              "ENCDirect %s, note %r" % (t3.get("sources"), asked["cov"], asked["feats"],
                                         sorted({str(f["oid"]) for f in h3})[:5], t3.get("complete"),
                                         t3.get("encdirect_bands"), t3.get("note")))
n3 = net3.asked("US5TSTAB")
blocked = raises(lambda: again(net3).cell_path(ENTRY_B))
neth = Net()
neth.http.add("US5TSTAB")
srch = fresh(neth, os.path.join(TMP, "s57_http"))
http_twice = raises(lambda: srch.cell_path(ENTRY_B)) and raises(lambda: srch.cell_path(ENTRY_B))
check("3b. ... and a download that did not answer HOLDS OFF the network (DOWN_S) ON DISK, so the next process - the next "
      "tile's child - asks nothing either and fails at once; a refusal WITH an answer (HTTP 404) holds off nothing",
      lambda: src3._marked("down.mark", enc_cells.DOWN_S) and blocked and net3.asked("US5TSTAB") == n3 == 1
              and http_twice and neth.asked("US5TSTAB") == 2 and not srch._marked("down.mark", enc_cells.DOWN_S),
      lambda: "marked %s; the next process refused %s, asked %d time(s); HTTP 404: refused twice %s, asked %d, marked %s"
              % (src3._marked("down.mark", enc_cells.DOWN_S), blocked, net3.asked("US5TSTAB"), http_twice,
                 neth.asked("US5TSTAB"), srch._marked("down.mark", enc_cells.DOWN_S)))

# ── 4. a cell from an older copy ────────────────────────────────────────────────────────────────────────────────────
net4 = Net(cat=catalog({"US5TSTAA": (2, 0)}), zips=dict(ZIPS, US5TSTAA=ZIP_ED2))
src4 = fresh(net4)
keep_all(src4, but=("US5TSTAA",))
with open(os.path.join(src4.cells_dir, "US5TSTAA_ED001_UP000.zip"), "wb") as f:
    f.write(ZIPS["US5TSTAA"])                        # last edition's copy, kept from before
net4.down.add("US5TSTAA")                            # this edition does not come down
A._enc_tile_mem.clear()
t4 = A.fetch_enc_tile(TILE)
kept4 = os.path.exists(A._tile_path(TILE))
lay4 = A.fetch_enc_layered(IN_HA)
check("4. A CELL WHOSE CURRENT EDITION CANNOT BE DOWNLOADED is read from the copy kept: the tile is served - the older "
      "edition's pontoon in it - NOT complete, NOT kept, `stale_cells` and the note naming the cell; the layered read "
      "says it too and is not whole - and says it where the PAGE reads it, `stale` (OLDER CHART IN USE): it was in "
      "the tile's note alone, which the layered read passes on only when no band was read (review fix 7)",
      lambda: not t4.get("complete") and not kept4 and t4.get("stale_cells") == ["US5TSTAA"]
              and "older copy of US5TSTAA" in (t4.get("note") or "") and by_oid(t4["features"], "US5TSTAA", PONTON_LINE)
              and lay4.get("stale_cells") == ["US5TSTAA"] and not lay4.get("complete")
              and lay4.get("stale") == ["the current edition or update of US5TSTAA could not be downloaded: it is read "
                                        "from an older copy - a correction NOAA issued since is not in it"]
              and t4.get("stale") == lay4["stale"][0],
      lambda: "complete %s kept %s stale_cells %s note %r; layered stale_cells %s complete %s stale %r"
              % (t4.get("complete"), kept4, t4.get("stale_cells"), t4.get("note"), lay4.get("stale_cells"),
                 lay4.get("complete"), lay4.get("stale")))
net4.down.discard("US5TSTAA")
os.remove(os.path.join(A.S57_DIR, "down.mark"))
again(net4)
A._enc_tile_mem.clear()
t4b = A.fetch_enc_tile(TILE)
c4 = files(src4.cells_dir)
r4 = [n for n in files(src4.read_dir) if n.startswith("US5TSTAA_")]
check("4b. ... and once it comes down, the current edition is read - the pontoon it removed gone, the wharf it added in "
      "- the tile whole and kept, the older copy and its kept read removed",
      lambda: t4b.get("complete") and os.path.exists(A._tile_path(TILE)) and not t4b.get("stale_cells")
              and not by_oid(t4b["features"], "US5TSTAA", PONTON_LINE)
              and "US5TSTAA_ED002_UP000.zip" in c4 and "US5TSTAA_ED001_UP000.zip" not in c4
              and len(r4) == 1 and r4[0].startswith("US5TSTAA_ED002_UP000."),
      lambda: "complete %s kept %s; cells %s; reads %s" % (t4b.get("complete"), os.path.exists(A._tile_path(TILE)), c4, r4))
os.remove(A._tile_path(TILE))

# ── 4c/4d. one cell, read at two updates (or two editions) by the two tiles it lies across ──────────────────────────
HX = [-70.05, 43.05, -69.95, 43.15]                  # a harbor cell across the tiles' edge at 70 W
APX = [-70.30, 42.95, -69.70, 43.30]
T2X = [-70.0, 43.0, -69.75, 43.25]                   # the tile east of TILE
P_OLD, P_NEW = (-70.02, 43.10), (-69.98, 43.10)       # an obstruction in TILE; NOAA's correction puts it in T2X
BOX_X = {"US5TSTXX": HX, "US4TSTXX": APX}
LAY_X = [-70.10, 43.05, -69.90, 43.15]               # the layered read across both tiles


def harbor_x(edtn="1", renumbered=False):
    c = Cell("US5TSTXX", edtn=edtn)
    c.area("M_COVR", HX, {"CATCOV": "1"})
    c.area("DEPARE", HX, {"DRVAL1": "8", "DRVAL2": "12"})
    c.w.node(5000, *(P_NEW if renumbered else P_OLD), rcnm=110)
    c.w.feature(4, "OBSTRN", 1, {"VALSOU": "0.5", "WATLEV": "3"}, [node_ptr(5000)])
    if renumbered:                                   # the next edition renumbers: record 4 a NEW obstruction at P_NEW,
        c.w.node(5001, *P_OLD, rcnm=110)             # the old one record 5, still at P_OLD
        c.w.feature(5, "OBSTRN", 1, {"VALSOU": "0.5", "WATLEV": "3"}, [node_ptr(5001)])
    return c


up_move = W(name="US5TSTXX.001", updn=1, isdt="20261120")         # update 1: the obstruction's node moved, in place
up_move.raw([("VRID", _field("VRID", [(110, 5000, 2, 3)])), ("SGCC", _field("SGCC", [(3, 1, 1)])),
             ("SG2D", _field("SG2D", [(round(P_NEW[1] * COMF), round(P_NEW[0] * COMF))]))])
apx = Cell("US4TSTXX")
apx.area("M_COVR", APX, {"CATCOV": "1"})
apx.area("DEPARE", APX, {"DRVAL1": "10", "DRVAL2": "20"})


def obstructions(fs):
    return sorted((f["oid"], tuple(round(v, 3) for v in f["geometry"]["coordinates"][:2]))
                  for f in fs if f["cls"] == "Obstruction_point")


def two_reads(zip0, zip1, eds1):
    """TILE read and kept from zip0; NOAA then issues zip1 (`eds1` in its catalog) and T2X is read from it; then the
    layered read across both - TILE still the copy kept from zip0."""
    net = Net(cat=catalog(boxes=BOX_X), zips={"US5TSTXX": zip0, "US4TSTXX": apx.zip()})
    fresh(net)
    A._enc_tile_mem.clear()
    first = A.fetch_enc_tile(TILE)
    net.cat, net.zips["US5TSTXX"] = catalog({"US5TSTXX": eds1}, boxes=BOX_X), zip1
    aged = time.time() - 2 * enc_cells.CATALOG_MAX_AGE_S
    os.utime(os.path.join(A.S57_DIR, "enc.geojson"), (aged, aged))          # the catalog due: the next read refreshes
    again(net)
    second = A.fetch_enc_tile(T2X)
    lay = A.fetch_enc_layered(LAY_X)
    for t in (TILE, T2X):
        if os.path.exists(A._tile_path(t)):
            os.remove(A._tile_path(t))
    A._enc_tile_mem.clear()
    deps = sorted(f["oid"] for f in lay["features"] if f["band"] == "enc_harbour" and f["cls"] == "Depth_Area")
    return obstructions(first["features"]), obstructions(second["features"]), obstructions(lay["features"]), deps


o1, o2, olay, dlay = two_reads(harbor_x().zip(), harbor_x().zip(updates=[(1, up_move.bytes())]), (1, 1))
check("4c. ONE CELL READ AT TWO UPDATES BY THE TWO TILES IT LIES ACROSS is ONE feature to the layered read - the NEWER "
      "update's: the tile kept from update 0 holds the obstruction where update 0 charted it, the tile read after "
      "update 1 holds it where update 1 moved it, and the layered read holds it there alone (the oid names the update "
      "read: \"<CELL>_ED<n>_UP<n>:<record>\"); it kept the first tile's copy, and the obstruction stood where NOAA "
      "no longer charts it while NOAA's position was dropped (the 2026-11-21 review); the depth area both tiles hold, "
      "once, update 1's",
      lambda: o1 == [("US5TSTXX_ED001_UP000:4", P_OLD)] and o2 == [("US5TSTXX_ED001_UP001:4", P_NEW)]
              and olay == [("US5TSTXX_ED001_UP001:4", P_NEW)] and dlay == ["US5TSTXX_ED001_UP001:3"],
      lambda: "first tile %s; second %s; layered %s; harbor depth areas %s" % (o1, o2, olay, dlay))
o1, o2, olay, dlay = two_reads(harbor_x().zip(), harbor_x(edtn="2", renumbered=True).zip(), (2, 0))
check("4d. ... but TWO EDITIONS' copies are two features, both held: a new edition renumbers its records, and here its "
      "record 4 is a new obstruction while the old one, record 5, lies in the tile still read at edition 1 - taking "
      "edition 2's record 4 for edition 1's would drop an obstruction NOAA still charts",
      lambda: olay == [("US5TSTXX_ED001_UP000:4", P_OLD), ("US5TSTXX_ED002_UP000:4", P_NEW)]
              and dlay == ["US5TSTXX_ED001_UP000:3", "US5TSTXX_ED002_UP000:3"],
      lambda: "first tile %s; second %s; layered %s; harbor depth areas %s" % (o1, o2, olay, dlay))

# ── 5. the catalog and the downloads ────────────────────────────────────────────────────────────────────────────────
clock = [time.time()]
net5 = Net()
src5 = fresh(net5, now=lambda: clock[0])
src5.catalog()
n_first = net5.calls.count(enc_cells.CATALOG_URL)
clock[0] += 3600
src5.catalog()
n_young = net5.calls.count(enc_cells.CATALOG_URL)
clock[0] += enc_cells.CATALOG_MAX_AGE_S
net5.cat = catalog({"US5TSTAA": (2, 0)})
cat_old = {e["name"]: e["ed"] for e in src5.catalog()}
n_old = net5.calls.count(enc_cells.CATALOG_URL)
check("5. THE CATALOG is fetched when there is none, not again while it is young, and again once older than "
      "CATALOG_MAX_AGE_S - the new editions taken",
      lambda: (n_first, n_young, n_old) == (1, 1, 2) and cat_old["US5TSTAA"] == 2,
      lambda: "asked %d, %d, %d; US5TSTAA edition %s" % (n_first, n_young, n_old, cat_old.get("US5TSTAA")))
clock[0] += enc_cells.CATALOG_MAX_AGE_S * 2
net5.down.add("catalog")
src5b = again(net5, now=lambda: clock[0])
kept_cat = {e["name"]: e["ed"] for e in src5b.catalog()}
n_fail = net5.calls.count(enc_cells.CATALOG_URL)
src5c = again(net5, now=lambda: clock[0])
src5c._down_until = 0.0
os.remove(os.path.join(A.S57_DIR, "down.mark"))      # the network hold-off gone: only the catalog's own mark is left
src5c.catalog()
n_held = net5.calls.count(enc_cells.CATALOG_URL)
src_none = fresh(Net(), os.path.join(TMP, "s57_none"))
src_none._fetch = lambda url: (_ for _ in ()).throw(urllib.error.URLError("no route"))
check("5b. A REFRESH THAT FAILS keeps the catalog it had (catalog_stale) and MARKS the try on disk: the next process "
      "does not ask again inside CATALOG_RETRY_S; with no catalog kept at all, the read FAILS (OSError) - never an "
      "empty catalog",
      lambda: kept_cat.get("US5TSTAA") == 2 and src5b.catalog_stale and n_fail == n_old + 1 and n_held == n_fail
              and raises(src_none.catalog),
      lambda: "kept %s stale %s; asked %d then %d (held); none kept raises %s"
              % (kept_cat, src5b.catalog_stale, n_fail, n_held, raises(src_none.catalog)))

net5d = Net()
net5d.bad.add("US5TSTAB")
src5d = fresh(net5d, os.path.join(TMP, "s57_bad"))
bad_refused = raises(lambda: src5d.cell_path(ENTRY_B))
os.makedirs(src5d.cells_dir, exist_ok=True)
with open(os.path.join(src5d.cells_dir, "US5TSTZZ_ED001_UP000.zip"), "wb") as f:
    f.write(zz.zip())                                # canceled: on disk, not in the catalog
zz_seen = [ft for ft in src5d.band_features("enc_harbour", IN_HA, A._cell_namer("enc_harbour"))[0]
           if str(ft.get("oid", "")).startswith("US5TSTZZ")]
check("5c. A DOWNLOAD THAT IS NOT A WHOLE CELL (an error page served as the file) is refused and not kept - the read "
      "fails rather than reading it - and a cell the catalog no longer names (canceled) is never read, though a copy "
      "of it lies in the folder",
      lambda: bad_refused and "US5TSTAB_ED001_UP000.zip" not in files(src5d.cells_dir) and not zz_seen,
      lambda: "refused %s, cells kept %s, canceled features read %d" % (bad_refused, files(src5d.cells_dir), len(zz_seen)))

net5s = Net()
src5s = fresh(net5s)
keep_all(src5s)                                      # every cell kept, as the catalog of that day named them
CAT_PATH = os.path.join(A.S57_DIR, "enc.geojson")
then = time.time() - 3 * 86400
os.utime(CAT_PATH, (then, then))
day = time.strftime("%Y-%m-%d", time.gmtime(then))
net5s.down.add("catalog")                            # three days on, NOAA's catalog does not answer
again(net5s)
A._enc_tile_mem.clear()
t5s = A.fetch_enc_tile(TILE)
kept5s = os.path.exists(A._tile_path(TILE))
lay5s = A.fetch_enc_layered(IN_HA)
far5s = A._enc_tile_build([-105.0, 39.75, -104.75, 40.0])       # no cell covers it: its coverage read alone says it
n_cat = net5s.calls.count(enc_cells.CATALOG_URL)
src5s2 = again(net5s)                                # the next process (the next tile's child), held off by the mark
src5s2._down_until = 0.0
os.remove(os.path.join(A.S57_DIR, "down.mark"))
src5s2.catalog()
n_cat2 = net5s.calls.count(enc_cells.CATALOG_URL)
ci5s = A.fetch_chart_info(IN_HA)
u5s = A.fetch_enc_features(IN_HA, 0.0)
check("5d. A CATALOG PAST ITS AGE THAT CANNOT BE REFRESHED IS SAID, in every process, and what is read through it is "
      "served and NEVER KEPT: the tile not whole and not kept, its `stale` naming the catalog copy's day (the page shows "
      "it as an older chart in use), the layered read, the chart card, the unforced read (not whole) and a tile no cell "
      "covers saying it too; the next "
      "process, held off by the mark, asks nothing and says it as well. Only the process whose refresh failed knew, "
      "nobody asked it, and the next tile's child read the old copy as current - its tile kept a week as whole (the "
      "2026-11-21 review)",
      lambda: not t5s.get("complete") and not kept5s and t5s.get("catalog_stale") == day
              and day in (t5s.get("stale") or "") and any(day in s for s in lay5s.get("stale") or [])
              and not lay5s.get("complete") and far5s.get("catalog_stale") == day and src5s2.catalog_stale == day
              and n_cat2 == n_cat and day in (ci5s.get("note") or "")
              and u5s.get("catalog_stale") == day and not u5s.get("complete") and u5s.get("features"),
      lambda: "tile complete %s kept %s catalog_stale %s stale %r; layered stale %s complete %s; uncovered tile %s; next "
              "process %s, asked %d then %d; card %r; unforced read complete %s catalog_stale %s" % (
                  t5s.get("complete"), kept5s, t5s.get("catalog_stale"), (t5s.get("stale") or "")[:60],
                  [s[:40] for s in lay5s.get("stale") or []], lay5s.get("complete"), far5s.get("catalog_stale"),
                  src5s2.catalog_stale, n_cat, n_cat2, ci5s.get("note"), u5s.get("complete"), u5s.get("catalog_stale")))
net5s.down.discard("catalog")
os.remove(os.path.join(A.S57_DIR, "catalog.mark"))
again(net5s)
A._enc_tile_mem.clear()
t5s_ok = A.fetch_enc_tile(TILE)
kept5s_ok = os.path.exists(A._tile_path(TILE))
check("5d2. ... and once the catalog is refreshed, the tile is read whole and kept, and says nothing of it",
      lambda: t5s_ok.get("complete") and kept5s_ok and not t5s_ok.get("catalog_stale") and not t5s_ok.get("stale"),
      lambda: "complete %s kept %s catalog_stale %s" % (t5s_ok.get("complete"), kept5s_ok, t5s_ok.get("catalog_stale")))
os.remove(A._tile_path(TILE))
A._enc_tile_mem.clear()

net5f = Net(cat=catalog({"US5TSTAA": (2, 0)}))
src5f = fresh(net5f, os.path.join(TMP, "s57_future"))
os.makedirs(src5f.root)
with open(os.path.join(src5f.root, "enc.geojson"), "wb") as f:
    f.write(catalog())                               # edition 1, written while the clock was three days ahead
ahead = time.time() + 3 * 86400
os.utime(os.path.join(src5f.root, "enc.geojson"), (ahead, ahead))
fut = {e["name"]: e["ed"] for e in src5f.catalog()}
asked_f = net5f.calls.count(enc_cells.CATALOG_URL)
mark5f = os.path.join(src5f.root, "down.mark")
with open(mark5f, "wb"):
    pass
os.utime(mark5f, (time.time() + 1, time.time() + 1))
near = src5f._marked("down.mark", enc_cells.DOWN_S)
os.utime(mark5f, (time.time() + 3600, time.time() + 3600))
far = src5f._marked("down.mark", enc_cells.DOWN_S)
check("5e. A CATALOG FROM THE FUTURE (written under a clock set back since) IS DUE - refreshed, NOAA's new edition taken; "
      "taken as young, it was not refreshed until the clock caught up (the 2026-11-21 review) - and a hold-off mark a "
      "moment ahead of the clock is honored (on Windows one fresh file in eleven read as written in the future, and 5b "
      "failed), one an hour ahead is not",
      lambda: fut.get("US5TSTAA") == 2 and asked_f == 1 and not src5f.catalog_stale and near and not far,
      lambda: "edition %s, asked %d, catalog_stale %s; a mark 1 s ahead %s, an hour ahead %s"
              % (fut.get("US5TSTAA"), asked_f, src5f.catalog_stale, near, far))

# ── 5f. a download kept as what it holds ────────────────────────────────────────────────────────────────────────────
HU = [-70.20, 43.16, -70.10, 43.24]                  # a harbor cell of its own, north of HA
P_UP0, P_UP1 = (-70.15, 43.20), (-70.14, 43.21)      # its obstruction, and where update 1 moves it
BOX_U = {"US5TSTUP": HU}


def harbor_u():
    c = Cell("US5TSTUP")
    c.area("M_COVR", HU, {"CATCOV": "1"})
    c.area("DEPARE", HU, {"DRVAL1": "3", "DRVAL2": "6"})
    c.w.node(5000, *P_UP0, rcnm=110)
    c.w.feature(4, "OBSTRN", 1, {"VALSOU": "0.5", "WATLEV": "3"}, [node_ptr(5000)])
    return c


up_u = W(name="US5TSTUP.001", updn=1, isdt="20261120")           # update 1: the obstruction's node moved, in place
up_u.raw([("VRID", _field("VRID", [(110, 5000, 2, 3)])), ("SGCC", _field("SGCC", [(3, 1, 1)])),
          ("SG2D", _field("SG2D", [(round(P_UP1[1] * COMF), round(P_UP1[0] * COMF))]))])
U0, U1 = harbor_u().zip(), harbor_u().zip(updates=[(1, up_u.bytes())])
_ub = up_u.bytes()
_i = U1.index(_ub) + len(_ub) // 2                   # the zip is stored: the update's bytes lie in it as they are
U1_BAD = U1[:_i] + bytes([U1[_i] ^ 0xFF]) + U1[_i + 1:]        # one byte of update 1 damaged: its CRC no longer matches


def u_read(src):
    """(obstructions, stale cells) of the harbor band over HU, read through `src`."""
    fs, info = src.band_features("enc_harbour", HU, A._cell_namer("enc_harbour"))
    return obstructions(fs), info["stale"]


def u_source(eds, zip_, kept=None):
    """A source on a clean folder of its own: the catalog names the cell at `eds`, NOAA serves `zip_`, and `kept` is
    {file name: bytes} lying in the cells folder already."""
    net = Net(cat=catalog({"US5TSTUP": eds}, boxes=BOX_U), zips={"US5TSTUP": zip_})
    src = fresh(net, os.path.join(TMP, "s57_u"))
    for n, b in (kept or {}).items():
        os.makedirs(src.cells_dir, exist_ok=True)
        with open(os.path.join(src.cells_dir, n), "wb") as f:
            f.write(b)
    return net, src


AT0, AT1 = [("US5TSTUP_ED001_UP000:4", P_UP0)], [("US5TSTUP_ED001_UP001:4", P_UP1)]
net_u, src_u = u_source((1, 1), U0)                  # NOAA's zip still update 0, its catalog naming update 1
behind = u_read(src_u)
f_behind = files(src_u.cells_dir)
behind2 = u_read(again(net_u, src_u.root))           # the next process, inside REFUSED_S
n_behind = net_u.asked("US5TSTUP")
net_u.zips["US5TSTUP"] = U1                          # NOAA catches up
u_mark = os.path.join(src_u.root, "refused_US5TSTUP.mark")
past = time.time() - enc_cells.REFUSED_S - 1
os.utime(u_mark, (past, past))
caught = u_read(again(net_u, src_u.root))
f_caught = files(src_u.cells_dir)
mark_gone = not os.path.exists(u_mark)
net_d, src_d = u_source((1, 1), U1_BAD, kept={"US5TSTUP_ED001_UP000.zip": U0})
damaged = u_read(src_d)
f_damaged = files(src_d.cells_dir)
marked_d = src_d._marked("refused_US5TSTUP.mark", enc_cells.REFUSED_S)
net_a, src_a = u_source((1, 0), U1)                  # NOAA's zip AHEAD of its catalog
ahead_r = u_read(src_a)
ahead_r2 = u_read(again(net_a, src_a.root))
f_ahead, n_ahead = files(src_a.cells_dir), net_a.asked("US5TSTUP")
net_m, src_m = u_source((1, 1), U1, kept={"US5TSTUP_ED001_UP001.zip": U0})    # update 0 kept under update 1's name
mis_raised = raises(lambda: u_read(src_m), ValueError)
f_mis = files(src_m.cells_dir)
mis_after = u_read(src_m)
f_mis2 = files(src_m.cells_dir)
net_r, src_r = u_source((1, 1), U1, kept={"US5TSTUP_ED001_UP001.zip": U1_BAD})    # damaged on disk since
rot_raised = raises(lambda: u_read(src_r), ValueError)
f_rot = files(src_r.cells_dir)
net_f, src_f = u_source((1, 2), U0, kept={"US5TSTUP_ED001_UP001.zip": U1})    # NOAA's zip behind the copy kept
further = u_read(src_f)
f_further = files(src_f.cells_dir)
check("5f. A DOWNLOAD IS KEPT AS WHAT IT HOLDS - its base's edition, its updates' numbers, every member whole by its "
      "CRC: NOAA's zip still at update 0 while its catalog names update 1 is kept under update 0's name and served as an "
      "older copy (stale), and the next process does not download it again inside REFUSED_S; once NOAA catches up, "
      "update 1 is read and the older copy removed. A zip with a damaged member is refused, the good older copy kept and "
      "served stale; one behind the copy kept is not kept, the copy served. A zip AHEAD of its catalog is kept as it is "
      "and read as the chart, not downloaded again. A copy kept "
      "under a name it does not hold is renamed to what it holds and its read fails, and the next read downloads the "
      "cell; a copy damaged on disk goes. A zip was kept under whatever its catalog named, only its .000 looked for: "
      "behind, it was served as current and, its name taken, never downloaded again; damaged, it replaced the good copy "
      "(the 2026-11-21 review)",
      lambda: behind == (AT0, ["US5TSTUP"]) and f_behind == ["US5TSTUP_ED001_UP000.zip"] and behind2 == behind
              and n_behind == 1 and caught == (AT1, []) and f_caught == ["US5TSTUP_ED001_UP001.zip"] and mark_gone
              and damaged == (AT0, ["US5TSTUP"]) and f_damaged == ["US5TSTUP_ED001_UP000.zip"] and marked_d
              and ahead_r == (AT1, []) and ahead_r2 == ahead_r and f_ahead == ["US5TSTUP_ED001_UP001.zip"]
              and n_ahead == 1 and mis_raised and f_mis == ["US5TSTUP_ED001_UP000.zip"] and mis_after == (AT1, [])
              and f_mis2 == ["US5TSTUP_ED001_UP001.zip"] and rot_raised and f_rot == []
              and further == (AT1, ["US5TSTUP"]) and f_further == ["US5TSTUP_ED001_UP001.zip"],
      lambda: "behind %s %s, next process %s, asked %d; caught up %s %s, mark gone %s; damaged %s %s marked %s; ahead "
              "%s %s %s asked %d; mislabeled raised %s %s, then %s %s; damaged on disk raised %s %s; behind the copy "
              "kept %s %s"
              % (behind, f_behind, behind2, n_behind, caught, f_caught, mark_gone, damaged, f_damaged, marked_d,
                 ahead_r, ahead_r2, f_ahead, n_ahead, mis_raised, f_mis, mis_after, f_mis2, rot_raised, f_rot,
                 further, f_further))

BASE_U = harbor_u().w.bytes()


def held(members, base=None):
    """What _check_cell_zip finds a zip of the base (or `base`) and the update numbers `members` to hold, or its
    refusal."""
    fs = {"ENC_ROOT/US5TSTUP/US5TSTUP.000": BASE_U if base is None else base} if base is not False else {}
    for n in members:
        fs["ENC_ROOT/US5TSTUP/US5TSTUP.%03d" % n] = up_u.bytes()
    try:
        return enc_cells._check_cell_zip(zipped(fs), "US5TSTUP")
    except ValueError:
        return "refused"


reissued = W(name="US5TSTUP.000", updn=3)            # a base NOAA re-issued at update 3 (none among its 115 cells here)
g = {"base": held([]), "run": held([1, 2, 3]), "from 2": held([2, 3]), "a gap": held([1, 3]),
     "no .000": held([1], base=False), "no edition": held([], base=W(name="US5TSTUP.000", edtn="").bytes()),
     "an error page": "refused" if raises(lambda: enc_cells._check_cell_zip(b"<html>busy</html>", "US5TSTUP"),
                                          ValueError) else "taken",
     "re-issued": held([], base=reissued.bytes()), "re-issued, then 4": held([4], base=reissued.bytes()),
     "re-issued, then 1": held([1], base=reissued.bytes())}
check("5g. WHAT A ZIP HOLDS (_check_cell_zip): the base's edition and update, raised by an unbroken run of updates from "
      "the next - a run from anywhere else, a gap, no base, a base naming no edition, an error page are refused; a base "
      "NOAA re-issued at an update holds that update, and the run goes on from it",
      lambda: g == {"base": (1, 0), "run": (1, 3), "from 2": "refused", "a gap": "refused", "no .000": "refused",
                    "no edition": "refused", "an error page": "refused", "re-issued": (1, 3),
                    "re-issued, then 4": (1, 4), "re-issued, then 1": "refused"},
      lambda: "%s" % g)

# ── 5h. a refreshed catalog taken only when it reads as NOAA's (review fix 8) ────────────────────────────────────────
BOX40 = {"US5TC%03d" % i: [-70.0 + i * 0.001, 43.0, -69.9995 + i * 0.001, 43.0005] for i in range(40)}
clock8 = [time.time()]
root8 = os.path.join(TMP, "s57_cat8")
net8 = Net(cat=catalog(boxes=BOX40))
src8 = fresh(net8, root8, now=lambda: clock8[0])
first8 = len(src8.catalog())
CAT8 = os.path.join(root8, "enc.geojson")


def body8(drop=0, bad=0, add=0, rename=False):
    """NOAA's catalog of BOX40 less its first `drop` cells, `bad` of the rest with a scale band that does not read
    ("5H"), `add` cells more, its edition field renamed (a schema change) if `rename`."""
    boxes = dict(list(BOX40.items())[drop:])
    boxes.update({"US5TD%03d" % i: [-69.0, 43.0, -68.9995, 43.0005] for i in range(add)})
    d = json.loads(catalog(boxes=boxes))
    for ft in d["features"][:bad]:
        ft["properties"]["scale_band"] = "5H"
    if rename:
        for ft in d["features"]:
            ft["properties"]["enc_edition"] = ft["properties"].pop("enc_ed_up")
    return json.dumps(d).encode("utf-8")


def refresh8(body):
    """A day on, NOAA's catalog answers `body`: the cells a new process reads, its catalog_stale, the copy kept."""
    clock8[0] += enc_cells.CATALOG_MAX_AGE_S + 60
    net8.cat = body
    enc_cells._discard(os.path.join(root8, "catalog.mark"))     # the last try's hold-off gone: each try its own
    s = again(net8, root8, now=lambda: clock8[0])
    try:
        n = len(s.catalog())
    except OSError:
        n = None
    except ValueError:
        n = "the copy kept does not read"
    with open(CAT8, "rb") as f:
        return n, s.catalog_stale, f.read()


cat8 = {"one of 40 gone (canceled)": refresh8(body8(drop=1))}
taken1 = open(CAT8, "rb").read()
for k, b in (("three more gone", body8(drop=4)), ("three that do not read", body8(drop=1, bad=3)),
             ("its edition field renamed", body8(drop=1, rename=True)), ("not NOAA's at all", b'{"features": [{}]}')):
    cat8[k] = refresh8(b)
cat8["one in, none gone"] = refresh8(body8(drop=1, add=1))
nokeep = {}
for k, b in (("none kept, three of 40 that do not read", body8(bad=3)), ("none kept, one of 40", body8(bad=1)),
             ("none kept, an empty catalog", b'{"type": "FeatureCollection", "features": []}')):
    s0 = fresh(Net(cat=b), os.path.join(TMP, "s57_cat8b"))
    try:
        nokeep[k] = len(s0.catalog())
    except OSError:
        nokeep[k] = "refused"
    except ValueError:
        nokeep[k] = "kept, and no read of it"
said8 = {k: (v[0], bool(v[1]), v[2] == taken1) for k, v in cat8.items()}
check("5h. A REFRESHED CATALOG IS TAKEN ONLY WHEN IT READS AS NOAA'S: read before it is kept - one naming fewer than "
      "19 in 20 of the cells the copy kept names, or not reading in 1 in 20 of its own entries (a field renamed, a "
      "scale band that does not read, a body that is no catalog at all), is refused and the copy kept, said as a "
      "catalog not refreshed (catalog_stale) - while a cell canceled or one added is taken. A refresh was taken "
      "whenever it was JSON with a feature: a cell left out or unreadable was read as canceled (the harbor chart "
      "gone, the tile kept whole), and a schema change overwrote the good copy and failed every read for a day",
      lambda: first8 == 40 and said8 == {"one of 40 gone (canceled)": (39, False, True),
                                         "three more gone": (39, True, True),
                                         "three that do not read": (39, True, True),
                                         "its edition field renamed": (39, True, True),
                                         "not NOAA's at all": (39, True, True),
                                         "one in, none gone": (40, False, False)}
              and nokeep == {"none kept, three of 40 that do not read": "refused", "none kept, one of 40": 39,
                             "none kept, an empty catalog": "refused"},
      lambda: "first %d; %s; with none kept %s" % (first8, said8, nokeep))

# ── 6. a cell parsed once ───────────────────────────────────────────────────────────────────────────────────────────
parses = []
_read_zip0 = s57.read_zip


def counted(path):
    parses.append(os.path.basename(path))
    return _read_zip0(path)


s57.read_zip = counted
try:
    net6 = Net()
    src6 = fresh(net6)
    e6 = next(e for e in src6.catalog() if e["name"] == "US5TSTAA")
    p6, _st = src6.cell_path(e6)
    namer6 = A._cell_namer("enc_harbour")
    f_first = src6.features(p6, namer6)
    rd = files(src6.read_dir)
    n1 = len(parses)
    f_again = again(net6).features(p6, namer6)
    n2 = len(parses)
    f_only = again(net6).features(p6, namer6, only={"M_COVR"})
    n3_ = len(parses)
    tag = enc_cells.reader_tag()
    rpath = os.path.join(src6.read_dir, rd[0]) if rd else ""
    other = rpath.replace("." + tag + ".", ".0123456789ab.")
    os.replace(rpath, other)
    again(net6).features(p6, namer6)
    n4 = len(parses)
    after_other = files(src6.read_dir)
    with open(rpath, "rb") as f:
        lines = f.read().splitlines(True)
    with open(rpath, "wb") as f:
        f.writelines(lines[:-1])                     # cut short
    f_cut = again(net6).features(p6, namer6)
    n5 = len(parses)
finally:
    s57.read_zip = _read_zip0
canon = lambda fs: sorted(json.dumps(f, sort_keys=True) for f in fs)     # noqa: E731
check("6. A CELL IS PARSED ONCE: its read kept beside it (<key>.<reader>.jsonl) and read back by the next process with "
      "no parse - the same features, record for record; a read of one class from the kept read alone",
      lambda: n1 == 1 and rd == ["US5TSTAA_ED001_UP000.%s.jsonl" % tag] and n2 == 1 and canon(f_again) == canon(f_first)
              and n3_ == 1 and canon(f_only) == canon([f for f in f_first if f["cls"] == "Coverage_area"]),
      lambda: "parses %d/%d/%d, reads %s, same %s, only M_COVR %d" % (
          n1, n2, n3_, rd, canon(f_again) == canon(f_first), len(f_only)))
check("6b. ... and a read kept by ANOTHER reader (its tag not this reader's) is not used - the cell parsed again and the "
      "other read removed - nor is one cut short: parsed again, the same features",
      lambda: n4 == 2 and after_other == [os.path.basename(rpath)] and n5 == 3 and canon(f_cut) == canon(f_first),
      lambda: "parses %d then %d; reads after %s" % (n4, n5, after_other))

# a harbor cell whose update deletes the wreck's node (the wreck left standing) and a corner node of its depth area
bk = Cell("US5TSTXX")
bk.area("M_COVR", HX, {"CATCOV": "1"})              # nodes 1001-1004, edges 1005-1008
bk.area("DEPARE", HX, {"DRVAL1": "8", "DRVAL2": "12"})   # nodes 1009-1012, edges 1013-1016
bk.w.node(5000, -70.02, 43.10, rcnm=110)
bk.w.feature(4, "WRECKS", 1, {"CATWRK": "2", "WATLEV": "3"}, [node_ptr(5000)])
bk.w.feature(9, "C_AGGR", 255, {}, [])               # a collection: no geometry of its own, and no failure
up_bk = W(name="US5TSTXX.001", updn=1, isdt="20261120")
up_bk.raw([("VRID", _field("VRID", [(110, 5000, 2, 2)]))])
up_bk.raw([("VRID", _field("VRID", [(120, 1009, 2, 2)]))])
bc = Cell("US5TSTXX")                                # ... and one whose update deletes a corner of its COVERAGE
bc.area("M_COVR", HX, {"CATCOV": "1"})
bc.area("DEPARE", HX, {"DRVAL1": "8", "DRVAL2": "12"})
up_bc = W(name="US5TSTXX.001", updn=1, isdt="20261120")
up_bc.raw([("VRID", _field("VRID", [(120, 1001, 2, 2)]))])
net6c = Net(cat=catalog({"US5TSTXX": (1, 1)}, boxes=BOX_X),
            zips={"US5TSTXX": bk.zip(updates=[(1, up_bk.bytes())]), "US4TSTXX": apx.zip()})
fresh(net6c)
A._enc_tile_mem.clear()
ext6c = A._cells_extract("enc_harbour", HX)
pick6c = raises(lambda: A._cells_pick_band(HX))
t6c = A.fetch_enc_tile(TILE)
kept6c = os.path.exists(A._tile_path(TILE))
lay6c = A.fetch_enc_layered([-70.06, 43.06, -70.01, 43.14])
WANT6C = ["Depth_Area", "Wreck_point"]
parses = []
s57.read_zip = counted
try:
    again(net6c)
    ext6c2 = A._cells_extract("enc_harbour", HX)    # the next process, from the kept read
finally:
    s57.read_zip = _read_zip0
A._enc_tile_mem.clear()
net6d = Net(cat=catalog({"US5TSTXX": (1, 1)}, boxes=BOX_X),
            zips={"US5TSTXX": bc.zip(updates=[(1, up_bc.bytes())]), "US4TSTXX": apx.zip()})
fresh(net6d)
cov6d = raises(lambda: A._cells_coverage("enc_harbour", TILE))
check("6c. A FEATURE WHOSE GEOMETRY CANNOT BE BUILT IS A FAILED READ OF ITS CLASS, not a feature quietly gone: an update "
      "that deleted a wreck's node and a corner of a depth area leaves both classes `partial` (the read not whole, the "
      "note naming the cell); the band pick will not pass the band by for a coarser one; the tile is not kept and the "
      "layered read holds its water unread, as for a layer that did not arrive; the next process reads the same from "
      "the kept read, parsing nothing; a coverage area not built fails the band's coverage; a collection, with no "
      "geometry of its own, is no failure. Both were dropped, the read kept and served as whole (the 2026-11-21 review)",
      lambda: ext6c["partial"] == WANT6C and not ext6c.get("complete") and "US5TSTXX" in (ext6c.get("note") or "")
              and not [f for f in ext6c["features"] if f["cls"] in WANT6C] and pick6c
              and not t6c.get("complete") and not kept6c and set(WANT6C) <= set(t6c.get("partial") or [])
              and any(r[0] <= -70.05 and r[2] >= -70.01 for r in lay6c.get("unread_failed") or [])
              and ext6c2["partial"] == WANT6C and not parses and cov6d,
      lambda: "partial %s complete %s note %r; pick raises %s; tile complete %s kept %s partial %s; layered unread_failed "
              "%s; next process partial %s parses %s; coverage raises %s" % (
                  ext6c["partial"], ext6c.get("complete"), ext6c.get("note"), pick6c, t6c.get("complete"), kept6c,
                  t6c.get("partial"), lay6c.get("unread_failed"), ext6c2["partial"], parses, cov6d))
A._enc_tile_mem.clear()

up_lost = W(name="US5TSTUP.001", updn=1, isdt="20261120")         # update 1, not of this base's chain:
up_lost.feature(99, "WRECKS", 1, {"VALSOU": "2"}, ruin=3)        # it changes a wreck the base does not hold,
up_lost.feature(98, "OBSTRN", 1, ruin=2)                         # and deletes an obstruction it does not hold
up_odd = W(name="US5TSTUP.001", updn=1, isdt="20261120")
up_odd.feature(4, "OBSTRN", 1, {"VALSOU": "9"}, ruin=7)          # an instruction S-57 does not have
reads6d = []
for up6d in (up_lost, up_odd):
    _n, s6d = u_source((1, 1), harbor_u().zip(updates=[(1, up6d.bytes())]))
    f6d, i6d = s6d.band_features("enc_harbour", HU, A._cell_namer("enc_harbour"))
    reads6d.append((i6d["partial"], i6d["failed_cells"], obstructions(f6d)))
check("6d. AN UPDATE THAT CHANGES A FEATURE THE CELL DOES NOT HOLD is a failed read of that feature's class: NOAA charts "
      "a wreck this read does not hold, so the wrecks are `partial`; the update deleting an obstruction not there is "
      "no failure, and the cell's own obstruction is read. One changing the obstruction by an instruction S-57 does not "
      "have leaves the obstructions `partial`. Each change was dropped with a line in cell.problems, and the read "
      "served as whole",
      lambda: reads6d == [(["Wreck_point"], ["US5TSTUP"], [("US5TSTUP_ED001_UP001:4", P_UP0)]),
                          (["Obstruction_point"], ["US5TSTUP"], [("US5TSTUP_ED001_UP001:4", P_UP0)])],
      lambda: "%s" % reads6d)

# ── 7. the band pick, the unforced read, snap-to-water and the chart card ──────────────────────────────────────────
net7 = Net()
fresh(net7)
before7 = files(A.ENC_DIR)
u7 = A.fetch_enc_features(IN_HA, 2.0)
snap = A.snap_to_water(43.10, -70.15, 2.0)
ci = A.fetch_chart_info(IN_HA)
after7 = files(A.ENC_DIR)
picks = []
_pick0 = A._enc_pick_band
A._enc_pick_band = lambda bbox, errors=None: picks.append(bbox)
try:
    far = A.fetch_enc_features([-105.0, 39.7, -104.9, 39.8], 0.0)
finally:
    A._enc_pick_band = _pick0
cells_ci = {c["props"].get("DSNM"): c["props"] for c in ci.get("cells") or []}
check("7. THE UNFORCED READ (snap-to-water's) picks the finest band whose cells chart depth or land in the box - harbor "
      "- from the cells, whole, pontoons and all, the shallow tag per request; snap-to-water finds the charted water "
      "there; the CHART CARD reads the harbor band's cells (DSNM, CATCOV, NOAA's TITLE for each - ENCDirect served none) "
      "and zones of confidence (CATZOC a number); nothing of theirs written to the ENC cache",
      lambda: u7.get("band") == "enc_harbour" and u7.get("source") == "cells" and u7.get("complete")
              and by_oid(u7["features"], "US5TSTAA", PONTON_LINE)
              and any(f["role"] == "depth_area" and f["shallow"] is False for f in u7["features"])
              and snap.get("ok") and snap.get("depth_m") == 2.5
              and ci.get("band") == "enc_harbour" and ci.get("source") == "cells"
              and cells_ci.get("US5TSTAA.000") == {"DSNM": "US5TSTAA.000", "TITLE": "Test Harbor A",
                                                    "CATCOV": "coverage available"}
              and [q["props"].get("CATZOC") for q in ci["quality"]] == [2] and before7 == after7,
      lambda: "band %s source %s complete %s; snap %s; card band %s cells %s quality %s; enc cache %s -> %s" % (
          u7.get("band"), u7.get("source"), u7.get("complete"), snap, ci.get("band"), cells_ci,
          [q["props"] for q in ci.get("quality") or []], before7, after7))
check("7b. WATER NO CELL CHARTS is an answer about the place - \"no ENC coverage here\", not failed - and ENCDirect is not "
      "asked about it",
      lambda: far.get("note") == "no ENC coverage here" and not far.get("failed") and not picks,
      lambda: "note %r failed %s, ENCDirect asked %d" % (far.get("note"), far.get("failed"), len(picks)))

net7c = Net()
src7c = fresh(net7c)
net7c.down.add("catalog")                            # no catalog kept, none to be had
picks = []


def pick_down(bbox, errors=None):
    picks.append(bbox)
    if errors is not None:
        errors.append("harbor: no answer")
    return None


A._enc_pick_band = pick_down
try:
    fb7 = A.fetch_enc_features(IN_HA, 0.0)
    only7 = A.fetch_enc_features(IN_HA, 0.0, band="enc_harbour", source="cells", use_cache=False)
    n_only = len(picks)
    A._enc_down_until = 0.0                          # the unforced read's ENCDirect failure armed its breaker
    ci7 = A.fetch_chart_info(IN_HA)
finally:
    A._enc_pick_band = _pick0
    A._enc_down_until = 0.0
check("7c. CELLS THAT CANNOT BE READ AT ALL send the read to ENCDirect - the unforced read and the chart card each ask it "
      "(here it does not answer either, and says so) - while a read FORCED to the cells (the layered read's) fails as "
      "the cells' and asks ENCDirect nothing",
      lambda: fb7.get("failed") and "chart service did not answer" in (fb7.get("note") or "")
              and only7.get("failed") and "cells could not be read" in (only7.get("note") or "")
              and n_only == 1 and ci7.get("failed") and len(picks) == 2,
      lambda: "unforced %r; forced to the cells %r (ENCDirect asked %d); card %r (asked %d)" % (
          fb7.get("note"), only7.get("note"), n_only, ci7.get("note"), len(picks)))

# ── 8. the TLS context, and the child ───────────────────────────────────────────────────────────────────────────────
ctxs = []
_urlopen0 = urllib.request.urlopen


class _Resp:
    def __init__(self, data):
        self.data = data

    def read(self):
        return self.data

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def rec(req, timeout=None, context=None, **_k):
    ctxs.append(context)
    return _Resp(catalog())


shutil.rmtree(A.S57_DIR, ignore_errors=True)
A._enc_cells_src = None
urllib.request.urlopen = rec
try:
    got8 = A._cells().catalog()
finally:
    urllib.request.urlopen = _urlopen0
check("8. THE CELLS ARE FETCHED ON THE CONSOLE'S ONE TLS CONTEXT (_enc_ssl, made once - a context per request cost a "
      "tile 22.5 s of CPU) and kept in S57_DIR",
      lambda: len(ctxs) == 1 and ctxs[0] is A._enc_ssl() and len(got8) == 4
              and os.path.exists(os.path.join(A.S57_DIR, "enc.geojson")),
      lambda: "contexts %s, the console's %s, cells %d" % (len(ctxs), bool(ctxs) and ctxs[0] is A._enc_ssl(), len(got8)))

net8 = Net()
src8 = fresh(net8)
keep_all(src8)                                       # the child needs no network: catalog young, every cell kept
os.environ.pop("ASV_ENC_TILE_FAKE", None)
A.ENC_TILE_IN_PROCESS = False
A._enc_tile_mem.clear()
A._enc_down_until = time.monotonic() + 30.0          # ENCDirect's breaker armed in the console: the child still reads
try:
    t8 = A.fetch_enc_tile(TILE)
finally:
    A.ENC_TILE_IN_PROCESS = True
    A._enc_down_until = 0.0
check("8b. THE CHILD THAT BUILDS A TILE reads the console's cells (--s57-dir) as the console's source (--enc-source), "
      "ENCDirect's breaker armed or not: the tile whole from the cells, the pontoons in, kept as tile_v4",
      lambda: t8.get("complete") and set((t8.get("sources") or {}).values()) == {"cells"}
              and by_oid(t8["features"], "US5TSTAA", PONTON_LINE) and os.path.exists(A._tile_path(TILE)),
      lambda: "complete %s sources %s note %r kept %s" % (t8.get("complete"), t8.get("sources"), t8.get("note"),
                                                          os.path.exists(A._tile_path(TILE))))

# ── 9. ENCDirect's tiles, and the re-read behind ────────────────────────────────────────────────────────────────────
T9, T9b = [-69.75, 43.0, -69.5, 43.25], [-69.5, 43.0, -69.25, 43.25]
span = {"role": "bridge_span", "cls": "Bridge_area", "props": {"VERCLR": 20.0}, "oid": 7, "band": "enc_harbour",
        "geometry": {"type": "Polygon", "coordinates": [[[-69.7, 43.1], [-69.69, 43.1], [-69.69, 43.11], [-69.7, 43.1]]]}}
v3 = {"tile": T9, "bands": ["enc_harbour"], "unread": [], "unread_failed": [], "partial": [], "complete": True,
      "reader": 3, "read_at": time.time() - 86400, "features": [span]}
A._write_tile_jsonl(os.path.join(A.ENC_DIR, "tile_v3_%s.jsonl" % A._bbox_key(T9)), v3)
v2 = dict(v3, tile=T9b)
v2.pop("reader")
A._write_tile_jsonl(os.path.join(A.ENC_DIR, "tile_v2_%s.jsonl" % A._bbox_key(T9b)), v2)
o3, o2 = A._older_tile(T9), A._older_tile(T9b)
check("9. A TILE ENCDIRECT'S READER KEPT (tile_v3, reader 3) is the fallback when a tile cannot be read: served stale, "
      "saying it lacks what that service never served (the pontoons) - its bridge clearances KEPT, judged as read; an "
      "older reader's (tile_v2) still has its spans marked clearance-unread",
      lambda: o3 and not o3.get("complete") and "pontoons" in (o3.get("stale") or "")
              and not any(f.get("clr_unread") for f in o3["features"])
              and o2 and [f.get("clr_unread") for f in o2["features"]] == [True]
              and "no bridge or cable clearances" in (o2.get("stale") or ""),
      lambda: "v3 %r clr_unread %s; v2 %r clr_unread %s" % (
          (o3 or {}).get("stale"), [f.get("clr_unread") for f in (o3 or {}).get("features", [])],
          ((o2 or {}).get("stale") or "")[:60], [f.get("clr_unread") for f in (o2 or {}).get("features", [])]))

builds = []
_now0 = A._tile_build_now


def build_rec(tile):
    builds.append(list(tile))
    return {"tile": tile, "features": [], "bands": [], "unread": [], "unread_failed": [tile], "partial": []}


A._tile_build_now = build_rec
try:
    for src_mode, t in (("cells", T9), ("encdirect", T9b)):
        A.ENC_SOURCE = src_mode
        A._enc_down_until = time.monotonic() + 30.0
        A._tile_refresh_later(t)
        for _ in range(200):
            with A._enc_tile_locks_lock:
                if A._bbox_key(t) not in A._enc_tile_refreshing:
                    break
            time.sleep(0.01)
finally:
    A._tile_build_now = _now0
    A.ENC_SOURCE = "cells"
    A._enc_down_until = 0.0
check("9b. THE RE-READ BEHIND A SERVED TILE is not stopped by ENCDirect's breaker when the cells are the source (it was "
      "ENCDirect's own hold) - and still is when ENCDirect is",
      lambda: builds == [T9],
      lambda: "re-reads started %s" % builds)


# ── 10. this console's chart: its source's, its reader's (review fix 6) ──────────────────────────────────────────────
def clear(t):
    """No copy of the tile anywhere: not in memory, not on disk."""
    with A._enc_tile_locks_lock:
        A._enc_tile_mem.pop(A._bbox_key(t), None)
    for p in [A._tile_path(t)] + A._older_tile_paths(t):
        if os.path.exists(p):
            os.remove(p)


def kept_as(t, drop=(), **over):
    """A whole tile_v4 at `t` as this console keeps one - its one feature a sentinel (oid 4242) no read of the cells
    gives - with `over` in its header and `drop` left out of it. Its file's bytes."""
    got = dict({"tile": t, "bands": ["enc_harbour"], "unread": [], "unread_failed": [], "partial": [], "complete": True,
                "reader": A._ENC_TILE_READER, "read_at": time.time() - 3600, "sources": dict(ALL_CELLS),
                "cells_reader": enc_cells.reader_tag(),
                "features": [{"role": "depth_area", "cls": "Depth_Area", "props": {"DRVAL1": 3.0}, "oid": 4242,
                              "band": "enc_harbour", "geometry": {"type": "Polygon", "coordinates": SQ_H}}]}, **over)
    for k in drop:
        got.pop(k, None)
    A._write_tile_jsonl(A._tile_path(t), got)
    with open(A._tile_path(t), "rb") as f:
        return f.read()


def sentinel(d):
    return any(f.get("oid") == 4242 for f in (d or {}).get("features") or [])


ALL_CELLS = {b: "cells" for b in A.ENC_BANDS + [A.ENC_BERTHING]}
ALL_ED = {b: "encdirect" for b in A.ENC_BANDS + [A.ENC_BERTHING]}

net10 = Net()
src10 = fresh(net10)
keep_all(src10, but=("US5TSTAB",))
net10.down.add("US5TSTAB")                           # check 3's harbor cell: neither downloaded nor kept
clear(TILE)
A._enc_coverage, A.fetch_enc_features = encdirect_cov, feats_spy
try:
    t10 = A.fetch_enc_tile(TILE)
finally:
    A._enc_coverage, A.fetch_enc_features = _cov0, _feat0
check("10. A TILE WITH A BAND READ FROM ENCDIRECT IS NOT KEPT as the cells' chart: served and said, not whole, held "
      "ENC_TILE_RETRY_S and then read from the cells again - never written to disk. It was kept, and served a week as "
      "the cells' chart (no pontoons, none of NOAA's corrections since ENCDirect's read) even once the cells could be "
      "read again",
      lambda: not t10.get("complete") and t10.get("encdirect_bands") == ["enc_harbour"] and t10.get("stale")
              and isinstance(t10.get("retry_at"), float) and not os.path.exists(A._tile_path(TILE)),
      lambda: "complete %s from ENCDirect %s retry_at %s kept %s stale %r" % (
          t10.get("complete"), t10.get("encdirect_bands"), t10.get("retry_at"), os.path.exists(A._tile_path(TILE)),
          t10.get("stale")))

net10b = Net()
fresh(net10b)
clear(TILE)
kept_as(TILE, drop=("cells_reader",), sources=dict(ALL_ED))
A._enc_down_until = time.monotonic() + 600.0         # ENCDirect's breaker ARMED (it stops ENCDirect alone): the cells
try:
    t10b = A.fetch_enc_tile(TILE)
finally:
    A._enc_down_until = 0.0
head10b = A._read_tile_head(A._tile_path(TILE)) or {}
check("10b. A TILE KEPT BY A CONSOLE RUN WITH ENCDIRECT THE SOURCE (--enc-source encdirect), on disk when the cells are "
      "the source, is read again FIRST: from the cells, whole, kept as theirs (this reader's tag, every band the cells') "
      "- the copy's sentinel gone. It was served as the cells' chart, without the pontoons",
      lambda: t10b.get("complete") and set(t10b["sources"].values()) == {"cells"} and not sentinel(t10b)
              and head10b.get("cells_reader") == enc_cells.reader_tag()
              and set((head10b.get("sources") or {}).values()) == {"cells"} and net10b.asked("US5TSTAA") == 1,
      lambda: "complete %s sources %s sentinel %s; kept: reader %s sources %s; harbor cell asked %d" % (
          t10b.get("complete"), t10b.get("sources"), sentinel(t10b), head10b.get("cells_reader"),
          head10b.get("sources"), net10b.asked("US5TSTAA")))

net10c = Net()
net10c.down.add("catalog")
fresh(net10c)                                        # no catalog kept and NOAA's cannot be had: no cell can be read
clear(TILE)
before10c = kept_as(TILE, drop=("cells_reader",), sources=dict(ALL_ED, enc_approach="cells"))
V3_10 = os.path.join(A.ENC_DIR, "tile_v3_%s.jsonl" % A._bbox_key(TILE))
A._write_tile_jsonl(V3_10, dict(v3, tile=TILE))      # and ENCDirect's older reader's copy (its span, oid 7)
A._enc_down_until = time.monotonic() + 30.0          # ENCDirect's breaker: nor can ENCDirect be read
try:
    t10c = A.fetch_enc_tile(TILE)
finally:
    A._enc_down_until = 0.0
with open(A._tile_path(TILE), "rb") as _f:
    after10c = _f.read()
check("10c. ... and when that read fails, the copy kept is served - before any older reader's (tile_v3, oid 7) - "
      "not whole, held ENC_TILE_RETRY_S, saying it was read with ENCDirect's bands and what that lacks; the copy left "
      "as it was",
      lambda: not t10c.get("complete") and sentinel(t10c) and not any(f.get("oid") == 7 for f in t10c["features"])
              and ("with the harbor / coastal / general / overview / berthing charts from NOAA's ENCDirect service is "
                   "used - it lags NOAA's corrections" in (t10c.get("stale") or ""))
              and t10c.get("note") == t10c["stale"] and isinstance(t10c.get("retry_at"), float)
              and after10c == before10c and os.path.exists(V3_10),
      lambda: "complete %s sentinel %s oids %s retry_at %s copy unchanged %s; stale %r" % (
          t10c.get("complete"), sentinel(t10c), sorted({str(f.get("oid")) for f in t10c.get("features") or []})[:4],
          t10c.get("retry_at"), after10c == before10c, t10c.get("stale")))

net10d = Net()
fresh(net10d)
clear(TILE)
kept_as(TILE, cells_reader="0123456789abcdef")     # another build of the cell reader
A._enc_down_until = time.monotonic() + 600.0       # (ENCDirect's breaker armed: the cells alone)
try:
    t10d = A.fetch_enc_tile(TILE)
    clear(TILE)
    kept_as(TILE, drop=("cells_reader",))          # kept before a tile named its reader
    t10d2 = A.fetch_enc_tile(TILE)
    clear(TILE)
    kept_as(TILE)                                  # this reader's
    calls10 = len(net10d.calls)
    t10d3 = A.fetch_enc_tile(TILE)
    own10 = A._older_tile(TILE)                    # this reader's tile, and no older copy: no fallback
finally:
    A._enc_down_until = 0.0
check("10d. A TILE AN EARLIER BUILD OF THE CELL READER KEPT - its cells_reader another tag, or none (kept before a tile "
      "carried one) - is read again; the tag hashes s57.py, enc_cells.py and the tables, so no one has to bump a number "
      "for a reader change to reach the tiles kept. A tile of THIS reader is served as kept, nothing asked of NOAA - and "
      "is never its own fallback (_older_tile)",
      lambda: t10d.get("complete") and not sentinel(t10d) and t10d2.get("complete") and not sentinel(t10d2)
              and t10d3.get("complete") and sentinel(t10d3) and len(net10d.calls) == calls10 and own10 is None,
      lambda: "other tag: complete %s sentinel %s; none: complete %s sentinel %s; this reader's: complete %s sentinel %s, "
              "NOAA asked %d, its own fallback %s" % (
                  t10d.get("complete"), sentinel(t10d), t10d2.get("complete"), sentinel(t10d2), t10d3.get("complete"),
                  sentinel(t10d3), len(net10d.calls) - calls10, own10 is not None))

TAG = enc_cells.reader_tag()
nc = {"cells, mixed": A._tile_not_current({"sources": {"enc_harbour": "encdirect", "enc_approach": "cells"}, "cells_reader": TAG}),
      "cells, this reader": A._tile_not_current({"sources": dict(ALL_CELLS), "cells_reader": TAG}),
      "cells, none named": A._tile_not_current({})}
A.ENC_SOURCE = "encdirect"
try:
    nc.update({"encdirect, the cells'": A._tile_not_current({"sources": dict(ALL_CELLS), "cells_reader": TAG}),
               "encdirect, its own": A._tile_not_current({"sources": dict(ALL_ED)}),
               "encdirect, none named": A._tile_not_current({})})
finally:
    A.ENC_SOURCE = "cells"
check("10e. WHOSE CHART A KEPT TILE IS (_tile_not_current): with the cells the source, one with a band ENCDirect's names "
      "that band and what it lacks; one naming no source is an earlier reader's; this reader's is current - with "
      "ENCDirect the source, a tile of the cells' is not its chart, and its own, or one naming none (kept before tiles "
      "named a source), is",
      lambda: nc["cells, mixed"] == ("with the harbor chart from NOAA's ENCDirect service",
                                     "it lags NOAA's corrections and lacks what that service never served: the harbor "
                                     "chart's pontoons, among others")
              and nc["cells, this reader"] is None and nc["cells, none named"] == ("by an earlier build of the cell reader", "")
              and nc["encdirect, the cells'"] == ("from NOAA's cells, where this console reads NOAA's ENCDirect service", "")
              and nc["encdirect, its own"] is None and nc["encdirect, none named"] is None,
      lambda: "; ".join("%s: %r" % kv for kv in nc.items()))

ran10 = []
_run0 = A.subprocess.run


def run_rec(cmd, **kw):
    ran10.append([c for c in cmd if c.startswith("--enc-")][:1])
    return A.subprocess.CompletedProcess(cmd, 3)


A.subprocess.run = run_rec
A.ENC_SOURCE = "encdirect"
A._enc_down_until = time.monotonic() + 30.0
try:
    clear(TILE)
    g_none = A._enc_tile_build_child(TILE)
    kept_as(TILE)
    g_v4 = A._enc_tile_build_child(TILE)
finally:
    A.subprocess.run = _run0
    A.ENC_SOURCE = "cells"
    A._enc_down_until = 0.0
check("10f. ... so with ENCDirect the source and its breaker tripped, a tile with no copy kept is offline at once, no "
      "child started - while one with a tile_v4 of the cells kept starts the child, which serves that copy when its "
      "read fails",
      lambda: g_none.get("note") == "ENC offline (no cache for this tile)" and ran10 == [["--enc-tile-worker"]]
              and "exit 3" in (g_v4.get("note") or ""),
      lambda: "no copy: %r; a copy of the cells': %r; children %s" % (g_none.get("note"), g_v4.get("note"), ran10))

clear(TILE)
T_AT = time.time() - 60
kept_as(TILE, drop=("cells_reader",), sources=dict(ALL_ED), read_at=T_AT)
g_ed = A._grid_of_tile(TILE, ({"read_at": T_AT}, b""))
asked_t, ran10[:] = [], []
_fet0 = A.fetch_enc_tile
A.fetch_enc_tile = lambda t: (asked_t.append(list(t)), {"tile": t, "complete": False, "note": "not read here"})[1]
A.subprocess.run = run_rec
try:
    gm = A._grid_make(TILE, A._bbox_key(TILE))
finally:
    A.fetch_enc_tile = _fet0
    A.subprocess.run = _run0
kept_as(TILE, read_at=T_AT)
g_ok = A._grid_of_tile(TILE, ({"read_at": T_AT}, b""))
check("10g. A GRID IS ITS TILE'S, AND THE TILE THIS CONSOLE'S: one tied to a tile the ENCDirect console kept (the same "
      "read_at) is not served, and that tile is read (fetch_enc_tile) before any grid is made - none made of it - while "
      "the grid of this console's tile is served",
      lambda: g_ed is None and asked_t == [TILE] and not ran10 and gm == (None, "not read here") and g_ok is not None,
      lambda: "ENCDirect's tile: grid %s, tiles read %s, grid children %s, made %r; this console's: grid %s"
              % (g_ed is not None, asked_t, ran10, gm, g_ok is not None))
clear(TILE)

shutil.rmtree(TMP, ignore_errors=True)
print("\n" + ("%d CHECK(S) FAILED (%d ran)" % (fails, ran) if fails else "all checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
