// tests/wreck_clearance.js - charted point-hazard EXTENT regression test.
//
// The bug this exists to prevent, found on a live Go-To out of Lewes: the planned
// track ran straight over a charted wreck.
//
// The wreck was fetched, classified and enforced correctly. The failure was that
// `blocked()` gave EVERY point keep-out a radius of exactly the nogo buffer, so a
// wrecked ship, a mooring pile and a channel buoy were the same object to the router.
// At a 3 m buffer a charted wreck was a 3 m obstacle: a route only had to miss the
// charted position by 3 m to validate clear. The nogo buffer is a CLEARANCE MARGIN and
// was being asked to double as the OBJECT'S EXTENT; it cannot do both.
//
// The contract now:
//
//   * a hazard whose extent the chart does not give (wreck, hulk, obstruction, awash
//     rock) carries an intrinsic radius, and the buffer is added ON TOP as the margin
//   * a hazard with a charted sounding over it (VALSOU) that clears the floor in force
//     by the margin is PASSABLE, and a passable hazard is DROPPED FROM THE MODEL - not
//     merely collapsed to a point. Tide-corrected, the same way depth areas are.
//   * NO sounding means UNKNOWN, and unknown takes the full berth
//
// ⚠ "COLLAPSES BACK TO A POINT" WAS NOT ENOUGH, AND THAT IS THE 2026-09-09 CHANGE.
// Andy, with a survey line cut in two beside a charted rock: *"The avoidance maneuver
// circled in red for a rock on the chart is unnecessary."* The rock carried VALSOU 8.8 m
// and the hull draws 0.12 m, so the sounding test fired and hazExtent already returned 0 -
// but the feature stayed in the model, the operator's 3 m buffer made it a dot, the dot sat
// 0.2 m off a survey line, and clipLine split a 350.4 m line into 334.5 m plus an 8.0 m
// offcut. punchOut then serviced that offcut like any other line: 77 m of track across 16
// waypoints to collect 7.8 m of coverage. hazExtent's own docstring had said the vessel
// "can pass over it" since the rule was written; it could not, because a point in this
// model still carries the buffer. Checks 13-21 are that fix and its controls.
//   * genuinely point-sized objects (piles, buoys, beacons) are UNCHANGED - the fix
//     must not inflate every mark on the chart
//   * BOTH clearance paths honour it: the exact `legClear` check AND the A* occupancy
//     raster. If only the exact check knew, the search would plan through the wreck and
//     the leg would simply fail instead of routing around
//
//   node tests/wreck_clearance.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH (verified by mutation, not assumed): revert blocked() to a bare `buf` radius and
// 4, 5, 6 and 12 fail. Revert the raster to a single-cell stamp and 9 fails. Drop the
// VALSOU branch and 2 and 10 fail. Give every hazard class an extent and 1 and 8 fail.
// Remove the bufferFloor() clamp and 11 fails.
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
// check() turns a throw inside its own thunk into a failed check. Scenario SETUP is not
// inside one - building a world, eval-ing page code, awaiting a fetch - and a throw there
// would kill the process before a single FAIL line printed. "No FAIL lines" and "the
// process died" are indistinguishable to anything reading stdout, so a mutation that
// crashes this suite would score as SURVIVED. Report it instead, in the normal format.
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

// The vessel-derived parameter block moved to static/js/state.js (2026-08-09). The page
// functions eval'd below read V.NOGO_MIN_DEPTH_M / V.WRECK_RADIUS_M / ..., so the suite
// needs the SAME object the page mutates - and gets it, rather than a stub, so a check
// that leans on a vessel default is reading the real one.
const { V } = require("../static/js/state.js");


// Layer-0 helpers from the real modules (2026-08-09) rather than lifted out of the page.
const { fromEN, llEN, planeFrame } = require("../static/js/geodesy.js");
const { bbOf, dSeg, eachPath, eachPoint, eachRing, inBB, pinp } = require("../static/js/geometry.js");
const { sea } = require("../static/js/state.js");

// THE REAL MODULE, not its source text lifted out of the page. A renamed or
// deleted export now fails HERE, at load, instead of quietly resolving to a stale
// copy - and the checks below exercise the function that actually ships.
const { HAZ_UNKNOWN_EXTENT, WRECK_CLEAR_MARGIN_M, blocked, blockedInfo, bufferFloor, buildKeepouts, depthExcluded, hazExtent, hazPassable, legClear, markId, markSystems, nogoDR, nogoKind, snapClearLL } = require("../static/js/chart.js");

