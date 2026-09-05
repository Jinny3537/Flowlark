import assert from 'node:assert/strict'
import { test } from 'node:test'
import { aggregateAcceptance, normalizeAcceptanceRules } from '../src/core/acceptance-rules.js'

const required = { id: 'product', name: '产品', required: true }
const optional = { id: 'observer', name: '观察者', required: false }
const customRules = (roles = [required]) => ({ roles, rule: { type: 'all-required' } })
const record = (role = 'product', verdict = 'approved', extra = {}) => ({
  id: 'record-1', role, verdict, at: '2026-09-05T01:00:00.000Z', ...extra
})

test('default rules are complete and independently allocated', () => {
  const rules = normalizeAcceptanceRules()
  assert.deepEqual(rules, {
    roles: [required, { id: 'development', name: '研发', required: true }, { id: 'qa', name: '测试', required: true }],
    rule: { type: 'all-required' }
  })
  rules.roles[0].required = false
  rules.rule.type = 'changed'
  assert.equal(normalizeAcceptanceRules().roles[0].required, true)
  assert.equal(normalizeAcceptanceRules().rule.type, 'all-required')
  assert.equal(aggregateAcceptance(undefined, []).status, 'pending')
})

test('invalid rule shapes and unsupported fields never silently become defaults', () => {
  const cases = [null, [], 'all-required', 4, false, new Date(), {},
    { roles: [required] }, { rule: { type: 'all-required' } },
    customRules([]), customRules([optional]), customRules(Array(21).fill(required)),
    { ...customRules(), rule: null }, { ...customRules(), rule: { type: 'any' } },
    { ...customRules(), rule: { type: 'all-required', execute: true } },
    { ...customRules(), actor: 'admin' }, { ...customRules(), autoExecute: true },
    customRules([{ ...required, actor: 'admin' }]), customRules([required, required])]
  for (const value of cases) assert.throws(() => normalizeAcceptanceRules(value), { status: 400 })
})

test('role IDs, names and required flags have strict boundaries', () => {
  for (const id of ['', 'A', 'has space', '中文', 'a/b', 'a'.repeat(41), 1]) {
    assert.throws(() => normalizeAcceptanceRules(customRules([{ ...required, id }])))
  }
  for (const name of ['', '  ', 'a'.repeat(81), null, 8]) {
    assert.throws(() => normalizeAcceptanceRules(customRules([{ ...required, name }])))
  }
  for (const value of [undefined, 'true', 1, null]) {
    assert.throws(() => normalizeAcceptanceRules(customRules([{ ...required, required: value }])))
  }
  const roles = Array.from({ length: 20 }, (_, index) => ({ id: `role_${index}-x`, name: 'a'.repeat(80), required: index === 0 }))
  assert.equal(normalizeAcceptanceRules(customRules(roles)).roles.length, 20)
  assert.equal(normalizeAcceptanceRules(customRules([{ ...required, id: 'a'.repeat(40), name: ' 产品 ' }])).roles[0].name, '产品')
})

test('latest role record wins regardless of record order', () => {
  const old = record('product', 'rejected')
  const latest = record('product', 'approved', { id: 'record-2', at: '2026-09-05T02:00:00.000Z' })
  for (const records of [[old, latest], [latest, old]]) {
    const result = aggregateAcceptance(customRules(), records)
    assert.equal(result.status, 'approved')
    assert.equal(result.ready, true)
    assert.deepEqual(result.blockers, [])
    assert.deepEqual(result.roles[0].latest, latest)
  }
  assert.equal(aggregateAcceptance(customRules(), [latest, record('product', 'pending', { at: '2026-09-06T00:00:00Z' })]).status, 'pending')
})

test('equal timestamps choose lexically greater record ID, including equivalent ISO offsets', () => {
  const a = record('product', 'approved', { id: 'a' })
  const z = record('product', 'rejected', { id: 'z', at: '2026-09-05T09:00:00+08:00' })
  for (const records of [[a, z], [z, a]]) {
    assert.equal(aggregateAcceptance(customRules(), records).status, 'rejected')
    assert.equal(aggregateAcceptance(customRules(), records).roles[0].latest.id, 'z')
  }
})

