import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { err } from './errors.js'
import { stringify, parse } from './json.js'
import * as cfg from './config.js'

export const SCHEMA_VERSION = 1
export const REPO_FILE = 'protohub.json'

const GITATTRIBUTES = `# 原型 HTML 是 AI 生成的单文件，常整体重排。让 Git 逐行 diff 它只会淹掉 review，
# 而且没人真的会读那个 diff —— 要看差异，人看的是渲染后的页面和手写的变更日志。
*.html binary

# 这几类才是精心保持可读的，务必让 Git 正常 diff
*.json  text eol=lf
*.md    text eol=lf
BASELINE text eol=lf

# 操作日志是 append-only 的。用 Git 内置的 union 合并驱动直接拼接双方追加的行，
# 否则两个人各自加一个版本都会在这里撞出冲突 —— 而那个冲突毫无信息量，
# 正确解法永远是「两边都留着」。
.protohub/oplog.ndjson merge=union
`

const GITIGNORE = `# 本地运行产物，不进版本库
.protohub/cache/
.DS_Store
`

/**
 * 向上查找仓库根目录，行为与 git 一致：在子目录里执行命令也能找到仓库。
 * 支持 PROTOHUB_REPO 环境变量强制指定，便于脚本与测试。
 */
export function findRepoRoot(startDir = process.cwd()) {
  if (process.env.PROTOHUB_REPO) {
    const forced = path.resolve(process.env.PROTOHUB_REPO)
    if (fs.existsSync(path.join(forced, REPO_FILE))) return forced
    return null
  }
  let dir = path.resolve(startDir)
  while (true) {
    if (fs.existsSync(path.join(dir, REPO_FILE))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function requireRepoRoot(startDir) {
  const root = findRepoRoot(startDir)
  if (!root) throw err.noRepo()
  return root
}

export function initRepo(dir, { name } = {}) {
  const root = path.resolve(dir)
  const repoFile = path.join(root, REPO_FILE)
  if (fs.existsSync(repoFile)) {
    throw err.conflict('REPO_EXISTS', `${root} 已经是一个 protohub 仓库`)
  }
  fs.mkdirSync(path.join(root, 'projects'), { recursive: true })
  fs.mkdirSync(path.join(root, '.protohub', 'trash'), { recursive: true })

  const config = {
    schemaVersion: SCHEMA_VERSION,
    name: name || path.basename(root),
    createdAt: new Date().toISOString(),
    // 全部配置项由 config.js 的 schema 生成，加一项配置不用改这里
    settings: cfg.normalize({})
  }
  fs.writeFileSync(repoFile, stringify(config, 'repo'), 'utf8')

  // 只在文件不存在时写，避免覆盖用户已有的 Git 配置
  const ga = path.join(root, '.gitattributes')
  if (!fs.existsSync(ga)) fs.writeFileSync(ga, GITATTRIBUTES, 'utf8')
  const gi = path.join(root, '.gitignore')
  if (!fs.existsSync(gi)) fs.writeFileSync(gi, GITIGNORE, 'utf8')

  return { root, config }
}

export function readConfig(root) {
  const raw = fs.readFileSync(path.join(root, REPO_FILE), 'utf8')
  const conf = parse(raw, REPO_FILE)
  if (conf.schemaVersion > SCHEMA_VERSION) {
    throw err.bad(
      'SCHEMA_TOO_NEW',
      `仓库 schema 版本 ${conf.schemaVersion} 高于当前 protohub 支持的 ${SCHEMA_VERSION}`,
      '升级 protohub：npm i -g protohub@latest'
    )
  }
  // 缺失项用默认值补齐，老仓库的扁平结构也在这里迁移，不需要写迁移脚本
  conf.settings = cfg.normalize(conf.settings)
  return conf
}

export function writeConfig(root, conf) {
  fs.writeFileSync(path.join(root, REPO_FILE), stringify(conf, 'repo'), 'utf8')
}

/** 当前操作人。不做权限管理，昵称只用于留痕，取值优先级：环境变量 > git 配置 > 系统用户名 */
export function currentUser() {
  if (process.env.PROTOHUB_USER) return process.env.PROTOHUB_USER.trim().slice(0, 32)
  try {
    const name = execFileSync('git', ['config', 'user.name'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    if (name.trim()) return name.trim().slice(0, 32)
  } catch {
    /* 没装 git 或没配 user.name，继续降级 */
  }
  try {
    return os.userInfo().username
  } catch {
    return '匿名'
  }
}
