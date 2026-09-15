"""tests/energy_chartinfo.py - /api/cmd/energy and /api/chartinfo, the next two routes.

WHY THESE TWO TOGETHER. Andy's next picks from the coverage list. Both are small
surfaces, but each hides a shape worth pinning before it drifts:

ENERGY is TWO LAYERS, and they answer different failures. The SIM link stops the
burn and snaps the tank full (`SimVcu.set_unlimited_energy` + the tick's
`_unlimited_energy` branch); the ENGINE separately FORCES the published gauge full at
state() time - and that second layer is the only mechanism when there is no link at all,
which is why check 10 toggles the override on a DISCONNECTED console and still expects a
full gauge. A suite that only watched the sim would call the engine layer dead; the
estop lesson applies (two layers, each earned separately).
THE DISTINGUISHING TRICK for the sim layer: while the override is ON, the engine force
masks whatever the sim tank does - the published fuel reads full either way. So check 8
holds the override ON for ~45 s of hard running and reads the tank ON THE FRAME AFTER
turning it OFF: if the sim really snapped AND really stopped burning, the tank is still
exactly full; if either half silently died, ~0.1 L is missing and the 1-decimal gauge
shows it. Asserting DURING the ON window cannot see this - only the reading after the
mask is lifted can.

CHARTINFO is a GET (the SRC card's data source) with an EXACT-KEY disk cache
(`chartinfo_v1_W_S_E_N.json` under charts/enc, %.4f each). That makes the route testable
HERMETICALLY: seed a sentinel cache file for a mid-ocean bbox nobody real uses, query
it - in both spellings, plain commas and %2C, because a query parser that forgets to
percent-decode was a real ais_service bug - and the endpoint must serve the seeded
content byte-for-byte without touching any network. The real Lewes cache (gitignored,
present on the dev machine and wherever the boat has sailed) is checked OPPORTUNISTICALLY
when found: the response for a cached bbox must carry that file's own cells. A malformed
bbox is a 400 with the usage string - never a 500, never a hang.

    python tests/energy_chartinfo.py    # exit 0 = pass, 1 = fail   (stdlib only)

TEETH - seven mutations RUN plus one pair, recorded results (runner rules as ever:
missing anchor = SKIP, crash scored separately, source restored byte-for-byte):
  * sim tick burns straight through the override          -> caught by 8 (the ~0.13 L
    burned during the masked window appears the moment the override lifts)
  * enable-time snap dropped (tick hold still present)    -> SURVIVES, correctly - the
    tick's hold RE-FILLS the tank every frame, so on a running sim the enable-time snap
    is a redundant second layer. My prediction here was wrong (I expected 8 to catch it);
    the run knew better. Remove BOTH sim layers together and 8 fails - the pair is
    load-bearing, the lone survival is earned, not a hole.
  * the engine's state() force-fill dropped               -> caught by 10 ALONE - on the
    sim the tick hold covers it, exactly the layered-defence shape; the disconnected
    console is the only place this layer is load-bearing, and the only check that sees it
  * the handler stops reading the body (override stuck)   -> caught by 7, 8, 10
  * chartinfo's cache key format broken                   -> caught by 3 (cache miss)
  * chartinfo's bbox arity check dropped                  -> caught by 2b (the 400
    becomes a 502 out of the %-format TypeError downstream)
ANCHOR LESSON from this pass: the first runner SKIPPED both chartinfo mutations - anchor
matched TWICE, because /api/enc carries a byte-identical parse-and-key twin of the
chartinfo path. The SKIP rule surfaced it instead of mutating the wrong function; the
re-run anchored on chartinfo-specific context. The twin itself (/api/enc) is still on
the OPEN/NEXT coverage list, and its duplication is worth knowing when someone gets there.
"""

import glob as globmod
import json
import math
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request

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


APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)

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


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def api(port, path, body=None, timeout=8):
    """body=None -> GET; commands go through cmd() so they can never degrade to a GET."""
    url = "http://127.0.0.1:%d%s" % (port, path)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"} if data else {})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.getcode(), json.loads(r.read().decode())


def api_ok(port, path, body=None):
    try:
        return api(port, path, body)[1]
    except urllib.error.HTTPError as e:
        return json.loads(e.read().decode())


def get_raw(port, path, timeout=8):
    """GET returning (code, obj) with 4xx/5xx bodies decoded, for the chartinfo checks."""
    try:
        return api(port, path)
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def cmd(port, path, body=None):
    return api_ok(port, path, body if body is not None else {})


def state(port):
    return api_ok(port, "/api/state")


def wait_for(port, pred, limit=90.0, every=0.5):
    t0 = time.time()
    st = state(port)
    while time.time() - t0 < limit:
        st = state(port)
        try:
            if pred(st):
                return st
        except Exception:
            pass
        time.sleep(every)
    return st


