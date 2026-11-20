"""Made-up exports shaped like each app's real one. usage: python3 make_fixtures.py <out dir>
Everything here is written by hand from what each app's export is known to look like — NOT a real export."""
import base64, json, os, shutil, struct, sys, zipfile, zlib
from pathlib import Path

OUT = Path(sys.argv[1])
if OUT.exists():
    shutil.rmtree(OUT)
OUT.mkdir(parents=True)


def png(w=120, h=80, rgb=(200, 120, 60)):
    raw = b''.join(b'\x00' + bytes(rgb) * w for _ in range(h))
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


def old(p: Path, days: int):
    t = 1_760_000_000 - days * 86400
    os.utime(p, (t, t))


ID = lambda n: ('%032x' % (0xabc123 * (n + 7)))[-32:]

# ---------------------------------------------------------------- Notion, HTML export
def notion_page(title, body):
    return f'''<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"/><title>{title}</title><style>
/* cspell:disable-file */ html {{ -webkit-print-color-adjust: exact; }} .page-title {{ font-size: 2.5rem; }}
</style></head><body><article id="x" class="page sans"><header><h1 class="page-title">{title}</h1><p class="page-description"></p></header><div class="page-body">{body}</div></article></body></html>'''

n = OUT / 'notion-html' / 'Export-1f2e'
(n / 'Biology' / 'Revision tasks').mkdir(parents=True)
bio = f'''<h2 id="a">Cell structure</h2>
<p>The <strong>nucleus</strong> holds the <em>DNA</em>. <mark class="highlight-yellow_background">Mitochondria make ATP.</mark> <mark class="highlight-red">Exam topic!</mark> <span style="border-bottom:0.05em solid">underlined</span> and <del>struck out</del>.</p>
<figure class="block-color-gray_background callout" style="white-space:pre-wrap;display:flex"><div style="font-size:1.5em"><span class="icon">💡</span></div><div style="width:100%">Remember: plant cells have a cell wall.</div></figure>
<ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> <span class="to-do-children-checked">Read chapter 3</span><div class="indented"></div></li></ul>
<ul class="to-do-list"><li><div class="checkbox checkbox-off"></div> <span class="to-do-children-unchecked">Make flashcards</span><div class="indented"></div></li></ul>
<ul class="toggle"><li><details open=""><summary>What is osmosis?</summary><p>Water moving across a membrane.</p></details></li></ul>
<ul class="bulleted-list"><li style="list-style-type:disc">Outer point<ul class="bulleted-list"><li style="list-style-type:circle">Nested point</li></ul></li></ul>
<ol type="1" class="numbered-list" start="1"><li>First step</li></ol><ol type="1" class="numbered-list" start="2"><li>Second step</li></ol>
<figure class="image"><a href="Biology/cell%20diagram.png"><img style="width:240px" src="Biology/cell%20diagram.png"/></a><figcaption>A labelled cell</figcaption></figure>
<pre class="code code-wrap"><code class="language-Python">def area(r):
    return 3.14 * r * r</code></pre>
<figure class="equation"><style>@import url('https://cdnjs.cloudflare.com/ajax/libs/KaTeX/0.16.9/katex.min.css')</style><div class="equation-container"><span class="katex-display"><span class="katex"><span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML" display="block"><semantics><mrow><mi>E</mi><mo>=</mo><mi>m</mi><msup><mi>c</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true"><span class="base"><span class="mord mathnormal">E</span><span class="mrel">=</span><span class="mord mathnormal">m</span><span class="mord"><span class="mord mathnormal">c</span><span class="msupsub"><span class="mord mtight">2</span></span></span></span></span></span></span></div></figure>
<div class="column-list"><div style="width:50%" class="column"><p>Left column text</p></div><div style="width:50%" class="column"><p>Right column text</p></div></div>
<table class="simple-table"><tbody><tr><td>Organelle</td><td>Job</td></tr><tr><td>Ribosome</td><td>Makes protein</td></tr></tbody></table>
<figure class="link-to-page"><a href="Biology/Mitosis%20{ID(2)}.html"><span class="icon">📄</span>Mitosis</a></figure>
<p>See also <a href="Biology/Mitosis%20{ID(2)}.html">Mitosis</a> and <a href="https://example.com/cells">this site</a>.</p>
<figure><div class="source"><a href="Biology/Lecture%20slides.pdf">Lecture slides.pdf</a></div></figure>
<figure><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ" class="bookmark source"><div class="bookmark-info"><div class="bookmark-text"><div class="bookmark-title">A video about cells</div><div class="bookmark-description">Watch this</div></div><div class="bookmark-href">https://www.youtube.com/watch?v=dQw4w9WgXcQ</div></div></a></figure>
<div class="collection-content"><h4 class="collection-title">Revision tasks</h4><table class="collection-content"><thead><tr><th>Name</th><th>Status</th><th>Due</th></tr></thead><tbody><tr><td class="cell-title"><a href="Biology/Revision%20tasks/Past%20paper%201%20{ID(4)}.html">Past paper 1</a></td><td>Done</td><td>@March 3, 2026</td></tr></tbody></table></div>'''
(n / f'Biology {ID(1)}.html').write_text(notion_page('Biology', bio))
(n / 'Biology' / 'cell diagram.png').write_bytes(png())
(n / 'Biology' / 'Lecture slides.pdf').write_bytes(b'%PDF-1.4\n% made-up\n')
(n / 'Biology' / f'Mitosis {ID(2)}.html').write_text(notion_page('Mitosis', f'<p>Prophase, metaphase, anaphase, telophase. Back to <a href="../Biology%20{ID(1)}.html">Biology</a>.</p><figure class="image"><a href="image.png"><img src="image.png"/></a></figure>'))
(n / 'Biology' / 'image.png').write_bytes(png(60, 60, (10, 160, 90)))
(n / 'Biology' / f'Revision tasks {ID(3)}.csv').write_text('Name,Status,Due\nPast paper 1,Done,"March 3, 2026"\nPast paper 2,Not started,"March 10, 2026"\n')
row = lambda t, s: notion_page(t, f'<table class="properties"><tbody><tr class="property-row property-row-status"><th><span class="icon property-icon"></span>Status</th><td><span class="status-value">{s}</span></td></tr><tr class="property-row property-row-date"><th>Due</th><td><time>@March 3, 2026</time></td></tr></tbody></table><p>Notes about {t}.</p>')
(n / 'Biology' / 'Revision tasks' / f'Past paper 1 {ID(4)}.html').write_text(row('Past paper 1', 'Done'))
(n / 'Biology' / 'Revision tasks' / f'Past paper 2 {ID(5)}.html').write_text(row('Past paper 2', 'Not started'))
(n / f'Shopping: list? {ID(6)}.html'.replace(':', ' ').replace('?', '')).write_text(notion_page('Shopping: list?', '<p>Milk, eggs — café ☕</p>'))
(n / f'Untitled {ID(7)}.html').write_text(notion_page('Untitled', '<p></p>'))
(n / f'Untitled {ID(8)}.html').write_text(notion_page('Untitled', '<p>A second untitled page</p>'))
# Everything else a Notion page can hold, written the way Notion's HTML export writes it (the class names match what
# Obsidian's open-source Notion importer looks for — src/formats/notion/convert-to-md.ts, checked 2026-11-17).
feat = f'''<p>Inline maths <span data-token-index="0" contenteditable="false" class="notion-text-equation-token" style="user-select:all"><span></span><span><span class="katex"><span class="katex-mathml"><math><semantics><mrow><msup><mi>x</mi><mn>2</mn></msup></mrow><annotation encoding="application/x-tex">x^2 + 1</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">x2+1</span></span></span></span> in a sentence.</p>
<p><mark class="highlight-blue">blue words</mark>, <mark class="highlight-gray_background">grey wash</mark>, <mark class="highlight-pink_background">pink wash</mark>, <mark class="highlight-orange">orange words</mark>, <span style="border-bottom:0.05em solid">underlined</span>, <code>inline code</code>, <a href="https://example.com">a web link</a>.</p>
<details open=""><summary style="font-weight:600;font-size:1.5em;line-height:1.3;margin:0">A toggle heading</summary><p>Inside the toggle heading.</p></details>
<ul class="toggle"><li><details><summary>A shut toggle</summary><ul class="to-do-list"><li><div class="checkbox checkbox-off"></div> <span class="to-do-children-unchecked">a task inside</span><div class="indented"></div></li></ul></details></li></ul>
<ul class="to-do-list"><li><div class="checkbox checkbox-off"></div> <span class="to-do-children-unchecked">Parent task</span><div class="indented"><ul class="to-do-list"><li><div class="checkbox checkbox-on"></div> <span class="to-do-children-checked">Child task done</span><div class="indented"></div></li></ul></div></li></ul>
<blockquote class="block-color-default">A quote from the book.</blockquote>
<hr/>
<figure class="block-color-yellow_background callout" style="white-space:pre-wrap;display:flex"><div style="font-size:1.5em"><span class="icon">⚠️</span></div><div style="width:100%"><strong>Careful:</strong> two lines<br/>in one callout.</div></figure>
<p class="block-color-red">A whole red paragraph.</p>
<nav class="block-color-gray table_of_contents"><div class="table_of_contents-item table_of_contents-indent-0"><a class="table_of_contents-link" href="#a">Cell structure</a></div></nav>
<figure><div class="source"><a href="https://www.youtube.com/watch?v=abc123">https://www.youtube.com/watch?v=abc123</a></div></figure>
<p><a href="Features%20{ID(9)}.html">@Features</a> mentions itself; <a href="https://www.notion.so/Missing-page-0123456789abcdef0123456789abcdef">a page outside the export</a>.</p>
<p></p><p></p>'''
(n / f'Features {ID(9)}.html').write_text(notion_page('Features', feat).replace('<p class="page-description"></p>', '<p class="page-description">Every kind of block, for testing</p>'))
for f in n.rglob('*.html'):
    old(f, 400)
