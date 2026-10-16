"""tests/speed_zone_sources.py - the states' speed zones, read and merged into the chart (speed_zones.py).

Andy, 2026-10-16: "Try ingesting local data from state GIS portals and merge into the NOAA environment." Measured that
day: New Hampshire, Maine and Massachusetts publish no speed-zone layer (their rules are distances from shore); Florida
(two layers), North Carolina, Maryland and DC do, each its own way. Pinned here, with no network:

    1-1e  EACH STATE'S RECORDS READ AS ITS LAW SAYS, from the values its service really holds: Florida's boating
          restricted areas (idle, slow, a 30 mph limit, 35 ft and over, no entry not a speed), its manatee zones (the
          most restrictive of what the text says, seasons applied all year), North Carolina and DC (every polygon a
          no-wake zone), Maryland (the most restrictive of four regimes; prohibited, PWC-only and none not speeds)
    2-2d  THE FETCH against a stub ArcGIS service: Esri rings to GeoJSON, role speed_zone, ids; a record that is not a
          speed rule counted, never guessed; PAGED past the service's page; a zone crossing tiles served once; a box
          outside a state not asked
    3-3c  THE CACHE AND FAILURE: a tile asked once a week; a service down said in the report, not asked again for a
          while, and its last good answer served, said stale; the chart served whatever happens
    4     THE WIRING: /api/enc merges them (asv_console.py _serve_enc)
    5-5f  WHOSE WATER, for New Hampshire's, Maine's and Massachusetts' rules (2026-10-16), against a stub boundary
          service: the clip to the chart's box; each state's water as a feature, clipped; cached a month, the last copy
          served when the service is down; a state never read NAMED unread (the page applies that state's rules in its
          box there); a box away from them asks nothing; merged into the chart; each state asked only where its box reaches

    python tests/speed_zone_sources.py      # exit 0 = pass   (stdlib only)
"""
import json
import os
import shutil
import sys
import tempfile
import threading
import urllib.parse
from http.server import BaseHTTPRequestHandler, HTTPServer

APP = os.environ.get("ASV_APP") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)


CACHE = tempfile.mkdtemp(prefix="asv_speed_")       # the zone cache the fetch checks write, removed whatever happens
CACHE2 = tempfile.mkdtemp(prefix="asv_states_")     # and the state boundaries' (section 5)


def _crash_report(_t, e, _tb):
    shutil.rmtree(CACHE, ignore_errors=True)
    shutil.rmtree(CACHE2, ignore_errors=True)
    print("  FAIL 0. the suite itself CRASHED before finishing - %r" % (e,))
    print("\n1 CHECK(S) FAILED (crashed before finishing)")
    sys.stdout.flush()
    os._exit(1)


sys.excepthook = _crash_report
import speed_zones as SZ  # noqa: E402

fails = ran = 0


def check(name, cond, detail=""):
    global fails, ran
    ran += 1
    try:
        ok = bool(cond() if callable(cond) else cond)
    except Exception as e:                       # a check that throws is a failed check, said
        ok, detail = False, "THREW: %r" % (e,)
    print(("  ok   " if ok else "  FAIL ") + name + ("   [%s]" % detail if detail else ""))
    if not ok:
        fails += 1


print("The states' speed zones:")

