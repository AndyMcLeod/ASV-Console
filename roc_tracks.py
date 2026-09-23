# ============================================================================
# ⚠⚠ ASV OWNS THIS FILE NOW (2026-09-21). DO NOT RE-VENDOR IT.
#
# Andy, 2026-08-31: "stop updating other projects. We concentrate only on ASV
# Console moving forward. There may be components of other projects that we
# pull over." The flow is ONE WAY: asv_core is a place to pull FROM, never a
# place this repo writes back to. The vendor header below is kept for
# PROVENANCE -- it records where this body came from -- and its instruction is
# now wrong for this repo, in the same dangerous way it was already wrong for
# static/js/keepouts.js, routing.js and core_turns.js:
#
#   ⚠ RUNNING `python tools/vendor.py` IN THE asv_core REPO WOULD OVERWRITE
#     THIS FILE. If a `--check` there reports this copy as DRIFTED, that is
#     correct and expected: it has drifted, on purpose, and here is the whole
#     of it.
#
#       1. `home_intent` and `active_home` carry `link` and `age_s`
#          (2026-09-21). Nothing in this module clears a ROC when its feed
#          stops -- GpsFeed.run swallows the error and retries every 3 s for
#          ever -- so the operator's CARD went red while the one thing the
#          Engine pulls every tick was byte-identical to a live link: 20 s dead,
#          the same point, `moving` still true, and the RTH note still reading
#          "chasing Mothership (MOVING)" about a ship 40 m from where it said.
#          `moving`/`closable` are deliberately unchanged -- a steaming ship
#          with a dead link is still steaming. Fixed in asv_core at 2a0b53d and
#          pulled across; covered by tests/roc_tracks.py there and by the RTH
#          note checks here.
#
# ⚠⚠ AND THAT CHECK HAD BEEN LYING BY OMISSION UNTIL 2026-09-21. `vendor.py
# --check` prints the first differing line of a drifted copy; a Windows console
# is cp1252, these files are written in em dashes, and the print raised
# UnicodeEncodeError -- so the whole check died at the FIRST drifted copy whose
# sample line happened to contain one, and the run looked finished. It was
# hiding four drifts. Fixed in asv_core (2a0b53d); mentioned here because a
# green vendor check is the only thing standing between this file and being
# silently overwritten.
# ============================================================================
# ============================================================================
# VENDORED FROM asv_core -- DO NOT EDIT THIS COPY.
#
#   source : asv_core/roc_tracks.py
#   sync   : python tools/vendor.py            (from the asv_core repo)
#   verify : python tools/vendor.py --check    (fails if this copy drifted)
#
# NO ABSOLUTE PATH APPEARS ABOVE, AND THAT IS DELIBERATE. Two of these repos
# publish scrubbed PUBLIC mirrors, and Transit's exporter ABORTS on anything
# matching [A-Z]:\Claude -- absolute paths name private sibling projects and
# point a cloner at a drive they do not have. A header naming a path would be
# publish-safe only for as long as somebody maintained a substitution rule for
# it in each exporter separately. Naming the repo instead is safe by
# construction, in every consumer, including ones that do not exist yet.
#
# A copy rather than an import because this repo has to stand on its own: it is
# a separate repository, and this file is opened by path rather than imported
# as a package. The old trade was drift -- a vendored file did not follow its
# source, which is how the estate grew three copies of currents.py. The --check
# above removes that trade: this copy cannot diverge without failing a suite.
#
# THIS CONSUMER, SPECIFICALLY:
# THIS REPO WROTE roc_tracks.py AND THE CORE BODY IS ITS OWN, unchanged apart
# from a docstring made app-neutral. Nothing here changes.
#
# Its 677 lines of tests (tests/roc_tracks.py + tests/roc_persist.py) stay in
# this repo deliberately and now exercise the VENDORED file, which is what
# proves the console really runs the core body. The core adds only the one
# case they cannot cover: every check here calls configure_vessel() first,
# because this console does, so nothing anywhere asserted what an
# UNCONFIGURED module does -- and that is precisely what the other consumer
# runs on.
#
# Edit the core file and re-run the sync. Everything below is verbatim.
# ============================================================================

