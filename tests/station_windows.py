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

AND FOR ONE TAB EACH, RE-POINTED IN PLACE BY THE PAGE (2026-09-02), eight mutations RUN:
    the page opens a SECOND window instead of re-pointing        -> 24
    it re-points on EVERY poll rather than only on a change      -> 24b
    the follow is never called from the state poll               -> 25
    the pill shows even when we already hold the window          -> 26
    a stale handle is allowed to throw past the liveness test    -> 26b
    the window flags never reach the page                        -> 23b, 27
    a blocked pop-up fails silently                              -> 28
    a server-side station opener comes back                      -> 8b

⚠ AND THIS SUITE SPRUNG THE SELF-MATCHING TRAP FOR THE THIRD TIME IN THIS REPO. Check 8b
greps the reporter for `webbrowser`, and the function's own DOCSTRING explains why
webbrowser cannot be used - so the check went red against correct code. It reads the
function's CODE now, unparsed from the AST with the docstring dropped, which is the same
fix check 1 has always used for hardcoded station ids.
"""

import importlib.util
import os
import re
import sys
import threading
import time

# --- crash guard: a throw outside a check() must still REPORT ---------------------------
# check() turns an exception inside its own thunk into a failed check. Scenario SETUP is
# not inside one - booting a console, driving an endpoint, waiting on a fix - and an
# exception there would end the process before a single FAIL line printed. "No FAIL lines"
# and "the process died" are indistinguishable to anything reading stdout, so a mutation
# that crashes this suite would score as SURVIVED rather than caught. Report it instead, in
# this suite's normal format; Python still exits non-zero on its own.
def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report


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


# ---- 5-8. the REPORTER: it names the station, and opens nothing --------------- #
#
# ⚠ THESE USED TO DRIVE AN OPENER AND THERE IS NO LONGER ONE IN THIS PROCESS. The console
# PAGE owns the tide and weather windows (2026-09-02, "switch to one tab that re-points
# itself"), because only a page can hold a window handle and navigate it in place -
# `webbrowser` hands a URL to the OS and gets none back. A server-side opener kept "as a
# fallback" would put the duplicate tab straight back at start-up, so there is exactly one
# opener and it is not here. Checks 24-28 cover the page's side.
#
# What the server still owes the operator is the SENTENCE: which gauge the correction came
# from and what it is made of. That is what these test now.
class FakeOpener:
    """A witness, not a collaborator. Nothing is handed it any more; check 8b is what
    proves the console opens nothing itself."""
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


def _report_briefly(fake, run_s=0.5):
    """Run the reporter against `fake`, capture what it printed, then STOP it - a watcher
    left running polls whatever global monitor the next check installs."""
    import contextlib
    import io as _io
    old = C.STATION_WATCH_POLL_S
    C.STATION_WATCH_POLL_S = 0.01
    real = C.WATER
    C.WATER = fake
    stop = threading.Event()
    buf = _io.StringIO()
    with contextlib.redirect_stdout(buf):
        t = threading.Thread(target=C.watch_station_report, args=("tide",),
                             kwargs={"stop": stop}, daemon=True)
        t.start()
        time.sleep(run_s)
        stop.set()
        t.join(timeout=2.0)
    C.WATER = real
    C.STATION_WATCH_POLL_S = old
    return buf.getvalue()


out5 = _report_briefly(FakeWater(station_after=2))
check("5. it WAITS for the vessel to have a station, then names that one",
      lambda: "8557380" in out5,
      lambda: "printed %r" % out5.strip()[:110])
check("6. ... and says what the correction is MADE OF, not merely which gauge",
      lambda: "8557380" in out5 and ("km off" in out5 or "single" in out5),
      lambda: out5.strip()[:130])

out7 = _report_briefly(FakeWater(station_after=10 ** 9), run_s=0.3)
check("7. no station -> it says NOTHING rather than naming one that has not resolved",
      lambda: out7.strip() == "",
      lambda: "printed %r" % out7.strip()[:80])


class ThrowingWater:
    """A monitor caught mid-refresh. The reporter runs forever, so an escaping exception
    kills the thread and the operator never hears of a station change again."""
    def __init__(self):
        self.n = 0

    def snapshot(self):
        self.n += 1
        if self.n < 3:
            raise RuntimeError("mid-refresh")
        return {"station": "8557380", "name": "Lewes", "dist_km": 3.7, "method": "single",
                "stations": [{"id": "8557380", "dist_km": 3.7}]}


out8 = _report_briefly(ThrowingWater(), run_s=0.5)
check("8. a monitor that THROWS does not kill the reporter thread",
      lambda: "8557380" in out8,
      lambda: "recovered and reported: %r" % out8.strip()[:90])

# ⚠ THE FUNCTION'S CODE, NOT ITS PROSE — AND THIS IS THE THIRD TIME THIS TRAP HAS BEEN
# SPRUNG IN THIS REPO. A plain slice went red because the docstring EXPLAINS why
# `webbrowser` cannot be used here, and the check was grepping for the word. Unparsed from
# the AST with the docstring dropped, so comments and documentation are not in the subject
# at all — the same fix check 1 above already uses for hardcoded station ids.
def _fn_code(src, name):
    import ast
    tree = ast.parse(src)
    for node in ast.walk(tree):
        if isinstance(node, ast.FunctionDef) and node.name == name:
            body = list(node.body)
            if body and isinstance(body[0], ast.Expr) and isinstance(body[0].value, ast.Constant)                and isinstance(body[0].value.value, str):
                body = body[1:]                       # the docstring is documentation
            return chr(10).join(ast.unparse(b) for b in body)
    return ""


_RPT = _fn_code(SRC, "watch_station_report")
check("8b. the console opens NO station page itself — one opener, and it is the page",
      # ⚠ NOT "no opener.open ANYWHERE" — the first draft said that and went red on the
      # CONTROLS window, which the server still opens and correctly so: it is same-origin,
      # the page can reach it by name, and nothing ever needs to re-point it. What must not
      # exist is a server-side opener for a STATION page.
      lambda: "def open_station_window" not in SRC
      and not re.search(r"opener\.open\([^)]*station", SRC)
      and "webbrowser" not in _RPT and ".open(" not in _RPT,
      "a server-side opener kept as a fallback puts the duplicate tab back at start-up")


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
check("12. the station REPORTER runs on its own DAEMON thread — it polls forever, so on "
      "the main thread it would never return and non-daemon it would hold shutdown",
      lambda: re.search(r"threading\.Thread\(target=watch_station_report[\s\S]{0,120}?daemon=True\)", SRC)
      is not None)
check("13. --no-tide-window suppresses it",
      lambda: '"--no-tide-window"' in SRC and "args.no_tide_window" in SRC)
# ⚠ THE REPORTER IS DELIBERATELY *OUTSIDE* THE BROWSER BLOCK, WHICH IS THE OPPOSITE OF
# WHAT THIS CHECK USED TO ASSERT — and the reversal is the point. It opens nothing, so
# there is no pop-up to gate; what it prints is which gauge the depth correction came from,
# and that correction is applied whether or not a browser was ever launched. A console run
# with --browser none used to say nothing about the water it was correcting for.
check("14. the reporter runs even with --browser none — the correction applies either way",
      lambda: (SRC.index("threading.Thread(target=watch_station_report")
               < SRC.index('if args.browser != "none":')))

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
check("19. both stations are entries in ONE registry, sharing one report path",
      lambda: set(C.STATION_WINDOWS) == {"tide", "weather"}
      and "def watch_station_report" in SRC
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
check("23. --no-weather-window suppresses the weather window on its own",
      lambda: '"--no-weather-window"' in SRC and "args.no_weather_window" in SRC
      and 'STATION_WINDOWS_ON["weather"]' in SRC)
# ⚠ THE FLAG HAS TO REACH THE PAGE, because the page is what opens these now. A flag the
# server honours and the client does not is a control that half works — and it would half
# work in the direction of opening a window the operator asked not to have.
check("23b. ... and both flags are PUBLISHED to the page, which is what owns the windows",
      lambda: '"station_windows"' in SRC and "S.station_windows" in HTML,
      "the server no longer opens them, so honouring the flag is the client's job")

# ── 24-28. ONE TAB EACH, RE-POINTED IN PLACE BY THE PAGE ──────────────────────────
#
# Andy, 2026-09-02: first "the weather browser tab and the tide browser tab do not update
# when ports are changed", then, shown that re-opening from the server leaves a stale tab
# behind, "switch to one tab that re-points itself."
#
# ⚠ ONLY THE PAGE CAN DO THAT. `webbrowser` hands a URL to the OS and gets no handle back,
# so this process can open a tab and never afterwards re-point it. A handle held by a page
# CAN be navigated cross-origin by whoever opened it. The cost is one click each, because
# `window.open` without a gesture is blocked — measured, not assumed — and framing the
# pages instead is impossible: NDBC sends `X-Frame-Options: deny` with
# `frame-ancestors 'none'`, NOAA Tides sends `SAMEORIGIN`.
#
# MEASURED LIVE, and worth recording because these checks pin the mechanism and not the
# behaviour: with a handle held and the port changed Erie -> Lewes, the station moved
# 9063038 -> 8557380, `location.replace` was called EXACTLY ONCE with the new URL, the held
# URL updated, and the pill stayed hidden because the window was still ours.
check("24. THE FIX: the page RE-POINTS the window it holds instead of opening another",
      lambda: "location.replace(cfg.want)" in HTML and "syncStationWindows" in HTML,
      "navigating a window you opened is allowed cross-origin; opening a second one is "
      "what left a stale tab behind")
check("24b. ... and it only re-points when the URL has actually CHANGED",
      lambda: "cfg.want !== cfg.url" in HTML,
      "re-navigating every poll would reload the page under the operator every few seconds")
check("25. the follow runs on the state poll, so a port change, a long transit and a gauge "
      "going out of service are all the same event",
      lambda: "syncStationWindows();" in HTML
      and HTML.index("syncStationWindows();") > HTML.index("function onState("),
      "keyed on the STATION, never on /api/ports")
check("26. the pill is offered only when there is a station AND we do not hold its window",
      lambda: "!stationWinAlive(k)" in HTML and "cfg.want" in HTML,
      "an affordance for a window that is already open is noise; one for a station that "
      "does not exist yet is a dead control")
check("26b. a handle from a previous page life cannot throw its way past the check",
      lambda: "try { return !!(w && !w.closed); } catch(e){ return false; }" in HTML,
      "`closed` is readable cross-origin, but a stale handle can still raise")
check("27. the --no-tide-window / --no-weather-window flags are honoured BY THE PAGE, "
      "which is what opens these now",
      lambda: "S.station_windows" in HTML and '"station_windows"' in SRC,
      "a flag the server honours and the client ignores is a control that half works")
# ⚠ A BLOCKED POP-UP MUST SAY SO. Failing silently leaves the operator clicking a pill that
# appears to do nothing — worse than the stale tab this replaced. Verified live: with
# window.open stubbed to null the banner read "The browser blocked the tide window. Allow
# pop-ups for this console, or open it yourself: https://tidesandcurrents.noaa.gov/..."
check("28. a blocked pop-up is REPORTED with the URL, not swallowed",
      lambda: "blocked the " in HTML and "showBanner(" in HTML[HTML.index("function openStationWindow"):
                                                              HTML.index("function openStationWindow") + 900],
      "the pill would otherwise look broken")

print("%d checks, %d failed" % (ran, fails))
sys.exit(1 if fails else 0)
