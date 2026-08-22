import { err } from '../core/errors.js'
import { hub, resolveProject } from './commands.js'
import { c, table, kv, fmtTime, ok, info, warn, next } from './ui.js'

/**
 * Git 相关命令。
 *
 * 原则：Flowlark 从不让用户去敲 git。
 *
 * 用户是产品经理和研发，不是所有人都熟 rebase。以前遇到「没纳入 Git」
 * 「rebase 卡住了」，我们只在屏幕上印一行命令让人自己去终端处理 ——
 * 那等于在最需要帮忙的时刻把人推开。现在每一种处境都有对应的产品命令，
 * 拿不准就 `flowlark git`，它会看一眼当前状态，告诉你下一件该做的事。
 *
 * 想让 AI 助理代劳的，用 `flowlark git brief`：它把仓库处境和那些
 * 「不知道就一定会做错」的约定整理成一段说明，粘给助理即可。
 */

export async function sync(pos, values) {
  const h = hub()
  const st = h.gitStatus()

  if (!st.tracked) {
    throw err.bad('NOT_GIT_REPO', '这个仓库还没纳入 Git',
      '运行 flowlark git setup —— 初始化、身份、首次提交一次做完')
  }

  // 上一次同步卡在冲突上还没走完，这时再 sync 只会让 git 报一堆看不懂的错
  if (h.gitInProgress()) {
    warn('上一次同步还没走完')
    next('flowlark git   ' + c.dim('看看卡在哪一步'))
    process.exitCode = 1
    return
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
    console.log(`    ${c.bold(info2.mine)}   ${c.dim('（你这边）')}`)
    console.log(`    ${c.bold(info2.others)}   ${c.dim('（对方那边）')}`)
    console.log('')
    console.log(c.dim('  选一个保留：'))
    console.log(`    flowlark resolve ${con.project} ${info2.mine}`)
    console.log(`    flowlark resolve ${con.project} ${info2.others}`)
    console.log('')
  }

  if (manual.length) {
    console.log(c.yellow('▎需要手工解决'))
    for (const m of manual) {
      console.log(`  ${m.path} ${c.dim(`(${m.kind})`)}`)
    }
    console.log(c.dim('  用编辑器打开处理，JSON 的冲突块因为键序稳定，通常一眼能看懂'))
    console.log(c.dim('  改完执行：') + `flowlark git resolved ${manual[0].path}`)
    console.log(c.dim('  不想自己处理：') + 'flowlark git brief  ' + c.dim('生成一段说明交给 AI 助理'))
    console.log('')
  }

  next('全部解决后：flowlark git continue')
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
  if (versionNo !== conflict.mine && versionNo !== conflict.others) {
    throw err.bad('BAD_CHOICE',
      `${versionNo} 不是这次冲突的两个选项之一`,
      `可选：${conflict.mine}（你这边）或 ${conflict.others}（对方）`)
  }
  h.gitResolveBaseline(slug, versionNo)
  ok(`已把 ${slug} 的基线定为 ${c.bold(versionNo)}`)

  const left = h.gitConflicts()
  if (left.length) {
    console.log(c.dim(`  还剩 ${left.length} 个冲突文件`))
    next('flowlark resolve   ' + c.dim('看剩下的'))
  } else {
    next('flowlark git continue   ' + c.dim('让这次同步走完'))
  }
}

// ==================== Git 助手 ====================

/**
 * `flowlark git` —— 体检。
 *
 * 这个命令的设计目标是：无论用户处在什么状态、记不记得别的命令，
 * 敲它总能得到一件明确该做的事。
 */
export async function doctor(pos, values) {
  const h = hub()
  const d = h.gitDoctor()
  if (values.json) return void console.log(JSON.stringify(d, null, 2))

  console.log('')
  for (const chk of d.checks) {
    const mark = chk.level === 'ok' ? c.green('✓') : chk.level === 'warn' ? c.yellow('!') : c.red('✗')
    console.log(`  ${mark} ${chk.title}${chk.detail ? c.dim('  ' + chk.detail) : ''}`)
  }
  console.log('')

  if (d.ok) return void ok('一切正常，没有待办')

  // action 里带的是 HTTP 接口，CLI 这边翻译成对应的命令
  const CMD = {
    'install-git': null,
    init: 'flowlark git setup',
    identity: 'flowlark git whoami --name "你的名字" --email "你的邮箱"',
    resolve: 'flowlark resolve',
    continue: 'flowlark git continue',
    abort: 'flowlark git abort',
    remote: 'flowlark remote <地址>',
    sync: 'flowlark sync'
  }
  for (const a of d.actions) {
    const cmd = CMD[a.key]
    if (cmd) next(cmd + '   ' + c.dim(a.label))
    else if (a.detail) console.log(c.dim('  ' + a.detail))
  }
  console.log(c.dim('  想让 AI 助理代劳：') + 'flowlark git brief')
}

