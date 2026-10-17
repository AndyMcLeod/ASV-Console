"""tests/cache_writes.py - a cache file is written whole or not at all, by any number of writers (review #27, 2026-09-15).

The ENC caches (an extract, its metadata, a band's layer map) and the CO-OPS water-station list all wrote through
`<path>.part` - ONE temp name per cache - so two writers of the same file (a fetch and its background top-up) wrote into
the same temp file: one replaced the cache with whatever the interleaving left, or failed on a temp the other had
already moved. And the NDBC weather-station list was written straight over the old file, so an interrupted write left
a truncated cache. Every one of them goes through _write_json_atomic now: a temp name per process and thread, and a
replace that retries while a reader holds the file (Windows refuses it).

DRIVEN: the console's own _write_json_atomic under three threads (two writers, one reader), with json.dump made to fail
part way, and _load_ndbc_stations / _load_water_stations with their network stubbed and their caches in a temp folder;
the three ENC writers are read as source (a live ENC fetch is out of reach) for the one call they must make.

    python tests/cache_writes.py      # exit 0 = pass, 1 = fail   (stdlib only)

TEETH - 7 mutations RUN in a scratch clone (sidecar original, atomic writes, no bytecode, byte-compared afterwards),
7/7 caught:
    one fixed temp name per cache again (the old code) -> 1, 4   no replace retry -> 1, 3, 4
    a failed write leaves its temp -> 2                          the NDBC list written straight over the file -> 3, 5
    the water list's write unguarded -> 4b, 5                   _cache_json lets a refusal through -> 4b
    the ENC extract written raw -> 5
MEASURED, check 1 (two writers of 150 each, a reader looping on the file): this code - 6 of 300 writes refused while the
reader held the file, no other error, no torn read in 13,232; ONE fixed temp name per cache, as the ENC caches had it -
67 writes failed on a temp the other writer had already moved (FileNotFoundError) and 721 reads found a cache that was
not whole JSON (76,563 bytes of it); no replace retry - 255 of 300 refused. Hence check 1's bound of 60 refusals.
⚠ THE FIRST RUN OF THE SUITE FAILED CHECK 1 ON THE FIXED CODE, and it was right to: 12 of 300 writes ran out of retries,
and three cache writers let that raise into their fetch - the water-station list came back EMPTY with the stations in
hand. That is _cache_json. And "_cache_json lets a refusal through" first CRASHED the suite (the NDBC loader raised out of
check 4b); the loaders are called through attempt() now, so a raise is a failed check.
"""

import ast
import importlib.util as _ilu
import json
import os
import sys
import tempfile
import threading
import time


def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..")
sys.path.insert(0, APP)
sys.path.insert(0, os.path.join(HERE, "lib"))
from console_state import ConsoleState  # noqa: E402

_spec = _ilu.spec_from_file_location("asv_console_cache_writes", os.path.join(APP, "asv_console.py"))
_C = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_C)
STATE = ConsoleState(prefix="asv_cache_writes_")
_C.use_state_dir(STATE.dir)
TMP = STATE.path("caches")
os.makedirs(TMP, exist_ok=True)

fails = 0
ran = 0


def check(name, cond, detail=""):
    global fails, ran
    ran += 1
    ok = False
    try:
        ok = bool(cond() if callable(cond) else cond)
        if callable(detail):
            detail = detail()
    except Exception as e:
        detail = "THREW %s: %s" % (type(e).__name__, e)
    print(("  ok   " if ok else "  FAIL ") + name + ("   [%s]" % detail if detail else ""))
    if not ok:
        fails += 1


print("A cache file is written whole or not at all, by any number of writers:")

# 1. two writers and a reader on one cache
path = os.path.join(TMP, "features_v5_test.json")
payloads = [{"band": "harbour", "features": [{"i": i, "pad": "x" * (i * 97 % 4000)} for i in range(40)]},
            {"band": "approach", "features": [{"j": j} for j in range(900)]}]
_C._write_json_atomic(path, payloads[0])
errors, torn, reads = [], [], [0]
stop = threading.Event()


def writer(k):
    for _ in range(150):
        try:
            _C._write_json_atomic(path, payloads[k])
        except Exception as e:
            errors.append(e)


def reader():
    while not stop.is_set():
        try:
            with open(path, "r", encoding="utf-8") as f:
                txt = f.read()
            json.loads(txt)
            reads[0] += 1
        except PermissionError:                   # Windows: the file is being replaced this instant - not a torn read
            pass
        except FileNotFoundError:
            torn.append("the cache was missing")
        except ValueError:
            torn.append("read %d bytes that were not whole JSON" % len(txt))


