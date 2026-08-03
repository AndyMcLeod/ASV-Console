"""tests/ais_range.py - the AIS display range is a FILTER, not a re-subscription.

Andy's call (2026-08-02): give the AIS traffic card a range control the operator can change
live - and do it by collecting WIDE and filtering NARROW, rather than by re-pointing the
subscription every time the number moves.

That decoupling is the whole design, and it deletes an invariant rather than working around
one. Previously a single radius drove BOTH the service subscription and the display query,
so they "had to move together" - widening only the query filtered against vessels the
service had never subscribed to, and silently showed nothing new. Collecting a wide area
once means every radius up to that is already in hand: a range change is instant, needs no
service restart, and cannot out-run the subscription. There is no longer an invariant to
break.

    python tests/ais_range.py      # exit 0 = pass, 1 = fail   (stdlib only)

It stands up a STUB AIS provider at known ranges and points a real console at it, because
the thing under test is what the console does with a provider's answer - not whether any
real feed happens to have traffic near the test machine today.

TWO RULES THAT ARE NOT SYMMETRIC, and both are asserted:

    AT SEA        the operator's radius filters, as a true great-circle circle from the
                  boat - not the collect BOX, whose corners are ~1.4x further out.
    ON A LAKE     NO FILTER AT ALL. The area is the whole lake and every contact stands,
                  because "50 km of Lake Erie" is not a useful thing to ask for.

TEETH (verified by mutation, not assumed): drop the sea-mode filter and 3 and 4 fail. Apply
the filter on a lake too and 6 fails. Filter by the bounding BOX instead of true range and 5
fails - a vessel in the box corner is inside 1.4x the radius but outside the circle. Let the
requested radius exceed what was collected and 7 fails, which would show nothing extra while
implying the sea beyond is empty.
"""

import json
import math
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)

fails = 0
ran = 0


def check(name, cond, detail=""):
    global fails, ran
    ran += 1
    print(("  ok   " if cond else "  FAIL ") + name + ("   [" + detail + "]" if detail else ""))
    if not cond:
        fails += 1


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def api(port, path, body=None, timeout=8):
    url = "http://127.0.0.1:%d%s" % (port, path)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode())


# --- the stub provider -------------------------------------------------------
# Vessels placed at exact ranges due EAST of a reference point, so the expected answer for
# any radius is arithmetic rather than a guess.
LEWES = (38.78965, -75.16094)          # the default profile's operating area (open sea)
ERIE = (42.14, -80.08)                 # inside a Great Lake box

def at_km(lat, lon, east_km, north_km=0.0):
    dlat = north_km / 111.320
    dlon = east_km / (111.320 * math.cos(math.radians(lat)))
    return {"lat": lat + dlat, "lon": lon + dlon}

# ranges chosen to straddle the 50 km default and the 150 km collect width
SEA_RANGES = [5, 20, 49, 51, 90, 140]
SEA_VESSELS = [dict(at_km(*LEWES, east_km=r), mmsi=100 + i, name="SEA%d" % r, cog=90, sog=8)
               for i, r in enumerate(SEA_RANGES)]
# a vessel in the CORNER of the collect box: inside the box, well outside the circle
CORNER = dict(at_km(*LEWES, east_km=120, north_km=120), mmsi=999, name="CORNER", cog=0, sog=5)
LAKE_VESSELS = [dict(at_km(*ERIE, east_km=r), mmsi=200 + i, name="LAKE%d" % r, cog=270, sog=6)
                for i, r in enumerate([10, 60, 120])]


class Stub(BaseHTTPRequestHandler):
    def do_GET(self):
        # Filter by BBOX, exactly as a real provider does. That is a different filter from
        # the console's, which is a RANGE CIRCLE - so this cannot mask the behaviour under
        # test. (An earlier version routed on substrings in the path and mis-served the lake
        # query, which failed check 6 for a reason that had nothing to do with the console.)
        import urllib.parse as _up
        q = _up.parse_qs(self.path.split("?", 1)[1] if "?" in self.path else "")
        try:
            w, s_, e, n = (float(x) for x in q["bbox"][0].split(","))
        except Exception:
            w, s_, e, n = -180.0, -90.0, 180.0, 90.0
        vs = [v for v in (SEA_VESSELS + [CORNER] + LAKE_VESSELS)
              if w <= v["lon"] <= e and s_ <= v["lat"] <= n]
        body = json.dumps({"ok": True, "vessels": vs, "count": len(vs),
                           "sources": {"aisstream": {"state": "ok", "note": ""}}}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *a):
        pass


print("AIS range — collect wide, filter narrow, and never filter a lake:")

stub_port = free_port()
stub = HTTPServer(("127.0.0.1", stub_port), Stub)
threading.Thread(target=stub.serve_forever, daemon=True).start()

