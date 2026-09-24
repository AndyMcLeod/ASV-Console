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
    except OSError as e:
        # ⚠⚠ A REQUEST THAT NEVER RETURNS IS AN ANSWER, NOT A CRASH. With the span cap
        # mutated away, the 5-degree box in check 2d went to the extractor and hung past this
        # timeout - which is the very defect 2d exists for - and the suite CRASHED on the
        # TimeoutError instead of failing 2d. A runner reading stdout scores that as SURVIVED.
        # Both shapes land here: the connect-phase URLError and the read-phase bare
        # TimeoutError are subclasses of OSError. 598 is not a code the server sends, so no
        # check can mistake it for one.
        return 598, {"error": "no answer within %ss: %s" % (timeout, e)}


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
# ITS OWN STATE FOLDER (review #16): this console never reads or writes the operator's plan, settings
# or logs - no snapshot of mission.json, and no write-back of one when the suite ends.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from console_state import ConsoleState  # noqa: E402
STATE = ConsoleState()
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none",
                         "--port", str(port), "--no-ais-service", "--no-log", *STATE.args()],
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

    # ⚠⚠ 2d. A BOX THE SIZE OF A STATE IS REFUSED, NOT EXTRACTED (2026-09-23). The page asked
    # for exactly this box - Erie to Delaware Bay, 5.05 x 3.38 degrees - because a stale home
    # sat 500 km from the boat, and this handler passed it straight to the extractor. The
    # request never returned; the operator's chart page stopped responding on it. Refused in
    # words, with a DIFFERENT message from the usage string - so 2 above cannot stand in for
    # this, and a cap that fell back to the generic 400 would fail here.
    big = get(port, "/api/enc?bbox=-80.14981,38.80850,-75.09646,42.18433&min_depth=1")
    check("2d. a bbox spanning 5 degrees is a 400 that names the span and the cap",
          lambda: big[0] == 400 and "spans" in (big[1].get("error") or "")
                  and "degrees" in (big[1].get("error") or ""),
          lambda: "%d: %s" % (big[0], (big[1].get("error") or "")[:110]))
    # THE ACCEPTANCE CASE is check 3 below - the operating-area box still comes back 200.

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
# tracebacks and routes that raised - not every line that says "Error" (tests/lib/server_log.py, review #17)
from server_log import exception_lines  # noqa: E402
tb = exception_lines(server_out)
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

# ── 11. THE WARM TOOL AND THE CONSOLE MUST AGREE ON THE CACHE FILENAME ──────────────
#
# ⚠ tools/warm_enc.py HAS A DELETE MODE, and it was ONE STRING MISMATCH from offering up
# the cache the console is actually reading. Its inventory parses the version out of a
# filename as the bare tag ("v5") while it read the version out of asv_console.py as the
# whole prefix ("features_v5"), so nothing on disk ever compared equal to "current": every
# version listed as *superseded, ignored by the console*, and `--prune` put the LIVE
# extracts on the delete list beside the dead ones. Nothing threw. The listing simply said
# the wrong thing, and only reading its output rather than trusting it caught that.
#
# So pin the two together the only way that means anything - require the tool to read the
# version in the shape its own inventory parses, and to rebuild the console's exact
# filename from it - and then require the delete path to refuse the live version anyway.
_warm = os.path.join(APP, "tools", "warm_enc.py")
if not os.path.exists(_warm):
    check("11. the warm tool agrees with the console on the cache filename",
          lambda: False,
          "tools/warm_enc.py NOT FOUND - it is what pre-loads every operating port")
