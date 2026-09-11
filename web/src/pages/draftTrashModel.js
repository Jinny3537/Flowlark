const text = (value) => String(value || '').trim()
const lower = (value) => text(value).toLowerCase()

function withinDate(value, from, to) {
  const day = text(value).slice(0, 10)
  return (!from || day >= from) && (!to || day <= to)
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
