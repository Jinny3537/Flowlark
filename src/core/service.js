import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import * as store from './store.js'
import * as rules from './rules.js'
import * as gitx from './git.js'
import * as assistant from './assistant.js'
import * as readstate from './readstate.js'
import * as offline from './offline.js'
import * as permissions from './permissions.js'
import * as feedback from './feedback.js'
import * as issuex from './integrations/issues/index.js'
import * as reqIntegration from './integrations/requirements/index.js'
import * as milestoneIntegration from './integrations/milestones/index.js'
import { callTool } from './integrations/mcp-jsonrpc.js'
import * as secrets from './secrets.js'
import * as importer from './importer.js'
import * as drafts from './drafts.js'
import * as watchbox from './watch-inbox.js'
import * as reqx from './requirements.js'
import * as projectx from './projects.js'
import * as projectPreferences from './project-preferences.js'
import * as versionPlanning from './version-planning.js'
import * as migrate from './migrate.js'
import * as milestones from './milestones.js'
import * as savedViews from './views.js'
import * as exporter from './exporter.js'
import * as snapshots from './snapshots.js'
import { normalizeAcceptanceRules, aggregateAcceptance } from './acceptance-rules.js'
import { createDeliverySnapshot, readDeliverySnapshot, verifyDeliverySnapshot } from './delivery-snapshots.js'
import { appendAcceptance, listAcceptances } from './acceptances.js'
import { createDeliveryFeedback, listDeliveryFeedback, resolveDeliveryFeedback } from './delivery-feedback.js'
import {
  ensureFormalReleaseRun,
  findFormalReleaseRun,
  findFormalReleaseRunByMail,
  markFormalReleaseStep,
  publicFormalReleaseRun
} from './formal-release-run.js'
import { suggestImpact as runImpact } from './impact.js'
import * as notifications from './notifications.js'
import * as releaseMail from './release-mail.js'
import { assertSyncPolicy, normalizeSyncPolicy } from './sync-policy.js'
import * as workspaces from './workspaces.js'
import * as setupx from './setup.js'
import * as updater from './updater.js'
import * as mirror from './mirror.js'
import * as workspaceIndex from './workspace-index.js'
import * as mcpConfig from './mcp-config.js'
import * as mcpRuntime from './mcp-runtime.js'
import { createMcpClientManager } from './integrations/mcp-client.js'
import { createAssessTaskAdapter } from './integrations/assess-task/adapter.js'
import { freezePreflight, transitionMilestoneStatus } from './milestone-lifecycle.js'
import { confirmationPreflight, transitionRequirementStatus } from './requirement-lifecycle.js'
import { buildMilestoneSourceHash, buildMilestoneSyncPlan, linkedMilestoneSourceHash } from './milestone-sync-plan.js'
import { resolveProjectSyncContext } from './project-sync-context.js'
import * as externalBindings from './external-bindings.js'
import {
  executeMilestoneSync as executeSync,
  getLinkableCreateStep,
  hasLinkedCreateResult,
  linkMilestoneCreateResult,
  resumeMilestoneSync as resumeSync,
  withMilestoneSyncLock
} from './milestone-sync.js'
import { readMilestoneSyncJournal } from './milestone-sync-journal.js'
import { appendSyncAudit, listSyncAudit as readSyncAudit } from './sync-audit.js'
import {
  cancelSyncRecord as cancelQueuedSyncRecord,
  findSyncRecord,
  listSyncRecords as readSyncRecords,
  readSyncRecord,
  savePendingSync,
  transitionSyncRecord as transitionQueuedSyncRecord
} from './sync-queue.js'
import { search as runSearch } from './search.js'
import { detectExternalRefs } from './scan.js'
import * as cfg from './config.js'
import { readConfig, writeConfig, currentUser, SCHEMA_VERSION } from './repo.js'

function trashRestoreState(root, entry) {
  if (!store.projectExists(root, entry.project)) {
    return { canRestore: false, blockedReason: 'PROJECT_NOT_FOUND' }
  }
  if (store.versionExists(root, entry.project, entry.versionNo)) {
    return { canRestore: false, blockedReason: 'VERSION_EXISTS' }
  }
  const required = [`${entry.versionNo}.json`, `${entry.versionNo}.html`]
  if (required.some((name) => !fs.existsSync(path.join(entry.dir, name)))) {
    return { canRestore: false, blockedReason: 'TRASH_INCOMPLETE' }
  }
  return { canRestore: true, blockedReason: null }
}

/**
 * 业务门面。CLI 与 HTTP API 都只调这一层 —— 保证「命令行能做的事，网页也能做，
 * 且行为完全一致」。任何一边绕过它直接读写文件，两边就会开始漂移。
 */
export class Hub {
  constructor(root, { wecomMcp = null, gitSync = null, assessAdapter = null, assessConfig = null, mcpClientManager = null } = {}) {
    this.root = root
    this.wecomMcp = wecomMcp
    this.gitSyncOverride = gitSync
    this.assessAdapter = assessAdapter
    this.assessConfig = assessConfig
    this.mcpClientManager = mcpClientManager || createMcpClientManager()
    const initial = readConfig(root)
    if (initial.schemaVersion < SCHEMA_VERSION) migrate.migrateToLatest(root)
    this.config = readConfig(root)
  }

  get settings() {
    return this.config.settings
  }

  attachWecomMcp(adapter) {
    this.wecomMcp = adapter
    return this
  }

  // ==================== 项目 ====================

  listProjects() {
    const requirements = reqx.listRequirements(this.root)
    return store.listProjectSlugs(this.root).map((slug) => this.#projectDetail(slug, requirements))
  }

  getProject(slug) {
    return this.#projectDetail(slug, reqx.listRequirements(this.root))
  }

  projectPlanning(slug) {
    const project = this.getProject(slug)
    const versions = this.listVersions(slug, { includeDraft: true, includeVoid: true, markNew: false })
    const baseline = versions.find((item) => item.isBaseline) || null
    let history = []
    let historyError = null
    try {
      history = this.gitBaselineHistory(slug, 50)
    } catch (error) {
      historyError = error instanceof Error ? error.message : String(error)
    }
    const previous = baseline
      ? versionPlanning.previousBaseline(versions, baseline.versionNo, history)
      : null
    const changes = baseline && previous
      ? this.cumulative(slug, previous.version.versionNo, baseline.versionNo)
      : { fromVersionNo: null, toVersionNo: baseline?.versionNo || null, versionCount: baseline ? 1 : 0, itemCount: 0, items: [], locationCounts: {} }
    const review = versionPlanning.reviewSummary(versions, baseline?.versionNo || '')
    const watchCount = this.listWatchInbox()
      .filter((item) => item.project === slug && item.status !== 'archived').length
    return {
      project: { slug: project.slug, name: project.name, code: project.code },
      baseline,
      previousBaseline: previous?.version || null,
      previousBaselineSource: previous?.source || null,
      previousBaselineHistory: previous?.history || null,
      history,
      historyError,
      latest: versions.find((item) => item.status !== 'VOID') || null,
      review,
      changes,
      changeCounts: versionPlanning.changeCounts(changes.items),
      watchCount,
      notificationProvider: this.settings.integrations.notificationProvider || 'none'
    }
  }

  getProjectPreference(slug) {
    store.readProject(this.root, slug)
    return projectPreferences.getProjectPreference(this.root, slug)
  }

  setProjectPreference(slug, input) {
    store.readProject(this.root, slug)
    return projectPreferences.setProjectPreference(this.root, slug, input)
  }

  #projectDetail(slug, requirements) {
    const project = store.readProject(this.root, slug)
    const baselineNo = store.readBaseline(this.root, slug)
    const nos = store.listVersionNos(this.root, slug)
    const orderedVersions = rules.sortVersions(
      nos.map((no) => store.readVersion(this.root, slug, no))
    )
    const latest = orderedVersions.find((version) => version.status !== 'VOID') || null
    return {
      ...project,
      priority: project.priority || '',
      archived: project.archived === true,
      sync: normalizeSyncPolicy(project.sync),
      acceptance: normalizeAcceptanceRules(project.acceptance),
      baselineVersionNo: baselineNo,
      versionCount: nos.length,
      latestVersion: latest ? {
        versionNo: latest.versionNo,
        title: latest.title,
        display: rules.displayStatus(latest, baselineNo),
        updatedAt: latest.updatedAt || latest.createdAt
      } : null,
      ...projectx.projectMetrics(project, requirements)
    }
  }

  createProject({ name, code, description = '', priority = '', archived = false, releaseMail: releaseMailInput = {} }) {
    this.#assertWritable('创建项目')
    const trimmedName = String(name || '').trim()
    if (!trimmedName) throw err.bad('NAME_REQUIRED', '请填写项目名称')

    const slug = store.slugify(code || trimmedName)
    if (!slug || !store.SLUG_RE.test(slug)) {
      throw err.bad('CODE_INVALID', `无法从「${code || trimmedName}」生成合法的项目标识`,
        '显式指定：--code order-center（小写字母、数字、连字符）')
    }
    if (store.projectExists(this.root, slug)) {
      throw err.conflict('PROJECT_EXISTS', `项目「${slug}」已存在`)
    }

    const now = new Date().toISOString()
    const who = currentUser()
    const project = {
      slug,
      name: trimmedName,
      code: code ? String(code).trim() : slug,
      description: String(description || ''),
      priority: projectx.normalizeProjectPriority(priority),
      archived: projectx.normalizeArchived(archived),
      releaseMail: releaseMail.normalizeReleaseMail(releaseMailInput),
      sync: normalizeSyncPolicy(),
      acceptance: normalizeAcceptanceRules(),
      createdAt: now,
      createdBy: who,
      updatedAt: now,
      updatedBy: who
    }
    projectx.assertUniqueProjectCode(this.root, project.code)
    store.writeProject(this.root, slug, project)
    this.#log(slug, null, 'PROJECT_CREATE', `创建项目 ${trimmedName}`)
    return this.getProject(slug)
  }

  updateProject(slug, patch) {
    this.#assertWritable('编辑项目')
    const current = store.readProject(this.root, slug)
    const next = { ...current }

    if (patch.name !== undefined) {
      const name = String(patch.name || '').trim()
      if (!name) throw err.bad('NAME_REQUIRED', '请填写项目名称')
      next.name = name
    }
    if (patch.code !== undefined && String(patch.code).trim() !== String(current.code || '').trim()) {
      const code = projectx.assertEditableProjectCode(patch.code)
      projectx.assertUniqueProjectCode(this.root, code, slug)
      next.code = code
    }
    if (patch.description !== undefined) next.description = String(patch.description || '')
    if (patch.priority !== undefined) next.priority = projectx.normalizeProjectPriority(patch.priority)
    if (patch.archived !== undefined) next.archived = projectx.normalizeArchived(patch.archived)
    if (patch.releaseMail !== undefined) next.releaseMail = releaseMail.normalizeReleaseMail(patch.releaseMail)
    if (patch.sync !== undefined) next.sync = assertSyncPolicy(patch.sync)
    if (patch.acceptance !== undefined) next.acceptance = normalizeAcceptanceRules(patch.acceptance)
    if (next.priority === undefined) next.priority = ''
    if (next.archived === undefined) next.archived = false
    if (next.releaseMail === undefined) next.releaseMail = releaseMail.normalizeReleaseMail()
    if (next.sync === undefined) next.sync = normalizeSyncPolicy()
    if (next.acceptance === undefined) next.acceptance = normalizeAcceptanceRules()

    next.updatedAt = new Date().toISOString()
    next.updatedBy = currentUser()
    store.writeProject(this.root, slug, next)
    this.#log(slug, null, 'PROJECT_UPDATE', `编辑项目 ${next.name}`)
    return this.getProject(slug)
  }

  // ==================== 版本 ====================

