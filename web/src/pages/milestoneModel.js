export function milestoneItems(items = []) {
  return items.map(item => ({
    requirement: item.requirement,
    project: item.project,
    version: item.version || item.versionNo
  }))
}

export function withoutMilestoneItem(items, removed) {
  return milestoneItems(items.filter(item => item !== removed))
}
