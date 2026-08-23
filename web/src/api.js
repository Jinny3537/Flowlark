import { message } from 'ant-design-vue'

/**
 * 工作台与 API 同源（都由 flowlark serve 提供），所以走相对路径，
 * 没有 CORS、没有服务器地址配置这回事 —— 本地形态省掉的复杂度之一。
 */
async function request(method, path, body, { raw = false, contentType } = {}) {
  let res
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {}
        : raw ? { 'Content-Type': contentType || 'application/octet-stream' }
        : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body)
    })
  } catch {
    message.error('无法连接本地服务，flowlark serve 可能已经停止')
    throw new Error('NETWORK')
  }

  const text = await res.text()
  const data = text ? JSON.parse(text) : null

  if (!res.ok) {
    // 只读被拦时给一句更直白的话，用户多半是在别人的机器上操作或远端没有写权限
    if (data && (data.code === 'READONLY_FROM_LAN' || data.code === 'GIT_READONLY')) {
      message.warning(data.code === 'READONLY_FROM_LAN'
        ? '这是别人共享出来的只读视图，只能查看不能修改'
        : '当前 Git 身份没有远端写权限，Flowlark 已进入只读模式')
      const e = new Error(data.message)
      e.code = data.code
      throw e
    }
    // 服务端错误自带 hint（下一步该干什么），比单纯报错有用得多
    const detail = data && data.hint ? `${data.message}（${data.hint}）` : (data && data.message) || '请求失败'
    message.error(detail)
    const e = new Error(detail)
    e.code = data && data.code
    throw e
  }
  return data
}

async function requestText(path) {
  let res
  try {
    res = await fetch(path)
  } catch {
    message.error('无法连接本地服务，flowlark serve 可能已经停止')
    throw new Error('NETWORK')
  }

  const text = await res.text()
  if (!res.ok) {
    let data = null
    try { data = text ? JSON.parse(text) : null } catch { /* 非 JSON 错误直接走默认文案 */ }
    const detail = data && data.hint ? `${data.message}（${data.hint}）` : (data && data.message) || '请求失败'
    message.error(detail)
    const e = new Error(detail)
    e.code = data && data.code
    throw e
  }
  return text
}

const get = (p) => request('GET', p)
const post = (p, b) => request('POST', p, b)
const put = (p, b) => request('PUT', p, b)
const del = (p) => request('DELETE', p)

const enc = encodeURIComponent

