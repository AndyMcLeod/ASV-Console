"""tests/enc_layered.py - the chart in layers: each band where it is the best there is, unread water said.

Andy, 2026-10-11 (step 2 of the long-transit plan): read the chart in fixed tiles and, within each, use the most
detailed scale wherever it exists and fill the rest from the next coarser one; water no chart covers is UNREAD, never
clear. His choice of the three ways to do it without a geometry library: approximate the edge of a finer chart's
coverage with small squares, both charts' hazards applying in the squares the edge runs through.

The defect it answers, measured on his own cache: fetch_enc_features served ONE band per box - the finest with ANY
coverage - so wherever that band has no cell the box held nothing, and an extract from Portsmouth to Cape Cod at
harbour band had depth or land under 43% of its box. Everything else read as open water.

WHAT IS PINNED (asv_console.py's layered block, hermetic - the service is stubbed, the cache is a temp folder):
  1    the tile grid: fixed, aligned, a box on a tile line not given an extra row;
  2    a band's union: edges two cells share cancel - vertex for vertex, and as collinear intervals where the two cells
       split the line at different vertices - and an edge one cell alone lays stays a boundary;
  3    the square-and-rectangle test the squares are judged by (interior, not along the edge, not a corner);
  4    the squares, on a synthetic harbour (two cells, the seam split differently) inside a coastal chart: no coastal
       square inside the harbour's union away from its edge, every square both apply in touches that edge, the strip
       one square wide, unread squares exactly where no chart reaches;
  4b   on his REAL Portsmouth harbour coverage (tests/fixtures/enc_cov_portsmouth.json, six cells): the seams between
       the cells cost no strip - not one square inside the union away from its outer edge is partial;
  5    the cutting: pieces of a polygon (with a hole) over rectangles tiling it add up to its area; a line's pieces to
       its length; points split once each; a feature inside one rectangle kept whole, with no `clip`;
  6    the tile, the service stubbed: the finest band whole, a coarser band's land cut away inside the finer chart's
       coverage (kept only outside it and in the strip), unread water reported and cut to the box, a feature two tiles
       fetched kept once, the depth floor tagged per request without touching the cached tile;
  6b   a tile with a failed layer is served and NOT cached; a complete one is cached and read again without the
       service; a coverage that cannot be read makes the tile UNREAD (failed), never empty water;
  7    the endpoint serves the layered read.

  python tests/enc_layered.py   # exit 0 = pass

TEETH - sixteen mutations RUN on scratch copies (scratchpad mutate_layered.py), fifteen caught; three of them
SURVIVED the first cut and the checks named were written for them:
  shared edges not canceled vertex for vertex                   -> 2, 4b
  no interval cancellation on a grid line                       -> 2, 4, 4b, 6
  the strip loses the coarser chart                             -> 4, 6
  a square no chart covers whole called read                    -> 4
  the clip's right edge tested the wrong way                    -> 5, 6
  a straddling coarse feature kept whole                        -> 5, 6
  the harbour chart cut as well                                 -> 6 (survived: a rectangular synthetic harbour
                                                                   merges back into one square; the cutter is now
                                                                   watched for which charts reach it)
  a coarser chart served whole                                  -> 6
  a tile with a failed layer cached                             -> 6c
  a coverage that cannot be read served as empty water          -> 6c
  a feature two tiles fetched kept twice                        -> 6b (survived: the second tile had no harbour
                                                                   cell, so nothing was fetched twice)
  the depth floor written into the cached tile                  -> 6a (survived: only the disk copy was read; the
                                                                   tile held in memory is read too now)
  the endpoint back on one band                                 -> 7
  unread squares not cut to the box                             -> 6c
  a box on a tile line given an extra column                    -> 1
  the point inside a square taken at its exact center           -> EQUIVALENT, not a gap: the even-odd test's
                                                                   half-open rule already puts a point ON an edge
                                                                   two cells share in exactly one of them; the
                                                                   offset point is belt and braces
"""
import json
import math
import os
import random
import shutil
import sys
import tempfile


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


def ring_area(r):
    return abs(sum(r[i - 1][0] * r[i][1] - r[i][0] * r[i - 1][1] for i in range(len(r)))) / 2.0


