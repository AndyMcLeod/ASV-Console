#!/usr/bin/env python3
"""tests/escape_chain.py - the in-extremis escape is its OWN behaviour, not a Go-To wearing
one, and the server side of that has to actually hold - the page half cannot see it.

Andy, having watched it live at Eastport, 2026-09-03: the clearance guard steered the boat
clear of a pier (the run-time ladder, f09d7ed), and nine seconds after it held there, the
end-of-plan Return-to-Home chain fired and sent it straight back toward the pier. A second
escape fired three seconds after that. The safety intervention was undoing itself, on
repeat, entirely on its own telemetry - with the operator's standing "End of Plan = RTH"
setting the only thing that had to be true, because the escalation issued a Go-To under the
hood and a Go-To's arrival looks, to the chain, exactly like an ordinary run ending.

THE FIX HAS TWO HALVES, TESTED IN TWO LANGUAGES. The chain-exclusion itself - rthPending()
and the literal chain-fire condition in onState both refusing to act on behavior "escape" -
is browser JS with no server counterpart, and is proven in tests/end_action.js (checks 5b
and 16b). What THIS file proves is the half a JS source-shape check cannot see: that
`/api/cmd/escape` actually reaches the vessel and actually sets `behavior` to "escape" and
not, say, "goto" left over from Engine.escape() being built out of go_to() by copy-paste.
A page-side check asserting the CLIENT calls the right URL is silent about what the SERVER
does with it - the two halves can drift apart with every check still green, which is
exactly the shape of gap a mutation of Engine.escape() itself (reverting its behavior
string) found undetected during development of this fix.

    python tests/escape_chain.py     # exit 0 = pass, 1 = fail   (stdlib only)

Drives a REAL console, the way tests/hold_station.py's back half does, because the identity
of a run is state living behind the ARM gate and the link - not something a unit test of
Engine.escape() in isolation would be exercising honestly.

TEETH - mutations RUN, and the checks each one turned red:
    Engine.escape() passes "goto" instead of "escape" to _run_route      -> 2, 6
    the escape command drops its ARM gate                                -> 5
    reapproach() after an escape hold forgets the run's own behaviour    -> 6
    hold_clear_m is accepted but never reaches the vessel                -> 3
"""

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
    sys.stdout.write("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    sys.stdout.write("\n1 CHECK(S) FAILED (crashed before finishing)\n")
    sys.stdout.flush()


sys.excepthook = _crash_report

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")

fails = 0


# ⚠ TAKES A VALUE, NOT A THUNK - same harness shape as hold_station.py / currents.py.
def check(name, cond, detail=""):
    global fails
    print(("  ok   " if cond else "  FAIL ") + name + ("   [" + detail + "]" if detail else ""))
    if not cond:
        fails += 1


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


print("The in-extremis escape reaches the vessel as its OWN behaviour:")

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
    up = False
    st0 = None
    for _ in range(60):
        try:
            st0 = api(port, "/api/state", timeout=2)[1]["status"]
            if st0.get("lat_deg") is not None:
                up = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    check("1. a console comes up to drive, with a fix", up)
    if not up:
        raise SystemExit(1)
    lat, lon = st0["lat_deg"], st0["lon_deg"]
    tgt = {"lat": lat + 0.00004, "lon": lon}          # ~4.5 m north - inside the sim's own low-speed arrival

    # 2. ARMED, an escape sets behavior "escape" - not "goto" left over from being built out
    # of go_to() by copy-paste, which is precisely the gap a source-shape check on the PAGE
    # (does the client call the right URL) cannot see: it is silent about what the server
    # does once that request lands.
    api(port, "/api/cmd/arm", {"on": True})
    code, r = api(port, "/api/cmd/escape", {"lat": tgt["lat"], "lon": tgt["lon"], "hold_clear_m": 9.0})
    # `upload_plan` sets hold_clear_m on the LINK synchronously, but the STATUS dict this
    # state read reports is only refreshed by the next background tick - reading immediately
    # raced it and read the previous tick's telemetry (None), same shape as hold_station.py's
    # checks 9/10, which settle the same way.
    time.sleep(0.6)
    s = state(port)
    check("2. /api/cmd/escape is accepted and the run's behaviour reads \"escape\", not \"goto\"",
          code == 200 and s["behavior"] == "escape" and s["run"] == "running",
          "code %s behavior=%s" % (code, s["behavior"]))

    # 3. The certified disc travels through exactly like every other holding command.
    check("3. hold_clear_m reaches the vessel's telemetry unchanged",
          s["status"].get("hold_clear_m") == 9.0,
          "hold_clear_m=%s" % s["status"].get("hold_clear_m"))

    # 4. It arrives and holds AT THE ESCAPE POINT - and behavior is still "escape" once
    # holding, not reset to something generic on arrival.
    holding = False
    for _ in range(80):
        s = state(port)
        if s["status"].get("holding"):
            holding = True
            break
        time.sleep(0.25)
    check("4. the escape run arrives and station-keeps there, still as \"escape\"",
          holding and s["behavior"] == "escape",
          "holding=%s behavior=%s" % (holding, s["behavior"]))

    # 5. Gated exactly like every other commanded motion - the escape is issued by the
    # guard, but the guard itself only fires while the console HAS authority (armed, not
    # e-stopped); if that gate were ever lost at the server, an escape must still refuse
    # rather than move a disarmed boat.
    # ⚠ {} MAKES IT A POST. With no body api() sends a GET, which the console 404s - so
    # for as long as this line read `api(port, "/api/cmd/stop")` the boat was never
    # stopped. hold_station.py:428 records the IDENTICAL bug being found there ("it failed
    # 4 runs in 6") and this line survived that fix. It did not make check 5 pass falsely -
    # Engine.escape asks the ARM gate first, so the arm gate answers either way - but a
    # silent no-op in a setup line is how the next check written here would.
    api(port, "/api/cmd/stop", {})
    api(port, "/api/cmd/arm", {"on": False})
    code, r = api(port, "/api/cmd/escape", {"lat": tgt["lat"], "lon": tgt["lon"]})
    check("5. disarmed, an escape is REFUSED (409) like any other commanded motion, not "
          "granted a side channel around the arm gate",
          code == 409 and "ARM" in (r.get("error") or ""),
          "code %s error=%r" % (code, r.get("error")))

    # 6. RE-APPROACHING AN ESCAPE HOLD KEEPS IT AN ESCAPE. Engine.reapproach() re-uses
    # self.behavior precisely so a boat set off an RTH-hold stays "rth" (tests/hold_station.py
    # check 11); the same has to hold for "escape", or a boat blown off its escape point by
    # the very set that put it there would silently reappear as something the chain no
    # longer recognises as exempt.
    api(port, "/api/cmd/arm", {"on": True})
    code, r = api(port, "/api/cmd/escape", {"lat": tgt["lat"], "lon": tgt["lon"], "hold_clear_m": 9.0})
    for _ in range(80):
        s = state(port)
        if s["status"].get("holding"):
            break
        time.sleep(0.25)
    back = [{"lat": tgt["lat"] + 0.00001, "lon": tgt["lon"]}, tgt]
    code, r = api(port, "/api/cmd/reapproach", {"route": back, "hold_clear_m": 9.0})
    s = state(port)
    check("6. a routed re-approach off an escape hold stays \"escape\", not \"goto\"",
          code == 200 and s["behavior"] == "escape",
          "code %s behavior=%s" % (code, s["behavior"]))

    # ⚠⚠ 8-10. A HALT DOES NOT RENAME THE RUN. `Engine.start` used to write
    # `behavior = "survey"` for anything that was not a resume, and it decided that from
    # `link.plan_staged` - which `_apply_plan` clears as its FIRST statement, inside stop(),
    # estop() and set_neutral(). So a halt that consumed a staged plan destroyed the console's
    # only evidence in the very call that installs the plan, and Start renamed whatever was
    # loaded a survey.
    #
    # MEASURED before the fix: escape, Stop, Start -> behavior "survey" on the escape's own
    # ONE-waypoint plan (wp 1/1), holding at the escape point. "survey" is in the page's
    # chainable whitelist and "escape" is not, so the end-of-plan Return-to-Home chain then
    # fired a return from a point chosen only to be clear of a hazard - the Eastport shape
    # that whitelist exists to prevent. The plan is the escape's either way: SimVcu holds
    # exactly one, and the escape overwrote the survey.
    #
    # ⚠ THE PAIR IS THE CHECK. "escape" is what the name ALREADY WAS, so halting and
    # re-reading it cannot fail on its own - 9 is the control: the same halt, the same Start,
    # on a run whose plan really IS a survey, which must come back "survey". Without it a fix
    # that simply never renamed anything would pass 8 and 10.
    # A SETTLE, because status.wp_total is the LINK's published copy and it lags the
    # command by up to a tick - read with no pause it returns the frame BEFORE check 6's
    # re-approach landed, and this check would be comparing a stale count with a fresh one.
    time.sleep(0.6)
    wp_before = (state(port)["status"].get("wp_total") or 0)
    api(port, "/api/cmd/stop", {})
    time.sleep(0.5)
    s_stop = state(port)
    api(port, "/api/cmd/start", {})
    time.sleep(1.0)
    s_re = state(port)
    wp_after = (s_re["status"].get("wp_total") or 0)
    check("8. a Stop then a Start does not rename the guard's escape a survey - she is flying "
          "the same plan she was, and it is not a survey",
          s_stop["behavior"] == "escape" and s_re["behavior"] == "escape"
          and wp_after == wp_before and wp_before > 0,
          "after STOP behavior=%s; after START behavior=%s; plan aboard %s -> %s waypoint(s)"
          % (s_stop["behavior"], s_re["behavior"], wp_before, wp_after))

    # 9. THE CONTROL, and it is what gives 8 its teeth: an actual survey must still come back
    # a survey through the same two commands.
    api(port, "/api/cmd/stop", {})
    time.sleep(0.4)
    sv = [{"lat": tgt["lat"] + 0.0004, "lon": tgt["lon"]},
          {"lat": tgt["lat"] + 0.0008, "lon": tgt["lon"]}]
    api(port, "/api/cmd/upload", {"route": sv, "hold_clear_m": 9.0})
    api(port, "/api/cmd/start", {})
    time.sleep(0.8)
    s_sv = state(port)
    api(port, "/api/cmd/stop", {})
    time.sleep(0.4)
    api(port, "/api/cmd/start", {})
    time.sleep(0.8)
    s_sv2 = state(port)
    check("9. ... and the control: an uploaded SURVEY is still called a survey through the "
          "same Stop and Start, so 8 is not passing because nothing is named at all",
          s_sv["behavior"] == "survey" and s_sv2["behavior"] == "survey"
          and (s_sv2["status"].get("wp_total") or 0) == 2,
          "survey started=%s, after Stop+Start=%s wp_total=%s"
          % (s_sv["behavior"], s_sv2["behavior"], s_sv2["status"].get("wp_total")))

    # 10. AND THE RESUME STILL KEEPS ITS NAME. This is the rule review #8 added and it must
    # survive the change: a PAUSE applies no plan, so the read-back returns what was loaded.
    api(port, "/api/cmd/escape", {"lat": tgt["lat"], "lon": tgt["lon"], "hold_clear_m": 9.0})
    for _ in range(80):
        if state(port)["status"].get("holding"):
            break
        time.sleep(0.25)
    api(port, "/api/cmd/pause", {})
    time.sleep(0.5)
    api(port, "/api/cmd/start", {})
    time.sleep(0.8)
    s_rz = state(port)
    check("10. ... and a PAUSE then Start still keeps the name, which is the rule the resume "
          "exemption was written for",
          s_rz["behavior"] == "escape",
          "resumed escape reads behavior=%s" % s_rz["behavior"])

    srvlog.seek(0)
    log = srvlog.read()
    check("7. the server's own log shows no traceback from any of it",
          "Traceback" not in log, log[-300:].replace("\n", " | ") if "Traceback" in log else "clean")
finally:
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()

print("\n%d CHECK(S) FAILED" % fails if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
