import { err } from '../../errors.js'
import * as mcp from './mcp.js'
import * as assessTask from '../assess-task/adapter.js'

const PROVIDERS = { mcp, 'assess-task': assessTask }

function adapter(name) {
  const value = String(name || '').toLowerCase()
  const item = PROVIDERS[value]
  if (!item) throw err.bad('MILESTONE_PROVIDER_INVALID', `不支持的迭代平台：${name}`)
  return item
}

export function milestoneProviders() {
  return Object.keys(PROVIDERS)
}

export function testMilestoneConnection(provider, config) {
  return adapter(provider).testConnection(config)
}

export function listMilestones(provider, config) {
  return adapter(provider).listMilestones(config)
}

export function fetchMilestone(provider, config, key) {
  return adapter(provider).fetchMilestone(config, key)
}

export function upsertMilestone(provider, config, milestone) {
  return adapter(provider).upsertMilestone(config, milestone)
}
