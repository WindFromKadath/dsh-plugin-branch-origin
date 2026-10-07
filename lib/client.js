/**
 * dsh-plugin-branch-origin — 客户端半边（浏览器 classic script）。
 *
 * 只做一件事：在官方**侧栏会话行**上把「这个会话是从哪个对话分出来的」显示出来。
 * 它与宿主半边是**两条独立通道**：
 *
 *   - 宿主半边把来源写进**标题**（`⤷ 来源：<源标题>`）——用户一改名就没了；
 *   - 这里从官方列表行的**父级字段**读出关系，渲染成徽标与悬停文案 ——
 *   **改名碰不到它**（D009：这正是加这一半的理由）。
 *
 * 只读：不写任何会话、不注册模型可见工具、不占 `single` 占位、不接管官方行。
 * 全部数据都来自官方客户端列表快照，零新增远程接口。
 *
 * 协议与约定（照抄工作区内已验证的 `dsh-plugin-branch\lib\client.js`）：
 *   - `window.__ModuleLoader__.load({ id: '<包名逐字>', factory(require) { … } })`，
 *     factory 末尾 `exports.apply` / `exports.inject` 并 `return module.exports`；
 *   - 平台基座只允许 9 个键，本插件只用 `react` 与 `react/jsx-runtime`；
 *   - 行对象的会话 id 字段是 **`id`**，父级字段是 **`parentId`**
 *     （宿主摘要里的 `sessionId` / `parentSessionId` 在客户端被映射掉了；用错字段会静默取到
 *     `undefined`）——两个键都认，宿主摘要原样透传时也能工作；
 *   - 客户端组合是**全有或全无**：激活期抛错可能拖垮整个 GUI 客户端，
 *     所以 `apply` 外层包 try/catch（见文件末尾）。
 *
 * 数据来源：官方 `useSessions` root hook（slot 框架注入到 props），
 * 缺失时退到本插件用官方 `sessions.list` store 自建的 hook。
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-branch-origin',
  factory(require) {
    var module = { exports: {} }
    var exports = module.exports

    var React = require('react')
    var runtime = require('react/jsx-runtime')

    var jsx = runtime.jsx
    var jsxs = runtime.jsxs

    /** 行内徽标用的字形：与宿主半边写在标题里的同一个符号。 */
    var MARK = '⤷'
    /** 悬停段的标题。 */
    var HINT = '来源'

    var STYLE = {
      /** 行内徽标：与官方行内元素同尺度，无色（继承行颜色），只占一个字宽。 */
      badge: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
        minWidth: '14px',
        padding: '0 2px',
        borderRadius: 'var(--dsw-radius-xs)',
        fontFamily: 'var(--dsw-font-family)',
        fontSize: '11px',
        lineHeight: '16px',
        color: 'inherit',
        opacity: 0.75,
        cursor: 'default',
      },
      hoverBox: {
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        maxWidth: '320px',
        fontFamily: 'var(--dsw-font-family)',
      },
      /**
       * ⚠️ 卡片里的颜色是**写死的**，不是主题 token —— 官方悬停卡就是这么干的。
       *
       * 悬停卡是深色「菜单材质」，它自己的 CSS module 把文字颜色写死：
       * `.hoverTitle{color:#fff}` / `.hoverTime{color:#cfd3d6}` / `.hoverStatus{color:#adb2b8}`
       * （`dsh-client-ui-workspace` 的 `Rows.module.css`，类名 `YDXeBa_hover*`）。
       *
       * 反过来，这里若用 `var(--dsw-alias-label-primary)` 这类主题 token，卡片那个作用域会把它
       * 解析成**浅色主题的近黑值 `#0f1115`** —— 深色卡片（背景 `#2c2c2e`）上等于同色，
       * 字直接看不见（用户 2026-10-07 报的"字色有问题"就是这个）。`--dsw-alias-label-tertiary`
       * 是 `#81858c`，勉强可见但与卡片风格不一致。
       *
       * 结论：**卡片内一律用卡片自己的固定色**；卡片外（行内徽标）才用主题 token。
       */
      hoverTitle: {
        fontSize: '12px',
        lineHeight: '16px',
        fontWeight: 400,
        color: '#cfd3d6',
      },
      hoverRow: { display: 'flex', alignItems: 'center', gap: '6px', minHeight: '24px' },
      hoverGlyph: {
        flex: '0 0 auto',
        width: '14px',
        textAlign: 'center',
        fontSize: '12px',
        lineHeight: '20px',
        color: '#adb2b8',
      },
      hoverLabel: {
        flex: '1 1 auto',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: '14px',
        lineHeight: '20px',
        color: '#fff',
      },
    }

    /**
     * 取客户端行对象的会话 id。字段名是 `id`，不是宿主摘要里的 `sessionId`。
     * @param row - 客户端列表行。
     * @returns 会话 id（两个键都认）。
     */
    function rowIdOf(row) {
      return row.id !== undefined ? row.id : row.sessionId
    }

    /**
     * 取行对象的父级会话 id。字段名是 `parentId`，不是 `parentSessionId`。
     * @param row - 客户端列表行。
     * @returns 父级 id，或 undefined。
     */
    function parentIdOf(row) {
      return row.parentId !== undefined ? row.parentId : row.parentSessionId
    }

    /**
     * 取行的显示标题。
     * @param row - 客户端列表行。
     * @returns 标题字符串，或空串。
     */
    function titleOf(row) {
      if (!row) return ''
      var label = row.displayTitle !== undefined ? row.displayTitle : row.title
      return typeof label === 'string' ? label : ''
    }

    /**
     * 选择器：这一行所来自的对话叫什么。
     *
     * 返回**字符串或 null**（`useSyncExternalStore` 要求快照按值稳定 —— 字符串天然满足，
     * 所以不需要像"相连节点"那样做引用 memo）。
     *
     * 判据与宿主半边一致：有父级，且不是子智能体会话。
     * @param snapshot - `useSessions` 的快照（`{ byId, ids }`）。
     * @param sessionId - 当前行。
     * @returns 源对话标题，或 null（不该显示徽标）。
     */
    function selectSource(snapshot, sessionId) {
      var byId = snapshot && snapshot.byId
      if (!byId || sessionId === undefined) return null
      var row = byId[sessionId]
      if (!row) return null
      if (row.origin === 'subagent') return null
      var parentId = parentIdOf(row)
      if (parentId === undefined || parentId === null || parentId === '') return null
      var label = titleOf(byId[parentId])
      return label === '' ? '（未命名对话）' : label
    }

    /**
     * 把官方客户端 store 的快照面包装成 React Hook（`useSyncExternalStore`）。
     * store 不具备 subscribe/getSnapshot 时返回 null，组件自动降级缺席。
     * @param store - 形如 {getSnapshot, subscribe} 的 store。
     * @returns Hook 函数或 null。
     */
    function createStoreHook(store) {
      if (!store || typeof store.getSnapshot !== 'function' || typeof store.subscribe !== 'function') return null
      var subscribe = function (listener) { return store.subscribe(listener) }
      var getSnapshot = function () { return store.getSnapshot() }
      return function (selector) {
        var read = typeof selector === 'function' ? function () { return selector(getSnapshot()) } : getSnapshot
        return React.useSyncExternalStore(subscribe, read, read)
      }
    }

    /**
     * 取数据源 hook：优先官方 root 注入的 `useSessions`，退到自建 store hook。
     * @param props - slot 组件 props。
     * @returns Hook 函数，或 null（组件应直接缺席）。
     */
    function pickSessionsHook(props) {
      if (typeof props.useSessions === 'function') return props.useSessions
      if (typeof props.useSessionsStore === 'function') return props.useSessionsStore
      return null
    }

    /**
     * 行内徽标：只对"从别的对话分出来的会话"显示一个 `⤷`，原生 tooltip 给出源标题。
     * @param props - {sessionId, useSessions?|useSessionsStore?}。
     * @returns 元素或 null。
     */
    function OriginBadge(props) {
      var useSessions = pickSessionsHook(props)
      if (useSessions === null) return null
      var source = useSessions(function (snapshot) { return selectSource(snapshot, props.sessionId) })
      if (source === null) return null
      return jsx('span', {
        style: STYLE.badge,
        title: HINT + '：' + source,
        children: MARK,
      })
    }

    /**
     * 悬停段：显示这个会话是从哪个对话分出来的。
     * @param props - {sessionId, useSessions?|useSessionsStore?}。
     * @returns 区段元素或 null。
     */
    function OriginHover(props) {
      var useSessions = pickSessionsHook(props)
      if (useSessions === null) return null
      var source = useSessions(function (snapshot) { return selectSource(snapshot, props.sessionId) })
      if (source === null) return null
      return jsxs('div', {
        style: STYLE.hoverBox,
        children: [
          jsx('div', { style: STYLE.hoverTitle, children: HINT }),
          jsxs('div', {
            style: STYLE.hoverRow,
            children: [
              jsx('span', { style: STYLE.hoverGlyph, children: MARK }),
              jsx('span', { style: STYLE.hoverLabel, title: source, children: source }),
            ],
          }),
        ],
      })
    }

    var inject = ['slots', 'sessions']

    /**
     * 注册两个只读席位。不注册 locale 字典（文案是固定的中文，无切换需求）。
     * @param ctx - Cordis 客户端上下文。
     */
    function applyPlugin(ctx) {
      /** slot 拿不到 root 注入时的兜底数据源（官方客户端列表 store）。 */
      var useSessionsStore = createStoreHook(ctx.sessions && ctx.sessions.list)

      ctx.slots.inject('sidebar.session.row.leading', function () {
        return ctx.slots.register({
          name: 'sidebar.session.row.leading',
          id: 'branch.origin',
          order: 21,
          inject: function () {
            return { useSessionsStore: useSessionsStore }
          },
        }, OriginBadge)
      })

      ctx.slots.inject('sidebar.session.row.hover', function () {
        return ctx.slots.register({
          name: 'sidebar.session.row.hover',
          id: 'branch.origin',
          order: 40,
          inject: function () {
            return { useSessionsStore: useSessionsStore }
          },
        }, OriginHover)
      })
    }

    /**
     * 客户端半边的入口：把实际工作包在 try/catch 里。
     *
     * 理由：客户端组合是"全有或全无"——一个包在激活期抛错会进入
     * `ClientPackageCompositionError` 聚合，可能让**整个 GUI 客户端**起不来。
     * 我们宁可只让自己的界面点缺席，也不要拖垮用户的界面；错误照旧打到控制台。
     * @param ctx - Cordis 客户端上下文。
     */
    function apply(ctx) {
      try {
        applyPlugin(ctx)
      } catch (error) {
        try {
          console.error('[dsh-plugin-branch-origin] client half failed to apply; its UI seats are absent:', error)
        } catch (_) { /* 控制台都不可用时静默 */ }
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
