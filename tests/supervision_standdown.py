#!/usr/bin/env python3
"""tests/supervision_standdown.py - the console takes the way off when the operator's page is gone.

Andy, 2026-11-02, after the overnight Honolulu Harbor run: "do all the fixes".

WHAT HAPPENED. Edge's renderer process was killed by a machine-wide out-of-memory abort 1 h 56 m into a 9.3 h
run - the machine was at 99.64% of its commit limit and three Chromium processes raised 0xE0000008 within three
minutes - the tab Edge reloaded was killed the same way 2.5 minutes later, and after the last lapse at
t=7,011.5 s NO page ever took the supervision post again. The console then flew an ARMED boat on survey for
7 h 21 m: 2,664 state records at run=running, behavior=survey, armed=True, with 104 client:guard records before
the lapse and ZERO after. The clearance guard, the speed governor and the AIS answer all live in the PAGE, so
nothing anywhere was judging the water. She ran 8.10 nm at a mean 1.099 kn - the governor's last command was
`low` and only the dead page could release it - and spent 19 minutes inside the broadcast hull box of a moored
265 m container ship the guard had called IN EXTREMIS and routed 530 m around half an hour earlier.

The console SAW it. `Supervision.check_once` said so exactly once, to stderr, behind a latch:
"the supervising tab has not reported for 10 s ... Nothing was stopped." One line out of 34,279.

WHAT THIS SUITE OWNS.
  * `quiet_s` - "no tab at all has reported", which is the signal everything here keys on. NOT `stale`: the
    prune clears the holder when it forgets it, so `stale` goes FALSE at SUPERVISOR_FORGET_S and the condition
    would evaporate exactly when it mattered most. `quiet_s` is also true of a window the operator simply
    CLOSED mid-survey, which was just as unprotected and just as silent as a crash.
  * the prune on the 1 Hz watch loop. It was reachable from `beat()` alone, so total page death was the one
    case it could never run: the dead holder was published as holder with age_s climbing to 26,479.2 s.
  * the REPEAT, on SUPERVISOR_RESAY_S, and its silence on an idle boat - the 2026-10-30 session lapsed 46
    times over 11.2 h with the boat disarmed at the dock, and a repeat there is 660 lines about nothing.
  * the STAND-DOWN: `ENGINE.pause`, latched, with the reason in the note and an event of its own.
  * the WINDOW: one try, after she is already stopped.
  * the vessel setting, both validated at load and defaulted at read.
  * `Engine.start`'s refusal while the latch is up, and the one thing that releases it.

WHY A PAUSE AND NOT A HOLD. `pause` is the only one of the four answers that commands LESS motion rather than
DIFFERENT motion: the vessel's own pause zeroes her speed and `run="paused"` keeps the plan and her place in it,
so the operator's Continue resumes the survey with nothing lost. `ENGINE.hold` replaces the plan with a
one-waypoint route, and with no page there is no certified clear disc (hold.js), so the vessel re-approaches
DIRECT - a new commanded motion, through whatever is in the way, with no ladder running. Commanding motion with
nothing watching the water is the fault being repaired. A paused boat DRIFTS on the set, which is the honest
cost of the choice and is measured in tests/currents.py and Engine.amend's own note; a blind-bearing drive back
onto a station nobody certified is worse, and in a harbor it is much worse.

    python tests/supervision_standdown.py     # exit 0 = pass, 1 = fail   (stdlib only)

⚠ THIS SUITE'S check() TAKES A VALUE, not a thunk - the same harness shape as hold_station.py and amend_plan.py.
A lambda passed as `cond` is an object and always truthy.

TEETH - the mutations run against a sidecar copy of asv_console.py and the checks each one turned red:
    _prune moved back inside beat() only (the shipped bug)           -> 2, 2b
    check_once's repeat latched again (said once, as before)         -> 3
    the repeat not gated on armed-and-running                        -> 3b
    the stand-down keyed on snap["stale"] instead of quiet_s         -> 2c, 4
    quiet_s reads max(self._seen.values()) instead of _last_any      -> 1d, 4
    quiet_s answers 0.0 instead of None before any tab has reported  -> 1, 4f
    the stand-down fires with no armed/running gate                  -> 4d
    the stand-down fires whatever supervisor_lost_action says        -> 4e
    the stand-down latched even when the pause was REFUSED           -> 5
    the stand-down resumes her when a tab comes back                 -> 6
    the window asked for before the stand-down                       -> 7
    the window asked for again every tick                            -> 7
    supervisor_lost_setting returns the raw value, unvalidated       -> 8
    an unknown supervisor_lost_action reads as "none"                -> 8
    Engine.start's latch gate dropped                                -> 9
    the latch gate not keyed on run == "paused"                      -> 9c
    the latch not spent on a Start that gets through                 -> 9c
"""

