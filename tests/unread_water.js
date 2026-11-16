// tests/unread_water.js - the page's side of the chart in layers: water no chart covers is refused, never clear.
//
// Andy, 2026-10-11 (step 2 of the long-transit plan): within each tile, use the most detailed scale wherever it exists
// and fill the rest from the next coarser one; water no chart covers is UNREAD. The server's side - the squares, the
// cutting, the tiles - is tests/enc_layered.py. This is what the page does with what it serves:
//
//   1-1c  passage.js beyondChart refuses a route through an unread square, or within CHART_EDGE_M of one, sampling
//         every leg (a leg can cross a square between two points that are clear of it); a failed read is said as one;
//         the box still comes first;
//   2     the words, for a route and for a command's own point;
//   3-3b  the page's planInsideChart refuses a point or a route in unread water AT ONCE - no wider read, which cannot
//         chart it - and its advice says what can help;
//   4     EVERY beyondChart call that judges against nogo.bbox passes nogo.unread (a call that forgets is a planner
//         that routes through water nobody charted);
//   5     the seabed-gap check runs over the harbour chart alone in a layered extract, and a hole a coarser chart's
//         seabed fills is not taken for a float (skinOverHarbour, with the real skin.js);
//   6     a coarser chart's cut is neither drawn as a coast nor taken for charted ink (uncutRuns; drawENC);
//   7     the extract's unread squares ride into nogo.unread with its box (fetchENCBbox, refreshNogo), and are drawn.
//
//   node tests/unread_water.js   # exit 0 = pass
//
// TEETH - seventeen mutations RUN on scratch copies (scratchpad mutate_layered.py), all caught:
//   beyondChart ignores the unread squares                    -> 1, 1b, 3, 3b
//   legs not sampled                                          -> 1, 1b, 3b
//   no margin round a square                                  -> 1
//   a failed read not said as one                             -> 1b, 3b
//   the squares she is in count (stranded)                    -> 1b
//   every square near the route exempt                        -> 1, 1b, 3, 3b
//   the command's own points judged with the line between     -> 1b, 3b
//   how far in taken at the first hit, not the deepest        -> 1, 1b
//   a target in unread water read for, not refused            -> 3
//   a route through unread water read round and round         -> 3b
//   a planner call forgets the unread squares                 -> 4
//   the seabed's gaps read over every chart                   -> 5
//   a hole a coarser chart fills taken for a float            -> 5
//   a cut kept as ink                                         -> 6
//   a piece's cut drawn as a coast                            -> 6
//   the failed squares dropped on the way in                  -> 7
//   the model never told                                      -> 7
// Two of them were bugs in the FIRST BUILD, found by this suite before any mutation: a route ending inside a
// square was said as 'within 100 m of it' (the first hit was in the margin), and a command's own points were
// refused for the straight line between them, which is no route.

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
const P = require(path.join(APP, "static", "js", "passage.js"));
const SK = require(path.join(APP, "static", "js", "skin.js"));
const G = require(path.join(APP, "static", "js", "geometry.js"));
const CG = require(path.join(APP, "static", "js", "core_geometry.js"));
const H = fs.readFileSync(process.env.ASV_HTML || path.join(APP, "static", "asv.html"), "utf8");
const PV = fs.readFileSync(path.join(APP, "static", "js", "passage.js"), "utf8");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = (detail ? (typeof detail === "function" ? "" : detail) + " — " : "") + "THREW: " + e.message; }
  if (typeof detail === "function") { try { detail = detail(); } catch (e) { detail = "detail threw: " + e.message; } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}
