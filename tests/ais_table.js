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
// AND FOR THE SORTABLE CPA COLUMN (2026-09-02), seven more mutations RUN:
//     CPA sorted as a plain number (state rank dropped)             -> 14, 15, 16, 17b
//     the state rank REVERSED along with the column                 -> 15, 16, 17
//     an absent value sorted FIRST instead of last                  -> 17c
//     the opening marker dropped from the cell                      -> 18
//     the renderer stops writing the CPA cell                       -> 19
//     the header repainted on every poll                            -> 20
//     the click listener re-attached on every repaint               -> 20b
//
// AND FOR THE STABILITY PASS + TCPA COLUMN (2026-09-08), twelve more mutations RUN, all
// twelve killed. Andy: "The entire AIS traffic card blinks and resets data with each update.
// Make it visually stable and update values independently... Add TCPA after the CPA column."
//     a contact missing ONE update is removed again (the blink)   -> 6d
//     a contact gone for good is never removed                    -> 6, 6d
//     a held contact is not dimmed, so stale data looks live      -> 6b, 6d
//     a contact that reports again stays faded for ever           -> 6c
//     setCellText replaces the text node instead of editing it    -> 7b
//     setCellText writes unconditionally (kills a selection)      -> 7b
//     the status line goes back to a rebuilt innerHTML            -> 1, 1b
//     the TCPA column is declared but never written               -> 19
//     TCPA placed BEFORE cpa                                      -> 17d
//     a PAST cpa printed as a countdown                           -> 17e
//     holding station given an invented time of zero              -> 17f
//     the row template loses a cell (last column silently blank)  -> 19
//
// ⚠⚠ AND THE FIRST RUN OF THOSE TWELVE REPORTED 0 KILLED, WHICH WAS THE RUNNER AND NOT THE
// CHECKS. This suite read static/asv.html by a FIXED PATH, so a runner pointing ASV_HTML at a
// sidecar mutated a file the suite never opened and every mutation "survived". Twelve of
// twelve surviving is not twelve weak checks, it is a harness fault - the same shape as the
// `FAIL 17c.` scraper note above. It honors ASV_HTML now.
//
// ⚠ TWO OF THE TWELVE THEN SURVIVED HONESTLY, and both were source-shape checks standing in
// for behaviour. Setting `miss = 2` walked past 6, 6b and 6c with every line they look for
// still present and doing the wrong thing - that is the REPORTED FAULT, unguarded - so 6d
// lifts the real sweep out of renderAisTable and drives it over two updates. And 7b asserted
// `nodeValue === "1.5"` after an unchanged write, which is true whether or not it was
// written; it spies on the setter now.
//
// ⚠ 17c EXISTS BECAUSE A MUTATION FOUND NOTHING TO KILL. Breaking `nullLast` so an absent
// value sorts FIRST left every check green: in the CPA column a contact with no track is
// caught by `cpaRank` before nullLast is ever consulted, so the null handling that actually
// governs the brg and kn columns was not being exercised at all.
//
// ⚠⚠ AND THE RUN THAT FOUND IT FIRST REPORTED "SURVIVED", WRONGLY - because the mutation
// runner's own scraper was `FAIL (\d+b?)\.`, which cannot match `FAIL 17c.`. The check was
// failing correctly and the harness could not see it. A mutation runner that cannot parse
// its own suite's check IDs reports false survivals, which is the most expensive kind of
// wrong: it sends you hunting for a hole in code that does not have one.
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

// ASV_HTML points this at a SIDECAR copy for a mutation run. Without it the only way to
// mutate what this suite reads is to edit static/asv.html itself, and a runner killed
// mid-flight then leaves the operator's real source mutated. Worse, a runner that sets
// ASV_HTML against a suite that ignores it reports every mutation as SURVIVED - twelve of
// twelve on 2026-09-08, which is a runner fault wearing the costume of twelve weak checks.
const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8");

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
// The column list itself, so the column checks are derived from what the page declares
// rather than from a number written here that goes stale the day a column is added.
const HEADCOLS = (() => {
  const i = H.indexOf("const AIS_HEAD_COLS");
  if (i < 0) throw new Error("anchor gone: AIS_HEAD_COLS (renamed?)");
  return H.slice(i, H.indexOf(";", i) + 1);
})();

