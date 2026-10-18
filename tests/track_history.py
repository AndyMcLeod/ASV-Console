"""tests/track_history.py - the console keeps her track this boot, for a chart page that missed some of it (2026-10-17).

Andy: "When the chart window is offscreen, the path history does not load when it comes back. This is misleading to the
viewer. The playback does show the path generating." A page the browser has frozen handles no frames, and the console
drops what a sleeping subscriber does not read, so the page's trail had a hole and a chord across it. The console now
keeps every TRACK_HISTORY_STEP_M of her (TrackHistory), stamps each frame with its clock (server_t), and serves the
stretch a page asks for (GET /api/track). The page's half - asking, and laying the answer in by time - is
tests/trail_backfill.js.

THE CONTRACTS:
  1. a point is kept once she is TRACK_HISTORY_STEP_M from the last one kept - never closer, never a step skipped;
  2. a stretch is the points strictly between its two times, oldest first; another boot's ask gets none, and the boot
     held; a new boot starts the track again; the longest track kept is the newest `cap` points;
  3. the query: boot and since required, until defaulting to now; a time that is not a number, or until before since,
     refused in words;
  4. LIVE, a console on a free port: every frame carries server_t (its clock); /api/track by the frame's boot answers her
     fix with that boot; another boot answers nothing; a bad query is a 400 in words; and a respawn - a new boot - starts
     a new track: the old boot's ask answers nothing, the new one's the new place.

    python tests/track_history.py     # exit 0 = pass, 1 = fail   (stdlib only)
"""

import json
import math
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.environ.get("ASV_APP") or os.path.join(HERE, "..")    # ASV_APP: a copy, for a mutation run
sys.path.insert(0, os.path.join(HERE, "lib"))
sys.path.insert(0, APP)
from console_state import ConsoleState  # noqa: E402
import asv_console as A  # noqa: E402

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


print("The console keeps her track this boot, for a page that missed some of it:")

# ── 1. the step ────────────────────────────────────────────────────────────────────────────────────────────────────
REF = (43.06, -70.69)
M_LAT = 111320.0


def east(m):
    return REF[0], REF[1] + m / (M_LAT * math.cos(math.radians(REF[0])))


def dist_m(a, b):
    return A._haversine_km(a[1], a[2], b[1], b[2]) * 1000.0


h = A.TrackHistory()
for i in range(2000):                                    # 0.9 m a fix: 7 kn at 4 Hz
    la, lo = east(i * 0.9)
    h.note("boot-A", 1000.0 + i * 0.25, la, lo)
_, kept = h.between("boot-A", 0, 1e12)
steps = [dist_m(kept[i - 1], kept[i]) for i in range(1, len(kept))]
check("1. a point is kept once she is TRACK_HISTORY_STEP_M (%g m) from the last one kept: every step at least that, "
      "none past it by a fix's own run" % A.TRACK_HISTORY_STEP_M,
      lambda: len(kept) > 500 and min(steps) >= A.TRACK_HISTORY_STEP_M and max(steps) < A.TRACK_HISTORY_STEP_M + 0.9
      and kept[0][0] == 1000.0,
      lambda: "%d kept of 2000, steps %.2f-%.2f m" % (len(kept), min(steps), max(steps)))

# ── 2. a stretch, a boot, the cap ──────────────────────────────────────────────────────────────────────────────────
b, mid = h.between("boot-A", 1100.0, 1200.0)
b_other, none = h.between("boot-Z", 0, 1e12)
edge = h.between("boot-A", kept[3][0], kept[6][0])[1]
h.note("boot-B", 5000.0, *east(5))
b_new, after = h.between("boot-B", 0, 1e12)
_, old_after = h.between("boot-A", 0, 1e12)
small = A.TrackHistory(cap=100)
for i in range(150):
    small.note("b", float(i), *east(i * 3.0))
_, cap_pts = small.between("b", -1, 1e9)
check("2. a stretch is the points strictly between its two times, oldest first; another boot's ask gets none (and the boot "
      "held); a new boot starts the track again; the longest kept is the newest `cap` points",
      lambda: b == "boot-A" and mid and all(1100.0 < p[0] < 1200.0 for p in mid) and [p[0] for p in mid] == sorted(p[0] for p in mid)
      and b_other == "boot-A" and none == [] and [p[0] for p in edge] == [kept[4][0], kept[5][0]]
      and b_new == "boot-B" and len(after) == 1 and old_after == []
      and len(cap_pts) == 100 and cap_pts[0][0] == 50.0 and cap_pts[-1][0] == 149.0
      and A.TRACK_HISTORY_MAX == 40000 and A.TRACK_HISTORY_STEP_M == 2.0,
      lambda: "stretch %d points, other boot %r, edge %s, cap kept %d from %s" % (
          len(mid), (b_other, none), [p[0] for p in edge], len(cap_pts), cap_pts[0][0] if cap_pts else None))

