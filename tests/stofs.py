"""tests/stofs.py - NOAA STOFS-3D's surge forecast in a passage's planning water (Andy, 2026-10-13: "review this model for
added utility: https://ccrm.vims.edu/schismweb/ ... Prioritize robustness and code reliability over speed", then
"approve 1, 1b, 2 and 6").

THE FIXTURES are cut from the real STOFS-3D-Atlantic cycle of 2026-10-13 12z (tests/fixtures/stofs_atl_fcast.nc and
_ncast.nc: five of its 166 stations, every value identical to the published file) and NOAA's own data for three of its
gauges the same evening (tests/fixtures/stofs_coops.json: observations, 6-minute predictions, datums). Lewes and Portland
were reporting; Fort Point at New Castle was NOT - no observation in 24 hours - which is the case item 1b is for.

  1-1c  the station file read (classic netCDF), every value as published; anything else refused IN WORDS (CdfError)
  2     a STOFS point found at its gauge by the gauge's id and position; not a mile off, nor another gauge's
  3-3e  the tie to the gauge: by its observations (Lewes 0.81 m, NOAA's NAVD88-MLLW 0.80 m); by NOAA's datums where the
        gauge is down (Fort Point, 1b); a poor fit, one that disagrees with the datums, and one with neither, not used;
        the surge AVERAGED OVER ONE TIDE (the model's tide minutes off the prediction's read -0.28 m at Fort Point)
  4-4b  the planning water: the prediction lowered by the NEGATIVE surge only - never above it - and untouched outside the
        surge's hours
  5-5d  the forecast kept: fetched for its domain, cached whole, read back from the cache without fetching, a corrupt
        download refused and not cached, a cycle too old not used, none looked for before it is published
  6-6e  fetch_water_along: with no cycle held, exactly as before; the real forecast that evening lowered nothing; a
        setdown at Fort Point (gauge down) planned on, and said; at Lewes (surge above the tide) unchanged; a tie not
        answered by the deadline, the prediction
  7-7b  the card's outlook: at Fort Point on the real forecast and on a setdown; with nothing held, NO request to NOAA
  8     the console wiring: the thread started only by main(), the module in BUILD_PY
  9     the water monitor carries the outlook, asks for her domain only at sea, and a failed outlook leaves the level's
        own error clear
  10-10g A BORROWED SURGE (Andy approved it 2026-10-13): a station STOFS has no point at (Seavey Island) takes the nearest
        point's within BORROW_KM (Fort Point's, 2.6 km), worked out against THAT gauge's own prediction - never two
        stations' tides compared; a station STOFS does stand at keeps its own answer, a refused fit never replaced by a
        neighbor's; beyond 5 km, an unknown gauge, no predictions - none, said; the passage's water and the card at New
        Castle with the console's real station list (no Fort Point); the gauge found on NOAA's prediction stations, that
        list kept on disk, a failed read not hammered

    python tests/stofs.py      # exit 0 = pass, 1 = fail   (stdlib only; no network - every NOAA answer is stubbed)
"""
import atexit
import calendar
import inspect
import json
import os
import shutil
import struct
import sys
import tempfile
import time


def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-800:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.environ.get("ASV_APP") or os.path.join(HERE, "..")
sys.path.insert(0, APP)
import stofs as S                                              # noqa: E402
import asv_console as A                                        # noqa: E402

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


print("NOAA STOFS-3D's surge forecast in a passage's planning water:")
FX = os.path.join(HERE, "fixtures")
FCAST = open(os.path.join(FX, "stofs_atl_fcast.nc"), "rb").read()
NCAST = open(os.path.join(FX, "stofs_atl_ncast.nc"), "rb").read()
CO = json.load(open(os.path.join(FX, "stofs_coops.json"), encoding="utf-8"))
G = CO["gauges"]
LEWES, PORTLAND, FORT = "8557380", "8418150", "8423898"
ep = lambda s: calendar.timegm(time.strptime(s, "%Y-%m-%d %H:%M"))
NOW = calendar.timegm((2026, 10, 13, 22, 0, 0))                  # ten hours after the cycle
CYCLE_T = calendar.timegm((2026, 10, 13, 12, 0, 0))
TMP = tempfile.mkdtemp(prefix="asv_stofs_")
atexit.register(shutil.rmtree, TMP, True)     # a crash skips the rmtree at the end (this suite never calls os._exit)


def obs_of(sid, datum, t0, t1):
    return [(ep(t), v) for t, v in G[sid]["obs"] if t0 <= ep(t) <= t1]


def datums_of(sid):
    return dict(G[sid]["datums"]) if sid in G else None


def pred_of(sid):
    return [(ep(t), v) for t, v in G[sid]["pred"]]


# NOAA's harmonic prediction stations, as _tidepred_stations gives them - stubbed for the whole suite so no check reaches
# NOAA or writes the console's charts/ (10g drives the real loader on a temp path)
TIDEPRED = [{"id": sid, "name": G[sid]["name"], "lat": G[sid]["lat"], "lng": G[sid]["lng"]} for sid in (LEWES, PORTLAND, FORT)]
TIDEPRED.append({"id": "8423897", "name": "a decoy 5 km north of Fort Point", "lat": G[FORT]["lat"] + 0.045, "lng": G[FORT]["lng"]})
REAL_TIDEPRED = A._tidepred_stations
A._tidepred_stations = lambda timeout=30.0: TIDEPRED


