# 支持

## 提问前先准备

请先确认本地环境：

```bash
node -v
git --version
npm test
```

如果问题和某个 Flowlark 数据仓库有关，也请准备：

```bash
flowlark status --json
```

这条命令只输出项目数、版本数、Git 状态等元信息，不包含原型正文。

## 使用哪种入口

- Bug：使用 GitHub 的「报告问题」模板。
- 功能建议：使用「功能建议」模板，先描述实际问题。
- 安全问题：按 [SECURITY.md](SECURITY.md) 私下报告。
- 贡献代码：先读 [CONTRIBUTING.md](CONTRIBUTING.md)，PR 描述里写清楚改动、原因和自检结果。

## 团队使用建议

- 用一个公共仓库放 Flowlark 源码，用另一个团队仓库放实际原型数据。
- 原型数据仓库如果包含未公开产品信息，不要设为 public。
- 给 `main` 开启分支保护，要求 CI 通过后再合并。
- 统一提交身份，避免历史里出现无法识别的作者。
