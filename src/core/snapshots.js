import crypto from 'node:crypto'
import fs from 'node:fs'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import * as store from './store.js'
import { currentUser } from './repo.js'
import { inspectMilestone } from './milestones.js'

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
function safeName(name) { const value=String(name||'').trim(); if(!NAME_RE.test(value)) throw err.bad('SNAPSHOT_NAME_INVALID',`快照标识「${value}」不合法`); return value }
export function snapshotExists(root,name){return fs.existsSync(store.paths.snapshotFile(root,safeName(name)))}
export function readSnapshot(root,name){const safe=safeName(name),file=store.paths.snapshotFile(root,safe);if(!fs.existsSync(file))throw err.notFound(`交付快照「${safe}」`);return parse(fs.readFileSync(file,'utf8'),`${safe}.json`)}
export function listSnapshots(root){const dir=store.paths.snapshots(root);if(!fs.existsSync(dir))return[];return fs.readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>readSnapshot(root,f.slice(0,-5))).sort((a,b)=>b.createdAt.localeCompare(a.createdAt))}
export function inspectSnapshotInput(root,input){const source=input.milestone?inspectMilestone(root,input.milestone).items:(input.items||[]),blockers=[];const items=source.map(raw=>{const item={requirement:String(raw.requirement||''),project:String(raw.project||''),version:String(raw.version||raw.versionNo||'')};let version;try{version=store.readVersion(root,item.project,item.version)}catch{blockers.push({...item,code:'VERSION_MISSING',message:`${item.project}/${item.version} 不存在`});return item}if(version.status==='VOID')blockers.push({...item,code:'VERSION_VOID',message:`${item.project}/${item.version} 已废弃`});if(version.reviewStatus!=='confirmed')blockers.push({...item,code:'REVIEW_NOT_CONFIRMED',message:`${item.project}/${item.version} 尚未确认`});return item});return{items,blockers,ready:blockers.length===0}}
export function createSnapshot(root,input){const name=safeName(input.name);if(snapshotExists(root,name))throw err.conflict('SNAPSHOT_EXISTS',`交付快照「${name}」已存在`);const check=inspectSnapshotInput(root,input);if(!check.ready)throw err.conflict('SNAPSHOT_BLOCKED',`快照存在 ${check.blockers.length} 个阻塞项`,check.blockers.map(x=>x.message).join('；'));const digestInput=check.items.map(item=>({item,changes:store.readVersion(root,item.project,item.version).changes}));const snapshot={name,title:String(input.title||name),milestone:input.milestone||null,items:check.items,changesDigest:`sha256:${crypto.createHash('sha256').update(JSON.stringify(digestInput)).digest('hex')}`,createdAt:new Date().toISOString(),createdBy:currentUser()};fs.mkdirSync(store.paths.snapshots(root),{recursive:true});fs.writeFileSync(store.paths.snapshotFile(root,name),stringify(snapshot,'snapshot'));return snapshot}
