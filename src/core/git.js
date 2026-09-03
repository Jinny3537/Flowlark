import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { err } from './errors.js'
import { paths } from './store.js'
import { INTERNAL_DIR } from './repo.js'

/**
 * Git 集成。
 *
 * 数据进了 Git 之后，很多本来要自己造的东西 Git 已经有了：
 * 谁改的、什么时候改的、改之前长什么样、两个人怎么合。
 * 这一层做的是把这些能力翻译成产品语言 ——
 * 用户问的是「v1.2 的规格书上周是什么样」，不是「git show HEAD~5:path」。
 */

export function git(root, args, { input } = {}) {
  const r = spawnSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    input,
    maxBuffer: 32 * 1024 * 1024
  })
  return {
    ok: r.status === 0,
    code: r.status,
    out: (r.stdout || '').trim(),
    err: (r.stderr || '').trim()
  }
}

export function available() {
  return spawnSync('git', ['--version']).status === 0
}

export function isRepo(root) {
  if (!available()) return false
  return git(root, ['rev-parse', '--is-inside-work-tree']).out === 'true'
}

function requireRepo(root) {
  if (!available()) {
    throw err.bad('GIT_MISSING', '系统里没有找到 git', '装个 git 才能用同步与历史功能')
  }
  if (!isRepo(root)) {
    throw err.bad('NOT_GIT_REPO', '当前仓库还没有纳入 Git',
      '运行 flowlark git setup，或在工作台的 Git 面板点「纳入 Git 管理」')
  }
}

// ==================== 状态 ====================

/**
 * Flowlark 自己管理的路径。
 *
 * sync 只提交这些，不是 `git add -A` ——
 * 用户常在同一个文件夹里放着正在改的原型源文件、临时导出的截图，
 * 把它们一并卷进提交是意料之外的行为。想提交别的，用 git 本身。
 */
export const OWNED_PATHS = ['projects', 'flowlark.json', '.flowlark', '.gitattributes', '.gitignore']

const STATUS_CACHE_FILE = 'git-status.json'

function statusCacheFile(root) {
  return path.join(root, INTERNAL_DIR, 'cache', STATUS_CACHE_FILE)
}

function readStatusCache(root, mode = 'fast') {
  try {
    const raw = JSON.parse(fs.readFileSync(statusCacheFile(root), 'utf8'))
    const cached = raw && raw[mode]
    if (!cached || !cached.status) return null
    return {
      ...cached.status,
      source: 'cache',
      cached: true,
      cachedAt: cached.checkedAt,
      cacheAgeMs: Date.now() - Date.parse(cached.checkedAt)
    }
  } catch {
    return null
  }
}

function writeStatusCache(root, mode, status) {
  const file = statusCacheFile(root)
  let raw = {}
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    raw = {}
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  raw[mode] = {
    checkedAt: new Date().toISOString(),
    status: {
      ...status,
      source: 'git',
      cached: false
    }
  }
  fs.writeFileSync(file, JSON.stringify(raw, null, 2) + '\n', 'utf8')
}

export function isOwnedPath(p) {
  return OWNED_PATHS.some((own) => p === own || p.startsWith(own + '/'))
}

const XY = {
  '??': '未跟踪', 'A ': '新增', 'M ': '已暂存', ' M': '已修改',
  'MM': '部分暂存', 'D ': '已删除', ' D': '已删除', 'R ': '重命名', 'UU': '冲突'
}