"""Remote Operations Center (ROC) tracking + moving-HOME for an ASV console.

The operational paradigm: humans command the ASV from one or more Remote
Operations Centers. A ROC has a GPS position and a telemetry link to the boat.
There are two kinds, and a mission may use one or both:

  * SHORE ROC - near the launch harbor, or anywhere in the world. A (usually)
    fixed GPS point. The real launch/recovery point is OFFSET from the ROC
    antenna by an operator-entered value (range + bearing), e.g. "the ramp is
    40 m at 210 deg from the antenna."
  * SHIP ROC (Mothership) - a ROC aboard a vessel near the mission area. A
    MOVING GPS point. Recovery happens at a range + bearing FROM the ship
    (e.g. 50 m astern), so the offset bearing is usually taken RELATIVE to the
    ship's course.

Each ROC's "arrival point" is its position walked out along that offset. The
operator picks one ROC as the active HOME; when it is a ship, HOME is a moving
point and Return-to-Home chases it (a Mothership recovery). The console pulls
`active_home()` every telemetry tick and re-targets the boat live - see
`Engine._run` in the console that hosts this.

PLACE -> EDIT -> CONFIRM (the sim's interactive lifecycle). A ROC is created by
clicking the chart (the console posts its lat/lon). It comes up STAGED: its
position (and, for a ship, its heading + speed) are edited on the ROC card while
it sits still. CONFIRM makes it ACTIVE - a shore ROC becomes a usable HOME
anchor; a ship starts STEAMING at the entered heading/speed. Heading/speed edits
on an active ship apply live; HOLD stops it and returns it to STAGED so it can be
repositioned. Only an ACTIVE ROC may be selected as HOME.

Position DATA STREAMS reach a ROC three ways, all funneling into `feed()`:
  * manual  - the operator places/edits lat/lon on the ROC card
  * push    - any external process POSTs to /api/roc {op:"feed", ...}
  * sim     - in simulator mode this module steams every ACTIVE ship ROC on its
              own heading/speed, so the moving-HOME recovery is exercised with no
              hardware (nothing auto-seeds - the operator places the ships)

Design: this module owns ALL ROC state and imports NOTHING from the console
(the console injects the boat-fix getter, exactly like hydro_sensors.DepthBridge
takes get_fix/get_depth). stdlib-only. Nothing starts on import.
"""

import json
import math
import os
import socket
import subprocess
import sys
import threading
import time

APP_DIR = os.path.dirname(os.path.abspath(__file__))
ROC_CONFIG_PATH = os.path.join(APP_DIR, "roc_config.json")
# How many ROCs survive a restart. The registry itself is UNBOUNDED - a session may place
# as many as the work needs - but the config file keeps only the most recent few, because
# an unbounded file is exactly what went wrong: it had grown to 198 identical staged
# entries, each one left behind by something that added a ROC and never removed it. The
# card then opened on a wall of stale rows, and because every edit ships and re-renders
# the WHOLE set, one removal took about a second to appear and took away 1 row out of 198
# - which reads precisely like a Remove button that does not work.
# THE OPERATOR'S RULE (Andy, 2026-08-08): "allow only the most recent 3 entries to
# preserve through restarts". Applied on BOTH save and load, so an oversized file written
# by an older build heals itself on the next start rather than needing deleting by hand.
ROC_PERSIST_MAX = 3

# Telemetry-age thresholds for a live-fed ROC's link indicator (seconds).
FRESH_S = 5.0
LOST_S = 15.0

# Sensible defaults so the concept shows immediately when a ROC is created.
SHORE_OFFSET = {"range_m": 0.0, "bearing_deg": 0.0, "ref": "true"}       # ROC == arrival
SHIP_SPEED_DEFAULT = 1.5     # kn, pre-filled on a new ship so the card shows a starting value
SHIP_HEADING_DEFAULT = 0.0   # deg true

# --- VESSEL-DERIVED (set by configure_vessel; NEVER hardcode a boat constant here) --- #
# A fixed astern-recovery standoff cannot serve every ASV: the same number that is
# sensible for an 8 m USV is absurdly far for a 2 m one and too close for a 20 m one.
# So the default scales with the hull, and a vessel file may override it outright with
# planning.roc.ship_recovery_m. ASV_MAX_SPEED_KN backs the closing check below.
#
# GOTCHA THIS EXISTS TO AVOID: these are re-derived on EVERY vessel switch, because
# apply_vessel() calls configure_vessel(). An import-time-only derived constant goes
# stale the moment the operator picks another vessel in the top-bar picker.
#
# THE PLACEHOLDERS ARE A CONTRACT, NOT A GUESS. A console with ONE hull need never call
# configure_vessel() at all, and then these values are what it runs on for ever -- so
# they are exactly the constants such a console would otherwise hardcode: 50 m astern,
# 6 kn. tests/roc_tracks.py in the core asserts that, because it is the whole reason an
# unconfigured consumer can adopt this file without changing behaviour. Do not "tidy"
# them toward some other default, and do not assume every consumer configures.
SHIP_RECOVERY_M = 50.0        # placeholder; overwritten at import once a vessel loads
ASV_MAX_SPEED_KN = 6.0        # placeholder; overwritten likewise
CLOSE_MARGIN_KN = 0.5         # overtake needed before a moving HOME counts as reachable


def default_ship_recovery_m(vessel):
    """Astern-recovery standoff (m) for a vessel: its own planning.roc.ship_recovery_m
    if it declares one, else scaled off the hull with a small-boat floor. Six lengths
    astern is a working boat-handling distance that stays sane across the fleet."""
    try:
        roc = (vessel.get("planning") or {}).get("roc") or {}
        if isinstance(roc.get("ship_recovery_m"), (int, float)):
            return max(0.0, float(roc["ship_recovery_m"]))
        loa = float((vessel.get("hull") or {}).get("loa_m") or 0.0)
    except (AttributeError, TypeError, ValueError):
        return 50.0
    return max(20.0, 6.0 * loa)


