"""tests/data_routes.py - the last four uncovered surfaces: /api/vessels (+ the vessel
switch's SAFE gate), /api/comms (the password's THREE never-leak properties), /api/tide,
and /api/roc's HTTP layer.

WHY THIS EXISTS. These are the remaining routes from the coverage list - thin wrappers,
which is exactly why they were last, but each carries one contract that is nowhere else:
  * THE VESSEL SWITCH IS GATED SAFE: switching physics under a running boat is
    incoherent, so /api/vessel POST refuses 409 unless disarmed + idle. The gate was
    read in code the day the audit started and has never been exercised. The successful
    switch's observable is the ENERGY GAUGE FLIP: drix08 is fuel, zboat_1800hs is
    battery, and the state's energy_type + the null-ness of fuel_l/battery_v must all
    flip - which proves apply_vessel ran AND the sim respawned as the new boat, not
    that a name changed.
  * THE COMMS PASSWORD NEVER LEAVES: (1) never PERSISTED - comms_config.json carries
    mode/host/username only ("memory only - never persisted" is a comment in
    CommsConfig; this makes it a contract); (2) never ECHOED - the GET builds its
    config dict without the field; (3) never LOGGED - _redact masks it to "***" in the
    session recorder's command records. Three separate leak paths, three separate
    checks, and the third needs LOGGING ON - the same --no-log mask log_routes.py
    found. Also: the mode whitelist IGNORES an unknown mode (keeps the current one)
    rather than storing garbage the poll loop would then act on.
  * /api/tide is WATER.tide_series passed through: it must ANSWER (200, a dict with
    "ok") whatever the upstream's mood - CO-OPS being down degrades the body, never
    the response - and the force=1 spelling is accepted.
  * /api/roc's HTTP layer maps errors the tracker's own unit tests (roc_tracks.py)
    never see: unknown op -> 400 naming it; malformed args -> 400 "bad roc request";
    a feed for an id that does not exist -> 404 with ok false. And a successful add
    echoes the fresh snapshot, so the UI never needs a second round trip.

    python tests/data_routes.py     # exit 0 = pass, 1 = fail   (stdlib only)

ORDER MATTERS in this suite and is deliberate: tide and roc run BEFORE the vessel
switch, because switching to zboat_1800hs respawns the boat on LAKE ERIE - a
position-dependent service polled after that would be answering for the wrong sea. The
switch block runs LAST and switches back to drix08 to leave the console as found.

⚠ FIVE OF THESE CHECKS ARE NETWORKED, AND A STALL USED TO CRASH THE SUITE (2026-09-19).
/api/tide fetches CO-OPS inline and a port added by NAME is a geocode plus an ENC extract,
so the test's own call can run out of budget while the console sits waiting on a slow
upstream - which raised TimeoutError outside any check(), the crash guard reported "the
suite CRASHED", and an unrelated commit was blocked through the hook. The three properties
that hold now, and what each one is protecting against, are in the block above net_api:
  * a networked check SKIPS, visibly, and the summary line repeats it - a run that skipped
    can never be read as a clean pass;
  * a CONSOLE that has stopped answering is still REPORTED (net_api asks /api/state, which
    has no external service on its path, before it agrees to call a stall weather);
  * the skip is keyed on the console's own "[ports] geocoder unreachable" note, NOT on the
    400 - which reads "(no geocoder, or no such place)" for both causes, so the old
    condition skipped whenever a lookup failed for any reason at all.

TEETH, THE NETWORKED SKIP (2026-09-19) - twelve mutations RUN, 11 caught, and the one
survivor recorded as a survivor. Two fixture defects and one non-determinism came out of
RUNNING them, each noted where it was fixed:
  * console_alive always True                            -> 1c
  * console_alive always False                           -> 1b, 1d, 1e
  * net_api's liveness gate removed, i.e. the timeout
    caught broadly - which is the trap, because that
    swallows a console that has genuinely hung           -> 1c
  * net_api does not catch the timeout at all            -> 1c, 1d, 1e
  * _is_timeout loses the URLError-WRAPPED case          -> 1d
  * _is_timeout true for every exception, so a REFUSED
    connection would read as weather                     -> 1d
  * the one-stall-per-upstream short circuit removed     -> 1e
  * NET_BUDGET_S back to 420 s                           -> 1f
  * geocoder_unreachable always False                    -> 1g
  * geocoder_unreachable always True                     -> 1g
  * PRODUCT (asv_console.py): geocode_place always None - a lookup that is BROKEN rather than
    unreachable, which is exactly what the old skip condition could not see
                                                         -> 12f, 12g, 12h, 12i.
    ⚠ UNDER THE OLD CONDITION THIS PRINTED "skip 12f-12h" AND THE SUITE PASSED.
  * 12i judged without its `ci == 200` clause            -> SURVIVED, and it is honest to say
    so rather than dress it up: a reachable geocoder always answers 200 for Denver, so no
    fixture here can produce a non-200 from a WORKING lookup. What the clause buys is that
    such a run is REPORTED - the detail line carries code=400 - instead of being dropped in
    silence, which is what the old `if ci == 200:` guard did. The mutation above reds 12i
    through its other clauses regardless.
  * PRODUCT: /api/tide's handler BLOCKS instead of answering -> NOTHING RED HERE, BY DESIGN.
    Check 3 skips and the suite passes: this suite cannot tell a blocked handler from a
    stalled CO-OPS and does not pretend to. tests/http_contract.py check 14 is what covers
    that, and the same mutation reds 14 (and 6) there - verified. That division of labour is
    why both suites moved together rather than this one alone.

TEETH - eight mutations RUN, 8/8 caught after one weak check was exposed and
strengthened (recorded results; house rules: missing anchor = SKIP, crash scored
separately, source restored byte-for-byte):
  * the switch's SAFE gate dropped                      -> caught by 8
  * the switch stops respawning in sim                  -> SURVIVED the first version
    of check 9, and the survival was the finding: the energy gauge reads the module
    global POWER_TYPE at snapshot time, so the OLD boat starts reporting "battery"
    the moment apply_vessel runs - the flip proves apply_vessel, NOT the respawn my
    rationale claimed. Check 9 now also demands the boat come up at the NEW vessel's
    OWN spawn (Lake Erie, not Lewes) - the one observable a respawn uniquely
    produces - and the re-run is caught by 9. Same family as the estop lesson: pick
    the observable that only the mechanism under test can produce.
  * _redact stops masking (raw body logged)             -> caught by 5
  * the comms GET echoes the password                   -> caught by 4
  * the saved comms config gains the password           -> caught by 6
  * the mode whitelist dropped                          -> caught by 7
  * roc's unknown-op 400 becomes a generic 200          -> caught by 11
  * roc's feed-unknown-id 404 becomes 200               -> caught by 12
"""

