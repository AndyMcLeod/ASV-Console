"""tests/ofs_s3.py - the S3 fallback for NOAA's model server (2026-10-09).

Andy: "add an S3 fallback for NOAA's model server". The CO-OPS THREDDS answered 503 for every model through 2026-10-08
and 09; NOAA's open-data bucket (noaa-nos-ofs-pds) held the same netCDF-4 files throughout. ofs_s3.py reads them with
the STANDARD LIBRARY (the console's rule: no pip) - a reader for exactly the HDF5 structures those files use - and writes
currents.py's own cache, so the rest of the current machinery is unchanged.

THE FIXTURE (tests/fixtures/ofs_s3, written by tools/make_ofs_s3_fixture.py, which alone needs h5py) is laid out like
NOAA's files, measured that day: superblock 2, dense root links, dense attributes on `time`, contiguous 2-D grids,
u/v chunked (1, 3, 6, 4) uncompressed on a 13 x 10 grid - partial chunks at both far edges - and a time axis in
"seconds since 2018-01-01" (SSCOFS's own epoch; LEOFS's is 2015; currents assumes 2016). Its values are a FORMULA, so
every check here is against arithmetic, not against the reader. Against the REAL files the reader matched h5py value
for value on wcofs, gomofs, dbofs, leofs and sscofs (scratch, 2026-10-09; recorded in CLAUDE.md).

    python tests/ofs_s3.py     # exit 0 = pass, 1 = fail   (in-process: no console, no network)
"""

import ast
import importlib.util
import math
import os
import shutil
import sys
import tempfile
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
sys.path.insert(0, APP)        # the app's modules first: tests/currents.py is a SUITE, and would shadow currents.py
import currents                # noqa: E402
import ofs_s3                  # noqa: E402

FIX = Path(HERE) / "fixtures" / "ofs_s3"
fails = 0
ran = 0


