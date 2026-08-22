import { err } from './errors.js'
import * as gitx from './git.js'

export function inspectMirror(root){if(!gitx.isRepo(root))return{ok:false,reason:'not_git'};const status=gitx.status(root,{includeForeign:true});const remote=gitx.getRemote(root);return{ok:!!remote&&!status.files.length,dirty:status.files||[],remote,branch:status.branch||null}}
export function refreshMirror(root){const state=inspectMirror(root);if(!state.remote)throw err.bad('MIRROR_REMOTE_MISSING','镜像仓库没有远端');if(state.dirty.length)throw err.conflict('MIRROR_DIRTY','镜像工作区存在本地改动','清理本地改动后再刷新；镜像不会自动覆盖');try{gitx.git(root,['fetch','--prune','origin']);gitx.git(root,['pull','--ff-only'])}catch(e){throw err.conflict('MIRROR_NOT_FAST_FORWARD',`镜像无法快进更新：${e.message}`)}return inspectMirror(root)}
export function startMirrorScheduler(root,{intervalMs=60000,onResult=()=>{}}={}){const timer=setInterval(()=>{try{onResult(null,refreshMirror(root))}catch(e){onResult(e,null)}},Math.max(5000,intervalMs));timer.unref?.();return()=>clearInterval(timer)}