def geom_area(g):
    polys = A._geom_polys(g)
    return sum(ring_area(p[0]) - sum(ring_area(h) for h in p[1:]) for p in polys if p)


def sq(W, S, E, N):
    return [[W, S], [E, S], [E, N], [W, N], [W, S]]


# THE APP'S OWN CACHE MUST NOT BE TOUCHED: every read here goes to a temp folder, and the app folder's chart cache is
# listed before and after.
APP_ENC = os.path.join(APP, "charts", "enc")
before = set(os.listdir(APP_ENC)) if os.path.isdir(APP_ENC) else set()
TMP = tempfile.mkdtemp(prefix="asv_enc_layered_")
A.ENC_DIR = TMP
# the service is stubbed IN THIS PROCESS, so the tile is built here too (the console builds it in a child process -
# tests/chart_read_stall.py; the child runs this same _enc_tile_build)
A.ENC_TILE_IN_PROCESS = True

print("The chart in layers:")

# ── 1. the tile grid ──────────────────────────────────────────────────────────────────────────────────────────────
T = A.ENC_TILE_DEG
one = A._enc_tiles([-70.70, 43.05, -70.60, 43.10])
four = A._enc_tiles([-70.80, 42.95, -70.60, 43.10])
edge = A._enc_tiles([-70.75, 43.00, -70.50, 43.25])
check("1. the tiles are a fixed grid of %s deg: a box inside one tile reads one, a box across a corner four, and a box "
      "whose edges lie on tile lines exactly its own tile" % T,
      lambda: one == [[-70.75, 43.0, -70.5, 43.25]] and len(four) == 4 and edge == [[-70.75, 43.0, -70.5, 43.25]]
              and all(abs(t[0] / T - round(t[0] / T)) < 1e-12 for t in four),
      lambda: "one %s, four %d, edge %s" % (one, len(four), edge))

# ── 2. a band's union ─────────────────────────────────────────────────────────────────────────────────────────────
# two cells side by side: the shared line at x=1 laid by both, vertex for vertex
a2 = A._cov_index([[sq(0, 0, 1, 1)], [sq(1, 0, 2, 1)]])
on_seam = [e for e in a2["edges"] if e[0] == 1 and e[2] == 1]
# the same, but the right cell splits the shared line at y=0.4 and y=0.7 (its coverage meets the line in pieces)
right = [[1, 0], [2, 0], [2, 1], [1, 1], [1, 0.7], [1, 0.4], [1, 0]]
b2 = A._cov_index([[sq(0, 0, 1, 1)], [right]])
b_seam = [e for e in b2["edges"] if e[0] == 1 and e[2] == 1]
# the right cell covers only y 0.3..1 along the line (a notch at its lower left): the line from 0 to 0.3 is the union's
notch = [[1, 0.3], [1.2, 0.3], [1.2, 0], [2, 0], [2, 1], [1, 1], [1, 0.3]]
c2 = A._cov_index([[sq(0, 0, 1, 1)], [notch]])
c_seam = sorted((min(e[1], e[3]), max(e[1], e[3])) for e in c2["edges"] if e[0] == 1 and e[2] == 1)
check("2. A BAND'S UNION: a line two cells share is no boundary - vertex for vertex, and when one cell splits it at "
      "other vertices (canceled as intervals); where only one cell lays it, it IS the boundary",
      lambda: on_seam == [] and b_seam == [] and len(c_seam) == 1 and abs(c_seam[0][0]) < 1e-12 and abs(c_seam[0][1] - 0.3) < 1e-12
              and len(a2["edges"]) == 6,
      lambda: "vertex-for-vertex seam edges %d, split seam %d, notch seam %s, outer edges %d" % (len(on_seam), len(b_seam), c_seam, len(a2["edges"])))

# ── 3. segment through a square ───────────────────────────────────────────────────────────────────────────────────
X = A._seg_crosses_rect
check("3. a segment crosses a square only through its INTERIOR: across it yes, wholly inside yes, along its edge no, "
      "through its corner no, outside no",
      lambda: X(-1, 0.5, 2, 0.5, 0, 0, 1, 1) and X(0.2, 0.2, 0.4, 0.6, 0, 0, 1, 1) and not X(0, -1, 0, 2, 0, 0, 1, 1)
              and not X(-1, 2, 2, -1, 0, 0, 1, 1) is False and not X(-1, 1, 1, 3, 0, 0, 1, 1) and not X(2, 2, 3, 3, 0, 0, 1, 1),
      "")

