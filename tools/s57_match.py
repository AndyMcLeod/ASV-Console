"""s57_match.py - does a NOAA cell, read by s57.py, say what ENCDirect said? (S-57 chart source, phase 1, 2026-11-21)

Compares one of the console's cached ENCDirect extracts (charts/enc/features_v5_<bbox>.json, READ ONLY) with the
same band's cells, read from NOAA's own files and put in ENCDirect's shape (s57.encdirect_features). For each layer:
how many features each side has in the box, how many pair one to one, whether the paired geometry is the same, and
whether the properties the console keeps (asv_console._enc_keep_props, the very function an ENCDirect answer goes
through) are the same.

THE CELLS AS THEY STOOD THAT DAY. NOAA corrects its cells week by week, and an extract is what ENCDirect served on the
day it was read. So each cell is read with the updates issued on or before the extract's date (its file time, or
--asof), and the updates withheld are named - a difference the next update explains is not the reader's.

    python tools/s57_match.py <features_v5_...json> [more ...] [--fetch] [--asof YYYYMMDD] [--json out.json]

--fetch downloads what is missing into charts/s57/ (git-ignored): NOAA's Chart Locator index of cell footprints
(charts.noaa.gov/InteractiveCatalog/data/enc.geojson) and each cell's zip (charts.noaa.gov/ENCs/<CELL>.zip). NOAA's
cells are never committed (its user agreement discourages re-hosting them).
"""
import argparse
import collections
import json
import math
import os
import re
import sys
import time
import urllib.request

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)
import s57                      # noqa: E402

S57_DIR = os.path.join(APP, "charts", "s57")
INDEX_URL = "https://www.charts.noaa.gov/InteractiveCatalog/data/enc.geojson"
CELL_URL = "https://charts.noaa.gov/ENCs/%s.zip"
BAND_NUM = {"enc_overview": 1, "enc_general": 2, "enc_coastal": 3, "enc_approach": 4, "enc_harbour": 5, "enc_berthing": 6}
LAYERS = json.load(open(os.path.join(APP, "tests", "fixtures", "enc_layer_maps.json"), encoding="utf-8"))["bands"]
GEOM_TOL = 2e-6                 # degrees: 0.2 m - ENCDirect's coordinates carry float noise past the 1e-7 of a cell
Z_TOL = 1e-3
# ENCDirect's own box test is not this one to the meter: a bridge 2.5 m west of the box came back at Salem, a sounding
# 1.5 m inside it did not at Honolulu. A feature left over within EDGE of the box's edge is counted apart, as the box's.
EDGE = 1e-4                     # degrees: ~11 m north-south


def _keep():
    """asv_console's own _enc_keep_props (imported late: the console is big, and the import is the comparison's point)."""
    import asv_console
    return asv_console._enc_keep_props


# ── the box ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def _pts(c):
    if isinstance(c[0], (int, float)):
        yield c
    else:
        for k in c:
            yield from _pts(k)


def _seg_hits_box(a, b, box):
    """Liang-Barsky: does segment a-b reach into the box?"""
    x0, y0, x1, y1 = box
    t0, t1 = 0.0, 1.0
    dx, dy = b[0] - a[0], b[1] - a[1]
    for p, q in ((-dx, a[0] - x0), (dx, x1 - a[0]), (-dy, a[1] - y0), (dy, y1 - a[1])):
        if p == 0:
            if q < 0:
                return False
        else:
            t = q / p
            if p < 0:
                t0 = max(t0, t)
            else:
                t1 = min(t1, t)
            if t0 > t1:
                return False
    return True


def _in_ring(ring, x, y):
    inside = False
    for i in range(len(ring) - 1):
        (xa, ya), (xb, yb) = ring[i][:2], ring[i + 1][:2]
        if (ya > y) != (yb > y) and x < (xb - xa) * (y - ya) / (yb - ya) + xa:
            inside = not inside
    return inside


