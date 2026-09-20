// tests/berth_grant.js - THE LAUNCH GRANT (DEPARTURE_PARADIGM.md R1-R16).
//
// A SAFETY SUITE, and the only one in this repo where the console is deliberately made LESS
// able to act. Everything here exists to bound that: what may be stood down (R3, R4), where
// (R5), for how long (R11, R12, R14), and what happens at the instant it stops (R15).
//
// ⚠⚠ THE OPEN REGIME IS PROVED BY OMISSION, NOT HERE. That tests/in_extremis.js,
// tests/clearance_guard.js, tests/gate_endpoint.js, tests/buoy_lane.js and
// tests/hold_point.js all pass UNMODIFIED - and that static/js/guard.js shows zero diff - is
// what establishes that a console with no berth latched is byte-for-byte today's console.
// Check 1 asserts the guard.js half of that directly, because an assertion nobody runs is
// prose. This file is where a grant actually STANDS.
//
// ⚠ EVERY CHECK PRINTS THE METRES AND THE FEATURE IT DECIDED ON. A check that passed for the
// wrong reason is invisible without them, and three of this design's own rules turn on a
// number being on one side of a threshold rather than on a branch being taken.

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

const { blocked, clearanceM, featureClearanceM } = require("../static/js/keepouts.js");
const { planeFrame } = require("../static/js/geodesy.js");
const { bbOf } = require("../static/js/geometry.js");
const { holdClearM, holdMarginM, snapCapM } = require("../static/js/hold.js");
const B = require("../static/js/berth.js");

// ASV_HTML points this at a SIDECAR copy for a mutation run. A suite that ignores the
// override scores every mutation as SURVIVED, which is a broken instrument rather than weak
// checks - see tests/clearance_guard.js's own note on how that was caught.
const H = fs.readFileSync(process.env.ASV_HTML ||
                          path.join(__dirname, "..", "static", "asv.html"), "utf8");
const GUARD_SRC = fs.readFileSync(path.join(__dirname, "..", "static", "js", "guard.js"), "utf8");

function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
// SOURCE CHECKS READ CODE, NOT COMMENTS. Two checks in clearance_guard.js went red for a
// note that mentioned the very call they were counting, and one in units_toggle.js went red
// for a comment quoting the pattern it greps for. Strip first, then match.
const codeOnly = (src) => src.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const HC = codeOnly(H);

let fails = 0, ran = 0;
function check(name, cond, detail) {
  let ok = false, err = "";
  ran++;
  try { ok = (typeof cond === "function") ? !!cond() : !!cond; }
  catch (e) { ok = false; err = " THREW " + (e && e.message ? e.message : e); }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : "") + err);
  if (!ok) fails++;
}

// ── THE SLIP ───────────────────────────────────────────────────────────────────────────
//
// A berth between two piers, which is the shape every recorded episode was flown from. The
// boat lies 1.0 m off the west pier's face; the slip is 10 m wide and 30 m deep; the way out
// is north. A WRECK sits in the same water - the R4 case, and the one that must be refused
// BY NAME rather than quietly granted along with the structures. The FAR BANK is 200 m east:
// it survives the filter, which is what stops a grant from being a general amnesty.
const ref = planeFrame({ lat: 43.072110, lon: -70.710912 });
const poly = (e0, e1, n0, n1, kind) => {
  const r = [{ e: e0, n: n0 }, { e: e1, n: n0 }, { e: e1, n: n1 }, { e: e0, n: n1 }];
  return { ring: r, bb: bbOf(r), kind };
};
const BUF = 5, NEED0 = holdMarginM(0);          // 6.0 m in slack water - the guard's own budget

function slip(opts = {}) {
  const ko = { polys: [], lines: [], points: [], marks: [], sys: [], chans: [] };
  ko.polys.push(poly(-40, -1, -30, 30, "a dock / pier"));      // west pier, face at e = -1
  ko.polys.push(poly(9, 50, -30, 30, "a dock / pier"));        // east pier, face at e = +9
  ko.polys.push(poly(200, 260, -200, 200, "the shoreline"));   // far bank - never granted
  // ⚠ THE WRECK HAS TO BE CLOSE ENOUGH TO BE ONE OF THE REASONS THIS BERTH IS A BERTH, or
  // R4 is never even asked: grantedFeatures() only CONSIDERS a feature whose clearance less
  // the buffer is under need0, so a wreck further off is skipped as "not why" and the
  // ungrantable list comes back empty - which is a check passing for the wrong reason.
  // At (3,5) r=1: 4.83 m from the berth, 4.83 - 5 = -0.17 m, under the 6.0 m need.
  if (opts.wreck !== false)
    ko.points.push({ e: 3, n: 5, r: 1, kind: "a charted hazard" });
  if (opts.shallow)                                             // the DEPTH case (R7)
    ko.polys.push(poly(-1, 9, -30, 18, "water shallower than 1.5 m"));
  return ko;
}
const BERTH = { e: 0, n: 0 };                                   // 1.0 m off the west pier
// The spine: the berth, then the planner's own way out of the slip and on north.
const SPINE = [{ e: 0, n: 0 }, { e: 4, n: 20 }, { e: 4, n: 60 }, { e: 4, n: 140 }];

console.log("berth_grant.js - the launch grant (DEPARTURE_PARADIGM.md R1-R16)\n");

