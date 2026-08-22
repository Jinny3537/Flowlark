import { after, describe, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import { CLI, cleanup, newHub } from './helpers.js'

const dirs = []
after(() => dirs.forEach(cleanup))

function run(root, ...args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8', cwd: root, env: { ...process.env, FLOWLARK_REPO: root, NO_COLOR: '1' }
  })
}

describe('反馈 CLI', () => {
  test('列出、导出并以 Markdown 模式提交草稿', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    const draft = hub.createFeedbackDraft({
      title: 'CLI 反馈', description: '验证 Markdown 导出', project: 'orders', version: 'v1',
      anchor: { x: 0.1, y: 0.1, width: 0.2, height: 0.2 }
    })

    let result = run(root, 'feedback', 'list')
    t.assert.strictEqual(result.status, 0, result.stderr)
    t.assert.match(result.stdout, /CLI 反馈/)

    result = run(root, 'feedback', 'export', draft.id)
    t.assert.strictEqual(result.status, 0, result.stderr)
    t.assert.match(result.stdout, /验证 Markdown 导出/)

    result = run(root, 'feedback', 'submit', draft.id, '--provider', 'markdown')
    t.assert.strictEqual(result.status, 0, result.stderr)
    t.assert.match(result.stdout, /# CLI 反馈/)
  })
})