# ── 4. the squares on a synthetic chart ───────────────────────────────────────────────────────────────────────────
tile = [-70.75, 43.0, -70.5, 43.25]
# harbour: two cells meeting at x = -70.625, the right one splitting the seam at other vertices; the pair covers the
# middle of the tile, x -70.70..-70.55, y 43.05..43.20
SEAM = -70.6237                 # off the squares' own grid, so the squares that straddle it are the test
hl = [[-70.70, 43.05], [SEAM, 43.05], [SEAM, 43.20], [-70.70, 43.20], [-70.70, 43.05]]
hr = [[SEAM, 43.05], [-70.55, 43.05], [-70.55, 43.20], [SEAM, 43.20], [SEAM, 43.13], [SEAM, 43.08], [SEAM, 43.05]]
# coastal: the whole tile except a strip along its north edge, y > 43.24 (no chart at any scale there)
coast = [[-70.75, 43.0], [-70.5, 43.0], [-70.5, 43.24], [-70.75, 43.24], [-70.75, 43.0]]
COV = {"enc_harbour": [[hl], [hr]], "enc_approach": [], "enc_coastal": [[coast]], "enc_general": []}
idx = [A._cov_index(COV[b]) for b in A.ENC_BANDS]
leaves = A._enc_leaves(tile, idx)
LEAF = T / 2 ** A.ENC_LEAF_DEPTH
H, C = A.ENC_BANDS.index("enc_harbour"), A.ENC_BANDS.index("enc_coastal")


def in_harbour_interior(r, margin):
    return r[0] >= -70.70 + margin and r[2] <= -70.55 - margin and r[1] >= 43.05 + margin and r[3] <= 43.20 - margin


coastal_inside = [lf for lf in leaves if C in lf[1] and in_harbour_interior(lf[0], 1e-12)]
both = [lf for lf in leaves if H in lf[1] and C in lf[1]]
both_off_edge = [lf for lf in both if in_harbour_interior(lf[0], LEAF + 1e-12)
                 or not (lf[0][0] <= -70.55 + 1e-12 and lf[0][2] >= -70.70 - 1e-12 and lf[0][1] <= 43.20 + 1e-12 and lf[0][3] >= 43.05 - 1e-12)]
wide_both = [lf for lf in both if (lf[0][2] - lf[0][0]) > LEAF + 1e-12]
seam = [lf for lf in leaves if lf[0][0] < SEAM < lf[0][2] and lf[0][1] > 43.06 and lf[0][3] < 43.19]
unread = [lf for lf in leaves if not lf[2]]
unread_ok = all(lf[0][3] > 43.24 - 1e-12 for lf in unread) and any(lf[0][1] >= 43.24 for lf in unread)
read_north = [lf for lf in leaves if lf[2] and lf[0][3] > 43.24 + 1e-12]
check("4. THE SQUARES: no square inside the harbour's coverage takes the coastal chart; every square both apply in "
      "lies on the harbour's edge and is one square (%.5f deg) across; the seam between the two harbour cells - split "
      "at different vertices - costs nothing; the unread squares are the strip no chart reaches, and no square past "
      "the coastal edge is called read" % LEAF,
      lambda: not coastal_inside and both and not both_off_edge and not wide_both and seam and all(lf[1] == (H,) for lf in seam)
              and unread and unread_ok and not read_north,
      lambda: "coastal inside harbour %d, both %d (off the edge %d, wider than a square %d), seam squares %d (%s), "
              "unread %d (ok %s), read past the coastal edge %d"
              % (len(coastal_inside), len(both), len(both_off_edge), len(wide_both), len(seam),
                 sorted({lf[1] for lf in seam}), len(unread), unread_ok, len(read_north)))