print("Energy override + chart info — two layers of full, and a card served from cache:")

port = free_port()
# ITS OWN STATE FOLDER (review #16): this console never reads or writes the operator's plan, settings
# or logs - no snapshot of mission.json, and no write-back of one when the suite ends.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from console_state import ConsoleState  # noqa: E402
STATE = ConsoleState()

# The hermetic chartinfo fixture: a sentinel cache entry at a mid-ocean bbox. The key
# format is the server's own ("%.4f" each) - if that format drifts, check 3 fails as a
# cache miss, which is the point.
ENC_DIR = os.path.join(APP, "charts", "enc")
SEED_BBOX = (10.0, 10.0, 10.1, 10.1)
SEED_KEY = "%.4f_%.4f_%.4f_%.4f" % SEED_BBOX
SEED_FILE = os.path.join(ENC_DIR, "chartinfo_v1_%s.json" % SEED_KEY)
SEED = {"band": "enc_test", "cells": [{"props": {"DSNM": "SENTINEL.000"}}],
        "quality": [], "note": "seeded by tests/energy_chartinfo.py"}

srvlog = tempfile.TemporaryFile(mode="w+")
os.makedirs(ENC_DIR, exist_ok=True)
with open(SEED_FILE, "w", encoding="utf-8") as f:
    json.dump(SEED, f)
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none",
                         "--port", str(port), "--no-ais-service", "--no-log", *STATE.args()],
                        cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
