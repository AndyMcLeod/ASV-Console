"""tests/estop_chain.py - E-STOP actually stops the boat, and stays latched.

WHY THIS EXISTS, and it is not because E-STOP broke. It is because it never has.

Twenty regression suites were written before this one and every one of them was written
REACTIVELY, the day a specific fault was reported. That shapes the net by HISTORY rather
than by CONSEQUENCE: the code most likely to be guarded is the code that has already
failed, and the most safety-critical control in the console had no behavioural test at all.
Before this file, the only two mentions of `estop` in the whole of tests/ were
`end_action.js` check 8, which asserts what the CARD PREDICTS when the flag is true (a pure
display function - no boat, no link, no engine), and `http_contract.py`, which POSTs
`{"on": false}` - E-STOP OFF - purely to prove the handler returns its `(code, obj)` tuple.
Nothing anywhere engaged it and looked at the vessel.

`Engine.set_estop(True)` does FIVE distinct things and the test has to earn each one:
latches `estop`, drives `link.estop()` through the VCU seam, force-disarms, forces `run` to
idle, and latches an operator note. Three separate `_require(not self.estop, ...)` guards
then refuse arm / upload / start / go-to while it holds.

    python tests/estop_chain.py     # exit 0 = pass, 1 = fail   (stdlib only)

It drives a REAL console, like tests/live_speed.py, and for the same reason: the fault mode
is an interaction between an endpoint, the engine's lock-held state and the link's own
internal motion flags. A unit test of any one of those would miss a break in the other two.
And as in live_speed, the vessel has to be genuinely UNDER WAY first - asserting that
E-STOP is accepted proves nothing, because a chain that stopped the boat unconditionally,
or one that never started it, would pass that too. Check 3 is the acceptance case that
makes checks 5-9 mean something.

RELEASE IS PART OF THE CONTRACT, not an afterthought. E-STOP that cannot be cleared is a
different bug from E-STOP that does not latch, and check 11 pairs with 12: releasing leaves
the vessel SAFE and disarmed (it must not silently re-arm or resume), and after a
deliberate re-arm the boat runs again (it must not be a one-way trip).

TEETH - eight mutations RUN, not predicted. Six are caught alone; the two that survive do so
because a second mechanism genuinely carries the property, and each pair was then removed
TOGETHER to prove that (the technique from the roc_tracks audit: a layer that survives alone
is only acceptable once the pair is shown to be load-bearing).
  * `SimVcu.estop` stops latching `_estop`                     -> caught by 5b, 10c.
  * `SimVcu.estop` stops halting (`_running`/`sog_kn` kept)    -> caught by 5b, 11.
  * THE SEAM CUT - `Engine.set_estop` never calls `link.estop()`, the shape where every one
    of the console's own flags looks right and the vessel is never told
                                                               -> caught by 5, 5b, 7, 10b, 10c, 11.
  * `Engine.set_estop` stops force-disarming                   -> caught by 6, 11.
  * `set_armed` loses its e-stop guard                         -> caught by 9, 11.
  * release silently re-arms instead of leaving the vessel SAFE-> caught by 11.
  * the tick gate drops `not self._estop`                      -> SURVIVES, correctly:
    `SimVcu.estop` ALSO halts directly, so the gate is a redundant second layer. Remove BOTH
    halt layers and 5, 5b, 10b and 11 fail - so the property is covered, the layer is not
    load-bearing on its own, and that is the right answer rather than a hole.
  * `Engine.set_estop` stops forcing `run` to idle             -> SURVIVES, correctly: the
    telemetry path re-derives it (`if telem.get("estop"): self.run = "idle"`), so `run=idle`
    has TWO producers. Remove both and 7 fails.

AN UNREACHABLE-GUARD FINDING, recorded here because the next person will re-derive it:
`upload`, `start` and `_run_route` each carry `_require(not self.estop, ...)`, but latching
ALWAYS force-disarms, and `_require(self.armed, ...)` is checked first in all three. Those
three e-stop guards can therefore never fire through the API - the operator always sees
"ARM before ...". They are defence in depth behind the disarm and are deliberately NOT
deleted (unlike the unreachable waterTrust duplicate, this backs a safety chain), but no
test can provoke their message, which is why check 10 asserts the REFUSAL and not the wording.

A NOTE ON THE HARNESS ITSELF (the stored_settings.js lesson, applied here): every condition
is a THUNK and a raised exception is reported as a FAILED check, never allowed to kill the
process. A suite that dies partway prints no FAIL line, and "no FAIL lines" is
indistinguishable from "passed" to anything that only parses stdout - which is how a
mutation once scored as SURVIVED when it had in fact crashed the run.
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
    """`cond` is a THUNK. A throw is a failed check, not a dead process - see the module
    docstring: a harness that cannot survive the fault it tests for cannot report it."""
    global fails, ran
    ran += 1
    try:
        ok = bool(cond()) if callable(cond) else bool(cond)
    except Exception as e:
        ok = False
        detail = "threw %s: %s" % (type(e).__name__, e)
    print(("  ok   " if ok else "  FAIL ") + name + ("   [" + detail + "]" if detail else ""))
    if not ok:
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


def state(port):
    """The ENGINE's own view: armed / run / autonomy / note / the commanded estop latch."""
    return api(port, "/api/state")