import importlib.util as _ilu
import math
import os
import sys


def _crash_report(_t, _e, _tb):
    import traceback
    sys.stdout.write("  FAIL 0. the suite itself CRASHED before finishing - %s: %s\n" % (_t.__name__, _e))
    sys.stdout.write("".join(traceback.format_exception(_t, _e, _tb))[-800:])
    sys.stdout.write("\n1 CHECK(S) FAILED (crashed before finishing)\n")
    sys.stdout.flush()


sys.excepthook = _crash_report

# ⚠ THE APP DIRECTORY GOES FIRST ON THE PATH. Without it `import currents` inside asv_console resolves to
# tests/currents.py - sys.path[0] is the SCRIPT's directory - which runs that suite and exits 0, so this file
# prints another file's output and "passes".
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)

fails = 0
ran = 0


def check(name, cond, detail=""):
    global fails, ran
    ran += 1
    print(("  ok   " if cond else "  FAIL ") + name + ("   [" + str(detail) + "]" if detail else ""))
    if not cond:
        fails += 1


_spec = _ilu.spec_from_file_location("console_under_test", os.path.join(APP, "asv_console.py"))
_C = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_C)

STALE = _C.SUPERVISOR_STALE_S
FORGET = _C.SUPERVISOR_FORGET_S
RESAY = _C.SUPERVISOR_RESAY_S
UIRETRY = _C.SUPERVISOR_UI_RETRY_S


# --- a recorder for the session log, so "it was SAID" is a check and not a hope ------------------ #
class FakeLog:
    def __init__(self):
        self.events = []
        self.quiet = False

    def event(self, kind, **kw):
        self.events.append((kind, kw))

    # The rest of the recorder's surface. Engine._push_state writes every frame through LOG.state and start()
    # writes LOG.wake, so a FakeLog without them turns a real-Engine check into a crash rather than a result.
    # ⚠ THE CATCH-ALL RECORDS THE NAME rather than swallowing it: a method this suite has not thought about
    # shows up in `events` instead of passing silently, and a misspelled LOG call in the console under test
    # still fails its own check, because `kinds("supervisor_stand_down")` then comes back empty.
    def state(self, ev):
        self.events.append(("state", {"run": (ev or {}).get("run")}))

    def __getattr__(self, name):
        def rec(*a, **kw):
            self.events.append(("LOG." + name, {"args": len(a), "kw": sorted(kw)}))
        return rec

    def kinds(self, kind):
        return [kw for k, kw in self.events if k == kind]


# --- a recorder for the boat, so every gate is observed by what it did NOT do -------------------- #
class FakeEngine:
    """Only what the stand-down touches. `refuse` makes pause() raise the way a RealVcu link does."""

    def __init__(self, run="running", armed=True, estop=False, refuse=None):
        self.run, self.armed, self.estop = run, armed, estop
        self.refuse = refuse
        self.pauses = []

    def pause(self, why=None, supervisor_held=False):
        if self.refuse:
            raise _C.VcuProtocolError(self.refuse)
        self.pauses.append({"why": why, "held": supervisor_held})
        self.run = "paused"


