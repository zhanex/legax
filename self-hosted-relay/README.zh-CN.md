# 自部署 Relay

[English](README.md) | 简体中文

这个目录包含 Legax 的独立自部署 Relay。把它复制到 Linux 服务器后执行 `install.sh` 即可；安装脚本会在需要时安装 Node.js、创建系统用户、写入带自动生成密钥的 YAML 配置、安装系统服务并启动 Relay。整个组件不存在环境变量文件层——所有值都在 YAML 中。

支持的服务管理器：

- systemd：Debian、Ubuntu、Fedora、RHEL、CentOS Stream、Rocky Linux、AlmaLinux、openSUSE、Arch Linux
- OpenRC：Alpine Linux

支持自动安装 Node.js 的包管理器：

- `apt-get`
- `dnf`
- `yum`
- `zypper`
- `pacman`
- `apk`

## 快速安装

如果是在已经安装 Node.js 的轻量 VPS、NAS 或树莓派上运行：

```bash
npm install -g @legax/relay
legax-relay --config /path/to/config.yaml
```

all-in-one 的 `legax` 包也包含 `legax relay start`，但 relay-only 服务器推荐安装更小的 `@legax/relay` 包。

如果需要安装成 Linux 系统服务：

```bash
cd self-hosted-relay
sudo ./install.sh
```

安装脚本会输出：

- 保存自动生成密钥的 YAML 配置文件路径
- relay Web 入口地址；浏览器通过扫描桌面端 `npm run daemon:pair` 生成的二维码，或输入短配对码完成绑定
- 服务状态查看命令

默认情况下脚本不会打印密钥。浏览器访问通过桌面端配对命令生成的一次性短配对码和二维码载荷完成绑定。

## 自定义安装

```bash
sudo SECRET="desktop-secret" \
  ./install.sh --host 0.0.0.0 --port 8787 --session default
```

（`SECRET` 仅在**安装阶段**被脚本读入用于生成 YAML；运行中的 relay 只读 YAML。）

常用选项：

```bash
sudo ./install.sh --install-dir /opt/legax-relay
sudo ./install.sh --config-dir /etc/legax-relay
sudo ./install.sh --data-dir /var/lib/legax-relay
sudo ./install.sh --no-start
sudo ./install.sh --no-node-install
```

## 安装后的文件

- `/opt/legax-relay/server.mjs`
- `/opt/legax-relay/lib/relay-server-core.mjs`
- `/opt/legax-relay/lib/telegram-transport.mjs`
- `/opt/legax-relay/lib/outbound-transports.mjs`
- `/opt/legax-relay/lib/menu-groups.mjs`
- `/opt/legax-relay/lib/yaml.mjs`
- `/opt/legax-relay/lib/paths.mjs`
- `/etc/legax-relay/config.yaml`（host / port / secret / store 路径 / 审计设置——全部 inline）
- `/var/lib/legax-relay/relay-store.json`
- systemd 系统：`/etc/systemd/system/legax-relay.service`
- OpenRC 系统：`/etc/init.d/legax-relay`

## 服务命令

systemd：

```bash
sudo systemctl status legax-relay
sudo systemctl restart legax-relay
sudo journalctl -u legax-relay -f
```

OpenRC：

```bash
sudo rc-service legax-relay status
sudo rc-service legax-relay restart
tail -f /var/log/legax-relay.log
```

## 安全

- 保护好 `relay.secret`，它用于桌面端或 Agent 侧认证。
- 浏览器设备通过桌面端 `npm run daemon:pair` 配对，然后用手机扫描打印出的二维码，或手动输入一次性配对码。
- 不要把明文 HTTP Relay 直接暴露到公网，除非它位于可信 HTTPS 反向代理或隧道之后。
- 尽量只向可信网络开放 TCP `8787` 端口。
- 如需轮换密钥，编辑 `/etc/legax-relay/config.yaml` 后重启服务。

## 卸载

```bash
sudo ./uninstall.sh
```

同时删除配置和数据：

```bash
sudo ./uninstall.sh --purge
```
