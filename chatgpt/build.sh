#!/usr/bin/env bash
# Build the ChatGPT plugin zips into chatgpt/dist/.
#   score-engraver-chatgpt.zip       plugin with the LilyPond runtime bundled
#   score-engraver-chatgpt-lite.zip  same plugin without the runtime
set -euo pipefail
cd "$(dirname "$0")"
SKILL=score-engraver-plugin/skills/score-engraver
WORK=$(mktemp -d)
python3 -m pip download -q --no-deps --disable-pip-version-check lilypond==2.24.3 \
  --platform manylinux2014_x86_64 --only-binary=:all: -d "$WORK"
( cd "$WORK" && unzip -q lilypond-*.whl )
SRC=$(find "$WORK" -maxdepth 2 -type d -name lilypond-binaries | head -1)
mkdir -p "$WORK/rt/lilypond"/{bin,lib,share,libexec}
cp -a "$SRC/bin/lilypond" "$WORK/rt/lilypond/bin/"          # -a keeps mtimes: Guile needs them
cp -a "$SRC/lib/guile" "$SRC/lib/lilypond" "$WORK/rt/lilypond/lib/"
cp -a "$SRC/share/lilypond" "$SRC/share/guile" "$WORK/rt/lilypond/share/"
cp -a "$SRC/libexec/gs" "$WORK/rt/lilypond/libexec/"
cp -a "$SRC/etc" "$SRC/licenses" "$WORK/rt/lilypond/"
chmod +x "$WORK/rt/lilypond/bin/lilypond" "$WORK/rt/lilypond/libexec/gs"
tar -C "$WORK/rt" -cJf "$WORK/lilypond-rt.tar.xz" lilypond
rm -f $SKILL/runtime/lilypond-rt.tar.xz.part*
split -b 12M -d -a 1 "$WORK/lilypond-rt.tar.xz" $SKILL/runtime/lilypond-rt.tar.xz.part
find score-engraver-plugin -name __pycache__ -prune -exec rm -rf {} +
mkdir -p dist && rm -f dist/*.zip
( cd score-engraver-plugin && zip -qr -X ../dist/score-engraver-chatgpt.zip plugin.json .codex-plugin skills )
( cd score-engraver-plugin && zip -qr -X ../dist/score-engraver-chatgpt-lite.zip plugin.json .codex-plugin skills \
    -x "skills/score-engraver/runtime/*" )
rm -rf "$WORK"
ls -la dist
