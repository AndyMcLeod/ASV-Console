// ASV Simulator Console — graduate-level deck (14 slides)
// Programming by conversation + the DES schema from the case-study series.
//
// Rebuild:   cd tools && npm install && node build_deck.js
// Output:    docs/ASV-Console-Programming-by-Conversation.pptx
//
// Icons come from deck_icons.json (committed); regenerate that set only if
// adding icons — see build_deck_icons.js, which needs extra deps on purpose
// so the default npm install stays light.
//
// Like the docx set: a rebuilt pptx differs by zip timestamps alone unless
// slide content changed — only commit it when the slide XML actually moved
// (compare sha256 of ppt/slides/*.xml between old and new).
const path = require("path");
const pptxgen = require("pptxgenjs");
const icons = require("./deck_icons.json");
const fs = require("fs");

// COUNTED, NOT QUOTED. This deck stated "~11,700 lines across 6 source files" and "30 suites"
// for six weeks after both stopped being true - by 2026-09-23 the tree was 28,675 lines across
// 21 files and 96 suites. A number a reader does not ACT on should not be typed into a
// document at all; it should be worked out by the build, so it cannot drift from the thing it
// describes. The sprint figures below are different: they are DATED, and they stay.
const REPO = path.join(__dirname, "..");
const SRC_FILES = [path.join(REPO, "asv_console.py"), path.join(REPO, "static", "asv.html")]
  .concat(fs.readdirSync(path.join(REPO, "static", "js"))
            .filter(f => f.endsWith(".js"))
            .map(f => path.join(REPO, "static", "js", f)));
// Counted the way `wc -l` counts: the NEWLINES. Splitting on the line ending yields a
// trailing empty element for a file that ends with one, which made this 21 lines heavy
// across 21 files - a derived number nobody was ever going to check again.
const srcLines = SRC_FILES.reduce((n, f) => {
  const t = fs.readFileSync(f, "utf8");
  const lines = t.split(/\r?\n/).length;
  return n + (t.endsWith("\n") ? lines - 1 : lines);
}, 0);
const srcFiles = SRC_FILES.length;
const suiteCount = fs.readdirSync(path.join(REPO, "tests"))
                     .filter(f => /\.(js|py)$/.test(f)).length;
const fmtN = n => n.toLocaleString("en-US");

const OUT = path.join(__dirname, "..", "docs", "ASV-Console-Programming-by-Conversation.pptx");

// palette — maritime: navy dominates, teal supports, brass accent
const DEEP = "0A2239";   // midnight navy (dark slides)
const PRIM = "065A82";   // deep sea blue (dominant)
const TEAL = "1C7293";   // supporting teal
const ICE  = "EAF2F8";   // pale tint for cards
const ACC  = "C9862B";   // brass amber accent
const INK  = "1A2733";   // body ink
const MUT  = "5A6B7A";   // muted
const HDR = "Cambria";
const BODY = "Calibri";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.33 x 7.5

function img(key) { return "image/png;base64," + icons[key]; }

function iconCircle(s, key, x, y, d, color) {
  s.addShape("ellipse", { x, y, w: d, h: d, fill: { color } });
  const pad = d * 0.26;
  s.addImage({ data: img(key), x: x + pad, y: y + pad, w: d - 2 * pad, h: d - 2 * pad });
}

function titleBar(s, kicker, title) {
  s.addText(kicker.toUpperCase(), { x: 0.6, y: 0.32, w: 12.1, h: 0.3, fontFace: BODY, fontSize: 12, color: TEAL, charSpacing: 2, bold: true, margin: 0 });
  s.addText(title, { x: 0.6, y: 0.58, w: 12.1, h: 0.75, fontFace: HDR, fontSize: 31, bold: true, color: DEEP, margin: 0 });
}

function note(s, t) { s.addNotes(t); }

/* ---------------- S1 — title (dark) ---------------- */
{
  const s = pres.addSlide();
  s.background = { color: DEEP };
  iconCircle(s, "ship", 10.35, 0.85, 1.5, PRIM);
  s.addText("Programming by Conversation", { x: 0.9, y: 2.05, w: 11.5, h: 1.0, fontFace: HDR, fontSize: 44, bold: true, color: "FFFFFF", margin: 0 });
  s.addText("The ASV Simulator Console: an autonomous-surface-vehicle shore station built entirely by directing a coding agent", { x: 0.9, y: 3.1, w: 10.8, h: 0.9, fontFace: BODY, fontSize: 20, color: "CADCFC", margin: 0 });
  s.addText([
    { text: "with a fourth application of the ", options: {} },
    { text: "Domain-Expert Specification (DES) schema", options: { bold: true, color: "FFFFFF" } },
    { text: " developed across the earlier case studies", options: {} },
  ], { x: 0.9, y: 4.05, w: 10.8, h: 0.5, fontFace: BODY, fontSize: 16, color: "9FB8CC", italic: true, margin: 0 });
  s.addText("A. McLeod  ·  development assistant: Claude (Anthropic), Claude Code  ·  August 2026", { x: 0.9, y: 6.55, w: 11.5, h: 0.4, fontFace: BODY, fontSize: 13, color: "7E97AB", margin: 0 });
  note(s, "Frame for a graduate audience: this is a case study in human-AI software engineering. The artifact is real and operational; the method — a domain expert specifying in plain language, an agent implementing and discovering — is the research object. The DES schema was proposed and tested across four earlier tools; here it is read against the largest artifact in the series.");
}