// THE REAL MODULE, not its source text lifted out of the page. A renamed or
// deleted export now fails HERE, at load, instead of quietly resolving to a stale
// copy - and the checks below exercise the function that actually ships.
const { dilateGrid, rasterKeepouts, routeAround, stampSeg } = require("../static/js/passage.js");
const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");

function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
// Pulls a module-level declaration VERBATIM (so the test uses the shipping value, not
// a copy that can drift) but rebinds it as `var`: in a sloppy direct eval only `var` and
// function declarations leak to the enclosing scope, and the assertions below need to
// read - and, for the configurable radius, temporarily set - these values.
function grabDecl(name) {
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return "var " + H.slice(i + kw.length, H.indexOf(";", i) + 1);
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}

const HELPERS = ["clipLine"];
const M_PER_DEG_LAT = 111320.0;

// Real declarations pulled verbatim so the test uses the SHIPPING tuning values rather
// than copies that can drift.
// eslint-disable-next-line no-eval
eval("const M_PER_DEG_LAT=" + M_PER_DEG_LAT + ";\n" +
     "V.NOGO_MIN_DEPTH_M = 2.3; V.NOGO_BUFFER_M = 5;\n" +
     // HAZ_UNKNOWN_EXTENT and WRECK_CLEAR_MARGIN_M are REQUIRED from chart.js above, so
     // this direct eval reaches the real values through the enclosing scope rather than a
     // second copy parsed back out of the source.
     "var enc={features:[],band:null,minDepth:null};\n" +
     HELPERS.map(grab).join("\n"));

// --- synthetic world ------------------------------------------------------- //
// A FRAME, not a bare point -- buildKeepouts converts through `frame.toEN` now. It still
// carries lat/lon, so ref.lat below and the llEN/fromEN calls are untouched.
const ref = planeFrame({ lat: 38.79, lon: -75.16 });           // the DriX's home water
const cosr = Math.cos(ref.lat * Math.PI / 180);
const enLL = (e, n) => ({ lat: ref.lat + n / M_PER_DEG_LAT, lon: ref.lon + e / (M_PER_DEG_LAT * cosr) });
const ENF = { land: true, depth: true, haz: true, area: false };
const DR = { min: 2.3, max: 0 };

// One charted point feature, in the shape the ENC extract produces.
function feat(cls, e, n, props) {
  const p = enLL(e, n);
  return { role: cls.endsWith("_area") ? "hazard_area" : "hazard_point", cls,
           props: props || {}, geometry: { type: "Point", coordinates: [p.lon, p.lat] } };
}
const ko = (feats) => buildKeepouts(ref, ENF, DR, feats);

// --- assertions ------------------------------------------------------------ //
let fails = 0;
function check(name, cond, detail) {
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!cond) fails++;
}
const near = (x, y, tol) => Math.abs(x - y) <= tol;

console.log("Charted point-hazard extent — a wreck is a POSITION, not a 3 m dot:");

// 1-3. EXTENT CLASSIFICATION.
{
  const wreck = feat("Wreck_point", 0, 0);
  const pile = feat("Pile_point", 0, 0);
  check("1. an unsurveyed wreck carries the configured radius, a pile carries none",
        hazExtent(wreck) === V.WRECK_RADIUS_M && hazExtent(pile) === 0,
        "wreck=" + hazExtent(wreck) + " m, pile=" + hazExtent(pile) + " m");
  // V.NOGO_MIN_DEPTH_M is 2.3 here (2.0 m draft + 0.3 UKC) and the clear margin is 1.0.
  check("2. a wreck with charted water over it (VALSOU 4.5) carries no extent",
        hazExtent(feat("Wreck_point", 0, 0, { VALSOU: 4.5 })) === 0,
        "no EXTENT is only half of it - check 13 is whether it is in the model at all");
  check("3. ... but a SHALLOW charted wreck (VALSOU 2.5) keeps the full berth",
        hazExtent(feat("Wreck_point", 0, 0, { VALSOU: 2.5 })) === V.WRECK_RADIUS_M,
        "2.5 m over it vs a 2.3 m floor + 1.0 margin");
}

