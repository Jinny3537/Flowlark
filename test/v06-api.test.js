import { after, describe, test } from 'node:test'
import { cleanup, newHub } from './helpers.js'
import { startServer } from '../src/server/index.js'

const dirs=[]
after(()=>dirs.forEach(cleanup))

describe('v0.6 镜像 API',()=>{
  test('health 明确只读，业务写请求被中央闸门拒绝',async(t)=>{
    const{root}=newHub();dirs.push(root)
    const server=await startServer(root,{port:0,previewPort:0,mirror:true})
    const base=`http://127.0.0.1:${server.port}`
    try{
      let response=await fetch(`${base}/api/health`),body=await response.json()
      t.assert.strictEqual(body.canWrite,false)
      t.assert.strictEqual(body.readonlyReason,'mirror')
      response=await fetch(`${base}/api/projects`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'禁止写入',code:'blocked'})})
      body=await response.json()
      t.assert.strictEqual(response.status,403)
      t.assert.strictEqual(body.code,'MIRROR_READONLY')
    }finally{await server.close()}
  })
})
