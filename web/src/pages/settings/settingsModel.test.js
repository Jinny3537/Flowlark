import test from 'node:test';
import assert from 'node:assert/strict';
import { settingsLocation, configFieldVisible, softwareUpdateState } from './settingsModel.js';

test('legacy setting links retain their destination instead of dropping to the default page', () => {
  for (const [old, section, tab] of [['git', 'workspace', 'git'], ['gitRemote', 'workspace', 'gitRemote'], ['lan', 'team', 'team'], ['mcp', 'integrations', 'mcp'], ['trash', 'maintenance', 'trash'], ['oplog', 'maintenance', 'oplog'], ['softwareUpdate', 'maintenance', 'softwareUpdate'], ['server', 'maintenance', 'server'], ['ui', 'general', 'ui']]) {
    assert.deepEqual(settingsLocation(old), { section, tab });
  }
  assert.deepEqual(settingsLocation('maintenance', 'trash'), { section: 'maintenance', tab: 'trash' });
  assert.deepEqual(settingsLocation('unknown'), { section: 'general', tab: 'ui' });
  assert.deepEqual(settingsLocation('integrations'), { section: 'integrations', tab: 'feedback' });
});
test('platform-specific fields match the selected provider', () => {
  const values = { 'integrations.issueProvider': 'gitlab', 'integrations.notificationProvider': 'none' };
  assert.equal(configFieldVisible('integrations.issueProject', values), true);
  assert.equal(configFieldVisible('integrations.issueOwner', values), false);
  assert.equal(configFieldVisible('integrations.notificationEvents', values), false);
  values['integrations.issueProvider'] = 'markdown';
  assert.equal(configFieldVisible('integrations.issueProject', values), false);
  values['integrations.issueProvider'] = 'github';
  assert.equal(configFieldVisible('integrations.issueOwner', values), true);
});
test('failed, cached, dirty and incomplete update checks never claim latest or permit applying', () => {
  const status = { tracked: true, upstream: 'origin/main', available: false };
  assert.equal(softwareUpdateState(status).title, '尚未检测远端更新');
  assert.equal(softwareUpdateState(status, { verified: true }).title, '当前已是最新版本');
  for (const next of [{ ...status, error: 'offline', available: true }, { ...status, dirty: true, available: true }, { ...status, upstream: null, available: true }]) {
    const result = softwareUpdateState(next, { verified: true });
    assert.equal(result.canApply, false);
    assert.notEqual(result.title, '当前已是最新版本');
  }
  assert.equal(softwareUpdateState({ ...status, available: true }, { verified: true }).canApply, true);
  assert.equal(softwareUpdateState(status, { restartNeeded: true }).title, '软件已更新，待重启生效');
});
