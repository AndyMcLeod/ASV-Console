"""tests/drix_gondolas.py - the DriX as either of her two gondolas (2026-10-09).

Andy: "Annotate DriX gondola as the 2040 gondola. The DriX gondolas are designed around the size of the sonar systems
installed. the Kongsberg EM2040 gondola was the original. There is also the EM712 gondola which is much larger ... create
2 separate vessel files, 1 with the 2040 gondola and one with the 712 gondola. Then apply each to behaviors and effects";
"DriX currently has the 712 mounted"; "my direct experience with drix and the 712 gondola places absolute top speed at
10 knots with ERPM at 3100".

WHAT EACH GONDOLA CHANGES, and where the numbers come from (each file's hull.gondola and *.source say it in full):
  * vessels/drix08.json - the EM2040 gondola (iXblue 920C12-1-DWG-002), the one in iXblue's general drawing and in every
    log measurement: draft 2.0 m, underwater 4.2 m^2, top 11.5 kn, the measured EM2040 fuel law, the measured coast and
    slow-down.
  * vessels/drix08_em712.json - the EM712 gondola (iXblue 922C01-DWG-002: 2246.7 x 555.8 x 1207.9 mm, 577 kg in air),
    FITTED NOW and the console's default: draft 2.25 m (the extra gondola depth below the same keel), underwater 4.5 m^2
    (the 0.73 m^2 silhouette for the EM2040's 0.47), top 10 kn at 3100 rpm (Andy), the 2024 EM712 fuel law, and coast and
    slow-down ESTIMATED from the EM2040's by mass over drag.

    python tests/drix_gondolas.py     # exit 0 = pass, 1 = fail   (in-process: no console, no network)
"""

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


spec = importlib.util.spec_from_file_location("console_for_drix_gondolas", os.path.join(APP, "asv_console.py"))
A = importlib.util.module_from_spec(spec)
spec.loader.exec_module(A)

print("The DriX as either of her two gondolas:")


def raw(vid):
    with open(os.path.join(APP, "vessels", vid + ".json"), encoding="utf-8") as f:
        return json.load(f)


E40, E712 = raw("drix08"), raw("drix08_em712")
H40, H712 = E40["hull"], E712["hull"]
G40, G712 = H40["gondola"], H712["gondola"]

# 1. TWO PROFILES, THE FITTED ONE THE DEFAULT. The console imports as the EM712; both validate; the names say which.
booted = A.VESSEL["id"]
both = [A.load_vessel(v)["id"] for v in ("drix08", "drix08_em712")]
listed = [v["id"] for v in A.list_vessels()]
check("1. two DriX profiles, one per gondola, both valid and both in the picker; the console comes up as the EM712 - "
      "the gondola fitted now - and each name says its gondola",
      lambda: A.DEFAULT_VESSEL_ID == "drix08_em712" and booted == "drix08_em712" and both == ["drix08", "drix08_em712"]
      and "drix08" in listed and "drix08_em712" in listed and "EM2040" in E40["name"] and "EM712" in E712["name"]
      and "EM2040" in G40["payload"] and "EM712" in G712["payload"],
      lambda: "default %s, booted %s, picker %s" % (A.DEFAULT_VESSEL_ID, booted, listed))

