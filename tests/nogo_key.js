// tests/nogo_key.js - THE NOGO KEY (Andy, 2026-10-18: "Need a NOGO key so the user knows what color is representing what
// component.").
//
// The key's rows are static/js/chartlayers.js NOGO_KEY, built into the chart window by the page's nogoKeyBuild and shown
// while the NOGO overlay is (nogoKeyShow, from updateNogoUI). A key that names a color the overlay does not draw, or misses
// one it does, tells the operator something false about the chart. So:
//   1. ONE PALETTE (chartlayers.js INK, 2026-10-19; Andy: "the nogo key reveals user interpretation limits with the current
//      color pattern versus the ENC. Try changing NOGO imposed bounded areas and speed limited areas with hatched lines or
//      brighter colors or both"): every color the key names is INK's and every INK color that reaches the screen is in the
//      key; drawNogo, drawLawBands and the page's drawSpeedZones draw with INK alone - no color literal in any of them - and
//      the keep-outs and the speed rules are HATCHED, at two orientations a right angle apart (1b: the hatch's geometry);
//   2. the page builds one row per entry, each swatch in its entry's own colors, each label with the depth floor in force;
//   3. the key shows exactly while the overlay does, and its fold is kept;
//   4. it is the chart's: hidden in the controls window, imported from the module that draws, refreshed with the NOGO row.
//
//   node tests/nogo_key.js      # exit 0 = pass, 1 = fail   (stdlib Node)

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
// ASV_HTML / ASV_CL point this at SIDECAR copies for a mutation run, never the real files. The chartlayers.js sidecar must
// live IN static/js (it imports geodesy.js, geometry.js and keepouts.js by relative path): a copy elsewhere cannot load.
const H = fs.readFileSync(process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html"), "utf8").split("\r\n").join("\n");
const CL_PATH = process.env.ASV_CL || path.join(__dirname, "..", "static", "js", "chartlayers.js");
const CLS = fs.readFileSync(CL_PATH, "utf8");
const { NOGO_KEY, INK, HATCH, hatch } = require(CL_PATH);

function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function grabDecl(name) {
  for (const kw of ["const ", "let "]) {
    const i = H.indexOf(kw + name + " =");
    if (i >= 0) return H.slice(i, H.indexOf(";", i) + 1);
  }
  throw new Error("test setup: declaration " + name + " not found (renamed?)");
}

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok = false, err = "";
  try { ok = (typeof cond === "function") ? !!cond() : !!cond; }
  catch (e) { ok = false; err = " THREW " + (e && e.message ? e.message : e); }
  if (typeof detail === "function") { try { detail = detail(); } catch (e) { detail = "detail threw " + e.message; } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : "") + err);
  if (!ok) fails++;
}
console.log("The NOGO key:");

