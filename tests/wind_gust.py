"""tests/wind_gust.py - the simulator's gusts are the BUOYS' OWN (2026-10-09).

Andy: "Wind gusts are made up by the simulator; the buoys' gust readings are never used. Correct this".

WHAT WAS WRONG. The NDBC row parser read every column, GST (the peak 5- or 8-second gust in the period WSPD averages)
included, and the wind blend used WDIR and WSPD alone. SimVcu then laid a fixed gust shape over the blended mean - an
amplitude of 0.22, a peak of 1.33x - whatever the buoys reported: a squally day and a steady breeze gusted alike.

WHAT IT IS NOW. Each buoy's gust FACTOR, GST / WSPD, is blended over the same buoys and weights as the wind
(renormalized over those that report one), and the gust is that factor on the blended mean. A buoy near calm (WSPD
under 1 m/s) or with a factor below 1 or over 3 is a bad row, not a gust, and is left out. No buoy reporting one = no
gust on the reading - never a made-up one - and the sim falls back to its old default size. The simulated gusts peak
at the measured factor (gust_multiplier), up to twice the mean, where the symmetric lull reaches calm; their TIMING and
the slow veer are still the sim's own, since a buoy reports only its period's peak.

    python tests/wind_gust.py     # exit 0 = pass, 1 = fail   (in-process: no console, no network)

TEETH (each verified by mutation, 2026-10-09):
    the blend drops GST again                                   -> 1, 2, 3
    the factor is divided by ALL the wind weights, not renormalized -> 1, 2
    near-calm / implausible buoys are let into the factor       -> 2
    a manual wind speed keeps the buoys' gust                   -> 3
    the physics view drops the factor                           -> 3
    gust_multiplier ignores the factor                          -> 4, 5
    the 2x cap is gone (the lull goes below calm)               -> 4
    (and the page dropping the G from the wind row              -> reading_age.js 6g)
"""

import importlib.util
import math
import os
import sys
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
sys.path.insert(0, APP)        # the app's modules first: tests/currents.py is a SUITE, and would shadow currents.py

fails = 0
ran = 0


