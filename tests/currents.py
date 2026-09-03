"""tests/currents.py - the surface-current readout at the vessel's own position.

Andy's ask (2026-08-10): "implement the current module from the transit calculator
project ... use asv position for reference." `currents.py` is VENDORED (Fuel ->
Transit -> here, see its header), so this suite deliberately does NOT re-test the
model maths - the source projects own that, and duplicating it here would just be a
third copy to drift. What it tests is THE CONSOLE'S OWN WIRING, which is new:

  * the monitor NEVER blocks and NEVER raises - a request or a telemetry tick that
    waits on a multi-megabyte OPeNDAP read would stall the console mid-run;
  * every way a reading can fail to be live is SAID, not smoothed into a number or a
    bare dash: no cycle cached, no model water at the position, a value projected by
    tidal cycles because no frame covers now, or a refusal past the projection cap;
  * a PROJECTED value is flagged as an estimate, because a guess that reads like a
    measurement is worse than no reading at all;
  * the reading is fed the VESSEL'S position, and travels on the state so the card
    and any future consumer read the same answer;
  * it is NOT sim-gated. A real hull sits in real water; the wind rows are sim-only
    because the simulator invents the wind, but nobody invents the tide.

    python tests/currents.py      # exit 0 = pass, 1 = fail

NETWORK: the checks that drive the real console run it with NO position feed or use
whatever cache exists, so none of them REQUIRES a NOAA fetch to pass. A check that
would need the network says so and degrades to a skip rather than a false failure -
a suite that fails on a train is a suite people stop running.

TEETH (verified by mutation, table in the commit): swallow the projection flag and 4
fails; let _sample raise instead of returning a refusal and 2 fails; sim-gate the
snapshot and 6 fails; report a projected value without the flag and 5 fails.
"""

import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)

fails = 0
ran = 0


