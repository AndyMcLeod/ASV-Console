"""tests/supervisor.py - one browser tab supervises the console; the others watch (review #14, 2026-09-15).

Andy: "All supervision lives in one browser tab."

⚠ TWO TABS ARE TWO SAFETY LADDERS. The clearance guard, the speed governor and the end-of-plan RTH chain all run in the
PAGE, so a second tab commands the same boat from its own reading of the world - and a tab the browser has throttled or
slept is a ladder that has quietly stopped, with nothing on screen to say so. Both arrive at the console looking like
ordinary commands. So each tab names itself (X-ASV-Client) and reports in every SUPERVISOR_BEAT_S; the console grants
supervision to exactly one, refuses the others' commands in words, and says when the supervising tab goes quiet.

WHAT IS DELIBERATELY NOT GATED, and each has a check here:
  * STOP, PAUSE and E-STOP from any tab, supervising or not. A control that reduces risk is never gated on
    bookkeeping - the same rule review #25 wrote for content types.
  * A caller with no tab name at all: a script, a suite, curl. This guards the operator's own second window, not the
    API, and refusing anonymous callers would break every harness that drives the console directly.
  * The plan (/api/mission). A second screen may draw and save while the first supervises; the plan's own revision
    guard (review #10) is what stops two tabs overwriting each other, and it already works.
  * The boat. A lapsed heartbeat is an ALARM, not a hold: a browser hiccup stopping a survey mid-line is its own
    hazard, and nothing the vessel does depends on the page. Whether it should ever hold is the operator's call.

    python tests/supervisor.py      # exit 0 = pass, 1 = fail   (stdlib only)

TEETH - 12 mutations RUN in a scratch clone (sidecar original, atomic writes, no bytecode, byte-compared afterwards),
12/12 caught:
    the first tab in is not granted the post -> 2, 3, 4, 9   a second tab takes it by reporting in -> 3, 4
    a non-holder's command is not refused -> 4, 7            a stop is refused like anything else -> 5
    a script with no tab name is refused too -> 6            TAKE OVER is ignored -> 7, 8
    a stale holder keeps the post -> 8b, 9, 10               the state never says the holder is stale -> 8, 10, 11
    release does nothing -> 9, 10                            the heartbeat is logged as a command -> 10
    a lapse is never said -> 10, 11                          the state does not carry supervision at all -> 1, 2, 8
⚠ THE LAST ONE FIRST CRASHED THIS SUITE INSTEAD OF FAILING A CHECK, and a crash is not a catch: the setup between
checks read state()["supervisor"] directly, so a console publishing none killed the run before a FAIL line printed -
which a mutation runner scores as a SURVIVAL. Everything outside a check() thunk reads with .get now. The same trap is
recorded in tests/log_compress.py's header, three items earlier, which is how it was spotted here.
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
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..")
sys.path.insert(0, APP)
sys.path.insert(0, os.path.join(HERE, "lib"))
from console_state import ConsoleState  # noqa: E402

fails = 0
ran = 0


def check(name, cond, detail=""):
    global fails, ran
    ran += 1
    try:
        ok = bool(cond() if callable(cond) else cond)
        if callable(detail):
            detail = detail()
    except Exception as e:
        ok, detail = False, "THREW %s: %s" % (type(e).__name__, e)
    print(("  ok   " if ok else "  FAIL ") + name + ("   [%s]" % detail if detail else ""))
    if not ok:
        fails += 1


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def post(port, path, body=None, tab=None, timeout=8):
    """(code, obj). `tab` is the browser tab's own name, which the page sends on every command."""
    url = "http://127.0.0.1:%d%s" % (port, path)
    headers = {"Content-Type": "application/json"}
    if tab:
        headers["X-ASV-Client"] = tab
    req = urllib.request.Request(url, data=json.dumps(body or {}).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def state(port):
    with urllib.request.urlopen("http://127.0.0.1:%d/api/state" % port, timeout=8) as r:
        return json.loads(r.read().decode())


def beat(port, tab, take=False):
    return post(port, "/api/supervisor", {"id": tab, "take": take} if take else {"id": tab})[1]


def session_records(path):
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


print("One tab supervises; the others watch:")

STATE = ConsoleState(prefix="asv_supervisor_")
LOG_DIR = STATE.path("logs")
before = set(os.listdir(LOG_DIR)) if os.path.isdir(LOG_DIR) else set()
port = free_port()
srvlog = tempfile.TemporaryFile(mode="w+")
# NO --no-log: what supervision DOES is written to the session recording, and check 10 reads it there.
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none", "--port", str(port),
                         "--no-ais-service", *STATE.args()], cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
