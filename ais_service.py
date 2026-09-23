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
#       1. `Registry._rank` (2026-09-21). `PRIORITY` is keyed by FEED, but
#          `src` carries the ENDPOINT's name so several receivers stay distinct
#          in `srcs` -- so a labeled receiver ("nmea-udp-10110") ranked 0 and
#          the boat's own AIS set lost the position to a shore relay 9 km away.
#          Fixed in asv_core at 2a0b53d and pulled across; tests/ais_sources.py.
#       2. The DATA clock, `last_report` (2026-09-21). `_ok` stamps `updated` on
#          every successful CONNECT, and a far end that accepts then hangs up
#          never reaches `_err`, so the AISHub poll deferred for ever to a
#          stream delivering nothing -- measured, 51 accepts, one report, zero
#          polls in 150 s. Fixed in asv_core at 2a0b53d and pulled across.
#       3. AND THE BIG ONE, WHICH IS THIS REPO'S OWN AND PREDATES BOTH: the
#          STATIC / VOYAGE particulars -- `STATIC_KEYS`,
#          `_static_from_aisstream`, the ITU-R M.1371 message-5 bit offsets, and
#          the serialiser that stops a correctly decoded field dying in a
#          whitelist. 219 diff lines against the core, answering Andy's
#          2026-09-02 ask for vessel type, length, width and destination. A
#          `vendor.py` run would have deleted every line of it without a prompt.
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
#   source : asv_core/ais_service.py
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
# THIS REPO WROTE ais_service.py AND THE CORE BODY IS ITS OWN, so nothing
# about the merge, the sources or the error frames changes here. One thing
# does, and it is a fix:
#
# THE AISHUB UNIT-FORMAT DETECTOR LET A SINGLE RECORD DECIDE FOR THE WHOLE
# RESPONSE. AISHub serves either decimal degrees or raw 1/600000-degree
# integers, so the format has to be settled once per response -- but it was
# settled with any(), asking whether ANY coordinate was off Earth as degrees.
# The 91/181 "not available" sentinel that every vessel without a GPS fix
# broadcasts is off Earth as degrees. One unfixed ship therefore flipped an
# ordinary human-format response into raw and divided every good position by
# 600000: measured, two vessels off Lewes came back at 0.00006 N 0.0001 W
# doing 0.5 kn, with no error raised anywhere. The sentinels are now excluded
# from the vote, and raw must win a majority of what is left.
#
# It is latent rather than live -- AishubSource does not start without a
# member username, and there is no membership yet -- but it was on the path
# the moment one existed, and it was about to be copied into a second repo.
# tests/ais_service.py in the core pins it, with every mixed-response case
# paired against a genuine raw response that must still be rescaled.
#
# This repo's own ais_sources.py and ais_error_frames.py now exercise THIS
# file, which is what proves the console really runs the core body.
#
# Edit the core file and re-run the sync. Everything below is verbatim.
# ============================================================================

#!/usr/bin/env python3
"""
AIS provider service — a standalone, stdlib-only aggregator of maritime AIS
(Automatic Identification System) vessel reports, queried by an ASV console over
HTTP. AIS is the system by which ships broadcast their identity, position,
course and speed over VHF (and onto the internet via shore/satellite receivers);
this service pulls that from open sources and hands the console a clean vessel list.

It is a SEPARATE process from the console (the console proxies it at /api/ais), so
the data feeds, any API key, and the network I/O stay out of the console and the
browser. Python 3 standard library only — no pip, no build step.

Sources (enable any combination with --source, comma-separated — every enabled
source merges into ONE vessel registry, so the console always reads a single
combined picture with per-vessel provenance):

  * digitraffic  Finland/Fintraffic open REST feed (meri.digitraffic.fi) — keyless,
                 real live vessels in Finnish/Baltic waters. CC BY 4.0.
  * aisstream    aisstream.io global real-time WebSocket feed — needs a FREE API key
                 (--aisstream-key or $AISSTREAM_KEY). Covers US waters (Erie, Lewes).
  * aishub       AISHub member pool (data.aishub.net) — HTTP poll, ≥65 s interval
                 (their hard limit is one request/minute). Needs a MEMBER username
                 (--aishub-user or $AISHUB_USER); membership is earned by
                 CONTRIBUTING a feed, so this stays skipped until one exists.
  * nmea         local AIS receiver(s) (RTL-SDR + AIS-catcher / rtl-ais) emitting
                 NMEA AIVDM — repeat --nmea udp:PORT / tcp:HOST:PORT to merge
                 several endpoints, each with its own health in `sources`.
  * opencpn      OpenCPN relaying its aggregated inputs as a TCP NMEA stream
                 (Options > Connections > add Network/TCP connection, Output
                 enabled, port 10110) — we connect and decode what it serves.

Run (zero-config): set an aisstream key up ONCE, then just start it:
  setx AISSTREAM_KEY YOUR_FREE_KEY      # one-time, machine-wide (or: echo KEY > ais_key.txt)
  python ais_service.py                 # --source auto: aisstream if a key exists, else digitraffic

Or pick sources explicitly (all of these merge):
  python ais_service.py --source aisstream,nmea --nmea udp:10110 --nmea udp:10111
  python ais_service.py --source aisstream,opencpn --opencpn-port 10110
  python ais_service.py --source aishub --aishub-user AH_USER --bbox -75.6,38.4,-74.6,39.2

Query (what the console does):
  GET /vessels?bbox=W,S,E,N[&max=N]   -> {"ok":true,"count":..,"vessels":[..],"sources":{..}}
  GET /health                          -> {"ok":true,"sources":{..},"count":..}

AIS is a public safety broadcast; this only *reads* open data. Not for navigation —
it is situational awareness, subject to feed coverage, latency and gaps.
"""

import argparse
import base64
import calendar
import gzip
import json
import math
import os
import socket
import ssl
import struct
import sys
import threading
import time
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_PORT = 8788
DEFAULT_TTL = 600.0            # drop a vessel not heard from in this many seconds
UA = {"User-Agent": "ais-service/1.0 (+survey-asv console; open AIS aggregation)"}


# --------------------------------------------------------------------------- #
#  AIS ship-type categorisation (ITU-R M.1371 "type of ship and cargo")       #
# --------------------------------------------------------------------------- #
def ship_category(t):
    """Map a numeric AIS ship type to a short colourable category."""
    try:
        t = int(t)
    except (TypeError, ValueError):
        return "unknown"
    if t <= 0:
        return "unknown"
    if t == 30:
        return "fishing"
    if t in (31, 32, 52):
        return "tug"                       # towing / tug
    if t == 35:
        return "military"
    if t == 36:
        return "sailing"
    if t == 37:
        return "pleasure"
    if 40 <= t <= 49:
        return "hsc"                       # high-speed craft
    if t in (50, 51, 53, 55):
        return "special"                   # pilot / SAR / port tender / law
    if 60 <= t <= 69:
        return "passenger"
    if 70 <= t <= 79:
        return "cargo"
    if 80 <= t <= 89:
        return "tanker"
    return "other"


