"""tests/doc_routes.py - THE FOUR DOCUMENTS' ROUTES, LIVE (Andy, 2026-10-19: "In the chart window lower toolbar add 4
buttons - each button opens one of the 4 asv simulator word documents"; the page half is tests/doc_buttons.js).

A console started with ASV_DOC_OPEN=off (a suite must never open Word), on its own port and state folder:
  1. GET /docs/<id> serves the document as a download: its own type, its file name, the file's own bytes;
  2. an id the bar does not know, and no id at all, are a 404 in words;
  3. POST /api/open_doc {doc} answers the download when the console's machine has no opener (the env), with its
     URL and a note; an unknown id is a 400 naming the four; no id is a 400 too;
  4. the opener itself, in process: a loopback browser's ask opens the file through DOC_OPEN and answers "word"; another
     machine's ask never opens, answers the download and says why; an opener that fails answers the download with its
     error; a file not on disk is a 404 naming the rebuild; never a path from the caller - the id picks the file;
  5. a second, known, non-supervising tab is not refused the manuals (supervisor_refusal gates /api/cmd/ alone).

    python tests/doc_routes.py      # exit 0 = pass, 1 = fail   (stdlib only)
"""
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
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
sys.path.insert(0, APP)
sys.path.insert(0, os.path.join(APP, "tests", "lib"))
from console_state import ConsoleState                      # noqa: E402
import asv_console as A                                      # noqa: E402

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


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def get(port, path):
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d%s" % (port, path), timeout=10) as r:
            return r.status, dict(r.headers), r.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()


def post(port, path, body, client="tab-A"):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json", "X-ASV-Client": client}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode("utf-8"))


IDS = ("quick", "ops", "tech", "dev")
print("The four documents' routes:")

# ---- the console, with no opener ------------------------------------------------------------------------------------ #
STATE = ConsoleState()
port = free_port()
env = dict(os.environ, ASV_DOC_OPEN="off")
srvlog = tempfile.TemporaryFile(mode="w+", encoding="utf-8")
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none", "--port", str(port),
                         "--no-ais-service", "--no-tide-window", "--no-weather-window", *STATE.args()],
                        cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT, env=env)
try:
    up = False
    for _ in range(80):
        try:
            if get(port, "/api/state")[0] == 200:
                up = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    check("0. a console comes up on its own port, its opener off (ASV_DOC_OPEN=off)", up)
    if not up:
        raise SystemExit(1)

    # ---- 1. GET /docs/<id>: the document as a download ---------------------------------------------------------- #
    got = {}
    for d in IDS:
        code, hdr, body = get(port, "/docs/" + d)
        disk = open(os.path.join(APP, "docs", A.DOC_FILES[d]), "rb").read()
        got[d] = (code, hdr.get("Content-Type"), hdr.get("Content-Disposition"), body == disk, len(body))
    check("1. GET /docs/<id> serves each of the four as a download: 200, the Word type, 'attachment' with its own file name, "
          "and the file's own bytes, whole",
          lambda: all(g[0] == 200 and g[1] == A.DOCX_MIME and g[2] == 'attachment; filename="%s"' % A.DOC_FILES[d]
                      and g[3] and g[4] > 1000 for d, g in got.items()),
          lambda: json.dumps({d: [g[0], g[1], g[2], g[3], g[4]] for d, g in got.items()}))

    # ---- 2. the refusals, in words ------------------------------------------------------------------------------ #
    c1, _, b1 = get(port, "/docs/nope")
    c2, _, b2 = get(port, "/docs/")
    c3, _, b3 = get(port, "/docs/../asv_console.py")
    check("2. an id the bar does not know, no id, and a path are each a 404 in words naming the four ids - the id picks the "
          "file, a path never does",
          lambda: c1 == 404 and c2 == 404 and c3 == 404
                  and all(b"no such document" in b and b"dev, ops, quick, tech" in b for b in (b1, b2, b3)),
          lambda: "%d %r | %d %r | %d %r" % (c1, b1[:60], c2, b2[:60], c3, b3[:60]))

    # ---- 3. POST /api/open_doc with no opener on this machine --------------------------------------------------- #
    c4, r4 = post(port, "/api/open_doc", {"doc": "tech"})
    c5, r5 = post(port, "/api/open_doc", {"doc": "x"})
    c6, r6 = post(port, "/api/open_doc", {})
    check("3. POST /api/open_doc {doc} from this machine, its opener off: 200, opened 'download', the URL /docs/<id>, the "
          "file's name and a note saying the console's machine has no opener; an unknown id is a 400 naming the four; "
          "no id is a 400 too",
          lambda: c4 == 200 and r4.get("ok") is True and r4.get("opened") == "download" and r4.get("url") == "/docs/tech"
                  and r4.get("file") == A.DOC_FILES["tech"] and "no opener" in (r4.get("note") or "")
                  and c5 == 400 and "no such document" in r5.get("error", "") and "dev, ops, quick, tech" in r5.get("error", "")
                  and c6 == 400 and "no such document" in r6.get("error", ""),
          lambda: json.dumps([c4, r4, c5, r5, c6, r6]))

    # ---- 5. another known tab is not refused ---------------------------------------------------------------------- #
    post(port, "/api/supervisor", {"op": "report"}, client="tab-A")        # tab-A makes itself known (and supervises)
    post(port, "/api/supervisor", {"op": "report"}, client="tab-B")        # tab-B known, not supervising
    c7, r7 = post(port, "/api/open_doc", {"doc": "quick"}, client="tab-B")
    check("5. A SECOND, KNOWN, NON-SUPERVISING TAB IS NOT REFUSED THE MANUALS (supervisor_refusal gates /api/cmd/ alone): "
          "tab-B's ask answers 200 'download' like tab-A's - in process too",
          lambda: c7 == 200 and r7.get("opened") == "download"
                  and A.supervisor_refusal("/api/open_doc", "tab-B") is None,
          lambda: json.dumps([c7, r7]))