else:
    with open(_warm, "r", encoding="utf-8") as _f:
        _wsrc = _f.read()
    _wtag = "(v\\d+)_%s" in _wsrc                      # captures the TAG, not the prefix
    _whit = 'features_%s_%s.json" % (cur, key)' in _wsrc
    check("11. the warm tool reads the cache version as the BARE TAG its inventory parses",
          (lambda: _wtag),
          "cache_version() must capture (v\\d+), not the whole features_vN prefix - "
          "otherwise every cached version reads as superseded and --prune targets the "
          "live one")
    check("11b. ... and rebuilds the console's exact cache filename from it",
          (lambda: _whit),
          "console writes %s; the tool must probe the same string"
          % (_ver.group(0) if _ver else "features_v?_%s.json"))
    check("11c. ... and the delete path refuses the current version outright, regardless",
          (lambda: "dead = [v for v in dead if v != cur]" in _wsrc),
          "no unconditional guard - one string mismatch would put the live cache back on "
          "the delete list")

    # ── 11d. THE NUMBER ANNOUNCED IS THE NUMBER THAT GOES ────────────────────────────
    #
    # ⚠ RUN FOR REAL, IN A TEMP DIRECTORY, because the three checks above are source-text
    # checks and this is the one that catches what they could not. The first real prune
    # announced "122 extracts" and removed 124 FILES: the count required a `.json` suffix
    # and the delete matched any `features_v*`, so two orphaned `.json.part` writes from
    # interrupted fetches went with them. Nothing was lost that time - they were dead
    # weight at dead versions - but a confirmation prompt whose number is not the number
    # that goes is theatre, and this is the SECOND predicate mismatch in this one tool
    # (the first put the LIVE cache on the delete list). Both halves now read one
    # enumeration; this proves they agree rather than asserting that they look alike.
    import tempfile as _tf
    _d = _tf.mkdtemp()
    try:
        import importlib.util as _iu
        _sp = _iu.spec_from_file_location("warm_enc", _warm)
        _w = _iu.module_from_spec(_sp)
        _sp.loader.exec_module(_w)
        for _n in ("features_v3_a.json", "features_v3_b.json",
                   "features_v3_c.json.part",       # orphaned interrupted write, dead ver
                   "features_v5_a.json",
                   "features_v5_a.json.part",       # a LIVE part-write - must survive
                   # NEITHER .json NOR .json.part, so the strict predicate rejects it and
                   # a loose `startswith("features_v")` accepts it. That divergence is the
                   # whole defect, and without a file of this shape in the fixture the
                   # check passes with the bug restored - which it did, twice, before this
                   # line existed.
                   "features_v3_z.json.bak",
                   "chartinfo_v1_x.json"):          # a different cache - not ours to take
            with open(os.path.join(_d, _n), "w", encoding="utf-8") as _f:
                _f.write("{}")
        _inv = _w.inventory(_d, "v5")
        _dead = [v for v in _inv if v != "v5"]
        # THE FUNCTION THE PRUNE ACTUALLY DELETES, called for real. An earlier version of
        # this check compared `inventory` against `cached_files` — two functions where one
        # is built from the other, so they agreed by construction and TWO mutations of the
        # real defect walked straight through it. The delete is its own function now
        # precisely so it can be called here, and `main` prints len() of the same list it
        # then removes: they cannot disagree, which is worth more than a check that they do
        # not happen to.
        _doomed = _w.prune_targets(_d, _dead)
        _announced = sum(_inv[v][0] for v in _dead) + sum(_inv[v][2] for v in _dead)
        _all = [f for _v, f, _p in _w.cached_files(_d)]
        check("11d. the prune deletes exactly the files its own inventory counted",
              (lambda: _announced == len(_doomed) == 3),
              "inventory says %d, prune_targets returns %d - a count and a delete reading "
              "the set two ways is how 122 became 124" % (_announced, len(_doomed)))
        check("11e. ... and it takes nothing it does not own",
              (lambda: "features_v5_a.json.part" not in _doomed
                       and "features_v5_a.json" not in _doomed
                       and "features_v3_z.json.bak" not in _doomed
                       and "chartinfo_v1_x.json" not in _all),
              "kept the live v5 extract and its part-write: %s; left the stray .bak: %s; "
              "ignored the chartinfo cache: %s"
              % ("features_v5_a.json" not in _doomed and "features_v5_a.json.part" not in _doomed,
                 "features_v3_z.json.bak" not in _doomed,
                 "chartinfo_v1_x.json" not in _all))
    finally:
        import shutil as _sh
        _sh.rmtree(_d, ignore_errors=True)


