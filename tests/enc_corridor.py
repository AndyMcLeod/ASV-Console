"""tests/enc_corridor.py - the chart along a route: a corridor of tiles, read in the background.

Andy, 2026-10-11 (step 3 of the long-transit plan): read a corridor, not a box - for a passage, only the tiles within a
few km of the route, a few dozen for 500 nm (a box read stops at 1.5 degrees). asv_console.py corridor_start reads the
layered read's own tiles (fetch_enc_tile) along the route in a background job and reports as it goes. The page's side -
Read chart on the transit line, and the read-ahead while she runs - is tests/corridor_read.js.

WHAT IS PINNED:
  1    the tiles a route reaches: along it, a row away only when the half-width reaches across, one point's tiles;
  2    the distance from a leg to a tile, against a brute-force sample (it decides which tiles are read);
  3    a request in words: no route, a point that is not one, off the earth, a width out of range, too many tiles;
  4    the job, the tile read stubbed: every tile read once, counted as it lands, each tile filed under its finest
       scale, the unread squares near the route kept and those far from it left out, a tile that failed (coverage or
       a layer) listed with its reason; the same tiles asked again while running rejoin the job;
  4b   a canceled job stops reading;
  5    over HTTP, a console of its own: the corridor routes ahead of /api/enc, a request in words is a 400, an unknown
       job a 404, a corridor over a seeded tile reads it from the cache and says so, and the read is not logged as a
       command.

  python tests/enc_corridor.py   # exit 0 = pass

TEETH - thirteen mutations RUN on scratch copies (scratchpad mutate_corridor.py), all caught:
  the half-width ignored (every tile in the box)     -> 1
  a leg always touches a tile                        -> 1, 2
  longitude not shrunk by latitude                   -> 1, 2
  any width accepted                                 -> 3
  no cap on the tiles                                -> 3, 4, 4b
  a running job never rejoined                       -> 4
  rejoined from inside its lock (the deadlock)       -> 4 HANGS - the hook's time limit fails it. Check 4 FOUND
                                                        this in the first build: corridor_status took the lock
                                                        corridor_start was holding, and the request never returned
  a tile filed under its coarsest scale              -> 4
  every unread square kept, near or far              -> 4
  a tile with a failed layer not listed              -> 4
  a cancel ignored                                   -> 4b
  the corridor routed behind /api/enc                -> 0 (the route-order check's anchor is gone)
  the read logged as a command                       -> 5
"""
import json
import math
import os
import random
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request


def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-800:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

APP = os.environ.get("ASV_APP") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)
import asv_console as A                                       # noqa: E402

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


print("The chart along a route:")
T = A.ENC_TILE_DEG

# ── 1. the tiles a route reaches ──────────────────────────────────────────────────────────────────────────────────
line = [[-70.90, 43.10], [-70.30, 43.10]]            # 43.10: 11.1 km above the 43.0 tile line, 16.7 km below 43.25
narrow = A._corridor_tiles(line, 2000)
wide = A._corridor_tiles(line, 12000)
pt = A._corridor_tiles([[-70.70, 43.07]], 5000)
key = lambda ts: sorted((round(t[0] / T), round(t[1] / T)) for t in ts)
check("1. THE TILES A ROUTE REACHES: an east-west line at 43.10 reads the three tiles of its own row at 2 km either side; "
      "at 12 km the row below too (the 43.0 line lies 11.1 km off) and a column past each end (8.1 km west, 4.1 km "
      "east) - but not the south-west corner tile, 13.7 km off; one point reads the tiles within 5 km of it",
      lambda: key(narrow) == [(-284, 172), (-283, 172), (-282, 172)]
              and key(wide) == [(-285, 172), (-284, 171), (-284, 172), (-283, 171), (-283, 172), (-282, 171), (-282, 172),
                                (-281, 171), (-281, 172)]
              and key(pt) == [(-284, 172), (-283, 172)],
      lambda: "narrow %s, wide %s, point %s" % (key(narrow), key(wide), key(pt)))

# ── 2. the distance from a leg to a tile ──────────────────────────────────────────────────────────────────────────
random.seed(11)
worst = 0.0
for _ in range(300):
    a = [random.uniform(-71, -70), random.uniform(42.5, 43.5)]
    b = [a[0] + random.uniform(-0.3, 0.3), a[1] + random.uniform(-0.3, 0.3)]
    W, S = random.uniform(-71, -70), random.uniform(42.5, 43.5)
    r = [W, S, W + 0.25, S + 0.25]
    got = A._seg_rect_dist_m(a, b, r)
    k = 111320.0 * math.cos(math.radians((a[1] + b[1]) / 2.0))
    best = float("inf")
    for i in range(201):                                # the leg sampled every 0.5% against the rectangle, clamped
        x, y = a[0] + (b[0] - a[0]) * i / 200, a[1] + (b[1] - a[1]) * i / 200
        cx, cy = min(max(x, r[0]), r[2]), min(max(y, r[1]), r[3])
        best = min(best, math.hypot((x - cx) * k, (y - cy) * 111320.0))
    worst = max(worst, abs(got - best) if best > 0 else got)
