"""tests/supervisor.py - one browser tab supervises the console; the others watch (review #14, 2026-09-15).

Andy: "All supervision lives in one browser tab."

⚠ TWO TABS ARE TWO SAFETY LADDERS. The clearance guard, the speed governor and the end-of-plan RTH chain all run in the
PAGE, so a second tab commands the same boat from its own reading of the world - and a tab the browser has throttled or
slept is a ladder that has quietly stopped, with nothing on screen to say so. Both arrive at the console looking like
ordinary commands. So each tab names itself (X-ASV-Client) and reports in every SUPERVISOR_BEAT_S; the console grants
supervision to exactly one, refuses the others' commands in words, and says when the supervising tab goes quiet.

WHAT IS DELIBERATELY NOT GATED, and each has a check here:
  * STOP, PAUSE and E-STOP from any tab, supervising or not. A control that reduces risk is never gated on
    bookkeeping - the same rule review #25 wrote for content types.
  * A caller with no tab name at all: a script, a suite, curl. This guards the operator's own second window, not the
    API, and refusing anonymous callers would break every harness that drives the console directly.
  * The plan (/api/mission). A second screen may draw and save while the first supervises; the plan's own revision
    guard (review #10) is what stops two tabs overwriting each other, and it already works.
  * The boat, WHILE ANOTHER TAB IS STILL REPORTING. A lapse there is an ALARM, not a hold: a browser hiccup
    stopping a survey mid-line is its own hazard, and nothing the vessel does depends on the page.
    ⚠ BUT NO TAB AT ALL IS NOW A CONDITION WITH A CLOCK ON IT (Andy, 2026-11-02, after Honolulu: an armed boat
    surveyed for 7 h 21 m with every page dead and no guard running anywhere). The console re-says the lapse,
    forgets a dead holder on its own watch, PAUSES her at the hull's planning.supervisor_lost_s, latches that
    against every automatic resume, and asks once for a fresh chart window. That half is
    tests/supervision_standdown.py; this suite still owns the question of WHICH tab is in charge, and not one
    of its answers changed.

2026-09-16, Andy: "the supervisory tab process is broken." In his session the post changed hands ten times in twelve
minutes between the two windows the console opens itself. The console's half of the fix has checks here:
  * A STALE POST GOES ONLY TO A TAB THAT IS REPORTING STEADILY (8b, 8c). Two throttled windows each woke once a minute,
    found the other stale and took over. A first report after a silence - or a first report ever - takes nothing.
  * ONE LATE BEAT IS NOT A LAPSE (8). Every lapse in that session was 6.3-6.9 s old against a 6 s limit.
  * AN IDLE STREAM TICKS (10b). The page reports as it handles the event stream now, so a console with no frame to
    send must still send something the page can see - a named event, which a page's onmessage never receives.
(The page's half - the controls window never reports, and reports ride the stream - is tests/supervisor_page.js.)

    python tests/supervisor.py      # exit 0 = pass, 1 = fail   (stdlib only)

TEETH - 12 mutations RUN in a scratch clone (sidecar original, atomic writes, no bytecode, byte-compared afterwards),
12/12 caught:
    the first tab in is not granted the post -> 2, 3, 4, 9   a second tab takes it by reporting in -> 3, 4
    a non-holder's command is not refused -> 4, 7            a stop is refused like anything else -> 5
    a script with no tab name is refused too -> 6            TAKE OVER is ignored -> 7, 8
    a stale holder keeps the post -> 8b, 9, 10               the state never says the holder is stale -> 8, 10, 11
    release does nothing -> 9, 10                            the heartbeat is logged as a command -> 10
    a lapse is never said -> 10, 11                          the state does not carry supervision at all -> 1, 2, 8
⚠ THE LAST ONE FIRST CRASHED THIS SUITE INSTEAD OF FAILING A CHECK, and a crash is not a catch: the setup between
checks read state()["supervisor"] directly, so a console publishing none killed the run before a FAIL line printed -
which a mutation runner scores as a SURVIVAL. Everything outside a check() thunk reads with .get now. The same trap is
recorded in tests/log_compress.py's header, three items earlier, which is how it was spotted here.
(Written when 8b said "another tab takes the post by simply reporting in"; that line is now 8b + 8c, below.)

TEETH for the 2026-09-16 fix - 9 mutations RUN the same way, 9/9 caught, none by a crash:
    a stale post goes to any tab that reports (the old rule) -> 8b
    a stale post goes to nobody -> 8c, 9, 10               steady ignores how old the previous report is -> 8b
    a first-ever report counts as steady -> 8b, 8c, 9, 10  stale after 6 s again -> 8
    an idle stream sends a comment again -> 10b            the idle tick is an unnamed message -> 10b
    the idle tick has no data line (a page never dispatches it) -> 10b
    the stream ticks every 5 s again -> 10b
"""