def world(run="running", armed=True, estop=False, refuse=None, opener=True, planning=None):
    """A fresh Supervision + StandDown + fake engine + fake log, with the vessel's planning block scripted."""
    sup = _C.Supervision()
    sd = _C.StandDown()
    eng = FakeEngine(run, armed, estop, refuse)
    log = FakeLog()
    _C.ENGINE = eng
    _C.LOG = log
    _C.SUPERVISION = sup
    _C.STAND_DOWN = sd
    opened = []
    _C.UI_REOPEN = {"open": (lambda: opened.append(1)) if opener else None, "url": "http://localhost:8791/"}
    if planning is not None:
        v = dict(_C.VESSEL or {})
        pl = dict(v.get("planning") or {})
        pl.update(planning)
        v["planning"] = pl
        _C.VESSEL = v
    return sup, sd, eng, log, opened


_VESSEL0 = _C.VESSEL


def restore_vessel():
    _C.VESSEL = _VESSEL0


print("The console takes the way off when the operator's page is gone:")

# ── 1. quiet_s - "nobody is watching", and the three things it is not ─────────────────────────────
sup, sd, eng, log, opened = world()
check("1. no page has EVER supervised: quiet_s answers None, so a suite, a script or curl driving this console "
      "with no page at all is not a lost operator and is never stood down",
      sup.quiet_s(now=1000.0) is None,
      "quiet_s=%r with _seen empty and _last_any 0" % (sup.quiet_s(now=1000.0),))

sup.beat("tab-a", now=1000.0)
check("1b. a tab reporting inside the stale window: quiet_s is None",
      sup.quiet_s(now=1000.0 + STALE - 1) is None,
      "quiet_s=%r %.0f s after a beat (stale %.0f)" % (sup.quiet_s(now=1000.0 + STALE - 1), STALE - 1, STALE))

q = sup.quiet_s(now=1000.0 + STALE + 5)
check("1c. past the stale window with nothing reporting: quiet_s counts from the last report of ANY tab",
      q is not None and abs(q - (STALE + 5)) < 0.01, "quiet_s=%r, expected %.1f" % (q, STALE + 5))

# ⚠ 1d IS THE WHOLE REASON `_last_any` EXISTS. `_seen` is emptied as tabs are forgotten, so a quiet time
# derived from it answers None again the moment the last entry is pruned - which is 120 s into exactly the
# 7 h 21 m this fix is for.
sup.check_once(now=1000.0 + FORGET + 5)          # the prune runs here, emptying _seen
q2 = sup.quiet_s(now=1000.0 + FORGET + 5)
check("1d. and it SURVIVES the prune - _seen is emptied as tabs are forgotten, and a quiet time derived from "
      "that would answer None again 120 s into the very blackout this is for",
      q2 is not None and abs(q2 - (FORGET + 5)) < 1.1 and not sup._seen,
      "quiet_s=%r with _seen=%r" % (q2, sup._seen))

# ── 2. the prune runs on the watch loop, not only inside beat() ───────────────────────────────────
sup, sd, eng, log, opened = world()
sup.beat("tab-a", now=2000.0)
snap_before = sup.snapshot(now=2000.0 + FORGET - 1)
sup.check_once(now=2000.0 + FORGET - 1)
held_before = sup.snapshot(now=2000.0 + FORGET - 1)["holder"]
sup.check_once(now=2000.0 + FORGET + 1)
after = sup.snapshot(now=2000.0 + FORGET + 1)
check("2. the prune runs on the 1 Hz watch: with NO tab ever reporting again, a dead holder is forgotten at "
      "SUPERVISOR_FORGET_S by check_once alone - the shipped code reached _prune from beat() only, so total "
      "page death was the one case it could never run",
      held_before is not None and after["holder"] is None,
      "holder %r at forget-1 s, %r at forget+1 s" % (held_before, after["holder"]))
check("2b. ... so the published snapshot says there is no supervisor, instead of naming a tab that has been "
      "silent for hours beside tabs: 0 (it reached age_s 26,479.2 s on the failing run - 220x the forget time)",
      after["holder"] is None and after["tabs"] == 0 and after["age_s"] is None,
      "holder=%r tabs=%r age_s=%r" % (after["holder"], after["tabs"], after["age_s"]))
