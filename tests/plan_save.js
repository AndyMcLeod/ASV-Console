// tests/plan_save.js - the page saves the plan against the revision it holds, one save at a time,
// and SAYS SO when a save is not kept (review #10, 2026-09-14).
//
// saveMission() posted the plan 400 ms after an edit and never read the answer. Two pages that had
// loaded the same plan - two tabs, or a window left open overnight - each autosaved over the other's
// edits without a word, and a refused or failed save was invisible. The console now refuses an edit
// made to an older revision (tests/mission_store.py 12-13); this is the page half. DRIVEN: the page's
// own saveMission, flushMission and loadMission, with fetch stubbed so an answer can be held open
// while the next save comes due.
//
//   node tests/plan_save.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// TEETH - 8 mutations against a sidecar (ASV_HTML), 8 killed, each by the check written for it:
//   the revision not sent -> 1, 2          the answer's revision not adopted -> 1, 2, 4
//   saves not one at a time -> 2           a conflict handled like any failure -> 3
//   a conflict does not stop saving -> 3   other failures silent -> 4
//   loadMission does not take the revision -> 5    the debounce removed -> 6
// The first run scored two of those SURVIVED: the mutated save waited for an answer the fixture
// never gave, and Node exited 0 with nothing printed. Every wait is bounded now, and a suite that
// stops before its summary line reports FAIL 0.
//
// NOTE: no "use strict" - the console's classic browser <script> runs sloppy.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
function __crash(e) {
  console.log("  FAIL 0. the suite itself CRASHED before finishing - " +
              ((e && e.stack) ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
  console.log("\n1 CHECK(S) FAILED (crashed before finishing)");
  process.exit(1);
}
process.on("uncaughtException", __crash);
process.on("unhandledRejection", __crash);
// ⚠ AND A HANG MUST REPORT TOO. A save left waiting on an answer the fixture never gives empties the
// event loop, and Node then exits with code 0 and prints nothing - which a mutation runner reading
// stdout scores as SURVIVED. Two mutations did exactly that on the first run of this suite.
let __finished = false;
process.on("beforeExit", () => {
  if (__finished) return;
  console.log("  FAIL 0. the suite stopped before finishing - something waited on an answer it was never given");
  console.log("\n1 CHECK(S) FAILED (stopped before finishing)");
  process.exitCode = 1;
});

const fs = require("fs");
const path = require("path");

// ASV_HTML points this at a SIDECAR copy for a mutation run - every read of the page goes through it.
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
  let start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (H.slice(start - 6, start) === "async ") start -= 6;
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
const DECL = (H.match(/^let missionRev = [^;]*;/m) || [])[0];
if (!DECL) throw new Error("test setup: the missionRev declaration was not found (renamed?)");

console.log("Saving the plan - against a revision, one at a time, and said when it is not kept:");

(async () => {
  // ---- the page's world, as the save path reads it --------------------------------------- //
  let mission = { waypoints: [{ lat: 44.9, lon: -67.0 }], lines: [] };
  let boundary = [], boundaryClosed = false, saveTimer = null;
  const banners = [];
  const showBanner = (t) => banners.push(t);
  const calls = [];
  let fetchFails = false;
  // Every POST is HELD until the check answers it, so a save can be kept in flight on purpose.
  const fetch = (url, opts) => new Promise((resolve, reject) => {
    if (fetchFails) { reject(new Error("net::ERR_CONNECTION_REFUSED")); return; }
    calls.push({ url, body: opts && opts.body ? JSON.parse(opts.body) : null, resolve });
  });
  const answer = (i, status, json) => calls[i].resolve({
    ok: status >= 200 && status < 300, status, json: () => Promise.resolve(json) });
  const settle = () => new Promise((r) => setTimeout(r, 0));
  // A save promise, or 100 ms - whichever is first: a mutated save that never finishes must fail the
  // check that is waiting on it, not stall the suite.
  const within = (p) => Promise.race([p, new Promise((r) => setTimeout(r, 100))]);
  // loadMission's own world, stubbed only so it runs to its end rather than into its catch-all.
  const $ = () => ({ value: 0 }), SPEED_ROLES = [], V = {}, nogo = {};
  const updateSpeedNote = () => {}, bufferFloor = (b) => b, updateLeadNote = () => {};
  const updateEaseNote = () => {}, updatePatReadout = () => {}, render = () => {};
  // eslint-disable-next-line no-eval
  const page = eval("(function(){ " + DECL + "\n" + grab("saveMission") + "\n" + grab("flushMission") + "\n"
    + grab("loadMission") + "\n"
    + "return { saveMission, flushMission, loadMission, get: () => ({ missionRev, missionSaving, "
    + "missionSaveAgain, missionConflict }), setRev: (v) => { missionRev = v; } }; })()");

  // 1. The revision goes out with the save, and the answer's revision is the next one.
  page.setRev(7);
  const f1 = page.flushMission();
  await settle();
  const sent7 = calls.length === 1 ? calls[0].body.rev : "(no save)";
  answer(0, 200, { ok: true, rev: 8 });
  await within(f1);
  const f2 = page.flushMission();
  await settle();
  const sent8 = calls.length === 2 ? calls[1].body.rev : "(no save)";
  answer(1, 200, { ok: true, rev: 9 });
  await within(f2);
  check("1. a save carries the revision this page holds, and the revision the console answers is the next one sent",
        () => sent7 === 7 && sent8 === 8 && page.get().missionRev === 9 && banners.length === 0,
        () => "sent " + sent7 + " then " + sent8 + "; holds " + page.get().missionRev);

  // 2. One save at a time: the next one waits for the answer, then goes with ITS revision.
  const n0 = calls.length;
  const fa = page.flushMission();
  await settle();
  const fb = page.flushMission();                 // due while the first is still in flight
  await settle();
  const whileBusy = calls.length - n0;
  answer(n0, 200, { ok: true, rev: 10 });
  await within(fa);
  await settle();
  const queued = calls.length - n0 === 2 ? calls[n0 + 1].body.rev : "(not sent)";
  answer(n0 + 1, 200, { ok: true, rev: 11 });
  await within(fb);
  await settle();
  check("2. one save at a time: a save due while one is in flight waits for its answer, then goes with the new revision",
        () => whileBusy === 1 && queued === 10 && page.get().missionRev === 11,
        () => "in flight together: " + whileBusy + "; the waiting save went with rev " + queued);

  // 3. An edit made to an older revision: said plainly, and the page stops saving.
  const n1 = calls.length;
  const fc = page.flushMission();
  await settle();
  answer(n1, 409, { error: "the plan was changed from somewhere else after this page loaded it", rev: 14 });
  await within(fc);
  const stopped = page.flushMission();
  await settle();
  await within(stopped);
  const after409 = calls.length - n1;
  check("3. a save REFUSED as stale is said plainly - edits here are not being kept, reload - and the page stops saving",
        () => page.get().missionConflict === true && after409 === 1
              && /PLAN NOT SAVED/.test(banners.join(" ")) && /NOT being kept/.test(banners.join(" "))
              && /reload/.test(banners.join(" ")),
        () => "saves after the refusal: " + (after409 - 1) + "; banner: " + (banners[banners.length - 1] || "none"));

  // 4. Any other failure is said too, and the next edit tries again. A fresh page: the one above
  // has stopped saving, which is what check 3 wants of it.
  const page2 = eval("(function(){ " + DECL + "\n" + grab("saveMission") + "\n" + grab("flushMission") + "\n"
    + "return { flushMission, get: () => ({ missionRev, missionConflict }), setRev: (v) => { missionRev = v; } }; })()");
  page2.setRev(20);
  banners.length = 0;
  const n2 = calls.length;
  const fd = page2.flushMission();
  await settle();
  answer(n2, 503, { error: "the plan could not be saved: disk full" });
  await within(fd);
  const said503 = banners.join(" ");
  fetchFails = true;
  await within(page2.flushMission());
  fetchFails = false;
  const saidNet = banners.join(" ");
  const fe = page2.flushMission();
  await settle();
  const retried = calls.length - n2;
  answer(calls.length - 1, 200, { ok: true, rev: 21 });
  await within(fe);
  check("4. a save that fails any other way - the console's error, or no answer at all - is said too, and the next edit tries again",
        () => /PLAN NOT SAVED — the plan could not be saved: disk full/.test(said503)
              && /the console did not answer/.test(saidNet)
              && page2.get().missionConflict === false && retried === 2 && page2.get().missionRev === 21,
        () => "banners: " + banners.map((b) => b.slice(0, 50)).join(" | ") + "; saves sent " + retried);

  // 5. The revision comes in with the plan - and a console that keeps none leaves the page sending none.
  const load = async (plan) => {
    const f = page.loadMission();
    await settle();
    calls[calls.length - 1].resolve({ ok: true, status: 200, json: () => Promise.resolve(plan) });
    await within(f);
    return page.get().missionRev;
  };
  const withRev = await load({ waypoints: [], lines: [], rev: 33 });
  const withoutRev = await load({ waypoints: [], lines: [] });
  check("5. loading the plan takes its revision - and a plan from a console that keeps none leaves the page sending none",
        () => withRev === 33 && withoutRev === null,
        () => "after rev 33: " + withRev + "; after a plan with no rev: " + withoutRev);

  // 6. The debounce is kept: a burst of edits is ONE save, 400 ms after the last.
  const n3 = calls.length;
  const page3 = eval("(function(){ " + DECL + "\n" + grab("saveMission") + "\n" + grab("flushMission") + "\n"
    + "return { saveMission }; })()");
  page3.saveMission(); page3.saveMission(); page3.saveMission();
  await new Promise((r) => setTimeout(r, 250));
  const early = calls.length - n3;
  await new Promise((r) => setTimeout(r, 300));
  const late = calls.length - n3;
  if (late) answer(calls.length - 1, 200, { ok: true, rev: 1 });
  check("6. a burst of edits is still ONE save, sent after the pause - the revision did not cost the debounce",
        () => early === 0 && late === 1, () => "at 250 ms " + early + " sent; at 550 ms " + late);

  __finished = true;
  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
