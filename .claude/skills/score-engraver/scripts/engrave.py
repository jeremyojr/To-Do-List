#!/usr/bin/env python3
"""Compile a score-engraver .ly file to PDF, render preview strips, and run a
pixel-level collision check on the annotations.

    python engrave.py score.ly [-o OUTDIR]

Prints PDF / PREVIEW / WARN / COLLISION lines.
Exit code: 0 clean, 1 compile error, 2 warnings or collisions to fix.
"""
import argparse, os, re, shutil, subprocess, sys, tempfile
from pathlib import Path

ASSETS = Path(__file__).resolve().parent.parent / "assets"
PIN = "lilypond==2.24.3"      # PyPI wheel bundles the binaries; no system packages needed
PREVIEW_DPI, CHECK_DPI = 170, 150
STRIP_H = 1000                # max preview strip height in px


def version(exe):
    try:
        out = subprocess.run([exe, "--version"], capture_output=True, text=True).stdout
        return tuple(int(x) for x in re.search(r"(\d+)\.(\d+)", out).groups())
    except Exception:
        return (0, 0)


def pip_install(spec):
    cmd = [sys.executable, "-m", "pip", "install", "-q", "--no-deps",
           "--disable-pip-version-check", spec]
    for extra in ([], ["--break-system-packages"], ["--user"]):
        try:
            if subprocess.run(cmd + extra, capture_output=True, timeout=300).returncode == 0:
                break
        except subprocess.TimeoutExpired:
            pass
    import importlib, site
    importlib.invalidate_caches()
    if site.getusersitepackages() not in sys.path:
        sys.path.append(site.getusersitepackages())


def find_lilypond():
    exe = shutil.which("lilypond")
    if exe and version(exe) >= (2, 24):
        return exe
    for attempt in (0, 1):
        try:
            import lilypond
            return str(lilypond.executable())
        except ImportError:
            if not attempt:
                pip_install(PIN)
    sys.exit("LilyPond >= 2.24 not found and `pip install lilypond` failed. "
             "Install it (pip install lilypond, or apt-get install lilypond) and re-run.")


def flat(im):
    return list(im.get_flattened_data() if hasattr(im, "get_flattened_data") else im.getdata())


def lily(exe, src, base, fmt, dpi, check=False):
    env = dict(os.environ)
    env.pop("SCORE_ENGRAVER_CHECK", None)
    if check:
        env["SCORE_ENGRAVER_CHECK"] = "1"
    return subprocess.run(
        [exe, "-I", str(ASSETS), "-dno-point-and-click", f"-dresolution={dpi}",
         *fmt, "-o", str(base), str(src)],
        capture_output=True, text=True, env=env)


def pages(base):
    one = Path(f"{base}.png")
    if one.exists():
        return [one]
    return sorted(Path(base).parent.glob(f"{Path(base).name}-page*.png"),
                  key=lambda p: int(re.search(r"page(\d+)", p.name).group(1)))


