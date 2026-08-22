import { after, before, describe, test } from 'node:test'
import http from 'node:http'
import { cleanup, html, newHub } from './helpers.js'
import { enqueueNotification, flushNotifications, listNotifications, renderNotification } from '../src/core/notifications.js'

const dirs=[];let server,base,received=[]
before(async()=>{server=http.createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;received.push(JSON.parse(body));res.end('{}')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base=`http://127.0.0.1:${server.address().port}`})
after(async()=>{dirs.forEach(cleanup);await new Promise(resolve=>server.close(resolve))})

describe('团队通知',()=>{
  test('三种 Provider 使用兼容载荷，事件幂等',(t)=>{const{root}=newHub();dirs.push(root);const event={event:'baseline.created',project:'orders',version:'v1'};const first=enqueueNotification(root,event),second=enqueueNotification(root,event);t.assert.strictEqual(first.id,second.id);t.assert.strictEqual(listNotifications(root).length,1);t.assert.match(renderNotification('{{event}} {{project}}/{{version}}',event),/orders\/v1/)})
  test('队列发送成功并记录状态',async(t)=>{const{root}=newHub();dirs.push(root);enqueueNotification(root,{event:'snapshot.created',snapshot:'S1'});const result=await flushNotifications(root,{provider:'slack',webhookUrl:base,template:'{{event}} {{snapshot}}'});t.assert.strictEqual(result[0].ok,true);t.assert.strictEqual(listNotifications(root)[0].status,'sent');t.assert.match(received.at(-1).text,/S1/)})
  test('通知配置不会让基线事务失败',(t)=>{const{root,hub}=newHub();dirs.push(root);hub.createProject({name:'订单',code:'orders'});hub.addVersion('orders',{versionNo:'v1',title:'一版',html:html()});hub.setConfig('integrations.notificationProvider','slack');const version=hub.setBaseline('orders','v1');t.assert.strictEqual(version.isBaseline,true);t.assert.strictEqual(hub.listNotifications().length,1)})
})