check("2c. and `stale` is FALSE once the holder is forgotten, which is why nothing here may be keyed on it - "
      "the condition would evaporate at 120 s, exactly when it starts to matter",
      snap_before["stale"] is True and after["stale"] is False,
      "stale %r before the prune, %r after" % (snap_before["stale"], after["stale"]))

# ── 3. the repeat, and its silence on a boat at the dock ──────────────────────────────────────────
sup, sd, eng, log, opened = world(run="running", armed=True)
sup.beat("tab-a", now=3000.0)
for t in range(0, int(RESAY * 3), 5):            # 3 re-say periods of watch ticks
    sup.check_once(now=3000.0 + STALE + 1 + t)
said = log.kinds("supervisor_unwatched")
check("3. armed and running with no tab reporting: the console says so AGAIN every SUPERVISOR_RESAY_S, and the "
      "session log can tell a 10 s browser hiccup from a 7 h blackout - it could not before, because the one "
      "line was latched",
      len(said) >= 3 and said[0].get("first") is True and said[1].get("first") is False,
      "%d supervisor_unwatched over %.0f s (resay %.0f): first flags %r"
      % (len(said), RESAY * 3, RESAY, [s.get("first") for s in said[:4]]))

sup, sd, eng, log, opened = world(run="idle", armed=False)
sup.beat("tab-a", now=4000.0)
for t in range(0, int(RESAY * 4), 5):
    sup.check_once(now=4000.0 + STALE + 1 + t)
check("3b. ... and says nothing at all with the boat idle and disarmed. The 2026-10-30 session lapsed 46 times "
      "over 11.2 h at the dock; a repeat there is 660 lines about nothing, and teaches the operator to ignore "
      "the one line that matters",
      log.kinds("supervisor_unwatched") == [],
      "%d supervisor_unwatched with run=idle armed=False" % len(log.kinds("supervisor_unwatched")))

# ── 3c-3d. the lapse LINE says which of the three this lapse is ───────────────────────────────────
# ⚠ "Nothing was stopped." USED TO BE THE WHOLE OF THAT SENTENCE, unconditionally, and it is the line the
# operator reads on the console's own window. It is no longer true of every case: a lapse with another tab
# reporting stops nothing, as before, and a lapse with NO tab reporting on an armed running boat now has a
# clock on it. tests/supervisor.py 11 owns the not-under-command branch; this owns the one that matters.
import contextlib
import io as _io


def lapse_line(**kw):
    sup, sd, eng, log, opened = world(**kw)
    sup.beat("tab-a", now=20000.0)
    err = _io.StringIO()
    with contextlib.redirect_stderr(err):
        sup.check_once(now=20000.0 + STALE + 1)
    restore_vessel()
    return next((l for l in err.getvalue().splitlines() if "has not reported" in l), "")


armed_line = lapse_line(run="running", armed=True)
check("3c. armed and running with no tab reporting, the lapse line says the way is coming off and when - the "
      "operator's own window is where they find out, and \"Nothing was stopped.\" would now be a lie",
      ("the way comes off at %.0f s unwatched" % _C.SUPERVISOR_LOST_DEFAULT_S) in armed_line
      and "NO tab is reporting" in armed_line,
      armed_line[-110:] or "(nothing said)")

idle_line = lapse_line(run="idle", armed=False)
check("3d. ... and on a boat that is not under autonomous command it still says nothing is stopped, because "
      "nothing is and nothing is going to be",
      idle_line.rstrip().endswith("Nothing is stopped.") and "the way comes off" not in idle_line,
      idle_line[-90:] or "(nothing said)")

none_line = lapse_line(run="running", armed=True, planning={"supervisor_lost_action": "none"})
check("3e. ... and with this hull's action set to \"none\" it names the setting, so the operator is never left "
      "to infer from silence that the console is about to act",
      "supervisor_lost_action" in none_line and "none" in none_line
      and "the way comes off" not in none_line,
      none_line[-110:] or "(nothing said)")

