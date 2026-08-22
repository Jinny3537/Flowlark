import { Router, sendJson, readJson, readBody } from './router.js'
import * as store from '../core/store.js'
import * as net from '../core/net.js'

/**
 * REST API。每个路由都只是 Hub 方法的薄包装 ——
 * 业务规则一条都不写在这里，否则 CLI 和网页迟早会漂移出两套行为。
 */
/**
 * @param runtime 服务的**实际**运行状态。不能直接读配置 ——
 *   `flowlark serve --lan` 是一次性覆盖，不写配置文件；
 *   若 health 按配置回答，局域网访客会看到可写的界面，点了才收到 403。
 */
export function buildApi(hub, { previewPort, runtime = {} }) {
  const r = new Router()
  // previewPort 可以是数字，也可以是取值函数（端口 0 时真实端口要 listen 后才知道）
  const resolvePreviewPort = () => (typeof previewPort === 'function' ? previewPort() : previewPort)
  const maxBody = hub.settings.server.maxFileBytes + 1024 * 1024

  r.get('/api/health', async (req, res) => {
    const s = hub.settings
    const lanActive = runtime.lan !== undefined ? runtime.lan : s.server.lan
    const readonly = runtime.readonlyFromLan !== undefined ? runtime.readonlyFromLan : s.server.readonlyFromLan
    // 这个请求自己有没有写权限。前端据此隐藏写操作按钮 ——
    // 让局域网用户点了按钮再收到 403，是很差的体验。
    const requestCanWrite = net.allowWrite({ lan: lanActive, readonlyFromLan: readonly, isLocal: net.isLocalRequest(req) })
    const gitPermission = hub.writePermission()
    const canWrite = requestCanWrite && gitPermission.canWrite
    sendJson(res, 200, {
      ok: true,
      app: 'flowlark',
      repo: hub.root,
      repoName: hub.config.name,
      // 前端要用它拼预览地址。硬编码会在改端口时静默失效，所以由服务端下发。
      previewPort: resolvePreviewPort(),
      maxFileBytes: s.server.maxFileBytes,
      canWrite,
      readonly: !canWrite,
      readonlyReason: !requestCanWrite ? 'lan' : !gitPermission.canWrite ? 'git' : null,
      gitPermission,
      lan: lanActive,
      requirementUrlTemplate: s.ui.requirementUrlTemplate,
      defaultTags: s.ui.defaultTags,
      dateStyle: s.ui.dateStyle,
      rules: { requireChangelog: s.rules.requireChangelog, lockBaseline: s.rules.lockBaseline }
    })
  })

  // ---- 项目 ----
  r.get('/api/projects', async (req, res) => sendJson(res, 200, hub.listProjects()))
  r.get('/api/projects/:slug', async (req, res, p) => sendJson(res, 200, hub.getProject(p.slug)))

  r.post('/api/projects', async (req, res) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 201, hub.createProject(body))
  })

  // ---- 需求 ----
  r.get('/api/requirements', async (req, res) => sendJson(res, 200, hub.listRequirements()))
  r.post('/api/requirements', async (req, res) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 201, hub.createRequirement(body))
  })
  r.get('/api/requirements/:code', async (req, res, p) => sendJson(res, 200, hub.getRequirement(p.code)))
  r.put('/api/requirements/:code', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.updateRequirement(p.code, body))
  })
  r.post('/api/requirements/:code/links', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.linkRequirement(p.code, body.project, body.versionNo))
  })
  r.delete('/api/requirements/:code/links/:slug/:no', async (req, res, p) =>
    sendJson(res, 200, hub.unlinkRequirement(p.code, p.slug, p.no)))

  // ---- 迭代 ----
  r.get('/api/milestones', async (req, res) => sendJson(res, 200, hub.listMilestones()))
  r.post('/api/milestones', async (req, res) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 201, hub.createMilestone(body))
  })
  r.get('/api/milestones/:name', async (req, res, p) => sendJson(res, 200, hub.getMilestone(p.name)))
  r.put('/api/milestones/:name', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.updateMilestone(p.name, body))
  })
  r.delete('/api/milestones/:name', async (req, res, p) => sendJson(res, 200, hub.removeMilestone(p.name)))

  // ---- 团队已存视图 ----
  r.get('/api/views', async (req, res) => sendJson(res, 200, hub.listSavedViews()))
  r.put('/api/views/:id', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.saveView({ ...body, id: p.id }))
  })
  r.delete('/api/views/:id', async (req, res, p) => sendJson(res, 200, hub.removeView(p.id)))

  r.post('/api/export/requirement/:code', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, await hub.exportRequirement(p.code, body.outputDir))
  })
  r.post('/api/export/milestone/:name', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, await hub.exportMilestone(p.name, body.outputDir))
  })

  // ---- 交付快照与影响面 ----
  r.get('/api/snapshots', async (req, res) => sendJson(res, 200, hub.listSnapshots()))
  r.post('/api/snapshots', async (req, res) => {
    const body = await readJson(req, maxBody)
    const result = hub.createSnapshot(body)
    const notificationResults = await hub.flushNotifications().catch((e) => [{ ok: false, error: e.message }])
    sendJson(res, 201, { ...result, notificationResults })
  })
  r.get('/api/snapshots/:name', async (req, res, p) => sendJson(res, 200, hub.getSnapshot(p.name)))
  r.post('/api/snapshots/inspect', async (req, res) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.inspectSnapshot(body))
  })
  r.post('/api/impact', async (req, res) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.suggestImpact(body.changes || [], { limit: body.limit }))
  })

  // ---- 团队通知 ----
  r.get('/api/notifications', async (req, res) => sendJson(res, 200, hub.listNotifications()))
  r.post('/api/notifications/flush', async (req, res) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, await hub.flushNotifications(body))
  })
  r.post('/api/notifications/test', async (req, res) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, await hub.testNotification(body))
  })
  r.put('/api/notifications/:provider/webhook', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.setNotificationWebhook(p.provider, body.webhookUrl))
  })
  r.delete('/api/notifications/:provider/webhook', async (req, res, p) =>
    sendJson(res, 200, hub.deleteNotificationWebhook(p.provider)))

  r.put('/api/projects/:slug', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.updateProject(p.slug, body))
  })

  r.post('/api/projects/:slug/rollback', async (req, res, p) =>
    sendJson(res, 200, hub.rollback(p.slug)))

  // ---- 版本 ----
  r.get('/api/projects/:slug/versions', async (req, res, p, url) => {
    const includeDraft = url.searchParams.get('includeDraft') !== 'false'
    const includeVoid = url.searchParams.get('includeVoid') === 'true'
    sendJson(res, 200, hub.listVersions(p.slug, { includeDraft, includeVoid }))
  })

  r.post('/api/projects/:slug/versions', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 201, hub.addVersion(p.slug, body))
  })

  r.get('/api/projects/:slug/cumulative', async (req, res, p, url) => {
    const from = url.searchParams.get('from') || null
    const to = url.searchParams.get('to')
    sendJson(res, 200, hub.cumulative(p.slug, from, to))
  })

  r.get('/api/versions/:slug/:no', async (req, res, p) =>
    sendJson(res, 200, hub.getVersion(p.slug, p.no)))

  r.put('/api/versions/:slug/:no', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.updateVersion(p.slug, p.no, body))
  })

  r.put('/api/versions/:slug/:no/html', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.replaceHtml(p.slug, p.no, { html: body.html }))
  })

  r.put('/api/versions/:slug/:no/spec', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.setSpec(p.slug, p.no, body.markdown || ''))
  })

  r.put('/api/versions/:slug/:no/changes', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.setChanges(p.slug, p.no, body.items || []))
  })

  r.put('/api/versions/:slug/:no/requirements', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.setRequirements(p.slug, p.no, body.items || []))
  })

  r.post('/api/versions/:slug/:no/baseline', async (req, res, p) => {
    const result = hub.setBaseline(p.slug, p.no)
    const notificationResults = await hub.flushNotifications().catch((e) => [{ ok: false, error: e.message }])
    sendJson(res, 200, { ...result, notificationResults })
  })

  r.put('/api/versions/:slug/:no/review', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    const result = hub.setReviewStatus(p.slug, p.no, body.status)
    const notificationResults = await hub.flushNotifications().catch((e) => [{ ok: false, error: e.message }])
    sendJson(res, 200, { ...result, notificationResults })
  })

  r.post('/api/versions/:slug/:no/void', async (req, res, p) =>
    sendJson(res, 200, hub.voidVersion(p.slug, p.no)))

  r.post('/api/versions/:slug/:no/reopen', async (req, res, p) =>
    sendJson(res, 200, hub.reopenVersion(p.slug, p.no)))

  r.post('/api/versions/:slug/:no/restore', async (req, res, p) =>
    sendJson(res, 200, hub.restoreVersion(p.slug, p.no)))

  r.delete('/api/versions/:slug/:no', async (req, res, p) =>
    sendJson(res, 200, hub.removeVersion(p.slug, p.no)))

  r.get('/api/versions/:slug/:no/download', async (req, res, p) => {
    const buf = store.readHtml(hub.root, p.slug, p.no)
    if (!buf) return sendJson(res, 404, { code: 'NOT_FOUND', message: '原型文件不存在' })
    const name = encodeURIComponent(`${p.slug}-${p.no}.html`)
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename*=UTF-8''${name}`,
      'Content-Length': buf.length
    })
    res.end(buf)
  })

  // ---- 其他 ----
  r.get('/api/oplog', async (req, res, p, url) =>
    sendJson(res, 200, hub.oplog({
      project: url.searchParams.get('project') || null,
      limit: Number(url.searchParams.get('limit')) || 100
    })))

  r.get('/api/trash', async (req, res, p, url) =>
    sendJson(res, 200, hub.listTrash(url.searchParams.get('project') || null)))

  // ---- 搜索 ----
  r.get('/api/search', async (req, res, p, url) => {
    const q = url.searchParams.get('q') || ''
    const field = url.searchParams.get('field')
    const filters = {
      tags: url.searchParams.getAll('tag'),
      reviewStatus: url.searchParams.getAll('reviewStatus'),
      status: url.searchParams.getAll('status'),
      requirement: url.searchParams.get('requirement') || null,
      milestone: url.searchParams.get('milestone') || null,
      attachment: url.searchParams.get('attachment') || null,
      dateFrom: url.searchParams.get('dateFrom') || null,
      dateTo: url.searchParams.get('dateTo') || null,
      scope: url.searchParams.get('scope') || null
    }
    sendJson(res, 200, hub.search(q, {
      project: url.searchParams.get('project') || null,
      limit: Number(url.searchParams.get('limit')) || 30,
      fields: field ? field.split(',').map((s) => s.trim()) : null,
      filters
    }))
  })

  // ---- 标签 ----
  r.get('/api/tags', async (req, res) => sendJson(res, 200, hub.allTags()))

  r.put('/api/versions/:slug/:no/tags', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.setTags(p.slug, p.no, body.tags || []))
  })

  // ---- 已读标记 ----
  r.get('/api/read/:slug', async (req, res, p) =>
    sendJson(res, 200, hub.getRead(p.slug) || { versionNo: null, at: null }))

  r.put('/api/read/:slug', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.markRead(p.slug, body.versionNo))
  })

  r.delete('/api/read/:slug', async (req, res, p) => {
    hub.clearRead(p.slug)
    sendJson(res, 200, { ok: true })
  })

  r.get('/api/projects/:slug/since-read', async (req, res, p) =>
    sendJson(res, 200, hub.sinceLastRead(p.slug)))

  // ---- 离线版本 ----
  r.post('/api/versions/:slug/:no/offline', async (req, res, p) =>
    sendJson(res, 200, await hub.buildOffline(p.slug, p.no)))

  r.delete('/api/versions/:slug/:no/offline', async (req, res, p) => {
    hub.clearOffline(p.slug, p.no)
    sendJson(res, 200, { ok: true })
  })

  // ---- 标注反馈 ----
  // 草稿只写本机 cache，不进入 Git，因此 Git 只读用户也能完整使用。
  r.get('/api/feedback/drafts', async (req, res) =>
    sendJson(res, 200, hub.listFeedbackDrafts()))

  r.post('/api/feedback/drafts', async (req, res) => {
    const body = await readJson(req, maxBody)
    const screenshot = body.screenshotBase64 ? Buffer.from(body.screenshotBase64, 'base64') : null
    const input = { ...body }
    delete input.screenshotBase64
    sendJson(res, 201, hub.createFeedbackDraft(input, screenshot))
  })

  r.get('/api/feedback/drafts/:id', async (req, res, p) =>
    sendJson(res, 200, hub.getFeedbackDraft(p.id)))

  r.get('/api/feedback/drafts/:id/markdown', async (req, res, p) =>
    sendJson(res, 200, { id: p.id, markdown: hub.feedbackMarkdown(p.id) }))

  r.get('/api/feedback/drafts/:id/screenshot', async (req, res, p) => {
    const buf = hub.feedbackScreenshot(p.id)
    if (!buf) return sendJson(res, 404, { code: 'NOT_FOUND', message: '反馈截图不存在' })
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': buf.length, 'Cache-Control': 'no-store' })
    res.end(buf)
  })

  r.post('/api/feedback/drafts/:id/submit', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, await hub.submitFeedback(p.id, body))
  })

  r.delete('/api/feedback/drafts/:id', async (req, res, p) =>
    sendJson(res, 200, hub.removeFeedbackDraft(p.id)))

  r.get('/api/integrations/issues', async (req, res) =>
    sendJson(res, 200, { providers: hub.issueProviders(), selected: hub.settings.integrations.issueProvider }))

  r.post('/api/integrations/issues/:provider/test', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, await hub.testIssueConnection(p.provider, body))
  })

  r.put('/api/integrations/issues/:provider/token', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.setIssueToken(p.provider, body.token))
  })

  r.delete('/api/integrations/issues/:provider/token', async (req, res, p) =>
    sendJson(res, 200, hub.deleteIssueToken(p.provider)))

  // ---- 原型导入 ----
  r.post('/api/import/html', async (req, res) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.inspectImportedHtml(body.html || ''))
  })

  r.post('/api/import/url', async (req, res) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, await hub.importPrototypeUrl(body.url))
  })

  r.get('/api/watch/inbox', async (req, res) =>
    sendJson(res, 200, hub.listWatchInbox()))

  r.post('/api/watch/inbox/:id/retry', async (req, res, p) =>
    sendJson(res, 200, hub.retryWatchItem(p.id)))

  // ---- Git ----
  r.get('/api/git/status', async (req, res, p, url) =>
    sendJson(res, 200, {
      ...hub.gitStatus({
        includeForeign: url.searchParams.get('fast') !== '1',
        preferCache: url.searchParams.get('cache') === '1'
      }),
      conflicts: hub.gitConflicts(),
      permission: hub.writePermission()
    }))

  r.get('/api/git/permission', async (req, res) =>
    sendJson(res, 200, hub.writePermission()))

  r.post('/api/git/permission/refresh', async (req, res) =>
    sendJson(res, 200, hub.refreshWritePermission()))

  r.post('/api/git/sync', async (req, res) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.gitSync({ message: body.message, push: body.push !== false }))
  })

  r.get('/api/git/conflicts', async (req, res) => {
    const list = hub.gitConflicts()
    // 基线冲突顺带把两边的候选值带上，前端不用再发一轮请求
    sendJson(res, 200, list.map((con) =>
      con.assisted ? { ...con, choices: hub.gitBaselineConflict(con.project) } : con))
  })

  r.post('/api/git/resolve/:slug', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.gitResolveBaseline(p.slug, body.versionNo))
  })

  // ---- Git 助手 ----
  // 这一组存在的意义：界面上原本印着让用户去终端敲的命令，现在都成了这里的一次调用。

  r.get('/api/git/doctor', async (req, res) => sendJson(res, 200, hub.gitDoctor()))

  r.post('/api/git/init', async (req, res) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.gitInit(body))
  })

  r.get('/api/git/identity', async (req, res) => sendJson(res, 200, hub.gitIdentity()))

  r.put('/api/git/identity', async (req, res) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.gitSetIdentity(body))
  })

  r.post('/api/git/resolved', async (req, res) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.gitMarkResolved(body.paths || body.path))
  })

  r.post('/api/git/continue', async (req, res) => sendJson(res, 200, hub.gitContinue()))

  r.post('/api/git/abort', async (req, res) => sendJson(res, 200, hub.gitAbort()))

  r.get('/api/git/suggest-message', async (req, res) => sendJson(res, 200, hub.gitSuggestMessage()))

  r.get('/api/git/brief', async (req, res, p, url) =>
    sendJson(res, 200, hub.gitBrief(url.searchParams.get('intent'))))

  r.get('/api/git/changes', async (req, res) => sendJson(res, 200, hub.gitChangeSummary()))

  r.get('/api/versions/:slug/:no/history', async (req, res, p, url) =>
    sendJson(res, 200, hub.gitVersionHistory(p.slug, p.no, Number(url.searchParams.get('limit')) || 30)))

  r.get('/api/versions/:slug/:no/spec-history', async (req, res, p, url) =>
    sendJson(res, 200, hub.gitSpecHistory(p.slug, p.no, Number(url.searchParams.get('limit')) || 30)))

  r.get('/api/versions/:slug/:no/spec-at', async (req, res, p, url) => {
    const ref = url.searchParams.get('ref')
    sendJson(res, 200, { ref, spec: hub.gitSpecAt(p.slug, p.no, ref) })
  })

  r.get('/api/projects/:slug/baseline-history', async (req, res, p, url) =>
    sendJson(res, 200, hub.gitBaselineHistory(p.slug, Number(url.searchParams.get('limit')) || 30)))

  r.get('/api/projects/:slug/contributors', async (req, res, p) =>
    sendJson(res, 200, hub.gitContributors(p.slug, 20)))

  // ---- 远端 ----
  r.get('/api/git/remote', async (req, res) => sendJson(res, 200, hub.gitRemote()))

  r.put('/api/git/remote', async (req, res) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.gitSetRemote(body.url))
  })

  r.delete('/api/git/remote', async (req, res) => sendJson(res, 200, hub.gitRemoveRemote()))

  // ---- 附件 ----
  // 用原始请求体而不是 multipart：附件是二进制，multipart 解析器要么引依赖、
  // 要么自己写一百多行边界处理，而文件名放在查询串里就够了。
  r.post('/api/versions/:slug/:no/attachments', async (req, res, p, url) => {
    const name = url.searchParams.get('name')
    if (!name) {
      return sendJson(res, 400, { code: 'NAME_REQUIRED', message: '缺少 name 查询参数' })
    }
    const buf = await readBody(req, maxBody)
    sendJson(res, 201, hub.addAttachment(p.slug, p.no, {
      name,
      content: buf,
      contentType: (req.headers['content-type'] || '').split(';')[0]
    }))
  })

  r.get('/api/versions/:slug/:no/attachments/:name', async (req, res, p, url) => {
    const { buf, meta } = hub.readAttachment(p.slug, p.no, p.name)
    const encoded = encodeURIComponent(meta.name)
    // inline 让浏览器能直接预览 PDF 和图片，download=1 时才强制下载
    const disposition = url.searchParams.get('download') === '1' ? 'attachment' : 'inline'
    res.writeHead(200, {
      'Content-Type': meta.contentType || 'application/octet-stream',
      'Content-Disposition': `${disposition}; filename*=UTF-8''${encoded}`,
      'Content-Length': buf.length
    })
    res.end(buf)
  })

  r.delete('/api/versions/:slug/:no/attachments/:name', async (req, res, p) =>
    sendJson(res, 200, hub.removeAttachment(p.slug, p.no, p.name)))

  // ---- 系统配置 ----
  r.get('/api/config', async (req, res) =>
    sendJson(res, 200, { items: hub.listConfig(), problems: hub.configProblems() }))

  r.put('/api/config/:key', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, hub.setConfig(p.key, body.value))
  })

  r.delete('/api/config/:key', async (req, res, p) =>
    sendJson(res, 200, hub.resetConfig(p.key)))

  // ---- 局域网 ----
  r.get('/api/lan', async (req, res) => {
    const s = hub.settings
    sendJson(res, 200, {
      // enabled 是当前实际状态；configured 是写在配置里的值。
      // --lan 临时开启时两者会不一致，界面需要能说清楚这一点。
      enabled: runtime.lan !== undefined ? runtime.lan : s.server.lan,
      configured: s.server.lan,
      readonlyFromLan: s.server.readonlyFromLan,
      port: s.server.port,
      previewPort: s.server.previewPort,
      addresses: net.lanAddresses(),
      // 当前这个请求自己是不是本机来的 —— 前端据此决定要不要隐藏写操作
      requestIsLocal: net.isLocalRequest(req)
    })
  })

  return r
}
