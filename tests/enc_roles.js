// tests/enc_roles.js - every ENC role the server tags has ONE decided meaning in the
// keep-out model, and the roles that are NOT keep-outs are not keep-outs by accident.
//
// Andy, 2026-08-31: "add obstruction_line, bridge structure and cardinal buoys. download
// all layers when entering a new area."
//
// Three new roles and one new class, and each of them is a different kind of trap:
//
//   hazard_line   Obstruction_line. The point and area forms of OBSTRN were fetched and
//                 the LINE was not, so a submerged barrier, a ruined training wall or a
//                 line of piles charted as ONE object was invisible to the model. It is a
//                 keep-out, drawn as a PATH.
//   bridge        Pylon_Bridge_Support_area. A bridge pylon is a pier that happens to
//                 hold something up. Keep-out, drawn as a RING.
//   bridge_span   Bridge_area / Bridge_line. OVERHEAD, AND MUST NEVER BE A KEEP-OUT. A
//                 Bridge_area covers the water it crosses; enforcing it would refuse
//                 every passage under every bridge, which for a hull with a metre of air
//                 draft is wrong on all of them. Fetched to draw, and for nothing else.
//   Buoy_Cardinal A cardinal mark is BOTH a physical object and a hazard indicator - it
//                 says the safe water is to the named side, so there is something to
//                 avoid on the other. Every other buoy class was fetched and this one
//                 was not. It belongs to `hazard_point`, NOT `chan_mark`: it carries no
//                 CATLAM, so pairing cardinals into a channel centreline would invent a
//                 fairway out of marks that describe a danger.
//   extra         EVERY REMAINING PUBLISHED LAYER, downloaded on entering an area so the
//                 cache is complete for the AREA rather than complete for whatever the
//                 roles happened to be that day. It must reach the model as NOTHING.
//
//   node tests/enc_roles.js      # exit 0 = pass, 1 = fail   (stdlib Node)
//
// ⚠ THE BUG THIS SUITE WAS BUILT AROUND IS ONE I WROTE. The first cut put `bridge` in
// BOTH `isLand` and `isHaz`. The dispatch in buildKeepouts is an if/else chain on
// GEOMETRY - isLand draws rings, isShore draws paths, isHaz draws points - so the ring
// branch always won, and a pylon charted as a POINT produced no rings and was dropped
// on the floor. No error, no count, no gap: a hazard silently absent from the model.
// Check 8 is the general form of it and would have caught it on any role.
//
// TEETH (verified by mutation against a sidecar copy, and the predictions were CORRECTED
// by what the runs actually printed rather than the other way round):
//   'bridge_span' added to isLand           -> 6, 16
//   'hazard_point' moved to the ring branch -> 8, 9, 16, 17
//   'hazard_line' dropped from isShore      -> 1, 2, 3, 8, 15, 16
//   '`extra`' given the ring branch         -> 7, 16
//   the enforcement gate on isShore removed -> 4
//   Buoy_Cardinal_point no longer requested -> 12
//   Obstruction_line no longer requested    -> 11
//   Pylon_Bridge_Support_point back under `bridge`  -> 8, 13, 14b
//   a role fetched with no client meaning   -> 8, 15
//
// ⚠ AND ONE MUTATION IS INERT, WHICH IS WORTH MORE THAN A KILL: adding 'bridge' to isHaz
// as well as isLand changes NOTHING, and no check fails. That is the honest answer, not a
// gap. The `bridge` role requests only `_area` classes, so every bridge feature takes the
// ring branch either way. Crossing a role into two branches is only a defect once the
// role also requests a geometry the winning branch cannot draw - which is precisely the
// pairing check 8 tests. Claiming a catch here would be claiming teeth this file does not
// have.
//
// NOTE: this suite evaluates page code SLOPPY - a direct eval, so the page's function declarations bind into this
// file. The page itself is <script type="module">, which runs STRICT: an assignment to an undeclared name passes
// here and throws in the page. tests/page_strict.js parses the page and its modules as strict modules; that runtime
// difference is not checked anywhere.

