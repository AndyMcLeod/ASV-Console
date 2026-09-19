// tests/planner_guard_seam.js - THE PLANNER AND THE GUARD AGREE ABOUT ONE NUMBER.
//
// Andy, 2026-09-19, item 3 of four: *"The planner/guard seam - one of the two numbers has
// to move, and the guard's is the arbitrary one: a weather reading times a fixed 45
// seconds."* The guard's moved first (tests/in_extremis.js 5-6b). Asked what to do about
// the rest, with the measurements below in front of him, he chose the second option on
// offer: **make the planner clip to what the guard needs.**
//
// WHAT THE SEAM WAS, measured on his own plans and his own recordings before any of this:
//
//   * the planner clipped to the buffer to within THREE CENTIMETRES - a 5.03 m minimum
//     waypoint clearance against a 5 m buffer on the Honolulu plan, zero waypoints inside
//     it anywhere;
//   * the guard judged the boat against a band reaching far further, so 398 of that plan's
//     415 waypoints (96%) sat inside the old helm band, and 189 (46%) inside the new one;
//   * and it is NOT the boat's tracking that eats the margin, which is the obvious reading
//     and is wrong. Over 19,128 running frames in 18 upload windows - each cut at any
//     escape / hold / RTH / Go-To, because every one of those REPLACES the route - the boat
//     is 0.03 m from its commanded route at the median, 0.09 m at p90 and 0.30 m at p95.
//     It holds the line. (A first cut that did NOT cut at those commands measured a 98 m
//     "tracking error", which was the escape legs: the boat deliberately somewhere else.)
//
// So the gap is not error, it is a question the planner never asked. A survey line 5 m off
// a pier is legal by construction however hard the water is setting onto it.
//
//   node tests/planner_guard_seam.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// THE CONTRACT THIS FILE HOLDS:
//   1. the standoff is DERIVED from the guard's own two constants, never a third copy;
//   2. calm water plans exactly as it always did - the buffer, to the meter;
//   3. a point at the standoff is NOT in extremis, and a point inside it IS. That is the
//      whole point of the number, and it is the check that ties the two modules together;
//   4. punchOut clips at it, and its memo key names it, so a set change cannot be served a
//      clip taken in a different one;
//   5. it is SAID on the card when it costs coverage.
//
// ⚠ AND IT IS NOT A PROMISE ABOUT THE WHOLE PLAN, which check 7 states so that a reader
// does not take it for one. It is applied to the COVERAGE LINES. Turns reach outboard past
// the line ends and transits go where the router sends them; both still answer to the
// operator's plain buffer, and the guard is what covers them - which is what it is for.
//
// TEETH (recorded 2026-09-19; each mutation applied to a sidecar, the suite and the four
// punch/guard suites re-run, source restored and verified byte-identical after each):
//   guardStandoffM returns the bare buffer (the seam reopened)      -> 1, 3
//   guardStandoffM drops the buffer FLOOR (calm water narrows)      -> 1, 2
//   the standoff keyed to the full look-ahead again                 -> 1, 4
//   punchOut clips at `buffer` again                                -> 5
//   the clip standoff dropped from the memo key                     -> 5b
//   patClipBufM re-derives instead of asking the guard              -> 6
//   the card stops saying the clip widened                          -> 8
//
// ⚠ THESE ARE WHAT THE RUN PRINTED, not what was predicted for it - the first draft of
// this list had the first two lines as "-> 3, 4" and "-> 2" and both were wrong. Check 1
// catches every change to the FORMULA, which is why it appears three times; 3 and 4 are the
// two that catch a change to the MEANING, and 4 only fires because it tests the inside of
// the boundary as well as the outside.

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
const G = require("../static/js/guard.js");
const { bbOf } = require("../static/js/geometry.js");

const H = fs.readFileSync(process.env.ASV_HTML ||
                          path.join(__dirname, "..", "static", "asv.html"), "utf8");

