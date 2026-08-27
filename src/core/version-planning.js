import { detectExternalRefs } from './scan.js'
import { VERSION_NO_RE } from './store.js'

const CHANGE_LABELS = {
  ADD: '新增',
  MODIFY: '修改',
  REMOVE: '删除'
}

function versionNoOf(version) {
  return String(version?.versionNo || version?.no || '')
}

function normalizedChangeType(value) {
  const key = String(value || '').trim().toUpperCase()
  if (['ADD', '新增', 'A', '+'].includes(key)) return 'ADD'
  if (['REMOVE', '删除', 'DEL', 'R', '-'].includes(key)) return 'REMOVE'
  return 'MODIFY'
}

function validChanges(items) {
  return (Array.isArray(items) ? items : []).filter((item) => String(item?.content || item?.description || '').trim())
}

function validRequirements(items) {
  return (Array.isArray(items) ? items : []).filter((item) => {
    const code = typeof item === 'string' ? item : item?.code
    return String(code || '').trim()
  })
}

function issue(code, field, message) {
  return { code, field, message }
}

function markdownText(value) {
  return String(value == null ? '' : value)
    .replaceAll('|', '\\|')
    .replaceAll('\r', '')
    .replaceAll('\n', ' ')
    .trim()
}

export function suggestVersionNo(value) {
  const match = /^v(\d+(?:\.\d+)*)$/i.exec(String(value || '').trim())
  if (!match) return ''
  const parts = match[1].split('.').map(Number)
  parts[parts.length - 1] += 1
  return `v${parts.join('.')}`
}

export function preflightVersion({
  html = '',
  versionNo = '',
  title = '',
  changes = [],
  requirements = [],
  existingVersionNos = [],
  maxFileBytes = Infinity,
  impacts = [],
  canWrite = true,
  gitKnown = true
} = {}) {
  const source = String(html || '')
  const size = Buffer.byteLength(source, 'utf8')
  const externalRefs = source ? detectExternalRefs(source) : []
  const no = String(versionNo || '').trim()
  const name = String(title || '').trim()
  const normalizedExisting = new Set((existingVersionNos || []).map((item) => String(item)))
  const normalizedChanges = validChanges(changes)
  const normalizedRequirements = validRequirements(requirements)
  const blockers = []
  const warnings = []

  if (!source.trim()) blockers.push(issue('FILE_REQUIRED', 'html', '请先提供有效的原型 HTML'))
  if (size > Number(maxFileBytes || Infinity)) {
    blockers.push(issue('FILE_TOO_LARGE', 'html', `原型文件超过 ${maxFileBytes} 字节上限`))
  }
  if (!no) blockers.push(issue('VERSION_NO_REQUIRED', 'versionNo', '请填写版本号'))
  else if (!VERSION_NO_RE.test(no)) blockers.push(issue('VERSION_NO_INVALID', 'versionNo', '版本号格式不合法'))
  if (no && normalizedExisting.has(no)) blockers.push(issue('VERSION_EXISTS', 'versionNo', `版本号「${no}」已存在`))
  if (!name) blockers.push(issue('TITLE_REQUIRED', 'title', '请填写版本标题'))
  if (normalizedExisting.size > 0 && normalizedChanges.length === 0) {
    blockers.push(issue('CHANGELOG_REQUIRED', 'changes', '请至少填写一条有效变更'))
  }

  if (externalRefs.length) {
    warnings.push(issue('EXTERNAL_REFS', 'html', `检测到 ${externalRefs.length} 个外部依赖，离线时可能不完整`))
  }
  if (normalizedRequirements.length === 0) {
    warnings.push(issue('REQUIREMENTS_EMPTY', 'requirements', '当前版本没有关联需求'))
  }
  if ((impacts || []).length) {
    warnings.push(issue('HISTORICAL_IMPACT', 'changes', `发现 ${impacts.length} 条历史影响关联`))
  }
  if (canWrite === false) warnings.push(issue('READ_ONLY', 'workspace', '当前工作区为只读模式'))
  if (gitKnown === false) warnings.push(issue('GIT_UNKNOWN', 'git', '当前 Git 远端状态未知'))

  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    inspection: {
      size,
      externalRefs,
      changeCount: normalizedChanges.length,
      requirementCount: normalizedRequirements.length
    }
  }
}