# ── 4. the stand-down ─────────────────────────────────────────────────────────────────────────────
restore_vessel()
SECS, ACTION = _C.supervisor_lost_setting()

sup, sd, eng, log, opened = world()
sd.tick(SECS - 1, {"holder": "tab-a"}, now=5000.0)
check("4. not yet at supervisor_lost_s - 1 s: nothing is commanded",
      eng.pauses == [] and eng.run == "running", "pauses=%r run=%r" % (eng.pauses, eng.run))

sd.tick(SECS + 0.5, {"holder": "tab-a"}, now=5001.0)
check("4b. at supervisor_lost_s the console takes the way off itself - ENGINE.pause, which keeps the plan and "
      "her place in it, with the reason in the note and the latch set",
      len(eng.pauses) == 1 and eng.run == "paused" and eng.pauses[0]["held"] is True
      and "SUPERVISION LOST" in (eng.pauses[0]["why"] or ""),
      "pauses=%r" % (eng.pauses,))
ev = log.kinds("supervisor_stand_down")
check("4b2. ... and it writes its own event, because LOG.command only records what came over HTTP - a "
      "console-side action that logs nothing is a 7 h hole in the recording",
      len(ev) == 1 and ev[0].get("done") is True and ev[0].get("action") == "pause",
      "supervisor_stand_down=%r" % (ev,))

eng.run = "running"                              # pretend she is running again, the quiet going on
for t in range(1, 400, 7):
    sd.tick(SECS + t, {"holder": "tab-a"}, now=5001.0 + t)
check("4c. LATCHED: the quiet going on does not pause her again and again",
      len(eng.pauses) == 1, "%d pauses over %d further ticks" % (len(eng.pauses), len(range(1, 400, 7))))

for run, armed, estop, what in (("idle", True, False, "idle"), ("running", False, False, "disarmed"),
                                ("running", True, True, "e-stopped"), ("paused", True, False, "already paused")):
    sup, sd, eng, log, opened = world(run=run, armed=armed, estop=estop)
    sd.tick(SECS + 60, {"holder": "tab-a"}, now=6000.0)
    check("4d. nothing is commanded to a boat that is %s - the condition worth answering is a boat under "
          "autonomous command with nobody watching the water" % what,
          eng.pauses == [], "run=%s armed=%s estop=%s -> pauses=%r" % (run, armed, estop, eng.pauses))

sup, sd, eng, log, opened = world(planning={"supervisor_lost_action": "none"})
sd.tick(999999.0, {"holder": "tab-a"}, now=7000.0)
check("4e. and the operator can turn it off per vessel: supervisor_lost_action \"none\" alarms and does not "
      "stop her, which is exactly what this console did before today",
      eng.pauses == [] and _C.supervisor_lost_setting()[1] == "none",
      "setting=%r pauses=%r" % (_C.supervisor_lost_setting(), eng.pauses))
restore_vessel()

sup, sd, eng, log, opened = world()
sd.tick(None, {"holder": None}, now=8000.0)
check("4f. quiet_s None - a tab IS reporting, or none ever has - stands nothing down and arms the next episode",
      eng.pauses == [] and sd.state()["stood_down_at"] is None, "state=%r" % (sd.state(),))

# ── 5. a pause the link refuses is not latched ────────────────────────────────────────────────────
sup, sd, eng, log, opened = world(refuse="the real VCU wire protocol is not implemented yet")
sd.tick(SECS + 1, {"holder": "tab-a"}, now=9000.0)
sd.tick(SECS + 2, {"holder": "tab-a"}, now=9001.0)          # inside the retry spacing: not tried again
tried_1 = len(log.kinds("supervisor_stand_down"))
sd.tick(SECS + RESAY + 2, {"holder": "tab-a"}, now=9000.0 + RESAY + 1)
tried_2 = len(log.kinds("supervisor_stand_down"))
refused = log.kinds("supervisor_stand_down")
check("5. a pause the LINK refuses leaves a boat still running unwatched, so it is tried again on the re-say "
      "cadence - each attempt in the log - and never latched. A RealVcu raises for pause, so on a real link "
      "the stand-down can only be SAID; a latch there would refuse the operator a Start she is entitled to",
      tried_1 == 1 and tried_2 == 2 and all(e.get("done") is False for e in refused)
      and sd.state()["stood_down_at"] is None,
      "attempts %d then %d; done flags %r; latch %r"
      % (tried_1, tried_2, [e.get("done") for e in refused], sd.state()["stood_down_at"]))

