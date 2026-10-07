/**
 * 搭一套**自包含**的 GUI 验证环境（不碰用户 `~/.dsh`、不动 desktop）：
 *
 *   <repo>/.verify/gui/home/                  ← 临时 DSH_HOME
 *     profiles/node_modules  → junction 到用户真实的 profiles/node_modules
 *                              （只为解析 `@deepseek-ai/*` 这些官方包）
 *     profiles/gui/          ← 临时 web profile
 *       package.json         ← bundles: dsh-base + dsh-web-app + 本插件 + 夹具
 *       cordis.yml           ← 空条目表（组合全部来自各 bundle 的 patch）
 *       node_modules/        ← 本插件与夹具的目录链接
 *
 * 幂等：重复跑会重建 profile 的清单与链接。
 *
 * 用法：node .verify/gui/setup.mjs
 */

import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../../', import.meta.url)).replace(/[\\/]$/u, '')
const guiDir = join(repo, '.verify', 'gui')
const home = join(guiDir, 'home')
const profilesDir = join(home, 'profiles')
const profileDir = join(profilesDir, 'gui')
const fixtureDir = join(guiDir, 'fixture')

const PACKAGE = 'dsh-plugin-branch-origin'
const FIXTURE = 'branch-origin-gui-fixture'

const sharedModules = join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'node_modules')
if (existsSync(join(sharedModules, '@deepseek-ai', 'dsh-web-app')) === false) {
  console.error(`找不到官方包锚点：${sharedModules}`)
  process.exitCode = 1
  process.exit()
}

/** 建目录链接；已存在就先删（`rmdir` 不带 `/s`，避免顺着链接删掉目标内容）。 */
function link(target, path) {
  if (existsSync(path)) rmSync(path, { recursive: false, force: true })
  mkdirSync(join(path, '..'), { recursive: true })
  symlinkSync(target, path, 'junction')
}

mkdirSync(profilesDir, { recursive: true })
mkdirSync(profileDir, { recursive: true })

// 官方包只读锚点（指向用户真实目录，但只用来解析，不写它）
link(sharedModules, join(profilesDir, 'node_modules'))

const manifest = {
  name: 'dsh-profile-gui',
  private: true,
  dependencies: {
    [PACKAGE]: `link:${repo}`,
    [FIXTURE]: `link:${fixtureDir}`,
  },
  dsh: {
    profile: {
      bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', PACKAGE, FIXTURE],
    },
  },
}
writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

const rootConfig = readFileSync(join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'trial', 'cordis.yml'), 'utf8')
writeFileSync(join(profileDir, 'cordis.yml'), rootConfig)

link(repo, join(profileDir, 'node_modules', PACKAGE))
link(fixtureDir, join(profileDir, 'node_modules', FIXTURE))

console.log(`DSH_HOME      ${home}`)
console.log(`profile       ${profileDir}`)
console.log(`bundles       ${manifest.dsh.profile.bundles.join(', ')}`)
console.log(`本插件        ${join(profileDir, 'node_modules', PACKAGE)}`)
console.log(`夹具          ${join(profileDir, 'node_modules', FIXTURE)}`)