/* ---------------- S2 — the artifact ---------------- */
{
  const s = pres.addSlide();
  s.background = { color: "FFFFFF" };
  titleBar(s, "The artifact", "A browser-only C2 shore station and simulator");
  s.addText([
    { text: "Command-and-control for a small survey ASV, plus a full simulator", options: { bold: true, breakLine: true } },
    { text: "Plan surveys, search patterns and transits on a live NOAA ENC chart; run Go-To / Return-to-Home / Hold / Transit against a Vehicle Control Unit — simulated or real.", options: { breakLine: true, paraSpaceAfter: 10 } },
    { text: "Every commanded motion routes clear of charted hazards", options: { bold: true, breakLine: true } },
    { text: "A \u201Cnogo\u201D model is extracted from the ENC at startup — shoreline, piers, shallow water by vessel draft — and A* routing plans around it.", options: { breakLine: true, paraSpaceAfter: 10 } },
    { text: "Vessel-profile driven", options: { bold: true, breakLine: true } },
    { text: "Hull, energy model (battery or diesel), autopilot gains and planning defaults live in one JSON file per vessel; the same mission runs on different hulls.", options: { breakLine: true, paraSpaceAfter: 10 } },
    { text: "Zero dependencies, honest about hardware", options: { bold: true, breakLine: true } },
    { text: "Python 3 standard library + vanilla JS only. The real-hardware path refuses to transmit until the wire protocol is captured — it fails honestly rather than guess at a real boat.", options: {} },
  ], { x: 0.6, y: 1.55, w: 6.5, h: 5.3, fontFace: BODY, fontSize: 14, color: INK, margin: 0, valign: "top" });

  const tiles = [
    [fmtN(srcLines), "lines across " + srcFiles + " source files\n(one server file, one UI page, shared modules)"],
    ["109", "commits in 14 days\n(2026-07-22 \u2192 08-05)"],
    [String(suiteCount), "regression suites,\nevery one run by the pre-commit hook"],
    ["4 + 3", "generated Word manuals +\nvessel profiles (data, not code)"],
  ];
  tiles.forEach(([big, small], i) => {
    const x = 7.5 + (i % 2) * 2.75, y = 1.75 + Math.floor(i / 2) * 2.3;
    s.addShape("roundRect", { x, y, w: 2.55, h: 2.05, rectRadius: 0.08, fill: { color: ICE } });
    s.addText(big, { x: x + 0.15, y: y + 0.2, w: 2.25, h: 0.75, fontFace: HDR, fontSize: 30, bold: true, color: PRIM, margin: 0 });
    s.addText(small, { x: x + 0.15, y: y + 1.0, w: 2.25, h: 0.95, fontFace: BODY, fontSize: 11, color: MUT, margin: 0 });
  });
  s.addText("Sanitized, brand-free derivative of an operational console — the vendor identity lives in data files, never in code.", { x: 7.5, y: 6.3, w: 5.3, h: 0.6, fontFace: BODY, fontSize: 11.5, italic: true, color: MUT, margin: 0 });
  note(s, "Scale matters for the argument: the earlier case studies were single-instrument tools (a relay panel, a dish dashboard, a sonar display). This is an order of magnitude larger — a planner, a physics simulator, a safety model, an AIS subsystem, and a documentation pipeline — which stresses the conversation method differently. The RC transmitter remains the true failsafe; the console is additive shore-side C2.");
}

/* ---------------- S3 — architecture ---------------- */
{
  const s = pres.addSlide();
  s.background = { color: "FFFFFF" };
  titleBar(s, "Architecture", "Single-file server, thin browser, one honest seam");

  function box(x, y, w, h, head, body, fillC, headC, bodyC) {
    s.addShape("roundRect", { x, y, w, h, rectRadius: 0.07, fill: { color: fillC } });
    s.addText(head, { x: x + 0.18, y: y + 0.12, w: w - 0.36, h: 0.35, fontFace: BODY, fontSize: 14, bold: true, color: headC, margin: 0 });
    s.addText(body, { x: x + 0.18, y: y + 0.5, w: w - 0.36, h: h - 0.62, fontFace: BODY, fontSize: 11.5, color: bodyC, margin: 0, valign: "top" });
  }
  // Browser tier
  box(0.6, 1.75, 3.5, 2.5, "Browser (vanilla JS)", "asv.html — chart window + controls window, bridged over BroadcastChannel\n\nplayback.html — read-only session review", ICE, DEEP, INK);
  // Server tier
  box(4.75, 1.6, 3.9, 3.7, "asv_console.py (stdlib only)", "HTTP + SSE server\nENC \u201Cnogo\u201D extraction & A* route planner\nSurvey / search / transit geometry\nSim engine: hull physics, energy, weather\nSafety gates: SAFE, E-STOP, refusals\nSession recorder (JSONL)", PRIM, "FFFFFF", "D8E8F2");
  // VCU seam
  box(9.3, 1.6, 3.4, 1.7, "VCU seam", "SimVcu — full vessel simulation\nRealVcu — opens the transport, REFUSES to command until the protocol is captured", DEEP, "FFFFFF", "C9D9E8");
  // side services
  box(9.3, 3.6, 3.4, 1.7, "Sidecar processes", "ais_service.py — AIS registry (aisstream / NMEA), own HTTP face\ngps_sim.py — NMEA feed for moving-HOME tests", ICE, DEEP, INK);
  // data sources
  box(4.75, 5.55, 7.95, 1.35, "External truth", "NOAA ENC charts  ·  CO-OPS tides & water level  ·  NDBC buoys (live weather into the sim)  ·  aisstream.io  ·  vessels/*.json profiles", "F5F0E6", "7A5A18", INK);
  // arrows
  const arr = (x1, y1, x2, y2) => s.addShape("line", { x: x1, y: y1, w: x2 - x1, h: y2 - y1, line: { color: MUT, width: 2, endArrowType: "triangle" } });
  arr(4.1, 2.9, 4.75, 2.9);
  arr(8.65, 2.45, 9.3, 2.45);
  arr(8.65, 4.45, 9.3, 4.45);
  arr(6.9, 5.3, 6.9, 5.55);
  s.addText("HTTP + SSE", { x: 3.3, y: 2.5, w: 1.35, h: 0.3, fontFace: BODY, fontSize: 9.5, color: MUT, align: "center", margin: 0 });
  note(s, "The design choice worth defending to engineers: no build step, no pip, one server file. That is a deployment constraint from the field context (a vessel console you can stand up anywhere), and it came from the specification, not the agent's preference. The VCU seam is the safety argument in miniature — the real path exists, connects, and declines to transmit, because an uncertain frame to a real boat is worse than no frame.");
}