import http.client
import json
import os
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
sys.path.insert(0, APP)
sys.path.insert(0, os.path.join(HERE, "lib"))
from console_state import ConsoleState  # noqa: E402

fails = 0
ran = 0


def check(name, cond, detail=""):
    global fails, ran
    ran += 1
    try:
        ok = bool(cond() if callable(cond) else cond)
        if callable(detail):
            detail = detail()
    except Exception as e:
        ok, detail = False, "THREW %s: %s" % (type(e).__name__, e)
    print(("  ok   " if ok else "  FAIL ") + name + ("   [%s]" % detail if detail else ""))
    if not ok:
        fails += 1


def free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def post(port, path, body=None, tab=None, timeout=8):
    """(code, obj). `tab` is the browser tab's own name, which the page sends on every command."""
    url = "http://127.0.0.1:%d%s" % (port, path)
    headers = {"Content-Type": "application/json"}
    if tab:
        headers["X-ASV-Client"] = tab
    req = urllib.request.Request(url, data=json.dumps(body or {}).encode(), headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def state(port):
    with urllib.request.urlopen("http://127.0.0.1:%d/api/state" % port, timeout=8) as r:
        return json.loads(r.read().decode())


def beat(port, tab, take=False):
    return post(port, "/api/supervisor", {"id": tab, "take": take} if take else {"id": tab})[1]


def session_records(path):
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


print("One tab supervises; the others watch:")

STATE = ConsoleState(prefix="asv_supervisor_")
LOG_DIR = STATE.path("logs")
before = set(os.listdir(LOG_DIR)) if os.path.isdir(LOG_DIR) else set()
port = free_port()
srvlog = tempfile.TemporaryFile(mode="w+")
# NO --no-log: what supervision DOES is written to the session recording, and check 10 reads it there.
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none", "--port", str(port),
                         "--no-ais-service", *STATE.args()], cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
