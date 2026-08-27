import { parseArgs } from 'node:util'
import { PhError } from '../core/errors.js'
import { c } from './ui.js'
import * as cmd from './commands.js'
import * as cmdGit from './cmd-git.js'
import * as cmdFind from './cmd-find.js'
import * as cmdAdmin from './cmd-admin.js'
import * as cmdFeedback from './cmd-feedback.js'
import * as cmdRequirements from './cmd-requirements.js'
import * as cmdMilestones from './cmd-milestones.js'
import * as cmdExport from './cmd-export.js'
import * as cmdWorkspaces from './cmd-workspaces.js'
import { HELP, COMMAND_HELP } from './help.js'

const COMMANDS = {
  // 基础
  init: cmd.init,
  new: cmd.newProject,
  add: cmd.add,
  ls: cmd.ls,
  show: cmd.show,
  baseline: cmd.baseline,
  rollback: cmd.rollback,
  change: cmd.change,
  spec: cmd.spec,
  diff: cmd.diff,
  log: cmd.log,
  status: cmd.status,
  // 生命周期
  rm: cmd.rm,
  restore: cmd.restore,
  trash: cmd.trash,
  void: cmd.voidVersion,
  reopen: cmd.reopen,
  // 检索与组织
  search: cmdFind.search,
  read: cmdFind.read,
  tag: cmdFind.tag,
  offline: cmdFind.offline,
  compare: cmdFind.compare,
  feedback: cmdFeedback.feedback,
  req: cmdRequirements.requirement,
  milestone: cmdMilestones.milestone,
  export: cmdExport.exportPackage,
  workspace: cmdWorkspaces.workspace,
  mirror: cmdWorkspaces.mirror,
  // Git
  sync: cmdGit.sync,
  history: cmdGit.history,
  blame: cmdGit.blame,
  resolve: cmdGit.resolveCmd,
  git: gitAssistant,
  // 系统
  config: cmdAdmin.config,
  remote: cmdAdmin.remote,
  attach: cmdAdmin.attach,
  lan: cmdAdmin.lan,
  // 运行
  watch: cmd.watch,
  serve: cmd.serve,
  open: cmd.open
}

/** 常见笔误直接映射，不必让用户查 help */
const ALIASES = {
  list: 'ls', l: 'ls', create: 'new', import: 'add',
  base: 'baseline', logs: 'log',
  remove: 'rm', delete: 'rm', del: 'rm', server: 'serve', ui: 'open',
  find: 'search', grep: 'search', s: 'search',
  push: 'sync', pull: 'sync', commit: 'sync',
  tags: 'tag', seen: 'read', vendor: 'offline', cmp: 'compare',
  settings: 'config', conf: 'config', cfg: 'config',
  origin: 'remote', upload: 'attach', files: 'attach', network: 'lan',
  doctor: 'git', continue: 'git', abort: 'git', whoami: 'git'
}

/**
 * `flowlark git [子命令]` —— Git 助手。
 *
 * 单独做成子命令组，是因为这些动作只在「Git 出状况」时才需要，
 * 平铺到顶层会让 help 里挤进六七个大多数人一辈子用不上的名字。
 * 不带子命令时做体检，这是最常见的入口：出问题了先敲 flowlark git。
 *
 * 顶层别名 doctor/continue/abort/whoami 会落到这里 ——
 * 用户凭直觉敲 `flowlark continue` 也能work。
 */
const GIT_SUB = {
  setup: cmdGit.setup,
  init: cmdGit.setup,
  whoami: cmdGit.whoami,
  identity: cmdGit.whoami,
  resolved: cmdGit.resolved,
  done: cmdGit.resolved,
  continue: cmdGit.continueCmd,
  abort: cmdGit.abort,
  cancel: cmdGit.abort,
  brief: cmdGit.brief,
  ai: cmdGit.brief,
  permission: cmdGit.permission,
  permissions: cmdGit.permission,
  readonly: cmdGit.permission,
  doctor: cmdGit.doctor,
  status: cmdGit.doctor
}

async function gitAssistant(pos, values, raw) {
  // raw 是用户敲的原始命令名。`flowlark continue` 走到这里时 pos 里没有子命令，
  // 得从命令名本身还原意图。
  const alias = raw && GIT_SUB[raw] ? raw : null
  const sub = alias || (pos[0] && GIT_SUB[pos[0]] ? pos[0] : null)
  const handler = sub ? GIT_SUB[sub] : cmdGit.doctor
  const rest = alias ? pos : pos.slice(sub ? 1 : 0)
  return handler(rest, values)
}

