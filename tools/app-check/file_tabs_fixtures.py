"""Real-shaped test documents for run_file_tabs*.py: a PDF, a .docx and an .xlsx laid out the way
Word and Excel write them."""
import subprocess, zipfile


def make_pdf(path, pages=3):
    objs = ['<< /Type /Catalog /Pages 2 0 R >>',
            '<< /Type /Pages /Kids [%s] /Count %d >>' % (' '.join(f'{3 + i * 2} 0 R' for i in range(pages)), pages)]
    for i in range(pages):
        s = (f'BT /F1 28 Tf 72 700 Td (Biology handout page {i + 1}) Tj ET '
             'BT /F1 14 Tf 72 660 Td (Cells, membranes and the nucleus.) Tj ET '
             '1 0 0 rg 72 600 200 20 re f')
        objs.append(f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {4 + i * 2} 0 R '
                    f'/Resources << /Font << /F1 {3 + pages * 2} 0 R >> >> >>')
        objs.append(f'<< /Length {len(s)} >>\nstream\n{s}\nendstream')
    objs.append('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    out = b'%PDF-1.4\n'
    offs = []
    for n, o in enumerate(objs, 1):
        offs.append(len(out))
        out += f'{n} 0 obj\n{o}\nendobj\n'.encode()
    x = len(out)
    out += f'xref\n0 {len(objs) + 1}\n0000000000 65535 f \n'.encode()
    for o in offs:
        out += f'{o:010d} 00000 n \n'.encode()
    out += f'trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{x}\n%%EOF\n'.encode()
    path.write_bytes(out)


def make_xlsx(path):
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('[Content_Types].xml', '<Types/>')
        z.writestr('xl/workbook.xml', '<workbook><sheets><sheet name="Marks" sheetId="1" r:id="rId1"/>'
                   '<sheet name="Term 2" sheetId="2" r:id="rId2"/></sheets></workbook>')
        z.writestr('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/>'
                   '<Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>')
        names = ['Student', 'Test 1', 'Test 2', 'Average', 'Date', 'Ada', 'Bo', 'Cy']
        z.writestr('xl/sharedStrings.xml', '<sst>' + ''.join(f'<si><t>{n}</t></si>' for n in names) + '</sst>')
        z.writestr('xl/styles.xml', '<styleSheet><cellXfs><xf numFmtId="0"/><xf numFmtId="9"/><xf numFmtId="14"/></cellXfs></styleSheet>')
        rows = ['<row r="1">' + ''.join(f'<c r="{c}1" t="s"><v>{i}</v></c>' for i, c in enumerate('ABCDE')) + '</row>']
        for r, (who, a, b) in enumerate([(5, .82, .91), (6, .64, .7), (7, .9, .88)], start=2):
            rows.append(f'<row r="{r}"><c r="A{r}" t="s"><v>{who}</v></c><c r="B{r}" s="1"><v>{a}</v></c>'
                        f'<c r="C{r}" s="1"><v>{b}</v></c><c r="D{r}" s="1"><f>AVERAGE(B{r}:C{r})</f><v>{(a + b) / 2}</v></c>'
                        f'<c r="E{r}" s="2"><v>{45960 + r}</v></c></row>')
        z.writestr('xl/worksheets/sheet1.xml', '<worksheet><sheetData>' + ''.join(rows) + '</sheetData></worksheet>')
        z.writestr('xl/worksheets/sheet2.xml', '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Next term</t></is></c></row></sheetData></worksheet>')


def make_docx(path):
    """A .docx laid out as Word writes one: a styled heading, a real table, a link. (macOS's textutil
    writes none of those as Word does — its tables come out as loose paragraphs.)"""
    W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
    cell = lambda t: f'<w:tc><w:p><w:r><w:t>{t}</w:t></w:r></w:p></w:tc>'
    body = ('<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Lab report</w:t></w:r></w:p>'
            '<w:p><w:r><w:t xml:space="preserve">The </w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>cell membrane</w:t></w:r>'
            '<w:r><w:t xml:space="preserve"> controls what enters and leaves the cell.</w:t></w:r></w:p>'
            '<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Results</w:t></w:r></w:p>'
            '<w:tbl><w:tr>' + cell('Sample') + cell('Mass (g)') + '</w:tr><w:tr>' + cell('A') + cell('2.4') + '</w:tr>'
            '<w:tr>' + cell('B') + cell('3.1') + '</w:tr></w:tbl>'
            '<w:p><w:r><w:t xml:space="preserve">See </w:t></w:r><w:hyperlink r:id="rLink"><w:r><w:t>the method</w:t></w:r></w:hyperlink><w:r><w:t>.</w:t></w:r></w:p>')
    styles = ''.join(f'<w:style w:type="paragraph" w:styleId="Heading{n}"><w:name w:val="heading {n}"/></w:style>' for n in (1, 2))
    with zipfile.ZipFile(path, 'w') as z:
        z.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                   '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                   '<Default Extension="xml" ContentType="application/xml"/>'
                   '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                   '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
        z.writestr('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        z.writestr('word/_rels/document.xml.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                   '<Relationship Id="rStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
                   '<Relationship Id="rLink" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com" TargetMode="External"/></Relationships>')
        z.writestr('word/styles.xml', f'<?xml version="1.0"?><w:styles {W}>{styles}</w:styles>')
        z.writestr('word/document.xml', f'<?xml version="1.0"?><w:document {W}><w:body>{body}</w:body></w:document>')
