"""tests/water_along.py - THE WATER ALONG A PASSAGE'S SECTION (2026-10-12, step 6 of the long-transit plan).

Andy's plan, step 6: "RTH back along the corridor, the water-level offset per section". The console's water level
follows HER (WaterLevel: the stations nearest the boat, now). A passage's section is planned ahead of her and sailed
over the hours after, tens of km from those stations and at another state of the tide. fetch_water_along gives each of
a section's points the LOWEST level its OWN stations predict over the window she sails it, blended as hers are
(_water_pool); the page plans the section at the lowest it can trust (asv.html sectionLevel - tests/passage_sail.js 14).
Here, with CO-OPS stubbed (no network, and nothing written):
  1   each point's low from ITS OWN stations, inverse-distance blended, over the window; the section's the lowest
  2   the window: the slot either side of it counted (a low between two slots is not missed), none further; a window
      longer than WATER_WINDOW_MAX_S clipped
  3   a station that could not be read: its points blended from the rest; a point no station gives a level at has
      low_m None, and a section with none at all is not ok
  4   the Great Lakes: no predictions - the latest OBSERVED level stands for the window, on LWD, never blended across
      a lake
  5   each station read ONCE for all the points it serves, its predictions kept: a second section reads nothing new;
      a read that failed is tried again after a minute
  6   /api/water/along's query refused in words: no points, too many, out of range, t1 before t0
  7   the endpoint answered before /api/waterlevel (whose prefix test would not take it, but the order is the rule
      here), and fetch_water_level blending from the same pool

    python tests/water_along.py      # exit 0 = pass, 1 = fail   (stdlib only)
"""
import calendar
import inspect
import math
import os
import sys
import time


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


print("The water along a passage's section:")

# ── CO-OPS, stubbed ──────────────────────────────────────────────────────────────────────────────────────────────
# Three tide stations off New Hampshire: Alpha and Bravo ~40 km apart east-west with the tide an hour and a half apart,
# Charlie ~33 km north of Alpha at a steady 0.5 m. Two on Lake Erie and one on Lake Ontario, observed only.
STATIONS = [
    {"id": "A", "name": "Alpha", "lat": 43.00, "lng": -70.70, "gl": False},
    {"id": "B", "name": "Bravo", "lat": 43.00, "lng": -70.21, "gl": False},
    {"id": "C", "name": "Charlie", "lat": 43.30, "lng": -70.70, "gl": False},
    {"id": "E1", "name": "Erie One", "lat": 42.20, "lng": -80.10, "gl": True},
    {"id": "E2", "name": "Erie Two", "lat": 42.60, "lng": -79.40, "gl": True},
    {"id": "O1", "name": "Ontario One", "lat": 43.30, "lng": -79.00, "gl": True},
]
OBSERVED = {"E1": 0.42, "E2": 0.30, "O1": -0.50}
T = 12.42 * 3600                         # the semidiurnal tide
DAY0 = calendar.timegm((2026, 10, 12, 0, 0, 0))
T0 = DAY0 + 10 * 3600                    # the section's window: 10:00 to 13:00 UTC
T1 = T0 + 3 * 3600
FAIL = set()
DIP = {}                                 # station -> (epoch, value): one slot set apart
calls = {"series": [], "get": []}


def level(sid, e):
    if sid in DIP and DIP[sid][0] == e:
        return DIP[sid][1]
    if sid == "A":
        return 1.0 + 0.8 * math.sin(2 * math.pi * (e - DAY0) / T)
    if sid == "B":
        return 1.0 + 0.8 * math.sin(2 * math.pi * (e - DAY0 - 5400) / T)
    return 0.5


def fake_series(sid, datum, product, begin, end, interval=None, timeout=15.0):
    calls["series"].append((sid, datum, product, begin, end, interval))
    if sid in FAIL:
        return {"ok": False, "note": "fetch failed: stub"}
    b = calendar.timegm(time.strptime(begin, "%Y%m%d %H:%M"))
    z = calendar.timegm(time.strptime(end, "%Y%m%d %H:%M"))
    out, e = [], b
    while e <= z:
        out.append({"t": time.strftime("%Y-%m-%d %H:%M", time.gmtime(e)), "v": round(level(sid, e), 3)})
        e += 360
    return {"ok": True, "series": out}


def fake_get(sid, datum, product, timeout=15.0):
    calls["get"].append((sid, datum, product))
    if sid in FAIL or sid not in OBSERVED:
        return {"ok": False, "note": "no data"}
    return {"ok": True, "offset_m": OBSERVED[sid], "t": "2026-10-12 10:00"}


A._load_water_stations = lambda: STATIONS
A._coops_series = fake_series
A._coops_get = fake_get


def fresh():
    A._water_pred.clear()
    calls["series"].clear()
    calls["get"].clear()
    FAIL.clear()
    DIP.clear()


