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
