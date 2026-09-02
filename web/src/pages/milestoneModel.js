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

export function milestoneItemAction(status) {
  if (status === 'planning' || status === 'reviewing') return 'remove'
  if (status === 'active') return 'release'
  return null
}

export function milestoneReleaseState(entry, mails = []) {
  let latest = null
  let latestAt = ''
  for (const mail of mails) {
    if (mail.project !== entry.project || mail.version !== entry.version) continue
    const at = String(mail.updatedAt || mail.createdAt || '')
    if (!latest || at > latestAt) {
      latest = mail
      latestAt = at
    }
  }
  if (!latest) return { key: 'none', label: '未发版', color: 'default' }
  if (latest.status === 'sent') return { key: 'sent', label: '已发版', color: 'success' }
  return { key: 'pending', label: '邮件待重试', color: 'warning' }
}
