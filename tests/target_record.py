"""tests/target_record.py - the mission record's own machinery, in-process: the target stream, the environment's change
key, runs, incidents, the quiet gate, command attribution, and the helpers that describe a session (2026-11-05).

Andy, 2026-11-05: "The playback function should display targets from AIS and any other sensor we may add. It should
have all the environmental data for playback. Look at the logging function(s) and add in data that fully describes any
given mission."

WHAT IS PINNED HERE, with stubs and an injected clock (the live console is tests/mission_record.py):
  * TargetRecorder - ids sorted by RANGE with no cap; a row on first sight, on a kinematics change, on a 60 s obs_t
    heartbeat and on a keyframe, and NOT otherwise; `gone`; track_info on first sight and on change, again for every id
    after a wake, and NOT on the periodic keyframe; a raising sensor said as {ok:false, note:"<Type>: <msg>"}; hdg null
    stays null; a non-finite position drops the track; quiet writes nothing; a registered sensor is recorded with no
    recorder change.
  * the built-in sensors' whitelists - a ROC's GPS host and port, an AIS feed's notes and URLs never reach a record;
    ais_traffic answers the test contacts with the service DOWN and strips user:password from the base it names.
  * SessionLogger - the env change key (ages, fetch stamps and page links are not values; a monitor_error is), <= 1 Hz,
    in full after start and after a wake; the logged state leaves the four blocks out while the frame keeps them; the
    1 Hz trace carries the new fields; run_start / run_end (superseded, ended, session_end, nothing after end_runs,
    bookkeeping through quiet); the incident window (60 s pre, 30 s post, one window, joined triggers, the page kinds,
    berth_grant only when the helm was taken); routine records stop at log_quiet; command attribution; the mission
    record's digest and its error form.
  * the session's description - _prev_session from a bounded tail, _git_ident through a worktree's .git FILE and
    packed-refs, the manifest's secret-flag filter, /api/logs labels (plain and .gz), Registry.snapshot's obs_t/pos_gap.
  * the environment's own times and rows - each NDBC buoy's whole row (never on the 4 Hz frame), env.obs_t through
    _effective, the water level's station time and the current's sample time as epochs.

    python tests/target_record.py      # exit 0 = pass, 1 = fail   (stdlib only)
    ASV_APP=<a copy of the app> python tests/target_record.py      # a mutation run against a copy

TEETH: every check was run against a mutant of the code it guards, on a COPY of the app (ASV_APP), never the source in
place - the list and the results are in the mission-record build report.
"""

import argparse
import gzip
import json
import os
import shutil
import sys
import tempfile
import threading
import time


# --- crash guard: a throw outside a check() must still REPORT ---------------------------
def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-800:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")
    # FLUSH BEFORE os._exit: it skips interpreter shutdown - no atexit and no stdout flush - so the lines above would be
    # thrown away. And atexit is what closes the loggers and removes the temp folder, so both are done here, in that
    # order (Windows will not remove a folder holding an open file).
    sys.stdout.flush()
    sys.stderr.flush()
    for lg in globals().get("_LOGS") or []:
        try:
            lg.close()
        except Exception:                  # noqa: BLE001 - the report is already out; tidy what can be tidied
            pass
    if globals().get("STATE") is not None:
        shutil.rmtree(STATE.dir, ignore_errors=True)
    os._exit(1)


sys.excepthook = _crash_report

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.environ.get("ASV_APP") or os.path.join(HERE, "..")     # ASV_APP: a copy, for a mutation run
sys.path.insert(0, APP)
sys.path.insert(0, os.path.join(HERE, "lib"))

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
    print(("  ok   " if ok else "  FAIL ") + name + ("   [" + str(detail)[:300] + "]" if detail else ""))
    if not ok:
        fails += 1


def until(pred, limit=5.0):
    t0 = time.time()
    while time.time() - t0 < limit:
        if pred():
            return True
        time.sleep(0.02)
    return pred()


def _no_nan(s):
    raise ValueError("a non-finite number in the file: %s" % s)


def read(log, strict=False):
    """Every record in a SessionLogger's file. STRICT (check 9b) fails on a NaN or Infinity in any line; the other reads
    take what Python's json takes, so a non-finite line is that check's failure and not a crash hiding the rest."""
    out = []
    with open(log.path, "r", encoding="utf-8") as f:
        for line in f:
            if line.strip():
                out.append(json.loads(line, parse_constant=_no_nan) if strict else json.loads(line))
    return out


def kinds(log, kind):
    return [r for r in read(log) if r.get("kind") == kind]


print("The mission record's machinery - targets, environment, runs, incidents, and the session's description:")

from console_state import ConsoleState  # noqa: E402
STATE = ConsoleState(prefix="asv_test_target_record_")
import asv_console as A  # noqa: E402
import ais_service as S  # noqa: E402
A.use_state_dir(STATE.dir)
check("0a. the suite's state is a temp folder, never the app's (not '0.': that is the crash guard's line)",
      lambda: os.path.abspath(A.LOG_DIR).startswith(os.path.abspath(STATE.dir))
      and os.path.abspath(A.MISSION_PATH).startswith(os.path.abspath(STATE.dir)),
      lambda: "LOG_DIR=%s" % A.LOG_DIR)

_LOGS = []


def _close_logs():
    for lg in _LOGS:
        lg.close()


# registered AFTER ConsoleState's rmtree, so it runs BEFORE it (atexit is last-in first-out): Windows will not remove a
# folder holding an open file, and a crashed run would otherwise leave its temp folder behind
import atexit  # noqa: E402
atexit.register(_close_logs)


def new_log():
    """A recording in a folder of its own (session ids are to the second, so two in one folder could share a file)."""
    d = STATE.path("logs_%d" % (len(_LOGS) + 1))
    lg = A.SessionLogger(enabled=True, log_dir=d, quiet_after_s=600)
    _LOGS.append(lg)
    return lg


# ══ TARGETS ════════════════════════════════════════════════════════════════════════════════════════════════════════════
BOAT = {"lat": 42.0, "lon": -70.0}


def trk(i, dlat, **kw):
    t = {"id": i, "obs_t": 1000.0, "lat": BOAT["lat"] + dlat, "lon": BOAT["lon"], "sog": 5.0, "cog": 90.0,
         "hdg": 91.0, "nav": 0, "name": "SHIP " + i, "cls": "cargo", "feed": "aisstream", "len_m": 120.0,
         "beam_m": 20.0, "dim": {"a": 80, "b": 40, "c": 10, "d": 10}, "info": {"dest": "BOSTON"}}
    t.update(kw)
    return t


feed = {"ok": True, "note": "", "tracks": [], "raise": None}


def radar(fix):
    if feed["raise"]:
        raise feed["raise"]
    return {"ok": feed["ok"], "note": feed["note"], "center": dict(fix) if fix else None, "area": {"mode": "test"},
            "health": {"radar": {"stalled": False, "quiet_s": 1, "n": 3}}, "tracks": [dict(t) for t in feed["tracks"]]}


clock = [10000.0]
LT = new_log()
REC = A.TargetRecorder(LT, fix=lambda: dict(BOAT), sensors={"radar": radar}, clock=lambda: clock[0])


def last_targets():
    t = kinds(LT, "targets")
    return t[-1] if t else None


TICK_ERR = []


def tick(dt=10.0):
    clock[0] += dt
    n0 = len(kinds(LT, "targets"))
    n_i0 = len(kinds(LT, "track_info"))
    try:                                  # the console's loop survives a raising pass; a check here must SEE it
        REC.tick()
    except Exception as e:                # noqa: BLE001
        TICK_ERR.append("%s: %s" % (type(e).__name__, e))
    t = kinds(LT, "targets")
    return (t[-1] if len(t) > n0 else None), kinds(LT, "track_info")[n_i0:]


# 1. first sight: FAR is listed first, NEAR is 5x closer
feed["tracks"] = [trk("FAR", 0.05), trk("NEAR", 0.01)]
r1, i1 = tick()
check("1. the first record is a keyframe: every id, sorted by RANGE from the boat (not by the sensor's order), a row "
      "each, and every track's particulars",
      lambda: r1 and r1["keyframe"] is True and r1["ids"] == ["NEAR", "FAR"] and len(r1["rows"]) == 2
      and sorted(i["id"] for i in i1) == ["FAR", "NEAR"] and r1["sensor"] == "radar"
      and r1["center"] == BOAT and r1["ok"] is True,
      lambda: json.dumps({"ids": r1 and r1["ids"], "rows": r1 and len(r1["rows"]), "infos": len(i1)}))
check("1b. a row carries kinematics only, a track_info the static facts",
      lambda: set(r1["rows"][0]) == {"id", "obs_t", "lat", "lon", "sog", "cog", "hdg", "nav"}
      and set(i1[0]) >= {"sensor", "id", "name", "cls", "feed", "len_m", "beam_m", "dim", "info"}
      and i1[0]["info"] == {"dest": "BOSTON"} and i1[0]["dim"] == {"a": 80, "b": 40, "c": 10, "d": 10},
      lambda: json.dumps([r1["rows"][0], i1[0]])[:240])

# 2. the same answer again: the ids are held, nothing moved
r2, i2 = tick()
check("2. the same picture 10 s later: a record (ids are held) with NO rows and no particulars again",
      lambda: r2 and r2["ids"] == ["NEAR", "FAR"] and r2["rows"] == [] and i2 == [] and r2["keyframe"] is False,
      lambda: json.dumps(r2)[:200])

# 3. one moves
feed["tracks"] = [trk("FAR", 0.05), trk("NEAR", 0.011)]
r3, _ = tick()
check("3. a track whose position changed gets a row - and only it",
      lambda: r3 and [x["id"] for x in r3["rows"]] == ["NEAR"] and r3["rows"][0]["lat"] == round(BOAT["lat"] + 0.011, 6),
      lambda: json.dumps(r3 and r3["rows"]))

# 4. the obs_t heartbeat: kinematics unchanged, the report keeps coming
feed["tracks"] = [trk("FAR", 0.05, obs_t=1059.0), trk("NEAR", 0.011)]
r4a, _ = tick()
feed["tracks"] = [trk("FAR", 0.05, obs_t=1060.0), trk("NEAR", 0.011)]
r4b, _ = tick()
check("4. an unchanged track is re-written once its report is TRACK_HEARTBEAT_S (60 s) past the last logged one - "
      "not at 59 s",
      lambda: r4a and r4a["rows"] == [] and r4b and [x["id"] for x in r4b["rows"]] == ["FAR"]
      and r4b["rows"][0]["obs_t"] == 1060.0,
      lambda: json.dumps([r4a and r4a["rows"], r4b and r4b["rows"]]))

