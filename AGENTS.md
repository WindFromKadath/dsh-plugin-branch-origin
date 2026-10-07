# AGENTS.md — dsh-plugin-branch-origin 维护手册

写给之后接手本仓库的智能体（以及人类维护者）。目标：不必重踩坑就能安全地继续开发与验证。

**读法**：§1 速览 → §2 硬性纪律（违反会造成真实损害）→ §3 环境事实 → §4 常用命令 → §5 代码与约定 → §6 已知陷阱 → §7 交接清单。

## 1. 项目速览

**是什么**：DSH 插件 `dsh-plugin-branch-origin`——「分支联系」。给**分叉出来的会话**标上来源对话：把它的会话标题改写成 `⤷ 来源：<源会话标题>`。

| 项 | 状态 |
|---|---|
| 版本 | `0.1.0`，纯 JS、**零依赖**、无构建链、无客户端半边、不注册任何工具 |
| 实现 | [lib/index.js](lib/index.js)（约 210 行，全部逻辑）+ [cordis.patch.yml](cordis.patch.yml)（一行 `insert`） |
| 核心机制 | 挂 `session/created`（带 `{ global: true }`）识别 fork，等 600ms 后改标题；再挂 `session/event` 的 `session/title` 做收敛 |
| 验证 | 离线 13/13（`npm test`）；真机 14/14（`npm run rm-test`）；见 [.verify/REPORT.md](.verify/REPORT.md) |
| 已装载的 profile | **`desktop`（2026-10-07 装入，待用户重启生效）**。装载脚本 [.verify/install-desktop.mjs](.verify/install-desktop.mjs)，组合预检 [.verify/diagnose-desktop-compose.mjs](.verify/diagnose-desktop-compose.mjs) |
| 定位 | 差异点是**入口覆盖**：同类插件只标注自己创建的分叉，本插件覆盖官方原生 fork。见 [docs/PRIOR-ART.md](docs/PRIOR-ART.md) |

**文档地图**

| 文档 | 回答什么 | 什么时候改 |
|---|---|---|
| [README.md](README.md) | 用户视角：用途、行为表、安装、限制 | 行为/安装/限制变化时 |
| [docs/DESIGN.md](docs/DESIGN.md) | 宿主契约（逐条带 `包/文件:行号`）+ 判定规则 + 决策记录 D001–D008 | 契约核实结果、判定规则、决策变化时 |
| [docs/PRIOR-ART.md](docs/PRIOR-ART.md) | 先行者核查（外部资料，非契约依据） | 再做生态调研时 |
| [tasks.csv](tasks.csv) | 任务与验收 | 每轮工作 |
| [.verify/REPORT.md](.verify/REPORT.md) | 真机验证报告与证据 | 每次做真机验证后 |

## 2. 硬性纪律

1. **不要动 `desktop` profile**，除非用户明确要求。它承载着正在使用的 GUI：改动**必须重启应用**才生效，而重启会中断当前会话。2026-10-07 用户明确要求装入 `desktop`，因此有了 [.verify/install-desktop.mjs](.verify/install-desktop.mjs)；此后的改动仍需先问。
2. **状态只有四档**：✅ 已实测（有证据）/ 🟡 契约已核实未实测 / ⏳ 未验证 / ❌ 已证伪。不许把"契约已核实"说成"已实测"。
3. **不要为了过测试而放宽判定规则**。判定规则（[DESIGN.md](DESIGN.md) §4）是产品语义，改动要有理由并同步改测试与文档。
4. **不要引入依赖或构建链**。零 import 是本插件的**硬约束**：profile 里的 `node_modules/<插件>` 是 junction 时，Node 按真实路径解析，插件 import 宿主包会 `ERR_MODULE_NOT_FOUND`。
5. **不要注册模型可见工具**。本插件的定位是"只标注、不接管"；"让 agent 自述来源"已由 [dsh-plugin-branch](../../dsh-plugin-branch/README.md) 的 `branch_where` 覆盖。
6. **不要 fork 官方 UI**：本插件没有也不应有客户端半边。
7. **`.verify/*.jsonl|*.yml|*.txt` 不入库**（已被 `.gitignore` 覆盖，别用 `-f` 强加）；文档里不写用户名，用 `$env:DSH_HOME` / `<repo>` 占位。
8. **不删、不改名、不移动任何真实工作区目录**；真机验证一律用仓库内的临时 `DSH_HOME`。

## 3. 环境事实（本机，写作与调试时直接用）

