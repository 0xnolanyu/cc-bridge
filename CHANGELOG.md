# Changelog

本项目的所有重要变更都记录在此文件。
All notable changes to this project are documented in this file.
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.2.1] - 2026-11-21

### Added
- `cc_send` 新增 `as` 参数；CLI `cc-bridge send --as <桥名>`：以另一个已注册 peer 的身份发送（例如某个 DSH 会话的常驻桥）。回信会经该会话的 daemon 自动路由回去。解决"发送方一律显示 dsh-bridge"的身份混淆。
- CLI 带 `--as` 时不再绑自己的收件管道（避免与常驻桥 EADDRINUSE）。

### Fixed
- 注册表版本号由硬编码改为读 package.json。

## [0.2.0] - 2026-11-21

### Changed
- 包名发布为 `cc-msg-bridge`（npm 的 `cc-bridge` 名称已被占用）；CLI 命令仍为 `cc-bridge`。
- 开源化：MIT LICENSE、CHANGELOG、中英双语 README、GitHub 仓库 0xnolanyu/cc-bridge。

## [0.1.1] - 2026-11-20

### Added
- 收件箱落盘：每条收到的消息追加写入 `CC_BRIDGE_INBOX_FILE`（默认 `~/.cc-bridge/inbox.jsonl`），外部程序可 tail。
- 会话注册表健壮性：目标解析改为"活进程优先"，同进程自发自收合法。
- 进程退出钩子：退出时自动清理本 peer 的注册表记录与 key 文件。

### Fixed
- Windows named pipe key 哈希口径：CC 将管道路径转小写后 sha256，取 token 时必须同口径。

## [0.1.0] - 2026-11-20

### Added
- 首个可用版本：`cc_who` / `cc_send` / `cc_recv` / `cc_status` 四个 MCP 工具。
- CLI：`cc-bridge who|send|recv|mcp`。
- wire 协议实现：注册表读写、auth 行、user 帧、`notify_when_idle` 空闲唤醒、回执处理。
- DSH 插件 bundle（`plugin/`）：经 `plugin_manager install_bundle` 一键安装。
- 文档：README（中英双语）、PROTOCOL（完整 wire 协议）。