# the download: a zip holding a zip, as a big workspace arrives
inner = OUT / 'notion-html' / 'Export-1f2e-Part-1.zip'
with zipfile.ZipFile(inner, 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sorted(n.rglob('*')):
        if f.is_file():
            z.write(f, f.relative_to(n).as_posix())
with zipfile.ZipFile(OUT / 'notion-html' / 'Notion export.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    z.write(inner, inner.name)

# ---------------------------------------------------------------- Notion, "Markdown & CSV" as .md
m = OUT / 'notion-md' / 'Export-9a8b'
(m / f'Biology {ID(1)}').mkdir(parents=True)
(m / f'Biology {ID(1)}.md').write_text(f'# Biology\n\nThe **nucleus** holds the DNA.\n\n- [x] Read chapter 3\n- [ ] Make flashcards\n\n[Mitosis](Biology%20{ID(1)}/Mitosis%20{ID(2)}.md)\n\n![cell diagram.png](Biology%20{ID(1)}/cell%20diagram.png)\n\n[Revision tasks](Biology%20{ID(1)}/Revision%20tasks%20{ID(3)}.csv)\n')
(m / f'Biology {ID(1)}' / f'Mitosis {ID(2)}.md').write_text('# Mitosis\n\nProphase, metaphase.\n')
(m / f'Biology {ID(1)}' / 'cell diagram.png').write_bytes(png())
(m / f'Biology {ID(1)}' / f'Revision tasks {ID(3)}.csv').write_text('Name,Status\nPast paper 1,Done\n')
(m / f'Biology {ID(1)}' / f'Revision tasks {ID(3)}').mkdir()
(m / f'Biology {ID(1)}' / f'Revision tasks {ID(3)}' / f'Past paper 1 {ID(4)}.md').write_text('# Past paper 1\n\nStatus: Done\n\nNotes.\n')
with zipfile.ZipFile(OUT / 'notion-md' / 'Notion markdown export.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sorted(m.rglob('*')):
        if f.is_file():
            z.write(f, f.relative_to(m).as_posix())

# ---------------------------------------------------------------- Markdown: an Obsidian vault
o = OUT / 'obsidian' / 'My Vault'
for d in ('.obsidian', 'Daily', 'Projects/Thesis', 'attachments', 'Templates'):
    (o / d).mkdir(parents=True)
(o / '.obsidian' / 'app.json').write_text('{}')
(o / 'Home.md').write_text('---\ntags: [index, home]\naliases: [Start]\ncreated: 2024-01-05\n---\n# Home\n\nGo to [[Thesis plan]] or [[Thesis plan|the plan]] or [[Thesis plan#Timeline]] or [[Projects/Thesis/Thesis plan]].\n\nA missing one: [[Not written yet]].\n\n![[diagram.png]]\n![[diagram.png|200]]\n![[Thesis plan]]\n\n> [!note] A callout\n> Callout body\n\n#tag-one #nested/tag\n\n==highlighted== and %%a comment%%\n\n- [ ] task 📅 2026-01-01\n- [x] done task\n\n```dataview\nLIST FROM #index\n```\n\n$$\n\\int_0^1 x^2 dx\n$$\n\nBlock ref ^abc123\n\nFootnote[^1]\n\n[^1]: The footnote text.\n')
(o / 'Projects' / 'Thesis' / 'Thesis plan.md').write_text('# Thesis plan\n\n## Timeline\n\n| Month | Goal |\n| --- | --- |\n| Jan | Draft |\n\n![a picture](../../attachments/photo%20(1).jpg)\n\n[the pdf](../../attachments/paper.pdf)\n')
(o / 'Daily' / '2026-01-01.md').write_text('Woke up early.\n')
(o / 'Daily' / 'Notes.md').write_text('Daily notes index\n')
(o / 'Projects' / 'Notes.md').write_text('Project notes index — same name as Daily/Notes\n')
(o / 'Templates' / 'Meeting.md').write_text('# {{title}}\n\nDate: {{date}}\n')
(o / 'attachments' / 'diagram.png').write_bytes(png())
(o / 'attachments' / 'photo (1).jpg').write_bytes(png(40, 40))
(o / 'attachments' / 'paper.pdf').write_bytes(b'%PDF-1.4\n')
(o / 'Board.canvas').write_text('{"nodes":[],"edges":[]}')
(o / 'Sketch.excalidraw.md').write_text('---\nexcalidraw-plugin: parsed\n---\n# Text Elements\n')
(o / 'old plain.txt').write_text('A plain text file from years ago.\r\nSecond line.\r\n')
(o / 'latin1.md').write_bytes('Caf\xe9 r\xe9sum\xe9 \x97 saved by an old Windows editor\n'.encode('latin-1'))
(o / 'empty.md').write_text('')
(o / 'CON.md').write_text('a Windows-reserved name\n')
for f in o.rglob('*.md'):
    old(f, 700)

# ---------------------------------------------------------------- HTML pages
h = OUT / 'html'
(h / 'Recipes' / 'Pancakes_files').mkdir(parents=True)
(h / 'Recipes' / 'Pancakes.html').write_text('<!DOCTYPE html><html><head><meta charset="utf-8"><title>Pancakes &amp; syrup &#8211; Mum&#39;s</title><style>body{font:16px serif}</style><script>alert(1)</script></head><body><nav><a href="/">Home</a> | <a href="/about">About</a></nav><h1>Pancakes</h1><p>Mix <b>flour</b>, <font color="red">eggs</font> and <span style="background-color:#ffff00">milk</span>.</p><img src="Pancakes_files/stack.png" alt="a stack"><img src="https://example.com/remote.png"><img src="data:image/png;base64,' + base64.b64encode(png(8, 8)).decode() + '" alt="inline"><ul><li><input type="checkbox" checked> buy eggs</li><li><input type="checkbox"> buy milk</li></ul><table><tr><th>Item</th><th>Amount</th></tr><tr><td>Flour</td><td>200g</td></tr></table><p><a href="Waffles.html">Waffles</a> <a href="mailto:a@b.com">mail</a></p><iframe src="https://www.youtube.com/embed/abc"></iframe><footer>© 2019 Recipes Ltd · Cookie settings</footer></body></html>')
(h / 'Recipes' / 'Pancakes_files' / 'stack.png').write_bytes(png())
(h / 'Recipes' / 'Waffles.html').write_text('<html><head><title>Waffles</title></head><body><p>Like pancakes. Back to <a href="Pancakes.html">Pancakes</a>.</p></body></html>')
(h / 'old page.htm').write_bytes('<html><head><meta http-equiv="Content-Type" content="text/html; charset=windows-1252"><title>Caf\xe9 notes</title></head><body><p>Caf\xe9 \x93quoted\x94 \x97 r\xe9sum\xe9</p></body></html>'.encode('latin-1'))
(h / 'no title.html').write_text('<p>Just a paragraph, no title or heading.</p>')
# an Evernote-style single page export
(h / 'Evernote note.html').write_text('<html><head><meta http-equiv="Content-Type" content="text/html; charset=UTF-8"/><meta name="exporter-version" content="Evernote Mac 10"/><meta name="created" content="2021-03-04 10:00:00 +0000"/><meta name="keywords" content="work, ideas"/><title>Meeting ideas</title></head><body><div><en-todo checked="true"/>Send agenda</div><div><en-todo/>Book room</div><div><br/></div><div>Plain line</div></body></html>')

# ---------------------------------------------------------------- Word .docx, written by hand
w = OUT / 'word'
w.mkdir()
W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math" xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:v="urn:schemas-microsoft-com:vml"'
def p(text, style=None, rpr='', ppr=''):
    s = f'<w:pStyle w:val="{style}"/>' if style else ''
    return f'<w:p><w:pPr>{s}{ppr}</w:pPr><w:r><w:rPr>{rpr}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r></w:p>'
def r(text, rpr=''):
    return f'<w:r><w:rPr>{rpr}</w:rPr><w:t xml:space="preserve">{text}</w:t></w:r>'
img = '<w:p><w:r><w:drawing><wp:inline><wp:extent cx="1143000" cy="762000"/><wp:docPr id="1" name="Picture 1" descr="a chart"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="chart.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId5"/></pic:blipFill><pic:spPr/></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>'
textbox = '<w:p><w:r><mc:AlternateContent><mc:Choice Requires="wps"><w:drawing><wp:anchor><wp:extent cx="1" cy="1"/><wp:docPr id="9" name="Text Box 1"/><a:graphic><a:graphicData uri="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"><wps:wsp><wps:txbx><w:txbxContent><w:p><w:r><w:t>Words inside a text box</w:t></w:r></w:p></w:txbxContent></wps:txbx></wps:wsp></a:graphicData></a:graphic></wp:anchor></w:drawing></mc:Choice></mc:AlternateContent></w:r></w:p>'
math = '<w:p><m:oMathPara><m:oMath><m:r><m:t>E=m</m:t></m:r><m:sSup><m:e><m:r><m:t>c</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath></m:oMathPara></w:p>'
tbl = '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Term</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Meaning</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Alpha</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>First</w:t></w:r></w:p><w:p><w:r><w:t>second paragraph in the cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
num = lambda t, lvl=0, n=1: f'<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="{lvl}"/><w:numId w:val="{n}"/></w:numPr></w:pPr><w:r><w:t>{t}</w:t></w:r></w:p>'
body = (p('Essay on photosynthesis', 'Title') + p('Introduction', 'Heading1')
        + '<w:p>' + r('Plain, ') + r('bold', '<w:b/>') + r(', ') + r('italic', '<w:i/>') + r(', ') + r('underlined', '<w:u w:val="single"/>') + r(', ')
        + r('red text', '<w:color w:val="FF0000"/>') + r(', ') + r('highlighted', '<w:highlight w:val="yellow"/>') + r(', ')
        + r('big text', '<w:sz w:val="48"/>') + r(', H') + r('2', '<w:vertAlign w:val="subscript"/>') + r('O, ')
        + '<w:hyperlink r:id="rId6"><w:r><w:t>a link</w:t></w:r></w:hyperlink>'
        + '<w:r><w:footnoteReference w:id="2"/></w:r>'
        + '<w:commentRangeStart w:id="0"/>' + r(' commented words') + '<w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/></w:r></w:p>'
        + p('Centred line', None, '', '<w:jc w:val="center"/>')
        + p('Method', 'Heading2') + num('Bullet one') + num('Nested bullet', 1) + num('Step one', 0, 2) + num('Step two', 0, 2)
        + tbl + img + textbox + math
        + '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' + p('After a page break', 'Heading1') + p('The end.')
        + '<w:sectPr><w:headerReference w:type="default" r:id="rId7"/></w:sectPr>')
doc = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document {W}><w:body>{body}</w:body></w:document>'
styles = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles {W}><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style><w:style w:type="paragraph" w:styleId="ListParagraph"><w:name w:val="List Paragraph"/></w:style></w:styles>'
numbering = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering {W}><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="o"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>'
footnotes = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes {W}><w:footnote w:id="2"><w:p><w:r><w:t>Smith 2020, p. 4.</w:t></w:r></w:p></w:footnote></w:footnotes>'
comments = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:comments {W}><w:comment w:id="0" w:author="Tutor"><w:p><w:r><w:t>Expand this point.</w:t></w:r></w:p></w:comment></w:comments>'
header = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:hdr {W}><w:p><w:r><w:t>Reuben — page header</w:t></w:r></w:p></w:hdr>'
RT = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
rels = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{RT}/styles" Target="styles.xml"/><Relationship Id="rId2" Type="{RT}/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="{RT}/footnotes" Target="footnotes.xml"/><Relationship Id="rId4" Type="{RT}/comments" Target="comments.xml"/><Relationship Id="rId5" Type="{RT}/image" Target="media/image1.png"/><Relationship Id="rId6" Type="{RT}/hyperlink" Target="https://example.com/paper" TargetMode="External"/><Relationship Id="rId7" Type="{RT}/header" Target="header1.xml"/></Relationships>'
ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/><Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/></Types>'
top = f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="{RT}/officeDocument" Target="word/document.xml"/></Relationships>'
with zipfile.ZipFile(w / 'Essay on photosynthesis.docx', 'w', zipfile.ZIP_DEFLATED) as z:
    z.writestr('[Content_Types].xml', ct); z.writestr('_rels/.rels', top); z.writestr('word/document.xml', doc)
    z.writestr('word/_rels/document.xml.rels', rels); z.writestr('word/styles.xml', styles); z.writestr('word/numbering.xml', numbering)
    z.writestr('word/footnotes.xml', footnotes); z.writestr('word/comments.xml', comments); z.writestr('word/header1.xml', header)
    z.writestr('word/media/image1.png', png())
(w / 'Not really word.docx').write_text('this is not a zip')
(w / 'Old report.doc').write_bytes(b'\xd0\xcf\x11\xe0 old binary word')
(w / 'Letter.rtf').write_text(r'{\rtf1 Hello {\b bold} world}')
(w / 'subfolder').mkdir()
shutil.copy(w / 'Essay on photosynthesis.docx', w / 'subfolder' / 'Second essay.docx')

# ---------------------------------------------------------------- Google Keep, as Takeout unzips
k = OUT / 'keep' / 'Takeout' / 'Keep'
k.mkdir(parents=True)
(OUT / 'keep' / 'Takeout' / 'archive_browser.html').write_text('<html><body>Takeout index</body></html>')
def keep(name, **kw):
    base = {'color': 'DEFAULT', 'isTrashed': False, 'isPinned': False, 'isArchived': False, 'textContent': '', 'title': '',
            'userEditedTimestampUsec': 1_650_000_000_000_000, 'createdTimestampUsec': 1_640_000_000_000_000}
    base.update(kw)
    (k / f'{name}.json').write_text(json.dumps(base))
    (k / f'{name}.html').write_text(f'<html><body><div class="title">{base["title"]}</div><div class="content">{base["textContent"]}</div></body></html>')
keep('Shopping', title='Shopping', listContent=[{'text': 'Milk', 'isChecked': True}, {'text': 'Eggs', 'isChecked': False}], labels=[{'name': 'Home'}, {'name': 'Urgent'}], isPinned=True, color='YELLOW')
keep('2022-03-04T10_11_12.345Z', textContent='A note with no title\nsecond line https://example.com', annotations=[{'description': 'x', 'source': 'WEBLINK', 'title': 'Example', 'url': 'https://example.com'}])
keep('Photo note', title='Photo note', textContent='With a picture', attachments=[{'filePath': 'IMG_0001.jpg', 'mimetype': 'image/jpeg'}], labels=[{'name': 'Trips'}])
(k / 'IMG_0001.jpg').write_bytes(png(30, 30))
keep('Voice', title='Voice memo', textContent='', attachments=[{'filePath': 'audio1.3gp', 'mimetype': 'audio/3gp'}])
(k / 'audio1.3gp').write_bytes(b'\x00\x00\x00\x18ftyp3gp4 made-up')
keep('Old idea', title='Old idea', textContent='Archived in Keep', isArchived=True)
keep('Binned', title='Binned', textContent='In the bin', isTrashed=True)
keep('Formatted', title='Formatted', textContent='Bold and heading here', textContentHtml='<p dir="ltr"><span style="font-weight:700">Bold</span> and <h1>heading</h1> here</p>')
keep('Shared', title='Shared list', textContent='Shared with someone', sharees=[{'isOwner': False, 'type': 'USER', 'email': 'friend@example.com'}])
keep('Nested', title='Nested list', listContent=[{'text': 'Parent', 'isChecked': False}, {'text': 'Child', 'isChecked': False}])
(k / 'Labels.txt').write_text('Home\nUrgent\nTrips\n')
with zipfile.ZipFile(OUT / 'keep' / 'takeout-20260101T000000Z-001.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sorted((OUT / 'keep' / 'Takeout').rglob('*')):
        if f.is_file():
            z.write(f, f.relative_to(OUT / 'keep').as_posix())

# ---------------------------------------------------------------- a big Markdown folder, for speed
b = OUT / 'big-md'
for f_ in range(40):
    d = b / f'Folder {f_ + 1}'
    d.mkdir(parents=True)
    for i in range(50):
        (d / f'Note {f_ + 1}-{i + 1}.md').write_text(f'# Note {f_ + 1}-{i + 1}\n\n' + ('Some words about revision. ' * 40 + '\n\n') * 6)
# and a big Notion-shaped zip
bn = OUT / 'big-notion' / 'x'
bn.mkdir(parents=True)
for i in range(1500):
    (bn / f'Page {i} {ID(i + 100)}.html').write_text(notion_page(f'Page {i}', '<p>' + 'Words about revision. ' * 200 + '</p>'))
with zipfile.ZipFile(OUT / 'big-notion' / 'Big export.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in sorted(bn.rglob('*')):
        z.write(f, f.relative_to(bn).as_posix())
print('made', sum(1 for _ in OUT.rglob('*')), 'files in', OUT)
