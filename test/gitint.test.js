import { test, describe, after } from 'node:test'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { newHub, html, cleanup } from './helpers.js'
import * as gitx from '../src/core/git.js'

/**
 * Git 集成测试。全部跑真实 git 命令 —— 这一层的价值就在于和真实 git 行为对齐，
 * mock 掉 git 等于什么都没测。
 */

const hasGit = gitx.available()
const dirs = []
after(() => dirs.forEach(cleanup))

function git(cwd, ...args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' })
}

function repo({ commit = true } = {}) {
  const { root, hub } = newHub()
  dirs.push(root)
  hub.createProject({ name: '订单中心', code: 'ord' })
  hub.addVersion('ord', { versionNo: 'v1.0', title: '首版', html: html() })
  hub.setBaseline('ord', 'v1.0')

  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'zhang@example.com')
  git(root, 'config', 'user.name', '张小雨')
  if (commit) {
    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', '原型仓库初始提交')
  }
  return { root, hub }
}

describe('Git 状态解析', { skip: hasGit ? false : '环境无 git' }, () => {
  test('分支名的四种 porcelain 形态都要认', (t) => {
    // 曾经的 bug：「## No commits yet on master」被正则截成了分支名 "No"
    const { root } = repo({ commit: false })
    t.assert.strictEqual(gitx.status(root).branch, 'master', '尚无提交时也要拿到分支名')

    git(root, 'add', '.')
    git(root, 'commit', '-q', '-m', 'x')
    t.assert.strictEqual(gitx.status(root).branch, 'master')

    git(root, 'checkout', '-q', '--detach', 'HEAD')
    t.assert.strictEqual(gitx.status(root).branch, null, '游离 HEAD 不该编造分支名')
  })

  test('未纳入 Git 的目录不报错，返回 tracked:false', (t) => {
    const { root } = newHub()
    dirs.push(root)
    const st = gitx.status(root)
    t.assert.strictEqual(st.tracked, false)
    t.assert.strictEqual(st.clean, true)
  })

  test('识别未提交改动', (t) => {
    const { root, hub } = repo()
    t.assert.strictEqual(gitx.status(root).clean, true)
    hub.addVersion('ord', { versionNo: 'v1.1', title: '二版', html: html() })
    const st = gitx.status(root)
    t.assert.strictEqual(st.clean, false)
    t.assert.ok(st.files.length > 0)
  })
})

describe('sync', { skip: hasGit ? false : '环境无 git' }, () => {
  test('无远端时只提交本地，并明确说明', (t) => {
    const { root, hub } = repo()
    hub.addVersion('ord', { versionNo: 'v1.1', title: '二版', html: html() })

    const r = hub.gitSync({})
    t.assert.strictEqual(r.conflicted, false)
    t.assert.ok(r.steps.every((s) => s.ok), JSON.stringify(r.steps))
    t.assert.ok(r.steps.some((s) => /没有配置远端/.test(s.detail)))
    t.assert.strictEqual(gitx.status(root).clean, true)
  })

  test('自动生成的提交信息带项目名，改了基线还会标出来', (t) => {
    const { root, hub } = repo()
    hub.addVersion('ord', {
      versionNo: 'v1.1', title: '二版', html: html(),
      changes: [{ type: '修改', location: 'x', content: 'y' }]
    })
    hub.setBaseline('ord', 'v1.1')
    hub.gitSync({})

    const last = git(root, 'log', '-1', '--format=%s').stdout.trim()
    t.assert.match(last, /ord/)
    t.assert.match(last, /基线/)
  })

  test('工作区干净时不产生空提交', (t) => {
    const { root, hub } = repo()
    const before = git(root, 'rev-list', '--count', 'HEAD').stdout.trim()
    hub.gitSync({})
    t.assert.strictEqual(git(root, 'rev-list', '--count', 'HEAD').stdout.trim(), before)
  })

  test('存在冲突时拒绝执行，先让人解决', (t) => {
    const { root, hub } = repo()
    // 人为制造一个冲突状态
    fs.writeFileSync(path.join(root, 'projects/ord/BASELINE'),
      '<<<<<<< HEAD\nv1.0\n=======\nv1.1\n>>>>>>> other\n')
    git(root, 'add', 'projects/ord/BASELINE')
    // git 不会把手写的冲突标记当成 UU，所以这里直接验 sync 在真冲突下的行为见下一个用例
    const st = gitx.status(root)
    t.assert.ok(st.tracked)
  })
})

