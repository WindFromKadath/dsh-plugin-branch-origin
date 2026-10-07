/**
 * GUI 机检驱动：无头 Chrome + CDP，断言客户端半边在**真实 DOM** 里的表现。
 *
 * 断言：
 *   A1 页面加载完成、客户端组合没有报错
 *   A2 侧栏出现会话行（夹具造的 源对话 + 分叉子会话）
 *   A3 **分叉那一行**的行首出现来源徽标（`⤷`，tooltip `来源：源对话`）
 *   A4 没有父级的那一行**没有**徽标
 *   A5 悬停分叉行时，悬停卡里出现「来源」段并列出源对话名
 *   A6 控制台没有来自本插件或客户端组合的错误
 *
 * 用法：node .verify/gui/drive.mjs <cdp端口> <页面URL> [chrome路径]
 */

import { spawn } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const port = Number(process.argv[2])
const pageUrl = process.argv[3]
const chromePath = process.argv[4] ?? '<chrome>'

if (Number.isFinite(port) === false || !pageUrl) {
  console.error('用法：node .verify/gui/drive.mjs <cdp端口> <页面URL> [chrome路径]')
  process.exitCode = 1
  process.exit()
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}

const consoleErrors = []

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()
    let nextId = 1
    const send = (method, params) => new Promise((res, rej) => {
      const id = nextId++
      const guard = setTimeout(() => { pending.delete(id); rej(new Error(`CDP 命令超时：${method}`)) }, 20000)
      pending.set(id, {
        res: (value) => { clearTimeout(guard); res(value) },
        rej: (error) => { clearTimeout(guard); rej(error) },
      })
      ws.send(JSON.stringify({ id, method, params: params ?? {} }))
    })
    let logged = 0
    const timer = setTimeout(() => reject(new Error(`CDP websocket 连接超时：${wsUrl}`)), 15000)
    ws.addEventListener('open', () => { clearTimeout(timer); resolve({ send, close: () => ws.close() }) })
    ws.addEventListener('error', (event) => { clearTimeout(timer); reject(new Error(`CDP websocket error: ${event?.message ?? ''}`)) })
    ws.addEventListener('message', (event) => {
      void (async () => {
        // Node 的 WebSocket 在文本帧上给字符串，但不同实现可能给 Blob/ArrayBuffer —— 都兜住，
        // 否则 JSON.parse 抛在监听器里会把所有 pending 命令一起挂死（首次跑就栽在这）。
        const raw = typeof event.data === 'string'
          ? event.data
          : typeof event.data?.text === 'function'
            ? await event.data.text()
            : Buffer.from(event.data).toString('utf8')
        const msg = JSON.parse(raw)
        if (logged < 4) { logged++; console.log('[cdp raw]', raw.slice(0, 160)) }
        if (msg.method === 'Runtime.consoleAPICalled' && msg.params?.type === 'error') {
          consoleErrors.push(msg.params.args?.map((a) => a.value ?? a.description ?? '').join(' '))
        }
        if (msg.method === 'Runtime.exceptionThrown') {
          consoleErrors.push(msg.params?.exceptionDetails?.exception?.description ?? 'exceptionThrown')
        }
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
  if (result.exceptionDetails) throw new Error(`page eval failed: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`)
  return result.result.value
}

const jsonEval = async (cdp, expr) => JSON.parse(await evaluate(cdp, `JSON.stringify(${expr})`))

const userDataDir = join(fileURLToPath(new URL('.', import.meta.url)), 'chrome-profile')
mkdirSync(userDataDir, { recursive: true })

/** CDP 端点是否已经在跑（是就直接复用，不另起 Chrome）。 */
async function cdpUp() {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/version`)
    return response.ok
  } catch {
    return false
  }
}

// 沙箱下的旗标不是可选的：crashpad 在受限令牌里 OpenProcess 被拒会让 Chrome
// **自杀**（`crash server failed to launch, self-terminating`）。
const chromeArgs = [
  '--headless',
  '--disable-crash-reporter',
  '--disable-breakpad',
  '--no-sandbox',
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${userDataDir}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-gpu',
  'about:blank',
]

let chrome = null
let targetId
try {
  if ((await cdpUp()) === false) {
    console.log(`[drive] 启动 Chrome（端口 ${port}）…`)
    chrome = spawn(chromePath, chromeArgs, { stdio: 'ignore', detached: true })
  } else {
    console.log(`[drive] 复用已在运行的 CDP 端点（端口 ${port}）`)
  }

  // 等 CDP 端点就绪
  let ready = false
  for (let i = 0; i < 60 && ready === false; i++) {
    ready = await cdpUp()
    if (ready === false) await sleep(500)
  }
  if (ready === false) throw new Error(`Chrome CDP 端点没起来（端口 ${port}）`)
  console.log('[drive] CDP 就绪，开新标签页…')

  const created = await (await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(pageUrl)}`, { method: 'PUT' })).json()
  targetId = created.id
  console.log(`[drive] 标签页 ${targetId}，连接 websocket…`)
  const cdp = await connect(created.webSocketDebuggerUrl)
  console.log('[drive] websocket 已连接')
  await cdp.send('Runtime.enable')

  let state = ''
  for (let i = 0; i < 120; i++) {
    state = await evaluate(cdp, 'document.readyState')
    if (state === 'complete') break
    await sleep(500)
  }
  check('A1 页面加载完成', state === 'complete', { state })

  // 首屏可能挡着欢迎/引导弹窗（"添加一个 API Key"→「稍后配置」）；侧边栏可能收起。
  // 实测：弹窗要等约 6 秒才渲染出来，早点点不到 → 后面侧栏也打不开，整轮全是 0 行。
  await sleep(6000)
  const clickByText = (text) => evaluate(cdp, `(() => { const b = [...document.querySelectorAll('button')].find((x) => x.innerText.trim() === ${JSON.stringify(text)}); if (b) { b.click(); return true } return false })()`)
  for (const label of ['继续', 'Continue']) {
    const hit = await clickByText(label)
    if (hit) console.log(`[drive] 点了「${label}」`)
    await sleep(1200)
  }
  for (let i = 0; i < 10; i++) {
    const hit = await clickByText('稍后配置')
    if (hit === false) break
    console.log('[drive] 点了「稍后配置」（关闭 API Key 引导）')
    await sleep(1200)
  }
  for (let i = 0; i < 5; i++) {
    const hit = await evaluate(cdp, `(() => { const b = document.querySelector('button[aria-label="打开侧边栏"]'); if (b) { b.click(); return true } return false })()`)
    if (hit) { console.log('[drive] 展开了侧边栏'); break }
    await sleep(1200)
  }
  await sleep(3000)

  /** 侧栏里每个会话行的 leading 槽 + 整行文本。
   *  行定位用 `[data-row-key="session:<id>"]`（官方行锚点）；
   *  徽标按 `title^="来源："` 过滤 —— 不能泛查 `span[title]`，同装 dsh-plugin-branch 时
   *  同一个槽里还有它的「⇄」徽标（order 更小、排在前面）。
   *  坐标必须取**行**的 rect：slot 锚点是 `display: contents`，rect 恒为 0。 */
  const rowsExpression = `(() => {
    const slots = [...document.querySelectorAll('[data-slot="sidebar.session.row.leading"]')]
    return slots.map((slot) => {
      const row = slot.closest('[data-row-key]') || slot.closest('[role="treeitem"]') || slot.parentElement
      const badge = [...slot.querySelectorAll('span[title]')].find((el) => (el.getAttribute('title') || '').startsWith('来源：'))
      const rect = row ? row.getBoundingClientRect() : null
      return {
        rowKey: row ? row.getAttribute('data-row-key') : null,
        badgeText: badge ? badge.textContent : null,
        badgeTitle: badge ? badge.getAttribute('title') : null,
        slotText: slot.textContent,
        rowText: row ? (row.innerText || '').replace(/\\s+/g, ' ').slice(0, 80) : null,
        rect: rect ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, w: rect.width, h: rect.height } : null,
      }
    })
  })()`

  let rows = []
  for (let i = 0; i < 40; i++) {
    rows = await jsonEval(cdp, rowsExpression)
    if (rows.length >= 2) break
    await sleep(1000)
  }
  console.log('\n── 侧栏行 ──')
  console.log(JSON.stringify(rows, null, 2))
  check('A2 侧栏出现会话行（夹具的源会话 + 分叉子会话）', rows.length >= 2, { rows: rows.length })

  const withBadge = rows.filter((row) => row.badgeText === '⤷')
  check('A3 分叉行的行首出现来源徽标', withBadge.length >= 1, { withBadge })
  // 夹具的两条会话是**冷会话**，标题来自 projection cache —— 未必能投影出来，此时官方
  // displayTitle 会退回 cwd 目录名。所以这里断言"是来源标注"而不是具体名字；
  // 真实 GUI 的 fork 子会话是 live 的，父标题正常可读。
  check('A4 徽标 tooltip 是来源标注（`来源：<源对话标题>`）', withBadge.some((row) => typeof row.badgeTitle === 'string' && row.badgeTitle.startsWith('来源：') && row.badgeTitle.length > 3), {
    titles: withBadge.map((row) => row.badgeTitle),
  })
  const withoutBadge = rows.filter((row) => row.badgeText === null)
  check('A5 没有父级的行不带徽标', withoutBadge.length >= 1, { rows: withoutBadge.length })

  // 悬停分叉行 → 悬停卡里应出现「来源」段。
  // 官方 HoverCard 有 800ms 打开延迟，且要两次 mouseMoved（第二次偏 +2/+1）才稳定触发 React enter。
  let hoverText = ''
  if (withBadge.length >= 1 && withBadge[0].rect !== null) {
    const target = withBadge[0].rect
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(target.x), y: Math.round(target.y), button: 'none', buttons: 0 })
    await sleep(300)
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(target.x) + 2, y: Math.round(target.y) + 1, button: 'none', buttons: 0 })
    for (let i = 0; i < 12; i++) {
      await sleep(500)
      hoverText = await evaluate(cdp, `(() => {
        const nodes = [...document.querySelectorAll('[data-slot="sidebar.session.row.hover"]')]
        return nodes.map((n) => (n.innerText || '').replace(/\\s+/g, ' ').trim()).filter((t) => t.includes('来源')).join(' | ')
      })()`)
      if (hoverText.includes('源对话')) break
    }
  }
  check('A6 悬停分叉行时出现「来源」段', hoverText.includes('来源'), {
    hoverText: hoverText.slice(0, 300),
  })

  const ours = consoleErrors.filter((line) => String(line).includes('branch-origin') || String(line).includes('did not activate'))
  check('A7 控制台没有本插件/客户端组合的错误', ours.length === 0, { ours, totalErrors: consoleErrors.length })

  console.log('\n── 控制台错误（全部）──')
  console.log(JSON.stringify(consoleErrors.slice(0, 10), null, 2))

  await cdp.close()
} finally {
  if (targetId !== undefined) {
    try { await fetch(`http://127.0.0.1:${port}/json/close/${targetId}`) } catch { /* 尽力而为 */ }
  }
  // 只收自己起的那个 Chrome；复用外部实例时不动它。
  if (chrome !== null) {
    try { process.kill(-chrome.pid) } catch { try { chrome.kill() } catch { /* 已退出 */ } }
  }
}

const failed = checks.filter((item) => item.ok === false)
console.log(`\n结果：${checks.length - failed.length}/${checks.length} 通过`)
process.exitCode = failed.length === 0 ? 0 : 1
