// tests/env_card_graphics.js - the ENV card's tide chart and wind rose SCALE with the
// card and are never stretched.
//
// WHY THIS EXISTS. Andy: "In the Environment Card changing size should not distort the
// wind graphic or the water level graphic ... they should size in scale with the card."
// Two separate faults produced one symptom:
//
//   * FIXED PIXEL HEIGHTS. Both canvases were `width:100%;height:104px|132px`, so
//     widening the card stretched them sideways and they never grew with it. They are
//     now sized by ASPECT RATIO - the tide chart 4:3, the wind rose SQUARE (a compass
//     ring's radius is min(cx,cy), so a wide box leaves the rose small with dead space
//     either side; square lets it fill the card and makes a distorted rose impossible).
//   * NOTHING REDREW ON A CARD RESIZE. Both draw functions already re-derive the
//     backing store from the laid-out box x devicePixelRatio, so a redraw at any size
//     is correct - but between the resize and the next redraw the browser STRETCHES the
//     old bitmap into the new box, and only a WINDOW resize was hooked. The card is
//     resizable too, and nothing watched it.
//
// THE TRAP THAT COST THE FIRST TWO ATTEMPTS, and it is written down twice in the page
// already (saveCardSizes, and the split mirror): A RESIZEOBSERVER IS DELIVERED WITH THE
// RENDERING STEPS, and an occluded or background window has those suspended - in a
// hidden window it does not fire AT ALL. Measured again here: with the observer as the
// only hook, the tide chart stayed stretched while the wind rose looked fine - not
// because the rose was handled, but because the 4 Hz state push happens to repaint the
// rose and nothing repaints the tide until its 6-minute fetch. `mouseup` is
// event-driven, lands whatever the window is doing, and a drag-resize always ends in
// one; the observer stays as the extra that redraws continuously while the window IS
// being rendered and catches a resize made without the mouse. rAF is not usable for the
// debounce for exactly the same reason.
//
//   node tests/env_card_graphics.js      # exit 0 = pass, 1 = fail
//
// LIVE-VERIFIED in a real browser at the Lewes base, which these checks cannot see:
// with tide data loaded, dragging the card 363 -> 208 -> 283 px wide left the tide
// canvas backing store stale (347x260 in a 192x144 box) and a mouseup made it exact at
// every size; the box aspect held at 1.335 / 1.000 throughout.
//
// TEETH (verified by mutation):
//     a fixed pixel height comes back on either canvas          -> 1, 2
//     the wind rose stops being square                          -> 3
//     the canvas width/height attributes stop matching the ratio -> 4
//     the redraw is hooked to the observer only (no mouseup)    -> 6
//     the debounce goes back to requestAnimationFrame           -> 7
//     the redraw stops being main-window-only                   -> 8
//     a draw function stops sizing from the box x dpr           -> 9, 10
//     envCanvasStale ignores dpr / compares the wrong axis      -> 11-13
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
// the <canvas id=...> tag itself
function tagOf(id) {
  const m = H.match(new RegExp('<canvas id="' + id + '"[^>]*>'));
  if (!m) throw new Error("test setup: canvas " + id + " not found");
  return m[0];
}
const attr = (tag, name) => { const m = tag.match(new RegExp(name + '="([^"]*)"')); return m ? m[1] : null; };
const styleOf = tag => attr(tag, "style") || "";
// "4/3" -> 1.333
const ratio = s => { const m = String(s).match(/([\d.]+)\s*\/\s*([\d.]+)/); return m ? +(m[1] / m[2]).toFixed(3) : null; };

const TIDE = tagOf("tideChart"), WIND = tagOf("windRose");

console.log("ENV card graphics — they scale with the card and are never stretched:");

// ---- 1-4: the markup can no longer produce a stretched graphic ------------ //
check("1. THE REPORTED FAULT: the tide chart has no fixed pixel height",
      () => !/height:\s*\d+px/.test(styleOf(TIDE)) && /aspect-ratio:/.test(styleOf(TIDE)),
      () => styleOf(TIDE));
check("2. ... and neither does the wind rose",
      () => !/height:\s*\d+px/.test(styleOf(WIND)) && /aspect-ratio:/.test(styleOf(WIND)),
      () => styleOf(WIND));
check("3. the wind rose is SQUARE, so a compass ring cannot come out oval",
      () => ratio(styleOf(WIND).match(/aspect-ratio:\s*([^;]+)/)[1]) === 1,
      () => styleOf(WIND).match(/aspect-ratio:\s*([^;]+)/)[1]);
