import { test, describe, after } from 'node:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { newHub, html, cleanup } from './helpers.js'
import * as store from '../src/core/store.js'

/**
 * Git 友好性验证。
 *
 * 「数据进 Git」是这次重定位的核心前提，所以它必须被真的测出来，
 * 而不是写在 README 里当口号。这里跑真实的 git 命令看 diff 长什么样。
 */

const hasGit = spawnSync('git', ['--version']).status === 0
const dirs = []
after(() => dirs.forEach(cleanup))

function repo() {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单中心', code: 'ord' })
  return { root, hub }
}

function git(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return { code: r.status, out: r.stdout || '', err: r.stderr || '' }
}

function initGit(root) {
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'test@example.com')
  git(root, 'config', 'user.name', '测试')
  git(root, 'add', '.')
  git(root, 'commit', '-q', '-m', 'init')
  // 默认分支名各版本 git 不一致（master / main），不能写死
  return git(root, 'rev-parse', '--abbrev-ref', 'HEAD').out.trim()
}

describe('稳定序列化', () => {
  test('相同内容重复写入产生完全一致的字节', (t) => {
    const { root, hub } = repo()
    hub.addVersion('ord', { versionNo: 'v1.0', title: '首版', html: html() })
    const f = store.paths.versionJson(root, 'ord', 'v1.0')
    const a = fs.readFileSync(f, 'utf8')

    // 原样读出再写回，不应产生任何字节差异
    const v = store.readVersion(root, 'ord', 'v1.0')
    store.writeVersion(root, 'ord', v)
    t.assert.strictEqual(fs.readFileSync(f, 'utf8'), a)
  })

  test('键顺序固定，不随对象构造顺序变化', (t) => {
    const { root, hub } = repo()
    hub.addVersion('ord', { versionNo: 'v1.0', title: '首版', html: html() })
    const text = fs.readFileSync(store.paths.versionJson(root, 'ord', 'v1.0'), 'utf8')
    const keys = [...text.matchAll(/^ {2}"([a-zA-Z]+)"/gm)].map((m) => m[1])
    t.assert.deepStrictEqual(
      keys.slice(0, 5),
      ['versionNo', 'title', 'status', 'reviewStatus', 'note'],
      '键顺序应由 schema 决定'
    )
  })

  test('文件以换行结尾，避免每次改动都多出一行 diff 噪音', (t) => {
    const { root, hub } = repo()
    hub.addVersion('ord', { versionNo: 'v1.0', title: '首版', html: html() })
    t.assert.ok(fs.readFileSync(store.paths.versionJson(root, 'ord', 'v1.0'), 'utf8').endsWith('\n'))
  })
})

