#!/usr/bin/env python3
"""tests/amend_plan.py - the vessel half of the deviation: a running plan can be nudged.

The page half is tests/track_edge.js. Andy, 2026-09-04, with a survey stopped at its own
start and a Go-To put into holding:

    "the recent modifications have been built to prevent the ASV from running into features.
     This is good. But stopping and holding the ASV on a run is a problem. Investigate
     forcing slight deviations in a given track to prevent holds when there is still plenty
     of available water away from the nogo."

⚠⚠ THE CONSOLE HAD NO WAY TO NUDGE A TRACK, AND THAT IS WHY ITS GUARD COULD ONLY SLOW OR
STOP. Every commanded motion in this console goes through `upload_plan`, which resets
`_wp_index` to zero - so the only way to change a running plan was to start it again from
waypoint one, and the only intervention cheap enough to make in anger was the throttle.
That made a HOLD the guard's answer to a near miss, and a hold is the most expensive thing
it does: it stops the survey, it cannot be resumed (the plan is replaced by the hold point),
and beside a structure it takes the way off a hull the tide is already setting - a boat
lying stopped in a 2 kn stream makes 2.00 kn over the ground (tests/currents.py A and E).

`amend_plan` is the missing capability. The flown prefix is history and is kept, the
remainder is replaced, the index does not move, and the RUN IS THE SAME RUN - `Engine.amend`
keeps the behaviour string for the same reason `reapproach` does: a Go-To would do the same
driving and would rename a survey a "goto" on every card, re-arm the end-of-plan chain, and
send the boat back to waypoint one.

    python tests/amend_plan.py     # exit 0 = pass, 1 = fail   (stdlib only)

Checks 1-8 drive `SimVcu` in-process. Checks 9-14 drive a REAL console over the API,
because the gates on the amendment are an interaction between the endpoint, the engine's
run state and the link - and a 409 in words rather than a 500 is a property of that seam.

TEETH - ELEVEN mutations RUN against a sidecar copy of asv_console.py, all eleven killed,
and the checks each one turned red:
    amend_plan resets _wp_index (i.e. it is upload_plan again)      -> 3, 10
    the flown prefix is discarded rather than kept                  -> 3, 10
    _seg_start is left on the old waypoint                          -> 4
    the amendment does not end a coast                              -> 6
    amend_plan accepts a plan that is not running                   -> 7
    amend_plan accepts an empty amendment                           -> 8b
    Engine.amend uploads instead of amending (the run restarts)     -> 10
    Engine.amend loses its ARM gate                                 -> 9
    Engine.amend loses its running gate                             -> 13
    Engine.amend loses its holding gate                             -> 12
    the route is not sanitised (a bad waypoint becomes a 500)       -> 11

⚠ THREE OF THESE CHECKS WERE SHADOWED WHEN THEY WERE WRITTEN, AND MUTATION FOUND ALL THREE:
  * the ARM gate was tested with the boat ALSO not running, and the run gate answered - so
    the check passed with the arm gate deleted. Engine.amend's gates are ordered (arm,
    e-stop, run, holding) and each is now observed by the sentence it produces.
  * the empty-amendment refusal was asserted on a HOLDING boat, where the holding guard
    answers first. Deleting the empty check left every check green while a running boat's
    plan became []. It is asserted on a running boat now (8b).
  * check 10 amended at INDEX 0, where an amend and an upload_plan produce identical
    telemetry - index 0 and one more waypoint. The whole distinction only exists once a
    waypoint is behind the boat, so the API half now runs up short legs first.

⚠ AND ONE MUTATION HAD TO BE REWRITTEN, the same trap tests/in_extremis.js records: deleting
the three coast lines left a function body of nothing but comments, which is an
IndentationError. That is invalid code, not wrong behaviour - it scored as a "kill" via the
crash guard rather than via check 6, which is not the same thing at all.

⚠ THIS SUITE'S check() TAKES A VALUE, not a thunk - the same harness shape as
hold_station.py and currents.py. A lambda passed as `cond` is an object and always truthy.
"""

import importlib.util as _ilu
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


def _crash_report(_t, _e, _tb):
    import traceback
    sys.stdout.write("  FAIL 0. the suite itself CRASHED before finishing - %s: %s\n" % (_t.__name__, _e))
    sys.stdout.write("".join(traceback.format_exception(_t, _e, _tb))[-800:])
    sys.stdout.write("\n1 CHECK(S) FAILED (crashed before finishing)\n")
    sys.stdout.flush()


sys.excepthook = _crash_report

# ⚠ THE APP DIRECTORY GOES FIRST ON THE PATH. Without it `import currents` inside
# asv_console resolves to tests/currents.py - sys.path[0] is the SCRIPT's directory - which
# runs that suite and exits 0, so this file prints another file's output and "passes".
APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)

fails = 0