export function status(root, { includeForeign = true, preferCache = false } = {}) {
  const mode = includeForeign ? 'full' : 'fast'
  if (preferCache) {
    const cached = readStatusCache(root, mode) || (!includeForeign ? readStatusCache(root, 'full') : null)
    if (cached) {
      return {
        ...cached,
        fast: !includeForeign,
        truncated: !includeForeign,
        cacheOnly: true
      }
    }
  }
  if (!available() || !isRepo(root)) {
    return {
      tracked: false,
      clean: true,
      files: [],
      branch: null,
      ahead: 0,
      behind: 0,
      conflicted: [],
      source: 'computed',
      cached: false,
      fast: !includeForeign,
      truncated: false
    }
  }
  // -uall：让 git 逐个列出未跟踪文件，而不是把整个目录折叠成一行 "projects/"。
  // 折叠版本会让「这次改了哪些项目的哪些版本」无从判断 ——
  // 新建一个项目时改动全在未跟踪目录里，恰恰是最需要看清楚的时候。
  const args = ['status', '--porcelain=v1', '--branch', '-uall']
  if (!includeForeign) args.push('--', ...OWNED_PATHS)
  const porcelain = git(root, args)
  const lines = porcelain.out.split('\n').filter(Boolean)

  let branch = null
  let ahead = 0
  let behind = 0
  const files = []

  for (const line of lines) {
    if (line.startsWith('##')) {
      // porcelain 的分支行有四种形态，都得认：
      //   ## main...origin/main [ahead 2, behind 1]
      //   ## main
      //   ## No commits yet on main      ← 刚 git init、还没提交时
      //   ## HEAD (no branch)            ← detached HEAD
      const rest = line.slice(2).trim()
      const noCommits = /^No commits yet on (.+)$/.exec(rest)
      if (noCommits) {
        branch = noCommits[1].split('...')[0].trim()
      } else if (rest.startsWith('HEAD (no branch)')) {
        branch = null
      } else {
        const m = /^([^.\s]+)/.exec(rest)
        if (m) branch = m[1]
      }
      const a = /ahead (\d+)/.exec(line)
      const b = /behind (\d+)/.exec(line)
      if (a) ahead = Number(a[1])
      if (b) behind = Number(b[1])
      continue
    }
    const code = line.slice(0, 2)
    files.push({ code, label: XY[code] || code.trim(), path: line.slice(3) })
  }

  // -uall 之后基本都是具体文件了，但空目录等边角情况仍可能带尾部斜杠
  const own = files.filter((f) => isOwnedPath(f.path.replace(/\/$/, '')))
  const foreign = includeForeign ? files.filter((f) => !isOwnedPath(f.path.replace(/\/$/, ''))) : []

  const result = {
    tracked: true,
    // clean 只看 Flowlark 自己的文件 —— 用户放在旁边的草稿不该让「同步」按钮一直亮着
    clean: own.length === 0,
    branch,
    ahead,
    behind,
    files: own,
    foreignFiles: foreign,
    allFiles: files,
    conflicted: files.filter((f) => f.code === 'UU' || f.code.includes('U')).map((f) => f.path),
    hasRemote: !!git(root, ['remote']).out,
    source: 'git',
    cached: false,
    fast: !includeForeign,
    truncated: !includeForeign
  }
  writeStatusCache(root, mode, result)
  return result
}

/**
 * 确保仓库的 git 配置适合中文内容。
 *
 * Git 默认把非 ASCII 文件名转义成八进制（`"\351\234\200..."`），
 * 于是 `git status`、`git log --name-only` 在中文项目里全是乱码 ——
 * 而这个产品的项目名、附件名几乎都是中文。
 * 只在用户没有显式设过时才写，不覆盖别人的偏好。
 */
export function ensureRepoDefaults(root) {
  if (!isRepo(root)) return []
  const applied = []
  const existing = git(root, ['config', '--local', '--get', 'core.quotepath'])
  if (!existing.ok || !existing.out) {
    git(root, ['config', '--local', 'core.quotepath', 'false'])
    applied.push('core.quotepath=false（让中文文件名在 git 输出里正常显示）')
  }
  return applied
}

// ==================== 远端 ====================

export function getRemote(root, name = 'origin') {
  if (!isRepo(root)) return null
  const r = git(root, ['remote', 'get-url', name])
  return r.ok && r.out ? { name, url: r.out } : null
}

