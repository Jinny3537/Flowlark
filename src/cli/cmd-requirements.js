import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { err } from '../core/errors.js'
import { c, heading, ok, table, warn } from './ui.js'
import { hub } from './commands.js'

export async function requirement(pos, values) {
  const h = hub()
  const sub = pos[0] || 'list'
  if (sub === 'list' || sub === 'ls') {
    const items = h.listRequirements()
    if (values.json) return console.log(JSON.stringify(items, null, 2))
    console.log(heading('需求'))
    return console.log(table(['编号', '标题', '状态', '版本'], items.map((item) => [c.cyan(item.code), item.title, item.derivedStatus, String(item.versions.length)])))
  }
  if (sub === 'show') {
    const item = h.getRequirement(pos[1])
    return console.log(values.json ? JSON.stringify(item, null, 2) : `${c.bold(item.code)} ${item.title}\n${item.description || ''}\n关联版本：${item.versions.length}`)
  }
  if (sub === 'new') {
    const code = pos[1]
    if (!code || !values.title) throw err.bad('REQUIREMENT_INPUT_REQUIRED', '请提供需求编号和 --title')
    const item = h.createRequirement({ code, title: values.title, description: values.desc || '', owner: values.owner || '' })
    return ok(`已创建需求 ${item.code}`)
  }
  if (sub === 'confirm') {
    const code = pos[1]
    if (!code) throw err.bad('REQUIREMENT_INPUT_REQUIRED', '请提供需求编号')
    const item = h.transitionRequirement(code, { target: 'confirmed', reason: values.reason || '' })
    if (values.json) return console.log(JSON.stringify(item, null, 2))
    return ok(`已确认需求 ${item.code}`)
  }
  if (sub === 'spec') {
    const code = pos[1]
    if (!code) throw err.bad('REQUIREMENT_INPUT_REQUIRED', '请提供需求编号')
    const current = h.readRequirementSpec(code)
    if (!values.edit) {
      if (values.json) return console.log(JSON.stringify({ spec: current }, null, 2))
      return console.log(current)
    }

    const permission = h.writePermission()
    if (!permission.canWrite) {
      throw err.forbidden('GIT_READONLY', '当前仓库是 Git 只读模式，不能编辑需求规格书', permission.reason)
    }

    const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-req-spec-'))
    const temporaryFile = path.join(temporaryDir, 'spec.md')
    try {
      fs.writeFileSync(temporaryFile, current || `# ${code} 验收与规格说明\n\n`, 'utf8')
      const editor = process.env.VISUAL || process.env.EDITOR || 'vi'
      const result = spawnSync(editor, [temporaryFile], { stdio: 'inherit' })
      if (result.status !== 0) {
        process.exitCode = 1
        return warn('编辑器异常退出，未保存')
      }
      if (h.readRequirementSpec(code) !== current) {
        throw err.conflict('REQUIREMENT_SPEC_CHANGED', '编辑期间需求规格书已被其他操作修改，请重新打开后合并')
      }
      h.writeRequirementSpec(code, fs.readFileSync(temporaryFile, 'utf8'))
      return ok(`需求 ${code} 的规格书已保存`)
    } finally {
      fs.rmSync(temporaryDir, { recursive: true, force: true })
    }
  }
  if (sub === 'link') {
    const [code, project, versionNo] = pos.slice(1)
    if (!code || !project || !versionNo) throw err.bad('REQUIREMENT_LINK_INPUT', '用法：flowlark req link <编号> <项目> <版本>')
    h.linkRequirement(code, project, versionNo)
    return ok(`已关联 ${code} → ${project}/${versionNo}`)
  }
  if (sub === 'unlink') {
    const [code, project, versionNo] = pos.slice(1)
    h.unlinkRequirement(code, project, versionNo)
    return ok(`已取消关联 ${code} → ${project}/${versionNo}`)
  }
  throw err.bad('REQUIREMENT_SUBCOMMAND_INVALID', `未知 req 子命令：${sub}`)
}
