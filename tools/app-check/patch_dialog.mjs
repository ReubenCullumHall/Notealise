// Tell the scratch app's behind-the-scenes half to answer its next "choose a file" boxes with these paths
// (a native box can't be clicked from a script). usage: node patch_dialog.mjs <inspect port> <path> [<path>…]
const [port, ...paths] = process.argv.slice(2)
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const ws = new WebSocket(list[0].webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
const expr = `(() => { const { dialog } = process.mainModule.require('electron');
  globalThis.__picks = ${JSON.stringify(paths)};
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__picks.shift()] });
  return 'patched ' + globalThis.__picks.length })()`
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, includeCommandLineAPI: true } }))
const reply = await new Promise((r) => ws.addEventListener('message', (m) => r(JSON.parse(m.data))))
console.log(JSON.stringify(reply.result?.result?.value ?? reply))
ws.close()
