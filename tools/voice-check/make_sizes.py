"""The recordings sizes_probe.py needs, in WORK: short (0.4 s), long25 (25 min), long70 (70 min) —
talking-like tones, 5 s on and 2 s quiet, 16 kHz mono. On a Mac they are turned into .m4a with
afconvert; elsewhere they stay .wav (which plays everywhere).

    WORK=/some/dir python3 make_sizes.py"""
import array, math, random, subprocess, sys, wave
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from common import WORK  # noqa: E402


def make(path: Path, secs: float, rate: int = 16000) -> None:
    w = wave.open(str(path), 'wb')
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(rate)
    rnd = random.Random(1)
    for s in range(int(math.ceil(secs))):
        n = min(rate, int(secs * rate) - s * rate)
        if n <= 0:
            break
        amp = 0.4 if (s % 7) < 5 else 0.005
        a = array.array('h', (int(32767 * amp * math.sin(i / 7.0 + s) * (0.5 + 0.5 * math.sin(i / 1600.0))) + rnd.randint(-60, 60) for i in range(n)))
        w.writeframes(a.tobytes())
    w.close()


if __name__ == '__main__':
    WORK.mkdir(parents=True, exist_ok=True)
    for stem, secs in [('short', 0.4), ('long25', 25 * 60), ('long70', 70 * 60)]:
        wav = WORK / f'{stem}.wav'
        make(wav, secs)
        if sys.platform == 'darwin':
            subprocess.run(['afconvert', '-f', 'm4af', '-d', 'aac', str(wav), str(WORK / f'{stem}.m4a')], check=True)
            wav.unlink()
        print('made', stem)
