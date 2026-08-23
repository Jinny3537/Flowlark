# 公共仓库设置清单

这份清单用于把 Flowlark 源码仓库配置成适合团队共同维护的 GitHub public repository。

## 创建仓库

```bash
gh auth login
gh repo create Flowlark --public --source=. --remote=origin --push
```

如果仓库已在 GitHub 上创建：

```bash
git remote add origin https://github.com/<owner>/Flowlark.git
git push -u origin main
```

创建完成后，把 `package.json` 里的 `OWNER/flowlark` 替换成真实的 `<owner>/Flowlark`。

## 必开设置

- General：开启 Issues 和 Discussions（如果团队需要公开问答）。
- Pull Requests：开启 squash merge 或 merge commit，按团队习惯二选一。
- Branch protection：保护 `main`，要求 PR、要求 CI 通过、禁止 force push。
- Security：开启 private vulnerability reporting。
- Actions：允许 GitHub Actions 运行，CI 会跑测试、构建 Web 工作台和冒烟流程。
- Dependabot：保留 `.github/dependabot.yml`，让前端依赖和 Actions 自动升级。

## 推荐权限

- Maintainer：少量核心维护者，负责 release、分支保护和安全问题。
- Triage：产品、测试、设计同事，用于整理 issue、复现问题、补标签。
- Contributor：通过 fork 或分支提交 PR。

## 公开边界

Flowlark 源码仓库可以 public。实际原型数据仓库要单独判断：

- 包含未公开产品规划、客户名称、内部评审截图时，不要公开。
- 对外演示用样例仓库可以公开，但要先清理原型中的账号、接口地址和业务数据。
- 不要提交访问令牌；使用环境变量或系统钥匙串。
