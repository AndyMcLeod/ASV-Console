// tests/ais_stall.js - THE ALERT FOR AN AIS FEED CONNECTED BUT NOT POPULATING (Andy, 2026-10-20: "generate an alert when the
// AIS card is not populating even though its connected to the given service. Force retry connection every minute if this
// condition persists." The service half - the stall, its minute, the reconnect - is tests/ais_stall.py.)
//
// The page's own pollAIS, aisStallSay and aisStallNote, fed the console's /api/ais answers:
//   1. one source, connected and `stalled`: the card reads "stalled", keeps the contacts it holds, and the ALERT is raised
//      naming the source and how long it has been dry; the card's note gives the live figures and the tries;
//   2. still stalled on the next poll: no second alert while it is showing, the note moves on; COVERED by another
//      banner, it is raised again on the service's next try (once a minute) - not on every poll;
//   3. vessels arriving again: the alert lifted, and a note says so;
//   4. a dry source beside a live one is NOT a stall (no alert); a source in error is its own state (the alert lifted,
//      silently - the card says "feed error"); an offline service and a failed poll are not stalls either;
//   5. the card's status line has the state, and a stalled poll is not news to the contact list (aisHeard).
//
//   node tests/ais_stall.js      # exit 0 = pass, 1 = fail   (stdlib Node)

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
const UNITS = fs.readFileSync(path.join(ROOT, "static", "js", "units.js"), "utf8").split("\r\n").join("\n");

