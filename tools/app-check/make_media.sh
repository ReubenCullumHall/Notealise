#!/bin/bash
# Real test files for the media, voice, import and Transcribe checks, into $WORK/fix (default /tmp/app-check/fix).
# Needs ffmpeg (Homebrew) and the Mac's own `say`, `afconvert` and `textutil`. LONG=1 also makes the hour-long recording.
set -euo pipefail
WORK="${WORK:-/tmp/app-check}"; mkdir -p "$WORK/fix"; cd "$WORK/fix"
[ -f film.mp4 ] || ffmpeg -v error -y -f lavfi -i testsrc2=size=1280x720:rate=30 -f lavfi -i sine=frequency=440 -t 90 -c:v libx264 -preset ultrafast -b:v 3M -pix_fmt yuv420p -c:a aac -shortest film.mp4
[ -f film-fast.mp4 ] || ffmpeg -v error -y -i film.mp4 -c copy -movflags +faststart film-fast.mp4
[ -f memo.m4a ] || ffmpeg -v error -y -f lavfi -i sine=frequency=330:sample_rate=44100 -t 40 -c:a aac memo.m4a
[ -f memo.webm ] || ffmpeg -v error -y -f lavfi -i sine=frequency=330:sample_rate=48000 -t 40 -c:a libopus memo.webm
[ -f photo.png ] || ffmpeg -v error -y -f lavfi -i testsrc2=size=2400x1600 -frames:v 1 photo.png
[ -f photo.jpg ] || ffmpeg -v error -y -f lavfi -i testsrc2=size=2400x1600 -frames:v 1 -q:v 2 photo.jpg
[ -f drawing.svg ] || printf '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="200"><rect width="300" height="200" fill="teal"/></svg>' > drawing.svg
# over the hour that still gets a waveform (WAVE_MAX_SECONDS), so only the recording itself is measured
if [ "${LONG:-}" = "1" ] && [ ! -f long.m4a ]; then ffmpeg -v error -y -f lavfi -i sine=frequency=330:sample_rate=44100 -t 3700 -c:a aac -b:a 128k long.m4a; fi
if [ ! -f talk.m4a ]; then
  T="This is a long spoken recording made for a test of the transcribe feature. It keeps talking about revision, biology, the structure of a cell, and what to remember for the exam next week, so that the program has plenty of real speech to work through. "
  TXT=""; for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14; do TXT="$TXT$T"; done
  say -o talk.aiff "$TXT"; afconvert -f m4af -d aac talk.aiff talk.m4a; rm talk.aiff
fi
if [ ! -f "Essay draft.docx" ]; then
  printf '<html><body><h1>Lab report</h1><p>Some <b>bold</b> words and a list:</p><ul><li>one</li><li>two</li></ul><table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table></body></html>' > "Lab report.html"
  textutil -convert docx "Lab report.html" -output "Essay draft.docx"
fi
echo "media in $WORK/fix"