// ---- 1. one palette: the key names INK whole, and the three drawings draw with nothing else ------------------- //
const DN = CLS.slice(CLS.indexOf("export function drawNogo("), CLS.indexOf("export function drawLawBands("));
const DL = CLS.slice(CLS.indexOf("export function drawLawBands("));
const DS = grab("drawSpeedZones");
const literals = (src) => src.match(/rgba?\([^)]*\)|"#[0-9a-fA-F]{3,8}"/g) || [];
const onScreen = Object.keys(INK).filter(k => k !== "mask");            // the mask is composited away, never seen
const inkVals = new Set(onScreen.map(k => INK[k]));
const keyed = new Set(NOGO_KEY.flatMap(k => [k.fill, k.hatch, k.stroke, k.edge].filter(Boolean)));
const uses = (src, names) => names.filter(n => !src.includes("INK." + n));
const dashesDrawn = new Set(((DN + DS).match(/setLineDash\(\[(\d+),\s*(\d+)\]\)/g) || []).map(s => s.match(/\d+/g).join(" ")));
const dashesKeyed = new Set(NOGO_KEY.filter(k => k.dash).map(k => k.dash));
const widthsDrawn = new Set(((DN + DS).match(/lineWidth\s*=([^;]*);/g) || []).flatMap(s => (s.match(/[\d.]+/g) || []).map(Number)));
const widthsKeyed = NOGO_KEY.filter(k => k.width != null).map(k => k.width);
const hatched = NOGO_KEY.filter(k => k.kind === "hatch");
check("1. ONE PALETTE, NAMED WHOLE: every color the key names is chartlayers.js INK's and every INK color that reaches the "
      + "screen is in the key; drawNogo, drawLawBands and the page's drawSpeedZones hold no color literal - each draws by INK's "
      + "names (the keep-outs' ten, the speed rules' three and the mask, the zones' five) and the hatch helper; the dashes the "
      + "two overlays set are the key's and the key's are set; every width the key gives is one they stroke with; the two "
      + "hatched rows are the keep-outs at HATCH.keep and the speed rules at HATCH.speed, a right angle apart",
      () => !literals(DN).length && !literals(DL).length && !literals(DS).length
            && [...keyed].every(c => inkVals.has(c)) && [...inkVals].every(c => keyed.has(c)) && inkVals.size >= 14
            && !uses(DN, ["keepFill", "keepHatch", "keepEdge", "surveyFill", "unreadFill", "failedFill", "failedEdge", "gapEdge", "inkFill", "inkEdge"]).length
            && /hatch\(ctx, INK\.keepHatch, HATCH\.keep\)/.test(DN)
            && !uses(DL, ["speedFill", "speedHatch", "speedEdge", "mask"]).length && /hatch\(sx, INK\.speedHatch, HATCH\.speed\)/.test(DL)
            && !uses(DS, ["speedFill", "speedHatch", "speedEdge", "zoneOffFill", "zoneOffEdge"]).length && /hatch\(ctx, INK\.speedHatch, HATCH\.speed\)/.test(DS)
            && dashesDrawn.size === 3 && [...dashesDrawn].every(d => dashesKeyed.has(d)) && [...dashesKeyed].every(d => dashesDrawn.has(d))
            && widthsKeyed.every(w => widthsDrawn.has(w))
            && hatched.length === 2 && hatched[0].hatch === INK.keepHatch && hatched[0].deg === HATCH.keep
            && hatched[1].hatch === INK.speedHatch && hatched[1].deg === HATCH.speed && Math.abs(HATCH.keep - HATCH.speed) === 90,
      () => JSON.stringify({ literals: { nogo: literals(DN), law: literals(DL), zones: literals(DS) },
                             keyedNotInk: [...keyed].filter(c => !inkVals.has(c)), inkNotKeyed: [...inkVals].filter(c => !keyed.has(c)),
                             missing: { nogo: uses(DN, ["keepFill", "keepHatch", "keepEdge", "surveyFill", "unreadFill", "failedFill", "failedEdge", "gapEdge", "inkFill", "inkEdge"]),
                                        law: uses(DL, ["speedFill", "speedHatch", "speedEdge", "mask"]), zones: uses(DS, ["speedFill", "speedHatch", "speedEdge", "zoneOffFill", "zoneOffEdge"]) },
                             dashesDrawn: [...dashesDrawn], dashesKeyed: [...dashesKeyed], widthsKeyed, widthsDrawn: [...widthsDrawn],
                             hatched: hatched.map(h => h.deg) }));

