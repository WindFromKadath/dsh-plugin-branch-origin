/**
 * dsh-plugin-branch-origin — 分支联系。
 *
 * 给「从别的对话分叉出来的会话」标上来源：把它的标题改写成
 * `⤷ 来源：<源会话标题>`，于是侧栏那一行自己就说明了它是从哪个对话分离的。
 *
 * Host-side bundle. Zero dependencies, no model-facing tools, no build chain:
 * the whole plugin is this file plus one patch-layer row.
 *
 * 为什么需要插件（对着本机安装的 `@deepseek-ai/dsh-*` 0.2.0-rc.2 源码核过）：
 *
 *  - fork 确实建立了真实父子链：`SessionHeader.parentSession`
 *    （`dsh-session/lib/types/types.d.ts:71`），另有 `isSeeded`，以及**只有**
 *    子智能体会话才有的 `origin: 'subagent'`。
 *  - 侧栏已经按谱系缩进（`SessionListEntry.depth`，
 *    `dsh-api-session-controller/lib/types/client/sessions/lineage.d.ts:27`），
 *    官方 fork 菜单还会把子标题改成 `<源标题> (1)`
 *    （`increasedForkTitle`，`dsh-api-session-controller/lib/client.js:3066`）。
 *    **但这两者都没有说"来自哪个对话"** —— 这正是本插件补的那一格。
 *  - `session/created` 对**每一个**新会话都会发，包括官方 GUI 造的 fork
 *    （`dsh-session/lib/index.js:1782`），所以一个监听器覆盖所有 fork 入口。
 *    监听必须带 `{ global: true }`，否则会被 Cordis 的上下文过滤挡掉。
 *  - 官方那次 `(1)` 改名发生在 `session/created` **之后**（它是第二个 RPC），
 *    所以本插件同时盯 `session/event` 里的 `session/title` 做收敛。fork 的播种
 *    事件**不会**发布到 `session/event`（`dsh-session/lib/types/index.d.ts:126`），
 *    因此两个钩子缺一不可。
 *  - 写标题走 `ctx.sessionTitle.rename(session, title)`，落盘的是
 *    `source: { kind: 'user' }` 的 `session/title` 事件，会**钉住**标题。
 *    在这里安全：first-prompt 标题提供方本来就跳过带父级的会话
 *    （`dsh-session-title/lib/index.js:386`），fork 子会话不会因此丢掉自动命名。
 *
 * 纪律 —— **只标注，不接管**：只有当子会话标题仍然等于源标题、或等于源标题的
 * 官方编号形式时，我们才动它。标题一旦是别的样子，说明别的工具或用户已经命名过，
 * 我们原样放过（`desiredTitle` 返回 `undefined`）。
 *
 * @module dsh-plugin-branch-origin
 */

/** Every title this plugin writes carries this prefix. */
export const MARK = '⤷ 来源：'

/** 官方 fork 的编号后缀：`<基名> (3)` 或全角 `<基名>（3）`。 */
const COUNTER = /^(.*?)[(（](\d+)[)）]$/u

/**
 * 创建后等这么久再标注：让官方那次 `<源标题> (1)` 改名先落地，
 * 于是一次 fork 通常只产生**一次**标题写入，没有可见的闪变。
 */
export const DEFAULT_SETTLE_MS = 600

/** 创建后再盯这么久的标题写入，用来收敛迟到的官方改名。 */
export const DEFAULT_GRACE_MS = 4000

/**
 * 拆掉官方 fork 的尾编号。`<base> (1)` / `<base>（1）` 都认；base 去掉尾随空白，
 * 这样 `"X (1)"` 的 base 是 `"X"` 而不是 `"X "`（否则永远比不中源标题）。
 * @param title - 任意会话标题。
 * @returns `{ base, digits }`；没有编号时返回 `undefined`。
 */
export function splitCounter(title) {
  const match = COUNTER.exec(title)
  const rawBase = match?.[1]
  const digits = match?.[2]
  if (rawBase === undefined || digits === undefined) return undefined
  return { base: rawBase.replace(/\s+$/u, ''), digits }
}

/**
 * 抹掉官方编号后的"家族名"。
 * @param title - 任意会话标题。
 * @returns 去掉尾编号的标题。
 */
export function baseOf(title) {
  return splitCounter(title)?.base ?? title
}

/**
 * 算出分叉会话应当携带的标题。
 *
 * 规则只有一条：**子标题必须仍是源标题的机械派生形态**（原样继承，或官方那次
 * `<源标题> (N)` 增号）—— 即两者抹掉尾编号后同名。这时我们只在它前面贴上来源
 * 标记，官方序号原样保留，于是同一源会话的多个分叉在侧栏里仍然可分。
 *
 * 任何别的样子（用户改的名、别的谱系插件钉的 `⑂1 …`）都说明有人已经命名过，
 * 返回 `undefined` 放过它 —— 本插件"只标注，不接管"。
 *
 * @param parentTitle - 源会话的标题。
 * @param childTitle - 子会话当前标题。
 * @returns 标注后的标题；不该动手时返回 `undefined`。
 */