def hits_box(g, box):
    """The geometry reaches into the box (ENCDirect's query: esriSpatialRelIntersects with an envelope)."""
    t, c = g["type"], g["coordinates"]
    if t == "Point":
        return box[0] <= c[0] <= box[2] and box[1] <= c[1] <= box[3]
    if t == "MultiPoint":
        return any(hits_box({"type": "Point", "coordinates": p}, box) for p in c)
    lines = [c] if t == "LineString" else c if t == "MultiLineString" else \
        c if t == "Polygon" else [r for poly in c for r in poly]
    for ln in lines:
        if any(box[0] <= p[0] <= box[2] and box[1] <= p[1] <= box[3] for p in ln):
            return True
        if any(_seg_hits_box(ln[i], ln[i + 1], box) for i in range(len(ln) - 1)):
            return True
    if t in ("Polygon", "MultiPolygon"):
        polys = [c] if t == "Polygon" else c
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        return any(_in_ring(p[0], cx, cy) and not any(_in_ring(h, cx, cy) for h in p[1:]) for p in polys)
    return False


# ── pairing ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def _key(g):
    """Orientation- and start-free: the set of vertices at 1e-5 degree."""
    return (g["type"], frozenset((round(p[0], 5), round(p[1], 5)) for p in _pts(g["coordinates"])))


def _center(g):
    p = list(_pts(g["coordinates"]))
    return ((min(q[0] for q in p) + max(q[0] for q in p)) / 2, (min(q[1] for q in p) + max(q[1] for q in p)) / 2)


def _nverts(g):
    return sum(1 for _ in _pts(g["coordinates"]))


def _rings(g):
    t, c = g["type"], g["coordinates"]
    if t == "Polygon":
        return [c]
    if t == "MultiPolygon":
        return c
    return None


def _signed_area(r):
    return sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1)) / 2.0


def _same_seq(a, b, closed):
    """Vertex sequences equal within GEOM_TOL, allowing for a ring that starts elsewhere or runs the other way."""
    if len(a) != len(b):
        return False
    def eq(p, q):
        return abs(p[0] - q[0]) <= GEOM_TOL and abs(p[1] - q[1]) <= GEOM_TOL
    cands = [b, b[::-1]]
    if closed and len(a) > 1:
        cands = []
        bb = b[:-1]
        for seq in (bb, bb[::-1]):
            for i in range(len(seq)):
                if eq(seq[i], a[0]):
                    r = seq[i:] + seq[:i]
                    cands.append(r + [r[0]])
    return any(all(eq(p, q) for p, q in zip(a, c)) for c in cands)


def same_geometry(g1, g2):
    """(same, how) - how is "identical", "reordered" (same rings, other start or direction) or what differs."""
    if g1["type"] != g2["type"]:
        return False, "type %s vs %s" % (g1["type"], g2["type"])
    t = g1["type"]
    if t == "Point":
        a, b = g1["coordinates"], g2["coordinates"]
        if abs(a[0] - b[0]) > GEOM_TOL or abs(a[1] - b[1]) > GEOM_TOL:
            return False, "moved"
        if len(a) > 2 or len(b) > 2:
            if len(a) != len(b) or abs(a[2] - b[2]) > Z_TOL:
                return False, "depth %s vs %s" % (a[2:] or None, b[2:] or None)
        return True, "identical"
    if t in ("LineString", "MultiLineString"):
        A = [g1["coordinates"]] if t == "LineString" else g1["coordinates"]
        B = [g2["coordinates"]] if t == "LineString" else g2["coordinates"]
        if len(A) != len(B):
            return False, "%d parts vs %d" % (len(A), len(B))
        exact = all(len(a) == len(b) and all(abs(p[0] - q[0]) <= GEOM_TOL and abs(p[1] - q[1]) <= GEOM_TOL
                                             for p, q in zip(a, b)) for a, b in zip(A, B))
        if exact:
            return True, "identical"
        left = list(B)
        for a in A:
            m = next((b for b in left if _same_seq(a, b, False)), None)
            if m is None:
                return False, "vertices differ"
            left.remove(m)
        return True, "line runs the other way"
    R1, R2 = _rings(g1), _rings(g2)
    if len(R1) != len(R2):
        return False, "%d polygons vs %d" % (len(R1), len(R2))
    exact = True
    for p1, p2 in zip(R1, R2):
        if len(p1) != len(p2) or any(len(a) != len(b) or any(abs(x[0] - y[0]) > GEOM_TOL or abs(x[1] - y[1]) > GEOM_TOL
                                                            for x, y in zip(a, b)) for a, b in zip(p1, p2)):
            exact = False
            break
    if exact:
        return True, "identical"
    left = [list(p) for p in R2]
    for p1 in R1:
        hit = None
        for p2 in left:
            if len(p1) == len(p2) and _same_seq(p1[0], p2[0], True):
                holes = list(p2[1:])
                ok = True
                for h in p1[1:]:
                    m = next((x for x in holes if _same_seq(h, x, True)), None)
                    if m is None:
                        ok = False
                        break
                    holes.remove(m)
                if ok:
                    hit = p2
                    break
        if hit is None:
            return False, "rings differ"
        left.remove(hit)
    return True, "ring starts at another vertex"


