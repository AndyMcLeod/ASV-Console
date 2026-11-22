"""enc_cells.py - NOAA's S-57 chart cells as the console's chart source (2026-11-21, phase 2 of the S-57 source).

WHY. Andy, 2026-11-21: "go ahead with phase 2, adding the cells to the console as a chart source", and "the console
should show the pontoons and the other features ENCDirect never served". NOAA's ENCDirect service - the console's only
chart source until now - stopped answering that day; the cells it publishes, at charts.noaa.gov/ENCs, did not. Phase 1
(s57.py, tools/s57_match.py) showed a cell read here gives what ENCDirect served for the same water, feature for
feature, and more: ENCDirect never served pontoons at harbor scale, nor some pipelines, the virtual AIS marks and a few
boundaries, and it lagged NOAA's weekly updates by days to weeks.

WHAT IT ANSWERS: the two questions the console's layered chart read (asv_console._enc_tile_build) asks of a band - its
features reaching into a box, and its coverage (M_COVR) reaching into a tile - in ENCDirect's own shape, so a cell's
answer stands where ENCDirect's stood. The console names, keeps and classifies the features as it always has.

WHERE THE CELLS COME FROM. NOAA's Chart Locator catalog (CATALOG_URL, every current cell's footprint, usage band and
edition/update, "US5NH1BC_ED005_UP003") is kept at <root>/enc.geojson and read again after CATALOG_MAX_AGE_S; a cell is
kept as <root>/cells/<CELL>_ED<n>_UP<n>.zip and downloaded again when the catalog names a newer edition or update - the
zip holds the base cell and every update to date, applied in order (s57.read_zip). A CANCELLED CELL is not in the
catalog, so it is never read: ENCDirect still served two canceled cells (Lewes, Bellingham).

A CELL IS PARSED ONCE. Reading one takes 1.5-4 s and 10-50 MB (measured on a harbor, approach, coastal and general
cell), and a coarse cell lies under dozens of tiles, each built in a process of its own. So a cell's read - every class
in ENCDirect's shape, named later - is kept beside it as <root>/read/<CELL>_ED<n>_UP<n>.<reader>.jsonl, one feature a
line (read back as many small parses, as the console's tiles are), and read from there; `reader` hashes the reader's
own code and tables (reader_tag), so a changed reader reads every cell again.

WHAT FAILS, AND HOW. A cell that cannot be downloaded is read from the newest older copy kept, and named in `stale`
(the console then serves the read once and does not keep it); with no copy, the read FAILS (OSError) - never an empty
answer, because "this water has no chart" is a fact about the place and a failed download is not. A catalog that
cannot be refreshed is read from the copy kept (`catalog_stale`); with none, the read fails. After a failed request
the network is not asked again for DOWN_S, so an outage costs one timeout, not one per cell.
"""
import hashlib
import io
import json
import math
import os
import re
import threading
import time
import urllib.error
import urllib.request
import zipfile

import s57

CATALOG_URL = "https://www.charts.noaa.gov/InteractiveCatalog/data/enc.geojson"
CELL_URL = "https://charts.noaa.gov/ENCs/%s.zip"
BAND_OF_USAGE = {1: "enc_overview", 2: "enc_general", 3: "enc_coastal", 4: "enc_approach", 5: "enc_harbour",
                 6: "enc_berthing"}
CATALOG_MAX_AGE_S = 86400.0     # NOAA publishes corrections daily; the catalog says which cells have them
CATALOG_RETRY_S = 120.0         # a catalog that could not be refreshed is not asked for again for this long
DOWN_S = 30.0                   # after a request that failed, the network is not asked again for this long
FETCH_TIMEOUT_S = 60.0
MEMO_CELLS = 12                 # cells' reads held in one process (one is 5-30 MB: a tile reads each band's cells twice)
USER_AGENT = "ASV-Console/1.0"
_ED_UP = re.compile(r"^([A-Z0-9]{8})_ED(\d+)_UP(\d+)$")
_tag = None


