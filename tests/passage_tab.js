// tests/passage_tab.js - THE PASSAGE TAB, ENDS FIRST, AND A LONG GO-TO AS A PASSAGE (2026-10-14).
//
// Andy: "do both: raise the limit and route long Go-Tos as passages - consider another path planning behavior called
// 'passage' that disregards the 9-23 directive and allows for long path planning"; earlier, "do it in segments starting
// with beginning and end and then working inward"; and, asked what a Go-To past 50 km should do, "Always a passage"
// (diesel hulls; a battery hull's plans as a box, as before).
//
// static/asv.html: the Path planning card's Passage tab - its own line (passageWps; P1..., the last the arrival, a point
// clicked again a fuel stop), read along as a corridor of tiles, never one box (the 2.0-degree box cap is not in its way);
// Read chart, Plan passage and Sail passage moved there from the Transit tab, their ids kept. Plan passage plans the
// coarse plan's FIRST AND LAST SECTIONS IN DETAIL before anything else (planPassageEnds), each on a chart read of its own
// water beside the page's (passageEndWorld) in the route worker (planOffThread's `world`); one that cannot be planned
// makes the passage NOT SAILABLE (sailRefusal). The operator's Go-To past RTH_MAX_M on a diesel hull is one
// (goToOrPassage). Driven here: the page's own functions, lifted, over stubs.
//
//   1-1b  THE TAB: its button and body, its own controls; Read / Plan / Sail on it and no longer on Transit's
//   2-2c  THE LINE: a click on a point a fuel stop (P<n>), the arrival one already; every edit drops the plan; a transit
//         edit no longer does; Add takes a typed point and refuses a bad one
//   3-3d  A LONG GO-TO: near, or a battery hull - the box Go-To; unarmed - refused; far on a diesel hull - the line set to
//         the point, planned, sailed; a plan that is not sailable - said, not sailed
//   4-4c  ENDS FIRST: the first and last sections, each planned on its own chart read, in the worker; every refusal in words;
//         one section - its one end
//   5-5b  THE WORLD: a chart read of its own (padded, too-big and partial refused); planOffThread sends the world's chart,
//         not the page's, and with no worker answers nothing rather than planning on the page's
//   6     THE DRAWING: P1..., FUEL, ARRIVAL; drawn after the transit draft and before the plan
//
//   node tests/passage_tab.js      # exit 0 = pass, 1 = fail   (stdlib Node)

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
const APP = process.env.ASV_APP || path.join(__dirname, "..");
const H = fs.readFileSync(process.env.ASV_HTML || path.join(APP, "static", "asv.html"), "utf8").split("\r\n").join("\n");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!(typeof cond === "function" ? cond() : cond); note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}
function grab(name) {
  let st = H.indexOf("function " + name + "(");
  if (st < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(st - 6, st) === "async ") st -= 6;
  let k = H.indexOf("{", H.indexOf(")", st)), dp = 0;
  for (;;) { const c = H[k]; if (c === "{") dp++; else if (c === "}") { dp--; if (!dp) break; } k++; }
  return H.slice(st, k + 1);
}
const decl = (name) => { const m = H.match(new RegExp("^const " + name + " = [^\\n]*$", "m")); if (!m) throw new Error("no const " + name); return m[0]; };
const between = (a, b) => { const i = H.indexOf(a); if (i < 0) throw new Error("not found: " + a.slice(0, 40)); return H.slice(i, H.indexOf(b, i)); };

console.log("The Passage tab:");

