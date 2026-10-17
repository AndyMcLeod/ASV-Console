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
//   6-6j  NEW HAMPSHIRE'S AND MAINE'S SHORE RULES (lawZones, 2026-10-16: "model the NH and ME shore distance rules"):
//         150 ft of New Hampshire's shore and docks, not in the Piscataqua's federal channel between R2 and R12; 200 ft
//         of Maine's shoreline, island or mainland, not its docks; each in its own state's water; New Hampshire's
//         bridges; the edge and her release; the stricter rule where no state line was read; the shore index against
//         brute force; a zone she is slowing for kept ahead (live: "Clear of speed zone" of water not reached); the
//         governor end to end.
//   7-7e  MASSACHUSETTS (2026-10-16: "model the MA shore distance rules"; asked, "Headway in every MA channel"): 150 ft of
//         a marina, launch or float as the chart publishes them; headway in every channel not named an anchorage, in
//         its own water; under a bridge; six miles per hour at most; its line unread; the governor through a channel.
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
    "const {zoneDecision, zoneLeadM, zoneRuleTxt, zoneId, zoneApplies, noaaZones, inZone, lawZones} = Z;",
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

// ── 6. New Hampshire's and Maine's shore-distance rules (lawZones) ───────────────────────────────────────────────────
// A chart of its own just inside the Piscataqua (between buoys R2 and R12, where New Hampshire's exemption lives), in
// meters east / north of 43.08 N, 70.74 W: an island and its pier in New Hampshire's water; the federal channel past the
// island's north-east corner, a deep dredged reach off its south shore and a shallow side channel off its west; a bridge
// each side of the line; an island, its pier and an islet in Maine's water east of e = 1000, where the state line runs.
const GM = require(path.join(APP, "static", "js", "geometry.js"));
const FL = GD.planeFrame({ lat: 43.08, lon: -70.74 });
const PL = (e, n) => { const p = FL.fromEN(e, n); return [p.lon, p.lat]; };
const rectL = (e0, n0, e1, n1, P = PL) => ({ type: "Polygon", coordinates: [[P(e0, n0), P(e1, n0), P(e1, n1), P(e0, n1), P(e0, n0)]] });
const lineL = (pts, P = PL) => ({ type: "LineString", coordinates: pts.map(([e, n]) => P(e, n)) });
const NHW = { role: "state_water", geometry: rectL(-5000, -8000, 1000, 8000), props: { state: "NH", source: "TEST", unread: [] } };
const MEW = { role: "state_water", geometry: rectL(1000, -8000, 6000, 8000), props: { state: "ME", source: "TEST", unread: [] } };
const CHART = [
  { role: "land", geometry: rectL(0, 0, 400, 400) },                                                   // New Hampshire's island
  { role: "dock_line", geometry: lineL([[400, 100], [470, 100]]) },                                     // its pier, 70 m east
  { role: "fairway", geometry: rectL(430, 300, 800, 1000), props: { OBJNAM: "Piscataqua River Channel" } },
  { role: "dredged", geometry: rectL(0, -300, 400, -10), props: { OBJNAM: "Test Reach", DRVAL1: 10 } },
  { role: "dredged", geometry: rectL(-300, 0, -10, 400), props: { OBJNAM: "Back Channel", DRVAL1: 1.8 } },
  { role: "bridge_span", geometry: rectL(-200, 600, -150, 700), props: { OBJNAM: "Test Bridge" } },
  { role: "bridge_span", geometry: rectL(2500, 600, 2550, 700), props: { OBJNAM: "Maine Bridge" } },
  { role: "land", geometry: rectL(1600, 0, 2000, 400) },                                               // Maine's island
  { role: "dock_line", geometry: lineL([[1600, 100], [1530, 100]]) },                                   // its pier, 70 m west
  { role: "land_point", geometry: { type: "Point", coordinates: PL(3000, 0) } },                        // an islet
];
const LZ = Z.lawZones([NHW, MEW, ...CHART]);
const lz = (id) => LZ.find((z) => z.props.zone_id === id);
const NHZ = lz("law|NH|shore"), MEZ = lz("law|ME|shore");
const inL = (z, e, n) => !!z && Z.inZone(FL.fromEN(e, n), z);
const w6 = { east30: inL(NHZ, 430, 250), east50: inL(NHZ, 450, 250), pier30: inL(NHZ, 500, 100), pier50: inL(NHZ, 520, 100),
  channel40: inL(NHZ, 440, 350), reach30: inL(NHZ, 200, -30), back40: inL(NHZ, -40, 200), maine: inL(NHZ, 1550, 250) };
