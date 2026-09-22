// tests/nogo_readout.js - the Nogo row must name its STATE, not just a count.
//
// Andy's report: the Nogo entry "always shows ...loading". It did, and it was not a
// wording problem - it was a repaint bug hiding behind a vague word.
//
// `refreshNogo()` ended its SUCCESS path with `rebuildNogo(); nogo.busy=false;`, and
// rebuildNogo() finishes by calling updateNogoUI(). So the row was painted while `busy`
// was still true, printed "loading…", and then nothing repainted it - the one path that
// ends in a working model was the one path that never showed it. Every behaviour routed
// correctly off a model the card insisted was still loading. That is the worst kind of
// stale readout: it reports NOT READY about something that is.
//
// The wording was the second half. "loading…" says nothing about what is being loaded or
// how long it has been at it, and a bare zone count cannot distinguish the two opposite
// facts that both look like zero:
//
//   clear water    the chart was read and there is genuinely nothing to avoid
//   no chart       there is no model at all, so every route is UNVERIFIED and direct
//
// Same lesson the AIS table already learned about its link status: name the state.
//
//   node tests/nogo_readout.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// Every state is DERIVED from values that already exist - `busy`, `nogo.band` (set only
// by a successful extract), `nogo.note`, and the keep-out counts. No new state field was
// added, so nothing can drift out of step with the model the behaviours route against.
//
// TEETH (verified by mutation, not assumed): RESTORE THE ORIGINAL BUG - rebuild the model
// before clearing `busy` - and 10 and 11 fail. Key the "have chart data" test off
// `nogo.ready` instead of `nogo.band` and 4 and 6 fail (an empty-but-read area claims to
// have no chart). Drop the busy branch and 1, 2 and 12 fail. Drop the `nogo.since` elapsed
// counter and 2 fails. Fold the no-chart state back into the clear-water wording and 5, 13
// and 14 fail. Drop the article strip from the kind tally and 7 fails. Return the raw note
// untruncated and 6 fails. Leave the thrown-extract path without a note and 14 fails.
//
// NOTE: this suite evaluates page code SLOPPY - a direct eval, so the page's function declarations bind into this
// file. The page itself is <script type="module">, which runs STRICT: an assignment to an undeclared name passes
// here and throws in the page. tests/page_strict.js parses the page and its modules as strict modules; that runtime
// difference is not checked anywhere.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
// check() turns a throw inside its own thunk into a failed check. Scenario SETUP is not
// inside one - building a world, eval-ing page code, awaiting a fetch - and a throw there
// would kill the process before a single FAIL line printed. "No FAIL lines" and "the
// process died" are indistinguishable to anything reading stdout, so a mutation that
// crashes this suite would score as SURVIVED. Report it instead, in the normal format.
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

// The vessel-derived parameter block moved to static/js/state.js (2026-08-09). The page
// functions eval'd below read V.NOGO_MIN_DEPTH_M / V.WRECK_RADIUS_M / ..., so the suite
// needs the SAME object the page mutates - and gets it, rather than a stub, so a check
// that leans on a vessel default is reading the real one.
const { V } = require("../static/js/state.js");

// ASV_HTML points this at a SIDECAR copy for a mutation run - without it a sweep writes
// its mutants to a file this suite never reads and scores every one as SURVIVED (audited
// 2026-09-21: 21 of the 53 suites reading this page had no override).
const H = fs.readFileSync(process.env.ASV_HTML
                || path.join(__dirname, "..", "static", "asv.html"), "utf8");

function grab(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  // keep an `async` prefix: refreshNogo awaits the chart fetch, and a body torn off its
  // `async` keyword is a SyntaxError rather than a quiet wrong answer - but only because
  // someone checked. Grab the modifier with the function.
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}

V.NOGO_MIN_DEPTH_M = 2.3;             // the DriX: 2.0 m draft + 0.3 m under-keel clearance
// The page reads the SHARED nogo object now, so scenarios are written into it rather
// than rebinding a local. Keys are cleared first: Object.assign cannot remove a field,
// and a model that omits one would otherwise inherit the previous scenario's value.
const { nogo, sea } = require("../static/js/state.js");

