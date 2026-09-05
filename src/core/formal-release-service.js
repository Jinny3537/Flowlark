import { err } from './errors.js'
import * as store from './store.js'
import * as rules from './rules.js'
import * as gitx from './git.js'
import * as milestones from './milestones.js'
import * as requirements from './requirements.js'
import * as releaseMail from './release-mail.js'
import {
  createDeliverySnapshot,
  readDeliverySnapshot,
  verifyDeliverySnapshot
} from './delivery-snapshots.js'
import {
  ensureFormalReleaseRun,
  findFormalReleaseRun,
  findFormalReleaseRunByMail,
  markFormalReleaseStep,
  publicFormalReleaseRun
} from './formal-release-run.js'
import { currentUser } from './repo.js'

export async function preflightMilestoneFormalRelease(context, name, slug, versionNo, input = {}) {
  assertMilestoneFormalReleaseTarget(context.root, name, slug, versionNo)
  return publicFormalReleasePreflight(await prepareFormalRelease(context, slug, versionNo, input))
}

export async function formalReleaseMilestoneVersion(context, name, slug, versionNo, input = {}) {
  const item = milestones.readMilestone(context.root, name)
  const delivery = milestoneDelivery(item, slug, versionNo)
  if (item.status !== 'active' && !delivery) {
    throw err.conflict(
      'MILESTONE_FORMAL_RELEASE_STATUS_INVALID',
      `迭代「${item.name}」只有在进行中状态才能正式发版`
    )
  }
  if (item.status === 'active') {
    assertMilestoneFormalReleaseTarget(context.root, name, slug, versionNo)
  } else if (!item.items.some((entry) => entry.project === slug && entry.version === versionNo)) {
    throw err.conflict(
      'MILESTONE_FORMAL_RELEASE_OUT_OF_SCOPE',
      `${slug}/${versionNo} 不在迭代「${item.name}」的版本范围内`,
      '先核对迭代版本范围'
    )
  }
  return context.withLock(`formal-release:${name}:${slug}:${versionNo}`, () =>
    executeFormalRelease(context, name, slug, versionNo, input))
}

export function listReleaseMails(context) {
  return releaseMail.listReleaseMails(context.root).map(releaseMail.publicReleaseMail)
}

export async function retryReleaseMail(context, id) {
  const task = releaseMail.readReleaseMail(context.root, id)
  const baselineNo = store.readBaseline(context.root, task.project)
  const version = store.readVersion(context.root, task.project, task.version)
  if (baselineNo !== task.version || version.baselineAt !== task.baselineAt) {
    throw err.conflict('RELEASE_BASELINE_CHANGED', '当前基线已变化，不能自动重试这封发版邮件', '请人工核对版本后重新正式发版')
  }
  const run = findFormalReleaseRunByMail(context.root, task)
  return sendReleaseMailTask(context, task, {
    releaseRunId: run?.id || null,
    snapshot: run?.steps.snapshot?.name || null
  })
}

function assertMilestoneFormalReleaseTarget(root, name, slug, versionNo) {
  const item = milestones.readMilestone(root, name)
  if (item.status !== 'active') {
    throw err.conflict(
      'MILESTONE_FORMAL_RELEASE_STATUS_INVALID',
      `迭代「${item.name}」只有在进行中状态才能正式发版`
    )
  }
  const included = item.items.some((entry) =>
    entry.project === slug && entry.version === versionNo)
  if (!included) {
    throw err.conflict(
      'MILESTONE_FORMAL_RELEASE_OUT_OF_SCOPE',
      `${slug}/${versionNo} 不在迭代「${item.name}」的版本范围内`,
      '先核对迭代版本范围'
    )
  }
  if (!store.readSpec(root, slug, versionNo).trim()) {
    throw err.conflict(
      'VERSION_SPEC_REQUIRED',
      `${slug}/${versionNo} 缺少规格书，不能正式发版`
    )
  }
  for (const code of [...new Set(item.items
    .filter((entry) => entry.project === slug && entry.version === versionNo)
    .map((entry) => entry.requirement))]) {
    const requirement = requirements.readRequirement(root, code)
    if (!['confirmed', 'developing', 'pending-acceptance', 'completed'].includes(requirement.status)) {
      throw err.conflict(
        'REQUIREMENT_NOT_READY_FOR_DELIVERY',
        `${code} 尚未确认，不能正式发版`
      )
    }
    if (!requirements.readRequirementSpec(root, code).trim()) {
      throw err.conflict(
        'REQUIREMENT_SPEC_REQUIRED',
        `${code} 缺少验收规格，不能正式发版`
      )
    }
  }
  return item
}