check("6. NEW HAMPSHIRE, 150 FT (45.72 m) OF SHORE AND DOCKS: 30 m off the island in, 50 m out; 30 m off the pier's end in, "
      + "50 m out; NOT in the federal channel 40 m off, nor in the deep reach 30 m off (RSA 270-D:2 VI(b)(2)); in the shallow "
      + "side channel 40 m off (not the federal channel); not in Maine's water; headway, cited",
      () => NHZ && w6.east30 && !w6.east50 && w6.pier30 && !w6.pier50 && !w6.channel40 && !w6.reach30 && w6.back40 && !w6.maine
            && NHZ.props.rule === "headway" && NHZ.props.source === "NH RSA 270-D:2 VI" && Math.abs(Z.NH_SHORE_M - 45.72) < 1e-9,
      () => JSON.stringify(w6));
const w6b = { west50: inL(MEZ, 1550, 250), west70: inL(MEZ, 1530, 250), pier50: inL(MEZ, 1480, 100), islet50: inL(MEZ, 3000, 50),
  islet70: inL(MEZ, 3000, 70), nh: inL(MEZ, 430, 250) };
check("6b. MAINE, 200 FT (60.96 m) OF SHORELINE, mainland or island: 50 m off the island in, 70 m out; 50 m off an islet in, "
      + "70 m out; 50 m off the pier's end (120 m off the island) NOT in - a dock is not shoreline in Maine's law; not in New "
      + "Hampshire's water; headway, cited",
      () => MEZ && w6b.west50 && !w6b.west70 && !w6b.pier50 && w6b.islet50 && !w6b.islet70 && !w6b.nh
            && MEZ.props.rule === "headway" && MEZ.props.source === "ME 12 MRSA 13068-A(13)" && Math.abs(Z.ME_SHORE_M - 60.96) < 1e-9,
      () => JSON.stringify(w6b));
const e6c = { at30: Z.zoneEdgeM(FL.fromEN(430, 250), NHZ), at80: Z.zoneEdgeM(FL.fromEN(480, 250), NHZ), far: Z.zoneEdgeM(FL.fromEN(600, 250), NHZ),
  channel: Z.zoneEdgeM(FL.fromEN(440, 350), NHZ) };
const decL = (e, n, held) => Z.zoneDecision({ pos: FL.fromEN(e, n), ahead: [], zones: LZ, loaM: 7.71, speedsKn: DRIX, leadM: 50, held });
const heldIn = { id: "law|NH|shore", where: "in" };
const d6c = { leaving: decL(453, 250, heldIn), clear: decL(460, 250, heldIn), inKey: decL(430, 250, null) };
check("6c. ITS EDGE AND HER RELEASE: 30 m off is 15.7 m inside the line, 80 m off 34.3 m outside it, 200 m off measured as "
      + "far, and in the channel no edge at all; leaving it she is held to headway (the DriX's 4) until clear of the line by "
      + "her length - 53 m off still 'leaving', 60 m off clear",
      () => Math.abs(e6c.at30 - 15.72) < 0.01 && Math.abs(e6c.at80 - 34.28) < 0.01 && e6c.far === Infinity && e6c.channel === Infinity
            && d6c.leaving && d6c.leaving.where === "leaving" && d6c.leaving.key === "4" && d6c.clear === null
            && d6c.inKey && d6c.inKey.where === "in" && d6c.inKey.kn === 4,
      () => JSON.stringify({ e6c, leaving: d6c.leaving && d6c.leaving.where, clear: d6c.clear }));
const BR = lz("law|NH|bridge|Test Bridge");
check("6d. NEW HAMPSHIRE'S BRIDGES, headway passing under (RSA 270-D:2 I): the bridge in its water is a zone, under it is in "
      + "it; the bridge in Maine's water is not one",
      () => BR && BR.geometry && Z.inZone(FL.fromEN(-175, 650), BR) && !Z.inZone(FL.fromEN(-175, 750), BR) && BR.props.source === "NH RSA 270-D:2 I"
            && !LZ.some((z) => /Maine Bridge/.test(z.props.zone_id)),
      () => JSON.stringify(LZ.map((z) => z.props.zone_id)));
