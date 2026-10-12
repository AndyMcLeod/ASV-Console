// tests/enc_awareness.js - every charted thing the review found reaching the keep-out model as NOTHING, judged now as
// it should be, for EACH HULL by its own vessel file.
//
// Andy, 2026-10-12: "Review ENC acquisition and awareness code. Ensure that all layers of all tiles downloaded are read
// and all ENC components are understood and applied to situational awareness by each ASV." Then "Carry on as you
// recommend."
//
// What the review measured, with the shipped keepouts.js, on his own cached tiles:
//   DREDGED CHANNELS  S-57 tiles the seabed with dredged areas IN PLACE OF depth areas, and the depth test read depth
//                     areas alone: every dredged channel shallower than a hull's floor was OPEN WATER - New Castle's
//                     Back Channel (1.8 m) and Northward Channel (0.9 m) for a DriX drawing 2.25 m; 333 such in his cache.
//   UNSURVEYED WATER  the same, the other Group 1 object: open for every hull (11 of 11 at Erie).
//   ISLETS            land too small for an area, charted as a POINT: `extra`, nothing - held off only by the drying flat
//                     round it, which at +1.5 m of tide stops holding the 1 m hulls (all 151 at Portsmouth).
//   OVERHEAD          no hull had an air draft and the server dropped every clearance: a DriX 2.85 m tall was routed
//                     under New Castle's 1.8, 2.1 and 2.4 m fixed bridges.
//   OBSTRUCTIONS      aquaculture, platforms, fishing facilities, oil booms, light floats, the beacon forms of the
//                     danger marks - all `extra`, nothing.
//   SOUNDINGS         a rock was passed on any VALSOU, the chart's own "doubtful" or "always dry" never kept.
//
// THE REAL DATA: tests/fixtures/enc_newcastle.json, the harbour band round New Castle read LIVE through the console's own
// reader on 2026-10-12 (fetch_enc_features, every layer, the properties kept since) - the bridges' real clearances, the
// real dredged channels, the real islets in their real drying flats. THE REAL HULLS: vessels/*.json, each hull's own
// draft, under-keel clearance, air draft and overhead clearance.
//
//   node tests/enc_awareness.js      # exit 0 = pass, 1 = fail   (stdlib Node)

// --- crash guard: a throw outside a check() must still REPORT ------------------------
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
const { V, sea } = require("../static/js/state.js");
const { planeFrame } = require("../static/js/geodesy.js");
const { buildKeepouts, blocked, airNeedM, hazPassable, depthExcluded } = require("../static/js/chart.js");
const { ROCK_CLASSES } = require("../static/js/routing.js");

let fails = 0, ran = 0;
function check(name, cond, detail) {
  ran++;
  let ok;
  try { ok = !!(typeof cond === "function" ? cond() : cond); }
  catch (e) { ok = false; detail = (detail ? detail + " — " : "") + "THREW: " + e.message; }
  if (typeof detail === "function") { try { detail = detail(); } catch (e) { detail = "detail threw: " + e.message; } }
  console.log((ok ? "  ok   " : "  FAIL ") + name + (detail ? "   [" + detail + "]" : ""));
  if (!ok) fails++;
}