rt = threading.Thread(target=reader)
rt.start()
ws = [threading.Thread(target=writer, args=(k,)) for k in (0, 1)]
for w in ws:
    w.start()
for w in ws:
    w.join()
stop.set()
rt.join()
final = json.load(open(path, encoding="utf-8"))
leftovers = [f for f in os.listdir(TMP) if ".part" in f]
not_refusals = [e for e in errors if not isinstance(e, PermissionError)]
# ⚠ A WRITE MAY STILL BE REFUSED, and this suite measured it: with a reader looping on the file, a few writes in a
# few hundred ran out of replace retries (Windows refuses a replace while any reader holds the file). That is a
# cache that was not refreshed this time, and _cache_json lets it go (4b). What must NEVER happen is what one shared
# temp name did: a writer failing because the other had moved its temp (FileNotFoundError), a temp written by two
# writers at once, or a reader finding a cache that is not whole.
check("1. two threads writing one cache 150 times each, with a third reading it throughout: no read ever finds a torn "
      "or missing file, no write fails for any reason but a replace refused while the reader held the file, the cache "
      "ends as one writer's whole payload, and no temp file is left",
      lambda: not torn and not not_refusals and len(errors) < 60 and final in payloads and not leftovers and reads[0] > 0,
      lambda: "%d writes refused while read, %d other write errors %s; %d torn reads %s; %d whole reads; leftovers %s"
              % (len(errors) - len(not_refusals), len(not_refusals), [repr(e)[:80] for e in not_refusals[:1]],
                 len(torn), torn[:1], reads[0], leftovers))

# 2. an interrupted write
good = {"_ts": 1.0, "stations": [{"id": "PSBM1", "lat": 44.9, "lon": -66.98}]}
path2 = os.path.join(TMP, "ndbc_like.json")
_C._write_json_atomic(path2, good)
before2 = open(path2, "rb").read()
real_dump = _C.json.dump


def dump_half(obj, f, *a, **k):
    f.write(json.dumps(obj)[:10])
    raise OSError("the disk went away half way")


_C.json.dump = dump_half
try:
    try:
        _C._write_json_atomic(path2, {"stations": ["new"]})
        raised2 = None
    except OSError as e:
        raised2 = e
finally:
    _C.json.dump = real_dump
after2 = open(path2, "rb").read()
check("2. a write interrupted part way raises, leaves the cache that was there byte for byte, and leaves no temp file",
      lambda: raised2 is not None and after2 == before2 and not [f for f in os.listdir(TMP) if ".part" in f],
      lambda: "raised %r; cache %s" % (raised2, "unchanged" if after2 == before2 else "CHANGED: %r" % after2[:40]))

# 3-4. the two station lists, driven
XML = ('<stations><station id="psbm1" lat="44.904" lon="-66.985" name="Eastport"/>'
       '<station id="44027" lat="44.273" lon="-67.300"/></stations>')
_C.NDBC_STATIONS_CACHE = os.path.join(TMP, "ndbc_stations.json")
with open(_C.NDBC_STATIONS_CACHE, "w", encoding="utf-8") as f:
    json.dump({"_ts": 0, "stations": []}, f)       # a week old: fetched again
_C._env_http_get = lambda url, timeout=15.0: XML
replaced = []
real_replace = _C._replace_retrying
_C._replace_retrying = lambda tmp, dst: (replaced.append((tmp, dst)), real_replace(tmp, dst))[1]
stations = _C._load_ndbc_stations()
ndbc_file = json.load(open(_C.NDBC_STATIONS_CACHE, encoding="utf-8"))
ndbc_writes = [r for r in replaced if r[1] == _C.NDBC_STATIONS_CACHE]
check("3. the NDBC station list is written through a temp file of its own and a replace - never straight over the "
      "old file - and reads back whole",
      lambda: [s["id"] for s in stations] == ["PSBM1", "44027"] and len(ndbc_writes) == 1
      and ndbc_writes[0][0] != _C.NDBC_STATIONS_CACHE and ".part" in ndbc_writes[0][0]
      and [s["id"] for s in ndbc_file["stations"]] == ["PSBM1", "44027"],
      lambda: "stations %s; replaces %s" % ([s["id"] for s in stations], [os.path.basename(t) for t, _ in ndbc_writes]))


class _Resp:
    def __init__(self, body):
        self.body = body

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


