"""tests/passage_grid.py - the passage grid: each chart tile as a plan of the water (asv_console.py "THE PASSAGE GRID").

Andy, 2026-10-12: "Step 4" of the long-transit plan - a passage planner, coarse over the whole passage. The page plans
it (static/js/coarse.js, tests/passage_plan.js) off a GRID the server keeps beside every chart tile: 256 x 256 cells,
two layers - the shallowest danger at each cell's CENTER (C) and TOUCHING it anywhere (T) - judged as the page's
keep-out model judges. Hermetic: ENC_DIR a temp folder, NOAA stood in for (ASV_ENC_TILE_FAKE, as chart_read_stall.py).

WHAT IS PINNED:
  1    THE RASTER, each rule against what the page's keep-out model does: land HARD inside and on its edges, never
       outside; a depth area by its DEEPEST depth (DRVAL2 - the control: its DRVAL1 would block a "0 to 18 m" area the
       page sails); DRVAL1 when there is no DRVAL2; a rock by VALSOU less a meter, touching only; a buoy, a lateral mark
       and a dock line HARD where they are; soundings and contours nothing; a cell no depth area reaches NODATA (a
       float); an unread square UNREAD in both layers;
  2    THE FILE: written and read back whole - the header (bands, unread, complete), the arrays at an EVEN offset with an
       odd-length header, a file cut short not read - and the page's own decodeGrid (coarse.js, run in node) reads the
       same cells this module wrote: the format checked across the two languages, not round-tripped in one;
  3    THE TILE'S OWN CHILD makes its grid: a tile read whole has one beside it; a tile served with a layer missing,
       or a child that crashed, has none, and nothing half-written is left;
  4    A CACHED TILE WITHOUT A GRID: made in a child of its own (--enc-grid-worker), the tile NOT read into this
       process; asked again, from disk with no child; a tile not cached is read (fetch_enc_tile) and its grid comes
       with it;
  5    THE CORRIDOR READ WITH GRIDS: a job of its own (not the same tiles' plain read), its tally from the grids'
       headers without reading a tile into this process, its status listing the tiles; a tile that cannot be gridded
       listed failed;
  6    OVER HTTP (a console of its own): /api/enc/grid routed ahead of /api/enc; the grid's bytes as an
       octet-stream; no grid a 404, a malformed tile a 400; a corridor read with grids over a seeded tile makes it.

  python tests/passage_grid.py   # exit 0 = pass
"""
import json
import os
import shutil
import socket
import struct
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-800:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

APP = os.environ.get("ASV_APP") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)
import asv_console as A                                       # noqa: E402

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


N = A.ENC_GRID_N
TILE = [-70.75, 43.0, -70.5, 43.25]
D = 0.25 / N


def cell_ll(col, row):
    return [TILE[0] + (col + 0.5) * D, TILE[1] + (row + 0.5) * D]


def sq_cells(c0, r0, c1, r1):
    """A ring over cells c0..c1, r0..r1 (edges on the cells' outer boundaries, nudged a hair inside)."""
    e = D * 0.01
    W, S, E, Nn = TILE[0] + c0 * D + e, TILE[1] + r0 * D + e, TILE[0] + (c1 + 1) * D - e, TILE[1] + (r1 + 1) * D - e
    return [[W, S], [E, S], [E, Nn], [W, Nn], [W, S]]


def ft(role, geom, **props):
    return {"role": role, "cls": role, "props": props, "geometry": geom, "oid": 1}


TMP = tempfile.mkdtemp(prefix="asv_passage_grid_")
A.ENC_DIR = TMP
print("The passage grid:")

