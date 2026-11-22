"""s57.py - NOAA's S-57 electronic navigational chart cells, read with the standard library.

WHY THIS EXISTS (2026-11-21). The console reads its chart - every keep-out, depth, mark and coverage square - from NOAA's
ENCDirect service, and on 21 November that service's host stopped answering altogether. The same charts are published as
files: each cell an S-57 dataset in a zip from charts.noaa.gov/ENCs/<CELL>.zip, its base (.000) and its weekly
corrections (.001, .002, ...). This module reads such a cell and hands back its objects with their geometry; nothing
here goes to the network.

WHAT IT IS, LAYER BY LAYER
  * ISO 8211, the container (_iso8211_records): a data descriptive record (DDR) says, per field tag, its subfield labels
    and their binary/text formats; every data record (DR) after it is decoded by those descriptions.
  * S-57, the content (Cell): a feature record (FRID) is an object - its class (OBJL), its geometric primitive (PRIM:
    point, line, area), its attributes (ATTF), and pointers (FSPT) to the vector records that carry its position. A
    vector record (VRID) is an isolated node (110: a buoy, a sounding cluster), a connected node (120: an edge's end) or
    an edge (130: the points between two connected nodes).
  * THE CORRECTIONS (Cell.apply_update). A cell is its base plus every update file in order: a record inserted, deleted,
    or modified in place - attributes replaced or deleted (the DEL character), pointers and coordinates inserted,
    deleted or replaced at an index. ⚠ A CELL READ WITHOUT ITS UPDATES IS LAST YEAR'S CHART: a buoy moved, a wreck
    found, a light changed are what the updates carry. NOAA's zip holds the base and all of its edition's updates.
  * GEOMETRY (Cell.geometry). A point is its node; a SOUNDING is a cluster of 3-D points (depth = VE3D / SOMF); a line
    is its edges joined end to end, each edge's points between its two nodes, reversed where the pointer says so; an
    area is its boundary edges assembled into rings, the exterior ring(s) and the interior ones (holes) kept apart.
    Coordinates are integers over COMF (10,000,000 for NOAA: 1e-7 degree).

WHAT IT IS NOT. A renderer, a validator, or a full topology engine: faces (130/140 full topology) are not built - NOAA
publishes chain-node topology, which is all the console's model reads. Object classes and attributes come from the IHO
S-57 catalog as GDAL publishes it (data/s57/, MIT - see its README).

    import s57
    cell = s57.read_zip("US5A3KDD.zip")        # or s57.read_files(["....000", "....001"])
    for f in cell.features():                   # {"acronym", "prim", "attrs", "geometry", "rcid", "foid", "objl"}
        ...
"""
import csv
import io
import os
import re
import zipfile

FT = 0x1E          # field terminator
UT = 0x1F          # unit (subfield) terminator
DEL = "\x7f"       # an update's "delete this attribute" value

_HERE = os.path.dirname(os.path.abspath(__file__))
TABLES = os.path.join(_HERE, "data", "s57")

PRIM_POINT, PRIM_LINE, PRIM_AREA = 1, 2, 3
RCNM_FEATURE = 100
RCNM_ISOLATED, RCNM_CONNECTED, RCNM_EDGE, RCNM_FACE = 110, 120, 130, 140


class S57Error(ValueError):
    """A cell that cannot be read as S-57: the reason, never a partial answer passed off as whole."""


# ── THE IHO CATALOG (data/s57, from GDAL) ──────────────────────────────────────────────────────────────────────────
_cat = None


def _table(name):
    """One catalog table's rows. The files are not in one encoding (attributes UTF-8, expected input Latin-1)."""
    with open(os.path.join(TABLES, name), "rb") as f:
        raw = f.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1")
    return list(csv.DictReader(io.StringIO(text, newline="")))


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def catalog():
    """{"objl": {code: (acronym, name, prims)}, "attl": {code: (acronym, name, type)}, "expected": {(attl, id): meaning},
    "class_attrs": {class acronym: frozenset(attribute acronyms it may carry)}, "acr_objl": {acronym: code},
    "acr_attl": {acronym: code}} - read once."""
    global _cat
    if _cat is not None:
        return _cat
    objl, attl, exp, cls_attrs = {}, {}, {}, {}
    for r in _table("s57objectclasses.csv"):
        code = _int(r["Code"])
        if code is not None:
            objl[code] = (r["Acronym"], r["ObjectClass"], tuple(p for p in (r.get("Primitives") or "").split(";") if p))
            cls_attrs[r["Acronym"]] = frozenset(a for k in ("Attribute_A", "Attribute_B", "Attribute_C")
                                                for a in (r.get(k) or "").split(";") if a)
    for r in _table("s57attributes.csv"):
        code = _int(r["Code"])
        if code is not None:
            attl[code] = (r["Acronym"], r["Attribute"], r["Attributetype"])
    for r in _table("s57expectedinput.csv"):
        code, vid = _int(r["Code"]), _int(r["ID"])
        if code is not None and vid is not None:
            exp[(code, vid)] = r["Meaning"]
    _cat = {"objl": objl, "attl": attl, "expected": exp, "class_attrs": cls_attrs,
            "acr_objl": {v[0]: k for k, v in objl.items()}, "acr_attl": {v[0]: k for k, v in attl.items()}}
    return _cat


