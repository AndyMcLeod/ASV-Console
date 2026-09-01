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
  * The extract caches to `charts/enc/features_v<N>_<key>.json` and is SERVED from that
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
import re
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
# ⚠ THE CACHE VERSION IS READ FROM THE SOURCE, NEVER RESTATED. This was "features_v3_"
# and the console moved to v4 (the `fairway` role); the suite then wrote a sentinel the
# console would never read, and five checks failed for a reason that had nothing to do
# with what they test. Reading it means a bump moves both together.
_SRC = open(os.path.join(APP, "asv_console.py"), encoding="utf-8").read()
_CVER = re.search(r'"(features_v\d+)_%s\.json"', _SRC)
if not _CVER:
    raise SystemExit("test setup: cannot find the feature cache version in asv_console.py")
CACHE = os.path.join(ENC_DIR, _CVER.group(1) + "_%s.json" % KEY)
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

# --- 8: A DEPTH IS A NUMBER BY THE TIME IT LEAVES THE EXTRACT ------------------------- #
#
# THE TRIP-WIRE, and it is here because of what happened NEXT DOOR. WorldView drew a
# mission that detoured around a charted rock with 5.1 m of water over it: `hazExtent` -
# the same body this console runs - exempts a point hazard the chart has sounded by
# testing `typeof vs === 'number'`, S-57 attributes come off a CELL as text, and the
# string "5.1" failed that test. The rock read as unsounded and took the full assumed
# radius, and every transit near it detoured around a rise that is not there.
#
# AND EVERY FIXTURE IN THIS ESTATE AGREED WITH THE BROKEN CODE. Look up: the SENTINEL
# above feeds `DRVAL1: 3.0` and `VALSOU: 1.2` as NUMBERS, because that is what you type.
# So does tests/wreck_clearance.js. The suites were green about a wire they had never
# seen. These feed the STRING FORM instead - the only version that was ever in doubt.
#
# This console cannot have the fault today: one chart source, `f=geojson`, which types
# its numerics (measured over this console's own cache: 629 point hazards, 48 sounded,
# ZERO string VALSOU, ZERO wrongly kept). `_enc_keep_props` is a NO-OP now, and the whole
# point of it is the day a second source appears - a cell off a disk, an imported file -
# when nothing else here would notice.
import asv_console as A                                       # noqa: E402

rock = A._enc_keep_props({"OBJNAM": "sounded rock", "VALSOU": "5.1", "JUNK": "x"})
check("8. a VALSOU that arrives as TEXT leaves the extract as a number",
      lambda: rock.get("VALSOU") == 5.1 and isinstance(rock.get("VALSOU"), float),
      "%r (%s)" % (rock.get("VALSOU"), type(rock.get("VALSOU")).__name__))
# ...and the name beside it is text and must STAY text: coercing everything is the other
# way to be wrong. `.get`, never `[...]` - a check that RAISES kills the suite instead of
# reddening, and then nothing after it runs either.
check("8b. ... while the name beside it is left alone, and the junk still dropped",
      lambda: rock.get("OBJNAM") == "sounded rock" and "JUNK" not in rock,
      "%r, keys %s" % (rock.get("OBJNAM"), sorted(rock)))

band = A._enc_keep_props({"DRVAL1": "0", "DRVAL2": "1.8"})
already = A._enc_keep_props({"VALSOU": 4.25})
check("8c. ... and so are the depth range and the contour value, while one that was "
      "ALREADY a number is untouched",
      lambda: band.get("DRVAL1") == 0.0 and band.get("DRVAL2") == 1.8
      and already.get("VALSOU") == 4.25,
      "DRVAL1 %r, DRVAL2 %r, untouched %r"
      % (band.get("DRVAL1"), band.get("DRVAL2"), already.get("VALSOU")))

# UNREADABLE MEANS UNKNOWN, AND UNKNOWN IS THE CONSERVATIVE CASE. A depth that will not
# parse must not reach the model as text for a `typeof` to trip over a second time;
# dropped, the hazard is sized as unsounded - the answer the string was accidentally
# giving, now for a stated reason.
junk = A._enc_keep_props({"VALSOU": "unknown", "OBJNAM": "nameless"})
blank = A._enc_keep_props({"VALSOU": ""})
check("8d. ... and a depth that will not parse is DROPPED, not carried as text",
      lambda: "VALSOU" not in junk and junk.get("OBJNAM") == "nameless"
      and "VALSOU" not in blank,
      "junk keys %s, blank keys %s" % (sorted(junk), sorted(blank)))