# ── 1. each state's records ──────────────────────────────────────────────────────────────────────────────────────────
fl = {k: SZ._fl_bra(v) for k, v in {
    "idle": {"RESTRICTION": "Idle Speed No Wake", "CON_SHORT": "At All Times", "AREA_NAME": "Rickenbacker Causeway Bridge", "AREA_NUM": "68D-24.013(1)(a)7."},
    "slow": {"RESTRICTION": "Slow Speed Minimum Wake - Conditional", "CON_SHORT": "During Flooding", "AREA_NAME": "X"},
    "mph": {"RESTRICTION": "Max Speed 30 MPH / Max Wake 15 Inches / Max Sound 80 dBA", "CON_SHORT": "At All Times"},
    "big": {"RESTRICTION": "Idle Speed No Wake", "CON_SHORT": "Vessels 35 feet or more in length, Nov 1 through Apr 30."},
    "entry": {"RESTRICTION": "No Entry - Water Control Structure", "CON_SHORT": "At All Times"},
    "anchor": {"RESTRICTION": "Anchoring, mooring, beaching and grounding prohibited.", "CON_SHORT": "At All Times"},
}.items()}
check("1. FLORIDA BOATING RESTRICTED AREAS: Idle Speed No Wake is idle, Slow Speed Minimum Wake (conditional, during "
      "flooding) slow - its condition kept in the text; 30 MPH is 26.1 kn; 'vessels 35 feet or more' binds 10.7 m and "
      "over; no entry and no anchoring are not speed rules",
      lambda: fl["idle"]["rule"] == "idle" and fl["idle"]["name"] == "Rickenbacker Causeway Bridge"
      and "68D-24.013(1)(a)7." in fl["idle"]["text"] and fl["slow"]["rule"] == "slow" and "During Flooding" in fl["slow"]["text"]
      and fl["mph"]["rule"] == "limit" and fl["mph"]["limit_kn"] == 26.1 and fl["big"]["min_length_m"] == 10.7
      and fl["entry"] is None and fl["anchor"] is None,
      json.dumps(fl)[:400])
mz = {k: SZ._fl_manatee(v) for k, v in {
    "slow": {"TEXT_68C": "Slow Speed (All Year)", "MASTER_CL": "SS", "COUNTY": "MIAMI-DADE", "SECT_68C": "68C-22.025(1)(a)14."},
    "lead": {"TEXT_68C": "Idle", "MASTER_CL": " IS"},
    "season": {"TEXT_68C": "Slow Speed (Nov 15 - Apr 30), 30 MPH (Remainder of Year)", "MASTER_CL": "SS"},
    "night": {"TEXT_68C": "Max 30 MPH/25 MPH Night (All Year)", "MASTER_CL": "30"},
    "code": {"TEXT_68C": "", "MASTER_CL": "25"},
    "ne": {"TEXT_68C": "No Entry (All Year)", "MASTER_CL": "NE"},
    "late": {"TEXT_68C": "Slow Speed (Apr 1 - Oct 31), Idle Speed (Nov 1 - Mar 31)", "MASTER_CL": "SS"},
}.items()}
check("1b. FLORIDA MANATEE ZONES: the most restrictive of what each says - slow all year; ' IS' (a stray space) idle; "
      "slow in season, 30 mph the rest - slow, all year; 30 by day 25 at night - 21.7 kn; a bare class 25 - 21.7 kn; no "
      "entry not a speed rule; idle in one season after slow in another (class SS) - idle",
      lambda: mz["slow"]["rule"] == "slow" and "MIAMI-DADE" in mz["slow"]["name"] and mz["lead"]["rule"] == "idle"
      and mz["season"]["rule"] == "slow" and mz["night"]["rule"] == "limit" and mz["night"]["limit_kn"] == 21.7
      and mz["code"]["limit_kn"] == 21.7 and mz["ne"] is None and mz["late"]["rule"] == "idle",
      json.dumps(mz)[:400])
nc = SZ._nc({"WATERBODY": "DOUGHS CREEK", "LOCATION": "off Shallowbag Bay", "CODE": "15A NCAC 10F .0310 (a) (1) (A)"})
dc = SZ._dc({"DESCRIPTIO": "River"})
check("1c. NORTH CAROLINA AND DC: every polygon a no-wake zone - named by its water, its rule cited",
      lambda: nc["rule"] == "no_wake" and nc["name"] == "DOUGHS CREEK - off Shallowbag Bay" and "10F .0310" in nc["text"]
      and dc["rule"] == "no_wake" and dc["name"] == "DC no-wake zone (river)",
      json.dumps([nc, dc]))
