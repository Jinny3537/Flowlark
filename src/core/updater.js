import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { err } from './errors.js'

function parts(value){const match=/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(value||''));if(!match)throw err.bad('UPDATE_VERSION_INVALID',`版本号不合法：${value}`);return match.slice(1).map(Number)}
export function compareVersions(a,b){const aa=parts(a),bb=parts(b);for(let i=0;i<3;i++)if(aa[i]!==bb[i])return aa[i]>bb[i]?1:-1;return 0}
export function parseManifest(value,{allowHttp=false}={}){const item=typeof value==='string'?JSON.parse(value):value||{};parts(item.version);let url;try{url=new URL(item.url)}catch{throw err.bad('UPDATE_URL_INVALID','更新下载地址不合法')}const local=['127.0.0.1','localhost','::1'].includes(url.hostname);if(url.protocol!=='https:'&&!(allowHttp||local))throw err.bad('UPDATE_URL_INVALID','更新下载地址必须使用 HTTPS');if(!/^[a-f0-9]{64}$/.test(String(item.sha256||'')))throw err.bad('UPDATE_CHECKSUM_INVALID','更新清单缺少有效 SHA-256');return{version:item.version,publishedAt:item.publishedAt||null,url:url.toString(),sha256:item.sha256,minSchemaVersion:Number(item.minSchemaVersion||1),notesUrl:item.notesUrl||null}}
export async function checkForUpdate(manifestUrl,currentVersion,{schemaVersion=2,fetcher=fetch}={}){let response;try{response=await fetcher(manifestUrl,{signal:AbortSignal.timeout(8000)})}catch{return{available:false,error:'无法连接更新源'}}if(!response.ok)return{available:false,error:`更新源返回 HTTP ${response.status}`};let manifest;try{manifest=parseManifest(await response.json())}catch(e){return{available:false,error:e.message}}if(manifest.minSchemaVersion>schemaVersion)return{available:false,incompatible:true,manifest,error:'当前仓库 Schema 不兼容'};return{available:compareVersions(manifest.version,currentVersion)>0,manifest}}
export async function downloadUpdate(manifest,targetDir,{fetcher=fetch}={}){const item=parseManifest(manifest,{allowHttp:true});fs.mkdirSync(targetDir,{recursive:true});const tmp=path.join(targetDir,`.flowlark-update-${process.pid}.tmp`),finalPath=path.join(targetDir,path.basename(new URL(item.url).pathname)||`Flowlark-${item.version}.zip`);let response;try{response=await fetcher(item.url,{signal:AbortSignal.timeout(60000)})}catch{throw err.bad('UPDATE_DOWNLOAD_FAILED','更新下载失败')}if(!response.ok)throw err.bad('UPDATE_DOWNLOAD_FAILED',`更新下载返回 HTTP ${response.status}`);const buffer=Buffer.from(await response.arrayBuffer()),hash=crypto.createHash('sha256').update(buffer).digest('hex');fs.writeFileSync(tmp,buffer);if(hash!==item.sha256){fs.rmSync(tmp,{force:true});return{installable:false,error:'SHA-256 校验失败'}}fs.renameSync(tmp,finalPath);return{installable:true,file:finalPath,version:item.version,bytes:buffer.length}}

const DEFAULT_SOFTWARE_ROOT = fileURLToPath(new URL('../../', import.meta.url))

function runGit(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
  return { ok: r.status === 0, code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() }
}

function readPackage(root) {
  const file = path.join(root, 'package.json')
  try {
    const pkg = JSON.parse(fs.readFileSync(file, 'utf8'))
    return { name: pkg.name || 'flowlark', version: pkg.version || '0.0.0' }
  } catch {
    return { name: 'flowlark', version: '0.0.0' }
  }
}

function isGitRepo(root) {
  return runGit(root, ['rev-parse', '--is-inside-work-tree']).out === 'true'
}

function currentCommit(root) {
  const r = runGit(root, ['rev-parse', '--short', 'HEAD'])
  return r.ok ? r.out : null
}