try:
    up = False
    for _ in range(80):
        try:
            if state(port):
                up = True
                break
        except Exception:
            time.sleep(0.5)
    check("1. a console comes up with nobody supervising - a console nobody has opened is not waiting for permission",
          lambda: up and (state(port).get("supervisor") or {}).get("holder", "missing") is None
          and (state(port).get("supervisor") or {}).get("tabs") == 0,
          lambda: json.dumps(state(port).get("supervisor")) if up else "the console did not come up")
    if not up:
        raise SystemExit(1)

    r1 = beat(port, "tab-one")
    check("2. the first tab to report in is the supervisor, and the state says which tab and for how long",
          lambda: r1["supervisor"]["holder"] == "tab-one" and r1["you"] is True
          and (state(port).get("supervisor") or {}).get("holder") == "tab-one"
          and (state(port).get("supervisor") or {}).get("age_s") is not None,
          lambda: json.dumps(r1))

    r2 = beat(port, "tab-two")
    check("3. a second tab reporting in does NOT take it - supervision is granted once and handed over deliberately",
          lambda: r2["supervisor"]["holder"] == "tab-one" and r2["you"] is False
          and r2["supervisor"]["tabs"] == 2,
          lambda: json.dumps(r2))

    c_two, b_two = post(port, "/api/cmd/arm", {"on": True}, tab="tab-two")
    c_one, b_one = post(port, "/api/cmd/arm", {"on": True}, tab="tab-one")
    check("4. the second tab's command is REFUSED in words, and the supervising tab's identical command is taken",
          lambda: c_two == 409 and "supervising" in b_two["error"] and "TAKE OVER" in b_two["error"]
          and c_one == 200 and state(port)["armed"] is True,
          lambda: "view-only tab: %d %s | supervising tab: %d" % (c_two, b_two.get("error", "")[:60], c_one))

    stops = {p: post(port, "/api/cmd/" + p, {"on": True} if p == "estop" else {}, tab="tab-two")[0]
             for p in ("stop", "pause", "estop")}
    post(port, "/api/cmd/estop", {"on": False}, tab="tab-one")
    check("5. STOP, PAUSE and E-STOP are taken from ANY tab - a control that reduces risk is never gated on which "
          "tab is in charge",
          lambda: all(c == 200 for c in stops.values()), lambda: str(stops))

    c_script, _b = post(port, "/api/cmd/arm", {"on": True})          # no tab name at all
    check("6. a caller with no tab name is not refused - this guards the operator's second window, not the API, and "
          "every harness that drives the console directly would break",
          lambda: c_script == 200, "a script, a suite, curl")

    r3 = beat(port, "tab-two", take=True)
    c_one2, b_one2 = post(port, "/api/cmd/arm", {"on": False}, tab="tab-one")
    check("7. TAKE OVER moves supervision at once, and the tab that had it is refused from then on",
          lambda: r3["supervisor"]["holder"] == "tab-two" and r3["you"] is True and c_one2 == 409,
          lambda: "holder %s; the old tab now gets %d" % (r3["supervisor"]["holder"], c_one2))

    # A third tab reports ONCE, now, and then goes as quiet as the holder is about to - the throttled window of
    # 2026-09-16, which woke once a minute. (Tab-two has just taken the post, so this report takes nothing.)
    beat(port, "tab-three")

    # 8. THE ONE THE ITEM IS ABOUT: the supervising tab stops reporting (asleep, throttled, crashed).
    # ⚠ READ WITH .get FROM HERE DOWN: this is setup, not a check, and a console that published no supervision at
    # all would kill the suite before a FAIL line printed - which a mutation runner scores as a SURVIVAL.
    stale_s = (r3.get("supervisor") or {}).get("stale_s", 10.0)
    t0 = time.time()
    snap = state(port).get("supervisor") or {}
    while not snap.get("stale") and time.time() - t0 < stale_s + 6:
        time.sleep(0.5)
        snap = state(port).get("supervisor") or {}
    check("8. a supervising tab that stops reporting is STALE in the state after stale_s - the console says the page "
          "is not watching, and says it without being asked. And stale_s is at least four beats: one late beat, or "
          "two, is a page that was busy, not one that stopped (every lapse on 2026-09-16 was one beat late)",
          lambda: snap.get("stale") is True and snap.get("holder") == "tab-two" and snap.get("age_s") >= stale_s
          and snap.get("stale_s", 0) >= 4 * snap.get("beat_s", 1e9),
          lambda: "stale=%s after %.1f s (holder %s, age %s; stale_s %s, beat_s %s)"
                  % (snap.get("stale"), time.time() - t0, snap.get("holder"), snap.get("age_s"),
                     snap.get("stale_s"), snap.get("beat_s")))

    # Leave it stale a moment before anyone takes over: the console's own watch looks once a second, and a post that
    # is taken back inside that second is not a lapse anybody needed telling about (checks 10 and 11 read what it said).
    time.sleep(2.5)
    r4 = beat(port, "tab-three")          # its first report since it went quiet with the holder
    r4n = beat(port, "tab-new")           # a tab reporting for the very first time
    check("8b. a tab reporting after a silence of its OWN does not take the stale post on that report, and nor does a "
          "tab reporting for the first time - either may be about to go quiet again, which is how two throttled "
          "windows passed the post back and forth once a minute",
          lambda: r4["supervisor"]["holder"] == "tab-two" and r4["you"] is False
          and r4n["supervisor"]["holder"] == "tab-two" and r4n["you"] is False,
          lambda: "after tab-three: %s; after tab-new: %s" % (r4["supervisor"]["holder"], r4n["supervisor"]["holder"]))

    r4b = beat(port, "tab-three")         # ... and again, a beat later: it is reporting steadily now
    check("8c. ... but its NEXT report, while it keeps reporting, does take it - a tab that is not running its ladder "
          "cannot keep supervision from one that is",
          lambda: r4b["supervisor"]["holder"] == "tab-three" and r4b["you"] is True
          and r4b["supervisor"]["stale"] is False,
          lambda: json.dumps(r4b["supervisor"]))

    rel = post(port, "/api/supervisor", {"id": "tab-three", "release": True})[1]
    r5 = beat(port, "tab-four")
    check("9. a tab that is closing RELEASES the post, so the next tab does not wait out the stale timer - an EMPTY "
          "post goes to the first tab that reports, steady or not",
          lambda: rel["supervisor"]["holder"] is None and r5["supervisor"]["holder"] == "tab-four",
          lambda: "after release: %s; next tab: %s" % (rel["supervisor"]["holder"], r5["supervisor"]["holder"]))
    # let it go again, so a holder nobody is reporting for cannot lapse while check 10b idles the stream (check 11
    # counts lapses)
    post(port, "/api/supervisor", {"id": "tab-four", "release": True})

    # 10. what is written down - and what is NOT
    new = sorted(set(os.listdir(LOG_DIR)) - before)
    spath = os.path.join(LOG_DIR, new[0]) if new else None
    recs = session_records(spath) if spath else []
    kinds = [r.get("kind") for r in recs]
    beats = [r for r in recs if r.get("kind") == "command" and r.get("path") == "/api/supervisor"]
    took = [r for r in recs if r.get("kind") == "supervisor_took"]
    check("10. the session recording carries what supervision DID - a tab taking it, taking over, letting it go, "
          "going quiet - and not one line of the heartbeat that would bury the record",
          lambda: not beats and len(took) >= 2 and "supervisor_released" in kinds
          and "supervisor_lapsed" in kinds,
          lambda: "%d heartbeat records; took %d; %s" % (len(beats), len(took),
                                                         ", ".join(k for k in kinds if k.startswith("supervisor"))))
    # 10b. AN IDLE STREAM TICKS. With no link there is no telemetry to publish, so the event stream would carry nothing
    # a page can see between frames - and the page reports in as it handles that stream.
    post(port, "/api/disconnect", {})
    time.sleep(0.5)
    beat_s = (r3.get("supervisor") or {}).get("beat_s", 2.0)
    lines = []
    sse = http.client.HTTPConnection("127.0.0.1", port, timeout=beat_s + 2)
    try:
        sse.request("GET", "/events")
        resp = sse.getresponse()
        t_sse = time.time()
        while time.time() - t_sse < 2 * beat_s + 2.5:
            ln = resp.readline()
            if not ln:
                break
            lines.append(ln.decode("utf-8", "replace").rstrip("\r\n"))
    except (socket.timeout, OSError) as e:
        lines.append("(stream: %s)" % e)
    finally:
        sse.close()
    # a tick whose data line fell after the read stopped is not counted either way
    ticks = [i for i, ln in enumerate(lines) if ln == "event: tick" and i + 1 < len(lines)]
    check("10b. a console with nothing to stream still TICKS, at least once a beat, as a NAMED event with a data line - "
          "a page's onmessage never receives it, so it cannot pass for a telemetry frame, and a comment would be "
          "invisible to the page altogether",
          lambda: len(ticks) >= 2 and all(lines[i + 1].startswith("data: ") and '"type"' not in lines[i + 1]
                                          for i in ticks)
          and not any(ln.startswith(":") for ln in lines),
          lambda: "%d tick(s) in %.1f s; %s" % (len(ticks), 2 * beat_s + 2.5,
                                                 " | ".join(ln[:24] for ln in lines if ln)[:150]))
