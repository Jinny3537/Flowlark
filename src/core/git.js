import { spawnSync } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { err } from './errors.js'
import { paths } from './store.js'

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
      `在 ${root} 执行：git init && git add . && git commit -m "init"`)
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

export function isOwnedPath(p) {
  return OWNED_PATHS.some((own) => p === own || p.startsWith(own + '/'))
}

const XY = {
  '??': '未跟踪', 'A ': '新增', 'M ': '已暂存', ' M': '已修改',
  'MM': '部分暂存', 'D ': '已删除', ' D': '已删除', 'R ': '重命名', 'UU': '冲突'
}

export function status(root) {
  if (!available() || !isRepo(root)) {
    return { tracked: false, clean: true, files: [], branch: null, ahead: 0, behind: 0, conflicted: [] }
  }
  const porcelain = git(root, ['status', '--porcelain=v1', '--branch'])
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

  // 未跟踪的目录 git 只报目录名（如 "projects/"），归属判断要容忍尾部斜杠
  const own = files.filter((f) => isOwnedPath(f.path.replace(/\/$/, '')))
  const foreign = files.filter((f) => !isOwnedPath(f.path.replace(/\/$/, '')))

  return {
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
    hasRemote: !!git(root, ['remote']).out
  }
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

/** 两次提交之间某个文件的差异，直接给 git 的彩色输出 */
export function diffFile(root, relPath, from, to = 'HEAD', { color = false } = {}) {
  requireRepo(root)
  const args = ['diff', color ? '--color=always' : '--no-color', `${from}..${to}`, '--', relPath]
  return git(root, args).out
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
  return {
    ours: m[1].trim(),
    theirs: m[2].trim(),
    file: path.relative(root, file)
  }
}

/** 选定一边，写回文件并 git add */
export function resolveBaselineConflict(root, slug, versionNo) {
  const file = paths.baselineFile(root, slug)
  fs.writeFileSync(file, versionNo + '\n', 'utf8')
  const rel = path.relative(root, file)
  const r = git(root, ['add', rel])
  if (!r.ok) throw err.bad('GIT_ADD_FAILED', `git add 失败：${r.err}`)
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