// 4-6. THE REPORTED BUG. A leg passing close to a charted wreck must be refused. At the
// old buffer-only radius every one of these validated CLEAR.
{
  const K = ko([feat("Wreck_point", 0, 0)]);
  const BUF = 3;
  check("4. a point 10 m from the wreck is blocked (was clear at a 3 m buffer)",
        blocked({ e: 10, n: 0 }, K, BUF) === true);
  check("5. a point 40 m away is still inside the berth; 80 m is outside",
        blocked({ e: 40, n: 0 }, K, BUF) === true && blocked({ e: 80, n: 0 }, K, BUF) === false,
        "radius = extent " + V.WRECK_RADIUS_M + " + buffer " + BUF);
  // The headline: a straight leg threading 10 m past the wreck.
  const A = enLL(-300, 10), B = enLL(300, 10);
  check("6. A STRAIGHT LEG PASSING 10 m FROM THE WRECK IS REFUSED",
        legClear(A, B, ref, K, BUF) === false);
  const far = legClear(enLL(-300, 300), enLL(300, 300), ref, K, BUF);
  check("7. ... and a leg well clear of it still passes (the fix is not a blanket block)",
        far === true);
}

// 8. Genuinely point-sized objects are UNCHANGED - a pile keeps the plain buffer, so
// the console did not just make every charted mark enormous.
{
  const K = ko([feat("Pile_point", 0, 0)]);
  check("8. a pile is still buffer-sized only (2 m blocked, 10 m clear)",
        blocked({ e: 2, n: 0 }, K, 3) === true && blocked({ e: 10, n: 0 }, K, 3) === false);
}

// 9. THE A* RASTER must see the same disc. If only the exact check knew about the
// extent, the search would plan straight through the wreck and the leg would fail
// rather than route around it.
{
  const K = ko([feat("Wreck_point", 0, 0)]);
  const BUF = 3;
  const route = routeAround(enLL(-300, 0), enLL(300, 0), ref, K, BUF);
  let ok = !!route && route.length > 0, minD = Infinity;
  if (route) {
    const pts = [enLL(-300, 0), ...route, enLL(300, 0)];
    for (let i = 1; i < pts.length; i++) {          // sample each leg, not just vertices
      const a = llEN(pts[i-1].lat, pts[i-1].lon, ref), b = llEN(pts[i].lat, pts[i].lon, ref);
      const n = Math.max(1, Math.ceil(Math.hypot(b.e-a.e, b.n-a.n) / 2));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        minD = Math.min(minD, Math.hypot(a.e + (b.e-a.e)*t, a.n + (b.n-a.n)*t));
      }
    }
    ok = ok && minD >= V.WRECK_RADIUS_M;
  }
  check("9. the A* search ROUTES AROUND the wreck rather than through it",
        ok, route ? ("closest approach " + minD.toFixed(1) + " m, want >= " + V.WRECK_RADIUS_M)
                  : "no route returned");
}

// 10. Tide correction. VALSOU is charted to datum; the live water level is added, the
// same way depth areas are corrected. A wreck marginal at datum clears on a high tide.
{
  const marginal = feat("Wreck_point", 0, 0, { VALSOU: 3.0 });   // floor 2.3 + margin 1.0 = 3.3
  const atDatum = hazExtent(marginal);
  sea.waterOffset = 1.16;                                            // the tide in the report
  const atTide = hazExtent(marginal);
  sea.waterOffset = 0;
  check("10. VALSOU is tide-corrected (blocked at datum, passable at +1.16 m)",
        atDatum === V.WRECK_RADIUS_M && atTide === 0,
        "datum=" + atDatum + " m, +1.16 m=" + atTide + " m");
}

// 11. THE SECOND HALF OF THE BUG. A persisted mission carried a 3 m buffer - a smaller
// boat's value - and silently applied it to a 2 m-draft vessel whose own file demands
// 5 m. The vessel's buffer is a floor the mission may raise but never undercut.
{
  check("11. the vessel's nogo buffer is a FLOOR a stale mission cannot undercut",
        bufferFloor(3) === 5 && bufferFloor(8) === 8 && bufferFloor(undefined) === 5,
        "vessel 5 m: mission 3 -> " + bufferFloor(3) + ", mission 8 -> " + bufferFloor(8) +
        ", none -> " + bufferFloor(undefined));
}

// 12. The radius is vessel-configurable (planning.wreck_radius_m), so a vessel that
// works a wreck-strewn area can widen it without a code change.
{
  const saved = V.WRECK_RADIUS_M;
  V.WRECK_RADIUS_M = 120;
  const K = ko([feat("Wreck_point", 0, 0)]);
  const wide = blocked({ e: 100, n: 0 }, K, 3) === true;
  V.WRECK_RADIUS_M = saved;
  const K2 = ko([feat("Wreck_point", 0, 0)]);
  check("12. the radius is vessel-configurable, and reverts with the setting",
        wide && blocked({ e: 100, n: 0 }, K2, 3) === false,
        "at 120 m: 100 m blocked; back at " + saved + " m: 100 m clear");
}


