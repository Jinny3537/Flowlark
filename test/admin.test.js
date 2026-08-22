import { test, describe, after } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { newHub, html, throwsCode, cleanup } from './helpers.js'
import { findRepoRoot } from '../src/core/repo.js'
import * as cfg from '../src/core/config.js'
import * as net from '../src/core/net.js'
import * as store from '../src/core/store.js'

const dirs = []
after(() => dirs.forEach(cleanup))

function repo() {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单中心', code: 'ord' })
  hub.addVersion('ord', { versionNo: 'v1.0', title: '首版', html: html() })
  hub.setBaseline('ord', 'v1.0')
  return { root, hub }
}

// ============================================================
describe('配置中心', () => {
  test('schema 覆盖四个分组，每项都有标签', (t) => {
    for (const s of cfg.SCHEMA) {
      t.assert.ok(s.label, `${s.key} 缺少 label`)
      t.assert.ok(cfg.GROUPS.some((g) => s.key.startsWith(g.key + '.')), `${s.key} 不属于任何分组`)
    }
  })

  test('老仓库的扁平配置自动迁移', (t) => {
    const s = cfg.normalize({ port: 9000, previewPort: 9001, maxFileBytes: 5242880 })
    t.assert.strictEqual(s.server.port, 9000)
    t.assert.strictEqual(s.server.previewPort, 9001)
    t.assert.strictEqual(s.server.maxFileBytes, 5242880)
    t.assert.strictEqual(s.port, undefined, '旧的扁平键应被清掉')
  })

  test('缺失项用默认值补齐，不需要迁移脚本', (t) => {
    const s = cfg.normalize({})
    t.assert.strictEqual(s.rules.requireChangelog, true)
    t.assert.strictEqual(s.ui.dateStyle, 'relative')
    t.assert.deepStrictEqual(s.ui.defaultTags, [])
  })

  test('类型转换：bool / bytes / list / enum', (t) => {
    t.assert.strictEqual(cfg.coerce('server.lan', '是'), true)
    t.assert.strictEqual(cfg.coerce('server.lan', 'off'), false)
    t.assert.strictEqual(cfg.coerce('server.maxFileBytes', '20MB'), 20 * 1024 * 1024)
    t.assert.deepStrictEqual(cfg.coerce('ui.defaultTags', '已评审，已交付'), ['已评审', '已交付'])
    throwsCode(t, 'BAD_CONFIG_VALUE', () => cfg.coerce('ui.dateStyle', 'nope'))
    throwsCode(t, 'BAD_CONFIG_VALUE', () => cfg.coerce('server.port', '70000'))
    throwsCode(t, 'UNKNOWN_CONFIG_KEY', () => cfg.coerce('no.such.key', '1'))
  })

  test('跨字段校验：两个端口撞一起会被指出来', (t) => {
    // 撞了之后沙箱隔离就失效了，这是必须拦住的组合
    const problems = cfg.validateAll(cfg.normalize({ server: { port: 7788, previewPort: 7788 } }))
    t.assert.ok(problems.some((p) => p.includes('端口')))
  })

  test('跨字段校验：开了局域网又关掉只读会被警告', (t) => {
    const problems = cfg.validateAll(cfg.normalize({ server: { lan: true, readonlyFromLan: false } }))
    t.assert.ok(problems.some((p) => p.includes('局域网')))
  })

  test('需求链接模板缺 {code} 会被指出来', (t) => {
    const problems = cfg.validateAll(cfg.normalize({ ui: { requirementUrlTemplate: 'https://x/browse/' } }))
    t.assert.ok(problems.some((p) => p.includes('{code}')))
  })

  test('改配置会落盘并立刻生效', (t) => {
    const { root, hub } = repo()
    const r = hub.setConfig('server.maxFileBytes', '50MB')
    t.assert.strictEqual(r.value, 50 * 1024 * 1024)
    t.assert.strictEqual(r.needsRestart, true, '服务类配置要提示重启')

    const onDisk = JSON.parse(fs.readFileSync(path.join(root, 'flowlark.json'), 'utf8'))
    t.assert.strictEqual(onDisk.settings.server.maxFileBytes, 50 * 1024 * 1024)
  })

  test('恢复默认值', (t) => {
    const { hub } = repo()
    hub.setConfig('ui.dateStyle', 'absolute')
    t.assert.strictEqual(hub.getConfig('ui.dateStyle'), 'absolute')
    hub.resetConfig('ui.dateStyle')
    t.assert.strictEqual(hub.getConfig('ui.dateStyle'), 'relative')
  })
})

