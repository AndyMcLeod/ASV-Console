#!/usr/bin/env python3
"""tests/roc_tracks.py - Remote Operations Center / moving-HOME regression test.

The contract roc_tracks owes the console:

  * the ARRIVAL POINT is the ROC walked out along its offset, and a "relative"
    offset is measured from the ship's COURSE - get that wrong and a Mothership
    recovery aims at a fixed compass bearing instead of astern of the ship
  * only an ACTIVE ROC may be HOME (the staged/active lifecycle is a safety gate,
    not decoration)
  * a steaming ship's HOME actually MOVES, which is the whole point of the feature
  * NMEA is validated, not trusted - a corrupt sentence must be dropped, not fed
  * every vessel-dependent default is DERIVED FROM THE ACTIVE VESSEL, and re-derived
    on a live vessel switch

That last clause is this console's architectural rule, and the reason this module
diverges from the sibling it was ported from: the sibling hardcodes a 50 m astern
recovery standoff, which is absurdly far for a 2 m boat and short for a 20 m one.
It also can't tell you that a 6 kn boat will never overhaul a 5.8 kn mothership.

  python tests/roc_tracks.py      # exit 0 = pass, 1 = fail   (stdlib only)

TEETH: drop the "relative" branch in Roc._abs_bearing and check 4 fails. Let a
staged ROC be selected HOME and check 6 fails. Hardcode SHIP_RECOVERY_M and checks
9-11 fail. Skip configure_vessel in a vessel switch and check 11 fails. Stop
verifying the NMEA checksum and check 13 fails.
"""

import math
import os
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import roc_tracks as R                                            # noqa: E402

M_PER_DEG_LAT = 111320.0

# --- assertions ------------------------------------------------------------ #
fails = 0


def check(name, cond, detail=""):
    global fails
    print(("  ok   " if cond else "  FAIL ") + name + ("   [" + detail + "]" if detail else ""))
    if not cond:
        fails += 1


def rng_brg(a, b):
    """Range (m) + true bearing (deg) from a=(lat,lon) to b=(lat,lon), flat-earth."""
    dn = (b[0] - a[0]) * M_PER_DEG_LAT
    de = (b[1] - a[1]) * M_PER_DEG_LAT * math.cos(math.radians(a[0]))
    return math.hypot(dn, de), (math.degrees(math.atan2(de, dn)) + 360) % 360


def near(x, y, tol):
    return abs(x - y) <= tol


def angnear(x, y, tol):
    return abs(((x - y + 540) % 360) - 180) <= tol


# Vessels this console ships, at the values in vessels/*.json. The point is the SPREAD:
# a 1.9 m 6 kn boat and a 7.71 m 14 kn one must not get the same ROC behaviour.
SMALL = {"hull": {"loa_m": 1.90}, "propulsion": {"speeds_kn": {"high": 6.0}}}
BIG = {"hull": {"loa_m": 7.71}, "propulsion": {"speeds_kn": {"high": 14.0}}}
OVERRIDE = {"hull": {"loa_m": 7.71}, "propulsion": {"speeds_kn": {"high": 14.0}},
            "planning": {"roc": {"ship_recovery_m": 120.0}}}

print("ROC tracking + moving HOME — arrival geometry, lifecycle, and vessel-derived defaults:")

# 1-3. SHORE ROC: the arrival point is the ramp, offset from the antenna on a TRUE
# bearing. "The ramp is 40 m at 210 deg from the antenna" must land exactly there.
R.configure_vessel(BIG)
shore = R.Roc("shore-1", "Harbour", "shore", lat=38.79, lon=-75.16)
check("1. a fresh shore ROC is STAGED and its offset is zero (ROC == arrival)",
      shore.status == "staged" and shore.range_m == 0.0,
      "status=%s range=%.1f" % (shore.status, shore.range_m))
check("2. zero offset -> the arrival point IS the ROC position",
      shore.arrival_point() == (38.79, -75.16))
shore.set_offset(range_m=40.0, bearing_deg=210.0, ref="true")
rng, brg = rng_brg((38.79, -75.16), shore.arrival_point())
check("3. shore offset walks out on a TRUE bearing (40 m @ 210)",
      near(rng, 40.0, 0.5) and angnear(brg, 210.0, 0.5),
      "got %.1f m @ %.1f deg" % (rng, brg))

# 4-5. SHIP ROC: the offset is RELATIVE to the ship's course. 50 m astern of a ship
# steaming 090 is 50 m to the WEST (270 true) - not 50 m south.
ship = R.Roc("ship-1", "Mothership", "ship", lat=38.79, lon=-75.16)
ship.set_offset(range_m=50.0, bearing_deg=180.0, ref="relative")
ship.set_motion(heading=90.0, speed_kn=5.0)
ship.confirm()
rng, brg = rng_brg((38.79, -75.16), ship.arrival_point())
check("4. a RELATIVE offset is measured from the ship's course (astern of 090 = 270 true)",
      near(rng, 50.0, 0.5) and angnear(brg, 270.0, 0.5),
      "got %.1f m @ %.1f deg" % (rng, brg))
ship.set_motion(heading=0.0)
_, brg2 = rng_brg((38.79, -75.16), ship.arrival_point())
check("5. ... and it follows the ship round (astern of 000 = 180 true)",
      angnear(brg2, 180.0, 0.5), "got %.1f deg" % brg2)