# --------------------------------------------------------------------------- #
#  Vessel registry (thread-safe, aged out)                                     #
# --------------------------------------------------------------------------- #
class Registry:
    def __init__(self, ttl=DEFAULT_TTL):
        self._lock = threading.Lock()
        self._v = {}                       # mmsi -> dict
        self.ttl = ttl

    # the fields that describe WHERE the vessel is (dropped together when a stale
    # polled report loses to a fresher one already held)
    POS_KEYS = ("lat", "lon", "sog", "cog", "heading", "nav")

    #: The STATIC / VOYAGE particulars, carried through to the console verbatim.
    #:
    #: These are the facts that do not change between position reports - the hull and the
    #: voyage - so they are merged stickily (a position report never clears them) and are
    #: what the operator's icon, hover card and any later target analysis are built from.
    #:
    #: `length` / `beam` / `dim` / `dest` / `draught` / `imo` / `callsign` / `eta` all come
    #: straight out of AIS messages 5, 19 and 24B and cost nothing extra to have.
    #: `gt` / `dwt` / `built` do NOT exist in AIS in any message - they are registry facts
    #: and can only arrive from a vessel-particulars lookup, so they are listed here and
    #: simply stay absent until one is configured.
    STATIC_KEYS = ("length", "beam", "dim", "dest", "draught", "imo", "callsign", "eta",
                   "gt", "dwt", "built", "flag", "extra_src")

    #: Which feed's POSITION wins when several carry the same ship. Higher is
    #: stronger; anything unlisted is 0. This is the only place "primary" is
    #: expressed — a source list says what RUNS, not what is believed.
    PRIORITY = {"aishub": 30, "nmea": 20, "opencpn": 20, "aisstream": 10,
                "digitraffic": 10}

    #: How long the primary holds a vessel without reporting before a
    #: lower-priority feed may move it. A primary that stops must not freeze the
    #: picture — that would be worse than the coin-toss this replaces.
    PRIMARY_HOLD_S = 180.0

    @classmethod
    def _rank(cls, src):
        """A report's POSITION rank.

        ⚠ PRIORITY IS KEYED BY FEED, AND `src` IS NOT A FEED NAME. It carries the
        ENDPOINT's own name, because several receivers have to stay distinct in
        `srcs` and in the health panel — AIS-catcher on one UDP port and rtl-ais on
        another are two boxes on deck, not one. So a labeled receiver reports as
        "nmea-udp-10110", `PRIORITY.get` answered 0 for it, and the boat's own
        receiver LOST to the shore relay it exists to beat: measured, an aisstream
        position 9 km away held the ship while the deck box was reporting.

        It is the same provenance/health split `health_name` records one class
        down. "nmea-udp-10110" is still the nmea receiver, so a name PRIORITY does
        not list falls back to the feed before its first '-'.
        """
        p = cls.PRIORITY
        if src in p:
            return p[src]
        return p.get((src or "").split("-", 1)[0], 0)

    def update(self, mmsi, src, pos_time=None, **fields):
        """Merge a report into the registry. Only overwrites keys that are present
        (so a static-data update keeps the last position and vice-versa).

        MULTI-SOURCE MERGE: every enabled source lands in this ONE registry, keyed
        by MMSI, so the console sees a single merged picture however many feeds run.
        `srcs` records every feed that has reported the vessel; `src` names the feed
        whose POSITION is the one on display. A source that knows when its report
        was actually made (a polled feed - aishub hands out minute-old snapshots)
        passes `pos_time`, and a position OLDER than the one already held is dropped
        rather than walking a fresh live track backwards; its static fields (name,
        type) still merge. Push/receiver feeds pass no pos_time and count as now."""
        if not mmsi:
            return
        mmsi = int(mmsi)
        now = time.time()
        with self._lock:
            v = self._v.get(mmsi)
            if v is None:
                v = {"mmsi": mmsi, "src": src}
                self._v[mmsi] = v
            v.setdefault("srcs", {})[src] = now
            if fields.get("lat") is not None and fields.get("lon") is not None:
                t = pos_time if pos_time is not None else now
                # ⚠ PRIORITY BEFORE FRESHNESS. Two feeds carrying the same ship
                # used to contest on time alone, so the displayed position was
                # whichever wrote last — a coin-toss an operator cannot see and
                # cannot influence. The member feed is the operator's OWN
                # account and is primary: while it is holding a vessel, a
                # lower-priority feed contributes static data (name, type,
                # dimensions) and its provenance in `srcs`, but does not move
                # the ship.
                #
                # ...UNLESS THE PRIMARY HAS GONE QUIET. A primary that stops
                # must not freeze the picture: past PRIMARY_HOLD_S with no
                # report, the next feed takes the position over. Coverage is the
                # whole reason the others are still running.
                held_by = v.get("src")
                held_age = now - (v.get("pos_ts") or 0)
                outranked = (self._rank(src) < self._rank(held_by)
                             and held_age < self.PRIMARY_HOLD_S)
                if outranked or t < v.get("pos_time", -1e18) - 2.0:
                    # a lower-priority feed, or a stale position from a slower
                    # one: keep the position we have, take the static fields
                    fields = {k: val for k, val in fields.items()
                              if k not in self.POS_KEYS}
                else:
                    v["pos_time"] = t
                    v["pos_ts"] = now      # freshness clock: when WE heard it
                    v["src"] = src         # position provenance follows the winner
            for k, val in fields.items():
                if val is not None:
                    v[k] = val
            v["last_ts"] = now

    def snapshot(self, bbox=None, limit=0):
        """Current vessels with a valid recent position, optionally within bbox
        (W,S,E,N). Returns a list of plain dicts with an `age` (s since position)."""
        now = time.time()
        out = []
        with self._lock:
            dead = [m for m, v in self._v.items() if now - v.get("last_ts", 0) > self.ttl]
            for m in dead:
                del self._v[m]
            for v in self._v.values():
                lat, lon = v.get("lat"), v.get("lon")
                if lat is None or lon is None:
                    continue
                if bbox and not (bbox[0] <= lon <= bbox[2] and bbox[1] <= lat <= bbox[3]):
                    continue
                rec = {
                    "mmsi": v["mmsi"], "lat": round(lat, 6), "lon": round(lon, 6),
                    "sog": v.get("sog"), "cog": v.get("cog"), "heading": v.get("heading"),
                    "name": v.get("name"), "type": v.get("type"),
                    "cat": ship_category(v.get("type")), "nav": v.get("nav"),
                    "age": round(now - v.get("pos_ts", v.get("last_ts", now)), 0),
                    "src": v.get("src"),
                    "srcs": sorted(v.get("srcs", {})),
                }
                # ⚠ THIS DICT IS A WHITELIST AND IT IS WHERE A NEW FIELD GOES TO DIE.
                # The registry stores whatever a decoder reports, so a field can be parsed
                # correctly, merged correctly, held correctly - and still never reach the
                # console, because the serialiser below never mentioned it. Every decoder
                # test passes; the card shows nothing. (The same shape lost `speeds` out of
                # a mission load once already.) So the particulars are enumerated ONCE, in
                # STATIC_KEYS, and both this serialiser and the suite that guards it read
                # that one list - adding a field is one edit, in one place.
                for k in self.STATIC_KEYS:
                    if v.get(k) is not None:
                        rec[k] = v[k]
                out.append(rec)
        out.sort(key=lambda r: r["age"])
        if limit and len(out) > limit:
            out = out[:limit]
        return out

    def count(self):
        with self._lock:
            return len(self._v)


# --------------------------------------------------------------------------- #
#  Source base + status                                                        #
# --------------------------------------------------------------------------- #
class Source(threading.Thread):
    name = "source"

    def __init__(self, reg):
        super().__init__(daemon=True)
        self.reg = reg
        # ⚠ TWO CLOCKS, AND THEY MEAN DIFFERENT THINGS. `updated` is the TRANSPORT
        # clock — when the link last changed state — and `last_report` is the DATA
        # clock, when a datum last arrived. Anything asking "is this feed carrying
        # the picture?" must read the data clock: a far end that ACCEPTS and then
        # hangs up refreshes `updated` on every reconnect and never reaches `_err`,
        # because recv() returning b"" leaves the try block normally. Measured
        # against a real loopback server: 27 reconnects, one report ever, the
        # transport clock never older than 1.5 s, and the poll that exists to carry
        # the feed when the stream drops deferred to it for ever.
        self.status = {"state": "starting", "note": "", "updated": 0, "reports": 0,
                       "last_report": 0}

    def _ok(self, note=""):
        self.status.update(state="ok", note=note, updated=time.time())

    def _ok(self, note=""):
        self.status.update(state="ok", note=note, updated=time.time())

    def _err(self, note):
        self.status.update(state="error", note=str(note)[:200], updated=time.time())

    def _report(self, mmsi, **fields):
        self.reg.update(mmsi, self.name, **fields)
        self.status["reports"] += 1
        self.status["last_report"] = time.time()


# --------------------------------------------------------------------------- #
#  Source: Digitraffic (Finland) — keyless REST                               #
# --------------------------------------------------------------------------- #
class DigitrafficSource(Source):
    name = "digitraffic"
    LOCATIONS = "https://meri.digitraffic.fi/api/ais/v1/locations"
    VESSELS = "https://meri.digitraffic.fi/api/ais/v1/vessels"
    POLL_S = 15.0
    META_EVERY = 20                        # refresh names/types every N location polls

    def _get(self, url, timeout=25):
        # Digitraffic 406s unless the client accepts JSON + gzip, and asks callers to
        # identify themselves with a Digitraffic-User header. Responses are gzipped.
        headers = dict(UA)
        headers.update({"Accept": "application/json", "Accept-Encoding": "gzip",
                        "Digitraffic-User": "survey-asv-console/ais-service"})
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            if r.headers.get("Content-Encoding") == "gzip":
                raw = gzip.decompress(raw)
            return json.loads(raw.decode("utf-8", "replace"))

    def run(self):
        meta = {}                          # mmsi -> {name, type}
        i = 0
        while True:
            try:
                if i % self.META_EVERY == 0:
                    try:
                        for v in self._get(self.VESSELS):
                            m = v.get("mmsi")
                            if m:
                                meta[int(m)] = {"name": (v.get("name") or "").strip() or None,
                                                "type": v.get("shipType")}
                    except Exception:
                        pass               # metadata is best-effort
                fc = self._get(self.LOCATIONS)
                n = 0
                for f in fc.get("features", []):
                    m = f.get("mmsi")
                    g = f.get("geometry") or {}
                    c = g.get("coordinates") or []
                    if not m or len(c) < 2:
                        continue
                    p = f.get("properties") or {}
                    md = meta.get(int(m), {})
                    self._report(
                        m, lon=float(c[0]), lat=float(c[1]),
                        sog=_num(p.get("sog"), 102.3), cog=_num(p.get("cog"), 360.0),
                        heading=_num(p.get("heading"), 511), nav=p.get("navStat"),
                        name=md.get("name"), type=md.get("type"))
                    n += 1
                self._ok("%d vessels" % n)
            except Exception as e:
                self._err(e)
            i += 1
            time.sleep(self.POLL_S)


