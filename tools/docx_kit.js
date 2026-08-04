// Shared docx building blocks for the generated document set.
//
// EVERY DOCUMENT IN docs/ IS GENERATED - edit the build script and rebuild; never
// hand-edit a docx. If one is hand-edited in Word anyway: diff that text against the
// generated version, fold the edits INTO the script (marked as the author's), rebuild.
//
//   cd tools && npm install && node build_docs.js        # all four
//
// This module exists because there are now four generators. It was extracted from
// build_tech_manual.js verbatim, and that manual's output is byte-identical across the
// extraction - which is the only reason the refactor was safe to make.
//
// BRAND-FREE BY RULE. This console is the generic, vendor-neutral sibling: the onboard
// controller is a VCU, and no vendor or model name appears in the console core or in any
// generated document. Vessel FILES may name real vessels - that is data, not branding -
// so a vessel table quoting a real hull is fine and a "the X console" framing is not.
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, ShadingType,
  LevelFormat,
} = require("docx");
const fs = require("fs");
const path = require("path");

const MONO = "Consolas";
const INK = "1a1a1a", ACCENT = "1f4e79";

// P("text with `code` spans") -> Paragraph with Consolas runs for backticked parts
function runs(text, opts = {}) {
  const out = [];
  String(text).split("`").forEach((seg, i) => {
    if (!seg) return;
    if (i % 2 === 1) out.push(new TextRun({ text: seg, font: MONO, size: opts.size || 20, color: opts.color || INK }));
    else out.push(new TextRun({ text: seg, size: opts.size || 21, color: opts.color || INK, bold: opts.bold, italics: opts.italics }));
  });
  return out;
}
function P(text, opts = {}) {
  return new Paragraph({ children: runs(text, opts), spacing: { after: opts.after ?? 120 }, alignment: opts.align });
}
function H1(text) { return new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 340, after: 170 } }); }
function H2(text) { return new Paragraph({ text, heading: HeadingLevel.HEADING_2, spacing: { before: 260, after: 130 } }); }
function H3(text) { return new Paragraph({ text, heading: HeadingLevel.HEADING_3, spacing: { before: 200, after: 100 } }); }
function B(text) {
  return new Paragraph({ children: runs(text), numbering: { reference: "bullets", level: 0 }, spacing: { after: 70 } });
}
function B2(text) {
  return new Paragraph({ children: runs(text), numbering: { reference: "bullets", level: 1 }, spacing: { after: 60 } });
}
function CODE(lines) {
  return lines.map(l => new Paragraph({
    children: [new TextRun({ text: l === "" ? " " : l, font: MONO, size: 18 })],
    shading: { type: ShadingType.CLEAR, fill: "F2F4F7" },
    spacing: { after: 0 }, indent: { left: 240, right: 240 },
  }));
}
const TOTAL = 9360; // usable table width (12240 - 2x1440 margins)
function TBL(headers, rows, widths) {
  const w = widths || headers.map(() => Math.floor(TOTAL / headers.length));
  const mk = (t, head) => new TableCell({
    width: { size: w[t.i], type: WidthType.DXA },
    shading: head ? { type: ShadingType.CLEAR, fill: "DDE5EF" } : undefined,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({ children: runs(t.s, { size: 19, bold: head }), spacing: { after: 0 } })],
  });
  return new Table({
    width: { size: TOTAL, type: WidthType.DXA }, columnWidths: w,
    rows: [
      new TableRow({ children: headers.map((s, i) => mk({ s, i }, true)), tableHeader: true }),
      ...rows.map(r => new TableRow({ children: r.map((s, i) => mk({ s: String(s), i }, false)) })),
    ],
  });
}
const SP = () => new Paragraph({ text: "", spacing: { after: 60 } });

// A CAUTION / NOTE callout: shaded, so a safety-critical line cannot be skimmed past.
// The operations manual leans on this; nothing else should use it decoratively.
function NOTE(label, text, fill) {
  return new Paragraph({
    children: [new TextRun({ text: label + "  ", bold: true, size: 20, color: "8a3a1f" }), ...runs(text, { size: 20 })],
    shading: { type: ShadingType.CLEAR, fill: fill || "FBF0E4" },
    spacing: { before: 100, after: 140 }, indent: { left: 160, right: 160 },
    border: {
      top: { style: "single", size: 2, color: "E0C09A" }, bottom: { style: "single", size: 2, color: "E0C09A" },
      left: { style: "single", size: 12, color: "C87A3A" }, right: { style: "single", size: 2, color: "E0C09A" },
    },
  });
}
const TITLE = (t) => new Paragraph({ text: t, heading: HeadingLevel.TITLE, spacing: { after: 80 } });

// Assemble + write. `name` is the docx basename; the path is script-relative so the
// generators can be run from anywhere.
function write(name, children) {
  // FLATTEN FIRST. CODE() returns an ARRAY of paragraphs (one per line) while every other
  // helper returns a single object, so `c.push(CODE([...]))` pushed the array itself as ONE
  // child. The docx serializer emitted it as the literal element `<0/>` - an element name
  // cannot begin with a digit, so word/document.xml was NOT WELL-FORMED and Word refused to
  // open the file at all. Worse than the validity error: the array's CONTENTS were dropped,
  // so every code block in every document was missing - including the Quick Start's "how to
  // run it" commands, which are most of the reason that document exists.
  //
  // EVERY GENERATED DOCUMENT CARRIED THIS FROM THE DAY THE FIRST ONE WAS BUILT (2a28a59,
  // 2026-08-01) until 2026-08-04, across eighteen commits. Nobody opened one until Andy
  // tried to. Flattening HERE rather than spreading at the six call sites fixes them all at
  // once and makes the next helper that returns a list safe by construction.
  children = children.flat(Infinity).filter(x => x != null);
  const doc = new Document({
    numbering: {
      config: [{
        reference: "bullets",
        levels: [
          { level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 460, hanging: 230 } } } },
          { level: 1, format: LevelFormat.BULLET, text: "◦", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 860, hanging: 230 } } } },
        ],
      }],
    },
    styles: {
      default: { document: { run: { size: 21, font: "Calibri", color: INK } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 32, bold: true, color: ACCENT }, paragraph: { spacing: { before: 340, after: 170 } } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 26, bold: true, color: "2e5f8a" }, paragraph: { spacing: { before: 260, after: 130 } } },
        { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
          run: { size: 22, bold: true, color: "3a3a3a" }, paragraph: { spacing: { before: 200, after: 100 } } },
      ],
    },
    sections: [{
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      children,
    }],
  });
  return Packer.toBuffer(doc).then(buf => {
    const out = path.join(__dirname, "..", "docs");
    fs.mkdirSync(out, { recursive: true });
    fs.writeFileSync(path.join(out, name), buf);
    console.log("written:", name, buf.length, "bytes");
    return buf.length;
  });
}

module.exports = { runs, P, H1, H2, H3, B, B2, CODE, TBL, SP, NOTE, TITLE, write, MONO, INK, ACCENT };
