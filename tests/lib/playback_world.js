// tests/lib/playback_world.js - the playback page's OWN functions, evaluated where a suite can call them.
//
// ⚠ EVERY TOP-LEVEL FUNCTION, NOT A NAMED LIST (2026-11-05, the mission record). tests/playback_cards.js used to grab
// fourteen named functions, so a helper parseSession or cardsAt started calling was a ReferenceError in its world -
// "check 0 crashed" - however right the page was. The page is one classic <script> whose functions are globals;
// this lifts all of them (brace-matched, strings / template literals / comments skipped) plus every UPPERCASE top-level
// `const` (single-line, or an object literal ending in "\n};"), in source order, and declares the page's data globals in
// a preamble. A function that touches the DOM is lifted too and simply never called here.
//
//   const W = require("./lib/playback_world.js");
//   const w = W.world(EVENTS, { window: { PBK } });    // parseSession() has run over EVENTS
//   w.fn.cardsAt(t);  w.g().FIXES;  w.parse(OTHER_EVENTS);
//
// ASV_PLAYBACK names a SIDECAR copy of the page for a mutation run (never mutate static/playback.html in place).
"use strict";
const fs = require("fs");
const path = require("path");

const PAGE = () => process.env.ASV_PLAYBACK || path.join(__dirname, "..", "..", "static", "playback.html");

function source(file) {
  return fs.readFileSync(file || PAGE(), "utf8").split("\r\n").join("\n");
}

// Skip a quoted string / template literal / comment starting at i; returns the index just past it, or -1 if none.
function skipLexeme(H, i) {
  const c = H[i], d = H[i + 1];
  if (c === "/" && d === "/") { const j = H.indexOf("\n", i); return j < 0 ? H.length : j; }
  if (c === "/" && d === "*") { const j = H.indexOf("*/", i + 2); return j < 0 ? H.length : j + 2; }
  if (c === '"' || c === "'") {
    let k = i + 1;
    while (k < H.length && H[k] !== c) { if (H[k] === "\\") k++; if (H[k] === "\n") break; k++; }
    return k + 1;
  }
  if (c === "`") {
    let k = i + 1;
    while (k < H.length && H[k] !== "`") {
      if (H[k] === "\\") { k += 2; continue; }
      if (H[k] === "$" && H[k + 1] === "{") { k = matchClose(H, k + 1, "{", "}") + 1; continue; }
      k++;
    }
    return k + 1;
  }
  return -1;
}
// The index of the bracket closing the one at `open` (H[open] === o).
function matchClose(H, open, o, c) {
  let depth = 0;
  for (let k = open; k < H.length;) {
    const s = skipLexeme(H, k);
    if (s >= 0) { k = s; continue; }
    if (H[k] === o) depth++;
    else if (H[k] === c) { depth--; if (!depth) return k; }
    k++;
  }
  throw new Error("unbalanced " + o + c + " from offset " + open);
}

// Every top-level function declaration: [{name, text, at}]
function functions(H) {
  const out = [], re = /^(async )?function ([A-Za-z_$][\w$]*)\(/gm;
  let m;
  while ((m = re.exec(H))) {
    const at = m.index, paren = at + m[0].length - 1;
    const close = matchClose(H, paren, "(", ")");
    const body = H.indexOf("{", close);
    const end = matchClose(H, body, "{", "}");
    out.push({ name: m[2], text: H.slice(at, end + 1), at });
    re.lastIndex = end + 1;
  }
  return out;
}
// Every UPPERCASE top-level const: one line, or an object literal closing on its own "};" line.
function consts(H) {
  const out = [];
  for (const re of [/^const ([A-Z][A-Z0-9_]*) = [^\n]*;[ \t]*(?:\/\/[^\n]*)?$/gm, /^const ([A-Z][A-Z0-9_]*) = \{[\s\S]*?\n\};/gm]) {
    let m;
    while ((m = re.exec(H))) out.push({ name: m[1], text: m[0], at: m.index });
  }
  return out.sort((a, b) => a.at - b.at);
}
// The text of one function, as tests/playback_cards.js check 6 reads it.
function grab(H, name) {
  const f = functions(H).find((x) => x.name === name);
  if (!f) throw new Error("test setup: function " + name + " not found in playback.html");
  return f.text;
}

// The page's data globals, and the cursor / view `let`s applyAt and render read (a suite drives applyAt with a fake DOM
// passed as INJ.$). Lower-case top-level `let`s are not lifted, so each one a lifted function reads is declared here.
const GLOBALS = "let FIXES = [], STATES = [], MARKS = [], AIS = [], CLIENT = {}, PB = null, T0 = 0, T1 = 0, DUR = 0;\n"
  + "    let pt = 0, playing = false, draggingScrub = false, zoom = 14, center = {lat: 0, lon: 0}, follow = true,\n"
  + "        showTrack = true, showPlan = true, showTgt = true, showKo = true, showEnv = true;";

function world(EVENTS, inj, file) {
  const H = source(file);
  const F = functions(H), C = consts(H);
  const names = F.map((f) => f.name);
  // eslint-disable-next-line no-new-func
  const make = new Function("INJ", `"use strict";
    ${GLOBALS}
    let EVENTS = INJ.EVENTS || [];
    const window = INJ.window || {};
    const $ = INJ.$ || (() => null);
    ${C.map((c) => c.text).join("\n")}
    ${F.map((f) => f.text).join("\n")}
    if (INJ.parse !== false) parseSession();
    return {
      fn: { ${names.join(", ")} },
      g: () => ({ FIXES, STATES, MARKS, AIS, CLIENT, PB, T0, T1, DUR, EVENTS, pt }),
      set: (k, v) => { if (k === "playing") playing = v; else if (k === "zoom") zoom = v; else throw new Error("set: " + k); },
      parse: (ev) => { EVENTS = ev; parseSession(); return { FIXES, STATES, MARKS, AIS, CLIENT, PB, T0, T1, DUR }; },
      window,
    };`);
  const w = make(Object.assign({}, inj || {}, { EVENTS }));
  w.H = H; w.names = names; w.consts = C.map((c) => c.name);
  return w;
}

// A stand-in DOM for applyAt and the timeline: one stub element per selector (made on first ask, then the same one), with
// a classList that COUNTS every add / remove / toggle - how a suite measures what one frame touched.
function fakeDom() {
  const els = {}, stats = { classOps: 0 };
  const make = () => {
    const cls = new Set();
    return {
      textContent: "", className: "", innerHTML: "", value: 0, style: {}, dataset: {}, children: [],
      offsetTop: 0, scrollTop: 0, clientHeight: 100,
      classList: {
        toggle(c, on) { stats.classOps++; const want = on === undefined ? !cls.has(c) : !!on; if (want) cls.add(c); else cls.delete(c); return want; },
        add(c) { stats.classOps++; cls.add(c); },
        remove(c) { stats.classOps++; cls.delete(c); },
        contains(c) { return cls.has(c); },
        has: (c) => cls.has(c),
      },
    };
  };
  const $ = (sel) => els[sel] || (els[sel] = make());
  $.els = els; $.stats = stats; $.make = make;
  return $;
}

module.exports = { PAGE, source, functions, consts, grab, world, fakeDom };
