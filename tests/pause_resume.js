// tests/pause_resume.js - a paused survey leaves a HOLE, and the resume has to close it.
//
// Andy, 2026-09-09: "When a pause happens during survey the pause button should flash until
// pause button selected. Behavior of ASV is to then turn back to the point in the survey
// line where the button push happened, backtrack 12 boat lengths and continue the run at
// low speed or until user changes speed manually."
//
// A pause is not a freeze. The prop stops, the boat is set by wind and stream while it
// waits, and the coverage stops with it. Resuming from wherever it drifted to would butt
// two runs of coverage together at an angle with a gap between them - so the resume goes
// BACK down the line far enough that the boat is settled and the new coverage overlaps the
// old before it reaches the point the operator stopped it at. That is the lead-in's
// argument (tests/survey_lead.js) answered at a different moment.
//
//   node tests/pause_resume.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - 19 mutations against a SIDECAR (ASV_HTML), all 19 killed, 2026-09-09:
//   the resume never backs up at all (the CONTROL)               -> 9, 10, 12
//   the mark is re-read on resume, so it returns the DRIFT       -> 3, 6, 10
//   a mark is kept when she was not on a coverage line           -> 4
//   the direction is assumed a->b rather than read off the route -> 6
//   the backtrack goes FORWARD, into water never surveyed        -> 5, 6, 7, 10, 12
//   the backtrack is not clamped to the line's ends              -> 7
//   twelve lengths becomes a bare 12 m (the hull dropped)        -> 8, 8b, 10, 12
//   ...or is taken from the BEAM rather than the length          -> 8, 10, 12
//   a hull with no length declared is given a made-up one        -> 8b
//   the amendment drops the unflown remainder                    -> 10
//   the drawn route is not updated to match                      -> 10
//   the way back is taken without asking the chart               -> 12
//   the governor re-asserts the role speed over the hold         -> 13
//   the hold is not released by a manual speed change            -> 14
//   the hold survives a stop, into the next run                  -> 15
//   Pause greys out while paused again                           -> 1
//   the flash loses its reduced-motion fallback                  -> 2
//   Start-while-paused skips the backtrack                       -> 16
//   the resume says nothing about what it did                    -> 12, 17
//
// ⚠ THE FIRST SWEEP LEFT THE CONTROL ALIVE, WHICH IS THE ONE THAT MATTERS. Checks 9-12
// grepped resumeRun's source, so switching the whole backtrack off (`const to = null`) left
// every string they look for in place and every one of them green: the feature was disabled
// and the suite said it was fine. They DRIVE the function now and read what it SENT. Two
// more went with it - a fixture where the boat only ever ran a->b could not tell a direction
// that was read from one that was assumed, and an unwrapped call to a mutated markPause
// threw and killed the run before any FAIL line printed.
//
// NOTE: this suite evaluates page code SLOPPY - a direct eval, so the page's function declarations bind into this
// file. The page itself is <script type="module">, which runs STRICT: an assignment to an undeclared name passes
// here and throws in the page. tests/page_strict.js parses the page and its modules as strict modules; that runtime
// difference is not checked anywhere.

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

// ASV_HTML points this at a SIDECAR copy for a mutation run — every read of the page goes
// through it. Three suites in three commits were found reading a fixed path and scoring
// every mutation as SURVIVED; this one is born with the override.
const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");

// THE REAL MODULES, not source text lifted out of the page.
const { distTo, azTo, llEN, fromEN, planeFrame } = require("../static/js/geodesy.js");

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

// ---- the page's world, as the pause/resume path reads it ---------------------------- //
const V = { SPEED_KN: { low: 4.0, survey: 7.0, high: 14.0 },
            VESSEL: { hull: { loa_m: 7.71, beam_m: 2.4 } } };
var mission = { lines: [], waypoints: [], speeds: { transit: "high", turn: "low", survey: "survey" } };
var runLineIdx = -1, curTurn = -1, turnSeg = [], lastRunLine = -1, lineActual = [];
var S = null, asv = null, runRoute = null, pauseMark = null, resumeSlow = false;
var clearance = { slowed: false };
var commandedSpeed = null;
globalThis.window = globalThis;
function fmtDist(m) { return Math.round(m) + " m"; }
// The governor issues real commands. Recorded rather than stubbed to nothing, so the checks
// below can say WHAT was commanded instead of only that something was.
var sent = [];
function cmd(p, b) { sent.push({ p, speed: b && b.speed }); return Promise.resolve({}); }

// The rest of the world resumeRun touches. Recorded where a check needs to read it back,
// inert where it does not — but never absent, because a missing global turns a mutation's
// red check into a dead run.
var planIntent = { why: [] }, notes = [];
function flashNote(m) { notes.push(m); }
function updateMissionCard() {}
function render() {}
globalThis.fetch = () => Promise.resolve({ json: () => Promise.resolve({}) });
// THE REAL keep-out check, not a stub: check 12 is about the console asking the chart, and
// a stub would make it a test of the stub. `nogo` is swapped between an empty model and a
// blocking one to drive both branches.
const { legClear, buildKeepouts } = require("../static/js/chart.js");
var nogo = { ready: true, frame: null, ko: { polys: [], lines: [], points: [], marks: [] }, buffer: 3 };

