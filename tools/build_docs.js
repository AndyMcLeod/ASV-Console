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
// The generators write asynchronously, so report on exit rather than here.
process.on("exit", () => {
  if (failed) {
    console.error("\n" + failed + " generator(s) FAILED — the document set is incomplete.");
    process.exitCode = 1;
  } else {
    console.log("\nDocument set rebuilt (" + SCRIPTS.length + " documents).");
  }
});