  listVersions(slug, { includeDraft = true, includeVoid = false, markNew = true } = {}) {
    store.readProject(this.root, slug) // 存在性校验
    const baselineNo = store.readBaseline(this.root, slug)
    const all = store
      .listVersionNos(this.root, slug)
      .map((no) => this.#decorate(store.readVersion(this.root, slug, no), baselineNo))
    const ordered = rules
      .sortVersions(all)
      .filter((v) => (includeDraft || v.display.key !== 'DRAFT') && (includeVoid || v.display.key !== 'VOID'))
    return markNew ? readstate.markUnread(this.root, slug, ordered) : ordered
  }

  getVersion(slug, versionNo) {
    const baselineNo = store.readBaseline(this.root, slug)
    const v = this.#decorate(store.readVersion(this.root, slug, versionNo), baselineNo)
    v.spec = store.readSpec(this.root, slug, versionNo)
    v.hasOffline = offline.hasOffline(this.root, slug, versionNo)
    // 与磁盘对账：手工删过文件的话，记录里的条目要标出来，而不是让用户点了才发现 404
    const onDisk = new Set(store.listAttachmentFiles(this.root, slug, versionNo))
    v.attachments = v.attachments.map((a) => ({ ...a, missing: !onDisk.has(a.name) }))
    return v
  }

  getBaseline(slug) {
    const no = store.readBaseline(this.root, slug)
    return no ? this.getVersion(slug, no) : null
  }

  /**
   * 新建版本。html 可以直接给内容，也可以给 sourcePath 让服务端自己读 ——
   * CLI 走后者（避免把文件读进内存再传一遍），HTTP 走前者。
   */
  addVersion(slug, { versionNo, title, note = '', html = null, sourcePath = null, changes = [], requirements = [], tags = [], status = 'DRAFT' }) {
    this.#assertWritable('新增版本')
    store.readProject(this.root, slug)
    store.assertVersionNo(versionNo)

    if (store.versionExists(this.root, slug, versionNo)) {
      throw err.conflict('VERSION_EXISTS', `版本号「${versionNo}」在项目 ${slug} 中已存在`,
        '换一个版本号，或先删除同号版本')
    }
    const t = String(title || '').trim()
    if (!t) throw err.bad('TITLE_REQUIRED', '请填写版本标题', '用 -t "一句话说明本版主题"')

    let content
    if (sourcePath) {
      const abs = path.resolve(sourcePath)
      if (!fs.existsSync(abs)) throw err.notFound(`文件 ${sourcePath}`)
      if (!/\.html?$/i.test(abs)) {
        throw err.bad('FILE_TYPE', `${path.basename(abs)} 不是 HTML 文件`, '仅支持 .html / .htm')
      }
      content = fs.readFileSync(abs)
    } else if (html != null) {
      content = Buffer.from(String(html), 'utf8')
    } else {
      throw err.bad('FILE_REQUIRED', '请提供原型 HTML')
    }

    const max = this.settings.server.maxFileBytes
    if (content.length > max) {
      throw err.bad('FILE_TOO_LARGE',
        `文件 ${(content.length / 1024 / 1024).toFixed(1)}MB 超过上限 ${(max / 1024 / 1024).toFixed(0)}MB`)
    }

    const now = new Date().toISOString()
    const version = {
      versionNo,
      title: t,
      status: rules.STORED_STATUS.includes(status) ? status : 'DRAFT',
      reviewStatus: 'pending',
      note: String(note || ''),
      tags: [...new Set((tags || []).map((t) => String(t).trim()).filter(Boolean))].slice(0, 12),
      file: `${versionNo}.html`,
      fileSize: content.length,
      sourcePath: sourcePath ? path.resolve(sourcePath) : null,
      externalRefs: detectExternalRefs(content),
      changes: this.#normalizeChanges(changes),
      requirements: this.#normalizeRequirements(requirements),
      attachments: [],
      createdAt: now,
      createdBy: currentUser(),
      updatedAt: now,
      baselineAt: null,
      specUpdatedAt: null
    }

    store.writeHtml(this.root, slug, versionNo, content)
    store.writeVersion(this.root, slug, version)
    this.#log(slug, versionNo, 'VERSION_ADD', `新增版本 ${versionNo}（${t}）`)
    return this.getVersion(slug, versionNo)
  }

  preflightVersion(slug, input = {}) {
    store.readProject(this.root, slug)
    const permission = this.writePermission()
    return versionPlanning.preflightVersion({
      ...input,
      existingVersionNos: store.listVersionNos(this.root, slug),
      maxFileBytes: this.settings.server.maxFileBytes,
      impacts: runImpact(this.root, input.changes || []),
      canWrite: input.canWrite !== false && permission.canWrite,
      gitKnown: input.gitKnown !== false && permission.mode !== 'unknown'
    })
  }

  updateVersion(slug, versionNo, { title, note }) {
    this.#assertWritable('编辑版本信息')
    const baselineNo = store.readBaseline(this.root, slug)
    const v = store.readVersion(this.root, slug, versionNo)
    rules.assertEditable(v, baselineNo, '版本信息', { enabled: this.settings.rules.lockBaseline })
    if (title !== undefined) v.title = String(title).trim() || v.title
    if (note !== undefined) v.note = String(note)
    v.updatedAt = new Date().toISOString()
    store.writeVersion(this.root, slug, v)
    this.#log(slug, versionNo, 'VERSION_UPDATE', `编辑版本信息 ${versionNo}`)
    return this.getVersion(slug, versionNo)
  }

  replaceHtml(slug, versionNo, { html = null, sourcePath = null }) {
    this.#assertWritable('替换原型文件')
    const baselineNo = store.readBaseline(this.root, slug)
    const v = store.readVersion(this.root, slug, versionNo)
    rules.assertEditable(v, baselineNo, '原型文件', { enabled: this.settings.rules.lockBaseline })

    let content
    if (sourcePath) {
      const abs = path.resolve(sourcePath)
      if (!fs.existsSync(abs)) throw err.notFound(`文件 ${sourcePath}`)
      content = fs.readFileSync(abs)
      v.sourcePath = abs
    } else {
      content = Buffer.from(String(html || ''), 'utf8')
    }
    store.writeHtml(this.root, slug, versionNo, content)
    v.fileSize = content.length
    v.externalRefs = detectExternalRefs(content)
    v.updatedAt = new Date().toISOString()
    store.writeVersion(this.root, slug, v)
    offline.clearOffline(this.root, slug, versionNo)
    this.#log(slug, versionNo, 'VERSION_REPLACE_FILE', `替换 ${versionNo} 的原型文件`)
    return this.getVersion(slug, versionNo)
  }

  /** R4 的另一半：规格书不受基线锁定 */
  setSpec(slug, versionNo, markdown) {
    this.#assertWritable('编辑规格书')
    const v = store.readVersion(this.root, slug, versionNo)
    rules.assertSpecEditable(v)
    store.writeSpec(this.root, slug, versionNo, markdown)
    v.specUpdatedAt = new Date().toISOString()
    v.updatedAt = v.specUpdatedAt
    store.writeVersion(this.root, slug, v)
    this.#log(slug, versionNo, 'SPEC_UPDATE', `更新 ${versionNo} 的规格书`)
    return this.getVersion(slug, versionNo)
  }

  setChanges(slug, versionNo, items) {
    this.#assertWritable('编辑变更日志')
    const baselineNo = store.readBaseline(this.root, slug)
    const v = store.readVersion(this.root, slug, versionNo)
    rules.assertEditable(v, baselineNo, '变更日志', { enabled: this.settings.rules.lockBaseline })
    v.changes = this.#normalizeChanges(items)
    v.updatedAt = new Date().toISOString()
    store.writeVersion(this.root, slug, v)
    this.#log(slug, versionNo, 'CHANGES_SET', `更新 ${versionNo} 的变更日志，共 ${v.changes.length} 条`)
    return this.getVersion(slug, versionNo)
  }

  addChange(slug, versionNo, item) {
    const v = store.readVersion(this.root, slug, versionNo)
    return this.setChanges(slug, versionNo, [...v.changes, item])
  }

  setRequirements(slug, versionNo, items) {
    this.#assertWritable('编辑关联需求')
    const baselineNo = store.readBaseline(this.root, slug)
    const v = store.readVersion(this.root, slug, versionNo)
    rules.assertEditable(v, baselineNo, '关联需求', { enabled: this.settings.rules.lockBaseline })
    v.requirements = this.#normalizeRequirements(items)
    v.updatedAt = new Date().toISOString()
    store.writeVersion(this.root, slug, v)
    this.#log(slug, versionNo, 'REQS_SET', `更新 ${versionNo} 的关联需求，共 ${v.requirements.length} 条`)
    return this.getVersion(slug, versionNo)
  }

  setReviewStatus(slug, versionNo, status) {
    this.#assertWritable('更新审阅状态')
    const value = rules.assertReviewStatus(status)
    const version = store.readVersion(this.root, slug, versionNo)
    if (value === 'obsolete' && version.status !== 'VOID') {
      throw err.bad('REVIEW_OBSOLETE_REQUIRES_VOID', '请通过“废弃版本”进入已废弃状态')
    }
    if (version.status === 'VOID' && value !== 'obsolete') {
      throw err.bad('VERSION_VOID', '已废弃版本需要先恢复，才能重新审阅')
    }
    version.reviewStatus = value
    version.updatedAt = new Date().toISOString()
    store.writeVersion(this.root, slug, version)
    this.#log(slug, versionNo, 'REVIEW_STATUS_SET', `审阅状态更新为 ${value}`)
    if (value === 'questions') this.queueNotification({ event: 'review.questions', project: slug, version: versionNo, reviewStatus: value })
    return this.getVersion(slug, versionNo)
  }

  // ==================== 需求 ====================

  listRequirements() {
    const records = readSyncRecords(this.root)
    return reqx.listRequirements(this.root).map((item) => this.#requirementSyncView(item, records))
  }

  getRequirement(code) {
    return this.#requirementSyncView(reqx.requirementDetail(this.root, code), readSyncRecords(this.root))
  }

  createRequirement(input) {
    this.#assertWritable('创建需求')
    const now = new Date().toISOString()
    const item = reqx.createRequirement(this.root, input, { now, actor: currentUser() })
    this.#log(null, null, 'REQUIREMENT_CREATE', `创建需求 ${item.code}`)
    return reqx.requirementDetail(this.root, item.code)
  }

  updateRequirement(code, patch) {
    this.#assertWritable('编辑需求')
    const item = reqx.updateRequirement(this.root, code, patch)
    this.#log(null, null, 'REQUIREMENT_UPDATE', `编辑需求 ${item.code}`)
    return reqx.requirementDetail(this.root, item.code)
  }

  readRequirementSpec(code) {
    return reqx.readRequirementSpec(this.root, code)
  }

  writeRequirementSpec(code, markdown) {
    this.#assertWritable('编辑需求规格书')
    const content = reqx.writeRequirementSpec(this.root, code, markdown)
    this.#log(null, null, 'REQUIREMENT_SPEC_UPDATE', `更新需求 ${code} 的规格书`, { requirement: code })
    return content
  }

  requirementConfirmationPreflight(code) {
    return confirmationPreflight(this.root, reqx.readRequirement(this.root, code))
  }

  transitionRequirement(code, input = {}) {
    this.#assertWritable('确认需求')
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw err.bad('REQUEST_BODY_INVALID', '请求体必须是 JSON 对象')
    }
    const item = reqx.readRequirement(this.root, code)
    const target = String(input.target || '').trim()
    if (!target) throw err.bad('REQUIREMENT_TARGET_REQUIRED', '请选择需求目标状态')
    const transition = transitionRequirementStatus(item.status, target)
    if (transition.changed && target === 'confirmed') {
      const check = confirmationPreflight(this.root, item)
      if (!check.ready) {
        const error = err.conflict('REQUIREMENT_CONFIRMATION_BLOCKED', `需求仍有 ${check.blockers.length} 个确认阻塞项`)
        error.blockers = check.blockers
        throw error
      }
    }
    return this.#transitionRequirement(code, target, {
      system: false,
      reason: String(input.reason || '').trim()
    })
  }

  transitionRequirementSystem(code, target, input = {}) {
    this.#assertWritable('系统流转需求状态')
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    return this.#transitionRequirement(code, String(target || ''), {
      system: true,
      reason: String(value.reason || '').trim()
    })
  }

  linkRequirement(code, slug, versionNo) {
    this.#assertWritable('关联需求')
    const item = reqx.readRequirement(this.root, code)
    const version = store.readVersion(this.root, slug, versionNo)
    const existing = (version.requirements || []).map((raw) => typeof raw === 'string' ? raw : raw.code)
    return this.setRequirements(slug, versionNo, [...existing, item.code])
  }

  unlinkRequirement(code, slug, versionNo) {
    this.#assertWritable('取消关联需求')
    const version = store.readVersion(this.root, slug, versionNo)
    const links = (version.requirements || []).map((raw) => typeof raw === 'string' ? raw : raw.code).filter((item) => item !== code)
    return this.setRequirements(slug, versionNo, links)
  }

  rebuildRequirementIndex() {
    return reqx.buildRequirementIndex(this.root)
  }

  migrationPreflight() {
    return migrate.preflightMigration(this.root)
  }

  rollbackMigration(backup) {
    this.#assertWritable('回滚数据迁移')
    return migrate.rollbackMigration(this.root, backup)
  }

  // ==================== 迭代 ====================

  listMilestones() {
    return milestones.listMilestones(this.root)
  }

  getMilestone(name) {
    return milestones.inspectMilestone(this.root, name)
  }

  #assertMilestoneFormalReleaseTarget(name, slug, versionNo) {
    const item = milestones.readMilestone(this.root, name)
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
    if (!store.readSpec(this.root, slug, versionNo).trim()) {
      throw err.conflict(
        'VERSION_SPEC_REQUIRED',
        `${slug}/${versionNo} 缺少规格书，不能正式发版`
      )
    }
    for (const code of [...new Set(item.items
      .filter((entry) => entry.project === slug && entry.version === versionNo)
      .map((entry) => entry.requirement))]) {
      const requirement = reqx.readRequirement(this.root, code)
      if (!['confirmed', 'developing', 'pending-acceptance', 'completed'].includes(requirement.status)) {
        throw err.conflict(
          'REQUIREMENT_NOT_READY_FOR_DELIVERY',
          `${code} 尚未确认，不能正式发版`
        )
      }
      if (!reqx.readRequirementSpec(this.root, code).trim()) {
        throw err.conflict(
          'REQUIREMENT_SPEC_REQUIRED',
          `${code} 缺少验收规格，不能正式发版`
        )
      }
    }
    return item
  }

  async preflightMilestoneFormalRelease(name, slug, versionNo, input = {}) {
    this.#assertMilestoneFormalReleaseTarget(name, slug, versionNo)
    return publicFormalReleasePreflight(await this.#prepareFormalRelease(slug, versionNo, input))
  }

  async formalReleaseMilestoneVersion(name, slug, versionNo, input = {}) {
    this.#assertWritable('正式发版')
    const item = milestones.readMilestone(this.root, name)
    const delivery = this.#milestoneDelivery(item, slug, versionNo)
    if (item.status !== 'active' && !delivery) {
      throw err.conflict(
        'MILESTONE_FORMAL_RELEASE_STATUS_INVALID',
        `迭代「${item.name}」只有在进行中状态才能正式发版`
      )
    }
    if (item.status === 'active') this.#assertMilestoneFormalReleaseTarget(name, slug, versionNo)
    else if (!item.items.some((entry) => entry.project === slug && entry.version === versionNo)) {
      throw err.conflict(
        'MILESTONE_FORMAL_RELEASE_OUT_OF_SCOPE',
        `${slug}/${versionNo} 不在迭代「${item.name}」的版本范围内`,
        '先核对迭代版本范围'
      )
    }
    return withMilestoneSyncLock(this.root, `formal-release:${name}:${slug}:${versionNo}`, () =>
      this.#formalRelease(name, slug, versionNo, input))
  }

  createMilestone(input) {
    this.#assertWritable('创建迭代')
    const item = milestones.createMilestone(this.root, input)
    this.#log(null, null, 'MILESTONE_CREATE', `创建迭代 ${item.name}`)
    return item
  }

  updateMilestone(name, patch) {
    this.#assertWritable('编辑迭代')
    const item = milestones.updateMilestone(this.root, name, patch)
    this.#log(null, null, 'MILESTONE_UPDATE', `编辑迭代 ${item.name}`)
    return item
  }

  removeMilestone(name) {
    this.#assertWritable('删除迭代')
    const item = milestones.removeMilestone(this.root, name)
    this.#log(null, null, 'MILESTONE_REMOVE', `删除迭代 ${item.name}`)
    return item
  }

  milestoneProviders() {
    return milestoneIntegration.milestoneProviders()
  }

  milestoneConfig(provider, overrides = {}) {
    const selected = provider || overrides.provider || 'mcp'
    if (selected === 'mcp' && !overrides.baseUrl) {
      return { ...mcpConfig.resolveCapability(this.root, 'milestones'), ...overrides }
    }
    return overrides
  }

  testMilestoneConnection(provider, overrides = {}) {
    return milestoneIntegration.testMilestoneConnection(provider, this.milestoneConfig(provider, overrides))
  }

  async syncExternalMilestones(provider = null, overrides = {}) {
    this.#assertWritable('同步迭代计划')
    const selected = provider || 'mcp'
    const remoteItems = await milestoneIntegration.listMilestones(selected, this.milestoneConfig(selected, overrides))
    const result = { provider: selected, total: remoteItems.length, created: 0, updated: 0, failed: [] }
    for (const remote of remoteItems) {
      try {
        const input = this.#externalMilestoneInput(selected, remote)
        if (milestones.milestoneExists(this.root, remote.name)) {
          milestones.updateMilestone(this.root, remote.name, input, { system: true })
          result.updated++
        } else {
          milestones.createMilestone(this.root, { ...input, name: remote.name, items: [] }, { system: true })
          result.created++
        }
      } catch (e) {
        result.failed.push({ name: remote.name, message: e.message })
      }
    }
    this.#log(null, null, 'MILESTONE_IMPORT_SYNC', `同步迭代计划 ${result.created} 新建，${result.updated} 更新`)
    return { ...result, items: milestones.listMilestones(this.root) }
  }

  async syncMilestoneToExternal(name, provider = null, overrides = {}) {
    return this.planMilestoneSync(name, {})
  }

  inspectMilestonePreflight(name) {
    const item = milestones.inspectMilestone(this.root, name)
    const info = mcpConfig.inspect(this.root)
    const integrationProblems = [...info.problems]
    const capability = info.config.capabilities.milestones
    const syncContext = resolveProjectSyncContext(this.root, item, info)
    integrationProblems.push(...syncContext.blockers)
    let currentSourceHash = ''
    if (syncContext.ready) {
      const options = capability.options || {}
      if (!Number(options.ownerId)) integrationProblems.push({ code: 'SPRINT_OWNER_REQUIRED', message: '尚未配置平台冲刺负责人' })
      if (!Number(options.taskType)) integrationProblems.push({ code: 'TASK_TYPE_REQUIRED', message: '尚未配置平台默认任务类型' })
      for (const code of new Set(item.items.map((entry) => entry.requirement))) {
        const requirement = reqx.readRequirement(this.root, code)
        if (requirement.priority && options.priorities?.[requirement.priority] === undefined) {
          integrationProblems.push({ code: 'TASK_PRIORITY_UNMAPPED', message: `${code} 的优先级 ${requirement.priority} 尚未映射` })
        }
      }
      const requirementItems = [...new Set(item.items.map((entry) => entry.requirement))].map((code) => ({
        ...reqx.requirementDetail(this.root, code),
        spec: reqx.readRequirementSpec(this.root, code)
      }))
      currentSourceHash = buildMilestoneSourceHash({
        milestone: item,
        requirements: requirementItems,
        mapping: { ...options, server: syncContext.server, projectId: Number(syncContext.projectId) },
        managedFields: syncContext.managedFields,
        versionSources: this.#milestoneVersionSources(item)
      })
    }
    const journal = this.milestoneSyncJournal(name)
    return freezePreflight(this.root, item, {
      integrationProblems,
      syncContext,
      currentSourceHash,
      verifiedSourceHash: journal.status === 'completed'
        ? linkedMilestoneSourceHash(journal.plan, journal.operations) || journal.plan?.sourceHash || ''
        : ''
    })
  }

  async planMilestoneSync(name, input = {}) {
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    const plan = await this.#withAssessAdapter(name, false, (adapter, config) => this.#buildMilestoneSyncPlan(name, value, adapter, config), value)
    const sync = await withMilestoneSyncLock(this.root, name, () => this.#saveMilestoneSyncPreview(name, plan))
    return { ...plan, syncId: sync.id, syncStatus: sync.status }
  }

  async planRequirementTaskBinding(code, input = {}) {
    this.#assertWritable('预览需求平台任务绑定')
    reqx.readRequirement(this.root, code)
    const value = externalBindings.normalizeTaskBindingInput(input)
    return this.#withProjectAssessAdapter(value.project, false, async (adapter, config) => {
      const remote = await adapter.getTask(value.remoteId)
      return withMilestoneSyncLock(this.root, 'binding:external-tasks', () => {
        const plan = externalBindings.buildTaskBindingPlan(this.root, {
          code,
          ...value,
          server: config.server.id,
          projectId: Number(config.project),
          remote
        })
        const sync = this.#saveBindingSyncPreview(plan)
        return { ...plan, syncId: sync.id, syncStatus: sync.status }
      })
    })
  }

  async planMilestoneSprintBinding(name, input = {}) {
    this.#assertWritable('预览迭代平台 Sprint 绑定')
    milestones.readMilestone(this.root, name)
    const value = externalBindings.normalizeSprintBindingInput(input)
    return this.#withProjectAssessAdapter(value.project, false, async (adapter, config) => {
      const remote = await adapter.getSprint(value.remoteId)
      return withMilestoneSyncLock(this.root, 'binding:external-sprints', () => {
        const plan = externalBindings.buildSprintBindingPlan(this.root, {
          milestoneName: name,
          ...value,
          server: config.server.id,
          projectId: Number(config.project),
          remote
        })
        const sync = this.#saveBindingSyncPreview(plan)
        return { ...plan, syncId: sync.id, syncStatus: sync.status }
      })
    })
  }

  async milestoneExecutionSummary(name) {
    const item = milestones.readMilestone(this.root, name)
    const sprintId = Number(item.external?.sprintId || 0)
    if (!sprintId) return null
    return this.#withAssessAdapter(name, false, async (adapter) => {
      const [sprint, tasks] = await Promise.all([
        adapter.getSprint(sprintId),
        adapter.listTasks({ sprintId })
      ])
      const byStatus = {}
      for (const task of tasks) {
        const key = String(task.status ?? 'unknown')
        byStatus[key] = (byStatus[key] || 0) + 1
      }
      return {
        sprint: {
          id: sprint.id,
          status: sprint.status,
          revision: sprint.revision,
          startAt: sprint.startAt,
          endAt: sprint.endAt
        },
        tasks: {
          total: tasks.length,
          unassigned: tasks.filter((task) => !task.assigneeId).length,
          byStatus
        }
      }
    })
  }

  async executeMilestoneSync(name, input = {}) {
    this.#assertWritable('执行迭代同步')
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    const planHash = String(value.planHash || '').trim()
    if (value.confirmed && !planHash) throw err.bad('MCP_SYNC_PLAN_HASH_REQUIRED', '确认同步时必须提供计划哈希')
    const record = findSyncRecord(this.root, 'milestone', name)
    if (value.confirmed && !record) {
      throw err.conflict('MCP_SYNC_PREVIEW_REQUIRED', '执行同步前必须先生成同步预览')
    }
    if (value.confirmed && record.status !== 'pending-confirmation') {
      throw err.conflict('SYNC_TRANSITION_INVALID', `同步状态不能从 ${record.status || 'unknown'} 变更为 running`)
    }
    if (planHash && record && planHash !== record.planHash) {
      throw err.conflict('MCP_SYNC_PLAN_CHANGED', '同步计划已经变化，请重新确认')
    }
    const intent = record && planHash === record.planHash ? this.#syncIntent(record) : value
    return this.#withAssessAdapter(name, true, async (adapter, config) => {
      let plan = await this.#buildMilestoneSyncPlan(name, intent, adapter, config)
      if (planHash && planHash !== plan.hash) throw err.conflict('MCP_SYNC_PLAN_CHANGED', '同步计划已经变化，请重新确认')
      const result = await withMilestoneSyncLock(this.root, name, async () => {
        if (this.#currentMilestoneSourceHash(name, intent) !== plan.sourceHash) {
          throw err.conflict('MCP_SYNC_PLAN_CHANGED', '迭代来源或项目同步目标已经变化，请重新确认')
        }
        if (intent.action === 'freeze') {
          plan = await this.#buildMilestoneSyncPlan(name, intent, adapter, config)
          if (planHash && plan.hash !== planHash) throw err.conflict('MCP_SYNC_PLAN_CHANGED', '同步计划已经变化，请重新确认')
        }
        if (value.confirmed) {
          const current = findSyncRecord(this.root, 'milestone', name)
          if (!current) throw err.conflict('MCP_SYNC_PREVIEW_REQUIRED', '执行同步前必须先生成同步预览')
          if (current.status !== 'pending-confirmation') {
            throw err.conflict('SYNC_TRANSITION_INVALID', `同步状态不能从 ${current.status || 'unknown'} 变更为 running`)
          }
          if (current.planHash !== planHash) throw err.conflict('MCP_SYNC_PLAN_CHANGED', '同步计划已经变化，请重新确认')
        }
        return executeSync({
          root: this.root,
          milestoneName: name,
          plan,
          confirmed: value.confirmed === true,
          reason: value.reason || '',
          confirmUnfinished: value.confirmUnfinished === true,
          adapter,
          actor: currentUser(),
          assertCurrentSource: () => this.#assertCurrentMilestoneSource(name, intent, this.#executedSourceHash(name, plan)),
          lockHeld: true
        })
      })
      this.#log(null, null, 'MILESTONE_SYNC_EXECUTE', `执行迭代 ${name} 同步计划 ${plan.hash}`)
      return result
    }, intent)
  }

  async resumeMilestoneSync(name, input = {}) {
    this.#assertWritable('恢复迭代同步')
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    const record = findSyncRecord(this.root, 'milestone', name)
    if (!record) throw err.notFound(`迭代「${name}」的同步记录`)
    if (!['failed', 'paused'].includes(record.status)) {
      throw err.conflict('SYNC_TRANSITION_INVALID', `同步状态不能从 ${record.status || 'unknown'} 变更为 running`)
    }
    const intent = this.#syncIntent(record)
    return this.#withAssessAdapter(name, true, async (adapter, config) => {
      const plan = await this.#buildMilestoneSyncPlan(name, intent, adapter, config)
      const result = await withMilestoneSyncLock(this.root, name, async () => {
        const current = findSyncRecord(this.root, 'milestone', name)
        if (!current) throw err.notFound(`迭代「${name}」的同步记录`)
        if (!['failed', 'paused'].includes(current.status)) {
          throw err.conflict('SYNC_TRANSITION_INVALID', `同步状态不能从 ${current.status || 'unknown'} 变更为 running`)
        }
        if (current.planHash !== record.planHash) throw err.conflict('MCP_SYNC_PLAN_CHANGED', '同步计划已经变化，请重新确认')
        if (plan.hash !== record.planHash) {
          this.#saveMilestoneSyncPreview(name, plan)
          throw err.conflict('MCP_SYNC_PLAN_CHANGED', '同步计划已经变化，请重新确认')
        }
        if (this.#currentMilestoneSourceHash(name, intent) !== plan.sourceHash) {
          throw err.conflict('MCP_SYNC_PLAN_CHANGED', '迭代来源或项目同步目标已经变化，请重新确认')
        }
        return resumeSync({
          root: this.root,
          milestoneName: name,
          plan,
          reason: value.reason || '',
          confirmUnfinished: value.confirmUnfinished === true,
          adapter,
          actor: currentUser(),
          assertCurrentSource: () => this.#assertCurrentMilestoneSource(name, intent, this.#executedSourceHash(name, plan)),
          lockHeld: true
        })
      })
      this.#log(null, null, 'MILESTONE_SYNC_RESUME', `恢复迭代 ${name} 同步`)
      return result
    }, intent)
  }

  milestoneSyncJournal(name) {
    return readMilestoneSyncJournal(this.root, name) || { milestone: name, status: 'not-started', operations: [] }
  }

  listSyncRecords(filters = {}) {
    const records = readSyncRecords(this.root, filters)
    return {
      items: records,
      counts: {
        attention: records.filter((item) => ['pending-confirmation', 'failed', 'paused'].includes(item.status)).length,
        running: records.filter((item) => item.status === 'running').length,
        completed: records.filter((item) => item.status === 'completed').length
      }
    }
  }

  getSyncRecord(id) {
    const record = readSyncRecord(this.root, id)
    if (!record) throw err.notFound(`同步记录「${id}」`)
    return record
  }

  listSyncAudit(filters = {}) {
    return readSyncAudit(this.root, filters)
  }

  async executeSyncRecord(id, input = {}) {
    this.#assertWritable('执行同步记录')
    const record = this.getSyncRecord(id)
    if (externalBindings.isBindingPlan(record.plan, record.entityType, record.entityKey)) {
      return this.#executeBindingSyncRecord(record, input, { retry: false })
    }
    this.#assertSupportedSyncEntity(record)
    if (record.status !== 'pending-confirmation') {
      throw err.conflict('SYNC_TRANSITION_INVALID', `同步状态不能从 ${record.status || 'unknown'} 变更为 running`)
    }
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    const planHash = String(value.planHash || '').trim()
    if (!planHash) throw err.bad('MCP_SYNC_PLAN_HASH_REQUIRED', '确认同步时必须提供计划哈希')
    if (planHash !== record.planHash) throw err.conflict('MCP_SYNC_PLAN_CHANGED', '同步计划已经变化，请重新确认')
    const intent = this.#syncIntent(record)
    return this.#withAssessAdapter(record.entityKey, true, async (adapter, config) => {
      let plan = await this.#buildMilestoneSyncPlan(record.entityKey, intent, adapter, config)
      return withMilestoneSyncLock(this.root, record.entityKey, async () => {
        const current = this.getSyncRecord(id)
        if (current.status !== 'pending-confirmation') {
          throw err.conflict('SYNC_TRANSITION_INVALID', `同步状态不能从 ${current.status || 'unknown'} 变更为 running`)
        }
        if (current.planHash !== record.planHash || current.planHash !== planHash) {
          throw err.conflict('MCP_SYNC_PLAN_CHANGED', '同步计划已经变化，请重新确认')
        }
        if (this.#currentMilestoneSourceHash(record.entityKey, intent) !== plan.sourceHash) {
          throw err.conflict('MCP_SYNC_PLAN_CHANGED', '迭代来源或项目同步目标已经变化，请重新确认')
        }
        if (intent.action === 'freeze') plan = await this.#buildMilestoneSyncPlan(record.entityKey, intent, adapter, config)
        if (plan.hash !== record.planHash) {
          this.#saveMilestoneSyncPreview(record.entityKey, plan)
          throw err.conflict('MCP_SYNC_PLAN_CHANGED', '同步计划已经变化，请重新确认')
        }
        return executeSync({
          root: this.root,
          milestoneName: record.entityKey,
          plan,
          confirmed: true,
          reason: String(value.reason || ''),
          confirmUnfinished: value.confirmUnfinished === true,
          adapter,
          actor: currentUser(),
          assertCurrentSource: () => this.#assertCurrentMilestoneSource(record.entityKey, intent, this.#executedSourceHash(record.entityKey, plan)),
          lockHeld: true
        })
      })
    }, intent)
  }

  async retrySyncRecord(id, input = {}) {
    this.#assertWritable('重试同步记录')
    const record = this.getSyncRecord(id)
    if (externalBindings.isBindingPlan(record.plan, record.entityType, record.entityKey)) {
      return this.#executeBindingSyncRecord(record, input, { retry: true })
    }
    this.#assertSupportedSyncEntity(record)
    if (!['failed', 'paused'].includes(record.status)) {
      throw err.conflict('SYNC_TRANSITION_INVALID', `同步状态不能从 ${record.status || 'unknown'} 变更为 running`)
    }
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    const intent = this.#syncIntent(record)
    const linkedCreate = hasLinkedCreateResult(record)
    try {
      return await this.#withAssessAdapter(record.entityKey, true, async (adapter, config) => {
        const plan = linkedCreate
          ? record.plan
          : await this.#buildMilestoneSyncPlan(record.entityKey, intent, adapter, config)
        return withMilestoneSyncLock(this.root, record.entityKey, async () => {
          const current = this.getSyncRecord(id)
          if (!['failed', 'paused'].includes(current.status)) {
            throw err.conflict('SYNC_TRANSITION_INVALID', `同步状态不能从 ${current.status || 'unknown'} 变更为 running`)
          }
          if (current.planHash !== record.planHash) throw err.conflict('MCP_SYNC_PLAN_CHANGED', '同步计划已经变化，请重新确认')
          if (hasLinkedCreateResult(current) !== linkedCreate) {
            throw err.conflict('MCP_SYNC_PLAN_CHANGED', '同步计划的关联结果已经变化，请重新操作')
          }
          const currentSourceHash = this.#currentMilestoneSourceHash(record.entityKey, intent)
          const expectedSourceHash = linkedCreate
            ? linkedMilestoneSourceHash(current.plan, current.operations)
            : plan.sourceHash
          if (!expectedSourceHash || currentSourceHash !== expectedSourceHash) {
            throw err.conflict('MCP_SYNC_PLAN_CHANGED', '迭代来源或项目同步目标已经变化，请重新生成同步计划')
          }
          if (!linkedCreate && plan.hash !== record.planHash) {
            this.#saveMilestoneSyncPreview(record.entityKey, plan)
            throw err.conflict('MCP_SYNC_PLAN_CHANGED', '同步计划已经变化，请重新确认')
          }
          return resumeSync({
            root: this.root,
            milestoneName: record.entityKey,
            plan,
            reason: String(value.reason || ''),
            confirmUnfinished: value.confirmUnfinished === true,
            adapter,
            actor: currentUser(),
            assertCurrentSource: () => this.#assertCurrentMilestoneSource(record.entityKey, intent, this.#executedSourceHash(record.entityKey, plan)),
            lockHeld: true
          })
        })
      }, intent)
    } catch (error) {
      if (linkedCreate && [
        'PROJECT_SYNC_TARGET_REQUIRED',
        'PROJECT_SYNC_TARGET_MISMATCH',
        'PROJECT_SYNC_MANAGED_FIELDS_MISMATCH',
        'MILESTONE_EXTERNAL_TARGET_MISMATCH'
      ].includes(error?.code)) {
        throw err.conflict('MCP_SYNC_PLAN_CHANGED', '项目同步目标已经变化，请重新生成同步计划')
      }
      throw error
    }
  }

  async linkSyncResult(id, input = {}) {
    this.#assertWritable('关联远端创建结果')
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    const operationKey = String(value.operationKey || '').trim()
    if (!operationKey) throw err.bad('MCP_SYNC_LINK_OPERATION_REQUIRED', '请选择需要关联的创建步骤')
    const remoteId = Number(value.remoteId)
    if (!Number.isInteger(remoteId) || remoteId <= 0) {
      throw err.bad('MCP_SYNC_LINK_REMOTE_ID_INVALID', '远端对象 ID 必须是正整数')
    }
    const reason = String(value.reason || '').trim()
    if (!reason) throw err.bad('MCP_SYNC_REASON_REQUIRED', '关联远端创建结果必须填写原因')
    const record = this.getSyncRecord(id)
    const step = getLinkableCreateStep(record, operationKey)
    const bindingLock = step.kind === 'task.create' ? 'binding:external-tasks' : 'binding:external-sprints'
    return this.#withAssessAdapter(record.entityKey, false, async (adapter, config) => {
      if (config.server?.id !== record.plan?.server || Number(config.project) !== Number(record.plan?.projectId)) {
        throw err.conflict('MCP_SYNC_PLAN_CHANGED', '项目同步目标已经变化，请重新生成同步计划')
      }
      return withMilestoneSyncLock(this.root, bindingLock, () =>
        withMilestoneSyncLock(this.root, record.entityKey, async () => {
          const current = this.getSyncRecord(id)
          if (current.planHash !== record.planHash ||
              config.server?.id !== current.plan?.server ||
              Number(config.project) !== Number(current.plan?.projectId)) {
            throw err.conflict('MCP_SYNC_PLAN_CHANGED', '项目同步计划已经变化，请重新操作')
          }
          const expectedSourceHash = linkedMilestoneSourceHash(current.plan, current.operations) || current.plan.sourceHash
          if (this.#currentMilestoneSourceHash(current.entityKey, this.#syncIntent(current)) !== expectedSourceHash) {
            throw err.conflict('MCP_SYNC_PLAN_CHANGED', '迭代来源或项目同步目标已经变化，请重新操作')
          }
          const currentStep = getLinkableCreateStep(current, operationKey)
          const remote = currentStep.kind === 'sprint.create'
            ? await adapter.getSprint(remoteId)
            : await adapter.getTask(remoteId)
          return linkMilestoneCreateResult({
            root: this.root,
            milestoneName: current.entityKey,
            operationKey,
            remoteId,
            remote,
            reason,
            lockHeld: true
          })
        }))
    }, this.#syncIntent(record))
  }

  cancelSyncRecord(id, reason) {
    this.#assertWritable('取消同步记录')
    const record = this.getSyncRecord(id)
    const value = String(reason || '').trim()
    if (!value) throw err.bad('SYNC_CANCEL_REASON_REQUIRED', '取消同步必须填写原因')
    return withMilestoneSyncLock(this.root, this.#syncRecordLockKey(record), () => {
      const current = this.getSyncRecord(id)
      this.#appendRequiredSyncAudit({
        syncId: current.id,
        action: 'sync.cancel-requested',
        status: current.status,
        entityType: current.entityType,
        entityKey: current.entityKey,
        before: { status: current.status },
        after: { reason: value }
      })
      const canceled = cancelQueuedSyncRecord(this.root, id, value)
      this.#appendRequiredSyncAudit({
        syncId: canceled.id,
        action: 'sync.canceled',
        status: canceled.status,
        entityType: canceled.entityType,
        entityKey: canceled.entityKey,
        before: { status: current.status },
        after: { status: canceled.status, reason: value }
      })
      return canceled
    })
  }

  transitionMilestone(name, input = {}) {
    this.#assertWritable('流转迭代状态')
    const item = milestones.readMilestone(this.root, name)
    const target = String(input.target || '')
    const reason = String(input.reason || '').trim()
    if (target === 'canceled' && !reason) throw err.bad('MILESTONE_REASON_REQUIRED', '取消迭代必须填写原因')
    if (item.status === 'frozen' && target === 'reviewing' && !reason) throw err.bad('MILESTONE_REASON_REQUIRED', '解除冻结必须填写原因')
    if (target === 'archived') this.#assertMilestoneArchiveReady(item)
    const transition = transitionMilestoneStatus(item.status, target, { remoteExists: Boolean(item.external?.sprintId) })
    if (transition.requiresRemote) {
      throw err.conflict('MILESTONE_REMOTE_TRANSITION_REQUIRES_SYNC', '该状态流转需要生成并执行平台同步计划')
    }
    if (target === 'frozen') {
      throw err.conflict('MILESTONE_FREEZE_REQUIRES_SYNC_PLAN', '冻结迭代必须生成并执行已验证的同步计划')
    }
    const updated = transition.changed
      ? milestones.updateMilestone(this.root, name, { status: target }, { system: true })
      : milestones.inspectMilestone(this.root, name)
    this.#log(null, null, 'MILESTONE_TRANSITION', `迭代 ${name} 从 ${transition.from} 流转到 ${transition.to}${reason ? `：${reason}` : ''}`)
    return updated
  }

  listSavedViews() {
    return savedViews.listSavedViews(this.root)
  }

  saveView(input) {
    this.#assertWritable('保存团队视图')
    return savedViews.saveView(this.root, input)
  }

  removeView(id) {
    this.#assertWritable('删除团队视图')
    return savedViews.removeView(this.root, id)
  }

  exportRequirement(code, outputDir) {
    this.#assertWritable('导出需求包')
    const target = outputDir || path.join(this.root, '.flowlark', 'cache', 'exports', `requirement-${code}`)
    return exporter.exportRequirementPackage(this.root, code, target)
  }

  exportMilestone(name, outputDir) {
    this.#assertWritable('导出迭代包')
    const target = outputDir || path.join(this.root, '.flowlark', 'cache', 'exports', `milestone-${name}`)
    return exporter.exportMilestonePackage(this.root, name, target)
  }

  listSnapshots() { return snapshots.listSnapshots(this.root) }
  getSnapshot(name) { return snapshots.readSnapshot(this.root, name) }
  deliveryMaterial(name, index) {
    const snapshot = readDeliverySnapshot(this.root, name)
    if (!Number.isSafeInteger(index) || index < 0) throw err.bad('DELIVERY_MATERIAL_INDEX_INVALID', '交付材料序号不合法')
    const material = snapshot.materials[index]
    if (!material) throw err.notFound('交付材料')
    return { name: path.basename(material.path), content: Buffer.from(material.content, 'base64') }
  }
  deliveryAcceptance(name) {
    const snapshot = readDeliverySnapshot(this.root, name)
    const records = listAcceptances(this.root, name)
    const feedback = listDeliveryFeedback(this.root, name)
    const blockingFeedback = feedback.filter((item) => item.severity === 'blocker' && item.status === 'open').length
    return { snapshot: name, snapshotHash: snapshot.contentHash, integrity: verifyDeliverySnapshot(this.root, name),
      records, feedback, ...aggregateAcceptance(snapshot.acceptance, records, { blockingFeedback }) }
  }

  recordAcceptance(name, input) {
    this.#assertWritable('提交验收结论')
    const record = appendAcceptance(this.root, name, input)
    this.#applyAcceptanceLifecycle(name)
    return record
  }

  listDeliveryFeedback(name) { return listDeliveryFeedback(this.root, name) }

  createDeliveryFeedback(name, input) {
    this.#assertWritable('记录交付反馈')
    return createDeliveryFeedback(this.root, name, input)
  }

  resolveDeliveryFeedback(name, id, input) {
    this.#assertWritable('解决交付反馈')
    const result = resolveDeliveryFeedback(this.root, name, id, input)
    this.#applyAcceptanceLifecycle(name)
    return result
  }
  inspectSnapshot(input) { return snapshots.inspectSnapshotInput(this.root, input) }
  createSnapshot(input) {
    this.#assertWritable('创建交付快照')
    const item = snapshots.createSnapshot(this.root, input)
    this.#log(null, null, 'SNAPSHOT_CREATE', `创建交付快照 ${item.name}`)
    this.queueNotification({ event: 'snapshot.created', snapshot: item.name, milestone: item.milestone || '', changeCount: item.items.length })
    return item
  }
  suggestImpact(changes, options) { return runImpact(this.root, changes, options) }

  draftVersionFromHtml(slug, baseVersionNo, { html, title = '' } = {}) {
    const base = this.getVersion(slug, baseVersionNo)
    const beforeHtml = store.readHtml(this.root, slug, baseVersionNo)
    if (!beforeHtml) throw err.notFound(`${baseVersionNo} 的原型文件`)
    return drafts.draftFromHtml({
      beforeHtml: beforeHtml.toString('utf8'),
      afterHtml: String(html || ''),
      title: title || base.title,
      requirements: base.requirements || []
    })
  }

  notificationConfig(overrides = {}) {
    const s = this.settings.integrations
    const provider = overrides.provider || s.notificationProvider
    const env = { wecom: 'FLOWLARK_WECOM_WEBHOOK', dingtalk: 'FLOWLARK_DINGTALK_WEBHOOK', slack: 'FLOWLARK_SLACK_WEBHOOK' }[provider]
    return {
      provider,
      template: overrides.template || s.notificationTemplate,
      webhookUrl: overrides.webhookUrl || secrets.getSecret(`webhook-${provider}`, { envKey: env }),
      wecomCliCommand: overrides.wecomCliCommand || s.wecomCliCommand,
      wecomTransport: overrides.wecomTransport || s.wecomTransport,
      wecomChatId: overrides.wecomChatId || overrides.chatId || s.wecomChatId
    }
  }
  listNotifications() { return notifications.listNotifications(this.root) }
  queueNotification(event) {
    const s = this.settings.integrations
    if (!s.notificationProvider || s.notificationProvider === 'none' || !s.notificationEvents.includes(event.event)) return null
    return notifications.enqueueNotification(this.root, event)
  }
  flushNotifications(overrides = {}) { return notifications.flushNotifications(this.root, this.notificationConfig(overrides)) }
  testNotification(overrides = {}) {
    const config = this.notificationConfig(overrides)
    return notifications.sendNotification(config.provider, config, { event: 'test', project: this.config.name, version: '', snapshot: '' })
  }
  setNotificationWebhook(provider, value) { return secrets.setSecret(`webhook-${provider}`, value) }
  deleteNotificationWebhook(provider) { return secrets.deleteSecret(`webhook-${provider}`) }

  // ==================== 正式发版邮件 ====================

  async #prepareFormalRelease(slug, versionNo, input = {}) {
    const blockers = []
    const warnings = []
    const pushBlocker = (code, message, hint = null, extra = {}) => blockers.push({ code, message, hint, ...extra })
    const project = store.readProject(this.root, slug)
    const version = store.readVersion(this.root, slug, versionNo)
    const baselineNo = store.readBaseline(this.root, slug)
    const releasedAt = validReleaseTime(input.releasedAt)
    const gitIdentity = this.gitSyncOverride
      ? { name: 'Test User', email: 'test@example.com', complete: true }
      : this.gitIdentity()

    if (version.status === 'VOID') pushBlocker('VERSION_VOID', `${versionNo} 已废弃，不能正式发版`)
    if (!version.baselineAt && version.reviewStatus === 'questions') {
      pushBlocker('REVIEW_QUESTIONS_BLOCKED', `${versionNo} 仍有评审疑问，不能正式发版`)
    }
    if (!store.readHtml(this.root, slug, versionNo)) {
      pushBlocker('FILE_MISSING', `${versionNo} 的原型文件丢失，不能正式发版`)
    }
    try {
      rules.assertChangelogReady(version, store.listVersionNos(this.root, slug).length, {
        enabled: this.settings.rules.requireChangelog
      })
    } catch (error) {
      pushBlocker(error.code || 'CHANGELOG_REQUIRED', error.message, error.hint)
    }

    if (!gitIdentity.complete) {
      pushBlocker('GIT_IDENTITY_REQUIRED', '正式发版前需要配置 Git 提交身份', '在 Git 面板中设置姓名和邮箱')
    }
    if (!this.gitSyncOverride) {
      const conflicts = this.gitConflicts()
      if (conflicts.length) pushBlocker('GIT_CONFLICTS', 'Git 仍有未解决冲突，不能正式发版', '先在 Git 面板完成冲突处理')
      if (this.gitInProgress()) pushBlocker('GIT_IN_PROGRESS', 'Git 同步流程尚未结束，不能正式发版', '先继续或放弃当前同步')
      if (!this.gitRemote()) pushBlocker('GIT_REMOTE_REQUIRED', '正式发版前需要配置 Git 远端')
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
    if (!this.wecomMcp) {
      pushBlocker('WECOM_MCP_UNAVAILABLE', '企业微信 MCP Sidecar 尚未连接')
    } else {
      try {
        authStatus = await this.wecomMcp.authStatus()
        if (!authStatus.installed || !authStatus.versionOk || !authStatus.authorized) {
          pushBlocker(
            'WECOM_AUTH_REQUIRED',
            authStatus.message || '企业微信 CLI 尚未就绪',
            authStatus.instruction || null
          )
        } else if (allNames.length) {
          resolution = (await this.wecomMcp.resolveContacts({ names: allNames })).results || []
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

    const otherBaselines = this.listVersions(slug, { includeDraft: true, includeVoid: true, markNew: false })
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

  async #formalRelease(milestoneName, slug, versionNo, input = {}) {
    const earlyBaseline = store.readBaseline(this.root, slug)
    const earlyVersion = store.readVersion(this.root, slug, versionNo)
    const earlyDelivery = this.#milestoneDelivery(milestones.readMilestone(this.root, milestoneName), slug, versionNo)
    if (earlyBaseline === versionNo && earlyVersion.baselineAt) {
      const existing = releaseMail.listReleaseMails(this.root)
        .find((item) => item.project === slug && item.version === versionNo && item.baselineAt === earlyVersion.baselineAt)
      const earlyRun = earlyDelivery?.releaseRunId
        ? findFormalReleaseRun(this.root, {
          milestone: milestoneName,
          project: slug,
          version: versionNo,
          baselineAt: earlyVersion.baselineAt
        })
        : null
      if (earlyDelivery) verifyDeliverySnapshot(this.root, earlyDelivery.snapshot)
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
        return this.#sendReleaseMailTask(existing, {
          git: { ok: true, skipped: true },
          snapshot: earlyDelivery.snapshot,
          releaseRunId: earlyRun?.id || null
        })
      }
    }
    const prepared = await this.#prepareFormalRelease(slug, versionNo, input)
    if (!prepared.ready) {
      throw err.bad(
        'FORMAL_RELEASE_BLOCKED',
        prepared.blockers[0]?.message || '正式发版预检未通过',
        prepared.blockers.map((item) => item.message).join('；')
      )
    }

    const currentBaseline = store.readBaseline(this.root, slug)
    const baseline = currentBaseline !== versionNo
      ? this.setBaseline(slug, versionNo)
      : this.getVersion(slug, versionNo)
    const baselineAt = baseline.baselineAt
    let run = ensureFormalReleaseRun(this.root, { milestone: milestoneName, project: slug, version: versionNo, baselineAt })
    run = markFormalReleaseStep(this.root, run.id, 'baseline', {
      status: 'complete',
      project: slug,
      version: versionNo,
      baselineAt
    })
    const existing = releaseMail.listReleaseMails(this.root)
      .find((item) => item.project === slug && item.version === versionNo && item.baselineAt === baselineAt)
    const existingDelivery = this.#milestoneDelivery(milestones.readMilestone(this.root, milestoneName), slug, versionNo)
    if (existingDelivery) verifyDeliverySnapshot(this.root, existingDelivery.snapshot)
    if (existing?.status === 'sent' && existingDelivery) {
      run = markFormalReleaseStep(this.root, run.id, 'mail', { status: 'sent', mailId: existing.id })
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
      return this.#sendReleaseMailTask(existing, {
        git: { ok: true, skipped: true },
        snapshot: existingDelivery.snapshot,
        releaseRunId: run.id
      })
    }

    let gitResult = run.steps.git?.result || null
    let releaseCommit = run.steps.git?.releaseCommit || ''
    if (!releaseCommit) {
      try {
        gitResult = await Promise.resolve(this.gitSyncOverride
          ? this.gitSyncOverride({ message: `release: ${slug}/${versionNo}`, push: true })
          : this.gitSync({ message: `release: ${slug}/${versionNo}`, push: true }))
        if (gitResultFailed(gitResult)) {
          throw Object.assign(new Error(firstFailedGitStep(gitResult)?.detail || 'Git 同步失败'), {
            code: 'GIT_SYNC_FAILED'
          })
        }
        releaseCommit = this.#currentGitHead()
        run = markFormalReleaseStep(this.root, run.id, 'git', {
          status: 'complete',
          releaseCommit,
          result: gitResult
        })
      } catch (error) {
        run = markFormalReleaseStep(this.root, run.id, 'git', {
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
      if (snapshotName) verifyDeliverySnapshot(this.root, snapshotName)
      else {
        const snapshot = createDeliverySnapshot(this.root, {
          milestone: milestoneName,
          project: slug,
          version: versionNo,
          releaseCommit
        })
        snapshotName = snapshot.name
      }
      run = markFormalReleaseStep(this.root, run.id, 'snapshot', {
        status: 'complete',
        name: snapshotName,
        releaseCommit
      })
    } catch (error) {
      run = markFormalReleaseStep(this.root, run.id, 'snapshot', {
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

    let delivery = this.#milestoneDelivery(milestones.readMilestone(this.root, milestoneName), slug, versionNo)
    if (!delivery || run.steps.lifecycle?.status !== 'complete') {
      delivery = this.#completeReleaseLifecycle(milestoneName, slug, versionNo, snapshotName, run.id)
      run = markFormalReleaseStep(this.root, run.id, 'lifecycle', {
        status: 'complete',
        delivery
      })
    }

    if (existing) {
      return this.#sendReleaseMailTask(existing, {
        git: { ok: true, result: gitResult, releaseCommit, skipped: Boolean(run.steps.git?.releaseCommit && !gitResult) },
        snapshot: snapshotName,
        releaseRunId: run.id
      })
    }
    const task = releaseMail.enqueueReleaseMail(this.root, {
      project: slug,
      version: versionNo,
      baselineAt,
      subject: prepared.subject,
      markdown: prepared.markdown,
      to: prepared.internalTo,
      cc: prepared.internalCc
    })
    run = markFormalReleaseStep(this.root, run.id, 'mail', {
      status: 'pending',
      mailId: task.id
    })
    return this.#sendReleaseMailTask(task, {
      git: { ok: true, result: gitResult, releaseCommit },
      snapshot: snapshotName,
      releaseRunId: run.id
    })
  }

  async #sendReleaseMailTask(task, { git = { ok: true, skipped: true }, snapshot = null, releaseRunId = null } = {}) {
    if (task.status === 'sent') {
      const run = releaseRunId ? markFormalReleaseStep(this.root, releaseRunId, 'mail', { status: 'sent', mailId: task.id }) : null
      return {
        status: 'complete', released: true, duplicate: true,
        baseline: { project: task.project, version: task.version, baselineAt: task.baselineAt },
        git,
        snapshot,
        delivery: snapshot ? this.#deliveryForSnapshot(snapshot) : null,
        mail: releaseMail.publicReleaseMail(task),
        run: run ? publicFormalReleaseRun(run) : null
      }
    }
    try {
      await this.wecomMcp.sendReleaseMail({
        to: task.to,
        cc: task.cc,
        subject: task.subject,
        markdown: task.markdown,
        idempotencyKey: task.idempotencyKey
      })
      const sent = releaseMail.markReleaseMailSent(this.root, task.id)
      const run = releaseRunId ? markFormalReleaseStep(this.root, releaseRunId, 'mail', { status: 'sent', mailId: task.id }) : null
      return {
        status: 'complete', released: true, duplicate: false,
        baseline: { project: task.project, version: task.version, baselineAt: task.baselineAt },
        git,
        snapshot,
        delivery: snapshot ? this.#deliveryForSnapshot(snapshot) : null,
        mail: releaseMail.publicReleaseMail(sent),
        run: run ? publicFormalReleaseRun(run) : null
      }
    } catch (error) {
      const pending = releaseMail.markReleaseMailFailed(this.root, task.id, error)
      const run = releaseRunId ? markFormalReleaseStep(this.root, releaseRunId, 'mail', {
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
        delivery: snapshot ? this.#deliveryForSnapshot(snapshot) : null,
        mail: releaseMail.publicReleaseMail(pending),
        run: run ? publicFormalReleaseRun(run) : null
      }
    }
  }

  listReleaseMails() {
    return releaseMail.listReleaseMails(this.root).map(releaseMail.publicReleaseMail)
  }

  async retryReleaseMail(id) {
    this.#assertWritable('重试发版邮件')
    const task = releaseMail.readReleaseMail(this.root, id)
    const baselineNo = store.readBaseline(this.root, task.project)
    const version = store.readVersion(this.root, task.project, task.version)
    if (baselineNo !== task.version || version.baselineAt !== task.baselineAt) {
      throw err.conflict('RELEASE_BASELINE_CHANGED', '当前基线已变化，不能自动重试这封发版邮件', '请人工核对版本后重新正式发版')
    }
    const run = findFormalReleaseRunByMail(this.root, task)
    return this.#sendReleaseMailTask(task, {
      releaseRunId: run?.id || null,
      snapshot: run?.steps.snapshot?.name || null
    })
  }

  listWorkspaces() { return workspaces.listWorkspaces() }
  addWorkspace(input) { return workspaces.addWorkspace(input) }
  removeWorkspace(pathname) { return workspaces.removeWorkspace(pathname) }
  inspectSetup(pathname) { return setupx.inspectSetup(pathname) }
  registerWorkspace(pathname, options) { return setupx.registerExistingWorkspace(pathname, options) }
  cloneWorkspace(url, pathname, options) { return setupx.cloneWorkspace(url, pathname, options) }
  checkUpdate(currentVersion, manifestUrl) { return updater.checkForUpdate(manifestUrl || this.settings.integrations.updateManifestUrl, currentVersion) }
  downloadUpdate(manifest, targetDir) { return updater.downloadUpdate(manifest, targetDir) }
  softwareUpdateStatus(options) { return updater.softwareStatus(options) }
  pullSoftwareUpdate() { return updater.pullSoftwareUpdate() }
  mirrorStatus() { return mirror.inspectMirror(this.root) }
  refreshMirror() { return mirror.refreshMirror(this.root) }
  buildWorkspaceIndex() { return workspaceIndex.buildWorkspaceIndex() }
  searchWorkspaces(query, options) { return workspaceIndex.searchWorkspaces(query, options) }
  mcpConfig() { return mcpConfig.inspect(this.root) }
  async discoverMcpServerTools(id) {
    const config = mcpConfig.readMcpConfig(this.root)
    const server = config.servers.find((item) => item.id === id)
    if (!server) throw err.notFound(`MCP 服务「${id}」`)
    if (server.type !== 'stdio') throw err.bad('MCP_DISCOVERY_TRANSPORT_UNSUPPORTED', '当前只对本机 stdio 服务提供工具发现')
    const profile = mcpRuntime.getRuntimeProfile(this.root, server.runtimeProfile)
    if (!profile) throw err.notFound(`MCP 本机配置「${server.runtimeProfile}」`)
    const diagnostic = mcpRuntime.diagnoseExecutable(profile)
    if (!diagnostic.ready) throw err.conflict('MCP_RUNTIME_BLOCKED', diagnostic.blockers[0]?.message || 'MCP 可执行文件检查未通过')
    const session = await this.mcpClientManager.connect({
      type: 'stdio', command: profile.command, args: profile.args,
      env: mcpRuntime.runtimeEnvironment(this.root, server.runtimeProfile),
      cwd: this.root, timeoutMs: server.timeoutMs
    })
    try {
      const tools = await session.listTools()
      return {
        server: id,
        tools: tools.map((tool) => ({
          name: String(tool.name || ''),
          description: String(tool.description || ''),
          inputSchema: tool.inputSchema || { type: 'object', properties: {} }
        }))
      }
    } finally {
      await session.close()
    }
  }
  mcpRuntimeProfile(id) { return mcpRuntime.inspectRuntimeProfile(this.root, id) }
  saveMcpRuntimeProfile(id, input) {
    this.#assertWritable('保存 MCP 本机运行配置')
    return mcpRuntime.saveRuntimeProfile(this.root, id, input)
  }
  removeMcpRuntimeProfile(id) {
    this.#assertWritable('删除 MCP 本机运行配置')
    return mcpRuntime.removeRuntimeProfile(this.root, id)
  }
  diagnoseMcpRuntime(id) {
    const profile = mcpRuntime.getRuntimeProfile(this.root, id)
    if (!profile) throw err.notFound(`MCP 本机配置「${id}」`)
    return mcpRuntime.diagnoseExecutable(profile)
  }
  setMcpRuntimePassword(id, value) {
    this.#assertWritable('保存 MCP 平台密码')
    return mcpRuntime.setRuntimePassword(this.root, id, value)
  }
  deleteMcpRuntimePassword(id) {
    this.#assertWritable('删除 MCP 平台密码')
    return mcpRuntime.deleteRuntimePassword(this.root, id)
  }
  saveMcpServer(input) {
    this.#assertWritable('保存 MCP 服务')
    return mcpConfig.saveServer(this.root, input)
  }
  removeMcpServer(id) {
    this.#assertWritable('删除 MCP 服务')
    return mcpConfig.removeServer(this.root, id)
  }
  saveMcpCapability(name, input) {
    this.#assertWritable('保存 MCP 能力')
    return mcpConfig.saveCapability(this.root, name, input)
  }
  removeMcpCapability(name) {
    this.#assertWritable('删除 MCP 能力')
    return mcpConfig.removeCapability(this.root, name)
  }
  async testMcpCapability(name) {
    if (name === 'requirements') return this.testRequirementConnection('mcp')
    if (name === 'milestones') {
      const config = mcpConfig.resolveCapability(this.root, 'milestones')
      if (config.transport === 'stdio' && config.adapter === 'assess-task') {
        return this.#withAssessAdapter(null, false, async (adapter) => {
          const identity = await adapter.probe()
          return { provider: 'assess-task', ok: true, identity: identity.name || identity.account, account: identity.account }
        })
      }
      return this.testMilestoneConnection('mcp')
    }
    const config = mcpConfig.resolveCapability(this.root, name)
    const testTool = config.tools.test || config.mePath
    if (!testTool) throw err.bad('MCP_CAPABILITY_TEST_MISSING', `${config.capability.label || name} MCP 能力没有配置连接测试工具`)
    const body = await callTool(config, testTool, { project: config.project || '', capability: name })
    return { provider: 'mcp', ok: true, capability: name, identity: identityFromMcpTest(body), result: body }
  }
  setMcpServerSecret(id, value) { return mcpConfig.setServerSecret(id, value) }
  deleteMcpServerSecret(id) { return mcpConfig.deleteServerSecret(id) }

  // ==================== 基线 ====================

  /**
   * 设为当前基线。
   *
   * 对比 SQLite 版本：那时要在事务里「把旧的降级 + 把新的升级」，中间失败就留下脏状态。
   * 现在基线是一个文件指针，整个操作就是一次原子写入，物理上不存在两个基线。
   */
  setBaseline(slug, versionNo) {
    this.#assertWritable('设置基线')
    const baselineNo = store.readBaseline(this.root, slug)
    const v = store.readVersion(this.root, slug, versionNo)

    if (rules.isBaseline(v, baselineNo)) {
      throw err.bad('ALREADY_BASELINE', `${versionNo} 已经是当前基线`)
    }
    if (v.status === 'VOID') {
      throw err.bad('VERSION_VOID', `${versionNo} 已废弃，不能设为基线`, '先 reopen 恢复')
    }
    if (!v.baselineAt && v.reviewStatus === 'questions') {
      throw err.bad('REVIEW_QUESTIONS_BLOCKED', `${versionNo} 仍有评审疑问，不能设为基线`, '先处理问题并更新评审状态')
    }
    if (!store.readHtml(this.root, slug, versionNo)) {
      throw err.bad('FILE_MISSING', `${versionNo} 的原型文件丢失，不能设为基线`)
    }

    const total = store.listVersionNos(this.root, slug).length
    rules.assertChangelogReady(v, total, { enabled: this.settings.rules.requireChangelog })

    const isRollback = !!v.baselineAt
    const now = new Date().toISOString()

    // 只有首次成为基线才记 baselineAt —— 它同时是「历史版本」的判据和 R6 回滚豁免的依据
    if (!v.baselineAt) v.baselineAt = now
    v.status = 'READY'
    v.reviewStatus = 'confirmed'
    v.updatedAt = now
    store.writeVersion(this.root, slug, v)
    store.writeBaseline(this.root, slug, versionNo)

    this.#log(
      slug, versionNo,
      isRollback ? 'BASELINE_ROLLBACK' : 'BASELINE_SET',
      (isRollback ? `回滚基线至 ${versionNo}` : `设为基线 ${versionNo}`) +
        (baselineNo ? `，原基线 ${baselineNo} 降为历史版本` : ''),
      { from: baselineNo, to: versionNo }
    )
    this.queueNotification({ event: 'baseline.created', project: slug, version: versionNo, changeCount: v.changes.length })
    return this.getVersion(slug, versionNo)
  }

  /** R3：回滚到上一个当过基线的版本。找不到就明确报错，不猜。 */
  rollback(slug) {
    const baselineNo = store.readBaseline(this.root, slug)
    if (!baselineNo) throw err.bad('NO_BASELINE', `项目 ${slug} 当前没有基线`, '先设一个：flowlark baseline <项目> <版本号>')

    const candidates = store
      .listVersionNos(this.root, slug)
      .map((no) => store.readVersion(this.root, slug, no))
      .filter((v) => v.versionNo !== baselineNo && v.baselineAt && v.status !== 'VOID')
      .sort((a, b) => (a.baselineAt < b.baselineAt ? 1 : -1))

    if (candidates.length === 0) {
      throw err.bad('NO_PREVIOUS_BASELINE', `项目 ${slug} 没有可回滚的历史基线`,
        `${baselineNo} 是唯一当过基线的版本`)
    }
    return this.setBaseline(slug, candidates[0].versionNo)
  }

  rollbackPreview(slug) {
    const baselineNo = store.readBaseline(this.root, slug)
    if (!baselineNo) throw err.bad('NO_BASELINE', `项目 ${slug} 当前没有基线`, '先设置一个基线')
    const candidates = store
      .listVersionNos(this.root, slug)
      .map((no) => store.readVersion(this.root, slug, no))
      .filter((version) => version.versionNo !== baselineNo && version.baselineAt && version.status !== 'VOID')
      .sort((a, b) => String(b.baselineAt).localeCompare(String(a.baselineAt)))
    if (!candidates.length) {
      throw err.bad('NO_PREVIOUS_BASELINE', `项目 ${slug} 没有可回滚的历史基线`, `${baselineNo} 是唯一当过基线的版本`)
    }
    const current = this.getVersion(slug, baselineNo)
    const target = this.getVersion(slug, candidates[0].versionNo)
    const changes = this.cumulative(slug, target.versionNo, current.versionNo)
    const requirements = [...new Set(changes.items.map((item) => String(item.requirement || '').trim()).filter(Boolean))]
    return {
      current,
      target,
      changes,
      changeCounts: versionPlanning.changeCounts(changes.items),
      requirements,
      notificationProvider: this.settings.integrations.notificationProvider || 'none'
    }
  }

  // ==================== 生命周期 ====================

  voidVersion(slug, versionNo) {
    this.#assertWritable('废弃版本')
    const baselineNo = store.readBaseline(this.root, slug)
    const v = store.readVersion(this.root, slug, versionNo)
    rules.assertNotBaseline(v, baselineNo, '废弃')
    v.status = 'VOID'
    v.reviewStatus = 'obsolete'
    v.updatedAt = new Date().toISOString()
    store.writeVersion(this.root, slug, v)
    this.#log(slug, versionNo, 'VERSION_VOID', `废弃版本 ${versionNo}`)
    return this.getVersion(slug, versionNo)
  }

  reopenVersion(slug, versionNo) {
    this.#assertWritable('恢复版本')
    const v = store.readVersion(this.root, slug, versionNo)
    if (v.status !== 'VOID') throw err.bad('NOT_VOID', `${versionNo} 不是已废弃状态`)
    v.status = 'DRAFT'
    v.reviewStatus = 'pending'
    v.updatedAt = new Date().toISOString()
    store.writeVersion(this.root, slug, v)
    this.#log(slug, versionNo, 'VERSION_REOPEN', `恢复版本 ${versionNo} 为编辑中`)
    return this.getVersion(slug, versionNo)
  }

  removeVersion(slug, versionNo) {
    this.#assertWritable('删除版本')
    const baselineNo = store.readBaseline(this.root, slug)
    const v = store.readVersion(this.root, slug, versionNo)
    rules.assertNotBaseline(v, baselineNo, '删除')
    const dir = store.trashVersion(this.root, slug, versionNo, currentUser())
    this.#log(slug, versionNo, 'VERSION_REMOVE', `删除版本 ${versionNo}（移入回收站，可恢复）`)
    return { versionNo, trashDir: dir }
  }

  listTrash(slug = null) {
    return store.listTrash(this.root, slug).map((entry) => ({
      ...entry,
      ...trashRestoreState(this.root, entry)
    }))
  }

  restoreTrashEntry(id) {
    this.#assertWritable('恢复版本')
    const entry = store.readTrashEntry(this.root, id)
    const state = trashRestoreState(this.root, entry)
    if (!state.canRestore) {
      if (state.blockedReason === 'VERSION_EXISTS') {
        throw err.conflict('VERSION_EXISTS', `版本号「${entry.versionNo}」已被重新占用，无法恢复`, '先处理现有同号版本')
      }
      if (state.blockedReason === 'PROJECT_NOT_FOUND') {
        throw err.conflict('PROJECT_NOT_FOUND', `项目「${entry.project}」已不存在，无法恢复`, '先恢复或重建项目')
      }
      throw err.conflict('TRASH_INCOMPLETE', '回收站记录数据不完整，无法恢复', '检查回收站中的版本 JSON 和 HTML 文件')
    }
    store.restoreFromTrash(this.root, entry.dir, entry.project)
    this.#log(entry.project, entry.versionNo, 'VERSION_RESTORE', `从回收站恢复版本 ${entry.versionNo}`)
    return this.getVersion(entry.project, entry.versionNo)
  }

  restoreVersion(slug, versionNo) {
    this.#assertWritable('恢复版本')
    const entry = store.listTrash(this.root, slug).find((t) => t.versionNo === versionNo)
    if (!entry) throw err.notFound(`回收站中的版本「${versionNo}」`)
    if (store.versionExists(this.root, slug, versionNo)) {
      throw err.conflict('VERSION_EXISTS', `版本号「${versionNo}」已被重新占用，无法恢复`,
        '先把现有的同号版本改名或删除')
    }
    store.restoreFromTrash(this.root, entry.dir, slug)
    this.#log(slug, versionNo, 'VERSION_RESTORE', `从回收站恢复版本 ${versionNo}`)
    return this.getVersion(slug, versionNo)
  }

  // ==================== 累计变更 ====================

  /**
   * 聚合 (from, to] 区间内所有版本的变更，并统计每个位置被改动的次数。
   *
   * 存在的理由：研发上次看的可能是好几版之前，他要的是变更合集而不是逐版翻。
   * 顺带把反复返工的区域顶出来 —— 这是手写变更日志这个低成本方案唯一能产出的洞察。
   */
  cumulative(slug, fromNo, toNo) {
    const ordered = this.listVersions(slug, { includeDraft: true, includeVoid: false })
    const toIdx = ordered.findIndex((v) => v.versionNo === toNo)
    if (toIdx < 0) throw err.notFound(`终点版本「${toNo}」`)

    const fromIdx = fromNo ? ordered.findIndex((v) => v.versionNo === fromNo) : -1
    const end = fromIdx < 0 ? toIdx + 1 : Math.max(fromIdx, toIdx + 1)
    const segment = ordered.slice(toIdx, end)

    const items = []
    const locationCounts = {}
    for (const v of segment) {
      for (const c of v.changes) {
        items.push({ ...c, fromVersionNo: v.versionNo })
        const loc = (c.location || '').trim() || '未标注位置'
        locationCounts[loc] = (locationCounts[loc] || 0) + 1
      }
    }
    return {
      fromVersionNo: fromIdx < 0 ? null : ordered[fromIdx].versionNo,
      toVersionNo: toNo,
      versionCount: segment.length,
      itemCount: items.length,
      items,
      locationCounts
    }
  }

  oplog(options) {
    return store.readOplog(this.root, options)
  }

  // ==================== 标签 ====================

  /**
   * 标签用于标注里程碑（如「已评审」「已交付」）。
   * 刻意不受 R4 锁定影响 —— 标签是事后追加的组织信息，
   * 和「这一版原型长什么样」这个事实无关，锁死它没有道理。
   */
  setTags(slug, versionNo, tags) {
    this.#assertWritable('编辑标签')
    const v = store.readVersion(this.root, slug, versionNo)
    const clean = [...new Set(
      (tags || [])
        .map((t) => String(t).trim())
        .filter(Boolean)
        .map((t) => t.slice(0, 24))
    )].slice(0, 12)
    v.tags = clean
    v.updatedAt = new Date().toISOString()
    store.writeVersion(this.root, slug, v)
    this.#log(slug, versionNo, 'TAGS_SET', `更新 ${versionNo} 的标签：${clean.join('、') || '（已清空）'}`)
    return this.getVersion(slug, versionNo)
  }

  addTag(slug, versionNo, tag) {
    const v = store.readVersion(this.root, slug, versionNo)
    return this.setTags(slug, versionNo, [...(v.tags || []), tag])
  }

  removeTag(slug, versionNo, tag) {
    const v = store.readVersion(this.root, slug, versionNo)
    return this.setTags(slug, versionNo, (v.tags || []).filter((t) => t !== tag))
  }

  /** 全仓库用过的标签，供补全与筛选 */
  allTags() {
    const counts = new Map()
    for (const p of store.listProjectSlugs(this.root)) {
      for (const no of store.listVersionNos(this.root, p)) {
        for (const t of store.readVersion(this.root, p, no).tags || []) {
          counts.set(t, (counts.get(t) || 0) + 1)
        }
      }
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
  }

  // ==================== 搜索 ====================

  search(query, options) {
    return runSearch(this, query, options)
  }

  // ==================== 已读标记 ====================

  markRead(slug, versionNo) {
    store.readVersion(this.root, slug, versionNo) // 存在性校验
    return readstate.markRead(this.root, slug, versionNo)
  }

  getRead(slug) {
    return readstate.getRead(this.root, slug)
  }

  clearRead(slug) {
    return readstate.clearRead(this.root, slug)
  }

  /**
   * 「自我上次看过之后改了什么」。
   *
   * 终点取时间线上**最新的一版**，不是基线 —— 用户问的是「有什么新东西」，
   * 而新增的往往还是草稿状态、尚未成为基线。取基线会出现
   * 「read 说新增了 1 个版本，diff 却说 0 条变更」这种自相矛盾的口径。
   *
   * 没有已读记录时退化为「比上一版改了什么」—— 总要给个有意义的默认值。
   */
  sinceLastRead(slug) {
    const versions = this.listVersions(slug, { includeDraft: true, includeVoid: false })
    if (versions.length === 0) throw err.bad('NO_VERSION', `项目 ${slug} 还没有版本`)

    const newest = versions[0].versionNo
    const read = readstate.getRead(this.root, slug)
    const fallback = versions.length > 1 ? versions[1].versionNo : null
    const from = read && versions.some((v) => v.versionNo === read.versionNo)
      ? read.versionNo
      : fallback

    return {
      ...this.cumulative(slug, from, newest),
      basedOnReadState: !!read,
      lastReadVersionNo: read ? read.versionNo : null
    }
  }

  // ==================== 离线版本 ====================

  async buildOffline(slug, versionNo) {
    this.#assertWritable('生成离线版本')
    offline.assertFetchAvailable()
    const v = store.readVersion(this.root, slug, versionNo)
    const html = store.readHtml(this.root, slug, versionNo)
    if (!html) throw err.notFound(`${versionNo} 的原型文件`)

    if (v.externalRefs.length === 0) {
      // 没有外链的原型本来就是自包含的，直接拷一份，行为保持一致
      const f = offline.offlinePath(this.root, slug, versionNo)
      fs.mkdirSync(path.dirname(f), { recursive: true })
      fs.writeFileSync(f, html)
      return { ok: true, total: 0, inlined: 0, failed: [], bytes: html.length, file: f, alreadySelfContained: true }
    }

    const result = await offline.buildOffline(this.root, slug, versionNo, html)
    this.#log(slug, versionNo, 'OFFLINE_BUILD',
      `生成离线版本，内联 ${result.inlined}/${result.total} 个外部资源`)
    return result
  }

  hasOffline(slug, versionNo) {
    return offline.hasOffline(this.root, slug, versionNo)
  }

  readOffline(slug, versionNo) {
    return offline.readOffline(this.root, slug, versionNo)
  }

  clearOffline(slug, versionNo) {
    this.#assertWritable('清理离线版本')
    offline.clearOffline(this.root, slug, versionNo)
  }

  // ==================== 附件 ====================

  /**
   * 挂一个文件到版本下：PRD、设计稿、评审纪要、截图都行。
   *
   * 附件**随 Git 提交**，因为它们是真实交付物。
   * 但它们不受 R4 基线锁定 —— 和规格书同理，事后补一份评审纪要是常态，
   * 锁死会逼产品为了加个附件去发一个假版本。
   */
  addAttachment(slug, versionNo, { name, content = null, sourcePath = null, contentType = '' }) {
    this.#assertWritable('添加附件')
    const v = store.readVersion(this.root, slug, versionNo)
    rules.assertSpecEditable(v)

    let buf
    let finalName = name
    if (sourcePath) {
      const abs = path.resolve(sourcePath)
      if (!fs.existsSync(abs)) throw err.notFound(`文件 ${sourcePath}`)
      if (fs.statSync(abs).isDirectory()) {
        throw err.bad('ATTACHMENT_IS_DIR', `${path.basename(abs)} 是目录，不能作为附件`, '先打包成 zip')
      }
      buf = fs.readFileSync(abs)
      finalName = finalName || path.basename(abs)
    } else if (content != null) {
      buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content))
    } else {
      throw err.bad('FILE_REQUIRED', '请提供附件内容')
    }

    const max = this.settings.server.maxFileBytes
    if (buf.length > max) {
      throw err.bad('FILE_TOO_LARGE',
        `附件 ${(buf.length / 1024 / 1024).toFixed(1)}MB 超过上限 ${(max / 1024 / 1024).toFixed(0)}MB`,
        '调大上限：flowlark config server.maxFileBytes 50MB')
    }

    const safe = store.safeAttachmentName(finalName)
    store.writeAttachment(this.root, slug, versionNo, safe, buf)

    const entry = {
      name: safe,
      size: buf.length,
      contentType: contentType || guessContentType(safe),
      addedAt: new Date().toISOString(),
      addedBy: currentUser()
    }
    // 同名视为覆盖，不产生两条记录
    v.attachments = [...v.attachments.filter((a) => a.name !== safe), entry]
    v.updatedAt = entry.addedAt
    store.writeVersion(this.root, slug, v)

    this.#log(slug, versionNo, 'ATTACHMENT_ADD', `为 ${versionNo} 添加附件 ${safe}`)
    return this.getVersion(slug, versionNo)
  }

  readAttachment(slug, versionNo, name) {
    const v = store.readVersion(this.root, slug, versionNo)
    const meta = v.attachments.find((a) => a.name === store.safeAttachmentName(name))
    const buf = store.readAttachment(this.root, slug, versionNo, name)
    if (!buf) throw err.notFound(`附件「${name}」`)
    return { buf, meta: meta || { name, contentType: guessContentType(name) } }
  }

  removeAttachment(slug, versionNo, name) {
    this.#assertWritable('删除附件')
    const v = store.readVersion(this.root, slug, versionNo)
    rules.assertSpecEditable(v)
    const safe = store.safeAttachmentName(name)
    store.deleteAttachment(this.root, slug, versionNo, safe)
    v.attachments = v.attachments.filter((a) => a.name !== safe)
    v.updatedAt = new Date().toISOString()
    store.writeVersion(this.root, slug, v)
    this.#log(slug, versionNo, 'ATTACHMENT_REMOVE', `删除 ${versionNo} 的附件 ${safe}`)
    return this.getVersion(slug, versionNo)
  }

  // ==================== 配置 ====================

  listConfig() {
    return cfg.list(this.settings)
  }

  getConfig(key) {
    return cfg.get(this.settings, key)
  }

  /**
   * 改配置。端口之类的改动需要重启服务才生效，这里如实告诉调用方，
   * 而不是让用户改完发现没反应。
   */
  setConfig(key, rawValue) {
    this.#assertWritable('修改配置')
    const { settings, value, problems } = cfg.set(this.settings, key, rawValue)
    this.config.settings = settings
    writeConfig(this.root, this.config)

    // Git 相关配置要落到 git 自己的配置里才真正生效
    const sideEffects = this.#applyGitConfig(key, value)

    this.#log(null, null, 'CONFIG_SET', `配置 ${key} = ${JSON.stringify(value)}`)
    return {
      key,
      value,
      problems,
      needsRestart: key.startsWith('server.'),
      sideEffects
    }
  }

  resetConfig(key) {
    const schema = cfg.describe(key)
    if (!schema) throw err.bad('UNKNOWN_CONFIG_KEY', `没有这个配置项：${key}`)
    return this.setConfig(key, Array.isArray(schema.default) ? schema.default.join(',') : String(schema.default))
  }

  configProblems() {
    return cfg.validateAll(this.settings)
  }

  #applyGitConfig(key, value) {
    const out = []
    if (!gitx.isRepo(this.root)) return out
    if (key === 'git.remote' && value) {
      out.push(gitx.setRemote(this.root, value))
    } else if (key === 'git.userName' && value) {
      gitx.git(this.root, ['config', 'user.name', value])
      out.push(`已写入 git config user.name`)
    } else if (key === 'git.userEmail' && value) {
      gitx.git(this.root, ['config', 'user.email', value])
      out.push(`已写入 git config user.email`)
    }
    return out
  }

  // ==================== Git ====================

  gitStatus(options) {
    return gitx.status(this.root, options)
  }

  gitRemote() {
    return gitx.getRemote(this.root)
  }

  gitSetRemote(url) {
    this.#assertWritable('设置远端')
    const msg = gitx.setRemote(this.root, url)
    this.config.settings.git.remote = url
    writeConfig(this.root, this.config)
    this.#log(null, null, 'GIT_REMOTE_SET', `设置远端 ${url}`)
    return { url, message: msg }
  }

  gitRemoveRemote() {
    this.#assertWritable('移除远端')
    gitx.removeRemote(this.root)
    this.config.settings.git.remote = ''
    writeConfig(this.root, this.config)
    this.#log(null, null, 'GIT_REMOTE_REMOVE', '移除远端')
    return { ok: true }
  }

  gitSync(options) {
    this.#assertWritable('同步 Git')
    return gitx.sync(this.root, options)
  }

  gitVersionHistory(slug, versionNo, limit) {
    return gitx.versionHistory(this.root, slug, versionNo, limit)
  }

  gitBaselineHistory(slug, limit) {
    return gitx.baselineHistory(this.root, slug, limit)
  }

  gitSpecAt(slug, versionNo, ref) {
    return gitx.specAt(this.root, slug, versionNo, ref)
  }

  gitSpecHistory(slug, versionNo, limit) {
    const rel = path.relative(this.root, store.paths.versionSpec(this.root, slug, versionNo))
    return gitx.fileHistory(this.root, rel, limit)
  }

  gitConflicts() {
    return gitx.listConflicts(this.root)
  }

  gitBaselineConflict(slug) {
    return gitx.readBaselineConflict(this.root, slug)
  }

  gitResolveBaseline(slug, versionNo) {
    this.#assertWritable('解决基线冲突')
    const r = gitx.resolveBaselineConflict(this.root, slug, versionNo)
    this.#log(slug, versionNo, 'CONFLICT_RESOLVE', `解决基线冲突，保留 ${versionNo}`)
    return r
  }

  gitContributors(slug, limit) {
    return gitx.contributors(this.root, slug, limit)
  }

  // ==================== Git 助手 ====================
  //
  // 以前这些事都靠在界面上打印一行命令、让用户自己去终端敲。
  // 现在每一件都是产品自己能执行的动作。

  /** 体检：当前处境是什么、下一件该做的事是什么 */
  gitDoctor() {
    return gitx.diagnose(this.root)
  }

  gitInit({ name, email, message, remote } = {}) {
    this.#assertWritable('纳入 Git 管理')
    const r = gitx.initRepo(this.root, { name, email, message })
    if (remote && String(remote).trim()) {
      gitx.setRemote(this.root, String(remote).trim())
      this.config.settings.git.remote = String(remote).trim()
      writeConfig(this.root, this.config)
      r.steps.push({ name: '远端', ok: true, detail: `已配置 ${String(remote).trim()}` })
    }
    this.#log(null, null, 'GIT_INIT', '把仓库纳入 Git 管理')
    return r
  }

  gitIdentity() {
    return gitx.identity(this.root)
  }

  gitSetIdentity({ name, email, global: isGlobal } = {}) {
    this.#assertWritable('设置提交身份')
    const r = gitx.setIdentity(this.root, { name, email, global: isGlobal })
    // 同步到 Flowlark 自己的配置，两处身份保持一致，用户只需要填一次
    if (name) this.config.settings.git.userName = String(name).trim()
    if (email) this.config.settings.git.userEmail = String(email).trim()
    writeConfig(this.root, this.config)
    this.#log(null, null, 'GIT_IDENTITY', `设置提交身份（${r.scope}）`)
    return { ...r, identity: gitx.identity(this.root) }
  }

  gitInProgress() {
    return gitx.inProgress(this.root)
  }

  gitMarkResolved(paths) {
    this.#assertWritable('标记冲突已解决')
    const r = gitx.markResolved(this.root, paths)
    this.#log(null, null, 'CONFLICT_RESOLVE', `标记 ${r.files.length} 个文件已解决`)
    return r
  }

  gitContinue() {
    this.#assertWritable('继续同步')
    const r = gitx.continueInProgress(this.root)
    if (r.done) this.#log(null, null, 'GIT_CONTINUE', '完成中断的同步')
    return r
  }

  gitAbort() {
    this.#assertWritable('放弃同步')
    const r = gitx.abortInProgress(this.root)
    if (r.aborted) this.#log(null, null, 'GIT_ABORT', '放弃中断的同步')
    return r
  }

  /** 建议一条提交说明。没有 AI 也能用，写不准就返回 null 让用户自己填 */
  gitSuggestMessage() {
    return { message: assistant.suggestMessage(this.root) }
  }

  /** 生成交给 AI 助理的说明。只给路径、状态和规则，不外发原型内容 */
  gitBrief(intent) {
    return {
      intent: intent || 'commit',
      text: assistant.brief(this.root, intent),
      rules: assistant.ASSISTANT_RULES
    }
  }

  gitChangeSummary() {
    return assistant.changeSummary(this.root)
  }

  writePermission() {
    return permissions.status(this.root)
  }

  refreshWritePermission() {
    return permissions.refresh(this.root)
  }

  // ==================== 反馈 ====================

  createFeedbackDraft(input, screenshot = null) {
    return feedback.saveFeedbackDraft(this.root, input, screenshot)
  }

  listFeedbackDrafts() {
    return feedback.listFeedbackDrafts(this.root)
  }

  getFeedbackDraft(id) {
    return feedback.readFeedbackDraft(this.root, id)
  }

  feedbackMarkdown(id) {
    return feedback.renderFeedbackMarkdown(feedback.readFeedbackDraft(this.root, id))
  }

  feedbackScreenshot(id) {
    return feedback.readFeedbackScreenshot(this.root, id)
  }

  removeFeedbackDraft(id) {
    return feedback.removeFeedbackDraft(this.root, id)
  }

  issueProviders() {
    return issuex.issueProviders()
  }

  issueConfig(provider, overrides = {}) {
    const s = this.settings.integrations
    const env = {
      github: 'FLOWLARK_GITHUB_TOKEN',
      gitlab: 'FLOWLARK_GITLAB_TOKEN',
      gitee: 'FLOWLARK_GITEE_TOKEN'
    }[provider]
    return {
      baseUrl: overrides.baseUrl || s.issueBaseUrl,
      projectId: overrides.projectId || overrides.project || s.issueProject,
      owner: overrides.owner || s.issueOwner,
      repo: overrides.repo || s.issueRepo,
      labels: overrides.labels || s.issueLabels,
      token: overrides.token || secrets.getSecret(provider, { envKey: env })
    }
  }

  testIssueConnection(provider, overrides = {}) {
    return issuex.testIssueConnection(provider, this.issueConfig(provider, overrides))
  }

  submitFeedback(id, { provider, config = {} } = {}) {
    const selected = provider || this.settings.integrations.issueProvider
    if (!selected || selected === 'markdown') {
      return Promise.resolve({ provider: 'markdown', markdown: this.feedbackMarkdown(id), fallback: true })
    }
    const draft = feedback.readFeedbackDraft(this.root, id)
    return issuex.createIssue(selected, this.issueConfig(selected, config), draft)
  }

  searchFeedbackIssues(provider, query, overrides = {}) {
    return issuex.searchIssues(provider, this.issueConfig(provider, overrides), query)
  }

  setIssueToken(provider, token) {
    return secrets.setSecret(provider, token)
  }

  deleteIssueToken(provider) {
    return secrets.deleteSecret(provider)
  }

  requirementProviders() {
    return reqIntegration.requirementProviders()
  }

  requirementConfig(provider, overrides = {}) {
    const s = this.settings.integrations
    const selected = provider || overrides.provider || s.requirementProvider
    if (selected === 'mcp' && !overrides.baseUrl) {
      try {
        return { ...mcpConfig.resolveCapability(this.root, 'requirements'), ...overrides }
      } catch (e) {
        if (e.code !== 'MCP_CAPABILITY_DISABLED' || !s.requirementBaseUrl) throw e
      }
    }
    return {
      provider: selected,
      baseUrl: overrides.baseUrl || s.requirementBaseUrl,
      project: overrides.project || s.requirementProject,
      searchPath: overrides.searchPath || s.requirementSearchPath,
      detailPath: overrides.detailPath || s.requirementDetailPath,
      commentPath: overrides.commentPath || s.requirementCommentPath,
      tokenHeader: overrides.tokenHeader,
      token: overrides.token || secrets.getSecret(`requirement-${selected}`, { envKey: 'FLOWLARK_REQUIREMENT_MCP_TOKEN' })
    }
  }

  testRequirementConnection(provider, overrides = {}) {
    return reqIntegration.testRequirementConnection(provider, this.requirementConfig(provider, overrides))
  }

  searchExternalRequirements(provider, query, overrides = {}) {
    return reqIntegration.searchRequirements(provider, this.requirementConfig(provider, overrides), query)
  }

  async importExternalRequirement(provider, key, overrides = {}) {
    this.#assertWritable('导入外部需求')
    const remote = await reqIntegration.fetchRequirement(provider, this.requirementConfig(provider, overrides), key)
    const input = this.#externalRequirementInput(provider, remote)
    const item = this.#saveExternalRequirement(input)
    this.#log(null, null, 'REQUIREMENT_IMPORT', `导入外部需求 ${item.code}`)
    return reqx.requirementDetail(this.root, item.code)
  }

  async syncExternalRequirements(provider = null, overrides = {}) {
    this.#assertWritable('同步需求池')
    const selected = provider || this.settings.integrations.requirementProvider || 'mcp'
    if (!selected || selected === 'none') {
      throw err.bad('REQUIREMENT_PROVIDER_MISSING', '请先配置需求池接入方式')
    }
    const items = reqx.listRequirements(this.root)
      .filter((item) => item.external && item.external.provider === selected)
    const result = { provider: selected, total: items.length, updated: 0, failed: [] }
    for (const item of items) {
      try {
        const key = item.external.key || item.code
        const remote = await reqIntegration.fetchRequirement(selected, this.requirementConfig(selected, overrides), key)
        this.#saveExternalRequirement(this.#externalRequirementInput(selected, remote, item.external))
        result.updated++
      } catch (e) {
        result.failed.push({ code: item.code, message: e.message })
      }
    }
    this.#log(null, null, 'REQUIREMENT_SYNC', `同步需求池 ${result.updated}/${result.total} 条`)
    return { ...result, items: reqx.listRequirements(this.root) }
  }

  postRequirementComment(provider, key, body, overrides = {}) {
    return reqIntegration.postRequirementComment(provider, this.requirementConfig(provider, overrides), key, body)
  }

  setRequirementToken(provider, token) {
    return secrets.setSecret(`requirement-${provider}`, token)
  }

  deleteRequirementToken(provider) {
    return secrets.deleteSecret(`requirement-${provider}`)
  }

  inspectImportedHtml(html) {
    const result = importer.inspectHtml(html)
    const max = this.settings.server.maxFileBytes
    if (result.size > max) throw err.bad('FILE_TOO_LARGE', `HTML 超过 ${(max / 1024 / 1024).toFixed(0)} MB 上限`)
    return result
  }

  importPrototypeUrl(url) {
    return importer.importUrl(url, { maxBytes: this.settings.server.maxFileBytes })
  }

  listWatchInbox() {
    return watchbox.listWatchInbox(this.root)
  }

  collectWatchFile(slug, sourcePath) {
    store.readProject(this.root, slug)
    const item = watchbox.collectWatchFile(this.root, slug, sourcePath)
    if (item.duplicate) return item
    try {
      let versionNo = item.suggestedVersionNo
      let suffix = 1
      while (store.versionExists(this.root, slug, versionNo)) versionNo = `${item.suggestedVersionNo}-${++suffix}`
      const version = this.addVersion(slug, {
        versionNo,
        title: item.title,
        sourcePath: item.sourcePath
      })
      return watchbox.updateWatchItem(this.root, item.id, { status: 'archived', versionNo: version.versionNo, error: null })
    } catch (e) {
      watchbox.updateWatchItem(this.root, item.id, { status: 'failed', error: e.message })
      throw e
    }
  }

  retryWatchItem(id) {
    const item = watchbox.getWatchItem(this.root, id)
    if (item.status !== 'failed') throw err.conflict('WATCH_ITEM_NOT_FAILED', '只有归档失败的 watch 草稿可以重试')
    try {
      let versionNo = item.suggestedVersionNo
      let suffix = 1
      while (store.versionExists(this.root, item.project, versionNo)) versionNo = `${item.suggestedVersionNo}-${++suffix}`
      const version = this.addVersion(item.project, {
        versionNo,
        title: item.title,
        sourcePath: item.sourcePath
      })
      return watchbox.updateWatchItem(this.root, item.id, { status: 'archived', versionNo: version.versionNo, error: null })
    } catch (e) {
      watchbox.updateWatchItem(this.root, item.id, { status: 'failed', error: e.message })
      throw e
    }
  }

  removeWatchItem(id) {
    this.#assertWritable('清理草稿箱记录')
    const item = watchbox.removeWatchItem(this.root, id)
    this.#log(item.project, item.versionNo, 'WATCH_RECORD_REMOVE', `清理已归档 watch 记录 ${item.id}`)
    return item
  }

  // ==================== 内部 ====================

  async #withAssessAdapter(name, write, fn, input = {}) {
    let config
    if (name) {
      const stored = milestones.inspectMilestone(this.root, name)
      const scopeItems = Array.isArray(input?.scopeItems)
        ? milestones.normalizeMilestoneItems(this.root, input.scopeItems)
        : null
      const milestone = scopeItems ? { ...stored, items: scopeItems } : stored
      const context = resolveProjectSyncContext(this.root, milestone, mcpConfig.inspect(this.root))
      if (context.ready) {
        config = {
          ...mcpConfig.resolveCapability(this.root, 'milestones', {
            server: context.server,
            projectId: context.projectId
          }),
          managedFields: context.managedFields
        }
      } else {
        const blocker = context.blockers[0]
        throw err.conflict(blocker.code, blocker.message, blocker.repairTo)
      }
    } else {
      config = this.assessConfig || mcpConfig.resolveCapability(this.root, 'milestones')
    }
    return this.#withResolvedAssessAdapter(config, write, fn)
  }

  async #withProjectAssessAdapter(project, write, fn) {
    store.readProject(this.root, project)
    const context = resolveProjectSyncContext(this.root, {
      name: `binding:${project}`,
      items: [{ project }]
    }, mcpConfig.inspect(this.root))
    if (!context.ready) {
      const blocker = context.blockers[0]
      throw err.conflict(blocker.code, blocker.message, blocker.repairTo)
    }
    const config = {
      ...mcpConfig.resolveCapability(this.root, 'milestones', {
        server: context.server,
        projectId: context.projectId
      }),
      managedFields: context.managedFields
    }
    return this.#withResolvedAssessAdapter(config, write, fn)
  }

  async #withResolvedAssessAdapter(config, write, fn) {
    if (this.assessAdapter) return fn(this.assessAdapter, config)
    if (config.transport !== 'stdio' || config.adapter !== 'assess-task') {
      throw err.bad('ASSESS_MCP_NOT_CONFIGURED', '迭代能力尚未绑定 Assess Task stdio MCP')
    }
    const profile = mcpRuntime.getRuntimeProfile(this.root, config.runtimeProfile)
    if (!profile) throw err.notFound(`MCP 本机配置「${config.runtimeProfile}」`)
    const diagnostic = mcpRuntime.diagnoseExecutable(profile)
    if (!diagnostic.ready) {
      throw err.conflict('MCP_RUNTIME_BLOCKED', diagnostic.blockers[0]?.message || 'MCP 可执行文件检查未通过')
    }
    const session = await this.mcpClientManager.connect({
      type: 'stdio',
      command: profile.command,
      args: profile.args,
      env: mcpRuntime.runtimeEnvironment(this.root, config.runtimeProfile),
      cwd: this.root,
      timeoutMs: config.timeoutMs
    })
    try {
      const tools = await session.listTools()
      const adapter = createAssessTaskAdapter({
        session,
        tools,
        mapping: config.tools,
        projectId: config.project,
        write
      })
      return await fn(adapter, config)
    } finally {
      await session.close()
    }
  }

  async #executeBindingSyncRecord(record, input = {}, { retry = false } = {}) {
    const allowedStatuses = retry ? ['failed', 'paused'] : ['pending-confirmation']
    if (!allowedStatuses.includes(record.status)) {
      throw err.conflict('SYNC_TRANSITION_INVALID', `同步状态不能从 ${record.status || 'unknown'} 变更为 running`)
    }
    const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
    if (!retry && value.confirmed !== true) throw err.bad('MCP_SYNC_CONFIRMATION_REQUIRED', '请先确认绑定计划')
    const planHash = retry ? record.planHash : String(value.planHash || '').trim()
    if (!planHash) throw err.bad('MCP_SYNC_PLAN_HASH_REQUIRED', '确认绑定时必须提供计划哈希')
    if (planHash !== record.planHash) throw err.conflict('MCP_SYNC_PLAN_CHANGED', '绑定计划已经变化，请重新确认')
    if (!retry && Date.parse(record.plan?.expiresAt) <= Date.now()) {
      throw err.conflict('MCP_SYNC_PLAN_EXPIRED', '绑定计划已过期，请重新生成')
    }
    const intent = record.intent || record.plan?.intent || {}
    const normalized = record.entityType === 'requirement'
      ? externalBindings.normalizeTaskBindingInput(intent)
      : externalBindings.normalizeSprintBindingInput(intent)
    const lockKey = this.#syncRecordLockKey(record)
    return this.#withProjectAssessAdapter(normalized.project, false, async (adapter, config) => {
      const remote = record.entityType === 'requirement'
        ? await adapter.getTask(normalized.remoteId)
        : await adapter.getSprint(normalized.remoteId)
      const plan = record.entityType === 'requirement'
        ? externalBindings.buildTaskBindingPlan(this.root, {
            code: record.entityKey,
            ...normalized,
            server: config.server.id,
            projectId: Number(config.project),
            remote
          })
        : externalBindings.buildSprintBindingPlan(this.root, {
            milestoneName: record.entityKey,
            ...normalized,
            server: config.server.id,
            projectId: Number(config.project),
            remote
          })
      return withMilestoneSyncLock(this.root, lockKey, async () => {
        const current = this.getSyncRecord(record.id)
        if (!allowedStatuses.includes(current.status)) {
          throw err.conflict('SYNC_TRANSITION_INVALID', `同步状态不能从 ${current.status || 'unknown'} 变更为 running`)
        }
        if (current.planHash !== record.planHash || current.planHash !== planHash) {
          throw err.conflict('MCP_SYNC_PLAN_CHANGED', '绑定计划已经变化，请重新确认')
        }
        if (plan.hash !== record.planHash) {
          this.#saveBindingSyncPreview(plan)
          throw err.conflict('MCP_SYNC_PLAN_CHANGED', '绑定计划已经变化，请重新确认')
        }
        const operation = plan.operations[0]
        const running = transitionQueuedSyncRecord(this.root, record.id, 'running', {
          reason: normalized.reason,
          operations: current.operations.map((step) => ({ ...step, status: 'running', updatedAt: new Date().toISOString() }))
        })
        this.#appendRequiredSyncAudit({
          syncId: running.id,
          action: 'sync.running',
          status: running.status,
          entityType: running.entityType,
          entityKey: running.entityKey,
          operationKey: operation.key,
          before: operation.before,
          after: operation.after
        })
        try {
          externalBindings.executeBindingPlan(this.root, plan)
          this.#appendRequiredSyncAudit({
            syncId: running.id,
            action: 'binding.replaced',
            status: 'completed',
            entityType: running.entityType,
            entityKey: running.entityKey,
            operationKey: operation.key,
            before: operation.before,
            after: operation.after
          })
        } catch (error) {
          const failed = transitionQueuedSyncRecord(this.root, record.id, 'failed', {
            error: { code: error?.code || 'EXTERNAL_BINDING_FAILED', message: String(error?.message || error) }
          })
          this.#appendRequiredSyncAudit({
            syncId: failed.id,
            action: 'sync.failed',
            status: failed.status,
            entityType: failed.entityType,
            entityKey: failed.entityKey,
            operationKey: operation.key,
            before: operation.before,
            after: operation.after,
            error: failed.error
          })
          throw error
        }
        const completed = transitionQueuedSyncRecord(this.root, record.id, 'completed', {
          operations: running.operations.map((step) => ({
            ...step,
            status: 'completed',
            remoteResult: operation.after,
            updatedAt: new Date().toISOString()
          })),
          error: null
        })
        this.#appendRequiredSyncAudit({
          syncId: completed.id,
          action: 'sync.completed',
          status: completed.status,
          entityType: completed.entityType,
          entityKey: completed.entityKey,
          operationKey: operation.key,
          before: operation.before,
          after: operation.after
        })
        return completed
      })
    })
  }

  async #buildMilestoneSyncPlan(name, input, adapter, config) {
    const storedMilestone = milestones.inspectMilestone(this.root, name)
    const scopeItems = Array.isArray(input?.scopeItems)
      ? milestones.normalizeMilestoneItems(this.root, input.scopeItems)
      : null
    if (scopeItems && storedMilestone.status !== 'active') throw err.conflict('MILESTONE_SCOPE_CHANGE_INVALID', '只有进行中的迭代使用范围变更流程')
    if (scopeItems && !String(input.reason || '').trim()) throw err.bad('MILESTONE_REASON_REQUIRED', '进行中范围变更必须填写原因')
    const milestone = scopeItems ? { ...storedMilestone, items: scopeItems } : storedMilestone
    const codes = [...new Set(milestone.items.map((item) => item.requirement))]
    const requirementItems = codes.map((code) => {
      const item = reqx.requirementDetail(this.root, code)
      const specFile = store.paths.requirementSpec(this.root, code)
      return { ...item, spec: fs.existsSync(specFile) ? fs.readFileSync(specFile, 'utf8') : '' }
    })
    const options = config.capability?.options || {}
    const mapping = {
      ...options,
      server: config.server?.id || '',
      projectId: Number(config.project || options.projectId)
    }
    const sprintId = Number(milestone.external?.sprintId || 0)
    const remoteSprint = sprintId ? await adapter.getSprint(sprintId) : null
    const remoteTasks = sprintId ? await adapter.listTasks({ sprintId }) : []
    const known = new Set(remoteTasks.map((item) => Number(item.id)))
    for (const requirement of requirementItems) {
      const binding = (requirement.externalTasks || []).find((item) =>
        item.provider === 'assess-task' && item.server === mapping.server && Number(item.projectId) === mapping.projectId)
      if (binding?.taskId && !known.has(Number(binding.taskId))) {
        const remote = await adapter.getTask(binding.taskId)
        if (remote) {
          remoteTasks.push(remote)
          known.add(Number(remote.id))
        }
      }
    }
    const managedTaskBindings = reqx.listRequirements(this.root).flatMap((requirement) =>
      (requirement.externalTasks || [])
        .filter((item) => item.provider === 'assess-task' && item.server === mapping.server && Number(item.projectId) === mapping.projectId)
        .map((item) => ({ requirement: requirement.code, taskId: item.taskId })))
    const freezeCheck = input.action === 'freeze'
      ? freezePreflight(this.root, milestone, {
          syncContext: {
            ready: true,
            server: mapping.server,
            projectId: mapping.projectId,
            managedFields: config.managedFields
          }
        })
      : { blockers: [] }
    return buildMilestoneSyncPlan({
      milestone,
      requirements: requirementItems,
      remoteSprint,
      remoteTasks,
      managedTaskBindings,
      mapping,
      managedFields: config.managedFields,
      versionSources: this.#milestoneVersionSources(milestone),
      action: input.action || null,
      scopeItems,
      scopeChangeReason: scopeItems ? String(input.reason).trim() : '',
      preflightBlockers: freezeCheck.blockers,
      resolutions: input.resolutions || {}
    })
  }

  #currentMilestoneSourceHash(name, input = {}) {
    const stored = milestones.inspectMilestone(this.root, name)
    const scopeItems = Array.isArray(input?.scopeItems)
      ? milestones.normalizeMilestoneItems(this.root, input.scopeItems)
      : null
    const milestone = scopeItems ? { ...stored, items: scopeItems } : stored
    const context = resolveProjectSyncContext(this.root, milestone, mcpConfig.inspect(this.root))
    if (!context.ready) {
      const blocker = context.blockers[0]
      throw err.conflict(blocker.code, blocker.message, blocker.repairTo)
    }
    const options = context.capability?.options || {}
    const requirementItems = [...new Set(milestone.items.map((item) => item.requirement))].map((code) => ({
      ...reqx.requirementDetail(this.root, code),
      spec: reqx.readRequirementSpec(this.root, code)
    }))
    return buildMilestoneSourceHash({
      milestone,
      requirements: requirementItems,
      mapping: { ...options, server: context.server, projectId: Number(context.projectId) },
      managedFields: context.managedFields,
      versionSources: this.#milestoneVersionSources(milestone)
    })
  }

  #requirementSyncView(item, records) {
    return {
      ...item,
      externalTasks: (item.externalTasks || []).map((binding) => {
        const relevant = records.filter((record) =>
          record.plan?.server === binding.server && Number(record.plan?.projectId) === Number(binding.projectId) &&
          (record.entityType === 'requirement' && record.entityKey === item.code ||
            (record.plan?.source?.requirements || []).some((entry) => entry.code === item.code) ||
            (record.plan?.operations || []).some((operation) => operation.requirement === item.code)))
        const failed = relevant.some((record) => record.status === 'failed')
        const conflict = relevant.some((record) => (record.plan?.operations || []).some((operation) =>
          operation.kind === 'conflict' && (!operation.requirement || operation.requirement === item.code)))
        return {
          ...binding,
          ...(failed ? { syncStatus: 'failed' } : {}),
          ...(conflict ? { driftState: 'conflict' } : {})
        }
      })
    }
  }

  #milestoneVersionSources(milestone) {
    return (milestone.items || []).map((entry) => {
      const version = store.readVersion(this.root, entry.project, entry.version)
      return {
        project: entry.project,
        version: entry.version,
        versionStatus: version.status,
        reviewStatus: version.reviewStatus,
        currentBaseline: store.readBaseline(this.root, entry.project),
        spec: store.readSpec(this.root, entry.project, entry.version)
      }
    })
  }

  #assertCurrentMilestoneSource(name, input, expectedSourceHash) {
    if (!expectedSourceHash || this.#currentMilestoneSourceHash(name, input) !== expectedSourceHash) {
      throw err.conflict('MCP_SYNC_PLAN_CHANGED', '迭代来源或项目同步目标已经变化，请重新确认')
    }
  }

  #executedSourceHash(name, plan) {
    const current = findSyncRecord(this.root, 'milestone', name)
    return linkedMilestoneSourceHash(plan, current?.operations || []) || plan.sourceHash
  }

  #saveMilestoneSyncPreview(name, plan) {
    const existing = findSyncRecord(this.root, 'milestone', name)
    const milestone = milestones.inspectMilestone(this.root, name)
    const scopeItems = Array.isArray(plan.scopeItems) ? plan.scopeItems : milestone.items
    const projects = [...new Set(scopeItems.map((item) => item.project).filter(Boolean))]
    const mode = projects.length === 1
      ? normalizeSyncPolicy(store.readProject(this.root, projects[0]).sync).mode
      : 'manual'
    const sync = savePendingSync(this.root, {
      entityType: 'milestone',
      entityKey: name,
      route: `/milestones/${encodeURIComponent(name)}`,
      mode,
      intent: plan.intent,
      plan
    })
    const previewed = readSyncAudit(this.root, { syncId: sync.id, limit: 500 }).some((entry) =>
      entry.action === 'sync.previewed' && entry.after?.planHash === sync.planHash)
    if (sync.status === 'pending-confirmation' && !previewed) {
      this.#appendRequiredSyncAudit({
        syncId: sync.id,
        action: 'sync.previewed',
        status: sync.status,
        entityType: sync.entityType,
        entityKey: sync.entityKey,
        before: existing ? { status: existing.status, planHash: existing.planHash } : null,
        after: { status: sync.status, planHash: sync.planHash }
      })
    }
    return sync
  }

  #saveBindingSyncPreview(plan) {
    const existing = findSyncRecord(this.root, plan.entityType, plan.entityKey)
    const mode = normalizeSyncPolicy(store.readProject(this.root, plan.project).sync).mode
    const sync = savePendingSync(this.root, {
      entityType: plan.entityType,
      entityKey: plan.entityKey,
      route: plan.route,
      mode,
      intent: plan.intent,
      plan
    })
    const previewed = readSyncAudit(this.root, { syncId: sync.id, limit: 500 }).some((entry) =>
      entry.action === 'sync.previewed' && entry.after?.planHash === sync.planHash)
    if (sync.status === 'pending-confirmation' && !previewed) {
      this.#appendRequiredSyncAudit({
        syncId: sync.id,
        action: 'sync.previewed',
        status: sync.status,
        entityType: sync.entityType,
        entityKey: sync.entityKey,
        before: existing ? { status: existing.status, planHash: existing.planHash } : null,
        after: { status: sync.status, planHash: sync.planHash }
      })
    }
    return sync
  }

  #syncIntent(record) {
    const source = record?.intent || record?.plan?.intent || {}
    const lifecycle = (record?.plan?.operations || []).find((operation) =>
      ['sprint.start', 'sprint.end', 'sprint.cancel'].includes(operation.kind))
    return {
      action: source.action || lifecycle?.kind?.split('.')[1] || null,
      scopeItems: Array.isArray(source.scopeItems)
        ? source.scopeItems
        : (Array.isArray(record?.plan?.scopeItems) ? record.plan.scopeItems : null),
      reason: String(source.reason || record?.plan?.scopeChangeReason || ''),
      resolutions: source.resolutions && typeof source.resolutions === 'object' && !Array.isArray(source.resolutions)
        ? source.resolutions
        : {}
    }
  }

  #appendRequiredSyncAudit(input) {
    try {
      return appendSyncAudit(this.root, input)
    } catch {
      throw err.conflict('SYNC_AUDIT_WRITE_FAILED', '同步审计写入失败，操作未完整记录')
    }
  }

  #decorate(v, baselineNo) {
    const links = reqx.resolveRequirementLinks(this.root, v.requirements)
    return {
      ...v,
      requirements: links,
      display: rules.displayStatus(v, baselineNo),
      isBaseline: rules.isBaseline(v, baselineNo),
      changeCount: v.changes.length,
      requirementCount: links.length
    }
  }

  #normalizeChanges(items) {
    const out = []
    for (const raw of items || []) {
      const content = String(raw.content || '').trim()
      if (!content) continue // 空行静默跳过，不打断录入
      if (content.length > 200) {
        throw err.bad('CHANGE_TOO_LONG', '单条变更说明不超过 200 字')
      }
      out.push({
        type: rules.normalizeChangeType(raw.type),
        location: String(raw.location || '').trim(),
        content,
        requirement: String(raw.requirement || '').trim()
      })
    }
    return out
  }

  #normalizeRequirements(items) {
    const out = []
    for (const raw of items || []) {
      const item = typeof raw === 'string' ? { code: raw, title: raw } : raw
      const code = String(item.code || '').trim()
      if (!code) continue
      const url = String(item.url || '').trim()
      if (url && !/^https?:\/\//i.test(url)) {
        throw err.bad('REQ_URL_INVALID', `需求链接「${url}」必须以 http:// 或 https:// 开头`)
      }
      out.push(reqx.ensureRequirement(this.root, { code, title: String(item.title || '').trim() || code, url }, {
        now: new Date().toISOString(),
        actor: currentUser()
      }))
    }
    return [...new Set(out)]
  }

  #externalRequirementInput(provider, remote, previousExternal = {}) {
    return {
      code: remote.code,
      title: remote.title,
      description: remote.description,
      project: remote.project,
      module: remote.module,
      type: remote.type,
      priority: remote.priority,
      owner: remote.owner,
      url: remote.url,
      external: {
        ...previousExternal,
        provider,
        key: previousExternal.key || remote.code,
        url: remote.url,
        status: remote.status,
        syncedAt: new Date().toISOString()
      }
    }
  }

  #saveExternalRequirement(input) {
    const now = new Date().toISOString()
    return reqx.requirementExists(this.root, input.code)
      ? reqx.updateRequirement(this.root, input.code, input, { trusted: true, now })
      : reqx.createRequirement(this.root, input, { trusted: true, now, actor: currentUser() })
  }

  #externalMilestoneInput(provider, remote, previousExternal = {}) {
    return {
      title: remote.title,
      startAt: remote.startAt || null,
      endAt: remote.endAt || null,
      external: {
        ...previousExternal,
        provider,
        key: previousExternal.key || remote.name,
        url: remote.url,
        status: remote.status,
        syncedAt: new Date().toISOString()
      }
    }
  }

  #log(project, versionNo, action, detail, extra = {}) {
    store.appendOplog(this.root, {
      at: new Date().toISOString(),
      by: currentUser(),
      project,
      version: versionNo,
      action,
      detail,
      ...extra
    })
  }

  #currentGitHead() {
    const result = gitx.git(this.root, ['rev-parse', 'HEAD'])
    if (!result.ok || !result.out) {
      throw err.conflict('GIT_COMMIT_REQUIRED', '正式发版没有可验证的 Git 提交')
    }
    return result.out
  }

  #milestoneDelivery(milestone, slug, versionNo) {
    return (milestone.deliveries || []).find((entry) =>
      entry.project === slug && entry.version === versionNo) || null
  }

  #deliveryForSnapshot(snapshotName) {
    const snapshot = readDeliverySnapshot(this.root, snapshotName)
    const milestone = milestones.readMilestone(this.root, snapshot.milestone)
    return this.#milestoneDelivery(milestone, snapshot.project, snapshot.version)
  }

  #completeReleaseLifecycle(milestoneName, slug, versionNo, snapshotName, releaseRunId) {
    const snapshot = readDeliverySnapshot(this.root, snapshotName)
    if (snapshot.milestone !== milestoneName || snapshot.project !== slug || snapshot.version !== versionNo) {
      throw err.conflict('DELIVERY_SCOPE_MISMATCH', '交付快照与正式发版目标不匹配')
    }
    const updated = milestones.recordMilestoneDelivery(this.root, milestoneName, {
      project: slug,
      version: versionNo,
      snapshot: snapshotName,
      releaseRunId
    })
    const at = new Date().toISOString()
    for (const code of [...new Set(snapshot.items.map((item) => item.requirement))]) {
      const current = reqx.readRequirement(this.root, code)
      if (current.status === 'pending-acceptance' || current.status === 'completed') continue
      const { item, transition } = reqx.updateRequirementLifecycle(this.root, code, 'pending-acceptance', {
        system: true,
        actor: currentUser(),
        now: at,
        reason: `正式交付 ${snapshotName}`
      })
      if (transition.changed) {
        this.#log(null, null, 'REQUIREMENT_STATUS_TRANSITION',
          `需求 ${item.code} 从 ${transition.from} 流转到 ${transition.to}：正式交付 ${snapshotName}`,
          { requirement: item.code, from: transition.from, to: transition.to, statusReason: `正式交付 ${snapshotName}` })
      }
    }
    this.#log(slug, versionNo, 'FORMAL_RELEASE_DELIVERY_RECORDED', `正式交付 ${snapshotName}`, {
      milestone: milestoneName,
      snapshot: snapshotName,
      releaseRunId,
      milestoneStatus: updated.status
    })
    return this.#milestoneDelivery(updated, slug, versionNo)
  }

  #applyAcceptanceLifecycle(snapshotName) {
    const snapshot = readDeliverySnapshot(this.root, snapshotName)
    const feedback = listDeliveryFeedback(this.root, snapshotName)
    const records = listAcceptances(this.root, snapshotName)
    const blockingFeedback = feedback.filter((item) => item.severity === 'blocker' && item.status === 'open').length
    const aggregate = aggregateAcceptance(snapshot.acceptance, records, { blockingFeedback })
    const target = aggregate.status === 'rejected'
      ? 'developing'
      : aggregate.ready ? 'completed' : ''
    if (!target) return aggregate
    const reason = aggregate.status === 'rejected'
      ? `交付验收拒绝 ${snapshotName}`
      : `交付验收通过 ${snapshotName}`
    for (const code of [...new Set(snapshot.items.map((item) => item.requirement))]) {
      const current = reqx.readRequirement(this.root, code)
      if ((target === 'completed' && current.status !== 'pending-acceptance') ||
          (target === 'developing' && current.status !== 'pending-acceptance')) continue
      this.#transitionRequirement(code, target, { system: true, reason })
    }
    return aggregate
  }

  #assertMilestoneArchiveReady(milestone) {
    if (milestone.status !== 'delivered') return
    const deliveries = new Map((milestone.deliveries || []).map((entry) => [`${entry.project}:${entry.version}`, entry]))
    for (const key of [...new Set((milestone.items || []).map((entry) => `${entry.project}:${entry.version}`))]) {
      const delivery = deliveries.get(key)
      if (!delivery) {
        throw err.conflict('MILESTONE_ARCHIVE_DELIVERY_REQUIRED', `迭代 ${milestone.name} 还有范围版本未形成正式交付`)
      }
      const acceptance = this.deliveryAcceptance(delivery.snapshot)
      if (!acceptance.ready) {
        throw err.conflict('MILESTONE_ARCHIVE_ACCEPTANCE_BLOCKED', `交付 ${delivery.snapshot} 尚未通过验收`)
      }
    }
    const codes = [...new Set((milestone.items || []).map((entry) => entry.requirement))]
    for (const code of codes) {
      const requirement = reqx.readRequirement(this.root, code)
      if (requirement.status !== 'completed') {
        throw err.conflict('MILESTONE_ARCHIVE_REQUIREMENT_PENDING', `需求 ${code} 尚未完成验收`)
      }
    }
    const external = milestone.external
    if (!external?.sprintId) {
      throw err.conflict('MILESTONE_ARCHIVE_EXTERNAL_REQUIRED', '归档前必须先验证外部 Sprint 已结束')
    }
    if (!closedExternalStatus(external.remoteStatus)) {
      throw err.conflict('MILESTONE_ARCHIVE_SPRINT_OPEN', '外部 Sprint 尚未结束或未完成回读验证')
    }
    for (const code of codes) {
      const requirement = reqx.readRequirement(this.root, code)
      const binding = (requirement.externalTasks || []).find((entry) =>
        entry.provider === 'assess-task' &&
        entry.server === external.server &&
        Number(entry.projectId) === Number(external.projectId))
      if (!binding?.taskId) {
        throw err.conflict('MILESTONE_ARCHIVE_TASK_BINDING_REQUIRED', `需求 ${code} 缺少外部任务绑定`)
      }
      if (!closedExternalStatus(binding.remoteStatus)) {
        throw err.conflict('MILESTONE_ARCHIVE_TASK_OPEN', `需求 ${code} 的外部任务尚未关闭或未完成回读验证`)
      }
    }
  }

  #transitionRequirement(code, target, { system, reason }) {
    const now = new Date().toISOString()
    const { item, transition } = reqx.updateRequirementLifecycle(this.root, code, target, {
      system,
      actor: currentUser(),
      now,
      reason
    })
    if (transition.changed) {
      this.#log(
        null,
        null,
        'REQUIREMENT_STATUS_TRANSITION',
        `需求 ${item.code} 从 ${transition.from} 流转到 ${transition.to}${reason ? `：${reason}` : ''}`,
        { requirement: item.code, from: transition.from, to: transition.to, statusReason: reason }
      )
    }
    return reqx.requirementDetail(this.root, item.code)
  }

  #assertWritable(action) {
    return permissions.assertWritable(this.root, action)
  }

  #syncRecordLockKey(record) {
    if (externalBindings.isBindingPlan(record?.plan, record?.entityType, record?.entityKey)) {
      return record.entityType === 'requirement'
        ? 'binding:external-tasks'
        : 'binding:external-sprints'
    }
    return record.entityKey
  }

  #assertSupportedSyncEntity(record) {
    if (record.entityType !== 'milestone') {
      throw err.bad('SYNC_ENTITY_UNSUPPORTED', `不支持的同步对象类型：${record.entityType || 'unknown'}`)
    }
  }
}

