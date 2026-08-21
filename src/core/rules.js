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

export const DISPLAY = {
  DRAFT: { key: 'DRAFT', label: '编辑中', short: '草稿', color: 'gold' },
  BASELINE: { key: 'BASELINE', label: '已确认 · 当前基线', short: '基线', color: 'blue' },
  HISTORY: { key: 'HISTORY', label: '历史版本', short: '历史', color: 'default' },
  VOID: { key: 'VOID', label: '已废弃', short: '废弃', color: 'red' }
}

export const CHANGE_TYPES = ['ADD', 'MODIFY', 'REMOVE']
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

/**
 * R4：只有「编辑中」的版本能改结构性内容（原型文件、标题、变更日志、关联需求）。
 * 规格书不走这个校验 —— 见 assertSpecEditable。
 */
export function assertEditable(version, baselineNo, what, { enabled = true } = {}) {
  // 配置项 rules.lockBaseline 可以关掉这条约束。关掉后原型就失去追溯证据的效力，
  // 所以默认开启，且在设置页里标为高风险开关。
  if (!enabled) return
  const st = displayStatus(version, baselineNo)
  if (st.key !== 'DRAFT') {
    throw err.bad(
      'VERSION_LOCKED',
      `${version.versionNo} 当前是「${st.label}」，${what}已锁定`,
      '原型是需求追溯的证据，确认后就不该再变。要改请新建版本；规格书、标签、附件不受此限制。'
    )
  }
}

/** R4 的另一半：规格书是活文档，除了已废弃版本，任何状态都能改 */
export function assertSpecEditable(version) {
  if (version.status === 'VOID') {
    throw err.bad('VERSION_VOID', `${version.versionNo} 已废弃，不可编辑`, '先执行 reopen 恢复为编辑中')
  }
}

/**
 * R6：设为基线前必须有变更日志。两种豁免：
 *   1) 项目的首个版本 —— 它没有「上一版」可对比；
 *   2) 曾经当过基线的版本（baselineAt 非空）—— 这是 R3 的回滚路径。
 *
 * 第二条是上一版实现跑测试才发现的：首版靠豁免成为基线时没有变更日志，
 * 等它被顶替成历史版本后想回滚就会被 R6 卡住 —— 而回滚正是新版出问题时的止血动作。
 * R6 该约束的是「向前推进」，不是「往回退」。
 */
export function assertChangelogReady(version, totalVersionCount, { enabled = true } = {}) {
  // 配置项 rules.requireChangelog 可以关掉。关掉后研发无法判断每版改了什么，
  // 这个产品最核心的价值就没了，所以默认开启。
  if (!enabled) return
  const isFirstEver = totalVersionCount <= 1
  const wasBaselineBefore = !!version.baselineAt
  if (version.changes.length === 0 && !isFirstEver && !wasBaselineBefore) {
    throw err.bad(
      'CHANGELOG_REQUIRED',
      `${version.versionNo} 的变更日志为空，不能设为基线`,
      `补一条：protohub add-change <项目> ${version.versionNo} -m "修改:位置:改了什么"`
    )
  }
}

/** 基线保护：删除与废弃都不能作用于当前基线，否则研发会失去参照 */
export function assertNotBaseline(version, baselineNo, action) {
  if (isBaseline(version, baselineNo)) {
    throw err.bad(
      'BASELINE_PROTECTED',
      `${version.versionNo} 是当前基线，不能${action}`,
      '先把其他版本设为基线：protohub baseline <项目> <版本号>'
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