def status(port):
    """The LINK's telemetry: sog_kn / lat_deg / speed_key, and the vessel's OWN reported
    estop. Deliberately a different dict from state(): `estop` appears in BOTH and they are
    two different facts - what the console commanded, and what the vessel reports back. The
    telemetry one is the direct evidence that the VCU seam carried the command across."""
    return api(port, "/api/state")["status"]


def wait_moving(port, limit=40.0):
    """Wait for the vessel to be genuinely under way. Returns the best SOG seen.
    The simulator ramps at a bounded rate, so this waits rather than expecting a jump."""
    t0, best = time.time(), 0.0
    while time.time() - t0 < limit:
        sog = status(port).get("sog_kn") or 0.0
        best = max(best, sog)
        if sog > 1.0:
            return sog
        time.sleep(0.5)
    return best


def wait_link_estop(port, want, limit=15.0):
    """Wait for the LINK's reported estop to reach `want`. The engine's own field updates
    synchronously on the POST, but the telemetry one only lands on the next frame, so a
    single sample straight after the request races the tick - the same reasoning as
    wait_stopped, and it caught this suite out on release before the wait was added."""
    t0, v = time.time(), None
    while time.time() - t0 < limit:
        v = status(port).get("estop")
        if v is want:
            return v
        time.sleep(0.3)
    return v


def wait_stopped(port, limit=20.0):
    """Wait for speed over ground to fall to a standstill. Returns the last SOG seen.
    Bounded like wait_moving: E-STOP zeroes the link's speed directly, so this should be
    fast, but it is given room rather than sampled once - a single sample immediately after
    the POST would race the physics tick and flake."""
    t0, sog = time.time(), None
    while time.time() - t0 < limit:
        sog = status(port).get("sog_kn") or 0.0
        if sog <= 0.15:
            return sog
        time.sleep(0.4)
    return sog


print("E-STOP — the chain has to reach the vessel, latch, and let go cleanly:")

port = free_port()
# ITS OWN STATE FOLDER (review #16): this console never reads or writes the operator's plan, settings
# or logs - no snapshot of mission.json, and no write-back of one when the suite ends.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from console_state import ConsoleState  # noqa: E402
STATE = ConsoleState()

# Capture the server's output rather than discarding it - see the final check. A handler
# that answers correctly and THEN raises is invisible to any client-side assertion, which is
# how /api/ais/radius shipped broken past a fully green suite. A file, not a PIPE: nothing
# drains a pipe while the console runs, so a full buffer would hang the test.
srvlog = tempfile.TemporaryFile(mode="w+")
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none",
                         "--port", str(port), "--no-ais-service", "--no-log", *STATE.args()],
                        cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
