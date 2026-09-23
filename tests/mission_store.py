"""tests/mission_store.py - the plan file survives concurrency, corruption and speed commands.

Review item #5, 2026-09-14. Three facts, each measured before this suite was written:

  * On Windows a READER holding mission.json open makes os.replace fail with
    "[WinError 5] Access is denied: 'mission.json.part' -> 'mission.json'" - 2460 failures to
    112 successes in 10 s with one reader thread. That is the open-list 500 on /api/cmd/speed.
  * A read that lands DURING a replace raises PermissionError (34 times in 10 s), and
    load_mission answered every OSError and ValueError with an EMPTY plan - a GET-style reader
    got an empty plan 36 times in 10 s while the full plan sat on disk.
  * Engine.set_speed loaded, edited and saved the whole plan - and saved BEFORE commanding the
    boat, so a failed save also lost the command. Over HTTP, a speed command fired together with
    a Go-To failed 1 time in 60 and never reached the vessel; the guard's helm rung sends exactly
    that pair.

THE RULES:
  * Only a MISSING file is "no plan". A locked file is retried and then refused; a file that is
    not JSON is copied aside and refused. Never an empty plan standing in for one that is there.
  * Reads take the writer's lock; the replace is retried; the temp file is per writer.
  * A save that changes the plan's GEOMETRY keeps the previous plan in mission.json.bak1..N.
  * A speed command commands the boat and writes nothing: the commanded speed is the vessel's,
    and a Go-To takes it from the vessel, not from the file.

  python tests/mission_store.py      # exit 0 = pass, 1 = fail   (stdlib only)

REVIEW #10 (11-14): a body that is not a plan is refused, an edit to an older revision is refused,
and every POST route answers. TEETH - 10 mutations RUN in a scratch clone, 10 killed, no crash:
  the plan body not checked -> 11, 13     waypoint positions not checked -> 11
  an explicitly empty plan refused -> 9, 11b     the revision compare removed -> 12, 13
  the revision not bumped -> 12, 13     load_mission drops the revision -> 12, 13
  the POST catch-all removed -> 14     a conflict answered as a refusal -> 13
  a LOCKED file read as 'no plan' by the revision check -> 12b
  End of Plan taken up from a save before its revision is checked -> 12 (a stale tab could change the
  setting the console runs by without writing a byte - found reading the code after the first 9)

⚠ AND CHECK 5 IS COUNTED, NOT TIMED, SINCE 2026-09-21. It used to run for a wall-clock 3 s
and require more than 50 saves and 50 reads in it, which measures the MACHINE, not the console.
On this box it landed on the boundary: three consecutive runs scored save_ok 34, 48 and 50
against a floor of "> 50", so it blocked a commit, passed a minute later, and blocked again. A
check that fails at random teaches everyone to re-run it. Each writer now does a fixed number
of saves and the readers run until both are done: the same contention, an exact save count, and
no assertion about disk speed. Still killed by "the read does not hold the writer lock", which
is the fault it was written for.

Everything runs against a TEMP mission path - the module's MISSION_PATH is re-pointed before
anything is read or written - and check 10 RECORDS every write, replace or remove that names the
app folder's plan files (review #16: a hash of mission.json compared before and after failed a commit
whenever the operator's own console saved meanwhile). Re-pointing removed -> 2, 3, 8, 9, 10.
"""
import builtins
import importlib.util as _ilu
import json
import os
import sys
import tempfile
import threading
import time


def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - "
          + " | ".join(traceback.format_exception_only(_t, _e)).strip())
    print("\n1 CHECK(S) FAILED (crashed before finishing)")
    sys.exit(1)


sys.excepthook = _crash_report

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)                          # asv_console's own imports resolve from the app
_spec = _ilu.spec_from_file_location("asv_console_under_test", os.path.join(APP, "asv_console.py"))
_C = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_C)

fails = 0


def check(name, cond, detail=""):
    global fails
    ok = False
    try:
        ok = bool(cond() if callable(cond) else cond)
    except Exception as e:                        # a check that raises is a failed check
        detail = "THREW %s: %s" % (type(e).__name__, e)
    print(("  ok   " if ok else "  FAIL ") + name + ("   [%s]" % detail if detail else ""))
    if not ok:
        fails += 1


