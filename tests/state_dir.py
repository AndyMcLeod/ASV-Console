#!/usr/bin/env python3
"""tests/state_dir.py - no test writes the operator's own files (review #16, 2026-09-14).

Eighteen suites started a console in the app directory, and the console keeps its plan, comms
settings, port registry, ROC registry and session logs beside the program - so every run of the
pre-commit hook wrote the operator's own files. Most suites "protected" the plan by reading
mission.json when they began and writing it back when they ended, and that write-back is a write of
its own: an edit the operator made in their own console while the hook ran was lost at the
write-back, and with plan revisions (review #10) the write-back also rolled the revision back, so the
operator's page then refused to save. Measured on 2026-09-14: three plan-backup rotations in the app
folder fell inside one hook run, while the operator's console was up.

THE RULE: a console started by a test is given its own state folder (--state-dir, through
tests/lib/console_state.py), and nothing a test does is written beside the program.

    python tests/state_dir.py      # exit 0 = pass, 1 = fail   (stdlib only)

  1.    every suite that starts a console passes a state folder - read out of the source, so a suite
        added later is covered the day it is added.
  2-3b. the flag really moves every file: a console started from a COPY of the program, so even a
        broken flag cannot reach the operator's files, writes its plan, comms settings, port registry,
        ROC registry and session log into the state folder and nothing beside the program - and
        without the flag the same copy DOES write beside the program, so check 3 can see a write there.
TEETH - 11 mutations RUN in a scratch clone, 11 killed, no crash:
    the plan / comms settings / port registry not moved         -> 2, 2b, 3 (each)
    the session logs / ROC registry not moved                   -> 2b, 3 (each)
    the logger's folder left at its class-definition default    -> 2b, 3
    --state-dir parsed but never applied                        -> 2, 2b, 3
    the comms settings / port registry not RE-READ              -> 2 (each)
    a suite starts a console without *STATE.args()             -> 1
(and mission_store.py's own re-pointing removed -> its 2, 3, 8, 9, 10)
"""

import ast
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request


def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..")
sys.path.insert(0, os.path.join(HERE, "lib"))
from console_state import ConsoleState  # noqa: E402

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


print("State folders - no test writes the operator's own plan, settings or logs:")

# ── 1. every suite that starts a console gives it a state folder ───────────────────────────
# By AST: a Popen CALL whose own argument list names asv_console.py - not a substring anywhere in the
# file, which is how roc_persist.py's first audit put itself in its own audit set.
# ⚠ THIS FILE IS LEFT OUT BY NAME, and on purpose: it starts consoles from a temp COPY of the program,
# one of them WITHOUT the flag - that is check 3b's acceptance case, and it never runs in the app folder.


def console_launches(src):
    try:
        tree = ast.parse(src)
    except SyntaxError:
        return None
    segs = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "Popen":
            seg = ast.get_source_segment(src, node) or ""
            if "asv_console.py" in seg:
                segs.append(seg)
    return segs


def gives_state(seg, src):
    return '"--state-dir"' in seg or (re.search(r"\*\s*\w+\.args\(\)", seg) is not None
                                      and "ConsoleState(" in src)


launching, bare, unparsed = [], [], []
for fn in sorted(os.listdir(HERE)):
    if not fn.endswith(".py") or fn == os.path.basename(__file__):
        continue
    with open(os.path.join(HERE, fn), "r", encoding="utf-8") as f:
        src = f.read()
    segs = console_launches(src)
    if segs is None:
        unparsed.append(fn)
        continue
    for seg in segs:
        launching.append(fn)
        if not gives_state(seg, src):
            bare.append(fn)
check("1. every suite that starts a console gives it a state folder of its own - none can write the "
      "operator's plan, settings or logs",
      lambda: len(launching) >= 15 and not bare and not unparsed,
      lambda: "%d launches in %d suites%s%s" % (len(launching), len(set(launching)),
                                                 ("; NO state folder: " + ", ".join(bare)) if bare else "",
                                                 ("; could not parse: " + ", ".join(unparsed)) if unparsed else ""))