def _props_equal(a, b):
    if isinstance(a, float) or isinstance(b, float):
        try:
            return abs(float(a) - float(b)) <= 1e-6
        except (TypeError, ValueError):
            return False
    return a == b


# ── the cells ───────────────────────────────────────────────────────────────────────────────────────────────────────
def _get(url, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "ASV-Console/1.0"})
    with urllib.request.urlopen(req, timeout=120) as r:
        data = r.read()
    tmp = path + ".part"
    with open(tmp, "wb") as f:
        f.write(data)
    os.replace(tmp, path)
    return path


def _merc_inv(x, y):
    R = 6378137.0
    return math.degrees(x / R), math.degrees(2 * math.atan(math.exp(y / R)) - math.pi / 2)


def cells_for(band, box, fetch):
    """[(cell name, footprint bbox lon/lat)] of the band reaching into the box, from NOAA's Chart Locator index."""
    idx = os.path.join(S57_DIR, "enc.geojson")
    if not os.path.exists(idx):
        if not fetch:
            raise SystemExit("no Chart Locator index at %s - run with --fetch" % idx)
        _get(INDEX_URL, idx)
    with open(idx, encoding="utf-8") as f:
        d = json.load(f)
    out = []
    for ft in d["features"]:
        p = ft["properties"]
        if int(p.get("scale_band") or 0) != BAND_NUM[band]:
            continue
        pts = [_merc_inv(*q[:2]) for q in _pts(ft["geometry"]["coordinates"])]
        e = (min(q[0] for q in pts), min(q[1] for q in pts), max(q[0] for q in pts), max(q[1] for q in pts))
        if e[2] < box[0] or e[0] > box[2] or e[3] < box[1] or e[1] > box[3]:
            continue
        out.append((p["enc_ed_up"].split("_")[0], e))
    return sorted(out)


def cell_zip(name, fetch):
    path = os.path.join(S57_DIR, "cells", name + ".zip")
    if not os.path.exists(path):
        if not fetch:
            raise SystemExit("no cell %s at %s - run with --fetch" % (name, path))
        _get(CELL_URL % name, path)
    return path


# ── one extract ─────────────────────────────────────────────────────────────────────────────────────────────────────
def _grow(box, d):
    return (box[0] - d, box[1] - d, box[2] + d, box[3] + d)


def _at_edge(g, box):
    """Within EDGE of the box's edge: reaches into the box grown by EDGE, not into it shrunk by EDGE."""
    return hits_box(g, _grow(box, EDGE)) and not hits_box(g, _grow(box, -EDGE))


_extracts = {}


def _load(cache_path):
    if cache_path not in _extracts:
        with open(cache_path, encoding="utf-8") as f:
            _extracts[cache_path] = json.load(f)
    return _extracts[cache_path]