# 2. THE GEOMETRY FOLLOWS THE DRAWINGS. Same hull, keel, rudder: the underwater area differs by exactly the gondolas'
#    side areas, and the draft by exactly their depths below the same keel. The EM712 drawing's own dimensions.
d_area = H712["underwater_lateral_area_m2"] - H40["underwater_lateral_area_m2"]
d_draft = H712["draft_m"] - H40["draft_m"]
A.apply_vessel(A.load_vessel("drix08"))
floor40 = A.MIN_NAV_DEPTH_M
A.apply_vessel(A.load_vessel("drix08_em712"))
floor712, lat712 = A.MIN_NAV_DEPTH_M, A.HULL_A_LAT
check("2. the EM712 profile is the EM2040's with the gondola exchanged: underwater area up by the gondolas' side areas "
      "(0.73 - 0.47 m^2), draft down by their depths (0.556 - 0.31 m) below the same keel - so the depth floor is 3.15 m, "
      "not 2.9; the gondola's own size is the drawing's (2246.7 x 555.8 x 1207.9 mm, 577.41 kg in air)",
      lambda: abs(d_area - (G712["side_area_m2"] - G40["side_area_m2"])) < 0.06
      and abs(d_draft - (G712["depth_m"] - G40["depth_m"])) < 0.006
      and abs(floor712 - (H712["draft_m"] + E712["planning"]["under_keel_clearance_m"])) < 1e-9
      and abs(floor40 - 2.9) < 1e-9 and floor712 > floor40 and lat712 == H712["underwater_lateral_area_m2"]
      and (G712["length_m"], G712["depth_m"], G712["width_m"], G712["mass_in_air_kg"]) == (2.247, 0.556, 1.208, 577.4),
      lambda: "area +%.2f (gondolas +%.2f), draft +%.3f (gondolas +%.3f), floors %.2f / %.2f m" % (
          d_area, G712["side_area_m2"] - G40["side_area_m2"], d_draft, G712["depth_m"] - G40["depth_m"], floor40, floor712))

# 3. TOP SPEED. The EM712's is Andy's own: 10 kn at 3100 rpm. The EM2040's lies on its measured speed law inside the
#    law's measured range (Fuel planner, 16 MCAP sessions, 1280-3080 rpm). Neither is Exail's 14.
E40_SPEED = (-0.4379785211023674, 0.003909372453612787)                 # kt = b + m rpm
rpm40_top = (E40["propulsion"]["speeds_kn"]["high"] - E40_SPEED[0]) / E40_SPEED[1]
check("3. top speed: the EM712's 10 kn (at 3100 rpm, Andy's own figure) and the EM2040's 11.5 kn, which its measured speed "
      "law reaches at about 3054 rpm, inside the law's 1280-3080; neither is Exail's 14",
      lambda: E712["propulsion"]["speeds_kn"]["high"] == 10.0 and 1280 <= rpm40_top <= 3080
      and E40["propulsion"]["speeds_kn"]["high"] == 11.5,
      lambda: "EM712 %.1f kn; EM2040 %.1f kn at %.0f rpm" % (E712["propulsion"]["speeds_kn"]["high"],
                                                          E40["propulsion"]["speeds_kn"]["high"], rpm40_top))


# 4. FUEL. The console's burn - idle + (full - idle)(v / high)^exp, with each profile's constants as apply_vessel
#    publishes them - against the measured laws (Fuel planner model.json, copied here: outside the code under test).
def console_burn(vid, kt):
    A.apply_vessel(A.load_vessel(vid))
    frac = min(1.0, kt / A.SPEED_KN["high"])
    return A.FUEL_BURN_IDLE + (A.FUEL_BURN_FULL - A.FUEL_BURN_IDLE) * frac ** A.FUEL_BURN_EXP


def law40(kt):
    rpm = (kt - E40_SPEED[0]) / E40_SPEED[1]
    return 3.1134559606365335 - 0.002920141434656371 * rpm + 1.3960663180683033e-06 * rpm * rpm


def law712(kt):
    rpm = (kt - 1.1347810132138756) / 0.0026240783000814768
    return -1.7761355709825288 + 0.0024949428685311897 * rpm


err40 = max(abs(console_burn("drix08", kt) / law40(kt) - 1) for kt in (7, 8, 9, 10, 11))
err712_7 = abs(console_burn("drix08_em712", 7) / law712(7) - 1)
full712 = console_burn("drix08_em712", 10.0)
nm40 = 8.0 / console_burn("drix08", 8.0)
nm712 = 8.0 / console_burn("drix08_em712", 8.0)
check("4. fuel: the EM2040's burn within 3% of its measured law from 7 to 11 kn; the EM712's on its 2024 law at the 7-kn "
      "survey speed and, at 10 kn, the law's burn at 3100 rpm (5.96 L/h); and the EM712 goes about a quarter fewer miles a "
      "liter at 8 kn",
      lambda: err40 < 0.03 and err712_7 < 0.01 and abs(full712 - (-1.7761355709825288 + 0.0024949428685311897 * 3100)) < 0.01
      and 1.3 < nm40 / nm712 < 1.6,
      lambda: "EM2040 worst %.1f%%; EM712 at 7 kn %.1f%%, at 10 kn %.2f L/h; NM/L at 8 kn %.2f vs %.2f" % (
          err40 * 100, err712_7 * 100, full712, nm40, nm712))