// eslint-disable-next-line no-eval
eval([
  grabDecl("RESUME_BACK_LENGTHS"),
  // markPause DELEGATES to lineMark, which the clearance guard's hold takes as well
  // (tests/guard_resume.js) - one implementation of "which line, how far along, which way",
  // because a second copy is a copy no mutation has ever been run against.
  grab("resumeBackM"), grab("alongLineM"), grab("lineMark"), grab("markPause"),
  // the DRAWN-LINE numbering every "line N" now goes through (review #18) - the page's own, not a stub
  grab("lineSetKey"),
  grabDecl("LINE_PART_OFFSET_M"), grabDecl("_drawnLines"), grab("linePartContinues"), grab("drawnLines"),
  grab("lineNo"), grab("lineCount"), grab("linePartTxt"),
  grab("resumePointOn"), grab("backtrackClear"),
  grab("roleSpeed"), grab("roleSpeedMS"), grab("linePhase"), grab("currentActivity"),
  // ⚠ THE LAUNCH GRANT REACHES THE CLASSIFIER (R8). currentActivity() returns role "depart"
  // while a grant stands, so `grant` must exist here or speedRole() - which every governor
  // check in this file goes through - is a bare ReferenceError. Null in this world: no berth
  // is latched, so the classifier answers exactly as it always did and these checks are the
  // evidence that the OPEN regime is unchanged.
  "let grant = null;",
  grabDecl("SPEED_RESEND_MS"), grabDecl("speedWant"), grab("commandSpeed"),
  // review #14: the guard and the governor act only in the SUPERVISING tab; this world is that tab. A view-only one is tests/supervisor_page.js's subject.
  "const supervising = () => true;",
  // speedGovernor also reads the JUNCTION corner set since 2026-09-19
  // (tests/corner_slow.js): an empty one here, so this world governs exactly as it did.
  "let cornerSlow = new Set();",
  "let cornerSlowFor = -1;",
  grab("speedRole"), grab("speedGovernor"), grab("resumeRun"),
  "function __backLengths(){ return RESUME_BACK_LENGTHS; }",
  "function __setPauseMark(m){ pauseMark = m; }",
  "function __resumeSlow(){ return resumeSlow; }",
  "function __setResumeSlow(v){ resumeSlow = v; }",
].join("\n"));

// ⚠ EVERY CALL INTO THE SUBJECT IS WRAPPED. A mutation that removes a guard makes the real
// function THROW, and an unguarded call here would kill the run before a single FAIL line
// printed — which the mutation runner scores as SURVIVED, strictly worse than the check not
// existing. Removing markPause's `!L` guard did exactly that.
function tryMark() { try { markPause(); return null; } catch (e) { return "RAISED " + e.message; } }

// A single 400 m line running due EAST, and a second running due WEST beside it, so the
// suite can drive a boat that is going the "wrong" way along a->b.
const ref = planeFrame({ lat: 43.07, lon: -70.76 });
const ll = (e, n) => fromEN(e, n, ref);
const LINE_E = { a: ll(0, 0), b: ll(400, 0) };          // a->b is east
const LINE_W = { a: ll(400, 60), b: ll(0, 60) };        // a->b is WEST
const along = (L, p) => alongLineM(L, p);

console.log("A paused survey leaves a hole, and the resume has to close it:");

