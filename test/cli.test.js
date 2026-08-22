import { test, describe, after } from 'node:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CLI, html, cleanup } from './helpers.js'

/**
 * 真实跑 CLI 进程。不 mock —— 参数解析、退出码、输出格式这些恰恰是
 * 单元测试覆盖不到、又最容易在真实使用中翻车的地方。
 */

const dirs = []
after(() => dirs.forEach(cleanup))

function workspace() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-cli-'))
  dirs.push(dir)
  return dir
}

function ph(cwd, ...args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1', FLOWLARK_USER: '测试用户', FLOWLARK_REPO: '' }
  })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' }
}

function writeProto(dir, name, body = 'hi', extra = '') {
  const p = path.join(dir, name)
  fs.writeFileSync(p, html(body, extra), 'utf8')
  return p
}

describe('CLI 全流程', () => {
  test('init → new → add → baseline → ls 完整走通', (t) => {
    const dir = workspace()

    let r = ph(dir, 'init')
    t.assert.strictEqual(r.code, 0, r.err)
    t.assert.ok(fs.existsSync(path.join(dir, 'flowlark.json')))
    t.assert.ok(fs.existsSync(path.join(dir, '.gitattributes')), '应生成 .gitattributes')

    r = ph(dir, 'new', '订单中心重构', '--code', 'order-center')
    t.assert.strictEqual(r.code, 0, r.err)
    t.assert.match(r.out, /order-center/)

    writeProto(dir, 'proto-v1.0.html', '首版')
    r = ph(dir, 'add', 'proto-v1.0.html', '-p', 'order-center', '-n', 'v1.0', '-t', '首版原型')
    t.assert.strictEqual(r.code, 0, r.err)
    t.assert.match(r.out, /v1\.0/)
    // 没有变更日志时应该提醒，这是设为基线的前置条件
    t.assert.match(r.out, /设为基线前需要至少 1 条|0 条/)

    r = ph(dir, 'baseline', 'order-center', 'v1.0')
    t.assert.strictEqual(r.code, 0, r.err)
    t.assert.strictEqual(fs.readFileSync(path.join(dir, 'projects/order-center/BASELINE'), 'utf8'), 'v1.0\n')

    r = ph(dir, 'ls', 'order-center')
    t.assert.strictEqual(r.code, 0, r.err)
    t.assert.match(r.out, /当前基线/)
    t.assert.match(r.out, /v1\.0/)
  })

  test('-m 解析：类型:位置:说明:需求号', (t) => {
    const dir = workspace()
    ph(dir, 'init')
    ph(dir, 'new', '订单', '--code', 'ord')
    writeProto(dir, 'a.html')

    const r = ph(dir, 'add', 'a.html', '-p', 'ord', '-n', 'v1.0', '-t', '首版',
      '-m', '新增:订单列表-工具栏:新增批量关闭按钮:REQ-0275',
      '-m', '修改:筛选区:压缩为一行')
    t.assert.strictEqual(r.code, 0, r.err)

    const v = JSON.parse(ph(dir, 'show', 'ord', 'v1.0', '--json').out)
    t.assert.strictEqual(v.changes.length, 2)
    t.assert.deepStrictEqual(v.changes[0], {
      type: 'ADD',
      location: '订单列表-工具栏',
      content: '新增批量关闭按钮',
      requirement: 'REQ-0275'
    })
    t.assert.strictEqual(v.changes[1].type, 'MODIFY')
    t.assert.strictEqual(v.changes[1].requirement, '')
  })

  test('说明里含冒号不会被误切', (t) => {
    const dir = workspace()
    ph(dir, 'init'); ph(dir, 'new', '订单', '--code', 'ord')
    writeProto(dir, 'a.html')
    ph(dir, 'add', 'a.html', '-p', 'ord', '-n', 'v1.0', '-t', 'x',
      '-m', '修改:头部:时间格式改为 HH:mm:ss')
    const v = JSON.parse(ph(dir, 'show', 'ord', 'v1.0', '--json').out)
    t.assert.strictEqual(v.changes[0].content, '时间格式改为 HH:mm:ss')
  })

  test('R6 拦截会给出可执行的下一步，而不是只报错', (t) => {
    const dir = workspace()
    ph(dir, 'init'); ph(dir, 'new', '订单', '--code', 'ord')
    writeProto(dir, 'a.html'); writeProto(dir, 'b.html')
    ph(dir, 'add', 'a.html', '-p', 'ord', '-n', 'v1.0', '-t', '首版')
    ph(dir, 'baseline', 'ord', 'v1.0')
    ph(dir, 'add', 'b.html', '-p', 'ord', '-n', 'v1.1', '-t', '二版')

    const r = ph(dir, 'baseline', 'ord', 'v1.1')
    t.assert.strictEqual(r.code, 1)
    t.assert.match(r.err, /变更日志为空/)
    t.assert.match(r.err, /flowlark add-change|flowlark change|-m/, '错误提示要告诉用户怎么修')
  })

  test('单项目仓库可省略 -p', (t) => {
    const dir = workspace()
    ph(dir, 'init'); ph(dir, 'new', '订单', '--code', 'ord')
    writeProto(dir, 'a.html')
    const r = ph(dir, 'add', 'a.html', '-n', 'v1.0', '-t', '首版')
    t.assert.strictEqual(r.code, 0, r.err)
  })

  test('多项目时省略 -p 会明确报错并列出可选项', (t) => {
    const dir = workspace()
    ph(dir, 'init')
    ph(dir, 'new', '订单', '--code', 'ord')
    ph(dir, 'new', '营销', '--code', 'mkt')
    writeProto(dir, 'a.html')
    const r = ph(dir, 'add', 'a.html', '-n', 'v1.0', '-t', 'x')
    t.assert.strictEqual(r.code, 1)
    t.assert.match(r.err, /ord/)
    t.assert.match(r.err, /mkt/)
  })

  test('版本号能从文件名推断', (t) => {
    const dir = workspace()
    ph(dir, 'init'); ph(dir, 'new', '订单', '--code', 'ord')
    writeProto(dir, '订单中心_v1.4.html')
    ph(dir, 'add', '订单中心_v1.4.html', '-t', '推断测试')
    const list = JSON.parse(ph(dir, 'ls', 'ord', '--json').out)
    t.assert.strictEqual(list.versions[0].versionNo, 'v1.4')
  })

  test('在子目录里执行命令也能找到仓库', (t) => {
    const dir = workspace()
    ph(dir, 'init'); ph(dir, 'new', '订单', '--code', 'ord')
    const sub = path.join(dir, 'a', 'b')
    fs.mkdirSync(sub, { recursive: true })
    const r = ph(sub, 'ls')
    t.assert.strictEqual(r.code, 0, r.err)
    t.assert.match(r.out, /ord/)
  })

  test('不在仓库里时给出明确指引', (t) => {
    const dir = workspace()
    const r = ph(dir, 'ls')
    t.assert.strictEqual(r.code, 1)
    t.assert.match(r.err, /flowlark init/)
  })

  test('未知命令返回 127 并提示可用命令', (t) => {
    const dir = workspace()
    const r = ph(dir, 'nosuchcmd')
    t.assert.strictEqual(r.code, 127)
    t.assert.match(r.err, /未知命令/)
  })

  test('diff 输出累计变更与热点', (t) => {
    const dir = workspace()
    ph(dir, 'init'); ph(dir, 'new', '订单', '--code', 'ord')
    writeProto(dir, 'a.html'); writeProto(dir, 'b.html'); writeProto(dir, 'c.html')
    ph(dir, 'add', 'a.html', '-n', 'v1.0', '-t', '首版')
    ph(dir, 'baseline', 'ord', 'v1.0')
    ph(dir, 'add', 'b.html', '-n', 'v1.1', '-t', '二版', '-m', '修改:筛选区:压缩一行')
    ph(dir, 'add', 'c.html', '-n', 'v1.2', '-t', '三版',
      '-m', '修改:筛选区:条件保留', '-m', '修改:筛选区:更多筛选', '-m', '新增:表格:排序')

    const r = ph(dir, 'diff', 'ord', '--from', 'v1.0', '--to', 'v1.2')
    t.assert.strictEqual(r.code, 0, r.err)
    t.assert.match(r.out, /共 4 条变更/)
    t.assert.match(r.out, /反复修改的区域/)
    t.assert.match(r.out, /筛选区 — 改了 3 次/)
  })

  test('rm → trash → restore', (t) => {
    const dir = workspace()
    ph(dir, 'init'); ph(dir, 'new', '订单', '--code', 'ord')
    writeProto(dir, 'a.html'); writeProto(dir, 'b.html')
    ph(dir, 'add', 'a.html', '-n', 'v1.0', '-t', '首版')
    ph(dir, 'add', 'b.html', '-n', 'v1.1', '-t', '二版')

    t.assert.strictEqual(ph(dir, 'rm', 'ord', 'v1.1').code, 0)
    t.assert.match(ph(dir, 'trash').out, /v1\.1/)
    t.assert.strictEqual(ph(dir, 'restore', 'ord', 'v1.1').code, 0)
    t.assert.match(ph(dir, 'ls', 'ord').out, /v1\.1/)
  })

  test('spec 导入与读取', (t) => {
    const dir = workspace()
    ph(dir, 'init'); ph(dir, 'new', '订单', '--code', 'ord')
    writeProto(dir, 'a.html')
    ph(dir, 'add', 'a.html', '-n', 'v1.0', '-t', '首版')

    const specFile = path.join(dir, 'spec.md')
    fs.writeFileSync(specFile, '# 订单列表\n\n状态筛选改为多选。\n', 'utf8')
    t.assert.strictEqual(ph(dir, 'spec', 'ord', 'v1.0', '-f', specFile).code, 0)
    t.assert.match(ph(dir, 'spec', 'ord', 'v1.0').out, /状态筛选改为多选/)
    t.assert.ok(fs.existsSync(path.join(dir, 'projects/ord/versions/v1.0.spec.md')))
  })

  test('status 报告缺基线的项目', (t) => {
    const dir = workspace()
    ph(dir, 'init'); ph(dir, 'new', '订单', '--code', 'ord')
    writeProto(dir, 'a.html')
    ph(dir, 'add', 'a.html', '-n', 'v1.0', '-t', '首版')
    const r = ph(dir, 'status')
    t.assert.match(r.out, /还没有基线/)
  })

  test('--json 输出可被机器解析', (t) => {
    const dir = workspace()
    ph(dir, 'init'); ph(dir, 'new', '订单', '--code', 'ord')
    const projects = JSON.parse(ph(dir, 'ls', '--json').out)
    t.assert.strictEqual(projects.length, 1)
    t.assert.strictEqual(projects[0].slug, 'ord')
  })
})
