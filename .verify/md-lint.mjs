/**
 * Markdown 结构 lint：抓的是"源文件看着没问题、渲染出来却不是你想的样子"的几类坑。
 *
 * 覆盖规则（都是本仓库真实踩过的）：
 *   1. 表格必须有「表头 + |---| 分隔行」，且表内各行**列数一致**（单元格里的竖线要写成 `\|`，
 *      反引号**不**保护竖线 —— A-27 行曾因此多出第 6 列）。
 *   2. 表格 / 代码围栏**前面必须有空行**，否则不会被当成表格/围栏。
 *   3. 代码围栏必须成对（成对的 ``` 才算）。
 *   4. 行内代码的反引号必须成对（否则后面一大段都会被染成代码）。
 *   5. 标题不跳级（h1 → h3 会让人以为漏了一节）。
 *   6. **段落合并**：GFM 会把连续的非空行并成一段。因此"一行一条"的标签块
 *      （`结果：…` / `证据文件：…` / `**目的**：…` / `**V16**（…）`）必须写成列表项 `- …`，
 *      或之间留空行；否则会挤成一堵墙（ASSUMPTIONS 头部曾这样）。
 *      注：有序列表项（`1. …`）与无序列表项（`- …`）都算"已分隔"，不报。
 *
 * 用法：node .verify/md-lint.mjs            # 检查根目录两份 + docs/*.md，有问题退出码 1
 *      node .verify/md-lint.mjs 文件...     # 只检查指定文件
 */

import { readdirSync, readFileSync } from 'node:fs'

const root = process.cwd()
const files = process.argv.length > 2
  ? process.argv.slice(2)
  : ['AGENTS.md', 'README.md', ...readdirSync('docs').filter((n) => n.endsWith('.md')).map((n) => `docs/${n}`)]

const SERIES = /^\*\*V\d+/
const BOLD_LABEL = /^\*\*[^*]{1,24}\*\*[：:]/
const PLAIN_LABEL = /^[^\s|#>!+*`-]{1,14}：/

/** 是不是"一行一条"的标签行（列表项 / 标题 / 表格 / 引用 / 缩进行都不算）。 */
function isLabel(line) {
  if (!line.trim() || /^\s/.test(line)) return false
  if (/^[#>|]/.test(line)) return false
  if (/^[-*+]\s/.test(line) || /^\d+\.\s/.test(line)) return false
  return SERIES.test(line) || BOLD_LABEL.test(line) || PLAIN_LABEL.test(line)
}

/**
 * 这一行是否有**未闭合的行内代码**（反引号跨度必须成对且同长）。
 * 不用"数反引号个数是否为偶数"这种粗暴办法 —— 合法写法 ``` `` ``` `` ```（外层双反引号包住三反引号）
 * 的反引号总数就是奇数。
 */
function hasUnclosedCodeSpan(line) {
  let i = 0
  while (i < line.length) {
    if (line[i] !== '`') {
      i++
      continue
    }
    let run = 0
    while (line[i + run] === '`') run++
    let j = i + run
    let closed = false
    while (j < line.length) {
      if (line[j] === '`') {
        let other = 0
        while (line[j + other] === '`') other++
        if (other === run) {
          closed = true
          j += other
          break
        }
        j += other
      } else {
        j++
      }
    }
    if (!closed) return true
    i = j
  }
  return false
}

function lint(file) {
  const lines = readFileSync(file, 'utf8').split('\n')
  const issues = []
  const add = (n, rule, extra = '') => issues.push({ line: n, rule, extra })

  let inFence = false
  let fenceStart = 0
  let inTable = false
  let columns = 0
  let prevLevel = 0

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const prev = i > 0 ? lines[i - 1] : ''

    if (/^\s*```/.test(line)) {
      if (!inFence) {
        fenceStart = i + 1
        if (prev.trim() !== '') add(i + 1, '围栏前缺空行')
        inFence = true
      } else {
        inFence = false
      }
      inTable = false
      continue
    }
    if (inFence) continue

    const heading = line.match(/^(#{1,6})\s/)
    if (heading) {
      const level = heading[1].length
      if (prevLevel > 0 && level > prevLevel + 1) add(i + 1, `标题跳级 h${prevLevel} → h${level}`)
      prevLevel = level
    }

    if (/^\s*\|/.test(line)) {
      const pipes = (line.replace(/\\\|/g, '')).split('').filter((c) => c === '|').length
      if (!inTable) {
        inTable = true
        columns = pipes
        if (prev.trim() !== '') add(i + 1, '表格前缺空行')
        if (!/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) add(i + 1, '表格缺表头分隔行（|---|）')
      } else if (pipes !== columns) {
        add(i + 1, `表格列数 ${pipes} ≠ 本表 ${columns}（单元格里的竖线要写成 \\|）`)
      }
    } else if (inTable && line.trim() !== '') {
      inTable = false
    }

    if (hasUnclosedCodeSpan(line)) add(i + 1, '行内代码未闭合（反引号跨度不成对）')

    if (!line.startsWith('- ') && isLabel(line)) {
      if (isLabel(prev)) add(i + 1, '标签行紧跟标签行（会被并成一段）')
      else if (prev.trim() !== '' && !/^\s*\|/.test(prev) && !/^[#>]/.test(prev) && !/^[-*+]\s/.test(prev) && !/^\d+\.\s/.test(prev) && !/^\s*```/.test(prev)) {
        add(i + 1, '标签行紧跟正文（会被并成一段）')
      }
    }
  }

  if (inFence) issues.push({ line: fenceStart, rule: '代码围栏未闭合' })
  return issues
}

let count = 0
for (const file of files) {
  let issues
  try {
    issues = lint(file)
  } catch (error) {
    console.error(`!! ${file}: ${error.message}`)
    process.exitCode = 1
    continue
  }
  if (issues.length === 0) {
    console.log(`OK   ${file}`)
    continue
  }
  count += issues.length
  process.exitCode = 1
  console.log(`### ${file}`)
  for (const issue of issues) console.log(`  L${issue.line}: ${issue.rule}`)
}

console.log(`\n=== ${count === 0 ? '未发现结构问题' : `${count} 处结构问题`}（${files.length} 个文件）===`)
