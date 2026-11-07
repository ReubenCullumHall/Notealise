#!/usr/bin/env bash
# Builds the Whisper program (whisper.cpp's whisper-cli) and fetches the Base file for
# "Transcribe a voice note" (docs/plans/transcribe.md). Run before packaging — locally
# and in .github/workflows/release.yml. Nothing is installed on the computer: the source,
# a private copy of cmake and the build live in a cache folder OUTSIDE OneDrive ($WHISPER_WORK,
# default ~/.cache/notealise-whisper — ~250 MB); only the finished program and the Base file
# land in build-whisper/ (gitignored).
#
#   tools/whisper/build.sh            this computer's chip
#   tools/whisper/build.sh x64        on an Apple silicon Mac: the Intel Mac build
#
# Leaves:
#   build-whisper/<platform>-<arch>/   whisper-cli + whisper-vad-speech-segments (the speech finder),
#                                      the shared Whisper core they both load (.dylib/.dll/.so —
#                                      one copy, not one baked into each program), + LICENSE
#   build-whisper/ggml-base-q5_1.bin   the Base file (57 MB), checked against its SHA-256
#   build-whisper/ggml-silero-v5.1.2.bin  the speech finder's file (0.9 MB), checked the same way
# <platform>-<arch> is Node's process.platform-process.arch (darwin-arm64, darwin-x64,
# win32-x64, linux-x64) — the same words electron-builder's ${platform}-${arch} expands to,
# and what main/transcribe.ts looks for.
#
# Why the CPU flags matter: a build tuned for the machine that built it (GGML_NATIVE, the
# default) uses whatever that GitHub machine's processor has, and crashes on an older laptop.
# So: Apple silicon and Intel Macs get a fixed baseline (every Intel Mac that runs this app
# has AVX2); Windows and Linux get every variant, and pick the best one when they start —
# cheap student laptops (Celeron/Pentium Silver) have no AVX2 at all.
set -euo pipefail

WHISPER_REPO=https://github.com/ggml-org/whisper.cpp
WHISPER_COMMIT=4da27c41cebadb3cbbcd2563e9c7cbc8d84bdcad   # measured on Reuben's M4, 2026-11-04
MODEL_URL=https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base-q5_1.bin
MODEL_SHA256=422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898
# The speech finder's file (Silero VAD, 0.9 MB): which parts of a recording are someone talking.
# Without it Whisper invents words in silence ("You", "www.cabella.com" — measured 2026-11-05).
VAD_URL=https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin
VAD_SHA256=29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf

ROOT=$(cd "$(dirname "$0")/../.." && pwd)
OUT="$ROOT/build-whisper"
WORK="${WHISPER_WORK:-$HOME/.cache/notealise-whisper}"
mkdir -p "$OUT" "$WORK"

case "$(uname -s)" in
  Darwin) PLATFORM=darwin ;;
  Linux) PLATFORM=linux ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM=win32 ;;
  *) echo "build.sh: unknown system $(uname -s)" >&2; exit 1 ;;
esac
HOST_ARCH=$(uname -m)
case "$HOST_ARCH" in arm64|aarch64) HOST_ARCH=arm64 ;; x86_64|amd64) HOST_ARCH=x64 ;; esac
ARCH=${1:-$HOST_ARCH}
DEST="$OUT/$PLATFORM-$ARCH"

# --- cmake: the one on the machine, or a private copy ---------------------------------
CMAKE=$(command -v cmake || true)
if [ -z "$CMAKE" ]; then
  [ -x "$WORK/venv/bin/cmake" ] || { python3 -m venv "$WORK/venv" && "$WORK/venv/bin/pip" -q install cmake; }
  CMAKE="$WORK/venv/bin/cmake"
fi

# --- the source, at the pinned commit ----------------------------------------------------
SRC="$WORK/src"
if [ ! -d "$SRC/.git" ]; then
  git init -q "$SRC"
  git -C "$SRC" remote add origin "$WHISPER_REPO"
fi
if [ "$(git -C "$SRC" rev-parse HEAD 2>/dev/null || true)" != "$WHISPER_COMMIT" ]; then
  git -C "$SRC" fetch -q --depth 1 origin "$WHISPER_COMMIT"
  git -C "$SRC" checkout -q --detach FETCH_HEAD
fi

# --- build -------------------------------------------------------------------------------
FLAGS=(-DCMAKE_BUILD_TYPE=Release -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF
       -DWHISPER_BUILD_EXAMPLES=ON -DWHISPER_SDL2=OFF -DWHISPER_CURL=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF)
case "$PLATFORM-$ARCH" in
  darwin-arm64)
    FLAGS+=(-DBUILD_SHARED_LIBS=ON -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0
            "-DCMAKE_INSTALL_RPATH=@loader_path" -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON
            -DGGML_METAL=ON -DGGML_METAL_EMBED_LIBRARY=ON) ;;
  darwin-x64)
    # Intel Macs: the processor only (no graphics chip), AVX2 baseline.
    FLAGS+=(-DBUILD_SHARED_LIBS=ON -DCMAKE_OSX_ARCHITECTURES=x86_64 -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0
            "-DCMAKE_INSTALL_RPATH=@loader_path" -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON
            -DGGML_METAL=OFF -DGGML_AVX=ON -DGGML_AVX2=ON -DGGML_FMA=ON -DGGML_F16C=ON) ;;
  win32-x64)
    # Every CPU variant, loaded at start; the C++ runtime built in (no "VCRUNTIME140.dll was not
    # found" on a PC without Visual C++ installed).
    FLAGS+=(-DBUILD_SHARED_LIBS=ON -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON
            -DCMAKE_POLICY_DEFAULT_CMP0091=NEW -DCMAKE_MSVC_RUNTIME_LIBRARY=MultiThreaded) ;;
  linux-x64)
    FLAGS+=(-DBUILD_SHARED_LIBS=ON -DGGML_BACKEND_DL=ON -DGGML_CPU_ALL_VARIANTS=ON
            "-DCMAKE_INSTALL_RPATH=\$ORIGIN" -DCMAKE_BUILD_WITH_INSTALL_RPATH=ON) ;;
  *) echo "build.sh: no recipe for $PLATFORM-$ARCH" >&2; exit 1 ;;
