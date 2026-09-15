"""tests/env_water.py - /api/env and /api/waterlevel, and THE FIX the grounding pass
found before a single check was written.

THE DEFECT (reproduced live, then fixed): the waterlevel branch sits BEFORE
_dispatch_post's try/except, and its manual_offset cast was a bare float() - the only
unguarded numeric cast outside the guarded region (swept: /api/env guards its floats
locally, ROC's sit inside their own 400-returning try). POST {"manual_offset": "abc"}
unwound the dispatcher: the client's connection DROPPED with no response at all and the
handler thread died with a ValueError traceback. A cousin of the /api/ais/radius shape,
but worse for the client - ais/radius at least answered before dying. Now a 400 naming
the rule, in /api/env's local-guard style; check 7 restores the exact defect by mutation.

THE ENV CONTRACTS (read from EnvMonitor, asserted live):
  * The override MERGES over the fetched base, field by field: wind_kn then wind_from in
    two posts both stand; "" clears ONE field; {"auto": true} drops the whole override
    and the source reverts. Non-numeric values are a 400 "must be numeric".
  * THE PHYSICS SEAM - the check that matters: an enabled manual wind REACHES the boat.
    `EnvMonitor.field()` is the sim's physics view and the status publishes
    `env_set_kn`, the environmental set actually applied - so a running boat under a
    25 kn manual wind must publish a nonzero set, and DISABLING the monitor must return
    it to zero (field() -> None; calm reproduces clean tracking - that None is why the
    default sim tracks clean, and losing it would put phantom drift under every test
    that assumes calm water). Asserting the snapshot alone would repeat the estop
    lesson: every console flag can look right while the boat never hears.
  * env is applied ONLY while running and not e-stopped - the disabled/idle boat's set
    stays zero.

THE WATERLEVEL CONTRACTS:
  * manual_offset FLOAT sets the override: snapshot source "manual", ok true, offset_m
    echoed rounded, the note quotes the value. "" (the clear-the-box spelling) or null
    clears it: source falls back to station/none and the manual note is gone. The
    trust/ghosting chain on top of this value is client-side and already covered by
    tests/water_trust.js - this suite owns the SERVER half of the contract.
  * "abc" is a 400 naming the rule - and the console SURVIVES it (the fix, both halves:
    the answer exists and the thread lives; the final log check would catch a
    dead-thread variant that somehow answered).
  * refresh: true answers ok (the fetch outcome is upstream's business, not asserted).

    python tests/env_water.py       # exit 0 = pass, 1 = fail   (stdlib only)

TEETH - six mutations RUN, 6/6 caught (recorded results; house rules: missing anchor =
SKIP, crash scored separately, source restored byte-for-byte):
  * THE DEFECT RESTORED: waterlevel's float unguarded again  -> caught by 7 AND 9 - the
    two halves of the fix's proof: the 400 stops existing (7, connection dropped) and
    the thread dies with a traceback (9). Checks 6 and 7 are wrapped so a dropped
    connection reads as a FAILED CHECK, not a dead harness scored CRASH.
  * env's numeric guard dropped the same way                 -> caught by 6 and 9
  * field() stops honouring enabled (env leaks while off)    -> caught by 4 (the manual
    wind STANDS after disable - disable is not clear - so a leaking field() keeps
    pushing the boat and the set never returns to zero)
  * set_manual stops merging (each post replaces the map)    -> caught by 5, NOT the 3
    first predicted: 3's two wind fields arrive in one body, so replace-semantics look
    identical there; only 5's two-post sequence (waves, then clear-wind) can tell a
    merge from a replace. The check that catches a merge bug must SPAN posts.
  * auto stops clearing the override                         -> caught by 5
  * waterlevel's '' clear becomes a 0.0 override             -> caught by 8 (a cleared
    box and a zero-metre override are different states with the same rendered number -
    source says which)
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
    try:
        ok = bool(cond()) if callable(cond) else bool(cond)
        if callable(detail):
            detail = detail()
    except Exception as e:
        ok = False
        detail = "threw %s: %s" % (type(e).__name__, e)
    print(("  ok   " if ok else "  FAIL ") + name + ("   [" + str(detail) + "]" if detail else ""))
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
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def cmd(port, path, body=None):
    """POST; {} minimum so a bodyless command can never degrade to a GET."""
    return api(port, path, body if body is not None else {})


def state(port):
    return api(port, "/api/state")[1]


def wait_for(port, pred, limit=60.0, every=0.5):
    t0 = time.time()
    st = state(port)
    while time.time() - t0 < limit:
        st = state(port)
        try:
            if pred(st):
                return st
        except Exception:
            pass
        time.sleep(every)
    return st


print("Env + water level — the override reaches the boat, and bad input is an answer:")

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
    for _ in range(80):
        try:
            st0 = state(port).get("status") or {}
            if st0.get("speed_key") and st0.get("lat_deg") is not None:
                up = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    check("1. a console comes up, with the link reporting", up)
    if not up:
        raise SystemExit(1)

    # 2-4. THE PHYSICS SEAM. A manual 25 kn wind + enabled monitor + a RUNNING boat ->
    # the sim publishes a nonzero environmental set; disable -> back to calm. Idle
    # first: env applies only while running, so the idle set must be zero even enabled.
    cmd(port, "/api/env", {"enabled": True, "wind_kn": 25.0, "wind_from": 270.0})
    st = state(port)
    check("2. enabled + manual wind on an IDLE boat: the set stays zero - env is applied "
          "only to a running boat",
          lambda: not (st["status"].get("env_set_kn") or 0),
          lambda: "env_set_kn=%s" % st["status"].get("env_set_kn"))

    cmd(port, "/api/cmd/arm", {"on": True})
    cmd(port, "/api/cmd/speed", {"speed": "survey"})
    cmd(port, "/api/cmd/goto", {"lat": st0["lat_deg"] + 0.05, "lon": st0["lon_deg"] + 0.03})
    st = wait_for(port, lambda s: (s["status"].get("env_set_kn") or 0) > 0.1, limit=40)
    check("3. ... RUNNING, the manual wind REACHES the boat: a nonzero set is applied "
          "(the seam, not the snapshot)",
          lambda: (st["status"].get("env_set_kn") or 0) > 0.1,
          lambda: "env_set_kn=%.2f" % (st["status"].get("env_set_kn") or 0))
    _c, snap = cmd(port, "/api/env", {})
    check("3b. ... and the snapshot agrees: source manual, both wind fields standing",
          lambda: snap["env"].get("source") == "manual"
          and snap["env"]["wind"].get("speed_kn") == 25.0
          and snap["env"]["wind"].get("dir_from_deg") == 270.0,
          lambda: "source=%s wind=%s" % (snap["env"].get("source"), snap["env"].get("wind")))

    cmd(port, "/api/env", {"enabled": False})
    st = wait_for(port, lambda s: not (s["status"].get("env_set_kn") or 0), limit=20)
    check("4. DISABLING returns the boat to calm - field() must yield None, because calm "
          "reproducing clean tracking is what every other suite stands on",
          lambda: not (st["status"].get("env_set_kn") or 0),
          lambda: "env_set_kn=%s" % st["status"].get("env_set_kn"))

    # 5. Merge semantics the other way: clear ONE field with "", then AUTO drops all.
    cmd(port, "/api/env", {"enabled": True, "hs_m": 1.5})
    _c, s1 = cmd(port, "/api/env", {"wind_kn": ""})
    _c, s2 = cmd(port, "/api/env", {"auto": True})
    check("5. '' clears ONE field (waves stand, wind gone); auto drops the WHOLE override "
          "and the source reverts",
          lambda: (s1["env"]["sea"] or {}).get("hs_m") == 1.5
          and (s1["env"].get("wind") or {}).get("speed_kn") != 25.0
          and s2["env"].get("source") != "manual",
          lambda: "after-clear wind=%s sea=%s; after-auto source=%s"
                  % (s1["env"].get("wind"), (s1["env"].get("sea") or {}).get("hs_m"),
                     s2["env"].get("source")))
    cmd(port, "/api/env", {"enabled": False})

    # 6. env's own numeric guard (the pattern waterlevel now shares). Wrapped like 7:
    # if the guard is cut, this branch also sits before the dispatch try, so the
    # request DROPS the connection - that must read as a failed CHECK, not a dead
    # harness the mutation runner scores as CRASH.
    try:
        c6, b6 = cmd(port, "/api/env", {"wind_kn": "gale"})
        check("6. a non-numeric env value is a 400 naming the rule",
              lambda: c6 == 400 and "numeric" in (b6.get("error") or ""),
              lambda: "%s %s" % (c6, (b6.get("error") or "")[:40]))
    except Exception as e:
        check("6. a non-numeric env value is a 400 naming the rule",
              False, "connection-level failure: %s" % type(e).__name__)

    # 7. THE FIX. Before it, this exact request dropped the connection with NO response
    # and killed the handler thread (reproduced live). Now it is an ANSWER.
    try:
        c7, b7 = cmd(port, "/api/waterlevel", {"manual_offset": "abc"})
        check("7. a non-numeric manual_offset is a 400 naming the rule - an ANSWER, not "
              "a dropped connection",
              lambda: c7 == 400 and "numeric" in (b7.get("error") or ""),
              lambda: "%s %s" % (c7, (b7.get("error") or "")[:44]))
    except Exception as e:
        check("7. a non-numeric manual_offset is a 400 naming the rule - an ANSWER, not "
              "a dropped connection",
              False, "connection-level failure: %s" % type(e).__name__)

    # 8. The manual override round-trip, server half (the client trust chain is
    # water_trust.js's).
    _c, w1 = cmd(port, "/api/waterlevel", {"manual_offset": 0.8})
    _c, w2 = cmd(port, "/api/waterlevel", {"manual_offset": ""})
    check("8. a manual offset sets (source manual, value echoed, note quotes it) and '' "
          "CLEARS it",
          lambda: w1["water"].get("source") == "manual" and w1["water"].get("offset_m") == 0.8
          and "manual override" in (w1["water"].get("note") or "")
          and w2["water"].get("source") != "manual"
          and "manual override" not in (w2["water"].get("note") or ""),
          lambda: "set: %s %.1f m; cleared: %s"
                  % (w1["water"].get("source"), w1["water"].get("offset_m") or -1,
                     w2["water"].get("source")))
    c8, w3 = cmd(port, "/api/waterlevel", {"refresh": True})
    check("8b. refresh answers ok - the fetch's outcome is upstream's business",
          lambda: c8 == 200 and w3.get("ok") is True,
          lambda: "%s ok=%s" % (c8, w3.get("ok")))

finally:
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()

srvlog.seek(0)
server_out = srvlog.read()
srvlog.close()
tb = [ln.strip() for ln in server_out.splitlines()
      if "Traceback" in ln or "Error" in ln or "Exception occurred" in ln]
check("9. the console logged NO exception while serving those requests",
      not tb,
      ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb
      else "an answered request can still kill its handler")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