# ── ISO 8211 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
def _parse_formats(fmt):
    """An ISO 8211 format-control string -> a flat list of subfield formats, each ("A"|"I"|"R", width or None) or
    ("b", signed, nbytes) or ("B", nbytes). "(b11,2b12,A(3),3(b11,A))" expands its repeat counts and groups."""
    s = fmt.strip()
    if s.startswith("(") and s.endswith(")"):
        s = s[1:-1]
    out = []
    depth, start, parts = 0, 0, []
    for i, ch in enumerate(s):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "," and depth == 0:
            parts.append(s[start:i])
            start = i + 1
    parts.append(s[start:])
    for p in parts:
        p = p.strip()
        if not p:
            continue
        m = re.match(r"(\d*)(.*)$", p)
        rep = int(m.group(1)) if m.group(1) else 1
        body = m.group(2)
        if body.startswith("("):
            sub = _parse_formats(body)
            out.extend(sub * rep)
            continue
        k = body[0]
        if k == "b":
            sign, nb = body[1], int(body[2])
            one = ("b", sign == "2", nb)
        elif k == "B":
            mm = re.match(r"B\((\d+)\)", body)
            if not mm:
                raise S57Error("bit-string format without a width: %r" % body)
            one = ("B", int(mm.group(1)) // 8)
        elif k in "AIR":
            mm = re.match(r"[AIR]\((\d+)\)", body)
            one = (k, int(mm.group(1)) if mm else None)
        else:
            raise S57Error("unknown subfield format %r in %r" % (body, fmt))
        out.extend([one] * rep)
    return out


class _FieldDef:
    __slots__ = ("tag", "name", "labels", "repeat", "formats")

    def __init__(self, tag, name, labels, repeat, formats):
        self.tag, self.name, self.labels, self.repeat, self.formats = tag, name, labels, repeat, formats


def _leader(rec):
    try:
        return {"reclen": int(rec[0:5]), "fcl": int(rec[10:12] or b"0") if rec[10:12].strip() else 0,
                "base": int(rec[12:17]), "szlen": int(rec[20:21]), "szpos": int(rec[21:22]), "sztag": int(rec[23:24])}
    except ValueError:
        raise S57Error("not an ISO 8211 record leader: %r" % rec[:24])


def _directory(rec, ld):
    """[(tag, data bytes without the field terminator)] for one record."""
    out = []
    w = ld["sztag"] + ld["szlen"] + ld["szpos"]
    p = 24
    while p < len(rec) and rec[p] != FT:
        e = rec[p:p + w]
        tag = e[:ld["sztag"]].decode("ascii")
        ln = int(e[ld["sztag"]:ld["sztag"] + ld["szlen"]])
        pos = int(e[ld["sztag"] + ld["szlen"]:])
        data = rec[ld["base"] + pos: ld["base"] + pos + ln]
        if data and data[-1] == FT:
            data = data[:-1]
        out.append((tag, data))
        p += w
    return out


def _read_ddr(buf):
    ld = _leader(buf)
    rec = buf[:ld["reclen"]]
    defs = {}
    for tag, data in _directory(rec, ld):
        if tag == "0000":
            continue
        body = data[ld["fcl"]:] if ld["fcl"] else data
        parts = body.split(bytes([UT]))
        name = parts[0].decode("latin-1") if parts else ""
        arr = parts[1].decode("latin-1") if len(parts) > 1 else ""
        fmt = parts[2].decode("latin-1") if len(parts) > 2 else ""
        repeat = arr.startswith("*")
        labels = [x for x in arr.lstrip("*").split("!") if x] if arr else []
        formats = _parse_formats(fmt) if fmt else []
        if labels and len(formats) != len(labels):
            # A format list shorter than its labels repeats its last format (ISO 8211 allows it; S-57 does not use it)
            if formats and len(formats) < len(labels):
                formats = formats + [formats[-1]] * (len(labels) - len(formats))
            else:
                raise S57Error("field %s: %d labels, %d formats" % (tag, len(labels), len(formats)))
        defs[tag] = _FieldDef(tag, name, labels, repeat, formats)
    return defs, ld["reclen"]


def _decode_field(fd, data, ucs2=False):
    """One field's bytes -> a list of {label: value} (one per repeat group; one for a field that does not repeat)."""
    groups, p, n = [], 0, len(data)
    while p < n:
        g = {}
        for lab, f in zip(fd.labels, fd.formats):
            k = f[0]
            if k == "b":
                nb = f[2]
                chunk = data[p:p + nb]
                if len(chunk) < nb:
                    raise S57Error("field %s ran out at %s" % (fd.tag, lab))
                g[lab] = int.from_bytes(chunk, "little", signed=f[1])
                p += nb
            elif k == "B":
                nb = f[1]
                g[lab] = bytes(data[p:p + nb])
                p += nb
            else:
                w = f[1]
                if w is not None:
                    raw = data[p:p + w]
                    p += w
                else:
                    if ucs2:
                        q = p
                        while q + 1 < n and not (data[q] == UT and data[q + 1] == 0):
                            q += 2
                        raw = data[p:q]
                        p = q + 2
                    else:
                        q = data.find(bytes([UT]), p)
                        if q < 0:
                            q = n
                        raw = data[p:q]
                        p = q + 1
                if ucs2 and w is None:
                    txt = raw.decode("utf-16-le", "replace")
                else:
                    txt = raw.decode("latin-1")
                if k == "I":
                    t = txt.strip()
                    try:
                        g[lab] = int(t) if t else None
                    except ValueError:
                        g[lab] = None
                elif k == "R":
                    t = txt.strip()
                    try:
                        g[lab] = float(t) if t else None
                    except ValueError:
                        g[lab] = None
                else:
                    g[lab] = txt
        groups.append(g)
        if not fd.repeat:
            break
    return groups


def _iso8211_records(buf, ucs2_tags=()):
    """Every data record of an ISO 8211 file as {tag: [groups, ...] (one list per field occurrence)}."""
    if len(buf) < 24:
        raise S57Error("too short to be an ISO 8211 file (%d bytes)" % len(buf))
    defs, p = _read_ddr(buf)
    out = []
    while p < len(buf):
        if buf[p:p + 1] in (b"", b"\x00") or len(buf) - p < 24:
            break
        ld = _leader(buf[p:p + 24])
        rec = buf[p:p + ld["reclen"]]
        if len(rec) < ld["reclen"]:
            raise S57Error("a record runs past the end of the file")
        r = {}
        for tag, data in _directory(rec, ld):
            fd = defs.get(tag)
            if fd is None or tag == "0001":
                continue
            ucs2 = tag in ucs2_tags
            if ucs2 and data.endswith(b"\x1e\x00"):
                # A field at lexical level 2 (UCS-2: NATF) may end in a TWO-byte terminator, 1E 00, which the
                # directory's one-byte strip does not see: it is no part of the last value.
                data = data[:-2]
            r.setdefault(tag, []).append(_decode_field(fd, data, ucs2=ucs2))
        out.append(r)
        p += ld["reclen"]
    return out


# ── S-57 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
def _name(b):
    """A NAME (B(40)) -> (RCNM, RCID)."""
    return b[0], int.from_bytes(b[1:5], "little")


class Cell:
    """One S-57 dataset: its base and the updates applied to it, in order. See the module header."""

    def __init__(self):
        self.name = None
        self.dsid = {}
        self.comf = 10000000
        self.somf = 10
        self.features = {}          # rcid -> feature dict
        self.vectors = {}           # (rcnm, rcid) -> vector dict
        self.updates_applied = []   # update numbers, in order
        self.updates_withheld = []  # present but not applied (read_zip `through` / `issued_by`)
        self.problems = []          # what could not be read, said - never silently dropped

    # -- reading ------------------------------------------------------------------------------------------------------
    @staticmethod
    def _flat(rec, tag):
        """All groups of every occurrence of `tag`, in order."""
        return [g for occ in rec.get(tag, []) for g in occ]

    @staticmethod
    def _one(rec, tag):
        occ = rec.get(tag)
        return occ[0][0] if occ and occ[0] else None

    def _feature_from(self, rec):
        frid = self._one(rec, "FRID")
        foid = self._one(rec, "FOID") or {}
        return {"rcid": frid["RCID"], "prim": frid["PRIM"], "grup": frid.get("GRUP"), "objl": frid["OBJL"],
                "rver": frid.get("RVER", 1),
                "foid": (foid.get("AGEN"), foid.get("FIDN"), foid.get("FIDS")),
                "attf": {g["ATTL"]: g["ATVL"] for g in self._flat(rec, "ATTF")},
                "natf": {g["ATTL"]: g["ATVL"] for g in self._flat(rec, "NATF")},
                "fspt": [(*_name(g["NAME"]), g.get("ORNT"), g.get("USAG"), g.get("MASK")) for g in self._flat(rec, "FSPT")],
                "ffpt": [(bytes(g.get("LNAM") or b""), g.get("RIND"), g.get("COMT")) for g in self._flat(rec, "FFPT")]}

    def _coords_from(self, rec):
        if rec.get("SG3D"):
            return [(g["YCOO"], g["XCOO"], g["VE3D"]) for g in self._flat(rec, "SG3D")]
        return [(g["YCOO"], g["XCOO"]) for g in self._flat(rec, "SG2D")]

    def _vector_from(self, rec):
        v = self._one(rec, "VRID")
        return {"rcnm": v["RCNM"], "rcid": v["RCID"], "rver": v.get("RVER", 1),
                "attv": {g["ATTL"]: g["ATVL"] for g in self._flat(rec, "ATTV")},
                "vrpt": [(*_name(g["NAME"]), g.get("ORNT"), g.get("USAG"), g.get("TOPI"), g.get("MASK"))
                         for g in self._flat(rec, "VRPT")],
                "coords": self._coords_from(rec)}

    def _dataset(self, rec):
        d = self._one(rec, "DSID")
        if d:
            self.dsid = dict(d)
            self.name = (d.get("DSNM") or "").strip() or self.name
        p = self._one(rec, "DSPM")
        if p:
            self.comf = p.get("COMF") or self.comf
            self.somf = p.get("SOMF") or self.somf

    def read_base(self, buf):
        for rec in _iso8211_records(buf, ucs2_tags=("NATF",)):
            if "DSID" in rec or "DSPM" in rec:
                self._dataset(rec)
            elif "FRID" in rec:
                f = self._feature_from(rec)
                self.features[f["rcid"]] = f
            elif "VRID" in rec:
                v = self._vector_from(rec)
                self.vectors[(v["rcnm"], v["rcid"])] = v
        return self

    # -- the corrections ----------------------------------------------------------------------------------------------
    @staticmethod
    def _splice(lst, ui, ix, n, new, what):
        """S-57 update instruction on a list: 1 insert `new` at index `ix` (1-based), 2 delete `n` from it, 3 replace
        `n` from it with `new`. A bad index is an error, never a silent clamp."""
        i = (ix or 1) - 1
        if ui == 1:
            if not 0 <= i <= len(lst):
                raise S57Error("%s: insert at %d of %d" % (what, ix, len(lst)))
            lst[i:i] = new
        elif ui == 2:
            if not (0 <= i and i + n <= len(lst)):
                raise S57Error("%s: delete %d at %d of %d" % (what, n, ix, len(lst)))
            del lst[i:i + n]
        elif ui == 3:
            if not (0 <= i and i + n <= len(lst)) or len(new) != n:
                raise S57Error("%s: replace %d at %d of %d (with %d)" % (what, n, ix, len(lst), len(new)))
            lst[i:i + n] = new
        else:
            raise S57Error("%s: update instruction %r" % (what, ui))

    @staticmethod
    def _attr_update(target, groups):
        for g in groups:
            if g["ATVL"] == DEL:
                target.pop(g["ATTL"], None)
            else:
                target[g["ATTL"]] = g["ATVL"]

    def apply_update(self, buf, number=None):
        for rec in _iso8211_records(buf, ucs2_tags=("NATF",)):
            if "DSID" in rec or "DSPM" in rec:
                d = self._one(rec, "DSID")
                if d:
                    self.dsid.update({k: v for k, v in d.items() if k in ("UPDN", "UADT", "ISDT", "EDTN")})
                continue
            if "FRID" in rec:
                frid = self._one(rec, "FRID")
                rcid, ruin = frid["RCID"], frid.get("RUIN")
                if ruin == 1:
                    self.features[rcid] = self._feature_from(rec)
                elif ruin == 2:
                    if self.features.pop(rcid, None) is None:
                        self.problems.append("update %s deletes feature %d, which is not there" % (number, rcid))
                elif ruin == 3:
                    f = self.features.get(rcid)
                    if f is None:
                        self.problems.append("update %s modifies feature %d, which is not there" % (number, rcid))
                        continue
                    f["rver"] = frid.get("RVER", f["rver"])
                    self._attr_update(f["attf"], self._flat(rec, "ATTF"))
                    self._attr_update(f["natf"], self._flat(rec, "NATF"))
                    fspc = self._one(rec, "FSPC")
                    if fspc:
                        new = [(*_name(g["NAME"]), g.get("ORNT"), g.get("USAG"), g.get("MASK")) for g in self._flat(rec, "FSPT")]
                        self._splice(f["fspt"], fspc["FSUI"], fspc["FSIX"], fspc["NSPT"], new,
                                     "feature %d pointers" % rcid)
                    ffpc = self._one(rec, "FFPC")
                    if ffpc:
                        new = [(bytes(g.get("LNAM") or b""), g.get("RIND"), g.get("COMT")) for g in self._flat(rec, "FFPT")]
                        self._splice(f["ffpt"], ffpc["FFUI"], ffpc["FFIX"], ffpc["NFPT"], new,
                                     "feature %d object pointers" % rcid)
                else:
                    self.problems.append("feature %d: update instruction %r" % (rcid, ruin))
            elif "VRID" in rec:
                v0 = self._one(rec, "VRID")
                key, ruin = (v0["RCNM"], v0["RCID"]), v0.get("RUIN")
                if ruin == 1:
                    self.vectors[key] = self._vector_from(rec)
                elif ruin == 2:
                    if self.vectors.pop(key, None) is None:
                        self.problems.append("update %s deletes vector %s, which is not there" % (number, key))
                elif ruin == 3:
                    v = self.vectors.get(key)
                    if v is None:
                        self.problems.append("update %s modifies vector %s, which is not there" % (number, key))
                        continue
                    v["rver"] = v0.get("RVER", v["rver"])
                    self._attr_update(v["attv"], self._flat(rec, "ATTV"))
                    vrpc = self._one(rec, "VRPC")
                    if vrpc:
                        new = [(*_name(g["NAME"]), g.get("ORNT"), g.get("USAG"), g.get("TOPI"), g.get("MASK"))
                               for g in self._flat(rec, "VRPT")]
                        self._splice(v["vrpt"], vrpc["VPUI"], vrpc["VPIX"], vrpc["NVPT"], new, "vector %s pointers" % (key,))
                    sgcc = self._one(rec, "SGCC")
                    if sgcc:
                        self._splice(v["coords"], sgcc["CCUI"], sgcc["CCIX"], sgcc["CCNC"], self._coords_from(rec),
                                     "vector %s coordinates" % (key,))
                else:
                    self.problems.append("vector %s: update instruction %r" % (key, ruin))
        self.updates_applied.append(number)
        return self

    # -- geometry -----------------------------------------------------------------------------------------------------
    def _xy(self, c):
        return [c[1] / self.comf, c[0] / self.comf]

    def _node(self, rcnm, rcid):
        v = self.vectors.get((rcnm, rcid))
        if not v or not v["coords"]:
            return None
        return v

    def _edge_line(self, rcid):
        """An edge's points, begin node to end node, as [[lon, lat], ...] - or None when a part is missing."""
        e = self.vectors.get((RCNM_EDGE, rcid))
        if e is None:
            return None
        beg = end = None
        for (rcnm, nid, ornt, usag, topi, mask) in e["vrpt"]:
            if topi == 1:
                beg = (rcnm, nid)
            elif topi == 2:
                end = (rcnm, nid)
        if beg is None or end is None:
            # Two pointers with no TOPI said: the first is the beginning, the second the end (S-57 writes them so)
            if len(e["vrpt"]) == 2:
                beg, end = e["vrpt"][0][:2], e["vrpt"][1][:2]
            else:
                return None
        nb, ne = self._node(*beg), self._node(*end)
        if nb is None or ne is None:
            return None
        return [self._xy(nb["coords"][0])] + [self._xy(c) for c in e["coords"]] + [self._xy(ne["coords"][0])]

    def geometry(self, f):
        """A feature's GeoJSON geometry, or None (a meta object with no geometry, or one whose vectors are missing -
        the second is recorded in `problems`)."""
        prim = f["prim"]
        if prim == PRIM_POINT:
            pts = []
            for (rcnm, rcid, ornt, usag, mask) in f["fspt"]:
                v = self._node(rcnm, rcid)
                if v is None:
                    self.problems.append("feature %d: point %s missing" % (f["rcid"], (rcnm, rcid)))
                    return None
                for c in v["coords"]:
                    if len(c) == 3:
                        pts.append([c[1] / self.comf, c[0] / self.comf, c[2] / self.somf])
                    else:
                        pts.append(self._xy(c))
            if not pts:
                return None
            if len(pts) == 1 and len(pts[0]) == 2:
                return {"type": "Point", "coordinates": pts[0]}
            return {"type": "MultiPoint", "coordinates": pts}
        if prim == PRIM_LINE:
            parts = []
            for (rcnm, rcid, ornt, usag, mask) in f["fspt"]:
                ln = self._edge_line(rcid) if rcnm == RCNM_EDGE else None
                if ln is None:
                    self.problems.append("feature %d: edge %s missing" % (f["rcid"], (rcnm, rcid)))
                    return None
                if ornt == 2:
                    ln = ln[::-1]
                if parts and parts[-1][-1] == ln[0]:
                    parts[-1].extend(ln[1:])
                else:
                    parts.append(list(ln))
            if not parts:
                return None
            return {"type": "LineString", "coordinates": parts[0]} if len(parts) == 1 else \
                {"type": "MultiLineString", "coordinates": parts}
        if prim == PRIM_AREA:
            return self._area(f)
        return None

    def _area(self, f):
        """An area's rings, assembled from its boundary edges: joined end to end in the order given, and where the
        order does not close a ring, by matching ends (a cell is not obliged to list a ring's edges in sequence)."""
        segs = []
        for (rcnm, rcid, ornt, usag, mask) in f["fspt"]:
            ln = self._edge_line(rcid) if rcnm == RCNM_EDGE else None
            if ln is None:
                self.problems.append("feature %d: edge %s missing" % (f["rcid"], (rcnm, rcid)))
                return None
            if ornt == 2:
                ln = ln[::-1]
            segs.append((ln, 2 if usag == 2 else 1))
        rings = []                       # (points, usage)
        # THE EXTERIOR AND THE HOLES ARE JOINED APART: S-57 lets a hole touch its exterior at a node, and from that node
        # one pool of edges offers both rings' next edge - a hole stitched into the exterior is a slit, not a hole.
        for hole in (False, True):
            pend = [(ln, u) for ln, u in segs if (u == 2) == hole]
            while pend:
                cur, use = list(pend[0][0]), pend[0][1]
                pend.pop(0)
                guard = 0
                while cur[0] != cur[-1] and pend and guard < 100000:
                    guard += 1
                    hit = None
                    for i, (ln, u) in enumerate(pend):
                        if ln[0] == cur[-1]:
                            hit = (i, ln)
                            break
                    if hit is None:      # out of sequence, or drawn the other way: match either end
                        for i, (ln, u) in enumerate(pend):
                            if ln[-1] == cur[-1]:
                                hit = (i, ln[::-1])
                                break
                    if hit is None:
                        break
                    cur.extend(hit[1][1:])
                    pend.pop(hit[0])
                if cur[0] != cur[-1]:
                    self.problems.append("feature %d: a ring does not close (%d points)" % (f["rcid"], len(cur)))
                    return None
                rings.append((cur, use))
        # GeoJSON's winding (RFC 7946): the exterior counter-clockwise, a hole clockwise - which is how ENCDirect serves
        # every ring (466 of 466 Nome polygons ran the other way before this). S-57 itself winds the exterior clockwise.
        ext = [_wind(r, True) for r, u in rings if u != 2]
        inn = [_wind(r, False) for r, u in rings if u == 2]
        if not ext:
            self.problems.append("feature %d: no exterior ring" % f["rcid"])
            return None
        if len(ext) == 1:
            return {"type": "Polygon", "coordinates": [ext[0]] + inn}
        polys = [[e] for e in ext]
        for h in inn:                     # each hole to the exterior that holds it
            p0 = h[0]
            home = next((p for p in polys if _in_ring(p[0], p0[0], p0[1])), polys[0])
            home.append(h)
        return {"type": "MultiPolygon", "coordinates": polys}

    # -- the answer ---------------------------------------------------------------------------------------------------
    def features_out(self, only=None):
        """Every feature as {"acronym", "objl", "prim", "attrs" {acronym: value text}, "geometry", "rcid", "foid"}.
        An attribute whose code the catalog does not hold is kept under "ATTL<code>". `only`, a set of class acronyms,
        keeps those classes alone - their geometry is the only geometry built (a coverage read wants M_COVR, not the
        whole cell)."""
        cat = catalog()
        out = []
        for rcid in sorted(self.features):
            f = self.features[rcid]
            acr = cat["objl"].get(f["objl"], ("OBJL%d" % f["objl"],))[0]
            if only is not None and acr not in only:
                continue
            attrs = {}
            for k, v in f["attf"].items():
                attrs[cat["attl"].get(k, ("ATTL%d" % k,))[0]] = v
            for k, v in f["natf"].items():
                attrs.setdefault(cat["attl"].get(k, ("ATTL%d" % k,))[0], v)
            out.append({"acronym": acr, "objl": f["objl"], "prim": f["prim"], "attrs": attrs,
                        "geometry": self.geometry(f), "rcid": rcid, "foid": f["foid"]})
        return out



def _ring_area2(r):
    return sum(r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1] for i in range(len(r) - 1))