// THE REAL MODULE, not its source text lifted out of the page. A renamed or
// deleted export now fails HERE, at load, instead of quietly resolving to a stale
// copy - and the checks below exercise the function that actually ships.
// nogoDR comes from the same module, and is imported for the same reason: the readout prints
// the EFFECTIVE depth floor now (the deeper of the hull's own and the operator's Min depth), so
// a stub here would let this suite stay green while the row printed a floor the keep-out model
// had not been built at - which is the exact fault that change was made to fix.
const { nogoKindCounts, nogoDR } = require("../static/js/chart.js");
// rebuildNogo() builds a FRAME now (Andy, 2026-08-20: "use frame"), so planeFrame has
// to resolve in the eval'd scope below. A free variable there is a RUNTIME error inside
// the function, never a load error -- which is why this suite went red at "it shows the
// model that was actually built" rather than anywhere near the real cause.
const { planeFrame } = require("../static/js/geodesy.js");
// ⚠ THE READOUT NOW ALSO SPEAKS FOR THE CHART-IMAGE SCAN, so `chartInk` has to resolve in
// the eval'd scope for the same reason planeFrame does: a free variable here is a RUNTIME
// error INSIDE the function, so the suite goes red somewhere far from the cause. Default it
// to the never-scanned state, which is what a fresh page has.
let chartInk = { key: null, lines: [], detached: [], note: null, z: null, ms: 0, busy: false };
function setInk(m){ chartInk = Object.assign(
  { key:null, lines:[], detached:[], note:null, z:null, ms:0, busy:false }, m || {}); }
function setNogo(m){ for (const k of Object.keys(nogo)) delete nogo[k];
                     return Object.assign(nogo, m); }
// eslint-disable-next-line no-eval
eval(grab("nogoReadout"));

// `ran` is printed in the summary on purpose. The last half of this suite is async, and a
// stray top-level process.exit() once cut it off after check 9 - the process ended at 0
// having silently skipped five checks, which is the "passes while testing nothing" failure
// this repo already knows about. A visible count makes that impossible to miss again.
let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!cond) fails++;
}
// ⚠⚠ A SUITE THAT STOPS RUNNING ITS CHECKS MUST NOT EXIT 0. The checks below live in an
// async IIFE, and an await that never settles does not crash node - it runs out of work and
// the process exits CLEANLY, mid-suite, printing no summary. A runner reading the exit code
// scores that as PASSED. Found by mutation (2026-09-22): dropping refreshNogo's `settle()`
// left three waiters suspended for ever, checks 19-19c never ran, the summary never printed,
// and the mutant was reported SURVIVED. This flag is the evidence that the end was reached.
let finished = false;
process.on("exit", (code) => {
  if (finished || code !== 0) return;
  console.log("  FAIL 0. the suite EXITED EARLY without reaching its summary - an await that "
            + "never settled, after " + ran + " check(s) ran. Exiting 0 here reads as a pass.");
  process.exitCode = 1;
});
function summary() {
  finished = true;
  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                    : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
}

// A keep-out model as buildKeepouts() returns it: land/shallow rings, shoreline paths,
// hazard and buoy points, each carrying the human `kind` string nogoKind() gave it.
function model(over) {
  return Object.assign({
    busy: false, since: null, band: "enc_5", note: "nogo not loaded", ready: true,
    ko: {
      polys: [{ kind: "land" }, { kind: "land" }, { kind: "water shallower than 2.3 m" }],
      lines: [{ kind: "the shoreline" }],
      points: [{ kind: "a charted hazard" }, { kind: "a channel buoy" }]
    }
  }, over || {});
}
const read = (over, ink) => { setNogo(model(over)); setInk(ink); return nogoReadout(); };

console.log("Nogo readout — the row has to say which of four things is true:");

// ── THE CHART IMAGE. Andy, 2026-09-04: NOAA's renderer carries structures its vector
// service does not, so the console reads the picture too - and the readout has to say
// whether it did. "The ENC has nothing there" and "nobody looked" are different states and
// only one of them is safe to plan on.
check("17. a chart-image scan that FOUND something is on the row and in its tip, and is " +
      "named as coming from a PICTURE rather than from the ENC",
      (()=>{ const r = read({}, {note:"2 structure(s) read off the chart the ENC does not carry",
                                 lines:[{lengthM:10},{lengthM:15}]});
             return /\+2 chart/.test(r.text) && r.cls === "warn"
                 && /read from the RENDERED chart, not from the ENC/.test(r.title); })(),
      "drawn in magenta, counted separately, and never presented as published vector data");
