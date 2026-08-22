import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync } from 'node:child_process'
import { err } from './errors.js'
import { stringify, parse } from './json.js'
import * as cfg from './config.js'

export const SCHEMA_VERSION = 1
export const REPO_FILE = 'flowlark.json'
export const INTERNAL_DIR = '.flowlark'

/**
 * 更名前的文件名。产品从 protohub 改名为 Flowlark，仓库里的配置文件和内部目录
 * 也跟着改了名。老仓库如果直接报「不是仓库」，用户完全不知道发生了什么 ——
 * 所以识别出来并一次性改名，而不是让他自己去猜。
 */
const LEGACY_REPO_FILE = 'protohub.json'
const LEGACY_INTERNAL_DIR = '.protohub'

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
.flowlark/oplog.ndjson merge=union
`

const GITIGNORE = `# 本地运行产物，不进版本库
.flowlark/cache/
.DS_Store
`

/**
 * 向上查找仓库根目录，行为与 git 一致：在子目录里执行命令也能找到仓库。
 * 支持 FLOWLARK_REPO 环境变量强制指定，便于脚本与测试。
 */
export function findRepoRoot(startDir = process.cwd()) {
  const forcedRepo = process.env.FLOWLARK_REPO || process.env.PROTOHUB_REPO
  if (forcedRepo) {
    const forced = path.resolve(forcedRepo)
    return isRepoDir(forced) ? adoptLegacyNames(forced) : null
  }
  let dir = path.resolve(startDir)
  while (true) {
    if (isRepoDir(dir)) return adoptLegacyNames(dir)
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function isRepoDir(dir) {
  return fs.existsSync(path.join(dir, REPO_FILE)) || fs.existsSync(path.join(dir, LEGACY_REPO_FILE))
}

/**
 * 把更名前的仓库改成新名字。
 *
 * 只做纯粹的文件改名，**不碰 Git** —— 改完仓库处于「有未提交改动」的状态，
 * 用户 review 完 `git diff` 再自己提交。改名这种事不该由程序替人提交。
 *
 * @returns 仓库根目录（原样返回，方便链式调用）
 */
function adoptLegacyNames(root) {
  const legacyFile = path.join(root, LEGACY_REPO_FILE)
  const legacyDir = path.join(root, LEGACY_INTERNAL_DIR)
  const newFile = path.join(root, REPO_FILE)
  const newDir = path.join(root, INTERNAL_DIR)

  const renamed = []
  try {
    // 两边都在时保留新的，老的挪走 —— 不能静默覆盖用户的数据
    if (fs.existsSync(legacyFile) && !fs.existsSync(newFile)) {
      fs.renameSync(legacyFile, newFile)
      renamed.push(`${LEGACY_REPO_FILE} → ${REPO_FILE}`)
    }
    if (fs.existsSync(legacyDir) && !fs.existsSync(newDir)) {
      fs.renameSync(legacyDir, newDir)
      renamed.push(`${LEGACY_INTERNAL_DIR}/ → ${INTERNAL_DIR}/`)
    }
  } catch (e) {
    throw err.bad('RENAME_FAILED', `更名后的仓库迁移失败：${e.message}`,
      `手动执行：mv ${LEGACY_REPO_FILE} ${REPO_FILE} && mv ${LEGACY_INTERNAL_DIR} ${INTERNAL_DIR}`)
  }

  if (renamed.length && !process.env.FLOWLARK_QUIET_MIGRATE) {
    // 走 stderr，不污染 --json 的输出
    process.stderr.write(
      `ℹ 产品已更名为 Flowlark，仓库文件同步改名：${renamed.join('，')}\n` +
      `  这只改了文件名，没有动 Git。确认无误后提交即可。\n`
    )
  }
  return root
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
    throw err.conflict('REPO_EXISTS', `${root} 已经是一个 Flowlark 仓库`)
  }
  fs.mkdirSync(path.join(root, 'projects'), { recursive: true })
  fs.mkdirSync(path.join(root, '.flowlark', 'trash'), { recursive: true })

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
      `仓库 schema 版本 ${conf.schemaVersion} 高于当前 Flowlark 支持的 ${SCHEMA_VERSION}`,
      '升级 Flowlark：npm i -g flowlark@latest'
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
  // 更名期间同时认老变量，免得别人脚本里写死的 PROTOHUB_USER 突然失效
  const envUser = process.env.FLOWLARK_USER || process.env.PROTOHUB_USER
  if (envUser) return envUser.trim().slice(0, 32)
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
