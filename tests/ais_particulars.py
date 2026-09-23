"""tests/ais_particulars.py - the vessel particulars AIS was already broadcasting.

Andy, 2026-09-02: *"add to the AIS capture data the type of vessel, length, width,
tonnage. Add destination."*

⚠ FOUR OF THOSE FIVE NEEDED NO EXTRA SOURCE AT ALL. AIS message 5 (Class A static and
voyage), message 24 part B (Class B static) and message 19 (Class B extended) carry the
hull DIMENSIONS and the ship TYPE; message 5 also carries DESTINATION, draught, IMO number
and call sign. Both of this service's decoders - the aisstream JSON handler and the NMEA
AIVDM bit-decoder - were reading `name` and `type` out of those messages and discarding
every other field, and the aisstream subscription had been asking for ShipStaticData since
the day it was written. The data was arriving, being parsed, and thrown away.

⚠ TONNAGE IS THE EXCEPTION AND IT IS NOT A GAP IN THIS CODE. No AIS message carries gross
or deadweight tonnage - it is a REGISTRY fact, not a broadcast one. `Registry.STATIC_KEYS`
lists `gt`/`dwt`/`built` so a particulars lookup can fill them, and they simply stay absent
until one is configured. Check 7 pins that they are carried when present rather than
dropped at the serialiser, which is the failure that would otherwise wait for whoever
wires that lookup up.

    python tests/ais_particulars.py     # exit 0 = pass, 1 = fail   (stdlib only)

⚠⚠ CHECK 6 IS THE ONE THAT MATTERS MOST AND IT GUARDS A WHITELIST. `Registry.snapshot()`
builds the served record field by field, so a particular can be decoded correctly, merged
correctly and held correctly - and still never reach the console, because the serialiser
never mentioned it. Every decoder test passes and the card shows nothing. That exact shape
has already cost this repo a `speeds` field out of a mission load. The keys are enumerated
once in STATIC_KEYS now, and this check reads THAT list rather than restating it, so adding
a particular cannot silently fail to ship.

TEETH - six mutations RUN against a sidecar copy; the predictions below are what the runs
actually printed, not what was guessed first:
  drop Dimension from _static_from_aisstream   -> 8, 8b
  make _dims treat all-zero as a real hull     -> 4, 8b
  drop the destination field from msg 5        -> 2, 5, 6
  read msg 5 dimensions at the msg 19 offsets  -> 1, 5
  remove the STATIC_KEYS loop from snapshot()  -> 5, 6, 7
  let a position report clear the static keys  -> 5, 6

Note what the wrong-offsets mutation does NOT kill: check 6 stays green, correctly. It asks
whether every particular ARRIVED, and dimensions read at the wrong offsets still arrive -
they are simply wrong. Check 1 is what holds the values. A presence check and a value check
are two assertions and this file needs both.
"""

import io
import os
import sys

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)


def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-400:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

import ais_service as A                                             # noqa: E402

fails = 0
ran = 0


def check(name, cond, detail=""):
    global fails, ran
    ran += 1
    try:
        ok = bool(cond()) if callable(cond) else bool(cond)
        if callable(detail):
            detail = detail()
    except Exception as e:                                          # noqa: BLE001
        ok, detail = False, "threw %s: %s" % (type(e).__name__, e)
    print(("  ok   " if ok else "  FAIL ") + name + ("   [%s]" % detail if detail else ""))
    if not ok:
        fails += 1


print("AIS particulars — what the feed was already carrying:")

# ── 1-3. THE NMEA DECODER, AGAINST A SENTENCE WITH PUBLISHED ANSWERS ────────────────
#
# ⚠ AN EXTERNAL REFERENCE, NOT A ROUND TRIP. This is the widely-published AIVDM type 5
# conformance example, and EVER DIADEM's figures are a matter of record: 295 m x 32 m,
# IMO 9134270, call sign 3FOF8, bound for NEW YORK at 12.2 m draught. Decoding our own
# encoder's output would prove only that the pair agree - see the estate's round-trip rule.
MSG5 = ("55?MbV02;H;s<HtKR20EHE:0@T4@Dn2222222216L961O5Gf0NSQEp6ClRp88888888880", 2)
_d5 = A.decode_aivdm_payload(*MSG5)

