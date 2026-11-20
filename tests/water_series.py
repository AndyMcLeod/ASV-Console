"""tests/water_series.py - THE WATER OVER A SURVEY'S WINDOW, SLOT BY SLOT (2026-11-19, survey window phase 1).

Andy: "During survey planning, institute a start time and duration functionality. Using this feature, examine tide
level at start and total change through the duration of the survey." fetch_water_series gives the Survey tab's tide
strip: at each 6-minute slot of the window, the LOWEST of the lines' points' levels, each blended from its own stations
(_water_blend_at, the one blend fetch_water_along takes its lows from), so the strip's low IS the low the punch cuts at.
Here, with CO-OPS stubbed (no network, and nothing written):
  1   each slot the lowest of the points' blends; the series' low the along read's low over the same window; start
      and end interpolated at t0 and t1 off the slots; the high the series' highest
  2   the window: the slot either side counted, none further; a window longer than WATER_WINDOW_MAX_S clipped
  3   trust: a point whose nearest station is beyond trust_km left out of the curve and counted far; one no station
      gives a level at counted unread; none left - not ok, in words naming the distance
  4   the Great Lakes: the observed level a flat line, kind observed
  5   STOFS: a surge-lowered station's series drawn lowered, as the along read's low is, and said
  6   /api/water/series' query: trust_km read, refused in words; the usage line names the route asked
  7   the wiring: answered before /api/waterlevel; both reads gather and blend through the same helpers

    python tests/water_series.py      # exit 0 = pass, 1 = fail   (stdlib only)
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


print("The water over a survey's window:")

# ── CO-OPS, stubbed (tests/water_along.py's stations) ───────────────────────────────────────────────────────────
STATIONS = [
    {"id": "A", "name": "Alpha", "lat": 43.00, "lng": -70.70, "gl": False},
    {"id": "B", "name": "Bravo", "lat": 43.00, "lng": -70.21, "gl": False},
    {"id": "C", "name": "Charlie", "lat": 43.30, "lng": -70.70, "gl": False},
    {"id": "E1", "name": "Erie One", "lat": 42.20, "lng": -80.10, "gl": True},
    {"id": "E2", "name": "Erie Two", "lat": 42.60, "lng": -79.40, "gl": True},
    {"id": "O1", "name": "Ontario One", "lat": 43.30, "lng": -79.00, "gl": True},
]
OBSERVED = {"E1": 0.42, "E2": 0.30, "O1": -0.50}
T = 12.42 * 3600
DAY0 = calendar.timegm((2026, 10, 12, 0, 0, 0))
T0 = DAY0 + 10 * 3600
T1 = T0 + 3 * 3600
FAIL = set()
DIP = {}


def level(sid, e):
    if sid in DIP and DIP[sid][0] == e:
        return DIP[sid][1]
    if sid == "A":
        return 1.0 + 0.8 * math.sin(2 * math.pi * (e - DAY0) / T)
    if sid == "B":
        return 1.0 + 0.8 * math.sin(2 * math.pi * (e - DAY0 - 5400) / T)
    return 0.5


def fake_series(sid, datum, product, begin, end, interval=None, timeout=15.0):
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
    if sid in FAIL or sid not in OBSERVED:
        return {"ok": False, "note": "no data"}
    return {"ok": True, "offset_m": OBSERVED[sid], "t": "2026-10-12 10:00"}


A._load_water_stations = lambda: STATIONS
A._coops_series = fake_series
A._coops_get = fake_get
REAL_STOFS_LOWERED = A._stofs_lowered


def fresh():
    A._water_pred.clear()
    FAIL.clear()
    DIP.clear()
    A._stofs_lowered = REAL_STOFS_LOWERED


def km(p, s):
    return A._haversine_km(p[0], p[1], s["lat"], s["lng"])


def blend(p, ids, e, shift=0.0):
    """The test's own sum: the inverse-distance blend of `ids` at p at slot e (each station's level rounded as CO-OPS
    gives it, less `shift`)."""
    sts = [s for s in STATIONS if s["id"] in ids]
    w = [1.0 / max(km(p, s), 0.01) ** 2 for s in sts]
    return sum(wi * (round(level(s["id"], e), 3) - shift) for wi, s in zip(w, sts)) / sum(w)


pA, pB, pM = (43.00, -70.70), (43.00, -70.21), (43.00, -70.455)
pC = (43.30, -70.70)
pFar = (43.00, -69.60)                     # ~50 km east of Bravo
pE = (42.20, -80.10)

# ── 1. the curve ────────────────────────────────────────────────────────────────────────────────────────────────
fresh()
s1 = A.fetch_water_series([pA, pB, pM], T0, T1)
a1 = A.fetch_water_along([pA, pB, pM], T0, T1)
slots = list(range(int(T0 - 360), int(T1 + 360) + 1, 360))
want1 = [min(blend(p, "ABC", e) for p in (pA, pB, pM)) for e in slots]
got1 = s1.get("series") or []
off = A.fetch_water_series([pA, pB, pM], T0 + 100, T1 - 100)
lin = want1[1] + (want1[2] - want1[1]) * 100 / 360.0
lin_end = want1[-3] + (want1[-2] - want1[-3]) * 260 / 360.0
check("1. THE CURVE: at each slot the LOWEST of the points' own blends; the series' low IS the along read's low over "
      "the same window (the strip shows the water the punch cuts at); the high its highest; start and end "
      "interpolated at t0 and t1 between the slots round them",
      lambda: s1["ok"] and [e for e, _v in got1] == slots and all(abs(v - w) < 0.002 for (_e, v), w in zip(got1, want1))
              and abs(s1["low"]["m"] - a1["low_m"]) < 0.0005 and abs(s1["low"]["m"] - min(want1)) < 0.002
              and abs(s1["high"]["m"] - max(want1)) < 0.002 and s1["kind"] == "predicted"
              and s1["counted"] == 3 and s1["far"] == 0 and s1["unread"] == 0 and s1["points"] == 3
              and abs(off["start"]["m"] - lin) < 0.002 and off["start"]["t"] == T0 + 100
              and abs(off["end"]["m"] - lin_end) < 0.002 and off["end"]["t"] == T1 - 100,
      lambda: "low %s vs along %s; start %s vs %.3f; end %s vs %.3f; %d slots"
              % (s1.get("low"), a1.get("low_m"), off.get("start"), lin, off.get("end"), lin_end, len(got1)))
# (1's lowest point is always one sitting ON a station - near the low, Charlie's 0.5 m lifts the midpoint - so a curve
# drawn from each point's nearest station alone passes it. The midpoint by itself is only ever the blend.)
fresh()
s1b = A.fetch_water_series([pM], T0, T1)
got1b = s1b.get("series") or []
want1b = [blend(pM, "ABC", e) for e, _v in got1b]
apart = max(min(abs(w - round(level(sid, e), 3)) for sid in "ABC") for (e, _v), w in zip(got1b, want1b)) if got1b else 0
check("1b. a point between stations is drawn at their BLEND at every slot - not at any one station's level",
      lambda: s1b["ok"] and len(got1b) == len(slots) and all(abs(v - w) < 0.002 for (_e, v), w in zip(got1b, want1b))
              and apart > 0.05,
      lambda: "%d slots; the blend stands %.3f m off the nearest single station at its widest" % (len(got1b), apart))

# ── 2. the window's edges ───────────────────────────────────────────────────────────────────────────────────────
edge = {}
for name, at in (("one slot after", T1 + 360), ("two slots after", T1 + 720), ("one slot before", T0 - 360),
                 ("two slots before", T0 - 720)):
    fresh()
    DIP["C"] = (int(at), -1.0)
    edge[name] = A.fetch_water_series([pC], T0, T1)["low"]["m"]
fresh()
clip = A.fetch_water_series([pC], T0, T0 + 3 * 86400)
check("2. THE WINDOW'S EDGES: a dip in the slot either side of the window is in the curve, one two slots out is not; "
      "a window longer than WATER_WINDOW_MAX_S is clipped to it",
      lambda: edge["one slot after"] < -0.9 and edge["one slot before"] < -0.9 and edge["two slots after"] > 0.4
              and edge["two slots before"] > 0.4 and clip["ok"] and clip["t1"] == T0 + A.WATER_WINDOW_MAX_S
              and clip["series"][-1][0] <= T0 + A.WATER_WINDOW_MAX_S + 360,
      lambda: "%s; clipped t1 %s" % (edge, clip.get("t1")))

# ── 3. trust ────────────────────────────────────────────────────────────────────────────────────────────────────
fresh()
t_on = A.fetch_water_series([pA, pB, pFar], T0, T1, trust_km=20)
t_ref = A.fetch_water_series([pA, pB], T0, T1)
t_off = A.fetch_water_series([pA, pB, pFar], T0, T1)
t_all = A.fetch_water_series([pFar], T0, T1, trust_km=20)
FAIL.update({"E1", "E2"})
t_mix = A.fetch_water_series([pA, pE], T0, T1)
fresh()
FAIL.update({"A", "B", "C"})
t_none = A.fetch_water_series([pA], T0, T1)
check("3. TRUST: a point whose nearest station is beyond trust_km is left out of the curve (the curve the trusted "
      "points' alone) and counted far; without trust_km it is drawn; all far - not ok, naming the distance; a point no "
      "station gives a level at is counted unread and the rest still drawn; none at all - not ok, in words",
      lambda: t_on["ok"] and t_on["far"] == 1 and t_on["counted"] == 2 and t_on["series"] == t_ref["series"]
              and t_off["counted"] == 3 and not t_all["ok"] and t_all["far"] == 1 and "within 20 km" in t_all["note"]
              and t_mix["ok"] and t_mix["unread"] == 1 and t_mix["counted"] == 1
              and not t_none["ok"] and t_none["unread"] == 1 and "no station gave a level" in t_none["note"]
              and t_none["series"] == [],
      lambda: "far %s/%s counted %s; all-far %s; mixed unread %s; none %s"
              % (t_on.get("far"), t_off.get("far"), t_on.get("counted"), t_all.get("note"), t_mix.get("unread"),
                 t_none.get("note")))

# ── 4. the Great Lakes ──────────────────────────────────────────────────────────────────────────────────────────
fresh()
g4 = A.fetch_water_series([pE], T0, T1)
d2 = km(pE, STATIONS[4])
want4 = (0.42 / 0.01 ** 2 + 0.30 / d2 ** 2) / (1 / 0.01 ** 2 + 1 / d2 ** 2)
check("4. THE GREAT LAKES: no predictions - the observed level stands for the window, a flat line from t0 to t1, kind "
      "observed",
      lambda: g4["ok"] and g4["kind"] == "observed" and [e for e, _v in g4["series"]] == [T0, T1]
              and all(abs(v - want4) < 0.001 for _e, v in g4["series"])
              and g4["start"]["m"] == g4["end"]["m"] == g4["low"]["m"] == g4["high"]["m"],
      lambda: str(g4.get("series")))

# ── 5. STOFS ────────────────────────────────────────────────────────────────────────────────────────────────────
fresh()
INFO = {"cycle": "2026101200", "age_h": 2.0, "used": ["A"], "borrowed": {}, "notes": {}}
A._stofs_lowered = lambda got, need, t0: ({k: [(e, v - 0.25) for e, v in ser] for k, ser in got.items()
                                           if k[0] == "A" and ser}, INFO)
s5 = A.fetch_water_series([pA], T0, T1)
a5 = A.fetch_water_along([pA], T0, T1)
fresh()
s5plain = A.fetch_water_series([pA], T0, T1)
want5 = min(blend(pA, "ABC", e) - 0.25 * (1 / 0.01 ** 2) / sum(1.0 / max(km(pA, s), 0.01) ** 2 for s in STATIONS[:3])
            for e in slots)
check("5. STOFS: a station STOFS lowers is drawn lowered - the series' low the along read's (lowered) low, below the "
      "prediction's - and what STOFS was asked is said; with none held, nothing said",
      lambda: s5["ok"] and abs(s5["low"]["m"] - a5["low_m"]) < 0.0005 and s5["low"]["m"] < s5plain["low"]["m"] - 0.2
              and abs(s5["low"]["m"] - want5) < 0.002 and s5.get("stofs") == INFO and "stofs" not in s5plain,
      lambda: "lowered %s along %s plain %s want %.3f" % (s5.get("low"), a5.get("low_m"), s5plain.get("low"), want5))
fresh()


# ── 6. the query ────────────────────────────────────────────────────────────────────────────────────────────────
def said(path):
    try:
        A._water_series_query(path)
        return None
    except ValueError as e:
        return str(e)


Q = "/api/water/series?pts=43.0,-70.7;43.1,-70.6&t0=100&t1=200"
good = A._water_series_query(Q + "&trust_km=4.5")
plain = A._water_series_query(Q)
bad6 = {"trust 0": said(Q + "&trust_km=0"), "trust negative": said(Q + "&trust_km=-2"),
        "trust text": said(Q + "&trust_km=x"), "trust inf": said(Q + "&trust_km=inf"),
        "trust nan": said(Q + "&trust_km=nan"), "no points": said("/api/water/series?t0=1&t1=2")}
check("6. /api/water/series' QUERY: points, window and trust_km read (none - None); refused in words - a trust that is "
      "not a positive number, no points; the usage line names the route asked (and along's still its own)",
      lambda: good == ([(43.0, -70.7), (43.1, -70.6)], 100.0, 200.0, 4.5) and plain[3] is None and all(bad6.values())
              and "/api/water/series?" in bad6["no points"],
      lambda: "; ".join("%s: %s" % (k, (v or "NOT REFUSED")[:50]) for k, v in bad6.items()))
try:
    A._water_along_query("/api/water/along?t0=1&t1=2")
    along_said = ""
except ValueError as e:
    along_said = str(e)
check("6b. the along read's usage line still names /api/water/along",
      "usage: /api/water/along?" in along_said, along_said)

# ── 7. the wiring ───────────────────────────────────────────────────────────────────────────────────────────────
src = inspect.getsource(A)
get = src[src.index("def do_GET"):]
f_al, f_se = inspect.getsource(A.fetch_water_along), inspect.getsource(A.fetch_water_series)
check("7. THE WIRING: /api/water/series answered (its query read, a refusal a 400) before /api/waterlevel; the along "
      "read and the series gather their stations and blend their slots through the SAME helpers",
      lambda: 0 <= get.index('self.path.startswith("/api/water/series")') < get.index('self.path.startswith("/api/waterlevel")')
              and "pts, t0, t1, trust = _water_series_query(self.path)" in get
              and "fetch_water_series(pts, t0, t1, trust)" in get
              and all("_water_gather(points, t0, timeout)" in f and "_water_blend_at(use, vals, " in f
                      and "_water_slots(use, t0, t1, gl)" in f and "_water_use(cand, datum, got)" in f
                      for f in (f_al, f_se)),
      "")

print("\n" + ("%d CHECK(S) FAILED (%d ran)" % (fails, ran) if fails else "all checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
