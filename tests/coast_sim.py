#!/usr/bin/env python3
"""tests/coast_sim.py - the hull actually coasts, and the coast actually ends.

The vessel half of the drift-in (the model and the release solve are tests/coast.js). Andy,
2026-09-03, after the boat hit a pier on an approach for the second time: *"Its ok to come in
at idle with the prop stopped, but it take calculation to do it."*

WHAT THIS GUARDS, and each of these is a way to get it wrong that would look fine:

  * THE WAY MUST COME OFF UNDER DRAG, NOT UNDER THE ENGINE RAMP. SimVcu's ordinary speed
    change is a flat 1.5 kn/s - that is what an engine does to a speed change - except a
    commanded CUT on a hull with a measured slow-down, which is flown in gear (checks 10-15,
    2026-10-03). A coast is the absence of a commanded speed and the hull
    decides: dv = -(v²/Lc) dt. The two are distinguishable and check 2 is the discrimination:
    under drag the distance to HALVE speed is Lc·ln2 from any release speed, while a constant
    deceleration scales it as v0², so halving from 14 kn would cost four times halving from 7.

  * THE COAST MUST END. Quadratic drag only asymptotes - the way never reaches zero - so a
    coast with no speed floor leaves a boat that stopped short of its berth gliding for ever,
    never arriving, never holding, with the prop off. This was a real defect in the first cut
    of this feature, found by driving it rather than by reading it (check 3).

  * A HULL WITH NO COAST DATUM MUST NOT COAST. Lc cannot be derived from anything the vessel
    files already hold: it needs mass, which is absent from two of the three shipped hulls
    entirely and present in the DriX's only as prose inside a `notes` string. The leeway
    constants are no substitute - HULL_CD and HULL_A_LAT are LATERAL, and pressed into
    service fore-and-aft they give this hull a 1.6 m stopping distance, out by fifteen times.
    So the absence of the datum is the honest degrade, and check 4 pins it.

    python tests/coast_sim.py     # exit 0 = pass, 1 = fail   (stdlib only)

TEETH - mutations RUN, and the checks each turned red:
    the decay replaced by the engine ramp                       -> 2
    the speed floor removed (the boat glides for ever)          -> 3
    COAST_LENGTH_M defaulted instead of None for a bare hull    -> 4
    `drifting` dropped from telemetry                           -> 5
    upload_plan does not clear _coasting on a fresh plan        -> 6
    coast_from_m validation dropped (a 500 instead of a 409)    -> 8

⚠ THIS SUITE'S check() TAKES A VALUE, not a thunk - the shape hold_station.py and currents.py
use. A lambda passed as `cond` is an object and always truthy. tests/coast.js is the other
shape and DOES call its condition. Know which harness you are in.
"""

