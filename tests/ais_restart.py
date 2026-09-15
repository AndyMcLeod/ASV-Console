"""tests/ais_restart.py - an AIS service that dies is started again (review #27, 2026-09-15).

The console auto-starts ais_service.py once, at launch, and nothing looked at it after: a crash left the AIS layer empty
for the rest of the session, reading exactly like a quiet sea. A watchdog now looks every AIS_WATCH_S, waits
AIS_RESTART_MIN_S before the first restart, doubles the wait on each consecutive one up to AIS_RESTART_MAX_S, starts
short again once a service has stayed up AIS_STABLE_S, and restarts only a service THIS console started and has not
stopped.

DRIVEN: the console's own _ais_watch_once (with an explicit clock), _ais_wanted_now, _stop_ais_service,
_start_ais_service and the watchdog loop, in-process with the state in a temp folder - over fake processes (the
watchdog only ever asks proc.poll()) and a start function that counts, so no service is ever launched.

    python tests/ais_restart.py      # exit 0 = pass, 1 = fail   (stdlib only)

TEETH - 11 mutations RUN in a scratch clone (sidecar original, atomic writes, no bytecode, byte-compared afterwards),
11/11 caught:
    a dead service never started again -> 1, 2, 3, 6, 8   restarted at once, no wait -> 1, 2, 6
    the wait never doubles -> 2, 6                        the wait has no ceiling -> 2
    a service that stayed up keeps its long wait -> 3     a stopped service is restarted -> 4
    someone else's service taken on -> 5                  a failed restart gives up for good -> 6
    the exit not logged -> 7                              no watchdog thread -> 8, 9
    the watchdog dies of a fault -> 9
⚠ THE FIRST RUN HUNG ON ITS FIRST MUTANT: check 2 waited `while r != "restarted"` with no bound, so a watchdog that never
restarts spun the suite until the runner gave up - a hang, which names nothing, not a catch. Every wait here is bounded.
And check 8 first failed on the unmutated code for a reason of the suite's own: the module took its first wait from the
constant at import, before the suite shortened the constant.
"""

import importlib.util as _ilu
import io
import os
import sys
import threading
import time
from contextlib import redirect_stdout


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

_spec = _ilu.spec_from_file_location("asv_console_ais_restart", os.path.join(APP, "asv_console.py"))
_C = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_C)
STATE = ConsoleState(prefix="asv_ais_restart_")
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


print("An AIS service that dies is started again:")


class FakeProc:
    def __init__(self, code=None):
        self.code = code

    def poll(self):
        return self.code

    def terminate(self):
        self.code = -15

    def wait(self, timeout=None):
        return self.code

    def kill(self):
        self.code = -9


class _Log:
    def __init__(self):
        self.events = []

    def event(self, kind, **kw):
        self.events.append((kind, kw))

    def __getattr__(self, name):
        return lambda *a, **k: None


LOG = _Log()
_C.LOG = LOG
_C._ais_watchdog = "held by the suite"          # no real thread for 1-7: every look is made here, on an explicit clock
starts = []


def fake_start(dies_at_start=False, fails=False):
    def start():
        starts.append(time.monotonic())
        if fails:
            return                                # a start that produced no service
        with _C._ais_lock:
            _C._ais_proc = FakeProc(3 if dies_at_start else None)
            _C._ais_wanted_now(_C._ais_proc)
    return start


def reset(proc=None):
    starts.clear()
    with _C._ais_lock:
        _C._ais_proc = proc
        _C._ais_wanted = proc is not None
        _C._ais_started_at = 0.0
        _C._ais_down_since = None
        _C._ais_restart_wait = _C.AIS_RESTART_MIN_S
        _C._ais_restarts = 0


def look(now):
    buf = io.StringIO()
    with redirect_stdout(buf):
        r = _C._ais_watch_once(now=now)
    return r, buf.getvalue()


MIN, MAX, STABLE = _C.AIS_RESTART_MIN_S, _C.AIS_RESTART_MAX_S, _C.AIS_STABLE_S