// the exemption is the federal channel BETWEEN R2 and R12: the same fairway 5 km off their line is not it; dredged at 8 m
// and deeper is, at 7.9 m it is not; a side channel's fairway by another name is not
const shift = (dn) => (e, n) => PL(e, n + dn);
const R2E = FL.toEN(Z.PISCATAQUA_R2), R12E = FL.toEN(Z.PISCATAQUA_R12);
// on their line 1 km past R12 - inside the corridor's 1.5 km of their line, so only 'between' keeps it out
const PAST = 1000 / Math.hypot(R12E.e - R2E.e, R12E.n - R2E.n);
const BEYOND = { e: R12E.e + PAST * (R12E.e - R2E.e), n: R12E.n + PAST * (R12E.n - R2E.n) };
const EX = Z.piscataquaExempt([
  { role: "fairway", geometry: rectL(0, 0, 100, 100), props: { OBJNAM: "Piscataqua River Channel" } },
  { role: "fairway", geometry: rectL(0, 0, 100, 100, shift(-5000)), props: { OBJNAM: "Piscataqua River Channel" } },
  { role: "dredged", geometry: rectL(200, 0, 300, 100), props: { DRVAL1: 8 } },
  { role: "dredged", geometry: rectL(400, 0, 500, 100), props: { DRVAL1: 7.9 } },
  { role: "fairway", geometry: rectL(600, 0, 700, 100), props: { OBJNAM: "Sagamore Creek Channel" } },
  { role: "fairway", geometry: rectL(BEYOND.e - 50, BEYOND.n - 50, BEYOND.e + 50, BEYOND.n + 50), props: { OBJNAM: "Piscataqua River Channel" } },
], FL);
check("6e. THE EXEMPTION IS THE FEDERAL CHANNEL BETWEEN R2 AND R12: the Piscataqua River Channel fairway on their line and a "
      + "reach dredged to 8 m are it; the same fairway 5 km off their line, or on it 1 km past R12, a reach dredged to 7.9 m and "
      + "a side channel are not",
      () => EX.length === 2 && EX.some((r) => r.bb.x0 < 50) && EX.some((r) => r.bb.x0 > 150 && r.bb.x0 < 250),
      () => JSON.stringify(EX.map((r) => [Math.round(r.bb.x0), Math.round(r.bb.y0)])));
const FAR = (e, n) => PL(e, n - 300000);                      // 300 km south, off New Jersey: no state's box
const LF = Z.lawZones([...CHART, { role: "land", geometry: rectL(0, 0, 400, 400, FAR) }]);   // no state line read at all
const NHonly = Z.lawZones([Object.assign({}, NHW, { props: { state: "NH", unread: ["ME"] } }), ...CHART]);   // Maine's unread
const AWAY = Z.lawZones(CHART.map((f) => Object.assign({}, f, { geometry: JSON.parse(JSON.stringify(f.geometry, (k, v) =>
  Array.isArray(v) && typeof v[0] === "number" ? [v[0] - 10, v[1] - 17] : v)) })));
const anyIn = (zs, e, n) => zs.some((z) => Z.inZone(FL.fromEN(e, n), z));
const zIn = (zs, id, e, n) => { const z = zs.find((x) => x.props.zone_id === id); return !!z && Z.inZone(FL.fromEN(e, n), z); };
const w6f = { named: LF.filter((z) => /^law\|(NH|ME)\|shore$/.test(z.props.zone_id)).map((z) => z.props.name),
  pier: zIn(LF, "law|NH|shore", 500, 100), channel: zIn(LF, "law|ME|shore", 440, 350), channelNH: zIn(LF, "law|NH|shore", 440, 350),
  mePier: anyIn(LF, 1480, 100), at55: zIn(LF, "law|ME|shore", 455, 250), far30: anyIn(LF, 430, 250 - 300000),
  one: { meWest: zIn(NHonly, "law|ME|shore", 1550, 250), mePier: anyIn(NHonly, 1480, 100), nhChannel: anyIn(NHonly, 440, 350),
         nhEast: zIn(NHonly, "law|NH|shore", 430, 250), meAtNh: zIn(NHonly, "law|ME|shore", 430, 250),
         nhName: (NHonly.find((z) => z.props.zone_id === "law|NH|shore") || { props: {} }).props.name },
  away: AWAY.length, noShore: Z.lawZones([NHW, MEW]).length };
