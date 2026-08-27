import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  deleteRuntimePassword,
  diagnoseExecutable,
  getRuntimeProfile,
  inspectRuntimeProfile,
  removeRuntimeProfile,
  runtimeEnvironment,
  saveRuntimeProfile,
  setRuntimePassword
} from '../src/core/mcp-runtime.js'

function fixture(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-mcp-runtime-'))
  const root = path.join(home, 'repo')
  fs.mkdirSync(root)
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  return { home, root }
}

function writeExecutable(home, name = 'assess-task-mcp') {
  const command = path.join(home, name)
  fs.writeFileSync(command, '#!/bin/sh\nexit 0\n', { mode: 0o700 })
  return command
}

function profile(command, expectedSha256 = '') {
  return {
    command,
    args: ['--stdio'],
    baseUrl: 'https://assess.example.com',
    account: 'tester',
    expectedSha256
  }
}

test('stores non-secret runtime profiles outside the workspace with mode 0600', (t) => {
  const { home, root } = fixture(t)
  const command = writeExecutable(home)
  const saved = saveRuntimeProfile(root, 'assess-task-local', profile(command), { home })
  assert.equal(saved.account, 'tester')
  assert.equal(saved.command, command)
  assert.equal('password' in saved, false)
  assert.deepEqual(getRuntimeProfile(root, 'assess-task-local', { home }), saved)

  const file = path.join(home, 'mcp-runtime.json')
  assert.equal(fs.statSync(file).mode & 0o777, 0o600)
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /ASSESS_PASSWORD|password/)

  assert.deepEqual(removeRuntimeProfile(root, 'assess-task-local', { home }), { id: 'assess-task-local', removed: true })
  assert.equal(getRuntimeProfile(root, 'assess-task-local', { home }), null)
})

test('diagnoses executable permission, checksum, architecture and signature', (t) => {
  const { home } = fixture(t)
  const command = writeExecutable(home)
  const expectedSha256 = crypto.createHash('sha256').update(fs.readFileSync(command)).digest('hex')
  const runner = (program) => {
    if (program === 'file') return `${command}: Mach-O 64-bit executable x86_64`
    const error = new Error('code object is not signed at all')
    error.stderr = 'code object is not signed at all'
    throw error
  }
  const result = diagnoseExecutable(profile(command, expectedSha256), {
    platform: 'darwin', arch: 'x64', runner
  })
  assert.equal(result.ready, true)
  assert.equal(result.actualSha256, expectedSha256)
  assert.equal(result.architecture, 'x86_64')
  assert.equal(result.signature, 'unsigned')
  assert.ok(result.warnings.some((item) => item.code === 'MCP_EXECUTABLE_UNSIGNED'))
})

test('reports missing execute permission, checksum mismatch and architecture mismatch as blockers', (t) => {
  const { home } = fixture(t)
  const command = writeExecutable(home)
  fs.chmodSync(command, 0o600)
  const result = diagnoseExecutable(profile(command, 'a'.repeat(64)), {
    platform: 'darwin',
    arch: 'arm64',
    runner: (program) => program === 'file' ? `${command}: Mach-O 64-bit executable x86_64` : ''
  })
  assert.equal(result.ready, false)
  assert.ok(result.blockers.some((item) => item.code === 'MCP_EXECUTABLE_NOT_EXECUTABLE'))
  assert.ok(result.blockers.some((item) => item.code === 'MCP_EXECUTABLE_SHA_MISMATCH'))
  assert.ok(result.blockers.some((item) => item.code === 'MCP_EXECUTABLE_ARCH_MISMATCH'))
})

test('keeps passwords in the injected secret store and only exposes the child environment internally', (t) => {
  const { home, root } = fixture(t)
  const command = writeExecutable(home)
  saveRuntimeProfile(root, 'assess-task-local', profile(command), { home })
  const values = new Map()
  const secretStore = {
    getSecret: (provider, { name }) => values.get(`${provider}:${name}`) || null,
    setSecret: (provider, value, { name }) => (values.set(`${provider}:${name}`, value), { stored: true }),
    deleteSecret: (provider, { name }) => ({ removed: values.delete(`${provider}:${name}`) })
  }

  setRuntimePassword(root, 'assess-task-local', 'private-password', { secretStore })
  assert.equal(inspectRuntimeProfile(root, 'assess-task-local', { home, secretStore }).passwordStored, true)
  assert.deepEqual(runtimeEnvironment(root, 'assess-task-local', { home, secretStore }), {
    ASSESS_BASE_URL: 'https://assess.example.com',
    ASSESS_ACCOUNT: 'tester',
    ASSESS_PASSWORD: 'private-password'
  })
  assert.equal(deleteRuntimePassword(root, 'assess-task-local', { secretStore }).removed, true)
})