def _wind(ring, ccw):
    """The ring counter-clockwise (ccw) or clockwise, reversed when it runs the other way."""
    return ring[::-1] if (_ring_area2(ring) > 0) != ccw else ring


def _in_ring(ring, x, y):
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        if (y1 > y) != (y2 > y):
            if x < (x2 - x1) * (y - y1) / ((y2 - y1) or 1e-300) + x1:
                inside = not inside
    return inside


def read_files(paths, through=None, issued_by=None):
    """A cell from its files: the base (.000) and its updates (.001, ...), applied in number order whatever order they
    are given in. An update number missing from the run is an error - a cell with a gap is not the published chart.
    `through` stops after that update number; `issued_by` (YYYYMMDD) stops before the first update issued after it -
    the cell as it stood on a day (a comparison with a copy read then)."""
    base = [p for p in paths if p.lower().endswith(".000")]
    if len(base) != 1:
        raise S57Error("one base file (.000) is needed, %d given" % len(base))
    ups = {int(os.path.splitext(p)[1][1:]): p for p in paths if not p.lower().endswith(".000")}
    return _assemble(base[0], ups, _read_file, through, issued_by)


def _read_file(p):
    with open(p, "rb") as f:
        return f.read()


def read_zip(path_or_bytes, cell=None, through=None, issued_by=None):
    """A cell from NOAA's zip (ENC_ROOT/<CELL>/<CELL>.000, .001, ...). `cell` names it when the zip holds more than one;
    `through` and `issued_by` as read_files."""
    src = io.BytesIO(path_or_bytes) if isinstance(path_or_bytes, (bytes, bytearray)) else path_or_bytes
    with zipfile.ZipFile(src) as z:
        names = [n for n in z.namelist() if re.search(r"\.\d{3}$", n)]
        if cell:
            names = [n for n in names if os.path.basename(n).upper().startswith(cell.upper() + ".")]
        # A cell is a stem with a base (.000); the exchange set's CATALOG.031 is not one
        stems = {os.path.splitext(os.path.basename(n))[0].upper() for n in names if n.endswith(".000")}
        names = [n for n in names if os.path.splitext(os.path.basename(n))[0].upper() in stems]
        if len(stems) != 1:
            raise S57Error("the zip holds %d cells (%s) - name one" % (len(stems), ", ".join(sorted(stems))[:200]))
        base = [n for n in names if n.endswith(".000")][0]
        ups = {int(n[-3:]): n for n in names if not n.endswith(".000")}
        return _assemble(base, ups, z.read, through, issued_by)