/** 已存在就改地址，不存在就新增 —— 用户不该关心这两条命令的区别 */
export function setRemote(root, url, name = 'origin') {
  requireRepo(root)
  ensureRepoDefaults(root)
  const clean = String(url || '').trim()
  if (!clean) throw err.bad('REMOTE_URL_REQUIRED', '请提供远端地址')
  if (!/^(https?:\/\/|git@|ssh:\/\/|file:\/\/|\/)/.test(clean)) {
    throw err.bad('REMOTE_URL_INVALID', `远端地址「${clean}」看起来不合法`,
      '支持 https://…、git@…:…、ssh://…、或本地路径')
  }

  const existing = getRemote(root, name)
  const r = existing
    ? git(root, ['remote', 'set-url', name, clean])
    : git(root, ['remote', 'add', name, clean])
  if (!r.ok) throw err.bad('GIT_REMOTE_FAILED', `设置远端失败：${r.err}`)
  return existing ? `已更新远端 ${name}` : `已添加远端 ${name}`
}

export function removeRemote(root, name = 'origin') {
  requireRepo(root)
  git(root, ['remote', 'remove', name])
  return true
}

/** 当前分支有没有上游。没有的话首次 push 需要 -u，否则 git 会报错要求指定 */
export function hasUpstream(root) {
  const r = git(root, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  return r.ok && !!r.out
}

// ==================== 同步 ====================

/**
 * 一条命令完成「把我的改动分享出去 + 拿到别人的改动」。
 *
 * 顺序是 commit → pull --rebase → push，不是 pull → commit：
 * 先提交能保证 rebase 时冲突落在自己的提交上，语义清楚；
 * 反过来做，未提交的改动会在 rebase 时被 stash 来 stash 去，出问题很难解释。
 *
 * @returns {{steps: Array<{name:string, ok:boolean, detail:string}>, conflicted:boolean}}
 */
export function sync(root, { message, push = true } = {}) {
  requireRepo(root)
  ensureRepoDefaults(root)
  const steps = []
  const record = (name, r, detail) => {
    steps.push({ name, ok: r.ok, detail: detail || r.err || r.out || '' })
    return r.ok
  }

  const st = status(root)
  if (st.conflicted.length) {
    return {
      steps: [{ name: '检查冲突', ok: false, detail: `还有 ${st.conflicted.length} 个文件处于冲突状态` }],
      conflicted: true,
      conflicts: st.conflicted
    }
  }

  // 1. 提交本地改动。只暂存 Flowlark 自己的路径，不碰用户放在旁边的文件。
  if (!st.clean) {
    const existing = OWNED_PATHS.filter((p) => fs.existsSync(path.join(root, p)))
    if (!record('暂存改动', git(root, ['add', '-A', '--', ...existing]))) {
      return { steps, conflicted: false }
    }
    if (st.foreignFiles.length) {
      steps.push({
        name: '跳过',
        ok: true,
        detail: `${st.foreignFiles.length} 个非 Flowlark 文件未提交（${st.foreignFiles.slice(0, 3).map((f) => f.path).join('、')}${st.foreignFiles.length > 3 ? '…' : ''}）`
      })
    }
    const msg = message || defaultCommitMessage(root, st)
    if (!record('提交', git(root, ['commit', '-m', msg]), `提交信息：${msg}`)) {
      return { steps, conflicted: false }
    }
  } else {
    steps.push({ name: '提交', ok: true, detail: '工作区干净，无需提交' })
  }

  if (!st.hasRemote) {
    steps.push({ name: '同步远端', ok: true, detail: '没有配置远端，跳过（本地提交已完成）' })
    return { steps, conflicted: false }
  }

  const upstream = hasUpstream(root)

  // 2. 拉取别人的改动。还没有上游时无从拉起，跳过直接进推送。
  if (upstream) {
    const pull = git(root, ['pull', '--rebase', '--autostash'])
    if (!pull.ok) {
      const after = status(root)
      steps.push({
        name: '拉取',
        ok: false,
        detail: after.conflicted.length
          ? `产生冲突：${after.conflicted.join('、')}`
          : pull.err
      })
      return { steps, conflicted: after.conflicted.length > 0, conflicts: after.conflicted }
    }
    steps.push({ name: '拉取', ok: true, detail: pull.out.includes('up to date') ? '已是最新' : '已合并远端改动' })
  } else {
    steps.push({ name: '拉取', ok: true, detail: '本分支还没有上游，跳过' })
  }

  // 3. 推送。首次推送要带 -u 建立上游，否则 git 会停下来问你推到哪。
  if (push) {
    const branch = status(root).branch || 'HEAD'
    const args = upstream ? ['push'] : ['push', '-u', 'origin', branch]
    if (!record('推送', git(root, args), upstream ? '' : `首次推送，已建立上游 origin/${branch}`)) {
      return { steps, conflicted: false }
    }
  }
  return { steps, conflicted: false }
}

/** 从改动的文件反推一条有意义的提交信息，比 "update" 强得多 */
function defaultCommitMessage(root, st) {
  const touched = new Set()
  let baselineChanged = false
  for (const f of st.files) {
    const m = /^projects\/([^/]+)\//.exec(f.path)
    if (m) touched.add(m[1])
    if (/\/BASELINE$/.test(f.path)) baselineChanged = true
  }
  const projects = [...touched]
  if (projects.length === 0) return 'flowlark: 更新原型仓库'
  const scope = projects.length === 1 ? projects[0] : `${projects.length} 个项目`
  return baselineChanged ? `flowlark: 更新 ${scope}（含基线变更）` : `flowlark: 更新 ${scope}`
}

// ==================== 历史 ====================

const LOG_FORMAT = '%H%x1f%h%x1f%an%x1f%aI%x1f%s'

function parseLog(out) {
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, short, author, date, subject] = line.split('\x1f')
      return { hash, short, author, date, subject }
    })
}