check("6f. A STATE LINE NOT READ, THAT STATE'S RULES IN ITS BOX (safety before efficiency): with no line read, New "
      + "Hampshire's AND Maine's rules both hold where the water could be either's, each named for the unread line - off "
      + "New Hampshire's pier (its docks rule) in, in the channel 40 m off the island in by Maine's 200 ft (New Hampshire's "
      + "exemption still its own), 55 m off in by Maine's, off Maine's pier in by neither (Maine counts no docks, New "
      + "Hampshire's 150 ft is short of it); a shore off New Jersey is in no state's box; with Maine's line unread, its rule "
      + "holds off its island but not in New Hampshire's read water, whose own rule and exemption stand; the same chart off "
      + "Florida, and a chart with no shore, make none",
      () => w6f.named.length === 2 && w6f.named.every((n) => /\(the state line could not be read\)$/.test(n))
            && w6f.pier && w6f.channel && !w6f.channelNH && !w6f.mePier && w6f.at55 && !w6f.far30
            && w6f.one.meWest && !w6f.one.mePier && !w6f.one.nhChannel && w6f.one.nhEast && !w6f.one.meAtNh
            && !/could not be read/.test(w6f.one.nhName) && w6f.away === 0 && w6f.noShore === 0,
      () => JSON.stringify(w6f));
