// tests/survey_wait.js - THE WAIT (the survey window phase 4, 2026-11-20).
//
// Andy, 2026-11-19, planning the survey window: "Provide a hold point for the ASV to loiter while waiting or offer a RTH
// for refuel/wait." A survey with a start time holds her until Continue. Phase 1 held her AT the survey's start and
// REFUSED the Upload when the tide left that point too shallow for the wait. Phase 4 finds her a WAIT POINT - the
// nearest water that holds her at the lowest water of the wait - or sends her HOME to wait; counts the wait down on the
// row; says when it is time; and makes Continue work from wherever she is.
//
// What this suite holds:
//   1-7    waitPointAt on the REAL keep-out modules: deep water first; a depth band counted by its SHALLOWEST depth and
//          never the raw floor model; navigation channels kept out; only water the chart was read over; the level;
//          the set's margin; the start itself where it passes; nothing in reach.
//   8-11   the record names the RUN SHE IS ON: a staged upload banks its record (holdRecordTaken, holdNextStep,
//          holdNextTick); heldSplitRun and tailEndsAtHold read the record's own point and mode.
//   12-14  where she is and whether Continue is open (waitState); the leave time; the countdown's words.
//   15     a wait at home that is no wait, or too far (waitHomeSplit; its refusals are tests/pause_resume.js 1t5-1t6).
//   16     the tide question for a survey released from FAR (uploadTideRisk's `rel`).
//   17-18  the wait's clock (waitTick): said once, again when covered, never over an alarm's hold or another link's
//          record; the wait at home that is not coming.
//   19     Continue: open by waitState, the fuel question, the busy latch, the log.
//   20     the fuel words at Upload, on the real fuel.js.
//   21     the wiring.
//   22     the wait point on the chart.
//   24     the disc a re-uploaded tail ships with (the lab, 2026-11-20).
//   25-27  THE REVIEW BEFORE THE MERGE, the wait point: a coarse depth band counted by its shallowest depth; a buoyed
//          channel between its gates kept out; a caller's keep-outs (the guard's contacts) kept off; the disc inside
//          read water; a refusal for unread water said as that; what the search kept said back.
//   28     the re-approach's re-find, on the page's own reapproachIfSetOff.
//   29     the record's `unread`, Upload's disc, and a banner that says what the search did.
//   30     THE REVIEW, the alert: never over an advisory or a refusal, no nag while Continue is closed, said again when
//          her state changes, taken down when the wait ends, the home notice not during a Continue.
//
//   node tests/survey_wait.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// NOTE: the page's script is <script type="module">, which runs STRICT; these functions are evaluated strict here.

function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);
// ⚠ A PROMISE THAT NEVER SETTLES IS NOT A PASS: node exits 0 with nothing left to run, before the summary line.
let __finished = false;
process.on("beforeExit", () => {
  if (__finished) return;
  console.log("  FAIL 0. the suite never finished - a promise it awaited never settled");
  console.log("\n1 CHECK(S) FAILED (never finished)");
  process.exit(1);
});

const fs = require("fs");
const path = require("path");
const G = require("../static/js/geodesy.js");
const S = require("../static/js/state.js");
const K = require("../static/js/keepouts.js");
const HOLD = require("../static/js/hold.js");
const PS = require("../static/js/passage.js");
const FUEL = require("../static/js/fuel.js");
const SV = require("../static/js/surveys.js");
const CH = require("../static/js/chart.js");

const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const APP = process.env.ASV_APP || path.join(__dirname, "..");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");
const PY = fs.readFileSync(path.join(APP, "asv_console.py"), "utf8").split("\r\n").join("\n");

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
function grabAt(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return { start, end: k + 1 };
}
function grab(name) { const r = grabAt(name); return H.slice(r.start, r.end); }
function decl(re) {
  const m = H.match(re);
  if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
  return m[0];
}
const grabs = (...names) => names.map(grab).join("\n") + "\n";
async function safely(fn) { try { return { v: await fn() }; } catch (e) { return { err: e }; } }

// ── the plane ────────────────────────────────────────────────────────────────────────────────────────────────────
const O = { lat: 43.07, lon: -70.71 };
const FRAME = G.planeFrame(O);
const at = (x, y) => FRAME.fromEN(x, y);
const xy = (p) => FRAME.toEN(p);
const ringLL = (x0, x1, y0, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]].map(([x, y]) => { const p = at(x, y); return [p.lon, p.lat]; });
const area = (x0, x1, y0, y1, d1, d2) =>
  ({ role: "depth_area", cls: "Depth_Area", props: { DRVAL1: d1, DRVAL2: d2 }, geometry: { type: "Polygon", coordinates: [ringLL(x0, x1, y0, y1)] } });
const fairway = (x0, x1, y0, y1) =>
  ({ role: "fairway", cls: "Fairway_area", props: {}, geometry: { type: "Polygon", coordinates: [ringLL(x0, x1, y0, y1)] } });
const box = (x0, x1, y0, y1) => { const a = at(x0, y0), b = at(x1, y1); return { W: a.lon, S: a.lat, E: b.lon, N: b.lat }; };

// ── 1-7. THE WAIT POINT, ON THE REAL MODULES ─────────────────────────────────────────────────────────────────────
// A 1.0 m floor, a 5 m buffer. West to east: the 0-1.8 m band (LEGAL water to the floor's model, by its deepest value -
// and dry in part), a 2-5 m band (over the floor, under deep water first's margin), a 10-20 m basin.
const FLOOR = 1.0, BUF = 5;
const ENF = { land: true, depth: true, haz: true, area: false, chan: true };
const OPTS = (level) => ({ minDepthM: FLOOR, wreckRadiusM: 10, bufferM: BUF, waterOffsetM: level, depthRange: { min: FLOOR, max: 0 }, enforce: ENF });
function modelAt(feats, level) {
  const ko = K.buildKeepouts(FRAME, feats, OPTS(level));
  ko.margin = K.deepKeepouts(FRAME, feats, { ...OPTS(level), floorPolys: ko.polys });
  return ko;
}
// (the areas TILE the whole reach, as a chart's Group 1 does: past them the model holds nothing, and reads as clear)
const SHOAL = () => area(-900, 50, -900, 900, 0, 1.8), MID = (d1) => area(50, 200, -900, 900, d1 == null ? 2.0 : d1, 5.0);
const DEEP = () => area(200, 900, -900, 900, 10, 20);
const NEAR = () => [SHOAL(), MID(), DEEP()];                       // the basin 200 m east of the start
const FAR = (d1) => [SHOAL(), area(50, 900, -900, 900, d1 == null ? 2.0 : d1, 5.0)];   // no deep water in reach
function waitWorld(env) {
  Object.assign(S.nogo, { ready: true, frame: FRAME, buffer: BUF, enf: { ...ENF, ...(env.enf || {}) }, ais: null,
                          bbox: env.bbox || box(-3000, 3000, -3000, 3000), unread: env.unread || null, features: env.feats });
  S.nogo.ko = modelAt(env.feats, 0);
  // eslint-disable-next-line no-new-func
  return new Function("K", "P", "HOLD", "S", "env", "modelAt", "CH", '"use strict";\n'
    + "const {nogo} = S; const {holdTarget, passageKo, armDeep, beyondChart, CHART_EDGE_M} = P; const {holdMarginM} = HOLD;\n"
    + "const {systemCenterline} = K;\n" + decl(/^const WAIT_LAYERS = [^;]*;/m) + "\n"
    + decl(/^const WAIT_REACH_M = [^;]*;/m) + "\n" + decl(/^const WAIT_SET_FLOOR_MS = [^;]*;/m) + "\n"
    + "const koAtLevel = (m) => modelAt(env.feats, m); const setMsNow = () => env.setMs || 0; const holdRadiusM = () => 2;\n"
    + "const nogoDR = () => ({min: " + FLOOR + ", max: 0}); const modelFeatures = () => env.feats;\n"
    // (chart.js's REAL buildMargin - a margin it did not hand through is the deep tier again - recording what was asked)
    + "const buildMargin = (ref, enf, dr, feats, level, ko, marginM, bandMaxM) => { env.margins.push(marginM);"
    + "  return CH.buildMargin(ref, enf, dr, feats, level, ko, marginM, bandMaxM); };\n"
    + grabs("waitLayer", "waitBuoyedChannels", "waitPointAt") + "\nreturn {waitPointAt};")(K, PS, HOLD, S, env, modelAt, CH);
}
const START = at(0, 0);
const ask = (env, level, o, center) => { env.margins = []; const w = waitWorld(env); const r = w.waitPointAt(center || START, level, o);
                                         return { ...r, e: r.to ? xy(r.to).e : null, n: r.to ? xy(r.to).n : null }; };

