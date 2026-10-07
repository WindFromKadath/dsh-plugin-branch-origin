/**
 * dsh-plugin-branch-origin — 行为断言。
 *
 * 本插件零依赖（不 import 任何宿主包），所以测试**不需要** `@deepseek-ai/*`
 * 解析钩子：直接给 `apply()` 一个桩 ctx 即可。桩 ctx 只实现本插件真正用到的
 * 那一小片宿主契约：`ctx.on(event, handler, {global})`、`ctx.get(service)`、
 * `ctx.effect(setup, label)`，以及 `sessions` / `sessionTitle` 两个服务。
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { MARK, apply, baseOf, desiredTitle, splitCounter } from '../lib/index.js'

/** 让排队的标注任务跑完。 */
const settle = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 搭一个假宿主。
 * @param options - `settleMs` / `graceMs` / `labelSubagents` / `controller` / `coldTitleService`。
 * @returns 桩上下文与观察点。
 */
function createHarness(options = {}) {
  const { settleMs = 0, graceMs = 50, labelSubagents = false, controller, coldTitleService = false } = options
  const handlers = new Map()
  const live = new Map()
  const titles = new Map()
  const writes = []

  const emit = (event, ...args) => {
    for (const handler of handlers.get(event) ?? []) handler(...args)
  }

  const sessions = { get: (id) => live.get(id) }

  const sessionTitle = {
    get: (session) => {
      const title = titles.get(session.id)
      if (title === undefined) return undefined
      return { title, messageSeqs: [], source: { kind: 'user' }, eventSeq: 1, updatedAt: Date.now() }
    },
    rename: (session, title) => {
      if (coldTitleService) throw new Error('session is not live')
      titles.set(session.id, title)
      writes.push({ sessionId: session.id, title, via: 'sessionTitle' })
      // 宿主写标题会追加一条 session/title 事件 —— 这里如实回放，用来验证收敛不炸环。
      emit('session/event', session, {
        type: 'session/title',
        seq: 1,
        data: { title, messageSeqs: [], source: { kind: 'user' } },
      })
      return { title, eventSeq: 1, updatedAt: Date.now(), messageSeqs: [], source: { kind: 'user' } }
    },
  }

  const ctx = {
    logger: { warn() {} },
    on(event, handler) {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
      return () => {}
    },
    get(name) {
      if (name === 'sessions') return sessions
      if (name === 'sessionTitle') return sessionTitle
      if (name === 'sessionController') return controller
      return undefined
    },
    effect(callback) {
      return callback()
    },
  }

  apply(ctx, { settleMs, graceMs, labelSubagents })

  return { live, titles, writes, emit }
}

/**
 * 造一个会话并发出 `session/created`。
 * @param harness - `createHarness()` 的返回值。
 * @param id - 新会话 id。
 * @param header - 会话头；父级用 `parentSession`。
 * @param title - 该会话当前的标题。
 * @returns 会话对象。
 */
function createSession(harness, id, header, title) {
  const session = { id, header: { id, isSeeded: false, ...header } }
  harness.live.set(id, session)
  if (title !== undefined) harness.titles.set(id, title)
  harness.emit('session/created', session)
  return session
}

/** 造一个标题为 `title` 的源会话（父级）。 */
function createParent(harness, id, title) {
  const session = { id, header: { id, isSeeded: false } }
  harness.live.set(id, session)
  harness.titles.set(id, title)
  return session
}

test('splitCounter 认识半角与全角编号，并把尾随空白剥掉', () => {
  assert.deepEqual(splitCounter('修 GUI 卡顿 (1)'), { base: '修 GUI 卡顿', digits: '1' })
  assert.deepEqual(splitCounter('修 GUI 卡顿（12）'), { base: '修 GUI 卡顿', digits: '12' })
  assert.equal(splitCounter('修 GUI 卡顿'), undefined)
  assert.equal(splitCounter('v2 (最终)'), undefined)
})

test('baseOf 抹掉尾编号', () => {
  assert.equal(baseOf('修 GUI 卡顿 (3)'), '修 GUI 卡顿')
  assert.equal(baseOf('修 GUI 卡顿'), '修 GUI 卡顿')
})

test('desiredTitle 只在标题仍是继承形态时给结果', () => {
  // 原样继承
  assert.equal(desiredTitle('修 GUI 卡顿', '修 GUI 卡顿'), `${MARK}修 GUI 卡顿`)
  // 官方增号：序号原样保留，于是同一源的多个分叉仍可分
  assert.equal(desiredTitle('修 GUI 卡顿', '修 GUI 卡顿 (1)'), `${MARK}修 GUI 卡顿 (1)`)
  assert.equal(desiredTitle('修 GUI 卡顿', '修 GUI 卡顿（2）'), `${MARK}修 GUI 卡顿（2）`)
  // 源本身已是 fork：官方会把尾号 +1，家族名相同，仍算继承形态
  assert.equal(desiredTitle('修 GUI 卡顿 (1)', '修 GUI 卡顿 (2)'), `${MARK}修 GUI 卡顿 (2)`)
  // 已经标过的标题不再动手（幂等）
  assert.equal(desiredTitle('修 GUI 卡顿', `${MARK}修 GUI 卡顿`), undefined)
  // 别人或用户已经命名过 —— 放过
  assert.equal(desiredTitle('修 GUI 卡顿', '⑂1 修 GUI 卡顿'), undefined)
  assert.equal(desiredTitle('修 GUI 卡顿', '我的实验'), undefined)
  assert.equal(desiredTitle('修 GUI 卡顿', ''), undefined)
})

