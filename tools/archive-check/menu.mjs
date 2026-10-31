// Clicks an item in the app's MENU BAR through the scratch app's main-process inspector, the
// way choosing it with the mouse does — CDP keys skip menu shortcuts, and real OS keys could
// land in another Electron window (Reuben's own test copy is also called "Electron").
// Prints the item's shortcut, so a check can confirm Cmd/Ctrl+Shift+A is the one registered.
//   node menu.mjs <inspector port> <top menu label> <item label>
const [port, top, label] = process.argv.slice(2)
const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const ws = new WebSocket(targets[0].webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))
const expression = `(() => {
  const { Menu } = process.mainModule.require('electron')
  const menu = Menu.getApplicationMenu()
  const topItem = menu.items.find((i) => i.label === ${JSON.stringify(top)})
  const item = topItem && topItem.submenu.items.find((i) => i.label === ${JSON.stringify(label)})
  if (!item) return JSON.stringify({ found: false })
  item.click()
  return JSON.stringify({ found: true, accelerator: item.accelerator })
})()`
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression } }))
const reply = await new Promise((r) => (ws.onmessage = (m) => r(JSON.parse(m.data))))
console.log(reply.result?.result?.value ?? JSON.stringify(reply))
ws.close()