def _crash_report(t, e, tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (t.__name__, e))
    print("".join(traceback.format_exception(t, e, tb))[-900:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")
    sys.stdout.flush()
    os._exit(1)


sys.excepthook = _crash_report             # a death is REPORTED, not silent (turn_geometry.js check 30)


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


print("The S3 fallback reads NOAA's model files with the standard library:")

# The fixture's own formula (tools/make_ofs_s3_fixture.py), restated - the truth these checks compare against.
NY, NX = 13, 10
LAT0, LON0, D = 40.0, -70.0, 0.01
LAND = {(0, 0), (0, 1), (12, 9), (7, 5)}
CYCLE = datetime(2026, 10, 9, 0, 0, tzinfo=timezone.utc)
FILES = ["tstofs.t00z.20261009.regulargrid.%s.nc" % t for t in ("n006", "f001", "f002", "f003")]


def value(k, y, x):
    return 0.10 * y + 0.01 * x + 0.5 * k, -(0.05 * y + 0.02 * x) - 0.25 * k


def h5(name):
    return ofs_s3.H5(ofs_s3.LocalFile(str(FIX / name)))


# 1. THE STRUCTURES: dense links, dense attributes, the units of a 2018 epoch, the chunk shape, contiguous grids.
h1 = h5(FILES[1])
t1, u1, lat1 = h1.dataset("time"), h1.dataset("u_eastward"), h1.dataset("Latitude")
check("1. the root group's DENSE links are read (a fractal heap behind a v2 B-tree), `time`'s DENSE attributes give its "
      "units, u is chunked (1, 3, 6, 4) little-endian float32 and the grids are contiguous",
      lambda: {"Latitude", "Longitude", "mask", "Depth", "time", "u_eastward", "v_northward"} <= set(h1.links())
      and t1["attr_heap"] is not None and h1.attribute(t1, "units") == "seconds since 2018-01-01 00:00:00"
      and u1["chunk"] == [1, 3, 6, 4] and u1["fmt"] == "<f" and "contiguous" in lat1 and lat1["shape"] == [NY, NX],
      lambda: "links %s; units %r; u chunk %s %s" % (sorted(h1.links()), h1.attribute(t1, "units"), u1["chunk"], u1["fmt"]))

# 2. THE SURFACE IN A BOX across partial chunks: rows 4..12 and columns 2..9 cross three chunk rows and three chunk
# columns, the last of each partial; land reads the fill value; the deeper layers (the formula + 100 m * z) never appear.
y0, y1, x0, x1 = 4, 12, 2, 9
got = ofs_s3.read_surface(h1, u1, h1.chunks(u1), y0, y1, x0, x1)
want = [(-99999.0 if (y, x) in LAND else value(1, y, x)[0]) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]
check("2. the surface u in a box across partial edge chunks is the formula's, value for value - land at the fill value, "
      "and nothing from a deeper layer",
      lambda: len(got) == len(want) and all(abs(g - w) < 1e-5 for g, w in zip(got, want)) and max(got) < 100.0,
      lambda: "%d values; first %s want %s; max %.3f" % (len(got), got[:3], [round(w, 3) for w in want[:3]], max(got)))

# 3. TIME: each file's own epoch, converted to currents'.
cyc_2016 = (CYCLE - currents.EPOCH).total_seconds()
refused = False
try:
    ofs_s3.to_epoch_seconds(1.0, "fortnights since the flood")
except ofs_s3.H5Error:
    refused = True
check("3. a time is read in its file's own units and converted to currents' 2016 epoch: 2018-based seconds, 2015-based "
      "seconds and days all land on the same instant; units it cannot read are refused, not guessed",
      lambda: abs(ofs_s3.to_epoch_seconds((CYCLE - datetime(2018, 1, 1, tzinfo=timezone.utc)).total_seconds(),
                                          "seconds since 2018-01-01 00:00:00") - cyc_2016) < 1e-6
      and abs(ofs_s3.to_epoch_seconds((CYCLE - datetime(2015, 1, 1, tzinfo=timezone.utc)).total_seconds(),
                                      "seconds since 2015-01-01 00:00:00") - cyc_2016) < 1e-6
      and abs(ofs_s3.to_epoch_seconds(cyc_2016 / 86400.0, "days since 2016-01-01") - cyc_2016) < 1e-3 and refused,
      lambda: "cycle in 2016 seconds %.0f; refused junk %s" % (cyc_2016, refused))

# 4. THE BUCKET LISTING: two pages (a continuation token), regulargrid files only, cycles newest first.
PAGES = {None: "<ListBucketResult><Key>tstofs/netcdf/2026/10/09/%s</Key><Key>tstofs/netcdf/2026/10/09/"
               "tstofs.t00z.20261009.fields.f001.nc</Key><NextContinuationToken>tok2</NextContinuationToken>"
               "</ListBucketResult>" % FILES[0],
         "tok2": "<ListBucketResult>%s<Key>tstofs/netcdf/2026/10/09/tstofs.t06z.20261009.regulargrid.n001.nc</Key>"
                 "</ListBucketResult>" % "".join("<Key>tstofs/netcdf/2026/10/09/%s</Key>" % f for f in FILES[1:])}
asked = []


def opener(url):
    asked.append(url)
    tok = None
    if "continuation-token=" in url:
        tok = url.split("continuation-token=")[1].split("&")[0]
    return PAGES[tok]


keys = ofs_s3._list("tstofs/netcdf/2026/10/09/", opener=opener)
cyc = ofs_s3.available_cycles("tstofs", days_back=1, now=CYCLE + timedelta(hours=2),
                              lister=lambda p: ofs_s3._list(p, opener=opener))
check("4. the bucket is listed across its continuation pages; only regulargrid files make a cycle, and the cycles come "
      "newest first",
      lambda: len(keys) == 6 and [c[1] for c in cyc] == ["06z", "00z"] and cyc[1][2] == sorted(FILES)
      and all("fields" not in f for c in cyc for f in c[2]),
      lambda: "%d keys over %d requests; cycles %s" % (len(keys), len(asked), [(c[1], len(c[2])) for c in cyc]))

# 5. A WHOLE CYCLE into a temp cache, loaded by the unchanged currents.Currents.
TMP = Path(tempfile.mkdtemp(prefix="asv_ofs_s3_"))
opened = []


def open_file(key):
    opened.append(key)
    return ofs_s3.LocalFile(str(FIX / key.rsplit("/", 1)[-1]))


def lister(prefix):
    if "/2026/10/09/" not in prefix:
        return []
    return ["tstofs/netcdf/2026/10/09/%s" % f for f in FILES]


BBOX = (40.03, -69.97, 40.08, -69.93)
start = CYCLE + timedelta(minutes=90)
tag = ofs_s3.ensure_cycle_covering(start, start, BBOX, "tstofs", cache=TMP, lister=lister, open_file=open_file,
                                   now=CYCLE + timedelta(hours=3))
n_open = len(opened)
c = currents.Currents(tag=tag, cache=TMP)
node = (6, 4)                                             # Latitude 40.06, Longitude -69.96: a water node in the box
la, lo = LAT0 + D * node[0], LON0 + D * node[1]
at = c.at(la, lo, CYCLE + timedelta(hours=2))
wu, wv = value(2, *node)
# THE LAND NODE IN THE CACHE, not asked through c.at(): at a node a hair's float jitter puts the bilinear stencil on its
# neighbours, and currents blends their water in by design (the first draft of this check expected None there).
by, bx = round((c.lat0 - LAT0) / D), round((c.lon0 - LON0) / D)
land_i = (7 - by) * c.nx + (5 - bx)
water_i = (node[0] - by) * c.nx + (node[1] - bx)
check("5. a whole cycle read from the bucket is written in currents' own cache: four frames an hour apart from the "
      "cycle hour, in its 2016 epoch; currents.Currents loads it and gives back the formula at a water node; the land "
      "node is masked out with the fill value; the meta says via s3",
      lambda: c.meta.get("via") == "s3" and len(c.times) == 4
      and [round(t - cyc_2016) for t in c.times] == [0, 3600, 7200, 10800]
      and at is not None and abs(at[2] - wu) < 1e-5 and abs(at[3] - wv) < 1e-5
      and c.mask[land_i] == 0 and c.u[1][land_i] <= currents.FILL / 2 and c.mask[water_i] == 1,
      lambda: "tag %s; times %s; at node %s (want u %.3f v %.3f); land node mask %s u %s" % (
          tag, [round(t - cyc_2016) for t in c.times], at and [round(x, 4) for x in at], wu, wv,
          c.mask[land_i], c.u[1][land_i]))

# 6. THE CACHE answers the next look: no file opened again.
again = ofs_s3.ensure_cycle_covering(start, start, BBOX, "tstofs", cache=TMP, lister=lister, open_file=open_file,
                                     now=CYCLE + timedelta(hours=3))
check("6. the next look for the same window is answered from the cache - nothing opened again",
      lambda: again == tag and len(opened) == n_open and n_open == len(FILES),
      lambda: "first call opened %d files, second %d more" % (n_open, len(opened) - n_open))

# 7. REFUSALS: what this reader was not written for is said, not guessed.
bad = bytearray((FIX / FILES[0]).read_bytes())
bad[8] = 0


class _Bytes:
    def __init__(self, b):
        self.data = bytes(b)

    def read(self, off, n):
        return self.data[off:off + n]

    read_raw = read


errs = []
for src, what in ((_Bytes(bad), "superblock 0"), (_Bytes(b"not hdf5" * 8), "not HDF5")):
    try:
        ofs_s3.H5(src)
        errs.append(None)
    except ofs_s3.H5Error as e:
        errs.append(str(e))
try:
    h1.dataset("no_such_variable")
    errs.append(None)
except ofs_s3.H5Error as e:
    errs.append(str(e))
check("7. a file outside what the reader knows is refused in words - an old superblock, a file that is not HDF5, a "
      "variable that is not there",
      lambda: all(errs) and "superblock version 0" in errs[0] and "not an HDF5" in errs[1] and "no_such_variable" in errs[2],
      lambda: errs)

# 8. STANDARD LIBRARY ONLY - the console's rule.
tree = ast.parse((Path(APP) / "ofs_s3.py").read_text(encoding="utf-8"))
mods = {n.names[0].name.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.Import)} | \
       {n.module.split(".")[0] for n in ast.walk(tree) if isinstance(n, ast.ImportFrom) and n.module}
check("8. ofs_s3 imports nothing outside the standard library and the console's own currents.py (README: no pip)",
      lambda: mods <= {"gzip", "json", "math", "re", "struct", "threading", "urllib", "concurrent", "datetime",
                       "currents"} and not ({"h5py", "numpy", "netCDF4", "xarray", "fsspec"} & mods),
      lambda: sorted(mods))

# 9. THE CONSOLE: S3 only when NOAA's model server is down, and every way it can go wrong said in words.
spec = importlib.util.spec_from_file_location("console_for_ofs_s3", os.path.join(APP, "asv_console.py"))
C = importlib.util.module_from_spec(spec)
spec.loader.exec_module(C)
real_ecc, real_s3, real_cache = C.currents.ensure_cycle_covering, C.ofs_s3.ensure_cycle_covering, C.currents.CACHE
calls = []


def monitor(why):
    m = C.CurrentsMonitor.__new__(C.CurrentsMonitor)
    m._lock = threading.Lock()
    m._ofs, m._tag, m._cur, m._last = "tstofs", None, None, {}
    m._why_no_cycle = lambda: why
    return m


DOWN = "NOAA's model server is down (HTTP 503 from opendap.co-ops.nos.noaa.gov) - TSTOFS cannot be read"
res = {}
try:
    C.currents.ensure_cycle_covering = lambda *a, **k: (None, False)
    C.currents.CACHE = TMP

    def s3_ok(s, e, bbox, ofs):
        calls.append(ofs)
        return tag
    C.ofs_s3.ensure_cycle_covering = s3_ok
    m = monitor(DOWN)
    res["down_ok"] = (m._ensure_cycle(la, lo), m._cur is not None and m._cur.meta.get("via"))
    m2 = monitor(None)                                     # the server answers: no S3 at all
    n_before = len(calls)
    res["answers"] = (m2._ensure_cycle(la, lo), len(calls) - n_before)

    def s3_raises(*a):
        raise ofs_s3.H5Error("filtered (compressed) data")
    C.ofs_s3.ensure_cycle_covering = s3_raises
    res["s3_fails"] = monitor(DOWN)._ensure_cycle(la, lo)
    C.ofs_s3.ensure_cycle_covering = lambda *a: None
    res["s3_none"] = monitor(DOWN)._ensure_cycle(la, lo)

    def s3_outside(*a):
        raise RuntimeError("bbox does not overlap the model box")
    C.ofs_s3.ensure_cycle_covering = s3_outside
    res["outside"] = monitor(DOWN)._ensure_cycle(la, lo)
finally:
    C.currents.ensure_cycle_covering, C.ofs_s3.ensure_cycle_covering, C.currents.CACHE = real_ecc, real_s3, real_cache


class _Cur:
    tag = "tstofs_20261009_t00z"
    meta = {"via": "s3"}
    start = CYCLE
    end = CYCLE + timedelta(hours=3)

    def at_best(self, lat, lon, when):
        return (1.0, 90.0, 0.5, 0.0), 0.0


m3 = monitor(None)
m3._cur = _Cur()
res["reading"] = m3._ofs_sample(la, lo)
check("9. the console reads the S3 copy ONLY when NOAA's model server is down - loading the cycle as any other, its "
      "reading marked via s3 - and says each failure in words: the copy unreadable, holding no cycle for now, or the "
      "position outside the model",
      lambda: res["down_ok"] == (None, "s3") and res["answers"] == (None, 0)
      and DOWN in res["s3_fails"] and "its S3 copy could not be read either (H5Error: filtered" in res["s3_fails"]
      and "its S3 copy holds no TSTOFS cycle covering now" in res["s3_none"]
      and res["outside"] == "tstofs does not cover this position" and res["reading"].get("via") == "s3",
      lambda: "%r" % res)

shutil.rmtree(TMP, ignore_errors=True)
print("\n%s (%d ran)" % ("%d CHECK(S) FAILED" % fails if fails else "all checks passed", ran))
sys.stdout.flush()
os._exit(1 if fails else 0)
