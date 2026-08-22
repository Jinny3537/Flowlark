import { renderFeedbackMarkdown } from '../../feedback.js'
import { cleanBaseUrl, fetchJson, query, requireToken } from './client.js'

function token(config) {
  return requireToken(config, 'FLOWLARK_GITEE_TOKEN')
}

function repoPath(config) {
  return `${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`
}

export async function testConnection(config) {
  const base = cleanBaseUrl(config.baseUrl, 'https://gitee.com/api/v5')
  const body = await fetchJson(`${base}/user?${query({ access_token: token(config) })}`)
  return { provider: 'gitee', ok: true, identity: body.login || body.name || null }
}

export async function createIssue(config, feedback) {
  const base = cleanBaseUrl(config.baseUrl, 'https://gitee.com/api/v5')
  const body = await fetchJson(`${base}/repos/${repoPath(config)}/issues`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      access_token: token(config),
      title: feedback.title,
      body: renderFeedbackMarkdown(feedback),
      labels: (config.labels || ['flowlark-feedback']).join(',')
    })
  })
  return { provider: 'gitee', number: body.number, title: body.title, url: body.html_url }
}

export async function searchIssues(config, text) {
  const base = cleanBaseUrl(config.baseUrl, 'https://gitee.com/api/v5')
  const q = query({ access_token: token(config), state: 'all', direction: 'desc' })
  const body = await fetchJson(`${base}/repos/${repoPath(config)}/issues?${q}`)
  return (body || []).filter((item) => !text || `${item.title} ${item.body || ''}`.toLowerCase().includes(String(text).toLowerCase()))
    .map((item) => ({ provider: 'gitee', number: item.number, title: item.title, url: item.html_url, state: item.state }))
}
