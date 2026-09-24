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

TEETH for 15-15f (the frame race, found fixing review #8) - 8 mutations RUN in a scratch clone
against this file trimmed to its in-process part, 8/8 caught, each by the check written for it:
  * the stale-frame check removed from Engine._run      -> caught by 15, 15b, 15c, 15d, 15e, 15f
  * the generation read AFTER the tick, not before      -> caught by 15, 15b, 15c, 15d, 15e, 15f
  * Stop / Pause / Start / E-STOP / disarm / _run_route not marking the command
                                          -> caught by 15 / 15b / 15c / 15d / 15e / 15f

TEETH for 7c, 15g and 15h (review #23, WHICH COMMANDED MOTION the page's clock is timing) - 4 mutations RUN in a
scratch clone, 4/4 caught:
  * run_seq never moves on a command                     -> caught by 15g
  * a resume counts as a new motion                      -> caught by 7c, 15g, 15h
  * a re-approach counts as a new motion                 -> caught by 15h
  * the state stops publishing run_seq                   -> caught by 7c

TEETH for 3c and 16 (review #9, the route waypoint limit) - 4 mutations RUN in a scratch clone, 4/4 caught:
  * the route cut short again with no refusal            -> caught by 3c
  * the limit back to 1000                               -> caught by 3c (it must fit the largest plan logged)
  * the saved plan's bound removed                       -> caught by 16
  * the state stops publishing the limit                 -> caught by 3c

TEETH for 17-17g (review #12, the telemetry loop survives its own faults) - 15 mutations RUN in a scratch clone
against this file trimmed to its setup and 17-17g, 15/15 caught (recorded results):
  * Engine._run with no handler again                     -> caught by 17, 17b, 17c, 17d, 17e, 17f, 17g
  * a fault not pushed to the page                        -> caught by 17
  * a fault in the state snapshot itself ends the loop    -> caught by 17d, 17e
  * the fault taken down on the first clean tick          -> caught by 17b, 17c, 17d
  * a fault does not restart the run of clean ticks       -> caught by 17c, 17d
  * a fault never taken down                              -> caught by 17b, 17c, 17d, 17e, 17g
  * printed per message rather than per raising line      -> caught by 17e
  * the state keeps the first message, not the latest     -> caught by 17e
  * every fault a new episode (count and since reset)     -> caught by 17, 17c, 17e, 17g
  * the state does not carry loop_fault                   -> caught by 17, 17d
  * a new link keeps the old link's fault                 -> caught by 17f
  * streaming always true                                 -> caught by 17f
  * printed on every fault                                -> caught by 17, 17e
  * the fault report unguarded (a closed stderr raises)   -> caught by 17g
  * the recovery report unguarded                         -> caught by 17g

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

    # DETERMINISM: the sim's EnvMonitor pushes the boat with LIVE NDBC weather at the
    # spawn, so a paused boat drifts at the real wind's whim - check 6's standstill
    # (<= 0.15 kn) was seen failing at sog 0.16-0.18 purely because Lewes was blowing
    # that evening (2026-08-07), after passing for days in calmer air. A control suite
    # must not be hostage to the weather: run this console becalmed. The env override
    # itself is covered by env_water.py (disable RETURNS CALM is its check 5).
    cmd(port, "/api/env", {"enabled": False})

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

    # 3c. A ROUTE OVER THE CONSOLE'S WAYPOINT LIMIT IS REFUSED WHOLE, IN WORDS (review #9). It kept the
    # first 1000 waypoints and dropped the rest with a 200 - nine uploads in the session logs were cut
    # that way, the largest 6,435. Asked while still DISARMED so neither route can run: the one over the
    # limit must be stopped by the ROUTE check, and the one AT it must get past that check to the arm
    # gate - the pair is what shows the bound applied is the bound the state publishes.
    lim = state(port).get("route_max_wpts")
    mk = lambda n: [{"lat": spawn0[0] + i * 1e-6, "lon": spawn0[1]} for i in range(n)]
    r_over = cmd(port, "/api/cmd/transit", {"route": mk(lim + 1)}) if isinstance(lim, int) else {}
    r_at = cmd(port, "/api/cmd/transit", {"route": mk(lim)}) if isinstance(lim, int) else {}
    check("3c. a route over the console's waypoint limit is REFUSED WHOLE in words, and one AT it passes the "
          "route check - the limit the state publishes is the one applied, and it fits the largest plan logged",
          lambda: isinstance(lim, int) and lim >= 6435
          and ("%d waypoints" % (lim + 1)) in str(r_over.get("error"))
          and "refused whole" in str(r_over.get("error"))
          and "ARM" in str(r_at.get("error")).upper() and "waypoints" not in str(r_at.get("error")),
          lambda: "limit=%s; over: %s; at: %s" % (lim, str(r_over.get("error"))[:80], str(r_at.get("error"))[:40]))

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
    seq_transit = st.get("run_seq")               # which commanded motion this is (review #23, checked at 7c)

    # ---- PAUSE --------------------------------------------------------------------- #
    st = wait_for(port, lambda s: (s.get("wp_index") or 0) >= 1, limit=120)
    idx_before = st.get("wp_index")
    check("5. the boat rolls onto leg 1 first - so the preserved index below is a real number",
          lambda: (idx_before or 0) >= 1, "wp_index=%s" % idx_before)

    cmd(port, "/api/cmd/pause")
    # `is None`, NOT `or`: a becalmed boat reads sog_kn 0.0, and `0.0 or 1` is 1 -
    # the old guard could not tell a PERFECT standstill from a missing field (the
    # lsGet lesson, server-side). Live weather hid it: sog never used to reach 0.
    sog_of = lambda s: (lambda v: 999.0 if v is None else v)(s["status"].get("sog_kn"))
    st = wait_for(port, lambda s: sog_of(s) <= 0.15, limit=20)
    check("6. PAUSE holds the boat: speed over ground falls to a standstill",
          lambda: sog_of(st) <= 0.15 and st.get("run") == "paused"
          and st["status"].get("paused") is True,
          "sog=%.2f run=%s link paused=%s"
          % (sog_of(st), st.get("run"), st["status"].get("paused")))
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
    check("7c. ... and the console still calls it the SAME commanded motion - run_seq is published and did not "
          "move across the pause (review #23: the page's elapsed clock keys on it)",
          lambda: st.get("run_seq") is not None and st.get("run_seq") == seq_transit,
          "run_seq %s at the transit, %s after the resume" % (seq_transit, st.get("run_seq")))
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

    # ⚠⚠ 9d. A HOME THAT WAS A ROC DOES NOT OUTLIVE THE ROC (2026-09-23). The Engine cleared
    # `home_source` when the selected ROC went away and KEPT `home`, so a Mothership selected as
    # home in roc_config.json left its last position - 38.81 N off Delaware - standing as home
    # for the rest of the day, 500 km from where Andy was working at Erie. The first-fix seed
    # only fires while home is None, so nothing ever moved it, and RTH asked for a 420 x 375 km
    # ENC extraction before it would post. Driven the whole way through the real /api/roc.
    far = (38.8112, -75.1)
    added = api(port, "/api/roc", {"op": "add", "kind": "ship", "name": "Mothership-T",
                                   "lat": far[0], "lon": far[1]})
    rid = added.get("id")
    # A new ROC is STAGED, and "Only an ACTIVE (confirmed) ROC may be HOME" - so it is confirmed
    # first, exactly as the operator's card requires. The control clause of the check caught
    # this fixture arriving unconfirmed: home never followed, and "after clear_home the home is
    # at the boat" was a statement about a home that had never been anywhere else.
    api(port, "/api/roc", {"op": "confirm", "id": rid})
    api(port, "/api/roc", {"op": "select_home", "id": rid})
    st = wait_for(port, lambda s: s.get("home_source") == rid and s.get("home") is not None, limit=15)
    followed = (st.get("home_source") == rid and st.get("home") is not None
                and dist_m((st["home"]["lat"], st["home"]["lon"]), far) < 2000)
    api(port, "/api/roc", {"op": "clear_home"})
    st2 = wait_for(port, lambda s: s.get("home_source") is None and s.get("home") is not None
                                    and dist_m((s["home"]["lat"], s["home"]["lon"]), far) > 100000,
                   limit=15)
    check("9d. a home that WAS a ROC does not outlive the ROC - it re-arms at the present fix",
          # THE FIRST CLAUSE IS THE CONTROL: home really did follow the ship first, or the
          # clause after it is a statement about a home that was never anywhere else.
          lambda: followed and st2.get("home_source") is None and st2.get("home") is not None
                  and dist_m((st2["home"]["lat"], st2["home"]["lon"]), spawn0) < 150,
          lambda: "followed the ship: %s; after clear_home: home=%s src=%s (%.0f m from the boat)"
                  % (followed, json.dumps(st2.get("home")), st2.get("home_source"),
                     dist_m((st2["home"]["lat"], st2["home"]["lon"]), spawn0) if st2.get("home") else -1))
    api(port, "/api/roc", {"op": "remove", "id": rid})    # leave the registry as it was found

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

# ── 15-15f. A FRAME READ BEFORE A COMMAND IS NEVER APPLIED AFTER IT (found fixing review #8) ──
#
# Engine._run asks the link for its frame OUTSIDE the lock and applies it under the lock, so a
# command could land in between and be overwritten by a frame that described the boat before it:
# a Stop read "running" for 0.45 s and then "complete", never "stopped" - and for a holding boat
# that fed running + holding to the page's RTH chain, the re-approach gate and the moving-home
# chase. Nothing over HTTP puts a command in that window on demand, so this part is IN-PROCESS: a
# SimVcu whose tick() fires the command after computing its frame - exactly the interleaving the
# loop allows - with the run state sampled every 5 ms from the moment the command returns.
import importlib.util as _ilu

_spec = _ilu.spec_from_file_location("engine_under_test", os.path.join(APP, "asv_console.py"))
_C = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_C)


class _RacyVcu(_C.SimVcu):
    fire = None                       # a command to land between the frame's read and its use
    fired = False
    error = None

    def tick(self, dt):
        t = super().tick(dt)
        if _RacyVcu.fire is not None:
            f, _RacyVcu.fire = _RacyVcu.fire, None
            try:
                f()
            except Exception as e:    # a refused command is the fixture failing, not the race
                _RacyVcu.error = e
            _RacyVcu.fired = True
        return t


def _states_after(eng, command, secs=0.8):
    """Fire `command` from inside the link's tick; every run state seen once it has returned."""
    _RacyVcu.fired, _RacyVcu.error = False, None
    _RacyVcu.fire = command
    t0 = time.time()
    while not _RacyVcu.fired and time.time() - t0 < 3.0:
        time.sleep(0.001)
    seen, t1 = [], time.time()
    while time.time() - t1 < secs:
        r = eng.run
        if not seen or seen[-1] != r:
            seen.append(r)
        time.sleep(0.005)
    return seen + (["(command raised: %s)" % _RacyVcu.error] if _RacyVcu.error else [])


_C.SimVcu = _RacyVcu
# This Engine runs in-process, so it reads the plan through the imported module - which, unmoved, is the
# operator's own mission.json (review #16). The suite's state folder, the same as the console above.
_C.use_state_dir(STATE.dir)
E = _C.Engine()
try:
    E.connect("sim", "", _C.DEFAULT_VCU_PORT, "tcp")
    t0 = time.time()
    while (E.status or {}).get("lat_deg") is None and time.time() - t0 < 20:
        time.sleep(0.1)
    E.set_armed(True)
    far = ((E.status or {}).get("lat_deg", 0.0) + 0.003, (E.status or {}).get("lon_deg", 0.0))  # ~330 m

    def under_way():
        E.go_to(*far)
        t0 = time.time()
        while not (E.run == "running" and (E.status.get("sog_kn") or 0.0) > 0.5) and time.time() - t0 < 10:
            time.sleep(0.05)
        return E.run == "running"

    ok = under_way()
    seen = _states_after(E, E.stop)
    check("15. a Stop landing between the link's frame and its use reads STOPPED from then on - the frame "
          "from before it is dropped, not applied",
          lambda: ok and seen == ["stopped"], "under way=%s; run after the Stop: %s" % (ok, seen))
    ok = under_way()
    seen = _states_after(E, E.pause)
    check("15b. ... a Pause reads PAUSED", lambda: ok and seen == ["paused"],
          "under way=%s; run after the Pause: %s" % (ok, seen))
    seen = _states_after(E, E.start)
    check("15c. ... a Start from that pause reads RUNNING", lambda: seen == ["running"],
          "run after the Start: %s" % seen)
    seen = _states_after(E, lambda: E.set_estop(True))
    check("15d. ... an E-STOP reads IDLE", lambda: seen == ["idle"], "run after the E-STOP: %s" % seen)
    E.set_estop(False)
    E.set_armed(True)
    ok = under_way()
    seen = _states_after(E, lambda: E.set_armed(False))
    check("15e. ... a disarm reads IDLE", lambda: ok and seen == ["idle"],
          "under way=%s; run after the disarm: %s" % (ok, seen))
    E.set_armed(True)
    E.stop()
    time.sleep(0.6)
    seen = _states_after(E, lambda: E.go_to(*far))
    check("15f. ... and a Go-To from rest reads RUNNING - not 'complete', which is what a frame from before "
          "it made of a run that had just started",
          lambda: seen == ["running"], "run after the Go-To: %s" % seen)

    # 15g-15h. WHICH COMMANDED MOTION THIS IS (review #23). Andy: "`runElapsed` spans back-to-back runs" - 3:48 across
    # two Go-Tos. The page cannot key its clock on `run`, which reads "running" through a second command, a resume and
    # a re-approach alike; it keys on this counter, so what the counter counts is the whole of the fix.
    E.stop()
    time.sleep(0.4)
    seq_idle = E.run_seq
    E.go_to(*far)
    seq_goto = E.run_seq
    E.pause()
    time.sleep(0.3)
    E.start()                                     # a RESUME: the same motion carrying on
    seq_resume = E.run_seq
    E.go_to(far[0] + 0.001, far[1])               # a second command with the first still under way
    seq_second = E.run_seq
    E._run_route(E._sanitize_route([{"lat": far[0], "lon": far[1]}]), E.behavior,
                 "re-approach", continuing=True)  # a leg of the motion in progress
    seq_reapproach = E.run_seq
    check("15g. a NEW commanded motion moves run_seq - a Go-To from rest, and a second one commanded while the first "
          "is still under way, which `run` cannot tell apart",
          lambda: seq_goto == seq_idle + 1 and seq_second == seq_goto + 1,
          "idle %s -> Go-To %s -> a second Go-To under way %s" % (seq_idle, seq_goto, seq_second))
    check("15h. ... and a RESUME and a RE-APPROACH do NOT move it: they are that motion still running, and a clock "
          "that restarted on them would be lying the other way",
          lambda: seq_resume == seq_goto and seq_reapproach == seq_second,
          "resume %s (was %s); re-approach %s (was %s)" % (seq_resume, seq_goto, seq_reapproach, seq_second))

    # 16. ... AND THE SAVED PLAN MEETS THE SAME BOUND (review #9). An upload with no route sends the
    # saved plan's own waypoints, which never passed the route check. In-process, with the store
    # stubbed, so no plan file is written to make one this long.
    E.stop()
    time.sleep(0.4)
    real_load = _C.load_mission
    lim = _C.ROUTE_MAX_WPTS
    pts = lambda n: [{"lat": far[0] + i * 1e-6, "lon": far[1]} for i in range(n)]
    try:
        _C.load_mission = lambda: {"waypoints": pts(lim + 1)}
        try:
            E.upload()
            over_err = None
        except _C.VcuProtocolError as e:
            over_err = str(e)
        _C.load_mission = lambda: {"waypoints": pts(lim)}
        try:
            E.upload()
            at_err = None
        except _C.VcuProtocolError as e:
            at_err = str(e)
    finally:
        _C.load_mission = real_load
    check("16. an upload of a SAVED plan over the limit is refused whole in words, and one at the limit is taken",
          lambda: over_err is not None and ("saved plan has %d waypoints" % (lim + 1)) in over_err
          and at_err is None and E.wp_total == lim,
          "over: %s; at: %s, wp_total=%s" % ((over_err or "taken")[:60], at_err or "taken", E.wp_total))

    # ── 17-17f. THE TELEMETRY LOOP SURVIVES ITS OWN FAULTS, AND SAYS SO (review #12) ──
    # One exception anywhere in a tick ended Engine._run's thread: telemetry stopped, and the event stream's
    # keep-alive comments kept the page's link dot GREEN over readouts that no longer moved. In-process, with
    # the fault put into the tick through the home provider - the callable the loop asks for the ROC's arrival
    # point on every tick - and into the state snapshot itself. The page half is tests/frame_health.js.
    import io as _io
    import queue as _queue
    import re as _re

    _fault = {"mode": None, "n": 0}

    def _provider():
        _fault["n"] += 1
        mode = _fault["mode"]
        if mode == "always" or (mode == "alternate" and _fault["n"] % 2):
            raise ZeroDivisionError("a monitor fell over")
        if mode == "varying":
            raise ValueError("reading %d" % _fault["n"])
        return None

    def _until(pred, limit):
        t0 = time.time()
        while time.time() - t0 < limit:
            if pred():
                return time.time() - t0
            time.sleep(0.01)
        return None

    def _discard(q):
        while True:
            try:
                q.get_nowait()
            except _queue.Empty:
                return

    def _drain(q, secs):
        got, t0 = [], time.time()
        while time.time() - t0 < secs:
            try:
                got.append(json.loads(q.get(timeout=0.02)))
            except _queue.Empty:
                pass
        return got

    E.set_home_provider(_provider)
    q = E.subscribe()
    err, real_err = _io.StringIO(), sys.stderr
    raised = lambda: err.getvalue().count("the telemetry loop raised")
    sys.stderr = err                      # what the loop prints about its faults, for the length of 17
    try:
        _fault["mode"] = "always"
        time.sleep(0.5)                   # past any tick that asked for home before the fault went in
        _discard(q)
        s0 = E.status
        frames = _drain(q, 1.6)
        lf = dict(E.loop_fault or {})
        alive = E._thread is not None and E._thread.is_alive()
        frozen = E.status is s0
        told = [f for f in frames if (f.get("loop_fault") or {}).get("error") == "ZeroDivisionError: a monitor fell over"]
        check("17. a fault on every tick does not end the telemetry loop: it keeps publishing, and every frame carries "
              "the fault - error, a count and the time it began - printed once, not per tick",
              lambda: alive and lf.get("error") == "ZeroDivisionError: a monitor fell over" and lf.get("count", 0) >= 6
              and _re.match(r"^\d\d:\d\d:\d\d$", lf.get("since", "")) and len(told) >= 5 and len(told) == len(frames)
              and frozen and raised() == 1,
              "loop alive=%s; fault %s; %d of %d frames carry it; telemetry frozen under it=%s; printed %d time(s)"
              % (alive, lf, len(told), len(frames), frozen, raised()))

        _fault["mode"] = None
        cleared_after = _until(lambda: E.loop_fault is None, 6.0)
        check("17b. ... when the fault stops, telemetry is applied again and the fault is taken down after a run of 8 "
              "clean ticks (2 s) - not on the first one",
              lambda: cleared_after is not None and 1.5 <= cleared_after <= 5.0 and E.status is not s0
              and err.getvalue().count("runs clean again after") == 1,
              "cleared after %s s; telemetry applied again=%s; recovery printed %d time(s)"
              % (None if cleared_after is None else round(cleared_after, 2), E.status is not s0,
                 err.getvalue().count("runs clean again after")))

        _fault["mode"] = "alternate"
        first_up = _until(lambda: E.loop_fault is not None, 3.0)
        dropped, since0, t0 = 0, (E.loop_fault or {}).get("since"), time.time()
        while time.time() - t0 < 2.5:
            if E.loop_fault is None:
                dropped += 1
            time.sleep(0.01)
        lf = dict(E.loop_fault or {})
        _fault["mode"] = None
        cleared_alt = _until(lambda: E.loop_fault is None, 6.0)
        check("17c. a fault on every other tick is ONE fault that stays up and keeps counting from when it began - "
              "the clean ticks between do not take it down",
              lambda: first_up is not None and dropped == 0 and lf.get("count", 0) >= 4 and lf.get("since") == since0
              and cleared_alt is not None,
              "up after %s s; samples with no fault while it alternated: %d; fault %s; cleared after it stopped: %s"
              % (first_up and round(first_up, 2), dropped, lf, cleared_alt is not None))

        def _no_state():
            raise RuntimeError("the state cannot be built")
        E._autonomy_label = _no_state     # the snapshot itself - and so every frame - now raises
        _drain(q, 0.3)                    # past any frame built before it went in
        during = _drain(q, 1.2)
        alive = E._thread is not None and E._thread.is_alive()
        del E._autonomy_label
        after = _drain(q, 1.0)
        said = (after[-1].get("loop_fault") or {}).get("error", "") if after else ""
        cleared_state = _until(lambda: E.loop_fault is None, 6.0)
        check("17d. a fault in the state snapshot itself publishes nothing - there is no frame to say it in, which the "
              "page reads as TELEMETRY STALE - and still does not end the loop: frames resume, carrying the fault",
              lambda: not during and alive and len(after) >= 2 and said == "RuntimeError: the state cannot be built"
              and cleared_state is not None,
              "frames while the state raised: %d; loop alive=%s; frames after: %d saying '%s'; cleared: %s"
              % (len(during), alive, len(after), said, cleared_state is not None))

        before = raised()
        _fault["mode"] = "varying"
        msgs, t0 = set(), time.time()
        while time.time() - t0 < 1.6:
            m = (E.loop_fault or {}).get("error")
            if m:
                msgs.add(m)
            time.sleep(0.01)
        lf = dict(E.loop_fault or {})
        _fault["mode"] = None
        _until(lambda: E.loop_fault is None, 6.0)
        check("17e. a fault whose message changes every tick (it carries a value) is printed ONCE for its line, and the "
              "state follows the latest message",
              lambda: raised() - before == 1 and len(msgs) >= 3 and lf.get("count", 0) >= 4
              and all(_re.match(r"^ValueError: reading \d+$", m) for m in msgs),
              "printed %d time(s); %d distinct messages carried, e.g. %s; count %s"
              % (raised() - before, len(msgs), sorted(msgs)[:2], lf.get("count")))

        _fault["mode"] = "always"
        up = _until(lambda: E.loop_fault is not None, 3.0)
        _fault["mode"] = None
        E.connect("sim", "", _C.DEFAULT_VCU_PORT, "tcp")
        fresh_fault, streaming_on = E.loop_fault, E.state().get("streaming")
        E.disconnect()
        gone = E.state()
        check("17f. a fresh link starts with no fault from the last link's loop - and the state says whether frames are "
              "streaming (true on a link, false once it is gone), which is what the page's STALE is keyed to",
              lambda: up is not None and fresh_fault is None and streaming_on is True and gone.get("streaming") is False,
              "fault before the reconnect: %s; after it: %s; streaming on a link=%s, after disconnect=%s"
              % (up is not None, fresh_fault, streaming_on, gone.get("streaming")))

        class _ClosedHandle:
            """A console window that has gone: every write raises."""
            def write(self, *_a):
                raise OSError(22, "the console handle is closed")

            def flush(self):
                raise OSError(22, "the console handle is closed")

        E.connect("sim", "", _C.DEFAULT_VCU_PORT, "tcp")
        sys.stderr = _ClosedHandle()
        _fault["mode"] = "always"
        up = _until(lambda: (E.loop_fault or {}).get("count", 0) >= 3, 4.0)
        alive = E._thread is not None and E._thread.is_alive()
        _fault["mode"] = None
        cleared = _until(lambda: E.loop_fault is None, 6.0)
        time.sleep(0.75)                  # three more ticks, for a fault the clearing report itself raised
        back = E.loop_fault
        alive_after = E._thread is not None and E._thread.is_alive()
        sys.stderr = err
        E.disconnect()
        check("17g. a report that cannot be written - the console's own window gone - does not end the loop either: "
              "the fault is still carried, still comes down, and does not come straight back",
              lambda: up is not None and alive and cleared is not None and back is None and alive_after,
              "3 faults carried: %s; loop alive under them=%s; cleared: %s; a fault 0.75 s later: %s; alive=%s"
              % (up is not None, alive, cleared is not None, back, alive_after))
    finally:
        sys.stderr = real_err
        _fault["mode"] = None
        E.unsubscribe(q)
finally:
    try:
        E.disconnect()
    except Exception:
        pass

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
