import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { newHub, cleanup, html } from './helpers.js'
import { startServer } from '../src/server/index.js'
import * as projectTrash from '../src/core/project-trash.js'

test('项目删除可恢复完整原型、基线和关联；保留独立需求与迭代', t => {
  const { root, hub } = newHub(); t.after(() => cleanup(root))
  hub.createProject({ name: '测试删除', code: 'DEL' })
  hub.createRequirement({ code: 'R-1', title: '保留需求', project: '测试删除' })
  hub.addVersion('del', { versionNo: 'v1', title: '版本', html: html('需要恢复的内容'), requirements: [{ code: 'R-1' }] })
  fs.writeFileSync(`${root}/projects/del/BASELINE`, 'v1\n')
  const before = fs.readFileSync(`${root}/projects/del/versions/v1.html`, 'utf8')
  const result = hub.deleteProject('del')
  assert.equal(result.versionCount, 1)
  assert.equal(hub.listProjects().length, 0)
  assert.throws(() => hub.getProject('del'))
  assert.equal(hub.listDeletedProjects()[0].name, '测试删除')
  assert.equal(hub.getRequirement('R-1').title, '保留需求')
  assert.equal(projectTrash.isDeletedProject(root, { name: '测试删除', code: 'DEL' }), true)
  assert.throws(() => hub.createProject({ name: '测试删除', code: 'DEL' }), { code: 'PROJECT_DELETED' })
  hub.restoreProject('del')
  assert.equal(hub.listDeletedProjects().length, 0)
  assert.equal(hub.getProject('del').versionCount, 1)
  assert.equal(hub.getProject('del').baselineVersionNo, 'v1')
  assert.equal(fs.readFileSync(`${root}/projects/del/versions/v1.html`, 'utf8'), before)
  assert.equal(hub.getRequirement('R-1').versions.length, 1)
  assert.throws(() => hub.deleteProject('../escape'), { code: 'PROJECT_SLUG_INVALID' })
  assert.throws(() => hub.restoreProject('../escape'), { code: 'PROJECT_SLUG_INVALID' })
})

test('项目删除与恢复 API 工作正常，远端无写权限', async t => {
  const { root, hub } = newHub(); t.after(() => cleanup(root))
  hub.createProject({ name: 'API项目', code: 'API' })
  const server = await startServer(root, { port: 0, previewPort: 0 }); t.after(() => server.close())
  const base = server.url
  const denied = await fetch(`${base}/api/projects/api`, { method: 'DELETE', headers: { 'x-forwarded-for': '192.0.2.1' } })
  assert.equal(denied.status, 403)
  assert.equal((await fetch(`${base}/api/projects/api`, { method: 'DELETE' })).status, 200)
  assert.equal((await (await fetch(`${base}/api/deleted-projects`)).json()).length, 1)
  assert.equal((await fetch(`${base}/api/deleted-projects/api/restore`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 200)
  assert.equal(hub.listProjects().length, 1)
})
