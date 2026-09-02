import crypto from 'node:crypto'
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const MINIMUM_VERSION = [1, 1, 0]
const DEFAULT_TIMEOUT_MS = 30000

export class WecomToolError extends Error {
  constructor(message, instruction = null) {
    super(message)
    this.name = 'WecomToolError'
    this.instruction = instruction ? String(instruction) : null
  }
}
function parseJson(value, label) {
  const text = String(value || '').trim()
  if (!text) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new WecomToolError(`${label}返回了无法解析的数据`, '请升级 @wecom/cli 后重试')
  }
}

function cliFailure(error, fallback) {
  let body = null
  try { body = JSON.parse(String(error?.stdout || '').trim()) } catch { body = null }
  const detail = body?.error || body || {}
  const message = String(detail.message || error?.message || fallback).trim()
  const instruction = detail.instruction || detail.help_message || null
  if (error?.code === 'ENOENT') {
    return new WecomToolError('未找到 wecom-cli', '请先执行 npm install -g @wecom/cli')
  }
  return new WecomToolError(message || fallback, instruction)
}

function versionTuple(value) {
  const match = String(value || '').match(/\b(\d+)\.(\d+)\.(\d+)\b/)
  return match ? match.slice(1).map(Number) : null
}

function versionAtLeast(actual, minimum) {
  if (!actual) return false
  for (let index = 0; index < minimum.length; index++) {
    if (actual[index] > minimum[index]) return true
    if (actual[index] < minimum[index]) return false
  }
  return true
}

function textList(values, limit) {
  const out = []
  const seen = new Set()
  for (const value of Array.isArray(values) ? values : []) {
    const item = String(value || '').trim()
    if (!item || seen.has(item)) continue
    seen.add(item)
    out.push(item)
    if (out.length >= limit) break
  }
  return out
}

function candidateKey(user) {
  const identity = String(user.userid || user.email || `${user.name || ''}:${(user.departments || []).join('/')}`)
  return crypto.createHash('sha256').update(identity).digest('hex').slice(0, 20)
}

function normalizeCandidate(query, user = {}) {
  const item = {
    key: candidateKey(user),
    query,
    name: String(user.name || query),
    alias: String(user.alias || ''),
    departments: textList(user.departments, 20),
    position: String(user.position || '')
  }
  const email = String(user.email || '').trim()
  const userid = String(user.userid || '').trim()
  if (email) item.email = email
  if (userid) item.userid = userid
  return item
}

function addressBook(targets) {
  const emails = []
  const userids = []
  for (const item of Array.isArray(targets) ? targets : []) {
    const email = String(item?.email || '').trim()
    const userid = String(item?.userid || '').trim()
    if (email && !emails.includes(email)) emails.push(email)
    else if (userid && !userids.includes(userid)) userids.push(userid)
  }
  return {
    ...(emails.length ? { emails } : {}),
    ...(userids.length ? { userids } : {})
  }
}

function ensureMailInput(input = {}) {
  const to = Array.isArray(input.to) ? input.to : []
  const cc = Array.isArray(input.cc) ? input.cc : []
  const subject = String(input.subject || '').trim()
  const markdown = String(input.markdown || '').trim()
  if (!to.length) throw new WecomToolError('发版邮件缺少收件人')
  if (!subject) throw new WecomToolError('发版邮件缺少主题')
  if (!markdown) throw new WecomToolError('发版邮件缺少正文')
  if (subject.length > 500) throw new WecomToolError('发版邮件主题超过 500 个字符')
  if (Buffer.byteLength(markdown) > 1024 * 1024) throw new WecomToolError('发版邮件正文超过 1MB')
  const toBook = addressBook(to)
  if (!toBook.emails?.length && !toBook.userids?.length) {
    throw new WecomToolError('发版邮件收件人尚未解析为企业微信成员')
  }
  return { to, cc, subject, markdown, toBook, ccBook: addressBook(cc) }
}

