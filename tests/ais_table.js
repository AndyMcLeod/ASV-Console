// tests/ais_table.js - the AIS traffic list is PATCHED, never rebuilt.
//
// WHY THIS EXISTS. renderAisTable() used to assign el.innerHTML on every poll, so every
// 8 seconds the whole body was destroyed and re-created. Andy reported it as the card
// "blanking and rewriting every cycle", and it cost three things at once:
//
//   * THE SCROLL POSITION. The card is `.rsz` - resize:both, overflow:auto - so a list of
//     traffic scrolls. Rebuilding the contents reset it to the top while you were reading.
//   * ANY TEXT SELECTION. Half-way through selecting an MMSI to copy, the node vanished.
//   * A visible flash, and the loss of the row's hover title while it was being replaced.
//
// Rows are now keyed by MMSI and reused: only cells whose text actually CHANGED are
// written, re-sorting MOVES the existing node with insertBefore, and contacts that drop out
// of range are removed. Nothing the operator is touching is destroyed.
//
//   node tests/ais_table.js      # exit 0 = pass, 1 = fail   (stdlib Node, no deps)
//
// These are SOURCE-SHAPE assertions plus one behavioural check on the cell writer, in the
// house style of ui_split.js and panel_drag.js: the patch algorithm needs a DOM, and which
// nodes a browser preserves is not observable from Node. THE LIVE BEHAVIOUR WAS VERIFIED IN
// A REAL BROWSER and is worth recording, because these checks cannot see it:
//
//     a stamped row survived a poll as the SAME NODE (dataset stamp intact)
//     the card's scrollTop stayed at 90 across an update
//     a text selection ("VESSEL 5") survived the same update
//     values still updated: 1.5 -> 6.9 nm, brg 9 -> 2, sog 10 -> 13
//     a contact that dropped out was removed; a newcomer was added and sorted to the top
//     a row re-sorted from last to first was the SAME NODE (moved, not remade)
//     empty -> hides the table, keeps the skeleton, leaves no stale rows; and refills
//
// TEETH (verified by mutation, with the checks each one produces):
//     renderAisTable assigns innerHTML again (the reported fault)   -> 1
//     the status line is rewritten every cycle rather than on change -> 1b
//     the skeleton is rebuilt every call instead of once            -> 2
//     rows stop carrying data-mmsi                                  -> 3
//     the existing row is never looked up, so every row is remade   -> 4
//     re-sorting appends instead of insertBefore                    -> 5
//     vanished contacts are no longer removed                       -> 6
//     setCellText writes unconditionally (kills a live selection)   -> 7
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

const RENDER = grab("renderAisTable");
const SKELETON = grab("ensureAisSkeleton");
const MAKEROW = grab("aisMakeRow");

console.log("AIS traffic list — patched in place, so nothing you are reading is destroyed:");

// 1. THE REPORTED FAULT. An innerHTML assignment anywhere in the per-cycle path throws away
// every row, and with them the scroll position and any selection. The skeleton builder is
// allowed exactly one, which is why it lives in its own function (check 2).
const renderInnerHtml = /\.innerHTML\s*=/.test(RENDER.replace(/statusEl\.innerHTML\s*=/g, ""));
check("1. THE REPORTED FAULT: renderAisTable does not assign innerHTML to the list",
      () => !renderInnerHtml,
      "rebuilding the body every 8 s is what reset the scroll and dropped selections");

// The status LINE may be rewritten - it is one short element with nothing selectable to
// lose - but only when it actually changed, or it churns for no reason.
check("1b. ... and the status line is only rewritten when it has CHANGED",
      () => /if\s*\(\s*statusEl\.innerHTML\s*!==\s*status\s*\)/.test(RENDER),
      "an unconditional write would churn the one element that is rebuilt");

// 2. The furniture is built ONCE, guarded by an existence test - not re-created per poll.
check("2. the skeleton is built once, guarded by a check that it is already there",
      () => /if\s*\(\s*el\.querySelector\("#aisRowsBody"\)\s*\)\s*return;/.test(SKELETON)
            && /\.innerHTML\s*=/.test(SKELETON),
      "one innerHTML, in the builder, behind an early return");

