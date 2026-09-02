import assert from 'node:assert/strict'
import test from 'node:test'
import { createAssessTaskAdapter } from '../src/core/integrations/assess-task/adapter.js'
import { ASSESS_OPERATIONS, validateAssessContract } from '../src/core/integrations/assess-task/contract.js'

const mapping = Object.fromEntries(ASSESS_OPERATIONS.map((name) => [name, `assess.${name}`]))

const required = {
  currentUser: [],
  listProjects: [],
  projectCapabilities: ['projectId'],
  listMembers: ['projectId'],
  listSprints: ['projectId'],
  getSprint: ['sprintId'],
  listTasks: ['projectId'],
  getTask: ['taskId']
}

function queryTool(operation) {
  const names = required[operation] || []
  return {
    name: mapping[operation],
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(names.map((name) => [name, { type: 'integer' }])),
      required: names
    }
  }
}

function bodyTool(operation, names) {
  return {
    name: mapping[operation],
    inputSchema: {
      type: 'object',
      properties: {
        body: {
          type: 'object',
          properties: Object.fromEntries(names.map((name) => [name, {}])),
          required: names
        }
      },
      required: ['body']
    }
  }
}

function contractTools() {
  return [
    ...Object.keys(required).map(queryTool),
    bodyTool('saveSprint', ['projectId', 'ownerId', 'sprintName']),
    bodyTool('createTask', ['projectId', 'taskType', 'title']),
    bodyTool('updateTask', ['projectId', 'taskType', 'title']),
    bodyTool('moveTasks', ['reason', 'tasks']),
    bodyTool('startSprint', ['revision', 'sprintId']),
    bodyTool('endSprint', ['revision', 'sprintId']),
    bodyTool('cancelSprint', ['revision', 'sprintId'])
  ]
}

function fakeSession() {
  const calls = []
  const responses = {
    [mapping.currentUser]: { data: { account: 'tester', name: '测试用户', roles: ['member'] } },
    [mapping.listProjects]: { data: { records: [{ projectId: 123, projectName: '研发效能', status: 1 }] } },
    [mapping.projectCapabilities]: { data: { canManageSprint: true, canManageProject: false } },
    [mapping.listMembers]: { items: [{ userId: 7, account: 'zhangsan', userName: '张三' }] },
    [mapping.listSprints]: { data: { records: [{ sprintId: 9, sprintName: 'S12', revision: 3, status: 1, planStartDate: '2026-08-01T00:00:00+08:00', planEndDate: '2026-08-21T00:00:00+08:00' }] } },
    [mapping.getSprint]: { data: { sprintId: 9, sprintName: 'S12', sprintGoal: '完成联调', revision: 3, status: 1 } },
    [mapping.listTasks]: { data: { rows: [{ taskId: 21, taskCode: 'TASK-21', title: '任务', revision: 4, currentSprintId: 9, status: 2 }] } },
    [mapping.getTask]: { data: { taskId: 21, taskCode: 'TASK-21', title: '任务', revision: 4, currentSprintId: 9, status: 2 } }
  }
  return {
    calls,
    async callTool(name, args) {
      calls.push({ name, args })
      return responses[name]
    }
  }
}

test('validates the complete read and write contract', () => {
  assert.deepEqual(validateAssessContract(contractTools(), mapping, { write: true }), { operations: mapping, problems: [] })
})

test('rejects missing tools and incompatible required arguments', () => {
  const missing = validateAssessContract(contractTools(), { ...mapping, getTask: 'missing.tool' })
  assert.ok(missing.problems.some((item) => item.code === 'ASSESS_TOOL_MISSING' && item.operation === 'getTask'))

  const tools = contractTools().map((tool) => tool.name === mapping.projectCapabilities
    ? { ...tool, inputSchema: { type: 'object', properties: {} } }
    : tool)
  const incompatible = validateAssessContract(tools, mapping)
  assert.ok(incompatible.problems.some((item) => item.code === 'ASSESS_TOOL_SCHEMA_INCOMPATIBLE' && item.operation === 'projectCapabilities'))
})

test('normalizes identity, projects, members, sprints and tasks', async () => {
  const session = fakeSession()
  const adapter = createAssessTaskAdapter({ session, tools: contractTools(), mapping, projectId: 123 })
  assert.deepEqual(await adapter.probe(), { account: 'tester', name: '测试用户', roles: ['member'], permissions: [] })
  assert.deepEqual((await adapter.listProjects())[0], { id: 123, name: '研发效能', status: 1 })
  assert.deepEqual(await adapter.getProjectCapabilities(), { canManageSprint: true, canManageProject: false })
  assert.deepEqual((await adapter.listMembers())[0], { id: 7, account: 'zhangsan', name: '张三' })
  assert.deepEqual((await adapter.listSprints())[0], {
    id: 9,
    projectId: null,
    name: 'S12',
    title: 'S12',
    goal: '',
    status: 1,
    revision: 3,
    startAt: '2026-08-01T00:00:00+08:00',
    endAt: '2026-08-21T00:00:00+08:00',
    ownerId: null
  })
  assert.deepEqual((await adapter.listTasks({ sprintId: 9 }))[0], {
    id: 21,
    projectId: null,
    code: 'TASK-21',
    title: '任务',
    taskType: null,
    descriptionDoc: '',
    acceptanceDoc: '',
    priority: null,
    status: 2,
    revision: 4,
    sprintId: 9,
    assigneeId: null,
    planStartDate: null,
    planEndDate: null
  })
  assert.ok(session.calls.some((item) => item.name === mapping.listTasks && item.args.projectId === 123 && item.args.sprintIds[0] === 9))
})

test('rejects a non-numeric configured project id', () => {
  assert.throws(
    () => createAssessTaskAdapter({ session: fakeSession(), tools: contractTools(), mapping, projectId: 'project-name' }),
    (error) => error.code === 'ASSESS_PROJECT_ID_INVALID'
  )
})