# 5. a static change
feed["tracks"] = [trk("FAR", 0.05, obs_t=1060.0, name="RENAMED"), trk("NEAR", 0.011)]
r5, i5 = tick()
check("5. a changed particular re-writes that track's track_info alone, with no row (nothing moved)",
      lambda: [i["id"] for i in i5] == ["FAR"] and i5[0]["name"] == "RENAMED" and r5 and r5["rows"] == [],
      lambda: json.dumps([[i["id"] for i in i5], r5 and r5["rows"]]))

# 6. gone, and back
feed["tracks"] = [trk("NEAR", 0.011)]
r6, _ = tick()
feed["tracks"] = [trk("FAR", 0.05, obs_t=1060.0, name="RENAMED"), trk("NEAR", 0.011)]
r6b, i6b = tick()
check("6. a track no longer held is named in `gone`; when she comes back it is a first sight again - a row and her "
      "particulars",
      lambda: r6 and r6["gone"] == ["FAR"] and r6["ids"] == ["NEAR"] and r6b
      and [x["id"] for x in r6b["rows"]] == ["FAR"] and [i["id"] for i in i6b] == ["FAR"],
      lambda: json.dumps([r6 and r6["gone"], r6b and r6b["rows"], [i["id"] for i in i6b]])[:240])

# 7. empty and unchanged: the 60 s heartbeat, not every 10 s
feed["tracks"] = []
r7a, _ = tick()                       # holds nothing now: still written, so `gone` lands
r7b, _ = tick()                       # held nothing last time either, nothing changed
clock_quiet_from = clock[0]
r7c, _ = tick(49.0)
r7d, _ = tick(1.0)
check("7. a sensor holding nothing writes once (its `gone`), then nothing until the 60 s heartbeat",
      lambda: r7a and sorted(r7a["gone"]) == ["FAR", "NEAR"] and r7b is None and r7c is None and r7d is not None
      and r7d["ids"] == [] and r7d["gone"] == [],
      lambda: json.dumps([bool(r7a), r7b, r7c, bool(r7d)]))

# 8. a raising sensor
feed["tracks"] = [trk("NEAR", 0.011)]
tick()
feed["raise"] = RuntimeError("boom")
r8, _ = tick()
r8b, _ = tick()
r8c, _ = tick()
feed["raise"] = None
check("8. a sensor that raises is said once as {ok:false, note:'<Type>: <msg>'} - what it held is `gone` - and is "
      "not re-written every 10 s",
      lambda: r8 and r8["ok"] is False and r8["note"] == "RuntimeError: boom" and r8["gone"] == ["NEAR"]
      and r8b is None and r8c is None,
      lambda: json.dumps([r8, r8b, r8c])[:240])
feed["tracks"] = []
r8d, _ = tick()
check("8b. ... and its recovery, holding nothing, is written at once (an ok/note change alone is a record)",
      lambda: r8d is not None and r8d["ok"] is True and r8d["note"] == "" and r8d["ids"] == [],
      lambda: json.dumps(r8d)[:200])

# 9. what is not reported stays null; a non-finite position drops the track; nothing non-finite in the file
nan = float("nan")
feed["tracks"] = [trk("NOHDG", 0.02, hdg=None, sog=nan), trk("BADPOS", 0.03, lat=nan),
                  trk("ROUNDED", 0.025, sog=7.4567, cog=123.456, lat=BOAT["lat"] + 0.0251234567)]
r9, i9 = tick()
check("9. a heading not reported is written null, never 0; a NaN speed is null; a track with no finite position is "
      "not recorded at all; the numbers are rounded (6 dp position, 2 dp speed, 1 dp course)",
      lambda: not TICK_ERR and r9 and r9["ids"] == ["NOHDG", "ROUNDED"] and r9["rows"][0]["hdg"] is None
      and r9["rows"][0]["sog"] is None and r9["rows"][1]["sog"] == 7.46 and r9["rows"][1]["cog"] == 123.5
      and r9["rows"][1]["lat"] == round(BOAT["lat"] + 0.0251234567, 6),
      lambda: json.dumps([TICK_ERR, r9 and r9["rows"]]))
check("9b. ... and every line of the file parses STRICTLY (no NaN, no Infinity)",
      lambda: len(read(LT, strict=True)) > 10)

# 10. the periodic keyframe and the wake keyframe
feed["tracks"] = [trk("NOHDG", 0.02, hdg=None), trk("K2", 0.04)]
tick()
r10a, i10a = tick(A.TARGETS_KEYFRAME_S)
check("10. every TARGETS_KEYFRAME_S every id gets a row (keyframe) - and the particulars are NOT all re-written",
      lambda: r10a and r10a["keyframe"] is True and sorted(x["id"] for x in r10a["rows"]) == ["K2", "NOHDG"]
      and i10a == [],
      lambda: json.dumps([r10a and r10a["keyframe"], r10a and len(r10a["rows"]), len(i10a)]))
LT.quiet_on("test")
n_before_quiet = len(read(LT))
clock[0] += 10
asked = REC.tick()
check("11. while the recording is quiet the recorder asks nothing and writes nothing",
      lambda: asked is False and len(read(LT)) == n_before_quiet, lambda: "asked=%s" % asked)
LT.wake("test")
r10b, i10b = tick()
check("10b. the first record after a wake is a keyframe with EVERY track's particulars again (a reader may start "
      "there)",
      lambda: r10b and r10b["keyframe"] is True and len(r10b["rows"]) == 2 and sorted(i["id"] for i in i10b)
      == ["K2", "NOHDG"],
      lambda: json.dumps([r10b and r10b["keyframe"], r10b and len(r10b["rows"]), len(i10b)]))

# 12. no cap
feed["tracks"] = [trk("M%03d" % k, 0.0001 * (k + 1)) for k in range(250)]
r12, i12 = tick()
check("12. NO CAP: 250 tracks are 250 ids and 250 rows, nearest first",
      lambda: r12 and len(r12["ids"]) == 250 and r12["ids"][0] == "M000" and r12["ids"][-1] == "M249"
      and len([x for x in r12["rows"] if x["id"].startswith("M")]) == 250,
      lambda: "ids=%d rows=%d" % (len(r12["ids"]), len(r12["rows"])) if r12 else "no record")

# 13. a registered sensor
check("13. the built-in sensors 'ais' and 'roc' are registered", lambda: list(A._TARGET_SENSORS)[:2] == ["ais", "roc"],
      lambda: list(A._TARGET_SENSORS))
LR = new_log()
A.register_target_sensor("sonar", lambda fix: {"ok": True, "note": "", "center": fix, "tracks": [trk("S1", 0.001)]})
_saved = {k: A._TARGET_SENSORS.get(k) for k in ("ais", "roc")}
for _k in _saved:                         # the built-ins answer nothing here: no AIS query, no ROC registry read
    if _saved[_k] is not None:
        A._TARGET_SENSORS[_k] = lambda fix: {"ok": True, "tracks": []}
try:
    A.TargetRecorder(LR, fix=lambda: dict(BOAT)).tick()
finally:
    for _k, _f in _saved.items():
        if _f is not None:
            A._TARGET_SENSORS[_k] = _f
    A._TARGET_SENSORS.pop("sonar", None)
son = [r for r in kinds(LR, "targets") if r.get("sensor") == "sonar"]
check("13b. a new sensor is ONE register_target_sensor call: a recorder built with the defaults records it",
      lambda: len(son) == 1 and son[0]["ids"] == ["S1"]
      and [i["sensor"] for i in kinds(LR, "track_info")] == ["sonar"],
      lambda: json.dumps(son)[:200])

# 14. the ROC sensor's whitelist
class _Roc:
    def snapshot(self):
        return {"home_id": "R1", "rocs": [
            {"id": "R1", "name": "Mothership", "kind": "ship", "status": "active", "lat": 42.01, "lon": -70.01,
             "cog": 10.0, "sog": 3.0, "heading": 12.0, "speed_kn": 3.0, "arrival": {"lat": 42.0, "lon": -70.0},
             "arrival_bearing": 180.0, "link": "ok", "age_s": 2.0, "source": "gps", "moving": True,
             "offset": {"range_m": 50, "bearing_deg": 180, "ref": "true"},
             "gps": {"attached": True, "host": "10.1.2.3", "port": 10110, "udp": False, "spawned": False}},
            {"id": "R2", "name": "nofix", "kind": "shore", "lat": None, "lon": None, "gps": {"host": "h", "port": 1}}]}


_real_roc = A.ROC
A.ROC = _Roc()
try:
    roc = A._roc_targets(dict(BOAT))
finally:
    A.ROC = _real_roc
check("14. the ROC sensor: a ROC with no position is not a track, the class is roc:<kind>, home is said - and her GPS "
      "host and port appear NOWHERE",
      lambda: [t["id"] for t in roc["tracks"]] == ["R1"] and roc["tracks"][0]["cls"] == "roc:ship"
      and roc["tracks"][0]["info"]["home"] is True and "10.1.2.3" not in json.dumps(roc)
      and "10110" not in json.dumps(roc) and "gps\": {" not in json.dumps(roc),
      lambda: json.dumps(roc)[:300])

# 15. the AIS health whitelist
h = A._ais_health({"aisstream": {"state": "ok", "stalled": False, "quiet_s": 3.4, "reports": 12,
                                 "note": "wss://stream.aisstream.io/?key=SECRETKEY", "url": "http://x"},
                   "nmea": "not a dict"})
check("15. the AIS feeds' health is WHITELISTED: state, stalled, quiet_s, n - no note, no URL, no key",
      lambda: h == {"aisstream": {"state": "ok", "stalled": False, "quiet_s": 3.0, "n": 12}}, lambda: json.dumps(h))

