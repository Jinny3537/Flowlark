import { after, describe, test } from 'node:test'
import fs from 'node:fs'
import path from 'node:path'
import {
  REQUIREMENT_STATUSES,
  confirmationPreflight,
  normalizeRequirementStatus,
  transitionRequirementStatus
} from '../src/core/requirement-lifecycle.js'
import * as reqx from '../src/core/requirements.js'
import * as store from '../src/core/store.js'
import { cleanup, newHub, throwsCode } from './helpers.js'

const dirs = []
after(() => dirs.forEach(cleanup))

function fixture() {
  const { root, hub } = newHub()
  dirs.push(root)
  return { root, hub }
}

describe('需求生命周期规则', () => {
  test('规范化默认 draft 并只接受六种状态', (t) => {
    t.assert.deepStrictEqual([...REQUIREMENT_STATUSES], [
      'draft', 'confirmed', 'developing', 'pending-acceptance', 'completed', 'archived'
    ])
    t.assert.strictEqual(normalizeRequirementStatus(), 'draft')
    t.assert.strictEqual(normalizeRequirementStatus(' CONFIRMED '), 'confirmed')
    throwsCode(t, 'REQUIREMENT_STATUS_INVALID', () => normalizeRequirementStatus('designing'))
  })

  test('v0.7.3 只允许用户确认与系统开始开发', (t) => {
    t.assert.deepStrictEqual(transitionRequirementStatus('draft', 'confirmed'), {
      from: 'draft', to: 'confirmed', changed: true
    })
    t.assert.deepStrictEqual(transitionRequirementStatus('confirmed', 'developing', { system: true }), {
      from: 'confirmed', to: 'developing', changed: true
    })
    throwsCode(t, 'REQUIREMENT_TRANSITION_INVALID', () => {
      transitionRequirementStatus('confirmed', 'developing')
    })
    throwsCode(t, 'REQUIREMENT_TRANSITION_INVALID', () => {
      transitionRequirementStatus('draft', 'developing', { system: true })
    })
    throwsCode(t, 'REQUIREMENT_TRANSITION_INVALID', () => {
      transitionRequirementStatus('developing', 'completed', { system: true })
    })
  })

  test('确认门禁逐项报告标题、描述、负责人和规格书', (t) => {
    const { root, hub } = fixture()
    const item = hub.createRequirement({ code: 'REQ-PREFLIGHT', title: '待确认' })
    const blocked = confirmationPreflight(root, item)
    t.assert.strictEqual(blocked.ready, false)
    t.assert.deepStrictEqual(blocked.blockers.map((entry) => entry.code), [
      'REQUIREMENT_DESCRIPTION_REQUIRED',
      'REQUIREMENT_OWNER_REQUIRED',
      'REQUIREMENT_SPEC_REQUIRED'
    ])

    hub.updateRequirement(item.code, { description: '范围和验收说明', owner: 'Alice' })
    hub.writeRequirementSpec(item.code, '# 验收\n\n- 支持批量关闭')
    t.assert.deepStrictEqual(confirmationPreflight(root, hub.getRequirement(item.code)), {
      ready: true, blockers: []
    })
  })
})