# ── 12: A PARTLY-FAILED EXTRACT IS NEVER CACHED ────────────────────────────────────────
#
# ⚠⚠ THE DEFECT THIS PINS WAS ALREADY ON DISK. Every per-layer job answered [] on any
# network or service error, which is indistinguishable from "this layer has no features
# here", and the assembled dict was written to the cache with no success accounting, no TTL
# and no revalidation - so one bad minute became the chart for that bbox for ever. Measured
# in the operator's own cache: an extract holding 1591 features, 806 of them depth, and ZERO
# land / shoreline / dock, against its neighbour 80 m west over the same south/east/north
# edges holding 252 structures. Land does not vanish over 80 m.
#
# ⚠ AND IT COULD NOT BE SEEN FROM THE CLIENT. `band` is still set on a partial extract, so
# "we have chart data" is TRUE, the Nogo row reads healthy, and Go-To / RTH / punch-out
# route across a shoreline that is simply not in the model. A refusal was indistinguishable
# from success - the one failure shape this console's whole design argues against.
#
# Hermetic: the network is replaced outright, so this asserts the CACHING RULE and touches
# no service and no real cache file.
_d = tempfile.mkdtemp(prefix="asv_enc_partial_")
_sav = (A.ENC_DIR, A._enc_layer_map, A._enc_query_ids, A._enc_query_by_ids,
        A._enc_query, A._enc_pick_band)
