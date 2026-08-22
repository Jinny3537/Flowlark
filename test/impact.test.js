import { after,describe,test } from 'node:test'
import { cleanup,html,newHub } from './helpers.js'
const dirs=[];after(()=>dirs.forEach(cleanup))
describe('影响面提示',()=>{test('每条建议携带可追溯来源',(t)=>{const{root,hub}=newHub();dirs.push(root);hub.createProject({name:'订单',code:'orders'});hub.addVersion('orders',{versionNo:'v1',title:'一版',html:html(),changes:[{type:'修改',location:'订单列表-筛选区',content:'压缩布局',requirement:'REQ-1'}]});const result=hub.suggestImpact([{type:'修改',location:'订单列表 / 筛选区'}]);t.assert.strictEqual(result.length,1);t.assert.strictEqual(result[0].source.project,'orders');t.assert.deepStrictEqual(result[0].requirements,['REQ-1'])})})
