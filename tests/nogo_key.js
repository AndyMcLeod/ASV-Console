// tests/nogo_key.js - THE NOGO KEY (Andy, 2026-10-18: "Need a NOGO key so the user knows what color is representing what
// component.").
//
// The key's rows are static/js/chartlayers.js NOGO_KEY, built into the chart window by the page's nogoKeyBuild and shown
// while the NOGO overlay is (nogoKeyShow, from updateNogoUI). A key that names a color the overlay does not draw, or misses
// one it does, tells the operator something false about the chart. So:
//   1. every color, dash and line width in the key is one drawNogo draws with, and every color drawNogo draws with is in
//      the key - a color changed on one side and not the other fails;
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
// ASV_HTML / ASV_CL point this at SIDECAR copies for a mutation run, never the real files.
const H = fs.readFileSync(process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html"), "utf8").split("\r\n").join("\n");
const CL_PATH = process.env.ASV_CL || path.join(__dirname, "..", "static", "js", "chartlayers.js");
const CLS = fs.readFileSync(CL_PATH, "utf8");
const { NOGO_KEY } = require(CL_PATH);

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

// ---- 1. the key's colors are drawNogo's, both ways ------------------------------------------------------------- //
const DN = CLS.slice(CLS.indexOf("export function drawNogo("), CLS.indexOf("export function drawLawBands("));
const drawn = new Set((DN.match(/rgba\([^)]*\)/g) || []).concat(DN.match(/"#[0-9a-fA-F]{3,8}"/g) || []).map(c => c.replace(/"/g, "")));
const keyed = new Set(NOGO_KEY.flatMap(k => [k.fill, k.stroke, k.edge].filter(Boolean)));
const dashesDrawn = new Set((DN.match(/setLineDash\(\[(\d+),\s*(\d+)\]\)/g) || []).map(s => s.match(/\d+/g).join(" ")));
const dashesKeyed = new Set(NOGO_KEY.filter(k => k.dash).map(k => k.dash));
const widthsDrawn = new Set((DN.match(/lineWidth=([\d.]+)/g) || []).map(s => +s.split("=")[1]));
const widthsKeyed = NOGO_KEY.filter(k => k.width != null).map(k => k.width);
check("1. EVERY COLOR THE OVERLAY DRAWS IS IN THE KEY, AND THE KEY NAMES NO OTHER: the fills and strokes of drawNogo "
      + "(chartlayers.js) and the key's rows are the same set; so are its dash patterns; every width the key gives is one "
      + "drawNogo strokes with",
      () => drawn.size >= 8 && [...drawn].every(c => keyed.has(c)) && [...keyed].every(c => drawn.has(c))
            && dashesDrawn.size === 2 && [...dashesDrawn].every(d => dashesKeyed.has(d)) && [...dashesKeyed].every(d => dashesDrawn.has(d))
            && widthsKeyed.every(w => widthsDrawn.has(w)),
      () => JSON.stringify({ drawnNotKeyed: [...drawn].filter(c => !keyed.has(c)), keyedNotDrawn: [...keyed].filter(c => !drawn.has(c)),
                             dashesDrawn: [...dashesDrawn], dashesKeyed: [...dashesKeyed], widthsKeyed }));

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
  const w = { key: mkEl("div"), saved: [], V: { NOGO_MIN_DEPTH_M: 2.8 }, nogo: { ready: true } };
  const src = "let nogoShow = true;\n" + grabDecl("NOGO_KEY_FOLD_KEY") + "\n" + grabDecl("nogoKeyTexts") + "\n"
    + ["nogoKeySwatch", "nogoKeyBuild", "nogoKeyShow"].map(grab).join("\n")
    + "\nreturn {nogoKeyBuild, nogoKeyShow, nogoKeySwatch, setShow: v => { nogoShow = v; }};";
  // eslint-disable-next-line no-new-func
  w.api = new Function("$", "document", "lsGet", "lsSet", "NOGO_KEY", "V", "nogo", src)(
    s => (s === "#nogoKey" ? w.key : null), { createElement: mkEl },
    (k, d) => (k === "asv_nogokey_fold_v1" && stored !== undefined ? stored : d), (k, v) => w.saved.push([k, v]),
    NOGO_KEY, w.V, w.nogo);
  w.api.nogoKeyBuild();
  w.rows = () => w.key.kids[1].kids;
  w.texts = () => w.rows().map(r => r.kids[0].textContent);
  return w;
}
const W = mkWorld();
const rows = W.rows();
const swatchOk = rows.length === NOGO_KEY.length && rows.every((r, i) => {
  const k = NOGO_KEY[i], svg = r.innerHTML;
  return /^<svg [^>]*>.*<\/svg>$/.test(svg) && !/undefined|null/.test(svg)
         && [k.fill, k.stroke, k.edge].filter(Boolean).every(c => svg.includes(c)) && (!k.dash || svg.includes(`stroke-dasharray="${k.dash}"`));
});
const texts = W.texts();
check("2. THE PAGE BUILDS ONE ROW PER ENTRY: each swatch an SVG in its entry's own colors (and dash), each label its "
      + "entry's words with the depth floor in force (2.8 m here) and no placeholder left",
      () => swatchOk && texts.every((t, i) => t === NOGO_KEY[i].label.replace("{floor}", "2.8 m")) && /2\.8 m/.test(texts[0])
            && !texts.some(t => t.includes("{floor}")),
      () => JSON.stringify({ rows: rows.length, keys: NOGO_KEY.length, swatchOk, first: texts[0] }));

const shown = {};
shown.ready = W.key.style.display;
W.api.setShow(false); W.api.nogoKeyShow(); shown.overlayOff = W.key.style.display;
W.api.setShow(true); W.nogo.ready = false; W.api.nogoKeyShow(); shown.notReady = W.key.style.display;
W.nogo.ready = true; W.V.NOGO_MIN_DEPTH_M = 1.0; W.api.nogoKeyShow(); shown.back = W.key.style.display; shown.floor = W.texts()[0];
const head = W.key.kids[0], mark = head.kids[0];
const fold0 = { folded: W.key.classList.contains("folded"), mark: mark.textContent };
head.onclick();
const fold1 = { folded: W.key.classList.contains("folded"), mark: mark.textContent, saved: JSON.stringify(W.saved) };
const W2 = mkWorld(true);
check("3. SHOWN EXACTLY WHILE THE OVERLAY IS: shown with the overlay on and the zones read, hidden with the overlay off or "
      + "the zones not yet read, shown again after; a new vessel's floor reaches the label; the header folds the key and "
      + "the fold is kept, and a key built with it kept starts folded",
      () => shown.ready === "" && shown.overlayOff === "none" && shown.notReady === "none" && shown.back === "" && /1\.0 m/.test(shown.floor)
            && !fold0.folded && fold0.mark === "▾" && fold1.folded && fold1.mark === "▸"
            && fold1.saved === JSON.stringify([["asv_nogokey_fold_v1", true]]) && W2.key.classList.contains("folded"),
      () => JSON.stringify({ shown, fold0, fold1, startsFolded: W2.key.classList.contains("folded") }));

// ---- 4. the wiring ---------------------------------------------------------------------------------------------- //
const upd = grab("updateNogoUI");
check("4. IT IS THE CHART'S, WIRED: the page imports NOGO_KEY from chartlayers.js (the module that draws), has the "
      + "#nogoKey element, builds it at load, refreshes it with the NOGO button (updateNogoUI), and the controls window hides it",
      () => /drawLawBands as clDrawLawBands, NOGO_KEY \} from "\/static\/js\/chartlayers\.js";/.test(H)
            && /<div class="nogokey" id="nogoKey" style="display:none"><\/div>/.test(H)
            && /\nnogoKeyBuild\(\);\n/.test(H) && /nogoKeyShow\(\);/.test(upd)
            && /"body\.ui-controls #nogoKey\{display:none!important;\}"/.test(H),
      () => "");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
