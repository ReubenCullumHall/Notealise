// Runs a REAL markdown import in the scratch app's main process, the way the Import panel
// does — the picker's native dialog is swapped for a fixed answer, then the app's own
// `import:pickSource` and `import:run` handlers do the work (so the "Want to archive?" day
// stamp in main/ipc.ts is exercised, not copied).
//   node import.mjs <inspector port> <folder to import> <space name>
const [port, folder, spaceName] = process.argv.slice(2)
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const ws = new WebSocket(targets[0].webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
const expression = `(async () => {
  const { dialog, ipcMain } = process.mainModule.require('electron')
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(folder)}] })
  const handlers = ipcMain._invokeHandlers
  const paths = await handlers.get('import:pickSource')({}, 'markdown', 'both')
  const result = await handlers.get('import:run')({}, 'markdown', paths, ${JSON.stringify(spaceName)})
  return JSON.stringify({ paths, spaceFolder: result.spaceFolder, createdNotes: result.createdNotes })
})()`
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true } }))
const reply = await new Promise((r) => (ws.onmessage = (m) => r(JSON.parse(m.data))))
console.log(reply.result?.result?.value ?? JSON.stringify(reply))
ws.close()
