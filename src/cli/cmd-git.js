import { err } from '../core/errors.js'
import { hub, resolveProject } from './commands.js'
import { c, table, kv, fmtTime, ok, info, warn, next } from './ui.js'

/**
 * Git 相关命令。
 *
 * 这些命令的价值不在于封装了 git —— 用户自己会敲 git。价值在于用产品语言
 * 回答问题：「这一版都谁改过」「规格书上周长什么样」「基线是谁切的」。
 * 底下都是 git，但用户不必知道 refspec 和 rev-parse。
 */

export async function sync(pos, values) {
  const h = hub()
  const st = h.gitStatus()

  if (!st.tracked) {
    throw err.bad('NOT_GIT_REPO', '这个仓库还没纳入 Git',
      `cd ${h.root} && git init && git add . && git commit -m "init"`)
  }

  if (values.json) {
    const r = h.gitSync({ message: values.message && values.message[0], push: !values['no-push'] })
    return void console.log(JSON.stringify(r, null, 2))
  }

  if (!st.clean) {
    info(`${st.files.length} 处改动待提交`)
    for (const f of st.files.slice(0, 12)) {
      console.log('  ' + c.dim(f.label.padEnd(6)) + f.path)
    }
    if (st.files.length > 12) console.log(c.dim(`  …还有 ${st.files.length - 12} 处`))
    console.log('')
  }

  const r = h.gitSync({ message: values.message && values.message[0], push: !values['no-push'] })
  for (const s of r.steps) {
    const mark = s.ok ? c.green('✓') : c.red('✗')
    console.log(`  ${mark} ${s.name}${s.detail ? c.dim('  ' + s.detail) : ''}`)
  }

  if (r.conflicted) {
    console.log('')
    warn('产生了冲突，需要人工确认')
    next('flowlark resolve   ' + c.dim('查看冲突并辅助解决'))
    process.exitCode = 1
    return
  }

  const after = h.gitStatus()
  console.log('')
  if (after.hasRemote) ok('已与远端同步')
  else ok('已提交到本地（没有配置远端）')
  if (after.branch) console.log(c.dim(`  分支 ${after.branch}`))
}

export async function history(pos, values) {
  const h = hub()
  const slug = resolveProject(h, pos[0])
  const versionNo = pos[1] || h.getProject(slug).baselineVersionNo
  if (!versionNo) throw err.bad('VERSION_REQUIRED', '请指定版本号')

  const commits = h.gitVersionHistory(slug, versionNo, Number(values.limit) || 30)
  if (values.json) return void console.log(JSON.stringify(commits, null, 2))

  if (commits.length === 0) {
    info(`${versionNo} 还没有 Git 提交记录`)
    return next('flowlark sync   ' + c.dim('提交当前改动'))
  }

  console.log(c.bold(`${slug} / ${versionNo}`) + c.dim('  的演进历史'))
  console.log('')
  console.log(table(
    ['提交', '时间', '作者', '改动了', '说明'],
    commits.map((x) => [
      c.yellow(x.short),
      c.dim(fmtTime(x.date)),
      x.author,
      c.cyan(x.kinds.join('+')),
      x.subject
    ])
  ))
  next(`flowlark spec ${slug} ${versionNo} --at ${commits[0].short}   ${c.dim('看那时的规格书')}`)
}

export async function blame(pos, values) {
  const h = hub()
  const slug = resolveProject(h, pos[0])
  const entries = h.gitBaselineHistory(slug, Number(values.limit) || 30)

  if (values.json) return void console.log(JSON.stringify(entries, null, 2))

  if (entries.length === 0) {
    info('还没有基线变更的提交记录')
    return
  }

  console.log(c.bold(`${slug}`) + c.dim('  的基线变迁'))
  console.log('')
  // 倒序展示：最上面是现在，往下是历史
  console.log(table(
    ['基线', '切换时间', '操作人', '提交', '说明'],
    entries.map((e, i) => [
      (i === 0 ? c.blue('● ') : c.dim('· ')) + (e.versionNo || c.dim('（无）')),
      c.dim(fmtTime(e.date)),
      e.author,
      c.yellow(e.short),
      c.dim(e.subject)
    ])
  ))

  const who = h.gitContributors(slug, 5)
  if (who.length) {
    console.log('')
    console.log(c.dim('  参与过这个项目的人：') + who.map((w) => `${w.name}(${w.commits})`).join('、'))
  }
}

export async function resolve(pos, values) {
  const h = hub()
  const conflicts = h.gitConflicts()

  if (values.json) return void console.log(JSON.stringify(conflicts, null, 2))

  if (conflicts.length === 0) {
    return void ok('没有冲突')
  }

  console.log(c.bold(`${conflicts.length} 个文件处于冲突状态`))
  console.log('')

  const assisted = conflicts.filter((x) => x.assisted)
  const manual = conflicts.filter((x) => !x.assisted)

  for (const con of assisted) {
    const info2 = h.gitBaselineConflict(con.project)
    if (!info2) continue
    console.log(c.blue('▎基线冲突') + c.dim(`  ${con.path}`))
    console.log(`  两边各自把 ${c.cyan(con.project)} 的基线指向了不同版本：`)
    console.log(`    ${c.bold(info2.ours)}   ${c.dim('（你这边）')}`)
    console.log(`    ${c.bold(info2.theirs)}   ${c.dim('（对方那边）')}`)
    console.log('')
    console.log(c.dim('  选一个保留：'))
    console.log(`    flowlark resolve ${con.project} ${info2.ours}`)
    console.log(`    flowlark resolve ${con.project} ${info2.theirs}`)
    console.log('')
  }

  if (manual.length) {
    console.log(c.yellow('▎需要手工解决'))
    for (const m of manual) {
      console.log(`  ${m.path} ${c.dim(`(${m.kind})`)}`)
    }
    console.log(c.dim('  这些用编辑器打开处理，改完 git add；JSON 的冲突块因为键序稳定，通常一眼能看懂'))
    console.log('')
  }

  next('解决完全部冲突后：git rebase --continue，或 flowlark sync')
}

/** 不带参数是「列冲突」，带参数是「选一边」—— 一个命令覆盖查看和处置两步 */
export async function resolveCmd(pos, values) {
  return pos.length >= 2 ? resolvePick(pos, values) : resolve(pos, values)
}

/** flowlark resolve <项目> <版本号> —— 直接定这个项目的基线 */
export async function resolvePick(pos, values) {
  const h = hub()
  const slug = pos[0]
  const versionNo = pos[1]
  const conflict = h.gitBaselineConflict(slug)
  if (!conflict) {
    throw err.bad('NO_CONFLICT', `项目 ${slug} 的 BASELINE 没有处于冲突状态`)
  }
  if (versionNo !== conflict.ours && versionNo !== conflict.theirs) {
    throw err.bad('BAD_CHOICE',
      `${versionNo} 不是这次冲突的两个选项之一`,
      `可选：${conflict.ours} 或 ${conflict.theirs}`)
  }
  h.gitResolveBaseline(slug, versionNo)
  ok(`已把 ${slug} 的基线定为 ${c.bold(versionNo)}，并已 git add`)

  const left = h.gitConflicts()
  if (left.length) {
    console.log(c.dim(`  还剩 ${left.length} 个冲突文件`))
    next('flowlark resolve   ' + c.dim('看剩下的'))
  } else {
    next('git rebase --continue   ' + c.dim('或 flowlark sync'))
  }
}