/* ---------------- S4 — the method ---------------- */
{
  const s = pres.addSlide();
  s.background = { color: "FFFFFF" };
  titleBar(s, "Method", "Programming by conversation: a division of labor");

  s.addShape("roundRect", { x: 0.6, y: 1.6, w: 6.0, h: 3.9, rectRadius: 0.08, fill: { color: ICE } });
  iconCircle(s, "compass", 0.95, 1.9, 0.62, PRIM);
  s.addText("The domain expert brings the what and the why", { x: 1.75, y: 1.95, w: 4.7, h: 0.6, fontFace: BODY, fontSize: 15.5, bold: true, color: DEEP, margin: 0 });
  s.addText([
    { text: "The device, its address, its repertoire — \u201Cthe watch I want to stand\u201D", options: { bullet: true, breakLine: true, paraSpaceAfter: 6 } },
    { text: "Field context that licenses design: constrained water, an unreliable link, an RC failsafe that stays master", options: { bullet: true, breakLine: true, paraSpaceAfter: 6 } },
    { text: "The suspicion that a reading is wrong — distrust is the practitioner's reusable contribution", options: { bullet: true, breakLine: true, paraSpaceAfter: 6 } },
    { text: "Ground truth, and pointers to authoritative references", options: { bullet: true } },
  ], { x: 1.0, y: 2.7, w: 5.3, h: 2.7, fontFace: BODY, fontSize: 13, color: INK, margin: 0, valign: "top" });

  s.addShape("roundRect", { x: 6.85, y: 1.6, w: 5.9, h: 3.9, rectRadius: 0.08, fill: { color: DEEP } });
  iconCircle(s, "comments", 7.2, 1.9, 0.62, ACC);
  s.addText("The agent brings the how — and the discovery", { x: 8.0, y: 1.95, w: 4.6, h: 0.6, fontFace: BODY, fontSize: 15.5, bold: true, color: "FFFFFF", margin: 0 });
  s.addText([
    { text: "Implementation: geometry, physics, protocol framing, UI, threading", options: { bullet: true, breakLine: true, paraSpaceAfter: 6 } },
    { text: "Empirical discovery: the facts nobody could specify because nobody knew them until the artifact ran", options: { bullet: true, breakLine: true, paraSpaceAfter: 6 } },
    { text: "Refusing the first plausible answer — probing the device, the wire, the rendered pixels", options: { bullet: true, breakLine: true, paraSpaceAfter: 6 } },
    { text: "Restraint under a blanket grant: authorization is renegotiated per action", options: { bullet: true } },
  ], { x: 7.25, y: 2.7, w: 5.25, h: 2.7, fontFace: BODY, fontSize: 13, color: "D8E8F2", margin: 0, valign: "top" });

  s.addText("Every user turn in the series is classifiable:", { x: 0.6, y: 5.75, w: 4.4, h: 0.35, fontFace: BODY, fontSize: 12.5, italic: true, color: MUT, margin: 0 });
  const chips = ["Specification", "Feature", "Defect report", "Authorization", "Constraint", "Deferral", "Packaging", "Meta"];
  chips.forEach((c, i) => {
    const x = 0.6 + i * 1.52;
    s.addShape("roundRect", { x, y: 6.15, w: 1.4, h: 0.42, rectRadius: 0.21, fill: { color: TEAL } });
    s.addText(c, { x, y: 6.15, w: 1.4, h: 0.42, fontFace: BODY, fontSize: 11, color: "FFFFFF", align: "center", valign: "middle", margin: 0 });
  });
  note(s, "The methodological move in the papers: treat the conversation transcript as data. Each user turn is labeled by function — specification, defect report, authorization, and so on — which lets you ask which turns were latent in the original intent (avoidable with a better opening prompt) and which were irreducible discovery. That distinction is what the DES schema is built on.");
}

/* ---------------- S5 — DES schema ---------------- */
{
  const s = pres.addSlide();
  s.background = { color: "FFFFFF" };
  titleBar(s, "The DES model", "The Domain-Expert Specification schema: seven slots");
  const slots = [
    ["1", "Device & interface", "What it is, where it answers, over what transport"],
    ["2", "Operational repertoire", "The actions and readouts wanted — the expert's own hands-on list"],
    ["3", "Field context & deployment", "Where it goes and what that licenses (guards, reconnects, refusals)"],
    ["4", "Authorization & safety envelope", "What the agent may do to the device — and to the user's data"],
    ["5", "Deferred parameters", "Named unknowns left open on purpose, not guessed"],
    ["6", "Deliverable & distribution", "The packaged form: runnable file, repository, docs, license"],
    ["7", "Verification expectation", "Verify against reality — ground truth, an independent model, a reference implementation"],
  ];
  slots.forEach(([n, name, gloss], i) => {
    const col = i < 4 ? 0 : 1;
    const x = 0.6 + col * 6.3;
    const y = 1.6 + (i - col * 4) * 1.06;
    s.addShape("ellipse", { x, y: y + 0.08, w: 0.52, h: 0.52, fill: { color: i === 6 ? ACC : PRIM } });
    s.addText(n, { x, y: y + 0.08, w: 0.52, h: 0.52, fontFace: HDR, fontSize: 18, bold: true, color: "FFFFFF", align: "center", valign: "middle", margin: 0 });
    s.addText(name, { x: x + 0.72, y, w: 5.4, h: 0.35, fontFace: BODY, fontSize: 14.5, bold: true, color: DEEP, margin: 0 });
    s.addText(gloss, { x: x + 0.72, y: y + 0.35, w: 5.4, h: 0.6, fontFace: BODY, fontSize: 11.5, color: MUT, margin: 0 });
  });
  s.addShape("roundRect", { x: 6.9, y: 4.95, w: 5.85, h: 1.95, rectRadius: 0.08, fill: { color: "F5F0E6" } });
  s.addText("Revisions the later cases earned", { x: 7.15, y: 5.1, w: 5.4, h: 0.35, fontFace: BODY, fontSize: 13, bold: true, color: "7A5A18", margin: 0 });
  s.addText([
    { text: "Slot 4 covers the user's data as well as the device (Starlink case)", options: { bullet: true, breakLine: true, paraSpaceAfter: 4 } },
    { text: "Proposed slot 8 — delegated scope: the agent may propose extensions, implemented under the same safety envelope (Q-Hub case)", options: { bullet: true, breakLine: true, paraSpaceAfter: 4 } },
    { text: "Slot 7 names two obligations: verifying the build and verifying the thing in use (Q-Hub, post-delivery defects)", options: { bullet: true } },
  ], { x: 7.15, y: 5.5, w: 5.4, h: 1.3, fontFace: BODY, fontSize: 11, color: INK, margin: 0, valign: "top" });
  s.addText("Hypothesis: filling these seven slots up front removes the correction turns — and only those, because discovery was never a specification gap.", { x: 0.6, y: 6.05, w: 5.9, h: 0.85, fontFace: BODY, fontSize: 12.5, italic: true, color: PRIM, margin: 0 });
  note(s, "The schema's central refusal: it never asks the domain expert for implementation detail — no field numbers, no projection math, no threading model. Those are exactly the parts that must be discovered or engineered, and they fall on the agent's side of the line. The schema is a hypothesis about turn economics, not code quality.");
}