// ── 13-14. THE REPORTED CASE: PASSABLE MEANS OUT OF THE MODEL ─────────────────────────
// ⚠ DRIVEN THROUGH buildKeepouts AND THE PAGE'S OWN clipLine, because the whole defect was
// that a function returning the right number (hazExtent = 0) sat beside a model that kept
// the feature anyway. Asking hazExtent again would have agreed with the bug.
{
  const K = ko([feat("Wreck_point", 0, 0, { VALSOU: 4.5 })]);
  const over = legClear(enLL(-300, 0), enLL(300, 0), ref, K, 3);
  check("13. THE REPORTED CASE: a wreck the chart proves passable is not in the model at all",
        K.points.length === 0 && K.passed === 1
        && blocked({ e: 0, n: 0 }, K, 3) === false && over === true,
        K.points.length + " keep-out point(s), " + K.passed + " passed over; a leg straight " +
        "over it is " + (over ? "clear" : "REFUSED") + ". At extent 0 it was still a " +
        "buffer-sized dot, which is what cut the line");

  // The defect itself, in the units it was reported in: a 350 m survey line over the hazard.
  const A = enLL(-175, 0), B = enLL(175, 0);
  const runs = (K2) => clipLine(A, B, ref, K2, 3).map(s => Math.round(
      Math.hypot((s[1].lon - s[0].lon) * M_PER_DEG_LAT * cosr,
                 (s[1].lat - s[0].lat) * M_PER_DEG_LAT)));
  const whole = runs(ko([feat("Underwater_Awash_Rock_point", 0, 0, { VALSOU: 8.8 })]));
  const cut   = runs(ko([feat("Underwater_Awash_Rock_point", 0, 0, {})]));
  check("14. ... and THAT is what stops it cutting a survey line in two",
        whole.length === 1 && whole[0] >= 348
        && cut.length >= 1 && cut[0] < 300,
        "with a charted 8.8 m over it the 350 m line survives as " + JSON.stringify(whole) +
        " m; with NO sounding charted the same line clips to " + JSON.stringify(cut) + " m");
}

// ── 15-17. THE CONTROLS. Every one of these must still be a keep-out. ─────────────────
{
  const blind = feat("Wreck_point", 0, 0, {});
  const shallow = feat("Wreck_point", 0, 0, { VALSOU: 2.5 });   // floor 2.3 + margin 1.0 = 3.3
  const Kb = ko([blind]), Ks = ko([shallow]);
  check("15. CONTROL: no charted sounding is not a pass - unknown keeps the full berth",
        hazPassable(blind) === false && Kb.points.length === 1 && Kb.passed === 0
        && Kb.points[0].r === V.WRECK_RADIUS_M
        && legClear(enLL(-300, 0), enLL(300, 0), ref, Kb, 3) === false,
        "absent VALSOU is UNKNOWN, and the whole point of the assumed radius is that " +
        "unknown is the conservative case");
  check("16. CONTROL: a sounding that does NOT clear the floor is not a pass either",
        hazPassable(shallow) === false && Ks.points.length === 1 && Ks.passed === 0
        && Ks.points[0].r === V.WRECK_RADIUS_M,
        "2.5 m over it against a 2.3 m floor + a 1.0 m margin - it has to beat the floor " +
        "by the margin, so this is never decided at the water's edge");
  const pile = feat("Pile_point", 0, 0, { VALSOU: 99 });
  const Kp = ko([pile]);
  check("17. CONTROL: a pile is never passable, whatever sounding is charted on it",
        hazPassable(pile) === false && Kp.points.length === 1 && Kp.passed === 0
        && blocked({ e: 2, n: 0 }, Kp, 3) === true,
        "a pile, buoy, beacon or mooring point is an obstruction AT THE SURFACE - none of " +
        "them is in HAZ_UNKNOWN_EXTENT, so none of them ever reaches the sounding test");
}

