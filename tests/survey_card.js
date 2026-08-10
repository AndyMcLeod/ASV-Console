// tests/survey_card.js - the survey card must keep describing a COMMITTED plan.
//
// Andy's report: the survey card's information goes blank once the plan is committed and
// uploaded. It did. `Add to plan` moves the lines into the mission and calls
// resetPattern(), which drops the three anchors - and every figure on the card was derived
// from those anchors alone. Spacing, direction, line length, width and count all blanked
// at exactly the moment the operator most wanted to check them: just before Upload.
//
// The plan is still there. The chart still draws it. Only the card forgot.
//
// The fix DERIVES the figures from `mission.lines` rather than remembering them:
//
//   * a remembered snapshot is one more value that can drift from the plan, and this
//     repo has paid for that shape repeatedly (see the completion-field bug)
//   * it survives a page refresh for free, because the mission itself persists
//   * it follows a plan edited in WPT mode, so the card describes what the plan IS
//     rather than what was once typed
//
// And it is SELF-VALIDATING rather than trusting `planKind`, which is not persisted and
// resets to "survey" on refresh - which would have described a committed SEARCH as a
// survey with meaningless spacing. A pattern is reported only if the lines really are
// parallel.
//
//   node tests/survey_card.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH (verified by mutation, not assumed): restore the original blanking - report
// nothing once the anchors are gone - and 1 fails loudly (the suite then cannot continue,
// which is the point). Drop the parallel test and 8 fails. Use the FIRST line's length
// instead of the longest and 5 fails. Compute width as spacing x (n-1) from the first pair
// instead of the real extent and 7 fails. Key the whole thing off `planKind` again and
// 9 fails.
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy.

const fs = require("fs");
const path = require("path");

// Layer-0 helpers come from the real modules now (2026-08-09), not lifted out of
// asv.html as source text: a renamed or deleted export fails HERE instead of quietly
// falling back to a stale copy. Top-level, so the DIRECT eval() below still resolves
// them through its lexical scope.
const { llEN } = require("../static/js/geodesy.js");

const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");

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

var M_PER_DEG_LAT = 111320;
var mission = { lines: [] }, planKind = "survey";
// eslint-disable-next-line no-eval
eval(grab("committedPatternInfo"));

// Build a committed boustrophedon at a real latitude: `n` lines of `len` m running due
// north/south, `sp` m apart, alternating end for end exactly as the real plan does.
const LAT0 = 38.7896, LON0 = -75.1609;
const mPerLon = M_PER_DEG_LAT * Math.cos(LAT0 * Math.PI / 180);
const at = (e, n) => ({ lat: LAT0 + n / M_PER_DEG_LAT, lon: LON0 + e / mPerLon });
function boustro(n, len, sp) {
  const L = [];
  for (let i = 0; i < n; i++) {
    const e = i * sp, a = at(e, 0), b = at(e, len);
    L.push(i % 2 ? { a: b, b: a } : { a, b });     // alternate direction, as a real plan does
  }
  return L;
}
const info = over => { mission = { lines: over }; return committedPatternInfo(); };

console.log("Survey card — a committed plan is still a plan, and the card must say so:");

// 1-5. THE REPORTED CASE. A committed plan produces figures, and they are the plan's.
const p = info(boustro(6, 400, 25));
check("1. THE REPORTED CASE: a committed plan still reports figures",
      p !== null, "was null -> the card blanked");
check("2. ... the line count",
      p.count === 6, "count=" + p.count);
check("3. ... the spacing",
      Math.abs(p.spacing - 25) < 0.5, "spacing=" + p.spacing.toFixed(2));
check("4. ... the line direction",
      Math.abs(p.direction - 0) < 0.5 || Math.abs(p.direction - 360) < 0.5,
      "direction=" + p.direction.toFixed(2));

// 5. Clipped plans have SHORT lines at the ends. Quoting the first line would understate
// a survey whose first line happens to clip against the shore - the uncommitted readout
// quotes the pattern's full leg, so this must too.
const clipped = boustro(5, 400, 25);
clipped[0] = { a: clipped[0].a, b: at(0, 90) };    // first line clipped to 90 m
check("5. line length is the LONGEST line, not the first",
      Math.abs(info(clipped).legLength - 400) < 1,
      "legLength=" + info(clipped).legLength.toFixed(1));

// 6-7. Width is the real extent across the plan, so an unevenly spaced plan - one edited
// in WPT mode - is still described truthfully rather than by an assumed arithmetic.
check("6. width is the across-plan extent",
      Math.abs(info(boustro(6, 400, 25)).width - 125) < 0.5,
      "width=" + info(boustro(6, 400, 25)).width.toFixed(1) + " (5 gaps x 25)");
const uneven = boustro(3, 400, 25);
uneven[2] = { a: at(200, 400), b: at(200, 0) };    // last line moved far out
check("7. ... measured, not assumed, so an EDITED plan stays honest",
      Math.abs(info(uneven).width - 200) < 0.5,
      "width=" + info(uneven).width.toFixed(1) + " (first-pair arithmetic would say 50)");

// 8. SELF-VALIDATION. An expanding-box or sector search has non-parallel legs; quoting a
// spacing and a direction for it would be arithmetic with no meaning. The check is
// geometric, so it does not depend on a flag that a page refresh resets.
const box = [
  { a: at(0, 0),     b: at(100, 0) },
  { a: at(100, 0),   b: at(100, 100) },            // 90 deg to the first
  { a: at(100, 100), b: at(-50, 100) },
];
check("8. a non-parallel pattern (search box) reports NOTHING",
      info(box) === null, "no meaningless spacing/direction");
check("9. ... and a parallel one is reported whatever `planKind` says",
      (planKind = "search", info(boustro(4, 300, 20)) !== null),
      "parallel-track lanes have a real spacing; the geometry decides, not the flag");
planKind = "survey";

// 10. Degrade safely. The card's update path runs on every state frame; throwing in it
// would take the whole survey panel down with it.
check("10. an empty or degenerate plan degrades, it does not throw",
      (() => { try {
        return info([]) === null
            && info([{ a: at(0, 0), b: at(0, 0) }]) === null      // zero-length line
            && (mission = {}, committedPatternInfo() === null);   // no lines key at all
      } catch (e) { return false; } })());

// 11. A single committed line is a legitimate plan - report what CAN be known and leave
// the rest null, rather than refusing the whole readout.
const one = info([{ a: at(0, 0), b: at(0, 250) }]);
check("11. a single-line plan reports length and count, and no spacing",
      one && one.count === 1 && Math.abs(one.legLength - 250) < 1
          && one.spacing === null && one.width === null,
      one ? "len=" + one.legLength.toFixed(0) + " spacing=" + one.spacing : "null");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