import io
import json
import os
import re
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request


class ConsoleHung(Exception):
    """The console stopped answering its own state while a request was outstanding.

    A DEFECT, not the weather - which is why net_api raises this instead of skipping, and
    why the crash guard below reports it under its own name: "CRASHED" reads as a harness
    fault and would send the next reader to this file rather than to the console."""


# --- crash guard: a throw outside a check() must still REPORT ---------------------------
# check() turns an exception inside its own thunk into a failed check. Scenario SETUP is
# not inside one - booting a console, driving an endpoint, waiting on a fix - and an
# exception there would end the process before a single FAIL line printed. "No FAIL lines"
# and "the process died" are indistinguishable to anything reading stdout, so a mutation
# that crashes this suite would score as SURVIVED rather than caught. Report it instead, in
# this suite's normal format; Python still exits non-zero on its own.
def _crash_report(_t, _e, _tb):
    import traceback
    if _t is ConsoleHung:
        print("  FAIL 0. the console HUNG - %s" % _e)
        print("\n1 CHECK(S) FAILED (the console stopped answering)")
        return
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
    url = "http://127.0.0.1:%d%s" % (port, path)
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"} if data else {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode())


def cmd(port, path, body=None):
    """POST; {} minimum so a bodyless command can never degrade to a GET."""
    return api(port, path, body if body is not None else {})


def state(port):
    return api(port, "/api/state")[1]


# --- A NETWORKED CHECK SKIPS, VISIBLY - AND A HUNG CONSOLE STILL FAILS ------------------
# Five of the calls below drive routes whose HANDLER goes to the open internet: /api/tide
# fetches CO-OPS inline, and a port added by NAME is a geocode plus an ENC extract behind
# the water snap. This suite already degraded when the SERVER said it could not reach the
# geocoder; what it did not cover is the TEST's own call running out of budget while the
# console sat waiting on a slow upstream. That raised TimeoutError outside any check(), the
# crash guard turned a stalled train into "the suite CRASHED", and an unrelated commit was
# blocked through the hook. Seen once in about seven full-set runs (2026-09-19).
#
# MEASURED, on a COLD clone - no charts/ cache at all, which is what a fresh clone has -
# on a healthy network, 2026-09-19:
#   /api/tide 1.57 s, forced 0.20 s ... against a budget of EIGHT seconds, below the
#     route's own bound (15 s per CO-OPS series, +30 s for a cold station list)
#   Nome: geocode + a full cold ENC extract + snap 25.85 s; the same call warm 1.30 s
#   Denver 4.97 s; a name that is not a place 0.35 s
# So 420 s was never derived from anything measurable, and the observed failure needed a
# genuine upstream stall rather than merely a cold cache.
#
# THE BUDGET IS BOUNDED BY THE HOOK, NOT BY PATIENCE. .githooks/pre-commit kills a suite at
# SUITE_LIMIT_S; the old budgets (8 + 8 + 420 + 420 + 120) summed to 976 s against its 600,
# so a real outage was killed as TIMED OUT and the skip never happened. One budget, and ONE
# STALL PER UPSTREAM: an upstream that has just failed to answer in 150 s will not answer
# the next call either. Check 1f holds the arithmetic against the limit read out of the hook.
NET_BUDGET_S = 150
UP_TIDE = "the tide upstream (CO-OPS)"
UP_PLACE = "the place lookup (geocoder + ENC)"
NET_UPSTREAMS = (UP_TIDE, UP_PLACE)
SUITE_SLACK_S = 60          # the rest of this suite, measured at ~12 s, with room to spare

net_skips = []
_net_stalled = set()


def console_alive(port, timeout=8.0):
    """Does the console still answer a request with NO external service on its path?

    /api/state is assembled from memory, and the server is a ThreadingHTTPServer - a
    request stuck in another thread on a slow geocoder cannot keep this one from being
    served. Measured against a console mid-stall: 0.077 s and 0.093 s. This is the one
    question that separates "the upstream is slow" (skip) from "this console is wedged"
    (a defect, and this suite's job to report).

    Deliberately NOT through api(): a liveness probe must not share a helper with the call
    it is diagnosing, or a mutation to api() takes the diagnosis down with it."""
    try:
        with urllib.request.urlopen("http://127.0.0.1:%d/api/state" % port,
                                    timeout=timeout) as r:
            return isinstance(json.loads(r.read().decode()).get("status"), dict)
    except Exception:
        return False


def _is_timeout(e):
    """A read-phase timeout arrives bare - socket.timeout, "timed out", which is the crash
    that was observed. A connect-phase one arrives WRAPPED in URLError. Both are the same
    event here. A REFUSED connection is not: that is a console that has died, and it must
    never be mistaken for weather."""
    if isinstance(e, (socket.timeout, TimeoutError)):
        return True
    return (isinstance(e, urllib.error.URLError)
            and isinstance(e.reason, (socket.timeout, TimeoutError)))


