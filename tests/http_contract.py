"""tests/http_contract.py - every HTTP handler answers exactly once and never raises.

Covers BOTH servers in the project: the console (asv_console.py, GET + POST) and the
standalone AIS service (ais_service.py, GET only, its own process and port).

TWO OPPOSITE CONTRACTS live in the console, and each has its own way of going wrong:

    POST   _dispatch_post RETURNS (code, obj); do_POST sends it and logs it.
           Failure: returning anything else - most sharply, sending the response
           yourself, which returns None into the caller's unpack.
    GET    do_GET and its _serve_* helpers are VOID. Each commits its OWN response,
           via _send or - for the PNG tile and the SSE stream - raw send_response +
           end_headers + wfile.write.
           Failure: a path that commits NOTHING, leaving the client hanging.

They are mirror images: on the POST side sending is the mistake, on the GET side NOT
sending is. The AIS service follows the GET rule with a much smaller surface: two routes and
an unconditional 404 fall-through. One suite covers all three, because the question is the
same throughout - does every request get exactly one answer, and does the server survive it.

WHY THIS EXISTS. do_POST does:

    code, obj = self._dispatch_post(self.path, body)
    LOG.command(self.path, body, code, ...)
    self._send(code, json.dumps(obj))

so EVERY path through _dispatch_post must return a (code, obj) 2-tuple. /api/ais/radius
did not: it was written in the do_POST style and did `return self._send(...)`, which returns
None, so `code, obj = None` raised on every single call.

THE PART THAT MAKES THIS CLASS WORTH A SUITE OF ITS OWN: _send writes the response to the
socket BEFORE returning, so the client got a correct 200 and the raise happened afterwards.
The endpoint looked healthy from the outside. It killed its handler thread and skipped
LOG.command() - the session recorder silently lost every AIS radius change - and the only
symptom was a traceback on a console nobody was reading. A client-side assertion CANNOT see
this. You have to read the server's output.

    python tests/http_contract.py      # exit 0 = pass, 1 = fail   (stdlib only)

BOTH ROUTE LISTS ARE PARSED OUT OF THE SOURCE, never written down here. A new endpoint is
covered the day it is added rather than the day someone remembers to update this file -
the same reason tests/panel_drag.js derives its panel list from the registrations. Bodies
are best-effort: the point is to REACH each handler, not to be semantically valid, so a 400
or a 409 is a perfectly good result. What is not acceptable is no response, or a traceback.

RELATIONSHIP TO THE OTHER REAL-CONSOLE SUITES: ais_range / live_speed / completion_modes
each end with their own "the console logged no exception" check. Those cover a realistic
SEQUENCE (arm -> upload -> start -> stop), which single-shot POSTs cannot reproduce. This
one covers BREADTH - every endpoint, including the ones no other suite touches. Both are
worth having.

TEETH (verified by mutation, with the check numbers each one actually produced):

  POST side
    THE SHIPPED BUG - /api/ais/radius returns self._send(...)      -> 2, 3, 16
    the same thing applied to every /api/cmd/* handler             -> 2, 3, 16
    an endpoint returns a bare `return` (None)                     -> 2, 10, 16
    an endpoint returns a 3-tuple                                  -> 2, 10, 16
    a raise injected into a handler that is actually reached       -> 10, 16
    _dispatch_post allowed to fall off the end (except -> pass)    -> 4
  GET side
    a branch that commits NOTHING (the mirror bug)                 -> 6, 13
    the final else removed, so an unknown path answers nothing     -> 6, 7, 13
    a _serve_ helper loses its 404 path                            -> 6, 13
    the SSE stream never sends its headers                         -> 6, 15
    a handler that BLOCKS instead of returning                     -> 14
  ais_service.py (the second HTTP surface, its own process)
    THE FINDING - urllib.parse.unquote removed from the query parse -> 20
    the fall-through 404 made conditional                          -> 17, 18, 19
    /vessels returns without sending                               -> 17, 19
    the bbox ValueError guard removed (nan / broken raise)         -> 19, 22
    the max int guard removed (max=notanumber raises)              -> 19, 22

WHY THE PAIRS ARE ALL NEEDED, which is the point of the suite:

  10 vs 16   A raise BEFORE the response leaves the client with nothing, and 10 sees it.
             A raise AFTER _send has already written a correct response - the bug that
             actually shipped - is invisible to every client-side check, and ONLY the
             server log gives it away.
  13 vs 14   A GET handler that RETURNS without sending closes the connection, so the
             client gets no response (13). One that BLOCKS holds the socket open and looks
             exactly like a slow request (14). Different symptom, different check - the
             GET mutations above all land on 13, and only a sleep produces 14.
  6 vs 13    Static and live. 6 reads every path including ones no request here reaches;
             13 catches what the analysis is too coarse to see.

  20 alone   The percent-encoded bbox CANNOT be tested over the wire: with no AIS source the
             registry is empty, so a dropped box and an honoured one both return zero
             vessels and the responses are byte-identical. The first version of check 20
             compared exactly those two responses and PASSED with the fix reverted. It now
             runs the real parsing code on both spellings instead.

TWO NOTES ON WRITING MUTATIONS AGAINST THIS CODE, both of which cost me a false result:

  * The console's handlers are a chain of `if path == ...: return`, so a raise injected
    BEFORE the branch that already handles that path is unreachable and the mutation
    silently does nothing. Inject into a handler you have confirmed is reached.
  * asv_console.py is LF and ais_service.py is CRLF. A multi-line anchor written with "\\n"
    matches one file and not the other. A runner that reports a missing anchor as SKIP
    rather than as "caught" is the only reason this surfaced instead of reading as five
    clean passes.
"""

