---
name: score-engraver
description: Rewrite sheet music from images or scanned PDFs as a new high-definition vector score, then annotate it with chord symbols above the staff and small bold note-name labels beside the noteheads, delivered as a print-ready PDF. Use for any request to re-engrave, rewrite, transcribe, clean up or annotate a music score, label its notes, or name its chords. The music is re-typed note by note and typeset with the bundled LilyPond engraver. The source image is never traced, vectorised or drawn on.
---

# Score Engraver

## Contract

These rules override any shortcut that looks faster.

1. The only deliverable is the PDF that `scripts/engrave.py` writes from a LilyPond file you typed. Hand it over unchanged.
2. Never trace, vectorise, embed, crop or draw on the source image. Never build or post-process the PDF with reportlab, matplotlib, PIL, fpdf or any other drawing code.
3. Never detect notes with code (no OMR, contour or blob detection). Open the tiles with your image viewer and read the notes yourself.
4. Nothing appears in the PDF that the source does not print, apart from the chord symbols and note labels the engraver adds. No headers, footers, legends, captions, page banners, colour, or invented titles.
5. Every bar of every page is rewritten. No summarising, no "sim.", no skipped repeats unless the source prints them that way.
6. If `engrave.py` prints `ENGRAVER UNAVAILABLE`, stop and relay that message. Do not fall back to another method.

## Environment

- `SK` is this skill's folder. Uploads are in `/mnt/data`. Work in `/mnt/data/score/`.
- The container has no internet. LilyPond ships inside the skill and `engrave.py` unpacks it on first run. Do not try to install anything.
- `assets/style.ily` draws the chord row, the labels and the page. Never restyle. Read it only if a build breaks.

## Stage 1: Rewrite the score

**Slice.**

```bash
python $SK/scripts/slice.py /mnt/data/<upload> -o /mnt/data/score/tiles
```

It accepts images and PDFs and prints tiles in reading order (`-r<row>c<col>`). View every tile with your image viewer. Where a ledger line, accidental, dot or tie is not certain, re-cut that spot larger with `--zoom 1.6` or `--box x0,y0,x1,y1` before typing it.

**Set up.** Copy `$SK/assets/template.ly` to `/mnt/data/score/score.ly`. Fix clef, key, time signature and pickup. Keep one staff per printed staff: voice with lyrics, piano right hand, piano left hand.

**Type the music, one system at a time.** For each system: view its tiles, type its bars into every staff, then move on. Rules:

- Absolute octaves (`c'` = middle C). Never `\relative`.
- Type sounding pitches. In E major the top-line F is `fis''`. Add `!` or `?` only where the source prints an accidental that is not already implied.
- Count ledger lines one by one. In bass clef the first ledger line below is `e,`, the second `c,`, the third `a,,`.
- End every bar with `|`.
- Beam with `[ ]` exactly as printed. Two voices on a staff: `<< { \voiceOne … } \new Voice { \voiceTwo … } >> \oneVoice`.
- Reproduce what is printed: tempo text, dynamics, articulations, slurs, ties, repeats, voltas, lyrics, title. Guitar chord frames are left out; their chord names go in the chord row.

**Build after each source page.**

```bash
python $SK/scripts/engrave.py /mnt/data/score/score.ly
```

Fix every `WARN` before continuing. A barcheck warning means that bar's rhythm is wrong: re-read it from the tile.

## Stage 2: Annotate

Note labels are generated from the notes you typed. You add the chord symbols.

Write one `"Symbol"duration` per chord in `harmony`, on the beat where it sounds.

- If the source prints chord symbols, copy them. Correct only clear misprints.
- Otherwise collect every tone sounding in all staves over each harmonic span. Leave out tones that pass or resolve by step inside the same harmony.
- Choose the simplest name that covers the remaining tones. A bass note other than the root gives a slash chord. Name a 6th, 9th, 11th or 13th only if it sounds.
- When two names fit (`C6` or `Am7/C`), follow the bass line and the surrounding progression. Spell roots to fit the key.

Vocabulary: `C Cm Cdim Caug Csus4 C6 Cm6 C6/9 Cmaj7 C7 Cm7 Cm7b5 Cdim7 C7sus4 Cadd9 Cmaj9 C9 Cm9 C11 C13 C7b9 C7#9 C7#11 C7b13 C/E N.C.` Type `b` and `#`; they print as ♭ and ♯.

Build again and loop until `engrave.py` prints `OK`:

- `COLLISION`: view the crop (annotations show red, staff lines blue). Put `\labelNudge #1` (one space up, `#-1` down) before the note, or flip the colliding curve or stem (`^(`, `_~`, `\stemUp`). Never delete notation. After three failed tries on one spot, leave it and report the bar.
- View each `PREVIEW` strip beside the source tiles, bar by bar: rhythm, beaming, accidentals, ties, lyrics. The labels print the pitches you typed, so a label that disagrees with the source notehead is a misread. Fix it in `score.ly`.

Labels sit in the staff spaces beside the noteheads and ties stop short of them. Both are intended.

## Deliver

Copy the PDF to `/mnt/data/<Piece title>.pdf` and give the download link. Add one line only for bars you could not read with confidence. No description of the process.

If the score is too long to finish in this turn, stop at the end of a system, deliver the PDF so far, and state the last bar completed. When the user says continue, resume from `/mnt/data/score/score.ly`.

Options, set after the `\include`: `noteLabels = ##f`, `noteLabelTied = ##f`, `\paper { #(set-paper-size "letter") }`.
