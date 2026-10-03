// static/js/surveys.js — THE SURVEYS IN THE PLAN (2026-10-02, phase 1 of sequenced surveys).
//
// Andy, 2026-10-02: "Recommend feature structure to create sequenced surveys. Multiple surveys can be created and
// named/numbered in Survey card. Then the user can select the order in which the survey blocks are completed. GOTO
// function for inter-survey travel." Then, on the recommendation: "Start phase 1, keep the number with the survey".
//
// PHASE 1 IS THE GROUNDWORK, AND IT ADDS NO CONTROLS. The plan stays ONE flat list of waypoints and one of lines, and
// every consumer that matters - Upload, the line matching, the speed governor, resume - goes on reading those lists.
// What is new is that the lists know which SURVEY each entry belongs to:
//   * `mission.surveys` - the surveys in RUN ORDER, each {id, no, name, pattern, punched}. `no` is the survey's NUMBER
//     and it STAYS WITH THE SURVEY (his call): it is never re-used within a plan and never follows the run order, so a
//     line label or a session log that says S3 means one survey for the life of the plan. `pattern` is the drawing it
//     came from ({A, B, C, align}, the three clicks and the alignment - all surveyPattern needs to draw it again), for
//     the editor phase 2 brings; null where nobody recorded it.
//   * an `sv` tag - the survey's id - on every line, and on every waypoint a survey put in the plan. A waypoint with no
//     tag is a FREE waypoint: one added in WPT mode, or a search pattern's. It belongs to no survey.
//   * each survey's entries sit TOGETHER in both lists, in the order the surveys are listed.
// Add to plan makes each committed pattern a survey of its own (commitPattern, numbered one past the highest the plan
// holds).
//
// A PLAN SAVED BEFORE THIS has lines and no surveys. It loads as ONE survey, S1, holding everything: exactly the plan
// it was, judged exactly as before. Nothing is guessed - two patterns added to one plan before today are not split
// apart, because nothing recorded where one ended.
//
// A PLAN WHOSE GROUPING DOES NOT HOLD - a hand-edited file, a tag naming no listed survey, one survey's entries split
// by another's - is not half-trusted. It loads as ONE survey (the first listed, keeping its number and name), which is
// the plan judged exactly as it was before surveys were kept, and normalizeSurveys says why so the page can say so.
//
// PURE: a plan in, the same plan normalized and a note out. No DOM, no state.

export const SURVEY_ID_MAX = 32;          // characters - the console refuses a longer tag (check_plan_body)
export const SURVEY_NAME_MAX = 120;

/** The survey a line or waypoint belongs to: its tag, or "" for none. Untagged entries group together, which is what
 *  keeps a plan with no tags at all - every suite's fixtures, a plan from before this - judged as one survey. */
export function svOf(x){ return (x && typeof x.sv === "string") ? x.sv : ""; }

function usable(s){
  return !!s && typeof s === "object" && typeof s.id === "string" && s.id.length > 0 && s.id.length <= SURVEY_ID_MAX
      && Number.isInteger(s.no) && s.no >= 1;
}

/** The runs of equal tags along a list, in order: [{sv, from, to}] with `to` inclusive. */
function runsOf(list){
  const out = [];
  list.forEach((x, i) => {
    const sv = svOf(x), last = out[out.length - 1];
    if(last && last.sv === sv) last.to = i; else out.push({sv, from: i, to: i});
  });
  return out;
}

/** Why the plan's grouping does not hold, or null when it does. `ids` is the set of listed survey ids. */
function brokenWhy(m, ids){
  const lines = m.lines || [], wps = m.waypoints || [];
  for(let k = 0; k < lines.length; k++){
    const sv = svOf(lines[k]);
    if(!sv) return "line " + (k + 1) + " belongs to no survey";
    if(!ids.has(sv)) return "line " + (k + 1) + " names survey " + sv + ", which the plan does not list";
  }
  for(let i = 0; i < wps.length; i++){
    const sv = svOf(wps[i]);
    if(sv && !ids.has(sv)) return "waypoint " + (i + 1) + " names survey " + sv + ", which the plan does not list";
  }
  for(const [what, list] of [["lines", lines], ["waypoints", wps]]){
    const seen = new Set();
    for(const r of runsOf(list)){
      if(!r.sv) continue;
      if(seen.has(r.sv)) return "survey " + r.sv + "'s " + what + " are not together";
      seen.add(r.sv);
    }
  }
  // The two lists must run the surveys in ONE order: the waypoints are what the boat flies, the lines what is counted.
  const order = (list) => runsOf(list).map(r => r.sv).filter(Boolean);
  const byLines = order(lines), byWps = order(wps).filter(sv => byLines.includes(sv));
  if(byWps.join(",") !== byLines.filter(sv => byWps.includes(sv)).join(","))
    return "the lines and the waypoints run the surveys in different orders";
  return null;
}