/** 某个文件的提交历史。--follow 让重命名也能追下去 */
export function fileHistory(root, relPath, limit = 50) {
  requireRepo(root)
  const r = git(root, ['log', '--follow', `--format=${LOG_FORMAT}`, `-${limit}`, '--', relPath])
  return r.ok ? parseLog(r.out) : []
}

/**
 * 一个版本的完整演进：元数据、规格书、原型文件三个文件的提交。
 *
 * 一次 git log 传三个 pathspec，而不是分别查了再按时间排 ——
 * 同一秒内的多个提交时间戳相同，自己排会得到不稳定的顺序，
 * 而 git log 本身就保证拓扑序（父提交一定排在子提交之后）。
 */
export function versionHistory(root, slug, versionNo, limit = 50) {
  requireRepo(root)
  const rel = (p) => path.relative(root, p)
  const kindOf = {
    [rel(paths.versionJson(root, slug, versionNo))]: '元数据',
    [rel(paths.versionSpec(root, slug, versionNo))]: '规格书',
    [rel(paths.versionHtml(root, slug, versionNo))]: '原型文件'
  }

  // \0 作为提交记录分隔符，--name-only 让每条记录后面跟上它改动的文件
  const r = git(root, [
    'log', `--format=%x00${LOG_FORMAT}`, '--name-only', `-${limit}`,
    '--', ...Object.keys(kindOf)
  ])
  if (!r.ok || !r.out) return []

  return r.out
    .split('\0')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const [header, ...files] = block.split('\n')
      const [hash, short, author, date, subject] = header.split('\x1f')
      const kinds = [...new Set(
        files.map((f) => f.trim()).filter(Boolean).map((f) => kindOf[f]).filter(Boolean)
      )]
      return { hash, short, author, date, subject, kinds }
    })
    .filter((c) => c.hash)
}

/** 基线变迁史：BASELINE 文件的每次提交，以及那次它指向了谁 */
export function baselineHistory(root, slug, limit = 50) {
  requireRepo(root)
  const rel = path.relative(root, paths.baselineFile(root, slug))
  const commits = fileHistory(root, rel, limit)
  return commits.map((c) => {
    const show = git(root, ['show', `${c.hash}:${rel}`])
    return { ...c, versionNo: show.ok ? show.out.trim() : null }
  })
}

/** 取某次提交时的文件内容，用于「规格书上周长什么样」 */
export function fileAt(root, relPath, ref) {
  requireRepo(root)
  const r = git(root, ['show', `${ref}:${relPath}`])
  if (!r.ok) {
    throw err.notFound(`${relPath} 在 ${ref} 处的内容`, '版本号或提交号可能不对')
  }
  return r.out
}