finally:
    try:
        proc.terminate()
        proc.wait(timeout=10)
    except Exception:
        proc.kill()
    for f in sorted(set(os.listdir(LOG_DIR)) - before):
        try:
            os.remove(os.path.join(LOG_DIR, f))
        except OSError:
            pass

srvlog.seek(0)
server_out = srvlog.read()
srvlog.close()
# ⚠ 11's TAIL CHANGED WITH THE STAND-DOWN (2026-11-02), and it was "Nothing was stopped." unconditionally.
# It is no longer true of every case, so the line now names WHICH of the three this lapse is. Here the boat is
# not under autonomous command, so nothing is stopped and nothing is going to be - that is the branch asserted.
# The armed-and-running branch, which says the way comes off, is tests/supervision_standdown.py's.
_lapse = next((l for l in server_out.splitlines() if "has not reported" in l), "")
check("11. the console SAYS the supervising tab went quiet, on its own console, once - and the line says what "
      "FOLLOWS, which is not the same sentence for every lapse any more",
      lambda: server_out.count("has not reported for") == 1
              and "the page's clearance guard and speed governor are not running." in _lapse
              and _lapse.rstrip().endswith("Nothing is stopped.")
              and "the way comes off" not in _lapse,          # she is not armed and running in this scenario
      lambda: _lapse[:150] or "(nothing said)")