/**
 * Make `m` a plan whose surveys hold, in place, and say what was done. Returns {note, migrated, folded}:
 *   * a plan whose grouping holds - or one with nothing to group - is left alone (surveys with no entries are kept:
 *     phase 2's outline-only surveys), with `surveys` put into the order the plan actually runs them;
 *   * a plan with lines and no surveys (saved before surveys were kept) becomes ONE survey, S1, everything tagged
 *     with it - `migrated`, and nothing to say: that is every plan anyone has today;
 *   * a plan whose grouping is broken is FOLDED into one survey, the first listed, everything tagged with it - and
 *     `note` says why, once, in words the page can show.
 * Survey records that are not usable (no id, no whole-number `no`) are dropped, and a repeated id or number keeps
 * its first record.
 */
export function normalizeSurveys(m){
  const lines = m.lines || (m.lines = []), wps = m.waypoints || (m.waypoints = []);
  const ids = new Set(), nos = new Set(), list = [];
  for(const s of (Array.isArray(m.surveys) ? m.surveys : [])){
    if(!usable(s) || ids.has(s.id) || nos.has(s.no)) continue;
    ids.add(s.id); nos.add(s.no); list.push(s);
  }
  m.surveys = list;
  if(!list.length){
    if(lines.length){
      m.surveys = [{id: "S1", no: 1, name: "", pattern: null, punched: null}];
      for(const L of lines) L.sv = "S1";
      for(const p of wps) p.sv = "S1";
      return {note: null, migrated: true, folded: false};
    }
    for(const p of wps) if("sv" in p) delete p.sv;       // a tag with no survey to name is an orphan
    return {note: null, migrated: false, folded: false};
  }
  const why = brokenWhy(m, ids);
  if(why){
    const keep = list[0];
    m.surveys = [keep];
    for(const L of lines) L.sv = keep.id;
    for(const p of wps) p.sv = keep.id;
    return {note: "the plan's surveys could not be told apart (" + why + "), so the whole plan is treated as ONE "
                  + "survey, " + keep.id + ", as it was before surveys were kept - its lines, order and turns are "
                  + "unchanged",
            migrated: false, folded: true};
  }
  // Sound. The list is put into the order the plan RUNS the surveys - the lists are what the boat flies, so they are
  // the truth about the order; a survey with no entries keeps its place after those that have some.
  const first = new Map();
  [...lines, ...wps].forEach((x, i) => { const sv = svOf(x); if(sv && !first.has(sv)) first.set(sv, i); });
  const ran = list.filter(s => first.has(s.id)).sort((a, b) => first.get(a.id) - first.get(b.id));
  m.surveys = [...ran, ...list.filter(s => !first.has(s.id))];
  return {note: null, migrated: false, folded: false};
}

/** Each survey's own waypoints, in run order: [{id, no, pts}]. A survey with none (an outline) has an empty `pts`. */
export function surveyPoints(m){
  const by = new Map((m.surveys || []).map(s => [s.id, {id: s.id, no: s.no, pts: []}]));
  for(const p of (m.waypoints || [])){ const e = by.get(svOf(p)); if(e) e.pts.push(p); }
  return [...by.values()];
}

// --- PHASE 2 (2026-10-02): the survey TABLE's edits, and the legs between surveys ------------------------------------
//
// Andy's calls for phase 2: each survey keeps its own pattern, boundary, Max depth, leads and turn shape (the buffer,
// the three speeds, End of plan and Min depth - the routing floor - stay plan-wide); the transits between surveys keep
// right in a buoyed channel (Rule 9), as every other transit does; no hold between surveys yet (phase 3).
//
// Every edit below works on a plan whose grouping HOLDS (normalizeSurveys has run on it - the page never holds any
// other), and keeps it holding: each survey's entries stay together, in one order in both lists. A FREE waypoint
// (a WPT, a search pattern) is never moved by them - it keeps its place between whatever runs either side of it.

