import { normalizeRequirement } from './client.js'
import { callTool, toolName } from '../mcp-jsonrpc.js'
import { err } from '../../errors.js'
import { requirementDetailFields } from '../../requirement-fields.js'

function isHubpool(config) {
  return config.capability?.options?.protocol === 'hubpool'
}

function cachedTool(config, name, args) {
  if (!config.hubpoolCache) return callTool(config, name, args)
  const key = JSON.stringify([name, args])
  if (!config.hubpoolCache.has(key)) config.hubpoolCache.set(key, callTool(config, name, args))
  return config.hubpoolCache.get(key)
}

function normalizeRemote(config, item) {
  if (!isHubpool(config)) return normalizeRequirement('mcp', item)
  return normalizeRequirement('mcp', {
    ...item,
    code: item.id || item.code,
    ...requirementDetailFields(item, { defaults: true }),
    description: item.businessDescription || item.rawDescription || '',
    project: item.projectName || item.projectId || config.project || '',
    sourceUpdatedAt: item.updatedAt ? new Date(item.updatedAt).toISOString() : ''
  })
}

function itemsFrom(body) {
  if (Array.isArray(body)) return body
  return (body && (body.items || body.data || body.results || body.requirements)) || []
}

function identityFrom(body) {
  if (!body || typeof body !== 'object') return null
  return body.identity || body.name || body.login || body.email || body.text || null
}

export async function testConnection(config) {
  const name = toolName(config, 'mePath', 'requirements.test')
  const body = await cachedTool(config, name, isHubpool(config) ? {} : { project: config.project || '' })
  if (isHubpool(config)) {
    if (config.capability.options.scope === 'all' || !config.project) {
      if (!Array.isArray(body)) throw err.bad('REQUIREMENT_REMOTE_INVALID', 'HubPooL 项目列表格式无效')
      return { provider: 'mcp', ok: true, identity: `HubPooL · 全部 ${body.length} 个项目` }
    }
    const project = itemsFrom(body).find((item) => item.id === config.project)
    if (!project) throw err.bad('REQUIREMENT_PROJECT_INVALID', 'HubPooL 中未找到绑定项目，请检查项目 ID')
    return { provider: 'mcp', ok: true, identity: `HubPooL · ${project.name}` }
  }
  return { provider: 'mcp', ok: true, identity: identityFrom(body) }
}

export async function searchRequirements(config, text) {
  const name = toolName(config, 'searchPath', 'requirements.search')
  if (!isHubpool(config)) {
    return itemsFrom(await callTool(config, name, { query: text || '', q: text || '', text: text || '', project: config.project || '', limit: config.limit || 20 })).map(item => normalizeRemote(config, item))
  }
  const all = config.capability.options.scope === 'all' || !config.project
  const projects = all ? await cachedTool(config, 'list_projects', {}) : [{ id: config.project, name: '' }]
  if (!Array.isArray(projects)) throw err.bad('REQUIREMENT_REMOTE_INVALID', 'HubPooL 项目列表格式无效')
  const output = []
  config = { ...config, hubpoolCache: config.hubpoolCache || new Map() }
  for (const project of projects) {
    const summary = { id: project.id, name: project.name || project.id, code: project.code || '', archived: !!project.archived, count: 0, ok: false }
    try {
      const body = await callTool(config, name, { projectId: project.id, keyword: text || '', limit: config.limit || 20 })
      if (!Array.isArray(body)) throw err.bad('REQUIREMENT_REMOTE_INVALID', 'HubPooL 需求列表格式无效')
      const entries = []
      for (const item of body) {
        let detail
        try { detail = await cachedTool(config, toolName(config, 'detailPath', 'get_requirement_detail'), { requirementId: item.id }) }
        catch (error) {
          if (!config.onProject) throw error
          entries.push(normalizeRemote(config, { ...item, projectId: project.id, projectName: project.name }))
          continue // 同步阶段逐条报告详情失败，不阻断同项目其他需求
        }
        if (detail.trashedAt) { config.onExcluded?.(item.id); continue }
        entries.push(normalizeRemote(config, { ...item, projectId: project.id, projectName: project.name }))
      }
      output.push(...entries)
      summary.count = entries.length
      summary.ok = true
      if (body.length >= (config.limit || 20)) config.onWarning?.(`${summary.name}：已达到单次 ${config.limit || 20} 条上限，数据可能不完整`)
    } catch (error) {
      summary.error = error.message
      if (!config.onProject) throw error
    }
    config.onProject?.(summary)
  }
  return output
}

export async function fetchRequirement(config, key) {
  const name = toolName(config, 'detailPath', 'requirements.get')
  const body = await cachedTool(config, name, isHubpool(config)
    ? { requirementId: key }
    : { key, code: key, project: config.project || '' })
  if (isHubpool(config)) {
    if (body.trashedAt) {
      const error = err.bad('REQUIREMENT_SOURCE_TRASHED', '需求已在需求池回收站，不能导入或更新')
      error.sourceTrashedAt = String(body.trashedAt)
      throw error
    }
    const [projects, versions] = await Promise.all([
      cachedTool(config, 'list_projects', {}),
      body.versionId ? cachedTool(config, 'list_versions', { projectId: body.projectId || config.project }) : []
    ])
    return normalizeRemote(config, {
      ...body,
      projectName: itemsFrom(projects).find((project) => project.id === body.projectId)?.name,
      versionName: itemsFrom(versions).find((version) => version.id === body.versionId)?.name || ''
    })
  }
  return normalizeRemote(config, body)
}

export async function postComment(config, key, body) {
  if (isHubpool(config)) throw err.bad('REQUIREMENT_COMMENT_UNSUPPORTED', 'HubPooL 协议不支持直接回写评论，请在需求池中处理修改提案')
  const name = toolName(config, 'commentPath', 'requirements.comment')
  const result = await callTool(config, name, {
    key,
    code: key,
    body,
    content: body,
    project: config.project || ''
  })
  return { provider: 'mcp', ok: true, url: result && (result.url || result.web_url || result.html_url) || null }
}
