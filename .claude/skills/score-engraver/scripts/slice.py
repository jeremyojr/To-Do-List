#!/usr/bin/env python3
"""Cut score images into enlarged, contrast-normalised tiles sized for reading.

    python slice.py IMAGE [IMAGE ...] [-o OUTDIR] [--zoom 1.5] [--box x0,y0,x1,y1]

Tiles are cut between systems where possible, scaled so a staff space is about
24 px (times --zoom), and printed in reading order with their source box.
--box re-cuts one region of a single image (source pixel coordinates).
PDF input is rasterised with pdftoppm when available.
"""
import argparse, math, statistics, subprocess, sys
from pathlib import Path
try:
    from PIL import Image, ImageChops, ImageFilter, ImageOps
except ImportError:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q",
                    "--disable-pip-version-check", "pillow"], timeout=300)
    from PIL import Image, ImageChops, ImageFilter, ImageOps

TARGET_SS, MAX_W, MAX_H, OVERLAP = 24, 1568, 800, 90


def flat(im):
    return list(im.get_flattened_data() if hasattr(im, "get_flattened_data") else im.getdata())


def ink_mask(gray):
    """Ink = clearly darker than the local background (survives shadows and dimming)."""
    bg = gray.filter(ImageFilter.GaussianBlur(max(gray.width // 40, 8)))
    return ImageChops.subtract(bg, gray).point(lambda v: 255 if v > 28 else 0)


def staff_space(ink):
    """Median distance between staff lines, read from the middle third of the width."""
    w, h = ink.size
    prof = flat(ink.crop((w // 3, 0, 2 * w // 3, h)).resize((1, h), Image.BOX))
    lines = [y for y in range(1, h - 1)
             if prof[y] > 110 and prof[y] >= prof[y - 1] and prof[y] > prof[y + 1]]
    gaps = sorted(b - a for a, b in zip(lines, lines[1:]) if b - a > 2)
    if len(gaps) < 4:
        return None
    return statistics.median(gaps[:max(len(gaps) * 2 // 3, 1)])


def row_cuts(ink, top, bottom, strip):
    """Cut rows, preferring the widest blank gap near each strip boundary."""
    rows = flat(ink.resize((1, ink.height), Image.BOX))
    cuts, y0 = [(top, top)], top
    while bottom - y0 > strip:
        best = run = None
        for y in range(int(y0 + strip * 0.55), min(int(y0 + strip), bottom)):
            if rows[y] == 0:
                run = (run[0], y) if run else (y, y)
            else:
                if run and (not best or run[1] - run[0] > best[1] - best[0]):
                    best = run
                run = None
        if run and (not best or run[1] - run[0] > best[1] - best[0]):
            best = run
        if best:
            y0 = (best[0] + best[1]) // 2
            cuts.append((y0, y0))
        else:                                   # no gap: overlap so nothing is lost
            y0 = int(y0 + strip * 0.9)
            cuts.append((y0 + int(strip * 0.05), y0 - int(strip * 0.05)))
    cuts.append((bottom, bottom))
    return [(a[1], b[0]) for a, b in zip(cuts, cuts[1:])]


def tiles(path, outdir, zoom, box):
    im = Image.open(path)
    gray = ImageOps.autocontrast(im.convert("L"), cutoff=1)
    ink = ink_mask(gray)
    x0, y0, x1, y1 = box or ink.getbbox() or (0, 0, *gray.size)
    pad = 12
    x0, y0 = max(x0 - pad, 0), max(y0 - pad, 0)
    x1, y1 = min(x1 + pad, gray.width), min(y1 + pad, gray.height)
    ss = staff_space(ink.crop((x0, y0, x1, y1)))
    scale = min(max((TARGET_SS / ss if ss else 1.5) * zoom, 0.4), 5)
    ncol = max(math.ceil((x1 - x0) * scale / (MAX_W - OVERLAP)), 1)
    step = (x1 - x0) / ncol
    cols = [(max(int(x0 + i * step - OVERLAP / scale / 2), x0),
             min(int(x0 + (i + 1) * step + OVERLAP / scale / 2), x1)) for i in range(ncol)]
    for r, (a, b) in enumerate(row_cuts(ink, y0, y1, MAX_H / scale), 1):
        for c, (l, rr) in enumerate(cols, 1):
            t = gray.crop((l, a, rr, b))
            t = t.resize((max(int(t.width * scale), 1), max(int(t.height * scale), 1)),
                         Image.LANCZOS)
            dest = outdir / f"{Path(path).stem}-r{r}c{c}.png"
            t.save(dest)
            print(f"{dest}  box={l},{a},{rr},{b}")


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("images", nargs="+")
    ap.add_argument("-o", "--outdir", default="tiles")
    ap.add_argument("--zoom", type=float, default=1.0)
    ap.add_argument("--box")
    a = ap.parse_args()
    outdir = Path(a.outdir)
    outdir.mkdir(parents=True, exist_ok=True)
    box = tuple(int(v) for v in a.box.split(",")) if a.box else None
    for src in a.images:
        if src.lower().endswith(".pdf"):
            stem = outdir / Path(src).stem
            if subprocess.run(["pdftoppm", "-r", "200", "-png", src, str(stem)]).returncode:
                sys.exit("pdftoppm failed; rasterise the PDF to PNG first")
            for page in sorted(outdir.glob(f"{Path(src).stem}-*.png")):
                tiles(page, outdir, a.zoom, box)
        else:
            tiles(src, outdir, a.zoom, box)


if __name__ == "__main__":
    main()
