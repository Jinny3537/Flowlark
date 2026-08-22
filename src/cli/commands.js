import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { err } from '../core/errors.js'
import { initRepo, requireRepoRoot, findRepoRoot } from '../core/repo.js'
import { Hub } from '../core/service.js'
import * as store from '../core/store.js'
import { CHANGE_LABEL } from '../core/rules.js'
import { groupRefsByHost } from '../core/scan.js'
import { c, table, statusTag, kv, heading, fmtSize, fmtTime, ok, info, warn, next } from './ui.js'

// ==================== 公共 ====================

export function hub() {
  return new Hub(requireRepoRoot())
}

/**
 * 解析 -m "类型:位置:说明:需求号"。
 * 说明本身可能含冒号，所以按段数决定切法：≥3 段时前两段是类型和位置，
 * 最后一段若形如需求号（含字母和数字且无空格）则单独取出。
 */
function parseChange(raw) {
  const parts = String(raw).split(':')
  if (parts.length === 1) return { type: 'MODIFY', location: '', content: parts[0].trim(), requirement: '' }
  if (parts.length === 2) return { type: parts[0].trim(), location: '', content: parts[1].trim(), requirement: '' }

  let requirement = ''
  let rest = parts.slice(2)
  const last = rest[rest.length - 1].trim()
  if (rest.length > 1 && /^[A-Za-z][A-Za-z0-9_-]*-?\d[\w-]*$/.test(last)) {
    requirement = last
    rest = rest.slice(0, -1)
  }
  return {
    type: parts[0].trim(),
    location: parts[1].trim(),
    content: rest.join(':').trim(),
    requirement
  }
}