import ast
import http.client
import io
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import textwrap
import time
import urllib.error
import urllib.parse
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
SRC = os.path.join(APP, "asv_console.py")

fails = 0
ran = 0


def check(name, cond, detail=""):
    """`cond` may be a value or a thunk; a THROW is reported as a failed check rather than
    killing the run (see tests/stored_settings.js - a harness that cannot survive the fault
    it tests for cannot report it)."""
    global fails, ran
    ran += 1
    try:
        ok = bool(cond() if callable(cond) else cond)
        note = detail() if callable(detail) else detail
    except Exception as e:
        ok, note = False, "THREW: %s" % e
    print(("  ok   " if ok else "  FAIL ") + name + ("   [" + note + "]" if note else ""))
    if not ok:
        fails += 1


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def getp(port, path, timeout=25):
    """Return (http_code, bytes). None = no response at all; "TIMEOUT" = it hung."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d%s" % (port, path), timeout=timeout) as r:
            return r.status, len(r.read())
    except urllib.error.HTTPError as e:                  # a refusal is a real answer
        return e.code, len(e.read())
    except socket.timeout:
        return "TIMEOUT", 0
    except Exception as e:
        return None, str(e)[:60]


def post(port, path, body, timeout=8):
    """Return (http_code, text). A code of None means NO response reached us at all."""
    req = urllib.request.Request("http://127.0.0.1:%d%s" % (port, path),
                                 data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:                  # a refusal is a real answer
        return e.code, e.read().decode("utf-8", "replace")
    except Exception as e:
        return None, "no response: %s" % e


# --- static: the contract, read off the source ----------------------------- #
source = io.open(SRC, encoding="utf-8").read()
tree = ast.parse(source)
FNS = {n.name: n for n in ast.walk(tree) if isinstance(n, ast.FunctionDef)}
DISPATCH = FNS.get("_dispatch_post")


def own_nodes(fn):
    """Nodes belonging to fn itself, excluding any nested function bodies."""
    nested = {id(x) for d in ast.walk(fn)
              if isinstance(d, (ast.FunctionDef, ast.AsyncFunctionDef)) and d is not fn
              for x in ast.walk(d)}
    return [n for n in ast.walk(fn) if id(n) not in nested]


def completes(body):
    """Can this statement list finish WITHOUT returning or raising? Conservative: it only
    reports False when every path demonstrably terminates."""
    for st in body:
        if isinstance(st, (ast.Return, ast.Raise)):
            return False
        if isinstance(st, ast.If) and st.orelse:
            if not completes(st.body) and not completes(st.orelse):
                return False
        if isinstance(st, ast.With):
            if not completes(st.body):
                return False
        if isinstance(st, ast.Try):
            if st.finalbody and not completes(st.finalbody):
                return False
            main = completes(st.orelse) if st.orelse else completes(st.body)
            if not main and not any(completes(h.body) for h in st.handlers):
                return False
    return True


print("HTTP contract — every request gets exactly one answer, and the server survives it:")

check("1. _dispatch_post was found and its endpoints parsed out of the source",
      lambda: DISPATCH is not None,
      lambda: "lines %d-%d" % (DISPATCH.lineno, DISPATCH.end_lineno) if DISPATCH else "not found")

returns = [n for n in own_nodes(DISPATCH) if isinstance(n, ast.Return)]
bad_returns = []
for r in returns:
    v = r.value
    if v is None:
        bad_returns.append((r.lineno, "bare return -> None"))
    elif not isinstance(v, ast.Tuple):
        bad_returns.append((r.lineno, "not a tuple"))
    elif len(v.elts) != 2:
        bad_returns.append((r.lineno, "tuple of %d" % len(v.elts)))

check("2. EVERY return in _dispatch_post is a (code, obj) 2-tuple",
      lambda: not bad_returns,
      lambda: ("%d returns checked" % len(returns)) if not bad_returns
      else " | ".join("line %d: %s" % b for b in bad_returns))

# The specific bug: _send() writes the response and returns None, so the caller's unpack
# raises AFTER the client has already been answered.
sent = [n.lineno for n in own_nodes(DISPATCH)
        if isinstance(n, ast.Return) and isinstance(n.value, ast.Call)
        and isinstance(n.value.func, ast.Attribute) and n.value.func.attr == "_send"]
check("3. _dispatch_post never sends the response itself — that is do_POST's job",
      lambda: not sent,
      lambda: ("returns self._send(...) at line(s) %s" % sent) if sent
      else "sending here returns None into `code, obj = ...`")

check("4. _dispatch_post cannot fall off the end and return None implicitly",
      lambda: not completes(DISPATCH.body),
      "an unmatched path would unpack None exactly like the reported bug")

seg = "\n".join(source.splitlines()[DISPATCH.lineno - 1:DISPATCH.end_lineno])
ENDPOINTS = sorted(set(re.findall(r'path == "(/api/[^"]+)"', seg)))
check("5. the endpoint list came out of the source, not a list in this file",
      lambda: len(ENDPOINTS) >= 20,
      "%d endpoints — a new one is covered the day it is added" % len(ENDPOINTS))

# --- static: the GET contract, which is the exact opposite ----------------- #
# A GET handler is VOID and must commit its own response on every path. `end_headers` counts
# alongside `_send`: the PNG tile writes binary and the SSE stream writes an endless body,
# so neither goes through _send. Leaving end_headers out of this set reports both of them as
# non-responding, which is what the first version of this analysis did - a false finding,
# not a bug. The moment headers are ended, the client has an answer.
GET_FN = FNS.get("do_GET")
SENDERS = {"_send", "end_headers", "_serve_events", "_serve_tile", "_serve_log",
           "_serve_enc", "_serve_chartinfo", "_serve_ais"}


def is_send_call(n):
    return (isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
            and n.func.attr in SENDERS)


def must_send(stmts):
    """True if EVERY path through stmts commits a response (or raises)."""
    for i, st in enumerate(stmts):
        rest = stmts[i + 1:]
        if isinstance(st, ast.Raise):
            return True
        if isinstance(st, ast.Return):
            return bool(st.value is not None and is_send_call(st.value))
        if isinstance(st, ast.Expr) and is_send_call(st.value):
            return True
        if isinstance(st, ast.If):
            then_ok = must_send(st.body + rest)
            else_ok = must_send(st.orelse + rest) if st.orelse else must_send(rest)
            return then_ok and else_ok
        if isinstance(st, ast.Try):
            body_ok = must_send(st.body + (st.orelse or []) + rest)
            return body_ok and all(must_send(h.body + rest) for h in st.handlers)
        if isinstance(st, ast.With):
            return must_send(st.body + rest)
        # assignments and loops (which may not run) keep scanning
    return False


HANDLERS = ["do_GET"] + sorted(SENDERS - {"_send", "end_headers"})
silent = [h for h in HANDLERS if h in FNS and not must_send(FNS[h].body)]
check("6. every GET handler commits a response on EVERY path",
      lambda: not silent,
      lambda: ("no response on some path: %s" % ", ".join(silent)) if silent
      else "%d handlers: %s" % (len(HANDLERS), ", ".join(HANDLERS)))

# do_GET dispatches on a chain of if/elif. Without a final else an unmatched path would
# fall out having sent nothing - the GET-side equivalent of falling off _dispatch_post.
def has_final_else(fn):
    node = fn.body[-1] if fn.body else None
    while isinstance(node, ast.If):
        if node.orelse and not (len(node.orelse) == 1 and isinstance(node.orelse[0], ast.If)):
            return True
        node = node.orelse[0] if node.orelse else None
    return False

check("7. do_GET's dispatch chain ends in an else — an unknown path gets a 404, not silence",
      lambda: has_final_else(GET_FN),
      "an unmatched GET would otherwise commit nothing at all")

gseg = "\n".join(source.splitlines()[GET_FN.lineno - 1:GET_FN.end_lineno])
GET_EQ = sorted(set(re.findall(r'(?:self\.path|root) == "([^"]+)"', gseg)))
GET_SW = sorted(set(re.findall(r'(?:self\.path|root)\.startswith\("([^"]+)"\)', gseg)))
check("8. the GET route list came out of the source too",
      lambda: len(GET_EQ) + len(GET_SW) >= 15,
      "%d exact + %d prefix routes" % (len(GET_EQ), len(GET_SW)))

# --- live: reach every handler and read the server's own output ------------ #
# Best-effort bodies. Anything absent is POSTed {} - a 400 or 409 is a fine answer; the
# check is that the handler ANSWERS and does not take its thread down.
BODIES = {
    "/api/ais/radius": {"km": 60}, "/api/cmd/approach": {"m": 8}, "/api/cmd/arm": {"on": True},
    "/api/cmd/energy": {"pct": 90}, "/api/cmd/estop": {"on": False},
    "/api/cmd/goto": {"lat": 38.79, "lon": -75.161}, "/api/cmd/speed": {"speed": "low"},
    "/api/cmd/spawn": {"lat": 38.78965, "lon": -75.16094},
    "/api/cmd/transit": {"route": [{"lat": 38.79, "lon": -75.161}]},
    "/api/cmd/upload": {"waypoints": [{"lat": 38.79, "lon": -75.161}]},
    "/api/comms": {"rssi": -70}, "/api/env": {"wind_kn": 5}, "/api/logevent": {"text": "contract test"},
    "/api/mission": {"completion": "rth"}, "/api/roc": {"op": "add", "kind": "shore",
                                                       "lat": 38.79, "lon": -75.161},
    "/api/vessel": {"id": "drix08"}, "/api/waterlevel": {"offset_m": 0.2},
}
# One dict key routes every ROC operation, so the endpoint list alone does not reach them.
ROC_OPS = ["add", "update", "remove", "confirm", "activate", "stage", "home", "clear",
           "select", "offset", "nonsense-op"]

mpath = os.path.join(APP, "mission.json")
mission_bak = None
if os.path.exists(mpath):
    with io.open(mpath, encoding="utf-8") as f:
        mission_bak = f.read()

# This suite POSTs ROC ops against a live console. Without its own registry file
# every run left a staged ROC behind in the OPERATOR's roc_config.json - that is
# how the ROC card came to open on 198 stale rows.
ROC_CFG = os.path.join(tempfile.mkdtemp(), "roc_config.json")
srvlog = tempfile.TemporaryFile(mode="w+")
port = free_port()
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none",
                         "--port", str(port), "--no-ais-service", "--no-log",
                         "--roc-config", ROC_CFG],
                        cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
no_response, not_json, roc_dead = [], [], []
get_dead, get_hung, sse = [], [], (None, "", b"")
try:
    up = False
    for _ in range(80):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/api/state" % port, timeout=2).read()
            up = True
            break
        except Exception:
            time.sleep(0.25)
    check("9. a console comes up to drive", up, "port %d" % port)

    for p in ENDPOINTS:
        code, txt = post(port, p, BODIES.get(p, {}))
        if code is None:
            no_response.append(p)
            continue
        try:
            json.loads(txt)
        except Exception:
            not_json.append(p)

    for op in ROC_OPS:
        code, _ = post(port, "/api/roc", {"op": op, "kind": "shore", "lat": 38.79, "lon": -75.161})
        if code is None:
            roc_dead.append(op)

    # --- GET, including the branches that exist only to refuse ------------- #
    # The prefix routes need a concrete URL, and the malformed ones are the POINT: a 400 or
    # a 404 means the refusing branch answered. Those error branches are where a GET handler
    # is most likely to fall out having sent nothing.
    GET_PATHS = ["/", "/index.html", "/?cb=1", "/playback", "/playback?s=x"] + \
                [p for p in GET_EQ if p.startswith("/api")] + \
                ["/api/env", "/api/tide", "/api/waterlevel", "/api/ais",
                 "/api/log?name=does-not-exist",          # 404: no such log
                 "/api/enc", "/api/enc?bbox=broken",      # 400: missing / unparseable bbox
                 "/api/chartinfo", "/api/chartinfo?bbox=1,2",
                 "/tiles/bad/path.png", "/tiles/12/1/1.png",
                 "/nope", "/api/unknown"]                 # the final else
    for p in sorted(set(GET_PATHS)):
        code, _n = getp(port, p)
        if code is None:
            get_dead.append(p)
        elif code == "TIMEOUT":
            get_hung.append(p)

    # The SSE stream is the one GET that never finishes: it must commit headers and a first
    # frame straight away, then hold the connection open. "Never finishes" and "never
    # answers" look identical to a plain urlopen, so it is read explicitly.
    try:
        c = http.client.HTTPConnection("127.0.0.1", port, timeout=8)
        c.request("GET", "/events")
        r = c.getresponse()
        sse = (r.status, r.getheader("Content-Type") or "", r.read(48))
        c.close()
    except Exception as e:
        sse = (None, "", repr(e).encode())

    # /static/js/ — A URL THAT BECOMES A FILE READ. Added with the Layer-0 ES-module split
    # (2026-08-09). This is the console's second route that turns a client-supplied name
    # into a path on disk (safe_log_path is the other), so it is probed LIVE: a guard being
    # present in the source says nothing about the route actually reaching it.
    js_code, js_len = getp(port, "/static/js/geodesy.js")
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/static/js/units.js" % port,
                                    timeout=10) as r:
            js_ctype = r.headers.get("Content-Type", "")
    except Exception as e:
        js_ctype = "ERROR %s" % e
    # Every traversal spelling, plus the near-misses a whitelist must reject on its own
    # terms: a real file in the parent tree, a sub-path, a different case, another extension.
    js_refused = {}
    for name in ["../asv_console.py", "..%2Fasv_console.py", "../../asv_console.py",
                 "..\\asv_console.py", "sub/geodesy.js", "Geodesy.js",
                 "geodesy.js.map", "geodesy.txt", ""]:
        js_refused[name] = getp(port, "/static/js/" + name)[0]

    # Leave the link connected so shutdown is ordinary.
    post(port, "/api/connect", {})
finally:
    proc.terminate()
    try:
        proc.wait(timeout=10)
    except Exception:
        proc.kill()
    if mission_bak is not None:                      # never leave the developer's plan changed
        with io.open(mpath, "w", encoding="utf-8") as f:
            f.write(mission_bak)

check("10. EVERY POST endpoint answered — none left the client with no response",
      lambda: not no_response,
      lambda: ("no response from: %s" % ", ".join(no_response)) if no_response
      else "%d endpoints, all answered" % len(ENDPOINTS))

check("11. ... and every POST answer was JSON, including the refusals",
      lambda: not not_json,
      lambda: ("not JSON: %s" % ", ".join(not_json)) if not_json else "400/409 bodies included")

check("12. ... and every ROC operation answered (one dict key routes them all)",
      lambda: not roc_dead,
      lambda: ("no response for op: %s" % ", ".join(roc_dead)) if roc_dead
      else "%d ops incl. an unknown one" % len(ROC_OPS))

srvlog.seek(0)
server_out = srvlog.read()
srvlog.close()
tb = [ln.strip() for ln in server_out.splitlines()
      if "Traceback" in ln or "Exception occurred" in ln]
check("13. EVERY GET route answered, including the ones that exist to refuse",
      lambda: not get_dead,
      lambda: ("no response from: %s" % ", ".join(get_dead)) if get_dead
      else "the 400/404 branches answered too — that is where a void handler goes silent")

check("14. ... and none of them HUNG — a GET that never sends looks exactly like a slow one",
      lambda: not get_hung,
      lambda: ("hung: %s" % ", ".join(get_hung)) if get_hung
      else "no route committed nothing at all")

check("15. the SSE stream commits headers and a first frame immediately",
      lambda: sse[0] == 200 and "text/event-stream" in sse[1] and sse[2].startswith(b"data:"),
      lambda: "status=%s ctype=%s first=%r" % (sse[0], sse[1], sse[2][:28]))

# THE CHECK THE ORIGINAL BUG NEEDED. Everything above can pass while the server is dying on
# every request, because _send has already written a correct response by the time the handler
# raises. Read after the console is stopped, so its output is complete.
check("16. the console logged NO exception while serving ANY of them",
      lambda: not tb,
      lambda: ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb
      else "a correctly-answered request can still kill its handler thread")

# --- the SECOND HTTP surface: ais_service.py ------------------------------- #
# It is a separate process on its own port with its own handler, so the console's checks say
# nothing about it. Same contract as the console's GET side - a void handler that must commit
# its own response - but a much smaller surface: GET only, two routes, an unconditional 404
# fall-through. Driven with --source nmea at a dead port so nothing here touches the network.
AIS_SRC = os.path.join(APP, "ais_service.py")
ais_source = io.open(AIS_SRC, encoding="utf-8").read()
ais_tree = ast.parse(ais_source)
AIS_FNS = [n for n in ast.walk(ais_tree) if isinstance(n, ast.FunctionDef)]
AIS_GET = next((n for n in AIS_FNS if n.name == "do_GET"), None)
AIS_VERBS = sorted({n.name for n in AIS_FNS if n.name.startswith("do_")})

check("17. the AIS service's do_GET commits a response on EVERY path",
      lambda: must_send(AIS_GET.body),
      lambda: "lines %d-%d" % (AIS_GET.lineno, AIS_GET.end_lineno))

# No if/else chain here - it is `if path == ...: send; return` and then a bare send. That
# last statement IS the fall-through, so it must be an unconditional send, not another if.
check("18. ... and its last statement is an UNCONDITIONAL send, so an unknown path 404s",
      lambda: isinstance(AIS_GET.body[-1], ast.Expr) and is_send_call(AIS_GET.body[-1].value),
      lambda: "GET-only service; verbs implemented: %s" % ", ".join(AIS_VERBS))

ais_port, dead_port = free_port(), free_port()
aislog = tempfile.TemporaryFile(mode="w+")
ais_proc = subprocess.Popen([sys.executable, "ais_service.py", "--source", "nmea",
                             "--nmea-host", "127.0.0.1", "--nmea-port", str(dead_port),
                             "--port", str(ais_port)],
                            cwd=APP, stdout=aislog, stderr=subprocess.STDOUT)
ais_dead, verb_codes = [], {}
try:
    for _ in range(60):
        if getp(ais_port, "/health", timeout=2)[0] == 200:
            break
        time.sleep(0.25)

    # Malformed queries are the point: every one of these must be answered, not thrown on.
    AIS_PATHS = ["/health", "/vessels",
                 "/vessels?bbox=-80.3,42.0,-79.9,42.3",
                 "/vessels?bbox=broken", "/vessels?bbox=1,2,3", "/vessels?bbox=1,2,3,4,5",
                 "/vessels?bbox=nan,nan,nan,nan", "/vessels?bbox=1e400,2,3,4",
                 "/vessels?max=notanumber", "/vessels?max=-5", "/vessels?max=99999",
                 "/vessels?", "/vessels?novalue", "/vessels?=x",
                 "/nope", "/", "/health/extra"]
    for p in AIS_PATHS:
        code, _n = getp(ais_port, p, timeout=10)
        if code is None or code == "TIMEOUT":
            ais_dead.append(p)

    # Both spellings of the bbox must at least be ANSWERED; whether the encoded one is
    # actually decoded is check 20, which cannot be tested from out here (see below).
    tiny = "0.0,0.0,0.0001,0.0001"
    for spelling in (tiny, tiny.replace(",", "%2C")):
        if getp(ais_port, "/vessels?bbox=" + spelling, timeout=10)[0] != 200:
            ais_dead.append("bbox=" + spelling)

    for m in ("POST", "PUT", "DELETE"):
        try:
            c = http.client.HTTPConnection("127.0.0.1", ais_port, timeout=8)
            c.request(m, "/vessels")
            verb_codes[m] = c.getresponse().status
            c.close()
        except Exception as e:
            verb_codes[m] = "no response: %s" % e
finally:
    ais_proc.terminate()
    try:
        ais_proc.wait(timeout=10)
    except Exception:
        ais_proc.kill()

check("19. the AIS service answered every route, malformed queries included",
      lambda: not ais_dead,
      lambda: ("no response from: %s" % ", ".join(ais_dead)) if ais_dead
      else "%d routes incl. nan / inf / bad arity / missing values" % len(AIS_PATHS))

# THE FINDING THIS AUDIT PRODUCED, tested at the parser rather than over the wire.
# Percent-encoded commas are a legal way to write the bbox. The query parser never decoded
# them, so the box was silently dropped and the caller got the WHOLE registry instead -
# asking for a box and getting everything is the wrong way to fail.
#
# WHY NOT END-TO-END: with no AIS source the registry is EMPTY, so a dropped bbox and an
# honoured one both return zero vessels and the responses are byte-identical. The first
# version of this check compared those two responses and PASSED with the fix reverted -
# measured, not guessed. A test that cannot distinguish the bug from the fix is worse than
# none, so this runs the real parsing code on both spellings instead.
parse_src = textwrap.dedent("\n".join(
    ais_source.splitlines()[AIS_GET.lineno:AIS_GET.lineno + 12]).split("if path ==")[0])


def parse_query(path):
    ns = {"self": type("FakeRequest", (), {"path": path})(), "urllib": urllib}
    exec(parse_src, ns)
    return ns.get("q", {})


check("20. a PERCENT-ENCODED bbox is DECODED, not silently dropped",
      lambda: parse_query("/vessels?bbox=1%2C2%2C3%2C4").get("bbox") == "1,2,3,4"
      and parse_query("/vessels?bbox=1,2,3,4").get("bbox") == "1,2,3,4",
      lambda: "encoded -> %r, plain -> %r"
      % (parse_query("/vessels?bbox=1%2C2%2C3%2C4").get("bbox"),
         parse_query("/vessels?bbox=1,2,3,4").get("bbox")))

check("21. an unimplemented verb is REFUSED, not left hanging",
      lambda: all(isinstance(v, int) for v in verb_codes.values()),
      lambda: ", ".join("%s=%s" % kv for kv in sorted(verb_codes.items())))

aislog.seek(0)
ais_out = aislog.read()
aislog.close()
ais_tb = [ln.strip() for ln in ais_out.splitlines()
          if "Traceback" in ln or "Exception occurred" in ln]
check("22. the AIS service logged NO exception either",
      lambda: not ais_tb,
      lambda: ("%d line(s), first: %s" % (len(ais_tb), ais_tb[0][:90])) if ais_tb
      else "a second process, so the console's log says nothing about this one")

check("23. the page's ES modules are served",
      lambda: js_code == 200 and js_len > 500,
      lambda: "geodesy.js -> %s, %s bytes" % (js_code, js_len))

# A module script is REFUSED by the browser on a wrong content type, and that failure shows
# up as a BLANK CONSOLE rather than a 404 - so the type is part of the contract, not a detail.
check("24. ... with a JavaScript content type, or the browser refuses the module",
      lambda: "javascript" in js_ctype,
      lambda: "Content-Type: %s" % js_ctype)

check("25. every traversal and near-miss spelling is refused, none reaches disk",
      lambda: all(c == 404 for c in js_refused.values()),
      lambda: ", ".join("%s->%s" % (k or "(empty)", v)
                        for k, v in js_refused.items() if v != 404)
              or "all %d spellings refused with 404" % len(js_refused))

# ... and the guard has the SAME SHAPE as the log one, so a reader who has understood
# safe_log_path has understood this too. Source-shape, because the live checks above can see
# THAT it refused but not WHY - a route that 404s because the file is missing would pass them.
check("26. safe_js_path refuses on the basename identity, like safe_log_path",
      lambda: "safe_js_path" in FNS
      and "basename" in ast.dump(FNS["safe_js_path"])
      and "_JS_NAME_RE" in ast.dump(FNS["safe_js_path"]),
      "os.path.basename(name) != name rejects every traversal spelling at once")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