def check(name, cond, detail=""):
    global fails
    print(("  ok   " if cond else "  FAIL ") + name + ("   [" + detail + "]" if detail else ""))
    if not cond:
        fails += 1


_spec = _ilu.spec_from_file_location("sim_under_test", os.path.join(APP, "asv_console.py"))
_C = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_C)


class _FakeCurrents:
    """Slack water. The amendment is a geometry question, not a tide one."""

    def snapshot(self):
        return {"ok": True, "speed_kn": 0.0, "set_deg": 0.0, "source": "test"}

    def update_position(self, *a):
        pass

    def set_ofs(self, *a):
        pass


BASE = {"lat": 43.073, "lon": -70.710}
M = 1.0 / 111320.0                      # metres -> degrees of latitude


def _n(m):
    return BASE["lat"] + m * M


def _route(*norths):
    return [{"lat": _n(m), "lon": BASE["lon"]} for m in norths]


def _running_boat(plan, secs=0.0):
    """A boat running `plan` from BASE, ticked for `secs` at 10 Hz."""
    _C.CURRENTS = _FakeCurrents()
    v = _C.SimVcu(BASE["lat"], BASE["lon"])
    v.upload_plan(plan, 2.0, "survey", 2.0, completion="loiter")
    v.start()
    tel = None
    for _ in range(int(secs / 0.1)):
        tel = v.tick(0.1)
    return v, tel


print("A running plan can be nudged, and the run is the same run:")

# ── 1-8. THE VESSEL ─────────────────────────────────────────────────────────────────
PLAN = _route(100, 300, 500)
v, t = _running_boat(PLAN, 12.0)
check("1. a plan is running and the first waypoint is still ahead",
      t is not None and t["running"] and not t["holding"] and t["wp_index"] == 0
      and t["wp_total"] == 3,
      "wp %s/%s" % (t and t["wp_index"], t and t["wp_total"]))

# 2. THE INDEX DOES NOT MOVE, AND THE FLOWN PREFIX SURVIVES. This is the whole point:
# upload_plan would have set the index to zero and re-run the plan from the beginning.
via = {"lat": _n(60), "lon": BASE["lon"] - 30 * M / 0.73}
v.amend_plan([via] + PLAN[0:])
t = v.tick(0.1)
check("2. amending keeps the INDEX where it was - the boat does not go back to waypoint one",
      t["wp_index"] == 0 and t["wp_total"] == 4,
      "wp %s/%s after splicing one via into a 3-waypoint plan" % (t["wp_index"], t["wp_total"]))

# 3. ... and it really is a splice: the same amendment made from a LATER index keeps the
# waypoints already flown, so the plan grows by one rather than being replaced by two.
v2, t2 = _running_boat(PLAN, 0.0)
v2._wp_index = 2                                   # pretend two legs are behind us
v2.amend_plan([via, PLAN[2]])
t2 = v2.tick(0.1)
check("3. the FLOWN PREFIX is kept - an amendment at waypoint 3 of 3 leaves a 4-waypoint plan, "
      "not a 2-waypoint one",
      t2["wp_index"] == 2 and t2["wp_total"] == 4,
      "wp %s/%s" % (t2["wp_index"], t2["wp_total"]))

# 4. ⚠ THE SEGMENT STARTS HERE, AND THIS IS NOT TIDINESS. The along-track advance test
# measures from `_seg_start`; left on the old waypoint it measures progress along a leg
# that no longer exists, and an amendment that SHORTENS the leg then reads as already past
# the new waypoint and skips it in the tick it arrived.
v3, _ = _running_boat(_route(400), 40.0)           # well up the leg
before = (v3.lat, v3.lon)
v3.amend_plan([{"lat": _n(60), "lon": BASE["lon"]}, {"lat": _n(400), "lon": BASE["lon"]}])
t3 = v3.tick(0.1)
check("4. the new leg starts where the BOAT is, so a shortened amendment is not skipped in "
      "the tick it arrives",
      abs(v3._seg_start["lat"] - before[0]) < 1e-9 and t3["wp_index"] == 0,
      "seg_start moved to the boat; wp_index %s" % t3["wp_index"])

# 5. It is still the same run - nothing about running/holding/completion changed.
check("5. the run keeps running: not paused, not holding, not completed",
      t["running"] and not t["paused"] and not t["holding"] and t["completion"] == "loiter",
      "running=%s holding=%s completion=%s" % (t["running"], t["holding"], t["completion"]))

