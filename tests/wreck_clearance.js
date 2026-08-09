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
//   * a hazard with a charted sounding over it (VALSOU) that clears the vessel's own
//     navigability floor is passable and collapses back to a point - tide-corrected,
//     the same way depth areas are
//   * NO sounding means UNKNOWN, and unknown takes the full berth
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

const fs = require("fs");
const path = require("path");

// The vessel-derived parameter block moved to static/js/state.js (2026-08-09). The page
// functions eval'd below read V.NOGO_MIN_DEPTH_M / V.WRECK_RADIUS_M / ..., so the suite
// needs the SAME object the page mutates - and gets it, rather than a stub, so a check
// that leans on a vessel default is reading the real one.
const { V } = require("../static/js/state.js");


// Layer-0 helpers from the real modules (2026-08-09) rather than lifted out of the page.
const { fromEN, llEN } = require("../static/js/geodesy.js");
const { bbOf, dSeg, eachPath, eachPoint, eachRing, inBB, pinp } = require("../static/js/geometry.js");
const { sea } = require("../static/js/state.js");

// --- source lookup: the page AND its modules -----------------------------------------
// Parts of the client live in static/js/*.js now, so a name this suite lifts as SOURCE TEXT
// may be in either place. MODSRC is those modules concatenated with the `export` keyword
// stripped, which makes each declaration read exactly as it did when it sat in the page -
// so the grab helpers below need no other change.
const MODSRC = require("fs")
  .readdirSync(require("path").join(__dirname, "..", "static", "js"))
  .filter(f => f.endsWith(".js"))
  .map(f => require("fs").readFileSync(
    require("path").join(__dirname, "..", "static", "js", f), "utf8"))
  .join("\n")
  .replace(/^export /gm, "");
const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");

function grab(name) {
  const HS = H.indexOf("function " + name + "(") >= 0 ? H : MODSRC;
  const start = HS.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = HS.indexOf("{", start), depth = 0;
  for (;;) { const c = HS[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return HS.slice(start, k + 1);
}
// Pulls a module-level declaration VERBATIM (so the test uses the shipping value, not
// a copy that can drift) but rebinds it as `var`: in a sloppy direct eval only `var` and
// function declarations leak to the enclosing scope, and the assertions below need to
// read - and, for the configurable radius, temporarily set - these values.
function grabDecl(name) {
  // the page first, then the modules - same order the page itself loads them
  for (const HS of [H, MODSRC]) {
    for (const kw of ["const ", "let ", "var "]) {
      const i = HS.indexOf(kw + name + " =");
      if (i >= 0) return HS.slice(i, HS.indexOf(";", i) + 1);
    }
  }
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return "var " + H.slice(i + kw.length, H.indexOf(";", i) + 1);
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}

const HELPERS = ["blocked", "blockedInfo",
                 "legClear", "depthExcluded", "nogoKind",
                 "markId", "markSystems", "hazExtent", "buildKeepouts", "bufferFloor",
                 "stampSeg", "dilateGrid", "rasterKeepouts", "snapClearLL", "routeAround"];
const M_PER_DEG_LAT = 111320.0;

// Real declarations pulled verbatim so the test uses the SHIPPING tuning values rather
// than copies that can drift.
// eslint-disable-next-line no-eval
eval("const M_PER_DEG_LAT=" + M_PER_DEG_LAT + ";\n" +
     "V.NOGO_MIN_DEPTH_M = 2.3; V.NOGO_BUFFER_M = 5;\n" +
     "var enc={features:[],band:null,minDepth:null};\n" +
     grabDecl("HAZ_UNKNOWN_EXTENT") + "\n" +
     grabDecl("WRECK_CLEAR_MARGIN_M") + "\n" +
     HELPERS.map(grab).join("\n"));

// --- synthetic world ------------------------------------------------------- //
const ref = { lat: 38.79, lon: -75.16 };                       // the DriX's home water
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
  check("2. a wreck with charted water over it (VALSOU 4.5) collapses to a point",
        hazExtent(feat("Wreck_point", 0, 0, { VALSOU: 4.5 })) === 0);
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

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