from server_log import exception_lines  # noqa: E402
tb = exception_lines(server_out)
check("12. and it logged NO exception while serving any of it",
      not tb, ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb else "")

# 13. A TAB THAT IS PLANNING KEEPS ITS POST (2026-10-12). Andy: "another browser tab is grabbing the process so cannot start
# a mission". His Go-To's route search held the supervising page 11 s, then 17.8 s; a page that is computing cannot report,
# so the post went stale, his other chart tab - steady - took it, and the Go-To was refused when it went. The page now says
# it is about to plan (`busy_s`); here the console's half, on the Supervision class itself with its own clock.
import contextlib  # noqa: E402
import io  # noqa: E402
import asv_console as A  # noqa: E402

T = 1000.0


def steady(sv, tab, t):
    sv.beat(tab, now=t - 1.0)            # a tab reporting a beat apart: steady
    return sv.beat(tab, now=t)


sv = A.Supervision()
sv.beat("planner", now=T)
steady(sv, "other", T + 1)
sv.beat("planner", busy_s=60, now=T + 2)            # about to plan
mid = steady(sv, "other", T + 25)                   # 23 s of silence: stale but for the plan
late = steady(sv, "other", T + 63)                  # the plan's 60 s run out, still silent: stale now
sv2 = A.Supervision()
sv2.beat("planner", now=T)
sv2.beat("planner", busy_s=60, now=T + 1)
sv2.beat("planner", now=T + 3)                      # its next ordinary report: the plan is done
back = steady(sv2, "other", T + 15)                 # 12 s silent after it: stale, and handed over as ever
sv3 = A.Supervision()
sv3.beat("planner", now=T)
sv3.beat("planner", busy_s=1000, now=T + 1)         # asked for more than the most
capped = steady(sv3, "other", T + 63)
sv4 = A.Supervision()
sv4.beat("planner", now=T)
sv4.beat("other", busy_s=60, now=T + 1)             # a tab that is NOT the supervisor says it is planning: nothing
sv4.beat("other", now=T + 2)
notHolder = steady(sv4, "other", T + 13)
sv5 = A.Supervision()
sv5.beat("planner", now=T)
sv5.beat("planner", busy_s=60, now=T + 1)
took = sv5.beat("other", take=True, now=T + 5)      # a deliberate TAKE OVER still moves it
check("13. A TAB THAT IS PLANNING KEEPS ITS POST: a supervisor that said it is about to plan is not stale - and no steady "
      "tab takes the post - for as long as it said (busy in the state, not stale); then the old rule; its next ordinary "
      "report ends it; at most SUPERVISOR_BUSY_MAX_S; a non-supervisor's word is nothing; a TAKE OVER still moves it",
      lambda: mid["holder"] == "planner" and mid["busy"] is True and mid["stale"] is False
      and late["holder"] == "other" and back["holder"] == "other" and capped["holder"] == "other"
      and A.SUPERVISOR_BUSY_MAX_S == 60 and notHolder["holder"] == "other" and took["holder"] == "other"
      and took["busy"] is False,
      lambda: json.dumps({"mid": [mid["holder"], mid["busy"], mid["stale"]], "late": late["holder"], "back": back["holder"],
                          "capped": capped["holder"], "notHolder": notHolder["holder"], "took": [took["holder"], took["busy"]]}))

# 13b. the console says a long plan ONCE as what it is - no lapse - and a lapse once the plan's time is out
sv6 = A.Supervision()
sv6.beat("planner", now=T)
sv6.beat("planner", busy_s=30, now=T + 1)
said = io.StringIO()
with contextlib.redirect_stdout(said), contextlib.redirect_stderr(said):
    for k in range(5, 45, 2):
        sv6.check_once(now=T + k)
