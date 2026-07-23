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
import json
import math
import os
import queue
import re
import socket
import ssl
import sys
import threading
import time
import http.cookiejar
import urllib.error
import urllib.parse
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

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
DEFAULT_VESSEL_ID = "zboat_1800hs"
# Unique per server run. Sent in every state so the browser can tell a page refresh
# (same run - keep the trail) from a reboot (new run - drop the stale trail; the run
# is in the session logs). Changes on every restart.
BOOT_ID = "%d-%d" % (os.getpid(), int(time.time() * 1000))

DEFAULT_WEB_PORT = 8781
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
    NOGO_BUFFER_DEFAULT_M = float(pl["nogo_buffer_m"])
    UNDER_KEEL_CLEARANCE_M = float(pl["under_keel_clearance_m"])
    MIN_NAV_DEPTH_M = BOAT_DRAFT_M + UNDER_KEEL_CLEARANCE_M   # water shallower than this is nogo
    SPAWN_LAT = float(sp["lat"]); SPAWN_LON = float(sp["lon"])
    return v


# Load the default vessel at import so every module global is populated before
# any class method or the mission store reads it. --vessel overrides in main().
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
    TELEM_FIELDS = ("lat_deg", "lon_deg", "heading_deg", "cog_deg", "sog_kn",
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
                # plan-run completion semantics (Survey/search as a typed behavior):
                # complete (stop) | loiter (station-keep at the last wp) | repeat (loop).
                "completion": m.get("completion") if m.get("completion") in
                              ("complete", "loiter", "repeat") else "complete",
                # keep-clear buffer (m) around every nogo zone - the tightness the
                # ASV threads between piers; smaller for tight marinas.
                "buffer_m": m.get("buffer_m", NOGO_BUFFER_DEFAULT_M),
                # arbitrary survey-area boundary (CAMP SurveyArea) - persisted so a
                # plan drawn at the dock survives a reload / a session at sea.
                "boundary": m.get("boundary") or [],
                "boundary_closed": bool(m.get("boundary_closed")),
            }
    except (OSError, ValueError):
        pass
    return {"waypoints": [], "lines": [], "arrival_radius_m": ARRIVAL_DEFAULT_M,
            "approach_radius_m": WP_APPROACH_M, "speed": "survey", "completion": "complete",
            "buffer_m": NOGO_BUFFER_DEFAULT_M, "boundary": [], "boundary_closed": False}


