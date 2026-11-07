"""Transcribe on REAL voices: Google's FLEURS recordings (real people reading set sentences,
CC BY 4.0), scored against the words they read. docs/plans/transcribe.md "Measured".

Runs the Whisper program exactly as the app does (transcribeModel.ts whisperArgs: -l auto -mc 0
-sns -ojf; FLEURS clips are under 30 s, so the app would make one stretch of each) and reports per
language: words wrong (WER), letters wrong (CER — the fair measure for Korean, where spacing varies),
how often the language was picked right, speed, and any clip where it got stuck repeating.

Setup (test files only — never in the app or the repo, ~400 MB):
  D=~/.cache/notealise-whisper/fleurs; for L in ko_kr en_us; do mkdir -p $D/$L && cd $D/$L &&
  curl -sSfLO https://huggingface.co/datasets/google/fleurs/resolve/main/data/$L/dev.tsv &&
  curl -sSfL https://huggingface.co/datasets/google/fleurs/resolve/main/data/$L/audio/dev.tar.gz | tar -xz; done

Usage: python3 fleurs.py <whisper-cli> <model .bin> [clips per language, default 30] [threads, default 5] [codes…]
Languages: fleurs_langs.py (fetch them with fleurs_fetch.py). Writes the full results beside the clips,
as results-<model>.json, and prints one line per language.
"""
import collections, json, os, random, re, subprocess, sys, tempfile, time, unicodedata

from fleurs_langs import LANGS as ALL

exe, model = sys.argv[1], sys.argv[2]
per = int(sys.argv[3]) if len(sys.argv) > 3 else 30
threads = sys.argv[4] if len(sys.argv) > 4 else '5'
ROOT = os.path.expanduser('~/.cache/notealise-whisper/fleurs')
LANGS = {c: ALL[c][0] for c in (sys.argv[5:] or ALL)}


def edits(a, b):
    """Levenshtein distance between two lists."""
    prev = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        cur = [i]
        for j, y in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x != y)))
        prev = cur
    return prev[-1]


def norm(s):
    s = unicodedata.normalize('NFKC', s).lower()
    s = re.sub(r"[^\w\s']", ' ', s)
    return s.split()


out = {}
tmp = tempfile.mkdtemp(prefix='fleurs-')
for folder, lang in LANGS.items():
    rows = [l.rstrip('\n').split('\t') for l in open(os.path.join(ROOT, folder, 'dev.tsv'), encoding='utf-8')]
    have = set(os.listdir(os.path.join(ROOT, folder, 'dev')))
    rows = sorted([r for r in rows if len(r) > 2 and r[1] in have], key=lambda r: r[1])
    random.Random(7).shuffle(rows)  # the same clips every run, so runs compare
    rows = rows[:per]
    words = word_err = chars = char_err = right_lang = stuck = 0
    secs = 0.0
    worst = []
    for r in rows:
        wav = os.path.join(ROOT, folder, 'dev', r[1])
        ref = r[2]
        t = time.time()
        p = subprocess.run([exe, '-m', model, '-f', wav, '-l', 'auto', '-t', threads, '-mc', '0', '-sns', '-np',
                            '-ojf', '-of', os.path.join(tmp, 'o')], capture_output=True, text=True, errors='replace')
        secs += time.time() - t
        try:
            j = json.load(open(os.path.join(tmp, 'o.json'), encoding='utf-8', errors='replace'))
        except Exception:
            j = {}
        hyp = ' '.join(s.get('text', '') for s in j.get('transcription', []))
        detected = (j.get('result') or {}).get('language')
        right_lang += detected == lang
        rw, hw = norm(ref), norm(hyp)
        e = edits(rw, hw)
        words += len(rw); word_err += e
        rc, hc = list(''.join(rw)), list(''.join(hw))
        ce = edits(rc, hc)
        chars += len(rc); char_err += ce
        sents = [x.strip() for x in re.split(r'[.!?]', hyp) if len(x.strip()) > 15]
        if sents and collections.Counter(sents).most_common(1)[0][1] >= 3:
            stuck += 1
        worst.append((ce / max(1, len(rc)), ref, hyp.strip(), detected))
    worst.sort(reverse=True)
    out[lang] = {
        'clips': len(rows),
        'words wrong %': round(100 * word_err / max(1, words), 1),
        'letters wrong %': round(100 * char_err / max(1, chars), 1),
        'language right %': round(100 * right_lang / len(rows)),
        'stuck repeating': stuck,
        'seconds per clip': round(secs / len(rows), 2),
        'worst 3': [{'letters wrong %': round(100 * w[0]), 'said': w[1][:90], 'heard': w[2][:90], 'language': w[3]} for w in worst[:3]],
    }
name = os.path.basename(model).replace('.bin', '')
json.dump(out, open(os.path.join(ROOT, f'results-{name}.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
print(f'{name}: language | words wrong % | letters wrong % | language right % | stuck | s/clip')
for code, lang in LANGS.items():
    o = out[lang]
    print(f"  {ALL[code][1]:<11} {o['words wrong %']:>6} {o['letters wrong %']:>6} {o['language right %']:>5} {o['stuck repeating']:>3} {o['seconds per clip']:>6}")