```text
DSH_HOME        默认 %USERPROFILE%\.dsh；profiles: desktop / trial / branch-e2e / web
官方宿主源码    <npm-global>\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\*   ← 只读
                （本机 <npm-global> = <npm-global>）
本仓库          <repo> = <repo>
运行时版本      DSH 0.2.0-rc.2（Node v24.18.0）
desktop 应用    <app-dir>\resources\app.asar（**注意目录名里有一个空格**；
                里面是打包文件，普通 Node 读不到内部路径 ⇒ 组合预检改用同版本的全局 CLI 作锚点）
desktop profile %USERPROFILE%\.dsh\profiles\desktop（GUI 正由该 profile 服务，改它要重启应用）
```

| 事实 | 说明 |
|---|---|
| 官方源码就在本机 | 全部契约都能直接读，不必联网、不必解 asar。`dsh-base/cordis.patch.yml` 还给出各行的真实配置取值 |
| 沙箱 | 读工作区外只读；本插件的真机装置把 `DSH_HOME` 指向仓库内，**不需要**放宽权限。只有**写 profile** 需要一次性更宽权限 |
| 写 profile 的窗口 | 与应用重写清单存在竞态：应用在**启动时**会重写 `cordis.yml`（实测 mtime 与进程启动同秒），但**没有**在启动时重写 `package.json` |
| 真机验证不需要模型 | `.verify/rm/cordis.yml` 不挂 agent-loop / webserver：不开端口、不调 LLM、跑完即退 |
| 沙箱内的测试运行器 | `node --test` 默认以管道 stdio 起子进程，在 DSH 文件沙箱下会 `EPERM` ⇒ 用 `--test-isolation=none`（`npm test` 已带） |
| GUI 的进程归属 | 监听 19387 的是桌面应用自己的 Electron 进程 ⇒ **重启应用 = 本会话的服务器断开**，重启前先收尾 |

## 4. 常用命令

```powershell
# 离线行为断言（13 项；桩 ctx，零依赖，不需要 --import 钩子）
npm test

# 真机端到端（14 项；真 Loader / 真 SessionStore / 真 sessionTitle / 真 sessionQuery）
npm run rm-test

# 只查语法
npm run check

# 文档结构 lint（表格列数、围栏、标签块并段；改过 md 就跑）
node .verify/md-lint.mjs
node .verify/md-lint.mjs README.md docs/DESIGN.md      # 只查指定文件

# profile 装载（写工作区外 ⇒ 需要一次性更宽权限）
node .verify/install-desktop.mjs --status     # 只读：依赖声明 / bundle 启用 / 目录链接
node .verify/install-desktop.mjs              # 安装（幂等，可重复跑来修复）
node .verify/install-desktop.mjs --uninstall  # 精准卸载（不从备份整体还原）

# 重启前的组合预检（只读；用 app-boot 自己的组合函数复现 desktop profile）
node --import ./test/register.mjs .verify/diagnose-desktop-compose.mjs
#   期望：8 层全加载、0 跳过、组合条目含 { id: 'branch-origin', name: 'dsh-plugin-branch-origin' }

# 排掉"junction 装载时模块加载失败"（另一个插件踩过）：直接按 profile 的路径 import
#   node --input-type=module -e "const m = await import('file:///<profile>/node_modules/dsh-plugin-branch-origin/lib/index.js'); console.log(m.name)"

# 读官方源码（只读）
#   grep/read <npm-global>\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\<包>\...
```

## 5. 代码与约定

### 5.1 结构（[lib/index.js](lib/index.js)）

- 导出：`MARK`（前缀常量）、`splitCounter` / `baseOf` / `desiredTitle`（纯函数，可单测）、`name`、`inject = ['sessions', 'sessionTitle']`、`apply(ctx, config)`。
- `apply` 内部：`watching: Map<sessionId, deadline>` + `timers: Set`，两个 `ctx.on(..., { global: true })` 钩子，以及 `readTitle` / `writeTitle` / `label` 三个局部函数。
- 可选配置（`apply` 第二参，patch 行**不带**配置）：`settleMs`（默认 600）、`graceMs`（默认 4000）、`labelSubagents`（默认 false）。
- 插件卸载时用一个 `ctx.effect` 清掉所有待触发定时器。

### 5.2 平台约定（照抄工作区内另外两个插件的做法）

- `package.json` 必须声明 `dsh.bundle.patch`；本插件**没有** `dsh.client`（无客户端半边）。
- 宿主半边插件形态：`export const name` / `export const inject = [...]` / `export function apply(ctx, config)`（官方模板见 `dsh-agent-preset/skills/cordis-plugin-development/references/host-plugin.md`）。
- `cordis.patch.yml` 只有一行：`- insert: [{ id: branch-origin, name: dsh-plugin-branch-origin }]`。
- **不写 `export const Config`**：那需要 schemastery（= 一个 import）。宁可少一个可配项，也不破坏零依赖。

### 5.3 测试约定

