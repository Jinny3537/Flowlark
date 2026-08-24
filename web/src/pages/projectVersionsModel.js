function versionNoOf(version) {
  return String(version.versionNo ?? version.no ?? '')
}

function timestampOf(version) {
  return String(version.createdAt ?? version.updatedAt ?? '')
}

function compareText(a, b) {
  if (a === b) return 0
  return a < b ? -1 : 1
}

function searchableText(version) {
  const requirements = (version.requirements || []).flatMap((requirement) => {
    if (typeof requirement === 'string') return [requirement]
    return [requirement.code, requirement.title]
  })

  return [
    version.versionNo,
    version.no,
    version.title,
    version.createdBy,
    version.updatedBy,
    ...(version.tags || []),
    ...requirements,
  ]
    .filter((value) => value != null)
    .map(String)
    .join(' ')
    .toLocaleLowerCase()
}

function compareNewest(a, b) {
  const timestampComparison = compareText(timestampOf(b), timestampOf(a))
  if (timestampComparison !== 0) return timestampComparison
  return compareText(versionNoOf(b), versionNoOf(a))
}

export function filterVersions(versions, { query = '', status = 'all', order = 'newest' } = {}) {
  const normalizedQuery = String(query).trim().toLocaleLowerCase()
  const filtered = versions.filter((version) => {
    const matchesQuery = !normalizedQuery || searchableText(version).includes(normalizedQuery)
    const matchesStatus = status === 'all' || version.display?.key === status
    return matchesQuery && matchesStatus
  })

  const direction = order === 'oldest' ? -1 : 1
  return filtered.sort((a, b) => direction * compareNewest(a, b))
}

export function adjacentVersionNo(versions, currentVersionNo, direction) {
  if (versions.length === 0) return null
  const currentIndex = versions.findIndex((version) => versionNoOf(version) === currentVersionNo)
  if (currentIndex === -1) return versionNoOf(versions[0])
  const nextIndex = Math.max(0, Math.min(versions.length - 1, currentIndex + direction))
  return versionNoOf(versions[nextIndex])
}
