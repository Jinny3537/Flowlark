import fs from 'node:fs'
import path from 'node:path'
import { err } from './errors.js'
import * as offline from './offline.js'
import * as store from './store.js'
import { requirementDetail } from './requirements.js'
import { inspectMilestone } from './milestones.js'

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char])
}

function safeSegment(value) {
  const item = String(value || '').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  if (!item) throw err.bad('EXPORT_NAME_INVALID', '导出名称不合法')
  return item
}

async function exportItems(root, title, items, outputDir, manifest) {
  const target = path.resolve(outputDir)
  fs.mkdirSync(target, { recursive: true })
  const rows = []
  for (const item of items) {
    const version = store.readVersion(root, item.project, item.versionNo)
    await offline.buildOffline(root, item.project, item.versionNo, store.readHtml(root, item.project, item.versionNo))
    const folder = `${safeSegment(item.project)}-${safeSegment(item.versionNo)}`
    const dir = path.join(target, folder)
    fs.mkdirSync(dir, { recursive: true })
    fs.copyFileSync(offline.offlinePath(root, item.project, item.versionNo), path.join(dir, 'prototype.html'))
    const spec = store.readSpec(root, item.project, item.versionNo)
    if (spec) fs.writeFileSync(path.join(dir, 'spec.md'), spec)
    const attachments = store.paths.attachments(root, item.project, item.versionNo)
    if (fs.existsSync(attachments)) fs.cpSync(attachments, path.join(dir, 'files'), { recursive: true })
    rows.push(`<tr><td>${escapeHtml(item.requirement || '—')}</td><td>${escapeHtml(item.project)}</td><td>${escapeHtml(item.versionNo)}</td><td>${escapeHtml(version.title)}</td><td><a href="${folder}/prototype.html">打开原型</a></td></tr>`)
  }
  const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{font:14px/1.6 -apple-system,BlinkMacSystemFont,sans-serif;margin:32px;color:#101828}table{border-collapse:collapse;width:100%}th,td{border:1px solid #d0d5dd;padding:10px;text-align:left}th{background:#f2f4f7}a{color:#0b7a6e}</style></head><body><h1>${escapeHtml(title)}</h1><table><thead><tr><th>需求</th><th>项目</th><th>版本</th><th>标题</th><th>原型</th></tr></thead><tbody>${rows.join('')}</tbody></table></body></html>`
  fs.writeFileSync(path.join(target, 'index.html'), html)
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  return { outputDir: target, itemCount: items.length, index: path.join(target, 'index.html') }
}

export function exportRequirementPackage(root, code, outputDir) {
  const requirement = requirementDetail(root, code)
  const items = requirement.versions.map((item) => ({ requirement: code, project: item.project, versionNo: item.versionNo }))
  return exportItems(root, `需求 ${code} · ${requirement.title}`, items, outputDir, { type: 'requirement', code, items })
}

export function exportMilestonePackage(root, name, outputDir) {
  const milestone = inspectMilestone(root, name)
  const items = milestone.items.map((item) => ({ requirement: item.requirement, project: item.project, versionNo: item.version }))
  return exportItems(root, `迭代 ${name} · ${milestone.title}`, items, outputDir, { type: 'milestone', name, items })
}