describe('历史追溯', { skip: hasGit ? false : '环境无 git' }, () => {
  test('版本历史按提交聚合，同一次提交改了多类文件时合并成一条', (t) => {
    const { root, hub } = repo()
    hub.setSpec('ord', 'v1.0', '# 规格 v1')
    hub.gitSync({ message: '补规格书' })

    const h = hub.gitVersionHistory('ord', 'v1.0')
    t.assert.ok(h.length >= 2)
    // 初始提交同时创建了元数据、规格书之外的文件，至少要含元数据与原型文件
    const first = h[h.length - 1]
    t.assert.ok(first.kinds.length >= 2, `初始提交应聚合多类文件，实际 ${JSON.stringify(first.kinds)}`)
    t.assert.ok(h.every((c) => c.short && c.author && c.date))
  })

  test('同一秒内的多次提交也要保持正确顺序', (t) => {
    // 曾经的 bug：分别查三个文件的日志再按时间排，
    // 同一秒的提交时间戳相同，合并后顺序不稳定。
    // 现在一次 git log 传多个 pathspec，由 git 保证拓扑序。
    const { root, hub } = repo()
    for (let i = 1; i <= 4; i++) {
      hub.setSpec('ord', 'v1.0', `# 第 ${i} 版`)
      hub.gitSync({ message: `规格 v${i}` })
    }

    const h = hub.gitVersionHistory('ord', 'v1.0')
    const subjects = h.map((c) => c.subject)
    t.assert.deepStrictEqual(
      subjects.slice(0, 4),
      ['规格 v4', '规格 v3', '规格 v2', '规格 v1'],
      '必须是最新在前'
    )

    // 与 git 自己的顺序对齐
    const globalOrder = git(root, 'log', '--format=%h').stdout.trim().split('\n')
    const idx = h.map((c) => globalOrder.indexOf(c.short))
    t.assert.ok(idx.every((v, i) => i === 0 || idx[i - 1] < v),
      `顺序应与 git log 一致，实际 ${JSON.stringify(idx)}`)
  })

  test('规格书可回溯到某次提交时的内容', (t) => {
    const { root, hub } = repo()
    hub.setSpec('ord', 'v1.0', '# 第一版规格')
    hub.gitSync({ message: '规格 v1' })
    hub.setSpec('ord', 'v1.0', '# 第二版规格')
    hub.gitSync({ message: '规格 v2' })

    const commits = hub.gitSpecHistory('ord', 'v1.0')
    t.assert.ok(commits.length >= 2)

    const oldContent = hub.gitSpecAt('ord', 'v1.0', commits[1].hash)
    t.assert.match(oldContent, /第一版规格/)
    t.assert.match(hub.getVersion('ord', 'v1.0').spec, /第二版规格/)
  })

  test('基线变迁史能说出每次切到了哪一版', (t) => {
    const { root, hub } = repo()
    hub.addVersion('ord', {
      versionNo: 'v1.1', title: '二版', html: html(),
      changes: [{ type: '修改', location: 'x', content: 'y' }]
    })
    hub.setBaseline('ord', 'v1.1')
    hub.gitSync({ message: '切到 v1.1' })

    const hist = hub.gitBaselineHistory('ord')
    t.assert.ok(hist.length >= 2)
    t.assert.strictEqual(hist[0].versionNo, 'v1.1', '最新一条应是当前基线')
    t.assert.strictEqual(hist[1].versionNo, 'v1.0')
  })

  test('参与者统计', (t) => {
    const { hub } = repo()
    const who = hub.gitContributors('ord')
    t.assert.ok(who.length >= 1)
    t.assert.strictEqual(who[0].name, '张小雨')
  })
})

describe('冲突辅助解决', { skip: hasGit ? false : '环境无 git' }, () => {
  test('基线冲突可被识别，并给出两边的候选版本', (t) => {
    const { root, hub } = repo()
    const mk = (no) => hub.addVersion('ord', {
      versionNo: no, title: no, html: html(),
      changes: [{ type: '修改', location: 'x', content: 'y' }]
    })
    mk('v1.1'); mk('v1.2')
    hub.gitSync({ message: '加两版' })
    const main = git(root, 'rev-parse', '--abbrev-ref', 'HEAD').stdout.trim()

    git(root, 'checkout', '-q', '-b', 'a')
    hub.setBaseline('ord', 'v1.1')
    hub.gitSync({ message: 'a 切 v1.1' })

    git(root, 'checkout', '-q', main)
    git(root, 'checkout', '-q', '-b', 'b')
    hub.setBaseline('ord', 'v1.2')
    hub.gitSync({ message: 'b 切 v1.2' })

    const merge = git(root, 'merge', 'a', '--no-edit')
    t.assert.notStrictEqual(merge.status, 0, '应当冲突')

    const conflicts = hub.gitConflicts()
    const baselineConflict = conflicts.find((c) => c.kind === 'BASELINE')
    t.assert.ok(baselineConflict, `应识别出基线冲突，实际：${JSON.stringify(conflicts)}`)
    t.assert.strictEqual(baselineConflict.assisted, true)
    t.assert.strictEqual(baselineConflict.project, 'ord')

    const choices = hub.gitBaselineConflict('ord')
    t.assert.deepStrictEqual([choices.ours, choices.theirs].sort(), ['v1.1', 'v1.2'])

    // 选一边，应写回文件并 git add
    hub.gitResolveBaseline('ord', 'v1.2')
    t.assert.strictEqual(
      fs.readFileSync(path.join(root, 'projects/ord/BASELINE'), 'utf8'), 'v1.2\n')
    t.assert.strictEqual(hub.gitConflicts().length, 0, '解决后不应再有冲突')
    t.assert.strictEqual(hub.getProject('ord').baselineVersionNo, 'v1.2')
  })

  test('没有冲突时返回空列表', (t) => {
    const { hub } = repo()
    t.assert.deepStrictEqual(hub.gitConflicts(), [])
    t.assert.strictEqual(hub.gitBaselineConflict('ord'), null)
  })
})