def reader_tag():
    """This reader's answer, named: s57.py, its three catalog tables and this file, hashed. A cell's read kept by
    another reader is read again - so a change to the reader cannot leave an old read standing because no one bumped
    a number."""
    global _tag
    if _tag is None:
        h = hashlib.sha1()
        for p in [s57.__file__, __file__] + sorted(os.path.join(s57.TABLES, n) for n in os.listdir(s57.TABLES)
                                                    if n.endswith(".csv")):
            with open(p, "rb") as f:
                h.update(f.read())
        _tag = h.hexdigest()[:12]
    return _tag


def _merc_inv(x, y):
    """EPSG:3857 metres -> (lon, lat) degrees."""
    r = 6378137.0
    return math.degrees(x / r), math.degrees(2 * math.atan(math.exp(y / r)) - math.pi / 2)


def _pts(c):
    if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
        yield c
    elif isinstance(c, (list, tuple)):
        for k in c:
            yield from _pts(k)


def _bbox(g):
    xs, ys = [], []
    for p in _pts((g or {}).get("coordinates")):
        xs.append(p[0])
        ys.append(p[1])
    return (min(xs), min(ys), max(xs), max(ys)) if xs else None


def _seg_hits_box(a, b, box):
    """Liang-Barsky: does segment a-b reach into the box?"""
    x0, y0, x1, y1 = box
    t0, t1 = 0.0, 1.0
    dx, dy = b[0] - a[0], b[1] - a[1]
    for p, q in ((-dx, a[0] - x0), (dx, x1 - a[0]), (-dy, a[1] - y0), (dy, y1 - a[1])):
        if p == 0:
            if q < 0:
                return False
            continue
        r = q / p
        if p < 0:
            if r > t1:
                return False
            t0 = max(t0, r)
        else:
            if r < t0:
                return False
            t1 = min(t1, r)
    return t0 <= t1


def hits_box(g, box):
    """The geometry reaches into the box [W, S, E, N] - ENCDirect's query, an envelope intersected: a point inside, a
    line or ring crossing it, or a polygon the box lies inside (the center tested against its rings and holes)."""
    t, c = (g or {}).get("type"), (g or {}).get("coordinates")
    if not c:
        return False
    e = _bbox(g)
    if e is None or e[2] < box[0] or e[0] > box[2] or e[3] < box[1] or e[1] > box[3]:
        return False
    if t == "Point":
        return True
    if t == "MultiPoint":
        return any(box[0] <= p[0] <= box[2] and box[1] <= p[1] <= box[3] for p in c)
    if box[0] <= e[0] and e[2] <= box[2] and box[1] <= e[1] and e[3] <= box[3]:
        return True                                   # wholly inside the box
    lines = [c] if t == "LineString" else c if t in ("MultiLineString", "Polygon") else \
        [r for poly in c for r in poly] if t == "MultiPolygon" else []
    for ln in lines:
        if any(box[0] <= p[0] <= box[2] and box[1] <= p[1] <= box[3] for p in ln):
            return True
        if any(_seg_hits_box(ln[i], ln[i + 1], box) for i in range(len(ln) - 1)):
            return True
    if t in ("Polygon", "MultiPolygon"):
        polys = [c] if t == "Polygon" else c
        cx, cy = (box[0] + box[2]) / 2, (box[1] + box[3]) / 2
        return any(s57._in_ring(p[0], cx, cy) and not any(s57._in_ring(h, cx, cy) for h in p[1:]) for p in polys)
    return False


def _write(path, data):
    """`data` to `path` through a file of this process's own, then replaced - a reader never sees half a file. On
    Windows the replace fails while another process holds the old file open: then the old one stays (OSError)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = "%s.%d.%d.part" % (path, os.getpid(), threading.get_ident())
    with open(tmp, "wb") as f:
        f.write(data)
    try:
        os.replace(tmp, path)
    except OSError:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def _check_cell_zip(data, name):
    """The download is a zip holding the cell's base file - not an error page, not half a file."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            names = [n.replace("\\", "/").rsplit("/", 1)[-1].upper() for n in z.namelist()]
    except (zipfile.BadZipFile, ValueError) as e:
        raise ValueError("cell %s: not a whole zip (%s)" % (name, e))
    if name.upper() + ".000" not in names:
        raise ValueError("cell %s: the zip holds no %s.000" % (name, name))