md = {k: SZ._md(dict({"RIV": "WEEMS", "COMAR_CODE": "08.18.24.02G1"}, **v)) for k, v in {
    "at": {"BDAY15": "6 AT", "BNIGHT15": "6 AT", "NDAY15": "6 AT", "NNIGHT15": "6 AT"},
    "ssh": {"BDAY15": "6 SSH 26 WEEKDAY", "BNIGHT15": "6 SSH", "NDAY15": "NONE", "NNIGHT15": "NONE"},
    "min": {"BDAY15": "MIN", "BNIGHT15": "6 AT", "NDAY15": "35 KNOTS", "NNIGHT15": None},
    "pro": {"BDAY15": "PRO", "BNIGHT15": "PRO_CONTACT", "NDAY15": "NONE", "NNIGHT15": ""},
    "pwc": {"BDAY15": "PWC IDLE", "BNIGHT15": "SKI", "NDAY15": "NONE", "NNIGHT15": "NONE"},
    "typo": {"BDAY15": "6AT", "BNIGHT15": "35 SSH", "NDAY15": "NONE", "NNIGHT15": "NONE"},
}.items()}
check("1d. MARYLAND: the most restrictive of its four regimes, in knots - 6 at all times 6; 6 on weekends, 26 weekdays, "
      "none off season - 6; minimum wake in one regime - slow; prohibited, PWC-only and a ski area are not speed rules "
      "(none); a typo '6AT' still 6; the regimes kept in the text",
      lambda: md["at"]["limit_kn"] == 6 and md["ssh"]["limit_kn"] == 6 and md["min"]["rule"] == "slow"
      and md["pro"] is None and md["pwc"] is None and md["typo"]["limit_kn"] == 6 and md["at"]["name"] == "WEEMS"
      and "season day 6 AT" in md["at"]["text"],
      json.dumps(md)[:400])
ids = sorted(s["id"] for s in SZ.SOURCES)
check("1e. THE SOURCES: the five verified services, each with the water it covers - and none for NH, ME or MA, which "
      "publish none",
      lambda: ids == ["dc_nwz", "fl_bra", "fl_manatee", "md_speed", "nc_nwz"]
      and all(len(s["covers"]) == 4 and s["url"].startswith("https://") for s in SZ.SOURCES)
      and not any(s["covers"][0] <= -70.7 <= s["covers"][2] and s["covers"][1] <= 43.07 <= s["covers"][3] for s in SZ.SOURCES),
      ",".join(ids))

# ── 2. the fetch, against a stub ArcGIS service ─────────────────────────────────────────────────────────────────────
HITS = []
STATE = {"down": False}
SQ = lambda w, s, d: [[w, s], [w + d, s], [w + d, s + d], [w, s + d], [w, s]]
RECS = [{"attributes": {"OBJECTID": i, "KIND": "slow" if i % 3 else "entry"}, "geometry": {"rings": [SQ(-80.20 + i * 0.001, 25.75, 0.0005)]}}
        for i in range(1, 8)]
RECS.append({"attributes": {"OBJECTID": 99, "KIND": "slow"}, "geometry": {"rings": [SQ(-80.0005, 25.75, 0.001)]}})   # astride the -80.0 tile edge
RECS.append({"attributes": {"OBJECTID": 50, "KIND": "entry"}, "geometry": {"rings": [SQ(-79.95, 25.72, 0.0005)]}})    # not a speed rule, in another tile


class Stub(BaseHTTPRequestHandler):
    def do_GET(self):
        HITS.append(self.path)
        if STATE["down"]:
            self.send_response(503); self.end_headers(); return
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        w, s, e, n = (float(x) for x in q["geometry"][0].split(","))
        inbox = [r for r in RECS if any(w <= c[0] <= e and s <= c[1] <= n for c in r["geometry"]["rings"][0])]
        off = int((q.get("resultOffset") or ["0"])[0])
        page = inbox[off:off + 3]                       # a page of 3: the paging has to work
        body = json.dumps({"features": page, "exceededTransferLimit": off + 3 < len(inbox)}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)

    def log_message(self, *a):
        pass


srv = HTTPServer(("127.0.0.1", 0), Stub)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = "http://127.0.0.1:%d/arcgis/rest/services/x/FeatureServer/0" % srv.server_port
SRC = {"id": "stub", "name": "Stub boating zones", "covers": (-81.0, 25.0, -79.0, 26.5), "url": URL,
       "rule_of": lambda a: {"rule": "slow", "limit_kn": None, "name": "Zone %d" % a["OBJECTID"], "text": "t"} if a["KIND"] == "slow" else None}