// ⚠ 17b EXISTS BECAUSE THE COUNT READ THE LINES ALONE, so an enforced, drawn and
// banner-announced marina footprint was silently missing from the one number on the card.
check("17b. ... and FOOTPRINTS are counted with the lines",
      (()=>{ const r = read({}, {note:"3 structure(s) read off the chart",
                                 lines:[{lengthM:10}], areas:[{lengthM:20},{lengthM:30}]});
             return /\+3 chart/.test(r.text) && /footprints as a filled hull/.test(r.title); })(),
      "a readout that undercounts the model looks like an answer");
check("18. ... and a scan that has NOT been made says so, rather than reading as clean",
      (()=>{ const r = read({}, {note:null, lines:[]});
             return !/chart/.test(r.text) && /not compared here yet/.test(r.title); })(),
      "a silent absence would read exactly like open water");

// 1-2. READING. The state that was stuck. It has to be visibly transient, and it has to
// show how long it has been going: a chart service that stopped answering must not look
// the same as one that is merely slow on a first fetch.
check("1. while the extract is in flight the row says it is reading the chart",
      /reading chart/.test(read({ busy: true, since: Date.now() }).text));
check("2. ... and counts the seconds, so a hung fetch is visible as a hung fetch",
      read({ busy: true, since: Date.now() - 42000 }).text.indexOf("42 s") >= 0,
      read({ busy: true, since: Date.now() - 42000 }).text);

// 3. READ, WITH ZONES. The count plus the depth floor - which is vessel-derived, so the
// operator can see what "shallow" means for the boat they are actually driving.
check("3. a read chart reports the zone count and THIS vessel's depth floor",
      read().text === "6 zones · floor 2.3 m", read().text);
check("3b. ... and is not flagged as a problem",
      read().cls === "");

// 4-5. THE PAIR THAT LOOKED IDENTICAL AND ARE OPPOSITE. Both have zero keep-outs. One is
// open water; the other means nothing has been checked and every route is direct and
// unverified. Keying off `nogo.band` - set only by a SUCCESSFUL extract - is what tells
// them apart; `nogo.ready` cannot, because it is false in both.
check("4. chart read, nothing to avoid = CLEAR WATER, and not a warning",
      (r => /clear/.test(r.text) && r.cls === "")(read({ ready: false, ko: { polys: [], lines: [], points: [] } })),
      "band set, zero keep-outs");
check("5. no chart data at all is NOT 'clear' — it is a warning that routes go direct",
      (r => !/clear/.test(r.text) && r.cls === "warn" && /DIRECT/.test(r.title))(
        read({ ready: false, band: null, note: "no ENC coverage / offline", ko: null })),
      "no band -> unverified, say so");

// 6. A failed read says why, in the tooltip, without the row growing a paragraph.
check("6. a failure names itself, truncated in the row and whole in the tooltip",
      (r => r.text.length <= 34 && /chart read failed/.test(r.title) && /stack/.test(r.title))(
        read({ band: null, ko: null, note: "chart read failed: Error: fetch aborted (stack)" })),
      "long notes must not stretch the card");

// 7. The tooltip breakdown is the operator's answer to "six zones of WHAT". It reuses the
// keep-outs' own kind strings, so it can never invent a category the model does not have.
check("7. the tooltip breaks the count down by kind, most numerous first",
      (t => t.indexOf("2 × land") >= 0 && t.indexOf("1 × shoreline") >= 0 &&
            t.indexOf("1 × charted hazard") >= 0 &&
            t.indexOf("2 × land") < t.indexOf("1 × shoreline"))(read().title),
      "articles stripped, sorted by count");
check("8. ... and every state explains what a nogo IS, with the vessel's own floor",
      [read(), read({ busy: true }), read({ band: null, ko: null })]
        .every(r => /draft \+ under-keel clearance/.test(r.title) && r.title.indexOf("2.3 m") >= 0));

// 9. Degrading safely: a model that never got built must not throw inside the card's
// update path, or the whole vessel-status readout stops with it.
check("9. a missing keep-out model degrades, it does not throw",
      (() => { try { return !!read({ ko: null }).text && !!read({ ko: {} }).text; }
               catch (e) { return false; } })());

