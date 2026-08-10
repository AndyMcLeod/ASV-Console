"""tests/enc_extract.py - /api/enc, and the DEDUPLICATION it was covered together with.

WHY THIS EXISTS. /api/enc was the last uncovered route with real consequence - it serves
the role-tagged ENC features the whole nogo model is built from - and it carried a
byte-identical TWIN of /api/chartinfo's query parse and cache key. The twin is how the
duplication was FOUND: a mutation runner matched its anchor twice and SKIPPED (the
energy_chartinfo pass, recorded there). Andy's instruction was to cover the route and
collapse the twin in one stroke, so this suite tests BOTH the endpoint's own contracts
and the shared mechanisms now under it:
  * `_bbox_key(bbox)`     - ONE cache-key format for the features cache and the
                            chartinfo cache. A format change moves both together.
  * `_bbox_from_query()`  - ONE query parse for both GET handlers; each keeps its OWN
                            usage message. A parser fixed in one copy and not the other
                            is exactly how the ais_service %-decoding bug shipped.
The mutation runner for this suite therefore runs BOTH suites per mutation: breaking a
shared helper must be caught from BOTH sides, which is the payoff of the dedupe made
visible - see the TEETH table.

THE ENDPOINT'S OWN CONTRACTS (read from fetch_enc_features, asserted hermetically):
  * `?bbox=W,S,E,N&min_depth=X`; anything malformed - no query, missing bbox, three
    edges, non-numeric, unparseable min_depth - is a 400 naming the ENC usage string,
    never a 502 from downstream.
  * The extract caches to `charts/enc/features_v3_<key>.json` and is SERVED from that
    cache - proven with a sentinel seeded at a mid-ocean bbox that upstream would
    answer "no coverage" for, so only the cache can be the source.
  * THE RETAG IS PER-REQUEST, THE FETCH IS NOT: every depth_area feature gets
    `shallow = DRVAL1 < min_depth` computed fresh on EVERY request, cached or not, and
    the response echoes `min_depth`. One fetch serves any depth limit - the same
    sentinel must answer min_depth=0 with shallow=False and min_depth=5.0 with
    shallow=True, byte-identical cache file both times. This is the contract that makes
    the cache safe: if the tag were baked in at fetch time, the first depth limit asked
    would be the only one ever answered.
  * `%2C` and plain commas are the same bbox (the parse_qs decode the twin nearly
    diverged on).

    python tests/enc_extract.py     # exit 0 = pass, 1 = fail   (stdlib only)

TEETH - six mutations RUN (recorded results; shared-code mutations run BOTH suites; the
runner scores a missing anchor as SKIP and a crash separately):
  * SHARED _bbox_key format broken (%.3f)   -> caught-BOTH: enc 3/4/5/5b/6 AND
    chartinfo 3 - ONE mutation, watched from two suites: the dedupe's guarantee,
    demonstrated on the first run
  * SHARED _bbox_from_query loses arity     -> caught-BOTH: enc 2/2c AND chartinfo 2b
  * the shallow retag dropped               -> enc 5, 5b
  * retag boundary <= instead of <          -> enc 5b ALONE (DRVAL1 exactly at the
    limit is NOT shallow - the boundary is its own check for exactly this reason)
  * min_depth echo dropped                  -> enc 5, 5b
  * chartinfo's usage cross-wired to ENC's  -> FIRST RUN: enc 2c caught it,
    energy_chartinfo SURVIVED - its 2b accepted ANY message containing "usage", so the
    suite that OWNS the endpoint could not see its own usage line replaced, and the
    guard lived only in a neighbour a refactor could delete. 2b was strengthened to
    demand "usage: /api/chartinfo?" and the re-run is caught by BOTH (enc 2c +
    chartinfo 2b). A mutation that survives the owner and is caught by a bystander is
    a WEAK CHECK finding, not a covered property.
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

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


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def get(port, path, timeout=8):
    """GET returning (http_code, parsed_body) - the 400s are part of the contract."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d%s" % (port, path),
                                    timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


print("ENC extract — the routing chart's source route, and the deduplicated twins under it:")

port = free_port()
ENC_DIR = os.path.join(APP, "charts", "enc")

# THE SENTINEL: a mid-ocean bbox no ENC covers, so upstream would answer "no coverage" -
# if the response carries the sentinel band, the CACHE answered, nothing else could have.
BBOX = (-140.0, 10.0, -139.9, 10.1)
KEY = "%.4f_%.4f_%.4f_%.4f" % BBOX
CACHE = os.path.join(ENC_DIR, "features_v3_%s.json" % KEY)
SENTINEL = {
    "band": "sentinel-band",
    "features": [
        {"role": "depth_area", "cls": "DepthArea",
         "props": {"DRVAL1": 3.0}, "geometry": {"type": "Point", "coordinates": [-139.95, 10.05]}},
        {"role": "obstruction", "cls": "Wreck",
         "props": {"VALSOU": 1.2}, "geometry": {"type": "Point", "coordinates": [-139.96, 10.06]}},
    ],
    "counts": {"DepthArea": 1, "Wreck": 1},
}
BQ = "bbox=%s" % ",".join("%s" % v for v in BBOX)

