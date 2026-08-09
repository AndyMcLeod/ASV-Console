// tests/nogo_readout.js - the Nogo row must name its STATE, not just a count.
//
// Andy's report: the Nogo entry "always shows ...loading". It did, and it was not a
// wording problem - it was a repaint bug hiding behind a vague word.
//
// `refreshNogo()` ended its SUCCESS path with `rebuildNogo(); nogo.busy=false;`, and
// rebuildNogo() finishes by calling updateNogoUI(). So the row was painted while `busy`
// was still true, printed "loading…", and then nothing repainted it - the one path that
// ends in a working model was the one path that never showed it. Every behaviour routed
// correctly off a model the card insisted was still loading. That is the worst kind of
// stale readout: it reports NOT READY about something that is.
//
// The wording was the second half. "loading…" says nothing about what is being loaded or
// how long it has been at it, and a bare zone count cannot distinguish the two opposite
// facts that both look like zero:
//
//   clear water    the chart was read and there is genuinely nothing to avoid
//   no chart       there is no model at all, so every route is UNVERIFIED and direct
//
// Same lesson the AIS table already learned about its link status: name the state.
//
//   node tests/nogo_readout.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// Every state is DERIVED from values that already exist - `busy`, `nogo.band` (set only
// by a successful extract), `nogo.note`, and the keep-out counts. No new state field was
// added, so nothing can drift out of step with the model the behaviours route against.
//
// TEETH (verified by mutation, not assumed): RESTORE THE ORIGINAL BUG - rebuild the model
// before clearing `busy` - and 10 and 11 fail. Key the "have chart data" test off
// `nogo.ready` instead of `nogo.band` and 4 and 6 fail (an empty-but-read area claims to
// have no chart). Drop the busy branch and 1, 2 and 12 fail. Drop the `nogo.since` elapsed
// counter and 2 fails. Fold the no-chart state back into the clear-water wording and 5, 13
// and 14 fail. Drop the article strip from the kind tally and 7 fails. Return the raw note
// untruncated and 6 fails. Leave the thrown-extract path without a note and 14 fails.
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy.

const fs = require("fs");
const path = require("path");

// The vessel-derived parameter block moved to static/js/state.js (2026-08-09). The page
// functions eval'd below read V.NOGO_MIN_DEPTH_M / V.WRECK_RADIUS_M / ..., so the suite
// needs the SAME object the page mutates - and gets it, rather than a stub, so a check
// that leans on a vessel default is reading the real one.
const { V } = require("../static/js/state.js");

const H = fs.readFileSync(path.join(__dirname, "..", "static", "asv.html"), "utf8");

function grab(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  // keep an `async` prefix: refreshNogo awaits the chart fetch, and a body torn off its
  // `async` keyword is a SyntaxError rather than a quiet wrong answer - but only because
  // someone checked. Grab the modifier with the function.
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}

V.NOGO_MIN_DEPTH_M = 2.3;             // the DriX: 2.0 m draft + 0.3 m under-keel clearance
var nogo = null;
// eslint-disable-next-line no-eval
eval(grab("nogoKindCounts") + "\n" + grab("nogoReadout"));

// `ran` is printed in the summary on purpose. The last half of this suite is async, and a
// stray top-level process.exit() once cut it off after check 9 - the process ended at 0
// having silently skipped five checks, which is the "passes while testing nothing" failure
// this repo already knows about. A visible count makes that impossible to miss again.
let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  console.log((cond ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!cond) fails++;
}
function summary() {
  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                    : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
}

// A keep-out model as buildKeepouts() returns it: land/shallow rings, shoreline paths,
// hazard and buoy points, each carrying the human `kind` string nogoKind() gave it.
function model(over) {
  return Object.assign({
    busy: false, since: null, band: "enc_5", note: "nogo not loaded", ready: true,
    ko: {
      polys: [{ kind: "land" }, { kind: "land" }, { kind: "water shallower than 2.3 m" }],
      lines: [{ kind: "the shoreline" }],
      points: [{ kind: "a charted hazard" }, { kind: "a channel buoy" }]
    }
  }, over || {});
}
const read = over => { nogo = model(over); return nogoReadout(); };