// 10-12. THE ACTUAL REPORTED FAULT, driven end to end. Wording alone would not have
// caught it: the row was stuck because of the ORDER of two statements. So run the real
// refreshNogo() over the real rebuildNogo() and updateNogoUI(), stubbing only the leaves
// (the chart fetch, the keep-out builder, the banner, the DOM), and assert what the
// operator is left looking at once the extract has landed.
var enc = { features: [], band: null }, asv = { lat: 38.7896, lon: -75.1609 };
var S = {}, center = { lat: 38.7896, lon: -75.1609 }, NOGO_RADIUS_M = 5000;
var encShow = false, nogoShow = true, banners = [], painted = [];
function bboxAround() { return { W: 0, S: 0, E: 1, N: 1 }; }
function featuresBboxRef() { return { lat: 38.7896, lon: -75.1609 }; }
// nogoDR WAS STUBBED HERE as `() => ({})`, which was harmless only while nothing read its
// result. The readout prints the EFFECTIVE depth floor now, so the stub crashed the suite on
// `undefined.toFixed` - loudly, which is the good kind of stub failure, but a stub returning a
// plausible number would instead have kept this green while the row printed a floor the model
// was never built at. It is the REAL one, imported at the top, for the same reason foldChartInk
// is: this suite evals the shipped nogoReadout and must not be shown a different world.
function render() {}
function showBanner(t) { banners.push(t); }
// The row element records EVERY paint, so the test can assert both what was shown during
// the fetch and what the operator is left with afterwards.
var ROW = { title: "", className: "", _t: "--" };
Object.defineProperty(ROW, "textContent", {
  get() { return this._t; }, set(v) { this._t = v; painted.push(v); }
});
var FAKE = { "#v_nogo": ROW,
             "#nogoBtn": { classList: { toggle() {} }, disabled: false },
             "#chrtBtn": { classList: { add() {} } } };
function $(sel) { return FAKE[sel] || null; }
function buildKeepouts() { return { polys: [{ kind: "land" }], lines: [],
                                    points: [{ kind: "a charted hazard" }] }; }
var FETCH = null;
// ⚠ THE BOX IS PASSED THROUGH, because check 19 asks WHICH box a caller fetched - and a
// stub that swallowed its argument would let a refresh fetch the wrong water and stay green.
function fetchENCBbox(b, floor) { return FETCH(b, floor); }
// ⚠ rebuildNogo NOW FOLDS THE CHART-READ STRUCTURES, through a helper punchOut shares -
// so foldChartInk and the two kinds it stamps have to resolve here too, for the same
// reason planeFrame and chartInk do. THE REAL ONE, not a stub: a stub would keep this
// suite green while the fold it stands in for was broken. `bbOf` is what it builds its
// bounding boxes with, and `chartInk` above starts empty, so an untouched scenario
// folds nothing.
const { bbOf, bboxContains } = require("../static/js/geometry.js");
const { M_PER_DEG_LAT } = require("../static/js/geodesy.js");
const CHART_INK_KIND = "a structure drawn on the chart but absent from the ENC";
const CHART_INK_AREA_KIND = "a structure footprint read off the chart, not in the ENC";
// eslint-disable-next-line no-eval
// ⚠ ensureNogoCovers IS IN THE BUNDLE TOO (2026-09-22), because the queue is only half
// the fix: the other half is that this function answers about THIS PLAN'S water rather than
// about whether a model exists at all. `asv` is null in this world, so it takes its own
// midpoint branch, and ensureChartInk is stubbed - the chart read is chart_ink.js's subject.
var asv = null;
async function ensureChartInk() { return true; }
// ⚠ NOGO_QUEUE_MAX_MS bounds the queue wait. READ from the page, not retyped, so a suite
// that believes a different bound than the page uses cannot happen - and declared OUT HERE
// as well as inside the bundle, because a `const` in a direct eval stays in the eval's own
// scope and check 19g could not see it.
const NOGO_QUEUE_MAX_MS = +(H.match(/const NOGO_QUEUE_MAX_MS = (\d+)/) || [])[1];
eval("const NOGO_QUEUE_MAX_MS = " + NOGO_QUEUE_MAX_MS + ";" + "\n" +
     grab("foldChartInk") + "\n" + grab("rebuildNogo") + "\n" + grab("nogoStatus") + "\n" +
     grab("updateNogoUI") + "\n" + grab("refreshNogo") + "\n" +
     "const M_PER_DEG_LAT = " + M_PER_DEG_LAT + ";" + "\n" + grab("ensureNogoCovers"));

async function drive(fetchResult) {
  setNogo({ ready: false, busy: false, frame: null, ko: null, band: null,
           note: "nogo not loaded", enf: {}, features: null, bbox: null, center: null });
  sea.enc = { features: [{}], band: "enc_5" };
  painted = []; banners = [];
  FETCH = fetchResult;
  await refreshNogo();
  return { last: painted[painted.length - 1], all: painted.slice() };
}