export function specAt(root, slug, versionNo, ref) {
  const rel = path.relative(root, paths.versionSpec(root, slug, versionNo))
  return fileAt(root, rel, ref)
}

// ==================== 冲突辅助 ====================

const CONFLICT_RE = /^<{7}[^\n]*\n([\s\S]*?)^={7}\n([\s\S]*?)^>{7}[^\n]*$/m

/**
 * 解析 BASELINE 文件的冲突。
 *
 * 这个冲突有个很好的性质：内容就是一行版本号，两边各自想把基线指向谁一目了然。
 * 所以不需要用户去理解 Git 冲突标记，直接问「保留哪个版本」就行。
 */
export function readBaselineConflict(root, slug) {
  const file = paths.baselineFile(root, slug)
  if (!fs.existsSync(file)) return null
  const raw = fs.readFileSync(file, 'utf8')
  const m = CONFLICT_RE.exec(raw)
  if (!m) return null
  const ours = m[1].trim()
  const theirs = m[2].trim()

  // rebase 期间 ours/theirs 是反的，而且反得很违反直觉：
  // rebase 把远端的提交当作基底，自己的提交是「被重放上去的那一个」，
  // 于是 <<<<<<< HEAD 那半边是「别人的」，>>>>>>> 那半边才是「我的」。
  // 界面上如果照搬 git 的用词，用户会稳定地选错基线 —— 必须在这里翻译好。
  const rebasing = inProgress(root) === 'rebase'
  return {
    ours,
    theirs,
    mine: rebasing ? theirs : ours,
    others: rebasing ? ours : theirs,
    rebasing,
    file: path.relative(root, file)
  }
}

/** 选定一边，写回文件并登记为已解决 */
export function resolveBaselineConflict(root, slug, versionNo) {
  const file = paths.baselineFile(root, slug)
  fs.writeFileSync(file, versionNo + '\n', 'utf8')
  const rel = path.relative(root, file)
  const r = git(root, ['add', rel])
  if (!r.ok) throw err.bad('GIT_STAGE_FAILED', `登记解决结果失败：${r.err}`)
  return { file: rel, versionNo }
}

/** 列出所有处于冲突状态的文件，并标出哪些是 Flowlark 能自动辅助解决的 */
export function listConflicts(root) {
  if (!isRepo(root)) return []
  const r = git(root, ['diff', '--name-only', '--diff-filter=U'])
  if (!r.ok || !r.out) return []
  return r.out.split('\n').filter(Boolean).map((p) => {
    const bm = /^projects\/([^/]+)\/BASELINE$/.exec(p)
    return {
      path: p,
      kind: bm ? 'BASELINE' : /\.json$/.test(p) ? 'JSON' : /\.md$/.test(p) ? 'MARKDOWN' : 'OTHER',
      project: bm ? bm[1] : null,
      assisted: !!bm
    }
  })
}

/** 谁最近碰过这个项目 */
export function contributors(root, slug, limit = 20) {
  requireRepo(root)
  const r = git(root, ['shortlog', '-sne', 'HEAD', '--', `projects/${slug}`])
  if (!r.ok) return []
  return r.out.split('\n').filter(Boolean).map((line) => {
    const m = /^\s*(\d+)\s+(.+?)\s+<(.*)>$/.exec(line)
    return m ? { commits: Number(m[1]), name: m[2], email: m[3] } : null
  }).filter(Boolean).slice(0, limit)
}


// ==================== Git 助手 ====================
//
// 这一段存在的理由：用户不该为了用这个软件去学 git。
// 以前遇到「没纳入 Git」「rebase 卡住了」，产品只会甩一句命令让人自己去终端敲，
// 那等于把最难的一步原样丢回给用户。下面把每种处境都变成一个可执行的动作。