/* ---------------- S6 — the case-study series ---------------- */
{
  const s = pres.addSlide();
  s.background = { color: "FFFFFF" };
  titleBar(s, "Provenance", "Four case studies: propose, grade, apply, extend");
  const rows = [
    ["plug", "Modbus relay board", "Reverse-engineered a hidden Modbus dialect; scripted a relay by conversation.", "Schema PROPOSED from the transcript — a seven-slot hypothesis, one supporting story."],
    ["satellite", "Starlink dish monitor", "Undocumented gRPC; shifted field numbers; three telemetry readings that lie.", "Graded RETROSPECTIVELY: 6 of 7 slots transfer; the seam (data handling) is named."],
    ["wave", "Q-Hub relay switch", "No protocol at all; recovered by decompiling the vendor's own utility.", "Applied PROSPECTIVELY: the opening turn was written in schema form \u2192 3 turns to a shipped tool. Real use added two defect turns: build-time vs in-use verification."],
    ["anchor", "DeltaT sonar console", "Proprietary multibeam head; formats recovered from real survey files; a public driver as reference.", "EXTENDED: \u201Creality\u201D includes authoritative references the expert knows to exist — and naming them is domain expertise."],
  ];
  rows.forEach(([ic, proj, device, finding], i) => {
    const y = 1.55 + i * 1.32;
    s.addShape("roundRect", { x: 0.6, y, w: 12.1, h: 1.18, rectRadius: 0.07, fill: { color: i % 2 ? "FFFFFF" : ICE }, line: { color: "D5E2EC", width: 0.75 } });
    iconCircle(s, ic, 0.85, y + 0.28, 0.62, PRIM);
    s.addText(proj, { x: 1.7, y: y + 0.12, w: 2.6, h: 0.9, fontFace: BODY, fontSize: 14, bold: true, color: DEEP, valign: "middle", margin: 0 });
    s.addText(device, { x: 4.35, y: y + 0.12, w: 3.7, h: 0.95, fontFace: BODY, fontSize: 11, color: MUT, valign: "middle", margin: 0 });
    s.addText(finding, { x: 8.2, y: y + 0.12, w: 4.3, h: 0.95, fontFace: BODY, fontSize: 11, color: INK, valign: "middle", margin: 0 });
  });
  s.addText("Common thread: every device held at least one reading that was present, plausible, and wrong — caught only by distrust and an independent truth.", { x: 0.6, y: 6.85, w: 12.1, h: 0.4, fontFace: BODY, fontSize: 12.5, italic: true, color: PRIM, margin: 0 });
  note(s, "Emphasize the epistemic progression: paper 1 proposes; paper 2 tests after the fact on a very different device; paper 3 runs the experiment forward — the author uses his own schema on a new device and the correction turns disappear; the sonar case adds that authoritative external artifacts count as ground truth. Each study is n=1, observed not controlled — four points pointing the same way, not a validation.");
}

/* ---------------- S7 — DES applied to the ASV console ---------------- */
{
  const s = pres.addSlide();
  s.background = { color: "FFFFFF" };
  titleBar(s, "The schema, read against this project", "The ASV console instantiates all seven slots");
  const rows = [
    ["1  Device & interface", "A generic Vehicle Control Unit over serial-over-IP — deliberately unspecified in the sanitized derivative; the sim carries the whole console until a protocol is captured."],
    ["2  Operational repertoire", "Survey / search / transit planning on live ENC; Go-To, RTH, Hold; E-STOP; AIS traffic; tides and water level; battery and diesel energy models."],
    ["3  Field context", "A ~2 m battery ASV in constrained water; the RC transmitter stays master; vessel profiles change draft, and with it the navigable-depth model."],
    ["4  Safety envelope", "SAFE/arm gating; refusals on the real path (reset, spawn, vessel switch under way); a standing sanitization rule — the sibling console's identity never enters code."],
    ["5  Deferred parameters", "Vessel profiles as data files; the MarineTraffic AIS source held pending account details — \u201Cwhich service, one redacted sample response\u201D before a line is written."],
    ["6  Deliverable", "Single-file server + one page; four generated Word manuals (quick start, operations, technical, development) rebuilt in the same commit as the change they document."],
    ["7  Verification", suiteCount + " suites run by the pre-commit hook; suites verified by mutation; live checks against a real browser, real Word, a real server's stderr."],
  ];
  const tbl = rows.map(([a, b]) => ([
    { text: a, options: { bold: true, color: DEEP, fontFace: BODY, fontSize: 12 } },
    { text: b, options: { color: INK, fontFace: BODY, fontSize: 11.5 } },
  ]));
  s.addTable(tbl, {
    x: 0.6, y: 1.6, w: 12.1, colW: [2.6, 9.5],
    border: { type: "solid", color: "D5E2EC", pt: 0.75 },
    fill: { color: "FFFFFF" }, margin: 0.07, valign: "middle", rowH: 0.72,
  });
  note(s, "This project was never written up as a paper turn-by-turn; the reading here is the Q-Hub direction — the schema used going in, as working practice. Slot 4 is the interesting one at this scale: the safety envelope covers not just the device but the codebase itself (the sanitization rule is a standing constraint with its own grep), and authorization is renegotiated per action, e.g. docs rebuilt in the same commit as a change.");
}