# --------------------------------------------------------------------------- #
#  Source: aisstream.io — global WebSocket (needs a free API key)             #
# --------------------------------------------------------------------------- #
def _frame_error(raw):
    """The upstream's own error message, or None for a data frame.

    aisstream reports faults ("Api Key Is Not Valid", connection limits, ...) as a
    TEXT frame shaped {"error": "..."} - the SAME channel as vessel data. Before this
    existed, such a frame took the read-loop path that stamps state "ok" and then hit
    _ingest, which discards anything without an MMSI: the upstream was TELLING us what
    was wrong and the card showed "connected". Anything carrying MetaData is vessel
    data, whatever other keys it has; a non-dict or unparseable frame is not an error
    REPORT (let _ingest ignore it as before)."""
    try:
        d = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(d, dict) or d.get("MetaData"):
        return None
    err = d.get("error") or d.get("Error")
    return str(err)[:160] if err else None


class AisstreamSource(Source):
    name = "aisstream"
    URL = "wss://stream.aisstream.io/v0/stream"

    def __init__(self, reg, key, bbox=None):
        super().__init__(reg)
        self.key = key
        # aisstream wants [[[lat_min,lon_min],[lat_max,lon_max]]]; default = world
        if bbox:
            self.boxes = [[[bbox[1], bbox[0]], [bbox[3], bbox[2]]]]
        else:
            self.boxes = [[[-90.0, -180.0], [90.0, 180.0]]]

    def run(self):
        backoff = 2.0
        frame_err = None                # the upstream's LAST error frame, until data flows
        while True:
            try:
                ws = WSClient(self.URL)
                ws.connect()
                sub = {"APIKey": self.key, "BoundingBoxes": self.boxes,
                       "FilterMessageTypes": ["PositionReport", "StandardClassBPositionReport",
                                              "ExtendedClassBPositionReport", "ShipStaticData"]}
                ws.send_text(json.dumps(sub))
                self._ok("connected")
                backoff = 2.0
                frame_err = None        # a fresh subscription starts clean; a real fault re-reports
                while True:
                    try:
                        msg = ws.recv_text()
                    except (socket.timeout, TimeoutError):
                        # A QUIET BOX IS NOT AN ERROR. aisstream only pushes when a vessel
                        # INSIDE the subscribed box reports, and coverage comes from
                        # volunteer shore receivers - so a sparsely covered area (Delaware
                        # Bay / Lewes, measured) legitimately goes minutes with no frame.
                        # Treating that as a failure showed "error" in the UI and tore the
                        # socket down into an exponential-backoff reconnect, which then
                        # risked missing the first real report. Hold the connection open.
                        # BUT hold a reported upstream ERROR too: this path re-stamps every
                        # read timeout, and the quiet-box note overwriting "Api Key Is Not
                        # Valid" is how a dead key would read as a quiet sea forever.
                        if frame_err:
                            self._err("aisstream: " + frame_err)
                        else:
                            self._ok("connected; no vessels reporting in this area yet")
                        continue
                    if msg is None:
                        break
                    err = _frame_error(msg)
                    if err is not None:
                        # The upstream said WHAT IS WRONG, on the data channel. Surface it
                        # instead of feeding it to _ingest, whose no-MMSI discard swallowed
                        # it silently - "connected", zero reports, forever (measured live
                        # during the 2026-08-05 empty-feed investigation).
                        frame_err = err
                        self._err("aisstream: " + err)
                        continue
                    frame_err = None    # real data flowing again - the fault has passed
                    self._ok("connected")
                    self._ingest(msg)
            except Exception as e:
                self._err(e)
            time.sleep(backoff)
            backoff = min(60.0, backoff * 2)

    def _ingest(self, raw):
        try:
            d = json.loads(raw)
        except ValueError:
            return
        meta = d.get("MetaData") or {}
        mmsi = meta.get("MMSI") or meta.get("mmsi")
        if not mmsi:
            return
        lat = _num(meta.get("latitude"), None)
        lon = _num(meta.get("longitude"), None)
        name = (meta.get("ShipName") or "").strip() or None
        mtype = d.get("MessageType")
        body = (d.get("Message") or {}).get(mtype, {}) if mtype else {}
        sog = cog = hdg = nav = shiptype = None
        static = {}
        if mtype in ("PositionReport", "StandardClassBPositionReport",
                     "ExtendedClassBPositionReport"):
            sog = _num(body.get("Sog"), 102.3)
            cog = _num(body.get("Cog"), 360.0)
            hdg = _num(body.get("TrueHeading"), 511)
            nav = body.get("NavigationalStatus")
            if lat is None:
                lat = _num(body.get("Latitude"), None)
                lon = _num(body.get("Longitude"), None)
        elif mtype == "ShipStaticData":
            shiptype = body.get("Type")
            name = name or ((body.get("Name") or "").strip() or None)
            # ⚠ THIS MESSAGE WAS ALREADY ARRIVING AND MOST OF IT WAS BEING THROWN AWAY.
            # The subscription has asked for ShipStaticData since the day it was written,
            # and the handler kept `Type` and `Name` and dropped the rest on the floor:
            # the hull DIMENSIONS, the DESTINATION, the draught, the IMO number and the
            # call sign are all in the same object. Andy asked (2026-09-02) for vessel
            # type, length, width and destination "from other sources"; four of those five
            # need no other source at all - they need this branch to stop discarding them.
            # (Tonnage genuinely is not in AIS, in any message. See `extra` below.)
            static.update(_static_from_aisstream(body))
        self._report(mmsi, lat=lat, lon=lon, sog=sog, cog=cog, heading=hdg,
                     nav=nav, name=name, type=shiptype, **static)
        self.status["updated"] = time.time()


# --------------------------------------------------------------------------- #
#  Source: NMEA AIVDM — local AIS receiver (RTL-SDR + AIS-catcher / rtl-ais)   #
# --------------------------------------------------------------------------- #
_AIS6 = "@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_ !\"#$%&'()*+,-./0123456789:;<=>?"


def _payload_to_bits(payload, fill):
    """6-bit ASCII-armoured AIVDM payload -> (bigint, nbits) MSB-first."""
    bits = 0
    nbits = 0
    for ch in payload:
        c = ord(ch) - 48
        if c > 40:
            c -= 8
        if c < 0 or c > 63:
            return None, 0
        bits = (bits << 6) | c
        nbits += 6
    fill = max(0, min(fill, nbits))
    return bits >> fill, nbits - fill      # drop the trailing fill bits


def _gb(bits, nbits, start, length):
    shift = nbits - (start + length)
    if shift < 0:
        return None
    return (bits >> shift) & ((1 << length) - 1)


def _gs(bits, nbits, start, length):
    """Signed (two's complement) field."""
    v = _gb(bits, nbits, start, length)
    if v is None:
        return None
    if v & (1 << (length - 1)):
        v -= (1 << length)
    return v


def _text(bits, nbits, start, nchars):
    out = []
    for k in range(nchars):
        v = _gb(bits, nbits, start + k * 6, 6)
        if v is None:
            break
        out.append(_AIS6[v])
    return "".join(out).replace("@", " ").strip() or None