describe('需求生命周期持久化', () => {
  test('Hub 生成 draft 初始元数据且不保存状态历史数组', (t) => {
    const previous = process.env.FLOWLARK_USER
    process.env.FLOWLARK_USER = 'Lifecycle Tester'
    try {
      const { root, hub } = fixture()
      const before = new Date().toISOString()
      const item = hub.createRequirement({ code: 'REQ-NEW', title: '新需求' })
      t.assert.strictEqual(item.status, 'draft')
      t.assert.strictEqual(item.statusChangedBy, 'Lifecycle Tester')
      t.assert.ok(item.statusChangedAt >= before)
      t.assert.strictEqual(item.statusReason, 'created')
      const raw = JSON.parse(fs.readFileSync(store.paths.requirementFile(root, item.code), 'utf8'))
      t.assert.strictEqual(Object.hasOwn(raw, 'statusHistory'), false)
      const text = fs.readFileSync(store.paths.requirementFile(root, item.code), 'utf8')
      t.assert.ok(text.indexOf('"status"') < text.indexOf('"statusChangedAt"'))
      t.assert.ok(text.indexOf('"statusChangedAt"') < text.indexOf('"external"'))
    } finally {
      if (previous === undefined) delete process.env.FLOWLARK_USER
      else process.env.FLOWLARK_USER = previous
    }
  })

  test('创建与普通更新拒绝客户端托管字段', (t) => {
    const { hub } = fixture()
    for (const field of ['status', 'statusChangedAt', 'statusChangedBy', 'statusChangedElse', 'statusReason', 'statusOverride', 'external', 'externalTasks']) {
      throwsCode(t, 'REQUIREMENT_MANAGED_FIELD', () => {
        hub.createRequirement({ code: `REQ-CREATE-${field}`, title: '非法创建', [field]: null })
      })
    }
    hub.createRequirement({ code: 'REQ-UPDATE', title: '更新门禁' })
    for (const field of ['status', 'statusChangedAt', 'statusChangedBy', 'statusChangedElse', 'statusReason', 'statusOverride', 'external', 'externalTasks']) {
      throwsCode(t, 'REQUIREMENT_MANAGED_FIELD', () => {
        hub.updateRequirement('REQ-UPDATE', { [field]: null })
      })
    }
  })

  test('规格书读写不改变生命周期元数据', (t) => {
    const { hub } = fixture()
    const item = hub.createRequirement({ code: 'REQ-SPEC', title: '规格书' })
    const lifecycle = {
      status: item.status,
      statusChangedAt: item.statusChangedAt,
      statusChangedBy: item.statusChangedBy,
      statusReason: item.statusReason
    }
    t.assert.strictEqual(hub.readRequirementSpec(item.code), '')
    hub.writeRequirementSpec(item.code, '# 规格书')
    t.assert.strictEqual(hub.readRequirementSpec(item.code), '# 规格书\n')
    t.assert.deepStrictEqual({
      status: hub.getRequirement(item.code).status,
      statusChangedAt: hub.getRequirement(item.code).statusChangedAt,
      statusChangedBy: hub.getRequirement(item.code).statusChangedBy,
      statusReason: hub.getRequirement(item.code).statusReason
    }, lifecycle)
  })

  test('用户确认先过门禁并只在 oplog 留历史', (t) => {
    const { root, hub } = fixture()
    hub.createRequirement({ code: 'REQ-CONFIRM', title: '确认需求' })
    throwsCode(t, 'REQUIREMENT_CONFIRMATION_BLOCKED', () => {
      hub.transitionRequirement('REQ-CONFIRM', { target: 'confirmed' })
    })
    hub.updateRequirement('REQ-CONFIRM', { description: '说明', owner: 'Alice' })
    hub.writeRequirementSpec('REQ-CONFIRM', '# 验收标准')
    const confirmed = hub.transitionRequirement('REQ-CONFIRM', {
      target: 'confirmed', reason: '评审通过', statusChangedAt: 'client-time', statusChangedBy: 'client-user'
    })
    t.assert.strictEqual(confirmed.status, 'confirmed')
    t.assert.notStrictEqual(confirmed.statusChangedAt, 'client-time')
    t.assert.notStrictEqual(confirmed.statusChangedBy, 'client-user')
    t.assert.strictEqual(confirmed.statusReason, '评审通过')
    const raw = JSON.parse(fs.readFileSync(store.paths.requirementFile(root, confirmed.code), 'utf8'))
    t.assert.strictEqual(Object.hasOwn(raw, 'statusHistory'), false)
    t.assert.ok(hub.oplog({ limit: 50 }).some((entry) =>
      entry.action === 'REQUIREMENT_STATUS_TRANSITION' && entry.requirement === confirmed.code &&
      entry.from === 'draft' && entry.to === 'confirmed'))
  })

  test('系统 helper 只执行系统允许的流转并派生审计身份', (t) => {
    const previous = process.env.FLOWLARK_USER
    process.env.FLOWLARK_USER = 'System Runner'
    try {
      const { hub } = fixture()
      hub.createRequirement({ code: 'REQ-SYSTEM', title: '系统推进', description: '说明', owner: 'Alice' })
      hub.writeRequirementSpec('REQ-SYSTEM', '# 验收')
      hub.transitionRequirement('REQ-SYSTEM', { target: 'confirmed' })
      const developing = hub.transitionRequirementSystem('REQ-SYSTEM', 'developing', {
        reason: 'Sprint 已验证启动', statusChangedAt: 'client-time', statusChangedBy: 'client-user'
      })
      t.assert.strictEqual(developing.status, 'developing')
      t.assert.strictEqual(developing.statusChangedBy, 'System Runner')
      t.assert.notStrictEqual(developing.statusChangedAt, 'client-time')
      throwsCode(t, 'REQUIREMENT_TRANSITION_INVALID', () => {
        hub.transitionRequirementSystem('REQ-SYSTEM', 'completed')
      })
    } finally {
      if (previous === undefined) delete process.env.FLOWLARK_USER
      else process.env.FLOWLARK_USER = previous
    }
  })

  test('核心规格书 API 校验需求存在并规范换行', (t) => {
    const { root, hub } = fixture()
    hub.createRequirement({ code: 'REQ-CORE-SPEC', title: '核心 API' })
    reqx.writeRequirementSpec(root, 'REQ-CORE-SPEC', '正文')
    t.assert.strictEqual(reqx.readRequirementSpec(root, 'REQ-CORE-SPEC'), '正文\n')
    throwsCode(t, 'NOT_FOUND', () => reqx.writeRequirementSpec(root, 'REQ-NOT-FOUND', '正文'))
  })

  test('需求规格书拒绝文件和父目录符号链接且不触碰外部目标', (t) => {
    const { root, hub } = fixture()
    hub.createRequirement({ code: 'REQ-SPEC-LINK', title: '规格书链接保护' })
    const specFile = store.paths.requirementSpec(root, 'REQ-SPEC-LINK')
    const outside = `${root}-outside-spec.md`
    fs.writeFileSync(outside, 'external-safe\n')
    t.after(() => fs.rmSync(outside, { force: true }))
    fs.symlinkSync(outside, specFile)

    throwsCode(t, 'REQUIREMENT_SPEC_SYMLINK', () => reqx.readRequirementSpec(root, 'REQ-SPEC-LINK'))
    throwsCode(t, 'REQUIREMENT_SPEC_SYMLINK', () => reqx.writeRequirementSpec(root, 'REQ-SPEC-LINK', 'overwrite'))
    t.assert.strictEqual(fs.readFileSync(outside, 'utf8'), 'external-safe\n')

    fs.rmSync(specFile)
    const requirementDir = store.paths.requirement(root, 'REQ-SPEC-LINK')
    const outsideDir = `${root}-outside-requirement`
    fs.mkdirSync(outsideDir)
    fs.writeFileSync(path.join(outsideDir, 'requirement.json'), JSON.stringify({ code: 'REQ-SPEC-LINK', title: 'outside' }))
    fs.writeFileSync(path.join(outsideDir, 'spec.md'), 'outside-parent\n')
    t.after(() => fs.rmSync(outsideDir, { recursive: true, force: true }))
    fs.rmSync(requirementDir, { recursive: true })
    fs.symlinkSync(outsideDir, requirementDir)

    throwsCode(t, 'REQUIREMENT_SPEC_SYMLINK', () => reqx.readRequirementSpec(root, 'REQ-SPEC-LINK'))
    throwsCode(t, 'REQUIREMENT_SPEC_SYMLINK', () => reqx.writeRequirementSpec(root, 'REQ-SPEC-LINK', 'overwrite-parent'))
    t.assert.strictEqual(fs.readFileSync(path.join(outsideDir, 'spec.md'), 'utf8'), 'outside-parent\n')
  })
})