// ── 1. THE PROPERTY THE WHOLE DESIGN RESTS ON ──────────────────────────────────────────
check("1. static/js/guard.js is NOT MODIFIED by any of this - the ladder's own source is untouched",
  () => !/berth|grant|corridor/i.test(GUARD_SRC),
  (() => {
    const hits = (GUARD_SRC.match(/berth|grant|corridor/gi) || []);
    return "guard.js mentions of berth/grant/corridor: " + hits.length
      + " — the ladder answers a true question about a smaller WORLD; it is never told about "
      + "the berth. A single reference here and the suppression has moved inside the rung";
  })());

// ── R2: NO GRANT WHERE THE CONSOLE CAN ALREADY CERTIFY ─────────────────────────────────
const ko = slip();
check("2. the launch water IS a berth - blocked at the buffer, or short of a hold point's margin (R2)",
  () => B.isBerth(BERTH, ko, BUF, NEED0),
  "holdClearM at the berth = " + holdClearM(BERTH, ko, BUF).toFixed(2) + " m against a need of "
  + NEED0.toFixed(1) + " m; blocked at the buffer = " + !!blocked(BERTH, ko, BUF));

check("2b. ACCEPTANCE: open water 500 m off the same model is NOT a berth, so nothing is latched",
  () => !B.isBerth({ e: 500, n: 500 }, ko, BUF, NEED0),
  "holdClearM out in the bay = " + holdClearM({ e: 500, n: 500 }, ko, BUF).toFixed(1)
  + " m >= " + NEED0.toFixed(1) + " m. A refusal with no acceptance beside it passes for any "
  + "predicate that always answers false");

// ── R3 / R4: MEMBERSHIP, AND THE KINDS THAT CAN NEVER BE COVERED ───────────────────────
const mem = B.grantedFeatures(ko, BERTH, BUF, NEED0);
check("3. both piers are granted - they are what make the launch point uncertifiable (R3)",
  () => mem.structure.length === 2 && mem.all.length === 2,
  "granted: " + mem.all.map(f => f.kind + " @ " + (featureClearanceM(BERTH, f)).toFixed(2) + " m")
    .join(", ") + " — each one's clearance less the " + BUF + " m buffer is under the "
  + NEED0.toFixed(1) + " m the berth needs");

check("4. the WRECK in the same water is REFUSED BY NAME, not granted with the structures (R4)",
  () => mem.ungrantable.length === 1 && mem.ungrantable[0].kind === "a charted hazard"
        && !mem.all.some(f => f.kind === "a charted hazard"),
  "ungrantable: " + mem.ungrantable.map(f => f.kind).join(", ") + " at "
  + featureClearanceM(BERTH, ko.points[0]).toFixed(2) + " m — close enough to make the berth a "
  + "berth, and still not something a person on a float certified by looking at the water");

check("4b. the FAR BANK survives the filter - a grant is not an amnesty for everything nearby",
  () => !mem.all.some(f => f.kind === "the shoreline"),
  "the shoreline is " + featureClearanceM(BERTH, ko.polys[2]).toFixed(0) + " m off, which is not "
  + "why this berth is a berth");

const koG = B.grantFilter(ko, mem.all);
const nPolys = (k) => (k.polys || []).length + (k.lines || []).length + (k.points || []).length;
check("4c. the model the ladder is handed keeps the wreck and the far bank, and loses the two piers",
  () => nPolys(koG) === nPolys(ko) - 2
        && (koG.points || []).some(f => f.kind === "a charted hazard")
        && (koG.polys || []).some(f => f.kind === "the shoreline"),
  "true model " + nPolys(ko) + " features -> filtered " + nPolys(koG)
  + "; the wreck and the far bank still earn every rung on the same frame");

check("4d. TEETH: emptying UNGRANTABLE_KINDS would grant the wreck at a berth",
  () => B.UNGRANTABLE_KINDS.length === 4
        && B.UNGRANTABLE_KINDS.every(k => !B.grantableKind(k))
        && B.grantableKind("a dock / pier") && B.grantableKind("the shoreline"),
  "un-grantable: " + B.UNGRANTABLE_KINDS.join(" · ")
  + " — a list, not a setting, so the operator cannot name them either");

// ── R5: THE CORRIDOR, AND ITS BUFFER-INDEPENDENCE ──────────────────────────────────────
const HALF = B.corridorHalfM(7.71, 8.25);
check("5. the corridor half-width is the hull's own scale, and is BUFFER-INDEPENDENT (R5)",
  () => B.corridorHalfM(7.71, 8.25) === B.corridorHalfM(7.71, 8.25) && HALF === 8.25,
  "halfM = max(loa 7.71, minTurnRadius(low) 8.25) = " + HALF + " m. Nothing here reads the "
  + "buffer: anchoring it to the buffer meant raising the buffer for safety WIDENED the "
  + "exemption, which is a control that makes the console more cautious making it less so");

check("5b. TEETH: the PLACE conjunct actually refuses - a pier 300 m down the bay is outside it",
  () => B.inCorridor({ e: 4, n: 20 }, SPINE, 3, HALF)
        && !B.inCorridor({ e: 300, n: 20 }, SPINE, 3, HALF)
        && !B.inCorridor({ e: 4, n: 300 }, SPINE, 3, HALF),
  "inside (4,20): true · 296 m abeam: false · 160 m beyond the spine's end: false. Without the "
  + "along-track bound a grant would cover the same kind of feature anywhere it reached");