# ── 4b. his real Portsmouth harbour coverage ──────────────────────────────────────────────────────────────────────
FIX = os.path.join(APP, "tests", "fixtures", "enc_cov_portsmouth.json")
cells = json.load(open(FIX, encoding="utf-8"))["cells"]
real = A._cov_index([A._geom_polys(c["geometry"])[0] for c in cells])
W0 = min(min(p[0] for p in A._geom_polys(c["geometry"])[0][0]) for c in cells)
E0 = max(max(p[0] for p in A._geom_polys(c["geometry"])[0][0]) for c in cells)
S0 = min(min(p[1] for p in A._geom_polys(c["geometry"])[0][0]) for c in cells)
N0 = max(max(p[1] for p in A._geom_polys(c["geometry"])[0][0]) for c in cells)
seams_x = sorted({round(x, 6) for x in (-70.725, -70.65)})
seam_y = 43.05
grid = [real["edges"][i] for i in range(len(real["edges"]))
        if (abs(real["edges"][i][0] - real["edges"][i][2]) < 1e-12 and round(real["edges"][i][0], 6) in seams_x
            and S0 + 1e-6 < min(real["edges"][i][1], real["edges"][i][3]) and max(real["edges"][i][1], real["edges"][i][3]) < N0 - 1e-6)]
rl = A._enc_leaves([-70.75, 43.0, -70.5, 43.25], [real if b == "enc_harbour" else A._cov_index([]) for b in A.ENC_BANDS])
# a square on a seam line, away from the coverage's own outer outline (its edges that are not on a seam) by > 1 square
outer = [e for e in real["edges"]]


def near_outline(r, d):
    for e in outer:
        if min(e[0], e[2]) - d <= r[2] and max(e[0], e[2]) + d >= r[0] and min(e[1], e[3]) - d <= r[3] and max(e[1], e[3]) + d >= r[1]:
            return True
    return False


def in_union(r):
    px, py = r[0] + (r[2] - r[0]) * 0.5000137, r[1] + (r[3] - r[1]) * 0.4999263
    return any(A._pip_rings(px, py, A._geom_polys(c["geometry"])[0]) for c in cells)


# squares across a seam, inside the union, not touching its outline (squares outside the cells - east of them, here,
# where no other chart was given - are rightly unread and are not the question)
on_seams = [lf for lf in rl if (any(lf[0][0] < x < lf[0][2] for x in seams_x) or lf[0][1] < seam_y < lf[0][3])
            and not near_outline(lf[0], 1e-9) and in_union(lf[0])]
bad = [lf for lf in on_seams if lf[1] != (A.ENC_BANDS.index("enc_harbour"),)]
# and the union itself: no boundary edge lies along a seam line - every one the cells share canceled, though the
# cells split those lines at different vertices (cell BE and CE share 43.05 with different vertex runs)
seam_edges = [e for e in real["edges"]
              if (abs(e[0] - e[2]) < 1e-12 and any(abs(e[0] - x) < 1e-9 for x in seams_x))
              or (abs(e[1] - e[3]) < 1e-12 and abs(e[1] - seam_y) < 1e-9)]
check("4b. HIS PORTSMOUTH HARBOUR (six real cells): no boundary edge is left along the lines they share (-70.725, -70.65, "
      "43.05) - every shared edge canceled - and every square across those seams, inside the union and off its outline, "
      "is plain harbour: no strip where the cells meet",
      lambda: not seam_edges and on_seams and not bad,
      lambda: "union edges %d, on the seam lines %d; seam squares inside the union %d, not plain harbour %d"
              % (len(real["edges"]), len(seam_edges), len(on_seams), len(bad)))

# ── 5. cutting ────────────────────────────────────────────────────────────────────────────────────────────────────
random.seed(7)


def star(cx, cy, n, r0, r1):
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        r = random.uniform(r0, r1)
        pts.append([cx + r * math.cos(a), cy + r * math.sin(a)])
    return pts + [pts[0]]


