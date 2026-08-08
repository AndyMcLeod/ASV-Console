// tests/env_card_graphics.js - the ENV card's tide chart and wind rose are drawn in a
// FIXED DESIGN SPACE and fitted with ONE uniform scale, so they scale as a single
// picture and a circle cannot become an ellipse.
//
// WHY THIS EXISTS, and why the first attempt failed. Andy: "changing size should not
// distort the wind graphic or the water level graphic ... they should size in scale with
// the card", then, after the first fix shipped: "The wind circle is distorted and the
// tide also distorted. Come up with a cleaner solution where the wind rose and the tide
// curves scale consistently when resizing."
//
// THE FIRST FIX TREATED THE WRONG FAULT. It gave both canvases an aspect ratio and
// redrew them on resize, which made the BOX keep its shape - and measuring the box is
// how it was verified. Measuring the drawn PIXELS instead showed the ring was already
// round; what was wrong was everything else. Every element was in absolute pixels -
// 9/11/8 px fonts, 4 and 7 px ticks, 1/1.4/2.2 px strokes, 9 px arrowheads, a 14 px
// margin - while only the radius tracked the box. So a big card drew a huge ring with
// microscopic labels and hairline strokes, and a small one crowded the ring with text.
// The picture changed shape as it grew, which is exactly what "distorted" described.
//
// THE RULE NOW: draw in design units, let fitEnvCanvas map them onto the real box with a
// single factor (Math.min(w/DW, h/DH), applied to BOTH axes and centred). Then the ring
// is round by construction rather than by the box happening to stay square, and text,
// ticks, strokes and arrowheads all scale with it. The design size IS the card's natural
// size, so the scale is 1 there and the default rendering did not change.
//
//   node tests/env_card_graphics.js      # exit 0 = pass, 1 = fail
//
// LIVE-VERIFIED in a real browser at the Lewes base - the part source shape cannot see,
// and the part that caught the first attempt. Ring span measured from the RENDERED
// PIXELS (discriminating the ring stroke from the paler labels by red channel, or the
// N/S labels sitting further out than E/W reads as a 2% ellipse that isn't there):
//
//     card 156 / 260 / 340 / 440 px -> ring 111 / 184 / 248 / 328 px
//     horizontal span / vertical span = 1.0000 at EVERY size (a true circle)
//     ring / bitmap width            = 0.806 +/- 0.002 (it scales WITH the card)
//     label overhang / ring          = 0.15 constant (before: 0.22 shrinking to 0.07)
//
// TEETH (verified by mutation, with the checks each one produces):
//     the fit scales x and y independently (w/DW, h/DH)          -> 3
//     the fit stops centring the design box                      -> 4
//     fitEnvCanvas sizes off clientWidth instead of the rect     -> 5 (needed dpr 2 to
//       have teeth at all - see the note there; at dpr 1 both routes round alike and the
//       check passed with the fault restored)
//     the backing store stops including devicePixelRatio         -> 6
//     a draw function re-derives coords from the live box again  -> 8, 9
//     the design space and the CSS aspect-ratio disagree         -> 10, 11
//     a canvas gets a fixed pixel height back                    -> 12
//     the canvas attributes stop matching the design size        -> 13
//     the resize redraw is dropped or made non-main-window       -> 14, 15
//     the debounce goes back to requestAnimationFrame            -> 16
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
function canvasTag(id) {
  const m = H.match(new RegExp('<canvas id="' + id + '"[^>]*>'));
  if (!m) throw new Error("test setup: <canvas id=\"" + id + "\"> not found");
  return m[0];
}
const attrNum = (tag, a) => { const m = tag.match(new RegExp('\\s' + a + '="(\\d+)"')); return m ? +m[1] : null; };
const styleOf = tag => { const m = tag.match(/style="([^"]*)"/); return m ? m[1] : ""; };
const ratioOf = tag => { const m = styleOf(tag).match(/aspect-ratio:\s*(\d+)\s*\/\s*(\d+)/); return m ? [+m[1], +m[2]] : null; };

const FIT = grab("fitEnvCanvas");
const ROSE = grab("drawWindRose");
const TIDE = grab("drawTide");
const DESIGN = (() => {                      // the REAL constant, not a copy that can drift
  const m = H.match(/const ENV_DESIGN\s*=\s*\{[^}]*\}/);
  if (!m) throw new Error("test setup: ENV_DESIGN not found");
  const o = {}; eval(m[0].replace("const ", "var ") + "; o.v = ENV_DESIGN;");
  return o.v;
})();

console.log("ENV graphics — one design space, one uniform scale:");