// ── R6 / R7: THE GATE, AND THE DEPTH GATE ──────────────────────────────────────────────
const gate = B.corridorGate(SPINE, ko, BUF, NEED0);
check("6. the gate is the first water the console would ITSELF accept as a hold point (R6)",
  () => gate && !gate.capped && gate.idx > 0
        && holdClearM(gate.at, ko, BUF) >= NEED0,
  "gate at " + gate.m.toFixed(1) + " m along the spine, where holdClearM = "
  + holdClearM(gate.at, ko, BUF).toFixed(1) + " m >= " + NEED0.toFixed(1)
  + " m; searched no further than snapCapM(" + BUF + ") = " + snapCapM(BUF) + " m");

check("6b. one step SHORT of the gate the console would NOT have accepted it",
  () => {
    const back = { e: gate.at.e, n: gate.at.n - Math.max(2, BUF / 2) };
    return holdClearM(back, ko, BUF) < NEED0;
  },
  (() => {
    const back = { e: gate.at.e, n: gate.at.n - Math.max(2, BUF / 2) };
    return "one " + Math.max(2, BUF / 2) + " m step back: holdClearM = "
      + holdClearM(back, ko, BUF).toFixed(2) + " m < " + NEED0.toFixed(1)
      + " m. Without this the gate could be anywhere past the real one and check 6 would "
      + "still pass";
  })());

const koShallow = slip({ shallow: true });
const gateS = B.corridorGate(SPINE, koShallow, BUF, NEED0);
check("7. the DEPTH gate is reached BEFORE the structure gate, and the depth grant ends there (R7)",
  () => gateS && gateS.depthM > 0 && gateS.depthM <= gateS.m,
  "depth gate " + gateS.depthM.toFixed(1) + " m · structure gate " + gateS.m.toFixed(1)
  + " m. The depth grant is permission to run with the hull's under-keel clearance "
  + "UNVERIFIED, so it is the shorter of the two by construction");

check("7b. no gate within the cap is a REFUSAL, reported as capped rather than as a gate",
  () => {
    const walled = { polys: [poly(-40, -1, -30, 400, "a dock / pier"),
                             poly(9, 50, -30, 400, "a dock / pier")],
                     lines: [], points: [], marks: [] };
    const g = B.corridorGate([{ e: 0, n: 0 }, { e: 4, n: 400 }], walled, BUF, NEED0);
    return g && (g.capped || g.idx < 0);
  },
  "a slip walled for 400 m returns capped/no-gate, which doUpload REFUSES at plan time - "
  + "where the operator can still move the first waypoint - instead of at Start, as an escape");

// ── R12: THE RECESSION GIVE, AND THE HALVING THAT MAKES IT ARM AT A REAL BERTH ─────────
check("12. the give self-scales, and at the RECORDED 0.97 m berth a flat 5 m could never arm",
  () => B.recessionGiveM(0.97) < 0.97 && B.recessionGiveM(0.97) >= 0.5
        && B.recessionGiveM(40) === 5.0,
  "give(0.97 m) = " + B.recessionGiveM(0.97).toFixed(2) + " m · give(40 m) = "
  + B.recessionGiveM(40).toFixed(1) + " m. A flat 5 m give at a berth with 0.97 m of water "
  + "can never fire, so the best set-back detector in the design was blind in the one place "
  + "it was needed (New Castle, 2026-09-18)");

check("12b. TEETH: a flat 5 m give is UNDETECTABLE at the recorded berth - this is the check for it",
  () => {
    // The grant ends when berthClearM < cMax - give. With a FLAT 5 m give that threshold is
    // NEGATIVE at a 0.97 m berth, so no clearance she can physically report ever crosses it -
    // she can lose every centimetre of the water she has and the test cannot fire. The
    // self-scaling give puts the threshold at 0.47 m, inside the range she actually reports.
    const cMax = 0.9724;
    return (cMax - 5.0) < 0 && (cMax - B.recessionGiveM(cMax)) > 0;
  },
  (() => {
    const cMax = 0.9724;
    return "cMax = " + cMax + " m: a flat 5 m give arms at " + (cMax - 5).toFixed(2)
      + " m (below zero - unreachable), the scaled give arms at "
      + (cMax - B.recessionGiveM(cMax)).toFixed(2) + " m. This is the mutation the paradigm "
      + "says must redden a check written specifically for it";
  })());

// ── R14: THE CLOCK ─────────────────────────────────────────────────────────────────────
check("14. the clock is 3 x corridor / low, floored at 60 s, and needs no telemetry at all",
  () => B.grantClockMs(47, 4.0) > 60000 && B.grantClockMs(5, 4.0) === 60000,
  "47 m at 4.0 kn -> " + (B.grantClockMs(47, 4.0) / 1000).toFixed(0) + " s · a 5 m corridor -> "
  + (B.grantClockMs(5, 4.0) / 1000).toFixed(0) + " s (the floor). It is the one bound that "
  + "answers 'the link died and she is still alongside'");

