"""tests/ais_sources.py - many AIS feeds, ONE merged picture (2026-08-05, Andy's ask).

WHAT THIS COVERS: the multi-source AIS build-out - AISHub (member HTTP poll),
multiple local NMEA endpoints (AIS-catcher / rtl-ais over UDP, served TCP streams),
and OpenCPN as a TCP relay - all merging into the single Registry the console reads.

THE CONTRACTS, each with its own check:
  * `_parse_nmea_spec` accepts udp[:host]:port / tcp[:host]:port and REFUSES the
    rest loudly - a mis-typed endpoint must not bind the wrong thing.
  * the Registry records per-vessel PROVENANCE (`srcs` = every feed that reported
    it; `src` = the feed whose position is displayed), and a polled report OLDER
    than the position already held cannot walk a live track backwards - while its
    static fields (name, type) still merge.
  * AISHub answers faults AS DATA - [{"ERROR":true,...}] on HTTP 200 (measured
    live: "Invalid username or password!") - and that must surface as state
    "error", never ingest as an empty sea. The aisstream error-frame lesson,
    third instance of the shape.
  * AISHub's response format (human units vs raw AIS units) is detected ONCE per
    response from the coordinates, then scales EVERY field - a raw SOG of 74
    (7.4 kn) is indistinguishable from 74 kn field-by-field.
  * build_sources: one NmeaSource per --nmea spec with a DISTINCT name (each
    endpoint gets its own health in `sources`); `opencpn` is a named TCP source;
    `aishub` without a member username is SKIPPED honestly; "auto" expands
    IN PLACE inside a list, so auto,opencpn keeps the extra source.
  * the transport actually works: a real AIVDM sentence served over TCP (standing
    in for OpenCPN) and sent over UDP (standing in for AIS-catcher / rtl-ais)
    lands in the registry ONCE, merged, with BOTH feeds in `srcs`.

    python tests/ais_sources.py     # exit 0 = pass, 1 = fail  (stdlib, hermetic -
                                    # fake AISHub HTTP server + loopback sockets,
                                    # no real network, no console)

TEETH - mutations RUN with PYTHONDONTWRITEBYTECODE=1 (ais_service.py is CRLF - the
runner reads/writes newline=''), results recorded here:
  * stale-position guard comparison dropped            -> caught by 4b (old poll
    overwrote the fresh live fix)
  * AISHub ERROR head ingested as data (_err skipped)  -> caught by 6 and 6b
  * raw-format detection dropped (_aishub_normalize)   -> caught by 7b (raw sog
    74 read as 74 kn, lat off Earth discarded)
  * --nmea specs collapse to one source (loop break)   -> caught by 8
  * srcs provenance recording dropped                  -> caught by 9c
  * OpencpnSource label lost (generic "nmea")          -> caught by 9b
"""

import json
import os
import socket
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)

import importlib.util

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


