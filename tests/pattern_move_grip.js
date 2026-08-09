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
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy.

const fs = require("fs");
const path = require("path");

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
  let start = HS.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (HS.slice(start - 6, start) === "async ") start -= 6;
  let k = HS.indexOf("{", start), depth = 0;
  for (;;) { const c = HS[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return HS.slice(start, k + 1);
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
// boat marker. getCSS("--asv") is the boat's own colour and anchors that block.
const render = grab("render");
const boatAt = render.lastIndexOf('getCSS("--asv")');
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
