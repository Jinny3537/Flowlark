export function validateHtmlFile(file, maxBytes) {
  if (!/\.html?$/i.test(String(file?.name || ''))) return '仅支持 .html 或 .htm 文件'
  if (Number(file?.size || 0) > Number(maxBytes || Infinity)) return `文件超过 ${formatBytes(maxBytes)} 上限`
  return ''
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function sourceSummary(html, externalRefs = []) {
  if (!html) return '尚未读取 HTML'
  const bytes = new TextEncoder().encode(html).byteLength
  return `${formatBytes(bytes)} · ${externalRefs.length ? `${externalRefs.length} 个外部依赖` : '无外部依赖'}`
}

export function inferVersionNo(name) {
  const match = String(name || '').replace(/\.html?$/i, '').match(/v?\d+(?:\.\d+){0,3}/i)
  if (!match) return ''
  return /^v/i.test(match[0]) ? match[0].toLowerCase() : `v${match[0]}`
}

export function suggestVersionNo(value) {
  const match = /^v(\d+(?:\.\d+)*)$/i.exec(String(value || '').trim())
  if (!match) return ''
  const parts = match[1].split('.').map(Number)
  parts[parts.length - 1] += 1
  return `v${parts.join('.')}`
}

export function nextVersionSuggestion(versions = [], sourceName = '') {
  const fromSource = inferVersionNo(sourceName)
  if (fromSource) return fromSource
  const latest = (versions || []).find((item) => item?.status !== 'VOID')
  return suggestVersionNo(latest?.versionNo || latest?.no || '')
}

export function applySuggestion(current, suggested, touched = false) {
  return touched || String(current || '').trim() ? current : suggested
}

export function buildBatchQueue(files = [], { maxBytes = Infinity, existingVersionNos = [] } = {}) {
  const existing = new Set((existingVersionNos || []).map(String))
  const seen = new Set()
  return Array.from(files || []).map((file, index) => {
    const suggestedVersionNo = inferVersionNo(file?.name)
    let error = validateHtmlFile(file, maxBytes)
    if (!error && suggestedVersionNo && existing.has(suggestedVersionNo)) {
      error = `版本号 ${suggestedVersionNo} 已存在`
    } else if (!error && suggestedVersionNo && seen.has(suggestedVersionNo)) {
      error = `批次内版本号 ${suggestedVersionNo} 重复`
    }
    if (suggestedVersionNo) seen.add(suggestedVersionNo)
    return {
      id: `batch-${index}-${String(file?.name || 'file')}`,
      file,
      name: String(file?.name || ''),
      title: String(file?.name || '').replace(/\.html?$/i, ''),
      suggestedVersionNo,
      versionNo: suggestedVersionNo,
      error,
      status: error ? 'failed' : 'pending'
    }
  })
}

export function reusableMetadata(version = {}) {
  return {
    requirements: Array.isArray(version.requirements) ? structuredClone(version.requirements) : [],
    tags: Array.isArray(version.tags) ? [...version.tags] : [],
    locations: [...new Set(
      (version.changes || []).map((item) => String(item?.location || '').trim()).filter(Boolean)
    )]
  }
}

function markdown(value) {
  return String(value == null ? '' : value).replaceAll('|', '\\|').replaceAll('\r', '').replaceAll('\n', ' ').trim()
}

function changeLabel(value) {
  const key = String(value || '').trim().toUpperCase()
  if (key === 'ADD' || key === '新增') return '新增'
  if (key === 'REMOVE' || key === '删除') return '删除'
  return '修改'
}

export function reviewMarkdown(result = {}) {
  const changes = Array.isArray(result.changes) ? result.changes : []
  const changeLines = changes.length
    ? changes.map((item) => `- ${changeLabel(item.type)} · ${markdown(item.location) || '未标注位置'}：${markdown(item.content) || '未填写说明'}`)
    : ['- 未记录变更']
  return [
    `# ${markdown(result.projectName || result.project) || '项目'} · ${markdown(result.versionNo)}`,
    '',
    markdown(result.title) || '未命名版本',
    '',
    `- 当前基线：${markdown(result.baselineVersionNo) || '未设置'}`,
    `- 关联需求：${Number(result.requirementCount || 0)} 条`,
    `- 评审状态：待评审`,
    `- 页面路径：${markdown(result.path) || '-'}`,
    '',
    '## 变更摘要',
    '',
    ...changeLines
  ].join('\n').trim() + '\n'
}

export function queueResultSummary(items = []) {
  return (items || []).reduce((summary, item) => {
    const status = ['created', 'failed'].includes(item?.status) ? item.status : 'pending'
    summary[status] += 1
    return summary
  }, { created: 0, failed: 0, pending: 0 })
}
