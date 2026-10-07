/**
 * 真机测试：在本仓库内的临时 DSH_HOME 里启动**真的** DSH 运行时
 * （真 Loader / 真 SessionStore / 真 session 持久化 / 真 session-title 服务），
 * 然后跑「分支联系」的完整场景：
 *
 *   1. 建一个真源会话，把它的标题设成「修 GUI 卡顿」
 *   2. 真 fork 出子会话（`ctx.sessions.fork` —— 官方 store 级 fork，会写
 *      `header.parentSession` 并触发 `session/created`）
 *   → 断言：插件在某时刻自动把子标题改成「⤷ 来源：修 GUI 卡顿」
 *   3. 模拟官方 fork 的第二步（客户端把子标题改成「修 GUI 卡顿 (1)」）
 *   → 断言：插件收敛成「⤷ 来源：修 GUI 卡顿 (1)」，且**只多写一次**
 *   4. 反例：普通新会话、子智能体会话（`origin: 'subagent'`）都不动
 *   5. 反例：用户在窗口内改名 → 插件放过（不抢）
 *   6. 地面真值：从**磁盘上的会话日志**里读出最后一条 `session/title`
 *
 * 全程不碰用户的 `~/.dsh`：DSH_HOME 指向 `.verify/home`。
 * 故意**不**挂 `dsh-api-session-controller`（它只在 web-app bundle 里）：
 * 本插件的主路径正是"没有 controller 也能标注"。
 *
 * 用法：npm run rm-test   （= node --import ./test/register.mjs .verify/real-machine.mjs）
 */