# 1. an exit is seen, and the service started again once the wait has passed - not before
proc = FakeProc()
reset(proc)
_C._start_ais_service = fake_start()
running, _ = look(10.0)
proc.code = 1                                     # it dies
seen, said = look(12.0)
early, _ = look(12.0 + MIN - 0.01)
due, _ = look(12.0 + MIN)
check("1. a service this console started that exits is seen on the next look, and started again once the wait has "
      "passed - not before, and once",
      lambda: running is None and seen == "down" and early == "down" and due == "restarted" and len(starts) == 1
      and "exited (code 1)" in said and _C._ais_proc is not proc and _C._ais_proc.poll() is None,
      lambda: "running %s; died -> %s, then %s, then %s; starts %d; said: %s" % (running, seen, early, due, len(starts),
                                                                               said.strip()[:80]))

# 2. a service that dies at start: the wait doubles, and is capped
reset(FakeProc(2))
_C._start_ais_service = fake_start(dies_at_start=True)
t, restart_at = 0.0, []
for _ in range(12):
    r, _ = look(t)
    give_up = t + 2 * MAX                         # BOUNDED: a watchdog that never restarts must fail this, not hang it
    while r != "restarted" and t < give_up:
        t += 1.0
        r, _ = look(t)
    if r != "restarted":
        break
    restart_at.append(t)
gaps = [b - a for a, b in zip(restart_at, restart_at[1:])] or [0]
check("2. a service that dies as soon as it starts is not restarted in a spin: each wait doubles, up to "
      "AIS_RESTART_MAX_S",
      lambda: gaps[0] >= 2 * MIN and all(b >= a for a, b in zip(gaps, gaps[1:])) and max(gaps) <= MAX + 2
      and gaps[-1] >= MAX and len(restart_at) == 12,
      lambda: "restart gaps %s s" % [round(g) for g in gaps])

# 3. a service that stayed up starts short again
reset(FakeProc())
with _C._ais_lock:
    _C._ais_restart_wait = MAX                    # as if it had been failing for a while
    _C._ais_started_at = 100.0
_C._start_ais_service = fake_start()
look(100.0 + STABLE + 1.0)                        # up for AIS_STABLE_S
_C._ais_proc.code = 5
look(200.0 + STABLE)
due3, _ = look(200.0 + STABLE + MIN)
check("3. a service that has stayed up AIS_STABLE_S goes back to the shortest wait, so its next failure is answered "
      "in AIS_RESTART_MIN_S, not the long wait it had earned",
      lambda: due3 == "restarted", lambda: "after a stable run, restarted %s s after the exit: %s" % (MIN, due3))

# 4. a service this console stopped is not one that died
reset(FakeProc())
_C._start_ais_service = fake_start()
buf = io.StringIO()
with redirect_stdout(buf):
    _C._stop_ais_service()
stopped = [look(t)[0] for t in (1.0, 1.0 + MIN, 1.0 + 10 * MAX)]
check("4. a service this console STOPPED - at exit, or the stop half of a rescope - is never restarted",
      lambda: stopped == [None, None, None] and not starts and _C._ais_wanted is False,
      lambda: "looks %s; starts %d" % (stopped, len(starts)))

# 5. not ours - on a second copy of the module whose _start_ais_service is the real one
reset(None)
_spec2 = _ilu.spec_from_file_location("asv_console_ais_restart_real", os.path.join(APP, "asv_console.py"))
_R = _ilu.module_from_spec(_spec2)
_spec2.loader.exec_module(_R)
_R.use_state_dir(STATE.dir)
_R._ais_watchdog = "held by the suite"
_R._ais_local_port = lambda: ("127.0.0.1", 9)
_R._port_alive = lambda h, p: True
buf = io.StringIO()
with _R._ais_lock:
    _R._ais_wanted = True
with redirect_stdout(buf):
    _R._start_ais_service()
check("5. when the port already has a service the console did not start, it uses it and does not take it on - it will "
      "never restart what is not its own",
      lambda: _R._ais_wanted is False and _R._ais_proc is None and "already on" in buf.getvalue(),
      lambda: "wanted %s; said: %s" % (_R._ais_wanted, buf.getvalue().strip()[:70]))

