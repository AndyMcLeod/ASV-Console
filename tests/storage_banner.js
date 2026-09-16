// tests/storage_banner.js - the page says when a drive the console writes to runs low (review #24, 2026-09-15).
//
// The console measures logs/ and charts/ and the room left (tests/storage_watch.py) and removes nothing. When the drive
// that holds the plan, the session log or the chart cache runs low, the page raises ONE banner naming the room left,
// the drive, what writes there and what the two folders occupy - and takes it down, if it is still the one up, when
// there is room again. A pill on the top bar says it for as long as it lasts, because the banner slot is shared: in the
// live check the chart's own "Nogo established" banner took the slot four seconds after the warning went up.
// DRIVEN: the page's own storageCheck and fmtStorageMb, with the banner slot and the pill stubbed and showBanner the
// page's own.
//
//   node tests/storage_banner.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - 11 sidecar mutations RUN, 11/11 caught:
//   the banner claims the compression whatever the console does -> 6
//   posted on every frame -> 2c, 3, 3b, 4             never taken down -> 3, 3b, 4
//   takes down any banner -> 3                        not measured read as low -> 4
//   onFrame never asks -> 5                           one use read in the plural (the old code) -> 3b
//   no pill (the first draft) -> 2b, 2c               the pill written on every frame -> 2b
//   the pill never taken down -> 3, 4                 no pill in the top bar -> 5
// "posted on every frame" SURVIVED the first draft: showBanner records only words not already on screen, so a warning
// re-posted on every frame counted as one. Check 2c puts another banner in the slot and sees whether it is taken back.
//
// NOTE: the page's script is <script type="module">, which runs STRICT; the functions are evaluated strict here.

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
function decl(re) {
  const m = H.match(re);
  if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
  return m[0];
}

console.log("The page says when a drive the console writes to runs low:");

const banner = { textContent: "", style: { display: "none" } };
let pillWrites = 0, pillText = "";
const pill = { title: "", style: { display: "none" },
               get textContent() { return pillText; }, set textContent(v) { pillWrites++; pillText = v; } };
const posted = [];
// eslint-disable-next-line no-eval
const page = eval("(function(){ \"use strict\";\n"
  + "const $ = (s) => (s === '#encbanner' ? banner : s === '#diskPill' ? pill : null); let S = {};\n"
  + "const recordAction = (kind, text) => posted.push(text);\n"
  + decl(/^const STORAGE_WARN_PREFIX = [^;]*;/m) + "\n" + decl(/^let storageLowSaid = [^;]*;/m) + "\n"
  + ["fmtStorageMb", "storageCheck", "showBanner"].map(grab).join("\n")
  + "\nreturn { storageCheck, fmtStorageMb, set: (s) => { S = s; } }; })()");

const OK = { ok: true, low: false, free_mb: 432708, free_drive: "D:", free_uses: ["the plan", "the session log", "the chart cache"],
             logs_mb: 475, logs_old_mb: 329, old_days: 30, charts_mb: 4696, log_compress: true };
const LOW = Object.assign({}, OK, { low: true, free_mb: 1500 });

// 1. room enough
page.set({ storage: OK });
for (let i = 0; i < 5; i++) page.storageCheck();
check("1. with room enough, nothing is said and the pill stays down",
      () => posted.length === 0 && banner.style.display === "none" && pill.style.display === "none",
      () => posted.length + " banners; pill " + pill.style.display);

// 2. low, once
page.set({ storage: LOW });
const writesBefore = pillWrites;
for (let i = 0; i < 20; i++) page.storageCheck();        // twenty telemetry frames while it stays low
const pillAt2 = { display: pill.style.display, text: pill.textContent, title: pill.title, writes: pillWrites - writesBefore };
check("2. a drive gone low raises ONE banner in twenty frames - naming the room left, the drive, what writes there, what "
      + "logs/ and charts/ occupy, and what the console does about it: compress the old recordings, delete nothing",
      () => posted.length === 1 && banner.style.display === "block" && /^⚠ DISK SPACE LOW/.test(banner.textContent)
            && /1\.5 GB free on D:/.test(banner.textContent) && /the plan, the session log, the chart cache write\./.test(banner.textContent)
            && /logs\/ occupies 475 MB \(329 MB of it older than 30 days\) and charts\/ 4\.6 GB/.test(banner.textContent)
            && /Recordings over 30 days are compressed, but nothing is deleted\.$/.test(banner.textContent),
      () => posted.length + " posted: " + banner.textContent.slice(0, 200));
