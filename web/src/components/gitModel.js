export function gitStage(doctor, status) {
  if (status?.conflicts?.length) return 'conflicted'
  return doctor?.stage || null
}

export function canWriteGit(appCanWrite, permission) {
  return Boolean(appCanWrite && permission?.mode !== 'readonly')
}

export function syncLabel(status = {}) {
  if (!status.hasRemote) return '提交到本地'
  if (status.clean && status.behind) return '拉取更新'
  if (status.clean && status.ahead) return '推送到远端'
  return '提交并同步'
}