// The un-drawn canvas at boot shows its ATTRIBUTE bitmap scaled into the CSS box; if the
// two ratios disagree, the card opens on a stretched default before the first draw -
// which is exactly what the tide chart used to do (300x150 shown in a 140x104 box).
check("4. each canvas's width/height ATTRIBUTES match its CSS aspect ratio, so the "
      + "un-drawn canvas at boot is not stretched either",
      () => [TIDE, WIND].every(t => {
              const css = ratio(styleOf(t).match(/aspect-ratio:\s*([^;]+)/)[1]);
              const at  = +(attr(t, "width") / attr(t, "height")).toFixed(3);
              return Math.abs(css - at) < 0.02; }),
      () => [TIDE, WIND].map(t => attr(t, "width") + "x" + attr(t, "height")).join(" · "));
check("5. both canvases still fill the card's width",
      () => [TIDE, WIND].every(t => /width:\s*100%/.test(styleOf(t))));

// ---- 6-8: the redraw is wired the way an occluded window survives --------- //
// Comments stripped: these assert what the CODE does, and the block deliberately
// EXPLAINS in prose why rAF is not used - a bare text search would match that and
// report the fault it exists to prevent.
const decomment = s => s.replace(/\/\/[^\n]*/g, "");
const BLOCK = decomment(H.slice(H.indexOf("function redrawEnvGraphics"),
                                H.indexOf("$(\"#envBtn\").onclick")));
check("6. THE REDRAW DOES NOT DEPEND ON RENDERING: a mouseup hook exists "
      + "(a drag-resize always ends in one)",
      () => /addEventListener\("mouseup",\s*redrawEnvGraphicsIfResized\)/.test(BLOCK));
check("7. the observer debounce is setTimeout, NOT requestAnimationFrame "
      + "(rAF is suspended in the very case the redraw is needed)",
      () => /ResizeObserver\(/.test(BLOCK) && /setTimeout\(/.test(BLOCK)
         && !/requestAnimationFrame/.test(BLOCK));
check("8. the redraw is MAIN-WINDOW ONLY — in the controls window these canvases are "
      + "bitmaps mirrored from main and a local redraw would wipe them",
      () => /UIROLE\s*===\s*"main"/.test(BLOCK));
check("8b. ... and the mirror painter is what fills them there",
      () => /function paintUICanvas/.test(H) && /paintUICanvas\(m\.sel, m\.png\)/.test(H));

// ---- 9-10: the draw functions re-render at the box size, never scale ------ //
for (const [fn, label] of [["drawTide", "9. the tide chart"], ["drawWindRose", "10. the wind rose"]]) {
  const src = grab(fn);
  check(label + " sizes its backing store from the laid-out box x devicePixelRatio, "
        + "so a redraw at any size is exact",
        () => /devicePixelRatio/.test(src) && /clientWidth/.test(src) && /clientHeight/.test(src)
           && /cv\.width\s*=/.test(src) && /cv\.height\s*=/.test(src)
           && /setTransform\(dpr,\s*0,\s*0,\s*dpr,\s*0,\s*0\)/.test(src));
}

// ---- 11-13: envCanvasStale, run for real ---------------------------------- //
// The predicate every redraw path is gated on: "the bitmap no longer matches the box"
// IS the stretched state, so it has to be exact in both axes and honour dpr.
let code = "let window = {devicePixelRatio: 1};\n" + grab("envCanvasStale")
         + "\n({stale: envCanvasStale, setDpr: function(d){ window.devicePixelRatio = d; }})";
const api = eval(code);
const cv = (w, h, cw, ch) => ({ width: w, height: h, clientWidth: cw, clientHeight: ch });
check("11. a canvas whose bitmap matches its box is not stale; a widened box is",
      () => api.stale(cv(200, 150, 200, 150)) === false
         && api.stale(cv(200, 150, 300, 225)) === true);
check("12. a change in HEIGHT alone is caught too (checking one axis would miss a "
      + "vertical drag)",
      () => api.stale(cv(200, 150, 200, 400)) === true);
check("13. dpr is part of the comparison: on a 2x display a 200-wide box needs a "
      + "400-wide bitmap, and 200 is stale",
      () => { api.setDpr(2);
              const bad = api.stale(cv(200, 150, 200, 150));      // 1x bitmap on a 2x display
              const good = api.stale(cv(400, 300, 200, 150));     // correctly doubled
              api.setDpr(1);
              return bad === true && good === false; });
check("14. a missing canvas is not 'stale' (the card can be closed / not built yet)",
      () => api.stale(null) === false);

console.log(ran + " checks, " + fails + " failed");
process.exit(fails ? 1 : 0);