# ── 1. the raster ─────────────────────────────────────────────────────────────────────────────────────────────────
whole_sea = {"type": "Polygon", "coordinates": [sq_cells(0, 0, N - 1, 199)]}
got = {"tile": TILE, "complete": True, "bands": ["enc_harbour"], "unread": [[TILE[0], TILE[1] + 220 * D, TILE[0] + 10 * D, TILE[1] + 230 * D]],
       "unread_failed": [], "partial": [],
       "features": [
           ft("depth_area", whole_sea, DRVAL1=20.0, DRVAL2=30.0),                                      # deep sea, rows 0-199
           ft("land", {"type": "Polygon", "coordinates": [sq_cells(10, 10, 19, 19)]}),                 # land 10-19
           ft("depth_area", {"type": "Polygon", "coordinates": [sq_cells(40, 10, 49, 19)]}, DRVAL1=0.0, DRVAL2=18.2),
           ft("depth_area", {"type": "Polygon", "coordinates": [sq_cells(60, 10, 69, 19)]}, DRVAL1=2.0),
           ft("hazard_point", {"type": "Point", "coordinates": cell_ll(80, 15)}, VALSOU=5.0),         # a rock, 5 m over
           ft("hazard_point", {"type": "Point", "coordinates": cell_ll(90, 15)}),                     # a buoy, no VALSOU
           ft("chan_mark", {"type": "Point", "coordinates": cell_ll(100, 15)}),
           ft("dock_line", {"type": "LineString", "coordinates": [cell_ll(110, 15), cell_ll(119, 15)]}),
           ft("sounding", {"type": "Point", "coordinates": cell_ll(130, 15)}),
           ft("depth_contour", {"type": "LineString", "coordinates": [cell_ll(140, 15), cell_ll(149, 15)]}),
           # land whose edges cross cells 160 and 165 without covering their centers: only the EDGES reach them
           ft("land", {"type": "Polygon", "coordinates": [[[TILE[0] + 160.6 * D, TILE[1] + 30.2 * D], [TILE[0] + 165.3 * D, TILE[1] + 30.2 * D],
                                                          [TILE[0] + 165.3 * D, TILE[1] + 39.8 * D], [TILE[0] + 160.6 * D, TILE[1] + 39.8 * D],
                                                          [TILE[0] + 160.6 * D, TILE[1] + 30.2 * D]]]}),
       ]}
C, T = A._tile_grid(got)
at = lambda arr, c, r: arr[r * N + c]
H, NOD, UNR = A.GRID_HARD, A.GRID_NODATA, A.GRID_UNREAD
checks1 = {
    "sea C/T 300": at(C, 30, 100) == 300 and at(T, 30, 100) == 300,
    "land C HARD inside": at(C, 15, 15) == H,
    "land T HARD on its edge cells": at(T, 10, 15) == H and at(T, 19, 12) == H,
    "land not outside": at(C, 9, 15) == 300 and at(C, 21, 15) == 300,
    "0-18.2 m area by DRVAL2: 182": at(C, 45, 15) == 182,
    "no DRVAL2: DRVAL1 2 m -> 20": at(C, 65, 15) == 20,
    "rock: T VALSOU-1 = 40, C untouched": at(T, 80, 15) == 40 and at(C, 80, 15) == 300,
    "buoy HARD (T)": at(T, 90, 15) == H and at(C, 90, 15) == 300,
    "lateral mark HARD (T)": at(T, 100, 15) == H,
    "dock line HARD (T) along it": all(at(T, c, 15) == H for c in (110, 114, 119)),
    "sounding, contour: nothing": at(T, 130, 15) == 300 and at(T, 145, 15) == 300,
    "an edge through a cell, its center not covered: T HARD, C water": at(T, 160, 35) == H and at(C, 160, 35) == 300
                                                                          and at(T, 165, 35) == H and at(C, 165, 35) == 300
                                                                          and at(C, 163, 35) == H,
    "no depth area: NODATA": at(C, 50, 210) == NOD and at(T, 50, 210) == NOD,
    "unread square: UNREAD both": at(C, 5, 225) == UNR and at(T, 5, 225) == UNR,
}
check("1. THE RASTER judges as the page's keep-out model: land HARD inside and on its edges, never outside; a depth area "
      "by its DEEPEST depth (a 0-18.2 m area is 18.2 m - its DRVAL1 would block water the page sails), DRVAL1 without a "
      "DRVAL2; a rock by VALSOU less a meter, touching only; a buoy, a lateral mark, a dock line HARD where they are; "
      "soundings and contours nothing; an edge through a cell marks it touched, its center still water; no depth area "
      "NODATA; an unread square UNREAD in both layers",
      lambda: all(checks1.values()),
      lambda: "failed: " + ", ".join(k for k, v in checks1.items() if not v) if not all(checks1.values()) else "all 14 rules")