// --- crash guard: a throw outside a check() must still REPORT ------------------------
// check() turns a throw inside its own thunk into a failed check. Scenario SETUP is not
// inside one, and a throw there would kill the process before a single FAIL line printed.
// "No FAIL lines" and "the process died" are indistinguishable to anything reading
// stdout, so a mutation that crashes this suite would score as SURVIVED.
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

// THE REAL MODULES, not source text lifted out of the page. A renamed or deleted export
// fails HERE, at load, instead of quietly resolving to a stale copy.
const { V } = require("../static/js/state.js");
const { planeFrame } = require("../static/js/geodesy.js");
const { buildKeepouts, nogoKind } = require("../static/js/chart.js");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = (detail ? detail + " — " : "") + "THREW: " + e.message; }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}

// A frame at Portsmouth Harbour, and fixtures a few tens of metres across so every
// geometry is comfortably inside it.
const REF = { lat: 43.073, lon: -70.710 };
const frame = planeFrame(REF);
const at = (dLon, dLat) => [REF.lon + dLon, REF.lat + dLat];
const RING = [[at(0, 0), at(0.0004, 0), at(0.0004, 0.0003), at(0, 0.0003), at(0, 0)]];
const PATH = [at(0, 0), at(0.0006, 0.0002), at(0.0011, 0.0001)];
const PT = at(0.0002, 0.0002);

const poly = (role, cls, props) => ({ role, cls: cls || role, props: props || {},
                                      geometry: { type: "Polygon", coordinates: RING } });
const line = (role, cls, props) => ({ role, cls: cls || role, props: props || {},
                                      geometry: { type: "LineString", coordinates: PATH } });
const point = (role, cls, props) => ({ role, cls: cls || role, props: props || {},
                                       geometry: { type: "Point", coordinates: PT } });

// EVERYTHING ENFORCED. A role that is not a keep-out must not be one even here — "it did
// not show up" is worthless as evidence if the toggle that would have hidden it was off.
const ALL_ON = { land: true, depth: true, haz: true, area: true };

// THE CONSOLE'S OWN FOUR-ARG WRAPPER, `buildKeepouts(ref, enf, dr, feats)`, not the core's
// `(frame, feats, opts)`. They differ, and the difference is not cosmetic: the wrapper
// layers koOpts() - the live vessel depth, wreck radius and tide offset - over the call,
// so a suite that reaches past it tests the algorithm with test-shaped parameters instead
// of the ones the boat runs on. Getting the argument ORDER wrong is caught loudly (the
// feature array arrives where `enf` belongs and enforcement() refuses key "0"), which is
// the one good reason to keep that validator strict.
const build = (feats, enforce) =>
  buildKeepouts(frame, enforce || ALL_ON, { min: V.NOGO_MIN_DEPTH_M, max: 0 }, feats);

console.log("ENC roles — each one reaches exactly one branch, and the context roles reach none:");

// ── 1-4. OBSTRUCTION LINES ARE KEEP-OUTS, AS PATHS ──────────────────────────────────
// The point and area forms were already fetched. A linear obstruction charted as one
// object - a submerged barrier, a line of piles - was fetched by nothing and so could be
// crossed by a route that believed it had checked.
{
  const ko = build([line("hazard_line", "Obstruction_line")]);
  check("1. an obstruction LINE reaches the model as a line, not a ring or a point",
        () => ko.lines.length === 1 && ko.polys.length === 0 && ko.points.length === 0,
        "polys=" + ko.polys.length + " lines=" + ko.lines.length + " points=" + ko.points.length);
  check("2. ... carrying every vertex it was given",
        () => ko.lines[0] && ko.lines[0].pts.length === PATH.length,
        "held " + (ko.lines[0] ? ko.lines[0].pts.length : 0) + " of " + PATH.length);
  // The operator has to be able to read WHY a route was refused. "a charted hazard" is
  // the same words the point and area forms use, because it is the same thing.
  check("3. ... and named to the operator as a charted hazard",
        () => ko.lines[0] && ko.lines[0].kind === "a charted hazard"
              && nogoKind("hazard_line", false) === "a charted hazard",
        ko.lines[0] ? ko.lines[0].kind : "(no line)");
  const off = build([line("hazard_line", "Obstruction_line")], { ...ALL_ON, land: false });
  check("4. ... and it honours the enforcement toggle it is grouped under",
        () => off.lines.length === 0,
        "land enforcement off -> " + off.lines.length + " line(s)");
}

