// tests/lock_transit.js - THE LOCK TRANSIT (Andy, 2026-10-18, at the Canaveral lock: "Canaveral Canal Lock goto path planning
// is driving over land. The ASV does not seem to understand locks." - offered a lock transit he opts into, "do ... B2").
//
// A lock's gates stay keep-outs to every planner and the guard; static/js/locks.js finds a lock as two gates facing each
// other, and the page OFFERS a transit when a Go-To is refused with one between her and the point - then moves it on one
// gate at a time, only on the operator's word. This holds:
//   1-4  locks.js on Canaveral's own two gates (NOAA's harbour band, 2026-10-18): one lock, its length and width; a gate
//        that says it is no lock gate, gates too near or too far, gates in line - none; the way through (hold short,
//        chamber, way out, the legs along the axis); which side she is on; a lock offered only on the way;
//   5    the model is built from the chart less the waived gates - those two, by class and id, so a re-read keeps it;
//   6-6c the page's stages driven through its own functions: offered only to the supervising chart and only with a lock
//        between; the way on planned FIRST; held short, GO IN waives the gates and holds the speed low, the chamber, GO
//        ON, out past the far gate - the gates back and the low released; a cancel inside the lock keeps the gates out
//        until she is out; the bar's words and buttons stage by stage;
//   7    the wiring: a refused Go-To offers (unless the transit's own legs), onState ticks it, the bar is on the alerts
//        card and counts as standing, both model builders read modelFeatures, the console keeps CATGAT.
//
//   node tests/lock_transit.js     # exit 0 = pass, 1 = fail   (stdlib Node)

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
const LK = require(path.join(APP, "static", "js", "locks.js"));
const GEO = require(path.join(APP, "static", "js", "geodesy.js"));
const H = fs.readFileSync(process.env.ASV_HTML || path.join(APP, "static", "asv.html"), "utf8").split("\r\n").join("\n");
const PY = fs.readFileSync(path.join(APP, "asv_console.py"), "utf8");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok = false, err = "";
  try { ok = (typeof cond === "function") ? !!cond() : !!cond; }
  catch (e) { ok = false; err = " THREW " + (e && e.message ? e.message : e); }
  if (typeof detail === "function") { try { detail = detail(); } catch (e) { detail = "detail threw " + e.message; } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : "") + err);
  if (!ok) fails++;
}
function grab(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", H.indexOf(")", start)), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function grabDecl(name) {
  const i = H.indexOf("const " + name + " =");
  if (i < 0) throw new Error("test setup: declaration " + name + " not found");
  let k = i, depth = 0;                                       // to the `;` that ends it at depth 0 (objects span lines)
  for (;; k++) { const c = H[k]; if (c === "{" || c === "(" || c === "[") depth++; else if (c === "}" || c === ")" || c === "]") depth--; else if (c === ";" && depth === 0) break; }
  return H.slice(i, k + 1);
}
console.log("The lock transit:");

// ---- the chart: Canaveral's two lock gates, as NOAA's harbour band serves them (2026-10-18) ------------------------- //
const gate = (oid, coords, props = {}) => ({ role: "dock_line", cls: "Gate_line", oid, geometry: { type: "LineString", coordinates: coords },
  props: { CATGAT: "lock gate", HORCLR: 27.4, INFORM: "Length is 182.8 meters/600 feet", ...props } });
const G1 = gate(6054, [[-80.6380154, 28.4093207], [-80.6380154, 28.4090691]]);
const G2 = gate(6055, [[-80.6400582, 28.4093135], [-80.6400568, 28.4091469], [-80.6400562, 28.4090619]]);
const LAND = { role: "land", cls: "Land_Area", oid: 704511, geometry: { type: "Polygon", coordinates: [[[-80.64, 28.41], [-80.63, 28.41], [-80.63, 28.42], [-80.64, 28.41]]] }, props: {} };
const FROM = { lat: 28.40917, lon: -80.64395 }, TARGET = { lat: 28.40846, lon: -80.57651 };   // his Go-To
const d = (a, b) => GEO.distTo(a, b);