def _issue_date(buf):
    """An update file's issue date (its DSID's ISDT, YYYYMMDD), or "" when it states none."""
    for rec in _iso8211_records(buf):
        d = Cell._one(rec, "DSID")
        if d:
            return (d.get("ISDT") or "").strip()
    return ""


def _assemble(base, ups, read, through=None, issued_by=None):
    c = Cell()
    c.read_base(read(base))
    c.name = c.name or os.path.splitext(os.path.basename(base))[0] + ".000"
    for n in sorted(ups):
        last = (c.updates_applied + c.updates_withheld)[-1:] or [0]
        if n != last[0] + 1:
            raise S57Error("%s: update %03d follows %s - an update is missing" % (
                c.name, n, ("%03d" % last[0]) if last[0] else "the base"))
        if c.updates_withheld or through is not None and n > through:
            c.updates_withheld.append(n)
            continue
        buf = read(ups[n])
        if issued_by is not None:
            isdt = _issue_date(buf)
            if not isdt or isdt > issued_by:
                c.updates_withheld.append(n)
                continue
        c.apply_update(buf, n)
    return c


def usage_band(cell_name):
    """The navigational purpose (1 overview .. 6 berthing) from a cell's name, e.g. US5A3KDD -> 5."""
    m = re.match(r"[A-Z0-9]{2}(\d)", (cell_name or "").upper())
    return int(m.group(1)) if m else None


