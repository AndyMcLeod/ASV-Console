"""tests/wind_area.py - a hull's windage from MEASURED side and front areas (2026-10-09).

Andy: "slide 13: DriX H8 height above water is greater than 1m. Review drawings and correct", then "fix the DriX
windage height in the vessel file" (choosing separate side and front areas over one height).

WHAT WAS WRONG. A hull's wind areas were its length, and its beam, times ONE above-water height - an estimated 1.0 m
for the DriX H-8. The boat stands about 2.76 m above water to its mast tips, but the wind sees a low hull under a
narrow mast: measured from photographs (vessels/drix08.json, hull.wind_source) about 4.9 m^2 side-on and 1.8 m^2
end-on, where 7.71 m x 1.0 m gave the side 7.7 m^2 and 0.824 m x 1.0 m gave the front 0.82 m^2 - one half again too
big, the other under half.

WHAT IT IS NOW. hull.wind_area_side_m2 and hull.wind_area_front_m2 are optional in a vessel file: given, they are the
wind's areas; absent, the old rule stands (loa or beam x above_water_h_m), so the other hulls are unchanged.

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


# 1. THE SHIPPED FILES. The DriX's measured areas are what the wind sees; the hulls that give none keep length and
#    beam times their one height - computed here from their own files, not by the rule under test.
got = {}
for vid in ("drix08", "example_usv_4m", "zboat_1800hs"):
    A.apply_vessel(A.load_vessel(vid))
    got[vid] = (A.WIND_A_SIDE, A.WIND_A_FRONT)
want = {}
for vid in ("example_usv_4m", "zboat_1800hs"):
    h = raw(vid)["hull"]
    want[vid] = (h["loa_m"] * h["above_water_h_m"], h["beam_m"] * h["above_water_h_m"])
dh = raw("drix08")["hull"]
check("1. the DriX's measured areas are the wind's (4.9 m^2 side, 1.8 front - not 7.71 or 0.824 times one height); the "
      "hulls that give none keep length and beam times their height, unchanged",
      lambda: got["drix08"] == (4.9, 1.8) == (dh["wind_area_side_m2"], dh["wind_area_front_m2"])
      and all(abs(got[k][i] - want[k][i]) < 1e-12 for k in want for i in (0, 1))
      and "wind_area_side_m2" not in raw("example_usv_4m")["hull"] and "wind_area_side_m2" not in raw("zboat_1800hs")["hull"],
      lambda: "drix %s; example %s (want %s); small %s (want %s)" % (
          got["drix08"], got["example_usv_4m"], want["example_usv_4m"], got["zboat_1800hs"], want["zboat_1800hs"]))


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


bad = [(k, x) for k in ("wind_area_side_m2", "wind_area_front_m2") for x in (0, -1.0, "4.9", True, None)]
msgs = {(k, repr(x)): refused(k, x) for k, x in bad}
only_side = copy.deepcopy(raw("drix08"))
del only_side["hull"]["wind_area_front_m2"]
only_side["hull"]["wind_area_side_m2"] = 5
A.apply_vessel(A.validate_vessel(only_side, "drix08.json"))
os_side, os_front = A.WIND_A_SIDE, A.WIND_A_FRONT
check("2. a wind area that is zero, negative, text, a boolean or null is refused in words naming the field; an integer "
      "is taken, and one given alone leaves the other to beam (or length) times the height",
      lambda: all(m and ("hull.%s must be a number > 0" % k) in m for (k, _), m in msgs.items())
      and os_side == 5.0 and abs(os_front - dh["beam_m"] * dh["above_water_h_m"]) < 1e-12,
      lambda: "refusals %d/%d, e.g. %r; side alone -> %s / %s" % (
          sum(1 for m in msgs.values() if m), len(msgs), msgs[("wind_area_side_m2", "0")], os_side, os_front))


# 3. ON THE HULL. A stopped DriX in a steady 6 m/s wind (no gusts, no veer, no waves, no stream), first tick: her
#    leeway is the drag balance on the side area beam-on and on the front area head-on - worked out here from the
#    FILE's areas - so beam-on she drifts sqrt(4.9 / 1.8) = 1.65x faster than head-on (it was sqrt(7.71 / 0.824) = 3.06x).
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
lat_area = dh["loa_m"] * dh["draft_m"]                 # the hull's underwater lateral area, as the sim takes it
expect = lambda area: math.sqrt(A.RHO_AIR * dh["wind_cd"] * area * 36.0 / (1000.0 * dh["hull_cd"] * lat_area))
check("3. on the hull: a stopped DriX's leeway in a steady 6 m/s wind is the drag balance on the side area beam-on and "
      "the front area head-on, so beam-on she drifts sqrt(4.9/1.8) = 1.65x faster than head-on (it was 3.06x)",
      lambda: abs(beam_ms - expect(4.9)) < 1e-9 and abs(head_ms - expect(1.8)) < 1e-9
      and abs(beam_ms / head_ms - math.sqrt(4.9 / 1.8)) < 1e-9,
      lambda: "beam %.4f m/s (want %.4f), head %.4f (want %.4f), ratio %.3f" % (
          beam_ms, expect(4.9), head_ms, expect(1.8), beam_ms / head_ms))

print("\n%s (%d ran)" % ("%d CHECK(S) FAILED" % fails if fails else "all checks passed", ran))
sys.stdout.flush()
os._exit(1 if fails else 0)