// ---- the fit itself: run the REAL function against a fake canvas ---------- //
// A stub that records the transform, so the scale can be asserted as a NUMBER rather
// than by reading the source for a plausible-looking formula.
function fakeCanvas(boxW, boxH, dpr) {
  const calls = [];
  const cv = {
    width: 1, height: 1,
    clientWidth: Math.round(boxW), clientHeight: Math.round(boxH),
    getBoundingClientRect: () => ({ width: boxW, height: boxH }),
    getContext: () => ({
      setTransform: (...a) => calls.push(a),
      clearRect: () => {},
    }),
  };
  return { cv, calls, dpr };
}
function runFit(boxW, boxH, dpr, DW, DH) {
  const f = fakeCanvas(boxW, boxH, dpr);
  const g = { window: { devicePixelRatio: dpr }, Math: Math };
  // eslint-disable-next-line no-new-func
  const fn = new Function("window", "cv", "DW", "DH", FIT + "; return fitEnvCanvas(cv, DW, DH);");
  fn(g.window, f.cv, DW, DH);
  const t = f.calls[f.calls.length - 1];          // the transform the drawing runs under
  return { bitmap: [f.cv.width, f.cv.height], sx: t[0], shear: [t[1], t[2]], sy: t[3], tx: t[4], ty: t[5] };
}

const r1 = runFit(140, 140, 1, 140, 140);
check("1. at the design size the scale is exactly 1 (the default rendering is unchanged)",
      () => r1.sx === 1 && r1.sy === 1 && r1.tx === 0 && r1.ty === 0,
      () => "scale " + r1.sx + "," + r1.sy + " offset " + r1.tx + "," + r1.ty);

const r2 = runFit(440, 440, 1, 140, 140);
check("2. a bigger box scales the WHOLE design space up (not just the radius)",
      () => Math.abs(r2.sx - 440 / 140) < 1e-9 && r2.sx === r2.sy,
      () => "scale " + r2.sx.toFixed(4));

// 3. THE PROPERTY THE WHOLE FIX RESTS ON. Independent x/y scaling is what turns a
// compass ring into an ellipse; assert the two are EQUAL on a deliberately wrong-shaped
// box, which is the only case that can tell the two formulas apart.
const r3 = runFit(400, 200, 1, 140, 140);
check("3. A CIRCLE CANNOT BECOME AN ELLIPSE: one factor drives both axes, even in a " +
      "box whose shape does not match the design",
      () => r3.sx === r3.sy && r3.shear[0] === 0 && r3.shear[1] === 0,
      () => "sx=" + r3.sx + " sy=" + r3.sy + " shear=" + r3.shear.join(","));
check("4. ... and the design box is CENTRED in the leftover space (letterboxed, the safe " +
      "failure mode) rather than pinned to a corner",
      () => Math.abs(r3.tx - (400 - 140 * r3.sx) / 2) < 1e-9 && Math.abs(r3.ty - (200 - 140 * r3.sy) / 2) < 1e-9,
      () => "offset " + r3.tx.toFixed(2) + "," + r3.ty.toFixed(2));

// 5. Fractional layout: a card at 387.4 px reports clientWidth 387, and sizing the
// backing store off that rounded number leaves it out of step with the real box, which
// the browser then resamples.
// THIS CHECK NEEDED A dpr OF 2 TO HAVE TEETH. At dpr 1 both routes round to the same
// integer (387.4 -> 387 either way) and the assertion passed with the fault restored -
// the "cannot tell the bug from the fix" shape this project keeps meeting. Scaled by 2
// the routes separate: round(387.4*2) = 775, but round(387)*2 = 774.
const r5 = runFit(387.4, 387.4, 2, 140, 140);
check("5. the backing store comes from the FRACTIONAL rect, not the rounded clientWidth",
      () => r5.bitmap[0] === 775 && r5.bitmap[1] === 775 && r5.sx === r5.sy,
      () => "bitmap " + r5.bitmap.join("x") + " (off clientWidth it would be 774x774)");
check("6. the backing store honours devicePixelRatio (a HiDPI screen stays crisp)",
      () => { const r = runFit(200, 200, 2, 140, 140);
              return r.bitmap[0] === 400 && r.bitmap[1] === 400 && Math.abs(r.sx - 400 / 140) < 1e-9; },
      () => JSON.stringify(runFit(200, 200, 2, 140, 140).bitmap));
