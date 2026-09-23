import { test } from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { editablePreviewHtml } from '../src/server/index.js'
import { editsRuntimeScript, injectBeforeBodyEnd } from '../src/server/prototype-edits.js'

test('editor scripts remain valid with HTML/script-like strings in the original source', () => {
  const source = '<!DOCTYPE html><html><body><p>old</p><script>const template = "</body>";</script></body></html>'
  const edited = editablePreviewHtml(Buffer.from(source))
  const scripts = [...edited.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
  assert.equal(scripts.length, 3)
  for (const [, script] of scripts) assert.doesNotThrow(() => new vm.Script(script))
  assert.ok(edited.indexOf('id="flowlark-edit-bridge"') > edited.indexOf('const template'))
  assert.equal(injectBeforeBodyEnd('fragment', 'runtime'), 'fragmentruntime')
})

test('saved patches cannot terminate the runtime script and only one runtime is injected', () => {
  const runtime = editsRuntimeScript([{ id: 'main', before: '<p>old</p>', after: '<p></script>)(</p>' }])
  assert.equal([...runtime.matchAll(/<\/script>/g)].length, 1)
  assert.doesNotThrow(() => new vm.Script(runtime.slice(runtime.indexOf('>') + 1, -9)))
  const edited = editablePreviewHtml(Buffer.from(`<html><body>${runtime}</body></html>`))
  assert.equal([...edited.matchAll(/<script id="flowlark-saved-edits">/g)].length, 1)
})