try:
    up = False
    for _ in range(80):
        try:
            st0 = api_ok(port, "/api/state").get("status") or {}
            if st0.get("speed_key") and st0.get("lat_deg") is not None:
                up = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    check("1. a console comes up, with the link reporting", up)
    if not up:
        raise SystemExit(1)

    # ---- CHARTINFO ----------------------------------------------------------------- #
    c, o = get_raw(port, "/api/chartinfo?bbox=nonsense")
    check("2a. a malformed bbox is a 400 that TEACHES the caller the shape",
          lambda: c == 400 and "usage" in str(o.get("error", "")),
          "%s %s" % (c, str(o.get("error"))[:44]))
    c2, o2 = get_raw(port, "/api/chartinfo?bbox=1,2,3")
    check("2b. ... and so is a bbox with the wrong arity - never a 500 from downstream, "
          "and it is THIS endpoint's usage line, not a neighbour's",
          lambda: c2 == 400 and "usage: /api/chartinfo?" in str(o2.get("error", "")),
          "%s %s" % (c2, str(o2.get("error"))[:44]))

    plain = get_raw(port, "/api/chartinfo?bbox=10.0,10.0,10.1,10.1")
    encd = get_raw(port, "/api/chartinfo?bbox=10.0%2C10.0%2C10.1%2C10.1")
    check("3. a cached bbox is served from disk, in BOTH spellings - plain and %2C commas",
          lambda: plain[0] == 200 and encd[0] == 200
          and plain[1].get("cells") == SEED["cells"] == encd[1].get("cells")
          and plain[1].get("band") == "enc_test",
          lambda: "plain=%s enc=%s band=%s"
                  % (plain[0], encd[0], plain[1].get("band")))

    real = sorted(globmod.glob(os.path.join(ENC_DIR, "chartinfo_v1_*.json")))
    real = [p for p in real if p != SEED_FILE]
    if real:
        with open(real[0], "r", encoding="utf-8") as f:
            want = json.load(f)
        key = os.path.basename(real[0])[len("chartinfo_v1_"):-len(".json")]
        bbox_q = ",".join(key.split("_"))
        cr, orr = get_raw(port, "/api/chartinfo?bbox=" + bbox_q)
        want_cells = sorted(cc["props"].get("DSNM", "") for cc in want.get("cells", []))
        got_cells = sorted(cc["props"].get("DSNM", "") for cc in (orr.get("cells") or []))
        check("4. the REAL cached chart answers with its own cells (opportunistic - cache found)",
              lambda: cr == 200 and want_cells and got_cells == want_cells,
              lambda: "%d cell(s): %s" % (len(got_cells), ", ".join(got_cells)[:60]))
    else:
        check("4. no real chartinfo cache on this machine - the hermetic checks above still "
              "cover the route", True, "charts/enc is gitignored; sail somewhere to fill it")

    # ---- ENERGY -------------------------------------------------------------------- #
    vessel = api_ok(port, "/api/vessel")["vessel"]
    check("5. (arrange) the default vessel is fuel-powered and the tank starts full",
          lambda: vessel["power"]["type"] == "fuel"
          and (st0.get("fuel_l") or 0) >= float(vessel["power"]["fuel"]["capacity_l"]) - 0.05,
          lambda: "type=%s fuel=%s" % (vessel["power"]["type"], st0.get("fuel_l")))
    cap = float(vessel["power"]["fuel"]["capacity_l"])

    cmd(port, "/api/cmd/arm", {"on": True})
    cmd(port, "/api/cmd/speed", {"speed": "high"})
    cmd(port, "/api/cmd/goto", {"lat": st0["lat_deg"] + 0.08, "lon": st0["lon_deg"] + 0.05})
    st = wait_for(port, lambda s: (s["status"].get("fuel_l") or cap) <= cap - 0.1, limit=120)
    check("6. the burn is REAL: hard running visibly draws the tank down",
          lambda: (st["status"].get("fuel_l") or cap) <= cap - 0.1,
          lambda: "%.1f L of %.0f" % (st["status"].get("fuel_l") or -1, cap))

    cmd(port, "/api/cmd/energy", {"unlimited": True})
    st = wait_for(port, lambda s: s["status"].get("unlimited_energy") is True
                  and (s["status"].get("fuel_l") or 0) >= cap - 0.05, limit=15)
    check("7. override ON mid-run: the gauge SNAPS to full and says why",
          lambda: st["status"].get("unlimited_energy") is True
          and (st["status"].get("fuel_l") or 0) >= cap - 0.05
          and (st["status"].get("sog_kn") or 0) > 1.0,
          lambda: "fuel=%.1f sog=%.1f" % (st["status"].get("fuel_l") or -1,
                                          st["status"].get("sog_kn") or -1))

    # The masked window: ~45 s of hard running under the override. The published gauge
    # is FORCED full throughout, so nothing asserted here can see the sim tank - the
    # reading that matters is the frame after the override lifts.
    time.sleep(45)
    cmd(port, "/api/cmd/energy", {"unlimited": False})
    st = wait_for(port, lambda s: s["status"].get("unlimited_energy") is False, limit=15)
    check("8. the tank behind the mask really was HELD FULL: the frame after OFF still reads "
          "capacity - the snap happened AND the burn stopped",
          lambda: st["status"].get("unlimited_energy") is False
          and (st["status"].get("fuel_l") or 0) >= cap - 0.05,
          lambda: "fuel=%.1f after 45 s of masked hard running" % (st["status"].get("fuel_l") or -1))

    st = wait_for(port, lambda s: (s["status"].get("fuel_l") or cap) <= cap - 0.1, limit=120)
    check("9. ... and OFF means OFF: the burn resumes from full",
          lambda: (st["status"].get("fuel_l") or cap) <= cap - 0.1,
          lambda: "%.1f L" % (st["status"].get("fuel_l") or -1))

    # 10. THE ENGINE LAYER, on its own. With NO link there is no sim to snap - the
    # engine's state()-time force-fill is the only mechanism left, and the override is
    # documented as not gated on connection. Before asserting, the stale status of the
    # disconnected boat still carries the burned reading, which is exactly why this
    # distinguishes the layer.
    cmd(port, "/api/disconnect")
    cmd(port, "/api/cmd/energy", {"unlimited": True})
    st = state(port)
    check("10. override ON while DISCONNECTED still forces a full gauge - the engine layer "
          "is load-bearing exactly when there is no boat to ask",
          lambda: st["status"].get("unlimited_energy") is True
          and (st["status"].get("fuel_l") or 0) >= cap - 0.05
          and "override ON" in (st.get("note") or ""),
          lambda: "fuel=%.1f note=%s" % (st["status"].get("fuel_l") or -1,
                                         (st.get("note") or "")[:32]))
    cmd(port, "/api/cmd/energy", {"unlimited": False})

    cmd(port, "/api/connect", {"mode": "sim"})
    st = wait_for(port, lambda s: (s["status"] or {}).get("lat_deg") is not None, limit=30)
    check("11. a sim reconnect leaves the console healthy, override off, tank full again",
          lambda: st.get("mode") == "sim"
          and st["status"].get("unlimited_energy") is False
          and (st["status"].get("fuel_l") or 0) >= cap - 0.05,
          lambda: "mode=%s fuel=%.1f" % (st.get("mode"), st["status"].get("fuel_l") or -1))

finally:
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()
    try:
        os.remove(SEED_FILE)                          # never leave the sentinel in the cache
    except OSError:
        pass

srvlog.seek(0)
server_out = srvlog.read()
srvlog.close()
# tracebacks and routes that raised - not every line that says "Error" (tests/lib/server_log.py, review #17)
from server_log import exception_lines  # noqa: E402
tb = exception_lines(server_out)
check("12. the console logged NO exception while serving those requests",
      not tb,
      ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb
      else "an answered request can still kill its handler")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