// ── 1. THE TAB ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const CARD = between('<div class="panel" id="pathPanel">', "<!-- ROC / HOME card");
const PASS = between('<div class="ppbody" id="passagePanel" data-tab="passage">', '<div class="ppbody" id="gotoPanel"');
const TRAN = between('<div class="ppbody" id="transitPanel" data-tab="transit">', '<div class="ppbody" id="passagePanel"');
check("1. THE TAB: a Passage tab beside Transit, its body, and its own line's controls - Points, Length, Time, a typed "
      + "point and Add, Undo, Clear",
      () => /<button class="pptab" id="pp_tab_passage"[^>]*>Passage<\/button>/.test(CARD)
            && CARD.indexOf('id="pp_tab_transit"') < CARD.indexOf('id="pp_tab_passage"') && CARD.indexOf('id="pp_tab_passage"') < CARD.indexOf('id="pp_tab_goto"')
            && ["ps_count", "ps_len", "ps_time", "ps_lat", "ps_lon", "ps_add", "ps_undo", "ps_clr", "ps_hint"].every((id) => PASS.includes('id="' + id + '"'))
            && /const PATH_TABS = \["survey", "search", "transit", "passage", "goto", "wpt"\];/.test(H)
            && /passage: "passage"/.test(decl("PATH_TAB_OF")) && /passage: "passage"/.test(decl("PATH_DRAW")),
      () => "passage body " + PASS.length + " chars");
check("1b. ... READ CHART, PLAN PASSAGE AND SAIL PASSAGE ARE THE PASSAGE TAB'S, their ids kept (the controls window relays by "
      + "id) - and the Transit tab is Follow, Undo and Clear",
      () => ["tr_read", "tr_read_st", "tr_plan", "tr_plan_st", "tr_sail", "tr_sail_st"].every((id) => PASS.includes('id="' + id + '"') && !TRAN.includes('id="' + id + '"'))
            && ["tr_follow", "tr_undo", "tr_clr"].every((id) => TRAN.includes('id="' + id + '"'))
            && H.split('id="tr_plan"').length === 2 && H.split('id="tr_sail"').length === 2,
      () => "transit body " + TRAN.length + " chars");

// ── 2. THE LINE ──────────────────────────────────────────────────────────────────────────────────────────────────────────
function lineWorld() {
  const w = { notes: [], passage: { plan: 1 }, passageWps: [], transit: [] };
  // eslint-disable-next-line no-new-func
  w.api = new Function("w", `"use strict";
    let passage = w.passage, passageGen = 0, transitGen = 0, zoom = 10;
    const passageWps = w.passageWps, transit = w.transit;
    const flashNote = (t) => w.notes.push(t), worldPx = (lat, lon) => ({x: lon * 1000, y: -lat * 1000});
    ${grab("transitEdited")}
    ${grab("passageEdited")}
    ${grab("passagePointAt")}
    ${grab("toggleFuelStop")}
    return {transitEdited, passageEdited, passagePointAt, toggleFuelStop, st: () => ({passage, passageGen, transitGen})};`)(w);
  return w;
}
{
  const w = lineWorld();
  w.passageWps.push({ lat: 43.0, lon: -70.6 }, { lat: 43.3, lon: -70.35 }, { lat: 43.6, lon: -70.1 });
  w.api.toggleFuelStop(1);
  const a = { ...w.api.st() }, fuel = w.passageWps[1].fuel;
  w.api.toggleFuelStop(2);
  const hit = w.api.passagePointAt(-70.35 * 1000 + 3, -43.3 * 1000 - 4), miss = w.api.passagePointAt(0, 0);
  check("2. A POINT CLICKED AGAIN IS A FUEL STOP (P2), the plan made from the line before dropped; the arrival (P3) is one "
        + "already, and nothing changes; a click a few pixels off a point finds it",
        () => fuel === true && a.passage === null && a.passageGen === 1 && /^P2 is a FUEL STOP/.test(w.notes[0])
              && /^P3 is the arrival/.test(w.notes[1]) && !w.passageWps[2].fuel && hit === 1 && miss === -1,
        () => JSON.stringify({ a, notes: w.notes, hit, miss }));
  const t = lineWorld();
  t.api.transitEdited();
  check("2b. A TRANSIT EDIT NO LONGER DROPS THE PASSAGE: the passage has its own line - the Transit tab's is Follow's",
        () => t.api.st().passage !== null && t.api.st().transitGen === 1 && t.api.st().passageGen === 0,
        () => JSON.stringify(t.api.st()));
}
{
  // Add: the typed point, at the end of the line - the new arrival; a bad one refused in words
  const ADD = between('$("#ps_add").onclick = ()=>{', "\n};") + "\n};";
  const run = (lat, lon) => {
    const w = { notes: [], passageWps: [{ lat: 43, lon: -70 }], edits: 0, dom: { "#ps_lat": { value: lat }, "#ps_lon": { value: lon } } };
    // eslint-disable-next-line no-new-func
    new Function("w", `"use strict"; const $ = (k) => w.dom[k] || (w.dom[k] = {}), passageWps = w.passageWps;
      const passageEdited = () => { w.edits++; }, flashNote = (t) => w.notes.push(t), updateTransitPanel = () => {}, render = () => {};
      ${ADD} w.dom["#ps_add"].onclick();`)(w);
    return w;
  };
  const good = run("43.5", "-70.2"), bad = run("95", "-70.2"), none = run("", "-70.2");
  check("2c. ADD puts a typed point at the END of the line - the new arrival - and drops the plan; a latitude of 95 or a "
        + "blank is refused in words, the line as it was",
        () => good.passageWps.length === 2 && good.passageWps[1].lat === 43.5 && good.passageWps[1].lon === -70.2 && good.edits === 1
              && bad.passageWps.length === 1 && bad.edits === 0 && /type a latitude and a longitude/.test(bad.notes[0] || "")
              && none.passageWps.length === 1 && none.edits === 0,
        () => JSON.stringify({ good: good.passageWps, bad: [bad.passageWps.length, bad.notes], none: none.passageWps.length }));
}

