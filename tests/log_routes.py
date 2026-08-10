"""tests/log_routes.py - /api/logevent, /api/logs and /api/log, and THE THIRD MEMBER of
the dropped-connection family.

THE DEFECT (reproduced live, then fixed): /api/logevent unpacked the CLIENT-supplied
`data` dict into `LOG.event("client:"+kind, **data)` - and event()'s signature is
`(self, kind, **payload)`, so a legal JSON body with a data key named "kind" or "self"
was a TypeError: "got multiple values for argument". The branch sits BEFORE the dispatch
try, so the connection DROPPED with no response and the handler thread died - the exact
waterlevel shape from tests/env_water.py, one commit earlier. WHY 27 SUITES NEVER SAW
IT: every real-console harness passes --no-log, which sets LOG = None and skips the
whole call. THIS suite boots WITH logging on - the masked branch is the subject - and
cleans up the session file it thereby creates.

THE FIX: the handler RENAMES colliding keys (kind -> kind_, self -> self_) rather than
refusing - a session log should swallow an odd field name, not reject the operator's
event over it - and keeps the record shape FLAT, because playback reads these records
and a nesting fix would have been a silent format change (check 2 pins the flat shape).

THE OTHER CONTRACTS (read from the code, asserted live):
  * logevent round-trip: the record lands in the session JSONL as kind "client:<kind>"
    with the data fields FLAT on the payload. Defaults: no kind -> "client_event";
    non-dict data -> wrapped {"value": ...}; kind truncated to 64 chars; a
    non-identifier data key ("a b") is legal JSON and must be recorded, not crash the
    ** call.
  * /api/logs lists the recordings newest-first with name/size/mtime - including the
    console's OWN live session file.
  * /api/log?file=... serves one raw JSONL - and its safe_log_path guard refuses
    traversal: only a bare asv_*.jsonl basename resolves, anything else is a 404. The
    guard predates this suite; it had never been exercised by a test.

    python tests/log_routes.py      # exit 0 = pass, 1 = fail   (stdlib only)

TEETH - seven items RUN: six caught, one survival PREDICTED and earned by its pair
(recorded results; house rules: missing anchor = SKIP, crash scored separately, source
restored byte-for-byte):
  * THE DEFECT RESTORED: the collision rename dropped       -> caught by 3, 8
  * the rename loses its "self" half                        -> caught by 3, 8
  * the flat record shape nested under "data"               -> caught by 2, 3, 4
  * kind truncation dropped                                 -> caught by 4
  * bare-basename check dropped ALONE                       -> SURVIVES, predicted:
    safe_log_path JOINS ON THE BASENAME, so a traversal name still resolves inside
    LOG_DIR and misses. The check is defence in depth behind the join - my first
    docstring predicted "caught by 6" and writing the mutation plan corrected it
    BEFORE the run this time.
  * BOTH layers gone (guard dropped + join uses the raw name) -> caught by 6: the
    seeded shape-perfect file OUTSIDE the dir would be served, and 6 sees its
    sentinel content. The pair is load-bearing; the lone survival is earned.
  * the asv_*.jsonl shape check dropped                     -> caught by 6 via the
    seeded wrong-shape file INSIDE the dir - the only spelling that isolates this
    layer, which is why it is seeded rather than hoped for.
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
    """Returns (code, parsed_json) for JSON endpoints; raises on connection failure."""
    url = "http://127.0.0.1:%d%s" % (port, path)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def get_raw(port, path, timeout=8):
    """Returns (code, text) - /api/log serves NDJSON, not a JSON object."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d%s" % (port, path),
                                    timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def read_session(path):
    """Parse the console's own session JSONL."""
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


print("Log routes — the recorder takes what the client sends, and serves only its own files:")

port = free_port()
LOG_DIR = os.path.join(APP, "logs")
before = set(os.listdir(LOG_DIR)) if os.path.isdir(LOG_DIR) else set()

srvlog = tempfile.TemporaryFile(mode="w+")
# NO --no-log: LOG must exist, because the defect lived in the branch every other
# harness masks. The session file this creates is cleaned up in the finally.
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none",
                         "--port", str(port), "--no-ais-service"],
                        cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
