// tests/spawn_trail.js - the trail belongs to a BOOT, and a respawn ends the boot.
//
// Andy, twice, five days apart:
//
//   "when respawning delete the initial position and the line. It's unneeded."
//   "When respawning, do not inscribe the blue line. If I respawn it means the initial
//    placement was sub-optimal and is therefore unnecessary to remember."
//
// The first report was left open in the handoff with "resetForNewArea ALREADY clears the
// track, so whatever he is seeing is something else". IT IS NOT SOMETHING ELSE - IT IS THAT
// CLEAR, AND THE PROBLEM IS *WHEN* IT RUNS. Three call sites cleared the trail PRE-EMPTIVELY,
// before the command that reboots the sim: doSpawn, resetForNewArea (port change) and
// switchVessel. All three were racing the frames they were trying to get ahead of, and all
// three lost, because the boot-id rule that was supposed to be the real mechanism only ever
// ran ONCE PER PAGE LOAD (`if(bootChecked) return`).
//
// MEASURED ON A LIVE CONSOLE, not reasoned about - the fixture below is a verbatim capture
// of /events across a real /api/cmd/spawn, and it is the whole reason this suite exists:
//
//     +0.028 s  boot A  43.07300,-70.71000   <- the OLD link, still ticking at 4 Hz AFTER
//     +0.030 s  boot A  43.07300,-70.71000      the operator clicked and the page cleared
//     +0.038 s  boot B  (no fix)                the trail
//     +0.295 s  boot B  43.09300,-70.76600   <- the new placement
//
// Two points survive, so `track.length > 1`, so the chart strokes a line between them in
// --track (#39c0ff): a 5,066 m blue line from the placement he was moving AWAY from to the
// one he chose. That is "the initial position and the line".
//
// Note the third frame: the new boot arrives with NO POSITION AT ALL. connect() clears
// `status` so a new link's life starts with no telemetry (home_spawn.py check 10), so the
// boot change and the first new fix land on DIFFERENT frames. Any fix keyed on "the frame
// whose position moved" would miss it. The fixture keeps that ordering for exactly that
// reason.
//
//   node tests/spawn_trail.js      # exit 0 = pass, 1 = fail   (stdlib Node, no deps)
//
// THE RULES THIS SUITE ENCODES:
//   * The boot id is checked on EVERY frame, not just the first. One comparison serves both
//     cases - a page refresh into a rebooted server (against the id stored beside the
//     restored trail) and a reboot under a page that never reloaded (against the live id).
//   * The clear lands on the frame that REPORTS the new boot, which is the earliest thing
//     that can also wipe a stale fix already pushed. A pre-emptive clear cannot do that.
//   * ...and it must not clear on EVERY frame: within one boot the trail still accumulates.
//     Checks 5 and 6 are the acceptance case that pairs with check 2's refusal.
//   * A REFUSED spawn costs the operator nothing - not the trail, not the drawn route. The
//     client half of the rule home_spawn.py check 6b holds the server to.
//   * clearTrack(), never a bare `track = []`: the mirror and the pending save go too.
//
// THIS SUITE RESTS ON A SERVER CONTRACT THAT IS ALREADY TESTED BOTH WAYS, and is worth
// nothing without it: an accepted spawn mints a new boot_id (home_spawn.py check 7) and a
// refused one leaves it alone (check 6b). If those ever stop holding, this suite passes
// while the console is broken - so they are named here rather than assumed.
//
// TEETH (recorded results, run against a SIDECAR copy of asv.html - the real file is never
// mutated, and `git diff` was checked after every run):
//   see the block at the foot of this file.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
// Setup here evals page source and builds a world; a throw there would kill the process
// before a single FAIL line printed, and "no FAIL lines" is indistinguishable from "passed"
// to anything reading stdout - so a mutation that crashes this suite would score SURVIVED.
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

// ASV_HTML lets a mutation run point at a sidecar copy. Unset = the real page.
const HTML = process.env.ASV_HTML || path.join(__dirname, "..", "static", "asv.html");
const H = fs.readFileSync(HTML, "utf8");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok, note;
  try { ok = !!cond(); note = typeof detail === "function" ? detail() : detail; }
  catch (e) { ok = false; note = "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (note ? "   [" + note + "]" : ""));
  if (!ok) fails++;
}

