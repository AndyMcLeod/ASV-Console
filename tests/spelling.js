// tests/spelling.js - American spellings, everywhere the console speaks in its own voice.
//
// Andy, standing instruction: "my edits are to change spelling to american english, follow
// that pattern". His hand-edits to the generated .docx were spelling fixes that every docs
// rebuild silently destroyed, which is why the 2026-09-07 pass moved the fix into the
// BUILDERS - the only place it holds.
//
// """ + W + W + """ AND THEN IT ERODED, WITH EVERY SUITE GREEN. Measured 2026-09-23, before this suite
// existed: 166 British spellings across four files - 2 in build_tech_manual.js and 2 in
// build_ops_manual.js (SHIPPED manual prose), 34 in asv_console.py and 128 in static/asv.html.
// Not all comments: `behaviour` sat in the title= tooltips the operator reads on hover
// (asv.html 422, 430, 443, 480) and `centreline` in the Rule 9 lane readout itself.
//
// A convention with no check is a convention that decays. This is the check.
//
//   node tests/spelling.js      # exit 0 = pass, 1 = fail   (stdlib Node)

// --- crash guard: a throw outside a check() must still REPORT ------------------------
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

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!(typeof cond === "function" ? cond() : cond);
        note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}

const ROOT = path.join(__dirname, "..");

// """ + W + """ THE STEMS, not whole words: behaviours, metres, greyed and relabelled all have to be
// caught, and a leading letter-boundary keeps a longer word that merely CONTAINS the letters
// from matching.
const BRITISH = ["behaviour", "colour", "centre", "metre", "kilometre", "centimetre",
                 "manoeuvre", "neighbour", "judgement", "honour", "favour", "cancelled",
                 "modelling", "labelled", "signalled", "fuelled", "travelled", "grey",
                 "analyse", "recognise", "organis", "licence", "practis",
                 // ⚠ ADDED 2026-09-23, and every one was found by a re-judging pass AFTER this
                 // suite had run clean. A word list built from what a grep turned up is a list
                 // of the mistakes already made, not of the ones available to make.
                 "artefact", "litre", "defence", "offence", "draught", "aluminium",
                 "sceptic", "storey", "kerb", "plough", "tyre", "whilst", "amongst",
                 // ⚠ ADDED 2026-10-18: `harbour` sat in SHIPPED manual prose (both builders) and
                 // in the README with this suite green, because it was never on the list. NOAA's
                 // own name for its finest band IS spelled that way and stays - NOAA_NAME below.
                 "harbour"];
// ⚠⚠ NOT `programme`. Every apparent hit in this tree is `programmer` or
// `non-programmer`, which is correct American English - a stem match with no right edge would
// have "corrected" a word that was already right. The lookahead refuses a stem carried on by
// `er` or `ing`, which is what makes a stem list safe to widen.
const RE = new RegExp("(?<![A-Za-z])(" + BRITISH.join("|") + ")(?![A-Za-z]*(?:er|ing)\\b)", "gi");

// """ + W + W + """ A VERBATIM QUOTATION IS EXEMPT, AND THE EXEMPTION IS NAMED RATHER THAN SILENT.
// Rewording someone's own words without saying so is worse than the inconsistency, and
// survey_card.js records the same rule for the brand substitution. A line that marks itself as
// a quotation of the operator keeps his spelling - and the count of such lines is REPORTED, so
// a blanket exemption cannot quietly grow behind this.
const QUOTED = /OPERATOR'S OWN SCHEME|Andy, 2026-08-28/;

// ⚠⚠ AND THE S-57 ATTRIBUTE, WHICH IS NOT AN ENGLISH WORD. `COLOUR` is an ENC attribute
// acronym from the chart standard: a key in ENC_KEEP_PROPS that the parser reads off published
// chart data. "Correcting" it to COLOR would silently stop every channel mark carrying its
// symbol color through - a blanket sweep of uppercase spellings would have done exactly that.
// The two comments that NAME the attribute keep its spelling with it. Check 5 pins this to the
// three lines entitled to it, so widening the hole is a visible edit here rather than a quiet
// one.
const S57 = /"COLOUR"|CATLAM\/COLOUR|COLOUR for the buoy|ENC_KEEP_PROPS/;

