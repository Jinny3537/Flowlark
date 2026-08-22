import fs from 'node:fs'
import path from 'node:path'
import { err } from '../core/errors.js'
import * as cfgSchema from '../core/config.js'
import { GROUPS } from '../core/config.js'
import * as net from '../core/net.js'
import { hub, resolveProject } from './commands.js'
import { c, table, kv, fmtSize, fmtTime, ok, info, warn, next } from './ui.js'

/**
 * 系统配置、远端、附件、局域网相关命令。
 */

// ==================== config ====================

export async function config(pos, values) {
  const h = hub()

  // flowlark config —— 列出全部
  if (pos.length === 0 && !values.edit) {
    const items = h.listConfig()
    if (values.json) return void console.log(JSON.stringify(items, null, 2))

    for (const g of GROUPS) {
      const group = items.filter((i) => i.group === g.key)
      if (!group.length) continue
      console.log('\n' + c.bold(g.label))
      console.log(table(
        ['配置项', '当前值', '说明'],
        group.map((i) => [
          c.cyan(i.key) + (i.danger ? ' ' + c.red('!') : ''),
          i.isDefault ? c.dim(cfgSchema.displayValue(i)) : c.bold(cfgSchema.displayValue(i)),
          c.dim(i.label)
        ])
      ))
    }

    const problems = h.configProblems()
    if (problems.length) {
      console.log('')
      for (const p of problems) warn(p)
    }
    console.log('')
    console.log(c.dim('  加粗的是改过的值；' + c.red('!') + ' 标记的是高风险开关'))
    next(
      'flowlark config <配置项>           ' + c.dim('查看单项详情'),
      'flowlark config <配置项> <值>       ' + c.dim('修改'),
      'flowlark config --edit             ' + c.dim('用编辑器改整个配置文件')
    )
    return
  }

  // flowlark config --edit
  if (values.edit) {
    const { spawnSync } = await import('node:child_process')
    const file = path.join(h.root, 'flowlark.json')
    const editor = process.env.VISUAL || process.env.EDITOR || 'vi'
    const r = spawnSync(editor, [file], { stdio: 'inherit' })
    if (r.status !== 0) return warn('编辑器异常退出')
    // 重新加载校验一遍，语法或取值写错要立刻告诉用户
    try {
      const fresh = hub()
      const problems = fresh.configProblems()
      if (problems.length) {
        for (const p of problems) warn(p)
      } else {
        ok('配置已保存')
      }
    } catch (e) {
      throw err.bad('CONFIG_BROKEN', `配置文件解析失败：${e.message}`, '检查 flowlark.json 的 JSON 语法')
    }
    return
  }

  const key = pos[0]
  const schema = cfgSchema.describe(key)
  if (!schema) {
    throw err.bad('UNKNOWN_CONFIG_KEY', `没有这个配置项：${key}`,
      '看看有哪些：flowlark config')
  }

  // flowlark config <key> —— 查看单项
  if (pos.length === 1 && !values.clear) {
    const item = h.listConfig().find((i) => i.key === key)
    if (values.json) return void console.log(JSON.stringify(item, null, 2))
    console.log(c.bold(schema.label))
    console.log(kv([
      ['配置项', c.cyan(key)],
      ['当前值', cfgSchema.displayValue(item)],
      ['默认值', item.isDefault ? c.dim('（就是默认值）') : String(schema.default)],
      ['类型', schema.type + (schema.enum ? `（${schema.enum.join(' / ')}）` : '')]
    ]))
    if (schema.note) console.log('\n  ' + c.dim(schema.note))
    if (schema.danger) console.log('\n  ' + c.red('这是高风险开关，改之前请读上面的说明'))
    return
  }

  // flowlark config <key> --clear —— 恢复默认
  if (values.clear) {
    const r = h.resetConfig(key)
    ok(`${c.cyan(key)} 已恢复默认值：${JSON.stringify(r.value)}`)
    if (r.needsRestart) info('服务相关配置需要重启 flowlark serve 才生效')
    return
  }

  // flowlark config <key> <value>
  const raw = pos.slice(1).join(' ')
  const r = h.setConfig(key, raw)
  ok(`${c.cyan(key)} = ${c.bold(JSON.stringify(r.value))}`)
  for (const s of r.sideEffects || []) info(s)
  for (const p of r.problems || []) warn(p)
  if (r.needsRestart) info('服务相关配置需要重启 flowlark serve 才生效')
  if (schema.danger && r.value === false) {
    console.log('  ' + c.red('注意：') + c.dim(schema.note))
  }
}

// ==================== remote ====================

export async function remote(pos, values) {
  const h = hub()

  if (values.clear) {
    h.gitRemoveRemote()
    return void ok('已移除远端')
  }

  if (pos.length === 0) {
    const r = h.gitRemote()
    if (values.json) return void console.log(JSON.stringify(r, null, 2))
    if (!r) {
      info('还没有配置远端')
      return next(
        'flowlark remote <地址>   ' + c.dim('如 git@github.com:team/prototypes.git'),
        c.dim('配置后 flowlark sync 就会自动推送')
      )
    }
    console.log(kv([['远端', c.cyan(r.name)], ['地址', r.url]]))
    const st = h.gitStatus()
    if (st.tracked) {
      console.log(kv([
        ['分支', st.branch || '—'],
        ['同步状态', st.ahead || st.behind
          ? `${st.ahead ? `领先 ${st.ahead} ` : ''}${st.behind ? `落后 ${st.behind}` : ''}`.trim()
          : '已同步']
      ]))
    }
    return
  }

  const url = pos[0]
  const r = h.gitSetRemote(url)
  ok(`${r.message}：${c.cyan(r.url)}`)
  next('flowlark sync   ' + c.dim('首次推送会自动建立上游分支'))
}

