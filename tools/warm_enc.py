"""tools/warm_enc.py - pre-download the FULL ENC extract for every operating port.

Andy, 2026-08-31: "download all layers when entering a new area. review database and
download all layers now for all sites."

The console already downloads every published layer on first entering an area - that is
the `extra` role in `fetch_enc_features`. This tool does the same work AHEAD of time, for
every port in the registry, so the first Punch Out at a base is not also the first fetch.

WHY IT EXISTS AT ALL, which is the same reason the `extra` role does: a cache does not
know what it does not contain. Adding a role later cannot see an area already cached -
that is how the `fairway` role shipped and would never have applied anywhere the console
had already been. Holding the WHOLE extract makes the cache complete for the area rather
than complete for whatever the roles happened to be that day, and warming it means the
completeness is there before anyone is standing on a pier waiting for it.

    python tools/warm_enc.py                 # every port in ports.json
    python tools/warm_enc.py --base lewes_de # one of them
    python tools/warm_enc.py --list          # what is cached now, and at which version
    python tools/warm_enc.py --prune         # DELETE superseded-version caches (asks first)

⚠ IT REPORTS PER ROLE, NOT JUST A TOTAL. A count of features is not evidence the extract
is any good: NOAA's ENCDirect reports failure as a normal-looking EMPTY layer, so "0
features" and "this area genuinely has none" are the same answer from the outside. The
per-role table is what lets a human tell a quiet harbour from a dead fetch - a port with
land and soundings but zero shoreline is a fetch that half-failed, not a lake.
"""

import argparse
import json
import math
import os
import sys
import time

APP = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
sys.path.insert(0, APP)

import asv_console as A                                              # noqa: E402

# The console's own operating-area half-extent, from static/asv.html's NOGO_RADIUS_M.
# Stated here rather than imported because it lives in the page, not the server - if the
# page's value moves, this comment is the thing that has to move with it.
NOGO_RADIUS_M = 5000
M_PER_DEG_LAT = 111320.0


def bbox_around(lat, lon, rad_m=NOGO_RADIUS_M):
    """The same box the client asks for: half-extent `rad_m` about the point."""
    dlat = rad_m / M_PER_DEG_LAT
    dlon = rad_m / (M_PER_DEG_LAT * math.cos(math.radians(lat)))
    return (lon - dlon, lat - dlat, lon + dlon, lat + dlat)


def cache_version():
    """The CURRENT cache version, read from the source. Never restated - the whole point
    of this tool is defeated if it warms a version the console does not read.

    ⚠ RETURNS THE BARE TAG ("v5"), WHICH IS WHAT `inventory()` PARSES OUT OF A FILENAME.
    It returned the whole prefix ("features_v5") at first and nothing ever matched, so
    every version on disk - INCLUDING THE CURRENT ONE - was reported "superseded, ignored
    by the console" and `--prune` would have offered to delete the cache the console is
    actually reading. Nothing failed; the listing just quietly said the wrong thing, and
    it took reading the output rather than trusting it. The two halves are pinned to one
    format now, and prune refuses the live version outright besides.
    """
    import re
    src = open(os.path.join(APP, "asv_console.py"), encoding="utf-8").read()
    m = re.search(r'"features_(v\d+)_%s\.json"', src)
    if not m:
        raise SystemExit("cannot find the feature cache version in asv_console.py")
    return m.group(1)