esac

BUILD="$WORK/build-$PLATFORM-$ARCH"
"$CMAKE" -S "$SRC" -B "$BUILD" "${FLAGS[@]}" >/dev/null
"$CMAKE" --build "$BUILD" --config Release -j 4 --target whisper-cli whisper-vad-speech-segments >/dev/null
# On Windows ggml-cpu variants are separate targets that whisper-cli doesn't depend on.
if [ "$PLATFORM" != darwin ]; then "$CMAKE" --build "$BUILD" --config Release -j 4 >/dev/null; fi

rm -rf "$DEST"; mkdir -p "$DEST"
BIN="$BUILD/bin"; [ -d "$BIN/Release" ] && BIN="$BIN/Release"
if [ "$PLATFORM" = win32 ]; then
  cp "$BIN/whisper-cli.exe" "$BIN/whisper-vad-speech-segments.exe" "$DEST/"
  cp "$BIN"/*.dll "$DEST/"
else
  cp "$BIN/whisper-cli" "$BIN/whisper-vad-speech-segments" "$DEST/"
  if [ "$PLATFORM" = linux ]; then find "$BUILD" -name '*.so*' -exec cp -P {} "$DEST/" \; ; fi
  if [ "$PLATFORM" = darwin ]; then find "$BUILD" -name '*.dylib' -exec cp -P {} "$DEST/" \; ; fi
  strip "$DEST/whisper-cli" "$DEST/whisper-vad-speech-segments" 2>/dev/null || true
fi
cp "$SRC/LICENSE" "$DEST/LICENSE-whisper.cpp.txt"

# --- the Base file -----------------------------------------------------------------------
MODEL="$OUT/ggml-base-q5_1.bin"
sha() { if command -v sha256sum >/dev/null; then sha256sum "$1" | cut -d' ' -f1; else shasum -a 256 "$1" | cut -d' ' -f1; fi; }
if [ ! -f "$MODEL" ] || [ "$(sha "$MODEL")" != "$MODEL_SHA256" ]; then
  curl -sSfL -o "$MODEL.part" "$MODEL_URL"
  got=$(sha "$MODEL.part")
  if [ "$got" != "$MODEL_SHA256" ]; then
    rm -f "$MODEL.part"
    echo "build.sh: the Base file's checksum is $got, expected $MODEL_SHA256 — refusing it" >&2
    exit 1
  fi
  mv "$MODEL.part" "$MODEL"
fi

VAD="$OUT/ggml-silero-v5.1.2.bin"
if [ ! -f "$VAD" ] || [ "$(sha "$VAD")" != "$VAD_SHA256" ]; then
  curl -sSfL -o "$VAD.part" "$VAD_URL"
  got=$(sha "$VAD.part")
  if [ "$got" != "$VAD_SHA256" ]; then
    rm -f "$VAD.part"
    echo "build.sh: the speech finder's checksum is $got, expected $VAD_SHA256 — refusing it" >&2
    exit 1
  fi
  mv "$VAD.part" "$VAD"
fi

# --- prove it runs -----------------------------------------------------------------------
EXE="$DEST/whisper-cli"; [ "$PLATFORM" = win32 ] && EXE="$DEST/whisper-cli.exe"
# An Intel build on an Apple silicon Mac can only be started through Rosetta, when it is installed.
if [ "$ARCH" = "$HOST_ARCH" ] || { [ "$PLATFORM-$ARCH" = darwin-x64 ] && arch -x86_64 /usr/bin/true 2>/dev/null; }; then
  "$EXE" --help >/dev/null 2>&1 || { echo "build.sh: the built program does not start" >&2; exit 1; }
  # And it really transcribes: whisper.cpp's own sample (JFK, 11 s) with the Base file, the
  # app's own settings. On Windows/Linux this proves the processor pieces load as well.
  heard=$("$EXE" -m "$MODEL" -f "$SRC/samples/jfk.wav" -l auto -t 2 -mc 0 -sns -np 2>/dev/null || true)
  case "$heard" in
    *ountry*) ;;
    *) echo "build.sh: the built program did not transcribe the sample: $heard" >&2; exit 1 ;;
  esac
  FIND="$DEST/whisper-vad-speech-segments"; [ "$PLATFORM" = win32 ] && FIND="$FIND.exe"
  found=$("$FIND" -vm "$VAD" -f "$SRC/samples/jfk.wav" -t 2 2>/dev/null || true)
  case "$found" in
    *"Speech segment 0"*) ;;
    *) echo "build.sh: the speech finder found no speech in the sample: $found" >&2; exit 1 ;;
  esac
fi
echo "whisper: $DEST ($(du -sh "$DEST" | cut -f1)) + $(du -h "$MODEL" | cut -f1) Base file + $(du -h "$VAD" | cut -f1) speech finder"