const ROOT = path.join(__dirname, "..");
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "fixtures", "enc_newcastle.json"), "utf8"));
const HULLS = ["zboat_1800hs", "ben_cworker4", "drix08", "drix08_em712"].map((id) => {
  const v = JSON.parse(fs.readFileSync(path.join(ROOT, "vessels", id + ".json"), "utf8"));
  return { id, floor: v.hull.draft_m + v.planning.under_keel_clearance_m, air: v.hull.air_draft_m,
           oc: v.planning.overhead_clearance_m, buf: v.planning.nogo_buffer_m };
});
const frame = planeFrame({ lat: 43.072, lon: -70.73 });
const ON = { land: true, depth: true, haz: true, area: false, wreck: true, chan: true };     // the console's defaults
// Build the model as THIS hull: the console's own wrapper (koOpts: the floor, the tide, the air need off V).
function asHull(h, feats, opt = {}) {
  const was = { min: V.NOGO_MIN_DEPTH_M, air: V.AIR_DRAFT_M, oc: V.OVERHEAD_CLEARANCE_M, op: V.OPER_MIN_DEPTH_M, wo: sea.waterOffset };
  V.NOGO_MIN_DEPTH_M = h.floor; V.AIR_DRAFT_M = h.air; V.OVERHEAD_CLEARANCE_M = h.oc; V.OPER_MIN_DEPTH_M = 0;
  sea.waterOffset = opt.tide || 0;
  try { return buildKeepouts(frame, opt.enf || ON, { min: h.floor, max: 0 }, feats); }
  finally { V.NOGO_MIN_DEPTH_M = was.min; V.AIR_DRAFT_M = was.air; V.OVERHEAD_CLEARANCE_M = was.oc; V.OPER_MIN_DEPTH_M = was.op; sea.waterOffset = was.wo; }
}
const byCls = (c) => FIX.features.filter((f) => f.cls === c);
const ringOf = (f) => (f.geometry.type === "Polygon" ? f.geometry.coordinates[0] : f.geometry.coordinates[0][0]);
// a point inside a polygon feature (its own outer ring), found by a fixed scan
function inside(f) {
  const r = ringOf(f), xs = r.map((p) => p[0]), ys = r.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  for (let k = 1; k < 40000; k++) {
    const x = x0 + (x1 - x0) * ((k * 0.6180339887) % 1), y = y0 + (y1 - y0) * ((k * 0.7548776662) % 1);
    let c = false;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++)
      if ((r[i][1] > y) !== (r[j][1] > y) && x < (r[j][0] - r[i][0]) * (y - r[i][1]) / (r[j][1] - r[i][1]) + r[i][0]) c = !c;
    if (c) return { lat: y, lon: x };
  }
  return null;
}
const en = (ll) => frame.toEN(ll);
const kindsAt = (ko, ll) => ko.polys.filter((p) => blocked(en(ll), { polys: [p], lines: [], points: [] }, 0)).map((p) => p.kind);

console.log("ENC awareness - each hull, by its own file, against New Castle's own chart:");
console.log("  hulls: " + HULLS.map((h) => h.id + " floor " + h.floor.toFixed(2) + " m, needs " + (h.air + h.oc).toFixed(2) + " m overhead").join("; "));

// ── 1. DREDGED CHANNELS, BY THE DEPTH THEY ARE KEPT TO ───────────────────────────────────────────────────────────────
{
  const dr = byCls("Dredged_Area");
  const rows = [];
  let bad = [];
  for (const h of HULLS) {
    const ko = asHull(h, dr);
    for (const f of dr) {
      const p = inside(f), shallow = f.props.DRVAL1 < h.floor, kinds = kindsAt(ko, p);
      const held = kinds.some((k) => /^a dredged channel shallower than/.test(k));
      if (held !== shallow) bad.push(h.id + " " + (f.props.OBJNAM || "?") + " " + f.props.DRVAL1 + " m: held " + held);
    }
    rows.push(h.id + " " + dr.filter((f) => f.props.DRVAL1 < h.floor).length + "/" + dr.length);
  }
  check("1. A DREDGED CHANNEL shallower than a hull's floor is a keep-out for that hull - named as a dredged channel - and "
        + "one deep enough is not, with the `area` toggle at its default (off) - for every hull, by its own file",
        () => dr.length === 10 && bad.length === 0, () => (bad.length ? "WRONG: " + bad.join("; ") + " | " : "") + "held " + rows.join(", "));
  const em = HULLS.find((h) => h.id === "drix08_em712"), zb = HULLS.find((h) => h.id === "zboat_1800hs");
  const back = dr.find((f) => f.props.OBJNAM === "Portsmouth Harbor Back Channel"), north2 = dr.find((f) => f.props.OBJNAM === "Northward Channel reach 2");
  const pBack = inside(back), pN2 = inside(north2);
  const emAt = blocked(en(pBack), asHull(em, dr), 0), zbAt = blocked(en(pBack), asHull(zb, dr), 0);
  const zbN2 = blocked(en(pN2), asHull(zb, dr), 0), zbN2Tide = blocked(en(pN2), asHull(zb, dr, { tide: 1.0 }), 0);
  const emDepthOff = blocked(en(pBack), asHull(em, dr, { enf: { ...ON, depth: false } }), 0);
  check("1b. ... the Back Channel (1.8 m): refused to the DriX (EM712, 3.15 m floor), water to the small-class boat (1.02 m); "
        + "Northward Channel reach 2 (0.9 m) refused to the small-class boat at datum and water to her at +1.0 m of tide - judged "
        + "as a depth area is - and the depth toggle off lets the DriX in, as it does over any shallow water",
        () => emAt && !zbAt && zbN2 && !zbN2Tide && !emDepthOff,
        () => "DriX " + emAt + ", small-class boat " + zbAt + "; Northward 2 small-class boat " + zbN2 + ", at +1.0 m " + zbN2Tide + "; depth off " + emDepthOff);
}

