\version "2.24.0"
\include "style.ily"

% \header { title = "…" composer = "…" }   % only what the source prints

global = {
  \key a \major
  \time 4/4 \numericTimeSignature   % drop \numericTimeSignature if the source prints C
  \autoBeamOff                      % beam with [ ] exactly as printed
}

% STAGE 2. One entry per chord, on the beat where it sounds; \skip fills silence.
% A pickup (\partial 8 in global) needs a matching \skip 8 here.
harmony = \lyricmode {
  \skip 8 "A6"8*7 |
  \skip 8 "Cmaj9"4. "Bm7"4 "Amaj9"4 |
}

% STAGE 1. Absolute octaves: c' is middle C. Every bar ends with |.
voice = {
  \global \clef treble
  R1 |
  r4 e'8[ fis'8] a'4 gis'8[ e'8] ~ |
}
words = \lyricmode { One line of words, }

rh = {
  \global \clef treble
  r8 <cis' e' fis' a'>8\mf r4 <cis' e' fis' a'>4 r4 \bar "||"
  r8 <b d' e' g'>8 <a b d' fis'>8 r8 <gis? b cis' e'>8 r8 r4 |
}

lh = {
  \global \clef bass
  r8 fis,8[ r8 a,,8] ~ a,,4 a,,8[ a,,8] |
  r8 c8 b,8 r8 a,8 r8 a,8[ e,8] |
}

\score {
  <<
    \new ChordSymbols \harmony
    \new Staff \new Voice = "vox" \voice
    \new Lyrics \lyricsto "vox" \words
    \new PianoStaff << \new Staff \rh \new Staff \lh >>
  >>
}

% Piano only: delete the "vox" Staff and Lyrics lines.
% Lead sheet: keep the "vox" Staff, delete the PianoStaff line.
% Fragments that do not connect: one \score block each.
