/**
 * 稳定 JSON 序列化。
 *
 * Git 友好不是「写成 JSON」就完事了 —— 键顺序随机、缩进不一致、数组挤成一行，
 * diff 一样没法看。这里强制按 schema 顺序输出键，改一条变更日志，diff 就正好是一行。
 */

/** 各实体的键顺序。未列出的键排在末尾，按字母序，保证输出仍然是确定的。 */
const KEY_ORDER = {
  repo: ['schemaVersion', 'name', 'createdAt', 'settings'],
  project: ['slug', 'name', 'code', 'description', 'priority', 'archived', 'createdAt', 'createdBy', 'updatedAt', 'updatedBy'],
  version: [
    'versionNo', 'title', 'status', 'reviewStatus', 'note', 'tags',
    'file', 'fileSize', 'sourcePath', 'externalRefs',
    'changes', 'requirements', 'attachments',
    'createdAt', 'createdBy', 'updatedAt', 'baselineAt', 'specUpdatedAt'
  ],
  change: ['type', 'location', 'content', 'requirement'],
  requirement: ['code', 'title', 'description', 'project', 'module', 'type', 'priority', 'owner', 'dueDate', 'statusOverride', 'external', 'url', 'createdAt', 'updatedAt'],
  milestone: ['name', 'title', 'startAt', 'endAt', 'items', 'external', 'createdAt', 'updatedAt'],
  snapshot: ['name', 'title', 'milestone', 'items', 'changesDigest', 'createdAt', 'createdBy'],
  attachment: ['name', 'size', 'contentType', 'addedAt', 'addedBy'],
  mcp: ['schemaVersion', 'servers', 'capabilities']
}

function orderKeys(obj, schema) {
  const order = KEY_ORDER[schema] || []
  const known = order.filter((k) => k in obj)
  const rest = Object.keys(obj).filter((k) => !order.includes(k)).sort()
  const out = {}
  for (const k of [...known, ...rest]) out[k] = obj[k]
  return out
}

/** 深度整理：对已知 schema 的对象排键，数组元素按元素 schema 递归 */
const ITEM_SCHEMA = { changes: 'change', requirements: 'requirement', attachments: 'attachment' }

function normalize(value, schema) {
  if (Array.isArray(value)) {
    return value.map((v) => normalize(v, ITEM_SCHEMA[schema] || null))
  }
  if (value && typeof value === 'object') {
    const ordered = orderKeys(value, schema)
    const out = {}
    for (const [k, v] of Object.entries(ordered)) {
      out[k] = normalize(v, ITEM_SCHEMA[k] ? k : null)
    }
    return out
  }
  return value
}

/** 序列化为写入磁盘的字符串。末尾保留换行，否则每次改动 diff 都会多一行噪音。 */
export function stringify(obj, schema) {
  return JSON.stringify(normalize(obj, schema), null, 2) + '\n'
}

export function parse(text, what = 'JSON') {
  try {
    return JSON.parse(text)
  } catch (e) {
    throw new Error(`${what} 解析失败：${e.message}`)
  }
}