# ── 2. the file ───────────────────────────────────────────────────────────────────────────────────────────────────
gp = os.path.join(TMP, "g.bin")
A._write_grid(gp, got)
back = A._grid_read(gp)
raw = open(gp, "rb").read()
hlen = struct.unpack("<I", raw[4:8])[0]
odd = dict(got, bands=["enc_harbour", "x"])                         # a header length of the other parity
gp2 = os.path.join(TMP, "g2.bin")
A._write_grid(gp2, odd)
raw2 = open(gp2, "rb").read()
open(os.path.join(TMP, "cut.bin"), "wb").write(raw[:-10])
cut = A._grid_read(os.path.join(TMP, "cut.bin"))
node_src = ("const C=require(process.argv[1]);const fs=require('fs');const b=fs.readFileSync(process.argv[2]);"
            "const g=C.decodeGrid(b.buffer.slice(b.byteOffset,b.byteOffset+b.length));const N=C.GRID_N;"
            "const at=(a,c,r)=>a[r*N+c];console.log(JSON.stringify({bands:g.head.bands,v:[at(g.C,30,100),at(g.C,15,15),"
            "at(g.C,45,15),at(g.T,80,15),at(g.C,50,210),at(g.T,5,225)]}))")
try:
    js = subprocess.run(["node", "-e", node_src, os.path.join(APP, "static", "js", "coarse.js"), gp2],
                        capture_output=True, text=True, timeout=60)
    jsv = json.loads(js.stdout.strip() or "{}")
except (OSError, ValueError) as e:
    jsv = {"error": str(e)}
want = [300, H, 182, 40, NOD, UNR]
check("2. THE FILE: read back whole (header and arrays), the arrays at an EVEN offset whichever the header's length, a file "
      "cut short NOT read - and the page's own decodeGrid (coarse.js, in node) reads the same cells this module wrote",
      lambda: back is not None and back[0]["complete"] and back[0]["unread"] == got["unread"] and back[1] == raw
              and (8 + hlen) % 2 == 0 and (8 + struct.unpack("<I", raw2[4:8])[0]) % 2 == 0 and cut is None
              and jsv.get("v") == want and jsv.get("bands") == ["enc_harbour", "x"],
      lambda: "header %d / %d bytes; cut %s; node %s (want %s)" % (hlen, struct.unpack("<I", raw2[4:8])[0], cut, jsv, want))

# ── 3. the tile's own child ───────────────────────────────────────────────────────────────────────────────────────
inner = [[-70.70, 43.05], [-70.55, 43.05], [-70.55, 43.20], [-70.70, 43.20], [-70.70, 43.05]]
outer = [[-71.0, 42.9], [-69.0, 42.9], [-69.0, 43.4], [-71.0, 43.4], [-71.0, 42.9]]
FAKE = {"coverage": {"enc_harbour": [[inner]], "enc_coastal": [[outer]]},
        "features": {"enc_harbour": [{"role": "depth_area", "cls": "Depth_Area", "props": {"DRVAL1": 5.0, "DRVAL2": 10.0}, "oid": 1,
                                      "geometry": {"type": "Polygon", "coordinates": [inner]}}],
                     "enc_coastal": [{"role": "depth_area", "cls": "Depth_Area", "props": {"DRVAL1": 20.0, "DRVAL2": 50.0}, "oid": 2,
                                      "geometry": {"type": "Polygon", "coordinates": [outer]}}]}}
fake_path = os.path.join(TMP, "fake.json")
runs = []
_run = A.subprocess.run


def counted(*a, **k):
    runs.append(a[0])
    return _run(*a, **k)


A.subprocess.run = counted
tiles_read = []
_fet = A.fetch_enc_tile


def fet(t):
    tiles_read.append(list(t))
    return _fet(t)


A.fetch_enc_tile = fet


def with_fake(fake):
    json.dump(fake, open(fake_path, "w", encoding="utf-8"))
    os.environ["ASV_ENC_TILE_FAKE"] = fake_path
    A._enc_tile_mem.clear()
    A._enc_down_until = 0.0


