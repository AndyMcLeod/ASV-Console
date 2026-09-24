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
  * sethome - TWO SOURCES FOR ONE FIELD. With an explicit lat/lon it sets HOME at that
    point (2a); with none it captures the vessel's PRESENT fix (2b). Half a coordinate is
    refused rather than silently falling back (2c), and a coordinate that is not one is a
    stated refusal rather than a dropped connection (2d). No arm gate, by design: setting
    home while SAFE is normal.
    CHANGED 2026-08-08 at the operator's instruction. This suite used to assert the exact
    OPPOSITE of 2a - a supplied position was discarded, and check 2 posted a decoy to
    prove it - because home was defined as "where the boat is", never "where the client
    says". The right-click chart menu now sets HOME at the clicked point. THE HAZARD DID
    NOT DISAPPEAR, IT MOVED: RTH still drives to HOME, so a home the vessel never occupied
    is still a destination nobody validated. What guards it now is (a) the client warning
    when the chosen point sits inside the keep-out model, at the moment the operator is
    looking at that spot, and (b) RTH still refusing a route it cannot plan clear. If a
    later session finds this surprising, that is the reason - do not "restore" the old
    rule without asking.
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

TEETH (recorded results, not predictions; the runner scores a missing anchor as SKIP and a
crash as its own outcome, never as "caught"):
  * sethome IGNORES an explicit lat/lon (the pre-2026-08-08 rule)  -> caught by 2a
  * ... and the mirror: a bodyless sethome uses the LAST explicit  -> caught by 2b, which
    point instead of the live fix                                     is why 2b runs second
  * a half-given coordinate falls back to the present position     -> caught by 2c
  * the local numeric guard dropped (a bare float() under          -> caught by 2d
    _dispatch_post's catch-all)
  * the RANGE guard dropped, so inf/nan reach HOME                 -> caught by 2d + 2e,
    but ONLY after 2e was rewritten - twice. It first CRASHED the harness instead of
    failing a check: the suite died at an unguarded call and printed NO FAIL line at all,
    which a mutation runner cannot tell from a pass. The first rewrite asserted the
    console was still ANSWERING - and it was: a nan home serialises fine and /api/state
    returns it, so the check passed, the suite took (nan, nan) as its RTH target, and died
    four checks later. The invariant that actually matters is that HOME IS STILL A USABLE
    COORDINATE, because every check below steers to it. Now the abort reads
    "aborted: home {'lat': nan, ...}".
    TWO RULES FALL OUT: a suite must survive the fault it tests for or it cannot report
    it; and when a harness dies, fix WHAT KILLED IT rather than the first symptom visible
    from where you are standing.
  * the isfinite() guard dropped ALONE                             -> SURVIVES, correctly:
    -90.0 <= x <= 90.0 is already False for inf, -inf and nan (every nan comparison is),
    so nothing could reach it. It was deleted rather than kept - a guard that cannot be
    earned is not defence in depth, it is dead code.
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
# ITS OWN STATE FOLDER (review #16): this console never reads or writes the operator's plan, settings
# or logs - no snapshot of mission.json, and no write-back of one when the suite ends.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from console_state import ConsoleState  # noqa: E402
STATE = ConsoleState()
# ⚠⚠ A PERSISTED ROC HOME - THE SHAPE THAT PUT HOME 500 km FROM THE BOAT (Erie, 2026-09-23).
# roc_config.json from an Aug demo held an active Mothership at 38.8 N off Delaware with
# "home_id" pointed at it. Every boot restored the selection, home_intent() planted the ship's
# position as home on the first frame, and reset() nulled `home` without releasing the ROC, so
# the next tick planted it again: neither the initial spawn nor any requested one could put home
# where the boat was. This console boots on exactly that file, with the ship parked in the Gulf
# of Maine - hundreds of km from any vessel's spawn - and static. 1b is the boot, 8b/8c the spawn.
SHIP = (44.5, -68.0)
with open(STATE.path("roc_config.json"), "w", encoding="utf-8") as f:
    json.dump({"rocs": [{"id": "ship-1", "name": "Mothership", "kind": "ship", "status": "active",
                         "lat": SHIP[0], "lon": SHIP[1], "heading": 0, "speed_kn": 0}],
               "home_id": "ship-1"}, f)

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

    here = (st0["lat_deg"], st0["lon_deg"])

    # 1b. THE INITIAL SPAWN: home is the boat's first fix, NOT the ROC the file names. Before
    # 2026-09-23 this read home at the ship while the boat sat somewhere else entirely, and the
    # snapshot said so: roc.home_id "ship-1", home_source "ship-1".
    st = wait_for(port, lambda s: s.get("home") is not None, limit=20)
    hm = st.get("home") or {}
    check("1b. BOOT with a persisted ROC home: home is the FIRST FIX, no ROC owns it, and the "
          "ship itself is still on the card",
          lambda: bool(hm) and dist_m((hm["lat"], hm["lon"]), here) < 150
          and dist_m((hm["lat"], hm["lon"]), SHIP) > 100000
          and st.get("home_source") is None and (st.get("roc") or {}).get("home_id") is None
          and any(r.get("id") == "ship-1" for r in (st.get("roc") or {}).get("rocs") or []),
          lambda: "home %s: %.0f m from the boat, %.0f km from the ship; home_source=%s "
                  "roc.home_id=%s" % (json.dumps(hm),
                                      dist_m((hm["lat"], hm["lon"]), here) if hm else -1,
                                      dist_m((hm["lat"], hm["lon"]), SHIP) / 1000 if hm else -1,
                                      st.get("home_source"), (st.get("roc") or {}).get("home_id")))

    # 2. TWO SOURCES FOR ONE FIELD, and both need pinning - which is why this is now four
    # checks. Until 2026-08-08 a supplied position was DISCARDED and check 2 asserted
    # exactly that; the operator asked for the chart's right-click point to set HOME, so an
    # explicit lat/lon is honoured. THE HAZARD THE OLD RULE GUARDED HAS NOT GONE AWAY - RTH
    # still drives to HOME - it has moved to where the operator can see it: the client
    # warns when the chosen point is inside the keep-out model, and RTH refuses a route it
    # cannot plan. What this suite must hold is that each source lands where it says, that
    # neither silently stands in for the other, and that a coordinate is validated as input.

    # 2a. AN EXPLICIT POINT IS HONOURED EXACTLY - not nudged, not rounded toward the boat.
    chosen = {"lat": here[0] + 0.5, "lon": here[1] + 0.5}
    cmd(port, "/api/cmd/sethome", chosen)
    st = state(port)
    check("2a. sethome HONOURS an explicit lat/lon - home lands on the chosen point",
          lambda: st.get("home") is not None
          and dist_m((st["home"]["lat"], st["home"]["lon"]),
                     (chosen["lat"], chosen["lon"])) < 1
          and dist_m((st["home"]["lat"], st["home"]["lon"]), here) > 10000,
          lambda: "home %.1f m from the chosen point, %.0f km from the boat"
                  % (dist_m((st["home"]["lat"], st["home"]["lon"]),
                            (chosen["lat"], chosen["lon"])),
                     dist_m((st["home"]["lat"], st["home"]["lon"]), here) / 1000))

    # 2b. NO POINT still means THE BOAT'S OWN FIX - the original contract, and the one the
    # stale-telemetry guards in checks 9-10 protect. Deliberately run AFTER 2a so it has to
    # MOVE home back off the explicit point: run first, a no-op would inherit 2a's answer
    # and pass on it.
    cmd(port, "/api/cmd/sethome")
    st = state(port)
    check("2b. ... and with NO position it still captures the boat's PRESENT fix",
          lambda: st.get("home") is not None
          and dist_m((st["home"]["lat"], st["home"]["lon"]), here) < 50,
          lambda: "home %.0f m from the boat"
                  % dist_m((st["home"]["lat"], st["home"]["lon"]), here))

    # 2c. HALF A COORDINATE IS A REFUSAL, never a silent fall-back to the present position.
    # Setting HOME somewhere other than the caller named is the substitution both branches
    # exist to prevent, and a partial body is the shape that invites it.
    r_half = cmd(port, "/api/cmd/sethome", {"lat": here[0] + 0.2})
    st_half = state(port)
    check("2c. a HALF-given coordinate refuses - it never falls back to the boat",
          lambda: bool(r_half.get("error"))
          and dist_m((st_half["home"]["lat"], st_half["home"]["lon"]), here) < 50,
          lambda: "%r; home unchanged %.0f m from the boat"
                  % (str(r_half.get("error"))[:40],
                     dist_m((st_half["home"]["lat"], st_half["home"]["lon"]), here)))

    # 2d. AND IT IS VALIDATED AS INPUT. A coordinate that is not a coordinate must not
    # reach the field RTH drives to.
    #
    # THE REFUSAL HAS TO NAME THE RULE, and that clause is not decoration - it is the only
    # thing separating a guard from a crash. _dispatch_post ends in a catch-all that turns
    # any stray exception into a 500 with the interpreter's own message, so an UNGUARDED
    # float() still comes back as "an error": the first version of this check asserted only
    # that some error string arrived and SURVIVED the mutation that removed the guard
    # entirely. A local refusal says "home ..."; the catch-all says "could not convert
    # string to float". The difference is a handler refusing versus a handler falling over,
    # and the session recorder logs them differently.
    bad_results = []
    for body in ({"lat": "abc", "lon": -75.0},        # not a number
                 {"lat": 91.0, "lon": -75.0},         # off the globe
                 {"lat": float("inf"), "lon": -75.0},  # non-finite (the range guard's job)
                 {"lat": float("nan"), "lon": -75.0}):
        try:
            bad_results.append(cmd(port, "/api/cmd/sethome", body).get("error"))
        except Exception as e:                       # a dropped connection IS the failure
            bad_results.append("THREW %s" % type(e).__name__)

    # READ THE STATE DEFENSIVELY. Mutating the range guard away CRASHED this harness rather
    # than failing a check: a non-finite home reaches the engine, the console stops
    # answering, and the suite died at the next unguarded call having printed no FAIL line
    # at all - which a mutation runner cannot tell from a pass. That is the same trap the
    # runner has at its own level, one level down, and the fix is the same: SURVIVE the
    # fault so it can be REPORTED. 2e states the verdict; the guard here just keeps the
    # process alive long enough to say it.
    try:
        st_bad = state(port)
        _hb = st_bad.get("home") or {}
        _hlat, _hlon = _hb.get("lat"), _hb.get("lon")
        # USABLE, not merely PRESENT. The first version of 2e asked only whether the console
        # was still answering - and it WAS: a NaN home serialises fine and /api/state returns
        # it happily. The suite passed 2e, took (nan, nan) as its RTH target, and died four
        # checks later. The fault is not "the console fell over", it is "a coordinate that is
        # not a coordinate reached the field Return-to-Home drives to", so that is what gets
        # asserted here.
        usable = (isinstance(_hlat, (int, float)) and isinstance(_hlon, (int, float))
                  and math.isfinite(_hlat) and math.isfinite(_hlon)
                  and dist_m((_hlat, _hlon), here) < 50)
        why = "home %r" % (_hb,) if not usable else "answering, home usable"
    except Exception as e:
        st_bad, usable, why = ({"home": {"lat": 0.0, "lon": 0.0}}, False,
                               "state() THREW %s - the console stopped answering"
                               % type(e).__name__)
    check("2d. a malformed home is a refusal that NAMES the rule, not a crash or a drop",
          lambda: all(isinstance(e, str) and e.startswith("home ") for e in bad_results)
          and dist_m((st_bad["home"]["lat"], st_bad["home"]["lon"]), here) < 50,
          lambda: "%s; home still %.0f m from the boat"
                  % ([str(e)[:30] for e in bad_results],
                     dist_m((st_bad["home"]["lat"], st_bad["home"]["lon"]), here)))

    check("2e. ... and HOME is still a USABLE coordinate afterwards - RTH drives to it",
          lambda: usable is True, lambda: why)
    if usable is not True:
        # EVERY CHECK BELOW STEERS TO THIS VALUE. Continuing with a poisoned home means
        # sailing at (nan, nan) and dying at some unguarded call four checks later, having
        # printed no summary - which a mutation runner cannot tell from a pass. Exit through
        # the SAME summary line the suite normally ends on, so it is scored as a FAILURE.
        print("\n%d CHECK(S) FAILED (%d ran)  [aborted: %s]" % (fails, ran, why))
        sys.exit(1)

    home = (st_bad["home"]["lat"], st_bad["home"]["lon"])
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

    # 8b-8c. A REQUESTED SPAWN WHILE A ROC OWNS HOME. 8b is the CONTROL: the operator selects
    # the ship and home really goes to it - or 8c is a statement about a home that was never
    # anywhere else. Then a spawn: before 2026-09-23 reset() nulled `home` and the still-selected
    # ship re-planted its point on the next tick, so the boat came up where the operator clicked
    # and home stayed with the ship.
    boot1 = st.get("boot_id")
    cmd(port, "/api/roc", {"op": "select_home", "id": "ship-1"})
    st = wait_for(port, lambda s: s.get("home_source") == "ship-1" and s.get("home") is not None,
                  limit=15)
    hm = st.get("home") or {}
    check("8b. (control) the ship selected as HOME takes it - home goes to the ship",
          lambda: st.get("home_source") == "ship-1" and bool(hm)
          and dist_m((hm["lat"], hm["lon"]), SHIP) < 2000,
          lambda: "home_source=%s home=%s" % (st.get("home_source"), json.dumps(hm)))
    target2 = (target[0] + 0.009, target[1])          # ~1.0 km north of the last spawn
    cmd(port, "/api/cmd/spawn", {"lat": target2[0], "lon": target2[1]})
    st = wait_for(port, lambda s: s.get("boot_id") not in (None, boot1)
                  and s.get("home") is not None and s.get("home_source") is None, limit=30)
    hm = st.get("home") or {}
    check("8c. a spawn RELEASES the ROC that owned home: home re-arms at the SPAWN POINT, "
          "no ROC owns it, and the ship is still on the card",
          lambda: st.get("boot_id") not in (None, boot1) and bool(hm)
          and dist_m((hm["lat"], hm["lon"]), target2) < 150
          and dist_m((hm["lat"], hm["lon"]), SHIP) > 100000
          and st.get("home_source") is None and (st.get("roc") or {}).get("home_id") is None
          and any(r.get("id") == "ship-1" for r in (st.get("roc") or {}).get("rocs") or []),
          lambda: "home %s: %.0f m from the spawn point, %.0f km from the ship; home_source=%s "
                  "roc.home_id=%s" % (json.dumps(hm),
                                      dist_m((hm["lat"], hm["lon"]), target2) if hm else -1,
                                      dist_m((hm["lat"], hm["lon"]), SHIP) / 1000 if hm else -1,
                                      st.get("home_source"), (st.get("roc") or {}).get("home_id")))

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

srvlog.seek(0)
server_out = srvlog.read()
srvlog.close()
# tracebacks and routes that raised - not every line that says "Error" (tests/lib/server_log.py, review #17)
from server_log import exception_lines  # noqa: E402
tb = exception_lines(server_out)
check("13. the console logged NO exception while serving those requests",
      not tb,
      ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb
      else "an answered request can still kill its handler")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