// ============================================================
describe('更名后的老仓库', () => {
  test('自动识别 protohub.json 并改名，数据完整保留', (t) => {
    // 产品从 protohub 改名为 Flowlark。老仓库直接报「不是仓库」的话，
    // 用户完全不知道发生了什么
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-legacy-'))
    dirs.push(dir)
    fs.mkdirSync(path.join(dir, '.protohub', 'cache'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'projects'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'protohub.json'), JSON.stringify({
      schemaVersion: 1,
      name: '老仓库',
      createdAt: new Date().toISOString(),
      settings: { port: 9001, previewPort: 9002, maxFileBytes: 5242880 }
    }, null, 2))
    fs.writeFileSync(path.join(dir, '.protohub', 'oplog.ndjson'), '{"action":"X"}\n')

    const root = findRepoRoot(dir)
    t.assert.strictEqual(root, dir, '应能识别老仓库')
    t.assert.ok(fs.existsSync(path.join(dir, 'flowlark.json')), '配置文件应已改名')
    t.assert.ok(fs.existsSync(path.join(dir, '.flowlark')), '内部目录应已改名')
    t.assert.ok(!fs.existsSync(path.join(dir, 'protohub.json')), '老文件不该还在')

    // 内容一字不改地搬过去
    const conf = JSON.parse(fs.readFileSync(path.join(dir, 'flowlark.json'), 'utf8'))
    t.assert.strictEqual(conf.name, '老仓库')
    t.assert.strictEqual(conf.settings.port, 9001)
    t.assert.match(fs.readFileSync(path.join(dir, '.flowlark/oplog.ndjson'), 'utf8'), /"X"/)
  })

  test('新旧名并存时保留新的，不静默覆盖', (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-legacy-'))
    dirs.push(dir)
    fs.writeFileSync(path.join(dir, 'flowlark.json'), '{"name":"新的","schemaVersion":1}')
    fs.writeFileSync(path.join(dir, 'protohub.json'), '{"name":"老的","schemaVersion":1}')

    findRepoRoot(dir)
    t.assert.strictEqual(
      JSON.parse(fs.readFileSync(path.join(dir, 'flowlark.json'), 'utf8')).name, '新的')
    t.assert.ok(fs.existsSync(path.join(dir, 'protohub.json')), '老文件原地保留，交给用户处置')
  })

  test('老的环境变量仍然生效', (t) => {
    const { root } = repo()
    const saved = process.env.FLOWLARK_REPO
    delete process.env.FLOWLARK_REPO
    process.env.PROTOHUB_REPO = root
    try {
      t.assert.strictEqual(findRepoRoot('/tmp'), root)
    } finally {
      delete process.env.PROTOHUB_REPO
      if (saved !== undefined) process.env.FLOWLARK_REPO = saved
    }
  })
})

// ============================================================
describe('业务规则开关', () => {
  test('关掉 R6 后无变更日志也能设为基线', (t) => {
    const { hub } = repo()
    hub.addVersion('ord', { versionNo: 'v1.1', title: '二版', html: html() })
    throwsCode(t, 'CHANGELOG_REQUIRED', () => hub.setBaseline('ord', 'v1.1'))

    hub.setConfig('rules.requireChangelog', 'false')
    t.assert.strictEqual(hub.setBaseline('ord', 'v1.1').isBaseline, true)
  })

  test('关掉 R4 后基线内容可改', (t) => {
    const { hub } = repo()
    throwsCode(t, 'VERSION_LOCKED', () => hub.updateVersion('ord', 'v1.0', { title: 'x' }))

    hub.setConfig('rules.lockBaseline', 'false')
    t.assert.strictEqual(hub.updateVersion('ord', 'v1.0', { title: '改过了' }).title, '改过了')
  })

  test('两个开关默认都是开的', (t) => {
    const { hub } = repo()
    t.assert.strictEqual(hub.getConfig('rules.requireChangelog'), true)
    t.assert.strictEqual(hub.getConfig('rules.lockBaseline'), true)
  })
})