// ---- 1b. the hatch itself, on a recording tile: the angle, the spacing, seamless across the tile, cached, and a plain
//          color where no pattern can be made (the suites' recording contexts) -------------------------------------- //
function mkTileCtx(){
  const c = { segs: [], cur: null, stroked: 0 };
  c.beginPath = () => {}; c.moveTo = (x, y) => { c.cur = [x, y]; };
  c.lineTo = (x, y) => { c.segs.push([c.cur, [x, y]]); c.cur = [x, y]; }; c.stroke = () => { c.stroked++; };
  return c;
}
class FakeOff { constructor(w, h){ this.w = w; this.h = h; this.ctx = mkTileCtx(); FakeOff.made.push(this); } getContext(){ return this.ctx; } }
FakeOff.made = [];
const S = Math.round(HATCH.spacingPx * Math.SQRT2);
const target = { createPattern: (tile, rep) => ({ tile, rep }) }, none = { createPattern: () => null };
const hadOff = "OffscreenCanvas" in globalThis;
globalThis.OffscreenCanvas = FakeOff;
const p45 = hatch(target, INK.keepHatch, HATCH.keep), p135 = hatch(target, INK.speedHatch, HATCH.speed);
const again = hatch(target, INK.keepHatch, HATCH.keep), nullPat = hatch(none, "blue", HATCH.speed);
if (!hadOff) delete globalThis.OffscreenCanvas;
const noCanvas = hatch(target, "green", HATCH.keep), noPattern = hatch({}, "red", HATCH.keep);
// a line's intercept: x + y for a "/" line (45), y - x for a "\" one (135); every segment on one, the three a tile apart
const lines = (tile, deg) => {
  const segs = tile.ctx.segs, slopeOk = segs.every(([a, b]) => deg === 45 ? (b[1] - a[1]) === -(b[0] - a[0]) : (b[1] - a[1]) === (b[0] - a[0]));
  const c = (p) => deg === 45 ? p[0] + p[1] : p[1] - p[0];
  const sameLine = segs.every(([a, b]) => c(a) === c(b));
  return { slopeOk, sameLine, at: [...new Set(segs.map(([a]) => c(a)))].sort((x, y) => x - y) };
};
const L45 = lines(p45.tile, 45), L135 = lines(p135.tile, 135);
check("1b. THE HATCH: a square tile of round(spacing x sqrt 2) = " + S + " px, its lines at the angle (every segment's slope -1 "
      + "for the keep-outs' 45, +1 for the speed rules' 135), each segment on one line and the three lines a tile's side apart "
      + "in intercept (0, S, 2S) so the tiling is seamless and the lines " + HATCH.spacingPx + " px apart across; the color and "
      + "width set and stroked; made once per context and color (cached); the color itself where the context takes no pattern, "
      + "where no tile can be made, or where the pattern comes back null",
      () => p45.rep === "repeat" && p45.tile instanceof FakeOff && p45.tile.w === S && p45.tile.h === S
            && p45.tile.ctx.strokeStyle === INK.keepHatch && p45.tile.ctx.lineWidth === HATCH.widthPx && p45.tile.ctx.stroked === 1
            && L45.slopeOk && L45.sameLine && L45.at.join() === [0, S, 2 * S].join()
            && p135.tile.ctx.strokeStyle === INK.speedHatch && L135.slopeOk && L135.sameLine && L135.at.join() === [-S, 0, S].join()
            && Math.abs(S / Math.SQRT2 - HATCH.spacingPx) < 0.1
            && again === p45 && FakeOff.made.length === 3 && nullPat === "blue" && noCanvas === "green" && noPattern === "red",
      () => JSON.stringify({ S, L45, L135, made: FakeOff.made.length, again: again === p45, nullPat, noCanvas, noPattern }));