console.log("Nogo readout — the row has to say which of four things is true:");

// 1-2. READING. The state that was stuck. It has to be visibly transient, and it has to
// show how long it has been going: a chart service that stopped answering must not look
// the same as one that is merely slow on a first fetch.
check("1. while the extract is in flight the row says it is reading the chart",
      /reading chart/.test(read({ busy: true, since: Date.now() }).text));
check("2. ... and counts the seconds, so a hung fetch is visible as a hung fetch",
      read({ busy: true, since: Date.now() - 42000 }).text.indexOf("42 s") >= 0,
      read({ busy: true, since: Date.now() - 42000 }).text);

// 3. READ, WITH ZONES. The count plus the depth floor - which is vessel-derived, so the
// operator can see what "shallow" means for the boat they are actually driving.
check("3. a read chart reports the zone count and THIS vessel's depth floor",
      read().text === "6 zones · floor 2.3 m", read().text);
check("3b. ... and is not flagged as a problem",
      read().cls === "");

// 4-5. THE PAIR THAT LOOKED IDENTICAL AND ARE OPPOSITE. Both have zero keep-outs. One is
// open water; the other means nothing has been checked and every route is direct and
// unverified. Keying off `nogo.band` - set only by a SUCCESSFUL extract - is what tells
// them apart; `nogo.ready` cannot, because it is false in both.
check("4. chart read, nothing to avoid = CLEAR WATER, and not a warning",
      (r => /clear/.test(r.text) && r.cls === "")(read({ ready: false, ko: { polys: [], lines: [], points: [] } })),
      "band set, zero keep-outs");
check("5. no chart data at all is NOT 'clear' — it is a warning that routes go direct",
      (r => !/clear/.test(r.text) && r.cls === "warn" && /DIRECT/.test(r.title))(
        read({ ready: false, band: null, note: "no ENC coverage / offline", ko: null })),
      "no band -> unverified, say so");

// 6. A failed read says why, in the tooltip, without the row growing a paragraph.
check("6. a failure names itself, truncated in the row and whole in the tooltip",
      (r => r.text.length <= 34 && /chart read failed/.test(r.title) && /stack/.test(r.title))(
        read({ band: null, ko: null, note: "chart read failed: Error: fetch aborted (stack)" })),
      "long notes must not stretch the card");

// 7. The tooltip breakdown is the operator's answer to "six zones of WHAT". It reuses the
// keep-outs' own kind strings, so it can never invent a category the model does not have.
check("7. the tooltip breaks the count down by kind, most numerous first",
      (t => t.indexOf("2 × land") >= 0 && t.indexOf("1 × shoreline") >= 0 &&
            t.indexOf("1 × charted hazard") >= 0 &&
            t.indexOf("2 × land") < t.indexOf("1 × shoreline"))(read().title),
      "articles stripped, sorted by count");
check("8. ... and every state explains what a nogo IS, with the vessel's own floor",
      [read(), read({ busy: true }), read({ band: null, ko: null })]
        .every(r => /draft \+ under-keel clearance/.test(r.title) && r.title.indexOf("2.3 m") >= 0));

// 9. Degrading safely: a model that never got built must not throw inside the card's
// update path, or the whole vessel-status readout stops with it.
check("9. a missing keep-out model degrades, it does not throw",
      (() => { try { return !!read({ ko: null }).text && !!read({ ko: {} }).text; }
               catch (e) { return false; } })());

