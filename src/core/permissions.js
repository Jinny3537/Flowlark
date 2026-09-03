import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import { INTERNAL_DIR } from './repo.js'
import * as gitx from './git.js'

const CACHE_FILE = 'permissions.json'

function cacheFile(root) {
  return path.join(root, INTERNAL_DIR, 'cache', CACHE_FILE)
}

function readCache(root) {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(root), 'utf8'))
  } catch {
    return null
  }
}

function writeCache(root, data) {
  const file = cacheFile(root)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8')
  return data
}

function writable(reason, source = 'computed') {
  return { canWrite: true, mode: 'writable', reason, source, checkedAt: null }
}

function unknown(reason, source = 'computed') {
  return { canWrite: true, mode: 'unknown', reason, source, checkedAt: null }
}

function readonly(reason, source = 'cache', checkedAt = null) {
  return { canWrite: false, mode: 'readonly', reason, source, checkedAt }
}

function looksReadonly(text) {
  return /write access .*not granted|not allowed to push|you are not allowed|read[- ]only|403|permission .*denied.*push|denied to .*write/i
    .test(text || '')
}

export function status(root) {
  if (!gitx.available()) return writable('git 不可用，按本地单机可写处理')
  if (!gitx.isRepo(root)) return writable('尚未纳入 Git，按本地仓库可写处理')
  const remote = gitx.getRemote(root)
  if (!remote) return writable('未配置远端，按本地仓库可写处理')

  const cached = readCache(root)
  if (cached && cached.remoteUrl === remote.url) {
    if (cached.mode === 'readonly') return readonly(cached.reason, 'cache', cached.checkedAt)
    if (cached.mode === 'writable') return { canWrite: true, mode: 'writable', reason: cached.reason, source: 'cache', checkedAt: cached.checkedAt }
    return { canWrite: true, mode: 'unknown', reason: cached.reason, source: 'cache', checkedAt: cached.checkedAt }
  }

  return unknown('尚未探测远端写权限；离线或未探测时默认允许本地写入')
}

export function refresh(root) {
  const checkedAt = new Date().toISOString()
  if (!gitx.available()) return writeCache(root, { ...writable('git 不可用，按本地单机可写处理'), checkedAt })
  if (!gitx.isRepo(root)) return writeCache(root, { ...writable('尚未纳入 Git，按本地仓库可写处理'), checkedAt })

  const remote = gitx.getRemote(root)
  if (!remote) return writeCache(root, { ...writable('未配置远端，按本地仓库可写处理'), checkedAt })

  const branch = gitx.status(root).branch || 'HEAD'
  const r = gitx.git(root, ['push', '--dry-run', remote.name, `${branch}:${branch}`])
  const output = [r.out, r.err].filter(Boolean).join('\n')
  let result
  if (r.ok) {
    result = { canWrite: true, mode: 'writable', reason: '远端 dry-run push 成功，当前身份可写' }
  } else if (looksReadonly(output)) {
    result = { canWrite: false, mode: 'readonly', reason: '远端拒绝写入，当前身份按只读处理' }
  } else {
    result = { canWrite: true, mode: 'unknown', reason: '远端写权限探测失败；为支持离线办公，暂按可写处理' }
  }

  return writeCache(root, {
    ...result,
    source: 'probe',
    checkedAt,
    remoteName: remote.name,
    remoteUrl: remote.url,
    branch,
    detail: output.slice(0, 2000)
  })
}

export function assertWritable(root, action = '修改数据') {
  const s = status(root)
  if (s.canWrite) return s
  throw err.forbidden('GIT_READONLY', `当前仓库是 Git 只读模式，不能${action}`,
    '请让有写权限的产品经理操作；或确认远端权限后运行 flowlark git permission --refresh')
}
