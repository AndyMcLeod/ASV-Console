#!/usr/bin/env python3
"""tests/coast_sim.py - the hull actually coasts, and the coast actually ends.

The vessel half of the drift-in (the model and the release solve are tests/coast.js). Andy,
2026-09-03, after the boat hit a pier on an approach for the second time: *"Its ok to come in
at idle with the prop stopped, but it take calculation to do it."*

WHAT THIS GUARDS, and each of these is a way to get it wrong that would look fine:

  * THE WAY MUST COME OFF UNDER DRAG, NOT UNDER THE ENGINE RAMP. SimVcu's ordinary speed
    change is a flat 1.5 kn/s - that is what an engine does to a speed change, and it stays
    the default everywhere else. A coast is the absence of a commanded speed and the hull
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
check("1. the DriX's coast length comes off its own headreach datum, not off the leeway "
      "constants (which would give this hull a 1.6 m stopping distance)",
      LC is not None and abs(LC - 44.0 / math.log(3.5)) < 1e-6,
      "Lc = %.2f m from 44 m between 7 and 2 kn" % (LC or 0))


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
mpath = os.path.join(APP, "mission.json")
mission_bak = None
if os.path.exists(mpath):
    with open(mpath, "r", encoding="utf-8") as f:
        mission_bak = f.read()
srvlog = tempfile.TemporaryFile(mode="w+")
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none",
                         "--port", str(port), "--no-ais-service", "--no-log"],
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
    if mission_bak is not None:
        with open(mpath, "w", encoding="utf-8") as f:
            f.write(mission_bak)

print("\n%d CHECK(S) FAILED" % fails if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
