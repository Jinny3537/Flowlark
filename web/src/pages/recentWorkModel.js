function value(input) {
  return String(input || '')
}

function versionNoOf(version) {
  return value(version?.versionNo || version?.no)
}

function latestProjectLogs(logs = []) {
  const ordered = [...logs].sort((a, b) => value(b?.at).localeCompare(value(a?.at)))
  const byProject = new Map()
  for (const log of ordered) {
    const slug = value(log?.project)
    if (slug && !byProject.has(slug)) byProject.set(slug, log)
  }
  return byProject
}

export function projectActivityAt(project, log = null) {
  return [project?.updatedAt, project?.latestVersion?.updatedAt, log?.at]
    .map(value)
    .sort((a, b) => b.localeCompare(a))[0] || ''
}

export function buildRecentWorkCandidates(projects = [], logs = [], limit = 8) {
  const logByProject = latestProjectLogs(logs)
  return projects
    .filter((project) => project?.archived !== true)
    .map((project) => {
      const log = logByProject.get(value(project.slug)) || null
      return {
        slug: value(project.slug),
        projectName: value(project.name || project.slug),
        projectCode: value(project.code || project.slug),
        baselineVersionNo: value(project.baselineVersionNo),
        latestVersion: project.latestVersion || null,
        logVersionNo: value(log?.version),
        activityAt: projectActivityAt(project, log),
        activityDetail: value(log?.detail),
      }
    })
    .sort((a, b) => b.activityAt.localeCompare(a.activityAt)
      || a.projectName.localeCompare(b.projectName, 'zh-CN'))
    .slice(0, Math.max(0, Number(limit) || 0))
}

export function needsTargetValidation(item) {
  const latestNo = versionNoOf(item?.latestVersion)
  return Boolean(item?.logVersionNo && item.logVersionNo !== latestNo)
}

export function resolveRecentWorkTarget(item, checkedVersion = null) {
  const checkedNo = versionNoOf(checkedVersion)
  const checkedKey = value(checkedVersion?.display?.key || checkedVersion?.status)
  const checkedValid = Boolean(
    checkedNo && checkedNo === value(item?.logVersionNo) && checkedKey !== 'VOID',
  )
  const target = checkedValid ? checkedVersion : item?.latestVersion
  return {
    ...item,
    targetVersionNo: versionNoOf(target),
    targetVersionTitle: value(target?.title),
    targetDisplay: target?.display || null,
  }
}

export function projectContinueRoute(item) {
  const slug = encodeURIComponent(value(item?.slug))
  const versionNo = value(
    item?.targetVersionNo || item?.latestVersion?.versionNo || item?.latestVersion?.no,
  )
  return versionNo
    ? `/projects/${slug}/versions/${encodeURIComponent(versionNo)}`
    : `/projects/${slug}`
}

export function sortProjectsByRecent(projects = []) {
  return [...projects].sort((a, b) => projectActivityAt(b).localeCompare(projectActivityAt(a))
    || value(a?.name || a?.slug).localeCompare(value(b?.name || b?.slug), 'zh-CN'))
}
