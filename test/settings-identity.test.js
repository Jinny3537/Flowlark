import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { newHub, cleanup } from './helpers.js';

test('clearing a settings identity removes only the local Git override', () => {
  const { root, hub } = newHub();
  const git = args => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  try {
    assert.equal(git(['init']).status, 0);
    hub.setConfig('git.userName', 'Settings User');
    hub.setConfig('git.userEmail', 'settings@example.test');
    assert.equal(git(['config', '--local', '--get', 'user.name']).stdout.trim(), 'Settings User');
    hub.resetConfig('git.userName');
    assert.equal(git(['config', '--local', '--get', 'user.name']).status, 1);
    assert.equal(git(['config', '--local', '--get', 'user.email']).stdout.trim(), 'settings@example.test');
    hub.resetConfig('git.userName'); // already absent is also a successful reset
    hub.resetConfig('git.userEmail');
    assert.equal(git(['config', '--local', '--get', 'user.email']).status, 1);
  } finally { cleanup(root); }
});