// 1. the lock
const locks = LK.findLocks([LAND, G1, G2]);
const L = locks[0];
check("1. CANAVERAL'S TWO LOCK GATES ARE ONE LOCK: 200 m between them, 27.4 m wide (HORCLR), its note carried; a gate "
      + "that is no gate is not one",
      () => locks.length === 1 && Math.abs(L.lengthM - 200) < 5 && L.widthM === 27.4 && /182\.8/.test(L.note || "")
            && L.gates.includes(G1) && L.gates.includes(G2),
      () => JSON.stringify(locks.map((l) => ({ len: Math.round(l.lengthM), w: l.widthM, note: l.note }))));

// 2. what is not a lock
const shift = (g, de) => ({ ...g, oid: g.oid + 1000, geometry: { type: "LineString", coordinates: g.geometry.coordinates.map(([x, y]) => [x + de / (111320 * Math.cos(28.409 * Math.PI / 180)), y]) } });
const notLock = LK.findLocks([G1, { ...G2, props: { ...G2.props, CATGAT: "flood barrage gate" } }]);
const tooNear = LK.findLocks([G1, shift(G1, 20)]);
const tooFar = LK.findLocks([G1, shift(G1, 900)]);
const inLine = LK.findLocks([G1, { ...G1, oid: 1, geometry: { type: "LineString", coordinates: [[-80.6380154, 28.4097], [-80.6380154, 28.4095]] } }]);
const noCat = LK.findLocks([{ ...G1, props: { HORCLR: 27.4 } }, { ...G2, props: {} }]);
const areas = LK.findLocks([{ ...G1, cls: "Gate_area", geometry: { type: "Polygon", coordinates: [[...G1.geometry.coordinates, [-80.6380, 28.40907], G1.geometry.coordinates[0]]] } },
                            { ...G2, cls: "Gate_area", geometry: { type: "Polygon", coordinates: [[...G2.geometry.coordinates, [-80.64005, 28.40907], G2.geometry.coordinates[0]]] } }]);
check("2. NOT A LOCK: a gate that SAYS it is not a lock gate (CATGAT) is never paired; two gates 20 m apart, or 900 m, are "
      + "not one; two gates in line (not facing across a chamber) are not one; gates that say nothing (a tile read before "
      + "CATGAT was kept) still pair, as do two Gate_areas",
      () => notLock.length === 0 && tooNear.length === 0 && tooFar.length === 0 && inLine.length === 0 && noCat.length === 1 && areas.length === 1,
      () => JSON.stringify({ notLock: notLock.length, tooNear: tooNear.length, tooFar: tooFar.length, inLine: inLine.length, noCat: noCat.length, areas: areas.length }));

// 3. the way through
const W = LK.lockWay(L, FROM);
const legGap = (pts) => Math.max(...pts.slice(1).map((p, i) => d(pts[i], p)));
check("3. THE WAY THROUGH, from her side: hold short 60 m before the NEAR gate (the west one, hers), the chamber between "
      + "the gates, the way out ending 60 m beyond the far gate; the way in runs approach -> near gate -> chamber and the "
      + "way out chamber -> far gate -> way out, along the axis, a point at most 20 m apart; all of it inside the lock but "
      + "the two ends",
      () => W.nearGate === G2 && Math.abs(d(W.approach, W.near) - 60) < 1 && Math.abs(d(W.exit, W.far) - 60) < 1
            && Math.abs(d(W.chamber, W.near) - 100) < 3 && d(W.approach, FROM) < d(W.exit, FROM)
            && d(W.inLeg[W.inLeg.length - 1], W.chamber) < 0.5 && W.inLeg.some((p) => d(p, W.near) < 0.5)
            && d(W.outLeg[W.outLeg.length - 1], W.exit) < 0.5 && W.outLeg.some((p) => d(p, W.far) < 0.5)
            && legGap([W.approach, ...W.inLeg]) <= 20.5 && legGap([W.chamber, ...W.outLeg]) <= 20.5
            && LK.insideLock(L, W.chamber) && !LK.insideLock(L, W.approach) && !LK.insideLock(L, W.exit),
      () => JSON.stringify({ hold: Math.round(d(W.approach, W.near)), out: Math.round(d(W.exit, W.far)), legs: [W.inLeg.length, W.outLeg.length] }));