// ── 5-6. THE BRIDGE SPLIT: SUPPORTS YES, SPAN NEVER ─────────────────────────────────
//
// ⚠ THIS IS THE CHECK THAT MATTERS MOST IN THE FILE. A Bridge_area is a polygon over the
// WATER the bridge crosses. Make it a keep-out and the console refuses to pass under any
// bridge on the chart - and it would refuse plausibly, naming a real charted object, so
// nobody would call it a bug. New Castle NH alone returned 35 of them.
{
  const ko = build([poly("bridge", "Pylon_Bridge_Support_area")]);
  check("5. a bridge SUPPORT is a keep-out ring, named as one",
        () => ko.polys.length === 1 && ko.polys[0].kind === "a bridge support",
        "polys=" + ko.polys.length + " kind=" + (ko.polys[0] || {}).kind);

  // ⚠ SINCE 2026-10-12 A SPAN IS A KEEP-OUT WHEN IT IS TOO LOW FOR HER (the overhead checks below, 6b-6f) - so this
  // check now asks it of a hull that declares NO air draft, the case the rule above was written for, and of a span
  // HIGH ENOUGH for a hull that does. Neither may refuse a passage under the bridge.
  const air0 = V.AIR_DRAFT_M;
  V.AIR_DRAFT_M = 0;
  const span = build([poly("bridge_span", "Bridge_area", { VERCLR: 2.1 }),
                      line("bridge_span", "Bridge_line", { VERCLR: 2.1 })]);
  V.AIR_DRAFT_M = 2.85;
  const high = build([poly("bridge_span", "Bridge_area", { VERCLR: 40.8 }),
                      line("overhead", "Cable_Overhead_line", { VERCLR: 50.2 })]);
  V.AIR_DRAFT_M = air0;
  check("6. the SPAN reaches NO list for a hull with no air draft, nor a span high enough for one that has one",
        () => span.polys.length === 0 && span.lines.length === 0
              && span.points.length === 0 && span.marks.length === 0
              && high.polys.length === 0 && high.lines.length === 0,
        "no air draft: polys=" + span.polys.length + " lines=" + span.lines.length +
        "; 2.85 m under 40.8 / 50.2 m: polys=" + high.polys.length + " lines=" + high.lines.length +
        " — a span as keep-out refuses passage under every bridge there is");
}

// ── 6b-6f. OVERHEAD, TOO LOW FOR HER (2026-10-12) ──────────────────────────────────
// New Castle's fixed bridges clear 1.8, 2.1, 2.4, 3.0 and 3.3 m (VERCLR, measured live) and a DriX stands 2.85 m above
// the water. Her need is her air draft plus her overhead clearance (V.AIR_DRAFT_M + V.OVERHEAD_CLEARANCE_M).
{
  const air0 = V.AIR_DRAFT_M, oc0 = V.OVERHEAD_CLEARANCE_M;
  V.AIR_DRAFT_M = 2.85; V.OVERHEAD_CLEARANCE_M = 1.0;                 // she needs 3.85 m
  const low = build([poly("bridge_span", "Bridge_area", { VERCLR: 2.1 })]);
  const edge = build([poly("bridge_span", "Bridge_area", { VERCLR: 3.85 }), poly("bridge_span", "Bridge_area", { VERCLR: 3.84 })]);
  const shut = build([poly("bridge_span", "Bridge_area", { VERCCL: 3.6, VERCOP: 41.1 })]);
  const both = build([poly("bridge_span", "Bridge_area", { VERCLR: 6.0, VERCCL: 3.6 })]);   // two charted: the LOWER
  const none = build([line("bridge_span", "Bridge_line"), line("overhead", "Cable_Overhead_line")]);
  const cable = build([line("overhead", "Cable_Overhead_line", { VERCLR: "4.8" }), line("overhead", "Cable_Overhead_line", { VERCLR: 3.0 })]);
  const off = build([poly("bridge_span", "Bridge_area", { VERCLR: 2.1 })], { ...ALL_ON, land: false });
  V.AIR_DRAFT_M = air0; V.OVERHEAD_CLEARANCE_M = oc0;
  check("6b. a 2.1 m span is a keep-out RING for a 2.85 m hull, named as too low, carrying its clearance",
        () => low.polys.length === 1 && low.polys[0].kind === "a bridge too low for her" && low.polys[0].clr === 2.1,
        "polys=" + low.polys.length + " kind=" + (low.polys[0] || {}).kind + " clr=" + (low.polys[0] || {}).clr);
  check("6c. ... and the line falls exactly at her need: 3.85 m clears, 3.84 m does not",
        () => edge.polys.length === 1 && edge.polys[0].clr === 3.84, "kept " + edge.polys.map((p) => p.clr).join(","));
  check("6d. an opening bridge is judged SHUT (VERCCL 3.6, never its 41.1 m open); with two clearances charted the "
        + "LOWER is hers (6.0 and 3.6: 3.6)",
        () => shut.polys.length === 1 && shut.polys[0].clr === 3.6 && both.polys.length === 1 && both.polys[0].clr === 3.6,
        "polys=" + shut.polys.length + ", two charted -> " + (both.polys[0] || {}).clr);
  check("6e. a span or a cable with NO charted clearance is too low - unknown is the conservative case",
        () => none.lines.length === 2 && none.lines.every((l) => /no charted clearance/.test(l.kind)),
        none.lines.map((l) => l.kind).join(" | "));
  check("6f. a cable is judged the same way, its clearance read as a number whatever it arrived as; and the land "
        + "toggle turns overhead keep-outs off with the other structures",
        () => cable.lines.length === 1 && cable.lines[0].clr === 3.0 && off.polys.length === 0,
        "cable lines=" + cable.lines.length + " (" + cable.lines.map((l) => l.clr).join(",") + "); land off polys=" + off.polys.length);
}

