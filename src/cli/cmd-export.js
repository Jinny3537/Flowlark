import path from 'node:path'
import { err } from '../core/errors.js'
import { ok } from './ui.js'
import { hub } from './commands.js'

export async function exportPackage(pos, values) {
  const [type, name] = pos
  if (!['req', 'requirement', 'milestone'].includes(type) || !name) {
    throw err.bad('EXPORT_INPUT_INVALID', '用法：flowlark export req <编号> -d <目录> 或 flowlark export milestone <标识> -d <目录>')
  }
  const h = hub()
  const output = values.dir ? path.resolve(values.dir) : null
  const result = type === 'milestone' ? await h.exportMilestone(name, output) : await h.exportRequirement(name, output)
  ok(`已导出 ${result.itemCount} 个版本到 ${result.outputDir}`)
}
