"""tests/lib/corridor_console.py - the console's own corridor job code behind a line protocol, for the page's suites.

The page's side of a chart read (corridorStart, corridorWait, passagePlanFor, coarseHomeBuild) is driven in Node with
the console stubbed, and a stub answers what its author believes the console does. TWO READERS OF ONE JOB is a fact
about the console (corridor_start: the same tiles are the same job, whichever way the route runs), and a defect that
lives between the two - one reader stopping the read the other waits on, 2026-11-15 - is in neither stub. So the checks
that depend on it put the page's own asks to the console's own code: asv_console.corridor_post and corridor_status,
with the tile reads alone stubbed - each waits on a gate the suite opens, so a read is "running" for as long as the
check needs it to be.

One JSON object a line on stdin, one answer a line on stdout, in order:
  {"op": "post", "body": {...}}  -> {"status": 200|400|404, "body": {...}}   POST /api/enc/corridor (corridor_post)
  {"op": "get", "id": "..."}     -> {"status": 200|404, "body": {...}}       GET /api/enc/corridor?id=
  {"op": "open"} / {"op": "shut"} -> {"ok": true}    tile reads answer / wait (they start shut)
  {"op": "seen"}                 -> {"posts": [bodies, in order], "reads": tiles asked of the tile reader so far,
                                     "jobs": [{id, state, cancel, total, done, asks}]}
Ends when stdin does. No console is started, no port opened, no chart file read or written. (Importing the app starts
its monitors' threads, as in every suite that imports it - tests/enc_corridor.py is one; they end with this process.)

  ASV_APP names the app to import (a mutation run's sidecar copy); this file's own app otherwise.
"""
import json
import os
import sys
import threading

proto = sys.stdout
sys.stdout = sys.stderr                         # the app's own prints are not protocol lines

APP = os.environ.get("ASV_APP") or os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..")
sys.path.insert(0, APP)
import asv_console as A                         # noqa: E402

gate = threading.Event()
reads = []
posts = []
GATE_WAIT_S = 60.0                              # a suite that died leaves no thread waiting for good


def fake_grid(tile):
    """A tile's grid header, read whole from a general chart - once the gate is open."""
    reads.append(list(tile))
    gate.wait(GATE_WAIT_S)
    return ({"tile": list(tile), "bands": ["enc_general"], "unread": [], "unread_failed": [], "partial": [],
             "complete": True}, b"")


def fake_tile(tile):
    reads.append(list(tile))
    gate.wait(GATE_WAIT_S)
    return {"tile": list(tile), "bands": ["enc_general"], "unread": [], "unread_failed": [], "partial": [],
            "complete": True}


A.fetch_enc_grid = fake_grid
A.fetch_enc_tile = fake_tile


def answer(req):
    op = req.get("op")
    if op == "post":
        posts.append(req.get("body"))
        status, body = A.corridor_post(req.get("body") or {})
        return {"status": status, "body": body}
    if op == "get":
        st = A.corridor_status(str(req.get("id")))
        if st is None:
            return {"status": 404, "body": {"error": "no such corridor read"}}
        return {"status": 200, "body": st}
    if op == "open":
        gate.set()
        return {"ok": True}
    if op == "shut":
        gate.clear()
        return {"ok": True}
    if op == "seen":
        with A._corridor_lock:
            jobs = [{"id": j["id"], "state": j["state"], "cancel": bool(j["cancel"]), "total": j["total"],
                     "done": j["done"], "asks": j.get("asks")} for j in A._corridor_jobs.values()]
        return {"posts": list(posts), "reads": len(reads), "jobs": jobs}
    return {"error": "no such op: %r" % (op,)}


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        out = answer(json.loads(line))
    except Exception as e:                      # said on the line: a suite waiting on an answer gets one
        out = {"error": "%s: %s" % (type(e).__name__, e)}
    proto.write(json.dumps(out) + "\n")
    proto.flush()
gate.set()
