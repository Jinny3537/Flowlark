import { after, describe, test } from 'node:test'
import { spawnSync } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cleanup } from './helpers.js'
import {
  checkForUpdate,
  compareVersions,
  downloadUpdate,
  parseManifest,
  pullSoftwareUpdate,
  softwareStatus
} from '../src/core/updater.js'

const dirs = []
const hasGit = spawnSync('git', ['--version']).status === 0

after(() => dirs.forEach(cleanup))

function tmpDir(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  dirs.push(dir)
  return dir
}

function git(root, args) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  if (r.status !== 0) throw new Error(r.stderr || r.stdout || `git ${args.join(' ')} failed`)
  return (r.stdout || '').trim()
}

function writePackage(root, version) {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'flowlark', version }, null, 2) + '\n')
}

describe('自动更新', () => {
  test('版本比较与清单校验', (t) => {
    t.assert.strictEqual(compareVersions('0.6.5', '0.6.4'), 1)
    t.assert.throws(
      () => parseManifest({ version: '0.6.5', url: 'http://example.com/a', sha256: '0'.repeat(64) }),
      (e) => e.code === 'UPDATE_URL_INVALID'
    )
  })

  test('下载必须通过 SHA-256', async (t) => {
    const dir = tmpDir('flowlark-update-')
    const data = Buffer.from('release')
    const sha256 = crypto.createHash('sha256').update(data).digest('hex')
    const manifest = { version: '0.6.5', url: 'http://localhost/release.zip', sha256 }

    const result = await downloadUpdate(manifest, dir, { fetcher: async () => new Response(data) })
    t.assert.strictEqual(result.installable, true)

    const bad = await downloadUpdate(
      { ...manifest, sha256: '0'.repeat(64) },
      dir,
      { fetcher: async () => new Response(data) }
    )
    t.assert.strictEqual(bad.installable, false)
  })

  test('检查更新网络失败不阻塞当前版本', async (t) => {
    const result = await checkForUpdate('https://example.com/update.json', '0.5.5', {
      fetcher: async () => { throw new Error('offline') }
    })
    t.assert.strictEqual(result.available, false)
  })

  test('软件仓库可检测远端并快进拉取', { skip: !hasGit }, (t) => {
    const remote = tmpDir('flowlark-remote-')
    const seed = tmpDir('flowlark-seed-')
    const local = tmpDir('flowlark-local-')

    git(remote, ['init', '--bare'])
    git(seed, ['init'])
    git(seed, ['config', 'user.name', 'Tester'])
    git(seed, ['config', 'user.email', 'tester@example.com'])
    git(seed, ['checkout', '-b', 'main'])
    writePackage(seed, '0.7.0')
    git(seed, ['add', 'package.json'])
    git(seed, ['commit', '-m', 'release 0.7.0'])
    git(seed, ['remote', 'add', 'origin', remote])
    git(seed, ['push', '-u', 'origin', 'main'])

    git(path.dirname(local), ['clone', remote, path.basename(local)])

    writePackage(seed, '0.8.0')
    git(seed, ['add', 'package.json'])
    git(seed, ['commit', '-m', 'release 0.8.0'])
    git(seed, ['push'])

    const status = softwareStatus({ root: local, fetchRemote: true })
    t.assert.strictEqual(status.available, true)
    t.assert.strictEqual(status.behind, 1)
    t.assert.strictEqual(status.latestVersion, '0.8.0')

    const result = pullSoftwareUpdate({ root: local })
    t.assert.strictEqual(result.updated, true)
    t.assert.strictEqual(result.after.currentVersion, '0.8.0')
  })
})