/** 解析 --req "编号:标题:URL" */
function parseReq(raw) {
  const s = String(raw)
  const i1 = s.indexOf(':')
  if (i1 < 0) return { code: s.trim(), title: '', url: '' }
  const code = s.slice(0, i1).trim()
  const restStr = s.slice(i1 + 1)
  const urlAt = restStr.search(/https?:\/\//)
  if (urlAt < 0) return { code, title: restStr.replace(/:$/, '').trim(), url: '' }
  return {
    code,
    title: restStr.slice(0, urlAt).replace(/:\s*$/, '').trim(),
    url: restStr.slice(urlAt).trim()
  }
}

/** 仓库只有一个项目时允许省略 -p */
export function resolveProject(h, given) {
  if (given) return given
  const list = store.listProjectSlugs(h.root)
  if (list.length === 1) return list[0]
  if (list.length === 0) throw err.bad('NO_PROJECT', '仓库里还没有项目', '先建一个：flowlark new "项目名"')
  throw err.bad('PROJECT_REQUIRED', `仓库里有 ${list.length} 个项目，需要指定`, `用 -p <标识>，可选：${list.join('、')}`)
}

/** 从文件名推断版本号：订单中心_v1.4.html → v1.4 */
export function inferVersionNo(filePath) {
  const base = path.basename(filePath).replace(/\.html?$/i, '')
  const m = base.match(/v?\d+(?:\.\d+){0,3}/i)
  if (m) {
    const raw = m[0]
    return /^v/i.test(raw) ? raw.toLowerCase() : 'v' + raw
  }
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `d${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}

// ==================== 命令 ====================

export async function init(pos, values) {
  const dir = pos[0] || process.cwd()
  const existing = findRepoRoot(dir)
  if (existing && path.resolve(existing) !== path.resolve(dir)) {
    warn(`上级目录 ${existing} 已经是一个 Flowlark 仓库`)
  }
  const { root, config } = initRepo(dir, { name: values.desc })
  ok(`已创建仓库 ${c.bold(config.name)}`)
  console.log(kv([
    ['位置', root],
    ['工作台端口', String(config.settings.server.port)],
    ['预览端口', String(config.settings.server.previewPort)]
  ]))
  next(
    `flowlark new "项目名"     ${c.dim('创建第一个项目')}`,
    `flowlark git setup       ${c.dim('纳入 Git 版本控制')}`
  )
}

export async function newProject(pos, values) {
  const h = hub()
  const name = pos[0]
  if (!name) throw err.bad('NAME_REQUIRED', '请提供项目名称', 'flowlark new "订单中心重构" --code order-center')
  const p = h.createProject({ name, code: values.code, description: values.desc })
  ok(`已创建项目 ${c.bold(p.name)}（${c.cyan(p.slug)}）`)
  next(`flowlark add <原型.html> -p ${p.slug} -n v1.0 -t "首版原型"`)
}

export async function add(pos, values) {
  const h = hub()
  const file = pos[0]
  if (!file) throw err.bad('FILE_REQUIRED', '请提供要归档的 HTML 文件', 'flowlark add ./原型.html -t "标题"')

  const slug = resolveProject(h, values.project)
  const versionNo = values.version || inferVersionNo(file)
  const title = values.title || path.basename(file).replace(/\.html?$/i, '')

  const v = h.addVersion(slug, {
    versionNo,
    title,
    sourcePath: file,
    changes: (values.message || []).map(parseChange),
    requirements: (values.req || []).map(parseReq),
    tags: values.tag || []
  })

  ok(`已归档 ${c.bold(v.versionNo)} — ${v.title}`)
  console.log(kv([
    ['项目', slug],
    ['文件', `${v.file}（${fmtSize(v.fileSize)}）`],
    ['状态', statusTag(v.display)],
    ['标签', v.tags.length ? v.tags.map((t) => c.magenta(t)).join(' ') : '—'],
    ['变更', v.changeCount ? `${v.changeCount} 条` : c.yellow('0 条（设为基线前需要至少 1 条）')],
    ['需求', v.requirementCount ? `${v.requirementCount} 条` : '—']
  ]))

  if (v.externalRefs.length) {
    const hosts = groupRefsByHost(v.externalRefs).map((g) => `${g.host}(${g.count})`).join('、')
    warn(`检测到 ${v.externalRefs.length} 个外部依赖：${c.dim(hosts)}`)
    console.log(c.dim('  断网或代理拦截时原型会掉样式，属正常现象，不是工具故障。'))
  }

  if (values.baseline) {
    const b = h.setBaseline(slug, v.versionNo)
    ok(`已设为当前基线：${c.bold(b.versionNo)}`)
  } else {
    next(
      `flowlark baseline ${slug} ${v.versionNo}   ${c.dim('确认为研发要开发的版本')}`,
      `flowlark open ${slug} ${v.versionNo}       ${c.dim('在浏览器里看')}`
    )
  }
}

export async function ls(pos, values) {
  const h = hub()
  const slug = pos[0]

  if (!slug) {
    const projects = h.listProjects()
    if (values.json) return void console.log(JSON.stringify(projects, null, 2))
    if (projects.length === 0) {
      info('仓库里还没有项目')
      return next('flowlark new "项目名"')
    }
    console.log(table(
      ['项目', '标识', '当前基线', '版本数', '更新'],
      projects.map((p) => [
        p.name,
        c.cyan(p.slug),
        p.baselineVersionNo ? c.blue(p.baselineVersionNo) : c.dim('无'),
        String(p.versionCount),
        c.dim(fmtTime(p.updatedAt))
      ])
    ))
    return
  }

  const project = h.getProject(slug)
  const versions = h.listVersions(slug, { includeDraft: true, includeVoid: !!values.all })
  if (values.json) return void console.log(JSON.stringify({ project, versions }, null, 2))

  console.log(c.bold(project.name) + c.dim(`  ${project.slug}`))
  if (project.baselineVersionNo) {
    console.log(c.blue('▎当前基线 ') + c.bold(project.baselineVersionNo) + c.dim('  研发按这版开发'))
  } else {
    console.log(c.yellow('▎还没有基线 ') + c.dim('研发不知道该按哪版开发'))
  }
  console.log('')

  if (versions.length === 0) {
    info('还没有版本')
    return next(`flowlark add <原型.html> -p ${slug} -n v1.0 -t "首版"`)
  }

  const readState = h.getRead(slug)
  const showNew = versions.some((v) => v.isNew)

  console.log(table(
    ['', '版本', '标题', '标签', '变更', '需求', '创建', '创建人'],
    versions.map((v) => [
      statusTag(v.display) + (v.isNew ? ' ' + c.green('新') : v.isLastRead ? ' ' + c.dim('读') : '  '),
      v.isBaseline ? c.bold(v.versionNo) : v.versionNo,
      v.title,
      v.tags && v.tags.length ? v.tags.map((t) => c.magenta(t)).join(' ') : c.dim('—'),
      v.changeCount ? String(v.changeCount) : c.dim('0'),
      v.requirementCount ? String(v.requirementCount) : c.dim('0'),
      c.dim(fmtTime(v.createdAt)),
      c.dim(v.createdBy || '—')
    ]),
    { aligns: ['left', 'left', 'left', 'left', 'right', 'right'] }
  ))

  const hints = []
  if (!values.all && h.listVersions(slug, { includeVoid: true }).some((v) => v.display.key === 'VOID')) {
    hints.push('已隐藏废弃版本，加 -a 显示')
  }
  if (showNew) {
    hints.push(`标「新」的是你上次看过 ${readState.versionNo} 之后新增的，flowlark diff ${slug} 看改了什么`)
  } else if (!readState) {
    hints.push(`flowlark read ${slug} <版本号> 标记已读后，可以只看之后的变更`)
  }
  if (hints.length) console.log('\n' + hints.map((x) => c.dim('  ' + x)).join('\n'))
}

export async function show(pos, values) {
  const h = hub()
  const slug = resolveProject(h, pos[0])
  const versionNo = pos[1] || h.getProject(slug).baselineVersionNo
  if (!versionNo) throw err.bad('VERSION_REQUIRED', '请指定版本号', `flowlark ls ${slug} 看看有哪些`)

  const v = h.getVersion(slug, versionNo)
  if (values.json) return void console.log(JSON.stringify(v, null, 2))

  console.log(c.bold(`${v.versionNo}  ${v.title}`) + '  ' + statusTag(v.display))
  console.log(kv([
    ['项目', slug],
    ['标签', v.tags.length ? v.tags.map((t) => c.magenta(t)).join(' ') : c.dim('—')],
    ['文件', `${v.file}（${fmtSize(v.fileSize)}）`],
    ['来源', v.sourcePath ? c.dim(v.sourcePath) : '—'],
    ['创建', `${fmtTime(v.createdAt)} · ${v.createdBy || '—'}`],
    ['成为基线', v.baselineAt ? fmtTime(v.baselineAt) : '—'],
    ['外部依赖', v.externalRefs.length
      ? c.yellow(`${v.externalRefs.length} 项`) + (v.hasOffline ? c.green('（已生成离线版）') : c.dim(`  flowlark offline ${slug} ${v.versionNo}`))
      : '无'],
    ['规格书', v.spec ? `${v.spec.split('\n').length} 行` : c.dim('未编写')]
  ]))

  if (v.changes.length) {
    console.log(heading('变更日志'))
    for (const g of ['ADD', 'MODIFY', 'REMOVE']) {
      const items = v.changes.filter((x) => x.type === g)
      if (!items.length) continue
      const color = g === 'ADD' ? c.green : g === 'REMOVE' ? c.red : c.blue
      for (const it of items) {
        console.log(
          '  ' + color(CHANGE_LABEL[g]) +
          (it.location ? ' ' + c.dim(`[${it.location}]`) : '') +
          ' ' + it.content +
          (it.requirement ? ' ' + c.cyan(it.requirement) : '')
        )
      }
    }
  } else {
    console.log(heading('变更日志') + '\n  ' + c.dim('（空）'))
  }

  if (v.requirements.length) {
    console.log(heading('关联需求'))
    for (const r of v.requirements) {
      console.log('  ' + c.cyan(r.code) + '  ' + (r.title || c.dim('—')) + (r.url ? '  ' + c.dim(r.url) : ''))
    }
  }

  if (v.attachments.length) {
    console.log(heading('附件'))
    for (const a of v.attachments) {
      console.log(
        '  ' + (a.missing ? c.red('✗ ') : '') + a.name +
        c.dim(`  ${fmtSize(a.size)} · ${a.addedBy || '—'}`)
      )
    }
  }

  next(`flowlark open ${slug} ${v.versionNo}   ${c.dim('在浏览器里看原型')}`)
}

export async function baseline(pos, values) {
  const h = hub()
  const slug = resolveProject(h, pos[0])
  const versionNo = pos[1]
  if (!versionNo) {
    const p = h.getProject(slug)
    if (values.json) return void console.log(JSON.stringify({ baseline: p.baselineVersionNo }, null, 2))
    return void console.log(p.baselineVersionNo || c.dim('（无基线）'))
  }

  const before = h.getProject(slug).baselineVersionNo
  const v = h.setBaseline(slug, versionNo)
  ok(`当前基线：${c.bold(v.versionNo)} — ${v.title}`)
  if (before) console.log(c.dim(`  原基线 ${before} 已降为历史版本`))
  console.log(c.dim('  该版本的原型文件与变更日志已锁定，规格书仍可编辑'))
}

export async function rollback(pos, values) {
  const h = hub()
  const slug = resolveProject(h, pos[0])
  const before = h.getProject(slug).baselineVersionNo
  const v = h.rollback(slug)
  ok(`已回滚基线：${c.bold(before)} → ${c.bold(v.versionNo)}`)
}

export async function change(pos, values) {
  const h = hub()
  const slug = resolveProject(h, pos[0])
  const versionNo = pos[1]
  if (!versionNo) throw err.bad('VERSION_REQUIRED', '请指定版本号')
  if (!values.message || !values.message.length) {
    throw err.bad('MESSAGE_REQUIRED', '请提供变更内容', '-m "修改:位置:改了什么"')
  }
  let v
  for (const m of values.message) v = h.addChange(slug, versionNo, parseChange(m))
  ok(`已追加 ${values.message.length} 条变更，${v.versionNo} 现有 ${v.changeCount} 条`)
}

export async function spec(pos, values) {
  const h = hub()
  const slug = resolveProject(h, pos[0])
  const versionNo = pos[1] || h.getProject(slug).baselineVersionNo
  if (!versionNo) throw err.bad('VERSION_REQUIRED', '请指定版本号')

  if (values.file) {
    const content = fs.readFileSync(path.resolve(values.file), 'utf8')
    h.setSpec(slug, versionNo, content)
    return ok(`已从 ${values.file} 导入规格书`)
  }

  // --history：规格书什么时候被谁改过。Git 已经记了，翻译成产品语言即可
  if (values.history) {
    const commits = h.gitSpecHistory(slug, versionNo, Number(values.limit) || 30)
    if (values.json) return void console.log(JSON.stringify(commits, null, 2))
    if (commits.length === 0) {
      info(`${versionNo} 的规格书还没有 Git 提交记录`)
      return next('flowlark sync   ' + c.dim('提交当前改动'))
    }
    console.log(c.bold(`${slug} / ${versionNo}`) + c.dim('  规格书修改史'))
    console.log('')
    console.log(table(
      ['提交', '时间', '作者', '说明'],
      commits.map((x) => [c.yellow(x.short), c.dim(fmtTime(x.date)), x.author, x.subject])
    ))
    next(`flowlark spec ${slug} ${versionNo} --at ${commits[commits.length - 1].short}   ${c.dim('看最早那版')}`)
    return
  }

  // --at：回到某次提交时的规格书内容
  if (values.at) {
    const content = h.gitSpecAt(slug, versionNo, values.at)
    if (values.json) return void console.log(JSON.stringify({ ref: values.at, spec: content }, null, 2))
    console.log(c.dim(`# 以下是 ${values.at} 时的内容，非当前版本`))
    console.log('')
    console.log(content)
    return
  }

  if (values.edit) {
    const current = h.getVersion(slug, versionNo).spec
    const tmp = path.join(os.tmpdir(), `flowlark-${slug}-${versionNo}.md`)
    fs.writeFileSync(tmp, current || `# ${versionNo} 规格说明\n\n`, 'utf8')
    const editor = process.env.VISUAL || process.env.EDITOR || 'vi'
    const r = spawnSync(editor, [tmp], { stdio: 'inherit' })
    if (r.status !== 0) return warn('编辑器异常退出，未保存')
    h.setSpec(slug, versionNo, fs.readFileSync(tmp, 'utf8'))
    fs.rmSync(tmp, { force: true })
    return ok(`规格书已保存到 projects/${slug}/versions/${versionNo}.spec.md`)
  }

  const v = h.getVersion(slug, versionNo)
  if (values.json) return void console.log(JSON.stringify({ spec: v.spec }, null, 2))
  if (!v.spec) {
    info(`${versionNo} 还没有规格书`)
    return next(`flowlark spec ${slug} ${versionNo} --edit`)
  }
  console.log(v.spec)
}