out6 = said.getvalue()
check("13b. ... and the console SAYS a plan that outlasts the stale time once, as a plan - no lapse while it holds - and "
      "the lapse once its time is out",
      lambda: out6.count("is planning a route") == 1 and out6.count("has not reported for") == 1
      and out6.index("is planning a route") < out6.index("has not reported for"),
      lambda: " | ".join(l[:70].encode("ascii", "replace").decode() for l in out6.splitlines()))

# 13c. the report's busy_s, read
vals = {"60": A._busy_seconds(60), "2.5": A._busy_seconds(2.5), "str": A._busy_seconds("60"), "bool": A._busy_seconds(True),
        "nan": A._busy_seconds(float("nan")), "neg": A._busy_seconds(-5), "zero": A._busy_seconds(0), "none": A._busy_seconds(None)}
check("13c. a report's busy_s is a finite positive number of seconds or nothing - a string, a boolean, a NaN, a negative "
      "or a zero say nothing",
      lambda: vals["60"] == 60.0 and vals["2.5"] == 2.5 and all(vals[k] is None for k in ("str", "bool", "nan", "neg", "zero", "none")),
      lambda: json.dumps(vals))

# ── 14. THE SUPERVISING TAB'S "AVOIDING" RECORD, SERVED TO EVERY PAGE (2026-11-03) ───────────────────────────
# Andy, 2026-11-02: "Create a flag that attaches to the ASV an reads AVOIDING until it's back on line or natural
# transit". Only the supervising page can raise it - it runs the ladder, it moved her, and it holds the route whose
# waypoint index lowers it again - so review found the badge invisible in every other window: a second chart tab, the
# controls window, anyone watching the same console. It rides this heartbeat rather than a channel of its own, so it
# inherits this class's staleness and its prune. The page's half is tests/supervisor_page.js 6c-6f.
# ⚠ WHAT THE PAGE SENDS IS NOT WHAT THE CONSOLE SERVES ANY MORE (2026-11-03, review). The page sends `why` and
# `kind` and nothing else - `since` was its own clock and no page ever read it - and the snapshot adds `for_s`,
# measured on the CONSOLE's clock so two machines watching one console agree, and `inherited`, which tells a new
# holder there is a maneuver to adopt.
RAISED = {"why": "routed round", "kind": "a dock / pier"}


def served(snap, **extra):
    want = dict(RAISED)
    want.update(extra)
    return snap["avoiding"] == want


sv7 = A.Supervision()
sv7.beat("main", now=T)
pub = sv7.beat("main", avoiding=RAISED, set_avoiding=True, now=T + 1)
# a tab that is NOT the supervisor cannot write it: it cannot raise the flag, so it must not be able to lower it
steady(sv7, "other", T + 2)
notMine = sv7.beat("other", avoiding=None, set_avoiding=True, now=T + 3)
# a POST that says nothing about it (the "about to plan" one) leaves it alone: PRESENCE, not value
busyKept = sv7.beat("main", busy_s=60, now=T + 4)
# ... and the holder's own next beat, with the record down, lowers it
lowered = sv7.beat("main", avoiding=None, set_avoiding=True, now=T + 5)
# a record from a STALE holder is not served: nothing is lowering the flag either, so a badge from it would be a
# claim nobody is behind
sv8 = A.Supervision()
sv8.beat("main", now=T)
sv8.beat("main", avoiding=RAISED, set_avoiding=True, now=T + 1)
stalePub = sv8.snapshot(now=T + 1 + A.SUPERVISOR_STALE_S + 1)
# the tab goes away, by saying so and by being forgotten: both drop it
sv9 = A.Supervision()
sv9.beat("main", now=T)
sv9.beat("main", avoiding=RAISED, set_avoiding=True, now=T + 1)
released = sv9.release("main", now=T + 2)
sv10 = A.Supervision()
sv10.beat("main", now=T)
sv10.beat("main", avoiding=RAISED, set_avoiding=True, now=T + 1)
forgotten = sv10.check_once(now=T + 1 + A.SUPERVISOR_FORGET_S + 1)
check("14. the supervising tab's AVOIDING record is served to every page - from the HOLDER only, with a POST that says "
      "nothing about it leaving it alone and the holder's own null lowering it - and it is not served by a tab that has "
      "gone stale, said it is leaving, or been forgotten",
      # the record was stamped at T+1, so `for_s` counts from there on the CONSOLE's clock
      lambda: served(pub, for_s=0.0, inherited=False) and served(notMine, for_s=2.0, inherited=False)
      and served(busyKept, for_s=3.0, inherited=False)
      and lowered["avoiding"] is None and stalePub["avoiding"] is None and released["avoiding"] is None
      and forgotten["avoiding"] is None,
      lambda: json.dumps({"published": pub["avoiding"], "a view-only tab's null": notMine["avoiding"],
                          "after the busy POST": busyKept["avoiding"], "lowered": lowered["avoiding"],
                          "stale": stalePub["avoiding"], "released": released["avoiding"],
                          "forgotten": forgotten["avoiding"]}))

