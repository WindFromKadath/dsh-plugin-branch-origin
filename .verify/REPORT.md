# 验证报告 · dsh-plugin-branch-origin v0.1.0

- 日期：2026-10-07
- 代码版本：working tree（尚未提交；见 §5 待办）
- 运行时：DSH 0.2.0-rc.2，Node v24.18.0（官方包取自本机全局 CLI 安装目录）
- 结论：离线 **13/13**、真机 **14/14** 通过；`desktop` profile **已装入**且组合预检通过（§3）。**GUI 目视仍待重启后确认**（§5）。

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

## 3. desktop profile 装载与组合预检

按用户 2026-10-07 的明确要求装入 `desktop`。装载脚本 [install-desktop.mjs](install-desktop.mjs)（幂等、可 `--uninstall` 精准卸载，**不从备份整体还原**）。

| 落点 | 结果 |
|---|---|
| `<profile>/package.json` → `dependencies` | `"dsh-plugin-branch-origin": "link:<repo>"`（`dshmarket` 原样保留） |
| 同上 → `dsh.profile.bundles` | 追加 `dsh-plugin-branch-origin` |
| `<profile>/node_modules/dsh-plugin-branch-origin` | 目录链接 → 本仓库 |
| manifest 备份 | `package.json.bak-2026-10-07T04-39-41-853Z-dsh-plugin-branch-origin` |

**组合预检**（只读，用 app-boot 自己的 `loadProfileDirectory` + `composeEntries` 复现 desktop 组合；见 [diagnose-desktop-compose.mjs](diagnose-desktop-compose.mjs)）：

```
bundle 层：8        被跳过的 bundle：0        组合后条目总数：196
  + ... dshmarket
  + dsh-plugin-branch-origin   (patch: <profile>\node_modules\dsh-plugin-branch-origin\cordis.patch.yml)
我们那一行：[ { "id": "branch-origin", "name": "dsh-plugin-branch-origin" } ]
结论：bundle 已解析 = true；被跳过 = false；组合含我们那一行 = true
```

**模块加载预检**（排掉 `dsh-plugin-workspace-archive` 踩过的"组合层正常、只有模块加载失败"）：

```
经 <profile>\node_modules\dsh-plugin-branch-origin\lib\index.js 加载成功
name = dsh-plugin-branch-origin
inject = ["sessions","sessionTitle"]
```

本插件零 import，因此不受"junction 装载解析不到宿主包"的限制——这正是这一层能一次通过的原因。

**尚未生效**：组合是应用**启动时**固定的，实测 HMR 从不热装载插件行 ⇒ 必须完全退出并重开 DSH Desktop。本次装载时 GUI 正由该 profile 服务（监听 19387 的是应用自己的 Electron 进程），所以没有代用户重启。

## 4. 本轮修正过的实现缺陷

第一版 `splitCounter` 的正则把编号前的空格一起捕获成 base（`"X (1)"` → `"X "`），导致"子标题是否仍是源标题的机械派生形态"永远判否，fork 一次都不会被标注。离线用例当场抓住；修正为剥掉尾随空白，并把 `desiredTitle` 简化成"前缀子标题原文"的单一规则。

## 5. 未覆盖 / 已知限制

- **GUI 目视未做**：装载已完成、宿主编排与客户端声明均已预检，但侧栏那一行（标题与徽标）到底显示成什么样，要在重启后亲眼确认。真机装置是 headless 组合（无 webserver、不加载客户端半边），覆盖不到 GUI；客户端半边另见 §7。
- **重启会中断当时的会话**：监听 19387 的是桌面应用自己的进程，重启 = 本会话的服务器断开。这是没有代用户重启的唯一原因。
- **清单重写风险**：2026-10-07 出现过"应用按自身状态重写 profile 清单，把本地 `link:` 依赖与 bundle 项一起丢掉"。实测应用**启动时**会重写 `cordis.yml`（mtime 与进程启动同秒），但**没有**在启动时重写 `package.json`。真被丢掉就重跑安装脚本（幂等）。
- **磁盘物化未覆盖**：没有 agent loop 就没人给会话开写入句柄，store 里的会话不会落盘（`dsh-plugin-branch` V13 已记录同一事实）。因此地面真值改用官方 `sessionQuery` 的独立读取通道，而不是读会话文件。
- **与同类插件并存未实测**：规则上互相放过（见 [docs/DESIGN.md](../docs/DESIGN.md) §5 D004），但没有与 autofork / session-tree 同机装载测试。

