"""tests/stream_fusion.py - the tidal stream fused from NOAA's station predictions and a gridded model.

Andy, 2026-10-07: "move forward with implementation as you suggest. The bottom line goal is to simulate wind/wave/current
effects on the passage of a given ASV through the water." His Little Bay session ran with NO stream - the Piscataqua's
model is unreadable here and has no water from the Memorial Bridge up - while NOAA predicted 3.8 kn of flood and 4.0 kn
of ebb at the General Sullivan Bridge. stream_fusion.py adds NOAA's predictions, a PacIOOS model where one covers the
port, a calibration of the model to the stations and a blend by distance; the console's current monitor serves it at
any position and the simulator asks for it every tick at her own.

What this suite holds, all OFFLINE (every fetch is injected; caches go to a temp folder, never charts/):
  * a station's signed speed becomes a vector on ITS OWN flood or ebb axis (they are not opposite);
  * a 6-minute series is linear; an EVENT series (subordinate stations: max / slack only) follows the tide's shape -
    a quarter sine from slack, a quarter cosine to slack, a half cosine strength to strength - which measured against
    four harmonic stations' full series is 3-6x closer than linear (0.24-0.29 kn RMS against 0.69-0.88 on the
    Piscataqua);
  * times asked in GMT are read as UTC with no local-zone or daylight-saving edge;
  * one station per location, at its SHALLOWEST bin; weak-and-variable stations left out;
  * inverse-distance weighting of the nearest few within reach; nothing past reach - None, never zero;
  * a model window is bilinear over WATER nodes only, and an all-land cell is None;
  * the calibration recovers a known gain and lag, and refuses a fit that is not one;
  * the fusion blends by distance, applies the calibration, and says what it was built from;
  * the station cache works OFFLINE once filled, and a failed refresh keeps what it has;
  * the console's monitor: with no other layer its reading IS the OFS reading, unchanged; with stations it is the
    fusion; `field_at` varies with position and never raises; and the simulator is set by the stream at HER OWN
    position, every tick.

    python tests/stream_fusion.py      # exit 0 = pass, 1 = fail   (stdlib only, no network)
"""
import calendar
import importlib.util as _ilu
import json
import re
import math
import os
import shutil
import sys
import tempfile
import time

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)

fails = 0
ran = 0


