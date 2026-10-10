"""tests/speed_knots.py - the operator selects speed in WHOLE KNOTS, on every hull (2026-10-09).

Andy: "Change speed selection to knots in integer increments. This is commanded speed that environmental forcing will
affect. All ASV's."

WHAT IT WAS. The three role selectors (survey, turn, transit) offered Low / Survey / High - three named speeds per hull,
4 / 7 / 10 kn on the DriX with the EM712 gondola. A speed between them could not be asked for.

WHAT IT IS. apply_vessel derives the hull's whole knots - its low rounded up to its high rounded down - and adds each to
SPEED_KN as a key ("7" -> 7.0), so everything that turns a key into a speed (the sim's throttle, the page's
estimates, the turn radius) takes it unchanged; the list goes to the page with the vessel (propulsion.speed_steps_kn)
and fills the selectors. A plan holding anything else is moved to the nearest whole knot when it is read
(_norm_speeds). The named three stay as the CONSOLE's speeds - the guard's low, the escape's high, hold_speed_kn's
ladder - on no selector, meaning what they meant. And the speed is COMMANDED, through the water: the stream is added,
so her speed over the ground is the sum (check 7).

The page's half is tests/speed_knots.js.

    python tests/speed_knots.py     # exit 0 = pass, 1 = fail   (in-process: no console, no network)
"""

import atexit
import copy
import importlib.util
import json
import math
import os
import shutil
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.dirname(HERE)
sys.path.insert(0, APP)        # the app's modules first: tests/currents.py is a SUITE, and would shadow currents.py

fails = 0
ran = 0


