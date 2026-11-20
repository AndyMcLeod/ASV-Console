// Build the whole generated document set in one pass.
//
//   cd tools && npm install && node build_docs.js
//
// Each generator is standalone and can still be run on its own; this exists so the
// "rebuild the docs" step in the development loop is ONE command and cannot silently
// leave one of four documents stale. Every script writes into ../docs.
//
// Adding a document: write tools/build_<name>.js against ./docx_kit, add it to the list
// below, and add it to the document-set table in the technical manual and the README.
const path = require("path");

const SCRIPTS = [
  "build_quickstart.js",
  "build_ops_manual.js",
  "build_tech_manual.js",
  "build_dev_guide.js",
];

console.log("Rebuilding the generated document set:");
let failed = 0;
for (const s of SCRIPTS) {
  try {
    require(path.join(__dirname, s));
  } catch (e) {
    console.error("  FAILED  " + s + ": " + e.message);
    failed++;
  }
}
// THE PDFs (2026-11-19, Andy: "convert them from word to PDF"): once every .docx is written - the generators write
// asynchronously, so when the event loop has nothing left - tools/build_pdfs.py converts each document whose content
// changed, by LibreOffice (never Word). Python as start_sim.bat finds it: `python`, else `py`.
let pdfs = null;                 // null: not run (a generator failed); else build_pdfs.py's exit status
process.on("beforeExit", () => {
  if (pdfs !== null || failed) return;
  console.log("\nThe PDFs (tools/build_pdfs.py, by LibreOffice):");
  const { spawnSync } = require("child_process");
  const script = path.join(__dirname, "build_pdfs.py");
  let r = spawnSync("python", [script], { stdio: "inherit" });
  if (r.error && r.error.code === "ENOENT") r = spawnSync("py", [script], { stdio: "inherit" });
  if (r.error && r.error.code === "ENOENT") r = spawnSync("python3", [script], { stdio: "inherit" });
  pdfs = r.error ? 1 : r.status;
  if (r.error) console.error("  PDFs NOT REBUILT: no Python to run build_pdfs.py (" + r.error.message + ")");
});
// The generators write asynchronously, so report on exit rather than here.
process.on("exit", () => {
  if (failed) {
    console.error("\n" + failed + " generator(s) FAILED — the document set is incomplete.");
    process.exitCode = 1;
  } else if (pdfs !== 0) {
    console.error("\nDocument set rebuilt (" + SCRIPTS.length + " documents), but the PDFs were NOT: see above.");
    process.exitCode = 1;
  } else {
    console.log("\nDocument set rebuilt (" + SCRIPTS.length + " documents and their PDFs).");
  }
});
