import { ApiError, errorFromResponse, parsePayload } from './requestModel.js';

type RequestOptions = {
  raw?: boolean;
  contentType?: string;
};

export type HealthInfo = {
  repo?: string;
  repoName?: string;
  version?: string;
  previewPort?: number;
  maxFileBytes?: number;
  canWrite?: boolean;
  readonlyReason?: string | null;
  lan?: boolean;
  gitPermission?: { branch?: string } | null;
  requirementUrlTemplate?: string;
  dateStyle?: string;
  defaultTags?: string[];
  updateManifestUrl?: string;
  mirror?: boolean;
  rules?: { requireChangelog?: boolean; lockBaseline?: boolean };
};

export type ConfigItem = {
  key: string;
  type: 'int' | 'bool' | 'string' | 'port' | 'bytes' | 'list';
  default: unknown;
  label: string;
  note?: string;
  danger?: boolean;
  enum?: string[];
  min?: number;
  max?: number;
  value: unknown;
  isDefault: boolean;
  group: string;
};

export type ConfigResponse = {
  items: ConfigItem[];
  problems: string[];
};

const enc = encodeURIComponent;

async function request<T>(method: string, path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      method,
      headers: body === undefined
        ? {}
        : options.raw
          ? { 'Content-Type': options.contentType || 'application/octet-stream' }
          : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : options.raw ? (body as BodyInit) : JSON.stringify(body),
    });
  } catch (cause) {
    throw new ApiError('无法连接本地服务，flowlark serve 可能已经停止', {
      code: 'NETWORK',
      cause: cause instanceof Error ? cause : undefined,
    });
  }

  const payload = parsePayload(await response.text());
  if (!response.ok) throw errorFromResponse(response.status, payload);
  return payload as T;
}

async function requestText(path: string): Promise<string> {
  let response: Response;
  try {
    response = await fetch(path);
  } catch (cause) {
    throw new ApiError('无法连接本地服务，flowlark serve 可能已经停止', {
      code: 'NETWORK',
      cause: cause instanceof Error ? cause : undefined,
    });
  }
  const text = await response.text();
  if (!response.ok) throw errorFromResponse(response.status, parsePayload(text));
  return text;
}

const get = <T,>(p: string) => request<T>('GET', p);
const post = <T,>(p: string, b?: unknown) => request<T>('POST', p, b);
const put = <T,>(p: string, b?: unknown) => request<T>('PUT', p, b);
const del = <T,>(p: string) => request<T>('DELETE', p);

