# 设计与契约 · dsh-plugin-branch-origin

本文记录本插件依据的**宿主契约**与**判定规则**。每条契约都给出出处；`【本人已核】` = 我直接读过那段源码，`【勘察记录】` = 只读勘察给出、未逐条复核。

源码根：`<npm-global>\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\`（本机安装的 DSH 0.2.0-rc.2）。下文省略该前缀，写成 `包名/文件:行号`。

## 1. 分叉关系怎么表示

- 【本人已核】`SessionHeader.parentSession?: SessionId`（字符串，不是对象）——`dsh-session/lib/types/types.d.ts:71`；同头还有 `isSeeded`（:76）、`origin?: 'subagent'`（:81）、`delegationDepth`。
- 【本人已核】`Session` 实例通过 `readonly header: SessionHeader` 暴露它——`dsh-session/lib/types/index.d.ts:119`。
- 【勘察记录】两个写入点：`SessionStore.fork()`（`dsh-session/lib/index.js:1887-1902`）与 Host 级 `sessionController.fork()`（`dsh-api-session-controller/lib/index.js:814-819`），都写 `parentSession` + `isSeeded`。
- 【勘察记录】`subagent` 子会话另有 `origin: 'subagent'` 与 `delegationDepth`（`dsh-subagent/lib/index.js:470-481`）。

**判据**：`header.parentSession !== undefined && header.origin !== 'subagent'` ⇒ 用户 fork。这是本插件 `isFork()` 的全部内容。

## 2. 事件面

- 【本人已核】`'session/created'(session: Session): void` 声明在 `dsh-session/lib/types/index.d.ts:42`。
- 【本人已核】它由 `dsh-api-session-controller` 消费：`ctx.on("session/created", (session) => ctx.emit("api-session/added", …))`——`dsh-api-session-controller/lib/index.js:2873`。多处官方插件用同一写法（`dsh-session-projection/lib/index.js:53`、`dsh-goal/lib/index.js:304` 等）。
- 【本人已核·真机】真机上 `ctx.sessions.fork(...)` 会为新子会话发 `session/created`，payload 的 `session.header.parentSession` 正确（见 [.verify/REPORT.md](../.verify/REPORT.md) 阶段 2）。
- 【勘察记录】监听必须带 `{ global: true }`，否则会被 `dsh-scope` 的上下文过滤挡掉；官方同类写法都带它。
- 【勘察记录】`session/title` **不是** cordis 事件，而是**会话日志事件类型**（`dsh-session/lib/types/known-event-types.js:55`），只能通过 `ctx.on('session/event', (session, event) => …)` 观察。
- 【勘察记录·要紧】**fork 的播种事件不会发布到 `session/event`**（`dsh-session/lib/types/index.d.ts:126-127`）⇒ 继承来的那条 `session/title` 拿不到回调，必须靠 `session/created` 起头。
- 【本人已核】`api-session/added` 存在但 payload 是 `SessionSummary`（无 live Session 对象），不如 `session/created` 好用。
- 【勘察记录】`domain/changed` 有 session 维度的表（`session_projcache/sessions`），但那是"派生缓存、永不权威"（`dsh-session-projection-cache/lib/index.js:90-117`）⇒ 不用它做 fork 触发。

## 3. 标题机制

- 【本人已核】服务名 `sessionTitle`：`super(ctx, "sessionTitle")`——`dsh-session-title/lib/index.js:214`；其 `static inject = ["sessions", "sessionProjections"]`（:201）。
- 【本人已核】读：`get(session) => SessionTitleSnapshot | undefined`——`dsh-session-title/lib/types/index.d.ts:123`。
- 【本人已核】写：`rename(session, title) => SessionTitleSnapshot`——同上 `:135`，注释写明写的是 `session/title` 事件、`source` 为 `user`，会**钉住**标题。
- 【本人已核】快照形状：`{ title, messageSeqs, source, eventSeq, updatedAt }`——`dsh-session-title/lib/types/types.d.ts:34-48`。
- 【本人已核】官方 fork 的编号：`increasedForkTitle()`——`dsh-api-session-controller/lib/types/client/sessions/service.js:61-71`，未编号标题变 `<标题> (1)`，已编号则递增，半角/全角括号都支持。
- 【本人已核】GUI 强制打开这个编号：客户端 `fork({ …, increaseTitle: true })`——`dsh-api-session-controller/lib/types/client/sessions/service.js:339-358`；调用点 `dsh-client-ui-workspace/lib/client.js:842`、`dsh-client-ui-chat/lib/client.js:12456`。
- 【勘察记录】fork 保留**继承**的标题，first-prompt 提供方对带父级的会话**主动跳过**（`dsh-session-title/lib/index.js:386`）⇒ 钉住 fork 的标题不会让它失去自动命名。
- 【本人已核】真机配置取值（`dsh-base/cordis.patch.yml:55-60`）：`fallbackMaxWords: 5`、`fallbackMaxBytes: 40`、`maxTitleBytes: 80`。
- 【勘察记录】`ctx.sessionQuery.readTitle(id)` / `readTitleSnapshots(ids)` 是另一条官方读取通道（`dsh-session-query/lib/types/index.d.ts:96-105`；`readTitleSnapshots` 返回**数组**不是 Map）。本插件的源标题读取退路，也是真机验证的独立地面真值通道。
- 【勘察记录】`sessionController.rename({ sessionId, title })`（`dsh-api-session-controller/lib/index.js:754-768`）会先 `resolveAgent` 再改名 ⇒ **能改名冷会话**。它是 `sessionTitle` 缺失或会话非 live 时的退路。

## 4. 判定规则

只有一条：**子标题抹掉官方尾编号后必须与源标题同名**。

- 抹编号用 `baseOf()`：`<base> (3)` / `<base>（3）` → `<base>`（`base` 去掉尾随空白，否则 `"X (1)"` 的 base 会是 `"X "` 而永远比不中）。
- 满足时产出 `⤷ 来源：<子标题原文>` —— 前缀子标题**原文**，于是官方序号原样保留，同一源会话的多个分叉在侧栏里仍可分。
- 不满足（用户改过名、别的谱系插件钉过名、已是本插件标记）⇒ 返回 `undefined`，**不动手**。

## 5. 决策记录

| 编号 | 决定 | 依据 |
|---|---|---|
| D001 | 标签落在**会话标题**（`⤷ 来源：<源标题>`），不做客户端半边 | 用户 2026-10-07 选定；且这是同类实现的 2/2 主流做法（见 [PRIOR-ART.md](PRIOR-ART.md)）；纯宿主半边不需要构建链，也不占官方 slot |
| D002 | 触发挂**原生** `session/created`，覆盖所有 fork 入口 | 这是与既有插件唯一站得住的差异点：两家同类只标注自己创建的分叉 |
| D003 | 同时挂 `session/event` 的 `session/title` 做收敛 | 官方那次 `(1)` 改名发生在 `session/created` 之后（两个 RPC），只挂一个会被覆盖 |
| D004 | **只标注、不接管**：标题一旦不是继承形态就放过 | 避免与 autofork / session-tree 双重加前缀毁掉标题，也避免覆盖用户手动命名 |
| D005 | 零 import、零依赖、不注册工具 | 沿用工作区纪律（不引构建链）；且绕开"junction 装载的插件 import 宿主包会 ERR_MODULE_NOT_FOUND" |
| D006 | 写入走 `sessionTitle.rename`，退路 `sessionController.rename` | `rename` 会 `pin` 标题；退路能处理冷会话 |
| D007 | 不注入 `sessionQuery`，只在需要时 `ctx.get` | 精简 profile 缺该服务时插件仍应激活（主路径不依赖它） |
| D008 | 只处理**装载之后**新建的 fork，不做启动扫描 | 避免给用户早就手动命名过的旧分叉重新贴标 |
| D009 | **保留**标题前缀，另加**客户端半边**的侧栏来源徽标（叠加，不替换） | 用户 2026-10-07 追问"改名会不会抹掉来源"后选定方案 C。标签写在标题里 ⇒ 改标题即抹掉；徽标不依赖标题，改名后仍可见 |
| D010 | 徽标只对"有父级且非子智能体"的行显示；不注册模型可见工具、不占 `single` 占位 | 与宿主半边同一判据（父级字段非空 + `origin !== 'subagent'`）；沿用 `dsh-plugin-branch` 已验证的 slot 与字段约定 |

## 6. 未验证 / 不确定

- 【已知且是设计选择】**重命名会抹掉标题里的来源**：标签是标题字符串的一部分；改名后本插件**不会**抢回（`watching` 窗口 4.6 秒后彻底收手，窗口内也因标题不再是继承形态而放过）。来源关系本身仍在 `SessionHeader.parentSession` 里，随时可查。**这正是 D009 存在的理由** —— 徽标通道不受改名影响。
- 【已知且是设计选择】**标签是快照**：它记的是 fork 那一刻源会话的标题；之后改**源**会话的名字，子会话的标签不跟着变（显示旧名）。
- 【未验证】**GUI 上的可见效果**：真机装置跑的是 headless 组合（无 webserver、无客户端）。标题前缀与来源徽标在侧栏的实际呈现需要在 GUI 上目视确认。
- 【未验证】与 autofork / session-tree **同时装载**时的实际表现（规则上应当互相放过，但没有实测）。
- 【不确定】`session/created` 与官方 `(1)` 改名之间，本插件的 `settleMs=600` 是否在所有机器上都够宽（本地实测远小于它）。
- 【不确定】边界：若用户在窗口内把 fork 标题改成恰好 `<源标题> (N)`，会被贴上标记。