try:
    BOX = (-80.2, 25.7, -79.9, 25.8)                    # four tiles: -80.25..-80.0 / -80.0..-79.75 by 25.5..25.75 / 25.75..26
    NT = len(SZ._tiles(BOX))
    feats, rep = SZ.zones_for_bbox(BOX, CACHE, None, [SRC], now=1000.0)
    names = sorted(f["props"]["name"] for f in feats)
    g = feats[0]["geometry"] if feats else {}
    check("2. FETCHED, READ AND MERGED: Esri rings to a GeoJSON Polygon, role speed_zone, named, its source and id; the "
          "records that are not a speed rule counted (unread) - once each, though two lie on a tile edge - never guessed; "
          "the report says it answered",
          lambda: len(feats) == 6 and feats[0]["role"] == "speed_zone" and g.get("type") == "Polygon" and len(g["coordinates"][0]) == 5
          and feats[0]["props"]["source"] == "Stub boating zones" and feats[0]["props"]["zone_id"].startswith("stub|")
          and rep[0]["ok"] and rep[0]["count"] == 6 and rep[0]["unread"] == 3,
          json.dumps({"names": names, "rep": rep}))
    pages = [h for h in HITS if "resultOffset=3" in h]
    check("2b. PAGED: the tile with 7 records answered 3 a page - read to the end (a second and third page asked)",
          lambda: len(pages) >= 1 and any("resultOffset=6" in h for h in HITS),
          "%d requests" % len(HITS))
    check("2c. A ZONE ASTRIDE TWO TILES is served once (Zone 99 crosses -80.0)",
          lambda: names.count("Zone 99") == 1, ",".join(names))
    n0 = len(HITS)
    far, rep_far = SZ.zones_for_bbox((-70.8, 43.0, -70.6, 43.1), CACHE, None, [SRC], now=1000.0)
    check("2d. A BOX OUTSIDE THE STATE is not asked (New Castle, NH against a Florida source): no request, no report",
          lambda: far == [] and rep_far == [] and len(HITS) == n0)

    # ── 3. the cache and failure ─────────────────────────────────────────────────────────────────────────────────────
    n1 = len(HITS)
    again, rep2 = SZ.zones_for_bbox(BOX, CACHE, None, [SRC], now=1000.0 + 3600)
    check("3. CACHED: the same box an hour later asks the service nothing, serves the same zones, and says they came from "
          "the cache",
          lambda: NT == 4 and len(HITS) == n1 and len(again) == 6 and rep2[0]["cached"] == NT and rep2[0]["ok"],
          json.dumps(rep2))
    STATE["down"] = True
    later = 1000.0 + SZ.SPEED_CACHE_TTL_S + 60
    n2 = len(HITS)
    old, rep3 = SZ.zones_for_bbox(BOX, CACHE, None, [SRC], now=later)
    n3 = len(HITS)
    old2, rep4 = SZ.zones_for_bbox(BOX, CACHE, None, [SRC], now=later + 30)
    check("3b. A SERVICE DOWN past the cache's week: said in the report (not ok, the error), its last good answer SERVED "
          "and said stale - and not asked again a moment later",
          lambda: n3 > n2 and not rep3[0]["ok"] and rep3[0]["error"] and len(old) == 6
          and len(HITS) == n3 and len(old2) == 6 and not rep4[0]["ok"] and rep3[0]["stale"] == NT,
          json.dumps(rep3))
    STATE["down"] = False

    def boom(*a, **k):
        raise RuntimeError("the zone reader fell over")
    chart = {"features": [{"role": "land"}], "band": "harbour"}
    real = SZ.zones_for_bbox
    SZ.zones_for_bbox = boom
    try:
        merged = SZ.merge_into_chart(chart, BOX, CACHE)
    finally:
        SZ.zones_for_bbox = real
    ok_chart = SZ.merge_into_chart({"features": [{"role": "land"}]}, BOX, CACHE, None, [SRC])
    check("3c. MERGED INTO THE CHART: its features plus the zones, and `speed_sources` saying what was asked; a reader "
          "that falls over leaves the chart as it was, with one line saying so",
          lambda: merged["features"] == [{"role": "land"}] and not merged["speed_sources"][0]["ok"]
          and "fell over" in merged["speed_sources"][0]["error"]
          and len(ok_chart["features"]) == 7 and ok_chart["speed_sources"][0]["id"] == "stub",
          json.dumps(merged["speed_sources"]))