try:
    # READY means answering AND the simulated link has produced a telemetry frame, not
    # merely that the port is open - an empty status discredits every assertion after it
    # while pointing at the wrong thing.
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

    check("2. E-STOP starts clear, so the latch below is a change and not the initial state",
          lambda: state(port).get("estop") is False and status(port).get("estop") is False,
          "engine=%s link=%s" % (state(port).get("estop"), status(port).get("estop")))

    # 3. THE ACCEPTANCE CASE. Everything below asserts that motion STOPS, so without a
    # vessel that is genuinely moving first, a console that never moved at all would pass
    # the whole suite. Same shape as live_speed: let it accelerate.
    api(port, "/api/cmd/arm", {"on": True})
    for _ in range(40):                              # a position fix to aim from
        s0 = status(port)
        if s0.get("lat_deg") is not None:
            break
        time.sleep(0.5)
    # A long straight leg in open water. No client route, so this is NOT ENC-routed - fine
    # here because the subject is the stop chain, not obstacle clearance (see CLAUDE.md).
    api(port, "/api/cmd/goto", {"lat": s0["lat_deg"] + 0.05, "lon": s0["lon_deg"] + 0.03})
    moving = wait_moving(port)
    check("3. the vessel is genuinely UNDER WAY before anything is stopped",
          moving > 1.0, "%.2f kn" % moving)
    check("4. ... and the console agrees it is running and armed",
          lambda: state(port).get("run") == "running" and state(port).get("armed") is True,
          "run=%s armed=%s" % (state(port).get("run"), state(port).get("armed")))

    # 5-8. THE LATCH. Four separate consequences of one command, asserted separately,
    # because they fail independently: the seam carries the stop to the vessel, and the
    # engine's own flags record it. A cut seam leaves 6/7/8 perfectly green.
    api(port, "/api/cmd/estop", {"on": True})
    stopped = wait_stopped(port)
    check("5. E-STOP REACHES THE VESSEL: speed over ground falls to a standstill",
          stopped is not None and stopped <= 0.15,
          "%.2f -> %.2f kn" % (moving, stopped if stopped is not None else -1))
    link_latched = wait_link_estop(port, True)
    check("5b. ... and the VESSEL ITSELF reports the stop, so the seam carried it across "
          "(not just the console's own flags agreeing with each other)",
          lambda: link_latched is True and not status(port).get("running"),
          "link estop=%s running=%s" % (link_latched, status(port).get("running")))
    check("6. ... and it force-DISARMS, so nothing can be commanded without a deliberate re-arm",
          lambda: state(port).get("armed") is False,
          "armed=%s" % state(port).get("armed"))
    check("7. ... and the run is dropped to idle, not left reading as running",
          lambda: state(port).get("run") == "idle",
          "run=%s" % state(port).get("run"))
    check("8. ... and the autonomy readout names the e-stop, so the operator sees WHY it stopped",
          lambda: state(port).get("autonomy") == "e-stop" and state(port).get("estop") is True,
          "autonomy=%s estop=%s" % (state(port).get("autonomy"), state(port).get("estop")))

    # 9-10. IT STAYS LATCHED. Refusals, paired with the acceptance at 3 and 12 so a console
    # that refused EVERYTHING could not pass. Each names its own guard, because the three
    # `_require(not self.estop, ...)` sites are independent and one can be lost alone.
    r_arm = api(port, "/api/cmd/arm", {"on": True})
    check("9. arming is REFUSED while it holds, and the refusal says so",
          lambda: bool(r_arm.get("error")) and "E-STOP" in r_arm["error"].upper(),
          str(r_arm.get("error"))[:70])
    # WHICH guard fires here is NOT what this asserts, and the distinction is worth writing
    # down because the obvious assertion is wrong. `_run_route`, `start` and `upload` each
    # carry their own `_require(not self.estop, ...)`, but latching ALWAYS disarms (check 6),
    # so `_require(self.armed, ...)` fires first and the refusal reads "ARM before commanding
    # the boat" - never "clear E-STOP first". Those three e-stop guards are therefore
    # UNREACHABLE while the latch holds: they are defence in depth behind the disarm, and the
    # only reachable one is in `set_armed` (check 9). Asserting the E-STOP wording here would
    # be asserting a message the operator cannot actually provoke. What matters, and what is
    # asserted, is that the command is REFUSED and the boat does not move.
    r_goto = api(port, "/api/cmd/goto", {"lat": s0["lat_deg"] + 0.02, "lon": s0["lon_deg"]})
    check("10. a Go-To is REFUSED while it holds (via the disarm the latch forces)",
          lambda: bool(r_goto.get("error")),
          str(r_goto.get("error"))[:70])
    check("10b. ... and the vessel is still stopped after being commanded twice",
          lambda: (status(port).get("sog_kn") or 0.0) <= 0.15,
          "%.2f kn" % (status(port).get("sog_kn") or 0.0))
    check("10c. ... and the latch is still held, not cleared by the attempts",
          lambda: state(port).get("estop") is True and status(port).get("estop") is True,
          "engine=%s link=%s" % (state(port).get("estop"), status(port).get("estop")))

    # 11-12. RELEASE. An E-STOP that cannot be cleared is a different fault from one that
    # does not latch, so the release path is part of the contract and is tested as such.
    api(port, "/api/cmd/estop", {"on": False})
    wait_link_estop(port, False)                     # the telemetry frame, not the POST
    st_rel, tel_rel = state(port), status(port)
    # ⚠⚠ AND IT CLEARS THE PAUSE. `SimVcu.estop` was the only one of the three halts that
    # left `_paused` set - stop() and set_neutral() both clear it - so a boat E-STOPPED while
    # PAUSED came back reading `run = "paused"` the moment the latch was released. The page
    # routes Start into its RESUME path on exactly that word, so the operator was offered a
    # resume, and a resume posts a backtrack amendment, for a pause the E-STOP had ended.
    # ⚠ SEEDED PAUSED FIRST, or this cannot fail: an idle boat reads not-paused anyway, so
    # "correctly cleared" and "never set" are the same observation. The seed is the check.
    api(port, "/api/cmd/arm", {"on": True})
    api(port, "/api/cmd/goto", {"lat": s0["lat_deg"] + 0.002, "lon": s0["lon_deg"]})
    time.sleep(1.0)
    api(port, "/api/cmd/pause", {})
    time.sleep(0.5)
    st_paused = status(port)
    api(port, "/api/cmd/estop", {"on": True})
    time.sleep(0.6)
    st_latched = status(port)
    api(port, "/api/cmd/estop", {"on": False})
    wait_link_estop(port, False)
    st_after = state(port)
    check("11z. an E-STOP ENDS a pause: the latch clears the paused flag, so a released boat "
          "is not offered a Resume for a pause that no longer exists",
          bool(st_paused.get("paused")) is True
          and bool(st_latched.get("paused")) is False
          and st_after.get("run") != "paused",
          "paused before the latch=%s, during=%s; after release run=%s (the page routes Start "
          "into resumeRun on run == 'paused')"
          % (st_paused.get("paused"), st_latched.get("paused"), st_after.get("run")))

    check("11. releasing leaves the vessel SAFE — it clears the latch but does NOT re-arm or resume",
          lambda: st_rel.get("estop") is False and tel_rel.get("estop") is False
          and st_rel.get("armed") is False and st_rel.get("autonomy") == "safe"
          and (tel_rel.get("sog_kn") or 0.0) <= 0.15,
          "estop=%s/%s armed=%s autonomy=%s sog=%.2f"
          % (st_rel.get("estop"), tel_rel.get("estop"), st_rel.get("armed"),
             st_rel.get("autonomy"), tel_rel.get("sog_kn") or 0.0))

    api(port, "/api/cmd/arm", {"on": True})
    api(port, "/api/cmd/goto", {"lat": s0["lat_deg"] + 0.05, "lon": s0["lon_deg"] + 0.03})
    again = wait_moving(port)
    check("12. after a deliberate re-arm the boat runs again — E-STOP is not a one-way trip",
          again > 1.0, "%.2f kn" % again)

    # 13. The latch is announced on `note`, which is a SALIENT field, so the session
    # recorder takes a full snapshot of it without needing a rule of its own. An E-STOP
    # absent from the record is an E-STOP nobody can review after the fact.
    api(port, "/api/cmd/estop", {"on": True})
    check("13. the latch is announced on the state, so it is recorded and visible",
          lambda: "E-STOP" in (api(port, "/api/state").get("note") or "").upper(),
          (api(port, "/api/state").get("note") or "")[:60])

