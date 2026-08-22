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
    // 局域网只读被拦时给一句更直白的话，用户多半是在别人的机器上操作
    if (data && data.code === 'READONLY_FROM_LAN') {
      message.warning('这是别人共享出来的只读视图，只能查看不能修改')
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
  replaceHtml: (slug, no, html) => put(`/api/versions/${enc(slug)}/${enc(no)}/html`, { html }),
  setSpec: (slug, no, markdown) => put(`/api/versions/${enc(slug)}/${enc(no)}/spec`, { markdown }),
  setChanges: (slug, no, items) => put(`/api/versions/${enc(slug)}/${enc(no)}/changes`, { items }),
  setRequirements: (slug, no, items) => put(`/api/versions/${enc(slug)}/${enc(no)}/requirements`, { items }),

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
  search: (q, { project = null, limit = 30, field = null } = {}) =>
    get(`/api/search?q=${enc(q)}&limit=${limit}` +
      (project ? `&project=${enc(project)}` : '') +
      (field ? `&field=${enc(field)}` : '')),

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

  // ---- Git ----
  gitStatus: () => get('/api/git/status'),
  gitSync: (message) => post('/api/git/sync', { message }),
  gitConflicts: () => get('/api/git/conflicts'),
  gitResolve: (slug, versionNo) => post(`/api/git/resolve/${enc(slug)}`, { versionNo }),
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