REAL_MISSION = os.path.join(APP, "mission.json")
# 10's instrument: every write-mode open, replace or remove that names the app folder's own plan files
# (mission.json, its backups, corrupt copies and temp parts). NOT a hash of mission.json compared before
# and after: the operator's own console may save that file while this suite runs, and a hash check then
# fails a commit for a change no test made (review #16).
_WRITES_TO_APP = []
_open0, _replace0, _remove0 = builtins.open, os.replace, os.remove


def _names_app_plan(path):
    try:
        return os.path.abspath(os.fspath(path)).startswith(os.path.abspath(REAL_MISSION))
    except TypeError:                               # a file descriptor, not a path
        return False


def _recording_open(path, mode="r", *a, **k):
    if any(c in mode for c in "wax+") and _names_app_plan(path):
        _WRITES_TO_APP.append("open(%s, %r)" % (path, mode))
    return _open0(path, mode, *a, **k)


def _recording_replace(src, dst, *a, **k):
    if _names_app_plan(src) or _names_app_plan(dst):
        _WRITES_TO_APP.append("replace(%s -> %s)" % (src, dst))
    return _replace0(src, dst, *a, **k)


def _recording_remove(path, *a, **k):
    if _names_app_plan(path):
        _WRITES_TO_APP.append("remove(%s)" % path)
    return _remove0(path, *a, **k)


builtins.open, os.replace, os.remove = _recording_open, _recording_replace, _recording_remove
import atexit  # noqa: E402
import shutil  # noqa: E402
TMP = tempfile.mkdtemp(prefix="asv_mission_store_")
atexit.register(shutil.rmtree, TMP, True)  # a suite leaves no temp folder behind (review #27; tests/state_dir.py 1b)
_C.MISSION_PATH = os.path.join(TMP, "mission.json")
_C._MISSION_CACHE = None

PLAN = {"waypoints": [{"lat": 44.9 + i * 1e-4, "lon": -67.0} for i in range(385)],
        # the page's own line shape (review #10 checks it: {a, b}, not a bare pair)
        "lines": [{"a": {"lat": 44.9, "lon": -67.0}, "b": {"lat": 44.91, "lon": -67.01}}] * 9,
        "speeds": {"transit": "high", "turn": "low", "survey": "survey"}, "buffer_m": 3}

print("The plan file - concurrency, corruption and speed commands:")

# 1. No file is no plan - the one case that may answer with an empty one.
m = _C.load_mission()
check("1. with no file at all, the plan is empty - the one case an empty plan is the truth",
      m["waypoints"] == [] and m["lines"] == [], "waypoints=%d" % len(m["waypoints"]))

# 2-3. A file that is not JSON is refused and kept, never replaced by a guess.
BAD = b'{"waypoints": [{"lat": 44.9, "lon": -67.0}], "lines": [ ,,, truncated'
with open(_C.MISSION_PATH, "wb") as f:
    f.write(BAD)
refused = None
try:
    _C.load_mission()
except _C.MissionUnavailable as e:
    refused = str(e)
kept = [n for n in os.listdir(TMP) if n.startswith("mission.json.corrupt-")]
kept_bytes = open(os.path.join(TMP, kept[0]), "rb").read() if kept else b""
check("2. a plan file that is not JSON is REFUSED in words, and copied aside byte for byte",
      refused is not None and "not a valid plan" in refused and len(kept) == 1 and kept_bytes == BAD
      and open(_C.MISSION_PATH, "rb").read() == BAD,
      "refused=%r kept=%s" % ((refused or "")[:60], kept))
_C.save_mission(PLAN)
check("3. ... and a save after it replaces the file while the corrupt original stays kept",
      len(_C.load_mission()["waypoints"]) == 385
      and open(os.path.join(TMP, kept[0]), "rb").read() == BAD if kept else False,
      "waypoints now %d" % len(_C.load_mission()["waypoints"]))

# 4. A file that stays locked is refused after the retries - not answered with an empty plan.
_real_open = builtins.open


