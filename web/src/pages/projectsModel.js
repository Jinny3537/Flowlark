export const PROJECT_PRIORITIES = ['P0', 'P1', 'P2', 'P3']
export const PROJECT_CODE_RE = /^[A-Z0-9]{1,40}$/
export const DEFAULT_RELEASE_SUBJECT = '【发版】{{project}} {{version}}'
export const DEFAULT_RELEASE_BODY = '# {{project}} {{version}}\n\n## 版本说明\n\n{{title}}\n\n## 变更摘要\n\n{{changes}}\n\n## 关联需求\n\n{{requirements}}\n\n---\n\n发布人：{{releasedBy}}  \n发布时间：{{releasedAt}}'

function names(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))]
}

export function releaseMailValues(input = {}) {
  return {
    enabled: input.enabled === true,
    to: names(input.to),
    cc: names(input.cc),
    subjectTemplate: input.subjectTemplate || DEFAULT_RELEASE_SUBJECT,
    bodyTemplate: input.bodyTemplate || DEFAULT_RELEASE_BODY,
  }
}

export function filterProjects(items = [], { query = '', priority = '', archived = 'all' } = {}) {
  const needle = String(query || '').trim().toLowerCase()
  return items.filter((item) => {
    const haystack = `${item.name || ''} ${item.code || ''}`.toLowerCase()
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
    archived: project?.archived === true,
    releaseMail: releaseMailValues(project?.releaseMail),
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
    archived: values.archived === true,
    releaseMail: releaseMailValues(values.releaseMail),
  }
}
