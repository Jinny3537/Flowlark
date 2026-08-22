# macOS 安装与首次使用

1. 解压 `Flowlark.app` 并移动到“应用程序”。
2. 首次打开若被 Gatekeeper 拦截，在 Finder 中右键应用并选择“打开”。
3. 选择包含 `flowlark.json` 的已有仓库；或先在终端执行 `flowlark workspace clone <Git URL> -d <目录>`。
4. 启动器使用应用内置 Node 运行时，系统无需安装 Node。
5. 工作台打开后，在“工作区”页面确认路径、模式和缺失状态。

Git 的 SSH/HTTPS 认证继续使用系统 Git、SSH Agent 和凭据管理器。Flowlark 不保存 Git 密码。

## 构建应用包

```bash
npm run package:macos
```

产物位于 `dist/Flowlark.app`。打包脚本复制 Node 可执行文件及其 `lib/` 动态库依赖。
