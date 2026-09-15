"""tests/reading_age.py - water, weather and current readings do not freeze, and say how old they are
(review #13, 2026-09-14).

THE DEFECT. The water level, the weather (NDBC buoys) and the surface current are each kept by a
background monitor whose loop had no handler: one exception in a pass ended its thread, and the
reading froze at whatever it last held - still marked ok, with nothing on it to say when it was
taken. The water level is the one that matters: the page adds it to every charted depth, so a
frozen high-water level went on crediting the boat with water the tide had taken away. It is not
hypothetical - `_coops_get` catches OSError and ValueError, and an `http.client.IncompleteRead`
(a connection cut mid-body, ordinary on a satellite link) is neither: it came up through
fetch_water_level and ended the thread (reproduced with the old loop before the fix).

THE CONTRACTS, in-process, with each monitor's fetch stubbed and its poll shortened:
  * a pass that raises does not end the monitor: the failure rides the snapshot as
    `monitor_error`, the last good reading is KEPT (and ages), and the next pass that completes
    takes the new reading and clears the error; the failure is printed once, not every pass;
  * the water level's `age_s` is measured from the reading's OWN time (CO-OPS' GMT `t`), not
    from when the console fetched it; a manual override and a failed reading have none;
  * the weather's `age_s` is its OLDEST contributing buoy observation, read off the NDBC row;
  * the current is a forecast for NOW, so it is recomputed from the cached cycle every
    SAMPLE_S, while the cycle itself is looked for every POLL_S (or at once when forced) - and
    when no cycle can be had, the reading says WHY rather than "no cycle cached yet".
The page half - a stale water level is not applied to charted depths, and every row says its
age - is tests/water_trust.js 16-21 and tests/reading_age.js.

    python tests/reading_age.py     # exit 0 = pass, 1 = fail   (stdlib only)

TEETH - 17 mutations RUN in a scratch clone on the final code, 17/17 caught, none by a crash (recorded results):
  * a raising pass ends the monitor again (no handler)    -> caught by 2, 3, 4, 5, 7, 11
  * the monitor's error never cleared                     -> caught by 3, 7, 11
  * the failure printed on every failing pass             -> caught by 3
  * the water level aged from its fetch, not its own time -> caught by 1, 3
  * a manual override given an age                        -> caught by 4
  * a failed reading given an age                         -> caught by 5
  * a cut connection raises out of _coops_get again       -> caught by 3b
  * a damaged station cache raises again                  -> caught by 3c
  * the weather aged from its NEWEST buoy                 -> caught by 6, 7
  * a manual weather override given an age                -> caught by 8
  * the current sampled only every POLL_S again           -> caught by 9, 12
  * a forced refresh waits for the next POLL_S            -> caught by 10
  * the cycle looked for on every sample                  -> caught by 9
  * the no-cycle reason overwritten again                 -> caught by 12
  * the reason kept only on the pass that looked          -> caught by 12 (the first version of the fix; seen live)
  * the current's sample time never set                   -> caught by 9, 12
  * the water loop bypasses _monitor_pass                 -> caught by 2, 3, 4, 5
"""

import calendar
import http.client
import io
import os
import sys
import time

# --- crash guard: a throw outside a check() must still REPORT ---------------------------
def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))

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


def until(pred, limit=5.0):
    t0 = time.time()
    while time.time() - t0 < limit:
        if pred():
            return True
        time.sleep(0.01)
    return False


print("Water, weather and current readings do not freeze, and say how old they are:")

# The console module, pointed at a temp state folder before anything reads one (review #16).
from console_state import ConsoleState  # noqa: E402
STATE = ConsoleState()
import asv_console as A  # noqa: E402
A.use_state_dir(STATE.dir)

err = io.StringIO()
real_err = sys.stderr
sys.stderr = err                    # what the monitors print about their failures


def gmt(offset_s):
    return time.strftime("%Y-%m-%d %H:%M", time.gmtime(time.time() + offset_s))


