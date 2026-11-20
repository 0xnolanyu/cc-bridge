# cc-msg-bridge (CLI: `cc-bridge`)

**EN** — Turn any local process (a DSH session, a script, CI) into a **first-class cross-session messaging peer of Claude Code**, by speaking CC's native SendMessage wire protocol directly. Nothing to install on the Claude Code side; no patching, no UI automation, no API key.

**中文** — 让任意本地进程（DSH 会话、脚本、CI）成为 **Claude Code 的一等跨会话通信 peer**：原生直连 CC 内部 SendMessage 的 wire 协议。CC 侧零安装、零破解、零 UI 自动化、不需要 API key。

```
any local agent ──(MCP / CLI)── cc-bridge ══(named pipe + auth)══ Claude Code sessions
  (DSH, scripts, CI)                        （VS Code / CLI / headless / bg 一视同仁）
```

## What it does / 它能做什么

| Tool | Description |
|---|---|
| **cc_who** | List every live Claude Code session on this machine (name, status, cwd, sessionId) / 列出本机所有在线 CC 会话 |
| **cc_send** | Inject a message straight into a CC session's conversation queue; idle sessions are woken automatically / 把消息直接注入某个 CC 会话，空闲会话自动唤醒 |
| **cc_recv** | Long-poll a real inbox — messages CC sessions send back via SendMessage arrive as push, not polling / 长阻塞收 CC 回信（真·推送） |
| **cc_status** | Bridge health + delivery log / 桥接健康状态与投递日志 |

Zero config on the Claude Code side: CC sessions simply see `dsh-bridge` in their peer list and reply with `SendMessage to="dsh-bridge"`.
CC 侧零配置：会话在 peer 列表里看到 `dsh-bridge`，`SendMessage to="dsh-bridge"` 即可回信。

## Install / 安装

```bash
# 1. CLI (this repo)
npm i -g cc-msg-bridge       # published package / 已发布包名

# 2. DSH plugin bundle (plugin/ directory) — inside a DSH session with full access:
#    plugin_manager install_bundle → path/to/cc-bridge/plugin
#    tools appear as mcp__cc-bridge__cc_send etc.
```

## CLI usage (works without DSH) / CLI 用法

```bash
cc-bridge who                            # list peers / 列 peer
cc-bridge send eng-agent "任务：跑测试"   # inject by name / 按名字注入
cc-bridge send loop-eng "状态？"          # idle sessions get woken / 空闲会话唤醒
cc-bridge recv 60                        # wait up to 60s for replies / 等 60s 收消息
cc-bridge mcp                            # stdio MCP server (what DSH spawns) / DSH 用这个
```

## How it works / 机制

Reverse-engineered from the Claude Code binary and verified on the wire (full details in [PROTOCOL.md](PROTOCOL.md)):
以下全部为对 CC 二进制逆向所得并经线上抓包验证（详见 [PROTOCOL.md](PROTOCOL.md)）：

1. Every CC session publishes a live record at `~/.claude/sessions/<pid>.json` (including its inbox pipe address) and writes a peer auth key to `<pid>.<sha256(lowercased pipe path)>.key` / 每个会话在注册表发布活记录与收件箱管道地址，并把 peer 认证 key 按"pid+管道哈希"落盘。
2. Sending = connect to the target's inbox pipe, write an auth line `{type:'auth', token:<target key's peerToken>}`, then a user frame (`cross-session-message` envelope), disconnect; idle targets get a `notify_when_idle` control frame to wake them / 发送=连对方收件箱管道，auth 行+user 帧；空闲对方另发 notify_when_idle 唤醒。
3. cc-bridge itself registers as a peer, so CC replies with its own native SendMessage tool — the last hop is the genuine article, nothing forged / cc-bridge 自身也注册为 peer，CC 用它自己的 SendMessage 本尊回信，最后一跳零伪造。

## Environment / 环境变量

| Variable | Default | Description |
|---|---|---|
| `CC_BRIDGE_NAME` | `dsh-bridge` | Name registered in the CC peer list / 注册到 CC peer 列表的名字 |
| `CC_BRIDGE_PIPE` | `\\.\pipe\cc-msg-<name>` | Inbox pipe / 收件箱管道 |
| `CC_BRIDGE_SESSIONS_DIR` | `~/.claude/sessions` | Registry dir (for tests) / 注册表目录（测试用） |
| `CC_BRIDGE_INBOX_FILE` | `~/.cc-bridge/inbox.jsonl` | Persistent inbox; one JSON line per received message, tail-able by external programs / 收件落盘，外部程序可 tail |

## Compatibility / 兼容性

- Claude Code ≥ 2.1.327 (v2 protocol; verified against 2.1.329)
- Windows (named pipes). macOS/Linux use Unix domain sockets with a different path convention — untested.
- Node ≥ 14, zero dependencies.

## Risks / 风险

The protocol is reverse-engineered, not an official commitment. If a CC upgrade changes fields, cc-bridge fails loudly (it never silently drops messages) — update the package then.
协议为逆向所得，非官方承诺。CC 升级若改字段，cc-bridge 显式报错（绝不静默丢消息），届时更新本包。

## License

[MIT](LICENSE)