# 16. ais_traffic with the service DOWN
_srv = __import__("socket").socket()
_srv.bind(("127.0.0.1", 0))
_dead = _srv.getsockname()[1]
_srv.close()
_real_base = A.AIS_BASE
A.AIS_BASE = "http://someone:hunter2@127.0.0.1:%d" % _dead
try:
    down = A.ais_traffic(BOAT["lat"], BOAT["lon"])
    with A._AIS_TEST_LOCK:
        A.AIS_TEST_CONTACTS.append({"mmsi": 990000001, "name": "TEST-1", "lat": BOAT["lat"] + 0.001,
                                    "lon": BOAT["lon"], "sog": 0.0, "cog": None, "heading": 90.0, "type": None,
                                    "cat": "test", "nav": None, "src": "test", "srcs": ["test"]})
    tests_only = A.ais_traffic(BOAT["lat"], BOAT["lon"])
    ais_ans = A._ais_targets(dict(BOAT))
finally:
    A.AIS_BASE = _real_base
    with A._AIS_TEST_LOCK:
        del A.AIS_TEST_CONTACTS[:]
check("16. ais_traffic with the service down: {ok:false} naming the base WITHOUT its user:password",
      lambda: down["ok"] is False and "unreachable" in down["note"] and "hunter2" not in down["note"]
      and "someone" not in down["note"] and down["area"]["mode"] in ("sea", "lake"),
      lambda: down.get("note"))
check("16b. ... and with a test contact placed, the test contacts stand without the service",
      lambda: tests_only["ok"] is True and [v["mmsi"] for v in tests_only["vessels"]] == [990000001]
      and "test contacts only" in tests_only["note"],
      lambda: json.dumps(tests_only)[:200])
check("16c. the AIS sensor answers the same contacts as tracks: id the MMSI, class 'test', heading as hdg, obs_t now",
      lambda: ais_ans["ok"] is True and [t["id"] for t in ais_ans["tracks"]] == ["990000001"]
      and ais_ans["tracks"][0]["cls"] == "test" and ais_ans["tracks"][0]["hdg"] == 90.0
      and abs(ais_ans["tracks"][0]["obs_t"] - time.time()) < 5,
      lambda: json.dumps(ais_ans["tracks"])[:200])
tr = A._ais_track({"mmsi": 1, "lat": 1, "lon": 2, "heading": None, "obs_t": 1234.5, "age": 99, "cat": "cargo",
                   "src": "aisstream", "length": 100, "dest": "X"}, 5000.0)
check("16d. an AIS contact's obs_t is when the SERVICE heard her (its obs_t), a missing heading stays None",
      lambda: tr["obs_t"] == 1234.5 and tr["hdg"] is None and tr["len_m"] == 100 and tr["info"] == {"dest": "X"},
      lambda: json.dumps(tr))

# ══ SESSIONLOGGER: THE ENVIRONMENT ═════════════════════════════════════════════════════════════════════════════════════
LE = new_log()


def blocks(**over):
    b = {"env": {"ok": True, "wind_kn": 10.0, "age_s": 30, "fetched_at": 1.0, "obs_t": 500.0},
         "water": {"ok": True, "offset_m": 0.5, "age_s": 60, "page": "https://x", "page_for": "8410140"},
         "current": {"ok": True, "speed_kn": 0.4, "set_deg": 90.0, "sampled_t": 100.0},
         "density": {"ok": True, "rho": 1025.0}}
    for k, v in over.items():
        b[k] = dict(b[k], **v)
    return b


E0 = 50000.0
LE._env_check(blocks(), E0)
LE._env_check(blocks(env={"age_s": 99, "fetched_at": 2.0}, water={"age_s": 120, "page": "https://y"},
                     current={"sampled_t": 130.0}), E0 + 2)
e1 = kinds(LE, "env")
check("17. the first env record is FULL, with all four blocks, ages INCLUDED",
      lambda: len(e1) == 1 and e1[0]["full"] is True and set(e1[0]["blocks"]) == {"env", "water", "current", "density"}
      and e1[0]["blocks"]["env"]["age_s"] == 30,
      lambda: json.dumps(e1)[:240])
check("17b. ages, fetch stamps, page links and the current's sample time are not VALUES: no record for them alone",
      lambda: len(e1) == 1, lambda: "env records: %d" % len(e1))
LE._env_check(blocks(water={"offset_m": 0.6}), E0 + 4)
e2 = kinds(LE, "env")
check("17c. a value change writes a record naming the block that changed - not full",
      lambda: len(e2) == 2 and e2[1]["full"] is False and e2[1]["changed"] == ["water"]
      and e2[1]["blocks"]["water"]["offset_m"] == 0.6,
      lambda: json.dumps(e2[-1])[:200])
LE._env_check(blocks(water={"offset_m": 0.6}, env={"monitor_error": "IncompleteRead"}), E0 + 6)
e3 = kinds(LE, "env")
check("17d. a monitor_error IS a value: it writes a record", lambda: len(e3) == 3 and e3[2]["changed"] == ["env"],
      lambda: json.dumps([r["changed"] for r in e3]))
LE._env_check(blocks(water={"offset_m": 0.7}, env={"monitor_error": "IncompleteRead"}), E0 + 6.5)
n_half = len(kinds(LE, "env"))
LE._env_check(blocks(water={"offset_m": 0.7}, env={"monitor_error": "IncompleteRead"}), E0 + 7.1)
n_after = len(kinds(LE, "env"))
check("17e. the key is looked at no more than once a second: a change 0.5 s after a look waits for the next one",
      lambda: n_half == 3 and n_after == 4, lambda: "after 0.5 s: %d, after 1.1 s: %d" % (n_half, n_after))
LE.quiet_on("t")
LE.wake("t")
LE._env_check(blocks(water={"offset_m": 0.7}, env={"monitor_error": "IncompleteRead"}), E0 + 7.2)
e4 = kinds(LE, "env")
check("17f. after a wake the environment is written in FULL again, unchanged or not",
      lambda: len(e4) == 5 and e4[-1]["full"] is True, lambda: json.dumps([r["full"] for r in e4]))
LR = new_log()
LR._env_check(blocks(), E0)
LR._env_check(blocks(current={"sampled_t": 159.0}), E0 + 2)          # 59 s on: not yet
n_59 = len(kinds(LR, "env"))
LR._env_check(blocks(current={"sampled_t": 160.0}), E0 + 4)          # 60 s on, the SAME value: a resample record
LR._env_check(blocks(current={"sampled_t": 200.0}), E0 + 6)          # 40 s past that one: not yet
er = kinds(LR, "env")
check("17h. a current recomputed with the SAME value says so every ENV_RESAMPLE_LOG_S: a small record of that block "
      "alone (not full, no extra) - else the replay aged it from its own sample, '18 min' where the live card read 1",
      lambda: n_59 == 1 and len(er) == 2 and er[1]["full"] is False and set(er[1]["blocks"]) == {"current"}
      and er[1]["blocks"]["current"]["sampled_t"] == 160.0 and er[1]["resampled"] == ["current"] and er[1]["extra"] == {}
      and er[1]["changed"] == [],
      lambda: json.dumps([[r.get("full"), sorted(r["blocks"]), r.get("resampled")] for r in er]))

# the extra (buoys, stations) is in the key
LX = new_log()
ex = {"v": {"buoys": [{"id": "44013", "WSPD": 5.0}], "stations": {"water": [], "current": []}}}
LX.env_extra = lambda b: ex["v"]
LX._env_check(blocks(), E0)
ex["v"] = {"buoys": [{"id": "44013", "WSPD": 6.0}], "stations": {"water": [], "current": []}}
LX._env_check(blocks(), E0 + 2)
LX.env_extra = lambda b: 1 / 0
LX._env_check(blocks(), E0 + 4)
ex_recs = kinds(LX, "env")
check("17g. the buoys' own rows ride the record and a new buoy row is a change; a failing extra is said, not raised",
      lambda: len(ex_recs) == 3 and ex_recs[0]["extra"]["buoys"][0]["WSPD"] == 5.0 and ex_recs[1]["changed"] == ["extra"]
      and "ZeroDivisionError" in ex_recs[2]["extra"]["error"],
      lambda: json.dumps([r.get("changed") for r in ex_recs]))

# ══ SESSIONLOGGER: THE LOGGED STATE, THE TRACE ════════════════════════════════════════════════════════════════════════
LS = new_log()


def frame(run="idle", seq=0, lat=42.0, lon=-70.0, pct=90.0, **kw):
    ev = {"type": "state", "run": run, "run_seq": seq, "behavior": kw.pop("behavior", "goto"), "armed": True,
          "estop": kw.pop("estop", False), "autonomy": kw.pop("autonomy", "auto" if run == "running" else "armed"),
          "note": kw.pop("note", ""), "wp_index": 0, "wp_total": 1, "run_completion": "loiter", "vessel_id": "v1",
          "loop_fault": kw.pop("loop_fault", None), "supervisor_held": kw.pop("supervisor_held", None),
          "status": dict({"lat_deg": lat, "lon_deg": lon, "heading_deg": 90.0, "sog_kn": 3.0, "speed_key": "survey",
                          "battery_v": 24.0, "battery_pct": pct, "energy_type": "battery", "crab_deg": 2.5,
                          "pitch_deg": 1.0, "speed_target_kn": 3.2, "env_set_kn": nan,
                          "forcing": {"wind_kn": 10.0, "rho": 1025.0}}, **kw.pop("status", {}))}
    ev.update(blocks())
    ev.update(kw)
    return ev


ev0 = frame()
LS.state(ev0)
st_rec = kinds(LS, "state")
check("18. the LOGGED state leaves the four environment blocks out - the frame itself (the SSE copy) keeps them",
      lambda: len(st_rec) == 1 and not (set(st_rec[0]["state"]) & {"env", "water", "current", "density"})
      and set(ev0) >= {"env", "water", "current", "density"},
      lambda: sorted(st_rec[0]["state"])[:30] if st_rec else "no state record")
LS._last_state_t -= 2.0
LS.state(frame())
tel = kinds(LS, "telemetry")
check("18b. the 1 Hz trace carries the new fields (crab, pitch, target speed, the sim's forcing) and a NaN in it is "
      "null",
      lambda: tel and tel[-1]["status"]["crab_deg"] == 2.5 and tel[-1]["status"]["speed_target_kn"] == 3.2
      and tel[-1]["status"]["forcing"] == {"wind_kn": 10.0, "rho": 1025.0} and tel[-1]["status"]["env_set_kn"] is None,
      lambda: json.dumps(tel[-1] if tel else None)[:240])

