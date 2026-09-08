#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ASV Simulator Console - a browser-only command-and-control (C2) shore station
for a small-class remotely-operated / autonomous survey ASV (surface vehicle).

It is a self-contained autonomy console and simulator:
it plans a waypoint survey on a live NOAA-ENC chart, uploads that route to the
vehicle's onboard Vehicle Control Unit (VCU), and issues Start / Pause / Stop over the
telemetry link - while continuously displaying position, heading, speed, battery
voltage and autonomy state. Autonomous-only by design: live manual driving stays
on the RC transmitter, which remains the master control and failsafe at all times.

PHASE 0 (this file) - SIM-FIRST, NO HARDWARE, NO PROPRIETARY PROTOCOL
--------------------------------------------------------------------
The vehicle's shore-side control-link wire protocol is left unspecified in this
simulator (a real integration would supply the vendor's own frame format). So
this build is designed around a clean `VcuLink` seam with a fully-working
`SimVcu` simulator, exactly the way a companion stdlib console is built:
the entire UI, the command flow, and the whole safety model are exercised and
validated in simulation with nothing attached. `RealVcu` connects the transport
(serial-over-IP by default) for reachability but its command/telemetry codecs
are deliberately stubbed - they FAIL HONESTLY until a live serial capture of
the real vehicle <-> shore link lets us implement the format. See
PLAN.md for the phasing and the capture plan.

SAFETY MODEL
------------
  * The RC transmitter is master. Nothing here can disable Sw A or the RC E-stop.
    The UI says so permanently. This console is additive shore-side C2.
  * Arming gate on every actuating command; the console comes up SAFE and
    read-only. Commanding requires an explicit ARM each session.
  * Link-loss is safe: on dropout we stop issuing commands and surface the vehicle's
    own failsafe (motors to 0, steering straight). We never auto-resume.
  * Every command is validated/clamped before it is encoded (the "must not wedge
    the boat" rule); the real encoders raise rather than emit an uncertain frame.

Uses only stdlib-only infrastructure (local NOAA chart-tile cache, radio/Starlink
comms monitor, mission store, SSE) so
this file stands alone. Requires only the Python 3 standard library. Run it, it
opens a browser tab. See --help.
"""

import argparse
import atexit
import json
import math
import os
import queue
import re
import socket
import ssl
import subprocess
import sys
import threading
import time
import http.cookiejar
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import currents                            # NOAA OFS surface currents (vendored - see its header)
import roc_tracks                          # Remote Operations Center tracking + moving HOME

# --------------------------------------------------------------------------- #
#  Paths / constants                                                          #
# --------------------------------------------------------------------------- #
APP_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(APP_DIR, "static")
CHART_DIR = os.path.join(APP_DIR, "charts")
MISSION_PATH = os.path.join(APP_DIR, "mission.json")
COMMS_CONFIG_PATH = os.path.join(APP_DIR, "comms_config.json")
# Session recordings: every command / setting / action + a telemetry trace, one
# per server run, written as append-only JSONL for a future playback mode.
LOG_DIR = os.path.join(APP_DIR, "logs")
# Per-vessel configuration files (one self-contained JSON per modeled ASV). The
# active vessel supplies every hull/propulsion/maneuvering/power parameter the
# simulator and the UI use, so those values live in ONE place (the vessel file)
# instead of being hardcoded and duplicated across server and client.
VESSELS_DIR = os.path.join(APP_DIR, "vessels")
PORTS_PATH = os.path.join(APP_DIR, "ports.json")
# THE SHIPPED SEED, SEPARATE FROM THE LIVE REGISTRY. ports.json carries the operator's OWN
# state - the bases they added and the one they are working from - so it is gitignored and
# ports.default.json is what the repository ships. Keeping both in ONE tracked file meant an
# operator simply USING the console dirtied the repo, and worse: a suite that seeded itself
# from that file inherited whoever's base happened to be active, so a check on the shipped
# defaults failed the moment someone worked from a different port. Same separation the ROC
# registry needed, for the same reason.
PORTS_DEFAULT_PATH = os.path.join(APP_DIR, "ports.default.json")
# The DriX at Lewes is the working default: it is the vessel actually being operated,
# and the default decides more than the hull. The AIS service subscribes to a box around
# the THEN-CURRENT spawn at startup, so a default that spawns elsewhere leaves the
# traffic layer scoped to the wrong water until a vessel switch re-scopes it.
DEFAULT_VESSEL_ID = "drix08"
# Unique per server run. Sent in every state so the browser can tell a page refresh
# (same run - keep the trail) from a reboot (new run - drop the stale trail; the run
# is in the session logs). Changes on every restart.
BOOT_ID = "%d-%d" % (os.getpid(), int(time.time() * 1000))

# 8791 (not 8781) so this simulator never collides with the branded sibling console it
# was derived from - both default to their own port and can run side by side.
DEFAULT_WEB_PORT = 8791
# Base URL of the standalone AIS provider service (ais_service.py). The console
# proxies it at /api/ais; override with --ais. The AIS layer is opt-in in the UI.
AIS_BASE = "http://127.0.0.1:8788"
# What the auto-started service is told to run (--ais-source / --ais-nmea /
# --ais-opencpn pass-throughs). Module globals, not locals of main(), because
# _rescope_ais_service() rebuilds the child after a vessel switch and must
# reproduce the SAME source configuration, not fall back to a default.
AIS_SOURCE_ARG = "auto"
AIS_NMEA_SPECS = []            # e.g. ["udp:10110", "tcp:127.0.0.1:2000"]
AIS_OPENCPN = ""               # "[HOST:]PORT" for --source ...,opencpn
# AIS display radius at sea (km). On a Great Lake the whole lake is used instead, so this
# only applies to open water. Configurable because feed coverage is wildly uneven: the
# aisstream receivers near the Delaware Bay are inland, so at Lewes a 50 km radius sees
# ~1 vessel while the traffic sits 60-120 km up-river. Set with --ais-radius-km; it scales
# BOTH the service subscription and the display query, which have to move together.
# TWO RADII, deliberately decoupled (2026-08-02, Andy's call).
#   COLLECT is what the AIS service SUBSCRIBES to. Wide and fixed, set once at boot.
#   SHOW    is what the operator wants to look at. Narrow, and changed live from the card.
# They used to be one value, so widening the view meant restarting the child process to
# re-subscribe - and the invariant "they must move together" existed only because of that
# coupling. Collecting wide and filtering narrow removes the invariant entirely: the data
# for any radius up to COLLECT is already in hand, so a range change is instant and cannot
# out-run the subscription.
# NOT APPLIED ON A GREAT LAKE. There the area is the whole lake and EVERY contact is shown,
# because "50 km of Lake Erie" is not a useful thing to ask for.
AIS_COLLECT_RADIUS_KM = 150.0
AIS_SHOW_RADIUS_KM = 50.0
# Serial-over-IP default for the VCU control link (PortServer-style). The real
# address depends on the boat's radio/serial-server config; override on the CLI.
DEFAULT_VCU_HOST = ""
DEFAULT_VCU_PORT = 4001

STARLINK_HOST, STARLINK_PORT = "192.168.100.1", 9200

def clamp(v, lo, hi):
    return lo if v < lo else hi if v > hi else v


# --------------------------------------------------------------------------- #
#  Vessel configuration - the single source of truth for a modeled ASV        #
# --------------------------------------------------------------------------- #
# Every vessel-specific parameter (hull/windage, speeds, turn rate, guidance
# gains, battery banding + drain, planning defaults, spawn) is loaded from a
# self-contained vessels/<id>.json and applied to the module globals below via
# apply_vessel(). SimVcu, the mission store and the UI all read these globals /
# the served /api/vessel, so a vessel is defined in exactly one file. Swap the
# active vessel with --vessel <id> (or POST /api/vessel) to study another ASV.

# Globals filled by apply_vessel() (defaults are placeholders, overwritten at
# import once the default vessel is loaded).
BATT_FULL_V = BATT_WARN_V = BATT_CRIT_V = BATT_EMPTY_V = 0.0
SPEED_KN = {}
WP_APPROACH_M = WP_LOOKAHEAD_M = 0.0
XTE_KI_DEG = XTE_I_MAX_DEG = 0.0
BOAT_LEN_M = BOAT_BEAM_M = BOAT_ABOVE_H = BOAT_DRAFT_M = 0.0
WIND_CD = HULL_CD = WIND_A_SIDE = WIND_A_FRONT = HULL_A_LAT = 0.0
# None until a vessel with a coast datum is applied. None means this hull does not coast.
COAST_LENGTH_M = None
MAX_TURN_RATE_DEG_S = 60.0
# Energy model: "battery" (draining voltage) or "fuel" (diesel litres burned).
POWER_TYPE = "battery"
DRAIN_IDLE = DRAIN_LOAD = 0.0                            # battery: per-second voltage drain
FUEL_CAPACITY_L = 0.0                                    # fuel: tank size (L)
FUEL_BURN_IDLE = FUEL_BURN_FULL = 0.0                    # fuel: L/h at idle vs at top speed
FUEL_BURN_EXP = 3.0                                      # fuel: burn ~ idle + (full-idle)*(v/vmax)^exp
FUEL_WARN_FRAC = 0.25
FUEL_CRIT_FRAC = 0.10
SPAWN_LAT = SPAWN_LON = 0.0
# --------------------------------------------------------------------------- #
#  OPERATING PORTS                                                            #
# --------------------------------------------------------------------------- #
# A PORT IS WHERE YOU ARE; THE VESSEL IS WHAT YOU ARE DRIVING. They were one thing
# until now - each vessel file carried its own `spawn`, so choosing the DriX chose
# Lewes - which meant the console could not be pointed at a different base without
# editing a hull's configuration, and the chart opened on a hard-coded Erie centre
# that belonged to neither. Andy, 2026-08-15: "change initialization to select port
# and ASV. the ASV selection is a good model."
#
# So ports are a registry of their own, in the SAME shape as the vessel picker:
# a list, an active id, and a switch that only happens when it is safe. The vessel's
# own `spawn` remains the FALLBACK for a console with no port selected, so nothing
# that already worked stops working.
#
# ENTRIES THE OPERATOR ADDS ARE RETAINED. `ports.json` is written back, so a base
# typed once is in the dropdown for good - the "retained values" half of the ask.
PORTS = {"active": None, "ports": []}
PORT_ID_RE = re.compile(r"[^a-z0-9]+")


def _port_id(name):
    """A stable id from a display name: "New Castle, NH" -> "new_castle_nh"."""
    return PORT_ID_RE.sub("_", (name or "").strip().lower()).strip("_") or "port"


def validate_port(p, source="port"):
    """Raise ValueError unless `p` is a usable port. Same spirit as validate_vessel:
    a malformed entry is refused at the door, not discovered when the boat spawns
    in the Gulf of Guinea because a latitude was a string."""
    if not isinstance(p, dict):
        raise ValueError("%s: must be a JSON object" % source)
    name = (p.get("name") or "").strip()
    if not name:
        raise ValueError("%s: needs a name" % source)
    try:
        lat = float(p["lat"]); lon = float(p["lon"])
    except (KeyError, TypeError, ValueError):
        raise ValueError("%s: needs numeric lat and lon" % source)
    # NaN fails every comparison, so this rejects it too - the same guard set_home needs.
    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
        raise ValueError("%s: lat/lon off the globe (%r, %r)" % (source, lat, lon))
    # A BASE DECLARES ITS OWN FORECAST MODEL. A NOAA OFS is REGIONAL: dbofs stops at the
    # Delaware, so a console pointed at New Castle NH under the dbofs default asked for a
    # box the model does not contain and logged a failure every poll (caught by
    # data_routes check 13 the first time this shipped). The model belongs to the PLACE.
    # Blank = fall back to whatever --currents-ofs says.
    return {"id": (p.get("id") or _port_id(name)), "name": name,
            "lat": lat, "lon": lon, "ofs": (p.get("ofs") or "").strip().lower(),
            "note": (p.get("note") or "").strip()}


# --------------------------------------------------------------------------- #
#  Finding a port BY NAME                                                     #
# --------------------------------------------------------------------------- #
# Andy, 2026-08-28: "The position function is not just to memorize a manually found
# spot, but to initialize a survey area from the name entered. it would require
# internet access to identify a survey home port like Nome, Alaska and then the chart
# goes there."
#
# So a base can be created from a PLACE NAME. Two steps, and the second is the one that
# matters:
#
#   1. GEOCODE the name (OpenStreetMap Nominatim - keyless, global, stdlib).
#   2. SNAP THE RESULT TO CHARTED NAVIGABLE WATER, because a geocoder returns the centre
#      of a TOWN and a town centre is on LAND. "Nome, Alaska" resolves to 64.4975,
#      -165.4062 - a street corner. Taking that as a survey home port would spawn the
#      boat inland and refuse every route out of it, which is exactly the failure the
#      seeded New Castle position hit (a pierside guess that sat in a charted 1.8 m area,
#      inside the DriX's floor).
#
# The snap searches the ENC's own depth areas for the nearest water deep enough for THIS
# vessel, so the answer is a berth the boat can actually sit in rather than a coordinate
# that merely looks coastal. Everything degrades in the open: no geocoder, no chart, or
# no deep-enough water each come back saying so, and the un-snapped place centre is still
# offered - the operator can drag the chart and save the view instead.
GEOCODER = "https://nominatim.openstreetmap.org/search"
_GEO_CACHE = {}


def geocode_place(name, timeout=20.0):
    """(lat, lon, display_name) for a place name, or None. Never raises.

    Nominatim asks callers to identify themselves and to keep the rate modest; the
    console asks once per port the operator adds, and caches, so it is a well-behaved
    client by construction rather than by promise."""
    key = (name or "").strip().lower()
    if not key:
        return None
    if key in _GEO_CACHE:
        return _GEO_CACHE[key]
    url = GEOCODER + "?" + urllib.parse.urlencode(
        {"q": name, "format": "json", "limit": 1})
    req = urllib.request.Request(url, headers={
        "User-Agent": "asv-console/1.0 (survey ASV shore station; operating-port lookup)",
        "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            hits = json.loads(r.read().decode("utf-8", "replace"))
    except Exception as e:
        print("[ports] geocoder unreachable: %s: %s" % (type(e).__name__, e),
              file=sys.stderr)
        return None
    if not hits:
        _GEO_CACHE[key] = None
        return None
    h = hits[0]
    try:
        out = (float(h["lat"]), float(h["lon"]), h.get("display_name") or name)
    except (KeyError, TypeError, ValueError):
        return None
    _GEO_CACHE[key] = out
    return out


def _rings_of(geom):
    """Every polygon ring in a GeoJSON geometry, as [[lon,lat], ...] lists."""
    if not isinstance(geom, dict):
        return []
    t, co = geom.get("type"), geom.get("coordinates") or []
    if t == "Polygon":
        return [r for r in co if isinstance(r, list)]
    if t == "MultiPolygon":
        return [r for poly in co if isinstance(poly, list)
                for r in poly if isinstance(r, list)]
    return []


def _in_ring(ring, lat, lon):
    inside = False
    n = len(ring)
    for i in range(n):
        try:
            x1, y1 = ring[i][0], ring[i][1]
            x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        except (TypeError, IndexError):
            return False
        if (y1 > lat) != (y2 > lat):
            xin = (x2 - x1) * (lat - y1) / ((y2 - y1) or 1e-12) + x1
            if lon < xin:
                inside = not inside
    return inside


def snap_to_water(lat, lon, min_depth, radius_km=12.0, timeout=90.0):
    """Nearest charted water at least `min_depth` deep, as {lat, lon, depth_m, note},
    or a dict explaining why not. Never raises.

    Searches the ENC's depth areas around the point and walks OUTWARD in rings, so the
    berth chosen is the closest usable water rather than the first polygon in the file.
    """
    d = min(0.35, max(0.05, radius_km / 111.0))
    try:
        data = fetch_enc_features((lon - d, lat - d, lon + d, lat + d), min_depth)
    except Exception as e:
        return {"ok": False, "note": "no chart here (%s)" % type(e).__name__}
    areas = [f for f in (data.get("features") or []) if f.get("role") == "depth_area"]
    if not areas:
        return {"ok": False, "note": "no charted depth areas within %.0f km" % radius_km}
    # deep-enough polygons only; DRVAL1 is the shoalest depth in the area
    deep = []
    for f in areas:
        p = f.get("props") or {}
        try:
            drval1 = float(p.get("DRVAL1"))
        except (TypeError, ValueError):
            continue
        if drval1 >= min_depth:
            deep.append((drval1, f))
    if not deep:
        return {"ok": False,
                "note": "nothing charted deeper than %.1f m within %.0f km" % (min_depth, radius_km)}
    # the point itself may already be in deep water - check before moving anything
    for drval1, f in deep:
        for ring in _rings_of(f.get("geometry")):
            if _in_ring(ring, lat, lon):
                return {"ok": True, "lat": lat, "lon": lon, "depth_m": drval1,
                        "moved_m": 0.0, "note": "already in charted %.1f m water" % drval1}
    # else walk outward: sample rings of increasing radius and take the first hit
    mlat = 111320.0
    mlon = 111320.0 * math.cos(math.radians(lat))
    best = None
    for step_m in range(200, int(radius_km * 1000) + 1, 200):
        for k in range(36):                       # every 10 degrees
            a = math.radians(k * 10)
            tlat = lat + (step_m * math.cos(a)) / mlat
            tlon = lon + (step_m * math.sin(a)) / (mlon or 1e-9)
            for drval1, f in deep:
                for ring in _rings_of(f.get("geometry")):
                    if _in_ring(ring, tlat, tlon):
                        best = {"ok": True, "lat": round(tlat, 6), "lon": round(tlon, 6),
                                "depth_m": drval1, "moved_m": float(step_m),
                                "note": "moved %.0f m to charted %.1f m water"
                                        % (step_m, drval1)}
                        break
                if best:
                    break
            if best:
                break
        if best:
            break
    return best or {"ok": False,
                    "note": "no water deeper than %.1f m found within %.0f km"
                            % (min_depth, radius_km)}


def load_ports():
    """Read ports.json into PORTS. Never raises: a missing or corrupt registry leaves
    the console working off the vessel's own spawn rather than refusing to start."""
    global PORTS
    path = PORTS_PATH
    if not os.path.exists(path) and os.path.exists(PORTS_DEFAULT_PATH):
        path = PORTS_DEFAULT_PATH        # first run: start from what the repo ships
    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)
    except (OSError, ValueError) as e:
        print("[ports] %s unreadable (%s) - falling back to the vessel spawn"
              % (os.path.basename(PORTS_PATH), e), file=sys.stderr)
        PORTS = {"active": None, "ports": []}
        return PORTS
    out = []
    for i, p in enumerate(raw.get("ports") or []):
        try:
            out.append(validate_port(p, "ports.json[%d]" % i))
        except ValueError as e:      # one bad row must not cost the whole registry
            print("[ports] skipping %s" % e, file=sys.stderr)
    ids = [p["id"] for p in out]
    active = raw.get("active")
    PORTS = {"active": active if active in ids else (ids[0] if ids else None), "ports": out}
    return PORTS


def save_ports():
    """Persist the registry - this is what makes an operator's own port RETAINED."""
    try:
        tmp = PORTS_PATH + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump({"active": PORTS["active"], "ports": PORTS["ports"]}, f, indent=2)
            f.write(chr(10))
        os.replace(tmp, PORTS_PATH)          # atomic: never a half-written registry
        return True
    except OSError as e:
        print("[ports] could not save: %s" % e, file=sys.stderr)
        return False


def active_port():
    for p in PORTS.get("ports") or []:
        if p["id"] == PORTS.get("active"):
            return p
    return None


def apply_port():
    """Point the sim spawn at the active port. Called after apply_vessel (which sets
    SPAWN from the hull file) so the PORT WINS when one is selected - the vessel's own
    spawn is only the fallback."""
    global SPAWN_LAT, SPAWN_LON
    p = active_port()
    if p:
        SPAWN_LAT, SPAWN_LON = p["lat"], p["lon"]
        # ... and the current forecast follows the base to its own regional model.
        # CURRENTS may not exist yet, given import ordering.
        if p.get("ofs") and "CURRENTS" in globals():
            CURRENTS.set_ofs(p["ofs"])
    return p

ARRIVAL_DEFAULT_M = 2.0
NOGO_BUFFER_DEFAULT_M = 3.0
UNDER_KEEL_CLEARANCE_M = 0.9
# Minimum navigable water depth (m) for the active vessel = draft + under-keel
# clearance. Water shallower than this is nogo. The client reads it via /api/vessel
# and rebuilds the nogo model on a vessel switch, so a deep-draft boat avoids more.
MIN_NAV_DEPTH_M = 1.0

# The active vessel (parsed dict). Set by apply_vessel().
VESSEL = None

# Schema for validation: (dotted path, python type). Every one is required; a
# missing key or wrong type makes the vessel file load fail with a clear error
# so a malformed profile never silently runs with placeholder physics.
_VESSEL_SCHEMA = [
    ("id", str), ("name", str),
    ("hull.loa_m", (int, float)), ("hull.beam_m", (int, float)),
    ("hull.above_water_h_m", (int, float)), ("hull.draft_m", (int, float)),
    ("hull.wind_cd", (int, float)), ("hull.hull_cd", (int, float)),
    ("propulsion.speeds_kn.low", (int, float)),
    ("propulsion.speeds_kn.survey", (int, float)),
    ("propulsion.speeds_kn.high", (int, float)),
    ("maneuvering.max_turn_rate_deg_s", (int, float)),
    ("maneuvering.approach_m", (int, float)),
    ("maneuvering.lookahead_m", (int, float)),
    ("maneuvering.arrival_radius_m", (int, float)),
    ("autopilot.xte_ki_deg", (int, float)),
    ("autopilot.xte_i_max_deg", (int, float)),
    ("planning.nogo_buffer_m", (int, float)),
    ("planning.under_keel_clearance_m", (int, float)),
    ("spawn.lat", (int, float)), ("spawn.lon", (int, float)),
]

# The `power` block is validated conditionally on power.type (see validate_vessel).
_POWER_BATTERY_SCHEMA = [
    ("power.battery_v.full", (int, float)), ("power.battery_v.warn", (int, float)),
    ("power.battery_v.crit", (int, float)), ("power.battery_v.empty", (int, float)),
    ("power.drain.idle", (int, float)), ("power.drain.load", (int, float)),
]
_POWER_FUEL_SCHEMA = [
    ("power.fuel.capacity_l", (int, float)),
    ("power.fuel.burn_lph_idle", (int, float)), ("power.fuel.burn_lph_full", (int, float)),
    ("power.fuel.burn_exp", (int, float)),
    ("power.fuel.warn_frac", (int, float)), ("power.fuel.crit_frac", (int, float)),
]


def _dig(d, path):
    """Fetch a dotted path from nested dicts; raise KeyError if any hop missing."""
    cur = d
    for key in path.split("."):
        if not isinstance(cur, dict) or key not in cur:
            raise KeyError(path)
        cur = cur[key]
    return cur


def _check_fields(v, schema, source):
    for path, typ in schema:
        try:
            val = _dig(v, path)
        except KeyError:
            raise ValueError("%s: missing required field '%s'" % (source, path))
        if isinstance(val, bool) or not isinstance(val, typ):
            names = typ.__name__ if isinstance(typ, type) else "/".join(t.__name__ for t in typ)
            raise ValueError("%s: field '%s' must be %s (got %r)" % (source, path, names, val))


def validate_vessel(v, source="<vessel>"):
    """Raise ValueError with a clear, path-pointed message if v is malformed."""
    if not isinstance(v, dict):
        raise ValueError("%s: vessel config must be a JSON object" % source)
    _check_fields(v, _VESSEL_SCHEMA, source)
    # Energy model: power.type selects which sub-block is required. Default
    # "battery" when absent (back-compat with the earliest profiles).
    ptype = v.get("power", {}).get("type", "battery") if isinstance(v.get("power"), dict) else None
    if ptype not in ("battery", "fuel"):
        raise ValueError("%s: power.type must be 'battery' or 'fuel' (got %r)" % (source, ptype))
    if ptype == "battery":
        _check_fields(v, _POWER_BATTERY_SCHEMA, source)
        b = v["power"]["battery_v"]
        if not (b["full"] > b["warn"] > b["crit"] > b["empty"]):
            raise ValueError("%s: power.battery_v must satisfy full > warn > crit > empty" % source)
    else:
        _check_fields(v, _POWER_FUEL_SCHEMA, source)
        f = v["power"]["fuel"]
        if f["capacity_l"] <= 0:
            raise ValueError("%s: power.fuel.capacity_l must be > 0" % source)
        if not (0 <= f["crit_frac"] < f["warn_frac"] <= 1):
            raise ValueError("%s: power.fuel requires 0 <= crit_frac < warn_frac <= 1" % source)
    return v


def vessel_path(vessel_id):
    return os.path.join(VESSELS_DIR, "%s.json" % vessel_id)


def load_vessel(vessel_id):
    """Read + validate vessels/<id>.json. Raises ValueError/OSError on failure."""
    path = vessel_path(vessel_id)
    with open(path, "r", encoding="utf-8") as f:
        try:
            v = json.load(f)
        except ValueError as e:
            raise ValueError("%s: invalid JSON (%s)" % (os.path.basename(path), e))
    return validate_vessel(v, source=os.path.basename(path))


def list_vessels():
    """[{id,name,class}] for every valid vessels/*.json (invalid ones skipped)."""
    out = []
    try:
        names = sorted(n for n in os.listdir(VESSELS_DIR) if n.endswith(".json"))
    except OSError:
        return out
    for name in names:
        try:
            with open(os.path.join(VESSELS_DIR, name), "r", encoding="utf-8") as f:
                v = json.load(f)
            validate_vessel(v, source=name)
            out.append({"id": v["id"], "name": v["name"], "class": v.get("class", "")})
        except (OSError, ValueError):
            continue
    return out


def apply_vessel(v):
    """Publish a validated vessel dict to the module globals SimVcu/UI read."""
    global VESSEL, BATT_FULL_V, BATT_WARN_V, BATT_CRIT_V, BATT_EMPTY_V, SPEED_KN
    global WP_APPROACH_M, WP_LOOKAHEAD_M, XTE_KI_DEG, XTE_I_MAX_DEG
    global BOAT_LEN_M, BOAT_BEAM_M, BOAT_ABOVE_H, BOAT_DRAFT_M, WIND_CD, HULL_CD
    global WIND_A_SIDE, WIND_A_FRONT, HULL_A_LAT, MAX_TURN_RATE_DEG_S, DRAIN_IDLE, DRAIN_LOAD
    global COAST_LENGTH_M
    global SPAWN_LAT, SPAWN_LON, ARRIVAL_DEFAULT_M, NOGO_BUFFER_DEFAULT_M
    global POWER_TYPE, FUEL_CAPACITY_L, FUEL_BURN_IDLE, FUEL_BURN_FULL, FUEL_BURN_EXP
    global FUEL_WARN_FRAC, FUEL_CRIT_FRAC, UNDER_KEEL_CLEARANCE_M, MIN_NAV_DEPTH_M
    VESSEL = v
    h, p, m, a = v["hull"], v["propulsion"], v["maneuvering"], v["autopilot"]
    pw, pl, sp = v["power"], v["planning"], v["spawn"]
    POWER_TYPE = pw.get("type", "battery")
    if POWER_TYPE == "battery":
        BATT_FULL_V = float(pw["battery_v"]["full"]); BATT_WARN_V = float(pw["battery_v"]["warn"])
        BATT_CRIT_V = float(pw["battery_v"]["crit"]); BATT_EMPTY_V = float(pw["battery_v"]["empty"])
        DRAIN_IDLE = float(pw["drain"]["idle"]); DRAIN_LOAD = float(pw["drain"]["load"])
    else:                                                      # fuel (diesel)
        fu = pw["fuel"]
        FUEL_CAPACITY_L = float(fu["capacity_l"])
        FUEL_BURN_IDLE = float(fu["burn_lph_idle"]); FUEL_BURN_FULL = float(fu["burn_lph_full"])
        FUEL_BURN_EXP = float(fu["burn_exp"])
        FUEL_WARN_FRAC = float(fu["warn_frac"]); FUEL_CRIT_FRAC = float(fu["crit_frac"])
    SPEED_KN = {k: float(pk) for k, pk in p["speeds_kn"].items()}
    WP_APPROACH_M = float(m["approach_m"]); WP_LOOKAHEAD_M = float(m["lookahead_m"])
    MAX_TURN_RATE_DEG_S = float(m["max_turn_rate_deg_s"])
    ARRIVAL_DEFAULT_M = float(m["arrival_radius_m"])
    XTE_KI_DEG = float(a["xte_ki_deg"]); XTE_I_MAX_DEG = float(a["xte_i_max_deg"])
    BOAT_LEN_M = float(h["loa_m"]); BOAT_BEAM_M = float(h["beam_m"])
    BOAT_ABOVE_H = float(h["above_water_h_m"]); BOAT_DRAFT_M = float(h["draft_m"])
    WIND_CD = float(h["wind_cd"]); HULL_CD = float(h["hull_cd"])
    WIND_A_SIDE = BOAT_LEN_M * BOAT_ABOVE_H      # beam-on windage silhouette (m^2)
    WIND_A_FRONT = BOAT_BEAM_M * BOAT_ABOVE_H    # bow/stern-on windage silhouette (m^2)
    HULL_A_LAT = BOAT_LEN_M * BOAT_DRAFT_M       # underwater lateral area (m^2), for leeway drag
    # THE HULL'S COAST LENGTH, or None when this vessel carries no coast datum - which is the
    # honest degrade, and the default: two of the three shipped hulls have none and so do not
    # coast at all.
    #
    # ⚠ HULL_CD AND HULL_A_LAT ABOVE ARE LATERAL QUANTITIES AND ARE NOT THIS. Pressed into
    # service fore-and-aft they give the DriX a 1.6 m stopping distance, out by a factor of
    # fifteen. Nor can Lc be inferred from the hull box: this hull's block coefficient is
    # 0.109 (its 2.0 m "draft" is a slender strut, not a beam of water), so loa*beam*draft
    # overstates the displacement ninefold. It has to be a measurement, and the vessel file
    # says so in its own `source` string.
    _c = m.get("coast") or {}
    try:
        COAST_LENGTH_M = (float(_c["distance_m"]) / math.log(float(_c["from_kn"]) / float(_c["to_kn"]))
                          if float(_c.get("from_kn", 0)) > float(_c.get("to_kn", 0)) > 0
                          and float(_c.get("distance_m", 0)) > 0 else None)
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        COAST_LENGTH_M = None
    NOGO_BUFFER_DEFAULT_M = float(pl["nogo_buffer_m"])
    UNDER_KEEL_CLEARANCE_M = float(pl["under_keel_clearance_m"])
    MIN_NAV_DEPTH_M = BOAT_DRAFT_M + UNDER_KEEL_CLEARANCE_M   # water shallower than this is nogo
    SPAWN_LAT = float(sp["lat"]); SPAWN_LON = float(sp["lon"])
    # ROC defaults are vessel-dependent too (astern-recovery standoff scales with the
    # hull; the closing check needs the boat's top speed). Re-derived HERE so a LIVE
    # vessel switch updates them - the module-global staleness trap that bit HULL_A_LAT.
    roc_tracks.configure_vessel(v)
    # THE PORT HAS THE LAST WORD on where the sim starts. apply_vessel has just
    # set SPAWN from the hull file; if a port is selected it overrides, because the
    # operator chose a BASE and a BOAT separately and the base is the location.
    apply_port()
    return v


# Load the default vessel at import so every module global is populated before
# any class method or the mission store reads it. --vessel overrides in main().
load_ports()                      # before the first apply_vessel: the boot spawn
apply_vessel(load_vessel(DEFAULT_VESSEL_ID))


# --------------------------------------------------------------------------- #
#  Session recorder (JSONL event log -> future playback)                      #
# --------------------------------------------------------------------------- #
# Append-only, line-delimited JSON recorder for the whole console session. It is
# the single record that a future "playback" mode replays. Two intertwined
# streams land in one time-ordered file:
#   * every COMMAND / SETTING / ACTION - each POST the console receives (arm,
#     upload, start/pause/stop, e-stop, goto/hold/rth/transit, sethome, approach,
#     connect/disconnect, mission edits, comms + water-level settings) with its
#     input body and outcome code. This is the explicit "record everything the
#     operator did" the log exists for; secrets are redacted.
#   * a TELEMETRY / STATE trace - the same state snapshots the browser sees over
#     SSE: a full snapshot on every salient transition (armed/run/behavior/link/
#     note/wp...) plus a slim ~1 Hz motion sample (position/heading/speed/battery)
#     in between, so playback can reconstruct where the boat actually went.
# Works for BOTH the sim and a real VCU link - it taps the Engine/HTTP layer, not
# SimVcu - so "logging in the sim, and by extension the active console" is one and
# the same mechanism. Best-effort by construction: any logging failure is
# swallowed so the recorder can never disturb the C2 path.

def _redact(body):
    """Copy a request body with secrets masked (comms password)."""
    if isinstance(body, dict) and body.get("password"):
        b = dict(body)
        b["password"] = "***"
        return b
    return body


class SessionLogger:
    # top-level state fields whose change marks a "salient" transition worth a
    # full snapshot (vs. a routine motion sample between transitions).
    SALIENT = ("mode", "link", "armed", "estop", "plan_uploaded", "run",
               "autonomy", "behavior", "completion", "wp_index", "wp_total",
               "note", "home")
    STATE_MIN_INTERVAL = 1.0        # s: cap the between-transition motion trace
    # `speed_key` rides the motion trace, not just the salient snapshots, so a playback
    # can put COMMANDED speed alongside the speed actually made good. (A live speed change
    # is salient anyway - it sets `note`, which is in SALIENT above - but the trace is what
    # lets you see the boat accelerating onto the new command.)
    TELEM_FIELDS = ("lat_deg", "lon_deg", "heading_deg", "cog_deg", "sog_kn", "speed_key",
                    "battery_v", "battery_pct", "battery_state", "holding", "laps")

    def __init__(self, enabled=True, log_dir=LOG_DIR):
        self._lock = threading.Lock()
        self._f = None
        self.path = None
        self.session_id = None
        self.enabled = bool(enabled)
        self._last_salient = None
        self._last_state_t = 0.0
        if self.enabled:
            try:
                os.makedirs(log_dir, exist_ok=True)
                self.session_id = time.strftime("%Y%m%d-%H%M%S")
                self.path = os.path.join(log_dir, "asv_%s.jsonl" % self.session_id)
                # line-buffered append: each event is on disk immediately, so a
                # crash / kill still leaves a complete record up to the last line.
                self._f = open(self.path, "a", encoding="utf-8", buffering=1)
            except OSError:
                self.enabled = False
                self._f = None

    def _write(self, kind, payload):
        if not self.enabled or self._f is None:
            return
        rec = {"t": round(time.time(), 3),
               "iso": time.strftime("%Y-%m-%dT%H:%M:%S"),
               "kind": kind}
        if payload:
            rec.update(payload)
        try:
            line = json.dumps(rec, default=str) + "\n"
            with self._lock:
                if self._f is not None:
                    self._f.write(line)
        except (OSError, ValueError, TypeError):
            pass

    def event(self, kind, **payload):
        """Record a lifecycle marker (session_start/end, connect, disconnect)."""
        self._write(kind, payload)

    def command(self, path, body, code, error=None):
        """Record one received command/setting/action + its outcome."""
        p = {"path": path, "body": _redact(body), "code": code}
        if error:
            p["error"] = error
        self._write("command", p)

    def state(self, event):
        """Record a state snapshot: full on any salient transition, else a
        throttled slim motion sample. Called on every Engine state publish."""
        if not self.enabled or self._f is None:
            return
        try:
            salient = tuple(event.get(k) for k in self.SALIENT)
        except Exception:
            return
        now = time.time()
        if salient != self._last_salient:
            self._last_salient = salient
            self._last_state_t = now
            self._write("state", {"state": event})
        elif (now - self._last_state_t) >= self.STATE_MIN_INTERVAL:
            self._last_state_t = now
            st = event.get("status") or {}
            self._write("telemetry", {
                "run": event.get("run"),
                "wp_index": event.get("wp_index"),
                "status": {k: st.get(k) for k in self.TELEM_FIELDS if k in st},
            })

    def close(self):
        with self._lock:
            if self._f is not None:
                try:
                    self._f.close()
                except OSError:
                    pass
                self._f = None


# The live recorder. Created in main() (so --help / --fetch-charts don't spawn a
# log file); None-guarded everywhere it is used.
LOG = None


# --------------------------------------------------------------------------- #
#  Mission store (waypoints + planned survey lines + run params)              #
# --------------------------------------------------------------------------- #
# Shared with the browser and persisted across restarts so a plan made at the
# dock is there at sea. `arrival_radius_m` and `speed` are the run parameters the
# VCU route plan needs: arrival radius ~5 m default, speed
# one of Low / Survey / High.
_mission_lock = threading.Lock()


def _cache_plan_completion(v):
    """Validate an end-of-plan value and refresh the cache. Every mission read and write
    funnels through here, so `plan_completion()` cannot drift from what is on disk."""
    global _PLAN_COMPLETION
    _PLAN_COMPLETION = v if v in ("complete", "loiter", "repeat", "rth") else "rth"
    return _PLAN_COMPLETION


# --------------------------------------------------------------------------- #
#  SPEED BY ROLE: transit, turn, survey                                        #
# --------------------------------------------------------------------------- #
# Andy, 2026-08-31: "Vessel speed should be selectable for various modes. Allow
# separate speed selection for transits, turns, and survey. These values may be
# temporarily over-ridden for safety of vessel situations."
#
# A survey run is three different jobs and they do not want the same speed. The
# coverage lines want the speed the SENSOR is specified at; the reversals between
# them want a speed whose turn radius the hull can hold - and a slower turn reaches
# LESS FAR outboard, which is exactly what the wharf incident earlier the same day
# was about; the transits out and home want whatever wastes least time.
#
# ⚠ `speeds` IS THE OPERATOR'S SETTING, AND `speed` BESIDE IT IS WHAT THE BOAT IS
# COMMANDED RIGHT NOW. Two fields on purpose. The console GOVERNS speed as the run
# moves between the three jobs and the clearance guard overrides all of it, so the
# commanded value changes several times a minute; folding that back into the
# operator's setting is the "two places holding one intent" fault this repo already
# learned from the completion field (see plan_completion), and here it would quietly
# eat the operator's choice.
SPEED_ROLES = ("transit", "turn", "survey")


def _norm_speeds(raw, fallback="survey"):
    """Three role speeds, each a key the active vessel actually has.

    A missing or unknown role falls back - to the legacy single `speed` when the
    mission file predates this, which is what makes the upgrade a no-op: all three
    start exactly where the one used to be, so nobody's boat changes speed because
    they pulled a new build.
    """
    out = {}
    for role in SPEED_ROLES:
        v = (raw or {}).get(role)
        out[role] = v if (isinstance(v, str) and (not SPEED_KN or v in SPEED_KN)) else fallback
    return out


def load_mission():
    try:
        with open(MISSION_PATH, "r", encoding="utf-8") as f:
            m = json.load(f)
        if isinstance(m, dict):
            return {
                "waypoints": m.get("waypoints") or [],
                "lines": m.get("lines") or [],
                "arrival_radius_m": m.get("arrival_radius_m", ARRIVAL_DEFAULT_M),
                "approach_radius_m": m.get("approach_radius_m", WP_APPROACH_M),
                "speed": m.get("speed") or "survey",
                "speeds": _norm_speeds(m.get("speeds"), m.get("speed") or "survey"),
                # plan-run completion semantics (Survey/search as a typed behavior):
                # complete (stop) | loiter (station-keep at the last wp) | repeat (loop)
                # | rth (chain the ENC-routed Return-to-Home). Default: rth.
                "completion": _cache_plan_completion(m.get("completion")),
                # keep-clear buffer (m) around every nogo zone - the tightness the
                # ASV threads between piers; smaller for tight marinas.
                "buffer_m": m.get("buffer_m", NOGO_BUFFER_DEFAULT_M),
                # operator MIN DEPTH (m) - a routing floor for EVERY behavior, not just
                # survey coverage (2026-09-07). The client takes the deeper of this and the
                # hull's own navigability limit, so a value below what the hull needs cannot
                # narrow its clearance. There is no max here on purpose: deep water is not a
                # keep-out, and the survey Max depth stays a coverage window.
                "min_depth_m": m.get("min_depth_m", 2.0),
                # LEAD-IN / LEAD-OUT (2026-09-08) - how far the boat runs ON a survey
                # line before the coverage starts, and past where it ends, so steering
                # and IMU are settled through the coverage. The stored value is the one
                # the operator typed IN THE UNIT THEY CHOSE: lead_mode "m" (metres) or
                # "s" (seconds, converted client-side at the survey speed). All three
                # travel together or none of them mean anything - a 20 that loses its
                # "s" is 20 m instead of ~41 m, silently.
                #
                # The per-line lengths ACTUALLY APPLIED ride in "lines" as lead_in_m /
                # lead_out_m, which pass through untouched: they are what the chart
                # allowed, not what was asked for, and only the client's Punch Out can
                # know the difference.
                "lead_mode": ("s" if m.get("lead_mode") == "s" else "m"),
                "lead_in": m.get("lead_in", 0),
                "lead_out": m.get("lead_out", 0),
                # arbitrary survey-area boundary (CAMP SurveyArea) - persisted so a
                # plan drawn at the dock survives a reload / a session at sea.
                "boundary": m.get("boundary") or [],
                "boundary_closed": bool(m.get("boundary_closed")),
            }
    except (OSError, ValueError):
        pass
    return {"waypoints": [], "lines": [], "arrival_radius_m": ARRIVAL_DEFAULT_M,
            "approach_radius_m": WP_APPROACH_M, "speed": "survey",
            "speeds": _norm_speeds(None), "completion": "rth",
            "buffer_m": NOGO_BUFFER_DEFAULT_M, "min_depth_m": 2.0,
            "lead_mode": "m", "lead_in": 0, "lead_out": 0,
            "boundary": [], "boundary_closed": False}


# The operator's END-OF-PLAN setting, cached so the 4 Hz telemetry loop never touches
# the disk. Refreshed wherever the mission is read or written, which is every path that
# can change it. This is the SETTING - it is emphatically not "what the current run does
# at its end", and conflating those two is what this cache exists to keep impossible.
_PLAN_COMPLETION = "rth"


def plan_completion():
    return _PLAN_COMPLETION


def save_mission(m):
    data = json.dumps({
        "waypoints": m.get("waypoints") or [],
        "lines": m.get("lines") or [],
        "arrival_radius_m": m.get("arrival_radius_m", 2.0),
        "approach_radius_m": m.get("approach_radius_m", WP_APPROACH_M),
        "speed": m.get("speed") or "survey",
        "speeds": _norm_speeds(m.get("speeds"), m.get("speed") or "survey"),
        "completion": _cache_plan_completion(m.get("completion")),
        "buffer_m": m.get("buffer_m", 3.0),
        "min_depth_m": m.get("min_depth_m", 2.0),
        "lead_mode": ("s" if m.get("lead_mode") == "s" else "m"),
        "lead_in": m.get("lead_in", 0),
        "lead_out": m.get("lead_out", 0),
        "boundary": m.get("boundary") or [],
        "boundary_closed": bool(m.get("boundary_closed")),
    }, indent=1)
    with _mission_lock:
        tmp = MISSION_PATH + ".part"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(data)
        os.replace(tmp, MISSION_PATH)


# --------------------------------------------------------------------------- #
#  Telemetry-link (comms) monitor: Ubiquiti airOS WiFi bullet, or Starlink     #
# --------------------------------------------------------------------------- #
# Carried over verbatim from the companion console (first cut 2026-07-18, NOT yet
# verified against real hardware). The WiFi prober speaks a genuine airOS
# protocol; the Starlink path is reachability-only (a full SNR/obstruction read
# needs gRPC+protobuf, deliberately not hand-written without a dish to test).
# Config persists to comms_config.json (no secrets); the password is memory-only.

def _load_comms_config():
    try:
        with open(COMMS_CONFIG_PATH, "r", encoding="utf-8") as f:
            c = json.load(f)
        if isinstance(c, dict):
            return {"mode": c.get("mode") or "auto",
                    "host": c.get("host") or "",
                    "username": c.get("username") or ""}
    except (OSError, ValueError):
        pass
    return {"mode": "auto", "host": "", "username": ""}


def _save_comms_config(mode, host, username):
    data = json.dumps({"mode": mode, "host": host, "username": username}, indent=1)
    tmp = COMMS_CONFIG_PATH + ".part"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(data)
    os.replace(tmp, COMMS_CONFIG_PATH)


def _signal_pct_from_dbm(dbm, floor=-95.0, ceil=-50.0):
    if dbm is None:
        return None
    return round(clamp((dbm - floor) / (ceil - floor) * 100.0, 0.0, 100.0), 1)


def probe_ubiquiti_airos(host, username, password, timeout=4.0):
    """Log into an Ubiquiti airOS bullet and read /status.cgi. Never raises."""
    if not host:
        return {"ok": False, "note": "no host configured"}
    last_err = "unreachable"
    for scheme, ctx in (("http", None), ("https", ssl._create_unverified_context())):
        try:
            jar = http.cookiejar.CookieJar()
            opener = urllib.request.build_opener(
                urllib.request.HTTPCookieProcessor(jar),
                urllib.request.HTTPSHandler(context=ctx) if ctx else urllib.request.HTTPHandler())
            base = "%s://%s" % (scheme, host)
            login_data = urllib.parse.urlencode(
                {"username": username or "ubnt", "password": password or "", "uri": "/status.cgi"}
            ).encode("ascii")
            opener.open(urllib.request.Request(base + "/login.cgi", data=login_data), timeout=timeout)
            with opener.open(base + "/status.cgi", timeout=timeout) as r:
                raw = r.read()
            info = json.loads(raw)
            wl = info.get("wireless", {}) if isinstance(info, dict) else {}
            dbm = wl.get("signal")
            ccq = wl.get("ccq")
            ccq_pct = round(ccq / 10.0, 1) if isinstance(ccq, (int, float)) and ccq > 100 else ccq
            essid = wl.get("essid") or wl.get("ssid")
            detail = "AirOS %s" % (essid or "bullet")
            if ccq_pct is not None:
                detail += ", CCQ %.0f%%" % ccq_pct
            return {"ok": True, "signal_pct": _signal_pct_from_dbm(dbm),
                    "rssi_dbm": dbm, "ccq_pct": ccq_pct, "essid": essid, "detail": detail}
        except urllib.error.HTTPError as e:
            last_err = "HTTP %d (check credentials)" % e.code
        except (urllib.error.URLError, OSError, ValueError, TimeoutError) as e:
            last_err = str(e) or type(e).__name__
    return {"ok": False, "note": last_err}


def probe_starlink_reachability(host=STARLINK_HOST, port=STARLINK_PORT, timeout=3.0):
    """Reachability-only Starlink check: TCP-connect to the dish's local gRPC port."""
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return {"ok": True, "detail": "Starlink dish reachable at %s:%d "
                    "(reachability only - full SNR/obstruction telemetry not yet wired up)"
                    % (host, port)}
    except OSError as e:
        return {"ok": False, "note": "no dish at %s:%d (%s)" % (host, port, e)}


class CommsMonitor:
    """Background poll of the ASV's telemetry uplink (WiFi bullet or Starlink),
    independent of the command link. `snapshot()` rides the SSE state stream."""

    POLL_S = 5.0

    def __init__(self):
        cfg = _load_comms_config()
        self._lock = threading.Lock()
        self.mode = cfg["mode"]                 # auto | wifi | starlink | none
        self.host = cfg["host"]
        self.username = cfg["username"]
        self._password = ""                     # memory only - never persisted
        self._last = {"mode": "none", "ok": False, "note": "not polled yet"}
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._loop, daemon=True)
        self._thread.start()

    def configure(self, mode=None, host=None, username=None, password=None):
        with self._lock:
            if mode is not None:
                self.mode = mode if mode in ("auto", "wifi", "starlink", "none") else self.mode
            if host is not None:
                self.host = host
            if username is not None:
                self.username = username
            if password is not None:
                self._password = password
            m, h, u = self.mode, self.host, self.username
        _save_comms_config(m, h, u)

    def snapshot(self):
        with self._lock:
            return dict(self._last)

    def _loop(self):
        while not self._stop.is_set():
            with self._lock:
                mode, host, user, pw = self.mode, self.host, self.username, self._password
            result = self._poll_once(mode, host, user, pw)
            with self._lock:
                self._last = result
            self._stop.wait(self.POLL_S)

    @staticmethod
    def _poll_once(mode, host, user, pw):
        if mode == "none":
            return {"mode": "none", "ok": False, "note": "comms monitoring disabled"}
        if mode == "wifi":
            r = probe_ubiquiti_airos(host, user, pw); r["mode"] = "wifi"; return r
        if mode == "starlink":
            r = probe_starlink_reachability(host or STARLINK_HOST); r["mode"] = "starlink"; return r
        sl = probe_starlink_reachability()
        if sl.get("ok"):
            sl["mode"] = "starlink"; return sl
        if host:
            wf = probe_ubiquiti_airos(host, user, pw); wf["mode"] = "wifi"; return wf
        return {"mode": "none", "ok": False,
                "note": "no link reachable (Starlink not found; no WiFi host configured)"}


