import { after, describe, test } from 'node:test'
import { cleanup, html, newHub, throwsCode } from './helpers.js'
const dirs=[];after(()=>dirs.forEach(cleanup))
describe('审阅状态',()=>{test('新版本待评审，基线自动确认，废弃与恢复同步状态',(t)=>{const{root,hub}=newHub();dirs.push(root);hub.createProject({name:'订单',code:'orders'});hub.addVersion('orders',{versionNo:'v1',title:'一版',html:html()});t.assert.strictEqual(hub.getVersion('orders','v1').reviewStatus,'pending');hub.setReviewStatus('orders','v1','questions');t.assert.strictEqual(hub.getVersion('orders','v1').reviewStatus,'questions');hub.setReviewStatus('orders','v1','pending');hub.setBaseline('orders','v1');t.assert.strictEqual(hub.getVersion('orders','v1').reviewStatus,'confirmed');hub.addVersion('orders',{versionNo:'v2',title:'二版',html:html()});hub.voidVersion('orders','v2');t.assert.strictEqual(hub.getVersion('orders','v2').reviewStatus,'obsolete');hub.reopenVersion('orders','v2');t.assert.strictEqual(hub.getVersion('orders','v2').reviewStatus,'pending')})})

test('有疑问的新版本必须先解决问题才能设为基线', (t) => {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单', code: 'orders' })
  hub.addVersion('orders', { versionNo: 'v1', title: '首版', html: html() })
  hub.setBaseline('orders', 'v1')
  hub.addVersion('orders', {
    versionNo: 'v2', title: '二版', html: html(),
    changes: [{ type: '修改', location: '订单列表', content: '调整筛选' }]
  })
  hub.setReviewStatus('orders', 'v2', 'questions')
  throwsCode(t, 'REVIEW_QUESTIONS_BLOCKED', () => hub.setBaseline('orders', 'v2'))
  hub.setReviewStatus('orders', 'v2', 'pending')
  t.assert.strictEqual(hub.setBaseline('orders', 'v2').versionNo, 'v2')
})

test('曾经的基线有疑问时仍允许回滚止血', (t) => {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单', code: 'orders' })
  hub.addVersion('orders', { versionNo: 'v1', title: '首版', html: html() })
  hub.setBaseline('orders', 'v1')
  hub.addVersion('orders', {
    versionNo: 'v2', title: '二版', html: html(),
    changes: [{ type: '修改', location: '订单列表', content: '调整筛选' }]
  })
  hub.setBaseline('orders', 'v2')
  hub.setReviewStatus('orders', 'v1', 'questions')
  t.assert.strictEqual(hub.rollback('orders').versionNo, 'v1')
})
