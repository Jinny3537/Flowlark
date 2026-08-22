import { renderFeedbackMarkdown } from '../../feedback.js'
import { cleanBaseUrl, fetchJson, query, requireToken } from './client.js'

function headers(config) {
  return { 'PRIVATE-TOKEN': requireToken(config, 'FLOWLARK_GITLAB_TOKEN'), 'Content-Type': 'application/json' }
}

function project(config) {
  return encodeURIComponent(String(config.projectId || config.project || ''))
}

export async function testConnection(config) {
  const base = cleanBaseUrl(config.baseUrl, 'https://gitlab.com/api/v4')
  const body = await fetchJson(`${base}/user`, { headers: headers(config) })
  return { provider: 'gitlab', ok: true, identity: body.username || body.name || null }
}

export async function createIssue(config, feedback) {
  const base = cleanBaseUrl(config.baseUrl, 'https://gitlab.com/api/v4')
  const body = await fetchJson(`${base}/projects/${project(config)}/issues`, {
    method: 'POST', headers: headers(config), body: JSON.stringify({
      title: feedback.title,
      description: renderFeedbackMarkdown(feedback),
      labels: (config.labels || ['flowlark-feedback']).join(',')
    })
  })
  return { provider: 'gitlab', number: body.iid, title: body.title, url: body.web_url }
}

export async function searchIssues(config, text) {
  const base = cleanBaseUrl(config.baseUrl, 'https://gitlab.com/api/v4')
  const q = query({ search: text, labels: 'flowlark-feedback', scope: 'all' })
  const body = await fetchJson(`${base}/projects/${project(config)}/issues?${q}`, { headers: headers(config) })
  return (body || []).map((item) => ({ provider: 'gitlab', number: item.iid, title: item.title, url: item.web_url, state: item.state }))
}
