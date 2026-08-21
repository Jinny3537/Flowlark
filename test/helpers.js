import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { initRepo } from '../src/core/repo.js'
import { Hub } from '../src/core/service.js'

export const CLI = fileURLToPath(new URL('../bin/protohub.js', import.meta.url))

export function tmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'protohub-test-'))
  initRepo(dir)
  return dir
}

export function newHub() {
  const root = tmpRepo()
  return { root, hub: new Hub(root) }
}

export function html(body = 'hello', extra = '') {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">${extra}</head><body>${body}</body></html>`
}

/** 断言某个操作抛出指定 code 的业务错误 */
export function throwsCode(t, code, fn) {
  try {
    fn()
  } catch (e) {
    t.assert.strictEqual(e.code, code, `期望错误码 ${code}，实际 ${e.code}（${e.message}）`)
    return e
  }
  t.assert.fail(`期望抛出 ${code}，但没有抛出异常`)
}

export function cleanup(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    /* 测试临时目录清理失败不影响结果 */
  }
}