finally:
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()

# THE SERVER SURVIVED EVERY REQUEST ABOVE. Runs after the console is stopped, so its output
# is complete. `_send()` writes the response BEFORE its caller can raise, so an endpoint can
# answer a client perfectly and still take down its handler thread - no client-side check
# can see that. /api/ais/radius did exactly this, past a fully green suite.
srvlog.seek(0)
server_out = srvlog.read()
srvlog.close()
# tracebacks and routes that raised - not every line that says "Error" (tests/lib/server_log.py, review #17)
from server_log import exception_lines  # noqa: E402
tb = exception_lines(server_out)
check("14. the console logged NO exception while serving those requests",
      not tb,
      ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb
      else "an answered request can still kill its handler")

# 15-15b. A LINK THAT REFUSES (review #27, 2026-09-15). The real VCU link refuses every command today (RealVcu's
# _blocked), and Engine.set_estop set the flag BEFORE commanding it - so a refused LATCH showed E-STOP on a console still
# armed with its run under way (the disarm sat below the raise and never ran), and a refused RELEASE cleared the flag on
# a boat nobody had released. In-process: an Engine on a link whose estop() refuses, its state in the suite's folder.
import importlib.util as _ilu  # noqa: E402
_spec = _ilu.spec_from_file_location("asv_console_estop_refused", os.path.join(APP, "asv_console.py"))
_C = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_C)
_C.use_state_dir(STATE.dir)