console.log("AIS traffic list — patched in place, so nothing you are reading is destroyed:");

// 1. THE REPORTED FAULT. An innerHTML assignment anywhere in the per-cycle path throws away
// every row, and with them the scroll position and any selection. The skeleton builder is
// allowed exactly one, which is why it lives in its own function (check 2).
const renderInnerHtml = /\.innerHTML\s*=/.test(RENDER.replace(/statusEl\.innerHTML\s*=/g, ""));
check("1. THE REPORTED FAULT: renderAisTable does not assign innerHTML to the list",
      () => !renderInnerHtml,
      "rebuilding the body every 8 s is what reset the scroll and dropped selections");

// THE STATUS LINE IS NOT REWRITTEN AT ALL ANY MORE. It used to be one guarded innerHTML
// assignment, on the argument that it is short and has nothing selectable to lose - but it
// carries "nearest 0.2 nm", which changes on EVERY update, so the guard never held and the
// headline at the top of the card was re-parsed every 8 s while the rows beneath it were
// being carefully patched. It is three fixed spans now (dot, main, faint note), painted
// through the same setCellText the cells use. Andy, 2026-09-08: "The entire AIS traffic card
// blinks and resets data with each update."
// ⚠ SCOPED TO CODE. Two traps in one line here. A bare /innerHTML/ matched the comment that
// explains what used to be there; narrowing to `.innerHTML =` was not enough either, because
// that comment QUOTES the retired statement verbatim - `statusEl.innerHTML = status` - which
// is exactly what a maintainer needs it to say. So the comments come off first, the way
// off_track does it. `[^\n]*` runs to the true end of the line, \r included: this file is
// CRLF and /\/\/.*$/ without /m cannot reach past the \r.
const RENDER_CODE = RENDER.split("\n").map(l => l.replace(/\/\/[^\n]*/, "")).join("\n");
check("1b. ... and the status line is PATCHED too, never re-parsed",
      () => !/\.innerHTML\s*=/.test(RENDER_CODE)
            && /#aisStMain/.test(RENDER) && /#aisStNote/.test(RENDER)
            && /setCellText\(el\.querySelector\("#aisStMain"\)/.test(RENDER),
      "the one part of the card that was still rebuilt on a timer");

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
//
// ⚠ BUT NOT ON THE FIRST MISS, since 2026-09-08. AIS is intermittent and the show-radius
// filter runs on the server, so a ship near the range edge drops out of one snapshot and is
// back in the next; removing its row the instant it missed made it BLINK in and out every
// 8 s. Reproduced with a feed dropping one contact on alternate polls. It is held for ONE
// update - dimmed, and saying so in its title, so stale data is never shown as live - and
// removed on the SECOND consecutive miss. Both halves are asserted: a list that never
// forgets is the fault this check was written for in the first place.
check("6. a contact gone for two updates is removed...",
      () => /if\(miss >= 2\)\{\s*tr\.remove\(\); continue; \}/.test(RENDER),
      "whatever has stopped reporting is stale, and must not sit there looking live");

check("6b. ...but ONE missed update only dims it, keeping the row and its node",
      () => /tr\.dataset\.miss = String\(miss\)/.test(RENDER)
            && /tr\.style\.opacity = "0\.45"/.test(RENDER)
            && /no report in this update/.test(RENDER),
      "AIS is intermittent: a single gap is not a contact that has gone");

check("6c. ...and a contact that reports again is un-dimmed in the same pass",
      () => /if\(tr\.dataset\.miss !== "0"\)\{ tr\.dataset\.miss = "0"; tr\.style\.opacity = ""; \}/.test(RENDER),
      "or the first gap would leave it faded for the rest of the session");

// 6d. BEHAVIOURAL, AND IT IS THE ONE THAT GUARDS THE REPORTED FAULT. 6-6c are source shape,
// and a mutation that simply set `miss = 2` walked straight past all three: every line they
// look for was still there, doing the wrong thing. So the real sweep is lifted out of
// renderAisTable and driven over two updates against fake rows.
{
  const at = RENDER.indexOf("for(const tr of existing.values()){");
  if (at < 0) throw new Error("anchor gone: the stale-row sweep in renderAisTable");
  let k = RENDER.indexOf("{", at), depth = 0, end = -1;
  for (;;) { const c = RENDER[k];
    if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) { end = k + 1; break; } } k++; }
  const sweep = new Function("existing", RENDER.slice(at, end));
  const mkRow = () => ({ dataset: {}, style: {}, title: "DELTA · tug",
                         gone: false, remove() { this.gone = true; } });

  const tr = mkRow();
  sweep(new Map([["444", tr]]));                       // update 1: no report
  const afterOne = { gone: tr.gone, miss: tr.dataset.miss, opacity: tr.style.opacity,
                     saysSo: /no report/.test(tr.title) };
  sweep(new Map([["444", tr]]));                       // update 2: still no report
  const afterTwo = { gone: tr.gone };

  check("6d. DRIVEN: one missed update holds the row, two removes it",
        () => afterOne.gone === false && afterOne.miss === "1"
              && afterOne.opacity === "0.45" && afterOne.saysSo && afterTwo.gone === true,
        () => "after 1 miss " + JSON.stringify(afterOne) + ", after 2 gone=" + afterTwo.gone);
}