def net_api(port, path, body=None, upstream="", timeout=NET_BUDGET_S):
    """api() for a route whose handler goes to the open internet.

    (code, body) as api() returns it; None if the call ran out of budget while the console
    was still answering - the caller then announces a skip. Raises ConsoleHung if it was
    the CONSOLE that stopped answering.

    ⚠ THE TIMEOUT IS CAUGHT ON ONE CALL, never around a block: catching it broadly would
    swallow a console that has genuinely hung, which is a defect this suite reports."""
    if upstream in _net_stalled:
        return None
    try:
        return api(port, path, body, timeout=timeout)
    except Exception as e:
        if not _is_timeout(e):
            raise
        if not console_alive(port, timeout=min(8.0, timeout)):
            raise ConsoleHung("%s did not answer in %s s, and the console then failed to "
                              "serve /api/state either" % (path, timeout))
        _net_stalled.add(upstream)
        return None


def skip(names, why):
    """A networked check that could not be exercised says so HERE and again in the summary
    line, so a run that skipped can never be read as a clean pass. "A suite that fails on a
    train is a suite people stop running" - but one that passes quietly while its wiring is
    broken is worse."""
    net_skips.append("%s (%s)" % (names, why))
    print("  skip %s. %s" % (names, why))


def wait_for(port, pred, limit=40.0, every=0.5):
    t0 = time.time()
    st = state(port)
    while time.time() - t0 < limit:
        st = state(port)
        try:
            if pred(st):
                return st
        except Exception:
            pass
        time.sleep(every)
    return st


def read_session(path):
    out = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                out.append(json.loads(line))
    return out


print("Data routes — vessels, comms, tide, and the ROC's HTTP face:")

port = free_port()
# ITS OWN STATE FOLDER (review #16): this console never reads or writes the operator's plan, settings
# or logs - no snapshot of mission.json, and no write-back of one when the suite ends.
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "lib"))
from console_state import ConsoleState  # noqa: E402
STATE = ConsoleState()
LOG_DIR = STATE.path("logs")
before = set(os.listdir(LOG_DIR)) if os.path.isdir(LOG_DIR) else set()

# This suite adds a ROC ("Test Dock") against a live console. Without its own registry
# file it writes into the OPERATOR's roc_config.json - the accumulation that had the ROC
# card opening on 198 stale rows. It removes what it adds, but a suite that fails part
# way through would still leave one behind, and no test should be able to reach that file.
import atexit  # noqa: E402
import shutil  # noqa: E402
_TMP_ROC = tempfile.mkdtemp(prefix="asv_data_routes_roc_")
atexit.register(shutil.rmtree, _TMP_ROC, True)  # a suite leaves no temp folder behind (review #27; tests/state_dir.py 1b)
ROC_CFG = os.path.join(_TMP_ROC, "roc_config.json")
# SAME RULE FOR PORTS, and for the same reason. Switching or adding an operating port
# SAVES the registry, so a suite run against the app directory would rewrite the
# operator's own bases. It gets a COPY of the shipped file in a temp dir; the checks
# below then add and switch freely without the real ports.json ever being reachable.
_TMP_PORTS = tempfile.mkdtemp(prefix="asv_data_routes_ports_")
atexit.register(shutil.rmtree, _TMP_PORTS, True)
PORTS_CFG = os.path.join(_TMP_PORTS, "ports.json")
# SEEDED FROM WHAT THE REPO SHIPS, not from the live registry. ports.json carries the
# OPERATOR's own bases and whichever one they are working from; seeding off it made a
# check on the shipped defaults fail the moment someone was working from another port
# (caught exactly that way, with a live console based in Pago Pago).
with open(os.path.join(APP, "ports.default.json"), "r", encoding="utf-8") as _f:
    _seed = _f.read()
with open(PORTS_CFG, "w", encoding="utf-8") as _f:
    _f.write(_seed)
srvlog = tempfile.TemporaryFile(mode="w+")


def geocoder_unreachable():
    """Did the CONSOLE say it could not reach the geocoder?

    ⚠ THIS USED TO BE READ OFF THE 400, AND THE 400 CANNOT TELL THE TWO CAUSES APART. The
    route has exactly one wording for a failed name lookup - "could not find a place called
    'X' (no geocoder, or no such place)" - so the old condition, `"geocoder" in error`, was
    true for EVERY failed lookup. A regression that made every name unfindable printed
    "skip 12f-12h" and the suite passed; 12j's own condition (`"find" in error`) passed with
    no geocoder at all. Both verified against the live route.

    The console's own note is the only place the two are distinguished (geocode_place prints
    it on a network failure and never on a place that simply is not there). stderr is
    line-buffered even when redirected, so the note is in this file by the time the response
    reaches us."""
    pos = srvlog.tell()
    try:
        srvlog.seek(0)
        return "[ports] geocoder unreachable" in srvlog.read()
    finally:
        srvlog.seek(pos)


# Logging ON: the comms redaction check reads the session recorder's own records -
# the same --no-log mask that hid the logevent defect would hide a redaction break.
proc = subprocess.Popen([sys.executable, "asv_console.py", "--sim", "--browser", "none",
                         "--port", str(port), "--no-ais-service",
                         "--roc-config", ROC_CFG, "--ports-config", PORTS_CFG, *STATE.args()],
                        cwd=APP, stdout=srvlog, stderr=subprocess.STDOUT)
