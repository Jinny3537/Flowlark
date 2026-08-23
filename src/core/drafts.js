import { err } from './errors.js'

const CHANGE_LIMIT = 12

function strip(value) {
  return String(value || '')
    .replace(/<script\b[\s\S]*?<\/script\s*>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
}

function tokens(html) {
  const seen = new Set()
  const out = []
  for (const part of strip(html).split(/\s+/)) {
    const text = part.trim()
    if (text.length < 2 || text.length > 80) continue
    if (/^[{}()[\].,;:]+$/.test(text)) continue
    const key = text.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(text)
  }
  return out
}

function guessLocation(text) {
  if (/按钮|提交|确认|取消|保存|button|submit/i.test(text)) return '操作按钮'
  if (/筛选|搜索|查询|filter|search/i.test(text)) return '筛选区'
  if (/列表|表格|字段|列|table|list/i.test(text)) return '列表区'
  if (/弹窗|抽屉|modal|drawer/i.test(text)) return '弹窗'
  if (/导航|菜单|tab|页签/i.test(text)) return '导航'
  return '页面内容'
}

function summarize(items, type) {
  return items.slice(0, CHANGE_LIMIT).map((text) => ({
    type,
    location: guessLocation(text),
    content: type === 'ADD' ? `新增「${text}」` : `移除「${text}」`,
    requirement: ''
  }))
}

export function draftFromHtml({ beforeHtml, afterHtml, title = '', requirements = [] }) {
  const before = tokens(beforeHtml)
  const after = tokens(afterHtml)
  if (!after.length) throw err.bad('DRAFT_HTML_EMPTY', '新版 HTML 没有可分析的文本内容')
  const beforeSet = new Set(before.map((x) => x.toLowerCase()))
  const afterSet = new Set(after.map((x) => x.toLowerCase()))
  const added = after.filter((x) => !beforeSet.has(x.toLowerCase()))
  const removed = before.filter((x) => !afterSet.has(x.toLowerCase()))
  const changes = [...summarize(added, 'ADD'), ...summarize(removed, 'REMOVE')].slice(0, CHANGE_LIMIT)
  if (!changes.length) {
    changes.push({ type: 'MODIFY', location: '页面内容', content: '替换原型文件，文本结构未发现明显变化', requirement: '' })
  }

  const reqLines = (requirements || [])
    .map((item) => typeof item === 'string' ? item : item.code)
    .filter(Boolean)
    .map((code) => `- ${code}`)
  const spec = [
    `# ${title || '版本规格草稿'}`,
    '',
    '## 关联需求',
    reqLines.length ? reqLines.join('\n') : '- 待补充',
    '',
    '## 变更摘要',
    ...changes.map((item) => `- ${item.type} · ${item.location}：${item.content}`),
    '',
    '## 验收要点',
    '- 核对新增和移除的页面文案是否符合预期。',
    '- 核对关联需求、变更日志和原型内容是否一致。',
    '- 定稿前补充边界条件、异常状态和权限说明。'
  ].join('\n')

  return {
    engine: 'local-heuristic',
    confidence: changes.length > 1 ? 'medium' : 'low',
    changes,
    spec,
    stats: { beforeTokens: before.length, afterTokens: after.length, added: added.length, removed: removed.length }
  }
}

