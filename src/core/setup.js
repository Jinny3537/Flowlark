import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { err } from './errors.js'
import { REPO_FILE } from './repo.js'
import { addWorkspace } from './workspaces.js'

export function inspectSetup(target){const root=path.resolve(target);return{path:root,exists:fs.existsSync(root),isRepo:fs.existsSync(path.join(root,REPO_FILE)),empty:fs.existsSync(root)&&fs.readdirSync(root).length===0}}
export function registerExistingWorkspace(target,options={}){const check=inspectSetup(target);if(!check.isRepo)throw err.bad('SETUP_NOT_REPO',`${check.path} 不是 Flowlark 仓库`);return addWorkspace({path:check.path,name:options.name,mode:options.mode})}
export function cloneWorkspace(url,target,options={}){if(!/^(https?:\/\/|ssh:\/\/|git@)/i.test(String(url||'')))throw err.bad('SETUP_GIT_URL_INVALID','Git 地址不合法');const root=path.resolve(target);if(fs.existsSync(root)&&fs.readdirSync(root).length)throw err.conflict('SETUP_TARGET_NOT_EMPTY',`目标目录非空：${root}`);fs.mkdirSync(path.dirname(root),{recursive:true});try{execFileSync('git',['clone','--',url,root],{encoding:'utf8',stdio:['ignore','pipe','pipe']})}catch(e){throw err.bad('SETUP_CLONE_FAILED',`clone 失败：${String(e.stderr||e.message).trim()}`)}return registerExistingWorkspace(root,options)}
