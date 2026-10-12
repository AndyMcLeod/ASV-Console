"""tests/chart_read_stall.py - a chart read must not stop the console.

Andy, 2026-10-11: "the telemetry-pause fix". Measured first (scratchpad stall_probe.py, a 4 Hz thread standing in for
the telemetry loop, and an SSE gap monitor on live consoles): opening a cached 29.6 MB tile with `json.load` held the
GIL 1.5 s in one C call, and a fresh build parses each of NOAA's answers the same way, two dozen at once in a live
read - the telemetry stream stopped for 2-6 s and the page said TELEMETRY STALE. The fix (asv_console.py, "A CHART READ
MUST NOT STOP THE CONSOLE"): a tile is BUILT in a child process (`asv_console.py --enc-tile-worker`) and KEPT one
feature per line (tile_v2_<key>.jsonl), read back in small parses.

WHAT IS PINNED - each cadence check against the old way as its CONTROL, so it is seen to be able to fail:
  1    the tile file: read back whole; cut short, miscounted, garbled or missing - not read (and so read again);
  2    READING A BIG TILE keeps a 20 Hz thread's cadence, where one `json.loads` of the same tile stalled it;
  2b   a tile in memory frozen out of the collector's walk, where (the control) walked it costs every full collection;
  2c   the garbage collector held while tiles are read (until the LAST of several readers is done), the tile frozen out
       of later collections, and the collector given back as it was found - a failed read too;
  3    THE CHILD builds the tile (the real worker, NOAA stood in for by ASV_ENC_TILE_FAKE): the harbor chart whole, a
       coarser one cut, kept on disk and read from there next time without another child;
  3b   a child that found a layer missing: served, not kept; one that crashed, wrote a tile and then failed, or found
       NOAA unreachable: the tile unread (failed), nothing left behind, the breaker set for the last;
  3c   a tile kept the old way (tile_v1, one JSON) carried over by a child, NOAA down and the breaker set, the old copy
       removed; a cut-short old copy not served;
  4    WHILE A CHILD BUILDS a tile whose answers are as big as NOAA's, the console's thread keeps its cadence - where the
       same build in this process stalls it;
  5    the wiring: built in a child by default, the worker dispatched before anything else starts.

  python tests/chart_read_stall.py   # exit 0 = pass
"""
import gc
import json
import os
import shutil
import sys
import tempfile
import threading
import time


def _crash_report(_t, _e, _tb):
    import traceback
    print("  FAIL 0. the suite itself CRASHED before finishing - %s: %s" % (_t.__name__, _e))
    print("".join(traceback.format_exception(_t, _e, _tb))[-800:])
    print("\n1 CHECK(S) FAILED (crashed before finishing)")


sys.excepthook = _crash_report

APP = os.environ.get("ASV_APP") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)
import asv_console as A                                       # noqa: E402

fails = 0
ran = 0


def check(name, cond, detail=""):
    global fails, ran
    ran += 1
    try:
        ok = bool(cond()) if callable(cond) else bool(cond)
        if callable(detail):
            detail = detail()
    except Exception as e:
        ok = False
        detail = "threw %s: %s" % (type(e).__name__, e)
    print(("  ok   " if ok else "  FAIL ") + name + ("   [" + str(detail) + "]" if detail else ""))
    if not ok:
        fails += 1


def cadence(fn, period=0.05):
    """Run fn while a thread ticks every `period`; the worst gap between its ticks, and fn's result. Each tick builds a
    small frame, as the telemetry loop does: a thread that allocates nothing never sets off a collection, and so cannot
    feel one (a freeze-less hold read 0.06 s here, while the next collection after it costs 0.9 s)."""
    ticks, stop = [], [False]

    def tick():
        while not stop[0]:
            ticks.append(time.perf_counter())
            frame = {"t": ticks[-1], "nav": [{"lat": 43.0, "lon": -70.7} for _ in range(20)]}
            del frame
            time.sleep(period)
    t = threading.Thread(target=tick, daemon=True)
    t.start()
    time.sleep(0.2)
    r = fn()
    time.sleep(0.2)
    stop[0] = True
    t.join(2)
    return max(b - a for a, b in zip(ticks, ticks[1:])), r