COMMS = CommsMonitor()

# --------------------------------------------------------------------------- #
#  Local NOAA chart-tile cache (offline operation at sea)                     #
# --------------------------------------------------------------------------- #
# Served to the browser at /tiles/{z}/{x}/{y}.png from charts/ when cached; on a
# miss, fetched from NOAA's ENC export endpoint, stored, then served. Carried
# over from the companion console.
ENC_EXPORT = ("https://gis.charttools.noaa.gov/arcgis/rest/services/MCS/"
              "NOAAChartDisplay/MapServer/exts/MaritimeChartService/MapServer/export")
_HALF_3857 = math.pi * 6378137.0
_noaa_down_until = 0.0


def enc_tile_url(z, x, y):
    size = 2 * _HALF_3857
    n = 2 ** z
    x0 = -_HALF_3857 + x * size / n
    y1 = _HALF_3857 - y * size / n
    return (ENC_EXPORT + "?bbox=%f,%f,%f,%f" % (x0, y1 - size / n, x0 + size / n, y1) +
            "&bboxSR=3857&imageSR=3857&size=256,256&format=png&transparent=true&f=image")


def tile_cache_path(z, x, y):
    return os.path.join(CHART_DIR, str(z), str(x), "%d.png" % y)


def fetch_tile(z, x, y, timeout=12.0):
    """Tile PNG bytes from the local cache, else NOAA (caching it). None offline."""
    global _noaa_down_until
    path = tile_cache_path(z, x, y)
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        pass
    if time.monotonic() < _noaa_down_until:
        return None
    try:
        req = urllib.request.Request(enc_tile_url(z, x, y),
                                     headers={"User-Agent": "ASV-Console/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            data = r.read()
        if not data.startswith(b"\x89PNG"):
            return None
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".part.%d" % threading.get_ident()
        with open(tmp, "wb") as f:
            f.write(data)
        os.replace(tmp, path)
        return data
    except (OSError, ValueError):
        _noaa_down_until = time.monotonic() + 60.0
        return None


def prefetch_charts(lat, lon, radius_km, zmin, zmax, max_tiles=6000):
    fetched = cached = failed = 0
    dlat = radius_km / 111.32
    dlon = radius_km / (111.32 * max(0.05, math.cos(math.radians(lat))))
    total = 0
    for z in range(zmin, zmax + 1):
        n = 2 ** z

        def tx(lo):
            return int((lo + 180.0) / 360.0 * n)

        def ty(la):
            s = math.sin(math.radians(la))
            return int((0.5 - math.log((1 + s) / (1 - s)) / (4 * math.pi)) * n)

        x0, x1 = sorted((tx(lon - dlon), tx(lon + dlon)))
        y0, y1 = sorted((ty(lat + dlat), ty(lat - dlat)))
        for x in range(x0, x1 + 1):
            for y in range(max(0, y0), min(n - 1, y1) + 1):
                total += 1
                if total > max_tiles:
                    print("  tile cap (%d) reached - raise max_tiles or shrink the area" % max_tiles)
                    return fetched, cached, failed
                if os.path.exists(tile_cache_path(z, x, y)):
                    cached += 1
                    continue
                data = fetch_tile(z, x, y, timeout=20.0)
                if data is None:
                    failed += 1
                else:
                    fetched += 1
                if (fetched + failed) % 25 == 0 and fetched + failed:
                    print("  z%d: %d fetched, %d cached, %d failed" % (z, fetched, cached, failed))
    return fetched, cached, failed


# --------------------------------------------------------------------------- #
#  ENC vector features (NOAA ENCDirect) - for chart-feature "Punch Out"        #
# --------------------------------------------------------------------------- #
# The raster tiles above are pixels only. To trim survey lines to real chart
# features (shorelines, docks, aids, hazards, and water shallower than a limit),
# we pull ENC VECTOR features from NOAA's ENCDirect ArcGIS MapServer - the same
# chart data, as geometry. The services are scale-banded; we pick the finest band
# that actually has coverage for the requested bbox. Depth_Area polygons carry
# DRVAL1/DRVAL2 (shallowest/deepest depth, m) - the basis of the min-depth test.
# Verified live 2026-07-20. Assembled results cache to charts/enc/ for offline
# missions (like the tile cache), with a short circuit breaker when offline.
ENC_BASE = "https://gis.charttools.noaa.gov/arcgis/rest/services/encdirect/%s/MapServer"
ENC_BANDS = ["enc_harbour", "enc_approach", "enc_coastal", "enc_general"]  # finest first
ENC_DIR = os.path.join(CHART_DIR, "enc")

# S-57 object classes we fetch, grouped by the punch-out ROLE they play. Layer ids
# differ per band, so we resolve them by class name at runtime (the ENCDirect
# layer name minus its "<Band>." prefix).
ENC_ROLES = {
    "land":          ["Land_Area"],
    "shore_line":    ["Coastline_line"],
    # Physical over-water STRUCTURES an ASV must go around, as AREAS: piers/wharves
    # (SLCONS), floating docks (FLODOC), dolphins/mooring facilities (MORFAC),
    # breakwaters/training walls (DYKCON), causeways, lock gates (GATCON), dams
    # (DAMCON), and permanently-moored hulks (HULKES).
    "dock":          ["Shoreline_Construction_area", "Floating_Dock_area",
                      "Mooring_Warping_Facility_area", "Dyke_area", "Causeway_area",
                      "Gate_area", "Dam_area", "Hulk_area"],
    # ... and the same structures as LINES - finger piers are typically charted as
    # Shoreline_Construction_line / Mooring_Warping_Facility_line / Pontoon_line.
    # ⚠ "Pontoon_line" IS GONE, and its absence is the point: ENCDirect publishes no such
    # layer in any band. PONTON is a real S-57 class, but this service does not serve it
    # under that name, so the class resolved to nothing and was silently skipped from the
    # day it was written. A requested class that cannot resolve is worse than no class -
    # it reads like coverage. tests/enc_extract.py check 9 is what found it, and is what
    # will refuse the next one.
    "dock_line":     ["Shoreline_Construction_line",
                      "Floating_Dock_line", "Mooring_Warping_Facility_line",
                      "Dyke_line", "Causeway_line", "Gate_line", "Dam_line"],
    "depth_area":    ["Depth_Area"],
    "depth_contour": ["Depth_Contour_line"],
    "sounding":      ["Sounding_point"],
    # LATERAL channel marks (buoys + beacons) - the port/starboard-hand marks that
    # define the sides of a marked channel/fairway. Kept SEPARATE from generic
    # hazard points so the console can use them as channel walls (COLREGS Rule 9:
    # keep right between them) and extend the fairway out to the seaward gate.
    # CATLAM gives the side; the client also treats them geometrically per travel.
    "chan_mark":     ["Buoy_Lateral_point", "Beacon_Lateral_point"],
    # point obstructions: mid-channel/danger aids, piles/dolphins, isolated pier/hulk
    # points, rocks/wrecks (NOT lateral channel marks - those are chan_mark above).
    "hazard_point":  ["Buoy_Isolated_Danger_point",
                      "Buoy_Safe_Water_point", "Buoy_Special_Purpose_General_point",
                      "Beacon_Safe_Water_point",
                      "Beacon_Special_Purpose_General_point",
                      "Mooring_Warping_Facility_point", "Pile_point",
                      "Shoreline_Construction_point", "Hulk_point",
                      "Pylon_Bridge_Support_point",
                      # A CARDINAL MARK IS BOTH A PHYSICAL OBJECT AND A HAZARD INDICATOR:
                      # it is placed to say the safe water lies to the named side of it,
                      # so there is something to avoid on the other. The lateral,
                      # isolated-danger, safe-water and special-purpose buoys were all
                      # fetched and this one was not (Andy, 2026-08-31).
                      "Buoy_Cardinal_point",
                      "Underwater_Awash_Rock_point", "Obstruction_point", "Wreck_point"],
    "hazard_area":   ["Obstruction_area", "Wreck_area"],
    # OBSTRUCTIONS AS LINES. The point and area forms were fetched and the line was not,
    # so a linear obstruction - a submerged barrier, a ruined training wall, a line of
    # piles charted as one object - was invisible to the keep-out model.
    "hazard_line":   ["Obstruction_line"],
    # ⚠ BRIDGES SPLIT IN TWO, AND THE SPLIT IS THE WHOLE POINT.
    #   the SUPPORTS are a hard obstruction at the waterline - a pylon is a pier that
    #     happens to hold something up, and hitting one is the same as hitting a pier;
    #   the SPAN is OVERHEAD. A Bridge_area covers the water it crosses, and enforcing it
    #     as a keep-out would refuse every passage under a bridge - which for a hull with
    #     1 m of air draft is wrong on every bridge there is.
    # So both are FETCHED (the span is worth having cached and drawable) and only the
    # supports are enforced. `bridge_span` is deliberately not a keep-out role.
    # AREA only - the pylon POINT class sits in `hazard_point` above, because the
    # client's keep-out dispatch is an if/else chain on geometry and a role can belong to
    # exactly one branch. A point in the ring branch yields no rings and is dropped.
    "bridge":        ["Pylon_Bridge_Support_area"],
    "bridge_span":   ["Bridge_area", "Bridge_line"],
    "dredged":       ["Dredged_Area"],
    # ⚠ "Restricted_Area_area", NOT "Restricted_Area" - the published layer carries the
    # geometry suffix like the rest of them. The name was wrong from the day this role was
    # added, and because an unresolved class is SILENTLY SKIPPED (`if cls in lm` in the
    # fetch), the role fetched nothing, ever: ZERO restricted features across 110 real
    # cached extracts. The operator's "Dredged / restricted" enforcement checkbox has only
    # ever enforced the dredged half of what it says.
    "restricted":    ["Restricted_Area_area"],
    # ── WHERE COLREGS RULE 9 APPLIES, READ OFF THE CHART ────────────────────
    # Andy, 2026-08-31: "Rule 9 is being improperly applied ... It applies only
    # within narrow channels. ... In open bay or open ocean transits and while
    # running various survey patterns the rule should not be considered."
    #
    # He is right, and the old test was the reason: the lane fired wherever a
    # perpendicular ray-march found SOMETHING within reach on both sides -
    # max(120, buffer*30) = 150 m at the shipped buffer, so any water with banks
    # 300 m apart was treated as a narrow channel. That is most of a bay.
    #
    # A narrow channel is not a shape you can infer from two distances. It is a
    # CHARTED OBJECT, and S-57 names it. Rule 9's own words are "a narrow channel
    # or fairway":
    #   FAIRWY (Fairway_area)  - the designated lane for larger vessels. This IS
    #                            the object the rule is written about.
    #   DRGARE (Dredged_Area)  - depth artificially maintained, so a deep-draught
    #                            vessel "can safely navigate only within" it,
    #                            which is Rule 9(b)'s own test.
    # Already extracted above as "dredged" for the survey depth window; named
    # here too because the ROLE is different - one clips coverage, the other
    # decides whether a rule of the road is in force.
    #
    # DELIBERATELY NOT HERE, and it is not an oversight:
    #   TCTSBL / Traffic_Separation_* - that is RULE 10, a different rule with
    #     different duties. Andy: "There are other rules that should apply which
    #     we'll deal with later."
    #   RECTRC / Recommended_Track   - a recommended route is neither a narrow
    #     channel nor a fairway. Following one is good practice, not Rule 9.
    #   DWRTPT / Deep_Water_Route    - a routeing measure, same reasoning.
    "fairway":       ["Fairway_area"],
}
# CATLAM = category of lateral mark (1 port-hand, 2 starboard-hand, 3 pref-chan-to-
# stbd, 4 pref-chan-to-port); COLOUR for the buoy symbol. Kept for chan_mark use.
ENC_KEEP_PROPS = ("DRVAL1", "DRVAL2", "VALSOU", "VALDCO", "OBJNAM", "CATLAM", "COLOUR")
# ...and the four the nogo model does ARITHMETIC on, which have to be NUMBERS.
ENC_NUMERIC_PROPS = frozenset(("DRVAL1", "DRVAL2", "VALSOU", "VALDCO"))


def _enc_num(value):
    """A numeric ENC attribute as a number, or None if it will not read as one."""
    if isinstance(value, bool):          # True is an int in Python; it is not a depth
        return None
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.strip())
        except ValueError:
            return None
    return None


def _enc_keep_props(props):
    """
    The properties worth carrying, with the numeric ones AS NUMBERS.

    A TRIP-WIRE, NOT A FIX: this console cannot have the fault today, and this
    is here so it cannot acquire one silently.

    WHAT HAPPENED NEXT DOOR, 2026-08-26. WorldView drew a mission that detoured
    around a charted rock with 5.1 m of water over it. `hazExtent` - the same
    body this console runs, adopted from asv_core - exempts a point hazard the
    chart has sounded, and it tests `typeof vs === 'number'`. S-57 attributes
    come off a CELL as text, so the value it saw was the string "5.1", the test
    failed, the rock read as unsounded and took the full 50 m assumed radius.

    WHY IT IS NOT US, MEASURED. This console has ONE chart source - `_enc_query`
    with `f=geojson` - and ArcGIS types its numeric fields. Run over this
    console's own cache: 629 point hazards, 48 of them sounded, ZERO with a
    string VALSOU, and ZERO kept as a hazard despite having enough water over
    them. There is no local S-57 reader here and no operator chart-file import;
    both are WorldView's, and they are the only two roads the text travelled.

    SO WHAT IS THIS FOR. The day a second source appears - a cell read off a
    disk, an imported GeoJSON, a different service - the fault lands again and
    NOTHING would catch it, because every fixture in this estate feeds VALSOU as
    a NUMBER. That is the shape of the whole defect: the tests agreed with code
    that could not read the wire. Coercing here makes a new source safe by
    construction, and `tests/enc_extract.py` feeds this the string form so the
    guarantee is checked rather than asserted.

    An unreadable numeric attribute is DROPPED, not carried as text: absent
    means unknown and unknown is the conservative case, which is the answer the
    string was accidentally producing anyway - now for a stated reason instead
    of a type test failing quietly.
    """
    kept = {}
    for k in ENC_KEEP_PROPS:
        v = (props or {}).get(k)
        if v is None:
            continue
        if k in ENC_NUMERIC_PROPS:
            n = _enc_num(v)
            if n is None:
                continue
            kept[k] = n
        else:
            kept[k] = v
    return kept


_enc_layermaps = {}          # band -> {className: layerId}
_enc_layermap_lock = threading.Lock()
_enc_down_until = 0.0        # circuit breaker (monotonic deadline)


def _enc_layer_map(band, timeout=20.0):
    """Return {className: layerId} for a band, cached in memory + on disk."""
    with _enc_layermap_lock:
        if band in _enc_layermaps:
            return _enc_layermaps[band]
    path = os.path.join(ENC_DIR, band, "_layers.json")
    m = None
    try:
        with open(path, "r", encoding="utf-8") as f:
            m = json.load(f)
    except OSError:
        pass
    if m is None:
        try:
            req = urllib.request.Request(ENC_BASE % band + "?f=json",
                                         headers={"User-Agent": "ASV-Console/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                info = json.loads(r.read())
        except (OSError, ValueError):
            return {}
        m = {}
        for L in info.get("layers", []):
            if L.get("geometryType"):            # skip group layers
                m[(L.get("name") or "").split(".")[-1]] = L["id"]
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".part"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(m, f)
        os.replace(tmp, path)
    with _enc_layermap_lock:
        _enc_layermaps[band] = m
    return m


def _enc_query(band, layer_id, bbox, timeout=25.0, count_only=False, max_records=2000):
    """Query one ENCDirect layer for a bbox -> GeoJSON dict (or {'count':n})."""
    xmin, ymin, xmax, ymax = bbox
    params = {
        "geometry": "%f,%f,%f,%f" % (xmin, ymin, xmax, ymax),
        "geometryType": "esriGeometryEnvelope", "inSR": "4326", "outSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
    }
    if count_only:
        params["returnCountOnly"] = "true"
        params["f"] = "json"
    else:
        # outFields=* : a per-layer field list 400s on any layer missing a field
        # (e.g. VALSOU on Depth_Area). We keep only ENC_KEEP_PROPS after parsing.
        params["outFields"] = "*"
        params["returnGeometry"] = "true"
        params["f"] = "geojson"
        params["resultRecordCount"] = str(max_records)
    url = ENC_BASE % band + "/%d/query?" % layer_id + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "ASV-Console/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read())


def _enc_query_ids(band, layer_id, bbox, timeout=25.0):
    """Object IDs intersecting bbox (returnIdsOnly). This is the RELIABLE spatial
    query: several NOAA ENC layers (e.g. Shoreline_Construction_line - the finger
    piers) return the correct count/ids here but ZERO features to a spatial query
    that also asks for geometry, so we must resolve ids first then fetch by id."""
    xmin, ymin, xmax, ymax = bbox
    params = {
        "geometry": "%f,%f,%f,%f" % (xmin, ymin, xmax, ymax),
        "geometryType": "esriGeometryEnvelope", "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects", "returnIdsOnly": "true", "f": "json",
    }
    url = ENC_BASE % band + "/%d/query?" % layer_id + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"User-Agent": "ASV-Console/1.0"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        d = json.loads(r.read())
    return d.get("objectIds") or (d.get("properties") or {}).get("objectIds") or []


def _enc_query_by_ids(band, layer_id, ids, timeout=30.0, batch=200):
    """Fetch GeoJSON geometry for explicit object ids (batched). Reliable where the
    bbox+returnGeometry query flakes to empty."""
    feats = []
    for i in range(0, len(ids), batch):
        chunk = ids[i:i + batch]
        params = {
            "objectIds": ",".join(str(x) for x in chunk),
            "outFields": "*", "returnGeometry": "true", "outSR": "4326", "f": "geojson",
        }
        url = ENC_BASE % band + "/%d/query?" % layer_id + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={"User-Agent": "ASV-Console/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            feats.extend(json.loads(r.read()).get("features", []))
    return feats


def _enc_pick_band(bbox):
    """Finest ENC band with Depth_Area or Land_Area coverage in the bbox."""
    for band in ENC_BANDS:
        lm = _enc_layer_map(band)
        for cls in ("Depth_Area", "Land_Area"):
            lid = lm.get(cls)
            if lid is None:
                continue
            try:
                if int(_enc_query(band, lid, bbox, count_only=True).get("count", 0)) > 0:
                    return band
            except (OSError, ValueError):
                pass
    return None


def _bbox_key(bbox):
    """The cache key for a bbox, %.4f per edge. ONE function on purpose: the features
    cache and the chartinfo cache used to carry byte-identical copies of this format
    string, which is how a mutation runner once matched its anchor TWICE and skipped -
    the duplication was invisible until something tried to hold one copy still. A key
    format change now moves both caches together, and both suites' cache checks watch it."""
    return "%.4f_%.4f_%.4f_%.4f" % tuple(bbox)


def fetch_enc_features(bbox, min_depth=0.0):
    """Fetch + role-tag ENC vector features for a bbox, from the finest band with
    coverage. Returns {'band', 'features':[{role,cls,props,geometry}], 'counts'}.
    The assembled geometry caches to charts/enc/features_<key>.json; the min-depth
    'shallow' tag is applied per request so one fetch serves any depth limit."""
    global _enc_down_until
    key = _bbox_key(bbox)
    # cache version: v2 adds id-first fetch (piers/structures that the old spatial
    # query silently dropped) + the expanded structure classes; v3 splits lateral
    # channel marks into their own 'chan_mark' role and keeps CATLAM/COLOUR; v4 adds
    # the 'fairway' role (FAIRWY, for COLREGS Rule 9) and fixes 'restricted' to the
    # layer's real published name; v5 adds the 'hazard_line', 'bridge' and 'bridge_span'
    # roles, cardinal buoys, and EVERY REMAINING PUBLISHED LAYER as 'extra'. Bumping the
    # version ignores older caches that lack the new role/props.
    #
    # v5 SHOULD BE THE LAST BUMP FOR A ROLE ADDED, and that is the point of it: the extract
    # now holds every layer the band publishes, so classifying one later is a decision about
    # data already on disk rather than a refetch of every area.
    #
    # ⚠ THE BUMP IS PART OF ADDING A ROLE, NOT AN AFTERTHOUGHT. The fairway role shipped
    # without one and the omission was invisible: 110 cached v3 extracts covered every
    # operating area in use, every one served happily, and NOT ONE contained a fairway
    # feature - so Rule 9 would never have applied anywhere the console had already been,
    # and nothing would have said so. A cache does not know what it does not contain.
    # Found by auditing the published layer list against what the extracts actually
    # returned; tests/enc_extract.py now fails if a declared class does not resolve.
    cache = os.path.join(ENC_DIR, "features_v5_%s.json" % key)
    data = None
    try:
        with open(cache, "r", encoding="utf-8") as f:
            data = json.load(f)
    except OSError:
        pass
    if data is None:
        if time.monotonic() < _enc_down_until:
            return {"band": None, "features": [], "note": "ENC offline (no cache for this area)"}
        band = _enc_pick_band(bbox)
        if band is None:
            _enc_down_until = time.monotonic() + 30.0
            return {"band": None, "features": [], "note": "no ENC coverage here (or offline)"}
        lm = _enc_layer_map(band)
        jobs = [(role, cls, lm[cls]) for role, classes in ENC_ROLES.items()
                for cls in classes if cls in lm]
        # ── EVERY OTHER PUBLISHED LAYER, FETCHED AND CACHED (Andy, 2026-08-31: "download
        # all layers when entering a new area") ──────────────────────────────────────────
        #
        # 203 layers are published for the harbour band and the roles above name 43. The
        # rest come down too, tagged `extra` - and the reason is the defect that prompted
        # this: a role added later cannot see an area already cached, so `fairway` shipped
        # and would never have applied anywhere the console had already been. Holding the
        # whole extract makes the cache COMPLETE for the area rather than complete for
        # whatever the roles happened to be on the day it was written. Classifying a layer
        # afterwards then becomes a client-side decision over data already on disk.
        #
        # ⚠ `extra` IS NOT A KEEP-OUT, AND CANNOT BECOME ONE BY ACCIDENT. buildKeepouts
        # dispatches on the named roles and an unmatched role falls out of the bottom with
        # the depth areas and the soundings - so an airfield, a built-up area or a territorial
        # -sea boundary arriving in the extract changes no route. Turning one of these into an
        # obstacle is a deliberate act: give it a role above and teach the model about it.
        #
        # THE COST IS PAID ONCE PER AREA, on the first extract, in parallel with the rest.
        _named = {c for cs in ENC_ROLES.values() for c in cs}
        jobs += [("extra", cls, lid) for cls, lid in lm.items() if cls not in _named]

        def _one(job):
            role, cls, lid = job
            # ID-first: resolve object ids (the reliable spatial query), then fetch
            # geometry by id. This is what makes the finger piers actually appear -
            # the plain bbox+geometry query returns them EMPTY on some line layers.
            try:
                ids = _enc_query_ids(band, lid, bbox)
            except (OSError, ValueError):
                return []
            if not ids:
                return []
            try:
                features = _enc_query_by_ids(band, lid, ids)
            except (OSError, ValueError):
                try:                                   # last resort: the direct query
                    features = _enc_query(band, lid, bbox).get("features", [])
                except (OSError, ValueError):
                    return []
            out = []
            for ft in features:
                g = ft.get("geometry")
                if not g:
                    continue
                # Through `_enc_keep_props`, which makes the numbers numbers -
                # a no-op for this console's one source, and the trip-wire for
                # any second one. See its docstring.
                kept = _enc_keep_props(ft.get("properties"))
                out.append({"role": role, "cls": cls, "props": kept, "geometry": g})
            return out

        feats = []
        with ThreadPoolExecutor(max_workers=8) as ex:
            for res in ex.map(_one, jobs):
                feats.extend(res)
        counts = {}
        for ft in feats:
            counts[ft["cls"]] = counts.get(ft["cls"], 0) + 1
        data = {"band": band, "features": feats, "counts": counts}
        os.makedirs(ENC_DIR, exist_ok=True)
        tmp = cache + ".part"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f)
        os.replace(tmp, cache)
    md = float(min_depth or 0.0)
    for ft in data["features"]:
        if ft["role"] == "depth_area":
            d1 = ft["props"].get("DRVAL1")
            ft["shallow"] = (d1 is not None and float(d1) < md)
    data["min_depth"] = md
    return data


# --- CHART SOURCE (the S-57 META objects = an ENC's answer to a paper title block)
# M_COVR ("Coverage_area") carries the cell identity - DSNM "US5PA1CF.000", whose
# 3rd character is the usage band (5 = harbour). M_QUAL ("Quality_of_Data_area")
# carries the zone of confidence and the survey dates as POLYGONS, which is the
# part a paper title block cannot express: confidence varies WITHIN a sheet, so
# serving the polygons lets the client report the ZOC under the VESSEL.
#
# Deliberately a SEPARATE endpoint rather than extra roles in /api/enc: those would
# bloat the routing keep-out cache and force a features_v3 -> v4 bump, invalidating
# every cached extract on disk - for data no route ever consults.
ENC_META_CLASSES = {"cells": "Coverage_area", "quality": "Quality_of_Data_area"}
META_KEEP_PROPS = ("DSNM", "TITLE", "CATCOV", "CATZOC", "SURSTA", "SUREND",
                   "SORDAT", "SORIND", "POSACC", "SOUACC", "TECSOU", "VERDAT")
# ENC usage band from the cell name's 3rd character (S-57 dataset naming).
ENC_USAGE = {"1": "Overview", "2": "General", "3": "Coastal",
             "4": "Approach", "5": "Harbour", "6": "Berthing"}


def fetch_chart_info(bbox):
    """Chart-source metadata for a bbox: the ENC cells covering it + the
    zone-of-confidence polygons within it. Cached on disk like the feature
    extract, and it never raises - an empty answer degrades the card, not the run."""
    global _enc_down_until
    key = _bbox_key(bbox)
    cache = os.path.join(ENC_DIR, "chartinfo_v1_%s.json" % key)
    try:
        with open(cache, "r", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        pass
    if time.monotonic() < _enc_down_until:
        return {"band": None, "cells": [], "quality": [], "note": "ENC offline"}
    band = _enc_pick_band(bbox)
    if band is None:
        return {"band": None, "cells": [], "quality": [], "note": "no ENC coverage here"}
    lm = _enc_layer_map(band)
    out = {"band": band, "cells": [], "quality": [], "note": ""}
    for key_name, cls in ENC_META_CLASSES.items():
        lid = lm.get(cls)
        if lid is None:                       # layer absent in this band - skip, don't fail
            continue
        try:
            ids = _enc_query_ids(band, lid, bbox)
            feats = _enc_query_by_ids(band, lid, ids) if ids else []
        except (OSError, ValueError):
            continue
        for ft in feats:
            props = ft.get("properties") or {}
            kept = {k: props.get(k) for k in META_KEEP_PROPS if props.get(k) not in (None, "", " ")}
            if not kept:
                continue
            out[key_name].append({"props": kept, "geometry": ft.get("geometry")})
    os.makedirs(ENC_DIR, exist_ok=True)
    tmp = cache + ".part"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(out, f)
        os.replace(tmp, cache)
    except OSError:
        pass
    return out


# --------------------------------------------------------------------------- #
#  Real-time water level (NOAA CO-OPS) - correct ENC charted depths to "now"   #
# --------------------------------------------------------------------------- #
# ENC soundings/DEPARE are referenced to a fixed chart datum: Low Water Datum
# (LWD) in the Great Lakes, MLLW in the oceans. The real water surface sits some
# offset above (or below) that datum right now, so the ACTUAL available depth =
# charted_depth + (water level above datum). We read that offset live from the
# nearest NOAA CO-OPS water-level station and add it to the depth calc.
# Verified live 2026-07-20: Great Lakes stations answer datum=LWD (e.g. Buffalo
# +0.887 m), ocean stations datum=MLLW (The Battery +0.551 m); MLLW errors on the
# Lakes, so datum is chosen by the station's `greatlakes` flag.
COOPS_STATIONS_URL = ("https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/"
                      "stations.json?type=waterlevels")
COOPS_DATA_URL = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
COOPS_APP = "asv_console"
# The operator-facing CO-OPS page for ONE station - the THIRD browser window. It takes a
# single station id, so when the correction is an IDW blend this page can only show the
# PRIMARY (the nearest station actually returning data). The console prints the whole
# blend when it opens the window, so a blended correction is visible rather than implied.
COOPS_PAGE_URL = "https://tidesandcurrents.noaa.gov/waterlevels.html?id=%s"
# Tide series: hours of OBSERVED past + PREDICTED future to fetch.
TIDE_PAST_H = 12
TIDE_PRED_H = 24


def tide_station_url(station_id):
    """CO-OPS water-levels page for a station id, or None when there is no id.

    ONE place, because the id is DERIVED from the vessel's own fix rather than
    configured: hardcoding a station anywhere would pin the console to whatever water it
    happened to be written in. The DriX spawn resolves to Lewes, Delaware - that is a
    measurement, not a default."""
    sid = str(station_id or "").strip()
    return COOPS_PAGE_URL % sid if sid else None
WATER_STATIONS_CACHE = os.path.join(CHART_DIR, "coops_stations.json")
_water_stations = None
_water_stations_lock = threading.Lock()

# Interpolation: blend the K nearest stations by inverse-distance weighting to
# capture the spatial gradient (seiche tilt across a lake, tide phase along a
# coast) instead of assuming the single nearest station's level everywhere.
WATER_K = 3
WATER_MAX_KM = 200.0        # ignore stations farther than this
WATER_IDW_POWER = 2.0
# Great Lakes datum (LWD) is defined PER LAKE, so LWD offsets must NOT be blended
# across lakes. These rough boxes (lat_min, lat_max, lon_min, lon_max) let us keep
# interpolation within one lake. Oceans (MLLW) are not box-restricted.
GREAT_LAKES_BOXES = {
    "superior": (46.0, 49.5, -92.5, -84.0),
    "michigan": (41.5, 46.3, -88.5, -84.5),
    "huron":    (43.0, 46.5, -84.8, -79.5),
    "erie":     (41.2, 43.05, -83.7, -78.7),
    "ontario":  (43.05, 44.5, -79.9, -76.0),
}


def _lake_of(lat, lon):
    for name, (a, b, c, d) in GREAT_LAKES_BOXES.items():
        if a <= lat <= b and c <= lon <= d:
            return name
    return None


def _haversine_km(lat1, lon1, lat2, lon2):
    R, p = 6371.0, math.pi / 180.0
    return 2 * R * math.asin(math.sqrt(
        math.sin((lat2 - lat1) * p / 2) ** 2 +
        math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin((lon2 - lon1) * p / 2) ** 2))


def _load_water_stations(timeout=30.0):
    """CO-OPS water-level station list (id/name/lat/lng/greatlakes), cached."""
    global _water_stations
    with _water_stations_lock:
        if _water_stations is not None:
            return _water_stations
    data = None
    try:
        with open(WATER_STATIONS_CACHE, "r", encoding="utf-8") as f:
            data = json.load(f)
    except OSError:
        pass
    if data is None:
        try:
            req = urllib.request.Request(COOPS_STATIONS_URL, headers={"User-Agent": "ASV-Console/1.0"})
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = json.loads(r.read())
            data = [{"id": s["id"], "name": s.get("name"),
                     "lat": float(s["lat"]), "lng": float(s["lng"]),
                     "gl": bool(s.get("greatlakes"))}
                    for s in raw.get("stations", []) if s.get("lat") and s.get("lng")]
            if data:
                os.makedirs(CHART_DIR, exist_ok=True)
                tmp = WATER_STATIONS_CACHE + ".part"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(data, f)
                os.replace(tmp, WATER_STATIONS_CACHE)
        except (OSError, ValueError, KeyError):
            return []
    with _water_stations_lock:
        _water_stations = data
    return data


def _coops_get(station_id, datum, product, timeout=15.0):
    """One CO-OPS datagetter call for `product` (water_level | predictions) above
    `datum`, returning the value nearest 'now'. Never raises."""
    params = {"product": product, "application": COOPS_APP, "station": station_id,
              "datum": datum, "time_zone": "gmt", "units": "metric", "format": "json"}
    if product == "predictions":
        # projected: a short window from now (computer clock), 6-min interval
        params["begin_date"] = time.strftime("%Y%m%d %H:%M", time.gmtime())
        params["end_date"] = time.strftime("%Y%m%d %H:%M", time.gmtime(time.time() + 1800))
        params["interval"] = "6"
        key = "predictions"
    else:
        params["date"] = "latest"
        key = "data"
    try:
        req = urllib.request.Request(COOPS_DATA_URL + "?" + urllib.parse.urlencode(params),
                                     headers={"User-Agent": "ASV-Console/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.loads(r.read())
    except (OSError, ValueError) as e:
        return {"ok": False, "note": "fetch failed: %s" % e}
    if isinstance(d, dict) and d.get("error"):
        return {"ok": False, "note": (d["error"].get("message") or "CO-OPS error").strip()}
    rows = (d.get(key) if isinstance(d, dict) else None) or []
    if not rows:
        return {"ok": False, "note": "no %s data" % product}
    row = rows[-1] if product == "water_level" else rows[0]   # obs=latest, pred=nearest now
    try:
        return {"ok": True, "offset_m": float(row.get("v")), "t": row.get("t")}
    except (TypeError, ValueError):
        return {"ok": False, "note": "bad value"}


def _coops_series(station_id, datum, product, begin, end, interval=None, timeout=15.0):
    """CO-OPS datagetter over a TIME RANGE (begin/end are 'YYYYMMDD HH:MM' GMT).
    Returns {'ok':bool, 'series':[{'t','v'}...], 'note':str}. Never raises."""
    params = {"product": product, "application": COOPS_APP, "station": station_id,
              "datum": datum, "time_zone": "gmt", "units": "metric", "format": "json",
              "begin_date": begin, "end_date": end}
    if interval:
        params["interval"] = interval
    try:
        req = urllib.request.Request(COOPS_DATA_URL + "?" + urllib.parse.urlencode(params),
                                     headers={"User-Agent": "ASV-Console/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            d = json.loads(r.read())
    except (OSError, ValueError) as e:
        return {"ok": False, "note": "fetch failed: %s" % e}
    if isinstance(d, dict) and d.get("error"):
        return {"ok": False, "note": (d["error"].get("message") or "CO-OPS error").strip()}
    key = "predictions" if product == "predictions" else "data"
    rows = (d.get(key) if isinstance(d, dict) else None) or []
    out = []
    for row in rows:
        try:
            out.append({"t": row.get("t"), "v": round(float(row.get("v")), 3)})
        except (TypeError, ValueError):
            pass
    if not out:
        return {"ok": False, "note": "no %s data" % product}
    return {"ok": True, "series": out}


def fetch_tide_series(lat, lon, timeout=15.0):
    """Water-level TIME SERIES for the tide chart at the nearest CO-OPS station:
    OBSERVED for the past TIDE_PAST_H hours + PREDICTED for the next TIDE_PRED_H.
    Great Lakes stations have observed levels but NO astronomical tide predictions
    (the predicted series comes back empty with a note). Never raises."""
    sts = _load_water_stations()
    if not sts:
        return {"ok": False, "note": "CO-OPS station list unavailable (offline?)"}
    nearest = min(sts, key=lambda s: _haversine_km(lat, lon, s["lat"], s["lng"]))
    datum = "LWD" if nearest["gl"] else "MLLW"
    now = time.time()
    fmt = lambda ts: time.strftime("%Y%m%d %H:%M", time.gmtime(ts))
    past_args = (nearest["id"], datum, "water_level", fmt(now - TIDE_PAST_H * 3600), fmt(now), None, timeout)
    if nearest["gl"]:
        # Great Lakes water level is weather-driven (seiche / wind setup), not
        # astronomical - CO-OPS has NO tide predictions here and the predictions call
        # just 400s. Skip it and say so cleanly rather than surfacing a raw HTTP error.
        past = _coops_series(*past_args)
        pred = {"ok": False, "note": "no tide forecast at Great Lakes stations (levels are weather-driven)"}
    else:
        # tidal station: fetch observed + predicted in parallel to keep it snappy
        with ThreadPoolExecutor(max_workers=2) as ex:
            fp = ex.submit(_coops_series, *past_args)
            fd = ex.submit(_coops_series, nearest["id"], datum, "predictions",
                           fmt(now), fmt(now + TIDE_PRED_H * 3600), "30", timeout)
            past, pred = fp.result(), fd.result()
    res = {"ok": bool(past.get("ok") or pred.get("ok")),
           "station": nearest["id"], "name": nearest["name"], "datum": datum,
           "gl": bool(nearest["gl"]), "units": "m", "tz": "GMT",
           "now": time.strftime("%Y-%m-%d %H:%M", time.gmtime(now)), "now_epoch": int(now),
           "past_h": TIDE_PAST_H, "pred_h": TIDE_PRED_H,
           "observed": past.get("series", []), "predicted": pred.get("series", [])}
    note = tide_note(past, pred)
    if note:
        res["note"] = note
    return res


def tide_note(past, pred):
    """What the tide card should say about two series that may have failed, or None.

    ONE CAUSE, SAID ONCE. The observed and predicted series are two independent calls to the
    SAME upstream, so an outage there fails both with an identical message. Joining them
    printed the sentence twice:

        no observed data (fetch failed: HTTP Error 502: Bad Gateway) · fetch failed: HTTP
        Error 502: Bad Gateway

    The repetition tells the operator nothing extra, and it HIDES the part that matters -
    that BOTH series are gone, not just the observed one. Reported live (Andy, 2026-08-04);
    the cause was a transient NOAA CO-OPS 502, with every request shape verified good.

    Split out of fetch_tide so it can be exercised without the network."""
    pnote, dnote = past.get("note"), pred.get("note")
    if not past.get("ok") and not pred.get("ok") and pnote and pnote == dnote:
        return "no observed data and no predictions (%s)" % pnote
    notes = []
    if not past.get("ok"):
        notes.append("no observed data (%s)" % (pnote or "?"))
    if not pred.get("ok"):
        notes.append(dnote or "no predictions")
    return " · ".join(notes) if notes else None


def _fetch_station_level(station_id, datum, timeout=15.0):
    """Water level above `datum` at one station: real-time OBSERVED first, else
    PROJECTED tide predictions (tidal stations only - Great Lakes have none).
    `kind` is 'obs' or 'pred'. Never raises."""
    r = _coops_get(station_id, datum, "water_level", timeout=timeout)
    if r.get("ok"):
        r["kind"] = "obs"
        return r
    p = _coops_get(station_id, datum, "predictions", timeout=timeout)
    if p.get("ok"):
        p["kind"] = "pred"
        return p
    return {"ok": False, "note": r.get("note") or p.get("note")}


def fetch_water_level(lat, lon, timeout=15.0):
    """Water level above the CHART datum (LWD in the Great Lakes, MLLW elsewhere),
    INTERPOLATED from the nearest CO-OPS stations by inverse-distance weighting, to
    capture the spatial gradient. `offset_m` is what to ADD to charted ENC depths
    to get the real-time available depth. Only stations sharing the vessel's datum
    are blended - and, in the Great Lakes, only stations in the SAME lake (LWD is
    per-lake). Never raises."""
    sts = _load_water_stations()
    if not sts:
        return {"ok": False, "note": "CO-OPS station list unavailable (offline?)"}

    def dist(s):
        return _haversine_km(lat, lon, s["lat"], s["lng"])

    nearest = min(sts, key=dist)
    datum = "LWD" if nearest["gl"] else "MLLW"
    lake = _lake_of(nearest["lat"], nearest["lng"]) if nearest["gl"] else None

    # candidate pool: same datum region, within the distance cap, same lake if GL
    cand = [s for s in sts if bool(s["gl"]) == bool(nearest["gl"]) and dist(s) <= WATER_MAX_KM]
    if lake is not None:
        cand = [s for s in cand if _lake_of(s["lat"], s["lng"]) == lake]
    cand.sort(key=dist)
    cand = cand[:WATER_K] or [nearest]

    def _job(s):
        r = _fetch_station_level(s["id"], datum, timeout=timeout)
        r["_s"] = s
        return r

    got = []
    with ThreadPoolExecutor(max_workers=min(4, len(cand))) as ex:
        for r in ex.map(_job, cand):
            if r.get("ok"):
                s = r["_s"]
                got.append({"id": s["id"], "name": s["name"], "dist_km": round(dist(s), 1),
                            "offset_m": round(r["offset_m"], 3), "t": r.get("t"),
                            "kind": r.get("kind")})
    # FALLBACK TIER 3: no real-time or projected data anywhere -> default to the
    # ENC chart datum (offset 0), the safe choice (charted depths as surveyed).
    if not got:
        return {"ok": False, "datum": datum, "station": nearest["id"], "name": nearest["name"],
                "data_kind": "chart", "note": "no live or predicted data — using ENC chart datum"}
    # TIER 1 preferred over TIER 2: use OBSERVED stations if any returned; only
    # fall to PROJECTED (predictions) when no observed data is available at all.
    obs = [g for g in got if g["kind"] == "obs"]
    use = obs if obs else got
    data_kind = "observed" if obs else "predicted"
    use.sort(key=lambda g: g["dist_km"])

    if len(use) == 1 or use[0]["dist_km"] < 0.05:
        offset, method = use[0]["offset_m"], "single"
    else:
        num = den = 0.0
        for g in use:
            w = 1.0 / max(g["dist_km"], 0.01) ** WATER_IDW_POWER
            num += w * g["offset_m"]
            den += w
        offset, method = num / den, "idw%d" % len(use)
    prim = use[0]
    return {"ok": True, "offset_m": round(offset, 3), "datum": datum, "method": method,
            "data_kind": data_kind, "station": prim["id"], "name": prim["name"],
            "dist_km": prim["dist_km"], "t": prim["t"], "lake": lake, "stations": use}


class WaterLevel:
    """Background link to the nearest CO-OPS stations (inverse-distance interpolated).
    On each vessel fix it learns the position; it refetches on start-up, every 6 min
    (CO-OPS' update cadence), on a >3 km move, or on demand. A manual override can
    stand in when offline. `snapshot()` rides Engine.state() as `water`, so the
    browser always has the current offset to apply to charted depths."""

    POLL_S = 360.0

    def __init__(self):
        self._lock = threading.Lock()
        self._pos = None
        self._manual = None
        self._last = {"ok": False, "note": "waiting for a GPS fix", "source": "none"}
        self._tide_cache = None       # (epoch, result) for the tide-chart series
        self._force = threading.Event()
        self._stop = threading.Event()
        threading.Thread(target=self._loop, daemon=True).start()

    def update_position(self, lat, lon):
        with self._lock:
            old = self._pos
            self._pos = (lat, lon)
        if old is None or _haversine_km(old[0], old[1], lat, lon) > 3.0:
            self._force.set()

    def set_manual(self, offset):
        with self._lock:
            self._manual = None if offset is None else float(offset)

    def refresh_now(self):
        self._force.set()

    def snapshot(self):
        with self._lock:
            base = dict(self._last)
            m = self._manual
        if m is not None:
            base = dict(base, ok=True, offset_m=round(m, 3), source="manual",
                        note="manual override (%.2f m)" % m)
        else:
            base["source"] = "station" if base.get("ok") else "none"
        # THE STATION'S OWN PAGE, BUILT HERE AND NOWHERE ELSE. The console page opens and
        # re-points the tide window, and it must not carry a second copy of this URL
        # template - two spellings of the same address is how the window ends up on a page
        # the console is not attributing its correction to. Absent when there is no
        # station, so "no page" and "a page for nothing" are not the same value.
        base["page"] = tide_station_url(base.get("station"))
        return base

    def tide_series(self, force=False):
        """Tide-chart series (past observed + future predicted) for the vessel's
        nearest station. Cached ~5 min (CO-OPS' cadence) unless `force`."""
        with self._lock:
            pos = self._pos
            cached = self._tide_cache
        if not pos:
            return {"ok": False, "note": "waiting for a GPS fix"}
        now = time.time()
        if cached and not force and now - cached[0] < 300:
            return cached[1]
        res = fetch_tide_series(pos[0], pos[1])
        with self._lock:
            self._tide_cache = (now, res)
        return res

    def _loop(self):
        while not self._stop.is_set():
            with self._lock:
                pos = self._pos
            if pos:
                res = fetch_water_level(pos[0], pos[1])
                with self._lock:
                    self._last = res
            self._force.wait(self.POLL_S)
            self._force.clear()


WATER = WaterLevel()


# --------------------------------------------------------------------------- #
#  Environmental simulator (SIM ONLY): real wind + sea state -> forces on the ASV
# --------------------------------------------------------------------------- #
# On the first GPS fix the console locates the nearest NOAA NDBC buoys, IDW-
# interpolates their wind + sea-state observations to the vessel, and SimVcu.tick
# turns those into a wind force (on the boat's projected windage silhouette) and a
# wave drift + oscillatory yaw. The net is a steady set (crab) plus a slight weave
# the line-follower must continually steer out - i.e. a realistic "the boat never
# tracks perfectly" feel. RealVcu is untouched: a real boat feels the real weather.
NDBC_STATIONS_CACHE = os.path.join(CHART_DIR, "ndbc_stations.json")
NDBC_STATIONS_URL = "https://www.ndbc.noaa.gov/activestations.xml"
# The operator-facing NDBC page for ONE buoy - the FOURTH browser window, the weather
# twin of COOPS_PAGE_URL. Same rule: the id is derived from the vessel fix, and the page
# shows the PRIMARY buoy while the forcing may be an IDW blend of ENV_K of them.
NDBC_PAGE_URL = "https://www.ndbc.noaa.gov/station_page.php?station=%s"


def ndbc_station_url(station_id):
    """NDBC station page for a buoy id, or None when there is no id. The twin of
    tide_station_url - see it for why no id is ever hardcoded."""
    sid = str(station_id or "").strip()
    return NDBC_PAGE_URL % sid if sid else None
NDBC_OBS_URL = "https://www.ndbc.noaa.gov/data/realtime2/%s.txt"
ENV_K = 3                      # IDW: blend up to this many nearest stations
ENV_MAX_KM = 120.0             # ignore buoys farther than this
ENV_IDW_POWER = 2.0
_ENV_UA = {"User-Agent": "asv-console/1.0 (+sim environmental data)"}

# --- physics constants (moderate, capped - the boat still holds the line in
#     normal conditions and only struggles in genuinely rough seas) ---------- #
RHO_AIR = 1.225                # kg/m^3
RHO_WATER = 1000.0             # kg/m^3 (fresh water - Great Lakes)
G_ACCEL = 9.81
# Above-water windage silhouette + hull drag come from the active vessel's `hull`
# block (loa/beam/above_water_h/draft/wind_cd/hull_cd); BOAT_*, WIND_A_*, HULL_A_LAT
# and the Cd's are published by apply_vessel() (recomputed on a vessel switch too).
# See vessels/<id>.json.
WAVE_DRIFT_CD = 0.03          # mean wave-drift coeff (small boat, mostly wave-transparent;
                              # kept small so the gusty WIND drives the wandering, not waves)
COAST_END_KN = 1.0            # a coast hands back to powered control here - see the speed
                              # block in SimVcu.tick. Quadratic drag never reaches zero, so
                              # a coast without a speed floor never ends.
LEEWAY_CAP_MS = 0.9           # cap the set (~1.75 kn) - only bites in extreme conditions,
                              # so normal gusts still modulate the set (-> the wander)
WAVE_YAW_DEG = 3.0            # peak oscillatory yaw (deg/s) per m Hs, beam seas
WIND_YAW_DEG = 1.2            # steady weathervane yaw (deg/s) at full beam wind load
GUST_SPEED_AMP = 0.22        # gust factor amplitude (fraction of mean wind)
GUST_VEER_DEG = 12.0         # slow wind-direction veer amplitude (deg)


def _env_http_get(url, timeout=15.0):
    req = urllib.request.Request(url, headers=_ENV_UA)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def _load_ndbc_stations(timeout=30.0):
    """Active NDBC station list (id/lat/lon), cached weekly to charts/."""
    try:
        with open(NDBC_STATIONS_CACHE, "r", encoding="utf-8") as f:
            data = json.load(f)
        if data and time.time() - data.get("_ts", 0) < 7 * 86400:
            return data.get("stations", [])
    except (OSError, ValueError):
        pass
    try:
        xml = _env_http_get(NDBC_STATIONS_URL, timeout)
    except Exception:
        return []
    stations = []
    for tag in re.findall(r"<station\b[^>]*>", xml):
        sid = re.search(r'id="([^"]+)"', tag)
        la = re.search(r'lat="([-0-9.]+)"', tag)
        lo = re.search(r'lon="([-0-9.]+)"', tag)
        if sid and la and lo:
            # NDBC lists coastal/C-MAN ids in lowercase (lwsd1, cman4), but the
            # realtime2 data files are served under UPPERCASE ids - normalise here so
            # the id is canonical for the data URL, the display, and the cache.
            stations.append({"id": sid.group(1).upper(), "lat": float(la.group(1)),
                             "lon": float(lo.group(1))})
    if stations:
        try:
            with open(NDBC_STATIONS_CACHE, "w", encoding="utf-8") as f:
                json.dump({"_ts": time.time(), "stations": stations}, f)
        except OSError:
            pass
    return stations


def _fetch_ndbc_obs(station_id, timeout=15.0):
    """Latest realtime2 row -> {field: float|None}. 'MM' (missing) -> None."""
    try:
        # realtime2 filenames are UPPERCASE; upper() here too so a stale lowercase
        # cache (written before id normalisation) still resolves instead of 404ing.
        txt = _env_http_get(NDBC_OBS_URL % station_id.upper(), timeout)
    except Exception:
        return None
    rows = [ln for ln in txt.splitlines() if ln.strip()]
    if len(rows) < 3 or not rows[0].startswith("#"):
        return None
    hdr = rows[0].lstrip("#").split()
    vals = rows[2].split()                      # rows[1] is the units line
    rec = {}
    for k, v in zip(hdr, vals):
        if v == "MM":
            rec[k] = None
        else:
            try:
                rec[k] = float(v)
            except ValueError:
                rec[k] = None
    return rec


def _idw_weights(items):
    """items: [(dist_km, value...)] -> list of inverse-distance weights (sum 1)."""
    ws = [1.0 / max(0.25, d) ** ENV_IDW_POWER for d, *_ in items]
    s = sum(ws) or 1.0
    return [w / s for w in ws]


def _sea_from_wind(speed_ms):
    """Fetch-limited wind-sea estimate when no buoy reports waves (winter/offline).
    A conservative Pierson-Moskowitz-style relation, deliberately damped for a
    fetch-limited lake. Returns (Hs_m, Tp_s)."""
    hs = min(2.5, 0.015 * speed_ms * speed_ms)  # ~0.7 m at 7 m/s, capped
    tp = max(2.0, 0.55 * speed_ms + 1.5)        # rough period
    return round(hs, 2), round(tp, 1)


def fetch_environment(lat, lon):
    """Nearest-buoy IDW wind + sea state at (lat,lon). Sea state falls back to a
    wind-derived estimate when no buoy reports waves; wind-only if no waves at all;
    honest 'no data' when nothing is reachable."""
    stations = _load_ndbc_stations()
    if not stations:
        return {"ok": False, "source": "none", "note": "no NDBC station list (offline?)"}
    cand = sorted(((_haversine_km(lat, lon, s["lat"], s["lon"]), s) for s in stations),
                  key=lambda t: t[0])
    cand = [(d, s) for d, s in cand if d <= ENV_MAX_KM][:8]
    if not cand:
        return {"ok": False, "source": "none",
                "note": "no NDBC buoy within %d km" % int(ENV_MAX_KM)}
    obs = []
    with ThreadPoolExecutor(max_workers=6) as ex:
        futs = {ex.submit(_fetch_ndbc_obs, s["id"]): (d, s) for d, s in cand}
        for fut in futs:
            d, s = futs[fut]
            try:
                rec = fut.result()
            except Exception:
                rec = None
            if rec:
                obs.append((d, s["id"], rec))
    obs.sort(key=lambda t: t[0])
    # --- wind: IDW the nearest ENV_K stations reporting WDIR+WSPD (as vectors) ---
    windset = [(d, sid, r) for d, sid, r in obs
               if r.get("WDIR") is not None and r.get("WSPD") is not None][:ENV_K]
    wind = None
    if windset:
        ws = _idw_weights(windset)
        u = v = 0.0
        for w, (d, sid, r) in zip(ws, windset):
            toward = math.radians(r["WDIR"] + 180.0)     # WDIR is FROM (meteorological)
            u += w * r["WSPD"] * math.sin(toward)         # east
            v += w * r["WSPD"] * math.cos(toward)         # north
        speed = math.hypot(u, v)
        frm = (math.degrees(math.atan2(u, v)) + 180.0) % 360.0
        wind = {"speed_ms": round(speed, 2), "speed_kn": round(speed * 1.9438, 1),
                "dir_from_deg": round(frm, 0), "stations": [sid for _, sid, _ in windset]}
    # --- sea: IDW WVHT/DPD + MWD (as a direction vector) ------------------------
    seaset = [(d, sid, r) for d, sid, r in obs if r.get("WVHT") is not None][:ENV_K]
    sea = None
    derived = False
    if seaset:
        ws = _idw_weights(seaset)
        hs = tp = 0.0
        du = dv = 0.0
        has_dir = False
        for w, (d, sid, r) in zip(ws, seaset):
            hs += w * r["WVHT"]
            tp += w * (r.get("DPD") or r.get("APD") or 4.0)
            if r.get("MWD") is not None:
                has_dir = True
                a = math.radians(r["MWD"])
                du += w * math.sin(a)
                dv += w * math.cos(a)
        wdir = (math.degrees(math.atan2(du, dv)) % 360.0) if has_dir else \
               (wind["dir_from_deg"] if wind else 0.0)
        sea = {"hs_m": round(hs, 2), "tp_s": round(tp, 1),
               "dir_from_deg": round(wdir, 0), "derived": False,
               "stations": [sid for _, sid, _ in seaset]}
    elif wind:
        hs, tp = _sea_from_wind(wind["speed_ms"])         # no buoy waves -> derive
        sea = {"hs_m": hs, "tp_s": tp, "dir_from_deg": wind["dir_from_deg"],
               "derived": True, "stations": []}
        derived = True
    if not wind and not sea:
        return {"ok": False, "source": "none",
                "note": "buoys reachable but reporting no wind/wave right now"}
    src = "derived" if (derived and not (sea and not sea["derived"])) else "buoy"
    note = "NDBC buoys" + (" (sea state estimated from wind)" if derived else "")
    # WHICH BUOYS, WITH DISTANCES. wind/sea each already carry their own id list, but an
    # id alone cannot say how much a station contributed, and the fourth browser window
    # has to name the PRIMARY (nearest reporting) and disclose the blend behind it - the
    # same shape the water reading has always returned. The wind set leads because wind
    # is what actually pushes the boat; sea is the fallback when only waves are reported.
    used = windset or seaset
    return {"ok": True, "source": src, "note": note, "wind": wind, "sea": sea,
            "station": (used[0][1] if used else None),
            "stations": [{"id": sid, "dist_km": round(d, 1)} for d, sid, _ in used]}


class EnvMonitor:
    """SIM-ONLY ambient environment. Locates the nearest NDBC buoys on the vessel
    fix (IDW-interpolated), refreshing every 20 min / on a >5 km move / on demand.
    SimVcu reads `field()` each tick for the wind + wave vectors it pushes the boat
    with. A manual override (set any of wind/sea by hand) and an enable toggle make
    it easy to demo the effect or run a deterministic (calm) sim. `snapshot()` rides
    Engine.state() as `env`."""

    POLL_S = 1200.0

    def __init__(self):
        self._lock = threading.Lock()
        self._pos = None
        self._last = {"ok": False, "source": "none", "note": "waiting for a GPS fix"}
        self._manual = {}                # partial override: any of wind/sea fields
        self._enabled = True
        self._force = threading.Event()
        self._stop = threading.Event()
        threading.Thread(target=self._loop, daemon=True).start()

    def update_position(self, lat, lon):
        with self._lock:
            old = self._pos
            self._pos = (lat, lon)
        if old is None or _haversine_km(old[0], old[1], lat, lon) > 5.0:
            self._force.set()

    def set_enabled(self, on):
        with self._lock:
            self._enabled = bool(on)

    def set_manual(self, fields):
        """fields: dict possibly with wind_kn, wind_from, hs_m, tp_s, wave_from;
        None/'' clears a field; {'clear': True} drops the whole override."""
        with self._lock:
            if fields.get("clear"):
                self._manual = {}
                return
            m = dict(self._manual)
            for k in ("wind_kn", "wind_from", "hs_m", "tp_s", "wave_from"):
                if k in fields:
                    v = fields[k]
                    if v in (None, ""):
                        m.pop(k, None)
                    else:
                        m[k] = float(v)
            self._manual = m

    def refresh_now(self):
        self._force.set()

    def _effective(self):
        """Merge the manual override over the fetched observation -> the env in
        effect. Returns the display dict."""
        with self._lock:
            base = dict(self._last)
            man = dict(self._manual)
            enabled = self._enabled
        wind = dict(base.get("wind") or {}) if base.get("wind") else None
        sea = dict(base.get("sea") or {}) if base.get("sea") else None
        if man:
            if "wind_kn" in man or "wind_from" in man:
                wind = wind or {"dir_from_deg": 0.0, "speed_kn": 0.0, "speed_ms": 0.0}
                if "wind_kn" in man:
                    wind["speed_kn"] = round(man["wind_kn"], 1)
                    wind["speed_ms"] = round(man["wind_kn"] / 1.9438, 2)
                if "wind_from" in man:
                    wind["dir_from_deg"] = round(man["wind_from"], 0)
            if "hs_m" in man or "tp_s" in man or "wave_from" in man:
                sea = sea or {"hs_m": 0.0, "tp_s": 4.0, "dir_from_deg": 0.0, "derived": False}
                if "hs_m" in man:
                    sea["hs_m"] = round(man["hs_m"], 2)
                if "tp_s" in man:
                    sea["tp_s"] = round(man["tp_s"], 1)
                if "wave_from" in man:
                    sea["dir_from_deg"] = round(man["wave_from"], 0)
        return {"ok": bool(wind or sea) if (base.get("ok") or man) else False,
                "enabled": enabled,
                "source": "manual" if man else base.get("source", "none"),
                "note": ("manual override" if man else base.get("note", "")),
                "wind": wind, "sea": sea,
                # WHICH BUOYS the reading came from, carried through the override layer
                # so the fourth browser window (and the WIND row's provenance) can name
                # the primary and disclose the blend. Kept even under a MANUAL override:
                # the operator has replaced the VALUES, not the geography, and the buoy
                # page is still the right page for where the vessel is.
                "station": base.get("station"),
                "stations": base.get("stations") or []}

    def snapshot(self):
        eff = dict(self._effective())
        # Same rule as the water monitor's `page`: the buoy's own NDBC page, built from the
        # one URL template, so the window and the card can never name different stations.
        eff["page"] = ndbc_station_url(eff.get("station"))
        return eff

    def field(self):
        """Physics view for SimVcu: the wind + wave vectors in effect, or None when
        disabled / calm (so calm reproduces today's clean tracking exactly)."""
        eff = self._effective()
        if not eff["enabled"]:
            return None
        wind = eff.get("wind")
        sea = eff.get("sea")
        ws = (wind or {}).get("speed_ms", 0.0)
        hs = (sea or {}).get("hs_m", 0.0)
        if ws < 0.1 and hs < 0.02:
            return None
        return {
            "wind_from_deg": (wind or {}).get("dir_from_deg", 0.0),
            "wind_speed_ms": ws,
            "wave_from_deg": (sea or {}).get("dir_from_deg", 0.0),
            "hs_m": hs,
            "tp_s": (sea or {}).get("tp_s", 4.0),
        }

    def _loop(self):
        while not self._stop.is_set():
            with self._lock:
                pos = self._pos
                enabled = self._enabled
            if pos and enabled:
                res = fetch_environment(pos[0], pos[1])
                with self._lock:
                    self._last = res
            self._force.wait(self.POLL_S)
            self._force.clear()


ENV = EnvMonitor()


class CurrentsMonitor:
    """Surface CURRENT at the vessel's own position, from a NOAA Operational
    Forecast System (`currents.py`, vendored — see its header).

    SAME SHAPE AS EnvMonitor ON PURPOSE: a position goes in, a background thread does
    the networking, `snapshot()` rides Engine.state(). Nothing here ever blocks a
    request or a telemetry tick — a cycle fetch is a multi-megabyte OPeNDAP read and
    would otherwise stall the console mid-run.

    WHAT IT IS NOT. This is a FORECAST MODEL read at the boat's position, not a
    measurement and not the sim's applied set. The vessel card's SET row is what the
    simulator is actually pushing the boat with; this is what NOAA predicts the water
    is doing there. On a real hull the two answer different questions and both are
    worth having, so they are separate readouts and neither is derived from the other.

    HONESTY, in the order the answers degrade — every one of these is reported rather
    than smoothed into a number:
      * no cycle cached yet (first run, or no network)      -> ok False, "no cycle"
      * the position is outside the model's water (land,
        masked node, or beyond the domain)                  -> ok False, "no model water"
      * the time is outside the cached span                  -> a value, `projected_h`
        non-zero, flagged: `at_best` shifts by whole M2 tidal cycles (0.14-0.21 kt RMS
        against the model's own output, capped at 3 cycles), which beats holding the
        last value or assuming slack. Past the cap it refuses instead of guessing.
    """

    POLL_S = 900.0                       # the model is hourly; a 15 min sample is ample
    REFETCH_KM = 15.0                    # a move this far re-scopes the fetch bbox
    BBOX_DEG = 0.35                      # ~39 km half-box around the boat

    def __init__(self, ofs="dbofs"):
        self._lock = threading.Lock()
        self._pos = None
        self._ofs = ofs
        self._tag = None
        self._cur = None                 # a currents.Currents, or None
        self._box_at = None              # position the cached cycle was scoped to
        self._last = {"ok": False, "source": "none", "note": "waiting for a GPS fix"}
        self._force = threading.Event()
        self._stop = threading.Event()
        threading.Thread(target=self._loop, daemon=True).start()

    def update_position(self, lat, lon):
        with self._lock:
            old = self._pos
            self._pos = (lat, lon)
        if old is None or _haversine_km(old[0], old[1], lat, lon) > self.REFETCH_KM:
            self._force.set()

    def refresh_now(self):
        self._force.set()
    def set_ofs(self, ofs):
        """Point at another NOAA model - an operating port carries its own (see
        validate_port). Drops the cached cycle: it belongs to the old grid."""
        ofs = (ofs or "").strip().lower()
        if not ofs or ofs == self._ofs:
            return
        with self._lock:
            self._ofs = ofs
            self._cur = None
            self._tag = None
            self._last = {"ok": False, "source": ofs, "note": "switching to %s" % ofs}
        self._force.set()


    def snapshot(self):
        with self._lock:
            return dict(self._last)

    def _sample(self, lat, lon):
        """The reading at (lat, lon) NOW, or an honest refusal. Never raises."""
        cur = self._cur
        if cur is None:
            return {"ok": False, "source": self._ofs, "note": "no cycle cached yet"}
        now = datetime.now(timezone.utc)
        try:
            vals, shift_h = cur.at_best(lat, lon, now)
        except ValueError as e:            # past MAX_PROJECT_CYCLES - a guess has a range
            return {"ok": False, "source": self._ofs, "tag": cur.tag,
                    "note": "no forecast covers now (%s)" % e}
        except Exception as e:
            return {"ok": False, "source": self._ofs, "note": "%s" % type(e).__name__}
        if vals is None:
            return {"ok": False, "source": self._ofs, "tag": cur.tag,
                    "note": "no model water at this position"}
        speed_kn, set_deg = vals[0], vals[1]
        out = {"ok": True, "source": self._ofs, "tag": cur.tag,
               "speed_kn": round(speed_kn, 2), "set_deg": round(set_deg, 1),
               "projected_h": round(shift_h, 2),
               "cycle_start_utc": cur.start.isoformat().replace("+00:00", "Z"),
               "cycle_end_utc": cur.end.isoformat().replace("+00:00", "Z")}
        if abs(shift_h) > 1e-6:
            # NOT a measurement of now - say so in words, not just a number nobody reads
            out["note"] = ("projected %.1f h by tidal cycle (no forecast frame covers now)"
                           % abs(shift_h))
        return out

    def _ensure_cycle(self, lat, lon):
        """Cache a cycle covering NOW, scoped to a box around the boat. Best effort."""
        now = datetime.now(timezone.utc)
        bbox = (lat - self.BBOX_DEG, lon - self.BBOX_DEG,
                lat + self.BBOX_DEG, lon + self.BBOX_DEG)
        try:
            tag, _fetched = currents.ensure_cycle_covering(
                now, now, bbox=bbox, ofs=self._ofs, allow_fetch=True, quiet=True)
        except Exception as e:
            # EVERY LOOKUP FAILURE IS A READOUT STATE, NOT A LOG LINE. What can go wrong
            # here is a property of the DATA, not a bug in the console: the position is
            # outside a regional model's domain, NOAA has posted nothing yet, or the model
            # is shaped in a way the vendored reader does not handle (GOMOFS publishes
            # 3-hourly frames and currents.py assumes hourly - see the note in ports.json).
            # None of that is an exception in serving a request, and printing it as one
            # both spammed the server log every poll AND tripped the "console logged no
            # exception" check four suites rightly enforce. The operator learns about it
            # where they would look for a current - in the current readout.
            msg = "%s" % e
            if "does not overlap" in msg or "outside" in msg:
                note = "%s does not cover this position" % self._ofs
            elif "not hourly" in msg:
                note = "%s frames are not hourly - unreadable by this build" % self._ofs
            else:
                note = "%s: %s" % (type(e).__name__, msg[:90])
            with self._lock:
                self._last = {"ok": False, "source": self._ofs, "note": note}
            return
        if not tag:
            return
        if tag != self._tag or self._cur is None:
            try:
                self._cur = currents.Currents(tag=tag)
                self._tag = tag
                self._box_at = (lat, lon)
                print("[currents] cycle %s (%s .. %s)"
                      % (tag, self._cur.start.strftime("%Y-%m-%d %H:%MZ"),
                         self._cur.end.strftime("%H:%MZ")), file=sys.stderr)
            except Exception as e:
                print("[currents] cycle %s unreadable: %s" % (tag, e), file=sys.stderr)

    def _loop(self):
        while not self._stop.is_set():
            with self._lock:
                pos = self._pos
            if pos:
                self._ensure_cycle(pos[0], pos[1])
                res = self._sample(pos[0], pos[1])
                with self._lock:
                    self._last = res
            self._force.wait(self.POLL_S)
            self._force.clear()


CURRENTS = CurrentsMonitor()
# The active port names its own forecast model, but apply_port ran during import - before
# this line existed - so its CURRENTS.set_ofs was a no-op. Re-apply now that the monitor
# is here. (Boot ORDER, not logic: the same class of trap as the module-global staleness
# that bit HULL_A_LAT.)
apply_port()


def _opt_float(v):
    """None/"" -> None; else float(v). For optional numeric fields in JSON bodies."""
    return None if v in (None, "") else float(v)


# Remote Operations Centers. Global like COMMS / WATER / ENV; the Engine pulls
# ROC.home_intent() every telemetry tick, so a selected ROC owns HOME and - when it
# is a ship - HOME moves and Return-to-Home chases it. Nothing auto-seeds: the
# operator places ROCs by clicking the chart. Its vessel-dependent defaults are
# (re)derived by apply_vessel() -> roc_tracks.configure_vessel().
ROC = roc_tracks.RocTracker(log_dir=LOG_DIR)


# --------------------------------------------------------------------------- #
#  Geodesy helpers (local ENU around a reference latitude - fine at survey scale)
# --------------------------------------------------------------------------- #
M_PER_DEG_LAT = 111320.0


def dest_point(lat, lon, bearing_deg, dist_m):
    """Move dist_m along bearing from (lat,lon) using a local flat approximation."""
    b = math.radians(bearing_deg)
    dn = dist_m * math.cos(b)
    de = dist_m * math.sin(b)
    return (lat + dn / M_PER_DEG_LAT,
            lon + de / (M_PER_DEG_LAT * math.cos(math.radians(lat))))


def range_bearing(lat1, lon1, lat2, lon2):
    """Distance (m) and bearing (deg, 0=N CW) from point 1 to point 2, flat approx."""
    mlat = M_PER_DEG_LAT
    mlon = M_PER_DEG_LAT * math.cos(math.radians((lat1 + lat2) / 2.0))
    dn = (lat2 - lat1) * mlat
    de = (lon2 - lon1) * mlon
    dist = math.hypot(dn, de)
    brg = (math.degrees(math.atan2(de, dn))) % 360.0
    return dist, brg


# --------------------------------------------------------------------------- #
#  VCU command link (the seam) - SimVcu + a honest RealVcu stub               #
# --------------------------------------------------------------------------- #

# SPEED_KN (low/survey/high, knots) comes from the active vessel's `propulsion`
# block, published by apply_vessel(). See vessels/<id>.json.


class VcuProtocolError(Exception):
    """Raised when a real-hardware command/telemetry codec is not yet available.
    Fails honestly rather than emitting an uncertain frame to the boat."""


class VcuLink:
    """Abstract shore-side link to the Autonomous Control Module (serial control link).

    Command methods mutate internal targets; `tick(dt)` advances one telemetry
    cycle and returns a telemetry dict (or {} when nothing to report). The Engine
    owns arming/gating; the link only obeys. Subclasses: SimVcu (full model) and
    RealVcu (transport + honest protocol stubs)."""

    def open(self): ...
    def close(self): ...
    def tick(self, dt):  # -> dict telemetry
        return {}

    # command surface (Engine gates these before calling)
    def upload_plan(self, waypoints, arrival_radius_m, speed, approach_radius_m=None,
                    completion="complete", hold_clear_m=None, coast_from_m=None): ...
    def amend_plan(self, waypoints): ...     # replace the UNFLOWN remainder, keep the run
    def start(self): ...
    def pause(self): ...
    def stop(self): ...
    def estop(self, on): ...
    def set_neutral(self): ...
    def set_approach(self, m): ...          # live-tune the waypoint approach radius
    def set_speed(self, key): ...        # live-tune the commanded speed (low|survey|high)
    def set_unlimited_energy(self, on): ... # sim testing aid (no-op on real hardware)


# SCALE: these defaults are sized for the actual boat - a survey ASV
# class ASV, ~2 m long x 0.75 m beam, used for SHORT surveys in constrained
# waters. Guidance/approach/buffer/pattern defaults are ~boat-length scaled (a
# 2 m boat threads tight marinas), NOT sized for a large survey vessel.
# How close the ASV approaches a waypoint before turning onto the next leg - the
# "approach radius". Kept SEPARATE from the survey arrival_radius_m and entirely
# separate from the Punch-Out obstacle buffer. All of the guidance scale figures
# below are vessel-specific and come from the active vessel file (published by
# apply_vessel()); the comments explain what each one does:
#   WP_APPROACH_M   (maneuvering.approach_m) - how close the ASV follows the line
#     before turning onto the next leg (~0.5 boat length; small so it doesn't cut
#     corners).
#   WP_LOOKAHEAD_M  (maneuvering.lookahead_m) - line-following look-ahead: the
#     guidance aims this far ahead ON the line so the boat tracks the line
#     (correcting cross-track error) instead of steering point-to-point.
#   XTE_KI_DEG / XTE_I_MAX_DEG (autopilot.*) - disturbance rejection for the line
#     follower. The look-ahead LOS alone is proportional-only, so under a CONSTANT
#     wind/wave drift it holds a standing cross-track offset. A slow integrator
#     (PI structure, clamped for anti-windup, reset on upload/start) biases the aim
#     upwind to zero the residual, on top of the crab feedforward in tick().
# See vessels/<id>.json.


class SimVcu(VcuLink):
    """A model of the ASV + VCU good enough to drive and validate the whole
    console with no hardware: a GPS fix from t0, a battery that drains under load,
    and line-following waypoint autonomy that reacts to upload/start/pause/stop/
    estop exactly as the real run-control flow will."""

    # Spawn defaults to the active vessel's `spawn` (SPAWN_LAT/SPAWN_LON); an
    # explicit start_lat/lon still overrides it.
    def __init__(self, start_lat=None, start_lon=None):
        if start_lat is None:
            start_lat = SPAWN_LAT
        if start_lon is None:
            start_lon = SPAWN_LON
        self.lat = start_lat
        self.lon = start_lon
        self.heading = 90.0
        self.sog_kn = 0.0
        self.pitch = 0.0
        self.roll = 0.0
        # Energy state: a draining battery voltage OR a diesel fuel tank (litres),
        # per the active vessel's power.type. Only the relevant one is used.
        self.battery_v = BATT_FULL_V
        self.fuel_l = FUEL_CAPACITY_L
        self.t0 = time.time()
        self._t_sim = 0.0              # accumulated sim time (drives wave/attitude phase)

        self._plan = []                # [{lat,lon}]
        self._arrival_m = 5.0
        self._approach_m = WP_APPROACH_M   # waypoint approach radius (GUI-tunable)
        self._speed_key = "survey"
        self._wp_index = 0
        self._seg_start = {"lat": start_lat, "lon": start_lon}   # current leg origin
        self._completion = "rth"       # complete (stop) | loiter (station-keep) | repeat (loop) | rth
        self._holding = False          # currently station-keeping (loiter reached the end)
        # THE HOLD DISC. `_hold_clear_m` is the radius around the hold point the CONSOLE
        # certified clear of the keep-out model at the operator's buffer (hold.js), or None
        # when no model was consulted. Inside it a straight re-approach is clear by
        # construction; beyond it this model cannot know, so it takes the way off and asks
        # for a routed re-approach (`_hold_wants_route`) - see the station-keep branch.
        self._hold_clear_m = None
        self._hold_wants_route = False # set beyond the certified water: needs a routed return
        # THE DRIFT-IN. `_coast_from_m` is the range from the LAST waypoint at which the
        # console asked for the prop to be stopped; None (the default) is today's behaviour
        # exactly. Once inside it `_coasting` latches and the way comes off under hull drag
        # instead of the engine-governed ramp - see the speed block in tick().
        self._coast_from_m = None
        self._coasting = False
        self._coast_s0 = None          # (lat,lon) at release, for the run made good
        self._laps = 0                 # completed loops (repeat mode)
        self._running = False
        self._paused = False
        self._estop = False
        self._xte_i = 0.0              # XTE integral trim (deg) - see XTE_KI_DEG
        self._drift_en = (0.0, 0.0)    # last tick's environmental drift (m/s east,north)
        self._unlimited_energy = False # testing override: hold energy full, no drain/burn

    def open(self):
        pass

    def close(self):
        pass

    # -- commands ---------------------------------------------------------- #
    def upload_plan(self, waypoints, arrival_radius_m, speed, approach_radius_m=None,
                    completion="complete", hold_clear_m=None, coast_from_m=None):
        self._plan = [{"lat": w["lat"], "lon": w["lon"]} for w in (waypoints or [])]
        self._arrival_m = clamp(float(arrival_radius_m or 5.0), 1.0, 50.0)
        self._approach_m = clamp(float(approach_radius_m or WP_APPROACH_M), 0.5, 50.0)
        self._speed_key = speed if speed in SPEED_KN else "survey"
        self._wp_index = 0
        # completion semantics at the last waypoint (goto/rth/hold -> loiter)
        self._completion = completion if completion in ("complete", "loiter", "repeat", "rth") else "rth"
        self._holding = False
        # None means "no model consulted" and keeps the direct re-approach - the same honest
        # degrade as a Go-To with no route. A number is the console's certified clear disc.
        self._hold_clear_m = None if hold_clear_m is None else max(0.0, float(hold_clear_m))
        self._hold_wants_route = False
        # A FRESH PLAN IS NEVER MID-COAST. None keeps the engine-governed approach exactly as
        # it was; a number is the range from the last waypoint at which to stop the prop.
        self._coast_from_m = None if coast_from_m is None else max(0.0, float(coast_from_m))
        self._coasting = False
        self._coast_s0 = None
        self._laps = 0
        self._xte_i = 0.0              # fresh plan: drop the old trim

    def amend_plan(self, waypoints):
        """Replace the UNFLOWN remainder of the running plan. The run is the same run.

        THE CONSOLE HAD NO WAY TO NUDGE A TRACK, and that is why its clearance guard could
        only slow or stop. Every commanded motion here goes through `upload_plan`, which
        resets `_wp_index` to zero - so the only way to change a running plan was to start
        it again from waypoint one, and the only intervention cheap enough to make in
        anger was the throttle. A hold beside a structure then took the way off a hull the
        tide was already setting (a stopped boat in a 2 kn stream makes 2.00 kn over the
        ground, tests/currents.py), and the survey had to be re-run from the beginning.

        So: the flown prefix is history and is kept, the remainder is replaced, and the
        index does not move. `wp_total` may change - a deviation that splices in a via
        point really does make the plan one waypoint longer, and a card that hid that
        would be lying about the route the boat is flying.

        ⚠ `_seg_start` BECOMES THE BOAT'S PRESENT POSITION, and this is not tidiness. The
        along-track advance test measures from `_seg_start`, so leaving it on the old
        waypoint measures progress along a leg that no longer exists - which on a
        deviation that shortens the leg reads as ALREADY PAST the new waypoint and skips
        it in the same tick it arrived. The new leg starts here, because here is where
        the boat is.

        ⚠ AND IT REFUSES WHEN THERE IS NOTHING TO AMEND. A plan that is not running, or
        one already flown to its end, has no unflown remainder; silently accepting would
        leave the caller believing a deviation had been taken when the boat is
        station-keeping and about to do nothing of the kind.
        """
        wps = [{"lat": w["lat"], "lon": w["lon"]} for w in (waypoints or [])]
        if not wps:
            raise VcuProtocolError("empty amendment")
        if not self._running or self._holding:
            raise VcuProtocolError("no running plan to amend")
        if self._wp_index >= len(self._plan):
            raise VcuProtocolError("the plan has no unflown remainder")
        self._plan = self._plan[:self._wp_index] + wps
        self._seg_start = {"lat": self.lat, "lon": self.lon}
        self._xte_i = 0.0              # a new leg: the old cross-track trim is not its trim
        # ⚠ AN AMENDMENT ENDS THE DRIFT-IN, AND DOES NOT RE-ARM IT. coast.js's own rule is
        # that the coast runs only where the safety ladder is silent - it is an optimisation
        # for benign conditions, and the prop is off, so a coasting hull cannot take a
        # deviation at all. An amendment is the ladder speaking. She powers the last of it
        # under control instead, which is the same arrival every plan had before the coast
        # existed; the console re-solves and re-issues a release range if it still wants one.
        self._coast_from_m = None
        self._coasting = False
        self._coast_s0 = None

    def set_approach(self, m):             # live tuning of the approach radius
        self._approach_m = clamp(float(m), 0.5, 50.0)

    def set_speed(self, key):
        """Live speed change. The commanded speed used to arrive ONLY through
        upload_plan(), so changing it mid-run did nothing at all - the operator moved the
        selector, every planning figure recomputed, and the boat carried on at the speed it
        was uploaded with. Speed is a live command, not a property of the last upload."""
        if key in SPEED_KN:
            self._speed_key = key

    @property
    def speed_key(self):                   # what the boat is ACTUALLY doing, for the state
        return self._speed_key

    def set_unlimited_energy(self, on):    # testing aid: full energy, no drain/burn (any time)
        self._unlimited_energy = bool(on)
        if on:                             # snap the active source to full immediately on enable
            self.battery_v = BATT_FULL_V
            self.fuel_l = FUEL_CAPACITY_L

    def start(self):
        if not self._plan:
            raise VcuProtocolError("no waypoints uploaded")
        self._running = True
        self._paused = False
        self._estop = False
        self._holding = False
        self._laps = 0
        self._xte_i = 0.0
        self._seg_start = {"lat": self.lat, "lon": self.lon}    # first leg: here -> wp0

    def pause(self):
        self._paused = True
        self.sog_kn = 0.0

    def stop(self):
        self._running = False
        self._paused = False
        self._wp_index = 0
        self.sog_kn = 0.0

    def estop(self, on):
        self._estop = bool(on)
        if on:
            self._running = False
            self.sog_kn = 0.0

    def set_neutral(self):
        self._running = False
        self._paused = False
        self.sog_kn = 0.0

    # -- physics tick ------------------------------------------------------ #
    def tick(self, dt):
        moving = self._running and not self._paused and not self._estop and self._plan
        target_kn = SPEED_KN[self._speed_key] if moving else 0.0

        if moving and self._wp_index < len(self._plan):
            wp = self._plan[self._wp_index]
            a = self._seg_start
            seg_len, seg_brg = range_bearing(a["lat"], a["lon"], wp["lat"], wp["lon"])
            dist_b, brg_b = range_bearing(self.lat, self.lon, wp["lat"], wp["lon"])
            if seg_len < 1.0:
                desired, along = brg_b, seg_len           # degenerate leg: aim at wp
                xte = 0.0
            else:
                d_a, brg_a = range_bearing(a["lat"], a["lon"], self.lat, self.lon)
                rel = math.radians(brg_a - seg_brg)
                along = d_a * math.cos(rel)               # along-track distance from A
                xte = d_a * math.sin(rel)                 # signed cross-track (+ = right of line)
                # LINE-FOLLOWING: aim a look-ahead ahead ON the line, so the boat
                # tracks the survey line (pulling out any cross-track error) rather
                # than steering straight at the waypoint.
                tgt = min(seg_len, max(along, 0.0) + WP_LOOKAHEAD_M)
                tlat, tlon = dest_point(a["lat"], a["lon"], seg_brg, tgt)
                _d, desired = range_bearing(self.lat, self.lon, tlat, tlon)
            # `desired` is the ground COURSE we want. A proportional-only LOS must
            # hold a standing XTE under constant wind/wave drift, so:
            # (1) CRAB FEEDFORWARD - solve the drift triangle with last tick's
            #     measured drift and point the bow upwind of the course;
            # (2) XTE INTEGRAL TRIM - slow bias that zeroes the residual.
            self._xte_i = clamp(self._xte_i + XTE_KI_DEG * xte * dt,
                                -XTE_I_MAX_DEG, XTE_I_MAX_DEG)
            de, dn = self._drift_en
            if de or dn:
                v_thru = max(0.4, self.sog_kn * 0.514444)  # through-water speed m/s
                chi = math.radians(desired)
                d_cross = de * math.cos(chi) - dn * math.sin(chi)   # drift, + = right of course
                desired -= math.degrees(math.asin(clamp(d_cross / v_thru, -0.9, 0.9)))
            desired -= self._xte_i
            self.heading = _turn_toward(self.heading, desired, MAX_TURN_RATE_DEG_S * dt)  # vessel turn-rate cap
            # ── THE DRIFT-IN: STOP THE PROP ─────────────────────────────────────────────
            # Latched on the LAST leg only, at the range the console solved for. It is
            # tested HERE, before the waypoint advance below, because that advance sets
            # `_holding` and the station-keep branch is an `elif` - entering from there
            # would be one tick late by construction, and one tick at 4 kn is half a metre.
            #
            # ⚠ NEVER stop()/pause()/set_neutral() to achieve this. All three clear
            # `_running`, which switches OFF both the wind forcing and the tidal stream in
            # the block below - the boat would stop being SET at all, which is the exact
            # opposite of a drift-in, and env_set_kn would read 0.00 while the truth is
            # "the set is no longer modelled". A coast is a state inside a running link.
            if (self._coast_from_m is not None and not self._coasting
                    and COAST_LENGTH_M and self._wp_index == len(self._plan) - 1
                    and dist_b <= self._coast_from_m):
                self._coasting = True
                self._coast_s0 = (self.lat, self.lon)
            # advance once the boat passes the waypoint along-track, or is within the
            # tight approach radius - it follows the line to ~WP_APPROACH_M of the turn
            if along >= seg_len - self._approach_m or dist_b <= self._approach_m:
                self._seg_start = wp
                self._wp_index += 1
                if self._wp_index >= len(self._plan):
                    if self._completion in ("loiter", "rth"):
                        # loiter AND rth: hold here. For "rth" the CONSOLE chains the
                        # real (ENC-routed) Return-to-Home on seeing this hold - so with
                        # no console connected the boat stays safely on station instead
                        # of dashing home on an unrouted straight line.
                        self._holding = True
                    elif self._completion == "repeat":
                        self._wp_index = 0         # loop the route from the present position
                        self._seg_start = {"lat": self.lat, "lon": self.lon}
                        self._laps += 1
                    else:
                        self._running = False      # complete: stop
                        target_kn = 0.0
        elif moving and self._holding and self._plan:
            # STATION-KEEP at the last waypoint, re-approaching when set off it.
            #
            # ⚠ THE RE-APPROACH USED TO BE A RAW BEARING AT ANY RANGE, and that straight
            # return leg through a pier IS the loop Andy photographed at Eastport
            # (2026-09-02). This model has no keep-out model of its own, so it cannot route;
            # what it has is the CONSOLE'S word, given with the plan, on how much water is
            # clear around the hold point (`_hold_clear_m`, hold.js). Inside that disc a
            # straight chord back to the centre is clear by construction - every point of a
            # disc is in the disc - so the direct drive is honest there. Beyond it the boat
            # takes the way off and says so (`hold_wants_route`), and the console answers
            # with a ROUTED re-approach through the same planner every other commanded
            # motion uses (/api/cmd/reapproach). With no certified disc at all (no console,
            # no model) the direct drive stays, exactly as a Go-To with no route drives
            # direct: an honest degrade, not a silent one.
            hp = self._plan[-1]
            dist_h, brg_h = range_bearing(self.lat, self.lon, hp["lat"], hp["lon"])
            if dist_h <= max(self._approach_m, 2.0):
                target_kn = 0.0                    # arrived - hold position
                self._hold_wants_route = False
            elif self._hold_clear_m is None or dist_h <= self._hold_clear_m:
                self.heading = _turn_toward(self.heading, brg_h, MAX_TURN_RATE_DEG_S * dt)
                target_kn = SPEED_KN["low"]
                self._hold_wants_route = False
            else:
                target_kn = 0.0                    # beyond the certified water: no blind drive
                self._hold_wants_route = True

        # ── SPEED: ENGINE-GOVERNED RAMP, OR HULL-GOVERNED DECAY WHILE COASTING ──────────
        #
        # The flat 1.5 kn/s ramp is what an ENGINE does to a speed change, and it stays the
        # default for every other transition in this model. A coast is not a speed change -
        # it is the absence of one - and the hull, not the governor, decides how the way
        # comes off:  m dv/dt = -k v²  ->  dv = -(v²/Lc) dt, one length for the whole curve.
        #
        # ⚠ THE TWO ARE DISTINGUISHABLE AND A SUITE PINS IT. Under drag the distance to HALVE
        # speed is Lc·ln2 whatever you release at; under a ramp it goes as v0², so halving
        # from 14 kn would cost four times halving from 7. tests/coast.js check 3 is that
        # discrimination, and it is what stops the ramp quietly standing in for the physics.
        if self._coasting and COAST_LENGTH_M:
            v = self.sog_kn * 0.514444
            v = max(0.0, v - (v * v / COAST_LENGTH_M) * dt)
            self.sog_kn = v / 0.514444
            # ⚠ THE COAST ENDS ON A SPEED, AND WITHOUT THIS IT WOULD NEVER END AT ALL.
            # Quadratic drag only asymptotes - the way never reaches zero - so a coast with
            # no exit leaves a boat that has stopped short of its berth gliding for ever,
            # never arriving, never holding, with the prop off. Below a walking pace there
            # is no more energy worth shedding, so ordinary powered control takes back
            # whatever distance is left. That handover is also what makes the coast robust
            # to an ESTIMATED coast length: the error moves where this happens, never how
            # fast she is going when it does.
            if self.sog_kn <= COAST_END_KN:
                self._coasting = False
        else:
            # smooth speed toward target
            self.sog_kn += clamp(target_kn - self.sog_kn, -1.5 * dt, 1.5 * dt)
        self._t_sim += dt
        tt = self._t_sim                                  # sim-time phase (tick-rate independent)

        # --- ENVIRONMENTAL FORCING (SIM ONLY) --------------------------------- #
        # Wind on the projected windage silhouette + a wave drift set + an oscillatory
        # wave yaw. The net pushes the boat off course so the line-follower steers
        # continuously (a steady crab + a slight weave). Active only while deployed
        # (running / holding / paused, not stopped or e-stopped) and only when enabled;
        # calm/disabled -> None -> today's clean tracking exactly.
        env = ENV.field() if (self._running and not self._estop) else None
        drift_e = drift_n = set_kn = 0.0
        set_dir = None
        rel_w = beam = 0.0
        if env:
            vb = self.sog_kn * 0.514444                      # boat speed m/s
            hb = math.radians(self.heading)
            vbe, vbn = vb * math.sin(hb), vb * math.cos(hb)
            fe = fn = 0.0
            # Natural gustiness: a slowly-varying gust factor + directional veer on
            # the mean wind (sim-time). A CONSTANT wind gives a constant crab (flat
            # track); a gusty one makes the crab lag and the track meander - THIS is
            # what produces the natural slight wandering the line-follower chases.
            gust = 1.0 + GUST_SPEED_AMP * (math.sin(tt / 17.0) + 0.5 * math.sin(tt / 6.3 + 1.7))
            veer = GUST_VEER_DEG * (math.sin(tt / 23.0 + 0.5) + 0.4 * math.sin(tt / 8.0))
            ws = max(0.0, env["wind_speed_ms"] * gust)
            wfrom = env["wind_from_deg"] + veer
            if ws > 0.05:                                    # WIND on apparent-wind silhouette
                wt = math.radians(wfrom + 180.0)   # blowing TOWARD
                ae, an = ws * math.sin(wt) - vbe, ws * math.cos(wt) - vbn
                arel = math.hypot(ae, an)
                if arel > 0.05:
                    awdir = math.degrees(math.atan2(ae, an))
                    theta = math.radians(((awdir - self.heading + 180.0) % 360.0) - 180.0)
                    a_eff = WIND_A_SIDE * abs(math.sin(theta)) + WIND_A_FRONT * abs(math.cos(theta))
                    fw = 0.5 * RHO_AIR * WIND_CD * a_eff * arel * arel
                    fe += fw * ae / arel
                    fn += fw * an / arel
            hs = env["hs_m"]
            if hs > 0.02:                                    # WAVE mean drift ~ Hs^2, toward propagation
                rel_w = math.radians(env["wave_from_deg"] - self.heading)
                beam = abs(math.sin(rel_w))
                wvt = math.radians(env["wave_from_deg"] + 180.0)
                fd = 0.5 * RHO_WATER * G_ACCEL * (hs * 0.5) ** 2 * BOAT_BEAM_M * WAVE_DRIFT_CD
                fe += fd * math.sin(wvt)
                fn += fd * math.cos(wvt)
            fmag = math.hypot(fe, fn)
            if fmag > 0.01:                                  # terminal leeway from quadratic hull drag
                vdr = min(LEEWAY_CAP_MS, math.sqrt(fmag / (0.5 * RHO_WATER * HULL_CD * HULL_A_LAT)))
                drift_e, drift_n = vdr * fe / fmag, vdr * fn / fmag
            yaw = 0.0                                        # weathervane + oscillatory wave yaw
            if ws > 0.05:
                lat_f = -math.sin(hb) * fe + math.cos(hb) * fn
                yaw += WIND_YAW_DEG * clamp(lat_f / 25.0, -1.0, 1.0)
            if hs > 0.02:
                yaw += WAVE_YAW_DEG * hs * beam * math.sin(2 * math.pi * tt / max(2.0, env["tp_s"]))
            self.heading = (self.heading + yaw * dt) % 360.0
            self.pitch = round(0.4 * math.sin(tt * 0.5) + 1.6 * hs * math.cos(rel_w) * math.sin(tt * 1.1), 1)
            self.roll = round(0.6 * math.sin(tt * 0.37 + 1.0) + 3.5 * hs * beam * math.sin(tt * 0.9 + 1.0), 1)
        else:
            self.pitch = round(1.2 * math.sin(tt * 0.5), 1)
            self.roll = round(2.0 * math.sin(tt * 0.37 + 1.0), 1)

        # ── TIDAL STREAM: ADVECTION, NOT A FORCE ─────────────────────────────────────
        #
        # Andy, 2026-09-02: *"current should absolutely drive sim drift too."*
        #
        # ⚠ IT IS ADDED TO THE GROUND VELOCITY DIRECTLY, AND SUMMING IT INTO `fe`/`fn`
        # WITH THE WIND WOULD HAVE MADE IT ALL BUT VANISH. Wind and waves push a hull
        # THROUGH the water, so they reach a terminal leeway set by quadratic hull drag -
        # that is what the block above computes. A current does nothing of the kind: it
        # moves the water the hull is floating in. A boat lying stopped in a 3 kn stream
        # goes 3 kn over the ground with NO force on it at all, and pushed through the
        # leeway equation that same 3 kn would come out a small fraction of a knot.
        #
        # This is also what makes "stop the boat" an unsafe answer near a structure, which
        # is the whole reason the run-time guard is allowed the helm: with way off, the
        # vessel does not hold - it is set, bodily, at the stream's own rate.
        cur = CURRENTS.snapshot() if self._running and not self._estop else None
        cur_e = cur_n = 0.0
        if cur and cur.get("ok") and cur.get("speed_kn"):
            # `set_deg` is the mariner's SET: the direction the stream flows TOWARD.
            cv = float(cur["speed_kn"]) * 0.514444
            ct = math.radians(float(cur.get("set_deg") or 0.0))
            cur_e, cur_n = cv * math.sin(ct), cv * math.cos(ct)
            drift_e += cur_e
            drift_n += cur_n
        # THE CARD SAYS "SET", SO IT MUST REPORT THE WHOLE SET. Reported from the summed
        # ground drift - leeway plus stream - rather than from the wind/wave force alone,
        # which is what it used to show under a label that promises more than that.
        dmag = math.hypot(drift_e, drift_n)
        if dmag > 1e-4:
            set_kn = dmag * 1.9438
            set_dir = math.degrees(math.atan2(drift_e, drift_n)) % 360.0

        # integrate position: forward thrust along heading + environmental leeway set
        p_lat, p_lon = self.lat, self.lon
        if self.sog_kn > 0.02:
            self.lat, self.lon = dest_point(self.lat, self.lon, self.heading,
                                            self.sog_kn * 0.514444 * dt)  # kn -> m/s
        if drift_e or drift_n:
            self.lat += drift_n * dt / M_PER_DEG_LAT
            self.lon += drift_e * dt / (M_PER_DEG_LAT * math.cos(math.radians(self.lat)))
        # remember this tick's drift for next tick's crab feedforward (one-tick lag
        # = the same delayed estimate a real boat gets from COG-vs-heading)
        self._drift_en = (drift_e, drift_n)
        # Energy burn: battery voltage sags linearly with load; diesel burns fuel at
        # a rate that climbs ~cubically with speed (idle hotel load -> full-throttle).
        # The unlimited-energy testing override holds the active source at full and
        # skips the drain/burn entirely (both sources, so it works on any vessel).
        if self._unlimited_energy:
            self.battery_v = BATT_FULL_V
            self.fuel_l = FUEL_CAPACITY_L
        elif POWER_TYPE == "fuel":
            frac = clamp(self.sog_kn / max(1e-6, SPEED_KN["high"]), 0.0, 1.0)
            burn_lph = FUEL_BURN_IDLE + (FUEL_BURN_FULL - FUEL_BURN_IDLE) * (frac ** FUEL_BURN_EXP)
            self.fuel_l = max(0.0, self.fuel_l - burn_lph * dt / 3600.0)
        else:
            drain = (DRAIN_IDLE + DRAIN_LOAD * (self.sog_kn / max(1e-6, SPEED_KN["high"]))) * dt
            self.battery_v = max(BATT_EMPTY_V, self.battery_v - drain)

        # COG + true SOG from the ACTUAL ground track (forward thrust + environmental
        # leeway): SOG over ground includes the drift, so it differs from the boat's
        # commanded through-water speed (`self.sog_kn`, kept for the dynamics/battery),
        # and is non-zero even when drifting with the motors stopped. COG differs from
        # heading by the crab angle when wind/waves set the boat off its bow line.
        gd, gb = range_bearing(p_lat, p_lon, self.lat, self.lon)
        sog_ground = (gd / dt) * 1.9438 if dt > 1e-6 else 0.0   # m/s -> kn
        # Range to the hold point, measured HERE from the position just integrated rather
        # than remembered from the station-keep branch - which on the arrival tick has not
        # run yet, and would publish a hold with no range beside it.
        off_station = (range_bearing(self.lat, self.lon, self._plan[-1]["lat"], self._plan[-1]["lon"])[0]
                       if self._holding and self._plan else None)
        cog = gb if gd > 0.02 else (self.heading if self.sog_kn > 0.05 else None)
        crab = (((self.heading - cog + 180.0) % 360.0) - 180.0) if cog is not None else None
        return {
            "lat_deg": round(self.lat, 6),
            "lon_deg": round(self.lon, 6),
            "heading_deg": round(self.heading, 1),
            "cog_deg": round(cog, 1) if cog is not None else None,
            "sog_kn": round(sog_ground, 2),        # true speed over ground (incl. drift)
            # The COMMANDED speed the boat is running to, and its value in knots. Published
            # so the console can show the operator's selector against what the boat is
            # actually doing rather than assuming they agree - they did not, for as long as
            # a live speed change went nowhere.
            "speed_key": self._speed_key,
            "speed_target_kn": round(SPEED_KN.get(self._speed_key, 0.0), 2),
            "pitch_deg": self.pitch,
            "roll_deg": self.roll,
            "energy_type": POWER_TYPE,
            # battery vessels report a voltage; fuel vessels report tank litres (the
            # other stays None so state()/UI shows only the relevant gauge)
            "battery_v": round(self.battery_v, 2) if POWER_TYPE == "battery" else None,
            "fuel_l": round(self.fuel_l, 1) if POWER_TYPE == "fuel" else None,
            "unlimited_energy": self._unlimited_energy,
            "time": time.strftime("%H:%M:%S", time.gmtime()),
            "wp_index": self._wp_index,
            "wp_total": len(self._plan),
            "running": self._running,
            "paused": self._paused,
            "estop": self._estop,
            "holding": self._holding,
            # THE DRIFT-IN, STATED. `drifting` is the propulsion-off state the mission card
            # has had a branch for since long before anything could set it - "DRIFT -
            # propulsion off, drifting with the environment" was unreachable until this
            # manoeuvre gave it a producer. `coast_run_m` is what she has actually made good
            # since the prop stopped, which is the number a coast-down trial reads off.
            "drifting": bool(self._coasting),
            "coast_run_m": (round(range_bearing(self._coast_s0[0], self._coast_s0[1],
                                                self.lat, self.lon)[0], 1)
                            if self._coasting and self._coast_s0 else None),
            "coast_length_m": (round(COAST_LENGTH_M, 1) if COAST_LENGTH_M else None),
            # THE HOLD, STATED: where it is, how far off it the boat is, how much water the
            # console certified around it, and whether the boat is beyond that water and
            # waiting for a routed way back. Published so the console can act on the last
            # of these and the operator can read all four.
            "hold": ({"lat": self._plan[-1]["lat"], "lon": self._plan[-1]["lon"]}
                     if self._holding and self._plan else None),
            "off_station_m": round(off_station, 1) if off_station is not None else None,
            "hold_clear_m": (round(self._hold_clear_m, 1)
                             if self._hold_clear_m is not None else None),
            "hold_wants_route": bool(self._holding and self._hold_wants_route),
            "completion": self._completion,
            "laps": self._laps,
            "env_set_kn": round(set_kn, 2),
            "env_set_deg": round(set_dir, 0) if set_dir is not None else None,
            "crab_deg": round(crab, 1) if crab is not None else None,
        }


def _turn_toward(cur, target, max_step):
    """Rotate heading `cur` toward `target` by at most max_step degrees."""
    d = ((target - cur + 540.0) % 360.0) - 180.0
    d = clamp(d, -max_step, max_step)
    return (cur + d) % 360.0


class RealVcu(VcuLink):
    """Shore-side link to a real VCU over serial-over-IP (TCP) or a serial COM
    port. PHASE 0: the transport is opened for reachability, but the command and
    telemetry codecs are NOT yet implemented - the serial control link wire format is
    proprietary and must be reverse-engineered from a live capture (PLAN.md §8).
    Every command therefore raises VcuProtocolError instead of sending an
    uncertain frame, and tick() returns no fake telemetry."""

    def __init__(self, host, port, transport="tcp", timeout=2.0):
        self.host, self.port, self.transport, self.timeout = host, int(port), transport, timeout
        self.sock = None
        self.reachable = False
        self.note = "protocol pending"

    def open(self):
        if self.transport != "tcp":
            self.note = "serial COM transport not wired in Phase 0 - use --transport tcp"
            self.reachable = False
            return
        try:
            self.sock = socket.create_connection((self.host, self.port), timeout=self.timeout)
            self.reachable = True
            self.note = ("transport reachable at %s:%d - VCU wire protocol not yet "
                         "implemented (Phase 0). Telemetry/commands disabled; run --sim."
                         % (self.host, self.port))
        except OSError as e:
            self.reachable = False
            self.note = "unreachable at %s:%d (%s)" % (self.host, self.port, e)

    def close(self):
        try:
            if self.sock:
                self.sock.close()
        except OSError:
            pass
        self.sock = None

    def tick(self, dt):
        # No telemetry codec yet - do not fabricate a position.
        return {}

    def _blocked(self):
        raise VcuProtocolError(
            "VCU serial control link wire protocol not yet reverse-engineered - commanding a "
            "real boat is disabled in Phase 0. Capture ASV Control <-> boat "
            "traffic to unblock (see PLAN.md §8). Use --sim to rehearse.")

    def upload_plan(self, *a, **k): self._blocked()
    def start(self): self._blocked()
    def pause(self): self._blocked()
    def stop(self): self._blocked()
    def estop(self, on): self._blocked()
    def set_speed(self, key): self._blocked()
    def set_neutral(self): pass


# --------------------------------------------------------------------------- #
#  Engine: link ownership, SSE pub/sub, arming + run-control state machine     #
# --------------------------------------------------------------------------- #

class Engine:
    LINK_IDLE = "idle"
    LINK_OK = "ok"
    LINK_LOST = "lost"

    TICK_HZ = 4.0
    MISS_LOST = 12          # ticks with no telemetry -> link lost

    def __init__(self):
        self._lock = threading.Lock()
        self._link = None
        self._mode = None          # "sim" | "tcp" | "serial"
        self._host = None
        self._port = None
        self._stop = threading.Event()
        self._thread = None

        self._subscribers = []
        self._sub_lock = threading.Lock()

        # authoritative C2 state (Engine owns; link obeys)
        self.armed = False
        self.estop = False
        self.plan_uploaded = False
        self.run = "idle"          # idle | running | paused | stopped | complete
        self.behavior = "survey"   # survey | goto | rth | hold (active behavior)
        # WHAT THE RUN CURRENTLY IN PROGRESS DOES AT ITS END - transient, and rewritten
        # by every command. It is NOT the operator's end-of-plan SETTING: that lives in
        # the mission store and is read via plan_completion(). One field serving both
        # roles is exactly how "End of Plan: RTH" came back as loiter - a Go-To sets
        # loiter (correctly, for a Go-To) and used to clobber the setting with it.
        self.run_completion = "rth"   # complete | loiter | repeat | rth
        self.home = None           # {lat,lon} launch/home point (auto-set on 1st fix)
        # A selected ROC OWNS home: its arrival point overrides the first-fix launch
        # point, and for a ship (Mothership) it moves every tick, so a running RTH
        # re-targets the boat at it. Injected in main() - see set_home_provider.
        self.home_provider = None      # callable -> {roc_id,name,kind,moving,point} | None
        self.home_source = None        # None (first fix / manual) | the active ROC id
        self._rth_follow = False       # True while RTH is chasing a moving home
        self._rth_last_target = None   # last arrival point issued to the link (drift throttle)
        self._rth_params = None        # captured run params (arrival/speed/approach) for the chase
        self.link = self.LINK_IDLE
        self.note = "Not connected."
        self.status = {}           # latest telemetry
        self.wp_index = 0
        self.wp_total = 0
        self._misses = 0
        # Identity of the current link session. A fresh value on every connect() -
        # and Reset reconnects - so the browser can tell a power-cycle from a resume
        # and drop the stale trail (see checkBoot in asv.html). Starts at BOOT_ID.
        self.boot_id = BOOT_ID
        # Energy override (testing aid): report the pack/tank as full regardless of
        # the real reading, and (in sim) stop the drain/burn. Applies in EVERY mode
        # and to every behaviour - see set_energy_override / state().
        self.energy_override = False

    # -- SSE plumbing ------------------------------------------------------ #
    def subscribe(self):
        q = queue.Queue(maxsize=4)
        with self._sub_lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q):
        with self._sub_lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def _publish(self, event):
        data = json.dumps(event)
        with self._sub_lock:
            subs = list(self._subscribers)
        for q in subs:
            try:
                q.put_nowait(data)
            except queue.Full:
                try:
                    q.get_nowait(); q.put_nowait(data)
                except queue.Empty:
                    pass

    def _push_state(self):
        ev = self.state()
        self._publish(ev)
        if LOG is not None:
            LOG.state(ev)

    # -- connection -------------------------------------------------------- #
    def connect(self, mode, host, port, transport, spawn=None):
        """`spawn` = {"lat":..,"lon":..} places a NEW sim boat there instead of at the
        active vessel's configured spawn - the click-to-spawn path. Ignored for a real
        link. The per-vessel default still lives in vessels/<id>.json - each profile
        carries its own operating area."""
        self.disconnect()
        with self._lock:
            self._mode = mode
            self._host = host
            self._port = int(port) if port else DEFAULT_VCU_PORT
            if mode == "sim":
                self._link = (SimVcu(float(spawn["lat"]), float(spawn["lon"]))
                              if spawn else SimVcu())
                self.note = "Simulator connected. No hardware in the loop."
            else:
                self._link = RealVcu(host, self._port, transport=transport)
                self.note = "Connecting to VCU %s:%s (%s)..." % (host, self._port, transport)
            self._link.open()
            if isinstance(self._link, RealVcu):
                self.note = self._link.note
            # a fresh link always comes up SAFE
            self.armed = False
            self.estop = False
            self.plan_uploaded = False
            self.run = "idle"
            self.wp_index = self.wp_total = 0
            self._misses = 0
            # ... and with NO telemetry: status was only ever ASSIGNED on a frame, so
            # the previous link's last fix survived into the new link's life - and a
            # link that never produces telemetry (RealVcu in Phase 0) served the DEAD
            # boat's position to anything that read status, Set-Home included. The new
            # boot_id already tells the browser to drop the old trail; this is the same
            # rule server-side.
            self.status = {}
            # new link session = new identity (a Reset reconnects, so the browser
            # sees the id change and drops the previous trail)
            self.boot_id = "%d-%d" % (os.getpid(), int(time.time() * 1000))
            self.link = self.LINK_IDLE
            self._stop.clear()
            self._thread = threading.Thread(target=self._run, daemon=True)
            self._thread.start()
        if LOG is not None:
            LOG.event("connect", mode=mode, host=host or None,
                      port=self._port, transport=transport)
        self._push_state()

    def disconnect(self):
        with self._lock:
            self._stop.set()
            t = self._thread
        if t is not None:
            t.join(timeout=2.0)
        if t is not None and LOG is not None:      # only when a link really existed
            LOG.event("disconnect", mode=self._mode)
        with self._lock:
            if self._link is not None:
                try:
                    self._link.set_neutral(); self._link.close()
                except Exception:
                    pass
            self._link = None
            self._thread = None
            self.armed = False
            self.run = "idle"
            self.link = self.LINK_IDLE
            self.note = "Disconnected."
        self._push_state()

    # -- command surface (arming + gates) ---------------------------------- #
    def _require(self, cond, msg):
        if not cond:
            raise VcuProtocolError(msg)

    def set_home_provider(self, fn):
        """Inject the ROC tracker's home_intent getter (see main())."""
        self.home_provider = fn

    def set_armed(self, on):
        with self._lock:
            link = self._link
            self._require(link is not None, "not connected")
            if on:
                self._require(not self.estop, "clear E-STOP before arming")
                self.armed = True
                self.note = "ARMED. Confirm the RC Autonomy switch (Sw A) is forward."
            else:
                self.armed = False
                self.run = "idle"
                if link:
                    link.set_neutral()
                self.note = "SAFE (disarmed)."
        self._push_state()

    @staticmethod
    def _hold_clear(v):
        """The console's certified clear radius around a hold point, or None when it sent
        none. Validated as INPUT here, for the same reason set_home validates a coordinate:
        a non-numeric value would otherwise become a 500 from the dispatch catch-all - the
        handler falling over rather than refusing - and a negative or non-finite one would
        reach the vessel's own arithmetic."""
        if v is None or v == "":
            return None
        try:
            f = float(v)
        except (TypeError, ValueError):
            raise VcuProtocolError("hold_clear_m must be numeric (metres), or absent")
        if not math.isfinite(f) or f < 0.0:
            raise VcuProtocolError("hold_clear_m must be a finite, non-negative number of metres")
        return f

    @staticmethod
    def _coast_from(v):
        """The range at which to stop the prop, or None for a powered approach. Validated
        here for the same reason as _hold_clear: a bad value must be a refusal in words, not
        a 500 from the dispatch catch-all, and must never reach the vessel's arithmetic."""
        if v is None or v == "":
            return None
        try:
            f = float(v)
        except (TypeError, ValueError):
            raise VcuProtocolError("coast_from_m must be numeric (metres), or absent")
        if not math.isfinite(f) or f < 0.0:
            raise VcuProtocolError("coast_from_m must be a finite, non-negative number of metres")
        return f

    def upload(self, route=None, hold_clear_m=None):
        hold_clear_m = self._hold_clear(hold_clear_m)
        with self._lock:
            link = self._link
            self._require(link is not None, "not connected")
            self._require(self.armed, "ARM before uploading a plan")
            self._require(not self.estop, "clear E-STOP first")
            m = load_mission()
            # `route` (if given) is the client's ENC-aware run path: the mission
            # waypoints with obstacle-avoidance detours inserted AND the approach
            # from the present position routed clear of land / nogo. Fall back to
            # the raw mission waypoints when no routed plan is supplied.
            wpts = self._sanitize_route(route) if route else (m.get("waypoints") or [])
            self._require(len(wpts) >= 1, "add at least one waypoint first")
            self.run_completion = plan_completion()   # a plan run honours the setting
            # THE RUN STARTS WITH AN APPROACH, so it is uploaded at the TRANSIT speed. The
            # console's governor re-asserts the right role on the first telemetry frame
            # either way, but starting the boat at the survey speed for a 30-minute transit
            # out is a real cost for the seconds before that frame arrives, and it is the
            # value that shows on the vessel card the instant the plan is uploaded.
            _sp = _norm_speeds(m.get("speeds"), m.get("speed", "survey"))
            link.upload_plan(wpts, m.get("arrival_radius_m", 2.0), _sp["transit"],
                             m.get("approach_radius_m", WP_APPROACH_M), completion=self.run_completion,
                             hold_clear_m=hold_clear_m)
            self.plan_uploaded = True
            self.wp_total = len(wpts)
            self.wp_index = 0
            self.note = "Run plan uploaded (%d waypoints%s, %s)." % (
                len(wpts), " · ENC-routed" if route else "", self.run_completion)
        self._push_state()

    def set_approach(self, m):
        """Live-tune the waypoint approach radius on the connected link (sim)."""
        with self._lock:
            if self._link is not None:
                try:
                    self._link.set_approach(m)
                except Exception:
                    pass

    def set_speed(self, key):
        """Live speed change: command the link AND persist what the boat is now commanded.

        ⚠ WHAT IS PERSISTED HERE IS `speed`, AND `speed` IS NO LONGER THE OPERATOR'S
        SETTING (2026-08-31). It used to be both, and this docstring used to say the plan
        speed was one concept. It is two now: `speeds` holds the operator's three role
        choices (transit / turn / survey) and is written only by the survey card, while
        `speed` is what the vessel was last told - which the console's speed GOVERNOR
        changes every time the run moves between coverage, a turn and a transit, and which
        the clearance guard overrides for safety. Writing that stream of commanded values
        into the operator's setting would eat their choice several times a minute; the
        completion field is the same lesson (see plan_completion). save_mission carries
        `speeds` through untouched, which is what keeps them apart.
        """
        if key not in SPEED_KN:
            raise VcuProtocolError("unknown speed %r (want one of %s)" % (key, ", ".join(sorted(SPEED_KN))))
        m = load_mission()
        m["speed"] = key
        save_mission(m)
        with self._lock:
            if self._link is not None:
                try:
                    self._link.set_speed(key)
                except VcuProtocolError:
                    raise
                except Exception:
                    pass
            self.note = "Speed: %s (%.1f kn) - applied live." % (key, SPEED_KN[key])
        self._push_state()

    def set_energy_override(self, on):
        """Energy override (testing aid): report the pack/tank as full regardless of
        the real reading, and - in sim - stop the drain/burn. Applies in EVERY mode and
        to every behaviour, mission running or not: it just forces the energy the console
        sees (battery voltage or fuel tank, whichever the vessel uses). Not gated on
        connection or mode."""
        on = bool(on)
        with self._lock:
            self.energy_override = on
            link = self._link
        if link is not None:
            try:
                link.set_unlimited_energy(on)   # sim: hold at full; real: no-op
            except Exception:
                pass
        with self._lock:
            self.note = ("Energy override ON - reporting full (all modes)." if on
                         else "Energy override OFF - actual energy reported.")
        self._push_state()

    def start(self):
        with self._lock:
            link = self._link
            self._require(link is not None, "not connected")
            self._require(self.armed, "ARM before starting")
            self._require(self.plan_uploaded, "upload a run plan first")
            self._require(not self.estop, "clear E-STOP first")
            link.start()
            self.run = "running"
            self.behavior = "survey"
            self.note = {"complete": "Survey started.",
                         "loiter": "Survey started (will loiter / station-keep at the end).",
                         "repeat": "Survey started (will repeat the route).",
                         "rth": "Survey started (will Return-to-Home at the end)."}.get(
                             self.run_completion, "Survey started.")
        self._push_state()

    # -- generalized behaviors (route + station-keep) ---------------------- #
    def _run_route(self, route, behavior, note, hold_clear_m=None, coast_from_m=None):
        """Arm-gated: push a behavior route to the link and run it, holding at the
        end. Shared by Go-To / Return-to-Home / Hold / Transit / the routed re-approach.
        `hold_clear_m` is the console's certified clear disc around the end point (see
        SimVcu's station-keep branch); None keeps the vessel's direct re-approach.
        `coast_from_m` is the range from the last waypoint at which to stop the prop and
        come in on the drift (coast.js solved it); None powers in exactly as before."""
        hold_clear_m = self._hold_clear(hold_clear_m)
        coast_from_m = self._coast_from(coast_from_m)
        with self._lock:
            link = self._link
            self._require(link is not None, "not connected")
            self._require(self.armed, "ARM before commanding the boat")
            self._require(not self.estop, "clear E-STOP first")
            m = load_mission()
            link.upload_plan(route, m.get("arrival_radius_m", 2.0), m.get("speed", "survey"),
                             m.get("approach_radius_m", WP_APPROACH_M), completion="loiter",
                             hold_clear_m=hold_clear_m, coast_from_m=coast_from_m)
            link.start()
            self.plan_uploaded = True
            # goto/rth/hold/transit always station-keep at their own endpoint. This is
            # the RUN's completion only - the operator's end-of-plan setting is untouched.
            self.run_completion = "loiter"
            self.wp_total = len(route)
            self.wp_index = 0
            self.run = "running"
            self.behavior = behavior
            self.note = note
        self._push_state()

    @staticmethod
    def _sanitize_route(route, limit=1000):
        """Validate a client-supplied waypoint route (ENC-aware detour path) into a
        clean list of {lat,lon} floats. Raises if malformed - the Engine never
        forwards an unvetted route to the link."""
        if not isinstance(route, list) or not route:
            raise VcuProtocolError("empty or malformed route")
        out = []
        for p in route[:limit]:
            try:
                lat, lon = float(p["lat"]), float(p["lon"])
            except (TypeError, KeyError, ValueError):
                raise VcuProtocolError("route waypoint missing numeric lat/lon")
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise VcuProtocolError("route waypoint out of range")
            out.append({"lat": lat, "lon": lon})
        return out

    def go_to(self, lat, lon, route=None, hold_clear_m=None, coast_from_m=None):
        # route (if given) is the client's ENC-aware detour path ending at the point;
        # else drive straight to the point (honest degrade when no nogo model).
        r = self._sanitize_route(route) if route else [{"lat": float(lat), "lon": float(lon)}]
        note = ("Go-To: following the ENC-aware route to the point (%d wpts), will station-keep on arrival." % len(r)
                if route else "Go-To: driving to point, will station-keep on arrival.")
        self._run_route(r, "goto", note, hold_clear_m, coast_from_m)

    def escape(self, lat, lon, hold_clear_m=None):
        """The in-extremis clearance guard's OWN manoeuvre (guard.js escapeCourse, the helm
        rung of clearanceGuard in the page) - never the operator's, and kept structurally
        distinct from go_to() for exactly one reason: `behavior` is "escape", not "goto",
        so its arrival can never be mistaken for an ordinary commanded run.

        An escape that looked like a Go-To used to arrive, hold, and - because the operator's
        standing end-of-plan setting is still "rth" - immediately re-fire the chained
        Return-to-Home, sending the boat straight back toward whatever it had just been
        steered clear of. Measured live, 2026-09-03, at Eastport: escape at 74.8 s, chained
        RTH at 83.9 s, a second escape at 86.9 s - the safety intervention and its own
        undoing, on repeat. The chain-fire condition and rthPending() in the page both
        refuse to act on behavior "escape"; see tests/end_action.js 5b/16b and tests/escape_chain.py.

        Taking the helm is meant to buy the operator's attention, not hand the console
        straight back to whatever was already running - so this holds at the escape point
        and waits. Nothing here re-arms automatically; the operator re-commands."""
        r = [{"lat": float(lat), "lon": float(lon)}]
        self._run_route(r, "escape",
                        "In extremis: steered clear. Holding here - the end-of-plan return "
                        "does not chain from an escape; re-command when ready.", hold_clear_m)

    def transit(self, route, hold_clear_m=None):
        # Follow a single- or multi-segment transit line (ENC-aware route from the
        # client), station-keeping at the end. Independent of any survey plan.
        r = self._sanitize_route(route)
        self._run_route(r, "transit",
                        "Transit: following the route (%d wpts), will station-keep at the end." % len(r),
                        hold_clear_m)

    def hold(self, hold_clear_m=None):
        st = self.status
        if st.get("lat_deg") is None:
            raise VcuProtocolError("no position fix to hold at")
        self._run_route([{"lat": st["lat_deg"], "lon": st["lon_deg"]}], "hold",
                        "Hold: station-keeping at present position.", hold_clear_m)

    def reapproach(self, route, hold_clear_m=None):
        """The ROUTED way back onto station, supplied by the console when the vessel reports
        it has been set beyond the water certified clear around its hold point
        (`hold_wants_route` on the telemetry - see SimVcu's station-keep branch).

        IT KEEPS THE BEHAVIOUR. A Go-To would do the same driving, and would also rename a
        boat holding at HOME after a Return-to-Home as a "goto" on every card - the run is
        still the run it was; this is a leg of it. Gated on the vessel actually HOLDING,
        because outside that state a route arriving here is a command nobody gave."""
        st = self.status
        self._require(bool(st.get("holding")), "the vessel is not station-keeping")
        self._require(not self._rth_follow, "a moving home is re-targeted by the chase, not here")
        r = self._sanitize_route(route)
        self._run_route(r, self.behavior,
                        "Set off station - re-approaching on a routed path (%d wpts)." % len(r),
                        hold_clear_m)

    def amend(self, route, note=None):
        """Deviate the RUNNING plan: replace its unflown remainder, keep everything else.

        The clearance guard's `edge` rung (guard.js edgeAround, clearanceGuard in the page).
        Andy, 2026-09-04: *"Investigate forcing slight deviations in a given track to prevent
        holds when there is still plenty of available water away from the nogo."*

        IT KEEPS THE BEHAVIOUR AND THE RUN, for the same reason reapproach() does: a Go-To
        would do the same driving and would rename a survey a "goto" on every card. This is
        not a new command, it is the same command with a few metres taken out of it - and a
        deviation that re-labelled the run would also re-arm the end-of-plan chain, which is
        the trap the in-extremis escape was rebuilt to avoid.

        ⚠ GATED ON A RUNNING, NON-HOLDING PLAN. A route arriving while the boat is
        station-keeping, paused or stopped is a command nobody gave, and the vessel says so
        rather than quietly accepting it: `amend_plan` refuses the same case a second time,
        so the seam cannot leak if this gate is ever loosened."""
        # ARM FIRST, THEN E-STOP, THEN THE RUN - the same order _run_route uses. Ordering
        # matters to the OPERATOR, not to the logic: whichever gate answers is the sentence
        # they read, and "ARM before commanding the boat" is more use to someone who has not
        # armed than "the vessel is not running a plan" would be.
        self._require(self.armed, "ARM before commanding the boat")
        self._require(not self.estop, "clear E-STOP first")
        self._require(self.run == "running", "the vessel is not running a plan")
        st = self.status
        self._require(not st.get("holding"), "the vessel is station-keeping, not running a plan")
        r = self._sanitize_route(route)
        with self._lock:
            link = self._link
            self._require(link is not None, "not connected")
            link.amend_plan(r)
            # wp_total is read back from the LINK's own state on the next tick; setting it
            # here from the amendment alone would be a guess about a plan whose flown prefix
            # this layer does not hold.
            self.note = note or ("Deviation: the remaining track was amended (%d wpts) to keep clear." % len(r))
        self._push_state()

    def set_home(self, lat=None, lon=None):
        """Set HOME at an explicit point, or at the vessel's present position.

        TWO SOURCES FOR ONE FIELD, AND THEY FAIL DIFFERENTLY - which is why the branches
        below stay separate rather than merging. Until 2026-08-08 a supplied position was
        DISCARDED and only the live fix was ever used; the operator asked for the chart's
        right-click point to set HOME, so an explicit lat/lon is now honoured.

        WHAT THAT CHANGES, stated plainly because RETURN-TO-HOME DRIVES TO HOME: an
        explicit point is OPERATOR INPUT landing in a field the vessel will later be sent
        to, and nothing here has checked it against the chart. Two things carry that
        weight instead - the CLIENT warns when the chosen point sits inside the keep-out
        model, and RTH still refuses a route it cannot plan clear. This layer validates it
        as INPUT - numeric, and on the globe, which rejects inf and NaN along with anything
        else out of range because every comparison against NaN is false - and that is all a
        coordinate can honestly be checked for here. It is not cosmetic: a non-finite value
        reaching HOME does not merely set a bad home, it stops the console (see the mutation
        note in tests/home_spawn.py).

        WHAT IT DOES NOT CHANGE: the present-position path keeps BOTH of its guards, and
        they still catch DIFFERENT lies. Without the link check, Set-Home after a
        disconnect "succeeded" - reading the DEAD boat's last fix out of self.status and
        reporting "Home set to present position" about a boat that no longer existed. The
        fix guard stays for a link that is up but has not fixed yet (a real link in Phase 0
        produces no telemetry at all; see connect(), which clears self.status so the
        previous boat's fix cannot stand in). An explicit point is immune to both by
        construction - it never came from telemetry - but still needs a link, because
        setting HOME is commanding where the vessel will return to.
        """
        with self._lock:
            self._require(self._link is not None, "not connected")
            given = (lat is not None) + (lon is not None)
            if given == 1:
                # Half a coordinate is a MALFORMED REQUEST, not an instruction to fall
                # back to the present position. Quietly setting HOME somewhere other than
                # the caller named is the substitution this whole method exists to avoid.
                raise VcuProtocolError("home needs both lat and lon, or neither")
            if given == 0:
                st = self.status
                if st.get("lat_deg") is None:
                    raise VcuProtocolError("no position fix to set home")
                self.home = {"lat": st["lat_deg"], "lon": st["lon_deg"]}
                self.note = "Home set to present position."
            else:
                try:
                    hlat = float(lat)
                    hlon = float(lon)
                except (TypeError, ValueError):
                    raise VcuProtocolError("home needs a numeric lat/lon")
                # ONE range guard, and it covers non-finite values too: inf, -inf and nan
                # all make this comparison False (every nan comparison is), so they are
                # refused here. An isfinite() check alongside it was written first and
                # SURVIVED its own mutation - nothing could reach it that this line did not
                # already reject - so it went. The local guard above matters for a
                # different reason: _dispatch_post has a catch-all that would turn a bare
                # float() failure into a 500, which is the handler falling over rather than
                # refusing, and the session log records the difference.
                if not (-90.0 <= hlat <= 90.0 and -180.0 <= hlon <= 180.0):
                    raise VcuProtocolError("home lat/lon out of range")
                self.home = {"lat": hlat, "lon": hlon}
                self.note = "Home set to the chosen point."
        self._push_state()

    def pause(self):
        with self._lock:
            link = self._link
            self._require(link is not None, "not connected")
            if link:
                link.pause()
            self.run = "paused"
            self.note = "Paused (next waypoint held)."
        self._push_state()

    def stop(self):
        with self._lock:
            link = self._link
            self._require(link is not None, "not connected")
            if link:
                link.stop()
            self.run = "stopped"
            self.note = "Stopped - run plan aborted."
        self._push_state()

    def set_estop(self, on):
        with self._lock:
            link = self._link
            self.estop = bool(on)
            if link:
                link.estop(bool(on))
            if on:
                self.armed = False
                self.run = "idle"
                self.note = ("COMMAND E-STOP latched. NOTE: the RC transmitter E-stop "
                             "is the true failsafe - use it for a real emergency.")
            else:
                self.note = "Command E-STOP released (still SAFE/disarmed)."
        self._push_state()

    def reset(self, spawn=None):
        """Simulator power-cycle: a clean slate as if the boat were shut down and
        restarted. Brings up a FRESH SimVcu (energy full, back at the spawn point,
        no plan) and returns the console to SAFE / idle with no home. Home re-arms
        automatically on the next fix. SIM ONLY - a real boat can't be teleported and
        its battery/fuel can't be refilled from the console, so refuse honestly.
        `spawn` = {"lat":..,"lon":..} brings the boat up THERE instead of at the active
        vessel's configured spawn (click-to-spawn); everything else is identical, so
        placing the boat reuses the power-cycle rather than teleporting a live one."""
        with self._lock:
            mode = self._mode
        self._require(mode == "sim", "Reset is a simulator-only convenience - a real "
                      "boat can't be teleported to spawn or have its energy refilled.")
        # A fresh sim link IS the power-cycle: new SimVcu (full energy, spawn
        # position) + SAFE state. connect() takes its own lock, so call it unlocked.
        self.connect("sim", self._host, self._port, "tcp", spawn=spawn)
        with self._lock:
            self.home = None
            self.behavior = "survey"
            self.run_completion = "complete"
            self.wp_index = self.wp_total = 0
            self.note = ("Spawned here - fresh sim boot: energy full, SAFE, no plan or home."
                         if spawn else
                         "Reset - fresh sim boot: energy full, SAFE, no plan or home.")
        if LOG is not None:
            LOG.event("spawn" if spawn else "reset", **(spawn or {}))
        self._push_state()

    def return_home(self, route=None, hold_clear_m=None, coast_from_m=None):
        # A selected ROC owns HOME? Then RTH targets its LIVE arrival point. For a ship
        # (Mothership) that point moves, so we drive direct and let the run loop chase it
        # - an ENC detour to a moving recovery point would be stale on arrival. A static
        # home keeps the classic behavior (honor the client's ENC-aware route if given).
        intent = self.home_provider() if self.home_provider else None
        follow = bool(intent and intent["point"])
        with self._lock:
            home = intent["point"] if follow else self.home
        if not home:
            raise VcuProtocolError("no home set (no GPS fix yet)")
        if follow:
            r = [{"lat": home["lat"], "lon": home["lon"]}]
            # A moving recovery point the boat cannot overhaul is a plan that never
            # ends - say so rather than let it chase forever. Vessel-dependent: the
            # same ship speed is a non-issue for a fast USV and impossible for a slow one.
            chase = ""
            if intent["moving"]:
                chase = " (MOVING)" if intent.get("closable", True) else (
                    " (MOVING - WARNING: closing at only %.1f kn, the ASV may never overhaul it)"
                    % max(0.0, intent.get("closing_kn", 0.0)))
            note = "Return-to-Home: %s %s%s," % (
                "chasing" if intent["moving"] else "returning to",
                intent["name"] or "the ROC", chase)
        else:
            r = self._sanitize_route(route) if route else [{"lat": home["lat"], "lon": home["lon"]}]
            note = ("Return-to-Home: following the ENC-aware route to home (%d wpts), will station-keep on arrival." % len(r)
                    if route else "Return-to-Home: driving to home, will station-keep on arrival.")
        # A moving home is chased by re-targeting, so no disc is certified for it.
        # A moving recovery point is chased by re-targeting, so neither a certified disc nor
        # a solved coast means anything for it - both are computed against a fixed berth.
        self._run_route(r, "rth", note, None if follow else hold_clear_m,
                        None if follow else coast_from_m)
        with self._lock:
            self._rth_follow = follow
            if follow:
                m = load_mission()
                self._rth_params = {"arrival": m.get("arrival_radius_m", ARRIVAL_DEFAULT_M),
                                    "speed": m.get("speed", "survey"),
                                    "approach": m.get("approach_radius_m", WP_APPROACH_M)}
                self._rth_last_target = dict(home)

    # -- telemetry loop ---------------------------------------------------- #
    def _run(self):
        period = 1.0 / self.TICK_HZ
        last = time.time()
        while not self._stop.is_set():
            time.sleep(period)
            now = time.time()
            dt = now - last
            last = now
            with self._lock:
                link = self._link
            if link is None:
                continue
            try:
                telem = link.tick(dt)
            except Exception as e:
                telem = {}
                with self._lock:
                    self.note = "link error: %s" % e
            # Resolved OUTSIDE the lock: the ROC tracker takes its own, and taking the
            # two in opposite orders anywhere would deadlock the telemetry loop.
            intent = self.home_provider() if self.home_provider else None
            with self._lock:
                if telem:
                    self._misses = 0
                    self.link = self.LINK_OK
                    self.status = telem
                    # A selected ROC drives HOME: its arrival point overrides the
                    # first-fix launch point and, for a ship, moves every tick.
                    if intent is not None:
                        self.home_source = intent["roc_id"]
                        if intent["point"] is not None:
                            self.home = intent["point"]
                    else:
                        self.home_source = None
                    # feed the vessel fix to the water-level link (drives station
                    # selection + refetch); computer clock is implicit (date=latest)
                    if telem.get("lat_deg") is not None and telem.get("lon_deg") is not None:
                        WATER.update_position(telem["lat_deg"], telem["lon_deg"])
                        # SIM-ONLY: locate real weather near the sim vessel so SimVcu
                        # can push it around. Not fed in real mode (real boat, real wx).
                        if self._mode == "sim":
                            ENV.update_position(telem["lat_deg"], telem["lon_deg"])
                        # The CURRENT is fed in BOTH modes, unlike the wind: a real hull
                        # sits in real water, and what NOAA forecasts the tide is doing
                        # under it is exactly as useful there as in the sim (more so).
                        CURRENTS.update_position(telem["lat_deg"], telem["lon_deg"])
                        # first fix = launch/home point - only when no ROC owns HOME
                        if self.home is None and self.home_source is None:
                            self.home = {"lat": telem["lat_deg"], "lon": telem["lon_deg"]}
                    self.wp_index = telem.get("wp_index", self.wp_index)
                    self.wp_total = telem.get("wp_total", self.wp_total)
                    # reflect the boat's reported run state (e.g. survey completed)
                    if telem.get("estop"):
                        self.run = "idle"
                    elif telem.get("paused"):
                        self.run = "paused"
                    elif telem.get("running"):
                        self.run = "running"
                    elif self.run == "running":
                        self.run = "complete"     # ran out of waypoints
                    # MOVING-HOME chase: while an RTH follows a ROC home, keep re-aiming
                    # the boat at the ROC's current arrival point. Re-issue a fresh
                    # single-waypoint plan only when the point has drifted past ~half the
                    # arrival radius - reusing the link's own waypoint-follow, no separate
                    # pursuit controller. Any command that leaves RTH/running clears it.
                    if not (self.behavior == "rth" and self.run == "running"):
                        self._rth_follow = False
                        self._rth_last_target = None
                    elif self._rth_follow and intent and intent["point"]:
                        tgt = intent["point"]
                        p = self._rth_params or {}
                        thresh = max(2.0, float(p.get("arrival", ARRIVAL_DEFAULT_M)) * 0.5)
                        prev = self._rth_last_target
                        moved = (prev is None or
                                 range_bearing(prev["lat"], prev["lon"],
                                               tgt["lat"], tgt["lon"])[0] > thresh)
                        if moved:
                            try:
                                link.upload_plan([{"lat": tgt["lat"], "lon": tgt["lon"]}],
                                                 p.get("arrival", ARRIVAL_DEFAULT_M),
                                                 p.get("speed", "survey"),
                                                 p.get("approach", WP_APPROACH_M),
                                                 completion="loiter")
                                link.start()
                                self._rth_last_target = dict(tgt)
                            except Exception:
                                pass
                else:
                    self._misses += 1
                    if self._misses >= self.MISS_LOST and self.link != self.LINK_LOST:
                        self.link = self.LINK_LOST
                        # link-loss is safe: stop commanding, surface the failsafe
                        self.armed = False
                        self.note = ("LINK LOST - commanding halted. ASV failsafe: "
                                     "motors to 0, steering straight. Take the RC.")
            self._push_state()

    # -- state snapshot for SSE ------------------------------------------- #
    def _autonomy_label(self):
        if self.link == self.LINK_LOST:
            return "failsafe"
        if self.estop:
            return "e-stop"
        if not self.armed:
            return "safe"
        if self.run == "running" and self.status.get("holding"):
            return "hold"          # station-keeping (Hold/Go-To/RTH, or a Survey that loitered)
        return {"running": "auto", "paused": "paused"}.get(self.run, "armed")

    def state(self):
        st = dict(self.status)
        etype = st.get("energy_type", POWER_TYPE)
        if etype == "fuel" and st.get("fuel_l") is not None and FUEL_CAPACITY_L > 0:
            # Diesel: report tank %, and a live endurance (hrs) + range (nm) at the
            # CURRENT speed's burn rate, plus a warn/crit band on the reserve.
            fl = st["fuel_l"]
            st["fuel_pct"] = round(clamp(fl / FUEL_CAPACITY_L * 100.0, 0, 100), 0)
            frac = clamp((st.get("sog_kn") or 0.0) / max(1e-6, SPEED_KN["high"]), 0.0, 1.0)
            burn_lph = FUEL_BURN_IDLE + (FUEL_BURN_FULL - FUEL_BURN_IDLE) * (frac ** FUEL_BURN_EXP)
            st["burn_lph"] = round(burn_lph, 2)
            st["endurance_h"] = round(fl / burn_lph, 1) if burn_lph > 0 else None
            st["range_nm"] = (round(st["endurance_h"] * (st.get("sog_kn") or 0.0), 1)
                              if st.get("endurance_h") is not None else None)
            st["fuel_state"] = ("critical" if st["fuel_pct"] < FUEL_CRIT_FRAC * 100 else
                                "warn" if st["fuel_pct"] < FUEL_WARN_FRAC * 100 else "ok")
        bv = st.get("battery_v")
        if bv is not None and BATT_FULL_V > BATT_EMPTY_V:
            st["battery_pct"] = round(clamp((bv - BATT_EMPTY_V) / (BATT_FULL_V - BATT_EMPTY_V)
                                            * 100.0, 0, 100), 0)
            st["battery_state"] = ("critical" if bv < BATT_CRIT_V else
                                   "warn" if bv < BATT_WARN_V else "ok")
        elif etype != "fuel":
            st["battery_state"] = "unknown"
        # Energy override forces a full reading in every mode (even when the link
        # reports no energy telemetry), so it holds regardless of behaviour. It
        # tops up whichever gauge the active vessel uses.
        if self.energy_override:
            if etype == "fuel":
                st["fuel_l"] = round(FUEL_CAPACITY_L, 1)
                st["fuel_pct"] = 100.0
                st["fuel_state"] = "ok"
            else:
                st["battery_v"] = round(BATT_FULL_V, 2)
                st["battery_pct"] = 100.0
                st["battery_state"] = "ok"
        st["unlimited_energy"] = self.energy_override
        return {
            "type": "state",
            "boot_id": self.boot_id,
            "mode": self._mode,
            "host": self._host,
            "link": self.link,
            "note": self.note,
            "armed": self.armed,
            "estop": self.estop,
            "plan_uploaded": self.plan_uploaded,
            "run": self.run,
            "autonomy": self._autonomy_label(),
            "behavior": self.behavior,
            # Two DIFFERENT things, deliberately both published:
            #   completion      - the operator's END-OF-PLAN SETTING (the mission store).
            #                     The command-bar selector and the end-of-plan RTH chain
            #                     read this, so a Go-To can never appear to change it.
            #   run_completion  - what the run in progress does at ITS end (a Go-To
            #                     station-keeps). The RUN MODE readout shows this.
            "completion": plan_completion(),
            "run_completion": self.run_completion,
            "home": self.home,
            "home_source": self.home_source,      # None (first-fix/manual) | active ROC id
            "home_following": self._rth_follow,   # True while RTH is chasing a moving ROC
            "roc": ROC.snapshot(),                # the ROC set + which one is HOME
            "wp_index": self.wp_index,
            "wp_total": self.wp_total,
            "status": st,
            "comms": COMMS.snapshot(),
            # WHICH STATION WINDOWS THE OPERATOR ASKED FOR. The PAGE owns those windows
            # now (it is the only thing that can re-point one in place), so the
            # --no-tide-window / --no-weather-window flags have to reach it - a flag the
            # server honours and the client does not is a control that half works.
            "station_windows": {"tide": STATION_WINDOWS_ON["tide"],
                                "weather": STATION_WINDOWS_ON["weather"]},
            "water": WATER.snapshot(),
            "env": ENV.snapshot() if self._mode == "sim" else {"ok": False, "source": "off",
                     "enabled": False, "note": "environmental sim (sim mode only)"},
            # Real water, both modes - see CurrentsMonitor. Not gated on `sim`.
            "current": CURRENTS.snapshot(),
        }


ENGINE = Engine()

# --------------------------------------------------------------------------- #
#  HTTP + SSE server                                                          #
# --------------------------------------------------------------------------- #

def load_static(name):
    with open(os.path.join(STATIC_DIR, name), "r", encoding="utf-8") as f:
        return f.read()


INDEX_HTML = load_static("asv.html")


# --------------------------------------------------------------------------- #
#  Playback: read-only access to the recorded session logs (logs/*.jsonl)     #
# --------------------------------------------------------------------------- #
def list_logs():
    """Newest-first list of session recordings in LOG_DIR (name/size/mtime)."""
    out = []
    try:
        names = os.listdir(LOG_DIR)
    except OSError:
        return out
    for name in names:
        if name.startswith("asv_") and name.endswith(".jsonl"):
            try:
                stat = os.stat(os.path.join(LOG_DIR, name))
            except OSError:
                continue
            out.append({"name": name, "size": stat.st_size, "mtime": stat.st_mtime})
    out.sort(key=lambda r: r["mtime"], reverse=True)
    return out


def safe_log_path(name):
    """Resolve a client-supplied log filename to a path inside LOG_DIR, or None.
    Guards against path traversal - only a bare asv_*.jsonl basename is valid."""
    base = os.path.basename(name or "")
    if base != name or not (base.startswith("asv_") and base.endswith(".jsonl")):
        return None
    p = os.path.join(LOG_DIR, base)
    return p if os.path.isfile(p) else None


# The page's ES modules (static/js/*.js). SAME GUARD SHAPE AS safe_log_path, and for the
# same reason: this turns a URL into a filesystem read, so the only defence that holds is
# refusing anything that is not a bare basename from one directory with one extension.
# `os.path.basename(name) != name` rejects every traversal spelling at once (`../`, a
# nested path, an absolute path, a drive letter) without trying to enumerate them.
JS_DIR = os.path.join(STATIC_DIR, "js")
_JS_NAME_RE = re.compile(r"^[a-z][a-z0-9_]*\.js$")      # geodesy.js, units.js, ...


def safe_js_path(name):
    """Resolve a client-supplied module name to a path inside static/js, or None."""
    base = os.path.basename(name or "")
    if base != name or not _JS_NAME_RE.match(base):
        return None
    p = os.path.join(JS_DIR, base)
    return p if os.path.isfile(p) else None


class Server(ThreadingHTTPServer):
    """Threaded HTTP server that swallows benign client-disconnect errors.

    A browser that refreshes/closes a tab, or drops an SSE (`/events`) stream,
    resets the socket while the server is mid-read; stdlib's socketserver then
    prints a scary ConnectionReset/Aborted traceback to stderr even though nothing
    is wrong (each request is its own thread; the server keeps running). Suppress
    exactly those; let any real error surface as usual."""

    daemon_threads = True

    def handle_error(self, request, client_address):
        exc = sys.exc_info()[1]
        if isinstance(exc, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return  # client went away mid-request - normal, not an error
        super().handle_error(request, client_address)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
            raw = self.rfile.read(n) if n else b"{}"
            return json.loads(raw or b"{}")
        except (ValueError, json.JSONDecodeError):
            return {}

    def do_GET(self):
        root = self.path.split("?", 1)[0]            # tolerate a ?cb= cache-buster on the page URL
        if root == "/" or root.startswith("/index"):
            # Read the page fresh each request so edits show up on a browser
            # refresh without a server restart (a single-operator console - the
            # tiny re-read is free, and it avoids serving a stale cached UI).
            try:
                html = load_static("asv.html")
            except OSError:
                html = INDEX_HTML
            self._send(200, html, "text/html; charset=utf-8")
        elif root.startswith("/static/js/"):
            # The page's ES modules. Served fresh per request for the same reason the page
            # is (edits show up on refresh, no restart), and with an explicit JavaScript
            # MIME TYPE because a module script is REFUSED by the browser on anything else
            # - a wrong content type here fails as a blank console, not as a 404.
            p = safe_js_path(root[len("/static/js/"):])
            if not p:
                self._send(404, json.dumps({"error": "no such module"}))
            else:
                try:
                    with open(p, "r", encoding="utf-8") as f:
                        self._send(200, f.read(), "text/javascript; charset=utf-8")
                except OSError:
                    self._send(404, json.dumps({"error": "no such module"}))
        elif self.path == "/playback" or self.path.startswith("/playback?"):
            try:
                html = load_static("playback.html")
            except OSError:
                return self._send(404, json.dumps({"error": "playback.html missing"}))
            self._send(200, html, "text/html; charset=utf-8")
        elif self.path == "/api/logs":
            self._send(200, json.dumps({"logs": list_logs()}))
        elif self.path.startswith("/api/log?"):
            self._serve_log()
        elif self.path == "/api/state":
            self._send(200, json.dumps(ENGINE.state()))
        elif self.path == "/events":
            self._serve_events()
        elif self.path.startswith("/tiles/"):
            self._serve_tile()
        elif self.path.startswith("/api/enc"):
            self._serve_enc()
        elif self.path.startswith("/api/chartinfo"):
            self._serve_chartinfo()
        elif self.path.startswith("/api/waterlevel"):
            self._send(200, json.dumps(WATER.snapshot()))
        elif self.path.startswith("/api/tide"):     # tide-chart series (ENV card)
            force = "force=1" in self.path or "force=true" in self.path
            self._send(200, json.dumps(WATER.tide_series(force=force)))
        elif self.path.startswith("/api/env"):
            self._send(200, json.dumps(ENV.snapshot()))
        elif self.path.startswith("/api/currents"):
            # ?force=1 kicks the background thread rather than fetching inline - a cycle
            # download is multi-megabyte and must never sit on a request.
            if "force=1" in self.path or "force=true" in self.path:
                CURRENTS.refresh_now()
            self._send(200, json.dumps(CURRENTS.snapshot()))
        elif self.path.startswith("/api/ais"):
            self._serve_ais()
        elif self.path == "/api/mission":
            self._send(200, json.dumps(load_mission()))
        elif self.path == "/api/vessel":
            # active vessel (full params for the UI) + the available list (picker)
            self._send(200, json.dumps({"vessel": VESSEL, "active": VESSEL["id"],
                                        "available": list_vessels()}))
        elif self.path == "/api/ports":
            # active operating port + the whole retained list (the picker)
            self._send(200, json.dumps({"active": PORTS.get("active"),
                                        "ports": PORTS.get("ports") or []}))
        elif self.path == "/api/vessels":
            self._send(200, json.dumps({"vessels": list_vessels(), "active": VESSEL["id"]}))
        elif self.path == "/api/comms":
            with COMMS._lock:
                cfg = {"mode": COMMS.mode, "host": COMMS.host, "username": COMMS.username}
            self._send(200, json.dumps({"config": cfg, "status": COMMS.snapshot()}))
        elif self.path == "/api/roc":
            self._send(200, json.dumps(ROC.snapshot()))
        else:
            self._send(404, json.dumps({"error": "not found"}))

    def _serve_tile(self):
        try:
            z, x, y = self.path[len("/tiles/"):-len(".png")].split("/")
            z, x, y = int(z), int(x), int(y)
        except ValueError:
            return self._send(404, json.dumps({"error": "bad tile path"}))
        data = fetch_tile(z, x, y)
        if data is None:
            return self._send(404, json.dumps({"error": "tile unavailable offline"}))
        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=86400")
        self.end_headers()
        self.wfile.write(data)

    def _serve_log(self):
        # /api/log?file=asv_<ts>.jsonl -> the raw JSONL recording (read-only).
        q = urllib.parse.parse_qs(self.path.split("?", 1)[1])
        p = safe_log_path((q.get("file") or [""])[0])
        if not p:
            return self._send(404, json.dumps({"error": "log not found"}))
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = f.read()
        except OSError as e:
            return self._send(500, json.dumps({"error": str(e)}))
        self._send(200, data, "application/x-ndjson; charset=utf-8")

    def _serve_ais(self):
        # /api/ais?center=LAT,LON -> proxy to the standalone AIS service (ais_service.py,
        # AIS_BASE). The console queries the service so the browser never touches the
        # AIS feeds or any API key directly. It also picks the AREA here: on a Great
        # Lake, pull the WHOLE lake (enclosed water); at sea, a 50 km box around the
        # boat. Returns the service's vessels + an `area` tag, or {ok:false} when the
        # service isn't running (the layer just shows "AIS offline").
        qs = self.path.split("?", 1)[1] if "?" in self.path else ""
        params = urllib.parse.parse_qs(qs)
        lat = lon = None
        if params.get("center"):
            try:
                lat, lon = (float(x) for x in params["center"][0].split(","))
            except (ValueError, TypeError):
                lat = lon = None
        if lat is None:
            return self._send(200, json.dumps({"ok": False, "vessels": [], "count": 0,
                              "area": {"mode": "none"}, "note": "no position for the AIS area"}))
        lake = _lake_of(lat, lon)
        if lake:                                     # whole enclosed lake
            a, b, c, d = GREAT_LAKES_BOXES[lake]
            bbox = (c, a, d, b)                       # W,S,E,N
            area = {"mode": "lake", "name": "Lake " + lake.capitalize()}
        else:                                         # open water: the COLLECT box
            rm = AIS_COLLECT_RADIUS_KM * 1000.0
            dlat = rm / 111320.0
            dlon = rm / (111320.0 * max(0.15, math.cos(math.radians(lat))))
            bbox = (lon - dlon, lat - dlat, lon + dlon, lat + dlat)
            # NO display string here. The lake branch's "name" is a real place name the
            # client cannot derive; this one used to be "%g km", which put the CLIENT's
            # choice of unit in the server and made one field mean two different things.
            # The client formats its own label from show_km (it reads in nautical miles).
            area = {"mode": "sea",
                    "show_km": AIS_SHOW_RADIUS_KM, "collect_km": AIS_COLLECT_RADIUS_KM}
        url = "%s/vessels?bbox=%.4f,%.4f,%.4f,%.4f&max=2000" % (
            AIS_BASE.rstrip("/"), bbox[0], bbox[1], bbox[2], bbox[3])
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "asv-console/ais-proxy"})
            with urllib.request.urlopen(req, timeout=6) as r:
                data = json.loads(r.read().decode("utf-8", "replace"))
            # FILTER TO THE OPERATOR'S RADIUS - at sea only. A true great-circle range
            # from the boat, not the collect BOX, so "50 km" means a 50 km circle and the
            # corners of the box are not quietly included. Filtering here rather than in
            # the browser keeps ONE decision about what is displayed, so the chart overlay,
            # the table and the count cannot disagree with each other.
            # On a lake there is no filter: the area IS the lake and every contact stands.
            vs = data.get("vessels") or []
            area["collected"] = len(vs)
            if area.get("mode") == "sea" and AIS_SHOW_RADIUS_KM > 0:
                kept = []
                nearest = None
                for v in vs:
                    try:
                        d_km = _haversine_km(lat, lon, float(v["lat"]), float(v["lon"]))
                    except (KeyError, TypeError, ValueError):
                        continue                  # no usable position: not placeable, not shown
                    # The nearest of everything COLLECTED, not of what survives the filter.
                    # It is what makes an empty card actionable: "none within 27 nm" reads
                    # like a dead feed, while "nearest 44 nm" says widen the range. Measured
                    # at Lewes, where aisstream has no receiver inside 44 nm - the feed was
                    # healthy and the card still looked broken.
                    if nearest is None or d_km < nearest:
                        nearest = d_km
                    if d_km <= AIS_SHOW_RADIUS_KM:
                        v["range_m"] = round(d_km * 1000.0)
                        kept.append(v)
                vs = kept
                data["vessels"] = vs
                data["count"] = len(vs)
                if nearest is not None:
                    area["nearest_km"] = round(nearest, 1)
            area["shown"] = len(vs)
            data["area"] = area
            self._send(200, json.dumps(data), "application/json")
        except Exception as e:
            self._send(200, json.dumps({"ok": False, "vessels": [], "count": 0, "area": area,
                                        "note": "AIS service unreachable at %s (%s)"
                                        % (AIS_BASE, type(e).__name__)}))

    def _bbox_from_query(self):
        """Parse ?bbox=W,S,E,N off self.path - plain commas or %2C, parse_qs decodes
        both. Returns (bbox, query_dict) so a caller can read its own extra params from
        the SAME parse. Raises KeyError/ValueError/IndexError on anything malformed;
        each caller owns its own usage message. ONE function on purpose - _serve_enc and
        _serve_chartinfo carried byte-identical copies of this block (the anchor-x2
        lesson), and a parser fixed in one and not the other is exactly how the
        ais_service percent-decoding bug got to ship."""
        q = urllib.parse.parse_qs(self.path.split("?", 1)[1])
        bbox = [float(v) for v in q["bbox"][0].split(",")]
        if len(bbox) != 4:
            raise ValueError("bbox wants four edges")
        return bbox, q

    def _serve_enc(self):
        # /api/enc?bbox=W,S,E,N&min_depth=X -> role-tagged ENC vector features.
        try:
            bbox, q = self._bbox_from_query()
            min_depth = float(q.get("min_depth", ["0"])[0])
        except (KeyError, ValueError, IndexError):
            return self._send(400, json.dumps({"error": "usage: /api/enc?bbox=W,S,E,N&min_depth=X"}))
        try:
            data = fetch_enc_features(bbox, min_depth)
        except Exception as e:  # never take the server down on a chart fetch
            return self._send(502, json.dumps({"error": str(e)}))
        self._send(200, json.dumps(data))

    def _serve_chartinfo(self):
        # /api/chartinfo?bbox=W,S,E,N -> ENC cells + zone-of-confidence polygons
        # for the Chart source card. Separate from /api/enc by design (see
        # fetch_chart_info): no routing cache is touched.
        try:
            bbox, _ = self._bbox_from_query()
        except (KeyError, ValueError, IndexError):
            return self._send(400, json.dumps({"error": "usage: /api/chartinfo?bbox=W,S,E,N"}))
        try:
            data = fetch_chart_info(bbox)
        except Exception as e:                    # never take the server down on a chart fetch
            return self._send(502, json.dumps({"error": str(e)}))
        self._send(200, json.dumps(data))

    def do_POST(self):
        body = self._read_json()
        code, obj = self._dispatch_post(self.path, body)
        # Record every command / setting / action + its outcome for playback.
        if LOG is not None:
            LOG.command(self.path, body, code,
                        obj.get("error") if isinstance(obj, dict) else None)
        self._send(code, json.dumps(obj))

    def _dispatch_post(self, path, body):
        """Route a POST to its handler; return (http_code, response_obj). Split
        out of do_POST so the session recorder can log a single uniform outcome."""
        if path == "/api/mission":
            save_mission(body)
            return 200, {"ok": True}
        if path == "/api/logevent":
            # Client-supplied structured event for the session log (e.g. the
            # per-survey-line plan-vs-actual table). Recorded as a clean event.
            kind = str(body.get("kind") or "client_event")[:64]
            data = body.get("data") if isinstance(body.get("data"), dict) else {"value": body.get("data")}
            # `data` is CLIENT-supplied and reaches event() as **kwargs, where the keys
            # "kind" and "self" collide with the signature - a legal JSON body was a
            # TypeError that dropped the connection with no response and killed the
            # handler thread (this branch sits before the dispatch try, so nothing
            # caught it; reproduced live before fixing). RENAME rather than refuse: a
            # session log should swallow an odd field name, not reject the operator's
            # event over it - and the flat record shape stays intact for playback.
            data = {(k + "_" if k in ("kind", "self") else k): v for k, v in data.items()}
            if LOG is not None:
                LOG.event("client:" + kind, **data)
            return 200, {"ok": True}
        if path == "/api/vessel":
            # Switch the active vessel. Only when SAFE (disarmed, not e-stopped,
            # idle) - swapping physics under a running boat is incoherent. In sim
            # mode we respawn so the new spawn/params take effect immediately.
            vid = (body.get("id") or "").strip()
            if not vid:
                return 400, {"error": "missing vessel id"}
            st = ENGINE.state()
            if st.get("armed") or st.get("estop") or st.get("run") != "idle":
                return 409, {"error": "disarm and stop the run before switching vessel"}
            try:
                v = load_vessel(vid)
            except (OSError, ValueError) as e:
                return 400, {"error": "vessel '%s': %s" % (vid, e)}
            apply_vessel(v)
            if st.get("mode") == "sim":
                ENGINE.connect("sim", "", DEFAULT_VCU_PORT, "tcp")
            # the new profile may spawn in a completely different sea area - re-point the
            # AIS subscription, or the layer keeps streaming the previous one
            _rescope_ais_service()
            return 200, {"ok": True, "vessel": VESSEL}
        if path == "/api/ports":
            # TWO OPERATIONS, ONE ROUTE, told apart by what the body carries:
            #   {id}            -> switch to a port already in the registry
            #   {name,lat,lon}  -> ADD one and select it (the operator's own entry,
            #                      persisted, which is what "retained values" means)
            # Both are gated exactly like a vessel switch: moving the base under a
            # running boat is as incoherent as swapping its physics.
            st = ENGINE.state()
            if st.get("armed") or st.get("estop") or st.get("run") != "idle":
                return 409, {"error": "disarm and stop the run before changing port"}
            found = None
            if body.get("name") is not None:
                if body.get("lat") is None or body.get("lon") is None:
                    # NAME ONLY -> FIND THE PLACE. This is the difference between a
                    # bookmark and a way of starting work somewhere: the operator types
                    # "Nome, Alaska" and the console goes there, rather than requiring
                    # them to have navigated there already.
                    #
                    # SYNCHRONOUS ON PURPOSE, and bounded. It is one operator-initiated
                    # lookup (a geocode, then an ENC extract to find water), not a poll,
                    # and the answer IS the thing being created - deferring it would mean
                    # creating a port with no position and correcting it later.
                    g = geocode_place(body["name"])
                    if not g:
                        return 400, {"error": "could not find a place called %r "
                                              "(no geocoder, or no such place)" % body["name"]}
                    glat, glon, disp = g
                    # A GEOCODER RETURNS A TOWN CENTRE, WHICH IS ON LAND. Snap to charted
                    # water this hull can float in, or say plainly that it could not.
                    snap = snap_to_water(glat, glon, MIN_NAV_DEPTH_M)
                    if snap.get("ok"):
                        body = dict(body, lat=snap["lat"], lon=snap["lon"])
                        found = {"geocoded": disp, "place": {"lat": glat, "lon": glon},
                                 "snapped": True, "depth_m": snap.get("depth_m"),
                                 "moved_m": snap.get("moved_m"), "note": snap.get("note")}
                    else:
                        # Still create it at the place centre - the operator can see the
                        # chart and move it - but do NOT pretend it is a berth.
                        body = dict(body, lat=glat, lon=glon)
                        found = {"geocoded": disp, "place": {"lat": glat, "lon": glon},
                                 "snapped": False, "note": snap.get("note")}
                try:
                    p = validate_port(body, "port")
                except ValueError as e:
                    return 400, {"error": str(e)}
                if found:
                    p["note"] = (("%s. " % found["geocoded"]) +
                                 (found.get("note") or ""))[:400]
                    p["unverified"] = not found["snapped"]
                # An id collision REPLACES rather than duplicating: re-adding "Lewes, DE"
                # with a corrected position must fix the entry, not leave two of them.
                PORTS["ports"] = [q for q in PORTS["ports"] if q["id"] != p["id"]] + [p]
                PORTS["active"] = p["id"]
            else:
                pid = (body.get("id") or "").strip()
                if not any(q["id"] == pid for q in PORTS["ports"]):
                    return 400, {"error": "unknown port '%s'" % pid}
                PORTS["active"] = pid
            saved = save_ports()
            apply_port()
            if st.get("mode") == "sim":
                ENGINE.connect("sim", "", DEFAULT_VCU_PORT, "tcp")   # respawn at the new base
            # a different base is a different sea area - re-point the AIS subscription
            _rescope_ais_service()
            out = {"ok": True, "active": PORTS["active"], "ports": PORTS["ports"],
                   "saved": saved, "spawn": {"lat": SPAWN_LAT, "lon": SPAWN_LON}}
            if found:
                out["found"] = found          # what the name resolved to, and whether
            return 200, out                   # it had to be moved to reach water
        if path == "/api/comms":
            COMMS.configure(mode=body.get("mode"), host=body.get("host"),
                            username=body.get("username"), password=body.get("password"))
            return 200, {"ok": True}
        if path == "/api/waterlevel":
            if "manual_offset" in body:
                mo = body.get("manual_offset")
                # Guarded like /api/env's floats. This branch sits BEFORE the dispatch's
                # try/except, so a bare float("abc") here did not become a 4xx - it
                # unwound _dispatch_post, dropped the connection with NO response and
                # killed the handler thread with a traceback (reproduced live before
                # fixing). The client saw nothing at all - worse than the ais/radius
                # shape, which at least answered before dying.
                try:
                    WATER.set_manual(None if mo in (None, "") else float(mo))
                except (TypeError, ValueError):
                    return 400, {"error": "manual_offset must be numeric (metres), or empty to clear"}
            if body.get("refresh"):
                WATER.refresh_now()
            return 200, {"ok": True, "water": WATER.snapshot()}
        if path == "/api/env":
            # SIM environmental override / control (see EnvMonitor).
            if "enabled" in body:
                ENV.set_enabled(bool(body.get("enabled")))
            if body.get("auto"):                    # drop the manual override -> live buoys
                ENV.set_manual({"clear": True})
            man = {k: body[k] for k in ("wind_kn", "wind_from", "hs_m", "tp_s", "wave_from")
                   if k in body}
            if man:
                try:
                    ENV.set_manual(man)
                except (TypeError, ValueError):
                    return 400, {"error": "env override values must be numeric"}
            if body.get("refresh"):
                ENV.refresh_now()
            return 200, {"ok": True, "env": ENV.snapshot()}
        if path == "/api/roc":
            # ROC registry + the position DATA-STREAM ingest. `op:"feed"` is the
            # external HTTP push (any GPS bridge / ship nav PC posts here); the rest
            # are card actions. Every op returns the fresh snapshot so the UI syncs.
            op = body.get("op")
            try:
                if op == "add":
                    rid = ROC.add(body.get("kind", "shore"), body.get("name"),
                                  lat=_opt_float(body.get("lat")),
                                  lon=_opt_float(body.get("lon")), offset=body.get("offset"))
                    return 200, {"ok": True, "id": rid, "roc": ROC.snapshot()}
                if op == "update":
                    ok = ROC.update(body.get("id"), name=body.get("name"),
                                    lat=_opt_float(body.get("lat")),
                                    lon=_opt_float(body.get("lon")))
                    return (200 if ok else 404), {"ok": ok, "roc": ROC.snapshot()}
                if op == "offset":
                    ok = ROC.set_offset(body.get("id"), range_m=_opt_float(body.get("range_m")),
                                        bearing_deg=_opt_float(body.get("bearing_deg")),
                                        ref=body.get("ref"))
                    return (200 if ok else 404), {"ok": ok, "roc": ROC.snapshot()}
                if op == "motion":                       # ship heading/speed (applies live when active)
                    ok = ROC.set_motion(body.get("id"), heading=_opt_float(body.get("heading")),
                                        speed_kn=_opt_float(body.get("speed_kn")))
                    return (200 if ok else 404), {"ok": ok, "roc": ROC.snapshot()}
                if op == "confirm":                      # staged -> active (a ship starts steaming)
                    ok = ROC.confirm(body.get("id"))
                    return (200 if ok else 409), {"ok": ok, "roc": ROC.snapshot()}
                if op == "hold":                         # active -> staged (stop a ship)
                    ok = ROC.hold(body.get("id"))
                    return (200 if ok else 404), {"ok": ok, "roc": ROC.snapshot()}
                if op == "gps_attach":                   # drive a ROC from a real GPS NMEA feed
                    ok = ROC.attach_gps(body.get("id"), host=body.get("host"),
                                        port=body.get("port"), udp=bool(body.get("udp")),
                                        sim=bool(body.get("sim")))
                    return (200 if ok else 409), {"ok": ok, "roc": ROC.snapshot()}
                if op == "gps_detach":
                    ok = ROC.detach_gps(body.get("id"))
                    return (200 if ok else 404), {"ok": ok, "roc": ROC.snapshot()}
                if op == "remove":
                    ok = ROC.remove(body.get("id"))
                    return (200 if ok else 404), {"ok": ok, "roc": ROC.snapshot()}
                if op == "select_home":
                    ok = ROC.select_home(body.get("id"))
                    return (200 if ok else 404), {"ok": ok, "roc": ROC.snapshot()}
                if op == "clear_home":
                    ROC.clear_home()
                    return 200, {"ok": True, "roc": ROC.snapshot()}
                if op == "feed":
                    ok = ROC.feed(body.get("id"), float(body["lat"]), float(body["lon"]),
                                  cog=_opt_float(body.get("cog")), sog=_opt_float(body.get("sog")))
                    return (200 if ok else 404), {"ok": ok}
                return 400, {"error": "unknown roc op: %r" % op}
            except (KeyError, TypeError, ValueError) as e:
                return 400, {"error": "bad roc request: %s" % e}
        try:
            if path == "/api/connect":
                ENGINE.connect(body.get("mode", "sim"), body.get("host", ""),
                               body.get("port", DEFAULT_VCU_PORT), body.get("transport", "tcp"))
            elif path == "/api/disconnect":
                ENGINE.disconnect()
            elif path == "/api/cmd/arm":
                ENGINE.set_armed(bool(body.get("on")))
            elif path == "/api/cmd/upload":            # optional ENC-aware run path
                ENGINE.upload(body.get("route"), body.get("hold_clear_m"))
            elif path == "/api/cmd/start":
                ENGINE.start()
            elif path == "/api/cmd/pause":
                ENGINE.pause()
            elif path == "/api/cmd/stop":
                ENGINE.stop()
            elif path == "/api/cmd/estop":
                ENGINE.set_estop(bool(body.get("on")))
            # `hold_clear_m` on the four holding behaviours is the console's certified clear
            # disc around the end point (hold.js) - absent means the vessel re-approaches
            # direct, exactly as it always did.
            elif path == "/api/cmd/rth":               # optional ENC-aware detour route
                ENGINE.return_home(body.get("route"), body.get("hold_clear_m"),
                                   body.get("coast_from_m"))
            elif path == "/api/cmd/goto":              # behavior: drive to a point + hold
                ENGINE.go_to(body.get("lat"), body.get("lon"), body.get("route"),
                             body.get("hold_clear_m"), body.get("coast_from_m"))
            elif path == "/api/cmd/transit":           # behavior: follow a transit line + hold
                ENGINE.transit(body.get("route"), body.get("hold_clear_m"))
            elif path == "/api/cmd/hold":              # behavior: station-keep here
                ENGINE.hold(body.get("hold_clear_m"))
            elif path == "/api/cmd/reapproach":        # the routed way back onto station
                ENGINE.reapproach(body.get("route"), body.get("hold_clear_m"))
            elif path == "/api/cmd/escape":            # the in-extremis guard's OWN manoeuvre
                ENGINE.escape(body.get("lat"), body.get("lon"), body.get("hold_clear_m"))
            elif path == "/api/cmd/amend":             # deviate the RUNNING plan, keep the run
                ENGINE.amend(body.get("route"), body.get("note"))
            elif path == "/api/cmd/sethome":           # home = the chosen point, or the present fix
                ENGINE.set_home(body.get("lat"), body.get("lon"))
            elif path == "/api/cmd/approach":          # live-tune waypoint approach radius
                ENGINE.set_approach(float(body.get("m", WP_APPROACH_M)))
            elif path == "/api/cmd/speed":             # live speed change (low|survey|high)
                ENGINE.set_speed(str(body.get("speed", "survey")))
            elif path == "/api/ais/radius":            # live AIS DISPLAY radius (km)
                # Display only. It never restarts the service: the subscription already
                # collects AIS_COLLECT_RADIUS_KM, so every radius up to that is in hand
                # and a change is instant. Clamped to the collected area, because asking
                # to see further than was collected would show nothing extra and quietly
                # imply the sea beyond is empty.
                global AIS_SHOW_RADIUS_KM
                km = max(1.0, min(AIS_COLLECT_RADIUS_KM, float(body.get("km", AIS_SHOW_RADIUS_KM))))
                AIS_SHOW_RADIUS_KM = km
                # RETURN THE TUPLE, never send from here. _dispatch_post's contract is
                # (code, obj) and do_POST both sends it AND logs it. Sending directly
                # returned None into `code, obj = ...`, which raised AFTER the client
                # already had its 200 - so the endpoint looked perfectly healthy while
                # every call killed the handler thread and skipped the session log.
                return 200, {"ok": True, "show_km": km, "collect_km": AIS_COLLECT_RADIUS_KM}
            elif path == "/api/cmd/reset":             # sim power-cycle: full energy, spawn, clean slate
                ENGINE.reset()
            elif path == "/api/cmd/spawn":             # sim: place the boat at a clicked point
                try:
                    slat = float(body.get("lat")); slon = float(body.get("lon"))
                except (TypeError, ValueError):
                    raise VcuProtocolError("spawn needs a numeric lat/lon")
                if not (-90.0 <= slat <= 90.0 and -180.0 <= slon <= 180.0):
                    raise VcuProtocolError("spawn lat/lon out of range")
                ENGINE.reset(spawn={"lat": slat, "lon": slon})
            elif path == "/api/cmd/energy":            # energy override (report full) on/off, all modes
                ENGINE.set_energy_override(bool(body.get("unlimited")))
            else:
                return 404, {"error": "not found"}
            return 200, {"ok": True, "state": ENGINE.state()}
        except VcuProtocolError as e:
            return 409, {"error": str(e), "state": ENGINE.state()}
        except Exception as e:
            return 500, {"error": str(e)}

    def _serve_events(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Connection", "keep-alive")
        self.end_headers()
        q = ENGINE.subscribe()
        try:
            self.wfile.write(b"data: " + json.dumps(ENGINE.state()).encode() + b"\n\n")
            self.wfile.flush()
            while True:
                try:
                    data = q.get(timeout=5.0)
                    self.wfile.write(b"data: " + data.encode() + b"\n\n")
                except queue.Empty:
                    self.wfile.write(b": keep-alive\n\n")
                self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError, OSError):
            pass
        finally:
            ENGINE.unsubscribe(q)


def pick_browser(pref):
    candidates = []
    if pref == "edge":
        candidates = ["microsoft-edge", "msedge"]
    elif pref == "chrome":
        candidates = ["google-chrome", "chrome", "chromium", "chromium-browser"]
    for name in candidates:
        try:
            return webbrowser.get(name)
        except webbrowser.Error:
            continue
    for path in [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]:
        if os.path.exists(path):
            try:
                webbrowser.register("picked", None, webbrowser.BackgroundBrowser(path))
                return webbrowser.get("picked")
            except webbrowser.Error:
                pass
    return None


# --- third window: the CO-OPS page for the station driving the correction ---- #
# WHY IT IS DEFERRED, and why it cannot simply be opened next to the other two: the
# station is DERIVED FROM THE VESSEL'S GPS, and at process start there is no fix yet, so
# there is no station to open. This waits for the water monitor to resolve one.
#
# WHICH station: the PRIMARY - the nearest one actually returning data. That is the same
# station the chart-source card attributes the correction to, so the window and the card
# can never disagree. When three stations are in range the correction is an IDW blend of
# all of them (WATER_K / WATER_IDW_POWER, which predate this window), and a page showing
# one station would quietly misrepresent that - so the blend is PRINTED here, every
# contributor with its weight. `ok` is deliberately not required: a station with no data
# still names the right page, and "which water are we in" is worth answering even when
# the reading failed.
# --- WHO OPENS THESE WINDOWS, AND WHY IT IS NOT THIS PROCESS --------------- #
#
# Andy, 2026-09-02: first *"the weather browser tab and the tide browser tab do not update
# when ports are changed"*, then, on being shown that re-opening leaves a stale tab behind,
# *"switch to one tab that re-points itself."*
#
# ⚠ ONLY THE PAGE CAN DO THAT, AND THE REASON IS A BROWSER BOUNDARY. `webbrowser` hands a
# URL to the operating system and gets NO HANDLE BACK, so this process can open a tab and
# can never afterwards re-point or close it. A window handle held by a page CAN be
# navigated cross-origin by whoever opened it, so the console page owns both windows now -
# see `STATION_WINDOWS` in static/asv.html. It costs one click each, because `window.open`
# without a user gesture is blocked (measured, not assumed), and framing the pages instead
# is impossible: NDBC sends `X-Frame-Options: deny` with `frame-ancestors 'none'`.
#
# ⚠ SO THERE IS EXACTLY ONE OPENER, AND IT IS NOT HERE. A server-side opener kept "as a
# fallback" would put the duplicate tab straight back at start-up - two mechanisms racing
# to open the same window is the whole fault being fixed. What the server still owes the
# operator is the SENTENCE about which station is in use and what the correction is made
# of; `watch_station_report` prints that and opens nothing.
STATION_WATCH_POLL_S = 5.0        # a report line, not a control loop


def station_window_report(w, label, power, noun="reading", applied="value"):
    """One human line describing the reading behind an opened station page: the primary
    station, and the full IDW blend when there is one. Pure, so it is testable without a
    network or a browser.

    Shared by both station windows because the disclosure problem is identical - a page
    that shows ONE station standing in front of a reading blended from three - and the
    only differences are the label and the IDW power the monitor actually used. Two
    copies would drift the moment one of them learnt something."""
    sid = w.get("station")
    if not sid:
        return None
    bits = ["station %s" % sid]
    if w.get("name"):
        bits.append(str(w["name"]))
    if w.get("dist_km") is not None:
        bits.append("%.1f km off" % w["dist_km"])
    line = "  %s window: " % label + " · ".join(bits)
    used = [g for g in (w.get("stations") or []) if g.get("id")]
    method = w.get("method") or ("idw%d" % len(used) if len(used) > 1 else "single")
    if len(used) > 1:
        ws = [1.0 / max(g.get("dist_km") or 0.01, 0.01) ** power for g in used]
        tot = sum(ws) or 1.0
        # ONE DECIMAL, not zero: inverse-SQUARE weighting means a station four times
        # further away contributes a sixteenth as much, so at Lewes (3.7 km against 22
        # and 26) the blend rounds to "100%, 0%, 0%" at integer precision and hides that
        # the far stations are in it at all. The decimal shows the primary dominating.
        blend = ", ".join("%s %.1f%%" % (g["id"], 100.0 * x / tot) for g, x in zip(used, ws))
        line += "\n    %s is %s over %d stations: %s" % (noun, method, len(used), blend)
        line += ("\n    the page shows the PRIMARY only - the applied %s is the blend"
                 % applied)
    else:
        line += " · %s from this station alone (%s)" % (noun, method)
    return line


# The two station windows, as DATA rather than two near-identical functions: each names
# where its reading comes from, how to turn a station id into a page, the IDW power its
# monitor used, and how far it looks. Adding a third would be another entry, not another
# copy of the wait loop.
#: Whether each station window is offered at all - set from --no-tide-window /
#: --no-weather-window at start-up and read by the console page, which owns the windows.
STATION_WINDOWS_ON = {"tide": True, "weather": True}

STATION_WINDOWS = {
    "tide":    {"label": "Tide", "url": lambda sid: tide_station_url(sid),
                "snap": lambda: WATER.snapshot(), "power": WATER_IDW_POWER,
                "max_km": WATER_MAX_KM, "what": "water-level station",
                "noun": "correction", "applied": "offset"},
    "weather": {"label": "Weather", "url": lambda sid: ndbc_station_url(sid),
                "snap": lambda: ENV.snapshot(), "power": ENV_IDW_POWER,
                "max_km": ENV_MAX_KM, "what": "weather buoy",
                "noun": "wind and sea", "applied": "forcing"},
}


def watch_station_report(kind, stop=None):
    """Say which station is being used, and what the correction behind it is made of -
    every time the resolved station CHANGES.

    ⚠ THIS OPENS NOTHING, AND THAT IS THE POINT. The console PAGE owns the tide and
    weather windows now (Andy, 2026-09-02: *"switch to one tab that re-points itself"*),
    because only a page can hold a window handle and navigate it in place - `webbrowser`
    hands a URL to the OS and gets none back, so the server could open a second tab and
    never re-point the first. Two openers would put the duplicate straight back.

    What the server still owes the operator is the SENTENCE. The applied water correction
    may be an inverse-distance blend of up to three gauges reported under the nearest
    one's name, and "the number on the card is not this station's own level" has to be
    STATED rather than left to be inferred. That is worth printing whether or not anyone
    ever opens the window, so this is not gated on --no-tide-window: the correction is
    applied to charted depths either way.
    """
    spec = STATION_WINDOWS[kind]
    last = None
    while not (stop is not None and stop.is_set()):
        try:
            w = spec["snap"]() or {}
            sid = w.get("station")
        except Exception:                      # a monitor mid-refresh is not an error
            sid = None
        if sid and sid != last:
            if last is not None:
                print("  %s station moved: %s -> %s" % (spec["label"], last, sid))
            report = station_window_report(w, spec["label"], spec["power"],
                                           spec["noun"], spec["applied"])
            if report:
                print(report)
            last = sid
        time.sleep(STATION_WATCH_POLL_S)
    return last


# --- auto-started AIS provider (ais_service.py as a child process) ---------- #
_ais_proc = None


def _ais_local_port():
    """(host, port) if AIS_BASE is a local service we should auto-start, else None."""
    try:
        u = urllib.parse.urlparse(AIS_BASE)
        host, port = (u.hostname or "127.0.0.1"), (u.port or 8788)
    except ValueError:
        return None
    return ("127.0.0.1", port) if host in ("127.0.0.1", "localhost", "0.0.0.0") else None


def _port_alive(host, port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.4)
    try:
        s.connect((host, port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def _start_ais_service():
    """Launch the bundled ais_service.py alongside the console so the AIS layer just
    works - no separate command. Skips a remote --ais or an already-running service,
    scopes the aisstream subscription to the operating area (whole lake on a Great
    Lake, else a box around spawn), and is reaped when the console exits (the service
    runs a --parent-pid watchdog, robust to a hard kill)."""
    global _ais_proc
    hp = _ais_local_port()
    if not hp:
        return                                    # remote --ais: the user runs their own
    host, port = hp
    if _port_alive(host, port):
        print("[ais] using the AIS service already on %s:%d" % (host, port))
        return
    script = os.path.join(APP_DIR, "ais_service.py")
    if not os.path.isfile(script):
        print("[ais] ais_service.py not found next to the console; AIS layer stays offline")
        return
    lake = _lake_of(SPAWN_LAT, SPAWN_LON)
    if lake:                                      # subscribe to the whole lake
        a, b, c, d = GREAT_LAKES_BOXES[lake]
        bbox = "%.4f,%.4f,%.4f,%.4f" % (c, a, d, b)
    else:
        # At sea: a box around spawn covering the COLLECT radius (+20% margin), with the
        # historical 1.5 deg as a floor. This is the wide net; the operator's display radius
        # is filtered out of it later and never needs the subscription to change.
        dlat = max(1.5, (AIS_COLLECT_RADIUS_KM * 1000.0 / 111320.0) * 1.2)
        dlon = max(1.5, (AIS_COLLECT_RADIUS_KM * 1000.0 /
                         (111320.0 * max(0.15, math.cos(math.radians(SPAWN_LAT))))) * 1.2)
        bbox = "%.4f,%.4f,%.4f,%.4f" % (SPAWN_LON - dlon, SPAWN_LAT - dlat,
                                        SPAWN_LON + dlon, SPAWN_LAT + dlat)
    try:
        os.makedirs(LOG_DIR, exist_ok=True)
        logf = open(os.path.join(LOG_DIR, "ais_service.log"), "a", encoding="utf-8")
    except OSError:
        logf = subprocess.DEVNULL
    cmd = [sys.executable, script, "--source", AIS_SOURCE_ARG, "--host", host,
           "--port", str(port), "--bbox=" + bbox, "--parent-pid", str(os.getpid())]
    for spec in AIS_NMEA_SPECS:
        cmd += ["--nmea", spec]
    if AIS_OPENCPN:
        # "[HOST:]PORT" - a bare port keeps the service's 127.0.0.1 default
        h, _, p = AIS_OPENCPN.rpartition(":")
        if h:
            cmd += ["--opencpn-host", h]
        cmd += ["--opencpn-port", p]
    try:
        _ais_proc = subprocess.Popen(cmd, cwd=APP_DIR, stdout=logf,
                                     stderr=subprocess.STDOUT)
        atexit.register(_stop_ais_service)
        print("[ais] auto-started ais_service.py on %s:%d (source %s, bbox %s)"
              % (host, port, AIS_SOURCE_ARG, bbox))
    except Exception as e:
        print("[ais] could not auto-start ais_service.py: %s" % e)


def _stop_ais_service():
    global _ais_proc
    if _ais_proc and _ais_proc.poll() is None:
        try:
            _ais_proc.terminate()
            try:
                _ais_proc.wait(timeout=3)
            except Exception:
                _ais_proc.kill()
        except Exception:
            pass
    _ais_proc = None


def _rescope_ais_service():
    """Re-point the AIS subscription after the OPERATING AREA moves (a vessel switch).

    The service subscribes ONCE, at start, to a box around the then-current spawn. A
    live vessel switch can move the boat a continent away - the shipped profiles spawn
    in Erie and at Lewes - and without this the service happily keeps streaming the OLD
    area, so the layer sits empty next to the boat no matter how healthy the feed is.
    (Measured: switching to the Lewes profile left the registry full of Lake Erie
    traffic and nothing within 150 km of the boat.)

    Only ever restarts a service THIS console started; a remote --ais or one the
    operator is running themselves is left alone, with a note that its area is stale."""
    global _ais_proc
    if _ais_proc is None:
        hp = _ais_local_port()
        if hp and _port_alive(*hp):
            print("[ais] vessel moved the operating area, but the AIS service is not ours "
                  "to restart - its subscription still covers the previous area")
        return
    _stop_ais_service()
    for _ in range(20):                           # let the port come free before rebinding
        hp = _ais_local_port()
        if not hp or not _port_alive(*hp):
            break
        time.sleep(0.1)
    _start_ais_service()


def main():
    global AIS_BASE, AIS_COLLECT_RADIUS_KM, AIS_SHOW_RADIUS_KM
    global AIS_SOURCE_ARG, AIS_NMEA_SPECS, AIS_OPENCPN
    global PORTS_PATH
    ap = argparse.ArgumentParser(description="ASV Simulator Console (Phase 0, sim-first).")
    ap.add_argument("--host", default="127.0.0.1", help="bind address for the web UI")
    ap.add_argument("--port", type=int, default=DEFAULT_WEB_PORT, help="web UI port")
    ap.add_argument("--browser", choices=["edge", "chrome", "default", "none"],
                    default="edge", help="which browser to open")
    ap.add_argument("--ais-radius-km", type=float, default=AIS_SHOW_RADIUS_KM,
                    help="AIS DISPLAY radius at sea, km (default %d) - the starting value of "
                         "the range control on the AIS card, changeable live from there. "
                         "Ignored on a Great Lake, where the whole lake is shown."
                         % AIS_SHOW_RADIUS_KM)
    ap.add_argument("--ais-collect-km", type=float, default=AIS_COLLECT_RADIUS_KM,
                    help="AIS COLLECT radius at sea, km (default %d) - what the service "
                         "SUBSCRIBES to, and the most the display control can be widened to. "
                         "Raise it where the feed is sparse and the traffic sits far off - "
                         "e.g. the Delaware Bay mouth, whose traffic is 60-120 km up-river. "
                         "Costs a wider subscription, so it is set at boot, not live."
                         % AIS_COLLECT_RADIUS_KM)
    ap.add_argument("--single-window", action="store_true",
                    help="open only the main window (skip the separate controls window)")
    ap.add_argument("--sim", action="store_true", help="auto-connect the simulator at start")
    ap.add_argument("--vcu", default=None, help="auto-connect to this VCU host (serial-over-IP)")
    ap.add_argument("--transport", choices=["tcp", "serial"], default="tcp",
                    help="VCU link transport (serial-over-IP default)")
    ap.add_argument("--vcu-port", type=int, default=DEFAULT_VCU_PORT)
    ap.add_argument("--vessel", default=DEFAULT_VESSEL_ID,
                    help="vessel profile id from vessels/<id>.json (default: %s)" % DEFAULT_VESSEL_ID)
    ap.add_argument("--ais", default=AIS_BASE, metavar="URL",
                    help="AIS provider service base URL (ais_service.py; default %(default)s)")
    ap.add_argument("--no-ais-service", action="store_true",
                    help="don't auto-start the bundled ais_service.py (use an external one)")
    ap.add_argument("--ais-source", default=AIS_SOURCE_ARG, metavar="LIST",
                    help="sources for the bundled AIS service (its --source): auto, or a "
                         "comma list of aisstream,digitraffic,aishub,nmea,opencpn - every "
                         "enabled source merges into the one displayed picture")
    ap.add_argument("--ais-nmea", action="append", default=None, metavar="PROTO[:HOST]:PORT",
                    help="local NMEA AIVDM endpoint for --ais-source ...,nmea; repeatable "
                         "(udp:10110 binds for AIS-catcher / rtl-ais, tcp:host:port connects)")
    ap.add_argument("--ais-opencpn", default="", metavar="[HOST:]PORT",
                    help="OpenCPN TCP NMEA server to read with --ais-source ...,opencpn "
                         "(default 127.0.0.1:10110 if the source is named without this)")
    ap.add_argument("--ports-config", default="", metavar="PATH",
                    help="operating-port registry to use instead of ports.json. EVERY "
                         "SUITE THAT TOUCHES PORTS MUST PASS THIS: switching or adding a "
                         "port SAVES, and a test run against the app directory would "
                         "rewrite the operator's own bases (the roc_config lesson - a "
                         "suite once wrote 198 records into the real ROC registry)")
    ap.add_argument("--base", default="", metavar="PORT_ID",
                    help="operating port to start at (an id from ports.json, e.g. "
                         "new_castle_nh or lewes_de). Named --base, not --port, because "
                         "--port is already the HTTP port. Omitted = whatever ports.json "
                         "has as active")
    ap.add_argument("--currents-ofs", default="dbofs", metavar="MODEL",
                    help="NOAA Operational Forecast System for the surface-current readout "
                         "(default dbofs = Delaware Bay). One model only: the console asks "
                         "for the current at the VESSEL'S position, not along a line that "
                         "might cross a model boundary. cbofs/ngofs2/sfbofs/... for a hull "
                         "working elsewhere")
    ap.add_argument("--fetch-charts", metavar='"LAT,LON,RADIUS_KM"',
                    help="prefetch chart tiles around a position into charts/ and exit")
    ap.add_argument("--zooms", default="8-16", help="zoom range for --fetch-charts (default 8-16)")
    ap.add_argument("--no-log", action="store_true",
                    help="disable the session recorder (logs/*.jsonl for future playback)")
    ap.add_argument("--no-tide-window", action="store_true",
                    help="do not open the third window (the NOAA CO-OPS page for the "
                         "water-level station nearest the vessel)")
    ap.add_argument("--no-weather-window", action="store_true",
                    help="do not open the fourth window (the NOAA NDBC page for the "
                         "weather buoy nearest the vessel)")
    ap.add_argument("--roc-config", metavar="PATH",
                    help="ROC registry file to use instead of roc_config.json (a test "
                         "harness points this at a temp file so it cannot write to the "
                         "operator's own ROCs)")
    args = ap.parse_args()

    # A harness that drives a real console MUST be able to keep its ROCs out of the
    # operator's registry. Without this every run of the HTTP-contract suite, which POSTs
    # every ROC op including `add` against a live console in the app directory, left one
    # more staged ROC behind in roc_config.json - 198 of them by the time the card was
    # reported as opening on stale data. Re-pointed here rather than at import so --help
    # and --fetch-charts still touch nothing.
    if args.roc_config:
        ROC.use_config(args.roc_config)

    # Load the requested vessel profile (default already applied at import). Fail
    # loudly on a bad id / malformed file rather than silently running the default.
    if args.vessel != DEFAULT_VESSEL_ID:
        try:
            apply_vessel(load_vessel(args.vessel))
        except (OSError, ValueError) as e:
            print("vessel '%s' could not be loaded: %s" % (args.vessel, e))
            raise SystemExit(2)

    if args.fetch_charts:
        try:
            lat, lon, rad = (float(v) for v in args.fetch_charts.split(","))
            zmin, zmax = (int(v) for v in args.zooms.split("-"))
        except ValueError:
            print('usage: --fetch-charts "LAT,LON,RADIUS_KM" [--zooms 8-16]')
            return
        print("Prefetching NOAA ENC tiles: %.5f, %.5f  radius %.1f km  z%d-%d"
              % (lat, lon, rad, zmin, zmax))
        f, c, x = prefetch_charts(lat, lon, rad, zmin, zmax)
        print("done: %d fetched, %d cached, %d failed" % (f, c, x))
        return

    # Session recorder: capture every command/setting/action + telemetry trace
    # for a future playback mode. Created here (not at import) so --help /
    # --fetch-charts never spawn a log file. Best-effort; never fatal.
    global LOG
    AIS_BASE = args.ais
    # The service's runtime shape must be FINAL before the child starts: the collect
    # radius scales the subscription bbox and the source flags are its command line.
    # (The radii used to be applied AFTER _start_ais_service, so a --ais-collect-km
    # wider than the default never widened the FIRST subscription - only the one
    # rebuilt after a vessel switch. Ordering defect, fixed 2026-08-05.)
    AIS_COLLECT_RADIUS_KM = max(5.0, min(500.0, float(args.ais_collect_km)))
    # The display radius can never exceed what is collected - see the endpoint.
    AIS_SHOW_RADIUS_KM = max(1.0, min(AIS_COLLECT_RADIUS_KM, float(args.ais_radius_km)))
    if args.ports_config:
        PORTS_PATH = os.path.abspath(args.ports_config)
        load_ports()
        apply_port()
    if args.base:
        base = args.base.strip()
        if any(q["id"] == base for q in PORTS.get("ports") or []):
            PORTS["active"] = base
            apply_port()
        else:
            have = ", ".join(q["id"] for q in PORTS.get("ports") or []) or "(none)"
            print("[ports] no such port '%s' - have: %s" % (base, have), file=sys.stderr)
    AIS_SOURCE_ARG = (args.ais_source or "auto").strip() or "auto"
    # The currents monitor is constructed at import (like ENV), so the model choice is
    # applied here rather than passed to a constructor that already ran.
    # THE CLI IS THE FALLBACK, THE PORT IS THE AUTHORITY. This assignment used to run
    # AFTER apply_port and silently overwrote the base's own model with the dbofs
    # default - so a console started at New Castle NH asked the Delaware model for a
    # Gulf of Maine position. Set the fallback first, then let the active port have the
    # last word. (Boot ORDER again, twice in one feature.)
    CURRENTS._ofs = (args.currents_ofs or "dbofs").strip().lower() or "dbofs"
    apply_port()
    AIS_NMEA_SPECS = list(args.ais_nmea or [])
    AIS_OPENCPN = (args.ais_opencpn or "").strip()
    # Naming an endpoint IS asking for its source - don't make the operator say it twice.
    if AIS_NMEA_SPECS and "nmea" not in AIS_SOURCE_ARG:
        AIS_SOURCE_ARG += ",nmea"
    if AIS_OPENCPN and "opencpn" not in AIS_SOURCE_ARG:
        AIS_SOURCE_ARG += ",opencpn"
    if not args.no_ais_service:
        _start_ais_service()                      # bundled AIS provider - no separate command
    # A selected ROC owns HOME, resolved by the Engine on every telemetry tick (see
    # Engine._run). In sim, steam every ACTIVE ship ROC on its own heading/speed so
    # Return-to-Home against a MOVING recovery point can be exercised with no hardware.
    # Nothing auto-seeds - the operator places ROCs by clicking the chart and confirms
    # them. On a real link, ROCs are added/fed from the card or the API.
    ENGINE.set_home_provider(ROC.home_intent)
    if args.sim:
        ROC.start_sim()
        atexit.register(ROC.stop)
    LOG = SessionLogger(enabled=not args.no_log)
    if LOG.enabled:
        LOG.event("session_start", pid=os.getpid(), argv=sys.argv[1:],
                  host=args.host, port=args.port)

    srv = Server((args.host, args.port), Handler)
    url = "http://%s:%d/" % ("localhost" if args.host in ("0.0.0.0", "127.0.0.1") else args.host, args.port)

    if args.sim:
        ENGINE.connect("sim", "", DEFAULT_VCU_PORT, "tcp")
    elif args.vcu:
        ENGINE.connect(args.transport, args.vcu, args.vcu_port, args.transport)

    print("ASV Simulator Console serving at %s" % url)
    print("  Vessel: %s (%s)" % (VESSEL["name"], VESSEL["id"]))
    print("  RC transmitter is master - this console is additive shore-side C2.")
    if LOG.enabled:
        print("  Recording session to %s" % LOG.path)
    print("  (Ctrl-C to stop)")

    # ⚠ SET BEFORE, AND OUTSIDE, THE BROWSER BLOCK. These say whether the station windows
    # are OFFERED at all, which is a question about the operator's flags and not about how
    # the console happened to be launched. Inside the block, `--browser none` (every
    # headless harness, and anyone opening the page by hand) would silently ignore
    # --no-tide-window, and a flag the server honours only sometimes is worse than none.
    STATION_WINDOWS_ON["tide"] = not args.no_tide_window
    STATION_WINDOWS_ON["weather"] = not args.no_weather_window

    # NAME THE STATION AND ITS BLEND, whenever it changes. Not gated on the window flags
    # and not on --browser: the water correction is applied to charted depths whether or
    # not anyone opens a page, so which gauge it came from is worth saying either way.
    # Daemon threads - they can never hold shutdown.
    for _kind in ("tide", "weather"):
        threading.Thread(target=watch_station_report, args=(_kind,), daemon=True).start()

    if args.browser != "none":
        b = None if args.browser == "default" else pick_browser(args.browser)
        opener = b or webbrowser
        try:
            opener.open(url)                                  # main window: chart + status + command bar
            if not args.single_window:
                # Second window: ONLY the control column + its pop-out panels, for a
                # multi-monitor setup (drag it to the other screen). The server opening
                # it sidesteps the browser pop-up blocker. Slight delay so it lands as a
                # separate window after the first is up.
                threading.Timer(1.0, lambda: opener.open(url + "?panel=controls", new=1)).start()
                # ⚠ THE THIRD AND FOURTH WINDOWS ARE NOT OPENED FROM HERE ANY MORE, AND
                # THE REASON IS THE WHOLE POINT OF THE CHANGE. Andy, 2026-09-02, having
                # seen the re-open leave a stale tab behind: *"switch to one tab that
                # re-points itself."*
                #
                # A tab this process opens cannot be re-pointed BY this process:
                # `webbrowser` hands a URL to the OS and gets no handle back. Only the
                # page can hold a window handle and navigate it in place, so the page owns
                # these two now - see `stationWindows` in static/asv.html. The cost is one
                # click each, because a pop-up needs a user gesture, and the console asks
                # for it with a pill on the top bar rather than opening tabs the operator
                # then has to close.
                #
                # The flags still mean what they meant; they reach the page through
                # STATION_WINDOWS_ON in /api/state, and are set OUTSIDE this block - see
                # just above the browser launch.
        except Exception:
            print("  Could not auto-open a browser; open the URL above manually.")

    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down...")
    finally:
        ENGINE.disconnect()
        srv.shutdown()
        if LOG is not None:
            LOG.event("session_end")
            LOG.close()


if __name__ == "__main__":
    main()
