#!/usr/bin/env python3
"""Seed a practice vault for the print check: python3 seed.py <vault-dir> <user-data-dir>

Writes three notes that between them hold everything the printed page has to cope
with (frontmatter, a block tag, note links, colour marks, maths and a price that
looks like maths, tasks with a nested bullet, a table, a toggle, a big picture, a
voice note, a video, code, a web link, a remote picture, a file link, a shut
toggle), plus the app's config so it opens straight into the vault.
"""
import json, os, struct, sys, zlib

vault, ud = sys.argv[1], sys.argv[2]


def png(w, h, rgb):
    raw = b''.join(b'\x00' + b''.join(bytes(rgb(x, y)) for x in range(w)) for y in range(h))

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)

    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


os.makedirs(vault + '/Physics', exist_ok=True)
os.makedirs(vault + '/.mdnotes', exist_ok=True)
os.makedirs(ud, exist_ok=True)
# 2400 px wide on purpose: the page must shrink it (MAX_PICTURE_WIDTH in print/page.ts).
open(vault + '/Physics/diagram.png', 'wb').write(png(2400, 1200, lambda x, y: (x * 255 // 2400, y * 255 // 1200, 180)))
open(vault + '/Physics/tiny.png', 'wb').write(png(300, 100, lambda x, y: (200, x * 255 // 300, 50)))
open(vault + '/Physics/Voice note 2026-10-13 14.32.m4a', 'wb').write(b'x')

open(vault + '/Physics/Waves.md', 'w').write('''---
tags: [physics]
---
# Waves

A wave carries **energy**, not matter. See [[Optics#Lenses]] and [[Optics|the optics note]]. ^k3x9

Second line of the same paragraph, with <mark class="hl-amber">a highlight</mark> and <span class="tc-sky">sky text</span> and <mark style="background-color: #ffcc00">custom hex</mark>.

## Equations

Speed is $v = f\\lambda$, and a price of $5 or $6 is just text.

$$
E = \\frac{1}{2} m v^2
$$

## Checklist

- [x] Read chapter 4
- [ ] Do the questions
  - nested bullet

| Wave | Speed |
|------|-------|
| Sound | 343 m/s |
| Light | 3e8 m/s |

> Waves are disturbances.

<details open><summary>A toggle</summary>

Hidden **body** text inside.

</details>

![A diagram](diagram.png)
''')
open(vault + '/Physics/More.md', 'w').write('''Plain opening line, no heading.

![small](tiny.png)

<audio controls src="Voice%20note%202026-10-13%2014.32.m4a"></audio> and a <video src="clip.mp4"></video>

```python
print("hello ^abc123")
```

[A web link](https://example.com) and ![remote](https://example.com/x.png) and a [file](notes.pdf) and [[Optics]].

<details><summary>Shut toggle</summary>

inside

</details>
''')
open(vault + '/Optics.md', 'w').write('# Optics\n\nLenses bend light.\n')
open(vault + '/.mdnotes/settings.json', 'w').write('{"playStartupAnimation": false}')
open(ud + '/config.json', 'w').write(json.dumps({'vaultPath': vault, 'hasOnboarded': True}))
print('seeded', vault)
