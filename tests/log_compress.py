"""tests/log_compress.py - the session recordings older than 30 days are compressed in place, and NOTHING is lost
(Andy's retention decision, 2026-09-15).

Review #24 measured his logs/ and asked him: 191 recordings, 475 MB on disk, 329 MB of it older than 30 days, and those
118 old ones gzip from 309.6 MB to 8.9 MB - 35x. His answer: "1. Compress logs over 30 days. 2. Do not limit chart
cache size." So this is the ONE thing in the console that takes a file away, and the whole suite is about the hedge
around that: the original goes only after the compressed copy has been written, read back and compared BYTE FOR BYTE,
and a failure anywhere leaves the recording exactly as it was.

⚠ A COMPRESSED RECORDING IS STILL THE RECORD. It keeps its own name and its own date, it is listed at the size of the
RECORD rather than of the file, the playback page fetches it unchanged and gets the same text, and any gzip tool opens
it. A retention policy that made his records harder to read would have answered a different question than the one he
asked.

DRIVEN: the console's own compress_old_logs / _compress_one / run_log_compression / list_logs / safe_log_path /
read_log_text on temp folders, and then a REAL console over its own HTTP routes - because "playback can still read it"
is not a claim an in-process check can make.

    python tests/log_compress.py      # exit 0 = pass, 1 = fail   (stdlib only)

TEETH - 14 mutations RUN in a scratch clone (sidecar original, atomic writes, no bytecode, byte-compared afterwards),
14/14 caught:
    no age cut - every recording compressed -> 1, 2, 9      the session being recorded now compressed too -> 1, 2
    the copy never read back before the original goes -> 5  a failed attempt leaves its temp behind -> 4
    the record's date not carried over -> 1b                anything in logs/ compressed -> 3, 6, 7, 9, 10
    the budget checked before the first recording -> 7      no budget at all -> 7
    --no-log-compress ignored -> 8                          listed at the size of the FILE -> 9, 11
    a compressed recording not listed at all -> 9, 11       served as its raw bytes -> 9b, 11
    the name no longer resolves to the .gz -> 9b, 11        the compression never runs on the thread -> 11
⚠ THREE OF THOSE FIRST CRASHED THE SUITE INSTEAD OF FAILING A CHECK, and a crash is not a catch: a runner that reads
FAIL lines scores it as a SURVIVAL. All three were setup between checks - reading the .gz back, resolving the name,
parsing the listing - which is not inside a check() thunk. They go through safely() now, which turns a throw into a
value no check can match. The same trap is recorded in tests/log_routes.py's header.
(Two more, in tests/storage_watch.py 5/5b and one in tests/storage_banner.js 6, hold the other half of this: that the
readouts say which policy is actually in force.)
"""

import gzip
import importlib.util as _ilu
import io
import json
import os
import re
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from contextlib import redirect_stderr, redirect_stdout


def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

HERE = os.path.dirname(os.path.abspath(__file__))
APP = os.path.join(HERE, "..")
sys.path.insert(0, APP)
sys.path.insert(0, os.path.join(HERE, "lib"))
from console_state import ConsoleState  # noqa: E402

_spec = _ilu.spec_from_file_location("asv_console_log_compress", os.path.join(APP, "asv_console.py"))
_C = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_C)
STATE = ConsoleState(prefix="asv_log_compress_")
_C.use_state_dir(STATE.dir)

fails = 0
ran = 0


def check(name, cond, detail=""):
    global fails, ran
    ran += 1
    ok = False
    try:
        ok = bool(cond() if callable(cond) else cond)
        if callable(detail):
            detail = detail()
    except Exception as e:
        detail = "THREW %s: %s" % (type(e).__name__, e)
    print(("  ok   " if ok else "  FAIL ") + name + ("   [%s]" % detail if detail else ""))
    if not ok:
        fails += 1


print("The old session recordings are compressed, and nothing is lost:")

NOW = time.time()
LOGS = STATE.path("complogs")
os.makedirs(LOGS, exist_ok=True)
_C.LOG_DIR = LOGS
BODY = b"".join(b'{"t":%d,"iso":"2026-07-01T00:00:%02d","kind":"state","lat_deg":43.07,"lon_deg":-70.71}\n'
                % (i, i % 60) for i in range(4000))