def configure_vessel(vessel):
    """Re-derive every vessel-dependent ROC constant. Called by apply_vessel() at load
    AND on a live vessel switch. Existing ROCs keep the offsets the operator already
    entered - this only moves the DEFAULT applied to newly created ships."""
    global SHIP_RECOVERY_M, ASV_MAX_SPEED_KN
    if not vessel:
        return
    SHIP_RECOVERY_M = default_ship_recovery_m(vessel)
    try:
        ASV_MAX_SPEED_KN = float(vessel["propulsion"]["speeds_kn"]["high"])
    except (KeyError, TypeError, ValueError):
        pass


def ship_offset():
    """Default offset for a NEW ship ROC: the current vessel's standoff, dead astern,
    measured relative to the ship's course."""
    return {"range_m": SHIP_RECOVERY_M, "bearing_deg": 180.0, "ref": "relative"}

M_PER_DEG_LAT = 111320.0
KN_TO_MS = 0.514444


# --- geo helpers (flat-earth; copied from asv_console to avoid a circular import) --- #
def dest_point(lat, lon, bearing_deg, dist_m):
    """Move dist_m along bearing from (lat,lon) using a local flat approximation."""
    b = math.radians(bearing_deg)
    dn = dist_m * math.cos(b)
    de = dist_m * math.sin(b)
    return (lat + dn / M_PER_DEG_LAT,
            lon + de / (M_PER_DEG_LAT * math.cos(math.radians(lat))))


def _clean_ref(ref):
    return "relative" if str(ref).lower().startswith("rel") else "true"


# --- NMEA-0183 GPS ingest (a real GPS feed; the sim stand-in is gps_sim.py) --------- #
def _nmea_deg(v, hemi, deg_len):
    """ddmm.mmmm + N/S/E/W -> signed decimal degrees, or None."""
    if not v or not hemi:
        return None
    try:
        deg = int(v[:deg_len]); minutes = float(v[deg_len:])
    except (ValueError, IndexError):
        return None
    x = deg + minutes / 60.0
    return -x if hemi in ("S", "W") else x


def _nmea_float(v):
    """A numeric NMEA field -> float, or None. NEVER raises.

    The speed and course fields used to go through a bare float(), while the position fields
    right above them went through _nmea_deg's guard - one function, two standards. A sentence
    whose CHECKSUM IS VALID can still carry rubbish in a field: the checksum is an 8-bit XOR,
    so about one corruption in 256 passes it, and a flaky receiver can compute a good checksum
    over an already-mangled buffer. An EMPTY field is normal here and yields None, so an
    unparseable one is treated the same way rather than throwing the whole fix away."""
    if not v:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def parse_nmea(line):
    """Parse one $--RMC / $--GGA sentence -> {lat, lon, cog, sog} or None. Verifies
    the XOR checksum; accepts any talker id (GP/GN/GL/...). RMC carries course+speed."""
    line = line.strip()
    if not line.startswith("$") or "*" not in line:
        return None
    body, _, cs = line[1:].partition("*")
    c = 0
    for ch in body:
        c ^= ord(ch)
    if "%02X" % c != cs[:2].upper():
        return None
    f = body.split(",")
    typ = f[0][-3:]
    if typ == "RMC":                                 # time,status,lat,NS,lon,EW,sog,cog,date,...
        if len(f) < 9 or f[2] != "A":                # status A = valid fix
            return None
        lat = _nmea_deg(f[3], f[4], 2); lon = _nmea_deg(f[5], f[6], 3)
        if lat is None or lon is None:
            return None
        return {"lat": lat, "lon": lon,
                "cog": _nmea_float(f[8]), "sog": _nmea_float(f[7])}
    if typ == "GGA":                                 # time,lat,NS,lon,EW,fixq,...
        if len(f) < 7 or f[6] == "0":                # fix quality 0 = no fix
            return None
        lat = _nmea_deg(f[2], f[3], 2); lon = _nmea_deg(f[4], f[5], 3)
        if lat is None or lon is None:
            return None
        return {"lat": lat, "lon": lon, "cog": None, "sog": None}
    return None