session_file = None
try:
    up = False
    for _ in range(80):
        try:
            code, _b = api(port, "/api/state", timeout=2)
            if code == 200:
                up = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    check("1. a console comes up (logging ON - the branch under test is the one --no-log masks)", up)
    if not up:
        raise SystemExit(1)

    new = sorted(set(os.listdir(LOG_DIR)) - before)
    session_file = new[0] if new else None
    check("1b. ... and it opened a session recording of its own",
          lambda: session_file is not None and session_file.startswith("asv_")
          and session_file.endswith(".jsonl"),
          "session=%s" % session_file)
    spath = os.path.join(LOG_DIR, session_file)

    # 2. THE ROUND-TRIP, and the FLAT shape playback depends on.
    api(port, "/api/logevent", {"kind": "survey_note", "data": {"line": 3, "hdg": 271.5}})
    time.sleep(0.3)                                  # the write is synchronous; be kind anyway
    recs = [r for r in read_session(spath) if r.get("kind") == "client:survey_note"]
    check("2. a client event lands in the session JSONL, its fields FLAT on the record "
          "(playback reads this shape - nesting them would be a silent format change)",
          lambda: len(recs) == 1 and recs[0].get("line") == 3 and recs[0].get("hdg") == 271.5,
          lambda: json.dumps(recs[0] if recs else None)[:80])

    # 3. THE FIX. Before it, this exact body was a TypeError that dropped the connection
    # (raises out of api()) and killed the thread. Now: answered, recorded, renamed.
    try:
        c3, b3 = api(port, "/api/logevent",
                     {"kind": "clash", "data": {"kind": "inner", "self": 7, "ok_field": 1}})
        time.sleep(0.3)
        rec3 = [r for r in read_session(spath) if r.get("kind") == "client:clash"]
        check("3. data keys named 'kind'/'self' are ANSWERED and recorded RENAMED "
              "(kind_/self_), never a dropped connection",
              lambda: c3 == 200 and len(rec3) == 1 and rec3[0].get("kind_") == "inner"
              and rec3[0].get("self_") == 7 and rec3[0].get("ok_field") == 1,
              lambda: json.dumps(rec3[0] if rec3 else None)[:90])
    except Exception as e:
        check("3. data keys named 'kind'/'self' are ANSWERED and recorded RENAMED "
              "(kind_/self_), never a dropped connection",
              False, "connection-level failure: %s" % type(e).__name__)

    # 4. The tolerant edges, each a legal body: no kind, non-dict data, a 200-char kind,
    # a non-identifier data key. All answered, all recorded.
    api(port, "/api/logevent", {"data": "plain words"})
    api(port, "/api/logevent", {"kind": "K" * 200, "data": {"n": 1}})
    api(port, "/api/logevent", {"kind": "spaced", "data": {"a b": 2}})
    time.sleep(0.3)
    all_recs = read_session(spath)
    check("4. the tolerant edges hold: default kind, wrapped non-dict data, kind "
          "truncated to 64, a non-identifier key recorded",
          lambda: any(r.get("kind") == "client:client_event" and r.get("value") == "plain words"
                      for r in all_recs)
          and any(r.get("kind") == "client:" + "K" * 64 for r in all_recs)
          and any(r.get("kind") == "client:spaced" and r.get("a b") == 2 for r in all_recs),
          lambda: "%d records" % len(all_recs))

    # 5. The listing includes the console's own live session, with its vitals.
    _c, logs = api(port, "/api/logs")
    mine = [l for l in logs.get("logs", []) if l.get("name") == session_file]
    check("5. /api/logs lists the live session with name/size/mtime",
          lambda: len(mine) == 1 and (mine[0].get("size") or 0) > 0
          and mine[0].get("mtime"),
          lambda: json.dumps(mine[0] if mine else None)[:70])

    # 6. THE TRAVERSAL GUARD, exercised for the first time since it was written. The
    # guard is LAYERED (bare-basename check, asv_*.jsonl shape check, join-on-basename,
    # isfile) and a spelling that one layer happens to stop cannot test the others - so
    # two targets are SEEDED to make each layer the ONLY thing refusing:
    #   * logs_evil/asv_evil.jsonl EXISTS outside LOG_DIR and matches the shape - only
    #     the bare-basename rule (backed by join-on-basename) refuses "../logs_evil/...".
    #   * logs/not_a_session.txt EXISTS inside LOG_DIR with a clean basename - only the
    #     asv_*.jsonl shape rule refuses it.
    evil_dir = os.path.join(APP, "logs_evil")
    os.makedirs(evil_dir, exist_ok=True)
    with open(os.path.join(evil_dir, "asv_evil.jsonl"), "w", encoding="utf-8") as f:
        f.write('{"secret": "outside the log dir"}\n')
    with open(os.path.join(LOG_DIR, "not_a_session.txt"), "w", encoding="utf-8") as f:
        f.write("inside the dir, wrong shape\n")
    evil = ["../asv_console.py", "..%5Casv_console.py", "mission.json",
            "asv_x.jsonl/../../mission.json", "/etc/passwd",
            "../logs_evil/asv_evil.jsonl",           # right shape, wrong place
            "not_a_session.txt"]                     # right place, wrong shape
    answers = [(e, get_raw(port, "/api/log?file=" + urllib.parse.quote(e, safe="")))
               for e in evil]
    check("6. safe_log_path refuses every traversal spelling with a 404 - including a "
          "shape-perfect file OUTSIDE the dir and a real file inside it with the wrong shape",
          lambda: all(c == 404 for _e, (c, _t) in answers)
          and not any("secret" in t or "wrong shape" in t for _e, (_c, t) in answers),
          "; ".join("%s->%d" % (e[:24], c) for e, (c, _t) in answers))
    c6, text = get_raw(port, "/api/log?file=" + session_file)
    check("6b. ... and serves the legitimate recording as raw NDJSON",
          lambda: c6 == 200 and '"client:survey_note"' in text,
          lambda: "%d bytes" % len(text))

    # 7. logevent under --no-log is the OTHER harnesses' world: not covered here beyond
    # noting it - LOG None short-circuits before the ** call, which is exactly why this
    # suite runs with logging on.

finally:
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()
    for f in sorted(set(os.listdir(LOG_DIR)) - before):
        try:
            os.remove(os.path.join(LOG_DIR, f))     # never leave the test's session behind
        except OSError:
            pass
    try:                                             # ... nor the seeded traversal targets
        os.remove(os.path.join(APP, "logs_evil", "asv_evil.jsonl"))
        os.rmdir(os.path.join(APP, "logs_evil"))
    except OSError:
        pass

srvlog.seek(0)
server_out = srvlog.read()
srvlog.close()
tb = [ln.strip() for ln in server_out.splitlines()
      if "Traceback" in ln or "Error" in ln or "Exception occurred" in ln]
check("8. the console logged NO exception while serving those requests",
      not tb,
      ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb
      else "an answered request can still kill its handler")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