# THE SEAM, NOT JUST THE HELPER. Testing a pure helper does not test that anything CALLS
# it. The trimming happens inside a nested worker a test cannot reach, so this pins the
# call site as source - and that the raw comprehension it replaced is gone, or both could
# sit there with the old one still doing the work.
src = open(os.path.join(APP, "asv_console.py"), "r", encoding="utf-8").read()
CALL = '_enc_keep_props(ft.get("properties"))'
OLD = "{k: props.get(k) for k in ENC_KEEP_PROPS"
check("8e. ... and the extract itself goes through it - the raw comprehension is gone",
      lambda: CALL in src and OLD not in src,
      "call present=%s, old comprehension gone=%s" % (CALL in src, OLD not in src))

# ── 9. EVERY DECLARED CLASS MUST RESOLVE TO A REAL PUBLISHED LAYER ──────────────────
#
# ⚠ AN UNRESOLVED CLASS IS SILENTLY SKIPPED. The fetch builds its job list with
# `if cls in lm` — a class ENCDirect does not publish under that exact name is dropped with
# no error, no warning, and no gap in the result. So one typo disables a whole role for
# ever and everything downstream reports success.
#
# It had. "Restricted_Area" was wrong from the day the role was added — the published layer
# is "Restricted_Area_area", carrying the geometry suffix the rest of them do — so the role
# fetched NOTHING, ever: zero restricted features across 110 real cached extracts, while the
# operator's "Dredged / restricted" enforcement checkbox said it was enforcing both halves.
#
# Checked against the CACHED LAYER MAPS, which are the service's own answer about what it
# publishes rather than a list restated here. Harbour and approach are the bands a survey
# ASV works in and must resolve everything; the small-scale coastal and general bands
# legitimately omit harbour furniture, so a class missing THERE is not a fault.
_LAYER_DIRS = [os.path.join(APP, "charts", "enc", _b) for _b in ("enc_harbour", "enc_approach")]
_maps = []
for _d in _LAYER_DIRS:
    try:
        with open(os.path.join(_d, "_layers.json"), "r", encoding="utf-8") as _f:
            _m = json.load(_f)
        _maps.append((os.path.basename(_d),
                      set(_m.keys() if isinstance(_m, dict) else (x.get("name") for x in _m))))
    except (OSError, ValueError):
        pass

_blk = src[src.index("ENC_ROLES = {"):src.index("ENC_KEEP_PROPS")]
_blk = "\n".join(_l.split("#")[0] for _l in _blk.splitlines())      # code only, not comments
_declared = re.findall(r'"([A-Z][A-Za-z_]+)"', _blk)

if not _maps:
    # No cached layer map means this check CANNOT RUN — and that is a stated failure, never
    # a silent pass. A coverage check that quietly reports nothing is the same class of
    # fault as the one it exists to catch.
    check("9. every ENC_ROLES class resolves to a published layer", lambda: False,
          "NO CACHED LAYER MAP under charts/enc/<band>/_layers.json — run the console once "
          "against a real area so the bands cache, then re-run this suite")
else:
    for _band, _names in _maps:
        _missing = sorted(c for c in _declared if c not in _names)
        check("9. every ENC_ROLES class resolves in %s" % _band,
              (lambda m=_missing: not m),
              ("%d/%d classes resolve" % (len(_declared) - len(_missing), len(_declared)))
              + ("" if not _missing else
                 " — UNRESOLVED, and SILENTLY SKIPPED by the fetch: " + ", ".join(_missing)))
    # ... and the two the Rule 9 scope work rests on, named outright: a generic "they all
    # resolve" check passes just as well over a list they have been deleted from.
    _h = _maps[0][1]
    check("9b. ... including FAIRWY and DRGARE, which decide where Rule 9 applies",
          (lambda: "Fairway_area" in _h and "Dredged_Area" in _h
                   and "Fairway_area" in _declared and "Dredged_Area" in _declared),
          "requested: Fairway_area=%s Dredged_Area=%s"
          % ("Fairway_area" in _declared, "Dredged_Area" in _declared))

# ── 10. THE FEATURE CACHE VERSION MOVES WITH THE ROLE SET ───────────────────────────
#
# ⚠ A CACHE DOES NOT KNOW WHAT IT DOES NOT CONTAIN. Adding a role without bumping the cache
# version leaves every already-cached area serving an extract that lacks it — happily, with
# no gap and no warning. The `fairway` role shipped exactly that way: 110 cached extracts
# covered every operating area in use and not one held a fairway feature, so COLREGS Rule 9
# would never have applied anywhere the console had already been.
#
# This check cannot know when a bump is DUE, so it pins the two together where it can: the
# version's comment must name the roles each bump added, which puts the requirement in front
# of the next person adding one, in the file they are already editing.
_ver = re.search(r"features_v(\d+)_%s\.json", src)
check("10. the feature cache version names the roles each bump added",
      (lambda: _ver is not None and "'fairway' role" in src and "'chan_mark' role" in src),
      "cache file is %s" % (_ver.group(0) if _ver else "NOT FOUND")
      + "; a role added without a bump is invisible to every already-cached area")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
