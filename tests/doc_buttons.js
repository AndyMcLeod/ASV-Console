// tests/doc_buttons.js - THE FOUR DOCUMENTS ON THE CHART'S COMMAND BAR (Andy, 2026-10-19: "In the chart window lower
// toolbar add 4 buttons - each button opens one of the 4 asv simulator word documents"), AS PDFs IN THE BROWSER since
// 2026-11-19 (Andy: "convert them from word to PDF"; asked, he chose "PDF in the browser").
//
// A button opens /docs/<id> in a tab of its own, which the console serves inline as a PDF. The page half, in a world of
// its own, and the server half BY SOURCE (its live answers are tests/doc_routes.py's):
//   1. the four buttons are on the chart's command bar, at its left end before the zoom buttons and well away from
//      E-STOP, each naming its document as a PDF and its id;
//   2. openDoc opens /docs/<id> in a new tab IN THE CLICK - nothing awaited, nothing posted - and says so; a tab the
//      browser blocks is said, with the address;
//   3. each button is wired to openDoc with its own id, outside cmd() (a VIEW ONLY tab may read the manuals);
//   4. the server names the four PDFs by id, each on disk and a PDF; serves one inline with the PDF type; opens nothing
//      on its own machine (no /api/open_doc, no startfile);
//   5. the manuals name the buttons and the PDFs.
//
//   node tests/doc_buttons.js      # exit 0 = pass, 1 = fail   (stdlib Node)

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
const ROOT = path.join(__dirname, "..");
const H = fs.readFileSync(process.env.ASV_HTML || path.join(ROOT, "static", "asv.html"), "utf8").split("\r\n").join("\n");
const PY = fs.readFileSync(process.env.ASV_APP || path.join(ROOT, "asv_console.py"), "utf8").split("\r\n").join("\n");