def put(name, age_days, body=BODY):
    p = os.path.join(LOGS, name)
    with open(p, "wb") as f:
        f.write(body)
    os.utime(p, (NOW - age_days * 86400, NOW - age_days * 86400))
    return p


def names():
    return sorted(os.listdir(LOGS))


def wipe():
    for n in os.listdir(LOGS):
        p = os.path.join(LOGS, n)
        os.rmdir(p) if os.path.isdir(p) else os.remove(p)


_MISS = object()


def safely(fn, default=_MISS):
    """Scenario setup, never a crash. check() turns a throw inside its own thunk into a failed check; the SETUP between
    checks is not inside one, and a mutation that breaks a read there would end the suite before it printed a FAIL -
    which a mutation runner scores as a survival. Anything that throws here comes back as a value no check can match."""
    try:
        return fn()
    except Exception as e:
        return ("THREW %s: %s" % (type(e).__name__, e)) if default is _MISS else default


class FakeLog:
    """Stands in for the session recorder: it has a path (the recording being written NOW) and takes events."""
    def __init__(self, path):
        self.path, self.events = path, []

    def event(self, kind, **payload):
        self.events.append((kind, payload))


# 1. the compression
old = put("asv_20260701-000000.jsonl", 60)
recent = put("asv_20260914-000000.jsonl", 2)
current = put("asv_20260101-000000.jsonl", 90)          # old, but it is the session being recorded now
_C.LOG = FakeLog(current)
res = _C.compress_old_logs(now=NOW)
gz = old + ".gz"
with gzip.open(gz, "rb") as g:
    back = g.read()
check("1. a recording older than 30 days is compressed in place: the original is gone, the .gz is beside it under the "
      "same name, and it reads back BYTE FOR BYTE",
      lambda: res["files"] == 1 and not os.path.exists(old) and os.path.isfile(gz) and back == BODY
      and res["raw"] == len(BODY) and 0 < res["gz"] < len(BODY) // 4,
      lambda: "%s; %d -> %d bytes (%.0fx)" % (res, len(BODY), os.path.getsize(gz), len(BODY) / os.path.getsize(gz)))
check("1b. ... and it keeps the date of the RECORD, not of the day it was compressed - the age cut, the listing and "
      "the operator all read that mtime",
      lambda: abs(os.path.getmtime(gz) - (NOW - 60 * 86400)) < 2,
      lambda: "mtime off by %.1f s" % abs(os.path.getmtime(gz) - (NOW - 60 * 86400)))
check("2. the recording being written NOW is never compressed, however old it is, and neither is a recent one",
      lambda: os.path.isfile(current) and not os.path.exists(current + ".gz")
      and os.path.isfile(recent) and not os.path.exists(recent + ".gz"),
      lambda: names())

# 3. only session recordings
wipe()
old = put("asv_20260701-000000.jsonl", 60)
others = [put("ais_service.log", 60), put("gps_sim_shore-1.log", 60), put("notes.txt", 60),
          put("asv_20260701-000000.jsonl.gz.old", 60), put("asv_bad_name.jsonl", 60)]
os.makedirs(os.path.join(LOGS, "asv_20260601-000000.jsonl.d"), exist_ok=True)
_C.LOG = FakeLog(None)
res3 = _C.compress_old_logs(now=NOW)
check("3. nothing in logs/ that is not a session recording is touched - the child processes are appending to theirs "
      "while this runs",
      lambda: res3["files"] == 1 and all(os.path.isfile(p) and not os.path.exists(p + ".gz") for p in others)
      and os.path.isdir(os.path.join(LOGS, "asv_20260601-000000.jsonl.d")),
      lambda: names())

# 4. a write that fails
wipe()
kept = put("asv_20260701-000000.jsonl", 60)
real_gzipfile = _C.gzip.GzipFile


class RaisingGzip(real_gzipfile):
    def write(self, data):
        raise OSError(28, "No space left on device")


_C.gzip.GzipFile = RaisingGzip
try:
    err4 = io.StringIO()
    with redirect_stderr(err4):
        res4 = _C.compress_old_logs(now=NOW)
finally:
    _C.gzip.GzipFile = real_gzipfile