export const api = {
  health: () => get<HealthInfo>('/api/health'),
  listProjects: () => get<any[]>('/api/projects'),
  getProject: (slug: string) => get<any>(`/api/projects/${enc(slug)}`),
  createProject: (body: unknown) => post<any>('/api/projects', body),
  updateProject: (slug: string, body: unknown) => put<any>(`/api/projects/${enc(slug)}`, body),
  preflightVersion: (slug: string, body: unknown) => post<any>(`/api/projects/${enc(slug)}/version-preflight`, body),
  projectPlanning: (slug: string) => get<any>(`/api/projects/${enc(slug)}/planning`),
  projectPreference: (slug: string) => get<any>(`/api/projects/${enc(slug)}/preferences`),
  setProjectPreference: (slug: string, body: unknown) => put<any>(`/api/projects/${enc(slug)}/preferences`, body),
  rollbackPreview: (slug: string) => get<any>(`/api/projects/${enc(slug)}/rollback-preview`),
  rollbackProject: (slug: string) => post(`/api/projects/${enc(slug)}/rollback`),
  listVersions: (slug: string, { includeDraft = true, includeVoid = false } = {}) =>
    get<any[]>(`/api/projects/${enc(slug)}/versions?includeDraft=${includeDraft}&includeVoid=${includeVoid}`),
  getVersion: (slug: string, no: string) => get<any>(`/api/versions/${enc(slug)}/${enc(no)}`),
  addVersion: (slug: string, body: unknown) => post<any>(`/api/projects/${enc(slug)}/versions`, body),
  updateVersion: (slug: string, no: string, body: unknown) => put<any>(`/api/versions/${enc(slug)}/${enc(no)}`, body),
  replaceHtml: (slug: string, no: string, html: string) => put(`/api/versions/${enc(slug)}/${enc(no)}/html`, { html }),
  setSpec: (slug: string, no: string, markdown: string) => put(`/api/versions/${enc(slug)}/${enc(no)}/spec`, { markdown }),
  setChanges: (slug: string, no: string, items: unknown[]) => put(`/api/versions/${enc(slug)}/${enc(no)}/changes`, { items }),
  setRequirements: (slug: string, no: string, items: unknown[]) => put(`/api/versions/${enc(slug)}/${enc(no)}/requirements`, { items }),
  setReviewStatus: (slug: string, no: string, status: string) => put(`/api/versions/${enc(slug)}/${enc(no)}/review`, { status }),
  voidVersion: (slug: string, no: string) => post(`/api/versions/${enc(slug)}/${enc(no)}/void`),
  reopenVersion: (slug: string, no: string) => post(`/api/versions/${enc(slug)}/${enc(no)}/reopen`),
  restoreVersion: (slug: string, no: string) => post(`/api/versions/${enc(slug)}/${enc(no)}/restore`),
  removeVersion: (slug: string, no: string) => del(`/api/versions/${enc(slug)}/${enc(no)}`),
  getHtml: (slug: string, no: string) => requestText(`/api/versions/${enc(slug)}/${enc(no)}/download`),
  downloadUrl: (slug: string, no: string) => `/api/versions/${enc(slug)}/${enc(no)}/download`,
  setBaseline: (slug: string, no: string) => post(`/api/versions/${enc(slug)}/${enc(no)}/baseline`),
  preflightFormalRelease: (slug: string, no: string, body: unknown) =>
    post<any>(`/api/versions/${enc(slug)}/${enc(no)}/formal-release/preflight`, body),
  formalRelease: (slug: string, no: string, body: unknown) =>
    post<any>(`/api/versions/${enc(slug)}/${enc(no)}/formal-release`, body),
  listReleaseMails: () => get<any[]>('/api/release-mails'),
  retryReleaseMail: (id: string) => post<any>(`/api/release-mails/${enc(id)}/retry`, {}),
  cumulative: (slug: string, from: string, to: string) =>
    get(`/api/projects/${enc(slug)}/cumulative?${from ? `from=${enc(from)}&` : ''}to=${enc(to)}`),
  oplog: (project?: string, limit = 100) =>
    get(`/api/oplog?${project ? `project=${enc(project)}&` : ''}limit=${limit}`),
  search: (q: string, { project = null, limit = 30, field = null, filters = {} }: {
    project?: string | null;
    limit?: number;
    field?: string | null;
    filters?: Record<string, unknown>;
  } = {}) => {
    const params = new URLSearchParams({ q: q || '', limit: String(limit) });
    if (project) params.set('project', project);
    if (field) params.set('field', field);
    Object.entries(filters || {}).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        value.forEach((item) => params.append(key === 'tags' ? 'tag' : key, String(item)));
      } else if (value !== null && value !== undefined && value !== '') {
        params.set(key, String(value));
      }
    });
    return get<any>(`/api/search?${params}`);
  },
  getRead: (slug: string) => get(`/api/read/${enc(slug)}`),
  markRead: (slug: string, versionNo: string) => put(`/api/read/${enc(slug)}`, { versionNo }),
  clearRead: (slug: string) => del(`/api/read/${enc(slug)}`),
  sinceRead: (slug: string) => get(`/api/projects/${enc(slug)}/since-read`),
  listRequirements: () => get<any[]>('/api/requirements'),
  getRequirement: (code: string) => get<any>(`/api/requirements/${enc(code)}`),
  createRequirement: (body: unknown) => post<any>('/api/requirements', body),
  updateRequirement: (code: string, body: unknown) => put<any>(`/api/requirements/${enc(code)}`, body),
  syncRequirements: (provider = 'mcp', config = {}) => post('/api/requirements/sync', { provider, config }),
  linkRequirement: (code: string, body: unknown) => post(`/api/requirements/${enc(code)}/links`, body),
  unlinkRequirement: (code: string, slug: string, no: string) =>
    del(`/api/requirements/${enc(code)}/links/${enc(slug)}/${enc(no)}`),
  listMilestones: () => get<any[]>('/api/milestones'),
  getMilestone: (name: string) => get<any>(`/api/milestones/${enc(name)}`),
  createMilestone: (body: unknown) => post<any>('/api/milestones', body),
  preflightMilestoneFormalRelease: (name: string, slug: string, no: string, body: unknown) =>
    post<any>(`/api/milestones/${enc(name)}/versions/${enc(slug)}/${enc(no)}/formal-release/preflight`, body),
  formalReleaseMilestoneVersion: (name: string, slug: string, no: string, body: unknown) =>
    post<any>(`/api/milestones/${enc(name)}/versions/${enc(slug)}/${enc(no)}/formal-release`, body),
  updateMilestone: (name: string, body: unknown) => put<any>(`/api/milestones/${enc(name)}`, body),
  removeMilestone: (name: string) => del(`/api/milestones/${enc(name)}`),
  syncMilestones: (provider = 'mcp', config = {}) => post('/api/milestones/sync', { provider, config }),
  syncMilestone: (name: string, provider = 'mcp', config = {}) =>
    post(`/api/milestones/${enc(name)}/sync`, { provider, config }),
  milestonePreflight: (name: string) => get<any>(`/api/milestones/${enc(name)}/preflight`),
  milestoneSyncJournal: (name: string) => get<any>(`/api/milestones/${enc(name)}/sync-journal`),
  milestoneExecutionSummary: (name: string) => get<any>(`/api/milestones/${enc(name)}/execution`),
  planMilestoneSync: (name: string, body: unknown = {}) => post<any>(`/api/milestones/${enc(name)}/sync-plan`, body),
  executeMilestoneSync: (name: string, body: unknown) => post<any>(`/api/milestones/${enc(name)}/sync-execute`, body),
  resumeMilestoneSync: (name: string, body: unknown = {}) => post<any>(`/api/milestones/${enc(name)}/sync-resume`, body),
  transitionMilestone: (name: string, body: unknown) => post<any>(`/api/milestones/${enc(name)}/transition`, body),
  listViews: () => get<any[]>('/api/views'),
  saveView: (id: string, body: unknown) => put(`/api/views/${enc(id)}`, body),
  removeView: (id: string) => del(`/api/views/${enc(id)}`),
  exportRequirement: (code: string, outputDir?: string) => post(`/api/export/requirement/${enc(code)}`, { outputDir }),
  exportMilestone: (name: string, outputDir?: string) => post(`/api/export/milestone/${enc(name)}`, { outputDir }),
  listSnapshots: () => get<any[]>('/api/snapshots'),
  getSnapshot: (name: string) => get<any>(`/api/snapshots/${enc(name)}`),
  inspectSnapshot: (body: unknown) => post('/api/snapshots/inspect', body),
  createSnapshot: (body: unknown) => post<any>('/api/snapshots', body),
  suggestImpact: (changes: unknown[]) => post('/api/impact', { changes }),
  listNotifications: () => get<any[]>('/api/notifications'),
  flushNotifications: () => post('/api/notifications/flush', {}),
  testNotification: (body: unknown) => post('/api/notifications/test', body),
  setNotificationWebhook: (provider: string, webhookUrl: string) =>
    put(`/api/notifications/${enc(provider)}/webhook`, { webhookUrl }),
  deleteNotificationWebhook: (provider: string) => del(`/api/notifications/${enc(provider)}/webhook`),
  listWorkspaces: () => get<any[]>('/api/workspaces'),
  registerWorkspace: (body: unknown) => post('/api/workspaces/register', body),
  cloneWorkspace: (body: unknown) => post('/api/workspaces/clone', body),
  removeWorkspace: (path: string) => del(`/api/workspaces?path=${enc(path)}`),
  buildWorkspaceIndex: () => get('/api/workspace-index'),
  searchWorkspaces: (q: string, limit = 50) => get(`/api/workspace-search?q=${enc(q)}&limit=${limit}`),
  checkUpdate: (currentVersion: string, manifestUrl: string) => post('/api/update/check', { currentVersion, manifestUrl }),
  downloadUpdate: (manifest: unknown, targetDir: string) => post('/api/update/download', { manifest, targetDir }),
  softwareUpdateStatus: ({ fetchRemote = false } = {}) => get(`/api/update/software${fetchRemote ? '?fetch=1' : ''}`),
  pullSoftwareUpdate: () => post('/api/update/software/pull', {}),
  mirrorStatus: () => get('/api/mirror'),
  refreshMirror: () => post('/api/mirror/refresh', {}),
  allTags: () => get<any[]>('/api/tags'),
  setTags: (slug: string, no: string, tags: string[]) => put(`/api/versions/${enc(slug)}/${enc(no)}/tags`, { tags }),
  buildOffline: (slug: string, no: string) => post(`/api/versions/${enc(slug)}/${enc(no)}/offline`),
  clearOffline: (slug: string, no: string) => del(`/api/versions/${enc(slug)}/${enc(no)}/offline`),
  listFeedbackDrafts: () => get<any[]>('/api/feedback/drafts'),
  createFeedbackDraft: (body: unknown) => post('/api/feedback/drafts', body),
  feedbackMarkdown: (id: string) => get(`/api/feedback/drafts/${enc(id)}/markdown`),
  feedbackScreenshotUrl: (id: string) => `/api/feedback/drafts/${enc(id)}/screenshot`,
  submitFeedback: (id: string, body: unknown) => post(`/api/feedback/drafts/${enc(id)}/submit`, body),
  removeFeedbackDraft: (id: string) => del(`/api/feedback/drafts/${enc(id)}`),
  issueIntegrations: () => get('/api/integrations/issues'),
  testIssueIntegration: (provider: string, body = {}) => post(`/api/integrations/issues/${enc(provider)}/test`, body),
  setIssueToken: (provider: string, token: string) => put(`/api/integrations/issues/${enc(provider)}/token`, { token }),
  deleteIssueToken: (provider: string) => del(`/api/integrations/issues/${enc(provider)}/token`),
  lan: () => get<any>('/api/lan'),
  requirementIntegrations: () => get('/api/integrations/requirements'),
  testRequirementIntegration: (provider: string, body = {}) =>
    post(`/api/integrations/requirements/${enc(provider)}/test`, body),
  searchExternalRequirements: (provider: string, query: string, config = {}) =>
    post(`/api/integrations/requirements/${enc(provider)}/search`, { query, config }),
  importExternalRequirement: (provider: string, key: string, config = {}) =>
    post(`/api/integrations/requirements/${enc(provider)}/import`, { key, config }),
  postRequirementComment: (provider: string, key: string, body: string, config = {}) =>
    post(`/api/integrations/requirements/${enc(provider)}/comment`, { key, body, config }),
  setRequirementToken: (provider: string, token: string) =>
    put(`/api/integrations/requirements/${enc(provider)}/token`, { token }),
  deleteRequirementToken: (provider: string) => del(`/api/integrations/requirements/${enc(provider)}/token`),
  inspectHtml: (html: string) => post('/api/import/html', { html }),
  importUrl: (url: string) => post('/api/import/url', { url }),
  watchInbox: () => get<any[]>('/api/watch/inbox'),
  retryWatchItem: (id: string) => post(`/api/watch/inbox/${enc(id)}/retry`, {}),
  clearWatchItem: (id: string) => del<any>(`/api/watch/inbox/${enc(id)}`),
  trash: (project?: string) => get<any[]>(`/api/trash${project ? `?project=${enc(project)}` : ''}`),
  restoreTrashItem: (id: string) => post<any>(`/api/trash/${enc(id)}/restore`, {}),
  gitStatus: ({ fast = false, cache = false } = {}) => {
    const query = new URLSearchParams();
    if (fast) query.set('fast', '1');
    if (cache) query.set('cache', '1');
    const suffix = query.toString();
    return get<any>(`/api/git/status${suffix ? `?${suffix}` : ''}`);
  },
  gitPermission: () => get('/api/git/permission'),
  refreshGitPermission: () => post('/api/git/permission/refresh', {}),
  gitSync: (message: string) => post('/api/git/sync', { message }),
  gitConflicts: () => get<any[]>('/api/git/conflicts'),
  gitResolve: (slug: string, versionNo: string) => post(`/api/git/resolve/${enc(slug)}`, { versionNo }),
  gitDoctor: () => get<any>('/api/git/doctor'),
  gitInit: (body = {}) => post('/api/git/init', body),
  gitIdentity: () => get('/api/git/identity'),
  gitSetIdentity: (body: unknown) => put('/api/git/identity', body),
  gitMarkResolved: (paths: string[]) => post('/api/git/resolved', { paths }),
  gitContinue: () => post('/api/git/continue', {}),
  gitAbort: () => post('/api/git/abort', {}),
  gitSuggestMessage: () => get<any>('/api/git/suggest-message'),
  gitBrief: (intent?: string) => get(`/api/git/brief${intent ? `?intent=${enc(intent)}` : ''}`),
  versionHistory: (slug: string, no: string) => get(`/api/versions/${enc(slug)}/${enc(no)}/history`),
  specHistory: (slug: string, no: string) => get(`/api/versions/${enc(slug)}/${enc(no)}/spec-history`),
  specAt: (slug: string, no: string, ref: string) => get(`/api/versions/${enc(slug)}/${enc(no)}/spec-at?ref=${enc(ref)}`),
  baselineHistory: (slug: string) => get(`/api/projects/${enc(slug)}/baseline-history`),
  contributors: (slug: string) => get(`/api/projects/${enc(slug)}/contributors`),
  getRemote: () => get('/api/git/remote'),
  setRemote: (url: string) => put('/api/git/remote', { url }),
  removeRemote: () => del('/api/git/remote'),
  addAttachment: (slug: string, no: string, file: File) =>
    request('POST', `/api/versions/${enc(slug)}/${enc(no)}/attachments?name=${enc(file.name)}`,
      file, { raw: true, contentType: file.type || 'application/octet-stream' }),
  removeAttachment: (slug: string, no: string, name: string) =>
    del(`/api/versions/${enc(slug)}/${enc(no)}/attachments/${enc(name)}`),
  attachmentUrl: (slug: string, no: string, name: string, download = false) =>
    `/api/versions/${enc(slug)}/${enc(no)}/attachments/${enc(name)}${download ? '?download=1' : ''}`,
  getConfig: () => get<ConfigResponse>('/api/config'),
  setConfig: (key: string, value: unknown) => put(`/api/config/${enc(key)}`, { value }),
  resetConfig: (key: string) => del(`/api/config/${enc(key)}`),
  getMcpConfig: () => get('/api/mcp'),
  saveMcpServer: (id: string, body: unknown) => put(`/api/mcp/servers/${enc(id)}`, body),
  removeMcpServer: (id: string) => del(`/api/mcp/servers/${enc(id)}`),
  discoverMcpServerTools: (id: string) => post<any>(`/api/mcp/servers/${enc(id)}/discover`, {}),
  getMcpRuntime: (id: string) => get<any>(`/api/mcp/runtime/${enc(id)}`),
  saveMcpRuntime: (id: string, body: unknown) => put<any>(`/api/mcp/runtime/${enc(id)}`, body),
  removeMcpRuntime: (id: string) => del(`/api/mcp/runtime/${enc(id)}`),
  diagnoseMcpRuntime: (id: string) => post<any>(`/api/mcp/runtime/${enc(id)}/diagnose`, {}),
  setMcpRuntimePassword: (id: string, password: string) => put(`/api/mcp/runtime/${enc(id)}/password`, { password }),
  deleteMcpRuntimePassword: (id: string) => del(`/api/mcp/runtime/${enc(id)}/password`),
  setMcpServerSecret: (id: string, value: string) => put(`/api/mcp/servers/${enc(id)}/secret`, { value }),
  deleteMcpServerSecret: (id: string) => del(`/api/mcp/servers/${enc(id)}/secret`),
  saveMcpCapability: (name: string, body: unknown) => put(`/api/mcp/capabilities/${enc(name)}`, body),
  removeMcpCapability: (name: string) => del(`/api/mcp/capabilities/${enc(name)}`),
  testMcpCapability: (name: string, body = {}) => post(`/api/mcp/capabilities/${enc(name)}/test`, body),
};
