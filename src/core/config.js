import { err } from './errors.js'

/**
 * 配置中心。
 *
 * 单一 schema 驱动 CLI、Web 设置页和文档 —— 加一项配置只改这里一处，
 * 三边自动跟上。否则 CLI 支持的键和网页表单里的字段迟早对不上。
 */

export const GROUPS = [
  { key: 'server', label: '服务与网络' },
  { key: 'git', label: 'Git 与身份' },
  { key: 'rules', label: '业务规则' },
  { key: 'integrations', label: '反馈与集成' },
  { key: 'ui', label: '外观与默认值' }
]

/**
 * type: int | bool | string | port | bytes | list
 * danger: 关掉会削弱产品核心保证的开关，UI 上要显式警示
 */
export const SCHEMA = [
  // ---------- 服务与网络 ----------
  {
    key: 'server.port', type: 'port', default: 7788, label: '工作台端口',
    note: '浏览器工作台与 API 的监听端口'
  },
  {
    key: 'server.previewPort', type: 'port', default: 7789, label: '预览端口',
    note: '原型沙箱的独立端口。必须与工作台端口不同，这是隔离的实现方式'
  },
  {
    key: 'server.lan', type: 'bool', default: false, label: '开放局域网访问',
    note: '关闭时只监听 127.0.0.1；开启后同网段的同事可以直接打开工作台看原型'
  },
  {
    key: 'server.readonlyFromLan', type: 'bool', default: true, label: '局域网只读',
    danger: true,
    note: '开启时局域网来的请求只能读，写操作仅限本机。关掉意味着同网段任何人都能删版本、改基线'
  },
  {
    key: 'server.maxFileBytes', type: 'bytes', default: 10 * 1024 * 1024, label: '单文件上限',
    note: '原型 HTML 与附件的大小上限'
  },

  // ---------- Git 与身份 ----------
  {
    key: 'git.remote', type: 'string', default: '', label: '远端地址',
    note: '设置后会写入 git remote origin，flowlark sync 就能推送'
  },
  {
    key: 'git.defaultBranch', type: 'string', default: '', label: '默认分支',
    note: '留空则用当前分支'
  },
  {
    key: 'git.userName', type: 'string', default: '', label: '提交人名称',
    note: '留空则用系统 git config 里的值'
  },
  {
    key: 'git.userEmail', type: 'string', default: '', label: '提交人邮箱'
  },
  {
    key: 'git.autoCommit', type: 'bool', default: false, label: '自动提交',
    note: '每次写操作后自动提交一次。适合单人使用；多人协作建议关掉，攒成有意义的提交再同步'
  },

  // ---------- 业务规则 ----------
  {
    key: 'rules.requireChangelog', type: 'bool', default: true, label: '设为基线前必须有变更日志',
    danger: true,
    note: '关掉后研发无法判断每版改了什么，这个产品最核心的价值就没了（规则 R6）'
  },
  {
    key: 'rules.lockBaseline', type: 'bool', default: true, label: '基线内容锁定',
    danger: true,
    note: '关掉后已确认版本的原型文件和变更日志可以被改，原型就失去追溯证据的效力（规则 R4）'
  },
  {
    key: 'rules.autoOffline', type: 'bool', default: false, label: '归档时自动生成离线版',
    note: '有外部依赖的原型在归档后自动抓取内联。需要能访问外网'
  },
  {
    key: 'rules.watchDir', type: 'string', default: '', label: 'watch 默认监听目录',
    note: 'flowlark watch 不带 -d 时使用'
  },

  // ---------- 反馈与集成 ----------
  {
    key: 'integrations.issueProvider', type: 'string', default: 'markdown',
    enum: ['markdown', 'github', 'gitlab', 'gitee'], label: '反馈目标',
    note: '未配置或远端失败时始终可以导出 Markdown'
  },
  {
    key: 'integrations.issueBaseUrl', type: 'string', default: '', label: 'Issue API 地址',
    note: '留空使用平台官方地址；企业自建 GitHub/GitLab 可填写 API 根地址'
  },
  {
    key: 'integrations.issueProject', type: 'string', default: '', label: 'Issue 项目标识',
    note: 'GitLab 填项目 ID 或路径；GitHub/Gitee 可留空并填写组织与仓库'
  },
  {
    key: 'integrations.issueOwner', type: 'string', default: '', label: 'Issue 组织/用户'
  },
  {
    key: 'integrations.issueRepo', type: 'string', default: '', label: 'Issue 仓库'
  },
  {
    key: 'integrations.issueLabels', type: 'list', default: ['flowlark-feedback'], label: '反馈标签'
  },
  {
    key: 'integrations.notificationProvider', type: 'string', default: 'none',
    enum: ['none', 'wecom', 'dingtalk', 'slack'], label: '通知平台'
  },
  {
    key: 'integrations.notificationEvents', type: 'list',
    default: ['baseline.created', 'snapshot.created', 'review.questions'], label: '通知事件'
  },
  {
    key: 'integrations.notificationTemplate', type: 'string',
    default: '{{event}} · {{project}}{{version}} {{snapshot}}', label: '通知模板',
    note: '支持 event/project/version/requirement/milestone/snapshot/reviewStatus/url/changeCount'
  },
  {
    key: 'integrations.updateManifestUrl', type: 'string', default: '', label: '更新清单地址',
    note: '后台检查 JSON 发布清单；下载后必须通过 SHA-256 校验'
  },
  {
    key: 'integrations.mirrorIntervalSeconds', type: 'int', default: 60, min: 5, max: 86400,
    label: '镜像刷新间隔（秒）'
  },

  // ---------- 外观与默认值 ----------
  {
    key: 'ui.requirementUrlTemplate', type: 'string', default: '', label: '需求链接模板',
    note: '用 {code} 占位，如 https://jira.internal/browse/{code}。填了之后只输入需求号就能生成链接'
  },
  {
    key: 'ui.defaultTags', type: 'list', default: [], label: '常用标签',
    note: '打标签时优先提示这些'
  },
  {
    key: 'ui.dateStyle', type: 'string', default: 'relative', enum: ['relative', 'absolute'],
    label: '时间显示', note: 'relative=3 小时前，absolute=2026-08-20 14:30'
  }
]