// --- lift the REAL code out of the page ------------------------------------ //
// A missing anchor is a loud failure, never a silent skip: this suite is worthless if it
// quietly stops testing the code it names.
function grab(name) {
  const start = H.indexOf("function " + name + "(");
  if (start < 0) throw new Error("anchor gone: function " + name + " (renamed?)");
  let k = H.indexOf("{", start), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
function between(a, b) {
  const i = H.indexOf(a); if (i < 0) throw new Error("anchor gone: " + JSON.stringify(a));
  const j = H.indexOf(b, i); if (j < 0) throw new Error("anchor gone: " + JSON.stringify(b));
  return H.slice(i, j);
}
// The source-shape checks read CODE, not prose. Without this the comment beside a rule can
// satisfy the check written to enforce it - the comment in resetForNewArea quotes the very
// `track = []` that check 11 exists to forbid.
function code(s) { return s.replace(/\/\/[^\n]*/g, ""); }

const PUSH_HEAD   = "    const last = track[track.length-1];";
const TRACK_BLOCK = between("const TRACK_KEY =", "let asv = null;");
const PUSH        = between(PUSH_HEAD, "\n    }") + "\n    }";     // onState's own append
const MAX_TRACK   = Number(/MAX_TRACK\s*=\s*(\d+)/.exec(H)[1]);

// The page has all of this in ONE lexical scope, so the world is built as one function body
// rather than as separately-eval'd pieces - nothing is rewritten to be testable.
//
// localStorage is a PARAMETER, not a global. It was a global first, and that was a hole: a
// later world replaced it, so an un-cancelled save timer belonging to an EARLIER world wrote
// into the later world's store and check 13 could not see it - the clearTimeout mutation
// would have survived. Each world now owns its store lexically, the way the page owns the
// browser's.
function makeWorld(stored) {
  const map = new Map();
  if (stored !== undefined) map.set("asv_track_v1", JSON.stringify(stored));
  const store = {
    map,
    getItem(k)    { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, String(v)); },
    removeItem(k) { map.delete(k); },
  };
  const body = [
    "let asv = null, renders = 0;",
    "function render(){ renders++; }",
    grab("lsGet"), grab("lsSet"), grab("lsDel"),
    "const MAX_TRACK = " + MAX_TRACK + ";",
    TRACK_BLOCK,
    "function __push(a){ asv = a;\n" + PUSH + "\n}",
    "return { checkBoot, clearTrack, saveTrack, push: __push,",
    "         get track(){ return track; }, get renders(){ return renders; } };",
  ].join("\n");
  const w = new Function("localStorage", body)(store);
  w.store = store;
  return w;
}

// onState's own order: checkBoot first, then the position append.
function frame(W, boot, lat, lon) {
  W.checkBoot(boot);
  if (lat == null || lon == null) return;
  W.push({ lat: lat, lon: lon });
}
function spanM(track) {
  if (track.length < 2) return 0;
  const a = track[0], b = track[track.length - 1];
  return Math.hypot((b.lat - a.lat) * 111320, (b.lon - a.lon) * 111320 * 0.73);
}

// --- THE FIXTURE: a verbatim /events capture across a real /api/cmd/spawn --- //
// [seconds relative to the click, boot tag, lat, lon]. Boot A is the console the operator
// was looking at; boot B is the one the spawn created.
const CAPTURE = [
  [-0.983, "A", 43.073, -70.710],
  [-0.731, "A", 43.073, -70.710],
  [-0.478, "A", 43.073, -70.710],
  [-0.226, "A", 43.073, -70.710],
  [ 0.028, "A", 43.073, -70.710],          // <- the old link, still ticking AFTER the click
  [ 0.030, "A", 43.073, -70.710],
  [ 0.038, "B", null,   null   ],          // <- new boot, no telemetry yet
  [ 0.295, "B", 43.093, -70.766],          // <- the new placement
  [ 0.619, "B", 43.093, -70.766],
  [ 0.812, "B", 43.093, -70.766],
  [ 1.066, "B", 43.093, -70.766],
  [ 1.316, "B", 43.093, -70.766],
];