## 6. 复现

```powershell
cd <repo>
npm test        # 离线 13 项 + 客户端半边冒烟
npm run client-smoke
npm run rm-test # 真机 14 项
node .verify/md-lint.mjs

# 装载与预检
node .verify/install-desktop.mjs --status
node .verify/check-client-manifest.mjs
node --import ./test/register.mjs .verify/diagnose-desktop-compose.mjs
```

真机装置全程只写仓库内的 `.verify/home` 与 `.verify/proj`，**不碰用户 `~/.dsh`**。
只有 `install-desktop.mjs` 写 profile（工作区之外），需要一次性更宽权限。

## 7. 客户端半边（v0.1.1）

背景：用户 2026-10-07 追问"改名会不会抹掉来源" —— 标题里的标签**会**（标签是标题字符串的一部分，且本插件不抢回）。于是按方案 C 增加一条**不依赖标题**的通道：侧栏行上的来源徽标 + 悬停段。见 [docs/DESIGN.md](../docs/DESIGN.md) §5 D009/D010。

### 7.1 离线冒烟（`npm run client-smoke`，[tests/client-smoke.mjs](../tests/client-smoke.mjs)）

在 Node 里用桩 `__ModuleLoader__` 跑真实的 `lib/client.js`，断言：

| 组 | 断言 |
|---|---|
| 协议 | 调用 `__ModuleLoader__.load`；`id` 逐字等于包名；导出 `apply`；`inject === ['slots','sessions']`；`require` 只用了基座白名单里的 `react` / `react/jsx-runtime` |
| 席位 | 恰好注册两个：`sidebar.session.row.leading` 与 `sidebar.session.row.hover`，id 均为 `branch.origin`，且都拿到了组件函数 |
| 行为 | fork 行渲染出 `⤷` 徽标且 tooltip 为 `来源：源对话`；二级分叉指向它的**直接**来源；源行不在快照里时给 `（未命名对话）` 而不是崩 |
| 反例 | 无父级的会话、`origin: 'subagent'` 的子智能体会话、快照里不存在的行 ⇒ 一律返回 `null` |
| 降级 | 两种数据源都缺席时组件返回 `null`（缺席），不抛错 |
| 异常保护 | 激活期抛错被 `apply` 吞掉，并向控制台记一条 `client half failed to apply` |

### 7.2 客户端声明静态预检（`node .verify/check-client-manifest.mjs`，14/14）

官方没有导出 `parseDshClient`，所以该脚本**复刻**了 `dsh-client-modules/lib/index.js:61-75` 的校验规则与 `:713-728` 的判定顺序（含那句"声明了 `dsh.client` 却没有 `./client` 就抛错"），对**本仓库**与**desktop profile 里的安装副本**各跑一遍：

```
PASS  name 逐字等于包名 / dsh.client 通过官方校验 / platform === 'web'
PASS  exports 声明了 './client' / ./client 指向的文件存在
PASS  client.js 用包名逐字注册 / client.js 有全有或全无的保护
结果：14/14 通过
```

这条预检的意义：客户端组合是**全有或全无**，一个包在激活期抛错会拖垮整个 GUI —— 静态预检先把"声明形态"这一类失败排掉。

### 7.3 GUI 真机（无头 Chrome + CDP）：**7/7 通过**

