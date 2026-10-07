/**
 * 客户端半边的**静态预检**：装作 `dsh-client-modules` 去看一眼我们这个包会不会被认成
 * 客户端包、会不会在组合期抛错。
 *
 * 依据是本机官方源码 `dsh-client-modules/lib/index.js`：
 *   - `parseDshClient()`（:61-75）对 `dsh.client` 的校验规则；
 *   - `resolveMeta()`（:713-728）的判定顺序与**会抛错的那一条**：
 *     `decl.platform !== 'web'` ⇒ 直接当非客户端包；声明了 `dsh.client` 却
 *     `exports` 里没有 `./client` ⇒ **抛错**（这正是"全有或全无"会拖垮整个 GUI 客户端的入口）。
 *
 * 官方没有导出 `parseDshClient`，所以这里**复刻**了同一套规则与同一句错误文案 ——
 * 它是预检，不是官方函数本身。
 *
 * 只读。用法：node .verify/check-client-manifest.mjs
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repo = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/u, '')
const packageName = 'dsh-plugin-branch-origin'
const profileDir = process.env.DSH_PROFILE_DIR
  ?? join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop')

const checks = []
const check = (name, ok, detail) => {
  checks.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`)
}

/** 复刻 dsh-client-modules/lib/index.js:61-75。 */
function parseDshClient(pkgName, value) {
  if (value === undefined) return undefined
  if (typeof value !== 'object' || value === null) throw new Error(`client-modules: ${pkgName} has a non-object dsh.client declaration`)
  const decl = value
  if (typeof decl.platform !== 'string') throw new Error(`client-modules: ${pkgName} dsh.client.platform must be a string`)
  const stringArray = (field, subject) => {
    if (subject === undefined) return undefined
    if (Array.isArray(subject) === false || subject.some((item) => typeof item !== 'string')) {
      throw new Error(`client-modules: ${pkgName} ${field} must be a string array`)
    }
    return subject
  }
  const inject = stringArray('dsh.client.inject', decl.inject)
  const external = stringArray('dsh.client.external', decl.external)
  if (decl.immediately !== undefined && typeof decl.immediately !== 'boolean') {
    throw new Error(`client-modules: ${pkgName} dsh.client.immediately must be a boolean`)
  }
  return {
    platform: decl.platform,
    ...(inject === undefined ? {} : { inject }),
    ...(external === undefined ? {} : { external }),
    ...(decl.immediately === undefined ? {} : { immediately: decl.immediately }),
  }
}

/** 复刻 `clientExportOf`：从 exports 映射里取出 `./client` 相对路径。 */
function clientExportOf(exportsField) {
  if (exportsField === undefined || exportsField === null) return undefined
  const entry = typeof exportsField === 'string' ? undefined : exportsField['./client']
  if (entry === undefined) return undefined
  if (typeof entry === 'string') return entry
  return entry.default ?? entry.import ?? entry.require
}

/** 对一个 package.json 走一遍官方判定顺序。 */
function inspect(label, manifestPath) {
  console.log(`\n── ${label} ──\n${manifestPath}`)
  if (existsSync(manifestPath) === false) {
    check(`${label}：manifest 存在`, false, manifestPath)
    return
  }
  const pkg = JSON.parse(readFileSync(manifestPath, 'utf8'))
  check(`${label}：name 逐字等于包名`, pkg.name === packageName, { name: pkg.name })

  let decl
  try {
    decl = parseDshClient(pkg.name, pkg.dsh && pkg.dsh.client)
  } catch (error) {
    check(`${label}：dsh.client 通过官方校验`, false, String(error.message))
    return
  }
  check(`${label}：dsh.client 通过官方校验`, true)
  check(`${label}：platform === 'web'`, decl !== undefined && decl.platform === 'web', decl)

  const clientRel = clientExportOf(pkg.exports)
  check(`${label}：exports 声明了 './client'（否则官方会在组合期抛错）`, clientRel !== undefined, { clientRel })
  if (clientRel === undefined) return

  const clientPath = resolve(dirname(manifestPath), clientRel)
  check(`${label}：./client 指向的文件存在`, existsSync(clientPath), { clientPath })

  if (existsSync(clientPath)) {
    const source = readFileSync(clientPath, 'utf8')
    const idMatches = source.includes(`id: '${packageName}'`) || source.includes(`id: "${packageName}"`)
    check(`${label}：client.js 用包名逐字注册（__ModuleLoader__.load 的 id）`, idMatches)
    check(`${label}：client.js 有全有或全无的保护（apply 外层 try/catch）`, source.includes('client half failed to apply'))
  }
}

inspect('本仓库', join(repo, 'package.json'))
inspect('desktop profile 里的安装副本（走目录链接读到的就是同一份）', join(profileDir, 'node_modules', packageName, 'package.json'))

const failed = checks.filter((item) => item.ok === false)
console.log(`\n结果：${checks.length - failed.length}/${checks.length} 通过`)
process.exitCode = failed.length === 0 ? 0 : 1