console.log("Respawn - the trail belongs to a boot, and the boot ended:");

// --- 1-4. the reported defect --------------------------------------------- //
check("1. the page still has the code this suite names",
      () => TRACK_BLOCK.indexOf("function checkBoot") >= 0 && PUSH.indexOf("track.push") >= 0
            && MAX_TRACK > 0,
      () => "checkBoot+push lifted, MAX_TRACK=" + MAX_TRACK);

const W1 = makeWorld();
for (const [, b, la, lo] of CAPTURE) frame(W1, "boot-" + b, la, lo);
check("2. THE REPORT: a respawn inscribes no line",
      () => W1.track.length <= 1,
      () => W1.track.length + " point(s), " + spanM(W1.track).toFixed(0) + " m end to end");

check("3. ...and the one point left is the NEW placement, not the old one",
      () => W1.track.length === 1 && Math.abs(W1.track[0].lat - 43.093) < 1e-9
            && Math.abs(W1.track[0].lon - (-70.766)) < 1e-9,
      () => W1.track.length ? W1.track[0].lat.toFixed(5) + "," + W1.track[0].lon.toFixed(5)
                            : "(empty)");

// The stale fix is already IN the trail when the boot change lands - which is the whole
// reason a pre-emptive clear cannot do this job.
const W2 = makeWorld();
frame(W2, "boot-A", 43.073, -70.710);
const hadStale = W2.track.length === 1;
frame(W2, "boot-B", null, null);
check("4. a stale fix already pushed is WIPED by the boot change, not joined to",
      () => hadStale && W2.track.length === 0,
      () => "stale point present first: " + hadStale + ", after the boot frame: " + W2.track.length);

// --- 5-6. the acceptance case: the trail still works ---------------------- //
const W3 = makeWorld();
for (let i = 0; i < 6; i++) frame(W3, "boot-A", 43.073 + i * 0.001, -70.710);
check("5. within ONE boot the trail still accumulates",
      () => W3.track.length === 6,
      () => W3.track.length + " points over 6 frames");

check("6. ...and a repeated boot id never clears it",
      () => { const n = W3.track.length; frame(W3, "boot-A", 43.0796, -70.710);
              return W3.track.length === n + 1; },
      () => W3.track.length + " points after one more frame of the same boot");

// --- 7-9b. the first-load arm, unchanged ---------------------------------- //
const OLD_TRAIL = [{ lat: 43.070, lon: -70.700 }, { lat: 43.071, lon: -70.701 }];
const Wsame = makeWorld({ bootId: "boot-A", track: OLD_TRAIL });
check("7. a page refresh WITHIN a session keeps the restored trail",
      () => { const n = Wsame.track.length; frame(Wsame, "boot-A", 43.072, -70.702);
              return n === 2 && Wsame.track.length === 3; },
      () => "restored " + OLD_TRAIL.length + ", now " + Wsame.track.length);

const Wboot = makeWorld({ bootId: "boot-A", track: OLD_TRAIL });
check("8. a refresh into a REBOOTED server drops the restored trail",
      () => { frame(Wboot, "boot-B", 43.093, -70.766); return Wboot.track.length === 1; },
      () => Wboot.track.length + " point(s) left");

const Wlegacy = makeWorld(OLD_TRAIL);                    // legacy untagged array: no stored id
check("9. a legacy untagged trail is not dropped on a guess",
      () => { frame(Wlegacy, "boot-A", 43.072, -70.702); return Wlegacy.track.length === 3; },
      () => Wlegacy.track.length + " points (2 restored + 1)");

const Wnoid = makeWorld();
frame(Wnoid, "boot-A", 43.073, -70.710);
check("9b. a frame carrying no boot id at all clears nothing",
      () => { frame(Wnoid, null, 43.0731, -70.710); return Wnoid.track.length === 2; },
      () => Wnoid.track.length + " points");