// ── 1-2. THE BUTTON SAYS SO, AND KEEPS SAYING SO ───────────────────────────────────
// A held run is a boat sitting in the tide with a hole growing in its coverage. The one
// control that ends it flashes until somebody answers it, and it is the control that
// STARTED the pause — the operator should not have to know that Start was the way back.
{
  const cmdState = grab("applyCmdState");
  check("1. Pause stays live while paused, becomes RESUME, and flashes",
        () => /const held = run==="paused";/.test(cmdState)
              && /\$\("#b_pause"\)\.disabled = !\(run==="running" \|\| held\);/.test(cmdState)
              && /textContent = held \? "Resume" : "Pause"/.test(cmdState)
              && /classList\.toggle\("flash", held\)/.test(cmdState),
        "it used to grey out the moment it worked, leaving Start as the only way back");
  // ⚠ A FLASH IS A SAFETY READOUT, NOT DECORATION, so it has to be legible to somebody who
  // cannot take a blinking light. Reduced motion gets the same state as a steady amber.
  check("2. ... and the flash has a still fallback under prefers-reduced-motion",
        () => /@keyframes cbtnFlash/.test(H)
              && /prefers-reduced-motion: reduce[\s\S]{0,160}?\.cbtn\.flash\{animation:none/.test(H),
        "the state must survive the animation being switched off");
  // AN UPLOAD NEVER CHANGES WHAT THE BOAT IS DOING (review #3). The resume above pauses, uploads
  // and starts - which only works because a plan uploaded to a running link is STAGED - and the
  // operator's own Upload to a station-keeping boat needs Start to stay live for it.
  check("1b. Start stays live for a STAGED plan while the run reads running, and Upload is off while under way",
        () => /const underWay = run==="running" && !\(s\.status\|\|\{\}\)\.holding;/.test(cmdState)
              // ⚠ GAINED A FOURTH TERM 2026-09-19, and this is EXTENDED rather than loosened:
              // all four must be present or this reds. Upload is awaited before it POSTs now
              // (it measures where the hull goes at every corner first), so the button has to
              // be dead for that window - otherwise Start in the gap runs the PREVIOUS staged
              // plan while the operator believes the new one went up. See tests/corner_slow.js 21.
              && /\$\("#b_upload"\)\.disabled = !armed \|\| estop \|\| underWay \|\| uploadBusy;/.test(cmdState)
              && /\$\("#b_start"\)\.disabled = !armed \|\| estop \|\| !s\.plan_uploaded \|\| \(run==="running" && !s\.plan_staged\);/.test(cmdState),
        "without the staged clause Start is dead after a staged upload; without underWay Upload offers a click the server refuses");
}

// ── 3-4. THE MARK IS TAKEN AT THE PRESS ────────────────────────────────────────────
{
  mission = { lines: [LINE_E], waypoints: [LINE_E.a, LINE_E.b],
              speeds: { transit: "high", turn: "low", survey: "survey" } };
  S = { behavior: "survey", run: "running", status: {} };
  runLineIdx = 0; runRoute = [LINE_E.a, LINE_E.b]; window._wpIndex = 1;
  asv = ll(150, 0);
  const raised1 = tryMark();
  const atPress = pauseMark && { ...pauseMark };
  asv = ll(150, 25);                       // ...and now the tide has set her 25 m off
  check("3. the mark is the position at the PRESS, not wherever she drifted to",
        () => !!atPress && Math.abs(atPress.along - 150) < 0.5
              && distTo(atPress.at, ll(150, 0)) < 0.5,
        () => "marked " + atPress.along.toFixed(1) + " m along the line; the boat is now "
              + distTo({ lat: asv.lat, lon: asv.lon }, atPress.at).toFixed(0)
              + " m from that mark. Re-reading the position on resume would return the "
              + "DRIFT, and back the boat up from the wrong place");

  runLineIdx = -1; asv = ll(150, 0); const raised2 = tryMark();
  const offLine = pauseMark;
  runLineIdx = 0; S = { behavior: "goto", run: "running", status: {} };
  const raised3 = tryMark();
  const offSurvey = pauseMark;
  check("4. ... and there is NO mark when she was not on a coverage line",
        () => offLine === null && offSurvey === null && !raised2 && !raised3,
        "mid-turn, on the approach, or on a Go-To there is no line to back down, and "
        + "inventing one would drive the boat along a leg it was never running");
}

// ── 5-7. TWELVE BOAT LENGTHS BACK, THE WAY SHE CAME ────────────────────────────────
{
  const back = 12 * 7.71;                                   // this hull, 92.5 m
  // Running EAST (a->b), paused 150 m along: back down the line is WEST, to 57.5 m.
  const east = resumePointOn(LINE_E, { along: 150, fwd: 1 }, back);
  check("5. she rejoins the line twelve boat lengths BEHIND the pause point",
        () => Math.abs(along(LINE_E, east) - (150 - back)) < 0.5,
        () => "paused 150.0 m along, rejoins at " + along(LINE_E, east).toFixed(1)
              + " m — " + back.toFixed(1) + " m back over water she has already surveyed, "
              + "so the new coverage overlaps the old before it reaches the hole");

  // ⚠ AND THE DIRECTION IS READ OFF THE ROUTE, NOT ASSUMED. A plan edited in WPT mode need
  // not run a->b, and backing the WRONG way would drive her into water never surveyed and
  // lay the overlap on the far side of the gap.
  mission = { lines: [LINE_W], waypoints: [LINE_W.a, LINE_W.b],
              speeds: { transit: "high", turn: "low", survey: "survey" } };
  S = { behavior: "survey", run: "running", status: {} };
  runLineIdx = 0; runRoute = [LINE_W.a, LINE_W.b]; window._wpIndex = 1;
  asv = ll(250, 60);                                        // 150 m along a WEST-running line
  tryMark();
  const west = resumePointOn(LINE_W, pauseMark, back);
  const fwdW = pauseMark.fwd;

  // ⚠ AND THE CASE THAT ACTUALLY SEPARATES "READ" FROM "ASSUMED": a boat running b→a. On
  // LINE_W above she runs a→b and fwd is +1, which is also what an ASSUMED +1 gives — so
  // that fixture alone cannot tell the two apart, and a mutation hard-coding fwd = 1
  // survived it. Here the route runs her b→a, where the correct answer is −1.
  mission = { lines: [LINE_E], waypoints: [LINE_E.b, LINE_E.a],
              speeds: { transit: "high", turn: "low", survey: "survey" } };
  runLineIdx = 0; runRoute = [LINE_E.b, LINE_E.a]; window._wpIndex = 1;   // steering for a
  asv = ll(150, 0);
  tryMark();
  const fwdRev = pauseMark && pauseMark.fwd;
  const rev = resumePointOn(LINE_E, pauseMark, back);
  check("6. the way she came is read off the route, not assumed — including b→a",
        () => fwdW === 1 && Math.abs(along(LINE_W, west) - (150 - back)) < 0.5
              && fwdRev === -1 && Math.abs(along(LINE_E, rev) - (150 + back)) < 0.5,
        () => "a→b line: fwd " + fwdW + ", rejoins at " + along(LINE_W, west).toFixed(1)
              + " m of 150.0  |  the SAME line flown b→a: fwd " + fwdRev + ", rejoins at "
              + along(LINE_E, rev).toFixed(1) + " m — further ALONG in a-to-b terms, which "
              + "on the water is back the way she came. Assuming +1 sends her forward into "
              + "water never surveyed and lays the overlap on the far side of the hole");

  const early = resumePointOn(LINE_E, { along: 20, fwd: 1 }, back);
  check("7. ... and backing past the start of the run is clamped to the run",
        () => Math.abs(along(LINE_E, early)) < 0.01,
        () => "paused 20 m into the line, twelve lengths back is "
              + (20 - back).toFixed(1) + " m — off the end of it, where the water is the "
              + "turn she has just flown. Clamped to " + along(LINE_E, early).toFixed(2) + " m");
}

// ── 8. THE DISTANCE BELONGS TO THE HULL ────────────────────────────────────────────
{
  check("8. twelve BOAT LENGTHS, from the vessel profile, not a constant in the page",
        () => __backLengths() === 12 && Math.abs(resumeBackM() - 12 * 7.71) < 0.01
              && /V\.VESSEL && V\.VESSEL\.hull && V\.VESSEL\.hull\.loa_m/.test(grab("resumeBackM")),
        () => "12 x 7.71 m = " + resumeBackM().toFixed(1) + " m on this hull; the 1.9 m "
              + "launch would back up 22.8 m and the 4 m example 48.0 m. A bare 12 m would "
              + "be a fifth of the overlap on the big hull and ten times too much on the small");
  const savedV = V.VESSEL; V.VESSEL = null;
  const none = resumeBackM();
  V.VESSEL = savedV;
  check("8b. ... and a vessel with no length declared gets no backtrack, not a guess",
        () => none === 0,
        "0 m, so resumeRun skips the amendment entirely rather than backing up by a "
        + "made-up distance");
}

// ── 9-12. THE AMENDMENT, DRIVEN ────────────────────────────────────────────────────
// ⚠ DRIVEN, BECAUSE READING resumeRun's TEXT PROVED NOTHING. The first cut of these four
// grepped the function body, and a control mutation that made the backtrack unreachable
// (`const to = null`) left every one of those strings in place and every check green. The
// feature was switched off and the suite said it was fine. So: run the real thing, on a
// real line, and read what it SENT.
// ⚠ THE KEEP-OUT MODEL IS ASSIGNED TO THE MODULE BINDING, NOT TO globalThis. `var nogo` at
// the top of a CommonJS module is NOT a property of the global object, and the eval'd
// resumeRun closes over the module binding — so an override written to globalThis silently
// did nothing and check 12 ran against clear water while claiming to test a foul way back.
async function drive(ko) {
  mission = { lines: [LINE_E], waypoints: [LINE_E.a, LINE_E.b],
              speeds: { transit: "high", turn: "low", survey: "survey" } };
  S = { behavior: "survey", run: "paused", armed: true, estop: false, status: {} };
  runLineIdx = 0;
  runRoute = [LINE_E.a, LINE_E.b, ll(400, 60), ll(0, 60)];   // line 1, then the next line
  window._wpIndex = 1;                                        // steering for LINE_E.b
  asv = ll(150, 0);
  nogo = { ready: true, frame: ref, ko: ko || { polys: [], lines: [], points: [], marks: [] }, buffer: 3 };
  tryMark();
  sent = []; notes = []; planIntent = { why: [] }; __setResumeSlow(false);
  await resumeRun();
  const amend = sent.find(x => x.p === "/api/cmd/amend");
  return { sent, amend, route: globalThis.__lastRoute, notes };
}
// The recorder has to keep the amendment's ROUTE, which the plain cmd() stub drops.
function cmd(p, b) { sent.push({ p, speed: b && b.speed });
                     if (p === "/api/cmd/amend") globalThis.__lastRoute = b && b.route;
                     // 12c: a command the console must NOT assume worked (review #6)
                     if (p === globalThis.__failPath) return Promise.resolve({ ok: false, error: "simulated refusal" });
                     return Promise.resolve({}); }

(async () => {
  const back = 12 * 7.71;
  const r = await drive();
  const paths = r.sent.map(x => x.p);
  check("9. the resume AMENDS the running plan rather than re-uploading it",
        () => paths.includes("/api/cmd/amend") && !paths.includes("/api/cmd/upload")
              && paths.includes("/api/cmd/start"),
        () => "sent " + JSON.stringify(paths) + " — an upload resets the waypoint index to "
              + "zero and would re-run the survey from line 1; an amendment keeps the flown "
              + "prefix and the run");

  const rte = r.route || [];
  check("10. ... with the new point first and the whole unflown remainder behind it",
        () => rte.length === 4 && Math.abs(along(LINE_E, rte[0]) - (150 - back)) < 0.5
              && distTo(rte[1], LINE_E.b) < 0.5 && runRoute.length === 5,
        () => "amended route is " + rte.length + " waypoints: rejoin at "
              + (rte[0] ? along(LINE_E, rte[0]).toFixed(1) : "--") + " m along, then the "
              + (rte.length - 1) + " she had left to fly. The drawn route went to "
              + runRoute.length + ", so the chart shows the track she is on");

  // ⚠ ORDER. amend_plan needs a RUNNING plan, and pause leaves _running true while stopping
  // the prop — so the remainder can be rewritten before anything moves. Releasing the run
  // first would give her a frame or more of the OLD plan: away toward the line end she was
  // heading for, from wherever the tide had put her.
  check("11. amend, then the speed, then start — she never makes way on the old plan",
        () => paths.indexOf("/api/cmd/amend") < paths.indexOf("/api/cmd/speed")
              && paths.indexOf("/api/cmd/speed") < paths.indexOf("/api/cmd/start")
              && r.sent.find(x => x.p === "/api/cmd/speed").speed === "low",
        () => JSON.stringify(paths) + ", the speed being '"
              + r.sent.find(x => x.p === "/api/cmd/speed").speed + "'");

  // A wall right across the water she would back through. Real keep-outs, real legClear.
  const ring = pts => [pts.map(([e, n]) => { const p = ll(e, n); return [p.lon, p.lat]; })];
  const wall = buildKeepouts(ref, { land: true, depth: true, haz: true, area: false },
    { min: 2, max: 0 },
    [{ role: "land", cls: "Land_Area", props: {}, geometry: { type: "Polygon",
       coordinates: ring([[80, -30], [110, -30], [110, 30], [80, 30], [80, -30]]) } }]);
  const foul = await drive(wall);
  const foulPaths = foul.sent.map(x => x.p);
  check("12. a foul way back gives up the BACKTRACK, and never the resume",
        () => !foulPaths.includes("/api/cmd/amend") && foulPaths.includes("/api/cmd/start")
              && foul.notes.join(" ").includes("WITHOUT the backtrack"),
        () => "with a keep-out across the way back she sent " + JSON.stringify(foulPaths)
              + " and said \"" + (foul.notes[0] || "") + "\" — the run resumes either way; "
              + "it is the backtrack that is given up");

  // ...and the hold is set whichever branch was taken.
  check("12b. ... and the low-speed hold is set either way",
        () => __resumeSlow() === true
              && foul.sent.some(x => x.p === "/api/cmd/speed" && x.speed === "low"),
        "a resume is cautious whether or not there was a line to back down");
  __setResumeSlow(false);

  // ── 12c-12e. EACH STEP HAS TO LAND BEFORE THE NEXT GOES (review #6) ──────────────────────
  // resumeRun awaited LOW and then sent Start whatever LOW had answered - so a refused or lost
  // speed command resumed at the old speed while the note said LOW, and resumeSlow kept the
  // governor from ever correcting it. And cmd() answered a network error with {}, which every
  // `r.error` check in the page read as success.
  //
  // TEETH, sidecar ASV_HTML, 3 mutations, 3 killed:
  //   resumeRun ignores a refused LOW                  -> 12c
  //   cmd() answers a network error with {} again      -> 12d
  //   cmd() drops ok:false on an HTTP refusal          -> 12e
  globalThis.__failPath = "/api/cmd/speed";
  const refusedLow = await drive();
  globalThis.__failPath = null;
  check("12c. a resume whose LOW is refused does NOT start, keeps no low-speed hold, and says so",
        () => !refusedLow.sent.some(x => x.p === "/api/cmd/start") && __resumeSlow() === false
              && /Resume stopped/.test(refusedLow.notes.join(" ")),
        () => "sent " + JSON.stringify(refusedLow.sent.map(x => x.p)) + "; note: "
              + (refusedLow.notes.find(n => /Resume/.test(n)) || "none"));
  __setResumeSlow(false);
  {
    const fnotes = [];
    const flashNote = (m) => fnotes.push(m);
    // Since review #22 cmd records each command in the history and flashes its own refusal through showNote. The
    // history is tests/action_history.js's to prove; here it only has to exist, and the label is the page's own.
    const showNote = (m) => fnotes.push(m), recordAction = () => {};
    // review #14: cmd() asks whether this tab supervises. This world is the supervising tab; the view-only refusal
    // belongs to tests/supervisor_page.js.
    const supervising = () => true;
    const SUPERVISOR_ANY = ["/api/cmd/stop", "/api/cmd/pause", "/api/cmd/estop"];
    const CLIENT_ID = "test-tab";      // cmd() sends the tab's own name; without it every call reads as a throw
    // eslint-disable-next-line no-eval
    const cmdLabel = eval("(" + grab("cmdLabel") + ")");
    let fetch = () => Promise.reject(new Error("socket hang up"));
    // eslint-disable-next-line no-eval
    const realCmd = eval("(" + grab("cmd") + ")");
    const offline = await realCmd("/api/cmd/speed", { speed: "low" });
    fetch = () => Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "Access is denied" }) });
    const refused = await realCmd("/api/cmd/speed", { speed: "low" });
    check("12d. cmd() answers a network error with an explicit failure, not an empty object",
          () => offline.ok === false && /network/.test(offline.error || ""),
          () => JSON.stringify(offline));
    check("12e. ... and an HTTP refusal carries ok:false with the server's own words",
          () => refused.ok === false && refused.error === "Access is denied",
          () => JSON.stringify(refused) + " notes " + JSON.stringify(fnotes));
  }

  // ── 1c-1g. UPLOAD WITHOUT THE CHART MODEL ASKS FIRST, AND SAYS SO AFTER (review #4) ─────
  // With the keep-out model not ready - still loading, never loaded, or no keep-outs read for
  // the area - Upload used to send the raw survey waypoints with no routed approach and no
  // detours, and no word to the operator, while the clearance guard (which reads the same
  // model) stood down. DRIVEN: the page's own doUpload and guiConfirm, the world stubbed.
  // Async, so it lives in the driven block rather than in finish().
  //
  // TEETH, sidecar ASV_HTML, 5 mutations, 5 killed:
  //   the no-fix refusal removed                        -> 1c
  //   the model-not-ready branch goes back to silent    -> 1d, 1e
  //   the question loses {always: true}                 -> 1d
  //   the banner removed                                -> 1e
  //   guiConfirm ignores `always` again                 -> 1g
  {
    const calls = [], unotes = [], banners = [];
    let S = { mode: "sim", run: "idle", status: {} }, asv = { lat: 43.07, lon: -70.71 };
    let mission = { waypoints: [{ lat: 43.08, lon: -70.71 }, { lat: 43.09, lon: -70.71 }] };
    let nogo = { ready: false, busy: false, band: null, note: "nogo not loaded" };
    let runRoute = null, planIntent = null, runUnsafe = [], answer = false, asked = null;
    const cmd = (p, b) => { calls.push({ p, b }); return Promise.resolve({ ok: true, state: {} }); };
    const flashNote = (m) => unotes.push(m), showBanner = (m) => banners.push(m);
    const render = () => {}, setViolations = () => {}, clearViolation = () => {};
    // doUpload measures where the HULL goes at every corner of the routed plan since
    // 2026-09-19 (tests/corner_slow.js), so the function's new dependencies have to exist
    // in this scope like the rest of its world. The REAL cornerSlowPlan is used rather
    // than a stub: on these two-point fixtures it returns an empty set before it touches
    // the frame or the keep-out model, so 1j's 'an ordinary upload is SILENT' still means
    // what it says instead of meaning 'the stub said nothing'.
    const { cornerSlowPlan } = require("../static/js/turns.js");
    const SPEED_ROLES = ["transit", "turn", "survey"];
    // ⚠ ONE vessel model, carrying what BOTH halves of this world read: the hull for
    // minTurnRadiusM and berthNeedM (the launch grant), and all three speed keys for
    // cornerSlowPlan (which walks the routed plan at the survey speed against the low one).
    // The merge that brought the grant in declared V TWICE - once from each side, in two
    // places neither side had touched - and the file stopped parsing. A clean textual merge
    // is not a working one.
    const V = { VESSEL: { hull: { loa_m: 1.9 } },
                SPEED_KN: { low: 1.5, survey: 3.0, high: 6.0 } };
    const roleSpeed = () => "survey";
    let cornerSlow = new Set(), cornerUnanswered = [], cornerPlanKey = "survey";
    // doUpload disables the Upload button for as long as it is measuring corners and
    // restores it in a finally, so the world needs the command-state applier. Recorded
    // rather than stubbed away: the sequence is the property worth being able to see.
    let uploadBusy = false; const busySeq = [];
    const applyCmdState = () => busySeq.push(uploadBusy);
    const legReasons = () => [], kindsSummary = () => "", holdClearAt = () => 12;
    const setPlanIntent = (kind) => { planIntent = { kind, why: [] }; };
    let detour = false;                  // 1h: routing adds a waypoint, so the ROUTE crosses the limit, not the plan
    const routePlan = (start, wps) => ({ route: wps.map((p) => ({ lat: p.lat, lon: p.lon }))
                                                   .concat(detour ? [{ lat: 43.085, lon: -70.70 }] : []),
                                          unroutable: [], degraded: !nogo.ready });
    const guiConfirm = (title, msg, opts) => { asked = { title, msg, opts }; return Promise.resolve(answer); };
    // ⚠ THE LAUNCH GRANT (2026-09-19). doUpload now certifies the departure before it sends
    // - see certifyDeparture and DEPARTURE_PARADIGM.md R5-R7. In THIS world no berth is ever
    // latched, so certifyDeparture returns {none:true} at its first line and the upload path is
    // unchanged; but the SYMBOL has to exist, or every check here fails with the upload throwing
    // into doUpload's own catch as "Upload failed", which reads as a routing bug and is not one.
    let grant = null, grantMemo = null;   // S is already declared in this world
    if(!S) S = { berth: null, status: {} };
    const groundVel = () => null, minTurnRadiusM = () => 1.03;
    const { corridorGate, corridorHalfM, grantClockMs, grantedFeatures, isBerth,
            berthNeedM } = require("../static/js/berth.js");
    const { snapCapM } = require("../static/js/hold.js");
    // eslint-disable-next-line no-eval
    const berthAt = eval("(" + grab("berthAt") + ")");
    // eslint-disable-next-line no-eval
    const certifyDeparture = eval("(" + grab("certifyDeparture") + ")");
    // eslint-disable-next-line no-eval
    const routeTooLong = eval("(" + grab("routeTooLong") + ")");
    // eslint-disable-next-line no-eval
    const stagedNote = eval("(" + grab("stagedNote") + ")");
    // eslint-disable-next-line no-eval
    const doUpload = eval("(" + grab("doUpload") + ")");
    const up = async (setup) => { calls.length = 0; unotes.length = 0; banners.length = 0; asked = null;
                                  runRoute = null; setup(); await doUpload(); await Promise.resolve(); };

    await up(() => { asv = null; nogo = { ready: true, band: "enc_harbour" }; });
    check("1c. Upload with no position fix is refused in words, and nothing is sent",
          () => calls.length === 0 && /No position fix/.test(unotes.join(" ")), () => JSON.stringify(unotes));
    asv = { lat: 43.07, lon: -70.71 };
    await up(() => { nogo = { ready: false, busy: true, band: null }; answer = false; });
    check("1d. with the chart model still loading, Upload ASKS - in the simulator too - and a no sends nothing",
          () => !!asked && !!asked.opts && asked.opts.always === true && /still loading/.test(asked.msg)
                && calls.length === 0,
          () => "asked=" + !!asked + " always=" + (asked && asked.opts && asked.opts.always) + " sent=" + calls.length);
    await up(() => { nogo = { ready: false, busy: false, band: null, note: "extract failed" }; answer = true; });
    check("1e. ... and a yes sends it UNROUTED, with a banner that stays up and says what was not checked",
          () => calls.length === 1 && calls[0].p === "/api/cmd/upload" && !(calls[0].b && calls[0].b.route)
                && /UNROUTED UPLOAD/.test(banners.join(" ")) && /not loaded/.test(banners.join(" ")),
          () => JSON.stringify(calls) + "  banner: " + (banners[0] || "").slice(0, 70));
    await up(() => { nogo = { ready: true, busy: false, band: "enc_harbour" }; answer = false; });
    check("1f. a loaded model routes as it always did - no question asked",
          () => asked === null && calls.length === 1 && !!calls[0].b && Array.isArray(calls[0].b.route),
          () => "asked=" + !!asked + " " + JSON.stringify(calls.map((c) => c.p)));

    // 1h-1j. A PLAN OVER THE CONSOLE'S WAYPOINT LIMIT IS NEVER SENT (review #9). The server kept the
    // first 1000 waypoints and dropped the rest with a 200; it refuses the whole route now and
    // publishes `route_max_wpts`, which doUpload checks before it draws or sends anything.
    // TEETH, sidecar ASV_HTML, 5 mutations, 5 killed:
    //   routeTooLong never blocks                          -> 1h, 1i
    //   the ROUTED check removed (the plan fits, its route does not) -> 1h
    //   the saved-plan check removed (the unrouted branch asks and sends) -> 1i
    //   the plan drawn as the run before the check         -> 1h
    //   a plan AT the limit blocked (< for <=)             -> 1h, 1j
    await up(() => { nogo = { ready: true, busy: false, band: "enc_harbour" }; S.route_max_wpts = 2; detour = true; });
    check("1h. a plan whose ROUTE is over the console's waypoint limit is not sent and not drawn as the run - "
          + "blocked in words, with both numbers",
          () => calls.length === 0 && runRoute === null && /UPLOAD BLOCKED/.test(banners.join(" "))
                && /3 waypoints/.test(banners.join(" ")) && /at most 2\b/.test(banners.join(" ")),
          () => "sent=" + calls.length + " runRoute=" + JSON.stringify(runRoute) + " banner: " + (banners[0] || "none"));
    await up(() => { nogo = { ready: false, busy: false, band: null, note: "extract failed" }; answer = true;
                     S.route_max_wpts = 1; detour = false; });
    check("1i. ... and the unrouted upload of a saved plan over it is blocked before it is even asked about",
          () => calls.length === 0 && asked === null && /UPLOAD BLOCKED/.test(banners.join(" ")),
          () => "sent=" + calls.length + " asked=" + !!asked + " banner: " + (banners[0] || "none"));
    await up(() => { nogo = { ready: true, busy: false, band: "enc_harbour" }; S.route_max_wpts = 2; detour = false; });
    check("1j. ... and a route AT the limit goes as it always did",
          () => calls.length === 1 && !!calls[0].b && Array.isArray(calls[0].b.route) && calls[0].b.route.length === 2
                && banners.length === 0,
          () => "sent=" + JSON.stringify(calls.map((c) => [c.p, c.b && c.b.route && c.b.route.length])));
    delete S.route_max_wpts;
  }
  {
    const els = { "#confirm": { style: {} }, "#confirmTtl": {}, "#confirmMsg": {}, "#confirmYes": {}, "#confirmNo": {} };
    const $ = (sel) => els[sel];
    let S = { mode: "sim" };
    // eslint-disable-next-line no-eval
    const guiConfirm = eval("(" + grab("guiConfirm") + ")");
    const plain = await guiConfirm("t", "m");
    const pending = guiConfirm("t", "m", { always: true });
    const shown = els["#confirm"].style.display === "flex";
    if (els["#confirmNo"].onclick) els["#confirmNo"].onclick();
    const said = await Promise.race([pending, new Promise((r) => setTimeout(() => r("never answered"), 500))]);
    check("1g. guiConfirm's `always` shows the dialog in the simulator, where it otherwise answers yes by itself",
          () => plain === true && shown && said === false,
          () => "plain=" + plain + " shown=" + shown + " answered=" + said);
  }
  finish();
})();