test('required rejection takes precedence over missing submissions and feedback blockers', () => {
  const result = aggregateAcceptance(undefined, [record('product', 'rejected')], { blockingFeedback: 2 })
  assert.equal(result.status, 'rejected')
  assert.equal(result.ready, false)
  assert.equal(result.roles.find((role) => role.id === 'qa').latest, null)
  assert.equal(result.blockers.length, 4)
})

test('optional rejection, open conditions or missing submissions do not block required approval', () => {
  for (const records of [[], [record('observer', 'rejected')], [record('observer', 'conditional', { conditions: [{ closed: false }] })]]) {
    const result = aggregateAcceptance(customRules([required, optional]), [record(), ...records])
    assert.equal(result.status, 'approved')
    assert.deepEqual(result.blockers, [])
  }
  assert.equal(aggregateAcceptance(customRules([required, optional]), [record(), record('observer', 'rejected')]).roles[1].status, 'rejected')
})

test('conditions pass only when every condition has closed exactly true', () => {
  for (const conditions of [[{ closed: false }], [{ closed: true }, {}], [{ closed: 'true' }]]) {
    assert.equal(aggregateAcceptance(customRules(), [record('product', 'conditional', { conditions })]).status, 'pending')
  }
  const result = aggregateAcceptance(customRules(), [record('product', 'conditional', { conditions: [{ closed: true }, { closed: true }] })])
  assert.equal(result.status, 'approved')
  assert.equal(result.roles[0].latest.verdict, 'conditional')
  for (const conditions of [undefined, null, {}, [], [null], [true]]) {
    assert.throws(() => aggregateAcceptance(customRules(), [record('product', 'conditional', { conditions })]))
  }
})

test('waived decisions pass only with a nonblank reason', () => {
  const result = aggregateAcceptance(customRules(), [record('product', 'waived', { note: '已由客户另行验证' })])
  assert.equal(result.status, 'approved')
  assert.equal(result.roles[0].latest.verdict, 'waived')
  for (const note of [undefined, null, '', '  ', 1]) {
    assert.throws(() => aggregateAcceptance(customRules(), [record('product', 'waived', { note })]))
  }
})

test('unresolved blocking feedback prevents approval and invalid counts are rejected', () => {
  const result = aggregateAcceptance(customRules(), [record()], { blockingFeedback: 3 })
  assert.equal(result.status, 'pending')
  assert.equal(result.ready, false)
  assert.equal(result.blockers[0].count, 3)
  assert.equal(result.blockers[0].code, 'ACCEPTANCE_BLOCKING_FEEDBACK')
  for (const blockingFeedback of [-1, 0.5, NaN, Infinity, '0', null]) {
    assert.throws(() => aggregateAcceptance(customRules(), [record()], { blockingFeedback }))
  }
})

test('malformed records are rejected even when a newer approval exists', () => {
  const invalid = [null, [], {}, record('unknown'), record('product', 'accept'), record('product', 'approved', { id: '' }),
    ...['yesterday', '2026-09-05', '2026-02-30T00:00:00Z', '2026-13-01T00:00:00Z', null].map((at) => record('product', 'approved', { at }))]
  for (const item of invalid) {
    assert.throws(() => aggregateAcceptance(customRules(), [item, record('product', 'approved', { at: '2026-10-01T00:00:00Z' })]))
  }
  for (const records of [undefined, null, {}, 'records']) assert.throws(() => aggregateAcceptance(customRules(), records))
})

test('aggregation preserves all inputs and detaches nested returned metadata', () => {
  const rules = customRules()
  const records = [record('product', 'conditional', {
    conditions: [{ title: '复测', closed: true }], actor: { name: '张三' }, snapshot: 'delivery-1'
  })]
  const original = structuredClone({ rules, records })
  const result = aggregateAcceptance(rules, records)
  assert.deepEqual({ rules, records }, original)
  result.roles[0].name = 'changed'
  result.roles[0].latest.actor.name = 'changed'
  result.roles[0].latest.conditions[0].closed = false
  assert.deepEqual({ rules, records }, original)
  const normalized = normalizeAcceptanceRules(rules)
  normalized.roles[0].required = false
  normalized.rule.type = 'changed'
  assert.deepEqual(rules, original.rules)
})
