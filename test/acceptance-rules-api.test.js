import assert from 'node:assert/strict'
import { test } from 'node:test'
import { newHub, cleanup } from './helpers.js'
import { startServer } from '../src/server/index.js'
import { unavailableWecomMcp } from '../src/core/wecom-mcp-manager.js'

test('project rules use validated shared defaults and read-only HTTP protection', async (t) => {
  const { root, hub } = newHub()
  t.after(() => cleanup(root))
  hub.createProject({ name: 'Acceptance', code: 'acceptance' })
  const options = { port: 0, previewPort: 0, wecomMcp: unavailableWecomMcp('test') }
  const server = await startServer(root, options)
  const mirror = await startServer(root, { ...options, mirror: true })
  t.after(async () => { await server.close(); await mirror.close() })
  const call = (port, method, body) => fetch(`http://127.0.0.1:${port}/api/projects/acceptance/acceptance-rules`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body)
  })
  const defaults = await (await call(server.port, 'GET')).json()
  assert.equal(defaults.roles.length, 3)
  for (const invalid of [null, [], {}, { roles: [], rule: { type: 'all-required' } }]) {
    assert.equal((await call(server.port, 'PUT', invalid)).status, 400)
  }
  const custom = { roles: [{ id: 'owner', name: 'Owner', required: true }], rule: { type: 'all-required' } }
  assert.deepEqual(await (await call(server.port, 'PUT', custom)).json(), custom)
  assert.deepEqual(hub.getProject('acceptance').acceptance, custom)
  assert.equal((await call(mirror.port, 'PUT', defaults)).status, 403)
  assert.deepEqual(await (await call(mirror.port, 'GET')).json(), custom)
})