class GpsFeed(threading.Thread):
    """Reads a real GPS NMEA stream (TCP-connect or UDP-bind) and feeds one ROC's
    position/course/speed. Same transport shape as ais_service.NmeaSource;
    auto-reconnects so a dropped or not-yet-up emitter recovers on its own."""

    def __init__(self, tracker, roc_id, host, port, udp=False):
        super().__init__(daemon=True, name="roc-gps-%s" % roc_id)
        self.tracker = tracker
        self.roc_id = roc_id
        self.host = host
        self.port = int(port)
        self.udp = bool(udp)
        self._stop = threading.Event()

    def stop(self):
        self._stop.set()

    def _emit(self, line):
        # NOT a second copy of the parser's guard - a BLAST-RADIUS LIMIT at the thread
        # boundary. parse_nmea's contract is "-> dict or None" and it now honours it, but if
        # anything in here ever raises, the exception unwinds the read loop, closes the
        # socket and is swallowed by run()'s catch-all: the LINK DROPS and reconnects three
        # seconds later. Measured with a checksum-valid sentence carrying a garbage speed -
        # one line cost the connection and two fixes. A GPS feed can be driving a moving HOME
        # for a boat coming home to a mothership; one malformed line must cost one line.
        try:
            rep = parse_nmea(line)
        except Exception:
            return
        if rep:
            self.tracker.feed(self.roc_id, rep["lat"], rep["lon"],
                              cog=rep["cog"], sog=rep["sog"], source="gps")

    def run(self):
        while not self._stop.is_set():
            try:
                self._run_udp() if self.udp else self._run_tcp()
            except Exception:
                pass
            if self._stop.wait(3.0):     # brief backoff, then reconnect
                return

    def _run_tcp(self):
        s = socket.create_connection((self.host, self.port), timeout=10)
        s.settimeout(5.0)
        buf = b""
        try:
            while not self._stop.is_set():
                try:
                    chunk = s.recv(4096)
                except socket.timeout:
                    continue
                if not chunk:
                    break
                buf += chunk
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    self._emit(line.decode("ascii", "replace"))
        finally:
            s.close()

    def _run_udp(self):
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind((self.host, self.port))
        s.settimeout(5.0)
        try:
            while not self._stop.is_set():
                try:
                    data, _ = s.recvfrom(4096)
                except socket.timeout:
                    continue
                for line in data.decode("ascii", "replace").replace("\r", "\n").split("\n"):
                    self._emit(line)
        finally:
            s.close()


