#!/usr/bin/env python3
"""tests/hold_station.py - a station-keeping vessel does not drive a blind bearing back.

The vessel half of the command-time work (the geometry and page wiring are in
tests/hold_point.js). Andy, 2026-09-02, after watching a DriX trace a station-keeping loop
through a pier at Eastport: *"A vessel must consider what is ahead of it and modify
trajectory or speed or final target to ENSURE nogo areas are never entered."*

THE DEFECT. `SimVcu`'s station-keep branch took `plan[-1]` as the hold point whatever it
was, and when the boat was set off it, turned toward it and drove at low speed - from ANY
range, with NO keep-out check. That straight return leg through a pier is the loop in the
photograph. Every other commanded motion in the console is routed clear; this one never
was, because this model has no keep-out model to route with.

THE FIX IS A NUMBER THE CONSOLE GIVES IT. With every holding command the console now sends
`hold_clear_m`: the radius of the disc round the hold point that it certified clear of the
keep-out model at the operator's buffer (static/js/hold.js). Inside that disc a straight
chord back to the centre is clear by construction - every point of a disc is in the disc -
so the direct drive is honest there. Beyond it the vessel cannot know, so it TAKES THE WAY
OFF and says so (`hold_wants_route`), and the console answers with a ROUTED re-approach
through the same planner as everything else (`/api/cmd/reapproach`), which keeps the
run's behaviour rather than renaming it a Go-To. With NO number (no console, no model) the
direct drive stays - the same honest degrade as a Go-To with no route.

    python tests/hold_station.py     # exit 0 = pass, 1 = fail   (stdlib only)

Checks 1-7 drive `SimVcu` in-process with a fake tidal stream, the way tests/currents.py
does, because the whole question is what the hull does when the WATER moves it. Checks 8-13
drive a REAL console over the API, because the gate on the re-approach is an interaction
between the endpoint, the engine's holding state and the link.

TEETH - mutations RUN, and the checks each one turned red:
    the station-keep branch ignores hold_clear_m (always drives)        -> 3, 3b
    the branch never raises hold_wants_route                            -> 3b
    the direct band uses the HOLD radius rather than the certified disc -> 4
    Engine.reapproach loses its holding gate                            -> 11
    hold_clear_m validation dropped (float() raw -> a 500)              -> 13
    telemetry stops publishing `hold`                                   -> 1, 12

⚠ THIS SUITE'S check() TAKES A VALUE, not a thunk - the same harness shape as currents.py.
A lambda passed as `cond` is an object and always truthy. Values here.
"""

import importlib.util as _ilu
import json
import math as _math
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
    def __init__(self, kn, set_deg):
        self.kn, self.set_deg = kn, set_deg

    def snapshot(self):
        return {"ok": True, "speed_kn": self.kn, "set_deg": self.set_deg, "source": "test"}

    def update_position(self, *a):
        pass


HP = {"lat": 44.906, "lon": -66.983}


def _holding_boat(hold_clear_m):
    """A boat that has ARRIVED at a single-waypoint loiter plan and is holding there."""
    _C.CURRENTS = _FakeCurrents(0.0, 0.0)
    v = _C.SimVcu(HP["lat"], HP["lon"])
    v.upload_plan([HP], 2.0, "low", 1.0, completion="loiter", hold_clear_m=hold_clear_m)
    v.start()
    tel = None
    for _ in range(20):
        tel = v.tick(0.1)
        if tel["holding"]:
            break
    return v, tel


def _set_off(v, kn, set_deg, secs, disc=None):
    """Let the stream carry a holding boat for `secs`; report what the hull did.

    `thru_max` is the highest through-water speed COMMANDED at any point; `thru_beyond` is
    the same measured only while the boat was more than a metre BEYOND the certified disc
    - the band where a drive would be the blind bearing. Between the hold radius and the
    disc edge the direct drive is correct, so a single maximum would score it as a fault."""
    _C.CURRENTS = _FakeCurrents(kn, set_deg)
    thru_max = thru_beyond = 0.0
    wanted = False
    tel = None
    for _ in range(int(secs / 0.1)):
        tel = v.tick(0.1)
        thru_max = max(thru_max, v.sog_kn)          # COMMANDED through-water speed
        if disc is not None and (tel["off_station_m"] or 0.0) > disc + 1.0:
            thru_beyond = max(thru_beyond, v.sog_kn)
        wanted = wanted or tel["hold_wants_route"]
    return {"tel": tel, "thru_max": thru_max, "thru_beyond": thru_beyond, "wanted": wanted}


print("A station-keeping vessel, and what it does when the water moves it:")

# 1. Arrived and holding: the hold is STATED on the telemetry.
v, t = _holding_boat(None)
check("1. arrived at a loiter plan the vessel holds, and says WHERE - the hold point is on the "
      "telemetry, with the range to it",
      t is not None and t["holding"] and t["hold"] == HP and t["off_station_m"] is not None
      and t["off_station_m"] < 2.5 and t["hold_wants_route"] is False and t["hold_clear_m"] is None,
      "hold=%s off=%s wants_route=%s" % (t and t["hold"], t and t["off_station_m"], t and t["hold_wants_route"]))