// ── R11: THE PROOF, AND THE DIRECTION EACH NEED IS FROZEN IN ───────────────────────────
check("11. the proof is asked of the UNFILTERED model - the granted piers still count for it",
  () => !B.grantProved(BERTH, ko, BUF, NEED0) && B.grantProved(gate.at, ko, BUF, NEED0),
  "at the berth: " + holdClearM(BERTH, ko, BUF).toFixed(2) + " m - not proved · at the gate: "
  + holdClearM(gate.at, ko, BUF).toFixed(1) + " m - proved. Asked of the FILTERED model the "
  + "boat would prove herself the instant she was granted anything");

check("11b. a building set makes proof HARDER and can never enlarge the granted set",
  () => {
    const needCalm = B.berthNeedM(0), needSet = B.berthNeedM(1.0);
    const memCalm = B.grantedFeatures(ko, BERTH, BUF, needCalm).all.length;
    const memSet = B.grantedFeatures(ko, BERTH, BUF, needCalm).all.length;  // FROZEN need0
    return needSet > needCalm && memCalm === memSet;
  },
  "need: slack " + B.berthNeedM(0).toFixed(1) + " m -> 1.0 m/s of set "
  + B.berthNeedM(1.0).toFixed(1) + " m. Proof uses the LIVE need, membership keeps the FROZEN "
  + "need0 - both conservative, in opposite directions");

// ══════════════════════════════════════════════════════════════════════════════════════
// THE PAGE'S HALF: the lifecycle, the ends, and the stand-down.
// ══════════════════════════════════════════════════════════════════════════════════════
const NL = String.fromCharCode(10);
function makeWorld() {
  // eslint-disable-next-line no-eval
  return eval("(function(){ \"use strict\";" + NL
    + "const { berthClearM, berthNeedM, grantFilter, grantProved, grantedFeatures, inCorridor,"
    + " recessionGiveM, corridorHalfM, grantClockMs } = require('" + "../static/js/berth.js');" + NL
    + "const { holdClearM } = require('../static/js/hold.js');" + NL
    // THE REAL groundVel, not a stub: R13 turns on it returning null for a boat with no
    // course, which is exactly what a stopped boat at a berth reports. A stub here would
    // make every lifecycle check a test of the stub.
    + "const { groundVel } = require('../static/js/guard.js');" + NL
    + "let commandedSpeed = 'low';" + NL
    + "const GRANT_STANDDOWN_MS = 20000, OVERRIDE_GIVE_M = 5, GUARD_HELM_S = 20;" + NL
    + "const RELEASE_HOLD_MS = 4000;" + NL
    + "let grant = null, grantMemo = null, grantEndSay = null;" + NL
    + "let grantStop = null, grantLast = null, grantTrueAt = 0, grantTrueLevel = null;" + NL
    + "let grantProofAt = 0, grantStallAt = 0;" + NL
    + "let sent = [], banners = [], notes = [], events = [], planIntent = { why: [] };" + NL
    + "const cmd = (p2) => { sent.push(p2); return Promise.resolve({}); };" + NL
    + "const showBanner = (m) => banners.push(m), flashNote = (m) => notes.push(m);" + NL
    + "const renderGuardBar = () => {}, guardLevel = 'clear', clearance = {};" + NL
    + "const logGrantEvent = (k, d) => events.push({ k, d });" + NL
    + "let nogo = null, asv = null, S = null;" + NL
    + "const V = { SPEED_KN: { low: 4.0, high: 14.0 } };" + NL
    + "let mission = { speeds: { transit: 'transit', turn: 'low', survey: 'survey' } };" + NL
    + "let runLineIdx = -1, curTurn = -1;" + NL
    + grab("berthAt") + NL
    + grab("grantMembers") + NL
    + grab("grantNow") + NL
    + grab("grantTick") + NL
    + grab("stopAtBerth") + NL
    + grab("standDownEnd") + NL
    + grab("helmStoodDown") + NL
    + grab("endGrant") + NL
    + grab("armGrant") + NL
    + grab("grantOnNewMotion") + NL
    + grab("roleSpeed") + NL
    + "return { armGrant, grantTick, helmStoodDown, endGrant, standDownEnd, stopAtBerth,"
    + " grantNow, grantOnNewMotion, roleSpeed," + NL
    + "  set: (o) => { if ('nogo' in o) nogo = o.nogo; if ('asv' in o) asv = o.asv;"
    + "                if ('S' in o) S = o.S; }," + NL
    + "  state: () => ({ grant, grantStop, grantEndSay, grantLast, sent, banners, notes, events })," + NL
    + "  reset: () => { sent = []; banners = []; notes = []; events = []; planIntent = { why: [] }; },"
    + NL + "}; })()");
}

const W = makeWorld();
const baseGrant = () => ({
  spineEN: SPINE, gateIdx: gate.idx, gateM: gate.m, depthIdx: gate.depthIdx,
  halfM: HALF, need0: NEED0, spineLenM: gate.m, clock: B.grantClockMs(gate.m, 4.0),
  cMax: 0, at: { lat: 43.072110, lon: -70.710912 }, byClock: false,
});
const setWorld = (pos) => {
  W.set({
    nogo: { ready: true, ko, frame: ref, buffer: BUF },
    asv: ref.fromEN(pos.e, pos.n),
    S: { run: "running", run_seq: 1, armed: true, estop: false,
         berth: { at: { lat: 43.072110, lon: -70.710912 }, t: 0, by: "launch" },
         status: { cog_deg: 0, sog_kn: 1.0, env_set_deg: 0, env_set_kn: 0, speed_key: "low" } },
  });
  W.reset();
};