# ══ SESSIONLOGGER: RUNS ═══════════════════════════════════════════════════════════════════════════════════════════════
LRUN = new_log()
LRUN.state(frame("idle", 0))
LRUN.state(frame("running", 1, lat=42.0, pct=90.0))
LRUN.state(frame("running", 1, lat=42.001, pct=88.0))
LRUN.state(frame("complete", 1, lat=42.001, pct=87.0, note="arrived"))
rs, re_ = kinds(LRUN, "run_start"), kinds(LRUN, "run_end")
check("19. a run has a start: run_id '<session>:<run_seq>', behavior, completion, wp_total, speed, vessel",
      lambda: len(rs) == 1 and rs[0]["run_id"] == "%s:1" % LRUN.session_id and rs[0]["run_seq"] == 1
      and rs[0]["behavior"] == "goto" and rs[0]["completion"] == "loiter" and rs[0]["vessel_id"] == "v1"
      and rs[0]["speed_key"] == "survey",
      lambda: json.dumps(rs))
check("19b. ... and an end in the state it reached, with the distance summed between the fixes and the energy used",
      lambda: len(re_) == 1 and re_[0]["run"] == "complete" and re_[0]["note"] == "arrived"
      and abs(re_[0]["dist_m"] - 111.2) < 1.0
      and re_[0]["energy"] == {"kind": "battery", "unit": "%", "start": 90.0, "end": 87.0, "used": 3.0},
      lambda: json.dumps(re_))
LRUN.state(frame("running", 2))
LRUN.state(frame("running", 3))
re2, rs2 = kinds(LRUN, "run_end"), kinds(LRUN, "run_start")
check("19c. a new run_seq while running ends the run before it as 'superseded', naming the one that replaced it",
      lambda: len(re2) == 2 and re2[1]["run"] == "superseded" and re2[1]["run_seq"] == 2 and re2[1]["next_run_seq"] == 3
      and [r["run_seq"] for r in rs2] == [1, 2, 3],
      lambda: json.dumps(re2[-1]))
LRUN.quiet_on("t")
LRUN.state(frame("paused", 3))
LRUN.state(frame("idle", 3))
re3 = kinds(LRUN, "run_end")
check("19d. the bookkeeping does not depend on the log being awake: a run ending while quiet still gets its run_end",
      lambda: len(re3) == 3 and re3[2]["run"] == "idle", lambda: json.dumps(re3[-1]))
LRUN.wake("t")
LRUN.state(frame("running", 4))
LRUN.end_runs("session_end")
LRUN.state(frame("idle", 4))
LRUN.state(frame("running", 5))
re4, rs4 = kinds(LRUN, "run_end"), kinds(LRUN, "run_start")
check("19e. at session end an active run ends as 'session_end' - and the disconnect's frames after it start and end "
      "nothing",
      lambda: re4[-1]["run"] == "session_end" and re4[-1]["run_seq"] == 4 and len(re4) == 4
      and [r["run_seq"] for r in rs4] == [1, 2, 3, 4],
      lambda: json.dumps([[r["run_seq"], r["run"]] for r in re4]))

# ══ SESSIONLOGGER: INCIDENTS ══════════════════════════════════════════════════════════════════════════════════════════
LI = new_log()
T0 = 70000.0


def feed_frames(log, t_from, t_to, **kw):
    t = t_from
    while t < t_to - 1e-9:
        log._incident_frame(frame("running", 1, **kw), t)
        t += 0.25
    return t


feed_frames(LI, T0, T0 + 70)
LI._incident_frame(frame("running", 1, estop=True, autonomy="e-stop"), T0 + 70)
LI.incident_trigger("guard_override", {"x": 1}, now=T0 + 70)      # the frames' clock: a trigger extends the window
check("20. an e-stop opens a window holding the last 60 s of frames (and no more)",
      lambda: LI._inc is not None and 239 <= len(LI._inc["pre"]) <= 242 and LI._inc["pre"][0][0] >= T0 + 10,
      lambda: "pre=%d first=%s" % (len(LI._inc["pre"]), LI._inc["pre"][0][0] - T0) if LI._inc else "no window")
feed_frames(LI, T0 + 70.25, T0 + 99.9, estop=True, autonomy="e-stop")
early = kinds(LI, "incident")
LI._incident_frame(frame("running", 1, estop=True, autonomy="e-stop"), T0 + 100.1)
until(lambda: len(kinds(LI, "incident")) == 1, 3.0)
inc = kinds(LI, "incident")
check("20b. ... and 30 s later ONE incident record: the 60 s before and 30 s after, a cols header the frames match",
      lambda: early == [] and len(inc) == 1 and inc[0]["cols"][0] == "t" and len(inc[0]["cols"]) == len(inc[0]["frames"][0])
      and inc[0]["frames"][-1][0] - inc[0]["frames"][0][0] > 89 and 355 <= len(inc[0]["frames"]) <= 365
      and inc[0]["pre_s"] == 60.0 and inc[0]["post_s"] == 30.0,
      lambda: "early=%d inc=%d frames=%s" % (len(early), len(inc), len(inc[0]["frames"]) if inc else 0))
check("20c. everything that fired inside the window JOINED it - the e-stop, the autonomy change, the page's override",
      lambda: inc[0]["trigger"] == "estop" and inc[0]["triggers"] == ["estop", "autonomy:e-stop", "guard_override"]
      and len(inc[0]["fired"]) == 3,
      lambda: json.dumps(inc[0]["triggers"]) if inc else "none")
LJ = new_log()
LJ.incident_trigger("berth_grant", {"event": "granted"})
LJ.incident_trigger("survey_note", {})
none_open = LJ._inc is None
LJ.incident_trigger("berth_grant", {"event": "helm_taken"})
check("20d. berth_grant opens a window ONLY when the guard took the helm; a page kind not on the list opens none",
      lambda: none_open and LJ._inc is not None and LJ._inc["first"] == "berth_grant:helm_taken",
      lambda: "none_open=%s inc=%s" % (none_open, LJ._inc and LJ._inc["first"]))
LK = new_log()
feed_frames(LK, T0, T0 + 5)
LK._incident_frame(frame("running", 1, supervisor_held={"t": 1, "why": "x"}), T0 + 5)
LK._incident_frame(frame("running", 1, loop_fault={"error": "x"}, supervisor_held={"t": 1, "why": "x"}), T0 + 5.25)
check("20e. a supervisor stand-down and a loop fault are triggers too",
      lambda: LK._inc is not None and [n for _t, n in LK._inc["fired"]] == ["supervisor_stand_down", "loop_fault"],
      lambda: json.dumps(LK._inc["fired"]) if LK._inc else "no window")
LK.quiet_on("t")
LK.end_runs("session_end")
lk_inc = kinds(LK, "incident")
check("20f. the log going quiet WRITES an open incident as it stands, cut there (before the flag, while a routine record "
      "still lands) - it was left open, to be written hours later at the wake or dropped at a quiet session end",
      lambda: len(lk_inc) == 1 and lk_inc[0]["cut"] == "log_quiet" and lk_inc[0]["trigger"] == "supervisor_stand_down"
      and LK._inc is None and len(read(LK)) and read(LK)[-1]["kind"] == "log_quiet",
      lambda: json.dumps([[r["kind"], r.get("cut")] for r in read(LK)]))
LK2 = new_log()
LK2.incident_trigger("ais_avoid", {})
LK2.end_runs("session_end")
check("20g. ... and awake, the open window is written as it stands when the session ends",
      lambda: len(kinds(LK2, "incident")) == 1 and kinds(LK2, "incident")[0]["trigger"] == "ais_avoid")

# ══ SESSIONLOGGER: QUIET, COMMANDS, THE MISSION ═══════════════════════════════════════════════════════════════════════
LQ = new_log()
LQ.routine("targets", {"sensor": "x"})
LQ.quiet_on("home and idle")
LQ.routine("targets", {"sensor": "y"})
LQ.routine("env", {"blocks": {}})
LQ.event("connect", mode="sim")
q = read(LQ)
check("21. routine records stop AT log_quiet (the flag is raised before the record); lifecycle records still land",
      lambda: [r["kind"] for r in q] == ["targets", "log_quiet", "connect"], lambda: [r["kind"] for r in q])
LC = new_log()
LC.command("/api/cmd/goto", {"lat": 1}, 200, client="abcdefghijkl", rx_t=1234.56789, ms=12.345)
LC.command("/api/cmd/stop", {}, 200)
c = kinds(LC, "command")
check("22. a command says WHO (the tab's first 8 characters), when it was RECEIVED and how long it took; a call "
      "without them writes the record as before",
      lambda: c[0]["client"] == "abcdefgh" and c[0]["rx_t"] == 1234.568 and c[0]["ms"] == 12.3
      and not (set(c[1]) & {"client", "rx_t", "ms"}),
      lambda: json.dumps(c))
import inspect
_post_src = inspect.getsource(A.Handler.do_POST)
check("22b. ... and `ms` is timed by perf_counter, not monotonic: on Windows monotonic is GetTickCount64, which steps every "
      "15.6 ms, and the first live recording wrote ms 0.0 for nearly every command",
      lambda: _post_src.count("time.perf_counter()") == 2 and "time.monotonic()" not in _post_src,
      lambda: "perf_counter x%d, monotonic x%d" % (_post_src.count("time.perf_counter()"), _post_src.count("time.monotonic()")))
LM = new_log()
plan = {"rev": 7, "waypoints": [{"lat": 1.0, "lon": 2.0}], "speed": "survey"}
LM.mission_source = lambda: dict(plan)
LM.write_mission("boot")
LM.mission_source = lambda: (_ for _ in ()).throw(A.MissionUnavailable("the plan file is damaged"))
LM.write_mission("boot")
m = kinds(LM, "mission")
check("23. the mission record: the plan, its revision and a digest of its CANONICAL JSON (key order does not move it); "
      "a plan that cannot be read is said, never raised",
      lambda: m[0]["rev"] == 7 and m[0]["mission"] == plan and m[0]["sha256"] == A._plan_digest(
          {"speed": "survey", "waypoints": [{"lon": 2.0, "lat": 1.0}], "rev": 7})
      and len(m[0]["sha256"]) == 64 and "damaged" in m[1]["error"] and "mission" not in m[1],
      lambda: json.dumps(m)[:240])
