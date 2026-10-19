// tests/doc_buttons.js - THE FOUR DOCUMENTS ON THE CHART'S COMMAND BAR (Andy, 2026-10-19: "In the chart window lower
// toolbar add 4 buttons - each button opens one of the 4 asv simulator word documents").
//
// A button asks the console to open its Word document (POST /api/open_doc): on the console's own machine Word opens it
// there ("word"); otherwise the browser takes the file from /docs/<id> ("download"). The page half, in a world of its
// own, and the server half BY SOURCE (its live answers are tests/doc_routes.py's):
//   1. the four buttons are on the chart's command bar, at its left end before the zoom buttons and well away from
//      E-STOP, each naming its document and its id;
//   2. openDoc: "word" says so and opens nothing; "download" opens the console's URL; a refusal says the console's
//      words and opens nothing; a console that does not answer, or answers no JSON, still gets the download;
//   3. each button is wired to openDoc with its own id, outside cmd() (a VIEW ONLY tab may read the manuals);
//   4. the server names the four files by id, each on disk and a Word package; opens only for a loopback browser and
//      only through DOC_OPEN, which ASV_DOC_OPEN=off empties (a suite must never open Word);
//   5. the manuals name the buttons.
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
const PY = fs.readFileSync(path.join(ROOT, "asv_console.py"), "utf8").split("\r\n").join("\n");

