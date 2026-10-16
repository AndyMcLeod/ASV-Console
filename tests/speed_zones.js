// tests/speed_zones.js - SPEED ZONES: the water where the law sets her speed (static/js/speedzones.js and the page's
// governor).
//
// Andy, 2026-10-16: "for safe navigation and according to maritime law zone specific speed limits are imposed, such as no
// wake zones", then "Try ingesting local data from state GIS portals and merge into the NOAA environment. Build a bounded
// area that overrides commanded speed and lowers to legal speed. this releases once the ASV is clear of the area and it
// returns to commanded speed". Pinned here:
//   1-1c  THE CHART'S OWN (parseSpeedText, noaaZones): the right whale areas' text read as 10 kn for vessels 19.8 m and
//         over, in each of NOAA's spellings; "5 knot speed limit"; "Speed restricted" with no number; no wake, headway,
//         idle; mph turned to knots; a restricted area with no speed (a no-discharge zone, a critical habitat) is none;
//   2-2b  WHO A ZONE BINDS and the SPEED IT ALLOWS: the right whale areas not the DriX (7.7 m); the fastest key at or under
//         a limit, the slowest for a rule with no number, and said when even the slowest is over it;
//   3-3b  WHERE: in it, its edge, the first zone on the route ahead and none past the lead;
//   4-4d  THE DECISION: in a zone; ahead within the lead and not beyond it; still clearing it until she is out by her
//         length; the most restrictive of several; a zone that does not bind her said, not obeyed;
//   5-5d  THE GOVERNOR (the page's own speedGovernor and zone functions): the job's speed lowered to the zone's before it
//         and in it, said once; the job's speed back when she is clear, said; never RAISED by a zone; the guard's
//         slow-down left alone; a page that cannot say her leg still caps her and puts her speed back.
//
//   node tests/speed_zones.js   # exit 0 = pass

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
const APP = process.env.ASV_APP || path.join(__dirname, "..");
const Z = require(path.join(APP, "static", "js", "speedzones.js"));
const GD = require(path.join(APP, "static", "js", "geodesy.js"));
const H = fs.readFileSync(process.env.ASV_HTML || path.join(APP, "static", "asv.html"), "utf8");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = "THREW: " + e.message; }
  if (typeof detail === "function") { try { detail = detail(); } catch (e) { detail = "detail threw: " + e.message; } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}
function grab(name) {
  const start = H.search(new RegExp("(async )?function " + name + "\\("));
  if (start < 0) throw new Error("function " + name + " not found in the page (renamed?)");
  let k = H.indexOf("{", H.indexOf(")", start)), depth = 0;
  for (;;) { const c = H[k]; if (c === "{") depth++; else if (c === "}") { depth--; if (!depth) break; } k++; }
  return H.slice(start, k + 1);
}
console.log("Speed zones:");

// ── 1. the chart's own ───────────────────────────────────────────────────────────────────────────────────────────────
const SMA = [
  "50 CFR 224.105: All vessels greater than or equal to 65ft/19.8m in length must slow to speeds of 10 knots or less in seasonal management areas.",
  "50 CFR 224.105: All vessels greater than or equal to 65 feet / 19.8 metres in length must slow to speeds of 10 knots or less in seasonal management areas.",
  "50 CFR 224.105: All vessels greater than or equal to 19.8 meters / 65 feet in length must slow to speeds of 10 knots or less in seasonal management areas.",
  "50 CFR 224.105: All vessels greater than or equal to 65ft/19.8m in length must slow to speeds of 10 knots of less in seasonal management area.",
];
const sma = SMA.map(Z.parseSpeedText);
check("1. THE RIGHT WHALE AREAS' TEXT, in each of NOAA's spellings: 10 kn, binding vessels 19.8 m (65 ft) and over",
      () => sma.every((r) => r && r.rule === "limit" && r.limit_kn === 10 && r.min_length_m === 19.8),
      () => JSON.stringify(sma));
