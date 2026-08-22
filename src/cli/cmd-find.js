import { spawn } from 'node:child_process'
import { err } from '../core/errors.js'
import { hub, resolveProject } from './commands.js'
import { c, table, kv, fmtSize, fmtTime, ok, info, warn, next } from './ui.js'

/** 在片段里给命中部分上色 */
function highlight(snip) {
  if (!snip) return ''
  const { text, matchStart, matchLength } = snip
  if (matchStart < 0) return text
  return (
    text.slice(0, matchStart) +
    c.yellow(c.bold(text.slice(matchStart, matchStart + matchLength))) +
    text.slice(matchStart + matchLength)
  )
}

export async function search(pos, values) {
  const h = hub()
  const query = pos.join(' ').trim()
  if (!query) {
    throw err.bad('QUERY_REQUIRED', '请提供搜索关键词',
      'flowlark search 批量导出')
  }

  const r = h.search(query, {
    project: values.project || null,
    limit: Number(values.limit) || 30,
    fields: values.field ? values.field.split(',').map((s) => s.trim()) : null
  })

  if (values.json) return void console.log(JSON.stringify(r, null, 2))

  if (r.total === 0) {
    info(`没有找到「${query}」`)
    return next(
      'flowlark search <关键词> --field spec   ' + c.dim('只搜规格书'),
      'flowlark ls                            ' + c.dim('看看有哪些项目')
    )
  }

  console.log(c.dim(`「${query}」命中 ${r.total} 处${r.total > r.results.length ? `，显示前 ${r.results.length}` : ''}`))
  console.log('')

  let lastKey = null
  for (const item of r.results) {
    const key = `${item.project}/${item.versionNo || ''}`
    if (key !== lastKey) {
      lastKey = key
      const where = item.versionNo
        ? `${c.cyan(item.project)} ${c.bold(item.versionNo)} ${c.dim(item.versionTitle || '')}`
        : c.cyan(item.project)
      const badge = item.versionStatus === 'BASELINE' ? ' ' + c.blue('● 基线') : ''
      console.log(where + badge)
    }
    console.log(`  ${c.dim(item.fieldLabel.padEnd(5))} ${highlight(item.snippet)}`)
  }

  const first = r.results[0]
  if (first.versionNo) {
    next(`flowlark show ${first.project} ${first.versionNo}`)
  }
}

export async function read(pos, values) {
  const h = hub()

  if (values.clear) {
    const slug = pos[0] ? resolveProject(h, pos[0]) : null
    h.clearRead(slug)
    return void ok(slug ? `已清除 ${slug} 的已读标记` : '已清除全部已读标记')
  }

  const slug = resolveProject(h, pos[0])
  const project = h.getProject(slug)

  if (!pos[1]) {
    // 不给版本号就是「读一下当前状态」
    const state = h.getRead(slug)
    if (values.json) return void console.log(JSON.stringify(state, null, 2))
    if (!state) {
      info(`${slug} 还没有已读标记`)
      return next(
        `flowlark read ${slug} ${project.baselineVersionNo || '<版本号>'}   ${c.dim('标记为已读')}`
      )
    }
    console.log(kv([
      ['上次看到', c.bold(state.versionNo)],
      ['标记于', fmtTime(state.at)]
    ]))
    const versions = h.listVersions(slug)
    const newer = versions.filter((v) => v.isNew).length
    if (newer > 0) {
      console.log('')
      warn(`之后新增了 ${newer} 个版本`)
      next(`flowlark diff ${slug}   ${c.dim('看这期间改了什么')}`)
    } else {
      console.log('')
      ok('没有新版本')
    }
    return
  }

  const versionNo = pos[1] === '.' ? project.baselineVersionNo : pos[1]
  if (!versionNo) throw err.bad('VERSION_REQUIRED', '项目还没有基线，请显式指定版本号')
  const state = h.markRead(slug, versionNo)
  ok(`已标记 ${c.bold(versionNo)} 为已读`)
  console.log(c.dim('  之后 flowlark diff 会默认从这一版算起'))
  return state
}