const OPTIONS = {
  project: { type: 'string', short: 'p' },
  // 这里的 --version 是「版本号」，不是「打印程序版本」。
  // 程序版本走 argv[0] 的 --version / -V，已在 run() 开头拦截，不进 parseArgs。
  version: { type: 'string', short: 'n' },
  title: { type: 'string', short: 't' },
  message: { type: 'string', short: 'm', multiple: true },
  req: { type: 'string', multiple: true },
  code: { type: 'string' },
  desc: { type: 'string' },
  dir: { type: 'string', short: 'd' },
  from: { type: 'string' },
  to: { type: 'string' },
  file: { type: 'string', short: 'f' },
  port: { type: 'string' },
  limit: { type: 'string' },
  at: { type: 'string' },
  lan: { type: 'boolean' },
  field: { type: 'string' },
  tag: { type: 'string', multiple: true },
  baseline: { type: 'boolean' },
  edit: { type: 'boolean' },
  history: { type: 'boolean' },
  clear: { type: 'boolean' },
  all: { type: 'boolean', short: 'a' },
  json: { type: 'boolean' },
  yes: { type: 'boolean', short: 'y' },
  'no-open': { type: 'boolean' },
  'no-push': { type: 'boolean' },
  name: { type: 'string', multiple: true },
  email: { type: 'string', multiple: true },
  remote: { type: 'string', multiple: true },
  intent: { type: 'string', multiple: true },
  global: { type: 'boolean' },
  refresh: { type: 'boolean' },
  provider: { type: 'string' },
  owner: { type: 'string' },
  start: { type: 'string' },
  end: { type: 'string' },
  action: { type: 'string' },
  reason: { type: 'string' },
  'plan-hash': { type: 'string' },
  confirm: { type: 'boolean' },
  unfinished: { type: 'boolean' },
  mode: { type: 'string' },
  help: { type: 'boolean', short: 'h' }
}

export async function run(argv) {
  if (argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
    const topic = argv[1]
    console.log(topic && COMMAND_HELP[topic] ? COMMAND_HELP[topic] : HELP)
    return
  }
  if (argv[0] === '--version' || argv[0] === '-V') {
    const { readFileSync } = await import('node:fs')
    const url = new URL('../../package.json', import.meta.url)
    console.log(JSON.parse(readFileSync(url, 'utf8')).version)
    return
  }

  const name = ALIASES[argv[0]] || argv[0]
  const handler = COMMANDS[name]
  if (!handler) {
    console.error(c.red('✗') + ` 未知命令：${argv[0]}`)
    console.error(c.dim('  可用命令：') + Object.keys(COMMANDS).join('、'))
    console.error(c.dim('  查看帮助：flowlark help'))
    process.exitCode = 127
    return
  }

  let parsed
  try {
    // 注意 --version 在这里是「版本号」选项，不是「打印程序版本」；
    // 程序版本用 -V 或裸 --version（已在上面拦截），避免和 `add -n` 的语义打架
    parsed = parseArgs({ args: argv.slice(1), options: OPTIONS, allowPositionals: true })
  } catch (e) {
    console.error(c.red('✗') + ' ' + e.message)
    process.exitCode = 2
    return
  }

  if (parsed.values.help) {
    console.log(COMMAND_HELP[name] || HELP)
    return
  }

  try {
    // 第三个参数是用户敲的原始命令名，git 助手要靠它区分 `flowlark continue` 和 `flowlark git`
    await handler(parsed.positionals, parsed.values, argv[0])
  } catch (e) {
    if (e instanceof PhError) {
      console.error(c.red('✗') + ' ' + e.message)
      if (e.hint) console.error(c.dim('  ' + e.hint))
      process.exitCode = 1
    } else {
      console.error(c.red('✗') + ' ' + (e && e.message ? e.message : String(e)))
      if (process.env.FLOWLARK_DEBUG || process.env.PROTOHUB_DEBUG) console.error(e)
      else console.error(c.dim('  设 FLOWLARK_DEBUG=1 查看完整堆栈'))
      process.exitCode = 1
    }
  }
}
