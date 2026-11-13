// Run one expression in the scratch app's behind-the-scenes half. usage: node main_eval.mjs <inspect port> '<expression>'
const [port, expr] = process.argv.slice(2)
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const ws = new WebSocket(list[0].webSocketDebuggerUrl)
await new Promise((r) => ws.addEventListener('open', r))
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
const reply = await Promise.race([new Promise((r) => ws.addEventListener('message', (m) => r(JSON.parse(m.data)))), new Promise((r) => setTimeout(() => r({ result: { result: { value: '(no reply — the app has gone)' } } }), 3000))])
console.log(JSON.stringify(reply.result?.result?.value ?? reply))
ws.close()