function grab(name) {
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;      // an async function keeps its keyword (openDoc awaits)
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
const FILES = { quick: "asv-simulator-quick-start.docx", ops: "asv-simulator-operations-manual.docx",
                tech: "asv-simulator-technical-manual.docx", dev: "asv-simulator-development-guide.docx" };

// ---- 1. the markup ---------------------------------------------------------------------------------------------- //
const bar = H.slice(H.indexOf('<div class="cmdbar">'), H.indexOf('id="b_reset"'));
const btn = id => bar.match(new RegExp(`<button class="ctl small doc" id="doc_${id}" data-doc="${id}" title="([^"]*)">([A-Z ]+)</button>`));
const at = id => bar.indexOf(`id="doc_${id}"`);
check("1. FOUR BUTTONS ON THE CHART'S COMMAND BAR, at its left end: each .ctl.small.doc, id doc_<id>, data-doc its id, its "
      + "title naming the document as a Word document, labeled QUICK / OPS / TECH / DEV; in that order, before the zoom "
      + "buttons, a divider after them, and the whole group before ARM and E-STOP",
      () => IDS.every(id => btn(id) && /Word document/.test(btn(id)[1]) && btn(id)[2] === LABELS[id])
            && /Quick Start/.test(btn("quick")[1]) && /Operations Manual/.test(btn("ops")[1])
            && /Technical Manual/.test(btn("tech")[1]) && /Development Guide/.test(btn("dev")[1])
            && at("quick") < at("ops") && at("ops") < at("tech") && at("tech") < at("dev")
            && at("dev") < bar.indexOf('id="zin"') && at("dev") < bar.indexOf('id="b_arm"') && at("dev") < bar.indexOf('id="b_estop"')
            && /id="doc_dev"[^\n]*\n\s*<span class="cdiv"><\/span>\s*\n\s*<button class="ctl" id="zin"/.test(bar),
      () => JSON.stringify({ found: IDS.map(id => !!btn(id)), labels: IDS.map(id => btn(id) && btn(id)[2]) }));

// ---- 2-3. openDoc and the wiring, in a world of their own ------------------------------------------------------- //
function mkWorld(answer) {
  const w = { notes: [], opened: [], posts: [], buttons: IDS.map(id => ({ className: "ctl small doc", dataset: { doc: id }, onclick: null })) };
  const fetch = async (url, opts) => { w.posts.push({ url, opts }); return answer(w); };
  const src = grab("took") + "\n" + grabDecl("DOC_NAMES") + "\n" + grab("openDoc") + "\n"
    + (H.match(/for\(const b of document\.querySelectorAll\("\.cmdbar button\.doc"\)\) b\.onclick = [^\n]*/) || [""])[0]
    + "\nreturn {openDoc};";
  // eslint-disable-next-line no-new-func
  w.api = new Function("document", "fetch", "window", "flashNote", "CLIENT_ID", src)(
    { querySelectorAll: sel => (sel === ".cmdbar button.doc" ? w.buttons : []) }, fetch,
    { open: (u, t) => { w.opened.push([u, t]); } }, m => w.notes.push(m), "tab-A");
  return w;
}
const json = obj => ({ json: async () => obj });
const W1 = mkWorld(() => json({ ok: true, opened: "word", doc: "ops", file: FILES.ops }));
const W2 = mkWorld(() => json({ ok: true, opened: "download", doc: "tech", file: FILES.tech, url: "/docs/tech", note: "the browser is not on the console's machine" }));
const W3 = mkWorld(() => json({ error: "no such document: 'x' - one of dev, ops, quick, tech" }));
const W4 = mkWorld(() => { throw new Error("Failed to fetch"); });
const W5 = mkWorld(() => ({ json: async () => { throw new SyntaxError("Unexpected token <"); } }));
(async () => {
  const r1 = await W1.api.openDoc("ops"), r2 = await W2.api.openDoc("tech"), r3 = await W3.api.openDoc("x");
  const r4 = await W4.api.openDoc("quick"), r5 = await W5.api.openDoc("dev");
  const post = W1.posts[0];
  check("2. openDoc POSTS /api/open_doc {doc} as JSON with the tab's name, outside cmd(): \"word\" says the console's machine "
        + "opened it and opens nothing here; \"download\" opens the console's own URL in a new tab and repeats the console's "
        + "note; a refusal says the console's words and opens nothing; a console that does not answer, or answers no JSON, "
        + "still gets the download from /docs/<id>",
        () => post && post.url === "/api/open_doc" && post.opts.method === "POST" && post.opts.body === JSON.stringify({ doc: "ops" })
              && post.opts.headers["Content-Type"] === "application/json" && post.opts.headers["X-ASV-Client"] === "tab-A"
              && r1 === "word" && W1.opened.length === 0 && /Opened the Operations Manual in Word on the console's machine/.test(W1.notes[0])
              && r2 === "download" && W2.opened.length === 1 && W2.opened[0][0] === "/docs/tech" && W2.opened[0][1] === "_blank"
              && /Downloading the Technical Manual \(a Word document\) - the browser is not on the console's machine: open it from the browser's downloads/.test(W2.notes[0])
              && r3 === "refused" && W3.opened.length === 0 && /could not open the x: no such document/.test(W3.notes[0])
              && r4 === "download" && W4.opened.length === 1 && W4.opened[0][0] === "/docs/quick" && /Downloading the Quick Start/.test(W4.notes[0])
              && r5 === "download" && W5.opened.length === 1 && W5.opened[0][0] === "/docs/dev" && /Downloading the Development Guide/.test(W5.notes[0])
              && !/cmd\(/.test(grab("openDoc")) && /took\(r\) && r\.opened === "word"/.test(grab("openDoc")),
        () => JSON.stringify({ post: post && { url: post.url, body: post.opts.body }, r1, r2, r3, r4, r5,
                               opened: [W1.opened, W2.opened, W3.opened, W4.opened, W5.opened], notes: [W1.notes[0], W2.notes[0], W3.notes[0]] }));
  // 3. the wiring: each button's click asks openDoc for ITS id - the world's fake fetch records the id posted
  const W6 = mkWorld(() => json({ ok: true, opened: "word" }));
  for (const b of W6.buttons) b.onclick();
  await new Promise(r => setTimeout(r, 0));
  check("3. EACH BUTTON IS WIRED to openDoc with its own id (its data-doc): four clicks, four posts, quick / ops / tech / dev",
        () => W6.buttons.every(b => typeof b.onclick === "function")
              && W6.posts.map(p => JSON.parse(p.opts.body).doc).join() === IDS.join(),
        () => JSON.stringify(W6.posts.map(p => p.opts.body)));

  // ---- 4. the server, by source and by disk -------------------------------------------------------------------- //
  const docFiles = (PY.match(/DOC_FILES = \{[\s\S]*?\}/) || [""])[0];
  const onDisk = IDS.map(id => { try { const b = fs.readFileSync(path.join(ROOT, "docs", FILES[id])); return b.length > 1000 && b[0] === 0x50 && b[1] === 0x4b; } catch (e) { return false; } });
  const openDoc = PY.slice(PY.indexOf("def open_doc("), PY.indexOf("\n\n\n", PY.indexOf("def open_doc(")));
  check("4. THE SERVER NAMES THE FOUR FILES BY ID (DOC_FILES: quick, ops, tech, dev - the four documents build_docs.js writes), "
        + "each on disk under docs/ and a Word package (a zip); GET /docs/<id> serves one (_serve_doc, its own type and file "
        + "name, attachment) and POST /api/open_doc opens it (open_doc) - only for a LOOPBACK browser, only through DOC_OPEN, "
        + "which ASV_DOC_OPEN=off empties; never a path from the browser (doc_path picks the file by id)",
        () => IDS.every(id => docFiles.includes(`"${id}": "${FILES[id]}"`)) && onDisk.every(Boolean)
              && /elif root\.startswith\("\/docs\/"\):\s*#[^\n]*\n\s*self\._serve_doc\(root\[len\("\/docs\/"\):\]\)/.test(PY)
              && /def _serve_doc\(self, doc\):/.test(PY) && /self\.send_header\("Content-Type", DOCX_MIME\)/.test(PY)
              && /self\.send_header\("Content-Disposition", 'attachment; filename="%s"' % DOC_FILES\[doc\]\)/.test(PY)
              && /elif path == "\/api\/open_doc":[^\n]*\n\s*code, obj = open_doc\(body\.get\("doc"\), self\.client_address\[0\][^\n]*\n\s*return code, obj\n/.test(PY)
              && /if client_ip not in LOOPBACK:/.test(openDoc) && /if not DOC_OPEN:/.test(openDoc) && /DOC_OPEN\(p\)/.test(openDoc)
              && /LOOPBACK = \("127\.0\.0\.1", "::1", "::ffff:127\.0\.0\.1"\)/.test(PY)
              && /DOC_OPEN = getattr\(os, "startfile", None\) if os\.environ\.get\("ASV_DOC_OPEN", "os"\) != "off" else None/.test(PY)
              && /def doc_path\(doc\):[\s\S]*?name = DOC_FILES\.get\(str\(doc or ""\)\)/.test(PY)
              && !/os\.path\.join\(DOCS_DIR, (doc|body)/.test(PY),
        () => JSON.stringify({ onDisk, named: IDS.map(id => docFiles.includes(`"${id}": "${FILES[id]}"`)) }));

  // ---- 5. the manuals name them ---------------------------------------------------------------------------------- //
  const README = fs.readFileSync(path.join(ROOT, "README.md"), "utf8"), OPS = fs.readFileSync(path.join(ROOT, "tools", "build_ops_manual.js"), "utf8"),
        TECH = fs.readFileSync(path.join(ROOT, "tools", "build_tech_manual.js"), "utf8");
  check("5. THE MANUALS NAME THE BUTTONS: the README and the operations manual say QUICK / OPS / TECH / DEV open the four Word "
        + "documents, and the technical manual's API table carries /docs/<id> and /api/open_doc",
        () => /QUICK[^\n]*OPS[^\n]*TECH[^\n]*DEV/.test(README) && /QUICK[^\n]*OPS[^\n]*TECH[^\n]*DEV/.test(OPS)
              && /`\/docs\/<id>`/.test(TECH) && /`\/api\/open_doc`/.test(TECH),
        () => "");

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
