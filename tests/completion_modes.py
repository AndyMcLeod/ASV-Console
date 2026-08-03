#!/usr/bin/env python3
"""tests/completion_modes.py - END-OF-PLAN SETTING vs RUN COMPLETION.

The bug this exists to prevent, reported live: the operator had selected End of Plan
RTH, and the console reported loiter.

Root cause was a CONFLATED FIELD. `Engine.completion` was doing two unrelated jobs:

  * the operator's END-OF-PLAN SETTING - a persistent preference, owned by the mission
    store, that decides what happens when a SURVEY/SEARCH PLAN finishes
  * the completion mode of the RUN CURRENTLY IN PROGRESS - transient, rewritten by
    every command

Go-To, RTH, Hold and Transit all correctly station-keep at their own endpoint, so
`_run_route()` set the field to "loiter" - and thereby overwrote the operator's setting
with it. Nothing restored it. The command bar still SHOWED RTH while the console acted
on loiter, and the end-of-plan RTH chain (which gates on that value) was silently
disarmed until the next plan start re-read the mission.

The fix is structural rather than a patch: one field per concept.

  * `plan_completion()` - the SETTING, cached from the mission store, refreshed on every
    mission read and write. No Engine method writes it, so no behaviour can clobber it.
  * `Engine.run_completion` - what the run in progress does at ITS end.
  * BOTH are published on the state. The command-bar selector and the RTH chain read the
    setting; the RUN MODE readout reads the run.

This test drives a REAL console over the API, because the failure was an interaction
between a command and persisted state - exactly what a unit test of either half alone
would have missed.

  python tests/completion_modes.py      # exit 0 = pass, 1 = fail   (stdlib only)

TEETH (verified by mutation, not assumed): publish `run_completion` as the state's
"completion" and 3, 7, 8 and 9 fail. Have `_run_route` write the setting - the exact old
code - and 3 and 7 fail. Have `start()` ignore `plan_completion()` and 10 fails. Break the
mission-store cache refresh and 8 fails.
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

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)

fails = 0


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
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


print("End-of-plan SETTING vs the run in progress — they are two different things:")

port = free_port()
# A scratch mission file so the developer's own plan is never touched by the test.
mission_bak = None
mpath = os.path.join(APP, "mission.json")
if os.path.exists(mpath):
    with open(mpath, "r", encoding="utf-8") as f:
        mission_bak = f.read()

# Capture the server's output rather than discarding it - see the last check. A handler that
# answers correctly and THEN raises is invisible to any client-side assertion, which is how
# /api/ais/radius shipped broken past a green suite. A file, not a PIPE: nothing drains a
# pipe while the console runs, so a full buffer would hang the test.
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
    check("1. a console comes up to drive", up)
    if not up:
        raise SystemExit(1)

    # 2. The setting round-trips through the mission store and the state publishes it.
    m = api(port, "/api/mission")
    m["completion"] = "rth"
    api(port, "/api/mission", m)
    st = api(port, "/api/state")
    check("2. End of Plan RTH is stored and published as the SETTING",
          api(port, "/api/mission").get("completion") == "rth" and st.get("completion") == "rth",
          "mission=%s state.completion=%s" % (api(port, "/api/mission").get("completion"),
                                              st.get("completion")))

    # 3-4. THE REPORTED BUG. Command a Go-To - which legitimately station-keeps at its
    # own endpoint - and the operator's end-of-plan setting must not move.
    api(port, "/api/cmd/arm", {"on": True})
    # WAIT for a fix rather than assuming one: the sim needs a few telemetry ticks after
    # the link attaches, and asking too early made this test fail on check 5 for reasons
    # that had nothing to do with what it is testing. A test that fails for the wrong
    # reason is worse than no test - it discredits the real assertions around it.
    lat = lon = None
    for _ in range(60):
        stt = (api(port, "/api/state").get("status") or {})
        lat, lon = stt.get("lat_deg"), stt.get("lon_deg")
        if lat is not None and lon is not None:
            break
        time.sleep(0.5)
    check("5. the sim reports a position to aim from (waited for the fix)",
          lat is not None and lon is not None)
    if lat is None or lon is None:
        raise SystemExit(1)
    api(port, "/api/cmd/goto", {"lat": lat + 0.002, "lon": lon + 0.002})
    time.sleep(1.0)
    st = api(port, "/api/state")
    check("3. AFTER A GO-TO THE END-OF-PLAN SETTING IS STILL RTH",
          st.get("completion") == "rth",
          "state.completion=%s (was overwritten with loiter before the fix)" % st.get("completion"))
    check("4. ... while the RUN in progress correctly reports loiter",
          st.get("run_completion") == "loiter" and st.get("behavior") == "goto",
          "behavior=%s run_completion=%s" % (st.get("behavior"), st.get("run_completion")))
    check("6. the mission store was never touched by the command",
          api(port, "/api/mission").get("completion") == "rth")

    # 7. Every other endpoint-station-keeping behaviour behaves the same way. Hold is the
    # cheapest to command and goes through the same _run_route path.
    api(port, "/api/cmd/hold", {})
    time.sleep(0.6)
    st = api(port, "/api/state")
    check("7. Hold likewise leaves the setting alone",
          st.get("completion") == "rth", "state.completion=%s" % st.get("completion"))

    # 8. A changed setting propagates without a restart - the cache tracks the store.
    m = api(port, "/api/mission")
    m["completion"] = "repeat"
    api(port, "/api/mission", m)
    time.sleep(0.4)
    check("8. changing the setting propagates to the state (cache tracks the store)",
          api(port, "/api/state").get("completion") == "repeat",
          "state.completion=%s" % api(port, "/api/state").get("completion"))

    # 10. THE OTHER HALF OF THE CONTRACT. A PLAN run must ADOPT the setting - it is the
    # only run type the setting is about. Without this, `start()` could ignore
    # plan_completion() entirely and every check above would still pass: the setting
    # would be faithfully preserved and then never used, which is its own silent failure.
    m = api(port, "/api/mission")
    m["completion"] = "repeat"
    m["waypoints"] = [{"lat": lat + 0.001, "lon": lon + 0.001},
                      {"lat": lat + 0.002, "lon": lon + 0.001}]
    api(port, "/api/mission", m)
    api(port, "/api/cmd/arm", {"on": True})
    api(port, "/api/cmd/upload", {})
    api(port, "/api/cmd/start", {})
    time.sleep(1.0)
    st = api(port, "/api/state")
    check("10. a PLAN run adopts the setting (not a hardcoded default)",
          st.get("run_completion") == "repeat" and st.get("completion") == "repeat",
          "behavior=%s run_completion=%s setting=%s"
          % (st.get("behavior"), st.get("run_completion"), st.get("completion")))
    api(port, "/api/cmd/stop", {})
    time.sleep(0.4)

    # 9. An invalid value cannot poison the setting; it falls back to the safe default.
    m = api(port, "/api/mission")
    m["completion"] = "nonsense"
    api(port, "/api/mission", m)
    time.sleep(0.4)
    check("9. an invalid end-of-plan value falls back to RTH, it does not stick",
          api(port, "/api/state").get("completion") == "rth",
          "state.completion=%s" % api(port, "/api/state").get("completion"))
finally:
    proc.terminate()
    try:
        proc.wait(timeout=6)
    except Exception:
        proc.kill()
    if mission_bak is not None:
        with open(mpath, "w", encoding="utf-8") as f:
            f.write(mission_bak)
    elif os.path.exists(mpath):
        os.remove(mpath)

# THE SERVER SURVIVED EVERY REQUEST ABOVE. Runs after the console is stopped, so its output
# is complete. _send() writes the response BEFORE its caller can raise, so an endpoint can
# answer a client perfectly and still take down its handler thread - no client-side check
# can see that. /api/ais/radius did exactly this, past a fully green suite.
srvlog.seek(0)
server_out = srvlog.read()
srvlog.close()
tb = [ln.strip() for ln in server_out.splitlines()
      if "Traceback" in ln or "Error" in ln or "Exception occurred" in ln]
check("11. the console logged NO exception while serving those requests",
      not tb,
      ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb
      else "an answered request can still kill its handler")

print("\n" + ("%d CHECK(S) FAILED" % fails if fails else "all checks passed"))
sys.exit(1 if fails else 0)
