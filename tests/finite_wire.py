"""tests/finite_wire.py - nothing non-finite leaves this console.

    python tests/finite_wire.py      # exit 0 = pass, 1 = fail   (stdlib Python)

⚠⚠ A NaN IS NOT A BLANK FIELD, IT IS A DEAD CONSOLE. `json.dumps` writes `NaN` bare,
which is not JSON, so the browser's `JSON.parse` throws on the entire frame. The telemetry
stream is that frame four times a second, so one bad number stops the page updating
altogether - and nothing on screen says why. `json.loads` accepts a bare NaN, so it also
round-trips: a NaN written into mission.json comes back out as one.

⚠ AND clamp IS NaN-TRANSPARENT BY DESIGN, which is what makes the boundary necessary.
`NaN < lo` and `NaN > hi` are both False, so `clamp` returns the NaN untouched. Substituting a
value inside clamp is the obvious move and is wrong: `lo` is the conservative end of a
percentage and a HARD TURN at `clamp(d_cross / v_thru, -0.9, 0.9)`. The guarantee lives where
the number leaves, not where it is bounded.
"""
import json
import math
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
sys.path.insert(0, APP)


def _crash_report(exc_type, exc, tb):
    print("  FAIL 0. the suite itself CRASHED before finishing - "
          + "".join(traceback.format_exception_only(exc_type, exc)).strip())
    print("\n1 CHECK(S) FAILED (crashed before finishing)")
    os._exit(1)


sys.excepthook = _crash_report

import asv_console as A                                             # noqa: E402

fails = 0
ran = 0


def check(name, cond, detail):
    global fails, ran
    ran += 1
    try:
        ok = bool(cond() if callable(cond) else cond)
        note = detail() if callable(detail) else detail
    except Exception as e:                                          # noqa: BLE001
        ok, note = False, "THREW: %s" % e
    print(("  ok   " if ok else "  FAIL ") + name + ("   [%s]" % note if note else ""))
    if not ok:
        fails += 1


def strict(s):
    """Parse the way a BROWSER does - refusing the three tokens JSON does not have."""
    def no(c):
        raise ValueError("not JSON: " + c)
    return json.loads(s, parse_constant=no)


print("Nothing non-finite leaves this console:")

_src = open(os.path.join(APP, "asv_console.py"), encoding="utf-8").read()

NAN = float("nan")
INF = float("inf")

# -- 1. the defect this exists for ------------------------------------------------------
check("1. clamp is NaN-TRANSPARENT, which is the whole reason a boundary is needed",
      lambda: math.isnan(A.clamp(NAN, 0.0, 100.0)),
      "clamp(nan, 0, 100) -> nan: `NaN < lo` and `NaN > hi` are both False, so it takes the "
      "else arm. This is asserted, not deplored - substituting a value here would be a silent "
      "hard turn at clamp(d_cross / v_thru, -0.9, 0.9)")

_raw = json.dumps({"fuel_pct": A.clamp(NAN, 0.0, 100.0)})


def _raw_rejected():
    """Does a strict (browser-like) parse refuse that frame? It must."""
    try:
        strict(_raw)
        return False
    except ValueError:
        return True


check("1b. ... and that NaN, serialised, is NOT JSON - the browser refuses the whole frame",
      lambda: "NaN" in _raw and _raw_rejected(),
      lambda: "json.dumps gave %s, which JSON.parse throws on - so the console stops updating "
              "entirely rather than blanking one field" % _raw)


# -- 2. the boundary --------------------------------------------------------------------
_clean = A.finite_only({"fuel_pct": NAN, "range_nm": INF, "sog_kn": 7.2,
                        "status": {"cog_deg": NAN, "heading_deg": 91.0},
                        "legs": [1.5, NAN, 3.0]})
