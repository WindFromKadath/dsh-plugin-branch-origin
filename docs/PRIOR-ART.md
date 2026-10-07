# 先行者核查 · 「给分叉标来源」是否已有人做过

- 结论时间：2026-10-07（生态演进很快，本结论只在此日期前公开可核实范围内成立）。
- 方法：只读 web 调研——`raw.githubusercontent.com` 读 README/源码、`api.github.com` 读仓库元信息、`registry.npmjs.org` 查包；另交叉核对工作区内已有的 [dsh-plugin-branch/docs/RELATED.md](../../dsh-plugin-branch/docs/RELATED.md)。
- 性质：**外部资料，未在本机逐条复核**。本文结论只用于定位，不作为本插件的契约依据（契约见 [DESIGN.md](DESIGN.md)）。

## 1. 结论

**部分被覆盖，缝只有一条。**

- 「把来源写进**会话标题**」已经被两家真做了，而且**这也是主流做法**（核查到的 2 家实现里 2/2 都写在标题上）。
- 但两家**只标注自己创建的分叉**；它们都不覆盖官方原生 fork 入口（侧栏「分叉会话」、消息菜单）。
- **「挂原生 `session/created`，给官方入口产生的 fork 补来源标签」在公开可核实范围内仍是空白**；而这条触发路径已被另外两个插件证明可行（它们拿去做别的事）。

## 2. 最接近的三家

| 仓库 | 星 | 类型 | 有来源标签 | 做法要点 |
|---|---|---|---|---|
| [vlln/dsh-autofork](https://github.com/vlln/dsh-autofork) | 2 | 标题标签 + 家族页签 | ✅ | `titleMark: '⑂'`，标题钉成 `⑂1 修 GUI 卡顿`（同族共用基名、各自编号）；走 `sessionTitle.rename()`。触发**只**是它自己判断"agent 忙 + 用户又发指令" |
| [Nirvana-Jie/dsh-session-tree](https://github.com/Nirvana-Jie/dsh-session-tree) | 1 | 谱系树整页 + 标题标签 | ✅ | 标题继承父标题并追加本地兄弟序号：`Task → Task (1) → Task (1) (1)`，标题本身编码祖先路径；宿主半边只有 191 字节（空壳）⇒ **结构上不可能响应原生 fork** |
| [Lzcdebear/better-dsh-session-deletetool](https://github.com/Lzcdebear/better-dsh-session-deletetool) | 18 | 删除工具 + 家族树 | ❌ | 本领域星数最高；在删除对话框里画完整家族树，并明确写道"侧栏不给这个关系任何说明，DSH 本身从不画"——**独立佐证了这个缺口** |

## 3. 触发机制已有先例

| 仓库 | 机制 | 与本插件的关系 |
|---|---|---|
| [Enosensu/dsh-fork-relink](https://github.com/Enosensu/dsh-fork-relink) | 挂 `session/created`，用 `isSeeded` + `parentSession` + `origin !== 'subagent'` 判别，复制子 agent 树 | **证明本插件的触发路径可行**，且同为纯宿主半边、零构建 |
| [azazo1/dsh-fork-inbox-guard](https://github.com/azazo1/dsh-fork-inbox-guard) | 挂 `agent/created` 丢掉继承的待领 inbox | 同类事件面的另一用法 |

## 4. 其余核查过的仓库（与来源标注无关或另有含义）

| 仓库 | 类型 | 说明 |
|---|---|---|
| [chouyong/dsh-fork-graph](https://github.com/chouyong/dsh-fork-graph) | 只读谱系图 | 把 "No writes / No second source of truth" 当卖点 |
| [ZhengQingJing/dsh-session-tree](https://github.com/ZhengQingJing/dsh-session-tree) | 只读缩进树 | 明确"不追加 Session 事件、不改 parent pointer" |
| [robiteame/dsh-session-tree-extension](https://github.com/robiteame/dsh-session-tree-extension) | 树 + fork/clone | 需 DSH 0.2.1-alpha.1 |
| [mydsp/dsh-branchman](https://github.com/mydsp/dsh-branchman) | worktree + 子会话 + 总览图 | 重；写自己的 `.branches/<UUID>` |
| [Jason-skd/dsh-session-fork](https://github.com/Jason-skd/dsh-session-fork) | 自带分支模型 | branch/squash/rebase + `send_message_by_branch`；ancestry 是插件自己的 |
| [serein4444/dsh-chat-assistant](https://github.com/serein4444/dsh-chat-assistant) | 侧栏辅助对话 | 弱形态：固定类型标签 `辅助对话 N`，**不含父名** |
| [wheam/dsh-session-groups](https://github.com/wheam/dsh-session-groups) | 分组轴 | ⚠️ 它的"来源"指飞书/Slack/TG 等**通信来源**，与 fork 谱系**同名不同义** |
| [chinahhy/DSH-plugins](https://github.com/chinahhy/DSH-plugins) | 插件集合 | 余额 + iPhone 远控，无关 |
| [Planckbaka/dsh-plugin-github-workflows](https://github.com/Planckbaka/dsh-plugin-github-workflows) | GitHub 工作流 | 无关 |
| [@knyazevai/dsh-fork-session-source](https://www.npmjs.com/package/@knyazevai/dsh-fork-session-source) | **假阳性** | 名字像，实则记录创建会话时 `GITHUB_ACTIONS` 是否等于 `'true'`——CI 部署来源，与 fork 谱系无关 |

另：目录站 [rob-x-ai/awesome-dsh-plugin](https://github.com/rob-x-ai/awesome-dsh-plugin) 的 "Sessions & Messages" 与 "UI Enhancements" 两节内**无一家**做 fork 来源标注。

## 5. 本插件选择的差异点

1. **入口覆盖**：挂原生 `session/created`，官方两个入口（侧栏「分叉会话」、消息菜单「分叉到新对话」）造出的 fork 也带标签——两家同类在这里都不生效。
2. **只标注、不接管**：不 fork、不搬子 agent、不清 inbox、不画树、不占官方 slot，因此可与任何谱系插件并存；对已经带 `⑂1 …` / `Task (1)` 的标题**幂等放过**（别家没有动机处理这个，双重加前缀会毁掉标题）。
3. **不重复造**："让 agent 自述我是谁的分叉"已有 [dsh-plugin-branch](../../dsh-plugin-branch/README.md) 的 `branch_where`（V28）覆盖，本插件不做。

## 6. 已知的参考代价

- 【来自 autofork 自述】**钉住标题 = 该会话不再被自动命名**。对本插件无副作用：first-prompt 标题提供方本来就跳过带父级的会话（见 [DESIGN.md](DESIGN.md) §3）。
- 【不确定】autofork 是否也把原生 fork 纳入它的页签；其 README 只描述自家触发的分叉。未读源码确认。
- 【不确定】官方客户端是否已有 lineage chip：有第三方插件描述提到把 lineage 折进 header 面板，另一家说侧栏是"带缩进的平铺列表"。本机源码核对结果是——侧栏确实有 `depth` 缩进、官方 fork 确实写 `<源标题> (1)`，但**没有**任何 "来源 / source / forked from" 的可见字符串（全树 grep `⤷` 零命中）。