(async () => {
  console.log("The wait - a wait point, a wait at home, the countdown and Continue:");

  {
    const d = ask({ feats: NEAR() }, 0);
    // the SAME start on the floor's own model, by the same search: it "holds a boat" where it stands - in the 0-1.8 m band
    const raw = HOLD.snapClearRadial(xy(START), modelAt(NEAR(), 0), BUF, 2, { need: 20 });
    check("1. DEEP WATER FIRST: a start in the 0-1.8 m band is given a wait point in the basin 200 m east - 25 m and more "
          + "inside it (the buffer and the margin of a 2 kn set), a disc that reaches into no margin water - though the "
          + "floor's own model, where a band is legal by its DEEPEST value, calls the start itself a place to hold",
          () => d.to && d.tier === "deep" && d.e >= 225 && d.e <= 240 && Math.abs(d.n) < 40 && d.movedM >= 225 && d.movedM <= 245
                && d.need === 20 && d.level === 0 && d.holdClear >= 20 && d.holdClear <= d.e - 200 - BUF + 1e-6
                && raw && raw.moved === 0,
          () => JSON.stringify({ tier: d.tier, e: d.e && +d.e.toFixed(1), moved: d.movedM, disc: d.holdClear, need: d.need, raw: raw && raw.moved, err: d.error }));
  }
  {
    const envF = { feats: FAR() };
    const f = ask(envF, 0), mar = envF.margins.slice();
    const only = ask({ feats: FAR() }, 0, { deepOnly: true });
    check("2. NO DEEP WATER IN REACH: the next tier counts every depth band by its SHALLOWEST depth against the floor "
          + "itself (the margin layer built at 0) - the 2-5 m band holds her, 25 m inside it, and the 0-1.8 m band does "
          + "not - never the raw floor model; a level that was not read searches the deep tier only, and finds none",
          () => f.to && f.tier === "floor" && f.e >= 75 && f.e <= 90 && mar.length === 2 && mar[0] === undefined && mar[1] === 0
                && !only.to && /nowhere within 500 m/.test(only.error || ""),
          () => JSON.stringify({ tier: f.tier, e: f.e && +f.e.toFixed(1), margins: mar, only: only.error }));
  }
  {
    // the level is the model's: a band 1.2 m at its shallowest holds her at chart datum and not half a meter under it
    const a0 = ask({ feats: FAR(1.2) }, 0), lo = ask({ feats: FAR(1.2) }, -0.5);
    const B32 = () => [SHOAL(), MID(), area(200, 900, -900, 900, 3.2, 10)];
    const b0 = ask({ feats: B32() }, 0), bLo = ask({ feats: B32() }, -0.5);
    // ... and the FLOOR'S OWN MODEL is the level's too: a band 0.5-1.3 m is legal at +0.00 m by its deepest value and a
    // keep-out at -0.50 m - where the margin layer leaves it to the floor's model (keepouts.js: "a keep-out already")
    const F13 = () => [area(-900, 900, -900, 900, 0.5, 1.3)];
    const fLo = ask({ feats: F13() }, -0.5);
    check("3. THE LEVEL IS THE WAIT'S LOW: a band 1.2 m at its shoalest holds her at +0.00 m, and at -0.50 m it is under "
          + "the floor - no water in reach, a refusal; and the deep tier is asked at that level too - a basin 3.2 m at "
          + "its shoalest is deep water at +0.00 m and margin water at -0.50 m, where the 2-5 m band short of it holds her",
          () => a0.to && a0.tier === "floor" && !lo.to && lo.level === -0.5 && /nowhere within 500 m/.test(lo.error || "")
                && b0.tier === "deep" && b0.e >= 225 && bLo.tier === "floor" && bLo.e >= 75 && bLo.e <= 175
                && !fLo.to && /nowhere within 500 m/.test(fLo.error || ""),
          () => JSON.stringify({ at0: a0.tier, low: lo.error, basin: [b0.tier, b0.e, bLo.tier, bLo.e] }));
  }
  {
    // a fairway over the basin's west 400 m: deep water, and no place to loiter for hours
    const feats = () => [...NEAR(), fairway(200, 600, -900, 900)];
    const c = ask({ feats: feats() }, 0), off = ask({ feats: feats(), enf: { chan: false } }, 0);
    check("4. NAVIGATION CHANNELS ARE KEPT OUT of a wait: with a fairway over the near basin the wait point is in the "
          + "2-5 m band short of it, 25 m off its edge - and with Shipping channels unchecked, in the basin as before",
          () => c.to && c.tier === "floor" && c.chans === 1 && c.e >= 75 && c.e <= 175
                && off.to && off.tier === "deep" && off.chans === 0 && off.e >= 225,
          () => JSON.stringify({ kept: [c.tier, c.e && +c.e.toFixed(1), c.chans], unchecked: [off.tier, off.e && +off.e.toFixed(1)], err: c.error }));
  }
  {
    // the chart was read only to e = 260: past it the model holds NOTHING, which every test reads as clear water
    const edge = ask({ feats: NEAR(), bbox: box(-3000, 260, -3000, 3000) }, 0);
    const un = at(190, -950), un2 = at(1000, 950);
    const hole = ask({ feats: NEAR(), unread: [{ W: un.lon, S: un.lat, E: un2.lon, N: un2.lat }] }, 0);
    check("5. ONLY WATER THE CHART WAS READ OVER: with the chart's box ending at the basin, or the basin a square no "
          + "chart covers, the wait point is found short of it - never out where the model holds nothing",
          () => edge.to && edge.e <= 160 + 1e-6 && edge.tier === "floor" && hole.to && hole.e < 190 && hole.tier === "floor",
          () => JSON.stringify({ edge: [edge.tier, edge.e && +edge.e.toFixed(1)], hole: [hole.tier, hole.e && +hole.e.toFixed(1)], err: edge.error || hole.error }));
  }
  {
    const own = ask({ feats: NEAR() }, 0, null, at(500, 0));
    const set = ask({ feats: NEAR(), setMs: 2.0 }, 0);
    check("6. a start that holds her ITSELF is her wait point (nothing moves); and a set over the 2 kn floor asks its own "
          + "margin - 40 m for a 4 kn stream",
          () => own.to && own.movedM === 0 && Math.abs(own.e - 500) < 1e-6 && own.tier === "deep"
                && set.to && set.need === 40 && set.e >= 245,
          () => JSON.stringify({ own: [own.movedM, own.e], set: [set.need, set.e && +set.e.toFixed(1)] }));
  }
  {
    const none = ask({ feats: [area(-900, 900, -900, 900, 0, 1.8)] }, 0);
    S.nogo.ready = false;
    const nochart = (() => { const w = waitWorld({ feats: NEAR(), margins: [] }); S.nogo.ready = false; return w.waitPointAt(START, 0); })();
    S.nogo.ready = true;
    check("7. NOTHING IN REACH is a refusal, never the point as it stands: in a band dry in part every tier fails, in the "
          + "search's own words; and with no chart there is nothing to search",
          () => !none.to && /nowhere within 500 m/.test(none.error || "") && none.need === 20 && !nochart.to && /chart/.test(nochart.error)
                && none.error === "the target sits in water charted under her floor in part and nowhere within 500 m of it holds a boat clear",
          () => JSON.stringify({ none: none.error, nochart: nochart.error }));
  }

  // ── 8-11. THE RECORD NAMES THE RUN SHE IS ON ───────────────────────────────────────────────────────────────────
  const recWorld = () => {
    const store = {};
    // eslint-disable-next-line no-new-func
    return new Function("store", "distTo", "SV", '"use strict";\n'
      + "const lsGet = (k, f) => (k in store ? store[k] : f), lsSet = (k, v) => { store[k] = v; };\n"
      + "const {surveyStartIdx} = SV; let S = {run_seq: 4, boot_id: 'b1'}; let mission = {waypoints: [], surveys: []};\n"
      + "let fuelRth = {acted: true, alerted: true};\n"
      + "const surveyById = (id) => (mission.surveys || []).find((s) => s.id === id) || null;\n"
      + decl(/^const PENDING_HOLD_KEY = [^;]*;/m) + "\n" + decl(/^const PENDING_NEXT_KEY = [^;]*;/m) + "\n"
      + "let pendingHold = null, pendingNext = null;\n"
      + grabs("setPendingHold", "setPendingNext", "holdRecordTaken", "holdNextStep", "holdNextTick", "surveyStartT", "holdRec",
              "heldSplitRun", "onSplitRun", "tailEndsAtHold", "waitPart")
      + "return { holdRecordTaken, holdNextStep, holdNextTick, holdRec, heldSplitRun, onSplitRun, tailEndsAtHold, waitPart, store,"
      + " get hold(){ return pendingHold; }, set hold(v){ pendingHold = v; }, get next(){ return pendingNext; },"
      + " set next(v){ pendingNext = v; }, get fuel(){ return fuelRth; }, set S(v){ S = v; }, set mission(v){ mission = v; } };")(store, G.distTo, SV);
  };
  {
    const w = recWorld();
    const N = { rec: { sv: "S3" }, n: 12, seq: 4, after: 100.5, release: true, boot: "b1" };
    const f = (o) => w.holdNextStep(N, { server_t: 101, plan_staged: false, run: "running", run_seq: 5, wp_total: 12, behavior: "survey", boot_id: "b1", ...o });
    // (Stop, E-STOP, a disarm or a lost link make the staged plan THE loaded one and leave the run's number alone)
    const halted = ["stopped", "idle", "estop"].map((run) => f({ run, run_seq: 4 })).join(",");
    check("8. a staged upload's record waits for the frame that shows ITS plan started - a new run, of its length, a "
          + "survey - and is dropped when the staged slot went to anything else (a re-approach keeps the run; a Go-To or "
          + "an RTH is another kind; another plan another length); a frame from before the reply, or the plan still "
          + "staged, decides nothing",
          () => f({}) === "apply" && f({ run_seq: 4 }) === "drop" && f({ wp_total: 3 }) === "drop" && f({ behavior: "goto" }) === "drop"
                && f({ behavior: "rth", wp_total: 6 }) === "drop" && f({ plan_staged: true }) === "wait"
                && f({ server_t: 100.5 }) === "wait" && f({ server_t: 99 }) === "wait" && w.holdNextStep(null, {}) === "wait"
                // A HALTED FRAME DECIDES NOTHING (the phase 4 review): the vessel kept the plan, so the record waits for
                // the Start that flies it - dropped there, that Start chained her home from the wait point
                && halted === "wait,wait,wait" && f({ run: "stopped" }) === "wait" && f({ run: "paused", run_seq: 4 }) === "drop"
                // ... and a bank another console process wrote is dropped, whatever the frame
                && f({ boot_id: "b2" }) === "drop" && f({ boot_id: "b2", plan_staged: true }) === "drop",
          () => [f({}), f({ run_seq: 4 }), f({ wp_total: 3 }), f({ behavior: "goto" }), f({ plan_staged: true }), f({ server_t: 99 })].join(","));
  }
  {
    const w = recWorld(), ON = { sv: "S2", mode: "loiter", p: at(0, 0) };
    w.hold = ON;
    w.holdRecordTaken(null, { state: { plan_staged: true, run_seq: 4, server_t: 100.5 } }, 12, "S2");
    const staged = { hold: w.hold, next: w.next, stored: w.store.asv_pending_next_v1 };
    // a frame on the OLD run, staged: nothing; then Start: applied, and the fuel latch dropped (a release)
    w.holdNextTick({ server_t: 101, plan_staged: true, run: "running", run_seq: 4, wp_total: 3, behavior: "survey" });
    // ... and one STOPPED (the staged plan is the loaded one now, the run's number as it was): still banked
    w.holdNextTick({ server_t: 101.5, plan_staged: false, run: "stopped", run_seq: 4, wp_total: 12, behavior: "survey" });
    const still = w.hold === ON && !!w.next;
    w.holdNextTick({ server_t: 102, plan_staged: false, run: "running", run_seq: 5, wp_total: 12, behavior: "survey" });
    const applied = { hold: w.hold, next: w.next, fuel: { ...w.fuel } };
    // ... and a slot taken by the guard's re-approach: the record stays the run's she is still on, the latch untouched
    const w2 = recWorld(); w2.hold = ON;
    w2.holdRecordTaken({ sv: "S3", mode: "loiter" }, { state: { plan_staged: true, run_seq: 4, server_t: 100.5 } }, 12, "S2");
    w2.holdNextTick({ server_t: 102, plan_staged: false, run: "running", run_seq: 4, wp_total: 2, behavior: "survey" });
    // a staged upload that is NO release (a plain Upload, then Start): applied, the latch as it was
    const w4 = recWorld(); w4.hold = ON;
    w4.holdRecordTaken({ sv: "S3", mode: "loiter" }, { state: { plan_staged: true, run_seq: 4, server_t: 100.5 } }, 12);
    w4.holdNextTick({ server_t: 102, plan_staged: false, run: "running", run_seq: 5, wp_total: 12, behavior: "survey" });
    // A RELEASE TAKEN AT ONCE (a boat STOPPED at home: nothing staged, nothing banked) drops the latch at the reply
    const w5 = recWorld(); w5.hold = { sv: "S2", mode: "home" };
    w5.holdRecordTaken(null, { state: {} }, 9, "S2");
    const w6 = recWorld(); w6.hold = ON; w6.holdRecordTaken({ sv: "S3", mode: "loiter" }, { state: {} }, 9);
    // an upload NOT staged (an idle boat): written at the reply, as before
    const w3 = recWorld(); w3.hold = ON; w3.next = { rec: null, n: 3, seq: 1, after: 0 };
    w3.holdRecordTaken({ sv: "S3", mode: "loiter" }, { state: {} }, 9);
    check("9. THE RECORD NAMES THE RUN SHE IS ON: an upload answered STAGED leaves it as it is - End of plan must not "
          + "chain her home from the hold before Start - and banks its own with the plan's length, the run she was on "
          + "and the reply's time; the frame that shows that plan STARTED applies it and gives the low-fuel monitor a "
          + "first look at the new flight; a slot the guard's re-approach took drops it and keeps the record; an upload "
          + "not staged is written at once",
          () => staged.hold === ON && staged.next.rec === null && staged.next.n === 12 && staged.next.seq === 4
                && staged.next.after === 100.5 && staged.next.release === true && staged.stored === staged.next && still
                && applied.hold === null && applied.next === null && applied.fuel.acted === false && applied.fuel.alerted === false
                && w2.hold === ON && w2.next === null && w2.fuel.acted === true
                && w4.hold.sv === "S3" && w4.next === null && w4.fuel.acted === true && w4.fuel.alerted === true
                && staged.next.boot === "b1"
                && w5.hold === null && w5.fuel.acted === false && w5.fuel.alerted === false
                && w6.fuel.acted === true && w6.fuel.alerted === true
                && w3.hold.sv === "S3" && w3.next === null,
          () => JSON.stringify({ staged: staged.next, still, applied: [applied.hold, applied.fuel], reapproach: [w2.hold && w2.hold.sv, w2.next], idle: w3.hold }));
  }
  {
    const w = recWorld();
    const run = { behavior: "survey", run_completion: "loiter", completion: "rth" };
    w.hold = { sv: "S2", mode: "loiter" }; const split = w.heldSplitRun(run);
    w.hold = { sv: "S2" }; const old = w.heldSplitRun(run);                       // a record from before phase 4
    w.hold = { sv: "S2", mode: "home" }; const home = w.heldSplitRun(run);
    w.hold = { sv: "S2", mode: "loiter" };
    const others = [w.heldSplitRun({ ...run, behavior: "goto" }), w.heldSplitRun({ ...run, run_completion: "rth" }),
                    w.heldSplitRun({ ...run, completion: "loiter" })];
    w.hold = { sv: "S2", mode: "loiter" };
    const on = [w.onSplitRun(run), w.onSplitRun({ ...run, completion: "loiter" }), w.onSplitRun({ ...run, behavior: "goto" }),
                w.onSplitRun({ ...run, run_completion: "rth" })];
    w.hold = { sv: "S2", mode: "home" }; on.push(w.onSplitRun(run));
    w.hold = null; const none = w.heldSplitRun(run);
    check("10. the End of plan chain stands down at a hold she was sent to WAIT at - a survey that ended in a loiter, "
          + "with a loiter's record - and NOT for a wait at home: its part is a plan that ends, and a routed re-approach "
          + "at its end (a survey, a loiter) must not own the hold and stop her going home",
          () => split === true && old === true && home === false && others.every((x) => x === false) && none === false
                // (the row, the alert and the re-approach ask whether she is ON the split's run - with End of plan LOITER too)
                && on.join(",") === "true,true,false,false,false",
          () => JSON.stringify({ split, old, home, others, none, on }));
  }
  {
    const w = recWorld(), W = at(120, 40), FIRST = at(0, 0);
    w.mission = { waypoints: [{ ...at(-50, 0), sv: "S1" }, { ...FIRST, sv: "S2" }, { ...at(0, 100), sv: "S2" }], surveys: [{ id: "S1" }, { id: "S2" }] };
    const tail = (p) => [at(-80, 0), p];
    w.hold = { sv: "S2", mode: "loiter", p: W };
    const byP = [w.tailEndsAtHold(tail(W)), w.tailEndsAtHold(tail(at(120.3, 40))), w.tailEndsAtHold(tail(FIRST)), w.tailEndsAtHold(tail(at(121, 40)))];
    w.hold = { sv: "S2" };
    const oldRec = [w.tailEndsAtHold(tail(FIRST)), w.tailEndsAtHold(tail(W))];
    w.hold = { sv: "S2", mode: "home" };
    const home = w.tailEndsAtHold(tail(FIRST));
    w.hold = null;
    // the record a split writes: where the part ENDED, the level, the link, whether its start was ahead
    w.mission = { waypoints: [], surveys: [{ id: "S2", settings: { start_t: Date.now() / 1000 + 3600 } }, { id: "S3", settings: {} }] };
    const HOLD2 = { held: "S2", part: [FIRST] };
    const r1 = w.holdRec(HOLD2, null, { to: W, level: 0.2 }, [at(-10, 0), W]);
    const r2 = w.holdRec(HOLD2, { part: [] }, null, [at(-10, 0)]);
    const r3 = w.holdRec({ held: "S3", part: [FIRST] }, null, null, [FIRST]);
    const A1 = { ...at(-50, 0), sv: "S1" }, wpPart = w.waitPart({ held: "S2", part: [A1, { ...FIRST, sv: "S2" }] }, { to: W });
    check("11. a re-uploaded tail keeps the LOITER when it ends where the part aboard ended - the record's own point, a "
          + "wait point: compared with the survey's first waypoint a guard-held resume dropped it and End of plan took her "
          + "home from the wait - a record from before by the first waypoint, a wait at home never; and the record a "
          + "split writes holds that point, the level it was found at, the link, and whether its start was ahead",
          () => byP.join(",") === "true,true,false,false" && oldRec.join(",") === "true,false" && home === false
                && r1.sv === "S2" && r1.mode === "loiter" && r1.p.lat === W.lat && r1.level_m === 0.2 && r1.boot === "b1" && r1.ahead === true
                && r2.mode === "home" && !("p" in r2) && r2.ahead === true
                && r3.mode === "loiter" && r3.ahead === false && !("level_m" in r3) && w.holdRec(null) === null
                // (the part sent: its end moved to the wait point, still the waiting survey's - the legs' and the fuel's
                //  reckoning read that tag - and what comes before it untouched)
                && wpPart.length === 2 && wpPart[0] === A1 && wpPart[1].lat === W.lat && wpPart[1].lon === W.lon && wpPart[1].sv === "S2",
          () => JSON.stringify({ byP, oldRec, home, r1: [r1.mode, r1.level_m, r1.ahead], r2: r2.mode, r3: [r3.mode, r3.ahead] }));
  }

  // ── 12-14. WHERE SHE IS, WHEN TO LEAVE, THE COUNTDOWN ──────────────────────────────────────────────────────────
  const stateWorld = (env) =>
    // eslint-disable-next-line no-new-func
    new Function("env", "distTo", "SV", '"use strict";\n'
      + "const {surveyStartIdx} = SV; let pendingHold = null; const S = env.S; const mission = env.mission;\n"
      + "const canCommand = (s) => !!(s && s.armed && !s.estop) && env.supervising !== false;\n"
      + "const roleSpeedMS = (r) => (r === 'transit' ? 4.0 : 2.0); const asv = env.asv || null;\n"
      + decl(/^const WAIT_AT_M = [^;]*;/m) + "\n"
      + "const setMsNow = () => env.setMs || 0;\n" + decl(/^const WAIT_SET_FLOOR_MS = [^;]*;/m) + "\n"
      + grabs("heldSplitRun", "onSplitRun", "surveyStartT", "waitState", "waitFastMS", "waitLeaveT", "waitDur", "waitCountdownSay")
      + "return { waitState, waitLeaveT, waitDur, waitCountdownSay, set hold(v){ pendingHold = v; } };")(env, G.distTo, SV);
  {
    const env = { S: {}, mission: {} }, w = stateWorld(env);
    const LO = { sv: "S2", mode: "loiter" }, HM = { sv: "S2", mode: "home" };
    const run = (o, st) => [{ run: "running", behavior: "survey", run_completion: "loiter", completion: "rth", armed: true, ...o }, st || { holding: true }];
    const st = (rec, o, s2) => { w.hold = rec; const r = w.waitState(rec, ...run(o, s2)); return r.state + ":" + r.can; };
    const got = {
      point: st(LO), way: st(LO, {}, { holding: false }), paused: st(LO, { run: "paused" }),
      pointEndLoiter: st(LO, { completion: "loiter" }),      // (End of plan LOITER: the chain's clause is not this question)
      rthHome: st(LO, { behavior: "rth" }), goto: st(LO, { behavior: "goto" }), escape: st(LO, { behavior: "escape" }),
      stopped: st(LO, { run: "stopped" }, {}), idle: st(LO, { run: "idle" }, {}),
      hHome: st(HM, { behavior: "rth" }), hEnd: st(HM), hWay: st(HM, {}, { holding: false }), hPaused: st(HM, { run: "paused" }),
      hIdle: st(HM, { run: "idle" }, {}), hStopped: st(HM, { run: "stopped" }, {}), hDisarmed: st(HM, { run: "idle", armed: false }, {}),
      hEstop: st(HM, { run: "idle", estop: true }, {}),
    };
    w.hold = LO;
    const says = [w.waitState(LO, ...run()).say, w.waitState(LO, ...run({ behavior: "goto" })).say, w.waitState(LO, ...run({ run: "paused" })).say];
    // (the phase 4 review) UNDER WAY on another kind of run is not "on her way to where she waits"; a hold AT her wait
    // point is one whatever her behavior (a Hold pressed there, the guard's hold rung); a wait at home held AT home by
    // a Go-To is at home; and a window that cannot command her has Continue closed, said
    const WP = at(40, 60);
    const wayRth = w.waitState(LO, ...run({ behavior: "rth" }, { holding: false }));
    const heldAt = w.waitState({ ...LO, p: WP }, ...run({ behavior: "hold" }, { holding: true, hold: at(41, 60) }));
    const heldOff = w.waitState({ ...LO, p: WP }, ...run({ behavior: "hold" }, { holding: true, hold: at(140, 60) }));
    env.S.home = at(-500, 0);
    const homeByGoto = w.waitState(HM, ...run({ behavior: "goto" }, { holding: true, hold: at(-500, 3) }));
    env.supervising = false;
    const view = [w.waitState(LO, ...run()), w.waitState(HM, ...run({ behavior: "rth" }))];
    env.supervising = true;
    check("12. WHERE SHE IS FOR THE WAITING SURVEY, in one answer for the row, the press and the alert: holding where "
          + "she waits, at home, or somewhere else - each said as that, each open (the upload routes from where she is); "
          + "on her way or paused, closed; a LOITER needs her holding, as it always did; a wait AT HOME is open whenever "
          + "she is not under way and can be commanded - stopped at the dock to refuel, or never left it - and closed "
          + "disarmed or under E-STOP",
          () => got.point === "point:true" && got.pointEndLoiter === "point:true" && got.way === "way:false" && got.paused === "paused:false"
                && got.rthHome === "home:true" && got.goto === "elsewhere:true" && got.escape === "elsewhere:true"
                && got.stopped === "idle:false" && got.idle === "idle:false"
                && got.hHome === "home:true" && got.hEnd === "end:true" && got.hWay === "way:false" && got.hPaused === "paused:false"
                && got.hIdle === "idle:true" && got.hStopped === "idle:true" && got.hDisarmed === "idle:false" && got.hEstop === "idle:false"
                && says[0] === "she is holding where she waits for it" && /holding \(goto\), not where she was to wait/.test(says[1])
                && /PAUSED \(a paused boat drifts\) - press Start to resume her first/.test(says[2]) && w.waitState(null, {}) === null
                && wayRth.state === "way" && wayRth.can === false && wayRth.short === "Under way"
                && wayRth.say === "she is under way (rth), not to where she waits - Continue opens when she holds"
                && w.waitState(LO, ...run({}, { holding: false })).say === "she is on her way to where she waits - Continue opens when she is holding there"
                && heldAt.state === "point" && heldOff.state === "elsewhere" && homeByGoto.state === "home"
                && view.every((v) => v.can === false && v.short === "View only" && /cannot command her/.test(v.say))
                && view[0].state === "point" && view[1].state === "home",
          () => JSON.stringify(got));
  }
  {
    const first = at(0, 0), env = { S: { run: "running", status: {}, home: at(-4000, 0) },
      mission: { waypoints: [{ ...at(-500, 0), sv: "S1" }, { ...first, sv: "S2" }, { ...at(0, 300), sv: "S2" }] } };
    const w = stateWorld(env), start = 1795200000, sv = { id: "S2", settings: { start_t: start } };
    const home = w.waitLeaveT({ sv: "S2", mode: "home" }, sv);                    // 4000 m at the faster 4 m/s
    const point = w.waitLeaveT({ sv: "S2", mode: "loiter", p: at(200, 0) }, sv);   // 200 m
    env.S.status = { holding: true, hold: at(-800, 0) };                           // she holds 800 m off, whatever the record says
    const held = w.waitLeaveT({ sv: "S2", mode: "loiter", p: at(200, 0) }, sv);
    env.S.status = {};
    const noP = w.waitLeaveT({ sv: "S2", mode: "loiter" }, sv), noStart = w.waitLeaveT({ sv: "S2", mode: "home" }, { id: "S2", settings: {} });
    // (the phase 4 review) NOT where the record says: stopped at home 4 km off after a low-fuel return, the record's
    // wait point 200 m from the survey - reckoned from the record, "time to leave" came 16 minutes late
    const env2 = { S: { run: "idle", status: {}, home: at(-4000, 0) }, mission: env.mission, asv: at(-4000, 0) }, w2 = stateWorld(env2);
    const stoppedHome = w2.waitLeaveT({ sv: "S2", mode: "loiter", p: at(200, 0) }, sv);
    env2.S.run = "running"; env2.S.behavior = "rth";                              // ... under way home on that return
    const wayHome = w2.waitLeaveT({ sv: "S2", mode: "loiter", p: at(200, 0) }, sv);
    env2.S.behavior = "survey"; env2.S.run_completion = "loiter"; w2.hold = { sv: "S2", mode: "loiter", p: at(200, 0) };
    const onHerWay = w2.waitLeaveT({ sv: "S2", mode: "loiter", p: at(200, 0) }, sv);   // on the split's run: where she WILL wait
    // (with a SET behind her: the live set, never under the 1 m/s floor - left at the still-water time she was at the
    //  survey before its start with the stream fair: the review)
    env.setMs = 2.0; const setHome = w.waitLeaveT({ sv: "S2", mode: "home" }, sv); env.setMs = 0;
    check("13. WHEN TO LEAVE: the start less the straight way from where she waits - the point she holds at, else the "
          + "record's wait point, or home - to the survey's first waypoint at her FASTER speed with a set behind her (the "
          + "live set, never under 1 m/s: her earliest arrival, never there before the water); the start itself with no "
          + "place known; none with no start",
          () => Math.abs(home - (start - 800)) < 1 && Math.abs(point - (start - 40)) < 1 && Math.abs(held - (start - 160)) < 1
                && noP === start && noStart === null && Math.abs(setHome - (start - 4000 / 6)) < 1
                && Math.abs(stoppedHome - (start - 800)) < 1 && Math.abs(wayHome - (start - 800)) < 1 && Math.abs(onHerWay - (start - 40)) < 1,
          () => JSON.stringify({ home: start - home, point: start - point, held: start - held, noP: start - noP, noStart, setHome: start - setHome,
                                 stoppedHome: start - stoppedHome, wayHome: start - wayHome, onHerWay: start - onHerWay }));
  }
  {
    const w = stateWorld({ S: {}, mission: {} }), T = 1795200000;
    const c = (now, leave, home) => w.waitCountdownSay(now, T, leave, home);
    check("14. the row's countdown: to the start (minutes, then hours and minutes), to the LEAVE time for a wait at home "
          + "with the start beside it, 'TIME TO LEAVE' from then to the start, and up from a start gone by",
          () => c(T - 8040, T, false) === "starts in 2 h 14 min" && c(T - 2460, T, false) === "starts in 41 min"
                && c(T - 20, T, false) === "starts in under a minute"
                && c(T - 3600, T - 1200, true) === "leave in 40 min (starts in 60 min)"
                && c(T - 600, T - 1200, true) === "TIME TO LEAVE - starts in 10 min"
                && c(T - 600, T - 30, true) === "starts in 10 min"                    // (a home a minute away is no leave time)
                && c(T - 3600, T - 1200, false) === "starts in 60 min"                // (a loiter counts to its start)
                && c(T + 720, T, false) === "start passed 12 min ago" && c(T, T - 1200, true) === "start passed under a minute ago"
                && w.waitCountdownSay(5, NaN, null, false) === "" && w.waitDur(5400) === "1 h 30 min" && w.waitDur(5340) === "89 min",
          () => [c(T - 8040, T, false), c(T - 3600, T - 1200, true), c(T - 600, T - 1200, true), c(T + 720, T, false)].join(" | "));
  }

  // ── 15. a wait at home that is no wait, or too far ─────────────────────────────────────────────────────────────
  {
    const env = { S: { completion: "rth", home: at(-300, 0), home_source: null }, asv: at(-300, 0), surveys: [] };
    // eslint-disable-next-line no-new-func
    const w = new Function("env", "distTo", '"use strict";\n'
      + "const S = env.S; let asv = env.asv; const surveyById = (id) => env.surveys.find((s) => s.id === id) || null;\n"
      + "const surveyLabel = (s) => 'S' + s.no; const surgeWhen = () => 'Fri 13:05'; const fmtDist = (m) => Math.round(m / 1000) + ' km';\n"
      + "const roleSpeedMS = (r) => (r === 'transit' ? 4.0 : 2.0); const RTH_MAX_M = 50000;\n"
      + "const rthTooFar = (a, b) => { const m = distTo(a, b); return m > RTH_MAX_M ? {m} : null; };\n"
      + "const setMsNow = () => env.setMs || 0;\n" + decl(/^const WAIT_SET_FLOOR_MS = [^;]*;/m) + "\n"
      + grabs("surveyStartT", "waitFastMS", "waitHomeSplit") + "return { waitHomeSplit, set asv(v){ asv = v; } };")(env, G.distTo);
    const now = Date.now() / 1000, FIRST = at(2000, 0);
    const hold = { held: "S2", part: [{ ...at(500, 0), sv: "S1" }, { ...at(1500, 0), sv: "S1" }, { ...FIRST, sv: "S2" }] };
    const sv = (st, wait) => { env.surveys = [{ id: "S2", no: 2, wait, settings: st == null ? {} : { start_t: st } }]; };
    sv(now + 4 * 3600, "home"); const ok = w.waitHomeSplit(hold);
    sv(now + 4 * 3600); const loiter = w.waitHomeSplit(hold);
    sv(now + 1200, "home"); const noWait = w.waitHomeSplit(hold);                 // home 15 min off, the leave time before it
    sv(null, "home"); const noStart = w.waitHomeSplit(hold);
    // (the review) HOME AT THE SPEEDS SHE FLIES: S1's own leg at the survey speed (1000 m at 2 m/s), the rest and the way
    // home at the transit speed - she is home at +1150 s, not the +900 s the faster speed over all of it said; a start
    // the faster reckoning granted a wait at home for (+1650 s) is no wait
    sv(now + 1650, "home"); const slow = w.waitHomeSplit(hold);
    // ... and the LEAVE it is judged by is at her still-water FASTEST, the transit speed here (2300 m home to S2 at
    // 4 m/s: by +1525 s, a minute and more after she is home) - at the survey speed (+950 s) it would be no wait
    sv(now + 2100, "home"); const edge = w.waitHomeSplit(hold);
    // ... no wait, no wait at home: a start passed is said, not refused for a home there is no wait at; and with
    // nothing before the survey to send, End of plan is no part of it
    const homeWas = env.S.home; env.S.home = null; sv(now - 60, "home"); const passed = w.waitHomeSplit(hold); env.S.home = homeWas;
    env.S.completion = "loiter"; sv(now + 4 * 3600, "home");
    const bare = w.waitHomeSplit({ held: "S2", part: [{ ...FIRST, sv: "S2" }] }), endLoiter = w.waitHomeSplit(hold);
    env.S.completion = "rth";
    sv(now + 40 * 3600, "home");
    const farFirst = w.waitHomeSplit({ held: "S2", part: [{ ...at(500, 0), sv: "S1" }, { ...at(60000, 0), sv: "S2" }] });
    check("15. A WAIT AT HOME: the part ends before the survey (its first waypoint is not sent), with when she is home "
          + "and when she must leave; a survey not set to it is no home wait; one she would be home for no sooner than "
          + "she must leave is said and waits near its start instead; and a survey whose own start is past the range a "
          + "return is routed over is refused - Continue from home is an Upload from there",
          () => ok && ok.part.length === 2 && ok.first.lat === FIRST.lat && ok.leave < ok.start && ok.homeAt > now
                && Math.abs((ok.start - ok.leave) - 2300 / 5.0) < 2 && Math.abs(ok.homeAt - (now + 1150)) < 2
                && slow && !slow.part && /would be home no sooner than she must leave/.test(slow.said || "")
                && edge && Array.isArray(edge.part) && edge.part.length === 2 && !edge.said
                && passed && !passed.refuse && /its start Fri 13:05 has passed: she holds at its start/.test(passed.said || "")
                && bare && Array.isArray(bare.part) && bare.part.length === 0 && endLoiter && /End of plan is LOITER/.test(endLoiter.refuse || "")
                && loiter === null && noStart && /has no start time - there is nothing to wait for/.test(noStart.said || "")
                && noWait && !noWait.part && /Wait is HOME, but she would be home no sooner than she must leave/.test(noWait.said)
                && farFirst && /home is 60 km away - past the 50 km a return is routed over/.test(farFirst.refuse),
          () => JSON.stringify({ ok: ok && [ok.part.length, Math.round(ok.start - ok.leave)], loiter, noWait: noWait && noWait.said, far: farFirst && farFirst.refuse.slice(0, 90) }));
  }

  // ── 16. the tide question for a survey released from FAR ───────────────────────────────────────────────────────
  {
    const env = { low: 1.5, live: 0.2 };
    // eslint-disable-next-line no-new-func
    const w = new Function("env", "distTo", '"use strict";\n'
      + decl(/^const WATER_ETA_SLACK = [^;]*;/m) + "\n" + decl(/^const WATER_WINDOW_PAD_S = [^;]*;/m) + "\n"
      + decl(/^const WATER_WINDOW_MAX_H = [^;]*;/m) + "\n" + decl(/^const UPLOAD_EARLY_S = [^;]*;/m) + "\n"
      + decl(/^const WAIT_NOW_S = [^;]*;/m) + "\n" + decl(/^const TIDE_REBUILD_M = [^;]*;/m) + "\n"
      + "const WATER_REMOTE_KM = 75; let water = null; const sea = {get waterOffset(){ return env.live; }};\n"
      + "let mission = env.mission, asv = env.asv; const surgeWhen = () => 'Fri';\n"
      + "const setMsNow = () => env.setMs || 0;\n" + decl(/^const WAIT_SET_FLOOR_MS = [^;]*;/m) + "\n"
      + "const waitFastMS = () => 5;\n"
      + "const roleSpeedMS = (r) => (r === 'transit' ? 4.0 : 2.0); const fmtDist = (m) => Math.round(m) + ' m';\n"
      + "const lineOfLeg = () => true; const flightOwnM = (pts) => { let L = 0; for(let i = 1; i < pts.length; i++) L += distTo(pts[i-1], pts[i]); return L; };\n"
      + "const waterAlongRead = async () => (env.low == null ? {points: []} : {points: [{low_m: env.low, km: 3, kind: 'predicted', name: 'Stn'}]});\n"
      + grabs("surveyStartT", "sectionLevel", "fmtLevel", "flightWindow", "uploadTideRisk")
      + "return { uploadTideRisk, set asv(v){ asv = v; } };")(env, G.distTo);
    const wps = [{ ...at(0, 0), sv: "S2" }, { ...at(0, 400), sv: "S2" }, { ...at(0, 800), sv: "S3" }, { ...at(0, 1200), sv: "S3" }];
    env.mission = { surveys: [{ id: "S2", no: 2, water_m: 1.4, settings: {} }, { id: "S3", no: 3, water_m: 1.4, settings: {} }] };
    const mk = (asv) => { env.asv = asv; return new Function("return 0")(); };
    const FARPT = at(-12000, 0), NEARPT = at(-100, 0);            // 50 minutes off at 4 m/s; half a minute off
    const MIDPT = at(-4800, 0);                                    // 20 minutes off at 4 m/s (16 with the set): home, the ordinary case
    env.t0s = []; env.here = [];
    // (the water now a STATION's reading, trusted, and the prediction where she is now the same: no set-down)
    const STN = { ok: true, source: "station", offset_m: 0.2 }, LOCAL = { level: "local", stale: false };
    env.water = STN; env.trust = LOCAL; env.predNow = 0.2;
    const run = async (asv, rel, low) => { env.low = low; env.asv = asv; env.t0s.length = 0; env.here.length = 0;
      // eslint-disable-next-line no-new-func
      const ww = new Function("env", "distTo", '"use strict";\n'
        + decl(/^const WATER_ETA_SLACK = [^;]*;/m) + "\n" + decl(/^const WATER_WINDOW_PAD_S = [^;]*;/m) + "\n"
        + decl(/^const WATER_WINDOW_MAX_H = [^;]*;/m) + "\n" + decl(/^const UPLOAD_EARLY_S = [^;]*;/m) + "\n"
        + decl(/^const WAIT_NOW_S = [^;]*;/m) + "\n" + decl(/^const TIDE_REBUILD_M = [^;]*;/m) + "\n"
        + "const WATER_REMOTE_KM = 75; let water = env.water; const sea = {get waterOffset(){ return env.live; }};\n"
        + "const waterTrust = () => env.trust; " + decl(/^const PLANB_SLOT_S = [^;]*;/m) + "\n"
        + "const mission = env.mission, asv = env.asv; const surgeWhen = () => 'Fri';\n"
          + "const setMsNow = () => env.setMs || 0;\n" + decl(/^const WAIT_SET_FLOOR_MS = [^;]*;/m) + "\n"
        + "const roleSpeedMS = (r) => (r === 'transit' ? 4.0 : 2.0);\n" + grab("waitFastMS") + "\n"
        + "const fmtDist = (m) => Math.round(m) + ' m';\n"
        + "const lineOfLeg = () => true; const flightOwnM = (pts) => { let L = 0; for(let i = 1; i < pts.length; i++) L += distTo(pts[i-1], pts[i]); return L; };\n"
        // (one point and no survey: the prediction where she IS, now - set against the water now for a far release)
        + "const waterAlongRead = async (pts, t0, t1) => { if(pts.length === 1 && !pts[0].sv){ env.here.push([t0 - Date.now() / 1000, t1 - t0]);"
        + " return env.predNow == null ? {points: []} : {points: [{low_m: env.predNow, km: 2, kind: 'predicted', name: 'Here'}]}; }"
        + " if(pts[0].sv === 'S2') env.t0s.push(t0 - Date.now() / 1000); return (env.low == null ? {points: []} : {points: [{low_m: env.low, km: 3, kind: 'predicted', name: 'Stn'}]}); };\n"
        + grabs("surveyStartT", "sectionLevel", "fmtLevel", "flightWindow", "uploadTideRisk")
        + "return uploadTideRisk;")(env, G.distTo);
      return ww(wps, rel); };
    void w; void mk;
    const far = await run(FARPT, "S2", 1.5);        // released from far: its window holds its +1.40 m cut
    const farT0 = env.t0s[0];                       // (its window from her arrival at 4 m/s + a 1 m/s set: 2400 s, not 3000)
    env.setMs = 2.0; await run(FARPT, "S2", 1.5); const setT0 = env.t0s[0]; env.setMs = 0;   // (a 2 m/s set: 2000 s)
    const mid = await run(MIDPT, "S2", 1.5);        // (the review: 10-29 minutes off was judged at the water now, and asked)
    const plain = await run(FARPT, null, 1.5);      // not a release: the water now, as before
    const plainHere = env.here.length;              // (and no prediction read where she is for it)
    const near = await run(NEARPT, "S2", 1.5);      // released from near: she is there now - the water now
    const farLow = await run(FARPT, "S2", 1.0);     // released from far and its own window does NOT hold the cut: asked
    const farUnread = await run(FARPT, "S2", null); // ... and unread: the water now
    const ids = (r, k) => (r && r[k] ? r[k].map((x) => (x.s ? x.s.id : x)) : []).join("+");
    // (the second review) WHAT THE WATER NOW SAYS OF THE PREDICTION: the water now +0.20 m where the prediction there
    // says +0.60 m - a set-down the forecast does not hold - lowers the window's +1.50 m by 0.40 m, under the +1.40 m
    // cut: asked; 0.05 m under it lowers it to +1.45 m, still holding the cut; the prediction where she is read now, at
    // her own place, over one slot
    env.predNow = 0.6; const setDown = await run(FARPT, "S2", 1.5); const setDownHere = env.here.slice();
    const sdS2 = setDown && setDown.over ? setDown.over.find((g) => g.s.id === "S2") : null;
    env.predNow = 0.25; const small = await run(FARPT, "S2", 1.5);
    // ... and with the water now not a station's trusted reading (a remote or stale one, the manual level), or no
    // prediction read where she is, she is judged by the water now as every other survey is
    env.predNow = 0.2; env.trust = { level: "remote", stale: false }; const remote = await run(FARPT, "S2", 1.5);
    env.trust = { level: "local", stale: true }; const stale = await run(FARPT, "S2", 1.5); env.trust = LOCAL;
    env.water = { ok: true, source: "manual", offset_m: 0.2 }; const manual = await run(FARPT, "S2", 1.5); env.water = STN;
    env.predNow = null; const noHere = await run(FARPT, "S2", 1.5); env.predNow = 0.2;
    // ... the manual level near the cut (+1.35 m): every survey judged at it, none released far to be routed at its cut
    env.live = 1.35; env.water = { ok: true, source: "manual", offset_m: 1.35 }; const manualNear = await run(FARPT, "S2", 1.5);
    env.live = 0.2; env.water = STN;
    // ... and the water now ABOVE the prediction where she is never RAISES the window's low: +1.25 m under the cut is asked
    env.predNow = 0.0; const above = await run(FARPT, "S2", 1.25); env.predNow = 0.2;
    check("16. a survey Continue releases from FAR - she is more than WAIT_NOW_S from it, the water now under its cut on "
          + "the rising tide it waits for - is judged by the water of ITS OWN WINDOW: not asked about, and named `far` "
          + "so its legs are routed at its cut; every other survey sent, any survey not released, and one she is at now "
          + "are judged by the water now as before; a window that does not hold the cut, or was not read, still asks; "
          + "and the water now standing UNDER the prediction where she is (a station's trusted reading) lowers the "
          + "window's low by as much, while an untrusted or manual level, or no prediction read there, is judged as before",
          () => ids(far, "over") === "S3" && ids(far, "far") === "S2" && ids(mid, "over") === "S3" && ids(mid, "far") === "S2"
                && Math.abs(farT0 - 2400) < 2 && Math.abs(setT0 - 2000) < 2
                && ids(plain, "over") === "S2+S3" && ids(plain, "far") === ""
                && ids(near, "over") === "S2+S3" && ids(near, "far") === ""
                && ids(farLow, "over") === "S2+S3" && ids(farLow, "far") === ""
                && ids(farUnread, "over") === "S2+S3" && ids(farUnread, "far") === ""
                // (the second review: the water now under the prediction where she is lowers the window's low)
                && plainHere === 0 && setDownHere.length === 1 && Math.abs(setDownHere[0][0]) < 2 && setDownHere[0][1] === 360
                && ids(setDown, "over") === "S2+S3" && ids(setDown, "far") === "" && sdS2 && sdS2.low === 1.1
                && /less the 0\.40 m the water now stands under the prediction where she is$/.test(sdS2.say)
                && ids(small, "over") === "S3" && ids(small, "far") === "S2"
                && [remote, stale, manual, noHere].every((r) => ids(r, "over") === "S2+S3" && ids(r, "far") === "")
                && manualNear === null && ids(above, "over") === "S2+S3" && ids(above, "far") === "",
          () => JSON.stringify({ far: [ids(far, "over"), ids(far, "far")], mid: [ids(mid, "over"), ids(mid, "far")], farT0, setT0,
                                 setDown: [ids(setDown, "over"), sdS2 && sdS2.low, sdS2 && sdS2.say, setDownHere], small: [ids(small, "over"), ids(small, "far")],
                                 notTrusted: [remote, stale, manual, noHere].map((r) => ids(r, "over") + "/" + ids(r, "far")),
                                 plain: ids(plain, "over"), near: [ids(near, "over"), ids(near, "far")],
                                 farLow: [ids(farLow, "over"), ids(farLow, "far")], unread: ids(farUnread, "over") }));
  }

  // ── 17-18. THE WAIT'S CLOCK ────────────────────────────────────────────────────────────────────────────────────
  const tickWorld = (env) =>
    // eslint-disable-next-line no-new-func
    new Function("env", "distTo", "SV", '"use strict";\n'
      + "const Date = {now: () => env.now * 1000};\n"
      + "const {surveyStartIdx} = SV; let pendingHold = env.rec; const S = env.S; const mission = env.mission;\n"
      + "const canCommand = (s) => !!(s && s.armed && !s.estop); const roleSpeedMS = (r) => (r === 'transit' ? 4.0 : 2.0);\n"
      + "const surveyById = (id) => (mission.surveys || []).find((s) => s.id === id) || null; const surveyLabel = (s) => 'S' + s.no;\n"
      + "const surgeWhen = (t) => 'at ' + Math.round(t - env.t0);\n"
      + "const holdNextTick = () => { env.nexts++; }; let rthChainFailed = false; let pendingNext = null, continueHoldBusy = false;\n"
      + "const flashNote = (t) => env.notes.push(t); const asv = null;\n" + decl(/^const WAIT_AT_M = [^;]*;/m) + "\n"
      + "const setMsNow = () => env.setMs || 0;\n" + decl(/^const WAIT_SET_FLOOR_MS = [^;]*;/m) + "\n"
      + grab("waitFastMS") + "\n"
      + "const banner = env.banner; const $ = (q) => (q === '#encbanner' ? banner : null);\n"
      + "const sayUnlessAlarm = (t) => { env.said.push(t); if(env.alarm) return false; banner.textContent = t; banner.style.display = 'block'; return true; };\n"
      + "const logClient = (k, o) => env.logs.push([k, o]);\n"
      + decl(/^const WAIT_OPEN = [^;]*;/m) + "\n" + decl(/^let waitSaid = [^;]*;/m) + "\n"
      + grabs("heldSplitRun", "onSplitRun", "surveyStartT", "waitState", "waitLeaveT", "takeDownBanner", "waitSay", "waitAlertUp", "waitAlertDown", "waitTick")
      + "return { waitTick, set hold(v){ pendingHold = v; }, set failed(v){ rthChainFailed = v; }, set busy(v){ continueHoldBusy = v; },"
      + " set next(v){ pendingNext = v; } };")(env, G.distTo, SV);
  {
    const T0 = 1795200000, START = T0 + 3600;
    const mkEnv = (rec, o) => ({ now: T0, t0: T0, rec, nexts: 0, said: [], notes: [], logs: [], alarm: false, banner: { textContent: "", style: { display: "none" } },
      S: { home: at(-4000, 0), status: {} },
      mission: { waypoints: [{ ...at(0, 0), sv: "S2" }, { ...at(0, 300), sv: "S2" }], surveys: [{ id: "S2", no: 2, settings: { start_t: START } }] }, ...(o || {}) });
    const REC = { sv: "S2", mode: "loiter", p: at(100, 0), at: 7, boot: "b1", ahead: true };
    const FR = (o) => [{ run: "running", behavior: "survey", run_completion: "loiter", completion: "rth", armed: true, boot_id: "b1", ...o },
                       { holding: true, hold: at(100, 0) }];
    const env = mkEnv(REC), w = tickWorld(env);
    const leave = START - 100 / 5.0;
    env.now = leave - 30; w.waitTick(...FR());
    const before = env.said.length;
    env.now = leave + 1; w.waitTick(...FR());
    const first = env.said.slice(), logged = env.logs.length;
    w.waitTick(...FR());                                          // the same minute, its banner standing: nothing more
    const sameMin1 = env.said.length;
    env.now += 90; w.waitTick(...FR());                           // her start comes: what it says changed - said again
    const startCame = env.said.length, came = env.said[1] || "";
    env.now += 61; w.waitTick(...FR());                           // a later minute, still standing: nothing more
    const quiet = env.said.length;
    env.banner.textContent = "Chart-feature planning aid";        // covered by another banner
    env.now += 61; w.waitTick(...FR());
    const again = env.said.length, logsAfter = env.logs.length;
    w.waitTick(...FR());                                          // (the same minute: once)
    const once = env.said.length;
    const eS = mkEnv(REC), wS = tickWorld(eS); eS.now = START + 5; wS.waitTick(...FR()); const atStart = eS.said.slice();
    check("17. THE WAIT'S CLOCK: nothing before the leave time; at it ONE banner - her start has come, where she is, "
          + "press Continue, Upload reads the water again - and one log; said again when her start comes (what it says "
          + "changed); nothing more while it stands; said AGAIN the "
          + "next minute once another banner has covered it (the banner is one slot), not logged again; and a staged "
          + "upload's record is looked at on every frame",
          () => before === 0 && first.length === 1 && logged === 1
                && /^⏱ TIME TO LEAVE for S2 \(its start is at 3600, and she is at least 1 min from it\): she is holding where she waits for it\. Press Continue S2 ▶ on its row - Upload reads the water again then\.$/.test(first[0])
                && /^⏱ S2's START HAS COME \(at 3600\): she is holding where she waits for it\. Press Continue S2 ▶ on its row - Upload reads the water again then\.$/.test(atStart[0] || "")
                && env.logs[0][0] === "wait_open" && env.logs[0][1].sv === "S2" && env.logs[0][1].state === "point"
                && sameMin1 === 1 && startCame === 2 && /^⏱ S2's START HAS COME \(at 3600\)/.test(came)
                && quiet === 2 && again === 3 && logsAfter === 1 && once === 3 && env.nexts >= 7,
          () => JSON.stringify({ before, first, sameMin1, startCame, came, quiet, again, logs: env.logs.length, nexts: env.nexts }));
    // the cases that say nothing, and the words by where she is
    const silent = (rec, fo, eo) => { const e = mkEnv(rec, eo); const ww = tickWorld(e); e.now = START + 5; ww.waitTick(...FR(fo)); return e.said.length; };
    const sHeld = silent(REC, { supervisor_held: { paused: true } }), sBoot = silent(REC, { boot_id: "b2" });
    // (the latch outlives the pause - a Stop to refuel leaves it set: no longer silent then; and a wait AT HOME needs
    //  nothing aboard, so another link's boot does not silence it)
    const sLatch = silent(REC, { supervisor_held: { paused: false } });
    const sBootHome = silent({ sv: "S2", mode: "home", at: 9, boot: "b1", ahead: true }, { boot_id: "b2", behavior: "rth" });
    const sOld = silent({ ...REC, ahead: false }), sNoStart = silent(REC, {}, { mission: { waypoints: [], surveys: [{ id: "S2", no: 2, settings: {} }] } });
    const eA = mkEnv(REC); eA.alarm = true; const wA = tickWorld(eA); eA.now = START + 5; wA.waitTick(...FR());
    eA.now += 5; wA.waitTick(...FR()); const sameMin = eA.said.length; eA.now += 60; wA.waitTick(...FR());
    const eH = mkEnv({ sv: "S2", mode: "home", at: 9, boot: "b1", ahead: true }); const wH = tickWorld(eH);
    eH.now = START - 4000 / 5.0 + 5;                              // the leave time from home, the start still 13 min off
    wH.waitTick({ run: "running", behavior: "rth", run_completion: "loiter", completion: "rth", armed: true, boot_id: "b1" }, { holding: true, hold: at(-4000, 0) });
    const eW = mkEnv(REC); const wW = tickWorld(eW); eW.now = START + 5; wW.waitTick(...FR().map((x, i) => (i ? { holding: false } : x)));
    check("18. ... silent while the console holds her unwatched, for a record another link wrote, for one whose start was "
          + "not ahead when it was written, and with no start; under a guard alarm it is a note, tried again each minute; "
          + "at a wait AT HOME it is 'TIME TO LEAVE' with the start it is for; and on her way it says so, with Continue "
          + "closed",
          () => sHeld === 0 && sBoot === 0 && sOld === 0 && sNoStart === 0 && sLatch === 1 && sBootHome === 1
                && sameMin === 1 && eA.said.length === 2 && eA.banner.textContent === ""
                && /^⏱ TIME TO LEAVE for S2 \(its start is at 3600, and she is at least 14 min from it\): she is holding at home\. Press Continue S2 ▶/.test(eH.said[0] || "")
                // (closed: each state's own words name what opens it - no dangling "opens when she is")
                && /she is on her way to where she waits - Continue opens when she is holding there\.$/.test(eW.said[0] || ""),
          () => JSON.stringify({ sHeld, sBoot, sOld, sNoStart, alarm: [sameMin, eA.said.length], home: (eH.said[0] || "").slice(0, 80), way: (eW.said[0] || "").slice(-70) }));
    // a wait at home that is NOT coming: she holds at the end of what was sent and the chain failed, or End of plan moved
    const eF = mkEnv({ sv: "S2", mode: "home", at: 11, boot: "b1", ahead: true }); const wF = tickWorld(eF);
    eF.now = T0 + 10;
    const END = [{ run: "running", behavior: "survey", run_completion: "rth", completion: "rth", armed: true, boot_id: "b1" }, { holding: true, hold: at(-200, 0) }];
    wF.waitTick(...END); const quietF = eF.said.length;
    wF.failed = true; wF.waitTick(...END); wF.waitTick(...END);
    const eL = mkEnv({ sv: "S2", mode: "home", at: 12, boot: "b1", ahead: true }); const wL = tickWorld(eL); eL.now = T0 + 10;
    wL.waitTick({ ...END[0], completion: "loiter" }, END[1]);
    check("18b. A WAIT AT HOME THAT IS NOT COMING is said, once: she holds at the end of what was sent and the return was "
          + "refused, or End of plan is no longer RTH - with what to press; while the return is still coming, nothing",
          // (once: not a note each frame either - its own words hold "refused", so a second saying became a note)
          () => quietF === 0 && eF.said.length === 1 && eF.notes.length === 0 && /S2 WAS TO WAIT AT HOME, and she is holding at the end of what was sent: the return home was not sent \(refused, or withdrawn\)\. Press RTH/.test(eF.said[0])
                && eL.said.length === 1 && /End of plan is LOITER now/.test(eL.said[0]),
          () => JSON.stringify({ quietF, failed: eF.said, moved: eL.said }));
  }

  // ── 19. CONTINUE ───────────────────────────────────────────────────────────────────────────────────────────────
  {
    const mk = (rec, S0) => {
      const env = { now: 1795200000000, pend: [], rec, S: S0, uploads: [], starts: 0, asked: [], notes: [], logs: [], answer: true, takes: true, short: null, gate: null,
                    mission: { breaks: [], waypoints: [], surveys: [{ id: "S2", no: 2, settings: { start_t: 1795200000 } }] } };
      // eslint-disable-next-line no-new-func
      env.w = new Function("env", '"use strict";\n'
        + "let pendingHold = env.rec, pendingNext = null; const S = env.S; const mission = env.mission;\n"
        + "const surveyById = (id) => mission.surveys.find((s) => s.id === id) || null; const surveyLabel = (s) => 'S' + s.no;\n"
        + "const canCommand = (s) => !!(s && s.armed && !s.estop); const flashNote = (t) => env.notes.push(t);\n"
        // (each of Continue's waits records whether the guard's re-approach is stood down DURING it)
        + "const guiConfirm = async (t, m, o) => { env.asked.push({t, m, o}); env.pend.push(['ask', continueStartPending()]);"
        + " return t === 'Start the autonomous survey' && env.startAnswer !== undefined ? env.startAnswer : env.answer; };\n"
        + "const doUpload = async (o) => { env.uploads.push(o); env.pend.push(['upload', continueStartPending()]); if(env.gate) await env.gate; if(env.takes && env.bank) pendingNext = env.bank; return env.takes; };\n"
        // (Start's own last word, asked after its question: replaced while it stood, the bank is gone - env.replace)
        + "const startRun = async (o) => { env.starts++; env.confirmed = !!(o && o.confirmed); env.pend.push(['start', continueStartPending()]); if(env.startGate) await env.startGate; if(env.replace) pendingNext = null; env.gone = o && typeof o.stillStaged === 'function' ? o.stillStaged() : 'NO CHECK'; };\n"
        + "const logClient = (k, o) => env.logs.push([k, o, env.uploads.length]);\n"
        + "const waitFuelShort = () => env.short; const fuelFmt = (m, x) => x + ' L';\n"
        + "const Date = {now: () => env.now};\n"
        + decl(/^let continueHoldBusy = [^;]*;/m) + "\n" + decl(/^const CONTINUE_START_GRACE_MS = [^;]*;/m) + "\n"
        + decl(/^let continueStagedAt = [^;]*;/m) + "\n"
        + grabs("heldSplitRun", "onSplitRun", "surveyStartT", "waitState", "continueAsk", "continueHold", "continueStartPending")
        + "return { continueHold, continueStartPending, get busy(){ return continueHoldBusy; } };")(env);
      return env;
    };
    const HOME = { sv: "S2", mode: "home", at: 1 };
    const idle = mk(HOME, { run: "idle", armed: true, status: {} });
    await idle.w.continueHold("S2");
    const dis = mk(HOME, { run: "idle", armed: false, status: {} });
    await dis.w.continueHold("S2");
    // the fuel question, asked always; No sends nothing
    const fuel = mk(HOME, { run: "running", behavior: "rth", armed: true, status: { holding: true } });
    fuel.short = { level: 40, want: 95, model: {} }; fuel.answer = false;
    await fuel.w.continueHold("S2");
    const refusedN = fuel.uploads.length, q = fuel.asked[0] || {};
    fuel.answer = true; await fuel.w.continueHold("S2");
    // a break-off of ANOTHER survey is named
    const brk = mk(HOME, { run: "running", behavior: "rth", armed: true, status: { holding: true } });
    brk.mission.breaks = [{ sv: "S1", name: "S1 North" }, { sv: "S2", name: "S2" }];
    await brk.w.continueHold("S2");
    const own = mk(HOME, { run: "running", behavior: "rth", armed: true, status: { holding: true } });
    own.mission.breaks = [{ sv: "S2", name: "S2" }];
    await own.w.continueHold("S2");
    // busy: a second press while the first is between its Upload and its Start does nothing
    const busy = mk({ sv: "S2", mode: "loiter", at: 2 }, { run: "running", behavior: "survey", run_completion: "loiter", completion: "rth", armed: true, status: { holding: true } });
    let open; busy.gate = new Promise((r) => { open = r; });
    const p1 = busy.w.continueHold("S2");
    await Promise.resolve(); await Promise.resolve();
    const during = busy.w.busy; await busy.w.continueHold("S2");
    const second = busy.uploads.length;
    open(); await p1;
    // THE RE-APPROACH'S STAND-DOWN (the phase 4 review): not through the fuel question or the Upload - a boat set beyond
    // her disc waited with the way off for as long as a dialog stood - only from the upload TAKEN until Start answers,
    // and no longer than the grace
    const sd = mk(HOME, { run: "running", behavior: "rth", armed: true, status: { holding: true } });
    sd.short = { level: 40, want: 95, model: {} };
    let go; sd.startGate = new Promise((r) => { go = r; });
    const p2 = sd.w.continueHold("S2");
    for (let i = 0; i < 6; i++) await Promise.resolve();
    const inStart = sd.w.continueStartPending(), busyThen = sd.w.busy;
    sd.now += 20001; const lapsed = sd.w.continueStartPending();
    go(); await p2;
    const afterStart = sd.w.continueStartPending();
    // (... and Start answering WITHIN the grace ends it: left up, a re-approach after a quick Start stood down for 20 s)
    const quick = mk(HOME, { run: "running", behavior: "rth", armed: true, status: { holding: true } });
    await quick.w.continueHold("S2");
    const quickAfter = quick.w.continueStartPending(), quickPend = JSON.stringify(quick.pend);
    // (the review) PAST THE GRACE her way back onto station may replace the plan staged for Continue while Start is
    // asked: Start sends nothing then, and says so; its own plan still staged, or taken at once, it starts
    const stg = (replace) => { const e = mk(HOME, { run: "running", behavior: "rth", armed: true, status: { holding: true } });
      e.bank = { rec: HOME, n: 3, seq: 1 }; e.replace = replace; return e; };
    const kept = stg(false), lost = stg(true);
    await kept.w.continueHold("S2"); await lost.w.continueHold("S2");
    const notTaken = mk(HOME, { run: "running", behavior: "rth", armed: true, status: { holding: true } }); notTaken.takes = false;
    await notTaken.w.continueHold("S2");
    // (the second review) START'S OWN QUESTION BEFORE ANYTHING IS STAGED, in startRun's own words, and a No to it sends
    // nothing; the Start then goes out confirmed (startRun does not ask it again)
    const startNo = mk(HOME, { run: "idle", armed: true, status: {} }); startNo.startAnswer = false; await startNo.w.continueHold("S2");
    const sqOf = (src) => { const m = src.match(/guiConfirm\("Start the autonomous survey",\s*"([^"]+)"\)/); return m ? m[1] : null; };
    const sqHold = sqOf(grab("continueHold")), sqRun = sqOf(grab("startRun"));
    // an upload not taken starts nothing; another survey's row is not this hold's
    const no = mk(HOME, { run: "idle", armed: true, status: {} }); no.takes = false; await no.w.continueHold("S2");
    const other = mk({ sv: "S3", mode: "home", at: 1 }, { run: "idle", armed: true, status: {} }); await other.w.continueHold("S2");
    check("19. CONTINUE is open by where she is: from a boat STOPPED at home (or never left the dock) it uploads from the "
          + "survey RELEASING its hold and starts it; disarmed it says why and sends nothing; short of fuel for its "
          + "flight and the way home it ASKS first (always), and a No sends nothing; a break-off banked for another "
          + "survey is named in the question; a second press while the first is between its Upload and its Start does "
          + "nothing; an upload not taken starts nothing; the wait is logged after the upload; and Start's own question, "
          + "in startRun's words, is asked BEFORE the upload (a No sends nothing), the Start then sent confirmed - so the "
          + "re-approach stands down for the Start's post, never a dialog",
          () => idle.uploads.length === 1 && idle.uploads[0].fromSv === "S2" && idle.uploads[0].release === "S2" && idle.starts === 1
                && idle.logs.length === 1 && idle.logs[0][0] === "wait_continue" && idle.logs[0][1].mode === "home" && idle.logs[0][2] === 1
                && dis.uploads.length === 0 && /she cannot be commanded from here/.test(dis.notes[0] || "")
                && refusedN === 0 && q.o && q.o.always === true && /FUEL: 40 L aboard; the way out to it, its flight and the way home from there want 95 L with the reserve/.test(q.m)
                // (the regression review: after a low-fuel return she may be under her RTH point already - the monitor
                //  turns her for home as she leaves, not "when she reaches" it)
                && /Continue anyway and the low-fuel monitor turns her for home when what is aboard reaches her RTH point - as she leaves, if it already has\. Continue S2\?$/.test(q.m)
                && fuel.uploads.length === 1 && fuel.starts === 1
                && /S1 North was broken off and is banked: its Continue is beside Start\. This Continue flies S2 and leaves that one banked\./.test((brk.asked[0] || {}).m || "")
                && own.asked.length === 1 && own.asked[0].t === "Start the autonomous survey" && own.uploads.length === 1
                && JSON.stringify(sd.pend) === '[["ask",false],["ask",false],["upload",false],["start",true]]' && inStart === true && busyThen === true
                && lapsed === false && afterStart === false && notTaken.w.continueStartPending() === false
                && quickAfter === false && quickPend === '[["ask",false],["upload",false],["start",true]]'
                && idle.confirmed === true && startNo.asked.length === 1 && startNo.uploads.length === 0 && startNo.starts === 0
                && !!sqHold && sqHold === sqRun
                && kept.gone === null && quick.gone === null && lost.starts === 1
                && /^⚠ CONTINUE S2: the plan it staged is no longer aboard - her way back onto station \(the guard's re-approach\) or another upload replaced it while Start was asked\. NOTHING WAS STARTED/.test(lost.gone || "")
                && during === true && second === 1 && busy.uploads.length === 1 && busy.starts === 1 && busy.w.busy === false
                && no.uploads.length === 1 && no.starts === 0 && no.logs.length === 0
                && other.uploads.length === 0 && /not waiting for S2/.test(other.notes[0] || ""),
          () => JSON.stringify({ idle: [idle.uploads.length, idle.starts, idle.logs.length], dis: dis.notes[0], fuel: [refusedN, fuel.uploads.length],
                                 brk: (brk.asked[0] || {}).m, busy: [during, second, busy.starts], no: [no.starts], other: other.notes[0] }));
  }

  // ── 20. the fuel words, on the real fuel.js ────────────────────────────────────────────────────────────────────
  {
    const vessel = JSON.parse(fs.readFileSync(path.join(APP, "vessels", "drix08.json"), "utf8"));
    const kn = vessel.propulsion.speeds_kn, model = FUEL.energyModel(vessel, kn.high);
    const env = { SV, S: { status: { fuel_l: model.full } }, home: { need: 6, water: true },
                  mission: { waypoints: [{ ...at(0, 0), sv: "S1" }, { ...at(0, 2000), sv: "S1" }, { ...at(3000, 0), sv: "S2" }, { ...at(3000, 20000), sv: "S2" }] } };
    // eslint-disable-next-line no-new-func
    const w = new Function("env", "FUEL", "model", "kn", '"use strict";\n'
      + "const {energyLevel, rthLevel, pathEnergy} = FUEL; const S = env.S; const mission = env.mission; const asv = {lat: " + O.lat + ", lon: " + O.lon + "};\n"
      + "const fuelModel = () => model; const V = {SPEED_KN: kn}; const roleSpeed = (r) => (r === 'transit' ? 'high' : r === 'hold' ? 'low' : 'survey');\n"
      + "const fuelHomeNeed = () => env.home; const fuelFmt = (m, x) => x.toFixed(1) + ' L';\n"
      + "const surveyById = (id) => (mission.surveys || []).find((s) => s.id === id) || null;\n"
      // (what Continue sends: from the survey on, up to the next held survey - the page's own two, from surveys.js)
      + "const {waypointsFrom, splitAtHold} = env.SV;\n"
      + grabs("surveyFlightEnergy", "continueSendEnergy", "waitFuelShort", "waitFuelSay")
      + "return { surveyFlightEnergy, continueSendEnergy, waitFuelShort, waitFuelSay };")(env, FUEL, model, kn);
    const wait = { arrive: 1000, start: 1000 + 6 * 3600 }, hold = { held: "S2" }, wps = [env.mission.waypoints[0], env.mission.waypoints[1], { ...at(2900, 0), sv: "S2" }];
    const flight = w.surveyFlightEnergy(model, "S2");
    const plenty = w.waitFuelSay(hold, wait, null, wps), okShort = w.waitFuelShort("S2");
    // the wait's own burn: six hours at the hold role's rate, said with the idle figure beside it
    const keep = model.rateAt(kn.low) * 6, idle = model.rateAt(0) * 6;
    const leg = (a, b, k) => FUEL.pathEnergy(model, [a, b], k, { e: 0, n: 0 }) || 0;
    const part = leg(O, wps[0], kn.high) + leg(wps[0], wps[1], kn.survey) + leg(wps[1], wps[2], kn.high);
    const want = FUEL.rthLevel(model, part + keep + flight.e + 6);
    env.S.status = { fuel_l: 30 };
    const low = w.waitFuelSay(hold, wait, null, wps), lowShort = w.waitFuelShort("S2");
    env.S.status = { unlimited_energy: true, fuel_l: 30 };
    const none = w.waitFuelSay(hold, wait, null, wps), noneShort = w.waitFuelShort("S2");
    env.S.status = { fuel_l: 30 }; env.home = { need: 6, water: false };
    const line = w.waitFuelSay(hold, wait, null, wps);
    // (a survey whose Wait IS home, sent to loiter: not told to set it to HOME)
    env.mission.surveys = [{ id: "S2", no: 2, wait: "home" }]; const lowHome = w.waitFuelSay(hold, wait, null, wps); delete env.mission.surveys;
    // (the review) CONTINUE'S OWN TEST counts the way OUT to it - from where she is to its first waypoint at the
    // transit speed - and what it sends: S2 on to a HELD S3 stops at S3's start, and home is reckoned from there
    const outE = leg(O, env.mission.waypoints[2], kn.high);
    env.mission.waypoints.push({ ...at(3000, 20500), sv: "S3" }, { ...at(3000, 21000), sv: "S3" });
    env.mission.surveys = [{ id: "S3", no: 3, hold: true }];
    const sent = w.continueSendEnergy(model, "S2"), heldShort = w.waitFuelShort("S2");
    env.mission.waypoints.splice(4); delete env.mission.surveys;
    env.home = null; const noHome = w.waitFuelSay(hold, wait, null, wps), noHomeShort = w.waitFuelShort("S2");
    const homeMode = w.waitFuelSay(hold, null, { part: [] }, []);
    check("20. THE SUGGESTION, once at Upload: with a full tank a six-hour wait, the survey and the way home leave the "
          + "reserve, and it says so; with 30 L it says LOITERING is short - the wait at the HOLD speed's burn with the "
          + "idle figure beside it, what is wanted aboard, what she has - and to set Wait to HOME; with no level (the "
          + "override) or no way home reckoned it is the operator's call, said; a straight-line way home is said; a wait "
          + "at home says to refuel there; and Continue's own test is the survey's flight and the way home",
          () => flight.e > 0 && flight.last.lat === env.mission.waypoints[3].lat
                && /^ Fuel: enough aboard to wait the 6\.0 h, fly it and come home with the reserve\.$/.test(plenty) && okShort === null
                && low.includes("⚠ FUEL: the 6.0 h wait (" + keep.toFixed(1) + " L keeping station; " + idle.toFixed(1) + " L at idle)")
                && /she has 30\.0 L\. Set its row's Wait to HOME to refuel while she waits\.$/.test(low) && keep > idle
                && part > 0 && low.includes(", want " + want.toFixed(1) + " L aboard with the reserve - she has")
                && lowShort && lowShort.level === 30 && outE > 0 && Math.abs(lowShort.want - (FUEL.rthLevel(model, outE + flight.e + 6))) < 1e-9
                && lowShort.held === null && sent.held === "S3" && sent.last.sv === "S3" && heldShort && heldShort.held === "S3"
                && Math.abs(sent.e - (outE + flight.e + leg(env.mission.waypoints[3], at(3000, 20500), kn.high))) < 1e-9
                && /she has 30\.0 L\. Its Wait is HOME, but this Upload could not wait there \(said above\)\.$/.test(lowHome)
                && !/Set its row's Wait to HOME/.test(lowHome)
                && /Fuel is not read here \(no level, or the override\): loiter or home is your call\./.test(none) && noneShort === null
                && /the way home reckoned as a straight line/.test(line)
                && /the way home from its end could not be reckoned - loiter or home is your call/.test(noHome) && noHomeShort === null
                && /^ Refuel her at home; Continue asks if what is aboard does not cover the way out, its flight and the way home\.$/.test(homeMode),
          () => JSON.stringify({ flight: +flight.e.toFixed(2), plenty, low: low.slice(0, 120), none, noHome, keep: +keep.toFixed(1), idle: +idle.toFixed(1) }));
  }

  // ── 21. THE WIRING ─────────────────────────────────────────────────────────────────────────────────────────────
  {
    const up = grab("doUpload"), on = grab("onState"), rs = grab("renderSurveyTable"), re = grab("reapproachIfSetOff");
    const cm = grab("commitPattern"), ds = grab("deleteSurvey");
    const iHome = up.indexOf("if(home && !home.part.length){ waitHomeNothing(home); render(); return; }");
    const iBare = up.indexOf('const r = await cmd("/api/cmd/upload");');
    check("21. THE WIRING: Upload decides a wait at home BEFORE its bare post (which would load the whole saved plan), and "
          + "both of its posts ask the loiter only for a hold she is to wait at; a wait point's disc is the one it was "
          + "found with; every taken upload goes through the one writer of the record; a release from far routes its "
          + "survey at its cut; the frame runs the wait's clock, caught; the row has the Wait button, the countdown's "
          + "line and the flashing Continue with a style rule of its own; an edit keeps how a survey waits; a deleted "
          + "survey's staged record goes; the re-approach finds a wait point as it was found, stands down for a "
          + "Continue, and the record follows it; the server types `wait`",
          () => iHome > 0 && iBare > iHome
                && (up.match(/\.\.\.\(loiter \? \{completion: "loiter"\} : \{\}\)/g) || []).length === 2 && !/\.\.\.\(hold \? \{completion/.test(up)
                && /hold_clear_m: wait && wait\.to \? waitDisc\(wait\) : holdClearAt\(plan\.route\[plan\.route\.length-1\]\),/.test(up)
                && (up.match(/holdRecordTaken\(holdRec\(hold, home, /g) || []).length === 2 && !/setPendingHold\(/.test(up)
                && /const tide = await uploadTideRisk\(wps, release\);\s*\n\s*if\(tide && tide\.over\.length\)\{/.test(up)
                && /const farCard = farSv \? \{sv: farSv, m: surveyCutM\(surveyById\(farSv\)\), waits: true\} : undefined;/.test(up)
                && /lk = surveyLegKos\(wps, farCard\);/.test(up)
                && /try\{ waitTick\(s, st\); \}catch\(e\)\{ if\(!waitErrSaid\)\{ waitErrSaid = true;/.test(on)
                && /id="svr\$\{i\}_wait" data-act="wait"/.test(rs) && /id="svr\$\{i\}_cd"/.test(rs)
                && /class="ctl small svcont\$\{there && due \? " flash" : ""\}"/.test(rs)
                && /if\(key === _svTableKey\)\{ waitCountdownWrite\(rows\); return; \}/.test(rs)
                // (the review: Continue's Start asks Continue's own last word AFTER its question, and sends nothing on it)
                && ((sr) => { const q = sr.indexOf('guiConfirm("Start the autonomous survey"'), g = sr.indexOf("const gone = opts && typeof opts.stillStaged === \"function\" ? opts.stillStaged() : null;"),
                              p = sr.indexOf('cmd("/api/cmd/start"');
                              return q > 0 && g > q && p > g && /if\(gone\)\{ showBanner\(gone\); flashNote\([^)]*\); return false; \}/.test(sr); })(grab("startRun"))
                && /#sv_table \.svcont\.flash\{animation:cbtnFlash/.test(H) && /else if\(act === "wait"\) toggleSurveyWait\(id\);/.test(H)
                && /\.\.\.\(editing && editing\.wait === "home" \? \{wait: "home"\} : \{\}\),/.test(cm)
                && /if\(pendingNext && pendingNext\.rec && pendingNext\.rec\.sv === id\) setPendingNext\(\{\.\.\.pendingNext, rec: null\}\);/.test(ds)
                && /if\(continueStartPending\(\)\) return;/.test(re) && !/continueHoldBusy/.test(re)
                && /let wr = wrec \? waitPointAt\(st\.hold, Math\.min\(wrec\.level_m, sea\.waterOffset \|\| 0\), \{deepOnly: !!wrec\.unread, polys: contacts\}\) : null;/.test(re)
                // (she is on the split's run - with End of plan LOITER too; and the record follows wherever the way back ends)
                && /&& onSplitRun\(s\) && distTo\(st\.hold, pendingHold\.p\) <= 1 \? pendingHold : null;/.test(re) && !/heldSplitRun/.test(re.slice(re.indexOf("const hrec")))
                && /const backEnd = plan\.route\[plan\.route\.length - 1\];\s*\n\s*if\(hrec && pendingHold === hrec && backEnd\) setPendingHold\(\{\.\.\.hrec, p: \{lat: backEnd\.lat, lon: backEnd\.lon\}\}\);/.test(re)
                && /let plan = leg\(wr && wr\.to \? wr\.to : \{lat:st\.hold\.lat, lon:st\.hold\.lon\}, !!\(wr && wr\.to\)\);/.test(re)
                && /if\(plan\.error && wr && wr\.to\)\{ lostFly = planWhy\(plan\); wr = null; plan = leg\(\{lat:st\.hold\.lat, lon:st\.hold\.lon\}, false\); \}/.test(re)
                && /window\.addEventListener\("storage", e => \{\s*\n\s*if\(!e \|\| \(e\.key !== PENDING_HOLD_KEY && e\.key !== PENDING_NEXT_KEY\)\) return;/.test(H)
                && /if s\.get\("wait"\) is not None and s\.get\("wait"\) not in \("loiter", "home"\):/.test(PY),
          () => "home return at " + iHome + ", bare post at " + iBare);
  }

  // ── 22. the wait point on the chart ────────────────────────────────────────────────────────────────────────────
  {
    const env = { hold: null, next: null };
    // eslint-disable-next-line no-new-func
    const w = new Function("env", "distTo", "SV", '"use strict";' + "const {surveyStartIdx} = SV;"
      + "const mission = env.mission; const surveyById = (id) => mission.surveys.find((s) => s.id === id) || null;"
      + "const surveyLabel = (s) => 'S' + s.no; let pendingHold = null, pendingNext = null;"
      + grab("waitPointMark") + "return { mark: (h, n) => { pendingHold = h; pendingNext = n; return waitPointMark(); } };");
    const FIRST = at(0, 0), W = at(180, 40), W2 = at(-90, 10);
    env.mission = { waypoints: [{ ...at(-400, 0), sv: "S1" }, { ...FIRST, sv: "S2" }, { ...at(0, 300), sv: "S2" }], surveys: [{ id: "S1", no: 1 }, { id: "S2", no: 2 }] };
    const ww = w(env, G.distTo, SV);
    const moved = ww.mark({ sv: "S2", mode: "loiter", p: W }, null);
    const atStart = ww.mark({ sv: "S2", mode: "loiter", p: FIRST }, null);
    const home = ww.mark({ sv: "S2", mode: "home" }, null), old = ww.mark({ sv: "S2" }, null);
    const staged = ww.mark({ sv: "S1", mode: "loiter", p: W }, { rec: { sv: "S2", mode: "loiter", p: W2 }, n: 4 });
    const stagedNone = ww.mark({ sv: "S2", mode: "loiter", p: W }, { rec: null, n: 4 });
    const gone = ww.mark({ sv: "S9", mode: "loiter", p: W }, null);
    check("22. THE WAIT POINT IS DRAWN: ringed and named '<survey> waits here' where the hold aboard - or an upload "
          + "staged for Start, first - waits somewhere other than the survey's own first waypoint; nothing at the start "
          + "itself, for a wait at home, for a record with no point or a survey no longer in the plan; the chart draws "
          + "it with its other marks, and a cleared plan drops a staged record with the hold's",
          () => moved && moved.label === "S2 waits here" && moved.p.lat === W.lat && moved.p.lon === W.lon
                && atStart === null && home === null && old === null && gone === null
                && staged && staged.label === "S2 waits here" && staged.p.lat === W2.lat
                && stagedNone && stagedNone.p.lat === W.lat
                && H.includes("  drawGotoTarget(toScreen);" + String.fromCharCode(10) + "  drawWaitPoint(toScreen);" + String.fromCharCode(10))
                && grab("drawWaitPoint").includes("const m = waitPointMark(); if(!m) return;")
                && grab("clearPlan").includes("setPendingHold(null); setPendingNext(null);"),
          () => JSON.stringify({ moved: moved && moved.label, atStart, home, old, gone, staged: staged && staged.label }));
  }

  // ── 24. THE DISC A RE-UPLOADED TAIL SHIPS WITH ─────────────────────────────────────────────────────────────────
  {
    const W = at(180, 40), FIRST = at(0, 0), env = { live: 48.8, water: 0.78, asked: [], point: null, boom: false };
    // eslint-disable-next-line no-new-func
    const w = new Function("env", "distTo", "SV", '"use strict";' + "const {surveyStartIdx} = SV; let pendingHold = null;"
      + "const mission = {waypoints: [], surveys: []}; const sea = {get waterOffset(){ return env.water; }};"
      + "const holdClearAt = (ll) => (ll ? env.live : null); const holdRadiusM = () => 2;"
      + "const waitPointAt = (c, lv) => { env.asked.push([c.lat, c.lon, lv]); if(env.boom) throw new Error('x'); return env.point; };"
      + grabs("tailEndsAtHold", "tailHoldClear")
      + "return { tailHoldClear, set hold(v){ pendingHold = v; } };")(env, G.distTo, SV);
    const tail = [at(-80, 0), W], REC = { sv: "S2", mode: "loiter", p: W, level_m: 0.29 };
    w.hold = REC; env.point = { to: W, movedM: 0, holdClear: 20.5 };
    const atWait = w.tailHoldClear(tail), asked = env.asked.slice();
    env.water = 0.1; env.asked.length = 0; w.tailHoldClear(tail); const lowNow = env.asked[0] && env.asked[0][2]; env.water = 0.78;
    env.point = { to: W, movedM: 0, holdClear: 60 }; const wider = w.tailHoldClear(tail);          // never wider than the water now
    env.point = { to: at(200, 40), movedM: 20, holdClear: 30 }; const moved = w.tailHoldClear(tail);  // it no longer passes there
    env.point = { error: "nowhere" }; const none = w.tailHoldClear(tail);
    env.boom = true; const threw = w.tailHoldClear(tail); env.boom = false;
    env.point = { to: W, movedM: 0, holdClear: 20.5 }; env.asked.length = 0;
    const elsewhere = w.tailHoldClear([at(-80, 0), FIRST]);                                         // an end that is no wait point
    w.hold = { sv: "S2", mode: "loiter", p: W }; const noLevel = w.tailHoldClear(tail);            // a hold at the start itself
    w.hold = { sv: "S2", mode: "home" }; const home = w.tailHoldClear(tail);
    w.hold = null; const noRec = w.tailHoldClear(tail), unasked = env.asked.length, empty = w.tailHoldClear([]);
    const sites = ["continueSurvey", "reflyStrike", "resumeHeldRun"].map((f) => grab(f));
    check("24. THE DISC A RE-UPLOADED TAIL SHIPS WITH (found on the lab: the guard routed her round a shoal on the way to "
          + "a wait point found with 20.5 m at the wait's low, and the tail went up with the live water's 48.8 m): where "
          + "it ends at the wait point of the hold aboard, the disc the point is found with again at the LOWER of the "
          + "record's level and the water now - never wider than the water now gives; where the point no longer passes, "
          + "or none is found, no more than her hold radius (beyond it she asks for a routed way back); any other end, a "
          + "hold with no level, a wait at home, no record or an error: the live disc, as it was; and the three tails - a "
          + "break-off's Continue, a strike's re-fly, a guard-held resume - all ask it",
          () => atWait === 20.5 && asked.length === 1 && asked[0][0] === W.lat && asked[0][2] === 0.29 && lowNow === 0.1
                && wider === 48.8 && moved === 2 && none === 2 && threw === 48.8
                && elsewhere === 48.8 && noLevel === 48.8 && home === 48.8 && noRec === 48.8 && unasked === 0 && empty === null
                && sites.every((f) => /hold_clear_m: tailHoldClear\((route|tail)\),\s*\n\s*\.\.\.\(tailEndsAtHold\((route|tail)\) \? \{completion: "loiter"\} : \{\}\)\}\);/.test(f)
                                      && !/hold_clear_m: holdClearAt\((route|tail)\[/.test(f)),
          () => JSON.stringify({ atWait, asked, lowNow, wider, moved, none, threw, elsewhere, noLevel, home, noRec, unasked, empty }));
  }

  // ── 25-27. THE REVIEW BEFORE THE MERGE: the wait point (run by the reviewer on the real modules) ─────────────────
  const landEN = (x0, x1, y0, y1) => ({ role: "land", cls: "Land_Area", props: {}, geometry: { type: "Polygon", coordinates: [ringLL(x0, x1, y0, y1)] } });
  const buoy = (x, y, catlam, name) => { const q = at(x, y);
    return { role: "chan_mark", cls: "Buoy_Lateral_point", props: { CATLAM: catlam, OBJNAM: name }, geometry: { type: "Point", coordinates: [q.lon, q.lat] } }; };
  {
    // a coastal chart: ONE band from the shoreline out, 0-18.2 m - legal at the floor by its deepest value, and wider
    // than the 10 m past which deep water first leaves a band to its soundings (none here)
    const COAST = () => [landEN(-900, -40, -900, 900), area(-40, 900, -900, 900, 0, 18.2)];
    const c = ask({ feats: COAST() }, 0), cOnly = ask({ feats: COAST() }, 0, { deepOnly: true }), cLow = ask({ feats: COAST() }, -0.5);
    const routing = K.deepKeepouts(FRAME, COAST(), OPTS(0)).polys.length;                       // (a route's layer: as it was)
    const every = K.deepKeepouts(FRAME, COAST(), { ...OPTS(0), bandMaxM: Infinity }).polys.length;
    const fine = ask({ feats: [landEN(-900, -40, -900, 900), area(-40, 900, -900, 900, 12, 30)] }, 0);   // a deep coarse band holds her
    check("25. A COARSE DEPTH BAND IS COUNTED BY ITS SHALLOWEST DEPTH (the review, safety): on a coastal chart's one "
          + "0-18.2 m band from the shoreline out, a start 40 m off the shore was its own wait point on BOTH tiers, 'in "
          + "water with deep water first's margin' - now every tier refuses it, at any level, with the level unread too; "
          + "a route's own layer still leaves such a band to its soundings (deepKeepouts' default); a coarse band deep "
          + "at its shallowest holds her",
          () => !c.to && /nowhere within 500 m/.test(c.error || "") && !cOnly.to && !cLow.to
                && routing === 0 && every === 1 && fine.to && fine.tier === "deep",
          () => JSON.stringify({ coarse: c.error || [c.tier, c.e], only: cOnly.error || cOnly.tier, routing, every, fine: [fine.tier, fine.movedM] }));
  }
  {
    // a channel marked by buoy pairs alone (no charted fairway): 120 m across, a pair every 800 m, deep water all round
    const feats = [area(-2000, 2000, -3000, 3000, 20, 30)];
    let n = 1;
    for (const y of [-1200, -400, 400, 1200]) { feats.push(buoy(-60, y, 1, "Test River Buoy " + n++)); feats.push(buoy(60, y, 2, "Test River Buoy " + n++)); }
    const box6 = box(-6000, 6000, -6000, 6000);
    const mid = ask({ feats, bbox: box6 }, 0), off = ask({ feats, bbox: box6, enf: { chan: false } }, 0);
    const side = ask({ feats, bbox: box6 }, 0, null, at(30, 800)), clear = ask({ feats, bbox: box6 }, 0, null, at(400, 0));
    check("26. A BUOYED CHANNEL IS KEPT OUT BETWEEN ITS GATES (the review, safety): the model's channel rings reach one "
          + "gate's width from each buoy pair and nothing between two pairs 800 m apart, so a start on the centerline "
          + "there was its own wait point, 'out of navigation channels' - now she is moved out past the buoy line (the "
          + "half width, the buffer and the margin), from anywhere between the gates; with Shipping channels unchecked "
          + "the start stands, and says so (chanKept false); a start clear of the channel is not moved",
          () => mid.to && Math.abs(mid.e) >= 60 + 25 - 1e-6 && mid.movedM >= 85 && mid.chanKept === true
                && side.to && Math.abs(side.e) >= 85 - 1e-6
                && off.to && off.movedM === 0 && off.chanKept === false && clear.to && clear.movedM === 0,
          () => JSON.stringify({ mid: [mid.e && +mid.e.toFixed(0), mid.n && +mid.n.toFixed(0), mid.movedM], side: [side.e && +side.e.toFixed(0), side.movedM],
                                 off: [off.movedM, off.chanKept], clear: clear.movedM, err: mid.error }));
  }
  {
    const OPEN = () => [area(-2000, 2000, -2000, 2000, 20, 30)];
    // the guard's contact, a hull 60 x 12 m lying 4 m from the start (as koWithAis holds her: a poly in frame meters)
    const hull = (() => { const ring = [[4, -30], [16, -30], [16, 30], [4, 30], [4, -30]].map(([e, n]) => ({ e, n }));
      return { ring, bb: { x0: 4, y0: -30, x1: 16, y1: 30 }, kind: "AIS: MOORED SHIP (moored)" }; })();
    const alone = ask({ feats: OPEN() }, 0), beside = ask({ feats: OPEN() }, 0, { polys: [hull] });
    // every point in reach lies in a square no chart covers: the refusal names THAT
    const u0 = at(-2000, -2000), u1 = at(2000, 2000);
    const dark = ask({ feats: OPEN(), unread: [{ W: u0.lon, S: u0.lat, E: u1.lon, N: u1.lat }] }, 0);
    const nodepth = ask({ feats: NEAR(), enf: { depth: false } }, 0);
    check("27. THE CALLER'S KEEP-OUTS ARE KEPT OFF like every other (the guard's contacts at a re-find: with a hull 4 m "
          + "from the point she is moved the buffer and the margin off its side, where alone the point stands); the "
          + "disc is never past the 100 m the point stands inside read water, less the buffer - its edge keeps the "
          + "standoff off unread water as off everything else (495 m was sent beside an unread square); "
          + "a reach that is all water no chart covers is refused AS THAT, not as 'no room for the 2 m it may wander'; "
          + "and with Depth unchecked the answer says depth was not judged",
          () => alone.to && alone.movedM === 0 && alone.holdClear === 100 - BUF
                && beside.to && beside.movedM > 0 && beside.e <= 4 - 25 + 1e-6
                && !dark.to && dark.unread === true
                && dark.error === "the only water within 500 m of it that would hold her is water the chart was not read over"
                && nodepth.to && nodepth.depthJudged === false && alone.depthJudged === true && alone.chanKept === true,
          () => JSON.stringify({ alone: [alone.movedM, alone.holdClear], beside: [beside.movedM, beside.e && +beside.e.toFixed(1)], dark: dark.error, nodepth: nodepth.depthJudged }));
  }

  // ── 28. THE RE-APPROACH'S RE-FIND, on the page's own reapproachIfSetOff ────────────────────────────────────────
  {
    const W = at(180, 40), HERE = at(100, 40), P0 = { ring: [], kind: "land" }, SHIP = { ring: [], kind: "AIS: SHIP" };
    const run = async (o, frame) => {
      const env = { now: 1e12, pending: false, water: 0.78, wr: { to: W, movedM: 0, holdClear: 20.5 }, asked: [], legs: [], plans: [], posts: [], said: [],
                    notes: [], kc: null, rec: { sv: "S2", mode: "loiter", p: W, level_m: 0.29 }, P0, asv: HERE, ...(o || {}) };
      // eslint-disable-next-line no-new-func
      const w = new Function("env", "distTo", '"use strict";\n'
        + "const Date = {now: () => env.now}; let pendingHold = env.rec; const setPendingHold = (v) => { pendingHold = v; };\n"
        + "const S = {behavior: 'survey', run_seq: 7}; const asv = env.asv; const sea = {get waterOffset(){ return env.water; }};\n"
        + "const nogo = {ready: true, ko: {polys: [env.P0]}}; let routeCmdsInFlight = 0, reapproachBusy = false, reapproachAt = 0;\n"
        + decl(/^const REAPPROACH_MIN_MS = [^;]*;/m) + "\n" + decl(/^const WAIT_REACH_M = [^;]*;/m) + "\n"
        + "const supervising = () => true, continueStartPending = () => env.pending;\n"
        + "const koWithAis = () => (env.ship ? {polys: [env.P0, env.ship]} : nogo.ko);\n"
        + "const waitPointAt = (c, lv, o) => { env.asked.push({c, lv, o}); return env.wr; };\n"
        + "const holdOpts = () => ({}), patClipBufM = () => 5, planWhy = (p) => p.error, setViolation = () => {};\n"
        + "const planNogoRoute = (from, to, o) => { env.legs.push({to, fly: !!o.flyThrough, ko: o.ko});"
        + "  return env.plans.length ? env.plans.shift() : {route: [from, to], holdClear: 30}; };\n"
        + "const showBanner = (t) => env.said.push(t), sayUnlessAlarm = (t) => env.said.push(t), flashNote = (t) => env.notes.push(t);\n"
        + "const fmtDist = (m) => Math.round(m) + ' m', chainRunKey = (x) => x.run_seq; let planGen = 0, runRoute = null, runUnsafe = [];\n"
        + "const routeCmd = async (path, body) => { env.posts.push({path, body}); return {ok: true, state: {run_seq: 7, behavior: 'survey'}}; };\n"
        + "const took = (r) => !!(r && r.ok); let planIntent = null; const setPlanIntent = () => { planIntent = {why: []}; };\n"
        + "const legStartsHere = () => {}, render = () => {};\n"
        + grabs("onSplitRun", "reapproachIfSetOff")
        + "return { reapproachIfSetOff, get hold(){ return pendingHold; } };")(env, G.distTo);
      const s = { run: "running", armed: true, behavior: "survey", run_completion: "loiter", completion: "rth", run_seq: 7, ...(frame || {}) };
      await w.reapproachIfSetOff(s, { holding: true, hold_wants_route: true, hold: W, off_station_m: 80, hold_clear_m: 20 });
      env.hold = w.hold;
      return env;
    };
    const a = await run({ ship: SHIP });
    const aLoiter = await run({}, { completion: "loiter" });                       // End of plan LOITER: still her wait point
    const unread = await run({ rec: { sv: "S2", mode: "loiter", p: W, level_m: 0, unread: true } });
    const W2 = at(150, 60);
    const moved = await run({ wr: { to: W2, movedM: 36, holdClear: 22 } });
    const lostAt = at(175, 45);
    const lost = await run({ wr: { error: "the target sits in water charted under her floor in part and nowhere within 500 m of it holds a boat clear" },
                             plans: [{ route: [HERE, lostAt], holdClear: 12 }] });
    const noFly = await run({ plans: [{ error: "the target sits in AIS: SHIP" }, { route: [HERE, lostAt], holdClear: 14 }] });
    const noLevel = await run({ rec: { sv: "S2", mode: "loiter", p: W }, plans: [{ route: [HERE, lostAt], holdClear: 9 }] });
    const other = await run({ rec: { sv: "S2", mode: "loiter", p: at(900, 0), level_m: 0.29 } });
    const pending = await run({ pending: true });
    const body = (e) => (e.posts[0] || {}).body || {};
    check("28. THE RE-APPROACH FINDS A WAIT POINT AGAIN AS IT WAS FOUND - at the lower of its level and the water now, the "
          + "deep tier alone where the level was not read, with the guard's CONTACTS in the search (the Upload's AIS read "
          + "is hours stale) - with End of plan LOITER too; flies to that answer exactly, its disc the lesser; where none "
          + "is found, or the way to it cannot be flown, the berth-tested way back as it always was - and SAID, not the "
          + "ordinary note; the record follows wherever the way back ENDS (the fallback too, and a hold with no level); "
          + "another hold's record is left alone; and it stands down while a Continue's upload awaits its Start",
          () => a.asked.length === 1 && a.asked[0].lv === 0.29 && a.asked[0].o.deepOnly === false && a.asked[0].o.polys.length === 1 && a.asked[0].o.polys[0] === SHIP
                && a.legs.length === 1 && a.legs[0].fly === true && a.legs[0].to === W && body(a).hold_clear_m === 20.5 && body(a).run_seq === 7
                && a.said.length === 0 && a.hold.p.lat === W.lat
                && aLoiter.asked.length === 1 && aLoiter.legs[0].fly === true
                && unread.asked[0].o.deepOnly === true && unread.asked[0].lv === 0
                && moved.legs[0].to === W2 && moved.legs[0].fly === true && body(moved).hold_clear_m === 22 && moved.hold.p.lat === W2.lat && moved.hold.level_m === 0.29
                && lost.legs.length === 1 && lost.legs[0].fly === false && lost.legs[0].to.lat === W.lat && body(lost).hold_clear_m === 12
                && lost.hold.p.lat === lostAt.lat
                && /^⚠ HER WAIT POINT WAS NOT FOUND AGAIN: no point within 500 m holds her at the wait's low now \(the target sits in water charted under her floor in part/.test(lost.said[0] || "")
                && /not judged at the wait's low/.test(lost.said[0] || "")
                && noFly.legs.length === 2 && noFly.legs[0].fly === true && noFly.legs[1].fly === false && body(noFly).hold_clear_m === 14
                && /HER WAIT POINT WAS NOT FOUND AGAIN: the way to the point found could not be flown \(the target sits in AIS: SHIP\)/.test(noFly.said[0] || "")
                && noFly.hold.p.lat === lostAt.lat
                && noLevel.asked.length === 0 && noLevel.legs[0].fly === false && noLevel.hold.p.lat === lostAt.lat && noLevel.said.length === 0
                && other.asked.length === 0 && other.hold.p.lat === at(900, 0).lat && other.posts.length === 1
                && pending.posts.length === 0 && pending.legs.length === 0,
          () => JSON.stringify({ a: [a.asked.length, a.legs.map((l) => l.fly), body(a).hold_clear_m], unread: unread.asked[0] && unread.asked[0].o.deepOnly,
                                 moved: body(moved).hold_clear_m, lost: [lost.legs.map((l) => l.fly), (lost.said[0] || "").slice(0, 80)],
                                 noFly: [noFly.legs.map((l) => l.fly), (noFly.said[0] || "").slice(0, 90)], noLevel: noLevel.legs.map((l) => l.fly),
                                 other: other.asked.length, pending: pending.posts.length }));
  }

  // ── 29. the record's `unread`, Upload's disc, the banner's words ───────────────────────────────────────────────
  {
    const env = { live: 48.8 };
    // eslint-disable-next-line no-new-func
    const w = new Function("env", '"use strict";\n'
      + "const S = {boot_id: 'b1'}; const surveyById = () => ({id: 'S2', no: 2, settings: {start_t: Date.now() / 1000 + 3600}});\n"
      + "const surveyLabel = (s) => 'S' + s.no, surgeWhen = () => 'Fri 07:00', fmtDist = (m) => Math.round(m) + ' m';\n"
      + "const holdClearAt = () => env.live;\n"
      + grabs("surveyStartT", "holdRec", "waitDisc", "holdUploadedSay") + "return { holdRec, waitDisc, holdUploadedSay };")(env);
    const TO = at(180, 40), hold = { held: "S2", part: [at(0, 0)] };
    const WAIT = { to: TO, level: 0.2, read: true, movedM: 84, kind: "water too tight to hold in", tier: "deep", holdClear: 37.5, say: "+0.20 m, the lowest predicted" };
    const r1 = w.holdRec(hold, null, WAIT, [at(-10, 0), TO]), r2 = w.holdRec(hold, null, { ...WAIT, read: false }, [at(-10, 0), TO]);
    const d1 = w.waitDisc(WAIT); env.live = 12; const d2 = w.waitDisc(WAIT); env.live = null; const d3 = w.waitDisc(WAIT);
    const plain = w.holdUploadedSay(hold, null, { ...WAIT, chanKept: true, depthJudged: true, ais: true }, 9);
    const loose = w.holdUploadedSay(hold, null, { ...WAIT, chanKept: false, depthJudged: false, ais: false }, 9);
    check("29. the record keeps that the wait's level was NOT read (the re-find then searches the deep tier alone, as "
          + "Upload did); Upload's disc is the one the point was found with and never wider than the water now gives "
          + "with this frame's contacts; and the banner says what the search DID - with Shipping channels unchecked "
          + "that channels were NOT kept out, with Depth unchecked that depth was not judged, with no AIS answer that "
          + "the vessels moored there were not read - never 'out of navigation channels' of a search that kept none",
          () => !("unread" in r1) && r1.level_m === 0.2 && r2.unread === true && r2.level_m === 0.2
                && d1 === 37.5 && d2 === 12 && d3 === 37.5
                && /in water with deep water first's margin over her floor, out of navigation channels\. The rest of the plan/.test(plain)
                && !/NOT/.test(plain.replace("NOT aboard", ""))
                && /Found at \+0\.20 m, the lowest predicted, ⚠ with DEPTH NOT JUDGED \(Depth is unchecked\); ⚠ navigation channels were NOT kept out \(Shipping channels is unchecked\)\. ⚠ The AIS feed did not answer: vessels moored there were NOT read\. The rest of the plan/.test(loose)
                && !/out of navigation channels/.test(loose) && !/margin over her floor/.test(loose),
          () => JSON.stringify({ r2: r2.unread, d: [d1, d2, d3] }) + " | " + loose.slice(140, 420));
  }

  // ── 30. THE ALERT'S OWN SLOT (the review before the merge) ─────────────────────────────────────────────────────
  {
    const T0 = 1795200000, START = T0 + 3600;
    const mkEnv = (rec, o) => ({ now: START + 5, t0: T0, rec, nexts: 0, said: [], notes: [], logs: [], alarm: false, banner: { textContent: "", style: { display: "none" } },
      S: { home: at(-4000, 0), status: {} },
      mission: { waypoints: [{ ...at(0, 0), sv: "S2" }, { ...at(0, 300), sv: "S2" }], surveys: [{ id: "S2", no: 2, settings: { start_t: START } }] }, ...(o || {}) });
    const REC = { sv: "S2", mode: "loiter", p: at(100, 0), at: 7, boot: "b1", ahead: true };
    const FR = (o, st) => [{ run: "running", behavior: "survey", run_completion: "loiter", completion: "rth", armed: true, boot_id: "b1", ...(o || {}) },
                           st || { holding: true, hold: at(100, 0) }];
    const cover = (e, t) => { e.banner.textContent = t; e.banner.style.display = "block"; };
    // (a) an ADVISORY said once is not taken down: the alert is a note there, and again each minute it stands
    const a = mkEnv(REC), wa = tickWorld(a);
    cover(a, "⚠ HOLD POINT CROWDED — 3 m of clear water round it");
    wa.waitTick(...FR()); const aSaid = a.said.length, aNote = a.notes.slice(), aBanner = a.banner.textContent;
    a.now += 61; wa.waitTick(...FR()); const aNotes2 = a.notes.length;
    // (b) a REFUSAL - Continue's own - stands
    const b = mkEnv(REC), wb = tickWorld(b);
    cover(b, "Upload refused - NOTHING WAS SENT: no water within 500 m");
    wb.waitTick(...FR());
    // (c) NO NAG WHILE CONTINUE IS CLOSED: on her way it is said once, and not again when covered
    const c = mkEnv(REC), wc = tickWorld(c);
    wc.waitTick(...FR({}, { holding: false })); cover(c, "Clear ahead again"); c.now += 61; wc.waitTick(...FR({}, { holding: false }));
    const cOnce = c.said.length;
    // (d) SAID AGAIN WHEN HER STATE CHANGES: she arrives and holds - the banner said "on her way" with Continue open
    const d = mkEnv(REC), wd = tickWorld(d);
    wd.waitTick(...FR({}, { holding: false })); wd.waitTick(...FR());
    // (e) TAKEN DOWN WHEN THE WAIT ENDS (released: no record) - and only if it is the banner standing
    const e = mkEnv(REC), we = tickWorld(e);
    we.waitTick(...FR()); const eUp = e.banner.style.display;
    we.hold = null; we.waitTick(...FR()); const eDown = e.banner.style.display;
    const e2 = mkEnv(REC), we2 = tickWorld(e2);
    we2.waitTick(...FR()); cover(e2, "UPLOADED FROM S2 (44 waypoints)"); we2.hold = null; we2.waitTick(...FR());
    // (f) nothing while a Continue is in hand
    const f = mkEnv(REC), wf = tickWorld(f); wf.busy = true; wf.waitTick(...FR());
    // (g) THE HOME NOTICE: not while a Continue's upload is staged or banked (its own upload withdrew the chain), and
    //     never over the banner that says why a return was refused
    const HOME = { sv: "S2", mode: "home", at: 11, boot: "b1", ahead: true };
    const END = (o) => [{ run: "running", behavior: "survey", run_completion: "rth", completion: "rth", armed: true, boot_id: "b1", ...(o || {}) }, { holding: true, hold: at(-200, 0) }];
    const g1 = mkEnv(HOME, { now: T0 + 10 }), wg1 = tickWorld(g1); wg1.failed = true; wg1.waitTick(...END({ plan_staged: true }));
    const g2 = mkEnv(HOME, { now: T0 + 10 }), wg2 = tickWorld(g2); wg2.failed = true; wg2.next = { rec: null, n: 4 }; wg2.waitTick(...END());
    const g3 = mkEnv(HOME, { now: T0 + 10 }), wg3 = tickWorld(g3); wg3.failed = true; cover(g3, "RTH refused: the way home is blocked — highlighted on the chart.");
    wg3.waitTick(...END());
    check("30. THE ALERT'S OWN SLOT (the review): over an advisory this page says once ('⚠ ...': a hold point crowded as "
          + "the tide falls, the fuel reserve) or a refusal it is a NOTE and the banner stands - re-raised each minute it "
          + "took each down for good; closed, it is said once and never again (it nagged through a whole leg); it is "
          + "said AGAIN when where she is changes (said on her way, it still read so with her holding and Continue "
          + "open); when the wait ends it comes down - if it is the banner standing; nothing while a Continue is in "
          + "hand; and the 'was to wait at home' notice is not said over a staged or banked Continue, nor over the "
          + "banner that says why the return was refused",
          () => aSaid === 0 && aNote.length === 1 && /S2's start has come: Continue is on its row\./.test(aNote[0]) && /^⚠ HOLD POINT CROWDED/.test(aBanner) && aNotes2 === 2
                && b.said.length === 0 && b.notes.length === 1 && /NOTHING WAS SENT/.test(b.banner.textContent)
                && cOnce === 1
                && d.said.length === 2 && /on her way to where she waits/.test(d.said[0]) && /she is holding where she waits for it\. Press Continue S2/.test(d.said[1]) && d.logs.length === 1
                && eUp === "block" && eDown === "none" && e2.banner.style.display === "block" && /^UPLOADED FROM/.test(e2.banner.textContent)
                && f.said.length === 0 && f.notes.length === 0
                && g1.said.length === 0 && g2.said.length === 0
                && g3.said.length === 0 && g3.notes.length === 1 && /^RTH refused/.test(g3.banner.textContent),
          () => JSON.stringify({ a: [aSaid, aNote, aNotes2], b: [b.said.length, b.notes.length], cOnce, d: d.said.map((x) => x.slice(-60)), e: [eUp, eDown, e2.banner.style.display],
                                 f: f.said.length, g: [g1.said.length, g2.said.length, g3.said.length, g3.notes] }));
  }

  // ── 31. the wait at home's words, a chart not read, home's water not judged (the review before the merge) ────────
  {
    const env = { banners: [], notes: [], logs: [], recs: [], pending: true, live: 0.2, beyond: false, clear: 50, lv: null,
                  nogoObj: { ready: true, frame: { toEN: () => ({ e: 0, n: 0 }) }, ko: {}, bbox: null, unread: null, buffer: 0 } };
    // eslint-disable-next-line no-new-func
    const w = new Function("env", '"use strict";\n'
      + "let S = null; const surveyById = () => ({id: 'S2', no: 2}); const surveyLabel = (s) => 'S' + s.no, surgeWhen = () => 'Fri 07:00';\n"
      + "const fmtDist = (m) => Math.round(m) + ' m', fmtLevel = (m) => (m >= 0 ? '+' : '') + m.toFixed(2) + ' m';\n"
      + "const showBanner = (t) => env.banners.push(t), flashNote = (t) => env.notes.push(t), logClient = (k, o) => env.logs.push([k, o]);\n"
      + "const setPendingHold = (r) => env.recs.push(r), rthPending = () => env.pending, renderSurveyTable = () => {};\n"
      + "const nogo = env.nogoObj; const sea = {get waterOffset(){ return env.live; }};\n"
      + "const beyondChart = () => env.beyond; const waitLevelRead = async () => env.lv;\n"
      + "const holdClearM = () => env.clear, koAtLevel = () => ({}), holdRadiusM = () => 20;\n"
      + decl(/^const WAIT_REACH_M = [^;]*;/m) + "\n" + decl(/^const WAIT_WATCHED_HOME = [^;]*;/m) + "\n"
      + grabs("waitHomeNothing", "holdUploadedSay", "waitRefused", "waitHomeWater")
      + "return { waitHomeNothing, holdUploadedSay, waitRefused, waitHomeWater, set S(v){ S = v; } };")(env);
    const HOME = { s: { id: "S2", no: 2 }, start: 7200, leave: 6000, homeAt: 100 };
    const nothing = (S0, pending) => { env.pending = pending; w.S = { boot_id: "b1", behavior: "survey", completion: "rth", status: {}, ...S0 };
      env.banners.length = 0; w.waitHomeNothing(HOME); return env.banners[0] || ""; };
    // (H3) the promise of a return is made to a boat HOLDING on a run that ended - idle, stopped or paused, the
    // chain's own answer was yes and nothing came
    const nIdle = nothing({ run: "idle" }, true), nStopped = nothing({ run: "stopped" }, true), nPaused = nothing({ run: "paused" }, true);
    const nHeld = nothing({ run: "running", status: { holding: true } }, true), nHeldNo = nothing({ run: "running", status: { holding: true } }, false);
    const nHome = nothing({ run: "running", behavior: "rth", status: { holding: true } }, false);
    const WATCH = /⚠ A wait is watched only while a chart window supervises her: holding at home unwatched, the console pauses her, and a paused boat drifts - Stop her and make her fast before you leave the window \(Continue opens from stopped\)\.$/;
    // (H5, H7) the home banner is told it is watched; the reason HOME was not in effect rides the loiter banners
    const hold = { held: "S2" }, WAITP = { to: { lat: 0, lon: 0 }, say: "+0.20 m", tier: "deep", chanKept: true, depthJudged: true, ais: true };
    const homeUp = w.holdUploadedSay(hold, { ...HOME, homeSay: "", fuelSay: "" }, null, 5);
    const SAID = "S2's Wait is HOME, but she would be home no sooner than she must leave for its start Fri 07:00: she waits near its start instead.";
    const pointUp = w.holdUploadedSay(hold, null, WAITP, 9, SAID), startUp = w.holdUploadedSay(hold, null, null, 9, SAID);
    const plainUp = w.holdUploadedSay(hold, null, WAITP, 9);
    // (A8) a chart that could not be read is said as that, with its own remedy
    const REF = { s: { id: "S2", no: 2 }, arrive: 100, start: 7200 };
    env.banners.length = 0; env.notes.length = 0;
    w.waitRefused({ ...REF, chart: true, refuse: "the chart round S2's start could not be read out to the 500 m a wait point is looked for in" });
    const chartB = env.banners[0] || "", chartN = env.notes[0] || "", chartLog = env.logs.slice(-1)[0] || [];
    env.banners.length = 0;
    w.waitRefused({ ...REF, refuse: "no water there holds her", say: "+0.20 m" }); const roomB = env.banners[0] || "";
    // (the second review) a wait the search could not judge - it threw - is refused as THAT, never sent unjudged
    env.banners.length = 0; env.notes.length = 0;
    w.waitRefused({ ...REF, failed: true, refuse: "boom" });
    const failB = env.banners[0] || "", failN = env.notes[0] || "", failLog = env.logs.slice(-1)[0] || [];
    // (H8) home's water NOT judged is said - outside the chart read, with no chart, or at a level that was not read
    w.S = { home: { lat: 0, lon: 0 } };
    env.beyond = true; const wBeyond = await w.waitHomeWater(HOME); env.beyond = false;
    env.nogoObj.ready = false; const wNoChart = await w.waitHomeWater(HOME); env.nogoObj.ready = true;
    env.lv = { m: 0, read: false }; const wUnreadClear = await w.waitHomeWater(HOME);
    env.clear = 5; const wUnreadTight = await w.waitHomeWater(HOME);
    env.lv = { m: -0.3, read: true }; const wReadTight = await w.waitHomeWater(HOME);
    env.clear = 50; const wReadClear = await w.waitHomeWater(HOME);
    check("31. THE WAIT AT HOME SAYS WHAT IS SO (the review): with nothing to send a return is promised only to a boat "
          + "holding on a run that ended (idle, stopped or paused it is RTH to press; paused, that she drifts); its banner "
          + "and the Upload's are told the wait is watched only while a chart window supervises her, in home's own terms; "
          + "the reason a Wait set to HOME was not in effect rides the loiter banner; a chart that could not be read is "
          + "refused as that - press Upload again - not as 'no water holds her'; and home's water not judged is SAID",
          () => /Press RTH to take her home if she is not there\./.test(nIdle) && !/End of plan RTH takes her home/.test(nIdle)
                && /Press RTH to take her home if she is not there\./.test(nStopped)
                && /She is PAUSED, and a paused boat drifts: press RTH to take her home, or Start to resume what she was flying first\./.test(nPaused)
                && /She is holding on a plan that ended: End of plan RTH takes her home from it\./.test(nHeld)
                && /Press RTH to take her home if she is not there\./.test(nHeldNo) && /She is holding at home\./.test(nHome)
                && [nIdle, nPaused, nHeld, nHome].every((b) => WATCH.test(b)) && WATCH.test(homeUp)
                && pointUp.includes(" ⚠ " + SAID) && startUp.endsWith(" ⚠ " + SAID) && !/Wait is HOME/.test(plainUp) && !WATCH.test(pointUp)
                && /^Upload refused - NOTHING WAS SENT: the chart round S2's start could not be read out to the 500 m a wait point is looked for in, so where she waits for S2 was not judged\. Press Upload again \(the chart read may answer then\), or set its row's Wait to HOME, so she waits there\.$/.test(chartB)
                && !/no water within/.test(chartB) && /^Upload refused: the chart round S2's start could not be read out to the 500 m a wait point is looked for in - press Upload again\.$/.test(chartN)
                && failB === "Upload refused - NOTHING WAS SENT: where she waits for S2 could not be judged (boom). Press Upload again, or set its row's Wait to HOME, so she waits there."
                && failN === "Upload refused: where S2 waits could not be judged - press Upload again." && failLog[1] && failLog[1].failed === true
                && chartLog[0] === "upload_wait" && chartLog[1].chart === true && /no water within 500 m of S2's start holds her/.test(roomB)
                && wBeyond === " Home's water over the wait was NOT judged: the chart was not read there."
                && wNoChart === " Home's water over the wait was NOT judged: the chart model is not loaded."
                && wUnreadClear === " Home's water was judged at +0.00 m only: the water over the wait could not be read."
                && /^ ⚠ HOME AT \+0\.00 m \(the water over the wait could not be read\): 5 m of clear water round it/.test(wUnreadTight)
                && /^ ⚠ HOME AT THE WAIT'S LOW \(-0\.30 m\): 5 m of clear water round it/.test(wReadTight) && wReadClear === "",
          () => JSON.stringify({ nIdle: nIdle.slice(90, 160), nPaused: nPaused.slice(90, 190), chartB: chartB.slice(0, 120), wBeyond, wUnreadClear, wUnreadTight: wUnreadTight.slice(0, 80), wReadTight: wReadTight.slice(0, 60) }));
  }

  __finished = true;
  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