_C.WATER_STATIONS_CACHE = os.path.join(TMP, "coops_stations.json")
_C._water_stations = None
coops = json.dumps({"stations": [{"id": "8410140", "name": "Eastport", "lat": 44.9046, "lng": -66.9829}]}).encode()
_C.urllib.request.urlopen = lambda req, timeout=None: _Resp(coops)
replaced.clear()
water = _C._load_water_stations()
water_writes = [r for r in replaced if r[1] == _C.WATER_STATIONS_CACHE]
two_writers = "%s.%d.%d.part" % (_C.WATER_STATIONS_CACHE, os.getpid(), threading.get_ident())
check("4. the water-station list is written the same way, with a temp name that carries the writer's process and "
      "thread - so a second writer of the same list has a temp of its own",
      lambda: [w["id"] for w in water] == ["8410140"] and len(water_writes) == 1 and water_writes[0][0] == two_writers,
      lambda: "stations %s; temp %s" % ([w["id"] for w in water], [os.path.basename(t) for t, _ in water_writes]))

# 4b. a cache that could not be written costs the cache, not the data
real_atomic = _C._write_json_atomic


def refused(path, obj):
    raise PermissionError(13, "Access is denied - a reader holds the file", path)


def attempt(fn):
    """(result, None) or (None, the exception) - a loader that raises here is a FAILED check, not a crashed run."""
    try:
        return fn(), None
    except Exception as e:
        return None, e


_C._write_json_atomic = refused
try:
    _C._water_stations = None
    os.remove(_C.WATER_STATIONS_CACHE)
    water_refused, water_err = attempt(_C._load_water_stations)
    with open(_C.NDBC_STATIONS_CACHE, "w", encoding="utf-8") as f:
        json.dump({"_ts": 0, "stations": []}, f)
    ndbc_refused, ndbc_err = attempt(_C._load_ndbc_stations)
finally:
    _C._write_json_atomic = real_atomic
ids = lambda rows, k: [r[k] for r in rows] if rows else rows  # noqa: E731
check("4b. a cache write the disk refuses costs only the cache: the station lists still come back with what was just "
      "fetched, and nothing is raised (the water list used to come back EMPTY)",
      lambda: water_err is None and ndbc_err is None and ids(water_refused, "id") == ["8410140"]
      and ids(ndbc_refused, "id") == ["PSBM1", "44027"],
      lambda: "water %s%s; ndbc %s%s" % (ids(water_refused, "id"), " RAISED %r" % water_err if water_err else "",
                                         ids(ndbc_refused, "id"), " RAISED %r" % ndbc_err if ndbc_err else ""))

# 5. the ENC writers, read
SRC = open(os.path.join(APP, "asv_console.py"), encoding="utf-8").read()
TREE = ast.parse(SRC)
funcs = {n.name: n for n in ast.walk(TREE) if isinstance(n, ast.FunctionDef)}
report = {}
for name in ("_enc_layer_map", "fetch_enc_features", "fetch_chart_info", "_load_water_stations", "_load_ndbc_stations"):
    node = funcs.get(name)
    calls = [c for c in ast.walk(node) if isinstance(c, ast.Call)] if node else []
    cached = any(isinstance(c.func, ast.Name) and c.func.id == "_cache_json" for c in calls)
    raw = [c for c in calls if isinstance(c.func, ast.Name) and c.func.id in ("_write_json_atomic", "_replace_retrying")
           or isinstance(c.func, ast.Attribute) and c.func.attr == "replace"]
    writes_open = [c for c in calls if isinstance(c.func, ast.Name) and c.func.id == "open" and len(c.args) > 1
                   and isinstance(c.args[1], ast.Constant) and any(m in str(c.args[1].value) for m in "wax")]
    fixed_part = [s for s in ast.walk(node) if isinstance(s, ast.Constant) and s.value == ".part"] if node else ["missing"]
    report[name] = (cached, len(raw), len(writes_open), len(fixed_part))
check("5. every cache writer named in the finding - the ENC layer map, extract and metadata, and both station lists - "
      "writes through _cache_json and nothing else: no write of its own, no replace, no fixed '.part'",
      lambda: all(v == (True, 0, 0, 0) for v in report.values()),
      lambda: "; ".join("%s: _cache_json %s, raw writes %d, opens %d, fixed .part %d" % (k, *v) for k, v in report.items()))

# 6. the port registry and the comms config, with a reader holding the file (the 2026-10-16 review, finding 26)
_C.PORTS_PATH = os.path.join(TMP, "ports.json")
_C.COMMS_CONFIG_PATH = os.path.join(TMP, "comms_config.json")
_C.PORTS = {"active": "x", "ports": [{"id": "x", "name": "X"}]}
_C.save_ports()
_C._save_comms_config("ubnt", "10.0.0.0", "ubnt")
_hold_stop = threading.Event()


def _holder(path):
    while not _hold_stop.is_set():
        try:
            with open(path, "rb") as fh:
                fh.read()
        except OSError:
            pass
        time.sleep(0.001)                      # a reader that lets go between reads, as the page does