def load_ports(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def inventory(enc_dir, cur):
    """What is on disk, by cache version. Anything not `cur` is dead weight the console
    already ignores."""
    import collections
    byver = collections.defaultdict(lambda: [0, 0])
    for fn in os.listdir(enc_dir):
        if not fn.startswith("features_v") or not fn.endswith(".json"):
            continue
        ver = fn.split("_")[1]
        byver[ver][0] += 1
        byver[ver][1] += os.path.getsize(os.path.join(enc_dir, fn))
    return byver


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--ports-config", default=os.path.join(APP, "ports.json"))
    ap.add_argument("--base", help="warm one port id instead of all of them")
    ap.add_argument("--radius-m", type=float, default=NOGO_RADIUS_M)
    ap.add_argument("--list", action="store_true", help="inventory only, fetch nothing")
    ap.add_argument("--prune", action="store_true",
                    help="delete caches from superseded versions (prompts first)")
    args = ap.parse_args()

    enc_dir = A.ENC_DIR
    os.makedirs(enc_dir, exist_ok=True)
    cur = cache_version()
    print("cache version in force: %s" % cur)

    inv = inventory(enc_dir, cur)
    print("\nCACHED EXTRACTS ON DISK")
    dead = []
    for ver in sorted(inv):
        n, size = inv[ver]
        tag = "<- CURRENT, in use" if ver == cur else "superseded, ignored by the console"
        print("   %-5s %4d extracts %8.1f MB   %s" % (ver, n, size / 1e6, tag))
        if ver != cur:
            dead.append(ver)
    # ⚠ BELT AND BRACES, and it earned its place: the version comparison above was broken
    # on the first run (whole prefix vs bare tag) and every version read as superseded.
    # A delete mode must not be one string mismatch away from removing the live cache.
    dead = [v for v in dead if v != cur]
    if cur not in inv:
        print("   (nothing cached at the current version yet)")

    if args.prune:
        if not dead:
            print("\nnothing to prune - every cache on disk is the current version")
        else:
            total = sum(inv[v][1] for v in dead)
            print("\nPRUNE would DELETE %d extracts (%.1f MB) from versions %s."
                  % (sum(inv[v][0] for v in dead), total / 1e6, ", ".join(dead)))
            # ⚠ ASKS, ALWAYS. These are big files that cost real time to refetch, and a
            # tool that quietly deletes 600 MB because a flag was passed is a tool nobody
            # should run on a boat. The console already ignores them, so keeping them
            # costs only disk.
            if input("   type DELETE to confirm: ").strip() != "DELETE":
                print("   left alone.")
            else:
                gone = 0
                for fn in os.listdir(enc_dir):
                    if fn.startswith("features_v") and fn.split("_")[1] in dead:
                        os.remove(os.path.join(enc_dir, fn))
                        gone += 1
                print("   deleted %d file(s)." % gone)

    if args.list:
        return 0

    ports = load_ports(args.ports_config)["ports"]
    if args.base:
        ports = [p for p in ports if p["id"] == args.base]
        if not ports:
            raise SystemExit("no port with id %r" % args.base)

    print("\nWARMING %d site(s) at %.0f m half-extent - every published layer\n"
          % (len(ports), args.radius_m))
    worst = 0
    for p in ports:
        bbox = bbox_around(p["lat"], p["lon"], args.radius_m)
        key = A._bbox_key(bbox)
        # "features_" + the bare tag. `cur` is the TAG ("v5"), not the whole prefix - the
        # same distinction that had the listing calling the live cache superseded.
        hit = os.path.exists(os.path.join(enc_dir, "features_%s_%s.json" % (cur, key)))
        t0 = time.time()
        try:
            d = A.fetch_enc_features(bbox)
        except Exception as e:                                       # noqa: BLE001
            print("  %-20s FAILED  %s: %s" % (p["id"], type(e).__name__, e))
            worst = 2
            continue
        dt = time.time() - t0
        feats = d.get("features") or []
        roles = {}
        for ft in feats:
            roles[ft.get("role")] = roles.get(ft.get("role"), 0) + 1
        band = d.get("band")
        print("  %-20s %-14s %6d features in %5.1f s %s"
              % (p["id"], band or "NO COVERAGE", len(feats), dt, "(cached)" if hit else ""))
        if not band:
            print("        %s" % (d.get("note") or "no band"))
            worst = max(worst, 1)
            continue
        # ⚠ THE PER-ROLE LINE IS THE EVIDENCE. ENCDirect reports failure as an empty
        # layer, so a bare total cannot tell a quiet harbour from a half-dead fetch.
        for r in sorted(roles, key=lambda k: -roles[k]):
            print("        %-14s %6d" % (r, roles[r]))
        for want in ("land", "shore_line", "depth_area"):
            if not roles.get(want):
                print("        ⚠ NO %s - a coastal extract with none of these is "
                      "suspect, not empty water" % want)
                worst = max(worst, 1)
    return worst


if __name__ == "__main__":
    sys.exit(main())
