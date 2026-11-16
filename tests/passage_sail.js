// tests/passage_sail.js - the passage, sailed: its sections, each sent ahead of her, the hold, the port, Divert, Continue.
//
// Andy, 2026-10-12: "Step 5" of the long-transit plan - sail the planned passage; and, asked what she does at the end
// of the last section sent with no window open to send the next: "she should hold". Here:
//   1-1c  THE SECTIONS (coarse.js cutSections): cut at every port and about every SECTION_M, each end at water clear
//         all round to hold in - never beside a danger, never in a port's circle; a stretch with no such water makes a
//         longer section; each section from where the last ended, its turning points between;
//   2     THE RECORD the passage is sailed from (sailRecord), and what is refused before it is (sailRefusal);
//   3     THE REST OF A SECTION from where she left it (sectionRest);
//   4-4b  SAIL PASSAGE: section 1 planned from her position through its turning points to its held end, sent as a
//         Transit with its hold disc and coast, the record kept on the plan; a section that cannot be planned - nothing
//         sent, nothing kept;
//   5-5d  AHEAD OF HER (passageTick): ONE WHOLE SECTION AHEAD (2026-10-15) - the next section planned and sent as soon as
//         she is on the last one sent (right after Sail; as she enters each), AFTER what she has left - read when it is
//         sent, not when it was planned; not while a whole section is still queued, not while the guard has something in hand,
//         not past a port, not twice inside a minute, not from a window that does not supervise; a route changed while
//         it planned, or a boat that reached her hold meanwhile - nothing sent;
//   6     SHE HOLDS at the end of the last section sent: the hold said - a fuel stop, the arrival, the end she waits at;
//   7     LEFT FOR ANOTHER COMMAND: a Go-To, an RTH, a Stop - where she left it kept; a guard escape is waited out;
//   8-8b  CONTINUE PASSAGE: from a hold, the next section from where she is; left mid-section, back to where she left it
//         and the rest of it; at a port, refused while what is aboard does not reach the next port with 20%; under way,
//         refused;
//   9     DIVERT: a Go-To, the leaving kept with the port; a Go-To that was not taken leaves the passage as it was;
//   10    the x drops it; the command bar's Continue passage shown only while she waits, gated in words;
//   10b   the drawing: each section's line, a mark at each end, an X where she left it;
//   11    THE WIRING: the end-of-plan RTH chain (and the card's prediction) stands down at a passage's hold; the tick on
//         every frame after the read-ahead; the buttons, the chart's row, the plan's loader, the coarse plan's sections.
// STEP 6 (Andy's plan: "RTH back along the corridor, the water-level offset per section"):
//   12-12e THE SECTIONS HOME (coarse.js homeSections): back the way it came when home is where it left from, on when
//         home is where it arrives, the shorter way round a passage that comes back to its start; rejoined where she
//         is, at a section's end the whole next section home; turning points reversed; the last ending at home; none
//         when home is at neither end or she is far off it;
//   13-13e THE WAY HOME, SAILED (homeRecord, sailHome, doRTH past RTH_MAX_M): the operator's RTH sent home along the
//         passage as an RTH, the passage on the plan becoming the way home; never the low-fuel monitor's, or to a
//         ROC's home; refused on too little fuel for the first port; each next section sent ahead of her as an RTH;
//         HOME at the end; a second RTH along the same passage; left and continued;
//   14-14e THE WATER A SECTION IS PLANNED AT (sectionLevel, sectionWater, atWaterLevel, chart.js buildKeepouts'
//         waterOffsetM): the lowest trusted level along it, chart datum otherwise, a manual level lowering it only;
//         read along its own points over the hours she is expected in it; planned on the chart built at that level,
//         the guard's own put back; the wiring.
// THE ARRIVAL IS THE END OF THE MISSION (Andy, 2026-11-12: "all end of mission should RTH unless over-ridden by user"):
//   16-16g an overnight passage from Pago Pago held at its arrival 7.5 h: sailOwnsHold owned the arrival, so the chain
//         stood down, and a chained RTH past RTH_MAX_M was refused rather than sailed home along the passage. Now the
//         chain's own condition (read out of onState) fires there and the card predicts it, from a reloaded tab too;
//         home far, she goes home along the passage as the RTH button sends her; in range, a routed RTH; End of plan
//         LOITER (the operator's word) holds her; a section's end, a fuel stop and the way home's own end stay holds;
//         a chained RTH refused - no passage, too little fuel - is recorded, so the cards stop promising one. And (the
//         review): along the passage from the ARRIVAL only - a far chain from a hold no record names is refused as
//         before; in a view-only tab nothing is planned, sent or claimed; a lost reply is not a refusal.
// THE CHART READ STOPPED UNDER THE WAY HOME (2026-11-15, a SAFETY defect an adversarial review found):
//   17w   the page's own coarse field home canceled the read it shared with the way home (the same tiles are the same
//         job: tests/passage_plan.js 16s drives the two against the console's own job code), and the planner answered
//         "canceled" as a plain error - final for the end-of-plan chain and the monitor. The page sends no cancel now,
//         and the planner ITSELF (passagePlanFor lifted, the console's read answering "canceled") answers a read
//         stopped from elsewhere late, not kept, naming the cause; handed that, the chain is asked again and not
//         recorded refused, the monitor told late, the operator told to press again.
//         TEETH (scratchpad mut_cc.py, the page on scratch copies through ASV_HTML), each caught by 17w (and by
//         passage_plan 16t): the stopped-read branch dead; answered without late; said kept; not logged; said in the
//         old words. (The Passage tab's line left "reading" is passage_plan 16t's alone: this suite stubs the line.)
//
//   node tests/passage_sail.js   # exit 0 = pass

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
const APP = process.env.ASV_APP || path.join(__dirname, "..");
const H = fs.readFileSync(process.env.ASV_HTML || path.join(APP, "static", "asv.html"), "utf8");
const C = require(path.join(APP, "static", "js", "coarse.js"));
const F = require(path.join(APP, "static", "js", "fuel.js"));
const PY = fs.readFileSync(path.join(__dirname, "..", "asv_console.py"), "utf8");   // the mission store (15c)

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = "THREW: " + e.message; }
  if (typeof detail === "function") { try { detail = detail(); } catch (e) { detail = "detail threw: " + e.message; } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}