# 2. NO NUMBER: the direct re-approach stays - the honest degrade, as a Go-To with no route.
v, _ = _holding_boat(None)
r = _set_off(v, 1.0, 90.0, 20.0)
check("2. with NO certified disc (no console, no model) the vessel re-approaches DIRECT as it "
      "always did - an honest degrade, not a boat that never comes back",
      r["thru_max"] > 0.3 and not r["wanted"],
      "through-water %.2f kn commanded, wants_route=%s" % (r["thru_max"], r["wanted"]))

# 3. A TIGHT DISC: set beyond it, the vessel takes the way off and asks for a route.
v, _ = _holding_boat(3.0)
r = _set_off(v, 1.0, 90.0, 30.0, disc=3.0)
check("3. set beyond a 3 m certified disc, the vessel does NOT drive a bearing back - the "
      "way is taken off (the direct drive INSIDE the disc, between 2 and 3 m, is correct)",
      r["thru_beyond"] < 0.05 and v.sog_kn < 0.05 and r["thru_max"] > 0.3
      and r["tel"]["off_station_m"] > 3.0,
      "through-water beyond the disc %.2f kn, inside it up to %.2f kn; %.1f m off station after "
      "30 s in a 1 kn stream" % (r["thru_beyond"], r["thru_max"], r["tel"]["off_station_m"]))
check("3b. ... and it SAYS so: hold_wants_route, with the disc it was given",
      r["wanted"] and r["tel"]["hold_wants_route"] is True and r["tel"]["hold_clear_m"] == 3.0
      and r["tel"]["holding"] is True and r["tel"]["hold"] == HP,
      "wants_route=%s hold_clear_m=%s" % (r["tel"]["hold_wants_route"], r["tel"]["hold_clear_m"]))

# 4. A WIDE DISC: inside it the chord back is clear by construction, so it drives direct.
v, _ = _holding_boat(100.0)
r = _set_off(v, 1.0, 90.0, 30.0)
check("4. inside a 100 m certified disc the same set is answered by the direct re-approach - "
      "a chord of a clear disc is clear",
      r["thru_max"] > 0.3 and not r["wanted"] and r["tel"]["off_station_m"] < 100.0,
      "through-water %.2f kn commanded, wants_route=%s, %.1f m off"
      % (r["thru_max"], r["wanted"], r["tel"]["off_station_m"]))

# 5. Within the HOLD radius nothing is commanded at all, whatever the disc.
v, _ = _holding_boat(3.0)
r = _set_off(v, 0.0, 0.0, 5.0)
check("5. with no set the boat sits within the hold radius and commands nothing",
      r["thru_max"] < 0.05 and not r["wanted"] and r["tel"]["off_station_m"] < 2.0,
      "through-water %.2f kn, %.1f m off" % (r["thru_max"], r["tel"]["off_station_m"]))

# 6. THE ROUTED WAY BACK: a re-approach plan ending at the hold point brings it home and
#    the hold resumes with its disc.
v, _ = _holding_boat(3.0)
r = _set_off(v, 1.0, 90.0, 30.0, disc=3.0)
here = {"lat": v.lat, "lon": v.lon}
via = {"lat": (v.lat + HP["lat"]) / 2 + 0.00005, "lon": (v.lon + HP["lon"]) / 2}
v.upload_plan([via, HP], 2.0, "low", 1.0, completion="loiter", hold_clear_m=3.0)
v.start()
_C.CURRENTS = _FakeCurrents(0.0, 0.0)
back = None
for _ in range(1200):
    back = v.tick(0.1)
    if back["holding"]:
        break
check("6. a routed re-approach (a plan ending at the hold point) clears the request, drives "
      "the route and resumes the hold at the SAME point with the SAME disc",
      back is not None and back["holding"] and back["hold"] == HP
      and back["off_station_m"] is not None and back["off_station_m"] < 2.5
      and back["hold_wants_route"] is False and back["hold_clear_m"] == 3.0,
      "holding=%s off=%s disc=%s" % (back and back["holding"], back and back["off_station_m"],
                                     back and back["hold_clear_m"]))

# 7. Not holding: the flags are quiet, and a bad disc value never reaches the vessel.
v = _C.SimVcu(HP["lat"], HP["lon"])
t = v.tick(0.1)
check("7. a vessel that is not holding publishes no hold, no range and no request",
      t["hold"] is None and t["off_station_m"] is None and t["hold_wants_route"] is False,
      json.dumps({k: t[k] for k in ("hold", "off_station_m", "hold_wants_route")}))