port = free_port()
# CAPTURE THE SERVER'S OUTPUT, do not discard it. This harness sent stdout and stderr to
# DEVNULL, and that is exactly how /api/ais/radius shipped broken while these checks stayed
# green: the handler returned self._send(...) instead of the (code, obj) tuple its caller
# unpacks, so every call raised - but only AFTER _send had already written a correct 200 to
# the socket. The client saw a healthy response, the traceback went to a discarded stderr,
# and nothing here could tell the difference. A server that answers correctly and THEN dies
# is not a passing test. Check 9 reads this file.
#
# A file rather than a PIPE on purpose: nothing drains a pipe while the console runs, so a
# chatty server would block on a full buffer and hang the test.
srvlog = tempfile.TemporaryFile(mode="w+")
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none",
                         "--port", str(port), "--no-log", "--no-ais-service",
                         "--ais", "http://127.0.0.1:%d" % stub_port,
                         "--ais-radius-km", "50", "--ais-collect-km", "150"],
                        cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
try:
    up = False
    for _ in range(80):
        try:
            if (api(port, "/api/state", timeout=2).get("status") or {}).get("lat_deg") is not None:
                up = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    check("1. a console comes up, pointed at the stub provider", up)
    if not up:
        raise SystemExit(1)

    sea = "/api/ais?center=%.5f,%.5f" % LEWES
    d = api(port, sea)
    check("2. at sea the area reports BOTH radii, so the card can explain itself",
          d["area"]["mode"] == "sea" and d["area"]["show_km"] == 50
          and d["area"]["collect_km"] == 150,
          json.dumps(d["area"]))

    # 3-4. THE FILTER. At the 50 km default only the three inside it survive; widening to
    # 150 picks up the rest WITHOUT the service being touched.
    names = sorted(v["name"] for v in d["vessels"])
    check("3. the default 50 km shows only what is inside 50 km",
          names == ["SEA20", "SEA49", "SEA5"], ",".join(names))
    api(port, "/api/ais/radius", {"km": 150})
    d2 = api(port, sea)
    n2 = sorted(v["name"] for v in d2["vessels"])
    check("4. widening to 150 km shows the further contacts, with no re-subscription",
          len(n2) == len(SEA_RANGES) and "SEA140" in n2, ",".join(n2))

    # 5. A CIRCLE, NOT THE BOX. The corner vessel is inside the collect box and 170 km from
    # the boat - filtering by the box would let it through at any radius.
    check("5. the filter is a true range circle, not the collect box",
          "CORNER" not in n2, "corner contact is ~170 km out, inside the 150 km BOX")

    # 6. LAKES ARE NOT FILTERED. Same narrow radius, a lake centre: everything stands.
    api(port, "/api/ais/radius", {"km": 5})
    dl = api(port, "/api/ais?center=%.5f,%.5f" % ERIE)
    # The invariant, not a hardcoded count: on a lake NOTHING is filtered out, so whatever
    # the provider returned for the lake box is exactly what is shown - at a 5 km setting
    # that would otherwise have left one contact.
    check("6. on a lake NO radius filter applies — shown == collected",
          dl["area"]["mode"] == "lake"
          and dl["area"]["shown"] == dl["area"]["collected"] > 1,
          "shown=%s collected=%s at a 5 km setting"
          % (dl["area"].get("shown"), dl["area"].get("collected")))

    # 7. Clamped to what was actually collected. Asking to see 900 km would show nothing
    # beyond 150 and imply the sea past it is empty.
    r = api(port, "/api/ais/radius", {"km": 900})
    check("7. the radius is clamped to the collected area",
          r["show_km"] == 150 and r["collect_km"] == 150, json.dumps(r))

    # 8. The card needs both counts to say "n of m", so an operator can tell "nothing out
    # there" from "narrowed it down myself".
    api(port, "/api/ais/radius", {"km": 50})
    d3 = api(port, sea)
    check("8. the response reports collected and shown, so the card can say which",
          d3["area"]["collected"] == len(SEA_VESSELS) + 1 and d3["area"]["shown"] == 3,
          "shown=%s collected=%s" % (d3["area"]["shown"], d3["area"]["collected"]))

finally:
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()
    stub.shutdown()

# 9. THE SERVER SURVIVED EVERY REQUEST ABOVE. Runs after the console is stopped, so its
# output is complete. This is the check that would have caught /api/ais/radius returning
# self._send(...) instead of its (code, obj) tuple: the response was already correct and on
# the wire, so 1-8 could not see it - only the traceback afterwards gave it away, and that
# was going to DEVNULL. Any endpoint that answers and then takes down its handler thread
# fails here.
srvlog.seek(0)
server_out = srvlog.read()
srvlog.close()
tb = [ln.strip() for ln in server_out.splitlines()
      if "Traceback" in ln or "Error" in ln or "Exception occurred" in ln]
check("9. the console logged NO exception while serving those requests",
      not tb,
      ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb
      else "a request that is answered correctly can still kill its handler")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