// 4. offered only on the way
const sameSide = LK.lockOnTheWay(locks, FROM, { lat: 28.4092, lon: -80.6480 });
const farOff = LK.lockOnTheWay(locks, { lat: 28.40917, lon: -80.6900 }, TARGET);
check("4. A LOCK IS OFFERED ONLY ON THE WAY: from her spawn to his Go-To's point it is; to a point on her own side it is "
      + "not; nor for a boat 4.5 km from it",
      () => LK.lockOnTheWay(locks, FROM, TARGET) === L && sameSide === null && farOff === null && LK.lockBetween(L, FROM, TARGET),
      () => JSON.stringify({ onWay: !!LK.lockOnTheWay(locks, FROM, TARGET), sameSide: !!sameSide, farOff: !!farOff }));

// ---- the page's own functions, in a world of their own ----------------------------------------------------------- //
// The page's lock functions in a world of their own: every free name they read, stood in for or the real module.
function mk(opts) {
  const w = { calls: [], logs: [], notes: [], speeds: [], released: [], rebuilt: 0, plans: [], sup: !(opts && opts.sup === false),
              els: {}, planOn: (opts && opts.planOn) || (() => ({ route: [] })), sent: opts && opts.sent !== undefined ? opts.sent : true };
  const el = (id) => w.els[id] || (w.els[id] = { id, style: {}, textContent: "" });
  w.nogo = { ready: true, features: [LAND, G1, G2] };
  w.S = { run: "running" };
  const src = grabDecl("LOCK_ARRIVE_M") + "\n" + grabDecl("lockDesc") + "\n" + grabDecl("LOCK_SAY") + "\n" + grabDecl("LOCK_GO") + "\n"
    + ["modelFeatures", "lockOffer", "lockStart", "lockWaive", "lockGoIn", "lockGoOn", "lockEnd", "lockTick", "renderLockBar"].map(grab).join("\n")
    + "\nreturn { lockOffer, lockStart, lockGoIn, lockGoOn, lockEnd, lockTick, renderLockBar, modelFeatures, "
    + "T: () => lockTransit, waiver: () => lockWaiver, low: () => resumeSlow, setLow: (v) => { resumeSlow = v; }, at: (p) => { asv = p; } };";
  const names = { nogo: w.nogo, S: w.S, sea: { enc: { features: [] } }, $: (s) => el(s.slice(1)),
    supervising: () => w.sup, findLocks: LK.findLocks, lockOnTheWay: LK.lockOnTheWay, lockWay: LK.lockWay, insideLock: LK.insideLock,
    lockFeatureKey: LK.featureKey, LOCK: LK.LOCK, distTo: GEO.distTo, fmtDist: (m) => Math.round(m) + " m",
    planGoToLeg: async (from, to, what) => { w.plans.push({ from, to, what }); return w.planOn(from, to); },
    planWhy: (p) => p && p.error, doGoTo: async (to, how) => { w.calls.push({ to, how }); return typeof w.sent === "function" ? w.sent(to) : w.sent; },
    rebuildNogo: () => { w.rebuilt++; }, logClient: (k, d) => w.logs.push(d), flashNote: (t) => w.notes.push(t),
    commandSpeed: (k) => w.speeds.push(k), slowestMakingWayKey: () => "low", setMsNow: () => 0,
    alertCardTidy: () => {} };
  const keys = Object.keys(names);
  // eslint-disable-next-line no-new-func
  const f = new Function(...keys, "let asv = null, lockTransit = null, lockWaiver = null, resumeSlow = false, commandedSpeed = null;\n"
    + "function releaseLow(why){ if(!resumeSlow) return false; resumeSlow = false; __released(why); return true; }\n"
    + src.replace("return { lockOffer", "return { lockOffer"));
  w.api = f(...keys.map((k) => names[k]));
  w.api.at({ ...FROM });
  return w;
}

