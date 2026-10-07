# dsh-plugin-branch-origin · 分支联系（DSH 插件）

> 给**分叉出来的会话**标上来源：它的标题会变成 `⤷ 来源：<源会话标题>`，于是侧栏那一行自己就说明了「我是从哪个对话分出来的」。

零依赖、纯宿主半边、无构建链：整个插件就是 [lib/index.js](lib/index.js) 加 [cordis.patch.yml](cordis.patch.yml) 一行。

## 为什么需要它

DSH 的 fork **已经**建立了真实父子链，也**已经**有一点可见性，但没有任何一处写出「来自哪个对话」：

| 官方已有的 | 缺的那一格 |
|---|---|
| `SessionHeader.parentSession`（真实父子链） | 侧栏不显示它指向谁 |
| 官方 fork 把子标题改成 `<源标题> (1)`（`increasedForkTitle`） | 只是个编号，看不出这是别人的分叉 |
| 侧栏按 `SessionListEntry.depth` 做谱系缩进 | 缩进不说明来源对话叫什么 |

本插件补的就是右上那一格：把子会话标题改写成 `⤷ 来源：<源标题>`，让来源**在标题里自述**。

## 行为

规则只有一条，其余都是它的推论。

| 情形 | 结果 |
|---|---|
| 任何入口产生的新 fork（侧栏「分叉会话」、消息菜单、别的插件的 fork、`ctx.sessions.fork`） | 标题变成 `⤷ 来源：<源标题>` |
| 官方随后把它改成 `<源标题> (1)` | 收敛成 `⤷ 来源：<源标题> (1)`，序号保留，同源多个分叉仍可分 |
| 子会话标题已被用户或别的谱系插件改过（如 `⑂1 …`、`我的实验`） | **不动**（只标注，不接管） |
| 子标题已经是 `⤷ 来源：…` | 幂等，不重复写 |
| 没有父级的普通新会话 | 不动 |
| 子智能体会话（`header.origin === 'subagent'`） | 不动（默认；可用 `labelSubagents` 打开） |
| 源会话当时没有标题 | 不动 |

判定细节：只有当子标题**抹掉官方尾编号后与源标题同名**时才算「仍是继承形态」，这时才贴标记。见 [docs/DESIGN.md](docs/DESIGN.md)。

## 安装与启用

插件以 **junction + `package.json` 的 `link:`** 装进 profile（与工作区内另外两个插件同一套做法）：

1. 在目标 profile 的 `package.json` 里加 `dependencies["dsh-plugin-branch-origin"] = "link:<本目录绝对路径>"`，并把包名追加进 `dsh.profile.bundles`；
2. 在 `<profile>/node_modules/` 下建指向本目录的 junction；
3. **重启 DSH**（实测 HMR 从不热装载插件行）。

> ⚠️ 本插件**零 import**，所以不像有依赖的插件那样受"junction 装载解析不到宿主包"的限制。

本轮**没有**改动任何 profile：`desktop` 是正在使用的 GUI，改动需重启应用。要装到 `desktop` 请先说明。

## 验证

| 用途 | 命令 |
|---|---|
| 离线行为断言（13 项，桩 ctx，不需要任何依赖） | `npm test` |
| 真机端到端（14 项，真 Loader / 真 SessionStore / 真 session-title / 真 session-query） | `npm run rm-test` |
| 文档结构 lint | `node .verify/md-lint.mjs` |

真机装置在仓库内的临时 `DSH_HOME`（`.verify/home`）里启动真 DSH 运行时，**不碰用户 `~/.dsh`**、不开端口、不调模型。证据与结论见 [.verify/REPORT.md](.verify/REPORT.md)。

## 已知限制

- **只标注新 fork**：插件装载**之前**就存在的旧分叉不会补标（不做启动扫描）。
- **标注窗口**：fork 之后约 4.6 秒内（`settleMs 600` + `graceMs 4000`）会持续收敛标题；此窗口内用户手动改名**不会**被覆盖（改名后标题不再是继承形态），但若有人把标题改成恰好等于 `<源标题> (N)` 则可能被贴上标记。
- **标题会被钉住**：走的是 `sessionTitle.rename()`，即 `source: { kind: 'user' }`。对 fork 子会话无副作用 —— first-prompt 标题提供方本来就跳过带父级的会话；但请勿把本插件用于给**非 fork** 会话命名。
- **`maxTitleBytes` 会截断**：DSH 默认 80 字节，源标题很长时官方 `rename` 会截断尾部；截断保留头部，所以 `⤷ 来源：` 前缀仍在。
- **不做**：不创建分叉、不搬子 agent、不画树、不改 parent pointer、不写 sidecar、不注册任何模型可见工具。

## 与同类插件的关系

「把来源写进会话标题」是已被验证的做法（[dsh-autofork](https://github.com/vlln/dsh-autofork) 的 `⑂n 家族根名`、[dsh-session-tree](https://github.com/Nirvana-Jie/dsh-session-tree) 的 `Task (1) (1)`），但两家**只标注自己创建的分叉**。本插件的差异点是**入口覆盖**：挂原生 `session/created`，官方入口造出来的 fork 同样带标签。核查过程与出处见 [docs/PRIOR-ART.md](docs/PRIOR-ART.md)。

本插件**只标注、不接管**，所以可以和上述插件并存：它们先命名过的标题会被原样放过。

## 项目入口

- [AGENTS.md](AGENTS.md)：接手与维护规则（含本机环境事实、危险边界）。
- [docs/DESIGN.md](docs/DESIGN.md)：源码级契约与判定规则（每条带 `包/文件:行号`）。
- [docs/PRIOR-ART.md](docs/PRIOR-ART.md)：2026-10-07 先行者核查。
- [tasks.csv](tasks.csv)：任务与验收。
- [.verify/REPORT.md](.verify/REPORT.md)：真机验证报告。