LM.mission_source = lambda: dict(plan)
LM.quiet_on("t")
LM.wake("planned")
until(lambda: len(kinds(LM, "mission")) == 3, 3.0)
check("23b. after a wake the plan on disk is written again (why: log_resume)",
      lambda: [r.get("why") for r in kinds(LM, "mission")] == ["boot", "boot", "log_resume"],
      lambda: [r.get("why") for r in kinds(LM, "mission")])

# ══ THE SESSION'S DESCRIPTION ═════════════════════════════════════════════════════════════════════════════════════════
PD = STATE.path("prev")
os.makedirs(PD)
check("24. no other recording: prev is null", lambda: A._prev_session(PD, os.path.join(PD, "asv_own.jsonl")) is None)


def put(name, recs, pad_kb=0):
    with open(os.path.join(PD, name), "w", encoding="utf-8") as f:
        for k in range(pad_kb):
            f.write(json.dumps({"t": 1.0, "kind": "telemetry", "run": "x", "wp_index": 99, "pad": "p" * 1000}) + "\n")
        for r in recs:
            f.write(json.dumps(r) + "\n")


put("asv_20261101-000000.jsonl", [{"t": 5, "kind": "session_end"}])
put("asv_20261102-000000.jsonl", [
    {"t": 10, "kind": "state", "state": {"run": "running", "armed": True, "behavior": "survey", "wp_index": 3,
                                         "wp_total": 9}},
    {"t": 11, "kind": "telemetry", "run": "running", "wp_index": 4},
    {"t": 12, "kind": "command", "path": "/api/cmd/start"}], pad_kb=200)
put("asv_20261103-000000.jsonl", [{"t": 1, "kind": "session_start"}])     # this one is OURS - never the previous
p = A._prev_session(PD, os.path.join(PD, "asv_20261103-000000.jsonl"))
check("24b. prev is the newest OTHER recording, read from its tail: it did not end clean, and it was running survey "
      "at waypoint 4 of 9 (the trace after the snapshot is the newer word)",
      lambda: p["name"] == "asv_20261102-000000.jsonl" and p["ended_clean"] is False and p["last_kind"] == "command"
      and p["run"] == "running" and p["armed"] is True and p["behavior"] == "survey" and p["wp_index"] == 4
      and p["wp_total"] == 9 and p["last_t"] == 12,
      lambda: json.dumps(p))
os.remove(os.path.join(PD, "asv_20261102-000000.jsonl"))
p2 = A._prev_session(PD, os.path.join(PD, "asv_20261103-000000.jsonl"))
check("24c. a recording that ended with session_end ended clean",
      lambda: p2["name"] == "asv_20261101-000000.jsonl" and p2["ended_clean"] is True, lambda: json.dumps(p2))
_reads = []
_real_open = open


def _counting_open(path, mode="r", *a, **k):
    f = _real_open(path, mode, *a, **k)
    if "b" in mode and str(path).endswith(".jsonl"):
        real_read = f.read

        def read_(n=-1):
            data = real_read(n)
            _reads.append(len(data))
            return data
        f.read = read_
    return f


put("asv_20261102-000000.jsonl", [{"t": 1, "kind": "x"}], pad_kb=300)
import builtins  # noqa: E402
builtins.open = _counting_open
try:
    A._prev_session(PD, os.path.join(PD, "asv_20261103-000000.jsonl"))
finally:
    builtins.open = _real_open
check("24d. a 300 KB recording is read from its last 64 KB, never whole",
      lambda: _reads and max(_reads) <= A.PREV_TAIL_B, lambda: "reads=%s" % _reads)

# _git_ident: a worktree's .git is a FILE
GD = STATE.path("git")
APPD = os.path.join(GD, "app")
os.makedirs(os.path.join(GD, "main", ".git", "worktrees", "wt"))
os.makedirs(os.path.join(GD, "main", ".git", "refs", "heads", "feat"))
os.makedirs(APPD)
SHA = "0123456789abcdef0123456789abcdef01234567"
with open(os.path.join(APPD, ".git"), "w") as f:
    f.write("gitdir: ../main/.git/worktrees/wt\n")
with open(os.path.join(GD, "main", ".git", "worktrees", "wt", "HEAD"), "w") as f:
    f.write("ref: refs/heads/feat/mission-record\n")
with open(os.path.join(GD, "main", ".git", "worktrees", "wt", "commondir"), "w") as f:
    f.write("../..\n")
with open(os.path.join(GD, "main", ".git", "refs", "heads", "feat", "mission-record"), "w") as f:
    f.write(SHA + "\n")
g1 = A._git_ident(APPD)
os.remove(os.path.join(GD, "main", ".git", "refs", "heads", "feat", "mission-record"))
with open(os.path.join(GD, "main", ".git", "packed-refs"), "w") as f:
    f.write("# pack-refs with: peeled fully-peeled sorted\n%s refs/heads/feat/mission-record\n" % SHA.replace("0", "f"))
g2 = A._git_ident(APPD)
with open(os.path.join(GD, "main", ".git", "worktrees", "wt", "HEAD"), "w") as f:
    f.write(SHA + "\n")
g3 = A._git_ident(APPD)
g4 = A._git_ident(os.path.join(GD, "nowhere"))
check("25. git is read BY FILE through a worktree's .git file and its commondir: the loose ref, then packed-refs, then "
      "a detached HEAD - and no checkout is two nulls, never a raise",
      lambda: g1 == {"head": SHA, "branch": "feat/mission-record"}
      and g2 == {"head": SHA.replace("0", "f"), "branch": "feat/mission-record"}
      and g3 == {"head": SHA, "branch": None} and g4 == {"head": None, "branch": None},
      lambda: json.dumps([g1, g2, g3, g4]))

# the manifest's args
_real_log = A.LOG
A.LOG = new_log()
try:
    ns = argparse.Namespace(sim=True, vcu=None, state_dir=STATE.dir, ais="http://bob:secretpw@127.0.0.1:8790",
                            no_ais_service=True, no_tide_window=False, no_weather_window=True, port=8795,
                            aisstream_key="AKEY", password="PW", api_token="TOK", client_secret="CS", vessel="x")
    man = A._manifest(ns)
finally:
    A.LOG = _real_log
mj = json.dumps(man)
check("26. the manifest names every flag EXCEPT any whose name reads as a secret, and an AIS base without its "
      "user:password",
      lambda: man["args"]["port"] == 8795 and man["args"]["vessel"] == "x"
      and not (set(man["args"]) & {"aisstream_key", "password", "api_token", "client_secret"})
      and "AKEY" not in mj and "secretpw" not in mj and "TOK" not in mj and man["args"]["ais"] == "http://127.0.0.1:8790",
      lambda: json.dumps(man["args"])[:300])
check("26b. ... its mode, zone, runtime and build",
      lambda: man["mode"] == "sim" and isinstance(man["tz"]["utc_offset_s"], int) and man["tz"]["name"]
      and man["runtime"]["python"].count(".") == 2 and len(man["build"]["fingerprint"] or "") >= 8
      and man["station_windows"] == {"tide": True, "weather": False},
      lambda: json.dumps({k: man[k] for k in ("mode", "tz", "runtime", "build", "station_windows")}))

# /api/logs labels
LD = STATE.path("labels")
os.makedirs(LD)
lp = os.path.join(LD, "asv_20261104-120000.jsonl")
with open(lp, "w", encoding="utf-8") as f:
    for r in ({"t": 1, "kind": "session_start", "port": 8795, "argv": ["--sim", "--port", "8795"]},
              {"t": 2, "kind": "manifest", "mode": "sim"},
              {"t": 3, "kind": "port", "port": {"id": "newcastle", "name": "New Castle"}},
              {"t": 4, "kind": "vessel", "id": "ben_cworker4"}):
        f.write(json.dumps(r) + "\n")
with open(lp, "rb") as fi, gzip.open(lp + ".gz", "wb") as fo:
    shutil.copyfileobj(fi, fo)
lp2 = os.path.join(LD, "asv_20261001-120000.jsonl")
with open(lp2, "w", encoding="utf-8") as f:
    f.write(json.dumps({"t": 1, "kind": "session_start", "port": 8791,
                        "argv": ["--vcu", "10.0.0.5", "--vessel", "drix08", "--base", "durham"]}) + "\n")
st1, st2, st3 = os.stat(lp), os.stat(lp + ".gz"), os.stat(lp2)
lab1 = A._log_label(lp, os.path.basename(lp), st1.st_size, st1.st_mtime)
lab2 = A._log_label(lp + ".gz", os.path.basename(lp) + ".gz", st2.st_size, st2.st_mtime)
lab3 = A._log_label(lp2, os.path.basename(lp2), st3.st_size, st3.st_mtime)
check("27. a recording is labeled from its head - port, mode, vessel, base - plain or .gz",
      lambda: lab1 == {"port": 8795, "mode": "sim", "vessel": "ben_cworker4", "base": "New Castle"} and lab2 == lab1,
      lambda: json.dumps([lab1, lab2]))
check("27b. an OLD recording (session_start alone) is labeled from its argv",
      lambda: lab3["mode"] == "real" and lab3["vessel"] == "drix08" and lab3["base"] == "durham" and lab3["port"] == 8791,
      lambda: json.dumps(lab3))

# WHERE IT RAN (2026-11-10): his overnight Eastport survey was listed under the base the console BOOTED at ("pago pago")
# and taken for a recording that did not exist
PE = lambda i, n: {"id": i, "name": n}  # noqa: E731
pl_a = A.places_label([{"id": "pago", "name": "Pago Pago", "runs": 0}, {"id": "east", "name": "Eastport, ME", "runs": 1}])
pl_b = A.places_label([{"id": "cas", "name": "Castine", "runs": 0}, {"id": "nc", "name": "New Castle", "runs": 0}])
pl_c = A.places_label([{"id": "cas", "name": "Castine", "runs": 2}, {"id": "x", "name": "Durham", "runs": 0},
                       {"id": "nc", "name": "New Castle", "runs": 3}, {"id": "nc2", "name": "New Castle", "runs": 1}])
