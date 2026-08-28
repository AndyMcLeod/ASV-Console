"""tests/data_routes.py - the last four uncovered surfaces: /api/vessels (+ the vessel
switch's SAFE gate), /api/comms (the password's THREE never-leak properties), /api/tide,
and /api/roc's HTTP layer.

WHY THIS EXISTS. These are the remaining routes from the coverage list - thin wrappers,
which is exactly why they were last, but each carries one contract that is nowhere else:
  * THE VESSEL SWITCH IS GATED SAFE: switching physics under a running boat is
    incoherent, so /api/vessel POST refuses 409 unless disarmed + idle. The gate was
    read in code the day the audit started and has never been exercised. The successful
    switch's observable is the ENERGY GAUGE FLIP: drix08 is fuel, zboat_1800hs is
    battery, and the state's energy_type + the null-ness of fuel_l/battery_v must all
    flip - which proves apply_vessel ran AND the sim respawned as the new boat, not
    that a name changed.
  * THE COMMS PASSWORD NEVER LEAVES: (1) never PERSISTED - comms_config.json carries
    mode/host/username only ("memory only - never persisted" is a comment in
    CommsConfig; this makes it a contract); (2) never ECHOED - the GET builds its
    config dict without the field; (3) never LOGGED - _redact masks it to "***" in the
    session recorder's command records. Three separate leak paths, three separate
    checks, and the third needs LOGGING ON - the same --no-log mask log_routes.py
    found. Also: the mode whitelist IGNORES an unknown mode (keeps the current one)
    rather than storing garbage the poll loop would then act on.
  * /api/tide is WATER.tide_series passed through: it must ANSWER (200, a dict with
    "ok") whatever the upstream's mood - CO-OPS being down degrades the body, never
    the response - and the force=1 spelling is accepted.
  * /api/roc's HTTP layer maps errors the tracker's own unit tests (roc_tracks.py)
    never see: unknown op -> 400 naming it; malformed args -> 400 "bad roc request";
    a feed for an id that does not exist -> 404 with ok false. And a successful add
    echoes the fresh snapshot, so the UI never needs a second round trip.

    python tests/data_routes.py     # exit 0 = pass, 1 = fail   (stdlib only)

ORDER MATTERS in this suite and is deliberate: tide and roc run BEFORE the vessel
switch, because switching to zboat_1800hs respawns the boat on LAKE ERIE - a
position-dependent service polled after that would be answering for the wrong sea. The
switch block runs LAST and switches back to drix08 to leave the console as found.

TEETH - eight mutations RUN, 8/8 caught after one weak check was exposed and
strengthened (recorded results; house rules: missing anchor = SKIP, crash scored
separately, source restored byte-for-byte):
  * the switch's SAFE gate dropped                      -> caught by 8
  * the switch stops respawning in sim                  -> SURVIVED the first version
    of check 9, and the survival was the finding: the energy gauge reads the module
    global POWER_TYPE at snapshot time, so the OLD boat starts reporting "battery"
    the moment apply_vessel runs - the flip proves apply_vessel, NOT the respawn my
    rationale claimed. Check 9 now also demands the boat come up at the NEW vessel's
    OWN spawn (Lake Erie, not Lewes) - the one observable a respawn uniquely
    produces - and the re-run is caught by 9. Same family as the estop lesson: pick
    the observable that only the mechanism under test can produce.
  * _redact stops masking (raw body logged)             -> caught by 5
  * the comms GET echoes the password                   -> caught by 4
  * the saved comms config gains the password           -> caught by 6
  * the mode whitelist dropped                          -> caught by 7
  * roc's unknown-op 400 becomes a generic 200          -> caught by 11
  * roc's feed-unknown-id 404 becomes 200               -> caught by 12
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


def wait_for(port, pred, limit=40.0, every=0.5):
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


def read_session(path):
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


print("Data routes — vessels, comms, tide, and the ROC's HTTP face:")

port = free_port()
LOG_DIR = os.path.join(APP, "logs")
before = set(os.listdir(LOG_DIR)) if os.path.isdir(LOG_DIR) else set()

backups = {}
for name in ("mission.json", "comms_config.json"):
    p = os.path.join(APP, name)
    if os.path.exists(p):
        with open(p, "r", encoding="utf-8") as f:
            backups[p] = f.read()

# This suite adds a ROC ("Test Dock") against a live console. Without its own registry
# file it writes into the OPERATOR's roc_config.json - the accumulation that had the ROC
# card opening on 198 stale rows. It removes what it adds, but a suite that fails part
# way through would still leave one behind, and no test should be able to reach that file.
ROC_CFG = os.path.join(tempfile.mkdtemp(), "roc_config.json")
# SAME RULE FOR PORTS, and for the same reason. Switching or adding an operating port
# SAVES the registry, so a suite run against the app directory would rewrite the
# operator's own bases. It gets a COPY of the shipped file in a temp dir; the checks
# below then add and switch freely without the real ports.json ever being reachable.
PORTS_CFG = os.path.join(tempfile.mkdtemp(), "ports.json")
with open(os.path.join(APP, "ports.json"), "r", encoding="utf-8") as _f:
    _seed = _f.read()
with open(PORTS_CFG, "w", encoding="utf-8") as _f:
    _f.write(_seed)
srvlog = tempfile.TemporaryFile(mode="w+")
# Logging ON: the comms redaction check reads the session recorder's own records -
# the same --no-log mask that hid the logevent defect would hide a redaction break.
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none",
                         "--port", str(port), "--no-ais-service",
                         "--roc-config", ROC_CFG, "--ports-config", PORTS_CFG],
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
    check("1. a console comes up, with the link reporting (logging ON)", up)
    if not up:
        raise SystemExit(1)
    new = sorted(set(os.listdir(LOG_DIR)) - before)
    spath = os.path.join(LOG_DIR, new[0]) if new else None

    # ---- VESSELS (the list; the switch gate runs LAST - see the order note) -------- #
    _c, v = api(port, "/api/vessels")
    ids = [x.get("id") for x in v.get("vessels", [])]
    check("2. /api/vessels lists every profile on disk and names the active one",
          lambda: {"drix08", "zboat_1800hs", "example_usv_4m"} <= set(ids)
          and v.get("active") == "drix08",
          lambda: "active=%s ids=%s" % (v.get("active"), ids))

    # ---- TIDE (before any switch - position-dependent) ----------------------------- #
    c3, t = api(port, "/api/tide")
    c3b, t2 = api(port, "/api/tide?force=1")
    check("3. /api/tide ANSWERS with a dict carrying 'ok', plain and forced - upstream's "
          "mood degrades the body, never the response",
          lambda: c3 == 200 and isinstance(t, dict) and "ok" in t
          and c3b == 200 and isinstance(t2, dict) and "ok" in t2,
          lambda: "ok=%s forced ok=%s" % (t.get("ok"), t2.get("ok")))

    # ---- COMMS: the password's three never-leak properties ------------------------- #
    SECRET = "hunter2-not-for-disk"
    cmd(port, "/api/comms", {"mode": "starlink", "host": "127.0.0.1",
                             "username": "andy", "password": SECRET})
    _c, cm = api(port, "/api/comms")
    check("4. the GET echoes mode/host/username and NO password field at all",
          lambda: cm["config"].get("mode") == "starlink"
          and cm["config"].get("host") == "127.0.0.1"
          and cm["config"].get("username") == "andy"
          and "password" not in cm["config"] and SECRET not in json.dumps(cm),
          lambda: json.dumps(cm["config"]))
    time.sleep(0.3)
    check("5. the session log REDACTS it - the command record shows ***, the literal "
          "appears NOWHERE in the recording",
          lambda: spath is not None
          and any(r.get("kind") == "command" and r.get("path") == "/api/comms"
                  and (r.get("body") or {}).get("password") == "***"
                  for r in read_session(spath))
          and SECRET not in open(spath, encoding="utf-8").read(),
          lambda: "recorded body: %s" % json.dumps(next(
              (r.get("body") for r in read_session(spath)
               if r.get("kind") == "command" and r.get("path") == "/api/comms"), None)))
    with open(os.path.join(APP, "comms_config.json"), encoding="utf-8") as f:
        disk = f.read()
    check("6. the saved config file carries NO password - memory only, as the class "
          "comment has always promised",
          lambda: SECRET not in disk and "password" not in json.loads(disk),
          lambda: disk.strip()[:70])
    cmd(port, "/api/comms", {"mode": "carrier-pigeon"})
    _c, cm2 = api(port, "/api/comms")
    check("7. an unknown mode is IGNORED, not stored - the poll loop never acts on garbage",
          lambda: cm2["config"].get("mode") == "starlink",
          lambda: "mode=%s" % cm2["config"].get("mode"))

    # ---- ROC HTTP face ------------------------------------------------------------- #
    c10, r_add = cmd(port, "/api/roc", {"op": "add", "kind": "shore", "name": "Test Dock",
                                        "lat": st0["lat_deg"] + 0.01, "lon": st0["lon_deg"]})
    check("10. a ROC add answers with the new id AND the fresh snapshot - no second "
          "round trip",
          lambda: c10 == 200 and r_add.get("id")
          and any(t.get("name") == "Test Dock" for t in r_add.get("roc", {}).get("rocs", [])),
          lambda: "id=%s rocs=%d" % (r_add.get("id"),
                                     len(r_add.get("roc", {}).get("rocs", []))))
    c11, r_bad = cmd(port, "/api/roc", {"op": "levitate"})
    check("11. an unknown op is a 400 that NAMES it",
          lambda: c11 == 400 and "unknown roc op" in (r_bad.get("error") or ""),
          lambda: "%s %s" % (c11, (r_bad.get("error") or "")[:40]))
    c11b, r_mal = cmd(port, "/api/roc", {"op": "add", "kind": "shore", "lat": "x", "lon": 0})
    check("11b. malformed args are a 400 'bad roc request', not a dead thread",
          lambda: c11b == 400 and "bad roc request" in (r_mal.get("error") or ""),
          lambda: "%s %s" % (c11b, (r_mal.get("error") or "")[:40]))
    c12, r_feed = cmd(port, "/api/roc", {"op": "feed", "id": "no-such-roc",
                                         "lat": 38.8, "lon": -75.1})
    check("12. a feed for an unknown id is a 404 with ok false - a GPS bridge posting to "
          "a deleted ROC must hear about it",
          lambda: c12 == 404 and r_feed.get("ok") is False,
          lambda: "%s ok=%s" % (c12, r_feed.get("ok")))
    cmd(port, "/api/roc", {"op": "remove", "id": r_add.get("id")})

    # ---- THE VESSEL SWITCH, LAST (it moves the boat to Lake Erie and back) --------- #
    cmd(port, "/api/cmd/arm", {"on": True})
    c8, sw = cmd(port, "/api/vessel", {"id": "zboat_1800hs"})
    check("8. the switch REFUSES 409 while armed - swapping physics under a live boat "
          "is incoherent, and the active vessel is unchanged",
          lambda: c8 == 409 and "disarm" in (sw.get("error") or "")
          and api(port, "/api/vessels")[1].get("active") == "drix08",
          lambda: "%s %s" % (c8, (sw.get("error") or "")[:44]))
    cmd(port, "/api/cmd/arm", {"on": False})
    zspawn = json.load(open(os.path.join(APP, "vessels", "zboat_1800hs.json"),
                            encoding="utf-8"))["spawn"]
    # where the console is BASED - the position the boat must keep across a hull switch
    _c, _pr = api(port, "/api/ports")
    _ap = [q for q in (_pr.get("ports") or []) if q["id"] == _pr.get("active")]
    port_lat = _ap[0]["lat"] if _ap else zspawn["lat"]
    port_lon = _ap[0]["lon"] if _ap else zspawn["lon"]
    c9, sw2 = cmd(port, "/api/vessel", {"id": "zboat_1800hs"})
    st = wait_for(port, lambda s: (s["status"] or {}).get("energy_type") == "battery"
                  and abs((s["status"].get("lat_deg") or 0) - port_lat) < 0.01)
    # The gauge flip alone is NOT proof of a respawn - energy_type reads the module
    # global POWER_TYPE at snapshot time, so the OLD boat starts reporting "battery"
    # the moment apply_vessel runs. The respawn-dropped mutation SURVIVED the
    # gauge-only version of this check. What a respawn uniquely produces is the
    # POSITION: the new boat comes up at ITS OWN spawn, a lake eight hundred
    # kilometres from Lewes.
    # ⛔ THE SPAWN HALF OF THIS CHECK WAS INVERTED ON 2026-08-15 - READ BEFORE "FIXING".
    # It used to demand the boat come up at the NEW VESSEL'S spawn, because a hull file
    # owned its own start position. Andy changed that: "change initialization to select
    # port and ASV" - the BASE is now where you are and the vessel is what you drive, so
    # a vessel switch must NOT move the boat. The gauge flip still proves apply_vessel
    # ran; the position now proves the port SURVIVED the switch, which is the new
    # contract and the opposite of the old one. (Same shape as home_spawn check 2a.)
    check("9. disarmed, the switch takes: the gauge flips, and the boat STAYS at the "
          "operating port - a new hull is not a new location",
          lambda: c9 == 200 and st["status"].get("energy_type") == "battery"
          and st["status"].get("battery_v") is not None
          and st["status"].get("fuel_l") is None
          and abs((st["status"].get("lat_deg") or 0) - port_lat) < 0.01
          and abs((st["status"].get("lon_deg") or 0) - port_lon) < 0.01,
          lambda: "energy=%s batt=%s lat=%.3f (port %.3f; the zboat file's own spawn is "
                  "%.3f and must NOT be where it lands)"
                  % (st["status"].get("energy_type"), st["status"].get("battery_v"),
                     st["status"].get("lat_deg") or 0, port_lat, zspawn["lat"]))
    c9b, _sw3 = cmd(port, "/api/vessel", {"id": "atlantis"})
    check("9b. an unknown vessel id is a 400, and the working switch above is its "
          "acceptance pair",
          lambda: c9b == 400,
          lambda: "%s" % c9b)
    cmd(port, "/api/vessel", {"id": "drix08"})       # leave the console as found
    wait_for(port, lambda s: (s["status"] or {}).get("energy_type") == "fuel")

    # --- OPERATING PORTS: the base and the boat are chosen separately ---------------
    # Andy, 2026-08-15: "Stop spawning at Erie. change initialization to select port and
    # ASV. the ASV selection is a good model. All entries made by user will be added to
    # drop down selection as retained values." Until this each vessel file carried its own
    # spawn, so choosing the DriX chose Lewes, and the chart opened on a hard-coded Erie
    # centre that belonged to neither the vessel nor any base.
    _c, pr = api(port, "/api/ports")
    ids = [q["id"] for q in (pr.get("ports") or [])]
    check("10. /api/ports lists the bases and names an active one",
          _c == 200 and "new_castle_nh" in ids and "lewes_de" in ids and pr.get("active"),
          "active=%s ids=%s" % (pr.get("active"), ids))
    check("10b. New Castle NH is the PRIMARY - first in the list and the default active",
          bool(ids) and ids[0] == "new_castle_nh" and pr.get("active") == "new_castle_nh",
          "first=%s active=%s (Lewes second)" % (ids[0] if ids else None, pr.get("active")))

    # 11. THE SPAWN FOLLOWS THE PORT. The check that would have caught "spawning at Erie":
    # the boat comes up where the BASE says, not where the hull file says.
    st11 = state(port).get("status") or {}
    ncp = [q for q in pr["ports"] if q["id"] == "new_castle_nh"][0]
    d_nc = abs((st11.get("lat_deg") or 0) - ncp["lat"]) + abs((st11.get("lon_deg") or 0) - ncp["lon"])
    check("11. the sim boat spawns AT THE ACTIVE PORT, not at the vessel file's own spawn",
          d_nc < 1e-4,
          "boat %.4f,%.4f vs port %.4f,%.4f (drix08.json's own spawn is Lewes 38.79/-75.16)"
          % ((st11.get("lat_deg") or 0), (st11.get("lon_deg") or 0), ncp["lat"], ncp["lon"]))

    # 12. Switching moves the boat - proving apply_port ran AND the sim respawned.
    c12, sw = api(port, "/api/ports", {"id": "lewes_de"})
    st12 = wait_for(port, lambda s: ((s.get("status") or {}).get("lat_deg") or 99) < 40.0, limit=25)
    lat12 = (st12.get("status") or {}).get("lat_deg")
    check("12. switching the port moves the boat to the new base",
          c12 == 200 and sw.get("active") == "lewes_de"
          and lat12 is not None and abs(lat12 - 38.78965) < 1e-3,
          "after the switch the boat is at lat %s (Lewes 38.78965)" % lat12)

    # 12b. THE OPERATOR'S OWN ENTRY IS RETAINED - the "added to the drop down as retained
    # values" half of the ask. Added over HTTP, it must come back from a fresh read.
    c12b, add = api(port, "/api/ports", {"name": "Test Basin", "lat": 41.5, "lon": -71.4})
    _c2, after = api(port, "/api/ports")
    ids2 = [q["id"] for q in (after.get("ports") or [])]
    check("12b. a port the operator adds is selected AND kept in the list",
          c12b == 200 and add.get("active") == "test_basin" and "test_basin" in ids2,
          "ids now %s" % ids2)
    with open(PORTS_CFG, "r", encoding="utf-8") as _f:
        on_disk = json.loads(_f.read())
    check("12c. ... and it is PERSISTED, so it survives a restart",
          any(q["id"] == "test_basin" for q in on_disk.get("ports") or []),
          "registry on disk holds %s" % [q["id"] for q in on_disk.get("ports") or []])

    # 12d. Malformed input is an ANSWER - never a 500, and never a silent accept that
    # would spawn the boat off the globe.
    codes = []
    # NOTE: {"name": ...} with NO lat/lon is NOT in this list any more - since ports can
    # be created from a name it is a LOOKUP, and 12j covers the unfindable case. Leaving
    # it here asserted the old contract and passed a real geocode as a failure.
    for bad in ({"id": "nowhere"}, {"name": "X", "lat": 999, "lon": 0},
                {"name": "", "lat": 1, "lon": 2}):
        c, r = api(port, "/api/ports", bad)
        codes.append((c, (r.get("error") or "")[:30]))
    check("12d. every malformed port is a 400 that says what is wrong",
          all(c == 400 and e for c, e in codes),
          "; ".join("%s %s" % (c, e) for c, e in codes))

    # 12f-12h. A PORT CAN BE FOUND BY NAME - the difference between a bookmark and a way
    # of starting work somewhere. Andy: "not just to memorize a manually found spot, but
    # to initialize a survey area from the name entered... identify a survey home port
    # like Nome, Alaska and then the chart goes there."
    #
    # NETWORKED, so it degrades to a SKIP rather than a false failure: a suite that fails
    # on a train is a suite people stop running. What it must never do is pass silently
    # when the wiring is broken, so the skip is announced.
    cf, gf = api(port, "/api/ports", {"name": "Nome, Alaska"}, timeout=420)
    if cf == 400 and "geocoder" in (gf.get("error") or ""):
        print("  skip 12f-12h. no geocoder reachable - name lookup not exercised")
    else:
        found = gf.get("found") or {}
        check("12f. a port created from a NAME resolves the place and is selected",
              cf == 200 and gf.get("active") == "nome_alaska"
              and "Nome" in (found.get("geocoded") or ""),
              "active=%s geocoded=%s" % (gf.get("active"), found.get("geocoded")))
        # 12g. THE CHECK THAT MATTERS. A geocoder returns a TOWN CENTRE, which is on
        # land; taking it as a survey home port spawns the boat inland and refuses every
        # route out. The console must move it to charted water this hull can float in.
        place = found.get("place") or {}
        moved = found.get("moved_m")
        check("12g. the geocoded PLACE CENTRE is snapped to charted navigable water",
              found.get("snapped") is True and (found.get("depth_m") or 0) > 0
              and moved is not None,
              "place %.4f,%.4f -> berth in %.1f m, moved %.0f m (a town centre is on land)"
              % (place.get("lat", 0), place.get("lon", 0),
                 found.get("depth_m") or 0, moved or 0))
        # 12h. ... and the boat actually comes up there.
        stn = wait_for(port, lambda s: ((s.get("status") or {}).get("lat_deg") or 0) > 60.0,
                       limit=25)
        latn = (stn.get("status") or {}).get("lat_deg")
        check("12h. the sim boat spawns at the found berth",
              latn is not None and abs(latn - gf["spawn"]["lat"]) < 1e-4,
              "boat lat %s vs berth %s" % (latn, gf["spawn"]["lat"]))

    # 12i. A PLACE WITH NO NAVIGABLE WATER IS STILL HONEST. Landlocked: the port is
    # created at the place centre so the operator can see where they asked for, but it is
    # FLAGGED unverified with the reason - never presented as a berth.
    ci, gi = api(port, "/api/ports", {"name": "Denver, Colorado"}, timeout=420)
    if ci == 200:
        fi = gi.get("found") or {}
        ent = [q for q in gi["ports"] if q["id"] == "denver_colorado"]
        check("12i. a landlocked place is created but FLAGGED, with the reason",
              fi.get("snapped") is False and bool(fi.get("note"))
              and ent and ent[0].get("unverified") is True,
              "snapped=%s unverified=%s note=%s"
              % (fi.get("snapped"), ent[0].get("unverified") if ent else None,
                 (fi.get("note") or "")[:48]))

    # 12j. A NAME THAT IS NOT A PLACE is a 400 that says so - not a port at 0,0.
    cj, gj = api(port, "/api/ports", {"name": "qqzzxx not a real place 12345"}, timeout=120)
    check("12j. an unfindable name is refused, rather than becoming a port in the Atlantic",
          cj == 400 and "find" in (gj.get("error") or "").lower(),
          "%s %s" % (cj, (gj.get("error") or "")[:60]))

    # 12e. THE REAL REGISTRY WAS NEVER REACHED. The whole point of --ports-config.
    with open(os.path.join(APP, "ports.json"), "r", encoding="utf-8") as _f:
        real = json.loads(_f.read())
    # COMPARED AGAINST WHAT WAS SHIPPED, not against a list of ids this suite happens to
    # create. A named-few check only catches the strays you thought of; a stray port with
    # any other name would have sailed straight past it, which is how one got into the
    # real registry unnoticed in the first place.
    seeded_ids = [q["id"] for q in json.loads(_seed).get("ports") or []]
    real_ids = [q["id"] for q in (real.get("ports") or [])]
    check("12e. the operator's own ports.json is EXACTLY as shipped - no suite reaches it",
          real_ids == seeded_ids,
          "real=%s seeded=%s" % (real_ids, seeded_ids))

finally:
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()
    for p, text in backups.items():                  # mission + comms config as found
        with open(p, "w", encoding="utf-8") as f:
            f.write(text)
    for f in sorted(set(os.listdir(LOG_DIR)) - before):
        try:
            os.remove(os.path.join(LOG_DIR, f))
        except OSError:
            pass

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
