# 只读镜像

镜像模式适合一台常开机器向非技术成员提供浏览入口：

```bash
flowlark mirror serve
flowlark mirror status
flowlark mirror refresh
```

镜像永久禁止业务写接口，只允许手动刷新。刷新仅执行 `git fetch --prune origin` 和 `git pull --ff-only`。

出现本地改动、非快进或冲突时，自动刷新停止。镜像不会 merge、rebase、force pull、覆盖文件或 push；请先在正常工作区解决 Git 状态，再恢复镜像。
