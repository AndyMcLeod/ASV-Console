"""tests/storage_watch.py - the console says what it keeps on disk and warns when a drive runs low, and removes nothing
(review #24, 2026-09-15).

Andy: "Logs and caches grow without limit. `logs/` is 471 MB across 190 files, and `charts/` is 4.4 GB." His session
logs are records he analyzes, so what to keep was his call, not a default. The console MEASURES: logs/ and charts/ (on
disk, and the content in them), how much of the log is older than STORAGE_OLD_DAYS, and the room left on each drive it
writes to; it prints that at start and whenever a drive goes low or recovers, puts it in the state, and the page raises
a banner when a drive runs low (tests/storage_banner.js).
⚠ THE MEASUREMENT ITSELF STILL TOUCHES NOTHING (check 9). Shown the figures he answered "1. Compress logs over 30 days.
2. Do not limit chart cache size", so recordings over STORAGE_OLD_DAYS are compressed in place - that is the console's
only retention, it lives in compress_old_logs, and tests/log_compress.py guards it. What this suite holds about it is
that the report and the state SAY which of the two is in force (checks 5, 5b): a readout claiming a policy the console
does not have is worse than no readout.
⚠ ON DISK, NOT JUST CONTENT: Andy's D: has 256 KB allocation units, so charts/ holds 861 MB of tiles and occupies 4.6 GB -
his "4.4 GB" can only have been the size on disk. A content-only readout would have contradicted what he measured.

A folder that is a link or junction is measured, priced and named by the drive it leads to, and a link inside a folder
is not walked (checks 10-12).

DRIVEN: the console's own _tree_size, _cluster_bytes, StorageWatch (measure, snapshot, report, check_once) and
Engine.state, in-process, on temp folders - and read by AST for the one property that has to hold by construction:
nothing in it removes anything.

    python tests/storage_watch.py      # exit 0 = pass, 1 = fail   (stdlib only)

TEETH - 15 mutations RUN in a scratch clone (sidecar original, atomic writes, no bytecode, byte-compared afterwards),
15/15 caught - the last two are the retention readout, with tests/log_compress.py:
    the report claims the compression whatever the console does -> 5b
    the state does not say which policy is in force -> 5, 5b
    content only, no allocation units -> 1, 6            the old log not split off -> 1, 3
    an unreadable folder raises -> 2                     never low -> 5, 7
    the report forgets that nothing is removed -> 5      the allocation units go unexplained -> 6
    reported on every check -> 7                         the state leaves it out -> 8
    started at import -> 8                               the old logs deleted while measuring -> 3, 4, 9, 10
    a junction inside the tree walked (the old code) -> 10
    a linked folder priced by its own letter -> 11, 12   a use named by the link's letter (the old code) -> 12
⚠ CHECKS 10-12 CAME FROM THE LIVE CHECK, NOT FROM THE FIRST DRAFT. The test console's charts/ was a junction on C: leading
to the chart cache on D:, and its storage line read "charts 897 MB on disk ... 422.6 GB free on C:" - the free space was
D:'s under C:'s name, and the tiles were priced at C:'s 4 KB allocation unit when they occupy 4.6 GB of D:. The walk
that claimed not to follow links followed a junction: on Python 3.11 is_dir(follow_symlinks=False) is True for one and
is_symlink() is False.
"""

import ast
import hashlib
import importlib.util as _ilu
import io
import os
import sys
import time
from contextlib import redirect_stderr, redirect_stdout


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

_spec = _ilu.spec_from_file_location("asv_console_storage_watch", os.path.join(APP, "asv_console.py"))
_C = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_C)
STATE = ConsoleState(prefix="asv_storage_watch_")
_C.use_state_dir(STATE.dir)

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


print("The console says what it keeps on disk, and warns when a drive runs low:")

ROOT = STATE.path("storage")
LOGS, CHARTS = os.path.join(ROOT, "logs"), os.path.join(ROOT, "charts")
for d in (LOGS, os.path.join(CHARTS, "17", "3"), os.path.join(CHARTS, "enc")):
    os.makedirs(d, exist_ok=True)
