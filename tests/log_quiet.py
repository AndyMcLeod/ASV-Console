# -*- coding: utf-8 -*-
"""tests/log_quiet.py - the session recording goes QUIET once the sim boat is home and idle, and
wakes when a mission is planned or the boat is commanded (Andy, 2026-09-25: "once the model is
complete and the ASV is back home, wait 10 minutes and stop the simulation so the file does not
grow with useless information. Do not log again until a new mission is planned").

WHAT IT IS FOR: a sim boat holding at home writes a telemetry line a second, plus the page's
activity and health rows every 30 s, for as long as the console is left up - all night, for
nothing. The rule stops the FILE, not the simulation: the console stays connected and ready.

DRIVEN through a real console (logging ON, its own state folder, --log-quiet-s 2 so the ten
minutes are two seconds here), reading the session JSONL it writes:
  1  a session file, with the routine stream flowing while the boat sits at home
  2  after the delay a `log_quiet` record, then NOTHING routine: no state, telemetry or page
     event lands after it, and /api/state says log_quiet
  3  while quiet a page event is answered 200 and NOT recorded; a command still is
  4  saving a plan with lines wakes it (`log_resume`), the stream flows, log_quiet is off
  5  quiet again; a Go-To wakes it, and holding AWAY from home does not quiet it again
  6  Return-to-Home brings her home; holding there, it goes quiet again
  7  the console logged no exception

  python tests/log_quiet.py     # exit 0 = pass, 1 = fail
"""
import json
import math
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(APP)
fails = 0
ran = 0
DELAY_S = 2.0


# --- crash guard: a throw outside a check() must still REPORT (turn_geometry.js 30) ------
def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report


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
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def cmd(port, path, body=None):
    return api(port, path, body if body is not None else {})


def state(port):
    return api(port, "/api/state")[1]


def dist_m(a, b):
    if a[0] is None or b[0] is None:
        return float("inf")
    return math.hypot((a[0] - b[0]) * 111320.0, (a[1] - b[1]) * 111320.0 * math.cos(math.radians(a[0])))


def pos(st):
    s = st.get("status") or {}
    return (s.get("lat_deg"), s.get("lon_deg"))


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


def records(path):
    out = []
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line:
                    try:
                        out.append(json.loads(line))
                    except ValueError:
                        pass
    except OSError:
        pass
    return out


ROUTINE = ("state", "telemetry")


def routine_after(recs, t):
    return [r for r in recs if r.get("t", 0) > t and (r.get("kind") in ROUTINE or str(r.get("kind", "")).startswith("client:"))]


def kinds_after(recs, t, kind):
    return [r for r in recs if r.get("t", 0) > t and r.get("kind") == kind]


print("The session recording goes quiet once the sim boat is home and idle, and wakes for a mission:")

port = free_port()
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from console_state import ConsoleState  # noqa: E402
STATE = ConsoleState()
LOG_DIR = STATE.path("logs")

srvlog = tempfile.TemporaryFile(mode="w+")
# NO --no-log: the recorder is the thing under test. --log-quiet-s 2: the ten minutes are two seconds.
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none", "--port", str(port),
                         "--no-ais-service", "--log-quiet-s", str(DELAY_S), *STATE.args()],
                        cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