// a function's whole text out of the page, by brace count - `async` kept with it
function grab(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("function " + name + " not found in the page (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", H.indexOf(")", start)), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
const M = 111320;
const box = { W: -70.80, S: 43.00, E: -70.60, N: 43.15 };
const at = (e, n) => ({ lat: 43.07 + n / M, lon: -70.70 + e / (M * Math.cos(43.07 * Math.PI / 180)) });
// an unread square 400 m across, its west edge 1 km east of the origin
const sqr = (e0, n0, e1, n1, failed) => { const a = at(e0, n0), b = at(e1, n1); return { W: a.lon, S: a.lat, E: b.lon, N: b.lat, failed: !!failed }; };
const U = [sqr(1000, -200, 1400, 200)];

console.log("Water no chart covers:");

// ── 1. beyondChart ────────────────────────────────────────────────────────────────────────────────────────────────
{
  const through = P.beyondChart([at(0, 0), at(1200, 0)], box, undefined, U);        // ends inside it
  const across = P.beyondChart([at(0, 0), at(3000, 0)], box, undefined, U);         // both ends clear, the leg crosses
  const margin = P.beyondChart([at(0, 0), at(950, 250)], box, undefined, U);        // within 100 m of a corner, never in
  const clear = P.beyondChart([at(0, 0), at(800, -500)], box, undefined, U);        // stays > 100 m off
  const none = P.beyondChart([at(0, 0), at(3000, 0)], box);                          // no unread given: as before
  check("1. A ROUTE THROUGH AN UNREAD SQUARE is refused (`where: unread`, how far in); a leg whose two ends are both clear "
        + "but CROSSES one is caught (the legs are sampled); one passing within 100 m is refused at the margin (0 in); "
        + "one 100 m clear passes; with no unread squares given, nothing changes",
        () => through && through.where === "unread" && through.outM > 150 && !through.failed
              && across && across.where === "unread" && across.outM > 150
              && margin && margin.where === "unread" && margin.outM === 0
              && clear === null && none === null,
        () => JSON.stringify({ through: through && [through.where, Math.round(through.outM)], across: across && Math.round(across.outM),
                               margin: margin && margin.outM, clear, none }));
  const failed = P.beyondChart([at(0, 0), at(1200, 0)], box, undefined, [sqr(1000, -200, 1400, 200, true)]);
  // she is IN an unread square (2026-10-18, A2 - Andy: "Excuse only her own short way out, not the whole unread
  // square"): her own first 100 m is let be, and nothing further - not the rest of the square she is in
  const U2 = [sqr(-200, -200, 200, 200), sqr(1000, -200, 1400, 200)];
  const BIG = [sqr(-12000, -12000, 12000, 12000, true)];                           // a whole chart tile, failed
  const out = P.beyondChart([at(0, 0), at(800, -600)], box, undefined, U2);        // ~250 m inside her square first
  const shortOut = P.beyondChart([at(0, 0), at(80, 0)], box, undefined, U2);       // within her own first 100 m
  const throughTile = P.beyondChart([at(0, 0), at(3000, 200)], box, undefined, BIG);   // the Canaveral case
  const onward = P.beyondChart([at(0, 0), at(3000, 0)], box, undefined, U2);
  const pointsOnly = P.beyondChart([at(0, 0), at(3000, 0)], box, undefined, U, {points: true});
  check("1b. a square whose chart could not be READ is said as one (`failed`); a boat IN an unread square has her own "
        + "first 100 m let be and NOTHING MORE (A2): a route that runs on inside her square is refused, as is one through "
        + "the whole failed tile she was spawned in, while one that stays within her first 100 m stands; a second square "
        + "further on is refused; and a command's own POINTS (`points`) are judged without the straight line between them",
        () => failed && failed.where === "unread" && failed.failed === true
              && out && out.where === "unread" && shortOut === null
              && throughTile && throughTile.where === "unread" && throughTile.failed === true && throughTile.outM > 1000
              && onward && onward.where === "unread" && onward.outM > 150 && pointsOnly === null,
        () => JSON.stringify({ f: failed && failed.failed, out: out && out.where, shortOut, tile: throughTile && Math.round(throughTile.outM),
                               onward: onward && Math.round(onward.outM), pointsOnly }));
  // 1d. A READ THAT FAILED IS REFUSED BY THE PLANNERS, NOT ROUTED STRAIGHT (2026-10-18, A3): with no model and
  // `nogo.failed`, holdTarget, planNogoRoute and routePlan answer the refusal (mode chart_failed); with no model and
  // no failure - no chart at any scale - they answer `degraded` as before
  {
    const S = require(path.join(APP, "static", "js", "state.js")), was = { ...S.nogo };
    S.nogo.ready = false; S.nogo.failed = { at: 0, why: "ENC enc_coastal/158: Could not find service" };
    const ht = P.holdTarget(at(500, 0)), pr = P.planNogoRoute(at(0, 0), at(500, 0)), rp = P.routePlan(at(0, 0), [at(500, 0)]);
    S.nogo.failed = null;
    const ht0 = P.holdTarget(at(500, 0)), pr0 = P.planNogoRoute(at(0, 0), at(500, 0)), rp0 = P.routePlan(at(0, 0), [at(500, 0)]);
    Object.assign(S.nogo, was);
    const refused = (x) => x && /could not be read \(ENC enc_coastal\/158: Could not find service\)/.test(x.error || "")
                           && x.reason && x.reason.mode === "chart_failed" && !x.degraded;
    check("1d. a READ THAT FAILED is refused by every planner (holdTarget, planNogoRoute, routePlan: the failure named, "
          + "mode chart_failed, routePlan with no route at all) - never routed straight; with no model and no failure (no "
          + "chart at any scale) they answer degraded, straight, as before",
          () => refused(ht) && refused(pr) && refused(rp) && Array.isArray(rp.route) && rp.route.length === 0
                && ht0.degraded && !ht0.error && pr0.degraded && pr0.direct && rp0.degraded && rp0.route.length === 1,
          () => JSON.stringify({ ht: ht && ht.error, pr: pr && pr.reason, rp: rp && rp.route, ht0: ht0.degraded, pr0: pr0.degraded, rp0: rp0.degraded }));
  }
  const both = P.beyondChart([at(0, 0), at(1200, 0), at(0, 30000)], box, undefined, U);
  check("1c. the BOX comes first: a route that leaves the box and crosses unread water is refused for the box (a wider "
        + "read may answer that; nothing answers the other)",
        () => both && both.where === undefined && both.outM > 0, () => JSON.stringify(both && { where: both.where, out: Math.round(both.outM) }));
}

// ── 2. the words ──────────────────────────────────────────────────────────────────────────────────────────────────
{
  const f = (m) => Math.round(m) + " m";
  const r1 = P.beyondChartSay({ where: "unread", outM: 120, edgeM: 100 }, f);
  const r2 = P.beyondChartSay({ where: "unread", outM: 0, edgeM: 100 }, f);
  const r3 = P.beyondChartSay({ where: "unread", outM: 50, edgeM: 100, failed: true }, f);
  const r4 = P.beyondChartSay({ where: "unread", outM: 50, edgeM: 100, subject: "the target" }, f);
  check("2. THE WORDS: 'the route runs through water no chart covers', 'within 100 m of water no chart covers', 'through "
        + "water whose chart could not be read', and a command's own point 'lies in' it",
        () => r1 === "the route runs through water no chart covers" && r2 === "the route runs within 100 m of water no chart covers"
              && r3 === "the route runs through water whose chart could not be read" && r4 === "the target lies in water no chart covers",
        () => [r1, r2, r3, r4].join(" | "));
}

// ── 3. planInsideChart ────────────────────────────────────────────────────────────────────────────────────────────
{
  const world = (unread) => {
    const w = { reads: 0, plans: 0, banners: [] };
    const nogo = { ready: true, bbox: box, unread };
    const mk = new Function("nogo", "beyondChart", "beyondChartSay", "fmtDist", "boxAround", "encSpanRefusal", "bbUnion",
      "ensureNogoCovers", "readPassageAis", "aisKeepoutsNow", "showBanner", "takeDownBanner", "sizeWhy", "STALL_TICK_MS",
      "CHART_WIDEN_ROUNDS", "CHART_WIDEN_PAD_M", "openWaterRead",
      // no Stop is pressed while a plan is searched here (planInsideChart's withdrawal: tests/route_worker.js 12)
      "let routeStopGen = 0, routeStopName = null;\n" + grab("commandReads") + "\n" + grab("planInsideChart") + "\nreturn planInsideChart;");
    w.fn = mk(nogo, P.beyondChart, P.beyondChartSay, (m) => Math.round(m) + " m", () => box, () => null, (a) => a,
      async () => { w.reads++; return true; }, async () => {}, () => {}, (t) => w.banners.push(t), () => {}, () => "",
      0, 3, 1000, async () => null);   // (open water first's read: tests/open_water.js's - none here)
    return w;
  };
  const A = world(U);
  let refusedTarget = null;
  const B = world(U);
  let refusedRoute = null;
  const Cw = world([sqr(1000, -200, 1400, 200, true)]);
  let refusedFailed = null;
  const tips = new Function(grab("lateKeeps") + "\n" + grab("unchartedTip") + "\nreturn unchartedTip;")();
  (async () => {
    refusedTarget = await A.fn([at(0, 0), at(1200, 0)], {}, () => { A.plans++; return { route: [at(1200, 0)] }; }, "Go-To");
    refusedRoute = await B.fn([at(0, 0), at(3000, 0)], {}, () => {
      B.plans++;
      const route = [at(1500, 0), at(3000, 0)];
      return { route, uncharted: P.beyondChart([at(0, 0), ...route], box, undefined, U) };
    }, "Go-To");
    refusedFailed = await Cw.fn([at(0, 0), at(1200, 0)], {}, () => ({ route: [] }), "Go-To");
  })().then(() => {
    check("3. A TARGET IN UNREAD WATER is refused BEFORE anything is planned or read - no wider read (it cannot chart it), "
          + "'the target lies in water no chart covers', cause unread",
          () => refusedTarget && refusedTarget.uncharted && refusedTarget.uncharted.cause === "unread" && A.reads === 0 && A.plans === 0
                && /^the target lies in water no chart covers$/.test(refusedTarget.error),
          () => JSON.stringify({ error: refusedTarget && refusedTarget.error, reads: A.reads, plans: A.plans }));
    check("3b. a ROUTE that runs through unread water is refused after ONE plan - no reading rounds - and the advice names "
          + "what helps: a square no chart covers 'choose a point inside charted water', a failed read 'command it again'",
          () => refusedRoute && refusedRoute.uncharted.cause === "unread" && B.reads === 0 && B.plans === 1
                && /through water no chart covers/.test(refusedRoute.uncharted.say)
                && refusedFailed && refusedFailed.uncharted.cause === "failed"
                && /choose a point inside charted water/.test(tips(refusedRoute.uncharted, "x"))
                && /Command it again once the chart can be read there/.test(tips(refusedFailed.uncharted, "x")),
          () => JSON.stringify({ say: refusedRoute && refusedRoute.uncharted.say, reads: B.reads, plans: B.plans,
                                 failed: refusedFailed && refusedFailed.uncharted.cause }));
    rest();
  });
}

function rest() {
  // ── 4. every call site ──────────────────────────────────────────────────────────────────────────────────────────
  const calls = [];
  for (const [src, name] of [[H, "asv.html"], [PV, "passage.js"]]) {
    const re = /beyondChart\(([^;]*?)\)(?=[;)\s:]|$)/g;
    let m;
    while ((m = re.exec(src))) if (/nogo\.bbox/.test(m[1])) calls.push([name, m[1].slice(-60)]);
  }
  const missing = calls.filter(([, a]) => !/nogo\.bbox, undefined, nogo\.unread/.test(a));
  check("4. EVERY beyondChart call that judges against nogo.bbox passes nogo.unread (" + calls.length + " calls) - one that "
        + "forgot would plan through water nobody charted",
        () => calls.length >= 5 && !missing.length, () => missing.map(([n, a]) => n + ": " + a).join(" | ") || calls.length + " calls");

  // ── 5. the seabed's gaps, over the harbour chart alone ──────────────────────────────────────────────────────────
  {
    const fn = SK.skinOverHarbour;     // skin.js's since 2026-10-17: the one copy the page and skin_worker.js both run
    const r = (W, S, E, N) => [[W, S], [E, S], [E, N], [W, N], [W, S]];
    const B0 = { W: -70.70, S: 43.05, E: -70.60, N: 43.10 };
    // the harbour seabed: two depth areas tiling the box but for a 40 m x 40 m hole between them - a float
    // a float: a 40 m x 40 m hole cut out of one harbour depth area (its ring clockwise, as a hole is)
    const hole = [[-70.6805, 43.0749], [-70.6805, 43.0753], [-70.680, 43.0753], [-70.680, 43.0749], [-70.6805, 43.0749]];
    const hA = { role: "depth_area", cls: "Depth_Area", band: "enc_harbour", props: { DRVAL1: 5 },
                 geometry: { type: "Polygon", coordinates: [r(-70.72, 43.03, -70.65, 43.12), hole] } };
    const hB = { role: "depth_area", cls: "Depth_Area", band: "enc_harbour", props: { DRVAL1: 5 },
                 geometry: { type: "Polygon", coordinates: [r(-70.65, 43.03, -70.58, 43.12)] } };
    const enc = { layered: true, partial: [] };
    const plain = fn([hA, hB], B0, enc);
    // a coarser chart's seabed piece over the same hole: the harbour chart ENDS there, it is not a float
    const coarse = { role: "depth_area", cls: "Depth_Area", band: "enc_coastal", clip: [-70.69, 43.07, -70.67, 43.08], props: { DRVAL1: 9 },
                     geometry: { type: "Polygon", coordinates: [r(-70.69, 43.07, -70.67, 43.08)] } };
    const filled = fn([hA, hB, coarse], B0, enc);
    // and the coarse piece is not fed to the topology: alone over open water it would leave its own "holes"
    const odd = { role: "depth_area", cls: "Depth_Area", band: "enc_coastal", clip: [-70.63, 43.06, -70.62, 43.07], props: {},
                  geometry: { type: "Polygon", coordinates: [r(-70.63, 43.06, -70.62, 43.07), r(-70.626, 43.064, -70.625, 43.065).reverse()] } };
    const notFed = fn([hA, hB, odd], B0, enc);
    check("5. THE SEABED'S GAPS over the harbour chart alone: the float between two harbour depth areas is found; a hole a "
          + "coarser chart's seabed fills is where the harbour chart ends, NOT a float; and a coarser piece's own rings "
          + "never enter the topology",
          () => plain.gaps.length === 1 && filled.gaps.length === 0 && notFed.gaps.length === 1,
          () => "harbour alone " + plain.gaps.length + " gap(s), coarse over it " + filled.gaps.length + ", coarse piece elsewhere "
              + notFed.gaps.length);
  }

  // ── 6. a cut is not a coast, nor ink ────────────────────────────────────────────────────────────────────────────
  {
    const uncut = new Function(grab("uncutRuns") + "\nreturn uncutRuns;")();
    const clip = [0, 0, 1, 1];
    // a piece: a coast from (0, 0.2) bulging into the square to (0.6, 1), the rest of its ring along the cut
    const ring = [[0, 0.2], [0.4, 0.5], [0.6, 1], [0, 1], [0, 0.2]];
    const runs = uncut(ring, clip);
    // drawENC's drawing is chartlayers.js's since 2026-10-17 (the page and the chart worker draw with it)
    const CLS = fs.readFileSync(path.join(__dirname, "..", "static", "js", "chartlayers.js"), "utf8");
    const drawn = CLS.slice(CLS.indexOf("export function drawENC("), CLS.indexOf("export function drawNogo("));
    check("6. A CUT IS NOT A COAST, NOR INK: of a piece's ring only the runs NOT along its square are kept for the "
          + "chart-image check (here the bulge, not its edges on x=0 and y=1), and drawENC fills a piece's land and "
          + "structures with no outline",
          () => runs.length === 1 && JSON.stringify(runs[0]) === JSON.stringify([[0, 0.2], [0.4, 0.5], [0.6, 1]])
                && /cut=!!f\.clip/.test(drawn) && /fillPoly\(g,"rgba\(120,96,58,0\.38\)",cut\?null:/.test(drawn)
                && /const runs = \(cs\) => f\.clip \? uncutRuns\(cs, f\.clip\) : \[cs\];/.test(H),
          () => JSON.stringify(runs));
  }

  // ── 7. the extract's squares ride into the model ────────────────────────────────────────────────────────────────
  {
    const sea = { enc: null };
    const fe = encReader(sea, async () => ({
      json: async () => ({ band: "enc_harbour", layered: true, features: [], unread: [[1, 2, 3, 4]], unread_failed: [[5, 6, 7, 8]] }) }));
    fe({ W: 0, S: 0, E: 1, N: 1 }, 2).then(async () => {
      const rn = grab("refreshNogo");
      check("7. THE EXTRACT'S SQUARES ride into the model with its box: fetchENCBbox carries unread (failed ones marked), "
            + "refreshNogo sets nogo.unread beside nogo.bbox from the same extract, and the zones layer draws them, its "
            + "cache keyed on them",
            () => sea.enc.layered === true && JSON.stringify(sea.enc.unread) === JSON.stringify([{ W: 1, S: 2, E: 3, N: 4, failed: false },
                                                                                               { W: 5, S: 6, E: 7, N: 8, failed: true }])
                  && /nogo\.bbox = b;[^\n]*\n\s*nogo\.unread = enc\.unread \|\| \[\];/.test(rn)
                  // (the corridor's own squares beside them since step 3 - tests/corridor_read.js 5)
                  && /drawLayerOff\(nogoLayer, "nogo", nogoLayerKeyNow\(\), \[nogo\.features, chartInk\.lines, chartInk\.areas, nogo\.unread[,\]]/.test(H)
                  && /unreadAll: \[\.\.\.\(nogo\.unread \|\| \[\]\)/.test(grab("nogoDrawData")),
            () => JSON.stringify(sea.enc && sea.enc.unread));
      await readBound();
      await commandReadsChecks();
      console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
      process.exit(fails ? 1 : 0);
    });
  }
}

// ── THE CHART READ'S BOUND (2026-11-16) ──────────────────────────────────────────────────────────────────────────────
// fetchENCBbox was a bare `fetch`: a console that took the request and never answered held every command's chart read
// for good. It is corridorAsk's now - bounded at encReadMs(b), aborted at the bound, withdrawn by `gone()`, and null
// (`note.why` in words) for no answer to take. `consts` shrinks the bound so a "never answers" world ends in seconds;
// the page's own sizing is held in 7c.
function declOf(re) { const m = H.match(re); if (!m) throw new Error(re + " not found in the page (renamed?)"); return m[0]; }
function encReader(sea, fetchImpl, consts) {
  const c = consts || null;
  const src = (c ? "const ENC_READ_MIN_MS = " + c.min + ", ENC_READ_TILE_MS = " + c.tile + ";" : declOf(/^const ENC_READ_MIN_MS = [^\n]*;/m)) + "\n"
    + declOf(/^const ENC_READ_TILE_DEG = [^;]*;/m) + "\n"
    + (c ? "const CHART_READ_GONE_MS = " + c.gone + ";" : declOf(/^const CHART_READ_GONE_MS = [^;]*;/m)) + "\n"
    + ["encReadMs", "corridorFailure", "corridorReply", "corridorAsk", "fetchENCBbox"].map(grab).join("\n")
    + "\nreturn fetchENCBbox;";
  return new Function("sea", "fetch", "skinWorkerUsable", "skinJobStart", src)(sea, fetchImpl, () => false, () => null);
}
// a fetch that never answers - but lets go when its signal is aborted, as the browser's does
function hanging(rec) {
  return (url, init) => {
    rec.url = url; rec.signal = !!(init && init.signal);
    return new Promise((res, rej) => {
      if (init && init.signal) init.signal.addEventListener("abort", () => {
        rec.aborted = Date.now(); rej(Object.assign(new Error("The operation was aborted"), { name: "AbortError" })); });
    });
  };
}
// every "never answers" world is CAPPED: a page that waits for ever fails the check, it does not spin the suite
const CAP_MS = 6000;
async function capped(p) {
  let t; const cap = new Promise((r) => { t = setTimeout(() => r("CAPPED"), CAP_MS); });
  try { return await Promise.race([p, cap]); } finally { clearTimeout(t); }
}
async function readBound() {
  const B1 = { W: -70.74, S: 43.01, E: -70.72, N: 43.03 };            // inside one 0.25 degree tile
  const B9 = { W: -70.80, S: 42.90, E: -70.30, N: 43.40 };            // across three tiles each way: 9
  const small = { min: 400, tile: 150, gone: 50 };
  // 7b. the bound, its abort, and its scaling with the tiles the box reaches into
  const r1 = {}, s1 = { enc: null }, n1 = {};
  const t1 = Date.now(), a1 = await capped(encReader(s1, hanging(r1), small)(B1, 2, n1)), e1 = Date.now() - t1;
  const r9 = {}, s9 = { enc: null }, n9 = {};
  const t9 = Date.now(), a9 = await capped(encReader(s9, hanging(r9), small)(B9, 2, n9)), e9 = Date.now() - t9;
  check("7b. A READ THE CONSOLE NEVER ANSWERS ENDS AT ITS BOUND: fetchENCBbox hands fetch a signal, aborts it at encReadMs(b) - "
        + "the least for a one-tile box, ENC_READ_TILE_MS a tile past that (nine here) - and answers null, said in words, with "
        + "sea.enc untouched",
        () => a1 === null && r1.signal && r1.aborted && e1 >= small.min - 30 && e1 < small.min + 1500 && /^unanswered in /.test(n1.why || "")
              && s1.enc === null
              && a9 === null && r9.aborted && e9 >= 9 * small.tile - 30 && e9 < 9 * small.tile + 1500 && s9.enc === null,
        () => JSON.stringify({ a1, e1, why1: n1.why, signal: r1.signal, aborted: !!r1.aborted, a9, e9, why9: n9.why, enc: s1.enc }));
  // 7b2. a press that no longer stands ends it at once (corridorAsk's `gone`, asked every CHART_READ_GONE_MS)
  const rg = {}, sg = { enc: null }, ng = {}, tg = Date.now();
  let goneAt = tg + 120;
  const ag = await capped(encReader(sg, hanging(rg), { min: 5000, tile: 1, gone: 25 })(B1, 2, ng, () => Date.now() >= goneAt));
  const eg = Date.now() - tg;
  check("7b2. ... and a read waited on for a press that no longer stands (`gone`) is aborted within CHART_READ_GONE_MS of it - "
        + "null, `note.gone` - not at the bound",
        () => ag === null && ng.gone === true && rg.aborted && eg >= 100 && eg < 1000 && sg.enc === null,
        () => JSON.stringify({ ag, eg, gone: ng.gone, why: ng.why, aborted: !!rg.aborted }));
  // 7b3. no answer to take, each said as what it was; and a refusal in words IS an answer
  const one = async (fetchImpl) => { const s = { enc: null }, n = {}; const d = await capped(encReader(s, fetchImpl, small)(B1, 2, n)); return { d, why: n.why, enc: s.enc }; };
  const r502 = await one(async () => ({ status: 502, json: async () => ({ error: "Could not find service" }) }));
  const rNet = await one(async () => { throw new TypeError("fetch failed"); });
  const rBad = await one(async () => ({ status: 200, json: async () => { throw new SyntaxError("Unexpected token <"); } }));
  const rArr = await one(async () => ({ status: 200, json: async () => [] }));
  const r400 = await one(async () => ({ status: 400, json: async () => ({ error: "the box is wider than the console reads" }) }));
  const rOk = await one(async () => ({ status: 200, json: async () => ({ band: "enc_harbour", features: [] }) }));
  check("7b3. NO ANSWER TO TAKE is null with the cause in words - the console's own HTTP 5xx (its words), the network, a reply "
        + "that is not JSON, one that is not a chart - and sea.enc untouched; while a REFUSAL (4xx, {error}) and a chart are "
        + "answers, as before",
        () => r502.d === null && r502.why === "HTTP 502 - Could not find service" && r502.enc === null
              && rNet.d === null && rNet.why === "the console could not be reached" && rNet.enc === null
              && rBad.d === null && rBad.why === "a reply that was not JSON"
              && rArr.d === null && rArr.why === "a reply that was not a chart" && rArr.enc === null
              && r400.d && r400.d.error === "the box is wider than the console reads"
              && rOk.d && rOk.d.band === "enc_harbour" && rOk.enc && rOk.enc.band === "enc_harbour",
        () => JSON.stringify({ r502: [r502.d, r502.why], rNet: [rNet.d, rNet.why], rBad: [rBad.d, rBad.why], rArr: [rArr.d, rArr.why],
                               r400: r400.d, rOk: rOk.d && rOk.d.band }));
  // 7c. THE PAGE'S OWN SIZING: generous (a refused way home is worse than a slow one), and the tile the console keeps
  const real = new Function(declOf(/^const ENC_READ_MIN_MS = [^\n]*;/m) + "\n" + declOf(/^const ENC_READ_TILE_DEG = [^;]*;/m) + "\n"
    + grab("encReadMs") + "\nreturn { encReadMs, ENC_READ_MIN_MS, ENC_READ_TILE_MS, ENC_READ_TILE_DEG };")();
  const SRV = fs.readFileSync(path.join(APP, "asv_console.py"), "utf8");
  const srvDeg = +((SRV.match(/^ENC_TILE_DEG = ([\d.]+)/m) || [])[1]);
  const aligned = real.encReadMs({ W: -72.0, S: 42.0, E: -70.0, N: 44.0 });   // 2 x 2 degrees on the tile grid: 8 x 8 tiles
  const offset = real.encReadMs({ W: -71.9, S: 42.1, E: -69.9, N: 44.1 });    // the same size across the grid: 9 x 9
  check("7c. THE BOUND IS SIZED GENEROUSLY, ON THE CONSOLE'S OWN TILE: ENC_READ_TILE_DEG is asv_console.py's ENC_TILE_DEG; a "
        + "box of a tile or a few is waited ENC_READ_MIN_MS - no less than twice the slowest read the session logs hold (877 s) "
        + "- and a box of more tiles ENC_READ_TILE_MS for each (at least four times the slowest tile measured from NOAA, ~20 s)",
        () => real.ENC_READ_TILE_DEG === srvDeg && real.ENC_READ_MIN_MS >= 2 * 877000 && real.ENC_READ_TILE_MS >= 4 * 20000
              && real.encReadMs(B1) === real.ENC_READ_MIN_MS
              && aligned === Math.max(real.ENC_READ_MIN_MS, 64 * real.ENC_READ_TILE_MS)
              && offset === Math.max(real.ENC_READ_MIN_MS, 81 * real.ENC_READ_TILE_MS),
        () => JSON.stringify({ deg: real.ENC_READ_TILE_DEG, srvDeg, min: real.ENC_READ_MIN_MS, tile: real.ENC_READ_TILE_MS,
                               one: real.encReadMs(B1), aligned, offset }));
}

// ── 3c-3f. A COMMAND'S READS, AS ONE (commandReads, 2026-11-16) ────────────────────────────────────────────────────────
// The command's own read and planInsideChart's after it share one record: a give-up (`late`) ends the reading - the plan is
// refused by that cause, not read again - and a Stop pressed while the FIRST read ran, or the caller's fence falling while
// any is waited on, withdraws it.
async function commandReadsChecks() {
  const world = () => {
    const w = { reads: [], plans: 0, banners: [], logs: [], onRead: null };
    const nogo = { ready: true, bbox: box, unread: [] };
    const mk = new Function("nogo", "beyondChart", "beyondChartSay", "fmtDist", "boxAround", "encSpanRefusal", "bbUnion",
      "ensureNogoCovers", "readPassageAis", "aisKeepoutsNow", "showBanner", "takeDownBanner", "sizeWhy", "STALL_TICK_MS",
      "CHART_WIDEN_ROUNDS", "CHART_WIDEN_PAD_M", "openWaterRead", "logClient",
      "let routeStopGen = 0, routeStopName = null;\n" + grab("routeStopPressed") + "\n" + grab("commandReads") + "\n"
      + grab("planInsideChart") + "\nreturn { planInsideChart, commandReads, routeStopPressed };");
    w.api = mk(nogo, P.beyondChart, P.beyondChartSay, (m) => Math.round(m) + " m", () => box, () => null, (a) => a,
      async (pts, pad, ask) => { w.reads.push(ask); return w.onRead ? w.onRead(ask, w) : true; }, async () => {}, () => {},
      (t) => w.banners.push(t), () => {}, () => "", 0, 3, 1000, async () => null, (k, d) => w.logs.push([k, d]));
    return w;
  };
  const tips = new Function(grab("lateKeeps") + "\n" + grab("unchartedTip") + "\nreturn unchartedTip;")();
  const far = at(12000, 0), near = at(3000, 0);                     // the target past the box; one inside it
  const LATE = "unanswered in 30 min";
  const giveUp = (why) => (ask) => { ask.read.late = why; ask.failed = "the console gave no answer it could use to the chart read (" + why + ")"; ask.late = true; return false; };
  // 3c. the caller's read already given up: nothing read again, nothing planned, refused by that cause
  const A = world(), rdA = A.api.commandReads(); rdA.late = LATE;
  const ra = await capped(A.api.planInsideChart([at(0, 0), far], { read: rdA }, () => { A.plans++; return { route: [far] }; }, "Go-To"));
  // ... and given up by planInsideChart's own read of its points
  const B = world(); B.onRead = giveUp("HTTP 502 - Could not find service");
  const rb = await capped(B.api.planInsideChart([at(0, 0), far], {}, () => { B.plans++; return { route: [far] }; }, "Go-To"));
  check("3c. A READ GIVEN UP FOR NO ANSWER ENDS THE COMMAND'S READING: the caller's own given up, nothing is read again or "
        + "planned; given up by the plan's own read, it is not asked twice - each refused by that cause (`late`, cause late, "
        + "its words) with the advice that nothing was sent and to command it again",
        () => ra && ra.late === true && ra.uncharted && ra.uncharted.cause === "late" && A.reads.length === 0 && A.plans === 0
              && /the console gave no answer it could use to the chart read \(unanswered in 30 min\)/.test(ra.error)
              && /^Nothing was sent\. Command it again/.test(tips(ra.uncharted, "x"))
              && rb && rb.late === true && rb.uncharted && rb.uncharted.cause === "late" && B.reads.length === 1 && B.plans === 0
              && B.reads[0].read && B.reads[0].read.late && /HTTP 502 - Could not find service/.test(rb.error),
        () => JSON.stringify({ a: ra && { e: ra.error, late: ra.late, cause: ra.uncharted && ra.uncharted.cause }, aReads: A.reads.length,
                               aPlans: A.plans, b: rb && { e: rb.error, cause: rb.uncharted && rb.uncharted.cause }, bReads: B.reads.length }));
  // 3d. the widening's read given up: one round, not three; the route's refusal by that cause
  const C = world(); C.onRead = giveUp(LATE);
  const rc = await capped(C.api.planInsideChart([at(0, 0), near], {}, () => {
    C.plans++; const route = [far, near]; return { route, uncharted: P.beyondChart([at(0, 0), ...route], box, undefined, []) };
  }, "Go-To"));
  check("3d. ... and the WIDENING's read given up is the last read: one round, not CHART_WIDEN_ROUNDS - the route refused "
        + "by that cause (`late`, cause late) after one plan",
        () => rc && rc.late === true && rc.uncharted && rc.uncharted.cause === "late" && rc.uncharted.rounds === 1
              && C.reads.length === 1 && C.plans === 1 && /could not be read along it: the console gave no answer/.test(rc.uncharted.say),
        () => JSON.stringify({ say: rc && rc.uncharted && rc.uncharted.say, cause: rc && rc.uncharted && rc.uncharted.cause,
                               rounds: rc && rc.uncharted && rc.uncharted.rounds, reads: C.reads.length, plans: C.plans }));
  // 3e. a Stop pressed while the CALLER's first read ran (before planInsideChart was called) withdraws it
  const D = world(), rdD = D.api.commandReads();
  D.api.routeStopPressed("STOP");                                   // ... during the caller's own ensureNogoCovers
  const rdd = await capped(D.api.planInsideChart([at(0, 0), near], { read: rdD }, () => { D.plans++; return { route: [near] }; }, "Go-To"));
  // ... and one pressed while planInsideChart's own read is waited on
  const E = world(); E.onRead = () => { E.api.routeStopPressed("PAUSE"); return true; };
  const re = await capped(E.api.planInsideChart([at(0, 0), far], {}, () => { E.plans++; return { route: [far] }; }, "Go-To"));
  check("3e. A STOP PRESSED WHILE THE COMMAND'S FIRST READ RAN withdraws it (its mark is the command's, taken before that read): "
        + "said, nothing planned - as one pressed during the plan's own read",
        () => rdd && rdd.withdrawn === true && !rdd.unsaid && /^Go-To withdrawn: STOP was pressed/.test(rdd.error) && D.plans === 0
              && D.banners.some((b) => /Go-To withdrawn: STOP/.test(b))
              && re && re.withdrawn === true && /PAUSE was pressed/.test(re.error) && E.plans === 0,
        () => JSON.stringify({ d: rdd, dPlans: D.plans, e: re && re.error, ePlans: E.plans }));
  // 3f. the caller's fence falling while a read is waited on: withdrawn, handed back UNSAID with what it names
  const F = world();
  let homeMoved = false;
  const rdF = F.api.commandReads(() => homeMoved ? { by: "home moved", say: "home was moved" } : null);
  F.onRead = (ask) => { homeMoved = true; ask.read.gone(); return false; };
  const rf = await capped(F.api.planInsideChart([at(0, 0), far], { read: rdF }, () => { F.plans++; return { route: [far] }; }, "RTH"));
  check("3f. ... and the caller's own press (its fence - the far RTH's) no longer standing while a read is waited on: "
        + "withdrawn, handed back UNSAID with what it names (its caller says it), nothing planned",
        () => rf && rf.withdrawn === true && rf.unsaid === true && rf.by === "home moved" && rf.error === "home was moved"
              && F.plans === 0 && !F.banners.some((b) => /withdrawn/.test(b)),
        () => JSON.stringify({ rf, plans: F.plans, banners: F.banners }));
  // 3g. the widening's read landed, but the plan's OWN water, read again after it, was given up: refused by that cause at
  //     once - not planned again over a read given up (which, on the last round, was refused for "rounds" and not late: the
  //     end-of-plan chain then FAILED where it should wait - the 2026-11-16 mutation sweep)
  const G = world(); G.onRead = (ask) => (ask.say ? true : giveUp(LATE)(ask));
  const rg = await capped(G.api.planInsideChart([at(0, 0), near], {}, () => {
    G.plans++; const route = [far, near]; return { route, uncharted: P.beyondChart([at(0, 0), ...route], box, undefined, []) };
  }, "Go-To"));
  check("3g. ... and the plan's OWN water read again after a widening, given up, refuses it at once by that cause (`late`) - "
        + "the route not planned again over it",
        () => rg && rg.late === true && rg.uncharted && rg.uncharted.cause === "late" && G.reads.length === 2 && !!G.reads[0].say
              && !G.reads[1].say && G.plans === 1 && /could not be read round the target: the console gave no answer.*unanswered in 30 min/.test(rg.error),
        () => JSON.stringify({ e: rg && rg.error, cause: rg && rg.uncharted && rg.uncharted.cause, reads: G.reads.length, plans: G.plans }));
}
