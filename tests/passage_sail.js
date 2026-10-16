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
//   5-5c  AHEAD OF HER (passageTick): with PASSAGE_AHEAD_M left, the next section planned and sent AFTER what she has
//         left - read when it is sent, not when it was planned; not sooner, not while the guard has something in hand,
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
//         passage as an RTH, the passage on the plan becoming the way home; never the end-of-plan chain's, the low-fuel
//         monitor's, or to a ROC's home; refused on too little fuel for the first port; each next section sent ahead
//         of her as an RTH; HOME at the end; a second RTH along the same passage; left and continued;
//   14-14e THE WATER A SECTION IS PLANNED AT (sectionLevel, sectionWater, atWaterLevel, chart.js buildKeepouts'
//         waterOffsetM): the lowest trusted level along it, chart datum otherwise, a manual level lowering it only;
//         read along its own points over the hours she is expected in it; planned on the chart built at that level,
//         the guard's own put back; the wiring.
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
      "let S = w.S, asv = w.asv, mission = w.mission, passage = w.passage, runRoute = w.runRoute, runUnsafe = [], planIntent = w.planIntent, planGen = w.planGen;",
      "const window = {get _wpIndex(){ return w.wpIndex; }};",
      "let routeCmdsInFlight = 0, escapeThrottle = !w.quiet, guardActedAt = 0, guardEdgeAt = 0, aisAroundBusy = false, heldResuming = false;",
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
      "const guiConfirm = async () => true, ensureNogoCovers = async () => true, holdOpts = () => ({}), transitStandoffM = () => 20;",
      "const planInsideChart = async (pts, opts, plan) => { if (w.duringPlan) w.duringPlan(w, api); return plan(); };",
      "const holdTarget = (to) => ({to, heldOff: null, holdClear: 40});",
      "const holdClearWithContacts = (p, m) => m, routeTooLong = () => false, solveCoastFor = () => ({groundM: 55});",
      "const routePlan = (from, line, kr, std, ta, ro) => { w.planned.push({from, line, ow: ro && ro.openWater}); return {route: line.map((p) => ({lat: p.lat, lon: p.lon})), unroutable: Array(w.unroutable).fill(0)}; };",
      "const routeCmd = async (p, b) => { w.cmds.push([p, b]); return w.refusePost ? {ok: false, error: 'refused'} : {ok: true, state: {status: {}}}; };",
      "const took = (r) => !!(r && r.ok), notTookSay = (r) => 'REFUSED: ' + r.error, releaseEscapeClaim = () => {};",
      "const setPlanIntent = (k, p, r) => { planGen++; planIntent = {kind: k, why: [], route: r.length}; };",
      "const legStartsHere = () => {}, setTip = (el, t) => { el.tip = t; };",
      // step 6: the water a section is planned at (stubbed here; 14 drives the real ones), and doRTH's way home
      "const sectionWater = async (P, from, pts, append) => { w.waterAsked.push({from, pts, append}); return w.level; };",
      "const atWaterLevel = (m, fn) => { w.levels.push(m); return fn(); };",
      // THE ROUTE WORKER (2026-10-12) is not here: each search runs on this thread as it always did (tests/route_worker.js) - the
      // section's model at its water handed to it (koAtLevel) and the search run here, in atWaterLevel, as it was
      "const koAtLevel = (m) => ({atLevel: m}), planOffThread = async (job, here) => here();",
      "let rthChainFailed = false; const NOGO_RADIUS_M = 5000, homeSections = w.C.homeSections;",
      "const surveyBreakNow = () => w.brk || null, bankBreak = (b) => w.banked.push(b);",
      decl("RTH_MAX_M"),
      "const ctx = new Proxy({}, {get: (t, k) => (k in t ? t[k] : (...a) => { w.ops.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; return true; }});",
      "const doGoTo = async (ll) => { w.cmds.push(['goto', ll]); if (w.gotoTakes) { planGen++; planIntent = {kind: 'goto', why: []}; if (w.gotoRoute) runRoute = w.gotoRoute; } };",
      "const $ = (id) => w.dom[id] || (w.dom[id] = {style: {}, classList: {toggle(c, on){ this[c] = on; }}, disabled: false});",
      decl("PASSAGE_CASING"), grab("strokeCased"), grab("fillHaloed"),
      "const PASSAGE_PORT_R_M = w.C.PORT_R_M;", grab("sectionPorts"), grab("sectionAtPort"), grab("portSectionLine"),
      // (the join point: the page's model when it is ready, passage.js passageJoinVia - here what the world says, 8e)
      "const nogo = w.nogo || {ready: false};",
      "const passageJoinVia = (line, ends, frame, ko, std) => { w.joins = (w.joins || []).concat([{line, ends, frame, ko, std}]); return w.joinVia === undefined ? null : w.joinVia; };",
      decl("PASSAGE_AHEAD_M"), decl("PASSAGE_RETRY_MS"), decl("PASSAGE_END_M"), decl("PASSAGE_ONGOING"),
      "let sailBusy = false, sailTriedAt = 0, sailSaid = null;",
      ["passageEndsSay", "sailRecord", "sailPortName", "sailRefusal", "sailSegM", "sectionRest", "sailOwns", "sailGuardQuiet", "sailLeftM", "sailSend",
       "sailPassage", "sailAppend", "sailAtEnd", "sailBreakOff", "passageTick", "sailRestM", "sailFuelShort", "continueRefusal",
       "continuePassage", "divertPassage", "dropPassage", "renderPassageControls", "sailLine", "sailOwnsHold", "drawSail",
       "rthTooFar", "doRTH", "passageHome", "homeRecord", "sailHome"].map(grab).join("\n"),
      "const api = {sailRecord, sailRefusal, sectionRest, sailPassage, passageTick, sailAtEnd, continuePassage, continueRefusal, divertPassage,",
      "  dropPassage, renderPassageControls, sailOwnsHold, sailLine, drawSail, doRTH, homeRecord,",
      "  st: () => ({mission, runRoute, planIntent, planGen, passage, sailBusy, rthChainFailed}), set: (k, v) => { eval(k + ' = v'); }};",
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
  check("5. AHEAD OF HER: with " + (8000 / 1000) + " km of route left (under PASSAGE_AHEAD_M), section 2 planned FROM the "
        + "end of the route she flies and sent after what she has LEFT of it - read when sent - its end the section's port "
        + "(a port's section: to its end as a Go-To is)",
        () => W5.planned.length === 1 && distTo(W5.planned[0].from, P1) < 1 && c5 && c5[1].route.length === 1 + 1
              && distTo(c5[1].route[0], P1) < 1 && distTo(c5[1].route[c5[1].route.length - 1], P2) < 1
              && P5.sent === 1 && P5.base === 1 && distTo(P5.end, P2) < 1
              && W5.logs.some((l) => l[0] === "passage_section" && l[1].ok && l[1].water_m === 0.35)
              && W5.notes.some((n) => /^Passage: section 2 of 3 planned at \+0\.35 m, .*and sent ahead of her\.$/.test(n)),
        () => JSON.stringify({ planned: W5.planned.length, route: c5 && c5[1].route.map((p) => Math.round(distTo(HERE, p) / 1000)), P: [P5.sent, P5.base] }));
  const quietOf = (o, pre) => { const w = running(o); if (pre) pre(w); w.api.passageTick(w.S); return w; };
  const far = quietOf({ asv: east(HERE, 2000), wpIndex: 0 });
  const guard = quietOf({ quiet: false });
  const port = quietOf({}, (w) => { w.mission.passage.sections[0].end = "port"; });
  const notSup = quietOf({ sup: false });
  // a section that could not be planned, ticked again at once: not planned again inside PASSAGE_RETRY_MS
  const W5c = running({ unroutable: 1 }); W5c.api.passageTick(W5c.S); await settle(); await settle();
  W5c.api.passageTick(W5c.S); await settle(); await settle();
  check("5b. NOT YET, OR NOT AT ALL: far from the end; the guard with something in hand; past a port (she stops there); "
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
      S: { armed: true, estop: false, run: "running", status: { holding: false, fuel_l: 200 }, wp_total: 2, home: { ...HERE }, home_source: null } }, o || {}));
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
    chained: await refusedHome({}, { chained: true }), fuelSent: await refusedHome({}, { why: "LOW FUEL" }),
    none: await refusedHome({ mission: { passage: null } }), off: await refusedHome({ asv: north(east(HERE, 55000), 25000) }),
    ends: outbound(), roc: outbound(),
  };
  r13.ends.S.home = north(HERE, 9000); await r13.ends.api.doRTH({});
  r13.roc.S.home_source = "roc-1"; await r13.roc.api.doRTH({});
  const refusal = (w) => w.banners.find((b) => /^RTH refused: home is/.test(b)) || "";
  check("13b. NOT ALONG THE PASSAGE, refused as before - in words where it is the reason: the END-OF-PLAN chain and the "
        + "LOW-FUEL monitor (an automatic RTH is for home in range: the chain's refusal recorded); no passage; home at "
        + "neither end of it; a ROC's home (it moves); she far off the passage",
        () => Object.values(r13).every((w) => w.cmds.length === 0 && w.api.st().mission.passage === w.mission.passage)
              && r13.chained.api.st().rthChainFailed && !/along the passage/.test(refusal(r13.chained)) && !/along the passage/.test(refusal(r13.fuelSent))
              && /certify a return\. Set Home/.test(refusal(r13.none)) && /home is at neither end of it/.test(refusal(r13.ends))
              && /home is the ROC's/.test(refusal(r13.roc)) && /she is 25\.0 km off it/.test(refusal(r13.off)),
        () => JSON.stringify(Object.fromEntries(Object.entries(r13).map(([k, w]) => [k, refusal(w).slice(30, 150)]))));
  const W13c = outbound({ S: { armed: true, estop: false, run: "running", status: { holding: false, fuel_l: 52 }, wp_total: 2, home: { ...HERE }, home_source: null } });
  await W13c.api.doRTH({});
  check("13c. REFUSED, AS CONTINUE IS, WHILE WHAT IS ABOARD DOES NOT REACH THE FIRST PORT ON THE WAY HOME WITH 20% - said "
        + "with the numbers; nothing sent, the passage as it was",
        () => W13c.cmds.length === 0 && W13c.api.st().mission.passage.id === "Pout"
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

  // ── 14. the water a section is planned at ───────────────────────────────────────────────────────────────────────
  const lv = (() => {
    const src = ["const WATER_REMOTE_KM = 75;", grab("sectionLevel"), "return sectionLevel;"].join("\n");
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
      grab("samplePts"), grab("sectionLevel"), grab("sectionWater"), "return sectionWater;"].join("\n");
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
    endpoint: /"\/api\/water\/along\?pts="/.test(grab("sectionWater")),
  };
  check("14e. THE WIRING: each section's water read before it is planned, the holdTarget and the route both planned "
        + "inside atWaterLevel at it, the level kept on the section and said on the passage's line; the live level keeps "
        + "its one writer",
        () => Object.values(wiring14).every(Boolean),
        () => Object.entries(wiring14).filter(([, v]) => !v).map(([k]) => k).join(", ") || "all wired");

  console.log("\n" + (fails ? fails + " CHECK(S) FAILED (" + ran + " ran)" : "all checks passed (" + ran + ")"));
  process.exit(fails ? 1 : 0);
})();