// ==================== attach ====================

export async function attach(pos, values) {
  const h = hub()
  const slug = resolveProject(h, pos[0])
  const versionNo = pos[1] || h.getProject(slug).baselineVersionNo
  if (!versionNo) throw err.bad('VERSION_REQUIRED', '请指定版本号')

  // 删除
  if (values.clear) {
    const name = pos[2]
    if (!name) throw err.bad('NAME_REQUIRED', '请指定要删除的附件名')
    const v = h.removeAttachment(slug, versionNo, name)
    return void ok(`已删除附件 ${name}，${versionNo} 现有 ${v.attachments.length} 个附件`)
  }

  const files = pos.slice(2)

  // 列出
  if (files.length === 0) {
    const v = h.getVersion(slug, versionNo)
    if (values.json) return void console.log(JSON.stringify(v.attachments, null, 2))
    if (v.attachments.length === 0) {
      info(`${versionNo} 还没有附件`)
      return next(`flowlark attach ${slug} ${versionNo} ./需求文档.pdf`)
    }
    console.log(c.bold(`${slug} / ${versionNo}`) + c.dim('  的附件'))
    console.log('')
    console.log(table(
      ['文件', '大小', '添加时间', '添加人'],
      v.attachments.map((a) => [
        (a.missing ? c.red('✗ ') : '') + a.name,
        fmtSize(a.size),
        c.dim(fmtTime(a.addedAt)),
        c.dim(a.addedBy || '—')
      ]),
      { aligns: ['left', 'right'] }
    ))
    if (v.attachments.some((a) => a.missing)) {
      console.log('')
      warn('标 ✗ 的文件在磁盘上不存在，可能被手工删掉了')
    }
    console.log('')
    console.log(c.dim(`  存放位置：projects/${slug}/versions/${versionNo}.files/`))
    console.log(c.dim('  附件随 Git 一起提交，flowlark sync 就会推送给团队'))
    return
  }

  // 添加
  let v
  for (const f of files) {
    const abs = path.resolve(f)
    if (!fs.existsSync(abs)) throw err.notFound(`文件 ${f}`)
    v = h.addAttachment(slug, versionNo, { sourcePath: abs })
    ok(`已添加 ${c.bold(path.basename(abs))}（${fmtSize(fs.statSync(abs).size)}）`)
  }
  console.log(c.dim(`  ${versionNo} 现有 ${v.attachments.length} 个附件`))
  next('flowlark sync   ' + c.dim('提交并推送给团队'))
}

// ==================== lan ====================

/** 局域网状态一览：开没开、同事该访问哪个地址、写操作放不放行 */
export async function lan(pos, values) {
  const h = hub()
  const s = h.settings

  if (pos.length > 0) {
    const on = ['on', 'true', '1', '开', 'yes'].includes(String(pos[0]).toLowerCase())
    const off = ['off', 'false', '0', '关', 'no'].includes(String(pos[0]).toLowerCase())
    if (!on && !off) {
      throw err.bad('BAD_ARG', `不认识的参数「${pos[0]}」`, '用法：flowlark lan on / off')
    }
    const r = h.setConfig('server.lan', on)
    ok(`局域网访问已${on ? c.green('开启') : c.dim('关闭')}`)
    for (const p of r.problems || []) warn(p)
    if (on) {
      const addrs = net.lanAddresses()
      if (addrs.length === 0) {
        warn('没有检测到局域网地址，可能没连网络')
      } else {
        console.log('')
        console.log('  同事可以访问：')
        for (const a of addrs) {
          console.log(`    ${c.cyan(`http://${a.address}:${s.server.port}`)}  ${c.dim(a.iface)}`)
        }
      }
      console.log('')
      if (s.server.readonlyFromLan) {
        console.log('  ' + c.dim('局域网来的请求只能读；写操作仅限本机。这是默认的保护。'))
      } else {
        warn('只读保护是关闭的 —— 同网段任何人都能删版本、改基线')
      }
    }
    info('需要重启 flowlark serve 才生效')
    return
  }

  const addrs = net.lanAddresses()
  const data = {
    enabled: s.server.lan,
    readonlyFromLan: s.server.readonlyFromLan,
    port: s.server.port,
    previewPort: s.server.previewPort,
    addresses: addrs
  }
  if (values.json) return void console.log(JSON.stringify(data, null, 2))

  console.log(kv([
    ['局域网访问', s.server.lan ? c.green('已开启') : c.dim('未开启')],
    ['写操作', s.server.readonlyFromLan ? '仅限本机' : c.red('局域网也可写')],
    ['工作台端口', String(s.server.port)],
    ['预览端口', String(s.server.previewPort)]
  ]))

  if (addrs.length) {
    console.log('')
    console.log('  本机的局域网地址：')
    for (const a of addrs) {
      console.log(`    ${s.server.lan ? c.cyan(`http://${a.address}:${s.server.port}`) : c.dim(a.address)}  ${c.dim(a.iface)}`)
    }
  }

  if (!s.server.lan) {
    next('flowlark lan on   ' + c.dim('开放给同网段的同事访问'))
  } else {
    console.log('')
    console.log(c.dim('  防火墙可能仍会拦截，同事连不上时先检查这一项'))
  }
}