check("2. THE DISTANCE FROM A LEG TO A TILE matches a brute-force sample of the leg (300 random legs and tiles; the "
      "sample's own step allows 0.5% of a leg) - it decides which tiles are read",
      lambda: worst < 0.003 * 111320.0 * 0.45, lambda: "worst difference %.1f m" % worst)

# ── 3. a request in words ─────────────────────────────────────────────────────────────────────────────────────────
def refused(body):
    try:
        A._corridor_parse(body)
        return None
    except ValueError as e:
        return str(e)


bad = {
    "no route": refused({}),
    "an empty one": refused({"route": []}),
    "a point that is not one": refused({"route": [{"lat": "x", "lon": 1}]}),
    "off the earth": refused({"route": [{"lat": 95, "lon": 1}]}),
    "width 0": refused({"route": [{"lat": 43, "lon": -70}], "half_km": 0}),
    "width too wide": refused({"route": [{"lat": 43, "lon": -70}], "half_km": 99}),
}
try:
    A.corridor_start({"route": [{"lat": 10, "lon": -170}, {"lat": 10, "lon": 170}], "half_km": 25})   # across the world
    too_many = None
except ValueError as e:
    too_many = str(e)
check("3. A REQUEST IN WORDS: no route, an empty one, a point that is not a number, one off the earth, a width of 0 "
      "or past %g km, and a corridor of more than %d tiles are each refused with a reason"
      % (A.ENC_CORRIDOR_MAX_HALF_KM, A.ENC_CORRIDOR_MAX_TILES),
      lambda: all(bad.values()) and too_many and "at most %d" % A.ENC_CORRIDOR_MAX_TILES in too_many and "read it in parts" in too_many,
      lambda: "; ".join("%s: %s" % (k, (v or "ACCEPTED")[:50]) for k, v in bad.items()) + " | " + str(too_many)[:80])

# ── 4. the job ────────────────────────────────────────────────────────────────────────────────────────────────────
reads = []
gate = threading.Event()


def fake_tile(t):
    reads.append(tuple(t))
    gate.wait(5)
    i = round(t[0] / T)
    if i == -284:                                      # the west tile: harbour, with an unread square on the line and one far off
        return {"bands": ["enc_harbour", "enc_coastal"], "complete": True,
                "unread": [[-70.92, 43.09, -70.91, 43.11], [-70.95, 43.24, -70.94, 43.25]], "unread_failed": []}
    if i == -283:                                      # the middle tile: its coverage could not be read
        return {"bands": [], "unread_failed": [t], "note": "the chart's coverage could not be read here (offline)"}
    return {"bands": ["enc_coastal", "enc_general"], "partial": ["Sounding_point"]}      # read, but a layer failed


sav = A.fetch_enc_tile
A.fetch_enc_tile = fake_tile
try:
    A._corridor_jobs.clear()
    body = {"route": [{"lat": 43.10, "lon": -70.90}, {"lat": 43.10, "lon": -70.30}], "half_km": 2}
    st0 = A.corridor_start(body)
    again = A.corridor_start(body)                      # while it runs: the same job
    gate.set()
    for _ in range(100):
        st = A.corridor_status(st0["id"])
        if st["state"] != "running":
            break
        time.sleep(0.05)
    fails_by = {round(f["tile"][0] / T): f["note"] for f in st["failed"]}
    check("4. THE JOB: three tiles read once each, counted as they land; each tile under its finest scale (harbour 1, "
          "coastal 1, none 1); the unread square ON the line kept and the one 15 km off it left out (and the failed "
          "tile's own square counted); a tile whose coverage could not be read, and one with a failed layer, listed "
          "with the reason; asked again while running, the SAME job",
          lambda: st["state"] == "done" and st["total"] == 3 and st["done"] == 3 and sorted(reads) == sorted(set(reads)) and len(reads) == 3
                  and again["id"] == st0["id"] and st["bands"] == {"harbour": 1, "coastal": 1, "none": 1}
                  and [-70.92, 43.09, -70.91, 43.11] in st["unread"] and [-70.95, 43.24, -70.94, 43.25] not in st["unread"]
                  and st["unread_n"] == 2 and "coverage could not be read" in fails_by.get(-283, "")
                  and "Sounding_point" in fails_by.get(-282, ""),
          lambda: json.dumps({k: st[k] for k in ("state", "total", "done", "bands", "unread", "unread_n")}) + " reads %d failed %s" % (len(reads), fails_by))
    # cancel: a slow job stopped part-way
    reads.clear()
    gate.clear()
    long = {"route": [{"lat": 43.10, "lon": -72.90}, {"lat": 43.10, "lon": -69.30}], "half_km": 2}
    s1 = A.corridor_start(long)
    c = A.corridor_cancel(s1["id"])
    gate.set()
    for _ in range(100):
        s2 = A.corridor_status(s1["id"])
        if s2["state"] != "running":
            break
        time.sleep(0.05)
    check("4b. A CANCELLED JOB STOPS: of %d tiles only those already under way are read, and it says canceled" % s1["total"],
          lambda: c and s2["state"] == "canceled" and len(reads) <= A.ENC_TILE_WORKERS < s1["total"],
          lambda: "state %s, read %d of %d" % (s2["state"], len(reads), s1["total"]))
