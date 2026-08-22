import { c } from './ui.js'

export const HELP = `${c.bold('Flowlark')} ${c.dim('·')} ${c.cyan('Where prototypes flow')}

  ${c.dim('本地原型版本库。CLI 管数据，浏览器看原型，数据是纯文本文件直接进 Git。')}

${c.bold('起步')}
  flowlark init                       在当前目录创建仓库
  flowlark new "订单中心重构"          新建项目
  flowlark add 原型.html -n v1.0 -t "首版"
  flowlark open                       起服务并打开浏览器工作台

${c.bold('日常')}
  ${c.cyan('add')} <文件>          归档一个新版本
  ${c.cyan('ls')} [项目]           列出项目 / 版本时间线
  ${c.cyan('show')} <项目> <版本>   查看版本详情
  ${c.cyan('baseline')} <项目> <版本>  设为当前基线（研发按这版开发）
  ${c.cyan('rollback')} <项目>     回滚到上一个基线
  ${c.cyan('change')} <项目> <版本> 追加一条变更日志
  ${c.cyan('spec')} <项目> <版本>   查看 / 编辑 / 回溯规格书
  ${c.cyan('diff')} [项目]         累计变更 + 反复修改热点

${c.bold('检索与组织')}
  ${c.cyan('search')} <关键词>     全库搜索：标题、变更日志、规格书、需求号
  ${c.cyan('read')} <项目> [版本]   标记「我看到这一版了」，diff 会从这里算起
  ${c.cyan('tag')} [项目] [版本] [标签…]   版本标签，用于标注里程碑
  ${c.cyan('attach')} <项目> <版本> <文件…>  挂 PRD / 设计稿 / 评审纪要，随 Git 提交
  ${c.cyan('offline')} <项目> <版本>  抓取 CDN 依赖生成自包含的离线版
  ${c.cyan('compare')} <项目> <v1> <v2>  浏览器里并排对比两个版本

${c.bold('Git')}
  ${c.cyan('sync')}                提交 + 拉取 + 推送，一步到位
  ${c.cyan('history')} <项目> <版本>  这一版都谁改过、改了哪部分
  ${c.cyan('blame')} <项目>        基线变迁史：什么时候切到了哪一版、谁切的
  ${c.cyan('resolve')}             查看冲突；基线冲突可辅助解决
  ${c.cyan('git')}                 Git 助手：体检、纳入管理、权限探测、继续/放弃、交给 AI 助理

${c.bold('系统')}
  ${c.cyan('config')}              查看 / 修改配置（服务、Git、业务规则、外观）
  ${c.cyan('lan')} [on|off]        局域网访问：读开放给同事，写只留本机
  ${c.cyan('remote')} [地址]        Git 远端配置

${c.bold('管理')}
  ${c.cyan('status')}              仓库概览 + Git 状态 + 未读提醒
  ${c.cyan('log')} [项目]          操作日志
  ${c.cyan('rm')} / ${c.cyan('restore')} / ${c.cyan('trash')}   删除、恢复、回收站
  ${c.cyan('void')} / ${c.cyan('reopen')}       废弃、重新打开
  ${c.cyan('watch')} <项目> -d <目录>  监听目录，新 HTML 自动归档为草稿

${c.bold('服务')}
  ${c.cyan('serve')}               启动本地服务（默认 7788）
  ${c.cyan('open')} [项目] [版本]    起服务并打开浏览器

${c.dim('查看单条命令的详细用法：flowlark help <命令>')}
${c.dim('全局：-h 帮助  -V 版本  --json 机器可读输出  NO_COLOR=1 关闭颜色')}
`

