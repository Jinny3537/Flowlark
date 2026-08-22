/**
 * 全局搜索。
 *
 * 项目攒到二十几个之后，「那条关于批量导出的规则写在哪一版来着」就变成日常问题。
 * 数据全在本地文件里，暴力扫一遍完全够快（几百个版本也是毫秒级），
 * 所以不引索引、不引依赖 —— 索引会带来「什么时候重建」这个新问题，不值得。
 */

/** 命中类型的权重。版本号精确命中最有用，规格书正文最泛。 */
const WEIGHT = {
  versionNo: 100,
  projectName: 60,
  title: 50,
  tag: 45,
  requirement: 40,
  change: 30,
  spec: 15,
  note: 12,
  description: 10
}

const FIELD_LABEL = {
  versionNo: '版本号',
  projectName: '项目名',
  title: '版本标题',
  tag: '标签',
  requirement: '关联需求',
  change: '变更日志',
  spec: '规格书',
  note: '版本说明',
  description: '项目描述'
}

function norm(s) {
  return String(s == null ? '' : s).toLowerCase()
}

/**
 * 取命中位置前后各 N 个字符作为片段，并标出命中区间供上层高亮。
 *
 * 换行必须按 1:1 替换成空格。用 /\n+/ 折叠会改变字符串长度，
 * matchStart 随即失准 —— 高亮就会框到旁边的字上去。
 */
function snippet(text, query, radius = 40) {
  const t = String(text || '')
  const i = norm(t).indexOf(norm(query))
  if (i < 0) return null
  const start = Math.max(0, i - radius)
  const end = Math.min(t.length, i + query.length + radius)
  const prefix = start > 0 ? '…' : ''
  return {
    text: prefix + t.slice(start, end).replace(/[\r\n]/g, ' ') + (end < t.length ? '…' : ''),
    matchStart: i - start + prefix.length,
    matchLength: query.length
  }
}

function hit(results, { field, score, text, query, project, version, extra }) {
  const s = snippet(text, query)
  if (!s) return
  results.push({
    field,
    fieldLabel: FIELD_LABEL[field] || field,
    score,
    snippet: s,
    project: project.slug,
    projectName: project.name,
    versionNo: version ? version.versionNo : null,
    versionTitle: version ? version.title : null,
    versionStatus: version ? version.display.key : null,
    objectType: 'version',
    ...extra
  })
}

/**
 * @param {import('./service.js').Hub} hub
 * @param {string} query
 * @param {{project?: string, limit?: number, fields?: string[]}} options
 */