/** 读取提交身份。没有身份 git 会在第一次提交时直接失败，得提前发现 */
export function identity(root) {
  const name = git(root, ['config', '--get', 'user.name']).out
  const email = git(root, ['config', '--get', 'user.email']).out
  return { name: name || '', email: email || '', complete: !!(name && email) }
}

export function setIdentity(root, { name, email, global: isGlobal = false } = {}) {
  requireRepo(root)
  const scope = isGlobal ? '--global' : '--local'
  const done = []
  if (name && String(name).trim()) {
    git(root, ['config', scope, 'user.name', String(name).trim()])
    done.push('姓名')
  }
  if (email && String(email).trim()) {
    git(root, ['config', scope, 'user.email', String(email).trim()])
    done.push('邮箱')
  }
  if (!done.length) throw err.bad('IDENTITY_EMPTY', '姓名和邮箱至少填一个')
  return { fields: done, scope: isGlobal ? '全局' : '本仓库' }
}

/**
 * git 中途停下来的三种状态。
 * rebase 停在冲突上时目录里会留下 rebase-merge/rebase-apply，
 * merge 停下来则是 MERGE_HEAD —— 这是唯一可靠的判定方式，
 * 靠解析 `git status` 的自然语言输出会随 git 版本和语言环境失效。
 */
export function inProgress(root) {
  if (!isRepo(root)) return null
  const dirOut = git(root, ['rev-parse', '--git-dir'])
  if (!dirOut.ok) return null
  const gitDir = path.resolve(root, dirOut.out)
  if (fs.existsSync(path.join(gitDir, 'rebase-merge')) ||
      fs.existsSync(path.join(gitDir, 'rebase-apply'))) return 'rebase'
  if (fs.existsSync(path.join(gitDir, 'MERGE_HEAD'))) return 'merge'
  if (fs.existsSync(path.join(gitDir, 'CHERRY_PICK_HEAD'))) return 'cherry-pick'
  return null
}

/**
 * 把仓库纳入 Git：init + 默认配置 + 身份 + 首次提交，一次做完。
 * 拆成四条命令让用户自己敲，只会在任意一步卡住。
 */
export function initRepo(root, { name, email, message } = {}) {
  if (!available()) {
    throw err.bad('GIT_MISSING', '系统里没有找到 git',
      'macOS 上在终端运行 xcode-select --install 即可获得 git')
  }
  const steps = []
  if (isRepo(root)) {
    steps.push({ name: '初始化', ok: true, detail: '已经是 Git 仓库，跳过' })
  } else {
    const r = git(root, ['init'])
    if (!r.ok) throw err.bad('GIT_INIT_FAILED', `初始化失败：${r.err}`)
    steps.push({ name: '初始化', ok: true, detail: `已在 ${root} 建立 Git 仓库` })
  }

  const applied = ensureRepoDefaults(root)
  steps.push({ name: '默认配置', ok: true, detail: applied.length ? applied.join('；') : '已是推荐配置' })

  if (name || email) setIdentity(root, { name, email })
  const who = identity(root)
  if (!who.complete) {
    steps.push({
      name: '提交身份',
      ok: false,
      detail: '还没有配置姓名和邮箱，Git 会拒绝提交。在设置里填一次即可'
    })
    return { steps, committed: false, needIdentity: true }
  }
  steps.push({ name: '提交身份', ok: true, detail: `${who.name} <${who.email}>` })

  const owned = OWNED_PATHS.filter((p) => fs.existsSync(path.join(root, p)))
  const add = git(root, ['add', '--', ...owned])
  if (!add.ok) throw err.bad('GIT_STAGE_FAILED', `暂存失败：${add.err}`)

  const staged = git(root, ['diff', '--cached', '--name-only']).out
  if (!staged) {
    steps.push({ name: '首次提交', ok: true, detail: '没有需要提交的内容' })
    return { steps, committed: false, needIdentity: false }
  }

  const msg = String(message || '').trim() || 'chore: 用 Flowlark 管理原型仓库'
  const commit = git(root, ['commit', '-m', msg])
  if (!commit.ok) throw err.bad('GIT_COMMIT_FAILED', `提交失败：${commit.err}`)
  steps.push({
    name: '首次提交',
    ok: true,
    detail: `${staged.split('\n').filter(Boolean).length} 个文件已提交`
  })
  return { steps, committed: true, needIdentity: false }
}

