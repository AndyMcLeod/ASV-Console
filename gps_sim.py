#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""GPS data-stream simulator - a faithful stand-in for a real GPS receiver / ship
nav feed, for the ASV console (and anything else that speaks NMEA-0183).

It dead-reckons a point from a start position along a heading at a speed (with an
optional gentle weave) and emits standard **NMEA-0183** sentences each cycle:

  * $GPRMC - time, status, position, speed over ground, course, date
  * $GPGGA - time, position, fix quality, satellites, altitude

each with a correct XOR checksum, exactly as a real GPS puck or a vessel's nav
system puts on the wire. Transport is a **TCP server** by default (clients
connect and read the stream, the way the console's GPS ingest and tools like
`nc`/OpenCPN do) or **UDP** (`--udp`, datagrams to host:port). stdlib-only.

This is the "real GPS feed" the console's ROC ingest consumes when no hardware is
present - point a ROC at it (or let sim mode auto-spawn one). See --help.

  python gps_sim.py --port 10110 --lat 42.14 --lon -80.08 --heading 270 --speed 3
  python gps_sim.py --udp --host 127.0.0.1 --port 10110 --speed 2 --turn 2
"""

import argparse
import math
import os
import socket
import sys
import threading
import time

M_PER_DEG_LAT = 111320.0
KN_TO_MS = 0.514444


def dest_point(lat, lon, bearing_deg, dist_m):
    """Move dist_m along bearing from (lat,lon) using a local flat approximation."""
    b = math.radians(bearing_deg)
    dn = dist_m * math.cos(b)
    de = dist_m * math.sin(b)
    return (lat + dn / M_PER_DEG_LAT,
            lon + de / (M_PER_DEG_LAT * math.cos(math.radians(lat))))


def _checksum(body):
    c = 0
    for ch in body:
        c ^= ord(ch)
    return "%02X" % c


def _sentence(body):
    """Wrap an NMEA body ('GPRMC,...') as a full '$...*CS\\r\\n' line."""
    return "$" + body + "*" + _checksum(body) + "\r\n"


def _lat_str(lat):
    h = "N" if lat >= 0 else "S"
    lat = abs(lat)
    d = int(lat)
    m = (lat - d) * 60.0
    return "%02d%07.4f" % (d, m), h


def _lon_str(lon):
    h = "E" if lon >= 0 else "W"
    lon = abs(lon)
    d = int(lon)
    m = (lon - d) * 60.0
    return "%03d%07.4f" % (d, m), h


def build_sentences(lat, lon, cog, sog_kn, t=None):
    """The $GPRMC + $GPGGA pair for a fix, as a single wire string."""
    t = time.gmtime(t if t is not None else time.time())
    hhmmss = time.strftime("%H%M%S", t)
    ddmmyy = time.strftime("%d%m%y", t)
    la, ns = _lat_str(lat)
    lo, ew = _lon_str(lon)
    rmc = "GPRMC,%s.00,A,%s,%s,%s,%s,%.1f,%.1f,%s,,,A" % (
        hhmmss, la, ns, lo, ew, sog_kn, cog % 360.0, ddmmyy)
    gga = "GPGGA,%s.00,%s,%s,%s,%s,1,08,0.9,10.0,M,-34.0,M,," % (
        hhmmss, la, ns, lo, ew)
    return _sentence(rmc) + _sentence(gga)


class TcpServer:
    """Accept clients and broadcast each fix to all of them."""

    def __init__(self, host, port):
        self._clients = []
        self._lock = threading.Lock()
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind((host, port))
        self.sock.listen(8)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self):
        while True:
            try:
                c, addr = self.sock.accept()
            except OSError:
                return
            with self._lock:
                self._clients.append(c)
            print("[gps] client connected: %s:%d" % addr, file=sys.stderr)

    def broadcast(self, data):
        b = data.encode("ascii")
        with self._lock:
            dead = []
            for c in self._clients:
                try:
                    c.sendall(b)
                except OSError:
                    dead.append(c)
            for c in dead:
                self._clients.remove(c)
                try:
                    c.close()
                except OSError:
                    pass


def _pid_alive(pid):
    """Cross-platform liveness check. os.kill(pid, 0) is NOT reliable on Windows -
    there it never raises for a dead pid (and TerminateProcess for a live one), so a
    watchdog built on it would never self-reap. Mirrors ais_service._pid_alive."""
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
    died. Mirrors ais_service._watch_parent so an auto-spawned sim never orphans
    (orphaned sims each squat a port + stream, and pile up across a test session)."""
    while True:
        time.sleep(5)
        if not _pid_alive(pid):
            print("[gps] parent %s gone -> exiting" % pid, file=sys.stderr)
            os._exit(0)


def main():
    ap = argparse.ArgumentParser(description="NMEA-0183 GPS data-stream simulator.")
    ap.add_argument("--host", default="127.0.0.1", help="TCP bind / UDP destination host")
    ap.add_argument("--port", type=int, default=10110, help="TCP/UDP port (default 10110)")
    ap.add_argument("--udp", action="store_true", help="send UDP datagrams instead of a TCP server")
    ap.add_argument("--lat", type=float, default=42.14, help="start latitude (deg)")
    ap.add_argument("--lon", type=float, default=-80.08, help="start longitude (deg)")
    ap.add_argument("--heading", type=float, default=0.0, help="course (deg true)")
    ap.add_argument("--speed", type=float, default=2.0, help="speed over ground (knots)")
    ap.add_argument("--turn", type=float, default=0.0, help="turn rate (deg/s) for a gentle weave")
    ap.add_argument("--rate", type=float, default=1.0, help="fix rate (Hz, default 1)")
    ap.add_argument("--parent-pid", type=int, default=0, help="exit when this pid is gone")
    args = ap.parse_args()

    if args.parent_pid:
        threading.Thread(target=_watch_parent, args=(args.parent_pid,), daemon=True).start()

    lat, lon, hdg = args.lat, args.lon, args.heading
    period = 1.0 / max(0.1, args.rate)
    server = None
    udp = None
    if args.udp:
        udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        print("[gps] UDP -> %s:%d  %.5f,%.5f hdg %.0f spd %.1f kn"
              % (args.host, args.port, lat, lon, hdg, args.speed), file=sys.stderr)
    else:
        try:
            server = TcpServer(args.host, args.port)
        except OSError as e:
            print("[gps] cannot bind %s:%d - %s" % (args.host, args.port, e), file=sys.stderr)
            return 1
        print("[gps] TCP server on %s:%d  %.5f,%.5f hdg %.0f spd %.1f kn"
              % (args.host, args.port, lat, lon, hdg, args.speed), file=sys.stderr)

    t = 0.0
    while True:
        data = build_sentences(lat, lon, hdg, args.speed)
        sys.stdout.write(data)
        sys.stdout.flush()
        if udp is not None:
            try:
                udp.sendto(data.encode("ascii"), (args.host, args.port))
            except OSError:
                pass
        elif server is not None:
            server.broadcast(data)
        time.sleep(period)
        t += period
        if args.turn:                                   # gentle S-weave
            hdg = (hdg + args.turn * math.sin(t / 20.0) * period) % 360.0
        dist = args.speed * KN_TO_MS * period
        lat, lon = dest_point(lat, lon, hdg, dist)


if __name__ == "__main__":
    sys.exit(main() or 0)