const t1b = {
  five: Z.parseSpeedText("speed restricted, 5 knot speed limit"),
  kings: Z.parseSpeedText("33 CFR 165.730, Regulated area;Speed restricted"),
  wake: Z.parseSpeedText("No Wake Zone"), headway: Z.parseSpeedText("Headway speed only"), idle: Z.parseSpeedText("IDLE SPEED - NO WAKE"),
  mph: Z.parseSpeedText("Speed limit 25 MPH"),
};
check("1b. '5 knot speed limit' is 5 kn; 'Speed restricted' with no number is a restriction with no limit; no wake, "
      + "headway, idle each their rule; 25 mph is 21.7 kn",
      () => t1b.five.rule === "limit" && t1b.five.limit_kn === 5 && !t1b.five.min_length_m
            && t1b.kings.rule === "restricted" && t1b.kings.limit_kn === null
            && t1b.wake.rule === "no_wake" && t1b.headway.rule === "headway" && t1b.idle.rule === "no_wake"
            && t1b.mph.rule === "limit" && t1b.mph.limit_kn === 21.7,
      () => JSON.stringify(t1b));
// THE KITTERY REGULATED AREA (33 CFR 165.101), off the Naval Shipyard beside New Castle: the chart names it only by its
// citation, the regulation says 5 mph - read from CFR_SPEED; its neighbours' citations are not it
const KIT = "Regulated navigation area, 33 CFR 165.101: Navigation regulations are published in Chapter 2 of the U.S. Coast Pilot for this geographic area. Refer to regulation section numbers.";
const kit = { it: Z.parseSpeedText(KIT), longer: Z.parseSpeedText("33 CFR 165.1010 regulated area"), next: Z.parseSpeedText("Security zone, 33 CFR 165.102") };
const kitZ = Z.noaaZones([{ role: "restricted", geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] }, props: { INFORM: KIT } }]);
check("1d. KITTERY BY ITS CITATION: the chart's 'Regulated navigation area, 33 CFR 165.101' read as the regulation's 5 mph "
      + "(4.3 kn), named by its citation, the regulation's words its text; 165.1010 and 165.102 are not it",
      () => kit.it && kit.it.rule === "limit" && kit.it.limit_kn === 4.3 && kit.longer === null && kit.next === null
            && kitZ.length === 1 && kitZ[0].props.name === "33 CFR 165.101 regulated area" && /five miles per hour/.test(kitZ[0].props.text),
      () => JSON.stringify({ kit, z: kitZ.map((z) => z.props) }));
const RW_CH = "Precautionary area: 50 CFR 226.203, 224.103c. It is illegal to approach any right whale anywhere closer than 460 meters/500 yards.";
const sq = (lat, lon, m) => { const dl = m / 111320, dn = m / (111320 * Math.cos(lat * Math.PI / 180));
  return { type: "Polygon", coordinates: [[[lon, lat], [lon + dn, lat], [lon + dn, lat + dl], [lon, lat + dl], [lon, lat]]] }; };
const feats = [
  { role: "restricted", geometry: sq(43, -70.7, 1000), props: { OBJNAM: "Seasonal Management Area", INFORM: SMA[0] } },
  { role: "restricted", geometry: sq(43, -70.7, 1000), props: { INFORM: "40 CFR 140" } },
  { role: "restricted", geometry: sq(43, -70.7, 1000), props: { OBJNAM: "Right Whale Critical Habitat", INFORM: RW_CH } },
  { role: "dredged", geometry: sq(43, -70.7, 1000), props: { INFORM: "speed restricted, 5 knot speed limit" } },
];
const nz = Z.noaaZones(feats);
check("1c. THE CHART'S SPEED ZONES: of four areas only the restricted one whose text gives a speed - the right whale area, "
      + "named, NOAA ENC, its text kept; not a no-discharge zone, not the critical habitat's approach distance, not a "
      + "dredged area",
      () => nz.length === 1 && nz[0].role === "speed_zone" && nz[0].props.name === "Seasonal Management Area"
            && nz[0].props.source === "NOAA ENC" && nz[0].props.limit_kn === 10 && nz[0].props.min_length_m === 19.8
            && Z.parseSpeedText("40 CFR 140") === null && Z.parseSpeedText(RW_CH) === null,
      () => JSON.stringify(nz.map((z) => z.props)));

// ── 2. who a zone binds, and the speed it allows ─────────────────────────────────────────────────────────────────────
const DRIX = { low: 4, survey: 7, high: 10, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10 };
const SMALL = { low: 1.5, survey: 3, high: 6, 2: 2, 3: 3, 4: 4, 5: 5, 6: 6 };
const zone = (rule, limit, extra) => ({ role: "speed_zone", geometry: sq(43, -70.7, 400),
  props: Object.assign({ rule, limit_kn: limit, name: "Test " + rule, source: "TEST" }, extra || {}) });
