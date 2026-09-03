function versionNoOf(version) {
  return String(version?.versionNo ?? version?.no ?? '')
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

function requirementText(version) {
  return (version.requirements || []).flatMap((requirement) => {
    if (typeof requirement === 'string') return [requirement]
    return [requirement.code, requirement.title]
  }).filter(Boolean).map(String).join(' ').toLocaleLowerCase()
}

function compareNewest(a, b) {
  const timestampComparison = compareText(timestampOf(b), timestampOf(a))
  if (timestampComparison !== 0) return timestampComparison
  return compareText(versionNoOf(b), versionNoOf(a))
}

export function filterVersions(versions, {
  query = '', status = 'all', order = 'newest', author = '', requirement = '', external = false,
} = {}) {
  const normalizedQuery = String(query).trim().toLocaleLowerCase()
  const normalizedAuthor = String(author).trim().toLocaleLowerCase()
  const normalizedRequirement = String(requirement).trim().toLocaleLowerCase()
  const filtered = versions.filter((version) => {
    const matchesQuery = !normalizedQuery || searchableText(version).includes(normalizedQuery)
    const matchesStatus = status === 'all' || version.display?.key === status
    const authors = `${version.createdBy || ''} ${version.updatedBy || ''}`.toLocaleLowerCase()
    const matchesAuthor = !normalizedAuthor || authors.includes(normalizedAuthor)
    const matchesRequirement = !normalizedRequirement || requirementText(version).includes(normalizedRequirement)
    const matchesExternal = !external || (version.externalRefs || []).length > 0
    return matchesQuery && matchesStatus && matchesAuthor && matchesRequirement && matchesExternal
  })

  const direction = order === 'oldest' ? -1 : 1
  return filtered.sort((a, b) => direction * compareNewest(a, b))
}

export function projectContinuation(versions = []) {
  const ordered = filterVersions(versions, { order: 'newest' })
  const latest = ordered.find((version) => version?.display?.key !== 'VOID') || null
  const baseline = ordered.find((version) => version?.isBaseline === true
    || version?.baseline === true
    || version?.display?.key === 'BASELINE') || null
  if (!latest) {
    return {
      latest: null,
      baseline,
      relation: { key: 'empty', label: '暂无版本', color: 'default' },
    }
  }
  const latestNo = versionNoOf(latest)
  const baselineNo = versionNoOf(baseline)
  if (latestNo && latestNo === baselineNo) {
    return {
      latest,
      baseline,
      relation: { key: 'current', label: '最新版本即当前基线', color: 'blue' },
    }
  }
  return {
    latest,
    baseline,
    relation: {
      key: baseline ? 'ahead' : 'unset',
      label: baseline ? '最新版本尚未设为基线' : '尚未设置当前基线',
      color: 'gold',
    },
  }
}

export function adjacentVersionNo(versions, currentVersionNo, direction) {
  if (versions.length === 0) return null
  const currentIndex = versions.findIndex((version) => versionNoOf(version) === currentVersionNo)
  if (currentIndex === -1) return versionNoOf(versions[0])
  const nextIndex = Math.max(0, Math.min(versions.length - 1, currentIndex + direction))
  return versionNoOf(versions[nextIndex])
}

function comparisonPair(available, a, b) {
  return a && b && a !== b && available.has(a) && available.has(b) ? { a, b } : null
}

export function comparisonTargets(versions = [], baselineNo = '', selectedVersionNo = '', previousBaselineNo = '') {
  const available = new Set((versions || []).map(versionNoOf).filter(Boolean))
  const latest = (versions || []).find((item) => item.status !== 'VOID' && item.display?.key !== 'VOID')
  const latestNo = versionNoOf(latest)
  return {
    selectedVsBaseline: comparisonPair(available, baselineNo, selectedVersionNo),
    latestVsBaseline: comparisonPair(available, baselineNo, latestNo),
    baselineVsPrevious: comparisonPair(available, previousBaselineNo, baselineNo),
  }
}

export function projectFilterState(params, fallback = {}) {
  const get = (key) => {
    if (typeof params?.get === 'function') return params.get(key)
    if (key === 'q') return params?.q ?? params?.query
    if (key === 'void') return params?.void ?? params?.includeVoid
    return params?.[key]
  }
  const rawExternal = get('external') ?? fallback.external
  const rawVoid = get('void') ?? fallback.includeVoid
  return {
    query: String(get('q') || fallback.query || ''),
    status: String(get('status') || fallback.status || 'all'),
    order: String(get('order') || fallback.order || 'newest') === 'oldest' ? 'oldest' : 'newest',
    author: String(get('author') || fallback.author || ''),
    requirement: String(get('requirement') || fallback.requirement || ''),
    external: rawExternal === true || String(rawExternal || '') === '1',
    includeVoid: rawVoid === true || String(rawVoid || '') === '1',
  }
}

export function projectFilterQuery(input = {}) {
  const state = projectFilterState(input)
  const params = new URLSearchParams()
  if (state.query) params.set('q', state.query)
  if (state.status !== 'all') params.set('status', state.status)
  if (state.order !== 'newest') params.set('order', state.order)
  if (state.author) params.set('author', state.author)
  if (state.requirement) params.set('requirement', state.requirement)
  if (state.external) params.set('external', '1')
  if (state.includeVoid) params.set('void', '1')
  return params.toString()
}

const REVIEW_META = {
  pending: { key: 'pending', label: '待评审', color: 'orange' },
  confirmed: { key: 'confirmed', label: '已确认', color: 'green' },
  questions: { key: 'questions', label: '有疑问', color: 'red' },
  obsolete: { key: 'obsolete', label: '已废弃', color: 'default' },
}

export function reviewStateOf(version = {}) {
  return REVIEW_META[version.reviewStatus] || REVIEW_META.pending
}

export function planningBadges(planning = {}) {
  const badges = []
  if (planning.review?.pending) badges.push({ key: 'pending', label: `${planning.review.pending} 个待评审`, color: 'orange' })
  if (planning.review?.questions) badges.push({ key: 'questions', label: `${planning.review.questions} 个有疑问`, color: 'red' })
  if (planning.watchCount) badges.push({ key: 'watch', label: `${planning.watchCount} 个待归档`, color: 'blue' })
  return badges
}