// ⚠⚠ 6e. AND AN EMPTY UPDATE IS EVERY CONTACT MISSING AT ONCE. The per-contact grace 6d
// drives was unreachable for it: `if(!rows.length){ body.textContent = ""; return; }` sat
// ABOVE the sweep, so one empty snapshot wiped the whole body instantly - scroll position,
// selection and all - while a single missing contact got a dimmed row and an update of grace.
// The feeder empties the list on ANY throw, so one bad poll did it. That is the rest of what
// was reported: "The entire AIS traffic card blinks and resets data with each update."
// ⚠ 6d IS THE PAIR. It proves what the sweep DOES; this proves the empty path reaches it.
// Neither is worth much alone: a gate that lets an empty update through to a sweep that did
// not hold would still blink, and a sweep that holds but is never reached is dead code.
{
  const R = RENDER.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
  const gated = /if\(!rows\.length && !holding\)\{ body\.textContent = ""; return; \}/.test(R);
  const shows = /table\.style\.display = \(rows\.length \|\| holding\)/.test(R);
  const bare = /if\(!rows\.length\)\{ body\.textContent = ""; return; \}/.test(R);
  check("6e. an EMPTY update falls through to the grace sweep instead of wiping the body - "
        + "and the table stays visible while rows are held, or the grace would be invisible",
        () => gated && shows && !bare,
        () => "empty-path return gated on held rows: " + gated
            + "; table visible while holding: " + shows
            + "; the old unconditional wipe still present: " + bare
            + " (asserted on comment-stripped source)");
}

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

