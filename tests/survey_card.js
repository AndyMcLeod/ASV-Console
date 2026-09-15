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
// TEETH for the CAP checks (18-28), verified by mutation 2026-08-18: adopt WorldView's
// `capped: count >= MAX` and 20 fails (it fires at exactly MAX, where nothing was dropped
// and the box IS covered). Set `capped: false` - the silent clamp, restored - and 21 fails.
// Keep the flag but drop the card warning and 25 fails. Print a bare count instead of
// "600 of 1000" and 28 fails. Leave the hint faint - the right words in the grey nobody
// reads - and 29 fails. Never clear the colour, so amber sticks after the operator widens
// the spacing, and 30 fails. Put the drag hint ahead of the warning and 25 + 29 fail.
//
// TEETH (verified by mutation, not assumed): restore the original blanking - report
// nothing once the anchors are gone - and 1 fails loudly (the suite then cannot continue,
// which is the point). Drop the parallel test and 8 fails. Use the FIRST line's length
// instead of the longest and 5 fails. Compute width as spacing x (n-1) from the first pair
// instead of the real extent and 7 fails. Key the whole thing off `planKind` again and
// 9 fails.
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

// Layer-0 helpers come from the real modules now (2026-08-09), not lifted out of
// asv.html as source text: a renamed or deleted export fails HERE instead of quietly
// falling back to a stale copy. Top-level, so the DIRECT eval() below still resolves
// them through its lexical scope.
const { llEN } = require("../static/js/geodesy.js");

const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8")
  .split("\r\n").join("\n");        // see grab() -- bounded regexes count characters

// LINE ENDINGS ARE NORMALISED HERE, AND THAT IS NOT COSMETIC. Several checks below
// regex the grabbed source with a BOUNDED window -- `[\s\S]{0,600}` and friends -- to
// say "these two things are near each other". A CRLF checkout adds one character per
// line, and check 29's window spans ~14 lines: measured 605 chars on LF and 614 on
// CRLF, against a bound of 600. So the check passed for whoever wrote it and failed on
// a fresh Windows checkout, for a reason that has nothing to do with the code it tests.
// `.gitattributes` leaves .html/.js to core.autocrlf, which is `true` here.
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
// committedPatternInfo counts DRAWN lines (review #18): the page's own numbering with it, not a stub
const __decl = (re) => { const m = H.match(re); if (!m) throw new Error("test setup: " + re + " not found"); return "var " + m[0].replace(/^(const|let) /, ""); };
eval([__decl(/^const LINE_PART_OFFSET_M = [^;]*;/m), __decl(/^let _drawnLines = [^;]*;/m), grab("lineSetKey"),
      grab("linePartContinues"), grab("drawnLines"), grab("lineNo"), grab("lineCount"),
      grab("committedPatternInfo")].join("\n"));

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

