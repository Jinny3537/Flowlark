import {
  externalBindingMeta,
  prototypeProgressMeta,
  requirementStatusMeta,
} from './requirementLifecycleModel.js'

const text = (value) => String(value || '').trim()
const lower = (value) => text(value).toLowerCase()

export function requirementPayload(values) {
  const dueDate = values.dueDate && typeof values.dueDate.format === 'function'
    ? values.dueDate.format('YYYY-MM-DD')
    : ''
  return { ...values, dueDate }
}

export function projectRequirement(item = {}) {
  const milestones = (Array.isArray(item.milestones) ? item.milestones : [])
    .map((milestone) => typeof milestone === 'string' ? milestone : milestone?.name)
    .map(text)
    .filter(Boolean)
  return {
    ...item,
    lifecycle: requirementStatusMeta(item.status),
    prototypeProgress: prototypeProgressMeta(item.derivedStatus),
    milestoneMembership: { count: milestones.length, names: milestones },
    externalBinding: externalBindingMeta(item),
    source: item.external
      ? { value: 'pool', label: '需求池' }
      : { value: 'local', label: '本地' },
  }
}

export function filterRequirements(items = [], filters = {}) {
  const query = lower(filters.query)
  const lifecycle = text(filters.lifecycle || filters.status)
  const prototypeProgress = text(filters.prototypeProgress)
  const binding = text(filters.binding)
  const milestone = text(filters.milestone)
  return items.map(projectRequirement).filter((item) => {
    const haystack = lower([
      item.code, item.title, item.description, item.project, item.module,
      ...item.milestoneMembership.names,
    ].join(' '))
    return (!lifecycle || item.lifecycle.value === lifecycle)
      && (!prototypeProgress || item.prototypeProgress.value === prototypeProgress)
      && (!filters.project || item.project === filters.project)
      && (!filters.source || item.source.value === filters.source)
      && (!binding || item.externalBinding.state === binding)
      && (!milestone || item.milestoneMembership.names.includes(milestone))
      && (!query || haystack.includes(query))
  })
}
