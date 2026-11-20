# CC Bridge — DSH ↔ Claude Code

Configuration-only DSH bundle: inserts an stdio MCP client that runs `cc-bridge mcp`.
The MCP process itself is the resident peer (binds a Windows named pipe inbox, registers
in `~/.claude/sessions`, heartbeats every 30s).

## Tools exposed

| Tool | Purpose |
|---|---|
| `cc_who` | List live CC peer sessions (name, status, cwd, sessionId) |
| `cc_send(to, text)` | Inject a user message into a CC session; wakes idle sessions |
| `cc_recv(timeout_ms?)` | Long-block until a CC session sends this bridge a message |
| `cc_status` | Bridge health + recent inbox events |

## Prerequisites

1. `npm i -g cc-bridge` (or `npm link` inside the repo) so `cc-bridge` is on PATH.
2. Claude Code ≥ 2.1.327 running somewhere on this machine (VS Code extension or CLI).

## CC-side usage (zero setup)

Tell the Claude Code session once:

> 之后有会话名为 dsh-bridge 的 peer 会给你发消息（跨会话消息）。收到后按内容执行；
> 需要回复 DSH 架构师时，用 SendMessage 工具发给会话名 `dsh-bridge`。

Optionally persist it in the project's `CLAUDE.md`.

## Config knobs (bundle env)

- `CC_BRIDGE_NAME` — peer name registered in CC's registry (default `dsh-bridge`).
- `CC_BRIDGE_PIPE` — inbox pipe path (default `\\.\pipe\cc-msg-<name>`).
