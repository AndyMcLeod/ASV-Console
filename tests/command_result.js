// tests/command_result.js - A COMMAND THE BOAT NEVER TOOK IS NOT A PLAN.
//
// The three functions that command a MOTION - Return-to-Home, Go-To and a drawn Transit -
// each posted their command and never looked at the answer. They then drew the route on the
// chart, wrote the reasoning onto the Intent card, updated the Mission card and said so in
// a banner, for a boat that was not going anywhere.
//
//   node tests/command_result.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ⚠ THE REFUSALS ARE REAL, measured against a console started on its own port with its own
// --state-dir: /api/cmd/rth answers HTTP 409 {"error": "...", "state": {...}} for each of
// "ARM before commanding the boat", "not connected" and "no home set (no GPS fix yet)", and
// the vessel's behavior stayed "survey" through every one of them. She does not go home.
//
// ⚠ AND THE BUTTON'S GATE IS NOT THE ANSWER, which is why this is not theoretical. #b_rth is
// disabled unless canCommand(s) && s.home - armed, no E-STOP, supervising - but that is read
// off a state FRAME, and doRTH then spends real time: ensureNogoCovers can wait out the
// whole NOGO_QUEUE_MAX_MS = 8 s extract bound before it plans at all. The arm, the E-STOP
// and the vessel link can all go inside that window. The END-OF-PLAN CHAIN is worse again:
// it fires from applyState with no operator at a button, and it fires in EVERY tab.
//
// ⚠⚠ THE ANSWER HAS THREE STATES AND THIS SUITE EXISTS TO KEEP THEM APART. Collapsing them
// is how a first cut of the repair would have introduced a new false claim:
//
//     not SENT   a VIEW-ONLY tab is refused inside cmd(), before any fetch. Its {ok:false}
//                says nothing whatever about the boat - the supervising tab may be bringing
//                her home at that moment - so it may not retract the end-of-plan promise
//                and may not say she is holding. It takes its own banner down and stops.
//     REFUSED    the console answered in words (409 + a reason). That IS a fact about the
//                vessel, and it is the only answer that may retract the promise.
//     neither    the reply was lost, or the new bound fired. The command may have been
//                carried out. "REFUSED, will hold instead" is not a thing the console has
//                earned the right to say, so the promise is left alone and the banner says
//                exactly what is not known.
//
// ⚠⚠⚠ NOTHING HERE STUBS cmd(). The suite stubs FETCH and runs the page's own cmd() on top
// of it, so the three answers are whatever cmd() actually produces. A stubbed cmd() would be
// a copy of the contract sitting next to the contract, and the two would be free to drift -
// exactly the trap the earlier reproduction of this finding fell into, which kept "passing"
// against hand-written {ok:false} objects after cmd() had grown the fields it was testing.
//
// TEETH - fourteen mutations RUN against a sidecar copy of the page (ASV_HTML). These are
// the checks that actually went red, not the ones predicted of them:
//   doRTH: the r.ok gate deleted (the finding restored)            -> 3, 3b, 4, 4b, 5, 6
//   doRTH: gated on `if(r.error)` - doSetHome's named trap         -> 6
//   doRTH: retracts on !ok rather than on a witnessed refusal      -> 4, 5, 6
//   doRTH: retracts on `sent` rather than on `refused`             -> 4
//   doRTH: the view-only tab banners instead of taking it down     -> 5
//   doRTH: the no-fix branch un-awaited again                      -> 8
//   doRTH: the guard episode spent on a refusal (setPlanIntent up) -> 3, 3b, 5, 6
//   doGoTo: the r.ok gate deleted                                  -> 9
//   doTransit: the r.ok gate deleted                               -> 10
//   doTransit: the draw moved BELOW the post (the first proposal)  -> 11
//   cmd(): the view-only path forgets sent:false                   -> 1, 5, 13
//   cmd(): the 409 path forgets refused:true                       -> 1, 3, 4b, 8, 9, 10, 12
//   cmd(): a lost reply claims to be a refusal                     -> 1, 2, 4
//   cmd(): the AbortController dropped (an unbounded POST)         -> the suite HANGS, and
//                                                                     the exit guard catches
//                                                                     it at 2 of 17 run
//
// ⚠ ALL FOURTEEN WERE KILLED BY THIS SUITE AND BY NOTHING ELSE. hold_point, end_action,
// supervisor_page, action_history, nogo_readout, plan_save and page_strict were run against
// every one of them and stayed green throughout - including on the three r.ok gates, which
// hold_point 9/9b/9d pin by call text with regexes that tolerate a `const r = await `
// prefix. Measured, not assumed, with the control green first.
//
// ⚠ AND CHECK 6 HAD TO BE REWRITTEN BEFORE IT MEANT ANYTHING. It first drove a 409 carrying
// an EMPTY reason, on the theory that an `if(r.error)` gate would fall through it - but
// cmd() fills a blank reason in ("command failed (409)"), so `r.error` was truthy and the
// two spellings agreed. The mutation survived a check written specifically to kill it, and
// the check's own detail line was stating something false. The answer that genuinely has no
// `ok` AND no `error` is a 200 whose body will not parse, which cmd() maps to {}.
//
// TEETH, SECOND ROUND (2026-09-22, checks 15-19) - fourteen more mutations against a
// sidecar, CONTROL RUN AND READ FIRST across ten suites:
//   cmd(): the unreadable arm deleted (a bare {} again)             -> 15, 15b
//   cmd(): an unreadable answer reported as a REFUSAL               -> 6, 15, 15b
//   cmd(): the unreadable flag never set                            -> 15, 15b
//   cmd(): the unreadable arm placed BEFORE the status arm          -> 19   (SEE BELOW)
//   took(): the r.error spelling, page-wide                         -> 17, guard_resume 15b
//   took(): the ok===false spelling, page-wide                      -> 17
//   took(): always true (every gate on the page open)               -> 3, 3b, 4, 4b, 5, 6, 8,
//                                                                      9, pause_resume 12c,
//                                                                      guard_resume 14/15b/21
//   notTookSay(): a view-only tab speaks about the boat             -> 5, 18
//   notTookSay(): a lost reply called a refusal                     -> 4, 6, 18
//   resumeRun: the LOW gate open again                              -> pause_resume 12c
//   the guard's deviation amend gated on r.error again              -> 17
//   the held-survey upload gate open                                -> guard_resume 14
//   doSetHome's gate open                                           -> measure_tool 15b3
//   doSpawn's gate open (a refused spawn loses the trail)           -> spawn_trail 10
//
// ⚠⚠ ONE OF THOSE FOURTEEN SURVIVED THE FIRST SWEEP AND CHECK 19 EXISTS BECAUSE OF IT.
// Putting cmd()'s `unreadable` arm BEFORE its status arm turns a refusal whose body also
// failed to parse into a "not acknowledged" - and `refused` is the only answer permitted to
// retract the end-of-plan return, so the promise would stand for a boat the console had
// just been told to leave where she is. Nothing in ten suites went red. A survivor that is
// not INERT is a missing check, not an acceptable result: read the table's other axis.
//
// ⚠ CHECKS 2 AND 15b EACH WAIT THE REAL BOUND, which is why this suite takes about thirty
// seconds. A bound tested by mocking the clock is a bound nobody runs - and 15b exists
// because the bound shipped on 2026-09-22 covered only HALF of what it was for.
//
// TEETH, THIRD ROUND (checks 20-25, SHAPE B) - ten mutations against a sidecar, control run
// and READ first across ten suites:
//   b_hold: the gate deleted (clears again on a refusal)           -> 20
//   b_hold: guardHeld cleared before the gate again                -> 20, guard_resume 8
//   b_stop: the gate deleted                                       -> 21
//   b_stop: escapeThrottle released before the gate                -> 21
//   b_stop: the refusal says nothing                               -> 21
//   b_estop: folded into the uniform rule                          -> 22
//   empty upload: clears regardless of the answer again            -> 23
//   commandSpeed: the want kept for a command never sent           -> 24
//   commandSpeed: the want cleared on a REFUSAL too                -> corner_slow
//   b_start: the reply dropped again                               -> 25
//
// ⚠⚠ TWO OF THOSE TEN SURVIVED THE FIRST SWEEP, and both were changes shipped with NO
// EXECUTABLE CHECK AT ALL - commandSpeed and #b_start. Checks 24 and 25 exist because of
// that, not because they were planned. A change whose only witness is its own source text
// has not been tested; the sweep is what says so.
//
// ⚠ AND 24's PAIRING IS THE POINT. The obvious version - "a failed command clears the want" -
// is WRONG: a REFUSAL and a LOST reply must both KEEP it, because re-sending until the
// vessel's own speed_key agrees is exactly what speedReconcile is for. Only `sent === false`
// may clear it, and the mutation that clears on any failure is killed by corner_slow rather
// than by the check written for it.
//
// ⚠⚠ CHECKS 26-29 CAME FROM AN ADVERSARIAL PASS, NOT FROM A SWEEP, and one of them was
// BLOCKING. Mutations say whether the checks have teeth; they cannot say whether the design
// is right, because a self-consistently wrong design passes its own mutations:
//   26  THE THIRD ANSWER. 20 and 21 drove only a refusal and a success, so narrowing either
//       gate from took() to `r.refused` survived TEN suites - a lost Stop would then wipe the
//       route, the pause mark and the escape's high-speed hold on a reply that says nothing.
//       This suite's own header had already said the three states are the point.
//   27  LAST-WRITER-WINS (the blocking one). Clearing past the reply is the right side of
//       the post, but it is also a WINDOW, and the guard writes these very fields at 4 Hz
//       throughout it. An accepted Stop would erase an escape the guard commanded during its
//       own round trip - the same release the commit refuses to make on a REFUSED Stop.
//       Each field is now cleared only if it is still the one the press found.
//   28  #b_start CLEARS IN FRONT OF ITS POST, alone on this bar, and that is deliberate:
//       Engine.start _push_state()s inside its lock, so the frame for the new run can reach
//       the page BEFORE the reply and be judged by clearanceGuard/speedGovernor. The safety
//       comes from RESTORING on a refusal, not from delaying. (Two refuters disagreed about
//       this; the mechanism settled it.)
//   29  THE RE-SEND PATH. The want-dropping rule was first written on commandSpeed alone,
//       and speedReconcile re-sent with its own call - so a tab that lost the post to a TAKE
//       OVER kept re-sending and kept blaming the vessel. One door now: sendSpeed.
//
// ⚠ AND CHECKS 20/21 WERE VACUOUS AS FIRST WRITTEN. The world starts `runRoute` at null and
// nothing set it, so check 20 asserted `runRoute === null` FOR THE REFUSED CASE - the literal
// opposite of its own headline - and passed. "Left alone" and "never there" are the same
// observation until you put something there. The fixture is seeded now.
"use strict";
const fs = require("fs");
const path = require("path");