// ── 2. UNSURVEYED WATER, UNDER EVERY FLOOR ──────────────────────────────────────────────────────────────────────────
{
  const ring = [[-70.74, 43.06], [-70.739, 43.06], [-70.739, 43.061], [-70.74, 43.061], [-70.74, 43.06]];
  const uns = { role: "unsurveyed", cls: "Unsurveyed_Area", props: {}, geometry: { type: "Polygon", coordinates: [ring] } };
  const p = { lat: 43.0605, lon: -70.7395 };
  const each = HULLS.map((h) => blocked(en(p), asHull(h, [uns], { tide: 5 }), 0));
  const off = blocked(en(p), asHull(HULLS[0], [uns], { enf: { ...ON, depth: false } }), 0);
  const kind = asHull(HULLS[0], [uns]).polys[0];
  check("2. UNSURVEYED WATER is refused to every hull at any tide (no depth anybody measured), named as such, outside "
        + "any survey window, and released only with depth enforcement switched off",
        () => each.every(Boolean) && !off && kind && kind.kind === "unsurveyed water"
              && depthExcluded(uns, { min: 0, max: 0 }) && depthExcluded(uns, { min: 0.1, max: 50 }),
        () => "hulls " + each.join(",") + ", depth off " + off + ", kind " + (kind && kind.kind));
}

// ── 3. ISLETS, AT ANY TIDE ──────────────────────────────────────────────────────────────────────────────────────────
{
  const isl = byCls("Land_Area_point"), flats = byCls("Depth_Area");
  const zb = HULLS.find((h) => h.id === "zboat_1800hs"), ben = HULLS.find((h) => h.id === "ben_cworker4");
  const feats = [...flats, ...isl];
  const at = (h, tide, f, enf) => blocked(en({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }), asHull(h, feats, { tide, enf }), 0);
  const flatsOnly = (h, tide, f) => blocked(en({ lon: f.geometry.coordinates[0], lat: f.geometry.coordinates[1] }), asHull(h, flats, { tide }), 0);
  const heldHigh = [zb, ben].map((h) => isl.filter((f) => at(h, 1.5, f)).length);
  const flatHigh = isl.filter((f) => flatsOnly(zb, 1.5, f)).length, flatLow = isl.filter((f) => flatsOnly(zb, 0, f)).length;
  const ko = asHull(zb, isl);
  const landOff = isl.filter((f) => at(zb, 1.5, f, { ...ON, land: false })).length;
  check("3. AN ISLET charted as a point is land at ANY tide: the drying flat round each of New Castle's " + isl.length + " holds "
        + "it off at datum and not at +1.5 m - the islet holds it then, for the small-class boat and the C-Worker alike; sized by the "
        + "assumed extent, named as an islet, a rock to the lane (passed either side), and under the land toggle",
        () => isl.length === 50 && flatLow === 50 && flatHigh === 0 && heldHigh.every((n) => n === 50)
              && ko.points.length === 50 && ko.points.every((q) => q.kind === "a charted islet" && q.r === V.WRECK_RADIUS_M)
              && ROCK_CLASSES.has("Land_Area_point") && landOff === 0,
        () => "flats alone: " + flatLow + " at datum, " + flatHigh + " at +1.5 m; with the islets at +1.5 m: small-class boat "
              + heldHigh[0] + ", C-Worker " + heldHigh[1] + "; points " + ko.points.length + " r " + (ko.points[0] || {}).r
              + "; land off " + landOff);
}