def _locked_open(path, *a, **k):
    if os.path.abspath(str(path)) == os.path.abspath(_C.MISSION_PATH):
        raise PermissionError(13, "The process cannot access the file (simulated sharing violation)")
    return _real_open(path, *a, **k)


builtins.open = _locked_open
t0 = time.time()
locked = None
try:
    try:
        _C.load_mission()
    except _C.MissionUnavailable as e:
        locked = str(e)
finally:
    builtins.open = _real_open
waited = time.time() - t0
check("4. a plan file that stays LOCKED is retried and then refused - never answered with an empty plan",
      locked is not None and "could not be read" in locked and waited >= 0.2,
      "refused after %.2f s: %r" % (waited, (locked or "")[:60]))

# 4b. A reader in ANOTHER process (a hash, an editor, antivirus) blocks the replace the lock cannot
#     see - so the replace is retried, not failed. Driven: the first two replaces are refused.
_real_replace = os.replace
refusals = {"n": 0}


def _blocked_replace(src, dst):
    if os.path.abspath(dst) == os.path.abspath(_C.MISSION_PATH) and refusals["n"] < 2:
        refusals["n"] += 1
        raise PermissionError(5, "Access is denied (simulated reader in another process)")
    return _real_replace(src, dst)


_C.os.replace = _blocked_replace
saved = None
try:
    try:
        _C.save_mission(dict(PLAN, buffer_m=11))
        saved = json.load(open(_C.MISSION_PATH, encoding="utf-8")).get("buffer_m")
    except OSError as e:
        saved = "RAISED %s" % e
finally:
    _C.os.replace = _real_replace
check("4b. a replace refused by a reader in another process is RETRIED, not failed",
      refusals["n"] == 2 and saved == 11,
      "refused %d time(s), then the file reads buffer_m=%s" % (refusals["n"], saved))

# 5. THE REPORTED FAULT, driven: writers and readers together, the way a speed command, a
#    Go-To and the page's plan save meet in the HTTP threads.
#
# COUNTED, NOT TIMED (2026-09-21). This used to run for a wall-clock 3 s and then require
# more than 50 saves and 50 reads to have happened in it - which is not a property of the
# console, it is a property of the machine it ran on. On this box it sits right on the
# boundary: three consecutive runs scored save_ok 34, 48 and 50 against a floor of "> 50",
# so it blocked a commit, passed on the next minute, and blocked again. A check that fails
# at random teaches everyone to re-run it, which is worse than not having it.
#
# The subject here is "no empty plan, no refused read, no failed save WHILE writers and
# readers overlap". So each writer now does a fixed number of saves and the readers run
# until both are done: the contention is guaranteed, the save count is exact, and nothing
# is asserted about how fast the disk is. A save that has become pathologically slow is
# caught by the hook's own per-suite timeout, which is the honest place for it.
SAVES_EACH = 40                       # 80 in all - more than the timed version ever reached
stats = {"empty": 0, "unavailable": 0, "read_ok": 0, "save_ok": 0, "save_err": 0}
stop = threading.Event()
lock = threading.Lock()


def _count(k):
    with lock:
        stats[k] += 1


def _writer(buf):
    doc = dict(PLAN, buffer_m=buf)
    for _ in range(SAVES_EACH):
        try:
            _C.save_mission(doc)
            _count("save_ok")
        except OSError:
            _count("save_err")


def _reader():
    while not stop.is_set():
        try:
            got = _C.load_mission()
            _count("empty" if not got["waypoints"] else "read_ok")
        except _C.MissionUnavailable:
            _count("unavailable")


writers = [threading.Thread(target=_writer, args=(b,)) for b in (3, 4)]
readers = [threading.Thread(target=_reader) for _ in range(2)]
[t.start() for t in writers + readers]
[t.join() for t in writers]
stop.set()                            # the readers stop once both writers have finished
[t.join() for t in readers]
final = _C.load_mission()
check("5. THE REPORTED FAULT: two writers and two readers overlapping - no empty plan, no "
      "refused read, no failed save",
      stats["empty"] == 0 and stats["unavailable"] == 0 and stats["save_err"] == 0
      and stats["save_ok"] == 2 * SAVES_EACH and stats["read_ok"] > 0
      and len(final["waypoints"]) == 385,
      json.dumps(stats) + "  - every save is counted, so save_ok is EXACT; read_ok is "
      "whatever the readers managed alongside them and is asserted only to be non-zero")

