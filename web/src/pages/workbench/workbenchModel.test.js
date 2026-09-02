import test from 'node:test'
import assert from 'node:assert/strict'
import {
  baselineBlocked,
  canEditStructure,
  decodeAnchor,
  encodeAnchor,
  filterVersionFeedback,
  groupChanges,
  olderSiblings,
  previewUrl,
  prototypeEditorRoute,
  requirementUrl
} from './workbenchModel.js'

const versions = [
  { versionNo: 'v3', display: { key: 'DRAFT' } },
  { versionNo: 'v2', display: { key: 'HISTORY' } },
  { versionNo: 'v1', display: { key: 'HISTORY' } }
]

test('builds encoded preview URLs and mutually exclusive modes', () => {
  const base = { protocol: 'http:', hostname: '127.0.0.1', previewPort: 7789, slug: '订单 原型', versionNo: 'v1.0' }
  assert.equal(previewUrl(base), 'http://127.0.0.1:7789/p/%E8%AE%A2%E5%8D%95%20%E5%8E%9F%E5%9E%8B/v1.0')
  assert.equal(previewUrl({ ...base, offline: true }), `${previewUrl(base)}?offline=1`)
  assert.equal(previewUrl({ ...base, edit: true }), `${previewUrl(base)}?edit=1`)
})

test('builds an encoded full-screen prototype editor route', () => {
  assert.equal(
    prototypeEditorRoute('订单 原型', 'v1.0 beta'),
    '/projects/%E8%AE%A2%E5%8D%95%20%E5%8E%9F%E5%9E%8B/versions/v1.0%20beta/edit'
  )
})

test('enforces draft structural editing and baseline rules', () => {
  assert.equal(canEditStructure({ canWrite: true, version: versions[0] }), true)
  assert.equal(canEditStructure({ canWrite: false, version: versions[0] }), false)
  assert.equal(canEditStructure({ canWrite: true, version: versions[1] }), false)
  assert.equal(canEditStructure({ canWrite: true, version: versions[1], lockBaseline: false }), true)
  assert.equal(canEditStructure({ canWrite: true, version: { display: { key: 'VOID' } }, lockBaseline: false }), false)
  assert.equal(baselineBlocked({ target: { changeCount: 0 }, totalVersions: 2 }), true)
  assert.equal(baselineBlocked({ target: { changeCount: 0 }, totalVersions: 2, requireChangelog: false }), false)
  assert.equal(baselineBlocked({ target: { changeCount: 0, baselineAt: '2026-08-01' }, totalVersions: 2 }), false)
  assert.equal(baselineBlocked({ target: { changeCount: 0 }, totalVersions: 1 }), false)
})

test('returns only siblings older than the selected version', () => {
  assert.deepEqual(olderSiblings(versions, 'v2').map(item => item.versionNo), ['v1'])
  assert.deepEqual(olderSiblings(versions, 'missing'), [])
})

test('groups changes in ADD MODIFY REMOVE order', () => {
  const groups = groupChanges([
    { type: 'REMOVE', content: 'c' },
    { type: 'ADD', content: 'a' },
    { type: 'MODIFY', content: 'b' }
  ])
  assert.deepEqual(groups.map(group => group.type), ['ADD', 'MODIFY', 'REMOVE'])
  assert.equal(groups[0].meta.label, '新增')
})

test('filters feedback and resolves requirement links', () => {
  const feedback = [
    { id: '1', project: 'orders', version: 'v2' },
    { id: '2', project: 'orders', version: 'v1' },
    { id: '3', project: 'account', version: 'v2' }
  ]
  assert.deepEqual(filterVersionFeedback(feedback, 'orders', 'v2').map(item => item.id), ['1'])
  assert.equal(requirementUrl('REQ 1', '', 'https://req.local/{code}'), 'https://req.local/REQ%201')
  assert.equal(requirementUrl('REQ-1', 'https://custom/1', 'https://req.local/{code}'), 'https://custom/1')
})

test('round-trips unicode annotation anchors', () => {
  const anchor = { x: 0.1, y: 0.2, width: 0.3, height: 0.4, label: '顶部' }
  assert.deepEqual(decodeAnchor(encodeAnchor(anchor)), anchor)
  assert.equal(decodeAnchor('invalid'), null)
})