check("1. message 5 yields the HULL: length and beam from the antenna offsets",
      lambda: _d5 and _d5.get("length") == 295.0 and _d5.get("beam") == 32.0
      and _d5.get("dim") == {"a": 225.0, "b": 70.0, "c": 1.0, "d": 31.0},
      lambda: "%s x %s m, dim %s" % (_d5.get("length"), _d5.get("beam"), _d5.get("dim")))
check("2. ... the VOYAGE: destination, draught and ETA",
      lambda: _d5 and _d5.get("dest") == "NEW YORK" and _d5.get("draught") == 12.2
      and _d5.get("eta") == "05-15 14:00",
      lambda: "-> %s, %s m draught, ETA %s"
      % (_d5.get("dest"), _d5.get("draught"), _d5.get("eta")))
check("3. ... and the IDENTITY: MMSI, name, IMO, call sign, type",
      lambda: _d5 and _d5.get("mmsi") == 351759000 and _d5.get("name") == "EVER DIADEM"
      and _d5.get("imo") == 9134270 and _d5.get("callsign") == "3FOF8"
      and _d5.get("type") == 70,
      lambda: "%s / MMSI %s / IMO %s / %s / AIS type %s"
      % (_d5.get("name"), _d5.get("mmsi"), _d5.get("imo"), _d5.get("callsign"),
         _d5.get("type")))

# ── 4. NOT AVAILABLE IS NOT ZERO ────────────────────────────────────────────────────
# All-four-zero is how AIS says "no dimensions". A zero-metre hull would size an icon to a
# dot and read on the card as a real measurement.
check("4. all-zero dimensions mean NOT AVAILABLE, and a partial set still gives what it has",
      lambda: A._dims(0, 0, 0, 0) == {}
      and A._dims(100, 20, 0, 0).get("length") == 120.0
      and "beam" not in A._dims(100, 20, 0, 0)
      and A._dims(0, 0, 5, 6).get("beam") == 11.0,
      lambda: "0,0,0,0 -> %s;  100,20,0,0 -> %s"
      % (A._dims(0, 0, 0, 0), A._dims(100, 20, 0, 0)))
check("4b. ... and AIS text padding is absence, not an empty destination",
      lambda: A._ais_text("@@@@@@@@") is None and A._ais_text("") is None
      and A._ais_text("NEW YORK@@@") == "NEW YORK",
      "a blank Dest beside a populated one reads as 'nowhere', which is a different claim")

# ── 5-7. THE MERGE AND THE SERIALISER ───────────────────────────────────────────────
_reg = A.Registry()
_reg.update(351759000, "nmea", lat=42.14, lon=-80.09, sog=12.4, cog=271.0)
_static = dict(_d5)
_static.pop("mmsi", None)
_reg.update(351759000, "nmea", **_static)
_reg.update(351759000, "nmea", lat=42.141, lon=-80.091, sog=12.1, cog=272.0)
_snap = _reg.snapshot()[0]

check("5. static particulars SURVIVE the position reports that follow them",
      lambda: _snap.get("dest") == "NEW YORK" and _snap.get("length") == 295.0
      and _snap.get("lat") == 42.141,
      lambda: "after two later position reports: %s, %s m, at %s"
      % (_snap.get("dest"), _snap.get("length"), _snap.get("lat")))

# ⚠ THE WHITELIST CHECK. Read from STATIC_KEYS rather than restated here: a list written
# out in this file would agree with itself while the serialiser dropped the field.
_absent = [k for k in ("length", "beam", "dim", "dest", "draught", "imo", "callsign", "eta")
           if k not in _snap]
check("6. every particular the decoder produced reaches the SERVED record",
      lambda: not _absent,
      lambda: ("dropped at the serialiser: %s" % ", ".join(_absent)) if _absent
      else "%d of %d STATIC_KEYS present; the rest are registry facts AIS does not carry"
      % (len([k for k in A.Registry.STATIC_KEYS if k in _snap]),
         len(A.Registry.STATIC_KEYS)))

