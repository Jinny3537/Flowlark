import { after, describe, test } from 'node:test'
import { cleanup, newHub } from './helpers.js'

const dirs = []
after(() => dirs.forEach(cleanup))

describe('团队已存视图', () => {
  test('新增、覆盖和删除', (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.saveView({ id: 'pending-review', name: '待评审', scope: 'versions', filters: { reviewStatus: ['pending'] } })
    hub.saveView({ id: 'pending-review', name: '本周待评审', scope: 'versions', filters: { updatedWithinDays: 7 } })
    t.assert.strictEqual(hub.listSavedViews().length, 1)
    t.assert.strictEqual(hub.listSavedViews()[0].name, '本周待评审')
    hub.removeView('pending-review')
    t.assert.deepStrictEqual(hub.listSavedViews(), [])
  })
})