# 6. ⚠ AN AMENDMENT ENDS THE DRIFT-IN AND DOES NOT RE-ARM IT. coast.js's own rule is that
# the coast runs only where the safety ladder is silent - and the prop is off, so a coasting
# hull cannot take a deviation at all. An amendment IS the ladder speaking.
# ⚠ WITH WAY ON, so the `_coasting` half of this check can actually fail. Set on a boat
# that is stopped, the flag clears itself in the first tick (the coast ends at
# COAST_END_KN), and the check would then have been carried entirely by coast_from_m.
v4, _ = _running_boat(_route(400), 40.0)
v4._coast_from_m = 60.0
v4._coasting = True
v4.amend_plan([{"lat": _n(200), "lon": BASE["lon"]}, {"lat": _n(400), "lon": BASE["lon"]}])
t4 = v4.tick(0.1)
check("6. an amendment ends a coast and clears the release range - she powers the last of it "
      "under control instead",
      v4._coasting is False and v4._coast_from_m is None and t4["drifting"] is False
      and v4.sog_kn > 1.0,
      "coasting=%s coast_from_m=%s at %.1f kn" % (v4._coasting, v4._coast_from_m, v4.sog_kn))


def _refuses(fn):
    try:
        fn()
        return False
    except _C.VcuProtocolError:
        return True


# 7-8. IT REFUSES WHERE THERE IS NOTHING TO AMEND. Silently accepting would leave the caller
# believing a deviation had been taken while the boat does nothing of the kind.
v5, _ = _running_boat(PLAN, 5.0)
v5.stop()
check("7. a plan that is not running has no unflown remainder, and the vessel says so",
      _refuses(lambda: v5.amend_plan(PLAN)),
      "stopped")
v6, t6 = _running_boat(_route(20), 0.0)
for _ in range(300):
    t6 = v6.tick(0.1)
    if t6["holding"]:
        break
check("8. nor does a station-keeping boat - a route arriving then is a command nobody gave",
      t6["holding"] and _refuses(lambda: v6.amend_plan(PLAN)),
      "holding=%s" % t6["holding"])

# 8b. ⚠ AND AN EMPTY AMENDMENT IS REFUSED ON A RUNNING BOAT, WHICH IS THE ONLY PLACE THE
# GUARD IS REACHABLE. This assertion used to ride on the holding boat above, where the
# holding guard answered first and shadowed it completely - deleting the empty-route check
# left every check green while `_plan` became [] under a running boat, which the telemetry
# then reported as a 0-waypoint plan. Mutation found it.
v7, _ = _running_boat(PLAN, 5.0)
check("8b. an EMPTY amendment is refused on a running boat - a plan with no waypoints is not "
      "a deviation, it is a vanished run",
      _refuses(lambda: v7.amend_plan([])) and len(v7._plan) == 3,
      "plan still %d waypoints" % len(v7._plan))

# ── 9-14. THE CONSOLE ───────────────────────────────────────────────────────────────
# The gates live across the endpoint, the engine and the link, so they need a real server.


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


PORT = _free_port()
LOGDIR = tempfile.mkdtemp(prefix="asv_amend_")
# THIS SUITE AMENDS A PLAN AGAINST A LIVE CONSOLE RUNNING IN THE APP DIRECTORY, so it
# writes the OPERATOR'S OWN mission.json - measured 2026-09-05: every run of the hook
# flipped his plan speed from `low` to `high` and left it that way. mission.json is
# gitignored, so `git status` never says a word about it. Fourteen of the twenty-one
# suites that start a console already back it up; this was one of the seven that did not.
# BYTES, not text mode: this file is CRLF on disk and a text-mode round trip rewrites
# every line ending of a file the suite is only meant to leave alone.
# ITS OWN STATE FOLDER (review #16): this console never reads or writes the operator's plan, settings
# or logs - no snapshot of mission.json, and no write-back of one when the suite ends.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from console_state import ConsoleState  # noqa: E402
STATE = ConsoleState()
proc = subprocess.Popen(
    [sys.executable, os.path.join(APP, "asv_console.py"), "--port", str(PORT),
     "--sim", "--browser", "none", "--no-log", "--no-ais-service", *STATE.args()],
    cwd=APP, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)


def _post(path, obj=None):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (PORT, path),
                                 json.dumps(obj or {}).encode(),
                                 {"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req, timeout=6).read())


def _err(path, obj=None):
    """The status and the words, or (None, None) if it unexpectedly succeeded."""
    try:
        _post(path, obj)
        return None, None
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read()).get("error", "")
        except Exception:
            return e.code, ""


def _state():
    d = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/api/state" % PORT, timeout=6).read())
    return d, (d.get("status") or {})