// ⚠ EVERYTHING BELOW RUNS AFTER THE DRIVEN BLOCK, WHICH IS ASYNC. A hoisted declaration,
// called from that block's tail — because on the first cut these checks and the summary ran
// synchronously while the driven ones were still pending, so the suite printed "all checks
// passed (14)" without 9 to 12 having happened at all. A verdict reached before the checks
// is not a verdict.
function finish(){
// ── 13-15. LOW UNTIL THE OPERATOR SAYS OTHERWISE ───────────────────────────────────
{
  mission = { lines: [LINE_E], waypoints: [LINE_E.a, LINE_E.b],
              speeds: { transit: "high", turn: "low", survey: "survey" } };
  S = { run: "running", armed: true, estop: false, behavior: "survey",
        status: { holding: false, drifting: false } };
  runLineIdx = 0; curTurn = -1; asv = ll(150, 0); clearance.slowed = false;
  commandedSpeed = null; resumeSlow = false;
  sent = [];
  const governed = speedGovernor();
  const sentFree = sent.filter(x => x.p === "/api/cmd/speed").map(x => x.speed);
  resumeSlow = true; commandedSpeed = null; sent = [];
  const held = speedGovernor();
  const sentHeld = sent.filter(x => x.p === "/api/cmd/speed").map(x => x.speed);
  check("13. the governor stands down while the post-pause hold is set",
        () => governed !== null && held === null && sentFree.length === 1 && sentHeld.length === 0,
        () => "ordinary frame → the governor commands '" + governed + "' and sends "
              + JSON.stringify(sentFree) + "; with the hold set → " + held + " and sends "
              + JSON.stringify(sentHeld) + ". Without this it would re-assert the role's "
              + "speed the frame after she rejoins her line, undoing the instruction in the "
              + "act of carrying it out");

  // "or until user changes speed manually" — the ONLY way it ends.
  const setRole = grab("setRoleSpeed");
  check("14. ... and a manual speed change is what releases it",
        () => /if\(resumeSlow\)\{ resumeSlow = false;/.test(setRole),
        "touching any of the three role selectors is the operator taking the speed back — "
        + "including selecting 'low' itself, which is them owning the choice");
  check("15. ... and a stop or a fresh start does not carry it into the next run",
        () => /pauseMark = null; resumeSlow = false; commandedSpeed = null;\r?\n?\s*cmd\("\/api\/cmd\/stop"\)/.test(H)
              && /pauseMark = null; resumeSlow = false; commandedSpeed = null; speedWant = null;\s*\/\/ a FRESH run/.test(H),
        "the hold belongs to the run it was given about");
  resumeSlow = false;
}

// ── 16-17. RESUME IS RESUME, WHICHEVER CONTROL DOES IT ─────────────────────────────
{
  check("16. Start while paused goes through the same resume, backtrack and all",
        () => /if\(S && S\.run === "paused"\) return resumeRun\(\);/.test(grab("resumeRun") ? H : H)
              && (H.match(/if\(S && S\.run === "paused"\) return resumeRun\(\);/g) || []).length === 2,
        () => (H.match(/if\(S && S\.run === "paused"\) return resumeRun\(\);/g) || []).length
              + " control(s) route a paused run through resumeRun — Start and Pause. Start "
              + "has always been enabled while paused, so leaving it on the plain command "
              + "would make the backtrack depend on which button the operator reached for");
  // NEVER SILENTLY: the operator is owed what actually happened, because "backed up 92 m"
  // and "resumed where she lay" are different surveys.
  const rr = grab("resumeRun");
  check("17. what the resume actually did is said out loud and logged",
        () => /flashNote\("Resumed at LOW/.test(rr) && /planIntent\.why\.push/.test(rr)
              && /kind:"resume"/.test(rr) && /backed_m:/.test(rr),
        "the banner, the Intent card's why-list, and the session log all carry it");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
}
