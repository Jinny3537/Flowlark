import { err } from './errors.js'

/**
 * 版本状态与业务规则。这里是 R1–R7 的唯一定义处，CLI 和 HTTP 都从这里取。
 *
 * 与早先 SQLite 版本最大的不同：**「是不是当前基线」不再是存储字段，而是派生值**。
 * 存的只有 status(DRAFT/READY/VOID) 和 baselineAt，基线归属由 BASELINE 文件决定。
 * 没有冗余字段，也就没有「降级忘了写」这类脏状态的容身之处。
 */

/** 落盘的状态。注意没有 BASELINE 和 HISTORY —— 那两个是算出来的。 */
export const STORED_STATUS = ['DRAFT', 'READY', 'VOID']
export const REVIEW_STATUSES = ['pending', 'confirmed', 'questions', 'obsolete']

export function assertReviewStatus(status) {
  if (!REVIEW_STATUSES.includes(status)) throw err.bad('REVIEW_STATUS_INVALID', `不支持的审阅状态：${status}`)
  return status
}

export const DISPLAY = {
  DRAFT: { key: 'DRAFT', label: '编辑中', short: '草稿', color: 'gold' },
  BASELINE: { key: 'BASELINE', label: '已确认 · 当前基线', short: '基线', color: 'blue' },
  HISTORY: { key: 'HISTORY', label: '历史版本', short: '历史', color: 'default' },
  VOID: { key: 'VOID', label: '已废弃', short: '废弃', color: 'red' }
}

export const CHANGE_LABEL = { ADD: '新增', MODIFY: '修改', REMOVE: '删除' }

/** 中文/英文都接受，方便 CLI 里直接写 `-m 新增:位置:说明` */
const CHANGE_ALIAS = {
  ADD: 'ADD', 新增: 'ADD', A: 'ADD', '+': 'ADD',
  MODIFY: 'MODIFY', 修改: 'MODIFY', M: 'MODIFY', '~': 'MODIFY',
  REMOVE: 'REMOVE', 删除: 'REMOVE', DEL: 'REMOVE', R: 'REMOVE', '-': 'REMOVE'
}

export function normalizeChangeType(raw) {
  const key = String(raw || 'MODIFY').trim().toUpperCase()
  const t = CHANGE_ALIAS[key] || CHANGE_ALIAS[String(raw || '').trim()]
  if (!t) {
    throw err.bad('CHANGE_TYPE_INVALID', `变更类型「${raw}」不合法`, '可用：新增/修改/删除，或 ADD/MODIFY/REMOVE')
  }
  return t
}

/**
 * R1：由存储状态 + 基线指针派生出展示状态。
 * @param {object} version 版本对象
 * @param {string|null} baselineNo BASELINE 文件的内容
 */
export function displayStatus(version, baselineNo) {
  if (version.status === 'VOID') return DISPLAY.VOID
  if (baselineNo && version.versionNo === baselineNo) return DISPLAY.BASELINE
  if (version.baselineAt) return DISPLAY.HISTORY
  return DISPLAY.DRAFT
}

export function isBaseline(version, baselineNo) {
  return !!baselineNo && version.versionNo === baselineNo
}

/** 基线仅表示状态；结构性编辑仍遵守废弃版本不可编辑的约束。 */
export function assertEditable(version) {
  assertSpecEditable(version)
}

/** R4 的另一半：规格书是活文档，除了已废弃版本，任何状态都能改 */
export function assertSpecEditable(version) {
  if (version.status === 'VOID') {
    throw err.bad('VERSION_VOID', `${version.versionNo} 已废弃，不可编辑`, '先执行 reopen 恢复为编辑中')
  }
}

/** 正式发版的日志检查；单独设定基线不调用此校验。 */
export function assertChangelogReady(version, totalVersionCount, { enabled = true } = {}) {
  // 配置项 rules.requireChangelog 可以关掉。关掉后研发无法判断每版改了什么，
  // 这个产品最核心的价值就没了，所以默认开启。
  if (!enabled) return
  const isFirstEver = totalVersionCount <= 1
  const wasBaselineBefore = !!version.baselineAt
  if (version.changes.length === 0 && !isFirstEver && !wasBaselineBefore) {
    throw err.bad(
      'CHANGELOG_REQUIRED',
      `${version.versionNo} 的变更日志为空，不能正式发版`,
      `补一条：flowlark add-change <项目> ${version.versionNo} -m "修改:位置:改了什么"`
    )
  }
}

/** 时间线排序：创建时间倒序，版本号兜底。仅按时间排，同一秒创建的两版顺序会飘。 */
export function sortVersions(versions) {
  return [...versions].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1
    return a.versionNo < b.versionNo ? 1 : -1
  })
}