try:
    # ⚠ WAIT FOR A FIX, NOT MERELY FOR THE PORT. /api/state answers as soon as the server
    # is up, with `status` still EMPTY - the link has not ticked yet - so a readiness loop
    # that only asks whether the server replies crashes on the first lat_deg.
    for _ in range(120):
        try:
            d, s = _state()
            if s.get("lat_deg") is not None:
                break
        except Exception:
            pass
        time.sleep(0.25)

    d, s = _state()
    lat0, lon0 = s["lat_deg"], s["lon_deg"]
    # ⚠ SHORT LEGS, AND THE AMENDMENT IS MADE PAST THE FIRST WAYPOINT. At index 0 an amend
    # and an upload_plan produce the IDENTICAL telemetry - index 0, one more waypoint - so a
    # check made there cannot tell the two apart, and the mutation that swapped them
    # survived. The distinction only exists once a waypoint is behind the boat.
    api_route = [{"lat": lat0 + 35 * M, "lon": lon0},
                 {"lat": lat0 + 200 * M, "lon": lon0},
                 {"lat": lat0 + 200 * M, "lon": lon0 + 300 * M / 0.73}]

    # 9. THE ARM GATE, AND IT IS ASKED FIRST. ⚠ The first version of this suite checked the
    # arm gate with the boat also not running, and the run gate answered - so the check
    # passed with the arm gate deleted. The gates are ORDERED (arm, e-stop, run, holding)
    # precisely so each can be observed on its own by the sentence it produces.
    code_arm, words_arm = _err("/api/cmd/amend", {"route": api_route})
    check("9. it is ARM-gated, like every other command that moves the boat - and the arm "
          "gate answers FIRST, so it is not shadowed by the run gate",
          code_arm == 409 and "ARM" in (words_arm or ""),
          "%s %s" % (code_arm, words_arm))

    _post("/api/cmd/arm", {"on": True})
    # 13. ... and then the RUN gate, armed but with nothing running.
    code_run, words_run = _err("/api/cmd/amend", {"route": api_route})
    _post("/api/cmd/goto", {"lat": api_route[-1]["lat"], "lon": api_route[-1]["lon"],
                            "route": api_route})
    _post("/api/cmd/speed", {"speed": "high"})
    for _ in range(160):
        time.sleep(0.25)
        d, s = _state()
        if d.get("run") == "running" and (s.get("wp_index") or 0) >= 1:
            break
    before = (s.get("wp_index"), s.get("wp_total"), d.get("behavior"))

    api_via = {"lat": api_route[0]["lat"], "lon": api_route[0]["lon"] - 40 * M / 0.73}
    _post("/api/cmd/amend", {"route": [api_via] + api_route[s["wp_index"]:],
                             "note": "suite"})
    time.sleep(0.6)
    d, s = _state()
    check("10. THE RUN IS THE SAME RUN: made PAST a waypoint, the behaviour is not renamed, "
          "the index does not move, and the plan grows by the via",
          before[0] >= 1 and d["behavior"] == before[2] == "goto"
          and s["wp_index"] == before[0]
          and s["wp_total"] == before[1] + 1 and d["run"] == "running",
          "behavior %s->%s, wp %s/%s -> %s/%s"
          % (before[2], d["behavior"], before[0], before[1], s["wp_index"], s["wp_total"]))

    # 11. A MALFORMED ROUTE IS A 409 IN WORDS. Every other route-taking endpoint in this
    # console answers that way, and a 500 kills the handler thread's session-log entry.
    bad = [_err("/api/cmd/amend", {"route": []}),
           _err("/api/cmd/amend", {"route": "not a route"}),
           _err("/api/cmd/amend", {"route": [{"lat": 91.0, "lon": 0.0}]}),
           _err("/api/cmd/amend", {"route": [{"lon": 0.0}]})]
    check("11. a malformed route is refused with a 409 and a sentence, never a 500",
          all(c == 409 and w for c, w in bad),
          "; ".join("%s %s" % (c, w) for c, w in bad))

    # 12. AND IT REFUSES A STATION-KEEPING BOAT AT THE ENDPOINT TOO - the same case the
    # vessel refuses in check 8. Two gates, deliberately: if the engine's is ever loosened,
    # the link still will not take it.
    _post("/api/cmd/hold", {})
    time.sleep(0.6)
    code_h, words_h = _err("/api/cmd/amend", {"route": api_route})
    check("12. a station-keeping boat is refused at the endpoint as well as in the vessel - "
          "two gates, so loosening one does not open the seam",
          code_h == 409 and "station-keeping" in (words_h or ""),
          "%s %s" % (code_h, words_h))

    check("13. and armed with nothing running, the RUN gate answers in its own words",
          code_run == 409 and "not running a plan" in (words_run or ""),
          "%s %s" % (code_run, words_run))

    # 14. THE SERVER SURVIVED IT ALL. A handler can answer the client correctly and still
    # take down its own thread - the check http_contract.py exists for.
    d, s = _state()
    check("14. the console is still serving and still has the boat after every refusal",
          d.get("link") == "ok" and s.get("lat_deg") is not None,
          "link=%s" % d.get("link"))
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()

print("")
print(("%d CHECK(S) FAILED" % fails) if fails else "all checks pass")
sys.exit(1 if fails else 0)