# ── 1b. A TEMP FOLDER A SUITE MAKES, IT REMOVES (review #27, 2026-09-15) ──────────────────
# 190 empty asv_amend_* and asv_mission_store_* folders had piled up in %TEMP%, and five suites made one without ever
# removing it - amend_plan.py's was not even used. By AST, in every suite: each tempfile.mkdtemp() is assigned to a
# plain name, and that name is handed to rmtree (directly, or through atexit.register). JS suites: each
# fs.mkdtempSync() is assigned to a name that reaches fs.rmSync. A folder made inside ConsoleState (tests/lib) is
# removed at exit by the class itself.
def temp_leaks(src):
    tree = ast.parse(src)
    named, leaks = {}, []
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "attr", getattr(node.func, "id", None)) == "mkdtemp":
            named.setdefault(id(node), None)
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Call) and id(node.value) in named \
                and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            named[id(node.value)] = node.targets[0].id
    removed = set()
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fname = getattr(node.func, "attr", getattr(node.func, "id", None))
        args = list(node.args)
        if fname == "register" and args and getattr(args[0], "attr", getattr(args[0], "id", None)) == "rmtree":
            args = args[1:]
        elif fname != "rmtree":
            continue
        if args and isinstance(args[0], ast.Name):
            removed.add(args[0].id)
    for call_id, name in named.items():
        if name is None:
            leaks.append("an unnamed mkdtemp()")
        elif name not in removed:
            leaks.append(name)
    return leaks


temp_report = {}
for fn in sorted(os.listdir(HERE)):
    p = os.path.join(HERE, fn)
    if fn.endswith(".py"):
        with open(p, "r", encoding="utf-8") as f:
            src = f.read()
        if "mkdtemp" in src:
            temp_report[fn] = temp_leaks(src)
    elif fn.endswith(".js"):
        with open(p, "r", encoding="utf-8") as f:
            src = f.read()
        names = re.findall(r"(?:const|let|var)\s+(\w+)\s*=\s*fs\.mkdtempSync\(", src)
        if "mkdtempSync(" in src:
            temp_report[fn] = [n for n in names if not re.search(r"rmSync\(\s*%s\b" % re.escape(n), src)] \
                              + (["an unnamed mkdtempSync()"] if src.count("mkdtempSync(") > len(names) else [])
leaky = {k: v for k, v in temp_report.items() if v}
check("1b. every temp folder a suite makes, the suite removes - each mkdtemp is named, and the name reaches rmtree "
      "(or rmSync)",
      lambda: len(temp_report) >= 8 and not leaky,
      lambda: "%d suites make temp folders; leaking: %s" % (len(temp_report),
                                                          "; ".join("%s: %s" % (k, ", ".join(v)) for k, v in leaky.items())
                                                          or "none"))

# ── 2-3b. the flag moves every file - proved on a COPY of the program ─────────────────────
COPY = tempfile.mkdtemp(prefix="asv_program_copy_")
for name in ("asv_console.py", "currents.py", "roc_tracks.py", "gps_sim.py", "ais_service.py",
             "ports.default.json"):
    shutil.copy2(os.path.join(APP, name), os.path.join(COPY, name))
for name in ("vessels", "static"):
    shutil.copytree(os.path.join(APP, name), os.path.join(COPY, name))
STATE_FILES = ("mission.json", "comms_config.json", "ports.json", "roc_config.json", "logs")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def post(port, path, body):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "{}")


def start(extra):
    """A console from the COPY, on a free port, logging ON; (port, proc, output file, came up)."""
    port = free_port()
    out = tempfile.TemporaryFile(mode="w+")
    proc = subprocess.Popen([sys.executable, os.path.join(COPY, "asv_console.py"), "--sim", "--browser", "none",
                             "--port", str(port), "--no-ais-service", "--no-tide-window", "--no-weather-window"]
                            + extra, cwd=COPY, stdout=out, stderr=subprocess.STDOUT)
    up = False
    for _ in range(120):
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/api/state" % port, timeout=2) as r:
                if (json.loads(r.read().decode()).get("status") or {}).get("lat_deg") is not None:
                    up = True
                    break
        except Exception:
            pass
        time.sleep(0.25)
    return port, proc, out, up


def stop(proc):
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()


def beside_program():
    return sorted(n for n in STATE_FILES if os.path.exists(os.path.join(COPY, n)))


STATE = ConsoleState()
# SEEDED, so the folder is READ as well as written: three of these files were loaded at import, and a
# console that wrote the folder while still reading beside the program would be two consoles at once.
SEED_PLAN = {"waypoints": [{"lat": 38.70, "lon": -75.10}, {"lat": 38.71, "lon": -75.10}], "lines": []}
with open(STATE.path("mission.json"), "w", encoding="utf-8") as f:
    json.dump(SEED_PLAN, f)