# 6-7. A speed command commands the boat and writes nothing; a Go-To takes the live speed.
_C.save_mission(PLAN)
before_bytes = open(_C.MISSION_PATH, "rb").read()
e = _C.Engine()
e._link = _C.SimVcu(44.9, -67.0)
e.armed = True
e.set_speed("low")
check("6. a speed command reaches the vessel and does NOT rewrite the plan file",
      e._link.speed_key == "low" and open(_C.MISSION_PATH, "rb").read() == before_bytes,
      "vessel speed_key=%s, file unchanged=%s" % (e._link.speed_key,
                                                  open(_C.MISSION_PATH, "rb").read() == before_bytes))
with open(_C.MISSION_PATH, "wb") as f:              # the file goes bad mid-run
    f.write(BAD)
went = None
try:
    e.go_to(44.901, -67.0)
    went = e.behavior
except Exception as ex:                             # a Go-To must not fail on a file read
    went = "RAISED %s: %s" % (type(ex).__name__, ex)
check("7. ... a Go-To flies the LIVE speed, and a plan file gone bad mid-run cannot fail it",
      went == "goto" and e._link.speed_key == "low",
      "behavior=%s speed_key=%s" % (went, e._link.speed_key))
_C.save_mission(PLAN)

# 8-9. The previous PLAN is kept on a geometry change - and only then.
for n in os.listdir(TMP):
    if ".bak" in n:
        os.remove(os.path.join(TMP, n))
_C.save_mission(dict(PLAN, buffer_m=7))             # settings only
settings_only = [n for n in os.listdir(TMP) if ".bak" in n]
plans = []
for k in range(1, _C.MISSION_BACKUPS + 3):          # more geometry changes than there are slots
    plans.append(dict(PLAN, waypoints=PLAN["waypoints"][:385 - k]))
    _C.save_mission(plans[-1])
baks = sorted(n for n in os.listdir(TMP) if ".bak" in n)
bak1 = json.load(open(os.path.join(TMP, "mission.json.bak1"), encoding="utf-8")) if baks else {}
check("8. a save that changes the plan keeps the previous plan in .bak1, and at most MISSION_BACKUPS",
      settings_only == [] and len(baks) == _C.MISSION_BACKUPS
      and len(bak1.get("waypoints") or []) == len(plans[-2]["waypoints"]),
      "settings-only save kept %s; %d geometry saves kept %s; bak1 holds %d waypoints"
      % (settings_only, len(plans), baks, len(bak1.get("waypoints") or [])))
for n in os.listdir(TMP):
    if ".bak" in n:
        os.remove(os.path.join(TMP, n))
_C.save_mission(PLAN)


def attempt(fn, *a):
    """(value, None) or (None, the exception) - so a mutation that raises where a value was expected
    fails the CHECK that asked, instead of crashing the suite before any check says so."""
    try:
        return fn(*a), None
    except Exception as e:                        # noqa: BLE001 - reported, never swallowed
        return None, e


_, wipe_err = attempt(_C.save_mission, {"waypoints": [], "lines": []})   # the plan wiped by an empty save...
wiped_kept = json.load(open(os.path.join(TMP, "mission.json.bak1"), encoding="utf-8")) \
    if os.path.exists(os.path.join(TMP, "mission.json.bak1")) else {}
for n in os.listdir(TMP):
    if ".bak" in n:
        os.remove(os.path.join(TMP, n))
_C.save_mission(PLAN)                               # ...and a plan saved over an empty one
check("9. an EMPTY save over a real plan keeps the real plan in .bak1 - and an empty previous plan "
      "takes no slot",
      wipe_err is None and len(wiped_kept.get("waypoints") or []) == 385
      and not [n for n in os.listdir(TMP) if ".bak" in n],
      "the empty save %s; bak1 after the wipe holds %d waypoints; backups after saving over empty: %s"
      % ("was refused: %s" % wipe_err if wipe_err else "was taken", len(wiped_kept.get("waypoints") or []),
         [n for n in os.listdir(TMP) if ".bak" in n]))

