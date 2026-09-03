import * as G from './git.js'
import { readProject } from './store.js'

/**
 * AI 助理交接。
 *
 * Flowlark 自己不接 AI —— 不想为了生成一句提交说明就要求用户去申请
 * API key、配置模型、承担把仓库内容发到第三方的风险。
 *
 * 但现在大部分人手边都有 AI 助理（Claude Code、Cursor、各种终端 Agent），
 * 那些工具已经能读仓库、能执行 git。真正缺的是「上下文」：
 * 助理不知道 BASELINE 是一行文本、不知道哪些路径归 Flowlark 管、
 * 不知道 oplog 是 union 合并的，于是会给出错误的建议。
 *
 * 所以这一层做的是把处境和规则整理成一段可以直接粘给助理的说明。
 * 交出去的是描述，不是数据：只有路径、状态和规则，没有原型内容。
 */

/** 助理必须知道、否则一定会做错的仓库约定 */
const RULES = [
  '这是一个 Flowlark 原型仓库。数据全是纯文本文件，没有数据库。',
  '`projects/<项目>/BASELINE` 是一个只有一行的文件，内容是当前基线版本号。' +
    '它冲突时不要合并两边，必须二选一，保留其中一行。',
  '`projects/<项目>/versions/*.json` 键序固定，冲突通常可以逐字段取舍。',
  '`.flowlark/oplog.ndjson` 已配置为 merge=union，只追加，不要手工改。',
  '`*.html` 在 .gitattributes 里标记为 binary，不要尝试合并原型文件本身，整份二选一。',
  'Flowlark 只管这些路径：' + G.OWNED_PATHS.join('、') + '。仓库里其他文件属于用户，不要擅自提交。'
]

function conflictBrief(root) {
  const conflicts = G.listConflicts(root)
  if (!conflicts.length) return null
  const lines = conflicts.map((c) => {
    if (!c.assisted) return `- ${c.path}（${c.kind}）`
    const info = G.readBaselineConflict(root, c.project)
    return info
      ? `- ${c.path}：${c.project} 的基线，我这边是 ${info.mine}，对方是 ${info.others}，需要二选一` +
        (info.rebasing ? '（注意：正在 rebase，git 的 ours/theirs 与直觉相反，别按标记名猜）' : '')
      : `- ${c.path}：基线冲突`
  })
  return lines.join('\n')
}

/** 从待提交文件反推「这次改了什么」，让助理不必自己去猜 */
export function changeSummary(root, limit = 40) {
  const st = G.status(root)
  const projects = new Map()
  const internal = []          // 归 Flowlark 管、但不属于某个具体项目（如 oplog、仓库配置）
  const other = (st.foreignFiles || []).map((f) => f.path)   // 用户自己的文件，不该被卷进提交

  // st.files 已经只含 Flowlark 管理的路径；真正「不该提交」的是 foreignFiles。
  // 早先把解析不出项目的路径当成外来文件，结果 .flowlark/oplog.ndjson
  // 被写进「请不要提交」清单里 —— 正好说反了。
  for (const f of st.files.slice(0, 200)) {
    // 先认项目，再在项目内部认版本号。分两步是因为项目下还有 project.json、
    // 附件目录等不带版本号的文件，它们同样属于这个项目，不该被划成「内部文件」。
    const m = /^projects\/([^/]+)\//.exec(f.path)
    if (!m) { internal.push(f.path); continue }
    const slug = m[1]
    // 版本号本身含点（v1.0），所以不能用 [^.]+ 截断 ——
    // 只能从右边剥掉已知的后缀：.json / .html / .spec.md / .files/
    const vm = /^projects\/[^/]+\/versions\/(.+?)(?:\.spec\.md|\.json|\.html|\.files(?:\/.*)?)$/.exec(f.path)
    if (!projects.has(slug)) projects.set(slug, { versions: new Set(), baseline: false, paths: [] })
    const entry = projects.get(slug)
    entry.paths.push(f.path)
    if (f.path.endsWith('/BASELINE')) entry.baseline = true
    const ver = vm && vm[1]
    if (ver) entry.versions.add(ver)
  }

  const items = []
  for (const [slug, e] of projects) {
    let name = slug
    try {
      const meta = readProject(root, slug)
      if (meta && meta.name) name = meta.name
    } catch { /* 项目可能正好是这次新增的、或已被删，读不到就退回 slug */ }
    const bits = []
    if (e.versions.size) bits.push(`版本 ${[...e.versions].sort().join('、')}`)
    if (e.baseline) bits.push('基线变更')
    items.push({ slug, name, detail: bits.join('，') || `${e.paths.length} 处改动`, count: e.paths.length })
  }
  return {
    items: items.slice(0, limit),
    internal: internal.slice(0, limit),
    other: other.slice(0, limit),
    total: st.files.length
  }
}

