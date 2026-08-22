import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { err } from './errors.js'
import { parse, stringify } from './json.js'
import { REPO_FILE } from './repo.js'

export function workspaceHome(){return path.resolve(process.env.FLOWLARK_HOME||path.join(os.homedir(),'.flowlark'))}
function registryFile(){return path.join(workspaceHome(),'workspaces.json')}
function readRegistry(){const file=registryFile();if(!fs.existsSync(file))return{lastWorkspace:null,items:[]};const value=parse(fs.readFileSync(file,'utf8'),'工作区注册表');return{lastWorkspace:value.lastWorkspace||null,items:Array.isArray(value.items)?value.items:[]}}
function writeRegistry(value){fs.mkdirSync(workspaceHome(),{recursive:true});fs.writeFileSync(registryFile(),stringify(value))}
function canonical(value){const absolute=path.resolve(value);return fs.existsSync(absolute)?fs.realpathSync(absolute):absolute}
export function listWorkspaces(){const data=readRegistry();return{lastWorkspace:data.lastWorkspace,items:data.items.map(item=>({...item,missing:!fs.existsSync(path.join(item.path,REPO_FILE))}))}}
export function addWorkspace(input){const root=canonical(input.path);if(!fs.existsSync(path.join(root,REPO_FILE)))throw err.bad('WORKSPACE_NOT_REPO',`${root} 不是 Flowlark 仓库`);const data=readRegistry(),existing=data.items.find(item=>item.path===root),item={path:root,name:String(input.name||path.basename(root)),mode:input.mode==='mirror'?'mirror':'normal',addedAt:existing?.addedAt||new Date().toISOString()};if(existing)Object.assign(existing,item);else data.items.push(item);data.lastWorkspace=root;writeRegistry(data);return item}
export function removeWorkspace(value){const root=canonical(value),data=readRegistry(),before=data.items.length;data.items=data.items.filter(item=>item.path!==root);if(before===data.items.length)throw err.notFound(`工作区「${root}」`);if(data.lastWorkspace===root)data.lastWorkspace=data.items[0]?.path||null;writeRegistry(data);return{path:root}}
export function setLastWorkspace(value){const root=canonical(value),data=readRegistry();if(!data.items.some(item=>item.path===root))throw err.notFound(`工作区「${root}」`);data.lastWorkspace=root;writeRegistry(data);return{path:root}}
export function resolveWorkspace(value){const data=listWorkspaces(),root=value?canonical(value):data.lastWorkspace;if(!root)throw err.bad('WORKSPACE_REQUIRED','尚未选择 Flowlark 工作区');const item=data.items.find(entry=>entry.path===root);if(!item||item.missing)throw err.bad('WORKSPACE_MISSING',`工作区不可用：${root}`);return item}