const a2 = { drix: Z.zoneApplies(nz[0], 7.71), big: Z.zoneApplies(nz[0], 20), none: Z.zoneApplies(zone("limit", 5), 7.71) };
check("2. WHO A ZONE BINDS: the right whale areas (19.8 m and over) not the DriX at 7.7 m - said why; a 20 m hull yes; a "
      + "zone with no length rule binds every hull",
      () => !a2.drix.applies && /binds vessels 19\.8 m \(65 ft\) and longer, and she is 7\.7 m/.test(a2.drix.why) && a2.big.applies && a2.none.applies,
      () => JSON.stringify(a2));
const k2 = {
  five: Z.zoneKey(zone("limit", 5), DRIX), ten: Z.zoneKey(zone("limit", 10), DRIX), half: Z.zoneKey(zone("limit", 5.5), DRIX),
  three: Z.zoneKey(zone("limit", 3), DRIX), wake: Z.zoneKey(zone("no_wake", null), DRIX), zb: Z.zoneKey(zone("no_wake", null), SMALL),
  restr: Z.zoneKey(zone("restricted", null), SMALL),
};
check("2b. THE SPEED A ZONE ALLOWS: the fastest key at or under its limit (5 kn -> 5, 10 -> 10, 5.5 -> 5); a limit under "
      + "her slowest takes the slowest and says so (3 kn -> 4, below); no wake / restricted - the hull's slowest (DriX 4, "
      + "the small-class hull 1.5); of keys at one speed the whole knot ('4', not 'low')",
      () => k2.five.kn === 5 && !k2.five.below && k2.ten.kn === 10 && k2.half.kn === 5 && k2.three.kn === 4 && k2.three.below
            && k2.wake.key === "4" && k2.wake.kn === 4 && !k2.wake.below && k2.ten.key === "10" && k2.zb.kn === 1.5 && k2.restr.kn === 1.5,
      () => JSON.stringify(k2));

// ── 3. where ─────────────────────────────────────────────────────────────────────────────────────────────────────────
const Z5 = zone("limit", 5);                     // 400 m square, its SW corner at 43, -70.7
const fr = GD.planeFrame({ lat: 43, lon: -70.7 });
const at = (e, n) => fr.fromEN(e, n);
const w3 = { inside: Z.inZone(at(200, 200), Z5), outside: Z.inZone(at(-50, 200), Z5), edgeIn: Z.zoneEdgeM(at(200, 380), Z5),
             edgeOut: Z.zoneEdgeM(at(-50, 200), Z5) };
check("3. IN IT AND ITS EDGE: a point in the middle is in, 50 m west of it is not; 20 m inside the north edge is 20 m from "
      + "it, 50 m outside the west edge 50 m",
      () => w3.inside && !w3.outside && Math.abs(w3.edgeIn - 20) < 0.5 && Math.abs(w3.edgeOut - 50) < 0.5,
      () => JSON.stringify(w3));
const route = [at(-500, 200), at(1000, 200)];   // due east through the zone's middle, entering at e = 0
const f3 = Z.firstZoneAhead(route, [Z5], 600), f3far = Z.firstZoneAhead(route, [Z5], 400);
check("3b. THE FIRST ZONE AHEAD along the route she flies: met 500 m on (within one 5 m sample), and none when the lead "
      + "reaches only 400 m",
      () => f3 && f3.zone === Z5 && Math.abs(f3.d - 500) <= Z.ZONE_SAMPLE_M && f3far === null,
      () => JSON.stringify({ d: f3 && f3.d, far: f3far }));

// ── 4. the decision ──────────────────────────────────────────────────────────────────────────────────────────────────
const dec = (pos, extra) => Z.zoneDecision(Object.assign({ pos, ahead: [at(1000, 200)], zones: [Z5], loaM: 7.71, speedsKn: DRIX, leadM: 300, held: null }, extra || {}));
const d4 = { in: dec(at(200, 200)), ahead: dec(at(-200, 200)), far: dec(at(-400, 200)) };
check("4. IN A ZONE its speed (5 kn, 'in'); 200 m short of it with a 300 m lead, 'ahead' at 200 m; 400 m short - nothing yet",
      () => d4.in && d4.in.where === "in" && d4.in.kn === 5 && d4.ahead && d4.ahead.where === "ahead" && Math.abs(d4.ahead.d - 200) <= Z.ZONE_SAMPLE_M
            && d4.far === null,
      () => JSON.stringify({ in: d4.in && [d4.in.where, d4.in.kn], ahead: d4.ahead && [d4.ahead.where, d4.ahead.d], far: d4.far }));
