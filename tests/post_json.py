"""tests/post_json.py - a POST must say it is JSON, and a stop is never refused (review #25, 2026-09-15).

Andy: "POST requests don't require JSON. The page already sends JSON, so requiring it costs nothing and blocks simple
posts from other websites."

A web page anywhere can make the operator's browser POST to the console without a preflight when the request is
"simple": a form, or a body labeled text/plain, form-urlencoded or multipart. A JSON label forces the browser to ask
first (OPTIONS), and the console grants no cross-origin access, so that POST never leaves the browser. So the console
refuses (415) a POST not labeled JSON - EXCEPT Stop, Pause and an E-STOP latch, honored whatever the label, because
the #10 rule stands: a garbled stop is still a stop. And an E-STOP whose body cannot be read, or does not say, now
LATCHES: the dispatcher read bool(body.get("on")), so a garbled E-STOP used to RELEASE a latched one.

DRIVEN: the console's own Handler on a Server in this process, its module ENGINE on a sim link, its state in a temp
folder (use_state_dir), and requests made with http.client so every header is exactly what the check says.

    python tests/post_json.py      # exit 0 = pass, 1 = fail   (stdlib only)

TEETH - 12 mutations RUN in a scratch clone (sidecar original, atomic writes, no bytecode, the source compared byte for
byte afterwards), 12/12 caught:
    no JSON rule (the reported fault) -> 1, 2, 5, 7     do_POST ignores the refusal -> 1, 2, 5, 7
    the label compared whole (charset/capitals) -> 3    Stop and Pause refused like the rest -> 4
    Pause refused -> 4                                  an E-STOP latch refused -> 5, 6
    an E-STOP release honored unlabeled -> 5, 7         the old reading, bool(on) -> 6
    0 not a release -> 6                                the dispatcher reads bool(on) again -> 6
    a refusal answered but not logged -> 7              cross-origin access offered -> 8

LIVE (a temp console on port 8796 with logging, and a page served from port 8797 - another origin - in the in-app
browser): a no-cors fetch POSTing {"on": true} as text/plain to /api/cmd/arm was SENT by the browser and refused by the
console (the session log reads "/api/cmd/arm 415 a POST must be sent as JSON..."), the boat still disarmed; the same
POST labeled application/json never left the browser ("Failed to fetch" at the preflight, and no second arm in the
log). The console's own page then armed, latched and released E-STOP as before.
"""

import http.client
import importlib.util as _ilu
import json
import os
import re
import socket
import sys
import threading
import time


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

_spec = _ilu.spec_from_file_location("asv_console_post_json", os.path.join(APP, "asv_console.py"))
_C = _ilu.module_from_spec(_spec)
_spec.loader.exec_module(_C)

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
    except Exception as e:                        # a check that raises is a failed check
        detail = "THREW %s: %s" % (type(e).__name__, e)
    print(("  ok   " if ok else "  FAIL ") + name + ("   [%s]" % detail if detail else ""))
    if not ok:
        fails += 1


print("A POST must say it is JSON, and a stop is never refused:")

STATE = ConsoleState(prefix="asv_post_json_")
_C.use_state_dir(STATE.dir)


class _Log:                                        # the session recorder's command() and nothing else
    def __init__(self):
        self.commands = []

    def command(self, path, body, code, error):
        self.commands.append((path, code, error))

    def __getattr__(self, name):                   # every other recorder call is a no-op here
        return lambda *a, **k: None


LOG = _Log()
_C.LOG = LOG

