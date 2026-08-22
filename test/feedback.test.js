import { after, describe, test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import { cleanup, tmpRepo } from './helpers.js'
import {
  decodeAnchor,
  encodeAnchor,
  listFeedbackDrafts,
  normalizeFeedback,
  readFeedbackDraft,
  readFeedbackScreenshot,
  removeFeedbackDraft,
  renderFeedbackMarkdown,
  saveFeedbackDraft
} from '../src/core/feedback.js'

const dirs = []
after(() => dirs.forEach(cleanup))

function sample(overrides = {}) {
  return {
    title: '按钮无响应',
    description: '点击确认后没有状态变化',
    project: 'orders',
    version: 'v2.4',
    baseline: 'v2.3',
    requirements: ['REQ-27', 'REQ-27'],
    anchor: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 },
    url: 'http://127.0.0.1:7788/#/projects/orders/versions/v2.4',
    changes: [{ type: '交互', location: '确认弹窗', content: '新增二次确认' }],
    ...overrides
  }
}

describe('反馈模型', () => {
  test('规范化坐标、需求去重并生成上下文 Markdown', (t) => {
    const item = normalizeFeedback(sample())
    t.assert.deepStrictEqual(item.requirements, ['REQ-27'])
    t.assert.deepStrictEqual(decodeAnchor(encodeAnchor(item.anchor)), item.anchor)

    const markdown = renderFeedbackMarkdown(item)
    t.assert.match(markdown, /按钮无响应/)
    t.assert.match(markdown, /REQ-27/)
    t.assert.match(markdown, /v2\.4/)
    t.assert.match(markdown, /确认弹窗/)
  })

  test('拒绝越界、空描述和伪造草稿编号', (t) => {
    t.assert.throws(() => normalizeFeedback(sample({ anchor: { x: 0.9, y: 0, width: 0.2, height: 0.2 } })),
      (e) => e.code === 'FEEDBACK_ANCHOR_INVALID')
    t.assert.throws(() => normalizeFeedback(sample({ description: '' })),
      (e) => e.code === 'FEEDBACK_INVALID')
    t.assert.throws(() => normalizeFeedback(sample({ id: '../../outside' })),
      (e) => e.code === 'FEEDBACK_ID_INVALID')
  })

  test('草稿和截图只写入本机缓存，可列出、读取和删除', (t) => {
    const root = tmpRepo()
    dirs.push(root)
    const screenshot = Buffer.from('png bytes')
    const saved = saveFeedbackDraft(root, sample(), screenshot)

    t.assert.strictEqual(saved.hasScreenshot, true)
    t.assert.strictEqual(listFeedbackDrafts(root).length, 1)
    t.assert.strictEqual(readFeedbackDraft(root, saved.id).title, '按钮无响应')
    t.assert.deepStrictEqual(readFeedbackScreenshot(root, saved.id), screenshot)
    t.assert.strictEqual(fs.existsSync(path.join(root, '.flowlark', 'cache', 'feedback', `${saved.id}.json`)), true)

    removeFeedbackDraft(root, saved.id)
    t.assert.deepStrictEqual(listFeedbackDrafts(root), [])
    t.assert.strictEqual(readFeedbackScreenshot(root, saved.id), null)
  })
})