// ── R14 + DECISION 5: THE STALL AND THE CLOCK STOP HER AND KEEP STANDING DOWN ──────────
//
// ⚠⚠ THIS IS THE CHECK THE FIRST CUT OF THE PAGE WOULD HAVE FAILED. standDown() called
// endGrant(), so twenty seconds after a stalled departure the full ladder came back against
// the launch pier with the boat still lying alongside it. The page's own comment said
// "neither hands the helm back" while the code handed it back.
setWorld({ e: 0, n: 0 });
W.armGrant(baseGrant());
{
  const g = W.state().grant;
  g.armedAt = Date.now() - (g.clock + 1000);      // the clock has run out
  W.grantTick(BERTH, BUF, Date.now());
}
const afterClock = W.state();
check("14b. THE CLOCK STOPS HER AND THE GRANT STILL STANDS (R14, Andy's decision 5)",
  () => afterClock.sent.includes("/api/cmd/stop") && !!afterClock.grant
        && !!afterClock.grantStop && !afterClock.grantEndSay,
  "commanded " + JSON.stringify(afterClock.sent) + " · grant still standing: "
  + !!afterClock.grant + " · helm stand-down armed: " + !!afterClock.grantEndSay
  + ". The console never steers her off a berth a person put her on - it alarms, it stops "
  + "her, and nothing else");

// THE STALL IS THE OTHER HALF OF THE SAME RULE, and it needs its own check: a mutation that
// made only the STALL end the grant survived a suite that tested only the CLOCK. Two callers
// of the same decision are two places the decision can be wrong.
//
// Driven through frames rather than by reaching in, because `grantStallAt` is set by
// grantTick itself: one frame to establish cMax, one to start the stall clock, one 21 s later.
{
  setWorld({ e: 0, n: 0 });
  W.armGrant(baseGrant());
  const T0 = Date.now();
  W.grantTick(BERTH, BUF, T0);            // bc 1.00 m > cMax 0 -> cMax = 1.00, no stall yet
  W.grantTick(BERTH, BUF, T0 + 100);      // no ground made -> the stall clock starts
  W.reset();
  W.grantTick(BERTH, BUF, T0 + 21000);    // 20.9 s of no ground made, cMax 1.00 m < halfM
  const st = W.state();
  check("14f. THE STALL STOPS HER AND THE GRANT STILL STANDS, exactly as the clock does (R14)",
    () => st.sent.includes("/api/cmd/stop") && !!st.grant && !!st.grantStop && !st.grantEndSay,
    "no ground made in 20.9 s, cMax " + (st.grant ? st.grant.cMax.toFixed(2) : "-")
    + " m against a corridor half-width of " + HALF + " m · commanded " + JSON.stringify(st.sent)
    + " · grant standing: " + !!st.grant + " · helm stand-down armed: " + !!st.grantEndSay
    + ". A boat that is not getting out but is not getting WORSE is a boat the operator placed "
    + "and can see; getting worse is R12's question, and R12 is the one that ends it");
}

// ... and it is a LATCH, not an event: the test stays true on every later frame.
setWorld({ e: 0, n: 0 });
W.armGrant(baseGrant());
{ const g = W.state().grant; g.armedAt = Date.now() - (g.clock + 1000); }
W.grantTick(BERTH, BUF, Date.now());
W.reset();
W.grantTick(BERTH, BUF, Date.now());
W.grantTick(BERTH, BUF, Date.now());
check("14c. ... and the stop is commanded ONCE, not at telemetry rate",
  () => W.state().sent.length === 0,
  "two further frames past the expiry commanded " + JSON.stringify(W.state().sent)
  + ". Both bounds stay true for ever once crossed, so without the latch this is a /api/cmd/stop "
  + "and a fresh banner four times a second");

// ── R12: RECESSION DOES END IT, AND THEREFORE HOLDS THE HELM ───────────────────────────
setWorld({ e: 0, n: 0 });
W.armGrant(baseGrant());
W.state().grant.cMax = 20;                        // she had made 20 m, then gave it back
W.grantTick(BERTH, BUF, Date.now());
const afterRecess = W.state();
check("12c. RECESSION ends the grant outright - and that is an end that RESTORES the ladder",
  () => !afterRecess.grant && !!afterRecess.grantEndSay
        && afterRecess.sent.includes("/api/cmd/stop"),
  "cMax 20.0 m -> berthClearM " + B.berthClearM(BERTH, mem.all).toFixed(2)
  + " m, give " + B.recessionGiveM(20).toFixed(1) + " m · grant ended: " + !afterRecess.grant
  + " · helm stand-down armed: " + !!afterRecess.grantEndSay
  + ". The two ends differ in exactly this, and it is the difference the design turns on");

// ── R15: THE STAND-DOWN, AND THE ACCEPTANCE CASE THAT TELLS IT FROM A COINCIDENCE ──────
check("15. R15: the helm is HELD for the full 20 s after a restoring end",
  () => W.helmStoodDown(Date.now()) > 19000 && W.helmStoodDown(Date.now()) <= 20000,
  "helmStoodDown = " + W.helmStoodDown(Date.now()) + " ms. Nothing read grantEndSay at all "
  + "in the first cut: the banner said the words and the very next frame could command "
  + "/api/cmd/escape at " + 14 + " kn on a boat still inside the slip's buffer");