def decode_aivdm_payload(payload, fill):
    """Decode one (already reassembled) AIVDM payload. Returns a report dict with
    at least `mmsi`, plus whatever the message type carries, or None."""
    bits, nb = _payload_to_bits(payload, fill)
    if bits is None or nb < 38:
        return None
    mtype = _gb(bits, nb, 0, 6)
    mmsi = _gb(bits, nb, 8, 30)
    if not mmsi:
        return None
    r = {"mmsi": mmsi}
    if mtype in (1, 2, 3):                  # Class A position report
        r["nav"] = _gb(bits, nb, 38, 4)
        sog = _gb(bits, nb, 50, 10)
        r["sog"] = None if sog is None or sog == 1023 else sog / 10.0
        lon = _gs(bits, nb, 61, 28)
        lat = _gs(bits, nb, 89, 27)
        r["lon"] = None if lon is None or abs(lon) > 180 * 600000 else lon / 600000.0
        r["lat"] = None if lat is None or abs(lat) > 90 * 600000 else lat / 600000.0
        cog = _gb(bits, nb, 116, 12)
        r["cog"] = None if cog is None or cog == 3600 else cog / 10.0
        hdg = _gb(bits, nb, 128, 9)
        r["heading"] = None if hdg is None or hdg == 511 else hdg
    elif mtype == 5:                        # Class A static + voyage
        # ⚠ THE OFFSETS ARE ITU-R M.1371 AND ARE NOT NEGOTIABLE. This branch used to read
        # the name and the type and stop, so a receiver on deck knew less about a contact
        # than the message it had just decoded contained. Everything below was already in
        # the bits.  imo 40(30) callsign 70(42) name 112(120) type 232(8)
        # A 240(9) B 249(9) C 258(6) D 264(6)  draught 294(8, 0.1 m)  dest 302(120)
        r["name"] = _text(bits, nb, 112, 20)
        r["type"] = _gb(bits, nb, 232, 8)
        imo = _gb(bits, nb, 40, 30)
        if imo:
            r["imo"] = imo
        cs = _text(bits, nb, 70, 7)
        if cs:
            r["callsign"] = cs
        r.update(_dims(_gb(bits, nb, 240, 9), _gb(bits, nb, 249, 9),
                       _gb(bits, nb, 258, 6), _gb(bits, nb, 264, 6)))
        dr = _gb(bits, nb, 294, 8)
        if dr:
            r["draught"] = round(dr / 10.0, 1)      # broadcast in tenths of a metre
        dest = _text(bits, nb, 302, 20)
        if dest:
            r["dest"] = dest
        mo, dy = _gb(bits, nb, 274, 4), _gb(bits, nb, 278, 5)
        if mo and dy:                                # month/day/hour/min, no YEAR - see
            r["eta"] = "%02d-%02d %02d:%02d" % (    # _static_from_aisstream
                mo, dy, _gb(bits, nb, 283, 5) or 0, _gb(bits, nb, 288, 6) or 0)
    elif mtype == 18:                       # Class B position report
        sog = _gb(bits, nb, 46, 10)
        r["sog"] = None if sog is None or sog == 1023 else sog / 10.0
        lon = _gs(bits, nb, 57, 28)
        lat = _gs(bits, nb, 85, 27)
        r["lon"] = None if lon is None or abs(lon) > 180 * 600000 else lon / 600000.0
        r["lat"] = None if lat is None or abs(lat) > 90 * 600000 else lat / 600000.0
        cog = _gb(bits, nb, 112, 12)
        r["cog"] = None if cog is None or cog == 3600 else cog / 10.0
        hdg = _gb(bits, nb, 124, 9)
        r["heading"] = None if hdg is None or hdg == 511 else hdg
    elif mtype == 19:                       # Class B extended (pos + name/type)
        sog = _gb(bits, nb, 46, 10)
        r["sog"] = None if sog is None or sog == 1023 else sog / 10.0
        lon = _gs(bits, nb, 57, 28)
        lat = _gs(bits, nb, 85, 27)
        r["lon"] = None if lon is None or abs(lon) > 180 * 600000 else lon / 600000.0
        r["lat"] = None if lat is None or abs(lat) > 90 * 600000 else lat / 600000.0
        cog = _gb(bits, nb, 112, 12)
        r["cog"] = None if cog is None or cog == 3600 else cog / 10.0
        hdg = _gb(bits, nb, 124, 9)
        r["heading"] = None if hdg is None or hdg == 511 else hdg
        r["name"] = _text(bits, nb, 143, 20)
        r["type"] = _gb(bits, nb, 263, 8)
        r.update(_dims(_gb(bits, nb, 271, 9), _gb(bits, nb, 280, 9),   # A B C D
                       _gb(bits, nb, 289, 6), _gb(bits, nb, 295, 6)))
    elif mtype == 24:                       # Class B static (part A name / part B type)
        part = _gb(bits, nb, 38, 2)
        if part == 0:
            r["name"] = _text(bits, nb, 40, 20)
        else:
            # Part B: type 40(8) vendor 48(42) callsign 90(42) A 132(9) B 141(9)
            # C 150(6) D 156(6). A Class B hull broadcasts no destination and no
            # draught - it is not required to - so those stay absent rather than
            # being filled with a zero that would read as a real reading.
            r["type"] = _gb(bits, nb, 40, 8)
            cs = _text(bits, nb, 90, 7)
            if cs:
                r["callsign"] = cs
            r.update(_dims(_gb(bits, nb, 132, 9), _gb(bits, nb, 141, 9),
                           _gb(bits, nb, 150, 6), _gb(bits, nb, 156, 6)))
    else:
        return None                         # type we don't map (e.g. 4/21/base stns)
    return r


class NmeaAivdmDecoder:
    """Reassembles multi-part AIVDM sentences and decodes them."""
    def __init__(self):
        self._parts = {}                    # seqid -> {total, frags:{n:payload}, fill}

    def feed_line(self, line):
        line = line.strip()
        if not line or ("AIVDM" not in line and "AIVDO" not in line):
            return None
        if "*" in line:
            line = line[:line.rindex("*")]
        f = line.split(",")
        if len(f) < 7:
            return None
        try:
            total = int(f[1]); seq = int(f[2])
        except ValueError:
            return None
        payload = f[5]
        try:
            fill = int(f[6]) if f[6] else 0
        except ValueError:
            fill = 0
        if total == 1:
            return decode_aivdm_payload(payload, fill)
        sid = f[3] or "0"                    # sequential message id
        rec = self._parts.setdefault(sid, {"total": total, "frags": {}, "fill": 0})
        rec["frags"][seq] = payload
        rec["fill"] = fill                  # fill bits belong to the LAST fragment
        if len(rec["frags"]) >= total:
            joined = "".join(rec["frags"].get(k, "") for k in range(1, total + 1))
            del self._parts[sid]
            return decode_aivdm_payload(joined, rec["fill"])
        return None


class NmeaSource(Source):
    name = "nmea"

    def __init__(self, reg, host="127.0.0.1", port=10110, udp=False, label=None):
        super().__init__(reg)
        # a LABEL distinguishes several endpoints running at once (AIS-catcher on
        # one UDP port, rtl-ais on another): each shows separately in `sources`
        if label:
            self.name = label
        self.host, self.port, self.udp = host, int(port), udp
        self.dec = NmeaAivdmDecoder()

    def run(self):
        if self.udp:
            self._run_udp()
        else:
            self._run_tcp()

    def _handle(self, text):
        for line in text.replace("\r", "\n").split("\n"):
            try:
                rep = self.dec.feed_line(line)
            except Exception:
                rep = None
            if rep:
                self._report(**rep)
                self.status["updated"] = time.time()

    def _run_udp(self):
        while True:
            try:
                s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                s.bind((self.host, self.port))
                self._ok("udp %s:%d" % (self.host, self.port))
                while True:
                    data, _ = s.recvfrom(4096)
                    self._handle(data.decode("ascii", "replace"))
            except Exception as e:
                self._err(e)
                time.sleep(3)

    def _run_tcp(self):
        while True:
            try:
                s = socket.create_connection((self.host, self.port), timeout=15)
                self._ok("tcp %s:%d" % (self.host, self.port))
                buf = b""
                while True:
                    chunk = s.recv(4096)
                    if not chunk:
                        break
                    buf += chunk
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        self._handle(line.decode("ascii", "replace"))
            except Exception as e:
                self._err(e)
            time.sleep(3)


def _parse_nmea_spec(spec):
    """'udp[:HOST]:PORT' / 'tcp[:HOST]:PORT' -> (proto, host, port).

    udp BINDS (default 0.0.0.0 - AIS-catcher / rtl-ais send datagrams TO us);
    tcp CONNECTS (default 127.0.0.1 - OpenCPN and AIS-catcher can both serve a
    TCP NMEA stream). Raises ValueError on anything else - a mis-typed endpoint
    must refuse loudly, not bind the wrong thing."""
    parts = [p.strip() for p in str(spec).split(":")]
    proto = parts[0].lower()
    if proto not in ("udp", "tcp"):
        raise ValueError("nmea spec wants udp[:host]:port or tcp[:host]:port, got %r" % (spec,))
    if len(parts) == 2:
        host, port_s = "", parts[1]
    elif len(parts) == 3:
        host, port_s = parts[1], parts[2]
    else:
        raise ValueError("nmea spec wants udp[:host]:port or tcp[:host]:port, got %r" % (spec,))
    port = int(port_s)                       # ValueError propagates, message is the spec's
    if not 0 < port < 65536:
        raise ValueError("nmea spec port out of range: %r" % (spec,))
    return proto, host or ("0.0.0.0" if proto == "udp" else "127.0.0.1"), port


