"""tests/mission_record.py - a REAL console, logging ON, records a mission that describes itself (2026-11-05).

Andy, 2026-11-05: "The playback function should display targets from AIS and any other sensor we may add. It should
have all the environmental data for playback. Look at the logging function(s) and add in data that fully describes any
given mission."

Other real-console harnesses leave the recording on but never read the file back, so the recorder was code no live
suite judged. This one boots a
console WITH its recording on (--sim --no-ais-service, a temp --state-dir, --browser none, on the first free port of
8795-8799 - never 8791, never a console it did not start), pointed at a STUB AIS provider of its own (so it never asks
the operator's AIS service anything), drives a plan, a Go-To, a test contact and a page safety event, and reads the
session file back STRICTLY:

  * the session describes itself once, in order: session_start, manifest (build, git read by file, runtime, zone,
    flags, paths, the AIS setup), port, vessel (its file's digest), the plan on disk;
  * the 4 Hz frame carries the vessel and port ids, and the sim's forcing;
  * the environment is its own stream and the logged state leaves the four blocks out;
  * TARGETS ARE RECORDED BY THE CONSOLE with no page polling: the AIS provider's contacts inside the range and the
    test contact, sorted by range, their particulars, the provider's health WHITELISTED - and no `ais` record from the
    handler any more; the /api/ais answer is the same function's;
  * what the link is given (`plan_loaded`, upload and Go-To), runs with a start and an end, a saved plan's digest;
  * a page safety event's incident window: the frames before and after it, in one record;
  * commands attributed (client, rx_t, ms), /api/logevent written once (as client:*, with `_tab`), not twice;
  * /api/logs labels the file; no line is non-finite; the console hit no exception; the app's own logs/ is untouched.

    python tests/mission_record.py      # exit 0 = pass, 1 = fail   (stdlib only; ~75 s)
    ASV_APP=<a copy of the app> python tests/mission_record.py      # a mutation run against a copy

TEETH: every check was run against a mutant on a COPY of the app (ASV_APP), never the source in place - the list and
the results are in the mission-record build report.
"""

import hashlib
import json
import math
import os
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer


# --- crash guard: a throw outside a check() must still REPORT ---------------------------
def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-800:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")
    # FLUSH BEFORE os._exit: it skips interpreter shutdown - no atexit and no stdout flush - so the lines above would be
    # thrown away. ConsoleState removes its temp folder through atexit, so that is done here. The console itself was
    # already stopped: a crash inside the run unwinds through its finally first.
    import shutil
    sys.stdout.flush()
    sys.stderr.flush()
    if globals().get("STATE") is not None:
        shutil.rmtree(STATE.dir, ignore_errors=True)
    os._exit(1)


sys.excepthook = _crash_report

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.environ.get("ASV_APP") or os.path.join(HERE, "..")     # ASV_APP: a copy, for a mutation run
sys.path.insert(0, os.path.join(HERE, "lib"))
from console_state import ConsoleState  # noqa: E402
from server_log import exception_lines  # noqa: E402

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
    print(("  ok   " if ok else "  FAIL ") + name + ("   [" + str(detail)[:300] + "]" if detail else ""))
    if not ok:
        fails += 1


TAB = "tabMR0001-rest-of-the-client-id"


def api(port, path, body=None, timeout=10, client=TAB):
    url = "http://127.0.0.1:%d%s" % (port, path)
    data = json.dumps(body).encode() if body is not None else None
    hdr = {"Content-Type": "application/json"} if data else {}
    if client:
        hdr["X-ASV-Client"] = client
    req = urllib.request.Request(url, data=data, headers=hdr)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except ValueError:
            return e.code, None


def _no_nan(s):
    raise ValueError("a non-finite number in the file: %s" % s)


def read_session(path, strict=False):
    """The session's records. STRICT (check 20) raises on a NaN or Infinity in any line; the other reads take what
    Python's json takes, so a non-finite line is that check's failure, not a crash that hides every other check."""
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                out.append(json.loads(line, parse_constant=_no_nan) if strict else json.loads(line))
    return out


