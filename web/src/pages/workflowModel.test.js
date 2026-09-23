import test from 'node:test';
import assert from 'node:assert/strict';
import { assignmentPreview, scopeCounts, safeReturn, contextualRoute, deliveryDraftKey } from './workflowModel.js';
test('范围计数与预览不混淆映射行、项目版本和需求', () => {
  const a = { requirement: 'A', project: 'p', version: 'v1' };
  const rows = [a, { ...a, requirement: 'B' }, { ...a, project: 'q' }];
  assert.deepEqual(scopeCounts(rows), { requirements: 2, projects: 2, versions: 2 });
  const result = assignmentPreview(rows, [{ ...a, version: 'v2' }], 'replace');
  assert.equal(result.items.length, 3);
  assert.equal(result.conflicts.length, 1);
  assert.ok(result.items.some(x => x.project === 'q' && x.version === 'v1'));
});
test('返回地址限制在内部页面并保留来源筛选，草稿按仓库隔离', () => {
  for (const url of ['https://evil.test', '//evil.test', '/\\evil.test', '/settings', '/projects\nmalformed']) assert.equal(safeReturn(url), '');
  const source = '/projects/orders?version=v1&filter=active';
  const target = contextualRoute('/requirements/A?tab=rules', source, '订单');
  const params = new URLSearchParams(target.split('?')[1]);
  assert.equal(params.get('returnTo'), source); assert.equal(params.get('tab'), 'rules');
  assert.notEqual(deliveryDraftKey('/repo/a', 'first'), deliveryDraftKey('/repo/b', 'first'));
});
