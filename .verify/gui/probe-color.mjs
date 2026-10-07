/**
 * 计算样式探针：把悬停卡里**我们那两行**与**官方文字**的颜色/字号逐个量出来，
 * 用来定位"字色不对"到底是我们的 token 没生效，还是官方对 slot 内容另有配色。
 *
 * 用法：node .verify/gui/probe-color.mjs <CDP端口> <页面URL>
 */

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

const created = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })).json()
const cdp = await connect(created.webSocketDebuggerUrl)
await cdp.send('Runtime.enable')

for (let i = 0; i < 90; i++) { if (await evaluate(cdp, 'document.readyState') === 'complete') break; await sleep(500) }
await sleep(6000)
const clickText = (text) => evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === ${JSON.stringify(text)}); if (b) { b.click(); return true } return false })()`)
for (const label of ['继续', '稍后配置']) { await clickText(label); await sleep(1500) }
await evaluate(cdp, `(() => { const b = document.querySelector('button[aria-label="打开侧边栏"]'); if (b) b.click(); return !!b })()`)
await sleep(3000)

// 找分叉行（有我们徽标的那一行）并悬停
const target = await jsonEval(cdp, `(() => {
  const slot = [...document.querySelectorAll('[data-slot="sidebar.session.row.leading"]')]
    .find((el) => [...el.querySelectorAll('span[title]')].some((s) => (s.getAttribute('title') || '').startsWith('来源：')))
  if (!slot) return null
  const row = slot.closest('[data-row-key]')
  const r = row.getBoundingClientRect()
  return { rowKey: row.getAttribute('data-row-key'), x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }
})()`)
if (target === null) { console.log('没找到分叉行'); process.exit(1) }
console.log('hover target =', JSON.stringify(target))

await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y, button: 'none', buttons: 0 })
await sleep(300)
await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x + 2, y: target.y + 1, button: 'none', buttons: 0 })
await sleep(2500)

const dumpExpression = `(() => {
  const describe = (el) => {
    const cs = getComputedStyle(el)
    return {
      tag: el.tagName.toLowerCase(),
      ownText: el.childElementCount === 0 ? (el.textContent || '').slice(0, 30) : null,
      color: cs.color,
      fontSize: cs.fontSize,
      opacity: cs.opacity,
      varPrimary: cs.getPropertyValue('--dsw-alias-label-primary').trim(),
      varTertiary: cs.getPropertyValue('--dsw-alias-label-tertiary').trim(),
    }
  }
  const walk = (el, depth) => ({ ...describe(el), children: depth > 4 ? [] : [...el.children].map((c) => walk(c, depth + 1)) })
  const hosts = [...document.querySelectorAll('[data-slot="sidebar.session.row.hover"]')]
  const card = hosts[0] ? hosts[0].closest('[data-menu-material]') : null
  return {
    dark: document.body.hasAttribute('data-ds-dark-theme'),
    cardMaterial: card ? getComputedStyle(card).backgroundColor : null,
    cardColor: card ? getComputedStyle(card).color : null,
    hostColor: hosts[0] ? getComputedStyle(hosts[0]).color : null,
    trees: hosts.map((host) => walk(host, 0)),
  }
})()`

const light = await jsonEval(cdp, dumpExpression)
console.log('══ 浅色主题 ══')
console.log(JSON.stringify(light, null, 2))

// 现场切到深色（与 dsh-client-ui-theme/lib/index.js:55 同一条机制），再量一次
await evaluate(cdp, `document.body.setAttribute('data-ds-dark-theme', '')`)
await sleep(1200)
const dark = await jsonEval(cdp, dumpExpression)
console.log('\n══ 深色主题 ══')
console.log(JSON.stringify(dark, null, 2))

await fetch(`http://127.0.0.1:${port}/json/close/${created.id}`)
cdp.close()
await sleep(400)
process.exit(0)