// ── 4. OVERHEAD, BY EACH HULL'S OWN AIR DRAFT ───────────────────────────────────────────────────────────────────────
{
  const spans = byCls("Bridge_area"), cables = byCls("Cable_Overhead_line");
  const clr = (f) => { const v = [f.props.VERCLR, f.props.VERCCL].filter((x) => typeof x === "number"); return v.length ? Math.min(...v) : null; };
  const wrong = [];
  const table = [];
  for (const h of HULLS) {
    const need = h.air + h.oc, ko = asHull(h, [...spans, ...cables]);
    const heldSpans = ko.polys.filter((p) => p.cls === "Bridge_area").length, heldCables = ko.lines.filter((l) => l.cls === "Cable_Overhead_line").length;
    const wantSpans = spans.filter((f) => clr(f) === null || clr(f) < need).length, wantCables = cables.filter((f) => clr(f) === null || clr(f) < need).length;
    if (heldSpans !== wantSpans || heldCables !== wantCables) wrong.push(h.id + " spans " + heldSpans + "/" + wantSpans + " cables " + heldCables + "/" + wantCables);
    table.push(h.id + " (needs " + need.toFixed(2) + "): " + spans.filter((f) => clr(f) !== null && clr(f) < need).map(clr).sort((a, b) => a - b).join(","));
  }
  const need0 = airNeedM();
  const none = asHull({ ...HULLS[0], air: 0 }, [...spans, ...cables]);
  check("4. A BRIDGE OR A CABLE is a keep-out exactly where it is charted lower than the hull's own air draft plus its "
        + "overhead clearance, or has no clearance charted - New Castle's real spans and cables, each hull by its own file",
        () => wrong.length === 0 && spans.length >= 20 && cables.length >= 5,
        () => (wrong.length ? "WRONG: " + wrong.join("; ") + " | " : "") + "too low: " + table.join("; "));
  const by = (id) => HULLS.find((h) => h.id === id);
  const fixed = (v) => spans.find((f) => f.props.VERCLR === v && f.props.VERCCL == null);
  const heldBy = (h, f) => asHull(h, [f]).polys.length === 1;
  const s18 = fixed(1.8), s24 = fixed(2.4), s42 = fixed(4.2), sml = spans.find((f) => f.props.VERCCL === 4.9), bas = spans.find((f) => f.props.VERCCL === 3.6);
  const grid = [["1.8 m", s18], ["2.4 m", s24], ["4.2 m", s42], ["Sarah Mildred Long shut 4.9 m", sml], ["bascule shut 3.6 m", bas]]
    .map(([n, f]) => n + ": " + ["zboat_1800hs", "ben_cworker4", "drix08_em712"].map((id) => (heldBy(by(id), f) ? "X" : ".")).join(""));
  check("4b. ... the 1.8 m fixed bridge refuses all three hull types; the 2.4 m one the C-Worker (1.97 m) and the DriX "
        + "(2.85 m) but not the small-class boat (1.1 m); the 4.2 m one none of them; the Sarah Mildred Long lift span SHUT (4.9 m) "
        + "passes the DriX, the bascule shut at 3.6 m does not; a hull with no air draft is refused by none; the page's "
        + "default hull (no vessel loaded) needs nothing overhead",
        () => s18 && s24 && s42 && sml && bas && heldBy(by("zboat_1800hs"), s18) && heldBy(by("ben_cworker4"), s18) && heldBy(by("drix08_em712"), s18)
              && !heldBy(by("zboat_1800hs"), s24) && heldBy(by("ben_cworker4"), s24) && heldBy(by("drix08_em712"), s24)
              && !heldBy(by("zboat_1800hs"), s42) && !heldBy(by("ben_cworker4"), s42) && !heldBy(by("drix08_em712"), s42)
              && !heldBy(by("drix08_em712"), sml) && heldBy(by("drix08_em712"), bas) && !heldBy(by("ben_cworker4"), bas)
              && none.polys.length === 0 && none.lines.length === 0 && need0 === 0,
        () => grid.join("; ") + " (small-class boat, C-Worker, DriX); no air draft: " + none.polys.length + "/" + none.lines.length + "; default need " + need0);
}