check("27c. places_label: the bases a run started at, in order; with no run, every base it was at; a name once in a row",
      lambda: pl_a == ["Eastport, ME"] and pl_b == ["Castine", "New Castle"] and pl_c == ["Castine", "New Castle"]
      and A.places_label(None) == [] and A.places_label([{"id": None, "name": None, "runs": 1}, 7]) == [],
      lambda: json.dumps([pl_a, pl_b, pl_c]))

lgp = new_log()
lgp.event("session_start", port=8795)
lgp.event("manifest", mode="sim")
lgp.event("port", why="boot", port=PE("pago", "Pago Pago"))
lgp.event("port", why="switch", port=PE("east", "Eastport, ME"))
lgp.event("port", why="reload", port=PE("east", "Eastport, ME"))       # the base in force again: not a second visit
lgp._write("run_start", {"run_id": "r1", "run_seq": 1})
lgp._write("run_start", {"run_id": "r2", "run_seq": 2})
lgp.event("port", why="switch", port={"id": None})                       # a record naming no base moves nothing
pls = lgp.places()
if pls:
    pls[0]["runs"] = 99                                                # a COPY: the logger's own is untouched
check("27d. a SessionLogger keeps where its session ran from the records it WRITES: a switch is a second base, the same "
      "base again is not, a run counts against the base in force",
      lambda: [(p["id"], p["runs"]) for p in lgp.places()] == [("pago", 0), ("east", 2)]
      and A.places_label(lgp.places()) == ["Eastport, ME"],
      lambda: json.dumps(lgp.places()))
lgp.event("port", why="switch", port=PE("nc", "New Castle"))           # a switch AFTER a run: only the summary has it
lgp._write("run_start", {"run_id": "r3", "run_seq": 3})
lgp.event("session_summary", places=lgp.places())
lgp.event("session_end")
lgp.close()
_sum_name = os.path.basename(lgp.path)
_sum_dir = os.path.dirname(lgp.path)
st_s = os.stat(lgp.path)
_pt = A._prev_tail(_sum_dir, _sum_name)
check("27e. a recording with a `session_summary` in its tail is listed under the bases its runs started at - and still "
      "ends clean (session_end is its last record)",
      lambda: A._summary_places(lgp.path) == lgp.places() and A._log_places(lgp.path, _sum_name, st_s.st_size,
                                                                           st_s.st_mtime) == ["Eastport, ME", "New Castle"]
      and _pt["ended_clean"] is True and _pt["last_kind"] == "session_end",
      lambda: json.dumps([A._summary_places(lgp.path), _pt.get("last_kind")]))

# one that did NOT end cleanly (or predates the summary): read from its head, as far as its first run - a switch AFTER
# that run is not read (the named residual), and filler bigger than one chunk sits between
LP2 = STATE.path("labels2")
os.makedirs(LP2)
hp = os.path.join(LP2, "asv_20261109-194359.jsonl")
_fill = json.dumps({"t": 5, "kind": "telemetry", "pad": "x" * 900}) + "\n"
with open(hp, "w", encoding="utf-8") as f:
    for r in ({"t": 1, "kind": "session_start", "port": 8791}, {"t": 2, "kind": "manifest", "mode": "sim"},
              {"t": 3, "kind": "port", "why": "boot", "port": PE("pago", "pago pago")}):
        f.write(json.dumps(r) + "\n")
    f.write(_fill * 60)
    # the switch STRADDLES the first chunk's end (a line cut by a read is carried into the next)
    _sw = json.dumps({"t": 4, "kind": "port", "why": "switch", "port": PE("east", "Eastport, ME")}) + "\n"
    _gap = A.LOG_PLACES_CHUNK_B - 30 - f.tell()
    f.write(json.dumps({"t": 5, "kind": "telemetry", "pad": "y" * (_gap - 45)}).ljust(_gap - 1) + "\n")
    f.write(_sw)
    f.write(_fill * 100)
    f.write(json.dumps({"t": 6, "kind": "run_start", "run_id": "r1"}) + "\n")
    f.write(json.dumps({"t": 7, "kind": "port", "why": "switch", "port": PE("nc", "New Castle")}) + "\n")
    f.write(json.dumps({"t": 8, "kind": "run_start", "run_id": "r2"}) + "\n")
with open(hp, "rb") as fi, gzip.open(hp + ".gz", "wb") as fo:
    shutil.copyfileobj(fi, fo)
with open(hp, "rb") as f:
    _hb = f.read()
_sw_at = _hb.rfind(b"\n", 0, _hb.find(b'"kind": "port", "why": "switch"')) + 1
_sw_end = _hb.find(b"\n", _sw_at)
st_h, st_hz = os.stat(hp), os.stat(hp + ".gz")
hp_l = A._log_places(hp, os.path.basename(hp), st_h.st_size, st_h.st_mtime)
hp_z = A._log_places(hp + ".gz", os.path.basename(hp) + ".gz", st_hz.st_size, st_hz.st_mtime)
check("27f. without a summary, a recording is named by where its FIRST run started (read from its head, past the first "
      "chunk; plain or .gz) - not the base it booted at",
      lambda: _sw_at < A.LOG_PLACES_CHUNK_B < _sw_end
      and A._summary_places(hp) is None and hp_l == ["Eastport, ME"] and hp_z == ["Eastport, ME"]
      and A._log_label(hp, os.path.basename(hp), st_h.st_size, st_h.st_mtime)["base"] == "pago pago",
      lambda: json.dumps([hp_l, hp_z, _sw_at, _sw_end]))

np_ = os.path.join(LP2, "asv_20261108-082442.jsonl")
with open(np_, "w", encoding="utf-8") as f:
    for r in ({"t": 1, "kind": "session_start", "port": 8791}, {"t": 2, "kind": "manifest", "mode": "sim"},
              {"t": 3, "kind": "port", "why": "boot", "port": PE("nc", "New Castle, NH")},
              {"t": 4, "kind": "port", "why": "switch", "port": PE("pago", "pago pago")}):
        f.write(json.dumps(r) + "\n")
op_ = os.path.join(LP2, "asv_20261001-120000.jsonl")
with open(op_, "w", encoding="utf-8") as f:
    f.write(json.dumps({"t": 1, "kind": "session_start", "port": 8791, "argv": ["--base", "durham"]}) + "\n")
    f.write(json.dumps({"t": 2, "kind": "port", "why": "boot", "port": PE("x", "would-be")}) + "\n")
_np, _op = os.stat(np_), os.stat(op_)
np_l = A._log_places(np_, os.path.basename(np_), _np.st_size, _np.st_mtime)
op_l = A._log_places(op_, os.path.basename(op_), _op.st_size, _op.st_mtime)
check("27g. a session with no run is named by every base it was at; one older than the manifest record by none (its "
      "`base` names it, as before)",
      lambda: np_l == ["New Castle, NH", "pago pago"] and op_l == [] and A._head_places(op_, False) == [],
      lambda: json.dumps([np_l, op_l]))

_real_log_dir, _real_LOG = A.LOG_DIR, A.LOG
lg_live = new_log()
lg_live.event("manifest", mode="sim")
lg_live.event("port", why="boot", port=PE("pago", "pago pago"))
lg_live.event("port", why="switch", port=PE("east", "Eastport, ME"))
lg_live._write("run_start", {"run_id": "r1"})
shutil.copyfile(hp, os.path.join(os.path.dirname(lg_live.path), os.path.basename(hp)))
try:
    A.LOG_DIR, A.LOG = os.path.dirname(lg_live.path), lg_live
    rows_l = {r["name"]: r for r in A.list_logs()}
    lg_live.event("port", why="switch", port=PE("nc", "New Castle"))
    lg_live._write("run_start", {"run_id": "r2"})
    rows_l2 = {r["name"]: r for r in A.list_logs()}
finally:
    A.LOG_DIR, A.LOG = _real_log_dir, _real_LOG
_ln = os.path.basename(lg_live.path)
check("27h. /api/logs rows carry `places`: the LIVE recording's from its own logger (a switch shows at once), every "
      "other's from its file",
      lambda: rows_l[_ln]["places"] == ["Eastport, ME"] and rows_l2[_ln]["places"] == ["Eastport, ME", "New Castle"]
      and rows_l[os.path.basename(hp)]["places"] == ["Eastport, ME"] and rows_l[_ln]["base"] == "pago pago",
      lambda: json.dumps([rows_l.get(_ln, {}).get("places"), rows_l2.get(_ln, {}).get("places")]))
_msrc = inspect.getsource(A.main)
_i_sum, _i_end = _msrc.find('LOG.event("session_summary", places=LOG.places())'), _msrc.rfind('LOG.event("session_end")')
check("27i. the console writes its session_summary at shutdown, BEFORE its session_end (so the tail still ends clean)",
      lambda: 0 < _i_sum < _i_end, lambda: "summary at %d, session_end at %d" % (_i_sum, _i_end))
check("28. /api/logevent is a quiet post: the client record is the record, not a command line beside it",
      lambda: "/api/logevent" in A.LOG_QUIET_POSTS and "/api/enc/corridor" in A.LOG_QUIET_POSTS)
check("29. a number that is not finite (or is a bool) is not a number in the record",
      lambda: A._rec_num(float("nan"), 2) is None and A._rec_num(float("inf"), 2) is None and A._rec_num(True, 2) is None
      and A._rec_num(1.23456, 2) == 1.23 and A._rec_num("3", 2) is None)

# the AIS service's own record of WHEN
reg = S.Registry()
t_heard1 = time.time()
reg.update(351759000, "aisstream", lat=42.1, lon=-70.1, sog=5.0, cog=10.0)
time.sleep(0.4)
v1 = reg.snapshot()[0]
t_heard2 = time.time()
reg.update(351759000, "aisstream", lat=42.101, lon=-70.1, sog=5.0, cog=10.0)
v2 = reg.snapshot()[0]
check("30. the AIS service says WHEN it heard her (obs_t: the report's epoch, not the moment it was asked) and, from "
      "her second report, her reporting interval",
      lambda: abs(v1["obs_t"] - t_heard1) < 0.2 and "pos_gap" not in v1 and abs(v2["obs_t"] - t_heard2) < 0.2
      and 0.3 <= v2["pos_gap"] <= 5.0,
      lambda: json.dumps([t_heard1, {k: v1.get(k) for k in ("obs_t", "pos_gap")}, t_heard2,
                          {k: v2.get(k) for k in ("obs_t", "pos_gap")}]))

