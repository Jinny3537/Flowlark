# 参与开发

## 环境

Node **18.17+**（`parseArgs` 要 18.3、`fetch` 要 18）。仓库带了 `.nvmrc`，用 nvm 的话 `nvm use` 即可。

`git` 不是必需的——没有它 Flowlark 本身照常工作，只是同步、历史追溯、冲突处理那几个命令会明确报错。但**跑测试需要 git**，`gitint.test.js` 与 `git.test.js` 跑的是真实 git 命令。

```bash
git clone <仓库地址> && cd flowlark
npm test                 # 167 项，不需要装任何依赖
npm run build:web        # 构建浏览器工作台（首次约 1-2 分钟）
node bin/flowlark.js --help
```

## 项目结构

```
bin/flowlark.js     CLI 入口
src/core/           ← CLI 与 HTTP 的唯一事实来源
  store.js          文件读写；版本号 / 附件名的清洗都在这
  rules.js          R1–R7 业务规则，集中定义
  service.js        业务门面（Hub 类）
  config.js         配置 schema —— 加配置项只改这一处
  git.js  net.js  search.js  readstate.js  offline.js  scan.js
src/cli/            命令行（commands / cmd-git / cmd-find / cmd-admin）
src/server/         本地 HTTP 服务 + 沙箱预览
web/                Vue 3 工作台（只在构建期需要依赖）
test/               10 组测试
```

## 几条不成文的规矩

**业务规则只写在 `src/core/rules.js` 和 `service.js` 里。** CLI 和 HTTP 都是薄包装，任何一边绕过 `Hub` 直接读写文件，两边行为就开始漂移——这是这类「一套数据两个入口」的产品最容易烂掉的地方。

**运行时保持零依赖。** CLI 与服务只用 Node 内置模块。本地工具装起来该是一秒的事，不该为了几十行路由拖进一棵依赖树。Vue / Ant Design Vue 只是 `web/` 的构建期依赖，产物是静态文件。

**加配置项只改 `src/core/config.js` 的 SCHEMA。** CLI 列表、网页设置表单、类型校验都从那一份定义生成。

**错误要带可执行的下一步。** `err.bad(code, message, hint)` 的第三个参数不是可选的装饰——用户看到「变更日志为空」之后需要知道敲什么命令去补。

**改到磁盘布局时，先想 Git diff 长什么样。** 数据是给人 review 的，见 [docs/STORAGE.md](docs/STORAGE.md)。

## 测试

```bash
npm test                              # 全部
node --test test/rules.test.js        # 单组
node --test --test-name-pattern="基线" test/*.test.js
```

测试**不 mock**：CLI 测试真的 spawn 进程，服务测试真的起 HTTP，Git 测试真的跑 `git init/commit/merge`，离线化测试起一个本地 HTTP 服务扮演 CDN。

这不是洁癖。这个项目里几乎每个真实缺陷都是「跑起来才暴露」的类型：Git 把中文文件名转义成八进制、`git add -A` 卷走用户的草稿、porcelain 在无提交时把分支名报成 `No commits yet on master`、端口 0 被 `||` 判成假值。Mock 掉这些边界，测试就只是在验证我对 API 的想象。

新增功能请一并补测试，尤其是**你在实现时踩到的那个坑**——那往往比正常路径更值得固化下来。

## 提交

提交信息用中文或英文都行，说清楚「改了什么」比格式重要。涉及业务规则变动时，请在 PR 描述里说明取舍理由——`README.md` 里那些「为什么这么设计」的段落就是这么积累起来的。