// ── 5. THINGS IN THE WATER THAT WERE ONLY `extra` ────────────────────────────────────────────────────────────────────
{
  const P = [-70.73, 43.07], sq = [[[-70.731, 43.069], [-70.729, 43.069], [-70.729, 43.071], [-70.731, 43.071], [-70.731, 43.069]]];
  const L = [[-70.731, 43.07], [-70.729, 43.07]];
  const pt = (role, cls, props) => ({ role, cls, props: props || {}, geometry: { type: "Point", coordinates: P } });
  const ar = (role, cls) => ({ role, cls, props: {}, geometry: { type: "Polygon", coordinates: sq } });
  const ln = (role, cls) => ({ role, cls, props: {}, geometry: { type: "LineString", coordinates: L } });
  const h = HULLS.find((x) => x.id === "drix08_em712");
  const one = (f) => { const ko = asHull(h, [f]); return { n: ko.polys.length + ko.lines.length + ko.points.length,
                                                            kind: (ko.polys[0] || ko.lines[0] || ko.points[0] || {}).kind, r: (ko.points[0] || {}).r }; };
  const cases = [
    [pt("hazard_point", "Offshore_Platform_point", { VALSOU: 30 }), "an offshore platform", V.WRECK_RADIUS_M],
    [pt("hazard_point", "Marine_Farm_Culture_point"), "an aquaculture site", V.WRECK_RADIUS_M],
    [pt("hazard_point", "Fishing_Facility_point"), "a fishing facility", V.WRECK_RADIUS_M],
    [pt("hazard_point", "Light_Float_point"), "a light float", 0],
    [pt("hazard_point", "Beacon_Isolated_Danger_point"), "a charted hazard", 0],
    [pt("hazard_point", "Beacon_Cardinal_point"), "a charted hazard", 0],
    [ar("hazard_area", "Marine_Farm_Culture_area"), "an aquaculture site"],
    [ar("hazard_area", "Offshore_Platform_area"), "an offshore platform"],
    [ln("hazard_line", "Fishing_Facility_line"), "a fishing facility"],
    [ln("hazard_line", "Oil_Barrier_line"), "an oil boom"],
    [ar("dock", "Dry_Dock_area"), "a dry dock"],
  ];
  const wrong = cases.map(([f, kind, r]) => [f.cls, one(f), kind, r]).filter(([, o, kind, r]) => o.n !== 1 || o.kind !== kind || (r !== undefined && o.r !== r));
  const platformPassed = hazPassable(cases[0][0]);
  check("5. THE THINGS IN THE WATER: an aquaculture site, an offshore platform, a fishing facility (as a point sized by the "
        + "assumed extent, as an area, as a line), an oil boom, a light float, the isolated-danger and cardinal BEACONS, a "
        + "dry dock - each one keep-out named for what it is; a platform charted over 30 m of water is still not passed",
        () => wrong.length === 0 && platformPassed === false,
        () => wrong.length ? "WRONG: " + wrong.map(([c, o, k, r]) => c + " " + JSON.stringify(o) + " want " + k + "/" + r).join("; ")
                           : cases.length + " classes, platform passable " + platformPassed);
}