# 6. a restart that fails is tried again
reset(FakeProc(1))
_C._start_ais_service = fake_start(fails=True)
r6 = [look(0.0)[0], look(MIN)[0]]
dead_kept = _C._ais_proc is not None and _C._ais_proc.poll() == 1
_C._start_ais_service = fake_start()
t6 = MIN
r = None
while r != "restarted" and t6 < MIN + 4 * MAX:
    t6 += 1.0
    r = look(t6)[0]
check("6. a restart that produced no service leaves the dead one in place, so it is tried again after the doubled wait "
      "rather than never",
      lambda: r6 == ["down", "down"] and dead_kept and r == "restarted" and t6 - MIN >= 2 * MIN,
      lambda: "first try %s (dead kept %s); restarted %.0f s after the failed try" % (r6, dead_kept, t6 - MIN))

# 7. it says so
reset(FakeProc())
LOG.events.clear()
_C._start_ais_service = fake_start()
_C._ais_proc.code = 7
_, said7 = look(1.0)
check("7. an exit is printed with its code and the wait, and written to the session log",
      lambda: "exited (code 7)" in said7 and any(k == "ais_service_exit" and kw.get("code") == 7 for k, kw in LOG.events),
      lambda: "said: %s; events %s" % (said7.strip()[:70], LOG.events[:1]))

# 8. the real start marks what it spawned as wanted, and one real watchdog thread does the looking
_R._port_alive = lambda h, p: False
_R.LOG = _Log()
spawned = []


class _Popen:
    def __init__(self, cmd, **kw):
        self.cmd, self.code = cmd, None
        spawned.append(self)

    def poll(self):
        return self.code

    def terminate(self):
        self.code = -15

    def wait(self, timeout=None):
        return self.code


_R.subprocess = type("S", (), {"Popen": _Popen, "DEVNULL": -3, "STDOUT": -2})
_R.atexit = type("A", (), {"register": staticmethod(lambda *a, **k: None)})
_R._ais_watchdog = None
_R.AIS_WATCH_S, _R.AIS_RESTART_MIN_S = 0.05, 0.1
_R._ais_restart_wait = 0.1                        # the module took its first wait from the constant at import
buf = io.StringIO()
with redirect_stdout(buf):
    _R._start_ais_service()
    first = spawned[-1] if spawned else None
    threads_after_first = [t for t in threading.enumerate() if t.name == "ais-watchdog"]
    if first:
        first.code = 1                            # the service dies; the real thread must notice and start another
    deadline = time.time() + 5
    while len(spawned) < 2 and time.time() < deadline:
        time.sleep(0.05)
    threads_now = [t for t in threading.enumerate() if t.name == "ais-watchdog"]
check("8. the console's own start marks the service it spawned as wanted and starts ONE daemon watchdog, which notices "
      "a death on its own and starts another",
      lambda: first is not None and len(threads_after_first) == 1 and threads_after_first[0].daemon
      and len(spawned) >= 2 and len(threads_now) == 1 and _R._ais_wanted is True,
      lambda: "spawned %d; watchdog threads %d then %d" % (len(spawned), len(threads_after_first), len(threads_now)))

# 9. the watchdog outlives a fault in one of its looks
looks = []
real_once = _R._ais_watch_once


def faulty_once(now=None):
    looks.append(time.monotonic())
    if len(looks) == 1:
        raise RuntimeError("a look that went wrong")
    return None


_R._ais_watch_once = faulty_once
err_buf = io.StringIO()
from contextlib import redirect_stderr  # noqa: E402
with redirect_stderr(err_buf):
    deadline = time.time() + 3
    while len(looks) < 3 and time.time() < deadline:
        time.sleep(0.05)
_R._ais_watch_once = real_once
check("9. the watchdog outlives a look that raises - it says so and keeps looking - because a watchdog killed by what it "
      "watches is the original fault again",
      lambda: len(looks) >= 3 and "a look that went wrong" in err_buf.getvalue(),
      lambda: "%d looks after the fault; said: %s" % (len(looks), err_buf.getvalue().strip()[:70]))

print("\n" + ("%d CHECK(S) FAILED (%d ran)" % (fails, ran) if fails else "all checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