def km(p, s):
    return A._haversine_km(p[0], p[1], s["lat"], s["lng"])


def blended_low(p, ids, t0=T0, t1=T1):
    """The test's own sum: the IDW blend of `ids` at p, at every 6-minute slot from the one before t0 to the one after
    t1, and its lowest."""
    sts = [s for s in STATIONS if s["id"] in ids]
    best = None
    e = DAY0
    while e <= t1 + 360:
        if e >= t0 - 360:
            w = [1.0 / max(km(p, s), 0.01) ** 2 for s in sts]
            v = sum(wi * round(level(s["id"], e), 3) for wi, s in zip(w, sts)) / sum(w)
            best = v if best is None or v < best else best
        e += 360
    return best


# ── 1. each point's own stations ────────────────────────────────────────────────────────────────────────────────
fresh()
pA, pB, pM = (43.00, -70.70), (43.00, -70.21), (43.00, -70.455)
r1 = A.fetch_water_along([pA, pB, pM], T0, T1)
pts1 = r1.get("points", [])
want = [blended_low(pA, "ABC"), blended_low(pB, "ABC"), blended_low(pM, "ABC")]
got1 = [p["low_m"] for p in pts1]
check("1. EACH POINT'S OWN STATIONS: at Alpha its low is Alpha's, at Bravo Bravo's (the tide an hour and a half later), "
      "between them the inverse-distance blend of all three - each the lowest over the window; the section's low the "
      "lowest of them, where and when; each point's nearest station named with its distance",
      lambda: r1["ok"] and all(abs(g - w) < 0.002 for g, w in zip(got1, want))
              and abs(r1["low_m"] - min(want)) < 0.002 and r1["at"]["lon"] == [pA, pB, pM][want.index(min(want))][1]
              and pts1[0]["name"] == "Alpha" and pts1[0]["km"] == 0.0 and pts1[1]["name"] == "Bravo"
              and all(p["kind"] == "predicted" and p["datum"] == "MLLW" for p in pts1),
      lambda: "got %s want %s; low %s at %s" % ([round(g, 3) for g in got1], [round(w, 3) for w in want],
                                                r1.get("low_m"), r1.get("at")))
check("1b. THE WINDOW MATTERS: the same points over the six hours after it give other lows - the level is the one she "
      "will meet, not the one now",
      lambda: abs(A.fetch_water_along([pA], T1, T1 + 6 * 3600)["low_m"] - blended_low(pA, "ABC", T1, T1 + 6 * 3600)) < 0.002
              and abs(blended_low(pA, "ABC", T1, T1 + 6 * 3600) - want[0]) > 0.1,
      lambda: "%.3f vs %.3f" % (blended_low(pA, "ABC", T1, T1 + 6 * 3600), want[0]))

# ── 2. the window's edges ───────────────────────────────────────────────────────────────────────────────────────
pC = (43.30, -70.70)                       # at Charlie, steady at 0.5 m - a dip shows only if its slot is counted
lows2 = {}
for name, at in (("one slot after", T1 + 360), ("two slots after", T1 + 720), ("one slot before", T0 - 360),
                 ("two slots before", T0 - 720), ("inside", T0 + 3600)):
    fresh()
    DIP["C"] = (int(at), -1.0)
    lows2[name] = A.fetch_water_along([pC], T0, T1)["points"][0]["low_m"]
fresh()
clip = A.fetch_water_along([pC], T0, T0 + 3 * 86400)
check("2. THE WINDOW'S EDGES: a dip in the slot either side of the window is counted (a low between two slots is not "
      "missed), one two slots out is not; a window longer than WATER_WINDOW_MAX_S is clipped",
      lambda: lows2["one slot after"] < -0.9 and lows2["one slot before"] < -0.9 and lows2["inside"] < -0.9
              and lows2["two slots after"] > 0.4 and lows2["two slots before"] > 0.4 and clip["ok"]
              and A.WATER_WINDOW_MAX_S == 24 * 3600,
      lambda: str(lows2))

# ── 3. stations that could not be read ──────────────────────────────────────────────────────────────────────────
fresh()
FAIL.add("B")
r3 = A.fetch_water_along([pB], T0, T1)
fresh()
FAIL.update({"A", "B", "C"})
r3b = A.fetch_water_along([pA, pB], T0, T1)
check("3. A STATION THAT COULD NOT BE READ: at Bravo, blended from Alpha and Charlie; NONE read - each point's low_m "
      "None (its nearest station's distance still given), and the section not ok, in words",
      lambda: r3["ok"] and abs(r3["points"][0]["low_m"] - blended_low(pB, "AC")) < 0.002 and "B" not in r3["points"][0]["stations"]
              and not r3b["ok"] and all(p["low_m"] is None for p in r3b["points"]) and r3b["points"][1]["km"] == 0.0
              and "no station gave a level" in r3b["note"],
      lambda: "%s; %s" % (r3["points"][0], r3b.get("note")))