// ASV_HTML points this at a SIDECAR copy for a mutation run - without it a sweep writes its
// mutants to a file this suite never reads and scores every one as SURVIVED.
const H = fs.readFileSync(process.env.ASV_HTML
                || path.join(__dirname, "..", "static", "asv.html"), "utf8");

function grab(name) {
  let start = H.indexOf("async function " + name + "(");
  if (start < 0) start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
// The command-bar handlers are ASSIGNMENTS, not named functions, so grab() cannot see
// them. Sliced from the arrow's own brace, which is what makes them drivable at all - the
// alternative is a source regex, and a regex cannot tell a gate that runs from one that is
// written above the thing it is supposed to gate.
function grabHandler(id) {
  const at = H.indexOf('$("#' + id + '").onclick');
  if (at < 0) throw new Error("test setup: handler " + id + " not found (renamed?)");
  const eq = H.indexOf("=", at);
  let k = H.indexOf("{", eq), depth = 0;
  // ⚠ BOUNDED. The depth counter is brace-only - blind to strings, comments and regexes -
  // so an unmatched brace inside a string literal would walk off the end and spin. A named
  // setup error beats a ten-minute timeout that reads like a hung suite.
  for (;;) {
    if (k >= H.length) throw new Error("test setup: unbalanced braces in handler " + id
                                       + " (a brace inside a string or comment?)");
    const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++;
  }
  return H.slice(eq + 1, k + 1).trim();
}
function grabDecl(name) {
  for (const kw of ["const ", "let "]) {
    for (const sp of [" =", "="]) {
      const i = H.indexOf(kw + name + sp);
      if (i >= 0) return H.slice(i, H.indexOf(";", i) + 1);
    }
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}

// --- crash guard: a throw outside a check() must still REPORT --------------------------
function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = (detail ? detail + " — " : "") + "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}
// ⚠ A SUITE THAT STOPS RUNNING ITS CHECKS MUST NOT EXIT 0. Everything below is async, and an
// await that never settles does not crash node - it just ends the process quietly with the
// remaining checks never run, which a mutation sweep scores as SURVIVED. Seen once already
// in this repo, so the floor is asserted rather than assumed.
const EXPECTED = 41;
let finished = false;
process.on("exit", (code) => {
  if (!finished && !code) {
    console.log("\n*** THE SUITE DID NOT FINISH: " + ran + " of " + EXPECTED
                + " checks ran and node exited 0. An unsettled await is a SILENT PASS.");
    process.exitCode = 1;
  }
});

// ── the world ────────────────────────────────────────────────────────────────────────
// The page's OWN cmd() and cmdLabel(), over a FETCH we control. Everything cmd() answers is
// therefore cmd()'s own answer, not a restatement of it.
const PRELUDE = [
  "const out = W.out;",
  "let S = W.S, asv = W.asv;",
  "let runRoute = null, runUnsafe = [], planIntent = null, rthChainFailed = false;",
  // what the command-bar handlers touch beyond the three motions
  "let pauseMark = {line:0}, resumeSlow = true;",
  // markPause() is what #b_pause claims BEFORE the console answers: where she stopped.
  "const lineMark = () => ({line: 7, along: 120});",
  "const markPause = () => { pauseMark = lineMark(); };",
  "let escapeThrottle = true, commandedSpeed = 'low', speedWant = {key:'low'};",
  "const holdClearAt = () => 12;",
  "const mission = {waypoints: []};",
  // #b_start asks before it commands, and hands a paused boat to resumeRun
  "const guiConfirm = async () => true;",
  "const resumeRun = async () => { out.resumed++; };",
  // the clearance guard's per-episode record, as it stands mid-episode when RTH is pressed
  "let guardOverride = {said:'proceed'}, edgeSpentM = 40, edgeCount = 2;",
  "let guardActedAt = 12345, holdWant = null, guardHeld = {route:[1,2]};",
  "let transit = W.transit;",
  "const CLIENT_ID = 'test-tab';",
  "const SUPERVISES = true;",
  "const supervising = () => W.supervising;",
  "const fetch = W.fetch;",
  "const recordAction = (k, l, d) => { out.recorded.push([k, l, d]); };",
  "const showNote = (t) => { out.notes.push(t); };",
  "const flashNote = (t) => { out.notes.push(t); };",
  "const $ = (sel) => (sel === '#encbanner' ? out.banner : {style:{}, textContent:''});",
  "const ensureNogoCovers = async () => true;",
  "const planNogoRoute = () => W.plan;",
  "const routePlan = () => W.plan;",
  "const holdTarget = (p) => ({to: p, heldOff: null, holdClear: 12});",
  "const holdOpts = () => ({}); const solveCoastFor = () => null;",
  // ⚠ THE GENERATION LIVES WHERE THE PAGE PUTS IT - inside setPlanIntent, which is called
  // at every site that installs a NEW commanded route and at neither of the two that AMEND
  // one. A stub that bumped it somewhere else would be testing a different rule.
  "let planGen = 0;",
  "const setPlanIntent = (k, p, r) => { planGen++; planIntent = {kind:k, route:(r||[]).length};",
  // setPlanIntent's OWN first statement, which is a consequence of calling it at all
  "  guardOverride = null; edgeSpentM = 0; edgeCount = 0; guardActedAt = 0; holdWant = null;",
  "  return planIntent; };",
  "const updateMissionCard = () => { out.card++; };",
  "const buoyageNote = () => ''; const heldOffWhy = () => 'it is a dock / pier';",
  "const fmtDist = (m) => Math.round(m) + ' m';",
  "const legReasons = (u) => u.map(() => ({kind:'land'}));",
  "const kindsSummary = () => 'land';",
  "const setViolation = () => {}; const setViolations = () => { out.violations++; };",
  "const clearViolation = () => {}; const render = () => { out.renders++; };",
  "const setMode = () => {};",
].join("\n");

const EPILOGUE = "\nconst bHold = " + grabHandler("b_hold") + ";"
  + "\nconst bStart = " + grabHandler("b_start") + ";"
  + "\nconst bEstop = " + grabHandler("b_estop") + ";"
  + "\nconst bPause = " + grabHandler("b_pause") + ";"
  + "\nconst bStop = " + grabHandler("b_stop") + ";"
  + "\nreturn {cmd, doRTH, doGoTo, doTransit, takeDownBanner, took, notTookSay,"
  + " bHold, bStop, bStart, commandSpeed, bEstop,"
  + " seed: (r, i) => { runRoute = r; planIntent = i; runUnsafe = [[1,2]]; },"
  + " sendSpeed, setThrottle: (v) => { escapeThrottle = v; },"
  // A NEW commanded motion during the round trip (bumps the generation), and an AMENDMENT
  // during it (replaces the route array, mutates the intent in place, bumps nothing) - the
  // two cases the per-field guards could not tell apart.
  + " newMotion: () => { runRoute = [{lat:9, lon:9}]; setPlanIntent('goto', null, [1,2]); },"
  + " amend: () => { runRoute = runRoute.slice(); if(planIntent) planIntent.why = ['dev']; },"
  + " gen: () => planGen, setHeld: (v) => { guardHeld = v; },"
  + " ageWant: (ms) => { if(speedWant) speedWant.at -= ms; },"
  + " setWant: (v) => { speedWant = v; }, setMark: (v) => { pauseMark = v; },"
  + " bPause: () => bPause(),"
  + " reconcile: (s, st) => speedReconcile(s, st),"
  + " setViewOnly: (v) => { W.supervising = !v; },"
  + " want: () => speedWant,"
  + " bar: () => ({runRoute, planIntent, runUnsafe, guardHeld, pauseMark, resumeSlow,"
  + "              escapeThrottle, commandedSpeed, speedWant}),"
  + " after: () => ({runRoute, planIntent, rthChainFailed,"
  + " guard: {guardOverride, edgeSpentM, edgeCount, guardActedAt, holdWant}})};";

// The banner element, with showBanner's own stickiness: it is set and stays set.
function bannerEl() {
  return { style: { display: "none" }, textContent: "" };
}

function world(opts) {
  const o = opts || {};
  const out = { notes: [], recorded: [], renders: 0, card: 0, violations: 0,
                posts: [], banner: bannerEl(), aborts: 0, resumed: 0 };
  // THE FETCH, not the command. `reply` decides what the console answers.
  const fetchStub = (url, init) => {
    out.posts.push(url);
    if (o.reply === "hang") {
      return new Promise((resolve, reject) => {
        if (init && init.signal) init.signal.addEventListener("abort", () => {
          out.aborts++;
          const e = new Error("aborted"); e.name = "AbortError"; reject(e);
        });
      });
    }
    if (o.reply === "throw") return Promise.reject(new Error("failed to fetch"));
    // Resolves a tick later, so a check can do what the guard does DURING the round trip.
    if (o.slowReply) {
      return new Promise((res) => setTimeout(() => {
        // the guard's rung, firing DURING the round trip: it writes inside the page
        // bundle, so it goes through the bundle rather than this module's scope.
        if (W.api) W.api.setThrottle(true);
        res({ ok: true, status: 200, json: async () => ({ ok: true, state: {} }) });
      }, 5));
    }
    // Headers arrive, the BODY never finishes: the abort is then raised by r.json(), which
    // is inside cmd()'s try and behind its own catch. That is the half the 15 s bound did
    // not cover until check 15b was written.
    if (o.reply === "hangBody") {
      return Promise.resolve({ ok: true, status: 200,
        json: () => new Promise((_res, rej) => {
          if (init && init.signal) init.signal.addEventListener("abort", () => {
            out.aborts++;
            const e = new Error("aborted"); e.name = "AbortError"; rej(e);
          });
        }) });
    }
    // A 200 whose body is not the console's JSON - a captive portal, a proxy error page.
    // cmd() maps it to {} (its json() catch), so there is no `ok` AND no `error`.
    if (o.reply === "junk") {
      return Promise.resolve({ ok: true, status: 200,
        json: async () => { throw new Error("Unexpected token < in JSON"); } });
    }
    // A REFUSAL whose body is also unreadable - a proxy answering 409 with an HTML page, or
    // the console cut off mid-reason. The status still says she refused.
    if (o.reply === "custom") {
      return Promise.resolve({ ok: false, status: o.body.status || 409,
        json: async () => o.body });
    }
    if (o.reply === "refuseJunk") {
      return Promise.resolve({ ok: false, status: 409,
        json: async () => { throw new Error("Unexpected token < in JSON"); } });
    }
    if (o.reply === "refuse") {
      return Promise.resolve({ ok: false, status: 409,
        json: async () => ({ error: o.why || "ARM before commanding the boat",
                             state: { behavior: "survey" } }) });
    }
    return Promise.resolve({ ok: true, status: 200,
      json: async () => ({ ok: true, state: { behavior: "rth", note: "Return-to-Home." } }) });
  };
  const W = { out, supervising: o.viewOnly ? false : true, fetch: fetchStub,
              transit: o.transit || [{ lat: 43.0, lon: -70.5 }, { lat: 43.01, lon: -70.49 }],
              S: { home: { lat: 43.0, lon: -70.5 }, note: "" },
              asv: o.noFix ? null : { lat: 43.02, lon: -70.48 },
              plan: o.plan || { route: [{ lat: 43.0, lon: -70.5 }, { lat: 43.01, lon: -70.49 }],
                                holdClear: 12, routed: true, lane: null, partial: false,
                                heldOff: null, degraded: false, error: null, reason: null,
                                unroutable: [] } };
  // eslint-disable-next-line no-new-func
  const api = new Function("W", "setTimeout", "clearTimeout", "AbortController",
                           PRELUDE + "\n"
                           + grabDecl("SUPERVISOR_ANY") + "\n"
                           + grabDecl("CMD_TIMEOUT_MS") + "\n"
                           // took() and notTookSay() are the page's ONE success test and
                           // its operator wording. They come across verbatim, so a change
                           // to either is a change here rather than a copy that can drift.
                           + grab("took") + "\n" + grab("notTookSay") + "\n"
                           + grab("sendSpeed") + "\n" + grab("commandSpeed") + "\n"
                           + grabDecl("SPEED_RESEND_MS") + "\n"
                           + grab("speedReconcile") + "\n"
                           + grab("cmdLabel") + "\n" + grab("cmd") + "\n"
                           + grab("showBanner") + "\n" + grab("takeDownBanner") + "\n"
                           + grab("doRTH") + "\n" + grab("doGoTo") + "\n" + grab("doTransit")
                           + EPILOGUE)(W, setTimeout, clearTimeout, AbortController);
  W.api = api;              // so a fetch stub can act INSIDE the bundle mid-round-trip
  return Object.assign(api, { out, W,
    banner: () => (out.banner.style.display === "none" ? "" : out.banner.textContent) });
}

(async () => {

console.log("-- 1-2: cmd() answers THREE things, and the three are not the same thing --");

// 1. THE SHAPE ITSELF. A caller that acts on a command has to be able to tell a vessel that
// said no from a tab that never asked it - and both used to arrive as a bare {ok:false}.
{
  const refused = await world({ reply: "refuse" }).cmd("/api/cmd/rth", {});
  const viewOnly = await world({ viewOnly: true }).cmd("/api/cmd/rth", {});
  const lost = await world({ reply: "throw" }).cmd("/api/cmd/rth", {});
  const okr = await world({}).cmd("/api/cmd/rth", {});
  check("1. a vessel that REFUSED, a tab that never SENT, and a reply that was LOST are three "
        + "different answers",
        refused.ok === false && refused.sent === true && refused.refused === true
        && viewOnly.ok === false && viewOnly.sent === false && viewOnly.refused === false
        && lost.ok === false && lost.sent === true && lost.refused === false
        && okr.ok === true,
        "409 -> sent " + refused.sent + "/refused " + refused.refused
          + "; view-only -> sent " + viewOnly.sent + "/refused " + viewOnly.refused
          + "; lost -> sent " + lost.sent + "/refused " + lost.refused
          + "; 200 -> ok " + okr.ok);
}

// 1b. AND THE VIEW-ONLY REFUSAL NEVER REACHES THE WIRE, which is the whole reason its answer
// cannot be read as news about the boat.
{
  const w = world({ viewOnly: true });
  await w.cmd("/api/cmd/rth", {});
  check("1b. ... and the view-only refusal is decided BEFORE any fetch",
        w.out.posts.length === 0 && w.out.notes.some((n) => /VIEW ONLY/.test(n)),
        w.out.posts.length + " fetch(es) issued; the reason was flashed to the operator once");
}

// 2. THE BOUND. cmd() had no timeout and no AbortController. That was survivable only while
// every caller fired and forgot; the moment doRTH AWAITS it, a POST that never settles takes
// that command with it for ever, with no banner - and this page has already been here once,
// in refreshNogo, which bounds its own wait for exactly this reason and says so.
{
  const w = world({ reply: "hang" });
  const t0 = Date.now();
  const r = await w.cmd("/api/cmd/rth", {});
  const waited = Date.now() - t0;
  const bound = /const CMD_TIMEOUT_MS = (\d+);/.exec(H);
  check("2. a POST that never settles is BOUNDED, and comes back as not-acknowledged rather "
        + "than as a refusal",
        r && r.ok === false && r.sent === true && r.refused === false && w.out.aborts === 1
        && bound && waited >= +bound[1] - 500 && waited < +bound[1] + 5000,
        "returned after " + waited + " ms against a bound of " + (bound ? bound[1] : "?")
          + " ms, " + w.out.aborts + " abort(s), refused " + (r && r.refused)
          + ". Unbounded, this call never returns and the RTH behind it never finishes");
}

console.log("\n-- 3-8: Return-to-Home --");

// 3. THE FINDING. A refused command must not become a drawn route and a promise.
{
  const w = world({ reply: "refuse" });
  await w.doRTH({});
  const a = w.after();
  check("3. a REFUSED Return-to-Home draws no route home and writes no intent",
        a.runRoute === null && a.planIntent === null
        && /^RTH REFUSED: ARM before commanding the boat/.test(w.banner()),
        "runRoute " + (a.runRoute ? a.runRoute.length + " wpts" : "null") + ", intent "
          + JSON.stringify(a.planIntent) + "; banner: " + w.banner().slice(0, 74));
}

// 3b. AND THE GUARD'S EPISODE IS NOT SPENT ON IT. setPlanIntent's first statement clears
// guardOverride, the deviation budget, guardActedAt and holdWant - "a new commanded motion is
// a new decision". A command the vessel refused is not a new commanded motion: the boat is
// still on the old plan, still in whatever the guard was managing, and the operator's
// per-episode "proceed" and the console's own budget for moving their track would have been
// wiped by a press that did nothing.
{
  const w = world({ reply: "refuse" });
  await w.doRTH({});
  const g = w.after().guard;
  check("3b. ... and the clearance guard's per-episode record survives it",
        g.guardOverride !== null && g.edgeSpentM === 40 && g.edgeCount === 2
        && g.guardActedAt === 12345,
        "override " + (g.guardOverride ? "kept" : "WIPED") + ", edge budget " + g.edgeSpentM
          + " m / " + g.edgeCount + ", guardActedAt " + g.guardActedAt);
}

// 4. A LOST REPLY IS NOT A REFUSAL. The server applies the command and only then serializes
// its answer, so a reply lost on the way back says nothing about whether the vessel took it.
// The card renders rthChainFailed as "REFUSED, will hold instead"; a console that got no
// answer has not earned that word, and the banner says what is actually not known.
{
  const w = world({ reply: "throw" });
  await w.doRTH({ chained: true });
  const a = w.after();
  check("4. a LOST reply leaves the end-of-plan promise alone and says so - it is not a refusal",
        a.rthChainFailed === false && a.runRoute === null
        && /^RTH NOT ACKNOWLEDGED/.test(w.banner()) && /cannot tell/.test(w.banner()),
        "rthChainFailed " + a.rthChainFailed + "; banner: " + w.banner().slice(0, 96));
}

// 4b. ...and a WITNESSED refusal does retract it, which is the pair that makes 4 mean
// something. Without this, "never retract" would pass check 4 and restore the finding.
{
  const w = world({ reply: "refuse" });
  await w.doRTH({ chained: true });
  const a = w.after();
  check("4b. ... and a refusal the console WITNESSED does retract it",
        a.rthChainFailed === true && /HOLDING at her last waypoint/.test(w.banner()),
        "rthChainFailed " + a.rthChainFailed + "; the chained banner names where she is: "
          + w.banner().slice(-64));
}

// 5. THE VIEW-ONLY TAB, which is the case a naive repair gets wrong. The end-of-plan chain
// fires from applyState in EVERY tab - there is no supervising() test on it - so a plain
// "not ok -> the chain failed" would have a view-only tab paint "REFUSED, will hold instead"
// over a boat the supervising tab is at that moment bringing home. It knows nothing. It
// takes its own sticky banner down and says nothing at all; cmd() has already told the
// operator why, once.
{
  const w = world({ viewOnly: true });
  await w.doRTH({ chained: true });
  const a = w.after();
  check("5. a VIEW-ONLY tab claims NOTHING about the boat - no route, no retraction, and its "
        + "own \"Routing home\" banner taken down rather than replaced",
        a.rthChainFailed === false && a.runRoute === null && a.planIntent === null
        && w.banner() === "" && w.out.posts.length === 0
        && w.out.notes.some((n) => /VIEW ONLY/.test(n)),
        "chain " + a.rthChainFailed + ", banner " + JSON.stringify(w.banner())
          + ", " + w.out.posts.length + " post(s). The supervising tab may be bringing her "
          + "home this second - this tab may not say otherwise");
}

// 6. TEST FOR SUCCESS, NOT FOR FAILURE - the rule doSetHome states in its own comment forty
// lines above doRTH. Every REFUSAL cmd() produces carries an `error`, so on those two the
// two spellings agree and a fixture built from refusals alone cannot tell them apart. The
// answer that separates them is the one with no `ok` AND no `error`: a 200 whose body is not
// the console's JSON, which cmd()'s own `r.json().catch(()=>({}))` turns into {}. A captive
// portal or a proxy error page is exactly that, and an `if(r.error)` gate falls straight
// through it and draws a route home for a command the console never saw.
{
  const w = world({ reply: "junk" });
  await w.doRTH({ chained: true });
  const a = w.after();
  check("6. the gate tests for SUCCESS: a 200 that is not the console's answer draws nothing",
        a.runRoute === null && a.planIntent === null && a.rthChainFailed === false
        && /^RTH NOT ACKNOWLEDGED/.test(w.banner()),
        "unparseable 200 -> " + (a.runRoute === null ? "no route drawn" : "ROUTE DRAWN")
          + ", chain left alone " + (a.rthChainFailed === false)
          + "; an `if(r.error)` gate sees no error here and commits the lot");
}

// 7. THE ACCEPTANCE CASE, and it is the point of the pair: a fix that simply stopped drawing
// every RTH would pass every check above.
{
  const w = world({});
  await w.doRTH({ chained: true });
  const a = w.after();
  check("7. an ACCEPTED Return-to-Home still commits exactly as before",
        a.runRoute && a.runRoute.length === 2 && a.planIntent && a.planIntent.kind === "rth"
        && a.rthChainFailed === false && w.out.card > 0
        && /^RTH: routed around nogo zone/.test(w.banner())
        && a.guard.guardOverride === null && a.guard.edgeSpentM === 0,
        "route " + (a.runRoute ? a.runRoute.length : 0) + " wpts, intent "
          + (a.planIntent && a.planIntent.kind) + ", card updated " + w.out.card
          + "x, guard episode reset (as a real new motion must): "
          + (a.guard.guardOverride === null) + "; banner: " + w.banner().slice(0, 48));
}

// 8. THE NO-FIX BRANCH. "no fix: let the server drive direct" still has to find out whether
// the server took it - and it was fire-and-forget, so a chained return with no GPS fix left
// the promise standing for a command that was refused.
{
  const w = world({ reply: "refuse", noFix: true });
  await w.doRTH({ chained: true });
  const a = w.after();
  check("8. the no-position-fix branch is awaited too, and a refusal there retracts the promise",
        w.out.posts.length === 1 && a.rthChainFailed === true
        && /^RTH REFUSED/.test(w.banner()) && /no route to draw/.test(w.banner()),
        w.out.posts.length + " post(s), chain retracted " + a.rthChainFailed
          + "; banner: " + w.banner().slice(0, 88));
}

console.log("\n-- 9-11: the same rule at the other two commanded motions --");

// 9. Go-To carries the identical statement with the identical consequence.
{
  const w = world({ reply: "refuse", why: "not connected" });
  await w.doGoTo({ lat: 43.01, lon: -70.49 });
  const a = w.after();
  const ok = world({});
  await ok.doGoTo({ lat: 43.01, lon: -70.49 });
  check("9. a REFUSED Go-To draws nothing, and an accepted one still commits",
        a.runRoute === null && a.planIntent === null && /^GO-TO REFUSED: not connected/.test(w.banner())
        && ok.after().runRoute && ok.after().planIntent.kind === "goto",
        "refused -> " + (a.runRoute ? "ROUTE DRAWN" : "no route") + "; accepted -> "
          + (ok.after().planIntent || {}).kind);
}

// 10. ... and so does a drawn Transit.
{
  const w = world({ reply: "refuse", why: "not connected" });
  await w.doTransit();
  const a = w.after();
  const ok = world({});
  await ok.doTransit();
  check("10. a REFUSED Transit draws nothing, and an accepted one still commits",
        a.runRoute === null && a.planIntent === null
        && /^TRANSIT REFUSED: not connected/.test(w.banner())
        && ok.after().runRoute && ok.after().planIntent.kind === "transit",
        "refused -> " + (a.runRoute ? "ROUTE DRAWN" : "no route") + "; accepted -> "
          + (ok.after().planIntent || {}).kind);
}

// 11. ⚠ AND THE BLOCKED-TRANSIT HIGHLIGHT SURVIVED THE FIX. This is the check that exists
// because the FIRST version of this repair would have broken it, and an adversarial review
// caught it before it was written. doTransit drew the route ABOVE the post, and the
// unroutable branch RETURNS above the post - so "gate the draw on the answer" would have
// deleted the drawing that branch's own banner promises: it says the blocked legs are
// "highlighted", and the highlight is drawn from `runUnsafe` and from nothing else. The draw
// was duplicated into that branch rather than moved below the post. Nothing tested this
// branch at all until now.
{
  const blocked = { route: [{ lat: 43.0, lon: -70.5 }, { lat: 43.01, lon: -70.49 }],
                    holdClear: 12, routed: false, heldOff: null, degraded: false,
                    unroutable: [[{ lat: 43.0, lon: -70.5 }, { lat: 43.01, lon: -70.49 }]] };
  const w = world({ reply: "refuse", plan: blocked });   // the post must never happen at all
  await w.doTransit();
  const a = w.after();
  check("11. a transit with NO clear detour still highlights its blocked legs - and is never "
        + "posted",
        a.runRoute && a.runRoute.length === 2 && a.planIntent && a.planIntent.kind === "transit"
        && w.out.violations === 1 && w.out.posts.length === 0
        && /NO clear detour \(highlighted\)/.test(w.banner()),
        w.out.posts.length + " post(s); runRoute " + (a.runRoute ? a.runRoute.length : 0)
          + " wpts and violations set " + w.out.violations
          + " time(s), which is what the word \"highlighted\" in its banner points at");
}

console.log("\n-- 12-14: the three fields are load-bearing, so each is pinned --");

// 12-14. Each field is deletable in one keystroke and each deletion is a different live
// defect. The behavioral checks above cover them in combination; these say which field.
{
  const c = grab("cmd");
  check("12. cmd() marks a console refusal as REFUSED - the only answer that is a fact about "
        + "the vessel",
        /return \{\.\.\.j, ok:false, error:err, sent:true, refused:true\};/.test(c),
        "without it a witnessed refusal is indistinguishable from a dropped reply, and the "
          + "end-of-plan promise can never be retracted");
  check("13. ... marks the view-only short-circuit as NOT SENT",
        /return \{ok:false, error:why, sent:false, refused:false\};/.test(c),
        "without it a tab that commanded nothing asserts that the boat is holding");
  check("14. ... and bounds the fetch it now has callers waiting on",
        /const ac = \(typeof AbortController !== "undefined"\)/.test(c)
        && /signal: ac \? ac\.signal : undefined/.test(c)
        && /clearTimeout\(killer\)/.test(c),
        "an unbounded POST behind an await is the failure this page already fixed once in "
          + "refreshNogo - and it takes the operator's RTH with it");
}

console.log("\n-- 15-18: an unreadable answer is an answer, and there is ONE test for it --");

// 15. A 2xx THE CONSOLE COULD NOT READ. cmd() maps an unparseable body to {} so it does not
// throw - and a bare {} has neither `ok` nor `error`, which made it the one answer that
// satisfied BOTH of the failure-shaped tests this page used to carry. It was filed in the
// action history as a command TAKEN and the operator was told nothing at all.
{
  const w = world({ reply: "junk" });
  const r = await w.cmd("/api/cmd/rth", {});
  const taken = w.out.recorded.filter((x) => x[0] === "cmd").length;
  check("15. a 2xx whose body will not parse comes back as NOT ACKNOWLEDGED, not as a bare {}",
        r && r.ok === false && r.sent === true && r.refused === false && !!r.error
        && taken === 0 && w.out.notes.length === 1,
        "cmd() returned " + JSON.stringify(r).slice(0, 96) + "; history rows filed as taken: "
          + taken + "; operator told " + w.out.notes.length + " time(s). As a bare {} this was "
          + "a silent success at every call site on the page");
}

// 15b. ⚠ AND THE SAME ARM CATCHES THE BOUND FIRING LATE, which is the half the 15 s timeout
// added on 2026-09-22 did NOT cover and is the reason this check exists. When the console
// answers with headers and then stalls mid-body, the AbortError is raised by `r.json()` -
// inside cmd()'s try and behind its catch - so the abort never reached the catch arm that
// reports it. Measured on the shipped page at 15005 ms: {} returned, "cmd | Return home"
// written to the history as taken, and not one word to the operator.
//
// ⚠ THIS WAITS THE REAL BOUND, a second time, which is what takes this suite to ~30 s. A
// bound whose own failure mode is tested with a mocked clock is not tested.
{
  const w = world({ reply: "hangBody" });
  const bound = +(/const CMD_TIMEOUT_MS = (\d+);/.exec(H) || [])[1];
  const t0 = Date.now();
  const r = await w.cmd("/api/cmd/rth", {});
  const waited = Date.now() - t0;
  const taken = w.out.recorded.filter((x) => x[0] === "cmd").length;
  check("15b. ... and so does a console that answers, then stalls mid-body - the bound's own "
        + "timeout is reportable",
        r && r.ok === false && r.sent === true && r.refused === false
        && taken === 0 && w.out.notes.length === 1
        && waited >= bound - 500 && waited < bound + 5000,
        "returned after " + waited + " ms against a bound of " + bound + " ms as "
          + JSON.stringify(r && r.error) + "; filed as taken: " + taken
          + ". Before this arm the same stall returned {} and wrote a 'cmd' row");
}

// 16. AND A SUCCESS IS STILL A SUCCESS. 15/15b would both pass against a cmd() that called
// every answer unreadable, which would refuse every command on the page.
{
  const w = world({});
  const r = await w.cmd("/api/cmd/rth", {});
  check("16. ... while a readable 200 is untouched: it is still the server's own body",
        r && r.ok === true && r.state && r.state.behavior === "rth"
        && w.out.recorded.filter((x) => x[0] === "cmd").length === 1,
        "cmd() returned the console's body with ok " + (r && r.ok)
          + " and filed one 'cmd' row, as it always did");
}

// 17. ONE SPELLING, counted in the page's own source. The page carried FOUR textual forms of
// this single question and two of them were wrong on the answer 15 produces. The count is
// the check: a new call site that invents a fifth is what this is here to catch, and it is
// exactly how the two wrong ones arrived - a new site copies whichever neighbour it can see.
{
  // ⚠ COMMENTS ARE NOT CODE, and this check first went red on its own explanation of
  // itself - and on a note at :3268 describing the very bug it guards. Line comments are
  // stripped before matching. A spelling buried in a TRAILING comment on a line of real
  // code would still be missed; that is the accepted limit and it cannot hide a live call
  // site, because a live call site is code.
  const CODE = H.split("\n").map((l) => (/^\s*\/\//.test(l) ? "" : l)).join("\n");
  const wrong = [
    [/\.ok === false/g, "r.ok === false"],
    [/\.ok !== false/g, "r.ok !== false"],
    [/if\(\s*\w+ && \w+\.error\s*\)/g, "if(r && r.error)"],
    [/if\(!\w+ \|\| !\w+\.ok\)/g, "if(!r || !r.ok)"],
    [/if\(!\(\w+ && \w+\.ok\)\)/g, "if(!(r && r.ok))"],
    // ⚠ THE NEGATED FORMS TOO. A mutation replacing took(r) with `!(r && r.error)` slipped
    // through the list above - every pattern there anchored on `if(` followed directly by the
    // identifier, so `if(!(` was invisible. It is the same wrong question in one more
    // costume. Only the NEGATED form is listed: `(r && r.error)` without a `!` is a read
    // of the reason for a message, which is legitimate and appears ten times.
    [/!\(\w+ && \w+\.error\)/g, "!(r && r.error)"],
  ];
  const found = [];
  for (const [re, name] of wrong) {
    const n = (CODE.match(re) || []).length;
    if (n) found.push(name + " x" + n);
  }
  const tookCalls = (CODE.match(/took\(/g) || []).length;
  check("17. the page asks \"did the command land?\" exactly one way, and it is the named one",
        found.length === 0 && tookCalls >= 14
        && /function took\(r\)\{ return !!\(r && r\.ok\); \}/.test(CODE),
        found.length ? "a hand-written spelling is back in CODE: " + found.join(", ")
                     : tookCalls + " call sites, all through took(). The two forms this "
                       + "replaced both read an unreadable 2xx as a command taken");
}

// 18. THE WORDING IS BOUND TO THE ANSWER, not to the failure. notTookSay is the one place
// that turns cmd()'s three answers into a sentence, and the distinction it carries is the
// one a plain "refused" destroys: a console that got no reply has established nothing, and
// a tab that never posted has established less than nothing.
{
  const lost = { ok: false, error: "network error", sent: true, refused: false };
  const refused = { ok: false, error: "ARM before commanding the boat", sent: true, refused: true };
  const viewOnly = { ok: false, error: "this tab is VIEW ONLY", sent: false, refused: false };
  const W = world({});
  check("18. a REFUSAL, a LOST reply and a tab that never asked produce three different "
        + "sentences - and the third is no sentence at all",
        /^RTH REFUSED: ARM before/.test(W.notTookSay(refused, "RTH"))
        && /^RTH NOT ACKNOWLEDGED/.test(W.notTookSay(lost, "RTH"))
        && /cannot tell whether she received it/.test(W.notTookSay(lost, "RTH"))
        && W.notTookSay(viewOnly, "RTH") === null,
        "refused -> " + JSON.stringify((W.notTookSay(refused, "RTH") || "").slice(0, 34))
          + "; lost -> " + JSON.stringify((W.notTookSay(lost, "RTH") || "").slice(0, 34))
          + "; view-only -> " + JSON.stringify(W.notTookSay(viewOnly, "RTH")));
}

// 19. ⚠ THE ORDER OF cmd()'s TWO FAILURE ARMS IS LOAD-BEARING, and nothing held it: a
// mutation that tests `unreadable` BEFORE the status survived the whole sweep. A refusal
// whose BODY is also unreadable - a proxy answering 409 with an HTML page, the console cut
// off mid-reason - is still a refusal, and the status is what says so. Read the other way
// round it becomes "not acknowledged", which is not a cosmetic difference: `refused` is the
// only answer allowed to retract the end-of-plan return, so the promise would stand for a
// boat the console had just been told to leave where she is.
//
// cmd() synthesizes the reason from the status when the body cannot supply one, which is
// why this stays a refusal WITH something to say rather than a refusal with an empty mouth.
{
  const w = world({ reply: "refuseJunk" });
  const r = await w.cmd("/api/cmd/rth", {});
  const wc = world({ reply: "refuseJunk" });
  await wc.doRTH({ chained: true });
  check("19. a REFUSAL whose body will not parse is still a REFUSAL, and still retracts the "
        + "end-of-plan promise",
        r && r.ok === false && r.refused === true && r.sent === true
        && /409/.test(r.error || "") && wc.after().rthChainFailed === true,
        "409 + unreadable body -> refused " + (r && r.refused) + ", reason "
          + JSON.stringify(r && r.error) + "; chained RTH retracted "
          + wc.after().rthChainFailed + ". Testing `unreadable` first turns this into a "
          + "not-acknowledged and the promise stands");
}

console.log("\n-- 20-23: SHAPE B - nothing is thrown away before the reply --");

// 20-21. THE OPPOSITE REPAIR TO THE GUARD RUNGS', for the opposite shape. These handlers
// nulled the drawn route and the Intent card and THEN posted, so a console answering "not
// connected" or "ARM before commanding the boat" left the operator with a blank chart while
// the boat flew on. Nothing puts it back: `runRoute` is written only by the commanded
// motions and cleared only here, and /api/state carries no route at all.
//
// ⚠ AND IT IS WORSE THAN A BLANK CHART. renderIntent falls back to mission.waypoints when
// runRoute is null and prints "route not held by this page — the vessel is flying one this
// page did not upload" seconds after this page uploaded it. (That readout is its own filed
// defect; this check is about not reaching it.)
//
// The file already held the rule, in doSpawn's own words: "NOTHING IS THROWN AWAY BEFORE THE
// REPLY. This block used to run FIRST, so a spawn the server REFUSED still cost the operator
// their trail and their drawn route."
// ⚠ THE FIXTURE IS SEEDED, AND THAT IS NOT A DETAIL. This check first asserted
// `a.runRoute === null` for the REFUSED case - the literal opposite of its own headline -
// and passed, because the world starts runRoute at null and nothing ever set it. "Left
// alone" and "never there" are the same observation until you put something there. Caught
// by an adversarial pass, which also showed the partial revert it let through: move the
// three route clears back above the post and leave only guardHeld past the gate, and all
// 59 suites stayed green.
const ROUTE = [{lat: 43.0, lon: -70.5}, {lat: 43.01, lon: -70.49}];
{
  const no = world({ reply: "refuse", why: "not connected" });
  no.seed(ROUTE, {kind: "survey"});
  await no.bHold();
  const a = no.bar();
  const ok = world({});
  ok.seed(ROUTE, {kind: "survey"});
  await ok.bHold();
  const b = ok.bar();
  check("20. a REFUSED Hold leaves the plan ON THE CHART - she is still flying it - and an "
        + "accepted one still clears it",
        a.runRoute === ROUTE && a.planIntent !== null && a.runUnsafe.length === 1
        && a.guardHeld !== null && /^HOLD REFUSED: not connected/.test(no.banner())
        && b.runRoute === null && b.planIntent === null && b.runUnsafe.length === 0
        && b.guardHeld === null,
        "refused -> route " + (a.runRoute ? "kept" : "WIPED") + ", intent "
          + (a.planIntent ? "kept" : "WIPED") + ", guardHeld "
          + (a.guardHeld ? "kept" : "WIPED") + ", banner "
          + JSON.stringify(no.banner().slice(0, 52)) + "; accepted -> guardHeld "
          + (b.guardHeld ? "STILL SET" : "cleared") + ". The offer belongs to the hold that "
          + "was taken, and a Hold the vessel refused did not take one");
}

// 21. STOP, and `escapeThrottle` is the one that matters. A refused Stop during an
// in-extremis escape must NOT release the governor's gag: the escape is still running, and
// handing the throttle back to the role speed mid-escape is the opposite of what that rung
// commanded. Every other release of it says so out loud (setRoleSpeed flashes "Speed
// released — the escape's high-speed hold is over"); this one would have been silent.
{
  const no = world({ reply: "refuse", why: "not connected" });
  no.seed(ROUTE, {kind: "survey"});
  await no.bStop();
  const a = no.bar();
  const ok = world({});
  ok.seed(ROUTE, {kind: "survey"});
  await ok.bStop();
  const b = ok.bar();
  check("21. a REFUSED Stop keeps the plan, the escape's high-speed hold and the pause mark; "
        + "an accepted one drops all of them",
        a.runRoute === ROUTE && a.planIntent !== null
        && a.escapeThrottle === true && a.pauseMark !== null && a.resumeSlow === true
        && a.commandedSpeed === "low"
        && b.runRoute === null && b.planIntent === null
        && /SHE IS STILL RUNNING/.test(no.banner())
        && b.escapeThrottle === false && b.pauseMark === null && b.resumeSlow === false
        && b.commandedSpeed === null,
        "refused -> route " + (a.runRoute ? "kept" : "WIPED")
          + ", escapeThrottle " + a.escapeThrottle + ", pauseMark "
          + (a.pauseMark ? "kept" : "WIPED") + ", commanded "
          + JSON.stringify(a.commandedSpeed) + "; accepted -> escapeThrottle "
          + b.escapeThrottle + ", pauseMark " + (b.pauseMark ? "STILL SET" : "cleared"));
}

// 22. ⚠⚠ AND #b_estop IS EXEMPT, WHICH IS THE ONE TO GET RIGHT. Engine.set_estop latches on
// the CONSOLE whatever the link did - it sets estop, disarms, sets run "idle", pushes the
// state, and only THEN re-raises the link's refusal (review #27, in its own words: "a latch
// holds on the console whatever the link did ... and says the vessel did not take it"). So a
// 409 on a LATCH is precisely the case where the console HAS latched: the drawn plan is not
// this console's any more, and keeping it on screen would be the false picture.
//
// This is a SOURCE check on purpose: the handler asks guiConfirm and reads S, so driving it
// would test the stubs. What it pins is that the clear is NOT behind a took() gate - i.e.
// that a later tidy-up folding it into the uniform rule is caught.
// ⚠⚠ THE EXEMPTION ASKS THE ANSWER NOW, AND THAT CORRECTION CAME FROM BEING REFUTED. The
// argument for it - the console latches a command E-STOP whatever the vessel does - holds
// for a refusal the console ANSWERED, and a 409 raised after the latch carries
// `state.estop` true in its body. It does NOT hold for a VIEW-ONLY tab, whose press never
// reached the console, nor for a reply that was lost: both of those used to wipe this tab's
// chart for a console that had latched nothing. Driven all four ways rather than pinned by
// source text, because a source check could not tell those cases apart.
//
// ⚠⚠ AND ONE OF THOSE FOUR CASES TURNED OUT NOT TO EXIST, WHICH IS WHY IT IS STILL DRIVEN.
// The refutation that produced this check assumed a VIEW-ONLY tab's E-STOP is refused inside
// cmd() and so latches nothing. It is not: `/api/cmd/estop` is in SUPERVISOR_ANY
// (asv.html:9800, "never gated, in either direction") along with stop and pause, because a
// control that REDUCES risk is live in every tab. So that press really is sent, really does
// latch, and really should clear - and this check says so, rather than excluding the case.
// The genuinely unreachable-for-estop answer is `sent:false`; the reachable failure is a
// LOST reply, and that one must not clear.
{
  const latched = { ok: false, status: 409, error: "the vessel did not take the command",
                    sent: true, refused: true, state: { estop: true } };
  const runs = {};
  for (const [name, opts] of [["accepted", {}],
                              ["latched-409", { reply: "custom", body: latched }],
                              ["view-only", { viewOnly: true }],   // still SENT: stop-class
                              ["lost", { reply: "throw" }]]) {
    const w = world(opts);
    w.seed(ROUTE, { kind: "survey" });
    w.W.S.estop = false;
    await w.bEstop();
    runs[name] = w.bar();
  }
  check("22. #b_estop clears on a latch the console CONFIRMS - including a 409 that latched, "
        + "and from a view-only tab, because the stop class is live in every one - but NOT on "
        + "a reply that never arrived",
        runs.accepted.runRoute === null && runs["latched-409"].runRoute === null
        && runs["view-only"].runRoute === null && runs.lost.runRoute === ROUTE,
        "accepted -> " + (runs.accepted.runRoute ? "KEPT" : "cleared")
          + "; 409 carrying state.estop -> " + (runs["latched-409"].runRoute ? "KEPT" : "cleared")
          + "; view-only -> " + (runs["view-only"].runRoute ? "KEPT" : "cleared")
          + " (SUPERVISOR_ANY: that press IS sent)"
          + "; lost reply -> " + (runs.lost.runRoute ? "kept" : "WIPED")
          + ". Only the last is a console that may have latched nothing");
}

// 23. THE EMPTY-PLAN UPLOAD. Its clear is now nearly unreachable, because the console refuses
// an empty plan in words - and that is the point rather than dead code: this branch is
// reachable only while mission.waypoints is empty, which a Go-To or RTH does not fill, so
// `runRoute` may hold the motion she is still flying. The acceptance half is what stops a
// later reader deleting the gate.
{
  const src = grab("doUpload");
  check("23. the empty-plan upload clears only past the gate, and says why the clear is not "
        + "dead code",
        /if\(took\(r\)\)\{ runRoute=null; planIntent=null; \}/.test(src)
        && /may hold the Go-To or/.test(src),
        "a refusal here must not wipe a commanded motion that is still under way, and the "
          + "reason is recorded beside it");
}


// 24. ⚠ A WANT FOR A COMMAND THIS TAB NEVER SENT IS NOT A WANT. `commandSpeed` set
// `speedWant` BEFORE posting, and in a view-only tab cmd() refuses before any fetch - so the
// want stood, `speedReconcile` watched the vessel disagree with it for ever, re-sent on every
// window (each refused here too) and then raised "THE VESSEL IS NOT TAKING THE SPEED
// COMMAND", blaming the boat for an instruction that never left the browser. That is one of
// the open MEDIUM findings, and it is also the mechanism that was silently REPLACING the
// in-extremis banner, because banners are sticky and last-write-wins.
//
// ⚠⚠ THE PAIR IS THE WHOLE CHECK. Clearing on every failure would undo the re-send this
// mechanism exists for - a REFUSAL and a LOST reply must both KEEP the want, because the
// vessel may yet take it and the reconcile loop is what makes that happen.
{
  const view = world({ viewOnly: true });
  await view.commandSpeed("low");
  const no = world({ reply: "refuse", why: "not connected" });
  await no.commandSpeed("low");
  const lost = world({ reply: "throw" });
  await lost.commandSpeed("low");
  const ok = world({});
  await ok.commandSpeed("low");
  check("24. a view-only tab leaves NO speed want behind - and a refusal or a lost reply "
        + "still leaves one, because that is what the re-send is for",
        view.want() === null && view.out.posts.length === 0
        && no.want() !== null && lost.want() !== null && ok.want() !== null,
        "view-only -> want " + (view.want() ? "STILL SET" : "null") + " after "
          + view.out.posts.length + " post(s); refused -> "
          + (no.want() ? "kept" : "WIPED") + "; lost -> " + (lost.want() ? "kept" : "WIPED")
          + "; accepted -> " + (ok.want() ? "kept" : "WIPED"));
}

// 25. #b_start was the one of THREE start sites that dropped its reply (resumeRun and
// resumeHeldSurvey have always read theirs), so a refused Start was a button press that
// looked like a departure - the confirm dialog answered, the run state unchanged, and
// nothing said so.
{
  const no = world({ reply: "refuse", why: "upload a run plan first" });
  no.W.S.run = "idle";
  await no.bStart();
  const ok = world({});
  ok.W.S.run = "idle";
  await ok.bStart();
  // ⚠ AND THE LOST REPLY MUST NOT SAY "has NOT begun". Glued on unconditionally that
  // suffix contradicted the sentence it was attached to - "it may or may not have been
  // carried out ... the survey has NOT begun" - and asserted the one thing the console had
  // just said it could not know, in the unsafe direction.
  const lost = world({ reply: "throw" });
  lost.W.S.run = "idle";
  await lost.bStart();
  check("25. a REFUSED Start says the survey has not begun - and a LOST reply says to check "
        + "the run state instead of asserting it",
        /^START REFUSED: upload a run plan first/.test(no.banner())
        && /has NOT begun/.test(no.banner()) && ok.banner() === ""
        && /^START NOT ACKNOWLEDGED/.test(lost.banner())
        && !/has NOT begun/.test(lost.banner())
        && /check the run state/.test(lost.banner()),
        "refused -> " + JSON.stringify(no.banner().slice(0, 56))
          + "; lost -> " + JSON.stringify(lost.banner().slice(-46))
          + "; accepted -> " + JSON.stringify(ok.banner()));
}


// 26. ⚠ THE THIRD ANSWER, ON BOTH GATES. Checks 20 and 21 drove only a refusal and a
// success, and this suite's own header says why that is not enough - "THE ANSWER HAS THREE
// STATES AND THIS SUITE EXISTS TO KEEP THEM APART". Narrowing either gate from took() to
// `r.refused` survived ten suites: a LOST or timed-out Stop would then wipe the route, the
// Intent card, the pause mark AND the escape's high-speed hold, on a reply that says nothing
// about whether she stopped.
{
  const h = world({ reply: "throw" });
  h.seed(ROUTE, { kind: "survey" });
  await h.bHold();
  const s = world({ reply: "throw" });
  s.seed(ROUTE, { kind: "survey" });
  await s.bStop();
  check("26. a LOST reply is not a refusal, and neither gate opens for it",
        h.bar().runRoute === ROUTE && h.bar().guardHeld !== null
        && s.bar().runRoute === ROUTE && s.bar().escapeThrottle === true
        && s.bar().pauseMark !== null
        && /^HOLD NOT ACKNOWLEDGED/.test(h.banner()) && /^STOP NOT ACKNOWLEDGED/.test(s.banner())
        && !/SHE IS STILL RUNNING/.test(s.banner()),
        "Hold lost -> route " + (h.bar().runRoute ? "kept" : "WIPED")
          + "; Stop lost -> route " + (s.bar().runRoute ? "kept" : "WIPED")
          + ", escapeThrottle " + s.bar().escapeThrottle
          + "; and neither says SHE IS STILL RUNNING, which the console cannot know");
}

// 27. ⚠⚠ AND THE CLEAR MAY NOT OVERTAKE A COMMAND GIVEN DURING ITS OWN ROUND TRIP. Past the
// reply is the right side of the post, but it is also a WINDOW: the clearance guard runs at
// 4 Hz throughout it and its rungs write these very fields. An accepted Stop clearing them
// unconditionally would erase an escape the guard commanded while the Stop was in flight -
// `escapeThrottle` included, which is the same release this commit refuses to make on a
// REFUSED Stop. Found by an adversarial pass, not by a check, and it was BLOCKING.
{
  const w = world({ slowReply: true });
  w.seed(ROUTE, { kind: "survey" });
  // ⚠ NOT ESCAPING WHEN THE BUTTON IS PRESSED. If it were already set, "left alone"
  // and "cleared then re-set" would look identical and the check could not tell them
  // apart - the same vacuity that made checks 20/21 pass before they were seeded.
  w.setThrottle(false);
  const inFlight = w.bStop();                   // the guard fires inside this window
  await inFlight;                               // (the fetch stub does it at +5 ms)
  const a = w.bar();
  check("27. an ACCEPTED Stop clears only what it found - state written during its own round "
        + "trip belongs to the command that wrote it",
        a.escapeThrottle === true && a.runRoute === null,
        "the guard set escapeThrottle during the window and it SURVIVED the accepted Stop ("
          + a.escapeThrottle + "), while the route this press did find was cleared ("
          + (a.runRoute === null ? "yes" : "NO") + "). Cleared unconditionally, an accepted "
          + "Stop un-gags the governor in the middle of an escape");
}

// 28. A REFUSED START PUTS THE FRESH-RUN CLEARS BACK. These are the one set on this bar that
// runs IN FRONT of its post, and that is deliberate: Engine.start pushes the new run's state
// inside its own lock, so the telemetry frame can reach this page before the reply and
// onState judges it with clearanceGuard() and speedGovernor(). Cleared past the gate, that
// frame would be read against the PREVIOUS run's holds. The safety therefore comes from
// putting them back, not from delaying them.
{
  const no = world({ reply: "refuse", why: "upload a run plan first" });
  no.W.S.run = "idle";
  await no.bStart();
  const a = no.bar();
  const ok = world({});
  ok.W.S.run = "idle";
  await ok.bStart();
  const b = ok.bar();
  check("28. a REFUSED Start restores the holds it cleared in front of the post; an accepted "
        + "one leaves them cleared",
        a.escapeThrottle === true && a.pauseMark !== null && a.resumeSlow === true
        && b.escapeThrottle === false && b.pauseMark === null,
        "refused -> escapeThrottle " + a.escapeThrottle + ", pauseMark "
          + (a.pauseMark ? "restored" : "STILL WIPED") + "; accepted -> escapeThrottle "
          + b.escapeThrottle + ". Releasing two safety holds on a press that did nothing is "
          + "the fault this commit exists to remove");
}

// 29. ⚠ AND THE RE-SEND GOES THROUGH THE SAME DOOR. The want-dropping rule was first written
// on commandSpeed alone, and speedReconcile re-sends with its own call - so a tab that WAS
// supervising, commanded a speed, and then lost the post to a TAKE OVER kept re-sending and
// kept blaming the vessel. Both senders go through sendSpeed now; this drives the re-send.
{
  const w = world({});
  await w.commandSpeed("low");
  const before = w.want();
  w.setViewOnly(true);                       // another window pressed TAKE OVER
  await w.sendSpeed("low");                  // what speedReconcile does on its next window
  check("29. a tab that loses the post mid-reconcile drops the want rather than re-sending "
        + "for ever and blaming the vessel",
        before !== null && w.want() === null,
        "want after the first send: " + (before ? "set" : "null")
          + "; after the post was taken away: " + (w.want() ? "STILL SET" : "null")
          + ". Left set, speedReconcile re-sends on every window and then raises \"THE VESSEL "
          + "IS NOT TAKING THE SPEED COMMAND\" in a tab that sent nothing");
}


// 30-31. ⚠⚠ THE DRAWN PICTURE IS ONE THING, AND THE FIRST CUT GUARDED ITS FIELDS SEPARATELY.
// The clearance guard's DEVIATION rung REPLACES `runRoute` with a new array while MUTATING
// the same `planIntent` object in place - so per-field identity comparisons disagreed with
// each other during the round trip, and an accepted Hold left the track drawn with its
// reasoning nulled. That is the same false picture this whole seam is about, in the other
// direction, and it was BLOCKING.
//
// ⚠ BOTH HORNS ARE DRIVEN, because the obvious repair has the other one: key the picture on
// the route's identity and an AMENDED plan is never cleared at all - when an amendment is
// the SAME plan and an accepted Hold must still clear it. The generation is bumped inside
// setPlanIntent, which is called at every site that installs a new commanded route and at
// neither that amends one.
{
  const w = world({ slowReply: true });
  w.seed(ROUTE, { kind: "survey" });
  const inFlight = w.bHold();
  await Promise.resolve();
  w.amend();                                   // the guard deviates mid-round-trip
  await inFlight;
  const a = w.bar();
  // ⚠ AND THE SAME FOR STOP, which carries the identical mechanism: driving only one of
  // the pair left "b_stop's picture cleared unconditionally" alive through ten suites.
  const s = world({ slowReply: true });
  s.seed(ROUTE, { kind: "survey" });
  const sFlight = s.bStop();
  await Promise.resolve();
  s.amend();
  await sFlight;
  const sa = s.bar();
  check("30. an AMENDMENT during the round trip is the SAME plan, so an accepted Hold or Stop "
        + "still clears the whole picture",
        a.runRoute === null && a.planIntent === null && a.runUnsafe.length === 0
        && sa.runRoute === null && sa.planIntent === null,
        "route " + (a.runRoute ? "STILL DRAWN" : "cleared") + ", intent "
          + (a.planIntent ? "STILL THERE" : "cleared")
          + ". Guarded field-by-field, the route looked changed and the reasoning looked "
          + "untouched - so the track stayed drawn with its explanation nulled");
}
{
  const w = world({ slowReply: true });
  w.seed(ROUTE, { kind: "survey" });
  const inFlight = w.bHold();
  await Promise.resolve();
  w.newMotion();                               // a NEW commanded motion mid-round-trip
  await inFlight;
  const a = w.bar();
  const s = world({ slowReply: true });
  s.seed(ROUTE, { kind: "survey" });
  const sFlight = s.bStop();
  await Promise.resolve();
  s.newMotion();
  await sFlight;
  const sa = s.bar();
  check("31. ... but a NEW commanded motion during it is a new picture, and the Hold or Stop "
        + "that did not find it may not throw it away",
        a.runRoute !== null && a.runRoute[0].lat === 9 && a.planIntent !== null
        && sa.runRoute !== null && sa.runRoute[0].lat === 9,
        "the later motion's route " + (a.runRoute ? "survived" : "WAS WIPED")
          + " and its reasoning " + (a.planIntent ? "survived" : "WAS WIPED")
          + ". Cleared unconditionally, an accepted Hold erases the plan a command gave "
          + "while it was in flight");
}

// 32. THE SAME RULE ON THE RESTORE, which is where it was missing. #b_start's failure path
// put five fields back with no test at all - and the guard writes two of them during that
// round trip. Restoring `escapeThrottle` unconditionally UN-GAGS THE GOVERNOR IN THE MIDDLE
// OF AN ESCAPE, which is the fault check 27 calls blocking on the sibling handler, mirrored.
{
  const w = world({ reply: "refuse", why: "upload a run plan first" });
  w.W.S.run = "idle";
  // ⚠ NOT ESCAPING WHEN THE BUTTON IS PRESSED, or the mutation is invisible: the world seeds
  // escapeThrottle TRUE, so an unconditional restore would write TRUE back and the check
  // would pass on the defect. A seed that happens to equal what the mutation writes is the
  // same vacuity as asserting a fixture's own default - it cost this suite two survivors.
  w.setThrottle(false);
  const inFlight = w.bStart();
  await Promise.resolve();
  w.setThrottle(true);                         // the helm rung takes her, mid-round-trip
  w.setWant({ key: "high" });                  // ...and commands the escape's speed
  await inFlight;
  const a = w.bar();
  // ⚠⚠ AND THE OTHER HALF, because the first one ALONE is vacuous: this check writes
  // speedWant DURING the window and then asserts it, so deleting the restore leaves the
  // value the check itself put there. A second world where nothing touches speedWant in
  // flight is what makes the restore observable at all. Third time this shape has bitten
  // in one session: ask what the value WAS before the code ran.
  const q = world({ reply: "refuse", why: "upload a run plan first" });
  q.W.S.run = "idle";
  q.setThrottle(false);
  q.setWant({ key: "survey" });                // the operator's own want, before the press
  await q.bStart();                            // nothing writes it during this one
  const qa = q.bar();
  check("32. a refused Start restores only what it still owns - an escape commanded during "
        + "its round trip keeps the governor stood down, and an untouched want comes back",
        a.escapeThrottle === true && a.speedWant !== null && a.speedWant.key === "high"
        && qa.speedWant !== null && qa.speedWant.key === "survey",
        "escapeThrottle after the refused Start: " + a.escapeThrottle
          + ", the escape's want " + JSON.stringify(a.speedWant && a.speedWant.key)
          + "; an UNTOUCHED want came back as "
          + JSON.stringify(qa.speedWant && qa.speedWant.key)
          + ". Restored unconditionally they go back to the pre-press values and the governor "
          + "bids the role speed over the rung's HIGH, beside whatever she was steered off");
}


// 33. ⚠ THE RE-SEND PATH, DRIVEN. Check 29 called sendSpeed directly, which tests the door
// rather than that speedReconcile goes through it - and routing the re-send back around it
// restored the exact half-fix the page's own comment calls the reachable case ("a tab can
// lose the post BETWEEN them ... because TAKE OVER exists"). All 56 suites stayed green on
// that revert.
{
  const w = world({});
  await w.commandSpeed("low");
  w.setViewOnly(true);                         // another window pressed TAKE OVER
  w.ageWant(999999);                           // the re-send window has come round
  w.reconcile({ armed: true, estop: false, run: "running" }, { speed_key: "survey" });
  await Promise.resolve(); await Promise.resolve();
  check("33. speedReconcile's RE-SEND goes through the same door, so a tab that lost the post "
        + "stops re-sending instead of blaming the vessel",
        w.want() === null,
        "want after a reconcile from a tab that no longer holds the post: "
          + (w.want() ? "STILL SET - it re-sends on every window and then raises THE VESSEL "
              + "IS NOT TAKING THE SPEED COMMAND" : "null"));
}

// 34. #b_hold's compare-and-clear had the identical mechanism to #b_stop's and none of its
// coverage: replacing all four guards with unconditional clears survived 56 suites.
{
  const w = world({ slowReply: true });
  w.seed(ROUTE, { kind: "survey" });
  w.setHeld(null);
  const inFlight = w.bHold();
  await Promise.resolve();
  w.setHeld({ route: [1, 2], idx: 3 });        // the guard keeps a survey mid-round-trip
  await inFlight;
  check("34. an accepted Hold leaves a survey record the guard kept during its own round trip",
        w.bar().guardHeld !== null,
        "guardHeld after the accepted Hold: "
          + (w.bar().guardHeld ? "kept" : "WIPED - and the operator's one-click resume with "
              + "it, for a record this press never saw"));
}


// 36. ⚠ THE GENERATION LIVES IN setPlanIntent, AND THIS SUITE MODELS THAT FUNCTION RATHER
// THAN GRABBING IT - it resets five guard-episode variables and would drag the whole guard in
// with it. So the behavioural checks above cannot see the page's own `planGen++` move, and a
// mutation deleting it survived ten suites. Pinned at the source, with the reason recorded:
// it must sit in the ONE function called at every site that installs a new commanded route
// and at neither of the two that amend one.
{
  const spi = grab("setPlanIntent");
  const amenders = ["runRoute = [...runRoute.slice(0, trkNow.idx), ...tail];",
                    "runRoute = [...rr.slice(0, idx), ...tail];"];
  check("36. the picture's generation is bumped inside setPlanIntent, and the two AMEND sites "
        + "do not call it",
        /^function setPlanIntent\([^)]*\)\{\s*planGen\+\+;/m.test(spi)
        && amenders.every((a) => H.indexOf(a) >= 0)
        && amenders.every((a) => !/setPlanIntent/.test(H.slice(H.indexOf(a), H.indexOf(a) + 400))),
        "planGen++ is setPlanIntent's first statement, and neither amend site calls it within "
          + "400 characters - so an amended plan keeps its generation and is still cleared by "
          + "an accepted Hold, while a newly commanded one is not");
}

// 37. A 409 WHOSE BODY WILL NOT PARSE STILL LATCHED. cmd() builds a non-2xx reply from `j`,
// which is {} when the body could not be read - so `state.estop` is absent exactly when the
// console has latched anyway, and gating on it alone left the plan drawn for a console that
// is idle and disarmed. `refused` survives an unreadable body because it is set from the
// STATUS.
{
  const w = world({ reply: "refuseJunk" });
  w.seed(ROUTE, { kind: "survey" });
  w.W.S.estop = false;
  await w.bEstop();
  check("37. ... and a 409 the console answered still clears, even when its body will not "
        + "parse and carries no state",
        w.bar().runRoute === null,
        "unreadable 409 -> " + (w.bar().runRoute ? "PLAN STILL DRAWN for a console that has "
          + "latched, disarmed and gone idle" : "cleared"));
}

// 38. ⚠ #b_PAUSE IS THE SIXTH SITE OF THE RULE. `markPause()` records WHERE she stopped - the
// mark a Resume backtracks from - and it ran before the console answered. A pause this tab
// was never allowed to send left a mark for a pause that never happened, and the next Resume
// would back up down a line she had not stopped on.
//
// ⚠ KEPT ON A WITNESSED REFUSAL AND ON A LOST REPLY: a 409 means she is still running and the
// operator will press again, and a lost reply may well have paused her. Only `sent === false`
// says nothing happened at all.
{
  // ⚠ THIS CHECK WAS WRITTEN TO PROVE #b_pause WAS A SIXTH SITE AND PROVED THE OPPOSITE,
  // which is why it survives as the record. Driving it showed the view-only mark is
  // ALWAYS left - because `/api/cmd/pause` is in SUPERVISOR_ANY and that press really is
  // sent. The fix was reverted rather than shipped inert; this pins the two facts that
  // make it unnecessary, so the next reader does not re-derive them.
  const view = world({ viewOnly: true });
  view.setMark(null);
  await view.bPause();
  await Promise.resolve(); await Promise.resolve();
  const resume = grab("resumeRun");
  check("38. #b_pause is NOT a site of this rule: its press is in the stop class so it is "
        + "always SENT, and the mark it leaves is read only by a paused run",
        view.out.posts.length === 1 && view.bar().pauseMark !== null
        && /SUPERVISOR_ANY = \[[^\]]*\/api\/cmd\/pause/.test(H)
        && /S && S\.run === "paused"/.test(H),
        "a view-only Pause posted " + view.out.posts.length + " time(s) and left its mark, "
          + "because the stop class is live in every tab; and the mark is consumed only on "
          + "`run === \"paused\"`, which a refused pause does not produce. "
          + (resume ? "resumeRun exists to read it" : ""));
}

finished = true;
console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
})();