# ── 1. the station file ───────────────────────────────────────────────────────────────────────────────────────────────
fc, nc = S.read_station_file(FCAST), S.read_station_file(NCAST)
ex = CO["expect"]
check("1. THE STATION FILE READ, AS PUBLISHED: five stations, the forecast's 96 hours from 13:00 and the nowcast's 24 before "
      "the cycle, every name, place and Lewes level as the real 2026-10-13 12z file has them",
      lambda: fc.names == ex["fcast"]["names"] and len(fc.times) == ex["fcast"]["n"] == 96 and fc.times[0] == ex["fcast"]["t0"]
      and fc.times[-1] == ex["fcast"]["t1"] and len(nc.times) == 24 and all(abs(a - b) < 1e-4 for a, b in zip(fc.lat, ex["fcast"]["lat"]))
      and list(fc.level(0)[0]) == ex["fcast"]["lewes_first"] and list(nc.level(0)[-1]) == ex["ncast"]["lewes_last"],
      lambda: "%s; %d + %d times; Lewes first %s" % (fc.names, len(fc.times), len(nc.times), fc.level(0)[0]))


def refused(blob):
    try:
        S.read_station_file(blob)
    except S.CdfError as e:
        return str(e)
    except Exception as e:                                      # anything but CdfError is the failure
        return "WRONG EXCEPTION %s: %s" % (type(e).__name__, e)
    return None


bad = {
    "truncated in its header": FCAST[:60],
    "truncated in its data": FCAST[:-10],
    "not netCDF": b"\x89HDF\r\n\x1a\n" + FCAST[8:],
    "still being written": FCAST[:4] + b"\xff\xff\xff\xff" + FCAST[8:],
    "time in parsecs": FCAST.replace(b"seconds since", b"parsecs since"),
    "zeta in feet": FCAST.replace(struct.pack(">II", 2, 1) + b"m", struct.pack(">II", 2, 1) + b"f"),
}
why = {k: refused(v) for k, v in bad.items()}
check("1b. ANYTHING ELSE IS REFUSED IN WORDS - a file cut short in its header or its data, one that is not classic netCDF, "
      "one still being written, time it cannot read, a level not in meters: each a CdfError saying what it met, none another "
      "exception",
      lambda: all(w and not w.startswith("WRONG") for w in why.values()),
      lambda: json.dumps(why))
check("1c. ... and a level the file marks as none (a fill value, or one no water reaches) is None, never a number",
      lambda: S.read_station_file(FCAST.replace(struct.pack(">f", fc.level(0)[0][1]), struct.pack(">f", 9.96921e36), 1)).level(0)[0][1] is None)

# ── 2. a gauge's point ─────────────────────────────────────────────────────────────────────────────────────────────────
g = lambda sid: (G[sid]["lat"], G[sid]["lng"])
check("2. A STOFS POINT IS FOUND AT ITS GAUGE - by the first digits of the gauge's id AND its place: Lewes, Portland and Fort "
      "Point found; not 5 km off; not under another gauge's id at Lewes",
      lambda: fc.find(LEWES, *g(LEWES)) == 0 and fc.find(PORTLAND, *g(PORTLAND)) == 1 and fc.find(FORT, *g(FORT)) == 2
      and fc.find(LEWES, g(LEWES)[0] + 0.05, g(LEWES)[1]) is None and fc.find(PORTLAND, *g(LEWES)) is None,
      lambda: [fc.find(s, *g(s)) for s in (LEWES, PORTLAND, FORT)])

# ── 3. the tie ─────────────────────────────────────────────────────────────────────────────────────────────────────────
M = S.Stofs(os.path.join(TMP, "m"), fetch=lambda u: None, now=lambda: NOW)
M._held["atl"] = {"cycle": "20261013", "t": CYCLE_T, "fcast": fc, "ncast": nc}
tL, serL, _h = M.tie_for(LEWES, "MLLW", *g(LEWES), obs_of, datums_of, NOW)
tF, serF, _h2 = M.tie_for(FORT, "MLLW", *g(FORT), obs_of, datums_of, NOW)
dL = G[LEWES]["datums"]["NAVD88"] - G[LEWES]["datums"]["MLLW"]
dF = G[FORT]["datums"]["NAVD88"] - G[FORT]["datums"]["MLLW"]
check("3. TIED BY ITS OBSERVATIONS where the gauge reports: Lewes over the 27 hours both cover, at +0.81 m - NOAA's own "
      "NAVD88-MLLW there is +0.80 m, so STOFS writes NAVD88 - tracking them to under 0.05 m",
      lambda: tL and tL["how"] == "observed" and abs(tL["offset"] - 0.811) < 0.005 and tL["rms"] < 0.05 and tL["n"] == 27
      and abs(tL["offset"] - dL) < 0.02,
      lambda: "%s; NOAA's NAVD88-MLLW %.3f" % (tL, dL))
check("3b. TIED BY NOAA'S DATUMS WHERE THE GAUGE IS DOWN (1b): Fort Point, no observation in the day, at NOAA's NAVD88-MLLW "
      "+1.524 m",
      lambda: tF and tF["how"] == "datum" and abs(tF["offset"] - dF) < 1e-9 and abs(dF - 1.524) < 0.001 and tF["n"] == 0,
      lambda: "%s" % tF)