/** Where survey `id`'s entries sit in `list`: {from, to} inclusive, or null when it has none there. */
function blockOf(list, id){
  let from = -1, to = -1;
  (list || []).forEach((x, i) => { if(svOf(x) === id){ if(from < 0) from = i; to = i; } });
  return from < 0 ? null : {from, to};
}

/**
 * The waypoint indexes where the plan ENTERS a survey from something else - another survey, or a free waypoint.
 * The leg INTO each of them is a TRANSIT (Andy, 2026-09-05: the legs "from home to the first survey line ... or the
 * next survey are transit lines"), so Upload routes it as it routes the approach: at the guard's standoff where the
 * water allows, keeping right in a buoyed channel. Index 0 is the approach itself and is not listed - routePlan
 * already treats it so.
 */
export function surveyEntries(wps){
  const out = new Set(), w = wps || [];
  for(let i = 1; i < w.length; i++){
    const sv = svOf(w[i]);
    if(sv && sv !== svOf(w[i - 1])) out.add(i);
  }
  return out;
}

/**
 * Run survey `id` one place earlier (dir < 0) or later (dir > 0): it changes places with its neighbor in the run
 * order, in `surveys` AND in both lists - the lines are what is counted, the waypoints what the boat flies, and the
 * two may never disagree about the order. Whatever lies BETWEEN the two (free waypoints) stays between them. Returns
 * false, changing nothing, at either end of the list or for an unknown id.
 */
export function moveSurvey(m, id, dir){
  const list = m.surveys || [], i = list.findIndex(s => s.id === id), j = i + (dir < 0 ? -1 : 1);
  if(i < 0 || j < 0 || j >= list.length) return false;
  const first = list[Math.min(i, j)].id, second = list[Math.max(i, j)].id;     // `first` runs before `second`
  for(const key of ["lines", "waypoints"]){
    const L = m[key] || [], a = blockOf(L, first), b = blockOf(L, second);
    if(!a || !b) continue;                                     // one of them has nothing in this list: nothing to swap
    m[key] = [...L.slice(0, a.from), ...L.slice(b.from, b.to + 1), ...L.slice(a.to + 1, b.from),
              ...L.slice(a.from, a.to + 1), ...L.slice(b.to + 1)];
  }
  const out = list.slice();
  [out[i], out[j]] = [out[j], out[i]];
  m.surveys = out;
  return true;
}

/** Take survey `id` out of the plan: its record, its lines and every waypoint it put there. Free waypoints stay.
 *  Returns false, changing nothing, for an unknown id. */
export function removeSurvey(m, id){
  if(!(m.surveys || []).some(s => s.id === id)) return false;
  m.surveys = m.surveys.filter(s => s.id !== id);
  m.lines = (m.lines || []).filter(x => svOf(x) !== id);
  m.waypoints = (m.waypoints || []).filter(x => svOf(x) !== id);
  return true;
}

/**
 * Put `lines` and `wps` (already tagged `id`) IN PLACE of survey `id`'s entries - where its old ones were, so an
 * edited survey keeps its place in the run order - or at the end of a list where it had none. The record itself is
 * the caller's to update.
 */
export function replaceSurvey(m, id, lines, wps){
  for(const [key, add] of [["lines", lines || []], ["waypoints", wps || []]]){
    const L = m[key] || [], b = blockOf(L, id);
    m[key] = b ? [...L.slice(0, b.from), ...add, ...L.slice(b.to + 1)] : [...L, ...add];
  }
}

/** The survey's label, as the table, the chart and the LINES card all print it: "S3" or "S3 Rye ledge". */
export function surveyLabel(s){
  if(!s) return "";
  const name = (typeof s.name === "string") ? s.name.trim() : "";
  return "S" + s.no + (name ? " " + name : "");
}

/**
 * The path a plan's TRANSITS take, for reading the chart over: the start, then every waypoint - except that a
 * survey's run of waypoints is cut to its first and its last, because the water INSIDE a survey is read as a survey
 * (surveyPoints), at its own detail, and needs no second read along every line of it. Free waypoints stay as they are.
 */
export function pathThroughSurveys(start, waypoints){
  const out = start ? [start] : [];
  for(const r of runsOf(waypoints || [])){
    if(!r.sv){ for(let i = r.from; i <= r.to; i++) out.push(waypoints[i]); continue; }
    out.push(waypoints[r.from]);
    if(r.to > r.from) out.push(waypoints[r.to]);
  }
  return out;
}