class _RefusingLink(_C.VcuLink):                   # the real base, so everything but estop() is the link's own default
    def estop(self, on):
        raise _C.VcuProtocolError("the link refused the command")

    def set_neutral(self):
        pass


E = _C.Engine()
E._link, E.armed, E.run = _RefusingLink(), True, "running"


def _attempt(fn):
    try:
        fn()
        return None
    except Exception as e:
        return e


latch_err = _attempt(lambda: E.set_estop(True))
latched = (E.estop, E.armed, E.run, E.note or "")
release_err = _attempt(lambda: E.set_estop(False))
check("15. a latch the link REFUSES still latches the console - E-STOP set, disarmed, idle - says the vessel did not take "
      "it, and still answers with the refusal",
      lambda: isinstance(latch_err, _C.VcuProtocolError) and latched[:3] == (True, False, "idle")
      and "did not take" in latched[3],
      "raised %r; estop=%s armed=%s run=%s; note: %s" % (latch_err, latched[0], latched[1], latched[2], latched[3][:70]))
check("15b. ... and a release the link refuses leaves it LATCHED, saying so - a flag is not cleared on a boat nobody "
      "released",
      lambda: isinstance(release_err, _C.VcuProtocolError) and E.estop is True and "NOT released" in (E.note or ""),
      "raised %r; estop=%s; note: %s" % (release_err, E.estop, (E.note or "")[:70]))

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
