// tests/ui_tooltips.js - a hover tip the pointer can never occlude.
//
// Andy: every informational popup was partially hidden under the pointer. Those were
// NATIVE title tooltips - drawn by the browser, positioned by the browser, not the
// page's to move. So static/asv.html now carries ONE delegated layer (#uiTip) that
// takes over from [title]: on hover the title is STASHED off the element (suppressing
// the native tip) and the text is shown anchored to the ELEMENT - below its left edge,
// flipped ABOVE when the bottom would clip, clamped to the viewport - so the pointer,
// sitting on the control, sits on the tip never. Verified live before these checks:
// stash, placement, no-overlap, bottom-edge flip, restore, and the mid-hover-writer
// guard all measured in a browser.
//
// TEETH - five mutations RUN against static/asv.html, 5/5 caught (recorded results):
//   * tipPos loses its bottom-edge flip            -> caught by 2
//   * tipPos loses its horizontal clamp            -> caught by 3
//   * the stash stops suppressing the native tip
//     (title left in place)                        -> caught by 5
//   * the restore stops guarding for a mid-hover
//     writer (unconditional restore)               -> caught by 6
//   * the delegation loses its stay-inside guard
//     (moving across a control's children kills
//     the tip)                                     -> caught by 7
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

console.log("Hover tips — anchored to the control, never under the pointer:");

// The REAL constants, parsed out of the page - a copied value here would drift.
const GAP = +(H.match(/TIP_GAP = (\d+)/) || [])[1];
const MARGIN = +(H.match(/TIP_MARGIN = (\d+)/) || [])[1];
const tipPos = new Function("TIP_GAP", "TIP_MARGIN", grab("tipPos") + "; return tipPos;")(GAP, MARGIN);
const R = (l, t, w, h) => ({left: l, top: t, right: l + w, bottom: t + h});

// 1. The default: below the control, aligned to its left edge, with the gap.
check("1. the tip hangs BELOW the control - where the pointer, on the control, cannot be",
      () => {
        const p = tipPos(R(100, 50, 80, 20), 200, 60, 1280, 720);
        return p.left === 100 && p.top === 70 + GAP;
      },
      () => JSON.stringify(tipPos(R(100, 50, 80, 20), 200, 60, 1280, 720)));

// 2. The bottom edge: flip ABOVE, still clear of the control.
check("2. at the bottom edge it flips ABOVE the control",
      () => {
        const p = tipPos(R(100, 690, 80, 20), 200, 60, 1280, 720);
        return p.top === 690 - GAP - 60 && p.top + 60 <= 690;
      },
      "tipBottom 700 <= controlTop 708 - measured live before this check existed");

// 3. The right edge: clamped inside the viewport.
check("3. at the right edge it clamps fully on-screen",
      () => {
        const p = tipPos(R(1250, 50, 20, 20), 300, 60, 1280, 720);
        return p.left === 1280 - 300 - MARGIN && p.left >= 0;
      },
      () => "left=" + tipPos(R(1250, 50, 20, 20), 300, 60, 1280, 720).left);

// 4. A tiny window with no room above OR below: best effort, never negative.
check("4. with no room either side it degrades to below, never off the top",
      () => {
        const p = tipPos(R(10, 30, 80, 20), 200, 200, 1280, 240);
        return p.top >= MARGIN;
      },
      "a tip pushed to negative coordinates is a tip nobody can read");

// 5-7. The mechanism, by source shape.
const MECH = H.slice(H.indexOf("const TIP_DELAY_MS"), H.indexOf("function drawAIS"));
check("5. hover STASHES the title off the element - that is what suppresses the native tip",
      () => /tipStash = text; el\.removeAttribute\("title"\)/.test(MECH),
      "two tips at once (native + ours) would be worse than the bug");
check("6. the restore is GUARDED: a title written mid-hover by a runtime readout wins",
      () => /if\(!tipEl\.getAttribute\("title"\)\) tipEl\.setAttribute\("title", tipStash\)/.test(MECH),
      "five readouts rewrite titles at runtime - nogo, AIS rows, water trust x2, mission speed");
check("7. moving within the hovered control's children keeps the tip up",
      () => /if\(tipEl && tipEl\.contains\(e\.target\)\) return;/.test(MECH),
      "the title is stashed, so closest('[title]') no longer matches the hovered element itself");
check("8. a mousedown hides the tip - a click means acting, not reading",
      () => /addEventListener\("mousedown", hideUiTip, true\)/.test(MECH),
      "");
