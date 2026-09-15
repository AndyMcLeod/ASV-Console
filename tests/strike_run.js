// tests/strike_run.js - striking a punched survey run off by hand, and rebuilding the
// inter-line transits around the gap it leaves.
//
// Andy, 2026-09-01: *"The WorldView application has the ability to select and delete
// punched out survey lines and recalculate interline transits. Implement this ability in
// ASV Console."*
//
// Ported from WorldView's `SurveyPlan`, which reached this design the expensive way: its
// first build was reported as breaking the application and reverted undiagnosed. Three
// separate faults came out of diagnosing that, and each one has a check here.
//
//   node tests/strike_run.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// WHAT THE DESIGN RESTS ON, and what each part is guarding against:
//
//  1. MIDPOINTS, NOT INDICES. Runs are rebuilt from the corners and the chart on every
//     change, so an index names a different line the moment anything moves. A midpoint
//     names the RUN, and stops naming anything when that run ceases to exist — which is
//     what makes a stale strike harmless rather than destructive. It survives
//     `shortenSeg` (a symmetric lerp) and `regionOrder` (which orders and re-orients but
//     never splits), so the midpoint of the green segment the operator clicks IS the
//     midpoint of the clipped run behind it. Checks 1-4.
//
//  2. THE FILTER SITS AFTER THE CHART CLIP AND BEFORE THE ORDERING. WorldView's reverted
//     build filtered ABOVE the clip, where 16 pattern lines become 45 clipped runs, and
//     striking one short stub took the 900 m run on the far side of an island with it.
//     Below the ordering would be just as wrong the other way: the serpentine would stay
//     numbered through a line that is not there. Checks 5-7.
//
//  3. THE REBUILD IS COALESCED AND THE READERS FLUSH. `punchOut` opens with
//     `if(punchBusy) return;` — a second strike during a rebuild is DROPPED, not queued,
//     which would leave the plan on screen disagreeing with the strikes behind it. And a
//     400 ms window is longer than it takes to press Delete and then Add to plan, so a
//     commit inside it would commit the pre-strike plan with every figure agreeing with
//     itself. Checks 8-12.
//
// ⚠ AND THE ONE THE UNIT CHECKS COULD NOT SEE. The first cut drew the selection halo at
// 5 px under the 2.5 px coverage stroke. Measured on the live canvas, selecting a run
// changed ONE PIXEL: the highlight was invisible, while every check passed and the card
// read "Selected: a 819 m run". For a gesture whose entire safety argument is "you see
// which run is going before it goes", that is the feature missing. Check 13 pins the
// width relationship; only counting rendered pixels found it. See [[verify-the-ink]].
//
// TEETH (verified by mutation against a sidecar copy, predictions corrected by the runs):
//   filter above the clip (the reverted build)      -> 5, 6, 7
//   filter after regionOrder instead of before      -> 6
//   commit stops flushing the pending rebuild       -> 10
//   the flush stops waiting on a punch in flight    -> 11
//   the timer calls punchOut direct, not punchNow   -> 8
//   the strike rebuilds inline instead of scheduling -> 9
//   the gate goes back to a fixed 1.6 spacings      -> 14
//   the pair cap stops tracking the gate            -> 15
//   a gap reversal is built but never counted       -> 16
//   a stray survey-mode click discards the punch    -> 17
//   the selection stops claiming the click          -> 18
//   the halo shrinks back under the coverage stroke -> 13
//   resetPattern leaves the strikes + timer behind  -> 21
//   the card stops re-resolving the selection       -> 24
//   Delete handled before the typing guard          -> 25
//   the struck list matched by index, not midpoint  -> 1, 4, 19
//   the way back (restoreStruckRuns) removed        -> 21
//
// ⚠ TWO OF THESE CHECKS WERE WRITTEN WRONG AND MUTATION FOUND BOTH. 16 read
// `/nGapTurn\+\+/` and 18 read the POSITION of a call: changing the guard to `if(false)`
// left both texts in place and both checks green while neither line could run. A bare
// fragment tests the source, not the behaviour - so both pin the guard now.
//
// NOTE: this suite evaluates page code SLOPPY - a direct eval, so the page's function declarations bind into this
// file. The page itself is <script type="module">, which runs STRICT: an assignment to an undeclared name passes
// here and throws in the page. tests/page_strict.js parses the page and its modules as strict modules; that runtime
// difference is not checked anywhere.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
// "No FAIL lines" and "the process died" are indistinguishable to anything reading
// stdout, so a mutation that crashes this suite would otherwise score as SURVIVED.
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

