\version "2.24.0"
\include "style.ily"

% \header { title = "…" composer = "…" }   % only what the source prints

global = {
  \key a \major
  \time 4/4 \numericTimeSignature   % drop \numericTimeSignature if the source prints C
  \autoBeamOff                      % beam with [ ] exactly as printed
}

% One entry per chord, on the beat where it sounds; \skip fills silence.
% A pickup (\partial 8 in global) needs a matching \skip 8 here.
harmony = \lyricmode {
  \skip 8 "A6"8*7 |
  \skip 8 "Cmaj9"4. "Bm7"4 "Amaj9"4 |
}

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
    \new PianoStaff << \new Staff \rh \new Staff \lh >>
  >>
}

% Lead sheet: replace the PianoStaff with
%   \new Staff \new Voice = "mel" \melody
%   \new Lyrics \lyricsto "mel" { … }
% Fragments that do not connect: one \score block each.
