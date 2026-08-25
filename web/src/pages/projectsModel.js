export const PROJECT_PRIORITIES = ['P0', 'P1', 'P2', 'P3']
export const PROJECT_CODE_RE = /^[A-Z0-9]{1,40}$/

export function filterProjects(items = [], { query = '', priority = '', archived = 'all' } = {}) {
  const needle = String(query || '').trim().toLowerCase()
  return items.filter((item) => {
    const haystack = `${item.name || ''} ${item.code || ''} ${item.description || ''}`.toLowerCase()
    return (!needle || haystack.includes(needle))
      && (!priority || item.priority === priority)
      && (archived === 'all' || (archived === 'archived' ? item.archived === true : item.archived !== true))
  })
}

export function initialProjectValues(project = null) {
  return {
    name: project?.name || '',
    code: project?.code || '',
    description: project?.description || '',
    priority: project?.priority || undefined,
    archived: project?.archived === true
  }
}

export function isProjectCodeAllowed(value, original = '') {
  const code = String(value || '').trim()
  return code === String(original || '').trim() || PROJECT_CODE_RE.test(code)
}

export function projectPayload(values) {
  return {
    name: String(values.name || '').trim(),
    code: String(values.code || '').trim(),
    description: String(values.description || ''),
    priority: values.priority || '',
    archived: values.archived === true
  }
}
