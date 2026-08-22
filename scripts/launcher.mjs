import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const node = process.execPath
if (process.argv.includes('--check')) {
  console.log(JSON.stringify({ ok: true, runtime: node, appRoot }))
  process.exit(0)
}

function lastWorkspace() {
  if (process.env.FLOWLARK_REPO) return path.resolve(process.env.FLOWLARK_REPO)
  const registry = path.join(process.env.FLOWLARK_HOME || path.join(os.homedir(), '.flowlark'), 'workspaces.json')
  if (fs.existsSync(registry)) return JSON.parse(fs.readFileSync(registry, 'utf8')).lastWorkspace || null
  return null
}

function chooseFolder() {
  try {
    return execFileSync('osascript', ['-e', 'POSIX path of (choose folder with prompt "选择 Flowlark 仓库")'], { encoding: 'utf8' }).trim()
  } catch { return null }
}

const repo = lastWorkspace() || chooseFolder()
if (!repo || !fs.existsSync(path.join(repo, 'flowlark.json'))) {
  console.error('未选择有效的 Flowlark 仓库。请先用 CLI 初始化，或在启动时选择包含 flowlark.json 的目录。')
  process.exit(1)
}

const child = spawn(node, [path.join(appRoot, 'bin', 'flowlark.js'), 'serve'], {
  cwd: repo, env: { ...process.env, FLOWLARK_REPO: repo }, stdio: 'inherit'
})
const url = 'http://127.0.0.1:7788'
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    const response = await fetch(`${url}/api/health`)
    if (response.ok) {
      if (process.env.FLOWLARK_NO_OPEN !== '1') execFileSync('open', [url])
      break
    }
  } catch { /* 服务仍在启动 */ }
  await new Promise((resolve) => setTimeout(resolve, 250))
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
child.on('exit', (code) => process.exit(code || 0))