// the shore index against brute force: long diagonal edges (one each way across many cells), short ones, points
{
  const segs = [], feats = [];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 40; i++) {
    const a = [rnd() * 3000 - 1500, rnd() * 3000 - 1500], L = i < 10 ? 2000 : 30, t = rnd() * Math.PI * 2;
    const b = [a[0] + L * Math.cos(t), a[1] + L * Math.sin(t)];
    feats.push({ role: "shore_line", geometry: lineL([a, b]) }); segs.push([FL.toEN(FL.fromEN(...a)), FL.toEN(FL.fromEN(...b))]);
  }
  for (let i = 0; i < 10; i++) { const p = [rnd() * 3000 - 1500, rnd() * 3000 - 1500]; feats.push({ role: "land_point", geometry: { type: "Point", coordinates: PL(...p) } });
    const q = FL.toEN(FL.fromEN(...p)); segs.push([q, q]); }
  const M = Z.shoreModel(feats, ["shore_line", "land_point"], FL);
  let worst = 0, n = 0, near = 0;
  for (let i = 0; i < 600; i++) {
    const q = { e: rnd() * 3400 - 1700, n: rnd() * 3400 - 1700 };
    let b = Infinity; for (const s of segs) b = Math.min(b, GM.dSeg(q, s[0], s[1]));
    const want = b <= 120 ? b : Infinity, got = Z.shoreDistM(M, q, 120);
    n++; if (want < Infinity) near++;
    worst = Math.max(worst, want === got ? 0 : Math.abs(want - got));
  }
  check("6g. THE SHORE INDEX AGAINST BRUTE FORCE: 600 points round 40 edges (ten of them 2 km across the grid) and 10 "
        + "points - the nearest within 120 m found exactly every time, Infinity beyond",
        () => worst < 1e-6 && near > 40, () => JSON.stringify({ n, near, worst }));
}
// THE ZONE SHE IS SLOWING FOR stays AHEAD however short her slowing makes the lead (live 2026-10-16)
{
  const heldA = { id: Z.zoneId(Z5), where: "ahead", d: 30 };
  const h = { kept: dec(at(-28, 200), { leadM: 10, held: heldA }), unheld: dec(at(-28, 200), { leadM: 10 }),
              away: dec(at(-28, 200), { leadM: 10, held: heldA, ahead: [at(-28, -600)] }),
              later: dec(at(-28, 200), { leadM: 10, held: heldA, ahead: [at(-28, -300), at(200, -300), at(200, 200)] }) };
  check("6h. A ZONE SHE IS SLOWING FOR STAYS AHEAD: held ahead at 30 m, 28 m short with her lead down to 10 m it is still "
        + "ahead (not let go and taken again); not held, it is not yet; held, with her route turned away, it is let go - and "
        + "with her route meeting it again only ~800 m on",
        () => h.kept && h.kept.where === "ahead" && h.kept.kn === 5 && h.unheld === null && h.away === null && h.later === null,
        () => JSON.stringify(Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v && [v.where, Math.round(v.d)]]))));
}
// THE GOVERNOR over a chart of its own: the island north of her line (the line 30 m off its south shore), in New Hampshire
{
  const PG = (e, n) => { const p = at(e, n); return [p.lon, p.lat]; };
  const LAWG = [{ role: "state_water", geometry: rectL(-5000, -5000, 5000, 5000, PG), props: { state: "NH", unread: [] } },
                { role: "land", geometry: rectL(100, 230, 500, 600, PG) }];
  const L = gov({ zones: LAWG });
  const g0 = L.api.tick();                                     // 600 m short
  L.pos = at(30, 200); const g1 = L.api.tick();                // the band ~35 m on, past her 23.6 m lead at 7 kn
  L.pos = at(50, 200); const g2 = L.api.tick();                // ~15 m on: inside the lead - headway now
  L.pos = at(300, 200); const g3 = L.api.tick();               // in it, 30 m off the shore
  L.pos = at(545, 200); const g4 = L.api.tick();               // 54 m off the corner: out, not yet clear by her length
  L.pos = at(560, 200); const g5 = L.api.tick();               // 67 m off: clear
  check("6i. THE GOVERNOR AND NEW HAMPSHIRE'S SHORE: the job's 7 kn until the band is inside her lead; then headway (the "
        + "DriX's 4) before it, said with the law it is; held in it; held leaving it; the job's 7 back when clear, said",
        () => g0 === "7" && g1 === "7" && g2 === "4" && g3 === "4" && g4 === "4" && g5 === "7"
              && /^SPEED ZONE AHEAD - New Hampshire, within 150 ft of shore or a dock \(NH RSA 270-D:2 VI\): headway speed\. Slowing to 4 kn now/.test(L.banners[0] || "")
              && /^CLEAR OF SPEED ZONE New Hampshire, within 150 ft of shore or a dock \(NH RSA 270-D:2 VI\): back to 7 kn, her commanded speed\.$/.test(L.banners[1] || "")
              && L.banners.length === 2,
        () => JSON.stringify({ g: [g0, g1, g2, g3, g4, g5], banners: L.banners }));
  // slowing for it, her lead shrinks past what is left - the zone held, nothing said; then her way turned from it - said so
  const K = gov({ zones: LAWG, sog: 12 });
  K.pos = at(42, 200); const k1 = K.api.tick();                // the band 25 m on, her lead 26 m at 12 kn: headway now
  K.sog = 1; K.pos = at(44, 200); const k2 = K.api.tick();     // slowed: her lead 20.5 m, the band 25 m on - still held
  const nb = K.banners.length, nn = K.notes.length;
  K.route = [at(-600, 200), at(44, -600)]; const k3 = K.api.tick();   // a new way, south, away from it
  const Q = gov({ zones: LAWG, sog: 12, job: "4" });
  Q.pos = at(42, 200); Q.api.tick(); const qb = Q.banners.length;
  Q.route = [at(-600, 200), at(42, -600)]; Q.api.tick();
  check("6j. A BAND SHE IS SLOWING FOR IS NOT LET GO AS SHE SLOWS (her lead under what is left: still 4, nothing said - live, "
        + "the page said 'Clear of speed zone' there); her way turned from it, the job's 7 back and said as what happened - "
        + "'no longer on her way', not 'clear'; one she came to at a speed within it, her way turned from it - nothing said",
        () => k1 === "4" && k2 === "4" && nb === 1 && nn === 0 && k3 === "7" && qb === 1 && Q.banners.length === 1 && Q.notes.length === 0
              && /^SPEED ZONE New Hampshire, within 150 ft of shore or a dock \(NH RSA 270-D:2 VI\) is no longer on her way: back to 7 kn, her commanded speed\.$/.test(K.banners[1] || "")
              && !K.notes.some((t) => /Clear of speed zone/.test(t)),
        () => JSON.stringify({ k: [k1, k2, k3], banners: K.banners, notes: K.notes, q: [Q.banners, Q.notes] }));
}