function grab(name) {
  const start = H.search(new RegExp("(async )?function " + name + "\\("));
  if (start < 0) throw new Error("function " + name + " not found in the page (renamed?)");
  let k = H.indexOf("{", H.indexOf(")", start)), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
const decl = (name) => { const m = new RegExp("const " + name + " = [^;]+;").exec(H); if (!m) throw new Error(name + " gone"); return m[0]; };
// THE END-OF-PLAN CHAIN'S OWN CONDITION, read out of onState (16): an `if` in the frame handler, not a function, so the
// world evaluates its text - the gates the page fires on, not a copy of them
const CHAIN = /if\((s\.run==="running" && st\.holding && s\.completion==="rth"[\s\S]*?)\)\{\s*rthChained=true;/.exec(H);
if (!CHAIN) throw new Error("test setup: the end-of-plan chain's condition not found in onState (reworded?)");
const M = 111320;
const distTo = (a, b) => Math.hypot((b.lat - a.lat) * M, (b.lon - a.lon) * M * Math.cos((a.lat + b.lat) / 2 * Math.PI / 180));
const east = (p, m) => ({ lat: p.lat, lon: p.lon + m / (M * Math.cos(p.lat * Math.PI / 180)) });
console.log("The passage, sailed:");

(async () => {
  // ── 1. the sections ─────────────────────────────────────────────────────────────────────────────────────────────
  const N = C.GRID_N, N2 = N * N, CD = C.CELL_DEG;
  const grid = (tx, ty) => { const W = tx * C.TILE_DEG - 180, S = ty * C.TILE_DEG - 90;
    return { head: { tile: [W, S, W + C.TILE_DEG, S + C.TILE_DEG] }, C: new Int16Array(N2).fill(300), T: new Int16Array(N2).fill(300),
             A: new Int16Array(N2).fill(32767), tx, ty }; };
  const TX = Math.round((-70.75 + 180) / C.TILE_DEG), TY = Math.round((43.0 + 90) / C.TILE_DEG);
  const tiles = [0, 1, 2, 3].map((i) => grid(TX + i, TY));
  const ll = (g, c, r) => ({ lat: (g.ty * N + r + 0.5) * CD - 90, lon: (g.tx * N + c + 0.5) * CD - 180 });
  const A0 = ll(tiles[0], 10, 128), Z0 = ll(tiles[3], 245, 128);           // ~80 km east along one row of open water
  const p1 = C.planPassage({ grids: tiles, floorDm: 30, points: [{ ...A0, port: true }, { ...Z0, port: true }], sectionM: 20000 });
  const s1 = p1.sections || [];
  const f1 = C.buildField(tiles, 30);
  const ports1 = [A0, Z0].map((p) => C.cellOf(p));
  const allSafe = s1.slice(0, -1).every((c) => C.holdSafe(f1, c.to, ports1));
  const chained = s1.every((c, k) => k === 0 || distTo(c.from, s1[k - 1].to) < 1);
  const lens = s1.map((c) => c.lengthM);
  check("1. THE SECTIONS over ~80 km of open water: cut about every 20 km, each end water clear all round to hold in and "
        + "outside the ports' circles, each section from where the last ended, the last ending at the arrival (a port)",
        () => s1.length === 4 && lens.slice(0, -1).every((m) => Math.abs(m - 20000) < 2000) && allSafe && chained
              && s1[s1.length - 1].end === "port" && s1[s1.length - 1].port === 1 && s1.slice(0, -1).every((c) => c.end === "hold"),
        () => s1.length + " sections: " + lens.map((m) => (m / 1000).toFixed(1)).join(", ") + " km; safe " + allSafe + ", chained " + chained);

  // a fuel stop half way, and a CANAL where the 20 km mark falls: land across the whole tile but rows 127-129, 81 cells
  // along - the only way, so the route runs beside danger there whatever it prefers. (A shoal beside the line until
  // 2026-10-14: open water first now keeps the route off it, and the mark no longer fell beside anything.)
  const t1b = [0, 1, 2, 3].map((i) => grid(TX + i, TY));
  const mid = ll(t1b[1], 250, 128);
  const at20 = C.cellOf(east(A0, 20000)), g20 = t1b.find((g) => g.tx === Math.floor(at20.gx / N));
  for (let r = 0; r < N; r++) for (let c = -40; c <= 40; c++) {
    if (r >= 127 && r <= 129) continue;
    const gx = at20.gx + c - g20.tx * N; if (gx >= 0 && gx < N) { g20.C[r * N + gx] = 0; g20.T[r * N + gx] = 0; }   // land
  }
  const p1b = C.planPassage({ grids: t1b, floorDm: 30, points: [{ ...A0, port: true }, { ...mid, port: true }, { ...Z0, port: true }], sectionM: 20000 });
  const s1b = p1b.sections || [];
  const f1b = C.buildField(t1b, 30);
  const k20 = s1b.findIndex((c) => c.end === "hold");
  const cutOff = k20 >= 0 ? Math.abs(s1b[k20].lengthM - 20000) : -1;
  check("1b. A FUEL STOP is always a section's end (a port); where the 20 km mark falls beside a danger, the end moves to "
        + "clear water - never beside it",
        () => s1b.some((c) => c.end === "port" && c.port === 1 && distTo(c.to, mid) < 1) && k20 >= 0
              && C.holdSafe(f1b, s1b[k20].to, [A0, mid, Z0].map((p) => C.cellOf(p))) && cutOff > 300,
        () => s1b.map((c) => c.end + " " + (c.lengthM / 1000).toFixed(1)).join(" | ") + "; the cut moved " + cutOff.toFixed(0) + " m");

  // a long stretch with no water clear all round: a canal the whole way, dangers touching both its sides and land past
  // them - one longer section. (Two rows of shoal across open water until 2026-10-14: open water first now leaves them
  // for the clear water beside them, where she can hold.)
  const t1c = [0, 1].map((i) => grid(TX + i, TY));
  for (const g of t1c) for (let c = 0; c < N; c++) {
    g.T[127 * N + c] = 10; g.T[129 * N + c] = 10;
    for (let r = 0; r < N; r++) if (r < 127 || r > 129) { g.C[r * N + c] = 0; g.T[r * N + c] = 0; }
  }
  const B1 = ll(t1c[1], 240, 128);
  const p1c = C.planPassage({ grids: t1c, floorDm: 30, points: [{ ...A0, port: true }, { ...B1, port: true }], sectionM: 15000 });
  check("1c. A STRETCH WITH NO WATER TO HOLD IN makes one longer section, not a hold beside a danger",
        () => p1c.sections && p1c.sections.length === 1 && p1c.sections[0].end === "port",
        () => JSON.stringify((p1c.sections || []).map((c) => [c.end, (c.lengthM / 1000).toFixed(1)])));

  // short sections and ports close together: no hold end within a port's circle
  const t1d = [0, 1].map((i) => grid(TX + i, TY));
  const D1 = east(A0, 15000), D2 = east(A0, 30000);
  const p1d = C.planPassage({ grids: t1d, floorDm: 30, points: [{ ...A0, port: true }, { ...D1, port: true }, { ...D2, port: true }], sectionM: 6000 });
  const holds1d = (p1d.sections || []).filter((c) => c.end === "hold");
  const nearest1d = Math.min(...holds1d.map((c) => Math.min(...[A0, D1, D2].map((p) => distTo(c.to, p)))));
  check("1d. NO HOLD IN A PORT'S CIRCLE: sections of ~6 km between ports 15 km apart - every end that is not a port at "
        + "least " + C.PORT_R_M / 1000 + " km from every port",
        () => holds1d.length >= 2 && nearest1d >= C.PORT_R_M - 150,
        () => holds1d.length + " hold ends, the nearest " + nearest1d.toFixed(0) + " m from a port");

  // ── the page's block, lifted ────────────────────────────────────────────────────────────────────────────────────
  const vessel = JSON.parse(fs.readFileSync(path.join(APP, "vessels", "drix08_em712.json"), "utf8"));
  const model = F.energyModel(vessel, 10);
  const HERE = { lat: 43.07, lon: -70.71 };
  const sec = (from, to, via, end, port) => ({ from, to, via: via || [], end: end || "hold", port: port == null ? null : port, lengthM: distTo(from, to) });
  const P0 = east(HERE, 0), P1 = east(HERE, 20000), P2 = east(HERE, 40000), P3 = east(HERE, 60000);
  const PLAN = () => ({ points: [{ ...HERE, port: true, t: 0 }, { ...P2, port: true, t: 1 }, { ...P3, port: true, t: 2 }],
    legs: [{ lengthM: 40000 }, { lengthM: 20000 }], twKn: 7, floorM: 3.15,
    sections: [sec(P0, P1, [east(HERE, 10000)]), sec(P1, P2, [east(HERE, 30000)], "port", 1), sec(P2, P3, [], "port", 2)],
    fuelLegs: [{ from: { t: 0 }, to: { t: 1 } }, { from: { t: 1 }, to: { t: 2 } }], fuel: [{ ok: true }, { ok: true }] });
  const world = (o) => {
    const w = Object.assign({ S: { armed: true, estop: false, run: "idle", status: { fuel_l: 200, holding: false }, wp_total: 0 },
      asv: { ...HERE }, wpIndex: 0, mission: { passage: null }, passage: PLAN(), runRoute: null, cmds: [], banners: [], notes: [],
      logs: [], missions: [], saves: 0, canCommand: true, sup: true, planned: [], quiet: true, refuse: null, unroutable: 0, ownsKind: null,
      gotoTakes: true, planIntent: null, planGen: 0, waterAsked: [], levels: [], banked: [],
      level: { m: 0.35, say: "+0.35 m, the lowest predicted along it over the next 4.0 h (Test Harbor, 3 km off)" } }, o || {});
    const src = [
      "let S = w.S, asv = w.asv, mission = w.mission, passage = w.passage, runRoute = w.runRoute, runUnsafe = [], planIntent = w.planIntent, planGen = w.planGen, cmdGen = 0, escapeGen = 0;",
      "const window = {get _wpIndex(){ return w.wpIndex; }};",
      "let routeCmdsInFlight = 0, escapeThrottle = !w.quiet, guardActedAt = 0, guardEdgeAt = 0, aisAroundBusy = false, heldResuming = false;",
      "let lockTransit = null; const lockEnd = () => {};",     // a passage ends a lock transit before its sections plan (2026-10-18): none here
      "const clearance = {slowed: false}, EDGE_REASSESS_MS = 2000, M_PER_DEG_LAT = 111320;",
      "const distTo = w.distTo, FUEL_RESERVE_FRAC = w.F.FUEL_RESERVE_FRAC, passageFuel = w.F.passageFuel, energyLevel = w.F.energyLevel;",
      "const fuelModel = () => w.model, V = {SPEED_KN: {transit: 7}}, roleSpeed = () => 'transit';",
      "const fuelFmt = (m, x) => x.toFixed(1) + ' L', fmtDist = (m) => (m / 1000).toFixed(1) + ' km';",
      "const passageRefusal = () => w.refuse, passageName = (p) => p && p.t ? 'P' + p.t : 'her position';",
      "const canCommand = () => w.canCommand, supervising = () => w.sup;",
      "const saveMission = () => { w.saves++; }, logClient = (k, d) => w.logs.push([k, d]);",
      // a new mission's history (2026-10-14, newMission): Sail passage starts one (4, 4b)
      "const newMission = (t0, what) => w.missions.push({t0, what});",
      "const showBanner = (t) => w.banners.push(t), flashNote = (t) => w.notes.push(t), render = () => {}, applyCmdState = () => {}, updateTransitPanel = () => {}, updateMissionCard = () => {};",
      // (asked counted, and refused when the world says so: the rejoin at a Go-To's end asks nothing, 7d)
      // (`duringCover`: run while a section's chart is read - a Stop pressed there, 17l)
      "const guiConfirm = async () => { w.confirms = (w.confirms || 0) + 1; return w.confirm !== false; }, ensureNogoCovers = async () => { if (w.duringCover) w.duringCover(w, api); return true; }, holdOpts = () => ({}), transitStandoffM = () => 20;",
      "const planInsideChart = async (pts, opts, plan) => { if (w.duringPlan) w.duringPlan(w, api); return plan(); };",
      "const holdTarget = (to) => ({to, heldOff: null, holdClear: 40});",
      "const holdClearWithContacts = (p, m) => m, routeTooLong = () => false, solveCoastFor = () => ({groundM: 55});",
      "const routePlan = (from, line, kr, std, ta, ro) => { w.planned.push({from, line, ow: ro && ro.openWater}); return {route: line.map((p) => ({lat: p.lat, lon: p.lon})), unroutable: Array(w.unroutable).fill(0)}; };",
      // (the command's answer is the world's `post` when it sets one - refused, lost, never sent (16g) - and taken otherwise;
      // took and notTookSay are the page's own, which keep those three apart)
      "const routeCmd = async (p, b) => { w.cmds.push([p, b]); return w.post || {ok: true, state: {status: {}}}; };",
      grab("took"), grab("notTookSay"), "const releaseEscapeClaim = () => {};",
      // (cmdGen and escapeGen as the page counts them - rthFence's, the 2026-11-14 review)
      "const setPlanIntent = (k, p, r, own) => { planGen++; if (k === 'escape') escapeGen++; else if (!own) cmdGen++; planIntent = {kind: k, why: [], route: r.length}; };",
      "const legStartsHere = () => {}, setTip = (el, t) => { el.tip = t; };",
      // step 6: the water a section is planned at (stubbed here; 14 drives the real ones), and doRTH's way home
      "const sectionWater = async (P, from, pts, append) => { w.waterAsked.push({from, pts, append}); return w.level; };",
      "const atWaterLevel = (m, fn) => { w.levels.push(m); return fn(); };",
      // THE ROUTE WORKER (2026-10-12) is not here: each search runs on this thread as it always did (tests/route_worker.js) - the
      // section's model at its water handed to it (koAtLevel) and the search run here, in atWaterLevel, as it was
      "const koAtLevel = (m) => ({atLevel: m}), planOffThread = async (job, here) => here();",
      // (RTH_MAX_M is 10 x this: 50 km, or what the world sets - 16f's 15 km, so a fuel stop 40 km out is past it)
      "let rthChainFailed = false; const NOGO_RADIUS_M = w.nogoR || 5000, homeSections = w.C.homeSections;",
      // the end of the mission (16): the card's prediction and the chain's condition, both the page's own, and what an
      // RTH in range plans through (its route straight home here: the planner is not what is judged)
      decl("CHAINABLE_BEHAVIORS"), grab("chainableRun"), "let pendingHold = null;", grab("heldSplitRun"),
      grab("runCompletion"), grab("runHolds"), grab("rthPending"),
      "const chainFires = (s, st, seqMoved, rthChained) => (" + CHAIN[1] + ");",
      "const planNogoRoute = (from, to) => { w.nogoAsked = (w.nogoAsked || 0) + 1; return {route: [from, to], holdClear: 30}; };",
      "const setViolation = () => {}, clearViolation = () => {}, unchartedTip = () => '', CHART_FAILED_TIP = '', takeDownBanner = () => {};",
      "const openWaterNote = () => '', buoyageNote = () => '', offshoreNote = () => '', deepNote = () => '', mooredNote = () => '', heldOffWhy = () => '';",
      "let fuelNow = null;",
      "let passagePreRead = w.preRead || null;",   // section 1's chart read, begun at planning (4c)
      "const surveyBreakNow = () => w.brk || null, bankBreak = (b) => w.banked.push(b);",
      decl("RTH_MAX_M"),
      "const ctx = new Proxy({}, {get: (t, k) => (k in t ? t[k] : (...a) => { w.ops.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; return true; }});",
      "const doGoTo = async (ll) => { w.cmds.push(['goto', ll]); if (w.gotoTakes) { planGen++; cmdGen++; planIntent = {kind: 'goto', why: []}; if (w.gotoRoute) runRoute = w.gotoRoute; } };",
      "const $ = (id) => w.dom[id] || (w.dom[id] = {style: {}, classList: {toggle(c, on){ this[c] = on; }}, disabled: false});",
      decl("PASSAGE_CASING"), grab("strokeCased"), grab("fillHaloed"),
      "const PASSAGE_PORT_R_M = w.C.PORT_R_M;", grab("sectionPorts"), grab("sectionAtPort"), grab("portSectionLine"),
      // (the join point: the page's model when it is ready, passage.js passageJoinVia - here what the world says, 8e)
      "const nogo = w.nogo || {ready: false};",
      "const passageJoinVia = (line, ends, frame, ko, std) => { w.joins = (w.joins || []).concat([{line, ends, frame, ko, std}]); return w.joinVia === undefined ? null : w.joinVia; };",
      decl("PASSAGE_RETRY_MS"), decl("PASSAGE_END_M"), decl("PASSAGE_HOLD_NEAR_M"), decl("PASSAGE_ONGOING"),
      "let sailBusy = false, sailTriedAt = 0, sailSaid = null;",
      // THE PASSAGE HOME FROM HERE (17, 2026-11-13): Plan passage's planner is the world's - `homePlan(points)` its answer
      // (none: refused, as no chart in this world), `duringHomePlan` run while it plans (a Stop pressed, 17d) - and a Stop
      // is the page's routeStopGen; the Passage tab's busy flag and its status line are the page's own names
      "let passageBusy = !!w.passageBusy, passageStatus = '', routeStopGen = 0, routeStopName = null;",
      // (the review, 2026-11-13: one way home planned at a time and joined; the chain asked again after "busy" - its timer the
      // world's `later`, run by the check; the monitor's rule at the send; the press kept)
      "let homeFlight = null, rthChainBusyAt = 0, rthChained = !!w.rthChained;", decl("RTH_BUSY_RETRY_MS"),
      "const setTimeout = (fn, ms) => { if (ms !== RTH_BUSY_RETRY_MS) return globalThis.setTimeout(fn, ms); w.later = (w.later || []).concat([{fn, ms}]); };",
      "const passagePlanFor = async (points, say, gone) => { w.homeAsked = (w.homeAsked || []).concat([{points, busy: passageBusy}]); say('reading');"
        + " if (w.duringHomePlan) w.duringHomePlan(w, api); if (gone()) return {gone: true};"
        + " return w.homePlan ? (typeof w.homePlan === 'function' ? w.homePlan(points) : {plan: w.homePlan}) : {error: 'no chart in this world'}; };",
      ["passageEndsSay", "sailRecord", "sailPortName", "sailRefusal", "sailSegM", "sectionRest", "sailOwns", "sailGuardQuiet", "sailLeftM", "sailSend",
       "sailPassage", "sailAppend", "sailAtEnd", "sailBreakOff", "sailRejoinHere", "sailRejoinTick", "passageTick", "sailRestM",
       "sailFuelShort", "continueRefusal", "continuePassage", "continueSend", "divertPassage", "dropPassage", "renderPassageControls", "sailLine", "sailOwnsHold", "sailArrival", "sailArrived", "drawSail",
       "rthTooFar", "doRTH", "passageHome", "homeRecord", "sailHome",
       "passageHomeRefusal", "homePassageRecord", "homePassageRefusal", "sailHomeFresh", "sailHomeFreshRun", "rthFence", "rthChainRetry"].map(grab).join("\n"),
      "const api = {sailRecord, sailRefusal, sectionRest, sailPassage, passageTick, sailAtEnd, continuePassage, continueRefusal, divertPassage,",
      "  dropPassage, renderPassageControls, sailOwnsHold, sailLine, drawSail, doRTH, homeRecord, rthPending, chainFires, setPlanIntent,",
      "  passageHomeRefusal, homePassageRecord, stop: (name) => { routeStopGen++; routeStopName = name; },",
      "  st: () => ({mission, runRoute, planIntent, planGen, cmdGen, escapeGen, passage, sailBusy, passageBusy, rthChainFailed, rthChained, rthChainBusyAt, homeFlight}), set: (k, v) => { eval(k + ' = v'); }};",
      "return api;",
    ].join("\n");
    w.dom = {}; w.F = F; w.C = C; w.model = model; w.distTo = distTo;
    w.api = new Function("w", src)(w);
    return w;
  };
  const settle = () => new Promise((r) => setTimeout(r, 0));

  // ── 2. the record, and what is refused ──────────────────────────────────────────────────────────────────────────
  const W2 = world();
  const R2 = W2.api.sailRecord(PLAN());
  const ref = (o, plan) => world(o).api.sailRefusal(plan === undefined ? PLAN() : plan);
  const bad = PLAN(); bad.legs[1].error = "blocked";
  const shortF = PLAN(); shortF.fuel[1] = { ok: false };
  const endsBad = PLAN(); endsBad.ends = { dep: { ok: true, km: 2, wpts: 9 }, arr: { ok: false, why: "no route clear of the chart's keep-outs on 1 leg(s)" } };
  const r2 = { none: ref({}, null), leg: ref({}, bad), fuel: ref({}, shortF), moved: ref({ asv: east(HERE, 5000) }),
               arm: ref({ canCommand: false, S: { armed: false, estop: false, run: "idle", status: {}, wp_total: 0 } }), busy: ref({ mission: { passage: { state: "running" } } }), hull: ref({ refuse: "long passages are for the diesel hulls" }),
               ends: ref({}, endsBad), ok: ref({}) };
  check("2. THE RECORD: the plan's points and sections, ready, nothing sent - and refused first, in words: no plan, a leg "
        + "not planned, a fuel leg short of 20%, planned from where she no longer is, not armed, a passage already sailed, a "
        + "battery hull; and (ENDS FIRST, 2026-10-14) a plan whose arrival could not be planned in detail",
        () => R2.state === "ready" && R2.sent === -1 && R2.sections.length === 3 && R2.points.length === 3 && !R2.breakoff
              && /Plan passage/.test(r2.none) && /could not be planned/.test(r2.leg) && /P1 to P2 does not arrive with 20%/.test(r2.fuel)
              && /no longer is/.test(r2.moved) && /arm her first/.test(r2.arm) && /drop it first/.test(r2.busy)
              && /diesel/.test(r2.hull) && r2.ok === null
              && r2.ends === "its ends could not be planned in detail - arriving: no route clear of the chart's keep-outs on 1 leg(s)",
        () => JSON.stringify(r2).slice(0, 400));

  // ── 3. the rest of a section ────────────────────────────────────────────────────────────────────────────────────
  const V1 = east(HERE, 5000), V2 = east(HERE, 10000), V3 = east(HERE, 15000);
  const S3 = sec(P0, P1, [V1, V2, V3]);
  const rest = (m) => W2.api.sectionRest(S3, { lat: HERE.lat + 0.0005, lon: east(HERE, m).lon }).map((p) => Math.round(distTo(HERE, p) / 1000));
  check("3. THE REST OF A SECTION from where she left it: the turning points after the stretch she was nearest - all of "
        + "them near its start, the last two between the first and second, none on its last stretch",
        () => JSON.stringify(rest(1000)) === "[5,10,15]" && JSON.stringify(rest(7000)) === "[10,15]" && JSON.stringify(rest(18000)) === "[]",
        () => JSON.stringify([rest(1000), rest(7000), rest(18000)]));

  // ── 4. Sail passage ─────────────────────────────────────────────────────────────────────────────────────────────
  const W4 = world();
  await W4.api.sailPassage();
  const st4 = W4.api.st(), P4 = st4.mission.passage, c4 = W4.cmds[0];
  check("4. SAIL PASSAGE: section 1 - it leaves a port - planned from her position to its held end AS A GO-TO IS, none "
        + "of the coarse route's turning points (its water still judged along them), sent as a Transit with its hold disc "
        + "and coast; the record kept on the plan - running, section 1 sent, its end and route; the coarse plan handed "
        + "over; said and logged",
        () => W4.planned.length === 1 && distTo(W4.planned[0].from, HERE) < 1 && W4.planned[0].line.length === 1
              && distTo(W4.planned[0].line[0], P1) < 1
              && W4.waterAsked.length === 1 && W4.waterAsked[0].pts.length === 2 && distTo(W4.waterAsked[0].pts[0], east(HERE, 10000)) < 1
              && c4 && c4[0] === "/api/cmd/transit" && c4[1].hold_clear_m === 40 && c4[1].coast_from_m === 55 && c4[1].route.length === 1
              && P4 && P4.state === "running" && P4.sent === 0 && P4.base === 0 && distTo(P4.end, P1) < 1 && P4.route.length === 1
              && W4.saves > 0 && st4.passage === null
              && /PASSAGE UNDER WAY: section 1 of 3 sent \(1 waypoints, planned at \+0\.35 m, the lowest predicted/.test(W4.banners.pop() || "")
              && W4.logs.some((l) => l[0] === "passage_sail" && l[1].ok)
              && W4.missions.length === 1 && W4.missions[0].what === "Sail passage",   // a new mission's history (2026-10-14)
        () => JSON.stringify({ planned: W4.planned.length, cmd: c4 && [c4[0], c4[1].route.length, c4[1].hold_clear_m], P: P4 && [P4.state, P4.sent] }));
  const W4b = world({ unroutable: 1 });
  await W4b.api.sailPassage();
  check("4b. A FIRST SECTION THAT CANNOT BE PLANNED: nothing sent, nothing kept, said",
        () => W4b.cmds.length === 0 && W4b.api.st().mission.passage === null && /NOT sailed: its first section could not be sent - no route clear/.test(W4b.banners[0] || "")
              && W4b.missions.length === 0,
        () => JSON.stringify(W4b.banners));

  // ── 4c. SAIL WAITS FOR SECTION 1'S CHART IMAGE IF IT IS STILL BEING READ (2026-10-15) ────────────────────────────
  // The read begun when the passage was planned (passage_plan 16h): a second asker's read returns at once while one is in
  // hand (chartInk.busy), so Sail pressed during it would plan section 1 without the chart image - it waits. A read that
  // is over, or one begun for another plan, is not waited on.
  let release4c = null;
  const PL4c = PLAN(), W4c = world({ passage: PL4c, preRead: { plan: PL4c, over: false, done: new Promise((r) => { release4c = r; }) } });
  const sail4c = W4c.api.sailPassage();
  await settle(); await settle();
  const waited = W4c.planned.length === 0 && W4c.cmds.length === 0 && W4c.notes.some((n) => /still being read - sailing as soon as it is in/.test(n));
  release4c(); await sail4c;
  const PL4d = PLAN(), W4d = world({ passage: PL4d, preRead: { plan: PL4d, over: true, done: new Promise(() => {}) } });
  W4d.api.sailPassage(); await settle(); await settle();   // (not awaited: a wrong wait would hang, not fail)
  const W4e = world({ preRead: { plan: PLAN(), over: false, done: new Promise(() => {}) } });   // another plan's read
  W4e.api.sailPassage(); await settle(); await settle();
  check("4c. SAIL WAITS FOR SECTION 1'S CHART IMAGE while it is still being read (said), then sails; a read that is over, or "
        + "one begun for another plan, is not waited on",
        () => waited && W4c.cmds.length === 1 && W4c.planned.length === 1 && W4d.cmds.length === 1 && W4e.cmds.length === 1,
        () => JSON.stringify({ waited, after: W4c.cmds.length, over: W4d.cmds.length, other: W4e.cmds.length }));

  // ── 5. ahead of her ─────────────────────────────────────────────────────────────────────────────────────────────
  const running = (o) => {
    const route = [east(HERE, 5000), east(HERE, 10000), east(HERE, 15000), { ...P1 }];
    const P = { ...world().api.sailRecord(PLAN()), state: "running", sent: 0, base: 0, end: { ...P1 }, route };
    return world(Object.assign({ mission: { passage: P }, runRoute: route, S: { armed: true, estop: false, run: "running",
      status: { holding: false, fuel_l: 200 }, wp_total: 4 }, wpIndex: 3, asv: east(HERE, 12000) }, o || {}));
  };
  const W5 = running();
  W5.duringPlan = (w) => { w.wpIndex = 3; };                // she moved on while it planned: the prefix is read when sent
  W5.api.passageTick(W5.S);
  await settle(); await settle();
  const c5 = W5.cmds[0], P5 = W5.api.st().mission.passage;
  check("5. AHEAD OF HER: on the last section sent, section 2 planned FROM the "
        + "end of the route she flies and sent after what she has LEFT of it - read when sent - its end the section's port "
        + "(a port's section: to its end as a Go-To is)",
        () => W5.planned.length === 1 && distTo(W5.planned[0].from, P1) < 1 && c5 && c5[1].route.length === 1 + 1
              && distTo(c5[1].route[0], P1) < 1 && distTo(c5[1].route[c5[1].route.length - 1], P2) < 1
              && P5.sent === 1 && P5.base === 1 && distTo(P5.end, P2) < 1
              && W5.logs.some((l) => l[0] === "passage_section" && l[1].ok && l[1].water_m === 0.35)
              && W5.notes.some((n) => /^Passage: section 2 of 3 planned at \+0\.35 m, .*and sent ahead of her\.$/.test(n)),
        () => JSON.stringify({ planned: W5.planned.length, route: c5 && c5[1].route.map((p) => Math.round(distTo(HERE, p) / 1000)), P: [P5.sent, P5.base] }));
  const quietOf = (o, pre) => { const w = running(o); if (pre) pre(w); w.api.passageTick(w.S); return w; };
  // a whole section still queued beyond hers: section 1 with section 2 behind it in the route she flies (sent 1, its
  // waypoints from 4 on), and she on section 1's third waypoint
  const QROUTE = [east(HERE, 5000), east(HERE, 10000), east(HERE, 15000), { ...P1 }, east(HERE, 30000), { ...P2 }];
  const queuedOf = (wp) => quietOf({ runRoute: QROUTE, wpIndex: wp, S: { armed: true, estop: false, run: "running", status: { holding: false, fuel_l: 200 }, wp_total: 6 } },
    (w) => { const P = w.mission.passage; P.sent = 1; P.base = 4; P.end = { ...P2 }; P.route = QROUTE; P.sections[1].end = "hold"; });
  const far = queuedOf(2);
  const guard = quietOf({ quiet: false });
  const port = quietOf({}, (w) => { w.mission.passage.sections[0].end = "port"; });
  const notSup = quietOf({ sup: false });
  // a section that could not be planned, ticked again at once: not planned again inside PASSAGE_RETRY_MS
  const W5c = running({ unroutable: 1 }); W5c.api.passageTick(W5c.S); await settle(); await settle();
  W5c.api.passageTick(W5c.S); await settle(); await settle();
  check("5b. NOT YET, OR NOT AT ALL: a whole section still queued beyond hers; the guard with something in hand; past a port (she stops there); "
        + "a window that does not supervise; and a section that could not be planned is not tried again inside "
        + "PASSAGE_RETRY_MS (said once)",
        () => [far, guard, port, notSup].every((w) => w.cmds.length === 0 && w.planned.length === 0)
              && W5c.planned.length === 1 && W5c.cmds.length === 0 && /could NOT be planned/.test(W5c.banners.join(" ")),
        () => JSON.stringify([far, guard, port, notSup].map((w) => w.cmds.length)) + "; retried " + W5c.planned.length + "x");
  const W5d = running();
  // the guard moved the route meanwhile - a way round in its middle: the same length, the same end, still the passage's
  W5d.duringPlan = (w, api) => { api.set("runRoute", w.runRoute.map((p, i) => i === 1 ? { lat: p.lat + 0.001, lon: p.lon } : { ...p })); };
  W5d.api.passageTick(W5d.S); await settle(); await settle();
  const W5e = running();
  W5e.duringPlan = (w) => { w.S.status.holding = true; };                         // she reached her hold meanwhile
  W5e.api.passageTick(W5e.S); await settle(); await settle();
  check("5c. ONLY TO THE ROUTE IT WAS PLANNED AFTER, NEVER TO A HOLD: the route changed while it planned, or she reached "
        + "the end and holds - nothing sent (she waits for Continue)",
        () => W5d.planned.length === 1 && W5d.cmds.length === 0 && W5e.planned.length === 1 && W5e.cmds.length === 0,
        () => JSON.stringify([W5d.cmds.length, W5e.cmds.length]));

  // ── 5d. ONE WHOLE SECTION AHEAD (2026-10-15) ──────────────────────────────────────────────────────────────────────
  // Andy: "between passage segments there should be no pause"; his boat HELD 25 minutes at the end of section 1 - the chart
  // tab, where the next section is planned, asleep 70 minutes - and the next section went out only with 10 km left. Now it
  // goes out as soon as she is on the last one sent: right after Sail (section 1 just sent, she at its start, 20 km of it
  // ahead - the 10 km rule planned nothing here), and as she enters each; never while a whole section is still queued.
  const W5f = running({ asv: { ...HERE }, wpIndex: 0 });           // Sail has just sent section 1: she is at its start
  W5f.api.passageTick(W5f.S); await settle(); await settle();
  const W5g = queuedOf(4);                                          // she has entered section 2 (its first waypoint is 4)
  await settle(); await settle();
  const P5g = W5g.api.st().mission.passage, c5g = W5g.cmds[0];
  check("5d. ONE WHOLE SECTION AHEAD: right after Sail - she at the start of section 1, all 20 km of it ahead - section 2 is "
        + "planned and sent at once; with section 2 queued nothing is (5b); as she enters section 2, section 3 goes out after "
        + "what she has left of it",
        () => W5f.planned.length === 1 && distTo(W5f.planned[0].from, P1) < 1 && W5f.cmds.length === 1 && W5f.api.st().mission.passage.sent === 1
              && far.planned.length === 0
              && W5g.planned.length === 1 && distTo(W5g.planned[0].from, P2) < 1 && c5g && P5g.sent === 2 && distTo(P5g.end, P3) < 1,
        () => JSON.stringify({ atSail: [W5f.planned.length, W5f.cmds.length], queued: far.planned.length,
                               entered: [W5g.planned.length, W5g.cmds.length, P5g.sent] }));

  // ── 6. she holds at the end ─────────────────────────────────────────────────────────────────────────────────────
  const atEnd = (k, end) => { const w = running(); w.mission.passage.sent = k; if (end) w.mission.passage.sections[k].end = end;
    w.S.status.holding = true; w.api.passageTick(w.S); return w; };
  const h6 = atEnd(0), port6 = atEnd(1), done6 = atEnd(2);
  check("6. SHE HOLDS at the end of the last section sent - said: HOLDING (Continue sends the next), AT FUEL STOP T1 "
        + "(refuel, then Continue), ARRIVED (the last section)",
        () => h6.mission.passage.state === "holding" && /PASSAGE HOLDING at the end of section 1 of 3/.test(h6.banners[0] || "")
              && port6.mission.passage.state === "at_port" && /AT FUEL STOP P1/.test(port6.banners[0] || "")
              && done6.mission.passage.state === "done" && /PASSAGE ARRIVED at P2/.test(done6.banners[0] || "")
              && h6.logs.some((l) => l[0] === "passage_holding"),
        () => JSON.stringify([h6, port6, done6].map((w) => [w.mission.passage.state, (w.banners[0] || "").slice(0, 50)])));

  // ── 7. left for another command ─────────────────────────────────────────────────────────────────────────────────
  const left = (kind, run) => { const w = running({ planIntent: { kind } }); w.api.set("runRoute", [{ ...east(HERE, 99999) }]);
    if (run) w.S.run = run; w.api.passageTick(w.S); return w; };
  const g7 = left("goto"), r7 = left("rth"), s7 = left("transit", "stopped"), e7 = left("escape");
  check("7. LEFT FOR ANOTHER COMMAND - a Go-To, an RTH, a Stop: where she left it (her position) and the section kept, "
        + "said; a GUARD ESCAPE is waited out - the passage still running, nothing kept",
        () => g7.mission.passage.state === "stopped" && distTo(g7.mission.passage.breakoff.at, east(HERE, 12000)) < 1
              && g7.mission.passage.breakoff.sec === 0 && /a Go-To/.test(g7.mission.passage.breakoff.why)
              && r7.mission.passage.state === "stopped" && /Return-to-Home/.test(r7.mission.passage.breakoff.why)
              && s7.mission.passage.state === "stopped" && s7.mission.passage.breakoff.why === "a Stop"
              && e7.mission.passage.state === "running" && !e7.mission.passage.breakoff
              && /PASSAGE LEFT in section 1 of 3/.test(g7.banners[0] || ""),
        () => JSON.stringify([g7, r7, s7, e7].map((w) => [w.mission.passage.state, w.mission.passage.breakoff && w.mission.passage.breakoff.why])));

  // ── 7b-7g. A GO-TO GIVEN WHILE SHE SAILS ENDS BACK ON THE PASSAGE (2026-10-16) ─────────────────────────────────────
  // Andy, asked whether End of plan RTH should take her home at the end of a Go-To given mid-passage (seen live on
  // 2026-10-15: it did, and Continue was refused while she went): "Follow the plan without adding another layer of
  // confirmation". The point the Go-To holds her at is kept with the leaving; there the chain stands down and she rejoins
  // the passage where she left it, as Continue does - asking nothing.
  const GT = { lat: HERE.lat + 0.01, lon: east(HERE, 12000).lon }, GT2 = { lat: HERE.lat + 0.02, lon: east(HERE, 12000).lon };
  const away = (o) => { const w = running(Object.assign({ planIntent: { kind: "goto" } }, o || {}));
    w.api.set("runRoute", [{ ...GT }]); Object.assign(w.S, { behavior: "goto", wp_total: 1 }); w.api.passageTick(w.S); return w; };
  const atGoToEnd = (w, at) => { Object.assign(w.S.status, { holding: true, hold: at === undefined ? { ...GT } : at }); w.asv.lat = GT.lat; w.asv.lon = GT.lon; return w; };
  const g7b = away(), bo7b = g7b.mission.passage.breakoff;
  const was7b = [r7, s7].map((w) => [w.banners.length, w.mission.passage.breakoff.why]);
  r7.api.passageTick(r7.S); s7.api.passageTick(s7.S);                              // ticked on: still waiting for Continue, nothing said
  check("7b. LEFT FOR A GO-TO: the leaving kept as for any command, and with it the point the Go-To holds her at, to rejoin "
        + "there - said; an RTH or a Stop keeps no such point, and ticked on is left alone",
        () => g7b.mission.passage.state === "stopped" && bo7b.rejoin === true && distTo(bo7b.to, GT) < 1 && /a Go-To/.test(bo7b.why)
              && /At the Go-To's end she rejoins the passage where she left it, and sails on\./.test(g7b.banners[0] || "")
              && !r7.mission.passage.breakoff.rejoin && !s7.mission.passage.breakoff.rejoin && !g7.banners.some((b) => /CONTINUE PASSAGE/.test(b))
              && JSON.stringify([r7, s7].map((w) => [w.banners.length, w.mission.passage.breakoff.why])) === JSON.stringify(was7b),
        () => JSON.stringify({ bo: bo7b, banner: g7b.banners[0], was7b, now: [r7, s7].map((w) => [w.banners.length, w.mission.passage.breakoff.why]) }));

  const W7c = away(); W7c.api.passageTick(W7c.S); await settle(); await settle();
  const ref7c = W7c.api.continueRefusal(W7c.mission.passage), line7c = W7c.api.sailLine(W7c.mission.passage);
  check("7c. UNDER WAY ON THE GO-TO: nothing sent; Continue passage says she rejoins it on her own at the Go-To's end, and so "
        + "does the passage's line",
        () => W7c.cmds.length === 0 && W7c.planned.length === 0 && ref7c === "she rejoins it on her own at the end of the Go-To"
              && /left in section 1 for a Go-To - she rejoins it at the Go-To's end/.test(line7c),
        () => JSON.stringify({ cmds: W7c.cmds.length, ref7c, line7c }));

  const W7d = atGoToEnd(away({ confirm: false }));
  const owns7d = W7d.api.sailOwnsHold();
  W7d.api.passageTick(W7d.S); await settle(); await settle();
  const P7d = W7d.mission.passage, c7d = W7d.cmds[0];
  const W7m = running({ asv: east(HERE, 3000), confirm: false });                 // a Continue passage pressed, and refused
  Object.assign(W7m.mission.passage, { state: "stopped", breakoff: { sec: 0, at: east(HERE, 7000), why: "a Go-To" } }); W7m.S.status.holding = true;
  await W7m.api.continuePassage();
  check("7d. AT THE GO-TO'S END SHE REJOINS THE PASSAGE, ASKING NOTHING: the end-of-plan RTH chain stands down there "
        + "(sailOwnsHold); section 1 planned from where she holds back to where she left it and on to its end, sent; running "
        + "again, the leaving spent; said and logged - with every confirmation refused, which Continue passage still asks",
        () => owns7d === true && W7d.confirms === undefined && W7d.planned.length === 1 && distTo(W7d.planned[0].from, GT) < 1
              && W7d.planned[0].line.length === 2 && distTo(W7d.planned[0].line[0], east(HERE, 12000)) < 1 && distTo(W7d.planned[0].line[1], P1) < 1
              && c7d && c7d[0] === "/api/cmd/transit" && P7d.state === "running" && P7d.breakoff === null && P7d.sent === 0
              && /^PASSAGE REJOINED at the end of the Go-To: section 1 of 3 sent, rejoining where she left it, planned at \+0\.35 m/.test(W7d.banners.pop() || "")
              && W7d.logs.some((l) => l[0] === "passage_rejoin" && l[1].ok && l[1].rejoin)
              && W7m.confirms === 1 && W7m.cmds.length === 0 && W7m.mission.passage.state === "stopped",
        () => JSON.stringify({ owns7d, confirms: W7d.confirms, planned: W7d.planned.map((p) => p.line.length), state: P7d.state, manual: [W7m.confirms, W7m.cmds.length] }));

  // where the chain stands down: the point she holds at is the vessel's word, else the end of the route she was sent
  const own = (fn) => { const w = away(); fn(w); return w.api.sailOwnsHold(); };
  const o7e = {
    here: own((w) => atGoToEnd(w)),
    noWord: own((w) => atGoToEnd(w, null)),                                          // a link that does not say: the route's end
    reload: own((w) => { atGoToEnd(w); w.api.set("runRoute", null); }),             // a reload: the vessel's word alone
    elsewhere: own((w) => { atGoToEnd(w, { ...GT2 }); w.api.set("runRoute", [{ ...GT2 }]); }),
    guardHold: own((w) => { atGoToEnd(w); w.S.behavior = "hold"; }),                // the guard's hold rung: not the Go-To's end
    underWay: own(() => {}),
    left: own((w) => { atGoToEnd(w); w.mission.passage.breakoff.rejoin = false; }),
  };
  check("7e. THE CHAIN STANDS DOWN AT THE GO-TO'S END ONLY: holding on the Go-To at the point kept - the vessel's word, or "
        + "the end of the route she was sent when it does not say, or after a reload the vessel's word alone - and not "
        + "holding anywhere else, not in the guard's hold, not under way, not once the rejoin is given up",
        () => o7e.here && o7e.noWord && o7e.reload && !o7e.elsewhere && !o7e.guardHold && !o7e.underWay && !o7e.left,
        () => JSON.stringify(o7e));

  // a newer Go-To before she gets there: followed to ITS end
  const W7f = away();
  W7f.api.set("runRoute", [{ ...GT2 }]); W7f.api.set("planIntent", { kind: "goto" }); W7f.api.passageTick(W7f.S);
  const to7f = W7f.mission.passage.breakoff.to;
  const old7f = atGoToEnd(W7f).api.sailOwnsHold();                                   // holding at the FIRST Go-To's point: not it
  W7f.api.passageTick(W7f.S); await settle(); await settle();
  const sentOld = W7f.cmds.length;
  W7f.S.status.hold = { ...GT2 }; W7f.api.passageTick(W7f.S); await settle(); await settle();
  // anything else commanded meanwhile: the passage left for Continue, said
  const offBy = (fn) => { const w = away(); fn(w); w.api.passageTick(w.S); return w; };
  const rth7f = offBy((w) => w.api.set("planIntent", { kind: "rth" }));
  const stop7f = offBy((w) => { w.S.run = "stopped"; });
  const hold7f = offBy((w) => { w.api.set("planIntent", null); w.api.set("runRoute", null); w.S.behavior = "hold"; });   // the Hold button drops the plan
  const esc7f = offBy((w) => { w.api.set("planIntent", { kind: "escape" }); w.S.behavior = "escape"; });
  // (the guard's hold rung on a page with no plan of its own - after a reload: the vessel says hold, the guard acted)
  const grd7f = offBy((w) => { w.api.set("planIntent", null); w.api.set("guardActedAt", 1); w.S.behavior = "hold"; w.S.status.holding = true; });
  const reload7f = offBy((w) => { w.api.set("planIntent", null); w.api.set("runRoute", null); });   // a reload: the vessel still on the Go-To
  const mute7f = offBy((w) => { w.api.set("planIntent", null); delete w.S.behavior; });           // ... on a link that names none
  atGoToEnd(rth7f); rth7f.api.passageTick(rth7f.S); await settle(); await settle();
  const bo7f = (w) => w.mission.passage.breakoff;
  check("7f. A NEWER GO-TO before she gets there is followed to ITS end (not rejoined at the first one's point); an RTH, a "
        + "Stop or a Hold commanded meanwhile leaves the passage for Continue, said - and then nothing is rejoined at the "
        + "Go-To's end; the guard's escape or hold, or a reload, leaves the rejoin as it was",
        () => distTo(to7f, GT2) < 1 && !old7f && sentOld === 0 && W7f.cmds.length === 1 && W7f.mission.passage.state === "running"
              && [rth7f, stop7f, hold7f].every((w) => bo7f(w).rejoin === false && w.mission.passage.state === "stopped"
                   && w.banners.some((b) => /will not rejoin it on her own now/.test(b) && /CONTINUE PASSAGE/.test(b)))
              && /a Go-To, then a Return-to-Home/.test(bo7f(rth7f).why) && /then a Stop/.test(bo7f(stop7f).why) && /then a Hold/.test(bo7f(hold7f).why)
              && rth7f.cmds.length === 0 && !rth7f.api.sailOwnsHold()
              && [esc7f, grd7f, reload7f, mute7f].every((w) => bo7f(w).rejoin === true && w.mission.passage.state === "stopped"),
        () => JSON.stringify({ to: Math.round(distTo(to7f, GT2)), old7f, sentOld, sent: W7f.cmds.length,
                               off: [rth7f, stop7f, hold7f, esc7f, grd7f, reload7f, mute7f].map((w) => bo7f(w).rejoin + " " + bo7f(w).why) }));

  // not sent: said once, she holds there (the chain still down), tried again each minute; refused (Continue's own reasons): the same
  const W7g = atGoToEnd(away({ unroutable: 1 }));
  W7g.api.passageTick(W7g.S); await settle(); await settle();
  const said7g = W7g.banners.filter((b) => /PASSAGE NOT REJOINED at the end of the Go-To: section 1 could not be sent - no route clear/.test(b)).length;
  W7g.api.passageTick(W7g.S); await settle(); await settle();
  const again7g = W7g.planned.length;
  W7g.api.set("sailTriedAt", 0); W7g.api.passageTick(W7g.S); await settle(); await settle();
  const W7h = atGoToEnd(away({ canCommand: false }));
  W7h.api.passageTick(W7h.S); await settle(); await settle();
  const W7q = atGoToEnd(away({ quiet: false }));                                    // the guard has something in hand
  W7q.api.passageTick(W7q.S); await settle(); await settle();
  check("7g. NOT REJOINED: a section that cannot be planned - said once, nothing sent, she holds where the Go-To left her with "
        + "the chain still down, not tried again inside PASSAGE_RETRY_MS, tried again after it; refused for Continue's own "
        + "reasons (this window cannot command) - said, nothing planned; not while the guard has something in hand",
        () => said7g === 1 && again7g === 1 && W7g.planned.length === 2 && W7g.cmds.length === 0
              && W7g.banners.filter((b) => /NOT REJOINED/.test(b)).length === 1 && W7g.mission.passage.state === "stopped"
              && W7g.mission.passage.breakoff.rejoin === true && W7g.api.sailOwnsHold()
              && W7h.planned.length === 0 && W7h.cmds.length === 0 && /NOT REJOINED at the end of the Go-To: this window is not supervising/.test(W7h.banners.join(" "))
              && W7q.planned.length === 0 && W7q.cmds.length === 0 && W7q.api.sailOwnsHold(),
        () => JSON.stringify({ said7g, again7g, planned: W7g.planned.length, h: W7h.banners.slice(-1), guard: W7q.planned.length }));

  // ── 8. Continue passage ─────────────────────────────────────────────────────────────────────────────────────────
  const waiting = (state, o) => { const w = running(Object.assign({ asv: { ...P1 } }, o || {})); const P = w.mission.passage;
    P.state = state; w.S.status.holding = true; return w; };
  const W8 = waiting("holding");
  await W8.api.continuePassage();
  const W8b = waiting("stopped", { asv: east(HERE, 3000) });
  W8b.mission.passage.breakoff = { sec: 0, at: { lat: HERE.lat + 0.0005, lon: east(HERE, 7000).lon }, why: "a Go-To" };
  await W8b.api.continuePassage();
  check("8. CONTINUE PASSAGE: from a hold, the next section from where she is (it makes a port: to its end as a Go-To "
        + "is); left mid-section - a section leaving a port - back to where she left it, then its end - running again, the "
        + "leaving spent",
        () => W8.planned.length === 1 && distTo(W8.planned[0].from, P1) < 1 && W8.planned[0].line.length === 1
              && W8.mission.passage.state === "running" && W8.mission.passage.sent === 1
              && W8b.planned.length === 1 && W8b.planned[0].line.length === 2
              && distTo(W8b.planned[0].line[0], { lat: HERE.lat + 0.0005, lon: east(HERE, 7000).lon }) < 1 && distTo(W8b.planned[0].line[1], P1) < 1
              && W8b.mission.passage.sent === 0 && W8b.mission.passage.breakoff === null && W8b.mission.passage.state === "running",
        () => JSON.stringify({ h: W8.planned.map((p) => p.line.length), b: W8b.planned.map((p) => p.line.map((q) => Math.round(distTo(HERE, q) / 1000))) }));
  // ── 8c. A SECTION AT A PORT IS PLANNED AS A GO-TO IS; ONE OUT AT SEA THROUGH THE COARSE ROUTE'S POINTS (2026-10-14) ──
  // Andy: "ASV exit from port through channel looks like the ASV is drunk ... should all harbor entrance/exit be goto?"
  // His Portland departure was sent through 15 of the coarse plan's points, 8 inside the port's circle, a sharp turn at
  // each. A passage of four sections, a port at each end, the two between ending at holds: the middle one (hold to hold)
  // goes through its turning points - and from where she left it, through the rest of them - and the last (making the
  // port) goes to its end with none of its own, though the first of them is 10 km out, far past the port's circle: the
  // whole section is the Go-To's.
  const P4x = east(HERE, 80000);
  const PLAN_M = () => ({ points: [{ ...HERE, port: true, t: 0 }, { ...P4x, port: true, t: 1 }], legs: [{ lengthM: 80000 }], twKn: 7, floorM: 3.15,
    sections: [sec(P0, P1, [east(HERE, 10000)]), sec(P1, P2, [east(HERE, 25000), east(HERE, 30000), east(HERE, 35000)]),
               sec(P2, P3, [east(HERE, 50000)]), sec(P3, P4x, [east(HERE, 70000)], "port", 1)],
    fuelLegs: [{ from: { t: 0 }, to: { t: 1 } }], fuel: [{ ok: true }] });
  const atHold = (sent, at, bo) => {
    const route = [{ ...at }];
    const P = { ...world().api.sailRecord(PLAN_M()), state: bo ? "stopped" : "holding", sent, base: 0, end: { ...at }, route, breakoff: bo || null };
    return world({ mission: { passage: P }, runRoute: route, asv: { ...at }, wpIndex: 1,
                   S: { armed: true, estop: false, run: "running", status: { holding: true, fuel_l: 200 }, wp_total: 1 } });
  };
  const W8c = atHold(0, P1);
  await W8c.api.continuePassage();
  const BO8 = { lat: HERE.lat + 0.0005, lon: east(HERE, 27000).lon };
  const W8d = atHold(1, east(HERE, 23000), { sec: 1, at: BO8, why: "a Go-To" });
  await W8d.api.continuePassage();
  const W8e = atHold(2, P3);
  await W8e.api.continuePassage();
  const kmL = (w) => (w.planned[0] ? w.planned[0].line.map((p) => Math.round(distTo(HERE, p) / 1000)) : null);
  check("8c. A SECTION AT A PORT IS PLANNED AS A GO-TO IS: a middle section (hold to hold) goes through the coarse route's "
        + "turning points, and left part way, from where she left it through the rest of them; the last (it makes the port) "
        + "to its end with none of its own - its point 10 km out too - its water still judged along them",
        () => JSON.stringify(kmL(W8c)) === "[25,30,35,40]" && JSON.stringify(kmL(W8d)) === "[27,30,35,40]"
              && JSON.stringify(kmL(W8e)) === "[80]" && W8e.waterAsked.length === 1 && W8e.waterAsked[0].pts.length === 2,
        () => JSON.stringify({ middle: kmL(W8c), rest: kmL(W8d), port: kmL(W8e), portWater: W8e.waterAsked.map((x) => x.pts.length) }));
  // ── 8d. WHICH SECTIONS ARE A PORT'S (sectionAtPort): an end within the port's circle of a port - or of home, on the way
  // home, home being where it left from or arrives but not itself one of its points - and only those
  const SAP = new Function("distTo", "PASSAGE_PORT_R_M", grab("sectionPorts") + grab("sectionAtPort") + "; return sectionAtPort;")(distTo, C.PORT_R_M);
  const portAt = { points: [{ ...HERE, port: true }, { ...P4x, port: false }] };
  const sap = {
    inCircle: SAP(portAt, sec(east(HERE, 3500), east(HERE, 20000))),
    outside: SAP(portAt, sec(east(HERE, 4500), east(HERE, 20000))),
    arrives: SAP(portAt, sec(east(HERE, 20000), east(HERE, -100))),
    notPort: SAP({ points: [{ ...HERE, port: false }] }, sec(P0, P1)),
    home: SAP({ points: [{ ...P4x, port: false }], home: east(HERE, -3000) }, sec(east(HERE, 25000), { ...HERE })),
    homeFar: SAP({ points: [{ ...P4x, port: false }], home: east(HERE, -3000) }, sec(east(HERE, 25000), east(HERE, 1500))),
  };
  check("8d. WHICH SECTIONS ARE A PORT'S: an end within the port's circle (" + C.PORT_R_M / 1000 + " km) of one of the "
        + "passage's ports, at its start or its end - or of home on the way home - and not one 4.5 km out, nor a point that "
        + "is not a port",
        () => sap.inCircle && !sap.outside && sap.arrives && !sap.notPort && sap.home && !sap.homeFar,
        () => JSON.stringify(sap));
  // ── 8e. A PORT'S SECTION JOINS THE PASSAGE LINE AT ITS JOIN POINT (2026-10-15) ───────────────────────────────────────
  // Andy: "The GOTO should not need to parallel the passage line for such a great distance ... should meld into the passage
  // path just outside the harbor marker buoy 2KR and meld into the passage line at the near bend to the long straight
  // passage northeast ... generalize this". One Go-To to the section's end ran 15.2 km of his 22 km New Castle departure
  // more than 300 m off the passage line. The page asks passage.js passageJoinVia (8f-8i drive it) on the chart just read,
  // and plans the line from the join - open water only ROUND what blocks it (with it on every leg, the stretch after the
  // join bulged off the line again, 9.6 km). No join point, or no chart yet: the section's end alone, as before.
  const MODEL = { ready: true, frame: "FRAME", ko: "KO" };
  const atHoldW = (sent, at, bo, extra) => {
    const route = [{ ...at }];
    const P = { ...world().api.sailRecord(PLAN_M()), state: bo ? "stopped" : "holding", sent, base: 0, end: { ...at }, route, breakoff: bo || null };
    return world(Object.assign({ mission: { passage: P }, runRoute: route, asv: { ...at }, wpIndex: 1,
                                 S: { armed: true, estop: false, run: "running", status: { holding: true, fuel_l: 200 }, wp_total: 1 } }, extra || {}));
  };
  const W8j = atHoldW(2, P3, null, { nogo: MODEL, joinVia: [east(HERE, 70000)] });     // the last section, making the port
  await W8j.api.continuePassage();
  const W8k = atHoldW(2, P3, null, { nogo: MODEL, joinVia: null });                     // ... no join point
  await W8k.api.continuePassage();
  const W8l = atHoldW(2, P3, null, { nogo: { ready: false }, joinVia: [east(HERE, 70000)] });   // ... no chart yet
  await W8l.api.continuePassage();
  const W8m = atHoldW(0, P1, null, { nogo: MODEL, joinVia: [east(HERE, 99000)] });     // a middle section: not asked
  await W8m.api.continuePassage();
  const BOa = { lat: HERE.lat + 0.0005, lon: east(HERE, 7000).lon }, BOb = { lat: HERE.lat + 0.0005, lon: east(HERE, 12000).lon };
  const W8n = atHoldW(0, east(HERE, 3000), { sec: 0, at: BOa, why: "a Go-To" }, { nogo: MODEL, joinVia: [east(HERE, 10000)] });
  await W8n.api.continuePassage();
  const W8o = atHoldW(0, east(HERE, 3000), { sec: 0, at: BOb, why: "a Go-To" }, { nogo: MODEL, joinVia: [east(HERE, 10000)] });
  await W8o.api.continuePassage();
  const ow = (w) => (w.planned[0] ? w.planned[0].ow : null), ask = W8j.joins && W8j.joins[0];
  check("8e. A PORT'S SECTION JOINS THE PASSAGE LINE: through the join point's line (asked on the chart just read, at the "
        + "transit standoff, for the end that is a port) with open water only round what blocks it; no join point or no chart "
        + "- its end alone, open water on it; a middle section not asked; left part way, from where she left it through the "
        + "join's points still ahead of her",
        () => JSON.stringify(kmL(W8j)) === "[70,80]" && ow(W8j) === "detours"
              && ask && ask.frame === "FRAME" && ask.ko === "KO" && ask.std === 20 && !ask.ends.from && ask.ends.to && distTo(ask.ends.to, P4x) < 1
              && JSON.stringify(kmL(W8k)) === "[80]" && ow(W8k) === "all"
              && JSON.stringify(kmL(W8l)) === "[80]" && ow(W8l) === "all" && !W8l.joins
              && JSON.stringify(kmL(W8m)) === "[25,30,35,40]" && ow(W8m) === "all" && !W8m.joins
              && JSON.stringify(kmL(W8n)) === "[7,10,20]" && ow(W8n) === "detours" && JSON.stringify(kmL(W8o)) === "[12,20]",
        () => JSON.stringify({ join: [kmL(W8j), ow(W8j)], none: [kmL(W8k), ow(W8k)], noChart: [kmL(W8l), ow(W8l)], middle: [kmL(W8m), ow(W8m)],
                               left7: kmL(W8n), left12: kmL(W8o) }));

  // ── 8f-8i. THE JOIN POINT ITSELF (passage.js passageJoinVia), DRIVEN on a harbor of its own ──────────────────────────
  // A channel 600 m wide running 3 km south from the port to its mouth, land both sides; the coarse line down it in cell
  // steps (60 m apart, under the simplification's 150 m), out of the mouth, a short leg east-southeast, a shorter one east,
  // then the long straight northeast - 13 km. The join is THE BEND ONTO THE LONG STRAIGHT: the mouth (3.2 km out) begins a
  // 1.2 km run, the next point a 1.5 km run - neither the long straight.
  {
    const PS = require(path.join(APP, "static", "js", "passage.js"));
    const { planeFrame } = require(path.join(APP, "static", "js", "geodesy.js"));
    const { buildKeepouts } = require(path.join(APP, "static", "js", "chart.js"));
    const ST = require(path.join(APP, "static", "js", "state.js"));
    const GF = planeFrame({ lat: 43.0, lon: -70.6 });
    const LLc = (e, n) => { const q = GF.fromEN(e, n); return [q.lon, q.lat]; };
    const gll = (e, n) => { const q = GF.fromEN(e, n); return { lat: q.lat, lon: q.lon }; };
    const rect = (e0, n0, e1, n1) => [[LLc(e0, n0), LLc(e1, n0), LLc(e1, n1), LLc(e0, n1), LLc(e0, n0)]];
    const depth = (d1, d2, e0, n0, e1, n1) => ({ role: "depth_area", cls: "Depth_Area", props: { DRVAL1: d1, DRVAL2: d2 }, geometry: { type: "Polygon", coordinates: rect(e0, n0, e1, n1) } });
    const land = (e0, n0, e1, n1) => ({ role: "land", cls: "Land_Area", props: {}, geometry: { type: "Polygon", coordinates: rect(e0, n0, e1, n1) } });
    const ENF = { land: true, depth: true, haz: true, area: false, wreck: true, chan: true };
    const harbor = (extra) => {
      const was = { off: ST.sea.waterOffset, v: { ...ST.V } };
      ST.sea.waterOffset = 0; Object.assign(ST.V, { NOGO_MIN_DEPTH_M: 3.15, OPER_MIN_DEPTH_M: 4.0, NOGO_BUFFER_M: 5, AIR_DRAFT_M: 2.85, OVERHEAD_CLEARANCE_M: 1.0 });
      try { return buildKeepouts(GF, ENF, { min: 4.0, max: 0 }, [depth(10, 30, -20000, -20000, 20000, 20000), land(-3000, -2600, -300, 2000), land(300, -2600, 1500, 2000), ...(extra || [])]); }
      finally { ST.sea.waterOffset = was.off; Object.assign(ST.V, was.v); }
    };
    const KO = harbor();
    const PORT = gll(0, 500), MOUTH = gll(0, -2700), ESE = gll(1000, -3300), BEND = gll(2500, -3400), FAR = gll(12000, 6000);
    const STAIR = []; for (let n = -500, k = 0; n > -2650; n -= 130, k++) STAIR.push(gll(k % 2 ? 60 : 0, n));
    const LINE = [PORT, ...STAIR, MOUTH, ESE, BEND, FAR];
    const near = (a, b) => a && b && distTo(a, b) < 1;
    const simp = PS.simplifyLine(LINE, PS.JOIN_SIMPLIFY_M);
    const out = PS.passageJoinVia(LINE, { from: PORT, to: null }, GF, KO, 20);
    check("8f. DRIVEN: leaving a port, the join is THE BEND ONTO THE LONG STRAIGHT - not the mouth (3.2 km out, a 1.2 km run "
          + "from it) nor the point after it (a 1.5 km run) - and the section's points are the passage line from there; the "
          + "coarse line's cell steps folded away",
          () => simp.length === 5 && near(simp[1], MOUTH) && near(simp[2], ESE) && near(simp[3], BEND)
                && out && out.length === 1 && near(out[0], BEND),
          () => "simplified " + LINE.length + " -> " + simp.length + "; points " + JSON.stringify(out && out.map((p) => [Math.round(GF.toEN(p).e), Math.round(GF.toEN(p).n)])));
    // the three tests a join point must pass, each failed alone: a port 2.1 km from the bend (the harbor), an islet 170 m
    // from it (clear water), and its pair 500 m off (kept)
    const tooNear = PS.passageJoinVia(LINE, { from: gll(1800, -1400), to: null }, GF, KO, 20);
    const islet = PS.passageJoinVia(LINE, { from: PORT, to: null }, GF, harbor([land(2300, -3580, 2370, -3510)]), 20);
    const isletOff = PS.passageJoinVia(LINE, { from: PORT, to: null }, GF, harbor([land(2050, -3800, 2120, -3730)]), 20);
    // ... and the stretch beyond it CLEAR: an islet ON the long straight 900 m past the bend (the bend itself 900 m clear of it)
    const onLine = PS.passageJoinVia(LINE, { from: PORT, to: null }, GF, harbor([land(3150, -2780, 3300, -2620)]), 20);
    // ... and a BUOY is not a danger here (open water's rule: passed close by design) - one 150 m off the bend leaves it
    const buoyNear = PS.passageJoinVia(LINE, { from: PORT, to: null }, GF, harbor([{ role: "chan_mark", cls: "Buoy_Lateral_point",
      props: { CATLAM: 2, OBJNAM: "Test Ledge Buoy 2" }, geometry: { type: "Point", coordinates: LLc(2600, -3510) } }]), 20);
    check("8g. DRIVEN: a join point is OUTSIDE THE HARBOR (" + PS.JOIN_HARBOR_M / 1000 + " km from the port) and IN CLEAR WATER ("
          + PS.JOIN_CLEAR_M + " m from every danger) with the stretch beyond it clear - with none, the whole section is one "
          + "Go-To (null); an islet 500 m off leaves the join where it was",
          () => tooNear === null && islet === null && onLine === null && isletOff && isletOff.length === 1 && near(isletOff[0], BEND)
                && buoyNear && buoyNear.length === 1 && near(buoyNear[0], BEND),
          () => JSON.stringify({ tooNear, islet, onLine, isletOff: isletOff && isletOff.length, buoyNear: buoyNear && buoyNear.length }));
    // making a port: the same line sailed the other way - she follows it IN to the join, the harbor the Go-To's
    const back = LINE.slice().reverse();
    const inward = PS.passageJoinVia(back, { from: null, to: PORT }, GF, KO, 20);
    const inwardNone = PS.passageJoinVia(back, { from: null, to: PORT }, GF, harbor([land(2300, -3580, 2370, -3510)]), 20);   // (8g's islet)
    check("8h. DRIVEN: making a port, the line is followed in TO the join point (the bend off the long straight), the harbor "
          + "the Go-To's; with no join point there, one Go-To",
          () => inward && inward.length === 1 && near(inward[0], BEND) && inwardNone === null,
          () => JSON.stringify(inward && inward.map((p) => [Math.round(GF.toEN(p).e), Math.round(GF.toEN(p).n)])));
    // a section from one port to another whose joins CROSS: leaving, the bend (4.6 km along); arriving at FAR, the mouth
    // (the 3.2 km run in to PORT is the long straight from that end) - nothing of the line between them: one Go-To
    const crossed = PS.passageJoinVia(LINE, { from: PORT, to: FAR }, GF, KO, 20);
    check("8i. DRIVEN: a section between two ports whose join points cross is ONE Go-To (null)",
          () => crossed === null, () => JSON.stringify(crossed));
  }
  const lowFuel = waiting("at_port", { asv: { ...P2 }, S: { armed: true, estop: false, run: "running", status: { holding: true, fuel_l: 55 }, wp_total: 4 } });
  lowFuel.mission.passage.sent = 1;
  const why8 = lowFuel.api.continueRefusal(lowFuel.mission.passage);
  await lowFuel.api.continuePassage();
  const full8 = waiting("at_port", { asv: { ...P2 }, S: { armed: true, estop: false, run: "running", status: { holding: true, fuel_l: 240 }, wp_total: 4 } });
  full8.mission.passage.sent = 1;
  const under = waiting("holding"); under.S.status.holding = false;
  check("8b. AT A PORT, REFUSED UNTIL WHAT IS ABOARD REACHES THE NEXT WITH 20% (said with the numbers), sent when it does; "
        + "under way, refused",
        () => /refuel first: 55.0 L aboard, and P2 is 20.0 km on - she needs/.test(why8 || "") && lowFuel.cmds.length === 0
              && full8.api.continueRefusal(full8.mission.passage) === null && /under way/.test(under.api.continueRefusal(under.mission.passage) || ""),
        () => why8);
  // 8b2 (2026-11-10 review). UNDER THE ENERGY OVERRIDE the leg is judged from a FULL tank - what Plan passage assumes -
  // whatever the gauge says: the forced-full gauge had kept this refusal, and reading no level under the override had
  // dropped it (the tank rule held at Sail and not at Continue). A vessel reporting no level is still not held.
  const ovrOf = (fuel) => { const x = waiting("at_port", { asv: { ...P2 }, S: { armed: true, estop: false, run: "running",
      status: { holding: true, fuel_l: fuel, unlimited_energy: true }, wp_total: 4 } }); x.mission.passage.sent = 1; return x; };
  const ovrIn = ovrOf(55), ovrShort = ovrOf(55);
  ovrShort.model = Object.assign({}, ovrShort.model, { full: 55 });     // a tank that, full, does not reach P2 with 20%
  const whyOvrIn = ovrIn.api.continueRefusal(ovrIn.mission.passage), whyOvrShort = ovrShort.api.continueRefusal(ovrShort.mission.passage);
  const noLv = waiting("at_port", { asv: { ...P2 }, S: { armed: true, estop: false, run: "running", status: { holding: true }, wp_total: 4 } });
  noLv.mission.passage.sent = 1;
  check("8b2. ... UNDER THE ENERGY OVERRIDE judged from a FULL tank, whatever the gauge: sent where a full tank reaches, "
        + "refused - and the words say it is the full tank that is short - where it does not; no level reported: not held",
        () => whyOvrIn === null
              && /^too far for even a full tank \(55\.0 L - the energy override is on, so her level is not read\): P2 is 20\.0 km on - she needs/.test(whyOvrShort || "")
              && noLv.api.continueRefusal(noLv.mission.passage) === null,
        () => JSON.stringify({ whyOvrIn, whyOvrShort }));

  // ── 9. Divert ───────────────────────────────────────────────────────────────────────────────────────────────────
  const PORT = { lat: 43.2, lon: -70.6 };
  const W9 = running(); await W9.api.divertPassage(PORT);
  const W9b = running({ gotoTakes: false }); await W9b.api.divertPassage(PORT);
  check("9. DIVERT THE PASSAGE TO HERE: a Go-To to the point; taken, the leaving kept - where she was, her section, the "
        + "port - and the passage diverted; a Go-To NOT taken leaves the passage as it was",
        () => W9.cmds.some((c) => c[0] === "goto") && W9.mission.passage.state === "diverted"
              && distTo(W9.mission.passage.breakoff.at, east(HERE, 12000)) < 1 && distTo(W9.mission.passage.breakoff.port, PORT) < 1
              && W9.mission.passage.breakoff.sec === 0 && W9b.mission.passage.state === "running" && !W9b.mission.passage.breakoff,
        () => JSON.stringify([W9.mission.passage.state, W9b.mission.passage.state]));
  // FOUND LIVE: at the divert point End of plan RTH chained her home from the port she was sent to refuel in
  const HP = { lat: 43.2003, lon: -70.6004 };                         // where the Go-To holds her (clear water by the port)
  const W9c = running({ gotoRoute: [east(HERE, 13000), HP] }); await W9c.api.divertPassage(PORT);
  const ownsDivert = W9c.api.sailOwnsHold();
  W9c.mission.passage.state = "stopped";
  const ownsStopped = W9c.api.sailOwnsHold();
  check("9b. AT THE PORT IT WAS DIVERTED TO SHE WAITS: the point the Go-To holds her at is kept, and the end-of-plan RTH "
        + "chain stands down there (sailOwnsHold) - while diverted only",
        () => W9c.mission.passage.breakoff && distTo(W9c.mission.passage.breakoff.to, HP) < 1 && ownsDivert === true && ownsStopped === false,
        () => JSON.stringify({ to: W9c.mission.passage.breakoff && W9c.mission.passage.breakoff.to, ownsDivert, ownsStopped }));

  // ── 10. the x, and the command bar ──────────────────────────────────────────────────────────────────────────────
  const W10 = waiting("holding"); W10.api.renderPassageControls(true, false, false);
  const b10 = W10.dom["#b_passage"], x10 = W10.dom["#b_passDrop"];
  const W10b = running(); W10b.api.renderPassageControls(true, false, true);
  const W10c = waiting("holding", { canCommand: false, S: { armed: false, estop: false, run: "running", status: { holding: true }, wp_total: 4 } });
  W10c.api.renderPassageControls(false, false, false);
  await W10.api.dropPassage();
  check("10. THE COMMAND BAR: Continue passage shown while she waits, live; hidden while she sails (the x still there); "
        + "grayed with the reason when she is not armed; the x drops the passage (she is not stopped)",
        () => b10.style.display === "" && !b10.disabled && x10.style.display === "" && W10b.dom["#b_passage"].style.display === "none"
              && W10b.dom["#b_passDrop"].style.display === "" && W10c.dom["#b_passage"].disabled && /arm her first/.test(W10c.dom["#b_passage"].tip)
              && W10.mission.passage === null && W10.cmds.length === 0 && W10.logs.some((l) => l[0] === "passage_drop"),
        () => JSON.stringify([b10.style.display, b10.disabled, W10b.dom["#b_passage"].style.display, W10c.dom["#b_passage"].disabled]));

  // ── 10b. the drawing ────────────────────────────────────────────────────────────────────────────────────────────
  const W10d = waiting("stopped");
  W10d.mission.passage.breakoff = { sec: 0, at: east(HERE, 7000), why: "a Go-To" };
  W10d.ops = [];
  W10d.api.drawSail((lat, lon) => ({ x: lon * 1000, y: -lat * 1000 }));
  const P10d = W10d.mission.passage;
  const lines10 = W10d.ops.filter((o) => o[0] === "lineTo").length, ends10 = W10d.ops.filter((o) => o[0] === "fillRect").length;
  const want10 = P10d.sections.reduce((s, c) => s + 1 + c.via.length, 0) + 2;        // each section's line, and the X's two strokes
  check("10b. THE DRAWING: every section's line through its turning points, a mark at each section's end, and an X where "
        + "she left it",
        () => lines10 === want10 && ends10 === P10d.sections.length && W10d.ops.some((o) => o[0] === "moveTo"),
        () => "lineTo " + lines10 + " (want " + want10 + "), end marks " + ends10);

  // ── 11. the wiring ──────────────────────────────────────────────────────────────────────────────────────────────
  const W11 = running();
  const owns = W11.api.sailOwnsHold();
  W11.api.set("runRoute", [{ ...P3 }]);
  const notOwn = W11.api.sailOwnsHold();
  const wiring = {
    chain: /chainableRun\(s\.behavior\) && !heldSplitRun\(s\) && !sailOwnsHold\(\)/.test(H),
    card: /runHolds\(\) && !sailOwnsHold\(\)\);/.test(H),
    tick: /try\{ corridorAheadTick\(s\); \}catch\(e\)\{ console\.error\(e\); \}\s*\n\s*try\{ passageTick\(s\); \}catch\(e\)\{ console\.error\(e\); \}/.test(H),
    buttons: /id="b_passage"[^>]*>Continue passage</.test(H) && /\$\("#b_passage"\)\.onclick = \(\) => continuePassage\(\);/.test(H)
             && /\$\("#b_passDrop"\)\.onclick = \(\) => dropPassage\(\);/.test(H) && /\$\("#tr_sail"\)\.onclick = \(\) => sailPassage\(\);/.test(H),
    bar: /renderPassageControls\(armed, estop, underWay\);/.test(H),
    menu: /id="cmDivert"/.test(H) && /cmRow\("#cmDivert", ll => divertPassage\(ll\)\);/.test(H),
    loader: /passage:\(m\.passage && typeof m\.passage === "object" && !Array\.isArray\(m\.passage\)\) \? m\.passage : null\}/.test(H),
    sections: /gen, sections: res\.sections \|\| null\}/.test(H),
    drawn: /drawPassage\(toScreen\);\s*\n\s*drawSail\(toScreen\);/.test(H),
  };
  check("11. THE WIRING: the end-of-plan RTH chain and the card's prediction stand down at a passage's hold (sailOwnsHold: "
        + "the route ends at the passage's end); the tick on every frame after the read-ahead; the buttons, the bar, the "
        + "chart's row, the plan's loader, the coarse plan's sections, the drawing",
        () => owns && !notOwn && Object.values(wiring).every(Boolean),
        () => "owns " + owns + "/" + notOwn + "; " + (Object.entries(wiring).filter(([, v]) => !v).map(([k]) => k).join(", ") || "all wired"));

  // ── 15. THE HOLD SURVIVES A RELOAD, A TAKE-OVER AND A DROP (the 2026-10-16 review, finding 4) ───────────────────
  // sailOwnsHold answered from this tab's runRoute, which a reload leaves null: a tab reloaded while she held at a
  // section's end saw no passage hold, and the end-of-plan chain sent her home from it on its second frame.
  const reload = (state, o) => { const w = waiting(state, o); w.api.set("runRoute", null); return w.api.sailOwnsHold(); };
  // (the arrival is no hold: the end of the mission, 16)
  const own15 = { holding: reload("holding"), port: reload("at_port"), diverting: reload("diverting"),
                  running: reload("running"), stopped: reload("stopped"),
                  // a later plan over the record: another route aboard, or her away from the hold - no stand-down
                  other: reload("holding", { S: { armed: true, estop: false, run: "running", status: { holding: true }, wp_total: 9 } }),
                  away: reload("holding", { asv: east(HERE, 2000) }) };
  check("15. ⚠ THE PASSAGE'S HOLD IS THE RECORD'S, NOT THIS TAB'S MEMORY: with no route in memory (a reloaded or a taking-over "
        + "tab) she holds for Continue at a section's end, a fuel stop and while diverting from one; a section under "
        + "way, or a passage left for another command, stands the chain down nowhere - nor does a record whose route is not "
        + "the one aboard, or one she is 2 km from",
        () => own15.holding && own15.port && own15.diverting && !own15.running && !own15.stopped && !own15.other && !own15.away,
        () => JSON.stringify(own15));
  const W15 = waiting("holding"); W15.S.run_seq = 7;
  await W15.api.dropPassage();
  const hk15 = W15.mission.passage_hold, kept15 = W15.api.sailOwnsHold();
  W15.S.run_seq = 8; const gone15 = W15.api.sailOwnsHold();
  const W15b = waiting("holding"); W15b.S.run_seq = 7; W15b.api.set("runRoute", null);   // dropped from a reloaded tab, the same
  await W15b.api.dropPassage(); const keptReload = W15b.api.sailOwnsHold();
  const W15c = running(); W15c.S.run_seq = 7; await W15c.api.dropPassage();            // dropped under way: nothing kept
  check("15b. DROP PASSAGE WHILE SHE HOLDS keeps the hold for this run: the record gone, the hold kept with the run's sequence "
        + "and her position (saved with the plan), the chain stood down - from a reloaded tab too - and not for the next motion; "
        + "dropped under way, nothing is kept",
        () => W15.mission.passage === null && hk15 && hk15.run_seq === 7 && distTo(hk15, P1) < 1 && kept15 && !gone15
              && keptReload && W15c.mission.passage === null && W15c.mission.passage_hold === null,
        () => JSON.stringify({ hk15, kept15, gone15, keptReload, under: W15c.mission.passage_hold }));
  check("15c. THE WIRING: a tab that takes over re-reads the plan (the passage record with it), after the hull; the loader "
        + "carries the kept hold; the drop's confirm says she keeps holding; the server carries the hold in both of its mission dicts",
        () => /const j = await supervisorBeat\(true\);[\s\S]{0,700}?if\(j && j\.you\)\{ await loadVessel\(\); await loadMission\(\); \}/.test(H)
              && /passage_hold:\(m\.passage_hold && typeof m\.passage_hold === "object"\) \? m\.passage_hold : null,/.test(H)
              && /She keeps holding here: End of plan does not send her home/.test(H)
              && (PY.match(/"passage_hold": m\.get\("passage_hold"\) if isinstance\(m\.get\("passage_hold"\), dict\) else None,/g) || []).length === 2
              && /"passage": None, "passage_hold": None,/.test(PY),
        () => "wiring");

  // ── 12. the sections home (step 6) ──────────────────────────────────────────────────────────────────────────────
  // the passage of 2-11: P0 (her start, home) -> P1 (turning at 10 km) -> P2, the fuel stop T1 (turning at 30 km) -> P3, T2
  const OUT = PLAN().sections;
  const kmOf = (p) => Math.round(distTo(HERE, p) / 1000);
  const north = (p, m) => ({ lat: p.lat + m / M, lon: p.lon });
  const shape = (h) => (h.sections || []).map((c) => [kmOf(c.from), ...c.via.map(kmOf), kmOf(c.to)].join(">") + " " + c.end + (c.port != null ? c.port : ""));
  const h12 = C.homeSections(OUT, north(east(HERE, 35000), 100), HERE);
  const len12 = (h12.sections || []).reduce((a, c) => a + c.lengthM, 0);
  check("12. THE SECTIONS HOME (coarse.js homeSections), home where the passage left from: from her, back along the "
        + "section she is in to its start through its turning points, then each section before it the other way round, "
        + "each still ending where the passage's did, the last ending at HOME; their lengths the way home",
        () => h12.homeEnd === "start" && h12.rejoin.sec === 1
              && JSON.stringify(shape(h12)) === JSON.stringify(["35>35>30>20 hold", "20>10>0 home"]) && Math.abs(len12 - 35100) < 50,
        () => JSON.stringify(shape(h12)) + ", " + len12 + " m");
  const atT1 = north(P2, 150);
  const h12b = C.homeSections(OUT, atT1, HERE), h12c = C.homeSections(OUT, atT1, east(P3, 500));
  check("12b. AT A SECTION'S END - waiting at the fuel stop T1 - the first section home is the WHOLE section before it, "
        + "and going on to a home at the far end the WHOLE section after it: never a few meters to the port she is at",
        () => JSON.stringify(shape(h12b)) === JSON.stringify(["40>40>30>20 hold", "20>10>0 home"])
              && h12c.homeEnd === "end" && JSON.stringify(shape(h12c)) === JSON.stringify(["40>40>61 home"]),
        () => JSON.stringify([shape(h12b), shape(h12c)]));
  const h12d = C.homeSections(OUT, north(east(HERE, 12000), 50), P3);
  check("12c. HOME WHERE THE PASSAGE ARRIVES (she left from a visiting harbor): the rest of her section, then the ones "
        + "after it as they are - the fuel stop T1 still a port end - the last ending at home",
        () => h12d.homeEnd === "end" && JSON.stringify(shape(h12d)) === JSON.stringify(["12>12>20 hold", "20>30>40 port1", "40>60 home"]),
        () => JSON.stringify(shape(h12d)));
  const loop = [sec(HERE, east(HERE, 20000)), sec(east(HERE, 20000), north(east(HERE, 20000), 5000)),
                sec(north(east(HERE, 20000), 5000), north(HERE, 5000)), sec(north(HERE, 5000), HERE, [], "port", 0)];
  const lA = C.homeSections(loop, north(east(HERE, 5000), 5000), HERE), lB = C.homeSections(loop, east(HERE, 5000), HERE);
  const nowhere = C.homeSections(OUT, east(HERE, 35000), north(HERE, 9000));
  const offIt = C.homeSections(OUT, north(east(HERE, 35000), 25000), HERE);
  check("12d. A PASSAGE THAT COMES BACK where it left from goes home whichever way is shorter from her; home at neither "
        + "end, or she more than REJOIN_MAX_M off it - no way home along it, and why",
        () => lA.homeEnd === "end" && lA.sections.length === 2 && lB.homeEnd === "start" && lB.sections.length === 1
              && nowhere.why === "ends" && offIt.why === "far" && Math.abs(offIt.offM - 25000) < 1,
        () => JSON.stringify([lA.homeEnd, lA.sections && lA.sections.length, lB.homeEnd, lB.sections && lB.sections.length, nowhere, offIt.why]));

  // a U: 30 km east, 10 km north, 30 km back west - she on the way back, 5 km short of its end; home where it left from
  const U = [sec(HERE, east(HERE, 30000), [east(HERE, 10000), east(HERE, 20000)]),
             sec(east(HERE, 30000), north(east(HERE, 30000), 10000)),
             sec(north(east(HERE, 30000), 10000), north(HERE, 10000), [north(east(HERE, 20000), 10000), north(east(HERE, 10000), 10000)], "port", 1)];
  const hU = C.homeSections(U, north(east(HERE, 5000), 10000), HERE);
  const hUlen = (hU.sections || []).reduce((a, c) => a + c.lengthM, 0);
  const xKm = (p) => Math.round((p.lon - HERE.lon) * M * Math.cos(HERE.lat * Math.PI / 180) / 1000);     // km east of HERE
  const hUvia = JSON.stringify((hU.sections || []).map((c) => c.via.map(xKm)));
  check("12e. SHE REJOINS IT WHERE SHE IS, never at a stretch of it farther off that is nearer home along it (on a U, the "
        + "outward leg 10 km across what the passage went round); each section's turning points in reverse order",
        () => hU.rejoin.sec === 2 && hU.rejoin.offM < 1 && Math.abs(hUlen - 65000) < 50 && hUvia === JSON.stringify([[10, 20], [], [20, 10]]),
        () => "rejoined section " + (hU.rejoin && hU.rejoin.sec) + " " + (hU.rejoin && hU.rejoin.offM.toFixed(0)) + " m off; " + hUlen + " m; " + hUvia);

  // ── 13. the way home, sailed (homeRecord, sailHome, doRTH beyond RTH_MAX_M) ─────────────────────────────────────
  const outbound = (o) => {
    const route = [east(HERE, 50000), { ...P3 }];
    const P = { ...world().api.sailRecord(PLAN()), id: "Pout", state: "running", sent: 2, sec: 2, base: 0, end: { ...P3 }, route };
    return world(Object.assign({ mission: { passage: P }, runRoute: route, wpIndex: 0, asv: east(HERE, 55000),
      // (End of plan RTH: the chain fires under no other - rthFence asks it again before the send, the 2026-11-14 review)
      S: { armed: true, estop: false, run: "running", status: { holding: false, fuel_l: 200 }, wp_total: 2, home: { ...HERE }, home_source: null,
           completion: "rth" } }, o || {}));
  };
  const W13 = outbound();
  await W13.api.doRTH({});
  const H13 = W13.api.st().mission.passage, c13 = W13.cmds[0];
  check("13. RTH WITH HOME BEYOND RTH_MAX_M, ON A PASSAGE WITH HOME WHERE IT LEFT FROM: the way home along it - its first "
        + "section planned from her position (at its own water) and SENT AS AN RTH with its hold disc and coast; the "
        + "passage on the plan is now the way home (kind rth: its sections, the passage it runs along, home, where it "
        + "left it) - running; she is said to be going home along the passage, and it is logged",
        () => c13 && c13[0] === "/api/cmd/rth" && c13[1].hold_clear_m === 40 && c13[1].coast_from_m === 55
              && distTo(c13[1].route[c13[1].route.length - 1], P2) < 1 && W13.planned.length === 1 && distTo(W13.planned[0].from, east(HERE, 55000)) < 1
              && W13.levels[0] === 0.35 && H13.kind === "rth" && H13.state === "running" && H13.sent === 0 && H13.homeEnd === "start"
              && H13.from.id === "Pout" && H13.from.sec === 2 && H13.path.length === 3 && distTo(H13.home, HERE) < 1
              && JSON.stringify(H13.sections.map((c) => c.end + (c.port != null ? c.port : ""))) === JSON.stringify(["port1", "hold", "home"])
              && W13.api.st().planIntent.kind === "rth" && /RTH ALONG THE PASSAGE: home is 55\.0 km away/.test(W13.banners.pop() || "")
              && W13.logs.some((l) => l[0] === "passage_rth" && l[1].ok && l[1].water_m === 0.35),
        () => JSON.stringify({ cmd: c13 && c13[0], H: H13 && [H13.kind, H13.state, H13.from], banners: W13.banners.slice(-1) }));
  const refusedHome = async (o, opts) => { const w = outbound(o); await w.api.doRTH(opts || {}); return w; };
  const r13 = {
    chainedNone: await refusedHome({ mission: { passage: null } }, { chained: true }), fuelSent: await refusedHome({}, { why: "LOW FUEL" }),
    none: await refusedHome({ mission: { passage: null } }), off: await refusedHome({ asv: north(east(HERE, 55000), 25000) }),
    ends: outbound(), roc: outbound(),
  };
  r13.ends.S.home = north(HERE, 9000); await r13.ends.api.doRTH({});
  r13.roc.S.home_source = "roc-1"; await r13.roc.api.doRTH({});
  const refusal = (w) => w.banners.find((b) => /^RTH refused: home is/.test(b)) || "";
  const asked13 = (w) => (w.homeAsked || []).length;
  const sailed13 = /a passage is being sailed - it goes home along itself, or not at all/;
  check("13b. NOT ALONG THE PASSAGE, refused - in words where it is the reason: the LOW-FUEL monitor, and a ROC's home, home "
        + "at neither end of it or she far off it while the passage is being sailed (no passage home is planned from there: "
        + "it goes home along itself or not at all); with NO PASSAGE on the plan the way home is planned as a passage from "
        + "her position (17) - here with no chart to plan it on, refused in those words, the END-OF-PLAN chain's recorded",
        () => Object.values(r13).every((w) => w.cmds.length === 0 && w.api.st().mission.passage === w.mission.passage)
              && r13.chainedNone.api.st().rthChainFailed && /could not be planned as a passage - no chart in this world\./.test(refusal(r13.chainedNone))
              && !r13.none.api.st().rthChainFailed && /could not be planned as a passage - no chart in this world\./.test(refusal(r13.none))
              && asked13(r13.none) === 1 && asked13(r13.chainedNone) === 1
              && distTo(r13.none.homeAsked[0].points[0], east(HERE, 55000)) < 1 && distTo(r13.none.homeAsked[0].points[1], HERE) < 1
              && r13.none.homeAsked[0].points.every((p) => p.port) && r13.none.homeAsked[0].busy === true && !r13.none.api.st().passageBusy
              && !/along the passage/.test(refusal(r13.fuelSent)) && sailed13.test(refusal(r13.fuelSent)) && !r13.fuelSent.api.st().rthChainFailed
              && /home is at neither end of it/.test(refusal(r13.ends)) && sailed13.test(refusal(r13.ends))
              && /home is the ROC's/.test(refusal(r13.roc)) && /she is 25\.0 km off it/.test(refusal(r13.off)) && sailed13.test(refusal(r13.off))
              && [r13.fuelSent, r13.ends, r13.roc, r13.off].every((w) => asked13(w) === 0),
        () => JSON.stringify(Object.fromEntries(Object.entries(r13).map(([k, w]) => [k, [asked13(w), refusal(w).slice(30, 200)]]))));
  const W13c = outbound({ S: { armed: true, estop: false, run: "running", status: { holding: false, fuel_l: 52 }, wp_total: 2, home: { ...HERE }, home_source: null } });
  await W13c.api.doRTH({});
  check("13c. REFUSED, AS CONTINUE IS, WHILE WHAT IS ABOARD DOES NOT REACH THE FIRST PORT ON THE WAY HOME WITH 20% - said "
        + "with the numbers; nothing sent, the passage as it was",
        () => W13c.cmds.length === 0 && W13c.api.st().mission.passage.id === "Pout" && !W13c.api.st().rthChainFailed
              && /RTH refused: home is 55\.0 km away, along the passage - refuel first: 52\.0 L aboard, and P1 is 15\.0 km on/.test(W13c.banners.join(" ")),
        () => JSON.stringify(W13c.banners));
  // on the way home: the next section sent ahead of her as an RTH; at home, done; a second RTH goes home along the same passage
  const homeWorld = (o) => {
    const w0 = outbound({ asv: north(east(HERE, 35000), 100) }), H = w0.api.homeRecord();
    const route = [east(HERE, 25000), { ...H.sections[0].to }];
    Object.assign(H, { state: "running", sent: 0, sec: 0, base: 0, end: { ...H.sections[0].to }, route });
    return world(Object.assign({ mission: { passage: H }, runRoute: route, wpIndex: 1, asv: east(HERE, 27000),
      S: { armed: true, estop: false, run: "running", status: { holding: false, fuel_l: 200 }, wp_total: 2, home: { ...HERE }, home_source: null } }, o || {}));
  };
  const W13d = homeWorld();
  W13d.api.passageTick(W13d.S); await settle(); await settle();
  const c13d = W13d.cmds[0], H13d = W13d.api.st().mission.passage;
  const W13e = homeWorld(); W13e.mission.passage.sent = 1; W13e.S.status.holding = true; W13e.api.passageTick(W13e.S);
  const W13f = homeWorld({ asv: east(HERE, 58000) }); await W13f.api.doRTH({});
  const H13f = W13f.api.st().mission.passage;
  check("13d. ON THE WAY HOME: the next section planned and sent ahead of her AS AN RTH, after what she has left, ending "
        + "at home; at home she is HOME (said: done, she holds); a second RTH from further out goes home along the same "
        + "PASSAGE (not back out along the way home's own sections)",
        () => c13d && c13d[0] === "/api/cmd/rth" && distTo(c13d[1].route[c13d[1].route.length - 1], HERE) < 1 && H13d.sent === 1
              && W13d.api.st().planIntent.kind === "rth"
              && W13e.mission.passage.state === "done" && /HOME ALONG THE PASSAGE: she is home, all 2 sections sailed/.test(W13e.banners[0] || "")
              && /^home along the passage: she is home/.test(W13e.api.sailLine(W13e.mission.passage))
              && H13f.kind === "rth" && H13f.from.id === "Pout" && H13f.sections[H13f.sections.length - 1].end === "home"
              && distTo(H13f.sections[H13f.sections.length - 1].to, HERE) < 1 && W13f.cmds[0][0] === "/api/cmd/rth",
        () => JSON.stringify({ d: c13d && [c13d[0], H13d.sent], e: [W13e.mission.passage.state, W13e.banners[0]], f: H13f && [H13f.from, shape(H13f)] }));
  const W13g = homeWorld({ planIntent: { kind: "goto" } });
  W13g.api.set("runRoute", [{ ...east(HERE, 99999) }]); W13g.api.passageTick(W13g.S);
  W13g.S.run = "running"; W13g.S.status.holding = true;
  await W13g.api.continuePassage();
  check("13e. LEFT FOR A GO-TO on the way home, where she left it is kept - and Continue rejoins it there, sent as an RTH",
        () => W13g.mission.passage.kind === "rth" && W13g.cmds.some((c) => c[0] === "/api/cmd/rth") && W13g.mission.passage.state === "running"
              && /^home along the passage: sailing section 1 of 2 · planned at \+0\.35 m/.test(W13g.api.sailLine(W13g.mission.passage)),
        () => JSON.stringify({ cmds: W13g.cmds.map((c) => c[0]), state: W13g.mission.passage.state, line: W13g.api.sailLine(W13g.mission.passage) }));

  // ── 16. THE ARRIVAL IS THE END OF THE MISSION (Andy, 2026-11-12) ────────────────────────────────────────────────
  // "all end of mission should RTH unless over-ridden by user": an overnight passage from Pago Pago arrived and held 7.5 h -
  // sailOwnsHold owned the arrival, so the chain stood down; and a chained RTH past RTH_MAX_M was refused, not sailed home.
  // `endS`: End of plan RTH (the default) on a transit run that holds - all the chain asks but the passage's word
  const endS = (o) => Object.assign({ armed: true, estop: false, run: "running", behavior: "transit", completion: "rth",
    run_completion: "loiter", status: { holding: true, fuel_l: 200 }, wp_total: 2, home: { ...HERE }, home_source: null }, o || {});
  const arrived = (o, so) => { const w = outbound(Object.assign({ asv: { ...P3 }, S: endS(so) }, o || {})); w.api.passageTick(w.S); return w; };
  const fires = (w) => w.api.chainFires(w.S, w.S.status, false, false);
  const W16 = arrived();
  const at16 = { state: W16.mission.passage.state, owned: W16.api.sailOwnsHold(), fires: fires(W16), card: W16.api.rthPending(),
                 said: W16.banners[0] || "" };
  await W16.api.doRTH({ chained: true });
  const H16 = W16.api.st().mission.passage, c16 = W16.cmds[0];
  const W16u = outbound({ S: endS({ status: { holding: false, fuel_l: 200 } }) });   // under way on the last section
  const under16 = W16u.api.rthPending();
  check("16. ⚠ THE ARRIVAL IS THE END OF THE MISSION: arrived, End of plan RTH - the chain's own condition fires there "
        + "(the passage does not own the hold) and the card says so, under way on the last section too; she is said to be "
        + "going home; HOME 60 km OFF, BEYOND RTH_MAX_M, she goes home ALONG THE PASSAGE as the RTH button sends her - its "
        + "first section sent as an RTH, the way home on the plan - the same mission, the chain not marked refused",
        () => at16.state === "done" && !at16.owned && at16.fires && at16.card && under16
              && /PASSAGE ARRIVED at P2: all 3 sections sailed\. End of plan RTH sends her home from here\./.test(at16.said)
              && c16 && c16[0] === "/api/cmd/rth" && W16.cmds.length === 1 && H16.kind === "rth" && H16.from.id === "Pout"
              && H16.state === "running" && H16.sections[H16.sections.length - 1].end === "home"
              && distTo(H16.sections[H16.sections.length - 1].to, HERE) < 1
              && /RTH ALONG THE PASSAGE: home is 60\.0 km away/.test(W16.banners.join(" "))
              && W16.missions.length === 0 && !W16.api.st().rthChainFailed,
        () => JSON.stringify({ at16, under16, cmd: c16 && c16[0], H: H16 && [H16.kind, H16.state, H16.from],
                               failed: W16.api.st().rthChainFailed, missions: W16.missions.length, last: W16.banners.slice(-1) }));
  const W16b = arrived({}, { home: east(HERE, 30000) });
  const fires16b = fires(W16b);
  await W16b.api.doRTH({ chained: true });
  const c16b = W16b.cmds[0], P16b = W16b.api.st().mission.passage;
  check("16b. HOME IN RANGE: the arrival chains the routed RTH a plan's end always has - planned to home and sent; the "
        + "passage left on the plan as it arrived",
        () => fires16b && c16b && c16b[0] === "/api/cmd/rth" && W16b.nogoAsked === 1
              && distTo(c16b[1].route[c16b[1].route.length - 1], east(HERE, 30000)) < 1
              && P16b.state === "done" && P16b.kind !== "rth" && W16b.api.st().planIntent.kind === "rth" && !W16b.api.st().rthChainFailed,
        () => JSON.stringify({ fires16b, cmd: c16b && c16b[0], nogo: W16b.nogoAsked, P: P16b && P16b.state }));
  const W16c = arrived({}, { completion: "loiter" });           // End of plan LOITER: the operator's word
  const loiter16 = { fires: fires(W16c), card: W16c.api.rthPending(), said: W16c.banners[0] || "" };
  const holdAt = (k) => { const w = running({ S: endS({ wp_total: 4 }) }); w.mission.passage.sent = k; w.api.passageTick(w.S);
    return { state: w.mission.passage.state, fires: fires(w) }; };
  const hold16 = holdAt(0), port16 = holdAt(1);
  const toPort16 = (() => {                                     // under way on section 2, to the fuel stop: no promise
    const w = running({ S: endS({ wp_total: 2, status: { holding: false, fuel_l: 200 } }), runRoute: [east(HERE, 25000), { ...P2 }] });
    Object.assign(w.mission.passage, { sent: 1, sec: 1, end: { ...P2 }, route: [east(HERE, 25000), { ...P2 }] });
    return w.api.rthPending();
  })();
  const W16h = homeWorld();                                     // the way home, at home: its own end
  const Hh = W16h.mission.passage, lastH = Hh.sections.length - 1;
  Object.assign(Hh, { sent: lastH, sec: lastH, state: "done", end: { ...HERE }, route: [east(HERE, 5000), { ...HERE }] });
  W16h.api.set("runRoute", null); W16h.api.set("asv", { ...HERE }); Object.assign(W16h.S, endS({ behavior: "rth" }));
  const home16 = W16h.api.sailOwnsHold();
  check("16c. NOT AT THE OPERATOR'S WORD, NOR AT A HOLD THE MISSION GOES ON FROM: End of plan LOITER holds her at the "
        + "arrival (said); a section's end and a fuel stop stay the passage's holds (she waits for Continue), and under "
        + "way to the fuel stop the card promises no return; the way home's own end is home, and holds",
        () => !loiter16.fires && !loiter16.card && /PASSAGE ARRIVED at P2: all 3 sections sailed\. She holds there\./.test(loiter16.said)
              && hold16.state === "holding" && !hold16.fires && port16.state === "at_port" && !port16.fires && !toPort16 && home16,
        () => JSON.stringify({ loiter16, hold16, port16, toPort16, home16 }));
  const W16d = arrived(); W16d.api.set("runRoute", null);
  const d16 = { owned: W16d.api.sailOwnsHold(), fires: fires(W16d), card: W16d.api.rthPending() };
  check("16d. FROM A RELOADED TAB TOO (no route in memory): the arrival's record is no hold - the chain fires, the card says so",
        () => !d16.owned && d16.fires && d16.card, () => JSON.stringify(d16));
  const W16e = arrived({}, { status: { holding: true, fuel_l: 52 } });
  await W16e.api.doRTH({ chained: true });
  check("16e. A CHAINED RTH HOME ALONG THE PASSAGE THAT IS REFUSED - too little aboard for the first port with 20% - is "
        + "said and RECORDED (the cards stop promising a return); nothing sent",
        () => W16e.cmds.length === 0 && W16e.api.st().rthChainFailed && !W16e.api.rthPending()
              && /RTH refused: home is 60\.0 km away, along the passage - refuel first/.test(W16e.banners.join(" ")),
        () => JSON.stringify({ failed: W16e.api.st().rthChainFailed, banners: W16e.banners.slice(-2) }));
  // ── 16f. FROM THE ARRIVAL ONLY (the 2026-11-12 review). The far refusal is the net under every hold sailOwnsHold does not
  // know: a Go-To from a fuel stop or from a section's hold ends at a hold no passage record names (passageTick records a
  // leaving only from a section under way), and the chain fires there. With home past RTH_MAX_M (15 km in these worlds)
  // the first build sailed her home from the middle of the passage, the passage lost; it is REFUSED there, as before.
  const midway = (state, sent, at, o) => {
    const w = outbound(Object.assign({ nogoR: 1500, asv: north(at, 300), runRoute: [north(at, 300)], S: endS({ behavior: "goto", wp_total: 1 }) }, o || {}));
    Object.assign(w.mission.passage, { state, sent, sec: sent, end: { ...at }, route: [east(HERE, 5000), { ...at }] });
    return w;
  };
  const M16 = { port: midway("at_port", 1, P2), hold: midway("holding", 0, P1), last: midway("running", 2, P2) };
  Object.assign(M16.last.mission.passage, { end: { ...P3 }, route: [east(HERE, 50000), { ...P3 }] });   // the arrival's record, she not at it
  for (const w of Object.values(M16)) await w.api.doRTH({ chained: true });
  const op16 = midway("at_port", 1, P2); await op16.api.doRTH({});                 // the RTH button there: home along the passage
  const end16 = outbound({ nogoR: 1500, asv: { ...P3 }, S: endS() }); await end16.api.doRTH({ chained: true });   // at the arrival, not yet marked
  // arrived (done), then a Go-To to a berth 300 m off, End of plan RTH: the mission is over, so that plan's end goes home too
  const after16 = midway("done", 2, P3); await after16.api.doRTH({ chained: true });
  check("16f. FROM THE ARRIVAL ONLY: a chained RTH past RTH_MAX_M from a hold no record names - a Go-To's end from a fuel "
        + "stop, from a section's hold, or on the arrival's record with her not at its end - is REFUSED as before (nothing "
        + "sent, the passage kept, the chain's refusal recorded); the RTH button there still goes home along the passage, "
        + "and at the arrival's end, not yet marked done, the chain does - as at the end of a Go-To given after she arrived",
        () => Object.values(M16).every((w) => w.cmds.length === 0 && w.api.st().mission.passage.kind !== "rth"
                && w.api.st().rthChainFailed && /^RTH refused: home is/.test(w.banners[w.banners.length - 1] || ""))
              && op16.cmds.length === 1 && op16.cmds[0][0] === "/api/cmd/rth" && op16.api.st().mission.passage.kind === "rth"
              && end16.cmds.length === 1 && end16.api.st().mission.passage.kind === "rth" && !end16.api.st().rthChainFailed
              && after16.cmds.length === 1 && after16.api.st().mission.passage.kind === "rth" && !after16.api.st().rthChainFailed,
        () => JSON.stringify({ mid: Object.fromEntries(Object.entries(M16).map(([k, w]) => [k, [w.cmds.length, w.api.st().mission.passage.kind || "out",
                                 w.api.st().rthChainFailed]])), op: [op16.cmds.length, op16.api.st().mission.passage.kind], end: [end16.cmds.length, end16.api.st().mission.passage.kind] }));
  // ── 16g. THE THREE ANSWERS (the 2026-11-12 review). The chain fires in every tab: a VIEW-ONLY one plans nothing, sends
  // nothing and claims nothing (the supervising tab is sending her); a reply LOST is said as that - the console cannot tell
  // whether she took it - and not recorded as a refusal; a REFUSAL is said and recorded; a post never sent claims nothing.
  const lostAns = { ok: false, error: "no answer from the console after 15 s - it may or may not have been carried out", sent: true, refused: false };
  const V16 = arrived({ sup: false }), L16 = arrived({ post: lostAns });
  const R16 = arrived({ post: { ok: false, error: "ARM before commanding the boat", sent: true, refused: true } });
  const U16 = arrived({ post: { ok: false, error: "this tab is VIEW ONLY", sent: false, refused: false } });
  for (const w of [V16, L16, R16, U16]) await w.api.doRTH({ chained: true });
  const saidRefused = (w) => w.banners.some((t) => /RTH refused/.test(t));
  check("16g. THE THREE ANSWERS: in a VIEW-ONLY tab the chain plans nothing, sends nothing and claims nothing (the card still "
        + "promises the return); a reply LOST is said as NOT ACKNOWLEDGED, never as refused, and not recorded; a REFUSAL is "
        + "said and recorded; a post never sent claims nothing",
        () => V16.cmds.length === 0 && V16.planned.length === 0 && V16.waterAsked.length === 0 && !V16.api.st().rthChainFailed
              && V16.api.rthPending() && !saidRefused(V16) && V16.api.st().mission.passage.kind !== "rth"
              && L16.cmds.length === 1 && !L16.api.st().rthChainFailed && !saidRefused(L16)
              && /RTH NOT ACKNOWLEDGED: no answer from the console after 15 s.* - the way home along the passage, 60\.0 km\./.test(L16.banners.join("\n"))
              && L16.logs.some((l) => l[0] === "passage_rth" && l[1].why === "unanswered")
              && R16.api.st().rthChainFailed && /RTH refused: home is 60\.0 km away, and the first section .*RTH REFUSED: ARM before/.test(R16.banners.join("\n"))
              && !U16.api.st().rthChainFailed && !U16.banners.some((t) => /RTH refused|NOT ACKNOWLEDGED|did not take it|the way home along the passage, 60/.test(t)),
        () => JSON.stringify({ view: [V16.cmds.length, V16.planned.length, V16.api.st().rthChainFailed], lost: [L16.api.st().rthChainFailed, L16.banners.slice(-1)],
                               ref: R16.api.st().rthChainFailed, unsent: [U16.api.st().rthChainFailed, saidRefused(U16)] }));

  // ── 14. the water a section is planned at ───────────────────────────────────────────────────────────────────────
  const lv = (() => {
    const src = ["const WATER_REMOTE_KM = 75;", "const fmtDist = (m, dp) => m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(dp == null ? 2 : dp) + ' km';",
                 grab("sectionLevel"), "return sectionLevel;"].join("\n");
    return new Function(src)();
  })();
  const pt = (low_m, km, o) => Object.assign({ low_m, km, kind: "predicted", name: "Stn " + km, stations: ["s" + km] }, o || {});
  const L14 = {
    lowest: lv({ points: [pt(0.8, 10), pt(-0.21, 20), pt(0.4, 5)] }, {}, 4),
    remote: lv({ points: [pt(0.8, 10), pt(0.6, 90)] }, {}, 4),
    remoteLow: lv({ points: [pt(-0.3, 10), pt(0.6, 90)] }, {}, 4),
    none: lv({ points: [], note: "the read failed: down" }, {}, 4),
    unread: lv({ points: [pt(null, 12)] }, {}, 4),
    manLow: lv({ points: [pt(0.8, 10)] }, { source: "manual", offset_m: 0.1 }, 4),
    manHigh: lv({ points: [pt(0.8, 10)] }, { source: "manual", offset_m: 2.5 }, 4),
    lake: lv({ points: [pt(0.42, 30, { kind: "observed" })] }, {}, 2),
  };
  check("14. THE LEVEL A SECTION IS PLANNED AT (sectionLevel): the LOWEST along it - a point with no station within "
        + "WATER_REMOTE_KM counts at chart datum, as the boat's own level is not applied past it; nothing read, chart "
        + "datum with why; a manual level lowers it, never raises it; below datum it is applied; each said",
        () => L14.lowest.m === -0.21 && /^-0\.21 m, the lowest predicted along it over the next 4\.0 h \(Stn 20, 20 km off\)/.test(L14.lowest.say)
              && L14.remote.m === 0 && /^chart datum - 1 of its 2 points have no station within 75 km/.test(L14.remote.say)
              && L14.remoteLow.m === -0.3 && L14.none.m === 0 && /chart datum - no level could be read along it \(the read failed: down\)/.test(L14.none.say)
              && L14.unread.m === 0 && /^chart datum - no station gave a level at 1 of its 1 points$/.test(L14.unread.say) && L14.manLow.m === 0.1 && /^\+0\.10 m, the manual water level/.test(L14.manLow.say)
              && L14.manHigh.m === 0.8 && L14.lake.m === 0.42 && /lowest observed/.test(L14.lake.say),
        () => JSON.stringify(Object.fromEntries(Object.entries(L14).map(([k, v]) => [k, v.m + " " + v.say.slice(0, 50)]))));
  // 14f (2026-10-13, Andy: "approve 1, 1b, 2 and 6"): where NOAA's surge forecast (STOFS) set a point's lowest water, the
  // server marks it src "stofs" with the tide prediction's own low beside it (asv_console.py fetch_water_along)
  const L14f = {
    stofs: lv({ points: [pt(-0.12, 3, { src: "stofs", tide_low_m: 0.16 })] }, {}, 4),
    tide: lv({ points: [pt(0.16, 3)] }, {}, 4),
  };
  check("14f. WHERE NOAA'S SURGE FORECAST SET THE LOWEST WATER, it is said - the level, 'the lowest forecast', and how far "
        + "STOFS puts it under the tide prediction; a point it did not lower reads exactly as before",
        () => L14f.stofs.m === -0.12
              && /^-0\.12 m, the lowest forecast along it over the next 4\.0 h \(Stn 3, 3 km off\) - NOAA's surge forecast \(STOFS\) puts it 0\.28 m under the tide prediction$/.test(L14f.stofs.say)
              && L14f.tide.m === 0.16 && /^\+0\.16 m, the lowest predicted along it over the next 4\.0 h \(Stn 3, 3 km off\)$/.test(L14f.tide.say),
        () => L14f.stofs.say + " | " + L14f.tide.say);
  // the read: along the section's own points, over the hours she is expected in it
  const readOf = async (from, pts, append, left) => {
    const w = { urls: [], reply: { ok: true, low_m: 0.5, points: [pt(0.5, 4)] } };
    const src = [
      "const distTo = w.distTo, V = {SPEED_KN: {transit: 7}}, roleSpeed = () => 'transit', WATER_REMOTE_KM = 75, water = {};",
      "const sailLeftM = () => w.left;",
      "const fetch = async (u) => { w.urls.push(u); return {ok: true, json: async () => w.reply}; };",
      decl("WATER_SAMPLE_M"), decl("WATER_ALONG_MAX_PTS"), decl("WATER_ETA_SLACK"), decl("WATER_WINDOW_PAD_S"), decl("WATER_ALONG_TIMEOUT_MS"),
      "const fmtDist = (m, dp) => m < 1000 ? Math.round(m) + ' m' : (m / 1000).toFixed(dp == null ? 2 : dp) + ' km';",
      grab("samplePts"), grab("sectionLevel"), grab("waterAlongRead"), grab("sectionWater"), "return sectionWater;"].join("\n");
    w.distTo = distTo; w.left = left;
    const t = Date.now() / 1000;
    const r = await new Function("w", src)(w)({ kn: 7 }, from, pts, append);
    const u = new URL("http://x" + w.urls[0]), q = u.searchParams;
    const pts2 = q.get("pts").split(";").map((s) => s.split(",").map(Number));
    return { r, n: pts2.length, first: { lat: pts2[0][0], lon: pts2[0][1] }, last: { lat: pts2[pts2.length - 1][0], lon: pts2[pts2.length - 1][1] },
             dt0: +q.get("t0") - t, hours: (+q.get("t1") - +q.get("t0")) / 3600, path: u.pathname };
  };
  const ms7 = 7 * 1852 / 3600;
  const rd = await readOf(HERE, [east(HERE, 10000), east(HERE, 20000)], false, 0);
  const rdA = await readOf(P1, [P2], true, 8000);
  const rdLong = await readOf(HERE, [east(HERE, 1000000)], false, 0);
  check("14b. THE READ ALONG IT (sectionWater): /api/water/along at the section's own points - every " + 5 + " km and both "
        + "ends (at most 60) - from now over her time to its end at its speed, stretched by 1.5, and an hour after; sent "
        + "ahead of her, what she has left of the route first",
        () => rd.path === "/api/water/along" && rd.n === 5 && distTo(rd.first, HERE) < 2 && distTo(rd.last, east(HERE, 20000)) < 2
              && Math.abs(rd.dt0) < 5 && Math.abs(rd.hours - (20000 / ms7 * 1.5 + 3600) / 3600) < 0.01
              && Math.abs(rdA.hours - (28000 / ms7 * 1.5 + 3600) / 3600) < 0.01 && rdLong.n >= 58 && rdLong.n <= 60 && rd.r.m === 0.5,
        () => JSON.stringify({ n: [rd.n, rdLong.n], hours: [rd.hours.toFixed(2), rdA.hours.toFixed(2)], dt0: rd.dt0.toFixed(1) }));
  // the chart it is planned on: built at the section's level, and the guard's put back
  const atW = (o) => {
    const w = Object.assign({ builds: [], inked: 0 }, o);
    const src = [
      "const nogo = w.nogo, sea = {enc: {features: []}}, TIDE_REBUILD_M = 0.1, nogoDR = () => ({min: 3, max: 0});",
      "const buildKeepouts = (frame, enf, dr, feats, m) => { w.builds.push(m); return {builtAt: m, polys: [], lines: [], points: []}; };",
      // (deep water first's margin layer at the same water, 2026-10-12: its level is what is asked here)
      "const buildMargin = (frame, enf, dr, feats, m) => { w.margins = (w.margins || []).concat([m]); return {at: m, polys: [], lines: [], points: []}; };",
      "const foldChartInk = (ko) => { w.inked++; ko.inked = true; };",
      // nogoModelAt builds from modelFeatures since 2026-10-18 (less a waived lock's gates): the real one, none waived
      "let lockWaiver = null; const lockFeatureKey = (f) => String(f);", grab("modelFeatures"),
      // (a level's model is kept while the chart is the same, 2026-11-08: koAtLevel's own cache)
      decl("KO_LEVEL_KEEP"), /^const koLevelKept = [^;]*;/m.exec(H)[0],
      grab("nogoModelAt"), grab("koAtLevel"), grab("atWaterLevel"), "return atWaterLevel;"].join("\n");
    return { w, at: new Function("w", src)(w) };
  };
  const LIVE = { live: true };
  const A14 = atW({ nogo: { ready: true, frame: {}, ko: LIVE, builtOffset: 1.2, features: [] } });
  const seen = A14.at(0.2, () => A14.w.nogo.ko);
  const after = A14.w.nogo.ko;
  let threw = false; try { A14.at(0.2, () => { throw new Error("x"); }); } catch (e) { threw = true; }
  const A14b = atW({ nogo: { ready: true, frame: {}, ko: LIVE, builtOffset: 1.2, features: [] } });
  const same = A14b.at(1.25, () => A14b.w.nogo.ko);
  check("14c. PLANNED ON THE CHART AT THAT LEVEL (atWaterLevel): the planning runs on the guard's chart built at the "
        + "section's level, the chart-image structures folded in, and the guard's own chart is put back after - even when "
        + "the planning throws; within TIDE_REBUILD_M of the level it was built at, on the chart itself (nothing built)",
        () => seen.builtAt === 0.2 && seen.inked && after === LIVE && threw && A14.w.nogo.ko === LIVE
              && same === LIVE && A14b.w.builds.length === 0,
        () => JSON.stringify({ seen, back: after === LIVE, threw, same: same === LIVE, builds: A14b.w.builds }));
  // the real builder: a 2.5 m depth area at a 3 m floor, the live level +1.0 - open; built at +0.2 - a keep-out
  const ST = require(path.join(APP, "static", "js", "state.js")), CH = require(path.join(APP, "static", "js", "chart.js"));
  const GE = require(path.join(APP, "static", "js", "geodesy.js")), K = require(path.join(APP, "static", "js", "keepouts.js"));
  const FR = GE.planeFrame(HERE), Pq = (e, n) => { const q = FR.fromEN(e, n); return [q.lon, q.lat]; };
  const flat = [{ role: "depth_area", props: { DRVAL1: 1, DRVAL2: 2.5 },
                  geometry: { type: "Polygon", coordinates: [[Pq(-50, -50), Pq(50, -50), Pq(50, 50), Pq(-50, 50), Pq(-50, -50)]] } }];
  const keepLevel = ST.sea.waterOffset;
  ST.sea.waterOffset = 1.0;
  const enf = { ...ST.NOGO_ENF };
  const kLive = CH.buildKeepouts(FR, enf, { min: 3, max: 0 }, flat), kLow = CH.buildKeepouts(FR, enf, { min: 3, max: 0 }, flat, 0.2);
  const liveAfter = ST.sea.waterOffset;
  ST.sea.waterOffset = keepLevel;
  check("14d. THE REAL BUILDER at another level (chart.js buildKeepouts' waterOffsetM): a 2.5 m depth area at a 3 m floor "
        + "is open water at the live +1.0 m and a keep-out built at a section's +0.2 m - and the live level is not written",
        () => !K.blocked({ e: 0, n: 0 }, kLive, 0) && K.blocked({ e: 0, n: 0 }, kLow, 0) && liveAfter === 1.0,
        () => "live " + K.blocked({ e: 0, n: 0 }, kLive, 0) + ", at +0.2 " + K.blocked({ e: 0, n: 0 }, kLow, 0) + ", level after " + liveAfter);
  const W14 = world();
  await W14.api.sailPassage();
  const P14 = W14.api.st().mission.passage;
  const wiring14 = {
    asked: W14.waterAsked.length === 1 && distTo(W14.waterAsked[0].from, HERE) < 1 && W14.waterAsked[0].append === false,
    plannedAt: W14.levels.length === 1 && W14.levels[0] === 0.35,
    kept: P14 && P14.sections[0].water_m === 0.35 && /^\+0\.35 m, the lowest predicted/.test(P14.sections[0].water),
    said: P14 && /planned at \+0\.35 m/.test(W14.api.sailLine(P14)),
    // (since 2026-10-12 in the route worker, on the chart at that level - koAtLevel - and on this thread, in atWaterLevel
    // at it, if the worker cannot answer: tests/route_worker.js 6)
    wrapped: /const o = holdOpts\(\), via = line\.slice\(0, -1\), std = transitStandoffM\(\), koLv = koAtLevel\(lv\.m\);/.test(grab("sailSend"))
             // (and open water first on every leg of it, 2026-10-14 - tests/open_water.js)
             && /planOffThread\(\{op: "holdRoute", ko: koLv, args: \{target: c\.to, holdOpts: o, start: from, via, keepRightAll: true, standoffM: std,\s*\n\s*ropts: \{openWater: ow\}\}\},[^\n]*\n\s*\(\) => atWaterLevel\(lv\.m, \(\) => \{\s*\n\s*ht = holdTarget\(c\.to, o\);/.test(grab("sailSend")),
    // its chart read along it as a ROUTE, where the read can find something - and any wider read the planning makes
    routeInk: /await ensureNogoCovers\(\[from, \.\.\.pts\], null, \{route: true\}\);/.test(grab("sailSend")),
    oneWriter: (H.match(/sea\.waterOffset\s*=(?!=)/g) || []).length === 1,
    // (the read is waterAlongRead since 2026-11-07 - one read for a section and a survey's punch, sectionWater asks it)
    endpoint: /"\/api\/water\/along\?pts="/.test(grab("waterAlongRead")) && /await waterAlongRead\(line, t0, t1\)/.test(grab("sectionWater")),
  };
  check("14e. THE WIRING: each section's water read before it is planned, the holdTarget and the route both planned "
        + "inside atWaterLevel at it, the level kept on the section and said on the passage's line; the live level keeps "
        + "its one writer",
        () => Object.values(wiring14).every(Boolean),
        () => Object.entries(wiring14).filter(([, v]) => !v).map(([k]) => k).join(", ") || "all wired");

  // ── 17. A PASSAGE HOME, PLANNED FROM WHERE SHE IS (Andy, 2026-11-13: "Plan a passage home") ───────────────────────
  // His Castine survey ran 87 lines of 45 km offshore with End of plan RTH; its low-fuel RTH point lay 50.5 km from home and
  // its end 71.5 km - past RTH_MAX_M with no passage on the plan, so the monitor only alerted and End of plan was refused.
  // Past RTH_MAX_M with no way home along a passage, and none being sailed, the RTH is planned as a passage from her position
  // (Plan passage's planner - the world's here) and sailed home as the way home along a passage is.
  const HER17 = east(HERE, 55000), HOME17A = east(HERE, 37000), HOME17B = east(HERE, 18000);
  const homePlanFor17 = (o) => (points) => {
    const sections = [sec({ ...points[0] }, HOME17A), sec(HOME17A, HOME17B, [east(HERE, 27000)]), sec(HOME17B, { ...HERE }, [], "port", 1)];
    const len = sections.reduce((a, c) => a + c.lengthM, 0);
    const legs = [{ lengthM: len, ...(o && o.legErr ? { error: "blocked" } : {}) }];
    return { plan: { points: points.map((p) => ({ ...p })), legs, lengthM: len, sections, model, twKn: 7, floorM: 3.15,
                     fuelLegs: [{ from: { t: 0 }, to: { t: 1 }, lengthM: len, whole: true }],
                     fuel: [(o && o.fuel) || { ok: true, start: 200, used: 20, arrive: 180 }],
                     ends: (o && o.ends) || { dep: { ok: true, km: 3, wpts: 20 }, arr: { ok: true, km: 4, wpts: 30 } } } };
  };
  const farWorld17 = (o) => world(Object.assign({ mission: { passage: null }, asv: { ...HER17 }, homePlan: homePlanFor17(),
    S: { armed: true, estop: false, run: "running", status: { holding: false, fuel_l: 200 }, wp_total: 9, home: { ...HERE }, home_source: null,
         completion: "rth" } }, o || {}));      // (End of plan RTH, as 13's)
  const tabPlan17 = PLAN();
  const W17 = farWorld17({ passage: tabPlan17 });
  const out17 = await W17.api.doRTH({});
  const H17 = W17.api.st().mission.passage, c17 = W17.cmds[0], last17 = H17 && H17.sections[H17.sections.length - 1];
  check("17. RTH, NO PASSAGE ON THE PLAN, HOME 55 km OFF: the way home PLANNED AS A PASSAGE from her position (her position "
        + "and home, both ports), the Passage tab busy while it plans and its own plan left alone; its first section planned "
        + "from her and SENT AS AN RTH; the plan's passage is the way home - kind rth, from here, its last section ending at "
        + "HOME (not a port), the passage it runs along its own - running; a new mission at the press; said and logged",
        () => out17 === undefined && W17.homeAsked && W17.homeAsked.length === 1 && W17.homeAsked[0].busy === true
              && distTo(W17.homeAsked[0].points[0], HER17) < 1 && distTo(W17.homeAsked[0].points[1], HERE) < 1
              && W17.homeAsked[0].points.map((p) => (p.port ? "p" : "") + p.t).join(" ") === "p0 p1"
              && c17 && c17[0] === "/api/cmd/rth" && c17[1].hold_clear_m === 40 && distTo(W17.planned[0].from, HER17) < 1
              && distTo(c17[1].route[c17[1].route.length - 1], HOME17A) < 1
              && H17.kind === "rth" && H17.fromHere === true && H17.state === "running" && H17.sent === 0 && H17.homeEnd === "end"
              && last17.end === "home" && last17.port === null && distTo(last17.to, HERE) < 1 && H17.path.length === 3
              && H17.path[2].end === "port" && distTo(H17.home, HERE) < 1 && W17.api.st().passage === tabPlan17 && !W17.api.st().passageBusy
              && W17.missions.length === 1 && W17.missions[0].what === "RTH as a passage home"
              && W17.api.st().planIntent.kind === "rth" && W17.banners.some((t) => /^Planning the way home as a PASSAGE… home is 55\.0 km away/.test(t))
              && /^RTH AS A PASSAGE HOME: home is 55\.0 km away, past the 50\.0 km a boxed return is planned for/.test(W17.banners[W17.banners.length - 1] || "")
              && W17.logs.some((l) => l[0] === "passage_rth" && l[1].ok && l[1].from_here === true),
        () => JSON.stringify({ asked: W17.homeAsked && W17.homeAsked.length, cmd: c17 && c17[0], H: H17 && [H17.kind, H17.state, last17 && last17.end],
                               missions: W17.missions, banner: (W17.banners[W17.banners.length - 1] || "").slice(0, 120) }));

  // 17s. THE SERVER TAKES IT: the record as the page saves it, through asv_console.py's own _check_passage (the plan's save
  // runs it). The first build's path ended at "home" and its `from.id` was null - the server refused both, and every save of
  // the plan while she sailed it would have been refused; the stubbed saveMission here could not see that.
  const srvCheck = (rec) => {
    const py = ["import importlib.util as u, json, sys", "app = sys.argv[1]; sys.path.insert(0, app)",
      "spec = u.spec_from_file_location('asv_console_under_test', app + '/asv_console.py'); C = u.module_from_spec(spec); spec.loader.exec_module(C)",
      "try:", "    C._check_passage({'passage': json.loads(sys.argv[2])}); print('ok')",
      "except Exception as e:", "    print('REFUSED: ' + str(e))"].join("\n");
    const r = require("child_process").spawnSync(process.env.PYTHON || "python", ["-c", py, APP.replace(/\\/g, "/"), JSON.stringify(rec)], { encoding: "utf8" });
    return ((r.stdout || "").trim().split("\n").pop() || "") || ("no answer: " + (r.stderr || r.error || "").toString().slice(-200));
  };
  const saved17 = srvCheck(H17), oldPath = srvCheck({ ...H17, path: H17.sections }), oldFrom = srvCheck({ ...H17, from: { id: null, sec: 0 } });
  check("17s. THE SERVER TAKES THE RECORD (asv_console.py's own _check_passage, which every save of the plan runs): the way "
        + "home planned from here is saved as it is - and the first build's two faults are refused, so the check has teeth: a "
        + "path ending at home, a `from` with no passage named",
        () => saved17 === "ok" && /^REFUSED: .*passage section 3 must end at a hold or a port/.test(oldPath) && /^REFUSED: .*its from must name/.test(oldFrom),
        () => JSON.stringify({ saved: saved17, oldPath, oldFrom }));

  // 17b. the END-OF-PLAN chain (his plan's end, 71.5 km out): sent home the same way; in a tab that does not supervise -
  // nothing planned, sent or claimed (the supervising one plans it)
  const W17b = farWorld17({ asv: east(HERE, 71500), S: { armed: true, estop: false, run: "running", status: { holding: true, fuel_l: 200 }, wp_total: 9, home: { ...HERE }, home_source: null,
                                                         completion: "rth" } });
  await W17b.api.doRTH({ chained: true });
  const V17b = farWorld17({ sup: false });
  await V17b.api.doRTH({ chained: true });
  check("17b. THE END-OF-PLAN CHAIN, home 71.5 km off and no passage on the plan: the way home planned as a passage and its "
        + "first section sent as an RTH, the chain NOT marked refused, no new mission (it is the one she is on); a view-only "
        + "tab plans, sends and claims nothing",
        () => W17b.cmds.length === 1 && W17b.cmds[0][0] === "/api/cmd/rth" && W17b.api.st().mission.passage.kind === "rth"
              && !W17b.api.st().rthChainFailed && W17b.missions.length === 0
              && !(V17b.homeAsked || []).length && V17b.cmds.length === 0 && !V17b.api.st().rthChainFailed && V17b.banners.length === 0,
        () => JSON.stringify({ sent: W17b.cmds.map((c) => c[0]), failed: W17b.api.st().rthChainFailed, viewOnly: [(V17b.homeAsked || []).length, V17b.cmds.length, V17b.banners] }));

  // 17c. THE LOW-FUEL RTH (his intent: "let the fuel low trigger a RTH. It will refuel in Castine and then resume the survey"):
  // planned the same way and sent if what is aboard gets her home at all - the 20% she is turned at is what the point is
  // for - with the survey's break-off banked for Continue; the operator's RTH on the same fuel refused below 20%, said with
  // the numbers; one that would run dry refused for the monitor too
  const res17 = model.floor + model.reserve;
  const under17 = { ok: false, start: 60, used: 60 - (model.floor + 5), arrive: model.floor + 5 };
  const dry17 = { ok: false, start: 30, used: 40, arrive: -10 };
  const brk17 = { id: "B1", why: "fuel", sv: "S1", route: [{ lat: 1, lon: 1 }] };
  const W17c = farWorld17({ homePlan: homePlanFor17({ fuel: under17 }), brk: brk17, S: { armed: true, estop: false, run: "running", status: { holding: false, fuel_l: 60 }, wp_total: 9, home: { ...HERE }, home_source: null } });
  const out17c = await W17c.api.doRTH({ why: "⚠ LOW FUEL, at the RTH point (60 L aboard)", breakWhy: "fuel" });
  const B17c = farWorld17({ homePlan: homePlanFor17({ fuel: under17 }), S: { armed: true, estop: false, run: "running", status: { holding: false, fuel_l: 60 }, wp_total: 9, home: { ...HERE }, home_source: null } });
  const outB17c = await B17c.api.doRTH({});
  const D17c = farWorld17({ homePlan: homePlanFor17({ fuel: dry17 }), brk: brk17 });
  const outD17c = await D17c.api.doRTH({ why: "⚠ LOW FUEL", breakWhy: "fuel" });
  check("17c. THE LOW-FUEL RTH, past RTH_MAX_M with no passage on the plan: planned as a passage home and SENT on fuel that "
        + "gets her home under the 20% (not the operator's: refused, with the numbers), the survey's break-off banked for "
        + "Continue; one that would run dry refused for the monitor too - nothing sent, the break-off not banked, the refusal "
        + "handed back for the monitor (fuelTick)",
        () => out17c === undefined && W17c.cmds.length === 1 && W17c.cmds[0][0] === "/api/cmd/rth" && W17c.banked.length === 1 && W17c.banked[0].id === "B1"
              && W17c.missions.length === 0 && W17c.api.st().mission.passage.kind === "rth"
              && B17c.cmds.length === 0 && outB17c && outB17c.notTaken && outB17c.notTaken.refused
              && /could not be planned as a passage - the way home is 55\.0 km and needs [\d.]+ L to arrive with 20% of the tank; she has 60\.0 L aboard\./.test(B17c.banners.join(" "))
              && D17c.cmds.length === 0 && D17c.banked.length === 0 && outD17c && outD17c.notTaken && outD17c.notTaken.refused === true
              && /needs [\d.]+ L just to get there; she has 30\.0 L aboard - find a port to refuel\./.test(D17c.banners.join(" ")),
        () => JSON.stringify({ fuel: [W17c.cmds.length, W17c.banked.length], button: [B17c.cmds.length, B17c.banners.slice(-1)], dry: [D17c.cmds.length, D17c.banners.slice(-1)] }));

  // 17d. REFUSED, SAID, NOTHING SENT: its ends not planned in detail; part of it not planned; a Stop pressed while it was
  // planned (withdrawn, and the stop named back for the monitor); a passage being planned on the Passage tab (the worker
  // answers one plan at a time - not asked); a battery hull (long passages are the diesel hulls')
  const E17 = farWorld17({ homePlan: homePlanFor17({ ends: { dep: { ok: true, km: 3, wpts: 20 }, arr: { ok: false, why: "no route clear of the chart's keep-outs on 1 leg(s)" } } }) });
  await E17.api.doRTH({});
  const L17 = farWorld17({ homePlan: homePlanFor17({ legErr: true }) }); await L17.api.doRTH({});
  const S17 = farWorld17({ duringHomePlan: (w, api) => api.stop("Stop") });
  const outS17 = await S17.api.doRTH({});
  const T17 = farWorld17({ passageBusy: true }); await T17.api.doRTH({});
  const Bt17 = farWorld17({ refuse: "long passages are for the diesel hulls - this one runs on a battery" }); await Bt17.api.doRTH({});
  const Rc17 = farWorld17(); Rc17.S.home_source = "roc-1"; await Rc17.api.doRTH({});     // a ROC's home, no passage on the plan
  const said17s = (w) => w.banners.join(" ");
  check("17d. REFUSED, SAID, NOTHING SENT: its ends not planned in detail; part of it not planned; a Stop pressed while it "
        + "planned (withdrawn, the stop handed back); a passage being planned on the Passage tab (not asked); a battery hull "
        + "and a ROC's home, which moves (not asked) - and the plan's passage left as it was each time",
        () => [E17, L17, S17, T17, Bt17, Rc17].every((w) => w.cmds.length === 0 && w.api.st().mission.passage === null)
              && /cannot be planned as a passage: home is the ROC's, and it moves/.test(said17s(Rc17)) && !(Rc17.homeAsked || []).length
              && [E17, L17, S17, Bt17].every((w) => !w.api.st().passageBusy) && T17.api.st().passageBusy   // (the tab's own plan still holds it)
              && /its ends could not be planned in detail - arriving: no route clear/.test(said17s(E17))
              && /part of it could not be planned/.test(said17s(L17))
              && /RTH withdrawn: Stop was pressed while the way home was being planned\. Nothing was sent\./.test(said17s(S17))
              && outS17 && outS17.notTaken && outS17.notTaken.withdrawn === true && outS17.notTaken.by === "Stop"
              && /a passage is being planned on the Passage tab - press RTH again in a moment/.test(said17s(T17)) && !(T17.homeAsked || []).length
              && /cannot be planned as a passage: long passages are for the diesel hulls/.test(said17s(Bt17)) && !(Bt17.homeAsked || []).length,
        () => JSON.stringify([E17, L17, S17, T17, Bt17, Rc17].map((w) => [(w.homeAsked || []).length, w.cmds.length, said17s(w).slice(-140)])));

  // 17e. A PASSAGE THAT HAS ARRIVED, she far off it (home not along it from there): the chain plans a passage home from her
  // - the arrival is the end of the mission, not a passage being sailed; one still being sailed is 13b's (refused)
  const arrived17 = { ...world().api.sailRecord(PLAN()), id: "Pdone", state: "done", sent: 2, sec: 2, end: { ...P3 }, route: [east(HERE, 50000), { ...P3 }] };
  const W17e = farWorld17({ mission: { passage: arrived17 }, asv: north(east(HERE, 55000), 25000) });
  await W17e.api.doRTH({ chained: true });
  check("17e. FROM A PASSAGE THAT HAS ARRIVED, she 25 km off it: the end-of-plan chain plans a passage home from her position "
        + "and sails it (no passage is being sailed), the arrived passage replaced by the way home",
        () => (W17e.homeAsked || []).length === 1 && W17e.cmds.length === 1 && W17e.cmds[0][0] === "/api/cmd/rth"
              && W17e.api.st().mission.passage.kind === "rth" && W17e.api.st().mission.passage.fromHere && !W17e.api.st().rthChainFailed,
        () => JSON.stringify({ asked: (W17e.homeAsked || []).length, cmds: W17e.cmds.map((c) => c[0]), banners: W17e.banners.slice(-1) }));

  // 17f. HOME: the last section sailed, she holds at home - the record done, said "she is home"; not an arrival (End of plan
  // does not send her home from home) and the hold the passage's own (the chain stands down there); no passage being sailed
  // now, so the next far RTH - a Continued survey's End of plan - plans a passage home afresh
  const H17f = W17.api.st().mission.passage, route17f = [HOME17B, { ...HERE }];
  Object.assign(H17f, { sent: 2, sec: 2, state: "running", end: { ...HERE }, route: route17f });
  const W17f = world({ mission: { passage: H17f }, runRoute: route17f, asv: { ...HERE },
    S: { armed: true, estop: false, run: "running", status: { holding: true, fuel_l: 150 }, wp_total: 2, home: { ...HERE }, home_source: null } });
  W17f.api.sailAtEnd(H17f);
  check("17f. HOME: the last section sailed, the record done and 'she is home' said; NOT an arrival (End of plan does not "
        + "send her home from home) and her hold the passage's own (the chain stands down); with nothing being sailed, a "
        + "passage home from far can be planned again",
        () => H17f.state === "done" && /^HOME ALONG THE PASSAGE: she is home, all 3 sections sailed\. She holds there\./.test(W17f.banners[W17f.banners.length - 1] || "")
              && W17f.api.sailOwnsHold() === true && W17f.api.passageHomeRefusal() === null,
        () => JSON.stringify({ state: H17f.state, owns: W17f.api.sailOwnsHold(), no: W17f.api.passageHomeRefusal(), banner: W17f.banners.slice(-1) }));

  // 17g. THE WIRING: one answer to "can a passage home be planned from far" for doRTH, the monitor's range and its water
  // distance home; one planner for Plan passage and the way home; Plan passage's own wording kept
  const wiring17 = {
    rth: /const no = passageHomeRefusal\(\);/.test(grab("doRTH")) && /await sailHomeFresh\(brk, far, missionAt, how\)/.test(grab("doRTH")),
    watch: /passageHomeRefusal\(\)/.test(grab("fuelWatchAt")),
    coarse: /distTo\(here, S\.home\) > RTH_MAX_M && passageHomeRefusal\(\)/.test(grab("coarseHomeTick")),
    projection: /passageHomeRefusal\(\) \? rthTooFar\(end, S\.home\)/.test(grab("fuelProjection")),
    planner: /await passagePlanFor\(points,/.test(grab("planPassageNow")) && /await passagePlanFor\(points,/.test(grab("sailHomeFreshRun")),
    busy: /passageBusy = true;/.test(grab("sailHomeFreshRun")) && /finally\{ passageBusy = false;/.test(grab("sailHomeFreshRun")),
    sailed: /PASSAGE_ONGOING\.includes\(P\.state\) && !sailArrived\(P\)/.test(grab("passageHomeRefusal")),
  };
  check("17g. THE WIRING: doRTH, the monitor's range, its coarse water distance home and the card's charge from the plan's end "
        + "all ask passageHomeRefusal; Plan passage and the way home plan through passagePlanFor, the Passage tab busy meanwhile; "
        + "a passage being sailed (and not arrived) is the reason",
        () => Object.values(wiring17).every(Boolean),
        () => Object.entries(wiring17).filter(([, v]) => !v).map(([k]) => k).join(", ") || "all wired");

  // ── THE REVIEW OF 17 (2026-11-13): each of these was wrong in the first build ───────────────────────────────────────
  const LOWF = "⚠ LOW FUEL, at the RTH point (60 L aboard)";
  const lowWorld17 = (o) => farWorld17(Object.assign({ homePlan: homePlanFor17({ fuel: under17 }),
    S: { armed: true, estop: false, run: "running", behavior: "survey", boot_id: "b1", status: { holding: false, fuel_l: 60 }, wp_total: 9, home: { ...HERE }, home_source: null,
         completion: "rth" } }, o || {}));
  const said = (w) => w.banners.join(" | ");

  // 17h. BUSY IS ASKED AGAIN, NOT REFUSED: the Passage tab planning a passage (the planner answers one at a time). The first
  // build said "refused" - the chain marked refused for good (she held, the card said so), the monitor's latch kept
  const ch17h = farWorld17({ passageBusy: true, rthChained: true,
    S: { armed: true, estop: false, run: "running", status: { holding: true, fuel_l: 200 }, wp_total: 9, home: { ...HERE }, home_source: null } });
  const outCh17h = await ch17h.api.doRTH({ chained: true });
  const later17h = (ch17h.later || []).slice(), st17h0 = ch17h.api.st();
  later17h.forEach((t) => t.fn());
  const re17h = ch17h.api.st().rthChained;
  const sup17h = farWorld17({ passageBusy: true, rthChained: true, S: ch17h.S });        // a run commanded meanwhile: its retry superseded
  await sup17h.api.doRTH({ chained: true });
  sup17h.api.set("rthChainBusyAt", 0); (sup17h.later || []).forEach((t) => t.fn());
  const mon17h = lowWorld17({ passageBusy: true }), outMon17h = await mon17h.api.doRTH({ why: LOWF, breakWhy: "fuel" });
  const op17h = farWorld17({ passageBusy: true }), outOp17h = await op17h.api.doRTH({});
  check("17h. BUSY - THE PASSAGE TAB PLANNING ONE - IS ASKED AGAIN, NOT REFUSED: the end-of-plan chain NOT marked refused, its "
        + "one-shot re-armed RTH_BUSY_RETRY_MS on (and not when a run commanded meanwhile has taken the retry); the low-fuel "
        + "monitor told BUSY (fuelTick asks again); the operator told to press again; nothing planned or sent, each said",
        () => outCh17h === undefined && ch17h.cmds.length === 0 && !st17h0.rthChainFailed && st17h0.rthChained === true
              && later17h.length === 1 && later17h[0].ms === 15000 && re17h === false
              && /^End of plan RTH WAITING: home is 55\.0 km away, and a passage is being planned on the Passage tab .* asked again in 15 s\./.test(said(ch17h))
              && sup17h.api.st().rthChained === true
              && outMon17h && outMon17h.notTaken && outMon17h.notTaken.busy === true && !outMon17h.notTaken.refused && mon17h.cmds.length === 0
              && /^Low-fuel RTH WAITING/.test(said(mon17h))
              && outOp17h && outOp17h.notTaken && outOp17h.notTaken.busy === true && /^RTH not started: .* press RTH again in a moment\./.test(said(op17h))
              && [ch17h, mon17h, op17h].every((w) => !(w.homeAsked || []).length),
        () => JSON.stringify({ chain: [outCh17h, st17h0.rthChainFailed, later17h.map((t) => t.ms), re17h, sup17h.api.st().rthChained],
                               mon: outMon17h, op: outOp17h, said: [said(ch17h), said(mon17h), said(op17h)].map((t) => t.slice(0, 90)) }));

  // 17i. ONE WAY HOME AT A TIME, JOINED: the operator's RTH planning (55 km, too little fuel for 20% on arrival) and the low-
  // fuel monitor's asked meanwhile - the first build refused the second ("a passage is being planned on the Passage tab")
  // and the first was refused by the 20% rule: nothing sent, the monitor latched. Now ONE plan, judged by the monitor's rule
  let open17i; const gate17i = new Promise((r) => { open17i = r; });
  const J17 = lowWorld17({ homePlan: (pts) => gate17i.then(() => homePlanFor17({ fuel: under17 })(pts)) });
  const first17i = J17.api.doRTH({});
  await settle();
  const busy17i = !!J17.api.st().homeFlight;
  const second17i = J17.api.doRTH({ why: LOWF, breakWhy: "fuel" });
  await settle();
  open17i();
  const [o1_17i, o2_17i] = await Promise.all([first17i, second17i]);
  const R17i = J17.api.st().mission.passage;
  check("17i. ONE WAY HOME AT A TIME, JOINED: a far RTH asked while one is being planned takes ITS answer - one plan, one "
        + "section sent - and the low-fuel monitor's rule goes with it (home at all, not with 20%), the record keeping it",
        () => busy17i && (J17.homeAsked || []).length === 1 && J17.cmds.length === 1 && J17.cmds[0][0] === "/api/cmd/rth"
              && o1_17i === undefined && o2_17i === undefined && R17i && R17i.kind === "rth" && R17i.lowFuel === true
              && J17.notes.some((t) => /already being planned as a passage/.test(t)) && !J17.api.st().homeFlight,
        () => JSON.stringify({ busy: busy17i, asked: (J17.homeAsked || []).length, cmds: J17.cmds.map((c) => c[0]), o1_17i, o2_17i,
                               low: R17i && R17i.lowFuel, said: said(J17).slice(-200) }));

  // 17j. THE LOW-FUEL WAY HOME KEEPS ITS RULE: Continue after a Stop, and the RTH button along it, were held to 20% and
  // refused on the fuel the monitor sent her home on; and the operator's own way home keeps the 20% rule
  const rec17j = W17c.api.st().mission.passage;
  const stopped = (rec, fuel) => world({ mission: { passage: { ...rec, state: "stopped" } }, asv: { ...HER17 },
    S: { armed: true, estop: false, run: "idle", status: { holding: true, fuel_l: fuel }, wp_total: 0, home: { ...HERE }, home_source: null } });
  const cont17j = stopped(rec17j, 60).api.continueRefusal(stopped(rec17j, 60).api.st().mission.passage);
  const cont20 = (() => { const w = stopped({ ...rec17j, lowFuel: undefined }, 60); return w.api.continueRefusal(w.api.st().mission.passage); })();
  const dry17j = (() => { const w = stopped(rec17j, 8); return w.api.continueRefusal(w.api.st().mission.passage); })();
  const btn17j = world({ mission: { passage: { ...rec17j, state: "stopped" } }, asv: { ...HER17 },
    S: { armed: true, estop: false, run: "idle", status: { holding: true, fuel_l: 60 }, wp_total: 0, home: { ...HERE }, home_source: null } });
  const hr17j = btn17j.api.homeRecord();
  await btn17j.api.doRTH({});
  check("17j. THE LOW-FUEL WAY HOME KEEPS ITS RULE (the record's lowFuel): Continue after a Stop goes on 60 L (held to 20% it is "
        + "refused - the operator's own way home), the RTH button's way home along it carries the rule and is SENT; on too little "
        + "to get there at all Continue is refused, said 'just to get there'",
        () => rec17j.lowFuel === true && cont17j === null && /^refuel first: 60\.0 L aboard, and home is .* to arrive with 20% of the tank$/.test(cont20 || "")
              && /just to get there$/.test(dry17j || "") && hr17j && hr17j.lowFuel === true
              && btn17j.cmds.length === 1 && btn17j.cmds[0][0] === "/api/cmd/rth" && btn17j.api.st().mission.passage.lowFuel === true,
        () => JSON.stringify({ low: rec17j.lowFuel, cont17j, cont20, dry17j, hr: hr17j && hr17j.lowFuel, btn: btn17j.cmds.map((c) => c[0]), said: said(btn17j).slice(-160) }));

  // 17k. THE ENERGY OVERRIDE TURNED ON WHILE IT PLANNED: the boxed RTH withdraws the monitor's then (2026-11-10); this one sent it
  const ov17k = lowWorld17({ duringHomePlan: (w, api) => api.set("fuelNow", { override: true }) });
  const outOv17k = await ov17k.api.doRTH({ why: LOWF, breakWhy: "fuel" });
  const opOv17k = farWorld17({ duringHomePlan: (w, api) => api.set("fuelNow", { override: true }) });
  await opOv17k.api.doRTH({});
  check("17k. THE ENERGY OVERRIDE TURNED ON WHILE THE MONITOR'S WAY HOME PLANNED: withdrawn - nothing sent, said, an answer (the "
        + "monitor does not ask again: under the override nothing is monitored); the operator's own RTH is sent",
        () => ov17k.cmds.length === 0 && outOv17k === undefined && /Low-fuel RTH WITHDRAWN — the energy override was turned on while the way home was being planned/.test(said(ov17k))
              && !ov17k.api.st().mission.passage && opOv17k.cmds.length === 1,
        () => JSON.stringify({ cmds: ov17k.cmds.length, out: outOv17k, said: said(ov17k).slice(-160), op: opOv17k.cmds.length }));

  // 17l. THE PRESS, KEPT: home moved, a new link, another command - while it planned; a Stop while the first section's chart
  // was read (before the route's own planning took its mark); the guard's hold waited through - but not by the chain
  const fence17 = (o, during, opts) => { const w = lowWorld17(Object.assign({ duringHomePlan: during }, o)); return w.api.doRTH(opts || {}).then((out) => ({ w, out })); };
  const hm = await fence17({ homePlan: homePlanFor17() }, (w) => { w.S.home = east(HERE, 800); }, { why: LOWF, breakWhy: "fuel" });
  const bt = await fence17({ homePlan: homePlanFor17() }, (w) => { w.S.boot_id = "b2"; }, { why: LOWF, breakWhy: "fuel" });
  const cm = await fence17({ homePlan: homePlanFor17() }, (w) => { w.S.behavior = "goto"; }, { why: LOWF, breakWhy: "fuel" });
  const gd = await fence17({}, (w) => { w.S.behavior = "hold"; }, { why: LOWF, breakWhy: "fuel" });
  const cg = await fence17({ homePlan: homePlanFor17(), S: { armed: true, estop: false, run: "running", behavior: "survey", boot_id: "b1",
    status: { holding: true, fuel_l: 200 }, wp_total: 9, home: { ...HERE }, home_source: null } }, (w) => { w.S.behavior = "hold"; }, { chained: true });
  const sc = (() => { const w = lowWorld17({ duringCover: (w2, api) => api.stop("Stop") }); return w.api.doRTH({ why: LOWF, breakWhy: "fuel" }).then((out) => ({ w, out })); })();
  const sc17 = await sc;
  // (and one pressed while the route itself planned - after the chart read: only the check at the post sees it here)
  const sp17 = await (() => { const w = lowWorld17({ duringPlan: (w2, api) => api.stop("Stop") }); return w.api.doRTH({ why: LOWF, breakWhy: "fuel" }).then((out) => ({ w, out })); })();
  const recEnd = (() => { const w = farWorld17(); const p = homePlanFor17()([{ ...HER17, port: true, t: 0 }, { ...east(HERE, -500), port: true, t: 1 }]).plan;
    return w.api.homePassageRecord(p).home; })();
  check("17l. THE PRESS, KEPT: home moved, a new link, she commanded elsewhere while it planned - WITHDRAWN, said, nothing sent, "
        + "named back (the monitor stands on another command, as on a Stop); a Stop pressed while the first section's chart "
        + "was read - withdrawn before its route is planned, and one pressed while that route planned - withdrawn at the send; the guard's hold waited through (sent) but the chain never sends her home off it; the record's "
        + "home the one it was planned to",
        () => [hm, bt, cm, cg].every((x) => x.w.cmds.length === 0 && /RTH withdrawn: /.test(said(x.w)))
              && /RTH withdrawn: home was moved while the way home was being planned\. Nothing was sent\./.test(said(hm.w))
              && hm.out.notTaken.withdrawn && hm.out.notTaken.by === "home moved"
              && /a new link came up/.test(said(bt.w)) && bt.out.notTaken.by === "a new link"
              && /she was commanded elsewhere \(goto now\)/.test(said(cm.w)) && cm.out.notTaken.by === "another command"
              && gd.w.cmds.length === 1 && cg.w.api.st().rthChainFailed === true
              && sc17.w.cmds.length === 0 && sc17.out.notTaken.withdrawn && sc17.out.notTaken.by === "Stop"
              && sc17.w.planned.length === 0 && sp17.w.planned.length === 1     // withdrawn before its route was planned
              && sp17.w.cmds.length === 0 && sp17.out && sp17.out.notTaken && sp17.out.notTaken.by === "Stop"
              && /RTH withdrawn: Stop was pressed while the way home was being routed/.test(said(sc17.w))
              && distTo(recEnd, east(HERE, -500)) < 1,
        () => JSON.stringify({ hm: [hm.w.cmds.length, hm.out], bt: bt.out, cm: cm.out, gd: gd.w.cmds.length, cg: [cg.w.cmds.length, cg.w.api.st().rthChainFailed],
                               sc: [sc17.w.cmds.length, sc17.out], recEnd, said: said(sc17.w).slice(-160) }));

  // 17m. THE CONSOLE'S OWN ANSWER for the monitor: refused because she was disarmed as the console saw it - the first build
  // handed back the page's frame-old state (armed), so the monitor kept its latch; and a chained withdrawal is recorded
  const cs17 = lowWorld17({ post: { ok: false, refused: true, status: 409, error: "ARM before commanding the boat", state: { armed: false, estop: false } } });
  const outCs17 = await cs17.api.doRTH({ why: LOWF, breakWhy: "fuel" });
  const cw17 = farWorld17({ duringHomePlan: (w, api) => api.stop("Stop"),
    S: { armed: true, estop: false, run: "running", status: { holding: true, fuel_l: 200 }, wp_total: 9, home: { ...HERE }, home_source: null } });
  await cw17.api.doRTH({ chained: true });
  check("17m. THE CONSOLE'S OWN ANSWER handed back to the monitor (its state: disarmed - fuelTick asks again the frame she can be "
        + "sent); and the end-of-plan chain's way home withdrawn by a Stop is recorded, as the boxed RTH's is",
        () => cs17.cmds.length === 1 && outCs17 && outCs17.notTaken && outCs17.notTaken.refused && outCs17.notTaken.state && outCs17.notTaken.state.armed === false
              && cw17.cmds.length === 0 && cw17.api.st().rthChainFailed === true,
        () => JSON.stringify({ out: outCs17, chain: cw17.api.st().rthChainFailed }));

  // 17n. THE SURVEY'S BREAK-OFF TAKEN AGAIN AT THE SEND: she surveyed on while it planned; the first build banked where she was
  // at the press, so Continue would fly those minutes again. Where none can be taken at the send (she holds), the press's
  const bk1 = lowWorld17({ brk: brk17, duringHomePlan: (w) => { w.brk = { ...brk17, id: "B2" }; } });
  await bk1.api.doRTH({ why: LOWF, breakWhy: "fuel" });
  const bk2 = lowWorld17({ brk: brk17, duringHomePlan: (w) => { w.brk = null; } });
  await bk2.api.doRTH({ why: LOWF, breakWhy: "fuel" });
  check("17n. THE SURVEY'S BREAK-OFF, TAKEN AGAIN AT THE SEND (she surveyed on while it planned) - the press's where none can be "
        + "taken then",
        () => bk1.cmds.length === 1 && bk1.banked.length === 1 && bk1.banked[0].id === "B2" && bk2.banked.length === 1 && bk2.banked[0].id === "B1",
        () => JSON.stringify({ b1: bk1.banked.map((b) => b.id), b2: bk2.banked.map((b) => b.id) }));

  // 17o. THE WIRING of the review: the monitor's busy answer (fuelTick); the chain's busy retry cleared by a run commanded;
  // Plan passage says why it does nothing; the planner asks `gone` while the chart is read, not only after it
  // (since 2026-11-14 the wait itself is corridorWait's, with its end: `gone` asked there after each wait, before the clock
  // is read and the poll asked, the clock judged on that poll's answer; and after the ask itself, before its late - passage_plan
  // 16m and 16o drive the order)
  const ft = grab("fuelTick"), pf = grab("passagePlanFor"), cw = grab("corridorWait");
  const wiring17o = {
    monitor: /if\(nt && \(nt\.busy \|\| nt\.late\) && fuelBoot === bootAt\)\{ fuelRth\.acted = false; fuelRetryAt = Date\.now\(\) \+ RTH_BUSY_RETRY_MS; \}/.test(ft)
             && /\|\| Date\.now\(\) < fuelRetryAt;/.test(ft),
    rearm: /rthChained=false; rthChainFailed=false; rthChainBusyAt=0;/.test(grab("rearmRthChain"))
           && /if\(s\.behavior!=="rth"\)\{ rthChained=false; rthChainFailed=false; rthChainBusyAt=0; \}/.test(H),
    planNow: /if\(passageBusy\)\{ flashNote\("Plan passage: "/.test(grab("planPassageNow")),
    corridor: [cw.indexOf("if(gone && gone()) return {gone: true};"), cw.indexOf("const over = Date.now() >= until"),
               cw.indexOf("await corridorAsk((signal) => getCorridor(id, signal), note);"),
               cw.indexOf("if(over && st && !st.error && st.state === \"running\") return corridorLate(st);")].every((k, i, a) => k > 0 && (i === 0 || k > a[i - 1]))
              && /st = await corridorStart\(\{[\s\S]*?\}, until, gone\);\s*if\(\(st && st\.gone\) \|\| gone\(\)\) return \{gone: true\};[^\n]*\s*if\(st && st\.late\) return late\(st\);/.test(pf)
              && /st = await corridorWait\(st, until, \(s\) => \{[\s\S]*?\}, gone\);\s*\/\/[^\n]*\s*if\(\(st && st\.gone\) \|\| gone\(\)\)\{ corridorGivenUp\(readId\); return \{gone: true\}; \}\s*if\(st && st\.late\) return late\(st\);/.test(pf),
  };
  check("17o. THE WIRING of the review: the monitor asks a busy RTH again after RTH_BUSY_RETRY_MS (fuelTick); a run commanded "
        + "takes the chain's busy retry with it; Plan passage says why it does nothing; the planner asks `gone` while the chart "
        + "is read",
        () => Object.values(wiring17o).every(Boolean),
        () => Object.entries(wiring17o).filter(([, v]) => !v).map(([k]) => k).join(", ") || "all wired");

  // ── THE SECOND REVIEW OF 17 (2026-11-14): the joiner's answer, the fence's new clauses, a stale low-fuel record, the
  // break-off at the survey's end, a section being sent. Each was wrong in 027481b. ──────────────────────────────────────
  // (`gated17`: the planner answers only when the check opens it, so a second press can join and the world move meanwhile)
  const gated17 = (planFn) => { let open; const g = new Promise((r) => { open = r; }); return { open: () => open(), plan: (pts) => g.then(() => planFn(pts)) }; };
  const nt17 = (o) => (o && o.notTaken) || {};
  const asked17 = (w) => (w.homeAsked || []).length;

  // 17p. A JOINER'S ANSWER IS ITS OWN. (a) The END-OF-PLAN CHAIN joined the low-fuel monitor's way home and took its
  // "overridden" when the energy override came on - no branch for it: the chain lost, the card still promising RTH.
  const gA = gated17(homePlanFor17()), jA = lowWorld17({ homePlan: gA.plan }); jA.S.status.fuel_l = 200;
  const mA = jA.api.doRTH({ why: LOWF, breakWhy: "fuel" }); await settle();
  jA.S.status.holding = true; jA.api.set("rthChained", true);
  const cA = jA.api.doRTH({ chained: true }); await settle();
  const joinedA = !!jA.api.st().homeFlight && asked17(jA) === 1;
  jA.api.set("fuelNow", { override: true }); gA.open();
  const [moA, coA] = await Promise.all([mA, cA]);
  // (b) the OPERATOR'S RTH joined it, the same: dropped with the monitor's
  const gB = gated17(homePlanFor17()), jB = lowWorld17({ homePlan: gB.plan }); jB.S.status.fuel_l = 200;
  const mB = jB.api.doRTH({ why: LOWF, breakWhy: "fuel" }); await settle();
  const oB = jB.api.doRTH({}); await settle();
  jB.api.set("fuelNow", { override: true }); gB.open();
  const [moB, ooB] = await Promise.all([mB, oB]);
  // (c) HOME MOVED (a nearer port), then RTH pressed for it: withdrawn by the move that came before it
  const gC = gated17(homePlanFor17()), jC = lowWorld17({ homePlan: gC.plan }); jC.S.status.fuel_l = 200;
  const mC = jC.api.doRTH({ why: LOWF, breakWhy: "fuel" }); await settle();
  jC.S.home = east(HERE, 3000);
  const oC = jC.api.doRTH({}); await settle(); gC.open();
  const [moC, ooC] = await Promise.all([mC, oC]);
  // (d) a STOP, then RTH pressed again at once: withdrawn by the Stop before it
  const gD = gated17(homePlanFor17()), jD = farWorld17({ homePlan: gD.plan });
  const d1 = jD.api.doRTH({}); await settle();
  jD.api.stop("STOP");
  const d2 = jD.api.doRTH({}); await settle(); gD.open();
  const [od1, od2] = await Promise.all([d1, d2]);
  // (e) the MONITOR joined the CHAIN's, and the guard's hold rung fired while it planned: the chain's strict fence withdrew
  // both - the monitor's own press waits a hold through
  const gE = gated17(homePlanFor17()), jE = lowWorld17({ homePlan: gE.plan });
  jE.S.status.fuel_l = 200; jE.S.status.holding = true; jE.api.set("rthChained", true);
  const cE = jE.api.doRTH({ chained: true }); await settle();
  const mE = jE.api.doRTH({ why: LOWF, breakWhy: "fuel" }); await settle();
  jE.S.behavior = "hold"; gE.open();
  const [ocE, omE] = await Promise.all([cE, mE]);
  // (f) ... and a joiner whose own press no longer stands is withdrawn by what it names, said once; (g) a low-fuel joiner
  // takes the override itself - not planned again
  const gF = gated17(homePlanFor17()), jF = farWorld17({ homePlan: gF.plan });
  const pf1 = jF.api.doRTH({}); await settle();
  const pf2 = jF.api.doRTH({}); await settle();
  jF.api.stop("STOP"); gF.open();
  const [of1, of2] = await Promise.all([pf1, pf2]);
  const gG = gated17(homePlanFor17()), jG = lowWorld17({ homePlan: gG.plan });
  const g1 = jG.api.doRTH({ why: LOWF, breakWhy: "fuel" }); await settle();
  const g2 = jG.api.doRTH({ why: LOWF, breakWhy: "fuel" }); await settle();
  jG.api.set("fuelNow", { override: true }); gG.open();
  const [og1, og2] = await Promise.all([g1, g2]);
  const p17 = {
    chain: joinedA && moA === undefined && coA === undefined && asked17(jA) === 2 && jA.cmds.length === 1 && jA.cmds[0][0] === "/api/cmd/rth"
           && !jA.api.st().rthChainFailed && jA.api.st().mission.passage.lowFuel !== true,
    operator: moB === undefined && ooB === undefined && asked17(jB) === 2 && jB.cmds.length === 1 && jB.api.st().mission.passage.lowFuel !== true,
    homeMoved: nt17(moC).withdrawn && nt17(moC).by === "home moved" && ooC === undefined && asked17(jC) === 2 && jC.cmds.length === 1
               && distTo(jC.homeAsked[1].points[1], east(HERE, 3000)) < 1 && /RTH withdrawn: home was moved/.test(said(jC)),
    stopFirst: nt17(od1).by === "STOP" && od2 === undefined && asked17(jD) === 2 && jD.cmds.length === 1,
    chainHold: nt17(ocE).withdrawn && nt17(ocE).by === "a hold" && jE.api.st().rthChainFailed && omE === undefined && asked17(jE) === 2
               && jE.cmds.length === 1 && jE.api.st().mission.passage.lowFuel === true && /she was put on station-keeping/.test(said(jE)),
    bothStopped: nt17(of1).by === "STOP" && nt17(of2).by === "STOP" && asked17(jF) === 1 && jF.cmds.length === 0
                 && jF.banners.filter((b) => /^RTH withdrawn/.test(b)).length === 1,
    lowOverride: og1 === undefined && og2 === undefined && asked17(jG) === 1 && jG.cmds.length === 0,
  };
  check("17p. A JOINER'S ANSWER IS ITS OWN: the end-of-plan chain and the operator's RTH that joined the monitor's way home are "
        + "planned again and sent when the energy override withdraws the monitor's (the chain's not lost, its record not the "
        + "monitor's); an RTH pressed after home moved, or after a Stop, is planned again and sent, the first withdrawn; the "
        + "monitor that joined the chain's is sent when a guard hold withdraws the chain's (recorded); a joiner whose own press "
        + "no longer stands is withdrawn by it, said once, nothing planned again; a low-fuel joiner takes the override",
        () => Object.values(p17).every(Boolean),
        () => JSON.stringify({ bad: Object.entries(p17).filter(([, v]) => !v).map(([k]) => k),
                               A: [moA, coA, asked17(jA), jA.cmds.length], B: [moB, ooB, asked17(jB), jB.cmds.length],
                               C: [nt17(moC), ooC, asked17(jC), jC.cmds.length], D: [nt17(od1), od2, asked17(jD), jD.cmds.length],
                               E: [nt17(ocE), omE, asked17(jE), jE.cmds.length], F: [nt17(of1), nt17(of2), asked17(jF)],
                               G: [og1, og2, asked17(jG), jG.cmds.length], said: [said(jC), said(jE)].map((t) => t.slice(-160)) }));

  // 17q. THE FENCE'S NEW CLAUSES (rthFence): the guard's ESCAPE is not waited through (the monitor never sends her home in
  // one - fuel.js rthDecision - and the press's fence let the far RTH go out off it); a motion THIS console commands of the
  // same behavior withdraws it (cmdGen), the guard's own upkeep of the plan does not; a HOLD is waited through at either
  // end; the CHAIN is withdrawn when End of plan is no longer RTH (the operator's over-ride), and by a hold
  const S17q = (o) => Object.assign({ armed: true, estop: false, run: "running", behavior: "survey", boot_id: "b1",
    status: { holding: false, fuel_l: 200 }, wp_total: 9, home: { ...HERE }, home_source: null, completion: "rth" }, o || {});
  const fenced17 = async (s, during, opts) => {
    const w = farWorld17({ S: S17q(s), duringHomePlan: during });
    if (opts && opts.chained) w.api.set("rthChained", true);
    const out = await w.api.doRTH(opts || {});
    return { by: nt17(out).by || null, sent: w.cmds.length, failed: !!w.api.st().rthChainFailed, said: said(w) };
  };
  const HOLDING = { status: { holding: true, fuel_l: 200 } };
  const q17 = {
    escape: await fenced17({}, (w, api) => { api.setPlanIntent("escape", null, []); w.S.behavior = "escape"; }, { why: LOWF, breakWhy: "fuel" }),
    escapeOver: await fenced17({}, (w, api) => { api.setPlanIntent("escape", null, []); w.S.behavior = "hold"; }),
    escapeElsewhere: await fenced17({}, (w) => { w.S.behavior = "escape"; }),
    upload: await fenced17({}, (w, api) => api.setPlanIntent("survey", null, [])),
    upkeep: await fenced17({}, (w, api) => api.setPlanIntent("survey", null, [], true)),
    holdAtPress: await fenced17({ behavior: "hold" }, (w) => { w.S.behavior = "survey"; }),
    holdWhile: await fenced17({}, (w) => { w.S.behavior = "hold"; }),
    gotoElsewhere: await fenced17({}, (w) => { w.S.behavior = "goto"; }),
    endPlan: await fenced17(HOLDING, (w) => { w.S.completion = "loiter"; }, { chained: true }),
    endPlanPress: await fenced17({}, (w) => { w.S.completion = "loiter"; }),
    chainHold: await fenced17(HOLDING, (w) => { w.S.behavior = "hold"; }, { chained: true }),
    chainSent: await fenced17(HOLDING, () => {}, { chained: true }),
  };
  const wq17 = {
    escape: ["escape", "escapeOver", "escapeElsewhere"].every((k) => q17[k].by === "the guard's escape" && q17[k].sent === 0)
            && /RTH withdrawn: the guard steered her clear in extremis \(an escape\)/.test(q17.escape.said),
    upload: q17.upload.by === "another command" && q17.upload.sent === 0 && /this console commanded her elsewhere \(survey\)/.test(q17.upload.said),
    sent: ["upkeep", "holdAtPress", "holdWhile", "endPlanPress", "chainSent"].every((k) => q17[k].by === null && q17[k].sent === 1)
          && !q17.chainSent.failed,
    goto: q17.gotoElsewhere.by === "another command" && q17.gotoElsewhere.sent === 0,
    endPlan: q17.endPlan.by === "End of plan" && q17.endPlan.sent === 0 && q17.endPlan.failed && /End of plan was changed to LOITER/.test(q17.endPlan.said),
    chainHold: q17.chainHold.by === "a hold" && q17.chainHold.sent === 0 && q17.chainHold.failed,
  };
  check("17q. THE FENCE: withdrawn by the guard's ESCAPE (this console's, one that came and went, another window's) and by a motion "
        + "THIS console commanded of the same behavior (a survey uploaded over the survey); NOT by the guard's own upkeep, or a hold "
        + "at the press or while it plans; the end-of-plan chain withdrawn and recorded when End of plan is switched to LOITER (the "
        + "operator's press goes on) and by a hold",
        () => Object.values(wq17).every(Boolean),
        () => JSON.stringify({ bad: Object.entries(wq17).filter(([, v]) => !v).map(([k]) => k),
                               got: Object.fromEntries(Object.entries(q17).map(([k, v]) => [k, [v.by, v.sent, v.failed]])) }));

  // 17r. A STALE LOW-FUEL RECORD: the monitor's way home sailed and DONE (she came home, refueled, went out again) passed its
  // rule - home on what is aboard, not with 20% - to the operator's next RTH along it, which was sent with under 20%
  const done17r = { ...rec17j, state: "done", sent: rec17j.sections.length - 1, sec: rec17j.sections.length - 1, end: { ...HERE }, route: [{ ...HERE }] };
  const at17r = (rec) => world({ mission: { passage: rec }, asv: north(east(HERE, 54000), 3000),
    S: { armed: true, estop: false, run: "running", behavior: "survey", boot_id: "b9", status: { holding: false, fuel_l: 60 }, wp_total: 9,
         home: { ...HERE }, home_source: null, completion: "rth" } });
  const wr17 = at17r(done17r), hr17 = wr17.api.homeRecord();
  await wr17.api.doRTH({});
  check("17r. A LOW-FUEL WAY HOME SAILED AND DONE passes no rule on: the operator's next RTH along it is held to 20% of the tank "
        + "(refused on 60 L, said), where a stopped one's keeps the monitor's rule (17j)",
        () => rec17j.lowFuel === true && hr17 && !hr17.why && hr17.lowFuel !== true && wr17.cmds.length === 0
              && /RTH refused: home is .* along the passage - refuel first: 60\.0 L aboard, .* to arrive with 20% of the tank/.test(said(wr17))
              && hr17j && hr17j.lowFuel === true,
        () => JSON.stringify({ rec: rec17j.lowFuel, hr: hr17 && [hr17.why, hr17.lowFuel], cmds: wr17.cmds.length, said: said(wr17).slice(-200) }));

  // 17u. THE BREAK-OFF AT THE SURVEY'S END: the survey ran to its last waypoint while the way home planned (she holds there,
  // a survey) - none can be taken at the send, and the press's would have Continue fly all of it again. Held by the guard
  // (a hold), the press's is kept (17n)
  const bk3 = lowWorld17({ brk: brk17, duringHomePlan: (w) => { w.brk = null; w.S.status.holding = true; } });
  await bk3.api.doRTH({ why: LOWF, breakWhy: "fuel" });
  const bk4 = lowWorld17({ brk: brk17, duringHomePlan: (w) => { w.brk = null; w.S.behavior = "hold"; w.S.status.holding = true; } });
  await bk4.api.doRTH({ why: LOWF, breakWhy: "fuel" });
  check("17u. A SURVEY THAT RAN TO ITS END WHILE THE WAY HOME PLANNED banks no break-off (nothing is left to fly); one held by the "
        + "guard keeps the press's",
        () => bk3.cmds.length === 1 && bk3.banked.length === 0 && bk4.cmds.length === 1 && bk4.banked.length === 1 && bk4.banked[0].id === "B1",
        () => JSON.stringify({ ended: [bk3.cmds.length, bk3.banked.map((b) => b.id)], held: [bk4.cmds.length, bk4.banked.map((b) => b.id)] }));

  // 17t. A SECTION BEING SENT AT THE SEND (sailHome's sailBusy): "refused" - final for the chain and the monitor, under a note
  // telling the operator to press again. BUSY now: the chain asked again (from here and along an arrived passage), the
  // monitor told busy, the operator to press again; nothing sent
  const busy17 = (mk, opts) => { const w = mk(); const p = w.api.doRTH(opts); return p.then((out) => ({ w, out })); };
  const tb1 = await busy17(() => { const w = farWorld17({ S: S17q(HOLDING), duringHomePlan: (x, api) => api.set("sailBusy", true) }); w.api.set("rthChained", true); return w; }, { chained: true });
  const tb2 = await busy17(() => lowWorld17({ duringHomePlan: (x, api) => api.set("sailBusy", true) }), { why: LOWF, breakWhy: "fuel" });
  const tb3 = await busy17(() => farWorld17({ duringHomePlan: (x, api) => api.set("sailBusy", true) }), {});
  const tb4 = await busy17(() => { const w = arrived(); w.api.set("sailBusy", true); w.api.set("rthChained", true); return w; }, { chained: true });
  const t17 = {
    chain: tb1.out === undefined && tb1.w.cmds.length === 0 && !tb1.w.api.st().rthChainFailed && (tb1.w.later || []).length === 1
           && /it is asked again in 15 s/.test(tb1.w.notes.join(" ")),
    monitor: nt17(tb2.out).busy === true && tb2.w.cmds.length === 0,
    operator: nt17(tb3.out).busy === true && tb3.w.cmds.length === 0 && /press RTH again in a moment/.test(tb3.w.notes.join(" ")),
    along: tb4.w.cmds.length === 0 && !tb4.w.api.st().rthChainFailed && (tb4.w.later || []).length === 1,
  };
  check("17t. A SECTION BEING SENT WHEN THE WAY HOME IS READY: BUSY, not refused - the end-of-plan chain asked again "
        + "15 s on (from here, and along an arrived passage), not recorded refused; the monitor told busy; the "
        + "operator told to press again; nothing sent",
        () => Object.values(t17).every(Boolean),
        () => JSON.stringify({ bad: Object.entries(t17).filter(([, v]) => !v).map(([k]) => k),
                               chain: [tb1.out, tb1.w.cmds.length, tb1.w.api.st().rthChainFailed, (tb1.w.later || []).length, tb1.w.notes],
                               mon: tb2.out, op: [tb3.out, tb3.w.notes], along: [tb4.out, tb4.w.cmds.length, tb4.w.api.st().rthChainFailed, (tb4.w.later || []).length] }));

  // 17v. THE CHART READ ALONG THE WAY HOME DID NOT FINISH (2026-11-14): passagePlanFor gives the read up at
  // CORRIDOR_WAIT_MAX_MS (passage_plan 16j-16m) - it waited for good before, and held the ONE flight home that every later
  // RTH joins. Its answer {error, late} is a refusal SAID naming the cause, but not final: the operator told to press
  // again - and a press after it plans and sends; the chain asked again 15 s on, not recorded refused; the monitor told
  // late (fuelTick asks again: fuel_rth 8y); a chain that JOINED the button's flight takes "late" and is asked again, said
  // so; and a corridor ERROR, not late, still ends the chain, recorded - the pair. And (the 2026-11-14 review) when the
  // console never answered the ask (`kept` false) nothing is said kept: the operator told to press again, the chain told
  // it is asked again. And (the second 2026-11-14 review) it is said WAITING, not refused, where it IS asked again - the
  // chain's, the monitor's, a flight a chain joined; and a press that no longer stands when the read is given up is
  // WITHDRAWN by what it names, not asked again: a Stop pressed while it planned (the fence asked before the late answer),
  // and a chain that joined the button's flight with End of plan switched away meanwhile (its own fence, on "late" too)
  const LATE17 = "the chart read along it did not finish in 30 min (2 of 9 tile(s) read)";
  const late17 = () => ({ error: LATE17, late: true, kept: true });
  const NOANS17 = "the chart read along it had no answer it could use from the console for 2 min (the last ask: the console could not be reached)";
  const noAns17 = () => ({ error: NOANS17, late: true, kept: false });
  const BODY17 = "home is 55.0 km away, past the 50.0 km a boxed return is planned for, and the way home could not be "
    + "planned as a passage - ";
  const REF17 = "RTH refused: " + BODY17 + LATE17, WAIT17 = "RTH WAITING: " + BODY17 + LATE17;
  const vOp = farWorld17({ homePlan: late17 });
  const oOp = await vOp.api.doRTH({});
  const opSaid = vOp.banners[vOp.banners.length - 1] || "", opSt = vOp.api.st(), opCmds = vOp.cmds.length;
  vOp.homePlan = homePlanFor17();
  const oOp2 = await vOp.api.doRTH({});
  const vCh = farWorld17({ S: S17q(HOLDING), homePlan: late17 }); vCh.api.set("rthChained", true);
  const oCh = await vCh.api.doRTH({ chained: true });
  const chSt = vCh.api.st(), chLater = (vCh.later || []).slice(), chSaid = vCh.banners[vCh.banners.length - 1] || "";
  chLater.forEach((t) => t.fn());
  const chRe = vCh.api.st().rthChained;
  const vMon = lowWorld17({ homePlan: late17 });
  const oMon = await vMon.api.doRTH({ why: LOWF, breakWhy: "fuel" });
  let openV; const gateV = new Promise((r) => { openV = r; });
  const vJ = farWorld17({ S: S17q(HOLDING), homePlan: () => gateV.then(late17) });
  const jFirst = vJ.api.doRTH({});
  await settle();
  vJ.api.set("rthChained", true);
  const jSecond = vJ.api.doRTH({ chained: true });
  await settle();
  openV();
  const [jo1, jo2] = await Promise.all([jFirst, jSecond]);
  const vErr = farWorld17({ S: S17q(HOLDING), homePlan: () => ({ error: "the chart read along it failed: no answer" }) });
  vErr.api.set("rthChained", true);
  await vErr.api.doRTH({ chained: true });
  const vNo = farWorld17({ homePlan: noAns17 });
  const oNo = await vNo.api.doRTH({});
  const vNoC = farWorld17({ S: S17q(HOLDING), homePlan: noAns17 }); vNoC.api.set("rthChained", true);
  await vNoC.api.doRTH({ chained: true });
  const vFL = farWorld17({ homePlan: () => { vFL.api.stop("STOP"); return late17(); } });
  const oFL = await vFL.api.doRTH({});
  let openJF; const gateJF = new Promise((r) => { openJF = r; });
  const vJF = farWorld17({ S: S17q(HOLDING), homePlan: () => gateJF.then(late17) });
  const jfFirst = vJF.api.doRTH({});
  await settle();
  vJF.api.set("rthChained", true);
  const jfSecond = vJF.api.doRTH({ chained: true });
  await settle();
  vJF.S.completion = "loiter";
  openJF();
  const [jf1, jf2] = await Promise.all([jfFirst, jfSecond]);
  const said17 = (w) => w.banners[w.banners.length - 1] || "";
  const v17 = {
    notKept: nt17(oNo).late === true && said17(vNo) === "RTH refused: " + BODY17 + NOANS17 + ". Press RTH again to ask again."
             && said17(vNoC) === "RTH WAITING: " + BODY17 + NOANS17 + "; the way home is asked again in 15 s."
             && !vNoC.api.st().rthChainFailed && (vNoC.later || []).length === 1,
    fenceFirst: nt17(oFL).withdrawn === true && nt17(oFL).by === "STOP" && !nt17(oFL).late && vFL.cmds.length === 0
                && /^RTH withdrawn: STOP was pressed while the way home was being planned\. Nothing was sent\.$/.test(said17(vFL))
                && !vFL.logs.some((l) => l[0] === "passage_rth" && l[1].late === true),
    joinedFence: nt17(jf1).late === true && nt17(jf2).withdrawn === true && nt17(jf2).by === "End of plan" && vJF.api.st().rthChainFailed === true && (vJF.later || []).length === 0
                 && vJF.cmds.length === 0 && (vJF.homeAsked || []).length === 1
                 && /^RTH withdrawn: End of plan was changed to LOITER while the way home was being planned\. Nothing was sent\.$/.test(said17(vJF)),
    operator: nt17(oOp).late === true && !nt17(oOp).refused && opCmds === 0 && opSt.homeFlight === null && !opSt.passageBusy
              && opSaid === REF17 + ". The tiles read are kept: press RTH again to go on from them."
              && vOp.logs.some((l) => l[0] === "passage_rth" && l[1].late === true && l[1].ok === false),
    again: oOp2 === undefined && vOp.cmds.length === 1 && vOp.cmds[0][0] === "/api/cmd/rth" && (vOp.homeAsked || []).length === 2,
    chain: oCh === undefined && vCh.cmds.length === 0 && !chSt.rthChainFailed && chSt.rthChained === true
           && chLater.length === 1 && chLater[0].ms === 15000 && chRe === false
           && chSaid === WAIT17 + "; the tiles read are kept, and the way home is asked again in 15 s.",
    monitor: nt17(oMon).late === true && !nt17(oMon).refused && vMon.cmds.length === 0
             && said17(vMon).indexOf("RTH WAITING: ") === 0
             && /; the tiles read are kept, and the way home is asked again in 15 s\.$/.test(said17(vMon)),
    joined: nt17(jo1).late === true && jo2 === undefined && (vJ.homeAsked || []).length === 1 && vJ.cmds.length === 0
            && !vJ.api.st().rthChainFailed && (vJ.later || []).length === 1 && vJ.api.st().homeFlight === null
            && said17(vJ).indexOf("RTH WAITING: ") === 0 && /asked again in 15 s\.$/.test(said17(vJ)),
    errorEnds: vErr.api.st().rthChainFailed === true && (vErr.later || []).length === 0 && vErr.cmds.length === 0,
  };
  check("17v. THE CHART READ ALONG THE WAY HOME NOT FINISHED IN 30 min (passagePlanFor's {error, late}): refused IN WORDS naming "
        + "the cause, nothing sent, the flight home and the Passage tab free - and NOT final: the operator told to press again "
        + "(a press after it plans and sends), the end-of-plan chain asked again 15 s on and not recorded refused, the "
        + "low-fuel monitor told late, a chain that joined the button's flight asked again and said so - each said WAITING, "
        + "the operator's refused; a Stop pressed while it planned, and a joined chain's End of plan switched away, withdrawn "
        + "by what they name, not asked again; a corridor error that is not late still ends the chain, recorded",
        () => Object.values(v17).every(Boolean),
        () => JSON.stringify({ bad: Object.entries(v17).filter(([, v]) => !v).map(([k]) => k), op: [oOp, opCmds, opSaid.slice(-140)],
                               again: [oOp2, vOp.cmds.length, (vOp.homeAsked || []).length], chain: [oCh, chSt.rthChainFailed, chLater.map((t) => t.ms), chRe, chSaid.slice(-90)],
                               mon: oMon, joined: [jo1, jo2, (vJ.homeAsked || []).length, (vJ.later || []).length, (vJ.banners[vJ.banners.length - 1] || "").slice(-60)],
                               err: [vErr.api.st().rthChainFailed, (vErr.later || []).length],
                               fenceFirst: [oFL, said17(vFL).slice(0, 90)], joinedFence: [jf1, jf2, vJF.api.st().rthChainFailed, (vJF.later || []).length, said17(vJF).slice(0, 90)] }));

  // 17w. THE CHART READ STOPPED UNDER THE WAY HOME (2026-11-15, a SAFETY defect an adversarial review found): the page's
  // own coarse field home posted the console {cancel: id} for a read past its 60 tiles - and that read was this way
  // home's (the same line the other way: the same tiles, the same job - tests/passage_plan.js 16s drives the two against
  // the console's own job code). passagePlanFor answered "canceled" as a plain error, so past 60 tiles of way home (a
  // few hundred km) the end-of-plan chain was recorded REFUSED (rthChainFailed) and the monitor's latch kept: no way
  // home asked again. The
  // page sends no cancel now; the console's door stays (a window on an older page, a request of the operator's own), so
  // the planner's answer to a read stopped under it is {late}. Here the planner ITSELF answers (passagePlanFor lifted,
  // the console's read answering "canceled" - every tile counted done, as corridor_status says a stopped read), and its
  // answer is handed to the far RTH: asked again by the chain and the monitor, the operator told to press again
  const logs17w = [];
  const planFor17w = new Function("fuelModel", "V", "roleSpeed", "nogoDR", "corridorGivenUp", "logClient", "corridorStart", "corridorWait",
    "passageHalfKm", "corridorSummary", "toCorridor", "updateTransitPanel", "render", "fmtMS",
    "let passageGen = 0, corridorRead = null;\n" + decl("CORRIDOR_WAIT_MAX_MS") + "\n" + grab("passagePlanFor") + "\nreturn passagePlanFor;")(
    () => ({ kind: "fuel" }), { SPEED_KN: { transit: 7 } }, () => "transit", () => ({ min: 3 }), () => {}, (k, dd) => logs17w.push([k, dd]),
    async () => ({ id: "h", state: "running", total: 70, done: 0, failed: [] }),
    async () => ({ id: "h", state: "canceled", total: 70, done: 70, failed: [] }),
    () => 25, () => "SUMMARY", (st) => st, () => {}, () => {}, (s) => s + "s");
  const stop17 = await planFor17w([{ ...HER17, port: true, t: 0 }, { ...HERE, port: true, t: 1 }], () => {}, () => false);
  const STOP17 = "the chart read along it was stopped by a cancel from elsewhere";
  const wCh = farWorld17({ S: S17q(HOLDING), homePlan: () => stop17 }); wCh.api.set("rthChained", true);
  const oChW = await wCh.api.doRTH({ chained: true });
  const wMon = lowWorld17({ homePlan: () => stop17 });
  const oMonW = await wMon.api.doRTH({ why: LOWF, breakWhy: "fuel" });
  const wOp = farWorld17({ homePlan: () => stop17 });
  const oOpW = await wOp.api.doRTH({});
  const opSaidW = said17(wOp), opCmdsW = wOp.cmds.length;
  wOp.homePlan = homePlanFor17();
  const oOpW2 = await wOp.api.doRTH({});
  const w17 = {
    planner: stop17 && stop17.late === true && stop17.kept === false && stop17.error === STOP17 && !stop17.plan
             && logs17w.some((l) => l[0] === "passage_plan" && l[1].state === "stopped" && l[1].id === "h"),
    chain: oChW === undefined && wCh.cmds.length === 0 && !wCh.api.st().rthChainFailed && (wCh.later || []).length === 1 && wCh.later[0].ms === 15000
           && said17(wCh) === "RTH WAITING: " + BODY17 + STOP17 + "; the way home is asked again in 15 s.",
    monitor: nt17(oMonW).late === true && !nt17(oMonW).refused && wMon.cmds.length === 0 && said17(wMon).indexOf("RTH WAITING: ") === 0
             && /stopped by a cancel from elsewhere; the way home is asked again in 15 s\.$/.test(said17(wMon)),
    operator: nt17(oOpW).late === true && !nt17(oOpW).refused && opCmdsW === 0
              && opSaidW === "RTH refused: " + BODY17 + STOP17 + ". Press RTH again to ask again.",
    again: oOpW2 === undefined && wOp.cmds.length === 1 && wOp.cmds[0][0] === "/api/cmd/rth",
  };
  check("17w. THE CHART READ STOPPED UNDER THE WAY HOME (a cancel put to the console from elsewhere): the planner itself "
        + "answers {error, late, kept: false} naming the cause, logged - and the far RTH is NOT refused for good: the "
        + "end-of-plan chain asked again 15 s on and not recorded refused, the low-fuel monitor told late (WAITING), the "
        + "operator told to press again - and a press after it plans and sends; nothing said kept",
        () => Object.values(w17).every(Boolean),
        () => JSON.stringify({ bad: Object.entries(w17).filter(([, v]) => !v).map(([k]) => k), planner: stop17,
                               chain: [oChW, wCh.api.st().rthChainFailed, (wCh.later || []).map((t) => t.ms), said17(wCh).slice(-110)],
                               mon: oMonW, op: [oOpW, opSaidW.slice(-110)], again: [oOpW2, wOp.cmds.length] }));

  console.log("\n" + (fails ? fails + " CHECK(S) FAILED (" + ran + " ran)" : "all checks passed (" + ran + ")"));
  process.exit(fails ? 1 : 0);
})();