class OpencpnSource(NmeaSource):
    """OpenCPN as a feed: OpenCPN aggregates its own inputs (a receiver, other
    networks) and can re-serve them as an NMEA stream - Options > Connections >
    Add Connection > Network / TCP, Output on, default port 10110. We connect to
    that as a TCP client and decode the AIVDM it relays. Nothing OpenCPN-specific
    is on the wire; this class exists so the source is NAMED for what it is in
    the console's per-source health."""
    def __init__(self, reg, host="127.0.0.1", port=10110):
        super().__init__(reg, host=host, port=port, udp=False, label="opencpn")


# --------------------------------------------------------------------------- #
#  Source: AISHub — member data-sharing pool (HTTP poll)                       #
# --------------------------------------------------------------------------- #
AIS_LAT_NA = 91.0            # ITU-R M.1371 "latitude not available"
AIS_LON_NA = 181.0           # ITU-R M.1371 "longitude not available"
AISHUB_RAW_PER_DEG = 600000.0


def _is_na(v, na):
    """True for an AIS not-available coordinate sentinel, in EITHER unit system."""
    if v is None:
        return False
    v = abs(v)
    return abs(v - na) < 1e-6 or abs(v - na * AISHUB_RAW_PER_DEG) < 0.5


def _aishub_format_is_raw(dicts):
    """Is this response in RAW AIS units? Decided ONCE, for the whole response.

    AISHub answers in HUMAN units (decimal degrees, knots) or in RAW AIS units
    (1/600000-degree integers, tenths of knots/degrees). Field-by-field guessing
    cannot work -- a raw SOG of 74 (7.4 kn) is indistinguishable from 74 kn on its
    own -- so the coordinates decide it for every field: a raw latitude is off
    Earth when read as degrees.

    ONE RECORD MUST NOT DECIDE FOR THE REST, AND THE FIRST VERSION LET IT. It asked
    `any()` whether a coordinate was off Earth as degrees -- which is true of the
    91/181 sentinel that EVERY vessel without a GPS fix broadcasts. A single unfixed
    ship in an otherwise ordinary human-format response therefore flipped the whole
    response into raw and divided every good position by 600000. Measured, two
    vessels off Lewes plus one with no fix:

        38.780 N  75.120 W  5.0 kn  ->  0.0000646 N  0.0001252 W  0.5 kn
        38.800 N  75.200 W  5.0 kn  ->  0.0000647 N  0.0001253 W  0.5 kn

    -- the whole picture moved to the Gulf of Guinea at a tenth of its real speed,
    with no error raised anywhere. The sentinels are exact and known in BOTH unit
    systems, so they are excluded from the vote rather than counted in it, and raw
    must win a majority of what remains. A response with no usable coordinate at all
    votes human, which is the reading that leaves the upstream's numbers alone.
    """
    raw = human = 0
    for r in dicts:
        for key, limit, na in (("LATITUDE", 90.0, AIS_LAT_NA),
                               ("LONGITUDE", 180.0, AIS_LON_NA)):
            v = _num(r.get(key), None)
            if v is None or _is_na(v, na):
                continue                     # no fix: says nothing about the units
            if abs(v) > limit:
                raw += 1
            else:
                human += 1
    return raw > human


def _aishub_normalize(recs):
    """AISHub records -> normalized report dicts, whichever format the account is
    served in. The unit system is decided once per response by
    `_aishub_format_is_raw`; the out-of-range guards below then drop a position the
    upstream did not have, in either format -- a raw 91-degree sentinel is 54600000,
    which scales back to 91.0 and fails the same check."""
    dicts = [r for r in recs if isinstance(r, dict)]
    raw = _aishub_format_is_raw(dicts)
    out = []
    for rec in dicts:
        m = rec.get("MMSI")
        if not m:
            continue
        lat = _num(rec.get("LATITUDE"), None)
        lon = _num(rec.get("LONGITUDE"), None)
        sog = _num(rec.get("SOG"), None)
        cog = _num(rec.get("COG"), None)
        if raw:
            lat = lat / AISHUB_RAW_PER_DEG if lat is not None else None
            lon = lon / AISHUB_RAW_PER_DEG if lon is not None else None
            sog = sog / 10.0 if sog is not None else None
            cog = cog / 10.0 if cog is not None else None
        if lat is not None and abs(lat) > 90.0:
            lat = None
        if lon is not None and abs(lon) > 180.0:
            lon = None
        if sog is not None and abs(sog - 102.3) < 1e-6:      # AIS n/a sentinel
            sog = None
        if cog is not None and abs(cog - 360.0) < 1e-6:      # AIS n/a sentinel
            cog = None
        rep = {
            "mmsi": m, "pos_time": _aishub_time(rec.get("TIME")),
            "lat": lat, "lon": lon, "sog": sog, "cog": cog,
            "heading": _num(rec.get("HEADING"), 511), "nav": rec.get("NAVSTAT"),
            "name": (str(rec.get("NAME") or "").strip() or None),
            "type": rec.get("TYPE"),
        }
        # ⚠⚠ THE PARTICULARS, which this feed threw away while being the HIGHEST-PRIORITY one
        # (Registry.PRIORITY aishub 30). Andy asked for "the type of vessel, length" in the AIS
        # capture; type was carried on every feed and length on two of four, so a hull only
        # AISHub sees arrived with no size at all - and size is most of what judging a CPA and
        # drawing an icon to scale need.
        #
        # A/B/C/D are the antenna-referenced offsets, WHOLE METRES in AIS and in AISHub's human
        # format alike, so unlike lat/lon/sog/cog they need no raw-vs-human decision. `_dims`
        # reads all-four-zero as the not-available encoding rather than as a zero-metre ship,
        # and keeps a partial set - a hull reporting A and B alone still has a known LENGTH.
        rep.update(_dims(rec.get("A"), rec.get("B"), rec.get("C"), rec.get("D")))
        # `_ais_text` reads AIS's '@' padding as ABSENT, so an unset destination does not
        # render as a blank field beside a populated one.
        for key, field in (("DEST", "dest"), ("CALLSIGN", "callsign")):
            v = _ais_text(rec.get(key))
            if v:
                rep[field] = v
        imo = _num(rec.get("IMO"), 0)
        if imo:
            rep["imo"] = int(imo)
        # ⚠ DRAUGHT IS DELIBERATELY NOT TAKEN. AIS carries it in TENTHS of a metre, and the
        # raw-vs-human test above reads the COORDINATES - it says nothing about the unit this
        # field arrives in. A 3.4 m draught published as 34 m on a console whose keep-out floor
        # is a depth is worse than no draught at all. It needs a live response to settle, and
        # this tree has no membership key.
        #
        # ⚠ AND THE KEYS ABOVE COME FROM AISHub's PUBLISHED OUTPUT FORMAT, not from a response
        # seen here. If one is wrong, `_dims` of four Nones returns {} and `_ais_text` of None
        # returns None - the particular is simply absent, exactly as it is today, and never
        # wrong. That bounded failure is the whole reason this is written from the published
        # format; the MarineTraffic source stays unbuilt because its shape changes what a
        # reading MEANS, which no default can make safe.
        out.append(rep)
    return out


def _aishub_time(s):
    """AISHub record TIME ('YYYY-MM-DD HH:MM:SS GMT') -> epoch seconds or None."""
    try:
        return calendar.timegm(time.strptime(str(s).replace(" GMT", "").strip(),
                                             "%Y-%m-%d %H:%M:%S"))
    except (ValueError, TypeError):
        return None


