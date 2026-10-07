/**
 * 一次性 GUI 验证夹具（**不是发布物**）。
 *
 * 目的：在一个临时 DSH_HOME 的 web profile 里，造出「侧栏里一行有父级的会话」，
 * 好让客户端半边的来源徽标有东西可渲染。
 *
 * 两个关键事实决定了这里的写法：
 *   1. 官方列表 `sessionController.list()` 走 `sessionQuery.listSessions()` —— **只列已持久化的会话**
 *      （`dsh-api-session-controller/lib/index.js:1888-1906`）。所以必须落盘，光 `sessions.create` 不出现。
 *   2. 列表会把 **blank** 会话藏起来（`blank: metadata?.blank ?? session.seq === 0`，同文件 `:1878`），
 *      而冷会话走 `summarizeCold`（`:1907-1919`，`blank` 默认 false）⇒ 落盘即非 blank。
 *
 * 于是：用官方的 `sessionPersistence.create → append → flush → close` 事务写两个会话，
 * 子会话的 header 带 `parentSession`（官方 fork 写的就是这个字段），再挂进工作区注册表。
 *
 * @module branch-origin-gui-fixture
 */

export const name = 'branch-origin-gui-fixture'

/** `workspaceRegistry` 可选：只有 web-app 组合才有。 */
export const inject = ['sessionPersistence']

/**
 * 写两个落盘会话并挂工作区。延迟一会儿，等 app-boot 把组合跑完。
 * @param ctx - 宿主插件上下文。
 */
export function apply(ctx) {
  const dir = process.env.BRANCH_ORIGIN_FIXTURE_CWD ?? process.cwd()

  setTimeout(() => {
    void (async () => {
      try {
        const persistence = ctx.get('sessionPersistence')
        if (persistence === undefined) throw new Error('sessionPersistence service missing')

        const sourceId = 'session-fixture-source'
        const forkId = 'session-fixture-fork'

        /**
         * 落盘一个会话：header + 一条 `session/title`（`source.kind === 'user'` 要求 `messageSeqs` 为空）。
         * @param id - 会话 id。
         * @param extra - 追加进 header 的字段（子会话用 `parentSession`）。
         * @param title - 会话标题。
         */
        const persist = async (id, extra, title) => {
          const header = {
            version: 4,
            id,
            createdAt: Date.now(),
            cwd: dir,
            isSeeded: false,
            delegationDepth: 0,
            ...extra,
          }
          const handle = await persistence.create(header)
          try {
            await handle.append([
              {
                type: 'session/title',
                seq: 0,
                time: Date.now(),
                data: { title, messageSeqs: [], source: { kind: 'user' } },
              },
            ])
            await handle.flush()
          } finally {
            await handle.close()
          }
        }

        await persist(sourceId, {}, '源对话')
        await persist(forkId, { parentSession: sourceId }, '源对话 (1)')

        // 注：试过用官方 `sessionController.rename` 先把两条会话 resume 成 live，好让标题进
        // projection cache（列表标题只来自缓存）。实测**会弄坏夹具**：子会话从列表里消失、
        // 源行变成 blank（leading 槽整条不渲染）。所以维持冷会话，并接受
        // `displayTitle` 退回 cwd 目录名 —— 那是冷会话的既有行为，不是本插件的问题。

        let attached = 0
        const registry = ctx.get('workspaceRegistry')
        if (registry !== undefined) {
          const workspace = await registry.create(dir)
          await workspace.attachSession(sourceId)
          await workspace.attachSession(forkId)
          attached = workspace.sessionIds.length
        }

        console.log(`[fixture] source=${sourceId} fork=${forkId} parentSession=${sourceId} workspaceSessions=${attached}`)
      } catch (error) {
        console.error('[fixture] failed:', error)
      }
    })()
  }, 2500)
}