export async function diff(pos, values) {
  const h = hub()
  const slug = resolveProject(h, pos[0])
  const project = h.getProject(slug)
  const versions = h.listVersions(slug)
  if (versions.length === 0) throw err.bad('NO_VERSION', '项目里还没有版本')

  let r
  let fromRead = false
  if (!values.from && !values.to) {
    // 不指定区间时，从「我上次看过的那一版」算起 —— 这才是用户真正想问的
    r = h.sinceLastRead(slug)
    fromRead = r.basedOnReadState
  } else {
    const to = values.to || project.baselineVersionNo || versions[0].versionNo
    const from = values.from || (versions.length > 1 ? versions[versions.length - 1].versionNo : null)
    r = h.cumulative(slug, from, to)
  }
  if (values.json) return void console.log(JSON.stringify(r, null, 2))

  console.log(
    c.bold(`${r.fromVersionNo || '起点'} → ${r.toVersionNo}`) +
    c.dim(`  跨 ${r.versionCount} 个版本，共 ${r.itemCount} 条变更`) +
    (fromRead ? c.dim(`\n${' '.repeat(2)}起点取自你上次标记已读的 ${r.lastReadVersionNo}`) : '')
  )
  if (r.itemCount === 0) return void console.log(c.dim('\n  区间内无变更记录'))

  console.log('')
  for (const g of ['ADD', 'MODIFY', 'REMOVE']) {
    const items = r.items.filter((x) => x.type === g)
    if (!items.length) continue
    const color = g === 'ADD' ? c.green : g === 'REMOVE' ? c.red : c.blue
    console.log(color(`${CHANGE_LABEL[g]} ${items.length} 条`))
    for (const it of items) {
      console.log(
        '  ' + (it.location ? c.dim(`[${it.location}] `) : '') + it.content +
        (it.requirement ? ' ' + c.cyan(it.requirement) : '') +
        c.dim(`  ${it.fromVersionNo}`)
      )
    }
    console.log('')
  }

  // 热点：手写变更日志唯一能产出的洞察，成本只有一个 groupBy
  const hot = Object.entries(r.locationCounts).filter(([, n]) => n > 2).sort((a, b) => b[1] - a[1])
  if (hot.length) {
    console.log(c.yellow('反复修改的区域') + c.dim('  建议重点确认'))
    for (const [loc, n] of hot) console.log('  ' + c.yellow('🔥') + ` ${loc} — 改了 ${n} 次`)
  }
}

