"""tests/doc_routes.py - THE FOUR DOCUMENTS' ROUTES, LIVE (Andy, 2026-10-19: "In the chart window lower toolbar add 4
buttons - each button opens one of the 4 asv simulator word documents"; AS PDFs IN THE BROWSER since 2026-11-19, Andy:
"convert them from word to PDF"; the page half is tests/doc_buttons.js).

A console on its own port and state folder:
  1. GET /docs/<id> serves each document as a PDF, INLINE: the PDF type, its file name, the file's own bytes;
  2. an id the bar does not know, no id at all, and a path are a 404 in words naming the four;
  3. POST /api/open_doc - the route that opened Word on the console's machine - is gone: a 404, nothing opened;
  4. a PDF not on disk is a 404 that names the rebuild (in process, over an empty docs folder);
  5. a second, known, non-supervising tab is served the manuals like the first.

    python tests/doc_routes.py      # exit 0 = pass, 1 = fail   (stdlib only)
"""
import io
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


def get(port, path, client=None):
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path), headers={"X-ASV-Client": client} if client else {})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
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

# ---- the console ---------------------------------------------------------------------------------------------------- #
STATE = ConsoleState()
port = free_port()
srvlog = tempfile.TemporaryFile(mode="w+", encoding="utf-8")
# ⚠ THE RECORDING CONSOLE ASKS AN AIS BASE EVERY 10 s (its TargetRecorder, since 2026-11-05): left at the default it
# polled the OPERATOR'S bundled service on 127.0.0.1:8788 whenever his console was up, and filled this suite's
# recording with his live contacts. A closed port: the AIS sensor records "unreachable", the same every run.
NO_AIS = ["--ais", "http://127.0.0.1:1"]
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none", "--port", str(port),
                         "--no-ais-service", "--no-tide-window", "--no-weather-window", *NO_AIS, *STATE.args()],
                        cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
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
    check("0. a console comes up on its own port", up)
    if not up:
        raise SystemExit(1)

    # ---- 1. GET /docs/<id>: the document as a PDF, inline -------------------------------------------------------- #
    got = {}
    for d in IDS:
        code, hdr, body = get(port, "/docs/" + d)
        disk = open(os.path.join(APP, "docs", A.DOC_FILES[d]), "rb").read()
        got[d] = (code, hdr.get("Content-Type"), hdr.get("Content-Disposition"), body == disk, len(body), body[:5])
    check("1. GET /docs/<id> serves each of the four as a PDF for the browser's own viewer: 200, application/pdf, 'inline' "
          "with its own .pdf file name, and the file's own bytes, whole - a PDF (%PDF-)",
          lambda: all(g[0] == 200 and g[1] == "application/pdf" and g[2] == 'inline; filename="%s"' % A.DOC_FILES[d]
                      and A.DOC_FILES[d].endswith(".pdf") and g[3] and g[4] > 1000 and g[5] == b"%PDF-"
                      for d, g in got.items()),
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

    # ---- 3. the Word opener is gone ----------------------------------------------------------------------------- #
    c4, r4 = post(port, "/api/open_doc", {"doc": "tech"})
    check("3. POST /api/open_doc - which opened Word on the console's own machine - is gone: a 404, and the program "
          "keeps no opener (no open_doc, no DOC_OPEN)",
          lambda: c4 == 404 and not hasattr(A, "open_doc") and not hasattr(A, "DOC_OPEN"),
          lambda: json.dumps([c4, r4]))

    # ---- 5. another known tab is served the same ---------------------------------------------------------------- #
    post(port, "/api/supervisor", {"op": "report"}, client="tab-A")        # tab-A makes itself known (and supervises)
    post(port, "/api/supervisor", {"op": "report"}, client="tab-B")        # tab-B known, not supervising
    c7, h7, b7 = get(port, "/docs/quick", client="tab-B")
    check("5. A SECOND, KNOWN, NON-SUPERVISING TAB IS SERVED THE MANUALS (supervisor_refusal gates /api/cmd/ alone): "
          "tab-B's GET answers 200 and the PDF, like tab-A's",
          lambda: c7 == 200 and h7.get("Content-Type") == "application/pdf" and b7[:5] == b"%PDF-"
                  and A.supervisor_refusal("/docs/quick", "tab-B") is None,
          lambda: json.dumps([c7, h7.get("Content-Type"), len(b7)]))
finally:
    proc.kill()
    proc.wait(timeout=10)


# ---- 4. a PDF not on disk, in process ------------------------------------------------------------------------------ #
class FakeHandler:
    """Just what _serve_doc writes through: _send for a refusal, the header calls and wfile for a file."""
    def __init__(self):
        self.sent, self.code, self.wfile = None, None, io.BytesIO()

    def _send(self, code, body, ctype="application/json"):
        self.sent = (code, body)

    def send_response(self, code):
        self.code = code

    def send_header(self, k, v):
        pass

    def end_headers(self):
        pass


was = A.DOCS_DIR
empty = tempfile.mkdtemp(prefix="asv_nodocs_")               # a docs folder with nothing in it
A.DOCS_DIR = empty
fh = FakeHandler()
A.Handler._serve_doc(fh, "ops")
A.DOCS_DIR = was
shutil.rmtree(empty, True)
fh2 = FakeHandler()
A.Handler._serve_doc(fh2, "ops")                             # ... and the real folder serves it
check("4. A PDF NOT ON DISK IS A 404 THAT NAMES THE REBUILD (cd tools && node build_docs.js), in process over an empty "
      "docs folder; the same id over the real folder is served (200, its bytes)",
      lambda: fh.sent is not None and fh.sent[0] == 404 and "rebuild the documents" in fh.sent[1]
              and "build_docs.js" in fh.sent[1] and fh.code is None
              and fh2.sent is None and fh2.code == 200 and fh2.wfile.getvalue()[:5] == b"%PDF-",
      lambda: json.dumps([fh.sent, fh.code, fh2.sent, fh2.code]))

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