export function search(hub, query, { project = null, limit = 50, fields = null, filters = {} } = {}) {
  const q = String(query || '').trim()
  const hasFilters = Object.values(filters || {}).some((value) => Array.isArray(value) ? value.length : value !== null && value !== undefined && value !== '')
  if (q.length === 0 && !hasFilters) return { query: q, total: 0, results: [] }

  const want = (f) => !fields || fields.includes(f)
  const results = []
  const projects = project ? [hub.getProject(project)] : hub.listProjects()
  let milestoneVersions = null
  if (filters.milestone) {
    milestoneVersions = new Set(hub.getMilestone(filters.milestone).items.map((item) => `${item.project}:${item.version}`))
  }

  for (const p of projects) {
    if (q && want('projectName')) {
      hit(results, { field: 'projectName', score: WEIGHT.projectName, text: `${p.name} ${p.code}`, query: q, project: p })
    }
    if (q && want('description') && p.description) {
      hit(results, { field: 'description', score: WEIGHT.description, text: p.description, query: q, project: p })
    }

    const versions = hub.listVersions(p.slug, { includeDraft: true, includeVoid: true })
    for (const vLite of versions) {
      // listVersions 不带规格书正文，逐个取全量
      const v = hub.getVersion(p.slug, vLite.versionNo)
      const requirementCodes = v.requirements.map((item) => item.code)
      if (filters.tags && filters.tags.length && !filters.tags.every((tag) => v.tags.includes(tag))) continue
      if (filters.reviewStatus && filters.reviewStatus.length && !filters.reviewStatus.includes(v.reviewStatus)) continue
      if (filters.status && filters.status.length && !filters.status.includes(v.display.key)) continue
      if (filters.requirement && !requirementCodes.includes(filters.requirement)) continue
      if (milestoneVersions && !milestoneVersions.has(`${p.slug}:${v.versionNo}`)) continue
      if (filters.dateFrom && String(v.updatedAt || v.createdAt) < filters.dateFrom) continue
      if (filters.dateTo && String(v.updatedAt || v.createdAt) > filters.dateTo) continue
      if (filters.attachment && !(v.attachments || []).some((item) => item.name.toLowerCase().endsWith(String(filters.attachment).toLowerCase()))) continue

      if (!q) {
        results.push({
          objectType: 'version', field: 'filter', fieldLabel: '筛选结果', score: 1,
          snippet: { text: v.title, matchStart: 0, matchLength: 0 },
          project: p.slug, projectName: p.name, versionNo: v.versionNo,
          versionTitle: v.title, versionStatus: v.display.key, reviewStatus: v.reviewStatus
        })
        continue
      }

      if (want('versionNo')) {
        hit(results, { field: 'versionNo', score: WEIGHT.versionNo, text: v.versionNo, query: q, project: p, version: v })
      }
      if (want('title')) {
        hit(results, { field: 'title', score: WEIGHT.title, text: v.title, query: q, project: p, version: v })
      }
      if (want('note') && v.note) {
        hit(results, { field: 'note', score: WEIGHT.note, text: v.note, query: q, project: p, version: v })
      }
      if (want('tag')) {
        for (const tag of v.tags || []) {
          hit(results, { field: 'tag', score: WEIGHT.tag, text: tag, query: q, project: p, version: v })
        }
      }
      if (want('change')) {
        for (const ch of v.changes) {
          // 需求号要拼进来一起搜：用户用 -m "…:REQ-0275" 写进变更日志后，
          // 自然会期待 search REQ-0275 能找到它，哪怕它没被登记进关联需求列表
          const text =
            `${ch.location ? `[${ch.location}] ` : ''}${ch.content}` +
            (ch.requirement ? ` ${ch.requirement}` : '')
          hit(results, {
            field: 'change',
            score: WEIGHT.change,
            text,
            query: q, project: p, version: v,
            extra: { changeType: ch.type, location: ch.location, requirement: ch.requirement }
          })
        }
      }
      if (want('requirement')) {
        for (const r of v.requirements) {
          hit(results, {
            field: 'requirement',
            score: WEIGHT.requirement,
            text: `${r.code} ${r.title || ''}`,
            query: q, project: p, version: v,
            extra: { requirementUrl: r.url }
          })
        }
      }
      if (want('spec') && v.spec) {
        // 规格书可能很长，只取第一处命中，避免一份文档刷屏
        hit(results, { field: 'spec', score: WEIGHT.spec, text: v.spec, query: q, project: p, version: v })
      }
    }
  }

  if (q && (!filters.scope || filters.scope === 'all' || filters.scope === 'requirements')) {
    for (const requirement of hub.listRequirements()) {
      const text = `${requirement.code} ${requirement.title} ${requirement.description || ''}`
      const match = snippet(text, q)
      if (match) results.push({ objectType: 'requirement', field: 'requirementEntity', fieldLabel: '需求', score: 70, snippet: match, requirementCode: requirement.code, requirementTitle: requirement.title, requirementStatus: requirement.derivedStatus })
    }
  }
  if (q && (!filters.scope || filters.scope === 'all' || filters.scope === 'milestones')) {
    for (const milestone of hub.listMilestones()) {
      const text = `${milestone.name} ${milestone.title}`
      const match = snippet(text, q)
      if (match) results.push({ objectType: 'milestone', field: 'milestone', fieldLabel: '迭代', score: 65, snippet: match, milestoneName: milestone.name, milestoneTitle: milestone.title, milestoneReady: milestone.ready })
    }
  }

  // 同分时基线优先 —— 用户十有八九想找的是当前生效的那一版
  results.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score
    const ab = a.versionStatus === 'BASELINE' ? 1 : 0
    const bb = b.versionStatus === 'BASELINE' ? 1 : 0
    return bb - ab
  })

  return { query: q, total: results.length, results: results.slice(0, limit) }
}
