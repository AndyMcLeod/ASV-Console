"""tools/build_pdfs.py - the four manuals as PDFs, converted from their .docx by LibreOffice (headless).

    python tools/build_pdfs.py          # build_docs.js runs this after it writes the .docx

WHY PDFs, AND WHY NOT WORD (Andy, 2026-11-19: "convert them from word to PDF and commit"). The chart's four document
buttons open these in the browser, so a machine with no Word still reads the manuals. The conversion is LibreOffice's,
never Word's: Word's own PDF export hung three times on 2026-10-05 (a hidden WINWORD that only Task Manager could end),
which is why the project made no PDFs until now. Each run uses a profile folder of its own, so it never attaches to a
LibreOffice the operator has open. A conversion that runs past CONVERT_TIMEOUT_S is killed, with its whole process tree.

A PDF IS REBUILT ONLY WHEN ITS DOCUMENT CHANGED. A rebuilt .docx differs in its bytes every time (its timestamps), so
a PDF keyed on bytes would be rewritten on every build. Each PDF is instead keyed on its document's CONTENT
(content_sha256: the text of word/document.xml paragraph by paragraph, and every image in word/media). docs/pdf_sources.json
records the content each PDF was built from, and tests/docs_valid.py fails on a PDF whose document has moved on since.

LibreOffice is found by ASV_SOFFICE, then `soffice` on the PATH, then its usual install folders. Not found: the .docx
are left as built, and this says so and exits 1 - the PDFs are then stale, which docs_valid.py reports.
"""
import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import tempfile
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.join(HERE, "..", "docs")
MANIFEST = os.path.join(DOCS, "pdf_sources.json")
NAMES = ["asv-simulator-quick-start", "asv-simulator-operations-manual", "asv-simulator-technical-manual",
         "asv-simulator-development-guide"]
CONVERT_TIMEOUT_S = 600
SOFFICE_PLACES = [r"C:\Program Files\LibreOffice\program\soffice.exe",
                  r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
                  "/Applications/LibreOffice.app/Contents/MacOS/soffice", "/usr/bin/soffice", "/usr/local/bin/soffice"]


def content_sha256(docx_path):
    """What a reader sees in the document, hashed: its paragraphs' text in order (tables' cells included, each a
    paragraph of word/document.xml) and every image it carries. Not its bytes, which a rebuild changes every time."""
    h = hashlib.sha256()
    with zipfile.ZipFile(docx_path) as z:
        body = z.read("word/document.xml").decode("utf-8")
        for para in re.findall(r"<w:p[ >].*?</w:p>", body, flags=re.S):
            text = "".join(re.findall(r"<w:t(?: [^>]*)?>([^<]*)</w:t>", para))
            h.update(text.encode("utf-8") + b"\n")
        for name in sorted(n for n in z.namelist() if n.startswith("word/media/")):
            h.update(name.encode("utf-8") + hashlib.sha256(z.read(name)).hexdigest().encode("ascii"))
    return h.hexdigest()


def find_soffice():
    env = os.environ.get("ASV_SOFFICE")
    if env:
        return env if os.path.isfile(env) else None
    for name in ("soffice", "soffice.exe", "libreoffice"):
        p = shutil.which(name)
        if p:
            return p
    return next((p for p in SOFFICE_PLACES if os.path.isfile(p)), None)


def load_manifest():
    try:
        with open(MANIFEST, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def kill_tree(proc):
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
    else:
        proc.kill()


def convert(soffice, docx_paths, outdir):
    """One LibreOffice run for every document that changed, in a profile of its own; killed whole past the timeout."""
    # Its long name, as a URL - PERCENT-ENCODED: a temp folder under "C:\Users\First Last" has a space, and LibreOffice
    # handed that space raw died at start (0xC0000409, measured 2026-11-19) before converting anything.
    profile = os.path.realpath(tempfile.mkdtemp(prefix="asv_lo_profile_"))
    try:
        cmd = [soffice, "-env:UserInstallation=" + pathlib.Path(profile).as_uri(),
               "--headless", "--norestore", "--nolockcheck", "--convert-to", "pdf", "--outdir", outdir] + docx_paths
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        try:
            out, _ = proc.communicate(timeout=CONVERT_TIMEOUT_S)
        except subprocess.TimeoutExpired:
            kill_tree(proc)
            proc.communicate()
            raise RuntimeError("LibreOffice did not finish in %d s and was stopped" % CONVERT_TIMEOUT_S)
        if proc.returncode != 0:
            raise RuntimeError("LibreOffice answered %d: %s" % (proc.returncode, out.decode("utf-8", "replace")[-400:]))
    finally:
        shutil.rmtree(profile, ignore_errors=True)


def main():
    manifest, todo = load_manifest(), []
    for n in NAMES:
        docx, pdf = os.path.join(DOCS, n + ".docx"), os.path.join(DOCS, n + ".pdf")
        if not os.path.isfile(docx):
            print("  MISSING %s.docx - build the documents first (node build_docs.js)" % n)
            return 1
        sha = content_sha256(docx)
        entry = manifest.get(n + ".pdf") or {}
        if os.path.isfile(pdf) and entry.get("content_sha256") == sha:
            print("  same    %s.pdf (its document has not changed)" % n)
        else:
            todo.append((n, docx, pdf, sha))
    if not todo:
        return 0
    soffice = find_soffice()
    if not soffice:
        print("  PDFs NOT REBUILT: LibreOffice was not found (set ASV_SOFFICE, or install it - on Windows: winget install "
              "--id TheDocumentFoundation.LibreOffice -e). Stale: " + ", ".join(t[0] + ".pdf" for t in todo))
        return 1
    out = os.path.realpath(tempfile.mkdtemp(prefix="asv_pdf_out_"))
    try:
        convert(soffice, [t[1] for t in todo], out)
        for n, docx, pdf, sha in todo:
            made = os.path.join(out, n + ".pdf")
            if not os.path.isfile(made) or os.path.getsize(made) < 1000:
                print("  FAILED  %s.pdf - LibreOffice wrote no PDF for it" % n)
                return 1
            shutil.move(made, pdf)
            manifest[n + ".pdf"] = {"from": n + ".docx", "content_sha256": sha}
            print("  written %s.pdf %d bytes" % (n, os.path.getsize(pdf)))
    except RuntimeError as e:
        print("  PDFs NOT REBUILT: %s" % e)
        return 1
    finally:
        shutil.rmtree(out, ignore_errors=True)
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        json.dump({k: manifest[k] for k in sorted(manifest)}, f, indent=2)
        f.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