export async function log(pos, values) {
  const h = hub()
  const slug = pos[0] ? resolveProject(h, pos[0]) : null
  const entries = h.oplog({ project: slug, limit: Number(values.limit) || 50 })
  if (values.json) return void console.log(JSON.stringify(entries, null, 2))
  if (entries.length === 0) return void info('还没有操作记录')

  console.log(table(
    ['时间', '操作人', '项目', '动作', '详情'],
    entries.map((e) => [
      c.dim(fmtTime(e.at)),
      e.by || '—',
      c.cyan(e.project || '—'),
      e.action,
      e.detail
    ])
  ))
}

export async function status(pos, values) {
  const root = requireRepoRoot()
  const h = new Hub(root)
  const projects = h.listProjects()
  const git = h.gitStatus()
  const conflicts = h.gitConflicts()

  // 有多少项目有我没看过的新版本 —— 研发最关心的一行
  const unread = []
  for (const p of projects) {
    const list = h.listVersions(p.slug)
    const n = list.filter((v) => v.isNew).length
    if (n > 0) unread.push({ slug: p.slug, count: n })
  }

  const data = {
    root,
    name: h.config.name,
    projects: projects.length,
    versions: projects.reduce((n, p) => n + p.versionCount, 0),
    withoutBaseline: projects.filter((p) => !p.baselineVersionNo).map((p) => p.slug),
    unread,
    git: { ...git, conflicts }
  }
  if (values.json) return void console.log(JSON.stringify(data, null, 2))

  console.log(c.bold(h.config.name))
  console.log(kv([
    ['仓库', root],
    ['项目', `${data.projects} 个`],
    ['版本', `${data.versions} 个`],
    ['分支', git.branch ? c.cyan(git.branch) : c.dim('—')],
    ['Git', gitSummary(git, conflicts)]
  ]))

  if (conflicts.length) {
    console.log('')
    warn(`${conflicts.length} 个文件处于冲突状态`)
    next('flowlark resolve   ' + c.dim('查看并辅助解决'))
    return
  }

  if (data.withoutBaseline.length) {
    console.log('')
    warn(`${data.withoutBaseline.length} 个项目还没有基线：${data.withoutBaseline.join('、')}`)
    console.log(c.dim('  研发进去不知道该按哪版开发'))
  }

  if (unread.length) {
    console.log('')
    info(`${unread.length} 个项目有你没看过的新版本`)
    for (const u of unread) console.log(`  ${c.cyan(u.slug)} ${c.green(`+${u.count}`)}`)
    next(`flowlark diff ${unread[0].slug}   ${c.dim('看看改了什么')}`)
    return
  }

  if (git.tracked && (!git.clean || git.ahead > 0)) {
    next('flowlark sync   ' + c.dim('提交并同步给团队'))
  }
}