# The tonnage path, which no AIS message can fill. Proven by feeding it directly: if this
# fails, whoever wires a particulars lookup will find their data silently discarded.
_reg.update(351759000, "lookup", gt=52000, dwt=67170, built=1996, flag="PA")
_snap2 = _reg.snapshot()[0]
check("7. registry-only facts (tonnage, build year, flag) are carried when a source has them",
      lambda: _snap2.get("gt") == 52000 and _snap2.get("dwt") == 67170
      and _snap2.get("built") == 1996 and _snap2.get("flag") == "PA",
      lambda: "gt=%s dwt=%s built=%s flag=%s — NOT in any AIS message, so they can only "
      "arrive from a particulars lookup" % (_snap2.get("gt"), _snap2.get("dwt"),
                                            _snap2.get("built"), _snap2.get("flag")))

# ── 8. THE aisstream PATH, WHOSE FIELD NAMES ARE THEIRS AND NOT OURS ────────────────
# Shaped exactly as aisstream's published ShipStaticData: Dimension{A,B,C,D},
# MaximumStaticDraught, ImoNumber, Eta{Month,Day,Hour,Minute}.
_body = {"Type": 70, "Name": "EVER DIADEM", "CallSign": "3FOF8", "ImoNumber": 9134270,
         "Dimension": {"A": 225, "B": 70, "C": 1, "D": 31},
         "MaximumStaticDraught": 12.2, "Destination": "NEW YORK",
         "Eta": {"Month": 5, "Day": 15, "Hour": 14, "Minute": 0}}
_a = A._static_from_aisstream(_body)
check("8. the aisstream handler pulls the same particulars from ShipStaticData",
      lambda: _a.get("length") == 295.0 and _a.get("beam") == 32.0
      and _a.get("dest") == "NEW YORK" and _a.get("draught") == 12.2
      and _a.get("imo") == 9134270 and _a.get("callsign") == "3FOF8"
      and _a.get("eta") == "05-15 14:00",
      lambda: "%s x %s m -> %s, %s m, IMO %s"
      % (_a.get("length"), _a.get("beam"), _a.get("dest"), _a.get("draught"), _a.get("imo")))
check("8b. ... and a message carrying only SOME of them contributes what it has",
      lambda: A._static_from_aisstream({"Dimension": {"A": 12, "B": 8, "C": 2, "D": 2}})
      == {"dim": {"a": 12.0, "b": 8.0, "c": 2.0, "d": 2.0}, "length": 20.0, "beam": 4.0}
      and A._static_from_aisstream({}) == {},
      "a partial static message must not be dropped whole")

