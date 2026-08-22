import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

import * as G from '../src/core/git.js'
import * as assistant from '../src/core/assistant.js'
import { initRepo } from '../src/core/repo.js'
import { Hub } from '../src/core/service.js'

/**
 * Git 助手的测试。
 *
 * 这些用例全部跑在真实的 git 仓库上，不打桩 ——
 * 这个模块的价值恰恰在于处理 git 的真实行为（rebase 时 ours/theirs 会反、
 * 工作区脏了就拒绝 continue），打桩等于把要测的东西测没了。
 */

const HAS_GIT = spawnSync('git', ['--version']).status === 0

function sh(cwd, ...args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} 失败：${r.stderr}`)
  return r.stdout.trim()
}

let base
before(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-git-')) })
after(() => { fs.rmSync(base, { recursive: true, force: true }) })

function newRepo(name) {
  const dir = path.join(base, name)
  fs.mkdirSync(dir, { recursive: true })
  initRepo(dir, { name })
  return dir
}

function seed(hub, slug, versionNo, html) {
  const file = path.join(base, `${slug}-${versionNo}.html`)
  fs.writeFileSync(file, html)
  hub.addVersion(slug, { sourcePath: file, versionNo, title: versionNo + ' 版' })
  hub.setChanges(slug, versionNo, [{ type: '新增', location: '页面', content: '内容 ' + versionNo }])
  hub.setBaseline(slug, versionNo)
}

describe('Git 助手：体检', { skip: !HAS_GIT && '环境里没有 git' }, () => {
  test('没纳入 Git 时给出的是产品动作，不是 git 命令', () => {
    const root = newRepo('doctor-a')
    const d = G.diagnose(root)
    assert.equal(d.stage, 'no-repo')
    assert.equal(d.ok, false)
    const init = d.actions.find((a) => a.key === 'init')
    assert.ok(init, '应该给出「纳入 Git」这个动作')
    assert.ok(init.api, '动作必须能被产品自己执行，而不是让用户去敲命令')
    // 整个返回值里不应该出现让用户手敲的 git 命令
    assert.doesNotMatch(JSON.stringify(d), /git init|git add|git commit|git rebase/)
  })

  test('缺身份会在提交失败之前就被发现', () => {
    const root = newRepo('doctor-b')
    sh(root, 'init')
    // 把本仓库的身份清成空串，盖住可能存在的全局配置。
    // 用 --unset-all 不行：没设过时 git 会以非零码退出。
    sh(root, 'config', '--local', 'user.name', '')
    sh(root, 'config', '--local', 'user.email', '')
    assert.equal(G.identity(root).complete, false)
    const d = G.diagnose(root)
    assert.ok(d.checks.some((c) => c.level === 'error' && /身份/.test(c.title)),
      '缺身份必须在体检里报错，而不是等 git 提交时才失败')
  })

  test('setup 一次做完初始化、配置和首次提交', () => {
    const root = newRepo('setup-a')
    const r = G.initRepo(root, { name: '测试', email: 't@example.com' })
    assert.equal(r.needIdentity, false)
    assert.equal(r.committed, true)
    assert.ok(G.isRepo(root))
    assert.equal(sh(root, 'rev-list', '--count', 'HEAD'), '1')

    // 幂等：再来一次不该炸，也不该产生空提交
    const again = G.initRepo(root, {})
    assert.equal(again.committed, false)
    assert.equal(sh(root, 'rev-list', '--count', 'HEAD'), '1')
  })
})

describe('Git 助手：冲突', { skip: !HAS_GIT && '环境里没有 git' }, () => {
  let a, b

  before(() => {
    const bare = path.join(base, 'origin.git')
    spawnSync('git', ['init', '--bare', '-q', bare])

    const seedDir = newRepo('seed')
    const hub0 = new Hub(seedDir)
    hub0.createProject({ name: '订单中心', code: 'order' })
    seed(hub0, 'order', 'v1.0', '<html>1</html>')
    G.initRepo(seedDir, { name: '种子', email: 's@example.com' })
    G.setRemote(seedDir, bare)
    sh(seedDir, 'push', '-u', 'origin', 'HEAD')

    a = path.join(base, 'a')
    b = path.join(base, 'b')
    spawnSync('git', ['clone', '-q', bare, a])
    spawnSync('git', ['clone', '-q', bare, b])
    for (const [d, who] of [[a, 'A'], [b, 'B']]) {
      sh(d, 'config', 'user.name', who)
      sh(d, 'config', 'user.email', `${who}@example.com`)
    }

    // 两边各自加一版并切基线 —— BASELINE 只有一行，必冲突
    seed(new Hub(a), 'order', 'v2.0', '<html>A</html>')
    G.sync(a, { message: 'A 的改动' })
    seed(new Hub(b), 'order', 'v3.0', '<html>B</html>')
    G.sync(b, { message: 'B 的改动' })
  })

  test('确实卡在了 rebase 上', () => {
    assert.equal(G.inProgress(b), 'rebase')
    const list = G.listConflicts(b)
    assert.equal(list.length, 1)
    assert.equal(list[0].assisted, true, '基线冲突应该是可辅助解决的')
  })

  test('rebase 期间 ours/theirs 是反的，界面必须显示翻译后的那一组', () => {
    const info = G.readBaselineConflict(b, 'order')
    assert.equal(info.rebasing, true)
    // B 自己建的是 v3.0。rebase 把远端当基底，所以 git 的 "ours" 其实是 A 的。
    // 照搬 git 的用词会让用户稳定选错基线 —— 这条断言守的就是这个。
    assert.equal(info.ours, 'v2.0')
    assert.equal(info.theirs, 'v3.0')
    assert.equal(info.mine, 'v3.0', '「你这边」应该是 B 自己的版本')
    assert.equal(info.others, 'v2.0', '「对方」应该是 A 推上去的版本')
  })

  test('交给 AI 助理的说明里带着这条反直觉的警告', () => {
    const text = assistant.brief(b)
    assert.match(text, /我这边是 v3\.0，对方是 v2\.0/)
    assert.match(text, /ours\/theirs 与直觉相反/)
    assert.match(text, /BASELINE/)
    assert.doesNotMatch(text, /<html>/, '简报里不该出现原型内容')
  })

  test('冲突没解决就 continue 会被拦下，而不是丢给 git 报错', () => {
    assert.throws(() => G.continueInProgress(b), /还有 1 个文件没解决/)
  })

  test('选一边 → 继续 → 走完，全程没有裸 git', () => {
    const hub = new Hub(b)
    hub.gitResolveBaseline('order', 'v3.0')
    assert.equal(G.listConflicts(b).length, 0)

    // 解决动作本身会往 oplog 追加一条记录，工作区因此变脏。
    // 早先这里会让 git 拒绝继续，并回一句指向 git add 的提示。
    const r = hub.gitContinue()
    assert.equal(r.done, true, r.message)
    assert.equal(G.inProgress(b), null)
    assert.equal(fs.readFileSync(path.join(b, 'projects/order/BASELINE'), 'utf8').trim(), 'v3.0')
  })

  test('走完之后体检回到正常，且历史里两边的版本都在', () => {
    const d = G.diagnose(b)
    assert.notEqual(d.stage, 'conflicted')
    assert.ok(fs.existsSync(path.join(b, 'projects/order/versions/v2.0.json')), 'A 的版本应该还在')
    assert.ok(fs.existsSync(path.join(b, 'projects/order/versions/v3.0.json')), 'B 的版本应该还在')
  })
})

describe('Git 助手：改动摘要', { skip: !HAS_GIT && '环境里没有 git' }, () => {
  test('未跟踪的新项目也要能看清改了哪些版本', () => {
    const root = newRepo('summary')
    G.initRepo(root, { name: '测试', email: 't@example.com' })
    const hub = new Hub(root)
    hub.createProject({ name: '订单中心', code: 'order' })
    seed(hub, 'order', 'v1.0', '<html>1</html>')

    const sum = assistant.changeSummary(root)
    const item = sum.items.find((i) => i.slug === 'order')
    assert.ok(item, '新建的项目整个是未跟踪目录，也必须被识别出来')
    assert.equal(item.name, '订单中心')
    // 版本号自带小数点，早先按点截断会得到 "v1"
    assert.match(item.detail, /v1\.0/)
    assert.match(item.detail, /基线变更/)
    // Flowlark 自己的内部文件不能被划进「请不要提交」
    assert.ok(!sum.other.some((p) => p.startsWith('.flowlark/')))
  })

  test('用户自己的文件被明确标为不提交', () => {
    const root = newRepo('foreign')
    G.initRepo(root, { name: '测试', email: 't@example.com' })
    fs.writeFileSync(path.join(root, '我的草稿.sketch'), 'x')
    const sum = assistant.changeSummary(root)
    assert.ok(sum.other.includes('我的草稿.sketch'))
    assert.match(assistant.brief(root), /请不要提交/)
  })

  test('没有改动时不硬编一条提交说明', () => {
    const root = newRepo('empty-msg')
    G.initRepo(root, { name: '测试', email: 't@example.com' })
    assert.equal(assistant.suggestMessage(root), null)
  })
})