import { mkdir, rm, stat, symlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const home = join(root, '.verify', 'home')
const configPath = join(root, '.verify', 'rm', 'cordis.yml')
const childWorkDir = join(root, '.verify', 'proj')

const MARK = '⤷ 来源：'
const SOURCE_TITLE = '修 GUI 卡顿'

/** 插件默认 settleMs / graceMs：留出余量。 */
const SETTLE_WAIT_MS = 1500
const CONVERGE_WAIT_MS = 400

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const checks = []
function check(name, ok, detail) {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

process.env.DSH_HOME = home
process.env.DSH_PROFILE_DIR ??= join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop')

// 自链接：Loader 需要按**包名**解析到本仓库。目标在工作区内，沙箱允许。
const selfLink = join(root, 'node_modules', 'dsh-plugin-branch-origin')
if ((await exists(selfLink)) === false) {
  await mkdir(dirname(selfLink), { recursive: true })
  await symlink(root, selfLink, 'junction')
}

await rm(home, { recursive: true, force: true })
await rm(childWorkDir, { recursive: true, force: true })
await mkdir(home, { recursive: true })
await mkdir(childWorkDir, { recursive: true })

const { boot } = await import('@deepseek-ai/dsh-app-boot')
const ctx = await boot('dsh-branch-origin-rm', configPath, [], undefined, pathToFileURL(join(root, 'package.json')).href)

const sessions = ctx.get('sessions')
const sessionTitle = ctx.get('sessionTitle')
const persistence = ctx.get('sessionPersistence')

/** 记录 `session/created` 是否真的会为 fork 发出来（区分"插件没装上"与"逻辑错"）。 */
const createdEvents = []
ctx.on('session/created', (session) => {
  createdEvents.push({ id: session.id, parent: session.header?.parentSession, origin: session.header?.origin })
}, { global: true })

check('真机装载：sessions 服务存在', sessions !== undefined)
check('真机装载：sessionTitle 服务存在', sessionTitle !== undefined)
check('真机装载：sessionPersistence 服务存在', persistence !== undefined)

try {
  // ── 阶段 1：源会话 + 标题 ────────────────────────────────────────
  const parentId = `session-${randomUUID()}`
  const parent = sessions.create(parentId, { meta: { cwd: childWorkDir, isSeeded: false } })
  sessionTitle.rename(parent, SOURCE_TITLE)
  check('场景：源会话标题已钉住', sessionTitle.get(parent)?.title === SOURCE_TITLE, {
    title: sessionTitle.get(parent)?.title,
  })

  // ── 阶段 2：真 fork → 插件应自动贴上来源标签 ──────────────────────
  const childId = `session-${randomUUID()}`
  const child = sessions.fork(parent, undefined, childId)
  check('场景：真 fork 建立了父子链（header.parentSession）', child.header.parentSession === parentId, {
    childId,
    parentSession: child.header.parentSession,
  })
  check('事件面：fork 触发了 session/created', createdEvents.some((item) => item.id === childId), {
    createdEvents,
  })

  await sleep(SETTLE_WAIT_MS)
  const labelled = sessionTitle.get(child)?.title
  check('自动化：fork 子会话被贴上来源标签', labelled === `${MARK}${SOURCE_TITLE}`, { labelled })

  // ── 阶段 3：官方 fork 的第二步改名 → 插件收敛 ────────────────────
  sessionTitle.rename(child, `${SOURCE_TITLE} (1)`)
  await sleep(CONVERGE_WAIT_MS)
  const converged = sessionTitle.get(child)?.title
  check('收敛：官方 (1) 改名被改写成带来源的标题', converged === `${MARK}${SOURCE_TITLE} (1)`, { converged })

  // ── 阶段 4：反例 ────────────────────────────────────────────────
  const rootId = `session-${randomUUID()}`
  const rootSession = sessions.create(rootId, { meta: { cwd: childWorkDir, isSeeded: false } })
  sessionTitle.rename(rootSession, '全新的对话')
  await sleep(CONVERGE_WAIT_MS)
  check('反例：没有父级的普通会话不被标注', sessionTitle.get(rootSession)?.title === '全新的对话')

  const subagentId = `session-${randomUUID()}`
  const subagent = sessions.create(subagentId, {
    // isSeeded 的会话必须显式给 seed 与 inheritedEventCount
    // （dsh-session/lib/index.js:1340-1341）。
    seed: [],
    inheritedEventCount: 0,
    meta: { cwd: childWorkDir, isSeeded: true, parentSession: parentId, origin: 'subagent' },
  })
  sessionTitle.rename(subagent, SOURCE_TITLE)
  await sleep(CONVERGE_WAIT_MS)
  check('反例：子智能体会话（origin=subagent）不被标注', sessionTitle.get(subagent)?.title === SOURCE_TITLE, {
    title: sessionTitle.get(subagent)?.title,
  })

  // ── 阶段 5：用户在窗口内改名 → 插件放过 ──────────────────────────
  const secondChildId = `session-${randomUUID()}`
  const secondChild = sessions.fork(parent, undefined, secondChildId)
  await sleep(SETTLE_WAIT_MS)
  const secondLabelled = sessionTitle.get(secondChild)?.title
  check('第二个分叉也被标注', secondLabelled === `${MARK}${SOURCE_TITLE}`, { secondLabelled })

  sessionTitle.rename(secondChild, '我的实验')
  await sleep(CONVERGE_WAIT_MS)
  check('反例：用户改名后插件不再抢回', sessionTitle.get(secondChild)?.title === '我的实验', {
    title: sessionTitle.get(secondChild)?.title,
  })

  // ── 阶段 6：地面真值（官方 sessionQuery 的独立读取通道）─────────
  //
  // 说明：这条最小组合里没有 agent loop，所以没有任何东西会给会话开写入句柄，
  // 会话日志不会物化到磁盘（`dsh-plugin-branch` 的 V13 已记录同一事实）。
  // 于是这里用**另一个官方服务**去读同一条日志 —— 走的是 dsh-session-query，
  // 而不是插件自己调用的 sessionTitle，用来排除"只是服务侧缓存对上了"。
  const query = ctx.get('sessionQuery')
  check('地面真值：sessionQuery 服务存在', query !== undefined)
  let viaQuery
  try {
    viaQuery = await query.readTitle(childId)
  } catch (error) {
    viaQuery = { error: String(error?.message ?? error) }
  }
  check(
    '地面真值：另一条官方读取通道（sessionQuery）读到同一条带来源的标题',
    viaQuery?.title === `${MARK}${SOURCE_TITLE} (1)`,
    { viaQuery: viaQuery?.title ?? viaQuery },
  )

  console.log('\n── 事件面（session/created）──')
  console.log(JSON.stringify(createdEvents, null, 2))
} finally {
  await ctx.fiber.dispose()
}

const failed = checks.filter((item) => item.ok === false)
console.log(`\n结果：${checks.length - failed.length}/${checks.length} 通过`)
process.exitCode = failed.length === 0 ? 0 : 1