# --- 8-13: the engine over a real console ------------------------------------------- #
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
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def state(port):
    return api(port, "/api/state")[1]


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
    up = False
    for _ in range(60):
        try:
            api(port, "/api/state", timeout=2)
            up = True
            break
        except Exception:
            time.sleep(0.5)
    check("8. a console comes up to drive", up)
    if not up:
        raise SystemExit(1)
    st0 = None
    for _ in range(40):
        st0 = state(port)["status"]
        if st0.get("lat_deg") is not None:
            break
        time.sleep(0.25)
    api(port, "/api/cmd/arm", {"on": True})

    # 9. A holding command carries the disc to the vessel.
    code, r = api(port, "/api/cmd/hold", {"hold_clear_m": 12.5})
    time.sleep(0.6)
    s = state(port)
    check("9. /api/cmd/hold carries hold_clear_m through the engine to the vessel's telemetry",
          code == 200 and s["status"].get("hold_clear_m") == 12.5 and s["behavior"] == "hold",
          "code %s, hold_clear_m=%s, behavior=%s" % (code, s["status"].get("hold_clear_m"), s["behavior"]))

    # 10. A Go-To a few metres away: arrive, hold, keep the disc.
    lat, lon = st0["lat_deg"], st0["lon_deg"]
    tgt = {"lat": lat + 0.00004, "lon": lon}            # ~4.5 m north
    code, r = api(port, "/api/cmd/goto", {"lat": tgt["lat"], "lon": tgt["lon"],
                                           "route": [tgt], "hold_clear_m": 6.0})
    # ⚠ WAIT FOR THE NEW PLAN'S TELEMETRY, not for `holding`: the boat was ALREADY holding
    # from check 9, and the first frame after the POST still describes that run - the
    # first draft of this check passed on the old hold's disc (12.5) and called it a Go-To.
    holding = False
    s = None
    for _ in range(80):
        s = state(port)
        if s["status"].get("hold_clear_m") == 6.0 and s["status"].get("holding"):
            holding = True
            break
        time.sleep(0.25)
    check("10. a Go-To with a disc arrives and holds as 'goto', disc intact",
          code == 200 and holding and s["behavior"] == "goto" and s["status"].get("hold_clear_m") == 6.0,
          "holding=%s behavior=%s disc=%s" % (holding, s and s["behavior"], s and s["status"].get("hold_clear_m")))

    # 11. The re-approach keeps the behaviour, and is refused when the boat is not holding.
    back = [{"lat": lat + 0.00002, "lon": lon}, tgt]
    code, r = api(port, "/api/cmd/reapproach", {"route": back, "hold_clear_m": 6.0})
    s = state(port)
    check("11. /api/cmd/reapproach on a holding boat is accepted, and the run stays what it was "
          "(behavior 'goto', not renamed a Go-To of its own)",
          code == 200 and s["behavior"] == "goto" and "re-approaching" in (s.get("note") or ""),
          "code %s behavior=%s note=%r" % (code, s["behavior"], (s.get("note") or "")[:60]))
    api(port, "/api/cmd/stop")
    time.sleep(0.4)
    code, r = api(port, "/api/cmd/reapproach", {"route": back})
    check("11b. ... and REFUSED (409, in words) when the vessel is not station-keeping - a "
          "route arriving then is a command nobody gave",
          code == 409 and "not station-keeping" in (r.get("error") or ""),
          "code %s error=%r" % (code, r.get("error")))

    # 12. The hold point itself is published for the console to plan back to.
    tgt2 = {"lat": tgt["lat"], "lon": lon + 0.00005}          # a different point: its own frames
    code, r = api(port, "/api/cmd/goto", {"lat": tgt2["lat"], "lon": tgt2["lon"], "route": [tgt2], "hold_clear_m": 7.0})
    hp = None
    for _ in range(80):
        s = state(port)
        if s["status"].get("hold_clear_m") == 7.0 and s["status"].get("holding"):
            hp = s["status"].get("hold")
            break
        time.sleep(0.25)
    tgt = tgt2
    check("12. the telemetry names the hold point the console must plan back to",
          hp is not None and abs(hp["lat"] - tgt["lat"]) < 1e-7 and abs(hp["lon"] - tgt["lon"]) < 1e-7,
          "hold=%s" % (hp,))

    # 13. A bad disc value is a REFUSAL that names the rule, never a 500.
    code, r = api(port, "/api/cmd/goto", {"lat": tgt["lat"], "lon": tgt["lon"], "hold_clear_m": "abc"})
    code2, r2 = api(port, "/api/cmd/hold", {"hold_clear_m": -4})
    check("13. a non-numeric or negative hold_clear_m is refused in words (409), not a 500 from "
          "the dispatch catch-all",
          code == 409 and "hold_clear_m" in (r.get("error") or "")
          and code2 == 409 and "hold_clear_m" in (r2.get("error") or ""),
          "codes %s / %s, %r" % (code, code2, r.get("error")))

    # A handler that answers correctly and THEN raises is invisible to every check above.
    srvlog.seek(0)
    log = srvlog.read()
    check("14. the server's own log shows no traceback from any of it",
          "Traceback" not in log, log[-300:].replace("\n", " | ") if "Traceback" in log else "clean")
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