def until(pred, limit, step=0.5):
    t0 = time.time()
    while time.time() - t0 < limit:
        try:
            v = pred()
            if v:
                return v
        except Exception:
            pass
        time.sleep(step)
    try:
        return pred()
    except Exception:
        return None


def port_free(p):
    """Free = nothing answers on it AND it binds. A port with ANY listener is someone else's: never used, never posted."""
    s = socket.socket()
    s.settimeout(0.5)
    try:
        s.connect(("127.0.0.1", p))
        return False                         # something is serving it
    except OSError:
        pass
    finally:
        s.close()
    b = socket.socket()
    try:
        b.bind(("127.0.0.1", p))
        return True
    except OSError:
        return False
    finally:
        b.close()


def at_km(lat, lon, east_km, north_km=0.0):
    return {"lat": lat + north_km / 111.320, "lon": lon + east_km / (111.320 * math.cos(math.radians(lat)))}


print("The mission record - a real console, logging ON, describes the mission it records:")

# --- the stub AIS provider: the console asks it, never the operator's service -------------------------------------
BOAT = {}
SECRET = "SECRET-KEY-XYZ"


class Stub(BaseHTTPRequestHandler):
    def do_GET(self):
        vs = []
        if BOAT:
            near = at_km(BOAT["lat"], BOAT["lon"], east_km=1.0)
            far = at_km(BOAT["lat"], BOAT["lon"], east_km=40.0)       # inside the collect box, outside 5 nm
            now = time.time()
            vs = [dict(near, mmsi=366000001, name="NEARBY", cog=90.0, sog=7.5, heading=None, nav=0, cat="cargo",
                       src="aisstream", length=150, beam=25, obs_t=round(now - 3, 1), age=3, dest="PHILADELPHIA"),
                  dict(far, mmsi=366000002, name="FARAWAY", cog=270.0, sog=9.0, heading=268.0, nav=0, cat="tanker",
                       src="aisstream", obs_t=round(now - 5, 1), age=5)]
        body = json.dumps({"ok": True, "vessels": vs, "count": len(vs),
                           "sources": {"aisstream": {"state": "ok", "stalled": False, "quiet_s": 2.0, "reports": 41,
                                                     "note": "wss://stream.aisstream.io/v0/stream?key=" + SECRET}}})
        b = body.encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(b)))
        self.end_headers()
        self.wfile.write(b)

    def log_message(self, *a):
        pass


stub = HTTPServer(("127.0.0.1", 0), Stub)
stub_port = stub.server_address[1]
threading.Thread(target=stub.serve_forever, daemon=True).start()

PORT = next((p for p in range(8795, 8800) if port_free(p)), None)
check("1. a free port in 8795-8799 (nothing listening on it) - never 8791, never a console this suite did not start",
      PORT is not None, "port %s" % PORT)
if PORT is None:
    raise SystemExit(1)

STATE = ConsoleState(prefix="asv_test_mission_record_")
APP_LOGS = os.path.join(APP, "logs")
app_logs_before = sorted(os.listdir(APP_LOGS)) if os.path.isdir(APP_LOGS) else None
srvlog = tempfile.TemporaryFile(mode="w+")
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none", "--port", str(PORT),
                         "--no-ais-service", "--ais", "http://127.0.0.1:%d" % stub_port, *STATE.args()],
                        cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