srvlog = tempfile.TemporaryFile(mode="w+")
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none",
                         "--port", str(port), "--no-ais-service", "--no-log"],
                        cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
try:
    up = False
    for _ in range(80):
        try:
            code, _b = get(port, "/api/state", timeout=2)
            if code == 200:
                up = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    check("1. a console comes up", up)
    if not up:
        raise SystemExit(1)

    os.makedirs(ENC_DIR, exist_ok=True)
    with open(CACHE, "w", encoding="utf-8") as f:
        json.dump(SENTINEL, f)

    # 2. EVERY malformed spelling is a 400 naming the ENC usage - never a 502 from
    # downstream, and never the OTHER endpoint's usage (2c: the dedup shares the parse,
    # each handler keeps its own message).
    bad = [("no query at all", "/api/enc"),
           ("bbox missing", "/api/enc?min_depth=2"),
           ("three edges", "/api/enc?bbox=1,2,3"),
           ("non-numeric edge", "/api/enc?bbox=1,2,3,x"),
           ("unparseable min_depth", "/api/enc?%s&min_depth=deep" % BQ)]
    results = [(label, get(port, p)) for label, p in bad]
    check("2. every malformed request is a 400 naming the ENC usage string",
          lambda: all(c == 400 and "usage: /api/enc?bbox=" in (b.get("error") or "")
                      for _, (c, b) in results),
          "; ".join("%s->%d" % (label, c) for label, (c, _b) in results))
    check("2c. ... and chartinfo still names ITS OWN usage - the shared parse did not "
          "cross-wire the messages",
          lambda: get(port, "/api/chartinfo?bbox=1,2,3")[1].get("error", "")
          .startswith("usage: /api/chartinfo?"),
          lambda: get(port, "/api/chartinfo?bbox=1,2,3")[1].get("error", "")[:40])

    # 3-4. THE CACHE ANSWERS. Mid-ocean, so the sentinel band proves provenance; the
    # response is the cache plus EXACTLY the two per-request fields (shallow, min_depth).
    code, body = get(port, "/api/enc?%s" % BQ)
    check("3. the extract is SERVED FROM THE CACHE - the sentinel band comes back",
          lambda: code == 200 and body.get("band") == "sentinel-band"
          and body.get("counts") == SENTINEL["counts"] and len(body["features"]) == 2,
          lambda: "band=%s counts=%s" % (body.get("band"), body.get("counts")))
    code_e, body_e = get(port, "/api/enc?" + BQ.replace(",", "%2C"))
    check("4. %2C and plain commas are the SAME bbox - same cache key, same answer",
          lambda: code_e == 200 and body_e == body,
          "equal=%s" % (body_e == body))

    # 5. THE RETAG IS PER-REQUEST. Same cache file, three depth limits, three answers -
    # and the cache on disk never changes (byte-compare, not mtime: a rewrite with equal
    # content would be a different bug than a retag baked in, but both are refused here).
    with open(CACHE, "rb") as f:
        cache_before = f.read()
    da = lambda b: next(ft for ft in b["features"] if ft["role"] == "depth_area")
    code0, b0 = get(port, "/api/enc?%s" % BQ)                      # min_depth omitted -> 0
    code5, b5 = get(port, "/api/enc?%s&min_depth=5.0" % BQ)
    check("5. one fetch serves ANY depth limit: DRVAL1=3 is safe at 0, SHALLOW at 5, "
          "and the response echoes the limit",
          lambda: da(b0).get("shallow") is False and b0.get("min_depth") == 0.0
          and da(b5).get("shallow") is True and b5.get("min_depth") == 5.0,
          lambda: "at0=%s at5=%s echo=%s/%s" % (da(b0).get("shallow"), da(b5).get("shallow"),
                                                b0.get("min_depth"), b5.get("min_depth")))
    code3, b3 = get(port, "/api/enc?%s&min_depth=3.0" % BQ)
    check("5b. ... and the boundary is EXCLUSIVE: DRVAL1 exactly at the limit is NOT "
          "shallow (a 3 m floor over a 3 m depth is the vessel's own clearance rule)",
          lambda: da(b3).get("shallow") is False and b3.get("min_depth") == 3.0,
          lambda: "at3=%s" % da(b3).get("shallow"))
    with open(CACHE, "rb") as f:
        cache_after = f.read()
    check("5c. ... and the cache file NEVER CHANGED - the tag lives in the response, "
          "not the disk, which is what makes one cache safe for every depth",
          lambda: cache_after == cache_before,
          "cache bytes equal=%s" % (cache_after == cache_before))

    # 6. The non-depth feature is untouched by the retag - shallow is a depth_area
    # fact, not sprayed across every role.
    check("6. the retag touches ONLY depth_area features",
          lambda: "shallow" not in next(ft for ft in b5["features"]
                                        if ft["role"] == "obstruction"),
          "obstruction keys stay their own")

finally:
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()
    try:
        os.remove(CACHE)                             # never leave the sentinel behind
    except OSError:
        pass

srvlog.seek(0)
server_out = srvlog.read()
srvlog.close()
tb = [ln.strip() for ln in server_out.splitlines()
      if "Traceback" in ln or "Error" in ln or "Exception occurred" in ln]
check("7. the console logged NO exception while serving those requests",
      not tb,
      ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb
      else "an answered request can still kill its handler")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