function gitSummary(git, conflicts) {
  if (!git.tracked) return c.dim('未纳入 Git')
  if (conflicts.length) return c.red(`${conflicts.length} 个冲突待解决`)
  const bits = []
  if (!git.clean) bits.push(c.yellow(`${git.files.length} 处未提交`))
  if (git.ahead) bits.push(c.cyan(`领先远端 ${git.ahead}`))
  if (git.behind) bits.push(c.magenta(`落后远端 ${git.behind}`))
  if (bits.length === 0) bits.push(c.green('工作区干净'))
  if (!git.hasRemote) bits.push(c.dim('无远端'))
  return bits.join('，')
}

export async function rm(pos, values) {
  const h = hub()
  const slug = resolveProject(h, pos[0])
  const versionNo = pos[1]
  if (!versionNo) throw err.bad('VERSION_REQUIRED', '请指定要删除的版本号')
  const r = h.removeVersion(slug, versionNo)
  ok(`已删除 ${c.bold(versionNo)}，移入回收站`)
  next(`flowlark restore ${slug} ${versionNo}   ${c.dim('随时恢复')}`)
}

export async function restore(pos, values) {
  const h = hub()
  const slug = resolveProject(h, pos[0])
  const versionNo = pos[1]
  if (!versionNo) throw err.bad('VERSION_REQUIRED', '请指定要恢复的版本号')
  const v = h.restoreVersion(slug, versionNo)
  ok(`已恢复 ${c.bold(v.versionNo)}，状态：${v.display.label}`)
}