def match(cache_path, fetch=False, asof=None, wording=None, keep_pairs=False):
    m = re.search(r"features_v5_(?:(enc_[a-z]+)_(?:named_)?)?(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)\.json$",
                  os.path.basename(cache_path))
    if not m:
        raise SystemExit("not a features_v5 extract: %s" % cache_path)
    box = tuple(float(v) for v in m.groups()[1:])
    theirs_all = _load(cache_path)
    band = theirs_all.get("band") or m.group(1)
    if band not in LAYERS:
        raise SystemExit("%s: band %r" % (cache_path, band))
    day = asof or time.strftime("%Y%m%d", time.localtime(os.path.getmtime(cache_path)))
    keep = _keep()
    rep = {"extract": os.path.basename(cache_path), "band": band, "box": box, "asof": day, "cells": [],
           "classes": {}, "props": collections.Counter(), "geometry": collections.Counter(),
           "orientation": collections.Counter(), "not_served": collections.Counter(), "problems": [],
           "off_by_cell": collections.Counter()}
    mine = collections.defaultdict(list)
    footprints = cells_for(band, box, fetch)
    for name, _e in footprints:
        cell = s57.read_zip(cell_zip(name, fetch), issued_by=day)
        # A cell RE-ISSUED after the extract's day is a newer edition than ENCDirect served: NOAA publishes only the
        # current one, so a difference inside it is the chart's change, and is counted to it.
        base_day = (cell.dsid.get("ISDT") or "").strip()
        rep["cells"].append({"cell": name, "edition": cell.dsid.get("EDTN"), "base_issued": base_day,
                             "applied": cell.updates_applied, "withheld": cell.updates_withheld,
                             "newer_edition": bool(base_day and base_day > day)})
        rep["problems"] += ["%s: %s" % (name, p) for p in cell.problems]
        feats, left = s57.encdirect_features(cell, LAYERS[band], s57.ENCDIRECT_WORDING if wording is None else wording,
                                             raw=keep_pairs)
        for k, n in left.items():
            rep["not_served"]["%s/%s" % (k[0], {1: "point", 2: "line", 3: "area"}.get(k[1], k[1]))] += n
        for ft in feats:
            if hits_box(ft["geometry"], box):
                mine[ft["cls"]].append({"props": keep(ft["properties"]), "geometry": ft["geometry"],
                                        "s57": ft.get("s57"), "acronym": ft.get("acronym"), "cell": name})
    theirs = collections.defaultdict(list)
    for ft in theirs_all["features"]:
        if ft.get("geometry"):
            theirs[ft["cls"]].append(ft)
    # AN EXTRACT HOLDS WHAT THE CONSOLE KEPT THE DAY IT WAS READ: WATLEV, CATSLC and the rest were kept from 2026-10-12,
    # CATMOR from 2026-11-01. A kept property found nowhere in the whole extract was not kept then, and is not compared.
    known = {k for ft in theirs_all["features"] for k in (ft.get("props") or {})}
    rep["not_kept_then"] = collections.Counter()
    for cls in sorted(set(mine) | set(theirs)):
        A, B = mine.get(cls, []), theirs.get(cls, [])
        byk = collections.defaultdict(list)
        for i, b in enumerate(B):
            byk[_key(b["geometry"])].append(i)
        used, pairs, lone = set(), [], []
        for a in A:
            cand = [i for i in byk.get(_key(a["geometry"]), []) if i not in used]
            # several of one class at one place (a cluster of soundings, two lights on one structure): the one whose
            # kept properties agree
            pick = next((i for i in cand if B[i]["props"] == a["props"]), cand[0] if cand else None)
            if pick is None:
                lone.append(a)
                continue
            used.add(pick)
            pairs.append((a, B[pick]))
        # The key rounds at 1e-5 degree, and a vertex on a rounding edge falls either side of it with ENCDirect's float
        # noise. What is left pairs by place: the nearest unpaired feature with as many vertices, within 1e-4 degree.
        if lone:
            rest = [i for i in range(len(B)) if i not in used]
            cen = {i: _center(B[i]["geometry"]) for i in rest}
            still = []
            for a in lone:
                ca, na = _center(a["geometry"]), _nverts(a["geometry"])
                best = None
                for i in rest:
                    if i in used or _nverts(B[i]["geometry"]) != na:
                        continue
                    d = max(abs(ca[0] - cen[i][0]), abs(ca[1] - cen[i][1]))
                    if d <= 1e-4 and (best is None or d < best[0] or d == best[0] and B[i]["props"] == a["props"]):
                        best = (d, i)
                if best is None:
                    still.append(a)
                else:
                    used.add(best[1])
                    pairs.append((a, B[best[1]]))
            lone = still
        if keep_pairs:
            rep.setdefault("pairs", []).extend((cls, a, b) for a, b in pairs)
        b_lone = [B[i] for i in range(len(B)) if i not in used]
        row = {"cells": len(A), "encdirect": len(B), "paired": len(pairs), "cells_only": len(lone),
               "encdirect_only": len(b_lone), "geometry_differs": 0,
               "cells_only_edge": sum(1 for a in lone if _at_edge(a["geometry"], box)),
               "encdirect_only_edge": sum(1 for b in b_lone if _at_edge(b["geometry"], box))}
        for a, b in pairs:
            ok, how = same_geometry(a["geometry"], b["geometry"])
            rep["geometry"][how] += 1
            if not ok:
                row["geometry_differs"] += 1
            ra, rb = _rings(a["geometry"]), _rings(b["geometry"])
            if ra and rb and len(ra) == len(rb):
                for pa, pb in zip(ra, rb):
                    rep["orientation"]["same" if (_signed_area(pa[0]) > 0) == (_signed_area(pb[0]) > 0)
                                       else "opposite"] += 1
            for k in sorted(set(a["props"]) | set(b["props"])):
                va, vb = a["props"].get(k), b["props"].get(k)
                if va is None and vb is None:
                    continue
                if k not in known:
                    rep["not_kept_then"][k] += 1
                    continue
                if not _props_equal(va, vb):
                    rep["props"][(cls, k, repr(va), repr(vb))] += 1
                else:
                    rep["props"][("=", k)] += 1
        for g in [a["geometry"] for a in lone] + [b["geometry"] for b in b_lone]:
            if _at_edge(g, box):
                continue
            c = _center(g)
            inside = [n for n, e in footprints if e[0] <= c[0] <= e[2] and e[1] <= c[1] <= e[3]]
            rep["off_by_cell"][inside[0] if len(inside) == 1 else "+".join(inside) or "(no cell)"] += 1
        row["unpaired_samples"] = {"cells": [_brief(a) for a in lone if not _at_edge(a["geometry"], box)][:3],
                                   "encdirect": [_brief(b) for b in b_lone if not _at_edge(b["geometry"], box)][:3]}
        rep["classes"][cls] = row
    return rep