try:
    up = False
    st0 = {}
    for _ in range(80):
        try:
            st0 = state(port).get("status") or {}
            if st0.get("speed_key") and st0.get("lat_deg") is not None:
                up = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    files = sorted(f for f in (os.listdir(LOG_DIR) if os.path.isdir(LOG_DIR) else []) if f.startswith("asv_") and f.endswith(".jsonl"))
    spath = os.path.join(LOG_DIR, files[-1]) if files else None
    home = (st0.get("lat_deg"), st0.get("lon_deg"))
    time.sleep(1.5)
    r1 = records(spath) if spath else []
    check("1. a console comes up, recording; the routine stream flows while the boat sits at home",
          lambda: up and spath is not None and len([r for r in r1 if r.get("kind") in ROUTINE]) >= 2,
          lambda: "session=%s, %d routine records" % (spath and os.path.basename(spath), len([r for r in r1 if r.get("kind") in ROUTINE])))
    if not up or not spath:
        raise SystemExit(1)

    # 2. THE PAUSE. Wait for the record, then watch the file for a further spell.
    quiet = None
    for _ in range(40):
        q = [r for r in records(spath) if r.get("kind") == "log_quiet"]
        if q:
            quiet = q[-1]
            break
        time.sleep(0.5)
    time.sleep(3.0)
    r2 = records(spath)
    after2 = routine_after(r2, quiet["t"]) if quiet else []
    st2 = state(port)
    check("2. after the delay a `log_quiet` record, then NOTHING routine lands - no state, telemetry or page event - and "
          "/api/state says log_quiet",
          lambda: quiet is not None and "home and idle" in str(quiet.get("reason")) and not after2 and st2.get("log_quiet") is True
          and st2.get("mode") == "sim" and st2.get("streaming") is True,
          lambda: "quiet=%s; %d routine record(s) in the 3 s after it; log_quiet=%s; still streaming=%s"
                  % (quiet and quiet.get("reason"), len(after2), st2.get("log_quiet"), st2.get("streaming")))

    # 3. WHILE QUIET: a page event is answered and dropped; a command is still recorded.
    c3, _ = api(port, "/api/logevent", {"kind": "activity", "data": {"activity": "idle"}})
    cmd(port, "/api/cmd/speed", {"speed": "low"})
    time.sleep(0.5)
    r3 = records(spath)
    qt = quiet["t"] if quiet else 0
    check("3. while quiet a page event is answered 200 and NOT recorded - not as an event, not as a command - while "
          "a real command still is",
          lambda: c3 == 200 and not kinds_after(r3, qt, "client:activity")
          and not any(r.get("path") == "/api/logevent" for r in kinds_after(r3, qt, "command"))
          and any(r.get("path") == "/api/cmd/speed" for r in kinds_after(r3, qt, "command")),
          lambda: "logevent %s; client:activity after quiet: %d; commands after quiet: %s"
                  % (c3, len(kinds_after(r3, qt, "client:activity")), [r.get("path") for r in kinds_after(r3, qt, "command")]))

    # 4. A PLAN SAVED WITH LINES WAKES IT.
    _c, m = api(port, "/api/mission")
    a = {"lat": home[0] + 0.0010, "lon": home[1]}
    b = {"lat": home[0] + 0.0020, "lon": home[1]}
    plan = dict(m) if isinstance(m, dict) else {}
    plan.update({"lines": [{"a": a, "b": b}], "waypoints": [a, b]})
    c4, r4b = api(port, "/api/mission", plan)
    resume = None
    for _ in range(20):
        q = [r for r in records(spath) if r.get("kind") == "log_resume"]
        if q:
            resume = q[-1]
            break
        time.sleep(0.25)
    # Read INSIDE the delay: she is still home and idle, so the recording rightly goes quiet again DELAY_S
    # after the wake - which is what 5 then waits for.
    time.sleep(1.4)
    r4 = records(spath)
    st4 = state(port)
    n_quiet_before = len([r for r in r4 if r.get("kind") == "log_quiet"])
    flowing = routine_after(r4, resume["t"]) if resume else []
    check("4. saving a plan with lines wakes the recording (`log_resume`), the routine stream flows again, and "
          "/api/state's log_quiet is off",
          lambda: c4 == 200 and resume is not None and "mission planned" in str(resume.get("reason"))
          and len([r for r in flowing if r.get("kind") in ROUTINE]) >= 1 and st4.get("log_quiet") is False,
          lambda: "save %s (%s); resume=%s; %d routine record(s) in 1.4 s; log_quiet=%s"
                  % (c4, (r4b or {}).get("error", "ok"), resume and resume.get("reason"),
                     len([r for r in flowing if r.get("kind") in ROUTINE]), st4.get("log_quiet")))

    # 5. QUIET AGAIN (she is still home and idle), THEN A GO-TO WAKES IT - and holding AWAY from home does not
    # quiet it.
    quiet2 = None
    for _ in range(40):
        q = [r for r in records(spath) if r.get("kind") == "log_quiet"]
        if len(q) > n_quiet_before:
            quiet2 = q[-1]
            break
        time.sleep(0.5)
    cmd(port, "/api/cmd/arm", {"on": True})
    cmd(port, "/api/cmd/speed", {"speed": "high"})
    cmd(port, "/api/cmd/approach", {"m": 30})
    target = (home[0] + 0.0013, home[1])                       # ~145 m north
    t_goto = time.time()
    g = cmd(port, "/api/cmd/goto", {"lat": target[0], "lon": target[1]})
    st5 = wait_for(port, lambda s: dist_m(pos(s), target) < 40 and (s.get("status") or {}).get("holding"), limit=150)
    n_quiet_at_hold = len([r for r in records(spath) if r.get("kind") == "log_quiet"])
    time.sleep(DELAY_S + 4.0)
    r5 = records(spath)
    resumes5 = [r for r in r5 if r.get("kind") == "log_resume" and r.get("t", 0) >= t_goto - 1.0]
    n_quiet_after_hold = len([r for r in r5 if r.get("kind") == "log_quiet"])
    check("5. quiet again at home; a Go-To wakes it (`log_resume` route: goto) and holding 145 m AWAY from home does "
          "NOT quiet it - the rule is home AND idle",
          lambda: quiet2 is not None and g[0] == 200 and resumes5 and "goto" in str(resumes5[0].get("reason"))
          and (st5.get("status") or {}).get("holding") and dist_m(pos(st5), home) > 100
          and n_quiet_after_hold == n_quiet_at_hold,
          lambda: "quiet2=%s; goto %s; resume=%s; holding=%s %.0f m from home; log_quiet records at hold %d -> after %.0f s %d"
                  % (bool(quiet2), g[0], resumes5 and resumes5[0].get("reason"), (st5.get("status") or {}).get("holding"),
                     dist_m(pos(st5), home), n_quiet_at_hold, DELAY_S + 4.0, n_quiet_after_hold))

    # 6. RETURN-TO-HOME; holding at home it goes quiet again.
    rth = cmd(port, "/api/cmd/rth")
    st6 = wait_for(port, lambda s: dist_m(pos(s), home) < 25 and (s.get("status") or {}).get("holding"), limit=150)
    quiet3 = None
    for _ in range(int((DELAY_S + 8) * 2)):
        q = [r for r in records(spath) if r.get("kind") == "log_quiet" and r.get("t", 0) > (rth[1].get("t") or 0)]
        q = [r for r in records(spath) if r.get("kind") == "log_quiet"]
        if len(q) > n_quiet_after_hold:
            quiet3 = q[-1]
            break
        time.sleep(0.5)
    check("6. Return-to-Home brings her home; holding there, the recording goes quiet again",
          lambda: rth[0] == 200 and dist_m(pos(st6), home) < 25 and (st6.get("status") or {}).get("holding")
          and quiet3 is not None and state(port).get("log_quiet") is True,
          lambda: "rth %s; %.0f m from home holding=%s; quiet again=%s"
                  % (rth[0], dist_m(pos(st6), home), (st6.get("status") or {}).get("holding"), bool(quiet3)))
finally:
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()

srvlog.seek(0)
server_out = srvlog.read()
srvlog.close()
from server_log import exception_lines  # noqa: E402
tb = exception_lines(server_out)
check("7. the console logged NO exception while serving those requests", not tb,
      ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb else "")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
