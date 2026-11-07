"""Fetch FLEURS real-voice test clips (CC BY 4.0) for fleurs.py — only the first N clips of each
language, streamed out of the archive and the download stopped, so a language costs ~10–20 MB,
not ~200. Test files only: they go to ~/.cache/notealise-whisper/fleurs, never the repo or the app.

Usage: python3 fleurs_fetch.py [clips per language, default 40] [fleurs codes…]
"""
import os, sys, tarfile, urllib.request

from fleurs_langs import LANGS

n = int(sys.argv[1]) if len(sys.argv) > 1 else 40
codes = sys.argv[2:] or list(LANGS)
ROOT = os.path.expanduser('~/.cache/notealise-whisper/fleurs')
BASE = 'https://huggingface.co/datasets/google/fleurs/resolve/main/data'

for code in codes:
    d = os.path.join(ROOT, code)
    os.makedirs(os.path.join(d, 'dev'), exist_ok=True)
    tsv = os.path.join(d, 'dev.tsv')
    if not os.path.exists(tsv):
        urllib.request.urlretrieve(f'{BASE}/{code}/dev.tsv', tsv)
    have = len([f for f in os.listdir(os.path.join(d, 'dev')) if f.endswith('.wav')])
    if have >= n:
        print(code, 'already has', have)
        continue
    got = 0
    with urllib.request.urlopen(f'{BASE}/{code}/audio/dev.tar.gz') as resp:
        with tarfile.open(fileobj=resp, mode='r|gz') as tar:
            for m in tar:
                if not m.isfile() or not m.name.endswith('.wav'):
                    continue
                name = os.path.basename(m.name)  # never trust a path inside an archive
                data = tar.extractfile(m).read()
                with open(os.path.join(d, 'dev', name), 'wb') as f:
                    f.write(data)
                got += 1
                if got >= n:
                    break
    print(code, 'fetched', got)
