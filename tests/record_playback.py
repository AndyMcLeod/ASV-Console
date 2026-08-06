"""tests/record_playback.py - the recording carries the WHOLE operating picture.

WHY THIS EXISTS. Andy's ask: mission recording and playback should cover everything -
environment, lines, traffic - so a replay can emulate the entire mission, not just the
track. Before this, the recorder wrote commands, salient state and a motion trace; the
wind the operator planned around, the tide under the depths, the traffic on the card and
the LINES DRAWN IN A PREVIOUS SESSION existed nowhere in the file. A playback opened
onto a bare chart in dead calm.

THE MECHANISM, one for every layer: `LOG.aux(kind, snapshot, min_interval)` writes a
record only when the snapshot CHANGED and the per-kind throttle has elapsed. Its two
contracts both matter and both have teeth here:
  * CHANGE-ONLY: an unchanged picture costs nothing however often it is offered - env
    and water ride the ~4 Hz state publish, AIS rides the browser's own 8 s poll, and
    a quiet hour is a handful of lines, not a flood.
  * A CHANGE IS NEVER LOST TO THE THROTTLE: `last` only advances on a WRITE, so a
    change landing inside the window re-offers itself on the next call and lands when
    the window opens. Collapsing a burst into its final value is fine; silently
    dropping the burst is not.

THE FEEDERS: `env` + `water` from Engine._push_state (no thread of their own);
`ais` from the /api/ais proxy - the browser's own poll, so traffic is recorded exactly
while an operator is watching, which is when a mission is being flown; `vessel` +
`mission` at session start (the picture as the session OPENS), on every live switch,
and on every mission save. The suite points --ais at a FAKE service it runs itself:
hermetic, no port collision with a live console, and the contacts are known.

    python tests/record_playback.py     # exit 0 = pass, 1 = fail   (stdlib only)

TEETH - seven mutations RUN, 7/7 caught (recorded results; house rules: missing anchor
= SKIP, crash scored separately, source restored byte-for-byte):
  * aux loses its change-check (every offer writes)     -> caught by 5
  * aux loses its throttle (a burst all lands at once)  -> caught by 6
  * aux advances `last` on a DROP (the burst's end lost)-> caught by 3 and 6b
  * the session-start mission/vessel offer dropped      -> caught by 2
  * save_mission stops offering the mission             -> caught by 7, ON THE RE-RUN.
    The first run "caught" it by check 1: deleting the line left `if LOG is not None:`
    with an empty body - an IndentationError, a console that never booted, a sham
    catch that proved the program broke and nothing about these teeth. Re-run with
    `pass` (a VALID silent skip, the actual defect shape) and check 7 caught it.
    A MUTATION MUST COMPILE: an unrunnable mutant fails every suite at check 1 and
    validates none of them - the runner's own crash rule, applied to its input.
  * the vessel switch stops offering the new identity   -> caught by 8
  * the AIS proxy stops offering the traffic            -> caught by 4
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

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
    return api(port, path, body if body is not None else {})


def recs(path, kind=None):
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                r = json.loads(line)
                if kind is None or r.get("kind") == kind:
                    out.append(r)
    return out


# ---- the fake AIS service: known contacts, no upstream, no port collision --------- #
FAKE_VESSELS = [
    {"mmsi": 366000001, "name": "PICTURE ONE", "lat": 38.795, "lon": -75.162,
     "cog": 90.0, "sog": 5.0},
    {"mmsi": 366000002, "name": "PICTURE TWO", "lat": 38.801, "lon": -75.158,
     "cog": 270.0, "sog": 3.2},
]


class FakeAis(BaseHTTPRequestHandler):
    def do_GET(self):
        body = json.dumps({"vessels": FAKE_VESSELS}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


print("Recording the whole picture — env, water, traffic, vessel and lines:")

port = free_port()
ais_port = free_port()
ais_srv = ThreadingHTTPServer(("127.0.0.1", ais_port), FakeAis)
threading.Thread(target=ais_srv.serve_forever, daemon=True).start()

LOG_DIR = os.path.join(APP, "logs")
before = set(os.listdir(LOG_DIR)) if os.path.isdir(LOG_DIR) else set()
mpath = os.path.join(APP, "mission.json")
mission_bak = None
if os.path.exists(mpath):
    with open(mpath, "r", encoding="utf-8") as f:
        mission_bak = f.read()

srvlog = tempfile.TemporaryFile(mode="w+")
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none",
                         "--port", str(port), "--ais", "http://127.0.0.1:%d" % ais_port],
                        cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
spath = None
try:
    up = False
    for _ in range(80):
        try:
            c, d = api(port, "/api/state", timeout=2)
            st0 = d.get("status") or {}
            if st0.get("speed_key") and st0.get("lat_deg") is not None:
                up = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    check("1. a console comes up (logging ON, --ais pointed at the fake service)", up)
    if not up:
        raise SystemExit(1)
    new = sorted(set(os.listdir(LOG_DIR)) - before)
    spath = os.path.join(LOG_DIR, new[0]) if new else None

    # 2. THE SESSION OPENS WITH THE PICTURE: vessel identity + the mission store as
    # loaded, so lines from a previous session exist in THIS file.
    check("2. the head of the recording carries the VESSEL and the MISSION as loaded",
          lambda: any(r["vessel"].get("id") == "drix08" and r["vessel"].get("loa_m")
                      for r in recs(spath, "vessel"))
          and any("lines" in (r.get("mission") or {}) for r in recs(spath, "mission")),
          lambda: "vessel=%s mission recs=%d" % (
              (recs(spath, "vessel") or [{}])[0].get("vessel"),
              len(recs(spath, "mission"))))

    # 3. THE WEATHER LANDS: a manual env change reaches the recording off the state
    # publish stream (no thread of its own; throttle 5 s, so give it a moment).
    cmd(port, "/api/env", {"enabled": True, "wind_kn": 18.0, "wind_from": 200.0})
    t0 = time.time()
    got = False
    while time.time() - t0 < 12:
        if any((r["env"].get("wind") or {}).get("speed_kn") == 18.0
               for r in recs(spath, "env")):
            got = True
            break
        time.sleep(0.5)
    check("3. an env change is RECORDED - the wind the operator planned around is in "
          "the file",
          got, lambda: "%d env record(s)" % len(recs(spath, "env")))
    cmd(port, "/api/waterlevel", {"manual_offset": 0.6})
    t0 = time.time()
    got = False
    while time.time() - t0 < 12:
        if any(r["water"].get("source") == "manual" and r["water"].get("offset_m") == 0.6
               for r in recs(spath, "water")):
            got = True
            break
        time.sleep(0.5)
    check("3b. ... and so is the water level the depths were corrected by",
          got, lambda: "%d water record(s)" % len(recs(spath, "water")))

    # 4. THE TRAFFIC LANDS off the browser's own poll: calling the proxy as the chart
    # window does must record the shown contacts.
    cmd(port, "/api/cmd/arm", {"on": True})     # a fix to centre the area on
    api(port, "/api/ais?center=%.5f,%.5f" % (st0["lat_deg"], st0["lon_deg"]))
    t0 = time.time()
    got = False
    while time.time() - t0 < 8:
        if any(r["ais"].get("n") == 2 and
               {v.get("name") for v in r["ais"]["vessels"]} == {"PICTURE ONE", "PICTURE TWO"}
               for r in recs(spath, "ais")):
            got = True
            break
        api(port, "/api/ais?center=%.5f,%.5f" % (st0["lat_deg"], st0["lon_deg"]))
        time.sleep(1.0)
    check("4. the traffic on the card is RECORDED, riding the browser's own poll",
          got, lambda: "%d ais record(s)" % len(recs(spath, "ais")))

    # 5. CHANGE-ONLY: a deliberately unchanged picture, offered continuously by the
    # publish stream and by repeated proxy polls, writes NOTHING new.
    n_env, n_ais = len(recs(spath, "env")), len(recs(spath, "ais"))
    t0 = time.time()
    while time.time() - t0 < 12:
        api(port, "/api/ais?center=%.5f,%.5f" % (st0["lat_deg"], st0["lon_deg"]))
        time.sleep(1.0)
    check("5. an UNCHANGED picture costs nothing - no env or ais growth across a "
          "12 s window of continuous offers",
          lambda: len(recs(spath, "env")) == n_env and len(recs(spath, "ais")) == n_ais,
          lambda: "env %d->%d ais %d->%d" % (n_env, len(recs(spath, "env")),
                                             n_ais, len(recs(spath, "ais"))))

    # 6-6b. THE THROTTLE COLLAPSES A BURST BUT NEVER LOSES ITS END. Two different
    # winds a second apart: at most one lands immediately; the FINAL value must land
    # once the window opens (last advances only on a write, so the change re-offers).
    n_env = len(recs(spath, "env"))
    cmd(port, "/api/env", {"wind_kn": 21.0})
    time.sleep(1.0)
    cmd(port, "/api/env", {"wind_kn": 23.0})
    time.sleep(2.0)
    check("6. a burst is collapsed - at most one new env record lands inside the window",
          lambda: len(recs(spath, "env")) - n_env <= 1,
          lambda: "+%d inside the window" % (len(recs(spath, "env")) - n_env))
    t0 = time.time()
    got = False
    while time.time() - t0 < 12:
        if any((r["env"].get("wind") or {}).get("speed_kn") == 23.0
               for r in recs(spath, "env")):
            got = True
            break
        time.sleep(0.5)
    check("6b. ... and the burst's FINAL value is never lost to the throttle",
          got, lambda: "env winds: %s" % [
              (r["env"].get("wind") or {}).get("speed_kn") for r in recs(spath, "env")])

    # 7-8. THE PLAN AND THE BOAT FOLLOW THEIR EDITS.
    cmd(port, "/api/mission", {"lines": [
        {"a": {"lat": 38.80, "lon": -75.17}, "b": {"lat": 38.80, "lon": -75.15}},
        {"a": {"lat": 38.801, "lon": -75.17}, "b": {"lat": 38.801, "lon": -75.15}}],
        "speed": "survey", "buffer_m": 3.0})
    time.sleep(1.5)
    check("7. a mission save records the WHOLE plan - the new lines are in the file",
          lambda: any(len((r.get("mission") or {}).get("lines") or []) == 2
                      for r in recs(spath, "mission")),
          lambda: "mission recs=%d" % len(recs(spath, "mission")))
    cmd(port, "/api/cmd/arm", {"on": False})
    cmd(port, "/api/vessel", {"id": "zboat_1800hs"})
    time.sleep(1.5)
    check("8. a live vessel switch records the NEW identity",
          lambda: any(r["vessel"].get("id") == "zboat_1800hs" for r in recs(spath, "vessel")),
          lambda: "vessel ids: %s" % [r["vessel"].get("id") for r in recs(spath, "vessel")])
    cmd(port, "/api/vessel", {"id": "drix08"})

finally:
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()
    ais_srv.shutdown()
    if mission_bak is not None:
        with open(mpath, "w", encoding="utf-8") as f:
            f.write(mission_bak)
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
check("9. the console logged NO exception while serving those requests",
      not tb,
      ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb
      else "an answered request can still kill its handler")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
