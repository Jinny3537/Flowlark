export function normalizeRecipientNames(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))]
}

export function initialReleaseRecipients(project = {}) {
  return {
    to: normalizeRecipientNames(project.releaseMail?.to),
    cc: normalizeRecipientNames(project.releaseMail?.cc),
  }
}

export function preflightPayload({ to = [], cc = [], selections = {}, releasedAt } = {}) {
  return {
    to: normalizeRecipientNames(to),
    cc: normalizeRecipientNames(cc),
    selections: Object.fromEntries(Object.entries(selections || {})
      .filter(([, value]) => String(value || '').trim())
      .map(([key, value]) => [key, String(value)])),
    ...(releasedAt ? { releasedAt } : {}),
  }
}

export function applyCandidate(selections = {}, query, candidateKey) {
  return { ...selections, [String(query || '')]: String(candidateKey || '') }
}

export function candidateBlockers(preflight = {}) {
  return (preflight.blockers || []).filter((item) => item.code === 'RELEASE_RECIPIENT_AMBIGUOUS')
}

export function releaseOutcome(result = {}) {
  if (result.status === 'complete') {
    return { kind: 'complete', title: '正式发版完成', description: '基线、Git 同步和发版邮件均已完成。' }
  }
  if (result.status === 'mail_pending') {
    return { kind: 'mail-pending', title: '版本已发版，邮件待重试', description: result.mail?.lastError || '企业微信邮件发送失败。' }
  }
  if (result.status === 'git_failed') {
    return { kind: 'git-failed', title: '基线已更新，Git 同步失败', description: result.git?.error || 'Git 同步失败，尚未发送邮件。' }
  }
  return { kind: 'unknown', title: '正式发版状态未知', description: '请刷新页面后核对基线、Git 和邮件队列。' }
}