function grabIn(src, name) {
  let start = src.indexOf("function " + name + "(");
  if (start < 0) throw new Error("test setup: function " + name + " not found (renamed?)");
  if (src.slice(start - 6, start) === "async ") start -= 6;
  let k = src.indexOf("{", start), depth = 0;
  for (;;) { const c = src[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return src.slice(start, k + 1);
}
const grab = (name) => grabIn(H, name);
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
console.log("The alert for an AIS feed connected but not populating:");

// ---- the page's poll and alert, in a world of their own ----------------------------------------------------------- //
function mkWorld() {
  const w = { banners: [], downs: [], notes: [], answer: null };
  const src = [
    "let UIROLE = 'chart', aisBusy = false, aisPollBegun = 0, aisPollCtl = null, aisVessels = [], aisBeyondRpts = [];",
    "let aisPolledAt = 0, aisArea = null, aisState = 'idle', aisSrc = null, aisSrcName = null, aisNote = '';",
    "let aisStall = null, aisStallSaid = false, aisStallSaidAt = -1;",
    "const $ = (s) => (s === '#encbanner' ? slot : null);",
    "const aisWanted = () => true, aisCenter = () => ({lat: 43.07, lon: -70.71}), aisFloorQuery = () => '', aisHeldQuery = () => '';",
    "const renderAisTable = () => {}, render = () => {};",
    grabIn(UNITS, "fmtDur"),
    grabDecl("AIS_STALL_BANNER"), grab("aisStallNote"), grab("aisStallSay"), grab("pollAIS"), grab("aisHeard"),
    "return { poll: pollAIS, state: () => aisState, stall: () => aisStall, vessels: () => aisVessels,",
    "         note: () => aisStallNote(aisStall), heard: () => aisHeard() };",
  ].join("\n");
  // eslint-disable-next-line no-new-func
  // the banner slot as the page has it: one line, shown or not - showBanner fills it, takeDownBanner hides it
  w.slot = { textContent: "", style: { display: "none" } };
  w.api = new Function("fetch", "showBanner", "takeDownBanner", "flashNote", "slot", src)(
    async () => { if (w.answer instanceof Error) throw w.answer; return { json: async () => w.answer }; },
    (t) => { w.banners.push(t); w.slot.textContent = t; w.slot.style.display = "block"; },
    (re) => { w.downs.push(re); if (re.test(w.slot.textContent)) w.slot.style.display = "none"; },
    (t) => w.notes.push(t), w.slot);
  return w;
}
const ship = (mmsi, age) => ({ mmsi, lat: 43.07, lon: -70.70, age, name: "SHIP " + mmsi });
const answer = (sources, vessels = [ship(1, 80), ship(2, 95)]) => ({ ok: true, vessels, count: vessels.length, sources,
                                                                     area: { mode: "sea", show_km: 9.26, collected: 40 } });
const dry = (quiet, tries) => ({ state: "ok", stalled: true, quiet_s: quiet, stall_retries: tries,
                                 note: "connected, but no vessel report for " + quiet + " s - reconnecting every 60 s" });
const wet = { state: "ok", stalled: false, quiet_s: 1, stall_retries: 0, note: "connected" };

(async () => {
  // 1-3. one source: dry, still dry, wet again
  const W = mkWorld();
  W.answer = answer({ aisstream: dry(72, 1) });
  await W.api.poll();
  const s1 = { state: W.api.state(), stall: W.api.stall(), held: W.api.vessels().length, note: W.api.note(), heard: W.api.heard() };
  W.answer = answer({ aisstream: dry(135, 2) });
  await W.api.poll();
  const s2 = { state: W.api.state(), note: W.api.note(), banners: W.banners.length };
  // ANOTHER BANNER COVERS IT (the chart read's, measured live): the next poll of the same try says nothing; the next try does
  W.slot.textContent = "Nogo established (1469 nogo zone(s) · band harbour).";
  W.answer = answer({ aisstream: dry(140, 2) });
  await W.api.poll();
  const sameTry = W.banners.length;
  W.answer = answer({ aisstream: dry(197, 3) });
  await W.api.poll();
  const nextTry = { n: W.banners.length, text: W.banners[W.banners.length - 1] };
  W.answer = answer({ aisstream: dry(201, 3) });
  await W.api.poll();
  const shown = W.banners.length;
  W.answer = answer({ aisstream: wet }, [ship(1, 2), ship(3, 1)]);
  await W.api.poll();
  const s3 = { state: W.api.state(), stall: W.api.stall(), downs: W.downs.length, heard: W.api.heard() };
  check("1. ONE SOURCE CONNECTED AND STALLED: the card reads 'stalled' and keeps the contacts it holds (the last heard); "
        + "the ALERT is raised naming the source and how long it has been dry, and that the console reconnects every "
        + "minute; the card's note gives the live figures; a stalled poll is not news to the list (aisHeard)",
        () => s1.state === "stalled" && s1.held === 2 && s1.heard === false
              && JSON.stringify(s1.stall) === JSON.stringify({ name: "aisstream", quiet_s: 72, retries: 1 })
              && W.banners[0] === "⚠ AIS NOT POPULATING — aisstream says it is connected, but no vessel report has "
                 + "arrived for 72 s. The console is reconnecting to it every minute until vessels arrive; the contacts "
                 + "on the chart are the last ones heard."
              && s1.note === "no vessel report for 1m · reconnecting every minute (1 so far)",
        () => JSON.stringify({ s1, banner: W.banners[0] }));
  check("2. STILL STALLED ON THE NEXT POLL: no second alert while it shows, and the card's note moves on (2m, 2 tries); "
        + "COVERED by another banner, it is NOT raised again on a poll of the same try, but IS on the service's next try "
        + "(once a minute), with the figures of then - and not again while that one shows",
        () => s2.state === "stalled" && s2.banners === 1 && s2.note === "no vessel report for 2m · reconnecting every minute (2 so far)"
              && sameTry === 1 && nextTry.n === 2 && /^⚠ AIS NOT POPULATING — aisstream [^\n]* for 197 s\./.test(nextTry.text)
              && shown === 2,
        () => JSON.stringify({ s2, sameTry, nextTry, shown }));
  check("3. VESSELS ARRIVING AGAIN: the state 'ok', the alert LIFTED (the regex it is lifted by matches it and nothing "
        + "else), and a note says the feed is populating again, naming it",
        () => s3.state === "ok" && s3.stall === null && s3.downs === 1 && W.downs[0].test(W.banners[0])
              && W.slot.style.display === "none"
              && !W.downs[0].test("⚠ AIS KEEP-OUTS BLIND — x") && s3.heard === true
              && W.notes.join("|") === "AIS populating again — aisstream: vessels arriving.",
        () => JSON.stringify({ s3, notes: W.notes }));

  // 4. not a stall: a dry feed beside a live one; an error; an offline service; a failed poll
  const B = mkWorld();
  B.answer = answer({ aisstream: dry(300, 4), aishub: wet });
  await B.api.poll();
  const beside = { state: B.api.state(), stall: B.api.stall(), banners: B.banners.length };
  const E = mkWorld();
  E.answer = answer({ aisstream: dry(80, 1) });
  await E.api.poll();
  E.answer = answer({ aisstream: { state: "error", stalled: false, quiet_s: 140, stall_retries: 0, note: "aisstream: Api Key Is Not Valid" } }, []);
  await E.api.poll();
  const err = { state: E.api.state(), stall: E.api.stall(), banners: E.banners.length, downs: E.downs.length, notes: E.notes.length };
  const O = mkWorld();
  O.answer = { ok: false, vessels: [], count: 0, note: "AIS service unreachable", area: { mode: "sea" } };
  await O.api.poll();
  const off = { state: O.api.state(), stall: O.api.stall(), banners: O.banners.length };
  const F = mkWorld();
  F.answer = answer({ aisstream: dry(70, 1) });
  await F.api.poll();
  F.answer = new Error("Failed to fetch");
  await F.api.poll();
  const failed = { state: F.api.state(), stall: F.api.stall(), downs: F.downs.length, notes: F.notes.length };
  check("4. NOT A STALL: a dry source beside a live one (no alert); a source in ERROR is its own state - an alert up is "
        + "lifted silently, the card saying 'feed error'; an offline service and a failed poll are 'offline', the alert "
        + "lifted without a 'populating again'",
        () => beside.state === "ok" && beside.stall === null && beside.banners === 0
              && err.state === "error" && err.stall === null && err.banners === 1 && err.downs === 1 && err.notes === 0
              && off.state === "offline" && off.stall === null && off.banners === 0
              && failed.state === "offline" && failed.stall === null && failed.downs === 1 && failed.notes === 0,
        () => JSON.stringify({ beside, err, off, failed }));

  // 5. the card's status line, by source (it needs the card's DOM to run)
  const R = grab("renderAisTable");
  check("5. THE CARD SAYS IT: renderAisTable has the 'stalled' state - red, 'connected, not populating', the source and "
        + "aisStallNote's figures - ahead of the 'empty' branch; and aisHeard counts only 'ok' and 'empty' as news",
        () => /else if\(aisState==="stalled"\)\{\s*stDot="#d9534f"; stMain="connected, not populating" \+ held;\s*stNote=\[srcLbl, aisStallNote\(aisStall\)\]\.filter\(Boolean\)\.join\(" · "\); \}/.test(R)
              && R.indexOf('aisState==="stalled"') < R.indexOf('aisState==="empty"')
              && /function aisHeard\(\)\{ return aisState === "ok" \|\| aisState === "empty"; \}/.test(H),
        () => "");

  console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
  process.exit(fails ? 1 : 0);
})();
