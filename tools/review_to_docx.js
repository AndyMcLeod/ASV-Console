// Render a Markdown review report in docs/ to Word, in the document set's own formatting (docx_kit).
//
//   node tools/review_to_docx.js docs/review-2026-10-16.md      -> docs/review-2026-10-16.docx
//
// THE MARKDOWN IS THE SOURCE. The .docx is a rendering of it: edit the .md and run this again, never the
// .docx (the rule the whole document set lives by, docx_kit.js). A review report is not one of the four
// manuals - it is a dated record, written once and kept - so it is not in build_docs.js, and docs_valid.py
// checks the manuals by name (asv-simulator-*.docx); sanitization.py reads every .docx in docs/, this one too.
//
// What it reads: a `# ` title, `## ` and `### ` headings, numbered findings (`N. ...` with their indented
// continuation lines), `- ` bullets, paragraphs separated by blank lines; `**bold**` and `code` spans inline.
// That is the shape of docs/review-2026-10-16.md; a report that needs more (tables, code blocks) extends this.
const fs = require("fs");
const path = require("path");
const { TextRun, Paragraph } = require("docx");
const { H1, H2, H3, TITLE, B, write, MONO, INK } = require("./docx_kit");

const src = process.argv[2];
if (!src || !src.endsWith(".md")) {
  console.error("usage: node tools/review_to_docx.js docs/<report>.md");
  process.exit(2);
}
const text = fs.readFileSync(src, "utf8").replace(/\r\n/g, "\n");
const outName = path.basename(src, ".md") + ".docx";

// `code` and **bold** inline, in the kit's sizes and ink
function inline(s) {
  const out = [];
  String(s).split(/(\*\*[^*]+\*\*|`[^`]+`)/).forEach(seg => {
    if (!seg) return;
    if (seg.startsWith("**") && seg.endsWith("**") && seg.length > 4) out.push(new TextRun({ text: seg.slice(2, -2), bold: true, size: 21, color: INK }));
    else if (seg.startsWith("`") && seg.endsWith("`") && seg.length > 2) out.push(new TextRun({ text: seg.slice(1, -1), font: MONO, size: 20, color: INK }));
    else out.push(new TextRun({ text: seg, size: 21, color: INK }));
  });
  return out;
}
const para = (s) => new Paragraph({ children: inline(s), spacing: { after: 120 } });
// a numbered finding keeps its own number (they run 1-28 across sections), hung in the margin
const item = (s) => new Paragraph({ children: inline(s), indent: { left: 540, hanging: 540 }, spacing: { after: 100 } });
const joined = (lines) => lines.map(l => l.trim()).filter(Boolean).join(" ");

const c = [];
for (const block of text.split(/\n[ \t]*\n/)) {
  const lines = block.split("\n").filter(l => l.trim() !== "");
  if (!lines.length) continue;
  const first = lines[0];
  if (/^# /.test(first)) { c.push(TITLE(first.slice(2).trim())); lines.slice(1).length && c.push(para(joined(lines.slice(1)))); continue; }
  if (/^## /.test(first)) { c.push(H1(first.slice(3).trim())); continue; }
  if (/^### /.test(first)) { c.push(H2(first.slice(4).trim())); continue; }
  if (/^#### /.test(first)) { c.push(H3(first.slice(5).trim())); continue; }
  // numbered findings and bullets: a new one starts at an unindented `N. ` or `- `; the rest are continuation lines
  if (/^(\d+\. |- )/.test(first)) {
    let cur = [];
    const flush = () => { if (cur.length) { const t = joined(cur); c.push(/^- /.test(t) ? B(t.slice(2)) : item(t)); cur = []; } };
    for (const l of lines) {
      if (/^(\d+\. |- )/.test(l)) flush();
      cur.push(l);
    }
    flush();
    continue;
  }
  c.push(para(joined(lines)));
}

write(outName, c).then(() => console.log("rendered", src, "->", path.join("docs", outName)));