// ============================================================
describe('局域网访问控制', () => {
  const fakeReq = (addr) => ({ socket: { remoteAddress: addr } })

  test('识别本机来源，包括 IPv4-mapped IPv6', (t) => {
    // 双栈机器上本机请求常表现为 ::ffff:127.0.0.1，漏掉就会把本机误判成外部
    for (const a of ['127.0.0.1', '::1', '::ffff:127.0.0.1', '127.0.0.53']) {
      t.assert.strictEqual(net.isLocalRequest(fakeReq(a)), true, a)
    }
    for (const a of ['192.168.1.20', '10.0.0.5', '::ffff:192.168.1.20', '172.17.0.2']) {
      t.assert.strictEqual(net.isLocalRequest(fakeReq(a)), false, a)
    }
  })

  test('写方法判定', (t) => {
    for (const m of ['POST', 'PUT', 'PATCH', 'DELETE', 'delete']) {
      t.assert.strictEqual(net.isWrite(m), true, m)
    }
    for (const m of ['GET', 'HEAD', 'OPTIONS']) {
      t.assert.strictEqual(net.isWrite(m), false, m)
    }
  })

  test('放行矩阵穷举', (t) => {
    // 沙箱里造不出真正的非回环来源，所以把判定抽成纯函数穷举
    const cases = [
      // 没开局域网：只监听回环，一律放行
      [{ lan: false, readonlyFromLan: true, isLocal: true }, true],
      [{ lan: false, readonlyFromLan: true, isLocal: false }, true],
      // 开了局域网 + 只读：只有本机能写
      [{ lan: true, readonlyFromLan: true, isLocal: true }, true],
      [{ lan: true, readonlyFromLan: true, isLocal: false }, false],
      // 开了局域网 + 显式关掉保护：都能写
      [{ lan: true, readonlyFromLan: false, isLocal: false }, true]
    ]
    for (const [input, expect] of cases) {
      t.assert.strictEqual(net.allowWrite(input), expect, JSON.stringify(input))
    }
  })

  test('读操作永不被拦', (t) => {
    t.assert.strictEqual(
      net.shouldBlockWrite({ lan: true, readonlyFromLan: true, isLocal: false, method: 'GET' }),
      false)
    t.assert.strictEqual(
      net.shouldBlockWrite({ lan: true, readonlyFromLan: true, isLocal: false, method: 'DELETE' }),
      true)
  })

  test('监听地址随开关变化', (t) => {
    t.assert.strictEqual(net.bindHost(false), '127.0.0.1')
    t.assert.strictEqual(net.bindHost(true), '0.0.0.0')
  })

  test('局域网地址发现不含回环，且家用网段排前面', (t) => {
    const addrs = net.lanAddresses()
    t.assert.ok(Array.isArray(addrs))
    for (const a of addrs) {
      t.assert.ok(!/^127\./.test(a.address), '不该包含回环地址')
      t.assert.ok(a.iface, '要带网卡名，便于用户判断是不是虚拟网卡')
    }
  })
})