/* ---------------- S8 — discovery ---------------- */
{
  const s = pres.addSlide();
  s.background = { color: "FFFFFF" };
  titleBar(s, "Discovery", "What no specification could have supplied");
  const cards = [
    ["satellite", "A quiet sea, or a dead feed?", "\u201CNo vessels to 81 nm seems strange.\u201D Measured against the live subscription: 94 vessels tracked, nearest 44 nm — aisstream simply has no volunteer receiver near Lewes. The config was correct; and the investigation exposed a real bug: upstream error frames were swallowed, so a dead key rendered as a quiet sea, forever.", "A healthy display and a healthy system are different claims."],
    ["file", "The manuals that never opened", "Four generated Word documents were malformed from the day they were built — for 18 commits. Rebuilds were byte-identical, and that stability was repeatedly reported as safety. Real Word refused all four.", "A hash proves stability, never correctness — compare against a reader entitled to refuse the file."],
    ["server", "The green suite over a crashing server", "/api/ais/radius answered 200, then raised and killed its thread — after the response left. Client-side assertions stayed green because the harness sent the server's stderr to DEVNULL.", "If a test drives a real process, read that process's output."],
    ["route", "Checksum-valid garbage", "A checksum can pass on an already-mangled buffer: one bad speed field unwound the GPS read loop and dropped the link (6 of 8 fixes). Fix: malformed fields degrade like empty ones; a guard at the thread boundary limits blast radius.", "A valid frame is not a true frame — the Starlink lesson, on our own wire."],
  ];
  cards.forEach(([ic, head, body, lesson], i) => {
    const x = 0.6 + (i % 2) * 6.25, y = 1.55 + Math.floor(i / 2) * 2.75;
    s.addShape("roundRect", { x, y, w: 5.85, h: 2.55, rectRadius: 0.08, fill: { color: ICE } });
    iconCircle(s, ic, x + 0.22, y + 0.2, 0.5, PRIM);
    s.addText(head, { x: x + 0.88, y: y + 0.22, w: 4.8, h: 0.45, fontFace: BODY, fontSize: 14, bold: true, color: DEEP, margin: 0 });
    s.addText(body, { x: x + 0.25, y: y + 0.78, w: 5.4, h: 1.3, fontFace: BODY, fontSize: 10.5, color: INK, margin: 0, valign: "top" });
    s.addText(lesson, { x: x + 0.25, y: y + 2.08, w: 5.4, h: 0.42, fontFace: BODY, fontSize: 10.5, italic: true, color: PRIM, margin: 0 });
  });
  note(s, "These four are the ASV project's versions of the lying-telemetry discoveries in the earlier papers. Each began as an operator report or an audit request in plain language, and each resolved into a runtime fact nobody held in advance. The division of labor holds at scale: the expert supplies the suspicion ('seems strange'), the agent supplies the measurement and the mechanism.");
}

/* ---------------- S9 — verification with teeth ---------------- */
{
  const s = pres.addSlide();
  s.background = { color: "FFFFFF" };
  titleBar(s, "Slot 7, industrialized", "Verification with teeth");
  s.addShape("roundRect", { x: 0.6, y: 1.6, w: 5.4, h: 4.0, rectRadius: 0.08, fill: { color: DEEP } });
  s.addText("\u201CVerify against something entitled to refuse you.\u201D", { x: 0.95, y: 2.0, w: 4.7, h: 1.4, fontFace: HDR, fontSize: 24, bold: true, color: "FFFFFF", margin: 0 });
  s.addText("Not the previous output. Not a byte-identical hash. A reader, a real Word, a real browser's pixels, the server's own stderr.", { x: 0.95, y: 3.5, w: 4.7, h: 1.6, fontFace: BODY, fontSize: 14, color: "C9D9E8", margin: 0 });
  const practices = [
    ["flask", "Mutation before trust", "A new suite is believed only after seeded faults fail it — including re-shipping the exact original bug."],
    ["scale", "Refusal paired with acceptance", "Every test that proves the console refuses something also proves it accepts the legal case."],
    ["branch", "Derive, don't enumerate", "The hook derives its run list from tests/; suites parse endpoint lists out of the source — hand-kept lists beside a directory always drift."],
    ["eye", "Pixels for UI claims", "A clean diff is not evidence a port works: the survey grip was byte-identical to the sibling's and invisible under the boat marker."],
  ];
  practices.forEach(([ic, head, body], i) => {
    const y = 1.6 + i * 1.02;
    iconCircle(s, ic, 6.45, y + 0.06, 0.5, TEAL);
    s.addText(head, { x: 7.1, y, w: 5.6, h: 0.32, fontFace: BODY, fontSize: 13.5, bold: true, color: DEEP, margin: 0 });
    s.addText(body, { x: 7.1, y: y + 0.32, w: 5.6, h: 0.62, fontFace: BODY, fontSize: 11, color: MUT, margin: 0 });
  });
  s.addText("Outcome of the route-coverage campaign: every route whose failure mode matters has a behavioral suite — and writing those suites found five live defects on the way.", { x: 0.6, y: 5.95, w: 12.1, h: 0.75, fontFace: BODY, fontSize: 13, italic: true, color: PRIM, margin: 0 });
  note(s, "This is where the graduate audience should push: the schema's verification slot, at this scale, becomes an engineering discipline of its own. Mutation testing is applied to the tests, not the code — a test is an instrument, and instruments get calibrated. The campaign numbers: the audit found 20 of 33 HTTP routes untested; eight suites later the thread closed with five live defects found, all of the same family (an unguarded branch before the dispatch safety net).");
}