# ── 14c. A HANDOVER DOES NOT END THE MANEUVER (2026-11-03, the third review, found by two lenses) ─────────────
# The record used to be dropped the moment the post changed hands - "the new holder's own first beat says what IT
# has" - and the measured consequence was that pressing TAKE OVER mid-way-round, or reloading the supervising
# tab, took AVOIDING off every chart in the building while the console still had her off her planned track, with
# no path back: every raise sits inside its own command's reply handler, and the tab now in charge commanded
# nothing. His instruction was a flag that reads AVOIDING "until it's back on line or natural transit"; a
# handover is neither. So the record is KEPT, marked `inherited`, and the new holder adopts it (its page half is
# tests/supervisor_page.js 6g) - and until it does, its empty beats cannot erase what it has not seen yet,
# because its very first beat is sent BEFORE the snapshot that carries the record reaches it.
sv11 = A.Supervision()
sv11.beat("main", now=T)
sv11.beat("main", avoiding=RAISED, set_avoiding=True, now=T + 1)
handed = sv11.beat("other", take=True, now=T + 2)              # the TAKE OVER post: its own `avoiding` is null
handedAgain = sv11.beat("other", avoiding=None, set_avoiding=True, now=T + 3)   # and its next empty beat
adopted = sv11.beat("other", avoiding={"why": "routed round", "kind": "a dock / pier"},
                    set_avoiding=True, now=T + 4)              # the page adopted it: now it is the holder's own
afterAdopt = sv11.beat("other", avoiding=None, set_avoiding=True, now=T + 5)    # ... and can be lowered
# and a holder that NEVER adopts cannot strand the flag: past the orphan window its empty beats erase it
sv12 = A.Supervision()
sv12.beat("main", now=T)
sv12.beat("main", avoiding=RAISED, set_avoiding=True, now=T + 1)
sv12.beat("other", take=True, now=T + 2)
neverAdopt = sv12.beat("other", avoiding=None, set_avoiding=True, now=T + 2 + A.SUPERVISOR_STALE_S + 1)
check("14c. a HANDOVER keeps the record and offers it to the new holder, marked `inherited` - the flag is a fact "
      "about the BOAT, not about which tab is reporting - and the new holder's empty beats cannot erase a record "
      "it has not adopted yet, while one that never adopts cannot strand it past the orphan window",
      lambda: served(handed, for_s=1.0, inherited=True) and served(handedAgain, for_s=2.0, inherited=True)
      and served(adopted, for_s=3.0, inherited=False) and afterAdopt["avoiding"] is None
      and neverAdopt["avoiding"] is None,
      lambda: json.dumps({"handed over": handed["avoiding"], "its next empty beat": handedAgain["avoiding"],
                          "adopted": adopted["avoiding"], "then lowered": afterAdopt["avoiding"],
                          "never adopted, past the window": neverAdopt["avoiding"]}))

