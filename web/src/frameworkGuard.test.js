import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const sourceRoot = path.join(webRoot, 'src')

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const absolute = path.join(dir, entry.name)
    return entry.isDirectory() ? filesUnder(absolute) : [absolute]
  })
}

test('ships only the React frontend framework', () => {
  const files = filesUnder(sourceRoot)
  assert.deepEqual(files.filter(file => file.endsWith('.' + 'v' + 'ue')), [])

  const active = files.filter(file => !file.endsWith('.test.js')).map(file => fs.readFileSync(file, 'utf8')).join('\n')
  const banned = ['v' + 'ue-router', 'p' + 'inia', '@arco-design/web-' + 'vue', '@umijs/' + 'max']
  for (const value of banned) assert.equal(active.includes(value), false, `legacy reference: ${value}`)

  const pkg = JSON.parse(fs.readFileSync(path.join(webRoot, 'package.json'), 'utf8'))
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies }
  for (const value of ['v' + 'ue', 'v' + 'ue-router', 'p' + 'inia', '@arco-design/web-' + 'vue']) {
    assert.equal(value in dependencies, false, `legacy dependency: ${value}`)
  }

  const index = fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8')
  assert.match(index, /src="\/src\/main\.tsx"/)
  assert.doesNotMatch(index, /src="\/src\/main\.js"/)
})
