// Quits the scratch app the way Cmd/Ctrl+Q does — app.quit() in its main process,
// through the inspector — so the window's "before quit" work (saving, and Earlier
// versions' "When you close the app") really runs. Killing the process would skip it.
//   node quit.mjs <inspector port>
const [port] = process.argv.slice(2)
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const ws = new WebSocket(targets[0].webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
const expression = `(() => { process.mainModule.require('electron').app.quit(); return 'quitting' })()`
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression } }))
const reply = await new Promise((r) => (ws.onmessage = (m) => r(JSON.parse(m.data))))
console.log(reply.result?.result?.value ?? JSON.stringify(reply))
ws.close()