// --- 10-11. the call sites ------------------------------------------------ //
const DOSPAWN = code(grab("doSpawn"));
check("10. a REFUSED spawn throws nothing away - doSpawn clears only past the ok gate",
      () => { const gate = DOSPAWN.indexOf("if(!r || !r.ok) return;");
              const clr  = DOSPAWN.indexOf("clearTrack()");
              return gate >= 0 && clr > gate; },
      () => "gate@" + DOSPAWN.indexOf("if(!r || !r.ok) return;") +
            " clearTrack@" + DOSPAWN.indexOf("clearTrack()"));

const RFNA = code(grab("resetForNewArea"));
check("11. a port change uses clearTrack(), not a bare `track = []`",
      () => RFNA.indexOf("clearTrack()") >= 0 && !/(^|[^.\w])track\s*=\s*\[\]/.test(RFNA),
      () => RFNA.indexOf("clearTrack()") >= 0 ? "clearTrack present"
                                              : "clearTrack MISSING from resetForNewArea");

// --- 12-14. what clearTrack actually has to do ---------------------------- //
const W4 = makeWorld();
frame(W4, "boot-A", 43.073, -70.710);
W4.saveTrack();                                        // arm the throttled mirror write
W4.store.setItem("asv_track_v1", JSON.stringify({ bootId: "boot-A", track: [{ lat: 1, lon: 2 }] }));
W4.clearTrack();
check("12. clearTrack removes the localStorage mirror",
      () => W4.store.getItem("asv_track_v1") === null,
      () => "stored=" + W4.store.getItem("asv_track_v1"));

const W5 = makeWorld();
frame(W5, "boot-A", 43.073, -70.710);
const r0 = W5.renders;
frame(W5, "boot-B", null, null);
check("14. dropping the trail redraws the chart - the line goes at once",
      () => W5.renders > r0,
      () => "renders " + r0 + " -> " + W5.renders);

// Check 13 has to outlive saveTrack's 800 ms throttle, so it settles last. It is a real
// check, not a formality: without clearTrack's clearTimeout the armed write fires here and
// puts the trail back in the store a second after the operator was told it was gone.
(async () => {
  const held = await new Promise(r => setTimeout(() => r(W4.store.getItem("asv_track_v1")), 900));
  check("13. ...and cancels the pending save, so the trail cannot be written back",
        () => held === null,
        () => "after 900 ms the store holds: " + (held === null ? "nothing" : held));

  console.log("\n" + (fails ? fails + " CHECK(S) FAILED" : "all " + ran + " checks passed"));
  process.exit(fails ? 1 : 0);
})();

// TEETH - every line below was RUN against a sidecar copy of static/asv.html, never the
// real file, with `git diff` checked clean after each. Numbers are the checks that actually
// went red, not the ones that looked likely.
//
//   restore checkBoot's `if(bootChecked) return`       -> 2, 3, 4, 14 (THE REPORTED DEFECT)
//   compare against savedBootId on every frame         -> 2, 3, 4, 14
//   clear on every frame instead of on a change        -> 5, 6, 7, 9  (the over-correction)
//   drop the first-load arm (prev = sessionBootId)     -> 8
//   clear when only ONE of the two ids is known        -> 9, 9b
//   drop the render() on a boot change                 -> 14
//   drop clearTrack's lsDel                            -> 12, 13
//   drop clearTrack's clearTimeout                     -> 13
//   move doSpawn's clearTrack back above the ok gate   -> 10
//   put `track = []` back in resetForNewArea           -> 11
//
// 10 mutations, 10 killed, none survived and none crashed the suite.
//
// TWO OF THOSE ARE NOT WHAT I PREDICTED, AND THE DIFFERENCE IS THE USEFUL PART. The first
// two also take out 14, because a checkBoot that never fires never calls render() either -
// so 14 is not only about the redraw, it is a second independent witness that the clear ran
// at all. And "drop lsDel" takes out 13 as well as 12, because 13 asks whether the store is
// empty AFTER the throttle window and both halves of clearTrack feed that. 13 still has its
// own teeth: the clearTimeout mutation is caught by 13 ALONE.