try:
    with_fake(FAKE)
    d1 = A.fetch_enc_tile(TILE)
    g1 = A._grid_read(A._grid_path(TILE))
    gC = None
    if g1:
        n = struct.unpack("<I", g1[1][4:8])[0]
        from array import array
        gC = array("h")
        gC.frombytes(g1[1][8 + n:8 + n + 2 * N * N])
    t2 = [-70.5, 43.0, -70.25, 43.25]
    with_fake(dict(FAKE, partial={"enc_coastal": ["Depth_Area"]}))
    d2 = A.fetch_enc_tile(t2)
    t3 = [-70.25, 43.0, -70.0, 43.25]
    with_fake({"crash": True})
    d3 = A.fetch_enc_tile(t3)
    left = [f for f in os.listdir(TMP) if f.endswith(".build") or f.endswith(".part")]
    check("3. THE TILE'S OWN CHILD makes its grid: read whole, the grid beside it (its header the tile's; the harbor "
          "chart's 10 m inside its outline, the coastal 50 m outside); a layer missing, or a child that crashed: no grid, "
          "and nothing half-written left",
          lambda: d1.get("complete") and g1 is not None and g1[0]["bands"] == d1["bands"] and g1[0]["complete"]
                  and gC[128 * N + 128] == 100 and gC[5 * N + 5] == 500
                  and not d2.get("complete") and not os.path.exists(A._grid_path(t2))
                  and d3.get("unread_failed") and not os.path.exists(A._grid_path(t3)) and not left,
          lambda: "whole %s grid %s (center %s, corner %s); partial grid %s; crash grid %s; leftovers %s"
                  % (d1.get("complete"), g1 is not None, gC and gC[128 * N + 128], gC and gC[5 * N + 5],
                     os.path.exists(A._grid_path(t2)), os.path.exists(A._grid_path(t3)), left))

    # ── 4. a cached tile without a grid ─────────────────────────────────────────────────────────────────────────
    t4 = [-70.0, 43.0, -69.75, 43.25]
    A._write_tile_jsonl(A._tile_path(t4), {"tile": t4, "features": FAKE["features"]["enc_coastal"], "bands": ["enc_coastal"],
                                           "unread": [], "unread_failed": [], "partial": [], "complete": True})
    with_fake({"crash": True})                       # NOAA can give nothing: only the cached tile can answer
    del runs[:]
    del tiles_read[:]
    h4, b4 = A.fetch_enc_grid(t4)
    first_runs, first_reads = list(runs), list(tiles_read)
    del runs[:]
    h4b, b4b = A.fetch_enc_grid(t4)
    again_runs = list(runs)
    t5 = [-69.75, 43.0, -69.5, 43.25]
    with_fake(FAKE)
    del tiles_read[:]
    h5, b5 = A.fetch_enc_grid(t5)
    check("4. A CACHED TILE WITHOUT A GRID: made in a child of its own (--enc-grid-worker), the tile NOT read into this "
          "process; asked again, from disk with no child; a tile not cached is read (fetch_enc_tile) and its grid comes "
          "with it",
          lambda: h4 is not None and h4["bands"] == ["enc_coastal"] and len(first_runs) == 1
                  and "--enc-grid-worker" in first_runs[0] and not first_reads and not again_runs and b4b == b4
                  and h5 is not None and tiles_read == [t5] and os.path.exists(A._grid_path(t5)),
          lambda: "grid %s; children %s; tiles read %s; again children %d; uncached: grid %s, read %s"
                  % (h4 and h4["bands"], [r[2] for r in first_runs], first_reads, len(again_runs), h5 is not None, tiles_read))

    # ── 5. the corridor read with grids ─────────────────────────────────────────────────────────────────────────
    with_fake({"crash": True})
    route = [{"lat": 43.10, "lon": -69.95}, {"lat": 43.10, "lon": -69.70}]    # t4 and t5, both gridded now
    plain = A.corridor_start({"route": route, "half_km": 1})
    for _ in range(80):
        if A.corridor_status(plain["id"])["state"] != "running":
            break
        time.sleep(0.1)
    del tiles_read[:]
    st = A.corridor_start({"route": route, "half_km": 1, "grids": True})
    for _ in range(80):
        st = A.corridor_status(st["id"])
        if st["state"] != "running":
            break
        time.sleep(0.1)
    reads5 = list(tiles_read)
    t6 = [-69.5, 43.0, -69.25, 43.25]                # not cached, NOAA "crashes": no grid
    st6 = A.corridor_start({"route": [{"lat": 43.10, "lon": -69.40}], "half_km": 1, "grids": True})
    for _ in range(200):
        st6 = A.corridor_status(st6["id"])
        if st6["state"] != "running":
            break
        time.sleep(0.1)
    check("5. THE CORRIDOR READ WITH GRIDS: a job of its own (not the plain read of the same tiles), done, its tally from "
          "the grids' headers - NO tile read into this process - its status listing the tiles; a tile that cannot be "
          "gridded listed failed",
          lambda: st["id"] != plain["id"] and st["state"] == "done" and st.get("grids") is True
                  and sorted(map(tuple, st.get("tiles") or [])) == sorted([tuple(t4), tuple(t5)]) and not reads5
                  and sum(st["bands"].values()) == 2 and not st["failed"]
                  and st6["state"] == "done" and len(st6["failed"]) == 1,
          lambda: "ids %s/%s; state %s grids %s tiles %s; tiles read %s; bands %s failed %s; ungriddable failed %s"
                  % (plain["id"], st["id"], st["state"], st.get("grids"), st.get("tiles"), reads5, st["bands"], st["failed"],
                     st6["failed"]))
