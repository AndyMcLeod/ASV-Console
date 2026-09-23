#!/usr/bin/env python3
"""tests/roc_tracks.py - Remote Operations Center / moving-HOME regression test.

The contract roc_tracks owes the console:

  * the ARRIVAL POINT is the ROC walked out along its offset, and a "relative"
    offset is measured from the ship's COURSE - get that wrong and a Mothership
    recovery aims at a fixed compass bearing instead of astern of the ship
  * only an ACTIVE ROC may be HOME (the staged/active lifecycle is a safety gate,
    not decoration)
  * a steaming ship's HOME actually MOVES, which is the whole point of the feature
  * NMEA is validated, not trusted - a corrupt sentence must be dropped, not fed,
    and dropping it must cost ONE SENTENCE rather than the whole GPS link
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

INGEST ROBUSTNESS (18-23), verified by mutation with the numbers each one produced:

    parse_nmea back to a bare float() on speed/course        -> 18, 19
    _nmea_float returning 0.0 instead of None on garbage     -> 19
    the _nmea_deg guard removed (position garbage raises)    -> 20
    gps_sim stops wrapping a negative course                 -> 22
    gps_sim latitude loses its minutes zero-pad              -> 23
    gps_sim longitude loses its degree width                 -> 22, 23

TWO LAYERS, AND THEY WERE EARNED SEPARATELY. Reverting the parser fix while LEAVING
the _emit guard in place fails 18 and 19 but check 21 still PASSES - the guard held
the link. Removing BOTH fails 18, 19 AND 21. So 18-20 guard the parser's contract
and 21 guards the blast radius, and neither test proves the other. Removing the
guard on its own survives, which is correct and worth knowing: with the parser
honouring its contract there is nothing left for it to catch.
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
    """`cond` may be a value or a thunk; a THROW is reported as a failed check rather than
    killing the run. Checks 18-20 below feed this parser deliberate rubbish, and the fault
    they guard IS an exception - a harness that dies on it cannot report it."""
    global fails
    try:
        ok = bool(cond() if callable(cond) else cond)
        note = detail() if callable(detail) else detail
    except Exception as e:
        ok, note = False, "THREW: %s" % e
    print(("  ok   " if ok else "  FAIL ") + name + ("   [" + note + "]" if note else ""))
    if not ok:
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

# --- 18-21. A MALFORMED SENTENCE MUST COST ONE SENTENCE, NOT THE LINK ------------- #
# THE FAULT: parse_nmea converted the speed and course fields with a bare float(), while the
# position fields right beside them went through _nmea_deg's guard - one function, two
# standards. A sentence whose CHECKSUM IS VALID can still carry rubbish (the checksum is an
# 8-bit XOR, so ~1 corruption in 256 passes it, and a flaky receiver can checksum an already
# mangled buffer). float("abc") then raised, the exception unwound GpsFeed's read loop, closed
# the socket, and was swallowed by run()'s catch-all - so the LINK DROPPED and reconnected 3 s
# later. Measured before the fix: 2 TCP connections and 6 of 8 fixes; after: 1 and all of them.


def nmea(body):
    """Wrap a body with a VALID checksum - the point is that the sentence is well-formed."""
    c = 0
    for ch in body:
        c ^= ord(ch)
    return "$%s*%02X" % (body, c)


POISON = nmea("GPRMC,123519,A,4807.038,N,01131.000,E,abc,def,230394,,")
check("18. THE FAULT: a checksum-VALID sentence with a garbage speed/course does not raise",
      lambda: R.parse_nmea(POISON) is not None,
      lambda: "-> %s" % R.parse_nmea(POISON))

check("19. ... the POSITION is still used, with speed and course dropped to None",
      lambda: (lambda r: abs(r["lat"] - 48.1173) < 1e-4 and r["cog"] is None and r["sog"] is None)
      (R.parse_nmea(POISON)),
      "a bad speed field is no reason to discard a good fix")

# A spread of rubbish, because one guarded field is not a guarded parser. Every one of these
# must come back None or a dict - never an exception.
GARBAGE = [
    "", " ", "\n", "$", "*", "$*", "$*ZZ", "notasentence", "\x00\x01\x02",
    "$GPRMC", "$GPRMC*00", nmea("GPRMC"), nmea("GPRMC,,,,,,,,"),
    nmea("GPRMC,1,A,4807.038,N,01131.000,E,1e999,0,230394,,"),      # overflow
    nmea("GPRMC,1,A,4807.038,N,01131.000,E,nan,inf,230394,,"),      # non-finite
    nmea("GPRMC,1,A,NOTANUM,N,01131.000,E,0,0,230394,,"),
    nmea("GPRMC,1,A,4807.038,X,01131.000,Y,0,0,230394,,"),          # bogus hemispheres
    nmea("GPGGA,1,NOTANUM,N,01131.000,E,1,08"),
    nmea("GPGGA,1,4807.038,N,01131.000,E,abc,08"),
    nmea("XXRMC,1,A,4807.038,N,01131.000,E,0,0,1,,"),               # unknown talker
    nmea("GPRMC," + "9" * 5000 + ",A,4807.038,N,01131.000,E,0,0,1,,"),
    "$GPRMC,1,A,4807.038,N,01131.000,E,0,0,1,,*",                   # empty checksum
    "$GPRMC,1,A,4807.038,N,01131.000,E,0,0,1,,*Z",                  # 1-char checksum
]
raised = []
for g in GARBAGE:
    try:
        R.parse_nmea(g)
    except Exception as e:
        raised.append("%r -> %s" % (g[:28], type(e).__name__))
check("20. ... and NOTHING in a garbage corpus raises — the parser returns None or a fix",
      lambda: not raised,
      lambda: (" | ".join(raised[:3])) if raised else "%d malformed inputs" % len(GARBAGE))

# THE BLAST RADIUS, end to end. A parse fault is only interesting because of what it costs:
# the whole TCP connection. One poisoned line in a good stream must not reconnect the feed.
import socket                                                       # noqa: E402
import threading                                                    # noqa: E402

GOOD = nmea("GPRMC,123519,A,4807.038,N,01131.000,E,12.4,84.4,230394,,") + "\r\n"
srv = socket.socket()
srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
srv.bind(("127.0.0.1", 0))
srv.listen(1)
feed_port = srv.getsockname()[1]
connections = []


class _CountingTracker:
    def __init__(self):
        self.fixes = []

    def feed(self, *a, **k):
        self.fixes.append(k)


def _serve():
    while True:
        try:
            c, _ = srv.accept()
        except OSError:
            return
        connections.append(1)
        try:
            for _ in range(3):
                c.sendall(GOOD.encode())
                time.sleep(0.12)
            c.sendall((POISON + "\r\n").encode())        # the one bad line
            time.sleep(0.12)
            for _ in range(4):
                c.sendall(GOOD.encode())
                time.sleep(0.12)
        except OSError:
            pass


threading.Thread(target=_serve, daemon=True).start()
_trk = _CountingTracker()
_feed = R.GpsFeed(_trk, "roc-poison", "127.0.0.1", feed_port)
_feed.start()
time.sleep(3.0)
_feed.stop()
srv.close()
check("21. THE BLAST RADIUS: one bad line costs one line, NOT the whole connection",
      len(connections) == 1 and len(_trk.fixes) >= 7,
      "%d TCP connection(s), %d fixes — a drop would reconnect and lose the gap"
      % (len(connections), len(_trk.fixes)))

# --- 22. gps_sim emits what roc_tracks reads -------------------------------------- #
# The two halves of the same link live in different files: gps_sim builds the sentences and
# parse_nmea consumes them. Nothing else checks they agree, so a formatting change in one
# could silently stop feeding the other. Includes the awkward cases - poles, dateline, a
# NEGATIVE course that must wrap, and a latitude whose minutes round up to 60.
import gps_sim                                                      # noqa: E402

ROUND_TRIP = [
    (38.78965, -75.16094, 84.4, 12.4), (0.0, 0.0, 0.0, 0.0),
    (89.9999, 179.9999, 359.9, 40.0), (-89.9999, -179.9999, 0.1, 0.1),
    (47.99999999, 11.5, 45.0, 5.0), (-33.8688, 151.2093, 270.0, 22.5),
    (42.137083, -80.087367, -45.0, 3.0),
]
worst = 0.0
rt_bad = []
for lat, lon, cog, sog in ROUND_TRIP:
    rmc = gps_sim.build_sentences(lat, lon, cog, sog).split("\r\n")[0]
    got = R.parse_nmea(rmc)
    if not got:
        rt_bad.append("(%.4f,%.4f) did not parse" % (lat, lon))
        continue
    err = max(abs(got["lat"] - lat), abs(got["lon"] - lon)) * 111320.0
    worst = max(worst, err)
    if err > 0.2 or abs(got["cog"] - (cog % 360.0)) > 0.06 or abs(got["sog"] - sog) > 0.06:
        rt_bad.append("(%.4f,%.4f) off by %.3f m" % (lat, lon, err))
check("22. a gps_sim fix round-trips through parse_nmea, poles and dateline included",
      lambda: not rt_bad,
      lambda: (" | ".join(rt_bad)) if rt_bad
      else "%d positions, worst error %.3f m (negative course wraps)" % (len(ROUND_TRIP), worst))

# 23. NMEA is a FIXED-WIDTH format, and the round-trip above cannot see that. parse_nmea
# splits latitude at offset 2 and longitude at offset 3, so a field that lost its zero
# padding still parses correctly HERE while being malformed for every other consumer -
# measured: dropping the %07.4f width survived checks 18-22 untouched. gps_sim exists to
# stand in for a real GPS, so its output has to be valid on the wire, not merely readable
# by its sibling.
import re as _re                                                    # noqa: E402

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


WIDTHS = []
for lat, lon, cog, sog in [(38.78965, -75.16094, 84.4, 12.4),
                           (5.5 / 60.0, 7.25 / 60.0, 0.0, 0.0),     # minutes < 10: needs the pad
                           (0.0, 0.0, 0.0, 0.0)]:
    f = gps_sim.build_sentences(lat, lon, cog, sog).split("\r\n")[0].split(",")
    if not _re.fullmatch(r"\d{4}\.\d{4}", f[3]):
        WIDTHS.append("lat field %r" % f[3])
    if not _re.fullmatch(r"\d{5}\.\d{4}", f[5]):
        WIDTHS.append("lon field %r" % f[5])
check("23. the emitted fields keep NMEA's fixed widths (ddmm.mmmm / dddmm.mmmm)",
      lambda: not WIDTHS,
      lambda: (" | ".join(WIDTHS)) if WIDTHS
      else "zero-padded even when minutes < 10, which the round-trip cannot detect")

# ── 23b. ...AND THE INTENT HAS TO CARRY IT IN THE FIRST PLACE ─────────────────────────
# The console half below is worth nothing if `home_intent` never ships the fields. Driven
# against THIS repo's copy of the module, not the core's: the two are the same body today
# and this is what notices if that stops being true.
_t = R.RocTracker(config_path=os.devnull)
_hid = _t.add("ship", "Mothership")
_t.feed(_hid, 43.07, -70.71, cog=90.0, sog=4.0, source="gps")
_t.confirm(_hid)
_t.select_home(_hid)
_live = _t.home_intent()
with _t._lock:
    _t._rocs[_hid].updated_at -= (R.LOST_S + 5.0)
_dead = _t.home_intent()
check("23b. home_intent carries the LINK STATE and the age of its evidence, not just the card",
      lambda: _live.get("link") == "ok" and _live.get("age_s") is not None
      and _dead.get("link") == "lost" and (_dead.get("age_s") or 0) >= R.LOST_S,
      lambda: "live link=%s age=%s / %.0f s later link=%s age=%s"
              % (_live.get("link"), _live.get("age_s"), R.LOST_S + 5.0,
                 _dead.get("link"), _dead.get("age_s")))
check("23c. ... and the POINT and the MOVING tag are deliberately unchanged by it",
      lambda: _dead["point"] == _live["point"] and _dead["moving"] is True,
      "a steaming ship with a dead link is still steaming - what was missing is the age "
      "of the evidence, not the claim about the ship")

# ── 24-27. THE LINK STATE HAS TO REACH THE ENGINE, NOT JUST THE CARD ──────────────────
#
# Nothing in roc_tracks clears a ROC when its NMEA feed stops: GpsFeed.run swallows the
# error and retries every 3 s for ever, so `lat`/`lon` keep their last value, is_moving()
# stays true on `gps_attached`, and arrival_point() keeps answering. link_state() works and
# to_dict ships it, so the operator's CARD went red - while `home_intent`, the ONE thing
# the Engine pulls every tick (`set_home_provider(ROC.home_intent)`), was byte-identical to
# a live link. Measured: 20 s dead, the same point, `moving` still true, and the RTH note
# still reading "chasing Mothership (MOVING)" about a ship 40 m from where it said and
# drifting 123 m/min. The chase loop cannot rescue it either - it re-targets only when the
# point MOVES, and a frozen point never does, so it falls silent at exactly the moment it
# stops meaning anything.
#
# ⚠ THE SHIPPED BRANCH IS READ, NOT RE-IMPLEMENTED. `_rth_note` below is what the console
# should produce and is used for the wording half; the source greps beside it pin that the
# console's own branch is that one. A suite running only its own copy of the logic would
# stay green with the console's copy deleted.
_APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
_SRC = open(os.path.join(_APP, "asv_console.py"), encoding="utf-8").read()
_RTH = _SRC[_SRC.index('chase = ""'):_SRC.index('note = "Return-to-Home:')]
_CHASE = _SRC[_SRC.index("elif self._rth_follow and intent"):
              _SRC.index("tgt = intent[" + chr(34) + "point" + chr(34) + "]")]

_INTENT = {"roc_id": "ship-1", "name": "Mothership", "kind": "ship", "moving": True,
           "link": "ok", "age_s": 0.0, "closing_kn": 4.5, "closable": True,
           "point": {"lat": 38.79, "lon": -75.16}}


def _rth_note(link, age):
    intent = dict(_INTENT, link=link, age_s=age)
    chase = ""
    if intent["moving"]:
        chase = " (MOVING)" if intent.get("closable", True) else ""
        if intent.get("link") == "lost":
            chase += (" - WARNING: the ROC's GPS LINK IS LOST (%s s old), so this is "
                      "where she WAS, not where she is" % intent.get("age_s"))
    return "Return-to-Home: %s %s%s," % ("chasing" if intent["moving"] else "returning to",
                                         intent["name"] or "the ROC", chase)


check("24. the RTH note qualifies a moving home whose GPS LINK IS LOST",
      lambda: 'intent.get("link") == "lost"' in _RTH
      and "GPS LINK IS LOST" in _RTH and "where she WAS" in _RTH,
      lambda: "the branch reads: " + " ".join(_RTH.split())[-130:])
check("25. ... and says nothing extra while the link is good - a warning on every RTH is "
      "a warning nobody reads",
      lambda: "LINK IS LOST" not in _rth_note("ok", 0.4)
      and "LINK IS LOST" in _rth_note("lost", 20.0)
      and "20.0 s old" in _rth_note("lost", 20.0),
      lambda: 'live: "%s" | dead: "%s"' % (_rth_note("ok", 0.4)[-30:],
                                           _rth_note("lost", 20.0)[-72:]))

# 26-27. THE CHASE LOOP. The link can die AFTER the note was written, and a frozen point
# never trips the `moved` test that re-targets, so the command-time warning is not enough.
check("26. the CHASE says it too, once per outage rather than once a tick",
      lambda: 'intent.get("link") == "lost"' in _CHASE
      and "if not self._rth_lost_link" in _CHASE
      and "self._rth_lost_link = True" in _CHASE
      and "self._rth_lost_link = False" in _CHASE,
      lambda: "a link that reconnects every 3 s would otherwise fill the operator's log, "
              "and the latch has to CLEAR when the link comes back or it says it once ever")
check("27. ... and it QUALIFIES rather than refusing - the chase is not stopped and no "
      "command is withheld",
      lambda: "raise" not in _CHASE and "self._rth_follow = False" not in _CHASE
      and "self.note" in _CHASE,
      lambda: "a refusal here would take away the operator's only recovery action over a "
              "16-second dropout on a link that reconnects every 3 s")

print("\n" + ("%d CHECK(S) FAILED" % fails if fails else "all checks passed"))
sys.exit(1 if fails else 0)