const held = { id: Z.zoneId(Z5) };
const out = (e) => dec(at(e, 200), { ahead: [at(1500, 200)], held });
const d4b = { five: out(405), nine: out(409), eleven: out(411), noHeld: dec(at(405, 200), { ahead: [at(1500, 200)] }),
  // held while it was only AHEAD, and her route no longer enters it: 5 m off its west edge she was never in it - released
  wasAhead: dec(at(-5, 200), { ahead: [at(-5, -500)], held: { id: Z.zoneId(Z5), where: "ahead" } }) };
check("4b. CLEAR ONLY BY HER LENGTH: out of its east edge she is still clearing it ('leaving') at 5 m and 9 m, clear at "
      + "11 m (her 7.7 m, 10 m at least); with no zone held, 5 m out is clear at once; and a zone held only while AHEAD, "
      + "whose edge she is 5 m from with her route now turned away, is no 'leaving' - she was never in it",
      () => d4b.five && d4b.five.where === "leaving" && d4b.nine && d4b.nine.where === "leaving" && d4b.eleven === null && d4b.noHeld === null
            && d4b.wasAhead === null,
      () => JSON.stringify(Object.fromEntries(Object.entries(d4b).map(([k, v]) => [k, v && v.where]))));
const Z10 = Object.assign(zone("limit", 10), { geometry: sq(43, -70.7 - 0.01, 3000) });   // a big 10 kn zone round the 5 kn one
const d4c = Z.zoneDecision({ pos: at(-200, 200), ahead: [at(1000, 200)], zones: [Z10, Z5], loaM: 7.71, speedsKn: DRIX, leadM: 300, held: null });
check("4c. THE MOST RESTRICTIVE: in a 10 kn zone with a 5 kn zone 200 m ahead within the lead - the 5 kn one, ahead",
      () => d4c && d4c.kn === 5 && d4c.where === "ahead" && d4c.zone === Z5, () => JSON.stringify(d4c && [d4c.kn, d4c.where]));
const SMAZ = Object.assign(zone("limit", 10, { min_length_m: 19.8 }), { geometry: sq(43, -70.7, 400) });
const d4d = Z.zoneDecision({ pos: at(200, 200), ahead: [], zones: [SMAZ], loaM: 7.71, speedsKn: DRIX, leadM: 300, held: null });
check("4d. A ZONE THAT DOES NOT BIND HER is no speed - but she is in it, and the answer names it to be said",
      () => d4d && d4d.key === null && d4d.skipped.length === 1 && d4d.skipped[0] === SMAZ, () => JSON.stringify(d4d && { key: d4d.key, n: d4d.skipped.length }));