export const COMMAND_HELP = {
  init: `${c.bold('flowlark init')} [目录]

在指定目录（默认当前目录）创建原型仓库，生成：
  flowlark.json     仓库配置
  projects/         项目数据
  .gitattributes    HTML 标为 binary；操作日志用 union 合并策略避免无谓冲突
  .gitignore

之后 ${c.cyan('flowlark git setup')} 就能纳入版本控制 —— 初始化、提交身份、首次提交一次做完。
团队 pull 后各自本地跑。
`,

  new: `${c.bold('flowlark new')} <项目名> [选项]

  --code <标识>    项目目录名，小写字母/数字/连字符。默认从项目名生成
  --desc <描述>

示例
  flowlark new "订单中心重构" --code order-center --desc "列表与详情改版"
`,

  add: `${c.bold('flowlark add')} <HTML文件> [选项]

  -p, --project <标识>   目标项目（仓库只有一个项目时可省略）
  -n, --version <版本号>  版本号。省略时从文件名推断，再不行按日期生成
  -t, --title <标题>     版本标题（必填）
  -m, --message <变更>   变更日志，可重复。格式「类型:位置:说明[:需求号]」
      --req <需求>       关联需求，可重复。格式「编号:标题:URL」
      --tag <标签>       版本标签，可重复
      --baseline         归档后立刻设为当前基线

变更类型可写中文或英文：新增/修改/删除 或 ADD/MODIFY/REMOVE

示例
  flowlark add ./订单中心_v1.1.html -n v1.1 -t "批量操作首版" \\
    -m "新增:订单列表-工具栏:新增批量关闭按钮:REQ-0275" \\
    -m "修改:订单列表-筛选区:筛选区由两行压缩为一行" \\
    --req "REQ-0275:订单批量关闭:https://req.internal/REQ-0275" \\
    --tag 已评审
`,

  baseline: `${c.bold('flowlark baseline')} <项目> <版本号>

把指定版本设为当前基线。研发打开工作台默认看到的就是它。

规则
  · 同一项目同时只有一个基线（由 BASELINE 文件结构性保证），切换是原子操作
  · 设为基线前变更日志不能为空（首个版本、以及回滚到老基线时豁免）
  · 基线的原型文件与变更日志随即锁定，规格书仍可编辑
`,

  rollback: `${c.bold('flowlark rollback')} <项目>

回滚到上一个当过基线的版本。用于新版评审没过、需要让研发退回上一版的场景。
不会要求补写变更日志 —— 回滚是止血动作，不是向前推进。
`,

  change: `${c.bold('flowlark change')} <项目> <版本号> -m "类型:位置:说明[:需求号]"

给版本追加一条变更日志。只有「编辑中」的版本能改。

示例
  flowlark change order-center v1.2 -m "修改:订单详情-头部:金额字号放大到 24px"
`,

  spec: `${c.bold('flowlark spec')} <项目> <版本号> [选项]

  --edit             用 $EDITOR 打开规格书编辑
  -f, --file <路径>    从文件导入规格书内容
  --history          这份规格书什么时候被谁改过（读 Git 历史）
  --at <提交号>       回看某次提交时的规格书内容

不带选项时直接打印当前内容。
规格书是独立的 <版本号>.spec.md，可以直接用编辑器改、用 Git diff 看。
它不受基线锁定影响 —— 开发期补说明是常态。

示例
  flowlark spec order-center v1.2 --history
  flowlark spec order-center v1.2 --at a1b2c3d
`,

  diff: `${c.bold('flowlark diff')} [项目] [选项]

  --from <版本号>   起点
  --to <版本号>     终点，默认当前基线

不带 --from/--to 时，起点取${c.bold('你上次标记已读的那一版')}（见 flowlark read），
没有已读记录则退化为「比上一版改了什么」。

聚合区间内所有变更日志，并统计每个位置被改动的次数 ——
反复返工的区域会被顶出来，这是研发跳版本开发时最需要的信息。
`,

  search: `${c.bold('flowlark search')} <关键词> [选项]

  -p, --project <标识>   限定项目
      --field <字段>     限定搜索范围，逗号分隔
      --limit <条数>     默认 30

可用字段：versionNo、projectName、title、tag、requirement、change、spec、note、description

命中按相关度排序：版本号 > 项目名 > 版本标题 > 标签 > 需求 > 变更日志 > 规格书正文。
同分时当前基线优先 —— 你多半想找的就是现在生效的那一版。

示例
  flowlark search 批量导出
  flowlark search 幂等 --field spec
`,

  read: `${c.bold('flowlark read')} <项目> [版本号]

  不给版本号   查看当前已读状态，以及之后新增了几版
  <版本号>     标记为已读；用 . 表示当前基线
  --clear      清除标记

已读状态存在 .flowlark/cache/ 下，${c.bold('不进 Git')} —— 它是每个人自己的，
提交上去会变成「张三把李四标成已读」这种荒唐冲突。

标记之后 ${c.cyan('flowlark ls')} 会给新版本打「新」，${c.cyan('flowlark diff')} 会从这一版算起。
`,

  tag: `${c.bold('flowlark tag')} [项目] [版本号] [标签…]

  不带参数              列出全仓库用过的标签
  <项目> <版本>          查看该版本的标签
  <项目> <版本> 已评审   添加标签
  <项目> <版本> -已评审  移除标签（前面加减号）
  --clear               清空该版本标签

标签不受基线锁定影响 —— 它是事后追加的组织信息，和「这一版长什么样」这个事实无关。
`,

  offline: `${c.bold('flowlark offline')} <项目> <版本号> [--clear]

抓取原型引用的 CDN 资源并内联，生成一个自包含的 HTML。
断网、上高铁、代理拦截时用它预览，样式不会掉。

${c.bold('不会修改原型文件本身')} —— 原型是需求追溯的证据，确认后不可变。
离线版是派生产物，存在 .flowlark/cache/offline/ 下，不进 Git，随时可重新生成。
正因为如此，基线版本也能生成离线版而不违反不可变性。
`,

  compare: `${c.bold('flowlark compare')} <项目> [版本A] [版本B]

起服务并在浏览器里并排打开两个版本的原型，左右对照着看。

省略版本时：A 取当前基线，B 取时间线上相邻的另一版。
手写变更日志难免有遗漏，肉眼并排看是最后一道保险。
`,

  sync: `${c.bold('flowlark sync')} [选项]

  -m, --message <说明>   提交信息。不给会按改动内容自动生成
      --no-push          只提交和拉取，不推送

${c.bold('只提交 Flowlark 自己的路径')}（projects/、flowlark.json 等），
不碰你放在同一个文件夹里的原型源文件、临时截图 ——
那些要提交请直接用 git。跳过了哪些文件会在输出里列出来。

顺序是 ${c.bold('提交 → 拉取(rebase) → 推送')}，不是先拉后提交：
先提交能保证 rebase 时冲突落在自己的提交上，语义清楚；
反过来做，未提交的改动会在 rebase 时被 stash 来 stash 去，出问题很难解释。

产生冲突时会提示用 ${c.cyan('flowlark resolve')} 处理。
`,

  history: `${c.bold('flowlark history')} <项目> [版本号]

这一版都被谁改过、每次改的是元数据、规格书还是原型文件本身。
底下是 git log，但按版本聚合过：同一次提交同时改了元数据和规格书时会合成一条。

配合 ${c.cyan('flowlark spec <项目> <版本> --at <提交号>')} 可以回看当时的规格书。
`,

  blame: `${c.bold('flowlark blame')} <项目>

基线变迁史：什么时候切到了哪一版、是谁切的、提交说明是什么。

读的是 BASELINE 文件的 Git 历史。因为基线就是那个文件的一行内容，
每次提交取出来就知道当时指向谁 —— 这是把基线做成文件而非字段的又一个好处。
`,

  resolve: `${c.bold('flowlark resolve')} [项目] [版本号]

  不带参数            列出所有冲突文件，并区分哪些能辅助解决
  <项目> <版本号>      直接把该项目的基线定为这一版

基线冲突的内容就是一行版本号，两边各自想指向谁一目了然，
所以不需要用户去理解 Git 的冲突标记，直接问「保留哪个」就行。

注意：${c.dim('rebase 期间 Git 的 ours/theirs 是反的')}，Flowlark 已经翻译好了，
显示的「你这边」「对方」就是字面意思，照着选不会错。

JSON 和 Markdown 的冲突需要手工处理，但因为键序稳定、行粒度小，通常一眼能看懂。
改完执行 ${c.cyan('flowlark git resolved <文件>')}，全部解决后 ${c.cyan('flowlark git continue')}。
`,

  git: `${c.bold('flowlark git')} [子命令]

不带子命令时做一次体检：看当前处境，告诉你下一件该做的事。

  setup       把仓库纳入 Git（初始化 + 身份 + 首次提交，一步到位）
                --name / --email / --remote / -m
  whoami      查看或设置提交身份（--name --email，加 --global 写全局）
  resolved    在编辑器里改好冲突文件后，登记为已解决（不填则登记全部）
  permission  查看 / 刷新远端写权限探测结果（--refresh）
  continue    冲突都解决了，让这次同步走完
  abort       放弃这次同步，回到操作之前
  brief       生成一段交给 AI 助理的说明（含仓库处境与必须遵守的约定）

${c.bold('为什么有这一组命令')}

因为你不该为了用这个软件去学 Git。以前遇到「没纳入 Git」「rebase 卡住了」，
产品只会印一行命令让你自己去终端敲 —— 那是在最需要帮忙的时刻把人推开。
现在每种处境都有对应的动作，记不住就敲 ${c.cyan('flowlark git')}。

${c.bold('Git 只读模式')}

v0.2.0 起，Flowlark 会缓存一次远端写权限探测结果。
明确探测到远端拒绝写入时，CLI 与工作台都会进入 Git 只读模式，提前拦截写操作。
探测失败或离线时默认按可写处理，避免本地办公被误锁。
远端权限变更后执行 ${c.cyan('flowlark git permission --refresh')} 刷新。

${c.bold('关于 AI 助理')}

Flowlark 自己不接 AI：不想为了生成一句提交说明就要你去申请 API key，
更不想把仓库内容发给第三方。但你手边多半已经有 Claude Code、Cursor 这类工具，
它们能读仓库也能执行 git，缺的只是上下文 —— 不知道 BASELINE 是一行文本、
不知道哪些路径归 Flowlark 管，于是会给出错误的建议。

${c.cyan('flowlark git brief')} 就是把这些整理成一段说明，粘给助理即可。
交出去的是描述，不是数据：只有路径、状态和规则，没有任何原型内容。

  flowlark git brief | pbcopy        ${c.dim('直接进剪贴板')}
  flowlark git brief > 交给助理.md    ${c.dim('存成文件')}
`,

  watch: `${c.bold('flowlark watch')} <项目> -d <目录>

监听目录，新出现的 .html 自动归档为草稿版本。
适合边改边存的场景；正式版本仍建议用 ${c.cyan('add')} 显式归档并写变更日志。

版本号从文件名推断（如 订单中心_v1.4.html → v1.4），推不出来时按日期生成。
撞号时自动加后缀。
`,

  attach: `${c.bold('flowlark attach')} <项目> <版本号> [文件…]

  不带文件         列出该版本的附件
  <文件…>          上传一个或多个附件
  --clear <文件名>  删除指定附件

附件存在 projects/<项目>/versions/<版本>.files/，${c.bold('随 Git 一起提交')} —— 它们是真实交付物。
和规格书一样${c.bold('不受基线锁定')}：事后补一份评审纪要是常态，锁死会逼人发假版本。

示例
  flowlark attach order-center v1.2 ./需求文档.pdf ./评审纪要.md
`,

  config: `${c.bold('flowlark config')} [配置项] [值]

  不带参数           分组列出全部配置
  <配置项>           查看单项详情、默认值与风险说明
  <配置项> <值>       修改
  <配置项> --clear   恢复默认
  --edit             用 $EDITOR 直接改 flowlark.json

配置存在仓库根目录的 flowlark.json 里，${c.bold('随 Git 提交，团队共用同一份')}。

标 ${c.red('!')} 的是高风险开关 —— 关掉会削弱产品的核心保证（如 R4 基线锁定、R6 变更日志必填）。

示例
  flowlark config server.maxFileBytes 50MB
  flowlark config ui.requirementUrlTemplate "https://jira.internal/browse/{code}"
`,

  lan: `${c.bold('flowlark lan')} [on|off]

  不带参数    查看当前状态与本机的局域网地址
  on / off    开启 / 关闭局域网访问（需重启服务生效）

安全模型：${c.bold('读开放给局域网，写只留给本机')}。

这个产品没有账号体系。开到局域网后「没有鉴权」立刻从无所谓变成
同网段任何人都能删版本改基线，而真实需求其实只是「让研发能打开看」——
按请求来源区分读写，成本最低，也没有密码可泄漏。

局域网用户的界面会显式标「只读」并隐藏写操作按钮。
真要多人可写：flowlark config server.readonlyFromLan false
`,

  remote: `${c.bold('flowlark remote')} [地址]

  不带参数    查看当前远端与同步状态
  <地址>      设置远端（已存在则改地址）
  --clear     移除远端

配置后 ${c.cyan('flowlark sync')} 会自动推送，首次推送自动建立上游分支。

顺带会设 core.quotepath=false，让中文文件名在 git 输出里正常显示 ——
Git 默认把非 ASCII 文件名转义成八进制，中文项目里 git status 全是乱码。
`,

  serve: `${c.bold('flowlark serve')} [选项]

  --port <端口>    工作台端口，默认 7788
  --lan            本次启动开放局域网（不改配置）

同时会在 端口+1 上启动原型预览服务。两个端口不同源，
原型里的脚本因此读不到工作台的任何数据 —— 这是沙箱隔离的实现方式。

开了局域网时会打印同事该访问的地址，并说明当前的读写策略。
`,

  open: `${c.bold('flowlark open')} [项目] [版本号]

启动本地服务并用默认浏览器打开工作台。
给了项目/版本就直接跳到对应页面。
  --no-open        只起服务，不开浏览器
`,

  status: `${c.bold('flowlark status')}

一屏看完：项目数、版本数、Git 分支与同步状态、冲突、缺基线的项目、
以及${c.bold('哪些项目有你没看过的新版本')}。

最后一项配合 ${c.cyan('flowlark read')} 使用，是研发每天上班第一条命令。
`
}
