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
// REVIEW #11 (7-11): a page that has not loaded the plan saves nothing and retries the load; RESET, CLR PLAN
// and dropping a held survey ask even in the simulator. TEETH - 9 more sidecar mutations, 9 killed:
//   saves go before the plan has loaded -> 7      a failed load taken as a plan -> 8, 8b
//   no retry after a failed load -> 8, 8b         the banner left up after the plan loads -> 8b
//   an empty plan taken as a failed load -> 5, 8c RESET answered by the simulator again -> 9
//   CLR PLAN with no question -> 10               CLR PLAN answered by the simulator -> 10
//   dropping a held survey answered by the simulator -> 11
//
// NOTE: this suite evaluates page code SLOPPY - a direct eval, so the page's function declarations bind into this
// file. The page itself is <script type="module">, which runs STRICT: an assignment to an undeclared name passes
// here and throws in the page. tests/page_strict.js parses the page and its modules as strict modules; that runtime
// difference is not checked anywhere.

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
const DECL = ["^let missionRev = [^;]*;", "^let missionLoaded = [^;]*;", "^const MISSION_LOAD_RETRY_MS = [^;]*;"]
  .map((re) => {
    const m = H.match(new RegExp(re, "m"));
    if (!m) throw new Error("test setup: declaration " + re + " not found (renamed?)");
    return m[0];
  }).join("\n");

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
    + "missionSaveAgain, missionConflict, missionLoaded }), setRev: (v) => { missionRev = v; }, "
    + "setLoaded: (v) => { missionLoaded = v; } }; })()");

  // 1. The revision goes out with the save, and the answer's revision is the next one. (Checks 1-6 are
  // made on a page that HAS loaded its plan - 7 and 8 are the one that has not.)
  page.setLoaded(true);
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
    + "return { flushMission, get: () => ({ missionRev, missionConflict }), setRev: (v) => { missionRev = v; }, "
    + "setLoaded: (v) => { missionLoaded = v; } }; })()");
  page2.setLoaded(true);
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
    + "return { saveMission, setLoaded: (v) => { missionLoaded = v; } }; })()");
  page3.setLoaded(true);
  page3.saveMission(); page3.saveMission(); page3.saveMission();
  await new Promise((r) => setTimeout(r, 250));
  const early = calls.length - n3;
  await new Promise((r) => setTimeout(r, 300));
  const late = calls.length - n3;
  if (late) answer(calls.length - 1, 200, { ok: true, rev: 1 });
  check("6. a burst of edits is still ONE save, sent after the pause - the revision did not cost the debounce",
        () => early === 0 && late === 1, () => "at 250 ms " + early + " sent; at 550 ms " + late);

  // ── 7-8c. NEVER A PLAN THIS PAGE DID NOT LOAD (review #11) ───────────────────────────────────
  // A page whose load failed - the console still starting, the plan file locked for a moment - carried on
  // with an EMPTY plan, and its first edit saved that over the real one.
  const page4 = eval("(function(){ " + DECL + "\n" + grab("saveMission") + "\n" + grab("flushMission") + "\n"
    + "return { flushMission }; })()");
  banners.length = 0;
  const n4 = calls.length;
  await within(page4.flushMission());
  check("7. a page that has NOT loaded the plan saves nothing - it never writes its empty plan over the real one - and says so",
        () => calls.length === n4 && /PLAN NOT SAVED — this page has not loaded the plan/.test(banners.join(" ")),
        () => "saves sent " + (calls.length - n4) + "; banner: " + (banners[0] || "none"));

  const timers = [];
  const els = { "#encbanner": { textContent: "", style: { display: "none" } } };
  const loadingPage = () => eval("(function(){ const setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };"
    + " const clearTimeout = () => {}; const $ = (sel) => els[sel] || { value: 0 };"
    + " const showBanner = (t) => { banners.push(t); els['#encbanner'].textContent = t; els['#encbanner'].style.display = 'block'; };\n"
    + DECL + "\n" + grab("saveMission") + "\n" + grab("flushMission") + "\n" + grab("loadMission") + "\n"
    + "return { loadMission, flushMission, get: () => ({ missionLoaded, missionRev }) }; })()");
  const page5 = loadingPage();
  const tryLoad = async (p, reply) => {        // reply: [status, body] or "no answer"
    banners.length = 0;
    const t0 = timers.length;
    if (reply === "no answer") fetchFails = true;
    const f = p.loadMission();
    await settle();
    fetchFails = false;
    if (reply !== "no answer") calls[calls.length - 1].resolve({ ok: reply[0] >= 200 && reply[0] < 300, status: reply[0],
                                                               json: () => Promise.resolve(reply[1]) });
    await within(f);
    return { loaded: p.get().missionLoaded, said: banners.join(" "), retry: timers.slice(t0).map((t) => t.ms) };
  };
  const locked = await tryLoad(page5, [503, { error: "mission.json could not be read (locked)" }]);
  const silent = await tryLoad(page5, "no answer");
  const notPlan = await tryLoad(page5, [200, { hello: "not a plan" }]);
  check("8. a load that fails - an error, no answer, or an answer that is not a plan - leaves the page NOT loaded, says "
        + "why, and tries again in 3 s",
        () => [locked, silent, notPlan].every((o) => !o.loaded && /PLAN NOT LOADED/.test(o.said) && o.retry.join() === "3000")
              && /could not be read \(locked\)/.test(locked.said) && /did not answer/.test(silent.said)
              && /was not a plan/.test(notPlan.said),
        () => [locked, silent, notPlan].map((o) => "loaded=" + o.loaded + " retry=" + o.retry + " '" + o.said.slice(17, 60) + "'").join(" | "));
  const nBefore = calls.length;
  // no retry scheduled (a mutation) must fail 8b, not crash it
  const lastTimer = timers[timers.length - 1];
  const retryDone = lastTimer ? lastTimer.fn() : Promise.resolve();
  await settle();
  if (calls.length > nBefore) calls[calls.length - 1].resolve({ ok: true, status: 200,
    json: () => Promise.resolve({ waypoints: [{ lat: 44.9, lon: -67.0 }, { lat: 44.91, lon: -67.0 }], lines: [], rev: 5 }) });
  await within(retryDone);
  const bannerAfter = els["#encbanner"].style.display;
  const fs5 = page5.flushMission();
  await settle();
  const sentRev = calls.length > nBefore + 1 ? calls[calls.length - 1].body.rev : "(no save)";
  if (calls.length > nBefore + 1) calls[calls.length - 1].resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, rev: 6 }) });
  await within(fs5);
  check("8b. ... and the retry that succeeds loads the plan, takes the banner down, and saves go again - with its revision",
        () => page5.get().missionLoaded === true && bannerAfter === "none" && sentRev === 5,
        () => "loaded=" + page5.get().missionLoaded + " banner " + bannerAfter + " save sent rev " + sentRev);
  const page6 = loadingPage();
  const empty = await tryLoad(page6, [200, { waypoints: [], lines: [], rev: 0 }]);
  check("8c. ... while an EMPTY plan is a plan - no file yet is not a failed load, and nothing is said",
        () => empty.loaded === true && empty.said === "" && empty.retry.length === 0,
        () => "loaded=" + empty.loaded + " said '" + empty.said + "' retries " + empty.retry.length);

  // ── 9-11. WHAT DESTROYS WORK ASKS FIRST, IN THE SIMULATOR TOO (review #11) ─────────────────
  // guiConfirm answers yes by itself in the simulator unless asked with {always: true} - so RESET wiped the
  // saved plan and the trail on one click, CLR PLAN had no question at all, and dropping a held survey's
  // remainder was not asked about either. Each is driven with the answer NO, then YES.
  const asked = [];
  let answerYes = false;
  const guiConfirm = (title, msg, opts) => { asked.push({ title, opts: opts || {} }); return Promise.resolve(answerYes); };
  const posted = [], commanded = [], replaced = [];
  const resetPage = eval("(function(){ let mission = { waypoints: [{ lat: 1, lon: 2 }], lines: [] }, boundary = [], "
    + "boundaryClosed = false, saveTimer = null; const clearTrack = () => {}, flashNote = () => {}, clearTimeout = () => {};"
    + " const fetch = (u, o) => { posted.push(JSON.parse(o.body)); return Promise.resolve({ ok: true }); };"
    + " const cmd = (p) => { commanded.push(p); return Promise.resolve({ ok: true }); };"
    + " const location = { pathname: '/', replace: (u) => replaced.push(u) };\n"
    + grab("resetMission") + "\nreturn { resetMission, plan: () => mission }; })()");
  answerYes = false;
  await within(resetPage.resetMission());
  const resetNo = { q: asked[asked.length - 1], posted: posted.length, commanded: commanded.length, replaced: replaced.length,
                    kept: resetPage.plan().waypoints.length };
  answerYes = true;
  await within(resetPage.resetMission());
  check("9. RESET asks even in the simulator ({always: true}); a NO keeps the plan and sends nothing, a YES clears the plan, "
        + "power-cycles the boat and reloads",
        () => resetNo.q && resetNo.q.title === "Reset the mission" && resetNo.q.opts.always === true
              && resetNo.posted === 0 && resetNo.commanded === 0 && resetNo.replaced === 0 && resetNo.kept === 1
              && posted.length === 1 && posted[0].waypoints.length === 0 && commanded.join() === "/api/cmd/reset"
              && replaced.length === 1,
        () => "no: " + JSON.stringify(resetNo) + "; yes: posted " + posted.length + " commanded " + commanded + " reloaded " + replaced.length);

  const saves = [];
  const clearPage = eval("(function(){ let mission = { waypoints: [{ lat: 1, lon: 2 }, { lat: 1, lon: 3 }], "
    + "lines: [{ a: { lat: 1, lon: 2 }, b: { lat: 1, lon: 3 } }] }, runRoute = [1], planIntent = {}, runUnsafe = [];"
    + " const resetPattern = () => {}, render = () => {}, saveMission = () => saves.push(1);\n"
    + grab("clearPlan") + "\nreturn { clearPlan, plan: () => mission, empty: () => { mission = { waypoints: [], lines: [] }; } }; })()");
  const q0 = asked.length;
  answerYes = false;
  await within(clearPage.clearPlan());
  const clearNo = { q: asked[q0], kept: clearPage.plan().waypoints.length, saves: saves.length };
  answerYes = true;
  await within(clearPage.clearPlan());
  const clearYes = { cleared: clearPage.plan().waypoints.length === 0 && clearPage.plan().lines.length === 0, saves: saves.length };
  clearPage.empty();
  const q1 = asked.length;
  await within(clearPage.clearPlan());
  check("10. CLR PLAN asks even in the simulator, naming what it deletes; a NO keeps the plan unsaved, a YES clears and saves - "
        + "and an EMPTY plan is cleared without a question",
        () => clearNo.q && clearNo.q.title === "Clear the plan" && clearNo.q.opts.always === true && clearNo.kept === 2
              && clearNo.saves === 0 && clearYes.cleared && clearYes.saves === 1 && asked.length === q1 && saves.length === 2,
        () => "no: " + JSON.stringify(clearNo) + "; yes: " + JSON.stringify(clearYes) + "; empty asked " + (asked.length - q1));

  const dropPage = eval("(function(){ let guardHeld = { route: [1, 2, 3], idx: 1 }; const guardLevel = 'hold', clearance = {};"
    + " const guardHeldOffer = () => guardHeld, flashNote = () => {}, renderGuardBar = () => {};\n"
    + grab("dropHeldSurvey") + "\nreturn { dropHeldSurvey, held: () => guardHeld }; })()");
  const q2 = asked.length;
  answerYes = false;
  await within(dropPage.dropHeldSurvey());
  const dropNo = { q: asked[q2], kept: dropPage.held() !== null };
  answerYes = true;
  await within(dropPage.dropHeldSurvey());
  check("11. dropping a held survey's remainder asks even in the simulator; a NO keeps it, a YES forgets it",
        () => dropNo.q && dropNo.q.title === "Leave the boat holding" && dropNo.q.opts.always === true && dropNo.kept
              && dropPage.held() === null,
        () => "no: asked " + (dropNo.q && dropNo.q.title) + " always=" + (dropNo.q && dropNo.q.opts.always) + " kept=" + dropNo.kept
              + "; yes: held=" + JSON.stringify(dropPage.held()));

  __finished = true;
  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
