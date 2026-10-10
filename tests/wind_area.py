"""tests/wind_area.py - a hull's windage and underwater area from MEASURED areas (2026-10-09).

Andy: "slide 13: DriX H8 height above water is greater than 1m. Review drawings and correct", then "fix the DriX
windage height in the vessel file" (choosing separate side and front areas over one height), then "fix the DriX
underwater lateral area".

WHAT WAS WRONG. A hull's wind areas were its length, and its beam, times ONE above-water height - an estimated 1.0 m
for the DriX H-8 - and its underwater lateral area, the leeway drag's, its length times its draft: 7.71 x 2.0 =
15.4 m^2, a full-length plate as deep as the gondola's bottom. Off iXblue's own dimensioned starboard view (in Andy's
DriX training notes; vessels/drix08.json hull.wind_source and hull.underwater_source) the wind sees 6.5 m^2 side-on
(with the H-8's additions) and 1.8 end-on, and the water 4.2 m^2 below the design waterline: the 2.0 m draft is a
gondola on a slender drop keel. So every DriX leeway ran about 1.9x too slow.

WHAT IT IS NOW. hull.wind_area_side_m2, hull.wind_area_front_m2 and hull.underwater_lateral_area_m2 are optional in a
vessel file: given, they are the areas; absent, the old rules stand (loa or beam x above_water_h_m; loa x draft_m), so
the other hulls are unchanged.

    python tests/wind_area.py     # exit 0 = pass, 1 = fail   (in-process: no console, no network)
"""

import copy
import importlib.util
import json
import math
import os
import sys

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


# Import the console WITHOUT starting anything (nothing runs on import by design).
spec = importlib.util.spec_from_file_location("console_for_wind_area", os.path.join(APP, "asv_console.py"))
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)

print("A hull's windage from its measured side and front areas:")


def raw(vid):
    with open(os.path.join(APP, "vessels", vid + ".json"), encoding="utf-8") as f:
        return json.load(f)


# 1. THE SHIPPED FILES. The DriX's and BEN's measured areas are what the wind sees; the hull that gives none keeps
#    length and beam times its one height - computed here from its own file, not by the rule under test.
#    BEN's are off ASV Global's GA (2026-10-10, vessels/ben_cworker4.json hull.wind_source): 3.46 m^2 side, 1.7 front
#    (estimated - no front view), 1.39 underwater, where 4.21 x 0.82 and 4.21 x 0.66 would have said 3.45 and 2.78.
got = {}
for vid in ("drix08", "ben_cworker4", "zboat_1800hs"):
    A.apply_vessel(A.load_vessel(vid))
    got[vid] = (A.WIND_A_SIDE, A.WIND_A_FRONT, A.HULL_A_LAT)
want = {}
for vid in ("zboat_1800hs",):
    h = raw(vid)["hull"]
    want[vid] = (h["loa_m"] * h["above_water_h_m"], h["beam_m"] * h["above_water_h_m"], h["loa_m"] * h["draft_m"])
dh, bh = raw("drix08")["hull"], raw("ben_cworker4")["hull"]
check("1. the DriX's and BEN's measured areas are the sim's (DriX wind 6.5 m^2 side, 1.8 front, water 4.2 - not "
      "7.71 x 2.0 = 15.4; BEN 3.46 / 1.7 / 1.39 - not 4.21 x 0.66 = 2.78); the hull that gives none keeps the old rules",
      lambda: got["drix08"] == (6.5, 1.8, 4.2)
      == (dh["wind_area_side_m2"], dh["wind_area_front_m2"], dh["underwater_lateral_area_m2"])
      and got["ben_cworker4"] == (3.46, 1.7, 1.39)
      == (bh["wind_area_side_m2"], bh["wind_area_front_m2"], bh["underwater_lateral_area_m2"])
      and all(abs(got[k][i] - want[k][i]) < 1e-12 for k in want for i in (0, 1, 2))
      and not any(key in raw("zboat_1800hs")["hull"]
                  for key in ("wind_area_side_m2", "wind_area_front_m2", "underwater_lateral_area_m2")),
      lambda: "drix %s; ben %s; small %s (want %s)" % (
          got["drix08"], got["ben_cworker4"], got["zboat_1800hs"], want["zboat_1800hs"]))


# 2. THE FILE IS CHECKED. An area that is not a positive number is refused in words, naming the field; one area alone
#    is fine, the other then following the old rule.
def refused(key, val):
    v = copy.deepcopy(raw("drix08"))
    v["hull"][key] = val
    try:
        A.validate_vessel(v, "drix08.json")
        return None
    except ValueError as e:
        return str(e)