# ── 9. THE CLASS B PATHS ────────────────────────────────────────────────────────────
# A Class B hull broadcasts dimensions and type but no destination and no draught - it is
# not required to. Those must stay ABSENT rather than be filled with a zero.
#
# ⚠ THE FIRST VERSION OF THIS CHECK PASSED WITHOUT TESTING ANYTHING. It used a msg-24
# payload that turned out to be PART A - which carries only a name - so "no dest and no
# draught" was trivially true and the detail line printed `keys: ['name']`. Reading that
# line is the only thing that caught it.
#
# The payload is built here FIELD BY FIELD AT THE ITU-R M.1371 OFFSETS, then decoded. That
# is not a round trip through our own encoder: the bits are placed by hand from the
# published layout, and the check is that the decoder reads back the values put at those
# offsets. The spec is the external reference.
def _pack(fields, nbits=168):
    """fields: list of (start, length, value) -> 6-bit ASCII-armoured AIVDM payload."""
    bits = 0
    for start, ln, val in fields:
        bits |= (int(val) & ((1 << ln) - 1)) << (nbits - (start + ln))
    out = []
    for k in range(nbits // 6):
        c = (bits >> (nbits - 6 * (k + 1))) & 0x3F
        out.append(chr(c + 48 if c < 40 else c + 56))
    return "".join(out)


_p24b = _pack([(0, 6, 24), (8, 30, 338111222), (38, 2, 1),      # msg / mmsi / part B
               (40, 8, 52),                                      # type 52 = tug
               (132, 9, 24), (141, 9, 8), (150, 6, 5), (156, 6, 6)])   # A B C D
_d24 = A.decode_aivdm_payload(_p24b, 0)
check("9. message 24 part B gives the type and the hull, read at the ITU offsets",
      lambda: _d24 and _d24.get("mmsi") == 338111222 and _d24.get("type") == 52
      and _d24.get("length") == 32.0 and _d24.get("beam") == 11.0,
      lambda: "MMSI %s, AIS type %s, %s x %s m (placed 24+8 by 5+6)"
      % (_d24.get("mmsi"), _d24.get("type"), _d24.get("length"), _d24.get("beam")))
check("9b. ... and INVENTS no voyage data, because a Class B hull broadcasts none",
      lambda: _d24 and "dest" not in _d24 and "draught" not in _d24 and "eta" not in _d24,
      lambda: "carries: %s" % sorted(k for k in (_d24 or {}) if k != "mmsi"))


# -- 10. THE AISHUB POLL, which had no coverage here at all ---------------------------
# ⚠⚠ AISHub IS PRIORITY 30, THE HIGHEST IN THE REGISTRY, and this suite never drove it.
# It normalized name and type and dropped the rest, so a hull only this feed carries arrived
# with no length, beam, destination or IMO - and checks 1-9 stayed green throughout, because
# every one of them drives the NMEA decoder or aisstream.
_hub = A._aishub_normalize([{
    "MMSI": 366123456, "TIME": "2026-09-23 11:04:00 GMT",
    "LATITUDE": 43.07, "LONGITUDE": -70.71, "SOG": 8.2, "COG": 91.0,
    "HEADING": 90, "NAVSTAT": 0, "NAME": "TEST HULL", "TYPE": 70,
    "A": 180, "B": 40, "C": 16, "D": 16,
    "DEST": "PORTSMOUTH", "CALLSIGN": "WDE1234", "IMO": 9134270,
    "DRAUGHT": 34,
}])[0]
check("10. the AISHub poll carries the hull's SIZE, not just its name and type",
      lambda: _hub.get("length") == 220.0 and _hub.get("beam") == 32.0
              and (_hub.get("dim") or {}).get("a") == 180.0,
      lambda: "%s x %s m, dim %s - the highest-priority feed had been discarding all of it"
              % (_hub.get("length"), _hub.get("beam"), _hub.get("dim")))

check("10b. ... and the destination, call sign and IMO",
      lambda: _hub.get("dest") == "PORTSMOUTH" and _hub.get("callsign") == "WDE1234"
              and _hub.get("imo") == 9134270,
      lambda: "dest=%r callsign=%r imo=%r" % (_hub.get("dest"), _hub.get("callsign"),
                                              _hub.get("imo")))

# ⚠⚠ AND THE DRAUGHT IS ABSENT ON PURPOSE - this check exists to keep it that way.
# AIS carries draught in TENTHS of a metre. `_aishub_format_is_raw` decides raw-vs-human for
# this response by reading the COORDINATES, and says nothing whatever about the unit a draught
# arrives in. The fixture above sends DRAUGHT 34, which is either 3.4 m or 34 m and nothing on
# this path can tell. Publishing the wrong one on a console whose keep-out floor IS a depth is
# worse than publishing none, so it is not taken - and a later hand adding "just one more
# field" has to argue with this check first.
check("10c. ... and NOT the draught, whose unit nothing on this path establishes",
      lambda: "draught" not in _hub and "draft" not in _hub,
      lambda: "carries: %s - a DRAUGHT of 34 is 3.4 m or 34 m and the raw/human test reads "
              "the COORDINATES, so it settles nothing here"
              % sorted(k for k in _hub if _hub.get(k) is not None))

# ⚠ THE PAIR FOR 10: an absent set must stay absent rather than become zeros. All four
# offsets zero is AIS's not-available encoding, not a zero-metre ship.
_bare = A._aishub_normalize([{
    "MMSI": 366999888, "TIME": "2026-09-23 11:04:00 GMT",
    "LATITUDE": 43.07, "LONGITUDE": -70.71, "NAME": "NO PARTICULARS", "TYPE": 37,
    "A": 0, "B": 0, "C": 0, "D": 0, "DEST": "@@@@@@@@", "IMO": 0,
}])[0]
check("10d. ... and a hull that reports none of it carries none - not zeros, not blanks",
      lambda: "length" not in _bare and "beam" not in _bare and "dim" not in _bare
              and "dest" not in _bare and "imo" not in _bare,
      lambda: "carries: %s - all-four-zero is the not-available encoding and '@@@@@@@@' is "
              "padding, neither of which may reach the card as a value"
              % sorted(k for k in _bare if _bare.get(k) is not None))

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