export function desiredTitle(parentTitle, childTitle) {
  if (typeof childTitle !== 'string' || childTitle === '') return undefined
  if (childTitle.startsWith(MARK)) return undefined
  if (baseOf(childTitle) !== baseOf(parentTitle)) return undefined
  return `${MARK}${childTitle}`
}

export const name = 'dsh-plugin-branch-origin'

/** 本 bundle 需要的服务；`sessionTitle` 自身依赖 `sessionProjections`。 */
export const inject = ['sessions', 'sessionTitle']

/**
 * 给此后创建的每一个分叉会话补上来源标签。
 * @param ctx - 宿主插件上下文。
 * @param config - 可选的 `{ settleMs, graceMs, labelSubagents }` 覆盖（patch 行不带配置）。
 */
export function apply(ctx, config = {}) {
  const settleMs = Number.isFinite(config?.settleMs) ? Math.max(0, config.settleMs) : DEFAULT_SETTLE_MS
  const graceMs = Number.isFinite(config?.graceMs) ? Math.max(0, config.graceMs) : DEFAULT_GRACE_MS
  const labelSubagents = config?.labelSubagents === true

  /** 本进程创建、且仍在标注窗口内的会话：sessionId -> 窗口截止时间。 */
  const watching = new Map()
  const timers = new Set()

  ctx.effect(() => () => {
    for (const timer of timers) clearTimeout(timer)
    timers.clear()
    watching.clear()
  }, 'branch-origin: pending label timers')

  const later = (run, delay) => {
    const timer = setTimeout(() => {
      timers.delete(timer)
      run()
    }, delay)
    if (typeof timer?.unref === 'function') timer.unref()
    timers.add(timer)
  }

  const warn = (message) => {
    const logger = ctx.logger
    if (typeof logger?.warn === 'function') logger.warn(`[branch-origin] ${message}`)
    else console.warn(`[branch-origin] ${message}`)
  }

  /** 判据：有父级，且不是子智能体会话。 */
  const isFork = (session) => {
    const header = session?.header
    if (header?.parentSession === undefined) return false
    if (!labelSubagents && header.origin === 'subagent') return false
    return true
  }

  /** 读一个会话的标题：先走 live 折叠，冷会话再退到 sessionQuery。 */
  const readTitle = async (sessionId) => {
    const live = ctx.get('sessions')?.get(sessionId)
    if (live !== undefined) {
      const snapshot = ctx.get('sessionTitle')?.get(live)
      if (snapshot?.title) return snapshot.title
    }
    const query = ctx.get('sessionQuery')
    if (typeof query?.readTitleSnapshots !== 'function') return undefined
    const results = await query.readTitleSnapshots([sessionId])
    const first = Array.isArray(results) ? results[0] : undefined
    if (first?.status !== 'fulfilled') return undefined
    return first.value?.title?.title
  }

  /** 写标题：live 会话走 sessionTitle；否则退到会自行 resume 的 sessionController。 */
  const writeTitle = async (session, title) => {
    const service = ctx.get('sessionTitle')
    if (service !== undefined) {
      try {
        service.rename(session, title)
        return 'sessionTitle'
      } catch {
        // 会话不是 live（或服务已释放）—— 退到官方 controller，它会先 resume。
      }
    }
    const controller = ctx.get('sessionController')
    if (typeof controller?.rename === 'function') {
      await controller.rename({ sessionId: session.id, title })
      return 'sessionController'
    }
    return undefined
  }

  const label = async (session) => {
    if (!isFork(session)) return
    if (!watching.has(session.id)) return
    try {
      const parentTitle = await readTitle(session.header.parentSession)
      if (typeof parentTitle !== 'string' || parentTitle === '') return
      const current = ctx.get('sessionTitle')?.get(session)?.title ?? ''
      const desired = desiredTitle(parentTitle, current)
      if (desired === undefined || desired === current) return
      const via = await writeTitle(session, desired)
      if (via === undefined) warn(`没有可用的标题写入通道，原样保留 "${current}"`)
    } catch (error) {
      warn(`标注 ${session.id} 失败：${error?.message ?? error}`)
    }
  }

  ctx.on(
    'session/created',
    (session) => {
      if (!isFork(session)) return
      watching.set(session.id, Date.now() + settleMs + graceMs)
      later(() => void label(session), settleMs)
      later(() => watching.delete(session.id), settleMs + graceMs)
    },
    { global: true },
  )

  ctx.on(
    'session/event',
    (session, event) => {
      if (event?.type !== 'session/title') return
      const deadline = watching.get(session.id)
      if (deadline === undefined) return
      if (deadline < Date.now()) {
        watching.delete(session.id)
        return
      }
      void label(session)
    },
    { global: true },
  )
}