def _crash_report(t, e, tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (t.__name__, e))
    print("".join(traceback.format_exception(t, e, tb))[-900:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")
    sys.stdout.flush()
    os._exit(1)


sys.excepthook = _crash_report             # a death is REPORTED, not silent (turn_geometry.js check 30)


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


# Import the console WITHOUT starting anything (nothing runs on import by design). ASV_CONSOLE names a SIDECAR copy for
# a mutation run - beside the real one, which it finds its vessels/ from - so the real source is never the one mutated.
spec = importlib.util.spec_from_file_location("console_for_speed_knots",
                                              os.environ.get("ASV_CONSOLE") or os.path.join(APP, "asv_console.py"))
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)

TMP = tempfile.mkdtemp(prefix="asv_speed_knots_")
atexit.register(shutil.rmtree, TMP, True)
A.MISSION_PATH = os.path.join(TMP, "mission.json")     # never the operator's plan (tests_must_not_write_app_state)
A._MISSION_CACHE = None

print("Speed selected in whole knots, on every hull:")


def raw(vid):
    with open(os.path.join(APP, "vessels", vid + ".json"), encoding="utf-8") as f:
        return json.load(f)


def use(vid):
    A.apply_vessel(A.load_vessel(vid))


# 1-2. THE RANGE, PER HULL. Written out here from each file's own low and high - not computed by the rule under test.
WANT = {"drix08_em712": list(range(4, 11)),      # low 4.0, high 10.0
        "drix08": list(range(4, 12)),            # low 4.0, high 11.5 -> 11
        "ben_cworker4": list(range(2, 6)),       # low 2.0, high 5.5 -> 5
        "zboat_1800hs": list(range(2, 7))}       # low 1.5 -> 2, high 6.0
got = {}
for vid in WANT:
    use(vid)
    got[vid] = (list(A.SPEED_STEPS_KN), {k: A.SPEED_KN[k] for k in A.SPEED_KN},
                copy.deepcopy(A.VESSEL["propulsion"].get("speed_steps_kn")))
check("1. each hull offers its whole knots, low rounded up to high rounded down (DriX EM712 4-10, EM2040 4-11, "
      "BEN 2-5, small-class 2-6), each a SPEED_KN key worth its knots, and the named three unchanged",
      lambda: all(got[v][0] == WANT[v]
                  and all(got[v][1][str(n)] == float(n) for n in WANT[v])
                  and all(got[v][1][k] == float(raw(v)["propulsion"]["speeds_kn"][k]) for k in ("low", "survey", "high"))
                  and len(got[v][1]) == 3 + len(WANT[v])
                  for v in WANT),
      lambda: "; ".join("%s %s" % (v, got[v][0]) for v in WANT))
check("2. the list travels WITH the vessel (propulsion.speed_steps_kn, what the page's selectors are filled from), "
      "and no vessel file carries it - it is derived, never written",
      lambda: all(got[v][2] == WANT[v] and "speed_steps_kn" not in raw(v)["propulsion"] for v in WANT),
      lambda: "; ".join("%s %s" % (v, got[v][2]) for v in WANT))

# 3. A PLAN'S SPEEDS, MOVED ONTO THE WHOLE KNOTS. Acceptance first: a whole knot the hull has is kept as it is.
use("drix08_em712")
em712 = (A._norm_speeds({"transit": "9", "turn": "4", "survey": "8"}),
         A._norm_speeds({"transit": "high", "turn": "low", "survey": "survey"}),
         A._norm_speeds({"transit": "12", "turn": 6, "survey": "warp"}, "low"),
         A._norm_speeds(None))
use("ben_cworker4")
ben = A._norm_speeds({"transit": "survey", "turn": "low", "survey": "high"})
# HALVES ROUND UP, asked inside BEN's range where no clamp can hide the rounding: 3.5 and 4.5 kn (bare numbers, which
# is what another hull's knots are to her). Her 5.5 above and the small-class 1.5 below land on a range end either way.
ben_half = A._norm_speeds({"transit": 3.5, "turn": 2.4, "survey": 4.5})
use("zboat_1800hs")
small = A._norm_speeds({"transit": "10", "turn": "low", "survey": "survey"})
use("drix08")
em2040 = A._norm_speeds({"transit": "high", "turn": "11", "survey": "7"})
check("3. ACCEPTANCE: a whole knot the hull has is kept as it is (9 / 4 / 8 on the EM712)",
      lambda: em712[0] == {"transit": "9", "turn": "4", "survey": "8"}, lambda: str(em712[0]))
check("3b. a plan saved with NAMED speeds comes back at the nearest whole knot - on the EM712 the same speeds "
      "(10 / 4 / 7); the ones that are not whole knots move: BEN's survey and high 5.5 -> 5 (her top), small-class "
      "low 1.5 -> 2, EM2040 high 11.5 -> 11; and halves round UP inside a range (BEN 3.5 -> 4, 4.5 -> 5, 2.4 -> 2)",
      lambda: em712[1] == {"transit": "10", "turn": "4", "survey": "7"}
      and ben == {"transit": "5", "turn": "2", "survey": "5"}
      and ben_half == {"transit": "4", "turn": "2", "survey": "5"}
      and small["turn"] == "2" and small["survey"] == "3"
      and em2040 == {"transit": "11", "turn": "11", "survey": "7"},
      lambda: "em712 %s; ben %s, halves %s; small %s; em2040 %s" % (em712[1], ben, ben_half, small, em2040))
check("3c. another hull's knot is clamped into this one's range (\"10\" on the small-class hull, top 6 -> 6), a bare "
      "number is a knot (6 -> \"6\"), above the top is the top (\"12\" -> \"10\"), and nothing usable takes the "
      "fallback's knot (\"warp\" with the legacy `low` -> 4) or the survey speed's",
      lambda: small["transit"] == "6" and em712[2] == {"transit": "10", "turn": "6", "survey": "4"}
      and em712[3] == {"transit": "7", "turn": "7", "survey": "7"},
      lambda: "small %s; em712 %s / %s" % (small, em712[2], em712[3]))

# 4. THE PLAN FILE, READ ON ANOTHER HULL. The page reloads the plan after a vessel switch and adopts what comes back,
#    so the reading is where the clamp has to happen.
use("drix08_em712")
A.save_mission({"waypoints": [], "lines": [], "speeds": {"transit": "9", "turn": "4", "survey": "7"}})
on712 = A.load_mission()["speeds"]
use("zboat_1800hs")
onsmall = A.load_mission()["speeds"]
check("4. a plan saved at 9 / 4 / 7 on the EM712 reads back unchanged there, and at 6 / 4 / 6 on the small-class "
      "hull (top 6) - the file is not rewritten by the reading",
      lambda: on712 == {"transit": "9", "turn": "4", "survey": "7"}
      and onsmall == {"transit": "6", "turn": "4", "survey": "6"}
      and json.load(open(A.MISSION_PATH, encoding="utf-8"))["speeds"] == {"transit": "9", "turn": "4", "survey": "7"},
      lambda: "EM712 %s, small-class %s" % (on712, onsmall))

# 5. THE COMMAND. A whole knot is commanded live; one the hull does not have is refused in words; the console's own
#    named speeds are still taken (the guard's LOW goes through this same command).
use("drix08_em712")
e = A.Engine()
e._link = A.SimVcu(44.9, -67.0)
e.armed = True
e.set_speed("7")
took7 = (e._link.speed_key, e.note)
refused = None
try:
    e.set_speed("12")
except A.VcuProtocolError as x:
    refused = str(x)
e.set_speed("low")
check("5. a whole knot is COMMANDED (the vessel's speed_key \"7\", the note \"Speed: 7 kn\"), one the hull lacks is "
      "REFUSED naming the range (12 on a 4-10 hull), and the console's own `low` is still taken",
      lambda: took7 == ("7", "Speed: 7 kn - applied live.") and refused and "'12'" in refused
      and "whole knot from 4 to 10" in refused and e._link.speed_key == "low",
      lambda: "took %s; refused %r; then %s" % (took7, refused, e._link.speed_key))

# 6. AN UPLOAD carries the whole knot as its starting speed, where an unknown key falls back to survey as before.
v = A.SimVcu(44.9, -67.0)
v.upload_plan([{"lat": 44.91, "lon": -67.0}], 5.0, "8", 2.0)
up8 = v.speed_key
v.upload_plan([{"lat": 44.91, "lon": -67.0}], 5.0, "12", 2.0)
check("6. an upload at a whole knot starts at it (\"8\"); one the hull lacks falls back to survey, as before",
      lambda: up8 == "8" and v.speed_key == "survey", lambda: "8 -> %s, 12 -> %s" % (up8, v.speed_key))


# 7. COMMANDED SPEED, THROUGH THE WATER. In slack water she makes good what she is told; in a 1 kn stream dead ahead the
#    throttle still holds 7 through the water and she makes good about 6 over the ground - the environment acts on the
#    commanded speed, it does not replace it.
class _Stream:
    def __init__(self, kn, set_deg):
        self.kn, self.set_deg = kn, set_deg

    def snapshot(self):
        return {"ok": True, "speed_kn": self.kn, "set_deg": self.set_deg, "source": "test"}

    def field_at(self, *a):
        return (self.kn, self.set_deg)

    def update_position(self, *a):
        pass


def run_at(key, stream_kn):
    A.CURRENTS = _Stream(stream_kn, 180.0)            # setting south, against her northbound leg
    s = A.SimVcu(43.07, -70.71)
    end = A.dest_point(s.lat, s.lon, 0.0, 20000.0)
    s.heading = 0.0
    s.upload_plan([{"lat": end[0], "lon": end[1]}], 5.0, key, 2.0, completion="loiter")
    s.start()
    for _ in range(240):                              # 60 s to come up to speed
        s.tick(0.25)
    p, made = (s.lat, s.lon), 0.0
    for _ in range(240):                              # then 60 s measured
        q = (s.lat, s.lon)
        s.tick(0.25)
        made += A.range_bearing(q[0], q[1], s.lat, s.lon)[0]
    return s.sog_kn, made / 60.0 / 0.514444, s.speed_key


_real_currents = A.CURRENTS
calm = run_at("7", 0.0)
head = run_at("7", 1.0)
A.CURRENTS = _real_currents                           # apply_vessel re-points the real one at the port's model
check("7. COMMANDED THROUGH THE WATER: told 7 kn she runs 7 through the water either way, and makes good 7 kn over "
      "the ground in slack water and about 6 in a 1 kn stream dead ahead",
      lambda: calm[2] == head[2] == "7" and abs(calm[0] - 7.0) < 0.05 and abs(head[0] - 7.0) < 0.05
      and abs(calm[1] - 7.0) < 0.15 and abs(head[1] - 6.0) < 0.25,
      lambda: "slack: through the water %.2f, made good %.2f kn; 1 kn ahead: %.2f, made good %.2f kn"
      % (calm[0], calm[1], head[0], head[1]))

# 8. THE CONSOLE'S OWN SPEEDS ARE UNCHANGED. hold_speed_kn climbs the NAMED ladder: a set low no longer beats goes to
#    survey (7), never to a whole knot between (5) - the steps are the operator's, not the hold's.
use("drix08_em712")
need5 = (5.0 - 0.5) / 1.9438                         # a set (m/s) that LOW (4.0) cannot beat by 0.5 kn but 5 kn could
check("8. the hold's ladder is still the named three: LOW in slack water, SURVEY (7.0) once LOW cannot beat the set - "
      "not a whole knot between",
      lambda: A.hold_speed_kn(0.0) == 4.0 and A.hold_speed_kn(need5 - 0.05) == 7.0,
      lambda: "slack %.1f, set %.2f m/s -> %.1f" % (A.hold_speed_kn(0.0), need5 - 0.05, A.hold_speed_kn(need5 - 0.05)))

# 9. A HULL WITH NO WHOLE KNOT IS REFUSED at load, paired with the shipped four, which load.
bad = raw("drix08_em712")
bad["propulsion"]["speeds_kn"] = {"low": 4.2, "survey": 4.5, "high": 4.8}
why = None
try:
    A.validate_vessel(bad, "bad")
except ValueError as x:
    why = str(x)
zero = raw("drix08_em712")
zero["propulsion"]["speeds_kn"]["low"] = 0
why0 = None
try:
    A.validate_vessel(zero, "zero")
except ValueError as x:
    why0 = str(x)
shipped = []
for vid in WANT:
    try:
        A.validate_vessel(raw(vid), vid)
        shipped.append(vid)
    except ValueError as x:
        shipped.append("REFUSED %s: %s" % (vid, x))
check("9. a hull whose low and high hold no whole knot (4.2-4.8), or whose low is 0, is refused in words; the four "
      "shipped hulls load",
      lambda: why and "whole knot" in why and why0 and "low > 0" in why0 and shipped == list(WANT),
      lambda: "%r / %r; shipped %s" % (why, why0, shipped))

# 10. THE WORDS: a whole knot reads "7 kn"; a named speed gives its name and its knots.
check("10. speed_txt: \"7\" reads \"7 kn\", `low` reads \"low (4.0 kn)\", an unknown key reads as itself",
      lambda: (A.speed_txt("7"), A.speed_txt("low"), A.speed_txt("warp")) == ("7 kn", "low (4.0 kn)", "warp"),
      lambda: str((A.speed_txt("7"), A.speed_txt("low"), A.speed_txt("warp"))))

print("\n%s (%d ran)" % ("%d CHECK(S) FAILED" % fails if fails else "all checks passed", ran))
sys.stdout.flush()
os._exit(1 if fails else 0)