// 7b. BEHAVIOURAL, and the other half of "update values independently". `textContent = s`
// DESTROYS the cell's text node and creates a new one, so every changed cell was a
// remove-plus-add in the DOM even though the ROW was correctly reused. Measured on a
// six-contact feed before the fix: 51 node removals and 51 insertions across three updates,
// with ZERO characterData mutations. After it: 6 and 6, with 71 characterData edits - the
// same values, written in place. This drives the real function against a node that HAS a
// text child, which is the case the shipped page always presents.
{
  // ⚠ nodeValue IS SPIED ON, not merely read back. Asserting `tnode.nodeValue === "1.5"`
  // after an unchanged write proves nothing - writing the same string leaves it looking
  // identical - so a mutation dropping the guard on THIS branch survived. The setter records
  // every write, which is the only way to see a write that changed nothing.
  const replaced = [], nvWrites = [];
  const tnode = { nodeType: 3, _v: "1.5",
                  get nodeValue() { return this._v; },
                  set nodeValue(v) { nvWrites.push(v); this._v = v; } };
  const cell = { firstChild: tnode, _t: "1.5",
                 get textContent() { return this._t; },
                 set textContent(v) { replaced.push(v); this._t = v; } };
  setCellText(cell, "1.5");                          // unchanged - nothing at all
  const untouched = nvWrites.length === 0 && replaced.length === 0;
  setCellText(cell, "6.9");                          // changed - EDIT, do not replace
  check("7b. ...and it EDITS the text node rather than replacing it",
        () => untouched && tnode.nodeValue === "6.9"
              && nvWrites.length === 1 && replaced.length === 0,
        () => "nodeValue writes: " + JSON.stringify(nvWrites)
              + ", textContent assignments: " + replaced.length
              + " (a textContent write is a node remove + add, and the browser relays out the cell)");
}

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
  const H2 = require("fs").readFileSync(ASV_HTML, "utf8");   // the same page as above
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


