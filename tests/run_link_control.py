"""tests/run_link_control.py - the five remaining unguarded routes: transit, pause,
reset, disconnect, connect.

WHY THIS EXISTS. The estop_chain audit measured the net: 20 of 33 API routes had no
behavioural test, because every suite before it was written the day something broke. This
suite covers the five Andy asked for next, chosen for consequence: transit is a whole
BEHAVIOUR (the TRAN button) with route validation in front of it; pause is the difference
between holding a survey and losing it; reset is the sim's power-cycle and MUST refuse on
a real boat; and connect/disconnect is the link lifecycle everything else stands on.

    python tests/run_link_control.py    # exit 0 = pass, 1 = fail   (stdlib only)

One REAL console, one arc, in mission order rather than one boot per route (a boot is the
expensive part, and the routes genuinely interleave): a transit gets the boat under way ->
pause holds it mid-leg -> resume proves pause was not stop -> reset wipes to a fresh boot
-> disconnect kills the link -> a REAL (dead) link proves the honest refusals -> a sim
reconnect brings everything back.

WHAT EACH ROUTE'S CONTRACT ACTUALLY IS (read from the code, asserted here):
  * transit  - arm-gated like every behaviour; the route is SANITIZED before the link
               sees it (the Engine never forwards an unvetted route); it runs with
               behavior="transit" and station-keeps at the end (run_completion "loiter").
  * pause    - holds the NEXT WAYPOINT: SOG to a standstill, run "paused", and the plan
               and wp_index PRESERVED, so start() resumes the same leg. PAUSE IS NOT STOP,
               and the waypoint index across the pair is what proves it.
  * reset    - SIM ONLY, and the refusal must say so honestly on a real link. In sim it
               is the power-cycle contract: fresh boat at the vessel's spawn, energy
               FULL, SAFE/idle, no plan, home dropped then RE-ARMED on the next fix, and
               a NEW boot_id - that identity change is what tells the browser to drop the
               previous trail, so losing it would splice two lives into one track.
  * disconnect - the link goes away and every command refuses "not connected"; armed
               drops. No zombie: a dead link that still accepts commands is the bug.
  * connect  - a fresh link ALWAYS comes up SAFE (armed/estop/plan cleared) with a new
               boot_id; sim telemetry resumes. A real link to a dead host is honest about
               reachability and refuses commands with the Phase-0 message, not a hang.

WHY WP1 IS CLOSE AND THE SPEED HIGH: the pause checks want wp_index >= 1 first, because
"resume did not restart the route" asserted at wp_index 0 proves nothing - a restart-from-
zero looks identical. The first leg is ~250 m at 14 kn with a 30 m approach radius, so the
boat rolls onto leg 1 inside a minute and the preserved index is a real number.

TEETH - nine mutations RUN, 9/9 caught (not planned numbers - these are the recorded
results; the runner scores a missing anchor as SKIP and a crash as its own outcome):
  * SimVcu.pause loses its halt                      -> caught by 6
  * THE SEAM CUT: Engine.pause never calls link.pause() -> caught by 6 AND 11 - the
    second catch was not designed: the REAL link's honest Phase-0 refusal travels through
    the same seam (link.pause() is what reaches RealVcu._blocked), so one cut loses two
    contracts and both checks see it.
  * THE RESTART BUG: SimVcu.start resets _wp_index   -> caught by 7 (the close first leg
    earned this - at wp_index 0 the restart would have been invisible)
  * transit forwards the route UNVETTED              -> caught by 3, 3b
  * _run_route loses its arm gate                    -> caught by 2, 3b
  * reset loses its simulator-only refusal           -> caught by 12
  * connect stops issuing a new boot identity        -> caught by 9, 13
  * THE ZOMBIE LINK: disconnect leaves _link set     -> caught by 10
  * connect stops forcing a fresh link SAFE          -> caught by 9 (reset's internal
    reconnect carries the running boat's armed state across) and 13

Harness rules as estop_chain: every condition is a THUNK and a throw is a failed check;
the server's output goes to a temp file and the last check reads it.
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

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)

fails = 0
ran = 0


def check(name, cond, detail=""):
    global fails, ran
    ran += 1
    try:
        ok = bool(cond()) if callable(cond) else bool(cond)
        if callable(detail):                         # lazy details may probe live state
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
    """body=None -> GET. A COMMAND MUST PASS A BODY, {} at minimum: urllib sends a GET
    when data is None, the command routes only dispatch on POST, and a GET "pause" comes
    back as a perfectly healthy-looking response that commanded NOTHING. The first run of
    this suite did exactly that - check 6 watched a "paused" boat sail on at 13.8 kn."""
    url = "http://127.0.0.1:%d%s" % (port, path)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:              # the console answers 4xx with a JSON body
        return json.loads(e.read().decode())


def cmd(port, path, body=None):
    """POST a command - the body defaults to {} so a bodyless command can never quietly
    degrade to a GET."""
    return api(port, path, body if body is not None else {})


def state(port):
    return api(port, "/api/state")


def status(port):
    return api(port, "/api/state")["status"]


def dist_m(a, b):
    dlat = (a[0] - b[0]) * 111320.0
    dlon = (a[1] - b[1]) * 111320.0 * math.cos(math.radians(a[0]))
    return math.hypot(dlat, dlon)


def wait_for(port, pred, limit=60.0, every=0.5):
    """Poll the full state until pred(state) is truthy. Returns the last state either way
    - callers assert on it, so a timeout fails the CHECK, not the harness."""
    t0 = time.time()
    st = state(port)
    while time.time() - t0 < limit:
        st = state(port)
        try:
            if pred(st):
                return st
        except Exception:
            pass                                     # a half-built frame is not an answer
        time.sleep(every)
    return st


print("Run + link control — transit, pause, reset, disconnect, connect:")

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

    spawn0 = (st0["lat_deg"], st0["lon_deg"])        # the vessel's spawn - reset must return here
    vessel = api(port, "/api/vessel")["vessel"]
    boot0 = state(port).get("boot_id")

    # ---- TRANSIT ------------------------------------------------------------------- #
    # A dogleg with a SHORT first leg (see the module docstring for why), then two long
    # ones the run will never finish inside this suite - the subject is control, not
    # arrival. Offsets from spawn keep it vessel-agnostic.
    leg1 = {"lat": spawn0[0] + 0.0022, "lon": spawn0[1]}                  # ~245 m north
    leg2 = {"lat": spawn0[0] + 0.03,   "lon": spawn0[1] + 0.02}
    leg3 = {"lat": spawn0[0] + 0.05,   "lon": spawn0[1] + 0.04}
    route = [leg1, leg2, leg3]

    r = cmd(port, "/api/cmd/transit", {"route": route})
    check("2. a transit is REFUSED while disarmed - it is a behaviour, so it is arm-gated",
          lambda: bool(r.get("error")) and "ARM" in r["error"].upper(),
          str(r.get("error"))[:60])

    cmd(port, "/api/cmd/arm", {"on": True})
    r_bad = cmd(port, "/api/cmd/transit", {"route": [{"lat": "abc", "lon": 0}]})
    r_empty = cmd(port, "/api/cmd/transit", {"route": []})
    check("3. a malformed route is REFUSED before the link ever sees it",
          lambda: bool(r_bad.get("error")) and "lat/lon" in r_bad["error"]
          and bool(r_empty.get("error")) and "empty" in r_empty["error"],
          "%s / %s" % (str(r_bad.get("error"))[:38], str(r_empty.get("error"))[:28]))
    check("3b. ... and the refusals commanded nothing - the boat is still idle",
          lambda: state(port).get("run") == "idle",
          "run=%s" % state(port).get("run"))

    cmd(port, "/api/cmd/approach", {"m": 30})        # roll onto leg 1 without sailing 250 m to 2 m
    cmd(port, "/api/cmd/speed", {"speed": "high"})
    cmd(port, "/api/cmd/transit", {"route": route})
    st = wait_for(port, lambda s: (s["status"].get("sog_kn") or 0) > 1.0, limit=40)
    check("4. THE ACCEPTANCE: armed, the same route runs - behavior transit, 3 wpts, under way",
          lambda: st.get("behavior") == "transit" and st.get("run") == "running"
          and st.get("wp_total") == 3 and (st["status"].get("sog_kn") or 0) > 1.0
          and st.get("run_completion") == "loiter",
          "behavior=%s run=%s wpts=%s sog=%.1f end=%s"
          % (st.get("behavior"), st.get("run"), st.get("wp_total"),
             st["status"].get("sog_kn") or 0, st.get("run_completion")))

    # ---- PAUSE --------------------------------------------------------------------- #
    st = wait_for(port, lambda s: (s.get("wp_index") or 0) >= 1, limit=120)
    idx_before = st.get("wp_index")
    check("5. the boat rolls onto leg 1 first - so the preserved index below is a real number",
          lambda: (idx_before or 0) >= 1, "wp_index=%s" % idx_before)

    cmd(port, "/api/cmd/pause")
    st = wait_for(port, lambda s: (s["status"].get("sog_kn") or 1) <= 0.15, limit=20)
    check("6. PAUSE holds the boat: speed over ground falls to a standstill",
          lambda: (st["status"].get("sog_kn") or 1) <= 0.15 and st.get("run") == "paused"
          and st["status"].get("paused") is True,
          "sog=%.2f run=%s link paused=%s"
          % (st["status"].get("sog_kn") or -1, st.get("run"), st["status"].get("paused")))
    check("6b. ... and PAUSE IS NOT STOP: the plan and the waypoint index survive it",
          lambda: state(port).get("wp_index") == idx_before
          and state(port).get("plan_uploaded") is True and state(port).get("wp_total") == 3,
          "wp_index=%s (held %s)" % (state(port).get("wp_index"), idx_before))

    pos_paused = (status(port)["lat_deg"], status(port)["lon_deg"])
    cmd(port, "/api/cmd/start")
    st = wait_for(port, lambda s: (s["status"].get("sog_kn") or 0) > 1.0, limit=40)
    check("7. START resumes the SAME leg - the index is not reset, the route not restarted",
          lambda: st.get("run") == "running" and (st.get("wp_index") or 0) >= idx_before
          and (st["status"].get("sog_kn") or 0) > 1.0,
          "run=%s wp_index=%s sog=%.1f" % (st.get("run"), st.get("wp_index"),
                                           st["status"].get("sog_kn") or 0))
    check("7b. ... from where it paused, not from anywhere else",
          lambda: dist_m(pos_paused, (status(port)["lat_deg"], status(port)["lon_deg"])) < 200,
          lambda: "%.0f m from the pause point" %
                  dist_m(pos_paused, (status(port)["lat_deg"], status(port)["lon_deg"])))

    # ---- RESET (sim) --------------------------------------------------------------- #
    # Let the resumed transit put REAL distance behind it first: check 9's "back at
    # spawn" tolerance is 150 m, so a boat only 250 m out would make that assertion
    # nearly vacuous. Half a kilometre is unambiguous either side.
    fuel_cap = None
    if vessel.get("power", {}).get("type") == "fuel":
        fuel_cap = float(vessel["power"]["fuel"]["capacity_l"])
    st = wait_for(port, lambda s: dist_m((s["status"]["lat_deg"], s["status"]["lon_deg"]),
                                         spawn0) > 500, limit=150)
    pos_before = (st["status"]["lat_deg"], st["status"]["lon_deg"])
    check("8. (arrange) the boat is genuinely away from spawn before the reset",
          lambda: dist_m(pos_before, spawn0) > 500,
          lambda: "%.0f m out" % dist_m(pos_before, spawn0))

    cmd(port, "/api/cmd/reset")
    # WAIT FOR THE NEW BOAT'S FIRST FRAME, not for "a position": the state keeps the OLD
    # link's last telemetry until the fresh SimVcu ticks, so sampling straight after the
    # POST reads the DEAD boat's position and fuel - this suite's first run did, and
    # reported the reset boat 248 m off spawn with 249.9 L aboard. Both numbers belonged
    # to the boat that no longer existed.
    st = wait_for(port, lambda s: s.get("boot_id") != boot0
                  and (s["status"] or {}).get("lat_deg") is not None
                  and dist_m((s["status"]["lat_deg"], s["status"]["lon_deg"]), spawn0) < 150,
                  limit=30)
    check("9. RESET is the power-cycle: back at spawn, SAFE, idle, no plan, and a NEW boot_id",
          lambda: dist_m((st["status"]["lat_deg"], st["status"]["lon_deg"]), spawn0) < 150
          and st.get("armed") is False and st.get("run") == "idle"
          and st.get("plan_uploaded") is False
          and st.get("boot_id") and st.get("boot_id") != boot0,
          "%.0f m from spawn, armed=%s run=%s plan=%s boot changed=%s"
          % (dist_m((st["status"]["lat_deg"], st["status"]["lon_deg"]), spawn0),
             st.get("armed"), st.get("run"), st.get("plan_uploaded"),
             st.get("boot_id") != boot0))
    check("9b. ... energy is FULL again - the run above burned it, the power-cycle refills it",
          lambda: fuel_cap is None or (st["status"].get("fuel_l") or 0) >= fuel_cap - 0.05,
          "fuel=%s / %s L" % (st["status"].get("fuel_l"), fuel_cap))
    st = wait_for(port, lambda s: s.get("home") is not None, limit=20)
    check("9c. ... home was dropped and RE-ARMS on the next fix, at the new position",
          lambda: st.get("home") is not None
          and dist_m((st["home"]["lat"], st["home"]["lon"]), spawn0) < 150,
          lambda: "home=%s" % (json.dumps(st.get("home")),))

    # ---- DISCONNECT ---------------------------------------------------------------- #
    cmd(port, "/api/disconnect")
    r = cmd(port, "/api/cmd/pause")
    check("10. after DISCONNECT a command refuses 'not connected' - no zombie link",
          lambda: bool(r.get("error")) and "not connected" in r["error"],
          str(r.get("error"))[:50])
    check("10b. ... and the console reads disarmed with the link down",
          lambda: state(port).get("armed") is False,
          "armed=%s" % state(port).get("armed"))

    # ---- CONNECT (real, dead host) ------------------------------------------------- #
    # A REAL link to a port nobody listens on. connect() itself must succeed - an
    # unreachable boat is a state to report, not an exception - and then every command
    # refuses with the honest Phase-0 message rather than sending uncertain frames.
    dead = free_port()                               # bound then closed: nothing listens
    cmd(port, "/api/connect", {"mode": "real", "host": "127.0.0.1", "port": dead})
    st = state(port)
    r_pause = cmd(port, "/api/cmd/pause")
    check("11. a real link refuses commands HONESTLY - protocol pending, not a hang or a fake",
          lambda: st.get("mode") == "real" and bool(r_pause.get("error"))
          and "not yet reverse-engineered" in r_pause["error"],
          str(r_pause.get("error"))[:60])
    r_reset = cmd(port, "/api/cmd/reset")
    check("12. RESET refuses on a real boat, and says WHY - it cannot be teleported or refuelled",
          lambda: bool(r_reset.get("error")) and "simulator-only" in r_reset["error"],
          str(r_reset.get("error"))[:60])

    # ---- CONNECT (sim again) ------------------------------------------------------- #
    boot_real = st.get("boot_id")
    cmd(port, "/api/connect", {"mode": "sim"})
    st = wait_for(port, lambda s: (s["status"] or {}).get("lat_deg") is not None
                  and (s["status"] or {}).get("speed_key"), limit=30)
    check("13. a sim reconnect comes up FRESH: telemetry flowing, SAFE, and a new identity",
          lambda: st.get("mode") == "sim" and st.get("armed") is False
          and st.get("estop") is False and st.get("plan_uploaded") is False
          and st["status"].get("lat_deg") is not None
          and st.get("boot_id") and st.get("boot_id") != boot_real,
          "mode=%s armed=%s boot changed=%s"
          % (st.get("mode"), st.get("armed"), st.get("boot_id") != boot_real))
    cmd(port, "/api/cmd/arm", {"on": True})
    st = wait_for(port, lambda s: s.get("armed") is True, limit=10)
    check("13b. ... and the fresh link takes commands again - the lifecycle is a circle",
          lambda: st.get("armed") is True, "armed=%s" % st.get("armed"))

finally:
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()
    if mission_bak is not None:                      # never leave the developer's plan changed
        with open(mpath, "w", encoding="utf-8") as f:
            f.write(mission_bak)

srvlog.seek(0)
server_out = srvlog.read()
srvlog.close()
tb = [ln.strip() for ln in server_out.splitlines()
      if "Traceback" in ln or "Error" in ln or "Exception occurred" in ln]
check("14. the console logged NO exception while serving those requests",
      not tb,
      ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb
      else "an answered request can still kill its handler")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