// --- 12-17: the per-vessel MINIMUM SURVEY LINE ---------------------------------------- //
// Andy, 2026-08-10: "short survey lines are inefficient and unnecessary for vessels the
// size of DriX. For the [small-class boat] this would be fine... If a generated plan has
// lines or line segments of less than 80m cut them out of the plan and jump straight to
// the next waypoint. This applies only to surveys."
// (The brackets mark a substitution: the original named the boat this derivative is
// sanitized from. Marked rather than silently reworded — altering a quotation without
// saying so is worse than either keeping it or dropping the quote marks.)
// A line costs two turns whatever its length, so
// the threshold is a property of the HULL - which is why it is vessel configuration
// (planning.min_survey_line_m) and not a constant in the page.
//
// THE MEASUREMENT THAT MATTERS: length AS RUN. shortenSeg takes the turn margin off both
// ends before the comparison, so a 100 m line at 30 m spacing is judged on the 70 m the
// boat actually surveys, not the 100 m that was drawn.
{
  const { distTo } = require("../static/js/geodesy.js");
  const { V } = require("../static/js/state.js");
  // THE REAL SHORTENER, and it is a MODULE now (2026-08-20) rather than page text
  // lifted and eval'd -- a rename fails at load instead of resolving to a stale copy.
  const { shortenSeg } = require("../static/js/turns.js");

  const LAT0 = 38.7896, LON0 = -75.1609;
  const mPerLon = M_PER_DEG_LAT * Math.cos(LAT0 * Math.PI / 180);
  const at = (e, n) => ({ lat: LAT0 + n / M_PER_DEG_LAT, lon: LON0 + e / mPerLon });
  // RUN THE SHIPPED LINES, DO NOT PARAPHRASE THEM. The first version of this block
  // reimplemented the filter in the harness; every behavioural mutation of the page then
  // SURVIVED, because the checks were grading a copy. (Same trap as measure_tool 15b: a
  // check on a mechanism has to execute the mechanism.) So the statements are lifted from
  // punchOut verbatim and eval'd with the harness supplying their inputs - mutate the
  // page and these fail, which is the whole point.
  const PUNCH_SRC = (() => {
    const a = H.indexOf("const minLine = V.MIN_SURVEY_LINE_M");
    const b = H.indexOf("const nShort = shortened.length - patClip.length;");
    if (a < 0 || b < 0) throw new Error("test setup: the min-line block moved or was renamed");
    return H.slice(a, b + "const nShort = shortened.length - patClip.length;".length);
  })();
  const punch = (rawLensM, turnMargin, minSetting) => {
    const ro = { ordered: rawLensM.map((L, i) => [at(i * 40, 0), at(i * 40, L)]) };
    const prev = V.MIN_SURVEY_LINE_M;
    V.MIN_SURVEY_LINE_M = minSetting;              // the value a vessel file would supply
    let patClip = null, nShort = 0;
    try {
      // eslint-disable-next-line no-eval
      const out = eval("(function(ro, turnMargin, V, distTo, shortenSeg){ let patClip;\n"
                       + PUNCH_SRC + "\n return {patClip, nShort}; })")
                  (ro, turnMargin, V, distTo, shortenSeg);
      patClip = out.patClip; nShort = out.nShort;
    } finally { V.MIN_SURVEY_LINE_M = prev; }
    return { kept: patClip, dropped: nShort,
             lens: patClip.map(s => Math.round(distTo(s[0], s[1]))) };
  };

  // 12. THE ACCEPTANCE HALF, first: a threshold that keeps the long lines is the whole
  // point. A filter that dropped everything would pass a refusal-only check.
  const r12 = punch([300, 300, 300], 2, 80);
  check("12. lines comfortably over the minimum are ALL kept",
        r12.kept.length === 3 && r12.dropped === 0,
        "kept " + r12.lens.join(",") + " m");

  // 13. ... and the refusal half: the short ones go, the long ones stay, in one plan.
  const r13 = punch([300, 40, 300, 60], 2, 80);
  check("13. lines under the minimum are dropped, longer ones survive the same punch",
        r13.kept.length === 2 && r13.dropped === 2 && r13.lens.every(l => l > 80),
        "kept " + r13.lens.join(",") + " m, dropped " + r13.dropped);

  // 14. MEASURED AS RUN. A 100 m line at a 15 m turn margin runs as 70 m: under an 80 m
  // minimum it must go, even though it was drawn longer than the threshold.
  const r14 = punch([100], 15, 80);
  check("14. the length compared is AS RUN (after the turn margin), not as drawn",
        r14.kept.length === 0 && r14.dropped === 1,
        "100 m drawn − 2×15 m margin = 70 m run, under the 80 m minimum");

  // 15. ZERO MEANS KEEP EVERYTHING - the small-class case, and the default for any vessel
  // file that says nothing. Andy: "For the [small-class boat] this would be fine."
  const r15 = punch([300, 40, 300, 12], 2, 0);
  check("15. a minimum of 0 keeps every line - the small-class / legacy-file behaviour",
        r15.kept.length === 4 && r15.dropped === 0,
        "kept " + r15.lens.join(",") + " m");

  // 16. The threshold reaches the page THROUGH V, and the page reads it from the vessel
  // block - never a literal. A hardcoded 80 would be correct for the DriX and wrong for
  // every other hull, which is precisely the bug this is shaped to prevent.
  check("16. punchOut takes the minimum from V, not from a constant in the page",
        /const minLine\s*=\s*V\.MIN_SURVEY_LINE_M/.test(H)
          && /V\.MIN_SURVEY_LINE_M\s*=\s*\(v\.planning/.test(H),
        "must read V.MIN_SURVEY_LINE_M, itself set from v.planning.min_survey_line_m");
  check("16b. ... and V carries a 0 default, so a vessel file that omits it is unchanged",
        V.MIN_SURVEY_LINE_M === 0,
        "state.js default = " + V.MIN_SURVEY_LINE_M);

  // 17. NEVER SILENTLY. Dropping coverage the operator drew has to be said out loud, with
  // the count and the threshold - otherwise a thin survey reads as a chart fault.
  check("17. the punch-out readout reports how many lines were dropped, and the threshold",
        /nShort\s*\?\s*`,\s*\$\{nShort\}\s*line\(s\) under \$\{minLine\} m dropped/.test(H),
        "the hint must name both the count and the minimum");

  // 17b. The three shipped hulls state their own value: the DriX at Andy's 80 m, the
  // small-class boat explicitly 0 (short lines are what it is for), the example between.
  const vess = f => JSON.parse(fs.readFileSync(path.join(__dirname, "..", "vessels", f), "utf8"));
  const drix = vess("drix08.json").planning.min_survey_line_m;
  const small = vess("zboat_1800hs.json").planning.min_survey_line_m;
  check("17b. each shipped hull declares its own minimum (DriX 80, small-class 0)",
        drix === 80 && small === 0,
        "drix08=" + drix + " zboat_1800hs=" + small);
}

// --- 18. THE SILENT CAP -------------------------------------------------------------
// MAX_SURVEY_LINES has clamped the derived line count since the pattern maths was ported,
// and it said NOTHING. Past the cap the pattern stopped widening while the box carried on,
// so the operator got coverage that did not fill the area they drew and no indication why.
// 600 is not a theoretical edge: 25 m spacing across a 15 km box is exactly 600.
//
// WorldView hit this and reports it; Andy's ruling (2026-08-18) was to keep the console's
// 600 and make it honest rather than raise it, because the console has a per-line table
// that rebuilds with the plan and the planner does not.
{
  const { azTo, distTo, atDA } = require("../static/js/geodesy.js");
  // READ THE CAP FROM THE PAGE, and bind it under its own name BEFORE the eval:
  // the grabbed surveyPattern closes over `MAX_SURVEY_LINES` through this scope,
  // so a `const MAX` declared afterwards is both the wrong name and in the
  // temporal dead zone by the time the function actually runs.
  const MAX = Number(/const MAX_SURVEY_LINES\s*=\s*(\d+)/.exec(H)[1]);
  var MAX_SURVEY_LINES = MAX;                       // eslint-disable-line no-var
  // eslint-disable-next-line no-eval
  eval(grab("surveyPattern"));

  // A box `wide` m across at `sp` m spacing, lines running due north. A is one corner and
  // B the opposite one, which is what the console's three clicks produce.
  const box = (wide, sp, len = 400) =>
    surveyPattern(at(0, 0), at(wide, len), at(sp, 0), 0);

  check("18. the cap is still 600 — Andy kept it rather than raising it",
        MAX === 600, "MAX_SURVEY_LINES=" + MAX);

  const ok = box(1000, 25);
  check("19. an ordinary survey is NOT flagged",
        ok.capped === false && ok.count === ok.wanted,
        ok.count + " lines, wanted " + ok.wanted);

  // THE BOUNDARY WorldView GETS WRONG. Its test is `count >= MAX`, which fires at exactly
  // MAX — where nothing was dropped and the box IS covered. Comparing against the
  // pre-clamp count makes the flag mean what it says.
  const exact = box(MAX * 25, 25);
  check("20. EXACTLY the cap is not flagged — nothing was dropped there",
        exact.count === MAX && exact.capped === false,
        exact.count + " lines, wanted " + exact.wanted);

  const over = box((MAX + 400) * 25, 25);
  check("21. THE REPORTED CASE: past the cap IS flagged",
        over.capped === true, "capped=" + over.capped);
  check("22. ... the drawn count is the cap",
        over.count === MAX, over.count + " drawn");
  check("23. ... and `wanted` reports what the box actually needed",
        over.wanted === MAX + 400, over.wanted + " needed, " + (over.wanted - over.count) + " dropped");
  check("24. ... so the shortfall is recoverable from the pattern alone",
        over.wanted - over.count === 400, "no second source of truth to disagree");

  // 25-27. SAID OUT LOUD. The numbers existing is not the fix; the card carrying them is.
  const R = grab("updatePatReadout");
  // ORDER BY POSITION, not by a bounded regex. The first version allowed 400
  // characters between the two branches and broke the moment the capped branch
  // grew a comment — a test that fails when a comment is added is measuring the
  // wrong thing. What matters is only that the capped branch comes first.
  const iCap = R.indexOf('if(sp.capped)'), iClip = R.indexOf('else if(!patClip)');
  check("25. the card reports the cap, and does so BEFORE the drag hint",
        iCap > 0 && iClip > iCap,
        "a truncated pattern outranks 'drag A / B / C to adjust' (capped at "
        + iCap + ", patClip at " + iClip + ")");
  check("26. ... naming BOTH the drawn count and what the box needed",
        /sp\.count[\s\S]{0,200}?sp\.wanted/.test(R),
        "one number alone does not tell an operator how far short they are");
  check("27. ... and saying plainly that the coverage is incomplete",
        /DOES NOT COVER THE AREA/.test(R),
        "the fault is invisible on the chart — the pattern just looks like a pattern");
  check("28. the line count itself shows the shortfall, not a bare capped number",
        /sp\.capped \? sp\.count\+" of "\+sp\.wanted/.test(R),
        "600 alone reads as a correct answer");

  // 29-30. AND IT HAS TO LOOK LIKE A WARNING. `.phint` is styled faint on purpose
  // (9.5px, --ink-faint); the correct words in that grey are a warning nobody reads.
  check("29. the capped hint is painted with the page's warn colour",
        /sp\.capped\)\{[\s\S]{0,600}?style\.color = "var\(--warn\)"/.test(R),
        "amber, not the faint hint grey — and --warn not --bad: the pattern is "
        + "wrong, the boat is not in danger");
  // THE HALF THAT ROTS. Painting is easy; un-painting is what gets forgotten, and a
  // hint left amber says "still truncated" about a pattern the operator just fixed.
  check("30. ... and cleared unconditionally at the top, not per-branch",
        /function updatePatReadout\(\)\{[\s\S]{0,700}?\$\("#sp_hint"\)\.style\.color = "";[\s\S]*?if\(sp\)\{/.test(R),
        "reset before any branch writes, so a new branch cannot forget to clear it");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
