function versionNoOf(version) {
  return String(version?.versionNo || version?.no || '')
}

export function comparisonDefaults(versions, baseline, a, b) {
  const available = new Set(versions.map(versionNoOf).filter(Boolean))
  const requestedLeft = available.has(a) ? a : ''
  const baselineLeft = available.has(baseline) ? baseline : ''
  const left = requestedLeft || baselineLeft || versionNoOf(versions[0])
  const requestedRight = available.has(b) ? b : ''
  const right = requestedRight || versionNoOf(versions.find((item) => versionNoOf(item) !== left)) || left
  return { a: left, b: right }
}

export function orderedRange(versions, a, b) {
  const ia = versions.findIndex((item) => versionNoOf(item) === a)
  const ib = versions.findIndex((item) => versionNoOf(item) === b)
  if (ia < 0 || ib < 0) return { older: a, newer: b }
  return ia > ib ? { older: a, newer: b } : { older: b, newer: a }
}

export function normalizeSystemUrl(value, protocol) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const input = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${protocol}//${raw}`
  try {
    const url = new URL(input)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || /\s/.test(url.hostname)) return ''
    return url.href
  } catch {
    return ''
  }
}

export function comparisonQuery({ mode, a, b, systemUrl, showChanges }) {
  const params = new URLSearchParams({ mode })
  if (a) params.set('a', a)
  if (mode === 'versions' && b) params.set('b', b)
  if (mode === 'system' && systemUrl) params.set('url', systemUrl)
  if (!showChanges) params.set('changes', '0')
  return params.toString()
}

function markdown(value) {
  return String(value == null ? '' : value)
    .replaceAll('|', '\\|')
    .replaceAll('\r', '')
    .replaceAll('\n', ' ')
    .trim()
}

function changeType(value) {
  const key = String(value || '').trim().toUpperCase()
  if (key === 'ADD' || key === '新增') return 'ADD'
  if (key === 'REMOVE' || key === '删除') return 'REMOVE'
  return 'MODIFY'
}

export function traceMarkdown({ project = '', from = '', to = '', cumulative = {}, paths = {} } = {}) {
  const items = Array.isArray(cumulative.items) ? cumulative.items : []
  const counts = items.reduce((value, item) => {
    value[changeType(item?.type)] += 1
    return value
  }, { ADD: 0, MODIFY: 0, REMOVE: 0 })
  const requirements = [...new Set(items.map((item) => String(item?.requirement || '').trim()).filter(Boolean))]
  const labels = { ADD: '新增', MODIFY: '修改', REMOVE: '删除' }
  const sections = ['ADD', 'MODIFY', 'REMOVE'].map((type) => {
    const group = items.filter((item) => changeType(item?.type) === type)
    if (!group.length) return ''
    return [
      `## ${labels[type]}`,
      '',
      ...group.map((item) => {
        const requirement = item.requirement ? ` (${markdown(item.requirement)})` : ''
        return `- **${markdown(item.location) || '未标注位置'}**：${markdown(item.content || item.description) || '未填写说明'}${requirement}`
      }),
    ].join('\n')
  }).filter(Boolean)
  const output = [
    `# ${markdown(project) || '项目'} · ${markdown(from) || '-'} → ${markdown(to) || '-'}`,
    '',
    `覆盖 ${Number(cumulative.versionCount || 0)} 个版本，共 ${Number(cumulative.itemCount ?? items.length)} 条变更。`,
    '',
    `新增 ${counts.ADD} · 修改 ${counts.MODIFY} · 删除 ${counts.REMOVE}`,
  ]
  if (requirements.length) output.push('', `关联需求：${requirements.map(markdown).join('、')}`)
  if (sections.length) output.push('', sections.join('\n\n'))
  else output.push('', '没有可展示的变更。')
  if (paths.from || paths.to) {
    output.push('', '## 版本路径', '')
    if (paths.from) output.push(`- 起始版本：${markdown(paths.from)}`)
    if (paths.to) output.push(`- 目标版本：${markdown(paths.to)}`)
  }
  return output.join('\n').trim() + '\n'
}
