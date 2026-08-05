"""tests/ais_error_frames.py - an upstream error frame is SURFACED, never swallowed.

THE DEFECT (found reading the loop during the 2026-08-05 empty-feed investigation, then
confirmed against the live silence): aisstream reports its faults - "Api Key Is Not
Valid", connection limits - as a TEXT frame {"error": "..."} on the SAME channel as
vessel data. The read loop stamped state "ok"/"connected" on ANY frame and passed it to
_ingest, whose no-MMSI discard dropped it silently. So the one message that named the
problem produced: "connected", zero reports, forever. And the quiet-box timeout path
re-stamps its note every 30 s, so even a surfaced error would have been OVERWRITTEN by
"connected; no vessels reporting in this area yet" moments later - a dead key reading
as a quiet sea.

THE FIX, three parts, each with its own check and mutation:
  * `_frame_error(raw)` classifies a frame: an {"error": ...} dict with NO MetaData is
    the upstream speaking; anything carrying MetaData is vessel data whatever other
    keys it has; non-JSON is not an error REPORT.
  * the loop surfaces it (state "error", note "aisstream: <message>") instead of
    feeding it to _ingest - and remembers it in `frame_err`.
  * the timeout path HOLDS a remembered error instead of overwriting it with the
    quiet-box note; real data flowing again clears it.

    python tests/ais_error_frames.py    # exit 0 = pass, 1 = fail  (stdlib, no network,
                                        # no console - the real run() loop is driven
                                        # through a scripted fake WSClient)

TEETH - mutations RUN, results recorded here (house rules; NOTE ais_service.py is CRLF,
anchors must match its line endings via the runner's newline='' discipline):
  * THE SWALLOW RESTORED (error branch dropped)      -> caught by 3 and 4
  * the timeout path stops holding the error         -> caught by 4
  * the classifier loses its MetaData guard          -> caught by 2c (vessel data that
    happens to carry an "error"-named field must remain DATA)
  * data stops clearing frame_err                    -> caught by 6
"""

import json
import os
import queue
import socket
import sys
import threading
import time

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)

import importlib.util

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


print("AIS error frames — the upstream naming its fault must reach the card:")

# ---- 1-2. THE CLASSIFIER, pure ----------------------------------------------------- #
fe = m._frame_error
check("1. an {\"error\": ...} frame IS the upstream speaking",
      lambda: fe(json.dumps({"error": "Api Key Is Not Valid"})) == "Api Key Is Not Valid")
check("1b. ... capitalised spelling too",
      lambda: fe(json.dumps({"Error": "connection limit"})) == "connection limit")
check("2. a position report is DATA, not an error",
      lambda: fe(json.dumps({"MessageType": "PositionReport",
                             "MetaData": {"MMSI": 1, "latitude": 1, "longitude": 1}})) is None)
check("2b. non-JSON is not an error REPORT (ingest ignores it, as before)",
      lambda: fe("!!not json!!") is None)
check("2c. a frame carrying MetaData is vessel data WHATEVER other keys it has",
      lambda: fe(json.dumps({"error": "field named error",
                             "MetaData": {"MMSI": 2, "latitude": 0, "longitude": 0}})) is None)
check("2d. the message is truncated, never a novel in the note",
      lambda: len(fe(json.dumps({"error": "x" * 500})) or "") == 160)

# ---- 3-6. THE LOOP, driven through a scripted fake websocket ----------------------- #
script = queue.Queue()


class FakeWS:
    def __init__(self, *a, **k):
        pass

    def connect(self):
        pass

    def send_text(self, t):
        pass

    def recv_text(self):
        step = script.get()                          # the test hand-feeds each step
        if step[0] == "timeout":
            raise socket.timeout()
        return step[1]


m.WSClient = FakeWS
reg = m.Registry()
src = m.AisstreamSource(reg, key="test-key", bbox=(-77.2, 37.2, -73.1, 40.4))
threading.Thread(target=src.run, daemon=True).start()


def wait_status(pred, limit=5.0):
    t0 = time.time()
    while time.time() - t0 < limit:
        if pred(dict(src.status)):
            return dict(src.status)
        time.sleep(0.05)
    return dict(src.status)


script.put(("frame", json.dumps({"error": "Api Key Is Not Valid"})))
st = wait_status(lambda s: s.get("state") == "error")
check("3. THE SWALLOW, FIXED: the error frame surfaces - state error, the note NAMES it, "
      "and it was never counted as a report",
      lambda: st.get("state") == "error" and "Api Key Is Not Valid" in (st.get("note") or "")
      and st.get("reports") == 0,
      lambda: "state=%s note=%s" % (st.get("state"), (st.get("note") or "")[:44]))

script.put(("timeout",))
time.sleep(0.3)
st = wait_status(lambda s: True, limit=0.1)
check("4. a read timeout HOLDS the error - the quiet-box note must not overwrite what "
      "the upstream said (a dead key is not a quiet sea)",
      lambda: st.get("state") == "error" and "Api Key Is Not Valid" in (st.get("note") or ""),
      lambda: "note=%s" % (st.get("note") or "")[:44])

script.put(("frame", json.dumps({"MessageType": "PositionReport",
                                 "MetaData": {"MMSI": 366999001, "ShipName": "TEST VESSEL",
                                              "latitude": 38.9, "longitude": -75.1}})))
st = wait_status(lambda s: s.get("state") == "ok" and s.get("reports", 0) >= 1)
check("5. real data flowing again reads connected, and the vessel is INGESTED",
      lambda: st.get("state") == "ok" and st.get("reports") == 1
      and len(reg.snapshot()) == 1,
      lambda: "state=%s reports=%s registry=%d" % (st.get("state"), st.get("reports"),
                                                   len(reg.snapshot())))

script.put(("timeout",))
st = wait_status(lambda s: "no vessels reporting" in (s.get("note") or ""))
check("6. ... and the NEXT quiet spell is a quiet box again - the fault has passed, so "
      "the held error is cleared",
      lambda: st.get("state") == "ok" and "no vessels reporting" in (st.get("note") or ""),
      lambda: "note=%s" % (st.get("note") or "")[:50])

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
