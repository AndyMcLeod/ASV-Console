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

  // a fuel stop half way, and a shoal beside the line where the 20 km mark falls
  const t1b = [0, 1, 2, 3].map((i) => grid(TX + i, TY));
  const mid = ll(t1b[1], 250, 128);
  const at20 = C.cellOf(east(A0, 20000)), g20 = t1b.find((g) => g.tx === Math.floor(at20.gx / N));
  for (let r = 129; r <= 131; r++) for (let c = -40; c <= 40; c++) {
    const gx = at20.gx + c - g20.tx * N; if (gx >= 0 && gx < N) g20.T[r * N + gx] = 10;     // a danger touching the water beside it
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

  // a long stretch with no water clear all round (a danger touching every row): one longer section
  const t1c = [0, 1].map((i) => grid(TX + i, TY));
  for (const g of t1c) for (let c = 0; c < N; c++) { g.T[127 * N + c] = 10; g.T[129 * N + c] = 10; }
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
      logs: [], saves: 0, canCommand: true, sup: true, planned: [], quiet: true, refuse: null, unroutable: 0, ownsKind: null,
      gotoTakes: true, planIntent: null, planGen: 0 }, o || {});
    const src = [
      "let S = w.S, asv = w.asv, mission = w.mission, passage = w.passage, runRoute = w.runRoute, runUnsafe = [], planIntent = w.planIntent, planGen = w.planGen;",
      "const window = {get _wpIndex(){ return w.wpIndex; }};",
      "let routeCmdsInFlight = 0, escapeThrottle = !w.quiet, guardActedAt = 0, guardEdgeAt = 0, aisAroundBusy = false, heldResuming = false;",
      "const clearance = {slowed: false}, EDGE_REASSESS_MS = 2000, M_PER_DEG_LAT = 111320;",
      "const distTo = w.distTo, FUEL_RESERVE_FRAC = w.F.FUEL_RESERVE_FRAC, passageFuel = w.F.passageFuel, energyLevel = w.F.energyLevel;",
      "const fuelModel = () => w.model, V = {SPEED_KN: {transit: 7}}, roleSpeed = () => 'transit';",
      "const fuelFmt = (m, x) => x.toFixed(1) + ' L', fmtDist = (m) => (m / 1000).toFixed(1) + ' km';",
      "const passageRefusal = () => w.refuse, passageName = (p) => p && p.t ? 'T' + p.t : 'her position';",
      "const canCommand = () => w.canCommand, supervising = () => w.sup;",
      "const saveMission = () => { w.saves++; }, logClient = (k, d) => w.logs.push([k, d]);",
      "const showBanner = (t) => w.banners.push(t), flashNote = (t) => w.notes.push(t), render = () => {}, applyCmdState = () => {}, updateTransitPanel = () => {}, updateMissionCard = () => {};",
      "const guiConfirm = async () => true, ensureNogoCovers = async () => true, holdOpts = () => ({}), transitStandoffM = () => 20;",
      "const planInsideChart = async (pts, opts, plan) => { if (w.duringPlan) w.duringPlan(w, api); return plan(); };",
      "const holdTarget = (to) => ({to, heldOff: null, holdClear: 40});",
      "const holdClearWithContacts = (p, m) => m, routeTooLong = () => false, solveCoastFor = () => ({groundM: 55});",
      "const routePlan = (from, line) => { w.planned.push({from, line}); return {route: line.map((p) => ({lat: p.lat, lon: p.lon})), unroutable: Array(w.unroutable).fill(0)}; };",
      "const routeCmd = async (p, b) => { w.cmds.push([p, b]); return w.refusePost ? {ok: false, error: 'refused'} : {ok: true, state: {status: {}}}; };",
      "const took = (r) => !!(r && r.ok), notTookSay = (r) => 'REFUSED: ' + r.error, releaseEscapeClaim = () => {};",
      "const setPlanIntent = (k, p, r) => { planGen++; planIntent = {kind: k, why: [], route: r.length}; };",
      "const legStartsHere = () => {}, setTip = (el, t) => { el.tip = t; };",
      "const ctx = new Proxy({}, {get: (t, k) => (k in t ? t[k] : (...a) => { w.ops.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; return true; }});",
      "const doGoTo = async (ll) => { w.cmds.push(['goto', ll]); if (w.gotoTakes) { planGen++; planIntent = {kind: 'goto', why: []}; if (w.gotoRoute) runRoute = w.gotoRoute; } };",
      "const $ = (id) => w.dom[id] || (w.dom[id] = {style: {}, classList: {toggle(c, on){ this[c] = on; }}, disabled: false});",
      decl("PASSAGE_AHEAD_M"), decl("PASSAGE_RETRY_MS"), decl("PASSAGE_END_M"), decl("PASSAGE_ONGOING"),
      "let sailBusy = false, sailTriedAt = 0, sailSaid = null;",
      ["sailRecord", "sailPortName", "sailRefusal", "sailSegM", "sectionRest", "sailOwns", "sailGuardQuiet", "sailLeftM", "sailSend",
       "sailPassage", "sailAppend", "sailAtEnd", "sailBreakOff", "passageTick", "sailRestM", "sailFuelShort", "continueRefusal",
       "continuePassage", "divertPassage", "dropPassage", "renderPassageControls", "sailLine", "sailOwnsHold", "drawSail"].map(grab).join("\n"),
      "const api = {sailRecord, sailRefusal, sectionRest, sailPassage, passageTick, sailAtEnd, continuePassage, continueRefusal, divertPassage,",
      "  dropPassage, renderPassageControls, sailOwnsHold, sailLine, drawSail,",
      "  st: () => ({mission, runRoute, planIntent, planGen, passage, sailBusy}), set: (k, v) => { eval(k + ' = v'); }};",
      "return api;",
    ].join("\n");
    w.dom = {}; w.F = F; w.model = model; w.distTo = distTo;
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
  const r2 = { none: ref({}, null), leg: ref({}, bad), fuel: ref({}, shortF), moved: ref({ asv: east(HERE, 5000) }),
               arm: ref({ canCommand: false, S: { armed: false, estop: false, run: "idle", status: {}, wp_total: 0 } }), busy: ref({ mission: { passage: { state: "running" } } }), hull: ref({ refuse: "long passages are for the diesel hulls" }),
               ok: ref({}) };
  check("2. THE RECORD: the plan's points and sections, ready, nothing sent - and refused first, in words: no plan, a leg "
        + "not planned, a fuel leg short of 20%, planned from where she no longer is, not armed, a passage already sailed, a "
        + "battery hull",
        () => R2.state === "ready" && R2.sent === -1 && R2.sections.length === 3 && R2.points.length === 3 && !R2.breakoff
              && /Plan passage/.test(r2.none) && /could not be planned/.test(r2.leg) && /T1 to T2 does not arrive with 20%/.test(r2.fuel)
              && /no longer is/.test(r2.moved) && /arm her first/.test(r2.arm) && /drop it first/.test(r2.busy)
              && /diesel/.test(r2.hull) && r2.ok === null,
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
  check("4. SAIL PASSAGE: section 1 planned from her position through its turning points to its held end, sent as a "
        + "Transit with its hold disc and coast; the record kept on the plan - running, section 1 sent, its end and route; "
        + "the coarse plan handed over; said and logged",
        () => W4.planned.length === 1 && distTo(W4.planned[0].from, HERE) < 1 && W4.planned[0].line.length === 2
              && c4 && c4[0] === "/api/cmd/transit" && c4[1].hold_clear_m === 40 && c4[1].coast_from_m === 55 && c4[1].route.length === 2
              && P4 && P4.state === "running" && P4.sent === 0 && P4.base === 0 && distTo(P4.end, P1) < 1 && P4.route.length === 2
              && W4.saves > 0 && st4.passage === null && /PASSAGE UNDER WAY: section 1 of 3/.test(W4.banners.pop() || "")
              && W4.logs.some((l) => l[0] === "passage_sail" && l[1].ok),
        () => JSON.stringify({ planned: W4.planned.length, cmd: c4 && [c4[0], c4[1].route.length, c4[1].hold_clear_m], P: P4 && [P4.state, P4.sent] }));
  const W4b = world({ unroutable: 1 });
  await W4b.api.sailPassage();
  check("4b. A FIRST SECTION THAT CANNOT BE PLANNED: nothing sent, nothing kept, said",
        () => W4b.cmds.length === 0 && W4b.api.st().mission.passage === null && /NOT sailed: its first section could not be sent - no route clear/.test(W4b.banners[0] || ""),
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
        + "end of the route she flies and sent after what she has LEFT of it - read when sent - its end the section's port",
        () => W5.planned.length === 1 && distTo(W5.planned[0].from, P1) < 1 && c5 && c5[1].route.length === 1 + 2
              && distTo(c5[1].route[0], P1) < 1 && distTo(c5[1].route[c5[1].route.length - 1], P2) < 1
              && P5.sent === 1 && P5.base === 1 && distTo(P5.end, P2) < 1 && W5.logs.some((l) => l[0] === "passage_section" && l[1].ok),
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
              && port6.mission.passage.state === "at_port" && /AT FUEL STOP T1/.test(port6.banners[0] || "")
              && done6.mission.passage.state === "done" && /PASSAGE ARRIVED at T2/.test(done6.banners[0] || "")
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
              && s7.mission.passage.state === "stopped" && e7.mission.passage.state === "running" && !e7.mission.passage.breakoff
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
  check("8. CONTINUE PASSAGE: from a hold, the next section from where she is through its turning points; left "
        + "mid-section, back to where she left it, then the REST of that section - running again, the leaving spent",
        () => W8.planned.length === 1 && distTo(W8.planned[0].from, P1) < 1 && W8.planned[0].line.length === 2
              && W8.mission.passage.state === "running" && W8.mission.passage.sent === 1
              && W8b.planned.length === 1 && W8b.planned[0].line.length === 3 && distTo(W8b.planned[0].line[1], east(HERE, 10000)) < 1
              && W8b.mission.passage.sent === 0 && W8b.mission.passage.breakoff === null && W8b.mission.passage.state === "running",
        () => JSON.stringify({ h: W8.planned.map((p) => p.line.length), b: W8b.planned.map((p) => p.line.map((q) => Math.round(distTo(HERE, q) / 1000))) }));
  const lowFuel = waiting("at_port", { asv: { ...P2 }, S: { armed: true, estop: false, run: "running", status: { holding: true, fuel_l: 55 }, wp_total: 4 } });
  lowFuel.mission.passage.sent = 1;
  const why8 = lowFuel.api.continueRefusal(lowFuel.mission.passage);
  await lowFuel.api.continuePassage();
  const full8 = waiting("at_port", { asv: { ...P2 }, S: { armed: true, estop: false, run: "running", status: { holding: true, fuel_l: 240 }, wp_total: 4 } });
  full8.mission.passage.sent = 1;
  const under = waiting("holding"); under.S.status.holding = false;
  check("8b. AT A PORT, REFUSED UNTIL WHAT IS ABOARD REACHES THE NEXT WITH 20% (said with the numbers), sent when it does; "
        + "under way, refused",
        () => /refuel first: 55.0 L aboard, and T2 is 20.0 km on - she needs/.test(why8 || "") && lowFuel.cmds.length === 0
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

  console.log("\n" + (fails ? fails + " CHECK(S) FAILED (" + ran + " ran)" : "all checks passed (" + ran + ")"));
  process.exit(fails ? 1 : 0);
})();
