import { err } from '../../errors.js'
import * as github from './github.js'
import * as gitlab from './gitlab.js'
import * as gitee from './gitee.js'

const PROVIDERS = { github, gitlab, gitee }

function adapter(name) {
  const item = PROVIDERS[String(name || '').toLowerCase()]
  if (!item) throw err.bad('INTEGRATION_PROVIDER_INVALID', `不支持的 Issue 平台：${name}`)
  return item
}

export function issueProviders() {
  return Object.keys(PROVIDERS)
}

export function testIssueConnection(provider, config) {
  return adapter(provider).testConnection(config)
}

export function createIssue(provider, config, feedback) {
  return adapter(provider).createIssue(config, feedback)
}

export function searchIssues(provider, config, text) {
  return adapter(provider).searchIssues(config, text)
}