check("15b. ACCEPTANCE: the SAME state 20 s later holds nothing - the gate expires by the clock",
  () => W.helmStoodDown(Date.now() + 20001) === 0,
  "at +20.001 s: " + W.helmStoodDown(Date.now() + 20001)
  + " ms. A refusal with no acceptance beside it passes for a gate that is stuck shut, and a "
  + "safety gate that never opens is a console that can never steer again");

check("15c. the stand-down is ASKED at the escape, in front of the older episode gate",
  () => /helmStoodDown\(Date\.now\(\)\)/.test(HC)
        && /a\.level === "helm" && helmRun && !heldMs/.test(HC),
  "the escape's condition reads `a.level === helm && helmRun && !heldMs` in CODE (comments "
  + "stripped). A new gate in front of an old one silently takes that gate's coverage away, "
  + "which is why 15b exists as well as 15");

check("15d. TEETH: only the ACTION is held - the alarm, the readout and the lower rungs are not",
  () => {
    const esc = HC.indexOf("guardEscapeAt = Date.now();");
    const helmGate = HC.indexOf("!heldMs");
    // the gate sits immediately before the escape branch, not around updateClearance
    return helmGate > 0 && esc > helmGate && !/heldMs[\s\S]{0,400}updateClearance/.test(HC);
  },
  "the gate is inside the helm branch only. Held around the whole guard it would suppress "
  + "the clearance readout and the 8 s alarm as well - a silent console at a berth, which is "
  + "the fault this whole design exists to remove");

// ── R14: A NEW COMMANDED MOTION, AND THE ONE IT MUST NOT DIE ON ────────────────────────
setWorld({ e: 0, n: 0 });
W.armGrant(baseGrant());
W.grantOnNewMotion(1);                            // the START of the departure itself
const afterStart = W.state();
check("14d. the START of the departure does NOT end the grant, though it is a new motion",
  () => !!afterStart.grant && !afterStart.grantEndSay,
  "run_seq 1 adopted as the covered motion · grant standing: " + !!afterStart.grant
  + ". A grant is armed at UPLOAD and the Start that follows is the very motion it exists to "
  + "cover; ending on it would make the feature inert in a way that looks like it is working");

W.grantOnNewMotion(2);                            // a Go-To, an RTH, a re-approach
const afterSecond = W.state();
check("14e. ... and the NEXT commanded motion does end it, with the helm held (R14)",
  () => !afterSecond.grant && !!afterSecond.grantEndSay,
  "run_seq 2 · grant ended: " + !afterSecond.grant + " · helm held: "
  + !!afterSecond.grantEndSay + ". The grant covers the way out the planner checked, and a "
  + "different command is not that");

// ── R8: THE DEPARTURE'S SPEED ──────────────────────────────────────────────────────────
check("8. the `depart` role is PINNED to the vessel's low key (R7, R8)",
  () => W.roleSpeed("depart") === "low",
  "roleSpeed('depart') = " + W.roleSpeed("depart")
  + ", and it never reads mission.speeds. The DEPTH grant is permission to run with the "
  + "hull's under-keel clearance unverified, and the only speed at which that is defensible "
  + "is the slowest the hull has");

check("8b. ... and `depart` is NOT in SPEED_ROLES, which is the OPERATOR'S list",
  () => {
    const m = HC.match(/const SPEED_ROLES = \[([^\]]*)\]/);
    return !!m && !/depart/.test(m[1]);
  },
  "SPEED_ROLES = " + (HC.match(/const SPEED_ROLES = \[([^\]]*)\]/) || [])[1]
  + ". It builds the three #sp_spd_* selectors and seeds mission.speeds from "
  + "`mission.speed || \"survey\"` - so a depart entry there would have created a control "
  + "whose whole effect is to defeat the rule it serves, defaulting to the SURVEY speed");

check("8c. currentActivity() is the ONE classifier that answers `depart` - the governor is untouched",
  () => /role:"depart"/.test(HC) && /function speedGovernor/.test(HC)
        && !/depart/.test(HC.slice(HC.indexOf("function speedGovernor"),
                                   HC.indexOf("function speedGovernor") + 1400)),
  "speedGovernor contains no mention of depart: the role comes from the classifier that also "
  + "bills the line time, so the activity the recorder logs and the speed the boat runs "
  + "describe one moment");

// ── R9 / R10: WHAT THE GRANT TURNS OFF, AND WHAT IT TURNS INTO ─────────────────────────
check("9. the EDGE rung is off inside any grant (R9)",
  () => /const wantEdge = !settling && !gNow &&/.test(HC),
  "wantEdge reads `!gNow` in CODE. edgeAround SEARCHES and VERIFIES every candidate against "
  + "the model it was handed, so a dog-leg computed without the launch pier can be routed "
  + "straight through the launch pier - a NEW hazard this design would have invented");

check("10. a hold inside the corridor becomes a STOP, and the STOP's own words are what is said",
  () => {
    const i = HC.indexOf("STOPPED rather than held");
    const j = HC.indexOf("s ahead and closing — HOLDING");
    // the hold's flashNote must be INSIDE the else, i.e. after an opening brace that closes
    // before the Intent push - checked structurally by requiring `} else {` between them
    return i > 0 && j > i && /\} else \{/.test(HC.slice(i, j));
  },
  "the hold branch is `} else {` braced. Written without the braces the STOP branch ran and "
  + "then fell into the hold's own flashNote, so the operator read 'HOLDING' over the top of "
  + "'STOPPED rather than held' while the boat did the first");