class AishubStreamSource(NmeaSource):
    """
    AISHub's member TCP stream — `data.aishub.net:4100`.

    Andy, 2026-08-25: *"host - data.aishub.net tcp port 4100."*

    **NO SECOND DECODER, AND THAT IS THE WHOLE IMPLEMENTATION.** What comes down
    that socket is NMEA AIVDM, which is exactly what `NmeaSource` already reads
    from a local RTL-SDR or from OpenCPN. This is that class with the pool's host
    and port on it, so a fix to the decoder reaches every consumer of the feed at
    once. It reports under the name `aishub`, because that is whose data it is —
    the transport is not the provenance.

    ⚠ THE PORT IS GATED BY IP, NOT BY THE USERNAME. Measured 2026-08-25 from this
    machine: DNS resolves, 80 and 443 open normally, and 4100 times out with NO
    RST — the signature of a firewall admitting only registered addresses, not of
    a refused login. The member username authenticates the HTTP API; the stream
    authorises the SOURCE ADDRESS, registered at aishub.net. So a failure here is
    reported as an authorisation problem the operator can act on, rather than as
    "no vessels", which is what an unexplained empty sea would look like.
    """

    name = "aishub"
    HOST = "data.aishub.net"
    PORT = 4100
    #: How long an unreachable port stays unexplained before the note says why.
    HINT_AFTER_S = 45.0

    def __init__(self, reg, host=None, port=None):
        super().__init__(reg, host=host or self.HOST, port=int(port or self.PORT), udp=False)
        self.name = "aishub"                     # provenance: whose data it is
        self.health_name = "aishub (stream)"     # health: which socket carried it
        self._first_err = 0.0

    def _err(self, note):
        # The bare socket error is true but useless — "timed out" on a port that
        # is silently dropped tells an operator nothing they can do.
        txt = str(note)[:120]
        now = time.time()
        if not self._first_err:
            self._first_err = now
        if now - self._first_err > self.HINT_AFTER_S:
            txt += (" — port %d is authorised BY IP at aishub.net; register this "
                    "machine's public address on the account, or the HTTP poll "
                    "will carry the feed instead" % self.PORT)
        super()._err(txt)

    def _report(self, mmsi, **fields):
        self._first_err = 0.0            # a report means the stream is through
        super()._report(mmsi, **fields)


