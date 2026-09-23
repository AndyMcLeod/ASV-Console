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
                 "sceptic", "storey", "kerb", "plough", "tyre", "whilst", "amongst"];
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

function scan(rel) {
  const txt = fs.readFileSync(path.join(ROOT, rel), "utf8");
  const hits = [], exempt = [];
  txt.split(/\r?\n/).forEach((ln, i) => {
    const m = ln.match(RE);
    if (!m) return;
    const why = QUOTED.test(ln) ? "quotation" : S57.test(ln) ? "s57"
              : AIS_FIELD.test(ln) ? "ais-field" : null;
    (why ? exempt : hits).push(rel + ":" + (i + 1) + " " + m.join(",") + (why ? " [" + why + "]" : ""));
  });
  return { hits, exempt };
}

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
                : "clean, with " + page.exempt.length + " line(s) exempt as quotation");

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
  check("5. ... and the S-57 attribute exemption covers exactly the three lines that name the "
        + "chart standard's own field, nothing wider",
        () => s57.length === 3 && srv.exempt.length === 3,
        () => "exempt in the server: " + (srv.exempt.join(" | ") || "NOTHING")
            + ". COLOUR is an ENC attribute key, not a word - renaming it would stop every "
            + "channel mark carrying its symbol color through, silently");
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