/** 用户在编辑器里改完了冲突文件，登记为「已解决」 */
export function markResolved(root, relPaths) {
  requireRepo(root)
  const list = (Array.isArray(relPaths) ? relPaths : [relPaths]).map(String).filter(Boolean)
  if (!list.length) throw err.bad('NO_FILES', '没有指定文件')

  const still = new Set(listConflicts(root).map((c) => c.path))
  for (const rel of list) {
    if (!still.has(rel)) continue
    const full = path.join(root, rel)
    if (fs.existsSync(full) && /<{7} |={7}$|>{7} /m.test(fs.readFileSync(full, 'utf8'))) {
      throw err.bad('CONFLICT_MARKERS_LEFT', `${rel} 里还留着冲突标记`,
        '把 <<<<<<< ======= >>>>>>> 三行连同不要的那一半删掉，只留最终内容')
    }
  }
  const r = git(root, ['add', '--', ...list])
  if (!r.ok) throw err.bad('GIT_STAGE_FAILED', `登记失败：${r.err}`)
  return { files: list }
}

/**
 * 冲突全部解决后，让 git 接着往下走。
 * GIT_EDITOR=true 是关键：不设的话 git 会打开 vim 等用户写提交信息，
 * 而我们是在图形界面或非交互 CLI 里调它，用户只会看到程序卡住。
 */
export function continueInProgress(root) {
  requireRepo(root)
  const state = inProgress(root)
  if (!state) return { state: null, done: true, message: '没有正在进行的合并，无需继续' }

  const remaining = listConflicts(root)
  if (remaining.length) {
    throw err.bad('CONFLICTS_REMAIN', `还有 ${remaining.length} 个文件没解决`,
      remaining.map((c) => c.path).join('、'))
  }

  // 解决冲突的过程本身会往 oplog 里写一条记录，于是 oplog 变成「已暂存又被改过」。
  // git 认为工作区没整理干净，拒绝继续，还会给出一句指向 git add 的提示 ——
  // 那正是我们不想让用户看到的东西。这里把自己管的文件先收进暂存区。
  const owned = OWNED_PATHS.filter((p) => fs.existsSync(path.join(root, p)))
  if (owned.length) git(root, ['add', '--', ...owned])

  const cmd = state === 'rebase' ? ['rebase', '--continue']
    : state === 'merge' ? ['commit', '--no-edit']
      : ['cherry-pick', '--continue']
  const r = spawnSync('git', cmd, {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, GIT_EDITOR: 'true' },
    maxBuffer: 32 * 1024 * 1024
  })
  if (r.status !== 0) {
    const stillConflicted = listConflicts(root)
    if (stillConflicted.length) {
      return { state, done: false, conflicts: stillConflicted, message: '继续时又遇到了下一批冲突' }
    }
    // git 这类提示常走 stdout 而不是 stderr，只读 stderr 会得到一句空错误
    const why = [(r.stderr || '').trim(), (r.stdout || '').trim()].filter(Boolean).join('\n')
    throw err.bad('GIT_CONTINUE_FAILED', '继续失败', why || '没有更多信息，可以试试放弃这次同步再重来')
  }
  const after = inProgress(root)
  return {
    state,
    done: !after,
    conflicts: listConflicts(root),
    message: after ? '还有后续提交要处理，可以再点一次继续' : '合并已完成'
  }
}

/** 放弃这次合并，回到操作之前的状态 */
export function abortInProgress(root) {
  requireRepo(root)
  const state = inProgress(root)
  if (!state) return { state: null, aborted: false, message: '没有正在进行的合并' }
  const cmd = state === 'rebase' ? ['rebase', '--abort']
    : state === 'merge' ? ['merge', '--abort'] : ['cherry-pick', '--abort']
  const r = git(root, cmd)
  if (!r.ok) throw err.bad('GIT_ABORT_FAILED', `放弃失败：${r.err}`)
  return { state, aborted: true, message: '已回到同步之前的状态，本地改动没有丢' }
}