export async function trash(pos, values) {
  const h = hub()
  const items = h.listTrash(pos[0] || null)
  if (values.json) return void console.log(JSON.stringify(items, null, 2))
  if (items.length === 0) return void info('回收站是空的')
  console.log(table(
    ['项目', '版本', '删除时间', '删除人'],
    items.map((t) => [c.cyan(t.project), t.versionNo, c.dim(fmtTime(t.deletedAt)), t.deletedBy || '—'])
  ))
}

export async function voidVersion(pos, values) {
  const h = hub()
  const slug = resolveProject(h, pos[0])
  const v = h.voidVersion(slug, pos[1])
  ok(`已废弃 ${v.versionNo}`)
}

export async function reopen(pos, values) {
  const h = hub()
  const slug = resolveProject(h, pos[0])
  const v = h.reopenVersion(slug, pos[1])
  ok(`已恢复 ${v.versionNo} 为编辑中`)
}

export async function watch(pos, values) {
  const h = hub()
  const slug = resolveProject(h, pos[0])
  const dir = path.resolve(values.dir || process.cwd())
  if (!fs.existsSync(dir)) throw err.notFound(`目录 ${dir}`)

  info(`监听 ${c.bold(dir)} → 项目 ${c.cyan(slug)}`)
  console.log(c.dim('  新出现的 .html 会自动归档为草稿版本。Ctrl+C 退出。\n'))

  const seen = new Set(fs.readdirSync(dir).filter((f) => /\.html?$/i.test(f)))
  const pending = new Map()

  fs.watch(dir, (event, filename) => {
    if (!filename || !/\.html?$/i.test(filename)) return
    if (seen.has(filename)) return
    // 防抖：编辑器保存常触发多次事件，且文件可能还没写完
    clearTimeout(pending.get(filename))
    pending.set(filename, setTimeout(() => {
      pending.delete(filename)
      const full = path.join(dir, filename)
      if (!fs.existsSync(full)) return
      seen.add(filename)
      try {
        let no = inferVersionNo(filename)
        // 推断出的版本号可能已被占用，追加后缀直到可用
        let n = 1
        while (store.versionExists(h.root, slug, no)) no = `${inferVersionNo(filename)}-${++n}`
        const v = h.addVersion(slug, {
          versionNo: no,
          title: path.basename(filename).replace(/\.html?$/i, ''),
          sourcePath: full
        })
        ok(`${c.dim(new Date().toLocaleTimeString())} 归档 ${c.bold(v.versionNo)} ← ${filename}`)
      } catch (e) {
        warn(`${filename} 归档失败：${e.message}`)
      }
    }, 400))
  })
}