spath = None
try:
    st0 = until(lambda: (lambda c_b: c_b[1] if c_b[0] == 200 and (c_b[1].get("status") or {}).get("lat_deg")
                         is not None else None)(api(PORT, "/api/state", timeout=2, client=None)), 45)
    check("2. the console comes up with its recording ON, its state in the temp folder", st0 is not None)
    if st0 is None:
        raise SystemExit(1)
    BOAT.update(lat=st0["status"]["lat_deg"], lon=st0["status"]["lon_deg"])
    logs = sorted(n for n in (os.listdir(STATE.path("logs")) if os.path.isdir(STATE.path("logs")) else [])
                  if n.startswith("asv_") and n.endswith(".jsonl"))
    spath = STATE.path("logs", logs[0]) if logs else None
    check("2b. ... one session file, in the temp folder's logs/", len(logs) == 1, lambda: logs)
    if spath is None:
        raise SystemExit(1)
    recs = read_session(spath)
    ks = [r["kind"] for r in recs]

    # ── THE SESSION DESCRIBES ITSELF ─────────────────────────────────────────────────────────────────────────────────
    def first(kind, rs=None):
        return next((r for r in (rs if rs is not None else recs) if r.get("kind") == kind), None)

    order = [ks.index(k) if k in ks else -1 for k in ("session_start", "manifest", "port", "vessel", "mission")]
    check("3. the session describes itself once, in order: session_start, manifest, port, vessel, the plan on disk",
          lambda: -1 not in order and order == sorted(order) and order[-1] < (ks.index("connect") if "connect" in ks
                                                                              else 10 ** 9)
          and all(ks.count(k) == 1 for k in ("manifest", "port", "vessel")),
          lambda: ks[:8])
    man = first("manifest") or {}
    git_dir = os.path.join(APP, ".git")
    want_head = want_branch = None
    if os.path.exists(git_dir):
        # the suite may ask git (the console never does); `-c safe.directory=*` for THIS read only: a copy of the app
        # (ASV_APP) sits in a folder git calls dubious on an exFAT checkout, and no config is written for it
        try:
            git = ["git", "-c", "safe.directory=*", "-C", APP, "rev-parse"]
            want_head = subprocess.run(git + ["HEAD"], capture_output=True, text=True,
                                       timeout=20).stdout.strip() or None
            want_branch = subprocess.run(git + ["--abbrev-ref", "HEAD"], capture_output=True,
                                         text=True, timeout=20).stdout.strip() or None
        except Exception:
            pass
    check("4. the manifest names the build the frame names, and the checkout - read by file, the SAME commit git says",
          lambda: man["build"]["fingerprint"] == st0["build"] and man["build"]["git"]["head"] == want_head
          and man["build"]["git"]["branch"] == (want_branch if want_branch != "HEAD" else None),
          lambda: json.dumps([man.get("build"), want_head, want_branch]))
    HOME = os.path.expanduser("~")

    def rec_path(pth):                          # the manifest's own rule (asv_console _path_for_record), for the temp dir
        rp = os.path.realpath(os.path.abspath(pth))     # Windows hands %TEMP% over in its 8.3 form
        rel = os.path.relpath(rp, os.path.realpath(HOME))
        return ("~/" + rel.replace(os.sep, "/")) if not rel.startswith("..") else rp
    # the account as a path can name it: the home folder's own name, and %TEMP%'s 8.3 form of it
    ACCOUNT = [n.lower() for n in {os.path.basename(HOME),
                                   os.path.basename((os.environ.get("TEMP") or "").split(os.sep + "AppData")[0])} if n]

    def names_account(v):                       # a path component that IS the account (raw values, not JSON text)
        parts = str(v or "").replace("\\", "/").lower().split("/")
        return any(a in parts for a in ACCOUNT)
    check("4b. ... mode, every flag, where its state lives (home-relative: no account name in a shared recording), the "
          "AIS setup, the zone - and no previous recording here",
          lambda: man["mode"] == "sim" and man["args"]["port"] == PORT and man["args"]["sim"] is True
          and os.path.normcase(man["paths"]["state_dir"]) == os.path.normcase(rec_path(STATE.dir))
          and os.path.normcase(man["paths"]["log"]) == os.path.normcase(rec_path(spath))
          and man["paths"]["mission"].startswith(("~/", "<app>/"))
          and ACCOUNT and not [v for v in man["paths"].values() if names_account(v)]
          and man["ais"]["base"] == "http://127.0.0.1:%d" % stub_port and man["ais"]["service"] is False
          and isinstance(man["tz"]["utc_offset_s"], int) and man["prev"] is None
          and man["session_id"] == os.path.basename(spath)[4:-6],
          lambda: json.dumps({k: man.get(k) for k in ("mode", "paths", "ais", "tz", "prev", "session_id")})[:300])
    ves = first("vessel") or {}
    vfile = os.path.join(APP, "vessels", "%s.json" % st0.get("vessel_id"))
    vsha = hashlib.sha256(open(vfile, "rb").read()).hexdigest() if os.path.isfile(vfile) else None
    check("5. the vessel: the frame's vessel_id, the digest of its file's bytes, the profile, what was derived from it",
          lambda: ves["id"] == st0["vessel_id"] and ves["sha256"] == vsha and ves["profile"]["id"] == ves["id"]
          and {"min_nav_depth_m", "speed_steps_kn", "supervisor_lost", "WIND_A_SIDE", "HULL_CD", "BOAT_BEAM_M",
               "LEEWAY_CAP_MS"} <= set(ves["derived"]) and ves["derived"]["BOAT_BEAM_M"] > 0,
          lambda: json.dumps({"id": ves.get("id"), "sha": ves.get("sha256"), "want": vsha,
                              "derived": sorted(ves.get("derived") or {})}))
    prt = first("port") or {}
    check("6. the base: the frame's port_id, its entry (named fields only), where the sim spawns",
          lambda: prt["port"]["id"] == st0["port_id"] and set(prt["port"]) == {"id", "name", "lat", "lon", "ofs", "note"}
          and isinstance(prt["spawn"]["lat"], float),
          lambda: json.dumps(prt)[:240])
    mis = first("mission") or {}
    check("7. the plan on disk at boot is recorded - or why it could not be read",
          lambda: mis.get("why") == "boot" and (("error" in mis) or (len(mis.get("sha256") or "") == 64
                                                                    and isinstance(mis.get("mission"), dict))),
          lambda: json.dumps(mis)[:200])
    fst = (st0.get("status") or {}).get("forcing") or {}
    check("8. the frame carries the ids (not the profile) and, in the sim, the forcing the boat actually felt",
          lambda: isinstance(st0.get("vessel_id"), str) and "port_id" in st0 and "profile" not in st0
          and {"wind_kn", "wind_from_deg", "gust_mult", "leeway_kn", "stream_kn", "stream_deg", "hs_m", "rho"}
          <= set(fst),
          lambda: json.dumps(fst))

    # ── DRIVE IT: a test contact, a page safety event, a saved plan, an upload + run, a Go-To ────────────────────────
    t_drive = time.time()
    c_test, j_test = api(PORT, "/api/ais/test", {"lat": at_km(BOAT["lat"], BOAT["lon"], 0.3)["lat"],
                                                 "lon": BOAT["lon"], "name": "TEST-MR"})
    c_ev, _ = api(PORT, "/api/logevent", {"kind": "guard_override", "data": {"why": "suite"}})
    t_trigger = time.time()
    wp = [at_km(BOAT["lat"], BOAT["lon"], 0.2), at_km(BOAT["lat"], BOAT["lon"], 0.4)]
    c_save, j_save = api(PORT, "/api/mission", {"waypoints": wp, "speed": "survey"})
    c_arm, _ = api(PORT, "/api/cmd/arm", {"on": True})
    c_up, j_up = api(PORT, "/api/cmd/upload", {"route": wp})
    c_start, _ = api(PORT, "/api/cmd/start", {})
    time.sleep(2.5)
    c_stop, _ = api(PORT, "/api/cmd/stop", {})
    time.sleep(0.6)
    goto_pt = at_km(BOAT["lat"], BOAT["lon"], 0.15, 0.15)
    c_goto, j_goto = api(PORT, "/api/cmd/goto", {"lat": goto_pt["lat"], "lon": goto_pt["lon"]})
    time.sleep(2.0)
    c_stop2, _ = api(PORT, "/api/cmd/stop", {})
    check("9. the drive was accepted: test contact, logevent, save, arm, upload, start, stop, Go-To, stop",
          lambda: [c_test, c_ev, c_save, c_arm, c_up, c_start, c_stop, c_goto, c_stop2] == [200] * 9,
          lambda: [c_test, c_ev, c_save, c_arm, c_up, c_start, c_stop, c_goto, c_stop2, j_up, j_goto])

    # ── TARGETS, WRITTEN BY THE CONSOLE ──────────────────────────────────────────────────────────────────────────────
    def ais_with_test():
        rs = read_session(spath)
        for r in rs:
            if r.get("kind") == "targets" and r.get("sensor") == "ais" and r.get("t", 0) >= t_drive \
                    and "990000001" in (r.get("ids") or []):
                return r
        return None
    tg = until(ais_with_test, 25)
    check("10. with NO page polling the console records the AIS picture round the boat: the test contact and the "
          "provider's contact in range, nearest first - the one 40 km out is not in it",
          lambda: tg and tg["ok"] is True and tg["ids"] == ["990000001", "366000001"]
          and abs(tg["center"]["lat"] - BOAT["lat"]) < 0.01,
          lambda: json.dumps(tg)[:300] if tg else "no ais targets record with the test contact")
    recs = read_session(spath)
    ais_tg = [r for r in recs if r.get("kind") == "targets" and r.get("sensor") == "ais"]
    rows = {x["id"]: x for r in ais_tg for x in r.get("rows") or []}
    infos = {r["id"]: r for r in recs if r.get("kind") == "track_info" and r.get("sensor") == "ais"}
    check("10b. each contact has a row (when the service heard her; a heading not reported is null) and her "
          "particulars once",
          lambda: rows["366000001"]["hdg"] is None and rows["366000001"]["sog"] == 7.5
          and rows["366000001"]["obs_t"] < time.time() and infos["366000001"]["name"] == "NEARBY"
          and infos["366000001"]["len_m"] == 150 and infos["366000001"]["info"]["dest"] == "PHILADELPHIA"
          and infos["990000001"]["cls"] == "test" and "366000002" not in infos,
          lambda: json.dumps([rows.get("366000001"), infos.get("366000001")])[:300])
    check("10c. the provider's health is WHITELISTED - its note (which carries the stream's key) is nowhere in the file",
          lambda: tg["health"] == {"aisstream": {"state": "ok", "stalled": False, "quiet_s": 2.0, "n": 41}}
          and SECRET not in open(spath, encoding="utf-8").read(),
          lambda: json.dumps(tg["health"]) if tg else "")
    roc_tg = [r for r in recs if r.get("kind") == "targets" and r.get("sensor") == "roc"]
    check("10d. the ROC set is a sensor of the same stream (a first keyframe even with nothing held)",
          lambda: roc_tg and roc_tg[0]["keyframe"] is True and roc_tg[0]["ok"] is True, lambda: json.dumps(roc_tg[:1]))
    c_ais, j_ais = api(PORT, "/api/ais?center=%.6f,%.6f" % (BOAT["lat"], BOAT["lon"]), client=None)
    check("11. the page's /api/ais is the same function's answer - and the handler writes NO `ais` record any more",
          lambda: c_ais == 200 and sorted(str(v["mmsi"]) for v in j_ais["vessels"]) == ["366000001", "990000001"]
          and not [r for r in read_session(spath) if r.get("kind") == "ais"],
          lambda: json.dumps(j_ais)[:200])

    # ── A PASSAGE'S RANGE: the page's floor reaches the record ───────────────────────────────────────────────────────
    t_floor = time.time()
    c_fl, j_fl = api(PORT, "/api/ais?center=%.6f,%.6f&floor_km=50" % (BOAT["lat"], BOAT["lon"]), client=None)

    def ais_far():
        for r in read_session(spath):
            if r.get("kind") == "targets" and r.get("sensor") == "ais" and r.get("t", 0) > t_floor \
                    and "366000002" in (r.get("ids") or []):
                return r
        return None
    tg_far = until(ais_far, 25)
    check("11b. a page sailing a passage polls with floor_km, and the RECORD asks with it too: the contact 40 km out (past "
          "the 5 nm setting) is in the recording, and the area says the range in force",
          lambda: c_fl == 200 and "366000002" in [str(v["mmsi"]) for v in j_fl["vessels"]]
          and tg_far and tg_far["area"]["show_km"] == 50 and tg_far["area"]["set_km"] < 10,
          lambda: json.dumps(tg_far["area"] if tg_far else None))

    # ── WHAT THE LINK WAS GIVEN, AND THE RUNS ────────────────────────────────────────────────────────────────────────
    recs = read_session(spath)
    pl = [r for r in recs if r.get("kind") == "plan_loaded"]
    up_pl = next((r for r in pl if r.get("name") == "survey"), None)
    go_pl = next((r for r in pl if r.get("behavior") == "goto"), None)

    def rsha(route):
        return hashlib.sha1(json.dumps([[round(p[0], 6), round(p[1], 6)] for p in route],
                                       separators=(",", ":")).encode()).hexdigest()
    check("12. an upload records what the link was GIVEN: the route (6 dp), its digest, the radii, the speed, staged",
          lambda: up_pl and up_pl["n"] == 2 and up_pl["route"] == [[round(p["lat"], 6), round(p["lon"], 6)] for p in wp]
          and up_pl["route_sha"] == rsha(up_pl["route"]) and up_pl["arrival_radius_m"] > 0 and up_pl["speed_key"]
          and up_pl["staged"] is False and up_pl["source"] == "route",
          lambda: json.dumps(up_pl)[:300])
    check("12b. ... and a Go-To its own: behavior goto, one point, the run it starts",
          lambda: go_pl and go_pl["n"] == 1 and go_pl["completion"] == "loiter"
          and go_pl["route"] == [[round(goto_pt["lat"], 6), round(goto_pt["lon"], 6)]],
          lambda: json.dumps(go_pl)[:300])
    rs_, re_ = [r for r in recs if r.get("kind") == "run_start"], [r for r in recs if r.get("kind") == "run_end"]
    sid = man.get("session_id")
    check("13. each run has a start and an end: the plan's, then the Go-To's (run_id '<session>:<run_seq>')",
          lambda: len(rs_) == 2 and len(re_) == 2 and rs_[0]["behavior"] == "survey" and rs_[1]["behavior"] == "goto"
          and [r["run_id"] for r in rs_] == ["%s:%s" % (sid, r["run_seq"]) for r in rs_]
          and [r["run_id"] for r in re_] == [r["run_id"] for r in rs_] and go_pl["run_seq"] == rs_[1]["run_seq"]
          and all(r["run"] not in ("running", "paused") and r["dur_s"] > 1.0 for r in re_)
          and re_[1]["dist_m"] > 0 and rs_[0]["vessel_id"] == st0["vessel_id"],
          lambda: json.dumps([[r.get("run_id"), r.get("behavior")] for r in rs_]
                             + [[r.get("run_id"), r.get("run"), r.get("dur_s"), r.get("dist_m")] for r in re_]))
    ms_ = [r for r in recs if r.get("kind") == "mission_saved"]
    check("14. a saved plan: its new revision and digest, and what is in it",
          lambda: len(ms_) == 1 and ms_[0]["rev"] == j_save["rev"] and len(ms_[0]["sha256"]) == 64
          and ms_[0]["n_wpts"] == 2 and ms_[0]["n_lines"] == 0,
          lambda: json.dumps(ms_))

    # ── COMMANDS, ATTRIBUTED; LOGEVENT ONCE ──────────────────────────────────────────────────────────────────────────
    cmds = [r for r in recs if r.get("kind") == "command"]
    start_cmd = next((r for r in cmds if r.get("path") == "/api/cmd/start"), None)
    check("15. a command says which tab sent it, when it ARRIVED and how long it took - a Start does real work, so its "
          "time is more than 0 (the first live recording wrote 0.0 for nearly every command) and no more than its own span",
          lambda: start_cmd and start_cmd["client"] == TAB[:8] and abs(start_cmd["rx_t"] - start_cmd["t"]) < 5
          and start_cmd["rx_t"] <= start_cmd["t"] + 0.001 and start_cmd["ms"] > 0
          and start_cmd["ms"] <= (start_cmd["t"] - start_cmd["rx_t"]) * 1000.0 + 5.0,
          lambda: json.dumps(start_cmd))
    cev = [r for r in recs if r.get("kind") == "client:guard_override"]
    check("16. a page event is written ONCE - as client:*, with the tab - and not again as a command",
          lambda: len(cev) == 1 and cev[0]["_tab"] == TAB[:8] and cev[0]["why"] == "suite"
          and not [r for r in cmds if r.get("path") == "/api/logevent"],
          lambda: json.dumps(cev))

    # ── THE ENVIRONMENT, ITS OWN STREAM ──────────────────────────────────────────────────────────────────────────────
    envs = [r for r in recs if r.get("kind") == "env"]
    states = [r for r in recs if r.get("kind") == "state"]
    check("17. the environment is its own stream, FULL first; the logged state leaves the four blocks out",
          lambda: envs and envs[0]["full"] is True and {"env", "water", "current", "density"} <= set(envs[0]["blocks"])
          and states and all(not (set(s["state"]) & {"env", "water", "current", "density"}) for s in states)
          and "status" in states[-1]["state"],
          lambda: "env=%d state=%d first=%s" % (len(envs), len(states), sorted(envs[0]["blocks"]) if envs else None))
    ex0 = (envs[0].get("extra") if envs else None) or {}
    check("17c. ... with the REAL extra beside it: the buoys' rows and where the stations are - not an error swallowed "
          "into every env record",
          lambda: envs and "error" not in ex0 and isinstance(ex0.get("buoys"), list)
          and isinstance((ex0.get("stations") or {}).get("water"), list)
          and isinstance((ex0.get("stations") or {}).get("current"), list),
          lambda: json.dumps(ex0)[:240])
    tel = [r for r in recs if r.get("kind") == "telemetry"]
    check("17b. the 1 Hz trace carries the forcing in the sim",
          lambda: any("forcing" in (r.get("status") or {}) for r in tel), lambda: "telemetry=%d" % len(tel))

    # ── THE INCIDENT WINDOW ──────────────────────────────────────────────────────────────────────────────────────────
    inc = until(lambda: [r for r in read_session(spath) if r.get("kind") == "incident"],
                max(5.0, t_trigger + 30.0 + 8.0 - time.time()))
    check("18. a page safety event writes ONE incident: the 4 Hz frames before and 30 s after, with their cols",
          lambda: inc and len(inc) == 1 and inc[0]["trigger"] == "guard_override" and inc[0]["cols"][0] == "t"
          and len(inc[0]["frames"][0]) == len(inc[0]["cols"])
          and inc[0]["frames"][-1][0] - t_trigger >= 29.0 and inc[0]["frames"][0][0] < t_trigger
          and len(inc[0]["frames"]) >= 80,
          lambda: (json.dumps({"trigger": inc[0]["trigger"], "n": len(inc[0]["frames"]),
                               "span": [inc[0]["frames"][0][0] - t_trigger, inc[0]["frames"][-1][0] - t_trigger]})
                   if inc else "no incident record"))

    # ── THE PICKER'S LABELS ──────────────────────────────────────────────────────────────────────────────────────────
    c_logs, j_logs = api(PORT, "/api/logs", client=None)
    row = next((r for r in (j_logs or {}).get("logs", []) if r.get("name") == os.path.basename(spath)), None)
    check("19. /api/logs labels this recording: its port, mode, vessel and base - and serves no command line (an old "
          "recording's argv is raw)",
          lambda: row and row["port"] == PORT and row["mode"] == "sim" and row["vessel"] == st0["vessel_id"]
          and row["base"] == (prt["port"]["name"] or prt["port"]["id"]) and "argv" not in row,
          lambda: json.dumps(row))

    check("20. every line of the recording parses strictly (no NaN, no Infinity)",
          lambda: len(read_session(spath, strict=True)) > 50, lambda: "%d records" % len(read_session(spath)))

    # ── THE WRITER THROUGH THE READER: this recording, in playback's own parser ────────────────────────────────────────
    recs = read_session(spath)
    start_rec = next(r for r in recs if r.get("kind") == "command" and r.get("path") == "/api/cmd/start")
    stop2_rec = [r for r in recs if r.get("kind") == "command" and r.get("path") == "/api/cmd/stop"][-1]
    go_rec = next(r for r in recs if r.get("kind") == "plan_loaded" and r.get("behavior") == "goto")
    at = [start_rec["t"] + 1.0, go_rec["t"] + 0.5, stop2_rec["t"] + 1.0, (tg["t"] + 0.5) if tg else 0, (tg_far["t"] + 0.5) if tg_far else 0]
    try:
        rp = subprocess.run(["node", os.path.join(HERE, "lib", "replay_recording.js"), spath] + ["%.3f" % x for x in at],
                            capture_output=True, text=True, timeout=120, encoding="utf-8", errors="replace")
        rep_ = json.loads(rp.stdout.strip().splitlines()[-1])
    except Exception as e:                       # noqa: BLE001 - said in the check
        rep_ = {"error": "%s: %s / %s" % (type(e).__name__, e, (rp.stderr if "rp" in dir() else "")[:300])}
    A_ = rep_.get("at") or [{}] * 5
    check("23. playback's OWN parser reads this recording: its two runs (the plan's, the Go-To's), the guard's incident, "
          "the uploaded route while it flew and the Go-To's after, the contacts at the cursor - the 40 km one at the "
          "passage's range - the environment from its own stream, and the hull on the Session card",
          lambda: [r["behavior"] for r in rep_["runs"]] == ["survey", "goto"]
          and [x["trigger"] for x in rep_["incidents"]] == ["guard_override"]
          and A_[0]["plan"]["n"] == 2 and A_[0]["plan"]["route"] == [[round(p["lat"], 6), round(p["lon"], 6)] for p in wp]
          and A_[1]["plan"]["n"] == 1 and A_[2]["plan"]["n"] is None
          and A_[3]["targets"]["ais"]["ids"][:2] == ["990000001", "366000001"]
          and "366000002" in A_[4]["targets"]["ais"]["ids"] and A_[4]["targets"]["ais"]["show_km"] == 50
          and A_[0]["env"]["from"] == "env stream" and A_[0]["env"]["env"] is True
          and st0["vessel_id"] in str(A_[0]["session"]["vessel"]),
          lambda: json.dumps(rep_)[:600])
finally:
    proc.terminate()
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        proc.kill()
    stub.shutdown()

srvlog.seek(0)
out = srvlog.read()
exc = exception_lines(out)
check("21. the console hit no exception while it recorded", lambda: not exc, lambda: exc[:3])
check("22. the app's own logs/ was not written (the recording lived in the temp folder)",
      lambda: (sorted(os.listdir(APP_LOGS)) if os.path.isdir(APP_LOGS) else None) == app_logs_before)

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