# 11-14. A BODY THAT IS NOT A PLAN IS REFUSED, AN EDIT TO AN OLDER REVISION IS REFUSED, AND EVERY
# ROUTE ANSWERS (review #10). POST /api/mission saved whatever arrived: an unreadable body came back
# from _read_json as {} and was written as an EMPTY plan; two pages that had loaded the same plan each
# autosaved over the other's edits; and an exception in any of the eight routes above the dispatcher's
# own try dropped the connection, unanswered and unlogged.
for n in os.listdir(TMP):
    if ".bak" in n:
        os.remove(os.path.join(TMP, n))
_C.save_mission(PLAN)
before = open(_C.MISSION_PATH, "rb").read()


def refused(body):
    """The refusal's words, or "" when the body was SAVED or raised anything but a refusal."""
    _, err = attempt(_C.save_mission, body)
    return str(err) if isinstance(err, _C.PlanRefused) else ""


def outcome(body):
    _, err = attempt(_C.save_mission, body)
    return "saved" if err is None else "%s: %s" % (type(err).__name__, err)


bad = {"no body": {}, "waypoints not a list": {"waypoints": "x"},
       "a waypoint that is not a position": {"waypoints": [{"lat": "abc", "lon": -67.0}]},
       "a latitude off the globe": {"waypoints": [{"lat": 95.0, "lon": -67.0}]},
       "a NaN longitude": {"waypoints": [{"lat": 44.9, "lon": float("nan")}]},
       "a line with one end missing": dict(PLAN, lines=[{"a": {"lat": 44.9, "lon": -67.0}}]),
       "a negative buffer": dict(PLAN, buffer_m=-1),
       "a revision that is not a number": dict(PLAN, rev="7")}
said = {k: refused(v) for k, v in bad.items()}
check("11. a body that is not a plan is REFUSED in words and nothing is written - no waypoints list, or a "
      "waypoint, line end, setting or revision that is not what it claims",
      all(said.values()) and open(_C.MISSION_PATH, "rb").read() == before,
      "; ".join("%s: %s" % (k, (v or "NOT REFUSED")[:40]) for k, v in said.items()))
cleared = outcome({"waypoints": [], "lines": []})
check("11b. ... while an explicitly EMPTY plan (CLR PLAN) is a real edit, and is saved",
      cleared == "saved" and _C.load_mission()["waypoints"] == [], cleared[:80])

_C.save_mission(PLAN)
r0 = _C.load_mission().get("rev")
r1, e1 = attempt(_C.save_mission, dict(PLAN, rev=r0, buffer_m=5))       # this page's edit, made to what it loaded
on_disk = open(_C.MISSION_PATH, "rb").read()
completion_before = _C.plan_completion()
# the OTHER page, still holding r0 - and changing End of Plan, which the console runs by
_, conflict = attempt(_C.save_mission, dict(PLAN, rev=r0, buffer_m=9, completion="complete"))
after_conflict = open(_C.MISSION_PATH, "rb").read()
completion_after = _C.plan_completion()
r_legacy, e3 = attempt(_C.save_mission, dict(PLAN, buffer_m=5))         # no revision: a script, a test, an older page
check("12. every save bumps the revision; an edit made to an OLDER revision is refused naming both, and "
      "nothing is written OR taken up - End of Plan stays what the file says; a save carrying no revision is "
      "written as before",
      isinstance(r0, int) and e1 is None and r1 == r0 + 1 and isinstance(conflict, _C.PlanConflict)
      and conflict.rev == r1 and ("revision %d" % r1) in str(conflict) and ("revision %d" % r0) in str(conflict)
      and after_conflict == on_disk and completion_after == completion_before == "rth"
      and e3 is None and r_legacy == r1 + 1 and _C.load_mission().get("rev") == r_legacy,
      "r0=%s r1=%s (%s) other page: %s; End of Plan %s -> %s; legacy=%s (%s)"
      % (r0, r1, e1, (str(conflict) if conflict else "SAVED")[:50], completion_before, completion_after,
         r_legacy, e3))

