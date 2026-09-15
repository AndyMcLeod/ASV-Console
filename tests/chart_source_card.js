// tests/chart_source_card.js - the SRC card lists EVERY chart in view.
//
// WHY THIS EXISTS. The card used to name one cell and count the rest: "US5DE1EF
// +3 in view", with the other names reachable only as a hover tooltip. Andy asked
// for all of them displayed. A survey routinely spans several cells, and the one
// the vessel happens to sit in says nothing about the scale, survey dates or
// currency of the sheets it is about to work over - so the count hid exactly the
// charts the operator needed to look at.
//
// Now: one row per cell, sorted BROAD -> DETAILED by usage band (the cell name's
// 3rd character, S-57 dataset naming) then by name, with the vessel's own cell
// marked and named in words underneath.
//
// TWO CORRECTNESS FIXES CAME WITH IT, and they are the reason this suite exists
// rather than an eyeball:
//   * ONE CELL, SEVERAL POLYGONS. An ENC cell arrives as one Coverage_area feature
//     per polygon, so a folded-by-name list is the only way a cell appears once -
//     and the vessel is "inside" a cell if ANY of its polygons contains the fix.
//   * WHICH CELL IS "MINE". The old code took cells.find(...) - whichever polygon
//     the service happened to return first. Where scales overlap, a navigator is
//     bound to the LARGEST-SCALE chart, so the primary is now the most detailed
//     cell containing the vessel, not the first one seen.
//
//   node tests/chart_source_card.js      # exit 0 = pass, 1 = fail
//
// The card builds an HTML string, so these run the REAL updateChartCard body
// against a stub DOM and assert on what it wrote. TEETH (10/10 by mutation):
//     the list renders only the primary (the old "+N in view" shape)   -> 2, 3
//     cells are not folded by name (a 2-polygon cell lists twice)      -> 4
//     inside-ness OVERWRITES per polygon instead of latching           -> 5
//     the primary takes the FIRST containing cell, not the largest     -> 6
//     the sort ignores the usage band and goes alphabetical            -> 7
//     the within-band tie-break is reversed                            -> 7c
//     the per-row usage label is dropped                               -> 7b
//     the bullet legend / not-inside-any sentence is dropped           -> 8, 9
//     rows lose their data-cell key                                    -> 2, 4
//
// THREE OF THOSE CHECKS ONLY GREW TEETH ON THE SECOND ATTEMPT, and each failure was
// a scenario that could not tell the bug from the fix - the shape the dev guide
// calls out in 6.4. Recorded here because the next person writing a list-rendering
// test will reach for exactly the same three:
//   * ORDER MATTERS IN A FOLD. With the containing polygon listed SECOND, an
//     overwriting fold still ends up true. Only containing-FIRST separates "any
//     polygon counts" from "the last polygon decides" - check 5 runs both orders.
//   * US CELL NAMES CANNOT TEST A BAND SORT. Every US name starts "US", so the
//     usage digit is the 3rd character of an identical prefix and alphabetical
//     order IS band order. A Canadian sheet beside a US one splits them (check 7).
//   * A TIE-BREAK NEEDS A TIE. Three cells one-per-band never exercise the
//     within-band comparator; the four real band-5 Lewes cells do (check 7c).
//
// NOTE: this suite evaluates page code SLOPPY - a direct eval, so the page's function declarations bind into this
// file. The page itself is <script type="module">, which runs STRICT: an assignment to an undeclared name passes
// here and throws in the page. tests/page_strict.js parses the page and its modules as strict modules; that runtime
// difference is not checked anywhere.

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

// LAYER-0 HELPERS COME FROM THE REAL MODULES, not from asv.html's source text.
// These moved out of the page on 2026-08-09. Requiring them means a renamed or
// deleted export fails HERE, loudly, instead of silently reverting to a stale copy;
// and the checks below exercise the shipped function rather than an eval of its text.
// Top-level so the suite's DIRECT eval() of page functions still resolves them.
const { llEN } = require("../static/js/geodesy.js");
const { eachRing, pinp, ptInGeom } = require("../static/js/geometry.js");

// The vessel-derived parameter block moved to static/js/state.js (2026-08-09). The page
// functions eval'd below read V.NOGO_MIN_DEPTH_M / V.WRECK_RADIUS_M / ..., so the suite
// needs the SAME object the page mutates - and gets it, rather than a stub, so a check
// that leans on a vessel default is reading the real one.
const { V } = require("../static/js/state.js");

// THE REAL MODULE, not its source text lifted out of the page. A renamed or
// deleted export now fails HERE, at load, instead of quietly resolving to a stale
// copy - and the checks below exercise the function that actually ships.
const { qualityAt } = require("../static/js/chart.js");

const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try {
    ok = !!(typeof cond === "function" ? cond() : cond);
    note = typeof detail === "function" ? detail() : detail;
  } catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}

function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function grabDecl(name) {
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return H.slice(i, H.indexOf(";", i) + 1);
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}