// ⚠⚠ AND THE AIS STATIC FIELD, for the same reason and found the same way. `draught` is
// the AIS payload key: it is in ais_service.py's STATIC_KEYS, the message-5 decoder writes it,
// and the page reads `v.draught` to print it. Renaming those would break the readout exactly
// as renaming the chart attribute above would break the parser. In ORDINARY PROSE about a hull
// - "a deep-draught vessel" - it is British and is corrected; the distinction is the field.
// ⚠ AND A JUDGE GOT THIS WRONG in the pass that found it: it reported that the code "serves
// `draft`", citing contracts.js. That is `draft_m`, the VESSEL PROFILE's own draft, a
// different field entirely. Checked rather than taken.
const AIS_FIELD = /v\.draught|"draught"|'draught'|STATIC_KEYS|draught, IMO number/;

// ⚠⚠ AND NOAA'S OWN NAME FOR ITS FINEST BAND, which is spelled `harbour` and is not ours to
// respell. ENCDirect serves the band as `enc_harbour` (asv_console.py ENC_BANDS, the service
// path every chart read asks for), and the console keys a corridor read's bands by that name with
// `enc_` cut off (the page's CORRIDOR_SCALES, "harbour"). Renaming either breaks the chart read.
// The prose around them - "the harbor chart", "harbor scale" - is ours, and American.
// ⚠ THIS ONE IS SCOPED TO THE NAME, NOT THE LINE. The three above exempt a whole line; this
// cuts the name out of the line and judges what is left, so a line that names `enc_harbour` and
// says "the harbour chart" in the same breath is still caught. `skinOverHarbour` needs nothing:
// the leading letter-boundary already keeps a longer identifier from matching. Check 6 pins where
// it applies, and 6b proves the hole is no wider than the name.
// ... AND S-57'S OWN CLASS NAME Harbour_Facility (the chart's marina / harbor-facility objects, as NOAA's ENCDirect serves
// them - asv_console.py _ENC_RULE_CLASSES, the 2026-10-18 review): the server matches layers by it, so it is not respelled.
const NOAA_NAME = /\benc_harbour\b|"harbour"|\bHarbour_Facility\w*/g;

// One line's verdict: null when it carries no British spelling, else the spellings on it and
// why they are exempt (`why` null = a hit).
function judge(ln) {
  const all = ln.match(RE);
  if (!all) return null;
  const m = ln.replace(NOAA_NAME, "").match(RE);
  if (!m) return { m: all, why: "noaa-name" };
  const why = QUOTED.test(ln) ? "quotation" : S57.test(ln) ? "s57"
            : AIS_FIELD.test(ln) ? "ais-field" : null;
  return { m, why };
}

function scan(rel) {
  const txt = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const hits = [], exempt = [], lines = {};
  txt.split(/\r?\n/).forEach((ln, i) => {
    const j = judge(ln);
    if (!j) return;
    const at = rel + ":" + (i + 1);
    lines[at] = ln;
    (j.why ? exempt : hits).push(at + " " + j.m.join(",") + (j.why ? " [" + j.why + "]" : ""));
  });
  return { hits, exempt, lines };
}
// How many exempt lines of each kind - a total alone cannot say which exemption grew (check 4).
const kinds = (exempt) => {
  const n = {};
  exempt.forEach(s => { const k = /\[([a-z0-9-]+)\]$/.exec(s)[1]; n[k] = (n[k] || 0) + 1; });
  return Object.keys(n).map(k => n[k] + " " + k).join(", ") || "none";
};

console.log("American spellings, everywhere the console speaks in its own voice:");

// -- 1-2. THE SHIPPED PROSE -------------------------------------------------------------
// The builders are where it holds: the .docx is regenerated from them, so a spelling fixed in
// the document alone is destroyed by the next rebuild. That is the whole reason the 2026-09-07
// pass edited these files and not the output.
{
  const b = ["tools/build_tech_manual.js", "tools/build_ops_manual.js",
             "tools/build_dev_guide.js", "tools/build_quickstart.js", "tools/build_deck.js"]
    .map(scan);
  const hits = b.flatMap(x => x.hits);
  check("1. the document BUILDERS carry no British spelling - the generated manuals are "
        + "rebuilt from them, so this is the only place the fix holds",
        () => hits.length === 0,
        () => hits.length ? hits.slice(0, 6).join(" | ")
                          : "five builders clean; his .docx hand-edits are not destroyed by "
                            + "the next rebuild");
}