# ── ENCDIRECT'S SHAPE ────────────────────────────────────────────────────────────────────────────────────────────────
# NOAA's ENCDirect service publishes these same cells as map layers, and the console's model was built on what it
# serves. A cell read here is put in that shape so it stands where an ENCDirect answer stood (enc_cells.py, the console's
# chart source since phase 2):
#   LAYER NAMES. A layer is the object class's catalog name in words joined by "_" with the primitive after it -
#     Shoreline_Construction_line, Buoy_Lateral_point - except where the name already ends in that word (Depth_Area,
#     Navigation_Line), and except where it does not: Restricted_Area_area in the harbor and approach bands,
#     Restricted_Area in the three coarser ones. So a class is looked for under both forms in the band's own list,
#     compared without case or punctuation (Builtup_Area_point is "Built-up area"), and ENCDIRECT_NAME_EXCEPTIONS holds
#     the six names NOAA spelled its own way. Checked against all six bands' published lists (tests/s57_reader.py).
#     A class the band publishes no layer for is not served by ENCDirect at all, and gets no layer here (None).
#   SOUNDINGS. One SOUNDG object is a cluster of soundings; ENCDirect serves each sounding as its own Sounding_point,
#     the depth as the point's third coordinate.
#   VALUES. ENCDirect types each attribute its own way, measured over 297,430 features of his cache (2026-11-21):
#     ENCDIRECT_FLOAT a number, ENCDIRECT_INT a whole number, ENCDIRECT_MEANING the enumerated value's MEANING as text
#     ("pier", not "4"), and the rest as the cell's own text - COLOUR "1,3", QUASOU "2", OBJNAM, INFORM, SORDAT.
#     A value present but empty is served absent.
#   ITS OWN WORDS. A meaning is the catalog's, except where ENCDirect words it its own way (ENCDIRECT_WORDING):
#     "pier" for "pier ( jetty)", "seawall" for "sea wall", "yacht harbor" for "yacht harbour/marina" - and it CUTS one
#     field at 30 characters ("wreck showing any portion of h"). Every entry was paired, object for object, between a
#     cell and his cached ENCDirect answer for the same day (tools/s57_match.py), or is the one text ENCDirect served
#     for that attribute whose catalog meaning differs only in its spacing.
#   A BLANK, NOT NOTHING. A meaning-valued attribute a class CARRIES (the catalog's attribute set for it) and the
#     object leaves out is served as " " - a restricted area with no CATREA, a pier line with no CATSLC: 58 of 58
#     paired cases over 14 areas, and absent on every class that does not carry it. CATWRK's blank is the text '" "'.
#     ⚠ IT IS NOT COSMETIC. static/js/speedzones.js maFacility reads a harbor facility with no CATHAF as a marina
#     (`!p.CATHAF`), and " " is not falsy: served absent instead, every such facility would gain the 150-ft band.
#   INFORM is cut at 254 characters (16 of 16 longer ones paired); a SOUNDING carries no attribute at all (4,304 of
#     4,304 at Salem - the depth is its third coordinate).
#   THE CELL'S NAME. ENCDirect carries DSNM (e.g. "US5A3KDD.000") on every feature; the coverage read keys on it.
ENCDIRECT_NAME_EXCEPTIONS = {
    ("UWTROC", PRIM_POINT): "Underwater_Awash_Rock_point",
    ("TSELNE", PRIM_LINE): "Traffice_Separation_Line",
    ("TSSBND", PRIM_LINE): "Traffice_Separation_Schema_Boundary_line",
    ("CTSARE", PRIM_AREA): "Cargo_Transhipment_Area",
    ("BUAARE", PRIM_AREA): "Build_Up_Area",
    ("CURENT", PRIM_POINT): "CURENT_Non_Gravitational_point",
}
ENCDIRECT_FLOAT = frozenset(("DRVAL1", "DRVAL2", "VALSOU", "VALDCO", "WATLEV", "VERCLR", "VERCCL", "VERCOP", "HORCLR"))
ENCDIRECT_INT = frozenset(("CATLAM", "CATCAM", "CONDTN", "EXPSOU", "TRAFIC", "CATZOC"))
ENCDIRECT_MEANING = frozenset(("CATREA", "CATWRK", "CATOBS", "CATBRG", "CATSLC", "CATSCF", "CATHAF", "CATMOR",
                               "CATGAT", "CATCOV"))