export function previousBaseline(versions = [], baselineNo = '', history = []) {
  const available = new Map((versions || []).map((version) => [versionNoOf(version), version]))
  const usableHistory = []
  const seen = new Set()
  for (const item of Array.isArray(history) ? history : []) {
    const no = String(item?.versionNo || '')
    if (!no || no === baselineNo || seen.has(no) || !available.has(no)) continue
    seen.add(no)
    usableHistory.push(item)
  }
  if (usableHistory.length) {
    const item = usableHistory[0]
    return { version: available.get(item.versionNo), source: 'git', history: item }
  }

  const fallback = (versions || [])
    .filter((version) => versionNoOf(version) !== baselineNo && version?.baselineAt && version?.status !== 'VOID')
    .sort((a, b) => String(b.baselineAt).localeCompare(String(a.baselineAt)))[0]
  return fallback ? { version: fallback, source: 'local', history: null } : null
}

export function reviewSummary(versions = [], baselineNo = '') {
  const usable = (versions || []).filter((item) => item?.status !== 'VOID')
  const baselineIndex = usable.findIndex((item) => versionNoOf(item) === baselineNo)
  return {
    pending: usable.filter((item) => item.reviewStatus === 'pending' && versionNoOf(item) !== baselineNo).length,
    questions: usable.filter((item) => item.reviewStatus === 'questions').length,
    newerThanBaseline: baselineIndex < 0 ? usable.length : baselineIndex
  }
}

export function changeCounts(items = []) {
  const counts = { ADD: 0, MODIFY: 0, REMOVE: 0 }
  for (const item of Array.isArray(items) ? items : []) counts[normalizedChangeType(item?.type)] += 1
  return counts
}

export function traceMarkdown({ project = '', from = '', to = '', cumulative = {}, paths = {} } = {}) {
  const items = Array.isArray(cumulative.items) ? cumulative.items : []
  const counts = changeCounts(items)
  const requirements = [...new Set(items.map((item) => String(item?.requirement || '').trim()).filter(Boolean))]
  const grouped = ['ADD', 'MODIFY', 'REMOVE'].map((type) => {
    const entries = items.filter((item) => normalizedChangeType(item?.type) === type)
    if (!entries.length) return ''
    const lines = entries.map((item) => {
      const location = markdownText(item.location) || '未标注位置'
      const content = markdownText(item.content || item.description) || '未填写说明'
      const requirement = item.requirement ? ` (${markdownText(item.requirement)})` : ''
      return `- **${location}**：${content}${requirement}`
    })
    return `## ${CHANGE_LABELS[type]}\n\n${lines.join('\n')}`
  }).filter(Boolean)
  const pathLines = [
    paths.from ? `- 起始版本：${markdownText(paths.from)}` : '',
    paths.to ? `- 目标版本：${markdownText(paths.to)}` : ''
  ].filter(Boolean)

  return [
    `# ${markdownText(project) || '项目'} · ${markdownText(from) || '-'} → ${markdownText(to) || '-'}`,
    '',
    `覆盖 ${Number(cumulative.versionCount || 0)} 个版本，共 ${Number(cumulative.itemCount ?? items.length)} 条变更。`,
    '',
    `新增 ${counts.ADD} · 修改 ${counts.MODIFY} · 删除 ${counts.REMOVE}`,
    requirements.length ? `\n关联需求：${requirements.map(markdownText).join('、')}` : '',
    grouped.length ? `\n${grouped.join('\n\n')}` : '\n没有可展示的变更。',
    pathLines.length ? `\n## 版本路径\n\n${pathLines.join('\n')}` : ''
  ].filter((item) => item !== '').join('\n').trim() + '\n'
}
