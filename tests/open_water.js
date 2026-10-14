// tests/open_water.js - OPEN WATER FIRST (2026-10-14).
//
// Andy, of his Go-To from Castine to the Fox Islands Thorofare, with a drawing of the way he would have gone: "I am
// noticing the ASV always tends to thread its way through islands/rocks/shoals to reach its destination on the most
// efficient way possible. This is technically a good solution, but it enhances danger when the chart may have a
// positional error or unmarked feature. For open ocean/or large bay, etc paths consider a more direct and less complex
// path as a default consideration." And while it was built: "pay attention to marker buoys that should help safe passage
// calculations", and "safety is always better than efficiency for path planning".
//
// static/js/openwater.js: one clearance-weighted search over the whole water of a passage leg, taken over the router's
// route where it cuts the route's exposure (its length weighted by nearness to charted dangers) by GAIN_MIN at no more
// than (1 + DETOUR_MAX) its length, at the widest berth of BERTHS_FRAC that is. passage.js planNogoRoute (Go-To, RTH,
// Continue) and routePlan (a transit's legs, a plan's approach and the leg into each later survey, a passage's sections)
// ask it; the route worker carries it (route_job.js); the page reads the chart over the water it searches first
// (asv.html openWaterRead) and says what it did (openWaterNote / openWaterWhy). The coarse passage planner's half is
// tests/passage_plan.js 20-20c and tests/fuel_rth.js 11i.
//
// HIS WATERS: his chart is too big to cut a fixture of at this scale (the Castine water's keep-out model alone, simplified
// to 10 m, is 14 MB), so Go-Tos in the four areas he runs - Penobscot, Casco, the Piscataqua, Cape Ann; his own two and
// eleven more - are replayed over his own chart cache by tools/open_water_missions.js, today against open water first.
// Here: worlds of their own
// shaped like his - a bay with an island chain across the way (East Penobscot Bay), a ledge wall with two gaps, one buoyed.
//
//   1    THE BAY: the island chain the straight way crosses is left for the open bay - least clearance from 43 m to
//        hundreds, nothing within 250 m - for a few percent more length; OFF, the route is the router's, unchanged;
//   2    OPEN SEA, a short leg, a maneuver: kept as before ("no safer", "short"; a maneuver not asked; Continue's
//        fly-through asked);
//   3    THE BERTHS: with a tighter detour cap the 1 km berth is refused and the 500 m one taken - not all or nothing;
//   4    NEVER WORSE: over random island fields, a leg taken is never longer than the cap, never less safe than the
//        router's by the search's own price, and every leg of it is clear at the buffer; a leg kept IS the router's;
//   5    THE BUOYS: a ledge wall with two gaps - the buoyed one taken (pairs, and single marks), the shorter unmarked one
//        with the trust taken away; a safe-water buoy's water trusted, an isolated-danger buoy kept off, a buoy's own
//        nearness not priced; and A BUOY OUTRANKS OPEN WATER (5c, passage.js buoysOutrankOpenWater): a wider way that
//        leaves a mark wrong is planned again with the close-in way held past it - or the close-in leg ships;
//   6    ONLY WATER THE CHART WAS READ OVER: inside the box less its margin, never into an unread square - and no
//        uncharted refusal from it; the box's edge no danger;
//   7    routePlan: a drawn transit asks it only where the router bent the leg (or "all" when told), a plan's approach
//        and transit legs always, a survey line never; OFF, none;
//   8    THE WORKER: route_job carries `ropts` and the V block's switch;
//   9    THE WORDS: the banner's (openWaterNote) and the Intent card's (openWaterWhy);
//   10   THE PAGE: the Route rules switch and its summary, the three banners, the Intent card (driven), the read of the
//        water it searches (openWaterRead, driven), its place in planInsideChart, the imports, the default.
//   11-11f ENDS FIRST, THEN INWARD (2026-10-14, his 120 km Go-To from a Portland wharf: at 152 m cells the search could
//        not start, "no open-water path"): a harbor end planned on its own fine field (endField) - up an inlet, out of
//        a basin by the water the route runs longest through - said; the search starting at the exit and ending at the
//        entry that do the WHOLE leg best (seeds, goals: driven on a plain field); the router's own route only where the
//        fine field finds none (a 40 m inlet); and no shortcut of the spine nearer a hazard than the stretch it replaces.
//
// TEETH (11-11f) - 11 sidecar mutations RUN, 11/11 caught (the search always from her, the fine ends not searched, the
// router's head dropped, the fine way out dropped, an exit's or an entry's cost ignored, the first water the route
// meets, the harbor field at the leg's resolution, the banner or the Intent card silent, a shortcut nearer).
//
//   node tests/open_water.js      # exit 0 = pass, 1 = fail   (stdlib Node)

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
const JS = (f) => path.join(APP, "static", "js", f);
const { V, nogo, sea } = require(JS("state.js"));
const { planeFrame } = require(JS("geodesy.js"));
const { buildKeepouts } = require(JS("chart.js"));
const K = require(JS("keepouts.js"));
const P = require(JS("passage.js"));
const R = require(JS("routing.js"));
const OW = require(JS("openwater.js"));
const { routeReply, koCount } = require(JS("route_job.js"));
const ASV_HTML = process.env.ASV_HTML || path.join(APP, "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");

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
const grab = (name) => {
  let st = H.indexOf("function " + name + "(");
  if (st < 0) throw new Error("function " + name + " not found in the page (renamed?)");
  if (H.slice(st - 6, st) === "async ") st -= 6;
  let k = H.indexOf("{", H.indexOf(")", st)), dp = 0;
  for (;;) { const c = H[k]; if (c === "{") dp++; else if (c === "}") { dp--; if (!dp) break; } k++; }
  return H.slice(st, k + 1);
};
const f0 = (x) => (x == null ? "null" : String(Math.round(x)));

// ── A WORLD OF ITS OWN: water 10-30 m deep, laid out in a local plane; the DriX with the EM712 gondola ────────────────
const ENF = { land: true, depth: true, haz: true, area: false, wreck: true, chan: true };
V.NOGO_MIN_DEPTH_M = 3.15; V.OPER_MIN_DEPTH_M = 4.0; V.NOGO_BUFFER_M = 5; V.AIR_DRAFT_M = 2.85; V.OVERHEAD_CLEARANCE_M = 1.0;
const GF = planeFrame({ lat: 44.0, lon: -69.0 });
const LLc = (e, n) => { const q = GF.fromEN(e, n); return [q.lon, q.lat]; };
const gll = (e, n) => { const q = GF.fromEN(e, n); return { lat: q.lat, lon: q.lon }; };
const en = (q) => GF.toEN(q);
const rect = (e0, n0, e1, n1) => [[LLc(e0, n0), LLc(e1, n0), LLc(e1, n1), LLc(e0, n1), LLc(e0, n0)]];
const area = (d1, d2, e0, n0, e1, n1) => ({ role: "depth_area", cls: "Depth_Area", props: { DRVAL1: d1, DRVAL2: d2 }, geometry: { type: "Polygon", coordinates: rect(e0, n0, e1, n1) } });
const land = (e0, n0, e1, n1) => ({ role: "land", cls: "Land_Area", props: {}, geometry: { type: "Polygon", coordinates: rect(e0, n0, e1, n1) } });
const point = (role, cls, e, n) => ({ role, cls, props: {}, geometry: { type: "Point", coordinates: LLc(e, n) } });
const buoy = (e, n, CATLAM, OBJNAM) => ({ role: "chan_mark", cls: "Buoy_Lateral_point", props: { CATLAM, OBJNAM }, geometry: { type: "Point", coordinates: LLc(e, n) } });
const SEA = area(10, 30, -20000, -20000, 20000, 20000);
const world = (feats) => { const was = sea.waterOffset; sea.waterOffset = 0;
  try { return buildKeepouts(GF, ENF, { min: 4.0, max: 0 }, [SEA, ...feats]); } finally { sea.waterOffset = was; } };
