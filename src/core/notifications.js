import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import { INTERNAL_DIR } from './repo.js'

const PROVIDERS=['wecom','dingtalk','slack']
const VARIABLES=new Set(['event','project','version','requirement','milestone','snapshot','reviewStatus','url','changeCount'])
const execFileAsync=promisify(execFile)
let commandRunner=(cmd,args,options)=>execFileAsync(cmd,args,options)
function queueFile(root){return path.join(root,INTERNAL_DIR,'cache','notifications.json')}
function readQueue(root){const file=queueFile(root);if(!fs.existsSync(file))return{items:[]};const value=parse(fs.readFileSync(file,'utf8'),'通知队列');return{items:Array.isArray(value.items)?value.items:[]}}
function writeQueue(root,data){const file=queueFile(root);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,stringify(data))}
export function setNotificationCommandRunner(runner){const prev=commandRunner;commandRunner=runner||((cmd,args,options)=>execFileAsync(cmd,args,options));return()=>{commandRunner=prev}}
export function renderNotification(template,event){return String(template||'{{event}} {{project}} {{version}}').replace(/\{\{([A-Za-z]+)\}\}/g,(raw,key)=>{if(!VARIABLES.has(key))throw err.bad('NOTIFICATION_VARIABLE_INVALID',`通知模板包含未知变量：${key}`);return String(event[key]??'')})}
export function enqueueNotification(root,event){const id=crypto.createHash('sha256').update(JSON.stringify({type:event.event,payload:event})).digest('hex').slice(0,24),data=readQueue(root),existing=data.items.find(item=>item.id===id);if(existing)return existing;const item={id,event,status:'pending',attempts:0,lastError:null,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};data.items.push(item);writeQueue(root,data);return item}
export function listNotifications(root){return readQueue(root).items.sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
function payload(provider,text){if(provider==='dingtalk'||provider==='wecom')return{msgtype:'text',text:{content:text}};return{text}}
function parseCliError(e){try{return JSON.parse(e.stdout||'').error?.message}catch{return String(e.stderr||e.message||'').trim()}}
async function sendWecomCli(config,text){const chatId=config.chatId||config.wecomChatId;if(!chatId)throw err.bad('WECOM_CHAT_ID_MISSING','尚未配置企业微信 CLI 会话 ID','先用 wecom-cli 授权并确认可发送会话，再设置 integrations.wecomChatId');const body={chat_id:chatId,msg_type:'markdown',markdown:{content:text}};try{await commandRunner(config.wecomCliCommand||'wecom-cli',['message','aibot','send','--json',JSON.stringify(body)],{encoding:'utf8',timeout:15000,maxBuffer:1024*1024})}catch(e){if(e.code==='ENOENT')throw err.bad('WECOM_CLI_MISSING','未找到 wecom-cli','请先安装 @wecom/cli，并执行 wecom-cli auth init');throw err.bad('WECOM_CLI_REJECTED',parseCliError(e)||'企业微信 CLI 发送失败')}return{provider:'wecom',ok:true,text,transport:'wecom-cli'}}
export async function sendNotification(provider,{webhookUrl,template,...config},event){if(!PROVIDERS.includes(provider))throw err.bad('NOTIFICATION_PROVIDER_INVALID',`不支持的通知平台：${provider}`);const text=renderNotification(template,event);if(provider==='wecom'&&(config.wecomTransport==='cli'||config.chatId||config.wecomChatId))return sendWecomCli(config,text);if(!webhookUrl)throw err.bad('NOTIFICATION_WEBHOOK_MISSING','尚未配置 Webhook 地址');let response;try{response=await fetch(webhookUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload(provider,text)),signal:AbortSignal.timeout(10000)})}catch{throw err.bad('NOTIFICATION_UNAVAILABLE','无法连接通知平台')}if(!response.ok)throw err.bad('NOTIFICATION_REJECTED',`通知平台返回 HTTP ${response.status}`);return{provider,ok:true,text,transport:'webhook'}}
export async function flushNotifications(root,config){const data=readQueue(root),results=[];for(const item of data.items.filter(row=>row.status==='pending')){item.attempts++;item.updatedAt=new Date().toISOString();try{const result=await sendNotification(config.provider,config,item.event);item.status='sent';item.lastError=null;results.push({id:item.id,...result})}catch(e){item.lastError=e.message;results.push({id:item.id,ok:false,error:e.message})}}writeQueue(root,data);return results}