try:
    up = False
    for _ in range(80):
        try:
            if state(port):
                up = True
                break
        except Exception:
            time.sleep(0.5)
    check("1. a console comes up with nobody supervising - a console nobody has opened is not waiting for permission",
          lambda: up and (state(port).get("supervisor") or {}).get("holder", "missing") is None
          and (state(port).get("supervisor") or {}).get("tabs") == 0,
          lambda: json.dumps(state(port).get("supervisor")) if up else "the console did not come up")
    if not up:
        raise SystemExit(1)

    r1 = beat(port, "tab-one")
    check("2. the first tab to report in is the supervisor, and the state says which tab and for how long",
          lambda: r1["supervisor"]["holder"] == "tab-one" and r1["you"] is True
          and (state(port).get("supervisor") or {}).get("holder") == "tab-one"
          and (state(port).get("supervisor") or {}).get("age_s") is not None,
          lambda: json.dumps(r1))

    r2 = beat(port, "tab-two")
    check("3. a second tab reporting in does NOT take it - supervision is granted once and handed over deliberately",
          lambda: r2["supervisor"]["holder"] == "tab-one" and r2["you"] is False
          and r2["supervisor"]["tabs"] == 2,
          lambda: json.dumps(r2))

    c_two, b_two = post(port, "/api/cmd/arm", {"on": True}, tab="tab-two")
    c_one, b_one = post(port, "/api/cmd/arm", {"on": True}, tab="tab-one")
    check("4. the second tab's command is REFUSED in words, and the supervising tab's identical command is taken",
          lambda: c_two == 409 and "supervising" in b_two["error"] and "TAKE OVER" in b_two["error"]
          and c_one == 200 and state(port)["armed"] is True,
          lambda: "view-only tab: %d %s | supervising tab: %d" % (c_two, b_two.get("error", "")[:60], c_one))

    stops = {p: post(port, "/api/cmd/" + p, {"on": True} if p == "estop" else {}, tab="tab-two")[0]
             for p in ("stop", "pause", "estop")}
    post(port, "/api/cmd/estop", {"on": False}, tab="tab-one")
    check("5. STOP, PAUSE and E-STOP are taken from ANY tab - a control that reduces risk is never gated on which "
          "tab is in charge",
          lambda: all(c == 200 for c in stops.values()), lambda: str(stops))

    c_script, _b = post(port, "/api/cmd/arm", {"on": True})          # no tab name at all
    check("6. a caller with no tab name is not refused - this guards the operator's second window, not the API, and "
          "every harness that drives the console directly would break",
          lambda: c_script == 200, "a script, a suite, curl")

    r3 = beat(port, "tab-two", take=True)
    c_one2, b_one2 = post(port, "/api/cmd/arm", {"on": False}, tab="tab-one")
    check("7. TAKE OVER moves supervision at once, and the tab that had it is refused from then on",
          lambda: r3["supervisor"]["holder"] == "tab-two" and r3["you"] is True and c_one2 == 409,
          lambda: "holder %s; the old tab now gets %d" % (r3["supervisor"]["holder"], c_one2))

    # 8. THE ONE THE ITEM IS ABOUT: the supervising tab stops reporting (asleep, throttled, crashed).
    # ⚠ READ WITH .get FROM HERE DOWN: this is setup, not a check, and a console that published no supervision at
    # all would kill the suite before a FAIL line printed - which a mutation runner scores as a SURVIVAL.
    stale_s = (r3.get("supervisor") or {}).get("stale_s", 6.0)
    t0 = time.time()
    snap = state(port).get("supervisor") or {}
    while not snap.get("stale") and time.time() - t0 < stale_s + 6:
        time.sleep(0.5)
        snap = state(port).get("supervisor") or {}
    check("8. a supervising tab that stops reporting is STALE in the state after stale_s - the console says the page "
          "is not watching, and says it without being asked",
          lambda: snap.get("stale") is True and snap.get("holder") == "tab-two" and snap.get("age_s") >= stale_s,
          lambda: "stale=%s after %.1f s (holder %s, age %s)"
                  % (snap.get("stale"), time.time() - t0, snap.get("holder"), snap.get("age_s")))

    # Leave it stale a moment before anyone takes over: the console's own watch looks once a second, and a post that
    # is taken back inside that second is not a lapse anybody needed telling about (checks 10 and 11 read what it said).
    time.sleep(2.5)
    r4 = beat(port, "tab-three")
    check("8b. ... and another tab takes the post by simply reporting in - a tab that is not watching cannot keep "
          "supervision from one that is",
          lambda: r4["supervisor"]["holder"] == "tab-three" and r4["you"] is True and r4["supervisor"]["stale"] is False,
          lambda: json.dumps(r4["supervisor"]))

    rel = post(port, "/api/supervisor", {"id": "tab-three", "release": True})[1]
    r5 = beat(port, "tab-four")
    check("9. a tab that is closing RELEASES the post, so the next tab does not wait out the stale timer",
          lambda: rel["supervisor"]["holder"] is None and r5["supervisor"]["holder"] == "tab-four",
          lambda: "after release: %s; next tab: %s" % (rel["supervisor"]["holder"], r5["supervisor"]["holder"]))

    # 10. what is written down - and what is NOT
    new = sorted(set(os.listdir(LOG_DIR)) - before)
    spath = os.path.join(LOG_DIR, new[0]) if new else None
    recs = session_records(spath) if spath else []
    kinds = [r.get("kind") for r in recs]
    beats = [r for r in recs if r.get("kind") == "command" and r.get("path") == "/api/supervisor"]
    took = [r for r in recs if r.get("kind") == "supervisor_took"]
    check("10. the session recording carries what supervision DID - a tab taking it, taking over, letting it go, "
          "going quiet - and not one line of the heartbeat that would bury the record",
          lambda: not beats and len(took) >= 2 and "supervisor_released" in kinds
          and "supervisor_lapsed" in kinds,
          lambda: "%d heartbeat records; took %d; %s" % (len(beats), len(took),
                                                         ", ".join(k for k in kinds if k.startswith("supervisor"))))
finally:
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()
    for f in sorted(set(os.listdir(LOG_DIR)) - before):
        try:
            os.remove(os.path.join(LOG_DIR, f))
        except OSError:
            pass

srvlog.seek(0)
server_out = srvlog.read()
srvlog.close()
check("11. the console SAYS the supervising tab went quiet, on its own console, once",
      lambda: server_out.count("has not reported for") == 1 and "Nothing was stopped" in server_out,
      lambda: next((l for l in server_out.splitlines() if "has not reported" in l), "(nothing said)")[:110])
from server_log import exception_lines  # noqa: E402
tb = exception_lines(server_out)
check("12. and it logged NO exception while serving any of it",
      not tb, ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb else "")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