function upstreamRef(root) {
  const r = runGit(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  return r.ok && r.out ? r.out : null
}

function remoteName(upstream) {
  return upstream ? upstream.split('/')[0] : 'origin'
}

function remoteUrl(root, remote) {
  const r = runGit(root, ['remote', 'get-url', remote])
  return r.ok ? r.out : ''
}

function parseAheadBehind(text) {
  const [ahead, behind] = String(text || '').split(/\s+/).map((n) => Number(n) || 0)
  return { ahead, behind }
}

function remotePackage(root, upstream) {
  if (!upstream) return null
  const r = runGit(root, ['show', `${upstream}:package.json`])
  if (!r.ok || !r.out) return null
  try {
    const pkg = JSON.parse(r.out)
    return { name: pkg.name || 'flowlark', version: pkg.version || null }
  } catch {
    return null
  }
}

function remoteNotes(root, upstream) {
  if (!upstream) return ''
  const r = runGit(root, ['log', '--pretty=format:%s', '--max-count=12', `HEAD..${upstream}`])
  return r.ok ? r.out : ''
}

export function softwareRoot() {
  return DEFAULT_SOFTWARE_ROOT
}

export function softwareStatus({ root = softwareRoot(), fetchRemote = false } = {}) {
  const pkg = readPackage(root)
  if (!isGitRepo(root)) {
    return {
      tracked: false,
      path: root,
      currentVersion: pkg.version,
      latestVersion: null,
      available: false,
      error: '当前软件目录不是 Git 仓库，无法从远端拉取更新'
    }
  }

  const upstream = upstreamRef(root)
  const remote = remoteName(upstream)
  if (fetchRemote && upstream) {
    const fetched = runGit(root, ['fetch', '--prune', remote])
    if (!fetched.ok) {
      return {
        tracked: true,
        path: root,
        currentVersion: pkg.version,
        latestVersion: null,
        available: false,
        error: fetched.err || '无法拉取远端更新信息'
      }
    }
  }

  const dirty = !!runGit(root, ['status', '--porcelain']).out
  const branch = runGit(root, ['branch', '--show-current']).out || null
  const counts = upstream ? parseAheadBehind(runGit(root, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`]).out) : { ahead: 0, behind: 0 }
  const remotePkg = remotePackage(root, upstream)
  const latestVersion = remotePkg && remotePkg.version ? remotePkg.version : null
  const versionAvailable = latestVersion ? compareVersions(latestVersion, pkg.version) > 0 : false

  return {
    tracked: true,
    path: root,
    currentVersion: pkg.version,
    latestVersion,
    available: counts.behind > 0 || versionAvailable,
    branch,
    upstream,
    remote,
    remoteUrl: remoteUrl(root, remote),
    commit: currentCommit(root),
    ahead: counts.ahead,
    behind: counts.behind,
    dirty,
    checkedAt: new Date().toISOString(),
    notes: remoteNotes(root, upstream)
  }
}

export function pullSoftwareUpdate({ root = softwareRoot() } = {}) {
  const before = softwareStatus({ root, fetchRemote: true })
  if (!before.tracked) throw err.bad('SOFTWARE_NOT_GIT_REPO', before.error)
  if (!before.upstream) {
    throw err.bad('SOFTWARE_UPSTREAM_MISSING', '当前软件分支没有配置上游远端', '设置 upstream 后再更新，例如 git branch --set-upstream-to=origin/main')
  }
  if (before.dirty) {
    throw err.conflict('SOFTWARE_DIRTY', '软件目录存在本地改动，无法自动更新', '先提交、暂存或清理本地改动后再更新')
  }
  if (!before.behind) {
    return { updated: false, before, after: before, message: '当前已是最新版本' }
  }

  const pulled = runGit(root, ['pull', '--ff-only'])
  if (!pulled.ok) {
    throw err.conflict('SOFTWARE_PULL_FAILED', `软件更新失败：${pulled.err || pulled.out || 'git pull --ff-only 失败'}`)
  }

  const after = softwareStatus({ root, fetchRemote: false })
  return {
    updated: true,
    before,
    after,
    output: pulled.out || pulled.err,
    restartNeeded: true,
    message: '软件已从远端仓库拉取更新，重启 Flowlark 后生效'
  }
}
