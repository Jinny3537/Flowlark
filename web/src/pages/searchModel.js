export function normalizeWorkspaceResults(items = []) {
  return items.map(item => ({
    ...item,
    objectType: item.objectType || item.type,
    fieldLabel: item.fieldLabel || item.workspaceName || item.name || ''
  }))
}

export function resultRoute(item) {
  if (item.objectType === 'requirement') {
    const code = item.requirementCode || item.code
    return code ? `/requirements/${encodeURIComponent(code)}` : ''
  }
  if (item.objectType === 'milestone') {
    const name = item.milestoneName || item.name
    return name ? `/milestones/${encodeURIComponent(name)}` : ''
  }
  if (item.objectType === 'version') {
    if (item.project && item.versionNo) return `/projects/${encodeURIComponent(item.project)}/versions/${encodeURIComponent(item.versionNo)}`
    return item.project ? `/projects/${encodeURIComponent(item.project)}` : ''
  }
  if (item.project) return `/projects/${encodeURIComponent(item.project)}`
  return ''
}
