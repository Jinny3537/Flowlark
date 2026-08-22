import { test, describe, after } from 'node:test'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { CLI, html, newHub, cleanup } from './helpers.js'
import { inferVersionNo } from '../src/cli/commands.js'

/**
 * watch 的测试。上一轮交付时这块是承认没覆盖的空白 ——
 * 而它恰恰是最容易出问题的一类代码：文件系统事件、防抖、竞态。
 */

const dirs = []
after(() => dirs.forEach(cleanup))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

describe('版本号推断', () => {
  test('从文件名里认出版本号', (t) => {
    const cases = [
      ['订单中心_v1.4.html', 'v1.4'],
      ['proto-v2.html', 'v2'],
      ['V3.1.2.htm', 'v3.1.2'],
      ['order 1.0.html', 'v1.0']
    ]
    for (const [name, expect] of cases) {
      t.assert.strictEqual(inferVersionNo(name), expect, name)
    }
  })

  test('认不出来时退化为日期编号，且必须合法', (t) => {
    const no = inferVersionNo('随便一个名字.html')
    t.assert.match(no, /^d\d{8}-\d{4}$/)
    // 推断出的版本号同时是文件名，必须过字符集校验
    t.assert.match(no, /^[A-Za-z0-9][A-Za-z0-9._+-]{0,31}$/)
  })
})

describe('watch 自动归档', () => {
  test('新 HTML 落盘后被自动归档为草稿', async (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单', code: 'ord' })

    const watchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-watch-'))
    dirs.push(watchDir)

    const child = spawn(process.execPath, [CLI, 'watch', 'ord', '-d', watchDir], {
      env: { ...process.env, NO_COLOR: '1', FLOWLARK_REPO: root },
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    child.stdout.on('data', (c) => { out += c })

    try {
      await sleep(600) // 等 watcher 起来

      fs.writeFileSync(path.join(watchDir, '订单中心_v1.4.html'), html('自动归档'))
      // 防抖 400ms + 处理时间
      await sleep(1800)

      const versions = hub.listVersions('ord')
      t.assert.strictEqual(versions.length, 1, `应归档 1 个版本，实际 ${versions.length}；输出：${out}`)
      t.assert.strictEqual(versions[0].versionNo, 'v1.4', '版本号应从文件名推断')
      t.assert.strictEqual(versions[0].display.key, 'DRAFT', '自动归档的必须是草稿')
    } finally {
      child.kill()
    }
  })

  test('监听开始前就存在的文件不会被重复归档', async (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单', code: 'ord' })

    const watchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-watch-'))
    dirs.push(watchDir)
    // 启动前就放一个文件
    fs.writeFileSync(path.join(watchDir, '已存在_v1.0.html'), html('旧文件'))

    const child = spawn(process.execPath, [CLI, 'watch', 'ord', '-d', watchDir], {
      env: { ...process.env, NO_COLOR: '1', FLOWLARK_REPO: root },
      stdio: ['ignore', 'pipe', 'pipe']
    })

    try {
      await sleep(1200)
      t.assert.strictEqual(hub.listVersions('ord').length, 0,
        '启动前已存在的文件不该被当成新文件归档')
    } finally {
      child.kill()
    }
  })

  test('目录不存在时立即报错退出，不静默挂起', async (t) => {
    const { root, hub } = newHub()
    dirs.push(root)
    hub.createProject({ name: '订单', code: 'ord' })

    const r = await new Promise((resolve) => {
      const child = spawn(process.execPath, [CLI, 'watch', 'ord', '-d', '/no/such/dir'], {
        env: { ...process.env, NO_COLOR: '1', FLOWLARK_REPO: root },
        stdio: ['ignore', 'pipe', 'pipe']
      })
      let err = ''
      child.stderr.on('data', (c) => { err += c })
      child.on('close', (code) => resolve({ code, err }))
    })

    t.assert.strictEqual(r.code, 1)
    t.assert.match(r.err, /不存在/)
  })
})
