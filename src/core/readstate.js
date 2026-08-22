import fs from 'node:fs'
import path from 'node:path'

/**
 * 已读标记：「我上次看到哪一版」。
 *
 * 关键决定是**不进 Git**。已读状态是每个人自己的，提交上去会变成
 * 「张三把李四标成已读」这种荒唐的冲突。所以放在 .flowlark/cache/ 下 ——
 * init 生成的 .gitignore 已经忽略了这个目录，向后兼容，老仓库也不用改配置。
 *
 * 它真正的用处是给 diff 一个默认起点：研发上次看的是 v1.0，现在基线是 v1.3，
 * `flowlark diff` 不带参数就该显示这三版的变更合集，而不是让他自己去想起点。
 */

const FILE = 'read-state.json'

function file(root) {
  return path.join(root, '.flowlark', 'cache', FILE)
}

function load(root) {
  const f = file(root)
  if (!fs.existsSync(f)) return {}
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8'))
  } catch {
    // 本地缓存损坏没什么可惜的，重来即可
    return {}
  }
}

function save(root, data) {
  const f = file(root)
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, JSON.stringify(data, null, 2) + '\n', 'utf8')
}

/** @returns {{versionNo: string, at: string}|null} */
export function getRead(root, slug) {
  const d = load(root)
  return d[slug] || null
}

export function markRead(root, slug, versionNo) {
  const d = load(root)
  d[slug] = { versionNo, at: new Date().toISOString() }
  save(root, d)
  return d[slug]
}

export function clearRead(root, slug = null) {
  if (!slug) return save(root, {})
  const d = load(root)
  delete d[slug]
  save(root, d)
}

export function allRead(root) {
  return load(root)
}

/**
 * 判断哪些版本是「上次看过之后新增的」。
 * 按时间线顺序（倒序）算：已读版本之前的都算新。
 * @param {Array} orderedVersions 时间倒序的版本列表
 */
export function markUnread(root, slug, orderedVersions) {
  const read = getRead(root, slug)
  if (!read) {
    // 从没标记过就不显示「新」—— 全部标新等于没标
    return orderedVersions.map((v) => ({ ...v, isNew: false }))
  }
  const idx = orderedVersions.findIndex((v) => v.versionNo === read.versionNo)
  return orderedVersions.map((v, i) => ({
    ...v,
    isNew: idx >= 0 ? i < idx : false,
    isLastRead: v.versionNo === read.versionNo
  }))
}
