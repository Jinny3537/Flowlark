#!/usr/bin/env node
import crypto from 'node:crypto'
import http from 'node:http'
import { fileURLToPath } from 'node:url'
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server'
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler
} from '@modelcontextprotocol/node'
import * as z from 'zod/v4'
import { createWecomTools, WecomToolError } from './wecom-tools.js'

const CandidateSchema = z.object({
  key: z.string(),
  query: z.string(),
  name: z.string(),
  alias: z.string(),
  departments: z.array(z.string()),
  position: z.string(),
  email: z.string().optional(),
  userid: z.string().optional()
}).strict()

const ContactResultSchema = z.object({
  query: z.string(),
  status: z.enum(['unique', 'ambiguous', 'missing', 'limited']),
  candidate: CandidateSchema.optional(),
  candidates: z.array(CandidateSchema),
  hint: z.string().nullable().optional()
}).strict()

const ToolFailureSchema = z.object({
  ok: z.literal(false),
  message: z.string(),
  instruction: z.string().nullable()
}).strict()

function success(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value) }],
    structuredContent: value
  }
}

function failure(error) {
  const value = {
    ok: false,
    message: String(error?.message || error || '企业微信工具调用失败'),
    instruction: error instanceof WecomToolError ? error.instruction : null
  }
  return {
    isError: true,
    content: [{
      type: 'text',
      text: value.instruction ? `${value.message}。${value.instruction}` : value.message
    }],
    structuredContent: value
  }
}

async function invoke(handler) {
  try {
    return success(await handler())
  } catch (error) {
    return failure(error)
  }
}

export function createWecomMcpServer(tools = createWecomTools()) {
  const server = new McpServer(
    { name: 'wecom-mcp-server', version: '1.0.0' },
    { instructions: 'Resolve every configured member name before sending a release email. Never guess between ambiguous contacts.' }
  )

  const AuthOutputSchema = z.union([
    z.object({
      installed: z.boolean(),
      version: z.string().nullable(),
      versionOk: z.boolean(),
      authorized: z.boolean(),
      message: z.string(),
      instruction: z.string().nullable()
    }).strict(),
    ToolFailureSchema
  ])

  server.registerTool('wecom_auth_status', {
    title: 'Check WeCom CLI authorization',
    description: 'Check whether the official WeCom CLI is installed at version 1.1.0 or newer and currently authorized. This tool does not reveal Bot IDs, secrets, tokens, or credential paths.',
    inputSchema: z.object({}).strict(),
    outputSchema: AuthOutputSchema,
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  }, async () => invoke(() => tools.authStatus()))

  server.registerTool('wecom_contacts_resolve', {
    title: 'Resolve WeCom release-mail recipients',
    description: 'Resolve each supplied internal WeCom member name independently. Returns a unique match, up to five ambiguity candidates, or a missing/limited status. Call this before sending release mail and never guess between candidates.',
    inputSchema: z.object({
      names: z.array(z.string().trim().min(1).max(120)).min(1).max(100)
        .describe('Internal WeCom member names or aliases to resolve independently')
    }).strict(),
    outputSchema: z.union([
      z.object({ results: z.array(ContactResultSchema) }).strict(),
      ToolFailureSchema
    ]),
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true
    }
  }, async ({ names }) => invoke(() => tools.resolveContacts({ names })))

  server.registerTool('wecom_release_mail_send', {
    title: 'Send an approved WeCom release email',
    description: 'Send one already-previewed Markdown release email to recipients previously resolved from WeCom contacts. This changes external state and must only be called after the release baseline and Git synchronization succeed.',
    inputSchema: z.object({
      to: z.array(CandidateSchema).min(1).max(100),
      cc: z.array(CandidateSchema).max(100).default([]),
      subject: z.string().trim().min(1).max(500),
      markdown: z.string().trim().min(1).max(1024 * 1024),
      idempotencyKey: z.string().trim().min(1).max(300).optional()
    }).strict(),
    outputSchema: z.union([
      z.object({
        ok: z.literal(true),
        subject: z.string(),
        recipientCount: z.number().int().nonnegative(),
        ccCount: z.number().int().nonnegative()
      }).strict(),
      ToolFailureSchema
    ]),
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true
    }
  }, async (input) => invoke(() => tools.sendReleaseMail(input)))

  return server
}

function authorized(req, expected) {
  const header = String(req.headers.authorization || '')
  const actual = header.startsWith('Bearer ') ? header.slice(7) : ''
  const left = Buffer.from(actual)
  const right = Buffer.from(String(expected || ''))
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right)
}

export async function startWecomMcpServer({
  host = '127.0.0.1',
  port = 0,
  token,
  tools = createWecomTools()
} = {}) {
  if (host !== '127.0.0.1') throw new Error('企业微信 MCP 仅允许监听 127.0.0.1')
  if (!token || String(token).length < 16) throw new Error('企业微信 MCP 缺少有效的进程级 Token')

  const handler = createMcpHandler(() => createWecomMcpServer(tools), {
    legacy: 'stateless',
    responseMode: 'auto',
    onerror: (error) => console.error('[flowlark-wecom-mcp]', error.message)
  })
  const nodeHandler = toNodeHandler(handler, {
    onerror: (error) => console.error('[flowlark-wecom-mcp]', error.message)
  })
  const validateHost = localhostHostValidation()
  const validateOrigin = localhostOriginValidation()
  const server = http.createServer(async (req, res) => {
    if (new URL(req.url || '/', 'http://localhost').pathname !== '/mcp') {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' })
      return res.end(JSON.stringify({ error: 'not_found' }))
    }
    if (!validateHost(req, res) || !validateOrigin(req, res)) return
    if (!authorized(req, token)) {
      res.writeHead(401, {
        'Content-Type': 'application/json; charset=utf-8',
        'WWW-Authenticate': 'Bearer realm="flowlark-wecom-mcp"'
      })
      return res.end(JSON.stringify({ error: 'unauthorized' }))
    }
    await nodeHandler(req, res)
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(Number(port) || 0, host, resolve)
  })
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : Number(port)
  let closed = false
  return {
    host,
    port: actualPort,
    url: `http://${host}:${actualPort}/mcp`,
    async close() {
      if (closed) return
      closed = true
      await handler.close()
      await new Promise((resolve) => server.close(resolve))
    }
  }
}

async function main() {
  const token = process.env.FLOWLARK_WECOM_MCP_TOKEN
  const port = Number(process.env.FLOWLARK_WECOM_MCP_PORT || 0)
  const tools = createWecomTools({ command: process.env.FLOWLARK_WECOM_CLI_COMMAND || 'wecom-cli' })
  const running = await startWecomMcpServer({ token, port, tools })
  process.stdout.write(`${JSON.stringify({ ready: true, pid: process.pid, port: running.port, url: running.url })}\n`)
  const close = async () => {
    await running.close()
    process.exit(0)
  }
  process.once('SIGINT', close)
  process.once('SIGTERM', close)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[flowlark-wecom-mcp] ${error.message}`)
    process.exit(1)
  })
}