import importlib.util as _ilu
import json
import math
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
    sys.stdout.write("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    sys.stdout.write("\n1 CHECK(S) FAILED (crashed before finishing)\n")
    sys.stdout.flush()


sys.excepthook = _crash_report

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
# ⚠ THE REPO ROOT MUST GO ON THE PATH BEFORE asv_console IS EXECUTED, AND THE FAILURE IS
# SPECTACULARLY CONFUSING WITHOUT IT. Python puts the running script's own directory first on
# sys.path, so a suite living in tests/ that loads asv_console.py gives it a tests/ that
# shadows the repo root - and asv_console.py line 66 does `import currents`. That resolves to
# tests/currents.py, which is a SUITE: it runs its own nineteen checks and calls sys.exit(0).
# The symptom is this file printing another file's output and exiting 0 without running one
# of its own checks. tests/hold_station.py and tests/currents.py both carry this same insert.
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
    def __init__(self, kn=0.0, set_deg=0.0):
        self.kn, self.set_deg = kn, set_deg

    def snapshot(self):
        return {"ok": True, "speed_kn": self.kn, "set_deg": self.set_deg, "source": "test"}

    def update_position(self, *a):
        pass

    # apply_vessel() ends by applying the PORT, which pushes the regional model at the
    # currents monitor - so a stand-in has to answer that too or the vessel switch throws.
    def set_ofs(self, *a):
        pass


print("The hull coasts, and the coast ends:")

_C.apply_vessel(_C.load_vessel("drix08"))
LC = _C.COAST_LENGTH_M
check("1. the DriX's coast length comes off its own headreach datum - MEASURED from her logs 2026-10-03, 40.3 m "
      "between 6 and 2 kn - not off the leeway constants (which would give this hull a 1.6 m stopping distance)",
      LC is not None and abs(LC - 40.3 / math.log(3.0)) < 1e-6,
      "Lc = %.2f m from 40.3 m between 6 and 2 kn" % (LC or 0))


def rundown(v0_kn, to_kn, coast=True):
    """Distance made good shedding way from v0 to `to_kn`, in slack water."""
    _C.CURRENTS = _FakeCurrents()
    v = _C.SimVcu(44.906, -66.983)
    v._running, v._estop, v._paused = True, False, False
    v.sog_kn, v._coasting = v0_kn, coast
    d = 0.0
    for _ in range(40000):
        p = (v.lat, v.lon)
        v.tick(0.25)
        d += _C.range_bearing(p[0], p[1], v.lat, v.lon)[0]
        if v.sog_kn <= to_kn:
            break
    return d


# ⚠ THE DISCRIMINATION. Under drag the halving distance has no memory of the release speed;
# under the engine's flat ramp it would go as v0².
halves = [rundown(v0, v0 / 2.0) for v0 in (14.0, 7.0, 4.0)]
want = LC * math.log(2)
check("2. the way comes off under DRAG, not under the engine ramp: the distance to halve "
      "speed is Lc·ln2 from 14, 7 and 4 kn alike, where a ramp would scale it as v0²",
      max(halves) - min(halves) < 2.0 and abs(sum(halves) / 3 - want) < 2.0,
      "%.1f / %.1f / %.1f m against Lc·ln2 = %.1f (a ramp: 4x from 14 kn vs 7)"
      % (halves[0], halves[1], halves[2], want))


def coast_to_rest(coast_from_m=60.0, set_kn=0.0):
    """Drive a real approach to a berth 140 m off and report what arrives."""
    _C.CURRENTS = _FakeCurrents(set_kn, 340.0)
    H = {"lat": 44.906595, "lon": -66.983369}
    st = _C.dest_point(H["lat"], H["lon"], 180.0, 140.0)
    v = _C.SimVcu(st[0], st[1])
    v.heading = 0.0
    v.upload_plan([H], 2.0, "low", 1.0, completion="loiter",
                  hold_clear_m=8.0, coast_from_m=coast_from_m)
    v.start()
    v.sog_kn = 4.0
    closest, at_closest, saw_drift, ended = 1e9, None, False, False
    tel = None
    for _ in range(8000):
        tel = v.tick(0.25)
        r = _C.range_bearing(v.lat, v.lon, H["lat"], H["lon"])[0]
        if tel["drifting"]:
            saw_drift = True
        elif saw_drift:
            ended = True
        if r < closest:
            closest, at_closest = r, tel["sog_kn"]
        if tel["holding"] and r < 3.0:
            break
    return {"closest": closest, "kn": at_closest, "drifted": saw_drift,
            "ended": ended, "tel": tel}


# ⚠ CHECK 3 IS A REAL DEFECT THIS SUITE CAUGHT. The first cut had no speed floor, so a boat
# that stopped short of its berth coasted for ever: never arriving, never holding, prop off.
r = coast_to_rest()
check("3. THE COAST ENDS. Quadratic drag only asymptotes, so without a speed floor a boat "
      "that stops short glides for ever - never arriving, never holding, prop off",
      r["drifted"] and r["ended"] and r["tel"]["holding"],
      "coasted, handed back to power at %.1f kn, then arrived and held" % _C.COAST_END_KN)

check("3b. ... and she arrives GENTLY, which is the whole point",
      r["closest"] < 3.0 and r["kn"] is not None and r["kn"] < 1.6,
      "closest %.2f m at %.2f kn (%.0f J on a 1,380 kg hull)"
      % (r["closest"], r["kn"], 0.5 * 1380 * (r["kn"] * 0.514444) ** 2))

powered = coast_to_rest(coast_from_m=None)
check("3c. ... where powering the same approach arrives with way still on - the measured "
      "difference this manoeuvre exists for",
      powered["kn"] > 3.0 and r["kn"] < powered["kn"] / 2.5,
      "powered %.2f kn (%.0f J) vs drift-in %.2f kn (%.0f J): a %.0fx cut in arrival energy"
      % (powered["kn"], 0.5 * 1380 * (powered["kn"] * 0.514444) ** 2,
         r["kn"], 0.5 * 1380 * (r["kn"] * 0.514444) ** 2,
         (powered["kn"] / max(0.01, r["kn"])) ** 2))

# 4. A hull with no datum does not coast, however loudly it is asked to.
_C.apply_vessel(_C.load_vessel("zboat_1800hs"))
check("4. a vessel with no coast datum does not coast AT ALL, even when a release range is "
      "commanded - the honest degrade, and the default for two of the three shipped hulls",
      _C.COAST_LENGTH_M is None and coast_to_rest(coast_from_m=60.0)["drifted"] is False,
      "no mass in any form, and the lateral leeway constants are not a substitute")
_C.apply_vessel(_C.load_vessel("drix08"))

# 5. The card branch that had no producer for as long as it existed.
check("5. the vessel publishes `drifting` - the mission card has had a branch for "
      "'propulsion off, drifting with the environment' since long before anything set it",
      r["drifted"] and isinstance(r["tel"].get("drifting"), bool)
      and r["tel"].get("coast_length_m") is not None,
      "coast_length_m=%s on the telemetry" % r["tel"].get("coast_length_m"))

# 6. A fresh plan is never mid-coast.
v = _C.SimVcu(44.906, -66.983)
v._coasting = True
v.upload_plan([{"lat": 44.9066, "lon": -66.9834}], 2.0, "low", 1.0, completion="loiter")
check("6. a fresh plan is never mid-coast, and one with no coast_from_m powers in exactly "
      "as it did before this feature existed",
      v._coasting is False and v._coast_from_m is None,
      "None is today's behaviour, byte for byte")


# --- 6b-6e: THE RELEASE IS ONE-SHOT, AND A START IS NEVER MID-COAST ------------------ #
#
# ⚠⚠ THE COAST USED TO RE-ARM ITSELF ON EVERY TICK, and the boat never got its power back.
# `_coasting` was the only thing guarding the latch, and the exit cleared `_coasting` while
# `_coast_from_m` stayed set and the boat was still inside it on the last leg - so the exit
# un-latched and the next tick re-latched, for ever. Every one of those frames published
# `drifting: False` and `speed_target_kn` at the plan speed, so the card read "under power"
# with the DRIFT branch dark while the model had the prop off.
#
# ⚠ AND IT WAS REACHABLE FROM THE FRONT PANEL. pause(), stop() and estop() all set
# `sog_kn = 0.0` and none cleared `_coasting`, so a coast interrupted and resumed came back
# with the way already off - and a boat already AT zero satisfies the coast's own
# below-COAST_END_KN exit, re-latches, and NEVER MOVES AGAIN. Measured before the fix:
# 0.0 m made good in 120 s with `running: True`, the console showing a run under way.
#
# 6e is the acceptance case and it is why the other three are not satisfied by deleting the
# feature: the coast must still HAPPEN.
def _drift_in_leg(coast_from_m=140.0, dist_m=400.0):
    """A single long leg with a drift-in armed, run up to speed and into the coast."""
    _C.CURRENTS = _FakeCurrents()
    v = _C.SimVcu(43.07, -70.71)
    end = _C.dest_point(v.lat, v.lon, 0.0, dist_m)
    v.upload_plan([{"lat": end[0], "lon": end[1]}], 5.0, "survey", 2.0,
                  completion="loiter", coast_from_m=coast_from_m)
    v.start()
    for _ in range(240):                      # 60 s: up to speed and closing
        v.tick(0.25)
    for _ in range(4000):
        v.tick(0.25)
        if v._coasting:
            break
    return v, end


def _made_good(v, end, secs=120.0):
    d0 = _C.range_bearing(v.lat, v.lon, end[0], end[1])[0]
    for _ in range(int(secs / 0.25)):
        v.tick(0.25)
    return d0 - _C.range_bearing(v.lat, v.lon, end[0], end[1])[0]


v, end = _drift_in_leg()
entered = v._coasting
rel_at = None
for _ in range(4000):                       # run to the release
    v.tick(0.25)
    if not v._coasting:
        rel_at = (_C.range_bearing(v.lat, v.lon, end[0], end[1])[0], v.sog_kn)
        break
held = []
r_before = _C.range_bearing(v.lat, v.lon, end[0], end[1])[0]
for _ in range(120):                        # 30 s after the release
    v.tick(0.25)
    held.append(v.sog_kn)
r_after = _C.range_bearing(v.lat, v.lon, end[0], end[1])[0]
# ⚠ THE DISCRIMINATION IS THAT THE WAY STOPS COMING OFF. Under the re-arm bug the boat went
# on DECAYING below the release speed while `drifting` published False - powered control had
# the helm on paper and the hull had it in fact. Under powered control at the spent-coast cap
# she HOLDS the release speed and closes the range; she neither decays nor gets the plan
# speed back. A check that only asked "is _coasting False" cannot tell those apart.
check("6b. the coast RELEASES to POWERED control - the way stops coming off, and she closes "
      "the remaining range instead of decaying through it",
      rel_at is not None and held and min(held) >= _C.COAST_END_KN * 0.9
      and (r_before - r_after) > 5.0,
      ("released %.1f m out at %.2f kn; over the next 30 s the speed held %.2f-%.2f kn and "
       "the range closed %.1f m" % (rel_at[0], rel_at[1], min(held), max(held), r_before - r_after))
      if rel_at else "never released: %.3f kn, coasting=%s" % (v.sog_kn, v._coasting))
check("6c. ... and the release DISARMS the range, so the latch cannot re-take it next tick",
      v._coast_from_m is None,
      "armed range after release: %s (a live one re-latches on the very next tick)"
      % (v._coast_from_m,))

v, end = _drift_in_leg()
v.pause()
v.start()
moved = _made_good(v, end)
check("6d. a coast PAUSED and resumed is not still a coast - the boat moves again",
      not v._coasting and moved > 5.0,
      "made good %.1f m in 120 s (0.0 m was the defect), coasting=%s" % (moved, v._coasting))

v, end = _drift_in_leg()
v.stop()
v.start()
moved_s = _made_good(v, end)
check("6d2. ... and the same after a STOP, which is the other way to reach it",
      moved_s > 5.0, "made good %.1f m in 120 s" % moved_s)

check("6e. ACCEPTANCE: the drift-in still HAPPENS - none of the above is satisfied by "
      "switching the coast off",
      entered is True, "the leg entered its coast: %s" % entered)


# --- 10-15: A COMMANDED CUT IS FLOWN IN GEAR (2026-10-03) ---------------------------- #
#
# Andy: "Model the in-gear slow-down in the sim". The DriX's own logs: 20 of 20 commanded cuts from her 7-kn
# setpoint to LOW kept the clutch in - a dead time, then a decay toward her idle speed - 32.5 m and 13 s where this
# model's engine ramp took 5.7 m and 2 s. So a sim rehearsal of the AIS guard, which budgets the measured law,
# slowed ~90 m out and crept. speed_step_kn is now that law, and it is the SAME step as coast.js speedStep, which
# the page's corner walk takes: check 14 holds the two to each other tick by tick, in their own languages.
def _cut_run(v0, key, ticks=400, dt=0.25):
    """The DriX at v0 kn on a long straight leg, then set_speed(key): (time, water) until she is at the key's speed,
    and how long her speed did not move after the command."""
    _C.CURRENTS = _FakeCurrents()
    v = _C.SimVcu(43.07, -70.71)
    end = _C.dest_point(v.lat, v.lon, 0.0, 5000.0)
    v.heading = 0.0
    v.upload_plan([{"lat": end[0], "lon": end[1]}], 5.0, "survey", 2.0, completion="loiter")
    v.start()
    v.sog_kn = v0
    v._speed_key = "survey"
    want = _C.SPEED_KN[key]
    v.set_speed(key)
    t = d = held = 0.0
    prev = v.sog_kn
    for _ in range(ticks):
        p = (v.lat, v.lon)
        v.tick(dt)
        t += dt
        d += _C.range_bearing(p[0], p[1], v.lat, v.lon)[0]
        if v.sog_kn == prev:
            held += dt
        prev = v.sog_kn
        if v.sog_kn <= want + 1e-9:
            break
    return t, d, held, v


t7, d7, h7, _v = _cut_run(7.0, "low")


def _node(src):
    """Run a line of Node against the page's own coast.js; None when Node is not there to ask (and the check says so)."""
    try:
        return json.loads(subprocess.run(["node", "-e", src], capture_output=True, text=True, timeout=60).stdout)
    except Exception:                       # noqa: BLE001 - the checks name the failure
        return None


_COAST = json.dumps(os.path.join(APP, "static", "js", "coast.js"))
_DRIX = json.dumps(os.path.join(APP, "vessels", "drix08.json"))
_sr = _node("const C = require(%s); const L = C.slowLaw(JSON.parse(require('fs').readFileSync(%s, 'utf8')).maneuvering.slowdown);"
            "console.log(JSON.stringify(C.slowRun(7 * 0.514444, 4 * 0.514444, L)));" % (_COAST, _DRIX))
check("10. the DriX's SLOW is flown IN GEAR: 7 -> 4 kn takes 42.98 m and 15.75 s at the vessel's 0.25 s tick - "
      "coast.js slowRun's own answer (asked in Node) to within one tick - where the engine ramp took 5.7 m and 2 s",
      abs(t7 - 15.75) < 1e-9 and abs(d7 - 42.98) < 0.05 and _sr is not None
      and abs(d7 - _sr["m"]) <= 7.0 * 0.514444 * 0.25 and abs(t7 - _sr["s"]) <= 0.25,
      "%.2f m / %.2f s; slowRun %s" % (d7, t7, ("%.2f m / %.2f s" % (_sr["m"], _sr["s"])) if _sr else "NOT ASKED (no node)"))
check("11. ... and her speed does not move for the dead time: 3.3 s (13 ticks) after the command, at 7.00 kn",
      abs(h7 - 3.25) < 1e-9, "speed held %.2f s" % h7)


def _resend_run():
    _C.CURRENTS = _FakeCurrents()
    v = _C.SimVcu(43.07, -70.71)
    end = _C.dest_point(v.lat, v.lon, 0.0, 5000.0)
    v.upload_plan([{"lat": end[0], "lon": end[1]}], 5.0, "survey", 2.0, completion="loiter")
    v.start()
    v.sog_kn = 7.0
    v.set_speed("low")
    held = 0.0
    prev = v.sog_kn
    for i in range(40):                     # the page re-sends an untaken speed once a second (SPEED_RESEND_MS)
        if i % 4 == 0:
            v.set_speed("low")
        v.tick(0.25)
        if v.sog_kn == prev:
            held += 0.25
        prev = v.sog_kn
    return held, v.sog_kn


h_re, v_re = _resend_run()
check("12. a RE-SENT speed command does not start the dead time again - the page re-sends an unconfirmed speed "
      "every second, and a dead time restarted by each would keep her at survey speed for ever",
      abs(h_re - 3.25) < 1e-9 and v_re < 6.0, "held %.2f s; %.2f kn after 10 s" % (h_re, v_re))

# 13. A STOP KEEPS THE RAMP, and a hull with no law is the ramp exactly as before.
_C.CURRENTS = _FakeCurrents()
_vs = _C.SimVcu(43.07, -70.71)
_end = _C.dest_point(_vs.lat, _vs.lon, 0.0, 5000.0)
_vs.upload_plan([{"lat": _end[0], "lon": _end[1]}], 5.0, "survey", 2.0, completion="loiter")
_vs.start()
_vs.sog_kn = 7.0
_vs._running = False                        # complete: the target is 0
for _ in range(4):
    _vs.tick(0.25)
stop_kn = _vs.sog_kn
_C.apply_vessel(_C.load_vessel("zboat_1800hs"))
zb = _C.SLOW_LAW
zt = _C.speed_step_kn(3.0, 1.5, 0.25, None, _C.SLOW_LAW)
_C.apply_vessel(_C.load_vessel("drix08"))
check("13. a STOP keeps the engine's ramp (7 -> 5.5 kn in 1 s), and a hull with no measured slow-down - the small-class boat - "
      "has no law and sheds speed on the ramp exactly as before",
      abs(stop_kn - 5.5) < 1e-9 and zb is None and zt[0] == 2.625,      # the lag slot is never read without a law
      "stop %.3f kn after 1 s; small-class boat's law %s, 3.0 -> 1.5 kn first tick %s" % (stop_kn, zb, zt))

# 14. THE SIM AND THE WALK SHED SPEED THE SAME WAY, tick by tick. One scripted run of targets - cuts, a deeper cut, a
# stop, LOW asked half way through the stop, speed-ups - through speed_step_kn here and coast.js speedStep in Node.
_SCRIPT = [7.0] * 4 + [4.0] * 30 + [5.0] * 6 + [4.5] * 4 + [4.0] * 30 + [14.0] * 40 + [7.0] * 10 + [4.0] * 70 \
    + [0.0] * 5 + [4.0] * 40 + [7.0] * 20 + [0.0] * 3 + [4.0] * 40 \
    + [7.0] * 20 + [3.9] * 40       # a stop from 7 kn then LOW at 5.9; and a cut to 3.9 kn - EXACTLY idle + 0.25, the tie
_py = []
_v, _lag = 7.0, None
for _w in _SCRIPT:
    _v, _lag = _C.speed_step_kn(_v, _w, 0.25, _lag, _C.SLOW_LAW)
    _py.append(_v)
_js_src = (
    "const C = require(%s); const fs = require('fs');"
    "const L = C.slowLaw(JSON.parse(fs.readFileSync(%s, 'utf8')).maneuvering.slowdown);"
    "const KN = 0.514444, st = {lag: null}; let v = 7 * KN; const out = [];"
    "for (const w of %s) { v = C.speedStep(v, w * KN, 0.25, st, L, 1.5 * KN); out.push(v / KN); }"
    "console.log(JSON.stringify(out));"
    % (json.dumps(os.path.join(APP, "static", "js", "coast.js")), json.dumps(os.path.join(APP, "vessels", "drix08.json")),
       json.dumps(_SCRIPT)))
try:
    _js = json.loads(subprocess.run(["node", "-e", _js_src], capture_output=True, text=True, timeout=60).stdout)
except Exception as _e:                     # noqa: BLE001 - the check says what happened
    _js = None
_worst = max(abs(a - b) for a, b in zip(_py, _js)) if _js and len(_js) == len(_py) else None
check("14. the SIM and the page's CORNER WALK shed speed the same way: %d ticks of cuts, a deeper cut, a stop, LOW "
      "asked half way through the stop and speed-ups, through speed_step_kn here and coast.js speedStep in Node, "
      "agree to a millionth of a knot" % len(_SCRIPT),
      _worst is not None and _worst < 1e-6 and min(_py) < 4.5 and max(_py) > 13.9,
      ("worst difference %.2e kn over %d ticks" % (_worst, len(_py))) if _worst is not None
      else "node gave no answer: %r" % (_js,))

# 14b. AND AT THE FLOOR ITSELF, where the two arithmetics part. A target EXACTLY idle + 0.25 kn is in gear on both sides
# or on neither: tested in knots after a round trip through m/s, the sim's floor fell the other way from coast.js's for
# 58 of 399 idle speeds (review) - the DriX's 3.65 happens not to be one of them, so three that are: 2.75, 1.25, 3.95.
_tie_bad = []
for _idle in (2.75, 1.25, 3.95):
    _law = {"U": _idle * 0.514444, "Lg": 23.8, "lag": 3.3}
    _seq = [7.0] * 2 + [_idle + 0.25] * 20
    _pv, _pl, _ptr = 7.0, None, []
    for _w in _seq:
        _pv, _pl = _C.speed_step_kn(_pv, _w, 0.25, _pl, _law)
        _ptr.append(_pv)
    _jtr = _node("const C = require(%s); const L = C.slowLaw({idle_kn: %r, length_m: 23.8, lag_s: 3.3}); const KN = 0.514444;"
                 "const st = {lag: null}; let v = 7 * KN; const o = []; for (const w of %s) { v = C.speedStep(v, w * KN, 0.25, st, L, 1.5 * KN);"
                 " o.push(v / KN); } console.log(JSON.stringify(o));" % (_COAST, _idle, json.dumps(_seq)))
    if not _jtr or max(abs(a - b) for a, b in zip(_ptr, _jtr)) > 1e-6:
        _tie_bad.append(_idle)
check("14b. ... and at the FLOOR ITSELF - a target exactly idle + 0.25 kn, at three idle speeds where knots and m/s "
      "round apart - the sim and the walk take the same branch",
      not _tie_bad, "idle speeds where they parted: %s" % (_tie_bad or "none"))

# 15. THE BLOCK IS READ AS coast.js slowLaw READS IT: a malformed one is no law (the ramp), not a crash.
_bad = []
_drix = _C.load_vessel("drix08")
for _blk in ({"idle_kn": 0, "length_m": 23.8}, {"idle_kn": 3.65, "length_m": 0}, {"idle_kn": 3.65, "length_m": 23.8,
             "lag_s": -1}, {"idle_kn": "abc", "length_m": 23.8}, {"idle_kn": 3.65, "length_m": float("inf")},
             [1, 2], "slow"):
    _drix["maneuvering"]["slowdown"] = _blk
    _C.apply_vessel(_drix)
    _bad.append(_C.SLOW_LAW)
_drix["maneuvering"]["slowdown"] = {"idle_kn": 3.65, "length_m": 23.8}
_C.apply_vessel(_drix)
_nolag = _C.SLOW_LAW
# THE SAME REFUSALS AS THE PAGE'S, ASKED OF THE PAGE: every shape through apply_vessel here and coast.js slowLaw in Node -
# coerced types too (a string number, a one-item list, a bool, hex), where float() and `+` used to part (review)
_SHAPES = [{"idle_kn": 0, "length_m": 23.8}, {"idle_kn": 3.65, "length_m": 0}, {"idle_kn": 3.65, "length_m": 23.8, "lag_s": -1},
           {"idle_kn": "abc", "length_m": 23.8}, {"idle_kn": "3.65", "length_m": 23.8}, {"idle_kn": [3.65], "length_m": 23.8},
           {"idle_kn": True, "length_m": 23.8}, {"idle_kn": 3.65, "length_m": "0x4"}, {"idle_kn": 3.65, "length_m": 23.8, "lag_s": "3.3"},
           {"idle_kn": 3.65, "length_m": 23.8}, {"idle_kn": 3.65, "length_m": 23.8, "lag_s": 3.3}, [1, 2], "slow", {}]
_py_laws = []
for _blk in _SHAPES:
    _drix["maneuvering"]["slowdown"] = _blk
    _C.apply_vessel(_drix)
    _py_laws.append(None if _C.SLOW_LAW is None else [round(_C.SLOW_LAW["U"], 9), _C.SLOW_LAW["Lg"], _C.SLOW_LAW["lag"]])
_C.apply_vessel(_C.load_vessel("drix08"))
_js_laws = _node("const C = require(%s); console.log(JSON.stringify(%s.map((b) => { const l = C.slowLaw(b); "
                 "return l ? [+l.U.toFixed(9), l.Lg, l.lag] : null; })));" % (_COAST, json.dumps(_SHAPES)))
check("15. a slow-down block that is not one is NO law - the engine's ramp - never a crash, and the sim and the page "
      "refuse the SAME blocks (%d shapes, coerced types included, asked of coast.js slowLaw in Node); a block with no "
      "lag reads as none" % len(_SHAPES),
      all(b is None for b in _bad) and _nolag is not None and _nolag["lag"] == 0.0
      and _C.SLOW_LAW is not None and _C.SLOW_LAW["lag"] == 3.3 and _js_laws == _py_laws,
      "sim %s; page %s" % (_py_laws, _js_laws if _js_laws is not None else "NOT ASKED (no node)"))


# --- 7-8: the wire ------------------------------------------------------------------ #
def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def api(port, path, body=None, timeout=6):
    url = "http://127.0.0.1:%d%s" % (port, path)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as rr:
            return rr.status, json.loads(rr.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


port = free_port()
# ITS OWN STATE FOLDER (review #16): this console never reads or writes the operator's plan, settings
# or logs - no snapshot of mission.json, and no write-back of one when the suite ends.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from console_state import ConsoleState  # noqa: E402
STATE = ConsoleState()
srvlog = tempfile.TemporaryFile(mode="w+")
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none",
                         "--port", str(port), "--no-ais-service", "--no-log", *STATE.args()],
                        cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
try:
    st0 = None
    for _ in range(60):
        try:
            st0 = api(port, "/api/state", timeout=2)[1]["status"]
            if st0.get("lat_deg") is not None:
                break
        except Exception:
            pass
        time.sleep(0.5)
    check("7. a console comes up to drive", st0 is not None and st0.get("lat_deg") is not None)

    api(port, "/api/cmd/arm", {"on": True})
    tgt = {"lat": st0["lat_deg"] + 0.0009, "lon": st0["lon_deg"]}     # ~100 m north
    code, _ = api(port, "/api/cmd/goto", {"lat": tgt["lat"], "lon": tgt["lon"],
                                          "route": [tgt], "hold_clear_m": 8.0,
                                          "coast_from_m": 55.0})
    check("7b. coast_from_m rides a Go-To through the engine to the vessel",
          code == 200, "code %s" % code)

    bad = [api(port, "/api/cmd/goto", {"lat": tgt["lat"], "lon": tgt["lon"],
                                       "coast_from_m": v})[0] for v in ("abc", -4)]
    check("8. a malformed coast_from_m is refused in words (409), never a 500 from the "
          "dispatch catch-all",
          bad == [409, 409], "codes %s" % bad)

    srvlog.seek(0)
    log = srvlog.read()
    check("9. the server's own log shows no traceback from any of it",
          "Traceback" not in log,
          log[-300:].replace("\n", " | ") if "Traceback" in log else "clean")
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()

print("\n%d CHECK(S) FAILED" % fails if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
