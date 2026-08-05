"""tests/home_spawn.py - /api/cmd/sethome and /api/cmd/spawn, and THE FIX the coverage
pass forced out.

WHY THIS EXISTS. Andy's next two routes from the coverage list. Reading the code to
ground the contracts found a real defect of exactly the audit's recurring shape - one
value trusted without its provenance: `Engine.status` was only ever ASSIGNED when a
telemetry frame arrived, so it retained the PREVIOUS link's last fix forever, and
`set_home` had no not-connected guard. Consequences before the fix, both real:
  * Set-Home after /api/disconnect "succeeded", captured the DEAD boat's last position,
    and announced "Home set to present position" about a boat that no longer existed.
  * Connect a REAL link (Phase 0: produces no telemetry at all) after a sim session and
    Set-Home did the same - home for a real boat, taken from a simulation.
RTH aims at home, so a stale home is not a display blemish; it is where the boat goes.
THE FIX, both halves load-bearing and each caught by its own check here: `set_home` now
requires a link like every other command (check 9), and `connect()` clears `status` so a
new link's life starts with no telemetry - the server-side twin of the boot_id rule that
makes the browser drop the old trail (check 10: the same lie on a real link now refuses
"no position fix").

THE CONTRACTS OTHERWISE (read from the code, asserted live):
  * sethome - captures the PRESENT position; anything in the request body is IGNORED
    (check 2 posts a decoy and must see it discarded - home is "where the boat is", not
    "where the client says"). No arm gate, by design: setting home while SAFE is normal.
  * HOME IS THE RTH TARGET - the consequence that makes sethome worth guarding: after
    sailing away, Return-to-Home closes on the home sethome captured (check 4-5). This
    also puts the rth route's happy path under test for the first time.
  * spawn - reset-with-a-position (the click-to-spawn path REUSES the power-cycle rather
    than teleporting a live boat): numeric lat/lon demanded, range-checked, and a REFUSED
    spawn must power-cycle NOTHING (check 6-6b, boot_id unchanged, the running hold
    undisturbed). Accepted, it is a full fresh boot AT the point: SAFE, energy full, new
    boot_id, and home re-arms at the NEW position, not the old one (check 7-8).
  * spawn on a REAL link refuses with reset's honest simulator-only message - proving
    that guard covers BOTH entry points into the power-cycle (check 11).

    python tests/home_spawn.py      # exit 0 = pass, 1 = fail   (stdlib only)

TEETH - eight mutations RUN, 8/8 caught (recorded results, not predictions; the runner
scores a missing anchor as SKIP and a crash as its own outcome):
  * sethome captures the CLIENT's coordinates instead of the boat's -> caught by 2 AND 5:
    the RTH then closed on the planted point, never reaching the home it should have -
    the display check and the consequence check see the same lie from both ends.
  * THE SHIPPED DEFECT RESTORED: sethome loses its link guard      -> caught by 9 alone
  * THE OTHER HALF RESTORED: connect keeps the dead boat's status  -> caught by 10 alone
    (the two halves are independent and independently earned - neither check covers the
    other's fault, which is why both guards exist)
  * RTH aims somewhere other than home                             -> caught by 5
  * spawn stops demanding numeric lat/lon                          -> caught by 6, 6b
  * spawn stops range-checking                                     -> caught by 6, 6b
  * spawn ignores its point (plain reset at the vessel spawn)      -> caught by 7, 8
  * the first-fix home re-arm lost                                 -> caught by 8

Harness rules as run_link_control: thunked checks, cmd() so a bodyless command can never
degrade to a GET, waits for the NEW boot's frame after a power-cycle (never the POST),
server output to a temp file and read at the end.
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
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:              # the console answers 4xx with a JSON body
        return json.loads(e.read().decode())


def cmd(port, path, body=None):
    """POST a command; {} minimum, so it can never quietly degrade to a GET."""
    return api(port, path, body if body is not None else {})


def state(port):
    return api(port, "/api/state")


def dist_m(a, b):
    dlat = (a[0] - b[0]) * 111320.0
    dlon = (a[1] - b[1]) * 111320.0 * math.cos(math.radians(a[0]))
    return math.hypot(dlat, dlon)


def pos(st):
    s = st["status"] or {}
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


print("Home + spawn — where HOME comes from, and a power-cycle at a chosen point:")

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

    here = (st0["lat_deg"], st0["lon_deg"])

    # 2. HOME IS WHERE THE BOAT IS, never where the client says. The decoy coordinates
    # must be discarded: a home the client can plant is a home an off-by-one (or a stale
    # cached form field) can plant, and RTH drives there.
    decoy = {"lat": here[0] + 0.5, "lon": here[1] + 0.5}
    cmd(port, "/api/cmd/sethome", decoy)
    st = state(port)
    check("2. sethome captures the PRESENT position and IGNORES the request body",
          lambda: st.get("home") is not None
          and dist_m((st["home"]["lat"], st["home"]["lon"]), here) < 50
          and dist_m((st["home"]["lat"], st["home"]["lon"]),
                     (decoy["lat"], decoy["lon"])) > 10000,
          lambda: "home %.0f m from the boat, %.0f km from the decoy"
                  % (dist_m((st["home"]["lat"], st["home"]["lon"]), here),
                     dist_m((st["home"]["lat"], st["home"]["lon"]),
                            (decoy["lat"], decoy["lon"])) / 1000))
    home = (st["home"]["lat"], st["home"]["lon"])
    boot0 = st.get("boot_id")

    # 3-5. HOME IS THE RTH TARGET - the consequence. Sail away, then Return-to-Home has
    # to close on the home captured above, not on anything else.
    cmd(port, "/api/cmd/arm", {"on": True})
    cmd(port, "/api/cmd/speed", {"speed": "high"})
    cmd(port, "/api/cmd/approach", {"m": 30})
    cmd(port, "/api/cmd/goto", {"lat": here[0] + 0.0055, "lon": here[1]})   # ~610 m north
    st = wait_for(port, lambda s: dist_m(pos(s), home) > 400, limit=150)
    check("3. (arrange) the boat sails genuinely away from home first",
          lambda: dist_m(pos(st), home) > 400,
          lambda: "%.0f m out" % dist_m(pos(st), home))

    cmd(port, "/api/cmd/rth")
    st = wait_for(port, lambda s: s.get("behavior") == "rth", limit=10)
    d0 = dist_m(pos(st), home)
    check("4. Return-to-Home runs as a behaviour, aimed while still far out",
          lambda: st.get("behavior") == "rth" and st.get("run") == "running" and d0 > 300,
          lambda: "behavior=%s run=%s %.0f m to go" % (st.get("behavior"), st.get("run"), d0))
    st = wait_for(port, lambda s: dist_m(pos(s), home) < 120, limit=180)
    check("5. ... and it CLOSES ON THE HOME sethome captured - home is the target, not a label",
          lambda: dist_m(pos(st), home) < 120,
          lambda: "%.0f m -> %.0f m from home" % (d0, dist_m(pos(st), home)))

    # 6. A REFUSED spawn power-cycles NOTHING. The boat is holding at home mid-RTH - the
    # refusals must leave that run exactly as it was, and the identity unchanged.
    r_bad = cmd(port, "/api/cmd/spawn", {"lat": "abc", "lon": 0})
    r_range = cmd(port, "/api/cmd/spawn", {"lat": 91.0, "lon": 0})
    check("6. a spawn without numeric, in-range lat/lon is REFUSED",
          lambda: bool(r_bad.get("error")) and "numeric" in r_bad["error"]
          and bool(r_range.get("error")) and "out of range" in r_range["error"],
          "%s / %s" % (str(r_bad.get("error"))[:32], str(r_range.get("error"))[:28]))
    st = state(port)
    check("6b. ... and the refusals disturbed NOTHING: same boot, the RTH hold still standing",
          lambda: st.get("boot_id") == boot0 and st.get("run") == "running"
          and st.get("behavior") == "rth" and st.get("armed") is True,
          lambda: "boot same=%s run=%s behavior=%s"
                  % (st.get("boot_id") == boot0, st.get("run"), st.get("behavior")))

    # 7-8. AN ACCEPTED SPAWN IS A FULL POWER-CYCLE AT THE POINT. Fresh boat THERE, SAFE,
    # new identity - and home re-arms at the NEW position: the old home belongs to the
    # old life, and an RTH that still aimed at it would cross a kilometre of water the
    # operator never planned.
    target = (home[0], home[1] + 0.012)              # ~1.0 km east
    cmd(port, "/api/cmd/spawn", {"lat": target[0], "lon": target[1]})
    st = wait_for(port, lambda s: s.get("boot_id") != boot0
                  and pos(s)[0] is not None and dist_m(pos(s), target) < 150, limit=30)
    check("7. spawn brings a FRESH boat up AT the point: there, SAFE, idle, new identity",
          lambda: dist_m(pos(st), target) < 150 and st.get("armed") is False
          and st.get("run") == "idle" and st.get("plan_uploaded") is False
          and st.get("boot_id") and st.get("boot_id") != boot0
          and "Spawned here" in (st.get("note") or ""),
          lambda: "%.0f m off the point, armed=%s note=%s"
                  % (dist_m(pos(st), target), st.get("armed"), (st.get("note") or "")[:28]))
    st = wait_for(port, lambda s: s.get("home") is not None, limit=20)
    check("8. ... and home re-arms at the NEW position - the old home died with the old boat",
          lambda: st.get("home") is not None
          and dist_m((st["home"]["lat"], st["home"]["lon"]), target) < 150
          and dist_m((st["home"]["lat"], st["home"]["lon"]), home) > 500,
          lambda: "home %.0f m from the spawn point, %.0f m from the OLD home"
                  % (dist_m((st["home"]["lat"], st["home"]["lon"]), target),
                     dist_m((st["home"]["lat"], st["home"]["lon"]), home)))

    # 9-10. THE FIX, each half caught on its own. Before it, both of these "succeeded"
    # and set home from the dead boat's fix.
    cmd(port, "/api/disconnect")
    r = cmd(port, "/api/cmd/sethome")
    check("9. sethome after DISCONNECT refuses 'not connected' - no home from a dead boat's fix",
          lambda: bool(r.get("error")) and "not connected" in r["error"],
          str(r.get("error"))[:50])

    dead = free_port()
    cmd(port, "/api/connect", {"mode": "real", "host": "127.0.0.1", "port": dead})
    r = cmd(port, "/api/cmd/sethome")
    check("10. on a REAL link with no telemetry it refuses 'no position fix' - the previous "
          "boat's fix no longer stands in",
          lambda: bool(r.get("error")) and "no position fix" in r["error"],
          str(r.get("error"))[:50])
    r = cmd(port, "/api/cmd/spawn", {"lat": target[0], "lon": target[1]})
    check("11. spawn on a real link refuses simulator-only - reset's guard covers BOTH doors",
          lambda: bool(r.get("error")) and "simulator-only" in r["error"],
          str(r.get("error"))[:50])

    cmd(port, "/api/connect", {"mode": "sim"})
    st = wait_for(port, lambda s: pos(s)[0] is not None
                  and (s["status"] or {}).get("speed_key"), limit=30)
    check("12. a sim reconnect leaves the console healthy again",
          lambda: st.get("mode") == "sim" and pos(st)[0] is not None,
          lambda: "mode=%s" % st.get("mode"))

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
check("13. the console logged NO exception while serving those requests",
      not tb,
      ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb
      else "an answered request can still kill its handler")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