def sq(W, S, E, N):
    return [[W, S], [E, S], [E, N], [W, N], [W, S]]


TMP = tempfile.mkdtemp(prefix="asv_chart_stall_")
A.ENC_DIR = TMP
print("A chart read must not stop the console:")

# ── 1. the tile file ──────────────────────────────────────────────────────────────────────────────────────────────
tile = [-70.75, 43.0, -70.5, 43.25]
got = {"tile": tile, "bands": ["enc_harbour"], "unread": [], "unread_failed": [], "partial": [], "complete": True,
       "features": [{"role": "land", "cls": "Land_Area", "props": {"OBJNAM": "x"}, "oid": i,
                     "geometry": {"type": "Polygon", "coordinates": [sq(-70.7 + i * 1e-3, 43.1, -70.69 + i * 1e-3, 43.11)]}}
                    for i in range(50)]}
path = A._tile_path(tile)
A._write_tile_jsonl(path, got)
back = A._read_tile_jsonl(path)
raw = open(path, "rb").read()
open(path, "wb").write(raw[:-25])                     # cut short inside the last line
cut = A._read_tile_jsonl(path)
lines = raw.decode("utf-8").splitlines()
open(path, "w", encoding="utf-8").write("\n".join(lines[:-1]) + "\n")   # one whole line short: the count says so
short = A._read_tile_jsonl(path)
open(path, "w", encoding="utf-8").write("not json\n" + "\n".join(lines[1:]) + "\n")
garbled = A._read_tile_jsonl(path)
os.remove(path)
missing = A._read_tile_jsonl(path)
check("1. THE TILE FILE reads back whole (header and every feature, `n` the count); cut short inside a line, a line "
      "short of its count, a garbled header, or missing - NOT read, so the tile is read again",
      lambda: back is not None and back["features"] == got["features"] and back["n"] == 50 and back["bands"] == ["enc_harbour"]
              and cut is None and short is None and garbled is None and missing is None,
      lambda: "back %s; cut %s short %s garbled %s missing %s" % (back is not None, cut, short, garbled, missing))

# ── 2. reading a big tile ─────────────────────────────────────────────────────────────────────────────────────────
ring = sq(0, 0, 1, 1) * 10                             # a 50-vertex ring
big = {"tile": tile, "bands": ["enc_harbour"], "unread": [], "unread_failed": [], "partial": [], "complete": True,
       "features": [{"role": "depth_area", "cls": "Depth_Area", "props": {"DRVAL1": 2.5 + i % 7, "DRVAL2": 9.0}, "oid": i,
                     "geometry": {"type": "Polygon", "coordinates": [[[-70.7 + p[0] * 1e-3, 43.1 + p[1] * 1e-3] for p in ring]]}}
                    for i in range(22000)]}
A._write_tile_jsonl(path, big)
size_mb = os.path.getsize(path) / 1e6
whole = json.dumps(big)
new_gap, rb = cadence(lambda: A._read_tile_jsonl(path))
old_gap, _ctl = cadence(lambda: json.loads(whole))    # the old way: the tile as ONE parse
check("2. READING A BIG TILE (%.0f MB, 22,000 features) line by line keeps a 20 Hz thread's cadence (worst gap %.2f s), "
      "where the same tile parsed as one JSON - the old tile file - stalled it %.2f s" % (size_mb, new_gap, old_gap),
      lambda: rb is not None and len(rb["features"]) == 22000 and new_gap < 0.25 and old_gap > max(0.3, 2 * new_gap),
      lambda: "line by line %.2f s, one parse %.2f s" % (new_gap, old_gap))
del _ctl, whole