# ── 6. a tab reporting again ends the episode - and does not start her ────────────────────────────
sup, sd, eng, log, opened = world()
sd.tick(SECS + 1, {"holder": "tab-a"}, now=10000.0)
was = dict(eng.__dict__)
sd.tick(None, {"holder": "tab-b"}, now=10050.0)              # a page is back
check("6. a tab reporting again ends the episode - and ENDING IT DOES NOT START HER. That is this file's rule "
      "from line 34: the operator presses Continue, having seen why she stopped",
      eng.run == "paused" and len(eng.pauses) == 1 and sd.state()["stood_down_at"] is None,
      "run=%r pauses=%d latch=%r" % (eng.run, len(eng.pauses), sd.state()["stood_down_at"]))

# ── 7. the window, second in the order and once per episode ───────────────────────────────────────
sup, sd, eng, log, opened = world()
sd.tick(SECS + 1, {"holder": "tab-a"}, now=11000.0)
check("7. the way comes off FIRST and no window is asked for yet: a window is a convenience, taking the way "
      "off is the safety action and it needs no browser",
      len(eng.pauses) == 1 and opened == [] and UIRETRY > SECS,
      "pauses=%d opened=%d (lost %.0f s, window %.0f s)" % (len(eng.pauses), len(opened), SECS, UIRETRY))
for t in range(0, 300, 10):
    sd.tick(UIRETRY + t, {"holder": "tab-a"}, now=11000.0 + UIRETRY + t)
check("7b. at SUPERVISOR_UI_RETRY_S it opens ONE fresh chart window - whose first beats take the post, so the "
      "guard runs again with no human there - and only one, however long the quiet goes on. On 2026-11-01 the "
      "machine was at 99.64% of its commit limit with three Edge processes just lost; spawning renderers in a "
      "loop would have been the worst thing this console could do",
      len(opened) == 1 and len(log.kinds("supervisor_window")) == 1
      and log.kinds("supervisor_window")[0].get("opened") is True,
      "%d opened over %d ticks; events %r" % (len(opened), len(range(0, 300, 10)), log.kinds("supervisor_window")))

sup, sd, eng, log, opened = world(opener=False)
sd.tick(UIRETRY + 1, {"holder": "tab-a"}, now=12000.0)
ev = log.kinds("supervisor_window")
check("7c. with no browser opened by this console (--browser none, a headless run, a suite) it says so and "
      "names the URL, rather than throwing or pretending",
      opened == [] and len(ev) == 1 and ev[0].get("opened") is False,
      "events=%r" % (ev,))

# ── 8. the vessel setting: validated at load, defaulted at read ───────────────────────────────────
restore_vessel()
d_secs, d_act = _C.supervisor_lost_setting()
check("8. the shipped hulls carry the setting and it reads back",
      d_secs > 0 and d_act == "pause", "%r" % ((d_secs, d_act),))

for bad, why in ((float("nan"), "a NaN"), (0, "zero"), (-5, "negative"), ("45", "a string"), (True, "a boolean")):
    world(planning={"supervisor_lost_s": bad})
    got = _C.supervisor_lost_setting()[0]
    check("8b. %s supervisor_lost_s reads as the default, not as a comparison that is false against every "
          "quiet time - a NaN there would silently never stand her down" % why,
          got == _C.SUPERVISOR_LOST_DEFAULT_S,
          "%r -> %r (default %r)" % (bad, got, _C.SUPERVISOR_LOST_DEFAULT_S))
    restore_vessel()

