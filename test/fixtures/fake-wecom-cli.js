#!/usr/bin/env node
import fs from 'node:fs'

const args = process.argv.slice(2)

function output(value) {
  process.stdout.write(typeof value === 'string' ? `${value}\n` : `${JSON.stringify(value)}\n`)
}

if (args[0] === '--version') {
  output('wecom-cli 1.1.0 (flowlark-test)')
  process.exit(0)
}

if (args[0] === 'auth' && args[1] === 'show') {
  output('authorized')
  process.exit(0)
}

if (args[0] === 'contact' && args[1] === 'users' && args[2] === 'search') {
  const payload = JSON.parse(args[4] || '{}')
  const query = String(payload.keywords?.[0] || '')
  const users = query === '李四'
    ? [
      { userid: 'wo-test-product', name: '李四', alias: 'lisi-pm', departments: ['产品部'], position: '产品经理' },
      { userid: 'wo-test-engineering', name: '李四', alias: 'lisi-dev', departments: ['研发部'], position: '研发负责人' }
    ]
    : query
      ? [{ userid: `wo-test-${query}`, name: query, departments: ['产品部'], position: '成员' }]
      : []
  output({ users, users_count: users.length })
  process.exit(0)
}

if (args[0] === 'mail' && args[1] === 'send') {
  const payload = JSON.parse(args[3] || '{}')
  const logFile = process.env.FLOWLARK_FAKE_WECOM_LOG
  if (logFile) {
    const bodyExists = fs.existsSync(payload.file_path)
    const markdown = bodyExists ? fs.readFileSync(payload.file_path, 'utf8') : null
    fs.appendFileSync(logFile, `${JSON.stringify({ payload, bodyExists, markdown })}\n`)
  }
  output({ mail_id: 'hidden-test-mail-id' })
  process.exit(0)
}

output({ error: { message: `不支持的测试命令：${args.join(' ')}`, instruction: '检查测试 fixture' } })
process.exit(1)