// ── 14-18. THE CPA COLUMN, AND WHY IT IS NOT SORTED AS A NUMBER ─────────────────────
//
// Andy, 2026-09-02: "add CPA as a sortable column on the AIS table."
//
// ⚠⚠ THE TRAP IS THAT CPA LOOKS LIKE A NUMBER AND MUST NOT BE ORDERED LIKE ONE. A contact
// that passed 10 m astern a minute ago has a SMALLER closest approach than a ship closing
// to 400 m, and a plain ascending sort puts it at the head of the list — which is exactly
// backwards for the one job a collision-ordered table has. The order is by STATE first
// (closing, then holding station, then opening, then no track) and by distance only within
// a state; and the state rank is NOT reversed when the column is, because "sort descending"
// must never promote a vessel that is leaving. Checks 14 and 15 are that rule from both
// sides, and the fixture's opening contact deliberately holds the smallest CPA in the set.
{
  eval(grab("cpaRank"));
  eval(grab("nullLast"));
  eval(grab("cpaCell"));
  // aisRowCmp closes over `aisSort` and `fmtDist`, both module state in the page. Give the
  // eval'd body its own rather than reaching into the real ones.
  let aisSort = { key: "cpa", dir: 1 };
  const fmtDist = (m) => (m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(2) + " km");
  eval(grab("aisRowCmp"));

  const R = (name, cpaM, tcpaS, closing) => ({
    v: { mmsi: name.length, name, sog: 5, cog: 90 }, rng: 100, brg: 90,
    cpa: cpaM == null ? null : { cpaM, tcpaS, closing, rangeM: 500, bearingDeg: 0 },
  });
  const CLOSE_NEAR = R("closing near", 334, 100, true);
  const CLOSE_FAR = R("closing far", 398, 260, true);
  const HOLDING = R("holding", 879, null, false);
  const OPENING = R("opening", 10, -40, false);        // the smallest number in the set
  const NOTRACK = R("no track", null);
  const order = (dir) => {
    aisSort = { key: "cpa", dir };
    return [OPENING, NOTRACK, HOLDING, CLOSE_FAR, CLOSE_NEAR].slice()
      .sort(aisRowCmp).map((r) => r.v.name);
  };
  const asc = order(1), desc = order(-1);

  check("14. a closing contact outranks one already opening, however small its CPA",
        () => asc.indexOf("opening") > asc.indexOf("closing far"),
        "ascending: " + asc.join(" < ") + "   (opening's CPA is 10 m, the smallest here)");
  check("15. ... and REVERSING the column does not promote it",
        () => desc.indexOf("opening") > desc.indexOf("closing near") && desc[0] === "closing far",
        "descending: " + desc.join(" < ") + "   (state rank is not reversed; distance is)");
  check("16. within the closing contacts the direction DOES reverse",
        () => asc[0] === "closing near" && desc[0] === "closing far",
        "asc heads with " + asc[0] + ", desc heads with " + desc[0]);
  check("17. a contact with no track sorts LAST whichever way the column points",
        () => asc[asc.length - 1] === "no track" && desc[desc.length - 1] === "no track",
        "an absence is not a small number: asc ends " + asc[asc.length - 1]
          + ", desc ends " + desc[desc.length - 1]);
  check("17b. ... and holding-station sits between the closing and the opening",
        () => asc.indexOf("holding") > asc.indexOf("closing far")
              && asc.indexOf("holding") < asc.indexOf("opening"),
        "converging on nothing, but not leaving either: " + asc.join(" < "));
  // ⚠ 17c EXISTS BECAUSE A MUTATION FOUND NOTHING TO KILL. Breaking `nullLast` so an
  // absent value sorts FIRST left every check above GREEN - because in the CPA column a
  // contact with no track is caught by `cpaRank` before nullLast is ever consulted. The
  // null handling actually governs the OTHER columns, where there is no state rank in
  // front of it, and nothing was exercising them at all.
  {
    const withSog = (n, sog) => ({ v: { mmsi: n, name: n, sog }, rng: 100, brg: sog, cpa: null });
    const rows = [withSog("none", null), withSog("fast", 12), withSog("slow", 3)];
    const by = (key, dir) => { aisSort = { key, dir };
      return rows.slice().sort(aisRowCmp).map((r) => r.v.name); };
    check("17c. an absent SPEED or BEARING also sorts last, in both directions",
          () => by("sog", 1)[2] === "none" && by("sog", -1)[2] === "none"
                && by("brg", 1)[2] === "none" && by("brg", -1)[2] === "none",
          "kn asc " + by("sog", 1).join(" < ") + " | kn desc " + by("sog", -1).join(" < ")
            + "   (these columns have no state rank in front of nullLast)");
  }
  // 17d-17f. THE TCPA COLUMN (Andy, 2026-09-08: "Add TCPA after the CPA column"). The time
  // to closest approach used to ride only in the row's hover title, so the one number that
  // says HOW LONG YOU HAVE was the one you had to hover to read.
  {
    eval(grab("tcpaFmt"));
    eval(grab("tcpaCell"));
    check("17d. TCPA is its own column, placed AFTER cpa",
          () => { const cols = (HEADCOLS.match(/\["(\w+)"/g) || []).map(s => s.slice(2, -1));
                  return cols.indexOf("tcpa") === cols.indexOf("cpa") + 1; },
          () => "columns: " + (HEADCOLS.match(/\["(\w+)"/g) || []).map(s => s.slice(2, -1)).join(" "));

    // ⚠ THE SIGN IS CARRIED, NOT CLAMPED - cpaOf documents tcpaS as NEGATIVE when the closest
    // approach is already past. Printing a past CPA as a countdown is the one wrong answer
    // that reads exactly like a working alarm, which is the same rule check 18 keeps for the
    // distance cell one column over.
    check("17e. a CLOSING contact counts down, an OPENING one reads negative",
          () => tcpaCell({cpaM: 300, tcpaS: 136, closing: true}) === "2m16s"
                && tcpaCell({cpaM: 300, tcpaS: -84, closing: false}) === "-84s",
          () => "closing -> '" + tcpaCell({cpaM:300,tcpaS:136,closing:true}) + "', opening -> '"
                + tcpaCell({cpaM:300,tcpaS:-84,closing:false}) + "'");

    check("17f. holding station has NO time, and says so rather than inventing one",
          () => tcpaCell({cpaM: 500, tcpaS: null, closing: false}) === "–"
                && tcpaCell(null) === "–",
          "a vessel converging on nothing has no moment of closest approach");
  }

  check("18. the cell MARKS a contact already opening, so its number is not misread",
        () => /↗/.test(cpaCell(OPENING.cpa)) && !/↗/.test(cpaCell(CLOSE_NEAR.cpa))
              && cpaCell(null) === "–",
        "opening -> '" + cpaCell(OPENING.cpa) + "', closing -> '" + cpaCell(CLOSE_NEAR.cpa)
          + "', no track -> '" + cpaCell(null) + "'");
}

// ── 19-20. THE COLUMN EXISTS, AND THE HEADER IS STILL NOT REBUILT EVERY POLL ────────
{
  const cells = (MAKEROW.match(/<td /g) || []).length;
  // The template, the renderer and the HEADER must all agree on how many columns there are,
  // or `tr.cells[n]` is undefined, setCellText silently writes nothing, and the whole column
  // is blank with every other check in this file still green.
  //
  // ⚠ DERIVED FROM AIS_HEAD_COLS, NOT HARD-CODED. This read `cells === 5` and asserted
  // `tr.cells[4]` by name, so adding the TCPA column on 2026-09-08 turned it red for a reason
  // that had nothing to do with a fault - and the column after that would have done the same.
  // It counts the DECLARED columns and requires the renderer to write every data cell, so
  // what goes red now is a column added to the header and forgotten in the renderer.
  const declared = (HEADCOLS.match(/\["/g) || []).length;
  const written = [];
  for (let i = 1; i < declared; i++)
    if (new RegExp("setCellText\\(tr\\.cells\\[" + i + "\\]").test(RENDER)) written.push(i);
  check("19. the row template, the header and the renderer agree on the columns",
        () => cells === declared && written.length === declared - 1,
        declared + " columns declared, " + cells + " cells in the template, renderer writes "
          + (written.length ? "cells[" + written.join("], cells[") + "]" : "none")
          + "  (cell 0 is the name, written through .aisNm)");
  // This card is PATCHED, never rebuilt — checks 1-9. The header is the one part that IS
  // re-rendered, so it is gated on the sort having actually moved: repainting it every 8 s
  // would fight the operator for the very click they are making on it.
  const HEAD = grab("aisPaintHead");
  check("20. the header is repainted only when the sort MOVES, not on every poll",
        () => /!aisRebuildHead\) return;/.test(HEAD) && /aisRebuildHead = false;/.test(HEAD),
        "gated on aisRebuildHead, which setAisSort and the skeleton builder set");
  check("20b. ... and its click listener is bound ONCE, not re-attached on every repaint",
        () => /row\.dataset\.bound/.test(HEAD),
        "a listener attached per repaint leaks one handler per sort click");
}


// ── 21-22. THE ROW CAP: what the headline counts, and who falls into the grace sweep ──
//
// The table draws at most AIS_MAX_ROWS rows. The cap used to be applied at the forEach
// alone, which left two faults in the same three lines.
//
// 21 - THE COUNT. The status line read `${rows.length} vessels` over sixty rows, with the
// range note underneath reading "whole lake - all contacts". Driven on the 94-contact feed
// the page's own comment cites from Lewes: "94 vessels · Lake Erie", sixty rows drawn, and
// nothing anywhere saying 60 of 94. A count the operator cannot reconcile with what they
// can see reads as a fault in the feed.
{
  // The headline expression itself, lifted out rather than retyped - a check that retyped
  // it would keep passing with the page's copy deleted.
  const at = RENDER.indexOf("stMain=(shown.length < rows.length");
  const end = RENDER.indexOf("stNote=", at);
  const src = at < 0 ? "" : RENDER.slice(at, end).replace(/^stMain=/, "").replace(/;\s*$/, "");
  const headline = (nShown, nRows) => {
    if (!src) return null;
    return new Function("shown", "rows", "aisAreaLabel",
                        "return " + src)({ length: nShown }, { length: nRows },
                                         () => "Lake Erie");
  };
  const capped = headline(60, 94), uncapped = headline(55, 55), one = headline(1, 1);
  check("21. the AIS headline counts the rows the operator can SEE, and says so when the "
        + "table is capped",
        () => capped === "60 of 94 vessels · Lake Erie"
              && uncapped === "55 vessels · Lake Erie"
              && one === "1 vessel · Lake Erie",
        () => "94 in the feed -> \"" + capped + "\"; 55 -> \"" + uncapped + "\"; 1 -> \""
            + one + "\". It read \"94 vessels\" over sixty rows, with the range note "
            + "underneath saying \"whole lake - all contacts\"");
  check("21b. ... and the cap is applied ONCE, so the count and the rows cannot disagree",
        () => /const AIS_MAX_ROWS = 60;/.test(RENDER)
              && /const shown = rows\.slice\(0, AIS_MAX_ROWS\);/.test(RENDER)
              && /shown\.forEach\(\(r, i\) =>/.test(RENDER)
              && !/rows\.slice\(0, 60\)/.test(RENDER),
        "two slices is how the headline and the table came to be counting different things");
}

// 22 - THE FALSE "NO REPORT". `existing` is built from the DOM and emptied only by the
// forEach, so a ship that had a row last poll and merely steamed out to rank 61st fell into
// the grace sweep: dimmed to 0.45, stamped data-miss=1, and titled "no report in this
// update" - with its LAST numbers frozen under a label asserting the opposite of the truth.
// Driven on the same feed: the contact reported 3 s ago at 12 kn, its row still showed
// 7.2 nm while it was at 17 nm, and on the next poll - still reporting - it vanished.
//
// ⚠ DRIVEN, LIKE 6d, because this is a loop over live state and a source grep passes just
// as happily with the rows left in `existing`.
{
  const at = RENDER.indexOf("for(const r of rows.slice(AIS_MAX_ROWS)){");
  check("22. a contact CUT BY THE CAP is dropped from the grace sweep, not dimmed as "
        + "missing",
        () => {
          if (at < 0) return false;
          let k = RENDER.indexOf("{", at), depth = 0, end = -1;
          for (;;) { const c = RENDER[k];
            if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) { end = k + 1; break; } } k++; }
          const cut = new Function("rows", "existing", "AIS_MAX_ROWS", RENDER.slice(at, end));
          const mk = () => ({ dataset: {}, style: {}, title: "VESSEL 30 · passenger",
                              gone: false, remove() { this.gone = true; } });
          const kept = mk(), dropped = mk();
          const rows = [{ v: { mmsi: 111 } }, { v: { mmsi: 222 } }];
          const existing = new Map([["111", kept], ["222", dropped]]);
          cut(rows, existing, 1);                       // cap of 1: row 222 is cut
          // the cut row is GONE and out of `existing`, so the sweep below never sees it;
          // the kept one is untouched and still there for the sweep to judge
          return dropped.gone === true && existing.has("222") === false
                 && kept.gone === false && existing.has("111") === true
                 && kept.style.opacity === undefined && dropped.dataset.miss === undefined;
        },
        "it reported in THIS update - it is simply not in the top rows. Left in `existing` "
        + "it was dimmed and told the operator it had stopped reporting, with stale numbers "
        + "underneath, and removed on the NEXT poll while still reporting");
  check("22b. ... and a feed at or under the cap never enters that loop at all",
        () => {
          if (at < 0) return false;
          let k = RENDER.indexOf("{", at), depth = 0, end = -1;
          for (;;) { const c = RENDER[k];
            if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) { end = k + 1; break; } } k++; }
          const cut = new Function("rows", "existing", "AIS_MAX_ROWS", RENDER.slice(at, end));
          const tr = { dataset: {}, style: {}, title: "x", gone: false,
                       remove() { this.gone = true; } };
          const existing = new Map([["111", tr]]);
          cut([{ v: { mmsi: 111 } }], existing, 60);
          return tr.gone === false && existing.has("111") === true;
        },
        "the ordinary case is every feed Andy has ever run: below the cap this must be a "
        + "no-op, or 6-6d's grace is gone with it");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
