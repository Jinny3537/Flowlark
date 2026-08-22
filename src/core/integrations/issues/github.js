import { renderFeedbackMarkdown } from '../../feedback.js'
import { cleanBaseUrl, fetchJson, query, requireToken } from './client.js'

function headers(config) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${requireToken(config, 'FLOWLARK_GITHUB_TOKEN')}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28'
  }
}

function repoPath(config) {
  return `${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`
}

export async function testConnection(config) {
  const base = cleanBaseUrl(config.baseUrl, 'https://api.github.com')
  const body = await fetchJson(`${base}/user`, { headers: headers(config) })
  return { provider: 'github', ok: true, identity: body.login || body.name || null }
}

export async function createIssue(config, feedback) {
  const base = cleanBaseUrl(config.baseUrl, 'https://api.github.com')
  const body = await fetchJson(`${base}/repos/${repoPath(config)}/issues`, {
    method: 'POST', headers: headers(config), body: JSON.stringify({
      title: feedback.title,
      body: renderFeedbackMarkdown(feedback),
      labels: config.labels || ['flowlark-feedback']
    })
  })
  return { provider: 'github', number: body.number, title: body.title, url: body.html_url }
}

export async function searchIssues(config, text) {
  const base = cleanBaseUrl(config.baseUrl, 'https://api.github.com')
  const q = query({ q: `${text || ''} repo:${config.owner}/${config.repo} label:flowlark-feedback` })
  const body = await fetchJson(`${base}/search/issues?${q}`, { headers: headers(config) })
  return (body.items || []).map((item) => ({ provider: 'github', number: item.number, title: item.title, url: item.html_url, state: item.state }))
}
