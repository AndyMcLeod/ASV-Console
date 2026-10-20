"""tests/ais_stall.py - A FEED CONNECTED BUT NOT POPULATING IS SAID, AND RETRIED EVERY MINUTE (Andy, 2026-10-20: "generate an
alert when the AIS card is not populating even though its connected to the given service. Force retry connection every
minute if this condition persists." The page half - the card's state and the alert - is tests/ais_stall.js.)

A push feed can hold its connection open and deliver nothing. ais_service.py measures it on the DATA clock: connected, and
no vessel report for STALL_S (60 s - measured, a healthy feed in the console's subscription box is never that quiet: New
Castle and Lewes about a report a second, Cape Canaveral, the sparsest, silences up to 30 s). Then the source is
`stalled`, says so, and drops and remakes its connection once each connection has had STALL_RETRY_S, until a vessel
arrives. The checks, in process (stdlib, no network):

  1. stall_check, pure, on an injected clock: nothing before a connection; populating is not stalled; 59 s quiet is not;
     60 s is "stalled" - flagged, timed, the note saying it - but a connection younger than its minute is not dropped;
     one that has had its minute is ("reconnect", the try counted), and the next is given its own minute;
  2. the DATA clock across reconnects: a far end that accepts and hangs up every 2 s still reads stalled at 60 s;
  3. a vessel report clears the stall and its count; an error is its own state - never "stalled";
  4. health() serves `quiet_s` read now, with `stalled` and `stall_retries`; a poll source (never connected) has none;
  5. the REAL aisstream loop, through a scripted fake socket, on shrunk constants: a silent subscription is dropped and
     remade again and again, each old socket CLOSED before the next connects (never two open at once), the status stalled
     with the tries counted; then one vessel frame - ingested, the stall cleared;
  6. the service's own /health and /vessels serve it (make_handler on a free port).

    python tests/ais_stall.py      # exit 0 = pass, 1 = fail   (stdlib only)
"""
import importlib.util
import json
import os
import queue
import socket
import sys
import threading
import time
import urllib.request


# A throw outside a check would end the process with no FAIL line, which a mutation run reads as SURVIVED. Report it
# instead, in this suite's own format (tests/turn_geometry.js 30 holds every suite to this).
def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
spec = importlib.util.spec_from_file_location("aissvc_stall", os.path.join(APP, "ais_service.py"))
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
        detail = "THREW %s: %s" % (type(e).__name__, e)
    print(("  ok   " if ok else "  FAIL ") + name + ("   [%s]" % detail if detail else ""))
    if not ok:
        fails += 1


print("A feed connected but not populating:")
S, R = m.STALL_S, m.STALL_RETRY_S


def fresh():
    s = m.AisstreamSource(m.Registry(), key="k", bbox=(-71, 42, -70, 43))
    s._ok("connected")
    return s


# ---- 1. stall_check, pure --------------------------------------------------------------------------------------- #
T = 1_000_000.0
a = m.AisstreamSource(m.Registry(), key="k")
never = a.stall_check(T + 500)                                       # never connected: nothing to be dry on
a._ok("connected"); a._connected(T)
at59 = a.stall_check(T + S - 1)
at60 = a.stall_check(T + S)                                          # dry a minute; the connection is a minute old too
st60 = dict(a.status)
b = fresh(); b._connected(T); b._connected(T + S - 5)                # reconnected 5 s before the minute was up
young = b.stall_check(T + S)                                         # stalled - but this connection has not had its minute
old = b.stall_check(T + S - 5 + R)                                   # ... now it has
r_old = b.status["stall_retries"]
b._connected(T + S - 5 + R + 1)                                      # the forced reconnect made
nxt = [b.stall_check(T + S - 5 + R + 1 + k) for k in (10, R - 1, R)]
check("1. stall_check: nothing before a connection; 59 s dry is not stalled; 60 s is - flagged, timed, the note saying "
      "so with the tries - and the connection dropped only once IT has had its minute; the next one gets its own minute",
      lambda: never is None and at59 is None and at60 == "reconnect" and st60["stalled"] is True
              and st60["stall_since"] == T + S and st60["stall_retries"] == 1
              and "no vessel report for 60 s - reconnecting every 60 s (0 so far)" in st60["note"]
              and young == "stalled" and old == "reconnect" and r_old == 1
              and nxt == ["stalled", "stalled", "reconnect"] and b.status["stall_retries"] == 2,
      lambda: json.dumps({"never": never, "at59": at59, "at60": at60, "st60": st60, "young": young, "old": old,
                          "next": nxt, "r_old": r_old, "retries": b.status["stall_retries"]}))

