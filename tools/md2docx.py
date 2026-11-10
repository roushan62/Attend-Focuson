#!/usr/bin/env python3
"""Minimal Markdown -> DOCX converter used for FocusOn HRMS docs.

Supports: headings (#..####), paragraphs, **bold**, *italic*, `code`,
bullet lists (-, *), numbered lists (1.), pipe tables, blockquotes,
fenced code blocks and horizontal rules.

Usage: python3 tools/md2docx.py input.md output.docx
Requires: pip install python-docx
"""
import re
import sys

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Pt, RGBColor, Cm

BRAND = RGBColor(0x1F, 0x4E, 0x79)
INLINE_RE = re.compile(r"(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*)")


def shade(cell, hex_fill):
    tc_pr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement("w:shd")
    shd.set(qn("w:val"), "clear")
    shd.set(qn("w:color"), "auto")
    shd.set(qn("w:fill"), hex_fill)
    tc_pr.append(shd)


def add_inline(par, text, bold=False, size=None):
    for part in INLINE_RE.split(text):
        if not part:
            continue
        if part.startswith("**") and part.endswith("**") and len(part) > 4:
            run = par.add_run(part[2:-2])
            run.bold = True
        elif part.startswith("`") and part.endswith("`") and len(part) > 2:
            run = par.add_run(part[1:-1])
            run.font.name = "Consolas"
            run.font.color.rgb = RGBColor(0xA3, 0x15, 0x15)
        elif part.startswith("*") and part.endswith("*") and len(part) > 2:
            run = par.add_run(part[1:-1])
            run.italic = True
        else:
            run = par.add_run(part)
        if bold:
            run.bold = True
        if size:
            run.font.size = Pt(size)


def split_row(line):
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    # allow escaped pipes \|
    cells = re.split(r"(?<!\\)\|", line)
    return [c.strip().replace("\\|", "|") for c in cells]


def is_sep_row(line):
    return bool(re.match(r"^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$", line))


def build_table(doc, rows):
    header = rows[0]
    body = rows[1:]
    ncols = len(header)
    table = doc.add_table(rows=1, cols=ncols)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for i, h in enumerate(header):
        cell = table.rows[0].cells[i]
        cell.text = ""
        add_inline(cell.paragraphs[0], h, bold=True, size=9)
        shade(cell, "DCE6F1")
    for r in body:
        cells = table.add_row().cells
        for i in range(ncols):
            txt = r[i] if i < len(r) else ""
            cells[i].text = ""
            add_inline(cells[i].paragraphs[0], txt, size=9)
    doc.add_paragraph()


def convert(src, dst):
    with open(src, encoding="utf-8") as fh:
        lines = fh.read().splitlines()

    doc = Document()
    sec = doc.sections[0]
    sec.left_margin = sec.right_margin = Cm(1.8)
    sec.top_margin = sec.bottom_margin = Cm(1.6)
    normal = doc.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(10.5)

    i = 0
    n = len(lines)
    while i < n:
        line = lines[i]
        stripped = line.strip()

        if stripped.startswith("```"):
            i += 1
            buf = []
            while i < n and not lines[i].strip().startswith("```"):
                buf.append(lines[i])
                i += 1
            i += 1
            par = doc.add_paragraph()
            run = par.add_run("\n".join(buf))
            run.font.name = "Consolas"
            run.font.size = Pt(9)
            continue

        if not stripped:
            i += 1
            continue

        if re.match(r"^-{3,}$", stripped) or re.match(r"^\*{3,}$", stripped):
            i += 1
            continue

        m = re.match(r"^(#{1,4})\s+(.*)$", stripped)
        if m:
            level = len(m.group(1))
            text = m.group(2).replace("**", "")
            heading = doc.add_heading(level=min(level, 4) if level > 1 else 0)
            run = heading.add_run(text)
            run.font.color.rgb = BRAND
            i += 1
            continue

        if stripped.startswith("|"):
            rows = []
            while i < n and lines[i].strip().startswith("|"):
                if not is_sep_row(lines[i]):
                    rows.append(split_row(lines[i]))
                i += 1
            if rows:
                build_table(doc, rows)
            continue

        if stripped.startswith(">"):
            buf = []
            while i < n and lines[i].strip().startswith(">"):
                buf.append(lines[i].strip()[1:].strip())
                i += 1
            par = doc.add_paragraph()
            par.paragraph_format.left_indent = Cm(0.8)
            add_inline(par, " ".join(b for b in buf if b))
            for run in par.runs:
                run.italic = True
            continue

        m = re.match(r"^(\s*)[-*]\s+(.*)$", line)
        if m:
            indent = len(m.group(1)) // 2
            style = "List Bullet" if indent == 0 else "List Bullet 2"
            par = doc.add_paragraph(style=style)
            add_inline(par, m.group(2))
            i += 1
            continue

        m = re.match(r"^(\s*)\d+[.)]\s+(.*)$", line)
        if m:
            par = doc.add_paragraph(style="List Number")
            add_inline(par, m.group(2))
            i += 1
            continue

        # plain paragraph (merge consecutive lines)
        buf = [stripped]
        i += 1
        while i < n and lines[i].strip() and not re.match(
            r"^(#{1,4}\s|\||>|```|\s*[-*]\s|\s*\d+[.)]\s|-{3,}$)", lines[i]
        ):
            buf.append(lines[i].strip())
            i += 1
        par = doc.add_paragraph()
        add_inline(par, " ".join(buf))

    doc.save(dst)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    convert(sys.argv[1], sys.argv[2])
    print("Wrote", sys.argv[2])
