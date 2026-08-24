import { marked } from 'marked'
import DOMPurify from 'dompurify'

export function fmtTime(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return '刚刚'
  if (min < 60) return `${min} 分钟前`
  if (min < 1440) return `${Math.floor(min / 60)} 小时前`
  if (min < 10080) return `${Math.floor(min / 1440)} 天前`
  return fmtAbsolute(iso)
}

export function fmtAbsolute(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

export function fmtSize(bytes) {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

/**
 * 规格书是团队内部手写的 Markdown，但仍然过一遍 DOMPurify。
 * 沙箱只保护了原型 iframe，保护不了工作台自己 —— 规格书渲染在工作台的同源上下文里，
 * 一段被粘贴进来的 <script> 拿到的权限和工作台一样大。
 */
export function renderMarkdown(md) {
  if (!md) return ''
  return DOMPurify.sanitize(marked.parse(md, { gfm: true, breaks: true }))
}

export const CHANGE_META = {
  ADD: { label: '新增', color: 'green' },
  MODIFY: { label: '修改', color: 'gold' },
  REMOVE: { label: '删除', color: 'red' }
}

export function groupChanges(items) {
  return ['ADD', 'MODIFY', 'REMOVE']
    .map((type) => ({ type, meta: CHANGE_META[type], items: items.filter((i) => i.type === type) }))
    .filter((g) => g.items.length > 0)
}