/* ---------------- S10 — effort ---------------- */
{
  const s = pres.addSlide();
  s.background = { color: "FFFFFF" };
  titleBar(s, "Effort economics", "Order-of-magnitude compression, honestly bounded");
  s.addChart(pres.ChartType.bar, [
    { name: "Unaided professional (PERT estimate)", labels: ["Starlink monitor", "Q-Hub relay", "ASV console"], values: [40.3, 32.0, 199.8] },
    { name: "AI-coupled, actual (bounded)", labels: ["Starlink monitor", "Q-Hub relay", "ASV console"], values: [4, 2, 30] },
  ], {
    x: 0.6, y: 1.7, w: 7.2, h: 4.6,
    barDir: "col", barGrouping: "clustered",
    chartColors: [PRIM, ACC],
    showTitle: true, title: "Person-hours to a tested, published tool", titleFontSize: 13, titleColor: INK, titleFontFace: BODY,
    showValue: true, dataLabelPosition: "outEnd", dataLabelColor: INK, dataLabelFontSize: 11, dataLabelFontFace: BODY, dataLabelFormatCode: "0.0",
    showLegend: true, legendPos: "b", legendFontSize: 11, legendColor: MUT, legendFontFace: BODY,
    catAxisLabelColor: INK, catAxisLabelFontSize: 12, catAxisLabelFontFace: BODY,
    valAxisLabelColor: MUT, valAxisLabelFontSize: 10, valAxisLabelFontFace: BODY,
    valAxisTitle: "person-hours", showValAxisTitle: true, valAxisTitleColor: MUT, valAxisTitleFontSize: 10,
    valGridLine: { color: "E2EAF1", size: 0.75 }, catGridLine: { style: "none" },
  });
  s.addText([
    { text: "Method", options: { bold: true, fontSize: 14, color: DEEP, breakLine: true, paraSpaceAfter: 4 } },
    { text: "Unaided baselines are three-point (PERT) estimates by component, for a competent professional — a generous comparison, since the director of the work is a non-programmer. AI-coupled figures are bounded from timestamps and rounded up.", options: { breakLine: true, paraSpaceAfter: 10 } },
    { text: "The sharper comparison", options: { bold: true, fontSize: 14, color: DEEP, breakLine: true, paraSpaceAfter: 4 } },
    { text: "For a non-programmer the unaided build does not start at 30\u201340 hours — it starts with acquiring gRPC, decompilation, orbital mechanics, threading. The honest outcome is \u201Ca working tool versus none.\u201D", options: { breakLine: true, paraSpaceAfter: 10 } },
    { text: "This project", options: { bold: true, fontSize: 14, color: DEEP, breakLine: true, paraSpaceAfter: 4 } },
    { text: "Estimated by the same method (component table, next slide): ≈200 person-hours unaided vs ≈30 measured from the commit record — a smaller multiple (≈7×) than the small tools, exactly as the series' own scaling caveat predicts.", options: {} },
  ], { x: 8.2, y: 1.7, w: 4.5, h: 5.1, fontFace: BODY, fontSize: 12, color: INK, margin: 0, valign: "top" });
  note(s, "Threats to these numbers are on the next slide — flag them here so the chart isn't read as a measurement. The estimates are modeled, the actuals are uninstrumented bounds, and the same estimator produced all of them. The claim defended is only the order of magnitude, and the qualitative regime change for a non-programmer.");
}

