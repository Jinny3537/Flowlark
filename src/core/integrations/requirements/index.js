import { err } from '../../errors.js'
import * as hubpool from './hubpool.js'
import * as custom from './custom.js'

const PROVIDERS = { hubpool, custom }

function adapter(name) {
  const value = String(name || '').toLowerCase()
  const item = PROVIDERS[value]
  if (!item) throw err.bad('REQUIREMENT_PROVIDER_INVALID', `不支持的需求平台：${name}`)
  return item
}

export function requirementProviders() {
  return Object.keys(PROVIDERS)
}

export function testRequirementConnection(provider, config) {
  return adapter(provider).testConnection(config)
}

export function searchRequirements(provider, config, text) {
  return adapter(provider).searchRequirements(config, text)
}

export function fetchRequirement(provider, config, key) {
  return adapter(provider).fetchRequirement(config, key)
}

export function postRequirementComment(provider, config, key, body) {
  return adapter(provider).postComment(config, key, body)
}