// 5. the model, less the waived gates
{
  const w = mk();
  // (modelFeatures reads lockWaiver; the transit sets it - driven below; here read with none, then through a GO IN)
  const none = w.api.modelFeatures().length;
  check("5a. with no lock waived the model is built from every feature of the chart", () => none === 3, () => "features " + none);
}

// The flow, driven. `__released` is the page's releaseLow's own record (a free name of its stand-in).
async function flow() {
  const rel = [];
  global.__released = (why) => rel.push(why);
  const w = mk();
  const st = { holding: true };
  w.api.lockOffer(TARGET);
  const offered = { stage: w.api.T() && w.api.T().stage, bar: w.els.lockBar && w.els.lockBar.style.display, go: w.els.lk_go.textContent,
                    no: w.els.lk_cancel.textContent, words: w.els.lk_why.textContent };
  await w.api.lockStart();
  const started = { stage: w.api.T().stage, planned: w.plans.map((p) => p.what), plannedFrom: w.plans[0] && d(w.plans[0].from, w.api.T().way.exit) < 0.5,
                    toApproach: w.calls[0] && d(w.calls[0].to, w.api.T().way.approach) < 0.5 && w.calls[0].how.noLockOffer === true };
  // she arrives and holds short
  w.api.at({ ...w.api.T().way.approach }); w.api.lockTick(st);
  const heldShort = { stage: w.api.T().stage, go: w.els.lk_go.textContent, waiver: w.api.waiver() };
  await w.api.lockGoIn();
  const T = w.api.T();
  const goneIn = { stage: T.stage, waived: !!w.api.waiver() && w.api.waiver().keys.size === 2, rebuilt: w.rebuilt, low: w.api.low(), speeds: w.speeds.slice(),
                   leg: w.calls[1] && d(w.calls[1].to, T.way.chamber) < 0.5 && d(w.calls[1].how.from, T.way.chamber) < 0.5 && w.calls[1].how.lead === T.way.inLeg,
                   model: w.api.modelFeatures().map((f) => f.cls) };
  // a re-read of the same chart (new objects, same class and id): the waiver still holds
  w.nogo.features = [LAND, { ...G1 }, { ...G2 }];
  const reread = w.api.modelFeatures().map((f) => f.cls);
  w.api.at({ ...T.way.chamber }); w.api.lockTick(st);
  const inChamber = { stage: w.api.T().stage, go: w.els.lk_go.textContent };
  await w.api.lockGoOn();
  const goneOn = { stage: w.api.T().stage, leg: w.calls[2] && d(w.calls[2].to, TARGET) < 0.5 && d(w.calls[2].how.from, T.way.exit) < 0.5 && w.calls[2].how.lead === T.way.outLeg };
  w.api.at({ ...T.way.far }); w.api.lockTick(st);
  const atFarGate = { stage: w.api.T() && w.api.T().stage, waived: !!w.api.waiver() };
  w.api.at({ ...T.way.exit }); w.api.lockTick({ holding: false });
  const done = { transit: w.api.T(), waiver: w.api.waiver(), low: w.api.low(), released: rel.slice(), bar: w.els.lockBar.style.display,
                 said: w.notes.some((t) => /Lock transit done/.test(t)) };
  return { offered, started, heldShort, goneIn, reread, inChamber, goneOn, atFarGate, done };
}
async function cancelInside() {
  global.__released = () => {};
  const w = mk(); const st = { holding: true };
  w.api.lockOffer(TARGET); await w.api.lockStart();
  w.api.at({ ...w.api.T().way.approach }); w.api.lockTick(st);
  await w.api.lockGoIn();
  const T = w.api.T();
  w.api.at({ ...T.way.chamber }); w.api.lockTick(st);
  w.api.lockEnd("canceled by the operator");
  const inside = { transit: w.api.T(), waived: !!w.api.waiver() };
  w.api.at({ ...T.way.exit }); w.api.lockTick({ holding: false });
  const out = { waived: !!w.api.waiver() };
  return { inside, out, said: w.notes.slice(-1)[0] };
}
async function refusals() {
  global.__released = () => {};
  const viewOnly = mk({ sup: false }); viewOnly.api.lockOffer(TARGET);
  const sameSide = mk(); sameSide.api.lockOffer({ lat: 28.4092, lon: -80.6480 });
  const noWayOn = mk({ planOn: () => ({ error: "no route" }) }); noWayOn.api.lockOffer(TARGET); await noWayOn.api.lockStart();
  const notTaken = mk({ sent: (to) => false }); notTaken.api.lockOffer(TARGET); await notTaken.api.lockStart();
  // at the hold-short point but NOT holding (still under way, or the vessel has not said so): no stage moves on
  const notHeld = mk(); notHeld.api.lockOffer(TARGET); await notHeld.api.lockStart();
  notHeld.api.at({ ...notHeld.api.T().way.approach }); notHeld.api.lockTick({ holding: false });
  // cancelled before she went in: the transit set no low, so it releases none (a guard's CONTINUE AT LOW is not its own)
  const relBefore = [];
  global.__released = (why) => relBefore.push(why);
  const early = mk(); early.api.lockOffer(TARGET); await early.api.lockStart();
  early.api.setLow(true);                                   // the guard's CONTINUE AT LOW in force on her way to the lock
  early.api.lockEnd("canceled by the operator");
  return { notHeld: notHeld.api.T().stage, earlyReleased: relBefore.length, earlyEnded: early.api.T(), guardLowKept: early.api.low(),
           viewOnly: viewOnly.api.T(), sameSide: sameSide.api.T(),
           noWayOn: { stage: noWayOn.api.T().stage, why: noWayOn.api.T().why, sent: noWayOn.calls.length },
           notTaken: { stage: notTaken.api.T().stage, why: notTaken.api.T().why } };
}