export async function serve(pos, values) {
  const root = requireRepoRoot()
  const { startServer } = await import('../server/index.js')
  const port = values.port ? Number(values.port) : undefined
  const info2 = await startServer(root, { port, lan: values.lan || undefined })
  printServeInfo(info2)
}

/** 起服务后统一打印访问信息，serve 和 open 共用，避免两处说法不一致 */
export function printServeInfo(s) {
  info(`工作台 ${c.bold(s.url)}`)
  if (s.lan) {
    if (s.lanAddresses.length === 0) {
      warn('已开启局域网访问，但没检测到局域网地址')
    } else {
      for (const a of s.lanAddresses) {
        console.log(`  ${c.dim('局域网')} ${c.cyan(`http://${a.address}:${s.port}`)} ${c.dim(a.iface)}`)
      }
      console.log('  ' + c.dim(s.readonlyFromLan
        ? '局域网为只读模式，写操作仅限本机'
        : '⚠ 局域网可写：同网段任何人都能删版本、改基线'))
    }
  } else {
    console.log('  ' + c.dim('仅本机可访问。开放给同事：flowlark lan on'))
  }
  console.log(c.dim('  Ctrl+C 停止'))
}

export async function open(pos, values) {
  const root = requireRepoRoot()
  const { startServer } = await import('../server/index.js')
  const port = values.port ? Number(values.port) : undefined
  const served = await startServer(root, { port, lan: values.lan || undefined })
  const url = served.url

  let target = url
  if (pos[0]) {
    const h = new Hub(root)
    const slug = resolveProject(h, pos[0])
    const versionNo = pos[1]
    target = versionNo ? `${url}/#/projects/${slug}/versions/${versionNo}` : `${url}/#/projects/${slug}`
  }

  printServeInfo(served)
  if (!values['no-open']) openBrowser(target)
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open'
    : process.platform === 'win32' ? 'cmd'
    : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    warn('无法自动打开浏览器，请手动访问上面的地址')
  }
}
