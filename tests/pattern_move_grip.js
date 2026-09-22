// tests/pattern_move_grip.js - the survey pattern's whole-move grip must be REACHABLE.
//
// Andy reported the centre handle for moving a survey pattern as missing, and asked for it
// to be ported from the sibling console. It had been ported - completely. patMoveLL(),
// patMoveScreen(), the "M" branch of patHandleAt(), the patMoveLast delta seeding and the
// translate-every-anchor drag were all present and all worked; the hit test returned "M" at
// the midpoint and a drag moved the pattern rigidly.
//
// It was drawn, too. It was just drawn INSIDE drawPattern(), which render() calls early -
// and then render() paints the boat marker (a filled disc plus a 26 px heading line) near
// the end. The grip sits at the A-B midpoint, and the operator's normal move is to drive to
// the survey area and draw the box AROUND THE BOAT. So in the commonest case there is, a
// 6 px handle was painted over by a 6 px boat and vanished. Measured on the running page:
// ZERO grip-coloured pixels at the grip when the midpoint landed on the boat, 70 when it
// did not. Live, draggable, and invisible.
//
// A control the operator cannot see is a control they do not have. So:
//   * the grip draws LAST, above the boat, with a dark halo and an outlined label
//   * the survey hint names it, which the sibling's string did and this port's did not
//
//   node tests/pattern_move_grip.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH (verified by mutation, not assumed): put the grip drawing back inside
// drawPattern() and 5 fails. Drop the drawPatMoveGrip() call so nothing draws it after the
// boat and 6 fails. Drop the grip mention from EITHER hint string and 7 fails. Take the
// midpoint from the wrong anchor pair and 1 and 2 fail. Let the grip win a hit-test tie
// against a corner and 4 fails. Widen the "M" hit radius to 60 px and 3 fails.
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

// ASV_HTML points this at a SIDECAR copy for a mutation run - without it a sweep writes
// its mutants to a file this suite never reads and scores every one as SURVIVED (audited
// 2026-09-21: 21 of the 53 suites reading this page had no override).
const H = fs.readFileSync(process.env.ASV_HTML
                || path.join(__dirname, "..", "static", "asv.html"), "utf8");

function grab(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!cond) fails++;
}

// --- the geometry + hit test, against the real page functions ---------------
// A flat 1 px-per-unit projection keeps the arithmetic readable: the grip's placement and
// the hit radii are what is under test, not the Mercator maths.
var TILE = 256, zoom = 0, pat = { A: null, B: null, C: null };
var center = { lat: 0, lon: 0 };
function worldPx(lat, lon) { return { x: lon, y: -lat }; }
function originPx() { return { x: 0, y: 0 }; }
var mapEl = { getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; } };
// eslint-disable-next-line no-eval
eval(grab("patScreen") + "\n" + grab("patMoveLL") + "\n" +
     grab("patMoveScreen") + "\n" + grab("patHandleAt"));

console.log("Survey move grip — a handle nobody can see is a handle nobody has:");

pat.A = { lat: 100, lon: 100 };
pat.B = { lat: 200, lon: 300 };
pat.C = { lat: 400, lon: 400 };

check("1. the grip sits at the centre of the A-B rectangle",
      (m => m.lat === 150 && m.lon === 200)(patMoveLL()),
      JSON.stringify(patMoveLL()));
check("2. clicking the centre grabs the grip",
      patHandleAt(200, -150) === "M");
check("3. ... and only within its radius, so it cannot swallow open water",
      patHandleAt(200 + 20, -150) === null,
      "20 px off -> no handle");

// 4. The tie-break that keeps a small pattern editable. On a tight box the grip lands
// close to a corner, and RESHAPE must stay reachable - so a corner wins wherever both
// answer. Losing this makes the corner unpickable, which is a worse bug than the one
// this grip was added to solve.
pat.C = { lat: 150, lon: 200 };                 // C exactly on the grip
check("4. a corner handle WINS a tie with the grip",
      patHandleAt(200, -150) === "C",
      "reshape must stay reachable on a small pattern");
pat.C = { lat: 400, lon: 400 };

check("5. the grip is not drawn inside drawPattern — that is what buried it",
      grab("drawPattern").indexOf("patMoveScreen") < 0,
      "drawPattern runs early; the boat is painted later and covered it");

// 6. THE FIX ITSELF. Canvas z-order is not observable without standing up a full render
// harness, so this asserts the call ORDER in render(): the grip must be drawn after the
// boat marker.
//
// ANCHORED ON THE BOAT'S DRAW CALL, NOT ON ITS COLOUR. This used to look for
// getCSS("--asv") - the colour the marker was painted with - and went blind the day the
// marker became a vessel-coloured triangle drawn by drawVesselGlyph(), reporting "boat@-1"
// and failing for a reason that had nothing to do with z-order. A check anchored on an
// incidental detail of an implementation fails when that detail changes and passes when
// the real property breaks; the DRAW CALL is the thing this check is actually about.
const render = grab("render");
const boatAt = render.lastIndexOf("drawVesselGlyph(");
const gripAt = render.indexOf("drawPatMoveGrip(");
check("6. render() draws the grip AFTER the boat marker",
      boatAt >= 0 && gripAt >= 0 && gripAt > boatAt,
      "boat@" + boatAt + " grip@" + gripAt);

// 7. Discoverability was the other half, and the half that was actually missing from the
// port: the sibling's hint names the grip and this one's did not, so nothing on screen
// ever told the operator the handle existed.
const hints = grab("updatePatReadout");
check("7. the survey hint names the grip, before AND after the 3rd click",
      (hints.match(/centre grip|Centre grip/g) || []).length >= 2,
      (hints.match(/centre grip|Centre grip/gi) || []).length + " mention(s)");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
