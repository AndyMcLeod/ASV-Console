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
  4c-4e THE ASKER'S OWN LIMIT (max_tiles, 2026-11-15: the page's coarse field home asked with none, was handed the job
       and STOPPED it past its 60 tiles - and the job was the far RTH's own read of the way home, the same tiles the
       other way): a limit that is not a whole number of tiles is refused in words, never taken as none (4c); her
       position to home and home to her position are ONE job, and still that job with a limit it is exactly at; past
       its limit the ask is refused with the count, and the read running for the other asker is not joined, not
       stopped, no job made (4d); alone, such an ask starts nothing, and past the console's own limit too it is told
       its count (4e). The page's two readers are driven against this code in tests/passage_plan.js 16s;
  4f-4g A CANCEL TAKES BACK ONE ASK (the adversarial review of the limit: a window left on an OLDER page still sends its
       ask and its cancel every minute, and an older page takes "canceled" as final): a read with two asks on it is
       not stopped by one cancel - the answer says one is left - and is stopped when both are taken back (4f); an
       ask on a read BEING stopped is a new read under the same name (4g). tests/passage_plan.js 16u is the page's side;
  5    over HTTP, a console of its own: the corridor routes ahead of /api/enc, a request in words is a 400, an unknown
       job a 404, a corridor over a seeded tile reads it from the cache and says so, and the read is not logged as a
       command; an ask within its limit is the same read, a limit that is not a number a 400, and one past its limit
       a 400 that carries the count through the handler itself.

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
and seventeen for the asker's limit and the count of asks (2026-11-15; scratchpad mut_cc.py, asv_console.py on a
sidecar app through ASV_APP, the real file's sha1 unchanged; killed = the suite red AND the named check red):
  the asker's limit ignored                          -> 4d, 4e (and 5)
  judged only after a running read is rejoined       -> 4d (and 4e)
  the refusal stops the other asker's read           -> 4d
  the limit made part of the job's name              -> 4d, 5
  the limit itself refused (>=)                      -> 4d, 5
  a limit that is not one taken as no limit          -> 4c, 5 (and 4d)
  true taken as a limit of 1                         -> 4c
  the refusal without its count                      -> 4d, 4e (and 5)
  the refusal without its `over` flag                -> 4d, 4e (and 5)
  the route's direction made part of the job's name  -> 4d (and 4e, 4f)
  the console's own limit judged before the asker's  -> 4e
  a cancel ignored (again)                           -> 4b (and 4f, 4g)
  a cancel stops the read whatever asks are on it    -> 4f
  an ask rejoins a read being stopped                -> 4g
  an ask that joins is not counted                   -> 4f (and 4d)
  a cancel takes back every ask                      -> 4f
  the handler answers beside corridor_post (the
  refusal's count lost on the wire)                  -> 5 (the independent review's surviving mutant, before 5 had it)
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

    # ── 4c-4e. THE ASKER'S OWN LIMIT (max_tiles, 2026-11-15) ─────────────────────────────────────────────────────
    # The page's coarse field home asked for the way home's chart with no limit, was handed the job, and past its 60
    # tiles STOPPED it ({cancel}) - and that job was the far RTH's own read of the way home, the same line the other
    # way: a read is named by its tiles. Its "canceled" was a final refusal of the way home. The limit goes in the ask
    # now: past it the answer is the count, and nothing is started, joined or stopped. (The page's two readers are
    # driven against this code in tests/passage_plan.js 16s, through tests/lib/corridor_console.py.)
    # Here, the tile reads stubbed (the grid's too: the page asks with grids) and held at the gate.
    def fake_grid(t):
        reads.append(tuple(t))
        gate.wait(5)
        return ({"tile": list(t), "bands": ["enc_general"], "unread": [], "unread_failed": [], "complete": True}, b"")

    sav_grid = A.fetch_enc_grid
    A.fetch_enc_grid = fake_grid
    try:
        HOME, HER = {"lat": 43.07, "lon": -70.71}, {"lat": 43.07, "lon": -65.79}        # ~400 km east of home
        A._corridor_jobs.clear()
        reads.clear()
        gate.clear()
        # 4c. a limit that is not one is a request refused in words - never "no limit", never "over"
        caps = {repr(cap): A.corridor_post({"route": [HOME], "half_km": 5, "max_tiles": cap})
                for cap in ("60", 0, -3, 2.5, True, [60])}
        check("4c. A LIMIT THAT IS NOT ONE (max_tiles: text, 0, negative, a fraction, true, a list) is a request refused "
              "in words - a 400 naming max_tiles, without 'over' - and nothing is started",
              lambda: all(code == 400 and "max_tiles must be a whole number" in out.get("error", "") and "over" not in out
                          for code, out in caps.values()) and not A._corridor_jobs and not reads,
              lambda: "; ".join("%s: %s %s" % (k, v[0], str(v[1])[:50]) for k, v in caps.items())
                      + " | jobs %d, reads %d" % (len(A._corridor_jobs), len(reads)))
        # 4d. the two readers of the way home: her position to home (the far RTH's), home to her position (the coarse
        # field's), 25 km either side, with grids - ONE job. The other way with a limit it is within: still that job
        # (the limit is the asker's, no part of the job's name). The read is running, held at the gate.
        way = {"route": [HER, HOME], "half_km": 25, "grids": True}
        back = {"route": [HOME, HER], "half_km": 25, "grids": True}
        c1, far = A.corridor_post(way)
        n = far.get("total", 0)
        c2, joined = A.corridor_post(dict(back, max_tiles=n))                # exactly at the limit: within it
        jobs_then = len(A._corridor_jobs)
        # ... and past its limit: refused with the count - and the running read is NOT joined, NOT stopped, no job made
        c3, over = A.corridor_post(dict(back, max_tiles=n - 1))
        job = A._corridor_jobs.get(far.get("id")) or {}
        untouched = (job.get("state"), job.get("cancel"), len(A._corridor_jobs), job.get("asks"))   # (2 asks: hers, and the one at its limit)
        gate.set()
        for _ in range(200):
            fin = A.corridor_status(far.get("id")) or {}
            if fin.get("state") != "running":
                break
            time.sleep(0.05)
        check("4d. ONE READ, WHICHEVER WAY THE ROUTE RUNS: her position to home and home to her position, 25 km either "
              "side with grids, are the SAME job (%d tiles at ~400 km) - and so is the second with a limit it is exactly "
              "at. PAST ITS LIMIT (max_tiles one fewer) it is refused, a 400 that says the count ({error, over, total, "
              "max_tiles}) - and the read running for the other asker is not joined, not stopped, no job made: it "
              "finishes, done, every tile read once" % n,
              lambda: c1 == 200 and far["state"] == "running" and n > 60 and c2 == 200 and joined["id"] == far["id"]
                      and jobs_then == 1
                      and c3 == 400 and over.get("over") is True and over.get("total") == n and over.get("max_tiles") == n - 1
                      and "%d chart tiles" % n in over.get("error", "") and "id" not in over and "state" not in over
                      and untouched == ("running", False, 1, 2)
                      and fin.get("state") == "done" and fin.get("done") == n and len(reads) == n and len(set(reads)) == n,
              lambda: "tiles %d; rejoined %s; over %s %s; the running job then %s; ended %s, read %d (%d distinct)"
                      % (n, joined.get("id") == far.get("id"), c3, json.dumps(over)[:150], untouched, fin.get("state"),
                         len(reads), len(set(reads))))
        # 4e. ... and with nobody else asking: an ask past its limit starts NOTHING - no job, no tile read - where the
        # same ask without the limit starts the read (the pair)
        A._corridor_jobs.clear()
        reads.clear()
        gate.clear()
        c4, alone = A.corridor_post(dict(back, max_tiles=60))
        time.sleep(0.1)                      # (a job made in error has its first tiles in flight by now)
        nothing = (len(A._corridor_jobs), len(reads))
        # (and past the console's OWN limit too, the asker with a limit is told its count - the page says the way home
        # by it - not "read it in parts")
        c6, world = A.corridor_post({"route": [{"lat": 10, "lon": -170}, {"lat": 10, "lon": 170}], "half_km": 25,
                                     "grids": True, "max_tiles": 60})
        c5, started = A.corridor_post(back)
        gate.set()
        for _ in range(200):
            if (A.corridor_status(started.get("id")) or {}).get("state") != "running":
                break
            time.sleep(0.05)
        check("4e. ... AND ALONE: the ask past its limit (max_tiles 60, %d tiles) starts NOTHING - no job, no tile read; "
              "one past the console's own %d too is told its count the same; the same ask without the limit starts the "
              "read" % (n, A.ENC_CORRIDOR_MAX_TILES),
              lambda: c4 == 400 and alone.get("over") is True and alone.get("total") == n and nothing == (0, 0)
                      and c6 == 400 and world.get("over") is True and world.get("total", 0) > A.ENC_CORRIDOR_MAX_TILES
                      and c5 == 200 and started.get("total") == n and len(A._corridor_jobs) == 1 and len(reads) == n,
              lambda: "limited: %s %s, jobs and reads then %s; across the world: %s %s; unlimited: %s, read %d"
                      % (c4, json.dumps(alone)[:110], nothing, c6, json.dumps(world)[:120], c5, len(reads)))

        # ── 4f-4g. A CANCEL TAKES BACK ONE ASK (2026-11-15, the adversarial review of the limit) ─────────────────
        # The page sends no cancel now - but a window left on an OLDER page still sends its ask and its cancel every
        # minute, and an older page still takes "canceled" as a final refusal of the way home. So the console keeps
        # the count: each ask that joins a read is counted on it, a cancel takes one back, and the read is stopped
        # only when none is left. And an ask never joins a read BEING stopped (it stays "running" until its tiles in
        # flight land): it is a new read.
        def in_flight(k=1):                  # tiles held at the gate: the read really is under way
            for _ in range(200):
                if len(reads) >= k:
                    return True
                time.sleep(0.02)
            return False

        def ended(jid_or_job):
            for _ in range(200):
                st_ = jid_or_job if isinstance(jid_or_job, dict) else (A.corridor_status(jid_or_job) or {})
                if st_.get("state") != "running":
                    return st_.get("state")
                time.sleep(0.05)
            return "STILL RUNNING"

        # 4f. two asks on one read, one cancel: it goes on - and is told so; the second cancel stops it
        A._corridor_jobs.clear()
        reads.clear()
        gate.clear()
        _, hers = A.corridor_post(way)                               # the way home's ask
        flying = in_flight()
        _, theirs = A.corridor_post(back)                            # the other asker joins it: two asks
        c7, one_back = A.corridor_post({"cancel": hers["id"]})       # ... and takes its ask back
        job1 = A._corridor_jobs[hers["id"]]
        after_one = (one_back.get("state"), one_back.get("asks"), job1["cancel"])
        gate.set()
        end1 = (ended(hers["id"]), len(reads))
        A._corridor_jobs.clear()
        reads.clear()
        gate.clear()
        _, a1 = A.corridor_post(way)
        in_flight()
        _, a2 = A.corridor_post(back)
        A.corridor_post({"cancel": a1["id"]})
        c8, none_left = A.corridor_post({"cancel": a1["id"]})
        dying = A._corridor_jobs[a1["id"]]
        after_two = (none_left.get("asks"), dying["cancel"], dying["state"])
        # 4g. ... and an ask while that read is BEING stopped (running still: its tiles in flight are held) is a NEW
        # read under the same name - not told "canceled" for a cancel made before it asked
        c9, fresh = A.corridor_post(way)
        newjob = A._corridor_jobs[fresh["id"]]
        is_new = (newjob is not dying, fresh["id"] == a1["id"], fresh.get("state"), fresh.get("asks"), newjob["cancel"])
        gate.set()
        end2 = (ended(fresh["id"]), (A.corridor_status(fresh["id"]) or {}).get("done"), ended(dying))
        check("4f. A CANCEL TAKES BACK ONE ASK: the way home's read with a second ask on it (theirs == hers: one job, "
              "asks 2) is NOT stopped by one cancel - the answer says 1 ask still on it - and finishes done, every tile "
              "read; with BOTH asks taken back it is stopped (asks 0)",
              lambda: flying and theirs["id"] == hers["id"] and theirs.get("asks") == 2 and c7 == 200
                      and after_one == ("running", 1, False) and end1 == ("done", n)
                      and a2.get("asks") == 2 and c8 == 200 and after_two == (0, True, "running"),
              lambda: "joined %s asks %s; after one cancel %s, ended %s; after two %s"
                      % (theirs.get("id") == hers.get("id"), theirs.get("asks"), after_one, end1, after_two))
        check("4g. AN ASK ON A READ BEING STOPPED IS A NEW READ: the same name, its own record, running with 1 ask and "
              "not being stopped - it finishes done, every tile, while the stopped one ends canceled",
              lambda: c9 == 200 and is_new == (True, True, "running", 1, False) and end2 == ("done", n, "canceled"),
              lambda: "new %s; ended %s" % (is_new, end2))
    finally:
        A.fetch_enc_grid = sav_grid
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
# (and its neighbor to the east, so the two-tile ask below - refused past its limit - could not reach past the cache
# even if a console in error read it)
TILE2 = [-149.75, 20.0, -149.5, 20.25]
SEED2 = A._tile_path(TILE2)
A.ENC_DIR = _sav_dir
for _seed, _tile in ((SEED, TILE), (SEED2, TILE2)):
    A._write_tile_jsonl(_seed, {"tile": _tile, "features": [], "bands": ["enc_general"], "unread": [],
                                "unread_failed": [], "partial": [], "complete": True,
                                # a tile of the console's own reader of the cells (its default), or it is read again
                                "sources": {"enc_general": "cells"}, "cells_reader": A.enc_cells.reader_tag()})