with open(STATE.path("comms_config.json"), "w", encoding="utf-8") as f:
    json.dump({"mode": "starlink", "host": "192.0.2.77", "username": "seeded"}, f)
with open(os.path.join(COPY, "ports.default.json"), "r", encoding="utf-8") as f:
    seed_ports = json.load(f)
seed_ports["active"] = "lewes_de"                     # not the shipped default's active port
with open(STATE.path("ports.json"), "w", encoding="utf-8") as f:
    json.dump(seed_ports, f)
port, proc, out, up = start(STATE.args())
answers, seen = {}, {}
try:
    out.seek(0)
    said = out.read()
    acked = ("keeps its plan, settings and logs in %s" % STATE.dir) in said
    # ONLY once the console has said where its state is does this suite write anything through it.
    if up and acked:
        for route in ("/api/mission", "/api/comms", "/api/ports"):
            with urllib.request.urlopen("http://127.0.0.1:%d%s" % (port, route), timeout=15) as r:
                seen[route] = json.loads(r.read().decode())
        answers["plan"] = post(port, "/api/mission", {"waypoints": [{"lat": 38.79, "lon": -75.16}], "lines": []})
        answers["comms"] = post(port, "/api/comms", {"mode": "wifi", "host": "10.20.30.40",
                                                     "username": "state-dir-test"})
        answers["port"] = post(port, "/api/ports", {"id": "new_castle_nh"})
        answers["roc"] = post(port, "/api/roc", {"op": "add", "kind": "shore", "name": "state-dir-probe",
                                                 "lat": 38.79, "lon": -75.161})
        answers["log"] = post(port, "/api/logevent", {"kind": "state_dir_probe", "data": {"n": 1}})
finally:
    stop(proc)


def read(*parts):
    try:
        with open(STATE.path(*parts), "r", encoding="utf-8") as f:
            return f.read()
    except OSError:
        return ""


logs = sorted(n for n in (os.listdir(STATE.path("logs")) if os.path.isdir(STATE.path("logs")) else [])
              if n.startswith("asv_") and n.endswith(".jsonl"))
plan_in = json.loads(read("mission.json") or "{}")
ports_in = json.loads(read("ports.json") or "{}")
comms_in = json.loads(read("comms_config.json") or "{}")
seen_plan = seen.get("/api/mission") or {}
seen_comms = (seen.get("/api/comms") or {}).get("config") or seen.get("/api/comms") or {}
seen_ports = seen.get("/api/ports") or {}
check("2. a console given --state-dir READS the plan, comms settings and port registry already in that folder",
      lambda: up and acked and len(seen_plan.get("waypoints") or []) == 2
      and seen_comms.get("host") == "192.0.2.77" and seen_ports.get("active") == "lewes_de",
      lambda: "plan waypoints %s, comms host %s, active port %s"
      % (len(seen_plan.get("waypoints") or []), seen_comms.get("host"), seen_ports.get("active")))
check("2b. ... and keeps its plan, comms settings, port registry, ROC registry and session log in that folder",
      lambda: up and acked and all(c == 200 for c, _ in answers.values())
      and len(plan_in.get("waypoints") or []) == 1 and comms_in.get("host") == "10.20.30.40"
      and ports_in.get("active") == "new_castle_nh" and "state-dir-probe" in read("roc_config.json")
      and logs and any("state_dir_probe" in read("logs", n) for n in logs),
      lambda: "up=%s acked=%s answers=%s; in the folder: %s, logs %s"
      % (up, acked, {k: c for k, (c, _) in answers.items()},
         sorted(n for n in os.listdir(STATE.dir)), logs))
check("3. ... and wrote NONE of them beside the program",
      lambda: up and acked and beside_program() == [],
      lambda: "beside the program: %s" % (beside_program() or "nothing"))

port, proc, out, up_b = start(["--no-log"])
try:
    plain = post(port, "/api/mission", {"waypoints": [{"lat": 38.79, "lon": -75.16}], "lines": []}) if up_b else None
finally:
    stop(proc)
check("3b. ... while the same program WITHOUT the flag writes its plan beside itself - so check 3 can see a "
      "write there",
      lambda: up_b and plain and plain[0] == 200 and os.path.exists(os.path.join(COPY, "mission.json")),
      lambda: "came up=%s answer=%s beside the program: %s" % (up_b, plain and plain[0], beside_program()))

shutil.rmtree(COPY, ignore_errors=True)
print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
