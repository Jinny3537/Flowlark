import readline from 'node:readline'

const tools = [
  {
    name: 'echo',
    description: 'Echo a value',
    inputSchema: {
      type: 'object',
      properties: { value: { type: 'string' } },
      required: ['value'],
      additionalProperties: false
    }
  },
  { name: 'fail', description: 'Return a tool error', inputSchema: { type: 'object', properties: {} } },
  { name: 'hang', description: 'Never answer', inputSchema: { type: 'object', properties: {} } },
  { name: 'invalid', description: 'Write invalid stdout', inputSchema: { type: 'object', properties: {} } }
]

function send(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

if (process.env.FIXTURE_SECRET) {
  process.stderr.write(`fixture credential=${process.env.FIXTURE_SECRET}\n`)
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line)
  if (message.method === 'initialize') {
    send(message.id, {
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: 'flowlark-test', version: '1.0.0' }
    })
    return
  }
  if (message.method === 'tools/list') {
    send(message.id, { tools })
    return
  }
  if (message.method !== 'tools/call') {
    if (message.id !== undefined) send(message.id, {})
    return
  }

  const { name, arguments: args = {} } = message.params
  if (name === 'echo') {
    const result = { value: args.value }
    send(message.id, {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result
    })
    return
  }
  if (name === 'fail') {
    send(message.id, { isError: true, content: [{ type: 'text', text: 'fixture failure' }] })
    return
  }
  if (name === 'invalid') {
    process.stdout.write('not-json\n')
    return
  }
  if (name !== 'hang') {
    send(message.id, { isError: true, content: [{ type: 'text', text: `unknown tool ${name}` }] })
  }
})