NOW = time.time()
files = {  # path: (bytes, age in days)
    os.path.join(LOGS, "asv_20260701-000000.jsonl"): (300000, 60),
    os.path.join(LOGS, "asv_20260801-000000.jsonl"): (200000, 45),
    os.path.join(LOGS, "asv_20260910-000000.jsonl"): (100000, 5),
    os.path.join(CHARTS, "17", "3", "5.png"): (2000, 1),
    os.path.join(CHARTS, "17", "3", "6.png"): (3000, 1),
    os.path.join(CHARTS, "enc", "features_v5_x.json"): (50000, 2),
}
for p, (size, age) in files.items():
    with open(p, "wb") as f:
        f.write(b"x" * size)
    os.utime(p, (NOW - age * 86400, NOW - age * 86400))
_C.LOG_DIR, _C.CHART_DIR = LOGS, CHARTS
cluster = _C._cluster_bytes(ROOT)
occupies = lambda n: (-(-n // cluster) * cluster) if cluster else n  # noqa: E731


def fingerprint(root):
    out = {}
    for dp, _, fns in os.walk(root):
        for fn in fns:
            p = os.path.join(dp, fn)
            st = os.stat(p)
            out[p] = (st.st_size, st.st_mtime_ns, hashlib.md5(open(p, "rb").read()).hexdigest())
    return out


# 1. the walk
t_logs = _C._tree_size(LOGS, NOW - 30 * 86400)
t_charts = _C._tree_size(CHARTS)
check("1. the walk counts what each folder holds and what it occupies - on this drive's allocation units - and splits "
      "off the log older than the cut",
      lambda: t_logs["bytes"] == 600000 and t_logs["files"] == 3 and t_logs["old_bytes"] == 500000 and t_logs["old_files"] == 2
      and t_charts["bytes"] == 55000 and t_charts["files"] == 3 and (cluster is None or (
          t_logs["disk"] == sum(occupies(s) for p, (s, a) in files.items() if p.startswith(LOGS))
          and t_charts["disk"] == sum(occupies(s) for p, (s, a) in files.items() if p.startswith(CHARTS)))),
      lambda: "logs %s; charts %s; allocation unit %s" % (t_logs, t_charts, cluster))

# 2. what it cannot read, it skips
real_scandir = _C.os.scandir


def refusing_scandir(path):
    if os.path.basename(str(path)) == "enc":
        raise PermissionError(13, "Access is denied", str(path))
    return real_scandir(path)


_C.os.scandir = refusing_scandir
try:
    t_refused = _C._tree_size(CHARTS)
    refused_err = None
except Exception as e:
    t_refused, refused_err = None, e
finally:
    _C.os.scandir = real_scandir
check("2. a folder it cannot read is skipped, not raised - the rest is still counted",
      lambda: refused_err is None and t_refused["files"] == 2 and t_refused["bytes"] == 5000,
      lambda: "raised %r" % refused_err if refused_err else "counted %d files, %d bytes" % (t_refused["files"], t_refused["bytes"]))

# 3-4. the measurement, and the drive
before = fingerprint(ROOT)
snap = _C.STORAGE.measure()
after = fingerprint(ROOT)
check("3. a measurement publishes both folders (on disk and content), the log older than the cut, and the room left on "
      "the drive the plan, the session log and the chart cache write to - and it is not low",
      lambda: snap["ok"] and snap["logs_files"] == 3 and snap["logs_old_files"] == 2 and snap["charts_files"] == 3
      and abs(snap["logs_content_mb"] - 600000 / 1048576.0) < 0.06 and snap["logs_mb"] >= snap["logs_content_mb"]
      and snap["free_mb"] and snap["free_mb"] > 0 and len(snap["free_uses"]) == 3 and snap["low"] is False,
      lambda: {k: snap[k] for k in ("logs_mb", "logs_content_mb", "logs_files", "logs_old_mb", "charts_mb", "charts_files",
                                    "free_mb", "free_drive", "free_uses", "low")})
check("4. measuring changes nothing: every file is where it was, the same size, the same time, the same bytes",
      lambda: before == after and len(after) == len(files), lambda: "%d files before, %d after, identical %s" % (
          len(before), len(after), before == after))

# 5. low
real_usage = _C.shutil.disk_usage
_C.shutil.disk_usage = lambda p: type("U", (), {"total": 128 * 1024 ** 3, "used": 127 * 1024 ** 3, "free": 1024 ** 3})()
try:
    low = _C.STORAGE.measure()
    low_line = _C.STORAGE.report(low)
finally:
    _C.shutil.disk_usage = real_usage
check("5. with less than STORAGE_LOW_MB free it is LOW, and the report says which writes are there and what the console "
      "does about it - compress the old recordings (his decision), delete nothing",
      lambda: low["low"] is True and round(low["free_mb"]) == 1024 and "LOW" in low_line
      and "recordings over 30 days are compressed, but nothing is deleted" in low_line
      and "the session log" in low_line,
      lambda: low_line)
_C.LOG_COMPRESS = False                                    # --no-log-compress: it must not claim what it no longer does
try:
    off = _C.STORAGE.measure()
    off_line = _C.STORAGE.report(dict(off, low=True, free_uses=["the session log"], free_mb=1024.0))
finally:
    _C.LOG_COMPRESS = True
check("5b. ... and with --no-log-compress it says the other thing, because then nothing is touched at all",
      lambda: off["log_compress"] is False and "nothing is removed automatically" in off_line
      and "compressed" not in off_line.split(" - LOW:")[1],
      lambda: off_line.split(" - LOW:")[-1].strip())

# 6. the report explains the gap between content and occupied - on a tile cache like Andy's: 300 small tiles on a drive
#    with 256 KB allocation units occupy ~77 MB for 30 KB of content
TILES = os.path.join(ROOT, "tiles_like_his")
os.makedirs(os.path.join(TILES, "17", "4"), exist_ok=True)
for i in range(300):
    with open(os.path.join(TILES, "17", "4", "%d.png" % i), "wb") as f:
        f.write(b"t" * 100)
real_cluster = _C._cluster_bytes
_C._cluster_bytes = lambda path: 262144
_C.CHART_DIR = TILES
try:
    big = _C.STORAGE.measure()
    big_line = _C.STORAGE.report(big)
finally:
    _C._cluster_bytes = real_cluster
    _C.CHART_DIR = CHARTS
check("6. when the drive's allocation units make a folder occupy twice its content or more, the report says so in its "
      "own terms - so its number matches a folder size the operator measures",
      lambda: "on disk" in big_line and "of content" in big_line and "256 KB allocation unit" in big_line
      and big["cluster_kb"] == 256,
      lambda: big_line)

# 7. said at start, and again only on a change - and logged on a change
events = []
_C.LOG = type("L", (), {"event": lambda self, kind, **kw: events.append(kind), "__getattr__": lambda self, n: (lambda *a, **k: None)})()
w = _C.StorageWatch()
out, err = io.StringIO(), io.StringIO()
with redirect_stdout(out), redirect_stderr(err):
    w.check_once()                                     # first: said
    w.check_once()                                     # unchanged: quiet
    _C.shutil.disk_usage = lambda p: type("U", (), {"total": 10 ** 11, "used": 10 ** 11 - 10 ** 8, "free": 10 ** 8})()
    try:
        w.check_once()                                 # low: said, logged
        w.check_once()                                 # still low: quiet
    finally:
        _C.shutil.disk_usage = real_usage
    w.check_once()                                     # recovered: said, logged
said = [l for l in (out.getvalue() + err.getvalue()).splitlines() if l.startswith("[storage]")]
check("7. the watch reports at its first measurement and then only when a drive goes low or recovers - once each - and "
      "logs the change",
      lambda: len(said) == 3 and "LOW" in err.getvalue() and events == ["storage_low", "storage_ok"],
      lambda: "%d report lines; events %s" % (len(said), events))

# 8. in the state, and started by main
st = _C.Engine().state()
tree = ast.parse(open(os.path.join(APP, "asv_console.py"), encoding="utf-8").read())
main = next(n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef) and n.name == "main")
starts = [c for c in ast.walk(main) if isinstance(c, ast.Call) and isinstance(c.func, ast.Attribute)
          and c.func.attr == "start" and isinstance(c.func.value, ast.Name) and c.func.value.id == "STORAGE"]
check("8. the state carries the measurement with its age, and main() starts the watch - not the import, which dozens of "
      "suites do",
      lambda: "storage" in st and st["storage"].get("ok") and "age_s" in st["storage"] and len(starts) == 1
      and _C.STORAGE._thread is None,
      lambda: "storage in state: %s; STORAGE.start() in main: %d; a thread at import: %s"
              % (sorted(st.get("storage", {}))[:6], len(starts), _C.STORAGE._thread is not None))

# 9. by construction
removers = {"remove", "unlink", "rmdir", "rmtree", "removedirs", "truncate"}
found = []
for node in ast.walk(tree):
    if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in ("_tree_size", "_cluster_bytes", "StorageWatch"):
        for c in ast.walk(node):
            if isinstance(c, ast.Call):
                name = getattr(c.func, "attr", getattr(c.func, "id", ""))
                if name in removers or (name == "open" and any(isinstance(a, ast.Constant) and isinstance(a.value, str)
                                                                and any(m in a.value for m in "wax+") for a in c.args[1:2])):
                    found.append("%s in %s" % (name, node.name))
check("9. nothing in the MEASUREMENT can remove or rewrite a file: no remove, unlink, rmdir, rmtree or truncate, and no "
      "file opened for writing - the one thing that takes a file away is the log compression Andy asked for, which is "
      "not in here and is guarded by tests/log_compress.py",
      lambda: not found, lambda: "found: %s" % (", ".join(found) or "none"))


# 10-12. links. Found in the live check: a charts/ JUNCTION on C: leading to D:\Claude\ASV\charts was reported on "C:" and
#        priced at C:'s 4 KB allocation unit - 897 MB on disk, for a folder that occupies 4.6 GB of D:.
def make_link(target, link):
    if os.name == "nt":
        import _winapi                     # a junction: what a Windows user makes, and it needs no privilege
        _winapi.CreateJunction(target, link)
    else:
        os.symlink(target, link, target_is_directory=True)


ELSEWHERE = STATE.path("storage_elsewhere")                 # beside the measured folders, not under them
os.makedirs(ELSEWHERE, exist_ok=True)
with open(os.path.join(ELSEWHERE, "not_a_log.bin"), "wb") as f:
    f.write(b"e" * 7000)
INNER, OUTER = os.path.join(LOGS, "linked_in"), STATE.path("charts_by_link")
links, asked = [], []
try:
    make_link(ELSEWHERE, INNER)
    links.append(INNER)
    t_inner = _C._tree_size(LOGS, NOW - 30 * 86400)
    make_link(CHARTS, OUTER)
    links.append(OUTER)
    _C._cluster_bytes = lambda path: asked.append(path) or real_cluster(path)
    try:
        t_outer = _C._tree_size(OUTER)
    finally:
        _C._cluster_bytes = real_cluster
finally:
    for link in links:
        os.rmdir(link)                                      # the link alone - never what it leads to
check("10. a link or junction INSIDE a folder is not walked - what it leads to is not counted as the folder's own "
      "(is_dir(follow_symlinks=False) is True for a Windows junction)",
      lambda: t_inner["files"] == 3 and t_inner["bytes"] == 600000,
      lambda: "logs/ with a junction inside it: %d files, %d bytes (its own: 3 files, 600000 bytes)"
              % (t_inner["files"], t_inner["bytes"]))
check("11. a folder that IS a link is measured where it leads, and priced by the allocation unit of the drive it leads to",
      lambda: t_outer["files"] == 3 and t_outer["bytes"] == 55000 and asked == [os.path.realpath(CHARTS)],
      lambda: "%d files, %d bytes; the allocation unit asked of %s" % (t_outer["files"], t_outer["bytes"], asked))

# 12. ... and reported on the drive it leads to. One volume cannot show a link's letter differing from its target's, so
#     the link is MODELLED: the chart cache sits on a drive letter this machine does not have and resolves to the real
#     folder. (GetLogicalDrives, so no drive is probed - an empty card slot can stall.)
letter = None
if os.name == "nt":
    import ctypes
    _mask = ctypes.windll.kernel32.GetLogicalDrives()
    letter = next((L for i, L in enumerate("ABCDEFGHIJKLMNOPQRSTUVWXYZ") if i >= 16 and not _mask & (1 << i)), None)
fake = (letter + ":\\charts_by_link") if letter else None
real_realpath = _C.os.path.realpath
_C.os.path.realpath = lambda p, *a, **k: real_realpath(CHARTS) if fake and str(p) == fake else real_realpath(p, *a, **k)
_C.CHART_DIR = fake or CHARTS
try:
    linked = _C.STORAGE.measure()
finally:
    _C.os.path.realpath = real_realpath
    _C.CHART_DIR = CHARTS
check("12. a use is reported on the drive its files are ON - not the letter of the link that leads to them",
      lambda: fake is None or (linked["charts_files"] == 3 and "the chart cache" in linked["free_uses"]
                               and linked["free_drive"] == os.path.splitdrive(real_realpath(CHARTS))[0]),
      lambda: "no unused drive letter to model a link with" if fake is None else "charts by way of %s: %d files; %s MB free on "
              "%s for %s" % (fake, linked["charts_files"], linked["free_mb"], linked["free_drive"], linked["free_uses"]))

print("\n" + ("%d CHECK(S) FAILED (%d ran)" % (fails, ran) if fails else "all checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
