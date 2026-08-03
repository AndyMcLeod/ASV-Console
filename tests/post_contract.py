"""tests/post_contract.py - every POST handler honours _dispatch_post's contract.

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

    python tests/post_contract.py      # exit 0 = pass, 1 = fail   (stdlib only)

THE ENDPOINT LIST IS PARSED OUT OF THE SOURCE, never written down here. A new POST endpoint
is covered the day it is added rather than the day someone remembers to update this file -
the same reason tests/panel_drag.js derives its panel list from the registrations. Bodies
are best-effort: the point is to REACH each handler, not to be semantically valid, so a 400
or a 409 is a perfectly good result. What is not acceptable is no response, or a traceback.

RELATIONSHIP TO THE OTHER REAL-CONSOLE SUITES: ais_range / live_speed / completion_modes
each end with their own "the console logged no exception" check. Those cover a realistic
SEQUENCE (arm -> upload -> start -> stop), which single-shot POSTs cannot reproduce. This
one covers BREADTH - every endpoint, including the ones no other suite touches. Both are
worth having.

TEETH (verified by mutation, with the check numbers each one actually produced):

    THE SHIPPED BUG - /api/ais/radius returns self._send(...)      -> 2, 3, 10
    the same thing applied to every /api/cmd/* handler             -> 2, 3, 10
    an endpoint returns a bare `return` (None)                     -> 2, 7, 10
    an endpoint returns a 3-tuple                                  -> 2, 7, 10
    a raise injected into a handler that is actually reached       -> 7, 10
    _dispatch_post allowed to fall off the end (except -> pass)    -> 4

WHY 7 AND 10 ARE BOTH NEEDED, and it is the whole point of the suite: a raise BEFORE the
response leaves the client with nothing, and check 7 sees it. A raise AFTER _send has
already written a correct response - the bug that actually shipped - is invisible to every
client-side check, and ONLY the server log gives it away. Neither check subsumes the other.

A NOTE ON WRITING THESE MUTATIONS: the handlers are a chain of `if path == ...: return`, so
a raise injected before the branch that already handles that path is unreachable and the
mutation silently does nothing. The first attempt at the raise mutation did exactly that and
looked like a surviving mutant. Inject into a handler you have confirmed is reached.
"""

import ast
import io
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
DISPATCH = next((n for n in ast.walk(tree)
                 if isinstance(n, ast.FunctionDef) and n.name == "_dispatch_post"), None)


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


print("POST contract — every handler returns (code, obj), and none of them raises:")

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
ENDPOINTS = sorted(set(__import__("re").findall(r'path == "(/api/[^"]+)"', seg)))
check("5. the endpoint list came out of the source, not a list in this file",
      lambda: len(ENDPOINTS) >= 20,
      "%d endpoints — a new one is covered the day it is added" % len(ENDPOINTS))

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

srvlog = tempfile.TemporaryFile(mode="w+")
port = free_port()
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none",
                         "--port", str(port), "--no-ais-service", "--no-log"],
                        cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
no_response, not_json, roc_dead = [], [], []
try:
    up = False
    for _ in range(80):
        try:
            urllib.request.urlopen("http://127.0.0.1:%d/api/state" % port, timeout=2).read()
            up = True
            break
        except Exception:
            time.sleep(0.25)
    check("6. a console comes up to drive", up, "port %d" % port)

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

check("7. EVERY endpoint answered — none left the client with no response",
      lambda: not no_response,
      lambda: ("no response from: %s" % ", ".join(no_response)) if no_response
      else "%d endpoints, all answered" % len(ENDPOINTS))

check("8. ... and every answer was JSON, including the refusals",
      lambda: not not_json,
      lambda: ("not JSON: %s" % ", ".join(not_json)) if not_json else "400/409 bodies included")

check("9. ... and every ROC operation answered (one dict key routes them all)",
      lambda: not roc_dead,
      lambda: ("no response for op: %s" % ", ".join(roc_dead)) if roc_dead
      else "%d ops incl. an unknown one" % len(ROC_OPS))

# THE CHECK THE ORIGINAL BUG NEEDED. Runs after the console is stopped, so its output is
# complete. Everything above can pass while the server is dying on every request, because
# _send has already written a correct response by the time the handler raises.
srvlog.seek(0)
server_out = srvlog.read()
srvlog.close()
tb = [ln.strip() for ln in server_out.splitlines()
      if "Traceback" in ln or "Exception occurred" in ln]
check("10. the console logged NO exception while serving ANY of them",
      lambda: not tb,
      lambda: ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb
      else "a correctly-answered request can still kill its handler thread")

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails
      else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