/* ---------------- S10b — ASV PERT estimate ---------------- */
{
  const s = pres.addSlide();
  s.background = { color: "FFFFFF" };
  titleBar(s, "Effort economics", "The same method, applied to this project");
  const comps = [
    ["ENC chart integration & nogo model (tiles, feature extraction, depth gating, offline prep)", 8, 16, 32],
    ["Route planning (A* raster, hazard extents, Rule 9 channel lane, turn geometry, survey/search patterns)", 10, 20, 40],
    ["Vessel simulator (hull physics, autopilot, battery & diesel energy, live-weather environment)", 8, 16, 30],
    ["Command & safety model (VCU seam, arm/SAFE/E-STOP gating, run lifecycle, honest refusals)", 6, 12, 24],
    ["Shore-station UI (chart + controls windows, draggable/resizable cards, survey editor, readouts)", 20, 40, 70],
    ["AIS subsystem (websocket service, registry, range filtering, error surfacing, patched table)", 6, 12, 24],
    ["Ancillary services (tides & water-level trust, GPS sim, ROC / moving HOME, recorder + playback)", 6, 12, 22],
    ["Test infrastructure (" + suiteCount + " suites, mutation verification, real-console harnesses, hook)", 15, 30, 60],
    ["Documentation pipeline (docx generator, four manuals, three READMEs)", 8, 15, 28],
    ["Hardening & defect discovery (route audits, dropped-connection family, live cross-checks)", 6, 14, 28],
  ];
  let sumTe = 0, sumVar = 0;
  const th = (t) => ({ text: t, options: { bold: true, color: "FFFFFF", fill: { color: PRIM }, fontFace: BODY, fontSize: 10.5, align: "center" } });
  const rows = [[
    { text: "Work component", options: { bold: true, color: "FFFFFF", fill: { color: PRIM }, fontFace: BODY, fontSize: 10.5 } },
    th("a"), th("m"), th("b"), th("tₑ"), th("σ"),
  ]];
  comps.forEach(([name, a, m, b], i) => {
    const te = (a + 4 * m + b) / 6, sd = (b - a) / 6;
    sumTe += te; sumVar += sd * sd;
    const num = (v) => ({ text: v.toFixed(1), options: { color: INK, fontFace: BODY, fontSize: 10, align: "center", fill: { color: i % 2 ? "FFFFFF" : ICE } } });
    rows.push([
      { text: name, options: { color: INK, fontFace: BODY, fontSize: 10, fill: { color: i % 2 ? "FFFFFF" : ICE } } },
      num(a), num(m), num(b), num(te), num(sd),
    ]);
  });
  const totSd = Math.sqrt(sumVar);
  rows.push([
    { text: "Total", options: { bold: true, color: DEEP, fontFace: BODY, fontSize: 10.5, fill: { color: "F5F0E6" } } },
    { text: "", options: { fill: { color: "F5F0E6" } } }, { text: "", options: { fill: { color: "F5F0E6" } } }, { text: "", options: { fill: { color: "F5F0E6" } } },
    { text: sumTe.toFixed(1), options: { bold: true, color: DEEP, fontFace: BODY, fontSize: 10.5, align: "center", fill: { color: "F5F0E6" } } },
    { text: totSd.toFixed(1), options: { bold: true, color: DEEP, fontFace: BODY, fontSize: 10.5, align: "center", fill: { color: "F5F0E6" } } },
  ]);
  s.addTable(rows, {
    x: 0.6, y: 1.5, w: 9.0, colW: [6.5, 0.5, 0.5, 0.5, 0.5, 0.5],
    border: { type: "solid", color: "D5E2EC", pt: 0.5 }, margin: 0.04, valign: "middle",
  });
  s.addText([
    { text: "Three-point (PERT) estimate, per the series' method", options: { bold: true, fontSize: 13, color: DEEP, breakLine: true, paraSpaceAfter: 4 } },
    { text: "tₑ = (a + 4m + b)/6, σ = (b − a)/6; components independent, total σ by root-sum-square. ≈200 h, 90% interval ≈175–225 h — about five working weeks for a competent professional.", options: { breakLine: true, paraSpaceAfter: 10 } },
    { text: "The AI-coupled side, measured", options: { bold: true, fontSize: 13, color: DEEP, breakLine: true, paraSpaceAfter: 4 } },
    { text: "109 commits, 2026-07-22 → 08-05, clustered into 27 work bursts (≤60 min gaps): ≈22.5 h in-burst, ≈29 h with per-burst overhead. Reported as ≈30 h, rounded up.", options: { breakLine: true, paraSpaceAfter: 10 } },
    { text: "A bias the series had not yet had", options: { bold: true, fontSize: 13, color: "7A5A18", breakLine: true, paraSpaceAfter: 4 } },
    { text: "This estimate was produced by the development agent grading its own work — read it with the same suspicion the papers apply to their single shared estimator.", options: { italic: true } },
  ], { x: 9.85, y: 1.55, w: 2.9, h: 5.6, fontFace: BODY, fontSize: 10.5, color: INK, margin: 0, valign: "top" });
  note(s, "Walk the table top-down: UI and test infrastructure dominate — different from the small tools, where protocol discovery was the largest line. That shift is the scaling story: as the artifact grows, the effort moves from discovery to construction and verification, and the compression ratio falls from ~10-16x to ~7x. The papers predicted exactly this ('ratios from single-purpose instrumentation should not be stretched to large systems').");
}

/* ---------------- S11 — defect shapes ---------------- */
{
  const s = pres.addSlide();
  s.background = { color: "FFFFFF" };
  titleBar(s, "Theory from practice", "Recurring defect shapes the conversation method surfaced");
  const cards = [
    ["bug", "One value, two masters", "A field serving display and logic, or persistent and transient state — nearly every bug in the polish pass reduced to this."],
    ["branch", "Remember vs derive", "A snapshot drifts from the thing it describes; a value re-derived from the source of truth cannot. Deriving forced out two bugs a snapshot would have hidden."],
    ["shield", "The masked branch", "Every harness passed --no-log, so the logging branch went untested no matter how many suites ran past it. A masked branch is an untested branch."],
    ["check", "A check that can't tell bug from fix", "A filter test with nothing to filter; a hash compared to itself; asserting a field's name instead of its value. Hit three times in one session."],
    ["eye", "Accurate card, wrong about the boat", "A readout can be correct about its own field and still not answer the question the operator reads it for."],
    ["clock", "Build-time vs in-use verification", "The Q-Hub lesson, confirmed here: passing the builder's tests does not discharge the operator's — real use finds the gap the test plan's author could not."],
  ];
  cards.forEach(([ic, head, body], i) => {
    const x = 0.6 + (i % 3) * 4.2, y = 1.6 + Math.floor(i / 3) * 2.6;
    s.addShape("roundRect", { x, y, w: 3.95, h: 2.4, rectRadius: 0.08, fill: { color: i % 2 ? ICE : "FFFFFF" }, line: { color: "D5E2EC", width: 0.75 } });
    iconCircle(s, ic, x + 0.2, y + 0.2, 0.48, PRIM);
    s.addText(head, { x: x + 0.82, y: y + 0.22, w: 3.0, h: 0.65, fontFace: BODY, fontSize: 13, bold: true, color: DEEP, margin: 0 });
    s.addText(body, { x: x + 0.22, y: y + 0.95, w: 3.5, h: 1.35, fontFace: BODY, fontSize: 10.5, color: INK, margin: 0, valign: "top" });
  });
  note(s, "For the software-engineering audience: these are the generalizable outputs. Each shape was hit repeatedly, named, written into the project's generated development guide, and then used as a checklist ('check for that shape first'). The conversation method makes this feedback loop unusually tight — the same agent that fixed the bug writes the taxonomy and carries it into the next session's context.");
}