quads = [(0, 0, 0.5, 0.5), (0.5, 0, 1, 0.5), (0, 0.5, 0.5, 1), (0.5, 0.5, 1, 1)]
ok_area, worst = True, 0.0
for k in range(40):
    outer_r = star(0.5, 0.5, 23, 0.15, 0.48)
    hole = star(0.5, 0.5, 9, 0.03, 0.1)[::-1]
    poly = {"role": "land", "cls": "Land_Area", "props": {}, "geometry": {"type": "Polygon", "coordinates": [outer_r, hole]}}
    pieces = A._clip_feature(poly, quads)
    tot = sum(geom_area(p["geometry"]) for p in pieces)
    want = geom_area(poly["geometry"])
    err = abs(tot - want) / want
    worst = max(worst, err)
    if err > 1e-9 or not all("clip" in p for p in pieces):
        ok_area = False
line = {"role": "shore_line", "cls": "Coastline_line", "props": {}, "geometry": {"type": "LineString", "coordinates": [[0.1, 0.1], [0.9, 0.3], [0.2, 0.8], [0.8, 0.95]]}}
lp = A._clip_feature(line, quads)


def length(g):
    ls = [g["coordinates"]] if g["type"] == "LineString" else g["coordinates"]
    return sum(math.hypot(l[i + 1][0] - l[i][0], l[i + 1][1] - l[i][1]) for l in ls for i in range(len(l) - 1))


pts = {"role": "sounding", "cls": "Sounding_point", "props": {}, "geometry": {"type": "MultiPoint", "coordinates": [[0.25, 0.25], [0.5, 0.5], [0.75, 0.1], [0.5, 0.9]]}}
pp = A._clip_feature(pts, quads)
small = {"role": "land", "cls": "Land_Area", "props": {}, "geometry": {"type": "Polygon", "coordinates": [sq(0.1, 0.1, 0.2, 0.2)]}}
sp = A._clip_feature(small, quads)
check("5. CUTTING: 40 random polygons with holes, cut over four squares that tile them, add up to their own area (worst "
      "%.1e); a line's pieces to its length; points each kept once; a feature inside one square kept WHOLE, no `clip`" % worst,
      lambda: ok_area and abs(sum(length(p["geometry"]) for p in lp) - length(line["geometry"])) < 1e-12
              and sum(len(p["geometry"]["coordinates"]) for p in pp) == 4 and len(sp) == 1 and sp[0] is small and "clip" not in sp[0],
      lambda: "areas %s, line %.12f vs %.12f, points %d, small %d" % (ok_area, sum(length(p["geometry"]) for p in lp),
                                                                     length(line["geometry"]), sum(len(p["geometry"]["coordinates"]) for p in pp), len(sp)))

# ── 6. the tile, the service stubbed ──────────────────────────────────────────────────────────────────────────────
calls = {"cov": 0, "feat": 0}
FEATS = {
    # harbour: a pier in the harbour, and a depth area that two tiles both fetch (same object id)
    "enc_harbour": [
        {"role": "dock", "cls": "Shoreline_Construction_area", "props": {}, "oid": 11,
         "geometry": {"type": "Polygon", "coordinates": [sq(-70.66, 43.10, -70.659, 43.101)]}},
        {"role": "depth_area", "cls": "Depth_Area", "props": {"DRVAL1": 1.0, "DRVAL2": 3.0}, "oid": 12,
         "geometry": {"type": "Polygon", "coordinates": [sq(-70.69, 43.06, -70.56, 43.19)]}},
        # the harbour's whole union - over its interior squares AND the strip along its edge: cut, it would come apart
        {"role": "depth_area", "cls": "Depth_Area", "props": {"DRVAL1": 6.0, "DRVAL2": 9.0}, "oid": 13,
         "geometry": {"type": "Polygon", "coordinates": [sq(-70.70, 43.05, -70.55, 43.20)]}},
    ],
    # coastal: a land mass across the whole tile's middle - inside the harbour's coverage it must be cut away
    "enc_coastal": [
        {"role": "land", "cls": "Land_Area", "props": {}, "oid": 21,
         "geometry": {"type": "Polygon", "coordinates": [sq(-70.74, 43.11, -70.51, 43.14)]}},
    ],
}
FAIL_LAYER = {"on": False}