# ── 14d. AND `busy` DOES NOT CERTIFY A PROMISE (2026-11-03, review, measured) ─────────────────────────────────
# `stale` carries `and not busy`, and `busy` is what the page POSTs for SUPERVISOR_BUSY_MAX_S immediately before
# every on-thread route search - 11 s and 17.8 s measured on the Piscataqua, and a page is killed during a long
# synchronous search more readily than at any other moment (the machine-OOM kill is on this console's record).
# Keyed on `stale`, the record of a holder that died while planning went on being served to every page: measured
# at t+46 s with tabs 0, busy True, stale False and the badge still published - one second before the supervision
# stand-down takes the way off an armed running boat, under a banner promising something was putting her back.
# `busy` exists to protect the post from a takeover and the stand-down from a false alarm; it was never a reason
# to go on asserting a maneuver on behalf of a tab that has stopped reporting.
sv13 = A.Supervision()
sv13.beat("main", now=T)
sv13.beat("main", avoiding=RAISED, set_avoiding=True, now=T + 1)
sv13.beat("main", busy_s=60, now=T + 2)                        # "I am about to plan", then the page dies
busyAt3 = sv13.snapshot(now=T + 3)
busyAt46 = sv13.snapshot(now=T + 46)
check("14d. ... and a holder that said it was PLANNING and then died stops having its badge served the moment it "
      "stops reporting: the gate is the holder's own reporting age, not `stale`, which `busy` suppresses for a "
      "minute - long enough to reach the supervision stand-down with every page still showing the flag",
      lambda: served(busyAt3, for_s=2.0, inherited=False)
      and busyAt46["avoiding"] is None and busyAt46["busy"] is True and busyAt46["stale"] is False
      and busyAt46["tabs"] == 0 and busyAt46["age_s"] > A.SUPERVISOR_STALE_S,
      lambda: json.dumps({"at +3 s": busyAt3["avoiding"],
                          "at +46 s": {"avoiding": busyAt46["avoiding"], "busy": busyAt46["busy"],
                                       "stale": busyAt46["stale"], "tabs": busyAt46["tabs"],
                                       "age_s": busyAt46["age_s"]}}))

# 14b. IT IS CLIENT-SUPPLIED, so it is rebuilt field by field: anything that is not one of the three maneuvers the
# flag names is nothing, the kind is capped, and nothing a page sends can raise an exception in the heartbeat - which
# is a safety channel, and the one POST that must never be breakable by a bad body.
clean = A.Supervision._clean_avoiding
avVals = {
    "ok": clean({"why": "deviated", "kind": "a shoal"}),
    "unknown why": clean({"why": "wandered off", "kind": "a shoal"}),
    "no why": clean({"kind": "a shoal"}),
    "no kind": clean({"why": "steered clear"}),
    "long kind": clean({"why": "steered clear", "kind": "x" * 500}),
    # ⚠ `since` IS NO LONGER STORED AT ALL (2026-11-03, review): no page read it, and it was the RAISING page's
    # clock, so an elapsed time built from it was wrong on every other machine by whatever two clocks disagree
    # by. The console stamps the record's arrival itself. One fewer client-supplied number on a safety channel.
    "a since is dropped": clean({"why": "deviated", "kind": "a shoal", "since": 1.0}),
    "odd since": clean({"why": "deviated", "kind": "a shoal", "since": "yesterday"}),
    "extra fields": clean({"why": "deviated", "kind": "a shoal", "since": 1.0, "rejoin": 7, "odd": {"a": [1, 2]}}),
    "not a dict": clean("AVOIDING"),
    "none": clean(None),
}
check("14b. ... and the record is rebuilt field by field from what the page sent: an unknown maneuver, a missing one and "
      "a body that is not an object are all nothing; the kind is capped; and every other field a page sends - `since` "
      "and `rejoin` included - is simply not stored",
      lambda: avVals["ok"] == {"why": "deviated", "kind": "a shoal"}
      and avVals["unknown why"] is None and avVals["no why"] is None and avVals["not a dict"] is None
      and avVals["none"] is None
      and avVals["no kind"] == {"why": "steered clear", "kind": "something in her way"}
      and len(avVals["long kind"]["kind"]) == 120
      and avVals["a since is dropped"] == {"why": "deviated", "kind": "a shoal"}
      and avVals["odd since"] == {"why": "deviated", "kind": "a shoal"}
      and sorted(avVals["extra fields"].keys()) == ["kind", "why"],
      lambda: json.dumps({k: (dict(v, kind="<%d chars>" % len(v["kind"]))
                              if isinstance(v, dict) and len(str(v.get("kind", ""))) > 40 else v)
                          for k, v in avVals.items()}))

print(("\n%d CHECK(S) FAILED (%d ran)" % (fails, ran)) if fails else ("\nall checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