finally:
    A.subprocess.run = _run
    A.fetch_enc_tile = _fet
    os.environ.pop("ASV_ENC_TILE_FAKE", None)

# ── 6. over HTTP ──────────────────────────────────────────────────────────────────────────────────────────────────
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from console_state import ConsoleState                         # noqa: E402


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def http(port, path, body=None):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"} if body is not None else {})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.headers.get("Content-Type"), r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.headers.get("Content-Type"), e.read()


# a mid-ocean tile seeded in the app's chart cache - so its grid can only have come from it - removed after, with the
# grid the console makes of it
ENC_DIR = os.path.join(APP, "charts", "enc")
os.makedirs(ENC_DIR, exist_ok=True)
OT = [-150.0, 20.0, -149.75, 20.25]
A.ENC_DIR = ENC_DIR
SEED, SEED_GRID = A._tile_path(OT), A._grid_path(OT)
A.ENC_DIR = TMP
had_grid = os.path.exists(SEED_GRID)
A._write_tile_jsonl(SEED, {"tile": OT, "features": [{"role": "depth_area", "cls": "Depth_Area", "oid": 1,
                                                     "props": {"DRVAL1": 3000.0, "DRVAL2": 4000.0},
                                                     "geometry": {"type": "Polygon", "coordinates": [[[-150.0, 20.0], [-149.75, 20.0], [-149.75, 20.25], [-150.0, 20.25], [-150.0, 20.0]]]}}],
                           "bands": ["enc_general"], "unread": [], "unread_failed": [], "partial": [], "complete": True})
STATE = ConsoleState()
port = free_port()
log = tempfile.TemporaryFile(mode="w+")
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none", "--port", str(port),
                         "--no-ais-service", *STATE.args()], cwd=APP, stdout=log, stderr=subprocess.STDOUT)
try:
    up = False
    for _ in range(80):
        try:
            if http(port, "/api/state")[0] == 200:
                up = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    q = "/api/enc/grid?tile=" + ",".join(str(v) for v in OT)
    before = http(port, q) if up else (0, None, b"")
    bad = http(port, "/api/enc/grid?tile=1,2,3") if up else (0, None, b"")
    s0 = http(port, "/api/enc/corridor", {"route": [{"lat": 20.10, "lon": -149.90}], "half_km": 1, "grids": True}) if up else (0, None, b"{}")
    st = json.loads(s0[2] or b"{}")
    for _ in range(120):
        if st.get("state") != "running":
            break
        time.sleep(0.25)
        st = json.loads(http(port, "/api/enc/corridor?id=" + str(st.get("id")))[2] or b"{}")
    after = http(port, q) if up else (0, None, b"")
    src = open(os.path.join(APP, "asv_console.py"), encoding="utf-8").read()
    gi, ei = src.find('elif self.path.startswith("/api/enc/grid"):'), src.find('elif self.path.startswith("/api/enc"):\n            self._serve_enc()')
    order = 0 <= gi < ei
    disk = open(SEED_GRID, "rb").read() if os.path.exists(SEED_GRID) else None
    check("6. OVER HTTP (a console of its own): /api/enc/grid routed AHEAD of /api/enc; no grid yet a 404 in words, a "
          "malformed tile a 400; a corridor read with grids over a seeded mid-ocean tile makes its grid, which is then "
          "served as an octet-stream, the file's own bytes",
          lambda: up and order and before[0] == 404 and b"read the chart" in before[2] and bad[0] == 400
                  and st.get("state") == "done" and st.get("tiles") == [OT] and after[0] == 200
                  and after[1] == "application/octet-stream" and disk is not None and after[2] == disk,
          lambda: "up %s order %s; before %s; bad %s; job %s; after %s %s %d bytes"
                  % (up, order, before[0], bad[0], st.get("state"), after[0], after[1], len(after[2])))
finally:
    proc.terminate()
    try:
        proc.wait(10)
    except Exception:
        proc.kill()
    for f in (SEED,) + (() if had_grid else (SEED_GRID,)):
        try:
            os.remove(f)
        except OSError:
            pass
    STATE.cleanup() if hasattr(STATE, "cleanup") else None

shutil.rmtree(TMP, ignore_errors=True)
print("\n" + ("%d CHECK(S) FAILED (%d ran)" % (fails, ran) if fails else "all checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