// ── 7. `extra` IS CHART CONTEXT, NOT AN OBSTACLE ────────────────────────────────────
// Entering an area now downloads every published layer. That is only safe because an
// unclassified layer reaches the model as nothing: 1,556 `extra` features came back for
// New Castle NH, and if any branch claimed them the harbour would be one solid keep-out.
{
  const ko = build([poly("extra", "Administration_Area"),
                    line("extra", "Cable_Submarine_line"),
                    point("extra", "Light_point")]);
  check("7. `extra` — every unclassified layer — reaches no list at all",
        () => ko.polys.length === 0 && ko.lines.length === 0
              && ko.points.length === 0 && ko.marks.length === 0,
        "polys=" + ko.polys.length + " lines=" + ko.lines.length +
        " points=" + ko.points.length + " marks=" + ko.marks.length);
}

// ── 8. EVERY GEOMETRY FORM THE SERVER ASKS FOR MUST REACH THE MODEL ─────────────────
//
// The general form of the bug I wrote — and it took a mutation to find the right shape
// for it. The FIRST version of this check fed poly+line+point under each role and
// required output in exactly one bucket. `bridge` in both isLand and isHaz SURVIVED it:
// the crossed role still emits its ring, and what it loses is the POINT. A bucket count
// cannot see a feature that was never emitted, so the check written to catch the bug
// could not catch the bug.
//
// Ask it the other way round, against the server's own class list. Every requested class
// carries its geometry in its name — Obstruction_line, Wreck_point, Bridge_area — so for
// each keep-out role, feed one feature of each form THAT ROLE ACTUALLY REQUESTS and
// require it to arrive somewhere. A role whose dispatch branch cannot carry a form it is
// asked to fetch is fetching features it will silently drop on the floor.
//
// ⚠ THIS IS WHY THE PYLON POINT AND THE PYLON AREA LIVE IN DIFFERENT ROLES. Put
// Pylon_Bridge_Support_point back under `bridge` and this goes red at once — which is
// exactly the failure the first version could not produce.
{
  const PY0 = fs.readFileSync(path.join(__dirname, "..", "asv_console.py"), "utf8");
  const blk0 = PY0.slice(PY0.indexOf("ENC_ROLES = {"), PY0.indexOf("ENC_KEEP_PROPS"));
  const code0 = blk0.split("\n").map((l) => l.split("#")[0]).join("\n");
  const roles = {};
  for (const m of code0.matchAll(/"([a-z_]+)":\s*\[([^\]]*)\]/g))
    roles[m[1]] = [...m[2].matchAll(/"([A-Za-z_]+)"/g)].map((x) => x[1]);

  // Roles that are chart CONTEXT by design reach no bucket on purpose. Check 15 is what
  // keeps that list honest — a role cannot escape this check by being added to it there
  // without a reason written beside it.
  const CONTEXT = new Set(["depth_area", "depth_contour", "sounding", "fairway"]);
  const MAKE = { area: poly, line: line, point: point };
  const total = (ko) => ko.polys.length + ko.lines.length + ko.points.length + ko.marks.length;
  const lost = [], unsuffixed = [];
  // A hull WITH an air draft (2026-10-12): the overhead roles (bridge_span, overhead) reach the model only for one,
  // and with no clearance charted on these fixtures each must arrive - in the form its branch draws.
  const air0 = V.AIR_DRAFT_M;
  V.AIR_DRAFT_M = 2.85;
  for (const [r, classes] of Object.entries(roles)) {
    if (CONTEXT.has(r)) continue;
    for (const c of classes) {
      const g = (c.toLowerCase().match(/_(area|line|point)$/) || [])[1];
      // A class whose name carries no geometry form cannot be checked this way, and going
      // quiet about it would be the silent-skip failure this suite exists to refuse.
      if (!g) { unsuffixed.push(c); continue; }
      if (total(build([MAKE[g](r, c)])) === 0) lost.push(c + " (role " + r + ", a " + g + ")");
    }
  }
  V.AIR_DRAFT_M = air0;
  check("8. every geometry form the server requests reaches the keep-out model",
        () => lost.length === 0 && unsuffixed.length === 0,
        (lost.length ? "SILENTLY DROPPED: " + lost.join("; ") +
                       " — that role's dispatch branch cannot carry that form. " : "") +
        (unsuffixed.length ? "UNCLASSIFIABLE: " + unsuffixed.join(", ") : "") +
        (lost.length || unsuffixed.length ? "" :
          Object.values(roles).flat().length + " classes declared, every enforced form arrives"));
}

