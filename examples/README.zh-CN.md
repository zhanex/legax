# 示例

[English](README.md) | 简体中文

如果你想从一个较小、容易检查的配置开始，而不是直接阅读根目录完整配置，请从这里开始。

## 最小本地 Relay

[`config.example.minimal.zh-CN.yaml`](config.example.minimal.zh-CN.yaml) 会把一个 Codex adapter 通过本机 self-hosted relay 连接到手机。

在源码 checkout 中试用：

```bash
cp examples/config.example.minimal.zh-CN.yaml config.yaml
node scripts/simple-relay-server.mjs
```

在第二个终端中：

```bash
npm run daemon:bg
npm run daemon:pair
```

用能访问 relay URL 的浏览器或手机打开输出的 pair URL。

在 Windows PowerShell 中，使用 `Copy-Item examples/config.example.minimal.zh-CN.yaml config.yaml` 替代 `cp`。

## 注意

- 将 `replace-with-a-long-random-secret` 替换成同一个生成值，并同时写入 `relay.secret` 和 `transports[0].secret`。
- 最小示例有意省略 Claude Code、Gemini CLI 和 OpenCode。需要时从 [`../config.example.zh-CN.yaml`](../config.example.zh-CN.yaml) 复制对应段落。
- 如果是通过 npm 安装使用，优先运行 `legax init` 和 `legax doctor --offline`；上面的源码 checkout 命令主要面向贡献者和快速检查。
