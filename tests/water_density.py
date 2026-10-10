"""tests/water_density.py - the water's density is the water's own (2026-10-09).

Andy: "Water density is set to fresh water (1000 kg/m3) at every port, salt water included. Estimate or find realtime
sources or models for water density based on time and position". Asked how far to go, he chose MEASURED + ESTIMATE.

WHAT IT IS. Salinity from the nearest NOAA CO-OPS physical-oceanography station within 25 km whose reading is under
3 h old (measured that day: Seavey Island 2.6 km from New Castle, 29.02 PSU; Lewes 3.7 km from Lewes, 28.14), 0 inside
the Great Lakes, otherwise 35 PSU flagged as an estimate; temperature from the nearest station within 50 km, else the
weather buoys' blended WTMP, else 15 C flagged; the density by UNESCO EOS-80 at the surface. The simulator reads it
every tick in its hull drag and wave drift - fresh water until the first reading.

WHAT IT MOVES (check 4 pins it): a stopped boat's WIND-driven leeway scales as 1/sqrt(rho) - about 1.2% less in Gulf
of Maine water than fresh - while the WAVE-driven leeway does not change, because the wave drift force and the hull's
drag both carry the density and it cancels.

    python tests/water_density.py     # exit 0 = pass, 1 = fail   (in-process: no console, no network)

TEETH (each verified by mutation, 2026-10-09):
    an EOS-80 coefficient wrong                                  -> 1
    the Great Lakes rule dropped (lake water read as ocean)       -> 2
    the salinity reach ignored (a station 30 km off used)         -> 2
    a stale station reading used                                  -> 2
    the buoys' temperature ignored                                -> 2, 3
    the sim keeps the fixed 1000                                  -> 4
    the buoys' WTMP not blended into the weather reading          -> 5
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


spec = importlib.util.spec_from_file_location("console_for_water_density", os.path.join(APP, "asv_console.py"))
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)

print("The water's density is the water's own:")

# 1. THE EQUATION against the standard's own published check values (UNESCO 1981, pressure 0) - not against this code.
CHECKS = [((0.0, 5.0), 999.96675), ((35.0, 5.0), 1027.67547), ((35.0, 25.0), 1023.34306)]
got = [(st, A.rho_eos80(*st), want) for st, want in CHECKS]
check("1. UNESCO EOS-80 reproduces its published check values (fresh 5 C, 35 PSU at 5 and 25 C) to 1 g/m3",
      lambda: all(abs(g - w) < 1e-3 for _, g, w in got),
      lambda: "; ".join("S%g T%g -> %.5f (%.5f)" % (st[0], st[1], g, w) for st, g, w in got))

# ── 2. WHICH WATER: stations served from a table ───────────────────────────────────────────────
AT = (43.07, -70.71)                                  # off New Castle
KM_LAT = 1.0 / 111.32


def off(km_n):
    return AT[0] + km_n * KM_LAT


NOW = time.time()
gmt = lambda age_min: time.strftime("%Y-%m-%d %H:%M", time.gmtime(NOW - age_min * 60))
STATIONS = [{"id": "S1", "name": "Near", "lat": off(2.6), "lng": AT[1]},       # 2.6 km
            {"id": "S2", "name": "Far", "lat": off(30.0), "lng": AT[1]},       # 30 km: past the salinity reach
            {"id": "S3", "name": "Temp only", "lat": off(40.0), "lng": AT[1]}]  # 40 km: inside the temperature reach
DATA = {}                                              # (id, product) -> row
A._load_physocean_stations = lambda timeout=30.0: list(STATIONS)
A._coops_physocean_latest = lambda sid, product, timeout=15.0: DATA.get((sid, product))


def setdata(**rows):
    DATA.clear()
    for k, v in rows.items():
        sid, prod = k.split("__")
        DATA[(sid, prod)] = v


setdata(S1__salinity={"t": gmt(12), "s": "29.02", "g": "1.023"}, S1__water_temperature={"t": gmt(12), "v": "13.3"},
        S2__salinity={"t": gmt(10), "s": "33.0"}, S3__water_temperature={"t": gmt(5), "v": "16.0"})
a = A.fetch_density(*AT)
setdata(S1__salinity={"t": gmt(4 * 60), "s": "29.02"}, S1__water_temperature={"t": gmt(12), "v": "13.3"},
        S2__salinity={"t": gmt(10), "s": "33.0"})
b = A.fetch_density(*AT)                                # S1 stale, S2 out of reach -> estimated 35
setdata(S2__salinity={"t": gmt(10), "s": "33.0"})
c = A.fetch_density(*AT, buoy_temp={"c": 12.5, "stations": [{"id": "44098", "dist_km": 30.0}]})
d = A.fetch_density(*AT)                                # nothing for temperature at all
e = A.fetch_density(42.20, -81.00)                      # Lake Erie
check("2. salinity from the nearest station within 25 km under 3 h old, else 35 PSU flagged; 0 inside the Great Lakes; "
      "temperature from a station within 50 km, else the buoys, else 15 C flagged",
      lambda: a["salinity"]["source"] == "measured" and a["salinity"]["psu"] == 29.02 and a["salinity"]["station"] == "S1"
      and a["temp"]["c"] == 13.3 and not a["estimated"] and abs(a["rho"] - A.rho_eos80(29.02, 13.3)) < 0.01
      and b["salinity"]["source"] == "estimate" and b["salinity"]["psu"] == 35.0 and b["estimated"]
      and c["temp"]["source"] == "buoy" and c["temp"]["c"] == 12.5
      and d["temp"]["source"] == "estimate" and d["temp"]["c"] == 15.0 and d["estimated"]
      and e["salinity"]["source"] == "fresh" and e["salinity"]["psu"] == 0.0 and e["rho"] < 1000.0,
      lambda: "measured %.2f (S %s T %s); stale/far -> S %s %s; buoy T %s; no T -> %s %s; Erie S %s rho %.2f" % (
          a["rho"], a["salinity"]["psu"], a["temp"]["c"], b["salinity"]["psu"], b["salinity"]["source"],
          c["temp"].get("c"), d["temp"]["c"], d["temp"]["source"], e["salinity"]["psu"], e["rho"]))


# 3. THE MONITOR: fresh water until a reading; then the reading's, aged from its oldest station; the buoys' temperature
# reaches it through the weather monitor.
class _Env:
    def water_temp(self):
        return {"c": 12.5, "stations": [{"id": "44098", "dist_km": 30.0}]}

    def is_enabled(self):
        return True


M = A.WaterDensity.__new__(A.WaterDensity)               # no thread
M._lock, M._last, M._sampled_at, M._error = threading.Lock(), {"ok": False, "note": "waiting for a GPS fix"}, None, None
before = M.rho()
A.ENV = _Env()
setdata(S2__salinity={"t": gmt(10), "s": "33.0"})
M._pass(AT)
after, snap = M.rho(), M.snapshot()
check("3. the sim reads fresh water until the first reading, then the reading's density; the buoys' temperature reaches "
      "it through the weather monitor; a reading is aged from its oldest station observation",
      lambda: before == 1000.0 and abs(after - snap["rho"]) < 1e-9 and snap["temp"]["source"] == "buoy"
      and snap["age_s"] is not None,
      lambda: "before %s, after %s, temp %s, age %s" % (before, after, snap["temp"], snap["age_s"]))


# 4. ON THE HULL: the wind-driven leeway scales as 1/sqrt(rho); the wave-driven one does not move.
class _Wx:
    def __init__(self, ws, hs):
        self.ws, self.hs = ws, hs

    def field(self):
        return {"wind_from_deg": 270.0, "wind_speed_ms": self.ws, "gust_factor": 1.0,
                "wave_from_deg": 270.0, "hs_m": self.hs, "tp_s": 6.0}

    def is_enabled(self):
        return True

    def water_temp(self):
        return None


class _Rho:
    def __init__(self, r):
        self.r = r

    def rho(self):
        return self.r


class _NoStream:
    def field_at(self, lat, lon, t=None):
        return None


def leeway(ws, hs, rho):
    """The sim's own leeway (m/s, unrounded) on the FIRST tick of a stopped boat. Not the published env_set_kn: that is
    rounded to 0.01 kn, coarser than a 1.2% effect at these speeds (the first draft of this check read 0.9852 for
    0.9882 that way); and not later ticks, where her own drift feeds back into the apparent wind."""
    A.ENV, A.CURRENTS, A.DENSITY = _Wx(ws, hs), _NoStream(), _Rho(rho)
    v = A.SimVcu()
    v.lat, v.lon, v.heading = 43.0, -70.0, 0.0
    v._running, v._paused = True, True
    v.tick(0.25)
    return math.hypot(*v._drift_en)


w_f, w_s = leeway(6.0, 0.0, 1000.0), leeway(6.0, 0.0, 1024.0)
v_f, v_s = leeway(0.0, 1.0, 1000.0), leeway(0.0, 1.0, 1024.0)
rw = w_s / w_f
rv = v_s / v_f
check("4. on the hull: in 1024 kg/m3 water a stopped boat's wind-driven leeway is sqrt(1000/1024) of fresh water's "
      "(1.2% less), and its wave-driven leeway is unchanged - the density cancels there",
      lambda: abs(rw - math.sqrt(1000.0 / 1024.0)) < 1e-4 and abs(rv - 1.0) < 1e-4 and w_f > 0 and v_f > 0,
      lambda: "wind: %.5f (want %.5f, %.3f m/s fresh); waves: %.5f (want 1, %.3f m/s fresh)" % (
          rw, math.sqrt(1000.0 / 1024.0), w_f, rv, v_f))

# 5. THE BUOYS' WATER TEMPERATURE rides the weather reading (WTMP, blended like the sea state).
BUOYS = [{"id": "B1", "lat": 44.90, "lon": -66.98}, {"id": "B2", "lat": 44.95, "lon": -66.90}]
WT = {"B1": "12.0", "B2": "14.0"}
A._load_ndbc_stations = lambda timeout=30.0: list(BUOYS)
ROW_T = time.strftime("%Y %m %d %H %M", time.gmtime(NOW - 20 * 60))
A._env_http_get = lambda url, timeout=15.0: (
    "#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP\n"
    "#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC\n"
    "%s 240  6.0  8.0   0.8   6.0   4.5 230 1012.0  15.0 %s\n" % (ROW_T, WT[url.rsplit("/", 1)[-1].split(".")[0]]))
envr = A.fetch_environment(44.93, -66.95)
dists = sorted((A._haversine_km(44.93, -66.95, b["lat"], b["lon"]), b["id"]) for b in BUOYS)
wts = A._idw_weights([(dk, sid, None) for dk, sid in dists])
want_t = sum(w * float(WT[sid]) for w, (dk, sid) in zip(wts, dists))
check("5. the weather reading carries the buoys' water temperature (WTMP), blended over the same weights as the sea state",
      lambda: envr.get("water_temp") and abs(envr["water_temp"]["c"] - want_t) < 0.01,
      lambda: "water_temp %s (want %.2f)" % (envr.get("water_temp"), want_t))

print("\n%s (%d ran)" % ("%d CHECK(S) FAILED" % fails if fails else "all checks passed", ran))
sys.stdout.flush()
os._exit(1 if fails else 0)
