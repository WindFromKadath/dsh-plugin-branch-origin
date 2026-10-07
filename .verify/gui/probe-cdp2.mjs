/** 决定性探针：browser 级命令是否回应（区分"WS 传输坏了"与"page 目标有问题"）。 */
const port = Number(process.argv[2] ?? 9333)
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
console.log('browser ws =', version.webSocketDebuggerUrl)

function attempt(label, wsUrl, payload) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl)
    const timer = setTimeout(() => { console.log(`${label}: TIMEOUT`); try { ws.close() } catch {} resolve(false) }, 10000)
    ws.addEventListener('open', () => {
      console.log(`${label}: open -> ${payload.method}`)
      ws.send(JSON.stringify(payload))
    })
    ws.addEventListener('message', (event) => {
      clearTimeout(timer)
      console.log(`${label}: REPLY ${String(event.data).slice(0, 200)}`)
      try { ws.close() } catch {}
      resolve(true)
    })
    ws.addEventListener('error', (event) => { clearTimeout(timer); console.log(`${label}: ERROR ${event?.message ?? ''}`); resolve(false) })
    ws.addEventListener('close', (event) => console.log(`${label}: close ${event?.code ?? ''} ${event?.reason ?? ''}`))
  })
}

const browserOk = await attempt('browser', version.webSocketDebuggerUrl, { id: 1, method: 'Target.getTargets' })

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
const blank = list.find((t) => t.type === 'page' && t.url === 'about:blank')
if (blank) {
  await attempt('blank-page', blank.webSocketDebuggerUrl, { id: 1, method: 'Runtime.enable' })
} else {
  console.log('blank-page: 没有 about:blank 目标')
}

console.log(`\nbrowser 级命令可用 = ${browserOk}`)
process.exit(0)