// ── 7. Massachusetts' rules (lawZones, 2026-10-16: "model the MA shore distance rules"; asked, "Headway in every MA
// channel") ──────────────────────────────────────────────────────────────────────────────────────────────────────────
// A chart of its own off Gloucester, in meters east / north of 42.61 N, 70.66 W, all in Massachusetts' water: an island;
// a row of facilities 300 m apart along n = 1000 (each as ENCDirect publishes it, measured at Gloucester, Boston,
// Scituate and Hyannis); a row of channel pieces along n = -800; a bridge.
const FMA = GD.planeFrame({ lat: 42.61, lon: -70.66 });
const PM = (e, n) => { const p = FMA.fromEN(e, n); return [p.lon, p.lat]; };
const ptM = (e, n) => ({ type: "Point", coordinates: PM(e, n) });
const MAW = { role: "state_water", geometry: rectL(-5000, -5000, 5000, 5000, PM), props: { state: "MA", source: "TEST", unread: [], asked: ["MA"] } };
const fac = (cls, role, geometry, props) => ({ role, cls, geometry, props: props || {} });
const MA_CHART = [
  { role: "land", geometry: rectL(0, 0, 400, 400, PM) },
  fac("Small_Craft_Facility_point", "extra", ptM(0, 1000), { CATSCF: "sewerage pump-out station" }),
  fac("Harbour_Facility_point", "extra", ptM(300, 1000), { CATHAF: "yacht harbor", OBJNAM: "Test Yacht Club" }),
  fac("Harbour_Facility_point", "extra", ptM(600, 1000), { CATHAF: "ferry terminal" }),
  fac("Harbour_Facility_point", "extra", ptM(900, 1000)),                                  // a tile read before: no category
  fac("Shoreline_Construction_point", "hazard_point", ptM(1200, 1000), { CATSLC: "ramp" }),
  fac("Shoreline_Construction_point", "hazard_point", ptM(1500, 1000), { CATSLC: "pier" }),
  fac("Shoreline_Construction_point", "hazard_point", ptM(1800, 1000)),                    // no category: not known a ramp
  fac("Shoreline_Construction_line", "dock_line", lineL([[2100, 1000], [2150, 1000]], PM), { CATSLC: "slipway" }),
  fac("Floating_Dock_line", "dock_line", lineL([[2400, 1000], [2450, 1000]], PM)),
  fac("Harbour_Facility_area", "extra", rectL(3000, 800, 3400, 1200, PM), { CATHAF: "yacht harbor" }),
  { role: "fairway", geometry: rectL(0, -1000, 400, -600, PM), props: { OBJNAM: "Inner Harbor Channel" } },
  { role: "dredged", geometry: rectL(100, -900, 300, -700, PM), props: { OBJNAM: "Overlap Reach", DRVAL1: 5 } },
  { role: "dredged", geometry: rectL(600, -1000, 1000, -600, PM), props: { OBJNAM: "Smith Cove Channel", DRVAL1: 3.5 } },
  { role: "dredged", geometry: rectL(1200, -1000, 1600, -600, PM), props: { OBJNAM: "Harbor Cove Anchorage", DRVAL1: 4.3 } },
  { role: "fairway", geometry: rectL(1800, -1000, 2200, -600, PM), props: { OBJNAM: "Scituate Harbor Anchorage Area" } },
  { role: "dredged", geometry: rectL(2400, -1000, 2800, -600, PM), props: { DRVAL1: 4.2 } },
  { role: "fairway", geometry: { type: "Polygon", coordinates: [rectL(3000, -1000, 3600, -400, PM).coordinates[0],
                                                                rectL(3200, -800, 3400, -600, PM).coordinates[0]] }, props: { OBJNAM: "Holed Channel" } },
  { role: "bridge_span", geometry: rectL(-300, 600, -250, 700, PM), props: { OBJNAM: "Test MA Bridge" } },
];
const MZ = Z.lawZones([MAW, ...MA_CHART]);
const mz = (id) => MZ.find((z) => z.props.zone_id === id);
const FACZ = mz("law|MA|facility"), CHZ = mz("law|MA|channel"), BRZ = mz("law|MA|bridge|Test MA Bridge");
const inM = (z, e, n) => !!z && Z.inZone(FMA.fromEN(e, n), z);
const w7 = { pumpout30: inM(FACZ, 0, 1030), pumpout60: inM(FACZ, 0, 1060), yacht30: inM(FACZ, 300, 1030), ferry30: inM(FACZ, 600, 1030),
  uncatHarbor30: inM(FACZ, 900, 1030), ramp30: inM(FACZ, 1200, 1030), pier30: inM(FACZ, 1500, 1030), uncatSlcons30: inM(FACZ, 1800, 1030),
  slipway30: inM(FACZ, 2125, 1030), float30: inM(FACZ, 2425, 1030), inMarina: inM(FACZ, 3200, 1000), marina30: inM(FACZ, 3200, 1230),
  shore30: MZ.some((z) => inM(z, 430, 200)), only: MZ.every((z) => /^law\|MA\|/.test(z.props.zone_id)) };