# 6-8. LIFECYCLE. Staging is a gate: an unconfirmed ROC is not a usable recovery point.
trk = R.RocTracker(config_path=os.devnull)
sid = trk.add("ship", "MV Test", lat=38.79, lon=-75.16)
check("6. a STAGED ROC cannot be selected HOME", trk.select_home(sid) is False)
trk.confirm(sid)
check("7. ... and an ACTIVE one can", trk.select_home(sid) is True)
trk.set_motion(sid, heading=90.0, speed_kn=5.0)
check("8. a confirmed ship is STEAMING (dead-reckoned) and its HOME is MOVING",
      trk._rocs[sid].steaming() and (trk.active_home() or {}).get("moving") is True)

# 9-11. VESSEL-DERIVED DEFAULTS - the reason this diverges from the sibling.
R.configure_vessel(SMALL)
small_off = R.ship_offset()["range_m"]
R.configure_vessel(BIG)
big_off = R.ship_offset()["range_m"]
check("9. the astern-recovery standoff SCALES with the hull, it is not a constant",
      near(small_off, 20.0, 0.1) and near(big_off, 46.26, 0.1) and big_off > small_off * 2,
      "1.9 m boat -> %.1f m, 7.71 m boat -> %.1f m" % (small_off, big_off))
R.configure_vessel(OVERRIDE)
check("10. a vessel file may override it outright (planning.roc.ship_recovery_m)",
      near(R.ship_offset()["range_m"], 120.0, 0.01),
      "got %.1f m" % R.ship_offset()["range_m"])

# The live-switch trap: a derived constant read once at import goes stale the moment
# the operator picks another vessel. apply_vessel() must re-run configure_vessel().
R.configure_vessel(BIG)
fast = R.Roc("s", "x", "ship", lat=0, lon=0)
fast.set_motion(heading=0, speed_kn=5.0)
fast.confirm()
big_closing = fast.closing_kn()
R.configure_vessel(SMALL)
small_closing = fast.closing_kn()
check("11. the closing check re-derives on a VESSEL SWITCH (same ship, different boat)",
      near(big_closing, 9.0, 0.01) and near(small_closing, 1.0, 0.01),
      "5 kn ship: 14 kn boat closes %.1f kn, 6 kn boat closes %.1f kn" % (big_closing, small_closing))

# 12. The closing check is what stops a plan that can never end.
fast.set_motion(speed_kn=5.8)
check("12. a ship the boat cannot overhaul is NOT closable",
      fast.closable() is False and fast.closing_kn() < R.CLOSE_MARGIN_KN,
      "6 kn boat vs 5.8 kn ship -> closing %.2f kn" % fast.closing_kn())

# 13-15. NMEA INGEST. A real GPS feed is untrusted input: verify, don't assume.
# Canonical NMEA-0183 example sentence, with its real XOR checksum - computed, not
# copied, so check 14 (corrupt rejected) is a real test rather than a sentence that
# was already invalid.
good = "$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A"
rep = R.parse_nmea(good)
check("13. a valid RMC parses to position + course + speed",
      rep and near(rep["lat"], 48.1173, 1e-3) and near(rep["lon"], 11.5167, 1e-3)
      and near(rep["sog"], 22.4, 0.01) and near(rep["cog"], 84.4, 0.01),
      str(rep))
check("14. a CORRUPT checksum is rejected, not fed to the ROC",
      R.parse_nmea(good[:-2] + "00") is None)
check("15. an RMC with a void fix (status V) is rejected",
      R.parse_nmea("$GPRMC,123519,V,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*7D") is None)

# 16. Telemetry ageing: a live-fed ROC goes stale then lost; a manually placed one
# does not - a fixed antenna that was never "fed" is not a dead link.
fed = R.Roc("f", "fed", "shore", lat=1.0, lon=1.0)
fed.feed(1.0, 1.0, source="gps")
t0 = fed.updated_at
check("16. link ages ok -> stale -> lost, but a manual/static ROC stays ok",
      fed.link_state(t0 + 1) == "ok" and fed.link_state(t0 + R.FRESH_S + 1) == "stale"
      and fed.link_state(t0 + R.LOST_S + 1) == "lost"
      and R.Roc("m", "manual", "shore", lat=1.0, lon=1.0).link_state() == "ok",
      "%s/%s/%s" % (fed.link_state(t0 + 1), fed.link_state(t0 + R.FRESH_S + 1),
                    fed.link_state(t0 + R.LOST_S + 1)))

# 17. The sim loop actually advances a steaming ship (end-to-end, no hardware).
R.configure_vessel(BIG)
trk2 = R.RocTracker(config_path=os.devnull)
s2 = trk2.add("ship", "Steamer", lat=38.79, lon=-75.16)
trk2.confirm(s2)
trk2.set_motion(s2, heading=90.0, speed_kn=10.0)
before = trk2.active_home() or {}
trk2.select_home(s2)
before = trk2.active_home()
trk2.start_sim(period_s=0.2)
time.sleep(1.2)
trk2.stop()
after = trk2.active_home()
moved, brg = rng_brg((before["lat"], before["lon"]), (after["lat"], after["lon"]))
check("17. the sim steams an active ship and HOME moves with it",
      moved > 1.0 and angnear(brg, 90.0, 5.0),
      "HOME moved %.1f m on %.0f deg in ~1 s at 10 kn" % (moved, brg))

print("\n" + ("%d CHECK(S) FAILED" % fails if fails else "all checks passed"))
sys.exit(1 if fails else 0)