// ── 3. A LONG GO-TO ──────────────────────────────────────────────────────────────────────────────────────────────────────
function gotoWorld(o) {
  const w = Object.assign({ log: [], banners: [], notes: [], refuse: null, can: true, plan: { sections: [1] }, sailWhy: null,
                            passageWps: [{ lat: 1, lon: 1 }] }, o || {});
  // eslint-disable-next-line no-new-func
  w.api = new Function("w", `"use strict";
    let passage = null, passageWps = w.passageWps;
    const asv = {lat: 43.651, lon: -70.252}, NOGO_RADIUS_M = 5000;
    ${decl("RTH_MAX_M")}
    const distTo = (a, b) => Math.hypot((b.lat - a.lat) * 111320, (b.lon - a.lon) * 111320 * Math.cos(a.lat * Math.PI / 180));
    const passageRefusal = () => w.refuse, canCommand = () => w.can, fmtDist = (m) => (m / 1000).toFixed(1) + " km";
    const doGoTo = async (ll) => { w.log.push("goto"); }, passageEdited = () => { w.log.push("edited"); };
    const pathSelect = (t) => w.log.push("tab " + t), showBanner = (t) => w.banners.push(t), flashNote = (t) => w.notes.push(t);
    const logClient = (k) => w.log.push("log " + k);
    const planPassageNow = async () => { w.log.push("plan " + JSON.stringify(passageWps)); passage = w.plan; };
    const sailRefusal = () => w.sailWhy, sailPassage = async () => { w.log.push("sail"); };
    ${grab("goToOrPassage")}
    return {goToOrPassage, line: () => passageWps};`)(w);
  return w;
}
(async () => {
  const NEAR = { lat: 43.9, lon: -70.0 }, FAR = { lat: 44.1105, lon: -68.9235 };   // 34 km; his Penobscot point, 120 km
  const near = gotoWorld(); await near.api.goToOrPassage(NEAR);
  const bat = gotoWorld({ refuse: "long passages are for the diesel hulls - this one runs on a battery" }); await bat.api.goToOrPassage(FAR);
  check("3. A GO-TO WITHIN 50 km, OR A BATTERY HULL'S PAST IT, IS THE BOX GO-TO IT ALWAYS WAS (doGoTo) - no passage asked",
        () => near.log.join("|") === "goto" && bat.log.join("|") === "goto",
        () => JSON.stringify({ near: near.log, bat: bat.log }));
  const un = gotoWorld({ can: false }); await un.api.goToOrPassage(FAR);
  check("3b. ... past 50 km on a diesel hull and UNARMED: refused in words, nothing planned, the line as it was",
        () => un.log.length === 0 && /ARM first/.test(un.notes[0] || "") && un.api.line()[0].lat === 1,
        () => JSON.stringify({ log: un.log, notes: un.notes }));
  const far = gotoWorld(); await far.api.goToOrPassage(FAR);
  check("3c. ... ARMED: the Passage tab's line becomes the point, the tab shows, it is said (how far, and that it is a "
        + "passage) and logged, planned - and SAILED",
        () => JSON.stringify(far.api.line()) === JSON.stringify([FAR]) && far.log[0] === "edited" && far.log[1] === "tab passage"
              && far.log[2] === "log goto_passage" && far.log[3] === "plan " + JSON.stringify([FAR]) && far.log[4] === "sail"
              && /^Go-To 1\d\d\.\d km away - past 50\.0 km, so planned as a PASSAGE/.test(far.banners[0] || ""),
        () => JSON.stringify({ log: far.log, banner: (far.banners[0] || "").slice(0, 90) }));
  const notPlanned = gotoWorld({ plan: null }); await notPlanned.api.goToOrPassage(FAR);
  const notSail = gotoWorld({ sailWhy: "its ends could not be planned in detail - arriving: no plan" }); await notSail.api.goToOrPassage(FAR);
  check("3d. ... a passage NOT planned is not sailed (Plan passage said why); one planned but not sailable is said - why, and "
        + "that the plan is on the Passage tab - and not sailed",
        () => !notPlanned.log.includes("sail") && !notSail.log.includes("sail")
              && /^Go-To NOT sent as a passage: its ends could not be planned in detail - arriving: no plan\. The plan is on the Passage tab\.$/.test(notSail.banners[1] || ""),
        () => JSON.stringify({ np: notPlanned.log, ns: notSail.banners[1] }));
  const wiring = {
    menu: /cmRow\("#cmGoto",\s*ll => \{ setGotoTarget\(ll\); return goToOrPassage\(ll\); \}\);/.test(H),
    go: /goToOrPassage\(\{lat: gotoTarget\.lat, lon: gotoTarget\.lon\}\)\.catch\(/.test(H),
    // a survey's start and a passage's Divert stay box Go-Tos
    survey: /await doGoTo\(\{lat: p\.lat, lon: p\.lon\}\);/.test(grab("goToSurvey")),
    divert: /try\{ await doGoTo\(ll\); \}/.test(grab("divertPassage")),
  };
  check("3e. ONLY THE OPERATOR'S GO-TO is handed on: the chart menu's row and the Go-To tab's Go; a survey's start and a "
        + "passage's Divert stay the box Go-To",
        () => Object.values(wiring).every(Boolean),
        () => Object.entries(wiring).filter(([, v]) => !v).map(([k]) => k).join(", ") || "all wired");

  // ── 4. ENDS FIRST ────────────────────────────────────────────────────────────────────────────────────────────────────
  const endWorld = (o) => {
    const w = Object.assign({ worlds: [], jobs: [], world: { ko: "KO", frame: "F", bbox: "B", unread: [], buffer: 3 }, reply: null }, o || {});
    // eslint-disable-next-line no-new-func
    w.api = new Function("w", `"use strict";
      const passageEndWorld = async (pts) => { w.worlds.push(pts); return w.world; };
      const planOffThread = async (job, here, adopt) => { w.jobs.push(job); return w.reply === undefined ? here() : adopt(w.reply); };
      const holdOpts = () => ({o: 1}), transitStandoffM = () => 20, routeLenM = (from, route) => route.length * 1000;
      ${grab("planPassageEnd")}
      ${grab("planPassageEnds")}
      ${grab("passageEndsSay")}
      return {planPassageEnd, planPassageEnds, passageEndsSay};`)(w);
    return w;
  };
  const S1 = { from: { lat: 1, lon: 1 }, via: [{ lat: 1.1, lon: 1.1 }], to: { lat: 1.2, lon: 1.2 } };
  const S2 = { from: { lat: 2, lon: 2 }, via: [], to: { lat: 2.2, lon: 2.2 } };
  const S3 = { from: { lat: 3, lon: 3 }, via: [{ lat: 3.1, lon: 3.1 }], to: { lat: 3.2, lon: 3.2 } };
  const okW = endWorld({ reply: { ht: { to: S3.to }, plan: { route: [1, 2, 3, 4] } } });
  const ends = await okW.api.planPassageEnds({ sections: [S1, S2, S3] });
  const job = okW.jobs[0] || {};
  check("4. ENDS FIRST: the FIRST and the LAST sections - not the middle - each on a chart read of its own water (its start, "
        + "its points, its end), planned in the route worker on that world (holdRoute: the section's hold at its end, open "
        + "water on every leg, at the transit standoff) - and said planned, with their lengths",
        () => okW.worlds.length === 2 && JSON.stringify(okW.worlds[0]) === JSON.stringify([S1.from, ...S1.via, S1.to])
              && JSON.stringify(okW.worlds[1]) === JSON.stringify([S3.from, ...S3.via, S3.to])
              && okW.jobs.length === 2 && job.op === "holdRoute" && job.world === okW.world && job.args.target === S1.to
              && job.args.start === S1.from && job.args.via === S1.via && job.args.keepRightAll === true && job.args.standoffM === 20
              && job.args.ropts.openWater === "all" && ends.dep.ok && ends.dep.km === 4 && ends.arr.ok && okW.api.passageEndsSay(ends) === "",
        () => JSON.stringify({ worlds: okW.worlds.length, jobs: okW.jobs.map((j) => j.op), ends }));
  const one = endWorld({ reply: { ht: {}, plan: { route: [1] } } });
  const e1 = await one.api.planPassageEnds({ sections: [S1] });
  check("4b. ... a passage of ONE section: its one end, planned once",
        () => one.jobs.length === 1 && e1.dep.ok && e1.arr === null, () => JSON.stringify(e1));
  const why = async (o) => (await endWorld(o).api.planPassageEnd(S3));
  const r = {
    chart: await why({ world: { error: "its chart arrived without Depth_Area" } }),
    worker: await why({ reply: undefined }),
    hold: await why({ reply: { ht: { error: "x" }, plan: null } }),
    err: await why({ reply: { ht: {}, plan: { error: "no clear route to the target" } } }),
    unch: await why({ reply: { ht: {}, plan: { uncharted: { say: "the route runs 1.2 km beyond the water the chart was read over" } } } }),
    blk: await why({ reply: { ht: {}, plan: { route: [1], unroutable: [[1, 2]] } } }),
  };
  check("4c. ... every refusal in words: a chart that could not be read, no route worker, an end not clear water to hold "
        + "at, the planner's own refusal, past the chart read, a leg with no clear route - and passageEndsSay names the "
        + "end ('leaving' / 'arriving') with it",
        () => r.chart.why === "its chart arrived without Depth_Area" && /route worker/.test(r.worker.why)
              && r.hold.why === "its end is not clear water to hold at" && r.err.why === "no clear route to the target"
              && /beyond the water the chart was read over/.test(r.unch.why) && /on 1 leg\(s\)/.test(r.blk.why)
              && Object.values(r).every((x) => x.ok === false)
              && okW.api.passageEndsSay({ dep: { ok: true }, arr: r.hold }) === "arriving: its end is not clear water to hold at"
              && okW.api.passageEndsSay({ dep: r.err, arr: r.hold }) === "leaving: no clear route to the target; arriving: its end is not clear water to hold at",
        () => JSON.stringify(r).slice(0, 300));

  // ── 5. THE WORLD ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const worldOf = async (reply, pts) => {
    const w = { urls: [], built: [] };
    // eslint-disable-next-line no-new-func
    const f = new Function("w", "reply", `"use strict";
      const V = {NOGO_MIN_DEPTH_M: 3.15}, M_PER_DEG_LAT = 111320, nogo = {enf: {land: true}, buffer: 3};
      ${decl("PASSAGE_END_PAD_M")}
      ${decl("ENC_MAX_SPAN_DEG")}
      ${grab("encSpanRefusal")}
      const fetch = async (u) => { w.urls.push(u); return {json: async () => reply}; };
      const planeFrame = (c) => ({ref: c}), featuresBboxRef = () => ({lat: 1, lon: 2}), nogoDR = () => ({min: 3.15, max: 0});
      const buildKeepouts = (fr, enf, dr, feats) => { w.built.push(feats.length); return {polys: feats}; };
      const buildMargin = () => "MARGIN";
      ${grab("passageEndWorld")}
      return passageEndWorld;`)(w, reply);
    return { w, out: await f(pts) };
  };
  const PTS = [{ lat: 43.6, lon: -70.25 }, { lat: 43.65, lon: -70.1 }];
  const good = await worldOf({ band: "harbour", features: [{}, {}], unread: [[-70.2, 43.6, -70.19, 43.61]], unread_failed: [[-70.1, 43.6, -70.09, 43.61]], partial: [] }, PTS);
  const bbox = good.out && good.out.bbox, padLat = 1500 / 111320;
  const big = await worldOf({ band: "x", features: [] }, [{ lat: 43, lon: -71 }, { lat: 43, lon: -68.5 }]);
  const part = await worldOf({ band: "harbour", features: [], partial: ["Depth_Area"] }, PTS);
  const none = await worldOf({ error: "ENC offline (no cache for this area)" }, PTS);
  check("5. A CHART READ OF ITS OWN: the section's box padded PASSAGE_END_PAD_M, read at the hull's floor, built into a model "
        + "with its margin layer and its unread squares (failed ones marked) - the page's own model untouched; one too wide "
        + "for an extract, one missing a layer, one the console could not read - refused in words, nothing built",
        () => good.out && good.out.ko && good.out.ko.margin === "MARGIN" && good.w.built[0] === 2 && good.w.urls.length === 1
              && /min_depth=3\.15$/.test(good.w.urls[0]) && Math.abs(bbox.S - (43.6 - padLat)) < 1e-9 && Math.abs(bbox.N - (43.65 + padLat)) < 1e-9
              && good.out.unread.length === 2 && good.out.unread[0].failed === false && good.out.unread[1].failed === true && good.out.buffer === 3
              && /^its chart would take an extract of/.test(big.out.error) && big.w.urls.length === 0
              && part.out.error === "its chart arrived without Depth_Area" && part.w.built.length === 0
              && /could not be read \(ENC offline/.test(none.out.error),
        () => JSON.stringify({ good: good.out && { bbox, unread: good.out.unread }, big: big.out, part: part.out, none: none.out }).slice(0, 400));
  // planOffThread with a world: driven with a stand-in worker
  const offThread = (o) => {
    const w = Object.assign({ posted: [], here: 0, planHere: 0, worker: true }, o);
    // eslint-disable-next-line no-new-func
    const api = new Function("w", `"use strict";
      const nogo = {ready: true, ko: {page: 1}, buffer: 5, bbox: "PAGE", unread: ["page"], ais: ["contact"], frame: {ref: "pageRef"}};
      const V = {OPEN_WATER: true}, sea = {laneUsed: false, lanePartial: false};
      const ROUTE_WORKER_TIMEOUT_MS = 1000, routeLanes = {cmd: {w: null, jobs: new Map(), held: new Set(), seq: 0, dead: null}};
      const ids = new Map(); let nid = 0;
      const routeKoId = (k) => { if(!ids.has(k)) ids.set(k, ++nid); return ids.get(k); }, routeKoCount = () => 1;
      const routePackKo = (k) => ({xy: {buffer: new ArrayBuffer(8)}, k});
      const routeWorkerLost = () => {}, logClient = () => {};
      const planHere = (h) => { w.planHere++; return h(); };
      const routeWorkerOf = () => w.worker ? {postMessage: (msg) => { w.posted.push(msg);
        setTimeout(() => routeLanes.cmd.jobs.get(msg.id).done({id: msg.id, ok: true, out: "PLANNED", sea: {laneUsed: false, lanePartial: false}, ms: 1}), 0); }} : null;
      ${grab("planOffThread")}
      return planOffThread;`)(w);
    return { w, api };
  };
  const WD = { ko: { world: 1 }, frame: { ref: "worldRef" }, bbox: "WORLD", unread: ["world"], buffer: 3 };
  const A1 = offThread({});
  const o1 = await A1.api({ op: "holdRoute", world: WD, args: {} }, () => { A1.w.here++; return "HERE"; });
  const m1 = A1.w.posted[0] || { state: { nogo: {} } };
  const A2 = offThread({ worker: false });
  const o2 = await A2.api({ op: "holdRoute", world: WD, args: {} }, () => { A2.w.here++; return null; });
  check("5b. PLANNED ON ITS WORLD, NOT THE PAGE'S: the worker is sent the world's model, chart box, unread squares, buffer "
        + "and frame - no AIS contacts - and keeps the page's model; with no worker it answers nothing (here) rather than "
        + "planning on the page's thread, which holds the page's chart",
        () => o1 === "PLANNED" && m1.state.nogo.bbox === "WORLD" && m1.state.nogo.unread[0] === "world" && m1.state.nogo.buffer === 3
              && m1.state.nogo.ais === null && m1.state.nogo.ready === true && m1.state.frameRef === "worldRef"
              && m1.models.length === 1 && m1.models[0].packed.k === WD.ko
              && o2 === null && A2.w.here === 1 && A2.w.planHere === 0,
        () => JSON.stringify({ o1, nogo: m1.state.nogo, frame: m1.state.frameRef, o2, here: A2.w.here, planHere: A2.w.planHere }));

  // ── 6. THE DRAWING ───────────────────────────────────────────────────────────────────────────────────────────────────
  const ops = [];
  const ctx = new Proxy({}, { get: (t, k) => (k in t ? t[k] : (...a) => { ops.push([k, ...a]); }), set: (t, k, v) => { t[k] = v; return true; } });
  // eslint-disable-next-line no-new-func
  new Function("ctx", "w", `"use strict"; const asv = {lat: 0, lon: 0}, passageWps = w;
    ${grab("drawPassageWps")} drawPassageWps((lat, lon) => ({x: lon, y: -lat}));`)(ctx, [{ lat: 1, lon: 1 }, { lat: 2, lon: 2, fuel: true }, { lat: 3, lon: 3 }]);
  const labels = ops.filter((o) => o[0] === "fillText").map((o) => o[1]);
  check("6. THE DRAWING: her position to the line's points, each named - P1, P2 FUEL (ringed), P3 ARRIVAL - and drawn after "
        + "the transit draft and before the plan",
        () => labels.join("|") === "P1|P2 FUEL|P3 ARRIVAL" && ops.filter((o) => o[0] === "arc").length === 4
              && /drawTransit\(toScreen\);\s*\n\s*drawPassageWps\(toScreen\);\s*\n\s*drawPassage\(toScreen\);/.test(H),
        () => labels.join("|"));

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})().catch(__crash);
