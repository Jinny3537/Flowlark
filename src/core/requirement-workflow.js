import fs from 'node:fs'
import * as store from './store.js'
import * as req from './requirements.js'
import * as team from './team.js'
import { listFeedbackDrafts } from './feedback.js'

// Read explicit iteration scope; never infer adoption from the current project baseline.
export function requirementWorkflow(root, code) {
  const item = req.requirementDetail(root, code)
  const dir = store.paths.milestones(root)
  const milestones = (fs.existsSync(dir) ? fs.readdirSync(dir).filter(name => name.endsWith('.json')) : [])
    .map(name => JSON.parse(fs.readFileSync(`${dir}/${name}`, 'utf8')))
    .filter(milestone => (milestone.items || []).some(entry => entry.requirement === code))
    .map(milestone => ({ name: milestone.name, title: milestone.title, status: milestone.status,
      updatedAt: milestone.updatedAt,
      items: milestone.items.filter(entry => entry.requirement === code).map(entry => ({ ...entry,
        missing: !store.versionExists(root, entry.project, entry.version) })) }))
  const latest = Object.values(Object.fromEntries(item.versions.filter(v => v.status !== 'VOID').map(v => [v.project, v])))
  const adopted = milestones.filter(m => ['frozen', 'active', 'delivered', 'archived'].includes(m.status))
    .flatMap(m => m.items.map(entry => ({ ...entry, milestone: m.name, milestoneTitle: m.title, milestoneStatus: m.status })))
  const records = team.listAllRecords(root).filter(record => record.requirement === code)
  const feedbacks = listFeedbackDrafts(root).filter(record => record.requirements?.includes(code))
  const questions = records.filter(record => !record.replyTo && ['comment', 'issue'].includes(record.kind)).map(record => {
    const replies = records.filter(reply => reply.replyTo === record.id)
    return { ...record, replies, state: replies.filter(reply => ['resolved', 'confirmed', 'reopened'].includes(reply.outcome)).at(-1)?.outcome || 'open' }
  })
  return { ...item, milestones, adopted, latest, records, feedbacks, questions,
    pending: {
      missingPrototype: !item.versions.length,
      missingAcceptance: !String(item.acceptanceCriteria || '').trim(),
      unresolved: questions.filter(q => !['confirmed', 'passed'].includes(q.state)).length,
      newerArchive: adopted.some(entry => latest.some(v => v.project === entry.project && v.versionNo !== entry.version && v.createdAt > (item.versions.find(x => x.project === entry.project && x.versionNo === entry.version)?.createdAt || '')))
    }
  }
}