_s = socket.socket()
_s.bind(("127.0.0.1", 0))
PORT = _s.getsockname()[1]
_s.close()
srv = _C.Server(("127.0.0.1", PORT), _C.Handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()

E = _C.ENGINE
E.connect("sim", "", _C.DEFAULT_VCU_PORT, "tcp")
t0 = time.time()
while (E.status or {}).get("lat_deg") is None and time.time() - t0 < 20:
    time.sleep(0.1)


def post(path, body, ctype):
    """(status, parsed json or text). `body` is sent as given (str) or JSON-encoded; ctype None sends no label."""
    raw = body if isinstance(body, (bytes, str)) else json.dumps(body)
    raw = raw.encode("utf-8") if isinstance(raw, str) else raw
    c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
    headers = {"Content-Length": str(len(raw))}
    if ctype is not None:
        headers["Content-Type"] = ctype
    c.putrequest("POST", path, skip_accept_encoding=True)
    for k, v in headers.items():
        c.putheader(k, v)
    c.endheaders(raw)
    r = c.getresponse()
    text = r.read().decode("utf-8", "replace")
    hdrs = dict((k.lower(), v) for k, v in r.getheaders())
    c.close()
    try:
        return r.status, json.loads(text), hdrs
    except ValueError:
        return r.status, text, hdrs


def err(obj):
    return obj.get("error", "") if isinstance(obj, dict) else str(obj)


# 1-2. the simple requests another website can send
s_plain, o_plain, _ = post("/api/cmd/arm", {"on": True}, "text/plain")
s_form, o_form, _ = post("/api/cmd/arm", "on=true", "application/x-www-form-urlencoded")
s_multi, o_multi, _ = post("/api/cmd/arm", "--x\r\nContent-Disposition: form-data; name=\"on\"\r\n\r\ntrue\r\n--x--\r\n",
                           "multipart/form-data; boundary=x")
s_none, o_none, _ = post("/api/cmd/arm", {"on": True}, None)
check("1. an Arm labeled text/plain, form-urlencoded, multipart or not labeled at all - the bodies another website can "
      "send without asking - is refused 415 in words, and the boat stays disarmed",
      lambda: (s_plain, s_form, s_multi, s_none) == (415, 415, 415, 415) and "JSON" in err(o_plain) and E.armed is False,
      lambda: "codes %s, %s, %s, %s; armed %s; '%s'" % (s_plain, s_form, s_multi, s_none, E.armed, err(o_plain)[:70]))

plan_before = open(_C.MISSION_PATH, "rb").read() if os.path.exists(_C.MISSION_PATH) else None
s_plan, o_plan, _ = post("/api/mission", json.dumps({"waypoints": [{"lat": 1, "lon": 2}], "lines": []}), "text/plain")
plan_after = open(_C.MISSION_PATH, "rb").read() if os.path.exists(_C.MISSION_PATH) else None
check("2. a plan POSTed as text/plain is refused before it is read as a plan - the plan file is untouched",
      lambda: s_plan == 415 and plan_after == plan_before,
      lambda: "code %s; plan file %s" % (s_plan, "unchanged" if plan_after == plan_before else "CHANGED"))

# 3. JSON is accepted, with or without a charset
s_json, o_json, _ = post("/api/cmd/arm", {"on": True}, "application/json")
armed_after_json = E.armed
post("/api/cmd/arm", {"on": False}, "application/json")
s_json_cs, o_json_cs, _ = post("/api/cmd/arm", {"on": True}, "Application/JSON; charset=utf-8")
check("3. the same Arm labeled application/json is obeyed - and so is 'Application/JSON; charset=utf-8'",
      lambda: s_json == 200 and armed_after_json is True and s_json_cs == 200 and E.armed is True,
      lambda: "codes %s, %s; armed %s then %s" % (s_json, s_json_cs, armed_after_json, E.armed))

# 4. a stop is never refused
far = ((E.status or {}).get("lat_deg", 0.0) + 0.003, (E.status or {}).get("lon_deg", 0.0))


def under_way():
    E.set_armed(True)
    E.go_to(*far)
    t = time.time()
    while E.run != "running" and time.time() - t < 5:
        time.sleep(0.05)
    return E.run


run0 = under_way()
s_pause, o_pause, _ = post("/api/cmd/pause", "", "text/plain")
run_paused = E.run
under_way()
s_stop, o_stop, _ = post("/api/cmd/stop", "{garbled", None)
run_stopped = E.run
under_way()
s_stop_form, _, _ = post("/api/cmd/stop", "please=stop", "application/x-www-form-urlencoded")
run_stopped_form = E.run
check("4. Pause and Stop are obeyed whatever they are labeled - text/plain, no label with a garbled body, a form - "
      "because a stop is never refused (the #10 rule)",
      lambda: run0 == "running" and (s_pause, s_stop, s_stop_form) == (200, 200, 200)
              and run_paused == "paused" and run_stopped != "running" and run_stopped_form != "running",
      lambda: "running %s; pause %s -> %s; stop %s -> %s; form stop %s -> %s"
              % (run0, s_pause, run_paused, s_stop, run_stopped, s_stop_form, run_stopped_form))

# 5-6. E-STOP: a latch is honored whatever the label, a release needs JSON, and a body that does not say latches
s_latch, _, _ = post("/api/cmd/estop", {"on": True}, "text/plain")
latched_plain = E.estop
s_release_plain, o_release_plain, _ = post("/api/cmd/estop", {"on": False}, "text/plain")
still_latched = E.estop
s_release_json, _, _ = post("/api/cmd/estop", {"on": False}, "application/json")
released_json = E.estop
check("5. an E-STOP LATCH labeled text/plain is obeyed; a RELEASE labeled text/plain is refused and it stays latched; a "
      "release labeled JSON is obeyed",
      lambda: s_latch == 200 and latched_plain is True and s_release_plain == 415 and still_latched is True
              and s_release_json == 200 and released_json is False,
      lambda: "latch %s -> %s; plain release %s -> latched %s; JSON release %s -> %s"
              % (s_latch, latched_plain, s_release_plain, still_latched, s_release_json, released_json))

outcomes = {}
for label, body in (("garbled", "{on: nope"), ("empty object", {}), ("on: null", {"on": None}), ("on: 'false'", {"on": "false"}),
                    ("form body", "on=false")):
    post("/api/cmd/estop", {"on": True}, "application/json")
    ctype = "application/x-www-form-urlencoded" if label == "form body" else "application/json"
    st, _, _ = post("/api/cmd/estop", body, ctype)
    outcomes[label] = (st, E.estop)
post("/api/cmd/estop", {"on": True}, "application/json")
s_zero, _, _ = post("/api/cmd/estop", {"on": 0}, "application/json")
released_zero = E.estop
check("6. an E-STOP whose body cannot be read, is empty, or does not say 'off' LATCHES - it used to RELEASE a latched one "
      "- and only an explicit false or 0 releases",
      lambda: all(v == (200, True) for v in outcomes.values()) and s_zero == 200 and released_zero is False,
      lambda: "; ".join("%s -> %s latched %s" % (k, v[0], v[1]) for k, v in outcomes.items())
              + "; on: 0 -> %s latched %s" % (s_zero, released_zero))

# 7. refusals are recorded
refused_logged = [c for c in LOG.commands if c[1] == 415]
check("7. every refusal is in the session log with its code and its reason",
      lambda: len(refused_logged) >= 6 and all(c[2] and "JSON" in c[2] for c in refused_logged)
              and ("/api/cmd/arm", 415) in [(c[0], c[1]) for c in refused_logged],
      lambda: "%d refusals logged, e.g. %s" % (len(refused_logged), refused_logged[:1]))

# 8. the browser's question gets no yes
c = http.client.HTTPConnection("127.0.0.1", PORT, timeout=10)
c.request("OPTIONS", "/api/cmd/arm", headers={"Origin": "https://example.com", "Access-Control-Request-Method": "POST",
                                               "Access-Control-Request-Headers": "content-type"})
r = c.getresponse()
opt_status, opt_headers = r.status, dict((k.lower(), v) for k, v in r.getheaders())
r.read()
c.close()
_, _, json_headers = post("/api/cmd/arm", {"on": False}, "application/json")
check("8. the preflight a browser sends before a cross-site JSON POST is not granted, and no response offers "
      "cross-origin access - which is what makes the JSON label a guard at all",
      lambda: opt_status >= 400 and not any(k.startswith("access-control-allow") for k in opt_headers)
              and not any(k.startswith("access-control-allow") for k in json_headers),
      lambda: "OPTIONS -> %s; allow headers: %s" % (opt_status, [k for k in list(opt_headers) + list(json_headers)
                                                                 if k.startswith("access-control")] or "none"))

# 9. nothing the console's own pages send is refused
pages = []
for rel in ["asv.html", "playback.html"] + ["js/" + f for f in sorted(os.listdir(os.path.join(APP, "static", "js")))]:
    p = os.path.join(APP, "static", rel)
    if os.path.isfile(p) and p.endswith((".html", ".js")):
        pages.append((rel, open(p, encoding="utf-8").read()))
posts, unlabeled = 0, []
for rel, src in pages:
    for m in re.finditer(r"method\s*:\s*[\"']POST[\"']", src):
        posts += 1
        call = src[max(0, m.start() - 300): m.end() + 300]
        if "application/json" not in call:
            unlabeled.append("%s@%d" % (rel, m.start()))
check("9. every POST the console's own pages make is labeled application/json, so the rule refuses nothing of theirs",
      lambda: posts >= 5 and not unlabeled,
      lambda: "%d POSTs found; unlabeled: %s" % (posts, unlabeled or "none"))

E.disconnect()
srv.shutdown()
print("\n" + ("%d CHECK(S) FAILED (%d ran)" % (fails, ran) if fails else "all checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
