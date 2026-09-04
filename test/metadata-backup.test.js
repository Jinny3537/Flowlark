import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  createMetadataBackup,
  restoreMetadataBackup,
  validateMetadataBackup
} from '../src/core/metadata-backup.js'

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-backup-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  return root
}

test('restores touched metadata and removes scoped files created after backup', (t) => {
  const root = fixture(t)
  fs.mkdirSync(path.join(root, 'projects', 'orders'), { recursive: true })
  fs.writeFileSync(path.join(root, 'flowlark.json'), '{"schemaVersion":2}\n')
  fs.writeFileSync(path.join(root, 'projects', 'orders', 'project.json'), '{"name":"before"}\n')

  const backup = createMetadataBackup(root, { from: 2, to: 3, now: new Date('2026-09-04T00:00:00Z') })
  fs.writeFileSync(path.join(root, 'projects', 'orders', 'project.json'), '{"name":"after"}\n')
  fs.mkdirSync(path.join(root, 'acceptances'), { recursive: true })
  fs.writeFileSync(path.join(root, 'acceptances', 'new.json'), '{}\n')

  restoreMetadataBackup(root, backup)
  assert.equal(fs.readFileSync(path.join(root, 'projects', 'orders', 'project.json'), 'utf8'), '{"name":"before"}\n')
  assert.equal(fs.existsSync(path.join(root, 'acceptances', 'new.json')), false)
})

test('backs up only explicit metadata and leaves content files untouched during restore', (t) => {
  const root = fixture(t)
  const versions = path.join(root, 'projects', 'orders', 'versions')
  const attachments = path.join(versions, 'v1.files')
  fs.mkdirSync(attachments, { recursive: true })
  fs.mkdirSync(path.join(root, '.git'), { recursive: true })
  fs.writeFileSync(path.join(root, 'flowlark.json'), '{"schemaVersion":2}\n')
  fs.writeFileSync(path.join(root, 'projects', 'orders', 'project.json'), '{"name":"before"}\n')
  fs.writeFileSync(path.join(versions, 'v1.json'), '{"versionNo":"v1"}\n')
  fs.writeFileSync(path.join(versions, 'v1.html'), '<p>before</p>')
  fs.writeFileSync(path.join(versions, 'v1.spec.md'), '# before\n')
  fs.writeFileSync(path.join(attachments, 'brief.txt'), 'before')
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'before')
  fs.writeFileSync(path.join(root, 'notes.txt'), 'before')

  const backup = createMetadataBackup(root, { from: 2, to: 3, now: new Date('2026-09-04T00:00:00Z') })
  const manifest = validateMetadataBackup(root, backup)
  assert.deepEqual(manifest.files, [
    'flowlark.json',
    'projects/orders/project.json',
    'projects/orders/versions/v1.json'
  ])

  fs.writeFileSync(path.join(versions, 'v1.json'), '{"versionNo":"changed"}\n')
  fs.writeFileSync(path.join(versions, 'v1.html'), '<p>after</p>')
  fs.writeFileSync(path.join(versions, 'v1.spec.md'), '# after\n')
  fs.writeFileSync(path.join(attachments, 'brief.txt'), 'after')
  fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'after')
  fs.writeFileSync(path.join(root, 'notes.txt'), 'after')
  fs.writeFileSync(path.join(versions, 'v2.html'), '<p>new</p>')

  restoreMetadataBackup(root, backup)
  assert.equal(fs.readFileSync(path.join(versions, 'v1.json'), 'utf8'), '{"versionNo":"v1"}\n')
  assert.equal(fs.readFileSync(path.join(versions, 'v1.html'), 'utf8'), '<p>after</p>')
  assert.equal(fs.readFileSync(path.join(versions, 'v1.spec.md'), 'utf8'), '# after\n')
  assert.equal(fs.readFileSync(path.join(attachments, 'brief.txt'), 'utf8'), 'after')
  assert.equal(fs.readFileSync(path.join(root, '.git', 'HEAD'), 'utf8'), 'after')
  assert.equal(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8'), 'after')
  assert.equal(fs.readFileSync(path.join(versions, 'v2.html'), 'utf8'), '<p>new</p>')
})

test('rejects backup paths outside the repository backup directory', (t) => {
  const root = fixture(t)
  fs.writeFileSync(path.join(root, 'flowlark.json'), '{"schemaVersion":2}\n')
  assert.throws(
    () => validateMetadataBackup(root, path.join(root, 'outside')),
    /backup/i
  )
})

test('does not follow metadata symlinks', (t) => {
  const root = fixture(t)
  const outside = path.join(root, 'outside.json')
  fs.writeFileSync(path.join(root, 'flowlark.json'), '{"schemaVersion":2}\n')
  fs.mkdirSync(path.join(root, 'milestones'), { recursive: true })
  fs.writeFileSync(outside, '{"secret":true}\n')
  fs.symlinkSync(outside, path.join(root, 'milestones', 'linked.json'))

  const backup = createMetadataBackup(root, { from: 2, to: 3, now: new Date('2026-09-04T00:00:00Z') })
  assert.deepEqual(validateMetadataBackup(root, backup).files, ['flowlark.json'])
})