# ── 2b. what a tile in memory costs every collection after ─────────────────────────────────────────────────────────
t0 = time.perf_counter()
gc.collect()
frozen_full = time.perf_counter() - t0
gc.unfreeze()                                          # THE CONTROL: the same objects, walked
t0 = time.perf_counter()
gc.collect()
thawed_full = time.perf_counter() - t0
gc.freeze()
check("2b. WITH THE TILE IN MEMORY, a full collection - which can come at any moment, reading or not - takes %.3f s, "
      "where the same objects left in the collector's walk take %.2f s: what was read is frozen out of it"
      % (frozen_full, thawed_full),
      lambda: rb is not None and frozen_full < 0.1 and thawed_full > max(0.15, 4 * frozen_full),
      lambda: "frozen %.3f s, walked %.3f s" % (frozen_full, thawed_full))

# ── 2c. the collector held, and given back ─────────────────────────────────────────────────────────────────────────
gc.enable()
h1, h2 = A._GcHeld(), A._GcHeld()
frozen0 = gc.get_freeze_count()
h1.__enter__()
in_one = gc.isenabled()
h2.__enter__()
h1.__exit__(None, None, None)                          # the first reader done, the second still reading
in_two = gc.isenabled()
_young = [[i] for i in range(2000)]                     # objects made while held: the freeze must take them
h2.__exit__(None, None, None)
after = gc.isenabled()
frozen1 = gc.get_freeze_count()
# FROZEN, asked of the objects themselves: gc.get_objects() lists what the collector walks, and a frozen object is not in
# it - where the CONTROL, an object made after, is. (A count of frozen objects is no test: one frozen earlier and freed
# in between takes it down - it failed so once, alongside other suites.)
_after = [0]
_walked = gc.get_objects()
young_frozen = not any(o is _young[7] for o in _walked)
after_walked = any(o is _after for o in _walked)
del _walked
gc.disable()
rd = A._read_tile_jsonl(path)
kept_off = not gc.isenabled()
gc.enable()
open(path, "w", encoding="utf-8").write("not json\n")
bad = A._read_tile_jsonl(path)
back_on = gc.isenabled()
check("2c. THE COLLECTOR is held while tiles are read - still held while a SECOND reader reads after the first is done - "
      "and given back when the last is; what was read is FROZEN out of later collections; a collector found off is "
      "left off, and a read that FAILS gives it back too",
      lambda: not in_one and not in_two and after and young_frozen and after_walked and rd is not None and kept_off
              and bad is None and back_on,
      lambda: "held %s/%s, after %s, made while held frozen %s (made after, walked %s; frozen +%d), found off kept "
              "off %s, failed read gives back %s"
              % (not in_one, not in_two, after, young_frozen, after_walked, frozen1 - frozen0, kept_off, back_on))
os.remove(path)

# ── 3. the child ──────────────────────────────────────────────────────────────────────────────────────────────────
inner = [[-70.70, 43.05], [-70.55, 43.05], [-70.55, 43.20], [-70.70, 43.20], [-70.70, 43.05]]
# the coastal chart covers every tile this suite builds (here and in 3b and 4); the harbor chart only the first
outer = [[-70.75, 43.0], [-69.25, 43.0], [-69.25, 43.25], [-70.75, 43.25], [-70.75, 43.0]]
FAKE = {"coverage": {"enc_harbour": [[inner]], "enc_coastal": [[outer]]},
        "features": {"enc_harbour": [{"role": "dock", "cls": "Shoreline_Construction_area", "props": {}, "oid": 1,
                                      "geometry": {"type": "Polygon", "coordinates": [sq(-70.66, 43.10, -70.659, 43.101)]}}],
                     "enc_coastal": [{"role": "land", "cls": "Land_Area", "props": {}, "oid": 2,
                                      "geometry": {"type": "Polygon", "coordinates": [sq(-70.74, 43.11, -70.51, 43.14)]}}]}}
fake_path = os.path.join(TMP, "fake.json")
runs = []
_run = A.subprocess.run


def counted(*a, **k):
    runs.append(a[0])
    return _run(*a, **k)


A.subprocess.run = counted


def build(fake, t=tile):
    json.dump(fake, open(fake_path, "w", encoding="utf-8"))
    os.environ["ASV_ENC_TILE_FAKE"] = fake_path
    A._enc_tile_mem.clear()
    A._enc_down_until = 0.0
    return A.fetch_enc_tile(t)