export async function tag(pos, values) {
  const h = hub()

  // flowlark tag —— 不带参数列出全仓库的标签
  if (pos.length === 0) {
    const tags = h.allTags()
    if (values.json) return void console.log(JSON.stringify(tags, null, 2))
    if (tags.length === 0) {
      info('还没有任何标签')
      return next('flowlark tag <项目> <版本> 已评审')
    }
    console.log(table(['标签', '用了几次'], tags.map((t) => [c.magenta(t.tag), String(t.count)]),
      { aligns: ['left', 'right'] }))
    return
  }

  const slug = resolveProject(h, pos[0])
  const versionNo = pos[1]
  if (!versionNo) throw err.bad('VERSION_REQUIRED', '请指定版本号')

  const rest = pos.slice(2)
  if (rest.length === 0 && !values.clear) {
    const v = h.getVersion(slug, versionNo)
    if (values.json) return void console.log(JSON.stringify(v.tags, null, 2))
    console.log(v.tags.length ? v.tags.map((t) => c.magenta(t)).join('  ') : c.dim('（无标签）'))
    return
  }

  let v
  if (values.clear) {
    v = h.setTags(slug, versionNo, [])
    ok(`已清空 ${versionNo} 的标签`)
  } else {
    // 以 - 开头表示移除
    const add = rest.filter((t) => !t.startsWith('-'))
    const remove = rest.filter((t) => t.startsWith('-')).map((t) => t.slice(1))
    const current = h.getVersion(slug, versionNo).tags
    const nextTags = [...current.filter((t) => !remove.includes(t)), ...add]
    v = h.setTags(slug, versionNo, nextTags)
    ok(`${versionNo} 的标签：${v.tags.map((t) => c.magenta(t)).join('  ') || c.dim('（空）')}`)
  }
  return v
}

export async function offline(pos, values) {
  const h = hub()
  const slug = resolveProject(h, pos[0])
  const versionNo = pos[1] || h.getProject(slug).baselineVersionNo
  if (!versionNo) throw err.bad('VERSION_REQUIRED', '请指定版本号')

  const v = h.getVersion(slug, versionNo)

  if (values.clear) {
    h.clearOffline(slug, versionNo)
    return void ok(`已删除 ${versionNo} 的离线版本`)
  }

  if (v.externalRefs.length === 0) {
    info(`${versionNo} 没有外部依赖，本来就是自包含的`)
  } else {
    info(`正在抓取 ${v.externalRefs.length} 个外部资源…`)
  }

  const r = await h.buildOffline(slug, versionNo)

  if (r.alreadySelfContained) {
    ok(`已生成离线版本（原样拷贝，${fmtSize(r.bytes)}）`)
  } else if (r.ok) {
    ok(`已生成离线版本：内联 ${r.inlined}/${r.total} 个资源，${fmtSize(r.bytes)}`)
  } else {
    warn(`离线版本已生成，但 ${r.failed.length} 个资源抓取失败`)
    for (const f of r.failed.slice(0, 8)) {
      console.log(`  ${c.red('✗')} ${c.dim(f.url)}  ${f.reason}`)
    }
    console.log(c.dim('  这些资源在离线版里仍然会加载失败'))
  }
  console.log(c.dim(`  文件：${r.file}`))
  console.log(c.dim('  这是派生产物，存在 .flowlark/cache/ 下，不进 Git，原型文件本身未被修改'))
  next(`flowlark open ${slug} ${versionNo}   ${c.dim('工作台里可切换「离线预览」')}`)
}

export async function compare(pos, values) {
  const h = hub()
  const slug = resolveProject(h, pos[0])
  const versions = h.listVersions(slug)
  if (versions.length < 2) throw err.bad('NEED_TWO', '至少要有两个版本才能对比')

  const a = pos[1] || (h.getProject(slug).baselineVersionNo || versions[0].versionNo)
  const b = pos[2] || versions.find((v) => v.versionNo !== a)?.versionNo
  if (!b) throw err.bad('NEED_TWO', '找不到第二个版本')

  // 存在性校验，早失败好过打开浏览器再报错
  h.getVersion(slug, a)
  h.getVersion(slug, b)

  const { startServer } = await import('../server/index.js')
  const { url } = await startServer(h.root, { port: values.port ? Number(values.port) : undefined })
  const target = `${url}/#/projects/${encodeURIComponent(slug)}/compare?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`

  info(`并排对比 ${c.bold(a)} ↔ ${c.bold(b)}`)
  console.log(`  ${target}`)
  if (!values['no-open']) openBrowser(target)
  console.log(c.dim('  Ctrl+C 停止'))
}

function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    warn('无法自动打开浏览器，请手动访问上面的地址')
  }
}