# 12b. A plan file LOCKED while its revision is read is not "no plan": the save is refused, not let
#      through unchecked. Only the plan file's reads are refused, the way a reader in another process
#      blocks them; the save's own temp file and the replace are left alone, so a check that skipped
#      the revision would write.
stale_now = max(0, (_C.load_mission().get("rev") or 0) - 1)
on_disk = open(_C.MISSION_PATH, "rb").read()
builtins.open = _locked_open
try:
    _, lock_err = attempt(_C.save_mission, dict(PLAN, rev=stale_now, buffer_m=13))
    locked_rev = "SAVED" if lock_err is None else "%s: %s" % (type(lock_err).__name__, lock_err)
finally:
    builtins.open = _real_open
check("12b. a plan file LOCKED while its revision is read refuses the save - it is not read as 'no plan' "
      "and let through unchecked",
      "could not be read to check its revision" in locked_rev and open(_C.MISSION_PATH, "rb").read() == on_disk,
      locked_rev[:90])

import socket                                       # noqa: E402  (the HTTP half only)
import urllib.error                                 # noqa: E402
import urllib.request                               # noqa: E402

_s = socket.socket()
_s.bind(("127.0.0.1", 0))
PORT = _s.getsockname()[1]
_s.close()
srv = _C.Server(("127.0.0.1", PORT), _C.Handler)          # the console's own handler, on the TEMP plan
threading.Thread(target=srv.serve_forever, daemon=True).start()


def post(path, raw):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (PORT, path), data=raw, method="POST",
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")
    except Exception as e:                            # no answer at all: the dropped connection
        return None, {"error": "no response (%s)" % e}


try:
    before = open(_C.MISSION_PATH, "rb").read()
    c_bad, _ = post("/api/mission", b'{"waypoints": [ ,,, not json')
    c_arr, _ = post("/api/mission", b"[1, 2, 3]")
    unchanged = open(_C.MISSION_PATH, "rb").read() == before
    got = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/api/mission" % PORT, timeout=10).read())
    g_rev = got.get("rev") if isinstance(got.get("rev"), int) else None
    # a plan was saved before this, so the revision on disk is at least 1 and one below it is a real stale edit
    c_stale, j_stale = post("/api/mission", json.dumps(dict(PLAN, rev=max(0, (g_rev or 1) - 1))).encode())
    c_ok, j_ok = post("/api/mission", json.dumps(dict(PLAN, rev=g_rev or 0)).encode())
    check("13. over HTTP: an unreadable or non-object body is a 400 that writes nothing; GET carries the "
          "revision; a stale edit is a 409 naming the revision on disk, the current one a 200 with the next",
          c_bad == 400 and c_arr == 400 and unchanged and isinstance(g_rev, int) and g_rev >= 1
          and c_stale == 409 and j_stale.get("rev") == g_rev and c_ok == 200 and j_ok.get("rev") == g_rev + 1,
          "unreadable %s, array %s, unchanged %s, GET rev %s, stale %s rev %s, current %s rev %s"
          % (c_bad, c_arr, unchanged, got.get("rev"), c_stale, j_stale.get("rev"), c_ok, j_ok.get("rev")))
    real_save = _C.save_mission
    _C.save_mission = lambda body: 1 / 0              # a fault in a route above the dispatcher's try
    try:
        c_boom, j_boom = post("/api/mission", json.dumps(PLAN).encode())
    finally:
        _C.save_mission = real_save
    check("14. a route above the dispatcher's own try that RAISES answers a 500 in words - it used to drop the "
          "connection, with no answer and nothing in the session log",
          c_boom == 500 and "ZeroDivisionError" in str(j_boom.get("error")),
          "code %s: %s" % (c_boom, str(j_boom.get("error"))[:80]))
finally:
    srv.shutdown()
    srv.server_close()

# 10. None of it touched the operator's own plan.
check("10. nothing in this suite wrote, replaced or removed the app directory's own plan files",
      not _WRITES_TO_APP, "; ".join(_WRITES_TO_APP[:3]) or "no write named them")

print("\n" + ("%d CHECK(S) FAILED" % fails if fails else "all checks passed"))
sys.exit(1 if fails else 0)