class Roc:
    """One Remote Operations Center: a tracked position, a launch/recovery offset,
    and a staged/active lifecycle. A ship also carries a commanded heading + speed
    that steam it while active."""

    def __init__(self, roc_id, name, kind, lat=None, lon=None, offset=None,
                 status="staged", heading=None, speed_kn=None):
        self.id = roc_id
        self.name = name or roc_id
        self.kind = "ship" if kind == "ship" else "shore"
        self.lat = lat
        self.lon = lon
        self.cog = None            # course over ground (deg true) - for a relative offset
        self.sog = None            # speed over ground (kn) - display only
        self.updated_at = None     # monotonic time of the last feed (None = never fed)
        self.source = "none"       # none | manual | push | sim - how the position last arrived
        self.status = "active" if status == "active" else "staged"
        # ship motion command (ignored for a shore ROC)
        self.heading = float(heading) % 360.0 if heading is not None else SHIP_HEADING_DEFAULT
        self.speed_kn = max(0.0, float(speed_kn)) if speed_kn is not None else SHIP_SPEED_DEFAULT
        # real GPS feed (NMEA over TCP/UDP). When attached, the ROC's position comes
        # from the stream - internal steaming is suspended. The tracker owns the reader
        # thread + any spawned gps_sim child; these fields are just for display/state.
        self.gps_attached = False
        self.gps_host = None
        self.gps_port = None
        self.gps_udp = False
        self.gps_spawned = False   # True when the console auto-spawned a gps_sim.py for it
        o = dict(ship_offset() if self.kind == "ship" else SHORE_OFFSET)
        if offset:
            # `is not None`, NOT `in`: a caller that spells an ABSENT field as None - the
            # persisted config does exactly that, `c.get("range_m")` on a record written
            # before the field existed - would otherwise overwrite the default with None,
            # and set_offset() skips None, so the attribute was never assigned at all.
            # The ROC then raised AttributeError the first time anything read its arrival
            # point, which is inside snapshot(), so ONE malformed record took out the
            # whole ROC card and every /api/state frame with it. Defaults must survive an
            # unspecified field; only a real value may replace one.
            o.update({k: offset[k] for k in ("range_m", "bearing_deg", "ref")
                      if offset.get(k) is not None})
        self.set_offset(o.get("range_m"), o.get("bearing_deg"), o.get("ref"))
        if self.status == "active" and self.kind == "ship":   # a restored active ship displays its motion
            self.cog, self.sog = self.heading, self.speed_kn

    # -- mutation -------------------------------------------------------------- #
    def set_offset(self, range_m=None, bearing_deg=None, ref=None):
        if range_m is not None:
            self.range_m = max(0.0, float(range_m))
        if bearing_deg is not None:
            self.bearing_deg = float(bearing_deg) % 360.0
        if ref is not None:
            self.ref = _clean_ref(ref)

    def set_motion(self, heading=None, speed_kn=None):
        """Set a ship's commanded heading/speed. Applies live when the ship is
        active (steaming) - the sim loop reads these each tick."""
        if heading is not None:
            self.heading = float(heading) % 360.0
        if speed_kn is not None:
            self.speed_kn = max(0.0, float(speed_kn))
        if self.status == "active" and self.kind == "ship":
            self.cog, self.sog = self.heading, self.speed_kn

    def confirm(self):
        """Stage -> active: a shore ROC becomes a usable HOME anchor; a ship starts
        steaming at its heading/speed."""
        self.status = "active"
        if self.kind == "ship":
            self.cog, self.sog = self.heading, self.speed_kn

    def hold(self):
        """Active -> staged: stop a ship and let it be repositioned/edited."""
        self.status = "staged"
        if self.kind == "ship":
            self.sog = 0.0

    def feed(self, lat, lon, cog=None, sog=None, source="push"):
        self.lat = float(lat)
        self.lon = float(lon)
        if cog is not None:
            self.cog = float(cog) % 360.0
        if sog is not None:
            self.sog = float(sog)
        self.updated_at = time.monotonic()
        self.source = source

    # -- derived --------------------------------------------------------------- #
    def steaming(self):
        """A ship the SIM advances by dead reckoning. Suspended while a GPS feed is
        attached - the stream drives the position then."""
        return (self.kind == "ship" and self.status == "active"
                and self.speed_kn > 0.0 and not self.gps_attached)

    def is_moving(self):
        """Whether the recovery point is treated as moving (MOVING tag + RTH chase):
        a dead-reckon-steaming ship, or a GPS-fed ship."""
        return self.steaming() or (self.gps_attached and self.kind == "ship")

    def closing_kn(self):
        """How fast the ASV can close on this recovery point at its best speed (kn).
        A stationary point closes at the boat's full speed; a steaming ship subtracts
        its own. THIS IS THE VESSEL-DEPENDENT PART OF A MOTHERSHIP RECOVERY: a 14 kn
        USV overhauls a 5 kn ship easily, a 6 kn one does not, and the same plan is
        sound for the first and unflyable for the second."""
        if not self.is_moving():
            return ASV_MAX_SPEED_KN
        ship = self.sog if self.sog is not None else self.speed_kn
        try:
            ship = max(0.0, float(ship or 0.0))
        except (TypeError, ValueError):
            ship = 0.0
        return ASV_MAX_SPEED_KN - ship

    def closable(self):
        """False when RTH to this point would chase it forever - the boat needs a real
        overtake margin, not merely to be nominally faster."""
        return self.closing_kn() > CLOSE_MARGIN_KN

    def _abs_bearing(self):
        """Offset bearing resolved to true degrees. A 'relative' offset is taken
        from the ship's course (falls back to the commanded heading, then true)."""
        if self.ref == "relative":
            ref_hdg = self.cog if self.cog is not None else (
                self.heading if self.kind == "ship" else None)
            if ref_hdg is not None:
                return (ref_hdg + self.bearing_deg) % 360.0
        return self.bearing_deg

    def arrival_point(self):
        """The launch/recovery point = ROC position walked out along the offset.
        None when the ROC has no position yet."""
        if self.lat is None or self.lon is None:
            return None
        if self.range_m <= 0.0:
            return (self.lat, self.lon)
        return dest_point(self.lat, self.lon, self._abs_bearing(), self.range_m)

    def link_state(self, now=None):
        """ok | stale | lost | nofix. A live-fed ROC ages out; a manually placed
        (or persisted shore) ROC is simply 'ok' - a fixed antenna doesn't go stale."""
        if self.lat is None or self.lon is None:
            return "nofix"
        if self.source in ("push", "sim", "gps") and self.updated_at is not None:
            age = (now or time.monotonic()) - self.updated_at
            if age <= FRESH_S:
                return "ok"
            return "stale" if age <= LOST_S else "lost"
        return "ok"

    def to_dict(self, now=None):
        now = now or time.monotonic()
        ap = self.arrival_point()
        age = None if self.updated_at is None else round(now - self.updated_at, 1)
        return {
            "id": self.id, "name": self.name, "kind": self.kind, "status": self.status,
            "lat": self.lat, "lon": self.lon, "cog": self.cog, "sog": self.sog,
            "heading": self.heading, "speed_kn": self.speed_kn,
            "offset": {"range_m": self.range_m, "bearing_deg": self.bearing_deg,
                       "ref": self.ref},
            "arrival": None if ap is None else {"lat": ap[0], "lon": ap[1]},
            "arrival_bearing": self._abs_bearing(),
            "link": self.link_state(now), "age_s": age, "source": self.source,
            "moving": self.is_moving(),
            "closing_kn": round(self.closing_kn(), 2), "closable": self.closable(),
            "gps": {"attached": self.gps_attached, "host": self.gps_host,
                    "port": self.gps_port, "udp": self.gps_udp, "spawned": self.gps_spawned},
        }

    # -- persistence (definition + placement + lifecycle) --------------------- #
    def to_config(self):
        c = {"id": self.id, "name": self.name, "kind": self.kind, "status": self.status,
             "range_m": self.range_m, "bearing_deg": self.bearing_deg, "ref": self.ref,
             "lat": self.lat, "lon": self.lon}
        if self.kind == "ship":
            c["heading"], c["speed_kn"] = self.heading, self.speed_kn
        return c


