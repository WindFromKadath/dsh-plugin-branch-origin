/**
 * 客户端半边离线冒烟：在 Node 里用桩 `__ModuleLoader__` 跑 `lib/client.js`，
 * 断言它只用平台基座允许的键、注册了哪两个席位，并**直接调用**两个组件验证行为。
 *
 * 不需要浏览器、不需要构建链、不需要 `@deepseek-ai/*` 解析钩子。
 *
 * 用法：npm run client-smoke
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** 平台基座允许的 9 个键；本插件只应使用其中两个。 */
const ALLOWED = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
])

const used = new Set()

/** 最小 React 桩：`useSyncExternalStore` 直接求值快照。 */
const reactStub = {
  useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(),
}

/** 最小 jsx-runtime 桩：产出可断言的普通对象。 */
const runtimeStub = {
  Fragment: 'Fragment',
  jsx: (type, props) => ({ type, props }),
  jsxs: (type, props) => ({ type, props }),
}

function requireStub(specifier) {
  used.add(specifier)
  if (ALLOWED.has(specifier) === false) throw new Error(`平台基座不允许的键：${specifier}`)
  if (specifier === 'react') return reactStub
  if (specifier === 'react/jsx-runtime') return runtimeStub
  throw new Error(`本插件的客户端半边不应 require：${specifier}`)
}

/** 递归取出元素树里的文本。 */
function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  return textOf(node.props && node.props.children)
}

// ── 1) 装载定义 ────────────────────────────────────────────────────
let definition = null
const sandbox = {
  console,
  window: {
    __ModuleLoader__: {
      load: (def) => { definition = def },
    },
  },
}
runInNewContext(source, sandbox)

assert.ok(definition !== null, '客户端半边应当调用 __ModuleLoader__.load')
assert.equal(definition.id, 'dsh-plugin-branch-origin', 'id 必须逐字等于包名')

const exported = definition.factory(requireStub)
assert.equal(typeof exported.apply, 'function', '必须导出 apply')
// 注意：`inject` 数组诞生在 vm 上下文里，原型与这边不同 —— 摊平到本 realm 再比较。
assert.deepEqual([...exported.inject], ['slots', 'sessions'], 'inject 只应声明用到的服务')
assert.deepEqual([...used].sort(), ['react', 'react/jsx-runtime'], '只应使用基座允许的两个键')

// ── 2) 注册 ────────────────────────────────────────────────────────
const registered = []
const fakeCtx = {
  sessions: { list: { getSnapshot: () => ({ byId: {}, ids: [] }), subscribe: () => () => {} } },
  slots: {
    inject: (name, factory) => { factory() },
    register: (def, Component) => {
      registered.push({ def, Component })
      return () => {}
    },
  },
}
exported.apply(fakeCtx)

assert.equal(registered.length, 2, '应当注册两个只读席位')
const leading = registered.find((item) => item.def.name === 'sidebar.session.row.leading')
const hover = registered.find((item) => item.def.name === 'sidebar.session.row.hover')
assert.ok(leading, '缺少 sidebar.session.row.leading 席位')
assert.ok(hover, '缺少 sidebar.session.row.hover 席位')
assert.equal(leading.def.id, 'branch.origin')
assert.equal(hover.def.id, 'branch.origin')
assert.equal(typeof leading.Component, 'function')
assert.equal(typeof hover.Component, 'function')

// ── 3) 组件行为 ────────────────────────────────────────────────────
const snapshot = {
  ids: ['root', 'child', 'grandchild', 'subagent'],
  byId: {
    root: { id: 'root', displayTitle: '源对话' },
    child: { id: 'child', parentId: 'root', displayTitle: '源对话 (1)' },
    grandchild: { id: 'grandchild', parentId: 'child', title: '源对话 (1) (1)' },
    subagent: { id: 'subagent', parentId: 'root', origin: 'subagent', displayTitle: '子智能体' },
    orphan: { id: 'orphan', parentId: 'missing', displayTitle: '孤儿子会话' },
  },
}
/** 模拟 slot 框架注入的官方 root hook。 */
const withHook = (sessionId) => ({ sessionId, useSessions: (selector) => selector(snapshot) })

const badge = leading.Component(withHook('child'))
assert.ok(badge !== null, 'fork 出来的会话应当有徽标')
assert.equal(textOf(badge), '⤷', '徽标字形')
assert.equal(badge.props.title, '来源：源对话', '徽标 tooltip 应给出源对话标题')

assert.equal(leading.Component(withHook('root')), null, '没有父级的会话不应有徽标')
assert.equal(leading.Component(withHook('subagent')), null, '子智能体会话不应有徽标')
assert.equal(leading.Component(withHook('missing')), null, '快照里没有的行不应崩')

const grandchildBadge = leading.Component(withHook('grandchild'))
assert.equal(grandchildBadge.props.title, '来源：源对话 (1)', '二级分叉应指向它的直接来源')

const orphanBadge = leading.Component(withHook('orphan'))
assert.equal(orphanBadge.props.title, '来源：（未命名对话）', '源行不在快照里时给出占位而不是崩溃')

const hoverEl = hover.Component(withHook('child'))
assert.ok(hoverEl !== null, 'fork 出来的会话应当有悬停段')
assert.equal(textOf(hoverEl), '来源⤷源对话', '悬停段应同时给出标题与源对话名')
assert.equal(hover.Component(withHook('root')), null, '没有父级的会话不应有悬停段')

// ── 4) 降级：两种数据源都缺席时不得抛错，只缺席 ──────────────────────
assert.equal(leading.Component({ sessionId: 'child' }), null, '没有数据源时应缺席而不是抛错')
assert.equal(hover.Component({ sessionId: 'child' }), null, '没有数据源时应缺席而不是抛错')

// ── 5) 激活期抛错被吞掉（保护整个客户端组合）────────────────────────
const logged = []
sandbox.console = { error: (...args) => { logged.push(args) } }
const brokenCtx = {
  sessions: undefined,
  get() { throw new Error('boom') },
  slots: { inject() { throw new Error('boom') } },
}
assert.doesNotThrow(() => exported.apply(brokenCtx), 'apply 必须吞掉激活期异常')
assert.equal(logged.length, 1, '异常应当被记录一条到控制台（便于定位），而不是静默吞掉')
assert.match(String(logged[0][0]), /client half failed to apply/, '控制台文案应说明是客户端半边缺席')

console.log('OK  客户端半边冒烟：协议、两个席位、来源判据、降级与异常保护')