ENCDIRECT_WORDING = {
    "CATHAF": {"5": "yacht harbor"},
    "CATOBS": {"1": "snag/stump"},
    "CATSCF": {"28": "landing/launching place for boats"},
    "CATSLC": {"2": "groin", "4": "pier", "5": "promenade", "6": "wharf", "10": "seawall"},
    "CATWRK": {"1": "non-dangerous wreck (test)", "5": "wreck showing any portion of h"},
}
ENCDIRECT_BLANK = " "
ENCDIRECT_BLANK_OF = {"CATWRK": '" "'}
ENCDIRECT_TEXT_WIDTH = {"INFORM": 254}
_PRIM_WORD = {PRIM_POINT: "point", PRIM_LINE: "line", PRIM_AREA: "area"}


def _squash(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def encdirect_class(acronym, prim, layers):
    """The ENCDirect layer name an object of class `acronym` and primitive `prim` is served under in a band whose
    published layer names are `layers`, or None when that band publishes no such layer."""
    layers = layers if isinstance(layers, (set, frozenset, dict)) else set(layers)
    exc = ENCDIRECT_NAME_EXCEPTIONS.get((acronym, prim))
    if exc and exc in layers:
        return exc
    words = _class_words(acronym)
    if not words or prim not in _PRIM_WORD:
        return None
    base = "_".join(words)
    want = {_squash(base + "_" + _PRIM_WORD[prim])}
    if words[-1].lower() == _PRIM_WORD[prim]:
        want.add(_squash(base))
    hits = sorted(L for L in layers if _squash(L) in want)
    return hits[0] if len(hits) == 1 else None


def _class_words(acronym):
    """The class's catalog name as capitalized words (BOYLAT -> ["Buoy", "Lateral"]), or None for a class it lacks."""
    cat = catalog()
    code = cat["acr_objl"].get(acronym)
    if code is None:
        return None
    return [w[:1].upper() + w[1:] for w in re.split(r"[^A-Za-z0-9]+", cat["objl"][code][1]) if w] or None


def layer_name(acronym, prim):
    """The layer name BY THE RULE, for a class no band's list is asked about (the console's cell source, 2026-11-21):
    ENCDirect's spelling where it has its own (ENCDIRECT_NAME_EXCEPTIONS), else the catalog name joined by "_" with the
    primitive after it, not doubled where the name already ends in it (Depth_Area, Coverage_area). The bands' one
    irregular pair, Restricted_Area_area / Restricted_Area, comes out "Restricted_Area" - the console's roles name both.
    None for an object with no geometry of its own (a collection, primitive 255) or a class the catalog lacks."""
    exc = ENCDIRECT_NAME_EXCEPTIONS.get((acronym, prim))
    if exc:
        return exc
    words = _class_words(acronym)
    if not words or prim not in _PRIM_WORD:
        return None
    base = "_".join(words)
    return base if words[-1].lower() == _PRIM_WORD[prim] else base + "_" + _PRIM_WORD[prim]


def encdirect_value(acronym, raw, wording=ENCDIRECT_WORDING):
    """One attribute's value as ENCDirect serves it (see the section header). An unreadable number is None, never the
    text: absent is unknown, and unknown is the conservative case (asv_console._enc_keep_props, the same rule).
    `wording` {acronym: {code: text}} is ENCDirect's own wording of a meaning where it differs from the catalog's
    (ENCDIRECT_WORDING; None for the catalog's alone)."""
    if raw is None:
        return None
    t = raw.strip() if isinstance(raw, str) else raw
    if t == "":
        return None                  # present with no value: ENCDirect serves it absent (a Nome beacon's COLOUR)
    if acronym in ENCDIRECT_FLOAT:
        try:
            return float(t)
        except (TypeError, ValueError):
            return None
    if acronym in ENCDIRECT_INT:
        try:
            return int(float(t))
        except (TypeError, ValueError):
            return None
    if acronym in ENCDIRECT_MEANING:
        cat = catalog()
        code = cat["acr_attl"].get(acronym)
        out = []
        for part in [x for x in str(t).split(",") if x.strip()]:
            try:
                k = int(part)
            except ValueError:
                out.append(part.strip())
                continue
            w = ((wording or {}).get(acronym) or {}).get(str(k))
            out.append(w if w is not None else cat["expected"].get((code, k), part.strip()))
        return ",".join(out)
    w = ENCDIRECT_TEXT_WIDTH.get(acronym)
    return raw[:w] if w and isinstance(raw, str) else raw


def encdirect_features(cell, layers, wording=ENCDIRECT_WORDING, raw=False, only=None):
    """The cell's objects as ENCDirect serves them for a band whose layer names are `layers`: [{"cls", "properties",
    "geometry", "rcid"}], soundings one point each (with "part", its place in the cluster). An object with no layer in
    the band, or no geometry, is left out and counted in the second answer {(acronym, prim): count} - the caller says
    what it did not get. `layers` may instead be a function (acronym, prim) -> name or None: the console's cell source
    names every class it can (layer_name), where ENCDirect served only its bands' lists. `raw` adds the object's own
    attributes as "s57" (a comparison's evidence); `only` keeps those class acronyms alone (Cell.features_out)."""
    if callable(layers):
        namer = layers
    else:
        layers = set(layers)
        namer = lambda acronym, prim: encdirect_class(acronym, prim, layers)   # noqa: E731
    carries = catalog()["class_attrs"]
    out, left = [], {}
    for f in cell.features_out(only):
        cls = namer(f["acronym"], f["prim"])
        g = f["geometry"]
        if cls is None or g is None:
            k = (f["acronym"], f["prim"])
            left[k] = left.get(k, 0) + 1
            continue
        if f["acronym"] == "SOUNDG":
            props = {}                   # ENCDirect's soundings carry no attribute (the section header)
        else:
            props = {k: encdirect_value(k, v, wording) for k, v in f["attrs"].items()}
            props = {k: v for k, v in props.items() if v is not None}
            for k in ENCDIRECT_MEANING & carries.get(f["acronym"], frozenset()):
                if k not in props:
                    props[k] = ENCDIRECT_BLANK_OF.get(k, ENCDIRECT_BLANK)
        props["DSNM"] = cell.name
        extra = {"s57": f["attrs"], "acronym": f["acronym"]} if raw else {}
        if f["acronym"] == "SOUNDG" and g["type"] == "MultiPoint":
            for i, c in enumerate(g["coordinates"]):
                out.append(dict(extra, cls=cls, properties=dict(props), geometry={"type": "Point", "coordinates": c},
                                rcid=f["rcid"], part=i))
            continue
        out.append(dict(extra, cls=cls, properties=props, geometry=g, rcid=f["rcid"]))
    return out, left