# ── 4. the Great Lakes ──────────────────────────────────────────────────────────────────────────────────────────
fresh()
pE = (42.20, -80.10)
r4 = A.fetch_water_along([pE], T0, T1)
p4 = r4["points"][0]
d2 = km(pE, STATIONS[4])
check("4. THE GREAT LAKES: no predictions there - the latest OBSERVED level stands for the window, on LWD, blended "
      "only within the lake (Erie One and Two, never Ontario One); no prediction asked for",
      lambda: r4["ok"] and p4["datum"] == "LWD" and p4["kind"] == "observed" and sorted(p4["stations"]) == ["E1", "E2"]
              and abs(p4["low_m"] - (0.42 / 0.01 ** 2 + 0.30 / d2 ** 2) / (1 / 0.01 ** 2 + 1 / d2 ** 2)) < 0.001
              and not calls["series"] and all(c[2] == "water_level" and c[1] == "LWD" for c in calls["get"]),
      lambda: "%s; calls %s" % (p4, calls))

# ── 5. read once, kept ──────────────────────────────────────────────────────────────────────────────────────────
fresh()
A.fetch_water_along([pA, pB, pM, pC], T0, T1)
first = len(calls["series"])
A.fetch_water_along([pA, pM], T0 + 1800, T1 + 1800)
second = len(calls["series"]) - first
fresh()
FAIL.add("C")
A.fetch_water_along([pC], T0, T1)
again_now = len(calls["series"])
A.fetch_water_along([pC], T0, T1)
held = len(calls["series"]) - again_now
key = [k for k in A._water_pred if k[0] == "C"][0]
A._water_pred[key] = (time.time() - 61, None)
A.fetch_water_along([pC], T0, T1)
retried = len(calls["series"]) - again_now - held
check("5. EACH STATION READ ONCE for all the points it serves (three stations, four points: three reads), for its day "
      "and the next at 6 minutes; a second section in that window reads nothing new; a read that FAILED is not tried "
      "again for a minute, then is",
      lambda: first == 3 and second == 0 and held == 0 and retried >= 1
              and all(c[2] == "predictions" and c[5] == "6" and c[3] == "20261012 00:00" and c[4] == "20261014 00:00"
                      for c in calls["series"]),
      lambda: "first %d, second %d, failed held %d, retried %d; %s" % (first, second, held, retried, calls["series"][:1]))

# ── 6. the query ────────────────────────────────────────────────────────────────────────────────────────────────
def said(path):
    try:
        A._water_along_query(path)
        return None
    except ValueError as e:
        return str(e)


good = A._water_along_query("/api/water/along?pts=43.0,-70.7;43.1,-70.6&t0=100&t1=200")
bad6 = {"no points": said("/api/water/along?t0=1&t1=2"), "empty": said("/api/water/along?pts=&t0=1&t1=2"),
        "too many": said("/api/water/along?pts=" + ";".join(["43,-70"] * 61) + "&t0=1&t1=2"),
        "out of range": said("/api/water/along?pts=91,-70&t0=1&t1=2"), "not a pair": said("/api/water/along?pts=43&t0=1&t1=2"),
        "t1 before t0": said("/api/water/along?pts=43,-70&t0=5&t1=2"), "no t0": said("/api/water/along?pts=43,-70&t1=2")}
check("6. /api/water/along's QUERY: points and the window read; refused in words - no points, too many, out of range, "
      "not a pair, t1 before t0, no t0",
      lambda: good == ([(43.0, -70.7), (43.1, -70.6)], 100.0, 200.0) and all(bad6.values()),
      lambda: "; ".join("%s: %s" % (k, (v or "NOT REFUSED")[:40]) for k, v in bad6.items()))

# ── 7. the wiring ───────────────────────────────────────────────────────────────────────────────────────────────
src = inspect.getsource(A)
get = src[src.index("def do_GET"):]
check("7. THE WIRING: /api/water/along answered (its query read, a refusal a 400) before /api/waterlevel; "
      "fetch_water_level blends from the same pool as the section's points (_water_pool)",
      lambda: 0 <= get.index('self.path.startswith("/api/water/along")') < get.index('self.path.startswith("/api/waterlevel")')
              and "pts, t0, t1 = _water_along_query(self.path)" in get and "return self._send(400" in get
              and "nearest, datum, lake, cand = _water_pool(sts, lat, lon)" in inspect.getsource(A.fetch_water_level)
              and "_water_pool(sts, lat, lon)" in inspect.getsource(A.fetch_water_along),
      "")

print("\n" + ("%d CHECK(S) FAILED (%d ran)" % (fails, ran) if fails else "all checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