class AishubSource(Source):
    name = "aishub"
    URL = "https://data.aishub.net/ws.php"
    POLL_S = 65.0            # AISHub's hard limit is one request per minute per account
    DENIED_S = 900.0         # an auth refusal will not heal by asking again sooner

    #: A stream that has reported this recently is carrying the feed.
    STREAM_FRESH_S = 120.0

    def __init__(self, reg, user, bbox=None, stream=None):
        super().__init__(reg)
        self.user = user
        self.bbox = bbox                     # W,S,E,N, or None for everything shared
        self.health_name = "aishub (poll)"
        # ⚠ THE POLL DEFERS TO THE STREAM RATHER THAN RACING IT. Both carry the
        # same pool, and AISHub's hard limit is one request per minute per
        # ACCOUNT — spending that quota while a live stream is already
        # delivering would buy nothing and would leave no request in hand for
        # the moment the stream drops.
        self.stream = stream

    def _stream_live(self):
        # ⚠ THE DATA CLOCK, NOT THE CONNECT CLOCK. This used to read `updated`,
        # which `_ok` refreshes on every successful CONNECT — so a far end that
        # accepted and immediately hung up looked alive for ever (it never reaches
        # `_err`: recv() returning b"" leaves the try block normally) and the poll
        # stood by against a socket delivering nothing. "Carrying the feed" is a
        # claim about DATA, and only `last_report` is evidence of data.
        st = getattr(self.stream, "status", None)
        if not st or not st.get("reports"):
            return False
        return (st.get("state") == "ok"
                and time.time() - (st.get("last_report") or 0) < self.STREAM_FRESH_S)

    def _fetch(self):
        q = {"username": self.user, "format": "1", "output": "json", "compress": "0"}
        if self.bbox:
            q.update(lonmin=self.bbox[0], latmin=self.bbox[1],
                     lonmax=self.bbox[2], latmax=self.bbox[3])
        req = urllib.request.Request(self.URL + "?" + urllib.parse.urlencode(q), headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8", "replace"))

    def run(self):
        while True:
            wait = self.POLL_S
            if self._stream_live():
                # Standby, said out loud: an operator reading the card must be
                # able to tell "deferring to the stream" from "not working".
                self._ok("standby — the TCP stream is carrying the feed")
                time.sleep(wait)
                continue
            try:
                d = self._fetch()
                head = d[0] if isinstance(d, list) and d and isinstance(d[0], dict) else {}
                if head.get("ERROR"):
                    # AISHub reports faults as DATA - [{"ERROR":true,...}] - the same
                    # shape-trap as aisstream's error frames: surface the upstream's
                    # own words, never ingest them as an empty sea. Measured live:
                    # a bad username answers {"ERROR_MESSAGE":"Invalid username or
                    # password!"} on HTTP 200.
                    self._err("aishub: " + str(head.get("ERROR_MESSAGE") or "error")[:160])
                    wait = self.DENIED_S
                else:
                    recs = d[1] if (isinstance(d, list) and len(d) > 1
                                    and isinstance(d[1], list)) else []
                    n = 0
                    for rep in _aishub_normalize(recs):
                        self._report(**rep)
                        n += 1
                    self._ok("%d vessels" % n)
            except Exception as e:
                self._err(e)
            time.sleep(wait)


# --------------------------------------------------------------------------- #
#  Minimal RFC-6455 WebSocket client (stdlib only)                            #
# --------------------------------------------------------------------------- #
class WSClient:
    def __init__(self, url, timeout=30):
        if not url.startswith("wss://"):
            raise ValueError("only wss:// supported")
        rest = url[6:]
        host, _, path = rest.partition("/")
        self.host = host.split(":")[0]
        self.port = int(host.split(":")[1]) if ":" in host else 443
        self.path = "/" + path
        self.timeout = timeout
        self.sock = None
        self._buf = b""

    def connect(self):
        raw = socket.create_connection((self.host, self.port), self.timeout)
        ctx = ssl.create_default_context()
        self.sock = ctx.wrap_socket(raw, server_hostname=self.host)
        key = base64.b64encode(os.urandom(16)).decode()
        req = ("GET %s HTTP/1.1\r\nHost: %s\r\nUpgrade: websocket\r\n"
               "Connection: Upgrade\r\nSec-WebSocket-Key: %s\r\n"
               "Sec-WebSocket-Version: 13\r\n\r\n") % (self.path, self.host, key)
        self.sock.sendall(req.encode())
        # read until end of headers
        hdr = b""
        while b"\r\n\r\n" not in hdr:
            chunk = self.sock.recv(1024)
            if not chunk:
                raise IOError("ws handshake closed")
            hdr += chunk
        head, _, self._buf = hdr.partition(b"\r\n\r\n")
        if b" 101 " not in head.split(b"\r\n", 1)[0]:
            raise IOError("ws handshake failed: " + head.split(b"\r\n", 1)[0].decode("latin1"))

    def _recv_exact(self, n):
        while len(self._buf) < n:
            chunk = self.sock.recv(4096)
            if not chunk:
                return None
            self._buf += chunk
        out, self._buf = self._buf[:n], self._buf[n:]
        return out

    def send_text(self, data):
        payload = data.encode("utf-8")
        n = len(payload)
        hdr = bytearray([0x81])             # FIN + text
        if n < 126:
            hdr.append(0x80 | n)
        elif n < 65536:
            hdr.append(0x80 | 126); hdr += struct.pack(">H", n)
        else:
            hdr.append(0x80 | 127); hdr += struct.pack(">Q", n)
        mask = os.urandom(4)
        hdr += mask
        self.sock.sendall(bytes(hdr) + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def _send_frame(self, opcode, payload=b""):
        hdr = bytearray([0x80 | opcode, 0x80 | len(payload)])
        mask = os.urandom(4)
        hdr += mask
        self.sock.sendall(bytes(hdr) + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def recv_text(self):
        """Return the next text message (reassembling continuations), or None on close.
        Replies to pings transparently and skips non-text frames."""
        chunks = []
        while True:
            h = self._recv_exact(2)
            if h is None:
                return None
            fin = h[0] & 0x80
            opcode = h[0] & 0x0F
            masked = h[1] & 0x80
            ln = h[1] & 0x7F
            if ln == 126:
                b = self._recv_exact(2)
                if b is None:
                    return None
                ln = struct.unpack(">H", b)[0]
            elif ln == 127:
                b = self._recv_exact(8)
                if b is None:
                    return None
                ln = struct.unpack(">Q", b)[0]
            mask = self._recv_exact(4) if masked else None
            payload = self._recv_exact(ln) if ln else b""
            if payload is None:
                return None
            if mask:
                payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
            if opcode == 0x8:               # close
                return None
            if opcode == 0x9:               # ping -> pong
                self._send_frame(0xA, payload)
                continue
            if opcode == 0xA:               # pong
                continue
            if opcode in (0x0, 0x1, 0x2):   # continuation / text / binary
                chunks.append(payload)
                if fin:
                    try:
                        return b"".join(chunks).decode("utf-8", "replace")
                    finally:
                        chunks = []
            # else: unknown opcode -> ignore


# --------------------------------------------------------------------------- #
#  Static / voyage particulars — what AIS already carries and we used to drop  #
# --------------------------------------------------------------------------- #
#
# Andy, 2026-09-02: *"add to the AIS capture data the type of vessel, length, width,
# tonnage. Add destination."*
#
# ⚠ FOUR OF THOSE FIVE NEED NO EXTRA SOURCE. AIS message 5 (Class A static and voyage),
# message 24 part B (Class B static) and message 19 (Class B extended) all carry the hull
# DIMENSIONS and the ship TYPE; message 5 also carries DESTINATION, draught, IMO and call
# sign. Both of this service's decoders were reading `name` and `type` out of those
# messages and discarding every other field. Nothing was missing from the feed - it was
# being parsed and thrown away.
#
# ⚠ TONNAGE IS THE EXCEPTION AND IT IS NOT IN AIS AT ALL - no message carries GT or DWT.
# It is a REGISTRY fact, not a broadcast one, so it can only come from a vessel-particulars
# database. See `enrich.py` / the `extra` fields for how that is plugged in, and the note
# in the README about which providers permit it.
#
# DIMENSIONS ARE REFERENCED TO THE GNSS ANTENNA, NOT TO THE HULL: A is the distance from
# the antenna to the bow, B to the stern, C to port, D to starboard. So the hull is
# A + B long and C + D wide, and the antenna's offset within it is known too - which is
# why the parts are kept as well as the sums. A vessel that reports 0 for a dimension is
# saying "not available", not "zero metres"; an all-zero set is no information.

#: AIS "not available" for the 20-character text fields.
_AIS_TEXT_NA = ("", "@", "UNKNOWN", "N/A", "NIL")


def _ais_text(v):
    """A trimmed AIS string, or None when it is the not-available filler.

    AIS pads text with '@'. A destination of '@@@@@@@@' is not a destination, and a name
    of '' is not a name - both must read as ABSENT rather than as an empty string the UI
    would then render as a blank field beside a populated one.
    """
    if v is None:
        return None
    t = str(v).replace("@", " ").strip()
    return None if not t or t.upper() in _AIS_TEXT_NA else t


def _dims(a, b, c, d):
    """{length, beam, dim} from the four antenna-referenced offsets, or {} if unknown.

    All four zero is the not-available encoding, not a zero-metre ship. A partial set is
    still worth having: a hull that reports A and B but not C and D has a known LENGTH,
    and length alone is most of what sizing an icon and judging a CPA needs.
    """
    vals = [_num(x, None) for x in (a, b, c, d)]
    a, b, c, d = [0.0 if v is None else float(v) for v in vals]
    if a == b == c == d == 0:
        return {}
    out = {"dim": {"a": a, "b": b, "c": c, "d": d}}
    if a + b > 0:
        out["length"] = round(a + b, 1)
    if c + d > 0:
        out["beam"] = round(c + d, 1)
    return out


def _static_from_aisstream(body):
    """Static + voyage particulars out of an aisstream ShipStaticData message.

    Field names are aisstream's own (`Dimension.A`, `MaximumStaticDraught`, ...) - see
    their published type-definition. Every one is optional here: a partial message must
    contribute what it has rather than being dropped whole.
    """
    out = {}
    dim = body.get("Dimension") or {}
    out.update(_dims(dim.get("A"), dim.get("B"), dim.get("C"), dim.get("D")))
    dest = _ais_text(body.get("Destination"))
    if dest:
        out["dest"] = dest
    call = _ais_text(body.get("CallSign"))
    if call:
        out["callsign"] = call
    imo = _num(body.get("ImoNumber"), 0)
    if imo:
        out["imo"] = int(imo)
    dr = _num(body.get("MaximumStaticDraught"), 0)
    if dr:
        out["draught"] = round(dr, 1)
    eta = body.get("Eta") or {}
    # ETA is broadcast as month/day/hour/minute with no YEAR - it is a voyage field, not a
    # timestamp, and rendering it as one would invent a year the vessel never sent.
    if eta.get("Month") and eta.get("Day"):
        out["eta"] = "%02d-%02d %02d:%02d" % (eta.get("Month") or 0, eta.get("Day") or 0,
                                              eta.get("Hour") or 0, eta.get("Minute") or 0)
    return out


def _num(v, na):
    """Float or None; treat the AIS not-available sentinel `na` as None."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if na is not None and abs(f - na) < 1e-6:
        return None
    return f


# --------------------------------------------------------------------------- #
#  HTTP query interface                                                        #
# --------------------------------------------------------------------------- #
def make_handler(reg, sources):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass                             # quiet

        def _send(self, code, obj):
            body = json.dumps(obj).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            try:
                self.wfile.write(body)
            except (ConnectionError, BrokenPipeError):
                pass

        def _src_status(self):
            # ⚠ KEYED BY `health_name`, NOT `name`. Both AISHub transports report
            # vessels as "aishub" — that IS the provenance, whatever socket they
            # arrived on — so keying health by name collapsed them into one row
            # and hid which one was carrying the feed, and with it the stream's
            # "authorise this IP" hint. Provenance and health are different
            # questions; only the second needs the transport.
            return {getattr(s, "health_name", s.name): dict(s.status) for s in sources}

        def do_GET(self):
            path, _, qs = self.path.partition("?")
            # PERCENT-DECODE THE VALUES. Without this a caller that encodes the commas -
            # bbox=1%2C2%2C3%2C4, which is a perfectly legal way to write it - had its box
            # silently ignored and got the WHOLE registry back rather than an error. The
            # console sends plain commas so nothing was broken in practice, but "you asked
            # for a box and got everything" is the wrong way for this to fail. Strictly more
            # permissive: a plain value decodes to itself.
            q = {}
            for kv in qs.split("&"):
                if "=" in kv:
                    k, v = kv.split("=", 1)
                    q[k] = urllib.parse.unquote(v)
            if path == "/health":
                self._send(200, {"ok": True, "count": reg.count(),
                                 "sources": self._src_status()})
                return
            if path == "/vessels":
                bbox = None
                if q.get("bbox"):
                    try:
                        parts = [float(x) for x in q["bbox"].split(",")]
                        if len(parts) == 4:
                            bbox = parts    # W,S,E,N
                    except ValueError:
                        bbox = None
                try:
                    limit = int(q.get("max", "0"))
                except ValueError:
                    limit = 0
                vessels = reg.snapshot(bbox=bbox, limit=limit)
                self._send(200, {"ok": True, "count": len(vessels),
                                 "generated": time.time(), "vessels": vessels,
                                 "sources": self._src_status()})
                return
            self._send(404, {"ok": False, "error": "not found"})

    return Handler


def _win_persisted_env(name):
    """Windows only: the value `setx` persisted, read straight from the registry.

    A process inherits its environment from its PARENT, so a console launched from a
    shell (or Explorer session) that predates the `setx` never sees the variable - the
    value is stored, but invisible, and the feed silently falls back to the keyless
    source. Windows only refreshes the block for NEW top-level sessions, so without this
    an env-var setup appears not to work until the terminal, or the machine, is
    restarted. Reading HKCU/HKLM makes it take effect on the very next launch."""
    if os.name != "nt":
        return None
    try:
        import winreg
    except ImportError:
        return None
    for root, sub in ((winreg.HKEY_CURRENT_USER, "Environment"),
                      (winreg.HKEY_LOCAL_MACHINE,
                       r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment")):
        try:
            with winreg.OpenKey(root, sub) as k:
                val, _ = winreg.QueryValueEx(k, name)
        except OSError:
            continue
        if val and str(val).strip():
            return str(val).strip()
    return None


def resolve_aisstream_key(args):
    """aisstream key, set once and forgotten: --aisstream-key, then $AISSTREAM_KEY
    (preferred - one value for every console on the machine), then an `ais_key.txt`
    file next to this script (first non-comment line)."""
    if args.aisstream_key:
        return args.aisstream_key.strip()
    if os.environ.get("AISSTREAM_KEY"):
        return os.environ["AISSTREAM_KEY"].strip()
    persisted = _win_persisted_env("AISSTREAM_KEY")     # setx'd but not yet inherited
    if persisted:
        return persisted
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ais_key.txt")
    try:
        with open(path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    return line
    except OSError:
        pass
    return None


def resolve_aishub_user(args):
    """AISHub member username: --aishub-user, then $AISHUB_USER (setx'd value read
    from the registry too, same as the aisstream key). AISHub is a data-sharing
    POOL - API access is granted to accounts that CONTRIBUTE a feed (aishub.net),
    and the credential is a username, not a password."""
    if args.aishub_user:
        return args.aishub_user.strip()
    if os.environ.get("AISHUB_USER"):
        return os.environ["AISHUB_USER"].strip()
    return _win_persisted_env("AISHUB_USER")


def build_sources(reg, args):
    bbox = None
    if args.bbox:
        try:
            bbox = [float(x) for x in args.bbox.split(",")]
            if len(bbox) != 4:
                bbox = None
        except ValueError:
            bbox = None
    key = resolve_aisstream_key(args)
    hub_user = resolve_aishub_user(args)
    names = [s.strip() for s in args.source.split(",") if s.strip()]
    if "auto" in names:
        # zero-config: the global push feed if a key is set up, else the keyless one -
        # plus aishub alongside if ITS credential is set up (it is poll-and-merge, so
        # it only ever adds coverage). Local receivers are never auto-enabled: an
        # endpoint nobody is feeding would sit in the card as a permanent error.
        # Expanded IN PLACE so "auto,opencpn" means auto's picks PLUS OpenCPN.
        # ⚠ AISHUB RUNS ALONGSIDE THE OTHERS, AND IS PRIMARY AMONG THEM. Andy,
        # 2026-08-25: *"along with other sources but as the primary."* Every
        # enabled feed still merges into the one registry — more coverage is
        # strictly better — but when two of them report the SAME ship, the
        # member feed's position is the one displayed. That is a registry rule,
        # not a source list: see `Registry.PRIORITY`. Dropping the others would
        # have thrown away coverage; leaving them equal would have made the
        # displayed position a coin-toss on whichever wrote last.
        expanded = ["aisstream"] if key else ["digitraffic"]
        if hub_user:
            expanded.append("aishub")
        names = [x for n in names for x in (expanded if n == "auto" else [n])]
        seen = set()
        names = [n for n in names if not (n in seen or seen.add(n))]
        why = (" (aishub is primary)" if hub_user else
               ("" if key else " (no aisstream key found; set $AISSTREAM_KEY for global coverage)"))
        print("[ais] source 'auto' -> %s%s" % (",".join(names), why), file=sys.stderr)
    out = []
    for n in names:
        if n == "digitraffic":
            out.append(DigitrafficSource(reg))
        elif n == "aisstream":
            if not key:
                print("[ais] aisstream needs a key (--aisstream-key, $AISSTREAM_KEY, or ais_key.txt); skipping",
                      file=sys.stderr)
                continue
            out.append(AisstreamSource(reg, key, bbox=bbox))
        elif n == "aishub":
            if not hub_user:
                print("[ais] aishub needs a member username (--aishub-user or $AISHUB_USER; "
                      "membership requires contributing a feed - aishub.net); skipping",
                      file=sys.stderr)
                continue
            # BOTH TRANSPORTS, STREAM PREFERRED. The stream is live and costs no
            # quota; the poll stands by behind it and takes over the moment it
            # stops — see AishubSource._stream_live. `--aishub-transport` pins
            # one when an operator needs to.
            mode = getattr(args, "aishub_transport", "auto") or "auto"
            stream = None
            if mode in ("auto", "tcp"):
                stream = AishubStreamSource(reg, host=args.aishub_host,
                                            port=args.aishub_port)
                out.append(stream)
            if mode in ("auto", "http"):
                out.append(AishubSource(reg, hub_user, bbox=bbox, stream=stream))
        elif n == "nmea":
            specs = args.nmea or []
            if specs:
                for spec in specs:
                    try:
                        proto, host, port = _parse_nmea_spec(spec)
                    except ValueError as e:
                        print("[ais] %s; skipping" % e, file=sys.stderr)
                        continue
                    out.append(NmeaSource(reg, host=host, port=port, udp=(proto == "udp"),
                                          label="nmea-%s-%d" % (proto, port)))
            else:
                out.append(NmeaSource(reg, host=args.nmea_host, port=args.nmea_port,
                                      udp=args.nmea_udp))
        elif n == "opencpn":
            out.append(OpencpnSource(reg, host=args.opencpn_host, port=args.opencpn_port))
        else:
            print("[ais] unknown source '%s' (want auto|digitraffic|aisstream|aishub|nmea|opencpn)" % n,
                  file=sys.stderr)
    return out


def _pid_alive(pid):
    """Cross-platform: is process `pid` still running? (stdlib only)."""
    if os.name == "nt":
        import ctypes
        PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
        k = ctypes.windll.kernel32
        h = k.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, False, int(pid))
        if not h:
            return False
        code = ctypes.c_ulong()
        k.GetExitCodeProcess(h, ctypes.byref(code))
        k.CloseHandle(h)
        return code.value == 259           # STILL_ACTIVE
    try:
        os.kill(int(pid), 0)
        return True
    except OSError:
        return False


def _watch_parent(pid):
    """Exit when the parent (the console that auto-started us) is gone - however it
    died (Ctrl+C, hard kill, crash). This keeps an auto-started service from being
    orphaned and squatting the port, on any platform."""
    while True:
        time.sleep(5)
        if not _pid_alive(pid):
            print("[ais] parent %s gone -> exiting" % pid, file=sys.stderr)
            os._exit(0)


def main():
    ap = argparse.ArgumentParser(description="Open-AIS aggregator queried by the console.")
    ap.add_argument("--parent-pid", type=int, default=0,
                    help="exit automatically when this process (the console) exits")
    ap.add_argument("--source", default="auto",
                    help="auto (default: aisstream if a key is set up, else digitraffic; "
                         "+aishub if $AISHUB_USER is set), or a comma list of "
                         "digitraffic,aisstream,aishub,nmea,opencpn - all enabled sources "
                         "merge into one vessel registry")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help="HTTP query port")
    ap.add_argument("--host", default="127.0.0.1", help="HTTP bind host")
    ap.add_argument("--ttl", type=float, default=DEFAULT_TTL,
                    help="drop a vessel unheard this many seconds")
    ap.add_argument("--bbox", default="", help="W,S,E,N area for aisstream subscribe")
    ap.add_argument("--aisstream-key", default="", help="aisstream.io API key (or $AISSTREAM_KEY)")
    ap.add_argument("--aishub-user", default="",
                    help="AISHub member username (or $AISHUB_USER) for --source aishub")
    ap.add_argument("--nmea", action="append", default=None, metavar="PROTO[:HOST]:PORT",
                    help="an NMEA AIVDM endpoint for --source nmea; repeatable, so several "
                         "receivers merge (udp:10110 binds for AIS-catcher / rtl-ais, "
                         "tcp:host:port connects to a served stream)")
    ap.add_argument("--aishub-transport", default="auto", choices=("auto", "tcp", "http"),
                    help="how to reach AISHub: auto (TCP stream, HTTP poll behind it), "
                         "tcp (stream only), http (poll only). Default auto.")
    ap.add_argument("--aishub-host", default=AishubStreamSource.HOST,
                    help="AISHub stream host (default %s)" % AishubStreamSource.HOST)
    ap.add_argument("--aishub-port", type=int, default=AishubStreamSource.PORT,
                    help="AISHub stream port (default %d)" % AishubStreamSource.PORT)
    ap.add_argument("--nmea-host", default="127.0.0.1", help="NMEA AIVDM source host (legacy single endpoint)")
    ap.add_argument("--nmea-port", type=int, default=10110, help="NMEA AIVDM source port (legacy single endpoint)")
    ap.add_argument("--nmea-udp", action="store_true", help="bind UDP instead of TCP-connect (legacy single endpoint)")
    ap.add_argument("--opencpn-host", default="127.0.0.1",
                    help="OpenCPN NMEA server host for --source opencpn")
    ap.add_argument("--opencpn-port", type=int, default=10110,
                    help="OpenCPN NMEA server port for --source opencpn (its TCP default)")
    args = ap.parse_args()

    if args.parent_pid:
        threading.Thread(target=_watch_parent, args=(args.parent_pid,), daemon=True).start()

    reg = Registry(ttl=args.ttl)
    sources = build_sources(reg, args)
    if not sources:
        print("[ais] no sources enabled — nothing to serve. Use --source ...", file=sys.stderr)
        return 2
    for s in sources:
        s.start()

    httpd = ThreadingHTTPServer((args.host, args.port), make_handler(reg, sources))
    httpd.daemon_threads = True
    print("[ais] serving http://%s:%d/vessels  sources=%s"
          % (args.host, args.port, ",".join(s.name for s in sources)))
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n[ais] stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
