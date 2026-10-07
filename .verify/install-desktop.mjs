/**
 * 把 dsh-plugin-branch-origin 装进 `desktop` profile。
 *
 * 形态与 `trial` 上已验证的 `dsh-plugin-branch` 完全一致（本机实测有效）：
 *   ① profile 的 `package.json`：`dependencies[name] = "link:<本仓库>"`
 *      （插件页「已安装」列表读这里）
 *   ② `dsh.profile.bundles` 追加本包名（页面上的启用开关 + 组合时应用本 bundle 的 patch）
 *   ③ `<profile>/node_modules/<name>` junction → 本仓库
 *
 * 本插件零依赖，所以**不需要** ④「patch 层按 id 覆盖配置」，也不动 profile 的
 * `cordis.patch.yml`（那是用户自己的模型/主题配置）。
 *
 * ⚠️ 两个已知约束（写进 README / AGENTS.md 了）：
 *   - **HMR 不会热装载插件行** ⇒ 装完必须**完全退出并重开** DSH Desktop。
 *   - 2026-10-07 出现过"应用按自身状态重写 profile 清单，把本地 `link:` 依赖与 bundle
 *     项一起丢掉"。真发生的话，重跑本脚本即可（它是幂等的）。
 *
 * 卸载走**精准删除**，不从备份整体还原 —— 2026-10-07 实测整体还原会连带丢掉
 * 其后新增的依赖（当时把 `dshmarket` 弄丢了）。备份仍然照写，仅作为人工兜底。
 *
 * 用法：
 *   node .verify/install-desktop.mjs              # 安装（可重复运行 = 修复）
 *   node .verify/install-desktop.mjs --status     # 只看现状，不写任何东西
 *   node .verify/install-desktop.mjs --uninstall  # 精准卸载
 */

import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync, symlinkSync, writeFileSync, copyFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/u, '')
const packageName = 'dsh-plugin-branch-origin'

const mode = process.argv.includes('--status')
  ? 'status'
  : process.argv.includes('--uninstall') ? 'uninstall' : 'install'

const profileDir = process.env.DSH_PROFILE_DIR
  ?? join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop')
const manifestPath = join(profileDir, 'package.json')
const linkPath = join(profileDir, 'node_modules', packageName)

/** 只删目录链接：`rmdir` 不带 `/s`，避免顺着链接删掉目标目录的真实内容。 */
function removeJunction(path) {
  execFileSync('cmd', ['/c', 'rmdir', path], { stdio: 'pipe' })
}

function linkTarget(path) {
  try {
    if (lstatSync(path).isSymbolicLink()) return readlinkSync(path)
    return '<存在但不是链接>'
  } catch {
    return undefined
  }
}

function readManifest() {
  return JSON.parse(readFileSync(manifestPath, 'utf8'))
}

function report(manifest) {
  const dependency = manifest.dependencies?.[packageName]
  const enabled = (manifest.dsh?.profile?.bundles ?? []).includes(packageName)
  const target = linkTarget(linkPath)
  console.log(`profile      ${profileDir}`)
  console.log(`本仓库       ${repo}`)
  console.log(`依赖声明     ${dependency ?? '<缺失>'}`)
  console.log(`bundle 启用  ${enabled ? '是' : '否'}`)
  console.log(`node_modules ${target ?? '<缺失>'}`)
  return { dependency, enabled, target }
}

if (existsSync(manifestPath) === false) {
  console.error(`找不到 profile manifest：${manifestPath}`)
  process.exitCode = 1
  process.exit()
}

const manifest = readManifest()

if (mode === 'status') {
  report(manifest)
  process.exit()
}

if (mode === 'uninstall') {
  const before = report(manifest)
  let changed = false

  if (before.dependency !== undefined) {
    delete manifest.dependencies[packageName]
    changed = true
  }
  const bundles = manifest.dsh?.profile?.bundles
  if (Array.isArray(bundles) && bundles.includes(packageName)) {
    manifest.dsh.profile.bundles = bundles.filter((name) => name !== packageName)
    changed = true
  }
  if (changed) {
    const backup = `${manifestPath}.bak-${new Date().toISOString().replace(/[:.]/gu, '-')}-${packageName}`
    copyFileSync(manifestPath, backup)
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
    console.log(`已从 manifest 精准移除（备份：${backup}）`)
  } else {
    console.log('manifest 里本来就没有本插件，未改动')
  }
  if (before.target !== undefined) {
    removeJunction(linkPath)
    console.log('已删除 node_modules 目录链接')
  }
  console.log('\n卸载完成。重启 DSH Desktop 后生效。')
  process.exit()
}

// ── 安装（幂等）───────────────────────────────────────────────────
const backup = `${manifestPath}.bak-${new Date().toISOString().replace(/[:.]/gu, '-')}-${packageName}`
copyFileSync(manifestPath, backup)
console.log(`已备份 manifest：${backup}\n`)

manifest.dependencies ??= {}
manifest.dependencies[packageName] = `link:${repo}`
manifest.dsh ??= {}
manifest.dsh.profile ??= {}
manifest.dsh.profile.bundles ??= []
if (manifest.dsh.profile.bundles.includes(packageName) === false) {
  manifest.dsh.profile.bundles.push(packageName)
}
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

const existing = linkTarget(linkPath)
if (existing !== repo) {
  if (existing !== undefined) removeJunction(linkPath)
  symlinkSync(repo, linkPath, 'junction')
}

console.log('── 安装后状态 ──')
const after = report(readManifest())
const ok = after.dependency === `link:${repo}` && after.enabled === true && after.target === repo
console.log(`\n结果：${ok ? '就绪' : '不完整（见上）'}`)

console.log('\n下一步（必须）：**完全退出并重开 DSH Desktop** —— 实测 HMR 从不热装载插件行。')
console.log('重启后验证：在侧栏对一个对话点「分叉会话」，新会话标题应为「⤷ 来源：<源会话标题>」。')
console.log(`回滚：node .verify/install-desktop.mjs --uninstall`)
process.exitCode = ok ? 0 : 1