finally:
    A.fetch_enc_tile = sav
    gate.set()

# ── 5. over HTTP ──────────────────────────────────────────────────────────────────────────────────────────────────
import socket                                                  # noqa: E402
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from console_state import ConsoleState                         # noqa: E402


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def http(port, path, body=None):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), method="POST" if body is not None else "GET",
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Content-Type": "application/json"} if body is not None else {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


# a mid-ocean tile seeded in the app's chart cache - so the read can only have come from it - removed after
ENC_DIR = os.path.join(APP, "charts", "enc")
os.makedirs(ENC_DIR, exist_ok=True)
TILE = [-150.0, 20.0, -149.75, 20.25]
_sav_dir = A.ENC_DIR
A.ENC_DIR = ENC_DIR                       # the console's own tile file name and format, read from the module
SEED = A._tile_path(TILE)
A.ENC_DIR = _sav_dir
A._write_tile_jsonl(SEED, {"tile": TILE, "features": [], "bands": ["enc_general"], "unread": [], "unread_failed": [],
                          "partial": [], "complete": True})
STATE = ConsoleState()
port = free_port()
log = tempfile.TemporaryFile(mode="w+")
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none", "--port", str(port),
                         "--no-ais-service", *STATE.args()], cwd=APP, stdout=log, stderr=subprocess.STDOUT)
try:
    up = False
    for _ in range(80):
        try:
            if http(port, "/api/state")[0] == 200:
                up = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    b400 = http(port, "/api/enc/corridor", {}) if up else (0, {})
    g404 = http(port, "/api/enc/corridor?id=nosuchjob") if up else (0, {})
    ok = http(port, "/api/enc/corridor", {"route": [{"lat": 20.10, "lon": -149.90}], "half_km": 1}) if up else (0, {})
    st = ok[1]
    for _ in range(40):
        if st.get("state") != "running":
            break
        time.sleep(0.25)
        st = http(port, "/api/enc/corridor?id=" + str(ok[1].get("id")))[1]
    src = open(os.path.join(APP, "asv_console.py"), encoding="utf-8").read()
    route_order = src.index('elif self.path.startswith("/api/enc/corridor"):') < src.index('elif self.path.startswith("/api/enc"):\n            self._serve_enc()')
    check("5. OVER HTTP (a console of its own): the corridor routes AHEAD of /api/enc; a request in words is a 400, an "
          "unknown job a 404; a corridor over a seeded mid-ocean tile reads it from the cache - one tile, general - and "
          "the read is quiet in the session log (not a command)",
          lambda: up and route_order and b400[0] == 400 and "route" in b400[1].get("error", "") and g404[0] == 404
                  and ok[0] == 200 and st.get("state") == "done" and st.get("total") == 1 and st.get("bands") == {"general": 1}
                  and "/api/enc/corridor" in A.LOG_QUIET_POSTS,
          lambda: "up %s order %s; 400 %s; 404 %s; read %s %s" % (up, route_order, b400, g404[0], ok[0], json.dumps(st)[:160]))
finally:
    proc.terminate()
    try:
        proc.wait(10)
    except Exception:
        proc.kill()
    try:
        os.remove(SEED)
    except OSError:
        pass
    STATE.cleanup() if hasattr(STATE, "cleanup") else None

print("\n" + ("%d CHECK(S) FAILED (%d ran)" % (fails, ran) if fails else "all checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