def fake_cov(band, t):
    calls["cov"] += 1
    if FAIL_LAYER.get("cov"):
        raise OSError("connection refused")
    if t == [-70.75, 43.0, -70.5, 43.25]:
        return COV[band]
    if band == "enc_harbour" and t == [-71.0, 43.0, -70.75, 43.25]:
        return [[sq(-70.80, 43.05, -70.76, 43.20)]]          # a harbour cell in the west tile: it fetches the harbour too
    return [[coast]] if band == "enc_coastal" else []


def fake_feat(region, md=0.0, band=None, extras=True, use_cache=True):
    calls["feat"] += 1
    out = [dict(f) for f in FEATS.get(band, [])]
    return {"band": band, "features": out, "partial": ["Depth_Area"] if FAIL_LAYER["on"] and band == "enc_harbour" else []}


sav = (A._enc_coverage, A.fetch_enc_features, A._clip_feature)
# WHICH CHARTS REACH THE CUTTER, recorded: the harbour chart must never be one of them. (A synthetic harbour whose
# coverage is a rectangle merges back into ONE rectangle, and cutting a feature inside it changes nothing - so the
# outcome alone could not tell; his real coverage is not a rectangle, and there the harbour chart WOULD come apart.)
cut_bands = []
_real_clip = A._clip_feature
A._clip_feature = lambda ft, rects: (cut_bands.append(ft.get("band")), _real_clip(ft, rects))[1]
A._enc_coverage, A.fetch_enc_features = fake_cov, fake_feat
try:
    A._enc_tile_mem.clear()
    A._enc_down_until = 0.0
    box = [-70.75, 43.0, -70.5, 43.25]
    d = A.fetch_enc_layered(box, 2.0)
    harb = [f for f in d["features"] if f["band"] == "enc_harbour"]
    land = [f for f in d["features"] if f["band"] == "enc_coastal"]
    # where the coastal land stands: never inside the harbour's coverage away from its edge
    land_inside = [f for f in land if "clip" in f and in_harbour_interior(f["clip"], 1e-12)]
    land_out = [f for f in land if "clip" in f and (f["clip"][2] <= -70.70 + 1e-12 or f["clip"][0] >= -70.55 - 1e-12)]
    land_area = sum(geom_area(f["geometry"]) for f in land)
    full_land = 0.23 * 0.03
    harbour_part = 0.15 * 0.03
    tile_file = A._tile_path(box)
    check("6. THE TILE: the harbour chart WHOLE (no `clip`), the coastal land CUT AWAY inside the harbour's coverage - "
          "kept outside it and in the one-square strip along its edge (area %.5f of %.5f, the harbour's part %.5f) - the "
          "unread strip reported, the depth floor tagged (DRVAL1 1 m < 2 m shallow), and the complete tile cached"
          % (land_area, full_land, harbour_part),
          lambda: len(harb) == 3 and not any("clip" in f for f in harb) and "enc_harbour" not in cut_bands
                  and "enc_coastal" in cut_bands
                  and [f for f in harb if f.get("oid") == 13][0]["geometry"] == FEATS["enc_harbour"][2]["geometry"]
                  and land and not land_inside and land_out
                  and full_land - harbour_part - 1e-9 <= land_area < full_land - harbour_part + 4 * 0.03 * LEAF
                  and d["unread"] and all(r[1] >= 43.24 - LEAF - 1e-12 for r in d["unread"]) and d["band"] == "enc_harbour"
                  and [f for f in harb if f.get("oid") == 12][0]["shallow"] is True and d.get("complete")
                  and os.path.exists(tile_file),
          lambda: "harbour %d, coastal pieces %d (inside %d, outside %d), unread %d, band %s, complete %s, cached %s"
                  % (len(harb), len(land), len(land_inside), len(land_out), len(d["unread"]), d["band"], d.get("complete"),
                     os.path.exists(tile_file)))
    # the same tile read again at another floor: from memory, the cached tile's tag untouched
    n0 = dict(calls)
    d2 = A.fetch_enc_layered(box, 0.5)
    A._enc_tile_mem.clear()
    d3 = A.fetch_enc_layered(box, 0.5)
    cached = A._read_tile_jsonl(tile_file)
    mem = [f for t in A._enc_tile_mem.values() for f in t.get("features", [])]
    check("6a. read again it comes from memory, then from the disk, with NO service call - and the floor is per request: "
          "at 0.5 m the same depth area is not shallow, and neither the cached tile on disk nor the one held in memory "
          "carries a tag at all (a tag left there would be the last request's, read by the next)",
          lambda: calls == n0 and [f for f in d2["features"] if f.get("oid") == 12][0]["shallow"] is False
                  and len(d3["features"]) == len(d["features"])
                  and not any("shallow" in f for f in cached["features"]) and mem and not any("shallow" in f for f in mem),
          lambda: "calls %s -> %s" % (n0, calls))
    # two tiles both fetch the harbour depth area (oid 12): kept once
    two = A.fetch_enc_layered([-70.80, 43.05, -70.60, 43.20], 2.0)
    n12 = sum(1 for f in two["features"] if f.get("oid") == 12 and f["band"] == "enc_harbour")
    both_fetched = calls["feat"] - n0["feat"]
    check("6b. a feature two tiles both fetched (each has a harbour cell) is kept ONCE (band, class, object id)",
          lambda: two["tiles"] == 2 and both_fetched >= 1 and n12 == 1,
          lambda: "tiles %d, harbour fetches since %d, the depth area %d time(s)" % (two["tiles"], both_fetched, n12))
    # a failed layer: served, not cached
    A._enc_tile_mem.clear()
    os.remove(tile_file)
    FAIL_LAYER["on"] = True
    p = A.fetch_enc_layered(box, 2.0)
    FAIL_LAYER["on"] = False
    # a coverage that cannot be read: the tile is UNREAD (failed), the breaker set
    A._enc_tile_mem.clear()
    FAIL_LAYER["cov"] = True
    q = A.fetch_enc_layered([-71.20, 43.05, -71.05, 43.20], 2.0)          # a tile no check above has read
    breaker = A._enc_down_until > 0
    FAIL_LAYER["cov"] = False
    A._enc_down_until = 0.0
    check("6c. A TILE WITH A FAILED LAYER is served once and NOT cached (`partial` says which); A COVERAGE THAT CANNOT "
          "BE READ leaves the tile UNREAD - `unread_failed` over the box, no band, the offline breaker set - never "
          "served as empty water",
          lambda: p["partial"] == ["Depth_Area"] and not p.get("complete") and not os.path.exists(tile_file)
                  and q["band"] is None and q["unread_failed"] == [[-71.20, 43.05, -71.05, 43.20]] and q["features"] == []
                  and breaker and "coverage could not be read" in (q.get("note") or ""),
          lambda: "partial %s complete %s cached %s; failed tile band %s unread_failed %s note %r breaker %s"
                  % (p["partial"], p.get("complete"), os.path.exists(tile_file), q["band"], q["unread_failed"], q.get("note"), breaker))
