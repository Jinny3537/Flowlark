export const versionStatus = {
  DRAFT: { label: '草稿', color: 'orange' },
  BASELINE: { label: '基线', color: 'green' },
  HISTORY: { label: '历史', color: 'gray' },
  VOID: { label: '已废弃', color: 'red' }
}

export const reviewStatus = {
  unread: { label: '未读', color: 'orange' },
  reviewing: { label: '审阅中', color: 'blue' },
  approved: { label: '已确认', color: 'green' },
  obsolete: { label: '已过期', color: 'gray' }
}

export function gitStatusLabel(status) {
  if (!status || !status.tracked) return { label: '未纳入 Git', color: 'gray' }
  if (status.conflicts && status.conflicts.length) return { label: `${status.conflicts.length} 个冲突`, color: 'red' }
  if (status.files && status.files.length) return { label: `${status.files.length} 处改动`, color: 'orange' }
  return { label: '工作区干净', color: 'green' }
}