const CONTENT_TYPES = {
  '.pdf': 'application/pdf',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

function guessContentType(name) {
  const ext = path.extname(String(name)).toLowerCase()
  return CONTENT_TYPES[ext] || 'application/octet-stream'
}

function identityFromMcpTest(body) {
  if (!body || typeof body !== 'object') return null
  return body.identity || body.name || body.login || body.email || body.text || null
}

function validReleaseTime(value) {
  if (value === undefined || value === null || value === '') return new Date().toISOString()
  const time = new Date(value)
  if (!Number.isFinite(time.getTime())) throw err.bad('RELEASE_TIME_INVALID', '发版时间不合法')
  return time.toISOString()
}

function gitResultFailed(result) {
  return Array.isArray(result?.steps) && result.steps.some((step) => step && step.ok === false)
}

function firstFailedGitStep(result) {
  return Array.isArray(result?.steps) ? result.steps.find((step) => step && step.ok === false) : null
}

function closedExternalStatus(value) {
  const status = String(value ?? '').trim().toLowerCase()
  return [
    'done', 'complete', 'completed', 'closed', 'finished', 'ended', 'archived',
    '已完成', '完成', '已关闭', '关闭', '已结束', '结束', '已归档'
  ].includes(status)
}

function publicFormalReleasePreflight(value) {
  const { internalTo, internalCc, ...publicValue } = value
  return publicValue
}