check("4. a write that FAILS costs nothing: the recording is left exactly as it was, no half-written .gz and no temp "
      "file behind, and it says so",
      lambda: res4 == {"files": 0, "raw": 0, "gz": 0, "failed": 1, "left": 0}
      and open(kept, "rb").read() == BODY and names() == ["asv_20260701-000000.jsonl"]
      and "NOT compressed" in err4.getvalue(),
      lambda: "%s; %s; said: %s" % (res4, names(), err4.getvalue().strip()[:70]))

# 5. a copy that does not read back
real_gzipfile = _C.gzip.GzipFile


class TruncatingGzip(real_gzipfile):
    """Valid gzip, half the bytes - the shape of a write that was cut short. Only the read-back catches it."""
    def write(self, data):
        return real_gzipfile.write(self, data[:len(data) // 2])


_C.gzip.GzipFile = TruncatingGzip
try:
    err5 = io.StringIO()
    with redirect_stderr(err5):
        res5 = _C.compress_old_logs(now=NOW)
finally:
    _C.gzip.GzipFile = real_gzipfile
survived = safely(lambda: open(kept, "rb").read() == BODY, False)
res5b = _C.compress_old_logs(now=NOW)                    # the next pass, with the fault gone
back5 = safely(lambda: gzip.open(kept + ".gz", "rb").read())
check("5. THE HEDGE: a compressed copy that does not read back as the recording never costs the recording - it is "
      "kept, the bad copy is not left in its place, and the next pass compresses it properly",
      lambda: res5["failed"] == 1 and survived and not os.path.exists(kept + ".gz.part")
      and res5b["files"] == 1 and back5 == BODY and not os.path.exists(kept),
      lambda: "failed pass %s, then %s; round trip %s" % (res5, res5b, back5 == BODY))

# 6. idempotent
before6 = {n: open(os.path.join(LOGS, n), "rb").read() for n in names()}
res6 = _C.compress_old_logs(now=NOW)
after6 = {n: open(os.path.join(LOGS, n), "rb").read() for n in names()}
check("6. a second pass has nothing to do and changes nothing",
      lambda: res6["files"] == 0 and res6["failed"] == 0 and before6 == after6,
      lambda: "%s; %d file(s) identical: %s" % (res6, len(after6), before6 == after6))

# 7. the budget
wipe()
for i in (1, 2, 3):
    put("asv_2026070%d-000000.jsonl" % i, 60)
res7a = _C.compress_old_logs(now=NOW, budget_s=0)
res7b = _C.compress_old_logs(now=NOW, budget_s=0)
res7c = _C.compress_old_logs(now=NOW, budget_s=0)
res7d = _C.compress_old_logs(now=NOW, budget_s=0)
check("7. a pass always compresses at least ONE recording and then stops at its budget - so a slow disk can neither "
      "starve the work nor hold the thread",
      lambda: [r["files"] for r in (res7a, res7b, res7c, res7d)] == [1, 1, 1, 0]
      and [r["left"] for r in (res7a, res7b, res7c, res7d)] == [2, 1, 0, 0]
      and len([n for n in names() if n.endswith(".gz")]) == 3,
      lambda: "files %s, left %s" % ([r["files"] for r in (res7a, res7b, res7c, res7d)],
                                     [r["left"] for r in (res7a, res7b, res7c, res7d)]))

# 8. off
wipe()
put("asv_20260701-000000.jsonl", 60)
_C.LOG_COMPRESS = False
try:
    res8 = _C.compress_old_logs(now=NOW)
finally:
    _C.LOG_COMPRESS = True
check("8. --no-log-compress leaves every recording exactly as it is",
      lambda: res8["files"] == 0 and names() == ["asv_20260701-000000.jsonl"], lambda: names())

# 9. the listing, the name and the text a playback asks for
wipe()
plain = put("asv_20260914-000000.jsonl", 2)
comp = put("asv_20260701-000000.jsonl", 60)
interrupted = put("asv_20260801-000000.jsonl", 45)       # a pass that stopped between the copy and the removal
with open(interrupted + ".gz", "wb") as f:
    with gzip.GzipFile(filename="", mode="wb", fileobj=f, mtime=int(NOW)) as g:
        g.write(BODY)
_C.LOG = FakeLog(None)
_C.compress_old_logs(now=NOW)
rows = {r["name"]: r for r in _C.list_logs()}
resolved = _C.safe_log_path("asv_20260701-000000.jsonl") or ""
served = safely(lambda: _C.read_log_text(resolved)) if resolved else "(the name did not resolve)"
check("9. a compressed recording is listed ONCE under its own name, at the size of the RECORD with what it takes on "
      "disk beside it - the playback list names and measures a session the way it always did",
      lambda: len(rows) == 3 and rows["asv_20260701-000000.jsonl"]["compressed"] is True
      and rows["asv_20260701-000000.jsonl"]["size"] == len(BODY)
      and 0 < rows["asv_20260701-000000.jsonl"]["on_disk"] < len(BODY) // 4
      and rows["asv_20260914-000000.jsonl"]["size"] == len(BODY)
      and "compressed" not in rows["asv_20260914-000000.jsonl"],
      lambda: json.dumps({k: {kk: vv for kk, vv in v.items() if kk != "mtime"} for k, v in rows.items()})[:190])
check("9b. ... and it answers to the same name: the route resolves it to the .gz and serves the identical text",
      lambda: resolved.endswith(".gz") and served == BODY.decode()
      and _C.safe_log_path("../asv_20260701-000000.jsonl") is None
      and _C.safe_log_path("asv_20260701-000000.jsonl.gz") is None,
      lambda: "%s, %d chars, identical %s" % (os.path.basename(resolved), len(served), served == BODY.decode()))

# 10. said once, and written into the session log
wipe()
put("asv_20260701-000000.jsonl", 60)
log10 = FakeLog(None)
_C.LOG = log10
out10 = io.StringIO()
with redirect_stdout(out10):
    _C.run_log_compression()
    _C.run_log_compression()                             # nothing to do: nothing said
said = [l for l in out10.getvalue().splitlines() if l.startswith("[logs]")]
check("10. a pass that did something says so ONCE, with the figures, and writes logs_compressed to the session "
      "recording - a record that changed shape without the recording saying so cannot be reconstructed afterwards",
      lambda: len(said) == 1 and "older than 30 days" in said[0]
      and re.search(r": \d+ KB -> \d+ KB$", said[0]) and int(re.findall(r"\d+", said[0])[-2]) > 100
      and [k for k, _p in log10.events] == ["logs_compressed"] and log10.events[0][1]["files"] == 1,
      lambda: (said[0] if said else "(nothing said)") + " | events " + str([k for k, _p in log10.events]))

# 11. LIVE: a real console, its own routes, the recording an operator would open
print("  --- and through a real console's own routes:")


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def get_raw(port, path, timeout=8):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d%s" % (port, path), timeout=timeout) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


LIVE = ConsoleState(prefix="asv_log_compress_live_")
live_logs = LIVE.path("logs")
os.makedirs(live_logs, exist_ok=True)
aged = os.path.join(live_logs, "asv_20260701-000000.jsonl")
with open(aged, "wb") as f:
    f.write(BODY)
os.utime(aged, (NOW - 60 * 86400, NOW - 60 * 86400))
port = free_port()
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none", "--port", str(port),
                         "--no-ais-service", *LIVE.args()], cwd=APP,
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    up, listed, text11 = False, None, ""
    for _ in range(80):
        try:
            with urllib.request.urlopen("http://127.0.0.1:%d/api/state" % port, timeout=2) as r:
                if r.status == 200:
                    up = True
                    break
        except Exception:
            time.sleep(0.5)
    for _ in range(40):                                  # the storage thread compresses on its first pass
        if os.path.exists(aged + ".gz") and not os.path.exists(aged):
            break
        time.sleep(0.25)
    code, body11 = get_raw(port, "/api/logs")
    listed = safely(lambda: [r for r in json.loads(body11).get("logs", []) if r["name"] == "asv_20260701-000000.jsonl"], [])
    code11, text11 = safely(lambda: get_raw(port, "/api/log?file=asv_20260701-000000.jsonl"), (0, ""))
    check("11. a real console compresses the old recording on its own thread at startup, still lists it under its own "
          "name at the size of the record, and serves the identical text to playback",
          lambda: up and os.path.isfile(aged + ".gz") and not os.path.exists(aged) and len(listed) == 1
          and listed[0].get("compressed") is True and listed[0]["size"] == len(BODY)
          and code11 == 200 and text11 == BODY.decode(),
          lambda: "console up %s; listed %s; served %d of %d chars"
                  % (up, json.dumps(listed[0] if listed else None)[:110], len(text11), len(BODY)))
finally:
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