# ---- 2. the DATA clock across reconnects ------------------------------------------------------------------------- #
h = fresh()
seen = []
for k in range(0, 64, 2):                                            # accepts, hangs up, reconnects - every 2 s
    h._connected(T + k)
    seen.append(h.stall_check(T + k + 1))
check("2. A FAR END THAT ACCEPTS AND HANGS UP EVERY 2 s STILL READS STALLED at a minute: the quiet is timed from the "
      "last vessel (or the first connection), not from the last reconnect - which never lets a connection reach its "
      "minute, so it is flagged but not dropped (it is already being remade)",
      lambda: all(x is None for x in seen[:29]) and seen[-1] == "stalled" and h.status["stalled"] is True
              and h.quiet_s(T + 63) == 63,
      lambda: json.dumps({"seen": seen, "quiet": h.quiet_s(T + 63)}))

# ---- 3. a vessel clears it; an error is its own state ---------------------------------------------------------- #
c = fresh(); c._connected(time.time() - 200)
c.stall_check(); c.stall_check()                                     # stalled, and (an old connection) retried
before = dict(c.status)
c._report(366999999, lat=43.0, lon=-70.7)
after = dict(c.status)
quiet_after = c.health()["quiet_s"]
e = fresh(); e._connected(T)
e.stall_check(T + S)
e._err("aisstream: Api Key Is Not Valid")
err_st = dict(e.status)
err_look = e.stall_check(T + 10 * S)
check("3. A VESSEL CLEARS IT - stalled false, its time and its tries back to 0, the data clock at 0 s; AN ERROR IS ITS "
      "OWN STATE: the error clears the stalled flag and the next look stays out of it (the card says 'feed error')",
      lambda: before["stalled"] and before["stall_retries"] >= 1
              and after["stalled"] is False and after["stall_since"] == 0 and after["stall_retries"] == 0
              and quiet_after == 0 and err_st["state"] == "error" and err_st["stalled"] is False and err_look is None,
      lambda: json.dumps({"before": before, "after": after, "quiet_after": quiet_after, "error": err_st, "look": err_look}))

# ---- 4. the served status ----------------------------------------------------------------------------------------- #
g = fresh(); g._connected(time.time() - 75); g.stall_check()
srv = g.health()
poll = m.DigitrafficSource(m.Registry()).health()
check("4. health() SERVES the data clock read now - quiet_s (75 s here) - with stalled and stall_retries, so the page needs "
      "no clock of its own; a poll source, never connected, has quiet_s null and is never stalled",
      lambda: srv["quiet_s"] in (75, 76) and srv["stalled"] is True and srv["stall_retries"] == 1
              and poll["quiet_s"] is None and poll["stalled"] is False,
      lambda: json.dumps({"served": srv, "poll": poll}))

# ---- 5. the real loop, through a scripted fake socket ------------------------------------------------------------ #
m.STALL_S, m.STALL_RETRY_S, m.STALL_PAUSE_S = 0.4, 0.4, 0.05        # shrunk: the loop's logic, not its minute
script = queue.Queue()
LOG = {"open": 0, "max_open": 0, "connects": 0, "closed": 0, "subs": 0}


