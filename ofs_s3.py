"""ofs_s3.py - NOAA's OFS surface currents from its open-data S3 bucket, for when the CO-OPS model server is down.

Andy, 2026-10-09: "add an S3 fallback for NOAA's model server". The console reads a NOAA Operational Forecast System
through the CO-OPS THREDDS server (currents.py, vendored - do not edit), and on 2026-10-08 and 09 that server answered
HTTP 503 for every model all day, so no port had a model current. NOAA publishes the same files to its open-data bucket
(noaa-nos-ofs-pds on AWS), which answered throughout - but as whole netCDF-4 files of 100-600 MB each, not as the
server-side subsets THREDDS hands out.

THIS READS ONLY WHAT IT NEEDS, WITH THE STANDARD LIBRARY. The console is Python-standard-library only (README: "No pip,
no build step"), so there is no h5py here: this is a small reader for exactly the HDF5 structures those files use,
MEASURED on wcofs, gomofs, dbofs and leofs files of 2026-10-09 - superblock 2, version-2 object headers, dense link and
attribute storage (a fractal heap behind a depth-0 version-2 B-tree), layout version 3 with contiguous 2-D grids and
u/v chunked behind a version-1 B-tree, and NO compression. Uncompressed chunks are what make it cheap: the surface rows
inside the boat's box are one HTTP range read per chunk, tens of kilobytes per frame instead of the whole file. Anything
outside that set raises H5Error, saying what it met, rather than guessing.

IT WRITES currents.py's OWN CACHE (`{tag}_meta.json` + `{tag}_uv.bin.gz`, the same fields, big-endian float32 u then v
per frame in time order), so currents.Currents loads an S3 cycle exactly as it loads a THREDDS one - the projection by
tidal cycles, the stream fusion's calibration and the Current pill all work unchanged - and the meta says `via: s3`.

AND IT READS EACH FILE'S OWN TIME UNITS. currents.py assumes seconds since 2016-01-01 for every model; LEOFS writes
"seconds since 2015-01-01" (measured 2026-10-09), so its frames read through THREDDS land a year off. Here the units
attribute is parsed and the times are converted to currents' epoch.
"""

import gzip
import json
import math
import re
import struct
import threading
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import currents

BUCKET = "https://noaa-nos-ofs-pds.s3.amazonaws.com/"
TIMEOUT = 60
BLOCK = 64 * 1024                  # metadata block size: every structure above sat in the first block of every file
UA = {"User-Agent": "ASV-Console/1.0"}
SIG = b"\x89HDF\r\n\x1a\n"
UNDEF = (1 << 64) - 1


class H5Error(RuntimeError):
    """An HDF5 structure this reader was not written for, or a file that is not what it should be."""


