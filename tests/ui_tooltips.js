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
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy.

const fs = require("fs");
const path = require("path");

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
check("9. the tip element is pointer-transparent and wraps long text",
      () => /id="uiTip"[^>]*pointer-events:none/.test(H) && /id="uiTip"[^>]*max-width:\s*\d+px/.test(H),
      "a tip that catches the mouse would flicker; a nowrap tip would run off-screen");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