// 3-4. Row identity is what makes the patch possible: without a stable key every row is a
// new node and nothing is preserved.
check("3. rows are keyed by MMSI, so a contact keeps its node between polls",
      () => /tr\.dataset\.mmsi\s*=/.test(RENDER) && /dataset\.mmsi/.test(RENDER),
      "the key is the identity - no key, no reuse");

check("4. an existing row is looked up and REUSED before a new one is made",
      () => /existing\.get\(key\)/.test(RENDER) && /aisMakeRow\(\)/.test(RENDER)
            && /if\s*\(\s*tr\s*\)\s*existing\.delete\(key\)/.test(RENDER),
      "found -> reuse; missing -> create. Creating unconditionally is the old behaviour");

// 5. Sorting by range means the order changes constantly. Moving a node preserves it;
// re-creating it in the new position does not.
check("5. re-sorting MOVES the existing node rather than rebuilding it",
      () => /insertBefore\(tr,\s*body\.children\[i\]/.test(RENDER),
      "insertBefore on a node already in the tree is a move, not a copy");

// 6. The other half of a patch: rows for contacts that are gone must go, or the list grows
// forever and shows traffic that is no longer there.
check("6. contacts that dropped out of range are removed",
      () => /for\s*\(\s*const tr of existing\.values\(\)\s*\)\s*tr\.remove\(\)/.test(RENDER),
      "whatever was not claimed this cycle is stale");

// 7. BEHAVIOURAL. Writing an identical string to a text node still collapses a selection
// inside it, so the guard is not an optimisation - it is the reason a selection survives a
// poll where nothing about that row changed.
eval(grab("setCellText"));
const writes = [];
const fakeNode = { _t: "1.5", get textContent() { return this._t; },
                   set textContent(v) { writes.push(v); this._t = v; } };
setCellText(fakeNode, "1.5");                       // unchanged - must not write
setCellText(fakeNode, "6.9");                       // changed - must write
setCellText(null, "x");                             // a missing cell must not throw
check("7. a cell is written ONLY when its text changed",
      () => writes.length === 1 && writes[0] === "6.9" && fakeNode.textContent === "6.9",
      () => "writes: " + JSON.stringify(writes) + " (an identical write still kills a selection)");

// 8. The row template must carry the two spans the patch addresses, or the cell writes
// silently target nothing - setCellText tolerates a missing node, so this would not throw.
check("8. the row template provides the marker and name spans the patch writes to",
      () => /class="aisMk"/.test(MAKEROW) && /class="aisNm"/.test(MAKEROW)
            && /querySelector\("\.aisNm"\)/.test(RENDER) && /querySelector\("\.aisMk"\)/.test(RENDER),
      "setCellText ignores a null node, so a typo here would fail silently");

// --- AIS CONTACTS: the same glyph as our own boat, in the operator's colours ----------
// Andy, 2026-08-28: "it will be an isosceles triangle with the sharp end pointed toward
// the line of travel. green for cargo vessels, grey for military, blue for fishing, black
// for tug or tug and tow and pink for sailing."
{
  const H2 = require("fs").readFileSync(
    require("path").join(__dirname, "..", "static", "asv.html"), "utf8");
  const grabDecl2 = (name) => {
    for (const kw of ["const ", "let "]) {
      const i = H2.indexOf(kw + name + " =");
      if (i >= 0) return H2.slice(i, H2.indexOf("};", i) + 2);
    }
    throw new Error("test setup: " + name + " not found (renamed?)");
  };
  // eval it as an EXPRESSION: `const` inside a direct eval is lexical to that eval,
  // so declaring it there leaves the name here undefined (the same trap twice today).
  const AIS_COL = eval("(" + grabDecl2("AIS_COL")
        .replace(/^const\s+AIS_COL\s*=\s*/, "").replace(/;\s*$/, "") + ")");
  const hex = (c) => String(c || "").toLowerCase();
  const lum = (c) => { const n = parseInt(hex(c).slice(1), 16);
    return (0.2126*((n>>16)&255) + 0.7152*((n>>8)&255) + 0.0722*(n&255)) / 255; };

  // 10. THE FIVE THE OPERATOR NAMED. Asserted by HUE, not by matching a hex string: the
  // requirement is "green", not "#3fbf6b", and pinning the literal would make a legibility
  // tweak within the same colour read as a regression.
  const isGreen = (c)=>{ const n=parseInt(hex(c).slice(1),16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
    return g > r + 40 && g > b + 40; };
  const isBlue  = (c)=>{ const n=parseInt(hex(c).slice(1),16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
    return b > r + 40 && b >= g; };
  const isPink  = (c)=>{ const n=parseInt(hex(c).slice(1),16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
    return r > 180 && b > 140 && g < r - 40; };
  const isGrey  = (c)=>{ const n=parseInt(hex(c).slice(1),16), r=(n>>16)&255, g=(n>>8)&255, b=n&255;
    return Math.max(r,g,b) - Math.min(r,g,b) < 24 && lum(c) > 0.4; };
  const isBlack = (c)=> lum(c) < 0.15;
  check("10. cargo is GREEN, military GREY, fishing BLUE, tug BLACK, sailing PINK",
        isGreen(AIS_COL.cargo) && isGrey(AIS_COL.military) && isBlue(AIS_COL.fishing)
        && isBlack(AIS_COL.tug) && isPink(AIS_COL.sailing),
        "cargo " + AIS_COL.cargo + ", military " + AIS_COL.military + ", fishing "
        + AIS_COL.fishing + ", tug " + AIS_COL.tug + ", sailing " + AIS_COL.sailing);

  // 11. NO TWO CATEGORIES SHARE A COLOUR. Two ship types the same colour on a crowded
  // harbour is the same as having no colour scheme - and adding the operator's five DID
  // collide with what was there (passenger held the green, hsc a pink close to sailing's).
  {
    const seen = new Map(), dupes = [];
    for (const k of Object.keys(AIS_COL)) {
      if (k === "unknown") continue;                 // deliberately shares `other`'s grey
      const c = hex(AIS_COL[k]);
      if (seen.has(c)) dupes.push(seen.get(c) + "/" + k); else seen.set(c, k);
    }
    check("11. no two ship categories are drawn the same colour",
          dupes.length === 0, dupes.length ? dupes.join(", ") : Object.keys(AIS_COL).length + " categories");
  }

  // 12. A BLACK HULL ON A NEAR-BLACK CHART NEEDS A LIGHT EDGE, or the tug is invisible.
  // The outline is picked from the fill's luminance rather than fixed, so this holds for
  // any colour added later - which is why it is asserted through the real function.
  {
    // the eval brings its OWN `function glyphOutline` declaration into this scope,
    // so declaring one here as well is a redeclaration - let the source provide it
    eval((()=>{ const i=H2.indexOf("function glyphOutline(");
      let k=H2.indexOf("{", i), d=0; for(;;){ const c=H2[k]; if(c==="{")d++; else if(c==="}"){d--; if(!d)break;} k++; }
      return H2.slice(i, k+1); })());
    const onTug = glyphOutline(AIS_COL.tug), onGrey = glyphOutline(AIS_COL.military);
    check("12. a dark hull gets a LIGHT outline and a light hull a dark one",
          lum(onTug.match(/\d+/g) ? "#ffffff" : onTug) > 0.5 || /2[0-9]{2}/.test(onTug),
          "tug outline " + onTug + " | military outline " + onGrey);
    check("12b. ... and they are not the same outline, or the rule is doing nothing",
          onTug !== onGrey, onTug + " vs " + onGrey);
  }

  // 13. THE CONTACT IS DRAWN BY THE SAME GLYPH AS OUR OWN VESSEL. One shape, one idea of
  // which way forward is; a second triangle drawn inline would be free to disagree.
  check("13. AIS contacts use the shared vessel glyph, scaled - not their own shape",
        /drawVesselGlyph\(ctx, s\.x, s\.y,[^)]*0\.62\)/.test(H2)
        && !/moveTo\(0,-7\); ctx\.lineTo\(5,6\)/.test(H2),
        "the old inline dart is gone and the shared glyph is called");
}


console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