let fails = 0;
function check(name, cond, detail) {
  let ok = false, err = "";
  try { ok = (typeof cond === "function") ? !!cond() : !!cond; }
  catch (e) { ok = false; err = " THREW " + (e && e.message ? e.message : e); }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : "") + err);
  if (!ok) fails++;
}
const kn = (x) => x * 0.514444;

console.log("The planner/guard seam - one number, owned by the guard, honoured by the planner:");

// ── 1. DERIVED, NOT DECIDED ─────────────────────────────────────────────────────────
check("1. the standoff is the guard's own two constants, not a third number",
      () => {
        for (const b of [3, 5, 20]) for (const s of [0, 0.3, 0.9, 1.5]) {
          const want = Math.max(b, b * G.HELM_ENTRY_FRAC + G.HELM_S * s);
          if (Math.abs(G.guardStandoffM(b, s) - want) > 1e-9) return false;
        }
        return true;
      },
      "guardStandoffM(buf, drift) = max(buf, buf*" + G.HELM_ENTRY_FRAC + " + " + G.HELM_S
        + "*drift) over 12 combinations - so moving HELM_S or HELM_ENTRY_FRAC moves the "
        + "planner with it, which is the whole point of it living in the guard");

// ── 2. CALM WATER IS UNCHANGED ──────────────────────────────────────────────────────
// The floor matters more than the formula: a console that has never seen a weather reading
// must plan exactly as it did before this existed, or the feature is a silent regression
// on every plan anyone has ever made.
check("2. with no set it is the operator's buffer, to the meter",
      () => [3, 5, 20, 0].every((b) => G.guardStandoffM(b, 0) === b)
            && G.guardStandoffM(5, undefined) === 5 && G.guardStandoffM(5, null) === 5,
      "0, null and undefined drift all give the buffer back unchanged (3->"
        + G.guardStandoffM(3, 0) + ", 5->" + G.guardStandoffM(5, 0) + ", 20->"
        + G.guardStandoffM(20, 0) + "). An absent weather reading may not narrow a survey");

// ── 3-4. THE TIE BETWEEN THE TWO MODULES ────────────────────────────────────────────
// A wall lying east-west; the boat sits south of it, stopped in the water and set onto it.
// `assess` is the REAL one, so this is the planner's number measured against the rung it
// exists to stay clear of.
const wall = (n0) => { const r = [{e:-4000,n:n0},{e:4000,n:n0},{e:4000,n:n0+300},{e:-4000,n:n0+300}];
  return { polys:[{ring:r, bb:bbOf(r), kind:"a dock / pier"}], lines:[], points:[], marks:[] }; };
const atRange = (m, buf, setKn) => {
  const drift = { e: 0, n: kn(setKn) };                 // setting NORTH, onto the wall
  const vel = { e: kn(3.0), n: kn(setKn) };             // 3 kn along it, way on, so canStop
  return G.assess({e:0,n:0}, vel, drift, wall(m), buf, { edge:false });
};
check("3. a line clipped AT the standoff is not in extremis, in the set it was clipped for",
      () => [[5,0.58],[5,1.75],[3,0.58],[20,1.00]].every(([buf,s]) => {
        const d = G.guardStandoffM(buf, kn(s));
        return atRange(d + 0.05, buf, s).level !== "helm";
      }),
      [[5,0.58],[5,1.75],[3,0.58],[20,1.00]].map(([buf,s]) => {
        const d = G.guardStandoffM(buf, kn(s));
        return buf + "m/" + s + "kn -> " + d.toFixed(1) + "m: " + atRange(d + 0.05, buf, s).level;
      }).join("  "));
// ⚠ PAIRED WITH ITS OPPOSITE, or "never in extremis anywhere" would pass check 3.
check("4. ... and a line INSIDE it is - so the number is the boundary, not a safe-looking margin",
      () => [[5,0.58],[5,1.75],[3,0.58],[20,1.00]].every(([buf,s]) => {
        const d = G.guardStandoffM(buf, kn(s));
        return atRange(d - 0.5, buf, s).level === "helm";
      }),
      [[5,0.58],[5,1.75],[3,0.58],[20,1.00]].map(([buf,s]) => {
        const d = G.guardStandoffM(buf, kn(s));
        return buf + "m/" + s + "kn -> " + (d - 0.5).toFixed(1) + "m: " + atRange(d - 0.5, buf, s).level;
      }).join("  "));