const BY_KEY = new Map(SCHEMA.map((s) => [s.key, s]))

export function describe(key) {
  return BY_KEY.get(key) || null
}

export function allKeys() {
  return SCHEMA.map((s) => s.key)
}

// ---------- 嵌套读写 ----------

function getPath(obj, key) {
  return key.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

function setPath(obj, key, value) {
  const parts = key.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {}
    cur = cur[parts[i]]
  }
  cur[parts[parts.length - 1]] = value
}

// ---------- 解析与校验 ----------

const BYTE_UNITS = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 }

export function parseBytes(raw) {
  if (typeof raw === 'number') return Math.floor(raw)
  const m = /^\s*(\d+(?:\.\d+)?)\s*([kmg]?b)?\s*$/i.exec(String(raw))
  if (!m) return NaN
  return Math.floor(Number(m[1]) * (BYTE_UNITS[(m[2] || 'b').toLowerCase()] || 1))
}

export function formatBytes(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)}MB`
  if (n >= 1024) return `${Math.round(n / 1024)}KB`
  return `${n}B`
}

/** 把 CLI 传进来的字符串按 schema 类型转成真实值，顺带校验 */
export function coerce(key, raw) {
  const s = describe(key)
  if (!s) {
    throw err.bad('UNKNOWN_CONFIG_KEY', `没有这个配置项：${key}`,
      `可用配置项：flowlark config`)
  }

  switch (s.type) {
    case 'bool': {
      const v = String(raw).trim().toLowerCase()
      if (['true', '1', 'on', 'yes', '是'].includes(v)) return true
      if (['false', '0', 'off', 'no', '否'].includes(v)) return false
      throw err.bad('BAD_CONFIG_VALUE', `${key} 需要一个布尔值`, '可用：true / false')
    }
    case 'int':
    case 'port': {
      const n = Number(raw)
      if (!Number.isInteger(n)) throw err.bad('BAD_CONFIG_VALUE', `${key} 需要整数`)
      if (s.type === 'port' && (n < 1 || n > 65535)) {
        throw err.bad('BAD_CONFIG_VALUE', `${key} 必须在 1–65535 之间`)
      }
      return n
    }
    case 'bytes': {
      const n = parseBytes(raw)
      if (!Number.isFinite(n) || n <= 0) {
        throw err.bad('BAD_CONFIG_VALUE', `${key} 需要大小值`, '如 10MB、512KB、1048576')
      }
      return n
    }
    case 'list': {
      if (Array.isArray(raw)) return raw.map((x) => String(x).trim()).filter(Boolean)
      return String(raw).split(/[,，]/).map((x) => x.trim()).filter(Boolean)
    }
    default: {
      const v = String(raw)
      if (s.enum && !s.enum.includes(v)) {
        throw err.bad('BAD_CONFIG_VALUE', `${key} 只能是：${s.enum.join(' / ')}`)
      }
      return v
    }
  }
}

/**
 * 跨字段校验。单个字段合法不代表组合起来合法 ——
 * 两个端口撞一起是最典型的例子，撞了沙箱隔离就失效了。
 */
export function validateAll(settings) {
  const problems = []
  const port = getPath(settings, 'server.port')
  const preview = getPath(settings, 'server.previewPort')
  if (port === preview) {
    problems.push('工作台端口与预览端口不能相同 —— 同源之后原型里的脚本就能读到工作台数据了')
  }
  if (getPath(settings, 'server.lan') && !getPath(settings, 'server.readonlyFromLan')) {
    problems.push('已开放局域网且关闭了只读保护：同网段任何人都能删版本、改基线')
  }
  const tpl = getPath(settings, 'ui.requirementUrlTemplate')
  if (tpl && !tpl.includes('{code}')) {
    problems.push('需求链接模板里缺少 {code} 占位符')
  }
  return problems
}

// ---------- 与仓库配置对接 ----------

/** 用默认值补齐缺失项，并兼容早期扁平结构（port / previewPort / maxFileBytes） */
export function normalize(rawSettings = {}) {
  const out = JSON.parse(JSON.stringify(rawSettings || {}))

  // 老仓库把这三项放在顶层，迁到 server.* 下，不需要写迁移脚本
  const legacy = { port: 'server.port', previewPort: 'server.previewPort', maxFileBytes: 'server.maxFileBytes' }
  for (const [oldKey, newKey] of Object.entries(legacy)) {
    if (out[oldKey] !== undefined && getPath(out, newKey) === undefined) {
      setPath(out, newKey, out[oldKey])
    }
    delete out[oldKey]
  }

  for (const s of SCHEMA) {
    if (getPath(out, s.key) === undefined) {
      setPath(out, s.key, Array.isArray(s.default) ? [...s.default] : s.default)
    }
  }
  return out
}

export function get(settings, key) {
  return getPath(settings, key)
}

export function set(settings, key, rawValue) {
  const value = coerce(key, rawValue)
  const next = JSON.parse(JSON.stringify(settings))
  setPath(next, key, value)
  const problems = validateAll(next)
  return { settings: next, value, problems }
}

/** 展平成 [{key, value, ...schema}]，供 CLI 列表与 Web 表单直接渲染 */
export function list(settings) {
  return SCHEMA.map((s) => ({
    ...s,
    value: getPath(settings, s.key),
    isDefault: JSON.stringify(getPath(settings, s.key)) === JSON.stringify(s.default),
    group: s.key.split('.')[0]
  }))
}

export function displayValue(item) {
  if (item.type === 'bytes') return formatBytes(item.value)
  if (item.type === 'bool') return item.value ? '开' : '关'
  if (item.type === 'list') return item.value.length ? item.value.join('、') : '（空）'
  return item.value === '' || item.value == null ? '（未设置）' : String(item.value)
}