check("2. finite_only replaces every non-finite with null, at every depth",
      lambda: _clean["fuel_pct"] is None and _clean["range_nm"] is None
              and _clean["status"]["cog_deg"] is None and _clean["legs"][1] is None,
      lambda: "%s - `null` is what every one of these readouts already shows for "
              "'not reported'" % json.dumps(_clean))

check("2b. ... and leaves every FINITE number exactly as it was",
      lambda: _clean["sog_kn"] == 7.2 and _clean["status"]["heading_deg"] == 91.0
              and _clean["legs"] == [1.5, None, 3.0],
      lambda: "sog %s, heading %s, legs %s - a backstop that rounded or dropped good numbers "
              "would be a worse bug than the one it fixes"
              % (_clean["sog_kn"], _clean["status"]["heading_deg"], _clean["legs"]))

check("2c. ... and what comes out PARSES the way a browser parses",
      lambda: strict(json.dumps(_clean)) is not None,
      "the same frame that threw above goes through a strict parse now")

# -- 3. the reachable entry --------------------------------------------------------------
# ⚠⚠ json.loads ACCEPTS A BARE NaN. This is not hypothetical arithmetic: a NaN in
# mission.json survives the parse, survives `float()`, and is published.
_plan = json.loads('{"approach_radius_m": NaN, "arrival_radius_m": 5.0}')
check("3. a NaN in the PLAN FILE survives json.loads and float() - neither refuses it",
      lambda: math.isnan(_plan["approach_radius_m"])
              and math.isnan(float(_plan["approach_radius_m"])),
      "which is why the radii are checked where they are READ, not where they are used")

check("3b. ... and _finite refuses it, falling back to the same default an ABSENT field gets",
      lambda: A._finite(NAN, 2.0) == 2.0 and A._finite(INF, 2.0) == 2.0
              and A._finite(None, 2.0) == 2.0 and A._finite("x", 2.0) == 2.0
              and A._finite(0, 2.0) == 2.0,
      "nan / inf / None / a string / 0 all fall back - 0 because the call sites read "
      "`x or default` before this and 0 has always meant 'unset' there")

# ⚠⚠ AND THE CALL SITES USE IT. Check 3b proves the HELPER refuses a NaN; nothing
# proved anyone CALLS it, and the mutation that put the raw `float(x or default)` back survived
# a whole sweep because of that. It is the third time this session a check has tested a
# mechanism while its call sites went unguarded - setTip and lineNo were the other two.
check("3d. ... and the plan's radii actually GO THROUGH it, which 3b does not establish",
      lambda: '_finite(approach_radius_m, WP_APPROACH_M)' in _src
              and '_finite(arrival_radius_m, 5.0)' in _src
              and 'float(approach_radius_m or' not in _src,
      lambda: "approach: %s | arrival: %s | raw cast gone: %s"
              % ('_finite(approach_radius_m, WP_APPROACH_M)' in _src,
                 '_finite(arrival_radius_m, 5.0)' in _src,
                 'float(approach_radius_m or' not in _src))

check("3c. ... and passes a good value straight through",
      lambda: A._finite(3.5, 2.0) == 3.5 and A._finite("4", 2.0) == 4.0,
      "a guard that also rejected valid input would be the same defect facing the other way")

# -- 4. the wire itself, both doors -------------------------------------------------------
# ⚠ SOURCE-ANCHORED, AND SAID SO: driving the real _publish needs a subscriber queue and a
# running engine, which tests/data_routes.py owns. What is pinned here is that BOTH doors a
# frame leaves by go through the sanitiser - the 4 Hz stream and the polled /api/state, since a
# page fetches the latter on load and would fail before the stream ever opened.
check("4. both doors a frame leaves by are sanitised - the stream AND the polled route",
      lambda: "json.dumps(finite_only(event))" in _src
              and "json.dumps(finite_only(ENGINE.state()))" in _src,
      lambda: "stream: %s | polled: %s"
              % ("json.dumps(finite_only(event))" in _src,
                 "json.dumps(finite_only(ENGINE.state()))" in _src))

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