- 测试用**桩 ctx**（`ctx.on` / `ctx.get` / `ctx.effect` + 假 `sessions` / `sessionTitle`），不 import 宿主包 ⇒ 不需要 `test/register.mjs`。**这是零依赖换来的好处，别弄丢。**
- `test/register.mjs` + `test/resolve-dsh.mjs` 只服务 `.verify/` 的真机装置；解析钩子**惰性**取 profile（`DSH_PROFILE_DIR` → `DSH_HOME\profiles\desktop` → `%USERPROFILE%\.dsh\profiles\desktop`），因为 `--import` 会在真机脚本设置 `DSH_HOME` 之前加载。
- 断言要覆盖**反例**：普通会话、子智能体会话、别人改过名的标题、窗口过期后的改名。

## 6. 已知陷阱速查

| 陷阱 | 事实 |
|---|---|
| 事件收不到 | `session/created` / `session/event` **必须**带 `{ global: true }`，否则被 `dsh-scope` 的上下文过滤挡掉 |
| 只挂一个钩子不够 | 官方 fork 的 `<源标题> (1)` 改名发生在 `session/created` **之后**（第二个 RPC）⇒ 必须再盯 `session/title`；反过来，fork 的**播种事件不发** `session/event` ⇒ 只盯标题写入又会漏掉"没人改名"的情形 |
| 编号空格 | `^(.*?)[(（](\d+)[)）]$` 捕获到的 base **带尾随空格**（`"X (1)"` → `"X "`）⇒ 必须 `replace(/\s+$/u, '')`，否则 source 比对永远不中（v0.1.0 第一版就这么错过） |
| 标题会被钉住 | `sessionTitle.rename` 写的是 `source: { kind: 'user' }`，会 pin 住标题、停掉自动命名。对 fork 安全（first-prompt provider 本来就跳过带父级的会话）；**别**用它给非 fork 会话命名 |
| 服务名 | 是 `sessionTitle` / `sessionProjections`（复数）/ `sessionQuery` / `sessionController`；`super(ctx, "...")` 里那个字符串才是 `ctx.get()` 的键 |
| `readTitleSnapshots` 返回数组 | 不是 Map；且顺序 = 去重后首次出现顺序 |
| 冷会话 | `sessionTitle.rename` 要求 live 会话；冷会话要退到 `sessionController.rename({ sessionId, title })`（它会先 `resolveAgent`） |
| 真机装置里会话不落盘 | 没有 agent-loop 就没人给会话开写入句柄 ⇒ store 里的会话**不会**物化到磁盘（`dsh-plugin-branch` V13 已记录）。真机验证因此改用官方 `sessionQuery` 作独立读取通道 |
| `isSeeded` 的会话构造 | `sessions.create` 里 `isSeeded: true` 必须同时给 `seed` 与 `inheritedEventCount`，否则 `dsh-session/lib/index.js:1340-1341` 直接抛 |
| `session-title` 的配置 | 三个字段 `fallbackMaxWords` / `fallbackMaxBytes` / `maxTitleBytes` **都是必填**，缺一个整行不激活（真机组合里照抄 `dsh-base/cordis.patch.yml:55-60`） |
| 插件行不激活时的表现 | 组合日志会说 `pending (waiting for service: ...)`；本插件 `inject` 只有 `sessions` + `sessionTitle`，缺 `sessionQuery` 不影响激活 |
| `--patch` 位置（若将来用 CLI 实验） | 必须写在 app 参数**之前**：`dsh --profile p --patch x.yml --json "…"` |

## 7. 交接检查清单

- [ ] `npm test` 全绿（13 项）
- [ ] 改过 `lib/`：`npm run rm-test` 全绿（14 项），并把结论写回 [.verify/REPORT.md](.verify/REPORT.md)
- [ ] 改过 md：`node .verify/md-lint.mjs` 报"未发现结构问题"
- [ ] 契约相关结论已写进 [docs/DESIGN.md](docs/DESIGN.md)（带 `包/文件:行号`）
- [ ] 决策变化已记进 DESIGN.md §5，并同步 README 行为表
- [ ] `git status` 干净或改动有明确说明；没有把 `.verify/*.jsonl|*.yml|*.txt` 加进库
- [ ] 若动过 profile：已给出回滚命令，并确认 desktop 仍可正常启动

## 8. git 约定

- 提交信息：`<类型>: <一句话>`，类型取 `feat` / `fix` / `docs` / `test` / `chore`。
- 作者身份是仓库本地中性设置（`dev@localhost`），不写个人邮箱。
- **永不提交**：`.verify/*.jsonl|*.yml|*.txt`、任何凭证、`node_modules/`、`.verify/home/`、`.verify/proj/`。