try:
    c1 = build(FAKE)
    kept = os.path.exists(A._tile_path(tile))
    n1 = len(runs)
    A._enc_tile_mem.clear()
    c2 = A.fetch_enc_tile(tile)                         # from the disk: no child
    land = [f for f in c1["features"] if f["band"] == "enc_coastal"]
    check("3. THE CHILD (the real worker, NOAA stood in for): one child per build, the harbor chart WHOLE, the coastal "
          "land CUT (pieces outside the harbor chart's coverage), the tile kept on disk - and read from there next time with "
          "NO child",
          lambda: n1 == 1 and "--enc-tile-worker" in runs[0] and c1.get("complete") and kept
                  and [f["oid"] for f in c1["features"] if f["band"] == "enc_harbour"] == [1]
                  and not any("clip" in f for f in c1["features"] if f["band"] == "enc_harbour")
                  and land and all("clip" in f for f in land) and len(runs) == 1 and len(c2["features"]) == len(c1["features"]),
          lambda: "children %d (then %d), complete %s, kept %s, harbor %s, coastal pieces %d"
                  % (n1, len(runs), c1.get("complete"), kept, [f["oid"] for f in c1["features"] if f["band"] == "enc_harbour"], len(land)))
    t2 = [-70.5, 43.0, -70.25, 43.25]
    p1 = build(dict(FAKE, partial={"enc_coastal": ["Depth_Area"]}), t2)
    p_kept = os.path.exists(A._tile_path(t2))
    k1 = build({"crash": True}, [-70.25, 43.0, -70.0, 43.25])
    e1 = build(dict(FAKE, exit_after_write=4), t2)     # a whole tile written, then a failing exit: not trusted
    e_kept = os.path.exists(A._tile_path(t2))
    o1 = build({"offline": True}, [-70.0, 43.0, -69.75, 43.25])
    breaker = A._enc_down_until > time.monotonic()
    leftovers = [f for f in os.listdir(TMP) if f.endswith(".build") or f.endswith(".part")]
    check("3b. a child that found a layer MISSING: served (`partial` says which), NOT kept; one that CRASHED, or wrote "
          "a tile and then FAILED: the tile unread (failed) with the reason, and the file it wrote removed; one that "
          "found NOAA UNREACHABLE: unread (failed) and the console's breaker set; no half-written file left behind",
          lambda: p1.get("partial") == ["Depth_Area"] and not p1.get("complete") and not p_kept
                  and k1.get("unread_failed") and "chart reader failed (exit 3)" in (k1.get("note") or "")
                  and e1.get("unread_failed") and "chart reader failed (exit 4)" in (e1.get("note") or "") and not e_kept
                  and o1.get("unread_failed") and "coverage could not be read" in (o1.get("note") or "") and breaker
                  and not leftovers,
          lambda: "partial %s kept %s; crash %r; wrote-then-failed %r kept %s; offline %r breaker %s; leftovers %s"
                  % (p1.get("partial"), p_kept, k1.get("note"), e1.get("note"), e_kept, o1.get("note"), breaker, leftovers))

    # ── 3c. a tile kept the old way ───────────────────────────────────────────────────────────────────────────────
    t5, t6 = [-69.25, 43.0, -69.0, 43.25], [-69.0, 43.0, -68.75, 43.25]
    old = {"tile": t5, "bands": ["enc_coastal"], "unread": [], "unread_failed": [], "partial": [], "complete": True,
           "features": [{"role": "land", "cls": "Land_Area", "props": {}, "oid": 77, "band": "enc_coastal",
                         "geometry": {"type": "Polygon", "coordinates": [sq(-69.2, 43.1, -69.1, 43.2)]}}]}
    json.dump(old, open(A._legacy_tile_path(t5), "w", encoding="utf-8"))
    open(A._legacy_tile_path(t6), "w", encoding="utf-8").write('{"tile": [')     # cut short: not a tile
    json.dump({"offline": True}, open(fake_path, "w", encoding="utf-8"))           # NOAA unreachable throughout
    A._enc_tile_mem.clear()
    A._enc_down_until = time.monotonic() + 30.0       # and the breaker set: only the old copy can answer
    n5 = len(runs)
    v5 = A.fetch_enc_tile(t5)
    v5_children = len(runs) - n5
    v2_kept, v1_gone = os.path.exists(A._tile_path(t5)), not os.path.exists(A._legacy_tile_path(t5))
    A._enc_tile_mem.clear()
    v5b = A.fetch_enc_tile(t5)                         # from the new file now
    v6 = A.fetch_enc_tile(t6)
    check("3c. A TILE KEPT THE OLD WAY (one JSON) is carried over by a child - with NOAA unreachable and the breaker "
          "set - kept as a tile file and the old copy removed, then read from the new one; an old copy that is not a "
          "whole tile is not served",
          lambda: v5.get("complete") and [f["oid"] for f in v5["features"]] == [77] and v5_children == 1
                  and v2_kept and v1_gone and [f["oid"] for f in v5b["features"]] == [77] and v6.get("unread_failed"),
          lambda: "complete %s oids %s children %d, kept %s, old copy gone %s, read again %s; cut-short copy %r"
                  % (v5.get("complete"), [f["oid"] for f in v5.get("features") or []], v5_children, v2_kept, v1_gone,
                     [f["oid"] for f in v5b.get("features") or []], v6.get("note")))

    # ── 4. the console's cadence while a child builds ─────────────────────────────────────────────────────────────
    HEAVY = dict(FAKE, parse_mb=25)                    # each band's answer as big as NOAA's, parsed as one
    t3, t4 = [-69.75, 43.0, -69.5, 43.25], [-69.5, 43.0, -69.25, 43.25]
    child_gap, cg = cadence(lambda: build(HEAVY, t3))
    # THE CONTROL: the same build in THIS process - its parse holds this process's GIL
    A.ENC_TILE_IN_PROCESS = True
    _cov, _feat = A._enc_coverage, A.fetch_enc_features
    A._enc_coverage = lambda band, t: HEAVY["coverage"].get(band, [])

    def heavy_feats(region, md=0.0, band=None, extras=True, use_cache=True):
        json.loads("[" + ",".join(["[1.2345678, 42.1234567]"] * int(25 * 40000)) + "]")
        return {"band": band, "features": [dict(x) for x in HEAVY["features"].get(band, [])], "partial": []}
    A.fetch_enc_features = heavy_feats
    try:
        here_gap, hg = cadence(lambda: build(HEAVY, t4))
    finally:
        A.ENC_TILE_IN_PROCESS = False
        A._enc_coverage, A.fetch_enc_features = _cov, _feat
    check("4. WHILE A CHILD BUILDS a tile whose answers are as big as NOAA's, this process's 20 Hz thread keeps its cadence "
          "(worst gap %.2f s) - the SAME build in this process stalls it %.2f s" % (child_gap, here_gap),
          lambda: cg.get("complete") and hg.get("complete") and child_gap < 0.25 and here_gap > max(0.3, 2 * child_gap),
          lambda: "child %.2f s, in this process %.2f s" % (child_gap, here_gap))
finally:
    A.subprocess.run = _run
    os.environ.pop("ASV_ENC_TILE_FAKE", None)

# ── 5. the wiring ─────────────────────────────────────────────────────────────────────────────────────────────────
src = open(os.path.join(APP, "asv_console.py"), encoding="utf-8").read()
main_at = src.index('if __name__ == "__main__":')
check("5. THE WIRING: a tile is built in a child by default (ENC_TILE_IN_PROCESS False, fetch_enc_tile's else), kept "
      "as tile_v2 lines, and the worker is dispatched before main() starts anything",
      lambda: A.ENC_TILE_IN_PROCESS is False and "got = _enc_tile_build_child(tile)" in src
              and A._ENC_TILE_FMT == "tile_v2_%s.jsonl"
              and src.index('sys.argv[1] == "--enc-tile-worker"', main_at) < src.index("    main()", main_at),
      "asv_console.py")

shutil.rmtree(TMP, ignore_errors=True)
print("\n" + ("%d CHECK(S) FAILED (%d ran)" % (fails, ran) if fails else "all checks passed (%d)" % ran))
sys.exit(1 if fails else 0)