// ── 18. THE RASTER SEES THE SAME MODEL ────────────────────────────────────────────────
// If only the exact check knew, the A* search would still swing round something the leg
// check allows - which is the mirror image of the fault check 9 exists for.
{
  const K = ko([feat("Wreck_point", 0, 0, { VALSOU: 4.5 })]);
  const route = routeAround(enLL(-300, 0), enLL(300, 0), ref, K, 3);
  let minD = Infinity;
  const pts = [enLL(-300, 0), ...(route || []), enLL(300, 0)];
  for (let i = 1; i < pts.length; i++) {
    const a = llEN(pts[i-1].lat, pts[i-1].lon, ref), b2 = llEN(pts[i].lat, pts[i].lon, ref);
    const n = Math.max(1, Math.ceil(Math.hypot(b2.e-a.e, b2.n-a.n) / 2));
    for (let k = 0; k <= n; k++) { const t = k / n;
      minD = Math.min(minD, Math.hypot(a.e + (b2.e-a.e)*t, a.n + (b2.n-a.n)*t)); }
  }
  check("18. the A* raster drops it too - the search does not swing round a passable hazard",
        minD < 5,
        "closest approach " + minD.toFixed(1) + " m; check 9 wants >= " +
        V.WRECK_RADIUS_M + " m for the UNSOUNDED wreck, and this wants the opposite");
}

// ── 19. TIDE, ON THE DROP AND NOT ONLY ON THE EXTENT ──────────────────────────────────
{
  const marginal = feat("Wreck_point", 0, 0, { VALSOU: 3.0 });   // floor 2.3 + 1.0 = 3.3
  const atDatum = ko([marginal]);
  sea.waterOffset = 1.16;
  const atTide = ko([marginal]);
  sea.waterOffset = 0;
  check("19. the DROP is tide-corrected, not just the extent",
        atDatum.points.length === 1 && atDatum.passed === 0
        && atTide.points.length === 0 && atTide.passed === 1,
        "at datum it is in the model; at +1.16 m it is not - and on a falling tide it " +
        "comes back, which is the direction that matters");
}

// ── 20-21. SAYING SO, AND AT WHICH FLOOR ──────────────────────────────────────────────
// ⚠ THE READOUT IS DRIVEN, NOT GREPPED. A model that removes something the chart draws has
// to account for it somewhere the operator can find, and `if(false)` in front of the
// sentence would leave every string a source check looks for exactly where it was.
{
  const RO = grab("nogoReadout");
  const nogo = { band: "enc_harbour", busy: false, ko: { passed: 3 } };
  const chartInk = { lines: [], areas: [], note: null };
  const nogoKindCounts = () => ({ land: 40, "a charted hazard": 7 });
  // eslint-disable-next-line no-eval
  const readout = eval("(" + RO + ")");
  const said = readout().title;
  nogo.ko.passed = 0;
  const silent = readout().title;
  check("20. the model accounts for what it dropped, where the operator can find it",
        /Passed over: 3 charted hazards/.test(said) && /clears 2\.3 m by 1 m/.test(said)
        && /chart carries a sounding/.test(said) && /live water level/.test(said)
        && /Still DRAWN on the chart/.test(said) && /no charted sounding is unknown/.test(said)
        && !/Passed over/.test(silent),
        "with 3 dropped the Nogo row's tooltip says so, and says the AUTHORITY (the chart's " +
        "own sounding, tide-corrected) rather than only the arithmetic; with none it says " +
        "nothing at all rather than \"0 hazards\"");

  // ⚠ AND THE FLOOR IS THE EFFECTIVE ONE. Two floors used to reach one model build - the
  // depth areas filtered at the deeper of the hull's limit and the operator's Min depth,
  // the hazard rule at the hull's alone. A test that REMOVES a keep-out must never be
  // judged at a shallower floor than the water around it.
  const marginal = feat("Wreck_point", 0, 0, { VALSOU: 3.5 });   // hull 2.3 + 1.0 = 3.3
  const atHull = hazPassable(marginal);
  V.OPER_MIN_DEPTH_M = 4.0;                                      // operator asks 4 m -> 5.0
  const atOper = hazPassable(marginal);
  const K = buildKeepouts(ref, ENF, { min: 4.0, max: 0 }, [marginal]);
  delete V.OPER_MIN_DEPTH_M;
  check("21. the rule is judged at the EFFECTIVE floor, not the hull's alone",
        atHull === true && atOper === false && K.points.length === 1 && K.passed === 0,
        "3.5 m over it passes the hull's 2.3 m floor but not an operator asking for 4 m - " +
        "and the operator's number is the one the rest of the model was built at");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