async function prepareFormalRelease(context, slug, versionNo, input = {}) {
  const blockers = []
  const warnings = []
  const pushBlocker = (code, message, hint = null, extra = {}) => blockers.push({ code, message, hint, ...extra })
  const project = store.readProject(context.root, slug)
  const version = store.readVersion(context.root, slug, versionNo)
  const baselineNo = store.readBaseline(context.root, slug)
  const releasedAt = validReleaseTime(input.releasedAt)
  const gitIdentity = context.gitSyncOverride
    ? { name: 'Test User', email: 'test@example.com', complete: true }
    : context.gitIdentity()

  if (version.status === 'VOID') pushBlocker('VERSION_VOID', `${versionNo} 已废弃，不能正式发版`)
  if (!version.baselineAt && version.reviewStatus === 'questions') {
    pushBlocker('REVIEW_QUESTIONS_BLOCKED', `${versionNo} 仍有评审疑问，不能正式发版`)
  }
  if (!store.readHtml(context.root, slug, versionNo)) {
    pushBlocker('FILE_MISSING', `${versionNo} 的原型文件丢失，不能正式发版`)
  }
  try {
    rules.assertChangelogReady(version, store.listVersionNos(context.root, slug).length, {
      enabled: context.settings.rules.requireChangelog
    })
  } catch (error) {
    pushBlocker(error.code || 'CHANGELOG_REQUIRED', error.message, error.hint)
  }

  if (!gitIdentity.complete) {
    pushBlocker('GIT_IDENTITY_REQUIRED', '正式发版前需要配置 Git 提交身份', '在 Git 面板中设置姓名和邮箱')
  }
  if (!context.gitSyncOverride) {
    const conflicts = context.gitConflicts()
    if (conflicts.length) pushBlocker('GIT_CONFLICTS', 'Git 仍有未解决冲突，不能正式发版', '先在 Git 面板完成冲突处理')
    if (context.gitInProgress()) pushBlocker('GIT_IN_PROGRESS', 'Git 同步流程尚未结束，不能正式发版', '先继续或放弃当前同步')
    if (!context.gitRemote()) pushBlocker('GIT_REMOTE_REQUIRED', '正式发版前需要配置 Git 远端')
  }

  let config = releaseMail.normalizeReleaseMail(project.releaseMail)
  try {
    config = releaseMail.assertReleaseMailConfig({
      ...config,
      to: input.to !== undefined ? input.to : config.to,
      cc: input.cc !== undefined ? input.cc : config.cc
    })
  } catch (error) {
    pushBlocker(error.code || 'RELEASE_MAIL_CONFIG_INVALID', error.message, error.hint)
  }
  const toNames = config.to
  const toSet = new Set(toNames)
  const ccNames = config.cc.filter((name) => !toSet.has(name))
  const allNames = [...new Set([...toNames, ...ccNames])]

  let authStatus = null
  let resolution = []
  if (!context.wecomMcp) {
    pushBlocker('WECOM_MCP_UNAVAILABLE', '企业微信 MCP Sidecar 尚未连接')
  } else {
    try {
      authStatus = await context.wecomMcp.authStatus()
      if (!authStatus.installed || !authStatus.versionOk || !authStatus.authorized) {
        pushBlocker(
          'WECOM_AUTH_REQUIRED',
          authStatus.message || '企业微信 CLI 尚未就绪',
          authStatus.instruction || null
        )
      } else if (allNames.length) {
        resolution = (await context.wecomMcp.resolveContacts({ names: allNames })).results || []
      }
    } catch (error) {
      pushBlocker(error.code || 'WECOM_MCP_REJECTED', error.message, error.hint)
    }
  }

  const selections = input.selections && typeof input.selections === 'object' ? input.selections : {}
  const selected = new Map()
  for (const result of resolution) {
    const candidates = Array.isArray(result.candidates) ? result.candidates : []
    const requestedKey = String(selections[result.query] || '')
    const chosen = result.status === 'unique'
      ? (result.candidate || candidates[0])
      : candidates.find((candidate) => candidate.key === requestedKey)
    if (chosen) {
      selected.set(result.query, chosen)
      continue
    }
    if (result.status === 'missing') {
      pushBlocker('RELEASE_RECIPIENT_MISSING', `企业微信通讯录中没有找到「${result.query}」`, result.hint || null, {
        query: result.query,
        candidates: []
      })
    } else {
      pushBlocker('RELEASE_RECIPIENT_AMBIGUOUS', `企业微信通讯录中「${result.query}」存在多个候选人`, result.hint || '请选择明确的成员', {
        query: result.query,
        candidates: candidates.map(releaseMail.publicReleaseRecipient)
      })
    }
  }

  const unresolved = allNames.filter((name) => !selected.has(name) && !blockers.some((item) => item.query === name))
  for (const name of unresolved) {
    pushBlocker('RELEASE_RECIPIENT_UNRESOLVED', `尚未解析企业微信成员「${name}」`, null, { query: name, candidates: [] })
  }

  const otherBaselines = context.listVersions(slug, { includeDraft: true, includeVoid: true, markNew: false })
    .filter((item) => item.versionNo !== versionNo && item.baselineAt)
    .sort((a, b) => String(b.baselineAt).localeCompare(String(a.baselineAt)))
  const previousBaseline = baselineNo && baselineNo !== versionNo ? baselineNo : (otherBaselines[0]?.versionNo || '')
  let rendered = { subject: '', markdown: '' }
  try {
    rendered = releaseMail.renderReleaseMail(config, releaseMail.releaseTemplateContext({
      project,
      version,
      previousBaseline,
      releasedAt,
      releasedBy: gitIdentity.name || currentUser()
    }))
  } catch (error) {
    pushBlocker(error.code || 'RELEASE_MAIL_TEMPLATE_INVALID', error.message, error.hint)
  }

  const internalTo = toNames.map((name) => selected.get(name)).filter(Boolean)
  const internalCc = ccNames.map((name) => selected.get(name)).filter(Boolean)
  return {
    ready: blockers.length === 0,
    blockers,
    warnings,
    project: { slug, name: project.name, code: project.code },
    version: { versionNo, title: version.title },
    previousBaseline,
    releasedAt,
    releasedBy: gitIdentity.name || currentUser(),
    authStatus,
    to: internalTo.map(releaseMail.publicReleaseRecipient),
    cc: internalCc.map(releaseMail.publicReleaseRecipient),
    resolution: resolution.map((item) => ({
      query: item.query,
      status: item.status,
      candidate: item.candidate ? releaseMail.publicReleaseRecipient(item.candidate) : null,
      candidates: (item.candidates || []).map(releaseMail.publicReleaseRecipient),
      hint: item.hint || null
    })),
    subject: rendered.subject,
    markdown: rendered.markdown,
    internalTo,
    internalCc
  }
}

