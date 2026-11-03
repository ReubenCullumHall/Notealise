import sys
p=sys.argv[1]+'/src/main/printNote.ts'
s=open(p).read()
def rep(a,b):
    global s
    assert s.count(a)==1,a
    s=s.replace(a,b)
rep("const res = await dialog.showSaveDialog(parent, {","const res = process.env.PRINT_TEST_OUT ? { canceled: false, filePath: process.env.PRINT_TEST_OUT + '/' + req.action + '-' + Date.now() + (req.action === 'html' ? '.html' : '.pdf') } : await dialog.showSaveDialog(parent, {")
rep("await fs.writeFile(file, doc, 'utf8')","await fs.writeFile(file, doc, 'utf8'); if (process.env.PRINT_TEST_OUT) await fs.writeFile(process.env.PRINT_TEST_OUT + '/last-' + req.action + '.html', doc, 'utf8')")
rep("if (!ok && /cancel/i.test(why))","if (process.env.PRINT_TEST_OUT) void fs.writeFile(process.env.PRINT_TEST_OUT + '/print-result.txt', JSON.stringify({ ok, why, t: Date.now() }))\n        if (!ok && /cancel/i.test(why))")
open(p,'w').write(s)