for bad in ("hold", "stop", "", "PAUSE "):
    world(planning={"supervisor_lost_action": bad})
    got = _C.supervisor_lost_setting()[1]
    check("8c. an unrecognized supervisor_lost_action %r reads as \"pause\" - an unknown word in a safety "
          "setting must never resolve as \"do nothing\"" % bad,
          got == "pause", "%r -> %r" % (bad, got))
    restore_vessel()

def refuses(planning):
    v = dict(_VESSEL0)
    pl = dict(v.get("planning") or {})
    pl.update(planning)
    v["planning"] = pl
    try:
        _C.validate_vessel(v, "test")
        return None
    except ValueError as e:
        return str(e)

check("8d. and a wrong one is REFUSED AT LOAD, in words, the way planning.overhead_clearance_m is - a safety "
      "input is refused, not read",
      refuses({"supervisor_lost_s": -1}) and refuses({"supervisor_lost_s": float("nan")})
      and refuses({"supervisor_lost_action": "hold"}) and refuses({"supervisor_lost_action": True})
      and refuses({"supervisor_lost_s": 45, "supervisor_lost_action": "none"}) is None,
      "nan: %r | hold: %r" % (refuses({"supervisor_lost_s": float("nan")}),
                              (refuses({"supervisor_lost_action": "hold"}) or "")[:90]))
check("8e. ... and the refusal of \"hold\" says why it is not offered, because it is the answer an operator "
      "would reach for first: with no page there is no certified clear disc, so a hold commands a direct drive",
      "certified" in (refuses({"supervisor_lost_action": "hold"}) or ""),
      (refuses({"supervisor_lost_action": "hold"}) or "")[-120:])
restore_vessel()

# ── 9. Engine.start's refusal, and the one thing that releases it ─────────────────────────────────
class StubLink:
    """Only what Engine.start and Engine.pause touch."""
    plan_staged = False
    plan_total = 3
    loaded_name = "survey"
    loaded_completion = "rth"

    def __init__(self):
        self.calls = []
        self.plan_points = [{"lat": 21.3 + i * 1e-4, "lon": -157.86} for i in range(3)]

    def start(self):
        self.calls.append("start")

    def pause(self):
        self.calls.append("pause")

    def stop(self):
        self.calls.append("stop")


def engine_paused_by_console():
    e = _C.Engine()
    e._link = StubLink()
    e.armed, e.plan_uploaded, e.run = True, True, "running"
    e.status = {"lat_deg": 21.3, "lon_deg": -157.86}
    e.pause("SUPERVISION LOST - the way is off and the plan is held.", supervisor_held=True)
    return e


e9 = engine_paused_by_console()
check("9. the console's stand-down LATCHES: run is paused, the latch is set, and the reason is the note a page "
      "catches on the first frame - not a second one",
      e9.run == "paused" and e9.supervisor_held is True and "SUPERVISION LOST" in e9.note
      and e9.supervisor_held_t is not None,
      "run=%r held=%r note=%r" % (e9.run, e9.supervisor_held, e9.note[:60]))

refusal = None
try:
    e9.start()
except Exception as ex:
    refusal = str(ex)
check("9b. a Start carrying no release is REFUSED while the latch is up - every automatic resume in the page "
      "is this same POST, so without this a page that comes back after a crash starts her on its first frame",
      refusal is not None and "STOOD DOWN" in refusal and e9.run == "paused"
      and "CONTINUE" in refusal.upper(),
      "refusal=%r" % ((refusal or "")[:110],))

e9.start(release=True)
check("9c. ... taken with the release, and the latch is then spent",
      e9.run == "running" and e9.supervisor_held is False and e9.supervisor_held_t is None,
      "run=%r held=%r" % (e9.run, e9.supervisor_held))