def _crash_report(t, e, tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (t.__name__, e))
    print("".join(traceback.format_exception(t, e, tb))[-900:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")
    sys.stdout.flush()
    os._exit(1)


sys.excepthook = _crash_report             # a death is REPORTED, not silent (turn_geometry.js check 30)


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


# Import the console WITHOUT starting anything (nothing runs on import by design).
spec = importlib.util.spec_from_file_location("console_for_wind_gust", os.path.join(APP, "asv_console.py"))
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)

print("The simulator's gusts are the buoys' own:")

# ── fixtures: three buoys round Eastport, rows served from a table ─────────────────────────────
NOW = time.time()
ROW_T = time.strftime("%Y %m %d %H %M", time.gmtime(NOW - 20 * 60))
# All three within a few km of AT, so each carries real weight - with one buoy on top of the boat its weight swamps
# the others, and a factor divided by EVERY wind weight instead of the gust-reporting ones' reads the same (it did).
BUOYS = [{"id": "B1", "lat": 44.90, "lon": -66.98}, {"id": "B2", "lat": 44.95, "lon": -66.90},
         {"id": "B3", "lat": 44.96, "lon": -66.99}]
ROWS = {}                                             # id -> (WDIR, WSPD, GST); None = "MM"
A._load_ndbc_stations = lambda timeout=30.0: list(BUOYS)


def fake_http(url, timeout=15.0):
    sid = url.rsplit("/", 1)[-1].split(".")[0]
    f = lambda v: "MM" if v is None else ("%.1f" % v)
    wdir, wspd, gst = ROWS[sid]
    return ("#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES\n"
            "#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa\n"
            "%s %s %s %s   0.8   6.0   4.5 230 1012.0\n" % (ROW_T, f(wdir), f(wspd), f(gst)))


A._env_http_get = fake_http
AT = (44.93, -66.95)


def weights():
    """The blend's own IDW weights for the three buoys from AT, nearest first."""
    d = sorted((A._haversine_km(AT[0], AT[1], b["lat"], b["lon"]), b["id"]) for b in BUOYS)
    return [i for _, i in d], A._idw_weights([(km, sid, None) for km, sid in d])


# 1. THE BLEND. B1 gusts 8.0 on 6.0 (1.333), B2 7.5 on 5.0 (1.5); B3 reports no gust and is not in the factor.
ROWS.update({"B1": (240.0, 6.0, 8.0), "B2": (250.0, 5.0, 7.5), "B3": (245.0, 7.0, None)})
env1 = A.fetch_environment(*AT)
ids, w = weights()
fac = {"B1": 8.0 / 6.0, "B2": 7.5 / 5.0}
want = sum(wi * fac[i] for i, wi in zip(ids, w) if i in fac) / sum(wi for i, wi in zip(ids, w) if i in fac)
w1 = (env1.get("wind") or {})
check("1. each buoy's gust factor (GST / WSPD) is blended over the wind's own buoys and weights, renormalized over those "
      "reporting a gust, and the gust is that factor on the blended mean",
      lambda: env1.get("ok") and abs(w1["gust_factor"] - want) < 0.0015
      and abs(w1["gust_kn"] - w1["speed_ms"] * want * 1.9438) < 0.06 and w1.get("gust_src") == "buoy",
      lambda: "factor %s (want %.3f), gust %s kn on %s kn" % (w1.get("gust_factor"), want, w1.get("gust_kn"),
                                                           w1.get("speed_kn")))

# 2. NOT A GUST: near calm (B1, 2.0 on 0.5), a gust under the mean (B2, 4.0 on 5.0), a factor over 3 (B3, 21 on 6).
ROWS.update({"B1": (240.0, 0.5, 2.0), "B2": (250.0, 5.0, 4.0), "B3": (245.0, 6.0, 21.0)})
env2 = A.fetch_environment(*AT)
ROWS.update({"B1": (240.0, 6.0, 9.0), "B2": (250.0, 5.0, None), "B3": (245.0, 7.0, None)})
env2b = A.fetch_environment(*AT)
check("2. a buoy near calm, or with a factor below 1 or over 3, is a bad row and is left out - with none left there is "
      "no gust on the reading at all, never a made-up one; one good buoy alone gives its own factor",
      lambda: env2.get("ok") and not any(k.startswith("gust") for k in env2["wind"])
      and env2b["wind"]["gust_factor"] == 1.5,
      lambda: "bad rows -> %s; one good -> %s" % (sorted(k for k in env2["wind"] if k.startswith("gust")),
                                                 env2b["wind"].get("gust_factor")))

# 3. THE MONITOR: the physics view carries the factor; a manual wind speed drops the buoys' gust; a manual gust sets one.
M = A.EnvMonitor.__new__(A.EnvMonitor)                # no thread, no network
M._lock, M._last, M._manual, M._enabled = threading.Lock(), dict(env1), {}, True
M._fetched_at, M._error = NOW, None
f_buoy = M.field()["gust_factor"]
M.set_manual({"wind_kn": 20.0})
f_man_wind, snap_man = M.field()["gust_factor"], M.snapshot()["wind"]
M.set_manual({"gust_kn": 28.0})
f_man_gust, snap_gust = M.field()["gust_factor"], M.snapshot()["wind"]
M.set_manual({"clear": True})
f_back = M.field()["gust_factor"]
check("3. the physics view carries the buoys' factor; a manual wind speed drops it (it was the buoys' wind's gust); a "
      "manual gust sets one on the manual wind; clearing the override brings the buoys' back",
      lambda: f_buoy == w1["gust_factor"] and f_man_wind is None and "gust_kn" not in snap_man
      and f_man_gust == 1.4 and snap_gust["gust_kn"] == 28.0 and snap_gust["gust_src"] == "manual"
      and f_back == w1["gust_factor"],
      lambda: "buoy %s, manual wind %s, manual gust %s (%s kn, %s), cleared %s" % (
          f_buoy, f_man_wind, f_man_gust, snap_gust.get("gust_kn"), snap_gust.get("gust_src"), f_back))


# 4. THE SHAPE: it peaks at the measured factor, averages the mean, and stops at 2x (the lull reaches calm there).
def sweep(gf):
    v = [A.gust_multiplier(k * 0.25, gf) for k in range(80000)]      # 20 000 s of sim time
    return max(v), min(v), sum(v) / len(v)


s16, s_none, s25, s10 = sweep(1.6), sweep(None), sweep(2.5), sweep(1.0)
check("4. the simulated gusts peak at the measured factor (1.6 -> 1.6x) and average the mean; with none measured, the "
      "old default (1.33x); a factor over 2 stops at 2x with the lull at calm, never below; a factor of 1 is a steady wind",
      lambda: abs(s16[0] - 1.6) < 0.01 and abs(s16[2] - 1.0) < 0.01 and abs(s_none[0] - 1.33) < 0.01
      and abs(s25[0] - 2.0) < 0.01 and s25[1] >= -1e-9 and s25[1] < 0.01 and s10[0] == s10[1] == 1.0,
      lambda: "1.6 -> max %.3f mean %.3f; none -> %.3f; 2.5 -> %.3f..%.3f; 1.0 -> %.3f..%.3f" % (
          s16[0], s16[2], s_none[0], s25[1], s25[0], s10[1], s10[0]))


# 5. ON THE HULL: a stopped boat's leeway swings with the measured gust - flat at a factor of 1, wide at 1.8.
class _Env:
    def __init__(self, gf):
        self.gf = gf

    def field(self):
        return {"wind_from_deg": 270.0, "wind_speed_ms": 6.0, "gust_factor": self.gf,
                "wave_from_deg": 270.0, "hs_m": 0.0, "tp_s": 4.0}

    def is_enabled(self):
        return True


class _NoStream:
    def field_at(self, lat, lon, t=None):
        return None


def leeway_spread(gf):
    A.ENV, A.CURRENTS = _Env(gf), _NoStream()
    v = A.SimVcu()
    v.lat, v.lon, v.heading = 44.90, -66.98, 0.0
    v._running, v._paused = True, True               # deployed, no way on: the wind alone carries her
    s = [v.tick(0.25).get("env_set_kn") or 0.0 for _ in range(600)]   # 150 s
    s = s[40:]
    return min(s), max(s)


calm_lo, calm_hi = leeway_spread(1.0)
gust_lo, gust_hi = leeway_spread(1.8)
check("5. on the hull: with a factor of 1 a stopped boat's leeway barely moves (only the veer swings it); with 1.8 it "
      "swings several-fold, the gust the buoys reported reaching the set",
      lambda: calm_lo > 0 and calm_hi / calm_lo < 1.15 and gust_lo > 0 and gust_hi / gust_lo > 3.0,
      lambda: "factor 1.0: %.3f..%.3f kn; factor 1.8: %.3f..%.3f kn" % (calm_lo, calm_hi, gust_lo, gust_hi))

print("\n%s (%d ran)" % ("%d CHECK(S) FAILED" % fails if fails else "all checks passed", ran))
sys.stdout.flush()
os._exit(1 if fails else 0)