try:
    up = False
    for _ in range(80):
        try:
            st0 = state(port).get("status") or {}
            if st0.get("speed_key") and st0.get("lat_deg") is not None:
                up = True
                break
        except Exception:
            pass
        time.sleep(0.5)
    check("1. a console comes up, with the link reporting (logging ON)", up)
    if not up:
        raise SystemExit(1)
    new = sorted(set(os.listdir(LOG_DIR)) - before)
    spath = os.path.join(LOG_DIR, new[0]) if new else None

    # ---- 1b-1f. THE SKIP MECHANISM ITSELF, certified before it is relied on --------- #
    # A refusal to judge is only as good as its ability to tell the two cases apart, so each
    # of these is paired: 1b and 1d are the acceptance cases (a live console reads alive; a
    # stall against one becomes a skip) and 1c is the refusal (a console that has stopped
    # answering is REPORTED, never skipped). No network is involved in any of them.
    _alive_t0 = time.time()
    _alive = console_alive(port)
    check("1b. this console reads ALIVE on a route with no external service on its path",
          _alive, "answered in %.1f ms" % (1000 * (time.time() - _alive_t0)))

    # A socket that ACCEPTS the connection and answers nothing - a wedged console, not a
    # dead one. A refused connection would be a different thing and must not read the same.
    #
    # ⚠ THE ACCEPT IS WHAT MAKES THIS DETERMINISTIC, and the first draft did not have it. A
    # listening socket with nobody calling accept() times out in whichever phase the kernel
    # happens to leave it in: the CONNECT, which urllib reports as URLError WRAPPING the
    # timeout, or the READ, which is a bare TimeoutError. Both were measured from this same
    # fixture on this machine within a minute of each other - so the check's verdict depended
    # on the phase rather than on the code, and it credited a mutation (_is_timeout losing the
    # wrapped case) that it cannot reliably see. Accepting and then saying nothing pins it to
    # the read, and is the truer model of a wedged handler: it took the request and never
    # answered. The wrapped shape is 1d's job, with an explicit stub.
    _hungsock = socket.socket()
    _hungsock.bind(("127.0.0.1", 0))
    _hungsock.listen(1)
    _hung_port = _hungsock.getsockname()[1]
    _held = []
    threading.Thread(target=lambda: _held.append(_hungsock.accept()[0]),
                     daemon=True).start()
    try:
        _hung_alive = console_alive(_hung_port, timeout=2)
        try:
            net_api(_hung_port, "/api/tide", upstream="fixture-hung", timeout=2)
            _reported = "no - it returned instead of raising"
        except ConsoleHung as e:
            _reported = "ConsoleHung: %s" % str(e)[:40]
        except Exception as e:
            _reported = "the WRONG exception: %s: %s" % (type(e).__name__, e)
    finally:
        _hungsock.close()
    check("1c. a console that accepts the connection and answers nothing is REPORTED as a "
          "hang - a broad try/except here would swallow the defect this suite exists to find",
          _hung_alive is False and _reported.startswith("ConsoleHung"),
          "alive=%s; %s" % (_hung_alive, _reported))

    # 1d. THE SKIP. api() is stubbed rather than a real upstream stalled: the branch under
    # test is the one that runs when the call runs out of budget, and waiting 150 s for a
    # real one to prove it would make this suite the thing it is fixing.
    _hits = []

    def _stub_bare(*_a, **_k):
        _hits.append("bare")
        raise socket.timeout("timed out")

    def _stub_wrapped(*_a, **_k):
        _hits.append("wrapped")
        raise urllib.error.URLError(socket.timeout("timed out"))

    def _stub_refused(*_a, **_k):
        _hits.append("refused")
        raise urllib.error.URLError(ConnectionRefusedError(10061, "refused"))

    def _skipped(stub, upstream):
        """net_api's answer, with a raise RECORDED rather than allowed to end the suite.

        ⚠ A CHECK MUST STAY READABLE EXACTLY WHEN IT MATTERS. Letting the raise through made
        every mutation that breaks _is_timeout crash the suite instead of reddening this
        check - the same trap as direct_turn.js 9b dereferencing a turn that was not
        produced. A crash is scored as a catch, but it names the wrong thing."""
        global api
        api = stub
        try:
            return net_api(port, "/api/tide", upstream=upstream)
        except Exception as e:
            return "RAISED %s" % type(e).__name__

    _real_api = api
    try:
        _bare = _skipped(_stub_bare, "fixture-bare")
        _wrapped = _skipped(_stub_wrapped, "fixture-wrapped")
        api = _stub_refused
        try:
            net_api(port, "/api/tide", upstream="fixture-refused")
            _refused_raised = None
        except urllib.error.URLError as e:
            _refused_raised = type(e.reason).__name__
        # 1e. ONE STALL PER UPSTREAM: the arithmetic in 1f depends on it. Through _skipped for
        # the same reason 1d is - left bare, these two calls crashed the suite on every
        # mutation that makes net_api raise (console_alive stuck False, the timeout not caught
        # at all), so the last thing printed was a traceback instead of the reds that name it.
        _hits[:] = []
        _first = _skipped(_stub_bare, "fixture-once")
        _second = _skipped(_stub_bare, "fixture-once")
    finally:
        api = _real_api
    check("1d. a call that runs out of budget while the console still answers is a SKIP - "
          "the bare socket timeout and the one WRAPPED in URLError alike - while a REFUSED "
          "connection still raises, because a console that has died is not the weather",
          _bare is None and _wrapped is None and _refused_raised == "ConnectionRefusedError",
          "bare=%r wrapped=%r refused raised %s" % (_bare, _wrapped, _refused_raised))
    check("1e. one stall per upstream: the second call to an upstream that has already "
          "failed to answer does not reach the network again",
          _first is None and _second is None and _hits == ["bare"],
          "calls that reached api(): %d, both answers None: %s"
          % (len(_hits), _first is None and _second is None))

    # 1f. THE HOOK'S LIMIT IS READ OUT OF THE HOOK, never restated here (the enc_extract
    # cache-version lesson): change SUITE_LIMIT_S and this check moves with it. Without this
    # the skip is unreachable in the case it exists for - the suite is killed first.
    _hook = open(os.path.join(APP, ".githooks", "pre-commit"), encoding="utf-8").read()
    _lim = re.search(r"SUITE_LIMIT_S=\$\{ASV_SUITE_LIMIT_S:-(\d+)\}", _hook)
    _limit = int(_lim.group(1)) if _lim else None
    _worst = NET_BUDGET_S * len(NET_UPSTREAMS)
    check("1f. the longest this suite can wait on the network fits inside the hook's own "
          "per-suite limit - a budget over it is killed as TIMED OUT and never skips at all",
          _limit is not None and _worst + SUITE_SLACK_S <= _limit,
          "%s s worst case (%d upstreams x %s s) + %s s slack against the hook's %s s"
          % (_worst, len(NET_UPSTREAMS), NET_BUDGET_S, SUITE_SLACK_S, _limit))

    # 1g. THE SKIP'S KEY, on a stand-in log, because on a healthy network the real one never
    # carries the note and nothing else in this suite would notice the key going wrong. The
    # pair is the whole point: the console's own note reads unreachable, and a log carrying
    # the route's 400 - which names the geocoder for a place that simply is not there - does
    # NOT. That is the distinction the old condition could not make.
    _real_log = srvlog
    try:
        srvlog = io.StringIO("[ports] geocoder unreachable: URLError: "
                             "<urlopen error [Errno 11001] getaddrinfo failed>\n")
        _said = geocoder_unreachable()
        srvlog = io.StringIO("127.0.0.1 - - [19/Sep/2026 09:00:00] \"POST /api/ports\" 400 -\n"
                             "could not find a place called 'x' (no geocoder, or no such place)\n")
        _quiet = geocoder_unreachable()
    finally:
        srvlog = _real_log
    check("1g. the skip is keyed on the CONSOLE saying the geocoder was unreachable - a log "
          "carrying only the route's own 400 does not read as unreachable",
          _said is True and _quiet is False,
          "note present -> %s, 400 alone -> %s" % (_said, _quiet))

    # ---- VESSELS (the list; the switch gate runs LAST - see the order note) -------- #
    _c, v = api(port, "/api/vessels")
    ids = [x.get("id") for x in v.get("vessels", [])]
    check("2. /api/vessels lists every profile on disk and names the active one",
          lambda: {"drix08", "zboat_1800hs", "example_usv_4m"} <= set(ids)
          and v.get("active") == "drix08",
          lambda: "active=%s ids=%s" % (v.get("active"), ids))

    # ---- TIDE (before any switch - position-dependent) ----------------------------- #
    # NETWORKED, and this pair was the one exposure that could fire in ORDINARY weather:
    # ?force=1 fetches CO-OPS inline, bounded by the route's own timeouts at ~15 s a series
    # (+30 s for a cold station list), and the client budget was the default EIGHT - the
    # test giving up before the code it is testing was entitled to answer.
    _t3 = net_api(port, "/api/tide", upstream=UP_TIDE)
    _t3b = net_api(port, "/api/tide?force=1", upstream=UP_TIDE)
    if _t3 is None or _t3b is None:
        skip("3", "the tide upstream did not answer in %d s - /api/tide not exercised"
             % NET_BUDGET_S)
    else:
        c3, t = _t3
        c3b, t2 = _t3b
        check("3. /api/tide ANSWERS with a dict carrying 'ok', plain and forced - upstream's "
              "mood degrades the body, never the response",
              lambda: c3 == 200 and isinstance(t, dict) and "ok" in t
              and c3b == 200 and isinstance(t2, dict) and "ok" in t2,
              lambda: "ok=%s forced ok=%s" % (t.get("ok"), t2.get("ok")))

    # ---- COMMS: the password's three never-leak properties ------------------------- #
    SECRET = "hunter2-not-for-disk"
    cmd(port, "/api/comms", {"mode": "starlink", "host": "127.0.0.1",
                             "username": "andy", "password": SECRET})
    _c, cm = api(port, "/api/comms")
    check("4. the GET echoes mode/host/username and NO password field at all",
          lambda: cm["config"].get("mode") == "starlink"
          and cm["config"].get("host") == "127.0.0.1"
          and cm["config"].get("username") == "andy"
          and "password" not in cm["config"] and SECRET not in json.dumps(cm),
          lambda: json.dumps(cm["config"]))
    time.sleep(0.3)
    check("5. the session log REDACTS it - the command record shows ***, the literal "
          "appears NOWHERE in the recording",
          lambda: spath is not None
          and any(r.get("kind") == "command" and r.get("path") == "/api/comms"
                  and (r.get("body") or {}).get("password") == "***"
                  for r in read_session(spath))
          and SECRET not in open(spath, encoding="utf-8").read(),
          lambda: "recorded body: %s" % json.dumps(next(
              (r.get("body") for r in read_session(spath)
               if r.get("kind") == "command" and r.get("path") == "/api/comms"), None)))
    with open(STATE.path("comms_config.json"), encoding="utf-8") as f:
        disk = f.read()
    check("6. the saved config file carries NO password - memory only, as the class "
          "comment has always promised",
          lambda: SECRET not in disk and "password" not in json.loads(disk),
          lambda: disk.strip()[:70])
    cmd(port, "/api/comms", {"mode": "carrier-pigeon"})
    _c, cm2 = api(port, "/api/comms")
    check("7. an unknown mode is IGNORED, not stored - the poll loop never acts on garbage",
          lambda: cm2["config"].get("mode") == "starlink",
          lambda: "mode=%s" % cm2["config"].get("mode"))

    # ---- ROC HTTP face ------------------------------------------------------------- #
    c10, r_add = cmd(port, "/api/roc", {"op": "add", "kind": "shore", "name": "Test Dock",
                                        "lat": st0["lat_deg"] + 0.01, "lon": st0["lon_deg"]})
    check("10. a ROC add answers with the new id AND the fresh snapshot - no second "
          "round trip",
          lambda: c10 == 200 and r_add.get("id")
          and any(t.get("name") == "Test Dock" for t in r_add.get("roc", {}).get("rocs", [])),
          lambda: "id=%s rocs=%d" % (r_add.get("id"),
                                     len(r_add.get("roc", {}).get("rocs", []))))
    c11, r_bad = cmd(port, "/api/roc", {"op": "levitate"})
    check("11. an unknown op is a 400 that NAMES it",
          lambda: c11 == 400 and "unknown roc op" in (r_bad.get("error") or ""),
          lambda: "%s %s" % (c11, (r_bad.get("error") or "")[:40]))
    c11b, r_mal = cmd(port, "/api/roc", {"op": "add", "kind": "shore", "lat": "x", "lon": 0})
    check("11b. malformed args are a 400 'bad roc request', not a dead thread",
          lambda: c11b == 400 and "bad roc request" in (r_mal.get("error") or ""),
          lambda: "%s %s" % (c11b, (r_mal.get("error") or "")[:40]))
    c12, r_feed = cmd(port, "/api/roc", {"op": "feed", "id": "no-such-roc",
                                         "lat": 38.8, "lon": -75.1})
    check("12. a feed for an unknown id is a 404 with ok false - a GPS bridge posting to "
          "a deleted ROC must hear about it",
          lambda: c12 == 404 and r_feed.get("ok") is False,
          lambda: "%s ok=%s" % (c12, r_feed.get("ok")))
    cmd(port, "/api/roc", {"op": "remove", "id": r_add.get("id")})

    # ---- THE VESSEL SWITCH, LAST (it moves the boat to Lake Erie and back) --------- #
    cmd(port, "/api/cmd/arm", {"on": True})
    c8, sw = cmd(port, "/api/vessel", {"id": "zboat_1800hs"})
    check("8. the switch REFUSES 409 while armed - swapping physics under a live boat "
          "is incoherent, and the active vessel is unchanged",
          lambda: c8 == 409 and "disarm" in (sw.get("error") or "")
          and api(port, "/api/vessels")[1].get("active") == "drix08",
          lambda: "%s %s" % (c8, (sw.get("error") or "")[:44]))
    cmd(port, "/api/cmd/arm", {"on": False})
    zspawn = json.load(open(os.path.join(APP, "vessels", "zboat_1800hs.json"),
                            encoding="utf-8"))["spawn"]
    # where the console is BASED - the position the boat must keep across a hull switch
    _c, _pr = api(port, "/api/ports")
    _ap = [q for q in (_pr.get("ports") or []) if q["id"] == _pr.get("active")]
    port_lat = _ap[0]["lat"] if _ap else zspawn["lat"]
    port_lon = _ap[0]["lon"] if _ap else zspawn["lon"]
    c9, sw2 = cmd(port, "/api/vessel", {"id": "zboat_1800hs"})
    st = wait_for(port, lambda s: (s["status"] or {}).get("energy_type") == "battery"
                  and abs((s["status"].get("lat_deg") or 0) - port_lat) < 0.01)
    # The gauge flip alone is NOT proof of a respawn - energy_type reads the module
    # global POWER_TYPE at snapshot time, so the OLD boat starts reporting "battery"
    # the moment apply_vessel runs. The respawn-dropped mutation SURVIVED the
    # gauge-only version of this check. What a respawn uniquely produces is the
    # POSITION: the new boat comes up at ITS OWN spawn, a lake eight hundred
    # kilometres from Lewes.
    # ⛔ THE SPAWN HALF OF THIS CHECK WAS INVERTED ON 2026-08-15 - READ BEFORE "FIXING".
    # It used to demand the boat come up at the NEW VESSEL'S spawn, because a hull file
    # owned its own start position. Andy changed that: "change initialization to select
    # port and ASV" - the BASE is now where you are and the vessel is what you drive, so
    # a vessel switch must NOT move the boat. The gauge flip still proves apply_vessel
    # ran; the position now proves the port SURVIVED the switch, which is the new
    # contract and the opposite of the old one. (Same shape as home_spawn check 2a.)
    check("9. disarmed, the switch takes: the gauge flips, and the boat STAYS at the "
          "operating port - a new hull is not a new location",
          lambda: c9 == 200 and st["status"].get("energy_type") == "battery"
          and st["status"].get("battery_v") is not None
          and st["status"].get("fuel_l") is None
          and abs((st["status"].get("lat_deg") or 0) - port_lat) < 0.01
          and abs((st["status"].get("lon_deg") or 0) - port_lon) < 0.01,
          lambda: "energy=%s batt=%s lat=%.3f (port %.3f; the zboat file's own spawn is "
                  "%.3f and must NOT be where it lands)"
                  % (st["status"].get("energy_type"), st["status"].get("battery_v"),
                     st["status"].get("lat_deg") or 0, port_lat, zspawn["lat"]))
    c9b, _sw3 = cmd(port, "/api/vessel", {"id": "atlantis"})
    check("9b. an unknown vessel id is a 400, and the working switch above is its "
          "acceptance pair",
          lambda: c9b == 400,
          lambda: "%s" % c9b)
    cmd(port, "/api/vessel", {"id": "drix08"})       # leave the console as found
    wait_for(port, lambda s: (s["status"] or {}).get("energy_type") == "fuel")

    # --- OPERATING PORTS: the base and the boat are chosen separately ---------------
    # Andy, 2026-08-15: "Stop spawning at Erie. change initialization to select port and
    # ASV. the ASV selection is a good model. All entries made by user will be added to
    # drop down selection as retained values." Until this each vessel file carried its own
    # spawn, so choosing the DriX chose Lewes, and the chart opened on a hard-coded Erie
    # centre that belonged to neither the vessel nor any base.
    _c, pr = api(port, "/api/ports")
    ids = [q["id"] for q in (pr.get("ports") or [])]
    check("10. /api/ports lists the bases and names an active one",
          _c == 200 and "new_castle_nh" in ids and "lewes_de" in ids and pr.get("active"),
          "active=%s ids=%s" % (pr.get("active"), ids))
    check("10b. New Castle NH is the PRIMARY - first in the list and the default active",
          bool(ids) and ids[0] == "new_castle_nh" and pr.get("active") == "new_castle_nh",
          "first=%s active=%s (Lewes second)" % (ids[0] if ids else None, pr.get("active")))

    # 11. THE SPAWN FOLLOWS THE PORT. The check that would have caught "spawning at Erie":
    # the boat comes up where the BASE says, not where the hull file says.
    st11 = state(port).get("status") or {}
    ncp = [q for q in pr["ports"] if q["id"] == "new_castle_nh"][0]
    d_nc = abs((st11.get("lat_deg") or 0) - ncp["lat"]) + abs((st11.get("lon_deg") or 0) - ncp["lon"])
    check("11. the sim boat spawns AT THE ACTIVE PORT, not at the vessel file's own spawn",
          d_nc < 1e-4,
          "boat %.4f,%.4f vs port %.4f,%.4f (drix08.json's own spawn is Lewes 38.79/-75.16)"
          % ((st11.get("lat_deg") or 0), (st11.get("lon_deg") or 0), ncp["lat"], ncp["lon"]))

    # 12. Switching moves the boat - proving apply_port ran AND the sim respawned.
    c12, sw = api(port, "/api/ports", {"id": "lewes_de"})
    st12 = wait_for(port, lambda s: ((s.get("status") or {}).get("lat_deg") or 99) < 40.0, limit=25)
    lat12 = (st12.get("status") or {}).get("lat_deg")
    check("12. switching the port moves the boat to the new base",
          c12 == 200 and sw.get("active") == "lewes_de"
          and lat12 is not None and abs(lat12 - 38.78965) < 1e-3,
          "after the switch the boat is at lat %s (Lewes 38.78965)" % lat12)

    # 12b. THE OPERATOR'S OWN ENTRY IS RETAINED - the "added to the drop down as retained
    # values" half of the ask. Added over HTTP, it must come back from a fresh read.
    c12b, add = api(port, "/api/ports", {"name": "Test Basin", "lat": 41.5, "lon": -71.4})
    _c2, after = api(port, "/api/ports")
    ids2 = [q["id"] for q in (after.get("ports") or [])]
    check("12b. a port the operator adds is selected AND kept in the list",
          c12b == 200 and add.get("active") == "test_basin" and "test_basin" in ids2,
          "ids now %s" % ids2)
    with open(PORTS_CFG, "r", encoding="utf-8") as _f:
        on_disk = json.loads(_f.read())
    check("12c. ... and it is PERSISTED, so it survives a restart",
          any(q["id"] == "test_basin" for q in on_disk.get("ports") or []),
          "registry on disk holds %s" % [q["id"] for q in on_disk.get("ports") or []])

    # 12d. Malformed input is an ANSWER - never a 500, and never a silent accept that
    # would spawn the boat off the globe.
    codes = []
    # NOTE: {"name": ...} with NO lat/lon is NOT in this list any more - since ports can
    # be created from a name it is a LOOKUP, and 12j covers the unfindable case. Leaving
    # it here asserted the old contract and passed a real geocode as a failure.
    for bad in ({"id": "nowhere"}, {"name": "X", "lat": 999, "lon": 0},
                {"name": "", "lat": 1, "lon": 2}):
        c, r = api(port, "/api/ports", bad)
        codes.append((c, (r.get("error") or "")[:30]))
    check("12d. every malformed port is a 400 that says what is wrong",
          all(c == 400 and e for c, e in codes),
          "; ".join("%s %s" % (c, e) for c, e in codes))

    # 12f-12h. A PORT CAN BE FOUND BY NAME - the difference between a bookmark and a way
    # of starting work somewhere. Andy: "not just to memorize a manually found spot, but
    # to initialize a survey area from the name entered... identify a survey home port
    # like Nome, Alaska and then the chart goes there."
    #
    # NETWORKED, so it degrades to a SKIP rather than a false failure: a suite that fails
    # on a train is a suite people stop running. What it must never do is pass silently
    # when the wiring is broken, so the skip is announced - and it is keyed on the CONSOLE
    # saying it could not reach the geocoder, never on the 400, which says the same thing
    # for a place that simply is not there (see geocoder_unreachable).
    _g = net_api(port, "/api/ports", {"name": "Nome, Alaska"}, upstream=UP_PLACE)
    if _g is None:
        skip("12f-12h", "the place lookup did not answer in %d s - name lookup not exercised"
             % NET_BUDGET_S)
    elif geocoder_unreachable():
        skip("12f-12h", "the console could not reach the geocoder - name lookup not exercised")
    else:
        cf, gf = _g
        found = gf.get("found") or {}
        check("12f. a port created from a NAME resolves the place and is selected",
              cf == 200 and gf.get("active") == "nome_alaska"
              and "Nome" in (found.get("geocoded") or ""),
              "active=%s geocoded=%s" % (gf.get("active"), found.get("geocoded")))
        # 12g. THE CHECK THAT MATTERS. A geocoder returns a TOWN CENTRE, which is on
        # land; taking it as a survey home port spawns the boat inland and refuses every
        # route out. The console must move it to charted water this hull can float in.
        place = found.get("place") or {}
        moved = found.get("moved_m")
        check("12g. the geocoded PLACE CENTRE is snapped to charted navigable water",
              found.get("snapped") is True and (found.get("depth_m") or 0) > 0
              and moved is not None,
              "place %.4f,%.4f -> berth in %.1f m, moved %.0f m (a town centre is on land)"
              % (place.get("lat", 0), place.get("lon", 0),
                 found.get("depth_m") or 0, moved or 0))
        # 12h. ... and the boat actually comes up there.
        # ⚠ A THUNK, BECAUSE IT DEREFERENCES gf["spawn"], WHICH A REFUSAL DOES NOT CARRY. As
        # a plain expression this crashed the suite on exactly the mutation 12f and 12g exist
        # to catch (geocode_place returning None): both printed their red and then 12h took
        # the process down before it could print anything at all. Found by running that
        # mutation - the same trap as direct_turn.js 9b.
        stn = wait_for(port, lambda s: ((s.get("status") or {}).get("lat_deg") or 0) > 60.0,
                       limit=25)
        latn = (stn.get("status") or {}).get("lat_deg")
        check("12h. the sim boat spawns at the found berth",
              lambda: latn is not None and abs(latn - gf["spawn"]["lat"]) < 1e-4,
              lambda: "boat lat %s vs berth %s" % (latn, gf["spawn"]["lat"]))

    # 12i. A PLACE WITH NO NAVIGABLE WATER IS STILL HONEST. Landlocked: the port is
    # created at the place centre so the operator can see where they asked for, but it is
    # FLAGGED unverified with the reason - never presented as a berth.
    # ⚠ THE `if ci == 200` THAT USED TO GUARD THIS CHECK DROPPED IT IN SILENCE - no skip
    # line, no failure, one fewer check in the count. The code is now inside the check, so a
    # reachable geocoder that answers anything but 200 here is REPORTED.
    _gi = net_api(port, "/api/ports", {"name": "Denver, Colorado"}, upstream=UP_PLACE)
    if _gi is None:
        skip("12i", "the place lookup did not answer in %d s - landlocked case not exercised"
             % NET_BUDGET_S)
    elif geocoder_unreachable():
        skip("12i", "the console could not reach the geocoder - landlocked case not exercised")
    else:
        ci, gi = _gi
        fi = gi.get("found") or {}
        ent = [q for q in (gi.get("ports") or []) if q.get("id") == "denver_colorado"]
        check("12i. a landlocked place is created but FLAGGED, with the reason",
              lambda: ci == 200 and fi.get("snapped") is False and bool(fi.get("note"))
              and bool(ent) and ent[0].get("unverified") is True,
              "code=%s snapped=%s unverified=%s note=%s"
              % (ci, fi.get("snapped"), ent[0].get("unverified") if ent else None,
                 (fi.get("note") or "")[:48]))

    # 12j. A NAME THAT IS NOT A PLACE is a 400 that says so - not a port at 0,0.
    # ⚠ AND IT USED TO PASS WITH NO GEOCODER AT ALL: an unreachable one produces the same
    # 400, whose wording ("no geocoder, or no such place") satisfies this check's own test.
    # That is passing quietly while the wiring is broken, so the console's note gates it too.
    _gj = net_api(port, "/api/ports", {"name": "qqzzxx not a real place 12345"},
                  upstream=UP_PLACE)
    if _gj is None:
        skip("12j", "the place lookup did not answer in %d s - refusal not exercised"
             % NET_BUDGET_S)
    elif geocoder_unreachable():
        skip("12j", "the console could not reach the geocoder - an unfindable name and an "
                    "unreachable geocoder are the same 400, so this proves nothing now")
    else:
        cj, gj = _gj
        check("12j. an unfindable name is refused, rather than becoming a port in the Atlantic",
              cj == 400 and "find" in (gj.get("error") or "").lower(),
              "%s %s" % (cj, (gj.get("error") or "")[:60]))

    # 12e. THE REAL REGISTRY WAS NEVER REACHED. The whole point of --ports-config.
    with open(os.path.join(APP, "ports.default.json"), "r", encoding="utf-8") as _f:
        real = json.loads(_f.read())
    # COMPARED AGAINST WHAT WAS SHIPPED, not against a list of ids this suite happens to
    # create. A named-few check only catches the strays you thought of; a stray port with
    # any other name would have sailed straight past it, which is how one got into the
    # real registry unnoticed in the first place.
    seeded_ids = [q["id"] for q in json.loads(_seed).get("ports") or []]
    real_ids = [q["id"] for q in (real.get("ports") or [])]
    check("12e. the SHIPPED registry is untouched - no suite reaches ports.default.json",
          real_ids == seeded_ids,
          "real=%s seeded=%s" % (real_ids, seeded_ids))

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
# tracebacks and routes that raised - not every line that says "Error" (tests/lib/server_log.py, review #17)
from server_log import exception_lines  # noqa: E402
tb = exception_lines(server_out)
check("13. the console logged NO exception while serving those requests",
      not tb,
      ("%d line(s), first: %s" % (len(tb), tb[0][:90])) if tb
      else "an answered request can still kill its handler")

# A RUN THAT SKIPPED MUST NOT READ AS A CLEAN PASS. The skip lines scroll past in a
# 91-suite run; the summary is the line people actually read, so it carries them too.
_tail = ("\n  SKIPPED: %s" % "; ".join(net_skips)) if net_skips else ""
print(("\n%d CHECK(S) FAILED (%d ran)%s" % (fails, ran, _tail)) if fails
      else ("\nall checks passed (%d)%s" % (ran, _tail)))
sys.exit(1 if fails else 0)