// -- 2-3. THE CONSOLE'S OWN VOICE --------------------------------------------------------
{
  const page = scan("static/asv.html");
  check("2. the page carries none - the operator reads these strings, tooltips included",
        () => page.hits.length === 0,
        () => page.hits.length
                ? page.hits.length + " hit(s): " + page.hits.slice(0, 6).join(" | ")
                : "clean, with " + page.exempt.length + " line(s) exempt (" + kinds(page.exempt) + ")");

  const srv = scan("asv_console.py");
  check("3. ... and neither does the server, whose refusals are read in words",
        () => srv.hits.length === 0,
        () => srv.hits.length ? srv.hits.slice(0, 6).join(" | ")
                              : "clean; five of its hits were operator-visible refusals "
                                + "(hold_clear_m / coast_from_m / manual_offset)");
}

// -- 4. THE EXEMPTION IS REAL, AND SMALL -------------------------------------------------
// """ + W + """ THE PAIR. Without this the suite would pass just as happily against a QUOTED regex so
// broad that it exempted the whole file - "no hits" and "nothing was looked at" are the same
// observation otherwise. It asserts the exemption is doing its job AND that it is one line.
{
  const page = scan("static/asv.html");
  // ⚠⚠ EACH KIND IS COUNTED SEPARATELY, not as one total. This asserted "exactly one
  // exempt line" and broke the moment a SECOND KIND appeared - correctly, because a shared
  // total cannot say which exemption grew. One check per kind means widening any one of them
  // is a visible edit to the check that owns it.
  const quoted = page.exempt.filter(s => /\[quotation\]/.test(s));
  const aisField = page.exempt.filter(s => /\[ais-field\]/.test(s));
  check("4. ... and the quotation exemption covers exactly the operator's own words, not a "
        + "hole the rest could hide in",
        () => quoted.length === 1 && /grey/i.test(quoted[0]),
        () => "quotation-exempt: " + (quoted.join(" | ") || "NOTHING - if the quotation was "
              + "reworded, this check is the only thing that would have noticed"));

  // ⚠ `draught` IS THE AIS PAYLOAD KEY where the page reads `v.draught` to print it - the
  // same standing as the chart attribute in check 5. In ordinary prose about a hull it is
  // British and is corrected; this pins the exemption to the ONE line that reads the field.
  check("4b. ... and the AIS-field exemption covers only the line that READS the field",
        () => aisField.length === 1 && /v\.draught|draught/.test(aisField[0]),
        () => "ais-field-exempt: " + (aisField.join(" | ") || "NOTHING")
            + ". `draught` is the AIS static key (ais_service STATIC_KEYS); renaming it would "
            + "stop the size line printing a hull's draft at all");
}

// -- 5. THE S-57 EXEMPTION IS EXACTLY THREE LINES --------------------------------------
// ⚠ THE SAME PAIRING AS CHECK 4, AND FOR THE SAME REASON. `COLOUR` has to be allowed or the
// chart parser breaks; allowed too widely, this suite stops being a guard at all. So the count
// is asserted, and every one of the three must be in the SERVER - the page has no business
// carrying an S-57 acronym.
{
  const srv = scan("asv_console.py");
  const s57 = srv.exempt.filter(s => /\[s57\]/.test(s));
  // ⚠ "AND NOTHING ELSE IN THE SERVER" was `srv.exempt.length === 3` until NOAA's band name
  // (check 6) became a second kind there. Counted by kind now, as check 4 learned: the S-57
  // lines are three, and every other server exemption must be NOAA's name, which 6 pins.
  check("5. ... and the S-57 attribute exemption covers exactly the three lines that name the "
        + "chart standard's own field, nothing wider",
        () => s57.length === 3 && srv.exempt.every(s => /\[(s57|noaa-name)\]$/.test(s)),
        () => "exempt in the server: " + (srv.exempt.join(" | ") || "NOTHING")
            + ". COLOUR is an ENC attribute key, not a word - renaming it would stop every "
            + "channel mark carrying its symbol color through, silently");
}

