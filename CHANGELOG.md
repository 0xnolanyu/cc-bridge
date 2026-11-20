# Changelog

本项目的所有重要变更都记录在此文件。
All notable changes to this project are documented in this file.
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)。

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