function grab(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;      // an async function keeps its keyword
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function grabDecl(name) {
  const i = H.indexOf("const " + name + " =");
  if (i < 0) throw new Error("test setup: declaration " + name + " not found (renamed?)");
  return H.slice(i, H.indexOf(";", i) + 1);
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
console.log("The four documents on the command bar:");

const IDS = ["quick", "ops", "tech", "dev"], LABELS = { quick: "QUICK", ops: "OPS", tech: "TECH", dev: "DEV" };
const FILES = { quick: "asv-simulator-quick-start.pdf", ops: "asv-simulator-operations-manual.pdf",
                tech: "asv-simulator-technical-manual.pdf", dev: "asv-simulator-development-guide.pdf" };

// ---- 1. the markup ---------------------------------------------------------------------------------------------- //
const bar = H.slice(H.indexOf('<div class="cmdbar">'), H.indexOf('id="b_reset"'));
const btn = id => bar.match(new RegExp(`<button class="ctl small doc" id="doc_${id}" data-doc="${id}" title="([^"]*)">([A-Z ]+)</button>`));
const at = id => bar.indexOf(`id="doc_${id}"`);
check("1. FOUR BUTTONS ON THE CHART'S COMMAND BAR, at its left end: each .ctl.small.doc, id doc_<id>, data-doc its id, its "
      + "title naming the document as a PDF in a new tab (no Word left in it), labeled QUICK / OPS / TECH / DEV; in that "
      + "order, before the zoom buttons, a divider after them, and the whole group before ARM and E-STOP",
      () => IDS.every(id => btn(id) && /\(PDF, in a new tab\)/.test(btn(id)[1]) && !/Word/.test(btn(id)[1]) && btn(id)[2] === LABELS[id])
            && /Quick Start/.test(btn("quick")[1]) && /Operations Manual/.test(btn("ops")[1])
            && /Technical Manual/.test(btn("tech")[1]) && /Development Guide/.test(btn("dev")[1])
            && at("quick") < at("ops") && at("ops") < at("tech") && at("tech") < at("dev")
            && at("dev") < bar.indexOf('id="zin"') && at("dev") < bar.indexOf('id="b_arm"') && at("dev") < bar.indexOf('id="b_estop"')
            && /id="doc_dev"[^\n]*\n\s*<span class="cdiv"><\/span>\s*\n\s*<button class="ctl" id="zin"/.test(bar),
      () => JSON.stringify({ found: IDS.map(id => !!btn(id)), titles: IDS.map(id => btn(id) && btn(id)[1]) }));

// ---- 2-3. openDoc and the wiring, in a world of their own ------------------------------------------------------- //
// `opens` answers window.open: a tab (an object), or null - the browser blocked it. `fetch` is recorded: nothing may be
// posted, and an await before the open would make the browser take it for a pop-up, so it is opened in the click.
function mkWorld(opens) {
  const w = { notes: [], opened: [], posts: [], buttons: IDS.map(id => ({ className: "ctl small doc", dataset: { doc: id }, onclick: null })) };
  const fetch = async (url, opts) => { w.posts.push({ url, opts }); return { json: async () => ({ ok: true }) }; };
  const src = grabDecl("DOC_NAMES") + "\n" + grab("openDoc") + "\n"
    + (H.match(/for\(const b of document\.querySelectorAll\("\.cmdbar button\.doc"\)\) b\.onclick = [^\n]*/) || [""])[0]
    + "\nreturn {openDoc};";
  // eslint-disable-next-line no-new-func
  w.api = new Function("document", "fetch", "window", "flashNote", "CLIENT_ID", src)(
    { querySelectorAll: sel => (sel === ".cmdbar button.doc" ? w.buttons : []) }, fetch,
    { open: (u, t) => { w.opened.push([u, t]); return opens ? {} : null; } }, m => w.notes.push(m), "tab-A");
  return w;
}
const W1 = mkWorld(true), W2 = mkWorld(false);
const r1 = W1.api.openDoc("ops"), r2 = W2.api.openDoc("tech");
check("2. openDoc OPENS /docs/<id> IN A NEW TAB, IN THE CLICK: synchronous (not async, no await - so the browser takes it "
      + "for the operator's own), nothing posted, and it says the PDF opened; a tab the browser blocks is said, with the "
      + "address and the way round it",
      () => r1 === "opened" && W1.opened.length === 1 && W1.opened[0][0] === "/docs/ops" && W1.opened[0][1] === "_blank"
            && /^Opened the Operations Manual \(PDF\) in a new tab\.$/.test(W1.notes[0]) && W1.posts.length === 0
            && r2 === "blocked" && W2.opened.length === 1 && W2.opened[0][0] === "/docs/tech"
            && /did not open the Technical Manual: allow pop-ups for the console, or open \/docs\/tech\./.test(W2.notes[0])
            && !/^async /.test(grab("openDoc")) && !/\bawait\b/.test(grab("openDoc")) && !/fetch\(|cmd\(/.test(grab("openDoc")),
      () => JSON.stringify({ r1, r2, opened: [W1.opened, W2.opened], notes: [W1.notes[0], W2.notes[0]], posts: W1.posts.length }));
// 3. the wiring: each button's click opens ITS document
const W3 = mkWorld(true);
for (const b of W3.buttons) b.onclick();
check("3. EACH BUTTON IS WIRED to openDoc with its own id (its data-doc): four clicks, four tabs, quick / ops / tech / dev",
      () => W3.buttons.every(b => typeof b.onclick === "function")
            && W3.opened.map(o => o[0]).join() === IDS.map(id => "/docs/" + id).join(),
      () => JSON.stringify(W3.opened));

// ---- 4. the server, by source and by disk ---------------------------------------------------------------------- //
const docFiles = (PY.match(/DOC_FILES = \{[\s\S]*?\}/) || [""])[0];
const onDisk = IDS.map(id => { try { const b = fs.readFileSync(path.join(ROOT, "docs", FILES[id])); return b.length > 1000 && b.slice(0, 5).toString() === "%PDF-"; } catch (e) { return false; } });
check("4. THE SERVER NAMES THE FOUR PDFs BY ID (DOC_FILES: quick, ops, tech, dev - the four tools/build_pdfs.py writes), "
      + "each on disk under docs/ and a PDF; GET /docs/<id> serves one INLINE with the PDF type and its file name "
      + "(_serve_doc); it opens nothing on its own machine - no /api/open_doc, no DOC_OPEN, no startfile of a document; "
      + "never a path from the browser (doc_path picks the file by id)",
      () => IDS.every(id => docFiles.includes(`"${id}": "${FILES[id]}"`)) && onDisk.every(Boolean)
            && /elif root\.startswith\("\/docs\/"\):\s*#[^\n]*\n\s*self\._serve_doc\(root\[len\("\/docs\/"\):\]\)/.test(PY)
            && /def _serve_doc\(self, doc\):/.test(PY) && /self\.send_header\("Content-Type", PDF_MIME\)/.test(PY)
            && /PDF_MIME = "application\/pdf"/.test(PY)
            && /self\.send_header\("Content-Disposition", 'inline; filename="%s"' % DOC_FILES\[doc\]\)/.test(PY)
            && !/path == "\/api\/open_doc"/.test(PY) && !/\bDOC_OPEN\b/.test(PY) && !/def open_doc\(/.test(PY)
            && /def doc_path\(doc\):[\s\S]*?name = DOC_FILES\.get\(str\(doc or ""\)\)/.test(PY)
            && !/os\.path\.join\(DOCS_DIR, (doc|body)/.test(PY),
      () => JSON.stringify({ onDisk, named: IDS.map(id => docFiles.includes(`"${id}": "${FILES[id]}"`)) }));

// ---- 5. the manuals name them ---------------------------------------------------------------------------------- //
const README = fs.readFileSync(path.join(ROOT, "README.md"), "utf8"), OPS = fs.readFileSync(path.join(ROOT, "tools", "build_ops_manual.js"), "utf8"),
      TECH = fs.readFileSync(path.join(ROOT, "tools", "build_tech_manual.js"), "utf8");
check("5. THE MANUALS NAME THE BUTTONS: the README and the operations manual say QUICK / OPS / TECH / DEV open the four "
      + "documents as PDFs, and the technical manual's API table carries /docs/<id> and no longer /api/open_doc",
      () => /QUICK[^\n]*OPS[^\n]*TECH[^\n]*DEV[^\n]*PDF/.test(README) && /QUICK[^\n]*OPS[^\n]*TECH[^\n]*DEV[^\n]*PDF/.test(OPS)
            && /`\/docs\/<id>`/.test(TECH) && !/`\/api\/open_doc`/.test(TECH),
      () => "");

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
