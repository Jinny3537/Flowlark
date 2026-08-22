# 更新

在设置中填写 `integrations.updateManifestUrl`。Flowlark 后台读取 JSON 清单，不阻塞工作台：

```json
{
  "version": "0.6.5",
  "url": "https://downloads.example/Flowlark-0.6.5.zip",
  "sha256": "64 位小写十六进制 SHA-256",
  "minSchemaVersion": 2,
  "publishedAt": "2026-08-23T00:00:00.000Z"
}
```

下载先写临时文件，SHA-256 完全一致后才改名为可安装文件。网络失败、清单无效、Schema 不兼容或校验失败时保留当前版本。v0.6.5 不静默替换正在运行的应用。