# --------------------------------------------------------------------------- #
#  Byte sources
# --------------------------------------------------------------------------- #
class HttpRange:
    """A remote file read by HTTP range requests: metadata through a 64 KB block cache, bulk data straight."""

    def __init__(self, url, timeout=TIMEOUT):
        self.url, self.timeout = url, timeout
        self._blocks = {}
        self._lock = threading.Lock()
        self.requests = 0

    def _get(self, off, n):
        req = urllib.request.Request(self.url, headers=dict(UA, Range="bytes=%d-%d" % (off, off + n - 1)))
        with urllib.request.urlopen(req, timeout=self.timeout) as r:
            data = r.read()
        with self._lock:
            self.requests += 1
        return data

    def read(self, off, n):
        out = bytearray()
        for b in range(off // BLOCK, (off + n - 1) // BLOCK + 1):
            with self._lock:
                blk = self._blocks.get(b)
            if blk is None:
                blk = self._get(b * BLOCK, BLOCK)
                with self._lock:
                    self._blocks[b] = blk
            out += blk
        s = off - (off // BLOCK) * BLOCK
        got = bytes(out[s:s + n])
        if len(got) != n:
            raise H5Error("short read at %d (+%d) of %s" % (off, n, self.url))
        return got

    def read_raw(self, off, n):
        got = self._get(off, n)
        if len(got) != n:
            raise H5Error("short range read at %d (+%d) of %s: %d bytes" % (off, n, self.url, len(got)))
        return got


class LocalFile:
    """A local file with the same two calls - the test fixtures."""

    def __init__(self, path):
        with open(path, "rb") as f:
            self.data = f.read()
        self.requests = 0

    def read(self, off, n):
        got = self.data[off:off + n]
        if len(got) != n:
            raise H5Error("short read at %d (+%d)" % (off, n))
        return got

    read_raw = read


def _u(b, p, n):
    return int.from_bytes(b[p:p + n], "little")


# --------------------------------------------------------------------------- #
#  HDF5 - the structures NOAA's regulargrid files use, and no others
# --------------------------------------------------------------------------- #
class H5:
    def __init__(self, src):
        self.src = src
        sb = src.read(0, 64)
        if sb[:8] != SIG:
            raise H5Error("not an HDF5 file")
        if sb[8] not in (2, 3):
            raise H5Error("superblock version %d (this reader knows 2 and 3)" % sb[8])
        self.so, self.sl = sb[9], sb[10]
        p = 12
        self.base = _u(sb, p, self.so)
        p += 3 * self.so                                      # base, superblock extension, end of file
        self.root = _u(sb, p, self.so)
        self._links = None

    # -- object headers --------------------------------------------------------
    def messages(self, addr):
        """[(type, body)] of the object header at `addr`, its continuation blocks included."""
        so, sl = self.so, self.sl
        h = self.src.read(addr, 16)
        out = []
        if h[:4] == b"OHDR":
            if h[4] != 2:
                raise H5Error("object header version %d" % h[4])
            flags = h[5]
            q = addr + 6 + (16 if flags & 0x20 else 0) + (4 if flags & 0x10 else 0)
            sz = 1 << (flags & 3)
            clen = _u(self.src.read(q, sz), 0, sz)
            blocks = [(q + sz, clen)]
            mh = 4 + (2 if flags & 0x04 else 0)
            while blocks:
                start, length = blocks.pop(0)
                data = self.src.read(start, length)
                i = 0
                while i + mh <= len(data):
                    t, s = data[i], _u(data, i + 1, 2)
                    body = data[i + mh:i + mh + s]
                    i += mh + s
                    out.append((t, body))
                    if t == 0x10:                             # continuation -> an OCHK block
                        caddr, cl = _u(body, 0, so), _u(body, so, sl)
                        if self.src.read(caddr, 4) != b"OCHK":
                            raise H5Error("continuation block without OCHK at %d" % caddr)
                        blocks.append((caddr + 4, cl - 8))
            return out
        if h[0] == 1:
            hsize = _u(h, 8, 4)
            blocks = [(addr + 16, hsize)]
            while blocks:
                start, length = blocks.pop(0)
                data = self.src.read(start, length)
                i = 0
                while i + 8 <= len(data):
                    t, s = _u(data, i, 2), _u(data, i + 2, 2)
                    body = data[i + 8:i + 8 + s]
                    i += 8 + s
                    out.append((t, body))
                    if t == 0x10:
                        blocks.append((_u(body, 0, so), _u(body, so, sl)))
            return out
        raise H5Error("no object header at %d" % addr)

    # -- fractal heap + v2 B-tree (dense links and dense attributes) ------------
    def _heap(self, addr):
        h = self.src.read(addr, 256)
        if h[:4] != b"FRHP":
            raise H5Error("no fractal heap at %d" % addr)
        so, sl = self.so, self.sl
        p = 5
        id_len = _u(h, p, 2)
        io_len = _u(h, p + 2, 2)
        p += 5 + 4 + sl + so + sl + so + sl + sl + sl + sl + 4 * sl
        width = _u(h, p, 2)
        p += 2
        start_block = _u(h, p, sl)
        p += sl
        max_direct = _u(h, p, sl)
        p += sl
        max_heap_bits = _u(h, p, 2)
        p += 4
        root = _u(h, p, so)
        p += so
        rows = _u(h, p, 2)
        if io_len:
            raise H5Error("filtered fractal heap")
        return {"id_len": id_len, "width": width, "start": start_block, "max_direct": max_direct,
                "off_bytes": (max_heap_bits + 7) // 8, "root": root, "rows": rows}

    def _heap_object(self, heap, hid):
        if (hid[0] >> 4) & 3:
            raise H5Error("huge or tiny fractal-heap object")
        ob = heap["off_bytes"]
        off = _u(hid, 1, ob)
        n = _u(hid, 1 + ob, heap["id_len"] - 1 - ob)
        if heap["rows"] == 0:                                 # the root is one direct block
            return self.src.read(heap["root"] + off, n)
        # a root indirect block: walk its direct children, sized start, start, 2*start, 4*start ... by row
        ib = heap["root"]
        hdr = 4 + 1 + self.so + ob
        k, boff = 0, 0
        for row in range(heap["rows"]):
            size = heap["start"] * (1 if row < 2 else 2 ** (row - 1))
            if size > heap["max_direct"]:
                break
            for _ in range(heap["width"]):
                child = _u(self.src.read(ib + hdr + k * self.so, self.so), 0, self.so)
                k += 1
                if boff <= off < boff + size:
                    if child == UNDEF:
                        raise H5Error("heap object in an unallocated block")
                    return self.src.read(child + off - boff, n)
                boff += size
        raise H5Error("heap object past the direct blocks of the root indirect block")

    def _btree2_records(self, addr):
        b = self.src.read(addr, 64)
        if b[:4] != b"BTHD":
            raise H5Error("no v2 B-tree at %d" % addr)
        node_size, rec_size, depth = _u(b, 6, 4), _u(b, 10, 2), _u(b, 12, 2)
        root, nrec = _u(b, 16, self.so), _u(b, 16 + self.so, 2)
        if depth != 0:
            raise H5Error("v2 B-tree of depth %d (this reader knows depth 0)" % depth)
        if root == UNDEF or nrec == 0:
            return []
        leaf = self.src.read(root, node_size)
        if leaf[:4] != b"BTLF":
            raise H5Error("no v2 B-tree leaf at %d" % root)
        return [leaf[6 + i * rec_size:6 + (i + 1) * rec_size] for i in range(nrec)]

    @staticmethod
    def _heap_id(rec, btype, id_len):
        """The heap ID inside a v2 B-tree record: a link-name record (type 5) is hash(4) then the ID; an attribute-name
        record (type 8) is the ID first, then flags(1), creation order(4) and hash(4)."""
        return rec[4:4 + id_len] if btype == 5 else rec[:id_len]

    # -- links -------------------------------------------------------------------
    def _parse_link(self, lm):
        f = lm[1]
        k = 2
        ltype = 0
        if f & 0x08:
            ltype = lm[k]
            k += 1
        k += (8 if f & 0x04 else 0) + (1 if f & 0x10 else 0)
        nl = 1 << (f & 3)
        nlen = _u(lm, k, nl)
        k += nl
        name = lm[k:k + nlen].decode("utf-8", "replace")
        k += nlen
        return name, (_u(lm, k, self.so) if ltype == 0 else None)

    def links(self):
        """{name: object header address} of the root group's hard links."""
        if self._links is not None:
            return self._links
        out = {}
        for t, body in self.messages(self.root):
            if t == 0x06:                                     # a compact link
                name, addr = self._parse_link(body)
                if addr is not None:
                    out[name] = addr
            elif t == 0x02:                                   # link info: the links are dense
                flags = body[1]
                q = 2 + (8 if flags & 1 else 0)
                fheap, nbt = _u(body, q, self.so), _u(body, q + self.so, self.so)
                if fheap == UNDEF:
                    continue
                heap = self._heap(fheap)
                for rec in self._btree2_records(nbt):
                    name, addr = self._parse_link(self._heap_object(heap, self._heap_id(rec, 5, heap["id_len"])))
                    if addr is not None:
                        out[name] = addr
            elif t == 0x11:
                raise H5Error("old-style (symbol table) root group")
        self._links = out
        return out

    # -- datasets ---------------------------------------------------------------------
    def dataset(self, name):
        addr = self.links().get(name)
        if addr is None:
            raise H5Error("no dataset %r" % name)
        ds = {"name": name, "attrs": {}, "attr_heap": None}
        for t, body in self.messages(addr):
            if t == 0x01:                                     # dataspace
                rank = body[1]
                p = 8 if body[0] == 1 else 4
                ds["shape"] = [_u(body, p + i * self.sl, self.sl) for i in range(rank)]
            elif t == 0x03:                                   # datatype
                cls, size = body[0] & 0x0F, _u(body, 4, 4)
                if cls != 1:
                    raise H5Error("%s: datatype class %d (not floating point)" % (name, cls))
                ds["fmt"] = (">" if body[1] & 1 else "<") + {4: "f", 8: "d"}[size]
                ds["esize"] = size
            elif t == 0x08:                                   # layout
                if body[0] != 3:
                    raise H5Error("%s: layout message version %d" % (name, body[0]))
                if body[1] == 1:
                    ds["contiguous"] = _u(body, 2, self.so)
                elif body[1] == 2:
                    nd = body[2]
                    ds["btree"] = _u(body, 3, self.so)
                    ds["chunk"] = [_u(body, 3 + self.so + 4 * i, 4) for i in range(nd - 1)]
                else:
                    raise H5Error("%s: compact layout" % name)
            elif t == 0x0B:
                raise H5Error("%s: filtered (compressed) data" % name)
            elif t == 0x0C:
                k, v = self._parse_attribute(body)
                ds["attrs"][k] = v
            elif t == 0x15:                                   # attribute info: dense attributes
                flags = body[1]
                q = 2 + (2 if flags & 1 else 0)
                fheap, nbt = _u(body, q, self.so), _u(body, q + self.so, self.so)
                if fheap != UNDEF:
                    ds["attr_heap"] = (fheap, nbt)
        return ds

    def _parse_attribute(self, a):
        ver = a[0]
        nlen, tlen, slen = _u(a, 2, 2), _u(a, 4, 2), _u(a, 6, 2)
        p = 8 + (1 if ver == 3 else 0)
        pad = (lambda n: (n + 7) & ~7) if ver == 1 else (lambda n: n)
        name = a[p:p + nlen].rstrip(b"\0").decode("utf-8", "replace")
        p += pad(nlen)
        dt = a[p:p + tlen]
        p += pad(tlen)
        p += pad(slen)
        if dt and (dt[0] & 0x0F) == 3:                        # a fixed-length string - the units of a time axis
            size = _u(dt, 4, 4)
            return name, a[p:p + size].rstrip(b"\0 ").decode("utf-8", "replace")
        return name, None

    def attribute(self, ds, key):
        if key in ds["attrs"]:
            return ds["attrs"][key]
        if ds["attr_heap"]:
            fheap, nbt = ds["attr_heap"]
            heap = self._heap(fheap)
            for rec in self._btree2_records(nbt):             # type 8: heap ID, flags(1), creation order(4), hash(4)
                k, v = self._parse_attribute(self._heap_object(heap, self._heap_id(rec, 8, heap["id_len"])))
                ds["attrs"][k] = v
        return ds["attrs"].get(key)

    def chunks(self, ds):
        """{chunk offset tuple: address} from the dataset's version-1 B-tree (node type 1)."""
        out = {}
        nd = len(ds["chunk"]) + 1
        todo = [ds["btree"]]
        while todo:
            addr = todo.pop()
            h = self.src.read(addr, 8 + 2 * self.so)
            if h[:4] != b"TREE" or h[4] != 1:
                raise H5Error("%s: no chunk B-tree node at %d" % (ds["name"], addr))
            level, used = h[5], _u(h, 6, 2)
            ksize = 8 + 8 * nd
            body = self.src.read(addr + 8 + 2 * self.so, used * (ksize + self.so) + ksize)
            for i in range(used):
                key = body[i * (ksize + self.so):i * (ksize + self.so) + ksize]
                child = _u(body, i * (ksize + self.so) + ksize, self.so)
                if level == 0:
                    out[tuple(_u(key, 8 + 8 * j, 8) for j in range(nd - 1))] = child
                else:
                    todo.append(child)
        return out

    def contiguous(self, ds, first, count):
        """`count` consecutive elements from flat index `first` of a contiguous dataset."""
        raw = self.src.read_raw(ds["contiguous"] + first * ds["esize"], count * ds["esize"])
        return struct.unpack("%s%d%s" % (ds["fmt"][0], count, ds["fmt"][1]), raw)


# --------------------------------------------------------------------------- #
#  One frame's surface u/v in a box, and its time
# --------------------------------------------------------------------------- #
_UNIT_S = {"second": 1.0, "seconds": 1.0, "minute": 60.0, "minutes": 60.0, "hour": 3600.0, "hours": 3600.0,
           "day": 86400.0, "days": 86400.0}


def to_epoch_seconds(value, units):
    """A CF time value -> seconds since currents.EPOCH (2016-01-01), the epoch currents' cache is written in."""
    m = re.match(r"\s*(\w+)\s+since\s+(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?", units or "")
    if not m or m.group(1).lower() not in _UNIT_S:
        raise H5Error("time units %r" % units)
    base = datetime(int(m.group(2)), int(m.group(3)), int(m.group(4)), int(m.group(5) or 0), int(m.group(6) or 0),
                    int(m.group(7) or 0), tzinfo=timezone.utc)
    return value * _UNIT_S[m.group(1).lower()] + (base - currents.EPOCH).total_seconds()


def read_surface(h5, ds, chunkmap, y0, y1, x0, x1):
    """Surface (time 0, depth 0) values of a [1][depth][ny][nx] dataset over rows y0..y1, columns x0..x1, row-major."""
    ct, cz, cy, cx = ds["chunk"]
    fmt, es = ds["fmt"], ds["esize"]
    out = [None] * ((y1 - y0 + 1) * (x1 - x0 + 1))
    width = x1 - x0 + 1
    for ry in range((y0 // cy) * cy, y1 + 1, cy):
        for rx in range((x0 // cx) * cx, x1 + 1, cx):
            addr = chunkmap.get((0, 0, ry, rx))
            if addr is None:
                raise H5Error("%s: no chunk at (0, 0, %d, %d)" % (ds["name"], ry, rx))
            r0, r1 = max(y0, ry) - ry, min(y1, ry + cy - 1) - ry
            raw = h5.src.read_raw(addr + r0 * cx * es, (r1 - r0 + 1) * cx * es)
            vals = struct.unpack("%s%d%s" % (fmt[0], (r1 - r0 + 1) * cx, fmt[1]), raw)
            c0, c1 = max(x0, rx) - rx, min(x1, rx + cx - 1) - rx
            for r in range(r0, r1 + 1):
                row = (ry + r - y0) * width
                base = (r - r0) * cx
                for c in range(c0, c1 + 1):
                    out[row + rx + c - x0] = vals[base + c]
    return out


# --------------------------------------------------------------------------- #
#  The bucket, the cycle, and currents' own cache
# --------------------------------------------------------------------------- #
def _list(prefix, opener=None):
    """Every key under `prefix` in the bucket (ListObjectsV2, following continuation tokens)."""
    keys, token = [], None
    while True:
        q = {"list-type": "2", "prefix": prefix, "max-keys": "1000"}
        if token:
            q["continuation-token"] = token
        url = BUCKET + "?" + urllib.parse.urlencode(q)
        if opener:
            xml = opener(url)
        else:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=TIMEOUT) as r:
                xml = r.read().decode("utf-8", "replace")
        keys += re.findall(r"<Key>([^<]+)</Key>", xml)
        m = re.search(r"<NextContinuationToken>([^<]+)</NextContinuationToken>", xml)
        if not m:
            return keys
        token = m.group(1)


def available_cycles(ofs, days_back=2, now=None, lister=None):
    """[(datestr, cycle, [hour files])] newest first, read off the bucket - the shape currents.available_cycles gives."""
    now = now or datetime.now(timezone.utc)
    found = []
    for back in range(days_back):
        day = now - timedelta(days=back)
        prefix = "%s/netcdf/%s/" % (ofs, day.strftime("%Y/%m/%d"))
        names = {k.rsplit("/", 1)[-1] for k in (lister or _list)(prefix)}
        names = {n for n in names if re.fullmatch(r"%s\.t\d\dz\.\d{8}\.regulargrid\.[nf]\d{3}\.nc" % re.escape(ofs), n)}
        for hh in sorted({re.search(r"\.t(\d\d)z\.", n).group(1) for n in names}, reverse=True):
            hours = sorted(n for n in names if ".t%sz." % hh in n)
            dates = {re.search(r"\.(\d{8})\.", n).group(1) for n in hours}
            for d in dates:
                found.append((d, "%sz" % hh, [n for n in hours if ".%s." % d in n]))
    found.sort(key=lambda r: (r[0], r[1]), reverse=True)
    return found


def _key(ofs, datestr, hour_file):
    return "%s/netcdf/%s/%s/%s/%s" % (ofs, datestr[:4], datestr[4:6], datestr[6:], hour_file)


def fetch_cycle(ofs, datestr, cycle, hours, bbox, cache=None, workers=6, open_file=None):
    """Read the surface u/v of every frame of one cycle inside `bbox` from the bucket into currents' cache; the tag."""
    open_file = open_file or (lambda key: HttpRange(BUCKET + key))
    hours = sorted(hours, key=lambda h: ("f" in h.rsplit(".", 2)[1][:1], h.rsplit(".", 2)[1]))
    first = H5(open_file(_key(ofs, datestr, hours[0])))
    lat, lon, mask = first.dataset("Latitude"), first.dataset("Longitude"), first.dataset("mask")
    ny_full, nx_full = lat["shape"]
    corner = lambda ds, y, x: first.contiguous(ds, y * nx_full + x, 1)[0]
    lats_all = (corner(lat, 0, 0), corner(lat, ny_full - 1, 0))
    lons_all = (corner(lon, 0, 0), corner(lon, 0, nx_full - 1))
    dlat = (lats_all[1] - lats_all[0]) / (ny_full - 1)
    dlon = (lons_all[1] - lons_all[0]) / (nx_full - 1)
    lat0, lon0, lat1, lon1 = bbox
    y0 = max(0, int(math.floor((min(lat0, lat1) - lats_all[0]) / dlat)) - 1)
    y1 = min(ny_full - 1, int(math.ceil((max(lat0, lat1) - lats_all[0]) / dlat)) + 1)
    x0 = max(0, int(math.floor((min(lon0, lon1) - lons_all[0]) / dlon)) - 1)
    x1 = min(nx_full - 1, int(math.ceil((max(lon0, lon1) - lons_all[0]) / dlon)) + 1)
    if y1 <= y0 or x1 <= x0:
        raise RuntimeError("bbox does not overlap the model box")
    ny, nx = y1 - y0 + 1, x1 - x0 + 1
    depth = first.dataset("Depth")
    if abs(first.contiguous(depth, 0, 1)[0]) > 1e-9:
        raise H5Error("Depth[0] is not the surface")
    flat = first.contiguous(mask, y0 * nx_full + x0, (y1 - y0) * nx_full + nx)
    mask_box = [int(flat[(y - y0) * nx_full + (x - x0)] > 0.5) for y in range(y0, y1 + 1) for x in range(x0, x1 + 1)]

    def one(hour_file):
        h = first if hour_file == hours[0] else H5(open_file(_key(ofs, datestr, hour_file)))
        t = h.dataset("time")
        tv = struct.unpack(t["fmt"][0] + t["fmt"][1], h.src.read_raw(h.chunks(t)[(0,)], t["esize"]))[0]
        tsec = to_epoch_seconds(tv, h.attribute(t, "units"))
        u, v = h.dataset("u_eastward"), h.dataset("v_northward")
        return (tsec, read_surface(h, u, h.chunks(u), y0, y1, x0, x1), read_surface(h, v, h.chunks(v), y0, y1, x0, x1))

    with ThreadPoolExecutor(max_workers=workers) as pool:
        frames = list(pool.map(one, hours))
    order = currents.frame_order([f[0] for f in frames])
    blob = bytearray()
    for i in order:
        blob += struct.pack(">%df" % (ny * nx), *frames[i][1])
        blob += struct.pack(">%df" % (ny * nx), *frames[i][2])
    cache = cache or currents.CACHE
    cache.mkdir(parents=True, exist_ok=True)
    tag = currents._tag(ofs, datestr, cycle)
    meta = {"ofs": ofs, "date": datestr, "cycle": cycle,
            "source": BUCKET + "%s/netcdf/%s/%s/%s/" % (ofs, datestr[:4], datestr[4:6], datestr[6:]),
            "via": "s3", "product": "regulargrid", "depth_m": 0.0,
            "fetched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "ny": ny, "nx": nx, "lat0": corner(lat, y0, x0), "lon0": corner(lon, y0, x0), "dlat": dlat, "dlon": dlon,
            "files": [hours[i] for i in order], "times": [frames[i][0] for i in order], "mask": mask_box}
    # the uv file first, the meta that names it last: currents finds a cycle by its meta
    with gzip.open(cache / ("%s_uv.bin.gz" % tag), "wb", compresslevel=6) as fh:
        fh.write(bytes(blob))
    (cache / ("%s_meta.json" % tag)).write_text(json.dumps(meta), encoding="utf8")
    return tag


def ensure_cycle_covering(start, end, bbox, ofs, cache=None, lister=None, open_file=None, now=None):
    """The tag of a cycle covering start..end inside bbox: a cached one, else one read from the bucket; None when the
    bucket holds none covering it."""
    have = currents.covering_cycle(start, end, bbox, cache)
    if have:
        return have
    for datestr, cyc, hours in available_cycles(ofs, days_back=2, now=now, lister=lister):
        s, e = currents.cycle_span(datestr, cyc, hours)
        if s <= start and end <= e:
            return fetch_cycle(ofs, datestr, cyc, hours, bbox, cache=cache, open_file=open_file)
    return None
