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
    api(port, "/api/cmd/stop")
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