// ---- 2-3. the page's own builder, in a world of its own ------------------------------------------------------- //
function mkEl(tag) {
  const e = { tagName: tag, className: "", title: "", textContent: "", innerHTML: "", dataset: {}, style: {}, kids: [], onclick: null,
              cls: new Set() };
  e.appendChild = c => { e.kids.push(c); return c; };
  e.replaceChildren = (...cs) => { e.kids = cs; };
  e.classList = { toggle: (c, on) => (on ? e.cls.add(c) : e.cls.delete(c)), contains: c => e.cls.has(c) };
  return e;
}
function mkWorld(stored) {
  // the markup's parts: the key, its fold button (in the header) and its body
  const w = { key: mkEl("div"), mark: mkEl("span"), body: mkEl("div"), saved: [], V: { NOGO_MIN_DEPTH_M: 2.8 }, nogo: { ready: true } };
  const parts = { "#nogoKey": w.key, "#nogoKeyFold": w.mark, "#nogoKeyBody": w.body };
  w.key.classList.contains = c => w.key.cls.has(c);               // the page's showPanel asks it whether it is a .panel
  const src = "let nogoShow = true;\n" + grabDecl("NOGO_KEY_FOLD_KEY") + "\n" + grabDecl("NOGO_KEY_SWATCH_X") + "\n"
    + grabDecl("nogoKeyTexts") + "\n" + ["nogoKeySwatch", "nogoKeyBuild", "nogoKeyShow", "showPanel"].map(grab).join("\n")
    + "\nreturn {nogoKeyBuild, nogoKeyShow, nogoKeySwatch, setShow: v => { nogoShow = v; }};";
  // eslint-disable-next-line no-new-func
  // nogoDR as chart.js has it: the hull's floor or the operator's Min depth, whichever is deeper (the floor drawNogo fills at)
  w.api = new Function("$", "document", "lsGet", "lsSet", "NOGO_KEY", "HATCH", "V", "nogo", "clampPanelPos", "nogoDR", src)(
    s => parts[s] || null, { createElement: mkEl },
    (k, d) => (k === "asv_nogokey_fold_v1" && stored !== undefined ? stored : d), (k, v) => w.saved.push([k, v]),
    NOGO_KEY, HATCH, w.V, w.nogo, (el, l, t) => ({ left: l, top: t }),
    () => ({ min: Math.max(w.V.NOGO_MIN_DEPTH_M, typeof w.V.OPER_MIN_DEPTH_M === "number" ? w.V.OPER_MIN_DEPTH_M : 0), max: 0 }));
  w.api.nogoKeyBuild();
  w.rows = () => w.body.kids;
  w.texts = () => w.rows().map(r => r.kids[0].textContent);
  return w;
}
const W = mkWorld();
const rows = W.rows();
const X = 1.5;                                                   // NOGO_KEY_SWATCH_X: the swatch drawn 1.5x (pinned below)
const swatchOk = rows.length === NOGO_KEY.length && rows.every((r, i) => {
  const k = NOGO_KEY[i], svg = r.innerHTML;
  // a hatched swatch: the wash, then the hatch as an SVG pattern at the chart's own spacing and width (in the 1.5x swatch's
  // units), rotated to its row's angle, over it, with the edge; its pattern id its own (two rows, two ids)
  const hat = k.kind !== "hatch" || (new RegExp(`<pattern id="(nkh\\w+)" patternUnits="userSpaceOnUse" width="${HATCH.spacingPx / X}" height="${HATCH.spacingPx / X}" patternTransform="rotate\\(${k.deg}\\)"><line [^>]*stroke="${k.hatch.replace(/[()]/g, "\\$&")}" stroke-width="${HATCH.widthPx / X}"/></pattern>`).test(svg)
    && svg.includes(`fill="url(#${svg.match(/<pattern id="(nkh\w+)"/)[1]})"`) && svg.indexOf(`fill="${k.fill}"`) < svg.indexOf("url(#"));
  return /^<svg [^>]*>.*<\/svg>$/.test(svg) && !/undefined|null/.test(svg) && hat
         && [k.fill, k.hatch, k.stroke, k.edge].filter(Boolean).every(c => svg.includes(c)) && (!k.dash || svg.includes(`stroke-dasharray="${k.dash}"`));
});
const hatchIds = rows.filter((r, i) => NOGO_KEY[i].kind === "hatch").map(r => (r.innerHTML.match(/<pattern id="(nkh\w+)"/) || [])[1]);
const texts = W.texts();
const sizes = rows.map(r => (r.innerHTML.match(/^<svg width="([\d.]+)" height="([\d.]+)"/) || []).slice(1).map(Number));
const css = (H.match(/\.nogokey\{[^}]*\}/) || [""])[0];
check("2. THE PAGE BUILDS ONE ROW PER ENTRY, BIG ENOUGH TO READ: each swatch an SVG in its entry's own colors (and dash, and "
      + "hatch - a pattern at the chart's spacing and angle, each hatched row's its own), drawn 1.5x (39 x 21 px); the key's "
      + "text 12 px; each label its entry's words with the depth floor in force (2.8 m here) and no placeholder left (Andy, "
      + "the same day: \"too small to read\")",
      () => swatchOk && hatchIds.length === 2 && hatchIds[0] && hatchIds[0] !== hatchIds[1]
            && sizes.every(s => s[0] === 39 && s[1] === 21) && /font-size:12px/.test(css)
            && texts.every((t, i) => t === NOGO_KEY[i].label.replace("{floor}", "2.8 m")) && /2\.8 m/.test(texts[0])
            && !texts.some(t => t.includes("{floor}")),
      () => JSON.stringify({ rows: rows.length, keys: NOGO_KEY.length, swatchOk, hatchIds, size: sizes[0], css: css.slice(0, 120), first: texts[0],
                             hatchSvg: (rows[0] || {}).innerHTML }));
// 2b. THE FLOOR NAMED IS THE FLOOR DRAWN (the 2026-10-18 review): the key read the hull's constant while the overlay filled to the
//     operator's Min depth where that is deeper - "floor 8.0 m" on the NOGO row, "shallower than 2.8 m" on the key
W.V.OPER_MIN_DEPTH_M = 8; W.api.nogoKeyShow(); const deeper = W.texts()[0]; delete W.V.OPER_MIN_DEPTH_M; W.api.nogoKeyShow();
check("2b. with the operator's Min depth raised to 8 m over a 2.8 m hull the key's first row says 8.0 m - the floor the overlay is "
      + "drawn at (nogoDR) - not the hull's 2.8",
      () => /8\.0 m/.test(deeper) && !/2\.8 m/.test(deeper) && /2\.8 m/.test(W.texts()[0]), () => deeper + " | back: " + W.texts()[0]);