# 5. COAST AND SLOW-DOWN. The EM2040's are measured from her logs; the EM712's are ESTIMATED from them (mass over drag),
#    say so, and run the way more drag runs: a shorter coast, a slower idle in gear, a shorter decay.
c40, c712 = E40["maneuvering"]["coast"], E712["maneuvering"]["coast"]
s40, s712 = E40["maneuvering"]["slowdown"], E712["maneuvering"]["slowdown"]
check("5. coast and slow-down: the EM2040's measured, the EM712's marked ESTIMATED (scaled by mass over drag) and shorter "
      "and slower - a coast from 6 to 2 kn under the EM2040's 40.3 m, an idle in gear under 3.65 kn, a decay under 23.8 m",
      lambda: c40["measured"] is True and s40["measured"] is True and c712["measured"] is False and s712["measured"] is False
      and "ESTIMATED" in c712["source"] and "ESTIMATED" in s712["source"]
      and c712["distance_m"] < c40["distance_m"] and s712["idle_kn"] < s40["idle_kn"] and s712["length_m"] < s40["length_m"]
      and s712["lag_s"] == s40["lag_s"],
      lambda: "coast %.1f / %.1f m, idle %.2f / %.2f kn, decay %.1f / %.1f m" % (
          c40["distance_m"], c712["distance_m"], s40["idle_kn"], s712["idle_kn"], s40["length_m"], s712["length_m"]))


# 6. ON THE HULL. Same wind areas, more water below: a stopped DriX's leeway in a steady beam wind is sqrt(4.2/4.5) of
#    the EM2040's under the EM712.
class _Wind:
    def field(self):
        return {"wind_from_deg": 270.0, "wind_speed_ms": 6.0, "gust_factor": 1.0,
                "wave_from_deg": 0.0, "hs_m": 0.0, "tp_s": 4.0}

    def is_enabled(self):
        return True


class _NoStream:
    def field_at(self, lat, lon, t=None):
        return None

    def set_ofs(self, ofs):                # apply_vessel -> apply_port points the current monitor at the port's model
        pass


class _Rho:
    def rho(self):
        return 1000.0


def leeway(vid):
    A.apply_vessel(A.load_vessel(vid))
    A.ENV, A.CURRENTS, A.DENSITY = _Wind(), _NoStream(), _Rho()
    v = A.SimVcu()
    v.lat, v.lon, v.heading = 38.78, -75.16, 0.0
    v._running, v._paused = True, True
    v.tick(0.25)
    return math.hypot(*v._drift_en)


A.GUST_VEER_DEG = 0.0
l40, l712 = leeway("drix08"), leeway("drix08_em712")
check("6. on the hull: under the EM712 a stopped DriX's beam-wind leeway is sqrt(4.2 / 4.5) of the EM2040's - the same wind "
      "areas pushing on more water below",
      lambda: H40["wind_area_side_m2"] == H712["wind_area_side_m2"]
      and abs(l712 / l40 - math.sqrt(H40["underwater_lateral_area_m2"] / H712["underwater_lateral_area_m2"])) < 1e-9,
      lambda: "EM2040 %.4f m/s, EM712 %.4f m/s, ratio %.4f (want %.4f)" % (
          l40, l712, l712 / l40, math.sqrt(H40["underwater_lateral_area_m2"] / H712["underwater_lateral_area_m2"])))

print("\n%s (%d ran)" % ("%d CHECK(S) FAILED" % fails if fails else "all checks passed", ran))
sys.stdout.flush()
os._exit(1 if fails else 0)
