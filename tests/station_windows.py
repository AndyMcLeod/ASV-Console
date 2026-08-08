"""tests/tide_window.py - the THIRD browser window: the CO-OPS page for the water-level
station the VESSEL'S OWN FIX selects, and the IDW blend behind the correction.

WHY THIS EXISTS. Andy: "Add a third browser window with
https://tidesandcurrents.noaa.gov/waterlevels.html?id=8557380. This is for Lewes
Delaware. Use the vessel GPS to get the nearest tide station. Conduct a IDW analysis of 3
proximal stations if there isn't one in the immediate area."

HALF OF IT ALREADY EXISTED, which is why this suite is mostly about the seam rather than
the maths: the water monitor has always located the nearest CO-OPS stations from the
vessel fix and blended up to WATER_K of them by inverse-distance weighting (WATER_K = 3,
WATER_IDW_POWER = 2, WATER_MAX_KM = 200), banding the result by distance so a remote
reading is never applied to charted depths. What was missing was the WINDOW, and the fact
that a blended correction was being reported under one station's name.

THE STATION IS DERIVED, NEVER CONFIGURED. 8557380 is what the DriX spawn at Lewes
resolves to - measured live: Lewes 3.7 km (95.5% of the weight), Brandywine Shoal Light
22.3 km (2.6%), Cape May 26.4 km (1.9%) - not a constant anywhere in the console. Move
the vessel and the window follows it. Check 1 is the guard that nobody re-pins it.

WHICH STATION THE PAGE SHOWS. The page takes ONE station id, so when the correction is a
blend it shows the PRIMARY: the nearest station actually returning data, which is the
same one the chart-source card attributes the correction to. The two cannot disagree
because both read `water.station` (check 7). The blend is printed when the window opens
and named in the card's tooltip, so "the applied number is not this station's own level"
is stated rather than left for the operator to infer.

    python tests/tide_window.py     # exit 0 = pass, 1 = fail   (stdlib only, hermetic)

TEETH (verified by mutation, with the checks each one produces):
    a station id is hardcoded anywhere in the console            -> 1
    the URL stops being built from the id                        -> 2, 3
    an empty/missing id yields a URL instead of None             -> 3
    the opener fires before a station exists                     -> 5
    the wait loop never gives up (hangs the thread)              -> 6
    a browser that throws takes the console down                 -> 7
    the report stops naming the blend / claims one station       -> 9, 10, 11
    the IDW weights stop being inverse-SQUARE by distance        -> 10
    the window is opened on the main thread / not daemon         -> 12
    --no-tide-window or --browser none stops being honoured      -> 13, 14
"""

import importlib.util
import os
import re
import sys
import time

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


# Import the console WITHOUT starting anything (nothing runs on import by design).
spec = importlib.util.spec_from_file_location("console_under_test",
                                              os.path.join(APP, "asv_console.py"))
C = importlib.util.module_from_spec(spec)
spec.loader.exec_module(C)
SRC = open(os.path.join(APP, "asv_console.py"), "r", encoding="utf-8").read()

print("The tide window — derived from the vessel fix, not configured:")

# ---- 1. the station must not be pinned ------------------------------------ #
# The whole point is that the window follows the boat. A literal station id used as a
# VALUE would quietly pin it to whatever water this was written in.
#
# BY AST, NOT BY SUBSTRING, and I got this wrong first: a plain search flagged the word
# "8557380" inside my own COMMENT explaining that Lewes is what the DriX spawn resolves
# to. The check could not tell documentation from code, which is the same trap as
# roc_persist's self-matching audit and ui_split's always-true thunk - third time this
# session. Constants are what the AST sees; comments are not in it at all, and a
# docstring is skipped explicitly.
def code_constants(src):
    """Every literal used as a VALUE - comments gone, docstrings skipped."""
    import ast
    tree = ast.parse(src)
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            body = getattr(node, "body", None) or []
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant) \
               and isinstance(body[0].value.value, str):
                docstrings.add(id(body[0].value))
    out = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and id(node) not in docstrings:
            out.append(node.value)
    return out


pinned = [v for v in code_constants(SRC)
          if isinstance(v, (str, int)) and re.fullmatch(r"\d{7}", str(v))]
check("1. NO station id is hardcoded as a VALUE in the console — the station is derived "
      "from the vessel's fix, so the window follows the boat",
      lambda: not pinned,
      lambda: ("pinned: " + ", ".join(map(str, pinned))) if pinned else "none, as required")

# ---- 2-3. the URL --------------------------------------------------------- #
check("2. the URL is the CO-OPS water-levels page for the given id",
      lambda: C.tide_station_url("8557380") ==
      "https://tidesandcurrents.noaa.gov/waterlevels.html?id=8557380",
      lambda: C.tide_station_url("8557380"))
check("3. no id -> no URL (None, blank and whitespace), so nothing opens a bare page",
      lambda: C.tide_station_url(None) is None and C.tide_station_url("") is None
      and C.tide_station_url("   ") is None)
