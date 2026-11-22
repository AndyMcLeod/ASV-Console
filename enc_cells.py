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
zip holds the base cell and every update to date, applied in order (s57.read_zip). A CANCELED CELL is not in the
catalog, so it is never read: ENCDirect still served two canceled cells (Lewes, Bellingham).

A CELL IS PARSED ONCE. Reading one takes 1.5-4 s and 10-50 MB (measured on a harbor, approach, coastal and general
cell), and a coarse cell lies under dozens of tiles, each built in a process of its own. So a cell's read - every class
in ENCDirect's shape, named later - is kept beside it as <root>/read/<CELL>_ED<n>_UP<n>.<reader>.jsonl, one feature a
line (read back as many small parses, as the console's tiles are), and read from there; `reader` hashes the reader's
own code and tables (reader_tag), so a changed reader reads every cell again.

WHAT FAILS, AND HOW. A cell that cannot be downloaded is read from the newest older copy kept, and named in `stale`
(the console then serves the read once and does not keep it); with no copy, the read FAILS (OSError) - never an empty
answer, because "this water has no chart" is a fact about the place and a failed download is not. A catalog that
cannot be refreshed is read from the copy kept, and SAID: `catalog_stale` is that copy's date, in every process that
reads it past its age - the console serves what it reads then and does not keep it; with no copy, the read fails.
After a failed request the network is not asked again for DOWN_S, so an outage costs one timeout, not one per cell.
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
REFUSED_S = 120.0               # a cell whose download answered but was refused (not whole, a member damaged, not the
                                # edition and update the catalog names) is not downloaded again for this long, by any
                                # process: an older copy is served meanwhile
CATALOG_DROP_MAX = 0.05         # a refreshed catalog naming fewer than 19 in 20 as many cells as the copy kept, or with 1
                                # in 20 of its own entries unreadable, is refused (the 2026-11-21 review): NOAA's of
                                # 2026-11-21 names 7114 cells and every entry reads
# A FILE'S TIME MAY RUN A LITTLE AHEAD OF time.time(): on Windows the two are kept at different resolutions (Python
# 3.11's clock was seen stepping by whole milliseconds; the file system stamps to a tenth of a microsecond), and one fresh
# file in eleven read as written in the future - so a mark checked just after it was written was not honored, and
# tests/enc_cells.py 5b failed. A time further ahead than this is a clock set back since: a catalog from then is due, a
# mark from then holds nothing.
CLOCK_SLACK_S = 2.0
SHARE_WAITS_S = (0.05, 0.1, 0.2, 0.4)   # a file another process is replacing is tried again after each (_read_file)
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
    """EPSG:3857 meters -> (lon, lat) degrees."""
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


def _read_file(path):
    """The bytes of `path`. ⚠ A SHARING VIOLATION IS WAITED OUT (the 2026-11-21 review): on Windows an open fails with
    PermissionError while another process's os.replace of the file is landing, and that failed the band's whole read -
    40 of 19,500 reads with five processes on one store. Tried again after each of SHARE_WAITS_S (0.75 s in all), then
    raised."""
    for wait in SHARE_WAITS_S + (None,):
        try:
            with open(path, "rb") as f:
                return f.read()
        except PermissionError:
            if wait is None:
                raise
            time.sleep(wait)


def _discard(path):
    """The file goes, if it can (one held open by another process stays till next time)."""
    try:
        os.remove(path)
    except OSError:
        pass


def _check_cell_zip(data, name):
    """(edition, update) the download HOLDS - a zip of the cell's base file and its updates in an unbroken run, every
    member whole by its CRC - or ValueError: an error page, half a file, a damaged member, a gap. The edition is the
    base's DSID EDTN; the update the last update file's number, else the base's UPDN (a re-issued base).
    ⚠ WHAT IT HOLDS, NOT WHAT IT WAS ASKED FOR (the 2026-11-21 review): a zip was kept as the edition and update the
    catalog named whatever it held, so one served behind its catalog was kept as current - and, its name taken, never
    downloaded again until the next update; and a member damaged inside a whole zip passed, the good older copy was
    removed, and the cell could not be read until the next update."""
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            members = {}
            for n in z.namelist():
                m = re.match(r"^%s\.(\d{3})$" % re.escape(name.upper()), n.replace("\\", "/").rsplit("/", 1)[-1].upper())
                if m:
                    members[int(m.group(1))] = n
            if 0 not in members:
                raise ValueError("the zip holds no %s.000" % name)
            bad = z.testzip()
            if bad is not None:
                raise ValueError("its member %s is damaged" % bad)
            ds = s57.dataset_id(z.read(members[0]))
            ed, base_up = int(ds.get("EDTN") or 0), int(ds.get("UPDN") or 0)
    except ValueError as e:
        raise ValueError("cell %s: %s" % (name, e))
    except Exception as e:                       # BadZipFile, a zlib error inside a member, a record cut short
        raise ValueError("cell %s: not a whole zip (%s: %s)" % (name, type(e).__name__, e))
    ups = sorted(k for k in members if k)
    if ups != list(range(base_up + 1, base_up + 1 + len(ups))):  # all 115 of NOAA's zips read here: a base at 0, a run from 1
        raise ValueError("cell %s: the zip's updates %s do not run on from its base's update %d" % (name, ups, base_up))
    if not ed:
        raise ValueError("cell %s: its base names no edition" % name)
    return ed, (ups[-1] if ups else base_up)


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
        self.catalog_stale = None    # the date of the catalog copy read past its age (its refresh failed or held off)

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
            return -CLOCK_SLACK_S <= time.time() - os.path.getmtime(os.path.join(self.root, name)) < secs
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
        CATALOG_MAX_AGE_S; the copy kept when the refresh fails, and `catalog_stale` its date; OSError with no copy."""
        path = os.path.join(self.root, "enc.geojson")
        with self._lock:
            try:
                age = self._now() - os.path.getmtime(path)
            except OSError:
                age = None
            # a copy from the FUTURE is due too: its age is not known (the clock was set back since it was written), and
            # taken as young it was never refreshed until the clock caught up (the 2026-11-21 review)
            due = age is None or age > CATALOG_MAX_AGE_S or age < -CLOCK_SLACK_S
            refreshed = False
            if due and time.monotonic() - self._catalog_tried > CATALOG_RETRY_S \
                    and not self._marked("catalog.mark", CATALOG_RETRY_S):
                try:
                    data = self._get(CATALOG_URL)
                    why = self._catalog_refused(json.loads(data.decode("utf-8")), path)
                    if why:
                        raise ValueError("NOAA's cell catalog was refused: %s" % why)
                    _write(path, data)
                    refreshed = True
                except (OSError, ValueError) as e:
                    # A FAILED refresh is not tried again for CATALOG_RETRY_S - in this process or the next (the mark).
                    self._catalog_tried = time.monotonic()
                    self._mark("catalog.mark")
                    if age is None and not os.path.exists(path):
                        raise OSError("NOAA's cell catalog could not be read (%s)" % e)
            elif age is None:
                raise OSError("NOAA's cell catalog could not be read (asked again shortly)")
            st = os.stat(path)
            # ⚠ A CATALOG PAST ITS AGE IS SAID, IN EVERY PROCESS (the 2026-11-21 review): only the process whose refresh
            # failed knew, and nobody asked it - the next tile's child, held off by the mark, read the old copy as
            # current, and its tile was kept a week as whole. The copy's own age decides, whoever tried.
            left = self._now() - st.st_mtime
            self.catalog_stale = (None if refreshed or -CLOCK_SLACK_S <= left <= CATALOG_MAX_AGE_S
                                  else time.strftime("%Y-%m-%d", time.gmtime(st.st_mtime)))
            key = (st.st_mtime, st.st_size)
            if self._index is None or key != self._index_key:
                self._index = self._parse_catalog(path)
                self._index_key = key
            return self._index

    @staticmethod
    def _catalog_entries(d):
        """(entries, n): the cells a catalog names, as catalog() gives them, and how many entries (features) it has.
        An entry that does not read - no edition and update, a scale band that is not one, no footprint - names none."""
        feats = d.get("features") if isinstance(d, dict) else None
        feats = feats if isinstance(feats, list) else []
        out = []
        for ft in feats:
            try:
                p = ft.get("properties") or {}
                m = _ED_UP.match(str(p.get("enc_ed_up") or ""))
                band = BAND_OF_USAGE.get(int(p.get("scale_band") or 0))
                if not m or not band:
                    continue
                pts = [_merc_inv(q[0], q[1]) for q in _pts((ft.get("geometry") or {}).get("coordinates"))]
            except (AttributeError, TypeError, ValueError, IndexError):
                continue
            if not pts:
                continue
            out.append({"name": m.group(1), "ed": int(m.group(2)), "up": int(m.group(3)), "key": m.group(0),
                        "band": band, "title": p.get("title"),
                        "bbox": (min(q[0] for q in pts), min(q[1] for q in pts),
                                 max(q[0] for q in pts), max(q[1] for q in pts))})
        return out, len(feats)

    @staticmethod
    def _parse_catalog(path):
        out, _n = CellSource._catalog_entries(json.loads(_read_file(path).decode("utf-8")))
        if not out:
            raise ValueError("NOAA's cell catalog names no cells")
        return out

    @classmethod
    def _catalog_refused(cls, d, path):
        """Why a refreshed catalog `d` is not taken - or None. ⚠ A REFRESH IS READ BEFORE IT IS KEPT (the 2026-11-21
        review). One was kept whenever it was JSON with a feature: a cell left out of it, or an entry that did not read,
        was read as canceled - the harbor chart gone and the tile kept whole - and a schema change overwrote the good
        copy, so every read failed until a day had passed. Refused: one naming no cell, one with more than
        CATALOG_DROP_MAX of its own entries unreadable, and one naming fewer than (1 - CATALOG_DROP_MAX) as many cells
        as the copy kept. A refusal is a failed refresh: the copy kept is read, said past its age (catalog_stale)."""
        entries, n = cls._catalog_entries(d)
        if not entries:
            return "it names no cells (%d entries)" % n
        if len(entries) < (1.0 - CATALOG_DROP_MAX) * n:
            return "%d of its %d entries do not read" % (n - len(entries), n)
        try:
            kept = len(cls._parse_catalog(path)) if os.path.exists(path) else 0
        except (OSError, ValueError):
            kept = 0
        if len(entries) < (1.0 - CATALOG_DROP_MAX) * kept:
            return "it names %d cells, the copy kept %d" % (len(entries), kept)
        return None

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
        newest older copy kept and stale True; OSError when there is none. A download is kept as what it HOLDS
        (_check_cell_zip): one behind the catalog under its own name - an older copy, served stale - and one ahead of
        it (the catalog behind NOAA's zips) under its own name too, served as the chart. A download refused with an
        answer is not asked for again for REFUSED_S (mark refused_<CELL>.mark). The older copies stay until the
        download has READ (_records -> _prune_cells)."""
        name, mine = entry["name"], (entry["ed"], entry["up"])
        want = os.path.join(self.cells_dir, entry["key"] + ".zip")
        mark = "refused_%s.mark" % name
        with self._lock:
            if os.path.exists(want):
                return want, False
            kept = self._kept(name)
            if kept and kept[0][:2] > mine:        # newer than the catalog names: NOAA's zip ahead of its catalog
                return kept[0][2], False
            try:
                if self._marked(mark, REFUSED_S):
                    raise OSError("its last download was refused - asked again shortly")
                data = self._get(CELL_URL % name)
                try:
                    held = _check_cell_zip(data, name)
                except ValueError:
                    self._mark(mark)
                    raise
                if held != mine:
                    other = os.path.join(self.cells_dir, "%s_ED%03d_UP%03d.zip" % (name, held[0], held[1]))
                    if not kept or held > kept[0][:2]:
                        _write(other, data)        # kept as what it is: a truer copy than any kept
                    if held > mine:
                        return other, False
                    self._mark(mark)
                    raise ValueError("NOAA's zip of %s holds edition %d update %d, its catalog names edition %d "
                                     "update %d" % (name, held[0], held[1], mine[0], mine[1]))
                _write(want, data)
            except (OSError, ValueError) as e:
                if os.path.exists(want):           # another process wrote it first
                    return want, False
                older = [k for k in self._kept(name) if k[2] != want]
                if older:
                    return older[0][2], True
                raise OSError("cell %s could not be downloaded (%s)" % (name, e))
            _discard(os.path.join(self.root, mark))
            return want, False

    def _prune_cells(self, path):
        """Every copy of the cell OLDER than `path` goes, now that `path` has read (one held open stays till next time).
        ⚠ NOT BEFORE IT READS (the 2026-11-21 review): the older copies went as a download was kept, and a download
        whole by its CRCs and its DSID that the reader could not read was the only copy - every read of the cell failed
        until NOAA's next edition. A copy newer than `path` is not touched."""
        m = _ED_UP.match(os.path.basename(path)[:-4])
        if not m:
            return
        read = (int(m.group(2)), int(m.group(3)))
        for ed, up, p in self._kept(m.group(1)):
            if (ed, up) < read:
                _discard(p)

    # -- a cell's read, kept -------------------------------------------------------------------------------------------
    def _read_path(self, path):
        return os.path.join(self.read_dir, "%s.%s.jsonl" % (os.path.basename(path)[:-4], reader_tag()))

    @staticmethod
    def _load_read(rpath, only):
        """(records, failed) of a kept read (only the classes in `only`), or None when there is none whole."""
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
        if not isinstance(head, dict) or head.get("n") != n or not isinstance(head.get("failed"), list):
            return None                            # not this reader's whole read: read the cell again
        return out, [tuple(k) for k in head["failed"] if only is None or k[0] in only]

    def _parse(self, path, rpath):
        """(records, failed): the cell read here (s57.read_zip, then ENCDirect's shape for EVERY class, named later)
        and kept at `rpath` - a header line, then one record a line, its class acronym before a tab. `failed`: the
        (acronym, prim) of every class a feature of which could not be built."""
        key = os.path.basename(path)[:-4]           # "US5NH1BC_ED005_UP003": the copy read, edition and update
        name = key.split("_", 1)[0]
        # ⚠ THE COPY MUST HOLD WHAT ITS NAME SAYS (the 2026-11-21 review): a build before it kept a download under the
        # name the catalog gave whatever the zip held. The same check as a download's (_check_cell_zip), so a copy kept
        # by that build - or damaged on disk since - is not read as the edition and update its name says. A mislabeled
        # copy is renamed to what it holds (an older copy, still served stale); a damaged one goes. Either way this read
        # fails, and the cell is asked for again.
        data = _read_file(path)
        m = _ED_UP.match(key)
        try:
            held = _check_cell_zip(data, name)
        except ValueError:
            if m:
                _discard(path)
            raise
        if m and held != (int(m.group(2)), int(m.group(3))):
            other = os.path.join(os.path.dirname(path), "%s_ED%03d_UP%03d.zip" % (name, held[0], held[1]))
            try:
                if os.path.exists(other):
                    raise OSError("a copy of that is kept")
                os.replace(path, other)
            except OSError:
                _discard(path)
            raise ValueError("cell %s: the copy kept as %s holds edition %d update %d" % (name, key, held[0], held[1]))
        # ⚠ A COPY THAT DOES NOT READ IS NOT THE CHART (the 2026-11-21 review): whole by its CRCs and its DSID, a zip
        # whose records the reader cannot read stayed the cell's copy, every read of it failing until NOAA's next
        # edition. It goes, and is not asked for again for REFUSED_S (NOAA serves the same zip): the older copy, kept
        # until a newer one reads (_prune_cells), is served stale meanwhile.
        # ⚠ THE BYTES CHECKED ARE THE BYTES READ - the file is not opened again: a second open could fail on a sharing
        # violation (another process's replace landing), and its failure, caught here, discarded a good copy as one
        # that does not read and held the cell off for REFUSED_S.
        try:
            cell = s57.read_zip(data)
            feats, left = s57.encdirect_features(cell, lambda acronym, prim: (acronym, prim))
        except MemoryError:
            raise
        except Exception as e:                    # S57Error, or a record the reader trips on
            if m:
                _discard(path)
                self._mark("refused_%s.mark" % name)
            raise ValueError("cell %s: the copy %s does not read (%s: %s)" % (name, key, type(e).__name__, e))
        del data
        # ⚠ A FEATURE WHOSE GEOMETRY CANNOT BE BUILT IS A FAILED READ OF ITS CLASS, KEPT AND SAID (the 2026-11-21
        # review). A point, line or area with no geometry is one whose vectors are missing - an update deleted a wreck's
        # node and left the wreck, or an area's ring does not close (s57 records why in cell.problems). It was dropped
        # here and the read kept and served as whole: a danger gone without a word. Now the class is named, kept in the
        # read's header for every process, and the console reads the band's answer as one whose layer did not arrive
        # (`partial`). An object with no geometry of its own (a collection, prim 255) is not a failure. None in 115 of
        # NOAA's cells read here. So is a feature an update changes that is not there (cell.lost): NOAA charts it, and
        # this read does not hold it - the update and the base not one chain. An update deleting one not there is not.
        objl = s57.catalog()["objl"]
        lost = {(objl.get(o, ("OBJL%d" % o,))[0], p) for o, p in cell.lost}
        failed = sorted({k for k in set(left) | lost if k[1] in (s57.PRIM_POINT, s57.PRIM_LINE, s57.PRIM_AREA)})
        if failed:
            print("[cells] %s: %s could not be built (%s)" % (key, ", ".join("%s/%d" % k for k in failed),
                                                            "; ".join(cell.problems[:3]) or "no geometry"), flush=True)
        recs = []
        for ft in feats:
            acronym, prim = ft.pop("cls")
            # the oid names the EDITION AND UPDATE read, not the cell alone: an update moves a feature in place (same
            # record), and two tiles read from different updates must not share an id - the layered read keeps the
            # first of a shared id, and the first may be the older tile's (the 2026-11-21 review)
            ft["oid"] = "%s:%d" % (key, ft["rcid"]) + (":%d" % ft["part"] if "part" in ft else "")
            ft["a"], ft["p"] = acronym, prim
            recs.append(ft)
        body = [json.dumps({"cell": name, "n": len(recs), "failed": [list(k) for k in failed]}) + "\n"]
        body += ["%s\t%s\n" % (r["a"], json.dumps(r, separators=(",", ":"))) for r in recs]
        try:
            _write(rpath, "".join(body).encode("utf-8"))
        except OSError:
            pass                                   # kept next time; this read is whole in memory
        self._prune_reads(name, keep=rpath)
        return recs, failed

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
        """(records, failed) of the cell - from this process's memo, else its kept read, else parsed here and kept."""
        okey = frozenset(only) if only is not None else None

        def cut(got):
            recs, failed = got
            return ([r for r in recs if r["a"] in okey], [k for k in failed if k[0] in okey])
        with self._lock:
            whole = self._memo.get((path, None))
            if whole is not None:
                return whole if okey is None else cut(whole)
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
            got = self._load_read(rpath, okey)
            if got is None:
                got = self._parse(path, rpath)
                if okey is not None:
                    got = cut(got)
            with self._lock:
                self._prune_cells(path)             # it reads: the copies older than it go
                self._memo[(path, okey)] = got
                while len(self._memo) > MEMO_CELLS:
                    self._memo.pop(next(iter(self._memo)))
        return got

    def features(self, path, namer, only=None, failed=None):
        """The cell's features in ENCDirect's shape (s57.encdirect_features), each with `oid`
        "<CELL>_ED<n>_UP<n>:<record>" (a sounding ":<n>" more) - the identity two tiles reading one feature from the
        same update share; read from different updates, two ids, both kept - named by `namer(acronym, prim)`
        (None leaves the class out). `only`: those class acronyms alone. `failed`, a list: each class a feature of
        which could not be built is appended, by its name (_parse). ⚠ The geometry and properties are the kept
        read's own objects, shared by every answer: copy before changing one."""
        out = []
        recs, bad = self._records(path, only)
        if failed is not None:
            failed.extend(namer(a, p) or a for a, p in bad)
        for r in recs:
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
        {"cells": [names read], "stale": [names read from an older copy], "catalog_stale": the date of the catalog copy
        read past its age, or None, "partial": [classes a feature of which could not be built, in any cell read -
        where it lay is not known, so it counts for any box its cell reaches], "failed_cells": [those cells]}.
        Raises OSError / ValueError when a cell cannot be had or read at all."""
        out, info = [], {"cells": [], "stale": []}
        entries = self.cells_for(band, box)
        info["catalog_stale"] = self.catalog_stale
        partial, failed_cells = set(), []
        for e in entries:
            path, stale = self.cell_path(e)
            info["cells"].append(e["name"])
            if stale:
                info["stale"].append(e["name"])
            bad = []
            out.extend(ft for ft in self.features(path, namer, only, failed=bad) if hits_box(ft["geometry"], box))
            if bad:
                partial.update(bad)
                failed_cells.append(e["name"])
        info["partial"], info["failed_cells"] = sorted(partial), failed_cells
        return out, info
