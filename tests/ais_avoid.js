// tests/ais_avoid.js - AIS contacts are keep-outs the guard acts on, and the survey comes back on its
// own once the contact has cleared the line, 100 m back down it.
//
// Andy, 2026-09-25: "Treat AIS targets with dimensions as NOGO areas. They may be moving so the
// calculation must update with them. If the AIS target moves through a survey area it will not force
// a survey pattern reconfiguration. But the ASV will avoid the AIS target and return to the survey
// line once it is clear with a 100m backup over previously run line. AIS targets without dimensions
// are to be assumed 20m long and 8m wide." Then: "disregard the 20m perimeter buffer."
//
// THE RUNGS DO THE AVOIDING, AND ONLY THE RETURN IS NEW. With the contacts folded into the model the
// guard reads (koAll in clearanceGuard), the ladder slows, holds or takes the helm for a crossing
// workboat exactly as it does for a pier - and every one of those rungs is already driven by
// guard_resume.js, clearance_guard.js and in_extremis.js. What this suite owns:
//   * the contacts REACH the ladder, the readout and the escape's search, and reach NOTHING ELSE -
//     `nogo.ko` is untouched, so no pattern is ever reconfigured for a ship;
//   * the edge rung stands down near a contact (a dog-leg neither returns nor backs up);
//   * a hold or an escape caused by a contact opens an episode, and the console brings her back
//     itself once the contact is clear of the line for AIS_RETURN_DWELL_MS: pause, upload the
//     remainder behind a rejoin point AIS_RETURN_BACK_M back down the line, LOW, Start - with
//     NONE of the operator's latches (no override, no LOW hold);
//   * a charted hold and a contact that STOPS on the line keep today's offer to the operator, and
//     nothing comes back on its own - while a GO-TO, A RETURN-TO-HOME OR A TRANSIT held for a contact gets
//     the survey's avoidance, in its own command (2026-09-29, checks 10 and 23);
//   * the ladder answers a contact only once her keep-out is within 50 m of the boat - farther for a hull
//     whose own coast datum says she needs the water to come down to LOW (the DriX) - checks 24;
//   * the console does NOT wait for the operator before routing round her (2026-11-01): the only timing
//     left is the spacing between TRIES, read from the page's own constant (WHILE_MS), never a copy (25);
//   * a stale feed is an EMPTY model that says so, never a quiet sea - and is a banner while it
//     matters;
//   * the contacts are polled whenever the console has authority, layer or no layer.
//
//   node tests/ais_avoid.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// THE WORLD BELOW IS tests/guard_resume.js's, COPIED (2026-09-25) WITH THREE EDITS: the real
// updateClearance in place of its stub, two more elements the AIS layer touches, and an escape stub
// that records the model it was handed. Every page suite declares its own world - see that file for
// why each symbol is where it is.
//
// TEETH - see the mutation sweep recorded in CLAUDE.md for this change; the check numbers below are
// the ones that went red for each mutation of static/asv.html and static/js/ais_keepout.js.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const fs = require("fs");
const path = require("path");

// ASV_HTML points this at a SIDECAR copy for a mutation run - every read of the page goes
// through it. Three suites in three commits were found reading a fixed path and scoring
// every mutation as SURVIVED; this one is born with the override.
const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");

// THE REAL MODULES, not source text lifted out of the page.
const { distTo, fromEN, llEN, planeFrame } = require("../static/js/geodesy.js");
const { bbOf } = require("../static/js/geometry.js");
const { legClear } = require("../static/js/chart.js");
const G = require("../static/js/guard.js");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!(typeof cond === "function" ? cond() : cond);
        note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}
function grab(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function grabDecl(name) {
  const m = H.match(new RegExp("^(?:const|let|var)\\s+" + name + "\\s*=[^;]*;", "m"));
  if (!m) throw new Error("test setup: declaration " + name + " not found (renamed?)");
  return m[0];
}

// ---- the page's world, as the guard and the resume read it -------------------------- //
// MUTABLE STATE AT MODULE SCOPE, deliberately: the eval'd page functions resolve these up
// the scope chain and write to the same bindings the checks read. Anything declared INSIDE
// the eval is invisible out here, which is how a check ends up reading a variable the
// subject never touched.
const V = { SPEED_KN: { low: 4.0, survey: 7.0, high: 14.0 },
            VESSEL: { hull: { loa_m: 7.71 } },
            MAX_TURN_RATE_DEG_S: 20 };
var mission = { lines: [], waypoints: [], speeds: { transit: "high", turn: "low", survey: "survey" },
                approach_radius_m: 2 };
var runLineIdx = -1, curTurn = -1, turnSeg = [], lastRunLine = -1, turnSlowAt = [];
// ⚠⚠ `avoiding` IS DECLARED HERE WITH `var`, AND NOT LIFTED. A `let` inside a direct eval is scoped TO
// THE EVAL, so lifting the page's declaration gives the lifted avoidingRaise/avoidingNow their own binding and
// every reset from out here is invisible to them - checks 4b-4f then read null with nothing wrong in the page.
// Same trap, same answer, as governor_says.js's adoptedSeq. Check 4g pins the page's own declaration so a
// rename cannot leave the lifted functions quietly reading fresh globals.
var avoiding = null;
var lineSwing = -1;   // the line she is swinging onto (2026-09-25) - read by currentActivity every frame
// speedGovernor also reads the JUNCTION corner set since 2026-09-19 - see speed_modes.js.
var cornerSlow = new Set();
var cornerSlowFor = -1;
// ⚠ ALL FOUR, because the edge rung drops the set when it deviates and dropCornerSlow
// reads every one of them. With two missing the call threw, and the throw took the rest of
// the rung's statement list with it - the splice landed, the budget never moved, and check 22
// read `edgeSpentM 0 over 0 deviation(s)`. A missing global in a world is a missing
// dependency, and the page declares these beside the other two.
var cornerUnanswered = [];
var cornerPlanKey = "survey";
var S = null, asv = null, runRoute = null, runUnsafe = [], pauseMark = null;
var resumeSlow = false, commandedSpeed = null, guardOverride = null, guardHeld = null, lockTransit = null;   // (releaseLow reads lockTransit, 2026-10-18)
// ⚠ MODULE SCOPE, NOT THE EVAL BUNDLE. A `let` inside the bundle makes a SECOND
// global that the fixtures below write and the subject never reads - which is how 12g once
// passed while reporting on a set nothing referred to. resumeHeldSurvey owns this record
// across its own pause/upload/speed/start, because a paused boat matches neither arm of
// guardHeldOffer and the record would otherwise be spent halfway through the resume.
var heldResuming = false;
// ... and when it began, for the window the rungs below helm stand by in (heldResumeOwns), and the guard's own moves,
// counted, which the resume asks about before its upload, before its Start and after it (2026-09-28, FRIGGA).
var heldResumingAt = 0, guardMoved = 0, guardMovedHow = null;
// ... and when the hold rung last put a boat PAUSED on its own hold back on station (2026-09-29), paced by it
var holdBackAt = 0;
// Whether the modelled guard ticks between the resume's commands. Off by default so the
// non-resume fixtures are unchanged; resumeFrom turns it on.
var tickGuard = false;
// The helm rung's claim on the throttle. speedGovernor stands down on it exactly as it does
// on `resumeSlow`, so the symbol has to exist here or the governor is a bare ReferenceError -
// which the crash guard reports as ONE failed check rather than as a crash. False in this
// world: no escape is commanded in it, so these checks are the evidence that an ordinary run
// still governs its own speed exactly as it always did.
var escapeThrottle = false;
var clearance = { m: null, kind: null, closing: false, slowed: false, prev: null, info: null };
var guardLevel = "clear", clearAlarmAt = 0, guardActedAt = 0, guardEscapeAt = 0;
// ⚠ OUT HERE, NOT IN THE BUNDLE, AND THAT IS THE WHOLE POINT. The bundle's `let`s live in
// the eval's own scope and nothing outside can touch them - a `holdWant = null` in a fixture
// would have created a SECOND, unread global and the reset would have been a silent no-op.
// Declared beside guardActedAt, the guard's reference resolves here and the fixtures can
// actually clear it between episodes.
var holdWant = null;
var guardEdgeAt = 0, edgeSpentM = 999, edgeCount = 0;   // 999: the deviation budget is spent
var edgeSearchAt = 0;                                   // when the deviation SEARCH last ran (2026-09-26)
var searchCount = 0;                                    // how many times the ladder asked for the search (check 23)
// THE AIS KEEP-OUTS (2026-09-25). clearanceGuard builds the contacts' model every frame and asks the
// return tick above every branch, so the names must exist or the guard is a bare ReferenceError. No
// contacts live in this world - the model is empty and every check here is the charted world it always
// was. `aisPolledAt` is a poll that is always fresh: an EMPTY model, never a STALE one, so the blind
// banner cannot land in a check that counts banners (tests/ais_avoid.js owns the stale case).
var aisVessels = [], aisPolledAt = 0, aisShow = false, aisAvoid = null;
var aisKoDrawn = [], aisKoNote = null, aisKoStale = false, aisKoBlindSaid = false, aisKoWantedAt = 0;
// ⚠ DECLARED HERE, like the rest of them, and NOT lifted. aisKeepoutsNow assigns `aisKoBlind` every frame, so
// without this it was an implicit global and the suites still ran green - the same shape as the `avoiding` trap.
// `aisKoBlind` is the narrower fact than `aisKoStale`: the console WANTED the contacts and the feed has had its
// grace period. 8e guards the name.
var aisKoBlind = false;
const { aisKeepouts: AK_aisKeepouts, aisAvoidKeepouts, aisAvoidKeepout, aisRoundKeepout, convexHull, AIS_KO_STALE_S,
        AIS_LOOKAHEAD_M, aisInReach, aisReachM, AIS_MARGIN_FRAC } = require("../static/js/ais_keepout.js");   // the ladder's reach (2026-09-29)
// ⚠ THE LADDER'S SCENARIOS ARE THE BARE HULL'S (2026-10-17). Since then a contact's keep-out carries her clear water -
// half her length round her hull (ais_keepout.js AIS_MARGIN_FRAC, his "Half her length") - and every scenario below 27
// places its contacts at distances tuned to the hull alone: what they hold is the ladder (its reach, the override, the
// return, the way round, the slow-instead-of-hold), not the margin. So this world's model is built at marginFrac 0 -
// one wrapper, the page's aisKeepoutsNow calls it as it calls the module - and 27-27d set `aisMarginHere` to null to
// drive the page with the module's own margin, which is what the page runs.
let aisMarginHere = 0;
// ... and without the navigational-status rules (2026-11-01: moored and still 20 m, at anchor her watch circle), which are
// clear water of their own - this world's model is the bare hull; 27-28 drive the page as it runs
const aisKeepouts = (v, f, o = {}) => AK_aisKeepouts(v, f, aisMarginHere == null ? o : { ...o, marginFrac: aisMarginHere, navRules: false });
// the guard's model of slowing down (2026-10-03): the in-gear profile, and the console's command delay
const { slowLaw, slowProfile } = require("../static/js/coast.js"), { SPEED_CMD_LATENCY_S } = require("../static/js/turns.js");
const { clearanceM, blocked } = require("../static/js/keepouts.js");
// The hold rung snapshots its own latches before writing them (2026-09-22), so a refusal
// can put them back. `slowLieu` is one of them and is READ before anything writes it.
var slowLieu = null;
var planIntent = { why: [] }, notes = [], banners = [], logged = [], violations = null;
var nogo = { ready: true, frame: null, ko: null, buffer: 5 };
var confirmAnswer = true, confirmAsked = 0, lastResume = null, lastContinue = null;

// The guard's own imports, REAL - the rungs are only worth driving against the real assess.
// The real assess, counting the frames that asked it to SEARCH for a deviation (check 23 reads the count).
const guardAssess = (p, v, d, ko, buf, o) => { if (o && o.edge) searchCount++; return G.assess(p, v, d, ko, buf, o); },
      groundVel = G.groundVel, restoreVel = G.restoreVel,
      edgeText = G.edgeText, edgeCapM = G.edgeCapM, GUARD_HORIZON_S = G.HORIZON_S, GUARD_HOLD_S = G.HOLD_S;
// THE ESCAPE, STUBBED AND STEERABLE: it records the MODEL it was handed (the check that the contacts
// reach the helm rung) and answers whatever `escFake` says, so the rung can be driven past its search.
let escKo = null, escFake = null;
function escapeCourse(p, drift, ko) { escKo = ko; return escFake; }

function fmtDist(m) { return Math.round(m) + " m"; }
function flashNote(m) { notes.push(m); }
function showBanner(t) { banners.push(t); }
function setViolations(v) { violations = v; }
// ⚠⚠ NOT A NO-OP ANY MORE (2026-11-03, review). The card's DOM belongs to another suite, but the card is where
// the page ASKS avoidingNow() - the Doing row - and that ask is what lowers the badge. The edge rung calls
// updateMissionCard() seven lines after its own raise, so with a no-op stub every badge check in this file was a
// statement about a variable nothing else had touched, and a record erased inside the raise's own statement list
// was invisible to ten of them. The one behavior that matters here is the ASK, on the frame it really happens.
function updateMissionCard() { avoidingNow(); }
function render() {}
function holdClearAt() { return 12.3; }
// RESUME FROM HERE AND THE WAY ROUND (2026-09-27): the chart's scale for the snap (IDENTIFY_PX at zoom 16
// and this latitude is ~24 m), the menu row and its key as stub elements a check can read back, and the
// helpers the held path calls on its way in. The router stub below records what it was ASKED (from, to,
// opts): the way round a contact is a statement about the MODEL the router was handed, and the router's
// own geometry with an explicit model is planner_guard_seam.js 7d's subject.
var center = { lat: 43.07, lon: -70.76 }, zoom = 16;
function ensureNogoCovers() { return Promise.resolve(); }
function heldOffWhy(h) { return "the point sits inside " + ((h && h.kind) || "a keep-out"); }
function takeDownBanner() {}
const CM = {};
function cmEl(kid) { const set = new Set();
  return { textContent: "", style: { display: "none" },
           classList: { toggle(c, on) { on ? set.add(c) : set.delete(c); return !!on; }, contains(c) { return set.has(c); },
                        add(c) { set.add(c); }, remove(c) { set.delete(c); } },
           querySelector() { return kid ? CM[kid] : null; } }; }
CM["#cmResumeK"] = cmEl(null); CM["#cmResume"] = cmEl("#cmResumeK");   // both up front: the row's key is its child
// ROUTE ROUND HER (2026-09-27): the row over a contact, its label and its key
CM["#cmAvoidK"] = cmEl(null); CM["#cmAvoidLbl"] = cmEl(null); CM["#cmAvoid"] = cmEl("#cmAvoidK");
// THE MENU'S OWN HANDLER (2026-09-30): cmRow reads the point the menu was opened at, then closes the menu - which drops
// it, as the page's does - so a row that reads the point after closing would read null here too.
var menuLL = null;
function closeChartMenu() { menuLL = null; }

// ⚠⚠ THE ROUTER, STUBBED AND STEERABLE. resumeHeldSurvey certifies the run-in with the same
// planner Go-To flies (2026-09-23): after an ESCAPE she is not beside her line any more, and
// the first leg of the remainder runs from wherever the escape left her back toward a waypoint
// chosen before any of it happened. Without this symbol the resume threw inside the handler -
// which 12a caught, because 12a exists for the identical fault one layer down (legClear
// dereferencing a frame that was not there).
//
// ⚠ THE DEFAULT MIRRORS THE REAL CONTRACT and the branches are driven by name, so a check
// that wants a refusal asks for one rather than building a geometry that happens to produce
// it. The real planNogoRoute returns `kr.route.slice(1)` - the start point EXCLUDED, the
// target LAST - and answers {degraded:true} with no model. Get that wrong here and the checks
// below would agree with a resume that prepends the wrong waypoints.
let pinNext = null, pinCalls = [];
function holdOpts() { return {}; }
function planNogoRoute(from, to, opts) {
  pinCalls.push({ from, to, opts });
  if (pinNext) return pinNext;
  if (!nogo.ready || !nogo.ko || !nogo.frame)
    return { route: [{ lat: to.lat, lon: to.lon }], direct: true, degraded: true };
  return { route: [{ lat: to.lat, lon: to.lon }], direct: true, routed: false };
}
function guiConfirm() { confirmAsked++; return Promise.resolve(confirmAnswer); }
globalThis.window = globalThis;
globalThis.fetch = (p, o) => {
  try { logged.push(JSON.parse(o.body)); } catch (e) { /* not a logevent */ }
  return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true }) });
};
// Commands are RECORDED, not stubbed to nothing, so a check can say WHAT was sent and in
// what order rather than only that something was. `refuse` drives the refusal branch.
var sent = [], refuse = null, lost = null;
// THE GUARD BETWEEN THE RESUME'S COMMANDS (2026-09-28, FRIGGA): `onReply(path)` runs after a command's reply has
// landed and before the page's await resumes - the moment the 4 Hz ladder ran at 21:19:45.801, 51 ms after the way
// round's upload. `replyState[path]` is the state a success answers with (the console's own reply carries it): the
// Start's `behavior` is what the vessel says it started.
var onReply = null, replyState = {};
// ⚠ THE VESSEL'S SIDE OF A COMMAND LANDS AFTER THE REPLY, which is what makes the
// one-at-a-time gate measurable. The page awaits each command; the run state it then reads
// comes from a LATER telemetry frame. Applying it synchronously inside cmd() meant a second
// press could never see the live offer the first press had not yet spent - the harness was
// preventing the very race the gate exists for, and the mutation that removes the gate
// survived because of it. One guard tick per reply models the 4 Hz loop underneath.
function applyReply(p, pr) {
  return pr.then((r) => {
    if (p === "/api/cmd/pause") S.run = "paused";
    if (p === "/api/cmd/start") S.run = "running";
    // THE VESSEL STAGES an upload to a paused or station-keeping boat until Start, and any other motion replaces it
    // (2026-09-29: the hold rung reads it - a Start with a plan staged APPLIES that plan, it does not resume the hold)
    if (r && r.ok && p === "/api/cmd/upload") S.plan_staged = S.run === "paused" || S.behavior === "hold";
    if (r && r.ok && ["/api/cmd/start", "/api/cmd/hold", "/api/cmd/escape", "/api/cmd/stop"].includes(p)) S.plan_staged = false;
    // A LEG'S OWN COMMAND loads and starts in one step on the vessel (_run_route), and she is flying it (2026-09-29)
    if (r && r.ok && ["/api/cmd/goto", "/api/cmd/rth", "/api/cmd/transit"].includes(p)) {
      S.behavior = p.slice(9); S.run = "running"; S.plan_staged = false; }
    if (tickGuard) guardHeldOffer();
    if (onReply) onReply(p);
    return r;
  });
}
function cmd(p, b) {
  sent.push({ p, speed: b && b.speed, route: b && b.route, body: b });
  // ⚠ THE HOLD IS MODELLED, NOT JUST RECORDED, AND THAT IS WHAT MAKES CHECK 6 REAL. On the
  // vessel `hold` uploads a one-waypoint plan over the survey, so `wp_index` becomes 0 and
  // describes the hold. With a stub that only records, moving markGuardHeld to AFTER the
  // command changes nothing the suite can see - the mutation survives and the check is
  // decoration. Here the index really moves, so a late capture really reads the wrong one.
  // ⚠ AND SHE REPORTS THE HOLD'S PLAN LENGTH WITH IT: ONE (2026-11-03, review). `wp_index` alone is half a
  // frame - every indexed reader on the page pairs it with `wp_total` before trusting it against its own array -
  // so a world that moved the index and left the count describing the survey was publishing a frame the vessel
  // never sends. nowHolding() carries the arrived half of the same thing (wp 1/1).
  if (p === "/api/cmd/hold") { window._wpIndex = 0; if (S) S.wp_total = 1; }
  // ⚠ AN UPLOAD IS THE PLAN SHE WILL COUNT INTO (_run_route / amend): the length she reports back, from the
  // waypoint one her index restarts at. Without this the badge's rejoin index was driven against a `wp_total`
  // left over from the hold, which is exactly the mismatch avoidingNow now refuses to read.
  if (p === "/api/cmd/upload" && b && b.route) { if (S) S.wp_total = b.route.length; window._wpIndex = 0; }
  // ⚠⚠ AS Engine.amend SETS IT: `at + len(r)`, the WHOLE spliced plan (2026-11-03, review). Published as the
  // tail's length alone, every modelled amendment left `S.wp_total < runRoute.length` for the rest of the
  // scene, so guardTrack's own pairing gate fired and the STRAIGHT-LINE projection stood in where the route
  // projection was the thing being tested: 239 frames of check 22's own control arm, measured. The page exists
  // at `spliceAt` precisely because the vessel counts the whole plan, so a world that publishes the tail is a
  // world where spliceAt has nothing to do.
  if (p === "/api/cmd/amend" && b && b.route && S) S.wp_total = (window._wpIndex || 0) + b.route.length;
  // ⚠⚠ AND THE PAUSE IS MODELLED TOO, for exactly the reason the hold is - and its absence
  // made check 15b decoration. On the vessel `pause` sets run to "paused", and
  // resumeHeldSurvey pauses FIRST (review #6). guardHeldOffer matches neither "hold" nor
  // "escape" on a paused boat, so the 4 Hz guard underneath the resume's four round trips
  // spent the very record the resume was handing back - after which its abort banners promise
  // "the remainder is still held" about nothing at all. With a stub that only RECORDED the
  // pause, `run` stayed "running" for the whole sequence and no check could see it.
  // ⚠⚠ AND THE VESSEL REPORTS IT ON A LATER FRAME, NOT ON THE CALL - so these land in
  // the `.then` below rather than here. Written synchronously they closed a window that is
  // open in the real console: between `heldResuming = true` and the pause actually taking
  // effect, `run` still reads "running" and a second press still sees a live offer. With a
  // synchronous model the one-at-a-time gate was UNTESTABLE - its mutation survived because
  // the harness had already made the thing it prevents impossible.
  // ⚠ AND THE GUARD DOES NOT STOP WHILE THE CONSOLE AWAITS. One tick per round trip is the
  // cheapest faithful model of a 4 Hz loop running under four awaited commands: it is what
  // turns "the offer stays up" from a statement about an untouched variable into a statement
  // about a variable something else had a chance to spend.
  // ⚠ THE SUCCESS FIXTURE USED TO BE A BARE {} - the one answer that has neither
  // `ok` nor `error`, and therefore the one this suite could not tell from a failure.
  // That is not a detail: it is WHY the page carried two failure-shaped tests for so
  // long. The fixtures agreed with the bug, so every mutation of it survived here.
  // cmd() answers {ok:true, state:{...}} on success and {ok:false, error, sent, refused}
  // on every failure; a stub that answers anything else is testing a console that does
  // not exist.
  // ⚠⚠ TWO SHAPES OF FAILURE, NOT ONE. Until 2026-09-22 this stub could only answer
  // {refused:true}, so every check in the file reading "a REFUSED command keeps X" was really
  // testing "a FAILED command keeps X" - and the page's asymmetry, which is the whole point
  // (`refused` is the vessel's answer; silence is not an answer), had no case anywhere. The
  // mutation that deletes the lost-reply arm of the edge rung survived a sweep because of it.
  // `lost` names the path whose reply never comes back.
  return applyReply(p, Promise.resolve(lost && lost === p
    ? { ok: false, error: "no answer", sent: true, refused: false }
    : refuse && refuse === p
    ? { ok: false, error: "ARM before uploading a plan", sent: true, refused: true }
    : { ok: true, state: replyState[p] || {} }));
}

// A minimal DOM, only as wide as the guard bar. renderGuardBar writes text and display, and
// the checks read them back - which is the only way to tell "the offer is up" from "the code
// that would put it up exists".
const EL = {};
function $(sel) {
  if (CM[sel]) return CM[sel];
  if (sel === "#guardBar" || sel === "#r_avoid" || /^#(gb_|aisTip|aisBtn)/.test(sel))
    return EL[sel] || (EL[sel] = { textContent: "", className: "", style: { display: "" },
                                   classList: { toggle() {}, add() {}, remove() {} } });
  return null;
}

// eslint-disable-next-line no-eval
eval([
  // ⚠ THE STAND-DOWN RELEASE AND THE GOVERNOR'S OWN ANSWER (2026-11-02, HONOLULU). The operator's Start
  // carries SUP_RELEASE and the console's automatic one does not, which is what resumeHeldRun branches on;
  // the guard's release note asks govHeldBy whether the governor will really put the plan's speed back.
  // Both LIFTED, never stubbed: a copy of either is a copy no mutation has ever been run against.
  grabDecl("SUP_RELEASE"),
  grab("govHeldBy"),
  grab("chartedHerPoly"),
  // chartedHerPoly's ambiguity test (2026-11-03): the model minus the one feature, memoized on the pair. Its
  // declaration comes from the page too, so a rename cannot leave the lifted function writing its own global.
  grabDecl("_koLessKey"), grab("koWithoutFeature"),
  // where this frame's contacts are, as one string: the charted half of aisAroundTick's try signature (2026-11-03)
  grab("aisReportSig"),
  grab("aroundOthers"),
  // ⚠ THE SHARED ANSWERS THE WAY ROUND IS BUILT ON (2026-11-03, the third review). aroundLine is the walk's own
  // branch test AND the standoff key - one function now, because the commit message claimed they were already
  // one and they were not; aroundStd is the standoff; aroundTail is the tail a way round uploads, asked by the
  // no-op gate (aroundTailIsSame) and built by both resumes. LIFTED BESIDE THEIR CALLERS: the review's own
  // blast-radius lens reported that two suites lift a changed function without the new names it calls, and the
  // ReferenceError that follows is swallowed by tryIt. The first run of this very edit proved it - the crash
  // guard caught it, not a check.
  grab("aroundLine"), grab("aroundStd"), grab("aroundTail"), grab("aroundTailIsSame"),
  grab("aroundTrySig"), grab("aroundTriedSame"),
  // THE AVOIDING FLAG'S OWN RECORD AND READER (2026-11-02, "Create a flag that attaches to the ASV an
  // reads AVOIDING until it's back on line or natural transit"). LIFTED, not stubbed: this suite is where
  // the flag's behaviour is asserted, and a stubbed raiser would make its checks about the stub.
  grab("avoidingRaise"), grab("avoidingNow"),
  // ⚠ THE ONE READER BOTH SURFACES ASK, and the words and the duration it builds (2026-11-03, review): the
  // chart badge and the Mission card's Doing row disagreed because only one of them had been made
  // supervision-aware. Lifted together, or a scene that reaches one of them is a bare ReferenceError that
  // tryIt swallows - which is exactly what the first run of this edit produced.
  grab("avoidingShown"), grab("avoidingSay"), grab("avoidingForS"), grab("avoidingDur"),
  grabDecl("AVOID_TIP"),
  grab("renderAvoiding"),    // the badge on the chart, so its wording is asserted and not described      // everything except the one thing she is getting past (2026-11-02)   // HER when "she" is charted - the model's own poly (2026-11-02)
  grab("govRaiseHeld"),   // the governor's refusal-to-raise, which the speed-zone release banner asks too (2026-11-02)
  grabDecl("RESUME_BACK_LENGTHS"),
  grabDecl("OVERRIDE_GIVE_M"),
  grabDecl("EDGE_REASSESS_MS"),
  grabDecl("GUARD_REASSESS_MS"),
  // ⚠ updateClearance IS THE ONE STUB IN THE BUNDLE, and it is in the bundle rather than at
  // module scope so it assigns to the SAME `clearance` the guard reads. A stub outside would
  // have written a different binding and every rung would have run on a null clearance.
  // THE REAL updateClearance HERE, NOT guard_resume's STUB: this suite is about the model the readout
  // measures against, so the contact has to reach `clearance.kind` through the page's own code.
  grab("updateClearance"), grabDecl("CLEAR_CAP_M"), grabDecl("CLEAR_CLOSING_MS"),
  // review #14: the guard and the governor act only in the SUPERVISING tab. This world is that tab - a view-only
  // one is tests/supervisor_page.js's subject, and it holds that they assess and alarm without commanding.
  "const supervising = () => true;",
  grab("indexedRoute"), grab("lineMark"), grab("markGuardHeld"), grabDecl("HELD_GRACE_MS"), grab("guardHeldOffer"),
  grabDecl("HELD_RESUME_OWNS_MS"), grab("heldResumeOwns"), grab("guardMove"),   // a held resume in flight has her (2026-09-28)
  // the DRAWN-LINE numbering every "line N" now goes through (review #18) - the page's own, not a stub
  grab("lineSetKey"),
  grabDecl("LINE_PART_OFFSET_M"), grabDecl("_drawnLines"), grab("linePartContinues"), grab("drawnLines"),
  grab("lineNo"), grab("lineCount"), grab("linePartTxt"),
  grabDecl("RELEASE_HOLD_MS"),
  "let clearHoldAt = 0;",
  grab("releaseSettled"),
  // ⚠ THE IN-EXTREMIS DWELL (2026-09-19). clearanceGuard calls helmSettled on EVERY
  // frame, above every branch, so a bundle without it is a bare ReferenceError on the first
  // frame of every scenario - which is how this suite failed when the dwell landed.
  grabDecl("HELM_DWELL_MS"),
  "let helmHoldAt = 0;",
  grab("helmSettled"),
  // ⚠ THE HOLD'S OWN RECORD (2026-09-21), and BOTH lines are needed. `holdWant` is READ
  // (`!!holdWant`) before anything assigns it, so without it the hold rung is a bare
  // ReferenceError - the same failure HELM_DWELL_MS caused above. SLOW_ANSWER_MS is the
  // subtler one: `!!holdWant` short-circuits on the FIRST frame of every scenario, so
  // omitting it leaves checks 5-7 green and reddens only the later ones, for a reason that
  // has nothing to do with what they test. (`slowLieu` above it is still an implicit global
  // here: the rung only ever ASSIGNS it in this world, never reads it.)
  grabDecl("SLOW_ANSWER_MS"),
  // ⚠ THE LAUNCH GRANT (2026-09-19): clearanceGuard calls grantNow() every frame, above
  // every branch. No berth is latched in this world, so it returns null and every check here
  // exercises the OPEN regime - which is exactly what this suite should be testing.
  "let grant = null, grantMemo = null, grantEndSay = null;",
  "let grantStop = null, grantLast = null, grantTrueAt = 0, grantTrueLevel = null;",
  "const logGrantEvent = () => {};",
  "const { berthClearM, berthNeedM, grantFilter, grantProved, grantedFeatures, inCorridor,"
  + " recessionGiveM } = require('../static/js/berth.js');",
  "const GRANT_STANDDOWN_MS = 20000, GUARD_HELM_S = 20;",   // OVERRIDE_GIVE_M is already grabbed above
  "let grantProofAt = 0, grantStallAt = 0;",
  grab("berthAt"), grab("grantMembers"), grab("grantNow"),
  // grantTick is asked every frame, above every branch - the symbol must exist even where no
  // berth is ever latched and it returns at its first line. Both ENDS are needed and they
  // are different functions: stopAtBerth keeps the grant (stall/clock), standDownEnd drops
  // it and holds the helm, and helmStoodDown is what clearanceGuard asks before an escape.
  grab("grantTick"), grab("stopAtBerth"), grab("standDownEnd"),
  grab("helmStoodDown"), grab("endGrant"),
  grabDecl("SPEED_RESEND_MS"), grabDecl("speedWant"), grab("commandSpeed"),
  grab("slowestMakingWayKey"), grab("slowKeyFor"), grab("setMsNow"), grab("makesWayKey"),   // the slow-down that makes way (2026-09-26)
  // ... and "already slow" judged by what she is doing, and the slow-down flown as she flies it (2026-10-03)
  H.match(/const IN_CUT_MS = [^;]*;/)[0], grab("cutAge"), grab("cutUnderWay"), grab("slowingOpts"), grab("twNowMs"),
  "function __setSpeedWant(v){ speedWant = v; }",            // the world's own record of the last speed sent (24g-24i)
  "function __getSpeedWant(){ return speedWant; }",
  // the look-ahead's two facts beside the route, and the amend splice at the vessel's index (2026-10-06): guardTrack reads
  // the first two, the edge rung / the way round / resume-from-here splice with the real spliceAt and record the leg start
  "let routeCmdsInFlight = 0, legStart = null, lastWpIndex = null;", grab("spliceAt"), "function legStartsHere(){}",
  grab("guardOverrideOk"), grab("guardTrack"), grab("guardOnStation"), grab("onStationWhy"), grab("clearanceGuard"),   // on station: the drift (2026-09-30)
  // the AIS keep-outs and the return (2026-09-25) - asked every frame, above every branch
  grab("aisGuardWanted"), grab("aisKeepoutsNow"), grab("aisNearestKind"), grab("aisNearestPoly"), grab("aisAvoidOpen"),
  grabDecl("OVERRIDE_STALE_MS"), grab("guardHazardKey"), grab("releaseLow"), grabDecl("guardKeyLast"),   // the override's four endings and the latch's release (2026-09-28)
  "function __overrideStale(){ return OVERRIDE_STALE_MS; }",
  "function __keyLast(){ return guardKeyLast; }",
  grab("aisReturnTick"), grab("logClient"),
  // the way round a contact that stays, and the operator's point beyond her (2026-09-27)
  grabDecl("AIS_AROUND_STEP_M"), grabDecl("AIS_AROUND_NOOP_M"),   // the walk's step, and what "the same place" means (2026-11-03)
  grab("koWithAis"), grab("aisAroundPlan"), grab("aisAroundTick"),
  grab("sameContact"), grab("aisHerPoly"), grab("koRoundHer"), grab("tautRoundHer"),   // the tighter way round (2026-09-28)
  // ... which judges every route it returns against the box the chart was read over (2026-10-03) - the real one; this
  // world's model has no box, so nothing is judged past it (tests/chart_box.js 9 is that rule's own check)
  "const { beyondChart } = require('../static/js/passage.js');",
  // the way round ON DEMAND (2026-09-27): the held path split out of the tick, the bar's button, the row over a
  // contact, and the running plan amended round her - aisAroundTick calls aisAroundGo every minute, so the
  // bundle needs it or the automatic way round (14-14d) is a swallowed ReferenceError inside frame()
  grab("aisAroundGo"), grab("aisAroundNow"), grabDecl("aisAroundBusy"), grab("contactAt"), grab("avoidWhy"),
  grab("gateAvoidRow"), grab("avoidContactAt"), grab("aisAroundRunning"),
  grab("cmRow"), grab("cmRowFailed"),   // every chart-menu row's handler, and what it says when a row fails (2026-09-30)
  // THE HELD LEG (2026-09-29): a Go-To, a Return-to-Home or a transit held for a contact is banked, returned and routed
  // round by these - reached only once a leg is banked, so a bundle without them fails exactly there (check 10 did).
  grab("legName"), grab("legTitle"), grab("heldLegWay"), grab("legWayClear"), grab("aisReturnLegTick"),
  grab("aisAroundLegPlan"), grab("aisWalkPast"), grab("renderHeldLegBar"), grab("resumeHeldLeg"),
  "function solveCoastFor(){ return null; }",   // the coast is tests/coast.js's; a leg here powers in
  grabDecl("IDENTIFY_PX"), grabDecl("LINE_MATCH_M"), grab("onLineM"), grab("cmGate"), grab("linkConnected"), grab("canCommand"),
  grab("resumeHereAt"), grab("legOfLine"), grab("lineOfLeg"), grab("alongAsRun"), grab("gateResumeHere"), grab("resumeFromHere"),
  grab("patClipBufM"), "const guardStandoffM = G.guardStandoffM;",
  // THE STANDOFF A LEG IS PLANNED AT (2026-11-02): aisAroundGo hands a CHARTED episode on a leg this instead of
  // patClipBufM, so the way round keeps the clearance the plan it is resuming was laid at. V.MAX_TURN_RATE_DEG_S
  // and V.SPEED_KN.high are this suite's own, so the 20.6 m is derived here exactly as the page derives it.
  grab("transitStandoffM"), "const guardTransitStandoffM = G.transitStandoffM;",
  grab("aroundMarginSay"),
  // the one-feature model the walk gets as `herOnly`, in the bucket the feature's type belongs to: a charted
  // hazard can be a polygon, a LINE or a POINT since 2026-11-02 (review), and only polys were handled
  grab("herOnlyModel"),
  grab("aisWanted"), grab("pollAIS"), grab("setAIS"),
  // the poll writes the charted depth under each vessel at anchor (2026-11-01: her watch circle's cable) - no features
  // here, so the records come back as they went
  "const { aisWithChart } = require('../static/js/ais_keepout.js'); const sea = { waterOffset: 0 };",
  // a feed connected but not populating (2026-10-20): the poll says it, once (tests/ais_stall.js is its subject)
  grabDecl("AIS_STALL_BANNER"), grab("aisStallSay"), "const fmtDur = (s) => Math.round(s / 60) + 'm';",
  // the poll rides the stream (2026-10-13): the frame's tick, its period and the limit on one that never answers
  grabDecl("AIS_POLL_MS"), grabDecl("AIS_POLL_TIMEOUT_MS"), grab("aisPollTick"),
  "function __aisPollConsts(){ return { AIS_POLL_MS, AIS_POLL_TIMEOUT_MS }; }",
  // the escape rung runs to its POST here (guard_resume stops at the refused search), so its helper
  grab("notTookSay"),
  "function __clearCap(){ return CLEAR_CAP_M; }",
  grabDecl("AIS_RETURN_BACK_M"), grabDecl("AIS_RETURN_DWELL_MS"),
  grab("renderGuardBar"), grab("renderHeldBar"), grab("lowLatched"),
  // took() is the page's ONE test for "did the command land?", carried across verbatim.
  // sendSpeed is the one door a speed command reaches the wire by (2026-09-22).
  grab("took"), grab("sendSpeed"), grab("continueAtLow"), grab("resumeHeldSurvey"),
  grab("resumeHeldRun"),
  // a refusal the planner made is said in the operator's units (planWhy, 2026-10-03) - the page's own
  "const { beyondChartSay } = require('../static/js/passage.js');",
  grab("planWhy"),
  // the hold before a survey (3b): no split is aboard in this world, so every remainder takes the plan's own end
  "let pendingHold = null; const surveyStartIdx = () => -1;", grab("tailEndsAtHold"),
  grab("dropHeldSurvey"),
  grab("logGuardLow"),
  grab("resumeBackM"), grab("resumePointOn"), grab("backtrackClear"), grab("alongLineM"),
  // the speed in words (2026-10-09, whole knots): dropCornerSlow and the release note say a key through these
  grab("isStepKey"), grab("spdTxt"), grab("slowestSelectableKey"),
  grab("roleSpeed"), grab("roleSpeedMS"), grab("linePhase"), grab("currentActivity"),
  grab("speedRole"), grab("speedGovernor"),
  // THE LEAD (2026-10-03): speedGovernor asks leadSpeedKey every frame; with no slowdown block on V.VESSEL it answers null at once
  "let govLead = null;", grab("leadSpeedKey"), grab("leadFor"),
  // The one door the escape gives its claim back through (2026-09-22), carried across
  // verbatim so a change to that rule is a change HERE and not in a copy that drifts.
  grab("releaseEscapeClaim"),
  // ⚠ AND THE ONE DOOR THE CORNER SET LEAVES BY (2026-09-22). The edge rung calls it on both
  // arms - a lost reply and an accepted deviation - so a bundle without it is a bare
  // ReferenceError INSIDE the rung's `.then`, where the rung's own
  // `.catch(() => { guardEdgeAt = 0; })` swallows it whole. That is what check 22 was
  // reading: the amend went out, the throw ate the rest of the statement list, and the
  // budget, the arming and the saying all silently did not happen. A swallowed
  // ReferenceError reports as a wrong ANSWER, never as a crash.
  grab("dropCornerSlow"),
  "function __backLengths(){ return RESUME_BACK_LENGTHS; }",
].join("\n"));
var __clr = {};

// EVERY CALL INTO THE SUBJECT IS WRAPPED. A mutation that removes a guard makes the real
// function THROW, and an unguarded call would kill the run before a single FAIL line printed
// - which the mutation runner scores as SURVIVED, strictly worse than the check not existing.
function tryIt(fn) { try { return { v: fn() }; } catch (e) { return { raised: e.message }; } }

// ---- the water: tests/in_extremis.js's pier, 30 m north of the boat ------------------ //
const ref = planeFrame({ lat: 43.07, lon: -70.76 });
const ll = (e, n) => fromEN(e, n, ref);
function wall(n0) {
  const r = [{ e: -400, n: n0 }, { e: 400, n: n0 },
             { e: 400, n: n0 + 300 }, { e: -400, n: n0 + 300 }];
  return { polys: [{ ring: r, bb: bbOf(r), kind: "a dock / pier" }],
           lines: [], points: [], marks: [], sys: [], chans: [] };
}
const PIER = wall(30);
// A 400 m survey line running due EAST, 0 m north - the boat runs along it at the pier's foot.
const LINE_E = { a: ll(-200, 0), b: ll(200, 0) };

// ================================================================================================
// THE AIS WORLD - this suite's own additions to the copied world above.
// ================================================================================================
const { blockedInfo } = require("../static/js/keepouts.js");
var AIS_KEY = "asv_ais_show_v1";
var aisArea = null, aisState = "idle", aisSrc = null, aisSrcName = null, aisNote = "", aisBusy = false;
var aisStall = null, aisStallSaid = false;
var aisPollBegun = 0, aisPollCtl = null;   // the poll's start and its abort (2026-10-13), here so 12d-12f can read them
var UIROLE = "main";                       // the chart window; 12f is the controls window
function aisCenter() { return asv ? { lat: asv.lat, lon: asv.lon } : { lat: 0, lon: 0 }; }
function renderAisTable() {}
function setAisTable() {}
// the card's own list (2026-10-10): the poll names the contacts it holds and keeps the server's `beyond` apart - the
// card's business alone, driven in tests/ais_table.js 6l-6m; this world's card holds nothing
var aisBeyondRpts = [];
function aisHeldQuery() { return ""; }
// the passage's 15 nm (2026-10-16): the poll asks for it while a passage is in hand - tests/ais_table.js 6n; none here
function aisFloorQuery() { return ""; }
function lsSet() {}
var planGen = 0;
function setPlanIntent(kind, _, route) { planIntent = { kind, why: [], route: route ? route.length : 0 }; }
// THE CLOCK IS OURS. Every dwell in the guard - the release, the helm, the AIS return - reads
// Date.now(), so a suite that slept through them would be a suite nobody runs.
const realNow = Date.now;
let clock = 1_700_000_000_000;
Date.now = () => clock;
// The open sea: no charted keep-out at all, so anything the ladder answers is a contact.
const OPEN = { polys: [], lines: [], points: [], marks: [], sys: [], chans: [] };
// A contact at frame (e, n): a 30 x 8 m workboat unless `o` says otherwise, reported this instant.
function contact(e, n, o = {}) {
  const p = ll(e, n);
  return { mmsi: 338111222, name: "WORKBOAT", lat: p.lat, lon: p.lon, sog: 0, cog: null, heading: null,
           age: 0, dim: { a: 15, b: 15, c: 4, d: 4 }, length: 30, beam: 8, ...o };
}
// Crossing the line northbound at 6 kn, ON it now 30 m ahead (her hull n = -20..+10 at e = 30..38, her sweep beyond):
// 7.5 s ahead of a boat doing 7 kn, 13 s at this world's 4 kn LOW - a hold on both counts - and clear of the line (her
// stern past the 3 m buffer) 7.4 s on. ⚠ WHAT THAT 7.4 s IS MEASURED AGAINST CHANGED ON 2026-11-01: it used to be
// "inside the operator's wait", and there is no wait now. A contact that clears the line while the boat still has
// WAY ON needs no answer at all - the guard's own clear branch releases her and the survey simply carries on
// (14e) - so the 100 m return is reached only while she is HOLDING and the way round cannot go (check 3).
const CROSSING = () => contact(34, -5, { sog: 6, cog: 0, heading: 0 });
// NO WAY ROUND HER: charted docks either side of a contact's ring, so the taut way round cannot be certified and
// the router's own search is the one asked - and the scenarios that want her to KEEP HOLDING make it refuse too.
// Shared, because three blocks need the same thing for the same reason since the operator's wait went (3, 6, 14h).
const W_NWR_N = [{ e: 5, n: 22 }, { e: 60, n: 22 }, { e: 60, n: 60 }, { e: 5, n: 60 }], W_NWR_S = W_NWR_N.map(p => ({ e: p.e, n: -p.n }));
const WALLS_NWR = () => ({ polys: [{ ring: W_NWR_N, bb: bbOf(W_NWR_N), kind: "a dock / pier" },
                                   { ring: W_NWR_S, bb: bbOf(W_NWR_S), kind: "a dock / pier" }],
                           lines: [], points: [], marks: [], sys: [], chans: [] });
const NO_ROUTE = { error: "no clear route to the target - every path crosses AIS: WORKBOAT", reason: {} };
// The boat at (0,0) on LINE_E, heading east at `sogKn`, open water, contacts as given.
function surveying(sogKn, vessels, o = {}) {
  mission = { lines: [LINE_E], waypoints: [LINE_E.a, LINE_E.b],
              speeds: { transit: "high", turn: "low", survey: "survey" }, approach_radius_m: 2 };
  // ⚠⚠ `wp_total` IS PART OF THE FRAME, AND LEAVING IT OUT MADE A WHOLE CLASS OF DEFECT INVISIBLE (2026-11-03,
  // review). The vessel reports how many waypoints the plan it is counting into holds, and every indexed reader
  // on the page pairs `wp_index` with its own array only when the two agree - guardTrack, cardRoute,
  // indexedRoute, and now avoidingNow. A world that never published the number could not tell a page reading
  // the right route from one reading another plan's index, which is precisely the fault review found in the
  // badge. Published here and kept in step with `runRoute` by every scene that replaces it.
  S = { armed: true, estop: false, run: "running", behavior: o.behavior || "survey",
        status: { cog_deg: 90, sog_kn: sogKn, heading_deg: 90,
                  env_set_deg: 0, env_set_kn: 0, holding: false, drifting: false, speed_key: "survey" } };
  asv = ll(0, 0);
  runLineIdx = 0;
  runRoute = [ll(-200, 0), LINE_E.b, ll(200, 60), ll(-200, 60)];
  window._wpIndex = 1;
  S.wp_total = runRoute.length;
  nogo = { ready: true, frame: ref, ko: o.ko || OPEN, buffer: 3 };
  clearance = { m: null, kind: null, closing: false, slowed: false, prev: null, info: null };
  guardLevel = "clear"; guardOverride = null; guardHeld = null; guardActedAt = 0; holdWant = null;
  resumeSlow = false; commandedSpeed = null; edgeSpentM = 999; guardEdgeAt = 0; edgeCount = 0;
  refuse = null; lost = null; slowLieu = null; heldResuming = false; escapeThrottle = false;
  guardEscapeAt = 0;
  aisAvoid = null; aisVessels = vessels || []; aisPolledAt = o.polledAt != null ? o.polledAt : clock;
  aisKoBlindSaid = false; aisKoWantedAt = 0; aisShow = false; escKo = null; escFake = null;
  sent = []; notes = []; banners = []; logged = []; planIntent = { why: [] };
  onReply = null; replyState = {};
}
// The boat has taken the hold: station-keeping where she is, no way on.
// ⚠⚠ AND SHE REPORTS THE HOLD'S OWN PLAN, WHICH IS ONE WAYPOINT - "wp 1/1" (2026-11-03, review). A hold uploads
// a one-waypoint plan OVER the plan she was flying (_run_route resets the index and the Engine publishes the new
// length), so a station-keeping vessel reports wp_total 1 and, having arrived at that point, wp_index 1 - while
// THIS PAGE still holds the 4-waypoint route the maneuver's rejoin index belongs to. The harness modelled it as
// index 0 of the survey route, which is a pairing the vessel never sends, and that is what hid the badge's
// lowering defect from ten green checks: `1 > 0` lowered a record whose index space the vessel had left.
function nowHolding() {
  S = { ...S, behavior: "hold", wp_total: 1,
        status: { ...S.status, sog_kn: 0, cog_deg: null, holding: true } };
  window._wpIndex = 1;
}
const frame = () => tryIt(() => clearanceGuard());
const paths = () => sent.map(x => x.p);
/**
 * The return is asynchronous (four awaited commands): let it run out, or give up.
 *
 * ⚠⚠ IT WAITED ON THE WRONG THING AND SILENTLY DROPPED CHECKS (2026-11-03, review: 199 checks instead of 200 on
 * 5 of 29 runs, one of them with 8f and 8g red). The old loop read
 *     `i < 40 && !paths().includes("/api/cmd/start") && heldResuming !== false || i < 3`
 * and `heldResuming` is FALSE before a resume starts, so the first clause was false on entry and the whole thing
 * collapsed to `i < 3`: thirteen ticks, fixed, whatever the page was doing. A resume whose chain ran longer than
 * that - and under Node's timer scheduling how long is not deterministic - was still in flight when the checks
 * read `sent`, so a check inside the resume's own branch never ran at all and the count came up short. A suite
 * that can report a different number of checks per run cannot be read as evidence of anything.
 *
 * What it waits on now is the page itself: `heldResuming` is true for the whole of resumeHeldSurvey (one
 * wrapper sets it and its `finally` clears it), and a resume posts commands as it goes, so "nothing in flight
 * and nothing newly sent for three consecutive turns" is the real condition - which also returns in four ticks
 * when nothing is happening, so a refusal scene costs no more than it did. The bound is the backstop, not the
 * mechanism: reaching it means the page is wedged, and the scene's own check says so.
 */
// ⚠⚠ QUIET, AND NEVER SHORTER THAN THE LOOP IT REPLACED (2026-11-03, the third review). The first rewrite
// started `n` at -1, so iteration 0 ALWAYS took the "something was sent" arm and reset `quiet` - and with every
// command in this world resolving through Promise.resolve, a whole resume chain drains in microtasks inside the
// first macrotask tick. Measured: 78 calls, 312 iterations, a maximum of 4 every time; `heldResuming === true`
// and a later change in `sent.length` were never once observed. So it waited THREE ticks where the loop it
// replaced waited thirteen, and the flakiness it was written to fix (199 of 200 checks on 5 of 29 runs) was
// explained by a diagnosis the measurement does not support. `n` starts at the real count and `quiet` is 12, so
// the wait is at least what it was before and ends early only on a world that is genuinely finished.
async function settle() {
  let quiet = 0, n = sent.length;
  for (let i = 0; i < 400 && quiet < 12; i++) {
    await new Promise(r => setTimeout(r, 0));
    if (heldResuming === true || sent.length !== n) { quiet = 0; n = sent.length; }
    else quiet++;
  }
}
const kindRe = /AIS: WORKBOAT \(30 x 8 m, 6\.0 kn\)/;

// THE SPACING BETWEEN TRIES, READ FROM THE PAGE - AND IT IS NOT A WAIT (2026-11-01). The operator's wait is gone
// ("remove the wait for operator rule for ais target avoiding. go to immediate maneuver to avoid"): the FIRST try
// goes on the first frame she is on station, so no scenario here counts down to it any more.
// ⚠⚠ AND THERE IS NO CONSTANT TO READ AT ALL SINCE 2026-11-02 (Andy: "this over rides previous directive to wait
// for a certain amount of time. Delete that"). AIS_AROUND_RETRY_MS is deleted, and a RE-try is gated on the MODEL
// instead: a refused try records {polled, ko, route, idx} and the next goes on the first frame any of them differs.
// So there is no number left for this suite to read, and nothing in it may advance a clock to earn a second try -
// it has to change the model (a fresh `aisPolledAt`, a new `nogo.ko`, a different route). See 14h, 20d and 25b.
// WHILE_MS / WHILE_S are NOT read from the page and name nothing in it: they are just "let a while pass"
// for scenes that need the clock to move. A try is earned by bumping `aisPolledAt`, never by the clock.
const WHILE_MS = 10000, WHILE_S = WHILE_MS / 1000;
// ⚠ THE WALK'S STEP AND THE NO-OP THRESHOLD, READ FROM THE PAGE'S OWN TEXT (2026-11-03). Both are grabDecl'd
// into the eval bundle, where the page's own functions see them - and a `const` declared in a direct eval is
// EVAL-SCOPED, so a check out here cannot read it however green the bundle is (this file has been bitten by
// that rule before). Read from `H` instead, so the numbers in the checks are still the page's and a change to
// either is a change here.
const STEP_M = Number((H.match(/^const AIS_AROUND_STEP_M = ([\d.]+);/m) || [0, NaN])[1]);
const NOOP_M = Number((H.match(/^const AIS_AROUND_NOOP_M = ([\d.]+);/m) || [0, NaN])[1]);
if (!(STEP_M > 0) || !(NOOP_M > 0) || !(NOOP_M < STEP_M))
  throw new Error("test setup: AIS_AROUND_STEP_M / AIS_AROUND_NOOP_M not readable from the page (" + STEP_M
                  + " / " + NOOP_M + ")");
console.log("AIS contacts as keep-outs, and the way back:");

(async () => {
// ── 1. A CROSSING CONTACT HOLDS HER, THROUGH THE ORDINARY LADDER ───────────────────────
{
  surveying(7, [CROSSING()]);
  const r = frame();
  check("1. a workboat crossing the line 30 m ahead HOLDS the survey through the ordinary ladder - a hold is sent, the survey is banked",
        () => !r.raised && paths().includes("/api/cmd/hold") && clearance.level === "hold"
              && !!guardHeld && guardHeld.route.length === 4 && guardHeld.idx === 1,
        () => (r.raised ? "RAISED " + r.raised + "; " : "") + "level " + clearance.level + ", sent "
            + JSON.stringify(paths()) + ", banked " + (guardHeld ? guardHeld.route.length + " wpts from " + guardHeld.idx : "nothing"));
  check("1b. ... the banked mark is where she left the line: line 1, 200 m along it, running forward",
        () => guardHeld && guardHeld.mark && guardHeld.mark.line === 0 && guardHeld.mark.fwd === 1
              && Math.abs(guardHeld.mark.along - 200) < 1,
        () => guardHeld && guardHeld.mark ? "line " + guardHeld.mark.line + " along " + guardHeld.mark.along.toFixed(1) + " fwd " + guardHeld.mark.fwd : "no mark");
  check("1c. ... an AIS episode is opened, naming the contact and the rung, and it is recorded",
        () => !!aisAvoid && kindRe.test(aisAvoid.kind) && aisAvoid.rung === "hold" && aisAvoid.line === 0
              && logged.some(e => e.kind === "ais_avoid" && kindRe.test(e.data.kind) && e.data.line === 1),
        () => "episode " + JSON.stringify(aisAvoid) + "; logged " + JSON.stringify(logged.map(e => e.kind)));
  check("1d. ... the banner names HER, not 'a keep-out', on the frame the readout has not yet named her (she is 30 m off, the buffer is 3)",
        () => banners.some(b => /HOLD/.test(b) && kindRe.test(b)) && clearance.m > 20,
        () => "clearance " + (clearance.m == null ? "null" : clearance.m.toFixed(1)) + " m; banners: " + JSON.stringify(banners));
  check("1e. NO PATTERN RECONFIGURATION: the charted model is untouched by the contact - nogo.ko has no polygon in it",
        () => nogo.ko.polys.length === 0 && nogo.ko === OPEN,
        () => nogo.ko.polys.length + " polys in nogo.ko");
  check("1f. ... and no deviation was tried against her (the edge rung stands down near a contact)",
        () => !paths().includes("/api/cmd/amend"), () => JSON.stringify(paths()));

  // ── 2. ON STATION WITH HER HULL STILL ACROSS THE LINE: THE WAY ROUND GOES AT ONCE ────
  // ⚠ THIS IS THE 2026-11-01 RULE AND THIS IS THE CHECK THAT STATES IT. The clock does not move between
  // nowHolding and the frame, so nothing can have elapsed: the first frame she is on station with a contact
  // still in the way is the frame the console maneuvers on. 2c reads the held seconds back out of the log
  // as the proof - a timer of any length at all would make that number non-zero.
  nowHolding(); sent = []; notes = []; banners = []; logged = [];
  const beforeStation = paths().slice();            // on station, no frame yet: nothing sent
  frame();
  const firstStation = paths().slice();             // the way round's pause, on that very frame
  check("2. on station with her hull still across the line, the console routes round her on the FIRST frame - no wait at all, and nothing before that frame",
        () => beforeStation.length === 0 && firstStation[0] === "/api/cmd/pause" && !!aisAvoid,
        () => "before the frame " + JSON.stringify(beforeStation) + ", on it " + JSON.stringify(firstStation)
            + ", episode " + (aisAvoid ? "open" : "closed"));
  check("2b. ... and the held bar on that frame still says what she is holding for and that the way back is the console's",
        () => { renderGuardBar({ level: "blind" }, clearance);
                return /SURVEY HELD/.test($("#gb_rung").textContent) && /holding for AIS: WORKBOAT/.test($("#gb_why").textContent)
                       && /resumes on its own/.test($("#gb_why").textContent) && /100 m back/.test($("#gb_why").textContent); },
        () => $("#gb_rung").textContent + " / " + $("#gb_why").textContent);
  await settle();
  check("2c. ... and it lands: pause, upload, LOW, Start in that order, the record spent, the episode closed - and held_s is ZERO in the log, which no wait could leave behind",
        () => paths().indexOf("/api/cmd/pause") === 0
              && paths().indexOf("/api/cmd/pause") < paths().indexOf("/api/cmd/upload")
              && paths().indexOf("/api/cmd/upload") < paths().indexOf("/api/cmd/speed")
              && paths().indexOf("/api/cmd/speed") < paths().indexOf("/api/cmd/start")
              && guardHeld === null && aisAvoid === null
              && logged.some(e => e.kind === "ais_around" && e.data.held_s === 0),
        () => "sent " + JSON.stringify(paths()) + ", record " + (guardHeld ? "kept" : "spent")
            + ", episode " + (aisAvoid ? "open" : "closed") + ", logged " + JSON.stringify(logged.filter(e => e.kind === "ais_around")));

  // ── 3. SHE CLEARS THE LINE WHILE THE BOAT IS HOLDING: THE DWELL, THEN THE RETURN ─────
  // ⚠ WHERE THE 100 m RETURN LIVES NOW (2026-11-01). With the operator's wait gone the way round goes on
  // the first frame she is on station, so the return is the answer only where the way round CANNOT go -
  // no way round her, and the contact then moves off the line herself. That is not a contrivance: it is
  // the narrow sea the return was always for, and the two cases either side of it are checked too (2c,
  // the way round taking a contact that stays; 14e, the guard releasing her when one clears with way on).
  // She sits ACROSS the line to begin with - a contact boxed by the docks, which is what leaves no way
  // round her (14h's geometry) - and gets under way northward once she is holding.
  surveying(7, [contact(30, 0, { sog: 0, cog: null, heading: 90 })], { ko: WALLS_NWR() }); frame();
  nowHolding(); sent = []; notes = []; banners = []; logged = []; pinCalls = [];
  pinNext = NO_ROUTE;
  frame(); await settle();                          // the first station frame: the try, and it finds nothing
  const noRound = paths().slice();
  pinNext = null;
  // THE FEED KEEPS ANSWERING and she gets going: a fresh report each frame, further north each time - the way a
  // live feed reads, poll after poll. 6 kn from the line, so her stern is past the 3 m buffer by 8 s.
  const her = (t) => { aisVessels = [contact(30, -4 + 3.087 * t, { sog: 6, cog: 0, heading: 0 })]; aisPolledAt = clock; };
  clock += 8000; her(8); frame();                   // 8 s on, holding: her stern is past the line's buffer
  const t30 = paths().slice();
  check("3. she holds for a contact there is no way round, and the contact then clears the line: the return's dwell starts and nothing is sent yet",
        () => noRound.length === 0 && !!aisAvoid && aisAvoid.clearSince === clock && t30.length === 0,
        () => "the try sent " + JSON.stringify(noRound) + ", clearSince " + (aisAvoid && aisAvoid.clearSince)
            + " (now " + clock + "), sent " + JSON.stringify(t30));
  clock += 2000; her(10); frame();                  // she still reads clear: the return's dwell runs on
  const t32 = paths().slice();
  clock += 2100; her(12.1); frame();
  await settle();
  check("3b. clear for under AIS_RETURN_DWELL_MS: still nothing - she reads clear, so it is the return and not the way round; clear for 4.1 s: the return goes - pause, upload, LOW, Start, in that order",
        () => t32.length === 0 && paths().indexOf("/api/cmd/pause") === 0
              && paths().indexOf("/api/cmd/pause") < paths().indexOf("/api/cmd/upload")
              && paths().indexOf("/api/cmd/upload") < paths().indexOf("/api/cmd/speed")
              && paths().indexOf("/api/cmd/speed") < paths().indexOf("/api/cmd/start")
              && sent.find(x => x.p === "/api/cmd/speed").speed === "low",
        () => "at 2 s: " + JSON.stringify(t32) + "; at 4.1 s: " + JSON.stringify(paths()));
  const up = sent.find(x => x.p === "/api/cmd/upload");
  const rte = (up && up.route) || [];
  check("3c. the upload rejoins the line AIS_RETURN_BACK_M (100 m) back down it from where she left - over water already run - then flies the remainder",
        () => rte.length === 4 && distTo(rte[0], ll(-100, 0)) < 1 && distTo(rte[0], guardHeld_at_mark()) > 99
              && distTo(rte[1], LINE_E.b) < 0.5 && distTo(rte[3], ll(-200, 60)) < 0.5,
        () => rte.length + " wpts; first " + (rte[0] ? distTo(rte[0], ll(-100, 0)).toFixed(1) + " m from the 100 m point, "
            + distTo(rte[0], ll(0, 0)).toFixed(1) + " m from where she left" : "none"));
  check("3d. ... with NONE of the operator's latches: no override, no LOW hold, the record spent, the episode closed",
        () => guardOverride === null && resumeSlow === false && guardHeld === null && aisAvoid === null && S.run === "running",
        () => "override " + JSON.stringify(guardOverride) + ", resumeSlow " + resumeSlow + ", guardHeld " + (guardHeld ? "kept" : "spent")
            + ", episode " + JSON.stringify(aisAvoid) + ", run " + S.run);
  check("3e. ... and it says so, and records it: the banner names the contact clear of the line, the log carries ais_return with the backtrack",
        // she was STOPPED across the line when the hold named her, so the episode's words carry no speed
        () => banners.some(b => /SURVEY RESUMED/.test(b) && /WORKBOAT/.test(b) && /over water already run/.test(b))
              && logged.some(e => e.kind === "ais_return" && e.data.back_m === 100 && e.data.line === 1 && e.data.held_s >= 12),
        () => "banners " + JSON.stringify(banners) + "; logged " + JSON.stringify(logged.filter(e => e.kind === "ais_return")));
  check("3f. ... and NOT at LOW for the rest of the run: the note says nothing about staying slow",
        () => !notes.some(n => /Speed stays low/.test(n)) && notes.some(n => /Survey resumed/.test(n) && /WORKBOAT/.test(n)),
        () => JSON.stringify(notes));
}
function guardHeld_at_mark() { return ll(0, 0); }

// ── 4. THE OPERATOR'S OWN RESUME IS STILL THE OPERATOR'S (the CONTROL for 3c/3d) ─────────
{
  surveying(7, [CROSSING()]); frame(); nowHolding(); sent = [];
  clock += 60000; aisVessels = [];                  // she is long gone; the operator presses RESUME
  aisAvoid = null;                                  // ... before the console's own return fires
  // ⚠⚠ AND A RECORD FROM AN EARLIER MANEUVER DIES WITH THE HOLD IT BELONGED TO (2026-11-03, review). An IN
  // EXTREMIS escape raises `rejoin: null` deliberately - it uploads ONE waypoint and chains nothing - so the
  // ONLY thing that can lower it is the next commanded motion, which every other command does through
  // setPlanIntent ("a new commanded motion is a new decision"). resumeHeldRun does not call setPlanIntent: it
  // keeps the run's own Intent card and appends to it, which is deliberate and is exactly why the clearing has
  // to be written into it. Without that, this resume - and the console's own 100 m return, which comes through
  // the same function - carried "AVOIDING - STEERED CLEAR OF a dock / pier" into a brand-new plan and left it
  // on the chart for the rest of the run, over a boat back on her line.
  avoidingRaise("steered clear", "a dock / pier", null);
  await resumeHeldSurvey();
  const avoidAfter = avoidingNow();
  renderAvoiding();
  check("4j. the operator's RESUME of a held survey carries no earlier maneuver's badge into the new plan - the "
        + "escape's record has no index that can ever lower it, so the command that replaces the plan is what "
        + "ends it, here as everywhere else",
        () => avoidAfter === null && avoiding === null && EL["#r_avoid"].style.display === "none",
        () => "record " + JSON.stringify(avoidAfter) + ", badge " + EL["#r_avoid"].style.display);
  // ⚠⚠ 4j2-4j4. THE REJOIN IS A WAYPOINT, BECAUSE AN INDEX IS ONLY AS GOOD AS THE ARRAY STANDING STILL
  // (2026-11-03, the third review, measured on the page's own resumeRun and resumeFromHere). Three scenes, one
  // reader: an INSERT in front of the rejoin, a REPLACEMENT of the remainder, and a route that has stopped
  // holding the pick-up at all.
  {
    const route0 = [ll(-200, 0), ll(0, 0), ll(50, 0), ll(100, 0), ll(200, 0)];
    const setRoute = (r) => { runRoute = r; S.wp_total = r.length; };
    S = { armed: true, estop: false, run: "running", behavior: "survey",
          status: { cog_deg: 90, sog_kn: 6, heading_deg: 90, holding: false, speed_key: "survey" } };
    asv = ll(-100, 0);
    setRoute(route0.slice());
    const via = runRoute[3];                                  // the dog-leg she is being taken round
    avoiding = null; avoidingRaise("deviated", "a dock / pier", 3, via);
    window._wpIndex = 2;        const upBefore = avoidingNow();
    // resumeRun's BACKTRACK: one waypoint inserted in front of everything ahead of her. Engine.amend reports
    // the whole spliced plan, so wp_total and runRoute still agree and the pairing gate cannot catch this.
    setRoute([runRoute[0], runRoute[1], ll(-10, 0), ...runRoute.slice(2)]);
    window._wpIndex = 3;        const atVia = avoidingNow();   // the frame she starts steering for the dog-leg
    window._wpIndex = 4;        const onVia = avoidingNow();   // and the frame she is AT it
    window._wpIndex = 5;        const past = avoidingNow();    // past it: back on her plan
    check("4j2. an operator PAUSE and RESUME while a deviation stands inserts a backtrack waypoint in front of "
          + "the rejoin - so the index moves and the waypoint does not. The badge used to go dark on the frame "
          + "she turned off her track, and the record was DESTROYED, so nothing could put it back; the record "
          + "carries the waypoint, the reader finds it again, and the flag stands until she is past it",
          () => !!upBefore && !!atVia && !!onVia && past === null && avoiding === null,
          () => "before the resume " + !!upBefore + "; at the via's new index " + !!atVia
              + " (was the frame it went dark); on it " + !!onVia + "; past it " + (past === null ? "down" : "UP"));
    // and a route that no longer holds the pick-up at all cannot be judged: the record STANDS, because lowering
    // is the destructive direction - and the commands that replace or give up the route clear it themselves.
    avoiding = null; setRoute(route0.slice());
    const via2 = runRoute[3];
    avoidingRaise("routed round", "a shoal", 3, via2);
    setRoute([ll(-200, 0), ll(0, 0), ll(500, 500)]);          // resumeFromHere: the remainder replaced
    window._wpIndex = 2;        const gone = avoidingNow();
    check("4j3. ... and a route that has stopped holding the pick-up at all cannot answer the question, so the "
          + "record STANDS rather than being spent on a guess - lowering is the destructive direction, and the "
          + "two commands that can leave the route this way (resumeFromHere, giveUpRoute) clear it themselves",
          () => !!gone && gone.why === "routed round",
          () => "record " + JSON.stringify(gone && gone.why));
    // the page's own clears, read off its text: the three commanded motions that bypass setPlanIntent
    const fromHere = (H.match(/async function resumeFromHere\([\s\S]*?\n\}/) || [""])[0];
    const giveUp = (H.match(/function giveUpRoute\(why\)\{[\s\S]*?\n\}/) || [""])[0];
    const resumeRunBody = (H.match(/async function resumeRun\([\s\S]*?\n\}/) || [""])[0];
    check("4j4. ... and those clears are in the page: resumeFromHere REPLACES the remainder so it spends the "
          + "record, giveUpRoute (the Hold, the Stop, the E-STOP, a respawn, a cleared plan) spends it because "
          + "nothing is going to put her back after any of them - and resumeRun does NOT, because it only "
          + "inserts, and the waypoint survives an insert",
          () => /\n  avoiding = null;/.test(fromHere) && /\n  avoiding = null;/.test(giveUp)
                && !/avoiding = null/.test(resumeRunBody),
          () => "resumeFromHere clears " + /\n  avoiding = null;/.test(fromHere)
              + ", giveUpRoute clears " + /\n  avoiding = null;/.test(giveUp)
              + ", resumeRun clears (it must not) " + /avoiding = null/.test(resumeRunBody));
    avoiding = null; runLineIdx = -1; lineSwing = -1;
  }
  const up = sent.find(x => x.p === "/api/cmd/upload");
  const rte = (up && up.route) || [];
  check("4. CONTROL: the operator's RESUME on the same hold backs 12 boat lengths (92.5 m here), latches LOW and records the override - the console's return is the different one",
        () => rte.length === 4 && Math.abs(distTo(rte[0], ll(0, 0)) - 12 * 7.71) < 1 && resumeSlow === true
              && !!guardOverride && guardOverride.slow === true,
        () => (rte[0] ? distTo(rte[0], ll(0, 0)).toFixed(1) + " m back" : "no upload") + ", resumeSlow " + resumeSlow
            + ", override " + JSON.stringify(guardOverride));
}

// ── 5. A CHARTED HOLD IS ROUTED ROUND TOO, AND WAITS FOR NOBODY ──────────────────────────
// ⚠⚠ THIS BLOCK STATED THE OPPOSITE RULE AND ANDY OVERTURNED IT (2026-11-02): "do not wait for operator input
// to avoid an AIS or any other contact", then "yes, any contact including charted on legs too". It used to
// assert that a hold for a pier opened NO episode and that nothing came back on its own - which is exactly the
// indefinite wait he asked to remove. A charted feature is now carried as the MODEL'S OWN POLY (aisAvoid.chart,
// from chartedHerPoly, found again by ring identity) and the way round walks the plan PAST it, because the walk
// was always kind-blind: aisWalkPast takes two opaque keep-out models and sameContact tests identity before mmsi.
{
  surveying(6, [], { ko: PIER });                   // guard_resume's pier, 30 m north; no contacts
  S.status.cog_deg = 0; S.status.heading_deg = null;   // standing into it, no heading: the straight projection
  frame();
  const held = !!guardHeld;
  const ep5 = aisAvoid && {kind: aisAvoid.kind, mmsi: aisAvoid.mmsi, charted: !!aisAvoid.chart,
                           sameRing: !!(aisAvoid.chart && aisAvoid.chart.ring === PIER.polys[0].ring)};
  nowHolding(); sent = []; banners = []; logged = [];
  frame(); await settle();
  const sent5 = paths().slice();
  check("5. a hold for a CHARTED feature opens an episode naming the feature - the model's own poly, found by "
        + "ring identity, with no mmsi - so the console can act on it at all",
        () => held && !!ep5 && ep5.charted === true && ep5.mmsi === null && ep5.sameRing === true
              && /pier|dock/i.test(ep5.kind),
        () => "banked " + held + ", episode " + JSON.stringify(ep5));
  // ⚠⚠⚠ 5b USED TO ASSERT THE DEFECT, AND THAT IS THE MOST IMPORTANT THING IN THIS BLOCK (2026-11-02, the
  // second critical finding of the review). It read "the console routes round it ITSELF ... pause, upload, LOW,
  // Start" and went green - on a scene where the way round moves her NOWHERE. The suite's PIER is a wall
  // PARALLEL to the line 30 m off, so the line is already clear of it along its whole length; the walk asks
  // about the ROUTE's geometry, every one of its tests passes at the point she stopped, and `skipM` comes back
  // 0 with the pick-up 30 m off - exactly the clearance the line already had. The console paused, re-uploaded
  // the IDENTICAL remainder, commanded LOW, started her, cancelled its own hold, spent the episode and
  // announced "ROUTED ROUND a dock / pier ... picked up 0 m on from where she left it". That destroyed the
  // operator's offer and left the cause - her heading and the drift, which the ladder held her for and which
  // walking along the line does not change - exactly as it was. A pier never passes, so nothing broke the
  // cycle. The console is now REFUSED here, which is the state it had before this feature existed: stopped,
  // remainder banked, offer live, said once per episode.
  check("5b. a charted way round that would pick her up WHERE SHE STOPPED is refused, not performed - nothing "
        + "sent, the hold and the episode both standing, and the banner says the plan already runs there",
        () => sent5.length === 0 && !!guardHeld && !!aisAvoid && !!aisAvoid.chart
              && banners.some(b => /NO WAY ROUND a dock \/ pier/.test(b)
                                   && /the plan already runs where the way round would put her/.test(b)),
        () => "sent " + JSON.stringify(sent5) + ", still held " + !!guardHeld
            + ", episode " + (aisAvoid ? "open" : "SPENT")
            + ", banners " + JSON.stringify(banners.map(b => b.slice(0, 90))));
  // ⚠ AND THE ACCEPTANCE, WITHOUT WHICH 5b IS JUST THE FEATURE TURNED OFF. The case a charted way round is
  // FOR is a feature that has moved ONTO the line ahead of her - a chart read taken since the plan was built,
  // or a plan laid before the feature was known - which is precisely when the plan's geometry and the guard's
  // measurement disagree in a way the maneuver CAN answer. Here she runs east down line 1 into a dock lying
  // across it at e = 40..70, so the walk has to advance past its eastern edge.
  {
    const dockRing = [{e:40,n:-12},{e:70,n:-12},{e:70,n:12},{e:40,n:12}];
    const DOCK_ON_LINE = {polys: [{ring: dockRing, bb: bbOf(dockRing), kind: "a dock / pier"}],
                          lines: [], points: [], marks: [], sys: [], chans: []};
    surveying(6, [], { ko: DOCK_ON_LINE });
    S.status.cog_deg = 90; S.status.heading_deg = 90;         // running EAST down the line, into it
    frame();
    const heldOn = !!guardHeld, chartOn = !!(aisAvoid && aisAvoid.chart);
    const planOn = aisAroundPlan(guardHeld, aisKeepoutsNow(), patClipBufM(), null, aisAvoid && aisAvoid.chart);
    const clrPick = planOn.to
      ? clearanceM(nogo.frame.toEN(planOn.to), {polys: DOCK_ON_LINE.polys, lines: [], points: []}, 1e6) : null;
    nowHolding(); sent = []; banners = []; logged = [];
    frame(); await settle();
    const sentOn = paths().slice(), laOn = logged.find(e => e.kind === "ais_around");
    check("5b2. ... while a charted feature that has moved ONTO the line ahead of her IS routed round, on the "
          + "first station frame and with no press: the walk advances past its eastern edge and the pick-up is "
          + "clear of it at the standoff - so the refusal above is the no-op case and not the feature switched off",
          () => heldOn && chartOn && !planOn.error && planOn.skipM > 50
                && clrPick != null && clrPick >= patClipBufM() - 0.05
                && sentOn.indexOf("/api/cmd/pause") === 0 && sentOn.includes("/api/cmd/upload")
                && sentOn.includes("/api/cmd/speed") && sentOn.includes("/api/cmd/start")
                && laOn && laOn.data.skip_m > 50 && laOn.data.mmsi == null,
          () => "held " + heldOn + "/charted " + chartOn + ", plan "
              + JSON.stringify(planOn.error ? {error: planOn.error.slice(0, 60)}
                  : {skipM: Math.round(planOn.skipM), pickClr: clrPick == null ? null : Math.round(clrPick * 10) / 10})
              + ", sent " + JSON.stringify(sentOn) + ", logged skip_m " + (laOn && laOn.data.skip_m));
    check("5c. ... and it is said and recorded as a way round a CHARTED feature, not as a contact",
          () => !!laOn && laOn.data.mmsi == null && laOn.data.round_m == null
                && banners.some(b => /ROUTED ROUND a dock \/ pier/.test(b)),
          () => "logged " + JSON.stringify(logged.map(e => e.kind))
              + ", mmsi " + JSON.stringify(laOn && laOn.data.mmsi)
              + ", round_m " + JSON.stringify(laOn && laOn.data.round_m)
              + ", banners " + JSON.stringify(banners.map(b => b.slice(0, 48))));
  }
  // ⚠⚠ AND A ONE-STEP PICK-UP IS A PICK-UP (2026-11-03, review). The gate above was first written
  // `skipM > AIS_AROUND_STEP_M`, which refuses the NEAREST point the walk can ever return: it steps along the
  // plan in AIS_AROUND_STEP_M, so the first candidate past her own position is exactly one step on. Measured by
  // the reviewer - held beside a pier face with the next clear water one step along - the console refused its
  // own maneuver on every try, under a banner saying the plan "already runs where the way round would put her",
  // which was then false, and she held indefinitely: the state he asked to have removed. The scene is a pier
  // lying ALONGSIDE the line and ending just ahead of her, so the point she stopped at is inside the standoff
  // and the next one is clear of it - the whole difference between the two thresholds, in one scene.
  {
    const edgeRing = [{e:-60,n:2.5},{e:3,n:2.5},{e:3,n:40},{e:-60,n:40}];
    const PIER_EDGE = {polys: [{ring: edgeRing, bb: bbOf(edgeRing), kind: "a dock / pier"}],
                       lines: [], points: [], marks: [], sys: [], chans: []};
    surveying(6, [], { ko: PIER_EDGE });
    S.status.cog_deg = 90; S.status.heading_deg = 90;           // running EAST, the pier close on her port bow
    frame();
    const held3 = !!guardHeld, chart3 = !!(aisAvoid && aisAvoid.chart);
    const plan3 = aisAroundPlan(guardHeld, aisKeepoutsNow(), patClipBufM(), null, aisAvoid && aisAvoid.chart);
    const here3 = clearanceM(ref.toEN({lat: asv.lat, lon: asv.lon}),
                             {polys: PIER_EDGE.polys, lines: [], points: []}, 1e6);
    nowHolding(); sent = []; banners = []; logged = [];
    frame(); await settle();
    const sent3 = paths().slice(), la3 = logged.find(e => e.kind === "ais_around");
    check("5b4. a pick-up ONE WALK STEP on is performed, not refused: the point she stopped at is inside the "
          + "standoff and the next one is clear of it, so the maneuver has somewhere to put her - the no-op gate "
          + "is about the same PLACE (AIS_AROUND_NOOP_M), never about one grid step",
          () => held3 && chart3 && !plan3.error
                && Math.abs(plan3.skipM - STEP_M) < 0.01
                && here3 != null && here3 < patClipBufM()
                && sent3.includes("/api/cmd/upload") && sent3.includes("/api/cmd/start")
                && la3 && Math.abs(la3.data.skip_m - STEP_M) < 0.51
                && !banners.some(b => /NO WAY ROUND/.test(b)),
          () => "held " + held3 + "/charted " + chart3 + ", skipM "
              + (plan3.error ? "error: " + plan3.error.slice(0, 70) : JSON.stringify(plan3.skipM))
              + ", she is " + (here3 == null ? "?" : here3.toFixed(1)) + " m off it (standoff "
              + patClipBufM().toFixed(1) + "), sent " + JSON.stringify(sent3)
              + ", logged skip_m " + (la3 && la3.data.skip_m)
              + ", banners " + JSON.stringify(banners.map(b => b.slice(0, 60))));
  }
}
// ── 5m. A DOOMED CHARTED TRY IS NOT RE-RUN ON THE AIS POLL CLOCK ─────────────────────────
// ⚠⚠ THE MODEL GATE DID NOT GATE A CHARTED EPISODE AT ALL (2026-11-03, review). A try's signature carried
// `aisPolledAt`, which advances on EVERY poll whether anything moved or not - so the one case where the hazard
// provably cannot move earned a fresh try on the poll clock: the doomed walk, and on the tries that reach it the
// synchronous router search this gate exists to ration, re-run more often than the 10 s timer whose deletion was
// argued safe on exactly this ground ("a pier does not move; the model gate asks once and then waits for
// something to actually change"). The contacts still matter to a charted try - aroundOthers puts them in
// `others`, so one sitting on the pick-up refuses it - so they are in the signature by what they REPORTED
// (aisReportSig) rather than by the clock that says they were asked about.
// ⚠⚠ AND BY THE REPORTS, NOT THE SWEPT BOXES (2026-11-03, the third review). The first version digested the
// boxes, which are dead-reckoned from the last poll to NOW, so they move every frame with the clock: measured at
// 17 fresh tries in 5 s beside a dock from one contact 848 m off and in nobody's way, each try a synchronous
// router search on the page thread. 5m3 is that scene.
// A TRY IS OBSERVED BY `triedOn` BEING REWRITTEN, which is what a try does before it asks anything: the refusal
// here is the no-op gate, which never reaches the router, so counting router calls would see nothing either way.
{
  surveying(6, [], { ko: PIER });
  S.status.cog_deg = 0; S.status.heading_deg = null;   // standing into it: the straight projection, a charted hold
  frame();
  nowHolding(); sent = []; banners = []; logged = [];
  frame(); await settle();                             // the first station frame: the try, refused as a no-op
  const t1 = aisAvoid && aisAvoid.triedOn, chartEp = !!(aisAvoid && aisAvoid.chart);
  const said1 = banners.filter(b => /NO WAY ROUND/.test(b)).length;
  for (let k = 0; k < 3; k++) { clock += 5000; aisPolledAt = clock; frame(); await settle(); }
  const t2 = aisAvoid && aisAvoid.triedOn;
  nogo.ko = {...PIER};                                 // a fresh CHART read: the same water, a new model object
  clock += 1000; aisPolledAt = clock; frame(); await settle();
  const t3 = aisAvoid && aisAvoid.triedOn;
  const said3 = banners.filter(b => /NO WAY ROUND/.test(b)).length;
  check("5m. a charted try that found nothing is NOT re-run on the poll clock - three fresh AIS reports over 15 s "
        + "with nothing moved earn no second try, where a pier cannot have changed - and IS re-run on a fresh "
        + "chart read, which is the only thing that can change the answer; said once per episode either way",
        () => chartEp && !!t1 && t2 === t1 && !!t3 && t3 !== t1 && said1 === 1 && said3 === 1,
        () => "charted " + chartEp + "; after 3 polls the try record is "
            + (t2 === t1 ? "the SAME (no try went)" : "REPLACED (a try went)")
            + "; after a fresh chart read it is " + (t3 === t1 ? "the SAME (no try went)" : "REPLACED (a try went)")
            + "; said " + said1 + " then " + said3);
  // ⚠ AND THE CONTACTS ARE STILL IN THAT SIGNATURE, BY WHERE THEY ARE. They are in `others`, so one sitting on
  // the pick-up refuses a charted try and one that moves off it can answer the same question differently - the
  // one thing the poll clock got RIGHT. Asserted on the signature itself, because a stand-in that answered a
  // constant would pass the scene above while quietly freezing the charted maneuver for as long as she holds.
  const vA = [{mmsi: 1, lat: 43.07, lon: -70.76, sog: 6, cog: 90, heading: 92, nav: 0},
              {mmsi: 2, lat: 43.08, lon: -70.75, sog: 0, cog: null, heading: null, nav: 1}];
  const vSame = [{...vA[0]}, {...vA[1]}];                         // the same reports, in a new array
  const vOrder = [vA[1], vA[0]];                                  // the service serves them sorted by report AGE
  const vMoved = [{...vA[0], lat: 43.0702}, vA[1]];               // ~22 m: a real report
  const vSlower = [{...vA[0], sog: 2}, vA[1]];                    // same place, a new velocity: a new sweep
  const vGone = [vA[1]];
  const vName = [{mmsi: null, name: "A|B~C", lat: 1, lon: 2, sog: 0, cog: null, heading: null, nav: null}];
  check("5m2. ... and what stands in for the poll clock there is what the contacts REPORTED: a fleet that has "
        + "not moved reads identical whatever order the service serves it in, one that has moved or changed "
        + "speed does not, a contact that comes into range or leaves changes it - and a name holding the "
        + "delimiters cannot shift a field boundary",
        () => aisReportSig(vA) === aisReportSig(vSame) && aisReportSig(vA) === aisReportSig(vOrder)
              && aisReportSig(vA) !== aisReportSig(vMoved) && aisReportSig(vA) !== aisReportSig(vSlower)
              && aisReportSig(vA) !== aisReportSig(vGone) && aisReportSig([]) === "" && aisReportSig(null) === ""
              && aisReportSig(vName).split("|").length === 1,
        () => "unmoved: " + (aisReportSig(vA) === aisReportSig(vSame))
            + ", re-ordered: " + (aisReportSig(vA) === aisReportSig(vOrder))
            + ", moved 22 m: " + (aisReportSig(vA) !== aisReportSig(vMoved))
            + ", slowed: " + (aisReportSig(vA) !== aisReportSig(vSlower))
            + ", one left: " + (aisReportSig(vA) !== aisReportSig(vGone))
            + "; one contact is " + aisReportSig(vName).split("|").length + " entry; '" + aisReportSig(vA) + "'");
}
// ── 5m3. AND THE CLOCK ALONE BUYS NO TRY, WHICH IS WHAT THE FIRST VERSION GOT WRONG ──────
// ⚠⚠ THE SIGNATURE DIGESTED THE SWEPT BOXES, AND A SWEPT BOX MOVES WITH THE CLOCK (2026-11-03, the third
// review, measured). aisKeepout dead-reckons each moving contact from `c + vel * min(ageS, AIS_DR_MAX_S)`, and
// ageS counts from the last poll to NOW - so the box of a contact under way 848 m off and in nobody's way
// advanced ~0.64 m per frame at 6 kn, the string differed on 32 of 39 consecutive frames, and a charted hold
// bought 17 fresh tries in five seconds against a hazard that cannot move. Every try that reaches the router is
// a SYNCHRONOUS search on the page thread (11 s and 17.8 s measured on the Piscataqua): the clearance ladder,
// the AVOIDING flag, render() and the supervision POST all stop, and at planning.supervisor_lost_s the console
// stands an armed running boat down. So this scene advances the clock with NO new poll, no new chart read and
// nothing moved, and counts the tries. The control is the same hold on an empty sea.
{
  const tries = async (vessels) => {
    surveying(6, vessels, { ko: PIER });
    S.status.cog_deg = 0; S.status.heading_deg = null;      // standing into it: a charted hold
    frame(); nowHolding(); frame(); await settle();
    const t0 = aisAvoid && aisAvoid.triedOn;
    let n = 0, prev = t0;
    for (let k = 0; k < 20; k++) {                          // 5 s of frames, NO fresh aisPolledAt
      clock += 250; frame(); await settle();
      const t = aisAvoid && aisAvoid.triedOn;
      if (t !== prev) { n++; prev = t; }
    }
    return { first: !!t0, extra: n };
  };
  // under way, 850 m off on the quarter, in nobody's way: her dead-reckoned box moves every frame
  const far = [contact(600, -600, { sog: 6, cog: 45, heading: 45 })];
  const withTraffic = await tries(far);
  const emptySea = await tries([]);
  check("5m3. ... and the CLOCK buys none: 5 s of frames with no fresh poll, no chart read and nothing moved "
        + "earn no second try even with a contact under way in range, whose swept box the model dead-reckons "
        + "every frame - the signature asks what she REPORTED, not where the clock has carried her box to",
        () => withTraffic.first && withTraffic.extra === 0 && emptySea.first && emptySea.extra === 0,
        () => "with a contact under way: first try " + withTraffic.first + ", extra tries in 20 frames "
            + withTraffic.extra + "; empty sea: first try " + emptySea.first + ", extra " + emptySea.extra);
}
// ── 5m4. THE TRY THAT MATTERED: SHE IS CARRIED OFF THE HOLD POINT ────────────────────────
// ⚠⚠ `g.at` IS FROZEN FOR THE WHOLE EPISODE (2026-11-03, the third review). markGuardHeld writes it once, at the
// instant the rung banks, and returns at its own first gate on every frame of the hold after that - so the
// signature's position could not move however far she went, and the `|| asv` arm was dead. The answer DOES move
// with her: both resumes route the way in from `asv` and certify that leg. Measured consequence: the first try
// goes with way still on her, ~25 m short of the hold point, is refused, and the first SETTLED station frame -
// and then a 1.75 kn set carrying her 40 m off - were all answered "nothing has moved". Mutating the page's
// expression to the live position left all 208 checks green, which is why this one exists.
{
  surveying(6, [], { ko: PIER });
  S.status.cog_deg = 0; S.status.heading_deg = null;
  frame(); nowHolding(); frame(); await settle();
  const t1 = aisAvoid && aisAvoid.triedOn, at1 = t1 && t1.at;
  clock += 1000; frame(); await settle();
  const t2 = aisAvoid && aisAvoid.triedOn;                  // same place: no try
  asv = ll(0, -40);                                         // the set has carried her 40 m off the hold point
  clock += 1000; frame(); await settle();
  const t3 = aisAvoid && aisAvoid.triedOn, at3 = t3 && t3.at;
  check("5m4. ... but SHE moving does: a boat held where nothing can change still earns no second try, and the "
        + "same boat carried 40 m off her hold point by the set earns one - because the way IN is routed from "
        + "where she is, so her own position is an input to the answer and not a note about it",
        () => !!t1 && t2 === t1 && !!t3 && t3 !== t1 && at1 !== at3,
        () => "settled: " + (t2 === t1 ? "no try (right)" : "a try went") + "; after 40 m of set: "
            + (t3 !== t1 ? "a try went (right)" : "NO try") + "; signature at " + at1 + " -> " + at3);
}
// ── 5m5. AND THE STANDOFF IS AN INPUT TOO ────────────────────────────────────────────────
// ⚠ ONE NUMBER GOVERNS THE WHOLE MANEUVER and it was not in the signature (2026-11-03, review): `std` is derived
// from the transit speed, the set and nogo.buffer. An operator watching her sit beside a dock drops the transit
// speed, which takes `std` from 20.6 m to a few meters and can make a pick-up exist - and the tick answered
// "nothing has moved, and the answer cannot change until something does", which had just stopped being true.
{
  surveying(6, [], { ko: PIER });
  S.status.cog_deg = 0; S.status.heading_deg = null;
  frame(); nowHolding(); frame(); await settle();
  const t1 = aisAvoid && aisAvoid.triedOn, std1 = t1 && t1.std;
  clock += 1000; frame(); await settle();
  const t2 = aisAvoid && aisAvoid.triedOn;
  nogo = {...nogo, buffer: 8};                               // the operator widened the keep-out buffer
  clock += 1000; frame(); await settle();
  const t3 = aisAvoid && aisAvoid.triedOn;
  check("5m5. ... and so are the scalars the walk's answer is built from: a change to the keep-out buffer, "
        + "which moves both the standoff and the clearance the pick-up must keep, earns a fresh try where the "
        + "same model on the same frame does not",
        () => !!t1 && std1 != null && t2 === t1 && !!t3 && t3 !== t1,
        () => "std in the signature " + std1 + "; unchanged frame: " + (t2 === t1 ? "no try (right)" : "a try went")
            + "; buffer 3 -> 8: " + (t3 !== t1 ? "a try went (right)" : "NO try"));
}
// ── 5n/5o/5p. THE OFF-THE-LINES CHARTED WAY ROUND, WHICH IS WHERE ALL THREE CRITICALS LIVED ──
// A SURVEY held where she is NOT on a coverage line - the run-in to line 1, a turn, the transit into a later
// survey - is the case aisAroundPlan's `fromTurn` branch exists for (the live 2026-10-16 approach failure), and
// the case whose standoff is the LEG's 20.6 m rather than the guard's 3.0 m. The suite had no scene with
// `ep.chart && !g.mark && !g.leg` at all, which is how three separate defects shipped green.
//
//   a DOCK FINGER 6 m south of her route, reaching across her projected track, so she holds for it;
//   the walk's pick-up 50 m on, where the finger is 20.6 m clear and the way on stays clear;
//   the STRAIGHT RUN IN from her station to that pick-up passing 6 m off the finger's face - clear at the
//   ladder's 3.0 m buffer, NOT clear at the 20.6 m the maneuver itself demanded.
function offLines(ko, route) {
  surveying(7, [], { ko });
  mission.lines = []; runLineIdx = -1; lineSwing = -1;     // she is NOT on a coverage line: g.mark is null
  runRoute = route; window._wpIndex = 1; S.wp_total = runRoute.length;
  // ⚠ heading NULL is the suite's own way of getting the STRAIGHT projection rather than the route's (see
  // check 5's scene): a boat crabbing down a route 6 m off a pier reads CLEAR, which check 22 exists to prove.
  S.status.cog_deg = 110; S.status.heading_deg = null;    // standing east-south-east, into the finger
  asv = ll(0, 0);
}
const FINGER = (() => { const r = [{e: 20, n: -40}, {e: 30, n: -40}, {e: 30, n: -6}, {e: 20, n: -6}];
                        return {polys: [{ring: r, bb: bbOf(r), kind: "a dock / pier"}],
                                lines: [], points: [], marks: [], sys: [], chans: []}; })();
const EAST3 = () => [ll(-200, 0), ll(200, 0), ll(200, 60)];
{
  offLines(FINGER, EAST3());
  frame(); nowHolding(); sent = []; banners = []; logged = [];
  frame(); await settle();
  const g5p = guardHeld, ep5p = aisAvoid;
  const la = logged.find(e => e.kind === "ais_around");
  const up = sent.find(x => x.p === "/api/cmd/upload"), rte = (up && up.route) || [];
  const std5p = la ? la.data.std_m : null;
  const station = {lat: 0, lon: 0};                        // ll(0,0) - where nowHolding() left her
  // THE PROPERTY, not the waypoint count: the FIRST leg she will fly must be certified at the standoff the
  // plan she is being handed back onto was laid at. Whether that takes a detour or a refusal is the console's
  // business; driving her up it at the guard's 3.0 m is not.
  const inAtStd = rte.length ? legClear(ll(0, 0), rte[0], ref, FINGER, std5p || 20.6) : null;
  const inAtBuf = rte.length ? legClear(ll(0, 0), rte[0], ref, FINGER, 3.0) : null;
  // THE SCENE'S OWN PREMISE, asserted so the check cannot quietly stop testing anything: the STRAIGHT run from
  // her station to the walk's pick-up must be clear at the ladder's buffer and NOT clear at the standoff. That
  // is the only geometry in which the gate's number decides the outcome.
  const bare = rte.length ? legClear(ll(0, 0), ll(50, 0), ref, FINGER, 3.0) : null;
  const bareStd = rte.length ? legClear(ll(0, 0), ll(50, 0), ref, FINGER, std5p || 20.6) : null;
  check("5p. THE RUN IN TO AN OFF-THE-LINES CHARTED PICK-UP IS CERTIFIED AT THE PLAN'S OWN STANDOFF, not at the "
        + "guard's buffer: resumeHeldRun's wayClear gate asked patClipBufM() while every certification below it "
        + "asked at.stdM, so a run in merely clear at 3.0 m was driven straight up at a pick-up the maneuver "
        + "itself had required 20.6 m for - guard.js's founding case, re-made by the console on its own authority",
        () => !!la && std5p > 15 && rte.length > 0 && inAtStd === true
              // the premise: a straight run up the plan IS clear at 3 m and is NOT clear at the standoff
              && bare === true && bareStd === false,
        () => "std_m " + std5p + ", uploaded " + rte.length + " wpts; the first leg of it is clear at " + std5p
            + " m: " + inAtStd + " (at 3 m: " + inAtBuf + "); the straight run up the plan is clear at 3 m: "
            + bare + ", at the standoff: " + bareStd
            + "; sent " + JSON.stringify(paths()));
}
// ── 5o. AND THE REST OF THE CHART IS JUDGED AT THE LADDER'S BUFFER, NOT AT THE STANDOFF ──────
// ⚠⚠ The pick-up is a point on the OPERATOR'S OWN PLAN, and that plan was punched against the chart already.
// Demanding the leg's 20.6 m of every other charted feature at that point demands the plan be re-planned, and in
// ordinary quay water it refuses the whole maneuver: a coverage line clipped 6 m off a quay wall - legal by the
// planner's own rule - made every candidate point along it "not clear", so the console answered NO WAY ROUND,
// named the dock (which was 20.6 m clear ten meters further on), and left her station-keeping indefinitely. That
// is the operator wait he asked to have removed, in the only water a quay survey happens in. See aroundOthers.
{
  const QUAY = {ring: [{e: 40, n: 6}, {e: 300, n: 6}, {e: 300, n: 36}, {e: 40, n: 36}]};
  QUAY.bb = bbOf(QUAY.ring); QUAY.kind = "a quay";
  const both = {polys: [...FINGER.polys, QUAY], lines: [], points: [], marks: [], sys: [], chans: []};
  offLines(both, EAST3());
  frame(); nowHolding(); sent = []; banners = []; logged = [];
  frame(); await settle();
  const la5o = logged.find(e => e.kind === "ais_around");
  const up5o = sent.find(x => x.p === "/api/cmd/upload"), rte5o = (up5o && up5o.route) || [];
  const pick = rte5o.length ? rte5o[rte5o.length - 1 === 0 ? 0 : 0] : null;   // the first uploaded waypoint
  const quayOnly = {polys: [QUAY], lines: [], points: []};
  const quayClr = pick ? clearanceM(ref.toEN(pick), quayOnly, 1e6) : null;
  check("5o. a dock reached across her way with a QUAY 6 m off the plan beyond it is still routed round: the "
        + "pick-up must be as clear of every other charted feature as the LADDER asks (3 m), not as clear as the "
        + "feature she is getting past (20.6 m) - and the scene proves the distinction, because the pick-up is "
        + "inside the standoff of the quay and outside the buffer",
        () => !!la5o && rte5o.length > 0 && quayClr != null && quayClr >= 3.0 && quayClr < 20.0
              && banners.every(b => !/NO WAY ROUND/.test(b)),
        () => "logged " + !!la5o + ", uploaded " + rte5o.length + " wpts, the pick-up is "
            + (quayClr == null ? "-" : quayClr.toFixed(1)) + " m off the quay (buffer 3.0, standoff "
            + (la5o ? la5o.data.std_m : "-") + "); banners " + JSON.stringify(banners.map(b => b.slice(0, 70))));
}
// ── 5n. A WAY ROUND WHOSE TAIL IS THE CONDEMNED REMAINDER IS REFUSED ─────────────────────────
// ⚠⚠ A DISTANCE CANNOT ANSWER THIS (2026-11-03, the third review, measured). Where the walk's first step lands
// ON her first unflown waypoint, `onWp` nulls `to` and `j` stays at `g.idx`, so the tail IS the remainder the
// guard condemned - with skipM 5, which the 0.5 m gate waves through. Measured: the uploaded route equal to the
// condemned one to 1e-12, guardHeld and aisAvoid both nulled, the operator's offer destroyed, under "ROUTED
// ROUND a rock ... picked up 5.0 m on from where she left it". The gate that replaced `> AIS_AROUND_STEP_M`
// bought back exactly the hold / ROUTED ROUND / hold loop the old one had refused.
{
  const ROCK = {polys: [], lines: [], points: [{e: 0, n: -20.5, r: 0, kind: "a charted rock"}],
                marks: [], sys: [], chans: []};
  offLines(ROCK, [ll(-200, 0), ll(5, 0), ll(200, 0), ll(200, 60)]);
  S.status.cog_deg = 180; S.status.heading_deg = null; S.status.sog_kn = 3;   // standing south, onto the rock
  frame(); nowHolding(); sent = []; banners = []; logged = [];
  frame(); await settle();
  const kept = !!guardHeld, open = !!aisAvoid, said = banners.filter(b => /NO WAY ROUND/.test(b)).length;
  check("5n. a way round whose TAIL is the very remainder the guard condemned is REFUSED, even though its skipM "
        + "is a whole walk step: the first step lands on her first unflown waypoint, so nothing moves, and "
        + "performing it would spend the episode, cancel the hold and hand her back onto the same track - the "
        + "loop the gate exists to stop. She keeps holding, with the record and the operator's offer intact",
        () => paths().length === 0 && kept && open && said === 1,
        () => "sent " + JSON.stringify(paths()) + ", record kept " + kept + ", episode open " + open
            + ", said " + said + "x; banners " + JSON.stringify(banners.map(b => b.slice(0, 90))));
}
// ── 5d2. AND NEITHER BAR PROMISES THE RETURN FOR CHARTED WATER ───────────────────────────
// ⚠⚠ A NEW REGRESSION, AND THIS COMMIT IS WHAT MADE IT REACHABLE (2026-11-03, the third review). aisReturnTick
// returns at its own first line on `aisAvoid.chart` - deliberately, because a pier does not pass - so
// `clearSince` never starts and the 100 m return can never run for a charted episode. Both held bars said
// "resumes on its own once she is clear of the line" / "carries on by itself once she is clear of the way"
// anyway, rewritten at 4 Hz in front of an operator watching a boat that was never going to resume on its own.
// On master the `if(aisAvoid)` block was DEAD for a charted hold, because a charted hold opened no episode at
// all; opening one is this commit's own change, so the false promise is this commit's own.
{
  // ⚠ READ ON THE FIRST STATION FRAME, BEFORE THE MANEUVER. The bar is what the operator reads WHILE she is
  // stopped, and the very next frame is the way round, which spends the episode - so the bar is rendered by
  // hand here rather than waiting for a frame that would answer the hold before it could be read.
  const bars = (ko, vessels, cog) => {
    surveying(6, vessels, { ko });
    S.status.cog_deg = cog; S.status.heading_deg = null;
    frame(); nowHolding();
    const g = guardHeldOffer();
    EL["#gb_why"].textContent = "";
    if (g) renderGuardBar(g);
    return { why: EL["#gb_why"].textContent || "", charted: !!(aisAvoid && aisAvoid.chart),
             open: !!aisAvoid };
  };
  const chartedBar = bars(PIER, [], 0);
  // a CONTACT sitting across the line 30 m ahead: the same hold, and she DOES get the 100 m return
  const contactBar = bars(OPEN, [contact(30, 0, { sog: 0, cog: null, heading: 90 })], 90);
  check("5d2. the held bar does NOT promise the automatic return for a charted episode, which aisReturnTick "
        + "refuses outright - it says charted water does not pass and that the console routes round it - while "
        + "a CONTACT's bar still promises the return, which she still gets",
        () => chartedBar.charted === true
              && /does not pass/.test(chartedBar.why) && /routes round it/.test(chartedBar.why)
              && !/resumes on its own/.test(chartedBar.why)
              && contactBar.charted === false && /resumes on its own/.test(contactBar.why),
        () => "charted: '" + chartedBar.why.slice(-150) + "'; contact: '" + contactBar.why.slice(-110) + "'");
}
// ── 5e2. AND "THE AIS MODEL IS BLIND" IS NOT LEFT BEHIND BY A FRAME THAT LOST THE FIX ────
// ⚠ aisKeepoutsNow resets aisKoDrawn, aisKoNote and aisKoStale on its early return and left aisKoBlind standing
// - and aisKoBlind is only ever recomputed BELOW that return (2026-11-03, review). So a frame with no fix or no
// chart frame while the feed was blind left `true` behind, and a charted way round once both came back on a
// fresh poll carried `plan.blindTraffic` into the ROUTED ROUND banner, the flash note, the Intent card and
// ais_around's `blind_traffic` in the session log: "the traffic was not checked" about a maneuver planned on a
// fresh model. It over-warns rather than falsely certifying, so it never reached the water - but the log line is
// the one read back after a field test.
{
  // the same recipe as 8-8e: a poll old enough to be stale, then past the feed's grace period under way
  surveying(7, [CROSSING()], { polledAt: clock - 50000 });
  frame(); clock += 41000; frame();
  const blindNow = aisKoBlind;
  const held = asv;
  asv = null; aisKeepoutsNow();                   // the frame that lost the fix: the early return
  const afterLost = aisKoBlind;
  asv = held;
  check("5e2. the 'AIS keep-outs BLIND' fact is cleared by the frame that could not measure it, not left "
        + "standing - so a maneuver planned on a fresh model is never logged as one whose traffic was unchecked",
        () => blindNow === true && afterLost === false,
        () => "blind while wanted and stale: " + blindNow + "; after a frame with no fix: " + afterLost);
  asv = ll(0, 0);
}
// ── 5d. THE 100 m RETURN DOES NOT CLAIM A CHARTED WAY BACK ───────────────────────────────
// A pier does not pass. The return's whole argument is that a CONTACT clears the line by moving, and the
// coverage is taken back over water already run; measuring a charted feature "clear" would mean the chart
// changed under her or she was set off it, neither of which is a reason to drive back DOWN the line. So a
// charted episode is left entirely to the way round, and aisReturnTick stands aside on `aisAvoid.chart`.
{
  surveying(6, [], { ko: PIER });
  S.status.cog_deg = 0; S.status.heading_deg = null;
  frame(); nowHolding();
  const charted = !!(aisAvoid && aisAvoid.chart);
  nogo.ko = PIER;                                   // the same water, still charted: nothing has "cleared"
  sent = []; for (let k = 0; k < 8; k++) { clock += 1000; aisPolledAt = clock; frame(); }
  await settle();
  check("5d. the 100 m return never fires for a charted episode - its dwell is not even started, so the way "
        + "round is the only answer in play",
        () => charted && aisAvoid != null && !aisAvoid.clearSince
              || (aisAvoid === null && paths().includes("/api/cmd/upload")),   // or the way round already took it
        () => "charted " + charted + ", clearSince " + (aisAvoid && aisAvoid.clearSince)
            + ", sent " + JSON.stringify(paths()));
}

// ── 5e-5g. THE STANDOFF A CHARTED WAY ROUND KEEPS IS THE PLAN'S OWN ──────────────────────
// ⚠⚠ CAUGHT BY ADVERSARIAL REVIEW BEFORE THIS SHIPPED (2026-11-02), and it is the defect class guard.js was
// written for. `aisAroundGo` handed every episode patClipBufM() - the GUARD's standoff, 3.0 m with a 3 m buffer
// in calm water. A Go-To, an RTH, a drawn transit and an Upload's transit legs are planned at
// transitStandoffM() instead: the turn radius at the transit speed, 20.6 m on this hull at HIGH. For a CONTACT
// that gap is covered by her own ring (aisRoundKeepout tops the router's standoff up to a ship-length about her
// center); for a CHARTED feature aisRoundKeepout returns the poly UNTOUCHED, so `std` was the entire margin and
// the console would have laid a pick-up 10 m off a pier on a leg its own planner required 20.6 m for - which is
// guard.js:207's founding case, the 13.7 kn Go-To that passed a charted rock 5.9 m off in a river 400 m wide,
// re-created deliberately. Worse, 3 m IS the ladder's buffer, so the guard holds her on the detour it commanded.
//
// THE FIXTURE IS THE ONLY ONE THAT DISCRIMINATES: a pier face 10 m off the leg, BETWEEN the two standoffs. At
// 30 m (the suite's usual wall) both answer identically and the check would pass on nothing, so that case is
// asserted here too, as the control.
{
  const pierAt = (n0) => { const r = [{e:-60,n:n0},{e:60,n:n0},{e:60,n:n0+30},{e:-60,n:n0+30}];
    return {polys:[{ring:r, bb:bbOf(r), kind:"a dock / pier"}], lines:[], points:[], marks:[], sys:[], chans:[]}; };
  const stdLine = patClipBufM(), stdLeg = transitStandoffM();
  // the two must really differ, or every assertion below is vacuous
  check("5e. the leg's standoff and the guard's are different numbers in this fixture - without which 5f and 5g "
        + "would pass on nothing (patClipBufM is the buffer in calm water; transitStandoffM is the turn radius "
        + "at the transit speed)",
        () => stdLine > 0 && stdLeg > stdLine + 5,
        () => "patClipBufM " + Math.round(stdLine * 10) / 10 + " m, transitStandoffM "
            + Math.round(stdLeg * 10) / 10 + " m");

  const KO = pierAt(10);
  const clrOf = (p) => clearanceM(nogo.frame.toEN(p), {polys: KO.polys, lines: [], points: []}, 1e6);
  onLeg("goto", [], { ko: KO }); S.status.cog_deg = 0; S.status.heading_deg = null; frame();
  const heldNear = !!guardHeld, chartNear = !!(aisAvoid && aisAvoid.chart);
  const gNear = guardHeld, koNear = aisKeepoutsNow(), chNear = aisAvoid && aisAvoid.chart;
  // the SAME plan function asked at each standoff: the fix is which number the caller passes
  const pGuard = aisAroundLegPlan(gNear, koNear, stdLine, null, chNear);
  const pLeg   = aisAroundLegPlan(gNear, koNear, stdLeg,  null, chNear);
  const clrGuard = pGuard.to ? clrOf(pGuard.to) : null, clrLeg = pLeg.to ? clrOf(pLeg.to) : null;
  // and what the console actually does, end to end, with the caller choosing
  nowHolding(); sent = []; banners = []; notes = []; logged = [];
  frame(); await settle();
  const laNear = logged.find(e => e.kind === "ais_around");
  check("5f. a CHARTED hold on a LEG is walked and certified at the LEG's standoff, not the guard's: the pier "
        + "face 10 m off, the guard's number accepts a 0 m 'way round' with the pick-up 10 m off it - the water "
        + "the plan refused - while the leg's own number deviates her and picks up BEYOND transitStandoffM",
        () => heldNear && chartNear
              && !pGuard.error && Math.round(pGuard.skipM) === 0 && clrGuard < stdLeg - 5
              && !pLeg.error && pLeg.skipM > 0 && clrLeg >= stdLeg - 0.5
              && laNear && Math.abs(laNear.data.std_m - stdLeg) < 0.2,
        () => "held " + heldNear + "/charted " + chartNear
            + "; at the guard's " + Math.round(stdLine * 10) / 10 + " m: skip "
            + (pGuard.error ? "ERR " + pGuard.error : Math.round(pGuard.skipM) + " m, pick-up "
               + Math.round(clrGuard * 10) / 10 + " m off")
            + "; at the leg's " + Math.round(stdLeg * 10) / 10 + " m: skip "
            + (pLeg.error ? "ERR " + pLeg.error : Math.round(pLeg.skipM) + " m, pick-up "
               + Math.round(clrLeg * 10) / 10 + " m off")
            + "; the console logged std_m " + (laNear && laNear.data.std_m));

  // THE SCOPING, which is not an oversight: a COVERAGE LINE keeps the guard's standoff (coverage is the
  // operator's and a line's turns are built on the radius already - guard.js:210), and a CONTACT keeps her own
  // ring, which is Andy's 2026-09-28 "make the avoidance maneuver tighter and recover the survey line sooner".
  // Widening either here would reverse a recorded decision, so both are pinned.
  // ⚠ THE CHARTED-LINE SCENE HAS TO BE ONE THE MANEUVER ACTUALLY RUNS IN, or there is no `ais_around` record
  // to read the standoff off. The wall 30 m off the line is now refused as a no-op (5b), so this uses the dock
  // lying ACROSS the line that 5b2 established - she runs east into it and the walk advances past it.
  {
    const dRing = [{e:40,n:-12},{e:70,n:-12},{e:70,n:12},{e:40,n:12}];
    surveying(6, [], { ko: {polys: [{ring: dRing, bb: bbOf(dRing), kind: "a dock / pier"}],
                            lines: [], points: [], marks: [], sys: [], chans: []} });
    S.status.cog_deg = 90; S.status.heading_deg = 90;
  }
  frame();
  nowHolding(); sent = []; logged = []; frame(); await settle();
  const laLine = logged.find(e => e.kind === "ais_around");
  // ⚠ contact() AND NOT PARKED(): PARKED is a `const` arrow declared 180 lines below this block, so reading it
  // here is a TDZ ReferenceError that the crash guard reports as the suite dying, not as a failing check. Same
  // vessel, built from the hoisted helper: 30 x 8 stopped across the line 30 m ahead.
  onLeg("goto", [contact(30, 0, { sog: 0, cog: null, heading: 90 })]); frame();
  nowHolding(); sent = []; logged = []; frame(); await settle();
  const laContact = logged.find(e => e.kind === "ais_around");
  check("5g. ... and NOTHING ELSE MOVED: a charted hold on a coverage LINE still keeps the guard's standoff, and "
        + "a CONTACT on a leg still keeps hers - her ring tops the router up to a ship-length, which is his own "
        + "instruction - so the leg's number is given to the one case that had no second rule",
        () => laLine && Math.abs(laLine.data.std_m - stdLine) < 0.2 && laLine.data.round_m == null
              && laContact && Math.abs(laContact.data.std_m - stdLine) < 0.2 && laContact.data.round_m > 0,
        () => "charted line std_m " + (laLine && laLine.data.std_m) + "/round_m " + (laLine && laLine.data.round_m)
            + "; contact leg std_m " + (laContact && laContact.data.std_m)
            + "/round_m " + (laContact && laContact.data.round_m));

  // ⚠⚠ 5h2 EXISTS BECAUSE A MUTATION SURVIVED (2026-11-02). Opening an episode for charted water made the
  // chart menu's ROUTE ROUND <contact> row LIVE during a charted hold - `avoidWhy` asked only whether an
  // episode was open - so a right-click on a ship read "Route round MARY ANN" and then routed round the PIER,
  // announcing the pier's name over the contact the operator had picked. The ops manual asserts the opposite in
  // as many words. Nothing caught putting the old gate back, so this does.
  {
    // ⚠ READ AFTER nowHolding() AND BEFORE THE NEXT FRAME. avoidWhy's charted arm is behind guardHeldOffer(),
    // which wants her reporting station-keeping; and the very next frame IS the way round, which spends the
    // episode - so the gate has to be asked in the window where the hold is live and the maneuver has not run.
    surveying(6, [], { ko: PIER }); S.status.cog_deg = 0; S.status.heading_deg = null; frame(); nowHolding();
    const chartedHold = !!(aisAvoid && aisAvoid.chart && guardHeldOffer()), whyCharted = avoidWhy();
    onLeg("goto", [contact(30, 0, { sog: 0, cog: null, heading: 90 })]); frame(); nowHolding();
    const contactHold = !!(aisAvoid && !aisAvoid.chart && guardHeldOffer()), whyContact = avoidWhy();
    check("5h2. the chart menu's ROUTE ROUND <contact> is REFUSED while she is held for CHARTED water - the row "
          + "is about the thing that stopped her, and a contact is not it - while a contact's own hold keeps it",
          () => chartedHold && /held for a charted feature/.test(whyCharted)
                && contactHold && whyContact === "",
          () => "charted hold " + chartedHold + " -> why '" + whyCharted + "'; contact hold "
              + contactHold + " -> why '" + whyContact + "'");
  }

  check("5h. and the margin is WORDED from the same fact, not asserted: a contact keeps 'one ship-length off "
        + "her'; a charted feature is told the standoff in meters, because it has no length to broadcast and "
        + "aisRoundKeepout gives its ring no growth at all - four surfaces promised the ship-length for both",
        () => /one ship-length off her/.test(aroundMarginSay({roundM: 30, stdM: 3}))
              && /\bm off it\b/.test(aroundMarginSay({roundM: null, stdM: 20.6}))
              && !/ship-length/.test(aroundMarginSay({roundM: null, stdM: 20.6}))
              && /clear of it/.test(aroundMarginSay({})),
        () => JSON.stringify([aroundMarginSay({roundM: 30, stdM: 3}),
                              aroundMarginSay({roundM: null, stdM: 20.6}), aroundMarginSay({})]));
}

// ── 5i-5l. EVERY TYPE THE CHART HAS, NOT ONLY POLYGONS ───────────────────────────────────
// ⚠⚠ CAUGHT BY ADVERSARIAL REVIEW BEFORE THIS SHIPPED (2026-11-02). chartedHerPoly gave up on
// `if(!bi || !bi.ring)`, and blockedInfo returns NO ring for `type:'line'` or `type:'point'` - so a pier drawn
// as a LINE, a dock line, the shoreline, a rock, a wreck, an obstruction and a shoal sounding all opened no
// episode at all and went on waiting for the operator with no end to it, which is the one thing he asked to
// remove ("do not wait for operator input to avoid an AIS or any other contact"). The same feature as a
// POLYGON got the maneuver and as a LINE got nothing, and no surface said which.
//
// The walk needed no change: aisWalkPast takes opaque {polys, lines, points} models and clearanceM and
// legClear read all three buckets. What was missing was naming the feature and putting it in the right bucket
// (herOnlyModel) and taking it out of the right bucket in `others` (aroundOthers filtered `polys` only, so a
// line she was being routed PAST stayed in the water the pick-up had to be clear OF - every candidate point
// rejected for the very feature she is getting past, and no way round findable at all).
{
  const lineKO = (e0, e1, n, kind) => ({
    polys: [], lines: [{pts: [{e:e0,n:n}, {e:e1,n:n}], bb: bbOf([{e:e0,n:n-1},{e:e1,n:n+1}]),
                        kind: kind || "a dock / pier"}],
    points: [], marks: [], sys: [], chans: []});
  const pointKO = (e, n, r, kind) => ({
    polys: [], lines: [], points: [{e, n, r: r || 0, kind: kind || "a charted rock"}],
    marks: [], sys: [], chans: []});

  // (a) A PIER DRAWN AS A LINE, lying across the survey line ahead of her
  {
    const KO = lineKO(40, 70, 0);
    surveying(6, [], { ko: KO }); S.status.cog_deg = 90; S.status.heading_deg = 90; frame();
    const ep = aisAvoid && {kind: aisAvoid.kind, charted: !!aisAvoid.chart};
    const chart = aisAvoid && aisAvoid.chart;
    const hm = chart ? herOnlyModel(chart) : null;
    const oth = chart ? aroundOthers(aisKeepoutsNow(), chart, chart) : null;
    const held = !!guardHeld;   // the way round SPENDS it, so it is read before the settle below
    nowHolding(); sent = []; banners = []; logged = []; frame(); await settle();
    const la = logged.find(e => e.kind === "ais_around");
    check("5i. a charted feature drawn as a LINE opens an episode naming it, goes into the walk's model as a "
          + "LINE - not into `polys`, where clearanceM would read its missing ring as clear water - and is "
          + "routed round like any other: the same answer a polygon gets, where it used to get none",
          () => held && !!ep && ep.charted === true && /dock|pier/i.test(ep.kind)
                && !!chart && chart.pts === KO.lines[0].pts          // the model's OWN line, by identity
                && hm && hm.lines.length === 1 && hm.polys.length === 0 && hm.points.length === 0
                && oth && oth.all.lines.length === 0                   // and taken OUT of `others`
                && paths().includes("/api/cmd/upload") && la && la.data.skip_m > 50,
          () => "episode " + JSON.stringify(ep) + ", same line " + !!(chart && chart.pts === KO.lines[0].pts)
              + ", herOnly " + JSON.stringify(hm && {p: hm.polys.length, l: hm.lines.length, pt: hm.points.length})
              + ", others.all.lines " + (oth && oth.all.lines.length)
              + ", sent " + JSON.stringify(paths()) + ", skip_m " + (la && la.data.skip_m));
  }
  // (b) A CHARTED ROCK - a POINT with a radius - on the line ahead of her
  {
    const KO = pointKO(55, 0, 15, "a charted rock");
    surveying(6, [], { ko: KO }); S.status.cog_deg = 90; S.status.heading_deg = 90; frame();
    const ep = aisAvoid && {kind: aisAvoid.kind, charted: !!aisAvoid.chart};
    const chart = aisAvoid && aisAvoid.chart;
    const hm = chart ? herOnlyModel(chart) : null;
    // ⚠ `others` IS ASSERTED HERE BECAUSE A MUTATION SURVIVED WITHOUT IT (2026-11-02). Deleting the points
    // filter from aroundOthers left this check green: the rock sits at e=55 with a 15 m radius and the pick-up
    // lands at e=75, which is 20 m clear of it - so leaving her in the water the pick-up must be CLEAR of
    // happened not to block this particular pick-up. 5i asserts the line equivalent directly; so does this now.
    const oth = chart ? aroundOthers(aisKeepoutsNow(), chart, chart) : null;
    const held = !!guardHeld;   // the way round SPENDS it, so it is read before the settle below
    nowHolding(); sent = []; banners = []; logged = []; frame(); await settle();
    const la = logged.find(e => e.kind === "ais_around");
    check("5j. ... and so does a POINT with a radius - a rock, a wreck, an obstruction, a shoal sounding - "
          + "matched back to the model by its coordinates AND its radius, because blockedInfo hands back a copy "
          + "of the position rather than the model's own object, so identity is not available for this one type",
          () => held && !!ep && ep.charted === true && /rock/i.test(ep.kind)
                && !!chart && chart === KO.points[0]
                && hm && hm.points.length === 1 && hm.polys.length === 0 && hm.lines.length === 0
                && oth && oth.all.points.length === 0                  // and taken OUT of `others`
                && paths().includes("/api/cmd/upload") && la && la.data.skip_m > 50
                && banners.some(b => /ROUTED ROUND a charted rock/.test(b)),
          () => "episode " + JSON.stringify(ep) + ", the model's own point " + !!(chart === KO.points[0])
              + ", herOnly " + JSON.stringify(hm && {p: hm.polys.length, l: hm.lines.length, pt: hm.points.length})
              + ", others.all.points " + (oth && oth.all.points.length)
              + ", sent " + JSON.stringify(paths()) + ", skip_m " + (la && la.data.skip_m)
              + ", banner " + JSON.stringify((banners[0] || "").slice(0, 60)));
  }
  // (c) ⚠⚠ THE MISATTRIBUTION the review probed: the real hazard is the LINE AHEAD, with an unrelated POLYGON
  // ASTERN inside the measured clearance. blockedInfo answers in model order - polygons, then lines, then
  // points - and the boat-position fallback asks at the BOAT with that clearance, so the shoal behind her won
  // and the episode came back as "a shoal": the hold's note promised to route round a shoal, the banner and the
  // log said a shoal, "she is behind it" was measured against a feature she was never held for, and the thing
  // that actually stopped her was named nowhere in the console.
  {
    const lRing = [{e:40,n:0}, {e:70,n:0}];
    const shoalRing = [{e:-80,n:-20},{e:-40,n:-20},{e:-40,n:20},{e:-80,n:20}];
    const KO = {polys: [{ring: shoalRing, bb: bbOf(shoalRing), kind: "a shoal"}],
                lines: [{pts: lRing, bb: bbOf([{e:40,n:-1},{e:70,n:1}]), kind: "a dock / pier"}],
                points: [], marks: [], sys: [], chans: []};
    surveying(6, [], { ko: KO }); S.status.cog_deg = 90; S.status.heading_deg = 90; frame();
    const ep = aisAvoid && {kind: aisAvoid.kind, charted: !!aisAvoid.chart};
    const chart = aisAvoid && aisAvoid.chart;
    const oth = chart ? aroundOthers(aisKeepoutsNow(), chart, chart) : null;
    const held = !!guardHeld;   // the way round SPENDS it, so it is read before the settle below
    nowHolding(); sent = []; banners = []; logged = []; frame(); await settle();
    check("5k. ... and the episode is about the feature AHEAD of her, not whichever one the model lists first: "
          + "a pier drawn as a line ahead with a shoal polygon astern is 'a dock / pier', the shoal stays in "
          + "`others` as water the pick-up must clear, and no surface names the wrong hazard",
          () => held && !!ep && ep.charted === true
                && /dock|pier/i.test(ep.kind) && !/shoal/i.test(ep.kind)
                && !!chart && chart.pts === KO.lines[0].pts
                && oth && oth.all.polys.length === 1 && oth.all.lines.length === 0
                // ⚠ AND IN `all`, NOT IN `std` (2026-11-03): the shoal is water the plan was already punched
                // against, so the pick-up must be as clear of it as the LADDER asks, not as clear as a contact's
                // standoff - which is what refused an off-the-lines charted hold in a harbor. See aroundOthers.
                && oth.std.polys.length === 0 && oth.std.lines.length === 0 && oth.std.points.length === 0
                && banners.every(b => !/ROUTED ROUND a shoal/.test(b)),
          () => "episode " + JSON.stringify(ep) + ", her bucket "
              + (chart ? (chart.ring ? "POLY - the shoal astern" : chart.pts ? "line" : "point") : "-")
              + ", others.all polys/lines " + (oth && oth.all.polys.length) + "/" + (oth && oth.all.lines.length)
              + ", others.std " + (oth && (oth.std.polys.length + oth.std.lines.length + oth.std.points.length))
              + ", banners " + JSON.stringify(banners.map(b => b.slice(0, 48))));
  }
  // ⚠ UNREAD WATER IS NOT A FEATURE TO ROUTE PAST. blockedInfo answers `{type:'unknown'}` for a point whose
  // coordinates are not finite, and chartedHerPoly returns null for it rather than reaching into the model: a
  // thing to REFUSE TO ENTER is not a thing to walk round, and adopting the first polygon instead would open an
  // episode about whichever feature the model happens to list first. The call site also gates on
  // `a.level !== "blind"`, so this should be unreachable from the ladder - which is exactly why it is asserted
  // on the function instead of through a scene: a defence that is only reachable through a gate somewhere else
  // is one a later change to that gate silently removes.
  check("5k2. unread water opens NO episode - blockedInfo's `unknown` is a thing to refuse to enter, never one "
        + "to route round, and reaching into the model there would name an arbitrary feature",
        () => {
          const ring = [{e:-60,n:-20},{e:-20,n:-20},{e:-20,n:20},{e:-60,n:20}];
          const ko = {polys: [{ring, bb: bbOf(ring), kind: "a shoal"}], lines: [], points: [],
                      marks: [], sys: [], chans: []};
          return chartedHerPoly({e: NaN, n: 0}, ko, 3, {e: NaN, n: 0}, 60, null) === null
              && chartedHerPoly({e: NaN, n: NaN}, ko, 3, null, null, null) === null;
        },
        () => "a non-finite entry point gives "
            + JSON.stringify(chartedHerPoly({e: NaN, n: 0},
                {polys: [{ring: [{e:-60,n:-20},{e:-20,n:-20},{e:-20,n:20},{e:-60,n:20}],
                           bb: bbOf([{e:-60,n:-20},{e:-20,n:-20},{e:-20,n:20},{e:-60,n:20}]), kind: "a shoal"}],
                  lines: [], points: [], marks: [], sys: [], chans: []}, 3, {e: NaN, n: 0}, 60, null)
                ? "A FEATURE" : "null"));

  // (d) and the boat-position fallback may not name a kind the LADDER did not measure
  // ⚠⚠ AND THE KIND TEST ALONE WAS INERT, WHICH THIS CHECK ONCE HID (2026-11-03, review). `herKind` is
  // `clearance.kind`, and updateClearance only sets that when the measured clearance is INSIDE the buffer, so on
  // the standing-off frames the fallback actually runs on it is null - the reviewer measured null in all 207 of
  // them - and `herKind == null` accepted every fallback unchecked. The three arms below passed on arguments the
  // page cannot produce there, which is the exact shape of a check that proves nothing. The kind arms are kept,
  // because inside the buffer the ladder DOES name a kind and the test is right there; the arms that do the work
  // now are the ambiguity ones, whose arguments are the only ones the page can hand it on a standing-off frame.
  check("5l. the boat-position fallback is accepted only where NOTHING ELSE is as close, and only when it does "
        + "not contradict a kind the ladder did measure - it asks at the BOAT and takes the first feature in "
        + "model order, which need be neither the nearest nor the one ahead, so an ambiguous model gives NO "
        + "episode and leaves the operator the offer rather than a confident wrong name",
        // ⚠ EN POINTS, NOT lat/lon. blockedInfo works in the frame's EN plane and `unknownAt` rejects anything
        // whose e/n are not finite - so lat/lon makes every reach answer "unknown", both arms come back null,
        // and the check passes on nothing. The first draft did exactly that, which is why there is a CONTROL
        // arm here: the fallback must reach the shoal at all before refusing it means anything.
        () => {
          const shoalR = [{e:-60,n:-20},{e:-20,n:-20},{e:-20,n:20},{e:-60,n:20}];
          const pierR  = [{e:0,n:-10},{e:20,n:-10},{e:20,n:10},{e:0,n:10}];
          const shoal = {ring: shoalR, bb: bbOf(shoalR), kind: "a shoal"};
          const pier  = {ring: pierR,  bb: bbOf(pierR),  kind: "a dock / pier"};
          const one = {polys: [shoal], lines: [], points: [], marks: [], sys: [], chans: []};
          // the reviewer's own scene: a second feature well inside the clearance the ladder measured
          const two = {polys: [shoal, pier], lines: [], points: [], marks: [], sys: [], chans: []};
          const far = {e: 4000, n: 4000};        // nothing at the entry point
          const atBoat = {e: -40, n: 0};         // inside the shoal: the fallback finds it
          const control  = chartedHerPoly(far, one, 3, atBoat, 60, null);              // nothing else near: named
          const ambig    = chartedHerPoly(far, two, 3, atBoat, 60, null);              // two inside the reach
          const mismatch = chartedHerPoly(far, one, 3, atBoat, 60, "a dock / pier");   // the ladder said a pier
          const match    = chartedHerPoly(far, one, 3, atBoat, 60, "a shoal");         // the ladder said the shoal
          return control === shoal && ambig === null && mismatch === null && match === shoal;
        },
        () => {
          const shoalR = [{e:-60,n:-20},{e:-20,n:-20},{e:-20,n:20},{e:-60,n:20}];
          const pierR  = [{e:0,n:-10},{e:20,n:-10},{e:20,n:10},{e:0,n:10}];
          const shoal = {ring: shoalR, bb: bbOf(shoalR), kind: "a shoal"};
          const pier  = {ring: pierR,  bb: bbOf(pierR),  kind: "a dock / pier"};
          const mk = (ps) => ({polys: ps, lines: [], points: [], marks: [], sys: [], chans: []});
          const far = {e: 4000, n: 4000}, atBoat = {e: -40, n: 0};
          const say = (ko, k) => { const r = chartedHerPoly(far, ko, 3, atBoat, 60, k); return r ? r.kind : "none"; };
          return "alone: " + say(mk([shoal]), null)
               + "; with a pier 40 m off as well: " + say(mk([shoal, pier]), null)
               + "; ladder said 'a dock / pier' -> " + say(mk([shoal]), "a dock / pier")
               + "; ladder said 'a shoal' -> " + say(mk([shoal]), "a shoal");
        });
  // ⚠⚠ 5l2. AND WHERE THE FALLBACK NAMED IT, THE EPISODE SAYS SO (2026-11-03, the third review). The ambiguity
  // test above refuses a near-tie, which is all a distance can do; it cannot turn "nearest" into "the cause".
  // The entry reach CAN - it looks under her projected track, which is the water the rung acted on - so the two
  // reaches are no longer interchangeable in what they entitle the console to assert. chartedHerPoly reports
  // which one answered, and aisAvoidOpen appends the hedge to `kind`, where the held bar, the flash note, both
  // banners, the Intent card and the session log all read it: one edit, and none of those surfaces can be left
  // behind saying more than the code established.
  {
    const shoalR = [{e:-60,n:-20},{e:-20,n:-20},{e:-20,n:20},{e:-60,n:20}];
    const shoal = {ring: shoalR, bb: bbOf(shoalR), kind: "a shoal"};
    const one = {polys: [shoal], lines: [], points: [], marks: [], sys: [], chans: []};
    const atShoal = {e: -40, n: 0};                  // the ENTRY point is inside it: the entry reach answers
    const far = {e: 4000, n: 4000};                  // nothing at the entry point: only the fallback can
    const byEntry = {}, byNear = {};
    const fEntry = chartedHerPoly(atShoal, one, 3, atShoal, 60, null, byEntry);
    const fNear  = chartedHerPoly(far, one, 3, atShoal, 60, null, byNear);
    check("5l2. ... and chartedHerPoly reports WHICH REACH named the feature, so the episode can hedge a name "
          + "the code did not establish: the entry reach looks under her projected track and names a cause, the "
          + "boat-position fallback answers with the nearest thing and says it is the nearest",
          () => fEntry === shoal && byEntry.fromEntry === true
                && fNear === shoal && byNear.fromEntry === false,
          () => "entry reach: " + (fEntry && fEntry.kind) + " fromEntry " + byEntry.fromEntry
              + "; fallback: " + (fNear && fNear.kind) + " fromEntry " + byNear.fromEntry);
  }
  // and the whole way through: a scene the FALLBACK names carries the hedge into the episode's own kind
  {
    const DOCK_ABEAM = (() => {
      const r = [{e: 18, n: -40}, {e: 34, n: -40}, {e: 34, n: -2}, {e: 18, n: -2}];
      return {polys: [{ring: r, bb: bbOf(r), kind: "a dock / pier"}],
              lines: [], points: [], marks: [], sys: [], chans: []};
    })();
    surveying(6, [], { ko: DOCK_ABEAM });
    S.status.cog_deg = 135; S.status.heading_deg = null;      // standing into it: the straight projection
    frame();
    const epEntry = aisAvoid && aisAvoid.kind;
    check("5l3. ... and the hedge rides the episode's KIND, so every surface and the session log inherit it from "
          + "one place: a feature the projected track found is named plainly, and nothing in the page has to "
          + "remember to qualify it",
          () => !!epEntry && /dock|pier/i.test(epEntry) && !/nearest charted feature/.test(epEntry),
          () => "episode kind '" + epEntry + "'");
  }
}

// ── 6. A CONTACT THAT STOPS ON THE LINE NEVER CLEARS IT ──────────────────────────────────
{
  const parked = contact(30, 0, { sog: 0, cog: null, heading: 90 });   // 30 x 8, sitting across the line 30 m ahead
  // ⚠ WITH NO WAY ROUND HER, WHICH IS WHAT THIS BLOCK NEEDS NOW (2026-11-01). The console maneuvers on
  // the first station frame, so a contact parked on the line is routed round at once (check 2) - and this
  // block's two subjects are the RETURN that must never fire for her and the stale feed that must not
  // release her, both of which want her still HOLDING. So WALLS_NWR and a router that finds nothing:
  // the try is made, finds nothing, and she holds.
  surveying(7, [parked], { ko: WALLS_NWR() }); frame();
  const heldFor = !!aisAvoid;
  nowHolding(); sent = []; pinCalls = [];
  pinNext = NO_ROUTE;
  frame(); await settle();                          // the first station frame: the try, and it finds nothing
  check("6. a contact stopped ON the line ahead holds her and never clears the line - with no way round her the console's try finds nothing, so nothing is sent and the episode still stands",
        () => heldFor && !!aisAvoid && aisAvoid.clearSince === 0 && sent.length === 0 && pinCalls.length === 1,
        () => "episode " + JSON.stringify(aisAvoid) + ", sent " + JSON.stringify(paths()) + ", router asked " + pinCalls.length);
  // THE FEED GOES QUIET WHILE SHE HOLDS. The model empties, and an empty model reads "clear of the
  // line" - which is a dead feed read as a quiet sea, the fault this console has met before. The first
  // draft of the return fired here; this check is why it does not.
  clock += 50000; frame(); clock += 4100; frame(); await settle();
  check("6c. the feed goes STALE while she holds for her: the return does NOT fire on an empty model - she keeps holding, and the blind banner says why",
        () => !!aisAvoid && aisAvoid.clearSince === 0 && sent.length === 0 && aisKoStale === true
              && banners.some(b => /AIS KEEP-OUTS BLIND/.test(b)),
        () => "episode " + JSON.stringify(aisAvoid) + ", sent " + JSON.stringify(paths()) + ", stale " + aisKoStale
            + ", banners " + JSON.stringify(banners.filter(b => /BLIND/.test(b))));
  pinNext = null;                                   // the router answers again; the return does not ask it anyway
  aisVessels = [contact(30, 80, { sog: 0, cog: null, heading: 90 })];    // the feed is back, and she has moved off the line
  aisPolledAt = clock;
  frame(); clock += 4100; aisPolledAt = clock; frame(); await settle();
  const up6b = sent.find(x => x.p === "/api/cmd/upload"), rte6b = (up6b && up6b.route) || [];
  check("6b. ... and when the feed answers again with her off the line, the RETURN goes - 100 m back down the line, not the way round from where she left it",
        () => paths().includes("/api/cmd/upload") && paths().includes("/api/cmd/start") && aisAvoid === null
              && rte6b.length > 0 && distTo(rte6b[0], ll(-100, 0)) < 1,
        () => "sent " + JSON.stringify(paths()) + "; rejoin " + (rte6b[0] ? distTo(rte6b[0], ll(-100, 0)).toFixed(1) + " m from the 100 m point" : "none"));
}

// ── 7. NO DEVIATION AROUND A CONTACT (the charted twin DOES deviate) ─────────────────────
{
  // A 20 x 8 m block whose south side is 1 m north of the line, 40 m ahead: inside the 3 m buffer, so a few meters of
  // dog-leg south clears it. (guard_resume's deviating() corner, 113 m along its route, was this check's fixture until
  // 2026-09-29 - as a contact that far off she is outside the guard's 50 m reach and the ladder reads clear; nearer
  // than 50 m that corner is held, not deviated, charted or not. Probed: scratchpad/probe_check7b_0929.js.)
  const r7 = [{ e: 40, n: 1 }, { e: 60, n: 1 }, { e: 60, n: 9 }, { e: 40, n: 9 }];
  const block = { polys: [{ ring: r7, bb: bbOf(r7), kind: "a dock / pier" }], lines: [], points: [], marks: [], sys: [], chans: [] };
  function deviating(ko, vessels) {
    surveying(7, vessels, { ko });
    edgeSpentM = 0;                                  // the deviation budget is UNSPENT here
    edgeSearchAt = 0;                                // ... and the search due: the frames here share one clock instant
  }
  deviating(block, []); frame();
  const charted = clearance.level, chartedSent = paths().slice();
  // the same 20 x 8 m footprint as a contact: a 20 x 8 m hull heading east, antenna amidships, 40 m off - in reach
  const hull = contact(50, 5, { sog: 0, cog: null, heading: 90, dim: { a: 10, b: 10, c: 4, d: 4 }, length: 20, beam: 8 });
  deviating(OPEN, [hull]); frame();
  check("7. the same block as a charted pier is DEVIATED around; as a contact it is not - the ladder answers with slow or hold instead",
        () => charted === "edge" && chartedSent.includes("/api/cmd/amend")
              && clearance.level !== "edge" && !paths().includes("/api/cmd/amend")
              && (clearance.level === "slow" || clearance.level === "hold"),
        () => "charted: " + charted + " " + JSON.stringify(chartedSent) + "; contact: " + clearance.level + " " + JSON.stringify(paths()));
  // 7b. ... and a contact OUTSIDE the reach does not stand the edge rung down (2026-09-29): the same charted block, with a
  //     workboat parked 100 m off the line - known, drawn, measured, but not yet the ladder's - is still deviated round
  deviating(block, [contact(120, 40, { sog: 0, cog: null, heading: 90 })]); frame();
  check("7b. ... and a contact OUTSIDE the guard's reach does not stand the edge rung down: the same charted block with a workboat parked 100 m off is still DEVIATED round - the stand-down is for a contact the ladder is answering",
        () => clearance.level === "edge" && paths().includes("/api/cmd/amend"),
        () => "level " + clearance.level + ", sent " + JSON.stringify(paths()));
}

// ── 8. A STALE FEED IS AN EMPTY MODEL THAT SAYS SO ───────────────────────────────────────
{
  surveying(7, [CROSSING()], { polledAt: clock - 50000 });
  frame();
  check("8. a poll 50 s old models NO contacts - the crossing workboat does not hold her - and the model says it is stale",
        () => !paths().includes("/api/cmd/hold") && clearance.level === "clear" && aisKoStale === true && aisKoDrawn.length === 0
              && /50 s old/.test(aisKoNote),
        () => "level " + clearance.level + ", sent " + JSON.stringify(paths()) + ", stale " + aisKoStale + ": " + aisKoNote);
  check("8b. ... not said on the first frame (the feed has AIS_KO_STALE_S to answer)",
        () => !banners.some(b => /AIS KEEP-OUTS BLIND/.test(b)), () => JSON.stringify(banners));
  clock += 41000; frame();
  check("8c. ... and after AIS_KO_STALE_S under way with no answer, it IS said - once - as a banner",
        () => banners.filter(b => /AIS KEEP-OUTS BLIND/.test(b)).length === 1 && (frame(), banners.filter(b => /AIS KEEP-OUTS BLIND/.test(b)).length === 1),
        () => JSON.stringify(banners));
  const blindAtSay = aisKoBlind;
  aisPolledAt = clock; frame();
  check("8d. ... and the feed's return is a note, and the contact is modelled again",
        () => notes.some(n => /AIS keep-outs restored/.test(n)) && aisKoDrawn.length === 1 && aisKoStale === false,
        () => JSON.stringify(notes) + "; modelled " + aisKoDrawn.length);
  check("8e. BLIND is the narrower fact than STALE, and the banner and the way round ask the SAME one: the "
        + "console wanted the contacts and the feed has had its grace period. `stale` alone is also true of a "
        + "console that has never polled - AIS off, or the service down - which is why the charted way round "
        + "could not be keyed on it without disabling itself wherever AIS is absent",
        () => blindAtSay === true && aisKoBlind === false && aisKoStale === false
              && /^\s*let aisKoBlind = false;/m.test(H),
        () => "blind while the banner was up " + blindAtSay + ", blind after the feed returned " + aisKoBlind
            + ", stale " + aisKoStale + ", declared in the page "
            + ((H.match(/^\s*let aisKoBlind = [^;]*;/m) || ["(NOT FOUND - renamed?)"])[0]).trim());
}

// ── 8f-8h. A CHARTED WAY ROUND ON A BLIND MODEL: PERFORMED, AND THE CLAIM WITHHELD ───────
// ⚠⚠ CAUGHT BY ADVERSARIAL REVIEW (2026-11-02). The staleness gate was scoped to contact episodes with the
// argument that "a dead AIS feed says nothing about a pier" - true of the HAZARD, and false of the WATER. With
// the model blind, aisKeepoutsNow() returns [], so `others` carries no contacts and the pick-up and the way in
// were certified "clear of traffic" by a model that cannot know, under the console's own AIS KEEP-OUTS BLIND
// banner: the wrong water, measured confidently.
// ⚠ THE ANSWER IS TO WITHHOLD THE CLAIM, NOT THE MANEUVER, and that is a judgement rather than an oversight.
// Refusing would reinstate the indefinite wait he asked to remove on every AIS outage, and - because
// aisKeepouts answers `stale: true` on `polledAt == 0` - would disable the charted maneuver outright wherever
// AIS is off or its service is down. The pick-up is a point further along HER OWN PLAN, which was routed
// against the chart and never against moving contacts; the operator's own resume would take her through the
// same water with the same blindness. So the risk is not created here. The false certification was.
{
  const dRing = [{e:40,n:-12},{e:70,n:-12},{e:70,n:12},{e:40,n:12}];
  const DOCK = {polys: [{ring: dRing, bb: bbOf(dRing), kind: "a dock / pier"}],
                lines: [], points: [], marks: [], sys: [], chans: []};
  // (a) the feed BLIND: a poll 50 s old, with the grace period already elapsed.
  // ⚠ THE GRACE IS SEEDED, NOT WAITED OUT BY JUMPING THE CLOCK. The first draft ran a frame, advanced the clock
  // 41 s and ran another - and the held record EXPIRED across that jump, so `guardHeld` was null, the tick
  // answered "nothing is held for a contact" and the check failed with the feature working perfectly. The
  // instrument found it in one run. `aisKoWantedAt` is what the blind test measures against, so setting it is
  // the honest way to put the console in the state where it has already declared itself blind.
  surveying(6, [], { ko: DOCK, polledAt: clock - 50000 });
  S.status.cog_deg = 90; S.status.heading_deg = 90;
  aisKoWantedAt = clock - 50000;
  frame();
  const blind = aisKoBlind, chartedBlind = !!(aisAvoid && aisAvoid.chart), heldBlind = !!guardHeld;
  nowHolding(); sent = []; banners = []; notes = []; logged = [];
  frame(); await settle();
  const sentBlind = paths().slice(), laBlind = logged.find(e => e.kind === "ais_around");
  check("8f. with the AIS model BLIND a charted way round still goes - refusing it would be the indefinite wait "
        + "again, and on a console with AIS off it would never run at all",
        () => blind === true && chartedBlind && heldBlind
              && sentBlind.includes("/api/cmd/upload") && laBlind && laBlind.data.skip_m > 50,
        () => "blind " + blind + ", charted " + chartedBlind + ", held " + heldBlind
            + ", sent " + JSON.stringify(sentBlind) + ", skip_m " + (laBlind && laBlind.data.skip_m));
  check("8g. ... and it does NOT claim the traffic check it could not make: the banner, the note and the session "
        + "log all say the pick-up and the way in were judged against the CHART alone",
        // ⚠ MATCHED AGAINST THE SENTENCE THE CONSOLE ACTUALLY PRINTS. The first draft looked for "not checked
        // against traffic"; the note reads "NEITHER the pick-up NOR the way back in WAS checked against
        // traffic", so the check was stricter than the text and failed on correct behavior.
        () => banners.some(b => /the AIS model is BLIND/.test(b)
                                && /neither the pick-up nor the way (back in|in) was checked against traffic/.test(b)
                                && /the charted keep-outs were/.test(b))
              && laBlind && laBlind.data.blind_traffic === true,
        () => "banners " + JSON.stringify(banners) + ", logged blind_traffic " + (laBlind && laBlind.data.blind_traffic));
  // (b) the control: a healthy feed makes no such claim, or the sentence would be noise on every run
  surveying(6, [], { ko: DOCK });
  S.status.cog_deg = 90; S.status.heading_deg = 90; frame();
  nowHolding(); sent = []; banners = []; logged = [];
  frame(); await settle();
  const laOk = logged.find(e => e.kind === "ais_around");
  check("8h. ... and a HEALTHY feed says nothing of the kind - a caveat printed on every run is a caveat nobody "
        + "reads - while a CONTACT's way round is still refused outright on a stale feed, because the hazard "
        + "itself is the thing the model cannot locate (check 6)",
        () => aisKoBlind === false
              && banners.every(b => !/AIS model is BLIND/.test(b))
              && laOk && laOk.data.blind_traffic === false,
        () => "blind " + aisKoBlind + ", logged blind_traffic " + (laOk && laOk.data.blind_traffic)
            + ", banners " + JSON.stringify(banners.map(b => b.slice(0, 60))));
}

// ── 9. THE HELM: A CONTACT BEARING DOWN, AND THE MODEL THE ESCAPE SEARCHES ───────────────
{
  // northbound at 6 kn, 40 m south of the boat: her sweep already covers where the boat is.
  surveying(7, [contact(0, -40, { sog: 6, cog: 0, heading: 0 })]);
  escFake = { hdg: 90, to: { e: 60, n: 0 }, m: 60, capped: false, clear: true, survived: 45, worst: 30, gain: 30 };
  frame();
  const first = clearance.level;
  clock += 1600; const r9 = frame();                 // past HELM_DWELL_MS: the rung acts
  check("9. a contact bearing down reads IN EXTREMIS, and after the dwell the escape is commanded",
        () => first === "helm" && paths().includes("/api/cmd/escape") && !r9.raised,
        () => "first frame " + first + ", sent " + JSON.stringify(paths()) + (r9.raised ? "; RAISED " + r9.raised : ""));
  check("9b. ... the escape's search was handed the model WITH the contact in it (koAll), never the charted one alone",
        () => !!escKo && escKo.polys.some(q => kindRe.test(q.kind)),
        () => escKo ? escKo.polys.length + " polys: " + JSON.stringify(escKo.polys.map(q => q.kind)) : "escapeCourse never asked");
  check("9c. ... and the episode opens on the helm rung too, with the survey banked",
        () => !!aisAvoid && aisAvoid.rung === "helm" && !!guardHeld && notes.some(n => /Steered clear of AIS: WORKBOAT/.test(n)),
        () => "episode " + JSON.stringify(aisAvoid) + ", banked " + !!guardHeld + ", notes " + JSON.stringify(notes));
  // Andy, 2026-09-27: "an avoidance maneuver of a radius equal to the length or the estimated length of the vessel"
  // ⚠⚠ 9e. AND THE AVOIDING FLAG GOES UP ON THE HELM RUNG (2026-11-02). The escape is the console
  // taking the helm on its own authority - the furthest it goes - so it is the clearest case the flag is for.
  // The raise sits AFTER setPlanIntent("escape", ...) on purpose: an escape IS a new commanded motion, and
  // setPlanIntent clears the flag, so a raise before it would clear itself. Verified by mutation - moving
  // the raise above setPlanIntent, or deleting it, reddens this.
  // ⚠⚠ ASKED THROUGH avoidingNow() AND IN THE STATE THE RUNG FIRES IN, WHICH IS THE ONLY FORM THAT WOULD HAVE
  // CAUGHT THE DEFECT REVIEW FOUND (2026-11-02). This check asserted the RAW `avoiding` record, and the record
  // was always set correctly - what was broken was the reader: `avoidingNow()` lowered on
  // `runLineIdx >= 0 && lineSwing < 0`, which is precisely the state a surveying boat on a coverage line is in
  // when the helm rung fires, so the badge was erased by the next updateMissionCard() and NEVER APPEARED for an
  // in-extremis escape. Asserting the record proved the raise and said nothing about whether the operator would
  // ever see it. So the scene is set to on-a-line deliberately - `runLineIdx = 0, lineSwing = -1` - and the
  // badge is read off the DOM through the reader both surfaces use. Re-introducing any lowering keyed on where
  // she is rather than on what the console did reddens this.
  runLineIdx = 0; lineSwing = -1;        // a surveying boat ON her line: the state the escape is commanded from
  const seen9 = avoidingNow();
  renderAvoiding();
  check("9e. ... and the AVOIDING flag goes up and is VISIBLE, reading STEERED CLEAR and naming her - through "
        + "avoidingNow, in the on-a-line state the rung fires in, and surviving setPlanIntent's own clear "
        + "because the raise comes after it",
        () => !!seen9 && seen9.why === "steered clear" && /WORKBOAT/.test(seen9.kind)
              && /AVOIDING/.test(EL["#r_avoid"].textContent || "")
              && /STEERED CLEAR OF/.test(EL["#r_avoid"].textContent || "")
              && EL["#r_avoid"].style.display === "block",
        () => "reader " + JSON.stringify(seen9) + ", badge "
            + JSON.stringify(EL["#r_avoid"] && EL["#r_avoid"].textContent)
            + " display " + (EL["#r_avoid"] && EL["#r_avoid"].style.display));
  check("9d. ... and the model the escape searches is the AVOIDANCE model - her hull grown by her own length (30 m here), so the point it steers to is a ship-length clear of her",
        () => !!escKo && escKo.polys.length === 1 && escKo.polys[0].avoidM === 30 && /30 m round her/.test(escKo.polys[0].kind),
        () => escKo ? JSON.stringify(escKo.polys.map(q => [q.kind, q.avoidM])) : "escapeCourse never asked");
}

// ── 10. A GO-TO STOPPED FOR A CONTACT IS BANKED LIKE A SURVEY (2026-09-29) ─────────────────
{
  // Until 2026-09-29 it banked nothing and simply held, for the operator to re-command her. Andy: "the avoidance
  // maneuver used on survey lines for avoidance of AIS contact should have identical avoidance behavior when running a
  // GOTO, RTH or transit line". This is the bank, on the frame the hold goes out; its way round and its return are 23.
  surveying(7, [CROSSING()], { behavior: "goto" }); frame();
  check("10. a Go-To held for a contact banks the LEG - its route, where she stopped, the command it was flown by, no line mark - and opens the episode, as a survey does",
        () => paths().includes("/api/cmd/hold") && !!guardHeld && !!guardHeld.leg && guardHeld.leg.behavior === "goto"
              && guardHeld.mark === null && guardHeld.idx === 1 && !!aisAvoid && aisAvoid.line === null
              && notes.some(n => /Holding for AIS: WORKBOAT/.test(n) && /the Go-To carries on by itself/.test(n)),
        () => "sent " + JSON.stringify(paths()) + ", banked " + JSON.stringify(guardHeld && { leg: guardHeld.leg, mark: guardHeld.mark, idx: guardHeld.idx })
            + ", episode " + JSON.stringify(aisAvoid) + ", notes " + JSON.stringify(notes));
}

// ── 11. THE READOUT MEASURES AGAINST THE CONTACTS TOO ────────────────────────────────────
{
  surveying(7, [contact(0, 14, { sog: 0, cog: null, heading: 90 })]);   // 30 x 8 heading east, her side 10 m north of the boat
  frame();
  const near = clearance.m;
  surveying(7, [contact(0, 6, { sog: 0, cog: null, heading: 90 })]);    // her side 2 m north: inside the buffer
  frame();
  check("11. the clearance readout measures to the contact's hull (10 m off her side reads 10 m), and inside the buffer names her",
        () => Math.abs(near - 10) < 0.1 && clearance.m < 3 && clearance.kind && /^AIS: WORKBOAT/.test(clearance.kind),
        () => "10 m case " + (near == null ? "null" : near.toFixed(2)) + " m; 2 m case " + (clearance.m == null ? "null" : clearance.m.toFixed(2)) + " m, kind " + clearance.kind);
  surveying(7, []); frame();
  check("11b. ... and with no contacts the readout is open water, as it always was",
        () => clearance.m === __clearCap() && clearance.kind === null, () => clearance.m + " m of " + __clearCap() + ", kind " + clearance.kind);
}

// ── 13-15. A CONTACT THAT STAYS: THE THREE ANSWERS (Andy, 2026-09-27) ────────────────────────
// KLEOS sat across line 8 at New Castle and the survey held for her; his pause then SPENT the banked
// survey, and "Resume from here" had nowhere to go. His three: (1) the same line where she left it -
// refused, she would meet the contact again; (2) the operator's point BEYOND the contact - routed round
// her, the survey continues from there; (3) no answer in 60 s - 30 s since 2026-09-28, at his word after FRIGGA -
// the console routes round her itself, as if
// she were a buoy or a dock, and carries on. A contact that clears the line first keeps the 100 m return
// (check 3). Never on a stale model, never while paused, not twice inside the spacing between tries.
const PARKED = () => contact(30, 0, { sog: 0, cog: null, heading: 90 });   // 30 x 8 across the line: her hull is e = 15..45
const nearRe = /WORKBOAT/;
// THE WAY ROUND'S GEOMETRY (2026-09-28). A way round is uploaded or amended as [...via, rejoin, then the plan's own
// remainder] - the taut way round her in front of the rejoin point - so these read it from the END, and measure how
// close the way in comes to a point (her center) and to a polygon (her hull), every half meter along it.
const PARKED_C = { e: 30, n: 0 };                                                // her center
const parkedHull = () => aisKeepouts([PARKED()], ref, { now: clock, polledAt: clock, sweepS: 45 }).polys[0];
const rejoinOf = (rte, tail = 3) => rte[rte.length - 1 - tail];                 // tail: waypoints of the remainder after it
const viaOf = (rte, tail = 3) => rte.slice(0, Math.max(0, rte.length - 1 - tail));
function alongPts(pts, fn) {
  let m = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = ref.toEN(pts[i - 1]), b = ref.toEN(pts[i]), n = Math.max(1, Math.ceil(Math.hypot(b.e - a.e, b.n - a.n) / 0.5));
    for (let k = 0; k <= n; k++) { const t = k / n; m = Math.min(m, fn({ e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t })); }
  }
  return m;
}
const minDistTo = (pts, c) => alongPts(pts, (p) => Math.hypot(p.e - c.e, p.n - c.n));
const minClearTo = (pts, poly) => alongPts(pts, (p) => clearanceM(p, { polys: [poly], lines: [], points: [] }, 500));
const wayInOf = (rte, from, tail = 3) => [from, ...viaOf(rte, tail), rejoinOf(rte, tail)];
{
  // 13. THE OFFER SURVIVES A PAUSE, AND THE BAR SAYS THE CONSOLE WAITS
  surveying(7, [PARKED()]); frame(); nowHolding();
  const kept = guardHeld;
  S.run = "paused";
  const pausedOffer = guardHeldOffer();
  clock += 61000; aisPolledAt = clock; sent = []; frame(); await settle();
  renderGuardBar({ level: "blind" }, clearance);
  const pausedWhy = $("#gb_why").textContent;
  check("13. a PAUSED hold keeps the guard's offer - the survey she was holding is not what the pause changed - and neither return fires while she is paused; the bar says the console waits",
        () => !!kept && pausedOffer === kept && guardHeld === kept && sent.length === 0 && !!aisAvoid
              && /once you resume the hold/.test(pausedWhy),
        () => "offer " + (pausedOffer ? "stands" : "GONE") + ", sent " + JSON.stringify(paths()) + ", bar: " + pausedWhy);
  // 13c. ... AND THE RETURN WAITS TOO: she clears the line while the boat is paused - nothing; resume the hold - the return goes
  aisVessels = [contact(30, 90, { sog: 0, cog: null, heading: 90 })]; aisPolledAt = clock;   // moved 90 m north, off the line
  frame(); clock += 4100; aisPolledAt = clock; frame(); clock += 4100; aisPolledAt = clock; frame(); await settle();
  const whilePaused = paths().slice();
  S.run = "running";
  frame(); clock += 4100; aisPolledAt = clock; frame(); await settle();
  check("13c. ... and the 100 m return waits while she is paused too, however clear the line reads - and goes once the hold is resumed",
        () => whilePaused.length === 0 && paths().includes("/api/cmd/upload") && paths().includes("/api/cmd/start") && aisAvoid === null,
        () => "paused: sent " + JSON.stringify(whilePaused) + "; resumed: sent " + JSON.stringify(paths()));

  // 13b. THE BAR NAMES THE OTHER TWO ANSWERS, AND SAYS "NOW" - THERE IS NO COUNT LEFT TO MAKE (2026-11-01)
  surveying(7, [PARKED()]); frame(); nowHolding();
  renderGuardBar({ level: "blind" }, clearance);    // on station, before any try: nothing to count down to
  const why23 = $("#gb_why").textContent;
  check("13b. ... running, the bar says what she is holding for, that the way back is the console's, that the operator may right-click the line BEYOND her, and that the console routes round her itself NOW - with no seconds in it, because none are waited out",
        () => /holding for AIS: WORKBOAT/.test(why23) && /resumes on its own/.test(why23) && /100 m back/.test(why23)
              && /right-click the line BEYOND her/.test(why23) && /routes round her itself now/.test(why23)
              && !/routes round her itself in \d+ s/.test(why23),
        () => why23);
}
{
  // 14. OPTION 3: THE CONSOLE ROUTES ROUND HER, AND SINCE 2026-11-01 WITHOUT WAITING FOR ANYBODY
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  const at20 = paths().slice();                     // on station, before the frame: nothing has been sent
  frame(); await settle();
  const up = sent.find(x => x.p === "/api/cmd/upload"), rte = (up && up.route) || [];
  const ask = pinCalls[pinCalls.length - 1];
  check("14. with her still across the line, the console routes round her on the first frame she is on station - no wait: pause, upload, LOW, Start - and nothing before that frame",
        () => at20.length === 0 && paths().indexOf("/api/cmd/pause") === 0
              && paths().indexOf("/api/cmd/pause") < paths().indexOf("/api/cmd/upload")
              && paths().indexOf("/api/cmd/upload") < paths().indexOf("/api/cmd/start"),
        () => "before the station frame: " + JSON.stringify(at20) + "; on it: " + JSON.stringify(paths()));
  // A SHIP-LENGTH ROUND HER (Andy, 2026-09-27): the rejoin clears her hull by her own length, not by the standoff alone
  const rj14 = rejoinOf(rte), via14 = viaOf(rte), wayIn14 = wayInOf(rte, ll(0, 0));
  check("14b. ... the upload picks the line up at the first point BEYOND her that is clear of her maneuver ring by the standoff (e = 65: a ship-length about her center reaches e = 60, the 5 m walk's next step is 65 - it was e = 80 while her HULL was grown by her length and the standoff added outside that), the taut way round in front of it, then the remainder",
        () => rte.length >= 5 && via14.length >= 1 && distTo(rj14, ll(65, 0)) < 0.5 && distTo(rte[rte.length - 3], LINE_E.b) < 0.5 && distTo(rte[rte.length - 1], ll(-200, 60)) < 0.5,
        () => rte.length + " wpts; rejoin " + (rj14 ? distTo(rj14, ll(65, 0)).toFixed(1) + " m from (65, 0)" : "none") + ", via " + via14.length);
  const dC14 = minDistTo(wayIn14, PARKED_C), dH14 = minClearTo(wayIn14, parkedHull());
  check("14c. ... and the way in is the TAUT way round her ring: never nearer her center than her own length (30 m) and no more than a meter and a half beyond it, at least the standoff plus the buffer off her hull - with no call on the router's grid search",
        () => dC14 >= 30 - 0.05 && dC14 <= 31.5 && dH14 >= 6 - 0.05 && pinCalls.length === 0,
        () => "closest to her center " + dC14.toFixed(2) + " m, to her hull " + dH14.toFixed(2) + " m; router calls " + pinCalls.length);
  check("14d. ... with none of the operator's latches, the record spent, the episode closed, said WITHOUT WAITING and recorded as ais_around with what was left under her and nought seconds held",
        () => guardOverride === null && resumeSlow === false && guardHeld === null && aisAvoid === null && S.run === "running"
              && banners.some(b => /ROUTED ROUND/.test(b) && nearRe.test(b) && /65 m of coverage left under/.test(b))
              && banners.some(b => /she was still in the way, so the survey goes on beyond her without waiting/.test(b))
              && logged.some(e => e.kind === "ais_around" && e.data.skip_m === 65 && e.data.line === 1 && e.data.skip_line === false && e.data.held_s === 0
                                  && e.data.mmsi === 338111222 && e.data.round_m === 30 && e.data.std_m === 3),
        () => "override " + JSON.stringify(guardOverride) + ", resumeSlow " + resumeSlow + ", episode " + JSON.stringify(aisAvoid)
            + ", banners " + JSON.stringify(banners.filter(b => /ROUTED/.test(b))) + ", logged " + JSON.stringify(logged.filter(e => e.kind === "ais_around")));

  // 14e. SHE CLEARS THE LINE WHILE THE BOAT STILL HAS WAY ON: NEITHER ANSWER IS REACHED AT ALL
  // ⚠ THE CASE THE WAY ROUND IS NOT FOR, AND THE RETURN IS NOT FOR EITHER. The hold is commanded and the
  // boat begins to stop; the contact passes before she is on station; the guard's own clear branch reads
  // a boat with way on in clear water, releases, and spends the banked record - so there is nothing left
  // for either answer to resume, and the survey simply carries on. No upload, and no episode.
  surveying(7, [CROSSING()]); frame(); sent = []; logged = []; notes = [];
  const her2 = (t) => { aisVessels = [contact(34, -5 + 3.087 * t, { sog: 6, cog: 0, heading: 0 })]; aisPolledAt = clock; };
  clock += 8000; her2(8); frame(); await settle();   // she crosses while the boat still has way on
  const releasedAt = sent.length;
  clock += WHILE_MS + 1000; her2(12.1 + WHILE_S + 1); frame(); await settle();
  check("14e. a contact that clears the line while the boat still has WAY ON needs no answer: the guard releases her, the banked record is spent, and neither the way round nor the 100 m return is reached - no upload, however long after",
        () => !paths().includes("/api/cmd/upload") && guardHeld === null && aisAvoid === null
              && sent.length === releasedAt
              && !logged.some(e => e.kind === "ais_around" || e.kind === "ais_return"),
        () => "sent " + JSON.stringify(paths()) + ", record " + (guardHeld ? "kept" : "spent") + ", episode "
            + JSON.stringify(aisAvoid) + ", later commands " + (sent.length - releasedAt)
            + ", logged " + JSON.stringify(logged.map(e => e.kind)));

  // 14f. STALE: NOTHING, HOWEVER LONG
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = [];
  clock += 61000; frame(); await settle();          // no poll answered for 61 s: the model is stale and EMPTY
  check("14f. a stale feed gets no way round either, however long she has held - an empty model is not a clear line (aisReturnTick's rule)",
        () => aisKoStale === true && sent.length === 0 && !!aisAvoid,
        () => "stale " + aisKoStale + ", sent " + JSON.stringify(paths()) + ", episode " + (aisAvoid ? "open" : "closed"));

  // 14g. SHE COVERS THE REST OF THE LINE: THAT LINE IS LEFT, THE PLAN PICKED UP AT ITS NEXT WAYPOINT
  const LONG = contact(115, 0, { sog: 0, cog: null, heading: 90, dim: { a: 100, b: 100, c: 4, d: 4 }, length: 200, beam: 8 });   // e = 15..215
  surveying(7, [LONG]); frame(); nowHolding(); sent = []; logged = []; banners = [];
  clock += 61000; aisPolledAt = clock; frame(); await settle();
  const up2 = sent.find(x => x.p === "/api/cmd/upload"), rte2 = (up2 && up2.route) || [];
  check("14g. a contact covering the rest of the line: that line is LEFT and the plan is picked up at the waypoint after its end - said, and recorded as skip_line",
        () => rte2.length === 2 && distTo(rte2[0], ll(200, 60)) < 0.5 && distTo(rte2[1], ll(-200, 60)) < 0.5
              && banners.some(b => /ROUTED ROUND/.test(b) && /is covered by/.test(b) && /picked up at its next waypoint/.test(b))
              && logged.some(e => e.kind === "ais_around" && e.data.skip_line === true),
        () => rte2.length + " wpts: " + JSON.stringify(rte2.map(p => { const q = llEN(p.lat, p.lon, ref); return [Math.round(q.e), Math.round(q.n)]; }))
            + "; " + JSON.stringify(banners.slice(-1)));

  // ⚠⚠ 14h. NO WAY ROUND: SAID ONCE, STILL HOLDING, AND ASKED AGAIN WHEN THE MODEL MOVES - NOT ON A CLOCK AND
  // NOT EVERY FRAME (rewritten 2026-11-02 for "Delete that"). There is no timing left in this file at all. The
  // gate is the MODEL: a refused try records {polled, ko, route, idx}, and the next goes on the first frame one
  // of them differs. ⚠ WHY IT IS A GATE AT ALL, measured: a failed try ASKS THE ROUTER (that is what pinCalls
  // counts), planNogoRoute runs synchronously on the page's thread, and a route search there was measured at
  // 11 s and then 17.8 s - so a free-running try would wedge the page and the ladder with it. Charted walls on
  // both sides of her ring (WALLS_NWR), so the taut way round cannot be certified and the router's own search is
  // the one asked (2026-09-28: the taut path comes first now) - and the router finds nothing either.
  surveying(7, [PARKED()], { ko: WALLS_NWR() }); frame(); nowHolding(); sent = []; banners = []; pinCalls = [];
  pinNext = NO_ROUTE;
  frame(); await settle();                          // the first station frame: the first try, unspaced
  const said1 = banners.filter(b => /CANNOT RESUME FROM HERE/.test(b)).length, sent1 = paths().slice(), tries1 = pinCalls.length;
  // two more frames on the SAME model - the clock moves, nothing else does: no second try, however long she holds
  clock += 60000; frame(); await settle(); clock += 60000; frame(); await settle();
  const tries2 = pinCalls.length;
  // a fresh AIS poll: the contacts may have moved, so the answer may have changed, so it is asked
  clock += 1000; aisPolledAt = clock; frame(); await settle();
  const tries3 = pinCalls.length;
  const said3 = banners.filter(b => /CANNOT RESUME FROM HERE/.test(b)).length;
  // and a fresh CHARTED model - a new read of the same water is a NEW OBJECT, which is the whole identity test
  nogo.ko = WALLS_NWR().polys ? WALLS_NWR() : nogo.ko;
  frame(); await settle();
  const tries4 = pinCalls.length;
  pinNext = null;
  check("14h. no way round her: nothing is sent, she keeps holding with the offer and the episode standing, it is "
        + "said ONCE however many tries go, and the router is asked again only when the MODEL moves - a fresh AIS "
        + "poll or a fresh chart read - never on a clock and never at frame rate",
        () => sent1.length === 0 && said1 === 1 && tries1 === 1 && !!guardHeld && !!aisAvoid
              && tries2 === 1 && tries3 === 2 && tries4 === 3 && said3 === 1,
        () => "sent " + JSON.stringify(sent1) + ", said " + said1 + " then " + said3
            + ", router asked " + tries1 + " (first) / " + tries2 + " (after 120 s on the same model) / "
            + tries3 + " (a fresh poll) / " + tries4 + " (a fresh chart read)");
}
{
  // 15. OPTION 2: THE OPERATOR'S POINT BEYOND HER
  // ⚠ NO FRAME BETWEEN STATION AND THE PRESS, AND THAT IS NOW LOAD-BEARING (2026-11-01). With the
  // operator's wait gone the console routes round her on the first station frame, so the operator's
  // window is between frames - they press, as here, before the next telemetry report. Put a frame in
  // and the console will have answered first, which is the rule, not a fault. The operator's answer is
  // still reachable while she is PAUSED and while no way round can be found (14h), and by the button.
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  clock += 5000; aisPolledAt = clock;
  gateResumeHere(ll(120, 3));
  const rowShown = $("#cmResume").style.display !== "none", rowOff = $("#cmResume").classList.contains("off"), key = $("#cmResumeK").textContent;
  check("15. while the guard holds the survey for her, Resume from here is SHOWN and LIVE on the chart menu - the operator's answer - with the point named",
        () => rowShown && !rowOff && key === "320 m along L1",
        () => "shown " + rowShown + ", off " + rowOff + ", key '" + key + "'");
  await resumeFromHere(ll(120, 3));                 // 3 m off the line, 75 m beyond her hull
  await settle();
  const up3 = sent.find(x => x.p === "/api/cmd/upload"), rte3 = (up3 && up3.route) || [], ask3 = pinCalls[pinCalls.length - 1];
  check("15b. a point BEYOND her goes the held path: pause, upload from that point, LOW, Start - not an amendment - with the way in asked of the router with her in the model, at the standoff",
        () => !paths().includes("/api/cmd/amend") && paths().indexOf("/api/cmd/pause") === 0
              && paths().indexOf("/api/cmd/upload") < paths().indexOf("/api/cmd/start")
              && rte3.length >= 5 && distTo(rejoinOf(rte3), ll(120, 0)) < 0.5 && distTo(rte3[rte3.length - 3], LINE_E.b) < 0.5
              && pinCalls.length === 0 && minDistTo(wayInOf(rte3, ll(0, 0)), PARKED_C) >= 30 - 0.05,   // taut round her, a ship-length off her center
        () => "sent " + JSON.stringify(paths()) + "; upload " + rte3.length + " wpts from " + (rte3[0] ? distTo(rte3[0], ll(120, 0)).toFixed(1) + " m of (120,0)" : "none")
            + "; asked " + JSON.stringify(ask3 && { to: ask3.to, ko: ask3.opts && ask3.opts.ko && ask3.opts.ko.polys.length }));
  check("15c. ... with no latch (the governor has the throttle), the record spent, the episode closed, said and logged as a resume from a point on a held survey",
        () => guardOverride === null && resumeSlow === false && guardHeld === null && aisAvoid === null
              && notes.some(n => /Survey resumed from the point you chose on line 1 \(320 m along it\)/.test(n) && /transit speed/.test(n))
              && logged.some(e => e.kind === "resume" && e.data.from_point === true && e.data.held === true && e.data.along_m === 320 && nearRe.test(e.data.kind || "")),
        () => "override " + JSON.stringify(guardOverride) + ", resumeSlow " + resumeSlow + ", notes " + JSON.stringify(notes.slice(-1))
            + ", logged " + JSON.stringify(logged.filter(e => e.kind === "resume")));

  // 15d. OPTION 1: THE NEAR SIDE IS REFUSED
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; banners = []; pinCalls = [];
  clock += 5000; aisPolledAt = clock;               // between frames, as 15: the press comes first
  await resumeFromHere(ll(8, 2));                   // 7 m short of her hull: the line from there runs into her
  const nearSent = paths().slice(), nearSaid = banners.filter(b => /NEAR SIDE/.test(b));
  await resumeFromHere(ll(30, 2));                  // ON her
  const onSent = paths().slice(), onSaid = banners.filter(b => /NEAR SIDE/.test(b));
  await resumeFromHere(ll(55, 2));                  // 10 m beyond her hull, inside a ship-length of her CENTER (e = 60)
  const inLenSent = paths().slice(), inLenSaid = banners.filter(b => /NEAR SIDE/.test(b));
  check("15d. a point on the NEAR side of her, on her, or within her own length of her is refused in words - she would only be stopped again - and the refusal says the console routes round her itself NOW, there being nothing left to wait out; nothing is sent, the offer and the episode stand",
        () => nearSent.length === 0 && nearSaid.length === 1 && /routes round her itself, on every frame until it finds a way\./.test(nearSaid[0])
              && !/routes round her itself in \d+ s/.test(nearSaid[0])
              && onSent.length === 0 && onSaid.length === 2 && inLenSent.length === 0 && inLenSaid.length === 3
              && !!guardHeld && !!aisAvoid && pinCalls.length === 0,
        () => "near: sent " + JSON.stringify(nearSent) + ", " + JSON.stringify(nearSaid) + "; on her: said " + onSaid.length
            + "; within her length: sent " + JSON.stringify(inLenSent) + ", said " + inLenSaid.length);
  // 15e. THE ACCEPTANCE THAT PAIRS WITH IT (2026-09-28): 34 m from her center - past a ship-length and her standoff
  await resumeFromHere(ll(64, 2)); await settle();
  const up15e = sent.find(x => x.p === "/api/cmd/upload"), rte15e = (up15e && up15e.route) || [];
  check("15e. ... and a point just past a ship-length from her center (e = 64: 34 m from it) is ACCEPTED - the held path goes from there, taut round her",
        () => !!up15e && distTo(rejoinOf(rte15e), ll(64, 0)) < 0.5 && minDistTo(wayInOf(rte15e, ll(0, 0)), PARKED_C) >= 30 - 0.05 && guardHeld === null,
        () => "sent " + JSON.stringify(paths()) + "; upload " + rte15e.length + " wpts" + (rejoinOf(rte15e) ? ", rejoin " + distTo(rejoinOf(rte15e), ll(64, 0)).toFixed(1) + " m from (64,0)" : ""));
}

// ── 16. KLEOS (Andy's console, 2026-09-27 20:54:30): THE ESCAPE, AND THE HOLD 0.44 s LATER THAT CANCELLED IT ──
// His log: the helm rung escaped her from KLEOS at 20:54:30.299 and the hold rung held her at 20:54:30.741 - the
// next frame - reading "entry in 0 s under way, but on drift alone it is 0 s away and stays outside half the
// buffer": from INSIDE the buffer the track enters at once whatever the heading. The hold replaced the escape's
// plan with the point she stood on, 2.6 m off the contact, and she stayed there all evening. The lower rungs stand
// down while an escape is in flight; the offer stands once she is on station; the way round goes once the operator's
// 30 s are up.
{
  // the boat on line 1 at (0,0) heading east at 7 kn, INSIDE a 30 x 8 m hull parked with her center 6 m ahead
  // (hull e = -9..21). No set on this first frame: in extremis, and after the dwell the escape.
  surveying(7, [contact(6, 0, { sog: 0, cog: null, heading: 90 })]);
  escFake = { hdg: 0, to: { e: 0, n: 60 }, m: 60, capped: false, clear: true, survived: 45, worst: 30, gain: 30 };
  frame(); clock += 1600; frame();
  const escaped = paths().includes("/api/cmd/escape"), banked = !!guardHeld, episode = !!aisAvoid;
  // THE NEXT FRAME AS HIS CONSOLE SAW IT: the vessel reports "escape", not yet on station; the hull 2.6 m off her
  // side (inside the 3 m buffer, outside the 1.5 m near buffer), heading still into her, the set carrying her away.
  S = { ...S, behavior: "escape", status: { ...S.status, cog_deg: 180, heading_deg: 180, sog_kn: 3,
                                            env_set_deg: 0, env_set_kn: 1.0, holding: false } };
  asv = ll(0, 6.6);
  clock += 400; sent = []; const r16 = frame();
  const afterEsc = paths().slice(), lvl16 = clearance.level;
  check("16. an escape in flight is NOT cancelled by the hold rung on the next frame: inside her buffer the level reads hold, and nothing is sent - she keeps the helm the escape took, the survey and the episode stand",
        () => escaped && banked && episode && lvl16 === "hold" && afterEsc.length === 0 && !r16.raised && !!guardHeld && !!aisAvoid,
        () => "escaped " + escaped + ", banked " + banked + ", episode " + episode + "; next frame: level " + lvl16 + ", sent "
            + JSON.stringify(afterEsc) + (r16.raised ? ", RAISED " + r16.raised : "") + "; record " + (guardHeld ? "stands" : "GONE"));
  // 16a. a frame that reads SLOW during the escape (she is 47 m off her - inside the guard's reach - heading into her at
  // 4 kn: entry in ~21 s; inside 50 m at 7 kn it is a hold since 2026-09-29) sends no speed command either - slowing an
  // escape at HIGH is the opposite of it
  S = { ...S, status: { ...S.status, cog_deg: 180, heading_deg: 180, sog_kn: 4, env_set_kn: 0 } };
  asv = ll(0, 51); clock += 1000; frame();
  const slowLvl = clearance.level, slowSent = paths().slice();
  check("16a. ... nor does the SLOW rung touch the throttle while the escape is in flight: a frame reading slow sends no speed command",
        () => slowLvl === "slow" && !slowSent.some(p => p === "/api/cmd/speed") && slowSent.length === 0,
        () => "level " + slowLvl + ", sent " + JSON.stringify(slowSent));
  // six seconds on, still under way on the escape: still nothing from the lower rungs
  clock += 6000; asv = ll(0, 30); frame();
  const stillNothing = paths().length === 0;
  // she arrives on station: the offer stands, the bar says so, the episode is still open for the way round
  // (the set comes off with the arrival, so the standoff below is the 3 m buffer: in the 1 kn set it was 11.8 m)
  S = { ...S, status: { ...S.status, sog_kn: 0, cog_deg: null, holding: true, env_set_kn: 0 } }; asv = ll(0, 60);
  clock += 5000; aisPolledAt = clock; frame();
  const offer16 = guardHeldOffer();
  renderGuardBar({ level: "blind" }, clearance);
  const bar16 = $("#gb_rung").textContent + " " + $("#gb_why").textContent;
  check("16b. ... under way on the escape the lower rungs stay silent, and once she is on station the banked survey is OFFERED - SURVEY HELD, STEERED CLEAR, holding for her - with the episode open",
        () => stillNothing && !!offer16 && /SURVEY HELD/.test(bar16) && /STEERED CLEAR/.test(bar16) && /holding for AIS: WORKBOAT/.test(bar16) && !!aisAvoid,
        () => "later commands " + JSON.stringify(paths()) + "; offer " + (offer16 ? "stands" : "GONE") + "; bar: " + bar16.slice(0, 170));
  clock += 61000; aisPolledAt = clock; sent = []; frame(); await settle();
  const up16 = sent.find(x => x.p === "/api/cmd/upload"), rte16 = (up16 && up16.route) || [];
  check("16c. ... and the way round then goes from the escape point, rejoining line 1 past a ship-length about her center (e = 40: her center is at 6, her length 30, the standoff 3 - it was e = 55), taut round her from where the escape left her, the record spent, the episode closed",
        () => rte16.length >= 4 && distTo(rejoinOf(rte16), ll(40, 0)) < 0.5 && distTo(rte16[rte16.length - 3], LINE_E.b) < 0.5
              && minDistTo(wayInOf(rte16, ll(0, 60)), { e: 6, n: 0 }) >= 30 - 0.05 && guardHeld === null && aisAvoid === null,
        () => rte16.length + " wpts; rejoin " + (rejoinOf(rte16) ? distTo(rejoinOf(rte16), ll(40, 0)).toFixed(1) + " m from (40, 0)" : "none") + "; sent " + JSON.stringify(paths()));
  // 16d. THE RING ITSELF: her hull grown by her own length on every side - the guard's model stays the bare hull
  const q16 = aisKeepouts([contact(0, 0, { sog: 0, cog: null, heading: 90 })], ref, { now: clock, polledAt: clock, sweepS: 45 }).polys[0];
  const ring16 = aisAvoidKeepout(q16), M16 = { polys: [ring16], lines: [], points: [] };
  const assumed = aisAvoidKeepout(aisKeepouts([contact(0, 0, { sog: 0, cog: null, heading: 90, dim: null, length: null, beam: null })], ref,
                                              { now: clock, polledAt: clock }).polys[0]);
  check("16d. the avoidance keep-out is her hull grown by her own LENGTH on every side - 30 m for a 30 x 8 m hull, 20 m where the length is assumed: 29 m off her beam is inside it, 31 m is outside - and the guard's own keep-out is still the bare hull",
        () => ring16.avoidM === 30 && clearanceM({ e: 0, n: 4 + 29 }, M16, 100) === 0 && clearanceM({ e: 0, n: 4 + 31 }, M16, 100) > 0.5
              && clearanceM({ e: 15 + 29, n: 0 }, M16, 100) === 0
              && clearanceM({ e: 0, n: 4 + 29 }, { polys: [q16], lines: [], points: [] }, 100) > 28
              && assumed.avoidM === 20,
        () => "avoidM " + ring16.avoidM + "; 29 m off the beam: " + clearanceM({ e: 0, n: 33 }, M16, 100).toFixed(1) + " m (bare hull: "
            + clearanceM({ e: 0, n: 33 }, { polys: [q16], lines: [], points: [] }, 100).toFixed(1) + "), 31 m: " + clearanceM({ e: 0, n: 35 }, M16, 100).toFixed(1)
            + "; assumed " + assumed.avoidM);
}

// ── 12. THE CONTACTS ARE POLLED WHENEVER THE CONSOLE HAS AUTHORITY, LAYER OR NO LAYER ─────
{
  surveying(7, []); aisShow = false;
  const armedOff = aisWanted();
  S.armed = false; const disarmed = aisWanted();
  S.armed = true; S.estop = true; const estopped = aisWanted();
  S.estop = false;
  check("12. the poll is wanted while armed with the layer OFF, and not once disarmed or e-stopped",
        () => armedOff === true && disarmed === false && estopped === false,
        () => "armed " + armedOff + ", disarmed " + disarmed + ", e-stopped " + estopped);
  const realFetch = globalThis.fetch;
  let reply = { ok: true, vessels: [CROSSING()], area: { mode: "sea" }, sources: { nmea: { state: "ok" } } };
  globalThis.fetch = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reply) });
  aisPolledAt = 0; aisVessels = [];
  await pollAIS();
  const polled = aisPolledAt, got = aisVessels.length;
  reply = { ok: false, vessels: [], note: "AIS service offline" };
  clock += 5000; await pollAIS();
  check("12b. an answered poll fills the contacts and moves the DR clock; an OFFLINE answer moves nothing, so the model goes stale rather than empty",
        () => polled === clock - 5000 && got === 1 && aisPolledAt === clock - 5000 && aisState === "offline",
        () => "polled at " + polled + " with " + got + " contact(s); after the offline answer clock " + aisPolledAt + ", state " + aisState);
  globalThis.fetch = realFetch;
  aisVessels = [CROSSING()];
  setAIS(false);
  const keptArmed = aisVessels.length;
  S.armed = false; setAIS(false);
  check("12c. turning the layer off keeps the contacts while the console is armed, and drops them once it is not",
        () => keptArmed === 1 && aisVessels.length === 0, () => "armed: " + keptArmed + " kept; disarmed: " + aisVessels.length);
}

// ── 12d-12f. THE POLL RIDES THE STREAM (Andy, 2026-10-13, on another computer: "AIS KEEP-OUTS BLIND", and of a test
//             contact under a mile ahead, "ASV did not avoid. Drove right through it") ──────────────────────────────
// The guard runs on the telemetry stream; the poll ran on setInterval, and a covered window's timers are throttled while
// its stream still arrives. Here the window's timers NEVER fire: only the frames ask (onFrame -> aisPollTick; that onFrame
// asks on every frame is tests/supervisor_page.js 8d).
{
  const C = __aisPollConsts();
  const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setImmediate(r)); };
  const realFetch = globalThis.fetch;
  let asked = 0;
  const answering = () => { asked++; return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(
    { ok: true, vessels: [contact(34, -5, { sog: 0, cog: null, heading: 90 })], area: { mode: "sea" }, sources: { nmea: { state: "ok" } } }) }); };
  surveying(7, [], { polledAt: 0 }); aisShow = false; UIROLE = "main";
  aisPollBegun = 0; aisPollCtl = null; aisBusy = false;
  globalThis.fetch = answering;
  let worstAge = 0, blindFrames = 0;
  for (let k = 0; k < 360; k++) {                          // 90 s of frames, four a second
    clock += 250; aisPollTick(); await flush();
    aisKeepoutsNow();                                       // the guard's own question, every frame
    if (aisKoStale) blindFrames++;
    worstAge = Math.max(worstAge, clock - aisPolledAt);
  }
  check("12d. A WINDOW WHOSE TIMERS NEVER FIRE STILL POLLS: the frames alone ask (aisPollTick), a poll every AIS_POLL_MS - "
        + "18 in 90 s - the contacts never older than one period, and the guard's model never stale (blind) on any frame",
        () => asked === 18 && worstAge <= C.AIS_POLL_MS + 250 && blindFrames === 0 && aisKoDrawn.length === 1,
        () => asked + " polls; the oldest the contacts got " + worstAge + " ms; " + blindFrames + " blind frame(s); "
            + aisKoDrawn.length + " contact(s) modelled");
  // a poll that never answers: before, aisBusy held every later one out for good
  let hung = 0, aborted = 0;
  globalThis.fetch = (u, o) => { hung++; return new Promise((res, rej) => {
    if (o && o.signal) o.signal.addEventListener("abort", () => { aborted++; const e = new Error("aborted"); e.name = "AbortError"; rej(e); }); }); };
  clock += C.AIS_POLL_MS; aisPollTick(); await flush();
  const out = aisBusy && hung === 1;
  clock += C.AIS_POLL_TIMEOUT_MS - 1000; aisPollTick(); await flush();
  const waited = aisBusy && aborted === 0 && hung === 1;
  clock += 2000; aisPollTick(); await flush();
  const noteThen = aisNote;
  const freed = !aisBusy && aborted === 1 && noteThen === "AIS query timed out" && aisState === "offline";
  asked = 0; globalThis.fetch = answering;
  clock += 250; aisPollTick(); await flush();
  check("12e. A POLL THAT NEVER ANSWERS IS ABORTED AFTER AIS_POLL_TIMEOUT_MS by the stream's own tick, said as timed out, "
        + "and the next poll goes out on the next frame - it no longer holds every later poll out for good",
        () => out && waited && freed && asked === 1 && !aisBusy && aisState === "ok",
        () => "out " + out + ", still out before the limit " + waited + ", freed after it " + freed + " ('" + noteThen
            + "'), then " + asked + " poll(s), state " + aisState);
  // THE CONTROLS WINDOW: no boat position, so its own poll ranged everything from New Castle (26 nm, unchanging)
  UIROLE = "controls"; asked = 0; aisPollBegun = 0;
  for (let k = 0; k < 40; k++) { clock += 250; aisPollTick(); await flush(); }
  await pollAIS();                                          // the explicit callers too: the layer turned on, a test contact placed
  UIROLE = "main";
  check("12f. THE CONTROLS WINDOW POLLS NOTHING - not on its timer, not when asked outright: it never has the boat's "
        + "position, and its card is the chart's, mirrored",
        () => asked === 0, () => asked + " poll(s) from the controls window");
  globalThis.fetch = realFetch;
}

// ── 17. ROUTE ROUND HER ON DEMAND (2026-09-27: "no button or right-click selection to initiate or manually
//        avoid an AIS target") - the row over a contact, the held bar's button, and the running plan amended ──
{
  // 17. THE ROW, while the guard holds the survey for her
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  clock += 5000; aisPolledAt = clock;                       // between frames (15's note): the press comes first
  gateAvoidRow(ll(30, 0));                                  // ON her hull (e = 15..45)
  const onHer = { shown: $("#cmAvoid").style.display !== "none", off: $("#cmAvoid").classList.contains("off"),
                  lbl: $("#cmAvoidLbl").textContent, key: $("#cmAvoidK").textContent };
  gateAvoidRow(ll(300, 0));                                 // 255 m off her: not over a contact
  const offHer = $("#cmAvoid").style.display !== "none";
  check("17. right-click ON a contact while the guard holds the survey for her: the chart menu shows 'Route round WORKBOAT', live, her length in the key; off her the row is hidden, not grayed",
        () => onHer.shown && !onHer.off && onHer.lbl === "Route round WORKBOAT" && onHer.key === "30 m round her" && !offHer,
        () => JSON.stringify(onHer) + "; off her shown " + offHer);
  // 17b. choosing it goes the held path NOW - five seconds in, before the next telemetry frame would
  const r17b = await avoidContactAt(ll(30, 0)); await settle();
  const up17 = sent.find(x => x.p === "/api/cmd/upload"), rte17 = (up17 && up17.route) || [], ask17 = pinCalls[pinCalls.length - 1];
  check("17b. choosing it five seconds in goes the held path NOW - pause, upload rejoining line 1 past a ship-length about her center (e = 65), LOW, Start, no amendment - the way in taut round her ring, the record spent, the episode closed, said 'at your word' and logged as manual",
        () => r17b === true && paths().indexOf("/api/cmd/pause") === 0 && paths().indexOf("/api/cmd/upload") < paths().indexOf("/api/cmd/start")
              && !paths().includes("/api/cmd/amend") && rte17.length >= 5 && distTo(rejoinOf(rte17), ll(65, 0)) < 0.5 && distTo(rte17[rte17.length - 3], LINE_E.b) < 0.5
              && pinCalls.length === 0 && minDistTo(wayInOf(rte17, ll(0, 0)), PARKED_C) >= 30 - 0.05
              && aisAvoid === null && guardHeld === null && S.run === "running"
              && banners.some(b => /ROUTED ROUND/.test(b) && nearRe.test(b) && /at your word, one ship-length off her/.test(b))
              && logged.some(e => e.kind === "ais_around" && e.data.manual === true && e.data.skip_m === 65 && e.data.line === 1),
        () => "returned " + r17b + "; sent " + JSON.stringify(paths()) + "; upload " + rte17.length + " wpts, rejoin "
            + (rejoinOf(rte17) ? distTo(rejoinOf(rte17), ll(65, 0)).toFixed(1) + " m of (65,0)" : "none") + "; router calls " + pinCalls.length + "; episode " + JSON.stringify(aisAvoid)
            + "; banners " + JSON.stringify(banners.filter(b => /ROUTED/.test(b))) + "; logged " + JSON.stringify(logged.filter(e => e.kind === "ais_around")));

  // 17c. THE BAR'S BUTTON: shown while she is held for a contact, the same way round when pressed, hidden on a clear frame
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  clock += 5000; aisPolledAt = clock;                       // between frames (15's note): the press comes first
  renderGuardBar({ level: "blind" }, clearance);            // ... so the bar is drawn here, not by a frame
  const btnHeld = $("#gb_around").style.display;
  const r17c = aisAroundNow(); await settle();
  const up17c = sent.find(x => x.p === "/api/cmd/upload"), rte17c = (up17c && up17c.route) || [], sent17c = paths().slice();
  surveying(7, []); frame();                                // (surveying resets `sent`: the paths were read first)
  const btnClear = $("#gb_around").style.display;
  check("17c. the held bar carries ROUTE ROUND HER NOW while she is held for a contact - pressing it is the same way round, five seconds in (pause, upload from e = 65, Start) - and a clear frame takes the button down",
        () => btnHeld !== "none" && r17c === true && sent17c.indexOf("/api/cmd/pause") === 0 && rte17c.length >= 5 && distTo(rejoinOf(rte17c), ll(65, 0)) < 0.5
              && sent17c.includes("/api/cmd/start") && btnClear === "none",
        () => "held: '" + btnHeld + "', pressed " + r17c + ", sent " + JSON.stringify(sent17c) + ", clear: '" + btnClear + "'");
  // ⚠⚠ AND THE BUTTON IS OFFERED DURING A CHARTED HOLD TOO, SO ITS TIP MAY NOT PROMISE A CONTACT'S MARGIN
  // (2026-11-03, review). The bar shows it for any open episode and one opens for a charted feature since
  // 2026-11-02, while aisRoundKeepout grows no ring for a pier - `std` is the whole margin there. Three surfaces
  // were put through aroundMarginSay on 2026-11-02 and these two static tips were missed: a title cannot ask
  // that function, so it has to say both cases. Read off the page's own text, because the harness's element has
  // whatever title the harness gave it.
  const btnTitleHtml = (H.match(/id="gb_around"[^>]*title="([^"]*)"/) || ["", ""])[1];
  const btnTitleJs = (H.match(/\$\("#gb_around"\)\.title = ([\s\S]*?);\r?\n/) || ["", ""])[1];
  const promisesBoth = (t) => /ship-length/.test(t) && /standoff/.test(t);
  check("17c2. ... and both of the button's hover tips - the one in the page and the one the script sets - say "
        + "what the margin actually is for each case: one ship-length from a CONTACT's center, and for a charted "
        + "feature the standoff her own plan was laid at, which is a different number and the entire margin",
        () => btnTitleHtml.length > 40 && btnTitleJs.length > 40
              && promisesBoth(btnTitleHtml) && promisesBoth(btnTitleJs),
        () => "page tip: '" + btnTitleHtml.slice(0, 150) + "'; script tip: '" + btnTitleJs.slice(0, 150) + "'");

  // 17d. A PAUSED HOLD: the press is refused in words, nothing is sent, the offer and the episode stand
  surveying(7, [PARKED()]); frame(); nowHolding(); S.run = "paused"; sent = []; notes = []; banners = [];
  clock += 5000; aisPolledAt = clock; frame();
  const r17d = aisAroundNow();
  check("17d. on a PAUSED hold the press is refused in words - press PAUSE again to resume the hold first - nothing is sent, and the offer and the episode stand",
        () => r17d === false && sent.length === 0 && notes.some(n => /Not routed round/.test(n) && /paused/.test(n)) && !!aisAvoid && !!guardHeldOffer(),
        () => "returned " + r17d + ", sent " + JSON.stringify(paths()) + ", notes " + JSON.stringify(notes.slice(-2)));

  // 17e. A SURVEY STILL RUNNING (not held): the row AMENDS the plan round her
  surveying(7, [PARKED()]); aisKeepoutsNow(); sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  const why17e = avoidWhy();
  const r17e = await avoidContactAt(ll(30, 0));
  const am17 = sent.find(x => x.p === "/api/cmd/amend"), rte17e = (am17 && am17.route) || [], ask17e = pinCalls[pinCalls.length - 1];
  check("17e. on a survey still RUNNING the row AMENDS the plan round her - no pause, no upload: the taut way round, the remainder from e = 65 on line 1, then the rest of the plan, runRoute spliced behind the index, the ladder settling on the edge rung's clock, said and logged as ais_around running",
        () => why17e === "" && r17e === true && paths().length === 1 && paths()[0] === "/api/cmd/amend"
              && rte17e.length >= 5 && distTo(rejoinOf(rte17e), ll(65, 0)) < 0.5 && distTo(rte17e[rte17e.length - 3], LINE_E.b) < 0.5 && distTo(rte17e[rte17e.length - 1], ll(-200, 60)) < 0.5
              && pinCalls.length === 0 && minDistTo(wayInOf(rte17e, ll(0, 0)), PARKED_C) >= 30 - 0.05
              && runRoute.length === rte17e.length + 1 && distTo(runRoute[runRoute.length - 4], ll(65, 0)) < 0.5 && guardEdgeAt === clock
              && notes.length === 1 && /Routed round/.test(notes[0]) && nearRe.test(notes[0]) && /at your word/.test(notes[0]) && /rejoining line 1/.test(notes[0])
              && logged.some(e => e.kind === "ais_around" && e.data.running === true && e.data.manual === true && e.data.skip_m === 65 && e.data.mmsi === 338111222),
        () => "why '" + why17e + "', returned " + r17e + ", sent " + JSON.stringify(paths()) + ", amend " + rte17e.length + " wpts, rejoin "
            + (rejoinOf(rte17e) ? distTo(rejoinOf(rte17e), ll(65, 0)).toFixed(1) + " m of (65,0)" : "none") + ", router calls " + pinCalls.length + ", runRoute " + (runRoute && runRoute.length)
            + ", guardEdgeAt " + guardEdgeAt + " vs " + clock + ", notes " + JSON.stringify(notes.slice(-1)));
  // ⚠⚠ AND THE BADGE GOES UP FOR THIS ONE TOO, WHICH IT DID NOT (2026-11-03, review). This is the fourth thing
  // the console does to her track on its own authority, and the only one the operator watches happen in real
  // time - she never stops - yet the chart said nothing at all while it was flying. The rejoin is asserted
  // GEOMETRICALLY rather than arithmetically: the waypoint the record points at in the array she is now flying
  // has to BE the pick-up past her (e = 65), so a wrong index space cannot pass by agreeing with itself.
  const av17e = avoidingNow();
  renderAvoiding();
  check("17e2. ... and the AVOIDING badge goes up with it, naming her, with the rejoin pointing at the pick-up "
        + "past her in the route she is now flying - and it comes down once her index is past that waypoint",
        () => !!av17e && av17e.why === "routed round" && /WORKBOAT/.test(av17e.kind)
              && av17e.rejoin != null && runRoute[av17e.rejoin]
              && distTo(runRoute[av17e.rejoin], ll(65, 0)) < 0.5
              && /AVOIDING/.test(EL["#r_avoid"].textContent || "") && EL["#r_avoid"].style.display === "block"
              && (() => { S.wp_total = runRoute.length; window._wpIndex = av17e.rejoin + 1;
                          return avoidingNow() === null; })(),
        () => "record " + JSON.stringify(av17e) + "; the rejoin waypoint is "
            + (av17e && runRoute[av17e.rejoin]
               ? distTo(runRoute[av17e.rejoin], ll(65, 0)).toFixed(1) + " m from the pick-up" : "MISSING")
            + "; badge '" + EL["#r_avoid"].textContent + "'");

  // 17f. PAUSED on the line (a pause mark, no live line mark): amended the same way
  surveying(7, [PARKED()]); aisKeepoutsNow(); S.run = "paused"; runLineIdx = -1;
  pauseMark = { line: 0, along: 200, fwd: 1, at: ll(0, 0), t: clock };
  sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  const r17f = await avoidContactAt(ll(30, 0));
  const am17f = sent.find(x => x.p === "/api/cmd/amend"), rte17f = (am17f && am17f.route) || [], via17f = viaOf(rte17f);
  check("17f. PAUSED on the line (the pause mark, no live line mark) it is amended the same way - the way round IN FRONT of the rejoin: its waypoints, e = 65, then the rest, and the note counts them",
        () => r17f === true && paths().length === 1 && paths()[0] === "/api/cmd/amend" && via17f.length >= 1
              && distTo(rejoinOf(rte17f), ll(65, 0)) < 0.5 && distTo(rte17f[rte17f.length - 3], LINE_E.b) < 0.5
              && notes.some(n => new RegExp("via " + via17f.length + " waypoints? clear of her").test(n)),
        () => "returned " + r17f + ", sent " + JSON.stringify(paths()) + ", amend " + rte17f.length + " wpts, via " + via17f.length + ", notes " + JSON.stringify(notes.slice(-1)));

  // 17g. THE REFUSALS: paused off a line, disarmed, and no contact under the click
  surveying(7, [PARKED()]); aisKeepoutsNow(); S.run = "paused"; runLineIdx = -1; pauseMark = null; sent = []; notes = [];
  const r17g = await avoidContactAt(ll(30, 0));
  const offLine = r17g === false && sent.length === 0 && notes.some(n => /not on a coverage line/.test(n));
  surveying(7, [PARKED()]); aisKeepoutsNow(); S.armed = false;
  gateAvoidRow(ll(30, 0));
  const disarmed = $("#cmAvoid").style.display !== "none" && $("#cmAvoid").classList.contains("off") && $("#cmAvoidK").textContent === "arm first";
  surveying(7, []); aisKeepoutsNow();
  gateAvoidRow(ll(30, 0));
  const noContact = $("#cmAvoid").style.display === "none";
  sent = []; notes = [];
  const r17g2 = await avoidContactAt(ll(30, 0));
  check("17g. refused in words: paused OFF a coverage line (no pause mark) sends nothing; disarmed, the row is shown but off with 'arm first'; with no contact under the click the row is hidden and the handler sends nothing",
        () => offLine && disarmed && noContact && r17g2 === false && sent.length === 0,
        () => "off line " + offLine + ", disarmed " + disarmed + ", no contact " + noContact + " / " + r17g2 + " " + JSON.stringify(paths()));
  pauseMark = null; runLineIdx = 0;

  // 17h. STOPPED ON A TURN (the second live rehearsal, 23:17: held swinging onto line 8, 13.5 m off her, no line
  // under her - the way round refused "not stopped on a coverage line" while the bar promised "routes round her
  // itself now"). No line to walk beyond her: the plan is picked up at its NEXT waypoint, routed round her.
  surveying(7, [PARKED()]); runLineIdx = -1; frame(); nowHolding();
  sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  clock += 5000; aisPolledAt = clock;               // between frames (15's note), so the bar is drawn by hand
  renderGuardBar({ level: "blind" }, clearance);
  const whyTurn = $("#gb_why").textContent, bankedTurn = !!guardHeld && !guardHeld.mark && !!aisAvoid;
  const r17h = aisAroundNow(); await settle();
  const up17h = sent.find(x => x.p === "/api/cmd/upload"), rte17h = (up17h && up17h.route) || [];
  check("17h. held on a TURN (no line under her): the survey is banked with no mark, the bar says she was stopped off the coverage lines instead of promising a line she is not on, and the way round walks the plan on PAST her (2026-10-16: it took the next waypoint, which can lie before her) routed round her - pause, upload, LOW, Start, the way in taut round her ring - said and logged with no line",
        () => bankedTurn && /stopped OFF the coverage lines \(on a turn or a transit\)/.test(whyTurn) && !/back down it/.test(whyTurn) && /routes round her itself now/.test(whyTurn)
              && r17h === true && paths().indexOf("/api/cmd/pause") === 0 && paths().includes("/api/cmd/start") && !paths().includes("/api/cmd/amend")
              && rte17h.length >= 4 && distTo(rejoinOf(rte17h, 2), LINE_E.b) < 0.5 && distTo(rte17h[rte17h.length - 1], ll(-200, 60)) < 0.5
              && pinCalls.length === 0 && minDistTo(wayInOf(rte17h, ll(0, 0), 2), PARKED_C) >= 30 - 0.05   // taut round her to the next waypoint
              && banners.some(b => /ROUTED ROUND/.test(b) && nearRe.test(b) && /stopped off the coverage lines/.test(b) && /on from where she stopped, past AIS: WORKBOAT/.test(b))
              && logged.some(e => e.kind === "ais_around" && e.data.line === null && e.data.manual === true && e.data.wpts === rte17h.length),
        () => "banked " + bankedTurn + "; bar '" + whyTurn.slice(-200) + "'; returned " + r17h + "; sent " + JSON.stringify(paths()) + "; upload " + rte17h.length
            + " wpts" + (rejoinOf(rte17h, 2) ? ", next waypoint " + distTo(rejoinOf(rte17h, 2), LINE_E.b).toFixed(1) + " m of L.b" : "") + "; banners " + JSON.stringify(banners.filter(b => /ROUTED/.test(b)).map(b => b.slice(0, 160)))
            + "; logged " + JSON.stringify(logged.filter(e => e.kind === "ais_around")));
  runLineIdx = 0;

  // 17i. HELD ON A TRANSIT WITH THE NEXT WAYPOINT BEFORE HER (Andy, 2026-10-16 live: TEST-1 dropped on the DriX's
  // approach to the first line; held 44 m short, the way round picked the plan up at the next waypoint - 33 m BEFORE
  // her - and the plan's next leg ran 3 m from her center: held again, routed "round" again, ten times, never past).
  // The approach runs due south down e = -200 to the line's west end in 60 m legs; she is at n = 190 heading south,
  // her next waypoint n = 180; the workboat is parked across the approach at n = 150, between it and n = 120.
  {
    const TRANSIT_HER = () => contact(-200, 150, { sog: 0, cog: null, heading: 90 });
    surveying(7, [TRANSIT_HER()]); runLineIdx = -1;
    asv = ll(-200, 190);
    S = { ...S, status: { ...S.status, cog_deg: 180, heading_deg: 180 } };
    runRoute = [ll(-200, 300), ll(-200, 240), ll(-200, 180), ll(-200, 120), ll(-200, 60), LINE_E.a, LINE_E.b, ll(200, 60), ll(-200, 60)];
    S.wp_total = runRoute.length;
    window._wpIndex = 2;
    frame(); nowHolding();
    sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
    clock += 5000; aisPolledAt = clock;             // between frames (15's note), so the bar is drawn by hand
    renderGuardBar({ level: "blind" }, clearance);
    const held17i = !!guardHeld && !guardHeld.mark && !!aisAvoid, why17i = $("#gb_why").textContent;
    const r17i = aisAroundNow(); await settle();
    const up17i = sent.find(x => x.p === "/api/cmd/upload"), rte17i = (up17i && up17i.route) || [];
    const hull17i = aisKeepouts([TRANSIT_HER()], ref, { now: clock, polledAt: clock, sweepS: 45 }).polys[0];
    const flown17i = [ll(-200, 190), ...rte17i];
    const hullClr17i = rte17i.length ? minClearTo(flown17i, hull17i) : -1;
    const centerClr17i = rte17i.length ? minDistTo(flown17i, { e: -200, n: 150 }) : -1;
    const keeps17i = [ll(-200, 60), LINE_E.a, LINE_E.b, ll(200, 60), ll(-200, 60)].every(p => rte17i.some(q => distTo(q, p) < 0.5));
    check("17i. ⚠ HELD ON A TRANSIT WITH THE NEXT WAYPOINT BEFORE HER (2026-10-16 live, TEST-1 on the approach): the way round walks the route PAST her - nothing it uploads, from where she is on, comes within her ring (30 m round her center) or her standoff of her hull, where the next-waypoint pickup ran its next leg through her - the rest of the approach and the survey kept, the bar naming a transit",
          () => held17i && /stopped OFF the coverage lines/.test(why17i) && r17i === true
                && paths().indexOf("/api/cmd/pause") === 0 && paths().includes("/api/cmd/start")
                && rte17i.length >= 6 && centerClr17i >= 30 - 0.05 && hullClr17i >= 3 - 0.05 && keeps17i
                && banners.some(b => /ROUTED ROUND/.test(b) && /stopped off the coverage lines/.test(b) && /past AIS: WORKBOAT/.test(b)),
          () => "held " + held17i + "; returned " + r17i + "; sent " + JSON.stringify(paths()) + "; upload " + rte17i.length
              + " wpts, first " + JSON.stringify(rte17i.slice(0, 4).map(p => { const q = ref.toEN(p); return [Math.round(q.e * 10) / 10, Math.round(q.n * 10) / 10]; }))
              + "; nearest her center " + centerClr17i.toFixed(1) + " m, her hull " + hullClr17i.toFixed(1) + " m; plan kept " + keeps17i
              + "; banners " + JSON.stringify(banners.filter(b => /ROUTED|NO WAY/.test(b)).map(b => b.slice(0, 200))));
    runLineIdx = 0;

    // 17j. ... AND A LATER LEG THROUGH HER IS NOT THIS PICKUP'S BUSINESS: the same approach, but the plan's last leg (after
    // the coverage line) runs back west THROUGH her. The walk ends where the first coverage line it reaches ends, so the
    // pickup is still found past her on the approach and that leg is kept for the guard to answer when she gets there -
    // walked to the plan's end, every point read "not clear" and she kept holding.
    surveying(7, [TRANSIT_HER()]); runLineIdx = -1;
    asv = ll(-200, 190);
    S = { ...S, status: { ...S.status, cog_deg: 180, heading_deg: 180 } };
    runRoute = [ll(-200, 300), ll(-200, 240), ll(-200, 180), ll(-200, 120), ll(-200, 60), LINE_E.a, LINE_E.b, ll(200, 150), ll(-260, 150)];
    S.wp_total = runRoute.length;
    window._wpIndex = 2;
    frame(); nowHolding();
    sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
    clock += 5000; aisPolledAt = clock;             // between frames (15's note)
    const r17j = aisAroundNow(); await settle();
    const up17j = sent.find(x => x.p === "/api/cmd/upload"), rte17j = (up17j && up17j.route) || [];
    const kEnd17j = rte17j.findIndex(q => distTo(q, LINE_E.b) < 0.5);       // the way in, the approach and the line
    const head17j = kEnd17j >= 0 ? [ll(-200, 190), ...rte17j.slice(0, kEnd17j + 1)] : [];
    const centerClr17j = head17j.length ? minDistTo(head17j, { e: -200, n: 150 }) : -1;
    check("17j. ... and a LATER leg of the plan through her (west along n = 150 after the line) does not stop the pickup: the walk ends at the first coverage line's end, so she is routed past her on the approach - nothing to the line's end within her ring - and the later leg is kept, for the guard to answer when she gets there",
          () => r17j === true && paths().includes("/api/cmd/start") && kEnd17j > 0 && centerClr17j >= 30 - 0.05
                && distTo(rte17j[rte17j.length - 1], ll(-260, 150)) < 0.5 && !banners.some(b => /NO WAY ROUND/.test(b)),
          () => "returned " + r17j + "; sent " + JSON.stringify(paths()) + "; upload " + rte17j.length + " wpts, line end at " + kEnd17j
              + "; nearest her center to the line's end " + centerClr17j.toFixed(1) + " m; banners " + JSON.stringify(banners.filter(b => /ROUTED|NO WAY/.test(b)).map(b => b.slice(0, 200))));
    runLineIdx = 0;
  }
}

// ── 18. THE TREADMILL (Andy, 2026-09-28: "I have to acknowledge warning pop-ups many times why is that?" and
//        "There is no obvious way to increase speed again"). His 08:34 log: 58 presses in fifty minutes against
//        FRIGGA on his line - 21 PROCEEDs on a CLEAR frame spent on the next, the rest lapsing every 5 m of
//        progress, and the low speed with no control anywhere to end it. ─────────────────────────────────────
{
  // A contact parked on the line, her hull's near end 47 m ahead - INSIDE the guard's reach (AIS_LOOKAHEAD_M, 50 m since
  // 2026-09-29): at 7 kn the entry is ~12 s, a hold, which slows her to LOW in lieu (at 4 kn it is ~21 s). Reported 4 m
  // farther (FARTHER) she is outside the reach and the frame reads CLEAR: the chatter a contact makes now. Until then she
  // sat 120 m ahead, SLOW at 7 kn and CLEAR at 4 - a speed-driven chatter a contact inside a DISTANCE reach cannot make,
  // so the three checks that need it (18f, 18g, 18o) ask it of a charted block at that range (BLOCK120).
  const FAR = (o = {}) => contact(62, 0, { sog: 0, cog: null, heading: 90, ...o });
  const FARTHER = (o = {}) => contact(66, 0, { sog: 0, cog: null, heading: 90, ...o });
  const r120 = [{ e: 105, n: -4 }, { e: 135, n: -4 }, { e: 135, n: 4 }, { e: 105, n: 4 }];
  const BLOCK120 = { polys: [{ ring: r120, bb: bbOf(r120), kind: "a dock / pier" }], lines: [], points: [], marks: [], sys: [], chans: [] };
  const speed = (kn) => { S = { ...S, status: { ...S.status, sog_kn: kn, speed_key: kn < 5 ? "low" : "survey" } }; };
  // the PROCEED handler's record, as the page builds it (2026-09-28: it adopts the hazard the bar was showing, guardKeyLast)
  const press = () => { const k = __keyLast(); guardOverride = { t: Date.now(), level: clearance.level, clearM: clearance.m, key: k ? k.id : null, keyName: k ? k.name : null }; clearance.slowed = false; commandedSpeed = null; };
  const farKind = "AIS: WORKBOAT (30 x 8 m)", farId = "ais:338111222";   // the key is her IDENTITY; the kind is what the banner says
  // 18. a clear frame does not spend it
  surveying(7, [FAR()]); frame();                          // the hold rung, slowing her to LOW in lieu of stopping
  const l18a = clearance.level, slowed18 = clearance.slowed;
  press(); banners = []; sent = [];
  aisVessels = [FARTHER()]; clock += 2000; aisPolledAt = clock; frame();   // 4 m farther: outside the reach, CLEAR
  const l18b = clearance.level, standsAfterClear = !!guardOverride;
  aisVessels = [FAR()]; clock += 2000; aisPolledAt = clock; frame();       // back inside it
  const l18c = clearance.level, standsAfterSlow = !!guardOverride, key18 = guardOverride && guardOverride.key;
  check("18. PROCEED against a contact on the line: the ladder chatters HOLD / CLEAR (her report 4 m farther, outside the guard's 50 m reach) / HOLD - and the override STANDS through the clear frame, adopting the hazard's name, so the rungs do not slow or stop her again and the operator is not asked again",
        () => l18a === "hold" && slowed18 && l18b === "clear" && standsAfterClear && l18c === "hold" && standsAfterSlow
              && key18 === farId && guardOverride.keyName === farKind && clearance.slowed === false && !sent.some(x => x.p === "/api/cmd/speed" && x.speed === "low")
              && !paths().includes("/api/cmd/hold"),
        () => "levels " + [l18a, l18b, l18c].join("/") + ", stands after clear " + standsAfterClear + ", after slow " + standsAfterSlow
            + ", key " + JSON.stringify(key18) + ", slowed again " + clearance.slowed + ", sent " + JSON.stringify(paths()));
  // 18b. a hazard that stays put is PASSED, not closed on: 60 m nearer, no lapse, no hold (the override covers the hold rung too)
  asv = ll(30, 0); clock += 2000; aisPolledAt = clock; banners = []; sent = []; frame();
  check("18b. thirty meters nearer the same parked contact - a hazard that stays put is passed, not 'closed on': no OVERRIDE LAPSED, the override stands, the hold rung stays quiet",
        () => !!guardOverride && !banners.some(b => /LAPSED/.test(b)) && !paths().includes("/api/cmd/hold") && (clearance.level === "hold" || clearance.level === "slow"),
        () => "level " + clearance.level + ", override " + JSON.stringify(guardOverride) + ", banners " + JSON.stringify(banners) + ", sent " + JSON.stringify(paths()));
  // 18c. a DIFFERENT hazard ends it, said with both named
  aisVessels = [contact(62, 0, { name: "TUG", mmsi: 111222333, sog: 0, cog: null, heading: 90 })]; asv = ll(0, 0);
  clock += 2000; aisPolledAt = clock; banners = []; frame();
  check("18c. a DIFFERENT hazard ahead ends it, said with both named: 'OVERRIDE ENDED - a different hazard ahead: AIS: TUG ... You assessed AIS: WORKBOAT'",
        () => guardOverride === null && banners.some(b => /OVERRIDE ENDED/.test(b) && /AIS: TUG/.test(b) && /You assessed AIS: WORKBOAT/.test(b)),
        () => "override " + JSON.stringify(guardOverride) + ", banners " + JSON.stringify(banners));
  // 18d. behind her: the RELEASE ends it (the counterfactual at the plan's speed clear, then the dwell) - quietly
  surveying(7, [FAR()]); frame(); press(); banners = []; notes = [];
  aisVessels = []; clock += 2000; aisPolledAt = clock; frame();
  const standsFirstClear = !!guardOverride;
  clock += 5000; aisPolledAt = clock; frame();
  check("18d. the contact gone: the override stands on the first clear frame (the dwell is not up), and the RELEASE ends it - 'Clear ahead again' - with no OVERRIDE banner: behind her",
        () => standsFirstClear && guardOverride === null && guardLevel === "clear" && notes.some(n => /Clear ahead again/.test(n)) && !banners.some(b => /OVERRIDE/.test(b)),
        () => "first clear frame " + standsFirstClear + ", after the dwell " + JSON.stringify(guardOverride) + ", guardLevel " + guardLevel + ", notes " + JSON.stringify(notes.slice(-2)) + ", banners " + JSON.stringify(banners));
  // 18d2. a press against clear water that meets no hazard within OVERRIDE_STALE_MS is dropped - never a standing permission
  surveying(7, []); frame(); press(); banners = [];
  clock += 30000; aisPolledAt = clock; frame();
  const stands30 = !!guardOverride;
  aisVessels = [FAR()]; clock += 20000; aisPolledAt = clock; frame();
  const staleGone = guardOverride === null, slowedAgain = clearance.slowed === true;
  surveying(7, []); frame(); press();
  aisVessels = [FAR()]; clock += 10000; aisPolledAt = clock; frame();
  check("18d2. pressed against clear water: it waits for a hazard 30 s on; a hazard first seen 50 s after the press finds it STALE and dropped (OVERRIDE_STALE_MS 45 s) - the rung slows her as if nothing was pressed; one seen 10 s after the press is adopted",
        () => stands30 && staleGone && slowedAgain && __overrideStale() === 45000 && !!guardOverride && guardOverride.key === farId && clearance.slowed === false,
        () => "30 s " + stands30 + ", stale gone " + staleGone + ", slowed again " + slowedAgain + ", adopted " + JSON.stringify(guardOverride) + ", slowed " + clearance.slowed);
  // 18e. a contact CLOSING on her keeps the 5 m give, said with her name. A workboat crossing the line 46 m ahead,
  //      northbound at 6 kn: her sweep over the line at e = 46..54, ~12 s ahead at 7 kn - inside the reach, a hold
  surveying(7, [contact(50, -60, { sog: 6, cog: 0, heading: 0 })]); frame();
  const l18e = clearance.level;
  press(); banners = []; sent = [];
  aisVessels = [contact(42, -60, { sog: 6, cog: 0, heading: 0 })]; clock += 2000; aisPolledAt = clock;
  const r18e = frame();   // 8 m nearer along the line
  check("18e. a workboat UNDER WAY closing on her: more than 5 m nearer than assessed lapses the override - 'OVERRIDE LAPSED - AIS: WORKBOAT ... is closing on her' - the one case the give is for",
        () => (l18e === "hold" || l18e === "slow") && guardOverride === null && banners.some(b => /OVERRIDE LAPSED/.test(b) && /is closing on her/.test(b) && nearRe.test(b)),
        () => "level " + l18e + " then " + clearance.level + " at " + (clearance.m != null ? clearance.m.toFixed(1) : "?") + " m, frame " + JSON.stringify(r18e.raised || "ok")
            + ", override " + JSON.stringify(guardOverride) + ", banners " + JSON.stringify(banners) + ", sent " + JSON.stringify(paths()));
  // 18f. CONTINUE AT LOW: the counterfactual is asked whoever holds the throttle, the bar stays up with RELEASE LOW on it,
  //      and the release note does not promise a speed the latch will not give
  surveying(7, [], { ko: BLOCK120 }); frame(); banners = []; notes = []; sent = [];   // a charted block 105 m ahead (see FAR)
  continueAtLow();
  const latched = resumeSlow === true && !!guardOverride && guardOverride.slow === true;
  speed(4); clock += 2000; aisPolledAt = clock; frame();
  clock += 5000; aisPolledAt = clock; frame();                       // past RELEASE_HOLD_MS: the dwell alone would release
  const bar18f = EL["#guardBar"].style.display, rel18f = EL["#gb_release"].style.display, rung18f = EL["#gb_rung"].textContent, why18f = EL["#gb_why"].textContent;
  const liedBack = notes.some(n => /speed back to (survey|high)/.test(n));
  check("18f. CONTINUE AT LOW: slowed to 4 kn the water reads clear, but the release asks the counterfactual at the PLAN's speed (7 kn: SLOW) whoever took the throttle - so nothing is released, the override stands, the bar stays up (re-drawn: 'not yet at the plan's speed') with RELEASE LOW on it, and no note says 'speed back to survey'",
        () => latched && !!guardOverride && guardLevel !== "clear" && bar18f === "block" && rel18f === "" && !liedBack && /not yet at the plan's speed/.test(why18f)
              && !notes.some(n => /Speed released/.test(n)) && resumeSlow === true,
        () => "latched " + latched + ", override " + JSON.stringify(guardOverride) + ", guardLevel " + guardLevel + ", bar " + bar18f + ", release btn '" + rel18f
            + "', rung '" + rung18f + "', notes " + JSON.stringify(notes.slice(-3)));
  // 18g. the contact gone: released at the plan's speed - but the note says she is STILL at low on the operator's
  //      authority, the bar shows the latch on its own with RELEASE LOW, and RELEASE LOW hands the throttle back
  asv = ll(150, 0); notes = []; clock += 2000; aisPolledAt = clock; frame(); clock += 5000; aisPolledAt = clock; frame();   // past the block
  const releasedNote = notes.find(n => /Clear ahead again/.test(n)) || "";
  const bar18g = EL["#guardBar"].style.display, rung18g = EL["#gb_rung"].textContent, why18g = EL["#gb_why"].textContent, rel18g = EL["#gb_release"].style.display;
  const stillLatched = resumeSlow === true && guardOverride === null;
  sent = []; logged = [];
  const freed = releaseLow("the test");
  const bar18g2 = EL["#guardBar"].style.display;
  check("18g. past the block, the plan's speed clear too: released - the note reads 'still at LOW on your authority; RELEASE LOW ...', the bar stands on its own as LOW - OPERATOR'S AUTHORITY with RELEASE LOW; pressing it frees the latch, says so, logs it, and the bar goes down",
        () => /still at LOW on your authority/.test(releasedNote) && !/speed back to/.test(releasedNote) && stillLatched
              && bar18g === "block" && /LOW .* OPERATOR'S AUTHORITY/.test(rung18g) && /RELEASE LOW/.test(why18g) && rel18g === ""
              && freed === true && resumeSlow === false && notes.some(n => /Speed released/.test(n)) && bar18g2 === "none"
              && logged.some(e => e.kind === "guard_low" && e.data.how === "release"),
        () => "note '" + releasedNote.slice(0, 120) + "', latched " + stillLatched + ", bar " + bar18g + " '" + rung18g + "' / '" + why18g.slice(0, 80) + "', release btn '" + rel18g
            + "', freed " + freed + ", after " + bar18g2 + ", logged " + JSON.stringify(logged.filter(e => e.kind === "guard_low")));
  // 18h. CANCEL OVERRIDE releases the latch too (the handler is page-level: pinned in the source), and RELEASE LOW is wired
  const cancelSrc = H.slice(H.indexOf('$("#gb_cancel").onclick'), H.indexOf('$("#gb_cancel").onclick') + 500);
  check("18h. CANCEL OVERRIDE releases the low speed with the override (a canceled CONTINUE AT LOW used to leave her at 1.5 kn with no bar), and RELEASE LOW is a real button on the bar, wired",
        () => /releaseLow\("the override was canceled"\)/.test(cancelSrc) && /id="gb_release"/.test(H) && /\$\("#gb_release"\)\.onclick/.test(H),
        () => cancelSrc.slice(0, 160));

  // 18j. RELEASE LOW ends a CONTINUE AT LOW override too (review): released to the plan's speed, the hold rung is
  //      not left suppressed on a decision taken about the low speed
  surveying(7, [FAR()]); frame(); continueAtLow();
  const over18j = !!guardOverride && guardOverride.slow === true;
  releaseLow("the test");
  check("18j. RELEASE LOW ends the CONTINUE AT LOW override with the latch - the console has the situation again; PROCEED is the other decision",
        () => over18j && guardOverride === null && resumeSlow === false,
        () => "override before " + over18j + ", after " + JSON.stringify(guardOverride) + ", resumeSlow " + resumeSlow);
  // 18k. a contact under way closing on her lapses the override even with a charted feature ALSO in the track
  //      (review: `closing` used to need the charted model to read clear)
  const blk = [{ e: 150, n: -10 }, { e: 160, n: -10 }, { e: 160, n: 10 }, { e: 150, n: 10 }];
  const BLOCK = { polys: [{ ring: blk, bb: bbOf(blk), kind: "a dock / pier" }], lines: [], points: [], marks: [], sys: [], chans: [] };
  surveying(7, [contact(50, -60, { sog: 6, cog: 0, heading: 0 })], { ko: BLOCK }); frame();
  const l18k = clearance.level;
  press(); banners = [];
  aisVessels = [contact(42, -60, { sog: 6, cog: 0, heading: 0 })]; clock += 2000; aisPolledAt = clock; frame();
  check("18k. a pier 150 m ahead on the track AND a workboat under way whose sweep crosses the line nearer: the contact closing 8 m lapses the override (she is the nearest hazard), charted feature or no charted feature",
        () => (l18k === "slow" || l18k === "hold") && guardOverride === null && banners.some(b => /OVERRIDE LAPSED/.test(b) && /is closing on her/.test(b)),
        () => "level " + l18k + " then " + clearance.level + " at " + (clearance.m != null ? clearance.m.toFixed(1) : "?") + " m, override " + JSON.stringify(guardOverride) + ", banners " + JSON.stringify(banners));
  // 18l. the key is her IDENTITY, not her description (review): a report reading 0.1 kn more is the same vessel
  surveying(7, [contact(50, -60, { sog: 6, cog: 0, heading: 0 })]); frame(); press(); banners = [];
  aisVessels = [contact(50, -60, { sog: 6.1, cog: 0, heading: 0 })]; clock += 2000; aisPolledAt = clock; frame();
  check("18l. the same workboat reporting 6.1 kn instead of 6.0: the SAME hazard - the override stands, no 'different hazard' banner (the key is her MMSI, her kind only names her)",
        () => !!guardOverride && guardOverride.key === farId && /6\.1 kn/.test(clearance.kind || aisNearestKind(nogo.frame.toEN(asv), aisKoDrawn) || "") && !banners.some(b => /OVERRIDE ENDED/.test(b)),
        () => "override " + JSON.stringify(guardOverride) + ", banners " + JSON.stringify(banners));
  // 18m. the key names the hazard AHEAD, not the feature abeam (review): a pier beside the line while the contact
  //      is the hazard on the track - the override adopts the contact; pressing on the not-released clear frame
  //      adopts the hazard the bar was showing (guardKeyLast), so it is never 'stale'
  const pierRing = [{ e: -50, n: 12 }, { e: 400, n: 12 }, { e: 400, n: 60 }, { e: -50, n: 60 }];
  const PIER_ABEAM = { polys: [{ ring: pierRing, bb: bbOf(pierRing), kind: "a dock / pier" }], lines: [], points: [], marks: [], sys: [], chans: [] };
  surveying(7, [FAR()], { ko: PIER_ABEAM }); frame();
  const l18m = clearance.level, m18m = clearance.m;
  press();
  aisVessels = [FARTHER()]; clock += 2000; aisPolledAt = clock; frame();   // her report outside the reach: clear, not released, the bar up
  const keyOnClear = guardOverride && guardOverride.key;
  surveying(7, [FAR()], { ko: PIER_ABEAM }); frame();
  aisVessels = [FARTHER()]; clock += 2000; aisPolledAt = clock; frame();   // a not-released clear frame
  press();                                                                 // pressed ON that frame: adopts what the bar shows
  const keyAtPress = guardOverride && guardOverride.key;
  aisVessels = [FAR()]; clock += 50000; aisPolledAt = clock; frame();     // 50 s later, in reach again: not stale, the same hazard
  check("18m. a pier 12 m abeam while the contact ahead is the hazard: the override is keyed on the CONTACT (the feature at the entry point), and a press on a not-released clear frame adopts the hazard the bar showed - 50 s later it is neither stale nor 'different'",
        () => l18m === "hold" && m18m < 20 && keyOnClear === farId && keyAtPress === farId && !!guardOverride && guardOverride.key === farId && !banners.some(b => /OVERRIDE ENDED/.test(b)),
        () => "level " + l18m + " at " + (m18m != null ? m18m.toFixed(1) : "?") + " m (the pier is nearest the boat), key after a clear frame " + JSON.stringify(keyOnClear)
            + ", key at a press on the not-released frame " + JSON.stringify(keyAtPress) + ", 50 s on " + JSON.stringify(guardOverride) + ", banners " + JSON.stringify(banners));

  // ── 18n-18t. THE REVIEW'S UNPINNED BEHAVIORS (2026-09-28) ──────────────────────────────────────────────────
  // 18n. RELEASE LOW is in reach at the HOLD rung too, and hidden when nothing is latched
  surveying(7, [PARKED()]); resumeSlow = true; frame();
  const relHold = EL["#gb_release"].style.display, rungHold = clearance.level;
  surveying(7, [PARKED()]); frame();
  const relNone = EL["#gb_release"].style.display;
  check("18n. the latch's release is on the bar at the HOLD rung (not only at SLOW), and off it when nothing is latched",
        () => rungHold === "hold" && relHold === "" && relNone === "none",
        () => "hold rung: " + rungHold + " release '" + relHold + "'; unlatched '" + relNone + "'");
  // 18o. the latch bar is not drawn while paused, nor while an escape holds the throttle; the guard's own slow-down is
  //      not released while the plan's speed would read SLOW (the pre-existing half of the counterfactual, pinned)
  surveying(7, []); resumeSlow = true; S = { ...S, run: "paused" }; frame();
  const barPaused = EL["#guardBar"].style.display;
  surveying(7, []); resumeSlow = true; escapeThrottle = true; frame();
  const barEsc = EL["#guardBar"].style.display;
  escapeThrottle = false;
  surveying(7, [], { ko: BLOCK120 }); frame();                           // the GUARD slows her (clearance.slowed) - see FAR
  const slowedByGuard = clearance.slowed === true;
  speed(4); clock += 2000; aisPolledAt = clock; frame(); clock += 5000; aisPolledAt = clock; frame();
  check("18o. the latch bar is not drawn on a paused boat nor under an escape; and the guard's OWN slow-down is not released while the plan's speed would read SLOW, the dwell notwithstanding",
        () => barPaused === "none" && barEsc === "none" && slowedByGuard && clearance.slowed === true && guardLevel === "slow",
        () => "paused " + barPaused + ", escape " + barEsc + ", slowed by the guard " + slowedByGuard + " still " + clearance.slowed + ", guardLevel " + guardLevel);
  // 18p. in extremis ends the override - driven, not a source pin: a workboat northbound at 6 kn 40 m south, her sweep
  //      already over the boat (check 9's fixture) reads HELM
  surveying(7, [FAR()]); frame();
  press();
  escFake = { hdg: 90, to: { e: 60, n: 0 }, m: 60, capped: false, clear: true, survived: 45, worst: 30, gain: 30 };
  aisVessels = [contact(0, -40, { sog: 6, cog: 0, heading: 0 })]; clock += 2000; aisPolledAt = clock; frame();
  check("18p. a frame in extremis ends the override (helm was never covered)",
        () => clearance.level === "helm" && guardOverride === null,
        () => "level " + clearance.level + ", override " + JSON.stringify(guardOverride));
  // 18q. `closing` needs the contact under way to be the NEAREST hazard: a workboat far off closing 8 m does not lapse an
  //      override on the parked contact ahead
  surveying(7, [FAR(), contact(300, -60, { mmsi: 555, name: "FAR TUG", sog: 6, cog: 0, heading: 0 })]); frame(); press(); banners = [];
  aisVessels = [FAR(), contact(292, -60, { mmsi: 555, name: "FAR TUG", sog: 6, cog: 0, heading: 0 })]; clock += 2000; aisPolledAt = clock; frame();
  check("18q. a contact under way 300 m off closing 8 m does not lapse an override on the PARKED contact ahead - only the nearest hazard closing counts",
        () => !!guardOverride && guardOverride.key === farId && !banners.some(b => /LAPSED/.test(b)),
        () => "override " + JSON.stringify(guardOverride) + ", banners " + JSON.stringify(banners));
  // 18r. RELEASE LOW leaves a full PROCEED standing and resets the commanded speed
  surveying(7, [FAR()]); frame(); press(); resumeSlow = true; commandedSpeed = "low";
  releaseLow("the test");
  check("18r. RELEASE LOW ends only a LOW override: a full PROCEED stands, and the commanded speed is cleared for the governor to decide",
        () => !!guardOverride && !guardOverride.slow && resumeSlow === false && commandedSpeed === null,
        () => "override " + JSON.stringify(guardOverride) + ", commandedSpeed " + commandedSpeed);
  // 18s. the PROCEED and CONTINUE AT LOW handlers adopt the hazard the bar showed (source), and the key is judged at the
  //      entry point (source) - the fixture's press() copies the handler, so the handlers themselves are pinned here
  const proceedSrc = H.slice(H.indexOf('$("#gb_proceed").onclick'), H.indexOf('$("#gb_proceed").onclick') + 900);
  const contSrc = H.slice(H.indexOf("function continueAtLow(){"), H.indexOf("function continueAtLow(){") + 500);
  const keySrc = H.slice(H.indexOf("function guardHazardKey("), H.indexOf("function guardHazardKey(") + 400);
  check("18s. the real PROCEED and CONTINUE AT LOW handlers adopt guardKeyLast, and the hazard key is judged at the assessment's ENTRY point, not at the boat",
        () => /key: guardKeyLast \? guardKeyLast\.id : null/.test(proceedSrc) && /key: guardKeyLast \? guardKeyLast\.id : null/.test(contSrc)
              && /const at = \(a && a\.entry\) \? a\.entry : p;/.test(keySrc),
        () => "proceed " + /guardKeyLast/.test(proceedSrc) + ", continue " + /guardKeyLast/.test(contSrc) + ", entry " + /a\.entry/.test(keySrc));
  // 18t. the console's own return keeps an operator's LOW latch, and says so
  surveying(7, [PARKED()]); frame(); nowHolding(); resumeSlow = true; sent = []; banners = []; notes = []; logged = []; pinCalls = []; pinNext = null;
  clock += 5000; aisPolledAt = clock; frame();
  aisAroundNow(); await settle();
  check("18t. an operator's LOW latch standing before the hold survives the console's own way round - kept, and the banner says 'still at LOW on your authority'",
        () => resumeSlow === true && paths().includes("/api/cmd/start") && banners.some(b => /ROUTED ROUND/.test(b) && /still at LOW on your authority/.test(b)),
        () => "resumeSlow " + resumeSlow + ", sent " + JSON.stringify(paths()) + ", banners " + JSON.stringify(banners.filter(b => /ROUTED/.test(b)).map(b => b.slice(-140))));
  resumeSlow = false;
  const noRelease2 = releaseLow("nothing latched");
  check("18i. ... and with nothing latched RELEASE LOW does nothing and says so by answering false", () => noRelease2 === false, () => String(noRelease2));
}

// ── 19. THE TIGHTER WAY ROUND (Andy, 2026-09-28: "why did the rejoin go 587m down the line" and "Too much distance
//        from the AIS target and a long failure to regain the survey line. Make the avoidance maneuver tighter and
//        recover the survey line sooner."). His 19:25 run: KLEOS on line 6; FRIGGA anchored 35 m off its far end;
//        the rejoin 375 m on, the way in 48-63 m off KLEOS. ─────────────────────────────────────────────────────────
{
  // 19. FRIGGA: a second contact, anchored 32 m off the line near its far end, in nobody's way
  const FRIGGA = () => contact(150, 32, { mmsi: 777000777, name: "FRIGGA", sog: 0, cog: null, heading: null, dim: null, length: null, beam: null });
  surveying(7, [PARKED(), FRIGGA()]); frame(); nowHolding();
  sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  clock += 5000; aisPolledAt = clock; frame();
  const herMmsi = aisAvoid && aisAvoid.mmsi;
  aisAroundNow(); await settle();
  const up19 = sent.find(x => x.p === "/api/cmd/upload"), rte19 = (up19 && up19.route) || [];
  const ev19 = logged.find(e => e.kind === "ais_around");
  check("19. a second contact anchored 32 m off the far end of the line (FRIGGA: her own ship-length ring would come within 1.2 m of it) does NOT push the rejoin past her: it is e = 65, a ship-length past the contact the survey is held for, and the episode names that one by MMSI",
        () => herMmsi === 338111222 && !!up19 && distTo(rejoinOf(rte19), ll(65, 0)) < 0.5 && !!ev19 && ev19.data.skip_m === 65 && ev19.data.mmsi === 338111222,
        () => "episode mmsi " + herMmsi + "; upload " + rte19.length + " wpts, rejoin " + (rejoinOf(rte19) ? distTo(rejoinOf(rte19), ll(65, 0)).toFixed(1) + " m from (65,0)" : "none")
            + "; logged " + JSON.stringify(ev19 && ev19.data));

  // 19b. two contacts ON the line: the second inside the hold horizon after the first -> the way round goes past both;
  //      the second beyond it -> the survey is picked up between them (the guard answers the second when she gets there)
  const SECOND = (e) => contact(e, 0, { mmsi: 888000888, name: "SECOND", sog: 0, cog: null, heading: 90, dim: null, length: null, beam: null });
  surveying(7, [PARKED(), SECOND(100)]); frame(); nowHolding(); sent = []; logged = []; pinCalls = [];
  clock += 5000; aisPolledAt = clock; frame();
  aisAroundNow(); await settle();
  const rte19b = ((sent.find(x => x.p === "/api/cmd/upload") || {}).route) || [];
  surveying(7, [PARKED(), SECOND(170)]); frame(); nowHolding(); sent = []; logged = []; pinCalls = [];
  clock += 5000; aisPolledAt = clock; frame();
  aisAroundNow(); await settle();
  const rte19b2 = ((sent.find(x => x.p === "/api/cmd/upload") || {}).route) || [];
  check("19b. a second hull ON the line 45 m past the first (inside the hold horizon at the survey speed, 72 m) - the way round goes past BOTH (e = 115, 5 m past her hull and the standoff); one 115 m past (beyond it) - the survey is picked up between them (e = 65)",
        () => distTo(rejoinOf(rte19b), ll(115, 0)) < 0.5 && distTo(rejoinOf(rte19b2), ll(65, 0)) < 0.5 && Math.abs(GUARD_HOLD_S * roleSpeedMS("survey") - 72.0) < 0.1,
        () => "second at 100: rejoin " + (rejoinOf(rte19b) ? JSON.stringify(ref.toEN(rejoinOf(rte19b))) : "none") + "; second at 170: rejoin "
            + (rejoinOf(rte19b2) ? JSON.stringify(ref.toEN(rejoinOf(rte19b2))) : "none") + "; run-out " + (GUARD_HOLD_S * roleSpeedMS("survey")).toFixed(1));

  // 19c. THE ROUTER FALLBACK: charted walls on both sides of her ring - neither taut side can be certified - so the
  //      router's own search is asked, with HER as the ship-length ring and nothing else grown
  const wallN = [{ e: 5, n: 22 }, { e: 60, n: 22 }, { e: 60, n: 60 }, { e: 5, n: 60 }], wallS = wallN.map(p => ({ e: p.e, n: -p.n }));
  const WALLS = { polys: [{ ring: wallN, bb: bbOf(wallN), kind: "a dock / pier" }, { ring: wallS, bb: bbOf(wallS), kind: "a dock / pier" }],
                  lines: [], points: [], marks: [], sys: [], chans: [] };
  surveying(7, [PARKED(), FRIGGA()], { ko: WALLS }); frame(); nowHolding(); sent = []; pinCalls = []; pinNext = null;
  clock += 5000; aisPolledAt = clock; frame();
  const held19c = !!aisAvoid;
  aisAroundNow(); await settle();
  const ask19c = pinCalls[pinCalls.length - 1];
  const polys19c = (ask19c && ask19c.opts && ask19c.opts.ko && ask19c.opts.ko.polys) || [];
  const herP = polys19c.find(p => p.mmsi === 338111222), friggaP = polys19c.find(p => p.mmsi === 777000777);
  check("19c. with charted walls on both sides of her ring the taut way round cannot be certified, so the router's own search is asked - at the standoff, as a fly-through, the model HER ship-length ring (30 m round her) plus FRIGGA as the guard's BARE hull and the walls",
        () => held19c && !!ask19c && ask19c.opts.standoffM === 3 && ask19c.opts.flyThrough === true && !!herP && herP.roundM === 30 && /30 m round her/.test(herP.kind)
              && !!friggaP && friggaP.roundM == null && !/round her/.test(friggaP.kind) && polys19c.filter(p => /pier/.test(p.kind)).length === 2,
        () => "held " + held19c + "; asked " + JSON.stringify(ask19c && { standoff: ask19c.opts.standoffM, kinds: polys19c.map(p => p.kind) }));

  // 19d. IN A SET: the standoff outgrows her length, and her hull (plus the buffer) is what the way round keeps its
  //      standoff from - the guard's own line - not her hull grown by her length AND the standoff
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; logged = []; pinCalls = [];
  clock += 5000; aisPolledAt = clock;               // between frames (15's note): the set, then the press
  S = { ...S, status: { ...S.status, env_set_kn: 1.75, env_set_deg: 90 } };
  const std19d = patClipBufM();
  aisAroundNow(); await settle();
  const rte19d = ((sent.find(x => x.p === "/api/cmd/upload") || {}).route) || [];
  // Held 15 m off her hull - INSIDE the standoff - so the way in first moves straight away from her center, and is
  // measured from where that leaves her standoff: every point after it keeps the standoff plus the buffer off her hull.
  const via19d = viaOf(rte19d), out19d = via19d[0];
  const wayIn19d = [...via19d, rejoinOf(rte19d)], dH19d = minClearTo(wayIn19d, parkedHull()), dC19d = minDistTo(wayIn19d, PARKED_C);
  const hull19d = parkedHull(), clr0 = clearanceM(ref.toEN(ll(0, 0)), { polys: [hull19d], lines: [], points: [] }, 500);
  const clrOut = out19d ? clearanceM(ref.toEN(out19d), { polys: [hull19d], lines: [], points: [] }, 500) : -1;
  check("19d. in a 1.75 kn set (standoff 19.5 m) the rejoin is where her hull plus the buffer plus the standoff ends (e = 70: hull to 45, +3, +19.5 - it was e = 95 with her length added too); held 15 m off her hull, the way in first moves straight AWAY from her, and from there keeps at least the standoff plus the buffer off her HULL (22.5 m) and no more than 2 m beyond it",
        () => Math.abs(std19d - 19.5) < 0.1 && distTo(rejoinOf(rte19d), ll(70, 0)) < 0.5 && !!out19d && clrOut > clr0 + 5
              && dH19d >= 22.5 - 0.05 && dH19d <= 24.5
              && logged.some(e => e.kind === "ais_around" && e.data.std_m === 19.5 && e.data.skip_m === 70),
        () => "std " + std19d.toFixed(2) + "; rejoin " + (rejoinOf(rte19d) ? JSON.stringify(ref.toEN(rejoinOf(rte19d))) : "none") + "; held " + clr0.toFixed(1)
            + " m off her hull, moved out to " + clrOut.toFixed(1) + " m; from there off her hull " + dH19d.toFixed(2)
            + " m, off her center " + dC19d.toFixed(2) + " m; logged " + JSON.stringify((logged.find(e => e.kind === "ais_around") || {}).data));
  S = { ...S, status: { ...S.status, env_set_kn: 0 } };

  // 19f. WITHOUT AN MMSI she is the first contact the line AHEAD runs into - not merely the nearest one
  surveying(7, [PARKED(), contact(5, 18, { mmsi: 999000999, name: "BESIDE", sog: 0, cog: null, heading: null, dim: null, length: null, beam: null })]);
  frame(); nowHolding(); clock += 5000; aisPolledAt = clock; frame();
  const g19f = guardHeldOffer();
  const plan19f = g19f ? aisAroundPlan(g19f, aisKoDrawn, 3, null) : null;
  const nearestToBoat = aisNearestPoly(ref.toEN(ll(0, 0)), aisKoDrawn);
  check("19f. with no MMSI to go on, HER is the first contact the line ahead runs into (the WORKBOAT across it), not the nearest one to the boat (BESIDE, 7 m off her track), and the rejoin is past the WORKBOAT",
        () => !!plan19f && !!plan19f.her && plan19f.her.mmsi === 338111222 && !!nearestToBoat && nearestToBoat.mmsi === 999000999 && distTo(plan19f.to, ll(65, 0)) < 0.5,
        () => "her " + (plan19f && plan19f.her && plan19f.her.name) + ", nearest to the boat " + (nearestToBoat && nearestToBoat.name) + ", rejoin " + (plan19f && plan19f.to ? JSON.stringify(ref.toEN(plan19f.to)) : JSON.stringify(plan19f)));

  // 19g. THE MMSI NAMES HER (mutation R5): on a RUNNING survey the operator right-clicks the FAR contact of two on the
  //      line - the way round goes round the one they named, not the first one the line runs into
  const FARB = () => contact(150, 0, { mmsi: 555000555, name: "FARBOAT", sog: 0, cog: null, heading: 90, dim: null, length: null, beam: null });
  surveying(7, [PARKED(), FARB()]); aisKeepoutsNow(); sent = []; notes = []; logged = []; pinCalls = [];
  const r19g = await avoidContactAt(ll(150, 0));
  const am19g = sent.find(x => x.p === "/api/cmd/amend"), rte19g = (am19g && am19g.route) || [];
  const ev19g = logged.find(e => e.kind === "ais_around");
  check("19g. right-clicking the FAR of two contacts on the line routes round HER - the one named, found by her MMSI - rejoining past her (e = 175: her assumed 20 m length about her center at 150, the standoff, the next 5 m step), not past the near one the line runs into first",
        () => r19g === true && !!ev19g && ev19g.data.mmsi === 555000555 && ev19g.data.round_m === 20 && distTo(rejoinOf(rte19g), ll(175, 0)) < 0.5,
        () => "returned " + r19g + "; rejoin " + (rejoinOf(rte19g) ? JSON.stringify(ref.toEN(rejoinOf(rte19g))) : "none") + "; logged " + JSON.stringify(ev19g && ev19g.data));

  // 19h. THE SHORTER SIDE (mutation R13): her center 10 m NORTH of the line - the taut way passes SOUTH of her
  const NORTHOF = () => contact(30, 10, { sog: 0, cog: null, heading: 90 });
  surveying(7, [NORTHOF()]); aisKeepoutsNow(); sent = []; notes = []; logged = []; pinCalls = [];
  const r19h = await avoidContactAt(ll(30, 10));
  const am19h = sent.find(x => x.p === "/api/cmd/amend"), rte19h = (am19h && am19h.route) || [], via19h = viaOf(rte19h);
  check("19h. with her center 10 m north of the line the taut way round takes the SHORTER side - every waypoint of it south of the line - and still a ship-length off her center",
        () => r19h === true && via19h.length >= 1 && via19h.every(w => ref.toEN(w).n < 0)
              && minDistTo(wayInOf(rte19h, ll(0, 0)), { e: 30, n: 10 }) >= 30 - 0.05,
        () => "returned " + r19h + "; via n " + JSON.stringify(via19h.map(w => +ref.toEN(w).n.toFixed(1))));

  // 19i. THE HELD WAY IN IS JUDGED AT THE STANDOFF (mutation R15): held, then set 40 m north of the line in a 1.75 kn
  //      set - the straight run to the rejoin would pass her ring about 5 m off, clear of the 3 m buffer and well inside
  //      the 19.5 m standoff, so it is ROUTED round her and not flown straight
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; logged = []; pinCalls = [];
  clock += 5000; aisPolledAt = clock;               // between frames (15's note): the set, then the press
  asv = ll(0, 40);
  S = { ...S, status: { ...S.status, env_set_kn: 1.75, env_set_deg: 90 } };
  aisAroundNow(); await settle();
  const rte19i = ((sent.find(x => x.p === "/api/cmd/upload") || {}).route) || [];
  const wayIn19i = wayInOf(rte19i, ll(0, 40)), dH19i = minClearTo(wayIn19i, parkedHull());
  check("19i. held, then 40 m north of the line in a 1.75 kn set: the straight run to the rejoin would pass her ring inside the standoff though outside the buffer - so it is ROUTED round her, the way in at least the standoff plus the buffer off her hull",
        () => distTo(rejoinOf(rte19i), ll(70, 0)) < 0.5 && viaOf(rte19i).length >= 1 && dH19i >= 22.5 - 0.05,
        () => "rejoin " + (rejoinOf(rte19i) ? JSON.stringify(ref.toEN(rejoinOf(rte19i))) : "none") + "; via " + viaOf(rte19i).length + "; off her hull " + dH19i.toFixed(2) + " m");
  S = { ...S, status: { ...S.status, env_set_kn: 0 } }; asv = ll(0, 0);
}

// ── 20. FRIGGA (Andy's console, 2026-09-28 21:19:45): THE GUARD'S HOLD BETWEEN THE WAY ROUND'S UPLOAD AND ITS START ──
// His log: held 48 m off FRIGGA in a 1.75 kn set; six seconds into the hold the clear branch read the station-keeping
// boat as clear and released the hold rung's latch ("Clear ahead again (43.3 m)"). The way round then paused her and
// uploaded the route round her (STAGED), and PAUSED she drifted toward FRIGGA: the ladder read a fresh HOLD 42 s out and
// the rung posted /api/cmd/hold 51 ms later, replacing the staged route round. The Start answered "Station-keep
// started", the page announced ROUTED ROUND and spent the held survey, and every later press resumed only the hold.
// Replayed with the guard ticking between the resume's commands (onReply).
const OWNS_MS = +H.match(/const HELD_RESUME_OWNS_MS = (\d+)/)[1];
// held for her, then station-keeping with a little way on AWAY from her - the station-keep's own motion. On his
// console the clear branch released the hold rung's latch here, at 21:19:04; since 2026-09-29 it does not (check 21),
// so these replays run with the latch KEPT - the console as it is now - and with the upload STAGED on the vessel,
// where the rung's only answer is a hold at her present position. Answers whether the latch was kept.
// ⚠ `hook` IS INSTALLED HERE, NOT BY THE CALLER (2026-11-01). With the operator's wait gone the way round
// goes on the FIRST station frame, which is the first frame of the loop below - so a caller that armed its
// onReply afterwards would arm it after the resume it meant to watch. `surveying` clears onReply, so the
// hook cannot be armed before this call either: it has to come in through the door.
// `before` is for the same reason: `surveying` clears escFake and `lost` too, so a scenario that arms either
// has to arm it in here, after the reset and before the frame that launches the way round.
function heldAndKept(hook, before) {
  surveying(7, [PARKED()]); frame(); nowHolding();
  const held = !!guardHeld && !!aisAvoid && guardActedAt > 0;
  S = { ...S, status: { ...S.status, sog_kn: 0.3, cog_deg: 270, heading_deg: 90 } };
  sent = []; banners = []; notes = []; logged = [];
  if (before) before();
  if (hook) onReply = hook;
  for (let k = 0; k < 6; k++) { clock += 1000; aisPolledAt = clock; frame(); }
  return held && guardActedAt > 0 && guardLevel !== "clear";
}
// paused, and set toward her at `kn`: 1 kn is a HOLD 23 s out (the rung's own reading at 21:19:45.801), 1.75 kn a HELM 13 s out
const pausedSetToward = (kn) => { S = { ...S, status: { ...S.status, sog_kn: kn, cog_deg: 90, heading_deg: 90, holding: false,
                                                                   env_set_kn: kn, env_set_deg: 90 } }; };
{
  let midLevel = null, midBanners = null, midSent = null;
  const kept = heldAndKept((p) => {
    if (p !== "/api/cmd/upload") return;
    pausedSetToward(1.0);
    const b0 = banners.length, n0 = sent.length; frame();
    midLevel = clearance.level; midBanners = banners.slice(b0); midSent = sent.slice(n0).map(x => x.p);
  });
  await settle();                                   // the way round went on the first station frame (2026-11-01)
  onReply = null;
  const seq20 = paths();
  check("20. FRIGGA: held for her (the latch kept), the way round paused her and uploaded - STAGED - and PAUSED she drifted toward her; the ladder reads HOLD mid-resume, where a paused boat with a plan staged gets the rung's hold, and posts NOTHING: pause, upload, LOW, Start, the route round started and announced, the record spent",
        () => kept && midLevel === "hold" && midSent && midSent.length === 0
              && JSON.stringify(seq20) === JSON.stringify(["/api/cmd/pause", "/api/cmd/upload", "/api/cmd/speed", "/api/cmd/start"])
              && banners.some(b => /ROUTED ROUND/.test(b)) && guardHeld === null && aisAvoid === null,
        () => "latch kept " + kept + "; mid-resume level " + midLevel + ", sent then " + JSON.stringify(midSent)
            + "; sent " + JSON.stringify(seq20) + "; banners " + JSON.stringify(banners.map(b => b.slice(0, 70))));
  check("20a. ... and no '⚠ HOLD ... holding still answers it' banner from inside the resume - on his console it came a third of a second before ROUTED ROUND and read as the console holding her",
        () => midBanners !== null && !midBanners.some(b => /^⚠ HOLD/.test(b)),
        () => "mid-resume banners " + JSON.stringify(midBanners));
}
{
  // 20b. IN EXTREMIS MID-RESUME, at each of the resume's steps: the helm rung never stands by - it escapes - and the
  //      resume does not go on over it. After the pause: nothing is uploaded. After the upload: no LOW (it would slow
  //      the escape), no Start. After the LOW: no Start. After the Start: no ROUTED ROUND. Each time it says so, and
  //      the held survey and the episode stand.
  const got = [];
  for (const at of ["/api/cmd/pause", "/api/cmd/upload", "/api/cmd/speed", "/api/cmd/start"]) {
    const latchKept = heldAndKept();
    escFake = { hdg: 0, to: { e: 0, n: 60 }, m: 60, capped: false, clear: true, survived: 45, worst: 30, gain: 30 };
    const kept = guardHeld, ep = aisAvoid;
    let midSent = null;
    onReply = (p) => {
      if (p !== at || midSent) return;
      pausedSetToward(1.75);
      const n0 = sent.length; frame(); clock += 1600; frame(); midSent = sent.slice(n0).map(x => x.p);
    };
    sent = []; banners = []; notes = []; logged = [];
    clock += WHILE_MS - 6000; aisPolledAt = clock; frame(); await settle();
    onReply = null;
    const after = paths().slice(paths().indexOf("/api/cmd/escape") + 1);
    got.push({ at, latchKept, esc: !!midSent && midSent.includes("/api/cmd/escape"), after,
               upload: paths().includes("/api/cmd/upload"), start: paths().includes("/api/cmd/start"),
               routed: banners.some(b => /ROUTED ROUND/.test(b)),
               said: banners.some(b => /THE WAY ROUND IS NOT RUNNING/.test(b) && /took the helm/.test(b) && /on the guard's escape/.test(b)),
               kept: guardHeld === kept && aisAvoid === ep,
               logged: logged.some(e => e.kind === "resume_not_running" && e.data.guard === "took the helm" && e.data.around === true) });
    escFake = null;
  }
  const want = { "/api/cmd/pause": [], "/api/cmd/upload": [], "/api/cmd/speed": [], "/api/cmd/start": [] };
  check("20b. in extremis mid-resume the helm rung escapes - it never stands by - and the resume sends NOTHING after the escape at any of its four steps (no upload after the pause, no LOW and no Start after the upload, no Start after the LOW), announces no way round, says why, and keeps the held survey and the episode",
        () => got.length === 4 && got.every(g => g.latchKept && g.esc && JSON.stringify(g.after) === JSON.stringify(want[g.at]) && !g.routed && g.said && g.kept && g.logged)
              && got[0].upload === false && got[3].start === true,
        () => got.map(g => g.at.replace("/api/cmd/", "") + ": latch kept " + g.latchKept + ", escaped " + g.esc + ", then " + JSON.stringify(g.after)
                           + ", routed " + g.routed + ", said " + g.said + ", kept " + g.kept + ", logged " + g.logged).join(" | "));
}
{
  // 20c. THE START'S OWN ANSWER (FRIGGA's "Station-keep started"): the vessel says it started its station-keep plan -
  //      no ROUTED ROUND, the record and the episode kept, and it says what happened
  surveying(7, [PARKED()]); frame(); nowHolding();
  clock += 5000; aisPolledAt = clock;               // between frames (15's note): the answer is armed, then pressed
  replyState["/api/cmd/start"] = { behavior: "hold", note: "Station-keep started (will loiter / station-keep at the end)." };
  const kept = guardHeld, ep = aisAvoid, route20c = runRoute;
  sent = []; banners = []; notes = []; logged = [];
  const r20c = aisAroundNow(); await settle();
  replyState = {};
  check("20c. the Start answers with the vessel's STATION-KEEP plan: no way round is announced - it says the way round is NOT RUNNING, why, and that the console keeps trying itself, every frame - and the held survey, the episode and the logged record stand",
        () => r20c === true && paths().includes("/api/cmd/start") && !banners.some(b => /ROUTED ROUND/.test(b))
              && banners.some(b => /THE WAY ROUND IS NOT RUNNING/.test(b) && /answered Start with its station-keep plan/.test(b) && /keeps trying itself, every frame/.test(b))
              && guardHeld === kept && aisAvoid === ep && runRoute === route20c && !logged.some(e => e.kind === "ais_around")
              && logged.some(e => e.kind === "resume_not_running" && /station-keep/.test(e.data.why)),
        () => "returned " + r20c + "; sent " + JSON.stringify(paths()) + "; banners " + JSON.stringify(banners.map(b => b.slice(0, 120)))
            + "; record " + (guardHeld === kept ? "kept" : "CHANGED") + ", episode " + (aisAvoid === ep ? "kept" : "CHANGED")
            + ", drawn route " + (runRoute === route20c ? "the held survey's" : "NOT the held survey's"));
  // ⚠⚠ 20d. ... THE BAR COUNTS NOTHING, AND THE NEXT TRY GOES WHEN THE MODEL MOVES (rewritten 2026-11-02
  // for "Delete that"). It used to assert "nothing at 8 s, the way round at 11 s" - a clock. There is no clock:
  // a frame on the SAME model is stood aside however long she holds, and the first frame carrying a fresh AIS
  // poll is the retry. That is strictly faster than the 10 s it replaces, which is the point of the change.
  renderGuardBar({ level: "blind" }, clearance);
  const why20d = $("#gb_why").textContent;
  sent = []; banners = []; clock += 60000; frame(); await settle();   // 60 s on the same model: nothing
  const at20 = paths().slice();
  replyState["/api/cmd/start"] = { behavior: "survey" };
  clock += 1000; aisPolledAt = clock; frame(); await settle();        // a fresh poll: the retry goes
  replyState = {};
  check("20d. ... the bar counts NOTHING - it says 'now' - and the next try goes when the MODEL moves, not on a clock: 60 s on the same model sends nothing, and the first frame with a fresh AIS poll routes her round, starts the remainder, says so, and spends both records",
        () => /routes round her itself now/.test(why20d) && !/routes round her itself in \d+ s/.test(why20d) && at20.length === 0
              && paths().indexOf("/api/cmd/pause") === 0 && paths().includes("/api/cmd/start")
              && banners.some(b => /ROUTED ROUND/.test(b)) && guardHeld === null && aisAvoid === null,
        () => "bar '" + why20d.slice(-80) + "'; at 20 s " + JSON.stringify(at20) + "; at 31 s " + JSON.stringify(paths())
            + "; banners " + JSON.stringify(banners.map(b => b.slice(0, 60))));
}
{
  // 20e. THE STAND-BY IS BOUNDED AND NEVER COVERS HELM
  const was = [heldResuming, heldResumingAt];
  heldResuming = true; heldResumingAt = clock;
  const hold0 = heldResumeOwns("hold", clock), helm0 = heldResumeOwns("helm", clock),
        slowLate = heldResumeOwns("slow", clock + OWNS_MS - 1), holdOver = heldResumeOwns("hold", clock + OWNS_MS);
  heldResuming = false;
  const notIn = heldResumeOwns("hold", clock);
  [heldResuming, heldResumingAt] = was;
  check("20e. the stand-by is bounded and never covers helm: a resume in flight has her below helm, never at helm, and not once HELD_RESUME_OWNS_MS (" + OWNS_MS / 1000 + " s) has run - a resume stalled on a dead link hands the ladder back",
        () => hold0 === true && helm0 === false && slowLate === true && holdOver === false && notIn === false && OWNS_MS === 10000,
        () => "hold " + hold0 + ", helm " + helm0 + ", slow at " + (OWNS_MS - 1) + " ms " + slowLate + ", hold at " + OWNS_MS + " ms " + holdOver + ", not resuming " + notIn);
}
{
  // 20f. THE 100 m RETURN THAT DID NOT START. It spends its episode before it calls the resume (aisReturnTick), so a
  //      Start that answered the station-keep plan would have left nothing to try again with: the episode is PUT BACK,
  //      its dwell to run again, and once the line has read clear for AIS_RETURN_DWELL_MS more the return goes again.
  surveying(7, [CROSSING()]); frame(); nowHolding();
  const her20f = (t) => { aisVessels = [contact(34, -5 + 3.087 * t, { sog: 6, cog: 0, heading: 0 })]; aisPolledAt = clock; };
  const kept = guardHeld, route0 = runRoute;
  clock += 8000; her20f(8); frame(); clock += 4100; her20f(12.1);
  replyState["/api/cmd/start"] = { behavior: "hold" };
  sent = []; banners = []; logged = [];
  frame(); await settle();
  replyState = {};
  // the episode as it was put back - read NOW, because the frames below move the same object's dwell on
  const first = paths().slice(), ep = aisAvoid ? { ...aisAvoid } : null, keptF = guardHeld === kept, routeF = runRoute === route0;
  const saidF = banners.some(b => /THE SURVEY IS NOT RUNNING/.test(b) && /tries again once the line reads clear again/.test(b));
  sent = []; banners = [];
  clock += 1000; her20f(13.1); frame(); clock += 4100; her20f(17.2); frame(); await settle();
  check("20f. a 100 m return whose Start answered the station-keep plan: NOT RUNNING said, the record kept, its spent episode PUT BACK with the dwell to run again - and 4 s of clear line later the return goes again and this time starts",
        () => first.includes("/api/cmd/start") && saidF && keptF && routeF && !!ep && ep.clearSince === 0
              && paths().includes("/api/cmd/upload") && paths().includes("/api/cmd/start")
              && banners.some(b => /SURVEY RESUMED/.test(b)) && guardHeld === null && aisAvoid === null,
        () => "first " + JSON.stringify(first) + ", said " + saidF + ", record kept " + keptF + ", drawn route kept " + routeF
            + ", episode " + JSON.stringify(ep) + "; again " + JSON.stringify(paths()) + ", banners " + JSON.stringify(banners.map(b => b.slice(0, 60))));
}
{
  // 20g. A RESUME STALLED PAST THE STAND-BY (a slow link): the ladder has her back and the hold rung holds her - and the
  //      resume does not Start over the guard's hold
  let midSent = null, kept = null, ep = null;
  const latchKept = heldAndKept((p) => {
    if (p !== "/api/cmd/upload" || midSent) return;
    pausedSetToward(1.0);
    clock += OWNS_MS + 500;                       // the upload's round trip outlasted the stand-by
    const n0 = sent.length; frame(); midSent = sent.slice(n0).map(x => x.p);
  }, () => { kept = guardHeld; ep = aisAvoid; });
  await settle();
  onReply = null;
  check("20g. a resume stalled past the " + OWNS_MS / 1000 + " s stand-by: the hold rung has her back and HOLDS her - and the resume sends nothing more, no LOW and no Start: NOT RUNNING, 'held her again', station-keeping, the record and the episode kept",
        () => latchKept && midSent && midSent.includes("/api/cmd/hold")
              && JSON.stringify(paths()) === JSON.stringify(["/api/cmd/pause", "/api/cmd/upload", "/api/cmd/hold"])
              && banners.some(b => /THE WAY ROUND IS NOT RUNNING/.test(b) && /held her again/.test(b) && /She is station-keeping/.test(b))
              && guardHeld === kept && aisAvoid === ep,
        () => "latch kept " + latchKept + "; mid-resume sent " + JSON.stringify(midSent) + "; sent " + JSON.stringify(paths())
            + "; banners " + JSON.stringify(banners.map(b => b.slice(0, 110))));
}
{
  // 20h. THE UPLOAD'S ANSWER LOST WHILE THE HELM RUNG ESCAPED: the failed-upload path puts a paused boat back on
  //      station with a hold - which here would land on top of the escape just sent. It does not.
  const latchKept = heldAndKept();
  escFake = { hdg: 0, to: { e: 0, n: 60 }, m: 60, capped: false, clear: true, survived: 45, worst: 30, gain: 30 };
  const kept = guardHeld, ep = aisAvoid;
  let midSent = null;
  onReply = (p) => {
    if (p !== "/api/cmd/upload" || midSent) return;
    pausedSetToward(1.75);
    const n0 = sent.length; frame(); clock += 1600; frame(); midSent = sent.slice(n0).map(x => x.p);
  };
  lost = "/api/cmd/upload";
  sent = []; banners = []; logged = [];
  clock += WHILE_MS - 6000; aisPolledAt = clock; frame(); await settle();
  onReply = null; lost = null; escFake = null;
  const after20h = paths().slice(paths().indexOf("/api/cmd/escape") + 1);
  check("20h. the upload's answer LOST while the helm rung escaped: the failed-upload path does not put her 'back on station' over the escape - nothing is sent after it, NOT RUNNING is said with the cause, the record and the episode kept",
        () => latchKept && midSent && midSent.includes("/api/cmd/escape") && after20h.length === 0
              && banners.some(b => /THE WAY ROUND IS NOT RUNNING/.test(b) && /took the helm while the remainder was being uploaded/.test(b))
              && guardHeld === kept && aisAvoid === ep,
        () => "latch kept " + latchKept + "; mid-resume sent " + JSON.stringify(midSent) + "; after the escape " + JSON.stringify(after20h)
            + "; banners " + JSON.stringify(banners.map(b => b.slice(0, 110))));
}

// Claim the CURRENT model as the one a try was already refused on, so aisAroundTick stands aside and the
// scenario's water is untouched. The four fields are the gate's own (aisAroundTick): a fresh AIS poll, a
// new chart read or a changed route all break it, which is exactly what the gate is for.
// ⚠⚠ IT ASKS THE PAGE'S OWN BUILDER (2026-11-03, the third review). This helper used to RE-WRITE aisAroundTick's
// signature expression by hand, so it was a mirror of the page rather than a use of it - and the moment the page's
// expression changed (her live position instead of the frozen bank-time one, the standoff and buffer added, the
// contacts' reports instead of their dead-reckoned boxes) checks 21, 21b and 21c went red with nothing about the
// hold rung having changed at all. A test that fails when the thing it is not testing changes is a test of the
// mirror. aroundTrySig is lifted from the page, so the stand-aside claims exactly the model the tick will compute.
const heldModel = () => {
  if (!aisAvoid || !guardHeld) return;      // no record, nothing to stand aside for (21a clears it on purpose)
  aisAvoid.triedOn = aroundTrySig(guardHeld, aisAvoid);
};
// ── 21. THE HOLD THE GUARD COMMANDED STANDS UNTIL SHE LEAVES IT (2026-09-29, the three open items) ────────────────
// His FRIGGA log again: the clear branch released the hold rung's record six seconds into the hold (a station-keeping
// boat reads clear) and put the throttle back to the transit speed; with the record gone, each Pause was answered by
// a fresh hold where the set had carried her - 48 m off her, then 41, 33, 25.
{
  // 21. item 1: station-keeping frames that read CLEAR release nothing
  // ⚠⚠ THE WAY ROUND IS STOOD ASIDE BY THE MODEL GATE, so that she is still HOLDING to be tested
  // (2026-11-01, relevered 2026-11-02). The subject of this whole block is the hold rung's own record, and
  // since the operator's wait went a boat that CAN be routed round is routed round on her first station
  // frame - which would answer the hold before the check could read it. The old lever was `aroundAt`, the
  // spacing's clock, and the spacing is deleted. The lever now is `triedOn`: the console's own record of the
  // MODEL a refused try was taken on, so claiming the CURRENT model makes the tick answer "nothing has
  // moved" and leaves the water of these scenarios exactly as it was. `heldModel()` is below.
  surveying(7, [PARKED()]); frame(); nowHolding(); heldModel();
  const acted21 = guardActedAt, lvl21 = guardLevel;
  S = { ...S, status: { ...S.status, sog_kn: 0.3, cog_deg: 270, heading_deg: 90 } };
  sent = []; notes = [];
  for (let k = 0; k < 8; k++) { clock += 1000; aisPolledAt = clock; heldModel(); frame(); }
  const read21 = clearance.level, sent21 = paths().slice();
  check("21. held for her and station-keeping, the frames read CLEAR for 8 s and NOTHING is released - no 'Clear ahead again', no speed command, the hold rung's record and the ladder's level stand: the hold is the answer, not a cleared situation",
        () => acted21 > 0 && lvl21 === "hold" && read21 === "clear" && guardActedAt === acted21 && guardLevel === "hold"
              && !notes.some(n => /Clear ahead again/.test(n)) && sent21.length === 0,
        () => "acted " + acted21 + " -> " + guardActedAt + ", level " + lvl21 + " -> " + guardLevel + ", read " + read21
            + ", sent " + JSON.stringify(sent21) + ", notes " + JSON.stringify(notes));
  // 21a. CONTROL: the same frames with the record gone - as his console had it - DO release: the gate is what stops it
  guardActedAt = 0; notes = []; sent = [];
  for (let k = 0; k < 6; k++) { clock += 1000; aisPolledAt = clock; (heldModel(), frame()); }
  // (said as "On station" since 2026-09-30: with the guard's record gone this is an ordinary station-keep, judged on the drift)
  check("21a. CONTROL: the same station-keeping frames with the record gone - as his console had it after 21:19:04 - DO release and say so: the gate on her own hold is what stops it, not the water",
        () => notes.some(n => /Clear ahead again|On station \(/.test(n)) && guardLevel === "clear",
        () => "level " + guardLevel + ", notes " + JSON.stringify(notes));
}
{
  // 21b. item 3: PAUSED on the guard's hold, the set carrying her in - back on station at the hold's own point
  surveying(7, [PARKED()]); frame(); nowHolding(); heldModel();   // inside the spacing, as 21
  clock += 5000; aisPolledAt = clock; (heldModel(), frame());
  S.run = "paused"; pausedSetToward(1.0);
  sent = []; notes = [];
  (heldModel(), frame());
  const first21b = paths().slice(), lvl21b = clearance.level;
  (heldModel(), frame()); clock += 1000; aisPolledAt = clock; (heldModel(), frame());
  const again21b = paths().slice();
  check("21b. PAUSED on the guard's hold with the set carrying her toward her (the ladder reads HOLD): the rung RESUMES the hold she is paused on - /api/cmd/start, back to its own point - and does NOT post a fresh hold where the set has carried her; it says so, and asks once, not every frame",
        () => lvl21b === "hold" && JSON.stringify(first21b) === '["/api/cmd/start"]' && JSON.stringify(again21b) === '["/api/cmd/start"]'
              && notes.some(n => /BACK ON STATION/.test(n) && /not re-held where the set has carried her/.test(n)),
        () => "level " + lvl21b + ", first frame sent " + JSON.stringify(first21b) + ", two more " + JSON.stringify(again21b)
            + ", notes " + JSON.stringify(notes.map(n => n.slice(0, 90))));
  // 21c. ... with a plan STAGED a Start would apply it: the old answer, a hold at her present position, paced
  surveying(7, [PARKED()]); frame(); nowHolding(); heldModel();
  clock += 5000; aisPolledAt = clock; (heldModel(), frame());
  S.run = "paused"; pausedSetToward(1.0); S.plan_staged = true; sent = [];
  (heldModel(), frame()); const staged21c = paths().slice(); (heldModel(), frame()); const staged21c2 = paths().slice();
  check("21c. ... but with a plan STAGED on the vessel (a Start would apply it, not resume the hold) the rung holds her where she is, as it always did - and paced, not every frame",
        () => JSON.stringify(staged21c) === '["/api/cmd/hold"]' && JSON.stringify(staged21c2) === '["/api/cmd/hold"]',
        () => "first " + JSON.stringify(staged21c) + ", next frame " + JSON.stringify(staged21c2));
  // 21d. ... and a STOPPED boat is neither put back nor re-held
  surveying(7, [PARKED()]); frame(); nowHolding(); heldModel();
  clock += 5000; aisPolledAt = clock; (heldModel(), frame());
  S.run = "stopped"; pausedSetToward(1.0); sent = [];
  (heldModel(), frame()); clock += 1000; aisPolledAt = clock; (heldModel(), frame());
  check("21d. ... and a STOPPED boat drifting the same way is neither put back nor re-held: Stop ends the hold, and only the in-extremis rung acts on her then",
        () => clearance.level === "hold" && sent.length === 0,
        () => "level " + clearance.level + ", sent " + JSON.stringify(paths()));
}
{
  // 21e. item 1's other half: the resume that ends the hold ends its record
  surveying(7, [PARKED()]); frame(); nowHolding(); clock += 5000; aisPolledAt = clock; frame();
  const acted21e = guardActedAt, lvl21e = guardLevel;
  sent = [];
  aisAroundNow(); await settle();
  check("21e. the way round that ends the hold ends its record - the hold rung's latch and the ladder's level reset - so the new track is judged afresh: a HOLD on it is a first action, not 'the hold was not taken - re-sending'",
        () => acted21e > 0 && lvl21e !== "clear" && paths().includes("/api/cmd/start") && guardActedAt === 0 && holdWant === null && guardLevel === "clear",
        () => "before: acted " + acted21e + ", level " + lvl21e + "; after: sent " + JSON.stringify(paths()) + ", acted " + guardActedAt
            + ", holdWant " + JSON.stringify(holdWant) + ", level " + guardLevel);
}
{
  // 21f. item 1: the hold's speed - coming onto station is not a transit
  surveying(7, []);
  S = { ...S, behavior: "hold", status: { ...S.status, holding: false, sog_kn: 0.5, env_set_kn: 0 } };
  const roleCalm = speedRole(), keyCalm = roleSpeed(roleCalm);
  S = { ...S, status: { ...S.status, env_set_kn: 5.0, env_set_deg: 90 } };     // stronger than this world's LOW (4 kn)
  const keySet = roleSpeed(speedRole());
  S = { ...S, behavior: "goto", status: { ...S.status, env_set_kn: 0 } };
  const roleGoto = speedRole(), keyGoto = roleSpeed(roleGoto);
  check("21f. a HOLD coming onto station takes the HOLD role - the slowest speed that makes way: LOW in calm water, the next up in a set LOW cannot beat - never the transit speed, which a Go-To's transit keeps",
        () => roleCalm === "hold" && keyCalm === "low" && keySet === "survey" && roleGoto === "transit" && keyGoto === "high",
        () => "hold: role " + roleCalm + ", calm " + keyCalm + ", in a 5 kn set " + keySet + "; Go-To: role " + roleGoto + ", " + keyGoto);
}

// ── 22. THE DEVIATION CHATTER (2026-09-29; open since 2026-09-26: "62 amends in 6 min, 1.5-4.5 m dog-legs") ─────────
// The guard's projection swung the bow at each waypoint and ADDED the set, so in a cross-set it predicted a boat carried
// off her line - while the vessel's line-follower crabs into the set and holds it. Replayed through the page's own
// guard: a boat crabbing down a straight line 8 m off a pier, clear of the 5 m a deviation wants, in a cross-set onto
// it. With the pursuing projection she was DEVIATED 3 times in 90 s at 1 kn (2 at 0.5, 4 at 1.5) off a line she was
// holding; with the crab in the projection (guard.js projectRoute), none. The control: the same line 2 m off - inside
// the buffer - is deviated round the pier exactly once.
async function crabbingPast(offM, setKn, secs) {
  const PIER = { polys: [(() => { const r = [{ e: -60, n: offM }, { e: 60, n: offM }, { e: 60, n: offM + 30 }, { e: -60, n: offM + 30 }];
                                  return { ring: r, bb: bbOf(r), kind: "a dock / pier" }; })()],
                 lines: [], points: [], marks: [], sys: [], chans: [] };
  surveying(7, [], { ko: PIER });
  mission.lines = []; runLineIdx = -1; lineSwing = -1;
  runRoute = [ll(-300, 0), ll(300, 0)]; window._wpIndex = 1; S.wp_total = runRoute.length;
  edgeSpentM = 0; edgeCount = 0;
  const twMs = 7 * 0.514444, drift = { e: 0, n: setKn * 0.514444 };
  let pos = { e: -200, n: 0 }, amends = 0;
  for (let k = 0; k < secs * 4; k++) {
    // the vessel's line-follower: bow crabbed into the set so the GROUND track runs down the leg she is on
    const idx = Math.min(window._wpIndex || 0, runRoute.length - 1), tgt = ref.toEN(runRoute[idx]);
    const brg = Math.atan2(tgt.e - pos.e, tgt.n - pos.n);
    const crab = Math.asin(Math.max(-0.9, Math.min(0.9, (drift.e * Math.cos(brg) - drift.n * Math.sin(brg)) / twMs)));
    const hdg = brg - crab, ge = twMs * Math.sin(hdg) + drift.e, gn = twMs * Math.cos(hdg) + drift.n;
    pos = { e: pos.e + ge * 0.25, n: pos.n + gn * 0.25 };
    if (Math.hypot(tgt.e - pos.e, tgt.n - pos.n) < 2 && idx < runRoute.length - 1) window._wpIndex = idx + 1;
    asv = ll(pos.e, pos.n);
    S = { ...S, status: { ...S.status, cog_deg: ((Math.atan2(ge, gn) / Math.PI * 180) + 360) % 360, sog_kn: Math.hypot(ge, gn) / 0.514444,
                          heading_deg: ((hdg / Math.PI * 180) + 360) % 360, env_set_kn: setKn, env_set_deg: 0, holding: false, speed_key: "survey" } };
    clock += 250; aisPolledAt = clock;
    const n0 = sent.length;
    frame();
    await new Promise(r => setTimeout(r, 0)); await new Promise(r => setTimeout(r, 0));
    amends += sent.slice(n0).filter(x => x.p === "/api/cmd/amend").length;
  }
  return { amends, holds: paths().filter(p => p === "/api/cmd/hold").length, end: clearance.level };
}
{
  const holding8 = await crabbingPast(8, 1.0, 90), strong8 = await crabbingPast(8, 1.5, 90), inside2 = await crabbingPast(2, 1.0, 60);
  check("22. THE CHATTER: a boat crabbing down her line 8 m off a pier in a cross-set onto it - 1 kn, and 1.5 kn - is NOT deviated in 90 s (she was deviated 3 and 4 times off a line she was holding), nor held; the same line 2 m off, inside the buffer, is deviated round the pier exactly ONCE",
        () => holding8.amends === 0 && holding8.holds === 0 && strong8.amends === 0 && strong8.holds === 0
              && inside2.amends === 1 && inside2.holds === 0,
        () => "8 m off, 1 kn: " + JSON.stringify(holding8) + "; 1.5 kn: " + JSON.stringify(strong8) + "; 2 m off: " + JSON.stringify(inside2));
}

// ── 23. A GO-TO, A RETURN-TO-HOME, A TRANSIT: THE SAME AVOIDANCE (Andy, 2026-09-29: "the avoidance maneuver used on
//        survey lines for avoidance of AIS contact should have identical avoidance behavior when running a GOTO, RTH
//        or transit line") ─────────────────────────────────────────────────────────────────────────────────────────
// The boat at (0,0) flying a leg east to (200, 0) and on to its end point at (200, 60) - no survey line under her - with
// PARKED across it 30 m ahead. The leg's command is modelled as the vessel runs it (_run_route): loaded and started in
// one step, answering with the behavior it applied.
function onLeg(beh, vessels, o = {}) {
  surveying(7, vessels, { ...o, behavior: beh });
  mission.lines = []; runLineIdx = -1; lineSwing = -1;
  runRoute = [ll(-200, 0), ll(200, 0), ll(200, 60)]; window._wpIndex = 1; S.wp_total = runRoute.length;
  replyState["/api/cmd/" + beh] = { behavior: beh };
}
const LEG_TITLE = { goto: "GO-TO", rth: "RETURN-TO-HOME", transit: "TRANSIT" };
const LEG_NAME = { goto: "Go-To", rth: "Return-to-Home", transit: "transit" };
{
  const R = {};
  for (const beh of ["goto", "rth", "transit"]) {
    onLeg(beh, [PARKED()]); frame();
    const r = { held: paths().includes("/api/cmd/hold"),
                bank: guardHeld && { leg: guardHeld.leg, mark: guardHeld.mark, idx: guardHeld.idx, n: guardHeld.route.length },
                opened: !!aisAvoid && aisAvoid.line === null, note: notes.find(n => /Holding for/.test(n)) || "" };
    nowHolding(); sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
    // ⚠ THE BAR IS READ BEFORE THE FIRST STATION FRAME NOW (2026-11-01): that frame IS the way round, so a
    // bar drawn after it would be the bar of a spent episode. `early` is what has been sent before it - nothing.
    r.early = paths().slice();
    renderGuardBar({ level: "blind" }, clearance);
    r.rung = $("#gb_rung").textContent; r.why = $("#gb_why").textContent; r.low = $("#gb_low").textContent;
    r.around = $("#gb_around").style.display; r.drop = $("#gb_drop").textContent; r.dropShown = $("#gb_drop").style.display;
    frame(); await settle();
    const c = sent.find(x => x.p === "/api/cmd/" + beh);
    r.paths = paths().slice(); r.body = c ? c.body : null; r.rte = (c && c.route) || [];
    r.spent = guardHeld === null && aisAvoid === null; r.drawn = runRoute === r.rte;
    r.intent = planIntent && planIntent.kind; r.banners = banners.slice();
    r.logged = logged.filter(e => e.kind === "ais_around").map(e => e.data); r.router = pinCalls.length;
    r.avoid = avoiding && {why: avoiding.why, kind: avoiding.kind, rejoin: avoiding.rejoin};
    r.avoidLog = logged.filter(e => e.kind === "avoiding").map(e => e.data);
    R[beh] = r;
  }
  const all = (f) => ["goto", "rth", "transit"].every(b => f(R[b], b));
  const each = (f) => Object.entries(R).map(([b, r]) => b + ": " + f(r, b)).join(" | ");
  check("23. on a Go-To, a Return-to-Home and a transit a contact across the way HOLDS her, the LEG is banked - the command it was flown by, where she stopped, no line mark - and the episode opens, the note promising the leg's own two ways on",
        () => all((r, b) => r.held && r.bank && r.bank.leg && r.bank.leg.behavior === b && r.bank.mark === null && r.bank.idx === 1 && r.opened
                             && new RegExp("the " + LEG_NAME[b] + " carries on by itself").test(r.note)
                             && /goes round her as soon as she is on station/.test(r.note)),
        () => each((r) => "held " + r.held + ", bank " + JSON.stringify(r.bank) + ", note '" + r.note.slice(0, 100) + "'"));
  check("23b. ... and the bar says it in the leg's own words - GO-TO / RETURN-TO-HOME / TRANSIT HELD — LOITERING, the waypoints to its end point, holding for her, the console routing round her itself NOW - with ROUTE ROUND HER NOW, RESUME <leg> AT LOW SPEED and LEAVE IT HOLDING on it, and no line to right-click beyond her (a leg has none)",
        () => all((r, b) => r.rung === LEG_TITLE[b] + " HELD — LOITERING" && /2 waypoints to go to its end point/.test(r.why)
                             && /holding for AIS: WORKBOAT/.test(r.why) && /routes round her itself now/.test(r.why)
                             && !/right-click/.test(r.why) && r.around !== "none"
                             && r.low === "RESUME " + LEG_TITLE[b] + " AT LOW SPEED" && r.drop === "LEAVE IT HOLDING" && r.dropShown !== "none"),
        () => each((r) => "'" + r.rung + "' / '" + r.why.slice(-150) + "' / '" + r.low + "' / around '" + r.around + "'"));
  check("23c. on the first frame she is on station, the console routes round her with the LEG'S OWN command - LOW, then ONE /api/cmd/<leg>: no pause, no upload, no Start - and nothing before that frame",
        () => all((r, b) => r.early.length === 0 && JSON.stringify(r.paths) === JSON.stringify(["/api/cmd/speed", "/api/cmd/" + b])),
        () => each((r) => "early " + JSON.stringify(r.early) + ", then " + JSON.stringify(r.paths)));
  check("23d. ... the route it sends is the way round her, then the leg's own remainder to its end point: the pick-up past her ring (e = 65, as on a line), then (200, 0) and (200, 60), the way in TAUT round her - never nearer her center than her own 30 m - with no call on the router",
        () => all((r) => r.rte.length >= 4 && distTo(r.rte[r.rte.length - 1], ll(200, 60)) < 0.5 && distTo(r.rte[r.rte.length - 2], ll(200, 0)) < 0.5
                         && distTo(r.rte[r.rte.length - 3], ll(65, 0)) < 0.5 && minDistTo(wayInOf(r.rte, ll(0, 0), 2), PARKED_C) >= 30 - 0.05 && r.router === 0),
        () => each((r) => r.rte.length + " wpts, pick-up " + (r.rte.length >= 3 ? distTo(r.rte[r.rte.length - 3], ll(65, 0)).toFixed(1) + " m of (65,0)" : "none")
                          + ", closest to her center " + (r.rte.length ? minDistTo(wayInOf(r.rte, ll(0, 0), 2), PARKED_C).toFixed(1) : "-") + ", router " + r.router));
  check("23e. ... it carries the end point's disc re-measured with the contacts (hold_clear_m), a Go-To names its end point, and it lands AS THE LEG: the record spent, the episode closed, the drawn route the one sent, the Intent the leg's - said 'ROUTED ROUND ... so the <leg> goes on beyond her' and logged ais_around with the leg",
        () => all((r, b) => !!r.body && r.body.hold_clear_m === 12.3
                             && (b !== "goto" || (Math.abs(r.body.lat - ll(200, 60).lat) < 1e-9 && Math.abs(r.body.lon - ll(200, 60).lon) < 1e-9))
                             && r.spent && r.drawn && r.intent === b
                             && r.banners.some(x => /ROUTED ROUND AIS: WORKBOAT/.test(x) && new RegExp("so the " + LEG_NAME[b] + " goes on beyond her").test(x))
                             && r.logged.some(d => d.leg === b && d.mmsi === 338111222 && d.round_m === 30 && d.skip_m === 65)),
        () => each((r) => "body " + JSON.stringify(r.body && { hc: r.body.hold_clear_m, lat: r.body.lat != null }) + ", spent " + r.spent + ", drawn " + r.drawn
                          + ", intent " + r.intent + ", logged " + JSON.stringify(r.logged)));
  // ⚠⚠ 23e2. THE AVOIDING FLAG ON A HELD LEG, AND TWO SWEEPS ARE WHY THIS CHECK READS AS IT DOES. The leg has
  // its own way-round branch (resumeHeldLeg) separate from the survey's (resumeHeldRun), and deleting the leg's
  // raise SURVIVED the first mutation sweep - nothing covered it at all.
  // ⚠ AND THE INDEX IT CARRIES WAS WRONG TWICE OVER. It first read `at.j`, a field only the SURVEY plan
  // returns, so `rejoin` was null and the badge could never come down on a leg; then it was hard-coded to 0,
  // which is the pick-up's index ONLY until the way in's detour is unshifted in front of it - so the badge went
  // out at the FIRST detour waypoint, the furthest from her planned track she gets in the whole maneuver
  // (2026-11-02, adversarial review). It is `via.length` now, and this check asserts the index POINTS AT THE
  // PICK-UP rather than merely holding some number: 23d pins the pick-up at `rte.length - 3` (the way in, then
  // (65,0), then the leg's own (200,0) and (200,60)), so the two must agree, and `rte[rejoin]` must BE (65,0).
  check("23e2. ... and the AVOIDING flag goes up on all three legs, reading ROUTED ROUND and carrying the index "
        + "of the PICK-UP in the route the command uploaded - which is after the way in's detour, not 0",
        () => all((r) => !!r.avoid && r.avoid.why === "routed round" && /WORKBOAT/.test(r.avoid.kind)
                         && r.avoidLog.length === 1
                         && r.avoid.rejoin === r.rte.length - 3
                         && distTo(r.rte[r.avoid.rejoin], ll(65, 0)) < 0.5),
        () => each((r) => JSON.stringify(r.avoid) + " logged " + r.avoidLog.length
                          + "; route " + r.rte.length + " wpts, pick-up index " + (r.rte.length - 3)
                          + ", rte[rejoin] " + (r.avoid && r.rte[r.avoid.rejoin]
                              ? distTo(r.rte[r.avoid.rejoin], ll(65, 0)).toFixed(2) + " m from (65,0)" : "none")));

}
{
  // 23f. THE RETURN: she clears the way inside the wait
  onLeg("goto", [CROSSING()]); frame(); nowHolding(); sent = []; banners = []; notes = []; logged = [];
  const her23 = (t) => { aisVessels = [contact(34, -5 + 3.087 * t, { sog: 6, cog: 0, heading: 0 })]; aisPolledAt = clock; };
  clock += 8000; her23(8); frame();
  const at8 = paths().slice();                      // the first clear frame: the dwell starts, nothing goes
  clock += 2000; her23(10); frame(); await settle();
  const at10 = paths().slice();                     // clear for 2 s: inside the dwell, still nothing (check 3b's rule)
  clock += 2100; her23(12.1); frame(); await settle();
  const c = sent.find(x => x.p === "/api/cmd/goto"), rte = (c && c.route) || [];
  check("23f. THE RETURN: a contact that clears the way inside the wait - the rest of the leg reading clear of every contact for 4 s, nothing sent on the first clear frame nor 2 s into the dwell - and the Go-To carries on from where she stopped: LOW, then /api/cmd/goto with the leg's own remainder, no backtrack (a leg has no coverage to overlap), said and logged as ais_return with the leg",
        () => at8.length === 0 && at10.length === 0 && JSON.stringify(paths()) === JSON.stringify(["/api/cmd/speed", "/api/cmd/goto"]) && rte.length === 2
              && distTo(rte[0], ll(200, 0)) < 0.5 && distTo(rte[1], ll(200, 60)) < 0.5 && guardHeld === null && aisAvoid === null
              && banners.some(b => /GO-TO RESUMED/.test(b) && /is clear of the way/.test(b))
              && logged.some(e => e.kind === "ais_return" && e.data.leg === "goto" && e.data.back_m === 0),
        () => "sent " + JSON.stringify(paths()) + ", route " + JSON.stringify(rte.map(p => { const q = ref.toEN(p); return [Math.round(q.e), Math.round(q.n)]; }))
            + ", banners " + JSON.stringify(banners.slice(-1)) + ", logged " + JSON.stringify(logged.filter(e => e.kind === "ais_return")));
}
{
  // 23g. THE OPERATOR'S RESUME <LEG> AT LOW SPEED
  onLeg("goto", [PARKED()]); frame(); nowHolding(); sent = []; banners = []; notes = []; logged = [];
  clock += 2000; aisPolledAt = clock;               // between frames (15's note): the press comes first
  await resumeHeldSurvey(); await settle();
  const c = sent.find(x => x.p === "/api/cmd/goto"), rte = (c && c.route) || [];
  check("23g. the operator's RESUME GO-TO AT LOW SPEED is the survey's press for a leg: straight on from where she stopped (LOW, then /api/cmd/goto with the remainder), the override recorded and LOW held on their authority - said so, and logged as guard_low with the leg",
        () => JSON.stringify(paths()) === JSON.stringify(["/api/cmd/speed", "/api/cmd/goto"]) && rte.length === 2 && distTo(rte[0], ll(200, 0)) < 0.5
              && resumeSlow === true && !!guardOverride && guardOverride.slow === true && guardHeld === null
              && banners.some(b => /GO-TO RESUMED AT LOW SPEED ON THE OPERATOR'S AUTHORITY/.test(b))
              && logged.some(e => e.kind === "guard_low" && e.data.how === "held_resume" && e.data.leg === "goto"),
        () => "sent " + JSON.stringify(paths()) + ", resumeSlow " + resumeSlow + ", override " + JSON.stringify(guardOverride) + ", banners " + JSON.stringify(banners.slice(-1)));
  resumeSlow = false; guardOverride = null;
}
{
  // 23h. THE ANSWER NAMES THE STATION-KEEP PLAN
  onLeg("goto", [PARKED()]); frame(); nowHolding();
  replyState["/api/cmd/goto"] = { behavior: "hold" };
  clock += 5000; aisPolledAt = clock;               // between frames (15's note): the press is the only try
  const kept = guardHeld, ep = aisAvoid;
  sent = []; banners = []; logged = [];
  const r = aisAroundNow(); await settle();
  check("23h. the Go-To's answer names the vessel's STATION-KEEP plan: no way round is announced - THE WAY ROUND IS NOT RUNNING, why, and that the console keeps trying itself, every frame - and the held Go-To and the episode stand, the attempt logged with the leg",
        () => r === true && paths().includes("/api/cmd/goto") && !banners.some(b => /ROUTED ROUND/.test(b))
              && banners.some(b => /THE WAY ROUND IS NOT RUNNING/.test(b) && /answered with its station-keep plan, not the Go-To/.test(b)
                                   && /keeps trying itself, every frame/.test(b))
              && guardHeld === kept && aisAvoid === ep && logged.some(e => e.kind === "resume_not_running" && e.data.leg === "goto"),
        () => "returned " + r + ", sent " + JSON.stringify(paths()) + ", banners " + JSON.stringify(banners.map(b => b.slice(0, 130)))
            + ", record " + (guardHeld === kept ? "kept" : "CHANGED") + ", episode " + (aisAvoid === ep ? "kept" : "CHANGED"));
}
{
  // 23i. IN EXTREMIS MID-RESUME: the helm rung escapes during the LOW's round trip
  onLeg("goto", [PARKED()]); frame(); nowHolding();
  S = { ...S, status: { ...S.status, sog_kn: 0.3, cog_deg: 270, heading_deg: 90 } };
  for (let k = 0; k < 6; k++) { clock += 1000; aisPolledAt = clock; frame(); }
  escFake = { hdg: 0, to: { e: 0, n: 60 }, m: 60, capped: false, clear: true, survived: 45, worst: 30, gain: 30 };
  const kept = guardHeld, ep = aisAvoid;
  let mid = null;
  onReply = (p) => {
    if (p !== "/api/cmd/speed" || mid) return;
    pausedSetToward(1.75);
    const n0 = sent.length; frame(); clock += 1600; frame(); mid = sent.slice(n0).map(x => x.p);
  };
  sent = []; banners = []; logged = [];
  clock += WHILE_MS - 6000; aisPolledAt = clock; frame(); await settle();
  onReply = null; escFake = null;
  check("23i. IN EXTREMIS MID-RESUME on a held Go-To: the helm rung escapes during the LOW's round trip - it never stands by - and no Go-To is sent after it: THE WAY ROUND IS NOT RUNNING, said with the cause, the record and the episode kept",
        () => !!mid && mid.includes("/api/cmd/escape") && !paths().includes("/api/cmd/goto")
              && banners.some(b => /THE WAY ROUND IS NOT RUNNING/.test(b) && /took the helm/.test(b))
              && guardHeld === kept && aisAvoid === ep,
        () => "mid-resume sent " + JSON.stringify(mid) + ", sent " + JSON.stringify(paths()) + ", banners " + JSON.stringify(banners.map(b => b.slice(0, 120))));
}
{
  // 23j. LEAVE IT HOLDING
  onLeg("goto", [PARKED()]); frame(); nowHolding(); confirmAnswer = true; confirmAsked = 0; notes = [];
  await dropHeldSurvey();
  const asked = confirmAsked, gone = guardHeld === null, said = notes.some(n => /Held Go-To dropped/.test(n));
  clock += 1000; aisPolledAt = clock; sent = []; frame(); await settle();
  check("23j. LEAVE IT HOLDING on a held Go-To asks first and forgets the leg - she keeps station-keeping - and the episode ends with it on the next frame, nothing sent: the console no longer routes round her itself",
        () => asked === 1 && gone && said && aisAvoid === null && sent.length === 0,
        () => "asked " + asked + ", record " + (gone ? "gone" : "KEPT") + ", said " + said + ", episode " + JSON.stringify(aisAvoid) + ", sent " + JSON.stringify(paths()));
}
{
  // ⚠⚠ 23k. A CHARTED HOLD ON A GO-TO IS BANKED AND ROUTED ROUND TOO (Andy, 2026-11-02: "yes, any contact
  // including charted on legs too"). This check stated the opposite and he overturned it. markGuardHeld banked a
  // Go-To, an RTH or a transit only when a CONTACT held her - its own `!!ais &&` - so a leg held for a pier
  // banked NOTHING, there was no record for anything to resume from, and the console held for the operator with
  // no end to it. The gate is `aisCaused || !!chartHer` now, and the leg is handed back by its own command
  // (resumeHeldLeg) exactly as it is for a contact, so she still holds at the Go-To's own end point.
  onLeg("goto", [], { ko: PIER }); S.status.cog_deg = 0; S.status.heading_deg = null; frame();
  const sent23k = paths().slice(), banked23k = !!guardHeld;
  const ep23k = aisAvoid && {kind: aisAvoid.kind, charted: !!aisAvoid.chart, mmsi: aisAvoid.mmsi,
                             leg: !!(guardHeld && guardHeld.leg)};
  check("23k. a Go-To held for a CHARTED feature is BANKED and opens an episode naming the feature, so the leg "
        + "gets the same avoidance a contact's does - the hold is still sent, and the record is the leg's",
        () => sent23k.includes("/api/cmd/hold") && banked23k && !!ep23k
              && ep23k.charted === true && ep23k.mmsi === null && ep23k.leg === true
              && /pier|dock/i.test(ep23k.kind),
        () => "sent " + JSON.stringify(sent23k) + ", banked " + banked23k
            + ", episode " + JSON.stringify(ep23k));
}
{
  // 23l. A GO-TO STILL RUNNING: the chart menu's row amends the leg round her
  onLeg("goto", [PARKED()]); aisKeepoutsNow(); sent = []; notes = []; logged = []; pinCalls = [];
  const why = avoidWhy();
  const r = await avoidContactAt(ll(30, 0));
  const am = sent.find(x => x.p === "/api/cmd/amend"), rte = (am && am.route) || [];
  check("23l. on a Go-To still RUNNING the chart menu's 'Route round WORKBOAT' is live and AMENDS the leg round her - one /api/cmd/amend, so the vessel keeps the Go-To: the taut way round, the pick-up past her ring (e = 65), then the leg's own remainder to its end point; said and logged with the leg",
        () => why === "" && r === true && paths().length === 1 && paths()[0] === "/api/cmd/amend"
              && rte.length >= 4 && distTo(rte[rte.length - 1], ll(200, 60)) < 0.5 && distTo(rte[rte.length - 2], ll(200, 0)) < 0.5
              && distTo(rte[rte.length - 3], ll(65, 0)) < 0.5 && minDistTo(wayInOf(rte, ll(0, 0), 2), PARKED_C) >= 30 - 0.05
              && notes.some(n => /Routed round/.test(n) && /the Go-To picked up 65 m on, beyond her/.test(n))
              && logged.some(e => e.kind === "ais_around" && e.data.leg === "goto" && e.data.running === true && e.data.mmsi === 338111222),
        () => "why '" + why + "', returned " + r + ", sent " + JSON.stringify(paths()) + ", amend " + rte.length + " wpts, notes " + JSON.stringify(notes.slice(-1)));
}
{
  // 23m. RESUME FROM HERE IS FOR A HELD SURVEY
  onLeg("goto", [PARKED()]); frame(); nowHolding(); sent = []; notes = [];
  gateResumeHere(ll(120, 0));
  const shown = $("#cmResume").style.display !== "none";
  await resumeFromHere(ll(120, 0));
  check("23m. Resume from here is for a held SURVEY: on a held Go-To the row is not shown while she runs, and the handler refuses in words - nothing is sent",
        () => !shown && sent.length === 0 && notes.some(n => /Resume from here needs a PAUSED run, or a survey the guard is holding/.test(n)),
        () => "shown " + shown + ", sent " + JSON.stringify(paths()) + ", notes " + JSON.stringify(notes));
}

// ── 23n-23p. A WAY ROUND THAT FAILS, OR ANY CHART-MENU ROW THAT FAILS, SAYS SO (Andy, 2026-09-30, item 1 of his list:
//        "The 'Route round' click can silently do nothing") ───────────────────────────────────────────────────────────
// The menu called the async handlers un-awaited and uncaught, and aisAroundRunning had a `finally` and no `catch`: a throw
// anywhere in planning the way round was an unhandled rejection - a press that did nothing, said nothing, logged nothing.
{
  // 23n. a throw while PLANNING it: nothing was sent, and the settle clock is let go
  onLeg("goto", [PARKED()]); aisKeepoutsNow(); sent = []; notes = []; banners = []; logged = []; pinCalls = [];
  const taut = tautRoundHer;
  tautRoundHer = () => { throw new Error("test: the taut way round threw"); };
  let r, threw = null;
  try { r = await avoidContactAt(ll(30, 0)); } catch (e) { threw = e; }
  tautRoundHer = taut;
  const b1 = banners.slice(), p1 = paths().slice(), edge1 = guardEdgeAt;
  // the NEXT press, with the way round planning again: the handler must be free (its busy flag lives in the bundle)
  let r2 = null;
  try { r2 = await avoidContactAt(ll(30, 0)); } catch (e) { r2 = "threw " + e.message; }
  const p2 = paths().slice(p1.length);
  check("23n. a throw while PLANNING the way round a running Go-To is SAID, not swallowed: the press resolves false, the banner names the error and says nothing was sent, it is logged, the settle clock is let go - and the next press goes round her",
        () => threw === null && r === false && p1.length === 0
              && b1.some(b => /THE WAY ROUND AIS: WORKBOAT[^—]* FAILED — test: the taut way round threw/.test(b) && /Nothing was sent/.test(b))
              && logged.some(e => e.kind === "ais_around_failed" && e.data.sent === false && e.data.leg === "goto"
                                  && /taut way round threw/.test(e.data.error))
              && edge1 === 0 && r2 === true && p2.length === 1 && p2[0] === "/api/cmd/amend",
        () => "threw " + (threw && threw.message) + ", returned " + r + ", sent " + JSON.stringify(p1) + ", banners "
            + JSON.stringify(b1.map(b => b.slice(0, 140))) + ", guardEdgeAt " + edge1 + "; the next press " + r2 + " sent " + JSON.stringify(p2));
}
{
  // 23o. a throw AFTER the vessel took the amendment: she IS flying the way round, and it must not be denied
  onLeg("goto", [PARKED()]); aisKeepoutsNow(); sent = []; notes = []; banners = []; logged = []; pinCalls = [];
  const card = updateMissionCard;
  updateMissionCard = () => { throw new Error("test: the card threw"); };
  let r, threw = null;
  try { r = await avoidContactAt(ll(30, 0)); } catch (e) { threw = e; }
  updateMissionCard = card;
  const am = sent.find(x => x.p === "/api/cmd/amend");
  check("23o. ... and one AFTER the vessel took the amendment says she IS flying the way round - only the console's bookkeeping behind it failed - and is logged as sent",
        () => threw === null && r === false && !!am
              && banners.some(b => /THE WAY ROUND AIS: WORKBOAT[^—]* FAILED — test: the card threw/.test(b) && /The amendment WAS taken/.test(b)
                                   && !/Nothing was sent/.test(b))
              && logged.some(e => e.kind === "ais_around_failed" && e.data.sent === true),
        () => "threw " + (threw && threw.message) + ", returned " + r + ", sent " + JSON.stringify(paths()) + ", banners "
            + JSON.stringify(banners.map(b => b.slice(0, 160))));
}
{
  // 23p. THE MENU ITSELF: a row whose command rejects, and one that throws, are each said and logged - no unhandled
  // rejection, no click that does nothing - and a row that works is untouched
  const rowEl = (label) => { const lbl = { textContent: label };
    return { classList: { contains: () => false }, querySelector: (s) => (s === "span" ? lbl : null), onclick: null }; };
  CM["#cmT1"] = rowEl("Go-To here"); CM["#cmT2"] = rowEl("Set Home here"); CM["#cmT3"] = rowEl("Copy position");
  banners = []; logged = []; sent = [];
  let got = null, got3 = null, ran = 0;
  cmRow("#cmT1", async (p) => { got = p; throw new Error("test: the Go-To rejected"); });
  cmRow("#cmT2", () => { throw new Error("test: the row threw"); });
  cmRow("#cmT3", (p) => { ran++; got3 = p; });
  const unhandled = [], syncThrew = [];
  const onUR = (e) => unhandled.push(String((e && e.message) || e));
  process.on("unhandledRejection", onUR);
  for (const [id, at] of [["#cmT1", ll(5, 5)], ["#cmT2", ll(6, 6)], ["#cmT3", ll(7, 7)]]) {
    menuLL = at;
    try { CM[id].onclick(); } catch (e) { syncThrew.push(id + ": " + e.message); }
  }
  await settle(); await new Promise(res => setTimeout(res, 0));
  process.off("unhandledRejection", onUR);
  check("23p. THE CHART MENU: a row whose command REJECTS and a row that THROWS are each said in a banner naming the row and the error, and logged - no unhandled rejection, no click that does nothing - while a row that works runs once, with the point the menu was opened at",
        () => syncThrew.length === 0 && unhandled.length === 0 && !!got && distTo(got, ll(5, 5)) < 0.01
              && banners.some(b => /^⚠ GO-TO HERE FAILED — test: the Go-To rejected/.test(b))
              && banners.some(b => /^⚠ SET HOME HERE FAILED — test: the row threw/.test(b)) && banners.length === 2
              && ran === 1 && !!got3 && distTo(got3, ll(7, 7)) < 0.01
              && logged.filter(e => e.kind === "menu_failed").length === 2,
        () => "sync throws " + JSON.stringify(syncThrew) + ", unhandled " + JSON.stringify(unhandled) + ", banners "
            + JSON.stringify(banners.map(b => b.slice(0, 90))) + ", ran " + ran + ", logged " + JSON.stringify(logged.map(e => e.kind)));
  delete CM["#cmT1"]; delete CM["#cmT2"]; delete CM["#cmT3"];
}
{
  // 23q. the amendment's POST itself is LOST (the command promise rejects): she may have taken it, so it is neither
  // "nothing was sent" nor "taken" - and the settle clock, set for the amendment, is let go
  onLeg("goto", [PARKED()]); aisKeepoutsNow(); sent = []; notes = []; banners = []; logged = []; pinCalls = [];
  const realCmd = cmd;
  cmd = (p, b) => (p === "/api/cmd/amend" ? Promise.reject(new Error("test: the answer was lost")) : realCmd(p, b));
  let r, threw = null;
  try { r = await avoidContactAt(ll(30, 0)); } catch (e) { threw = e; }
  cmd = realCmd;
  const edgeQ = guardEdgeAt;
  check("23q. ... and one whose POST is LOST (the command promise rejects) says the console cannot tell whether she took it - never 'nothing was sent' - lets the settle clock go and logs the stage",
        () => threw === null && r === false && edgeQ === 0
              && banners.some(b => /FAILED — test: the answer was lost/.test(b) && /cannot say whether she took the way round/.test(b)
                                   && !/Nothing was sent/.test(b))
              && logged.some(e => e.kind === "ais_around_failed" && e.data.stage === "posting" && e.data.sent === false),
        () => "threw " + (threw && threw.message) + ", returned " + r + ", guardEdgeAt " + edgeQ + ", banners "
            + JSON.stringify(banners.map(b => b.slice(0, 150))));
}

// ── 24. THE LADDER'S REACH (Andy, 2026-09-29: "The buffer zone on approach to an AIS target appears to be 150m. confirm
//        distance and modify to 50m." - then, when the stopping margin was raised, "extend for drix if necessary") ────
{
  // a parked 30 x 8 m hull across the line, her near end 55 m ahead, then 48 m ahead
  surveying(7, [contact(70, 0, { sog: 0, cog: null, heading: 90 })]); frame();
  const l55 = clearance.level, s55 = paths().slice(), m55 = clearance.m;
  surveying(7, [contact(63, 0, { sog: 0, cog: null, heading: 90 })]); frame();
  const l48 = clearance.level, slowed48 = clearance.slowed, s48 = paths().slice();
  check("24. THE REACH: a hull parked across the line with her near end 55 m ahead reads CLEAR at 7 kn - nothing is sent, though the readout still measures her (55 m) - and 48 m ahead the same hull is answered: the hold rung, slowing her to LOW in lieu of stopping (at 4 kn she is 22 s off). Until 2026-09-29 the 45 s look-ahead answered her from 139 m at 6 kn",
        () => l55 === "clear" && s55.length === 0 && Math.abs(m55 - 55) < 0.5
              && l48 === "hold" && slowed48 === true && s48.includes("/api/cmd/speed") && !s48.includes("/api/cmd/hold"),
        () => "55 m: " + l55 + " " + JSON.stringify(s55) + " (readout " + (m55 == null ? "null" : m55.toFixed(1)) + " m); 48 m: " + l48 + ", slowed " + slowed48 + ", " + JSON.stringify(s48));
  surveying(7, [contact(34, -150, { sog: 6, cog: 0, heading: 0 })]); frame();
  const lSweep = clearance.level, sSweep = paths().slice();
  check("24b. ... and it is her KEEP-OUT that must come within reach, not her position: a workboat 150 m south of the line, northbound at 6 kn, whose 45 s sweep crosses the line 30 m ahead, holds her",
        () => lSweep === "hold" && sSweep.includes("/api/cmd/hold"),
        () => "level " + lSweep + ", sent " + JSON.stringify(sSweep));
  // THE DRIX: her MEASURED in-gear slow-down (2026-10-03, her logs; the 3.3 s lag) extends the reach by the water she
  // needs to come down to LOW - the WHOLE maneuvering block, as the page hands it (asv.html `slowMan`)
  const DRIX = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vessels", "drix08.json"), "utf8"));
  const coastD = DRIX.maneuvering.coast, KN = 0.514444, lowD = DRIX.propulsion.speeds_kn.low * KN;
  const r7 = aisReachM(DRIX.maneuvering, 7 * KN, lowD), r14 = aisReachM(DRIX.maneuvering, 14 * KN, lowD), rLow = aisReachM(DRIX.maneuvering, lowD, lowD);
  // ... and the console's own command delay on top, as the page asks it (2026-10-03, "fix the guard's model of slowing down")
  const L7 = aisReachM(DRIX.maneuvering, 7 * KN, lowD, 0, undefined, SPEED_CMD_LATENCY_S);
  const L14 = aisReachM(DRIX.maneuvering, 14 * KN, lowD, 0, undefined, SPEED_CMD_LATENCY_S);
  const wasM = V.VESSEL.maneuvering;
  V.VESSEL.maneuvering = DRIX.maneuvering;
  surveying(7, [contact(100, 0, { sog: 0, cog: null, heading: 90 })]); frame();         // her near end 85 m ahead
  const d85 = clearance.level;
  surveying(7, [contact(110, 0, { sog: 0, cog: null, heading: 90 })]); frame();         // 95 m: inside 96.3, outside 92.7
  const d95 = clearance.level;
  surveying(7, [contact(115, 0, { sog: 0, cog: null, heading: 90 })]); frame();         // 100 m
  const d100 = clearance.level;
  surveying(4, [contact(100, 0, { sog: 0, cog: null, heading: 90 })]); S.status.speed_key = "low"; frame();  // 85 m, at LOW
  const d85low = clearance.level;
  V.VESSEL.maneuvering = { coast: coastD };                                                 // the coast datum alone
  surveying(7, [contact(100, 0, { sog: 0, cog: null, heading: 90 })]); frame();
  const coast85 = clearance.level;
  V.VESSEL.maneuvering = wasM;
  surveying(7, [contact(100, 0, { sog: 0, cog: null, heading: 90 })]); frame();         // 85 m on a hull with no datum
  const plain85 = clearance.level;
  check("24c. EXTENDED FOR THE DRIX BY HER MEASURED SLOW-DOWN (2026-10-03: the guard's SLOW is flown in gear, a 3.3 s dead time then a decay toward her 3.65 kn idle) AND THE CONSOLE'S 1 s COMMAND DELAY - 96.3 m at 7 kn (92.7 without the delay), 131.2 m at 14 kn, 50 m at LOW. A hull 85 m ahead is answered at 7 kn and not at LOW, one 95 m ahead too (only the delay reaches her), one 100 m ahead at neither; with her coast datum alone (the law this replaced, ~74 m) 85 m was out of reach, and on a hull with no datum it is too",
        () => Math.abs(r7 - 92.700) < 0.005 && Math.abs(r14 - 124.019) < 0.005 && rLow === 50
              && Math.abs(L7 - 96.301) < 0.005 && Math.abs(L14 - 131.221) < 0.005
              && d85 !== "clear" && d95 !== "clear" && d100 === "clear" && d85low === "clear" && coast85 === "clear" && plain85 === "clear",
        () => "reach " + L7.toFixed(2) + " / " + L14.toFixed(2) + " m with the delay (" + r7.toFixed(2) + " / " + r14.toFixed(2) + " without) / " + rLow + " m; DriX: 85 m at 7 kn " + d85 + ", 95 m " + d95 + ", 100 m " + d100 + ", 85 m at LOW " + d85low + "; coast datum alone, 85 m: " + coast85 + "; no datum, 85 m: " + plain85);
  // 24d. THE RELEASE ASKS THE REACH AT THE SPEED IT RESTORES (found on the transit rehearsal: slowed to LOW 58 m off
  //      TEST-1 - outside the DriX's 50 m at LOW - she was released, raised toward 7 kn, back inside 70 m and slowed
  //      again a second later). Slowed at 7 kn for a hull 65 m ahead, then at LOW with her 58 m ahead: the ladder reads
  //      clear at LOW, and the counterfactual at the plan's 7 kn - where she is in reach - must NOT release her.
  V.VESSEL.maneuvering = { coast: coastD };
  surveying(7, [contact(80, 0, { sog: 0, cog: null, heading: 90 })]); frame();          // 65 m at 7 kn: slowed in lieu
  const slowedFirst = clearance.slowed === true;
  S = { ...S, status: { ...S.status, sog_kn: 4, speed_key: "low" } };
  aisVessels = [contact(73, 0, { sog: 0, cog: null, heading: 90 })]; clock += 1000; aisPolledAt = clock; frame();   // 58 m, at LOW
  const lowLevel = clearance.level;
  clock += 5000; aisPolledAt = clock; notes = []; frame();                              // past the release's dwell
  const released = clearance.slowed === false || guardLevel === "clear";
  V.VESSEL.maneuvering = wasM;
  check("24d. THE RELEASE ASKS THE REACH AT THE SPEED IT RESTORES: on the DriX's coast datum alone (the law before 2026-10-03), slowed to LOW with a hull 58 m ahead - outside 50 m at LOW, inside the coast law's ~70 m at 7 kn - she reads clear at LOW and is NOT released past the dwell: 'not yet at the plan's speed', no 'Clear ahead again' (24e: the same on her whole block)",
        () => slowedFirst && lowLevel === "clear" && !released && !notes.some(n => /Clear ahead again/.test(n))
              && /not yet at the plan's speed/.test($("#gb_why").textContent),
        () => "slowed first " + slowedFirst + ", level at LOW " + lowLevel + ", released " + released + " (slowed " + clearance.slowed + ", guardLevel " + guardLevel
            + "), notes " + JSON.stringify(notes) + ", bar '" + $("#gb_why").textContent.slice(-80) + "'");
  // 24e. ... AND THE RELEASE ASKS IT OF THE SAME LAW THE LADDER USES (2026-10-03, the measured in-gear slow-down). Found by
  //      mutation: handing the release only the coast datum survived every check above, because 24d's vessel has no
  //      slowdown block. On her WHOLE block: slowed at 7 kn for a hull 85 m ahead, then at LOW with her 80 m ahead - outside
  //      her 50 m at LOW, inside her 92.7 m at 7 kn - she must NOT be released. The scenario discriminates because 80 m is
  //      BEYOND the coast law's 70.5 m at 7 kn: a release asked by the coast datum would let her go (the mutation that
  //      survived before this check existed, and is killed by it).
  const releaseAt80 = (man) => {
    V.VESSEL.maneuvering = man;
    surveying(7, [contact(100, 0, { sog: 0, cog: null, heading: 90 })]); frame();       // 85 m at 7 kn: slowed in lieu
    const first = clearance.slowed === true;
    S = { ...S, status: { ...S.status, sog_kn: 4, speed_key: "low" } };
    aisVessels = [contact(95, 0, { sog: 0, cog: null, heading: 90 })]; clock += 1000; aisPolledAt = clock; frame();   // 80 m, at LOW
    const low = clearance.level;
    clock += 5000; aisPolledAt = clock; notes = []; frame();                            // past the release's dwell
    const out = { first, low, released: clearance.slowed === false || guardLevel === "clear",
                  said: notes.some(n => /Clear ahead again/.test(n)) };
    V.VESSEL.maneuvering = wasM;
    return out;
  };
  const whole = releaseAt80(DRIX.maneuvering);
  const byCoast = aisReachM(coastD, 7 * KN, lowD), bySlow = aisReachM(DRIX.maneuvering, 7 * KN, lowD);
  check("24e. ... and asks it by the SAME law the ladder uses: on the DriX's whole block, slowed to LOW with a hull 80 m ahead (outside 50 m, inside her 92.7 m at 7 kn) she is NOT released - and 80 m is beyond the coast law's 70.5 m, so a release that lost the slowdown block would have let her go",
        () => whole.first && whole.low === "clear" && !whole.released && !whole.said && byCoast < 80 && bySlow > 80,
        () => "whole block: " + JSON.stringify(whole) + "; reach at 7 kn by the coast law " + byCoast.toFixed(1) + " m, by the in-gear law " + bySlow.toFixed(1) + " m");

  // 24e2. ... AND WITH THE CONSOLE'S COMMAND DELAY (2026-10-03): slowed, then at LOW with the hull 94 m ahead - beyond the 92.7 m
  // her law gives at 7 kn, inside the 96.3 m it gives with the 1 s delay the ladder itself counts - she is not released.
  {
    V.VESSEL.maneuvering = DRIX.maneuvering;
    surveying(7, [contact(100, 0, { sog: 0, cog: null, heading: 90 })]); frame();
    const first94 = clearance.slowed === true;
    S = { ...S, status: { ...S.status, sog_kn: 4, speed_key: "low" } };
    aisVessels = [contact(109, 0, { sog: 0, cog: null, heading: 90 })]; clock += 1000; aisPolledAt = clock; frame();
    const low94 = clearance.level;
    clock += 5000; aisPolledAt = clock; notes = []; frame();
    const rel94 = clearance.slowed === false || guardLevel === "clear";
    V.VESSEL.maneuvering = wasM;
    check("24e2. ... and the release asks it WITH the console's 1 s command delay, as the ladder does: slowed, then at LOW "
          + "with the hull 94 m ahead - beyond her 92.7 m without the delay, inside the 96.3 m with it - she is NOT released",
          () => first94 && low94 === "clear" && !rel94,
          () => "slowed first " + first94 + ", level at LOW " + low94 + ", released " + rel94);
  }

  // ── 24f-24h. THE GUARD'S MODEL OF SLOWING DOWN (Andy, 2026-10-03: "fix the guard's model of slowing down"). On the
  // DriX's hull a slow-down takes the command's 1 s, a 3.3 s dead time and ~12 s of in-gear decay, and the ladder used to
  // take it as instant on two counts: the slow-instead-of-hold walked her at LOW from the instant it decided, and both slow
  // rungs judged "already slow" by the KEY she had been told - which the governor's lead puts on the wire ~15 s before
  // she is at LOW. The distances below are worked out from the profile itself (coast.js slowProfile), so they move with
  // the law rather than with this file.
  {
    const lawF = slowLaw(DRIX.maneuvering.slowdown);
    const prof = slowProfile(7 * KN, lowD, lawF, SPEED_CMD_LATENCY_S, 0);
    let dGear = 0; for (let t = 0.5; t <= 20 + 1e-9; t += 0.5) dGear += prof(t - 0.5) * 0.5;   // what she covers in HOLD_S
    const dLow = 20 * lowD;                                                                         // ... and an instant LOW
    const at = (entryM, o = {}) => {
      surveying(o.kn || 7, [contact(entryM + 18, 0, { sog: 0, cog: null, heading: 90 })]);   // near end entry+15, 3 m buffer
      S.status.speed_key = o.key || "survey";
      if (o.headSetKn) { S.status.env_set_kn = o.headSetKn; S.status.env_set_deg = 270; S.status.sog_kn = (o.kn || 7) - o.headSetKn; }
      // the console's own last speed command: `key`, sent `ago` ms back with her `twAt` kn through the water (cutAge's curve)
      __setSpeedWant(o.told ? { key: o.wantKey || "low", asked: o.wantKey || "low", at: clock - (o.ago || 0), sends: 1,
                                told: false, tw: (o.twAt || 7) * KN } : null);
      frame();
      return { level: clearance.level, slowed: clearance.slowed, key: clearance.slowKey, sent: paths().slice() };
    };
    // what she covers in the hold's 20 s, coming down in gear: with the command's delay `lat`, `el` s of the cut already run
    const cover = (lat, el, v0 = 7 * KN) => { const pr = slowProfile(v0, lowD, lawF, lat, el); let x = 0;
      for (let t = 0.5; t <= 20 + 1e-9; t += 0.5) x += pr(t - 0.5) * 0.5; return x; };
    V.VESSEL.maneuvering = DRIX.maneuvering;
    const mid = at((dLow + dGear) / 2), room = at(dGear + 8);
    check("24f. THE SLOW-INSTEAD-OF-HOLD IS FLOWN AS SHE FLIES IT: on the DriX's hull at 7 kn, a hazard " + ((dLow + dGear) / 2).toFixed(1)
          + " m ahead of the buffer - inside the " + dGear.toFixed(1) + " m she covers in the hold's 20 s coming down in gear, "
          + "outside the " + dLow.toFixed(1) + " m an instant LOW covers - is HELD, not slowed; with " + (dGear + 8).toFixed(1)
          + " m she is slowed in lieu, as before",
          () => mid.level === "hold" && mid.sent.includes("/api/cmd/hold") && !mid.slowed
                && room.level === "hold" && room.slowed && !room.sent.includes("/api/cmd/hold") && room.sent.includes("/api/cmd/speed"),
          () => "between the two: " + JSON.stringify(mid) + "; with room: " + JSON.stringify(room));
    const c0 = cover(0, 0), lat = at((c0 + dGear) / 2);
    check("24f2. ... and it is flown THROUGH THE CONSOLE'S 1 s COMMAND DELAY: a hazard " + ((c0 + dGear) / 2).toFixed(1) + " m ahead - "
          + "outside the " + c0.toFixed(1) + " m she would cover if the slow-down reached her at once, inside the " + dGear.toFixed(1)
          + " m with the delay - is HELD",
          () => lat.level === "hold" && lat.sent.includes("/api/cmd/hold") && !lat.slowed, () => JSON.stringify(lat));
    const told = at(dGear + 8, { key: "low", told: true }), atLowNow = at(30, { kn: 4, key: "low" });
    check("24g. ... and a cut ALREADY UNDER WAY is still offered it: told LOW (the governor's lead) and still at 7 kn through "
          + "the water, the same hazard is SLOWED in lieu, latched, and nothing is re-sent - where the key alone said she was "
          + "already slow and the hold fired; a boat that IS at LOW is held, as before",
          () => told.slowed && told.key === "low" && !told.sent.includes("/api/cmd/hold") && !told.sent.includes("/api/cmd/speed")
                && atLowNow.sent.includes("/api/cmd/hold") && !atLowNow.slowed,
          () => "told LOW at 7 kn: " + JSON.stringify(told) + "; at LOW: " + JSON.stringify(atLowNow));
    const cutSlow = at(80, { key: "low", told: true }), freshSlow = at(80), noisyLow = at(45, { kn: 4.1, key: "low", told: true, twAt: 4.1 });   // within her ~54 m reach at 4.1 kn, 21 s off: SLOW
    check("24h. ... and the SLOW rung, met mid-cut, TAKES THE THROTTLE without re-sending it - the release check, not the "
          + "governor, then decides when she speeds up - where it used to see nothing to take off and leave the governor to "
          + "raise her; with the key at survey it sends LOW, as always; and a boat AT LOW with a tenth of a knot of noise is "
          + "not mid-cut (IN_CUT_MS): nothing latched",
          () => cutSlow.level === "slow" && cutSlow.slowed && cutSlow.key === "low" && !cutSlow.sent.includes("/api/cmd/speed")
                && freshSlow.level === "slow" && freshSlow.slowed && freshSlow.sent.includes("/api/cmd/speed")
                && noisyLow.level === "slow" && !noisyLow.slowed && !noisyLow.sent.includes("/api/cmd/speed"),
          () => "told LOW at 7 kn, 80 m: " + JSON.stringify(cutSlow) + "; at survey: " + JSON.stringify(freshSlow)
                + "; AT LOW with a tenth of a knot of noise (4.1 kn) - not a cut, nothing latched: " + JSON.stringify(noisyLow));
    // 24g2. A LOW SENT LONG AGO THAT SHE HAS NOT COME DOWN ON BUYS NOTHING: the elapsed time comes off the dead time only
    // while it is running or once she is slowing - a stale record, or a vessel not answering, gets the whole delay again.
    const cFull = cover(SPEED_CMD_LATENCY_S, 99), stale = at((cFull + dGear) / 2, { key: "low", told: true, ago: 60000 });
    check("24g2. ... but a LOW sent a minute ago that she has NOT come down on (still 7 kn) buys no credit off the dead time: "
          + "a hazard between what full credit and no credit would leave her (" + cFull.toFixed(1) + " / " + dGear.toFixed(1)
          + " m) is HELD, not slowed on the strength of a cut that never ran",
          () => stale.level === "hold" && stale.sent.includes("/api/cmd/hold") && !stale.slowed,
          () => JSON.stringify(stale));
    // 24g3. AND A LOW SHE HAS NOT TAKEN BUYS NOTHING EITHER: sent 4 s ago (inside its dead time) but the vessel still reports
    // survey - lost, refused, not yet arrived - the cut has not begun, and the hazard where 4 s of credit would read slowed is HELD.
    const pCred = slowProfile(7 * KN, lowD, lawF, SPEED_CMD_LATENCY_S, 4);
    let dCred = 0; for (let t = 0.5; t <= 20 + 1e-9; t += 0.5) dCred += pCred(t - 0.5) * 0.5;
    const untaken = at((dCred + dGear) / 2, { key: "survey", told: true, ago: 4000 });
    check("24g3. ... nor does a LOW sent 4 s ago that she has NOT taken (the vessel still reports survey): a hazard "
          + ((dCred + dGear) / 2).toFixed(1) + " m ahead - outside the " + dCred.toFixed(1) + " m 4 s of credit would leave, inside "
          + "the " + dGear.toFixed(1) + " m of a cut not begun - is HELD",
          () => untaken.level === "hold" && untaken.sent.includes("/api/cmd/hold") && !untaken.slowed,
          () => JSON.stringify(untaken));
    // 24g4. A CUT IN ITS DEAD TIME IS CREDITED: LOW sent 2 s ago, she is still at 7 kn - on the curve, the dead time not
    // yet run - and the 2 s come off it: a hazard between what she covers with the credit and without it is slowed in lieu.
    const c2 = cover(SPEED_CMD_LATENCY_S, 2), inDead = at((c2 + dGear) / 2, { key: "low", told: true, ago: 2000 });
    check("24g4. ... and a cut STILL IN ITS DEAD TIME is credited what it has run: LOW sent 2 s ago, she still at 7 kn (on the "
          + "curve), a hazard " + ((c2 + dGear) / 2).toFixed(1) + " m ahead - inside the " + dGear.toFixed(1) + " m of a cut not begun, "
          + "outside the " + c2.toFixed(1) + " m of one 2 s in - is slowed in lieu, nothing re-sent",
          () => inDead.slowed && !inDead.sent.includes("/api/cmd/hold") && !inDead.sent.includes("/api/cmd/speed"),
          () => JSON.stringify(inDead));
    // 24g5. A FASTER WANT STILL ON ITS WAY IS NO CUT: she reports LOW, but the console's last command is SURVEY (the governor
    // raising her). The SLOW rung sends LOW again - replacing the raise - and holds the throttle; it does not call it a cut.
    const raising = at(80, { key: "low", told: true, wantKey: "survey" });
    check("24g5. ... and a FASTER command still on its way is no cut: she reports LOW, the console last sent SURVEY - the SLOW "
          + "rung sends LOW again (replacing the raise) and holds the throttle",
          () => raising.level === "slow" && raising.slowed && raising.sent.includes("/api/cmd/speed"),
          () => JSON.stringify(raising));
    // 24h2. MID-DECAY, AND JUDGED THROUGH THE WATER: LOW sent `el` s ago, she has come down the curve to 5.5 kn; calm, and in a
    // 1.75 kn head set (3.75 kn over the ground). Both are cuts under way: the SLOW rung takes the throttle, nothing re-sent.
    const pS = slowProfile(7 * KN, lowD, lawF, SPEED_CMD_LATENCY_S, 0);
    let elM = 0; while (pS(elM) > 5.5 * KN && elM < 60) elM += 0.05;
    const midCalm = at(65, { kn: 5.5, key: "low", told: true, ago: Math.round(elM * 1000) });
    const midSet = at(60, { kn: 5.5, key: "low", told: true, ago: Math.round(elM * 1000), headSetKn: 1.75 });
    check("24h2. ... and MID-DECAY, judged THROUGH THE WATER: " + elM.toFixed(1) + " s into a cut, down the curve to 5.5 kn - in "
          + "calm water, and in a 1.75 kn head set where she makes only 3.75 kn over the ground - the SLOW rung takes the "
          + "throttle as a cut under way, nothing re-sent",
          () => midCalm.level === "slow" && midCalm.slowed && !midCalm.sent.includes("/api/cmd/speed")
                && midSet.level === "slow" && midSet.slowed && !midSet.sent.includes("/api/cmd/speed"),
          () => "calm: " + JSON.stringify(midCalm) + "; head set: " + JSON.stringify(midSet));
    // 24j. SLOW FIRST, THEN HOLD, MID-CUT - the ordinary approach. The SLOW rung sends LOW 80 m out; 6 s on she has come down
    // her curve and the reading is HOLD: the slow-instead-of-hold is still asked, of the cut already flying, and answers it.
    at(80);
    const latched = clearance.slowed && paths().includes("/api/cmd/speed");
    let x6j = 0; for (let t = 0.5; t <= 6 + 1e-9; t += 0.5) x6j += pS(t - 0.5) * 0.5;
    S.status.speed_key = "low"; clock += 6000; aisPolledAt = clock;
    asv = ll(x6j, 0); S.status.sog_kn = pS(6) / KN; sent = []; frame();
    const j = { level: clearance.level, slowed: clearance.slowed, lieu: !!slowLieu, sent: paths().slice() };
    check("24j. ... and SLOW FIRST, THEN HOLD, mid-cut - the ordinary approach: LOW sent 80 m out by the SLOW rung, 6 s on she "
          + "has come down her curve and reads HOLD - the slow-instead-of-hold is still asked of the cut already flying (the "
          + "SLOW rung's latch no longer shuts it out) and answers it: no hold",
          () => latched && j.level === "hold" && j.lieu && !j.sent.includes("/api/cmd/hold"),
          () => "latched by SLOW " + latched + "; 6 s on: " + JSON.stringify(j));
    // 24h3. A BOAT TOLD A SPEED BELOW THE SET IS STALLED, NOT SLOWED: in a 3.75 kn head set LOW (4 kn) does not make way, so
    // told LOW and still at 7 kn through the water she is NOT taken as a cut - the SLOW rung says nothing is being taken off.
    const stalled = at(60, { key: "low", told: true, headSetKn: 3.75 });
    check("24h3. ... and a boat told a speed BELOW the set is being stalled, not slowed: in a 3.75 kn head set, told LOW at 7 kn "
          + "through the water, she is not taken as a cut under way - nothing latched",
          () => stalled.level === "slow" && !stalled.slowed, () => JSON.stringify(stalled));
    // 24k. THE CURVE STARTS FROM HER SPEED THROUGH THE WATER: the SLOW rung sends LOW in a 1.75 kn head set at 7 kn through the
    // water (5.25 over the ground) - the record keeps 7 kn, or every later frame would read her as off her own curve.
    at(80, { headSetKn: 1.75 });
    const rec = __getSpeedWant();
    check("24k. ... and the cut's curve starts from her speed THROUGH THE WATER when it was sent: LOW sent in a 1.75 kn head set "
          + "at 7 kn through the water records 7 kn, not the 5.25 kn she makes over the ground",
          () => rec && rec.key === "low" && Math.abs(rec.tw - 7 * KN) < 0.01,
          () => "recorded " + (rec ? (rec.tw / KN).toFixed(2) + " kn for " + rec.key : "nothing"));
    // 24i. THE EVERY-FRAME RE-CHECK FLIES IT TOO, from where she is, with the cut's elapsed time credited. Slowed in lieu
    // 70 m from a parked hull; 6 s on she has come down as the law says - and it still answers; 6 s on still at 7 kn,
    // the slow-down was taken but is not happening - and the hold fires.
    const reCheck = (follows) => {
      at(70);
      const ok1 = clearance.slowed;
      S.status.speed_key = "low";
      const x6 = follows ? (() => { let x = 0; for (let t = 0.5; t <= 6 + 1e-9; t += 0.5) x += prof(t - 0.5) * 0.5; return x; })() : 6 * 7 * KN;
      clock += 6000; aisPolledAt = clock;
      asv = ll(x6, 0); S.status.sog_kn = follows ? prof(6) / KN : 7;
      sent = []; frame();
      return { first: ok1, level: clearance.level, slowed: clearance.slowed, sent: paths().slice(), x6: +x6.toFixed(1) };
    };
    const follows = reCheck(true), stalls = reCheck(false);
    check("24i. ... and the EVERY-FRAME RE-CHECK flies it as well, the cut's elapsed time credited: slowed in lieu 70 m off, "
          + "6 s on - having come down as her law says - it still answers it; 6 s on still at 7 kn, the slow-down taken but "
          + "not happening, the hold fires",
          () => follows.first && !follows.sent.includes("/api/cmd/hold") && follows.slowed
                && stalls.first && stalls.sent.includes("/api/cmd/hold"),
          () => "following her law: " + JSON.stringify(follows) + "; still at 7 kn: " + JSON.stringify(stalls));
    V.VESSEL.maneuvering = wasM; __setSpeedWant(null);
  }
}

// ── 25. THERE IS NO OPERATOR'S WAIT AT ALL (Andy, 2026-11-01: "remove the wait for operator rule for ais
//        target avoiding. go to immediate maneuver to avoid") - a minute until 2026-09-28, 30 s until 09-29,
//        10 s until today, and now nothing. What is left is the SPACING BETWEEN TRIES, one constant, and
//        every sentence that states it reads that constant ───────────────────────────────────────────────
{
  const tipAt = H.indexOf('$("#gb_around").title =');
  const tip = tipAt >= 0 ? H.slice(tipAt, tipAt + 420) : "";
  // aisAroundTick's own body, comments stripped: a test of the episode's `since` IS the wait, whatever it is
  // called and whatever number it holds, so the check is that there is no such test rather than that some
  // number is zero. A zero-valued constant would still leave a gate for somebody to raise again.
  const tickAt = H.indexOf("function aisAroundTick(");
  const tick = tickAt >= 0 ? H.slice(tickAt, H.indexOf("\n}", tickAt)) : "";
  const tickCode = tick.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n").replace(/\/\/.*$/gm, "");
  const sinceGate = /\.since\b/.test(tickCode);
  check("25. the console waits for nobody: aisAroundTick's body holds no test of the episode's `since` - the gate that WAS the operator's wait - and no sentence anywhere in the page offers to wait one out",
        () => tick.length > 0 && !sinceGate && !/waiting out the/.test(H)
              && !/did not clear the line within/.test(H) && !/the operator's \d+ s\b/.test(H),
        () => "tick body " + tick.length + " chars, `since` gate " + sinceGate
            + "; page says 'waiting out the' " + /waiting out the/.test(H)
            + ", 'did not clear the line within' " + /did not clear the line within/.test(H)
            + ", \"the operator's N s\" " + /the operator's \d+ s\b/.test(H));
  // ⚠⚠ 25b IS THE WHOLE OF "Delete that" AS A CHECK (Andy, 2026-11-02). There is no timing constant in this
  // maneuver any more - not an operator's wait, not a retry spacing - and nothing anywhere counts seconds down
  // to a try. What gates a RE-try is the MODEL the last refused try was taken on, which is three identity
  // comparisons and no clock. The only `AIS_AROUND_RETRY_MS` the page may still contain is the two comments
  // that record the deletion, so this asserts the CODE is clean of it rather than the file.
  const codeOnly = H.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ").replace(/([^:"'])\/\/.*$/gm, "$1");
  const secondsSaid = /routes round her itself in " \+|tries again itself in " \+|s between tries/.test(codeOnly);
  // ⚠ THE COMPARISON LIVES IN aroundTriedSame NOW (2026-11-03), and the signature in aroundTrySig, because the
  // suite's own stand-aside helper was re-writing that expression by hand and so reddened whenever the page's
  // changed. The check follows it rather than loosening: the compare must still be field by field, and `ko` and
  // `route` must still be matched by IDENTITY - a JSON compare of either would turn an exact test for "the chart
  // I was refused on" into a deep walk that answers the same for a re-read of water that has moved.
  const sameAt = H.indexOf("function aroundTriedSame(");
  const sameCode = sameAt >= 0 ? H.slice(sameAt, H.indexOf("\n}", sameAt)) : "";
  const sigAt = H.indexOf("function aroundTrySig(");
  const sigCode = sigAt >= 0 ? H.slice(sigAt, H.indexOf("\n}", sigAt)) : "";
  check("25b. ... and NO TIMER IS LEFT AT ALL: AIS_AROUND_RETRY_MS is gone from the code, aisAroundTick gates a "
        + "re-try on the MODEL (what the contacts reported, a fresh chart read, a changed route, where SHE is, "
        + "the standoff) and not on a clock, and not one sentence in the page counts seconds down to a try",
        () => !/AIS_AROUND_RETRY_MS/.test(codeOnly)
              && !/aroundAt < /.test(tickCode)
              && /aisAvoid\.triedOn/.test(tickCode) && /aroundTriedSame\(/.test(tickCode)
              && sameCode.length > 0 && !/Date\.now\(\)/.test(sameCode) && !/Date\.now\(\)/.test(sigCode)
              && /a\.polled === b\.polled/.test(sameCode) && /a\.ko === b\.ko/.test(sameCode)
              && /a\.route === b\.route/.test(sameCode) && /a\.at === b\.at/.test(sameCode)
              && /a\.std === b\.std/.test(sameCode)
              && !secondsSaid
              && /keeps trying itself, every frame/.test(H),
        () => "constant in code " + /AIS_AROUND_RETRY_MS/.test(codeOnly)
            + ", clock gate in the tick " + /aroundAt < /.test(tickCode)
            + ", a clock in the signature or the compare "
            + (/Date\.now\(\)/.test(sigCode) || /Date\.now\(\)/.test(sameCode))
            + ", model gate " + /aisAvoid\.triedOn/.test(tickCode)
            + ", asks aroundTriedSame " + /aroundTriedSame\(/.test(tickCode)
            + ", compares polled/ko/route/at/std "
            + [/a\.polled === b\.polled/, /a\.ko === b\.ko/, /a\.route === b\.route/, /a\.at === b\.at/,
               /a\.std === b\.std/].map(r => r.test(sameCode)).join("/")
            + ", a sentence still counting seconds " + secondsSaid
            + "; tooltip " + (tip ? tip.slice(0, 140) : "NOT SET"));
}

// ── 26. ON STATION THE LADDER JUDGES THE DRIFT (Andy, 2026-09-30, items 2 and 5 of his list: the SLOW / "Clear ahead
//        again" chatter while she held station at home, and the guard hold at the end of a line in a following set,
//        which blocks the plan's end-of-plan RTH) ──────────────────────────────────────────────────────────────────────
// A boat the vessel reports station-keeping - at a plan's end point, on the operator's Hold, at an escape's point - is
// being steered BACK to her point, so her own velocity flown on for 45 s is a track she will never make. On station the
// ladder judges the drift; the helm decides on it as before, and slow and hold command nothing.
function stationing(beh, sogKn, cogDeg, o = {}) {
  surveying(sogKn, [], { ...o, behavior: beh });
  mission.lines = []; runLineIdx = -1; lineSwing = -1;
  runRoute = [ll(-200, 0), ll(0, 0)]; window._wpIndex = runRoute.length; S.wp_total = runRoute.length;   // the route is flown: she is on its end point
  S = { ...S, status: { ...S.status, holding: true, cog_deg: cogDeg, heading_deg: cogDeg, sog_kn: sogKn,
                        speed_key: o.key || "low", env_set_deg: o.setDeg || 0, env_set_kn: o.setKn || 0 } };
}
{
  // 26. his rehearsal log: line 8 at HIGH, 7.7 kn over the ground with the 1.75 kn set behind her, 0.9 m from the last
  // waypoint - the frame the vessel reports holding - "Keep-out 16 s ahead and closing — HOLDING". Here: north at 7.7 kn,
  // a block 45 m ahead (its buffer from 42 m), the set 1.75 kn north: at her speed the line enters in 11 s; the drift does
  // not reach it inside the look-ahead (0.9 m/s x 45 s = 40.5 m).
  stationing("survey", 7.7, 0, { ko: wall(45), setKn: 1.75, setDeg: 0, key: "high" });
  frame(); clock += 250; frame(); clock += 1000; frame();
  const lvl26 = clearance.level, why26 = clearance.why || "";
  check("26. ARRIVING ON the end point of a plan at 7.7 kn with the set behind her and a block 45 m beyond it, the frame she reports holding reads CLEAR on the drift - no hold, nothing banked, no banner: the plan's own end hold stands, so its end action (an RTH) can fire",
        () => lvl26 === "clear" && /on station/.test(why26) && !paths().includes("/api/cmd/hold") && paths().length === 0
              && guardHeld === null && banners.length === 0 && guardActedAt === 0,
        () => "level " + lvl26 + " ('" + why26.slice(0, 90) + "'), sent " + JSON.stringify(paths()) + ", banked " + !!guardHeld
            + ", banners " + JSON.stringify(banners.map(b => b.slice(0, 60))));
  // 26b. the SCOPE, and the control in the same water: a plan ending in STOP coasts on at 7.7 kn with nothing holding her
  stationing("survey", 7.7, 0, { ko: wall(45), setKn: 1.75, setDeg: 0, key: "high" });
  S = { ...S, run: "idle", status: { ...S.status, holding: false } };
  frame();
  check("26b. ... and the SCOPE: the same water and the same 7.7 kn on a boat NOT station-keeping - a plan that ended in STOP, coasting on - IS held (her own track is what she will make); only a boat already holding is judged on the drift",
        () => paths().includes("/api/cmd/hold") && guardLevel === "hold",
        () => "level " + guardLevel + ", sent " + JSON.stringify(paths()));
}
{
  // 26c. his DriX at home after an RTH (the 2026-09-29 rehearsal): hunting at 3.9 kn, bow toward then away from a block
  // 89.4 m off, every 10 s for 80 s - no set. Her own line reaches its buffer in 43 s (SLOW), then clears.
  stationing("rth", 3.9, 0, { ko: wall(89.4), key: "low" });
  let notClear = 0;
  for (let k = 0; k < 80; k++) {
    const toward = Math.floor(k / 10) % 2 === 0;
    S = { ...S, status: { ...S.status, cog_deg: toward ? 0 : 180, heading_deg: toward ? 0 : 180 } };
    clock += 1000; aisPolledAt = clock; frame();        // the feed kept fresh: an empty sea, not a stale one
    if (clearance.level !== "clear") notClear++;
  }
  check("26c. STATION-KEEPING AT HOME, hunting at 3.9 kn toward and away from a block 89.4 m off for 80 s: no SLOW, no 'Clear ahead again', no banner and no command - every frame reads clear on the drift (his rehearsal: the pair every 19 s for three minutes)",
        () => notClear === 0 && paths().length === 0 && banners.length === 0
              && !notes.some(n => /SLOWED|Clear ahead again|NOT slowed|HOLDING|On station/.test(n)),
        () => "frames not clear " + notClear + ", sent " + JSON.stringify(paths()) + ", banners "
            + JSON.stringify(banners.map(b => b.slice(0, 120))) + ", notes " + JSON.stringify(notes.map(n => n.slice(0, 50))));
}
{
  // 26d. THE HELM STILL ACTS ON STATION: holding at a Go-To point in a 2.5 kn set onto a block 12 m off (its buffer from
  // 9 m, half the buffer from 10.5 m) - the drift alone is inside half the buffer in 8 s, under the 20 s a decision needs.
  // Her own motion AWAY from it, at 1 kn: the old straight line never entered, and assess answered clear before the drift
  // was ever tested (the vel=0 probe trap) - so this is also where the new model is stronger than the old.
  stationing("goto", 1.0, 180, { ko: wall(12), setKn: 2.5, setDeg: 0, key: "low" });
  escFake = { hdg: 180, to: { e: 0, n: -60 }, m: 60, capped: false, clear: true, survived: 45, worst: 30, gain: 30 };
  frame();
  const first26 = clearance.level, why26d = clearance.why || "";
  clock += 1600; frame();                             // past HELM_DWELL_MS: the rung acts
  check("26d. ON STATION THE HELM STILL ACTS, on the drift: holding in a 2.5 kn set onto a block 12 m off, with her own motion AWAY from it, reads IN EXTREMIS and after the dwell the escape is commanded - said as the hold she is on not answering it",
        () => first26 === "helm" && /on station, and the drift alone reaches within/.test(why26d) && paths().includes("/api/cmd/escape"),
        () => "first frame " + first26 + " ('" + why26d.slice(0, 90) + "'), sent " + JSON.stringify(paths()));
  // 26e. ... the same frame judged on her OWN velocity - the model before 2026-09-30 - reads clear: the control that 26d
  // measures the change, not a helm that would have fired anyway
  const pe = ref.toEN(asv), dr = G.groundVel(0, 2.5), own = G.groundVel(180, 1.0);
  const oldLvl = G.assess(pe, own, dr, wall(12), 3, {}).level, newLvl = G.assess(pe, dr, dr, wall(12), 3, {}).level;
  check("26e. ... CONTROL: the same frame judged on her own velocity (the old model) reads CLEAR - the probe trap - while the drift reads helm: 26d measures the change",
        () => oldLvl === "clear" && newLvl === "helm",
        () => "her own velocity -> " + oldLvl + ", the drift -> " + newLvl);
}
{
  // 26f. A HOLD READING ON STATION IS A STATE: holding at a Go-To point in a 1.75 kn set toward a block 30 m off - the
  // drift reaches its buffer in 30 s (inside the look-ahead, beyond the 20 s a decision needs): HOLD, and nothing to do
  stationing("goto", 0.5, 90, { ko: wall(30), setKn: 1.75, setDeg: 0, key: "low" });
  for (let k = 0; k < 40; k++) { clock += 1000; aisPolledAt = clock; frame(); }
  check("26f. ON STATION A DRIFT THAT REACHES THE HAZARD BEYOND A DECISION'S WORTH OF TIME reads HOLD, said as the hold she is on answering it - ONE banner in 40 s (a state, not a stream), and no command: a hold at present position would only move her point",
        () => guardLevel === "hold" && banners.length === 1 && /on station — the drift alone reaches it in 3\d s/.test(banners[0])
              && !paths().includes("/api/cmd/hold") && paths().length === 0 && /on station/.test($("#gb_why").textContent),
        () => "level " + guardLevel + ", banners " + JSON.stringify(banners.map(b => b.slice(0, 120))) + ", sent "
            + JSON.stringify(paths()) + ", bar '" + $("#gb_why").textContent.slice(0, 100) + "'");
}
{
  // 26g. FOUND ON THE LIVE REHEARSAL (MOOR-2, 11 m from her home point): "the drift alone reaches it in 19 s, more than
  // the 20 s a decision needs". HOLD, not helm, says the drift does not reach within HALF the buffer inside 20 s - it
  // may reach the buffer's edge sooner. A 0.97 kn set onto a block 12 m off: its buffer in 18 s, half of it in 21 s.
  stationing("goto", 0.3, 90, { ko: wall(12), setKn: 0.972, setDeg: 0, key: "low" });
  clock += 1000; aisPolledAt = clock; frame();
  const why26g = clearance.why || "";
  check("26g. ... and a drift that reaches the BUFFER sooner than a decision needs but not half of it says exactly that - never 'more than the 20 s' about 18 s",
        () => guardLevel === "hold" && /reaches the buffer in 18 s but not within half of it inside the 20 s a decision needs/.test(why26g)
              && !/more than the 20 s/.test(why26g) && paths().length === 0,
        () => "level " + guardLevel + ", why '" + why26g.slice(0, 160) + "', sent " + JSON.stringify(paths()));
}
{
  // 26h. THE SCOPE OF "ON STATION", asked of the predicate itself: a boat station-keeping at a Go-To point is; the GUARD'S
  // OWN hold is not (its record and the FRIGGA rules stand, 20-21f); nor is a boat inside a LAUNCH GRANT (R10: there a
  // hold becomes a STOP, and judging her on station would stand that down)
  stationing("goto", 1.0, 0, { ko: wall(40) });
  const plain = guardOnStation(null);
  S = { ...S, behavior: "hold" }; guardActedAt = clock;
  const own = guardOnStation(null);
  guardActedAt = 0;
  const opHold = guardOnStation(null);
  S = { ...S, behavior: "goto" };
  const inGrant = guardOnStation({ covered: [] });
  check("26h. ... and the SCOPE of on station: a boat station-keeping at a Go-To point, or on the operator's Hold, is; the guard's OWN hold is not (the FRIGGA rules stand); nor is a boat inside a launch grant (R10's STOP stands)",
        () => plain === true && opHold === true && own === false && inGrant === false,
        () => JSON.stringify({ goto: plain, operatorHold: opHold, guardsOwnHold: own, inGrant }));
}
{
  // 26i. AN ON-STATION HOLD THAT CLEARS IS RELEASED: no counterfactual on station - asked at the plan's speed along her bow
  // (here pointing at the block she is holding off) it would read the hazard and never let go
  stationing("goto", 0.5, 0, { ko: wall(30), setKn: 1.75, setDeg: 0, key: "low" });
  for (let k = 0; k < 3; k++) { clock += 1000; aisPolledAt = clock; frame(); }
  const held26i = guardLevel;
  S = { ...S, status: { ...S.status, env_set_kn: 0 } };      // the set slackens
  notes = [];
  for (let k = 0; k < 8; k++) { clock += 1000; aisPolledAt = clock; heldModel(); frame(); }
  check("26i. ... and when the drift no longer reaches it, the on-station HOLD is RELEASED and said as on station - with no counterfactual at the plan's speed along her bow, which would read the very hazard she holds off and never let go",
        () => held26i === "hold" && guardLevel === "clear" && notes.some(n => /^On station \(/.test(n)) && paths().length === 0,
        () => "level " + held26i + " -> " + guardLevel + ", notes " + JSON.stringify(notes.map(n => n.slice(0, 90))) + ", sent " + JSON.stringify(paths()));
}

// ── 27. HER CLEAR WATER (Andy, 2026-10-17, of VICTORIA T, a 200 x 32 m ship at anchor: "the ASV should not come so close to
//        the vessel. Perhaps scale closure range to vessel size?" - asked, "Half her length") ─────────────────────────────
// His survey ran a line 28.8 m off her side with the guard content, and was held 30.2 m off her before the way round. Here
// the page's own model, with the module's margin: her hull grown by half her length.
{
  // VICTORIA T as she broadcast it - antenna 173 m from her bow, 27 from her stern, 10 to port, 22 to starboard - lying
  // north from the line (heading 0), her stern 28.8 m north of it at e = 140..172; the line run on to e = 600 past her
  const VIC = () => contact(150, 55.8, { mmsi: 636022926, name: "VICTORIA T", sog: 0, cog: null, heading: 0, nav: 1,
                                         dim: { a: 173, b: 27, c: 10, d: 22 }, length: 200, beam: 32 });
  const LONG = { a: ll(-200, 0), b: ll(600, 0) };
  const longLine = () => { mission = { ...mission, lines: [LONG], waypoints: [LONG.a, LONG.b] };
                           runRoute = [ll(-200, 0), LONG.b, ll(600, 60), ll(-200, 60)]; S.wp_total = runRoute.length; };
  aisMarginHere = 0;
  surveying(7, [VIC()]); longLine(); frame();
  const bare = { level: clearance.level, sent: paths().slice() };
  aisMarginHere = null;                                        // the page as it runs: the module's own margin
  surveying(7, [VIC()]); longLine(); frame();
  const ko27 = aisKoDrawn[0] || {};
  const kept = { level: clearance.level, sent: paths().slice(), said: banners.concat(notes).filter(b => /VICTORIA T/.test(b)).length };
  // ⚠ SINCE 2026-11-01 HER STATUS GIVES HER A WATCH CIRCLE (ais_keepout.js aisNavRule), and here the boat starts inside it
  // (no chart in this world: 30 m of water assumed, a 452 m circle) - so the half-length clear water stands in for it
  // (ruleWaived), exactly the 100 m this check was written for. 28 is the circle itself, the boat outside it.
  check("27. THE REPORT: VICTORIA T (200 x 32 m, at anchor) with her stern 28.8 m off the line - on her bare hull the guard "
        + "reads the line clear and sends nothing (what his survey did, 28.8 m off her); with her clear water, 100 m round "
        + "her, it ANSWERS "
        + "her before she is reached, naming her (the boat inside her watch circle: the half-length clear water stands in)",
        () => AIS_MARGIN_FRAC === 0.5 && bare.level === "clear" && bare.sent.length === 0 && ko27.marginM === 100
              && ko27.rule === "anchored" && ko27.ruleWaived === true
              && kept.level !== "clear" && kept.sent.length > 0 && kept.said > 0,
        () => JSON.stringify({ bare, kept, marginM: ko27.marginM }));

  // the way round her, on the first station frame: outside her clear water by the standoff, her bare hull never nearer
  surveying(7, [VIC()]); longLine(); frame(); nowHolding(); sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  clock += WHILE_MS + 1000; aisPolledAt = clock; frame(); await settle();
  const up = sent.find(x => x.p === "/api/cmd/upload"), rte = (up && up.route) || [];
  const hull27 = AK_aisKeepouts([VIC()], ref, { now: clock, polledAt: clock, sweepS: 0, marginFrac: 0, navRules: false }).polys[0];
  const wayIn = wayInOf(rte, ll(0, 0));
  const dH = rte.length ? minClearTo(wayIn, hull27) : null;
  check("27b. ... and the way round her, on the first station frame, keeps her clear water: the way in never within 100 m of her "
        + "hull (her clear water) - plus the standoff - where her bare hull alone let the line pass at 28.8 m",
        () => rte.length >= 3 && dH != null && dH >= 100 + 3 - 0.5,
        () => rte.length + " wpts; closest to her hull " + (dH == null ? "-" : dH.toFixed(1)) + " m; sent " + JSON.stringify(paths()));

  // a ship that anchors beside the boat as she holds: inside her clear water, outside her hull and the buffer
  const BESIDE = () => contact(0, 70, { mmsi: 636000001, name: "ANCHORED BESIDE", sog: 0, cog: null, heading: 90, nav: 1,
                                        dim: { a: 100, b: 100, c: 10, d: 10 }, length: 200, beam: 20 });   // her side 60 m north
  // ON STATION, DRIFTING 0.4 kn TOWARD HER (the ladder judges the drift - 26): a boat with no course is blind, and a
  // blind frame judges nothing, so this one drifts. Removing the waiver is the control: she is then inside a keep-out,
  // which the ladder reads as in extremis (tests/../perf mutate: the waiver's mutant takes the helm here).
  stationing("hold", 0.4, 0, { setKn: 0.4, setDeg: 0 });
  aisVessels = [BESIDE()]; aisPolledAt = clock;
  frame(); clock += 1000; aisPolledAt = clock; frame();
  const besideQ = aisKoDrawn[0] || {};
  const beside = { level: clearance.level, sent: paths().slice(), why: (clearance.why || "").slice(0, 80) };
  check("27c. a 200 m ship anchoring 60 m off a boat holding station and drifting 0.4 kn toward her - inside her 100 m of "
        + "clear water, well off her hull - does NOT take the helm: the boat is already in that water, so that ship is "
        + "her bare hull (marginWaived), the drift judged against it (not blind), and the boat is not driven out of it",
        () => besideQ.marginWaived === true && besideQ.marginM === 0 && beside.level !== "helm" && beside.level !== "blind"
              && !beside.sent.some(p => /escape|goto|upload/.test(p)),
        () => JSON.stringify({ waived: besideQ.marginWaived, ...beside }));

  // a 20 m boat or one broadcasting no size: 10 m clear - the tight way round he asked for on 09-28 stays tight
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  clock += WHILE_MS + 1000; aisPolledAt = clock; frame(); await settle();
  const up2 = sent.find(x => x.p === "/api/cmd/upload"), rte2 = (up2 && up2.route) || [];
  const dC2 = rte2.length ? minDistTo(wayInOf(rte2, ll(0, 0)), PARKED_C) : null;
  check("27d. ... and a 30 x 8 m workboat keeps 15 m: the way round her passes no nearer her center than her own length "
        + "(30 m) and no farther than her clear water plus the standoff and the buffer allow (her half-beam 4 + 15 + 3 + 3 = "
        + "25 m abeam is inside the ship-length disc) - still the tight way round of 09-28, within a meter and a half",
        () => rte2.length >= 3 && dC2 != null && dC2 >= 30 - 0.05 && dC2 <= 31.5,
        () => rte2.length + " wpts; closest to her center " + (dC2 == null ? "-" : dC2.toFixed(2)) + " m");

  // ── 28. AT ANCHOR, HER WATCH CIRCLE (Andy, 2026-11-01: "Anchored we must assume a watch circle driven by tide and/or
  //        current and/or wind. Calculate watch circle and add another 10m to the radius for safety.") ──────────────────
  // A 40 x 10 m vessel at anchor in a charted 5 m, heading north, her hull 40-80 m north of the line: cable 3 x 5 + 90 =
  // 105 m, her watch circle hypot(105 + 40, 5) = 145.1 m round her anchor, 105 cos 20 = 98.7 m ahead of her bow, grown by
  // 105 sin 20 = 35.9 m and the 10 m: 191.0 m. Its south edge is 12.3 m south of the line, over 67 m of it either side of
  // e = 97.4; the boat at the line's start is 12.5 m outside it. Her bare hull, and the half-length clear water round it
  // (20 m), leave the line 40 and 20 m clear.
  const ANCH = () => contact(97.4, 60, { mmsi: 636000002, name: "AT ANCHOR", sog: 0, cog: null, heading: 0, nav: 1,
                                         dim: { a: 20, b: 20, c: 5, d: 5 }, length: 40, beam: 10, chart_depth_m: 5 });
  aisMarginHere = 0;
  surveying(7, [ANCH()]); longLine(); frame();
  const bare28 = { level: clearance.level, sent: paths().slice() };
  aisMarginHere = null;
  surveying(7, [ANCH()]); longLine(); frame();
  const ko28 = aisKoDrawn[0] || {};
  const kept28 = { level: clearance.level, sent: paths().slice(), said: banners.concat(notes).filter(b => /AT ANCHOR/.test(b)).length };
  check("28. AT ANCHOR, THE GUARD ANSWERS HER WATCH CIRCLE: a 40 m vessel anchored in 5 m whose hull is 40 m off the line "
        + "(clear on her hull and on the half-length rule) has a 191 m circle reaching 12.3 m over the line - the guard "
        + "ANSWERS it from 12.5 m outside, naming her, where her bare hull read the line clear",
        () => bare28.level === "clear" && bare28.sent.length === 0
              && ko28.rule === "anchored" && !ko28.ruleWaived && ko28.watch && Math.abs(ko28.watch.koM - 191.0) < 0.1
              && kept28.level !== "clear" && kept28.sent.length > 0 && kept28.said > 0,
        () => JSON.stringify({ bare: bare28, kept: kept28, koM: ko28.watch ? +ko28.watch.koM.toFixed(1) : null, ruleWaived: ko28.ruleWaived }));

  // the way round her, on the first station frame: outside her watch circle, with the standoff
  surveying(7, [ANCH()]); longLine(); frame(); nowHolding(); sent = []; notes = []; banners = []; logged = []; pinCalls = []; pinNext = null;
  clock += WHILE_MS + 1000; aisPolledAt = clock; frame(); await settle();
  const up28 = sent.find(x => x.p === "/api/cmd/upload"), rte28 = (up28 && up28.route) || [];
  const watch28 = AK_aisKeepouts([ANCH()], ref, { now: clock, polledAt: clock, sweepS: 0 }).polys[0];
  const dW = rte28.length ? minClearTo(wayInOf(rte28, ll(0, 0)), watch28) : null;
  check("28b. ... and the way round her, on the first station frame, keeps OUTSIDE her watch circle by the standoff - not the "
        + "ship-length disc round her hull, which the circle replaces",
        () => rte28.length >= 3 && dW != null && dW >= 3 - 0.5,
        () => rte28.length + " wpts; closest to her watch circle " + (dW == null ? "-" : dW.toFixed(1)) + " m; sent " + JSON.stringify(paths()));
  aisMarginHere = 0;
}

// ── 4b-4f. THE AVOIDING FLAG ──────────────────────────────────────────────────────
// Andy, 2026-11-02: "Create a flag that attaches to the ASV an reads AVOIDING until it's back on line or
// natural transit". ⚠⚠ IT IS RECORDED WHERE A DEVIATION WAS ACCEPTED AND NEVER DERIVED - the raise sits
// in the statement list of each maneuver that landed, so it cannot claim one the vessel refused. And "back on
// line" is the page's OWN answer (runLineIdx), the same one the LINES table and the chart's solid line ask, so
// three surfaces agree by construction rather than by coincidence.
{
  avoiding = null; runLineIdx = -1; lineSwing = -1;
  surveying(7, [PARKED()]); frame(); nowHolding(); sent = []; logged = [];
  const recBefore = avoiding;
  frame(); await settle();
  // ⚠ THE RAISE AND THE LOWERING ARE CHECKED APART, and the first draft conflated them. `avoidingNow()` is the
  // record AND the predicate, and this suite does not run accumLineTime - the page's own maintainer of
  // runLineIdx - so `surveying()` leaves it at 0 and the predicate lowered the flag on the very frame the raise
  // put it up. The RECORD is what the raise owns and is read here; the predicate is 4e's, driven by explicit
  // runLineIdx / lineSwing so each arm is a stated scene rather than a leftover.
  const rec = avoiding, sent4b = paths().slice();
  check("4b. nothing is recorded while she merely HOLDS - a hold is not a deviation - and the record goes up on "
        + "the frame the way round actually lands, naming what she was kept clear of",
        () => recBefore === null && !!rec && rec.why === "routed round" && /WORKBOAT/.test(rec.kind)
              && sent4b.includes("/api/cmd/upload"),
        () => "before " + JSON.stringify(recBefore) + ", after " + JSON.stringify(rec)
            + ", sent " + JSON.stringify(sent4b));
  // ⚠⚠ 4b2. AND THE INDEX POINTS AT THE PICK-UP, WHICH NOTHING ASSERTED ON THE SURVEY PATH (2026-11-03, the
  // third review: `rejoinIdx = 0`, `rejoinIdx = via.length + 1` and deleting the assignment outright ALL
  // survived 208 of 208, where the same three mutations on the LEG path are each killed by 23e2). 4e drives
  // `_wpIndex` around whatever `rec.rejoin` happens to hold, so it cannot tell a right index from a wrong one -
  // it is the "setting the fields the predicate reads" shape this file's own comments warn about, one level up.
  // The index is pinned GEOMETRICALLY here, as 23e2 pins the leg's: the way in's detour comes first, then the
  // pick-up past her ring at e = 65, then the plan's own remaining waypoints - so `rejoin` must be
  // `rte.length - 4` and `rte[rejoin]` must BE that pick-up. With `rejoinIdx` 0 it would point at the FIRST
  // detour waypoint, which is the furthest she gets from her planned track in the whole maneuver.
  {
    const up4b = sent.find(x => x.p === "/api/cmd/upload"), rte4b = (up4b && up4b.route) || [];
    const rj = rec ? rec.rejoin : null;
    check("4b2. ... and the index it carries is the PICK-UP's in the route the upload sent - after the way in's "
          + "detour, not the first detour waypoint - with the waypoint itself on the record, so an operator "
          + "resume that splices in front of it cannot shift the lowering",
          () => rte4b.length > 4 && rj === rte4b.length - 4 && rj > 0
                && distTo(rte4b[rj], ll(65, 0)) < 0.5
                && !!rec.rejoinWp && distTo(rec.rejoinWp, ll(65, 0)) < 0.5,
          () => "rejoin " + rj + " of " + rte4b.length + " wpts (the pick-up sits at " + (rte4b.length - 4)
              + "); rte[rejoin] " + (rte4b[rj] ? distTo(rte4b[rj], ll(65, 0)).toFixed(2) + " m from (65,0)" : "none")
              + "; rejoinWp " + (rec && rec.rejoinWp
                  ? distTo(rec.rejoinWp, ll(65, 0)).toFixed(2) + " m from (65,0)" : "none"));
  }
  runLineIdx = -1; lineSwing = -1;            // flying the way in: off her line, which is where the flag is for
  renderAvoiding();
  check("4c. ... and the badge on the chart says so, in words the operator reads",
        () => /AVOIDING/.test(EL["#r_avoid"].textContent || "")
              && /ROUTED ROUND/.test(EL["#r_avoid"].textContent || "")
              && EL["#r_avoid"].style.display === "block",
        () => JSON.stringify(EL["#r_avoid"] && EL["#r_avoid"].textContent) + " display "
            + (EL["#r_avoid"] && EL["#r_avoid"].style.display));
  check("4d. ... and it is in the session record, so a run can be read back afterwards",
        () => logged.some(e => e.kind === "avoiding" && e.data.why === "routed round"),
        () => JSON.stringify(logged.filter(e => e.kind === "avoiding").map(e => e.data)));
  // ⚠⚠ THE LOWERING IS THE REJOIN WAYPOINT, AND THIS CHECK USED TO ASSERT THE DEFECT (2026-11-02, review).
  // It set runLineIdx / lineSwing by hand and asserted the flag came down on `runLineIdx >= 0 && lineSwing < 0`.
  // That is the state a surveying boat ON A LINE IS ALREADY IN when the console moves her, so on the real page
  // the edge rung's and the escape's raises were erased by the very next updateMissionCard(); on a leg
  // runLineIdx is -1 by construction and nothing lowered it at all. Setting the two fields the predicate reads
  // is exactly how a fixture proves nothing. The lever is now the pick-up's index in the route the command
  // uploaded, which is the same question on a line and on a leg, and it is driven here through `_wpIndex`.
  const rej = rec ? rec.rejoin : null;
  window._wpIndex = Math.max(0, rej);           const atPickUp = avoidingNow();
  window._wpIndex = Math.max(0, rej) + 1;       const pastPickUp = avoidingNow();
  renderAvoiding();
  check("4e. it stays up until she has PASSED the pick-up waypoint of the route the way round uploaded, and "
        + "comes down then - one notion of 'on track' for a line and a leg alike, and never the state she was "
        + "already in when the console moved her",
        () => rej != null && !!atPickUp && pastPickUp === null && avoiding === null
              && EL["#r_avoid"].style.display === "none",
        () => "rejoin " + rej + "; at the pick-up " + !!atPickUp + ", past it " + JSON.stringify(pastPickUp)
            + ", badge " + EL["#r_avoid"].style.display);
  // ⚠⚠ AND THE INDEX HAS TO COUNT INTO THAT ROUTE, WHICH THE FIRST VERSION NEVER ASKED (2026-11-03, review).
  // `_wpIndex` is the VESSEL's number; `runRoute` is this page's array. The guard's own HOLD is the case that
  // bites: it uploads a ONE-waypoint plan over the plan she was flying, so a station-keeping vessel reports
  // wp 1/1 while this page still holds the route the rejoin index belongs to - and `1 > 0` lowered the badge on
  // the first station frame of every way round whose detour added nothing in front of the pick-up, the boat
  // still being taken round. Every other indexed reader on the page pairs the two only when the frame's
  // `wp_total` agrees with the array's length; this one now does too, and where they disagree it keeps the
  // record rather than guessing, because lowering is the destructive direction.
  {
    avoidingRaise("routed round", "AIS: WORKBOAT (30 x 8 m)", 0);
    const saveIdx = window._wpIndex, saveTot = S.wp_total;
    S.wp_total = 1; window._wpIndex = 1;            // the guard's hold: one waypoint, arrived - wp 1/1
    const onHoldPlan = avoidingNow();
    renderAvoiding();
    const badgeOnHold = EL["#r_avoid"].style.display;
    S.wp_total = runRoute.length; window._wpIndex = 1;   // and back on the route the rejoin index belongs to
    const paired = avoidingNow();
    renderAvoiding();
    check("4e4. the badge is NOT lowered by an index from another plan - the guard's own hold reports wp 1/1 "
          + "over a 20-waypoint route - and IS lowered by the same index once the frame's count says she is "
          + "counting into the route the maneuver uploaded",
          () => !!onHoldPlan && badgeOnHold === "block" && paired === null && avoiding === null
                && EL["#r_avoid"].style.display === "none",
          () => "on the hold's own plan: " + JSON.stringify(onHoldPlan) + " badge " + badgeOnHold
              + "; paired with " + runRoute.length + " waypoints: " + JSON.stringify(paired));
    window._wpIndex = saveIdx; S.wp_total = saveTot;
  }
  // AND WHERE NO INDEX CAN ANSWER IT: a one-waypoint tail reports index 0 for its whole run (the page's own
  // measurement), so an index lever can never advance past the rejoin and the badge would stay up for ever.
  // Arrival at the pick-up is the honest answer there.
  {
    avoidingRaise("routed round", "a dock / pier", 0);
    const saveRoute = runRoute, saveIdx = window._wpIndex;
    // ⚠ `asv` IS THE BOAT, and it is its own variable in this suite as it is in the page - not S.status. The
    // first draft of this check compared the waypoint against S.status and the arrival never registered.
    runRoute = [ll(400, 0)]; window._wpIndex = 0; S.wp_total = 1;   // one waypoint, 400 m off: she is not there yet
    const far = avoidingNow();
    runRoute = [{lat: asv.lat, lon: asv.lon}]; S.wp_total = 1;  // the single waypoint IS where she is: arrived
    const arrived = avoidingNow();
    runRoute = saveRoute; window._wpIndex = saveIdx; S.wp_total = saveRoute ? saveRoute.length : null;
    check("4e2. ... and on a ONE-WAYPOINT tail, where the index is pinned at 0 for the whole run, it comes down "
          + "on ARRIVAL at the pick-up instead - a record whose lowering an index cannot reach would be up for "
          + "ever (aisAroundLegPlan's atEnd and coincident-waypoint branches both return one waypoint)",
          () => !!far && arrived === null && avoiding === null,
          () => "400 m off " + !!far + ", on it " + JSON.stringify(arrived));
  }
  // AND A BOAT NOTHING IS DRIVING IS NOT BEING PUT BACK. The badge's own hover tip promises the console "will
  // put her back"; after a Stop or an E-STOP nothing will, and the Doing row that says the same is hidden.
  // ⚠⚠ ANSWERED, NOT SPENT, AND THE DIFFERENCE IS A WHOLE MANEUVER (2026-11-03, review). This arm used to
  // DESTROY the record, so one frame of `armed:false` - a partial frame, a re-arm, the moment between an e-stop
  // and its reset - permanently erased a maneuver that was still being flown, with nothing able to put it back.
  // The second arm below is the one with teeth: the SAME record, re-read on a good frame, must still be there,
  // and the old code could not pass it. guardHeldOffer asks the same question about the same boat and makes
  // exactly this distinction in its own first paragraph; a "not on this frame" must not answer for ever.
  {
    const saveRun = S.run, saveEstop = S.estop, saveArmed = S.armed;
    avoidingRaise("deviated", "a dock / pier", 3); window._wpIndex = 0;
    S.run = "paused";  const whilePaused = avoidingNow();
    S.run = "running"; S.estop = true;  const whileEstop = avoidingNow();
    S.estop = saveEstop;
    const backAfterEstop = avoidingNow();            // the same record, on the next good frame
    S.armed = false;   const whileDisarmed = avoidingNow();
    S.armed = saveArmed;
    const backAfterDisarm = avoidingNow();
    S.run = "stopped"; const whileStopped = avoidingNow();
    S.run = saveRun; S.estop = saveEstop; S.armed = saveArmed;
    check("4e3b. ... and a bad frame does not SPEND the record: the badge is silent while she is e-stopped or "
          + "disarmed and comes back on the next good frame, because what ends a maneuver is her track - the "
          + "rejoin, the arrival, or the next command - and never one frame's state word",
          () => backAfterEstop && backAfterEstop.why === "deviated"
                && whileDisarmed === null && backAfterDisarm && backAfterDisarm.why === "deviated",
          () => "after the e-stop cleared: " + JSON.stringify(backAfterEstop)
              + "; disarmed: " + JSON.stringify(whileDisarmed)
              + "; re-armed: " + JSON.stringify(backAfterDisarm));
    check("4e3. ... a PAUSE shows it - the plan is intact, the guard resumes its own hold and she is still off "
          + "her track - while an E-STOP or a Stop shows NOTHING, because the badge promises she will be put "
          + "back and after those nothing is going to do it",
          () => !!whilePaused && whileEstop === null && whileStopped === null,
          () => "paused " + !!whilePaused + ", e-stopped " + JSON.stringify(whileEstop)
              + ", stopped " + JSON.stringify(whileStopped));
  }
  avoiding = rec; window._wpIndex = 0;     // put the episode's own record back for 4f
  // A NEW COMMANDED MOTION HAS NOT BEEN DEVIATED AT ALL YET. ⚠ ASSERTED FROM THE SOURCE, because setPlanIntent
  // is a STUB in this suite's world - it is not lifted here, so calling it would prove only that the stub does
  // nothing. What has to be true is that the reset lives in setPlanIntent's own statement list, beside the
  // override and the edge budget that reset for exactly the same reason: the operator's "proceed" and the
  // console's deviation budget were both about ONE situation on ONE track. tests/end_action.js and the other
  // five suites that DO lift setPlanIntent exercise the call itself.
  const intentBody = (H.match(/function setPlanIntent\([\s\S]*?\n\}/) || [""])[0];
  check("4f. a new commanded motion drops the flag, in setPlanIntent's own reset list - beside guardOverride and "
        + "the edge budget, which reset for the same reason: a fresh plan has not been deviated yet",
        () => /guardOverride = null; edgeSpentM = 0;/.test(intentBody)
              && /\bavoiding = null;/.test(intentBody),
        () => intentBody ? (intentBody.match(/^\s*avoiding = null;[^\n]*/m) || ["NOT IN THE RESET LIST"])[0].trim()
                         : "setPlanIntent not found");
  // and the record itself answers "not avoiding" once it is cleared, whoever cleared it
  avoiding = null;
  check("4f2. ... and with nothing recorded the reader answers null - an ordinary transit is not AVOIDING, which "
        + "is the other half of what he asked for: the flag is about the console having moved her",
        () => avoidingNow() === null,
        () => JSON.stringify(avoidingNow()));
  check("4g. the page still declares the record as this suite does - a rename would give the lifted raiser and "
        + "reader their own globals and leave 4b-4f passing on nothing",
        () => /^let avoiding = null;/m.test(H),
        () => (H.match(/^let avoiding = [^;]*;/m) || ["(no declaration found)"])[0]);
  // ⚠⚠ THE WIRING, READ OFF THE REAL PAGE, BECAUSE THIS SUITE STUBS `$` (see EL at the top). Every check from
  // 4b to 4f drives renderAvoiding against a STUB element, so each of them would keep passing if the element
  // were renamed, if its CSS rule went, or if nothing on the frame path called the renderer at all - the badge
  // would simply never appear on the chart and the whole feature would be silently absent. That is the same
  // class of hole as the held-leg raise no check covered (23e2), and it is closed here by reading the page's
  // own text instead of the harness's world.
  const avoidDiv = (H.match(/<div class="avoidtag" id="r_avoid"[\s\S]{0,1200}?>/) || [""])[0];
  // ⚠⚠ THE TIP IS NOT ON THE BADGE ANY MORE, AND IT COULD NEVER HAVE BEEN READ THERE (2026-11-03, review).
  // `.avoidtag` is `pointer-events:none` - deliberately, so a 10 px pill at the top of the chart cannot swallow a
  // click meant for the chart - so the browser resolves a hover over it to the canvas underneath and the `title`
  // never opens. The previous round of this very check certified the WORDING of an advisory on a surface the
  // operator cannot reach, which is the defect class it was added to catch. The sentence is AVOID_TIP now, on the
  // Mission card's Doing row, which IS a hover target - and the badge must carry no `title` at all, or the
  // unreachable advisory is simply back.
  const avoidTip = (H.match(/const AVOID_TIP = ([^;]*);/) || ["", ""])[1]
                     .replace(/"\s*\+\s*"/g, "").replace(/"/g, "").trim();
  const doingTip = /avoidingSay\(av\) \+ "\. " \+ AVOID_TIP/.test(H);
  // ⚠ AND THE TIP HAS TO STATE THE RULE THE CODE HAS (2026-11-03, review). It promised the badge "comes down
  // when she is back on her coverage line, or running an ordinary leg again" - the FIRST version of the lowering
  // rule, replaced by the rejoin waypoint on the day it was written - so the operator was being advised of a
  // rule the page no longer had. An advisory naming a cause the code cannot produce is a defect in this project,
  // and a hover tip is an advisory.
  check("4h. the badge's element and its CSS are in the page; its sentence states the rule the code really has "
        + "- the rejoin waypoint, and the escape that chains nothing - and it lives on a surface the operator "
        + "can actually hover, which the badge itself is not: .avoidtag takes no pointer events, so a `title` "
        + "on it can never be opened and must not be there",
        () => /<div class="avoidtag" id="r_avoid"/.test(H)
              && /^\s*\.avoidtag\{/m.test(H)
              && /\.avoidtag\{[\s\S]{0,200}?pointer-events:none/.test(H)
              && !/title="/.test(avoidDiv)                       // no advisory on the unreachable surface
              && avoidTip.length > 40
              && /waypoint/.test(avoidTip) && /escape/.test(avoidTip)
              && !/back on her coverage line/.test(avoidTip)
              && doingTip,                                       // and it IS on the Doing row's hover
        () => (avoidDiv ? "div ok" : "NO #r_avoid div") + "; .avoidtag rule "
            + (/^\s*\.avoidtag\{/m.test(H) ? "present" : "MISSING")
            + ", pointer-events:none " + /\.avoidtag\{[\s\S]{0,200}?pointer-events:none/.test(H)
            + "; a title on the badge itself " + /title="/.test(avoidDiv)
            + "; the Doing row carries the sentence " + doingTip + "; sentence "
            + (avoidTip.length > 40 ? "'" + avoidTip.slice(0, 110) + "'" : "MISSING"));
  // The badge is DOM painted per frame, so the call has to be ON the frame path - and INSIDE onFrame's try,
  // or a throw in it would take the whole frame down with it.
  const frameBody   = (H.match(/function onFrame\(ev\)\{[\s\S]*?\n\}/) || [""])[0];
  const missionBody = (H.match(/function updateMissionCard\(\)\{[\s\S]*?\n\}/) || [""])[0];
  // ⚠ BRACKETED BY THE CATCH, not merely "after the try". `renderAt > tryAt` alone would also be true of a
  // call sitting BELOW the catch, which is exactly the placement this check exists to forbid.
  const bigTry   = frameBody.indexOf("\n  try{");
  const catchAt  = frameBody.indexOf("\n  }catch(", bigTry + 1);
  const renderAt = frameBody.indexOf("renderAvoiding()");
  // ⚠⚠ AND BOTH SURFACES ASK THE SAME FUNCTION, NOT MERELY THE SAME RECORD (2026-11-03, the third review, found
  // by two lenses independently). This check used to require the Doing row to call `avoidingNow()`, which is
  // exactly what it did - and that WAS the defect: the badge had been made supervision-aware and the row had
  // not. In a view-only tab the chart read "⚠ AVOIDING — ROUTED ROUND the tug SARAH B" while the row in the same
  // window read plain green "surveying"; in a taken-over tab the badge went blank while the row stayed red and
  // unlowerable for the rest of the run. Asserted as "neither surface derives an answer of its own", which is
  // the property, rather than "both call X", which a third surface could pass while contradicting them.
  // ⚠ COMMENTS STRIPPED for the "derives its own" half: both of these functions now carry a paragraph that
  // NAMES the function they must not call, and a raw text test reads that paragraph as the call.
  const noCmt = (t) => t.split("\n").filter(l => !/^\s*\/\//.test(l)).join("\n");
  const renderBody = noCmt((H.match(/function renderAvoiding\(\)\{[\s\S]*?\n\}/) || [""])[0]);
  const missionCode = noCmt(missionBody);
  const derives = /avoidingNow\(\)|S\.supervisor/.test(missionCode)
               || /avoidingNow\(\)|S\.supervisor/.test(renderBody);
  check("4i. the frame path calls the renderer, BRACKETED BY onFrame's try and its catch, and the chart badge "
        + "and the Mission card's Doing row ask ONE function - two surfaces, one record, which is the whole "
        + "reason the reader exists - with neither of them deriving an answer of its own",
        () => bigTry > 0 && catchAt > bigTry && renderAt > bigTry && renderAt < catchAt
              && /\bconst av = avoidingShown\(\);/.test(missionCode)
              && /\bconst a = avoidingShown\(\);/.test(renderBody)
              && !derives
              && /av \? "AVOIDING/.test(missionCode),
        () => "onFrame: try@" + bigTry + " renderAvoiding@" + renderAt + " catch@" + catchAt
            + (renderAt > bigTry && renderAt < catchAt ? " (inside)"
               : renderAt < 0 ? " *** THE FRAME PATH DOES NOT CALL IT ***" : " *** OUTSIDE THE TRY ***")
            + "; the Doing row asks avoidingShown: " + /\bconst av = avoidingShown\(\);/.test(missionCode)
            + ", the badge asks it: " + /\bconst a = avoidingShown\(\);/.test(renderBody)
            + ", either derives its own: " + derives);
  avoiding = null; runLineIdx = -1; lineSwing = -1;
}

Date.now = realNow;
console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
})().catch(__crash);