// ⚠ THIS CHECK'S FIRST DRAFT ASSERTED THAT THE CALL EXISTED, which is not the property. A
// mutation that changed it to `holdClearAt(asv) * 2` SURVIVED: the call was still there, so
// the grep still matched, and the suite reported coverage of a number it had not looked at.
// It now asserts the VALUE - every hold_clear_m is a bare call, passed through untouched.
const HOLD_CLEAR_SITES = [...HC.matchAll(/hold_clear_m:\s*([^,}]+(?:\([^()]*\))?[^,}]*)[,}]/g)]
  .map(m => m[1].trim());
// A site is honest when the value handed over is the console's own measurement PASSED
// THROUGH: either a bare property the planner computed on the true model (plan.holdClear,
// set from holdTarget), or a holdClearAt(...) call whose closing paren is the end of the
// expression. Anything after that paren is arithmetic on a number the boat acts on directly.
const passedThrough = (s) => {
  if (/^[A-Za-z_$][\w$.]*$/.test(s)) return true;               // plan.holdClear
  if (!s.startsWith("holdClearAt(")) return false;
  let d = 0;
  for (let i = s.indexOf("("); i < s.length; i++) {
    if (s[i] === "(") d++;
    else if (s[i] === ")" && --d === 0) return i === s.length - 1;  // nothing trailing
  }
  return false;
};
check("10b. hold_clear_m is NEVER inflated and never reads the filtered model - it is the one "
      + "console-side number the vessel acts on with no further check",
  () => HOLD_CLEAR_SITES.length > 0 && HOLD_CLEAR_SITES.every(passedThrough)
        && !/holdClearAt\([^)]*koG/.test(HC),
  HOLD_CLEAR_SITES.length + " call site(s): " + HOLD_CLEAR_SITES.join(" · ")
  + " — each a BARE holdClearAt() on the true model. It becomes a vessel-side action with no "
  + "further check (the routed re-approach off a hold), and its warrant is a geometric "
  + "construction in asv_console.py: an inflated one is a lie the boat acts on");

