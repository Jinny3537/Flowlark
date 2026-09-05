import assert from 'node:assert/strict';
import { test } from 'node:test';
import { acceptanceInput, deliveryWriteGuard } from './deliveryAcceptanceModel.js';

const roles = [{ id: 'qa', name: '测试', required: true }];
const writable = { kind: 'delivery', canWrite: true, integrityReady: true, snapshotHash: 'sha256:verified', loading: false };

test('legacy, unknown permissions and unverified evidence cannot enable write actions', () => {
  assert.equal(deliveryWriteGuard(writable), '');
  for (const patch of [{ kind: 'legacy' }, { kind: undefined }, { canWrite: false }, { canWrite: undefined },
    { integrityReady: false }, { snapshotHash: '' }, { loading: true }]) {
    assert.ok(deliveryWriteGuard({ ...writable, ...patch }));
  }
});

test('stale role choices and missing evidence are rejected before submitting', () => {
  assert.throws(() => acceptanceInput({ role: 'removed', verdict: 'approved' }, roles, 'hash'), /角色/);
  assert.throws(() => acceptanceInput({ role: 'qa', verdict: 'approved' }, roles, ''), /重新加载/);
  assert.throws(() => acceptanceInput({ role: 'qa', verdict: 'invalid' }, roles, 'hash'), /结论/);
});

test('waiver requires an explicit reason and switching verdict removes stale condition fields', () => {
  assert.throws(() => acceptanceInput({ role: 'qa', verdict: 'waived', note: '  ' }, roles, 'hash'), /原因/);
  const input = acceptanceInput({ role: 'qa', verdict: 'approved', note: ' 已复核 ', conditions: [{ text: '' }] }, roles, 'hash');
  assert.deepEqual(input, { role: 'qa', verdict: 'approved', note: '已复核', conditions: [], expectedSnapshotHash: 'hash' });
});

test('conditional revision preserves IDs and requires an explicit checkbox closure', () => {
  const values = { role: 'qa', verdict: 'conditional', note: '', conditions: [
    { id: 'original-1', text: ' 复测导出 ', closed: true }, { id: 'original-2', text: '检查权限', closed: 'true' },
  ] };
  const before = structuredClone(values);
  const input = acceptanceInput(values, roles, 'hash');
  assert.deepEqual(input.conditions, [
    { id: 'original-1', text: '复测导出', closed: true }, { id: 'original-2', text: '检查权限', closed: false },
  ]);
  assert.deepEqual(values, before);
  input.conditions[0].closed = false;
  assert.deepEqual(values, before);
});

test('conditional forms cannot submit empty, blank or duplicate conditions', () => {
  for (const conditions of [[], undefined, [{ id: 'a', text: ' ' }], [{ id: 'a', text: 'one' }, { id: 'a', text: 'two' }]]) {
    assert.throws(() => acceptanceInput({ role: 'qa', verdict: 'conditional', conditions }, roles, 'hash'));
  }
});
