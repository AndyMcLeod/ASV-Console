// tests/build_check.js - the page says when it and the console are different versions (review #15, 2026-09-14).
//
// The page and its modules are read from disk on every request, but the console's Python only when it starts, so a
// refresh after a commit paired a new page with the old program - fields dropped, routes answering 404, nothing
// said. The console reports the version it started from (S.build) and the one on disk now (S.build_on_disk), and
// serves the page with the version it was read at (PAGE_BUILD). The top-bar pill says which one is behind:
//   * the program on disk is not the one running                 -> RESTART CONSOLE
//   * a console from before this existed (it reports no version) -> RESTART CONSOLE - this page is newer than it
//   * the console runs a version this page was not loaded from   -> RELOAD PAGE
// and nothing when they agree, before the first frame, or when the page was not served by a console that fills in
// PAGE_BUILD. The server half is tests/build_id.py.
// DRIVEN: the page's own buildCheck and onFrame, with the pill and the state stubbed, and PAGE_BUILD filled in the way
// the console fills it.
//
//   node tests/build_check.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - 8 sidecar mutations RUN, 8/8 caught:
//   the disk change not said -> 2, 4          an older console not said -> 3
//   a reload never asked for -> 4             an unfilled page claims a version -> 5
//   the pill never hidden again -> 6          the tooltip left behind -> 6
//   frames not checked -> 7                   a reload asked for before the restart -> 4
//
// NOTE: the page's script is <script type="module">, which runs STRICT - so the functions under test are
// evaluated strict here too.

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

const ASV_HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(ASV_HTML, "utf8").split("\r\n").join("\n");

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
function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
const DECL = (H.match(/^const PAGE_BUILD = "[^"]*";/m) || [])[0];
if (!DECL) throw new Error("test setup: const PAGE_BUILD not found (renamed?)");

console.log("The page says when it and the console are different versions:");

const pill = { style: { display: "none" }, textContent: "", title: "" };
// A page as the console serves it: the token filled with the version the files were read at - or left as it is.
function pageServedWith(build) {
  const decl = build == null ? DECL : DECL.replace("__ASV_PAGE_BUILD__", build);
  // eslint-disable-next-line no-eval
  return eval("(function(){ \"use strict\"; let S = {}; const $ = (sel) => sel === \"#buildPill\" ? pill : null;\n"
    + decl + "\n" + grab("buildCheck") + "\n"
    + "return { buildCheck, setS: (v) => { S = v; } }; })()");
}
const shown = () => (pill.style.display === "none" ? "" : pill.textContent);

const A = "a1b2c3d4e5f6", B = "0f9e8d7c6b5a";
const p = pageServedWith(A);
p.buildCheck();
const beforeFrame = shown();
p.setS({ type: "state", build: A, build_on_disk: A });
p.buildCheck();
const agree = shown();
check("1. nothing is said before the first frame, or while the page, the running console and the files on disk agree",
      () => beforeFrame === "" && agree === "", () => "before '" + beforeFrame + "'; agreeing '" + agree + "'");

p.setS({ type: "state", build: A, build_on_disk: B });
p.buildCheck();
const restart = { say: shown(), tip: pill.title };
check("2. the files on disk changed after the console started: RESTART CONSOLE, naming both versions",
      () => restart.say === "⚠ RESTART CONSOLE" && restart.tip.indexOf(A) >= 0 && restart.tip.indexOf(B) >= 0,
      () => "'" + restart.say + "': " + restart.tip.slice(0, 100));

p.setS({ type: "state", boot_id: "1-2" });
p.buildCheck();
const older = { say: shown(), tip: pill.title };
check("3. a console from before versions were reported: RESTART CONSOLE - a page that knows to ask is newer than it",
      () => older.say === "⚠ RESTART CONSOLE" && /reports no version/.test(older.tip), () => "'" + older.say + "'");

const q = pageServedWith(A);
q.setS({ type: "state", build: B, build_on_disk: B });
q.buildCheck();
const reload = { say: shown(), tip: pill.title };
q.setS({ type: "state", build: B, build_on_disk: A });
q.buildCheck();
const bothBehind = shown();
check("4. the console was restarted with a version this page was not loaded from: RELOAD PAGE, naming both - and when "
      + "the running console is itself behind the disk, restarting it comes first",
      () => reload.say === "⚠ RELOAD PAGE" && reload.tip.indexOf(A) >= 0 && reload.tip.indexOf(B) >= 0
            && bothBehind === "⚠ RESTART CONSOLE",
      () => "'" + reload.say + "'; with the console behind the disk too '" + bothBehind + "'");

const r = pageServedWith(null);
r.setS({ type: "state", build: B, build_on_disk: B });
r.buildCheck();
const unfilled = shown();
check("5. a page nobody filled in (not served by the console) claims no version, so it is never told to reload",
      () => unfilled === "", () => "'" + unfilled + "'");

p.setS({ type: "state", build: A, build_on_disk: A });
p.buildCheck();
check("6. once they agree again the pill is HIDDEN - not left up empty - and says nothing",
      () => pill.style.display === "none" && pill.textContent === "" && pill.title === "",
      () => "display '" + pill.style.display + "', text '" + pill.textContent + "', title '" + pill.title + "'");

const onFrame = grab("onFrame");
check("7. every state frame is checked - onFrame calls buildCheck - and the pill sits in the top bar",
      () => /consoleHealth\(\);\s*buildCheck\(\);/.test(onFrame)
            && /<div class="pill"><span class="dot" id="dot"><\/span><span id="linktext">idle<\/span><\/div>\s*<div class="pill" id="buildPill"/.test(H),
      () => onFrame.replace(/\s+/g, " ").slice(-80));

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