const boxOf = (e0, n0, e1, n1) => { const a = GF.fromEN(e0, n0), b = GF.fromEN(e1, n1); return { W: a.lon, S: a.lat, E: b.lon, N: b.lat }; };
const onWorld = (ko, extra = {}) => Object.assign(nogo, { ready: true, frame: GF, ko, buffer: 5, bbox: null, unread: null, ais: null }, extra);
const plan = (ko, A, B, o = {}, ow = true, extra = {}) => {
  onWorld(ko, extra); const was = V.OPEN_WATER; V.OPEN_WATER = ow;
  try { const r = P.planNogoRoute(A, B, { holdR: 20, setMs: 0, ...o }); if (!r.error) r.full = [A, ...r.route]; return r; }
  finally { V.OPEN_WATER = was; }
};
const lenOf = (r) => { let L = 0; for (let i = 1; i < r.length; i++) { const a = en(r[i - 1]), b = en(r[i]); L += Math.hypot(b.e - a.e, b.n - a.n); } return L; };
const samples = (r, step = 20) => { const out = []; for (let i = 1; i < r.length; i++) { const a = en(r[i - 1]), b = en(r[i]), L = Math.hypot(b.e - a.e, b.n - a.n), n = Math.max(1, Math.ceil(L / step));
  for (let k = 0; k < n; k++) { const t = (k + 0.5) / n; out.push({ e: a.e + (b.e - a.e) * t, n: a.n + (b.n - a.n) * t, ds: L / n }); } } return out; };
// clearance from the chart's DANGERS - its buoys aside, as the planner prices them (a buoy is passed close by design)
const isBuoy = (q) => q.kind === "a channel buoy" || /^Buoy_/.test(q.cls || "");
const dangers = (ko) => ({ ...ko, points: (ko.points || []).filter((q) => !isBuoy(q)) });
const leastClear = (ko, r) => Math.min(...samples(r).map((s) => K.clearanceM(s, dangers(ko), 2000)));
const within = (ko, r, m) => samples(r).reduce((t, s) => t + (K.clearanceM(s, dangers(ko), m) < m ? s.ds : 0), 0);
// where a route crosses northing n (its first crossing), as an easting
const eAt = (r, n) => { for (let i = 1; i < r.length; i++) { const a = en(r[i - 1]), b = en(r[i]);
  if ((a.n - n) * (b.n - n) <= 0 && a.n !== b.n) return a.e + (b.e - a.e) * (n - a.n) / (b.n - a.n); } return null; };

// THE BAY - East Penobscot Bay in miniature: islands 900 m across and 1.2 km long down the straight way, 400 m apart and
// staggered, from 8 km north to 8 km south; the bay's far shore 7 km west. A 22 km leg from north to south.
const islands = [];
for (let n = -8000; n <= 8000; n += 1600) { const z = (n / 1600) % 2 ? 200 : -200; islands.push(land(-450 + z, n - 600, 450 + z, n + 600)); }
const BAY = world([...islands, land(-9000, -20000, -7000, 20000)]);
const BA = gll(0, 11000), BB = gll(0, -11000);