export function createWecomTools({
  command = process.env.FLOWLARK_WECOM_CLI_COMMAND || 'wecom-cli',
  run = (file, args, options) => execFileAsync(file, args, options),
  tmpRoot = process.env.FLOWLARK_WECOM_TMP_DIR || os.tmpdir(),
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const options = { encoding: 'utf8', timeout: Number(timeoutMs) || DEFAULT_TIMEOUT_MS, maxBuffer: 2 * 1024 * 1024 }

  async function invoke(args, label) {
    try {
      return await run(command, args, options)
    } catch (error) {
      throw cliFailure(error, `${label}失败`)
    }
  }

  return {
    async authStatus() {
      let versionOutput
      try {
        versionOutput = await invoke(['--version'], '检查企业微信 CLI')
      } catch (error) {
        if (error instanceof WecomToolError && /未找到/.test(error.message)) {
          return { installed: false, version: null, versionOk: false, authorized: false, message: error.message, instruction: error.instruction }
        }
        throw error
      }
      const version = versionTuple(versionOutput.stdout)
      const versionOk = versionAtLeast(version, MINIMUM_VERSION)
      if (!versionOk) {
        return {
          installed: true,
          version: version ? version.join('.') : null,
          versionOk: false,
          authorized: false,
          message: 'wecom-cli 版本过低',
          instruction: '请执行 npm install -g @wecom/cli 升级到 1.1.0 或更高版本'
        }
      }
      const auth = await invoke(['auth', 'show', '--status'], '检查企业微信授权')
      const authorized = String(auth.stdout || '').trim() === 'authorized'
      return {
        installed: true,
        version: version.join('.'),
        versionOk: true,
        authorized,
        message: authorized ? '企业微信 CLI 已授权' : '企业微信 CLI 尚未授权',
        instruction: authorized ? null : '请执行 wecom-cli auth init 完成授权'
      }
    },

    async resolveContacts({ names } = {}) {
      const queries = textList(names, 100)
      if (!queries.length) throw new WecomToolError('请提供需要解析的企业微信成员姓名')
      const results = []
      for (const query of queries) {
        const response = await invoke([
          'contact', 'users', 'search', '--json', JSON.stringify({ keywords: [query] })
        ], `查询企业微信成员 ${query}`)
        const body = parseJson(response.stdout, '企业微信通讯录')
        const users = Array.isArray(body.users) ? body.users : []
        const candidates = users.slice(0, 5).map((user) => normalizeCandidate(query, user))
        if (!candidates.length) {
          results.push({ query, status: 'missing', candidates: [], hint: body.hint || null })
        } else if (candidates.length === 1 && !body.hint) {
          results.push({ query, status: 'unique', candidate: candidates[0], candidates })
        } else {
          results.push({
            query,
            status: body.hint && users.length >= 5 ? 'limited' : 'ambiguous',
            candidates,
            hint: body.hint || null
          })
        }
      }
      return { results }
    },

    async sendReleaseMail(input = {}) {
      const mail = ensureMailInput(input)
      const dir = path.join(tmpRoot, 'flowlark-wecom')
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
      const file = path.join(dir, `release-mail-${crypto.randomUUID()}.md`)
      fs.writeFileSync(file, mail.markdown, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      try {
        const payload = {
          to: mail.toBook,
          ...(mail.ccBook.emails?.length || mail.ccBook.userids?.length ? { cc: mail.ccBook } : {}),
          subject: mail.subject,
          file_path: file,
          content_type: 'markdown'
        }
        const response = await invoke(['mail', 'send', '--json', JSON.stringify(payload)], '发送企业微信发版邮件')
        const body = parseJson(response.stdout, '企业微信邮件')
        if (body.error) throw cliFailure({ stdout: response.stdout }, '发送企业微信发版邮件失败')
        return {
          ok: true,
          subject: mail.subject,
          recipientCount: mail.to.length,
          ccCount: mail.cc.length
        }
      } finally {
        try { fs.rmSync(file) } catch { /* 临时文件已经不存在 */ }
      }
    }
  }
}