async function executeFormalRelease(context, milestoneName, slug, versionNo, input = {}) {
  const earlyBaseline = store.readBaseline(context.root, slug)
  const earlyVersion = store.readVersion(context.root, slug, versionNo)
  const earlyDelivery = milestoneDelivery(milestones.readMilestone(context.root, milestoneName), slug, versionNo)
  if (earlyBaseline === versionNo && earlyVersion.baselineAt) {
    const existing = releaseMail.listReleaseMails(context.root)
      .find((item) => item.project === slug && item.version === versionNo && item.baselineAt === earlyVersion.baselineAt)
    const earlyRun = earlyDelivery?.releaseRunId
      ? findFormalReleaseRun(context.root, {
        milestone: milestoneName,
        project: slug,
        version: versionNo,
        baselineAt: earlyVersion.baselineAt
      })
      : null
    if (earlyDelivery) verifyDeliverySnapshot(context.root, earlyDelivery.snapshot)
    if (existing?.status === 'sent' && earlyDelivery) {
      return {
        status: 'complete',
        released: true,
        duplicate: true,
        baseline: { project: slug, version: versionNo, baselineAt: earlyVersion.baselineAt },
        git: { ok: true, skipped: true },
        snapshot: earlyDelivery.snapshot,
        delivery: earlyDelivery,
        mail: releaseMail.publicReleaseMail(existing),
        run: earlyRun ? publicFormalReleaseRun(earlyRun) : null
      }
    }
    if (existing && earlyDelivery) {
      return sendReleaseMailTask(context, existing, {
        git: { ok: true, skipped: true },
        snapshot: earlyDelivery.snapshot,
        releaseRunId: earlyRun?.id || null
      })
    }
  }
  const prepared = await prepareFormalRelease(context, slug, versionNo, input)
  if (!prepared.ready) {
    throw err.bad(
      'FORMAL_RELEASE_BLOCKED',
      prepared.blockers[0]?.message || '正式发版预检未通过',
      prepared.blockers.map((item) => item.message).join('；')
    )
  }

  const currentBaseline = store.readBaseline(context.root, slug)
  const baseline = currentBaseline !== versionNo
    ? context.setBaseline(slug, versionNo)
    : context.getVersion(slug, versionNo)
  const baselineAt = baseline.baselineAt
  let run = ensureFormalReleaseRun(context.root, { milestone: milestoneName, project: slug, version: versionNo, baselineAt })
  run = markFormalReleaseStep(context.root, run.id, 'baseline', {
    status: 'complete',
    project: slug,
    version: versionNo,
    baselineAt
  })
  const existing = releaseMail.listReleaseMails(context.root)
    .find((item) => item.project === slug && item.version === versionNo && item.baselineAt === baselineAt)
  const existingDelivery = milestoneDelivery(milestones.readMilestone(context.root, milestoneName), slug, versionNo)
  if (existingDelivery) verifyDeliverySnapshot(context.root, existingDelivery.snapshot)
  if (existing?.status === 'sent' && existingDelivery) {
    run = markFormalReleaseStep(context.root, run.id, 'mail', { status: 'sent', mailId: existing.id })
    return {
      status: 'complete',
      released: true,
      duplicate: true,
      baseline: { project: slug, version: versionNo, baselineAt },
      git: { ok: true, skipped: true },
      snapshot: existingDelivery.snapshot,
      delivery: existingDelivery,
      mail: releaseMail.publicReleaseMail(existing),
      run: publicFormalReleaseRun(run)
    }
  }
  if (existing && existingDelivery) {
    return sendReleaseMailTask(context, existing, {
      git: { ok: true, skipped: true },
      snapshot: existingDelivery.snapshot,
      releaseRunId: run.id
    })
  }

  let gitResult = run.steps.git?.result || null
  let releaseCommit = run.steps.git?.releaseCommit || ''
  if (!releaseCommit) {
    try {
      gitResult = await Promise.resolve(context.gitSyncOverride
        ? context.gitSyncOverride({ message: `release: ${slug}/${versionNo}`, push: true })
        : context.gitSync({ message: `release: ${slug}/${versionNo}`, push: true }))
      if (gitResultFailed(gitResult)) {
        throw Object.assign(new Error(firstFailedGitStep(gitResult)?.detail || 'Git 同步失败'), {
          code: 'GIT_SYNC_FAILED'
        })
      }
      releaseCommit = currentGitHead(context.root)
      run = markFormalReleaseStep(context.root, run.id, 'git', {
        status: 'complete',
        releaseCommit,
        result: gitResult
      })
    } catch (error) {
      run = markFormalReleaseStep(context.root, run.id, 'git', {
        status: 'failed',
        error: error.message,
        hint: error.hint || null
      })
      return {
        status: 'git_failed',
        released: false,
        baseline: { project: slug, version: versionNo, baselineAt },
        git: { ok: false, error: error.message, hint: error.hint || null },
        snapshot: null,
        delivery: null,
        mail: null,
        run: publicFormalReleaseRun(run)
      }
    }
  }

  let snapshotName = run.steps.snapshot?.name || ''
  try {
    if (snapshotName) verifyDeliverySnapshot(context.root, snapshotName)
    else {
      const snapshot = createDeliverySnapshot(context.root, {
        milestone: milestoneName,
        project: slug,
        version: versionNo,
        releaseCommit
      })
      snapshotName = snapshot.name
    }
    run = markFormalReleaseStep(context.root, run.id, 'snapshot', {
      status: 'complete',
      name: snapshotName,
      releaseCommit
    })
  } catch (error) {
    run = markFormalReleaseStep(context.root, run.id, 'snapshot', {
      status: 'failed',
      error: error.message,
      hint: error.hint || null,
      releaseCommit
    })
    return {
      status: 'snapshot_failed',
      released: false,
      baseline: { project: slug, version: versionNo, baselineAt },
      git: { ok: true, result: gitResult, releaseCommit },
      snapshot: null,
      delivery: null,
      mail: null,
      run: publicFormalReleaseRun(run)
    }
  }

  let delivery = milestoneDelivery(milestones.readMilestone(context.root, milestoneName), slug, versionNo)
  if (!delivery || run.steps.lifecycle?.status !== 'complete') {
    delivery = completeReleaseLifecycle(context, milestoneName, slug, versionNo, snapshotName, run.id)
    run = markFormalReleaseStep(context.root, run.id, 'lifecycle', {
      status: 'complete',
      delivery
    })
  }

  if (existing) {
    return sendReleaseMailTask(context, existing, {
      git: { ok: true, result: gitResult, releaseCommit, skipped: Boolean(run.steps.git?.releaseCommit && !gitResult) },
      snapshot: snapshotName,
      releaseRunId: run.id
    })
  }
  const task = releaseMail.enqueueReleaseMail(context.root, {
    project: slug,
    version: versionNo,
    baselineAt,
    subject: prepared.subject,
    markdown: prepared.markdown,
    to: prepared.internalTo,
    cc: prepared.internalCc
  })
  run = markFormalReleaseStep(context.root, run.id, 'mail', {
    status: 'pending',
    mailId: task.id
  })
  return sendReleaseMailTask(context, task, {
    git: { ok: true, result: gitResult, releaseCommit },
    snapshot: snapshotName,
    releaseRunId: run.id
  })
}

