/**
 * 外链检测。
 *
 * AI 生成的单文件原型通常内联样式但引用 CDN（Tailwind、ECharts、Google Fonts）。
 * 本地形态下这个问题比内网服务器时更轻 —— 开发者的机器一般能出网 —— 但断网、
 * 上高铁、公司代理拦截时仍会掉样式，而用户的第一反应永远是「这工具坏了」。
 * 提前说清楚比事后解释便宜。
 *
 * 只做提示，不改写文件：自动本地化明确在「不做」范围内。
 */

const EXTERNAL_URL = /(?:src|href)\s*=\s*["'](https?:\/\/[^"'\s]+)["']/gi

/** 外链几乎都在 <head> 与文件前部，全文扫描对大文件是浪费 */
const SCAN_LIMIT = 512 * 1024
const MAX_REFS = 50

export function detectExternalRefs(htmlBuffer) {
  const head = Buffer.isBuffer(htmlBuffer)
    ? htmlBuffer.subarray(0, SCAN_LIMIT).toString('utf8')
    : String(htmlBuffer).slice(0, SCAN_LIMIT)

  const found = new Set()
  EXTERNAL_URL.lastIndex = 0
  let m
  while ((m = EXTERNAL_URL.exec(head)) !== null && found.size < MAX_REFS) {
    found.add(m[1])
  }
  return [...found]
}

/** 把外链按域名归组，终端里显示更紧凑 */
export function groupRefsByHost(refs) {
  const map = new Map()
  for (const r of refs) {
    let host = r
    try {
      host = new URL(r).host
    } catch {
      /* 非法 URL 原样归组 */
    }
    map.set(host, (map.get(host) || 0) + 1)
  }
  return [...map.entries()].map(([host, count]) => ({ host, count }))
}