// ---- the page's real code, with the smallest stub world that runs it ------ //
// Everything lives INSIDE the eval and a painter closure comes back out: `let`
// declared in an eval is block-scoped to that eval, so state assigned from the
// outside would be a DIFFERENT binding from the one the card reads - the first
// version of this harness painted an empty card and blamed the page for it.
let code = "const M_PER_DEG_LAT = 111320;\n"
  + "let asv = null, water = {}, nogo = {band:null}, chartBusy = false, chartLastHtml = null;\n"
  + "let center = {lat:0, lon:0};\n"
  + "const sea = {chartInfo:null, enc:{features:[]}, waterOffset:0};\n"
  + "let __body = '';\n"
  + "const NOGO_MIN_DEPTH_M = 2.3;\n"
  + "const $ = sel => sel === '#chartPanel' ? {style:{display:'block'}}\n"
  + "                : sel === '#chartBody' ? {set innerHTML(v){ __body = v; }} : null;\n";
for (const d of ["CHART_DISPLAY_UNITS", "CHART_DATA_UNITS", "CATZOC_LBL", "ENC_USAGE_LBL"])
  code += grabDecl(d) + "\n";
// ptInGeom and qualityAt are REQUIRED at the top of this file, so the sandbox is handed
// the real ones through its parameter list rather than a second copy eval'd beside them.
for (const f of ["cellName", "fmtEncDate", "updateChartCard"]) code += grab(f) + "\n";
code += "(function(cells, quality, at){\n"
      + "  asv = at; sea.chartInfo = cells === null ? null\n"
      + "        : {band:'enc_harbour', cells:cells, quality:quality||[], note:'no ENC coverage here'};\n"
      + "  chartLastHtml = null; __body = '';\n"     // the card skips an unchanged write
      + "  updateChartCard(); return __body;\n"
      + "})";
const painter = eval(code);

// A square polygon (GeoJSON lon/lat rings) around a centre, `d` degrees a side.
const sq = (lat, lon, d) => ({ type: "Polygon", coordinates: [[
  [lon - d, lat - d], [lon + d, lat - d], [lon + d, lat + d], [lon - d, lat + d], [lon - d, lat - d]]] });
const cell = (dsnm, lat, lon, d, extra) =>
  ({ props: Object.assign({ DSNM: dsnm + ".000", CATCOV: "coverage available" }, extra || {}),
     geometry: sq(lat, lon, d) });

// The vessel sits at the DriX base off Lewes.
const AT = { lat: 38.78965, lon: -75.16094 };
const paint = (cells, quality, at) => painter(cells, quality, at || { lat: AT.lat, lon: AT.lon });
// Rows are read by their data-cell key, NOT by scanning for cell names: the name
// also appears in each row's tooltip and in the legend sentence, so a bare name
// scan counts one row three times (it did, and reported a fold bug that wasn't).
const rowsOf = html => [...html.matchAll(/data-cell="([^"]+)"/g)].map(m => m[1]);
const markedOf = html => [...html.matchAll(/data-cell="([^"]+)" data-here="1"/g)].map(m => m[1]);
const uniq = a => [...new Set(a)];

console.log("Chart source card — every chart in view gets a row:");

// The four adjacent harbour cells the real Lewes extract returns, plus a coastal
// and an approach sheet overlapping the same water (broader scales).
const LEWES = [
  cell("US5DE1EF", 38.79, -75.16, 0.02),         // contains the vessel
  cell("US5DE1DF", 38.79, -75.20, 0.02),
  cell("US5DE1DG", 38.83, -75.20, 0.02),
  cell("US5DE1EG", 38.83, -75.16, 0.02),
];

// 1. the reported shape is gone
const one = paint(LEWES);
check("1. THE REPORTED SHAPE IS GONE: no '+N in view' count anywhere",
      () => !/\+\d+\s*in view/.test(one),
      () => (one.match(/\+\d+ in view/) || ["none"])[0]);

// 2/3. every cell is listed, once each
check("2. all four cells are listed, not just the vessel's",
      () => uniq(rowsOf(one)).length === 4,
      () => uniq(rowsOf(one)).join(","));
check("3. ... including the three the vessel is NOT in",
      () => ["US5DE1DF", "US5DE1DG", "US5DE1EG"].every(n => one.includes(n)));

// 4. THE FOLD: one cell delivered as several Coverage_area polygons is ONE row
const split = paint([
  cell("US5DE1EF", 38.79, -75.16, 0.02),
  cell("US5DE1EF", 38.70, -75.30, 0.01),         // same cell, a second polygon
  cell("US5DE1DF", 38.79, -75.20, 0.02),
]);
check("4. a cell arriving as SEVERAL polygons is folded to ONE row",
      () => rowsOf(split).filter(n => n === "US5DE1EF").length === 1,
      () => "rows: " + rowsOf(split).join(","));