noisy = {t: v + (0.6 if (t // 3600) % 2 else -0.6) for t, v in [(t, z + 0.81) for t, z in serL if z is not None]}
far = {t: z + 0.81 + 0.4 for t, z in serL if z is not None}
check("3c. NOT USED WHEN IT IS NOT A FIT: a series tracking the gauge worse than FIT_MAX_RMS_M; one tied 0.40 m from NOAA's "
      "datums (AGREE_M 0.25); one with neither observations nor datums - each refused, and said why",
      lambda: "tracks the gauge" in S.tie(serL, noisy, dL).get("note", "") and "from NOAA's datums" in S.tie(serL, far, dL).get("note", "")
      and "no NOAA datums" in S.tie(serL, {}, None).get("note", ""),
      lambda: [S.tie(serL, noisy, dL), S.tie(serL, far, dL), S.tie(serL, {}, None)])
calls = {"obs": 0}


def counting_obs(*a):
    calls["obs"] += 1
    return obs_of(*a)


M._ties.clear()
M.tie_for(LEWES, "MLLW", *g(LEWES), counting_obs, datums_of, NOW)
M.tie_for(LEWES, "MLLW", *g(LEWES), counting_obs, datums_of, NOW + 600)
M.tie_for(LEWES, "MLLW", *g(LEWES), counting_obs, datums_of, NOW + S.ANCHOR_TTL_S + 1)
check("3d. ... and a tie is worked out once per ANCHOR_TTL_S, not on every read",
      lambda: calls["obs"] == 2, lambda: "%d observation reads for three asks" % calls["obs"])
predF = dict(pred_of(FORT))
rawF = [z + tF["offset"] - predF[t] for t, z in serF if z is not None and t in predF]
sgF = S.surge(serF, tF["offset"], predF)
sgL = S.surge(serL, tL["offset"], dict(pred_of(LEWES)))
dip = [z + tF["offset"] - predF[t] for t, z in serF if t == calendar.timegm((2026, 10, 14, 2, 0, 0))]
check("3e. THE SURGE IS AVERAGED OVER ONE TIDE: at Fort Point the hour-by-hour difference from the prediction runs from "
      "-0.28 m (02:00 UTC on the 14th, a rising tide, between +0.33 and +0.18 m - the model's tide minutes off the "
      "prediction's) to +0.66 m; averaged over 13 h it is +0.20 to +0.41 m, and at Lewes +0.19 to +0.31 m (its gauge read "
      "0.27 m over its prediction that evening) - no hour of either below the tide",
      lambda: abs(dip[0] + 0.28) < 0.006 and min(rawF) < -0.27 and abs(min(s for _t, s in sgF) - 0.20) < 0.01
      and abs(max(s for _t, s in sgF) - 0.41) < 0.01 and min(s for _t, s in sgL) > 0.18 and len(sgF) == len(rawF),
      lambda: "raw %.2f..%.2f; averaged %.2f..%.2f; Lewes %.2f..%.2f" % (min(rawF), max(rawF), min(s for _t, s in sgF),
                                                                     max(s for _t, s in sgF), min(s for _t, s in sgL), max(s for _t, s in sgL)))

# ── 4. the planning water ──────────────────────────────────────────────────────────────────────────────────────────────
pred = [(NOW + i * 360, 1.0) for i in range(0, 61)]              # six hours at 1.0 m
sg = [(NOW + 3600, -0.30), (NOW + 2 * 3600, 0.20), (NOW + 3 * 3600, -0.10), (NOW + 4 * 3600, 0.0)]
low = S.lower_by_surge(pred, sg)
at = dict(low)
check("4. THE PREDICTION LOWERED BY THE NEGATIVE SURGE ONLY - never above it anywhere; -0.30 m at the hour it is; a positive "
      "surge leaves it; between hours the surge interpolated (half way from -0.30 to +0.20 is -0.05); outside the surge's "
      "hours untouched",
      lambda: all(v <= p + 1e-12 for (_e, v), (_e2, p) in zip(low, pred)) and abs(at[NOW + 3600] - 0.70) < 1e-9
      and at[NOW + 2 * 3600] == 1.0 and abs(at[NOW + 5400] - 0.95) < 1e-9 and at[NOW] == 1.0 and at[NOW + 5 * 3600] == 1.0,
      lambda: {k: round(at[k], 3) for k in (NOW, NOW + 3600, NOW + 5400, NOW + 7200, NOW + 5 * 3600)})
check("4b. ... and with fewer than two surge hours, the prediction as it is",
      lambda: S.lower_by_surge(pred, sg[:1]) == pred and S.lower_by_surge(pred, []) == pred)

# ── 5. the forecast kept ───────────────────────────────────────────────────────────────────────────────────────────────
fetched = []


def fake_fetch(url):
    fetched.append(url.rsplit("/", 1)[-1])
    if "stofs_3d_atl.20261013/stofs_3d_atl.t12z.fcast.station.profile.nc" in url:
        return FCAST
    if "stofs_3d_atl.20261013/stofs_3d_atl.t12z.ncast.station.profile.nc" in url:
        return NCAST
    return None                                                    # every other key: not there (404)


D = os.path.join(TMP, "cache")
M5 = S.Stofs(D, fetch=fake_fetch, now=lambda: NOW)
ok5 = M5.refresh("atl")
h5, _w = M5.held(*g(LEWES))
cached = sorted(os.listdir(D)) if os.path.isdir(D) else []
check("5. FETCHED FOR ITS DOMAIN: the newest cycle out (2026-10-13 12z, published by 17z) read and held, both files cached "
      "whole under the cycle's name, no .part left",
      lambda: ok5 and h5 and h5["cycle"] == "20261013" and cached == ["atl_20261013_t12z_fcast.nc", "atl_20261013_t12z_ncast.nc"]
      and fetched[:2] == ["stofs_3d_atl.t12z.fcast.station.profile.nc", "stofs_3d_atl.t12z.ncast.station.profile.nc"],
      lambda: "held %s; cache %s; fetched %s" % (h5 and h5["cycle"], cached, fetched))


def no_fetch(url):
    raise AssertionError("fetched %s" % url)


M5b = S.Stofs(D, fetch=no_fetch, now=lambda: NOW)
woke = []
M5b.on_new = lambda: woke.append(1)
ok5b = M5b.refresh("atl")
ok5b2 = M5b.refresh("atl")
check("5b. A NEW START READS IT FROM THE CACHE - no fetch at all - and a cycle newly held wakes the console's water pass "
      "(on_new) once, not again for the same cycle",
      lambda: ok5b and ok5b2 and M5b.held(*g(LEWES))[0]["cycle"] == "20261013" and woke == [1],
      lambda: "woke %d time(s)" % len(woke))
D2 = os.path.join(TMP, "cache2")
M5c = S.Stofs(D2, fetch=lambda u: (FCAST[:-40] if "fcast" in u else None), now=lambda: NOW)
ok5c = M5c.refresh("atl")
check("5c. A CORRUPT DOWNLOAD IS REFUSED AND NOT CACHED - nothing held, the refusal said",
      lambda: not ok5c and M5c.held(*g(LEWES))[0] is None and (not os.path.isdir(D2) or not os.listdir(D2))
      and "refused" in (M5c.held(*g(LEWES))[1] or ""),
      lambda: "held %s; note %s" % (M5c.held(*g(LEWES))[0], M5c.held(*g(LEWES))[1]))
early = S.Stofs(D, fetch=no_fetch, now=lambda: CYCLE_T + 3600).candidates()
check("5d. A CYCLE TOO OLD IS NOT USED, AND NONE IS LOOKED FOR BEFORE IT IS OUT: 40 h after its hour the held cycle reads as "
      "too old, said; at 13z the newest looked for is the day before's",
      lambda: M5.held(*g(LEWES), now=CYCLE_T + 40 * 3600)[0] is None and "40 h old" in M5.held(*g(LEWES), now=CYCLE_T + 40 * 3600)[1]
      and early and early[0][0] == "20261012" and S.region_of(33.7, -118.3) == "pac" and S.region_of(*g(LEWES)) == "atl"
      and S.region_of(0.0, -30.0) is None,
      lambda: "candidates at 13z %s" % early)

# ── 6. fetch_water_along ──────────────────────────────────────────────────────────────────────────────────────────────
STATIONS = [{"id": sid, "name": G[sid]["name"], "lat": G[sid]["lat"], "lng": G[sid]["lng"], "gl": False} for sid in (LEWES, FORT)]
co = {"n": 0}
SLOW = set()


def fake_series(sid, datum, product, begin, end, interval=None, timeout=15.0):
    co["n"] += 1
    if sid in SLOW and product == "water_level":
        time.sleep(1.5)
    b, z = calendar.timegm(time.strptime(begin, "%Y%m%d %H:%M")), calendar.timegm(time.strptime(end, "%Y%m%d %H:%M"))
    rows = G[sid]["pred"] if product == "predictions" else G[sid]["obs"]
    out = [{"t": t, "v": v} for t, v in rows if b <= ep(t) <= z]
    return {"ok": True, "series": out} if out else {"ok": False, "note": "no %s data" % product}


A._load_water_stations = lambda: STATIONS
A._coops_series = fake_series
A._stofs_datums = datums_of
real_time = time.time


def water(points, t0, t1, holder):
    A._water_pred.clear()
    A.STOFS = holder
    return A.fetch_water_along(points, t0, t1)


FPT = (43.072, -70.705)                                          # off Fort Point
W0, W1 = calendar.timegm((2026, 10, 14, 0, 0, 0)), calendar.timegm((2026, 10, 14, 4, 0, 0))
inert = S.Stofs(os.path.join(TMP, "inert"), fetch=no_fetch, now=lambda: NOW)
base = water([FPT], W0, W1, inert)
keep = A._stofs_lowered
A._stofs_lowered = lambda *a: ({}, None)
before = water([FPT], W0, W1, inert)
A._stofs_lowered = keep
check("6. WITH NO STOFS CYCLE HELD, EXACTLY AS BEFORE: the answer is the one the console gave without STOFS - no `stofs`, no "
      "`src`, the same lowest water - and nothing was asked of NOAA for it",
      lambda: base == before and "stofs" not in base and all("src" not in p for p in base["points"]),
      lambda: "low %s at %s" % (base.get("low_m"), base.get("t")))
held = S.Stofs(os.path.join(TMP, "held"), fetch=no_fetch, now=lambda: NOW)
held._held["atl"] = {"cycle": "20261013", "t": CYCLE_T, "fcast": fc, "ncast": nc}
fpReal = water([FPT], W0, W1, held)
check("6e. THE REAL FORECAST THAT EVENING LOWERS NOTHING AT FORT POINT: its surge ran over the tide, so the window is planned "
      "on the prediction exactly - the tide-timing dip at 02:00 does not reach the plan - the station still named as asked",
      lambda: fpReal["low_m"] == base["low_m"] and "src" not in fpReal["points"][0] and fpReal["stofs"]["used"] == [FORT],
      lambda: "%s vs %s; %s" % (fpReal["low_m"], base["low_m"], fpReal.get("stofs")))


def setdown(sf, k, by):
    """`sf` with station k's level `by` meters lower at every hour - a sustained setdown the real evening did not have."""
    return S.StationFile(sf.names, sf.lat, sf.lon, sf.times, [row[:k] + [None if row[k] is None else row[k] - by] + row[k + 1:]
                                                              for row in sf._zeta])


down = S.Stofs(os.path.join(TMP, "down"), fetch=no_fetch, now=lambda: NOW)
down._held["atl"] = {"cycle": "20261013", "t": CYCLE_T, "fcast": setdown(fc, 2, 0.6), "ncast": setdown(nc, 2, 0.6)}
fp = water([FPT], W0, W1, down)
p0 = fp["points"][0]
check("6b. A SETDOWN AT FORT POINT, ITS GAUGE DOWN (1b) - the forecast 0.6 m lower at every hour: the window planned on it, "
      "between 0.15 and 0.45 m under the tide prediction's own lowest (its surge averaged over the tide: -0.40 to -0.19 m), the "
      "point marked src 'stofs' with the prediction's low beside it, the answer naming the cycle and the station",
      lambda: p0.get("src") == "stofs" and 0.15 < p0["tide_low_m"] - p0["low_m"] < 0.45 and abs(p0["tide_low_m"] - base["low_m"]) < 1e-9
      and fp["low_m"] == p0["low_m"] and fp["stofs"]["cycle"] == "20261013" and fp["stofs"]["used"] == [FORT],
      lambda: "planned %s, the prediction's %s; %s" % (p0.get("low_m"), p0.get("tide_low_m"), fp.get("stofs")))
LPT = (38.79, -75.11)
lw0 = water([LPT], W0, W1, inert)
lw = water([LPT], W0, W1, held)
check("6c. AT LEWES, WHERE STOFS RUNS ABOVE THE TIDE, NOTHING CHANGES: the same lowest water as without it, no `src` - a "
      "surge above the tide never raises the planning water",
      lambda: lw["low_m"] == lw0["low_m"] and "src" not in lw["points"][0] and lw["stofs"]["used"] == [LEWES],
      lambda: "%s vs %s; %s" % (lw["low_m"], lw0["low_m"], lw.get("stofs")))
SLOW.add(FORT)
slow = S.Stofs(os.path.join(TMP, "slow"), fetch=no_fetch, now=lambda: NOW)
slow._held["atl"] = dict(held._held["atl"])
dl = A.STOFS_ALONG_DEADLINE_S
A.STOFS_ALONG_DEADLINE_S = 0.5
A._stofs_datums = lambda sid: None                               # so the tie waits on the (slow) observations alone
t_start = real_time()
sl = water([FPT], W0, W1, slow)
took = real_time() - t_start
A.STOFS_ALONG_DEADLINE_S = dl
A._stofs_datums = datums_of
SLOW.clear()
check("6d. A TIE NOT ANSWERED BY THE DEADLINE: the station planned on its prediction, as before, and said - the answer not "
      "held back for it",
      lambda: sl["low_m"] == base["low_m"] and "src" not in sl["points"][0] and "not answered" in sl["stofs"]["notes"].get(FORT, "")
      and took < 1.4,
      lambda: "low %s in %.2f s; %s" % (sl["low_m"], took, sl.get("stofs")))

# ── 7. the card's outlook ──────────────────────────────────────────────────────────────────────────────────────────────
A.STOFS = held
A._water_pred.clear()
res = {"ok": True, "station": FORT, "datum": "MLLW"}
o = A.surge_outlook(res, now=NOW)
A.STOFS = down
A._water_pred.clear()
od = A.surge_outlook(res, now=NOW)
check("7. THE CARD'S OUTLOOK AT FORT POINT, next 24 h: on the real forecast the surge runs over the tide all day (lowest about "
      "+0.3 m, highest about +0.4 m); with the setdown, its lowest under it and when; each with the cycle's age and how it was "
      "tied (NOAA's datums - the gauge is down)",
      lambda: o["ok"] and 0.25 < o["low_m"] < 0.35 and 0.35 < o["high_m"] < 0.45 and o["cycle"] == "20261013" and o["age_h"] == 10.0
      and o["how"] == "datum" and o["station"] == FORT and od["ok"] and -0.45 < od["low_m"] < -0.15
      and NOW <= od["low_t"] <= NOW + A.STOFS_OUTLOOK_S,
      lambda: "real %s; setdown low %s at %s" % (json.dumps(o), od.get("low_m"), od.get("low_t")))
co["n"] = 0
A.STOFS = inert
A._water_pred.clear()                                 # (or a request for predictions would be answered from the cache)
o2 = A.surge_outlook(res, now=NOW)
A._load_water_stations = lambda: [dict(STATIONS[0], gl=True)]
o3 = A.surge_outlook({"ok": True, "station": LEWES, "datum": "LWD"}, now=NOW)
A._load_water_stations = lambda: STATIONS
check("7b. WITH NOTHING HELD, NO REQUEST TO NOAA: the outlook says the forecast is not loaded and asked nothing; on a Great "
      "Lake, no surge to forecast",
      lambda: not o2["ok"] and "not loaded" in o2["note"] and co["n"] == 0 and not o3["ok"] and "no tide" in o3["note"],
      lambda: "%s; %d requests; %s" % (o2, co["n"], o3))
SEAVEY = {"id": "8419870", "name": "Seavey Island", "lat": 43.0800, "lng": -70.7417, "gl": False}
A._load_water_stations = lambda: STATIONS + [SEAVEY]
G["8419870"] = {"pred": G[FORT]["pred"], "obs": [], "datums": {}}   # predictions, but no STOFS point there
A.STOFS = held
A._water_pred.clear()
oc = A.surge_outlook({"ok": True, "station": "8419870", "datum": "MLLW"}, now=NOW, pos=(43.0726, -70.7103))
A._load_water_stations = lambda: STATIONS
check("7c. THE NEAREST STATION STOFS FORECASTS: at New Castle the level's own station was Seavey Island (Fort Point's gauge "
      "was down) and STOFS has no point there - the card's surge is Fort Point's, 0.1 km from her, tied by NOAA's datums",
      lambda: oc["ok"] and oc["station"] == FORT and oc["km"] < 0.5 and oc["how"] == "datum",
      lambda: json.dumps(oc))

# ── 8. the console wiring ──────────────────────────────────────────────────────────────────────────────────────────────
import re                                                       # noqa: E402
main_src = inspect.getsource(A.main) if hasattr(A, "main") else ""
starts = bool(re.search(r"^\s*STOFS\.start\(\)", main_src, re.M))   # a STATEMENT, not the words in a comment
check("8. THE THREAD IS STARTED ONLY BY THE CONSOLE'S main() - an import fetches nothing - and the module is in BUILD_PY, so "
      "a changed stofs.py says RESTART CONSOLE and the copied consoles of build_id / state_dir carry it",
      lambda: starts and A.STOFS is not None and "stofs.py" in A.BUILD_PY and inert._thread is None and held._thread is None,
      lambda: "main starts it: %s; BUILD_PY %s" % (starts, A.BUILD_PY))

# ── 9. the water monitor's half of item 2 ──────────────────────────────────────────────────────────────────────────────
class _Wants:
    def __init__(self):
        self.asked = []

    def wants(self, lat, lon):
        self.asked.append((lat, lon))


W = A.WaterLevel()                                    # its own thread idles with no position
keep_out, keep_st = A.surge_outlook, A.STOFS
A.STOFS = rec = _Wants()
A.surge_outlook = lambda res, now=None, pos=None: {"ok": True, "low_m": -0.2, "station": res.get("station")}
W._last = {"ok": True, "station": FORT, "datum": "MLLW", "offset_m": 0.4, "t": "2026-10-13 21:54"}
W._surge_pass((43.07, -70.70))
snap_ok = W.snapshot()
W._last = {"ok": True, "station": "9063020", "datum": "LWD", "lake": "erie", "offset_m": 0.3, "t": "2026-10-13 21:54"}
W._surge_pass((42.2, -80.1))
asked_lake = list(rec.asked)


def _boom(res, now=None, pos=None):
    raise ValueError("a STOFS read went wrong")


A.surge_outlook = _boom
W._last = {"ok": True, "station": FORT, "datum": "MLLW", "offset_m": 0.4, "t": "2026-10-13 21:54"}
W._surge_pass((43.07, -70.70))
snap_bad = W.snapshot()
A.surge_outlook, A.STOFS = keep_out, keep_st
check("9. THE WATER MONITOR CARRIES THE OUTLOOK: its snapshot holds the surge the pass computed; it asks the STOFS thread for "
      "her domain at sea and never on a Great Lake; and an outlook that fails is said on the SURGE row alone - the LEVEL's "
      "monitor_error stays clear and the level stands",
      lambda: snap_ok["surge"] == {"ok": True, "low_m": -0.2, "station": FORT} and asked_lake == [(43.07, -70.70)]
      and not snap_bad["surge"]["ok"] and "a STOFS read went wrong" in snap_bad["surge"]["note"]
      and snap_bad["monitor_error"] is None and snap_bad["offset_m"] == 0.4,
      lambda: "ok %s; asked %s; bad %s (monitor_error %s)" % (snap_ok["surge"], asked_lake, snap_bad["surge"], snap_bad["monitor_error"]))

# ── 10. a borrowed surge ───────────────────────────────────────────────────────────────────────────────────────────────
SEA = "8419870"
SEA_AT = (43.0800, -70.7417)
# Seavey Island's own tide: Fort Point's half an hour later and 0.10 m higher - a different tide, so a surge worked out
# against IT (two stations' tides compared) would read about 0.10 m off the one worked out at Fort Point
sea_pred = [(time.strftime("%Y-%m-%d %H:%M", time.gmtime(ep(t) + 1800)), v + 0.10) for t, v in G[FORT]["pred"]]
G[SEA] = {"name": "Seavey Island", "lat": SEA_AT[0], "lng": SEA_AT[1], "pred": sea_pred, "obs": [], "datums": {}}
resolve = A._stofs_gauge
own_fp, own_meta = down.surge_at(FORT, "MLLW", *g(FORT), pred_of(FORT), obs_of, datums_of, NOW)
bsg, bmeta = down.surge_borrowed(SEA, "MLLW", *SEA_AT, pred_of(SEA), obs_of, datums_of, resolve, lambda gid, dt: pred_of(gid), NOW)
ser_dn, _hd = down.series(FORT, *g(FORT), NOW)
across = dict(S.surge(ser_dn, own_meta["offset_m"], dict(pred_of(SEA))))
both = [t for t, _s in bsg or [] if t in across]
gap = sum(s - across[t] for t, s in bsg if t in across) / len(both) if len(both) > 24 else None   # mean: ~ +0.10
check("10. SEAVEY ISLAND BORROWS FORT POINT'S SURGE: STOFS has no point at Seavey Island; Fort Point's, 2.6 km off, is within "
      "BORROW_KM - the surge is Fort Point's own, worked out against FORT POINT's prediction and tie (NOAA's datums, its "
      "gauge down), hour for hour; NOT against Seavey Island's tide (that would read 0.10 m off); the answer naming both",
      lambda: bsg == own_fp and bmeta["from_id"] == FORT and bmeta["from_name"] == G[FORT]["name"] and 2.3 < bmeta["from_km"] < 2.9
      and bmeta["how"] == "datum" and gap is not None and 0.07 < gap < 0.13 and fc.find(SEA, *SEA_AT) is None,
      lambda: "from %s %s at %s km, %s; %d hours; vs Seavey's own tide %s m apart on average" % (
          bmeta.get("from_id"), bmeta.get("from_name"), bmeta.get("from_km"), bmeta.get("how"), len(bsg or []), gap))
# a station STOFS DOES stand at, whose own tie is refused, with another point nearer it than its own
X = "8423901"
fx = fc.lat[2], fc.lon[2] + 0.5 / 81.4                           # 0.5 km east of Fort Point's point
syn_f = S.StationFile(fc.names + ["842390"], fc.lat + [fx[0]], fc.lon + [fx[1] + 1.5 / 81.4], fc.times,
                      [row + [row[2]] for row in fc._zeta])        # its own point 1.5 km further east
syn = S.Stofs(os.path.join(TMP, "syn"), fetch=no_fetch, now=lambda: NOW)
syn._held["atl"] = {"cycle": "20261013", "t": CYCLE_T, "fcast": syn_f, "ncast": None}
xsg, xwhy = syn.surge_borrowed(X, "MLLW", *fx, pred_of(FORT), obs_of, datums_of, resolve, lambda gid, dt: pred_of(gid), NOW)
check("10b. A STATION STOFS STANDS AT KEEPS ITS OWN ANSWER: its own point 1.5 km off, its tie refused (no observations, no "
      "datums), Fort Point's point nearer it at 0.5 km and tied - nothing borrowed, its own refusal said",
      lambda: xsg is None and "no NOAA datums" in str(xwhy) and syn_f.find(X, *fx) == 5 and syn_f.nearest(*fx, S.BORROW_KM)[1] == 2,
      lambda: "%s; own point %s, nearest %s" % (xwhy, syn_f.find(X, *fx), syn_f.nearest(*fx, S.BORROW_KM)))
far_at = (SEA_AT[0] + 0.06, SEA_AT[1])                           # 6.7 km north of Fort Point's point
fsg, fwhy = down.surge_borrowed(SEA, "MLLW", *far_at, pred_of(SEA), obs_of, datums_of, resolve, lambda gid, dt: pred_of(gid), NOW)
nsg, nwhy = down.surge_borrowed(SEA, "MLLW", *SEA_AT, pred_of(SEA), obs_of, datums_of, lambda n, la, lo: None,
                                lambda gid, dt: pred_of(gid), NOW)


def _raises(*a):
    raise OSError("NOAA unreachable")


rsg, rwhy = down.surge_borrowed(SEA, "MLLW", *SEA_AT, pred_of(SEA), obs_of, datums_of, _raises, lambda gid, dt: pred_of(gid), NOW)
psg, pwhy = down.surge_borrowed(SEA, "MLLW", *SEA_AT, pred_of(SEA), obs_of, datums_of, resolve, lambda gid, dt: None, NOW)
p2sg, p2why = down.surge_borrowed(SEA, "MLLW", *SEA_AT, pred_of(SEA), obs_of, datums_of, resolve, _raises, NOW)
check("10c. NONE TO BORROW, SAID: no point within 5 km; a point that matches no NOAA tide station (or the lookup failing); "
      "its gauge with no predictions (or the read failing) - each None with why, none raised",
      lambda: fsg is None and "within 5 km" in fwhy and nsg is None and "matches no NOAA tide station" in nwhy and rsg is None
      and "matches no NOAA tide station" in rwhy and psg is None and "no predictions at %s" % FORT in pwhy and p2sg is None
      and "no predictions" in p2why,
      lambda: [fwhy, nwhy, rwhy, pwhy, p2why])
check("10d. THE GAUGE A POINT STANDS AT, FOUND BY NUMBER AND PLACE: '842389' at Fort Point's point is 8423898 (0.3 km); the "
      "decoy 8423897, its number but 5 km off, is not; a number no station carries, nothing",
      lambda: resolve("842389", fc.lat[2], fc.lon[2])["id"] == FORT and resolve("842389", G[FORT]["lat"] + 0.045, G[FORT]["lng"])["id"] == "8423897"
      and resolve("842389", G[FORT]["lat"] + 0.0225, G[FORT]["lng"]) is None and resolve("999999", fc.lat[2], fc.lon[2]) is None,
      lambda: [resolve("842389", fc.lat[2], fc.lon[2]), resolve("842389", G[FORT]["lat"] + 0.0225, G[FORT]["lng"])])
REAL_LIST = [{"id": LEWES, "name": G[LEWES]["name"], "lat": G[LEWES]["lat"], "lng": G[LEWES]["lng"], "gl": False},
             {"id": SEA, "name": "Seavey Island", "lat": SEA_AT[0], "lng": SEA_AT[1], "gl": False}]   # no Fort Point
A._load_water_stations = lambda: REAL_LIST
SPT = (43.078, -70.735)                                          # in the river off Seavey Island
sb0 = water([SPT], W0, W1, inert)
sb = water([SPT], W0, W1, down)
sbr = water([SPT], W0, W1, held)
q0 = sb["points"][0]
check("10e. A PASSAGE OFF NEW CASTLE, ON THE CONSOLE'S OWN STATION LIST (Seavey Island, no Fort Point): with the setdown, the "
      "window planned on Fort Point's surge carried to Seavey Island's tide - between 0.15 and 0.45 m under Seavey's own "
      "lowest - said src 'stofs', the answer naming whose surge it borrowed; on that evening's real forecast nothing lowered "
      "(the surge ran over the tide), the borrow still named",
      lambda: q0.get("src") == "stofs" and abs(q0["tide_low_m"] - sb0["low_m"]) < 1e-9 and 0.15 < q0["tide_low_m"] - q0["low_m"] < 0.45
      and sb["stofs"]["used"] == [SEA] and sb["stofs"]["borrowed"] == {SEA: FORT} and sbr["low_m"] == sb0["low_m"]
      and "src" not in sbr["points"][0] and sbr["stofs"]["borrowed"] == {SEA: FORT},
      lambda: "planned %s vs Seavey's %s; %s; real: %s, %s" % (q0.get("low_m"), sb0.get("low_m"), sb.get("stofs"), sbr.get("low_m"), sbr.get("stofs")))
A.STOFS = down
A._water_pred.clear()
ob = A.surge_outlook({"ok": True, "station": SEA, "datum": "MLLW"}, now=NOW, pos=(43.0726, -70.7103))
A.STOFS = inert
A._load_water_stations = lambda: STATIONS
check("10f. THE CARD AT NEW CASTLE ON THAT LIST: her tide station Seavey Island, its surge Fort Point's (2.6 km from it), "
      "0.1 km from her - the distance to where the surge IS - the setdown's lowest under the tide",
      lambda: ob["ok"] and ob["station"] == SEA and ob["from_id"] == FORT and ob["km"] < 0.5 and 2.3 < ob["from_km"] < 2.9
      and -0.45 < ob["low_m"] < -0.15 and "from_lat" not in ob,
      lambda: json.dumps(ob))
# the real loader of NOAA's prediction stations, on a temp path
TP_CACHE = os.path.join(TMP, "tidepred.json")
keep_cache, keep_open = A.TIDEPRED_STATIONS_CACHE, A.urllib.request.urlopen
A.TIDEPRED_STATIONS_CACHE = TP_CACHE
opened, FAIL = [], {"on": False}


class _Resp:
    def __init__(self, b):
        self.b = b

    def read(self):
        return self.b

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


TP_BODY = json.dumps({"stations": [{"id": "8423898", "name": "Fort Point", "lat": 43.0717, "lng": -70.7117, "type": "R"},
                                   {"id": "8423899", "name": "a subordinate", "lat": 43.08, "lng": -70.72, "type": "S"}]}).encode()


def fake_open(req, timeout=None):
    opened.append(getattr(req, "full_url", str(req)))
    if FAIL["on"]:
        raise OSError("NOAA unreachable")
    return _Resp(TP_BODY)


try:
    A.urllib.request.urlopen = fake_open
    A._tidepred.update(t=0.0, list=None, failed=0.0)
    first = REAL_TIDEPRED()
    n1 = len(opened)
    A._tidepred.update(t=0.0, list=None, failed=0.0)                # a restart: nothing in memory
    second = REAL_TIDEPRED()
    n2 = len(opened)
    old = time.time() - A.TIDEPRED_TTL_S - 60
    os.utime(TP_CACHE, (old, old))
    A._tidepred.update(t=0.0, list=None, failed=0.0)
    third = REAL_TIDEPRED()
    n3 = len(opened)
    os.remove(TP_CACHE)
    A._tidepred.update(t=0.0, list=None, failed=0.0)
    FAIL["on"] = True
    fourth, fifth = REAL_TIDEPRED(), REAL_TIDEPRED()
    n4 = len(opened)
finally:
    A.urllib.request.urlopen = keep_open
    A.TIDEPRED_STATIONS_CACHE = keep_cache
check("10g. NOAA'S PREDICTION STATIONS: read once, the harmonic ones only (a subordinate has no 6-minute predictions), kept "
      "on disk; a restart reads the disk and asks NOAA nothing; a copy older than TIDEPRED_TTL_S read again; NOAA failing, "
      "None - and not asked again on the next call (TIDEPRED_RETRY_S)",
      lambda: first == [{"id": "8423898", "name": "Fort Point", "lat": 43.0717, "lng": -70.7117}] and n1 == 1
      and second == first and n2 == 1 and third == first and n3 == 2 and fourth is None and fifth is None and n4 == 3,
      lambda: "first %s; NOAA asked %s; failing %s/%s" % (first, [n1, n2, n3, n4], fourth, fifth))

shutil.rmtree(TMP, ignore_errors=True)
print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