# --- crash guard: a throw outside a check() must still REPORT ------------------------
def _crash_report(t, e, tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (t.__name__, e))
    print("".join(traceback.format_exception(t, e, tb))[-600:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")
    # ⚠ FLUSH BEFORE os._exit — WITHOUT THIS THE GUARD REPORTED NOTHING AT ALL. `os._exit`
    # skips interpreter shutdown: no atexit, and NO STDOUT FLUSH, so the lines above were
    # written into a buffer that was then discarded. The suite exited 1 with an empty tail,
    # which is exactly the "no FAIL lines and a dead process are indistinguishable" failure
    # this guard exists to prevent, reintroduced by the guard itself. `os._exit` is still
    # right here — a console subprocess may be mid-teardown and a clean exit can hang on
    # it — so flush first, then go.
    sys.stdout.flush()
    sys.stderr.flush()
    os._exit(1)


sys.excepthook = _crash_report


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


def api(port, path, timeout=10):
    url = "http://127.0.0.1:%d%s" % (port, path)
    try:
        with urllib.request.urlopen(url, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


print("Surface currents at the vessel position - the console's wiring, not the model:")

# --- 1-4: the monitor in isolation, no console, no network --------------------------- #
import asv_console as A                                     # noqa: E402

# 1. A monitor with no cycle and no position must answer, not raise and not block.
{
    "note": "constructed at import in the console; here we use the shipped instance"
}
snap = A.CURRENTS.snapshot()
check("1. the monitor answers before any fix, without raising",
      isinstance(snap, dict) and "ok" in snap,
      "snapshot=" + json.dumps(snap)[:90])

# 2. THE REFUSAL PATH IS A RETURN, NOT AN EXCEPTION. _sample runs on a background
# thread whose death would freeze the reading at whatever it last held - silently, and
# in the direction that makes a stale current look current.
mon = A.CurrentsMonitor.__new__(A.CurrentsMonitor)           # no thread, no network
mon._ofs = "dbofs"
mon._cur = None
res = mon._sample(38.78965, -75.16094)
check("2. with no cycle cached the sample REFUSES in words, and does not throw",
      res.get("ok") is False and "cycle" in (res.get("note") or ""),
      json.dumps(res))


class _FakeCur(object):
    """Stands in for currents.Currents so the failure paths are reachable offline."""
    tag = "dbofs_fake_t00z"

    def __init__(self, vals, shift=0.0, raises=None):
        self._v, self._s, self._raises = vals, shift, raises
        import datetime as dt
        self.start = dt.datetime(2026, 8, 14, 13, 0, tzinfo=dt.timezone.utc)
        self.end = dt.datetime(2026, 8, 16, 18, 0, tzinfo=dt.timezone.utc)

    def at_best(self, lat, lon, when):
        if self._raises:
            raise self._raises
        return self._v, self._s


# 3. NO MODEL WATER is its own answer. The position is inside the box but on a land or
# masked node - a real case in a one-cell channel - and it must not read as slack water.
mon._cur = _FakeCur(None)
res = mon._sample(38.78965, -75.16094)
check("3. a position with no model water refuses, and never reads as 0.00 kn",
      res.get("ok") is False and "water" in (res.get("note") or "")
      and "speed_kn" not in res,
      json.dumps(res))

# 4. A LIVE FRAME: values through, projection flag zero, and the cycle span carried so
# the operator can see WHAT was read rather than trusting a bare number.
mon._cur = _FakeCur((1.234, 285.34, 0.0, 0.0), 0.0)
res = mon._sample(38.78965, -75.16094)
check("4. a real frame reports speed, set and the cycle span it came from",
      res.get("ok") is True and abs(res["speed_kn"] - 1.23) < 0.01
      and abs(res["set_deg"] - 285.3) < 0.05 and res["projected_h"] == 0.0
      and res.get("cycle_start_utc") and res.get("cycle_end_utc"),
      json.dumps(res))

# 5. A PROJECTED value is flagged BOTH ways - a machine-readable number and words a
# human reads. The module projects by whole M2 cycles when no frame covers now; that is
# an estimate (0.14-0.21 kt RMS in the source project's own measurement) and must never
# be presented as a reading.
mon._cur = _FakeCur((0.8, 120.0, 0.0, 0.0), -12.42)
res = mon._sample(38.78965, -75.16094)
check("5. a tidally-projected value carries projected_h AND says so in words",
      res.get("ok") is True and abs(res["projected_h"] + 12.42) < 0.01
      and "project" in (res.get("note") or "").lower(),
      json.dumps(res))

# 5b. ... and the ACCEPTANCE half: a live frame must NOT be labelled an estimate. A
# flag that is always on is the same as no flag.
mon._cur = _FakeCur((0.8, 120.0, 0.0, 0.0), 0.0)
res = mon._sample(38.78965, -75.16094)
check("5b. ... while a live frame carries no projection note",
      res.get("ok") is True and res["projected_h"] == 0.0 and not res.get("note"),
      json.dumps(res))

# 6. PAST THE CAP the module raises ValueError - a guess has a range beyond which it
# stops being one. That must surface as a refusal, not as a dead background thread.
mon._cur = _FakeCur(None, raises=ValueError("13.0 h is 4 cycles, past the 3-cycle cap"))
res = mon._sample(38.78965, -75.16094)
check("6. past the projection cap the refusal is reported, not raised",
      res.get("ok") is False and "cap" in (res.get("note") or ""),
      json.dumps(res))

# 6b. Any OTHER exception is contained too. The thread must outlive a surprise.
mon._cur = _FakeCur(None, raises=RuntimeError("boom"))
res = mon._sample(38.78965, -75.16094)
check("6b. an unexpected error is contained, and named by type",
      res.get("ok") is False and "RuntimeError" in (res.get("note") or ""),
      json.dumps(res))

# --- 7-10: the real console ---------------------------------------------------------- #
port = free_port()
srvlog = tempfile.TemporaryFile(mode="w+")
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none",
                         "--port", str(port), "--no-ais-service", "--no-log"],
                        cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
try:
    up = False
    for _ in range(80):
        try:
            st0 = (api(port, "/api/state")[1].get("status") or {})
            if st0.get("lat_deg") is not None:
                up = True
                break
        except Exception:
            pass
        time.sleep(0.25)
    check("7. the console starts with the currents monitor wired in", up,
          "no fix inside 20 s" if not up else "")

    if up:
        code, body = api(port, "/api/currents")
        check("8. GET /api/currents answers 200 with a shaped result",
              code == 200 and isinstance(body, dict) and "ok" in body,
              "HTTP %s %s" % (code, json.dumps(body)[:80]))

        st = api(port, "/api/state")[1]
        cur = st.get("current")
        check("9. the same reading rides the state as `current`",
              isinstance(cur, dict) and cur.get("ok") == body.get("ok")
              and cur.get("source") == body.get("source"),
              json.dumps(cur)[:90] if cur else "absent from /api/state")

        # 10. NOT SIM-GATED. The wind rows are sim-only because the simulator invents
        # the wind; nobody invents the tide, so a real hull must still get this. The
        # console is in sim here, so the assertion is on the CODE not being gated -
        # checked at the source, since a sim run cannot observe the real branch.
        src = open(os.path.join(APP, "asv_console.py"), encoding="utf-8").read()
        i = src.index('"current": CURRENTS.snapshot()')
        line = src[i:src.index("\n", i)]
        check("10. the current is on the state UNCONDITIONALLY, unlike the sim-only env",
              "_mode" not in line and "sim" not in line,
              line.strip())

        # 10b. ... and it is fed the VESSEL'S position, from the same telemetry the
        # other monitors use. "Use asv position for reference" was the requirement.
        check("10b. the monitor is fed the vessel fix from the telemetry path",
              'CURRENTS.update_position(telem["lat_deg"], telem["lon_deg"])' in src,
              "fed from the same frame as WATER/ENV")

        # 10c. A force refresh must KICK the background thread, never fetch inline.
        i2 = src.index("/api/currents")
        blk = src[i2:i2 + 420]
        check("10c. ?force=1 wakes the background thread rather than fetching in-request",
              "CURRENTS.refresh_now()" in blk and "ensure_cycle_covering" not in blk,
              "a cycle download must never sit on a request")
finally:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except Exception:
        proc.kill()

# ── THE STREAM ACTUALLY MOVES THE HULL ──────────────────────────────────────────────
#
# Andy, 2026-09-02: "current should absolutely drive sim drift too." Until then the reading
# was DISPLAY ONLY — CURRENTS was polled, published on the state and drawn on the card, and
# never once entered the physics. The boat sat in a 3 kn stream and did not move.
#
# ⚠⚠ IT IS ADVECTION, NOT A FORCE, AND SUMMING IT WITH THE WIND WOULD HAVE MADE IT ALL BUT
# VANISH. Wind and waves push a hull THROUGH the water, so they reach a terminal leeway set
# by quadratic hull drag — which is what the sim's force sum computes. A current does
# nothing of the kind: it moves the water the hull is floating in. A vessel lying stopped in
# a 2 kn stream makes 2 kn over the ground with NO force on it at all, and pushed through
# that same leeway equation the same 2 kn comes out a small fraction of a knot. Check A is
# therefore a RATE check and not a "did it move" check — the wrong model moves the boat too,
# just barely.
#
# ⚠ AND THIS IS WHY "STOP THE BOAT" IS NOT A SAFE ANSWER NEAR A STRUCTURE. With way off the
# vessel does not hold; it is set, bodily, at the stream's own rate. That measured fact is
# what the run-time clearance ladder is built on.
import importlib.util as _ilu
import math as _math

_spec = _ilu.spec_from_file_location("sim_under_test", os.path.join(APP, "asv_console.py"))
_C = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_C)


class _FakeCurrents:
    def __init__(self, kn, set_deg):
        self.kn, self.set_deg = kn, set_deg

    def snapshot(self):
        return {"ok": True, "speed_kn": self.kn, "set_deg": self.set_deg, "source": "test"}

    def update_position(self, *a):
        pass


def _drift(kn, set_deg, secs=60.0):
    """Ground track of a STOPPED boat over `secs`, in a stream of (kn, set_deg)."""
    _C.CURRENTS = _FakeCurrents(kn, set_deg)
    v = _C.SimVcu()
    v.lat, v.lon = 44.906, -66.983
    v._running, v._estop, v.sog_kn = True, False, 0.0
    v._holding, v._plan = False, []
    lat0, lon0 = v.lat, v.lon
    tel = None
    for _ in range(int(secs / 0.1)):
        tel = v.tick(0.1)
    dn = (v.lat - lat0) * _C.M_PER_DEG_LAT
    de = (v.lon - lon0) * _C.M_PER_DEG_LAT * _math.cos(_math.radians(v.lat))
    return {"m": _math.hypot(de, dn),
            "brg": (_math.degrees(_math.atan2(de, dn)) + 360) % 360,
            "kn": _math.hypot(de, dn) / secs / 0.514444, "tel": tel}


# ⚠ THIS SUITE'S check() READS `cond` AND `detail` DIRECTLY — IT DOES NOT CALL THEM. Pass a
# lambda and it is an object: always truthy, so the check is permanently GREEN. These five
# were written as thunks out of habit from the sibling suites, and only failed loudly
# because `detail` was a function too and the string concatenation threw. Values here.
_a = _drift(2.0, 90.0)
check("A. a STOPPED boat in a 2 kn stream makes 2 kn over the ground, on the set",
      abs(_a["kn"] - 2.0) < 0.05 and abs(((_a["brg"] - 90 + 180) % 360) - 180) < 2,
      "%.1f m on %.0f deg in 60 s = %.2f kn (want 61.7 m, 090, 2.00 kn) — summed as a FORCE "
      "this reads a fraction of a knot" % (_a["m"], _a["brg"], _a["kn"]))
_b = _drift(1.5, 225.0)
check("B. ... on the SET direction, not some blend with the boat's own heading",
      abs(((_b["brg"] - 225 + 180) % 360) - 180) < 2 and abs(_b["kn"] - 1.5) < 0.05,
      "1.5 kn set 225 -> %.1f m on %.0f deg (%.2f kn)" % (_b["m"], _b["brg"], _b["kn"]))
_z = _drift(0.0, 0.0)
check("C. with no stream nothing moves — which is what says the motion above is the CURRENT "
      "and not some new drift term",
      _z["m"] < 0.05, "moved %.3f m in 60 s" % _z["m"])
check("D. the card's SET reports the WHOLE set, stream included — it is labelled 'set', and "
      "a mariner's set includes the stream",
      abs((_a["tel"].get("env_set_kn") or 0) - 2.0) < 0.05
      and abs(((_a["tel"].get("env_set_deg") or 0) - 90 + 180) % 360 - 180) < 2,
      "SET %s kn @ %s deg" % (_a["tel"].get("env_set_kn"), _a["tel"].get("env_set_deg")))
check("E. SOG over the ground is non-zero with the engines STOPPED — the number that tells "
      "an operator they are being set down onto something",
      abs((_a["tel"].get("sog_kn") or 0) - 2.0) < 0.1,
      "engines stopped, SOG %s kn" % _a["tel"].get("sog_kn"))


print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else "\nall checks passed (%d)" % ran)
sys.exit(1 if fails else 0)
