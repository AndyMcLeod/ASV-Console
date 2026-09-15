"""tests/build_id.py - the console knows which version it is running, and which one is on disk (review #15, 2026-09-14).

THE DEFECT. The page and its modules are read from disk on every request; the console's Python only when it
starts. After a commit or an edit while a console ran, a refresh paired a NEW page with the OLD program: fields
the page sent were dropped, routes it called answered 404, and nothing said why.

THE CONTRACTS, on a temp COPY of the program (the real files are never touched), started as a console:
  * the state carries `build` (the fingerprint of the console's own files when it started) and `build_on_disk`
    (the same, now); they agree at start, and the page is served with that fingerprint in PAGE_BUILD;
  * rewriting a file's line endings, or touching it, is not a new version;
  * a change to a module the page loads, or to the Python, is: build_on_disk moves within BUILD_RECHECK_S while
    build stays, and the page served from then on carries the new fingerprint;
  * a console started again from the changed files runs the new version;
  * the fingerprint is the files, not where they are: a copy of the program is the same version.
The page half - the pill that says RESTART CONSOLE or RELOAD PAGE - is tests/build_check.js.

    python tests/build_id.py     # exit 0 = pass, 1 = fail   (stdlib only)

TEETH - 8 mutations RUN in a scratch clone, 8/8 caught, none by a crash (recorded results):
  * line endings part of the fingerprint                 -> caught by 2, 3, 5
  * the files never looked at again after start          -> caught by 3, 4, 5
  * build_on_disk always the version at start            -> caught by 3, 4, 5
  * the page served with the version at start            -> caught by 3
  * the Python not part of the fingerprint               -> caught by 4
  * the folder part of the fingerprint                   -> caught by 6
  * the page token not filled in                         -> caught by 1, 3, 5
  * the state reports no version                         -> caught by 1, 2, 3, 5
"""

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request


def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-500:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
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


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def get(port, path, raw=False, timeout=5):
    with urllib.request.urlopen("http://127.0.0.1:%d%s" % (port, path), timeout=timeout) as r:
        body = r.read().decode("utf-8")
    return body if raw else json.loads(body)


def until(pred, limit):
    t0 = time.time()
    while time.time() - t0 < limit:
        try:
            if pred():
                return True
        except Exception:
            pass
        time.sleep(0.25)
    return False


print("The console knows which version it is running, and which one is on disk:")

COPY = tempfile.mkdtemp(prefix="asv_build_copy_")
for name in ("asv_console.py", "currents.py", "roc_tracks.py", "gps_sim.py", "ais_service.py", "ports.default.json"):
    shutil.copy2(os.path.join(APP, name), os.path.join(COPY, name))
for name in ("vessels", "static"):
    shutil.copytree(os.path.join(APP, name), os.path.join(COPY, name))
STATE = ConsoleState()
procs = []


def start():
    port = free_port()
    log = tempfile.TemporaryFile(mode="w+")
    p = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none", "--port", str(port),
                          "--no-ais-service", "--no-log", *STATE.args()], cwd=COPY, stdout=log, stderr=subprocess.STDOUT)
    procs.append(p)
    up = until(lambda: "build" in get(port, "/api/state", timeout=2), 40)
    return port, up


def stop(p):
    try:
        p.terminate()
        p.wait(timeout=10)
    except Exception:
        p.kill()


def page_build(port):
    m = re.search(r'const PAGE_BUILD = "([^"]*)";', get(port, "/", raw=True))
    return m.group(1) if m else None


units = os.path.join(COPY, "static", "js", "units.js")
try:
    port, up = start()
    s0 = get(port, "/api/state") if up else {}
    b0 = s0.get("build")
    served0 = page_build(port) if up else None
    check("1. the state carries the version the console started from and the one on disk - the same at start - and the "
          "page is served with it",
          lambda: up and re.match(r"^[0-9a-f]{12}$", b0 or "") and s0.get("build_on_disk") == b0 and served0 == b0,
          "build %s, on disk %s, page served with %s" % (b0, s0.get("build_on_disk"), served0))

    # 2. line endings and a touch are not a version
    raw = open(units, "rb").read()
    flipped = raw.replace(b"\r\n", b"\n") if b"\r\n" in raw else raw.replace(b"\n", b"\r\n")
    open(units, "wb").write(flipped)
    later = time.time() + 30
    os.utime(os.path.join(COPY, "currents.py"), (later, later))
    time.sleep(6.5)                       # past BUILD_RECHECK_S
    s1 = get(port, "/api/state")
    check("2. rewriting a module's line endings, or touching the Python, is not a new version",
          lambda: s1.get("build_on_disk") == b0 and s1.get("build") == b0,
          "on disk after the rewrite and the touch: %s" % s1.get("build_on_disk"))

    # 3. a real change to a module the page loads
    with open(units, "ab") as f:
        f.write(b"\n// a change made while the console runs\n")
    moved = until(lambda: get(port, "/api/state").get("build_on_disk") != b0, 12)
    s2 = get(port, "/api/state")
    served2 = page_build(port)
    check("3. a change to a module the page loads is a new version on disk within BUILD_RECHECK_S, while the console "
          "still reports the one it started from - and the page served from then on carries the new one",
          lambda: moved and s2.get("build") == b0 and re.match(r"^[0-9a-f]{12}$", s2.get("build_on_disk") or "")
          and s2["build_on_disk"] != b0 and served2 == s2["build_on_disk"],
          "build %s; on disk %s; page served with %s" % (s2.get("build"), s2.get("build_on_disk"), served2))

    # 4. ... and so is a change to the Python, which the page never loads
    b_js = s2.get("build_on_disk")
    with open(os.path.join(COPY, "roc_tracks.py"), "ab") as f:
        f.write(b"\n# a change made while the console runs\n")
    moved_py = until(lambda: get(port, "/api/state").get("build_on_disk") not in (b0, b_js), 12)
    check("4. a change to the Python the console runs is a new version too",
          lambda: moved_py, "on disk: %s" % get(port, "/api/state").get("build_on_disk"))
    b_now = get(port, "/api/state").get("build_on_disk")

    # 5. started again from the changed files
    stop(procs[-1])
    port2, up2 = start()
    s3 = get(port2, "/api/state") if up2 else {}
    check("5. a console started again from the changed files runs the new version, and reports nothing behind",
          lambda: up2 and s3.get("build") == b_now and s3.get("build_on_disk") == b_now and page_build(port2) == b_now,
          "build %s, on disk %s, expected %s" % (s3.get("build"), s3.get("build_on_disk"), b_now))
    stop(procs[-1])

    # 6. the fingerprint is the files, not where they are
    sys.path.insert(0, APP)
    import asv_console as A  # noqa: E402
    A.use_state_dir(STATE.dir)
    twin = tempfile.mkdtemp(prefix="asv_build_twin_")
    for name in ("asv_console.py", "currents.py", "roc_tracks.py", "gps_sim.py", "ais_service.py"):
        shutil.copy2(os.path.join(APP, name), os.path.join(twin, name))
    shutil.copytree(os.path.join(APP, "static"), os.path.join(twin, "static"))
    here, there = A.BuildWatch(APP).boot, A.BuildWatch(twin).boot
    shutil.rmtree(twin, ignore_errors=True)
    check("6. a copy of the program elsewhere is the same version - the fingerprint is the files, not their folder",
          lambda: here == there and here == A.BUILD.boot, "here %s, copy %s" % (here, there))
finally:
    for p in procs:
        if p.poll() is None:
            stop(p)
    shutil.rmtree(COPY, ignore_errors=True)

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