(async () => {
  console.log("Open water first:");

  // ── 1. THE BAY ───────────────────────────────────────────────────────────────────────────────────────────────────
  const today = plan(BAY, BA, BB, {}, false), open = plan(BAY, BA, BB, {}, true);
  const cT = leastClear(BAY, today.full), cO = leastClear(BAY, open.full);
  const nT = within(BAY, today.full, 250), nO = within(BAY, open.full, 250);
  const lT = lenOf(today.full), lO = lenOf(open.full);
  check("1. THE BAY: the island chain across the straight way is left for the open water beside it - least clearance "
        + f0(cT) + " -> " + f0(cO) + " m, " + f0(nT) + " -> " + f0(nO) + " m of it within 250 m of land - for "
        + ((lO / lT - 1) * 100).toFixed(1) + "% more length; taken at the widest berth, and said",
        () => !today.error && !open.error && open.openWater && open.openWater.used === true && open.openWater.why === "open water"
              && open.openWater.clearM === OW.OPEN_WATER.CLEAR_M && cO > 4 * cT && cO > 500 && nO === 0 && nT > 5000
              && lO < lT * 1.1 && open.openWater.exposure <= (1 - OW.OPEN_WATER.GAIN_MIN) * open.openWater.exposureRouter,
        () => JSON.stringify({ today: [Math.round(lT), f0(cT), f0(nT)], open: [Math.round(lO), f0(cO), f0(nO)], ow: open.openWater }));
  check("1b. ... and OFF (V.OPEN_WATER false, the Route rules' Off): nothing is asked - the plan carries no verdict and "
        + "runs where the router put it, through the chain",
        () => today.openWater === null && cT < 100 && Math.abs(eAt(today.full, 0)) < 700,
        () => "ow " + JSON.stringify(today.openWater) + ", least " + f0(cT) + " m, crosses n=0 at e " + f0(eAt(today.full, 0)));

  // ── 2. kept as before ────────────────────────────────────────────────────────────────────────────────────────────
  const SEA0 = world([]);
  const seaOn = plan(SEA0, gll(0, 6000), gll(0, -6000)), seaOff = plan(SEA0, gll(0, 6000), gll(0, -6000), {}, false);
  const short = plan(BAY, gll(1500, 10500), gll(1500, 8700));
  const man = plan(BAY, BA, BB, { maneuver: true }), fly = plan(BAY, BA, BB, { flyThrough: true });
  check("2. KEPT AS BEFORE: open sea - nothing to keep off, so no safer, and the route exactly the router's; a leg under "
        + OW.OPEN_WATER.MIN_LEG_M + " m - short; a MANEUVER (the way back onto station) never asked; Continue's way back "
        + "onto a survey (flyThrough) asked like a passage",
        () => seaOn.openWater && seaOn.openWater.used === false && seaOn.openWater.why === "no safer"
              && JSON.stringify(seaOn.route) === JSON.stringify(seaOff.route)
              && short.openWater && short.openWater.why === "short" && man.openWater === null
              && fly.openWater && fly.openWater.used === true,
        () => JSON.stringify({ sea: seaOn.openWater && seaOn.openWater.why, short: short.openWater && short.openWater.why,
                               man: man.openWater, fly: fly.openWater && fly.openWater.why }));

  // ── 3. the berths ────────────────────────────────────────────────────────────────────────────────────────────────
  const legB = R.legPath(BA, BB, GF, BAY, 5);
  const tight = OW.openWaterLeg(BA, BB, GF, BAY, 5, legB, { params: { DETOUR_MAX: 0.02 } });
  const wide = OW.openWaterLeg(BA, BB, GF, BAY, 5, legB);
  check("3. THE BERTHS, NOT ALL OR NOTHING: with the detour capped at 2% the 1 km berth is refused and the 500 m one "
        + "taken, within the cap; uncapped, the 1 km berth",
        () => tight.used && tight.clearM === OW.OPEN_WATER.CLEAR_M * 0.5 && tight.lenM <= 1.02 * tight.lenRouterM
              && wide.used && wide.clearM === OW.OPEN_WATER.CLEAR_M,
        () => "capped: " + tight.why + " @" + tight.clearM + " m, " + f0(tight.lenM) + " vs " + f0(tight.lenRouterM)
              + "; uncapped @" + wide.clearM + " m, " + f0(wide.lenM));

  // ── 4. never worse ───────────────────────────────────────────────────────────────────────────────────────────────
  let seed = 4242;
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648; };
  let trials = 0, taken = 0, keptSame = 0, bad = [];
  for (let t = 0; t < 8; t++) {
    const f = [];
    for (let k = 0; k < 14; k++) {
      const ce = -3000 + rnd() * 6000, cn = -6000 + rnd() * 12000, w = 150 + rnd() * 700, h = 150 + rnd() * 700;
      f.push(rnd() < 0.7 ? land(ce - w / 2, cn - h / 2, ce + w / 2, cn + h / 2)
                         : point("hazard_point", "Underwater_Awash_Rock_point", ce, cn));
    }
    const ko = world(f), A = gll(-200 + rnd() * 400, 8000), B = gll(-200 + rnd() * 400, -8000);
    const leg = R.legPath(A, B, GF, ko, 5);
    if (!leg) continue;
    trials++;
    const r = OW.openWaterLeg(A, B, GF, ko, 5, leg);
    if (r.used) {
      taken++;
      const pts = [A, ...r.leg];
      const clear = pts.every((q, i) => i === 0 || K.legClear(pts[i - 1], q, GF, ko, 5));
      if (!(r.lenM <= (1 + OW.OPEN_WATER.DETOUR_MAX) * r.lenRouterM + 1) || !(r.exposure <= (1 - OW.OPEN_WATER.GAIN_MIN) * r.exposureRouter + 1e-6) || !clear)
        bad.push({ t, lenM: r.lenM, lenRouterM: r.lenRouterM, exposure: r.exposure, exposureRouter: r.exposureRouter, clear });
    } else if (r.leg === leg) keptSame++;
    else bad.push({ t, kept: r.why, notTheRouters: true });
  }
  check("4. NEVER WORSE, over random island fields: every leg taken is within the detour cap, cuts the router's exposure "
        + "by GAIN_MIN by the search's own price, and is clear at the buffer leg by leg; every leg kept IS the router's",
        () => trials >= 6 && taken >= 2 && taken + keptSame === trials && bad.length === 0,
        () => trials + " legs: " + taken + " taken, " + keptSame + " kept; " + (bad.length ? JSON.stringify(bad) : "none worse"));

  // ── 5. the buoys ─────────────────────────────────────────────────────────────────────────────────────────────────
  // a ledge wall across the way at n = 0 with two 400 m gaps: the west one unmarked and nearer her line, the east one
  // buoyed; land past both ends. A 10 km leg north to south at e = -300.
  const wall = [land(-20000, -300, -2600, 300), land(-2200, -300, 1800, 300), land(2200, -300, 20000, 300)];
  const pairs = [], singles = [];
  for (let k = 0; k < 3; k++) pairs.push(buoy(1880, -250 + 250 * k, 1, "East Gap Buoy " + (2 * k + 1)), buoy(2120, -250 + 250 * k, 2, "East Gap Buoy " + (2 * k + 2)));
  for (let k = 0; k < 3; k++) singles.push(buoy(1880, -400 + 400 * k, 1, "East Gap Buoy " + (2 * k + 1)));
  const fairway = { role: "fairway", cls: "Fairway_area", props: {}, geometry: { type: "Polygon", coordinates: rect(1800, -1500, 2200, 1500) } };
  const GP = world([...wall, ...pairs]), GS = world([...wall, ...singles]), GF2 = world([...wall, fairway]);
  const GA = gll(-300, 5000), GB = gll(-300, -5000);
  const gapOf = (r) => { const e = eAt(r.full, 0); return e == null ? "none" : e > 1800 && e < 2200 ? "marked" : e > -2600 && e < -2200 ? "unmarked" : "e " + f0(e); };
  const withParams = (prm, fn) => { const was = { ...OW.OPEN_WATER }; Object.assign(OW.OPEN_WATER, prm); try { return fn(); } finally { Object.assign(OW.OPEN_WATER, was); } };
  const gT = plan(GP, GA, GB, {}, false), gP = plan(GP, GA, GB), gP0 = withParams({ TRUST: 0 }, () => plan(GP, GA, GB));
  const gS = plan(GS, GA, GB), gS0 = withParams({ LATERAL_TRUST_R_M: 0 }, () => plan(GS, GA, GB));
  const gF = plan(GF2, GA, GB), gF0 = withParams({ TRUST: 0 }, () => plan(GF2, GA, GB));
  check("5. THE BUOYS HELP: through a ledge wall with two gaps alike, the router takes the unmarked one (nearer her line); "
        + "open water first takes the BUOYED one - paired marks, single marks with no partner, and a charted fairway with no "
        + "buoy at all - and with the trust taken away (TRUST 0; the single marks' LATERAL_TRUST_R_M 0) the unmarked one "
        + "again; every mark on its proper hand",
        () => gapOf(gT) === "unmarked" && gapOf(gP) === "marked" && gapOf(gP0) === "unmarked" && gapOf(gS) === "marked"
              && gapOf(gS0) === "unmarked" && gapOf(gF) === "marked" && gapOf(gF0) === "unmarked"
              && gP.how.marks.wrong === 0 && gS.how.marks.wrong === 0 && gS.how.marks.kept === 3
              && GP.chans.length > 0 && GS.chans.length === 0 && GF2.chans.length === 1 && GF2.marks.length === 0,
        () => JSON.stringify({ router: gapOf(gT), pairs: gapOf(gP), pairsNoTrust: gapOf(gP0), singles: gapOf(gS), singlesNoTrust: gapOf(gS0),
                               fairway: gapOf(gF), fairwayNoTrust: gapOf(gF0), marks: [gP.how.marks.wrong, gS.how.marks.kept, gS.how.marks.wrong] }));

  // the field itself: a safe-water buoy's water trusted to SAFE_WATER_R_M, an isolated-danger buoy kept off to
  // ISOLATED_DANGER_R_M (its own nearness the soft hazard's, never zero at it), a lateral buoy's nearness not priced
  const FB = world([point("hazard_point", "Buoy_Safe_Water_point", -2000, 0), point("hazard_point", "Buoy_Isolated_Danger_point", 2000, 0),
                    buoy(0, 2000, 1, "Lone Buoy 1"), buoy(-1000, -3500, 1, "Reach Buoy 1"), buoy(-1000, -2000, 1, "Reach Buoy 3"),
                    buoy(3000, -3900, 2, "Far Buoy 2"), buoy(3000, -900, 2, "Far Buoy 4")]);
  const fld = OW.openWaterField(-4000, -4000, 4000, 4000, FB, 5);
  const at = (e, n) => { const gx = Math.round((e - fld.x0) / fld.cell), gy = Math.round((n - fld.y0) / fld.cell); return gy * fld.W + gx; };
  const swIn = fld.trust[at(-2000 + 300, 0)], swOut = fld.trust[at(-2000 + 600, 0)];
  const idAt = fld.dist[at(2000 + 100, 0)], idOut = fld.dist[at(2000 + 600, 0)];
  const latNear = fld.dist[at(0, 2000 + 60)], latTrust = fld.trust[at(0, 2000 + 200)];
  const reachMid = fld.trust[at(-1000, -2750)], farMid = fld.trust[at(3000, -2400)];
  check("5b. THE FIELD: a safe-water buoy's water trusted to " + OW.OPEN_WATER.SAFE_WATER_R_M + " m and not past it; an "
        + "isolated-danger buoy kept off as a hazard " + OW.OPEN_WATER.ISOLATED_DANGER_R_M + " m round it; a lateral buoy "
        + "blocked but its nearness NOT priced (60 m off it, the clearance is the open water's), its water trusted; the reach "
        + "between two marks of one system 1.5 km apart trusted at its middle, two 3 km apart (past LATERAL_REACH_MAX_M) not",
        () => swIn === 1 && swOut === 0 && idAt === 0 && Math.abs(idOut - (600 - OW.OPEN_WATER.ISOLATED_DANGER_R_M)) <= fld.cell
              && latNear > 1500 && latTrust === 1 && fld.blk[at(0, 2000)] === 1 && reachMid === 1 && farMid === 0,
        () => JSON.stringify({ sw: [swIn, swOut], id: [f0(idAt), f0(idOut)], lateral: [f0(latNear), latTrust, fld.blk[at(0, 2000)]],
                               reach: [reachMid, farMid], cell: f0(fld.cell) }));

  // A BUOY OUTRANKS OPEN WATER (passage.js buoysOutrankOpenWater), driven on the bay's own two legs with a judge of its own:
  // a mark M on the close-in way 3 km short of the end, "proper" for a route that passes within 150 m of it (the close-in
  // way does, the wider way does not). The wider way leaving M wrong is planned again with the close-in way held within
  // MARK_HOLD_M of it and open water either side - shipped, M proper, the open water kept elsewhere; a judge that only the
  // close-in leg itself satisfies - the close-in leg ships; a mark neither way keeps - the wider way stands; none wrong -
  // untouched, nothing planned again.
  const legR = R.legPath(BA, BB, GF, BAY, 5), legO = OW.openWaterLeg(BA, BB, GF, BAY, 5, legR).leg;
  const rEN = [BA, ...legR].map(en), cumR = [0];
  for (let i = 1; i < rEN.length; i++) cumR.push(cumR[i - 1] + Math.hypot(rEN[i].e - rEN[i - 1].e, rEN[i].n - rEN[i - 1].n));
  const iM = cumR.findIndex((d) => d >= cumR[cumR.length - 1] - 3000), M = { e: rEN[iM].e + 60, n: rEN[iM].n };   // (60 m off its vertex)
  const passes = (route, m, r) => samples(route, 10).some((p) => Math.hypot(p.e - m.e, p.n - m.n) <= r);
  let calls = 0;
  const pass = (lg) => { calls++; return { kr: { route: [BA, ...lg], marks: [{ m: M }] }, df: null }; };
  const judge = (f) => (kr) => [{ k: kr.marks[0], proper: f(kr.route), inside: false }];
  const near150 = judge((r) => passes(r, M, 150));
  const b1 = P.buoysOutrankOpenWater(BA, BB, GF, BAY, 5, legR, legO, pass(legO), pass, near150, null);
  const c1 = calls;
  const exact = judge((r) => r.length === legR.length + 1 && r.every((q, i) => i === 0 || (q.lat === legR[i - 1].lat && q.lon === legR[i - 1].lon)));
  calls = 0; const b2 = P.buoysOutrankOpenWater(BA, BB, GF, BAY, 5, legR, legO, pass(legO), pass, exact, null);
  const nobody = judge(() => false);
  calls = 0; const b3 = P.buoysOutrankOpenWater(BA, BB, GF, BAY, 5, legR, legO, pass(legO), pass, nobody, null);
  calls = 0; const b4 = P.buoysOutrankOpenWater(BA, BB, GF, BAY, 5, legR, legO, pass(legO), pass, judge(() => true), null), c4 = calls;
  // ... and a held plan that would leave ANOTHER mark wrong (N: proper only for a route that keeps off M's water) is not
  // shipped: the close-in leg, which keeps M, does
  const N = { e: 0, n: 0 };
  const pass2 = (lg) => ({ kr: { route: [BA, ...lg], marks: [{ m: M }, { m: N }] }, df: null });
  const two = (kr) => { const nearM = passes(kr.route, M, 150);
    return [{ k: kr.marks[0], proper: nearM, inside: false }, { k: kr.marks[1], proper: !nearM || kr.route.length === legR.length + 1, inside: false }]; };
  const b5 = P.buoysOutrankOpenWater(BA, BB, GF, BAY, 5, legR, legO, pass2(legO), pass2, two, null);
  // ... and an offshore mark on its proper hand but INSIDE its berth is a fault too (deep water first's own: `inside`)
  const insideOnly = (kr) => [{ k: kr.marks[0], proper: true, inside: !passes(kr.route, M, 150) }];
  const b6 = P.buoysOutrankOpenWater(BA, BB, GF, BAY, 5, legR, legO, pass(legO), pass, insideOnly, null);
  // the wiring: both planners judge the wider way, after the stages, with the router's own leg
  const PJ = fs.readFileSync(JS("passage.js"), "utf8").split("\r\n").join("\n");
  const wired = /let \{kr, df\} = passLeg\(leg\), owHeld = 0;[^\n]*\n[^\n]*\n\s*if\(openWater && openWater\.used\)\{\s*\n\s*const B = buoysOutrankOpenWater\(from, to, ref, ko, found, routerLeg, leg, \{kr, df\}, passLeg,/.test(PJ)
    && /let \{kr, df\} = passLeg\(leg\);[^\n]*\n[^\n]*\n\s*if\(owEntry && owEntry\.used\)\{\s*\n\s*const B = buoysOutrankOpenWater\(prev, wp, ref, koT, found, routerLeg, leg, \{kr, df\}, passLeg,/.test(PJ)
    && /if\(B\.router\) openWater = \{\.\.\.openWater, used: false, why: "a buoy's proper hand"\};/.test(PJ)
    && /if\(B\.router\)\{ owEntry\.used = false; owEntry\.why = "a buoy's proper hand"; \}/.test(PJ)
    && /held: owHeld,/.test(PJ) && /owEntry\.held = B\.held;/.test(PJ);
  const heldRoute = b1.kr.route;
  check("5c. A BUOY OUTRANKS OPEN WATER: a wider way leaving a mark wrong that the close-in way keeps is planned again "
        + "with the close-in way held within " + OW.OPEN_WATER.MARK_HOLD_M + " m of it - shipped, the mark kept, the open water "
        + "kept elsewhere (" + f0(leastClear(BAY, heldRoute)) + " m least); a mark only the close-in leg itself keeps - the "
        + "close-in leg ships, and so it does where the held plan would leave another mark wrong; a mark neither way keeps - "
        + "the wider way stands; none wrong - untouched, nothing planned again; both planners wired to it",
        () => b1.held === 1 && !b1.router && passes(heldRoute, M, 150) && leastClear(BAY, heldRoute) > leastClear(BAY, [BA, ...legR])
              && within(BAY, heldRoute, 250) < 0.5 * within(BAY, [BA, ...legR], 250) && c1 === 2
              && b2.router === true && b2.leg === legR && b2.held === 0
              && b3.router === false && b3.leg === legO && b3.held === 0
              && b4.router === false && b4.leg === legO && c4 === 1 && b5.router === true && b5.leg === legR && b6.held === 1 && wired,
        () => JSON.stringify({ held: [b1.held, b1.router, c1, f0(leastClear(BAY, heldRoute)), f0(within(BAY, heldRoute, 250))],
                               router: [b2.router, b2.leg === legR], stands: [b3.router, b3.leg === legO], clean: c4,
                               newWrong: [b5.router, b5.held], inside: b6.held, wired }));

  // ── 6. only water the chart was read over ────────────────────────────────────────────────────────────────────────
  const BOX = boxOf(-1500, -12500, 1500, 12500);
  const boxed = plan(BAY, BA, BB, {}, true, { bbox: BOX });
  const inset = (r) => Math.min(...r.full.map((q) => P.insideBoxM(q, BOX)));
  const wideOut = Math.min(...open.full.map((q) => P.insideBoxM(q, BOX)));
  const UNREAD = [boxOf(-6000, -12000, -900, 12000)];        // the water west of the chain, read and found no chart
  const unread = plan(BAY, BA, BB, {}, true, { bbox: boxOf(-8000, -14000, 8000, 14000), unread: UNREAD });
  const westMost = (r) => Math.min(...r.full.map((q) => en(q).e));
  const f6 = OW.openWaterField(-4000, -13000, 4000, 13000, BAY, 5, OW.OPEN_WATER, { F: GF, box: BOX, edgeM: P.CHART_EDGE_M });
  const f6n = OW.openWaterField(-4000, -13000, 4000, 13000, BAY, 5);
  let sameDist = true; for (let i = 0; i < f6.dist.length; i++) if (f6.dist[i] !== f6n.dist[i]) { sameDist = false; break; }
  check("6. ONLY WATER THE CHART WAS READ OVER: unboxed, the open-water route runs " + f0(-wideOut) + " m past a box 1.5 km "
        + "either side of the chain; boxed, every point of it at least CHART_EDGE_M inside, taken all the same, no uncharted "
        + "refusal; an unread square over the west water - the route keeps east of it; the box's edge is no danger to the field",
        () => wideOut < P.CHART_EDGE_M && !boxed.error && !boxed.uncharted && boxed.openWater.used && inset(boxed) >= P.CHART_EDGE_M - 1
              && !unread.error && !unread.uncharted && unread.openWater.used && westMost(unread) > -900 + P.CHART_EDGE_M - 5
              && westMost(open) < -900 && f6.offChart > 0 && f6n.offChart === 0 && sameDist,
        () => JSON.stringify({ unboxedInside: f0(wideOut), boxedInside: boxed.error || f0(inset(boxed)), unreadWest: unread.error || f0(westMost(unread)),
                               openWest: f0(westMost(open)), offChart: f6.offChart, sameDist }));

  // ── 7. routePlan ─────────────────────────────────────────────────────────────────────────────────────────────────
  // a transit of two legs: down through the chain (the router bends it), then east across open water (straight)
  const TW = [gll(0, -11000), gll(8000, -11000)];
  const rp = (keepRightAll, transitAt, ropts, ow = true) => { onWorld(BAY); const was = V.OPEN_WATER; V.OPEN_WATER = ow;
    try { return P.routePlan(BA, TW, keepRightAll, 0, transitAt, ropts); } finally { V.OPEN_WATER = was; } };
  const drawn = rp(true), drawnAll = rp(true, undefined, { openWater: "all" }), planned = rp(false), drawnOff = rp(true, undefined, undefined, false);
  const legsOf = (p) => (p.openWater || []).map((l) => l.leg + ":" + (l.used ? "taken" : l.why)).join(" ");
  check("7. routePlan: a DRAWN transit asks only of the leg the router bent round something (its own line stands where it "
        + "is clear) and takes the open water round the chain; told \"all\" (a passage's sections), every leg; a PLAN's approach "
        + "always, its survey legs never; OFF, none",
        () => legsOf(drawn) === "0:taken" && legsOf(drawnAll) === "0:taken 1:no safer" && legsOf(planned) === "0:taken"
              && (drawnOff.openWater || []).length === 0 && leastClear(BAY, [BA, ...drawn.route]) > 500,
        () => JSON.stringify({ drawn: legsOf(drawn), all: legsOf(drawnAll), plan: legsOf(planned), off: legsOf(drawnOff) }));

  // ── 8. the worker ────────────────────────────────────────────────────────────────────────────────────────────────
  const job = (op, args, Vx) => routeReply({ id: 1, op, args, ko: { id: "bay", n: koCount(BAY) }, models: [{ id: "bay", ko: BAY }], keep: [],
    state: { V: { ...V, ...Vx }, nogo: { ready: true, buffer: 5, bbox: null, unread: null, ais: null }, frameRef: GF.ref } });
  const w1 = job("route", { start: BA, wps: TW, keepRightAll: true, standoffM: 0, ropts: { openWater: "all" } }, { OPEN_WATER: true });
  const w2 = job("holdRoute", { target: TW[1], holdOpts: { holdR: 20, setMs: 0 }, start: BA, via: [TW[0]], keepRightAll: true, standoffM: 0,
                                ropts: { openWater: "all" } }, { OPEN_WATER: true });
  const w3 = job("route", { start: BA, wps: TW, keepRightAll: true, standoffM: 0, ropts: { openWater: "all" } }, { OPEN_WATER: false });
  V.OPEN_WATER = true;                                              // (routeReply writes the shared V: put the default back)
  check("8. THE WORKER (route_job.js): a transit job carries `ropts` to routePlan, a hold-and-route job too; and the V "
        + "block's switch reaches it - off, nothing asked",
        () => w1.ok && legsOf(w1.out) === "0:taken 1:no safer" && w2.ok && w2.out.plan && legsOf(w2.out.plan) === "0:taken 1:no safer"
              && w3.ok && (w3.out.openWater || []).length === 0,
        () => JSON.stringify({ route: w1.ok ? legsOf(w1.out) : w1.error, hold: w2.ok ? legsOf(w2.out.plan) : w2.error, off: w3.ok ? legsOf(w3.out) : w3.error }));

  // ── 9. the words ─────────────────────────────────────────────────────────────────────────────────────────────────
  const fmt = (m) => (m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m");
  const one = { used: true, why: "open water", lenM: 22710, lenRouterM: 22150, clearM: 1000 };
  const legs = [{ leg: 0, used: true, lenM: 5000, lenRouterM: 5600, clearM: 500 }, { leg: 1, used: false, why: "short" },
                { leg: 2, used: false, why: "no safer" }, { leg: 3, used: true, lenM: 9030, lenRouterM: 9000, clearM: 1000 }];
  const n1 = OW.openWaterNote(one, fmt), n2 = OW.openWaterNote(legs, fmt), nH = OW.openWaterNote({ ...one, held: 1 }, fmt);
  const wH = OW.openWaterWhy({ ...one, held: 1 }, fmt), wB = OW.openWaterWhy({ used: false, why: "a buoy's proper hand" }, fmt);
  const w9 = OW.openWaterWhy(legs, fmt), w9k = OW.openWaterWhy({ used: false, why: "too long" }, fmt);
  check("9. THE WORDS: the banner says the berth and what it cost or saved beside the close-in route, and nothing of a plan "
        + "that kept it; the Intent card says what was taken, and each leg asked that kept the close-in route and why - "
        + "a short leg not counted as asked",
        () => n1 === "open water first: a 1.00 km berth off charted dangers where the water allows, 560 m longer than the close-in route"
              && n2 === "open water first: a 500 m to 1.00 km berth off charted dangers where the water allows, on 2 legs, 570 m shorter than the close-in route"
              && OW.openWaterNote(null) === "" && OW.openWaterNote({ used: false, why: "no safer" }) === "" && OW.openWaterNote([]) === ""
              && w9.length === 2 && w9[0].t === "lane" && /^open water first: a 500 m to 1\.00 km berth .* not threading the islands and ledges close in \(2 legs\) - 570 m shorter/.test(w9[0].s)
              && w9[1].t === "route" && w9[1].s === "open water first: the close-in route kept on 1 leg - no wider way cut its exposure by 10%"
              && w9k.length === 1 && /every wider way more than 2 times its length$/.test(w9k[0].s) && OW.openWaterWhy({ used: false, why: "short" }).length === 0
              && /, the close-in way kept past 1 buoy for its proper hand$/.test(nH) && /the close-in way kept within 1500 m of 1 buoy\(s\)/.test(wH[0].s)
              && wB.length === 1 && /a buoy on its wrong hand that the close-in route keeps$/.test(wB[0].s),
        () => JSON.stringify([n1, n2, w9.map((x) => x.t + ": " + x.s), w9k.map((x) => x.s)]));

  // ── 10. the page ─────────────────────────────────────────────────────────────────────────────────────────────────
  const ST = fs.readFileSync(JS("state.js"), "utf8");
  const sel = /<label>Open water<\/label><select id="enf_openwater"><option value="first" selected>First<\/option><option value="off">Off<\/option><\/select>/.test(H);
  const handler = /\$\("#enf_openwater"\)\.onchange = \(\)=>\{ V\.OPEN_WATER = \$\("#enf_openwater"\)\.value !== "off"; pathReadings\(\); \};/.exec(H);
  const Vp = { OPEN_WATER: true }, sw = { value: "off" };
  let readings = 0, afterOff = null;
  // eslint-disable-next-line no-new-func
  if (handler) { new Function("V", "$", "pathReadings", handler[0])(Vp, () => sw, () => readings++);
                 sw.onchange(); afterOff = Vp.OPEN_WATER; sw.value = "first"; sw.onchange(); }
  const banners = (H.match(/\[openWaterNote\(plan\.openWater, fmtDist\), buoyageNote\(/g) || []).length;
  const SPI = new Function("deepWhy", "openWaterWhy", "fmtDist", ["let planGen = 0, planIntent = null, guardOverride, edgeSpentM, edgeCount, guardActedAt, holdWant, edgeSearchAt;",
    "const arrivalSay = () => null, offshoreWhy = () => [], wptRole = () => '';", grab("setPlanIntent"), "return setPlanIntent;"].join("\n"))(() => [], OW.openWaterWhy, fmt);
  const at10 = gll(0, 0);
  const piOW = SPI("goto", { routed: true, lane: false, openWater: one }, [at10, at10]), piNone = SPI("goto", { routed: true, lane: false }, [at10, at10]);
  check("10. THE PAGE: \"Open water\" under Route rules, First by default; Off sets V.OPEN_WATER false, First back true, and "
        + "the readings are written; the summary says when it is off; the Go-To, RTH and transit banners lead with its words; "
        + "the Intent card says its line of a plan that carries one (setPlanIntent DRIVEN) and nothing of one that does not; "
        + "a fresh page starts on true",
        () => sel && handler && afterOff === false && Vp.OPEN_WATER === true && readings === 2
              && /\(v\("#enf_openwater"\) === "off" \? " · open water off" : ""\)/.test(grab("pathReadings")) && banners === 3
              && piOW.why.some((x) => x.t === "lane" && /^open water first: a 1\.00 km berth/.test(x.s)) && !piNone.why.some((x) => /open water/.test(x.s))
              && /^\s*OPEN_WATER: true,/m.test(ST),
        () => JSON.stringify({ sel, handler: !!handler, off: afterOff, back: Vp.OPEN_WATER, readings, banners,
                               card: piOW.why.filter((x) => /open water/.test(x.s)).map((x) => x.t) }));

  // the read of the water it searches, DRIVEN
  const readWorld = (o) => {
    const w = Object.assign({ V: {}, bbox: { W: -69.2, S: 43.9, E: -68.8, N: 44.1 }, ready: true, refresh: [], covers: [], logs: [], tooBig: null, fail: null }, o || {});
    const nogoW = { ready: w.ready, bbox: w.bbox };
    const src = ["const asv = {lat: 44.0, lon: -69.0};",
      "const bboxContains = (a, b) => !!a && a.W <= b.W && a.S <= b.S && a.E >= b.E && a.N >= b.N;",
      "const bbUnion = (a, b) => a ? {W: Math.min(a.W, b.W), S: Math.min(a.S, b.S), E: Math.max(a.E, b.E), N: Math.max(a.N, b.N)} : b;",
      "const encSpanRefusal = () => w.tooBig;",
      "const refreshNogo = async (c, b, ask) => { w.refresh.push({b, ask: {...ask}}); if(w.fail) ask.failed = w.fail; };",
      "const ensureNogoCovers = async (pts, pad, opts) => { w.covers.push({n: pts.length, opts}); return true; };",
      "const logClient = (k, d) => w.logs.push([k, d]);",
      grab("openWaterRead"), "return openWaterRead;"].join("\n");
    // eslint-disable-next-line no-new-func
    w.fn = new Function("w", "V", "nogo", "openWaterBox", src)(w, w.V, nogoW, OW.openWaterBox);
    return w;
  };
  const far = [{ lat: 44.0, lon: -69.0 }, { lat: 44.3, lon: -68.9 }], near2 = [{ lat: 44.0, lon: -69.0 }, { lat: 44.01, lon: -69.0 }];
  const rLong = readWorld(), aLong = await rLong.fn(far, undefined, "Go-To");
  const rShort = readWorld(), aShort = await rShort.fn(near2, undefined, "Go-To");
  const rHave = readWorld({ bbox: { W: -70, S: 43, E: -68, N: 45 } }), aHave = await rHave.fn(far, undefined, "Go-To");
  const rBig = readWorld({ tooBig: "an extract of 1.60° × 0.50°" }), aBig = await rBig.fn(far, undefined, "Go-To");
  const rOff = readWorld({ V: { OPEN_WATER: false } }), aOff = await rOff.fn(far, undefined, "Go-To");
  const rFail = readWorld({ fail: "NOAA answered 503" }), aFail = await rFail.fn(far, undefined, "RTH");
  const rUp = readWorld(), aUp = await rUp.fn([far[0], { lat: 44.01, lon: -69.0 }, { lat: 44.3, lon: -68.9 }], { plan: true }, "Upload");
  const box10 = OW.openWaterBox(far);
  const wantBox = { W: Math.min(-69.2, box10.W), S: Math.min(43.9, box10.S), E: Math.max(-68.8, box10.E), N: Math.max(44.1, box10.N) };
  check("10b. THE WATER IT SEARCHES, READ FIRST (openWaterRead, DRIVEN): a long leg - the chart read over the search's "
        + "water joined to what was read, a `keep` read, then the plan's own water again; a short leg, water already read, "
        + "open water off - nothing read; too wide for an extract - not asked, said why; a failed read - the model kept, "
        + "not read again; an Upload - its approach alone",
        () => aLong && aLong.read === true && rLong.refresh.length === 1 && JSON.stringify(rLong.refresh[0].b) === JSON.stringify(wantBox)
              && rLong.refresh[0].ask.keep === true && /^Go-To: reading the chart over the open water/.test(rLong.refresh[0].ask.say)
              && rLong.covers.length === 1 && rLong.covers[0].opts.keep === true
              && aShort === null && rShort.refresh.length === 0 && aHave === null && rHave.refresh.length === 0 && aOff === null && rOff.refresh.length === 0
              && aBig && aBig.read === false && rBig.refresh.length === 0 && /1\.60/.test(aBig.why)
              && aFail && aFail.failed === "NOAA answered 503" && rFail.covers.length === 0
              && aUp === null && rUp.refresh.length === 0,
        () => JSON.stringify({ long: aLong, refresh: rLong.refresh.map((x) => x.b), short: aShort, have: aHave, big: aBig, off: aOff, fail: aFail, upload: aUp }));
  const PIC = grab("planInsideChart");
  check("10c. ... and planInsideChart reads it after the command's own points are judged and BEFORE the vessels along it and "
        + "the plan; the page imports its words and its box from openwater.js",
        () => PIC.indexOf("await openWaterRead(pts, opts, what);") > PIC.indexOf("let own = nogo.ready")
              && PIC.indexOf("await openWaterRead(pts, opts, what);") < PIC.indexOf("await readPassageAis(pts);")
              && PIC.indexOf("await readPassageAis(pts);") < PIC.indexOf("let p = await plan()")
              && /import \{ openWaterBox, openWaterNote, openWaterWhy \} from "\/static\/js\/openwater\.js";/.test(H),
        "order in planInsideChart, the import");

  // ── 11. ENDS FIRST, THEN INWARD (2026-10-14) ─────────────────────────────────────────────────────────────────────────
  // His 120 km Go-To from a Portland wharf: the field's cells were 152 m, every one within 900 m of her blocked by the
  // harbor, and the search could not start - "no open-water path", the threading route shipped. Here the bay with a
  // HARBOR at its north end: an inlet 250 m wide and 2 km long, her berth 1.5 km up it, and cells of about 150 m (the
  // field's MAX_DIM lowered to make them what his long leg made them).
  {
    const HARB = world([...islands, land(-9000, -20000, -7000, 20000),
                        land(-2000, 11000, -125, 14000), land(125, 11000, 2000, 14000), land(-2000, 14000, 2000, 15000)]);
    const HA = gll(0, 12500), O150 = { MAX_DIM: 250 };
    const legH = R.legPath(HA, BB, GF, HARB, 5);
    const enH = [en(HA), ...(legH || []).map(en)];
    const dH = Math.hypot(en(BB).e - en(HA).e, en(BB).n - en(HA).n);
    const mH = Math.min(OW.OPEN_WATER.MARGIN_MAX_M, Math.max(OW.OPEN_WATER.MARGIN_MIN_M, OW.OPEN_WATER.MARGIN_FRAC * dH));
    const fld = OW.openWaterField(Math.min(...enH.map((p) => p.e)) - mH, Math.min(...enH.map((p) => p.n)) - mH,
                                  Math.max(...enH.map((p) => p.e)) + mH, Math.max(...enH.map((p) => p.n)) + mH, HARB, 5, { ...OW.OPEN_WATER, ...O150 });
    // the old code's dead end: no free cell within its snap (6 cells, or 400 m) of her
    const R6 = Math.max(6, Math.ceil(400 / fld.cell)), ga = en(HA), gx = Math.round((ga.e - fld.x0) / fld.cell), gy = Math.round((ga.n - fld.y0) / fld.cell);
    let freeNearHer = 0;
    for (let y = gy - R6; y <= gy + R6; y++) for (let x = gx - R6; x <= gx + R6; x++)
      if (x >= 0 && y >= 0 && x < fld.W && y < fld.H && !fld.blk[y * fld.W + x]) freeNearHer++;
    const r = legH ? OW.openWaterLeg(HA, BB, GF, HARB, 5, legH, { params: O150 }) : null;
    const pts = r ? [HA, ...r.leg] : [];
    const clear = pts.every((q, i) => i === 0 || K.legClear(pts[i - 1], q, GF, HARB, 5));
    // the head: the way out planned on its own fine field (endField) - up the inlet, inside it - then open water
    const onRouter = (q) => { const p = en(q); let d = Infinity;
      for (let i = 1; i < enH.length; i++) { const a = enH[i - 1], b = enH[i], dx = b.e - a.e, dy = b.n - a.n, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((p.e - a.e) * dx + (p.n - a.n) * dy) / l2)) : 0;
        d = Math.min(d, Math.hypot(p.e - a.e - t * dx, p.n - a.n - t * dy)); } return d; };
    let walked = 0, headSame = !!(r && r.used && r.ends);           // (the name kept: "the head is the harbor's own way")
    for (let i = 0; headSame && i < pts.length - 1 && walked < r.ends.startM - 1; i++) {
      walked += Math.hypot(en(pts[i + 1]).e - en(pts[i]).e, en(pts[i + 1]).n - en(pts[i]).n);
      const q = en(pts[i + 1]);
      if (q.n > 11000 + 1 && Math.abs(q.e) > 125) headSame = false;   // above the mouth: inside the inlet's 250 m
    }
    void onRouter;
    const cR = legH ? leastClear(HARB, [HA, ...legH].filter((q) => en(q).n < 10500)) : null;
    const cO = r && r.used ? leastClear(HARB, pts.filter((q) => en(q).n < 10500)) : null;
    check("11. ENDS FIRST, THEN INWARD: her berth 1.5 km up a 250 m inlet, cells of " + f0(fld.cell) + " m - no free cell "
          + "within the old search's reach of her (" + freeNearHer + "), where it said \"no open-water path\" - and now the "
          + "way up the inlet is planned on its own fine field (" + f0(r && r.ends && r.ends.startM) + " m, inside the inlet) "
          + "and open water taken from the mouth: off the island chain (least clearance south of the mouth " + f0(cR) + " -> " + f0(cO) + " m), every "
          + "leg clear at the buffer",
          () => fld.cell > 140 && freeNearHer === 0 && r && r.used === true && r.why === "open water"
                && r.ends.startM > 1000 && r.ends.startM < 3500 && r.ends.endM === 0 && r.ends.startBy === "fine" && r.ends.endBy === null
                && headSame && clear && cO > 4 * cR,
          () => JSON.stringify({ cell: fld.cell, freeNearHer, why: r && r.why, ends: r && r.ends, headSame, clear, cR, cO }));
    const km2 = (m) => (m >= 1000 ? (m / 1000).toFixed(2) + " km" : Math.round(m) + " m");
    const note = r ? OW.openWaterNote({ ...r, held: 0 }, km2) : "";
    const why = r ? OW.openWaterWhy([{ ...r, held: 0 }], km2) : [];
    const noEnds = OW.openWaterNote({ ...wide, held: 0 }, km2);
    check("11b. ... and SAID: the banner and the Intent card say how far at her end was planned in detail, and why; a leg "
          + "searched end to end says nothing of it (the bay's, check 3)",
          () => /, in detail for the first 1\.\d\d km \(harbor water too tight for the wider search\)$/.test(note)
                && why.length && /; planned in detail for the first 1\.\d\d km, harbor water too tight for the wider search - the way out and in chosen with the open water beyond them/.test(why[0].s)
                && wide.ends && wide.ends.startM === 0 && wide.ends.endM === 0 && !/in detail for/.test(noEnds),
          () => note + " | " + (why[0] && why[0].s.slice(-160)) + " | " + noEnds.slice(-80));
    // A BASIN UP THE INLET: open water of its own the search CAN start in (1.2 km across), joined to the bay only by the
    // narrows its cells close. The water the search takes is the one the route runs the LONGEST through - the bay - not
    // the first it meets: started in the basin it could reach nothing, and the leg came out "short".
    const BAS = world([...islands, land(-9000, -20000, -7000, 20000),
                       land(-2000, 11000, -125, 12000), land(125, 11000, 2000, 12000),
                       land(-2000, 12000, -600, 14000), land(600, 12000, 2000, 14000), land(-2000, 13600, 2000, 15000)]);
    const BA2 = gll(0, 12800), legB2 = R.legPath(BA2, BB, GF, BAS, 5);
    const r2 = legB2 ? OW.openWaterLeg(BA2, BB, GF, BAS, 5, legB2, { params: O150 }) : null;
    const pts2 = r2 ? [BA2, ...r2.leg] : [];
    const clear2 = pts2.every((q, i) => i === 0 || K.legClear(pts2[i - 1], q, GF, BAS, 5));
    check("11c. ... A BASIN UP THE INLET, water the search could start in but not leave: the search takes the bay - the "
          + "water the route runs longest through - from the mouth (" + f0(r2 && r2.ends && r2.ends.startM) + " m planned "
          + "on the fine field, out of the basin and down the narrows)",
          () => r2 && r2.used === true && r2.ends.startM > 1500 && r2.ends.startM < 3500 && r2.ends.startBy === "fine" && clear2,
          () => JSON.stringify({ why: r2 && r2.why, ends: r2 && r2.ends, clear2 }));
  }

  // 11d. THE WAY OUT IS THE ONE THAT DOES THE WHOLE LEG BEST (endField's exits as the search's `seeds`, the far harbor's
  // entries as its `goals`). The first cut took the nearest exit by its own price - on his Portland Go-To, Hussey Sound,
  // 22 m off a charted shoal - before the leg's search had a say. Driven on an open field 100 x 40 cells, 10 m each, B at
  // the right: an exit far from B that cost nothing to reach, and one near B that cost a little - the search starts at
  // the one with the cheaper WHOLE, whichever that is; and ends likewise at the entry with the cheaper whole.
  {
    const W = 100, H = 40, cell = 10, N = W * H;
    const fld = { x0: 0, y0: 0, cell, W, H, blk: new Uint8Array(N), dist: new Float32Array(N).fill(1e7), trust: new Float32Array(N) };
    const at = (gx, gy) => gy * W + gx, A = { e: 0, n: 200 }, Bp = { e: 990, n: 200 };
    const run = (seeds, goals) => OW.searchField(fld, A, Bp, OW.OPEN_WATER, { seeds, goals });
    const far = at(5, 20), near = at(60, 20);
    const nearCheap = run(new Map([[far, 0], [near, 30]]), null);          // near: 30 to reach, 39 on - far: 0, 94 on
    const nearDear = run(new Map([[far, 0], [near, 120]]), null);          // near: 120 + 39 > 0 + 94
    const inA = at(80, 20), inB = at(98, 5);
    const endCheap = run(null, new Map([[inA, 5], [inB, 1]]));             // ... to an entry, at its own cost on
    const endDear = run(null, new Map([[inA, 5], [inB, 200]]));
    check("11d. THE WAY OUT IS THE ONE THAT DOES THE WHOLE LEG BEST: of two exits, the search begins at the one whose cost "
          + "to reach plus the way on is least - the near one at 30 to reach, the far one when the near costs 120 - and "
          + "ends at the entry whose way there plus its cost on is least",
          () => nearCheap && nearCheap[0] === near && nearDear && nearDear[0] === far
                && endCheap && endCheap[endCheap.length - 1] === inA && endDear && endDear[endDear.length - 1] === inA
                && run(null, new Map([[inA, 60], [inB, 1]]))[run(null, new Map([[inA, 60], [inB, 1]])).length - 1] === inB,
          () => JSON.stringify({ nearCheap: nearCheap && nearCheap[0], nearDear: nearDear && nearDear[0],
                                 endCheap: endCheap && endCheap[endCheap.length - 1], endDear: endDear && endDear[endDear.length - 1] }));
  }

  // 11e. AN END TOO TIGHT EVEN FOR THE FINE FIELD: her berth 1 km up an inlet 40 m wide - no free cell of the harbor's own
  // 27 m field within its reach of her - keeps the ROUTER's own route out to the water, as the first cut of ends first did.
  {
    const TIGHT = world([...islands, land(-9000, -20000, -7000, 20000),
                         land(-2000, 11000, -20, 13000), land(20, 11000, 2000, 13000), land(-2000, 13000, 2000, 15000)]);
    const TA = gll(0, 12000), legT = R.legPath(TA, BB, GF, TIGHT, 5);
    const r3 = legT ? OW.openWaterLeg(TA, BB, GF, TIGHT, 5, legT, { params: { MAX_DIM: 250 } }) : null;
    const enT = [en(TA), ...(legT || []).map(en)];
    const onT = (q) => { const p = en(q); let d = Infinity;
      for (let i = 1; i < enT.length; i++) { const a = enT[i - 1], b = enT[i], dx = b.e - a.e, dy = b.n - a.n, l2 = dx * dx + dy * dy;
        const t = l2 ? Math.max(0, Math.min(1, ((p.e - a.e) * dx + (p.n - a.n) * dy) / l2)) : 0;
        d = Math.min(d, Math.hypot(p.e - a.e - t * dx, p.n - a.n - t * dy)); } return d; };
    const pts3 = r3 ? [TA, ...r3.leg] : [];
    let w3 = 0, on3 = !!(r3 && r3.used && r3.ends);
    for (let i = 0; on3 && i < pts3.length - 1 && w3 < r3.ends.startM - 1; i++) {
      w3 += Math.hypot(en(pts3[i + 1]).e - en(pts3[i]).e, en(pts3[i + 1]).n - en(pts3[i]).n);
      if (onT(pts3[i + 1]) > 0.5) on3 = false;
    }
    check("11e. ... AN END TOO TIGHT EVEN FOR THE HARBOR'S FINE FIELD (a 40 m inlet, her berth 1 km up it) keeps the "
          + "router's own route out of it (" + f0(r3 && r3.ends && r3.ends.startM) + " m, on its line) - and the open "
          + "water is still taken from where that reaches the bay",
          () => r3 && r3.used === true && r3.ends.startBy === "router" && r3.ends.startM > 900 && on3,
          () => JSON.stringify({ why: r3 && r3.why, ends: r3 && r3.ends, on3 }));
  }
  // 11f. A SHORTCUT IS NEVER NEARER A HAZARD THAN THE STRETCH IT REPLACES (spineOf). Driven on a field 60 x 30 cells of
  // 10 m: a hazard at cell (30, 8); the search's path goes up and over it - 80 m off at its nearest - and down again. The
  // straight line between its ends passes 40 m off and, priced alone, costs less for being shorter; it is not taken.
  {
    const W = 60, H = 30, cell = 10, N = W * H, hz = { x: 30, y: 8 };
    const dist = new Float32Array(N), blk = new Uint8Array(N);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) dist[y * W + x] = Math.hypot(x - hz.x, y - hz.y) * cell;
    blk[hz.y * W + hz.x] = 1;
    const fld = { x0: 0, y0: 0, cell, W, H, blk, dist, trust: new Float32Array(N) };
    const cells = [];
    for (let k = 0; k <= 12; k++) cells.push((4 + k) * W + k);          // up the diagonal from (0, 4) to (12, 16)
    for (let x = 13; x <= 47; x++) cells.push(16 * W + x);                // along y = 16
    for (let k = 1; k <= 12; k++) cells.push((16 - k) * W + 47 + k);      // down to (59, 4)
    const F0 = { fromEN: (e, n) => ({ lat: n, lon: e }) };
    const spine = OW.spineOf(fld, cells, { lat: 40, lon: 0 }, { lat: 40, lon: 590 }, F0, OW.OPEN_WATER);
    let leastS = Infinity;                           // the spine's least clearance, sampled every 5 m
    for (let i = 1; i < spine.length; i++) {
      const a = spine[i - 1], b = spine[i], L = Math.hypot(b.lon - a.lon, b.lat - a.lat), n = Math.max(1, Math.ceil(L / 5));
      for (let k = 0; k <= n; k++) { const e = a.lon + (b.lon - a.lon) * k / n, m = a.lat + (b.lat - a.lat) * k / n;
        leastS = Math.min(leastS, Math.hypot(e / cell - hz.x, m / cell - hz.y) * cell); }
    }
    check("11f. A SHORTCUT IS NEVER NEARER A HAZARD THAN THE STRETCH IT REPLACES: the path keeps 80 m off; the straight "
          + "line between its ends would pass 40 m off; the spine keeps " + f0(leastS) + " m",
          () => spine.length > 2 && leastS >= 80 - cell,
          () => spine.length + " points: " + JSON.stringify(spine.map((q) => [Math.round(q.lon), Math.round(q.lat)])));
  }

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})().catch(__crash);
