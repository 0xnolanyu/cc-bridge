# Changelog

本项目的所有重要变更都记录在此文件。
All notable changes to this project are documented in this file.
格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本遵循 [SemVer](https://semver.org/lang/zh-CN/)。

## [0.2.4] - 2026-11-21

### Added
- **DSH native tool plugin** (`native/plugin.js`): registers `cc_send` / `cc_who` / `cc_status` as native DSH tools. `cc_send` derives the sender identity from the calling session automatically (`exec.agent.id` → session bridge name via `~/.cc-bridge/sessions/<sessionId>.json`, written by the daemon at startup) — the model never needs to pass `as`. Load with a cordis.patch insert pointing at the plugin file (absolute path locally, package subpath `cc-msg-bridge/native` when published).
- Daemon writes a session→bridge map file at startup and clears it on exit.
- **Bridge names follow session titles** (`tools/dsh/register-all.js`): each scan compares the live bridge name with the session's current title; a renamed session gets its bridge re-spawned under the new name (10-minute cooldown per session). Sessions that never had a title show 「未命名」 instead of borrowing the workspace folder name.
- `tools/dsh/list-daemons.ps1`: ASCII-only daemon inventory (pid + session) for auditing.

### Fixed
- **Supervisor rename-loop massacre**: comparing bridge names via PowerShell stdout mangled Chinese names to `?` under the hidden console's code page (437), making the supervisor kill and re-spawn every Chinese-named bridge each minute. Name comparison now reads the daemon's own UTF-8 session-map file; PowerShell output is used for ASCII (pid/session) only, and a missing name never triggers a kill.
- **Space-in-name truncation**: `Start-Process -ArgumentList` joins arguments without quoting (PS 5.1), truncating bridge names containing spaces at the first space. The bridge name is now passed via the `BRIDGE_NAME` environment variable (never re-parsed on a command line).

### Changed
- Retired the resident MCP bridge on the DSH side: `dsh-bridge` no longer registers as a Claude Code peer (disable the `cc-bridge-mcp` patch row; replies now always route to the calling session's own bridge).

## [0.2.3] - 2026-11-21

### Changed
- daemon 注入模式默认 `steer`（原 `queue`）：DSH 忙时消息在**下一步即插入**当前回合，不再等回合结束；空闲行为不变。可用环境变量 `PUSH_MODE=queue` 回退排队语义。

## [0.2.2] - 2026-11-21

### Added
- `tools/dsh/`：DSH 侧集成——每会话常驻 daemon（CC→DSH 秒级推送注入本地 web API）、`register-all.js --watch` supervisor（全部 DSH 会话自动上桥/死桥补拉/幽灵清理）、`bridge-up.js`、可移植自启链（`bridges-up.cmd`+`invisible.vbs`）、`dsh-titles.js` 会话标题提取。
- 文档：bypass 权限模式收方（CC ≥ 2.1.329）需在 `~/.claude/settings.json` 设 `"crossSessionInbound": "accept"`（README+PROTOCOL）。

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