finally:
    A._enc_coverage, A.fetch_enc_features, A._clip_feature = sav
    A._enc_tile_mem.clear()
    A._enc_down_until = 0.0

# ── 7. the endpoint ───────────────────────────────────────────────────────────────────────────────────────────────
import inspect                                                # noqa: E402
src = inspect.getsource(A.Handler._serve_enc) if hasattr(A, "Handler") and hasattr(A.Handler, "_serve_enc") else \
    next((inspect.getsource(getattr(c, "_serve_enc")) for c in vars(A).values() if isinstance(c, type) and hasattr(c, "_serve_enc")), "")
check("7. /api/enc serves the LAYERED read (and the span refusal stands in front of it)",
      lambda: "fetch_enc_layered(bbox, min_depth)" in src and "fetch_enc_features(bbox, min_depth)" not in src
              and src.index("ENC_MAX_SPAN_DEG") < src.index("fetch_enc_layered"),
      lambda: "found _serve_enc: %s" % bool(src))

after = set(os.listdir(APP_ENC)) if os.path.isdir(APP_ENC) else set()
shutil.rmtree(TMP, ignore_errors=True)
check("8. nothing here wrote to the app's own chart cache (everything went to a temp folder)",
      lambda: after == before, lambda: "new files %s" % sorted(after - before)[:5])

print("\n" + ("%d CHECK(S) FAILED (%d ran)" % (fails, ran) if fails else "all checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
