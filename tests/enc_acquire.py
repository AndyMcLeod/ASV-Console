"""tests/enc_acquire.py - the chart is READ WHOLE, or said not to be; and kept no longer than it is current.

Andy, 2026-10-12: "Review ENC acquisition and awareness code. Ensure that all layers of all tiles downloaded are read
..." - then "Carry on as you recommend." The review's acquisition findings, each pinned here (the service stubbed, the
cache a temp folder - hermetic):
  1    a by-id geometry answer that is an ArcGIS ERROR payload (HTTP 200) or cut short (exceededTransferLimit) RAISES -
       it answered `.get("features", [])`, no features and no exception;
  2    a layer's by-id answer SHORT of its ids fails the layer ON THE PATH EVERY READ TAKES - the length test ran only
       after the fallback, so a stubbed 0 of 5 came back `complete: True` and would have been kept for good;
  2b   a refusal by the service is TRIED AGAIN (three times) before the layer is failed - measured 2026-08-16, 4 in
       flight with 4 attempts came back whole where 8 with none lost layers on every run;
  2c   ... and a dead link is NOT tried again: three 25 s timeouts would hold every read 75 s before the copy on disk;
  3    a band's layer list is asked for again once it is a month old (a republished service may number its layers
       anew) - and a renewal that fails keeps the list it had;
  4    the chart-source card's answer (cells, zones of confidence) with a FAILED query is served once and not kept - it
       was kept, empty, for ever - and one a week old is read again;
  5    a tile a week old is SERVED at once and read again BEHIND it (NOAA corrects its cells week by week; a tile was
       kept for ever): the new read replaces it in memory and on disk; a fresh one is not read again; a re-read that
       fails leaves the copy as it was; the layered read reports the oldest tile's date and how many are past a week;
  6    the hull's overhead inputs (hull.air_draft_m, planning.overhead_clearance_m) are SAFETY inputs: a wrong type or a
       negative is refused at load; every shipped profile carries both;
  7    nothing here wrote to the app's own chart cache.

  python tests/enc_acquire.py   # exit 0 = pass
"""
import io
import json
import os
import shutil
import sys
import tempfile
import time
import urllib.error


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


APP_ENC = os.path.join(APP, "charts", "enc")
before = set(os.listdir(APP_ENC)) if os.path.isdir(APP_ENC) else set()
TMP = tempfile.mkdtemp(prefix="asv_enc_acquire_")
A.ENC_DIR = TMP
A.ENC_QUERY_BACKOFF_S = (0.0, 0.0)                          # the retries' waits, not their number, are what is stubbed
print("The chart read whole, or said not to be:")