// 5. ... and the vessel counts as inside it if ANY polygon contains the fix.
// BOTH ORDERS ARE NEEDED, and finding that out cost a surviving mutation: with the
// containing polygon listed SECOND, a fold that OVERWRITES the flag (e.here = ...)
// still lands on true and looks correct. Only the containing-FIRST case separates
// "any polygon counts" from "the last polygon decides".
const holds = (...cells) => markedOf(paint(cells)).join(",");
check("5. inside-ness survives the fold, in EITHER polygon order (any polygon counts, "
      + "not the last one seen)",
      () => holds(cell("US5DE1EF", 38.70, -75.30, 0.01),      // outside, listed first
                  cell("US5DE1EF", 38.79, -75.16, 0.02)) === "US5DE1EF"
         && holds(cell("US5DE1EF", 38.79, -75.16, 0.02),      // inside, listed first
                  cell("US5DE1EF", 38.70, -75.30, 0.01)) === "US5DE1EF",
      () => "second-holds: [" + holds(cell("US5DE1EF", 38.70, -75.30, 0.01),
                                      cell("US5DE1EF", 38.79, -75.16, 0.02))
          + "]  first-holds: [" + holds(cell("US5DE1EF", 38.79, -75.16, 0.02),
                                        cell("US5DE1EF", 38.70, -75.30, 0.01)) + "]");
check("5b. ... and the marked cell is the one the legend names",
      () => /● the vessel is on <b[^>]*>US5DE1EF<\/b>/.test(
              paint([cell("US5DE1EF", 38.79, -75.16, 0.02), cell("US5DE1DF", 38.79, -75.20, 0.02)])));

// 6. THE PRIMARY. Three overlapping scales all contain the vessel; the largest
// scale (highest usage digit) is the one a navigator is bound to. The coastal
// sheet is listed FIRST in the payload, which is what the old cells.find() took.
const OVERLAP = [
  cell("US3DE1AA", 38.79, -75.16, 0.5),          // coastal  (3) - first in the array
  cell("US5DE1EF", 38.79, -75.16, 0.02),         // harbour  (5)
  cell("US4DE1BB", 38.79, -75.16, 0.2),          // approach (4)
];
const ov = paint(OVERLAP);
check("6. the primary is the LARGEST-SCALE cell containing the vessel, not the first returned",
      () => /● the vessel is on <b[^>]*>US5DE1EF<\/b>/.test(ov),
      () => (ov.match(/the vessel is on [^(]*/) || ["?"])[0]);
check("6b. ... and it says how many cells cover the vessel when several do",
      () => ov.includes("largest scale of 3 covering it"));

// 7. sorted BROAD -> DETAILED by usage band, then by name.
// MIXED PRODUCER CODES ON PURPOSE. Every US cell name starts "US", so the usage
// digit is the 3rd character of an otherwise identical prefix - which makes a
// plain alphabetical sort produce the SAME order as a band sort, and a check built
// on US names alone cannot tell the two apart (it didn't: the alphabetical
// mutation survived it). A Canadian harbour sheet beside a US coastal one splits
// them: by band CA5 comes last, alphabetically it comes first. This is a real
// case, not a contrivance - CA and US cells overlap all over the Great Lakes.
const MIXED = [
  cell("CA5ON1AA", 38.79, -75.16, 0.02),         // harbour (5) - alphabetically FIRST
  cell("US3DE1ZZ", 38.79, -75.16, 0.5),          // coastal (3) - alphabetically LAST
];
check("7. cells sort by usage BAND (broad first), not alphabetically",
      () => rowsOf(paint(MIXED)).join(",") === "US3DE1ZZ,CA5ON1AA",
      () => rowsOf(paint(MIXED)).join(","));
// The tie-break needs cells in the SAME band or it never runs - `ov`'s three sheets
// are one per band, so reversing the tie-break survived it. The four real Lewes
// cells are all band 5, and they arrive from the service in a different order.
check("7c. ... and within one band they sort by name (the four band-5 Lewes cells)",
      () => rowsOf(one).join(",") === "US5DE1DF,US5DE1DG,US5DE1EF,US5DE1EG",
      () => rowsOf(one).join(","));
check("7b. the usage band is spelled out per row, not left as a digit",
      () => ov.includes("Coastal") && ov.includes("Approach") && ov.includes("Harbour"));

// 8/9. the marker is explained, and the vessel-outside case says so plainly
check("8. the bullet is explained in words (a bare green dot is a guess)",
      () => /● the vessel is on/.test(one));
const away = paint(LEWES, [], { lat: 10.0, lon: 10.0 });
check("9. a vessel inside NONE of the listed cells is told so, not given a false primary",
      () => away.includes("not inside any of these cells") && !/● the vessel is on/.test(away),
      () => (away.match(/the vessel is [^<]*/) || ["?"])[0]);
check("9b. ... and the cells are still all listed in that case, none of them marked",
      () => uniq(rowsOf(away)).length === 4 && markedOf(away).length === 0);

// 10. the rest of the title block still renders (this card is not just a list)
check("10. the title block survives: usage, units, datum and the ZOC section",
      () => one.includes("Usage") && one.includes("Soundings") && one.includes("Datum")
         && one.includes("At the vessel") && one.includes("Not for navigation"));
check("11. no ENC coverage still reads as a note, not an empty list",
      () => { const empty = paint([]);
              return empty.includes("no ENC coverage here") && !/charts? in view/i.test(empty); });

console.log(ran + " checks, " + fails + " failed");
process.exit(fails ? 1 : 0);