// ── 9-10. CARDINAL MARKS ARE HAZARDS, NOT CHANNEL WALLS ─────────────────────────────
//
// A cardinal says "safe water lies NORTH of me", which means there is something to avoid
// to the south. It is a hazard. It is NOT a lateral mark: it carries no CATLAM, so
// `chan_mark` would give it side 0 and feed it to the pairing that builds the Rule 9
// centreline - inventing a fairway from marks that describe a danger.
{
  const ko = build([point("hazard_point", "Buoy_Cardinal_point", { OBJNAM: "N Cardinal" })]);
  check("9. a cardinal buoy is a hazard POINT",
        () => ko.points.length === 1 && ko.points[0].kind === "a charted hazard",
        "points=" + ko.points.length + " kind=" + (ko.points[0] || {}).kind);
  check("10. ... and is NOT a lateral mark, so it cannot build a channel centreline",
        () => ko.marks.length === 0 && ko.chans.length === 0,
        "marks=" + ko.marks.length + " chans=" + ko.chans.length);
}

// ── 11-13. THE SERVER SIDE: THE CLASSES ARE ACTUALLY REQUESTED ──────────────────────
//
// Everything above tests what the CLIENT does with a role. None of it can tell whether
// the server ever asks for the class - and a class that is not requested produces a role
// that never appears, which every check above would pass over in silence. Read the real
// table out of asv_console.py.
{
  const PY = fs.readFileSync(path.join(__dirname, "..", "asv_console.py"), "utf8");
  const blk = PY.slice(PY.indexOf("ENC_ROLES = {"), PY.indexOf("ENC_KEEP_PROPS"));
  // Code only. A class named in a comment - "Pontoon_line IS GONE", one role above - is
  // not a request, and matching it would be the check passing on prose.
  const code = blk.split("\n").map((l) => l.split("#")[0]).join("\n");
  // EVERY role the class appears under, not the first one. `roleOf` returned the first
  // match and A MUTATION WALKED STRAIGHT PAST IT: putting Pylon_Bridge_Support_point under
  // `bridge` as well as `hazard_point` left all seventeen checks green, because
  // `hazard_point` is written first in the table and the search stopped there. A class in
  // two roles is fetched twice and tagged twice - and the second tag is the one that
  // decides whether that copy survives the dispatch.
  const rolesOf = (cls) =>
    [...code.matchAll(/"([a-z_]+)":\s*\[([^\]]*)\]/g)]
      .filter((m) => new RegExp('"' + cls + '"').test(m[2])).map((m) => m[1]);
  const roleOf = (cls) => { const r = rolesOf(cls); return r.length === 1 ? r[0] : r.join("+"); };
  check("11. Obstruction_line is requested, under hazard_line",
        () => roleOf("Obstruction_line") === "hazard_line",
        "role = " + roleOf("Obstruction_line"));
  check("12. Buoy_Cardinal_point is requested, under hazard_point — not chan_mark",
        () => roleOf("Buoy_Cardinal_point") === "hazard_point",
        "role = " + roleOf("Buoy_Cardinal_point"));
  // The pylon POINT and the pylon AREA go to DIFFERENT roles on purpose, because a role
  // gets one geometry branch. This is the bug of check 8, pinned at its source.
  check("13. the bridge pylon POINT and AREA are requested under different roles",
        () => roleOf("Pylon_Bridge_Support_point") === "hazard_point"
              && roleOf("Pylon_Bridge_Support_area") === "bridge",
        "point -> " + roleOf("Pylon_Bridge_Support_point") +
        ", area -> " + roleOf("Pylon_Bridge_Support_area"));
  check("14. the bridge SPAN is requested, under its own role - enforced only where too low for her (6b)",
        () => roleOf("Bridge_area") === "bridge_span" && roleOf("Bridge_line") === "bridge_span",
        "Bridge_area -> " + roleOf("Bridge_area") + ", Bridge_line -> " + roleOf("Bridge_line"));
  // ── 14c. WHAT WAS `extra` AND IS NOW READ (2026-10-12) ─────────────────────────────
  // The review found each of these reaching the model as nothing: islets (151 in the Portsmouth tiles), unsurveyed
  // water, overhead cables, the coarse bands' restricted areas (published there as `Restricted_Area`), aquaculture,
  // platforms, fishing facilities, oil booms, light floats and the beacon forms of the danger marks.
  const want = {
    Land_Area_point: "land_point", Land_Area_line: "land_line", Unsurveyed_Area: "unsurveyed",
    Cable_Overhead_line: "overhead", Pipeline_Overhead_line: "overhead",
    Restricted_Area_area: "restricted", Restricted_Area: "restricted",
    Marine_Farm_Culture_area: "hazard_area", Offshore_Platform_point: "hazard_point",
    Fishing_Facility_line: "hazard_line", Oil_Barrier_line: "hazard_line", Light_Float_point: "hazard_point",
    Beacon_Isolated_Danger_point: "hazard_point", Beacon_Cardinal_point: "hazard_point", Dry_Dock_area: "dock",
    Pontoon_line: "dock_line",
  };
  const wrong = Object.entries(want).filter(([c, r]) => roleOf(c) !== r).map(([c, r]) => c + " -> " + (roleOf(c) || "NOTHING") + " (want " + r + ")");
  check("14c. every class the review found reaching the model as nothing is requested under its decided role",
        () => wrong.length === 0, wrong.length ? wrong.join("; ") : Object.keys(want).length + " classes, each where it belongs");

  // ── 14b. ONE CLASS, ONE ROLE ─────────────────────────────────────────────────────
  //
  // A class named under two roles is fetched twice — the same features, tagged two ways —
  // and the dispatch then decides each copy separately, so one copy can be dropped while
  // the other survives. It is also how such a duplicate hides: the counts still look
  // plausible. Check 13 pins the pylon split specifically; this is the rule it is an
  // instance of, and it is the check that closes the hole a mutation found in `roleOf`.
  {
    const dupes = [];
    for (const c of new Set([...code.matchAll(/"([A-Z][A-Za-z_]+)"/g)].map((m) => m[1]))) {
      const rs = rolesOf(c);
      if (rs.length > 1) dupes.push(c + " -> " + rs.join(" + "));
    }
    check("14b. no ENC class is requested under more than one role",
          () => dupes.length === 0,
          dupes.length ? "DUPLICATED: " + dupes.join(", ")
                       : "every declared class has exactly one role");
  }

  // ── 15. NO ROLE MAY BE FETCHED WITHOUT A DECIDED CLIENT MEANING ───────────────────
  //
  // The mirror of "an unresolved class is silently skipped". A role added to the server
  // that the client's dispatch does not name falls out of buildKeepouts' bottom and
  // becomes chart context BY DEFAULT - which is the right answer for a sounding and the
  // wrong one for an obstruction. Either the dispatch names it, or it is listed here
  // with a reason. Adding a role and deciding nothing fails.
  const CONTEXT_ONLY = {
    depth_area:    "the survey depth window, applied per-request by depthExcluded",
    depth_contour: "drawn, not enforced",
    sounding:      "drawn, not enforced",
    fairway:       "where Rule 9 is in force; the opposite of a keep-out",
  };
  // NOT line-anchored, and deliberately the same pattern check 8 reads the table with. It
  // was `/^\s*"([a-z_]+)":\s*\[/gm` and a MUTATION SLIPPED THROUGH THE GAP: a role
  // declared on a shared line was invisible here while check 8 saw it, so a fetched role
  // with no decided meaning could arrive unreported by the one check that exists to
  // report it. Two checks reading one table two ways is a hole by construction.
  const declared = [...code.matchAll(/"([a-z_]+)":\s*\[/g)].map((m) => m[1]);
  const KO = fs.readFileSync(path.join(__dirname, "..", "static", "js", "keepouts.js"), "utf8");
  // The depth roles are decided in depthExcluded, which buildKeepouts asks first (2026-10-12: `dredged` by its own
  // DRVAL1, `unsurveyed` always) - its body is part of the dispatch.
  const dispatch = KO.slice(KO.indexOf("export function depthExcluded"), KO.indexOf("export function hazExtent"))
                 + KO.slice(KO.indexOf("export function buildKeepouts"));
  const undecided = declared.filter(
    (r) => !CONTEXT_ONLY[r] && !dispatch.includes("'" + r + "'"));
  check("15. every fetched role is either dispatched by name or listed as context",
        () => undecided.length === 0,
        undecided.length ? "UNDECIDED: " + undecided.join(", ") +
                           " — falls out of buildKeepouts as chart context by default"
                         : declared.length + " roles: " +
                           (declared.length - Object.keys(CONTEXT_ONLY).length) +
                           " dispatched, " + Object.keys(CONTEXT_ONLY).length + " context");
}