def _crash_report(t, e, tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (t.__name__, e))
    print("".join(traceback.format_exception(t, e, tb))[-900:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")
    sys.stdout.flush()
    os._exit(1)


sys.excepthook = _crash_report


def check(name, cond, detail=""):
    global fails, ran
    ran += 1
    try:
        ok = bool(cond() if callable(cond) else cond)
    except Exception as e:                       # a check that throws is a FAILED check, named, not a crash
        ok, detail = False, "%s - THREW %s: %s" % (detail if not callable(detail) else "", type(e).__name__, e)
    if callable(detail):
        try:
            detail = detail()
        except Exception as e:
            detail = "detail THREW %s" % e
    print(("  ok   " if ok else "  FAIL ") + name + ("   [" + str(detail) + "]" if detail else ""))
    if not ok:
        fails += 1


_s = _ilu.spec_from_file_location("stream_fusion_under_test", os.path.join(APP, "stream_fusion.py"))
SF = _ilu.module_from_spec(_s)
_s.loader.exec_module(SF)

TMP = tempfile.mkdtemp(prefix="asv_stream_fusion_")
KN = SF.KN
T0 = calendar.timegm((2026, 10, 7, 0, 0, 0))


def table(sid, lat, lon, flood, ebb, ts, v, name=None):
    return SF.StationTable(sid, 1, name or sid, lat, lon, 3.0, "H", flood, ebb, ts, v)


def sine_table(sid, lat, lon, flood, ebb, amp, period_s=12.42 * 3600, phase_s=0.0, hours=48, step=360):
    ts = [T0 + k * step for k in range(int(hours * 3600 / step) + 1)]
    return table(sid, lat, lon, flood, ebb, ts, [amp * math.sin(2 * math.pi * (t - T0 - phase_s) / period_s) for t in ts])


# ── 1. THE AXIS ───────────────────────────────────────────────────────────────────────
e = SF.axis_vector(2.0, 90.0, 270.0)
w = SF.axis_vector(-1.0, 342.0, 194.0)
check("1. a signed speed is a vector on the station's OWN axis: +2 kn flood toward 090 is 1.03 m/s east; -1 kn ebb "
      "goes toward the EBB direction (194 at the harbor entrance, not the flood's reciprocal 162); None stays None",
      lambda: abs(e[0] - 2 * KN) < 1e-9 and abs(e[1]) < 1e-9
      and abs(SF.speed_set(*w)[1] - 194.0) < 1e-6 and abs(SF.speed_set(*w)[0] - 1.0) < 1e-9
      and SF.axis_vector(None, 0, 180) is None,
      lambda: "flood %s, ebb set %.1f" % (e, SF.speed_set(*w)[1]))

# ── 2-3. THE TABLE: a 6-minute series is linear; an EVENT series follows the tide's shape ───────────────────────────
lin = table("L", 0, 0, 0, 180, [T0, T0 + 360], [1.0, 2.0])
check("2. a 6-minute series is linear between samples, and None outside it - never the nearest value carried on",
      lambda: abs(lin.major_at(T0 + 180) - 1.5) < 1e-9 and lin.major_at(T0 - 1) is None and lin.major_at(T0 + 361) is None,
      lambda: "mid %s" % lin.major_at(T0 + 180))
H = 3 * 3600
ev = table("E", 0, 0, 0, 180, [T0, T0 + H, T0 + 2 * H, T0 + 3 * H, T0 + 4 * H], [0.0, 3.0, 0.0, -2.0, 1.0])
q1, q2, h3 = ev.major_at(T0 + H / 2), ev.major_at(T0 + 1.5 * H), ev.major_at(T0 + 3.5 * H)
check("3. between EVENTS the curve is the tide's: slack to strength a quarter SINE (half way = 0.71 x 3.0 = 2.12, where "
      "linear says 1.5), strength to slack a quarter COSINE (2.12), strength to strength a half cosine (half way = the "
      "mean, -0.5)",
      lambda: abs(q1 - 3 * math.sin(math.pi / 4)) < 1e-9 and abs(q2 - 3 * math.cos(math.pi / 4)) < 1e-9
      and abs(h3 - (-0.5)) < 1e-9 and abs(ev.major_at(T0 + H) - 3.0) < 1e-9,
      lambda: "slack->max %.3f, max->slack %.3f, max->max %.3f" % (q1, q2, h3))

# ── 4. PARSING A CO-OPS REPLY ────────────────────────────────────────────────────────────
payload = {"current_predictions": {"units": "feet, knots", "cp": [
    {"Time": "2026-10-07 00:06", "Velocity_Major": 3.6, "meanFloodDir": 238, "meanEbbDir": 78, "Bin": "8"},
    {"Time": "2026-10-07 00:00", "Velocity_Major": 3.77, "meanFloodDir": 238, "meanEbbDir": 78, "Bin": "8"},
    {"Time": "2026-10-07 00:00", "Velocity_Major": 9.9},
    {"Time": "garbage", "Velocity_Major": 1.0}]}}
tab = SF.parse_coops_series(payload, {"id": "PIR0710", "bin": 8, "name": "General Sullivan Bridge", "lat": 43.11785,
                                      "lon": -70.82608})
check("4. a CO-OPS reply asked in GMT is read as UTC exactly (2026-10-07 00:00 GMT = %d), sorted, the first of a "
      "duplicated time kept, a malformed row skipped, the flood and ebb directions carried; an empty reply is None" % T0,
      lambda: tab is not None and tab.ts == [T0, T0 + 360] and tab.v == [3.77, 3.6]
      and tab.flood_deg == 238 and tab.ebb_deg == 78
      and SF.parse_coops_series({"error": {"message": "No Predictions data was found"}}, {"id": "X", "lat": 0, "lon": 0}) is None,
      lambda: "ts %s v %s" % (tab and tab.ts, tab and tab.v))

# ── 5. PICKING STATIONS ──────────────────────────────────────────────────────────────────
rows = [{"id": "PIR0710", "lat": 43.11785, "lng": -70.82608, "currbin": 1, "depth": 15.0, "type": "H", "name": "GSB"},
        {"id": "PIR0710", "lat": 43.11785, "lng": -70.82608, "currbin": 8, "depth": 3.0, "type": "H", "name": "GSB"},
        {"id": "PIR0710", "lat": 43.11785, "lng": -70.82608, "currbin": 5, "depth": 8.0, "type": "H", "name": "GSB"},
        {"id": "ACT0801", "lat": 43.1100, "lng": -70.8600, "currbin": 2, "depth": None, "type": "S", "name": "Goat"},
        {"id": "ACT0801", "lat": 43.1100, "lng": -70.8600, "currbin": 1, "depth": 15.0, "type": "S", "name": "Goat"},
        {"id": "WKV01", "lat": 43.1150, "lng": -70.8300, "currbin": 1, "depth": 5.0, "type": "W", "name": "weak"},
        {"id": "FAR01", "lat": 44.5000, "lng": -70.8300, "currbin": 1, "depth": 5.0, "type": "H", "name": "far"}]
picks = SF.pick_stations(rows, 43.118, -70.827)
check("5. one entry per LOCATION at its SHALLOWEST bin (GSB bin 8 at 3 ft, not bin 1 at 15); a known depth beats an "
      "unknown one; weak-and-variable stations and stations past the radius left out; nearest first",
      lambda: [p["id"] for p in picks] == ["PIR0710", "ACT0801"] and picks[0]["bin"] == 8 and picks[1]["bin"] == 1,
      lambda: [(p["id"], p["bin"], round(p["dist_m"])) for p in picks])

# ── 6. THE STATION LAYER: inverse distance, reach, and None past it ─────────────────────
A = table("A", 43.10, -70.80, 90.0, 270.0, [T0, T0 + 3600], [2.0, 2.0])
B = table("B", 43.10, -70.79, 0.0, 180.0, [T0, T0 + 3600], [1.0, 1.0])
on_a = SF.stations_field([A, B], 43.10, -70.80, T0 + 60)
mid = SF.stations_field([A, B], 43.10, -70.795, T0 + 60)
far = SF.stations_field([A, B], 43.20, -70.80, T0 + 60)
late = SF.stations_field([A, B], 43.10, -70.80, T0 + 7200)
check("6. a boat on a station takes that station (weight over 0.99); half way between two the vectors are averaged "
      "evenly; past STATION_REACH_M, or at a time no table covers, the layer is None - not a zero",
      lambda: on_a["used"][0][3] > 0.99 and abs(SF.speed_set(on_a["u"], on_a["v"])[0] - 2.0) < 0.02
      and abs(mid["used"][0][3] - 0.5) < 0.01 and far is None and late is None,
      lambda: "on A %.2f kn w %.3f; mid weights %s; far %s; late %s" % (
          SF.speed_set(on_a["u"], on_a["v"])[0], on_a["used"][0][3], [u[3] for u in mid["used"]], far, late))

# ── 7. A MODEL WINDOW ────────────────────────────────────────────────────────────────────
# 4 x 4 nodes, water only in the 2 x 2 corner at the lowest lat / lon (in a 3 x 3 grid every cell touches the centre
# node, so no cell there is all land - the first fixture's mistake, caught by this check)
lats, lons, ts = [21.29, 21.30, 21.31, 21.32], [-157.88, -157.87, -157.86, -157.85], [T0, T0 + 3600]
U = [[[(s if (y < 2 and x < 2) else None) for x in range(4)] for y in range(4)] for s in (0.2, 0.4)]
V = [[[(0.0 if (y < 2 and x < 2) else None) for x in range(4)] for y in range(4)] for _ in (0, 1)]
P = SF.GridPatch(lats, lons, ts, U, V, label="test", key="t")
edge = P.at(21.295, -157.865, T0 + 1800)          # a cell with two water nodes and two land
land = P.at(21.315, -157.855, T0)                 # a cell of land
check("7. a model window is bilinear over WATER nodes only (a cell half land reads its water, 0.3 m/s half way in "
      "time), an all-land cell is None, and outside the window in space or time is None",
      lambda: edge is not None and abs(edge[0] - 0.3) < 1e-9 and land is None
      and P.at(21.0, -157.87, T0) is None and P.at(21.295, -157.875, T0 + 99999) is None,
      lambda: "edge %s land %s" % (edge, land))


# ── 8. CALIBRATION ──────────────────────────────────────────────────────────────────────
st = sine_table("S", 43.10, -70.80, 45.0, 225.0, 2.0)
ax = math.radians(45.0)
LAG = 1800


def model_weak_late(lat, lon, t):
    """The station's own tide at HALF strength, arriving LAG later - so gain 2 and lag +LAG put it right."""
    p = st.major_at(t - LAG)
    if p is None:
        return None
    s = 0.5 * p * KN
    return s * math.sin(ax), s * math.cos(ax)


cal = SF.calibrate(model_weak_late, st, T0 + 3 * 3600, T0 + 30 * 3600)
noise = SF.calibrate(lambda la, lo, t: (0.3 * math.sin(t / 777.0), 0.3 * math.cos(t / 913.0)), st, T0 + 3 * 3600, T0 + 30 * 3600)
dry = SF.calibrate(lambda la, lo, t: None, st, T0 + 3 * 3600, T0 + 30 * 3600)
check("8. the calibration recovers a known gain (2.0) and lag (+30 min) along the station's axis; a model uncorrelated "
      "with the tide, or with no water at the station, gives NO calibration rather than a wild one",
      lambda: cal is not None and abs(cal["gain"] - 2.0) < 0.05 and cal["lag_s"] == LAG and cal["rms_kn"] < 0.05
      and cal["rms_raw_kn"] > 0.5 and noise is None and dry is None,
      lambda: "fit %s; noise %s; dry %s" % (cal, noise, dry))
two = {"a": {"lat": 43.10, "lon": -70.80, "gain": 2.0, "lag_s": 0}, "b": {"lat": 43.10, "lon": -70.70, "gain": 1.0, "lag_s": 600}}
ga = SF.calibration_at(two, 43.10, -70.80)
gm = SF.calibration_at(two, 43.10, -70.75)
gfar = SF.calibration_at(two, 44.5, -70.75)
check("8b. at a position the calibration is the stations' within reach, weighted by inverse distance squared: at a "
      "station its own; half way between two, their mean; out of reach of every one, gain 1 and lag 0",
      lambda: abs(ga[0] - 2.0) < 0.01 and abs(gm[0] - 1.5) < 1e-6 and abs(gm[1] - 300) < 1e-6 and gfar == (1.0, 0, 0),
      lambda: "at a %s; mid %s; far %s" % (ga, gm, gfar))

# ── 9. THE FUSION ───────────────────────────────────────────────────────────────────────
S1 = table("S1", 43.10, -70.80, 90.0, 270.0, [T0, T0 + 7200], [2.0, 2.0])       # 2 kn east at the station


def model_north(lat, lon, t):
    return (0.0, 1.0 * KN)                                                        # 1 kn north everywhere


f_on = SF.fuse(43.10, -70.80, T0 + 60, [S1], model_north, {}, "testofs")
f_1k = SF.fuse(43.10, -70.80 + 1000 / (111320 * math.cos(math.radians(43.1))), T0 + 60, [S1], model_north, {}, "testofs")
f_far = SF.fuse(43.20, -70.80, T0 + 60, [S1], model_north, {}, "testofs")
f_none = SF.fuse(43.20, -70.80, T0 + 60, [S1], None, {}, None)
w1 = math.exp(-1.0)
check("9. the fusion blends by distance to the nearest station: ON a station it is the station (2 kn east); 1 km off "
      "the station weighs exp(-1) = 0.37 against the model; past reach it is the model; with neither layer, None",
      lambda: abs(f_on["speed_kn"] - 2.0) < 0.15 and abs(f_on["set_deg"] - 90) < 5
      and abs(f_1k["w_stations"] - w1) < 0.01 and abs(f_1k["u"] - w1 * 2 * KN) < 0.01 and abs(f_1k["v"] - (1 - w1) * KN) < 0.01
      and f_far["source"].startswith("testofs") and abs(f_far["set_deg"] - 0) < 1e-6 and f_none is None
      and "NOAA predictions" in f_on["source"] and "+" in f_1k["source"],
      lambda: "on %.2f kn @ %.0f (%s); 1 km w %.3f (%s); far %s; none %s" % (
          f_on["speed_kn"], f_on["set_deg"], f_on["source"], f_1k["w_stations"], f_1k["source"], f_far["source"], f_none))
cals = {"S1": {"lat": 43.10, "lon": -70.80, "gain": 2.0, "lag_s": 600}}
seen = []


def model_rec(lat, lon, t):
    seen.append(t)
    return (0.0, 1.0 * KN)


f_cal = SF.fuse(43.20, -70.80, T0 + 60, [], model_rec, cals, "testofs")
check("9b. the model is applied with the calibration at the boat: gain 2 doubles it (2 kn north) and the lag shifts the "
      "time it is read at (+600 s), and the source says it was calibrated",
      lambda: abs(f_cal["speed_kn"] - 2.0) < 1e-6 and seen and abs(seen[-1] - (T0 + 660)) < 1e-6
      and "calibrated" in f_cal["source"],
      lambda: "%.2f kn, read at +%s s, %s" % (f_cal["speed_kn"], seen and seen[-1] - T0, f_cal["source"]))

# ── 10. THE STATION CACHE: filled once, then OFFLINE ──────────────────────────────────────
calls = {"meta": 0, "data": 0}
NOW = time.time()


def fake_fetch(url):
    if "mdapi" in url:
        calls["meta"] += 1
        return {"stations": rows}
    calls["data"] += 1
    t0 = int(NOW // 360) * 360 - 86400
    cp = []
    for k in range(0, 8 * 240 + 1):
        tt = t0 + k * 360
        cp.append({"Time": time.strftime("%Y-%m-%d %H:%M", time.gmtime(tt)),
                   "Velocity_Major": round(2.0 * math.sin(2 * math.pi * tt / 44712.0), 3),
                   "meanFloodDir": 238, "meanEbbDir": 78})
    return {"current_predictions": {"cp": cp}}


def dead_fetch(url):
    raise OSError("no network")


cache = os.path.join(TMP, "cache")
sp = SF.StationPredictions(cache, fetch=fake_fetch)
n1 = sp.ensure(43.118, -70.827)
got1 = len(sp.tables())
sp2 = SF.StationPredictions(cache, fetch=dead_fetch)
n2 = sp2.ensure(43.118, -70.827)
got2 = len(sp2.tables())
v_now = SF.stations_field(sp2.tables(), 43.11785, -70.82608, NOW)
sp3 = SF.StationPredictions(os.path.join(TMP, "empty"), fetch=dead_fetch)
n3 = sp3.ensure(43.118, -70.827)
check("10. the station tables are fetched once and kept on disk: a second console with NO network reads them from the "
      "cache and gives a value now; with no network and no cache it SAYS so, and holds no table",
      lambda: n1 is None and got1 == 2 and calls["meta"] == 1 and calls["data"] == 2
      and got2 == 2 and v_now is not None and len(sp3.tables()) == 0 and n3 and "unreachable" in n3,
      lambda: "first %s (%d tables, %s); offline %s (%d tables, value %s); empty %r" % (
          n1, got1, calls, n2, got2, v_now and round(SF.speed_set(v_now["u"], v_now["v"])[0], 2), n3))
calls2 = {"n": 0}


def counting_fetch(url):
    calls2["n"] += 1
    return fake_fetch(url)


sp4 = SF.StationPredictions(cache, fetch=counting_fetch)
sp4.ensure(43.118, -70.827)
check("10b. a table that still reaches two days ahead is NOT fetched again (the station list is read from its own "
      "cache too) - a console moving inside its 25 km asks NOAA for nothing",
      lambda: calls2["n"] == 0 and len(sp4.tables()) == 2, lambda: "fetches %d" % calls2["n"])

# ── 11. A PACIOOS WINDOW FROM ITS REPLY ───────────────────────────────────────────────────
reply = {"table": {"columnNames": ["time", "depth", "latitude", "longitude", "u", "v"], "rows": [
    ["2026-10-07T15:00:00Z", 0.25, 21.30, -157.87, -0.045, 0.038],
    ["2026-10-07T15:00:00Z", 0.25, 21.30, -157.86, None, None],
    ["2026-10-07T15:00:00Z", 0.25, 21.31, -157.87, -0.05, 0.04],
    ["2026-10-07T15:00:00Z", 0.25, 21.31, -157.86, -0.05, 0.04],
    ["2026-10-07T18:00:00Z", 0.25, 21.30, -157.87, 0.0, 0.1],
    ["2026-10-07T18:00:00Z", 0.25, 21.30, -157.86, None, None],
    ["2026-10-07T18:00:00Z", 0.25, 21.31, -157.87, 0.0, 0.1],
    ["2026-10-07T18:00:00Z", 0.25, 21.31, -157.86, 0.0, 0.1]]}}
asked = []
model = SF.erddap_model_for(21.3065, -157.8694)
patch = SF.fetch_erddap_patch(model, 21.305, -157.865, T0, T0 + 86400, fetch=lambda u: (asked.append(u), reply)[1])
check("11. Honolulu is served by the Oahu South Shore model (the smallest domain that covers it); its reply becomes a "
      "window - land as None, times as UTC epochs - and the request names the surface level and both components",
      lambda: model["key"] == "pacioos_oahu_south" and patch.times == [T0 + 15 * 3600, T0 + 18 * 3600]
      and patch.u[0][0][1] is None and abs(patch.u[0][0][0] + 0.045) < 1e-12
      and "roms_hiomsg.json?u" in asked[0] and "(0.25)" in asked[0] and ",v" in asked[0]
      and SF.erddap_model_for(43.07, -70.71) is None,
      lambda: "model %s, times %s, url %s" % (model and model["key"], patch.times, asked and asked[0][:110]))

# ── 12. THE SOURCES OBJECT, driven directly (no thread) ───────────────────────────────────
srcs = SF.StreamSources(os.path.join(TMP, "src"), fetch=fake_fetch, start=False)
srcs.run_once(43.118, -70.827, now=NOW)
k1 = srcs._cal_key
c1 = srcs.cals()
srcs.run_once(43.118, -70.827, now=NOW)
check("12. the sources hold the tables round the boat, no model window outside the PacIOOS domains, and with no model "
      "no calibration; a second pass with nothing changed does not recalibrate",
      lambda: len(srcs.tables()) == 2 and srcs.patch() is None and c1 == {} and srcs._cal_key == k1
      and srcs.status()["stations"] == 2,
      lambda: "status %s" % srcs.status())

# ── 13-15. THE CONSOLE: the monitor and the simulator ─────────────────────────────────────
_spec = _ilu.spec_from_file_location("console_for_stream_fusion", os.path.join(APP, "asv_console.py"))
C = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(C)


class _Cur:
    """Stands in for currents.Currents: 1 kn north everywhere, a live frame."""
    tag = "testofs_t00z"
    import datetime as _dt
    start = _dt.datetime(2026, 10, 7, 0, 0, tzinfo=_dt.timezone.utc)
    end = _dt.datetime(2026, 10, 9, 6, 0, tzinfo=_dt.timezone.utc)

    def at_best(self, lat, lon, when):
        return (1.0, 0.0, 0.0, 1.0 * KN), 0.0


mon = C.CurrentsMonitor.__new__(C.CurrentsMonitor)          # no threads, no network
mon._ofs, mon._tag, mon._cur = "testofs", "testofs_t00z", _Cur()
bare = mon._sample(43.10, -70.80)                           # no _sources at all: exactly the OFS reading
mon._sources = SF.StreamSources(os.path.join(TMP, "mon"), fetch=dead_fetch, start=False)
alone = mon._sample(43.10, -70.80)                          # sources, but no station and no calibration here
ofs_only = mon._ofs_sample(43.10, -70.80)
check("13. with no station in reach, no PacIOOS window and no calibration, the monitor's reading IS the OFS reading - "
      "field for field, as before this change",
      lambda: alone == ofs_only and bare == ofs_only and alone["ok"] and alone["source"] == "testofs",
      lambda: "reading %s" % json.dumps(alone)[:160])
NOWT = time.time()
mon._sources.stations._tables = (table("GSB", 43.11785, -70.82608, 238.0, 78.0, [NOWT - 3600, NOWT + 3600], [3.0, 3.0],
                                       name="General Sullivan Bridge"),)
fused = mon._sample(43.11785, -70.82608)
gsb = mon.field_at(43.11785, -70.82608)
off = mon.field_at(43.11785 + 0.03, -70.82608)
check("14. with a station in reach the reading is the FUSION: on the station its 3 kn toward 238, named with its weight, "
      "the source saying so; and field_at answers at ANY position - the station on it, the OFS 3 km away",
      lambda: fused["ok"] and abs(fused["speed_kn"] - 3.0) < 0.05 and abs(fused["set_deg"] - 238) < 1
      and fused["stations"][0][1] == "General Sullivan Bridge" and "NOAA predictions" in fused["source"]
      and abs(gsb[0] - 3.0) < 0.05 and off is not None and abs(off[1] - 0.0) < 1 and abs(off[0] - 1.0) < 0.05,
      lambda: "reading %.2f kn @ %.0f via %s; field on %s, 3 km north %s" % (
          fused.get("speed_kn", -1), fused.get("set_deg", -1), fused.get("source"), gsb, off))


class _Broken:
    def tables(self):
        raise RuntimeError("boom")


mon2 = C.CurrentsMonitor.__new__(C.CurrentsMonitor)
mon2._ofs, mon2._tag, mon2._cur, mon2._sources = "x", None, None, _Broken()
check("14b. field_at never raises - a broken source is no stream at that point, not a dead simulator tick",
      lambda: mon2.field_at(43.1, -70.8) is None, "")


class _Field:
    """A stream that varies with position: 2 kn east west of -70.80, 2 kn west east of it. Records where it was asked."""

    def __init__(self):
        self.asked = []

    def field_at(self, lat, lon, t=None):
        self.asked.append((lat, lon))
        return (2.0, 90.0) if lon < -70.80 else (2.0, 270.0)

    def snapshot(self):
        return {"ok": False, "note": "not read by the sim"}

    def update_position(self, *a):
        pass


fld = _Field()
C.CURRENTS = fld
vcu = C.SimVcu()
vcu.lat, vcu.lon = 43.10, -70.85
vcu._running = True
vcu._paused = True                           # deployed, no way on: the stream alone carries her
lon0 = vcu.lon
for _ in range(40):
    vcu.tick(0.25)
moved_e = (vcu.lon - lon0) * 111320 * math.cos(math.radians(43.1))
asked_here = all(abs(a[0] - 43.10) < 1e-3 for a in fld.asked) and abs(fld.asked[-1][1] - vcu.lon) < 1e-4
vcu2 = C.SimVcu()
vcu2.lat, vcu2.lon = 43.10, -70.75
vcu2._running = True
vcu2._paused = True
lon2 = vcu2.lon
for _ in range(40):
    vcu2.tick(0.25)
moved_w = (vcu2.lon - lon2) * 111320 * math.cos(math.radians(43.1))
check("15. the simulator is set by the stream at HER OWN position, every tick: west of the line a stopped boat drifts "
      "east at 2 kn (10.3 m in 10 s), east of it west - the same console, two places, two streams",
      lambda: abs(moved_e - 2 * KN * 10) < 0.6 and abs(moved_w + 2 * KN * 10) < 0.6 and asked_here and len(fld.asked) >= 80,
      lambda: "west boat %+.1f m, east boat %+.1f m; asked %d times, last at %s" % (moved_e, moved_w, len(fld.asked),
                                                                                     fld.asked and fld.asked[-1]))

# ── 16. WHY THE MODEL IS MISSING, ON A GOOD READING AND ON A REFUSAL ────────────────────────
import threading
mon3 = C.CurrentsMonitor.__new__(C.CurrentsMonitor)
mon3._lock, mon3._ofs, mon3._tag, mon3._cur = threading.Lock(), "gomofs", None, None
mon3._no_cycle_why = "gomofs frames are not hourly - unreadable by this build"
mon3._sources = SF.StreamSources(os.path.join(TMP, "mon3"), fetch=dead_fetch, start=False)
mon3._sources.stations._tables = (table("FTP", 43.0712, -70.7098, 300.0, 120.0, [NOWT - 3600, NOWT + 3600], [1.0, 1.0],
                                        name="Fort Point"),)
mon3._pass((43.0712, -70.7098), False)
good = dict(mon3._last)
mon3._pass((43.20, -70.50), False)                          # no station in reach, no model: a refusal
bad = dict(mon3._last)
check("16. at New Castle - stations, gomofs unreadable - the good reading carries the model's reason in model_note, NOT "
      "in note (the page reads a note on a good reading as the projection warning); a refusal names every reason: no "
      "station in reach AND why there is no model",
      lambda: good.get("ok") and not good.get("note") and "not hourly" in (good.get("model_note") or "")
      and bad.get("ok") is False and "no NOAA current-prediction station" in bad.get("note", "")
      and "not hourly" in bad.get("note", "") and "no cycle cached yet" not in bad.get("note", ""),
      lambda: "good note %r model_note %r; refusal %r" % (good.get("note"), good.get("model_note"), bad.get("note")))

# ── 17. THE CALM SWITCH IS CALM ─────────────────────────────────────────────────────────────
C.CURRENTS = _Field()
C.ENV.set_enabled(False)
try:
    vc = C.SimVcu()
    vc.lat, vc.lon = 43.10, -70.85
    vc._running, vc._paused = True, True
    lc = vc.lon
    for _ in range(40):
        vc.tick(0.25)
    calm_m = abs(vc.lon - lc) * 111320 * math.cos(math.radians(43.1))
    calm_set = vc.tick(0.25).get("env_set_kn")
finally:
    C.ENV.set_enabled(True)
vc2 = C.SimVcu()
vc2.lat, vc2.lon = 43.10, -70.85
vc2._running, vc2._paused = True, True
lc2 = vc2.lon
for _ in range(40):
    vc2.tick(0.25)
live_m = abs(vc2.lon - lc2) * 111320 * math.cos(math.radians(43.1))
check("17. with the environment switched off (the operations manual's 'deterministic calm run') the stream is not "
      "applied - the stopped boat stays put and the set reads 0 - and switched back on it carries her again",
      lambda: calm_m < 0.05 and not calm_set and abs(live_m - 2 * KN * 10) < 0.6,
      lambda: "off: moved %.2f m, set %s; on: moved %.1f m" % (calm_m, calm_set, live_m))

# ── 18. EVERY TEST CONSOLE GETS THE OFS ALONE ─────────────────────────────────────────────────
sys.path.insert(0, os.path.join(APP, "tests", "lib"))
from console_state import ConsoleState  # noqa: E402
SRC = open(os.path.join(APP, "asv_console.py"), encoding="utf-8").read()
mon4 = C.CurrentsMonitor.__new__(C.CurrentsMonitor)
mon4._ofs, mon4._tag, mon4._cur = "testofs", "testofs_t00z", _Cur()
mon4._sources = SF.StreamSources(os.path.join(TMP, "mon4"), fetch=dead_fetch, start=False)
mon4._sources.stations._tables = (table("GSB", 43.11785, -70.82608, 238.0, 78.0, [NOWT - 3600, NOWT + 3600], [3.0, 3.0]),)
before4 = mon4.field_at(43.11785, -70.82608)
mon4.disable_sources()
after4 = mon4.field_at(43.11785, -70.82608)
check("18. a console given --no-stream-predictions reads the OFS alone (the station at the boat no longer in it), and "
      "every test harness's console is given it - so no suite that drives the boat at New Castle passes at slack and "
      "fails at full ebb",
      lambda: "--no-stream-predictions" in ConsoleState().args()
      and re.search(r"if args\.no_stream_predictions:[^\n]*\n\s+CURRENTS\.disable_sources\(\)", SRC) is not None
      and abs(before4[0] - 3.0) < 0.05 and abs(after4[0] - 1.0) < 0.05 and abs(after4[1] - 0.0) < 1,
      lambda: "args %s; field before %s, after %s" % (ConsoleState().args(), before4, after4))

shutil.rmtree(TMP, ignore_errors=True)
print("\n%s (%d ran)" % ("%d CHECK(S) FAILED" % fails if fails else "all checks passed", ran))
sys.stdout.flush()
os._exit(1 if fails else 0)