finally:
    srv.shutdown()
    shutil.rmtree(CACHE, ignore_errors=True)

# ── 5. whose water: New Hampshire's and Maine's, for their shore rules (state_waters_for_bbox), against a stub TIGERweb ─
TIGER_HITS = []
TIGER = {"down": set(), "rings": {
    "NH": [[[-71.0, 42.9], [-70.73, 42.9], [-70.73, 43.2], [-71.0, 43.2], [-71.0, 42.9]]],
    "ME": [[[-70.73, 42.9], [-70.4, 42.9], [-70.4, 43.3], [-70.73, 43.3], [-70.73, 42.9]]],
    "MA": [[[-71.1, 41.2], [-69.9, 41.2], [-69.9, 42.87], [-71.1, 42.87], [-71.1, 41.2]]]}}


class TigerStub(BaseHTTPRequestHandler):
    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        st = q["where"][0].split("'")[1]
        TIGER_HITS.append(st)
        if st in TIGER["down"]:
            body = json.dumps({"error": {"code": 500, "message": "stub down"}}).encode()
        else:
            body = json.dumps({"features": [{"attributes": {"STUSAB": st}, "geometry": {"rings": TIGER["rings"][st]}}]}).encode()
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.end_headers(); self.wfile.write(body)

    def log_message(self, *a):
        pass


def pip(p, ring):                                        # ray casting, for the clip's point test
    inside, j = False, len(ring) - 1
    for i in range(len(ring)):
        (xi, yi), (xj, yj) = ring[i], ring[j]
        if (yi > p[1]) != (yj > p[1]) and p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