function validReleaseTime(value) {
  if (value === undefined || value === null || value === '') return new Date().toISOString()
  const time = new Date(value)
  if (!Number.isFinite(time.getTime())) throw err.bad('RELEASE_TIME_INVALID', '发版时间不合法')
  return time.toISOString()
}

function publicFormalReleasePreflight(value) {
  const { internalTo, internalCc, ...publicValue } = value
  return publicValue
}

function gitResultFailed(result) {
  return Array.isArray(result?.steps) && result.steps.some((step) => step && step.ok === false)
}

function firstFailedGitStep(result) {
  return Array.isArray(result?.steps) ? result.steps.find((step) => step && step.ok === false) : null
}

function currentGitHead(root) {
  const result = gitx.git(root, ['rev-parse', 'HEAD'])
  if (!result.ok || !result.out) {
    throw err.conflict('GIT_COMMIT_REQUIRED', '正式发版没有可验证的 Git 提交')
  }
  return result.out
}

async function sendReleaseMailTask(
  context,
  task,
  { git = { ok: true, skipped: true }, snapshot = null, releaseRunId = null } = {}
) {
  if (task.status === 'sent') {
    const run = releaseRunId
      ? markFormalReleaseStep(context.root, releaseRunId, 'mail', { status: 'sent', mailId: task.id })
      : null
    return {
      status: 'complete', released: true, duplicate: true,
      baseline: { project: task.project, version: task.version, baselineAt: task.baselineAt },
      git,
      snapshot,
      delivery: snapshot ? deliveryForSnapshot(context.root, snapshot) : null,
      mail: releaseMail.publicReleaseMail(task),
      run: run ? publicFormalReleaseRun(run) : null
    }
  }
  try {
    await context.wecomMcp.sendReleaseMail({
      to: task.to,
      cc: task.cc,
      subject: task.subject,
      markdown: task.markdown,
      idempotencyKey: task.idempotencyKey
    })
    const sent = releaseMail.markReleaseMailSent(context.root, task.id)
    const run = releaseRunId
      ? markFormalReleaseStep(context.root, releaseRunId, 'mail', { status: 'sent', mailId: task.id })
      : null
    return {
      status: 'complete', released: true, duplicate: false,
      baseline: { project: task.project, version: task.version, baselineAt: task.baselineAt },
      git,
      snapshot,
      delivery: snapshot ? deliveryForSnapshot(context.root, snapshot) : null,
      mail: releaseMail.publicReleaseMail(sent),
      run: run ? publicFormalReleaseRun(run) : null
    }
  } catch (error) {
    const pending = releaseMail.markReleaseMailFailed(context.root, task.id, error)
    const run = releaseRunId ? markFormalReleaseStep(context.root, releaseRunId, 'mail', {
      status: 'pending',
      mailId: task.id,
      error: error.message,
      hint: error.hint || null
    }) : null
    return {
      status: 'mail_pending', released: true, duplicate: false,
      baseline: { project: task.project, version: task.version, baselineAt: task.baselineAt },
      git,
      snapshot,
      delivery: snapshot ? deliveryForSnapshot(context.root, snapshot) : null,
      mail: releaseMail.publicReleaseMail(pending),
      run: run ? publicFormalReleaseRun(run) : null
    }
  }
}