// -- 6. NOAA'S BAND NAME IS EXEMPT WHERE IT IS A NAME, AND NOWHERE ELSE --------------------
// ⚠ THE SAME PAIRING AGAIN. Pinned to the two lines that carry the key: the server's band
// list and the page's corridor scales. No builder has any business carrying NOAA's key in a
// manual, so a builder line exempt here fails too.
{
  const files = ["asv_console.py", "static/asv.html", "tools/build_tech_manual.js",
                 "tools/build_ops_manual.js", "tools/build_dev_guide.js", "tools/build_quickstart.js",
                 "tools/build_deck.js"];
  const noaa = files.flatMap(f => { const s = scan(f);
    return s.exempt.filter(e => /\[noaa-name\]$/.test(e)).map(e => ({ e, ln: s.lines[e.split(" ")[0]] })); });
  const isKey = (x) => (/^asv_console\.py:\d+ /.test(x.e) && /^ENC_BANDS = \[/.test(x.ln.trim()))
                    || (/^static\/asv\.html:\d+ /.test(x.e) && /^const CORRIDOR_SCALES = \[/.test(x.ln.trim()));
  // S-57's Harbour_Facility class, named in the server alone (_ENC_RULE_CLASSES and its note, the 2026-10-18 review)
  const isClass = (x) => /^asv_console\.py:\d+ /.test(x.e) && /\bHarbour_Facility/.test(x.ln) && !/^ENC_BANDS/.test(x.ln.trim());
  check("6. ... and NOAA's name exemption covers exactly the lines that carry its names - the server's ENC_BANDS and the page's "
        + "CORRIDOR_SCALES (its band key), and the server's lines naming S-57's Harbour_Facility class - nothing wider",
        () => noaa.filter(isKey).length === 2 && noaa.some(isClass) && noaa.every(x => isKey(x) || isClass(x)),
        () => "noaa-name-exempt: " + (noaa.map(x => x.e).join(" | ") || "NOTHING")
            + ". enc_harbour is ENCDirect's band name; renaming it would break every chart read");

  // ⚠⚠ AND THE RULE HAS TEETH BOTH WAYS. Check 6 counts what the tree holds today; these lines
  // are judged by the same verdict the scan uses, so a stem dropped from BRITISH, an exemption
  // widened to the whole line, or one widened to the word itself each fails here, whatever the
  // tree happens to carry.
  const P = (ln) => { const j = judge(ln); return !j ? "clean" : (j.why || "HIT"); };
  const probe = [
    ["the harbour chart is served whole", "HIT"],
    ["THE SEABED'S GAPS, OVER THE HARBOUR CHART", "HIT"],
    ["the Harbour band", "HIT"],
    ["two harbours apart", "HIT"],
    ['ENC_BANDS = ["enc_harbour", "enc_approach", "enc_coastal"]', "noaa-name"],
    ['const CORRIDOR_SCALES = ["harbour", "approach", "coastal", "general"];', "noaa-name"],
    ['"enc_harbour" is read whole beside the harbour chart', "HIT"],
    ["return skinOverHarbour(feats, b, enc);", "clean"],
    ['_ENC_RULE_CLASSES = ("Small_Craft_Facility_area", "Harbour_Facility_area", "Harbour_Facility_point")', "noaa-name"],
    ["the harbour facility's class, Harbour_Facility_area", "HIT"],
    ["the harbor chart is served whole", "clean"],
  ];
  const wrong = probe.filter(([ln, want]) => P(ln) !== want);
  check("6b. ... and the rule has teeth: prose `harbour` is caught in every case, and beside "
        + "NOAA's name on the same line; NOAA's name alone passes; the American spelling is clean",
        () => wrong.length === 0,
        () => wrong.length ? wrong.map(([ln, w]) => JSON.stringify(ln) + " -> " + P(ln) + ", want " + w).join(" | ")
                           : probe.length + " lines judged as intended");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