test('新建 fork 会带上来源标签', async () => {
  const harness = createHarness()
  createParent(harness, 's-parent', '修 GUI 卡顿')
  createSession(harness, 's-child', { parentSession: 's-parent', isSeeded: true }, '修 GUI 卡顿')

  await settle()

  assert.equal(harness.titles.get('s-child'), `${MARK}修 GUI 卡顿`)
  assert.equal(harness.writes.length, 1)
  assert.equal(harness.writes[0].via, 'sessionTitle')
})

test('官方随后的 (1) 改名会被收敛，且只再写一次', async () => {
  const harness = createHarness()

  createParent(harness, 's-parent', '修 GUI 卡顿')
  const child = createSession(harness, 's-child', { parentSession: 's-parent', isSeeded: true }, '修 GUI 卡顿')

  // 官方 fork 的第二步：把子标题改成 <源标题> (1)
  harness.titles.set('s-child', '修 GUI 卡顿 (1)')
  harness.emit('session/event', child, {
    type: 'session/title',
    seq: 2,
    data: { title: '修 GUI 卡顿 (1)', messageSeqs: [], source: { kind: 'user' } },
  })

  await settle()

  assert.equal(harness.titles.get('s-child'), `${MARK}修 GUI 卡顿 (1)`)
  // 写入引发的自回放不能再触发第二次写入
  assert.ok(harness.writes.length <= 2, `writes=${JSON.stringify(harness.writes)}`)
  assert.equal(harness.writes.at(-1).title, `${MARK}修 GUI 卡顿 (1)`)
})

test('已经标好的标题不再重复写', async () => {
  const harness = createHarness()
  createParent(harness, 's-parent', '修 GUI 卡顿')
  createSession(harness, 's-child', { parentSession: 's-parent', isSeeded: true }, `${MARK}修 GUI 卡顿`)

  await settle()

  assert.equal(harness.writes.length, 0)
})

test('子智能体会话不标注（origin=subagent）', async () => {
  const harness = createHarness()
  createParent(harness, 's-parent', '修 GUI 卡顿')
  createSession(
    harness,
    's-sub',
    { parentSession: 's-parent', isSeeded: true, origin: 'subagent' },
    '修 GUI 卡顿',
  )

  await settle()

  assert.equal(harness.titles.get('s-sub'), '修 GUI 卡顿')
  assert.equal(harness.writes.length, 0)
})

test('labelSubagents 打开时才标注子智能体会话', async () => {
  const harness = createHarness({ labelSubagents: true })
  createParent(harness, 's-parent', '修 GUI 卡顿')
  createSession(
    harness,
    's-sub',
    { parentSession: 's-parent', isSeeded: true, origin: 'subagent' },
    '修 GUI 卡顿',
  )

  await settle()

  assert.equal(harness.titles.get('s-sub'), `${MARK}修 GUI 卡顿`)
})

test('没有父级的普通会话一律不动', async () => {
  const harness = createHarness()
  createSession(harness, 's-root', {}, '全新的对话')

  await settle()

  assert.equal(harness.titles.get('s-root'), '全新的对话')
  assert.equal(harness.writes.length, 0)
})

test('在标注窗口内被用户/别的插件改过名的 fork 会被放过', async () => {
  const harness = createHarness()

  createParent(harness, 's-parent', '修 GUI 卡顿')
  const child = createSession(harness, 's-child', { parentSession: 's-parent', isSeeded: true }, '修 GUI 卡顿')

  // 另一个谱系插件（如 autofork）抢先钉了标题
  harness.titles.set('s-child', '⑂1 修 GUI 卡顿')
  harness.emit('session/event', child, {
    type: 'session/title',
    seq: 2,
    data: { title: '⑂1 修 GUI 卡顿', messageSeqs: [], source: { kind: 'user' } },
  })

  await settle()

  assert.equal(harness.titles.get('s-child'), '⑂1 修 GUI 卡顿')
  assert.equal(harness.writes.length, 0)
})

test('源会话没有标题时不动手', async () => {
  const harness = createHarness()
  createParent(harness, 's-parent', undefined)
  createSession(harness, 's-child', { parentSession: 's-parent', isSeeded: true }, undefined)

  await settle()

  assert.equal(harness.titles.has('s-child'), false)
  assert.equal(harness.writes.length, 0)
})

test('sessionTitle 拒绝非 live 会话时退到 sessionController', async () => {
  const renamed = []
  const controller = {
    rename: async (request) => {
      renamed.push(request)
      return { title: request.title, seq: 1 }
    },
  }
  const harness = createHarness({ controller, coldTitleService: true })

  createParent(harness, 's-parent', '修 GUI 卡顿')
  createSession(harness, 's-child', { parentSession: 's-parent', isSeeded: true }, '修 GUI 卡顿')

  await settle()

  assert.deepEqual(renamed, [{ sessionId: 's-child', title: `${MARK}修 GUI 卡顿` }])
})

test('标注窗口过期后不再纠缠（graceMs 很短）', async () => {
  const harness = createHarness({ graceMs: 0 })

  createParent(harness, 's-parent', '修 GUI 卡顿')
  const child = createSession(harness, 's-child', { parentSession: 's-parent', isSeeded: true }, '修 GUI 卡顿')

  await settle()
  const writesAfterSettle = harness.writes.length

  // 窗口已过：用户此刻改名不该被我们覆盖
  harness.titles.set('s-child', '我自己起的名字')
  harness.emit('session/event', child, {
    type: 'session/title',
    seq: 3,
    data: { title: '我自己起的名字', messageSeqs: [], source: { kind: 'user' } },
  })

  await settle()

  assert.equal(harness.titles.get('s-child'), '我自己起的名字')
  assert.equal(harness.writes.length, writesAfterSettle)
})