// 10-12. THE ACTUAL REPORTED FAULT, driven end to end. Wording alone would not have
// caught it: the row was stuck because of the ORDER of two statements. So run the real
// refreshNogo() over the real rebuildNogo() and updateNogoUI(), stubbing only the leaves
// (the chart fetch, the keep-out builder, the banner, the DOM), and assert what the
// operator is left looking at once the extract has landed.
var enc = { features: [], band: null }, asv = { lat: 38.7896, lon: -75.1609 };
var S = {}, center = { lat: 38.7896, lon: -75.1609 }, NOGO_RADIUS_M = 5000;
var encShow = false, nogoShow = true, banners = [], painted = [];
function bboxAround() { return { W: 0, S: 0, E: 1, N: 1 }; }
function featuresBboxRef() { return { lat: 38.7896, lon: -75.1609 }; }
function nogoDR() { return {}; }
function render() {}
function showBanner(t) { banners.push(t); }
// The row element records EVERY paint, so the test can assert both what was shown during
// the fetch and what the operator is left with afterwards.
var ROW = { title: "", className: "", _t: "--" };
Object.defineProperty(ROW, "textContent", {
  get() { return this._t; }, set(v) { this._t = v; painted.push(v); }
});
var FAKE = { "#v_nogo": ROW,
             "#nogoBtn": { classList: { toggle() {} }, disabled: false },
             "#chrtBtn": { classList: { add() {} } } };
function $(sel) { return FAKE[sel] || null; }
function buildKeepouts() { return { polys: [{ kind: "land" }], lines: [],
                                    points: [{ kind: "a charted hazard" }] }; }
var FETCH = null;
function fetchENCBbox() { return FETCH(); }
// eslint-disable-next-line no-eval
eval(grab("rebuildNogo") + "\n" + grab("nogoStatus") + "\n" +
     grab("updateNogoUI") + "\n" + grab("refreshNogo"));

async function drive(fetchResult) {
  nogo = { ready: false, busy: false, ref: null, ko: null, band: null,
           note: "nogo not loaded", enf: {}, features: null, bbox: null, center: null };
  enc = { features: [{}], band: "enc_5" };
  painted = []; banners = [];
  FETCH = fetchResult;
  await refreshNogo();
  return { last: painted[painted.length - 1], all: painted.slice() };
}

(async () => {
  const ok = await drive(() => ({ band: "enc_5" }));
  check("10. THE REPORTED FAULT: after a SUCCESSFUL extract the row is not still reading",
        !/reading chart/.test(ok.last),
        "final paint: " + JSON.stringify(ok.last));
  check("11. ... it shows the model that was actually built",
        ok.last === "2 zones · floor 2.3 m" && nogo.busy === false && nogo.ready === true,
        "final paint: " + JSON.stringify(ok.last));
  // The transient state must still have been shown - the fix is about the LAST paint, not
  // about hiding the fact that a fetch happened.
  check("12. ... and 'reading chart' was still shown while the fetch was in flight",
        ok.all.some(t => /reading chart/.test(t)),
        ok.all.length + " paints: " + JSON.stringify(ok.all));

  const off = await drive(() => null);
  check("13. an extract that returns no coverage lands on the no-chart warning",
        !/reading chart/.test(off.last) && /offline|coverage/.test(off.last),
        "final paint: " + JSON.stringify(off.last));

  const bad = await drive(() => { throw new Error("connection reset"); });
  check("14. and a THROWN extract does too, naming the failure",
        !/reading chart/.test(bad.last) && /failed/.test(bad.last) && nogo.busy === false,
        "final paint: " + JSON.stringify(bad.last));

  // THE SHIPPED DEFAULT, not the one this suite seeds. Every check above sets
  // V.NOGO_MIN_DEPTH_M to the DriX's 2.3 m first, so none of them can see what the console
  // STARTS at before a vessel profile loads - which is why a mutation moving state.js's
  // default survived the entire suite. It matters: that is the floor in force during the
  // window between page load and /api/vessel answering, and a shallower one would let an
  // early route cross water the boat cannot swim in. 1.0 m is the conservative baseline;
  // the vessel profile raises it to draft + under-keel clearance.
  const stateSrc = fs.readFileSync(
    path.join(__dirname, "..", "static", "js", "state.js"), "utf8");
  const dflt = stateSrc.match(/NOGO_MIN_DEPTH_M:\s*([\d.]+)/);
  check("15. state.js ships a CONSERVATIVE depth floor for the pre-vessel window",
        !!dflt && parseFloat(dflt[1]) === 1.0,
        "default floor " + (dflt ? dflt[1] : "not found") + " m (the vessel raises it)");

  summary();
})();