check("4. a DIFFERENT fix gives a DIFFERENT page — the window follows the vessel",
      lambda: C.tide_station_url("9414290") ==
      "https://tidesandcurrents.noaa.gov/waterlevels.html?id=9414290"
      and C.tide_station_url("9414290") != C.tide_station_url("8557380"))


# ---- 5-8. the opener waits for a station, then opens exactly once ---------- #
class FakeOpener:
    def __init__(self, explode=False):
        self.calls = []
        self.explode = explode

    def open(self, url, new=0):
        self.calls.append((url, new))
        if self.explode:
            raise RuntimeError("no browser here")
        return True


class FakeWater:
    """Stands in for the WATER monitor: no station until the Nth poll, as if the vessel
    had not yet got a fix."""
    def __init__(self, station_after=0, snap=None):
        self.n = 0
        self.station_after = station_after
        self.snap = snap or {"station": "8557380", "name": "Lewes", "dist_km": 3.7,
                             "method": "single", "stations": [{"id": "8557380", "dist_km": 3.7}]}

    def snapshot(self):
        self.n += 1
        return dict(self.snap) if self.n > self.station_after else {"ok": False}


def with_water(fake, fn):
    real = C.WATER
    C.WATER = fake
    try:
        return fn()
    finally:
        C.WATER = real


# 5. it must WAIT: with no station on the first poll it may not open anything yet.
op5 = FakeOpener()
w5 = FakeWater(station_after=2)
old_poll = C.TIDE_WINDOW_POLL_S
C.TIDE_WINDOW_POLL_S = 0.01
url5 = with_water(w5, lambda: C.open_station_window(op5, "tide", wait_s=2.0))
check("5. it WAITS for the vessel to have a station, then opens that station's page "
      "(the station cannot exist at process start — there is no fix yet)",
      lambda: url5 and url5.endswith("id=8557380") and len(op5.calls) == 1
      and w5.n > 2,
      lambda: "opened %r after %d polls" % (op5.calls, w5.n))
check("6. ... in a NEW window, not the console's own tab",
      lambda: op5.calls and op5.calls[0][1] == 1,
      lambda: str(op5.calls))

# 7. no station ever -> gives up, opens nothing, and does not hang.
op7 = FakeOpener()
t0 = time.monotonic()
url7 = with_water(FakeWater(station_after=10 ** 9), lambda: C.open_station_window(op7, "tide", wait_s=0.2))
check("7. no station within the wait -> gives up quietly, opens nothing, never hangs",
      lambda: url7 is None and not op7.calls and (time.monotonic() - t0) < 5.0,
      lambda: "%.2fs, calls=%s" % (time.monotonic() - t0, op7.calls))


# 8. a browser that refuses must not take the console down.
# THE CALL IS INSIDE THE THUNK, and that is the point of the check: with it at module
# level the mutation this exists for (the except clause narrowed so the browser's error
# escapes) killed the whole suite instead of failing check 8 - no FAIL line printed, and
# a mutation runner reading stdout scores that as a survivor. A harness that cannot
# survive the fault it tests for cannot report it; third time in this repo.
op8 = FakeOpener(explode=True)


def browser_that_throws():
    url = with_water(FakeWater(), lambda: C.open_station_window(op8, "tide", wait_s=1.0))
    return url is not None and len(op8.calls) == 1


check("8. a browser that THROWS is a missing convenience, not a crash",
      browser_that_throws, lambda: "opener raised; calls=%d" % len(op8.calls))
C.TIDE_WINDOW_POLL_S = old_poll

# ---- 9-11. the blend is reported, not implied ----------------------------- #
BLEND = {"station": "8557380", "name": "Lewes", "dist_km": 3.7, "method": "idw3",
         "stations": [{"id": "8557380", "dist_km": 3.7},
                      {"id": "8555889", "dist_km": 22.3},
                      {"id": "8536110", "dist_km": 26.4}]}
rep = C.station_window_report(BLEND, "Tide", C.WATER_IDW_POWER, "correction", "offset")
check("9. a blended correction NAMES every contributing station, so one station's page "
      "cannot be mistaken for the whole answer",
      lambda: all(s in rep for s in ("8557380", "8555889", "8536110"))
      and "PRIMARY" in rep and "blend" in rep,
      lambda: (rep or "").replace("\n", " | ")[:150])

# 10. THE WEIGHTS ARE INVERSE-SQUARE, and the check is what proves the reported split is
# the one the correction actually used. Lewes at 3.7 km against stations at 22.3 and
# 26.4 dominates ~95%; a linear (power 1) weighting would read ~57%, which is a
# different operational story about how much the far stations matter.
pcts = [float(x) for x in re.findall(r"(\d+\.\d)%", rep or "")]
check("10. the reported weights are inverse-SQUARE by distance (the primary dominates)",
      lambda: len(pcts) == 3 and 94.0 < pcts[0] < 97.0 and pcts[1] < 5.0 and pcts[2] < 5.0
      and abs(sum(pcts) - 100.0) < 0.3,
      lambda: str(pcts))

single = C.station_window_report({"station": "8557380", "name": "Lewes", "dist_km": 3.7,
                                 "method": "single",
                                 "stations": [{"id": "8557380", "dist_km": 3.7}]},
                                "Tide", C.WATER_IDW_POWER, "correction", "offset")
