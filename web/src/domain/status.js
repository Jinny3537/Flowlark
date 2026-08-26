export const VERSION_STATUS = {
  DRAFT: { label: '编辑中', color: 'gold' },
  BASELINE: { label: '当前基线', color: 'green' },
  HISTORY: { label: '历史版本', color: 'default' },
  VOID: { label: '已废弃', color: 'red' }
}

export const REVIEW_STATUS = {
  unread: { label: '未读', color: 'orange' },
  reviewing: { label: '审阅中', color: 'gold' },
  approved: { label: '已确认', color: 'green' },
  obsolete: { label: '已过期', color: 'default' },
  pending: { label: '待评审', color: 'orange' },
  confirmed: { label: '已确认', color: 'green' },
  questions: { label: '有疑问', color: 'gold' }
}

export const WATCH_STATUS = {
  pending: { label: '待归档', color: 'gold' },
  archived: { label: '已归档', color: 'green' },
  failed: { label: '失败', color: 'red' }
}

const OPERATION_STATUS = {
  PROJECT_CREATE: { label: '创建项目', color: 'green' },
  PROJECT_UPDATE: { label: '编辑项目', color: 'blue' },
  VERSION_ADD: { label: '新增版本', color: 'green' },
  VERSION_UPDATE: { label: '编辑版本', color: 'blue' },
  VERSION_REPLACE_FILE: { label: '替换文件', color: 'blue' },
  VERSION_VOID: { label: '废弃', color: 'red' },
  VERSION_REOPEN: { label: '重新打开', color: 'green' },
  VERSION_REMOVE: { label: '删除', color: 'red' },
  VERSION_RESTORE: { label: '恢复', color: 'green' },
  BASELINE_SET: { label: '设为基线', color: 'green' },
  BASELINE_ROLLBACK: { label: '回滚基线', color: 'orange' },
  SPEC_UPDATE: { label: '更新规格书', color: 'blue' },
  CHANGES_SET: { label: '更新变更日志', color: 'blue' },
  REQS_SET: { label: '更新关联需求', color: 'blue' }
}

export function statusMeta(table, key) {
  return table[key] || { label: key || '未知', color: 'default' }
}

export function operationMeta(action) {
  return statusMeta(OPERATION_STATUS, action)
}