check("7. MASSACHUSETTS, 150 FT OF A MARINA, BOAT LAUNCH OR FLOAT (323 CMR 2.07(3)(b)): 30 m off a small-craft facility in, "
      + "60 m out; a yacht harbor in, a ferry terminal not; a harbor facility with no category in (a tile read before - the "
      + "safe side); a ramp, a slipway and a floating dock in; a pier and an uncategorized shoreline construction not; inside "
      + "a marina's own area, 200 m from its edge, in; and no rule off a plain shore in Massachusetts - nor any other state's",
      () => FACZ && w7.pumpout30 && !w7.pumpout60 && w7.yacht30 && !w7.ferry30 && w7.uncatHarbor30 && w7.ramp30 && !w7.pier30
            && !w7.uncatSlcons30 && w7.slipway30 && w7.float30 && w7.inMarina && w7.marina30 && !w7.shore30 && w7.only
            && FACZ.props.source === "MA 323 CMR 2.07(3)(b)" && FACZ.props.rule === "headway",
      () => JSON.stringify(w7));
// the same channels with Massachusetts' line stopping at e = 500: Smith Cove beyond it is not Massachusetts' water
const MZcut = Z.lawZones([Object.assign({}, MAW, { geometry: rectL(-5000, -5000, 500, 5000, PM) }), ...MA_CHART]);
const CHcut = MZcut.find((z) => z.props.zone_id === "law|MA|channel");
const w7b = { fairway: inM(CHZ, 50, -650), overlap: inM(CHZ, 200, -800), dredged: inM(CHZ, 800, -800), anchorageD: inM(CHZ, 1400, -800),
  anchorageF: inM(CHZ, 2000, -800), unnamed: inM(CHZ, 2600, -800), hole: inM(CHZ, 3300, -700), ring: inM(CHZ, 3100, -900),
  between: inM(CHZ, 500, -800), cutIn: inM(CHcut, 200, -800), cutOut: inM(CHcut, 800, -800),
  drawn: CHZ && CHZ.geometry && CHZ.geometry.type === "MultiPolygon" && CHZ.geometry.coordinates.length === 5 };
check("7b. MASSACHUSETTS, HEADWAY IN A CHANNEL (323 CMR 2.07(3)(d) - every one: a posted speed cannot be read): in a fairway, "
      + "in a dredged channel, in two pieces that overlap, in an unnamed dredged area; not in a dredged area or a fairway named "
      + "as an anchorage, not in a channel's hole, not between channels; not where the channel runs out of Massachusetts' "
      + "water; drawn as the channels' own outlines",
      () => CHZ && w7b.fairway && w7b.overlap && w7b.dredged && !w7b.anchorageD && !w7b.anchorageF && w7b.unnamed && !w7b.hole
            && w7b.ring && !w7b.between && w7b.cutIn && !w7b.cutOut && w7b.drawn && CHZ.props.source === "MA 323 CMR 2.07(3)(d)",
      () => JSON.stringify(w7b));
const k7 = { drix: Z.zoneKey(CHZ, DRIX), six: Z.zoneKey(CHZ, { 6: 6, 8: 8 }), nhSix: Z.zoneKey(NHZ, { 6: 6, 8: 8 }) };
const e7 = { between: Z.zoneEdgeM(FMA.fromEN(500, -800), CHZ), out30: Z.zoneEdgeM(FMA.fromEN(430, -800), CHZ),
  marina: Z.zoneEdgeM(FMA.fromEN(3200, 1000), FACZ) };
check("7c. UNDER A BRIDGE (2.07(3)(a)) a zone; MASSACHUSETTS' HEADWAY IS SIX MILES PER HOUR AT MOST (2.02): every one of its "
      + "zones says 5.2 kn, the DriX's 4 is within it, a hull whose slowest is 6 kn is said over it (New Hampshire's headway "
      + "has no number: not said over); a channel's edge measured from outside it (100 m between two, 30 m off one), and a "
      + "marina's from inside its area (the rule's 45.7 m beyond its 200 m)",
      () => BRZ && inM(BRZ, -275, 650) && !inM(BRZ, -275, 750) && BRZ.props.source === "MA 323 CMR 2.07(3)(a)"
            && MZ.every((z) => z.props.max_kn === 5.2) && k7.drix.key === "4" && !k7.drix.below && k7.six.below && !k7.nhSix.below
            && Math.abs(e7.between - 100) < 0.5 && Math.abs(e7.out30 - 30) < 0.5 && Math.abs(e7.marina - 245.72) < 0.5,
      () => JSON.stringify({ k7, e7, ids: MZ.map((z) => z.props.zone_id) }));
