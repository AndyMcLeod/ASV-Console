// tests/stored_settings.js - the one way the console touches localStorage.
//
// WHY THIS EXISTS. Every stored operator setting - the trail, the window layout, card
// sizes, the vessel-card prefs, six panel positions, three display toggles - was a
// hand-written try/catch around JSON.parse / JSON.stringify. Sixteen of them across eight
// keys. The try/catch is not decoration: localStorage throws on ACCESS where site data is
// blocked, and setItem throws on quota, so ONE bare call is enough to take out start-up.
// Sixteen copies is sixteen chances to forget it. They now go through lsGet / lsSet /
// lsDel / lsBool.
//
// THE MIGRATION RISK THIS GUARDS. The three display toggles (boundary, AIS layer, Quick
// Start seen) were stored as the RAW strings "1" and "0", predating the JSON store. Anyone
// running this console already has those values in their browser. If lsBool stopped
// reading them, their saved toggles would silently reset to defaults on the next load -
// the AIS layer off, the boundary back on - with nothing to say why. So the legacy format
// is tested directly rather than reasoned about.
//
//   node tests/stored_settings.js      # exit 0 = pass, 1 = fail   (stdlib Node, no deps)
//
// These are BEHAVIOURAL: the helpers are pulled out of static/asv.html and run against a
// fake storage that can be made to throw on demand, which is the failure this exists for
// and one a browser will not reproduce on request.
//
// TEETH (verified by mutation, not assumed): drop the "1" arm of lsBool and 7 fails - that
// is the migration break. Make lsGet return its fallback for any falsy value and 10 fails
// (a stored `false` is a real answer, not a missing one). Strip lsGet's try/catch and 3+4
// fail as THREW; lsSet's and 5 fails; lsDel's and 6 fails. Have lsSet write the raw value
// instead of JSON and 1 fails. Reintroduce a bare localStorage call anywhere else and 11
// fails. Every one of those was run against this file, not reasoned about.
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

// ASV_HTML points this at a SIDECAR copy for a mutation run - without it a sweep writes
// its mutants to a file this suite never reads and scores every one as SURVIVED (audited
// 2026-09-21: 21 of the 53 suites reading this page had no override).
const H = fs.readFileSync(process.env.ASV_HTML
                || path.join(__dirname, "..", "static", "asv.html"), "utf8");

let fails = 0, ran = 0;
// EVERY condition is a thunk, and a THROW is reported as a failed check rather than
// killing the run. That is not politeness: the first version of this suite called the
// helpers directly, so stripping lsGet's try/catch made check 3 throw and took the whole
// process down BEFORE check 4 - the check actually written for that fault - could run. A
// mutation run then scored it as "survived", because no FAIL line was ever printed. The
// project's own rule is that a crashed harness is as loud as a failed check; a harness
// that cannot survive the fault it is testing for cannot report it.
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!cond(); note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
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
eval(["lsGet", "lsSet", "lsDel", "lsBool"].map(grab).join("\n"));