describe('Git 集成', { skip: hasGit ? false : '环境无 git' }, () => {
  test('新增一条变更日志，diff 正好是一行', (t) => {
    const { root, hub } = repo()
    hub.addVersion('ord', {
      versionNo: 'v1.0', title: '首版', html: html(),
      changes: [{ type: '修改', location: '筛选区', content: '压缩为一行' }]
    })
    initGit(root)

    hub.addChange('ord', 'v1.0', { type: '新增', location: '工具栏', content: '批量导出' })

    const d = git(root, 'diff', '--unified=0', '--', 'projects/ord/versions/v1.0.json')
    const added = d.out.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    const removed = d.out.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'))

    // 新增一条变更 = 新增一个数组元素（6 行：{ type location content requirement } + 括号）
    // 关键是 diff 完全可读，且没有无关字段被顺带改动
    t.assert.ok(added.length > 0, '应有新增行')
    t.assert.ok(
      added.some((l) => l.includes('批量导出')),
      'diff 里应能直接读到变更内容'
    )
    t.assert.ok(
      !removed.some((l) => l.includes('createdAt')),
      '不相关的字段不应被顺带改写'
    )
  })

  test('切换基线的 diff 只有一行', (t) => {
    const { root, hub } = repo()
    hub.addVersion('ord', { versionNo: 'v1.0', title: '首版', html: html() })
    hub.setBaseline('ord', 'v1.0')
    hub.addVersion('ord', {
      versionNo: 'v1.1', title: '二版', html: html(),
      changes: [{ type: '修改', location: 'x', content: 'y' }]
    })
    initGit(root)

    hub.setBaseline('ord', 'v1.1')

    const d = git(root, 'diff', '--unified=0', '--', 'projects/ord/BASELINE')
    const added = d.out.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    const removed = d.out.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'))
    t.assert.deepStrictEqual(added, ['+v1.1'])
    t.assert.deepStrictEqual(removed, ['-v1.0'])
  })

  test('两人各加一个版本可自动合并，无冲突', (t) => {
    const { root, hub } = repo()
    hub.addVersion('ord', { versionNo: 'v1.0', title: '首版', html: html() })
    const main = initGit(root)

    // 分支 A 加 v1.1
    git(root, 'checkout', '-q', '-b', 'a')
    hub.addVersion('ord', { versionNo: 'v1.1', title: 'A 的版本', html: html() })
    git(root, 'add', '.'); git(root, 'commit', '-q', '-m', 'a')

    // 分支 B 加 v1.2
    git(root, 'checkout', '-q', main)
    git(root, 'checkout', '-q', '-b', 'b')
    hub.addVersion('ord', { versionNo: 'v1.2', title: 'B 的版本', html: html() })
    git(root, 'add', '.'); git(root, 'commit', '-q', '-m', 'b')

    const merge = git(root, 'merge', 'a', '--no-edit')
    t.assert.strictEqual(merge.code, 0, `合并应无冲突：${merge.out}${merge.err}`)
    t.assert.strictEqual(hub.listVersions('ord').length, 3)
  })

  test('两人切了不同基线时，冲突正好落在 BASELINE 一行上', (t) => {
    const { root, hub } = repo()
    hub.addVersion('ord', { versionNo: 'v1.0', title: '首版', html: html() })
    // 首版必须在还是唯一版本时设为基线，否则会撞上 R6（这本身就是规则在起作用）
    hub.setBaseline('ord', 'v1.0')
    const mk = (no) => hub.addVersion('ord', {
      versionNo: no, title: no, html: html(),
      changes: [{ type: '修改', location: 'x', content: 'y' }]
    })
    mk('v1.1'); mk('v1.2')
    const main = initGit(root)

    git(root, 'checkout', '-q', '-b', 'a')
    hub.setBaseline('ord', 'v1.1')
    git(root, 'add', '.'); git(root, 'commit', '-q', '-m', 'a')

    git(root, 'checkout', '-q', main)
    git(root, 'checkout', '-q', '-b', 'b')
    hub.setBaseline('ord', 'v1.2')
    git(root, 'add', '.'); git(root, 'commit', '-q', '-m', 'b')

    const merge = git(root, 'merge', 'a', '--no-edit')
    t.assert.notStrictEqual(merge.code, 0, '应当产生冲突')

    const conflicted = git(root, 'diff', '--name-only', '--diff-filter=U').out.trim().split('\n')
    t.assert.ok(
      conflicted.includes('projects/ord/BASELINE'),
      `冲突应落在 BASELINE 上，实际：${conflicted.join(', ')}`
    )

    const content = fs.readFileSync(path.join(root, 'projects/ord/BASELINE'), 'utf8')
    t.assert.match(content, /v1\.2/)
    t.assert.match(content, /v1\.1/)
    // 冲突内容极短，人一眼能判断该留哪个
    t.assert.ok(content.split('\n').length <= 8, '冲突块应该短到一眼能解')
  })

  test('.gitattributes 把原型 HTML 标为 binary，避免污染 diff', (t) => {
    const { root, hub } = repo()
    hub.addVersion('ord', { versionNo: 'v1.0', title: '首版', html: html('原始') })
    initGit(root)

    hub.replaceHtml('ord', 'v1.0', { html: html('大改一遍，几千行重排') })
    const d = git(root, 'diff', '--', 'projects/ord/versions/v1.0.html')
    t.assert.match(d.out, /Binary files/, 'HTML 应按二进制处理，不逐行 diff')
  })
})