tsrv = HTTPServer(("127.0.0.1", 0), TigerStub)
threading.Thread(target=tsrv.serve_forever, daemon=True).start()
real_url = SZ.TIGER_STATES_URL
SZ.TIGER_STATES_URL = "http://127.0.0.1:%d/TIGERweb/State_County/MapServer/0/query" % tsrv.server_port
try:
    # the clip: a ring wholly in the box is itself; one wholly out is nothing; a ring across the box is cut to it - and
    # inside the box its point test is the ring's own (an L-shaped ring, 400 points)
    import random
    rnd = random.Random(5)
    L = [[0, 0], [4, 0], [4, 1], [1, 1], [1, 4], [0, 4], [0, 0]]
    box = (0.5, 0.5, 3.0, 3.0)
    cut = SZ.clip_ring(L, box)
    same = all(pip(p, cut) == pip(p, L) for p in ([rnd.uniform(0.5, 3.0), rnd.uniform(0.5, 3.0)] for _ in range(400)))
    D = [[1.75, -1], [4.5, 1.75], [1.75, 4.5], [-1, 1.75], [1.75, -1]]      # a diamond: every cut across a slanted edge
    dcut = SZ.clip_ring(D, box)
    dsame = all(pip(p, dcut) == pip(p, D) for p in ([rnd.uniform(0.5, 3.0), rnd.uniform(0.5, 3.0)] for _ in range(400)))
    check("5. THE CLIP: a ring inside the box is itself, closed; one outside is nothing; an L across the box is cut to it, "
          "every vertex in the box, and inside the box a point is in the cut ring exactly when it is in the L - and in a diamond "
          "cut across its slanted edges (400 points each)",
          lambda: SZ.clip_ring([[1, 1], [2, 1], [2, 2], [1, 1]], (0, 0, 3, 3)) == [[1, 1], [2, 1], [2, 2], [1, 1]]
          and SZ.clip_ring([[5, 5], [6, 5], [6, 6], [5, 5]], (0, 0, 3, 3)) == []
          and cut[0] == cut[-1] and all(0.5 - 1e-9 <= x <= 3.0 + 1e-9 and 0.5 - 1e-9 <= y <= 3.0 + 1e-9 for x, y in cut) and same and dsame,
          json.dumps(cut))
    BOXS = (-70.8, 43.0, -70.7, 43.1)                   # New Castle: across the state line at -70.73
    sw, srep = SZ.state_waters_for_bbox(BOXS, CACHE2, now=1000.0)
    by = {f["props"]["state"]: f for f in sw}
    xs = lambda f: [c[0] for r in f["geometry"]["coordinates"] for c in r]
    check("5b. NEW HAMPSHIRE'S AND MAINE'S WATER over the box, from the boundary service: one feature each, role state_water, "
          "named by its state; each ring CLIPPED to the box and 0.02 deg round it (New Hampshire -70.82 to the line at "
          "-70.73, Maine the line to -70.68); none unread; the report says it answered",
          lambda: sorted(by) == ["ME", "NH"] and all(f["role"] == "state_water" for f in sw)
          and abs(min(xs(by["NH"])) + 70.82) < 1e-9 and abs(max(xs(by["NH"])) + 70.73) < 1e-9
          and abs(min(xs(by["ME"])) + 70.73) < 1e-9 and abs(max(xs(by["ME"])) + 70.68) < 1e-9
          and by["NH"]["props"]["unread"] == [] and srep["ok"] and srep["count"] == 2 and srep["id"] == "tiger_states"
          and sorted(TIGER_HITS) == ["ME", "NH"],
          json.dumps(srep))
    n0 = len(TIGER_HITS)
    sw2, srep2 = SZ.state_waters_for_bbox(BOXS, CACHE2, now=1000.0 + 86400)
    TIGER["down"] = {"NH", "ME"}
    sw3, srep3 = SZ.state_waters_for_bbox(BOXS, CACHE2, now=1000.0 + SZ.STATE_TTL_S + 60)
    n3 = len(TIGER_HITS)
    sw4, srep4 = SZ.state_waters_for_bbox(BOXS, CACHE2, now=1000.0 + SZ.STATE_TTL_S + 90)
    check("5c. CACHED A MONTH: a day later the service is not asked and the same water is served; past the month with the "
          "service down, the last copy is served and the failure said - and the service not asked again a moment later",
          lambda: len(TIGER_HITS) - n0 == 2 and len(sw2) == 2 and srep2["cached"] == 2 and len(sw3) == 2 and not srep3["ok"]
          and "stub down" in (srep3["error"] or "") and len(TIGER_HITS) == n3 and len(sw4) == 2,
          json.dumps({"hits": TIGER_HITS[n0:], "rep3": srep3}))
    # a cold cache: Maine's boundary down, New Hampshire's read - Maine named UNREAD on the water that was read
    SZ._failed.clear()
    TIGER["down"] = {"ME"}
    cold = os.path.join(CACHE2, "cold")                 # a cache never written (inside CACHE2, removed with it)
    sw5, srep5 = SZ.state_waters_for_bbox(BOXS, cold, now=5000.0)
    TIGER["down"] = {"NH", "ME"}
    SZ._failed.clear()
    cold2 = os.path.join(CACHE2, "cold2")
    sw6, srep6 = SZ.state_waters_for_bbox(BOXS, cold2, now=5000.0)
    check("5d. A STATE NEVER READ IS NAMED: Maine's boundary down with nothing cached - New Hampshire's water served with "
          "Maine named unread (the page applies the stricter rule there), the failure in the report; both down - no water, "
          "said",
          lambda: [f["props"]["state"] for f in sw5] == ["NH"] and sw5[0]["props"]["unread"] == ["ME"] and not srep5["ok"]
          and "ME" in srep5["error"] and sw6 == [] and not srep6["ok"],
          json.dumps({"rep5": srep5, "rep6": srep6}))
    n7 = len(TIGER_HITS)
    far7, rep7 = SZ.state_waters_for_bbox((-80.3, 25.7, -80.1, 25.9), CACHE2, now=9000.0)
    n7b = len(TIGER_HITS)
    TIGER["down"] = set()
    SZ._failed.clear()
    m8 = SZ.merge_into_chart({"features": [{"role": "land"}]}, BOXS, CACHE2)
    m9 = SZ.merge_into_chart({"features": [{"role": "land"}]}, BOXS, CACHE2, None, [])
    check("5e. A BOX OUTSIDE THEIR WATER asks nothing and says nothing (Miami); MERGED INTO THE CHART with the state zones "
          "- the water features after the chart's and the boundary service in `speed_sources`; not asked when the caller "
          "names its own sources",
          lambda: far7 == [] and rep7 is None and n7b == n7
          and [f["role"] for f in m8["features"]] == ["land", "state_water", "state_water"]
          and any(r["id"] == "tiger_states" for r in m8["speed_sources"])
          and [f["role"] for f in m9["features"]] == ["land"] and not any(r["id"] == "tiger_states" for r in m9["speed_sources"]),
          json.dumps({"m8": [f["role"] for f in m8["features"]], "m9": [f["role"] for f in m9["features"]], "far": [far7, rep7], "hits": n7b - n7}))
    # each state asked only where its box reaches (LAW_STATE_BOXES): Gloucester asks Massachusetts alone; the Seabrook /
    # Salisbury line asks all three; and Massachusetts unread is named there
    del TIGER_HITS[:]
    gl, glrep = SZ.state_waters_for_bbox((-70.70, 42.57, -70.62, 42.63), CACHE2, now=20000.0)
    gl_hits = list(TIGER_HITS)
    del TIGER_HITS[:]
    SZ._failed.clear()
    TIGER["down"] = {"MA"}
    sb, sbrep = SZ.state_waters_for_bbox((-70.90, 42.80, -70.80, 42.95), os.path.join(CACHE2, "border"), now=20000.0)
    sb_hits = sorted(TIGER_HITS)
    TIGER["down"] = set()
    check("5f. EACH STATE ASKED ONLY WHERE ITS BOX REACHES: a Gloucester chart asks Massachusetts' line alone (its feature names "
          "what was asked; the report names the state); a chart on the New Hampshire / Massachusetts line asks all three - "
          "and with Massachusetts' line down, the water read (New Hampshire's - the stub's Maine lies east of it) names it unread",
          lambda: gl_hits == ["MA"] and [f["props"]["state"] for f in gl] == ["MA"] and gl[0]["props"]["asked"] == ["MA"]
          and glrep["name"] == "US Census state boundaries (MA)" and sb_hits == ["MA", "ME", "NH"]
          and [f["props"]["state"] for f in sb] == ["NH"] and all(f["props"]["unread"] == ["MA"] for f in sb)
          and sorted(sb[0]["props"]["asked"]) == ["MA", "ME", "NH"],
          json.dumps({"gl_hits": gl_hits, "gl": [f["props"] for f in gl], "sb_hits": sb_hits, "sb": [f["props"] for f in sb]}))
