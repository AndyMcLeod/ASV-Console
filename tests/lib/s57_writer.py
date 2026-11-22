"""s57_writer.py - an ISO 8211 / S-57 cell writer for the suites (tests/s57_reader.py, tests/enc_cells.py).

It encodes ISO 8211 independently of the reader's decoder - its field formats are typed out here, not parsed by
s57.py - so a decoder fault cannot be mirrored by the writer and pass. Moved here from tests/s57_reader.py
(2026-11-21) when a second suite needed cells of its own.
"""
import io
import os
import sys
import zipfile

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
import s57                                                     # noqa: E402


# ── an ISO 8211 / S-57 writer ───────────────────────────────────────────────────────────────────────────────────────
FT, UT = b"\x1e", b"\x1f"
# tag: (array descriptor, format controls, [subfield encodings typed out: ("b", nbytes, signed) | ("B", n) | ("A",)])
F = {
    "DSID": ("RCNM!RCID!EXPP!INTU!DSNM!EDTN!UPDN!UADT!ISDT!STED!PRSP!PSDN!PRED!PROF!AGEN!COMT",
             "(b11,b14,2b11,3A,2A(8),R(4),b11,2A,b11,b12,A)",
             [("b", 1, 0), ("b", 4, 0), ("b", 1, 0), ("b", 1, 0), ("A",), ("A",), ("A",), ("A8",), ("A8",), ("A4",),
              ("b", 1, 0), ("A",), ("A",), ("b", 1, 0), ("b", 2, 0), ("A",)]),
    "DSPM": ("RCNM!RCID!HDAT!VDAT!SDAT!CSCL!DUNI!HUNI!PUNI!COUN!COMF!SOMF!COMT", "(b11,b14,3b11,b14,4b11,2b14,A)",
             [("b", 1, 0), ("b", 4, 0), ("b", 1, 0), ("b", 1, 0), ("b", 1, 0), ("b", 4, 0), ("b", 1, 0), ("b", 1, 0),
              ("b", 1, 0), ("b", 1, 0), ("b", 4, 0), ("b", 4, 0), ("A",)]),
    "FRID": ("RCNM!RCID!PRIM!GRUP!OBJL!RVER!RUIN", "(b11,b14,2b11,2b12,b11)",
             [("b", 1, 0), ("b", 4, 0), ("b", 1, 0), ("b", 1, 0), ("b", 2, 0), ("b", 2, 0), ("b", 1, 0)]),
    "FOID": ("AGEN!FIDN!FIDS", "(b12,b14,b12)", [("b", 2, 0), ("b", 4, 0), ("b", 2, 0)]),
    "ATTF": ("*ATTL!ATVL", "(b12,A)", [("b", 2, 0), ("A",)]),
    "NATF": ("*ATTL!ATVL", "(b12,A)", [("b", 2, 0), ("U",)]),
    "FSPC": ("FSUI!FSIX!NSPT", "(b11,2b12)", [("b", 1, 0), ("b", 2, 0), ("b", 2, 0)]),
    "FSPT": ("*NAME!ORNT!USAG!MASK", "(B(40),3b11)", [("B", 5), ("b", 1, 0), ("b", 1, 0), ("b", 1, 0)]),
    "FFPC": ("FFUI!FFIX!NFPT", "(b11,2b12)", [("b", 1, 0), ("b", 2, 0), ("b", 2, 0)]),
    "FFPT": ("*LNAM!RIND!COMT", "(B(64),b11,A)", [("B", 8), ("b", 1, 0), ("A",)]),
    "VRID": ("RCNM!RCID!RVER!RUIN", "(b11,b14,b12,b11)", [("b", 1, 0), ("b", 4, 0), ("b", 2, 0), ("b", 1, 0)]),
    "ATTV": ("*ATTL!ATVL", "(b12,A)", [("b", 2, 0), ("A",)]),
    "VRPC": ("VPUI!VPIX!NVPT", "(b11,2b12)", [("b", 1, 0), ("b", 2, 0), ("b", 2, 0)]),
    "VRPT": ("*NAME!ORNT!USAG!TOPI!MASK", "(B(40),4b11)", [("B", 5), ("b", 1, 0), ("b", 1, 0), ("b", 1, 0), ("b", 1, 0)]),
    "SGCC": ("CCUI!CCIX!CCNC", "(b11,2b12)", [("b", 1, 0), ("b", 2, 0), ("b", 2, 0)]),
    "SG2D": ("*YCOO!XCOO", "(2b24)", [("b", 4, 1), ("b", 4, 1)]),
    "SG3D": ("*YCOO!XCOO!VE3D", "(3b24)", [("b", 4, 1), ("b", 4, 1), ("b", 4, 1)]),
}


def _record(fields, ddr=False):
    """One ISO 8211 record from [(tag, field bytes ending in FT)]: leader, directory, field area."""
    dir_, area = b"", b""
    for tag, data in fields:
        dir_ += tag.encode() + b"%05d" % len(data) + b"%05d" % len(area)
        area += data
    dir_ += FT
    base = 24 + len(dir_)
    n = base + len(area)
    lead = (b"%05d3LE1 09%05d ! 5504" % (n, base)) if ddr else (b"%05d D     %05d   5504" % (n, base))
    assert len(lead) == 24
    return lead + dir_ + area


# A field's lexical level is said in its field control's last three characters, its truncated escape sequence
# (S-57 3.1 part 3, 7.2.2.1): blank level 0 (ASCII), "-A " level 1 (Latin-1), "%/A" level 2 (UCS-2). Only NATF's is
# written other than 0 here: at level `nall`. NOAA writes NATF at level 1; the reader reads it by the control.
LEXICAL = {0: b"   ", 1: b"-A ", 2: b"%/A"}