check("7. the canvas is cleared even when the size did NOT change (a redraw at the same " +
      "size must not paint over the old frame)",
      () => /clearRect\(0\s*,\s*0\s*,\s*w\s*,\s*h\)/.test(FIT) &&
            /if\(cv\.width\s*!==\s*w\)/.test(FIT) && /if\(cv\.height\s*!==\s*h\)/.test(FIT));

// ---- the callers: a pure helper proves nothing about who uses it ---------- //
check("8. the wind rose draws in DESIGN units - its centre and radius come from the " +
      "design box, never from the live element",
      () => /const W=ENV_DESIGN\.rose\[0\], H=ENV_DESIGN\.rose\[1\], ctx=fitEnvCanvas\(cv, W, H\)/.test(ROSE) &&
            /const cx=W\/2, cy=H\/2, R=Math\.min\(cx,cy\)-14/.test(ROSE) &&
            !/clientWidth|clientHeight|devicePixelRatio/.test(ROSE),
      "a single clientWidth read here reintroduces the whole fault");
check("9. the tide chart likewise, and its plot area is derived from the design box",
      () => /const W=ENV_DESIGN\.tide\[0\], H=ENV_DESIGN\.tide\[1\], ctx=fitEnvCanvas\(cv, W, H\)/.test(TIDE) &&
            !/clientWidth|clientHeight|devicePixelRatio/.test(TIDE) &&
            /padL\+\(t-t0\)\/\(t1-t0\)\*\(W-padL-padR\)/.test(TIDE));

// ---- design space vs the CSS box: they must agree or the fit letterboxes -- //
const roseTag = canvasTag("windRose"), tideTag = canvasTag("tideChart");
check("10. the wind rose's CSS aspect-ratio matches its design space (square)",
      () => { const r = ratioOf(roseTag), d = DESIGN.rose;
              return r && r[0] === r[1] && d[0] === d[1] && Math.abs(r[0] / r[1] - d[0] / d[1]) < 1e-9; },
      () => "css " + JSON.stringify(ratioOf(roseTag)) + " design " + JSON.stringify(DESIGN.rose));
check("11. the tide chart's CSS aspect-ratio matches its design space",
      () => { const r = ratioOf(tideTag), d = DESIGN.tide;
              return r && Math.abs(r[0] / r[1] - d[0] / d[1]) < 1e-9; },
      () => "css " + JSON.stringify(ratioOf(tideTag)) + " design " + JSON.stringify(DESIGN.tide));
check("12. neither canvas carries a fixed pixel height (the original fault: the graphic " +
      "could not grow with the card)",
      () => !/height:\s*\d+px/.test(styleOf(roseTag)) && !/height:\s*\d+px/.test(styleOf(tideTag)) &&
            /width:\s*100%/.test(styleOf(roseTag)) && /width:\s*100%/.test(styleOf(tideTag)));
check("13. the width/height ATTRIBUTES are the design size, so an un-drawn canvas at boot " +
      "sits at scale 1 instead of showing a stretched default bitmap",
      () => attrNum(roseTag, "width") === DESIGN.rose[0] && attrNum(roseTag, "height") === DESIGN.rose[1] &&
            attrNum(tideTag, "width") === DESIGN.tide[0] && attrNum(tideTag, "height") === DESIGN.tide[1],
      () => "rose " + attrNum(roseTag, "width") + "x" + attrNum(roseTag, "height") +
            ", tide " + attrNum(tideTag, "width") + "x" + attrNum(tideTag, "height"));

// ---- the resize redraw (sharpness, no longer shape) ---------------------- //
check("14. a resize redraws both graphics: the window listener AND a ResizeObserver on " +
      "the canvases, because a CARD resize is invisible to a window listener",
      () => /window\.addEventListener\("resize", redrawEnvGraphics\)/.test(H) &&
            /new ResizeObserver\([\s\S]{0,220}?redrawEnvGraphics\(\)/.test(H) &&
            /ro\.observe\(cv\)/.test(H));
check("15. the redraw is MAIN-WINDOW ONLY - in the controls window those canvases hold " +
      "bitmaps mirrored from main, and a local redraw would wipe them",
      () => /if\(UIROLE === "main"\)\{[\s\S]{0,900}?new ResizeObserver/.test(H));
check("16. the observer debounce uses setTimeout, NOT requestAnimationFrame (rAF is " +
      "suspended in a background window - the bug that froze the split mirror)",
      () => { const m = H.match(/new ResizeObserver\(\(\)=>\{[\s\S]{0,240}?\}\);/);
              return m && /setTimeout/.test(m[0]) && !/requestAnimationFrame/.test(m[0]); });

console.log(ran + " checks, " + fails + " failed");
process.exit(fails ? 1 : 0);