// ── 6. A SOUNDING THE CHART STANDS BEHIND ───────────────────────────────────────────────────────────────────────────
{
  const rock = (props) => ({ role: "hazard_point", cls: "Underwater_Awash_Rock_point", props: { VALSOU: 8.8, ...props },
                             geometry: { type: "Point", coordinates: [-70.73, 43.07] } });
  const h = HULLS.find((x) => x.id === "zboat_1800hs");
  const passed = (props) => { const was = V.NOGO_MIN_DEPTH_M; V.NOGO_MIN_DEPTH_M = h.floor; try { return hazPassable(rock(props)); } finally { V.NOGO_MIN_DEPTH_M = was; } };
  const t = { known6: passed({ QUASOU: "6" }), none: passed({}), doubtful3: passed({ QUASOU: "3" }), unreliable4: passed({ QUASOU: "4" }),
              reported8: passed({ QUASOU: "8" }), list29: passed({ QUASOU: "2,9" }), dry2: passed({ WATLEV: 2 }), dryText: passed({ WATLEV: "2" }),
              floating7: passed({ WATLEV: 7.0 }), under3: passed({ WATLEV: 3, QUASOU: "6" }) };
  const real = byCls("Underwater_Awash_Rock_point");
  const realPassed = real.filter((f) => { const was = V.NOGO_MIN_DEPTH_M; V.NOGO_MIN_DEPTH_M = h.floor; try { return hazPassable(f); } finally { V.NOGO_MIN_DEPTH_M = was; } }).length;
  check("6. A ROCK IS PASSED ONLY ON A SOUNDING THE CHART STANDS BEHIND: a least depth known (QUASOU 6) or no quality "
        + "given passes it; doubtful (3), unreliable (4), reported (8, or 9 in a list) do not; nor a rock the chart says is "
        + "always dry (WATLEV 2, as a number or text) or floating (7); under water (3) with a known depth does - and "
        + "New Castle's real rocks are judged by the same test",
        () => t.known6 && t.none && !t.doubtful3 && !t.unreliable4 && !t.reported8 && !t.list29 && !t.dry2 && !t.dryText
              && !t.floating7 && t.under3 && real.length === 54,
        () => JSON.stringify(t) + "; real rocks passed " + realPassed + " of " + real.length);
}

// ── 7. THE PAGE IS WIRED TO THE HULL'S FILE ─────────────────────────────────────────────────────────────────────────
{
  // ASV_HTML points this at a SIDECAR copy for a mutation run (tests/precommit_hook.py 8).
  const H = fs.readFileSync(process.env.ASV_HTML || path.join(ROOT, "static", "asv.html"), "utf8");
  const CH = fs.readFileSync(path.join(ROOT, "static", "js", "chart.js"), "utf8");
  const loads = /V\.AIR_DRAFT_M = \(v\.hull && typeof v\.hull\.air_draft_m === "number"/.test(H)
             && /V\.OVERHEAD_CLEARANCE_M = \(v\.planning && typeof v\.planning\.overhead_clearance_m === "number"/.test(H);
  const opts = /airNeedM: airNeedM\(\)/.test(CH.slice(CH.indexOf("function koOpts"), CH.indexOf("function koOpts") + 300));
  const worker = /airDm: Math\.round\(airNeedM\(\) \* 10\)/.test(H);
  const drawn = /lowOver\(f\)/.test(H) && /r==="dredged"\|\|r==="unsurveyed"/.test(H) && /r==="hazard_line"\|\|r==="land_line"/.test(H);
  const files = HULLS.every((h) => h.air > 0 && h.oc >= 0)
             && HULLS.find((h) => h.id === "drix08").air === 2.85 && HULLS.find((h) => h.id === "drix08_em712").air === 2.85
             && HULLS.find((h) => h.id === "ben_cworker4").air === 1.97 && HULLS.find((h) => h.id === "zboat_1800hs").air === 1.1;
  check("7. THE WIRING: every hull's file carries its air draft (DriX 2.85 m off iXblue's drawing, both gondolas; C-Worker "
        + "1.97 m off the GA; the small-class boat 1.1 m, its user guide's whole height) and an overhead clearance; the page's loader "
        + "reads both; the keep-out options carry her need; the passage worker is handed it; the zones layer draws dredged "
        + "and unsurveyed water, obstruction and islet lines, and spans too low for her",
        () => files && loads && opts && worker && drawn,
        () => "files " + files + ", loader " + loads + ", koOpts " + opts + ", worker " + worker + ", drawn " + drawn);
}

console.log(fails ? "\n" + fails + " CHECK(S) FAILED (" + ran + " ran)" : "\nall checks passed (" + ran + ")");
process.exit(fails ? 1 : 0);
