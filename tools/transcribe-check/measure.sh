#!/bin/zsh
# Transcribe: measure Whisper Base on this computer (speed + words right), before and after any change
# to how the app runs Whisper. First used 2026-11-04 on Reuben's M4 (results in docs/plans/transcribe.md).
# Usage: tools/transcribe-check/measure.sh <work dir>   — builds whisper.cpp + fetches Base there (nothing installed).
# Needs: git, python3, ffmpeg, macOS `say` (Daniel + Yuna/Flo voices). Clips are the Mac's voices + pink noise:
# cleaner than a real phone recording, so real results will be somewhat worse.
set -e
W=${1:?work dir}; H=${0:a:h}; mkdir -p $W && cd $W
[ -d venv ] || { python3 -m venv venv && ./venv/bin/pip -q install cmake; }
[ -d src ] || git clone -q --depth 1 https://github.com/ggml-org/whisper.cpp src
[ -x src/build/bin/whisper-cli ] || (cd src && ../venv/bin/cmake -B build -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED_LIBS=OFF -DGGML_METAL_EMBED_LIBRARY=ON -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF >/dev/null \
  && ../venv/bin/cmake --build build -j 8 --target whisper-cli >/dev/null)
mkdir -p models; M=models/ggml-base-q5_1.bin
[ -f $M ] || curl -sL -o $M https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin
B=src/build/bin/whisper-cli
noisy(){ ffmpeg -loglevel error -y -i $1 -f lavfi -i "anoisesrc=color=pink:amplitude=0.02" -filter_complex \
  "[0:a]aresample=16000[a];[1:a]aresample=16000[n];[a][n]amix=inputs=2:duration=first:weights=1 1" -ac 1 -ar 16000 ${=3:+-t $3} -c:a pcm_s16le $2; }
say -v Daniel -r 175 -f $H/en.txt -o en.aiff; noisy en.aiff en.wav
say -v Yuna -r 175 -f $H/ko.txt -o ko.aiff 2>/dev/null || say -v Flo -r 175 -f $H/ko.txt -o ko.aiff; noisy ko.aiff ko.wav
# ~10 minutes of English that never repeats (looped text hides the stuck-repeating fault)
sed -E 's/[`*_#>|~()]//g' $H/../../docs/product-rulings.md | grep -E '^[A-Za-z -].{40,}' | head -c 9500 \
  | LC_ALL=C tr -cd 'A-Za-z0-9 .,;:?\n' | tr '\n' ' ' > long.txt
say -v Daniel -r 175 -f long.txt -o long.aiff; noisy long.aiff long.wav 600
t(){ local s=$(python3 -c 'import time;print(time.time())'); "$@" >/dev/null 2>&1; python3 -c "import time;print(f'{time.time()-$s:.1f}s')"; }
for g in "" "-ng"; do for mc in "" "-mc 0"; do
  echo "long  ${g:-gpu} ${mc:-ctx-default}: $(t $B -m $M -f long.wav -l auto -t 5 $=g $=mc -nt -np -otxt -of r)  $(./venv/bin/python3 $H/score.py long.txt r.txt)"
done; done
$B -m $M -f ko.wav -l auto -t 5 -mc 0 -nt -np -otxt -of k >/dev/null 2>&1; echo "Korean:"; cat k.txt
