// tests/page_strict.js - the page and its modules parse the way the browser parses them: as STRICT modules
// (review #27, 2026-09-15).
//
// Twenty-seven suites said "the console's classic browser <script> runs sloppy" and evaluated page code sloppy to match.
// The page has been <script type="module"> - STRICT - for as long as those notes have been wrong, so every one of those
// suites would accept page code the browser refuses: an octal literal, a `with`, a repeated parameter name, a `delete`
// of a plain name. Any of them in the page leaves the operator a BLANK CONSOLE, because a module that does not parse
// runs none of its code, and every function-level suite stays green. This parses the whole module, and every module it
// imports, as a module - the browser's reading.
// (The notes now say what is true. The runtime difference - an assignment to an undeclared name, silent sloppy and a
// ReferenceError strict - is NOT covered here or anywhere, and they say that too.)
//
//   node tests/page_strict.js      # exit 0 = pass, 1 = fail   (stdlib Node; runs `node --check` on temp .mjs copies)
//
// TEETH - 6 mutations RUN on sidecars (ASV_HTML, ASV_JS_DIR, and a scratch suite file removed afterwards), 6/6 caught:
//   an octal literal in a page function -> 1          a repeated parameter in a page function -> 1
//   a with statement in a page function -> 1          a second, classic inline script in the page -> 1
//   a module under static/js with a repeated parameter -> 2    a suite with the old note back -> 4
// AND THE REASON THIS SUITE EXISTS, measured: ais_table.js, which lifts setCellText and evaluates it sloppy, passes all
// 31 of its checks against the page with the octal literal in setCellText - a page the browser refuses to run at all.

function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const APP = path.join(__dirname, "..");
const ASV_HTML = process.env.ASV_HTML || path.join(APP, "static", "asv.html");
const JS_DIR = process.env.ASV_JS_DIR || path.join(APP, "static", "js");

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

console.log("The page and its modules parse as strict modules:");

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "asv_page_strict_"));
function parseAsModule(label, code) {
  const file = path.join(TMP, label.replace(/[^\w.-]/g, "_") + ".mjs");
  fs.writeFileSync(file, code);
  const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
  const err = (r.stderr || "").split("\n").filter((l) => /Error/.test(l))[0] || (r.stderr || "").trim().split("\n")[0] || "";
  return { ok: r.status === 0, err: err.trim() };
}

try {
  const H = fs.readFileSync(ASV_HTML, "utf8");
  const modules = [...H.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map((m) => m[1]);
  const classic = [...H.matchAll(/<script(?![^>]*type="module")(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];

  // 1. the page
  const page = modules.length === 1 ? parseAsModule("asv_page", modules[0]) : { ok: false, err: modules.length + " module scripts" };
  check("1. the console page's script is ONE <script type=\"module\">, with no classic inline script beside it, and it "
        + "parses as a module - strict, as the browser reads it",
        () => modules.length === 1 && classic.length === 0 && page.ok,
        () => modules.length + " module script(s), " + classic.length + " classic; " + (page.ok ? "parses" : "REFUSED: " + page.err));

  // 2. every module it can import
  const files = fs.readdirSync(JS_DIR).filter((f) => f.endsWith(".js")).sort();
  const refused = [];
  for (const f of files) {
    const r = parseAsModule("js_" + f, fs.readFileSync(path.join(JS_DIR, f), "utf8"));
    if (!r.ok) refused.push(f + ": " + r.err);
  }
  check("2. every module under static/js parses as a module",
        () => files.length >= 10 && refused.length === 0,
        () => files.length + " modules; refused: " + (refused.join(" | ") || "none"));

  // 3. the control: what a sloppy eval takes and this refuses
  const faults = {
    "an octal literal": "function f(){ return 010; }",
    "a with statement": "function f(o){ with (o) { return x; } }",
    "a repeated parameter": "function f(a, a){ return a; }",
    "a delete of a plain name": "function f(){ var z = 1; delete z; }",
  };
  const verdicts = Object.entries(faults).map(([what, code]) => {
    let sloppyTook = true;
    try { new Function(code); } catch (e) { sloppyTook = false; }      // eslint-disable-line no-new-func
    const strict = parseAsModule("fault_" + what, modules[0] + "\n" + code + "\n");
    return { what, sloppyTook, refused: !strict.ok };
  });
  check("3. the control: each fault a sloppy eval ACCEPTS - an octal literal, a with, a repeated parameter, a delete of a "
        + "plain name - is REFUSED when appended to the page and parsed here, so this check can fail",
        () => verdicts.every((v) => v.sloppyTook && v.refused),
        () => verdicts.map((v) => v.what + ": sloppy " + (v.sloppyTook ? "took it" : "refused") + ", here " + (v.refused ? "refused" : "TOOK IT")).join("; "));

  // 4. the notes
  const tests = fs.readdirSync(__dirname).filter((f) => f.endsWith(".js"));
  const stillClaim = tests.filter((f) => /classic browser <script> runs sloppy/.test(fs.readFileSync(path.join(__dirname, f), "utf8"))
                                         && f !== path.basename(__filename));
  check("4. no suite still says the console's script runs sloppy",
        () => stillClaim.length === 0,
        () => "claiming it: " + (stillClaim.join(", ") || "none"));
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });     // this suite leaves no temp folder behind (review #27)
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