def strips(page, dest_stem):
    """Trim a page to its content and cut it between systems into strips that
    stay legible when viewed."""
    from PIL import Image, ImageOps
    im = Image.open(page).convert("RGB")
    box = ImageOps.invert(im.convert("L")).getbbox()
    if not box:
        return []
    m = 20
    im = im.crop((max(box[0] - m, 0), max(box[1] - m, 0),
                  min(box[2] + m, im.width), min(box[3] + m, im.height)))
    rows = flat(ImageOps.invert(im.convert("L")).resize((1, im.height), Image.BOX))
    cuts, y0 = [0], 0
    while im.height - y0 > STRIP_H:
        best, run = None, None
        for y in range(y0 + STRIP_H // 2, y0 + STRIP_H):
            if rows[y] == 0:
                run = (run[0], y) if run else (y, y)
            elif run:
                if not best or run[1] - run[0] > best[1] - best[0]:
                    best = run
                run = None
        if run and (not best or run[1] - run[0] > best[1] - best[0]):
            best = run
        y0 = (best[0] + best[1]) // 2 if best else y0 + STRIP_H
        cuts.append(y0)
    cuts.append(im.height)
    out = []
    for i, (a, b) in enumerate(zip(cuts, cuts[1:])):
        dest = Path(f"{dest_stem}{chr(97 + i) if len(cuts) > 2 else ''}.png")
        im.crop((0, a, im.width, b)).save(dest)
        out.append(dest)
    return out


def collisions(page, dest_stem):
    """In the check render annotations are red, staff lines blue, all else black.
    A collision is black ink within 1 px of red."""
    from PIL import Image, ImageChops, ImageFilter
    im = Image.open(page).convert("RGB")
    r, g, b = im.split()
    lo = lambda ch, t: ch.point(lambda v: 255 if v < t else 0)
    red = ImageChops.darker(r.point(lambda v: 255 if v > 150 else 0),
                            ImageChops.darker(lo(g, 110), lo(b, 110)))
    ink = ImageChops.darker(lo(r, 110), ImageChops.darker(lo(g, 110), lo(b, 110)))
    hit = ImageChops.darker(red.filter(ImageFilter.MaxFilter(3)), ink)
    box = hit.getbbox()
    if not box:
        return []
    cell = 24
    cells = {(cx, cy)
             for cx in range(box[0] // cell, box[2] // cell + 1)
             for cy in range(box[1] // cell, box[3] // cell + 1)
             if hit.crop((cx * cell, cy * cell, (cx + 1) * cell, (cy + 1) * cell)).getbbox()}
    out = []
    while cells:                       # merge neighbouring cells into one finding
        stack, grp = [cells.pop()], []
        while stack:
            c = stack.pop()
            grp.append(c)
            for n in [(c[0] + dx, c[1] + dy) for dx in (-1, 0, 1) for dy in (-1, 0, 1)]:
                if n in cells:
                    cells.remove(n)
                    stack.append(n)
        xs, ys = [c[0] for c in grp], [c[1] for c in grp]
        crop = im.crop((max(min(xs) * cell - 70, 0), max(min(ys) * cell - 70, 0),
                        min((max(xs) + 1) * cell + 70, im.width),
                        min((max(ys) + 1) * cell + 70, im.height)))
        dest = Path(f"{dest_stem}-collision{len(out) + 1}.png")
        crop.resize((crop.width * 3, crop.height * 3), Image.LANCZOS).save(dest)
        out.append(dest)
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("source")
    ap.add_argument("-o", "--outdir")
    a = ap.parse_args()
    src = Path(a.source).resolve()
    outdir = Path(a.outdir).resolve() if a.outdir else src.parent
    outdir.mkdir(parents=True, exist_ok=True)
    base = outdir / src.stem
    for old in outdir.glob(f"{src.stem}-p*.png"):
        old.unlink()

    exe = find_lilypond()
    res = lily(exe, src, base, ["--pdf", "--png"], PREVIEW_DPI)
    lines = res.stderr.splitlines()
    notes = [" ".join(s.strip() for s in lines[i:i + 3])
             for i, l in enumerate(lines) if re.search(r"warning|error", l, re.I)][:20]
    if res.returncode != 0 or not Path(f"{base}.pdf").exists():
        print(res.stderr.strip()[-3000:])
        sys.exit(1)

    previews, hits = [], []
    try:
        try:
            import PIL  # noqa: F401
        except ImportError:
            pip_install("pillow")
            import PIL  # noqa: F401
        for n, p in enumerate(pages(base), 1):
            previews += strips(p, f"{base}-p{n}")
            p.unlink()
        with tempfile.TemporaryDirectory() as tmp:
            if lily(exe, src, Path(tmp) / "c", ["--png"], CHECK_DPI, check=True).returncode == 0:
                for n, p in enumerate(pages(Path(tmp) / "c"), 1):
                    hits += collisions(p, f"{base}-p{n}")
    except ImportError:
        previews = pages(base)
        notes.append("collision check skipped: Pillow missing (pip install pillow)")

    print(f"PDF: {base}.pdf")
    print("PREVIEW: " + " ".join(map(str, previews)))
    for n in notes:
        print("WARN: " + n)
    for h in hits:
        print(f"COLLISION: {h}")
    if not notes and not hits:
        print("OK: no warnings, no collisions")
    sys.exit(2 if notes or hits else 0)


if __name__ == "__main__":
    main()