class FakeWS:
    def __init__(self, url, timeout=30):
        self.timeout, self.open = timeout, False

    def connect(self):
        LOG["connects"] += 1
        LOG["open"] += 1
        LOG["max_open"] = max(LOG["max_open"], LOG["open"])
        self.open = True

    def send_text(self, t):
        if json.loads(t).get("APIKey"):
            LOG["subs"] += 1

    def recv_text(self):
        try:
            step = script.get(timeout=0.05)                          # silence unless the test feeds a frame
        except queue.Empty:
            raise socket.timeout()
        return step

    def close(self):
        if self.open:
            self.open = False
            LOG["open"] -= 1
            LOG["closed"] += 1


m.WSClient = FakeWS
m.AisstreamSource.READ_S = 0.05
reg = m.Registry()
src = m.AisstreamSource(reg, key="test-key", bbox=(-71, 42, -70, 43))
threading.Thread(target=src.run, daemon=True).start()
t0 = time.time()
while time.time() - t0 < 2.5 and LOG["connects"] < 4:
    time.sleep(0.02)
dry = dict(src.status, quiet=src.quiet_s())
frame = {"MessageType": "PositionReport", "MetaData": {"MMSI": 366999001, "latitude": 42.5, "longitude": -70.5,
                                                       "ShipName": "TEST"},
         "Message": {"PositionReport": {"Sog": 3.0, "Cog": 90.0, "TrueHeading": 90, "NavigationalStatus": 0}}}
script.put(json.dumps(frame))
t1 = time.time()
while time.time() - t1 < 2.0 and src.status.get("stalled"):
    time.sleep(0.02)
wet = dict(src.status)
got = reg.snapshot()
check("5. THE REAL LOOP: a silent subscription is dropped and remade again and again (4 connections, each subscribed), "
      "every old socket CLOSED before the next connects - never two open at once - the status stalled with the tries "
      "counted; then one vessel frame: ingested, and the stall and its count cleared",
      lambda: LOG["connects"] >= 4 and LOG["subs"] == LOG["connects"] and LOG["max_open"] == 1
              and LOG["closed"] >= LOG["connects"] - 1 and dry["stalled"] is True and dry["stall_retries"] >= 3
              and "reconnecting every" in dry["note"] and dry["state"] == "ok"
              and wet["stalled"] is False and wet["stall_retries"] == 0 and wet["note"].startswith("connected")
              and "reconnecting" not in wet["note"]
              and [v["mmsi"] for v in got] == [366999001],
      lambda: json.dumps({"log": LOG, "dry": dry, "wet": wet, "vessels": [v["mmsi"] for v in got]}))

# ---- 6. the service's own HTTP serves it -------------------------------------------------------------------------- #
from http.server import ThreadingHTTPServer                           # noqa: E402
held = fresh(); held._connected(time.time() - 90); held.stall_check()
srvr = ThreadingHTTPServer(("127.0.0.1", 0), m.make_handler(m.Registry(), [held]))
threading.Thread(target=srvr.serve_forever, daemon=True).start()
port = srvr.server_address[1]
hh = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/health" % port, timeout=5).read().decode("utf-8"))
vv = json.loads(urllib.request.urlopen("http://127.0.0.1:%d/vessels" % port, timeout=5).read().decode("utf-8"))
srvr.shutdown()
check("6. THE SERVICE SERVES IT: /health and /vessels carry the source's stalled, stall_retries and quiet_s (read when "
      "asked), which the console's /api/ais passes to the page whole",
      lambda: all(x["sources"]["aisstream"]["stalled"] is True and x["sources"]["aisstream"]["quiet_s"] >= 90
                  and x["sources"]["aisstream"]["stall_retries"] >= 0 for x in (hh, vv)),
      lambda: json.dumps({"health": hh["sources"], "vessels": vv["sources"]}))

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