finally:
    proc.kill()
    proc.wait(timeout=10)

# ---- 4. the opener itself, in process ------------------------------------------------------------------------------ #
opened = []
A.DOC_OPEN = lambda p: opened.append(p)
cW, rW = A.open_doc("ops", "127.0.0.1")
cW6, rW6 = A.open_doc("dev", "::1")
cR, rR = A.open_doc("ops", "10.0.0.5")
A.DOC_OPEN = None
cN, rN = A.open_doc("ops", "127.0.0.1")


def boom(p):
    raise OSError("no application is associated with .docx")


A.DOC_OPEN = boom
cF, rF = A.open_doc("tech", "127.0.0.1")
cX, rX = A.open_doc("nope", "127.0.0.1")
cP, rP = A.open_doc("../asv_console.py", "127.0.0.1")
A.DOC_OPEN = lambda p: opened.append(p)
was = A.DOCS_DIR
empty = tempfile.mkdtemp(prefix="asv_nodocs_")               # a docs folder with nothing in it
A.DOCS_DIR = empty
cM, rM = A.open_doc("quick", "127.0.0.1")
A.DOCS_DIR = was
shutil.rmtree(empty, True)
check("4. THE OPENER, IN PROCESS: a loopback browser's ask (IPv4 and IPv6) opens the file through DOC_OPEN - the file "
      "under docs/ the id names - and answers 'word'; another machine's ask never opens, answers the download and says the "
      "browser is not on the console's machine; no opener answers the download saying so; an opener that fails answers "
      "the download with its error; an unknown id and a path are a 400 (nothing opened); a file not on disk is a 404 "
      "naming the rebuild",
      lambda: cW == 200 and rW["opened"] == "word" and rW["file"] == A.DOC_FILES["ops"]
              and cW6 == 200 and rW6["opened"] == "word"
              and opened[:2] == [os.path.join(was, A.DOC_FILES["ops"]), os.path.join(was, A.DOC_FILES["dev"])]
              and cR == 200 and rR["opened"] == "download" and rR["url"] == "/docs/ops" and "not on the console's machine" in rR["note"]
              and cN == 200 and rN["opened"] == "download" and "no opener" in rN["note"]
              and cF == 200 and rF["opened"] == "download" and "no application is associated" in rF["note"]
              and cX == 400 and cP == 400 and len(opened) == 2
              and cM == 404 and "rebuild the documents" in rM["error"] and "build_docs.js" in rM["error"] and len(opened) == 2,
      lambda: json.dumps([cW, rW, cR, rR, cN, rN, cF, rF, cX, rX, cP, rP, cM, rM, opened]))

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
