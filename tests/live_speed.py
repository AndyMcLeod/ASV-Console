"""tests/live_speed.py - the commanded speed is a LIVE command, not a property of the
last upload.

Andy's report: speed over ground is not changing with user speed changes; these changes
must be updated in real time, with application-wide awareness of the vessel state and how
it affects the simulation.

He was exactly right, and it was not a display fault. `SimVcu._speed_key` was set in ONE
place - `upload_plan()` - so the commanded speed reached the vessel only as a side effect of
uploading a plan. Moving the selector mid-run recomputed every planning figure on screen
(turn geometry, durations, per-line times) and the vessel carried on at whatever speed it
had been uploaded with. Speed over ground never moved, because nothing had told the vessel
anything. There was no speed command at all: no seam method, no engine method, no endpoint.

This is the sibling of the approach radius sitting beside it in the command bar, which HAS
been a live command all along (`/api/cmd/approach`).

    python tests/live_speed.py      # exit 0 = pass, 1 = fail   (stdlib only)

It drives a REAL console over the API, like tests/completion_modes.py, because the failure
is an interaction between a command, the link's internal state and the persisted mission -
a unit test of any one of those alone would have missed it. It also has to let the vessel
ACCELERATE to prove the point: asserting that the command was accepted proves nothing, since
the old code accepted the selector change too. Only speed over ground settling on the new
value proves the vessel was told.

TEETH (verified by mutation, not assumed): drop `SimVcu.set_speed`'s assignment so the
command lands nowhere - PRECISELY THE REPORTED BUG RESTORED - and 6 and 7 fail, the two that
measure speed over ground actually moving. Stop publishing `speed_key` and 1 fails at the
readiness gate, before anything else can report a misleading result. Accept any string
instead of validating against the vessel's own speeds and 4 fails. Skip the mission write in
`Engine.set_speed` and 8 fails - an Upload would then revert the vessel to the stored speed
behind the operator's back.
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

# --- crash guard: a throw outside a check() must still REPORT ---------------------------
# check() turns an exception inside its own thunk into a failed check. Scenario SETUP is
# not inside one - booting a console, driving an endpoint, waiting on a fix - and an
# exception there would end the process before a single FAIL line printed. "No FAIL lines"
# and "the process died" are indistinguishable to anything reading stdout, so a mutation
# that crashes this suite would score as SURVIVED rather than caught. Report it instead, in
# this suite's normal format; Python still exits non-zero on its own.
def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report


APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)

fails = 0
ran = 0


def check(name, cond, detail=""):
    global fails, ran
    ran += 1
    print(("  ok   " if cond else "  FAIL ") + name + ("   [" + detail + "]" if detail else ""))
    if not cond:
        fails += 1


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def api(port, path, body=None, timeout=8):
    url = "http://127.0.0.1:%d%s" % (port, path)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:              # the console answers 4xx with a JSON body
        return json.loads(e.read().decode())


def status(port):
    return api(port, "/api/state")["status"]


def settle(port, want_kn, limit=40.0):
    """Wait for speed over ground to settle near `want_kn`. Returns the speed reached.
    The simulator ramps at a bounded rate and the environment adds a little set, so this
    waits for the value to stop climbing rather than expecting an instant jump."""
    t0, best = time.time(), 0.0
    while time.time() - t0 < limit:
        sog = status(port).get("sog_kn") or 0.0
        best = max(best, sog)
        if abs(sog - want_kn) <= max(0.6, want_kn * 0.12):
            return sog
        time.sleep(0.5)
    return best


print("Live speed — the commanded speed has to reach the vessel, not just the readout:")

port = free_port()
# ITS OWN STATE FOLDER (review #16): this console never reads or writes the operator's plan, settings
# or logs - no snapshot of mission.json, and no write-back of one when the suite ends.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from console_state import ConsoleState  # noqa: E402
STATE = ConsoleState()

# Capture the server's output rather than discarding it - see the last check. A handler that
# answers correctly and THEN raises is invisible to any client-side assertion, which is how
# /api/ais/radius shipped broken past a green suite. A file, not a PIPE: nothing drains a
# pipe while the console runs, so a full buffer would hang the test.
srvlog = tempfile.TemporaryFile(mode="w+")
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none",
                         "--port", str(port), "--no-ais-service", "--no-log", *STATE.args()],
                        cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
try:
    # READY means the console is answering AND the simulated link has produced a telemetry
    # frame - not merely that the port is open. An earlier version waited only for a reply
    # and checks 3 and 4b flaked on an empty status, which is the worst kind of failure:
    # it discredits every assertion around it while pointing at the wrong thing.
    up = False
    for _ in range(80):
        try:
            st0 = api(port, "/api/state", timeout=2).get("status") or {}
            if st0.get("speed_key") and st0.get("lat_deg") is not None:
                up = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    check("1. a console comes up, with the link reporting", up)
    if not up:
        raise SystemExit(1)

    # The vessel's own speeds, from its profile - never hardcoded here.
    speeds = api(port, "/api/vessel")["vessel"]["propulsion"]["speeds_kn"]
    check("2. the vessel publishes its own speed set", set(speeds) >= {"low", "survey", "high"},
          json.dumps(speeds))

    # The plan file's own `speed`, read before any speed command - check 8 holds it unchanged.
    plan_speed_at_start = api(port, "/api/mission").get("speed")

    # 3. APPLICATION-WIDE AWARENESS. The state has to carry what the vessel is running to,
    # or nothing downstream can tell the selector and the vessel apart.
    api(port, "/api/cmd/speed", {"speed": "survey"})
    st = status(port)
    check("3. the state publishes the COMMANDED speed and its value",
          st.get("speed_key") == "survey"
          and abs((st.get("speed_target_kn") or 0) - speeds["survey"]) < 0.05,
          "speed_key=%s target=%s" % (st.get("speed_key"), st.get("speed_target_kn")))

    # 4. Refusal, paired with the acceptance above so a method that refused EVERYTHING
    # could not pass. The valid set is the vessel's, so a profile with different speeds
    # validates against its own.
    r = api(port, "/api/cmd/speed", {"speed": "warp"})
    check("4. an unknown speed is REFUSED and names the valid set",
          r.get("error") and "warp" in r["error"] and "survey" in r["error"],
          str(r.get("error"))[:70])
    check("4b. ... and the refusal left the vessel on its previous speed",
          status(port).get("speed_key") == "survey")

    # 5-7. THE REPORTED FAULT. Get the vessel genuinely under way, then change speed and
    # watch SPEED OVER GROUND follow. Accepting the command proves nothing - the old code
    # accepted it too and dropped it on the floor.
    api(port, "/api/cmd/arm", {"on": True})
    for _ in range(40):                              # wait for a position fix to aim from
        s0 = status(port)
        if s0.get("lat_deg") is not None:
            break
        time.sleep(0.5)
    api(port, "/api/cmd/speed", {"speed": "low"})
    # A long straight leg in open water. No client route, so this is NOT ENC-routed - fine
    # here because the subject is speed, not obstacle clearance (see CLAUDE.md).
    api(port, "/api/cmd/goto", {"lat": s0["lat_deg"] + 0.05, "lon": s0["lon_deg"] + 0.03})
    low = settle(port, speeds["low"])
    check("5. under way, speed over ground settles on the commanded LOW",
          abs(low - speeds["low"]) <= max(0.6, speeds["low"] * 0.12),
          "%.2f kn vs %.1f commanded" % (low, speeds["low"]))

    api(port, "/api/cmd/speed", {"speed": "high"})
    high = settle(port, speeds["high"])
    check("6. THE REPORTED FAULT: raising the speed mid-run RAISES speed over ground",
          high > low + 1.0 and abs(high - speeds["high"]) <= max(0.6, speeds["high"] * 0.12),
          "%.2f -> %.2f kn (commanded %.1f)" % (low, high, speeds["high"]))

    api(port, "/api/cmd/speed", {"speed": "survey"})
    surv = settle(port, speeds["survey"])
    check("7. ... and lowering it LOWERS speed over ground, so it tracks both ways",
          surv < high - 1.0 and abs(surv - speeds["survey"]) <= max(0.6, speeds["survey"] * 0.12),
          "%.2f -> %.2f kn (commanded %.1f)" % (high, surv, speeds["survey"]))

    # 8. THE LIVE SPEED IS THE VESSEL'S, NOT THE PLAN FILE'S (review #5, 2026-09-14). This check
    # used to require the change be PERSISTED, so a later command would re-send it - and that
    # persistence was a whole-plan load-edit-save on every speed command, which on Windows
    # failed with WinError 5 whenever a read was in flight: a 500, and the speed never reached
    # the boat. The intent survives without the write: the next commanded motion takes the
    # speed the vessel is running, and the plan file is left alone.
    # A speed the FILE does not already hold, or an old write-back would leave it looking untouched.
    k8 = next(k for k in ("high", "low", "survey") if k != plan_speed_at_start)
    api(port, "/api/cmd/speed", {"speed": k8})
    api(port, "/api/cmd/goto", {"lat": s0["lat_deg"] + 0.04, "lon": s0["lon_deg"] + 0.02})
    time.sleep(0.6)
    st8 = status(port)
    plan_speed_now = api(port, "/api/mission").get("speed")
    check("8. a live speed change carries into the next commanded motion, and is NOT written into the plan file",
          st8.get("speed_key") == k8 and plan_speed_now == plan_speed_at_start,
          "speed_key after a new Go-To=%s; the file's speed %s -> %s"
          % (st8.get("speed_key"), plan_speed_at_start, plan_speed_now))
    api(port, "/api/cmd/speed", {"speed": "survey"})   # check 9 reads the announcement of THIS

    # 9. A speed change is worth a line in the session record. It sets `note`, which is a
    # salient field, so the recorder takes a full snapshot without needing its own rule.
    check("9. the change is announced on the state, so it is recorded and visible",
          "survey" in (api(port, "/api/state").get("note") or "").lower(),
          (api(port, "/api/state").get("note") or "")[:60])

finally:
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()

# THE SERVER SURVIVED EVERY REQUEST ABOVE. Runs after the console is stopped, so its output
# is complete. _send() writes the response BEFORE its caller can raise, so an endpoint can
# answer a client perfectly and still take down its handler thread - no client-side check
# can see that. /api/ais/radius did exactly this, past a fully green suite.
srvlog.seek(0)
server_out = srvlog.read()
srvlog.close()
tb = [ln.strip() for ln in server_out.splitlines()
      if "Traceback" in ln or "Error" in ln or "Exception occurred" in ln]
check("10. the console logged NO exception while serving those requests",
      not tb,
      ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb
      else "an answered request can still kill its handler")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