/**
 * 生成一段可以直接粘贴给 AI 助理的说明。
 *
 * @param {string} root
 * @param {'commit'|'conflict'|'setup'} intent
 */
export function brief(root, intent = 'commit') {
  const tracked = G.isRepo(root)
  const state = tracked ? G.inProgress(root) : null
  const stuck = !!state || (tracked && G.listConflicts(root).length > 0)
  const resolved = stuck ? 'conflict' : intent

  const head = [
    '我在用 Flowlark 管理产品原型仓库，需要你帮我处理 Git。',
    '',
    `仓库路径：${root}`
  ]
  if (tracked) {
    const st = G.status(root)
    const who = G.identity(root)
    head.push(`当前分支：${st.branch || '（未知）'}`)
    head.push(`提交身份：${who.complete ? `${who.name} <${who.email}>` : '未配置'}`)
    const remote = G.getRemote(root)
    head.push(`远端：${remote ? remote.url : '未配置'}`)
  } else {
    head.push('这个目录还没有纳入 Git。')
  }

  const body = []
  if (resolved === 'conflict') {
    body.push('', '## 现在的处境', `Git 停在${state === 'rebase' ? '一次 rebase' : '一次合并'}上，下面这些文件有冲突：`, '')
    body.push(conflictBrief(root) || '（没有读到冲突文件）')
    body.push('', '## 我要你做的', '1. 逐个打开上面的文件，按下面的仓库规则判断该保留哪一边；',
      '2. 拿不准的地方先问我，不要自己猜；',
      '3. 处理完把文件登记为已解决，然后让这次同步继续走完；',
      '4. 完成后告诉我每个文件最终留下了什么。')
  } else if (resolved === 'setup') {
    body.push('', '## 我要你做的',
      '1. 把这个目录初始化成 Git 仓库；',
      '2. 确认提交身份已配置；',
      '3. 只提交下面「Flowlark 管理的路径」，不要把目录里其他文件卷进去；',
      '4. 如果我给了远端地址，配置好并推送。')
  } else {
    const sum = changeSummary(root)
    body.push('', '## 待提交的改动', sum.total ? `共 ${sum.total} 处：` : '（工作区是干净的）')
    for (const it of sum.items) body.push(`- ${it.name}（${it.slug}）：${it.detail}`)
    for (const p2 of sum.internal) body.push(`- ${p2}（仓库内部文件，跟着一起提交即可）`)
    if (sum.other.length) {
      body.push('', '不属于 Flowlark 管理范围、请不要提交的文件：')
      for (const p of sum.other) body.push(`- ${p}`)
    }
    body.push('', '## 我要你做的',
      '1. 看一眼这些改动的实际内容；',
      '2. 写一条中文提交说明，一行标题概括这次改了哪个项目的哪些版本，必要时补一段正文；',
      '3. 只暂存 Flowlark 管理的路径；',
      '4. 提交，如果配了远端就推上去；遇到冲突停下来问我。')
  }

  const tail = ['', '## 仓库规则（必须遵守）']
  RULES.forEach((r, i) => tail.push(`${i + 1}. ${r}`))
  tail.push('', '注意：不要修改任何原型 HTML 的内容，你的工作只涉及 Git 本身。')

  return [...head, ...body, ...tail].join('\n')
}

/**
 * 没有 AI 时的兜底：从改动本身推一条提交说明。
 * 规则简单直白，不追求漂亮，只求准确 —— 写不准还不如不写。
 */
export function suggestMessage(root) {
  const sum = changeSummary(root)
  if (!sum.total) return null
  if (!sum.items.length) return `chore: 更新 ${sum.total} 个文件`

  if (sum.items.length === 1) {
    const it = sum.items[0]
    return `${it.name}：${it.detail}`
  }
  const names = sum.items.slice(0, 3).map((i) => i.name).join('、')
  const more = sum.items.length > 3 ? ` 等 ${sum.items.length} 个项目` : ''
  return `更新 ${names}${more}`
}

export { RULES as ASSISTANT_RULES }
