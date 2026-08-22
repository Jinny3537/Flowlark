import { after, describe, test } from 'node:test'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { cleanup } from './helpers.js'

const dirs = []
after(() => dirs.forEach(cleanup))

describe('macOS 应用包', () => {
  test('包含运行时、应用和可执行启动器，脱离 PATH 中的 Node 可检查', {
    skip: process.env.FLOWLARK_PACKAGE_TEST !== '1'
  }, (t) => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-app-'))
    dirs.push(out)
    execFileSync('bash', ['scripts/package-macos.sh', process.execPath, out], { cwd: path.resolve('.'), encoding: 'utf8' })
    const app = path.join(out, 'Flowlark.app')
    for (const file of [
      'Contents/Info.plist', 'Contents/MacOS/flowlark-launcher',
      'Contents/Resources/runtime/node', 'Contents/Resources/app/web/dist/index.html'
    ]) t.assert.ok(fs.existsSync(path.join(app, file)), file)
    const result = execFileSync(path.join(app, 'Contents/MacOS/flowlark-launcher'), ['--check'], {
      encoding: 'utf8', env: { ...process.env, PATH: '/usr/bin:/bin' }
    })
    const check = JSON.parse(result)
    t.assert.strictEqual(check.ok, true)
    t.assert.match(check.runtime, /Flowlark\.app\/Contents\/Resources\/runtime\/node/)
  })
})
