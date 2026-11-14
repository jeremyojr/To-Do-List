---
name: score-engraver
description: Convert images of sheet music (photos, screenshots, scans, fragments or full pages) into a clean engraved PDF score with jazz/pop chord symbols above the staff and small note-name labels beside the noteheads. Use whenever the user uploads or points to a music score image or scan and wants it transcribed, re-engraved, cleaned up, stitched together, harmonically analysed, or annotated with chords or note names, even if they only say "turn this into a proper score", "label the notes" or "what are the chords here".
---

# Score Engraver

Score image(s) → LilyPond → PDF. The bundled files handle styling and checking; you read the music and work out the harmony. Paths below are relative to this skill's folder; keep working files in a scratch folder (`work/` here).

| File | Role |
|---|---|
| `scripts/slice.py` | cuts the input into enlarged tiles for reading |
| `assets/template.ly` | starting point and syntax example |
| `assets/style.ily` | chord-symbol row, note labels, page. Included by the template. Never restyle; read it only if something breaks |
| `scripts/engrave.py` | compiles, renders previews, detects collisions (installs LilyPond via pip if missing) |

## 1. Read

```bash
python scripts/slice.py IMAGE... -o work/tiles
```

View every tile in the printed order. Add `--zoom 1.5`, or `--box x0,y0,x1,y1` on one image, wherever a ledger line, accidental, dot or tie is not unambiguous. Guessing here is the main source of wrong notes.

Fix clef, key, time signature and pickup first. Order fragments by bar numbers, system continuity or overlapping bars, and drop the duplicated bars. Never invent missing bars.

## 2. Transcribe

Copy `assets/template.ly` to `work/score.ly` and replace the music.

- Absolute octaves (`c'` = middle C), never `\relative`, so an octave slip stays local.
- Write sounding pitches. In A major the top-line F is `fis''`. Add `!` or `?` only where the source prints an accidental that is not already implied.
- End every bar with `|`. `engrave.py` reports bars that do not add up.
- Beam with `[ ]` exactly as printed.
- Two voices on one staff: `<< { \voiceOne … } \new Voice { \voiceTwo … } >> \oneVoice`.
- Reproduce what is printed: dynamics, articulations, slurs, ties, repeats, voltas, tempo, title, lyrics. Add nothing else.

## 3. Harmonise

Write one `"Symbol"duration` per chord in `harmony`, on the beat where the chord sounds.

- If the source prints chord symbols, keep them. Correct only clear misprints.
- Otherwise collect every tone sounding in both staves over each harmonic span. Use voice leading to discard non-chord tones: a tone that passes or resolves by step inside the same harmony stays out of the name.
- Choose the simplest name that accounts for all remaining tones. A bass note other than the root gives a slash chord. Name a 6th, 9th, 11th or 13th only if it sounds.
- When two names fit (`C6` or `Am7/C`), follow the bass line and the surrounding progression.
- Spell roots to fit the key.

Vocabulary: `C Cm Cdim Caug Csus4 C6 Cm6 C6/9 Cmaj7 C7 Cm7 Cm7b5 Cdim7 C7sus4 Cadd9 Cmaj9 C9 Cm9 C11 C13 C7b9 C7#9 C7#11 C7b13 C/E N.C.` Type `b` and `#`; they print as ♭ and ♯.

## 4. Engrave and verify

```bash
python scripts/engrave.py work/score.ly
```

Loop until it prints `OK`:

- `WARN` — fix the source. A barcheck warning means a wrong rhythm in that bar.
- `COLLISION` — view the crop (labels show as red blocks). Put `\labelNudge #0.6` (negative moves down) before the note, or flip the colliding curve or stem (`^(`, `_~`, `\stemUp`). Never delete notation to clear a collision.
- View each `PREVIEW` strip beside the source tiles, bar by bar: rhythm, beaming, accidentals, ties. The labels print the pitches you entered, so a label that disagrees with the source notehead is a misread. Check that each chord symbol matches the labelled tones under it. Ties stop short of the labels by design.

Options, set after the `\include`: `noteLabels = ##f` (no labels), `noteLabelTied = ##f` (no labels on tied-to notes), `\paper { #(set-paper-size "letter") }`. For chords-free output, omit the `ChordSymbols` line.

## 5. Deliver

Give the user the PDF, named after the piece. Add a line only for bars you could not read with confidence or fragments that did not connect. No process summary.