// ⚠⚠ 10. DRIVEN: A RUNTIME WRITE DOES NOT RE-ARM THE NATIVE TIP UNDER THE POINTER. Check 6
// holds the restore on LEAVE; this holds the write DURING the hover, which is the half that
// undid the mechanism. Five readouts rewrite their titles at runtime and the suppression
// works by REMOVING the attribute, so a plain `el.title = ...` put it straight back - on
// EVERY state frame for any tip carrying a live value. The fuel pill is the sharp case: its
// tooltip is the only place `endurance_h` and `range_nm` appear at all, so it is a tip the
// operator dwells on, and it was re-attached four times a second while they read it.
// ⚠ THE PAIR IS THE CHECK. The un-hovered element must still get its attribute, or a
// "fix" that simply never wrote a title would pass the first half and take every tooltip on
// the page away.
{
  const mkEl = () => { const a = {}; return {
    title: "", setAttribute(k, v){ a[k] = v; this.title = v; },
    getAttribute(k){ return a[k]; }, removeAttribute(k){ delete a[k]; this.title = ""; } }; };
  const uiTip = { style: { display: "none" }, textContent: "" };
  const $ = () => uiTip;
  let tipEl = null, tipStash = "";
  eval(grab("setTip"));

  const hovered = mkEl(), other = mkEl();
  tipEl = hovered; tipStash = "old text";
  hovered.title = "";                       // the hover has already stashed it away
  setTip(hovered, "new text while hovered");
  const onHovered = { attr: hovered.title, stash: tipStash };

  setTip(other, "written to an element nobody is on");
  const onOther = { attr: other.title, stash: tipStash };

  // ... and a tip that is ON SCREEN follows the value rather than freezing at the hover.
  uiTip.style.display = ""; uiTip.textContent = "old text";
  setTip(hovered, "fresher still");
  const shown = uiTip.textContent;

  check("10. DRIVEN: a runtime title write during a hover goes to the STASH, not back onto "
        + "the element - and an un-hovered element still gets its title",
        () => onHovered.attr === "" && onHovered.stash === "new text while hovered"
              && onOther.attr === "written to an element nobody is on"
              && shown === "fresher still",
        () => "hovered: attribute " + JSON.stringify(onHovered.attr) + " (empty = the native "
            + "tip stays suppressed), stash " + JSON.stringify(onHovered.stash)
            + "; un-hovered: " + JSON.stringify(onOther.attr)
            + "; the shown tip followed the value -> " + JSON.stringify(shown));
}

check("9. the tip element is pointer-transparent and wraps long text",
      () => /id="uiTip"[^>]*pointer-events:none/.test(H) && /id="uiTip"[^>]*max-width:\s*\d+px/.test(H),
      "a tip that catches the mouse would flicker; a nowrap tip would run off-screen");

// -- 11. NOBODY INSIDE THE 4 Hz FRAME WRITES `title` DIRECTLY ---------------------------
// ⚠⚠ CHECK 10 PROVES THE MECHANISM; THIS PROVES IT IS USED. The suppression works by
// REMOVING the title attribute while the element is hovered, so any runtime write puts it
// straight back - and setTip is the one door that does not. The defect this catches is not
// hypothetical: the energy pill's FUEL branch was routed through setTip and given the comment
// "see setTip: not under the pointer", while the BATTERY branch SEVEN LINES BELOW IT, on the
// same pill in the same frame, kept writing `pill.title` directly. The fix landed for a fuel
// vessel and missed every battery one, which is this console's own default hull.
//
// ⚠ SCOPED TO onState's OWN SOURCE, not to a line range, so it follows the function. A tip
// written once at construction cannot be re-armed under a pointer and is not in scope.
{
  const on = grab("onState");
  const direct = (on.match(/[A-Za-z_$][\w$]*\.title\s*=/g) || []);
  check("11. no writer inside the 4 Hz telemetry frame re-arms the native tip - every one "
        + "goes through setTip",
        () => direct.length === 0,
        () => direct.length
                ? direct.length + " direct write(s) in onState: " + direct.join(", ")
                  + " - each re-attaches the native tooltip under the pointer four times a second"
                : "onState writes no title directly; " + (on.match(/setTip\(/g) || []).length
                  + " call(s) go through the guarded writer");
}

// -- 12. ... AND THE PER-FRAME CARDS onState CALLS OUT TO -------------------------------
// ⚠ THE FRAME IS NOT ONLY onState'S OWN BODY. It calls updateRunTime, updateWaterUI and
// updateEnvUI on every telemetry frame, and a tip rewritten in one of those is rewritten just
// as often as one written inline - the run-time tip is a LIVE readout the operator dwells on.
{
  const fns = ["updateRunTime", "updateWaterUI", "updateEnvUI"];
  const bad = [];
  for (const f of fns) {
    const src = grab(f);
    const d = (src.match(/[A-Za-z_$][\w$]*\.title\s*=/g) || []);
    if (d.length) bad.push(f + ": " + d.join(", "));
  }
  check("12. ... and neither do the cards it refreshes on every frame",
        () => bad.length === 0,
        () => bad.length ? bad.join(" | ")
                         : fns.join(", ") + " all write through setTip");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