def save_mission(m):
    data = json.dumps({
        "waypoints": m.get("waypoints") or [],
        "lines": m.get("lines") or [],
        "arrival_radius_m": m.get("arrival_radius_m", 2.0),
        "approach_radius_m": m.get("approach_radius_m", WP_APPROACH_M),
        "speed": m.get("speed") or "survey",
        "completion": m.get("completion") if m.get("completion") in
                      ("complete", "loiter", "repeat") else "complete",
        "buffer_m": m.get("buffer_m", 3.0),
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
    "dock_line":     ["Shoreline_Construction_line", "Pontoon_line",
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
                      "Underwater_Awash_Rock_point", "Obstruction_point", "Wreck_point"],
    "hazard_area":   ["Obstruction_area", "Wreck_area"],
    "dredged":       ["Dredged_Area"],
    "restricted":    ["Restricted_Area"],
}
# CATLAM = category of lateral mark (1 port-hand, 2 starboard-hand, 3 pref-chan-to-
# stbd, 4 pref-chan-to-port); COLOUR for the buoy symbol. Kept for chan_mark use.
ENC_KEEP_PROPS = ("DRVAL1", "DRVAL2", "VALSOU", "VALDCO", "OBJNAM", "CATLAM", "COLOUR")

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


def fetch_enc_features(bbox, min_depth=0.0):
    """Fetch + role-tag ENC vector features for a bbox, from the finest band with
    coverage. Returns {'band', 'features':[{role,cls,props,geometry}], 'counts'}.
    The assembled geometry caches to charts/enc/features_<key>.json; the min-depth
    'shallow' tag is applied per request so one fetch serves any depth limit."""
    global _enc_down_until
    key = "%.4f_%.4f_%.4f_%.4f" % tuple(bbox)
    # cache version: v2 adds id-first fetch (piers/structures that the old spatial
    # query silently dropped) + the expanded structure classes; v3 splits lateral
    # channel marks into their own 'chan_mark' role and keeps CATLAM/COLOUR. Bumping
    # the version ignores older caches that lack the new role/props.
    cache = os.path.join(ENC_DIR, "features_v3_%s.json" % key)
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
                props = ft.get("properties") or {}
                kept = {k: props.get(k) for k in ENC_KEEP_PROPS if props.get(k) is not None}
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
        return base

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
            stations.append({"id": sid.group(1), "lat": float(la.group(1)),
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
        txt = _env_http_get(NDBC_OBS_URL % station_id, timeout)
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
    return {"ok": True, "source": src, "note": note, "wind": wind, "sea": sea}


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
                "wind": wind, "sea": sea}

    def snapshot(self):
        return self._effective()

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
                    completion="complete"): ...
    def start(self): ...
    def pause(self): ...
    def stop(self): ...
    def estop(self, on): ...
    def set_neutral(self): ...
    def set_approach(self, m): ...          # live-tune the waypoint approach radius


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
        self._completion = "complete"  # complete (stop) | loiter (station-keep) | repeat (loop)
        self._holding = False          # currently station-keeping (loiter reached the end)
        self._laps = 0                 # completed loops (repeat mode)
        self._running = False
        self._paused = False
        self._estop = False
        self._xte_i = 0.0              # XTE integral trim (deg) - see XTE_KI_DEG
        self._drift_en = (0.0, 0.0)    # last tick's environmental drift (m/s east,north)

    def open(self):
        pass

    def close(self):
        pass

    # -- commands ---------------------------------------------------------- #
    def upload_plan(self, waypoints, arrival_radius_m, speed, approach_radius_m=None,
                    completion="complete"):
        self._plan = [{"lat": w["lat"], "lon": w["lon"]} for w in (waypoints or [])]
        self._arrival_m = clamp(float(arrival_radius_m or 5.0), 1.0, 50.0)
        self._approach_m = clamp(float(approach_radius_m or WP_APPROACH_M), 0.5, 50.0)
        self._speed_key = speed if speed in SPEED_KN else "survey"
        self._wp_index = 0
        # completion semantics at the last waypoint (goto/rth/hold -> loiter)
        self._completion = completion if completion in ("complete", "loiter", "repeat") else "complete"
        self._holding = False
        self._laps = 0
        self._xte_i = 0.0              # fresh plan: drop the old trim

    def set_approach(self, m):             # live tuning of the approach radius
        self._approach_m = clamp(float(m), 0.5, 50.0)

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
            # advance once the boat passes the waypoint along-track, or is within the
            # tight approach radius - it follows the line to ~WP_APPROACH_M of the turn
            if along >= seg_len - self._approach_m or dist_b <= self._approach_m:
                self._seg_start = wp
                self._wp_index += 1
                if self._wp_index >= len(self._plan):
                    if self._completion == "loiter":
                        self._holding = True       # goto/rth/hold + Survey loiter: station-keep here
                    elif self._completion == "repeat":
                        self._wp_index = 0         # loop the route from the present position
                        self._seg_start = {"lat": self.lat, "lon": self.lon}
                        self._laps += 1
                    else:
                        self._running = False      # complete: stop
                        target_kn = 0.0
        elif moving and self._holding and self._plan:
            # station-keep at the last waypoint (re-approach if drifted beyond it)
            hp = self._plan[-1]
            dist_h, brg_h = range_bearing(self.lat, self.lon, hp["lat"], hp["lon"])
            if dist_h <= max(self._approach_m, 2.0):
                target_kn = 0.0                    # arrived - hold position
            else:
                self.heading = _turn_toward(self.heading, brg_h, MAX_TURN_RATE_DEG_S * dt)
                target_kn = SPEED_KN["low"]

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
                set_kn = vdr * 1.9438
                set_dir = math.degrees(math.atan2(fe, fn)) % 360.0
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
        if POWER_TYPE == "fuel":
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
        cog = gb if gd > 0.02 else (self.heading if self.sog_kn > 0.05 else None)
        crab = (((self.heading - cog + 180.0) % 360.0) - 180.0) if cog is not None else None
        return {
            "lat_deg": round(self.lat, 6),
            "lon_deg": round(self.lon, 6),
            "heading_deg": round(self.heading, 1),
            "cog_deg": round(cog, 1) if cog is not None else None,
            "sog_kn": round(sog_ground, 2),        # true speed over ground (incl. drift)
            "pitch_deg": self.pitch,
            "roll_deg": self.roll,
            "energy_type": POWER_TYPE,
            # battery vessels report a voltage; fuel vessels report tank litres (the
            # other stays None so state()/UI shows only the relevant gauge)
            "battery_v": round(self.battery_v, 2) if POWER_TYPE == "battery" else None,
            "fuel_l": round(self.fuel_l, 1) if POWER_TYPE == "fuel" else None,
            "time": time.strftime("%H:%M:%S", time.gmtime()),
            "wp_index": self._wp_index,
            "wp_total": len(self._plan),
            "running": self._running,
            "paused": self._paused,
            "estop": self._estop,
            "holding": self._holding,
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
        self.completion = "complete"  # plan-run completion: complete | loiter | repeat
        self.home = None           # {lat,lon} launch/home point (auto-set on 1st fix)
        self.link = self.LINK_IDLE
        self.note = "Not connected."
        self.status = {}           # latest telemetry
        self.wp_index = 0
        self.wp_total = 0
        self._misses = 0

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
    def connect(self, mode, host, port, transport):
        self.disconnect()
        with self._lock:
            self._mode = mode
            self._host = host
            self._port = int(port) if port else DEFAULT_VCU_PORT
            if mode == "sim":
                self._link = SimVcu()
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

    def upload(self, route=None):
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
            self.completion = m.get("completion", "complete")
            link.upload_plan(wpts, m.get("arrival_radius_m", 2.0), m.get("speed", "survey"),
                             m.get("approach_radius_m", WP_APPROACH_M), completion=self.completion)
            self.plan_uploaded = True
            self.wp_total = len(wpts)
            self.wp_index = 0
            self.note = "Run plan uploaded (%d waypoints%s, %s)." % (
                len(wpts), " · ENC-routed" if route else "", self.completion)
        self._push_state()

    def set_approach(self, m):
        """Live-tune the waypoint approach radius on the connected link (sim)."""
        with self._lock:
            if self._link is not None:
                try:
                    self._link.set_approach(m)
                except Exception:
                    pass

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
                         "repeat": "Survey started (will repeat the route)."}.get(
                             self.completion, "Survey started.")
        self._push_state()

    # -- generalized behaviors (route + station-keep) ---------------------- #
    def _run_route(self, route, behavior, note):
        """Arm-gated: push a behavior route to the link and run it, holding at the
        end. Shared by Go-To / Return-to-Home / Hold."""
        with self._lock:
            link = self._link
            self._require(link is not None, "not connected")
            self._require(self.armed, "ARM before commanding the boat")
            self._require(not self.estop, "clear E-STOP first")
            m = load_mission()
            link.upload_plan(route, m.get("arrival_radius_m", 2.0), m.get("speed", "survey"),
                             m.get("approach_radius_m", WP_APPROACH_M), completion="loiter")
            link.start()
            self.plan_uploaded = True
            self.completion = "loiter"     # goto/rth/hold always station-keep at the end
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

    def go_to(self, lat, lon, route=None):
        # route (if given) is the client's ENC-aware detour path ending at the point;
        # else drive straight to the point (honest degrade when no nogo model).
        r = self._sanitize_route(route) if route else [{"lat": float(lat), "lon": float(lon)}]
        note = ("Go-To: following the ENC-aware route to the point (%d wpts), will station-keep on arrival." % len(r)
                if route else "Go-To: driving to point, will station-keep on arrival.")
        self._run_route(r, "goto", note)

    def transit(self, route):
        # Follow a single- or multi-segment transit line (ENC-aware route from the
        # client), station-keeping at the end. Independent of any survey plan.
        r = self._sanitize_route(route)
        self._run_route(r, "transit",
                        "Transit: following the route (%d wpts), will station-keep at the end." % len(r))

    def hold(self):
        st = self.status
        if st.get("lat_deg") is None:
            raise VcuProtocolError("no position fix to hold at")
        self._run_route([{"lat": st["lat_deg"], "lon": st["lon_deg"]}], "hold",
                        "Hold: station-keeping at present position.")

    def set_home(self):
        with self._lock:
            st = self.status
            if st.get("lat_deg") is None:
                raise VcuProtocolError("no position fix to set home")
            self.home = {"lat": st["lat_deg"], "lon": st["lon_deg"]}
            self.note = "Home set to present position."
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

    def return_home(self, route=None):
        with self._lock:
            home = self.home
        if not home:
            raise VcuProtocolError("no home set (no GPS fix yet)")
        # route (if given) is the client's ENC-aware detour path; its last point
        # should be home. Else drive straight to home.
        r = self._sanitize_route(route) if route else [{"lat": home["lat"], "lon": home["lon"]}]
        note = ("Return-to-Home: following the ENC-aware route to home (%d wpts), will station-keep on arrival." % len(r)
                if route else "Return-to-Home: driving to home, will station-keep on arrival.")
        self._run_route(r, "rth", note)

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
            with self._lock:
                if telem:
                    self._misses = 0
                    self.link = self.LINK_OK
                    self.status = telem
                    # feed the vessel fix to the water-level link (drives station
                    # selection + refetch); computer clock is implicit (date=latest)
                    if telem.get("lat_deg") is not None and telem.get("lon_deg") is not None:
                        WATER.update_position(telem["lat_deg"], telem["lon_deg"])
                        # SIM-ONLY: locate real weather near the sim vessel so SimVcu
                        # can push it around. Not fed in real mode (real boat, real wx).
                        if self._mode == "sim":
                            ENV.update_position(telem["lat_deg"], telem["lon_deg"])
                        if self.home is None:       # first fix = launch/home point
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
        return {
            "type": "state",
            "boot_id": BOOT_ID,
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
            "completion": self.completion,
            "home": self.home,
            "wp_index": self.wp_index,
            "wp_total": self.wp_total,
            "status": st,
            "comms": COMMS.snapshot(),
            "water": WATER.snapshot(),
            "env": ENV.snapshot() if self._mode == "sim" else {"ok": False, "source": "off",
                     "enabled": False, "note": "environmental sim (sim mode only)"},
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
        if self.path == "/" or self.path.startswith("/index"):
            # Read the page fresh each request so edits show up on a browser
            # refresh without a server restart (a single-operator console - the
            # tiny re-read is free, and it avoids serving a stale cached UI).
            try:
                html = load_static("asv.html")
            except OSError:
                html = INDEX_HTML
            self._send(200, html, "text/html; charset=utf-8")
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
        elif self.path.startswith("/api/waterlevel"):
            self._send(200, json.dumps(WATER.snapshot()))
        elif self.path.startswith("/api/env"):
            self._send(200, json.dumps(ENV.snapshot()))
        elif self.path == "/api/mission":
            self._send(200, json.dumps(load_mission()))
        elif self.path == "/api/vessel":
            # active vessel (full params for the UI) + the available list (picker)
            self._send(200, json.dumps({"vessel": VESSEL, "active": VESSEL["id"],
                                        "available": list_vessels()}))
        elif self.path == "/api/vessels":
            self._send(200, json.dumps({"vessels": list_vessels(), "active": VESSEL["id"]}))
        elif self.path == "/api/comms":
            with COMMS._lock:
                cfg = {"mode": COMMS.mode, "host": COMMS.host, "username": COMMS.username}
            self._send(200, json.dumps({"config": cfg, "status": COMMS.snapshot()}))
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

    def _serve_enc(self):
        # /api/enc?bbox=W,S,E,N&min_depth=X -> role-tagged ENC vector features.
        try:
            q = urllib.parse.parse_qs(self.path.split("?", 1)[1])
            bbox = [float(v) for v in q["bbox"][0].split(",")]
            if len(bbox) != 4:
                raise ValueError
            min_depth = float(q.get("min_depth", ["0"])[0])
        except (KeyError, ValueError, IndexError):
            return self._send(400, json.dumps({"error": "usage: /api/enc?bbox=W,S,E,N&min_depth=X"}))
        try:
            data = fetch_enc_features(bbox, min_depth)
        except Exception as e:  # never take the server down on a chart fetch
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
            return 200, {"ok": True, "vessel": VESSEL}
        if path == "/api/comms":
            COMMS.configure(mode=body.get("mode"), host=body.get("host"),
                            username=body.get("username"), password=body.get("password"))
            return 200, {"ok": True}
        if path == "/api/waterlevel":
            if "manual_offset" in body:
                mo = body.get("manual_offset")
                WATER.set_manual(None if mo in (None, "") else float(mo))
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
        try:
            if path == "/api/connect":
                ENGINE.connect(body.get("mode", "sim"), body.get("host", ""),
                               body.get("port", DEFAULT_VCU_PORT), body.get("transport", "tcp"))
            elif path == "/api/disconnect":
                ENGINE.disconnect()
            elif path == "/api/cmd/arm":
                ENGINE.set_armed(bool(body.get("on")))
            elif path == "/api/cmd/upload":            # optional ENC-aware run path
                ENGINE.upload(body.get("route"))
            elif path == "/api/cmd/start":
                ENGINE.start()
            elif path == "/api/cmd/pause":
                ENGINE.pause()
            elif path == "/api/cmd/stop":
                ENGINE.stop()
            elif path == "/api/cmd/estop":
                ENGINE.set_estop(bool(body.get("on")))
            elif path == "/api/cmd/rth":               # optional ENC-aware detour route
                ENGINE.return_home(body.get("route"))
            elif path == "/api/cmd/goto":              # behavior: drive to a point + hold
                ENGINE.go_to(body.get("lat"), body.get("lon"), body.get("route"))
            elif path == "/api/cmd/transit":           # behavior: follow a transit line + hold
                ENGINE.transit(body.get("route"))
            elif path == "/api/cmd/hold":              # behavior: station-keep here
                ENGINE.hold()
            elif path == "/api/cmd/sethome":           # capture home = present position
                ENGINE.set_home()
            elif path == "/api/cmd/approach":          # live-tune waypoint approach radius
                ENGINE.set_approach(float(body.get("m", WP_APPROACH_M)))
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


def main():
    ap = argparse.ArgumentParser(description="ASV Simulator Console (Phase 0, sim-first).")
    ap.add_argument("--host", default="127.0.0.1", help="bind address for the web UI")
    ap.add_argument("--port", type=int, default=DEFAULT_WEB_PORT, help="web UI port")
    ap.add_argument("--browser", choices=["edge", "chrome", "default", "none"],
                    default="edge", help="which browser to open")
    ap.add_argument("--sim", action="store_true", help="auto-connect the simulator at start")
    ap.add_argument("--vcu", default=None, help="auto-connect to this VCU host (serial-over-IP)")
    ap.add_argument("--transport", choices=["tcp", "serial"], default="tcp",
                    help="VCU link transport (serial-over-IP default)")
    ap.add_argument("--vcu-port", type=int, default=DEFAULT_VCU_PORT)
    ap.add_argument("--vessel", default=DEFAULT_VESSEL_ID,
                    help="vessel profile id from vessels/<id>.json (default: %s)" % DEFAULT_VESSEL_ID)
    ap.add_argument("--fetch-charts", metavar='"LAT,LON,RADIUS_KM"',
                    help="prefetch chart tiles around a position into charts/ and exit")
    ap.add_argument("--zooms", default="8-16", help="zoom range for --fetch-charts (default 8-16)")
    ap.add_argument("--no-log", action="store_true",
                    help="disable the session recorder (logs/*.jsonl for future playback)")
    args = ap.parse_args()

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

    if args.browser != "none":
        b = None if args.browser == "default" else pick_browser(args.browser)
        try:
            (b or webbrowser).open(url)
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