# the buoys' own rows (A9 extra): every column the NDBC row had, its own time, the station's position
_ndbc_t = time.strftime("%Y %m %d %H %M", time.gmtime(time.time() - 1800))
_real_st, _real_http = A._load_ndbc_stations, A._env_http_get
A._load_ndbc_stations = lambda timeout=30.0: [{"id": "44013", "lat": 42.35, "lon": -70.65},
                                              {"id": "BUZM3", "lat": 41.40, "lon": -71.03}]


def _fake_ndbc(url, timeout=15.0):
    return ("#YY  MM DD hh mm WDIR WSPD GST  WVHT   DPD   APD MWD   PRES  ATMP  WTMP  DEWP  VIS\n"
            "#yr  mo dy hr mn degT m/s  m/s     m   sec   sec degT   hPa  degC  degC  degC  nmi\n"
            "%s 240  6.0  8.0   0.8   6.0   4.5 230 1012.3  10.5  12.25   5.0   MM\n" % _ndbc_t)


A._env_http_get = _fake_ndbc
try:
    fenv = A.fetch_environment(42.3, -70.7)
finally:
    A._load_ndbc_stations, A._env_http_get = _real_st, _real_http
b0 = (fenv.get("buoys") or [{}])[0]
with A.ENV._lock:
    _real_last = A.ENV._last
    A.ENV._last = fenv
try:
    env_buoys, env_snap = A.ENV.buoys(), A.ENV.snapshot()
finally:
    with A.ENV._lock:
        A.ENV._last = _real_last
check("31. each buoy's OWN row rides the reading for the record: its id, distance, position and time, and every NDBC "
      "column it had (pressure, air, water, dew point) - a missing one left out, not zero - and never the 4 Hz frame",
      lambda: [b["id"] for b in fenv["buoys"]] == ["44013", "BUZM3"] and b0["lat"] == 42.35 and b0["PRES"] == 1012.3
      and b0["ATMP"] == 10.5 and b0["WTMP"] == 12.25 and b0["DEWP"] == 5.0 and "VIS" not in b0
      and abs(b0["t"] - (time.time() - 1800)) < 120 and env_buoys == fenv["buoys"] and "buoys" not in env_snap
      and env_snap.get("obs_t") == fenv.get("obs_t"),
      lambda: json.dumps([fenv.get("buoys"), sorted(env_snap)])[:300])

# the water's and the current's own times, as epochs (A9)
with A.WATER._lock:
    _wl = A.WATER._last
    A.WATER._last = {"ok": True, "offset_m": 0.4, "t": "2026-11-05 14:30", "station": "8423898"}
with A.CURRENTS._lock:
    _cl, _ca = A.CURRENTS._last, A.CURRENTS._sampled_at
    A.CURRENTS._last, A.CURRENTS._sampled_at = {"ok": True, "speed_kn": 0.5, "set_deg": 90.0}, 1793900000.04
try:
    wsnap, csnap = A.WATER.snapshot(), A.CURRENTS.snapshot()
finally:
    with A.WATER._lock:
        A.WATER._last = _wl
    with A.CURRENTS._lock:
        A.CURRENTS._last, A.CURRENTS._sampled_at = _cl, _ca
import calendar  # noqa: E402
check("32. the water level carries its station's own time as an epoch (CO-OPS' time is GMT), the current the epoch it "
      "was computed",
      lambda: wsnap["obs_t"] == calendar.timegm(time.strptime("2026-11-05 14:30", "%Y-%m-%d %H:%M"))
      and csnap["sampled_t"] == 1793900000.0,
      lambda: json.dumps([wsnap.get("obs_t"), csnap.get("sampled_t")]))

# ══ THE REVIEW OF 2026-11-05 (one check per repair; each killed by its mutant) ════════════════════════════════════════
# R1. the recorder's plan read is PURE: it refreshes neither _MISSION_CACHE nor _PLAN_COMPLETION
import inspect as _insp  # noqa: E402
with open(A.MISSION_PATH, "w", encoding="utf-8") as f:
    json.dump({"rev": 3, "waypoints": [], "completion": "loiter", "arrival_radius_m": 12.0}, f)
_sent = {"sentinel": True}
_c0, _p0 = A._MISSION_CACHE, A._PLAN_COMPLETION
A._MISSION_CACHE, A._PLAN_COMPLETION = _sent, "repeat"
try:
    pure = A.load_mission(refresh=False)
    pure_cache, pure_pc = A._MISSION_CACHE, A._PLAN_COMPLETION
    full = A.load_mission()
    full_cache_rev, full_pc = A._MISSION_CACHE.get("rev"), A._PLAN_COMPLETION
finally:
    A._MISSION_CACHE, A._PLAN_COMPLETION = _c0, _p0
    os.remove(A.MISSION_PATH)
_main_src = _insp.getsource(A.main)
check("R1. the session record's plan read is a PURE read - it leaves the console's command caches (end-of-plan, the "
      "radii) alone; a reload still refreshes them - and main() hands the logger THAT read, not load_mission",
      lambda: pure["completion"] == "loiter" and pure["rev"] == 3 and pure_cache is _sent and pure_pc == "repeat"
      and full_cache_rev == 3 and full_pc == "loiter"
      and "LOG.mission_source = lambda: load_mission(refresh=False)" in _main_src
      and "LOG.mission_source = load_mission\n" not in _main_src.replace("\r\n", "\n"),
      lambda: json.dumps([pure.get("completion"), pure_pc, full_cache_rev, full_pc]))

# R2. the command line as the record carries it
red = A._argv_redacted(["--sim", "--ais", "http://bob:secretpw@aishost:8790", "--aisstream-key", "KEYVALUE",
                        "--api-token=TOKVAL", "--vcu", "joe:pw2@10.0.0.5", "--port", "8795", "--ais-nmea", "udp:10110"])
check("R2. session_start's argv is REDACTED by the manifest's own rule: a secret-named flag's value (spaced or =), a URL's "
      "user:password, a scheme-less user:pw@host - and main() writes it through _argv_redacted",
      lambda: red == ["--sim", "--ais", "http://aishost:8790", "--aisstream-key", "<redacted>", "--api-token=<redacted>",
                      "--vcu", "10.0.0.5", "--port", "8795", "--ais-nmea", "udp:10110"]
      and "argv=_argv_redacted(sys.argv[1:])" in _main_src and "argv=sys.argv[1:]" not in _main_src,
      lambda: json.dumps(red))

# R3. paths in the manifest name no account
_home = os.path.expanduser("~")
pr = [A._path_for_record(os.path.join(A.APP_DIR, "mission.json")),
      A._path_for_record(os.path.join(_home, "AppData", "x.log")),
      A._path_for_record(A.APP_DIR, app_rel=False), A._path_for_record(None),
      # the temp folder as Windows hands it over: in its 8.3 form (C:\Users\<NAME~1>\...) - the short name is the account too
      A._path_for_record(os.path.join(tempfile.gettempdir(), "x.jsonl"))]
_tmp_home = os.path.normcase(os.path.realpath(tempfile.gettempdir())).startswith(os.path.normcase(os.path.realpath(_home)))
check("R3. a recorded path is <app>/... under the app, ~/... under the home folder - never the account name, nor its 8.3 "
      "short form (the temp folder's, as Windows hands it over)",
      lambda: pr[0] == "<app>/mission.json" and pr[1] == "~/AppData/x.log" and _home not in json.dumps(pr)
      and (pr[2].startswith("~/") or not os.path.normcase(A.APP_DIR).startswith(os.path.normcase(_home))) and pr[3] is None
      and ((pr[4].startswith("~/") and "~1" not in pr[4]) or not _tmp_home),
      lambda: json.dumps(pr) + " temp under home: %s" % _tmp_home)

# R4. the previous session is THIS console's own, by its port
PP = STATE.path("prev_port")
os.makedirs(PP)


def putp(name, recs):
    with open(os.path.join(PP, name), "w", encoding="utf-8") as f:
        for r in recs:
            f.write(json.dumps(r) + "\n")


putp("asv_20261101-100000.jsonl", [{"t": 1, "kind": "session_start", "port": 8791},
                                   {"t": 9, "kind": "state", "state": {"run": "running", "armed": True}}])
putp("asv_20261101-110000.jsonl", [{"t": 1, "kind": "session_start", "port": 8796}, {"t": 2, "kind": "session_end"}])
putp("asv_20261101-120000.jsonl", [{"t": 1, "kind": "session_start", "port": 8791},
                                   {"t": 2, "kind": "session_end", "reason": "port in use"}])
putp("asv_20261101-130000.jsonl", [{"t": 1, "kind": "session_start"}])        # this one is OURS
pp = A._prev_session(PP, os.path.join(PP, "asv_20261101-130000.jsonl"), port=8791)
pany = A._prev_session(PP, os.path.join(PP, "asv_20261101-130000.jsonl"))
check("R4. prev is the newest recording of THIS console's port - not a verification console's newer one on 8796, not "
      "one that never served (the port was in use) - so the crashed, armed run is the one named",
      lambda: pp["name"] == "asv_20261101-100000.jsonl" and pp["ended_clean"] is False and pp["run"] == "running"
      and "never_served" not in pp and pany["name"] == "asv_20261101-120000.jsonl"
      # ... and the manifest asks it BY ITS PORT (a port=None there is every console's newest again)
      and 'port=getattr(args, "port", None))' in _insp.getsource(A._manifest),
      lambda: json.dumps([pp, pany and pany.get("name")]))

# R5. runs: monotonic in run_seq
LRM = new_log()
for fr_ in (frame("running", 5), frame("running", 6), frame("running", 5), frame("running", 6)):
    LRM.state(fr_)
rs5, re5 = kinds(LRM, "run_start"), kinds(LRM, "run_end")
LRM2 = new_log()
for fr_ in (frame("running", 7), frame("stopped", 7), frame("running", 7), frame("idle", 7)):
    LRM2.state(fr_)