bad = [(k, x) for k in ("wind_area_side_m2", "wind_area_front_m2", "underwater_lateral_area_m2")
       for x in (0, -1.0, "4.9", True, None)]
msgs = {(k, repr(x)): refused(k, x) for k, x in bad}
only_side = copy.deepcopy(raw("drix08"))
del only_side["hull"]["wind_area_front_m2"]
del only_side["hull"]["underwater_lateral_area_m2"]
only_side["hull"]["wind_area_side_m2"] = 5
A.apply_vessel(A.validate_vessel(only_side, "drix08.json"))
os_side, os_front, os_lat = A.WIND_A_SIDE, A.WIND_A_FRONT, A.HULL_A_LAT
check("2. an area that is zero, negative, text, a boolean or null is refused in words naming the field; an integer is "
      "taken, and one given alone leaves the others to their old rules (beam x height, length x draft)",
      lambda: all(m and ("hull.%s must be a number > 0" % k) in m for (k, _), m in msgs.items())
      and os_side == 5.0 and abs(os_front - dh["beam_m"] * dh["above_water_h_m"]) < 1e-12
      and abs(os_lat - dh["loa_m"] * dh["draft_m"]) < 1e-12,
      lambda: "refusals %d/%d, e.g. %r; side alone -> %s / %s" % (
          sum(1 for m in msgs.values() if m), len(msgs), msgs[("wind_area_side_m2", "0")], os_side, os_front))


# 3. ON THE HULL. A stopped DriX in a steady 6 m/s wind (no gusts, no veer, no waves, no stream), first tick: her
#    leeway is the drag balance of the wind on the side area beam-on, or the front area head-on, against the water on
#    the underwater area - all three worked out here from the FILE - so beam-on she drifts sqrt(6.5 / 1.8) = 1.90x
#    faster than head-on (it was sqrt(7.71 / 0.824) = 3.06x), and both sqrt(15.4 / 4.2) = 1.9x faster than length x
#    draft would make them.
class _Wind:
    def __init__(self, frm):
        self.frm = frm

    def field(self):
        return {"wind_from_deg": self.frm, "wind_speed_ms": 6.0, "gust_factor": 1.0,
                "wave_from_deg": 0.0, "hs_m": 0.0, "tp_s": 4.0}

    def is_enabled(self):
        return True


class _NoStream:
    def field_at(self, lat, lon, t=None):
        return None


class _Rho:
    def rho(self):
        return 1000.0


def leeway(frm):
    A.ENV, A.CURRENTS, A.DENSITY = _Wind(frm), _NoStream(), _Rho()
    v = A.SimVcu()
    v.lat, v.lon, v.heading = 38.78, -75.16, 0.0
    v._running, v._paused = True, True
    v.tick(0.25)
    return math.hypot(*v._drift_en)


A.apply_vessel(A.load_vessel("drix08"))
A.GUST_VEER_DEG = 0.0                                  # the sim's own slow veer would swing the angle off beam
beam_ms, head_ms = leeway(270.0), leeway(0.0)
lat_area = dh["underwater_lateral_area_m2"]            # the hull's underwater lateral area, from the file
expect = lambda area, lat=lat_area: math.sqrt(A.RHO_AIR * dh["wind_cd"] * area * 36.0 / (1000.0 * dh["hull_cd"] * lat))
plate = dh["loa_m"] * dh["draft_m"]
check("3. on the hull: a stopped DriX's leeway in a steady 6 m/s wind is the drag balance of the side area beam-on, or "
      "the front head-on, against the 4.2 m^2 underwater - beam-on 1.90x faster than head-on (it was 3.06x), and "
      "sqrt(15.4/4.2) = 1.9x faster than a length-by-draft plate would let her",
      lambda: abs(beam_ms - expect(6.5)) < 1e-9 and abs(head_ms - expect(1.8)) < 1e-9
      and abs(beam_ms / head_ms - math.sqrt(6.5 / 1.8)) < 1e-9
      and abs(beam_ms / expect(6.5, plate) - math.sqrt(plate / 4.2)) < 1e-9,
      lambda: "beam %.4f m/s (want %.4f), head %.4f (want %.4f), ratio %.3f; vs the plate %.2fx" % (
          beam_ms, expect(6.5), head_ms, expect(1.8), beam_ms / head_ms, beam_ms / expect(6.5, plate)))

print("\n%s (%d ran)" % ("%d CHECK(S) FAILED" % fails if fails else "all checks passed", ran))
sys.stdout.flush()
os._exit(1 if fails else 0)
