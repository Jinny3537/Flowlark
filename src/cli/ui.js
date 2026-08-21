/**
 * 终端输出。零依赖，自己处理颜色与对齐。
 *
 * 中文字符在终端里占两列，用 String.length 对齐表格会歪 —— 这是中文 CLI
 * 最常见的翻车点，所以宽度计算按显示宽度来。
 */

const useColor =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== 'dumb'

const ESC = '\u001b'
const wrap = (code) => (s) => (useColor ? `${ESC}[${code}m${s}${ESC}[0m` : String(s))

export const c = {
  bold: wrap(1),
  dim: wrap(2),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  magenta: wrap(35),
  cyan: wrap(36),
  gray: wrap(90)
}

/** 状态色与终端标记保持和网页端一致的语义 */
export function statusTag(display) {
  switch (display.key) {
    case 'BASELINE': return c.blue('● 基线')
    case 'DRAFT': return c.yellow('○ 草稿')
    case 'HISTORY': return c.gray('· 历史')
    case 'VOID': return c.red('✕ 废弃')
    default: return display.short
  }
}

/** 东亚宽字符按 2 列算 */
export function displayWidth(str) {
  let w = 0
  for (const ch of String(str)) {
    const code = ch.codePointAt(0)
    if (code >= 0x1100 && (
      code <= 0x115f ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6)
    )) w += 2
    else w += 1
  }
  return w
}

const ANSI = /\u001b\[[0-9;]*m/g

export function pad(str, width, align = 'left') {
  const s = String(str)
  const gap = Math.max(0, width - displayWidth(s.replace(ANSI, '')))
  return align === 'right' ? ' '.repeat(gap) + s : s + ' '.repeat(gap)
}

/**
 * @param {string[]} headers
 * @param {Array<Array<string>>} rows
 */
export function table(headers, rows, { aligns = [] } = {}) {
  if (rows.length === 0) return ''
  const widths = headers.map((h, i) =>
    Math.max(
      displayWidth(h),
      ...rows.map((r) => displayWidth(String(r[i] ?? '').replace(ANSI, '')))
    )
  )
  const line = (cells, dimmed) =>
    cells.map((cell, i) => pad(cell, widths[i], aligns[i])).join('  ').trimEnd()

  const out = [c.dim(line(headers))]
  for (const r of rows) out.push(line(r.map((x) => String(x ?? ''))))
  return out.join('\n')
}

export function heading(text) {
  return '\n' + c.bold(text)
}

export function kv(pairs, indent = '  ') {
  const width = Math.max(...pairs.map(([k]) => displayWidth(k)))
  return pairs
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => indent + c.dim(pad(k, width)) + '  ' + v)
    .join('\n')
}

export function fmtSize(bytes) {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const diff = Date.now() - d.getTime()
  const min = Math.floor(diff / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day < 7) return `${day} 天前`
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function ok(msg) { console.log(c.green('✓') + ' ' + msg) }
export function info(msg) { console.log(c.blue('ℹ') + ' ' + msg) }
export function warn(msg) { console.log(c.yellow('!') + ' ' + msg) }

/** 提示下一步该敲什么命令 —— CLI 工具的可学习性大半来自这个 */
export function next(...lines) {
  console.log('')
  for (const l of lines) console.log(c.dim('  → ') + l)
}
