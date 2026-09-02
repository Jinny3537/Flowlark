export const CHANGE_META = {
  ADD: { label: '新增', color: 'success' },
  MODIFY: { label: '修改', color: 'warning' },
  REMOVE: { label: '删除', color: 'error' }
}

export function previewUrl({ protocol, hostname, previewPort, slug, versionNo, offline = false, edit = false }) {
  const base = `${protocol}//${hostname}:${previewPort}/p/${encodeURIComponent(slug)}/${encodeURIComponent(versionNo)}`
  const params = new URLSearchParams()
  if (offline) params.set('offline', '1')
  if (edit) params.set('edit', '1')
  return params.size ? `${base}?${params}` : base
}

export function prototypeEditorRoute(slug, versionNo) {
  return `/projects/${encodeURIComponent(slug)}/versions/${encodeURIComponent(versionNo)}/edit`
}

export function canEditStructure({ canWrite, version, lockBaseline = true }) {
  if (!canWrite || !version?.display) return false
  if (version.display.key === 'VOID') return false
  return !lockBaseline || version.display.key === 'DRAFT'
}

export function baselineBlocked({ target, totalVersions, requireChangelog = true }) {
  return Boolean(requireChangelog && target && Number(target.changeCount || target.changes?.length || 0) === 0 && totalVersions > 1 && !target.baselineAt)
}

export function olderSiblings(versions, versionNo) {
  const index = versions.findIndex(item => item.versionNo === versionNo)
  return index < 0 ? [] : versions.slice(index + 1)
}

export function groupChanges(items = []) {
  return ['ADD', 'MODIFY', 'REMOVE']
    .map(type => ({ type, meta: CHANGE_META[type], items: items.filter(item => item.type === type) }))
    .filter(group => group.items.length)
}

export function filterVersionFeedback(items = [], project, version) {
  return items.filter(item => item.project === project && item.version === version)
}

export function requirementUrl(code, fallback, template) {
  if (fallback) return fallback
  return template ? template.replace('{code}', encodeURIComponent(code)) : ''
}

export function encodeAnchor(anchor) {
  const bytes = new TextEncoder().encode(JSON.stringify(anchor))
  let raw = ''
  for (const byte of bytes) raw += String.fromCharCode(byte)
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function decodeAnchor(value) {
  if (!value) return null
  try {
    const normalized = String(value).replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const raw = atob(padded)
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, char => char.charCodeAt(0))))
  } catch {
    return null
  }
}
