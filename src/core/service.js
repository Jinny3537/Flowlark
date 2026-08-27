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
import * as migrate from './migrate.js'
import * as milestones from './milestones.js'
import * as savedViews from './views.js'
import * as exporter from './exporter.js'
import * as snapshots from './snapshots.js'
import { suggestImpact as runImpact } from './impact.js'
import * as notifications from './notifications.js'
import * as workspaces from './workspaces.js'
import * as setupx from './setup.js'
import * as updater from './updater.js'
import * as mirror from './mirror.js'
import * as workspaceIndex from './workspace-index.js'
import * as mcpConfig from './mcp-config.js'
import { search as runSearch } from './search.js'
import { detectExternalRefs } from './scan.js'
import * as cfg from './config.js'
import { readConfig, writeConfig, currentUser } from './repo.js'

/**
 * 业务门面。CLI 与 HTTP API 都只调这一层 —— 保证「命令行能做的事，网页也能做，
 * 且行为完全一致」。任何一边绕过它直接读写文件，两边就会开始漂移。
 */
export class Hub {
  constructor(root) {
    this.root = root
    const initial = readConfig(root)
    if (initial.schemaVersion < 2) migrate.migrateToSchema2(root)
    this.config = readConfig(root)
  }

  get settings() {
    return this.config.settings
  }

  // ==================== 项目 ====================

  listProjects() {
    const requirements = reqx.listRequirements(this.root)
    return store.listProjectSlugs(this.root).map((slug) => this.#projectDetail(slug, requirements))
  }

  getProject(slug) {
    return this.#projectDetail(slug, reqx.listRequirements(this.root))
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

  createProject({ name, code, description = '', priority = '', archived = false }) {
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
    if (next.priority === undefined) next.priority = ''
    if (next.archived === undefined) next.archived = false

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
    return reqx.listRequirements(this.root)
  }

  getRequirement(code) {
    return reqx.requirementDetail(this.root, code)
  }

  createRequirement(input) {
    this.#assertWritable('创建需求')
    const item = reqx.createRequirement(this.root, input)
    this.#log(null, null, 'REQUIREMENT_CREATE', `创建需求 ${item.code}`)
    return reqx.requirementDetail(this.root, item.code)
  }

  updateRequirement(code, patch) {
    this.#assertWritable('编辑需求')
    const item = reqx.updateRequirement(this.root, code, patch)
    this.#log(null, null, 'REQUIREMENT_UPDATE', `编辑需求 ${item.code}`)
    return reqx.requirementDetail(this.root, item.code)
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
          milestones.updateMilestone(this.root, remote.name, input)
          result.updated++
        } else {
          milestones.createMilestone(this.root, { ...input, name: remote.name, items: [] })
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
    this.#assertWritable('同步迭代到任务平台')
    const selected = provider || 'mcp'
    const local = milestones.inspectMilestone(this.root, name)
    const remote = await milestoneIntegration.upsertMilestone(selected, this.milestoneConfig(selected, overrides), local)
    const item = milestones.updateMilestone(this.root, local.name, this.#externalMilestoneInput(selected, remote, local.external))
    this.#log(null, null, 'MILESTONE_PUSH_SYNC', `同步迭代 ${item.name} 到任务平台`)
    return item
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
    if (name === 'milestones') return this.testMilestoneConnection('mcp')
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
    return store.listTrash(this.root, slug)
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
    const item = reqx.requirementExists(this.root, remote.code)
      ? reqx.updateRequirement(this.root, remote.code, input)
      : reqx.createRequirement(this.root, input)
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
        reqx.updateRequirement(this.root, item.code, this.#externalRequirementInput(selected, remote, item.external))
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

  // ==================== 内部 ====================

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
      out.push(reqx.ensureRequirement(this.root, { code, title: String(item.title || '').trim() || code, url }))
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

  #assertWritable(action) {
    return permissions.assertWritable(this.root, action)
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