class RocTracker:
    """The console's set of ROCs. Global, like COMMS / WATER / ENV. Owns the
    active-HOME selection and (in sim) steams every active ship. Thread-safe.
    Nothing auto-seeds - the operator places ROCs by clicking the chart."""

    def __init__(self, config_path=ROC_CONFIG_PATH, log_dir=None):
        self._lock = threading.Lock()
        self._rocs = {}            # id -> Roc (insertion order preserved, py3.7+)
        self._home_id = None
        self._config_path = config_path
        self._log_dir = log_dir    # where a spawned gps_sim.py's log goes
        self._seq = 0
        self._sim_stop = threading.Event()
        self._sim_thread = None
        self._gps_feeds = {}       # roc_id -> GpsFeed (the NMEA reader thread)
        self._gps_procs = {}       # roc_id -> Popen of an auto-spawned gps_sim.py
        self._load()

    # -- ids ------------------------------------------------------------------- #
    def _new_id(self, kind):
        self._seq += 1
        return "%s-%d" % (kind, self._seq)

    # -- persistence ----------------------------------------------------------- #
    @staticmethod
    def _persist_keep(items, home_id, key=lambda x: x):
        """The ROC_PERSIST_MAX most recent of `items`, in their original order.

        Recency is INSERTION ORDER - the registry is an ordered dict and the config file
        is written in that order, so the tail is the newest. There is no timestamp on a
        ROC and adding one to mean "recent" would be a second source of truth for
        something the order already says.

        THE ONE EXCEPTION IS HOME. Dropping it would quietly move where Return-to-Home
        goes on the next start, so if HOME falls outside the tail it displaces the OLDEST
        of the kept entries rather than being lost. The count is still exactly
        ROC_PERSIST_MAX, and HOME keeps its place in the order (the result stays ordered,
        so the next save is stable).
        """
        if len(items) <= ROC_PERSIST_MAX:
            return list(items)
        keep = list(items[-ROC_PERSIST_MAX:])
        if home_id is not None and not any(key(i) == home_id for i in keep):
            home = next((i for i in items if key(i) == home_id), None)
            if home is not None:
                keep = [home] + keep[1:]        # displace the oldest kept, not the newest
        return keep

    def use_config(self, path):
        """Re-point the registry at another config file and reload from it.

        For a TEST HARNESS driving a real console: the registry is a module-level global
        built at import, so without this a suite that adds a ROC writes into the
        operator's own roc_config.json. Clears whatever the default file had already
        loaded, so the harness starts from that file and only that file.
        """
        with self._lock:
            for rid in list(self._rocs):
                self._detach_gps_locked(rid)     # never orphan a reader thread or child
            self._rocs.clear()
            self._home_id = None
            self._seq = 0
            self._config_path = path
        self._load()

    def _load(self):
        try:
            with open(self._config_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except (OSError, ValueError):
            return
        # Cap on the way IN as well as out: a file written by an older build (or by hand)
        # can be any size, and the operator should not have to delete it to get a usable
        # card. Whatever is dropped here is gone at the next save, which is the point.
        raw = self._persist_keep([c for c in data.get("rocs", []) if isinstance(c, dict)],
                                 data.get("home_id"), key=lambda c: c.get("id"))
        for c in raw:
            try:
                r = Roc(c["id"], c.get("name"), c.get("kind", "shore"),
                        lat=c.get("lat"), lon=c.get("lon"), status=c.get("status", "staged"),
                        heading=c.get("heading"), speed_kn=c.get("speed_kn"),
                        offset={"range_m": c.get("range_m"), "bearing_deg": c.get("bearing_deg"),
                                "ref": c.get("ref")})
                if r.lat is not None and r.source == "none":
                    r.source = "manual"     # a persisted placement reads as manual/ok
                self._rocs[r.id] = r
            except (KeyError, TypeError, ValueError):
                continue
        for rid in self._rocs:              # keep _seq ahead of any restored suffix
            try:
                self._seq = max(self._seq, int(rid.rsplit("-", 1)[1]))
            except (IndexError, ValueError):
                pass
        self._home_id = data.get("home_id") if data.get("home_id") in self._rocs else None

    def _save_locked(self):
        # ONLY the most recent ROC_PERSIST_MAX reach the file. The live registry is left
        # alone - removing a ROC the operator is still using because they placed a fourth
        # would be a surprise mid-session; the cap is a property of what SURVIVES.
        keep = self._persist_keep(list(self._rocs.values()), self._home_id, key=lambda r: r.id)
        home = self._home_id if any(r.id == self._home_id for r in keep) else None
        try:
            with open(self._config_path, "w", encoding="utf-8") as f:
                json.dump({"rocs": [r.to_config() for r in keep],
                           "home_id": home}, f, indent=2)
        except OSError:
            pass

    # -- registry mutation ----------------------------------------------------- #
    def add(self, kind, name=None, lat=None, lon=None, offset=None, roc_id=None):
        """Create a STAGED ROC (from a chart click). Returns its id."""
        with self._lock:
            rid = roc_id or self._new_id("ship" if kind == "ship" else "shore")
            r = Roc(rid, name or ("Mothership" if kind == "ship" else "Shore ROC"),
                    kind, lat=lat, lon=lon, offset=offset, status="staged")
            if lat is not None:
                r.source = "manual"
            self._rocs[rid] = r
            self._save_locked()
            return rid

    def update(self, roc_id, name=None, lat=None, lon=None):
        with self._lock:
            r = self._rocs.get(roc_id)
            if not r:
                return False
            if name is not None:
                r.name = str(name)[:60]
            if lat is not None and lon is not None:
                r.feed(lat, lon, source="manual")
            self._save_locked()
            return True

    def set_offset(self, roc_id, range_m=None, bearing_deg=None, ref=None):
        with self._lock:
            r = self._rocs.get(roc_id)
            if not r:
                return False
            r.set_offset(range_m, bearing_deg, ref)
            self._save_locked()
            return True

    def set_motion(self, roc_id, heading=None, speed_kn=None):
        with self._lock:
            r = self._rocs.get(roc_id)
            if not r:
                return False
            r.set_motion(heading, speed_kn)
            self._save_locked()
            return True

    def confirm(self, roc_id):
        with self._lock:
            r = self._rocs.get(roc_id)
            if not r or r.lat is None:
                return False
            r.confirm()
            self._save_locked()
            return True

    def hold(self, roc_id):
        with self._lock:
            r = self._rocs.get(roc_id)
            if not r:
                return False
            r.hold()
            if self._home_id == roc_id:     # a held ROC is no longer a valid HOME
                self._home_id = None
            self._save_locked()
            return True

    def remove(self, roc_id):
        with self._lock:
            if roc_id in self._rocs:
                self._detach_gps_locked(roc_id)     # stop any GPS reader/child first
                del self._rocs[roc_id]
                if self._home_id == roc_id:
                    self._home_id = None
                self._save_locked()
                return True
            return False

    def feed(self, roc_id, lat, lon, cog=None, sog=None, source="push"):
        """The data-stream ingest: manual edits, the /api/roc push, and the sim
        steaming all land here."""
        with self._lock:
            r = self._rocs.get(roc_id)
            if not r:
                return False
            r.feed(lat, lon, cog=cog, sog=sog, source=source)
            return True

    def select_home(self, roc_id):
        """Only an ACTIVE (confirmed) ROC may be HOME."""
        with self._lock:
            r = self._rocs.get(roc_id)
            if not r or r.status != "active":
                return False
            self._home_id = roc_id
            self._save_locked()
            return True

    def clear_home(self):
        with self._lock:
            self._home_id = None
            self._save_locked()

    # -- read ------------------------------------------------------------------ #
    def active_home(self):
        """The selected ROC's current arrival point, or None. Called by the Engine
        every tick, so it must be cheap and never raise.

        ⚠ `link`/`age_s` ARE HERE FOR THE SAME REASON THEY ARE IN `home_intent`, and
        deliberately so even though both consoles now pull `home_intent` instead and
        this has no live caller. The two readers are near-identical, and an omission
        left in one of them is how the next person copies it back into the other."""
        with self._lock:
            now = time.monotonic()
            r = self._rocs.get(self._home_id)
            if not r:
                return None
            ap = r.arrival_point()
            if ap is None:
                return None
            return {"lat": ap[0], "lon": ap[1], "roc_id": r.id, "name": r.name,
                    "kind": r.kind, "moving": r.is_moving(),
                    "link": r.link_state(now),
                    "age_s": None if r.updated_at is None else round(now - r.updated_at, 1),
                    "closing_kn": round(r.closing_kn(), 2), "closable": r.closable()}

    def home_intent(self):
        """The console's HOME intent, resolved every tick by the Engine. None when
        no ROC is selected as HOME. `point` is the selected ROC's current arrival
        point (None if it has no fix yet). `moving` marks a steaming ship.

        ⚠ IT CARRIES THE LINK STATE, AND IT USED NOT TO. Nothing here clears a ROC
        when its feed stops: GpsFeed.run swallows the error and retries every 3 s
        for ever, `lat`/`lon` keep their last value, `is_moving()` stays True on
        `gps_attached`, and `arrival_point()` keeps answering. So the card the
        operator is looking at went red — `link_state` works and `to_dict` ships
        both fields — while the ONE thing the Engine pulls every tick was
        byte-identical to a live link. Measured with the NMEA feed cut at the
        socket: 20 s dead, the same `point`, `moving` still true, and the RTH note
        still reading "chasing Mothership (MOVING)" about a ship 40 m from where it
        says she is, growing at 123 m/min. The chase loop cannot rescue it either —
        it re-targets only when the point MOVES, and a frozen point never does.

        ⚠ AND `moving`/`closable` ARE DELIBERATELY UNCHANGED. A steaming ship with a
        dead link is still steaming; keying those off the link would silently re-word
        the MOVING tag and the overtake warning, which are claims about the SHIP.
        What was missing is the age of the evidence, so that is what was added — the
        consumer qualifies rather than refusing, because a 16 s dropout on a link
        that reconnects every 3 s must not take away the operator's recovery action.
        """
        with self._lock:
            now = time.monotonic()
            r = self._rocs.get(self._home_id)
            if not r:
                return None
            ap = r.arrival_point()
            return {"roc_id": r.id, "name": r.name, "kind": r.kind,
                    "moving": r.is_moving(),
                    "link": r.link_state(now),
                    "age_s": None if r.updated_at is None else round(now - r.updated_at, 1),
                    "closing_kn": round(r.closing_kn(), 2), "closable": r.closable(),
                    "point": None if ap is None else {"lat": ap[0], "lon": ap[1]}}

    def snapshot(self):
        with self._lock:
            now = time.monotonic()
            return {"rocs": [r.to_dict(now) for r in self._rocs.values()],
                    "home_id": self._home_id}

    # -- real GPS feed (NMEA) -------------------------------------------------- #
    @staticmethod
    def _free_port():
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        p = s.getsockname()[1]
        s.close()
        return p

    def _spawn_gps_sim(self, roc_id, host, port, r):
        """Auto-start a gps_sim.py child seeded from the ROC's position/motion, so a
        'real GPS feed' can be exercised with no hardware. Reaped via --parent-pid."""
        script = os.path.join(APP_DIR, "gps_sim.py")
        if not os.path.isfile(script):
            return False
        args = [sys.executable, script, "--host", host, "--port", str(port),
                "--lat", "%.6f" % (r.lat if r.lat is not None else 0.0),
                "--lon", "%.6f" % (r.lon if r.lon is not None else 0.0),
                "--heading", "%.1f" % (r.heading if r.kind == "ship" else 0.0),
                "--speed", "%.2f" % (r.speed_kn if r.kind == "ship" else 0.0),
                "--parent-pid", str(os.getpid())]
        logf = subprocess.DEVNULL
        if self._log_dir:
            try:
                os.makedirs(self._log_dir, exist_ok=True)
                logf = open(os.path.join(self._log_dir, "gps_sim_%s.log" % roc_id), "a",
                            encoding="utf-8")
            except OSError:
                logf = subprocess.DEVNULL
        try:
            self._gps_procs[roc_id] = subprocess.Popen(args, cwd=APP_DIR, stdout=logf,
                                                       stderr=subprocess.STDOUT)
        except Exception:
            return False
        return True

    def attach_gps(self, roc_id, host=None, port=None, udp=False, sim=False):
        """Point a ROC at a real GPS NMEA feed - its position comes off the wire. With
        sim=True (or no host), auto-spawn a gps_sim.py and connect to it. The ROC goes
        active (a live source is HOME-eligible)."""
        with self._lock:
            r = self._rocs.get(roc_id)
            if not r:
                return False
            self._detach_gps_locked(roc_id)
            spawned = False
            if sim or not host:
                host, udp = "127.0.0.1", False
                port = self._free_port()
                if not self._spawn_gps_sim(roc_id, host, port, r):
                    return False
                spawned = True
            r.gps_attached = True
            r.gps_host, r.gps_port, r.gps_udp, r.gps_spawned = host, int(port), bool(udp), spawned
            r.status = "active"
            feed = GpsFeed(self, roc_id, host, port, udp=udp)
            self._gps_feeds[roc_id] = feed
            feed.start()
            self._save_locked()
            return True

    def _detach_gps_locked(self, roc_id):
        feed = self._gps_feeds.pop(roc_id, None)
        if feed:
            feed.stop()
        proc = self._gps_procs.pop(roc_id, None)
        if proc and proc.poll() is None:
            try:
                proc.terminate()
            except Exception:
                pass
        r = self._rocs.get(roc_id)
        if r:
            r.gps_attached = r.gps_spawned = False
            r.gps_host = r.gps_port = None
            r.gps_udp = False
            if r.source == "gps":
                r.source = "manual"     # keep the last fed position, now a static/manual point
        return True

    def detach_gps(self, roc_id):
        with self._lock:
            ok = roc_id in self._rocs
            self._detach_gps_locked(roc_id)
            self._save_locked()
            return ok

    # -- sim steaming ---------------------------------------------------------- #
    def start_sim(self, period_s=1.0):
        """SIM ONLY. Steam every ACTIVE ship ROC on its own heading/speed on a
        background thread. Nothing is auto-seeded - the operator places ships and
        confirms them to start; this loop just advances the confirmed ones."""
        with self._lock:
            if self._sim_thread is not None:
                return
            self._sim_stop.clear()
            self._sim_thread = threading.Thread(target=self._sim_loop, args=(period_s,),
                                                daemon=True, name="roc-sim-ships")
            self._sim_thread.start()

    def _sim_loop(self, period_s):
        while not self._sim_stop.wait(period_s):
            with self._lock:
                ships = [r for r in self._rocs.values() if r.steaming()]
                for s in ships:
                    if s.lat is None:
                        continue
                    dist_m = s.speed_kn * KN_TO_MS * period_s
                    lat, lon = dest_point(s.lat, s.lon, s.heading, dist_m)
                    s.feed(lat, lon, cog=s.heading, sog=s.speed_kn, source="sim")

    def stop(self):
        self._sim_stop.set()
        t = self._sim_thread
        if t is not None:
            t.join(timeout=2.0)
        self._sim_thread = None
        with self._lock:                      # stop every GPS reader + spawned gps_sim child
            for rid in list(self._gps_feeds.keys()) + list(self._gps_procs.keys()):
                self._detach_gps_locked(rid)