rs7, re7 = kinds(LRM2, "run_start"), kinds(LRM2, "run_end")
check("R5. a LATE frame (built before a Go-To bumped run_seq, logged after it) does not end the new run nor open the old "
      "one again; and a run that has ended never re-opens on a late 'running' frame of its own run_seq",
      lambda: [r["run_seq"] for r in rs5] == [5, 6] and len(re5) == 1 and re5[0]["run_seq"] == 5
      and re5[0]["next_run_seq"] == 6 and [r["run_seq"] for r in rs7] == [7] and len(re7) == 1
      and re7[0]["run"] == "stopped",
      lambda: json.dumps([[r["run_seq"] for r in rs5], [[r["run_seq"], r["run"]] for r in re5],
                          [r["run_seq"] for r in rs7], [[r["run_seq"], r["run"]] for r in re7]]))

# R6. a trigger inside an open window extends it, capped
LIX = new_log()
feed_frames(LIX, T0, T0 + 5)
LIX._incident_frame(frame("running", 1, estop=True, autonomy="e-stop"), T0 + 5)
feed_frames(LIX, T0 + 5.25, T0 + 33, estop=True, autonomy="e-stop")
LIX._incident_frame(frame("running", 1, estop=True, autonomy="e-stop", loop_fault={"e": 1}), T0 + 33)
until_after = LIX._inc and LIX._inc["until"]
feed_frames(LIX, T0 + 33.25, T0 + 62.9, estop=True, autonomy="e-stop", loop_fault={"e": 1})
still_open = LIX._inc is not None
LIX._incident_frame(frame("running", 1, estop=True, autonomy="e-stop", loop_fault={"e": 1}), T0 + 63.1)
until(lambda: len(kinds(LIX, "incident")) == 1, 3.0)
ix = kinds(LIX, "incident")
LCAP = new_log()
with LCAP._inc_lock:
    LCAP._incident_open("a", T0)
    for k in range(1, 8):
        LCAP._incident_open("b%d" % k, T0 + 28 * k)
cap_until = LCAP._inc["until"]
check("R6. a trigger INSIDE the window gives it the post-window again (an e-stop then a loop fault 28 s on: frames to 30 s "
      "after the second) - capped INCIDENT_MAX_POST_S after the first, so a storm cannot hold it open",
      lambda: abs(until_after - (T0 + 63)) < 1e-6 and still_open and len(ix) == 1
      and ix[0]["frames"][-1][0] - (T0 + 33) >= 29.9 and abs(cap_until - (T0 + A.SessionLogger.INCIDENT_MAX_POST_S)) < 1e-6,
      lambda: json.dumps({"until": until_after and until_after - T0, "open": still_open, "n": len(ix),
                          "last": ix[0]["frames"][-1][0] - T0 if ix else None, "cap": cap_until - T0}))

# R7. a wake re-seeds the edges, and the ring starts empty
LW = new_log()
feed_frames(LW, T0, T0 + 10)
LW.quiet_on("home and idle")
# a frame thread that passed the quiet test before the flag went up, and appended after quiet_on cleared the ring
LW._ring.append([round(T0 + 10.1, 3)] + [None] * 16)
LW.wake("planned")
LW._incident_frame(frame("running", 1, estop=True, autonomy="e-stop"), T0 + 30)    # latched while the log was quiet
seeded_quiet = LW._inc is None
feed_frames(LW, T0 + 30.25, T0 + 35)
LW._incident_frame(frame("running", 1, estop=True, autonomy="e-stop"), T0 + 35)    # a REAL edge after the wake
w_inc = LW._inc
check("R7. after a wake the first frame SEEDS the edges - an E-STOP latched while quiet fires no incident at the wake - "
      "and an incident after the wake holds no frame from before the gap (not even one a frame thread appended after "
      "quiet_on cleared the ring: the wake clears it again)",
      lambda: seeded_quiet and w_inc is not None and w_inc["first"] == "estop"
      and min(f[0] for f in w_inc["pre"]) >= T0 + 30,
      lambda: "seeded=%s first=%s pre_from=%s" % (seeded_quiet, w_inc and w_inc["first"],
                                                  w_inc and min(f[0] for f in w_inc["pre"]) - T0))

# R8. the AIS record asks with the floor the page's poll asked for, while it is fresh
_asked = []
_real_traffic = A.ais_traffic
A.ais_traffic = lambda lat, lon, held=(), floor_km=0.0: (_asked.append(floor_km) or {"ok": True, "vessels": []})
try:
    _was = list(A._AIS_FLOOR_ASKED)
    A._AIS_FLOOR_ASKED[:] = [27.78, time.monotonic()]
    A._ais_targets(dict(BOAT))
    A._AIS_FLOOR_ASKED[:] = [27.78, time.monotonic() - A.AIS_FLOOR_TTL_S - 1]
    A._ais_targets(dict(BOAT))
    A._AIS_FLOOR_ASKED[:] = [0.0, time.monotonic()]
    A._ais_targets(dict(BOAT))
finally:
    A.ais_traffic = _real_traffic
    A._AIS_FLOOR_ASKED[:] = _was
_get_src = _insp.getsource(A.Handler._serve_ais)
check("R8. on a passage the record asks with the page's floor (15 nm), not the 5 nm setting - while the poll that asked "
      "is fresh (AIS_FLOOR_TTL_S); a stale ask, or none, is the setting again; and /api/ais is what remembers it",
      lambda: _asked == [27.78, 0.0, 0.0] and "_AIS_FLOOR_ASKED[:] = [floor_km, time.monotonic()]" in _get_src,
      lambda: json.dumps(_asked))


# R8b. THE REAL HANDLER, on a fake request: only a poll that ASKS a floor writes it (2026-11-11). Every poll wrote it, so
# a tab polling with none - another chart tab, the page's reads along its route, a stale tab on the port - canceled the
# passage page's ask, and tests/mission_record.py 11b recorded 5 nm under a stray tab's 5 s poll.
class _AisReq:
    def __init__(self, q):
        self.path = "/api/ais?" + q
        self.sent = None

    def _send(self, code, body, ctype="application/json"):
        self.sent = code


_slots = []
A.ais_traffic = lambda lat, lon, held=(), floor_km=0.0: {"ok": True, "vessels": [], "floor_km": floor_km}
try:
    _was = list(A._AIS_FLOOR_ASKED)
    A._AIS_FLOOR_ASKED[:] = [0.0, None]
    for _q in ("center=42,-70&floor_km=27.78", "center=42,-70", "center=42,-70&floor_km=0", "center=42,-70&floor_km=x",
               "center=42,-70&floor_km=nan", "center=42,-70&floor_km=-5", "floor_km=30"):
        _rq = _AisReq(_q)
        A.Handler._serve_ais(_rq)
        _slots.append([_rq.sent, A._AIS_FLOOR_ASKED[0], _q])
    _in_force = A._ais_floor_in_force()
finally:
    A.ais_traffic = _real_traffic
    A._AIS_FLOOR_ASKED[:] = _was
check("R8b. the real /api/ais handler writes the floor only when a poll asks one: a poll with none, 0, garbage, NaN or a "
      "negative leaves the ask standing (and in force for the record); a poll with no center still asks",
      lambda: [s[0] for s in _slots] == [200] * 7 and [s[1] for s in _slots] == [27.78] * 6 + [30.0]
      and _in_force == 30.0,
      lambda: json.dumps(_slots))

# R9. the real _env_extra: where the stations are, from what is in memory
class _Tab:
    def __init__(self, i):
        self.id, self.name, self.lat, self.lon, self.bin = i, "Piscataqua", 43.07, -70.70, 3


class _Src:
    def tables(self):
        return [_Tab("PIR0101")]


with A._water_stations_lock:
    _ws = A._water_stations
    A._water_stations = [{"id": "8423898", "name": "Fort Point", "lat": 43.071, "lng": -70.711}]
_had_src = hasattr(A.CURRENTS, "_sources")
_real_src = getattr(A.CURRENTS, "_sources", None)
A.CURRENTS._sources = _Src()
try:
    xr = A._env_extra({"water": {"ok": True, "station": "8423898"},
                       "current": {"ok": True, "stations": [["PIR0101", 0.4], ["NOPE", 1.0]]}})
except Exception as _e:         # noqa: BLE001 - what the recorder would have swallowed into every env record, said here
    xr = {"error": "%s: %s" % (type(_e).__name__, _e)}
finally:
    with A._water_stations_lock:
        A._water_stations = _ws
    if _had_src:
        A.CURRENTS._sources = _real_src
    else:
        del A.CURRENTS._sources
check("R9. the REAL env extra places the stations from what is in memory: the water station's name and position (its "
      "`lng`), the current table's position and bin - and the buoys' own rows (a list)",
      lambda: "error" not in xr and xr["stations"]["water"] == [{"id": "8423898", "name": "Fort Point", "lat": 43.071, "lon": -70.711}]
      and xr["stations"]["current"] == [{"id": "PIR0101", "name": "Piscataqua", "lat": 43.07, "lon": -70.70, "bin": 3}]
      and isinstance(xr["buoys"], list),
      lambda: json.dumps(xr)[:300])

# R10. the two ends of one timing rule: playback calls a quiet sensor stale only past the console's own heartbeat
import re as _re  # noqa: E402
with open(os.path.join(os.path.dirname(os.path.abspath(A.__file__)), "static", "playback.html"), encoding="utf-8") as f:
    _pb = f.read()
_m = _re.search(r"^const TARGETS_STALE_S = (\d+(?:\.\d+)?);", _pb, _re.M)
check("R10. playback's TARGETS_STALE_S outlasts the console's TARGETS_HEARTBEAT_S + TARGETS_LOG_S (a sensor holding "
      "nothing writes once a heartbeat, asked every TARGETS_LOG_S) - read from BOTH files",
      lambda: _m and float(_m.group(1)) > A.TARGETS_HEARTBEAT_S + A.TARGETS_LOG_S,
      lambda: "stale %s vs heartbeat %s + log %s" % (_m and _m.group(1), A.TARGETS_HEARTBEAT_S, A.TARGETS_LOG_S))

_strict_bad = []
for _lg in _LOGS:
    try:
        read(_lg, strict=True)
    except ValueError as e:
        _strict_bad.append("%s: %s" % (os.path.basename(os.path.dirname(_lg.path)), e))
check("33. every recording this suite wrote parses STRICTLY - no NaN, no Infinity in any line of any of them",
      lambda: not _strict_bad and len(_LOGS) >= 14, lambda: "%d files; %s" % (len(_LOGS), _strict_bad[:3]))

_close_logs()
print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