def _brief(ft):
    g = ft["geometry"]
    p = list(_pts(g["coordinates"]))
    return {"type": g["type"], "n": len(p), "first": [round(v, 6) for v in p[0]], "props": ft.get("props")}


def totals(rep):
    tot = collections.Counter()
    for r in rep["classes"].values():
        for k in ("cells", "encdirect", "paired", "cells_only", "encdirect_only", "geometry_differs",
                  "cells_only_edge", "encdirect_only_edge"):
            tot[k] += r[k]
    tot["off"] = (tot["cells_only"] - tot["cells_only_edge"] + tot["encdirect_only"] - tot["encdirect_only_edge"]
                  + tot["geometry_differs"])
    return tot


def update_dates(cache_path, fetch=False, window_days=60):
    """The issue dates of the box's cells' updates within window_days of the extract's date - the days on which what
    ENCDirect served could have changed."""
    import datetime
    import zipfile
    rep_day = time.strftime("%Y%m%d", time.localtime(os.path.getmtime(cache_path)))
    d0 = datetime.datetime.strptime(rep_day, "%Y%m%d")
    m = re.search(r"(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)_(-?[\d.]+)\.json$", cache_path)
    box = tuple(float(v) for v in m.groups())
    band = _load(cache_path).get("band")
    days = {rep_day}
    for name, _e in cells_for(band, box, fetch):
        with zipfile.ZipFile(cell_zip(name, fetch)) as z:
            for n in z.namelist():
                if re.search(r"\.(\d{3})$", n) and not n.endswith(".000") and "CATALOG" not in n:
                    isdt = s57._issue_date(z.read(n))
                    try:
                        d = datetime.datetime.strptime(isdt, "%Y%m%d")
                    except ValueError:
                        continue
                    if abs((d - d0).days) <= window_days:
                        days.add(isdt)
                        days.add((d - datetime.timedelta(days=1)).strftime("%Y%m%d"))
    return sorted(days)


