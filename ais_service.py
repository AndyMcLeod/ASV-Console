#!/usr/bin/env python3
"""
AIS provider service — a standalone, stdlib-only aggregator of maritime AIS
(Automatic Identification System) vessel reports, queried by the survey-ASV console
over HTTP. AIS is the system by which ships broadcast their identity, position,
course and speed over VHF (and onto the internet via shore/satellite receivers);
this service pulls that from open sources and hands the console a clean vessel list.

It is a SEPARATE process from the console (the console proxies it at /api/ais), so
the data feeds, any API key, and the network I/O stay out of the console and the
browser. Python 3 standard library only — no pip, no build step.

Sources (enable any combination with --source, comma-separated):

  * digitraffic  Finland/Fintraffic open REST feed (meri.digitraffic.fi) — keyless,
                 real live vessels in Finnish/Baltic waters. CC BY 4.0.
  * aisstream    aisstream.io global real-time WebSocket feed — needs a FREE API key
                 (--aisstream-key or $AISSTREAM_KEY). Covers US waters (Erie, Lewes).
  * nmea         a local AIS receiver (RTL-SDR + AIS-catcher / rtl-ais) emitting NMEA
                 AIVDM over TCP or UDP — the real onboard VHF path, decoded here.

Run (zero-config): set an aisstream key up ONCE, then just start it:
  setx AISSTREAM_KEY YOUR_FREE_KEY      # one-time, machine-wide (or: echo KEY > ais_key.txt)
  python ais_service.py                 # --source auto: aisstream if a key exists, else digitraffic

Or pick sources explicitly:
  python ais_service.py --source digitraffic --port 8788
  python ais_service.py --source aisstream --aisstream-key KEY --bbox -80.3,42.0,-79.9,42.3
  python ais_service.py --source nmea --nmea-host 127.0.0.1 --nmea-port 10110

Query (what the console does):
  GET /vessels?bbox=W,S,E,N[&max=N]   -> {"ok":true,"count":..,"vessels":[..],"sources":{..}}
  GET /health                          -> {"ok":true,"sources":{..},"count":..}

AIS is a public safety broadcast; this only *reads* open data. Not for navigation —
it is situational awareness, subject to feed coverage, latency and gaps.
"""

import argparse
import base64
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

    def update(self, mmsi, src, **fields):
        """Merge a report into the registry. Only overwrites keys that are present
        (so a static-data update keeps the last position and vice-versa)."""
        if not mmsi:
            return
        mmsi = int(mmsi)
        now = time.time()
        with self._lock:
            v = self._v.get(mmsi)
            if v is None:
                v = {"mmsi": mmsi}
                self._v[mmsi] = v
            for k, val in fields.items():
                if val is not None:
                    v[k] = val
            v["src"] = src
            # a position update refreshes the freshness clock; static-only doesn't
            if "lat" in fields and "lon" in fields and fields.get("lat") is not None:
                v["pos_ts"] = now
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
                out.append({
                    "mmsi": v["mmsi"], "lat": round(lat, 6), "lon": round(lon, 6),
                    "sog": v.get("sog"), "cog": v.get("cog"), "heading": v.get("heading"),
                    "name": v.get("name"), "type": v.get("type"),
                    "cat": ship_category(v.get("type")), "nav": v.get("nav"),
                    "age": round(now - v.get("pos_ts", v.get("last_ts", now)), 0),
                    "src": v.get("src"),
                })
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
        self.status = {"state": "starting", "note": "", "updated": 0, "reports": 0}

    def _ok(self, note=""):
        self.status.update(state="ok", note=note, updated=time.time())

    def _err(self, note):
        self.status.update(state="error", note=str(note)[:200], updated=time.time())

    def _report(self, mmsi, **fields):
        self.reg.update(mmsi, self.name, **fields)
        self.status["reports"] += 1


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
        self._report(mmsi, lat=lat, lon=lon, sog=sog, cog=cog, heading=hdg,
                     nav=nav, name=name, type=shiptype)
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
        r["name"] = _text(bits, nb, 112, 20)
        r["type"] = _gb(bits, nb, 232, 8)
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
    elif mtype == 24:                       # Class B static (part A name / part B type)
        part = _gb(bits, nb, 38, 2)
        if part == 0:
            r["name"] = _text(bits, nb, 40, 20)
        else:
            r["type"] = _gb(bits, nb, 40, 8)
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

    def __init__(self, reg, host="127.0.0.1", port=10110, udp=False):
        super().__init__(reg)
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
            return {s.name: dict(s.status) for s in sources}

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
    names = [s.strip() for s in args.source.split(",") if s.strip()]
    if names == ["auto"]:
        # zero-config: use the global feed if a key is set up, else the keyless one.
        names = ["aisstream"] if key else ["digitraffic"]
        print("[ais] source 'auto' -> %s%s" % (names[0],
              "" if key else " (no aisstream key found; set $AISSTREAM_KEY for global coverage)"),
              file=sys.stderr)
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
        elif n == "nmea":
            out.append(NmeaSource(reg, host=args.nmea_host, port=args.nmea_port,
                                  udp=args.nmea_udp))
        else:
            print("[ais] unknown source '%s' (want auto|digitraffic|aisstream|nmea)" % n,
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
                    help="auto (default: aisstream if a key is set up, else digitraffic), "
                         "or a comma list of digitraffic,aisstream,nmea")
    ap.add_argument("--port", type=int, default=DEFAULT_PORT, help="HTTP query port")
    ap.add_argument("--host", default="127.0.0.1", help="HTTP bind host")
    ap.add_argument("--ttl", type=float, default=DEFAULT_TTL,
                    help="drop a vessel unheard this many seconds")
    ap.add_argument("--bbox", default="", help="W,S,E,N area for aisstream subscribe")
    ap.add_argument("--aisstream-key", default="", help="aisstream.io API key (or $AISSTREAM_KEY)")
    ap.add_argument("--nmea-host", default="127.0.0.1", help="NMEA AIVDM source host")
    ap.add_argument("--nmea-port", type=int, default=10110, help="NMEA AIVDM source port")
    ap.add_argument("--nmea-udp", action="store_true", help="bind UDP instead of TCP-connect")
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