装置是**仓库内自包含**的，全程不碰用户 `~/.dsh`、不动 desktop：

| 文件 | 作用 |
|---|---|
| [gui/setup.mjs](gui/setup.mjs) | 建临时 `DSH_HOME`（`.verify/gui/home`）与临时 `gui` profile；只把用户真实的 `profiles/node_modules` 当**只读**锚点用来解析官方包 |
| [gui/fixture/](gui/fixture/) | 一次性夹具插件：用官方 `sessionPersistence.create → append → flush → close` 落盘两个会话，子会话 header 带 `parentSession`，再挂进工作区注册表 |
| [gui/drive.mjs](gui/drive.mjs) | 无头 Chrome + CDP：开页面、关引导弹窗、展开侧栏、断言行/徽标/悬停/控制台 |
| [gui/probe-page.mjs](gui/probe-page.mjs) | 页面结构探针（定位"为什么没有行"时用） |

运行：`node .verify/gui/setup.mjs` → 用临时 `DSH_HOME` 起 `--profile gui --port 0 --no-open` → `node .verify/gui/drive.mjs <CDP端口> <页面URL>`。

结果（原始输出）：

```
PASS  A1 页面加载完成  {"state":"complete"}
PASS  A2 侧栏出现会话行（夹具的源会话 + 分叉子会话）  {"rows":2}
PASS  A3 分叉行的行首出现来源徽标
      {"rowKey":"session:session-fixture-fork","badgeText":"⤷",
       "badgeTitle":"来源：dsh-plugin-branch-origin","slotText":"⤷","rowText":"⤷ 未命名 1分钟"}
PASS  A4 徽标 tooltip 是来源标注（`来源：<源对话标题>`）  {"titles":["来源：dsh-plugin-branch-origin"]}
PASS  A5 没有父级的行不带徽标  {"rows":1}
PASS  A6 悬停分叉行时出现「来源」段  {"hoverText":"来源 ⤷ dsh-plugin-branch-origin"}
PASS  A7 控制台没有本插件/客户端组合的错误  {"ours":[],"totalErrors":0}

结果：7/7 通过
```

三条最要紧的结论：

1. **客户端组合在真实浏览器里加载成功、零错误** —— "全有或全无"会拖垮整个 GUI 的风险被实测排除（A7 + A1）。这是重启前最需要确认的一条。
2. **徽标只出现在"有父级"的那一行**：分叉行 `session:session-fixture-fork` 有 `⤷`，源行 `session:session-fixture-source` 没有（A3/A5 成对反例）。
3. **悬停段的文案确实渲染出来**：`来源 ⤷ dsh-plugin-branch-origin`（A6）。

**一处诚实的折扣**：tooltip 里的来源名是 `dsh-plugin-branch-origin`（cwd 目录名），不是夹具写的 `源对话`。原因是夹具造的是**冷会话**，而客户端列表的标题只来自 projection cache，未 engage 的会话没有缓存 ⇒ 官方 `displayTitle` 退回 cwd 目录名（`dsh-plugin-branch` V23 记录过同一现象）。真实 GUI 里的 fork 子会话是 live 的、父会话本来就有投影标题，所以实际会显示真名。试过用 `sessionController.rename` 把夹具会话 resume 成 live 来消掉这个折扣，**实测反而弄坏夹具**（子会话从列表消失、源行变 blank），已回退并把这个坑记进 AGENTS §6。

### 7.4 仍未做的

- 只在**无头 Chrome + 临时 profile** 上验过；用户真实 `desktop` GUI 里的目视（重启后）仍是最后一步（`tasks.csv` B004）。
- 与 `dsh-plugin-branch` 同装时的徽标并存未实测：本装置只装了本插件 + 夹具，所以 `drive.mjs` 的徽标选择器已按 `title^="来源："` 过滤（避免取到同槽里的「⇄」徽标），但"两个徽标同时在同一行"没有真机跑过。