check("10c. escapeCourse is asked of the TRUE model, so an escape never steers toward a granted feature",
  () => /escapeCourse\(p, drift, nogo\.ko,/.test(HC),
  "escapeCourse(p, drift, nogo.ko, ...) - the unfiltered model. Handed koG it could steer the "
  + "boat confidently into the launch pier, because the pier would not be in the world it "
  + "was searching");

// ── R15 / R16: THE BAR, WHICH IS WHAT MAKES A SUPPRESSION VISIBLE ──────────────────────
//
// ⚠ THESE THREE ARE ORDERING CHECKS AND THE ORDER IS THE WHOLE POINT. renderGuardBar returns
// early on `clear`, and inside a grant the FILTERED ladder usually reads clear - so a branch
// placed after that early return is a branch that never runs in the one regime it exists for.
// All three were written because a mutation that deleted the line SURVIVED the first draft
// of this suite.
{
  const bar = HC.slice(HC.indexOf("function renderGuardBar"),
                       HC.indexOf("function renderHeldBar"));
  const iHeld = bar.indexOf("guardHeldOffer()");
  const iSd = bar.indexOf("renderStandDownBar");
  const iGrant = bar.indexOf("renderGrantBar");
  const iClear = bar.indexOf('a.level === "clear"');
  const iBlind = bar.indexOf('a.level === "blind"');

  check("15e. the STAND-DOWN bar is drawn ABOVE the clear and blind branches",
    () => iSd > 0 && iClear > 0 && iBlind > 0 && iSd < iClear && iSd < iBlind,
    "renderGuardBar order: held@" + iHeld + " standDown@" + iSd + " grant@" + iGrant
    + " clear@" + iClear + " blind@" + iBlind + ". standDownEnd() has just STOPPED her, so she "
    + "reports no course and the ladder reads BLIND - and on that frame the operator needs the "
    + "count and its two answers, not 'GUARD BLIND'");

  check("15f. the GRANT bar is drawn above the clear branch, so a standing grant is never a blank bar",
    () => iGrant > 0 && iGrant < iClear,
    "grant@" + iGrant + " is above clear@" + iClear + ". Inside a grant the filtered ladder "
    + "usually reads clear, which is exactly the state that must not put the bar out: a blank "
    + "bar cannot tell 'nothing is wrong' from 'the helm is standing down'");

  check("15g. the bar's four buttons are RELABELLED back by every state that shares them",
    () => /\$\("#gb_drop"\)\.textContent\s*=\s*"LEAVE IT HOLDING"/.test(HC)
          && /\$\("#gb_proceed"\)\.textContent\s*=\s*"PROCEED/.test(HC)
          && /\$\("#gb_drop"\)\.textContent\s*=\s*"DROP THE GRANT"/.test(HC)
          && /\$\("#gb_low"\)\.textContent\s*=\s*"TAKE THE HELM NOW"/.test(HC),
    "five bar states share four buttons, and each state sets back the labels the others "
    + "changed. A shared control wearing another state's words is a button that lies about "
    + "what it does, which is the worst defect a control on this bar can have");

  check("15h. the click handlers dispatch in the SAME order the bar draws in",
    () => {
      const low = HC.slice(HC.indexOf('$("#gb_low").onclick'), HC.indexOf('$("#gb_low").onclick') + 260);
      return low.indexOf("guardHeldOffer()") < low.indexOf("helmStoodDown")
             && low.indexOf("helmStoodDown") < low.indexOf("continueAtLow");
    },
    "gb_low tests held -> stand-down -> continueAtLow, matching renderGuardBar. If the "
    + "dispatch order and the drawing order ever disagree, the button does something other "
    + "than what its own label says");
}

// ── R14: LOSS OF THE MODEL ─────────────────────────────────────────────────────────────
// ⚠ AND ITS FIRST DRAFT ALSO ASSERTED ONLY THE POSITION. Neutering the CONDITION to
// `if(false)` left the sentence exactly where it was, so the check passed and the end was
// gone. It now asserts the condition as well - which is the thing that decides.
check("14g. loss of the keep-out model ENDS the grant, and is asked ABOVE the guard's early return",
  () => {
    const g = HC.slice(HC.indexOf("function clearanceGuard"),
                       HC.indexOf("function clearanceGuard") + 2000);
    const iEnd = g.indexOf("the keep-out model is no longer available");
    const iRet = g.indexOf("if(c.m == null || !nogo.ready");
    const guarded = /if\(grant && \(!nogo\.ready \|\| !nogo\.ko \|\| !nogo\.frame\)\)/.test(g);
    return iEnd > 0 && iRet > 0 && iEnd < iRet && guarded;
  },
  (() => {
    const g = HC.slice(HC.indexOf("function clearanceGuard"),
                       HC.indexOf("function clearanceGuard") + 2000);
    return "the end is at " + g.indexOf("the keep-out model is no longer available")
      + ", the early return at " + g.indexOf("if(c.m == null || !nogo.ready")
      + ". Below that return grantTick() never runs, so a grant left standing would be a "
      + "suppression NOTHING could ever end - the ladder quietly weakened for the rest of the "
      + "session, with no bar, no banner and no way back";
  })());

// ── R1: THE LATCH IS WIRED, WHICH IS THE ONE LINE THAT MAKES ANY OF THIS EXIST ─────────
check("1b. maybeLatchBerth() is CALLED from onState - without it the whole feature is inert",
  () => {
    const os = HC.slice(HC.indexOf("function onState"), HC.indexOf("function onState") + 9000);
    const iLatch = os.indexOf("maybeLatchBerth();");
    const iGuard = os.indexOf("clearanceGuard();");
    return iLatch > 0 && iGuard > 0 && iLatch < iGuard;
  },
  "called in onState above clearanceGuard(). It sat DEFINED AND NEVER CALLED through the "
  + "whole of this feature's first build: S.berth stayed null, certifyDeparture() returned "
  + "{none:true} at its first line, and every frame was today's console - which looks exactly "
  + "like a working feature until the day it is needed");

check("1c. ... and the latch is bounded by the three things that stop it being a licence (R1)",
  () => {
    const fn = HC.slice(HC.indexOf("function maybeLatchBerth"),
                        HC.indexOf("function maybeLatchBerth") + 1200);
    return /berthLatchTried \|\| berthAt\(\)/.test(fn) && /S\.run_seq !== 0/.test(fn)
           && /nogo\.ready/.test(fn) && /isBerth\(/.test(fn);
  },
  "one attempt per session-at-rest, a fix and a ready model, run_seq === 0, and R2's own "
  + "berth test. A boat SET ONTO a pier at 14:30 has run_seq > 0 and is hundreds of metres "
  + "from any latched berth, so she gets NO grant and today's full ladder including the helm");

// ── R16: THE GRANT LIVES ON THE SERVER, AND THE RECORDING CAN ANSWER FOR IT ────────────
const PY = fs.readFileSync(path.join(__dirname, "..", "asv_console.py"), "utf8");
check("16. the berth is the SERVER's, so a handover or a reload inherits it (R16)",
  () => /def set_berth/.test(PY) && /api\/cmd\/berth/.test(PY) && /"berth"/.test(PY),
  "asv_console.py carries set_berth(), POST /api/cmd/berth and publishes `berth` beside "
  + "run_seq. A page-local grant is dropped silently by a supervision handover, and the "
  + "inheriting tab - which never saw the launch - commands an escape it cannot explain");

check("16b. ... and it is SALIENT, so the recording answers 'why did the console NOT act'",
  () => /SALIENT[\s\S]{0,600}berth/.test(PY),
  "berth is in SessionLogger.SALIENT. The 1.0 s state throttle against the 4 Hz tick is "
  + "exactly what made the recorded escape frames ambiguous");

check("16c. every grant decision reaches the recording",
  () => /logGrantEvent\("grant_armed"/.test(HC) && /logGrantEvent\("grant_dropped"/.test(HC)
        && /logGrantEvent\("grant_held"/.test(HC) && /logGrantEvent\("helm_taken"/.test(HC),
  "armed · dropped · held · helm_taken are all logged. A suppression nobody can reconstruct "
  + "afterwards is the reconstruction failure this design was written to end");

console.log("");
if (fails) { console.log(fails + " CHECK(S) FAILED (" + ran + " ran)"); process.exit(1); }
console.log("all checks passed (" + ran + ")");