try:
    A.ENC_DIR = _d
    # ⚠ THE BAND PICK IS A NETWORK CALL TOO, and leaving it real made the first draft of
    # this block PASS FOR THE WRONG REASON: `_enc_pick_band` answered None (offline), the
    # function returned "no ENC coverage here" before reaching the assembly at all, and
    # "no cache was written" was true because nothing had been fetched. Stub everything the
    # path touches, then assert - and reset the circuit breaker between phases, because a
    # failed fetch arms a 30 s cooldown that would silently skip the next one.
    A._enc_pick_band = lambda bbox: "enc_harbour"
    A._enc_layer_map = lambda band, timeout=20.0: {"LNDARE": 1, "DEPARE": 2}
    A._enc_query_by_ids = lambda b, lid, ids, **k: [
        {"geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {}}]
    A._enc_query = lambda b, lid, bx, **k: {"features": []}

    BBOX = (-30.0, 20.0, -29.99, 20.01)          # mid-ocean: no real cache can exist
    CACHE = os.path.join(_d, "features_v5_%s.json" % A._bbox_key(BBOX))

    # (a) ONE layer fails: nothing may be written, and the caller is told which.
    def _ids_one_fails(band, lid, bbox, **k):
        if lid == 1:
            raise OSError("simulated upstream failure")
        return [1]
    A._enc_query_ids = _ids_one_fails
    A._enc_down_until = 0.0
    part = A.fetch_enc_features(BBOX)
    check("12. a partly-failed extract is NOT cached - a transient failure cannot become "
          "the permanent truth about that water",
          lambda: not os.path.exists(CACHE),
          "cache file written: %s" % os.path.exists(CACHE))
    check("12b. ... and the response says which layers were lost, so a caller can refuse "
          "to trust it as a keep-out source",
          lambda: bool(part.get("partial")) and "LNDARE" in (part.get("partial") or [])
                  and not part.get("complete"),
          "partial=%s complete=%s" % (part.get("partial"), part.get("complete")))

    # (b) ACCEPTANCE: every layer succeeds -> it caches exactly as it always did.
    A._enc_query_ids = lambda band, lid, bbox, **k: [1]
    A._enc_down_until = 0.0
    good = A.fetch_enc_features(BBOX)
    check("12c. ACCEPTANCE: a COMPLETE extract still caches - the refusal is about "
          "failure, not about caching",
          lambda: os.path.exists(CACHE) and good.get("complete") is True
                  and not good.get("partial"),
          "cached=%s complete=%s partial=%s"
          % (os.path.exists(CACHE), good.get("complete"), good.get("partial")))

    # (c) AND AN EMPTY LAYER IS NOT A FAILED ONE - the distinction the bug could not make.
    if os.path.exists(CACHE):
        os.remove(CACHE)
    A._enc_query_ids = lambda band, lid, bbox, **k: ([] if lid == 1 else [1])
    A._enc_down_until = 0.0
    empty = A.fetch_enc_features(BBOX)
    check("12d. an EMPTY layer is not a failed one: genuinely nothing there still caches",
          lambda: os.path.exists(CACHE) and empty.get("complete") is True
                  and not empty.get("partial"),
          "cached=%s partial=%s - [] from the service and [] from a dead socket were the "
          "SAME VALUE before this" % (os.path.exists(CACHE), empty.get("partial")))

    # ⚠⚠ 12e. AN ARCGIS ERROR PAYLOAD IS NOT AN EMPTY LAYER. The REST service reports its own
    # faults as HTTP 200 with {"error": {...}} and no objectIds - which parses perfectly and
    # fell straight through `_enc_query_ids`'s `or []`, so a refusal reached the caller
    # wearing the exact shape of "there is nothing of this class here". That is the hole the
    # `ok` flag exists to see, and it could not see it until this raised.
    if os.path.exists(CACHE):
        os.remove(CACHE)
    (A.ENC_DIR, A._enc_layer_map, A._enc_query_ids,
     A._enc_query_by_ids, A._enc_query, A._enc_pick_band) = _sav
    A.ENC_DIR = _d
    A._enc_pick_band = lambda bbox: "enc_harbour"
    A._enc_layer_map = lambda band, timeout=20.0: {"LNDARE": 1, "DEPARE": 2}
    A._enc_query_by_ids = lambda b, lid, ids, **k: [
        {"geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {}}]
    A._enc_query = lambda b, lid, bx, **k: {"features": []}

    class _R200:                       # HTTP 200 carrying an ArcGIS error body
        def __init__(s, payload): s._p = json.dumps(payload).encode()
        def read(s): return s._p
        def __enter__(s): return s
        def __exit__(s, *a): return False
    _savurl = A.urllib.request.urlopen
    try:
        A.urllib.request.urlopen = lambda req, timeout=None: _R200(
            {"error": {"code": 500, "message": "Unable to complete operation."}})
        raised = False
        try:
            A._enc_query_ids("enc_harbour", 1, (-30.0, 20.0, -29.99, 20.01))
        except ValueError as e:
            raised = "Unable to complete" in str(e)
        check("12e. an ArcGIS error body served as HTTP 200 RAISES rather than reading as an "
              "empty layer - which is the only way the extract's ok flag can see it",
              lambda: raised,
              "the 200-with-an-error-payload path: raised=%s (it returned [] before, "
              "indistinguishable from 'nothing of this class here')" % raised)
    finally:
        A.urllib.request.urlopen = _savurl

    # ⚠⚠ 12f. AND A LAYER MAP THE SERVICE REFUSED IS NEVER CACHED. `_enc_layer_map`'s file
    # carries no version and no TTL, so caching an empty map makes one bad minute at NOAA the
    # permanent truth about the whole band: every later extract reads it back, builds no jobs,
    # and the console has no ENC there for ever.
    A._enc_layer_map = _sav[1]                              # the REAL one, for this check
    try:
        A.urllib.request.urlopen = lambda req, timeout=None: _R200(
            {"error": {"code": 500, "message": "Unable to complete operation."}})
        A._enc_layermaps.clear()
        lm = A._enc_layer_map("enc_harbour")
        lmpath = os.path.join(_d, "enc_harbour", "_layers.json")
        check("12f. a layer map the service refused is NOT cached, so the band comes back the "
              "moment the service does",
              lambda: lm == {} and not os.path.exists(lmpath),
              "map=%s, _layers.json written=%s" % (lm, os.path.exists(lmpath)))
    finally:
        A.urllib.request.urlopen = _savurl
        A._enc_layermaps.clear()
finally:
    (A.ENC_DIR, A._enc_layer_map, A._enc_query_ids,
     A._enc_query_by_ids, A._enc_query, A._enc_pick_band) = _sav
    A._enc_down_until = 0.0
    import shutil as _sh2
    _sh2.rmtree(_d, ignore_errors=True)

# ⚠⚠ 13. A BIG RESPONSE MUST NOT HOLD THE GIL, BECAUSE THE CONTROL LOOP IS IN THIS PROCESS.
# `json.dumps` is ONE C call that never yields. Measured on real cached extracts with a 4 Hz
# thread running beside it: a 10.6 MB extract stalled that thread for 0.52 s and a 165 MB one
# for 8.56 s. For those 8.5 seconds the telemetry loop does not run, which means the
# clearance ladder does not run - the guard is not slow, it is ABSENT.
# `JSONEncoder().iterencode` is the pure-Python encoder and yields between fragments; the
# same measurement gives 0.26 s and 0.28 s, so the tick keeps its cadence.
#
# ⚠ BOTH HALVES, because either alone passes for the wrong reason. The bytes must be
# IDENTICAL to json.dumps - this is a wire format, not a rendering - and the yielding must
# actually HAPPEN, which is asserted by driving a 4 Hz thread across a real encode. A source
# grep for `iterencode` would be satisfied by a call whose result was thrown away.
#
# ⚠ AND IT COSTS ~4x WALL TIME ON THE REQUEST (0.54 -> 2.03 s on the ordinary extract). That
# is the trade, and it is the right way round: a chart fetch happens on an area change, a
# guard blackout happens at the one moment nobody can afford it.
import threading as _th13

_big = {"features": [{"role": "depth_area", "cls": "DEPARE",
                      "props": {"DRVAL1": i * 0.1, "OBJNAM": "cell %d" % i},
                      "geometry": {"type": "Polygon",
                                   "coordinates": [[[i * 1e-5, i * 1e-5]] * 40]}}
                     for i in range(12000)]}

def _worst_gap(fn):
    gaps, stop = [], _th13.Event()

    def _tick():
        last = time.perf_counter()
        while not stop.is_set():
            time.sleep(0.25)
            now = time.perf_counter()
            gaps.append(now - last)
            last = now

    t = _th13.Thread(target=_tick, daemon=True)
    t.start()
    time.sleep(0.4)
    out = fn()
    time.sleep(0.2)
    stop.set()
    t.join(timeout=2)
    return out, (max(gaps) if gaps else 0.0)

_b_yield, _gap_yield = _worst_gap(lambda: A._json_body_yielding(_big))
_b_dumps, _gap_dumps = _worst_gap(lambda: json.dumps(_big).encode("utf-8"))
check("13. a large response goes through the YIELDING encoder, so the 4 Hz control loop "
      "keeps ticking - and its bytes are identical to json.dumps",
      lambda: _b_yield == _b_dumps and _gap_yield <= max(0.6, _gap_dumps),
      "%d bytes both ways; worst 4 Hz gap %.2f s yielding vs %.2f s with json.dumps "
      "(on a real 165 MB extract: 0.28 s vs 8.56 s)"
      % (len(_b_yield), _gap_yield, _gap_dumps))

_enc_src = open(os.path.join(APP, "asv_console.py"), encoding="utf-8").read()
_fn = _enc_src[_enc_src.index("def _serve_enc"):]
_fn = _fn[:_fn.index("def _serve_chartinfo")]
check("13b. ... and /api/enc actually uses it - a helper nothing calls is a comment",
      lambda: "_json_body_yielding(data)" in _fn and "json.dumps(data)" not in _fn,
      "the ENC route is the one that serves those extracts")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