# ⚠ 9d IS THE GATE'S OWN KEY. A latch alone would have six other writers to audit - connect, disconnect,
# disarm, stop, estop and _link_lost all abandon the run - and a gate keyed on the flag refuses a Start the
# operator is entitled to the first one of them that was missed.
e9b = engine_paused_by_console()
e9b.stop()
e9b.start()                                      # no release: she is "stopped", not "paused"
check("9d. the gate is keyed on run == \"paused\", so every path that abandons the run already clears it: "
      "after a Stop an ordinary Start is taken with no release at all",
      e9b.run == "running", "run=%r after stop+start" % (e9b.run,))
e9b.pause()                                      # the operator's own pause, afterwards
e9b.start()
check("9e. ... and the latch was SPENT on the Start that got through, so the operator's next ordinary "
      "pause-and-continue is not refused by a flag left set",
      e9b.run == "running" and e9b.supervisor_held is False,
      "run=%r held=%r" % (e9b.run, e9b.supervisor_held))

e9c = engine_paused_by_console()
st = e9c.state()
check("10. the latch is PUBLISHED, because the server's standing note is deliberately not painted on the chart "
      "page - a stand-down whose only output was `note` leaves the operator looking at a paused boat with no "
      "reason given",
      isinstance(st.get("supervisor_held"), dict) and st["supervisor_held"].get("paused") is True
      and "SUPERVISION LOST" in (st["supervisor_held"].get("why") or ""),
      "supervisor_held=%r" % (st.get("supervisor_held"),))
e9c.start(release=True)
check("10b. ... and is None again once it is released, so the alert comes down by itself",
      e9c.state().get("supervisor_held") is None, "%r" % (e9c.state().get("supervisor_held"),))

# ── 11. the route a page loaded mid-run cannot name ───────────────────────────────────────────────
e11 = _C.Engine()
e11._link = StubLink()
e11.armed, e11.plan_uploaded, e11.run, e11.wp_total, e11.wp_index = True, True, "running", 3, 1
rr = e11.run_route()
check("11. the console serves the array her waypoint index counts into, which /api/mission does not: on the "
      "failing run the drawn mission held 451 waypoints while she flew a 388-waypoint way round a contact, so "
      "a page loaded mid-run could not place her at all",
      len(rr["route"]) == 3 and rr["wp_total"] == 3 and rr["wp_index"] == 1 and rr["staged"] is False
      and all(set(p) == {"lat", "lon"} for p in rr["route"]),
      "%r" % (rr,))

e11._link.plan_staged = True
check("11b. ... and says when a plan is STAGED, because a loaded-but-not-started plan is not what her index "
      "counts into",
      e11.run_route()["staged"] is True, "%r" % (e11.run_route()["staged"],))

e11._link = None
check("11c. ... and with no link at all it answers an empty route rather than a short one: a WRONG waypoint "
      "count is what the page's own length test exists to refuse",
      e11.run_route()["route"] == [], "%r" % (e11.run_route()["route"],))

check("11d. a link that cannot read its own plan back answers an empty list from the abstract base, so a new "
      "link class degrades to \"not available\" instead of crashing the endpoint",
      list(_C.VcuLink().plan_points) == [], "%r" % (list(_C.VcuLink().plan_points),))

# ── 12. the endpoint and the watch are actually WIRED (a source check: the above all drive objects) ──
_SRC = open(os.path.join(APP, "asv_console.py"), encoding="utf-8").read()
check("12. /api/run_route serves Engine.run_route, and the watch loop calls the stand-down - every check above "
      "drives the objects directly, so without this the whole thing could be unreachable and green",
      '"/api/run_route"' in _SRC and "ENGINE.run_route()" in _SRC
      and "STAND_DOWN.tick(self.quiet_s(), snap)" in _SRC
      and 'UI_REOPEN["open"] = lambda: opener.open(url, new=1)' in _SRC,
      "run_route endpoint %s, watch tick %s, opener %s"
      % ("/api/run_route" in _SRC, "STAND_DOWN.tick" in _SRC, 'UI_REOPEN["open"]' in _SRC))

print("")
print(("%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else "all checks passed (%d)" % ran)
sys.exit(1 if fails else 0)
