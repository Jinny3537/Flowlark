import fs from 'node:fs'
import path from 'node:path'

const TOP_LEVEL_FILES = new Set([
  'flowlark.json',
  'mcp.json',
  '.gitignore',
  '.gitattributes',
  '.flowlark/sync-audit.ndjson'
])

function fail(message) {
  throw new Error(`metadata backup: ${message}`)
}

function backupBase(root) {
  return path.resolve(root, '.flowlark', 'backup')
}

function assertBackupPath(root, backup) {
  const base = backupBase(root)
  const target = path.resolve(backup)
  const relative = path.relative(base, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    fail('path must be inside .flowlark/backup/')
  }
  return target
}

function isScoped(relative) {
  if (TOP_LEVEL_FILES.has(relative)) return true
  const segments = relative.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..' || segment.includes('\\'))) return false
  return /^projects\/[^/]+\/project\.json$/.test(relative) ||
    /^projects\/[^/]+\/versions\/[^/]+\.json$/.test(relative) ||
    /^requirements\/[^/]+\/requirement\.json$/.test(relative) ||
    /^milestones\/[^/]+\.json$/.test(relative) ||
    /^snapshots\/[^/]+\.json$/.test(relative) ||
    /^acceptances\/(?:[^/]+\/)*[^/]+\.json$/.test(relative)
}

function existingDirectory(root, relative) {
  const target = path.join(root, ...relative.split('/'))
  try {
    const stat = fs.lstatSync(target)
    return stat.isDirectory() && !stat.isSymbolicLink() ? target : null
  } catch {
    return null
  }
}

function addRegularFile(root, relative, result) {
  if (!isScoped(relative)) return
  const target = path.join(root, ...relative.split('/'))
  try {
    const stat = fs.lstatSync(target)
    if (stat.isFile() && !stat.isSymbolicLink()) result.push(relative)
  } catch {
    // Missing optional metadata is represented by its absence from the manifest.
  }
}

function directDirectories(root, relative) {
  const dir = existingDirectory(root, relative)
  if (!dir) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
    .map((entry) => entry.name)
    .sort()
}

function directJsonFiles(root, relative) {
  const dir = existingDirectory(root, relative)
  if (!dir) return []
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.json'))
    .map((entry) => `${relative}/${entry.name}`)
    .sort()
}

function recursiveJsonFiles(root, relative, result) {
  const dir = existingDirectory(root, relative)
  if (!dir) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const child = `${relative}/${entry.name}`
    if (entry.isDirectory() && !entry.isSymbolicLink()) recursiveJsonFiles(root, child, result)
    else if (entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.json')) result.push(child)
  }
}

function scopedFiles(root) {
  const result = []
  for (const relative of TOP_LEVEL_FILES) addRegularFile(root, relative, result)
  for (const slug of directDirectories(root, 'projects')) {
    addRegularFile(root, `projects/${slug}/project.json`, result)
    for (const relative of directJsonFiles(root, `projects/${slug}/versions`)) addRegularFile(root, relative, result)
  }
  for (const code of directDirectories(root, 'requirements')) {
    addRegularFile(root, `requirements/${code}/requirement.json`, result)
  }
  for (const relative of directJsonFiles(root, 'milestones')) addRegularFile(root, relative, result)
  for (const relative of directJsonFiles(root, 'snapshots')) addRegularFile(root, relative, result)
  const acceptances = []
  recursiveJsonFiles(root, 'acceptances', acceptances)
  for (const relative of acceptances) addRegularFile(root, relative, result)
  return [...new Set(result)].sort()
}

function assertDirectoryChainHasNoSymlink(root, relative) {
  let current = path.resolve(root)
  for (const segment of relative.split('/').slice(0, -1)) {
    current = path.join(current, segment)
    if (!fs.existsSync(current)) break
    if (fs.lstatSync(current).isSymbolicLink()) fail(`symlinked directory is not allowed: ${relative}`)
  }
}

function copyRegularFile(root, targetRoot, relative) {
  assertDirectoryChainHasNoSymlink(root, relative)
  const source = path.join(root, ...relative.split('/'))
  const sourceStat = fs.lstatSync(source)
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) fail(`source is not a regular file: ${relative}`)
  const target = path.join(targetRoot, ...relative.split('/'))
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
}

export function createMetadataBackup(root, { from, to, now = new Date() } = {}) {
  const createdAt = now instanceof Date ? now.toISOString() : new Date(now).toISOString()
  const stamp = createdAt.replace(/[:.]/g, '-')
  const backup = assertBackupPath(root, path.join(backupBase(root), `schema-${from}-${stamp}`))
  assertDirectoryChainHasNoSymlink(root, '.flowlark/backup/manifest.json')
  if (fs.existsSync(backup)) fail(`backup already exists: ${backup}`)
  fs.mkdirSync(backup, { recursive: true })

  const files = scopedFiles(root)
  for (const relative of files) copyRegularFile(root, backup, relative)
  const manifest = { from: Number(from), to: Number(to), createdAt, files }
  fs.writeFileSync(path.join(backup, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8')
  validateMetadataBackup(root, backup)
  return backup
}

export function validateMetadataBackup(root, backup) {
  const target = assertBackupPath(root, backup)
  const relativeTarget = path.relative(path.resolve(root), target).split(path.sep).join('/')
  assertDirectoryChainHasNoSymlink(root, `${relativeTarget}/manifest.json`)
  const targetStat = fs.lstatSync(target)
  if (!targetStat.isDirectory() || targetStat.isSymbolicLink()) fail('backup must be a regular directory')
  const manifestFile = path.join(target, 'manifest.json')
  const manifestStat = fs.lstatSync(manifestFile)
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) fail('manifest.json must be a regular file')

  let manifest
  try {
    manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
  } catch (error) {
    fail(`invalid manifest.json: ${error.message}`)
  }
  if (!Number.isFinite(manifest.from) || !Number.isFinite(manifest.to) ||
      typeof manifest.createdAt !== 'string' || !Array.isArray(manifest.files)) {
    fail('manifest.json is incomplete')
  }
  const files = [...new Set(manifest.files)]
  if (files.length !== manifest.files.length || files.some((relative) => typeof relative !== 'string' || !isScoped(relative)) ||
      files.some((relative, index) => index > 0 && files[index - 1] > relative)) {
    fail('manifest contains invalid metadata paths')
  }
  for (const relative of files) {
    assertDirectoryChainHasNoSymlink(target, relative)
    const source = path.join(target, ...relative.split('/'))
    const stat = fs.lstatSync(source)
    if (!stat.isFile() || stat.isSymbolicLink()) fail(`backup file is invalid: ${relative}`)
  }
  return manifest
}

export function restoreMetadataBackup(root, backup) {
  const target = assertBackupPath(root, backup)
  const manifest = validateMetadataBackup(root, target)
  const expected = new Set(manifest.files)

  for (const relative of scopedFiles(root)) {
    if (!expected.has(relative)) fs.rmSync(path.join(root, ...relative.split('/')))
  }
  for (const relative of manifest.files) {
    assertDirectoryChainHasNoSymlink(root, relative)
    const destination = path.join(root, ...relative.split('/'))
    if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) fs.rmSync(destination)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.copyFileSync(path.join(target, ...relative.split('/')), destination)
  }
  return { restored: true, backup: target, files: [...manifest.files] }
}
