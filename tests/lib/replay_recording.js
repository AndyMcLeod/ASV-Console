// tests/lib/replay_recording.js - a recording THE CONSOLE WROTE, read by playback's OWN parser (playback_world.js).
//
// ⚠ THE WRITER'S OUTPUT THROUGH THE READER (review 2026-11-05). mission_record.py checked the JSONL the console writes and
// the playback suites checked the page's parser against event arrays typed into each suite: a field renamed on one
// side only left every suite green. tests/mission_record.py runs this on the file its live console just wrote.
//
//   node tests/lib/replay_recording.js <asv_*.jsonl> <epoch> [<epoch> ...]
//
// Prints ONE JSON line: the recording's span, its runs and incidents as playback lists them, and at each epoch the plan,
// the targets per sensor, the environment's source and the session card as the replay would show them.
"use strict";
const fs = require("fs");
const W = require("./playback_world.js");

const file = process.argv[2];
const times = process.argv.slice(3).map(Number);
const EVENTS = [];
for (const line of fs.readFileSync(file, "utf8").split("\n")) {
  if (!line.trim()) continue;
  try { EVENTS.push(JSON.parse(line)); } catch (e) { /* the page skips a line it cannot read, as here */ }
}
const w = W.world(EVENTS);
const F = w.fn, G = w.g();
const out = {
  n: EVENTS.length, t0: G.T0, t1: G.T1,
  runs: G.PB.runs.map((r) => ({ id: r.run_id, behavior: r.start ? r.start.behavior : null, t0: r.t0, t1: r.t1,
                                end: r.end ? r.end.run : null })),
  incidents: G.PB.incidents.map((x) => ({ trigger: x.trigger, n: x.n, t0: x.t0, t1: x.t1 })),
  at: times.map((t) => {
    const p = F.planAt(t), e = F.envAt(t), s = F.sessionAt(t);
    return {
      t,
      plan: { n: p.route ? p.route.length : null, src: p.src, off: p.off || 0,
              route: p.route ? p.route.map((q) => [+q.lat.toFixed(6), +q.lon.toFixed(6)]) : null },
      targets: Object.fromEntries(F.targetsAt(t).map((S) => [S.sensor, { stale: !!S.stale, ids: S.contacts.map((v) => v.id),
                                                                         show_km: S.area ? S.area.show_km : null }])),
      env: { from: e.from, env: !!e.env, current: !!e.current, water: !!e.water, buoys: Array.isArray(e.buoys) },
      session: { vessel: s.vessel, port: s.port, mode: s.mode },
      wp: F.wpAt(t),
    };
  }),
};
console.log(JSON.stringify(out));