// THE REAL MODULES, not source text lifted out of the page.
const { distTo, llEN, fromEN, planeFrame } = require("../static/js/geodesy.js");
const { shortenSeg } = require("../static/js/core_turns.js");
const { regionOrder } = require("../static/js/passage.js");

// Line endings normalised: several checks below regex the source with a BOUNDED window
// to say "these two things are near each other", and a CRLF checkout adds one character
// per line — which is how a check passes for whoever wrote it and fails on a fresh
// Windows clone, for a reason unrelated to the code it tests.
// ASV_HTML points this at a SIDECAR copy for a mutation run. Without it the only way to
// mutate what this suite reads is to edit static/asv.html itself — and a suite that ignores
// the override reports every mutation as SURVIVED, which is a broken instrument rather than
// weak checks (ais_table.js, 2026-09-08, twelve of them in one sweep).
const H = fs.readFileSync(process.env.ASV_HTML ||
                          path.join(__dirname, "..", "static", "asv.html"), "utf8")
  .split("\r\n").join("\n");

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
  let ok;
  // ⚠ A FUNCTION DETAIL IS CALLED, NOT STRINGIFIED. Every other suite in this repo allows
  // one, and passing one here printed the LAMBDA'S SOURCE into the bracket — which reads
  // as a detail line at a glance and says nothing about the run. The detail is the only
  // place a check that passed for the wrong reason shows up; it has to carry the
  // observation, so it has to be evaluated.
  try { ok = !!(typeof cond === "function" ? cond() : cond);
        if (typeof detail === "function") detail = detail(); }
  catch (e) { ok = false; detail = (typeof detail === "string" && detail ? detail + " — " : "")
                                   + "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}

// The page's own helpers, lifted and run for real rather than reimplemented here — a
// check that restates the algorithm agrees with itself and tests nothing.
let patStruck = [], patStruckKey = null, patClip = null;
// The key is STUBBED so staleness can be driven directly. The page derives it from the
// corners, the boundary and the chart; what matters here is the RULE those feed - a
// strike applies only while the key it was made under is still the current one.
let currentKey = "pattern-A";
function patStrikeKey(){ return currentKey; }
// eslint-disable-next-line no-eval
eval(grab("runMid"));
// eslint-disable-next-line no-eval
eval(grab("activeStruck"));
// eslint-disable-next-line no-eval
eval(grab("keptRuns"));
// A LEAD-IN / LEAD-OUT splits the run the boat flies from the coverage it surveys, and
// every midpoint that identifies a run has to come off the coverage half. Real bodies for
// the same reason as the three above - these are the exact functions the strike path calls.
let patLead = [];
const NO_LEAD = { in: 0, out: 0 };
// eslint-disable-next-line no-eval
eval(grab("patCoverSeg") + "\n" + grab("patCoverMid") + "\n" + grab("dropStruckFromPunch"));

const P = (lat, lon) => ({ lat, lon });
// A tidy east-west serpentine at ~43 N: five runs, 200 m apart, 1 km long.
const M_LAT = 1 / 111320;
const runs = [];
for (let i = 0; i < 5; i++) {
  const lat = 43 + i * 200 * M_LAT;
  runs.push([P(lat, -70.7), P(lat, -70.7 + 1000 / (111320 * Math.cos(43 * Math.PI / 180)))]);
}
const SPACING = distTo(runs[0][0], runs[1][0]);

console.log("Striking a punched run off — the gap has to be real, and rebuilt around:");

// ── 1-4. A MIDPOINT NAMES THE RUN, AND KEEPS NAMING IT ──────────────────────────────
{
  currentKey = "k"; patStruckKey = "k"; patStruck = [runMid(runs[2])];
  const kept = keptRuns(runs);
  check("1. striking a run removes exactly that run",
        () => kept.length === 4 && !kept.some(s => distTo(runMid(s), runMid(runs[2])) < 1),
        kept.length + " of " + runs.length + " kept");

  // ⚠ THE PROPERTY THE WHOLE DESIGN RESTS ON. `shortenSeg` takes the turn margin off both
  // ends as a symmetric lerp (t0 = m/d, t1 = 1 - m/d), so the segment the operator SEES
  // on the chart shares a midpoint with the clipped run the filter matches against. If
  // that ever stopped being true, a click would select one run and strike a different
  // one — and nothing else here would notice.
  const margin = SPACING * 0.5;
  const worst = Math.max(...runs.map(r => {
    const sh = shortenSeg(r[0], r[1], margin, distTo);
    return distTo(runMid(sh), runMid(r));
  }));
  check("2. the midpoint survives shortenSeg, so the drawn segment names its parent run",
        () => worst < 0.001,
        "worst midpoint drift " + worst.toFixed(6) + " m over " + runs.length + " runs");

  // ...and survives the ORDERING, which re-orients segments end-for-end.
  const ro = regionOrder(runs.map(r => [r[0], r[1]]), P(43, -70.7), 90, SPACING, () => true);
  const midsIn = runs.map(r => runMid(r)).sort((a, b) => a.lat - b.lat);
  const midsOut = ro.ordered.map(r => runMid(r)).sort((a, b) => a.lat - b.lat);
  check("3. ... and survives regionOrder, which re-orients runs but never splits one",
        () => midsOut.length === midsIn.length
              && midsIn.every((m, i) => distTo(m, midsOut[i]) < 0.001),
        midsIn.length + " in, " + midsOut.length + " out, same midpoints");

  // The tolerance is a metre. Far below any usable spacing, so it cannot reach the
  // neighbour — the failure that would strike a run the operator never clicked.
  check("4. the match tolerance cannot reach the neighbouring run",
        () => SPACING > 2 && !keptRuns(runs).some(s => distTo(runMid(s), runMid(runs[2])) < 1)
              && keptRuns(runs).length === runs.length - 1,
        "spacing " + SPACING.toFixed(0) + " m against a 1 m tolerance");
  patStruck = []; patStruckKey = null;
}

// ── 5-7. WHERE THE FILTER SITS, WHICH IS THE WHOLE OF THE REVERTED BUILD ────────────
{
  const punch = grab("punchOut");
  const iClip = punch.indexOf("clipLine(");
  const iFilter = punch.indexOf("keptRuns(clipped)");
  const iOrder = punch.indexOf("regionOrder(");
  check("5. the strike filter runs AFTER the ENC clip",
        () => iClip > 0 && iFilter > iClip,
        iFilter > iClip ? "clip then filter"
          : "FILTERED ABOVE THE CLIP — one pattern line becomes several clipped runs, so "
            + "striking a short stub would take the long run on the far side with it");
  // Named explicitly rather than left to the ordering above: the argument handed to
  // regionOrder must be the FILTERED array, not the raw clip.
  check("6. ... and it is the filtered array the ordering is given",
        () => /regionOrder\(runs,/.test(punch) && /const runs = keptRuns\(clipped\)/.test(punch),
        /regionOrder\(runs,/.test(punch) ? "regionOrder(runs, …)"
          : "regionOrder is not reading the filtered runs");
  check("7. ... and BEFORE the ordering, so the serpentine re-numbers around the gap",
        () => iFilter > 0 && iOrder > iFilter,
        iOrder > iFilter ? "filter then order"
          : "FILTERED AFTER ORDERING — the run would stay numbered through a line that is "
            + "not there, and the turns would still reach for it");
}

// ── 8-12. THE REBUILD IS COALESCED, AND ANYTHING READING THE RESULT WAITS ───────────
{
  const strike = grab("strikeSelectedRun");
  const sched = grab("scheduleRepunch");
  const flush = grab("flushRepunch");
  const now = grab("punchNow");
  const commit = grab("commitPattern");

  // ⚠ SERIALISED, NOT FIRE-AND-FORGET. punchOut refuses while one is in flight, so a
  // timer that called it directly would silently drop the rebuild for every strike made
  // during a rebuild — the plan on screen then disagrees with the strike list, quietly.
  check("8. every scheduled rebuild goes through the serialised punch, not punchOut direct",
        () => /punchNow\(\)/.test(flush) && !/[^w]punchOut\(\)/.test(flush)
              && /punchInFlight/.test(now) && /\.then\(\(\)\s*=>\s*punchOut\(\)\)/.test(now),
        /punchNow\(\)/.test(flush) ? "flushRepunch -> punchNow -> chained punchOut"
                                   : "flushRepunch calls punchOut directly — a rebuild "
                                     + "arriving during a rebuild is DROPPED by punchBusy");
  check("9. a strike SCHEDULES the rebuild rather than running it inline",
        () => /scheduleRepunch\(\)/.test(strike) && /setTimeout\(/.test(sched),
        "strikeSelectedRun -> scheduleRepunch -> setTimeout");
  // The reader side. Measured live: a strike-then-commit with no pause between committed
  // 15 lines from a 16-run plan — i.e. the flush is what makes the commit honest.
  check("10. commitPattern AWAITS the pending rebuild before reading the plan",
        () => /async function commitPattern/.test(H)
              && /patRepunchT \|\| punchInFlight/.test(commit)
              && /await flushRepunch\(\)/.test(commit),
        /await flushRepunch\(\)/.test(commit)
          ? "awaits a scheduled rebuild AND one already in flight"
          : "commits without flushing — inside the 400 ms window that is the PRE-strike plan");
  // "Nothing is scheduled" and "the answer is ready" are not the same thing: the timer
  // fires at 400 ms and the punch itself takes longer.
  check("11. ... and the flush also waits on a punch already running, not just a timer",
        () => /return Promise\.resolve\(punchInFlight\)/.test(flush),
        flush.includes("punchInFlight") ? "waits on punchInFlight with no timer pending"
                                        : "returns immediately once the timer has fired");
  // An async button handler that silently does nothing for half a second is
  // indistinguishable from one that did nothing at all.
  check("12. ... with the button disabled while it waits",
        () => /sp_add"\)\.disabled = true/.test(commit),
        "Add to plan shows it is working");
}

// ── 13. THE HIGHLIGHT HAS TO BE VISIBLE, WHICH IS A WIDTH RELATIONSHIP ─────────────
//
// ⚠ THIS CHECK EXISTS BECAUSE THE FIRST VERSION OF THE FEATURE FAILED HERE AND NOTHING
// CAUGHT IT. The halo was 5 px under a 2.5 px coverage stroke; counted on the live
// canvas, selecting a run changed ONE pixel. A source check cannot measure ink, so it
// pins the thing that made the ink too thin: the halo must be substantially wider than
// the stroke drawn over it, and the run must carry end caps so a SHORT run — the kind an
// operator most wants rid of — still has a visible selection.
{
  const draw = grab("drawPattern");
  const sel = draw.slice(draw.indexOf("if(patSel)"));
  const halo = /strokeStyle="rgba\(255,215,106,0\.95\)"; ctx\.lineWidth=(\d+(?:\.\d+)?)/.exec(sel);
  const over = /strokeStyle="rgba\(63,191,107,0\.95\)"; ctx\.lineWidth=(\d+(?:\.\d+)?)/.exec(sel);
  const w = halo ? parseFloat(halo[1]) : 0, o = over ? parseFloat(over[1]) : 0;
  check("13. the selection halo is wide enough to see past the stroke drawn over it",
        () => w >= o + 5 && /ctx\.arc\(/.test(sel),
        halo && over ? "halo " + w + " px vs coverage " + o + " px (fringe "
                       + ((w - o) / 2) + " px each side)" + (/ctx\.arc\(/.test(sel) ? " + end caps" : " — NO END CAPS")
          : "could not read the widths");
}

// ── 14-16. THE GAP A STRIKE LEAVES IS STILL A REVERSAL ─────────────────────────────
//
// ⚠ THE DEFECT THE FEATURE WALKS STRAIGHT INTO, and it was in ASV before any of this.
// A serpentine reverses onto its neighbour ONE spacing across and the gate was
// `spacing*1.6 + 3`. Take a line out — struck, clipped, or under MIN_SURVEY_LINE_M — and
// the survivors are TWO spacings apart: the pair fell through the gate, `nNoTurn` was
// never incremented (it only counts inside the branch the pair never entered), and the
// run fell to the straight-leg fallback. A 180 at zero radius that no hull can track,
// that no banner mentions, produced by the ordinary act of dropping a short line.
{
  const punch = grab("punchOut");
  const gap = /const GAP_LINES = (\d+), gapSpan = GAP_LINES \+ ([\d.]+);/.exec(punch);
  const span = gap ? parseInt(gap[1], 10) + parseFloat(gap[2]) : 0;
  check("14. the reversal gate admits a pair separated by a MISSING line",
        () => gap !== null && span >= 2
              && /distTo\(Ap,Bp\) < sp\.spacing\*gapSpan \+ 3 \+ leadSlack/.test(punch),
        gap ? "gapSpan " + span + " spacings — a struck line leaves survivors 2 apart"
            : "the gate is still a fixed 1.6 spacings: a struck line yields a SILENT "
              + "straight 180 the hull cannot track");
  // The pair guard inside teardropTurn compares the HALF-distance, so it has to move
  // with the gate or the gate opens onto a turn that is then refused as "degenerate".
  check("15. ... and the reversal-pair cap moves with it",
        () => /turnMaxHalf = Math\.max\(MAX_HALF_M, sp\.spacing\*gapSpan\/2 \+ 2\)/.test(punch),
        "turnMaxHalf sized off the same gapSpan, so the judgement is made once");
  // A wider reversal reaches further outboard than the spacing implies. Whether that
  // water is acceptable is the operator's call, and they can only make it if told.
  // ⚠ PINS THE GUARD, NOT THE STATEMENT. This read `/nGapTurn\+\+/` and a mutation
  // walked past it: changing `if(gapWide)` to `if(false)` leaves the text intact while the
  // counter never runs, so the check stayed green over a readout that could no longer
  // mention a gap turn. A bare fragment tests the SOURCE, not the behaviour - pin what the
  // increment is guarded ON, and where that guard's threshold comes from.
  check("16. ... and a reversal built across a gap is REPORTED, not slipped in",
        () => /const gapWide = distTo\(Ap,Bp\) > sp\.spacing\*1\.6 \+ 3 \+ leadSlack;/.test(punch)
              && /if\(gapWide\) nGapTurn\+\+;/.test(punch)
              && /\$\{nGapTurn\}/.test(punch)
              && /swing across a gap where a line is missing/.test(punch),
        "counted against the plain-neighbour threshold and named in the punch readout");
}

// ── 16b-16c. BOTH GATES CARRY A LEAD ALLOWANCE ─────────────────────────────────────
// Both thresholds are multiples of the LINE SPACING compared against the straight distance
// between two line ends. A lead inflates that distance without adding a metre of spacing,
// so without an allowance a big enough lead pushes a plain neighbour past both gates: no
// turn attempted and nothing counted (the silent-unflyable-reversal shape GAP_LINES exists
// to prevent), and every remaining turn reported as swinging across a missing line.
//
// ⚠ AND MEASURING THE CROSSING INSTEAD IS THE WRONG FIX, WHICH COST A MEASUREMENT TO FIND.
// It is the purer answer geometrically — "how many spacings across" is a question about
// the crossing — but the crossing is ALWAYS ≤ the distance, so it ADMITS pairs the old gate
// excluded. The chart clip leaves adjacent runs with different extents routinely, with no
// lead involved at all: on a 7-line harbour plan two pairs sat 53.9 m and 22 m apart along
// track, and measuring across pulled both into the reversal branch, where a refusal is
// flagged red rather than routed around — 0 unroutable became 2. An ALLOWANCE is a no-op
// when it is zero, which is every plan that does not use the feature; a different measure
// is not.
//
// ⚠ A TEXT MATCH CANNOT TELL ANY OF THIS APART — checks 14 and 16 pass against all three
// spellings — so the arithmetic is driven here.
{
  const ref = planeFrame({ lat: 43, lon: -70.7 });
  const hE = 90, fwd = { e: Math.sin(hE * Math.PI / 180), n: Math.cos(hE * Math.PI / 180) };
  const rgt = { e: fwd.n, n: -fwd.e };
  const across = (P, Q) => { const pe = llEN(P.lat, P.lon, ref), qe = llEN(Q.lat, Q.lon, ref);
    return Math.abs((qe.e - pe.e) * rgt.e + (qe.n - pe.n) * rgt.n); };
  const SP20 = 20;                                    // 20 m line spacing, tight survey
  const E = fromEN(0, 0, ref);
  const Fplain = fromEN(0, SP20, ref);                // the neighbour, ends abeam
  const Flead = fromEN(120, SP20, ref);               // ...with a 120 m lead-in on it
  const gate = SP20 * 4.6 + 3, wide = SP20 * 1.6 + 3; // gapSpan and the gapWide threshold

  check("16b. a lead moves the two ends APART without moving the lines ACROSS",
        () => Math.abs(across(E, Fplain) - SP20) < 0.5 && Math.abs(across(E, Flead) - SP20) < 0.5
              && distTo(E, Flead) > 100,
        () => "abeam: apart " + distTo(E, Fplain).toFixed(0) + " m, across "
              + across(E, Fplain).toFixed(0) + " m  |  with a 120 m lead-in: apart "
              + distTo(E, Flead).toFixed(0) + " m, across " + across(E, Flead).toFixed(0) + " m");

  const slack = 120;                                  // Math.max(leadIn, leadOut) in punchOut
  check("16c. ... so without the allowance both gates would misjudge a plain neighbour",
        () => distTo(E, Flead) > gate && distTo(E, Flead) < gate + slack
              && distTo(E, Flead) > wide && distTo(E, Flead) < wide + slack,
        () => "apart " + distTo(E, Flead).toFixed(0) + " m against a reversal gate of "
              + gate.toFixed(0) + " m and a gap-report threshold of " + wide.toFixed(0)
              + " m — over BOTH, so no turn attempted, nothing counted, and the card "
              + "blaming a line that is not missing. With the 120 m allowance both become "
              + (gate + slack).toFixed(0) + " m and " + (wide + slack).toFixed(0)
              + " m, and it is the neighbour it always was.");

  // ⚠ AND IT IS max(), NOT the sum. The along-track separation a lead can open is
  // |lead_in(k+1) - lead_out(k)|, whose largest value over the two settings is the LARGER
  // of them — never their sum. An allowance of wantIn + wantOut is not merely generous, it
  // admits pairs min(wantIn, wantOut) metres further apart than any lead could put them,
  // which is the gate quietly deciding that a region hop is a reversal.
  {
    const wantIn = 40, wantOut = 25;
    let worst = 0;
    for (let li = 0; li <= wantIn; li += 0.5)
      for (let lo = 0; lo <= wantOut; lo += 0.5) worst = Math.max(worst, Math.abs(li - lo));
    // The arithmetic below is the REASON; the regex is what makes this a test of the
    // console rather than of Math.max. A check that only ran the sweep would agree with
    // itself whatever punchOut does.
    check("16c2. the allowance is the LARGER lead, which is the tight bound",
          () => /const leadSlack = Math\.max\(wantIn, wantOut\);/.test(grab("punchOut"))
                && Math.abs(worst - Math.max(wantIn, wantOut)) < 0.01
                && worst < wantIn + wantOut - 0.01,
          () => "over every (lead_in <= " + wantIn + ", lead_out <= " + wantOut + ") the widest "
                + "along-track separation is " + worst.toFixed(1) + " m = max(), not "
                + (wantIn + wantOut) + " m = sum(). The sum over-allows by "
                + Math.min(wantIn, wantOut) + " m of pairs no lead can produce.");
  }

  check("16d. ... and the allowance is ZERO on a plan with no lead, so nothing moves",
        () => distTo(E, Fplain) < gate && distTo(E, Fplain) < wide + 0.001
              && Math.abs(distTo(E, Fplain) - across(E, Fplain)) < 0.01,
        () => "abeam pair: apart " + distTo(E, Fplain).toFixed(1) + " m = across "
              + across(E, Fplain).toFixed(1) + " m, under both thresholds with a slack of 0. "
              + "This is the property the ALLOWANCE has and a different MEASURE does not: "
              + "the crossing is always <= the distance, so it admits pairs the old gate "
              + "excluded and changes plans that never asked for a lead.");
}

// ── 17. A STRAY CLICK MUST NOT THROW THE PUNCH AWAY ────────────────────────────────
//
// Found while giving the chart click a second job. With A, B and C all placed, the
// survey-mode branch assigned nothing and still ran `patClip=null` — so ANY stray click
// in survey mode silently discarded a punch that had just cost an ENC extract and a full
// re-solve. It would have fought the new selection gesture, and the punch would have lost.
{
  const up = H.slice(H.indexOf('window.addEventListener("mouseup"'));
  const surveyBranch = up.slice(up.indexOf('mode === "survey"'), up.indexOf('mode === "bound"'));
  check("17. a click in survey mode only invalidates the punch if a corner was PLACED",
        () => /const placed = !pat\.A \|\| !pat\.B \|\| !pat\.C;/.test(surveyBranch)
              && /if\(placed\) patClip=null;/.test(surveyBranch),
        /if\(placed\)/.test(surveyBranch)
          ? "guarded on `placed`"
          : "UNGUARDED — a stray click with A/B/C set discards the whole punch");
  // The selection has to claim the click ahead of the mode chain, or a punched pattern
  // could only be edited from whichever mode happened to draw it.
  // ⚠ THE GUARD AGAIN, for the same reason. Position alone survived `if(false && ...)`:
  // the call still sat above the pan return and still never ran.
  check("18. the run selection is offered before the mode chain and above the pan return",
        () => /if\(patClip && patClip\.length && !e\.shiftKey\)\{/.test(up)
              && up.indexOf("selectRunNear(") > 0
              && up.indexOf("selectRunNear(") < up.indexOf('if(mode === "pan") return;'),
        /if\(patClip && patClip\.length && !e\.shiftKey\)\{/.test(up)
          ? "guarded on a punched pattern, and claims the click first"
          : "the branch is not reachable on a punched pattern");
}

// ── 19-21. STALENESS, AND THE RESTORE PATH ─────────────────────────────────────────
{
  // Strikes are keyed to the pattern AND the chart. Either moving makes different runs,
  // and carrying a strike across would delete one nobody chose.
  currentKey = "pattern-A"; patStruckKey = "pattern-A"; patStruck = [runMid(runs[2])];
  const kept = keptRuns(runs);
  currentKey = "pattern-B";                         // the operator reshaped the box
  const after = keptRuns(runs);
  check("19. a strike stops applying once the pattern or chart changes",
        () => kept.length === 4 && after.length === 5,
        "same struck list: " + kept.length + " kept under its own key, "
        + after.length + " under a different one");
  // ⚠ EVICTION IS A PURE READ. WorldView's reverted build evicted stale strikes inside
  // its coverage GETTER — mutating on the path every redraw and every pointermove runs
  // through, which is the suspect its revert commit named. Nothing here writes.
  check("20. ... and going stale MUTATES NOTHING — a stale list stops being consulted",
        () => patStruck.length === 1,
        "the raw list is untouched (" + patStruck.length + " entry) and simply unused; "
        + "a getter with a side effect on a hot path is a bug waiting for a drag");
  const restore = grab("restoreStruckRuns");
  const reset = grab("resetPattern");
  check("21. a deletion has a way back, and the pattern reset takes the strikes with it",
        () => /patStruck = \[\]/.test(restore) && /scheduleRepunch\(\)/.test(restore)
              && /patStruck=\[\]/.test(reset) && /clearTimeout\(patRepunchT\)/.test(reset),
        "restoreStruckRuns rebuilds; resetPattern clears the strikes AND the pending timer "
        + "— a timer left running would re-punch a pattern that no longer exists");
  patStruck = []; patStruckKey = null;
}

// ── 22-23. THE OPERATOR IS TOLD ────────────────────────────────────────────────────
{
  const readout = grab("updatePatReadout");
  const punch = grab("punchOut");
  check("22. the card names what is selected and what Delete will do",
        () => /Press Delete to strike it off/.test(readout) && /patSel\.length/.test(readout),
        "with the run's LENGTH, which is what it was picked for");
  // A DELETION WITH NO WAY BACK IS A TRAP, and a struck run is not on the chart to click
  // a second time — so the way home is a real control, not a sentence describing one.
  check("23. ... and struck runs are counted with a working way to undo them",
        () => /run\(s\) struck off by hand/.test(readout) && /Put them back/.test(readout)
              && /restoreStruckRuns\(\)/.test(readout)
              && /struck off by hand/.test(punch),
        "card carries the count + button; the punch readout names it beside the other "
        + "coverage the plan lost, so a thin survey never reads as a chart problem");
}

// ── 24. THE SELECTION CANNOT OUTLIVE ITS RUN ───────────────────────────────────────
// A selection is a midpoint, so a rebuild that removes its run leaves it naming nothing.
// Both the highlight and the card resolve against the runs that exist NOW — a card still
// offering "press Delete to strike it off" for a run that is gone is an instruction the
// next keystroke disproves.
{
  const readout = grab("updatePatReadout");
  const draw = grab("drawPattern");
  check("24. the highlight and the card both resolve the selection against current runs",
        () => /patClip\|\|\[\]\)\.some\(\(s,k\)=>\{[\s\S]{0,160}?patCoverMid\(k\)[\s\S]{0,120}?distTo\(m, patSel\) < 1/.test(readout)
              && /for\(let k=0;k<patClip\.length;k\+\+\)\{[\s\S]{0,160}?patCoverMid\(k\)[\s\S]{0,120}?distTo\(m, patSel\) < 1/.test(draw),
        "neither draws nor offers a run that is no longer there — and both ask "
        + "patCoverMid, because patSel is a COVERAGE midpoint (see 24b)");
}

// ── 24b-24e. A LEAD MOVES THE RUN'S MIDPOINT, AND THE STRIKE MUST NOT FOLLOW IT ─────
// Check 2 above pins the property the strike design rests on: shortenSeg is a SYMMETRIC
// lerp, so the drawn segment keeps its parent run's midpoint. A lead-in and a lead-out are
// NOT symmetric — the operator sets them independently and the chart can trim either one —
// so the RUN's midpoint moves by half their difference while the strike list still holds
// the COVERAGE midpoint it was recorded from (the punch filters `keptRuns(clipped)` before
// any lead is added). Every comparison must be coverage-to-coverage, or a strike lands on
// the wrong run or on none at all.
//
// ⚠ AND AN EVEN LEAD HIDES ALL OF IT. in === out moves nothing, and that is the default a
// first operator will type — which is why 24b prints the drift per run rather than
// asserting a boolean: run 5 has no lead, does not move, and would pass either way.
{
  const LEADS = [{in:40,out:5}, {in:40,out:5}, {in:40,out:5}, {in:12,out:60}, {in:0,out:0}];
  patClip = runs.map(r => [r[0], r[1]]);
  patLead = LEADS.map(l => ({ ...l }));
  const drift = patClip.map((s, k) => distTo(runMid(s), patCoverMid(k)));
  check("24b. an uneven lead moves the RUN midpoint off the COVERAGE midpoint",
        () => drift[0] > 15 && drift[3] > 20 && drift[4] < 0.001,
        "drift: " + drift.map((d, k) => "run" + (k+1) + " " + d.toFixed(1) + " m").join(", ")
        + " — against a 1 m match tolerance. Run 5 has no lead and does not move.");

  // The coverage a strike is stored as, and the length the card quotes, are the same
  // segment — so it is worth saying what it actually measures.
  const cov = patCoverSeg(0), full = distTo(patClip[0][0], patClip[0][1]);
  check("24c. the coverage of a run is the run minus both leads",
        () => Math.abs(distTo(cov[0], cov[1]) - (full - 45)) < 0.5,
        "run " + full.toFixed(0) + " m, lead 40 + 5 → coverage "
        + distTo(cov[0], cov[1]).toFixed(0) + " m");

  currentKey = "k"; patStruckKey = "k";
  patStruck = [patCoverMid(2)];                 // recorded the way the punch records it
  const before = patClip.length;
  dropStruckFromPunch();
  check("24d. striking a run that carries a lead removes exactly that run",
        () => patClip.length === before - 1
              && !patClip.some((s, k) => distTo(patCoverMid(k), patStruck[0]) < 1),
        before + " runs → " + patClip.length + ", and none of the survivors is the struck one");

  // ⚠ THE PARALLEL ARRAY. patLead[k] describes patClip[k] and nothing else; filter one and
  // not the other and every lead after the gap re-points at the wrong run — coverage
  // measured from the wrong end, silently, on any plan with both a strike and a lead.
  check("24e. ... and patLead is filtered in the same pass, so the two stay in step",
        () => patLead.length === patClip.length
              && patLead[2].in === 12 && patLead[2].out === 60
              && patLead[3].in === 0 && patLead[3].out === 0,
        patClip.length + " runs, " + patLead.length + " leads: "
        + patLead.map(l => l.in + "/" + l.out).join(" ")
        + " (was 40/5 40/5 40/5 12/60 0/0 — index 2 removed)");
  patStruck = []; patStruckKey = null; patClip = null; patLead = [];
}

// ── 25. DELETE BELONGS TO A FOCUSED FIELD FIRST ────────────────────────────────────
// Delete inside `Spacing` or `Min depth` edits the number. Without the guard it would
// strike a survey run off while the operator was typing — the worst kind of hidden
// action, the one that happens somewhere they are not looking.
{
  const keydown = H.slice(H.indexOf('window.addEventListener("keydown"'));
  const body = keydown.slice(0, keydown.indexOf("\n});"));
  const iGuard = body.indexOf("INPUT|SELECT|TEXTAREA");
  const iDel = body.indexOf('e.key === "Delete"');
  check("25. the typing guard comes before the Delete branch",
        () => iGuard > 0 && iDel > iGuard,
        iDel > iGuard ? "field guard first, and it covers Delete as well as Escape"
                      : "Delete would strike a run off while the operator types a number");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
