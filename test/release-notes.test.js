import { test } from 'node:test'
import assert from 'node:assert/strict'
import { newHub, html, cleanup } from './helpers.js'
import { changesToText, textToChanges, releaseNotesTemplate } from '../web/src/pages/workbench/releaseNotesModel.js'

test('完整发布说明可新建、修改和重新读取，保留段落且不受 200 字限制', () => {
  const { root, hub } = newHub()
  try {
    hub.createProject({ name: '西普化学', code: 'xipu' })
    const content = releaseNotesTemplate.replace('项目名称 版本号', '西普化学 2.8.3.0')
    assert.ok(content.length > 200)
    hub.addVersion('xipu', { versionNo: '2.8.3.0', title: '发布说明', html: html(), changes: textToChanges(content) })
    assert.equal(changesToText(hub.getVersion('xipu', '2.8.3.0').changes), content)
    const updated = content.replace('新增内容。', '新增移动端（小程序、App）一般/旁路作业票申请功能。')
    hub.setChanges('xipu', '2.8.3.0', textToChanges(updated))
    assert.equal(changesToText(hub.getVersion('xipu', '2.8.3.0').changes), updated)
    hub.setChanges('xipu', '2.8.3.0', textToChanges('  \n '))
    assert.deepEqual(hub.getVersion('xipu', '2.8.3.0').changes, [])
  } finally {
    cleanup(root)
  }
})

test('历史结构化日志转换保留类型、位置、说明和需求号', () => {
  const text = changesToText([
    { type: 'ADD', location: '作业安全', content: '新增作业申请', requirement: 'REQ-1' },
    { type: 'REMOVE', location: '交接班', content: '取消跨部门限制' },
  ])
  assert.equal(text, '【新增】【作业安全】新增作业申请（关联需求：REQ-1）\n\n【删除】【交接班】取消跨部门限制')
  assert.equal(changesToText(textToChanges(text)), text)
})
