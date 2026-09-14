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

Everything runs against a TEMP mission path - the module's MISSION_PATH is re-pointed before
anything is read or written, and the last check asserts the app directory's file was never
touched.
"""
import builtins
import hashlib
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


def _sha(path):
    try:
        with open(path, "rb") as f:
            return hashlib.sha256(f.read()).hexdigest()
    except OSError:
        return None


REAL_MISSION = os.path.join(APP, "mission.json")
REAL_BEFORE = _sha(REAL_MISSION)
TMP = tempfile.mkdtemp(prefix="asv_mission_store_")
_C.MISSION_PATH = os.path.join(TMP, "mission.json")
_C._MISSION_CACHE = None

PLAN = {"waypoints": [{"lat": 44.9 + i * 1e-4, "lon": -67.0} for i in range(385)],
        "lines": [[{"lat": 44.9, "lon": -67.0}, {"lat": 44.91, "lon": -67.01}]] * 9,
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
stats = {"empty": 0, "unavailable": 0, "read_ok": 0, "save_ok": 0, "save_err": 0}
stop = threading.Event()
lock = threading.Lock()


def _count(k):
    with lock:
        stats[k] += 1


def _writer(buf):
    doc = dict(PLAN, buffer_m=buf)
    while not stop.is_set():
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


threads = [threading.Thread(target=_writer, args=(b,)) for b in (3, 4)] + \
          [threading.Thread(target=_reader) for _ in range(2)]
[t.start() for t in threads]
time.sleep(3.0)
stop.set()
[t.join() for t in threads]
final = _C.load_mission()
check("5. THE REPORTED FAULT: two writers and two readers for 3 s - no empty plan, no refused read, "
      "no failed save",
      stats["empty"] == 0 and stats["unavailable"] == 0 and stats["save_err"] == 0
      and stats["save_ok"] > 50 and stats["read_ok"] > 50 and len(final["waypoints"]) == 385,
      json.dumps(stats))

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
_C.save_mission({"waypoints": [], "lines": []})     # the plan wiped by an empty save...
wiped_kept = json.load(open(os.path.join(TMP, "mission.json.bak1"), encoding="utf-8")) \
    if os.path.exists(os.path.join(TMP, "mission.json.bak1")) else {}
for n in os.listdir(TMP):
    if ".bak" in n:
        os.remove(os.path.join(TMP, n))
_C.save_mission(PLAN)                               # ...and a plan saved over an empty one
check("9. an EMPTY save over a real plan keeps the real plan in .bak1 - and an empty previous plan "
      "takes no slot",
      len(wiped_kept.get("waypoints") or []) == 385 and not [n for n in os.listdir(TMP) if ".bak" in n],
      "bak1 after the wipe holds %d waypoints; backups after saving over empty: %s"
      % (len(wiped_kept.get("waypoints") or []), [n for n in os.listdir(TMP) if ".bak" in n]))

# 10. None of it touched the operator's own plan.
check("10. the app directory's own mission.json was never touched",
      _sha(REAL_MISSION) == REAL_BEFORE, "sha before=%s after=%s" % ((REAL_BEFORE or "none")[:12],
                                                                    (_sha(REAL_MISSION) or "none")[:12]))

print("\n" + ("%d CHECK(S) FAILED" % fails if fails else "all checks passed"))
sys.exit(1 if fails else 0)
