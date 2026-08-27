export const ASSESS_READ_OPERATIONS = [
  'currentUser',
  'listProjects',
  'projectCapabilities',
  'listMembers',
  'listSprints',
  'getSprint',
  'listTasks',
  'getTask'
]

export const ASSESS_WRITE_OPERATIONS = [
  'saveSprint',
  'createTask',
  'updateTask',
  'moveTasks',
  'startSprint',
  'endSprint',
  'cancelSprint'
]

export const ASSESS_OPERATIONS = [...ASSESS_READ_OPERATIONS, ...ASSESS_WRITE_OPERATIONS]

const REQUIRED = {
  projectCapabilities: [['projectId']],
  listMembers: [['projectId']],
  listSprints: [['projectId']],
  getSprint: [['sprintId']],
  listTasks: [['projectId']],
  getTask: [['taskId']],
  saveSprint: [['body'], ['body', 'projectId'], ['body', 'ownerId'], ['body', 'sprintName']],
  createTask: [['body'], ['body', 'projectId'], ['body', 'taskType'], ['body', 'title']],
  updateTask: [['body'], ['body', 'projectId'], ['body', 'taskType'], ['body', 'title']],
  moveTasks: [['body'], ['body', 'reason'], ['body', 'tasks']],
  startSprint: [['body'], ['body', 'revision'], ['body', 'sprintId']],
  endSprint: [['body'], ['body', 'revision'], ['body', 'sprintId']],
  cancelSprint: [['body'], ['body', 'revision'], ['body', 'sprintId']]
}

export function validateAssessContract(tools, mapping = {}, { write = false } = {}) {
  const byName = new Map((tools || []).map((tool) => [String(tool?.name || ''), tool]))
  const operations = Object.fromEntries(ASSESS_OPERATIONS
    .map((operation) => [operation, String(mapping[operation] || '').trim()])
    .filter(([, name]) => name))
  const problems = []
  const requiredOperations = write ? ASSESS_OPERATIONS : ASSESS_READ_OPERATIONS

  for (const operation of requiredOperations) {
    const name = operations[operation]
    const tool = byName.get(name)
    if (!name || !tool) {
      problems.push(problem('ASSESS_TOOL_MISSING', operation, `缺少 Assess Task 工具映射：${operation}`))
      continue
    }
    for (const path of REQUIRED[operation] || []) {
      if (!schemaRequires(tool.inputSchema, path)) {
        problems.push(problem(
          'ASSESS_TOOL_SCHEMA_INCOMPATIBLE',
          operation,
          `工具 ${name} 缺少必填参数 ${path.join('.')}`
        ))
      }
    }
  }
  return { operations, problems }
}

function schemaRequires(schema, path) {
  let current = schema
  for (const name of path) {
    if (!current || !Array.isArray(current.required) || !current.required.includes(name)) return false
    current = current.properties?.[name]
  }
  return true
}

function problem(code, operation, message) {
  return { code, operation, message }
}