// A storage that can be blocked the way a locked-down browser blocks it.
function fakeStore(opts) {
  opts = opts || {};
  const map = new Map();
  return {
    map,
    getItem(k)    { if (opts.throwGet) throw new Error("access denied"); return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { if (opts.throwSet) throw new Error("quota exceeded"); map.set(k, String(v)); },
    removeItem(k) { if (opts.throwDel) throw new Error("access denied"); map.delete(k); },
  };
}

console.log("Stored settings — one guarded way in, and older saved values still read:");

// --- 1-3. the ordinary path ------------------------------------------------ //
globalThis.localStorage = fakeStore();
check("1. an object round-trips through the store as JSON",
      () => { lsSet("k_obj", { left: 12, top: 34 }); const r = lsGet("k_obj", null);
              return r && r.left === 12 && r.top === 34; },
      () => "raw=" + localStorage.map.get("k_obj"));

check("2. a key that was never written returns the caller's fallback",
      () => lsGet("k_absent", { a: 1 }).a === 1, "no stored preference means the default");

check("3. a CORRUPT stored value returns the fallback rather than throwing",
      () => { localStorage.map.set("k_bad", "{not json");
              return lsGet("k_bad", "fallback") === "fallback"; },
      "a half-written entry must not break start-up");

// --- 4-6. storage that fights back ----------------------------------------- //
check("4. a read from BLOCKED storage returns the fallback and does not throw",
      () => { globalThis.localStorage = fakeStore({ throwGet: true });
              return lsGet("k_any", "fallback") === "fallback"; },
      "returned the fallback");

check("5. a write that is REFUSED (quota) does not throw",
      () => { globalThis.localStorage = fakeStore({ throwSet: true });
              lsSet("k_any", { big: true }); return true; },
      "the setting is simply not persisted");

check("6. a delete against blocked storage does not throw",
      () => { globalThis.localStorage = fakeStore({ throwDel: true });
              lsDel("k_any"); return true; },
      "clearing the trail cannot break the page");

// --- 7-9. THE MIGRATION. Toggles saved by an older build must still be read. --- //
check("7. LEGACY \"1\"/\"0\" toggles saved by an older build still read correctly",
      () => { globalThis.localStorage = fakeStore();
              localStorage.map.set("k_legacy_on", "1");    // exactly what an older build wrote
              localStorage.map.set("k_legacy_off", "0");
              return lsBool("k_legacy_on", false) === true && lsBool("k_legacy_off", true) === false; },
      "nobody's saved toggles reset on upgrade");

check("8. ... and a toggle written NOW reads back correctly too",
      () => { lsSet("k_new_on", true); lsSet("k_new_off", false);
              return lsBool("k_new_on", false) === true && lsBool("k_new_off", true) === false; },
      () => "raw: " + localStorage.map.get("k_new_on") + " / " + localStorage.map.get("k_new_off"));

check("9. an unset toggle takes its stated default, either way",
      () => lsBool("k_never", true) === true && lsBool("k_never", false) === false,
      "the boundary defaults on, the AIS layer defaults off");

// --- 10. a stored `false` is an ANSWER, not an absence ---------------------- //
// The old code read `JSON.parse(...) || {}`, which cannot tell a stored falsy value from a
// missing one. That is fine for the object stores and wrong for anything else, so the
// helper tests for null instead. Getting this wrong would make "turned off" mean "never set".
check("10. a stored `false` or `0` is returned, NOT mistaken for nothing stored",
      () => { globalThis.localStorage = fakeStore();
              lsSet("k_false", false); lsSet("k_zero", 0);
              return lsGet("k_false", "MISSING") === false && lsGet("k_zero", "MISSING") === 0; },
      "an explicit off must outrank the default");

// --- 11. one way in -------------------------------------------------------- //
// Source shape, and the point of the exercise: raw localStorage may appear ONLY inside the
// three helpers. A new call site that rolls its own try/catch is the thing that drifts.
const CODE = H.slice(H.indexOf("<script>"));
const rawSites = CODE.split("\n")
  .map((l, i) => ({ line: i + 1, text: l }))
  .filter(o => /\blocalStorage\s*\./.test(o.text))
  .filter(o => !/^\s*(\/\/|\*)/.test(o.text))                      // comments describing it
  .filter(o => !/^function ls(Get|Set|Del)\(/.test(o.text.trim())) // the helpers themselves
  .filter(o => !/return v == null \? fallback : v/.test(o.text));  // lsGet's body line
check("11. raw localStorage appears ONLY inside the helpers",
      () => rawSites.length === 0,
      () => rawSites.length ? rawSites.map(o => "line " + o.line + ": " + o.text.trim().slice(0, 46)).join(" | ")
                            : "every call site goes through lsGet/lsSet/lsDel/lsBool");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