// ============================================================
describe('版本附件', () => {
  test('添加、列出、读取、删除', (t) => {
    const { hub } = repo()
    let v = hub.addAttachment('ord', 'v1.0', { name: '需求文档.md', content: '# PRD\n内容' })
    t.assert.strictEqual(v.attachments.length, 1)
    t.assert.strictEqual(v.attachments[0].name, '需求文档.md')
    t.assert.strictEqual(v.attachments[0].contentType, 'text/markdown; charset=utf-8')

    const { buf } = hub.readAttachment('ord', 'v1.0', '需求文档.md')
    t.assert.match(buf.toString('utf8'), /# PRD/)

    v = hub.removeAttachment('ord', 'v1.0', '需求文档.md')
    t.assert.strictEqual(v.attachments.length, 0)
  })

  test('附件不受基线锁定 —— 和规格书同理', (t) => {
    // v1.0 是基线，改标题会被拒；但事后补一份评审纪要是常态
    const { hub } = repo()
    throwsCode(t, 'VERSION_LOCKED', () => hub.updateVersion('ord', 'v1.0', { title: 'x' }))
    const v = hub.addAttachment('ord', 'v1.0', { name: '评审纪要.md', content: 'ok' })
    t.assert.strictEqual(v.attachments.length, 1)
  })

  test('同名附件视为覆盖，不产生两条记录', (t) => {
    const { hub } = repo()
    hub.addAttachment('ord', 'v1.0', { name: 'a.md', content: '第一版' })
    const v = hub.addAttachment('ord', 'v1.0', { name: 'a.md', content: '第二版内容更长' })
    t.assert.strictEqual(v.attachments.length, 1)
    t.assert.strictEqual(hub.readAttachment('ord', 'v1.0', 'a.md').buf.toString(), '第二版内容更长')
  })

  test('路径穿越被挡住', (t) => {
    const { root, hub } = repo()
    const v = hub.addAttachment('ord', 'v1.0', { name: '../../../etc/passwd', content: 'x' })
    t.assert.strictEqual(v.attachments[0].name, 'passwd')
    t.assert.ok(fs.existsSync(path.join(root, 'projects/ord/versions/v1.0.files/passwd')))
    t.assert.ok(!fs.existsSync(path.join(root, '../../../etc/passwd')))
  })

  test('超过上限被拒，并提示怎么调大', (t) => {
    const { hub } = repo()
    hub.setConfig('server.maxFileBytes', '1KB')
    const e = throwsCode(t, 'FILE_TOO_LARGE', () =>
      hub.addAttachment('ord', 'v1.0', { name: 'big.bin', content: Buffer.alloc(2048) }))
    t.assert.match(e.hint, /maxFileBytes/)
  })

  test('附件随版本一起进回收站，恢复后仍在', (t) => {
    const { hub } = repo()
    hub.addVersion('ord', { versionNo: 'v1.1', title: '二版', html: html() })
    hub.addAttachment('ord', 'v1.1', { name: 'doc.md', content: '内容' })

    hub.removeVersion('ord', 'v1.1')
    const restored = hub.restoreVersion('ord', 'v1.1')
    t.assert.strictEqual(restored.attachments.length, 1)
    t.assert.strictEqual(hub.readAttachment('ord', 'v1.1', 'doc.md').buf.toString(), '内容')
  })

  test('文件被手工删掉时如实标记，而不是让用户点了才发现', (t) => {
    const { root, hub } = repo()
    hub.addAttachment('ord', 'v1.0', { name: 'doc.md', content: 'x' })
    fs.rmSync(path.join(root, 'projects/ord/versions/v1.0.files/doc.md'))

    const v = hub.getVersion('ord', 'v1.0')
    t.assert.strictEqual(v.attachments[0].missing, true)
  })

  test('附件目录空了会被清理，不留空目录', (t) => {
    const { root, hub } = repo()
    hub.addAttachment('ord', 'v1.0', { name: 'a.md', content: 'x' })
    hub.removeAttachment('ord', 'v1.0', 'a.md')
    t.assert.ok(!fs.existsSync(store.paths.attachments(root, 'ord', 'v1.0')))
  })

  test('附件写进 version.json 且键序稳定', (t) => {
    const { root, hub } = repo()
    hub.addAttachment('ord', 'v1.0', { name: 'a.md', content: 'x' })
    const text = fs.readFileSync(path.join(root, 'projects/ord/versions/v1.0.json'), 'utf8')
    const keys = [...text.matchAll(/^ {6}"([a-zA-Z]+)"/gm)].map((m) => m[1])
    t.assert.deepStrictEqual(keys.slice(0, 5), ['name', 'size', 'contentType', 'addedAt', 'addedBy'])
  })
})

// ============================================================
const hasGit = spawnSync('git', ['--version']).status === 0

describe('Git 远端配置', { skip: hasGit ? false : '环境无 git' }, () => {
  function gitRepo() {
    const { root, hub } = repo()
    spawnSync('git', ['init', '-q'], { cwd: root })
    spawnSync('git', ['config', 'user.email', 't@e.com'], { cwd: root })
    spawnSync('git', ['config', 'user.name', 't'], { cwd: root })
    return { root, hub }
  }

  test('设置、查看、移除远端', (t) => {
    const { hub } = gitRepo()
    t.assert.strictEqual(hub.gitRemote(), null)

    hub.gitSetRemote('https://example.com/team/proto.git')
    t.assert.strictEqual(hub.gitRemote().url, 'https://example.com/team/proto.git')
    t.assert.strictEqual(hub.getConfig('git.remote'), 'https://example.com/team/proto.git',
      '同时要写进 Flowlark 配置，设置页才看得到')

    // 再设一次是改地址，不是报错
    hub.gitSetRemote('git@example.com:team/proto.git')
    t.assert.strictEqual(hub.gitRemote().url, 'git@example.com:team/proto.git')

    hub.gitRemoveRemote()
    t.assert.strictEqual(hub.gitRemote(), null)
  })

  test('非法远端地址被拦截', (t) => {
    const { hub } = gitRepo()
    throwsCode(t, 'REMOTE_URL_INVALID', () => hub.gitSetRemote('随便写点什么'))
    throwsCode(t, 'REMOTE_URL_REQUIRED', () => hub.gitSetRemote('  '))
  })

  test('通过 config 设置远端也会真的写进 git', (t) => {
    const { root, hub } = gitRepo()
    hub.setConfig('git.remote', 'https://example.com/a.git')
    const out = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' })
    t.assert.strictEqual(out.stdout.trim(), 'https://example.com/a.git')
  })

  test('自动设置 core.quotepath=false，让中文文件名在 git 输出里正常显示', (t) => {
    const { root, hub } = gitRepo()
    hub.gitSetRemote('https://example.com/a.git')
    const out = spawnSync('git', ['config', '--local', 'core.quotepath'], { cwd: root, encoding: 'utf8' })
    t.assert.strictEqual(out.stdout.trim(), 'false')
  })

  test('用户已显式设过 quotepath 时不覆盖', (t) => {
    const { root, hub } = gitRepo()
    spawnSync('git', ['config', '--local', 'core.quotepath', 'true'], { cwd: root })
    hub.gitSetRemote('https://example.com/a.git')
    const out = spawnSync('git', ['config', '--local', 'core.quotepath'], { cwd: root, encoding: 'utf8' })
    t.assert.strictEqual(out.stdout.trim(), 'true', '不该覆盖用户的偏好')
  })

  test('提交人身份会写进 git config', (t) => {
    const { root, hub } = gitRepo()
    hub.setConfig('git.userName', '张小雨')
    const out = spawnSync('git', ['config', 'user.name'], { cwd: root, encoding: 'utf8' })
    t.assert.strictEqual(out.stdout.trim(), '张小雨')
  })

  test('推送到本地裸仓库：首次自动建立上游', (t) => {
    const { root, hub } = gitRepo()
    // 用一个本地裸仓库当远端，能真的走完 push 流程而不需要网络
    const bare = root + '-remote.git'
    dirs.push(bare)
    spawnSync('git', ['init', '--bare', '-q', bare])

    hub.gitSetRemote(bare)
    const r = hub.gitSync({ message: '首次推送' })
    t.assert.ok(r.steps.every((s) => s.ok), JSON.stringify(r.steps))
    t.assert.ok(r.steps.some((s) => /建立上游/.test(s.detail)), '首次推送要提示已建立上游')

    // 远端确实收到了
    const log = spawnSync('git', ['log', '--oneline'], { cwd: bare, encoding: 'utf8' })
    t.assert.match(log.stdout, /首次推送/)

    // 第二次推送不再需要 -u
    hub.addAttachment('ord', 'v1.0', { name: 'doc.md', content: 'x' })
    const r2 = hub.gitSync({})
    t.assert.ok(r2.steps.every((s) => s.ok), JSON.stringify(r2.steps))
    const log2 = spawnSync('git', ['log', '--oneline'], { cwd: bare, encoding: 'utf8' })
    t.assert.strictEqual(log2.stdout.trim().split('\n').length, 2)
  })

  test('sync 只提交 Flowlark 自己的文件，不卷走用户放在旁边的草稿', (t) => {
    // 用户常在同一个文件夹里放正在改的原型源文件、临时截图，
    // git add -A 会把它们一并提交 —— 这是意料之外的行为
    const { root, hub } = gitRepo()
    fs.writeFileSync(path.join(root, '我正在改的原型.html'), '<html>草稿</html>')
    fs.writeFileSync(path.join(root, '临时截图.png'), 'x')

    const r = hub.gitSync({ message: '只提交 Flowlark 数据' })
    t.assert.ok(r.steps.every((s) => s.ok), JSON.stringify(r.steps))
    t.assert.ok(r.steps.some((s) => s.name === '跳过'), '应告知用户跳过了哪些文件')

    const tracked = spawnSync('git', ['ls-tree', '-r', '-z', '--name-only', 'HEAD'],
      { cwd: root, encoding: 'utf8' }).stdout
    t.assert.ok(tracked.includes('projects/ord/versions/v1.0.json'), 'Flowlark 数据要提交')
    t.assert.ok(!tracked.includes('我正在改的原型.html'), '用户的草稿不该被提交')
    t.assert.ok(!tracked.includes('临时截图.png'))
  })

  test('旁边有草稿文件时不影响「工作区干净」的判断', (t) => {
    const { root, hub } = gitRepo()
    hub.gitSync({ message: 'init' })
    fs.writeFileSync(path.join(root, '草稿.html'), '<html>x</html>')
    t.assert.strictEqual(hub.gitStatus().clean, true, '同步按钮不该因为旁边的草稿一直亮着')
  })

  test('附件确实被推到了远端', (t) => {
    const { root, hub } = gitRepo()
    const bare = root + '-remote2.git'
    dirs.push(bare)
    spawnSync('git', ['init', '--bare', '-q', bare])
    hub.gitSetRemote(bare)
    hub.addAttachment('ord', 'v1.0', { name: '需求文档.md', content: '# PRD' })
    hub.gitSync({ message: '带附件' })

    // -z 让 git 输出原始文件名，不做八进制转义
    const files = spawnSync('git', ['ls-tree', '-r', '-z', '--name-only', 'HEAD'],
      { cwd: bare, encoding: 'utf8' })
    t.assert.match(files.stdout, /v1\.0\.files\/需求文档\.md/)
  })
})