const shown = {};
shown.ready = W.key.style.display;
W.api.setShow(false); W.api.nogoKeyShow(); shown.overlayOff = W.key.style.display;
W.api.setShow(true); W.nogo.ready = false; W.api.nogoKeyShow(); shown.notReady = W.key.style.display;
W.nogo.ready = true; W.V.NOGO_MIN_DEPTH_M = 1.0; W.api.nogoKeyShow(); shown.back = W.key.style.display; shown.floor = W.texts()[0];
const mark = W.mark;
const fold0 = { folded: W.key.classList.contains("folded"), mark: mark.textContent };
mark.onclick();                                              // the fold is its button: the header drags
const fold1 = { folded: W.key.classList.contains("folded"), mark: mark.textContent, saved: JSON.stringify(W.saved) };
const W2 = mkWorld(true);
check("3. SHOWN EXACTLY WHILE THE OVERLAY IS: shown with the overlay on and the zones read, hidden with the overlay off or "
      + "the zones not yet read, shown again after; a new vessel's floor reaches the label; its fold BUTTON folds the key "
      + "(the header no longer does: it drags) and the fold is kept, and a key built with it kept starts folded",
      () => shown.ready === "block" && shown.overlayOff === "none" && shown.notReady === "none" && shown.back === "block"
            && /1\.0 m/.test(shown.floor) && !/nogoKeyHead/.test(grab("nogoKeyBuild"))
            && !fold0.folded && fold0.mark === "▾" && fold1.folded && fold1.mark === "▸"
            && fold1.saved === JSON.stringify([["asv_nogokey_fold_v1", true]]) && W2.key.classList.contains("folded"),
      () => JSON.stringify({ shown, fold0, fold1, startsFolded: W2.key.classList.contains("folded") }));

// ---- 4. the wiring ---------------------------------------------------------------------------------------------- //
const upd = grab("updateNogoUI");
check("4. IT IS THE CHART'S, WIRED: the page imports NOGO_KEY from chartlayers.js (the module that draws), has the "
      + "#nogoKey element, builds it at load, refreshes it with the NOGO button (updateNogoUI), and the controls window hides it",
      () => /INK, HATCH, hatch, drawLawBands as clDrawLawBands, NOGO_KEY \} from "\/static\/js\/chartlayers\.js";/.test(H)
            && /<div class="nogokey" id="nogoKey" style="display:none">\s*<div class="nkhead" id="nogoKeyHead"[^>]*>NOGO KEY<span class="nkfold" id="nogoKeyFold"[^>]*><\/span><\/div>\s*<div class="nkbody" id="nogoKeyBody"><\/div>\s*<\/div>/.test(H)
            && /\nnogoKeyBuild\(\);[^\n]*\n/.test(H) && /nogoKeyShow\(\);/.test(upd)
            && /"body\.ui-controls #nogoKey\{display:none!important;\}"/.test(H),
      () => "");
// 5. MOVED AND RESIZED like every chart card (Andy, the same day: "cannot be moved around"): the shared mechanisms, the key
// built before them (they find its body and header), its place and size kept by them
const rcards = (H.match(/const RESIZABLE_CARDS = \[[\s\S]*?\n\];/) || [""])[0];
check("5. IT MOVES AND RESIZES LIKE EVERY CHART CARD: registered with the one drag mechanism by its header - its own "
      + "position key, its bottom anchor released, the fold button no grip - and with the one resize mechanism (its body "
      + "the part that grows); built before both; folded, it gives up the resize and the minimum height",
      () => /makeDraggablePanel\(\$\("#nogoKey"\), \$\("#nogoKeyHead"\), \{key: NOGO_KEY_POS_KEY, unanchor: "bottom", ignore: "#nogoKeyFold"\}\);/.test(H)
            && /NOGO_KEY_POS_KEY = "asv_nogokey_pos_v1"/.test(H)
            && /\{sel:"#nogoKey",\s*body:"\.nkbody"\}/.test(rcards)
            && /\nnogoKeyBuild\(\);[^\n]*\nmakeCardsResizable\(\);/.test(H)
            && H.indexOf("\nnogoKeyBuild();") < H.indexOf('makeDraggablePanel($("#nogoKey")')
            && /\.nogokey\.folded\{min-height:0;height:auto!important;resize:none;\}/.test(H)
            && /\.nogokey \.nkhead\{cursor:move;/.test(H),
      () => "");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