check("2b. ... and the pill on the top bar goes up with the room left on it and the whole warning on hover - written once in "
      + "those twenty frames, not on every one",
      () => pillAt2.display === "" && pillAt2.text === "⚠ DISK LOW · 1.5 GB free" && pillAt2.title === banner.textContent
            && pillAt2.writes === 1,
      () => "display '" + pillAt2.display + "', text '" + pillAt2.text + "', " + pillAt2.writes + " write(s), title "
            + (pillAt2.title === banner.textContent ? "= the banner" : "'" + pillAt2.title.slice(0, 60) + "'"));

// 2c. while it stays low, it does not take the slot back from a banner posted after it
const warning = banner.textContent;
banner.textContent = "⚠ THE VESSEL IS NOT TAKING THE SPEED COMMAND"; banner.style.display = "block";
for (let i = 0; i < 5; i++) page.storageCheck();
const slot2b = banner.textContent;
check("2c. while the drive stays low, a banner posted after the warning keeps the slot - the warning is said once, not "
      + "re-asserted over every other message on every frame - and the pill is still up",
      () => /NOT TAKING THE SPEED COMMAND/.test(slot2b) && posted.length === 1 && pill.style.display === "",
      () => "slot reads: " + slot2b.slice(0, 60) + "; pill '" + pill.style.display + "'");
banner.textContent = warning;                            // the warning back in the slot for check 3

// 3. recovered
page.set({ storage: OK });
page.storageCheck();
const hidden = banner.style.display, pillHidden = pill.style.display;
page.set({ storage: Object.assign({}, LOW, { free_uses: ["the chart cache"] }) });   // a drive only the chart cache is on
page.storageCheck();                                     // low again - said again
banner.textContent = "3 transit(s) auto-routed around obstacles (amber)."; banner.style.display = "block";   // another banner took the slot
page.set({ storage: OK });
page.storageCheck();
check("3. when there is room again its own banner and the pill come down; low again is said again; and a banner that has "
      + "since taken the slot is left up",
      () => hidden === "none" && pillHidden === "none" && posted.length === 2 && banner.style.display === "block"
            && /auto-routed/.test(banner.textContent) && pill.style.display === "none",
      () => "after recovery: banner " + hidden + ", pill " + pillHidden + "; posted " + posted.length + "; other banner "
            + banner.style.display);
check("3b. a drive only one use writes to reads in the singular - 'where the chart cache writes'",
      () => /, where the chart cache writes\. logs\//.test(posted[1] || ""), () => (posted[1] || "").slice(0, 90));

// 4. nothing to go on
page.set({ storage: { ok: false, note: "not measured yet" } });
banner.style.display = "none";
page.storageCheck();
page.set({});
page.storageCheck();
check("4. a console that has not measured yet - or reports no storage at all - is not taken for a low drive",
      () => posted.length === 2 && banner.style.display === "none" && pill.style.display === "none",
      () => posted.length + " posted; pill " + pill.style.display);

// 5. wired
const onFrame = grab("onFrame");
check("5. every telemetry frame asks - onFrame calls storageCheck - and the top bar has the pill it writes",
      () => /buildCheck\(\);\s*storageCheck\(\);/.test(onFrame) && /<div class="pill" id="diskPill"/.test(H),
      () => onFrame.slice(-80).replace(/\s+/g, " ") + " | pill in the markup: " + /id="diskPill"/.test(H));

// 6. a console told not to compress must not claim it does (--no-log-compress)
page.set({ storage: Object.assign({}, LOW, { log_compress: false }) });
page.storageCheck();
check("6. with the compression turned off the banner says THAT - the page says what the console does, never what it "
      + "was built to do",
      () => posted.length === 3 && /\. Nothing is removed automatically\.$/.test(posted[2] || "")
            && !/compressed/.test(posted[2] || ""),
      () => (posted[2] || "").slice(-70));

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