finally:
    SZ.TIGER_STATES_URL = real_url
    tsrv.shutdown()
    shutil.rmtree(CACHE2, ignore_errors=True)

# ── 4. the wiring ─────────────────────────────────────────────────────────────────────────────────────────────────────
SRC_PY = open(os.path.join(APP, "asv_console.py"), encoding="utf-8").read()
check("4. THE WIRING: the console imports the reader and /api/enc merges the zones into the chart it serves, cached under "
      "charts/speed",
      lambda: "import speed_zones" in SRC_PY
      and "data = speed_zones.merge_into_chart(data, bbox, SPEED_ZONE_DIR, _enc_ssl())" in SRC_PY
      and 'SPEED_ZONE_DIR = os.path.join(CHART_DIR, "speed")' in SRC_PY)
_keep = SRC_PY[SRC_PY.index("ENC_KEEP_PROPS = ("):SRC_PY.index(")", SRC_PY.index("ENC_KEEP_PROPS = ("))]
check("4b. ... AND THE CHART KEEPS WHAT MASSACHUSETTS' RULE READS: a shoreline construction's category (a ramp from a pier), "
      "a small-craft facility's and a harbor facility's (a yacht harbor from a ferry terminal) - dropped, every ramp is a "
      "pier and the 150 ft of a launch never holds",
      lambda: all('"%s"' % k in _keep for k in ("CATSLC", "CATSCF", "CATHAF")), _keep[-80:])

print("\n" + ("%d CHECK(S) FAILED" % fails if fails else "all checks passed") + " (%d)" % ran)
sys.exit(1 if fails else 0)
