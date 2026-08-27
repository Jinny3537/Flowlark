const text = (value) => String(value || '').trim()
const lower = (value) => text(value).toLowerCase()

function withinDate(value, from, to) {
  const day = text(value).slice(0, 10)
  return (!from || day >= from) && (!to || day <= to)
}

export function draftCounts(items = []) {
  return {
    attention: items.filter((item) => item.status === 'pending' || item.status === 'failed').length,
    failed: items.filter((item) => item.status === 'failed').length,
    archived: items.filter((item) => item.status === 'archived').length,
  }
}

export function filterDraftItems(items = [], filters = {}) {
  const needle = lower(filters.query)
  const view = filters.view || 'attention'
  return items.filter((item) => {
    const inView = view === 'all'
      || (view === 'attention' && ['pending', 'failed'].includes(item.status))
      || item.status === view
    const haystack = lower(`${item.title} ${item.filename}`)
    return inView
      && (!filters.project || item.project === filters.project)
      && (!needle || haystack.includes(needle))
      && withinDate(item.collectedAt, filters.dateFrom, filters.dateTo)
  }).sort((a, b) => {
    const priority = { failed: 0, pending: 1, archived: 2 }
    return (priority[a.status] ?? 9) - (priority[b.status] ?? 9)
      || text(b.collectedAt).localeCompare(text(a.collectedAt))
  })
}

export function filterTrashItems(items = [], filters = {}) {
  const needle = lower(filters.query)
  return items.filter((item) => {
    const haystack = lower(`${item.project} ${item.versionNo}`)
    return (!filters.project || item.project === filters.project)
      && (!needle || haystack.includes(needle))
      && withinDate(item.deletedAt, filters.dateFrom, filters.dateTo)
  }).sort((a, b) => text(b.deletedAt).localeCompare(text(a.deletedAt)))
}

export function draftSelection(items = [], selectedIds = []) {
  const selected = new Set(selectedIds)
  return items.reduce((out, item) => {
    if (!selected.has(item.id)) return out
    if (item.status === 'failed') out.failed.push(item.id)
    if (item.status === 'archived') out.archived.push(item.id)
    return out
  }, { failed: [], archived: [] })
}

export function restoreReasonLabel(reason) {
  return ({
    VERSION_EXISTS: '版本号已占用',
    PROJECT_NOT_FOUND: '项目不存在',
    TRASH_INCOMPLETE: '数据不完整',
  })[reason] || '可恢复'
}

export function patchQueueParams(current, patch) {
  const next = new URLSearchParams(current)
  Object.entries(patch).forEach(([key, value]) => {
    const normalized = text(value)
    if (normalized) next.set(key, normalized)
    else next.delete(key)
  })
  return next
}

export async function runQueueBatch(items, { run, skip = () => '', concurrency = 3 }) {
  const results = new Array(items.length)
  let cursor = 0
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++
      const item = items[index]
      const skipped = skip(item)
      if (skipped) {
        results[index] = { status: 'skipped', item, reason: skipped }
        continue
      }
      try {
        results[index] = { status: 'succeeded', item, value: await run(item) }
      } catch (error) {
        results[index] = { status: 'failed', item, reason: error instanceof Error ? error.message : String(error) }
      }
    }
  }
  const size = Math.max(1, Math.min(Number(concurrency) || 1, items.length || 1))
  await Promise.all(Array.from({ length: size }, () => worker()))
  return {
    results,
    succeeded: results.filter((item) => item.status === 'succeeded'),
    skipped: results.filter((item) => item.status === 'skipped'),
    failed: results.filter((item) => item.status === 'failed'),
  }
}
