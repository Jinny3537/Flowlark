import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import { stringify, parse } from './json.js'
import { INTERNAL_DIR } from './repo.js'

const DRAFT_ID_RE = /^[a-f0-9-]{36}$/i
const MAX_SCREENSHOT_BYTES = 8 * 1024 * 1024

function required(value, label, max = 500) {
  const text = String(value || '').trim()
  if (!text) throw err.bad('FEEDBACK_INVALID', `反馈缺少${label}`)
  if (text.length > max) throw err.bad('FEEDBACK_INVALID', `${label}不能超过 ${max} 个字符`)
  return text
}

function optional(value, max = 2000) {
  const text = String(value || '').trim()
  if (text.length > max) throw err.bad('FEEDBACK_INVALID', `反馈内容不能超过 ${max} 个字符`)
  return text
}

function normalizeAnchor(anchor) {
  const keys = ['x', 'y', 'width', 'height']
  const out = Object.fromEntries(keys.map((key) => [key, Number(anchor && anchor[key])]))
  if (keys.some((key) => !Number.isFinite(out[key]) || out[key] < 0 || out[key] > 1)) {
    throw err.bad('FEEDBACK_ANCHOR_INVALID', '标注区域必须使用 0 到 1 的相对坐标')
  }
  if (out.width === 0 || out.height === 0 || out.x + out.width > 1 || out.y + out.height > 1) {
    throw err.bad('FEEDBACK_ANCHOR_INVALID', '标注区域超出原型范围')
  }
  return out
}

function draftDir(root) {
  return path.join(root, INTERNAL_DIR, 'cache', 'feedback')
}

function assertDraftId(id) {
  if (!DRAFT_ID_RE.test(String(id || ''))) throw err.bad('FEEDBACK_ID_INVALID', '反馈草稿编号不合法')
  return String(id)
}

function draftPaths(root, id) {
  const safeId = assertDraftId(id)
  const dir = draftDir(root)
  return {
    dir,
    json: path.join(dir, `${safeId}.json`),
    screenshot: path.join(dir, `${safeId}.png`)
  }
}

export function normalizeFeedback(input = {}) {
  const id = input.id ? assertDraftId(input.id) : crypto.randomUUID()
  const requirements = [...new Set((input.requirements || []).map((item) => String(item).trim()).filter(Boolean))]
  const changes = (Array.isArray(input.changes) ? input.changes : []).map((item) => ({
    type: optional(item && item.type, 80),
    location: optional(item && item.location, 200),
    content: optional(item && item.content, 1000)
  })).filter((item) => item.type || item.location || item.content)

  return {
    id,
    title: required(input.title, '标题', 200),
    description: required(input.description, '问题描述', 5000),
    project: required(input.project, '项目', 80),
    version: required(input.version, '版本', 80),
    baseline: input.baseline ? optional(input.baseline, 80) : null,
    requirements,
    changes,
    url: optional(input.url, 4000),
    anchor: normalizeAnchor(input.anchor),
    createdAt: input.createdAt || new Date().toISOString()
  }
}

export function encodeAnchor(anchor) {
  return Buffer.from(JSON.stringify(normalizeAnchor(anchor))).toString('base64url')
}

export function decodeAnchor(value) {
  try {
    return normalizeAnchor(JSON.parse(Buffer.from(String(value), 'base64url').toString('utf8')))
  } catch {
    throw err.bad('FEEDBACK_ANCHOR_INVALID', '标注链接无效')
  }
}

function cell(value) {
  return String(value == null ? '' : value).replaceAll('|', '\\|').replaceAll('\n', ' ')
}

export function renderFeedbackMarkdown(input) {
  const item = normalizeFeedback(input)
  const rows = [
    ['项目', item.project],
    ['版本', item.version],
    ['当前基线', item.baseline || '无'],
    ['需求', item.requirements.join(', ') || '无'],
    ['原型链接', item.url || '无'],
    ['标注区域', JSON.stringify(item.anchor)],
    ['反馈时间', item.createdAt]
  ]
  const changes = item.changes.length
    ? `\n## 相关变更\n\n${item.changes.map((change) => `- ${change.type || '变更'} · ${change.location || '未指定位置'}：${change.content || '未填写说明'}`).join('\n')}\n`
    : ''
  return `# ${item.title}\n\n${item.description}\n\n| 上下文 | 值 |\n|---|---|\n${rows.map(([key, value]) => `| ${cell(key)} | ${cell(value)} |`).join('\n')}\n${changes}`
}

export function saveFeedbackDraft(root, input, screenshot = null) {
  const item = normalizeFeedback(input)
  if (screenshot && (!Buffer.isBuffer(screenshot) || screenshot.length > MAX_SCREENSHOT_BYTES)) {
    throw err.bad('FEEDBACK_SCREENSHOT_INVALID', `截图必须是小于 ${MAX_SCREENSHOT_BYTES / 1024 / 1024} MB 的 PNG 数据`)
  }
  const files = draftPaths(root, item.id)
  fs.mkdirSync(files.dir, { recursive: true })
  fs.writeFileSync(files.json, stringify(item))
  if (screenshot) fs.writeFileSync(files.screenshot, screenshot)
  return { ...item, hasScreenshot: !!screenshot }
}

export function readFeedbackDraft(root, id) {
  const files = draftPaths(root, id)
  if (!fs.existsSync(files.json)) throw err.notFound(`反馈草稿「${id}」`)
  const item = parse(fs.readFileSync(files.json, 'utf8'), `反馈草稿 ${id}`)
  return { ...item, hasScreenshot: fs.existsSync(files.screenshot) }
}

export function readFeedbackScreenshot(root, id) {
  const files = draftPaths(root, id)
  return fs.existsSync(files.screenshot) ? fs.readFileSync(files.screenshot) : null
}

export function listFeedbackDrafts(root) {
  const dir = draftDir(root)
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith('.json') && DRAFT_ID_RE.test(name.slice(0, -5)))
    .map((name) => readFeedbackDraft(root, name.slice(0, -5)))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
}

export function removeFeedbackDraft(root, id) {
  const files = draftPaths(root, id)
  if (!fs.existsSync(files.json)) throw err.notFound(`反馈草稿「${id}」`)
  fs.rmSync(files.json, { force: true })
  fs.rmSync(files.screenshot, { force: true })
  return { id }
}