export const api = {
  health: () => get('/api/health'),

  listProjects: () => get('/api/projects'),
  getProject: (slug) => get(`/api/projects/${enc(slug)}`),
  createProject: (body) => post('/api/projects', body),
  updateProject: (slug, body) => put(`/api/projects/${enc(slug)}`, body),
  rollback: (slug) => post(`/api/projects/${enc(slug)}/rollback`),

  listVersions: (slug, { includeDraft = true, includeVoid = false } = {}) =>
    get(`/api/projects/${enc(slug)}/versions?includeDraft=${includeDraft}&includeVoid=${includeVoid}`),
  getVersion: (slug, no) => get(`/api/versions/${enc(slug)}/${enc(no)}`),

  /** 原型内容直接放在 JSON 里。本地 loopback 传几 MB 文本毫无压力，换来零依赖、单次原子请求 */
  addVersion: (slug, body) => post(`/api/projects/${enc(slug)}/versions`, body),
  updateVersion: (slug, no, body) => put(`/api/versions/${enc(slug)}/${enc(no)}`, body),
  getHtml: (slug, no) => requestText(`/api/versions/${enc(slug)}/${enc(no)}/download`),
  replaceHtml: (slug, no, html) => put(`/api/versions/${enc(slug)}/${enc(no)}/html`, { html }),
  setSpec: (slug, no, markdown) => put(`/api/versions/${enc(slug)}/${enc(no)}/spec`, { markdown }),
  setChanges: (slug, no, items) => put(`/api/versions/${enc(slug)}/${enc(no)}/changes`, { items }),
  setRequirements: (slug, no, items) => put(`/api/versions/${enc(slug)}/${enc(no)}/requirements`, { items }),
  setReviewStatus: (slug, no, status) => put(`/api/versions/${enc(slug)}/${enc(no)}/review`, { status }),

  setBaseline: (slug, no) => post(`/api/versions/${enc(slug)}/${enc(no)}/baseline`),
  voidVersion: (slug, no) => post(`/api/versions/${enc(slug)}/${enc(no)}/void`),
  reopenVersion: (slug, no) => post(`/api/versions/${enc(slug)}/${enc(no)}/reopen`),
  restoreVersion: (slug, no) => post(`/api/versions/${enc(slug)}/${enc(no)}/restore`),
  removeVersion: (slug, no) => del(`/api/versions/${enc(slug)}/${enc(no)}`),

  cumulative: (slug, from, to) =>
    get(`/api/projects/${enc(slug)}/cumulative?${from ? `from=${enc(from)}&` : ''}to=${enc(to)}`),

  oplog: (project, limit = 100) =>
    get(`/api/oplog?${project ? `project=${enc(project)}&` : ''}limit=${limit}`),
  trash: (project) => get(`/api/trash${project ? `?project=${enc(project)}` : ''}`),

  downloadUrl: (slug, no) => `/api/versions/${enc(slug)}/${enc(no)}/download`,

  // ---- 搜索 ----
  search: (q, { project = null, limit = 30, field = null, filters = {} } = {}) => {
    const params = new URLSearchParams({ q: q || '', limit: String(limit) })
    if (project) params.set('project', project)
    if (field) params.set('field', field)
    for (const [key, value] of Object.entries(filters || {})) {
      if (Array.isArray(value)) value.forEach((item) => params.append(key === 'tags' ? 'tag' : key, item))
      else if (value !== null && value !== undefined && value !== '') params.set(key, value)
    }
    return get(`/api/search?${params}`)
  },

  // ---- 需求、迭代与视图 ----
  listRequirements: () => get('/api/requirements'),
  getRequirement: (code) => get(`/api/requirements/${enc(code)}`),
  createRequirement: (body) => post('/api/requirements', body),
  updateRequirement: (code, body) => put(`/api/requirements/${enc(code)}`, body),
  linkRequirement: (code, body) => post(`/api/requirements/${enc(code)}/links`, body),
  unlinkRequirement: (code, slug, no) => del(`/api/requirements/${enc(code)}/links/${enc(slug)}/${enc(no)}`),
  listMilestones: () => get('/api/milestones'),
  getMilestone: (name) => get(`/api/milestones/${enc(name)}`),
  createMilestone: (body) => post('/api/milestones', body),
  updateMilestone: (name, body) => put(`/api/milestones/${enc(name)}`, body),
  removeMilestone: (name) => del(`/api/milestones/${enc(name)}`),
  listViews: () => get('/api/views'),
  saveView: (id, body) => put(`/api/views/${enc(id)}`, body),
  removeView: (id) => del(`/api/views/${enc(id)}`),
  exportRequirement: (code, outputDir) => post(`/api/export/requirement/${enc(code)}`, { outputDir }),
  exportMilestone: (name, outputDir) => post(`/api/export/milestone/${enc(name)}`, { outputDir }),
  listSnapshots: () => get('/api/snapshots'),
  getSnapshot: (name) => get(`/api/snapshots/${enc(name)}`),
  inspectSnapshot: (body) => post('/api/snapshots/inspect', body),
  createSnapshot: (body) => post('/api/snapshots', body),
  suggestImpact: (changes) => post('/api/impact', { changes }),
  listNotifications: () => get('/api/notifications'),
  flushNotifications: (body = {}) => post('/api/notifications/flush', body),
  testNotification: (body) => post('/api/notifications/test', body),
  setNotificationWebhook: (provider, webhookUrl) => put(`/api/notifications/${enc(provider)}/webhook`, { webhookUrl }),
  deleteNotificationWebhook: (provider) => del(`/api/notifications/${enc(provider)}/webhook`),
  listWorkspaces: () => get('/api/workspaces'),
  registerWorkspace: (body) => post('/api/workspaces/register', body),
  cloneWorkspace: (body) => post('/api/workspaces/clone', body),
  removeWorkspace: (path) => del(`/api/workspaces?path=${enc(path)}`),
  buildWorkspaceIndex: () => get('/api/workspace-index'),
  searchWorkspaces: (q, limit = 50) => get(`/api/workspace-search?q=${enc(q)}&limit=${limit}`),
  checkUpdate: (currentVersion, manifestUrl) => post('/api/update/check', { currentVersion, manifestUrl }),
  downloadUpdate: (manifest, targetDir) => post('/api/update/download', { manifest, targetDir }),
  mirrorStatus: () => get('/api/mirror'),
  refreshMirror: () => post('/api/mirror/refresh', {}),

  // ---- 标签 ----
  allTags: () => get('/api/tags'),
  setTags: (slug, no, tags) => put(`/api/versions/${enc(slug)}/${enc(no)}/tags`, { tags }),

  // ---- 已读 ----
  getRead: (slug) => get(`/api/read/${enc(slug)}`),
  markRead: (slug, versionNo) => put(`/api/read/${enc(slug)}`, { versionNo }),
  clearRead: (slug) => del(`/api/read/${enc(slug)}`),
  sinceRead: (slug) => get(`/api/projects/${enc(slug)}/since-read`),

  // ---- 离线版本 ----
  buildOffline: (slug, no) => post(`/api/versions/${enc(slug)}/${enc(no)}/offline`),
  clearOffline: (slug, no) => del(`/api/versions/${enc(slug)}/${enc(no)}/offline`),

  // ---- 反馈与导入 ----
  listFeedbackDrafts: () => get('/api/feedback/drafts'),
  createFeedbackDraft: (body) => post('/api/feedback/drafts', body),
  feedbackMarkdown: (id) => get(`/api/feedback/drafts/${enc(id)}/markdown`),
  feedbackScreenshotUrl: (id) => `/api/feedback/drafts/${enc(id)}/screenshot`,
  submitFeedback: (id, body) => post(`/api/feedback/drafts/${enc(id)}/submit`, body),
  removeFeedbackDraft: (id) => del(`/api/feedback/drafts/${enc(id)}`),
  issueIntegrations: () => get('/api/integrations/issues'),
  testIssueIntegration: (provider, body = {}) => post(`/api/integrations/issues/${enc(provider)}/test`, body),
  setIssueToken: (provider, token) => put(`/api/integrations/issues/${enc(provider)}/token`, { token }),
  deleteIssueToken: (provider) => del(`/api/integrations/issues/${enc(provider)}/token`),
  requirementIntegrations: () => get('/api/integrations/requirements'),
  testRequirementIntegration: (provider, body = {}) => post(`/api/integrations/requirements/${enc(provider)}/test`, body),
  searchExternalRequirements: (provider, query, config = {}) => post(`/api/integrations/requirements/${enc(provider)}/search`, { query, config }),
  importExternalRequirement: (provider, key, config = {}) => post(`/api/integrations/requirements/${enc(provider)}/import`, { key, config }),
  postRequirementComment: (provider, key, body, config = {}) => post(`/api/integrations/requirements/${enc(provider)}/comment`, { key, body, config }),
  setRequirementToken: (provider, token) => put(`/api/integrations/requirements/${enc(provider)}/token`, { token }),
  deleteRequirementToken: (provider) => del(`/api/integrations/requirements/${enc(provider)}/token`),
  inspectHtml: (html) => post('/api/import/html', { html }),
  importUrl: (url) => post('/api/import/url', { url }),
  draftVersion: (body) => post('/api/drafts/version', body),
  watchInbox: () => get('/api/watch/inbox'),
  retryWatchItem: (id) => post(`/api/watch/inbox/${enc(id)}/retry`, {}),

  // ---- Git ----
  gitStatus: ({ fast = false, cache = false } = {}) => {
    const q = new URLSearchParams()
    if (fast) q.set('fast', '1')
    if (cache) q.set('cache', '1')
    const s = q.toString()
    return get(`/api/git/status${s ? '?' + s : ''}`)
  },
  gitPermission: () => get('/api/git/permission'),
  refreshGitPermission: () => post('/api/git/permission/refresh', {}),
  gitSync: (message) => post('/api/git/sync', { message }),
  gitConflicts: () => get('/api/git/conflicts'),
  gitResolve: (slug, versionNo) => post(`/api/git/resolve/${enc(slug)}`, { versionNo }),

  // Git 助手：界面上曾经印着让用户去终端敲的命令，现在都是这几个调用
  gitDoctor: () => get('/api/git/doctor'),
  gitInit: (body) => post('/api/git/init', body || {}),
  gitIdentity: () => get('/api/git/identity'),
  gitSetIdentity: (body) => put('/api/git/identity', body),
  gitMarkResolved: (paths) => post('/api/git/resolved', { paths }),
  gitContinue: () => post('/api/git/continue', {}),
  gitAbort: () => post('/api/git/abort', {}),
  gitSuggestMessage: () => get('/api/git/suggest-message'),
  gitBrief: (intent) => get(`/api/git/brief${intent ? `?intent=${enc(intent)}` : ''}`),
  versionHistory: (slug, no) => get(`/api/versions/${enc(slug)}/${enc(no)}/history`),
  specHistory: (slug, no) => get(`/api/versions/${enc(slug)}/${enc(no)}/spec-history`),
  specAt: (slug, no, ref) => get(`/api/versions/${enc(slug)}/${enc(no)}/spec-at?ref=${enc(ref)}`),
  baselineHistory: (slug) => get(`/api/projects/${enc(slug)}/baseline-history`),
  contributors: (slug) => get(`/api/projects/${enc(slug)}/contributors`),

  // ---- 远端 ----
  getRemote: () => get('/api/git/remote'),
  setRemote: (url) => put('/api/git/remote', { url }),
  removeRemote: () => del('/api/git/remote'),

  // ---- 附件 ----
  /** 用原始请求体上传，文件名走查询串 —— 服务端不需要 multipart 解析器 */
  addAttachment: (slug, no, file) =>
    request('POST', `/api/versions/${enc(slug)}/${enc(no)}/attachments?name=${enc(file.name)}`,
      file, { raw: true, contentType: file.type || 'application/octet-stream' }),
  removeAttachment: (slug, no, name) =>
    del(`/api/versions/${enc(slug)}/${enc(no)}/attachments/${enc(name)}`),
  attachmentUrl: (slug, no, name, download = false) =>
    `/api/versions/${enc(slug)}/${enc(no)}/attachments/${enc(name)}${download ? '?download=1' : ''}`,

  // ---- 配置 ----
  getConfig: () => get('/api/config'),
  setConfig: (key, value) => put(`/api/config/${enc(key)}`, { value }),
  resetConfig: (key) => del(`/api/config/${enc(key)}`),

  // ---- 局域网 ----
  lan: () => get('/api/lan')
}