# ── 3. the query ───────────────────────────────────────────────────────────────────────────────────────────────────
q_ok = A._track_query("/api/track?boot=x1&since=10.5&until=20")
t_before = time.time()
q_now = A._track_query("/api/track?boot=x1&since=10")
refused = []
for bad in ("/api/track?since=1", "/api/track?boot=x", "/api/track?boot=x&since=abc", "/api/track?boot=x&since=nan",
            "/api/track?boot=x&since=inf", "/api/track?boot=x&since=5&until=4"):
    try:
        A._track_query(bad)
    except ValueError as e:
        refused.append(str(e))
check("3. the query: boot and since, until defaulting to now; a missing field, a time that is not a finite number, or until "
      "before since refused in words",
      lambda: q_ok == ("x1", 10.5, 20.0) and q_now[0] == "x1" and q_now[2] >= t_before and len(refused) == 6
      and all(r for r in refused),
      lambda: "%r; %d refused, e.g. %r" % (q_ok, len(refused), refused[:1]))

# ── 4. live ────────────────────────────────────────────────────────────────────────────────────────────────────────
def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def get(port, path, timeout=5):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d%s" % (port, path), timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8") or "{}")


def post(port, path, body):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def until(pred, limit):
    t0 = time.time()
    while time.time() - t0 < limit:
        try:
            v = pred()
            if v:
                return v
        except Exception:
            pass
        time.sleep(0.25)
    return None


STATE = ConsoleState()
port = free_port()
log = tempfile.TemporaryFile(mode="w+")
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none", "--port", str(port),
                         "--no-ais-service", "--no-tide-window", "--no-weather-window", "--no-log", *STATE.args()],
                        cwd=APP, stdout=log, stderr=subprocess.STDOUT)
try:
    def fix():
        _, s = get(port, "/api/state")
        st = s.get("status") or s.get("telemetry") or s
        lat = st.get("lat_deg") if isinstance(st, dict) else None
        return s if s.get("boot_id") and s.get("server_t") and lat is not None else None
    s0 = until(fix, 60) or {}
    st0 = s0.get("status") or s0.get("telemetry") or s0
    boot0 = s0.get("boot_id")
    code_t, tr0 = get(port, "/api/track?boot=%s&since=0" % urllib.request.quote(str(boot0)))
    near = [p for p in tr0.get("points", []) if abs(p[1] - st0.get("lat_deg", 0)) < 1e-5 and abs(p[2] - st0.get("lon_deg", 0)) < 1e-5]
    code_o, tr_other = get(port, "/api/track?boot=nobody&since=0")
    code_b, bad = get(port, "/api/track?boot=%s&since=soon" % urllib.request.quote(str(boot0)))
    check("4. LIVE: every frame carries server_t, the console's clock; /api/track by the frame's boot answers her fix with "
          "that boot; another boot's ask answers nothing (and the boot held); a bad query is a 400 in words",
          lambda: s0 and abs(s0["server_t"] - time.time()) < 5 and code_t == 200 and tr0.get("boot_id") == boot0
          and len(near) >= 1 and code_o == 200 and tr_other == {"boot_id": boot0, "points": []}
          and code_b == 400 and "usage" in (bad.get("error") or ""),
          lambda: "server_t %s, boot %s, %d point(s) at her fix, other %r, bad %s %r" % (
              s0.get("server_t"), boot0, len(near), tr_other, code_b, bad.get("error")))

    # a respawn: a new boot, a new track
    sp = (43.075, -70.705)
    code_sp = post(port, "/api/cmd/spawn", {"lat": sp[0], "lon": sp[1]})

    def moved():
        _, s = get(port, "/api/state")
        st = s.get("status") or s.get("telemetry") or s
        return s if s.get("boot_id") != boot0 and st.get("lat_deg") is not None and abs(st["lat_deg"] - sp[0]) < 1e-3 else None
    s1 = until(moved, 30) or {}
    boot1 = s1.get("boot_id")
    _, tr_old = get(port, "/api/track?boot=%s&since=0" % urllib.request.quote(str(boot0)))
    _, tr_new = get(port, "/api/track?boot=%s&since=0" % urllib.request.quote(str(boot1)))
    check("4b. LIVE, A RESPAWN: a new boot starts a new track - the old boot's ask answers nothing, the new one's only the "
          "new place",
          lambda: code_sp == 200 and boot1 and boot1 != boot0 and tr_old.get("points") == [] and tr_old.get("boot_id") == boot1
          and tr_new.get("points") and all(abs(p[1] - sp[0]) < 1e-3 and abs(p[2] - sp[1]) < 1e-3 for p in tr_new["points"]),
          lambda: "spawn %s, boots %s -> %s, old ask %r, new %d point(s)" % (
              code_sp, boot0, boot1, tr_old, len(tr_new.get("points") or [])))
finally:
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