spec = importlib.util.spec_from_file_location("aissvc", os.path.join(APP, "ais_service.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

fails = 0
ran = 0


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


def wait_for(pred, timeout=6.0):
    t0 = time.time()
    while time.time() - t0 < timeout:
        if pred():
            return True
        time.sleep(0.05)
    return pred()


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


print("Multi-source AIS — many feeds, one merged picture:")

# ---- 1-2. the endpoint spec parser -------------------------------------------------- #
P = m._parse_nmea_spec
check("1. udp:10110 binds any-interface by default",
      lambda: P("udp:10110") == ("udp", "0.0.0.0", 10110))
check("1b. tcp:10110 connects loopback by default",
      lambda: P("tcp:10110") == ("tcp", "127.0.0.1", 10110))
check("1c. an explicit host survives",
      lambda: P("tcp:192.168.1.5:2000") == ("tcp", "192.168.1.5", 2000))


def refuses(spec_s):
    try:
        P(spec_s)
        return False
    except ValueError:
        return True


check("2. a wrong protocol refuses", lambda: refuses("http:10110"))
check("2b. a port of 0 refuses", lambda: refuses("udp:0"))
check("2c. a bare protocol refuses", lambda: refuses("udp"))
check("2d. a non-numeric port refuses", lambda: refuses("udp:abc"))

# ---- 3-4. registry merge + provenance + the stale-position guard -------------------- #
reg = m.Registry(ttl=600)
reg.update(111000111, "aisstream", lat=38.90, lon=-75.10, sog=8.0)
reg.update(111000111, "aishub", name="MERGED ONE", type=70)   # static-only merge
snap = reg.snapshot()
check("3. one vessel, both feeds in its provenance",
      lambda: len(snap) == 1 and snap[0]["srcs"] == ["aishub", "aisstream"],
      lambda: json.dumps(snap[0]["srcs"]))
check("3b. the displayed position still belongs to the live feed",
      lambda: snap[0]["src"] == "aisstream" and abs(snap[0]["lat"] - 38.90) < 1e-6)
check("3c. ... and the static fields merged in",
      lambda: snap[0]["name"] == "MERGED ONE" and snap[0]["type"] == 70)

now = time.time()
reg.update(222000222, "nmea-udp-10110", lat=40.0, lon=-74.0, sog=5.0)
reg.update(222000222, "aishub", pos_time=now - 120.0, lat=40.5, lon=-74.5,
           sog=1.0, name="SLOW POLL")
v2 = [v for v in reg.snapshot() if v["mmsi"] == 222000222][0]
check("4. a minute-old polled position does not move a live track",
      lambda: abs(v2["lat"] - 40.0) < 1e-6 and abs(v2["lon"] + 74.0) < 1e-6)
check("4b. ... the fresh fix and its speed are still the displayed ones",
      lambda: v2["src"] == "nmea-udp-10110" and v2["sog"] == 5.0)
check("4c. ... but the stale report's NAME still merged (static is never stale-gated)",
      lambda: v2["name"] == "SLOW POLL")
reg.update(222000222, "aishub", pos_time=now + 5.0, lat=41.0, lon=-73.5)
v2b = [v for v in reg.snapshot() if v["mmsi"] == 222000222][0]
check("4d. a FRESHER polled position IS accepted, and provenance follows it",
      lambda: abs(v2b["lat"] - 41.0) < 1e-6 and v2b["src"] == "aishub")

# ---- 5-7. AISHub: fault-as-data + format detection, hermetic ------------------------ #
# A response is uniformly ONE format (that premise is what makes detection sound),
# so the fixtures are two separate accounts: one served human units, one served raw.
HUB_GOOD = [
    {"ERROR": False, "USERNAME": "good", "RECORDS": 1},
    [
        {"MMSI": 333000333, "TIME": "2026-08-05 12:00:00 GMT", "LATITUDE": "38.900000",
         "LONGITUDE": "-75.100000", "COG": "123.5", "SOG": "7.4", "HEADING": "120",
         "NAVSTAT": 0, "NAME": "HUMAN UNITS", "TYPE": 70},
    ],
]
HUB_RAW = [
    {"ERROR": False, "USERNAME": "raw", "RECORDS": 1},
    [
        {"MMSI": 444000444, "TIME": "2026-08-05 12:00:01 GMT", "LATITUDE": 23340000,
         "LONGITUDE": -45060000, "COG": 1235, "SOG": 74, "HEADING": 511,
         "NAVSTAT": 0, "NAME": "RAW UNITS", "TYPE": 80},
    ],
]
HUB_BAD = [{"ERROR": True, "USERNAME": "bad", "FORMAT": "HUMAN",
            "ERROR_MESSAGE": "Invalid username or password!"}]


class HubHandler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_GET(self):
        q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        user = q.get("username", [""])[0]
        body = json.dumps(HUB_GOOD if user == "good" else
                          HUB_RAW if user == "raw" else HUB_BAD)
        body = body.encode()
        self.send_response(200)                    # AISHub faults ride HTTP 200
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


hub_port = free_port()
hub_httpd = ThreadingHTTPServer(("127.0.0.1", hub_port), HubHandler)
threading.Thread(target=hub_httpd.serve_forever, daemon=True).start()
m.AishubSource.URL = "http://127.0.0.1:%d/ws.php" % hub_port

reg_bad = m.Registry(ttl=600)
src_bad = m.AishubSource(reg_bad, "bad")
src_bad.start()
check("6. a fault answered AS DATA surfaces as state error",
      lambda: wait_for(lambda: src_bad.status["state"] == "error"),
      lambda: src_bad.status["note"])
check("6b. ... wearing the upstream's own words, and nothing was ingested",
      lambda: "Invalid username" in src_bad.status["note"] and reg_bad.count() == 0)

reg_hub = m.Registry(ttl=600)
src_hub = m.AishubSource(reg_hub, "good")
src_hub.start()
src_raw = m.AishubSource(reg_hub, "raw")
src_raw.start()
check("7. a good poll ingests its vessels",
      lambda: wait_for(lambda: reg_hub.count() == 2),
      lambda: "count=%d state=%s" % (reg_hub.count(), src_hub.status["state"]))
hv = {v["mmsi"]: v for v in reg_hub.snapshot()}
check("7b. RAW-format fields all rescaled together (the per-field trap)",
      lambda: abs(hv[444000444]["lat"] - 38.90) < 1e-4
              and abs(hv[444000444]["lon"] + 75.10) < 1e-4
              and abs(hv[444000444]["sog"] - 7.4) < 1e-6
              and abs(hv[444000444]["cog"] - 123.5) < 1e-6
              and hv[444000444]["heading"] is None,
      lambda: json.dumps(hv.get(444000444)))
check("7c. ... human-format record read straight, src named aishub",
      lambda: abs(hv[333000333]["lat"] - 38.90) < 1e-6
              and hv[333000333]["sog"] == 7.4 and hv[333000333]["src"] == "aishub")

# ---- 8. build_sources: the shapes the flags produce --------------------------------- #
class Args:
    source = "nmea"
    bbox = ""
    aisstream_key = ""
    aishub_user = ""
    nmea = None
    nmea_host = "127.0.0.1"
    nmea_port = 10110
    nmea_udp = False
    opencpn_host = "127.0.0.1"
    opencpn_port = 10110


_orig_env = m._win_persisted_env
m._win_persisted_env = lambda name: None           # hermetic: no machine credentials
os.environ["AISSTREAM_KEY"] = "TESTKEY"            # deterministic auto expansion
os.environ.pop("AISHUB_USER", None)

a = Args()
a.nmea = ["udp:31234", "tcp:127.0.0.1:31235"]
srcs8 = m.build_sources(m.Registry(), a)
check("8. one source PER --nmea spec, each named for its endpoint",
      lambda: [s.name for s in srcs8] == ["nmea-udp-31234", "nmea-tcp-31235"]
              and srcs8[0].udp and not srcs8[1].udp,
      lambda: json.dumps([s.name for s in srcs8]))

a2 = Args()
a2.source = "opencpn"
a2.opencpn_port = 31236
srcs_oc = m.build_sources(m.Registry(), a2)
check("8b. opencpn is a NAMED tcp source at its endpoint",
      lambda: len(srcs_oc) == 1 and srcs_oc[0].name == "opencpn"
              and not srcs_oc[0].udp and srcs_oc[0].port == 31236)

a3 = Args()
a3.source = "aishub"
srcs_hub = m.build_sources(m.Registry(), a3)
check("8c. aishub without a member username is SKIPPED, not half-started",
      lambda: srcs_hub == [])

a4 = Args()
a4.source = "auto,opencpn"
srcs_auto = m.build_sources(m.Registry(), a4)
check("8d. auto expands IN PLACE inside a list - auto,opencpn keeps both",
      lambda: [s.name for s in srcs_auto] == ["aisstream", "opencpn"],
      lambda: json.dumps([s.name for s in srcs_auto]))
m._win_persisted_env = _orig_env

# ---- 9. the transports, end to end: TCP (OpenCPN's shape) + UDP (receiver's) -------- #
# Canonical AIVDM type-1 example (GPSd AIVDM docs): MMSI 477553000, a Seattle-area
# fix (47.58 N, -122.35 E) - verified against the decoded output, MMSI exact.
SENTENCE = b"!AIVDM,1,1,,B,177KQJ5000G?tO`K>RA1wUbN0TKH,0*5C\r\n"

tcp_port = free_port()


def tcp_server():
    srv = socket.socket()
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", tcp_port))
    srv.listen(1)
    while True:
        try:
            c, _ = srv.accept()
            for _i in range(3):
                c.sendall(SENTENCE)
                time.sleep(0.1)
            c.close()
        except OSError:
            return


threading.Thread(target=tcp_server, daemon=True).start()
reg_x = m.Registry(ttl=600)
src_oc = m.OpencpnSource(reg_x, host="127.0.0.1", port=tcp_port)
src_oc.start()
check("9. a real AIVDM sentence served over TCP lands in the registry",
      lambda: wait_for(lambda: reg_x.count() == 1),
      lambda: "count=%d" % reg_x.count())
vx = (reg_x.snapshot() or [{}])[0]
check("9b. ... decoded to the documented vessel, provenance 'opencpn'",
      lambda: vx.get("mmsi") == 477553000 and vx.get("src") == "opencpn"
              and 47.0 < vx.get("lat", 0) < 48.0 and -123.0 < vx.get("lon", 0) < -122.0,
      lambda: json.dumps(vx))

udp_port = free_port()
src_udp = m.NmeaSource(reg_x, host="127.0.0.1", port=udp_port, udp=True,
                       label="nmea-udp-%d" % udp_port)
src_udp.start()


def _udp_merged():
    # keep sending until the bound socket has taken one (bind may lag the send)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.sendto(SENTENCE, ("127.0.0.1", udp_port))
        s.close()
    except OSError:
        pass
    snap = reg_x.snapshot()
    return len(snap) == 1 and snap[0]["srcs"] == ["nmea-udp-%d" % udp_port, "opencpn"]


check("9c. the SAME vessel over UDP merges - one entry, both feeds in srcs",
      lambda: wait_for(_udp_merged),
      lambda: json.dumps((reg_x.snapshot() or [{}])[0].get("srcs")))


print()
if fails:
    print("FAILED: %d of %d checks" % (fails, ran))
    sys.exit(1)
print("all checks passed (%d)" % ran)