/* ---------------- S12 — validity & future work ---------------- */
{
  const s = pres.addSlide();
  s.background = { color: "FFFFFF" };
  titleBar(s, "Limits", "Threats to validity, and the study this calls for");
  s.addShape("roundRect", { x: 0.6, y: 1.6, w: 6.0, h: 4.9, rectRadius: 0.08, fill: { color: ICE } });
  iconCircle(s, "scale", 0.95, 1.85, 0.55, TEAL);
  s.addText("Threats to validity", { x: 1.7, y: 1.95, w: 4.5, h: 0.4, fontFace: BODY, fontSize: 16, bold: true, color: DEEP, margin: 0 });
  s.addText([
    { text: "Observed cases, not controlled trials — n = 1 four times over, pointing the same way but never aggregated", options: { bullet: true, breakLine: true, paraSpaceAfter: 7 } },
    { text: "One author is specifier, estimator, and grader of his own schema — correlated bias by construction", options: { bullet: true, breakLine: true, paraSpaceAfter: 7 } },
    { text: "Effort baselines are modeled (PERT), not measured; actuals are uninstrumented bounds", options: { bullet: true, breakLine: true, paraSpaceAfter: 7 } },
    { text: "Ratios from single-purpose field instrumentation — they should not be stretched to large systems, where architecture and maintenance dominate", options: { bullet: true, breakLine: true, paraSpaceAfter: 7 } },
    { text: "The schema leans on a capable agent: without empirical discovery and self-distrust, slots 4 and 7 give back little", options: { bullet: true } },
  ], { x: 1.0, y: 2.5, w: 5.3, h: 3.85, fontFace: BODY, fontSize: 12, color: INK, margin: 0, valign: "top" });

  s.addShape("roundRect", { x: 6.85, y: 1.6, w: 5.9, h: 4.9, rectRadius: 0.08, fill: { color: "FFFFFF" }, line: { color: "D5E2EC", width: 1 } });
  iconCircle(s, "grad", 7.2, 1.85, 0.55, ACC);
  s.addText("The controlled study to run", { x: 7.95, y: 1.95, w: 4.6, h: 0.4, fontFace: BODY, fontSize: 16, bold: true, color: DEEP, margin: 0 });
  s.addText([
    { text: "Paired tasks: domain experts with and without the structured opening prompt, across several devices", options: { bullet: true, breakLine: true, paraSpaceAfter: 7 } },
    { text: "A condition the Q-Hub case approximates at n = 1: experts writing their own opening in schema form vs discovering requirements turn by turn", options: { bullet: true, breakLine: true, paraSpaceAfter: 7 } },
    { text: "Measures: turns to acceptance, defect counts, instrumented time, share of corrections traceable to specification gaps vs discovery", options: { bullet: true, breakLine: true, paraSpaceAfter: 7 } },
    { text: "And separately: defect rate and time-to-diagnosis under real post-delivery use — where the Q-Hub artifact was actually caught out", options: { bullet: true } },
  ], { x: 7.25, y: 2.5, w: 5.2, h: 3.85, fontFace: BODY, fontSize: 12, color: INK, margin: 0, valign: "top" });
  note(s, "Be explicit that the author of the papers makes these caveats himself, prominently. The honest framing: four data points pointing the same direction are a reason to run the controlled study, not a substitute for it.");
}

/* ---------------- S13 — conclusions (dark) ---------------- */
{
  const s = pres.addSlide();
  s.background = { color: DEEP };
  s.addText("CONCLUSIONS", { x: 0.9, y: 0.5, w: 11.5, h: 0.35, fontFace: BODY, fontSize: 12, color: "7E97AB", charSpacing: 2, bold: true, margin: 0 });
  s.addText("What four instruments and one console argue", { x: 0.9, y: 0.85, w: 11.5, h: 0.7, fontFace: HDR, fontSize: 30, bold: true, color: "FFFFFF", margin: 0 });
  const items = [
    ["comments", "The division of labor holds, at 10\u00D7 the scale", "The expert brings the what, the why, and the distrust; the agent brings the how and the discovery. It held for a relay board, and it held for a C2 console of " + fmtN(srcLines) + " lines."],
    ["clipboard", "The DES schema removes correction turns — only those", "Discovery is not a specification gap. The seven slots front-load everything the expert already knows; what remains is what nobody could have known until the artifact ran."],
    ["flask", "Verification is the slot that earns its keep", "Every device in the series carried a reading that was present, plausible, and wrong. At console scale, slot 7 industrializes into mutation-verified suites and 'something entitled to refuse you.'"],
    ["ship", "For the practitioner, the ratio is not the point", "An order of magnitude for a professional; for a non-programmer, the difference between a working operational tool and none at all."],
  ];
  items.forEach(([ic, head, body], i) => {
    const y = 1.95 + i * 1.22;
    iconCircle(s, ic, 0.9, y, 0.6, i === 3 ? ACC : PRIM);
    s.addText(head, { x: 1.75, y: y - 0.03, w: 10.7, h: 0.38, fontFace: BODY, fontSize: 16, bold: true, color: "FFFFFF", margin: 0 });
    s.addText(body, { x: 1.75, y: y + 0.36, w: 10.7, h: 0.7, fontFace: BODY, fontSize: 12.5, color: "C9D9E8", margin: 0 });
  });
  s.addText("Artifacts: D:\\Claude\\ASV  ·  case studies: starlink-monitor, qhub-relay-control (GitHub: AndyMcLeod)  ·  papers: McLeod 2024\u20132026, preprints", { x: 0.9, y: 6.95, w: 11.5, h: 0.35, fontFace: BODY, fontSize: 10.5, color: "7E97AB", margin: 0 });
  note(s, "Close by returning the question to the audience: the schema is deliberately falsifiable — it predicts which turns disappear under a structured opening and which cannot. That is a measurable claim, and the paired study on the previous slide is the way to test it beyond n = 4.");
}

pres.writeFile({ fileName: OUT }).then(() => console.log("written:", OUT));
