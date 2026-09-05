import fs from 'node:fs'
import { err } from './errors.js'
import * as store from './store.js'

export const REQUIREMENT_STATUSES = new Set([
  'draft', 'confirmed', 'developing', 'pending-acceptance', 'completed', 'archived'
])

export function normalizeRequirementStatus(value) {
  const status = String(value || 'draft').trim().toLowerCase()
  if (!REQUIREMENT_STATUSES.has(status)) {
    throw err.bad('REQUIREMENT_STATUS_INVALID', `需求状态「${status}」不合法`)
  }
  return status
}

export function transitionRequirementStatus(current, target, { system = false } = {}) {
  const from = normalizeRequirementStatus(current)
  const to = normalizeRequirementStatus(target)
  const bySystem = system === true
  if (from === to) return { from, to, changed: false }
  if (!bySystem && from === 'draft' && to === 'confirmed') {
    return { from, to, changed: true }
  }
  if (bySystem && from === 'confirmed' && to === 'developing') {
    return { from, to, changed: true }
  }
  if (bySystem && ['confirmed', 'developing'].includes(from) && to === 'pending-acceptance') {
    return { from, to, changed: true }
  }
  if (bySystem && from === 'pending-acceptance' && to === 'developing') {
    return { from, to, changed: true }
  }
  if (bySystem && from === 'pending-acceptance' && to === 'completed') {
    return { from, to, changed: true }
  }
  throw err.conflict(
    'REQUIREMENT_TRANSITION_INVALID',
    `不允许${bySystem ? '系统' : '用户'}将需求从 ${from} 转为 ${to}`
  )
}

export function confirmationPreflight(root, requirement) {
  const blockers = []
  const code = String(requirement?.code || '').trim()
  const repairTo = code ? `/requirements/${encodeURIComponent(code)}` : '/requirements'
  if (!String(requirement?.title || '').trim()) {
    blockers.push({ code: 'REQUIREMENT_TITLE_REQUIRED', message: '需求缺少标题', repairTo })
  }
  if (!String(requirement?.description || '').trim()) {
    blockers.push({ code: 'REQUIREMENT_DESCRIPTION_REQUIRED', message: '需求缺少描述', repairTo })
  }
  if (!String(requirement?.owner || '').trim()) {
    blockers.push({ code: 'REQUIREMENT_OWNER_REQUIRED', message: '需求缺少负责人', repairTo })
  }
  const specFile = code ? store.paths.requirementSpec(root, code) : ''
  const hasSpec = specFile && fs.existsSync(specFile) && fs.readFileSync(specFile, 'utf8').trim()
  if (!hasSpec) {
    blockers.push({ code: 'REQUIREMENT_SPEC_REQUIRED', message: '需求缺少规格书', repairTo })
  }
  return { ready: blockers.length === 0, blockers }
}