// ── 16-17. THE WHOLE EXTRACT, MIXED ─────────────────────────────────────────────────
// Every check above feeds one role at a time, which is the one shape a real extract never
// has. A mixed list is where a fall-through that eats the next feature, or a `continue`
// in the wrong branch, shows up.
{
  const feats = [
    poly("land"), poly("bridge", "Pylon_Bridge_Support_area"), poly("bridge_span", "Bridge_area"),
    line("shore_line"), line("hazard_line", "Obstruction_line"), line("bridge_span", "Bridge_line"),
    point("hazard_point", "Buoy_Cardinal_point"), point("extra", "Light_point"),
    point("chan_mark", "Buoy_Lateral_point", { CATLAM: 2, OBJNAM: "Buoy 4" }),
    poly("extra", "Administration_Area"),
  ];
  const ko = build(feats);
  check("16. a mixed extract sorts into 2 rings, 2 paths, 2 points, 1 mark",
        () => ko.polys.length === 2 && ko.lines.length === 2
              && ko.points.length === 2 && ko.marks.length === 1,
        "polys=" + ko.polys.length + " lines=" + ko.lines.length +
        " points=" + ko.points.length + " marks=" + ko.marks.length);
  // A lateral mark is a keep-out point AND a channel wall; the cardinal is only the
  // first. Naming both is what distinguishes them in the same bucket.
  check("17. ... the two points being the cardinal and the lateral buoy, told apart",
        () => ko.points.filter((p) => p.kind === "a charted hazard").length === 1
              && ko.points.filter((p) => p.kind === "a channel buoy").length === 1
              && ko.marks[0].side === 1,
        ko.points.map((p) => p.kind).join(" + ") + "; mark side=" + ko.marks[0].side);
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)"
                  : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