(async () => {
  const F = await flow();
  check("6. THE TRANSIT, STAGE BY STAGE: offered (TRANSIT THE LOCK / NO, the lock described); taken, the way ON from beyond "
        + "the far gate is planned FIRST, then she goes to hold short (no lock offered for that leg); held short: GATE OPEN - "
        + "GO IN, nothing waived yet; GO IN: the two gates out of the model (rebuilt), the speed held low, a Go-To along "
        + "the axis into the chamber; a re-read of the same chart keeps them out; held in the chamber: FAR GATE OPEN - GO ON; "
        + "GO ON: along the axis out and on to the point; at the far gate still waived; out past it: done - the gates back, "
        + "the low released, said",
        () => F.offered.stage === "offer" && F.offered.bar === "" && F.offered.go === "TRANSIT THE LOCK" && F.offered.no === "NO"
              && /200 m apart, 27\.4 m wide/.test(F.offered.words)
              && F.started.stage === "approach" && F.started.planned.join() === "Lock transit" && F.started.plannedFrom && F.started.toApproach
              && F.heldShort.stage === "wait_near" && /GATE OPEN/.test(F.heldShort.go) && F.heldShort.waiver === null
              && F.goneIn.stage === "enter" && F.goneIn.waived && F.goneIn.rebuilt === 1 && F.goneIn.low === true && F.goneIn.speeds.join() === "low"
              && F.goneIn.leg && F.goneIn.model.join() === "Land_Area" && F.reread.join() === "Land_Area"
              && F.inChamber.stage === "wait_far" && /FAR GATE OPEN/.test(F.inChamber.go)
              && F.goneOn.stage === "exit" && F.goneOn.leg && F.atFarGate.stage === "exit" && F.atFarGate.waived
              && F.done.transit === null && F.done.waiver === null && F.done.low === false && F.done.released.length === 1
              && F.done.bar === "none" && F.done.said,
        () => JSON.stringify(F).slice(0, 900));
  const C = await cancelInside();
  check("6b. CANCELLED IN THE CHAMBER, the transit ends but the gates stay out of the model until she is out of the lock - "
        + "never between two keep-outs - and come back the moment she is",
        () => C.inside.transit === null && C.inside.waived === true && C.out.waived === false && /in the lock/.test(C.said || ""),
        () => JSON.stringify(C));
  const R = await refusals();
  check("6c. NOT OFFERED in a view-only chart, nor for a point on her own side; a way on that cannot be routed from beyond "
        + "the far gate stops it before she moves (nothing sent, the offer stands, said why); a hold-short she was not "
        + "routed to leaves the offer standing, said; at the hold-short point but not `holding`, nothing moves on; cancelled "
        + "before she went in, it releases no low speed (it set none) - a guard's CONTINUE AT LOW stays in force",
        () => R.notHeld === "approach" && R.earlyReleased === 0 && R.guardLowKept === true && R.earlyEnded === null && R.viewOnly === null && R.sameSide === null && R.noWayOn.stage === "offer" && /cannot be routed/.test(R.noWayOn.why || "")
              && R.noWayOn.sent === 0 && R.notTaken.stage === "offer" && /could not be routed/.test(R.notTaken.why || ""),
        () => JSON.stringify(R));

  // 7. the wiring
  const goto = grab("doGoTo"), on = grab("onState");
  check("7. THE WIRING: a refused Go-To offers the transit unless it is one of the transit's own legs, or the refusal is "
        + "about the chart or the target (a transit would meet it again - seen live, 2026-10-18); doGoTo takes a "
        + "planning start and a lead-in and answers whether she took it; onState ticks the transit in the supervising "
        + "chart; the bar is on the alerts card with its two buttons and counts as standing; both model builders read "
        + "modelFeatures; the console keeps CATGAT",
        () => /if\(!how\.noLockOffer && !plan\.uncharted && !\/\^\(chart_failed\|uncharted\|target\)\$\/\.test\(mode \|\| ""\)\) lockOffer\(target\);/.test(goto) && /planGoToLeg\(how\.from \|\| \{lat:asv\.lat,lon:asv\.lon\}, target, "Go-To"\)/.test(goto)
              && /if\(how\.lead && how\.lead\.length\) plan\.route = \[\.\.\.how\.lead/.test(goto) && /return true;\s*\}$/.test(goto)
              && /if\(supervising\(\)\) lockTick\(st\);/.test(on)
              && /<div class="lockbar" id="lockBar" style="display:none">[\s\S]{0,400}id="lk_go"[\s\S]{0,400}id="lk_cancel"/.test(H)
              && /\["#guardBar", "#lockBar", "#encbanner", "#note"\]/.test(H)
              && /function rebuildNogo\(\)\{[^\n]*\n  const feats = modelFeatures\(\);/.test(H) && /function nogoModelAt\(m\)\{\n  const feats = modelFeatures\(\);/.test(H)
              && /\$\("#lk_go"\)\.onclick = /.test(H) && /\$\("#lk_cancel"\)\.onclick = /.test(H)
              && /ENC_KEEP_PROPS = \([\s\S]{0,600}"CATGAT"\)/.test(PY),
        () => "");

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})().catch(__crash);