// ── 5. the governor ──────────────────────────────────────────────────────────────────────────────────────────────────
// The page's own speedGovernor, speedZonesNow, zoneCap, zoneTrack and zoneOnlyGovern over the real module, a DriX in a
// world of its own: her position moved by the check, the route she flies due east through the 5 kn zone, the job's speed 7.
const gov = (o) => {
  const w = Object.assign({ pos: at(-600, 200), sog: 7, speedKey: "7", route: [at(-600, 200), at(1500, 200)], indexed: true,
    slowed: false, sent: [], banners: [], notes: [], logs: [], zones: [Z5] }, o || {});
  const src = [
    "const V = {SPEED_KN: w.speeds || " + JSON.stringify(DRIX) + ", VESSEL: {hull: {loa_m: 7.71}}};",
    "const sea = {enc: {features: w.zones}}; const S = {run: 'running', armed: true, estop: false, behavior: 'transit', wp_index: 1, status: {}};",
    "Object.defineProperty(S.status, 'sog_kn', {get: () => w.sog}); Object.defineProperty(S.status, 'speed_key', {get: () => w.speedKey});",
    "let asv = null; const supervising = () => true, clearance = {get slowed(){ return w.slowed; }};",
    "let resumeSlow = false, escapeThrottle = false, govLead = null, guardEdgeAt = 0; const EDGE_REASSESS_MS = 2000;",
    "const indexedRoute = () => w.indexed ? w.route : null, speedRole = () => 'transit', roleSpeed = () => w.job || '7', leadSpeedKey = () => null;",
    "const isStepKey = (k) => /^\\d+$/.test(String(k));",
    "const turnSeg = [], curTurn = -1, mission = {lines: []}, cornerSlowFor = -1, cornerSlow = new Set();",
    "const commandSpeed = (k) => { w.sent.push(k); w.speedKey = k; }, showBanner = (t) => w.banners.push(t), flashNote = (t) => w.notes.push(t);",
    "const logClient = (k, d) => w.logs.push([k, d]);",
    "const spdTxt = (k) => (/^\\d+$/.test(String(k)) ? V.SPEED_KN[k] + ' kn' : String(k)), fmtDist = (m) => Math.round(m) + ' m';",
    "const slowLaw = () => null, slowLeadM = () => 0, SPEED_CMD_LATENCY_S = 1;",
    "const {zoneDecision, zoneLeadM, zoneRuleTxt, zoneId, zoneApplies, noaaZones, inZone} = Z;",
    "let commandedSpeed = null, zoneHeld = null, zoneRestore = null, zonesFor = null, zonesList = []; const zoneSaid = new Set();",
    ["speedZonesNow", "zoneCap", "zoneSpd", "zoneName", "zoneTrack", "zoneOnlyGovern", "speedGovernor"].map(grab).join("\n"),
    "return {tick: () => { asv = w.pos; return speedGovernor(); }, held: () => zoneHeld};",
  ].join("\n");
  w.api = new Function("w", "Z", src)(w, Z);
  return w;
};
{
  const G = gov();
  const t0 = G.api.tick();                                    // 600 m short: nothing yet, the job's 7
  G.pos = at(-15, 200); const t1 = G.api.tick();              // 15 m short at 7 kn: inside the lead (20 m + latency) - slow now
  G.pos = at(-5, 200); const t1b = G.api.tick();              // 5 m short: still AHEAD - never "leaving" on the way in (live)
  G.pos = at(200, 200); const t2 = G.api.tick();              // in it: still 5, nothing said again
  const bannersIn = G.banners.length;
  G.pos = at(405, 200); const t3 = G.api.tick();              // 5 m out: still clearing it
  G.pos = at(420, 200); const t4 = G.api.tick();              // 20 m out: clear - the job's 7 back
  check("5. THE GOVERNOR LOWERS TO THE ZONE AND GIVES IT BACK: 600 m short the job's 7 kn; inside the lead, 15 m short, "
        + "5 kn commanded - said once, before it; 5 m short still 'ahead' (not 'leaving', as the first cut said live); in it "
        + "5 kn and nothing said again; 5 m out still 5 kn; clear by her "
        + "length the job's 7 kn back, said; each logged",
        () => t0 === "7" && t1 === "5" && t1b === "5" && t2 === "5" && t3 === "5" && t4 === "7"
              && JSON.stringify(G.sent) === '["7","5","7"]' && bannersIn === 1
              && /^SPEED ZONE AHEAD - Test limit \(TEST\): 5 kn\. Slowing to 5 kn now, \d+ m before it, so she is at it on its edge; 7 kn comes back when she is clear of it\.$/.test(G.banners[0])
              && /^CLEAR OF SPEED ZONE Test limit \(TEST\): back to 7 kn, her commanded speed\.$/.test(G.banners[G.banners.length - 1])
              && G.logs.filter((l) => l[0] === "speed_zone").map((l) => l[1].state).join(",") === "ahead,in,leaving,clear",
        () => JSON.stringify({ t: [t0, t1, t2, t3, t4], sent: G.sent, banners: G.banners, logs: G.logs.map((l) => l[1].state) }));
  // a zone FASTER than her job: never raised, and said so (her speed is within it)
  const F = gov({ zones: [zone("limit", 10)] });
  F.pos = at(200, 200); const f1 = F.api.tick();
  check("5b. A ZONE NEVER RAISES HER: a 10 kn zone with the job at 7 - 7 commanded, and the banner says her 7 kn is "
        + "within it",
        () => f1 === "7" && JSON.stringify(F.sent) === '["7"]' && /Her 7 kn is within it\./.test(F.banners[0] || ""),
        () => JSON.stringify({ f1, sent: F.sent, b: F.banners }));
  // the guard's slow-down owns the throttle: the zone does not command over it
  const GS = gov({ slowed: true }); GS.pos = at(200, 200); const g1 = GS.api.tick();
  // a page that cannot say her leg: in the zone her 7 is taken to 5, and put back when she is clear
  const NR = gov({ indexed: false }); NR.pos = at(200, 200); const n1 = NR.api.tick(); const nIn = NR.speedKey;
  NR.pos = at(430, 200); const n2 = NR.api.tick();
  check("5c. THE GUARD'S SLOW-DOWN is left alone (nothing commanded); a page that cannot say her leg still caps her by "
        + "position - 7 to 5 in the zone - and puts her 7 back when she is clear",
        () => g1 === null && GS.sent.length === 0 && n1 === "5" && nIn === "5" && n2 === "7" && JSON.stringify(NR.sent) === '["5","7"]',
        () => JSON.stringify({ g1, gsent: GS.sent, n1, n2, nsent: NR.sent }));
  // THE CHART'S OWN ZONE reaches the governor: a restricted area whose text is the Kittery citation, served as the chart
  // serves it (role "restricted", INFORM) - not as a speed_zone - takes her 7 to 4 (4.3 kn allowed) in it
  const CH = gov({ zones: [{ role: "restricted", geometry: Z5.geometry, props: { INFORM: KIT } }] });
  CH.pos = at(200, 200); const c1 = CH.api.tick();
  check("5e. THE CHART'S OWN ZONE REACHES THE GOVERNOR: the Kittery area as the chart serves it (a restricted area, its "
        + "citation in its text) takes her 7 kn to 4 kn - the fastest at or under 4.3",
        () => c1 === "4" && JSON.stringify(CH.sent) === '["4"]' && /33 CFR 165\.101 regulated area \(NOAA ENC\): 4\.3 kn/.test(CH.banners[0] || ""),
        () => JSON.stringify({ c1, sent: CH.sent, b: CH.banners }));
  // THE JOB'S OWN SPEED COMES DOWN TO IT MID-ZONE (measured live: the arrival's slow-down took over inside the zone and a
  // second banner said "her low is within it"): logged, not said; the job back up - the zone takes her again, said
  const J = gov(); J.pos = at(200, 200); J.api.tick();        // in it at 7: held at 5
  const nb = J.banners.length;
  J.job = "low"; const j1 = J.api.tick();                    // the job's own speed now 4: the zone no longer lowers it
  const nb2 = J.banners.length;
  J.job = "7"; const j2 = J.api.tick();                      // the job back to 7: the zone takes it again
  check("5f. MID-ZONE, THE JOB'S OWN SPEED COMING UNDER THE ZONE'S is logged and NOT said (no 'her low is within it'); "
        + "the job back up, the zone takes her again and says so - naming a named speed with its knots",
        () => nb === 1 && j1 === "low" && nb2 === 1 && j2 === "5" && J.banners.length === 2 && /Held at 5 kn/.test(J.banners[1])
              && J.logs.some((l) => l[1].capping === false && l[1].state === "in"),
        () => JSON.stringify({ nb, j1, nb2, j2, banners: J.banners }));
  // A NAMED SPEED IS SAID WITH ITS KNOTS: the job at "survey" (7 kn) capped to 5 and given back - "survey (7 kn)", not "survey"
  const N = gov({ job: "survey" }); N.pos = at(200, 200); N.api.tick(); N.pos = at(420, 200); N.api.tick();
  check("5g. A NAMED SPEED IS SAID WITH ITS KNOTS - the job at survey: '...; survey (7 kn) comes back when she is clear of "
        + "it', and 'back to survey (7 kn)'",
        () => /; survey \(7 kn\) comes back when she is clear of it\.$/.test(N.banners[0] || "")
              && /back to survey \(7 kn\), her commanded speed\.$/.test(N.banners[1] || ""),
        () => JSON.stringify(N.banners));
  // a zone that does not bind the hull: said once, her speed untouched
  const SK = gov({ zones: [SMAZ] }); SK.pos = at(200, 200); const s1 = SK.api.tick(); SK.api.tick();
  check("5d. A ZONE THAT DOES NOT BIND HER (a 65 ft rule, the DriX 7.7 m) is said ONCE and her speed left as the job has it",
        () => s1 === "7" && SK.notes.filter((n) => /not for this hull: it binds vessels 19\.8 m/.test(n)).length === 1 && SK.banners.length === 0,
        () => JSON.stringify({ s1, notes: SK.notes }));
}

console.log("\n" + (fails ? fails + " CHECK(S) FAILED" : "all checks passed") + " (" + ran + ")");
process.exit(fails ? 1 : 0);