def summarize(rep, out=print):
    out("=" * 100)
    out("%s   band %s   as of %s" % (rep["extract"], rep["band"], rep["asof"]))
    for c in rep["cells"]:
        out("  cell %s ed %s base %s  updates applied %s%s%s" % (
            c["cell"], c["edition"], c["base_issued"], c["applied"] or "none",
            ("  WITHHELD (issued after) %s" % c["withheld"]) if c["withheld"] else "",
            "  NEWER EDITION (re-issued after the extract's day)" if c["newer_edition"] else ""))
    tot = totals(rep)
    out("  features: cells %(cells)d  encdirect %(encdirect)d  paired %(paired)d  cells-only %(cells_only)d "
        "(%(cells_only_edge)d at the box's edge)  encdirect-only %(encdirect_only)d (%(encdirect_only_edge)d at the "
        "edge)  paired-but-geometry-differs %(geometry_differs)d" % tot)
    out("  geometry of the pairs: %s   polygon orientation: %s" % (dict(rep["geometry"]), dict(rep["orientation"])))
    if rep["off_by_cell"]:
        newer = {c["cell"] for c in rep["cells"] if c["newer_edition"]}
        out("  left over (not at the edge), by the cell it lies in: %s" % ", ".join(
            "%s %d%s" % (k, n, " (NEWER EDITION)" if k in newer else "") for k, n in rep["off_by_cell"].most_common()))
    for cls, r in rep["classes"].items():
        if r["cells_only"] - r["cells_only_edge"] or r["encdirect_only"] - r["encdirect_only_edge"] or \
                r["geometry_differs"]:
            out("  %-40s cells %5d encdirect %5d paired %5d | cells-only %d encdirect-only %d geom-differs %d"
                "  (edge %d/%d)" % (cls, r["cells"], r["encdirect"], r["paired"], r["cells_only"], r["encdirect_only"],
                                    r["geometry_differs"], r["cells_only_edge"], r["encdirect_only_edge"]))
            for side in ("cells", "encdirect"):
                for s in r["unpaired_samples"][side][:2]:
                    out("        %s-only: %s" % (side, json.dumps(s)[:220]))
    same = collections.Counter()
    diff = []
    for k, n in rep["props"].items():
        if k[0] == "=":
            same[k[1]] += n
        else:
            diff.append((k, n))
    out("  kept properties equal: %s" % dict(sorted(same.items())))
    for (cls, k, va, vb), n in sorted(diff, key=lambda x: (-x[1], x[0]))[:40]:
        out("    DIFFER %4d  %-34s %-8s cells %s   encdirect %s" % (n, cls, k, va[:60], vb[:60]))
    if rep["not_kept_then"]:
        out("  not compared - kept by today's console, not when this extract was read: %s" % dict(rep["not_kept_then"]))
    if rep["not_served"]:
        out("  in the cells, no layer in this band (ENCDirect serves none either): %s" % dict(rep["not_served"]))
    if rep["problems"]:
        out("  READER PROBLEMS: %s" % rep["problems"][:10])


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("extracts", nargs="+")
    ap.add_argument("--fetch", action="store_true")
    ap.add_argument("--asof")
    ap.add_argument("--json")
    ap.add_argument("--scan", action="store_true",
                    help="also read the cells as of each correction's issue day within 60 days, and say which day "
                         "ENCDirect's answer fits best")
    a = ap.parse_args()
    reps = []
    for p in a.extracts:
        r = match(p, a.fetch, a.asof)
        summarize(r)
        if a.scan:
            fits = []
            for day in update_dates(p, a.fetch):
                fits.append((totals(match(p, a.fetch, day))["off"], day))
            best = min(fits, key=lambda x: (x[0], abs(int(x[1]) - int(r["asof"]))))
            r["scan"] = {"fits": fits, "best": best}
            print("  CORRECTION DAYS: features off (not at the edge) by the day the cells are read as of: %s"
                  % ", ".join("%s %d" % (d, n) for n, d in fits))
            print("  fits best as of %s (%d off; %d as of the extract's own day)"
                  % (best[1], best[0], totals(r)["off"]))
        reps.append(r)
    if a.json:
        def ser(r):
            r = dict(r)
            r["props"] = [[list(k), n] for k, n in r["props"].items()]
            r.pop("pairs", None)
            for k in ("geometry", "orientation", "not_served", "not_kept_then", "off_by_cell"):
                r[k] = dict(r[k])
            return r
        with open(a.json, "w", encoding="utf-8") as f:
            json.dump([ser(r) for r in reps], f, indent=1)


if __name__ == "__main__":
    main()
