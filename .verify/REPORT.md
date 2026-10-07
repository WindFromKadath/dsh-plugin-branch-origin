# 验证报告 · dsh-plugin-branch-origin v0.1.0

- 日期：2026-10-07
- 代码版本：working tree（尚未提交；见 §5 待办）
- 运行时：DSH 0.2.0-rc.2，Node v24.18.0（官方包取自本机全局 CLI 安装目录）
- 结论：离线 **13/13**、真机 **14/14** 通过。**GUI 目视与 profile 装载未做**（见 §4）。

## 1. 离线行为断言（`npm test`）

桩 ctx（假 `sessions` / `sessionTitle`），不 import 任何宿主包。

| 用例 | 断言 |
|---|---|
| `splitCounter` | 辨识半角/全角编号，且把尾随空白剥掉（`"X (1)"` → base `"X"`） |
| `baseOf` | 抹掉尾编号 |
| `desiredTitle` | 继承形态 → 贴标记；官方增号 → 序号保留；已标记/被改名 → 放过；空标题 → 放过 |
| 新建 fork | 标题变成 `⤷ 来源：修 GUI 卡顿`，且只写一次 |
| 官方 `(1)` 改名 | 收敛成 `⤷ 来源：修 GUI 卡顿 (1)`，自回放不炸环 |
| 已标好的标题 | 不重复写 |
| 子智能体会话 | `origin: 'subagent'` 默认不动；`labelSubagents: true` 时才动 |
| 普通新会话 | 不动 |
| 窗口内被改名的 fork | 放过（`⑂1 修 GUI 卡顿` 保持原样） |
| 源会话无标题 | 不动手 |
| 非 live 会话 | 退到 `sessionController.rename` |
| 窗口过期 | 之后的改名不再被覆盖 |

```
ℹ tests 13   ℹ pass 13   ℹ fail 0
```

## 2. 真机端到端（`npm run rm-test`）

装置：`.verify/real-machine.mjs` + `.verify/rm/cordis.yml`。
在**仓库内**的临时 `DSH_HOME`（`.verify/home`）里用 `@deepseek-ai/dsh-app-boot` 的 `boot()` 起一个**真** DSH 运行时：真 Loader、真 `SessionStore`、真 JSONL 持久化、真 `sessionProjections` / `sessionTitle` / `sessionQuery`。不开端口、不调模型、跑完即退。

组合**故意不挂** `dsh-api-session-controller`（它只在 web-app bundle 里）——本插件的主路径正是"没有 controller 也能标注"。

| # | 检查 | 结果 |
|---|---|---|
| 1-3 | `sessions` / `sessionTitle` / `sessionPersistence` 三个服务存在 | PASS |
| 4 | 源会话标题被钉成「修 GUI 卡顿」 | PASS |
| 5 | `ctx.sessions.fork()` 建立的子会话 `header.parentSession` 指向源 | PASS |
| 6 | fork 触发了 `session/created`（事件面自证） | PASS |
| 7 | **插件自动把子标题改成 `⤷ 来源：修 GUI 卡顿`** | PASS |
| 8 | 模拟官方第二步改名 `修 GUI 卡顿 (1)` → **收敛成 `⤷ 来源：修 GUI 卡顿 (1)`** | PASS |
| 9 | 反例：没有父级的普通会话不被标注 | PASS |
| 10 | 反例：子智能体会话（`origin: 'subagent'`）不被标注 | PASS |
| 11 | 同一源的第二个 fork 也被标注 | PASS |
| 12 | 反例：用户在窗口内改名（`我的实验`）后插件不抢回 | PASS |
| 13 | `sessionQuery` 服务存在 | PASS |
| 14 | **地面真值**：另一条官方读取通道 `sessionQuery.readTitle(childId)` 读到同一条带来源的标题 | PASS |

```
结果：14/14 通过
```

事件面原始记录（`session/created`）：

```
[ {id: 源会话},
  {id: 子会话, parent: 源会话},
  {id: 普通新会话},
  {id: 子智能体会话, parent: 源会话, origin: 'subagent'},
  {id: 第二个子会话, parent: 源会话} ]
```

## 3. 本轮修正过的实现缺陷

第一版 `splitCounter` 的正则把编号前的空格一起捕获成 base（`"X (1)"` → `"X "`），导致"子标题是否仍是源标题的机械派生形态"永远判否，fork 一次都不会被标注。离线用例当场抓住；修正为剥掉尾随空白，并把 `desiredTitle` 简化成"前缀子标题原文"的单一规则。

## 4. 未覆盖 / 已知限制

- **GUI 目视未做**：真机装置是 headless 组合（无 webserver、无客户端半边，本插件也没有客户端半边）。"侧栏行显示新标题、只闪变一次"需要在 GUI 上确认。
- **profile 装载未做**：本轮刻意没有改任何 profile（`desktop` 是正在使用的 GUI，装它要重启应用）。
- **磁盘物化未覆盖**：没有 agent loop 就没人给会话开写入句柄，store 里的会话不会落盘（`dsh-plugin-branch` V13 已记录同一事实）。因此地面真值改用官方 `sessionQuery` 的独立读取通道，而不是读会话文件。
- **与同类插件并存未实测**：规则上互相放过（见 [docs/DESIGN.md](../docs/DESIGN.md) §5 D004），但没有与 autofork / session-tree 同机装载测试。

## 5. 复现

```powershell
cd <repo>
npm test        # 离线 13 项
npm run rm-test # 真机 14 项
node .verify/md-lint.mjs
```

真机装置全程只写仓库内的 `.verify/home` 与 `.verify/proj`，**不碰用户 `~/.dsh`**。