def _ddr(nall=2):
    fields = [("0000", b"0000;&   test" + FT),
              ("0001", b"0100;&   ISO 8211 Record Identifier" + UT + UT + b"(b12)" + FT)]
    for tag, (arr, fmt, _enc) in F.items():
        ctl = b"1600;&" + (LEXICAL[nall] if tag == "NATF" else LEXICAL[0])
        fields.append((tag, ctl + tag.encode() + UT + arr.encode() + UT + fmt.encode() + FT))
    return _record(fields, ddr=True)


def _field(tag, groups, nall=2):
    """A field's bytes; NATF's text ("U") at lexical level `nall` - UCS-2 at 2, its unit and field terminators two
    bytes, else Latin-1."""
    enc = F[tag][2]
    out = b""
    for g in groups:
        assert len(g) == len(enc), (tag, g)
        for e, v in zip(enc, g):
            if e[0] == "b":
                out += int(v).to_bytes(e[1], "little", signed=bool(e[2]))
            elif e[0] == "B":
                out += v
            elif e[0] == "U" and nall == 2:
                out += str(v).encode("utf-16-le") + b"\x1f\x00"
            elif e[0] == "U":
                out += str(v).encode("latin-1") + UT
            else:
                s = ("" if v is None else str(v)).encode("latin-1")
                out += s.ljust(int(e[0][1:]))[:int(e[0][1:])] if len(e[0]) > 1 else s + UT
    return out + (b"\x1e\x00" if tag == "NATF" and nall == 2 else FT)


def _name(rcnm, rcid):
    return bytes([rcnm]) + int(rcid).to_bytes(4, "little")


# The cell's scale factors - deliberately not NOAA's (1e7 and 10): a reader that assumed those reads these wrong.
COMF, SOMF = 1000000, 100
CAT = s57.catalog()
OBJL = CAT["acr_objl"]
ATTL = CAT["acr_attl"]


class W:
    """A cell being written: records in order; .bytes() is the file."""
    def __init__(self, name="US5TEST1.000", updn=0, isdt="20260101", edtn="1", reissue=0, nall=2):
        """`updn`: an update file of that number. `reissue`: a BASE re-issued at that update - its DSID UPDN, every
        update through it held in the base (S-57 3.1). `nall`: NATF's lexical level (NOAA's 1; 2 UCS-2)."""
        self.nall = nall
        head = [("0001", b"\x01\x00" + FT),
                ("DSID", _field("DSID", [(10, 1, 2 if updn else 1, 5, name, edtn, str(updn or reissue),
                                          "" if updn else "20260101", isdt, "03.1", 1, "2.0", "", 1, 550, "")]))]
        if not updn:        # the parameters ride on the base only
            head.append(("DSPM", _field("DSPM", [(20, 1, 2, 17, 23, 12000, 1, 1, 1, 1, COMF, SOMF, "")])))
        self.recs = [_record(head)]
        self.n = 1

    def _rid(self):
        self.n += 1
        return ("0001", self.n.to_bytes(2, "little") + FT)

    def node(self, rcid, lon, lat, rcnm=110, ruin=1, depth=None, cluster=None):
        f = [self._rid(), ("VRID", _field("VRID", [(rcnm, rcid, 1, ruin)]))]
        if cluster:
            f.append(("SG3D", _field("SG3D", [(round(la * COMF), round(lo * COMF), round(d * SOMF)) for lo, la, d in cluster])))
        else:
            f.append(("SG2D", _field("SG2D", [(round(lat * COMF), round(lon * COMF))])))
        self.recs.append(_record(f))

    def edge(self, rcid, beg, end, pts, ruin=1):
        f = [self._rid(), ("VRID", _field("VRID", [(130, rcid, 1, ruin)])),
             ("VRPT", _field("VRPT", [(_name(120, beg), 255, 255, 1, 255), (_name(120, end), 255, 255, 2, 255)]))]
        if pts:
            f.append(("SG2D", _field("SG2D", [(round(la * COMF), round(lo * COMF)) for lo, la in pts])))
        self.recs.append(_record(f))

    def feature(self, rcid, acr, prim, attrs=None, ptrs=(), ruin=1, natf=None, fspc=None, rver=1):
        f = [self._rid(), ("FRID", _field("FRID", [(100, rcid, prim, 2, OBJL[acr], rver, ruin)])),
             ("FOID", _field("FOID", [(550, rcid, 1)]))]
        if attrs:
            f.append(("ATTF", _field("ATTF", [(ATTL[k], v) for k, v in attrs.items()])))
        if natf:
            f.append(("NATF", _field("NATF", [(ATTL[k], v) for k, v in natf.items()], self.nall)))
        if fspc:
            f.append(("FSPC", _field("FSPC", [fspc])))
        if ptrs:
            f.append(("FSPT", _field("FSPT", [(_name(rn, ri), o, u, 255) for rn, ri, o, u in ptrs])))
        self.recs.append(_record(f))

    def raw(self, fields):
        self.recs.append(_record([self._rid()] + fields))

    def bytes(self):
        return _ddr(self.nall) + b"".join(self.recs)


def edge_ptr(rcid, ornt=1, usag=1):
    return (130, rcid, ornt, usag)


def node_ptr(rcid, rcnm=110):
    return (rcnm, rcid, 255, 255)


def zipped(files):
    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w") as z:
        for n, b in files.items():
            z.writestr(n, b)
    return bio.getvalue()