// MASSACHUSETTS' LINE UNREAD: no line at all, the chart in its box - its rules in its box, said; and named unread by the
// server beside a line read elsewhere - its rules there, not in the water read
const MU = Z.lawZones(MA_CHART);
const MU2 = Z.lawZones([{ role: "state_water", geometry: rectL(-5000, -5000, 500, 5000, PM), props: { state: "NH", unread: ["MA"] } }, ...MA_CHART]);
const w7d = { n: MU.length, named: MU.every((z) => /\(the state line could not be read\)$/.test(z.props.name)), chan: MU.some((z) => inM(z, 800, -800)),
  ramp: MU.some((z) => inM(z, 1200, 1030)), u2out: MU2.some((z) => /^law\|MA/.test(z.props.zone_id) && inM(z, 200, -800)),
  u2in: MU2.some((z) => /^law\|MA/.test(z.props.zone_id) && inM(z, 800, -800)) };
check("7d. MASSACHUSETTS' LINE UNREAD: with no line read and the chart in its box, its rules hold there - a channel, a ramp - "
      + "each said for the unread line; named unread beside another state's line, its rules hold beyond that line, not in it",
      () => w7d.n === MZ.length && w7d.named && w7d.chan && w7d.ramp && !w7d.u2out && w7d.u2in,
      () => JSON.stringify(w7d));
// THE GOVERNOR through a Massachusetts channel: her route east along n = -800 into the Inner Harbor Channel at e = 0
{
  const MG = gov({ zones: [MAW, ...MA_CHART], route: [FMA.fromEN(-600, -800), FMA.fromEN(1500, -800)] });
  MG.pos = FMA.fromEN(-600, -800); const m0 = MG.api.tick();
  MG.pos = FMA.fromEN(-30, -800); const m1 = MG.api.tick();       // 30 m short, past her 23.6 m lead at 7 kn
  MG.pos = FMA.fromEN(-10, -800); const m2 = MG.api.tick();       // 10 m short: headway now
  MG.pos = FMA.fromEN(200, -800); const m3 = MG.api.tick();       // in it
  MG.pos = FMA.fromEN(405, -800); const m4 = MG.api.tick();       // 5 m past its end: not clear by her length
  MG.pos = FMA.fromEN(450, -800); const m5 = MG.api.tick();       // 50 m past, 150 m short of the next: clear
  check("7e. THE GOVERNOR AND A MASSACHUSETTS CHANNEL: the job's 7 until it is inside her lead, then headway (the DriX's 4) "
        + "before it, said with the rule it is; held in it and while she clears it; the job's 7 back when clear, said",
        () => m0 === "7" && m1 === "7" && m2 === "4" && m3 === "4" && m4 === "4" && m5 === "7"
              && /^SPEED ZONE AHEAD - Massachusetts, in a channel \(MA 323 CMR 2\.07\(3\)\(d\)\): headway speed\. Slowing to 4 kn now/.test(MG.banners[0] || "")
              && /^CLEAR OF SPEED ZONE Massachusetts, in a channel \(MA 323 CMR 2\.07\(3\)\(d\)\): back to 7 kn, her commanded speed\.$/.test(MG.banners[1] || "")
              && MG.banners.length === 2,
        () => JSON.stringify({ m: [m0, m1, m2, m3, m4, m5], banners: MG.banners }));
}

{
  // 8. NO COMMANDED SPEED TO COMPARE (the 2026-10-16 review, finding 19): the leg unknown and no speed_key on the frame
  const U = gov({ speedKey: undefined, indexed: false });
  U.pos = at(200, 200); const u1 = U.api.tick();
  check("8. IN A ZONE WITH NO COMMANDED SPEED (no speed_key on the frame, the leg unknown): nothing is commanded, and the "
        + "banner says the console cannot say her speed - not 'Her undefined is within it'",
        () => u1 == null && U.sent.length === 0 && U.banners.length === 1 && !/undefined/.test(U.banners[0])
              && /cannot say her commanded speed/.test(U.banners[0]) && /^SPEED ZONE - Test limit \(TEST\): 5 kn\./.test(U.banners[0]),
        () => JSON.stringify({ u1, sent: U.sent, banners: U.banners }));
}

console.log("\n" + (fails ? fails + " CHECK(S) FAILED" : "all checks passed") + " (" + ran + ")");
process.exit(fails ? 1 : 0);