try:
    # ── 1-5. THE WATER LEVEL ────────────────────────────────────────────────────────────
    feed = {"mode": "good", "offset": 1.0, "t": gmt(-11 * 60)}

    def fake_water(lat, lon, timeout=15.0):
        if feed["mode"] == "raise":
            raise KeyError("lng")          # a station entry with no longitude, as a damaged list would give
        return {"ok": True, "offset_m": feed["offset"], "t": feed["t"], "station": "8410140",
                "name": "Eastport", "dist_km": 1.2, "stations": [{"id": "8410140", "dist_km": 1.2}]}

    A.fetch_water_level = fake_water

    class FastWater(A.WaterLevel):
        POLL_S = 0.05

    W = FastWater()
    W.update_position(44.9, -66.98)
    got = until(lambda: W.snapshot().get("offset_m") == 1.0)
    s = W.snapshot()
    check("1. a water reading is aged from its OWN time - CO-OPS' t, 11 minutes back - not from when it was fetched",
          lambda: got and s.get("age_s") is not None and 660 <= s["age_s"] < 720 and s.get("monitor_error") is None,
          "age_s=%s (t %s); monitor_error=%s" % (s.get("age_s"), feed["t"], s.get("monitor_error")))

    fetched0 = W.snapshot().get("fetched_at")
    feed["mode"] = "raise"
    failing = until(lambda: W.snapshot().get("monitor_error"))
    time.sleep(0.3)
    s = W.snapshot()
    check("2. a pass that raises does not end the monitor: the error rides the snapshot and the last good reading is "
          "KEPT, not refreshed - its age is what goes on growing",
          lambda: failing and "KeyError" in (s.get("monitor_error") or "") and s.get("offset_m") == 1.0
          and s.get("fetched_at") == fetched0,
          "monitor_error=%s; offset %s; fetched_at unchanged=%s" % (s.get("monitor_error"), s.get("offset_m"),
                                                                    s.get("fetched_at") == fetched0))
    printed = err.getvalue().count("[water] an update failed")
    feed.update(mode="good", offset=2.0, t=gmt(-5 * 60))
    back = until(lambda: W.snapshot().get("offset_m") == 2.0)
    s = W.snapshot()
    check("3. ... and the next pass that completes takes the new reading and clears the error - printed once, not "
          "once a pass",
          lambda: back and s.get("monitor_error") is None and printed == 1 and 300 <= s.get("age_s", -1) < 360,
          "new offset taken=%s; monitor_error=%s; failure printed %d time(s) over %s passes; age_s=%s"
          % (back, s.get("monitor_error"), printed, "many", s.get("age_s")))

    class _CutBody:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self, *a):
            raise http.client.IncompleteRead(b"partial")

    real_urlopen = A.urllib.request.urlopen
    A.urllib.request.urlopen = lambda *a, **k: _CutBody()
    try:
        try:
            cut = A._coops_get("8410140", "MLLW", "water_level")
        except Exception as e:             # the defect itself: reported as a failed check, not a crash
            cut = {"raised": "%s: %s" % (type(e).__name__, e)}
    finally:
        A.urllib.request.urlopen = real_urlopen
    check("3b. a connection cut mid-body - the case that used to end the thread - is a failed fetch said in words, "
          "through the real CO-OPS read, not an exception",
          lambda: cut.get("ok") is False and "IncompleteRead" in (cut.get("note") or ""), "%s" % cut)

    # 3c. A station cache that cannot be read as JSON is fetched again. Only OSError was caught on that read,
    # so a damaged file raised straight up through fetch_water_level. Pointed at a TEMP cache path: the real
    # one lives in the operator's charts/ folder, which no test may write.
    class _Stations:
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def read(self, *a):
            return b'{"stations": [{"id": "8410140", "name": "Eastport", "lat": "44.9", "lng": "-66.98"}]}'

    real_cache, real_list = A.WATER_STATIONS_CACHE, A._water_stations
    A.WATER_STATIONS_CACHE = STATE.path("coops_stations_damaged.json")
    with open(A.WATER_STATIONS_CACHE, "w", encoding="utf-8") as f:
        f.write('[{"id": "8410140", "name": "Eastp')
    A._water_stations = None
    A.urllib.request.urlopen = lambda *a, **k: _Stations()
    try:
        try:
            stations = A._load_water_stations()
            raised = None
        except Exception as e:
            stations, raised = None, "%s: %s" % (type(e).__name__, e)
    finally:
        A.urllib.request.urlopen = real_urlopen
        A.WATER_STATIONS_CACHE, A._water_stations = real_cache, real_list
    check("3c. a station cache that cannot be read as JSON is fetched again rather than raised",
          lambda: raised is None and bool(stations) and stations[0]["id"] == "8410140",
          "raised: %s; stations: %s" % (raised, stations))

    W.set_manual(0.4)
    manual = W.snapshot()
    W.set_manual(None)
    feed.update(t="not a time")
    until(lambda: W.snapshot().get("t") == "not a time")
    bad_t = W.snapshot()
    check("4. a manual override has no age - it is the operator's number - and a reading whose time cannot be read is "
          "aged from when it was fetched",
          lambda: manual.get("source") == "manual" and manual.get("age_s") is None
          and bad_t.get("age_s") is not None and bad_t["age_s"] <= 2,
          "manual age_s=%s; unreadable t -> age_s=%s" % (manual.get("age_s"), bad_t.get("age_s")))

    A.fetch_water_level = lambda lat, lon, timeout=15.0: {"ok": False, "note": "CO-OPS station list unavailable"}
    until(lambda: W.snapshot().get("ok") is False)
    nd = W.snapshot()
    check("5. a failed reading has no age to give",
          lambda: nd.get("ok") is False and nd.get("age_s") is None, "ok=%s age_s=%s" % (nd.get("ok"), nd.get("age_s")))
    W._stop.set()
    W._force.set()

    # ── 6-8. THE WEATHER ────────────────────────────────────────────────────────────────
    now = time.time()
    row = lambda age_min: time.strftime("%Y %m %d %H %M", time.gmtime(now - age_min * 60))
    obs_rows = {"44027": row(20), "PSBM1": row(50), "ATGM1": row(35)}
    A._load_ndbc_stations = lambda timeout=30.0: [
        {"id": "44027", "lat": 44.28, "lon": -67.31}, {"id": "PSBM1", "lat": 44.90, "lon": -66.98},
        {"id": "ATGM1", "lat": 45.17, "lon": -67.32}]

    def fake_http(url, timeout=15.0):
        sid = url.rsplit("/", 1)[-1].split(".")[0]
        return ("#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES\n"
                "#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa\n"
                "%s 240  6.0  8.0   0.8   6.0   4.5 230 1012.0\n" % obs_rows[sid])

    A._env_http_get = fake_http
    env = A.fetch_environment(44.9, -66.98)
    oldest = calendar.timegm(time.strptime(obs_rows["PSBM1"], "%Y %m %d %H %M"))
    check("6. the weather reading carries the time of its OLDEST contributing buoy observation, read off the NDBC row",
          lambda: env.get("ok") and env.get("obs_t") == oldest,
          "obs_t=%s, oldest row %s; stations %s" % (env.get("obs_t"), oldest, [x["id"] for x in env.get("stations", [])]))

    wfeed = {"mode": "good"}

    def fake_env(lat, lon):
        if wfeed["mode"] == "raise":
            raise KeyError("WSPD")
        return env

    A.fetch_environment = fake_env

    class FastEnv(A.EnvMonitor):
        POLL_S = 0.05

    E = FastEnv()
    E.update_position(44.9, -66.98)
    until(lambda: E.snapshot().get("ok"))
    es = E.snapshot()
    wfeed["mode"] = "raise"
    efail = until(lambda: E.snapshot().get("monitor_error"))
    es_fail = E.snapshot()
    wfeed["mode"] = "good"
    eback = until(lambda: E.snapshot().get("monitor_error") is None)
    check("7. the weather is aged from that observation (50 min), and a pass that raises does not end its monitor "
          "either: the error is carried, the reading kept, and it clears on the next good pass",
          lambda: es.get("age_s") is not None and 3000 <= es["age_s"] < 3060 and efail
          and "KeyError" in (es_fail.get("monitor_error") or "") and es_fail.get("wind") and eback,
          "age_s=%s; error carried=%s (%s); reading kept=%s; cleared=%s"
          % (es.get("age_s"), efail, es_fail.get("monitor_error"), bool(es_fail.get("wind")), eback))
    E.set_manual({"wind_kn": 12})
    em = E.snapshot()
    E.set_manual({"clear": True})
    check("8. a manual weather override has no age",
          lambda: em.get("source") == "manual" and em.get("age_s") is None, "age_s=%s" % em.get("age_s"))
    E._stop.set()
    E._force.set()

    # ── 9-12. THE CURRENT ───────────────────────────────────────────────────────────────
    calls = {"ensure": 0, "sample": 0, "raise": False}

    class FastCurrents(A.CurrentsMonitor):
        POLL_S = 0.6
        SAMPLE_S = 0.05

        def _ensure_cycle(self, lat, lon):
            calls["ensure"] += 1
            return None

        def _sample(self, lat, lon):
            calls["sample"] += 1
            if calls["raise"]:
                raise RuntimeError("the cached cycle is unreadable")
            return {"ok": True, "source": "fake", "speed_kn": 1.0, "set_deg": 90.0, "projected_h": 0.0}

    C = FastCurrents()
    C.update_position(44.9, -66.98)
    time.sleep(1.4)
    n_ens, n_smp = calls["ensure"], calls["sample"]
    cs = C.snapshot()
    check("9. the current - a forecast for NOW - is recomputed every SAMPLE_S from the cached cycle, while the cycle "
          "itself is looked for every POLL_S, and its age is since that sample",
          lambda: n_smp >= 12 and 2 <= n_ens <= 4 and cs.get("age_s") is not None and cs["age_s"] <= 1,
          "%d samples and %d cycle lookups in 1.4 s; age_s=%s" % (n_smp, n_ens, cs.get("age_s")))
    before = calls["ensure"]
    C.refresh_now()
    forced = until(lambda: calls["ensure"] > before, 0.3)
    check("10. a forced refresh looks for the cycle at once, not at the next POLL_S",
          lambda: forced, "cycle looked for within 0.3 s of the refresh: %s" % forced)
    calls["raise"] = True
    cfail = until(lambda: C.snapshot().get("monitor_error"))
    cf = C.snapshot()
    calls["raise"] = False
    cback = until(lambda: C.snapshot().get("monitor_error") is None)
    check("11. a pass that raises does not end the current's monitor: the error is carried, and it clears on the next "
          "good pass",
          lambda: cfail and "RuntimeError" in (cf.get("monitor_error") or "") and cback,
          "carried=%s (%s); cleared=%s" % (cfail, cf.get("monitor_error"), cback))
    C._stop.set()
    C._force.set()

    # 12. WHY there is no cycle. _ensure_cycle's reason used to be overwritten on the same pass by
    # _sample's "no cycle cached yet" - at New Castle the card said that while the real answer was that
    # the port's model does not cover the position. And it must survive the SAMPLES between looks: the
    # first version of the fix kept it only on the pass that looked, and the live card went back to
    # "no cycle cached yet" a minute later.
    class NoCover(A.CurrentsMonitor):
        POLL_S = 60.0                     # one look, at the first fix ...
        SAMPLE_S = 0.05                   # ... and samples every 50 ms after it that do not look

    real_ensure = A.currents.ensure_cycle_covering

    def no_cover(*a, **k):
        raise ValueError("bbox does not overlap the dbofs grid")

    A.currents.ensure_cycle_covering = no_cover
    try:
        N = NoCover()
        N.update_position(43.07, -70.71)
        said = until(lambda: "cover" in (N.snapshot().get("note") or ""), 3.0)
        t_said = time.time()
        time.sleep(0.5)
        ns = N.snapshot()
        sampled_since = (N._sampled_at or 0) > t_said + 0.3
    finally:
        A.currents.ensure_cycle_covering = real_ensure
    check("12. with no cycle to be had, the current says WHY - not 'no cycle cached yet' - and keeps saying it through "
          "the samples between looks",
          lambda: said and sampled_since and ns.get("ok") is False and "does not cover this position" in ns.get("note", ""),
          "note after 0.5 s of samples that did not look: %s (sampled since: %s)" % (ns.get("note"), sampled_since))
    N._stop.set()
    N._force.set()
finally:
    sys.stderr = real_err

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