class CellSource:
    """NOAA's cells under `root` (charts/s57). `ssl_context` - a context, or a function giving one - is the console's
    shared TLS context (one per process: asv_console._enc_ssl). `fetch(url) -> bytes` replaces the network (the suites);
    `now()` the clock the catalog's age is read by."""

    def __init__(self, root, ssl_context=None, fetch=None, now=None):
        self.root = root
        self.cells_dir = os.path.join(root, "cells")
        self.read_dir = os.path.join(root, "read")
        self._parse_locks = {}
        self._ssl = ssl_context
        self._fetch = fetch or (lambda url: self._urlopen(url, self._ssl() if callable(self._ssl) else self._ssl))
        self._now = now or time.time
        self._lock = threading.RLock()
        self._index = None
        self._index_key = None
        self._catalog_tried = -1e18
        self._down_until = 0.0
        self._memo = {}              # (path, only) -> [records]
        self.catalog_stale = False

    # -- the network ------------------------------------------------------------------------------------------------
    @staticmethod
    def _urlopen(url, context):
        req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
        with urllib.request.urlopen(req, timeout=FETCH_TIMEOUT_S, context=context) as r:
            return r.read()

    # ⚠ THE HOLD-OFFS ARE KEPT ON DISK, NOT ONLY HERE: the console builds each tile in a process of its own, so a hold
    # kept in memory began again with every tile - and with NOAA's host silent rather than refusing, every tile then
    # waited out a whole FETCH_TIMEOUT_S before reading the copies kept. A mark's age is its file's.
    def _marked(self, name, secs):
        try:
            return 0 <= time.time() - os.path.getmtime(os.path.join(self.root, name)) < secs
        except OSError:
            return False

    def _mark(self, name):
        try:
            os.makedirs(self.root, exist_ok=True)
            with open(os.path.join(self.root, name), "wb"):
                pass
        except OSError:
            pass

    def _get(self, url):
        if time.monotonic() < self._down_until or self._marked("down.mark", DOWN_S):
            raise OSError("NOAA's chart cells did not answer a moment ago")
        try:
            return self._fetch(url)
        except urllib.error.HTTPError as e:          # an answer: the host is up, this file is not there
            raise OSError("%s answered HTTP %s" % (url.rsplit("/", 1)[-1], e.code))
        except Exception as e:                        # no answer: hold off the next request
            self._down_until = time.monotonic() + DOWN_S
            self._mark("down.mark")
            raise OSError("%s: %s" % (url.rsplit("/", 1)[-1], str(e) or type(e).__name__))

    # -- the catalog --------------------------------------------------------------------------------------------------
    def catalog(self):
        """Every current cell as {"name", "ed", "up", "key", "band", "bbox" (lon/lat), "title"}. Refreshed after
        CATALOG_MAX_AGE_S; the copy kept when the refresh fails; OSError with no copy at all."""
        path = os.path.join(self.root, "enc.geojson")
        with self._lock:
            try:
                age = self._now() - os.path.getmtime(path)
            except OSError:
                age = None
            due = age is None or age > CATALOG_MAX_AGE_S
            if due and time.monotonic() - self._catalog_tried > CATALOG_RETRY_S \
                    and not self._marked("catalog.mark", CATALOG_RETRY_S):
                try:
                    data = self._get(CATALOG_URL)
                    d = json.loads(data.decode("utf-8"))
                    if not isinstance(d, dict) or not d.get("features"):
                        raise ValueError("NOAA's cell catalog came back empty")
                    _write(path, data)
                    self.catalog_stale = False
                except (OSError, ValueError) as e:
                    # A FAILED refresh is not tried again for CATALOG_RETRY_S - in this process or the next (the mark).
                    self._catalog_tried = time.monotonic()
                    self._mark("catalog.mark")
                    if age is None and not os.path.exists(path):
                        raise OSError("NOAA's cell catalog could not be read (%s)" % e)
                    self.catalog_stale = True
            elif age is None:
                raise OSError("NOAA's cell catalog could not be read (asked again shortly)")
            st = os.stat(path)
            key = (st.st_mtime, st.st_size)
            if self._index is None or key != self._index_key:
                self._index = self._parse_catalog(path)
                self._index_key = key
            return self._index

    @staticmethod
    def _parse_catalog(path):
        with open(path, "rb") as f:
            d = json.loads(f.read().decode("utf-8"))
        out = []
        for ft in (d or {}).get("features") or []:
            p = ft.get("properties") or {}
            m = _ED_UP.match(str(p.get("enc_ed_up") or ""))
            try:
                band = BAND_OF_USAGE.get(int(p.get("scale_band") or 0))
            except (TypeError, ValueError):
                band = None
            if not m or not band:
                continue
            pts = [_merc_inv(q[0], q[1]) for q in _pts((ft.get("geometry") or {}).get("coordinates"))]
            if not pts:
                continue
            out.append({"name": m.group(1), "ed": int(m.group(2)), "up": int(m.group(3)), "key": m.group(0),
                        "band": band, "title": p.get("title"),
                        "bbox": (min(q[0] for q in pts), min(q[1] for q in pts),
                                 max(q[0] for q in pts), max(q[1] for q in pts))})
        if not out:
            raise ValueError("NOAA's cell catalog names no cells")
        return out

    def cells_for(self, band, box):
        """The band's current cells whose footprint reaches into the box, by name."""
        return sorted((e for e in self.catalog()
                       if e["band"] == band and not (e["bbox"][2] < box[0] or e["bbox"][0] > box[2]
                                                    or e["bbox"][3] < box[1] or e["bbox"][1] > box[3])),
                      key=lambda e: e["name"])

    # -- a cell -------------------------------------------------------------------------------------------------------
    def _kept(self, name):
        """[(ed, up, path)] of every copy of the cell kept, newest first."""
        out = []
        try:
            for n in os.listdir(self.cells_dir):
                m = _ED_UP.match(n[:-4]) if n.endswith(".zip") else None
                if m and m.group(1) == name:
                    out.append((int(m.group(2)), int(m.group(3)), os.path.join(self.cells_dir, n)))
        except OSError:
            pass
        return sorted(out, reverse=True)

    def cell_path(self, entry):
        """(path, stale): the cell's zip as the catalog names it, downloaded when not kept; when it cannot be, the
        newest older copy kept and stale True; OSError when there is none."""
        want = os.path.join(self.cells_dir, entry["key"] + ".zip")
        with self._lock:
            if os.path.exists(want):
                return want, False
            try:
                data = self._get(CELL_URL % entry["name"])
                _check_cell_zip(data, entry["name"])
                _write(want, data)
            except (OSError, ValueError) as e:
                if os.path.exists(want):           # another process wrote it first
                    return want, False
                older = [k for k in self._kept(entry["name"]) if k[2] != want]
                if older:
                    return older[0][2], True
                raise OSError("cell %s could not be downloaded (%s)" % (entry["name"], e))
            for _ed, _up, p in self._kept(entry["name"]):
                if p != want:                      # an older copy, now superseded (one held open stays till next time)
                    try:
                        os.remove(p)
                    except OSError:
                        pass
            return want, False

    # -- a cell's read, kept -------------------------------------------------------------------------------------------
    def _read_path(self, path):
        return os.path.join(self.read_dir, "%s.%s.jsonl" % (os.path.basename(path)[:-4], reader_tag()))

    @staticmethod
    def _load_read(rpath, only):
        """The records of a kept read (only the classes in `only`), or None when there is none whole."""
        try:
            with open(rpath, "r", encoding="utf-8") as f:
                head = json.loads(f.readline())
                out, n = [], 0
                for line in f:
                    acr, _tab, js = line.partition("\t")
                    n += 1
                    if only is None or acr in only:
                        out.append(json.loads(js))
        except (OSError, ValueError):
            return None
        if not isinstance(head, dict) or head.get("n") != n:
            return None                            # not this reader's whole read: read the cell again
        return out

    def _parse(self, path, rpath):
        """The cell read here (s57.read_zip, then ENCDirect's shape for EVERY class, named later) and kept at `rpath`:
        a header line, then one record a line, its class acronym before a tab."""
        name = os.path.basename(path).split("_", 1)[0]
        cell = s57.read_zip(path)
        feats, _left = s57.encdirect_features(cell, lambda acronym, prim: (acronym, prim))
        recs = []
        for ft in feats:
            acronym, prim = ft.pop("cls")
            ft["oid"] = "%s:%d" % (name, ft["rcid"]) + (":%d" % ft["part"] if "part" in ft else "")
            ft["a"], ft["p"] = acronym, prim
            recs.append(ft)
        body = [json.dumps({"cell": name, "n": len(recs)}) + "\n"]
        body += ["%s\t%s\n" % (r["a"], json.dumps(r, separators=(",", ":"))) for r in recs]
        try:
            _write(rpath, "".join(body).encode("utf-8"))
        except OSError:
            pass                                   # kept next time; this read is whole in memory
        self._prune_reads(name, keep=rpath)
        return recs

    def _prune_reads(self, name, keep):
        """Every other kept read of the cell goes: an older edition's, or another reader's."""
        try:
            for n in os.listdir(self.read_dir):
                p = os.path.join(self.read_dir, n)
                if n.startswith(name + "_") and n.endswith(".jsonl") and p != keep:
                    try:
                        os.remove(p)
                    except OSError:
                        pass                       # held open by another process: next time
        except OSError:
            pass

    def _records(self, path, only):
        """The cell's records - from this process's memo, else its kept read, else parsed here and kept."""
        okey = frozenset(only) if only is not None else None
        with self._lock:
            whole = self._memo.get((path, None))
            if whole is not None:
                return whole if okey is None else [r for r in whole if r["a"] in okey]
            got = self._memo.get((path, okey))
            if got is not None:
                return got
            plock = self._parse_locks.setdefault(path, threading.Lock())
        with plock:                                # one parse of a cell at a time in this process
            with self._lock:
                got = self._memo.get((path, okey))
            if got is not None:
                return got
            rpath = self._read_path(path)
            recs = self._load_read(rpath, okey)
            if recs is None:
                recs = self._parse(path, rpath)
                if okey is not None:
                    recs = [r for r in recs if r["a"] in okey]
            with self._lock:
                self._memo[(path, okey)] = recs
                while len(self._memo) > MEMO_CELLS:
                    self._memo.pop(next(iter(self._memo)))
        return recs

    def features(self, path, namer, only=None):
        """The cell's features in ENCDirect's shape (s57.encdirect_features), each with `oid` "<CELL>:<record>" (a
        sounding ":<n>" more) - the identity two tiles reading one feature share - named by `namer(acronym, prim)`
        (None leaves the class out). `only`: those class acronyms alone. ⚠ The geometry and properties are the kept
        read's own objects, shared by every answer: copy before changing one."""
        out = []
        for r in self._records(path, only):
            cls = namer(r["a"], r["p"])
            if cls is None:
                continue
            ft = {"cls": cls, "properties": r["properties"], "geometry": r["geometry"], "rcid": r["rcid"], "oid": r["oid"]}
            if "part" in r:
                ft["part"] = r["part"]
            out.append(ft)
        return out

    # -- the two questions --------------------------------------------------------------------------------------------
    def band_features(self, band, box, namer, only=None):
        """(features, info): the band's features reaching into the box, whole (as ENCDirect's query served them), and
        {"cells": [names read], "stale": [names read from an older copy]}. Raises OSError / ValueError when a cell
        cannot be had or read at all."""
        out, info = [], {"cells": [], "stale": []}
        for e in self.cells_for(band, box):
            path, stale = self.cell_path(e)
            info["cells"].append(e["name"])
            if stale:
                info["stale"].append(e["name"])
            out.extend(ft for ft in self.features(path, namer, only) if hits_box(ft["geometry"], box))
        return out, info