// ── 5-6. THE PLANNER ACTUALLY USES IT ───────────────────────────────────────────────
check("5. punchOut clips the coverage at the standoff, not at the bare buffer",
      () => /clipLine\(l\[0\],l\[1\],ref,koClip,clipBuf\)/.test(H)
            && /const clipBuf = patClipBufM\(\);/.test(H),
      "the clip call reads `clipBuf`, and `clipBuf` is patClipBufM() - the bare `buffer` "
        + "there is what made a 5 m plan legal in a 2 kn set");
check("5b. ... and the clip MEMO names it, so a set change cannot be served a stale clip",
      () => {
        const i = H.indexOf("function patStrikeKey(){");
        const body = H.slice(i, H.indexOf("\n}", i));
        return /patClipBufM\(\)\.toFixed\(/.test(body);
      },
      "patStrikeKey() includes patClipBufM(); without it two punches at the same buffer in "
        + "different sets share one memo, and the second gets the first's runs");
check("6. the page READS the guard's function rather than re-deriving it",
      () => {
        const i = H.indexOf("function patClipBufM(){");
        const body = H.slice(i, H.indexOf("\n}", i));
        // the body may CALL it, and must not arithmetic its way to the same answer...
        const derives = body.indexOf('guardStandoffM(') >= 0;
        const reDerives = body.indexOf('HELM_ENTRY_FRAC') >= 0
                          || body.indexOf(String(G.HELM_S) + ' *') >= 0
                          || body.indexOf('* 0.5') >= 0
                          || body.indexOf('*0.5') >= 0;
        // ...and the name must come from the GUARD's module, not a local of the same name.
        const k = H.indexOf('guardStandoffM');
        const imported = k >= 0 && H.slice(k, k + 260).indexOf('/static/js/guard.js') >= 0;
        return derives && !reDerives && imported;
      },
      "patClipBufM calls guardStandoffM and does no arithmetic of its own. Two numbers meant "
        + "to agree, kept in two files, IS the seam - re-deriving it here would reopen it the "
        + "first time either constant moved");

// ── 7. WHAT IT DOES NOT PROMISE ─────────────────────────────────────────────────────
// Stated as a check so nobody reads the feature as more than it is. Turns reach outboard
// past the line ends and transits go where the router sends them; both still answer to the
// operator's plain buffer, and the guard is what covers them.
check("7. the wider standoff is the COVERAGE clip only - turns and transits keep the buffer",
      () => /const turnMargin = Math\.max\(2, sp\.spacing\*0\.5\);/.test(H)
            && /legSafe=\(a,b\)=>\{[\s\S]{0,400}?blocked\(\{[^}]*\}, koTurn, buffer\)/.test(H),
      "legSafe and the turn validation still read `buffer`. A plan clipped to the standoff "
        + "cannot have the helm rung fire ON A LINE in that set; it can still fire in a turn, "
        + "on a transit, or if the set rises afterwards");

// ── 8. AND IT IS NEVER SILENT ───────────────────────────────────────────────────────
// Clipping coverage at more than the operator asked for COSTS THEM SURVEY. This console's
// standing rule is that dropping coverage somebody asked for is said out loud with the
// number and the threshold - the same rule nShort and nLeadCut answer to.
check("8. the card says when the set widened the clip, with the number and the set",
      () => /clipBuf > buffer \+ 0\.05/.test(H)
            && /clipped at \$\{clipBuf\.toFixed\(1\)\} m not \$\{buffer\} m/.test(H)
            && /setKnNow\.toFixed\(2\)\} kn set/.test(H),
      "the hint line carries the standoff actually used, the buffer it replaced and the set "
        + "that caused it - a thin survey with no explanation reads as a chart problem");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed");
process.exit(fails ? 1 : 0);