STATE = ConsoleState()
port = free_port()
log = tempfile.TemporaryFile(mode="w+")
# ⚠ THE RECORDING CONSOLE ASKS AN AIS BASE EVERY 10 s (its TargetRecorder, since 2026-11-05): left at the default it
# polled the OPERATOR'S bundled service on 127.0.0.1:8788 whenever his console was up, and filled this suite's
# recording with his live contacts. A closed port: the AIS sensor records "unreachable", the same every run.
NO_AIS = ["--ais", "http://127.0.0.1:1"]
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none", "--port", str(port),
                         "--no-ais-service", *NO_AIS, *STATE.args()], cwd=APP, stdout=log, stderr=subprocess.STDOUT)
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
    # (the asker's limit over the wire, on the seeded tile alone - nothing here can reach past the cache: within it, the
    # same read; not a number, a 400 in words)
    one = {"route": [{"lat": 20.10, "lon": -149.90}], "half_km": 1}
    lim = http(port, "/api/enc/corridor", dict(one, max_tiles=1)) if up else (0, {})
    badlim = http(port, "/api/enc/corridor", dict(one, max_tiles="1")) if up else (0, {})
    # (... and PAST its limit, through the handler itself - the review's surviving mutant: the handler's own body
    # restored beside corridor_post lost the count, and no suite saw it. A point on the two seeded tiles' shared edge
    # reaches both: 2 tiles, limit 1)
    two = {"route": [{"lat": 20.10, "lon": -149.75}], "half_km": 1}
    overlim = http(port, "/api/enc/corridor", dict(two, max_tiles=1)) if up else (0, {})
    src = open(os.path.join(APP, "asv_console.py"), encoding="utf-8").read()
    route_order = src.index('elif self.path.startswith("/api/enc/corridor"):') < src.index('elif self.path.startswith("/api/enc"):\n            self._serve_enc()')
    check("5. OVER HTTP (a console of its own): the corridor routes AHEAD of /api/enc; a request in words is a 400, an "
          "unknown job a 404; a corridor over a seeded mid-ocean tile reads it from the cache - one tile, general - and "
          "the read is quiet in the session log (not a command); asked again with a limit it is within (max_tiles 1) it "
          "is the same read, a limit that is not a number is a 400 in words, and a two-tile corridor past its limit of 1 "
          "is a 400 that carries the count through the handler ({error, over, total: 2, max_tiles: 1})",
          lambda: up and route_order and b400[0] == 400 and "route" in b400[1].get("error", "") and g404[0] == 404
                  and ok[0] == 200 and st.get("state") == "done" and st.get("total") == 1 and st.get("bands") == {"general": 1}
                  and "/api/enc/corridor" in A.LOG_QUIET_POSTS
                  and lim[0] == 200 and lim[1].get("id") == ok[1].get("id") and lim[1].get("total") == 1
                  and badlim[0] == 400 and "max_tiles" in badlim[1].get("error", "")
                  and overlim[0] == 400 and overlim[1].get("over") is True and overlim[1].get("total") == 2
                  and overlim[1].get("max_tiles") == 1 and "id" not in overlim[1],
          lambda: "up %s order %s; 400 %s; 404 %s; read %s %s; limit %s %s; bad limit %s; over %s"
                  % (up, route_order, b400, g404[0], ok[0], json.dumps(st)[:160], lim[0], lim[1].get("id") == ok[1].get("id"), badlim, overlim))
finally:
    proc.terminate()
    try:
        proc.wait(10)
    except Exception:
        proc.kill()
    for _seed in (SEED, SEED2):
        try:
            os.remove(_seed)
        except OSError:
            pass
    STATE.cleanup() if hasattr(STATE, "cleanup") else None

print("\n" + ("%d CHECK(S) FAILED (%d ran)" % (fails, ran) if fails else "all checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