_holders = [threading.Thread(target=_holder, args=(p,), daemon=True) for p in (_C.PORTS_PATH, _C.COMMS_CONFIG_PATH)]
for t in _holders:
    t.start()
oks6, errs6 = [], []
for i in range(40):
    oks6.append(_C.save_ports())
    try:
        _C._save_comms_config("ubnt", "10.0.0.%d" % (i + 1), "ubnt")
    except OSError as e:
        errs6.append(e)
_hold_stop.set()
for t in _holders:
    t.join(2.0)
ports6 = json.load(open(_C.PORTS_PATH, encoding="utf-8"))
comms6 = json.load(open(_C.COMMS_CONFIG_PATH, encoding="utf-8"))
left6 = [f for f in os.listdir(TMP) if f.startswith(("ports.json.", "comms_config.json."))]
check("6. THE PORT REGISTRY AND THE COMMS CONFIG are written through a temp of their own and a RETRIED replace: forty saves "
      "of each with a reader holding the file, every one lands (the mission store measured 2,460 refusals in 10 s with one "
      "reader; these retried nothing), the last value on disk, no temp file left",
      lambda: all(oks6) and not errs6 and ports6["active"] == "x" and comms6["host"] == "10.0.0.40" and left6 == [],
      lambda: "ports saved %d/40; comms errors %d; on disk %s / %s; left %s"
      % (sum(1 for o in oks6 if o), len(errs6), ports6.get("active"), comms6.get("host"), left6))

# 7. a session log that cannot be written says so once and stops (finding 27)
import contextlib                                                      # noqa: E402
import io                                                              # noqa: E402


class _FullDisk(io.StringIO):
    def write(self, s):
        raise OSError(28, "No space left on device")


_lg = _C.SessionLogger(enabled=True, log_dir=os.path.join(TMP, "logs"))
_was_on = _lg.enabled and _lg._f is not None
_lg._f.close()
_lg._f = _FullDisk()
_err = io.StringIO()
with contextlib.redirect_stderr(_err):
    _lg.event("one")
    _lg.event("two")
    _lg.event("three")
_said = [ln for ln in _err.getvalue().splitlines() if "[log]" in ln]
check("7. A SESSION LOG THAT CANNOT BE WRITTEN (the disk full) SAYS SO ONCE and stops recording - it swallowed every OSError "
      "for ever, the state still saying it was recording",
      lambda: _was_on and _lg.enabled is False and len(_said) == 1 and "recording stopped" in _said[0],
      lambda: "was on %s; enabled now %s; said %d time(s): %s" % (_was_on, _lg.enabled, len(_said), _said[:1]))

# 8. the temp files a killed process left are swept at startup, the live ones kept (finding 28)
_sw = os.path.join(TMP, "sweep")
os.makedirs(os.path.join(_sw, "enc"), exist_ok=True)
_old_t = time.time() - 2 * 3600


def _plant(rel, old):
    p = os.path.join(_sw, rel)
    with open(p, "w") as fh:
        fh.write("x")
    if old:
        os.utime(p, (_old_t, _old_t))
    return p


_gone_expected = [_plant("mission.json.1234.5678.part", True), _plant("enc/tile_v3_t.jsonl.12.34.build", True),
                  _plant("ports.json.tmp", True), _plant("comms_config.json.part", True),
                  _plant("enc/asv_x.jsonl.9.9.gz.part", True), _plant("enc/water_v1.json.part.77", True)]
_kept_expected = [_plant("mission.json.9.9.part", False), _plant("enc/tile_v3_t.jsonl", True),
                  _plant("enc/features_v5.json", True), _plant("notes.part", True)]
_gone = _C._sweep_leftovers([(_sw, True)], min_age_s=3600.0)
check("8. THE TEMP FILES A KILLED PROCESS LEFT - <file>.<pid>.<tid>.part and .build, .part.<tid>, .gz.part, the old "
      "comms_config.json.part and ports.json.tmp - older than an hour are swept at startup; a fresh temp (another "
      "console's live write), the real files and a name that only ends in .part are kept",
      lambda: sorted(map(os.path.normpath, _gone)) == sorted(map(os.path.normpath, _gone_expected))
      and not any(os.path.exists(p) for p in _gone_expected)
      and all(os.path.exists(p) for p in _kept_expected),
      lambda: "gone %s; kept %s" % (sorted(os.path.basename(p) for p in _gone),
                                    [os.path.basename(p) for p in _kept_expected if os.path.exists(p)]))

print("\n" + ("%d CHECK(S) FAILED (%d ran)" % (fails, ran) if fails else "all checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
