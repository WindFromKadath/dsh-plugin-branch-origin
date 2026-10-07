/** 页面结构探针：逐步交互并 dump 状态，用来定位"为什么没有会话行"。 */
const port = Number(process.argv[2] ?? 9333)
const pageUrl = process.argv[3]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1
    const send = (method, params) => new Promise((res, rej) => {
      const id = nextId++
      pending.set(id, { res, rej })
      ws.send(JSON.stringify({ id, method, params: params ?? {} }))
    })
    ws.addEventListener('open', () => resolve({ send, close: () => ws.close() }))
    ws.addEventListener('error', () => reject(new Error('ws error')))
    ws.addEventListener('message', (event) => {
      void (async () => {
        const raw = typeof event.data === 'string' ? event.data : await event.data.text()
        const msg = JSON.parse(raw)
        if (msg.id && pending.has(msg.id)) {
          const { res, rej } = pending.get(msg.id)
          pending.delete(msg.id)
          if (msg.error) rej(new Error(JSON.stringify(msg.error)))
          else res(msg.result)
        }
      })()
    })
  })
}

async function evaluate(cdp, expression) {
  const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (result.exceptionDetails) throw new Error('eval failed: ' + (result.exceptionDetails.exception?.description ?? result.exceptionDetails.text))
  return result.result.value
}
const jsonEval = async (cdp, expr) => JSON.parse(await evaluate(cdp, `JSON.stringify(${expr})`))

const state = (label) => `(${JSON.stringify(label)}, (() => ({
  label: ${JSON.stringify(label)},
  rowKeys: [...document.querySelectorAll('[data-row-key]')].map((el) => el.getAttribute('data-row-key')).slice(0, 12),
  leadingSlots: document.querySelectorAll('[data-slot="sidebar.session.row.leading"]').length,
  badges: [...document.querySelectorAll('[data-slot="sidebar.session.row.leading"] span[title]')].map((el) => ({ t: el.textContent, title: el.getAttribute('title') })),
  text: (document.body.innerText || '').replace(/\\s+/g, ' ').slice(0, 220),
}))())`

const click = (selectorOrText) => `(() => {
  const all = [...document.querySelectorAll('button, [role="treeitem"], [data-row-key]')]
  const hit = all.find((el) => (el.getAttribute('aria-label') || el.innerText || '').trim() === ${JSON.stringify(selectorOrText)})
  if (hit) { hit.click(); return true }
  return false
})()`

const created = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })).json()
const cdp = await connect(created.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')

for (let i = 0; i < 90; i++) { if (await evaluate(cdp, 'document.readyState') === 'complete') break; await sleep(500) }
await sleep(6000)
console.log(JSON.stringify(await jsonEval(cdp, state('刚加载')), null, 2))

for (const step of ['继续', '稍后配置', '打开侧边栏']) {
  const ok = await evaluate(cdp, click(step))
  console.log(`click "${step}" -> ${ok}`)
  await sleep(2000)
}
console.log(JSON.stringify(await jsonEval(cdp, state('关掉引导 + 开侧栏')), null, 2))

// 展开工作区：点工作区行本身
const expanded = await evaluate(cdp, `(() => {
  const row = [...document.querySelectorAll('[data-row-key]')].find((el) => (el.getAttribute('data-row-key') || '').startsWith('workspace:'))
  if (!row) return 'no-workspace-row'
  row.click()
  return 'clicked ' + row.getAttribute('data-row-key')
})()`)
console.log('expand workspace ->', expanded)
await sleep(3000)
console.log(JSON.stringify(await jsonEval(cdp, state('展开工作区后')), null, 2))

await fetch(`http://127.0.0.1:${port}/json/close/${created.id}`)
cdp.close()
await sleep(400)
process.exit(0)