/**
 * Git 助手的核心：看一眼当前处境，给出一件该做的事。
 *
 * 返回的每条 action 都是产品自己能执行的动作（有 api 字段），
 * 而不是让用户去终端敲的命令 —— 这是这个模块存在的全部意义。
 */
export function diagnose(root) {
  const checks = []
  const actions = []
  const push = (level, title, detail, action) => {
    checks.push({ level, title, detail })
    if (action) actions.push(action)
  }

  if (!available()) {
    push('error', '没装 Git', '同步、历史、协作都依赖它',
      { key: 'install-git', label: '查看安装方法', kind: 'link',
        detail: 'macOS：终端运行 xcode-select --install；其他系统见 git-scm.com/downloads' })
    return { ok: false, stage: 'no-git', checks, actions }
  }

  if (!isRepo(root)) {
    push('error', '还没纳入 Git', '纳入之后才有历史、协作和冲突处理',
      { key: 'init', label: '纳入 Git 管理', kind: 'primary', api: 'POST /api/git/init' })
    return { ok: false, stage: 'no-repo', checks, actions }
  }
  push('ok', '已纳入 Git', root)

  const who = identity(root)
  if (!who.complete) {
    push('error', '缺少提交身份', 'Git 需要知道提交是谁做的，否则会拒绝提交',
      { key: 'identity', label: '填写姓名和邮箱', kind: 'primary', api: 'PUT /api/git/identity' })
  } else {
    push('ok', '提交身份', `${who.name} <${who.email}>`)
  }

  const state = inProgress(root)
  const conflicts = listConflicts(root)
  if (state) {
    if (conflicts.length) {
      const assisted = conflicts.filter((c) => c.assisted).length
      push('warn', `${state === 'rebase' ? '同步' : '合并'}停在冲突上`,
        `${conflicts.length} 个文件待处理${assisted ? `，其中 ${assisted} 个可以一键选择` : ''}`,
        { key: 'resolve', label: '去处理冲突', kind: 'primary', api: 'GET /api/git/conflicts' })
    } else {
      push('warn', '冲突已解决，还差最后一步', '让 Git 接着把这次同步走完',
        { key: 'continue', label: '继续完成同步', kind: 'primary', api: 'POST /api/git/continue' })
    }
    actions.push({ key: 'abort', label: '放弃这次同步', kind: 'danger', api: 'POST /api/git/abort' })
    return { ok: false, stage: 'conflicted', checks, actions }
  }

  const st = status(root, { includeForeign: false })
  const remote = getRemote(root)
  if (!remote) {
    push('warn', '没有配置远端', '只在本机留存，换台机器或团队协作需要远端仓库',
      { key: 'remote', label: '配置远端地址', kind: 'default', api: 'PUT /api/git/remote' })
  } else {
    push('ok', '远端', remote.url)
  }

  if (!st.clean) {
    push('warn', `${st.files.length} 处改动还没提交`, '提交后这些改动才进入历史，别人也才看得到',
      { key: 'sync', label: remote ? '提交并同步' : '提交到本地', kind: 'primary', api: 'POST /api/git/sync' })
  } else if (st.ahead) {
    push('warn', `本地领先远端 ${st.ahead} 个提交`, '推送后团队才能拿到',
      { key: 'sync', label: '推送到远端', kind: 'primary', api: 'POST /api/git/sync' })
  } else if (st.behind) {
    push('warn', `落后远端 ${st.behind} 个提交`, '拉下来才是最新的',
      { key: 'sync', label: '拉取更新', kind: 'primary', api: 'POST /api/git/sync' })
  } else {
    push('ok', '工作区', '干净，且与远端一致')
  }

  return {
    ok: checks.every((c) => c.level === 'ok'),
    stage: checks.some((c) => c.level === 'error') ? 'blocked' : st.clean && !st.ahead && !st.behind ? 'clean' : 'pending',
    checks,
    actions,
    branch: st.branch,
    identity: who,
    remote
  }
}