(async () => {
  const ok = await drive(() => ({ band: "enc_5" }));
  check("10. THE REPORTED FAULT: after a SUCCESSFUL extract the row is not still reading",
        !/reading chart/.test(ok.last),
        "final paint: " + JSON.stringify(ok.last));
  check("11. ... it shows the model that was actually built",
        ok.last === "2 zones · floor 2.3 m" && nogo.busy === false && nogo.ready === true,
        "final paint: " + JSON.stringify(ok.last));
  // The transient state must still have been shown - the fix is about the LAST paint, not
  // about hiding the fact that a fetch happened.
  check("12. ... and 'reading chart' was still shown while the fetch was in flight",
        ok.all.some(t => /reading chart/.test(t)),
        ok.all.length + " paints: " + JSON.stringify(ok.all));

  const off = await drive(() => null);
  check("13. an extract that returns no coverage lands on the no-chart warning",
        !/reading chart/.test(off.last) && /offline|coverage/.test(off.last),
        "final paint: " + JSON.stringify(off.last));

  const bad = await drive(() => { throw new Error("connection reset"); });
  check("14. and a THROWN extract does too, naming the failure",
        !/reading chart/.test(bad.last) && /failed/.test(bad.last) && nogo.busy === false,
        "final paint: " + JSON.stringify(bad.last));

  // THE SHIPPED DEFAULT, not the one this suite seeds. Every check above sets
  // V.NOGO_MIN_DEPTH_M to the DriX's 2.3 m first, so none of them can see what the console
  // STARTS at before a vessel profile loads - which is why a mutation moving state.js's
  // default survived the entire suite. It matters: that is the floor in force during the
  // window between page load and /api/vessel answering, and a shallower one would let an
  // early route cross water the boat cannot swim in. 1.0 m is the conservative baseline;
  // the vessel profile raises it to draft + under-keel clearance.
  const stateSrc = fs.readFileSync(
    path.join(__dirname, "..", "static", "js", "state.js"), "utf8");
  const dflt = stateSrc.match(/NOGO_MIN_DEPTH_M:\s*([\d.]+)/);
  check("15. state.js ships a CONSERVATIVE depth floor for the pre-vessel window",
        !!dflt && parseFloat(dflt[1]) === 1.0,
        "default floor " + (dflt ? dflt[1] : "not found") + " m (the vessel raises it)");


  // ── 19. AN EXTRACT IN FLIGHT IS SOMETHING TO WAIT FOR, NOT A REASON TO SAY "DONE" ──
  //
  // refreshNogo used to `return` at once while one was running. Its callers then handed
  // their own callers the PREVIOUS box's `nogo.ready` as coverage of water nobody had
  // fetched - and outside the extract the keep-out model is EMPTY, which reads as CLEAR
  // rather than as unknown. Driven end to end: a Go-To clicked 9.8 km away during the
  // automatic 3 km re-extract was planned as a STRAIGHT LINE through a charted island,
  // with no banner at all, and the identical click a second later detoured 616 m round it.
  // resetForNewArea already waited this window out by hand; the plan paths never did.
  {
    // A fetch that does not resolve until we let it, so a second caller really does arrive
    // mid-flight rather than after.
    let release = null;
    const held = new Promise(r => release = r);
    setNogo({ ready: false, busy: false, frame: null, ko: null, band: null,
              note: "nogo not loaded", enf: {}, features: null, bbox: null, center: null });
    sea.enc = { features: [{}], band: "enc_5" };
    painted = []; banners = [];
    const boxes = [];
    // ⚠ CONCURRENCY IS WHAT `while` BUYS, AND ONLY A COUNTER CAN SEE IT. With `if` all three
    // still fetch all three boxes and the last one still wins, so a check on the boxes alone
    // stays green - the difference is that two extracts are then IN THE AIR AT ONCE, each
    // clobbering the other's pending promise. Measured here, not inferred.
    let inFlight = 0, maxInFlight = 0;
    FETCH = async (b) => {
      boxes.push(b); inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
      try { await held; return { band: "enc_5" }; } finally { inFlight--; }
    };
    const first = refreshNogo(null, { W: -70.8, S: 43.0, E: -70.7, N: 43.1 });
    await Promise.resolve();
    const busyMid = nogo.busy;
    // ⚠ TWO MORE CALLERS ARRIVE WHILE THE FIRST IS STILL IN THE AIR, not one. With a single
    // waiter an `if` is indistinguishable from a `while`: the one wake is the only wake. It
    // takes a THIRD to show that a waiter which wakes to find `busy` set again by the waiter
    // ahead of it goes round once more instead of falling through into a second concurrent
    // extract. Each asks for a DIFFERENT box, so the last one to land is identifiable.
    const second = refreshNogo(null, { W: -70.6, S: 43.0, E: -70.5, N: 43.1 });
    const third  = refreshNogo(null, { W: -70.4, S: 43.0, E: -70.3, N: 43.1 });
    await Promise.resolve();
    const fetchesWhileHeld = boxes.length;
    release();
    await first; await second; await third;
    const overlapped = boxes.some((b, i) => i > 0 && b.E === boxes[i - 1].E);
    check("19. a refresh that arrives MID-EXTRACT waits for it and then does its own, so "
          + "the box each caller asked for is a box that lands - and three waiters queue, "
          + "they do not pile in together",
          busyMid === true && fetchesWhileHeld === 1 && boxes.length === 3 && !overlapped
          && maxInFlight === 1 && nogo.bbox && Math.abs(nogo.bbox.E - (-70.3)) < 1e-9,
          "while the first was in flight: busy=" + busyMid + ", fetches=" + fetchesWhileHeld
          + "; after all three settled: " + boxes.length + " fetch(es) for boxes ending "
          + boxes.map(b => b.E).join(", ") + ", most in flight at once=" + maxInFlight
          + ", nogo.bbox.E="
          + (nogo.bbox ? nogo.bbox.E : "none")
          + ". It used to return at once and leave the caller holding the FIRST box as "
          + "coverage of water in the second");
  }

  // 19b. AND A FAILED EXTRACT RELEASES THE WAITERS. The whole point of waiting is that the
  // caller gets an answer; a throw that never settles the pending promise would hang the
  // Go-To for ever instead of ending it in the ordinary refusal.
  {
    let release = null;
    const held = new Promise(r => release = r);
    setNogo({ ready: false, busy: false, frame: null, ko: null, band: null,
              note: "nogo not loaded", enf: {}, features: null, bbox: null, center: null });
    sea.enc = { features: [{}], band: "enc_5" };
    painted = []; banners = [];
    let n = 0;
    FETCH = async () => { n++; if (n === 1) { await held; throw new Error("connection reset"); }
                          return { band: "enc_5" }; };
    const first = refreshNogo(null, { W: -70.8, S: 43.0, E: -70.7, N: 43.1 });
    await Promise.resolve();
    const second = refreshNogo(null, { W: -70.6, S: 43.0, E: -70.5, N: 43.1 });
    await Promise.resolve();
    release();
    const landed = await Promise.race([
      Promise.all([first, second]).then(() => "both returned"),
      new Promise(r => setTimeout(() => r("HUNG"), 1500)),
    ]);
    check("19b. ... and a FAILED extract releases the waiter rather than hanging it",
          landed === "both returned" && nogo.busy === false,
          landed + "; busy=" + nogo.busy + ", fetches=" + n
          + ". A waiter stranded on a promise nobody settles is a Go-To that never answers");
  }

  // 19c. THE DEADLOCK STOP. `busy` can be left standing by a throw ABOVE the try - in
  // updateNogoUI or nogoStatus - with nothing in flight to wait for. The guard is
  // `busy && pending`, so that case PROCEEDS rather than spinning for ever. Without the
  // second half this check hangs, which is exactly the failure it exists to prevent.
  {
    setNogo({ ready: false, busy: true, frame: null, ko: null, band: null,   // stranded
              note: "nogo not loaded", enf: {}, features: null, bbox: null, center: null });
    sea.enc = { features: [{}], band: "enc_5" };
    painted = []; banners = [];
    let n = 0;
    FETCH = async () => { n++; return { band: "enc_5" }; };
    const landed = await Promise.race([
      refreshNogo(null, { W: -70.6, S: 43.0, E: -70.5, N: 43.1 }).then(() => "returned"),
      new Promise(r => setTimeout(() => r("HUNG"), 1500)),
    ]);
    check("19c. a `busy` flag left standing with nothing in flight does not hang the next "
          + "refresh - it proceeds",
          landed === "returned" && n === 1,
          landed + " after " + n + " fetch(es). `while(busy && pending)`, not `while(busy)`: "
          + "a throw above the try strands busy at true, and a wait on a promise that was "
          + "never created is a console that stops planning");
  }



  // 19g. AND THE QUEUE IS BOUNDED. `fetchENCBbox` is a bare `fetch` with no timeout and no
  // AbortController, so an extract that never returns would take every Go-To, RTH and punch
  // on the page with it - for ever, and with no banner. That is a worse failure than the one
  // the queue fixes, and the repo already knows it: resetForNewArea bounds ITS wait at the
  // same 8 s, and check 2 above exists so a hung fetch stays VISIBLE as a hung fetch. Past
  // the bound a waiter PROCEEDS rather than refusing - the caller then gets a real answer,
  // and the coverage test at the end of ensureNogoCovers is what keeps that answer honest.
  //
  // ⚠ DRIVEN AGAINST A FETCH THAT NEVER SETTLES, with the bound read off the page. The clock
  // is not mocked: the check waits the real 8 s once, which is the price of proving that the
  // thing which used to hang does not.
  {
    setNogo({ ready: false, busy: false, frame: null, ko: null, band: null,
              note: "nogo not loaded", enf: {}, features: null, bbox: null, center: null });
    sea.enc = { features: [{}], band: "enc_5" };
    painted = []; banners = [];
    let n = 0;
    const forever = new Promise(() => {});
    FETCH = async () => { n++; if (n === 1) await forever; return { band: "enc_5" }; };
    const hung = refreshNogo(null, { W: -70.8, S: 43.0, E: -70.7, N: 43.1 });
    await Promise.resolve();
    const t0 = Date.now();
    const landed = await Promise.race([
      refreshNogo(null, { W: -70.6, S: 43.0, E: -70.5, N: 43.1 }).then(() => "returned"),
      new Promise(r => setTimeout(() => r("HUNG"), NOGO_QUEUE_MAX_MS + 6000)),
    ]);
    const waited = Date.now() - t0;
    check("19g. ... and the wait is BOUNDED: an extract that never returns does not take the "
          + "console's planning with it",
          landed === "returned" && waited >= NOGO_QUEUE_MAX_MS - 500
          && waited < NOGO_QUEUE_MAX_MS + 4000 && n === 2,
          landed + " after " + waited + " ms against a bound of " + NOGO_QUEUE_MAX_MS
          + " ms, with " + n + " fetch(es) issued. Unbounded, this call never returns and "
          + "every Go-To, RTH and punch on the page waits behind it in silence");
    void hung;
  }

  // ── 19d. THE CALLER'S QUESTION, THROUGH THE BUSY WINDOW ─────────────────────────────
  //
  // This is the fault as the operator met it: the boat passes the 3 km trigger, onState
  // fires the automatic re-extract, and a Go-To is clicked 9.8 km away while it is in the
  // air. ensureNogoCovers asked refreshNogo, which returned AT ONCE, and then answered TRUE
  // on the strength of the PREVIOUS box - so the leg was planned as a straight line through
  // a charted island, with no banner, and the identical click a second later detoured 616 m
  // round it. Driven here through the real ensureNogoCovers rather than asserted of
  // refreshNogo alone, because the caller's answer is what the planner acts on.
  {
    let release = null;
    const held = new Promise(r => release = r);
    setNogo({ ready: false, busy: false, frame: null, ko: null, band: null,
              note: "nogo not loaded", enf: {}, features: null, bbox: null, center: null });
    sea.enc = { features: [{}], band: "enc_5" };
    painted = []; banners = [];
    const boxes = [];
    FETCH = async (b) => { boxes.push(b); return { band: "enc_5" }; };
    await refreshNogo(null, { W: -70.78, S: 43.02, E: -70.65, N: 43.11 });   // the operating box
    const small = { ...nogo.bbox };
    // the automatic re-extract goes out and is still in the air
    FETCH = async (b) => { boxes.push(b); await held; return { band: "enc_5" }; };
    const auto = refreshNogo(null, { W: -70.79, S: 43.02, E: -70.66, N: 43.12 });
    await Promise.resolve();
    const busyMid = nogo.busy;
    // ...and the operator clicks Go-To, 9.8 km east, outside anything fetched
    const target = { lat: 43.07, lon: -70.56 };
    const ask = ensureNogoCovers([target], 300);
    await Promise.resolve();
    release();
    const answered = await ask;
    await auto;
    // ⚠ STRICTLY INSIDE THE FUNCTION'S OWN 300 m PAD (~0.0037 deg of longitude here), not a
    // round number of my own: a `need` wider than the box the function actually asks for
    // fails for arithmetic rather than for behaviour, which is how the first cut of this
    // check went red against a correct fix.
    const need = { W: target.lon - 0.002, S: target.lat - 0.002,
                   E: target.lon + 0.002, N: target.lat + 0.002 };
    check("19d. a plan asked for DURING the automatic re-extract is answered about its own "
          + "water - it waits, fetches the union, and the target's box really is covered",
          busyMid === true && answered === true && bboxContains(nogo.bbox, need)
          && !bboxContains(small, need) && boxes.length === 3,
          "mid-extract busy=" + busyMid + "; ensureNogoCovers answered " + answered
          + " after " + boxes.length + " fetch(es); the target's box was OUTSIDE the "
          + "operating box (" + bboxContains(small, need) + ") and is inside the model now ("
          + bboxContains(nogo.bbox, need) + "). It used to answer true having fetched nothing");
  }

  // 19e. ACCEPTANCE: water the model already covers still answers TRUE, and costs no second
  // extract. A fix that always answered false, or always re-fetched, would satisfy 19d and
  // make every ordinary plan pay for an extract it does not need.
  {
    setNogo({ ready: false, busy: false, frame: null, ko: null, band: null,
              note: "nogo not loaded", enf: {}, features: null, bbox: null, center: null });
    sea.enc = { features: [{}], band: "enc_5" };
    painted = []; banners = [];
    let fetches = 0;
    FETCH = async () => { fetches++; return { band: "enc_5" }; };
    await refreshNogo(null, { W: -70.90, S: 43.00, E: -70.50, N: 43.20 });
    const before = fetches;
    const inside = await ensureNogoCovers([{ lat: 43.07, lon: -70.70 }], 300);
    check("19e. ACCEPTANCE: water the model already covers still answers TRUE, and costs no "
          + "second extract",
          inside === true && fetches === before,
          "answered " + inside + " after " + (fetches - before) + " further fetch(es) - the "
          + "contained-check short-circuit is what keeps an ordinary plan free");
  }

  // 19f. AND THE SURVEY PATH ASKS THE SAME QUESTION THE SAME WAY. ensureNogoArea is the
  // other caller - the one punchOut acts on - and it met this fault from its own side: an
  // auto re-extract in flight left it answering TRUE while `nogo.features` still held the
  // PREVIOUS area's keep-outs, so the new survey was clipped against the old sea. Both now
  // go through refreshNogo's queue (19-19d) and both end on the same coverage test. Source,
  // because the two endings are the thing being held together and a second driven fixture
  // would only re-test the queue; measured against master, ensureNogoArea returned ok=true
  // with features ["OLD-1","OLD-2","OLD-3"] and punchOut's own gate let it through.
  {
    const area = H.slice(H.indexOf("async function ensureNogoArea"),
                         H.indexOf("async function ensureNogoCovers"));
    const covers = H.slice(H.indexOf("async function ensureNogoCovers"),
                           H.indexOf("async function ensureNogoCovers") + 3000);
    const ends = (src) => /return nogo\.ready && bboxContains\(nogo\.bbox, b\);/.test(src);
    check("19f. the SURVEY path and the plan path answer the same question the same way - "
          + "both end on whether the model covers THIS box, not on whether a model exists",
          ends(area) && ends(covers) && /await refreshNogo\(/.test(area)
          && /await refreshNogo\(/.test(covers),
          "ensureNogoArea ends on the coverage test: " + ends(area)
          + "; ensureNogoCovers: " + ends(covers)
          + ". Two readers of one model that disagree about what 'covered' means is how the "
          + "survey path and the plan path came to give different answers about the same sea");
  }

  // ⚠ AND ONE HALF OF THE FIX IS RECORDED AS UNCOVERED RATHER THAN CLAIMED. ensureNogoArea
  // and ensureNogoCovers now end `return nogo.ready && bboxContains(nogo.bbox, b)`, and with
  // the queue above in place no fixture can reach a state where those two disagree: after
  // refreshNogo the model either covers the asked box or the extract failed and `ready` is
  // false. Measured, not assumed - reverting the `&& bboxContains` alone leaves every check
  // here green, and reverting the QUEUE alone turns the answer from true into false, which
  // is what shows the two halves do different jobs: the queue makes the answer true for the
  // right reason, and the bboxContains makes it honest if anything ever returns early again.
  // It costs one comparison and is the difference between "cannot happen" and "must not
  // happen"; it is kept for the same reason edgeAround keeps its astern test.

  summary();
})();
