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
  // she is IN an unread square (drifted there): the route out of it stands - a second square further on does not
  const U2 = [sqr(-200, -200, 200, 200), sqr(1000, -200, 1400, 200)];
  const out = P.beyondChart([at(0, 0), at(800, -600)], box, undefined, U2);
  const onward = P.beyondChart([at(0, 0), at(3000, 0)], box, undefined, U2);
  const pointsOnly = P.beyondChart([at(0, 0), at(3000, 0)], box, undefined, U, {points: true});
  check("1b. a square whose chart could not be READ is said as one (`failed`); a boat IN an unread square is not "
        + "stranded - the route out of it stands - while a second square further on is still refused; and a command's "
        + "own POINTS (`points`) are judged without the straight line between them",
        () => failed && failed.where === "unread" && failed.failed === true && out === null
              && onward && onward.where === "unread" && onward.outM > 150 && pointsOnly === null,
        () => JSON.stringify({ f: failed && failed.failed, out, onward: onward && Math.round(onward.outM), pointsOnly }));
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
      "let routeStopGen = 0, routeStopName = null;\n" + grab("planInsideChart") + "\nreturn planInsideChart;");
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
  const tips = new Function(grab("unchartedTip") + "\nreturn unchartedTip;")();
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
    const fe = new Function("sea", "fetch", grab("fetchENCBbox") + "\nreturn fetchENCBbox;")(sea, async () => ({
      json: async () => ({ band: "enc_harbour", layered: true, features: [], unread: [[1, 2, 3, 4]], unread_failed: [[5, 6, 7, 8]] }) }));
    fe({ W: 0, S: 0, E: 1, N: 1 }, 2).then(() => {
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
      console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
      process.exit(fails ? 1 : 0);
    });
  }
}