check("11. a SINGLE-station correction says so plainly and claims no blend",
      lambda: "alone" in single and "blend" not in single and "PRIMARY" not in single,
      lambda: single)
check("11b. no station at all -> no report (nothing to say, and nothing to open)",
      lambda: C.station_window_report({}, "Tide", 2.0) is None
      and C.station_window_report({"station": ""}, "Tide", 2.0) is None)

# ---- 12-14. the wiring ---------------------------------------------------- #
check("12. the window is opened on its own DAEMON thread — it waits for a fix, so on the "
      "main thread it would stall start-up, and non-daemon it would hold shutdown",
      lambda: re.search(r"threading\.Thread\(target=open_station_window[\s\S]{0,160}?daemon=True\)", SRC)
      is not None)
check("13. --no-tide-window suppresses it",
      lambda: '"--no-tide-window"' in SRC and "args.no_tide_window" in SRC)
check("14. it is inside the browser block, so --browser none opens NOTHING (which is why "
      "every real-console harness is unaffected by it)",
      lambda: (SRC.index('if args.browser != "none":')
               < SRC.index("threading.Thread(target=open_station_window")))

# 15. the page and the card must name the SAME station, or the operator is reading two
# different answers. Both read `water.station`; assert the client does too.
HTML = open(os.path.join(APP, "static", "asv.html"), "r", encoding="utf-8").read()
check("15. the chart-source card attributes the correction to the SAME field the window "
      "opens (water.station), so the two can never disagree",
      lambda: "water.station" in HTML and "CO-OPS " in HTML)
check("16. ... and the card discloses the blend rather than showing a blended number "
      "under one station's name",
      lambda: "water.stations" in HTML and "inverse-distance blend" in HTML)


# ---- 17-23. THE WEATHER WINDOW: the same mechanism, the other network ------ #
# It is deliberately the SAME opener with a different spec entry, not a second copy of
# the wait loop - the hard part (there is no station until the vessel has a fix) is
# identical for a tide gauge and a weather buoy, and two copies would drift.
check("17. the NDBC page is built from the buoy id, and no id means no URL",
      lambda: C.ndbc_station_url("BRND1") ==
      "https://www.ndbc.noaa.gov/station_page.php?station=BRND1"
      and C.ndbc_station_url("") is None and C.ndbc_station_url(None) is None,
      lambda: C.ndbc_station_url("BRND1"))
check("18. NO buoy id is hardcoded either — the buoy is whichever the fix selects",
      lambda: not [v for v in code_constants(SRC)
                   if isinstance(v, str) and re.fullmatch(r"[A-Z]{4}\d", v)],
      lambda: "none, as required")
check("19. both windows are entries in ONE registry, sharing one wait/open/timeout path",
      lambda: set(C.STATION_WINDOWS) == {"tide", "weather"}
      and "def open_station_window" in SRC
      and SRC.count("def open_tide_window") == 0,
      lambda: "kinds: " + ", ".join(sorted(C.STATION_WINDOWS)))

WBLEND = {"station": "LWSD1",
          "stations": [{"id": "LWSD1", "dist_km": 3.7},
                       {"id": "BRND1", "dist_km": 22.3},
                       {"id": "CMAN4", "dist_km": 26.4}]}
# BUILT FROM THE REGISTRY ENTRY, not from literals repeated here: passing the nouns in
# by hand tested the helper's parameters and NOT the weather window's configuration -
# swapping the spec to the tide's wording sailed straight through. Read the spec, and
# the check covers what actually ships.
WSPEC = C.STATION_WINDOWS["weather"]
wrep = C.station_window_report(WBLEND, WSPEC["label"], WSPEC["power"],
                               WSPEC["noun"], WSPEC["applied"])
check("20. the weather report names every contributing buoy and its share",
      lambda: all(b in wrep for b in ("LWSD1", "BRND1", "CMAN4")) and "Weather window" in wrep
      and "PRIMARY" in wrep,
      lambda: wrep.replace(chr(10), " | ")[:130])
check("21. ... in the WEATHER's own words — a buoy blend is not a 'correction'",
      lambda: "wind and sea is" in wrep and "forcing" in wrep and "correction" not in wrep,
      lambda: wrep.replace(chr(10), " | ")[:110])

# 22. the same blend maths as the tide side, because both monitors use inverse-SQUARE
# weighting - and at Lewes the two networks happen to sit on the SAME three sites, which
# is why the percentages match the tide window's exactly.
wp = [float(x) for x in re.findall(r"(\d+\.\d)%", wrep or "")]
check("22. the weather blend is inverse-SQUARE weighted (nearest buoy dominates)",
      lambda: len(wp) == 3 and 94.0 < wp[0] < 97.0 and abs(sum(wp) - 100.0) < 0.3,
      lambda: str(wp))
check("23. --no-weather-window suppresses the fourth window on its own",
      lambda: '"--no-weather-window"' in SRC and "args.no_weather_window" in SRC
      and 'args=(opener, "weather")' in SRC)

print("%d checks, %d failed" % (ran, fails))
sys.exit(1 if fails else 0)