function milestoneDelivery(milestone, slug, versionNo) {
  return (milestone.deliveries || []).find((entry) =>
    entry.project === slug && entry.version === versionNo) || null
}

function deliveryForSnapshot(root, snapshotName) {
  const snapshot = readDeliverySnapshot(root, snapshotName)
  const milestone = milestones.readMilestone(root, snapshot.milestone)
  return milestoneDelivery(milestone, snapshot.project, snapshot.version)
}

function completeReleaseLifecycle(context, milestoneName, slug, versionNo, snapshotName, releaseRunId) {
  const snapshot = readDeliverySnapshot(context.root, snapshotName)
  if (snapshot.milestone !== milestoneName || snapshot.project !== slug || snapshot.version !== versionNo) {
    throw err.conflict('DELIVERY_SCOPE_MISMATCH', '交付快照与正式发版目标不匹配')
  }
  const updated = milestones.recordMilestoneDelivery(context.root, milestoneName, {
    project: slug,
    version: versionNo,
    snapshot: snapshotName,
    releaseRunId
  })
  const at = new Date().toISOString()
  for (const code of [...new Set(snapshot.items.map((item) => item.requirement))]) {
    const current = requirements.readRequirement(context.root, code)
    if (current.status === 'pending-acceptance' || current.status === 'completed') continue
    const { item, transition } = requirements.updateRequirementLifecycle(context.root, code, 'pending-acceptance', {
      system: true,
      actor: currentUser(),
      now: at,
      reason: `正式交付 ${snapshotName}`
    })
    if (transition.changed) {
      context.appendLog(null, null, 'REQUIREMENT_STATUS_TRANSITION',
        `需求 ${item.code} 从 ${transition.from} 流转到 ${transition.to}：正式交付 ${snapshotName}`,
        { requirement: item.code, from: transition.from, to: transition.to, statusReason: `正式交付 ${snapshotName}` })
    }
  }
  context.appendLog(slug, versionNo, 'FORMAL_RELEASE_DELIVERY_RECORDED', `正式交付 ${snapshotName}`, {
    milestone: milestoneName,
    snapshot: snapshotName,
    releaseRunId,
    milestoneStatus: updated.status
  })
  return milestoneDelivery(updated, slug, versionNo)
}