export async function permission(pos, values) {
  const h = hub()
  const p = values.refresh ? h.refreshWritePermission() : h.writePermission()

  if (values.json) return void console.log(JSON.stringify(p, null, 2))

  if (p.mode === 'readonly') {
    warn('当前仓库按 Git 只读处理')
    console.log(kv([
      ['原因', p.reason],
      ['来源', p.source],
      ['探测时间', p.checkedAt ? fmtTime(p.checkedAt) : '—']
    ]))
    next('flowlark git permission --refresh   ' + c.dim('远端权限变更后刷新一次'))
    return
  }

  const label = p.mode === 'writable' ? '可写' : '未确认，暂按可写'
  ok(`Git 写权限：${label}`)
  console.log(kv([
    ['原因', p.reason],
    ['来源', p.source],
    ['探测时间', p.checkedAt ? fmtTime(p.checkedAt) : '—']
  ]))
  if (p.mode === 'unknown') {
    next('flowlark git permission --refresh   ' + c.dim('联网探测远端是否可写'))
  }
}

/** 一条命令把仓库纳入 Git：init + 配置 + 身份 + 首次提交 */
export async function setup(pos, values) {
  const h = hub()
  const r = h.gitInit({
    name: values.name && values.name[0],
    email: values.email && values.email[0],
    message: values.message && values.message[0],
    remote: values.remote && values.remote[0]
  })
  if (values.json) return void console.log(JSON.stringify(r, null, 2))

  console.log('')
  for (const s2 of r.steps) {
    console.log(`  ${s2.ok ? c.green('✓') : c.yellow('!')} ${s2.name}${s2.detail ? c.dim('  ' + s2.detail) : ''}`)
  }
  console.log('')
  if (r.needIdentity) {
    warn('还差提交身份')
    next('flowlark git whoami --name "你的名字" --email "你的邮箱"')
    process.exitCode = 1
    return
  }
  ok(r.committed ? '已纳入 Git 管理' : '仓库已就绪')
  if (!h.gitRemote()) next('flowlark remote <地址>   ' + c.dim('配置远端后就能推送'))
}

/** 看/改提交身份。git config 那两条命令用户记不住，也没必要记 */
export async function whoami(pos, values) {
  const h = hub()
  const wantsSet = values.name || values.email
  if (!wantsSet) {
    const who = h.gitIdentity()
    if (values.json) return void console.log(JSON.stringify(who, null, 2))
    if (!who.complete) {
      warn('还没有配置提交身份，Git 会拒绝提交')
      next('flowlark git whoami --name "你的名字" --email "你的邮箱"')
      process.exitCode = 1
      return
    }
    return void kv([['姓名', who.name], ['邮箱', who.email]])
  }
  const r = h.gitSetIdentity({
    name: values.name && values.name[0],
    email: values.email && values.email[0],
    global: !!values.global
  })
  if (values.json) return void console.log(JSON.stringify(r, null, 2))
  ok(`已设置${r.fields.join('和')}（${r.scope}）`)
}

/** 在编辑器里改好了冲突文件，登记为已解决 */
export async function resolved(pos, values) {
  const h = hub()
  const list = pos.length ? pos : h.gitConflicts().map((x) => x.path)
  if (!list.length) throw err.bad('NO_CONFLICT', '当前没有处于冲突状态的文件')
  const r = h.gitMarkResolved(list)
  if (values.json) return void console.log(JSON.stringify(r, null, 2))
  ok(`已登记 ${r.files.length} 个文件为已解决`)
  const left = h.gitConflicts()
  if (left.length) {
    console.log(c.dim(`  还剩 ${left.length} 个`))
    next('flowlark resolve')
  } else {
    next('flowlark git continue')
  }
}

/** 冲突处理完，让这次同步走完 */
export async function continueCmd(pos, values) {
  const h = hub()
  const r = h.gitContinue()
  if (values.json) return void console.log(JSON.stringify(r, null, 2))
  if (r.conflicts && r.conflicts.length) {
    warn(r.message)
    next('flowlark resolve')
    process.exitCode = 1
    return
  }
  ok(r.message)
  const st = h.gitStatus()
  if (st.hasRemote && st.ahead) next('flowlark sync   ' + c.dim('把结果推给团队'))
}

/** 放弃这次同步，回到之前的状态 */
export async function abort(pos, values) {
  const h = hub()
  const r = h.gitAbort()
  if (values.json) return void console.log(JSON.stringify(r, null, 2))
  if (!r.aborted) return void info(r.message)
  ok(r.message)
}

/**
 * 生成交给 AI 助理的说明。
 *
 * 直接打到 stdout，方便 `flowlark git brief | pbcopy`，
 * 或者 `flowlark git brief > 交给助理.md`。
 */
export async function brief(pos, values) {
  const h = hub()
  const r = h.gitBrief(pos[0] || (values.intent && values.intent[0]))
  if (values.json) return void console.log(JSON.stringify(r, null, 2))
  console.log(r.text)
}