class _Resp(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False


def answering(payloads):
    """A urlopen that answers each call with the next payload (a dict -> JSON, an Exception -> raised)."""
    calls = []

    def urlopen(req, timeout=None, **_k):
        calls.append(getattr(req, "full_url", req))
        p = payloads[min(len(calls) - 1, len(payloads) - 1)]
        if isinstance(p, Exception):
            raise p
        return _Resp(json.dumps(p).encode("utf-8"))
    return urlopen, calls


_urlopen = A.urllib.request.urlopen
try:
    # ── 1. the by-id answer ───────────────────────────────────────────────────────────────────────────────────────
    feats = [{"id": i, "properties": {}, "geometry": {"type": "Point", "coordinates": [0, 0]}} for i in range(3)]
    out = {}
    for name, payload in (("error", {"error": {"code": 500, "message": "Could not find service"}}),
                          ("cut", {"features": feats[:1], "exceededTransferLimit": True}), ("whole", {"features": feats})):
        A.urllib.request.urlopen, _ = answering([payload])
        try:
            out[name] = len(A._enc_query_by_ids("enc_harbour", 1, [0, 1, 2]))
        except ValueError as e:
            out[name] = "raised: " + str(e)[:40]
    check("1. A BY-ID ANSWER that is an ArcGIS error payload (HTTP 200) RAISES, and so does one the service cut short; a "
          "whole one is the features",
          lambda: str(out["error"]).startswith("raised") and str(out["cut"]).startswith("raised") and out["whole"] == 3,
          lambda: json.dumps(out))
finally:
    A.urllib.request.urlopen = _urlopen

# ── 2. a layer short of its ids, retried, and a dead link ────────────────────────────────────────────────────────────
saved = (A._enc_layer_map, A._enc_query_ids, A._enc_query_by_ids, A._enc_query, A.ENC_ROLES)
A._enc_layer_map = lambda band, timeout=20.0: {"Depth_Area": 1}
A.ENC_ROLES = {"depth_area": ["Depth_Area"]}
F5 = [{"id": i, "properties": {"DRVAL1": 0.0, "DRVAL2": 1.8},
       "geometry": {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}} for i in range(5)]
tries = {"ids": 0, "by": 0, "direct": 0}


def ids_ok(band, lid, bbox, timeout=25.0):
    tries["ids"] += 1
    return [0, 1, 2, 3, 4]


def run(by_ids, ids=ids_ok, direct=None):
    for k in tries:
        tries[k] = 0
    A._enc_query_ids, A._enc_query_by_ids = ids, by_ids

    def _direct(band, lid, bbox, timeout=25.0, count_only=False, max_records=2000):
        tries["direct"] += 1
        if direct is None:
            raise OSError("no direct answer")
        return direct
    A._enc_query = _direct
    d = A.fetch_enc_features([-70.8, 43.0, -70.7, 43.1], band="enc_harbour", extras=False, use_cache=False)
    return {"n": len(d["features"]), "partial": d.get("partial"), "complete": d.get("complete"), **dict(tries)}


def by_short(band, lid, ids, timeout=30.0, batch=200):
    tries["by"] += 1
    return F5[:2]


def by_flaky(band, lid, ids, timeout=30.0, batch=200):
    tries["by"] += 1
    if tries["by"] < 3:
        raise ValueError("ENC by id: Could not find service")
    return F5


def by_dead(band, lid, ids, timeout=30.0, batch=200):
    tries["by"] += 1
    raise ValueError("ENC by id: Could not find service")


def ids_dead(band, lid, bbox, timeout=25.0):
    tries["ids"] += 1
    raise urllib.error.URLError("timed out")


# A BODY CUT MID-READ (the 2026-10-16 review, finding 9): http.client.IncompleteRead is an HTTPException, neither an
# OSError nor a ValueError, and NOTHING in the reader caught it - one cut among a tile's ~600 queries unwound the whole
# build. The water-level readers catch it; the chart reader must too: tried again like a refusal, a failed layer when it
# persists.
import http.client as _hc


def by_cut(band, lid, ids, timeout=30.0, batch=200):
    tries["by"] += 1
    if tries["by"] < 3:
        raise _hc.IncompleteRead(b"x", 100)
    return F5


def by_cut_always(band, lid, ids, timeout=30.0, batch=200):
    tries["by"] += 1
    raise _hc.IncompleteRead(b"x", 100)


def ids_503(band, lid, bbox, timeout=25.0):
    tries["ids"] += 1
    if tries["ids"] < 2:
        raise urllib.error.HTTPError("u", 503, "Service Unavailable", {}, None)
    return [0, 1, 2, 3, 4]


try:
    short = run(by_short)
    flaky = run(by_flaky)
    dead_by = run(by_dead, direct={"features": F5[:4]})
    dead_err = run(by_dead, direct={"error": {"code": 500}})
    dead_link = run(by_short, ids=ids_dead)
    busy = run(lambda *a, **k: F5, ids=ids_503)
    cut = run(by_cut)
    cut_always = run(by_cut_always, direct={"error": {"code": 500}})
finally:
    A._enc_layer_map, A._enc_query_ids, A._enc_query_by_ids, A._enc_query, A.ENC_ROLES = saved
check("2. A LAYER SHORT OF ITS IDS on the by-id path every read takes - 2 of 5 - is a FAILED layer: `partial` names it "
      "and the extract is not complete (it was complete, and would have been kept for good)",
      lambda: short["partial"] == ["Depth_Area"] and not short["complete"] and short["n"] == 2,
      lambda: json.dumps(short))
check("2b. A REFUSAL BY THE SERVICE is tried again: an error payload twice, then whole, on the third try - complete; one "
      "refused three times falls to the direct query, which, short (4 of 5) or itself an error payload, fails the layer; "
      "an HTTP 503 is tried again too",
      lambda: flaky["complete"] and flaky["by"] == 3 and flaky["n"] == 5
              and dead_by["by"] == A.ENC_QUERY_ATTEMPTS and dead_by["direct"] == 1 and dead_by["partial"] == ["Depth_Area"]
              and dead_err["partial"] == ["Depth_Area"] and dead_err["n"] == 0
              and busy["complete"] and busy["ids"] == 2,
      lambda: "flaky %s; dead %s; dead+error %s; 503 %s" % (json.dumps(flaky), json.dumps(dead_by), json.dumps(dead_err), json.dumps(busy)))
check("2d. A BODY CUT MID-READ (IncompleteRead) is tried again like a refusal - cut twice, whole on the third try, complete; "
      "cut every time, with the direct query an error payload too, the LAYER fails (partial) and the read goes on - it "
      "used to unwind the whole tile build",
      lambda: cut["complete"] and cut["by"] == 3 and cut["n"] == 5
              and cut_always["partial"] == ["Depth_Area"] and not cut_always["complete"] and cut_always["by"] == A.ENC_QUERY_ATTEMPTS and cut_always["n"] == 0,
      lambda: "cut %s; always %s" % (json.dumps(cut), json.dumps(cut_always)))
check("2c. ... and a DEAD LINK (no route, a timeout) is NOT tried again - the layer fails on the first try",
      lambda: dead_link["ids"] == 1 and dead_link["partial"] == ["Depth_Area"],
      lambda: json.dumps(dead_link))

# ── 3. a band's layer list, renewed ──────────────────────────────────────────────────────────────────────────────────
# -- 2e. twelve tries (2026-10-19) --------------------------------------------------------------
# NOAA mid-republish answered 47 of 94 requests with its "Could not find service" fault - each request on its own, at
# random, at 2, 4 or 8 in flight alike. Three tries at that rate left a tenth of a tile's layers failed; twelve, each
# independent, one query in fourteen thousand. The waits are short and grow (the suite zeroes them above).
saved = (A._enc_layer_map, A._enc_query_ids, A._enc_query_by_ids, A._enc_query, A.ENC_ROLES)
A._enc_layer_map = lambda band, timeout=20.0: {"Depth_Area": 1}
A.ENC_ROLES = {"depth_area": ["Depth_Area"]}


def by_nine(band, lid, ids, timeout=30.0, batch=200):
    tries["by"] += 1
    if tries["by"] < 10:
        raise ValueError("ENC by id: Could not find service")
    return F5


def by_always(band, lid, ids, timeout=30.0, batch=200):
    tries["by"] += 1
    raise ValueError("ENC by id: Could not find service")


try:
    nine = run(by_nine)
    always = run(by_always, direct={"error": {"code": 500}})
finally:
    A._enc_layer_map, A._enc_query_ids, A._enc_query_by_ids, A._enc_query, A.ENC_ROLES = saved
_src_py = open(A.__file__, encoding="utf-8").read()
check("2e. A REFUSAL NINE TIMES OVER, whole on the tenth, is a layer read WHOLE (twelve tries, 2026-10-19 - NOAA's fault on "
      "every other request); refused every time it falls to the direct query and fails; the shipped waits are seven, short, "
      "and grow",
      lambda: nine["complete"] and nine["by"] == 10 and nine["n"] == 5 and always["by"] == A.ENC_QUERY_ATTEMPTS == 12
              and always["partial"] == ["Depth_Area"]
              and "ENC_QUERY_BACKOFF_S = (0.2, 0.3, 0.5, 0.8, 1.2, 1.5, 2.0)" in _src_py,
      lambda: "nine %s; always %s" % (json.dumps(nine), json.dumps(always)))

lm_dir = os.path.join(TMP, "enc_test_band")
os.makedirs(lm_dir, exist_ok=True)
lm_path = os.path.join(lm_dir, "_layers.json")
json.dump({"Depth_Area": 1}, open(lm_path, "w", encoding="utf-8"))
old_t = time.time() - A.ENC_LAYER_MAP_MAX_AGE_S - 3600
fresh_svc = {"layers": [{"id": 9, "name": "Harbour.Depth_Area", "geometryType": "esriGeometryPolygon"}]}
try:
    A._enc_layermaps.clear()
    A.urllib.request.urlopen, c_fresh = answering([fresh_svc])
    m_fresh = A._enc_layer_map("enc_test_band")                     # a month not past: the cached list, no request
    A._enc_layermaps.clear()
    os.utime(lm_path, (old_t, old_t))
    A.urllib.request.urlopen, c_fail = answering([OSError("no route")])
    m_kept = A._enc_layer_map("enc_test_band")                      # aged, the renewal fails: the old list kept
    kept_file = json.load(open(lm_path, encoding="utf-8"))
    A._enc_layermaps.clear()
    A.urllib.request.urlopen, c_new = answering([fresh_svc])
    m_new = A._enc_layer_map("enc_test_band")                       # aged, renewed: the new numbering
    new_file = json.load(open(lm_path, encoding="utf-8"))
finally:
    A.urllib.request.urlopen = _urlopen
    A._enc_layermaps.clear()
check("3. A BAND'S LAYER LIST is asked for again once a month old - the new numbering taken and written - a renewal that "
      "fails keeps the list it had, and a list younger than that is not asked for at all",
      lambda: m_fresh == {"Depth_Area": 1} and not c_fresh and m_kept == {"Depth_Area": 1} and len(c_fail) == 1
              and kept_file == {"Depth_Area": 1} and m_new == {"Depth_Area": 9} and new_file == {"Depth_Area": 9},
      lambda: "fresh %s (requests %d); failed renewal %s (requests %d); renewed %s, file %s"
              % (m_fresh, len(c_fresh), m_kept, len(c_fail), m_new, new_file))

# ── 4. the chart-source card ─────────────────────────────────────────────────────────────────────────────────────────
# -- 3b. the listing renewed DAILY, and asked again through NOAA's fault (2026-10-19) ---------------------------
fault = {"error": {"code": 500, "message": "Error handling service request :Could not find service. Service may be stopped or it may not be configured."}}
try:
    A._enc_layermaps.clear()
    os.utime(lm_path, (old_t, old_t))
    A.urllib.request.urlopen, c_fault = answering([fault, fault, {"layers": [{"id": 0, "name": "DepthsA", "type": "Group Layer", "subLayerIds": [1]},
                                                                             {"id": 1, "name": "Harbor.Depth_Area", "type": "Feature Layer", "geometryType": "esriGeometryPolygon"}]}])
    m_retried = A._enc_layer_map("enc_test_band")                   # the fault twice, the listing on the third try: renewed
    A._enc_layermaps.clear()
    os.utime(lm_path, (old_t, old_t))
    A.urllib.request.urlopen, c_only = answering([fault])
    m_faulted = A._enc_layer_map("enc_test_band")                   # the fault every time: the old list kept
finally:
    A.urllib.request.urlopen = _urlopen
    A._enc_layermaps.clear()
check("3b. THE LISTING IS RENEWED DAILY, not monthly, and asked again through NOAA's fault: faulted twice and listed on the "
      "third try, the new numbering is taken - a group layer skipped, 'Harbor.' cut from the name; faulted every time "
      "(ENC_QUERY_ATTEMPTS requests), the old list is kept",
      lambda: A.ENC_LAYER_MAP_MAX_AGE_S == 86400 and m_retried == {"Depth_Area": 1} and len(c_fault) == 3
              and m_faulted == {"Depth_Area": 1} and len(c_only) == A.ENC_QUERY_ATTEMPTS,
      lambda: "retried %s after %d requests; faulted %s after %d" % (m_retried, len(c_fault), m_faulted, len(c_only)))

saved = (A._enc_pick_band, A._enc_layer_map, A._enc_query_ids, A._enc_query_by_ids)
A._enc_pick_band = lambda bbox, errors=None: "enc_harbour"
A._enc_layer_map = lambda band, timeout=20.0: {"Coverage_area": 1, "Quality_of_Data_area": 2}
QF = {"on": True}
asked = []


def ci_ids(band, lid, bbox, timeout=25.0):
    asked.append(lid)
    if lid == 2 and QF["on"]:
        raise ValueError("ENC: Could not find service")
    return [7]


A._enc_query_ids = ci_ids
A._enc_query_by_ids = lambda band, lid, ids, timeout=30.0, batch=200: [
    {"properties": {"DSNM": "US5PSMCC.000", "CATZOC": "3"}, "geometry": {"type": "Point", "coordinates": [0, 0]}}]
box = [-70.80, 43.05, -70.70, 43.10]
ci_path = os.path.join(TMP, "chartinfo_v1_%s.json" % A._bbox_key(box))
try:
    bad = A.fetch_chart_info(box)
    bad_kept = os.path.exists(ci_path)
    QF["on"] = False
    good = A.fetch_chart_info(box)
    good_kept = os.path.exists(ci_path)
    n0 = len(asked)
    again = A.fetch_chart_info(box)
    from_disk = len(asked) == n0
    os.utime(ci_path, (time.time() - A.ENC_TILE_FRESH_S - 60,) * 2)
    aged = A.fetch_chart_info(box)
    reread = len(asked) > n0
finally:
    A._enc_pick_band, A._enc_layer_map, A._enc_query_ids, A._enc_query_by_ids = saved
check("4. THE CHART-SOURCE CARD'S ANSWER with a failed query is served once, says so - and names the failed class in "
      "`partial` - and is NOT kept - it was kept, empty, for ever; a whole one is kept and read from the disk; one a week old "
      "is read again",
      lambda: "not read whole" in bad["note"] and not bad["quality"] and not bad_kept and good_kept and good["quality"]
              and from_disk and again["quality"] and reread and aged["quality"]
              # the failed classes as data (2026-10-17: the page asks again on them - tests/chart_source_card.js 12)
              and bad.get("partial") == ["Quality_of_Data_area"] and "partial" not in good,
      lambda: "failed: note %r kept %s; whole kept %s; again from disk %s; aged re-read %s"
              % (bad["note"], bad_kept, good_kept, from_disk, reread))

# ── 5. a tile a week old ─────────────────────────────────────────────────────────────────────────────────────────────
saved = (A.ENC_TILE_IN_PROCESS, A._enc_tile_build)
A.ENC_TILE_IN_PROCESS = True
TILE = [-70.75, 43.0, -70.5, 43.25]
TILE2 = [-71.0, 43.0, -70.75, 43.25]
builds = []
BUILD = {"fail": False}


def fake_build(tile):
    builds.append(list(tile))
    time.sleep(0.05)
    if BUILD["fail"]:
        return {"tile": tile, "features": [], "unread": [], "unread_failed": [tile], "bands": [], "partial": [],
                "note": "the chart's coverage could not be read here (offline)"}
    return {"tile": tile, "features": [{"role": "land", "cls": "Land_Area", "props": {}, "oid": 2, "band": "enc_harbour",
                                        "geometry": {"type": "Polygon", "coordinates": [[[tile[0], tile[1]], [tile[0] + 0.01, tile[1]],
                                                                                         [tile[0] + 0.01, tile[1] + 0.01], [tile[0], tile[1]]]]}}],
            "bands": ["enc_harbour"], "unread": [], "unread_failed": [], "partial": [], "complete": True,
            "read_at": time.time(), "reader": A._ENC_TILE_READER}


def old_tile(tile, days):
    t = {"tile": tile, "features": [{"role": "land", "cls": "Land_Area", "props": {}, "oid": 1, "band": "enc_harbour",
                                     "geometry": {"type": "Polygon", "coordinates": [[[tile[0], tile[1]], [tile[0] + 0.01, tile[1]],
                                                                                      [tile[0] + 0.01, tile[1] + 0.01], [tile[0], tile[1]]]]}}],
         "bands": ["enc_harbour"], "unread": [], "unread_failed": [], "partial": [], "complete": True,
         "read_at": time.time() - days * 86400, "reader": A._ENC_TILE_READER}
    A._write_tile_jsonl(A._tile_path(tile), t)


def settle():
    t0 = time.time()
    while A._enc_tile_refreshing and time.time() - t0 < 10:
        time.sleep(0.02)


A._enc_tile_build = fake_build
try:
    A._enc_tile_mem.clear()
    A._enc_down_until = 0.0
    old_tile(TILE, 8)
    old_tile(TILE2, 1)
    t0 = time.time()
    first = A.fetch_enc_tile(TILE)
    served_in = time.time() - t0
    first_oid = [f["oid"] for f in first["features"]]
    lay = A.fetch_enc_layered([-70.9, 43.05, -70.6, 43.2], 0.0)       # both tiles: the oldest date, one past a week
    settle()
    mem_oid = [f["oid"] for f in A._enc_tile_mem[A._bbox_key(TILE)]["features"]]
    disk = A._read_tile_jsonl(A._tile_path(TILE))
    disk_oid = [f["oid"] for f in disk["features"]]
    fresh_builds = [b for b in builds if b == TILE2]
    # a re-read that fails leaves the copy as it was
    old_tile(TILE, 8)
    A._enc_tile_mem.clear()
    BUILD["fail"] = True
    kept = A.fetch_enc_tile(TILE)
    settle()
    after_fail = A._read_tile_jsonl(A._tile_path(TILE))
    BUILD["fail"] = False
finally:
    A.ENC_TILE_IN_PROCESS, A._enc_tile_build = saved
    A._enc_tile_mem.clear()
check("5. A TILE A WEEK OLD is SERVED AT ONCE (no read in the way) and read again BEHIND it: the new read replaces it in "
      "memory and on disk; a tile a day old is not read again; the layered read says the oldest tile's date and how many "
      "are past a week",
      lambda: first_oid == [1] and served_in < 0.05 and mem_oid == [2] and disk_oid == [2] and not fresh_builds
              and lay["aged"] == 1 and abs(lay["read_at"] - (time.time() - 8 * 86400)) < 120,
      lambda: "served %s in %.3f s; then memory %s disk %s; day-old tile read again %d; layered aged %s read_at %.0f days ago"
              % (first_oid, served_in, mem_oid, disk_oid, len(fresh_builds), lay["aged"], (time.time() - (lay["read_at"] or 0)) / 86400))
check("5b. ... and a re-read that FAILS leaves the copy as it was - served, and on disk",
      lambda: [f["oid"] for f in kept["features"]] == [1] and after_fail and [f["oid"] for f in after_fail["features"]] == [1],
      lambda: "served %s, on disk %s" % ([f["oid"] for f in kept["features"]], after_fail and [f["oid"] for f in after_fail["features"]]))

# ── 5c-5d. a read that failed HOLDS the tile (the 2026-10-16 review, finding 14) ──────────────────────────────────
# A re-read that failed recorded nothing, so every chart read started another child of some six hundred queries behind
# the served copy; a tile with no copy whose coverage read failed with a service error was not held either. Both are held
# ENC_TILE_RETRY_S now (a link that is down sets the breaker instead).
TILE3 = [-70.5, 43.0, -70.25, 43.25]
A.ENC_TILE_IN_PROCESS, A._enc_tile_build = True, fake_build
try:
    A._enc_tile_mem.clear()
    A._enc_down_until = 0.0
    old_tile(TILE, 8)
    BUILD["fail"] = True
    A.fetch_enc_tile(TILE)                                           # served stale; the re-read behind it fails
    settle()
    n_before = len(builds)
    again = A.fetch_enc_tile(TILE)                                   # held: no second re-read
    settle()
    builds_again = len(builds) - n_before
    hold_for = (A._enc_tile_mem[A._bbox_key(TILE)].get("retry_at") or 0) - time.time()
    try:
        os.remove(A._tile_path(TILE3))
    except OSError:
        pass
    A._enc_tile_mem.pop(A._bbox_key(TILE3), None)
    n3 = len(builds)
    none1 = A.fetch_enc_tile(TILE3)                                  # no copy, and the coverage read fails
    none2 = A.fetch_enc_tile(TILE3)                                  # held: served the same answer, no second read
    builds3 = len(builds) - n3
    hold3 = (none2.get("retry_at") or 0) - time.time()
    BUILD["fail"] = False
finally:
    A.ENC_TILE_IN_PROCESS, A._enc_tile_build = saved
    A._enc_tile_mem.clear()
    BUILD["fail"] = False
check("5c. A RE-READ THAT FAILED HOLDS THE COPY: the next request serves it (oid 1) and starts no second re-read; the hold "
      "is ENC_TILE_RETRY_S",
      lambda: [f["oid"] for f in again["features"]] == [1] and builds_again == 0
              and A.ENC_TILE_RETRY_S - 5 < hold_for <= A.ENC_TILE_RETRY_S,
      lambda: "served %s; re-reads after the failed one %d; held %.0f s" % ([f["oid"] for f in again["features"]], builds_again, hold_for))
check("5d. A TILE WITH NO COPY WHOSE COVERAGE READ FAILS is held too: one read, its squares unread_failed, and the second "
      "request served the same answer without a read",
      lambda: builds3 == 1 and none1.get("unread_failed") == [TILE3] and none2 is none1
              and A.ENC_TILE_RETRY_S - 5 < hold3 <= A.ENC_TILE_RETRY_S,
      lambda: "reads %d; first %s; same answer %s; held %.0f s" % (builds3, none1.get("unread_failed"), none2 is none1, hold3))

# ── 6. the hull's overhead inputs ────────────────────────────────────────────────────────────────────────────────────
profiles = {}
for vid in ("zboat_1800hs", "ben_cworker4", "drix08", "drix08_em712"):
    v = json.load(open(os.path.join(APP, "vessels", vid + ".json"), encoding="utf-8"))
    A.validate_vessel(v, vid)
    profiles[vid] = (v["hull"].get("air_draft_m"), v["planning"].get("overhead_clearance_m"))
base = json.load(open(os.path.join(APP, "vessels", "drix08.json"), encoding="utf-8"))
refused = {}
for label, blk, key, val in (("text", "hull", "air_draft_m", "2.85"), ("negative", "hull", "air_draft_m", -1.0),
                             ("bool", "hull", "air_draft_m", True), ("NaN", "planning", "overhead_clearance_m", float("nan"))):
    v = json.loads(json.dumps(base))
    v[blk][key] = val
    try:
        A.validate_vessel(v, "probe")
        refused[label] = False
    except ValueError:
        refused[label] = True
absent = json.loads(json.dumps(base))
del absent["hull"]["air_draft_m"], absent["planning"]["overhead_clearance_m"]
try:
    A.validate_vessel(absent, "probe")
    absent_ok = True
except ValueError:
    absent_ok = False
check("6. THE HULL'S OVERHEAD INPUTS are safety inputs: text, a negative, a boolean or NaN refused at load; absent is a "
      "hull with no overhead check; every shipped profile carries both",
      lambda: all(refused.values()) and absent_ok and all(a and a > 0 and o is not None and o >= 0 for a, o in profiles.values()),
      lambda: "refused %s; absent loads %s; profiles %s" % (refused, absent_ok, profiles))

# ── 8. what the reader keeps of each feature ─────────────────────────────────────────────────────────────────────────
raw = {"VERCLR": "2.1", "VERCCL": 4.9, "HORCLR": 18.2, "WATLEV": "4", "QUASOU": "2,6", "CATREA": "offshore safety zone",
       "INFORM": "33 CFR 334.50", "RESTRN": "7", "CATWRK": "dangerous wreck", "CATOBS": "foul area", "CATCAM": "north",
       "EXPSOU": 2, "CONDTN": 2, "TRAFIC": 4, "CATBRG": "fixed bridge", "VERCOP": "junk", "SORDAT": "20060830"}
kept = A._enc_keep_props(raw)
check("8. THE READER KEEPS what the model and the operator read since 2026-10-12 - clearances (as NUMBERS, text read as "
      "one, junk dropped), the water level as a number, the sounding's quality as its list, a restricted area's identity "
      "and restrictions, what a wreck, an obstruction, a cardinal is - and still nothing it was not asked for",
      lambda: kept.get("VERCLR") == 2.1 and kept.get("VERCCL") == 4.9 and kept.get("HORCLR") == 18.2 and kept.get("WATLEV") == 4.0
              and kept.get("QUASOU") == "2,6" and kept.get("CATREA") == "offshore safety zone" and kept.get("INFORM") == "33 CFR 334.50"
              and kept.get("RESTRN") == "7" and kept.get("CATWRK") and kept.get("CATOBS") and kept.get("CATCAM") == "north"
              and "VERCOP" not in kept and "SORDAT" not in kept and kept.get("CATBRG") == "fixed bridge",
      lambda: json.dumps(kept))

# ── 9. a tile stored before a class had its role ─────────────────────────────────────────────────────────────────────
saved = (A.ENC_TILE_IN_PROCESS, A._enc_tile_build)
A.ENC_TILE_IN_PROCESS = True
A._enc_tile_build = lambda tile: {"tile": tile, "bands": ["enc_harbour"], "unread": [], "unread_failed": [], "partial": [],
                                  "complete": True, "read_at": time.time(), "reader": A._ENC_TILE_READER,
                                  "features": [{"role": "extra", "cls": "Land_Area_point", "props": {}, "oid": 5, "band": "enc_harbour",
                                                "geometry": {"type": "Point", "coordinates": [-70.20, 43.10]}},
                                               {"role": "extra", "cls": "Cable_Overhead_line", "props": {"VERCLR": 4.8}, "oid": 6,
                                                "band": "enc_harbour", "geometry": {"type": "LineString",
                                                                                    "coordinates": [[-70.21, 43.10], [-70.20, 43.11]]}},
                                               {"role": "extra", "cls": "Light_point", "props": {}, "oid": 7, "band": "enc_harbour",
                                                "geometry": {"type": "Point", "coordinates": [-70.20, 43.105]}}]}
try:
    A._enc_tile_mem.clear()
    lay9 = A.fetch_enc_layered([-70.24, 43.05, -70.15, 43.15], 0.0)   # a tile no check above wrote
    held = A._enc_tile_mem[A._bbox_key([-70.25, 43.0, -70.0, 43.25])]["features"]
finally:
    A.ENC_TILE_IN_PROCESS, A._enc_tile_build = saved
    A._enc_tile_mem.clear()
roles9 = sorted((f["cls"], f["role"]) for f in lay9["features"])
check("9. A TILE STORED BEFORE A CLASS HAD ITS ROLE is served with today's: an islet and an overhead cable stored as "
      "`extra` reach the page as land_point and overhead, a light (still unclassified) as extra - and the tile held in "
      "memory is not rewritten by the serving",
      lambda: roles9 == [("Cable_Overhead_line", "overhead"), ("Land_Area_point", "land_point"), ("Light_point", "extra")]
              and all(f["role"] == "extra" for f in held),
      lambda: "%s; held %s" % (roles9, [f["role"] for f in held]))

# ── 10. one TLS context for every chart query ────────────────────────────────────────────────────────────────────────
# Measured 2026-10-12 on one Portsmouth tile (616 requests): 22.5 s of a read's 36 s of CPU went into building a TLS
# context per request (Windows' certificate store loaded twice a call); shared, the same tile read in 21 s, not 45.
ctxs = []


def rec(req, timeout=None, **k):
    ctxs.append(k.get("context"))
    url = getattr(req, "full_url", req)
    if "f=json" in url and "/query?" not in url:
        return _Resp(json.dumps({"layers": [{"id": 1, "name": "X.Depth_Area", "geometryType": "esriGeometryPolygon"}]}).encode())
    if "returnIdsOnly" in url:
        return _Resp(json.dumps({"objectIds": [1]}).encode())
    return _Resp(json.dumps({"features": [], "count": 0}).encode())


try:
    A.urllib.request.urlopen = rec
    A._enc_layermaps.clear()
    A._enc_layer_map("enc_ctx_band")
    A._enc_query_ids("enc_harbour", 1, [0, 0, 1, 1])
    A._enc_query_by_ids("enc_harbour", 1, [1])
    A._enc_query("enc_harbour", 1, [0, 0, 1, 1])
    A._enc_query("enc_harbour", 1, [0, 0, 1, 1], count_only=True)
finally:
    A.urllib.request.urlopen = _urlopen
    A._enc_layermaps.clear()
check("10. EVERY CHART QUERY shares ONE TLS context - the layer list, the id query, the by-id query and the direct one - "
      "made once (a context per request was 22.5 s of a tile's 36 s of CPU)",
      lambda: len(ctxs) == 5 and all(c is not None and c is A._enc_ssl() for c in ctxs) and A._enc_ssl() is A._enc_ssl(),
      lambda: "%d queries, contexts %s" % (len(ctxs), sorted({id(c) for c in ctxs})))

# ── 11. the band pick never falls to a coarser band (2026-10-19) ───────────────────────────────────────────
NOAA_FAULT = "Error handling service request :Could not find service. Service may be stopped or it may not be configured."
Q11 = {"answers": {}}
LM11 = {"empty": False}
probes11 = []


def lm11(band, timeout=20.0):
    return {} if (band == "enc_general" and LM11["empty"]) else {"Depth_Area": 1, "Land_Area": 2}


def q11(band, lid, bbox, timeout=25.0, count_only=False, max_records=2000):
    probes11.append((band, lid))
    a = Q11["answers"].get(band)
    if a == "fault":                                   # as the real _enc_query answers the fault (2026-10-19): raised
        raise ValueError("ENC %s/%d: %s" % (band, lid, NOAA_FAULT))
    return {"count": a if a is not None else 0}


saved11 = (A._enc_layer_map, A._enc_query)
A._enc_layer_map, A._enc_query = lm11, q11
box11 = [-70.8, 43.0, -70.7, 43.1]
try:
    Q11["answers"] = {"enc_harbour": "fault", "enc_approach": 5}
    e1 = []
    b1 = A._enc_pick_band(box11, e1)
    p1 = list(probes11)
    del probes11[:]
    Q11["answers"] = {"enc_harbour": 0, "enc_approach": 5}
    e2 = []
    b2 = A._enc_pick_band(box11, e2)
    # the REAL count query, answered the fault by the service: raises
    A.urllib.request.urlopen, _ = answering([{"error": {"code": 500, "message": NOAA_FAULT}}])
    try:
        saved11[1]("enc_harbour", 1, box11, count_only=True)
        raised = False
    except ValueError as e:
        raised = "Could not find service" in str(e)
    finally:
        A.urllib.request.urlopen = _urlopen
    del probes11[:]
    LM11["empty"] = True
    Q11["answers"] = {"enc_harbour": 0, "enc_approach": 0, "enc_coastal": 0}
    e3 = []
    b3 = A._enc_pick_band(box11, e3)
finally:
    A._enc_layer_map, A._enc_query = saved11
    LM11["empty"] = False
check("11. THE BAND PICK NEVER FALLS TO A COARSER BAND: a harbour probe NOAA refused (tried ENC_QUERY_ATTEMPTS times) ends the "
      "pick - None, the fault said in words, the approach band never asked; a harbour honestly EMPTY (count 0) goes on to "
      "approach; the count probe raises on the fault; a band whose layer list cannot be had ends the pick too, said",
      lambda: b1 is None and len(p1) == A.ENC_QUERY_ATTEMPTS and all(b == "enc_harbour" for b, _ in p1)
              and e1 and "Could not find service" in e1[0] and "tried again" in e1[0]
              and b2 == "enc_approach" and not e2 and raised is True
              and b3 is None and e3 and "layer list" in e3[0],
      lambda: "refused: %s, probes %d of %s, said %r; empty: %s; raised %s; no list: %s %r" % (b1, len(p1), sorted({b for b, _ in p1}), (e1 or [""])[0][:90], b2, raised, b3, (e3 or [""])[0]))

# ── 12. a tile read with what is known of its bands' coverage (2026-10-19) ─────────────────────────────────
TILE12 = [-70.5, 43.0, -70.25, 43.25]
WEST = [[[-70.5, 43.0], [-70.375, 43.0], [-70.375, 43.25], [-70.5, 43.25], [-70.5, 43.0]]]
WHOLE = [[[-70.5, 43.0], [-70.25, 43.0], [-70.25, 43.25], [-70.5, 43.25], [-70.5, 43.0]]]
COV12 = {}


def cov12(band, tile):
    a = COV12.get(band, [])
    if a == "fault":
        raise ValueError("ENC %s/158: %s" % (band, NOAA_FAULT))
    return a


def feats12(region, md=0.0, band=None, extras=True, use_cache=True):
    return {"band": band, "features": [{"role": "land", "cls": "Land_Area", "oid": 1, "geometry": {"type": "Polygon", "coordinates": WHOLE}}],
            "partial": []}


def area(rects):
    return sum((r[2] - r[0]) * (r[3] - r[1]) for r in rects)


saved12 = (A._enc_coverage, A.fetch_enc_features)
A._enc_coverage, A.fetch_enc_features = cov12, feats12
tile_area = (TILE12[2] - TILE12[0]) * (TILE12[3] - TILE12[1])
try:
    # coastal's coverage FAILS, no copy: the harbour half read, the rest water that failed (never read from general)
    COV12.update({"enc_harbour": [WEST], "enc_coastal": "fault", "enc_general": [WHOLE]})
    t1 = A._enc_tile_build(TILE12)
    # the same with a copy of coastal's coverage from an older read on disk: read from it, said, not kept
    cov_path = os.path.join(TMP, "cov_v1_enc_coastal_%s.json" % A._bbox_key(TILE12))
    json.dump([WHOLE], open(cov_path, "w", encoding="utf-8"))
    os.utime(cov_path, (time.time() - 40 * 86400,) * 2)
    t2 = A._enc_tile_build(TILE12)
    os.remove(cov_path)
    # the HARBOUR coverage fails with no copy: nothing can be read
    COV12.update({"enc_harbour": "fault", "enc_coastal": [WHOLE]})
    t3 = A._enc_tile_build(TILE12)
    # no band unknown, the east half covered by no band at all: honestly unread, and the tile complete
    COV12.clear()
    COV12.update({"enc_harbour": [WEST]})
    t4 = A._enc_tile_build(TILE12)
finally:
    A._enc_coverage, A.fetch_enc_features = saved12
half = tile_area / 2
check("12. A TILE IS READ WITH WHAT IS KNOWN OF ITS BANDS' COVERAGE: coastal's coverage failing with no copy, the half the "
      "harbour chart covers is read and the other half is water that FAILED (unread_failed, never read from the general "
      "chart in coastal's place), the band named with the fault in words, the tile not kept; with coastal's coverage from an "
      "older read on disk that half is read from it, said, not kept; the harbour chart's coverage failing with no copy, "
      "nothing is read (the whole tile failed, the band and the fault named); no band unknown, water no band covers is "
      "honestly unread and the tile is complete",
      lambda: t1.get("coverage_failed") == ["enc_coastal"] and not t1.get("complete") and t1.get("unread") == []
              and abs(area(t1["unread_failed"]) - half) < 0.02 * tile_area and len(t1["features"]) == 1
              and t1["note"].startswith("read without the coastal chart's coverage (NOAA's chart service answered 'Could not find service'")
              and t2.get("coverage_stale") == ["enc_coastal"] and not t2.get("coverage_failed") and not t2.get("complete")
              and t2.get("unread_failed") == [] and t2.get("unread") == [] and len(t2["features"]) >= 2
              and "older read" in t2["note"]
              and t3.get("unread_failed") == [TILE12] and "enc_harbour" in t3["note"] and "Could not find service" in t3["note"]
              and t4.get("complete") is True and t4.get("coverage_failed") == [] and t4.get("unread_failed") == []
              and abs(area(t4["unread"]) - half) < 0.02 * tile_area,
      lambda: json.dumps({"t1": {k: t1.get(k) for k in ("coverage_failed", "complete", "note")}, "t1_failed_area": round(area(t1["unread_failed"]) / tile_area, 3),
                          "t2": {k: t2.get(k) for k in ("coverage_stale", "complete", "note")}, "t3": t3.get("note"),
                          "t4": {k: t4.get(k) for k in ("complete", "coverage_failed")}, "t4_unread_area": round(area(t4["unread"]) / tile_area, 3),
                          "features": [len(t1["features"]), len(t2["features"])], "t1_unread": t1.get("unread"), "t2_failed": t2.get("unread_failed")}))

# ── 13. NOAA's fault in words ───────────────────────────────────────────────────────────────────────────
said13 = A._enc_fault_say(ValueError("ENC enc_coastal/158: " + NOAA_FAULT))
other13 = A._enc_fault_say(ValueError("ENC enc_coastal/158: the service cut the answer short"))
check("13. NOAA's 'Could not find service' fault reaches the operator in words - a stopped or restarting service on its server, "
      "each query tried again up to twelve times - and any other fault as itself",
      lambda: said13.startswith("NOAA's chart service answered 'Could not find service'") and "12 times" in said13
              and other13 == "ENC enc_coastal/158: the service cut the answer short",
      lambda: said13 + " | " + other13)

after = set(os.listdir(APP_ENC)) if os.path.isdir(APP_ENC) else set()
shutil.rmtree(TMP, ignore_errors=True)
check("7. nothing here wrote to the app's own chart cache (everything went to a temp folder)",
      lambda: after == before, lambda: "new files %s" % sorted(after - before)[:5])

# 8. THE CLASSES A RULE READS WITHOUT A ROLE ARE ACTED ON (the 2026-10-18 review, finding 6): Massachusetts' 150-ft band
# stands off a marina or a launch - static/js/speedzones.js maFacility reads Small_Craft_Facility_* and Harbour_Facility_*,
# which no ENC_ROLES entry names. _ENC_ACTED_ON was built from ENC_ROLES alone, so a read that lost one of them was served,
# used and said to be whole: the band not built, nothing saying so.
_sz_js = open(os.path.join(os.path.dirname(os.path.abspath(A.__file__)), "static", "js", "speedzones.js"), encoding="utf-8").read()
_mf = _sz_js[_sz_js.index("export function maFacility"):]
_mf = _mf[:_mf.index("\n}") + 2]
_prefixes = sorted(set(__import__("re").findall(r"/\^([A-Za-z_]+)", _mf)))
check("8. every chart class Massachusetts' facility rule reads is ACTED ON by the reader (a tile that lost one is unread "
      "water, not a whole chart): the four facility classes by name, and every class prefix maFacility tests has an acted-on class",
      lambda: set(A._ENC_RULE_CLASSES) <= A._ENC_ACTED_ON
      and set(A._ENC_RULE_CLASSES) == {"Small_Craft_Facility_area", "Small_Craft_Facility_point", "Harbour_Facility_area", "Harbour_Facility_point"}
      and len(_prefixes) >= 4 and all(any(c.startswith(p) for c in A._ENC_ACTED_ON) for p in _prefixes),
      lambda: "prefixes %s; rule classes %s" % (_prefixes, sorted(A._ENC_RULE_CLASSES)))

print("\n" + ("%d CHECK(S) FAILED (%d ran)" % (fails, ran) if fails else "all checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
