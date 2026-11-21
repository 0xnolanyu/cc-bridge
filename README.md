# cc-msg-bridge (CLI: `cc-bridge`)

**English** ｜ [简体中文](README.zh-CN.md)

Turn any local process (a DSH session, a script, CI) into a **first-class cross-session messaging peer of Claude Code**, by speaking CC's native SendMessage wire protocol directly. Nothing to install on the Claude Code side; no patching, no UI automation, no API key.

```
any local agent ──(MCP / CLI)── cc-bridge ══(named pipe + auth)══ Claude Code sessions
  (DSH, scripts, CI)                          (VS Code / CLI / headless / bg alike)
```

## What it does

| Tool | Description |
|---|---|
| **cc_who** | List every live Claude Code session on this machine (name, status, cwd, sessionId) |
| **cc_send** | Inject a message straight into a CC session's conversation queue; idle sessions are woken automatically. `as` option routes the reply to a specific peer identity |
| **cc_recv** | Long-poll a real inbox — messages CC sessions send back via SendMessage arrive as push, not polling |
| **cc_status** | Bridge health + delivery log |

Zero config on the Claude Code side: CC sessions simply see `dsh-bridge` in their peer list and reply with `SendMessage to="dsh-bridge"`.

## Install

```bash
# 1. CLI
npm i -g cc-msg-bridge

# 2. DSH plugin bundle (plugin/ directory) — inside a DSH session with full access:
#    plugin_manager install_bundle → path/to/cc-bridge/plugin
#    tools appear as mcp__cc-bridge__cc_send etc.
```

## CLI usage (works without DSH)

```bash
cc-bridge who                            # list peers
cc-bridge send eng-agent "run the tests" # inject by name; idle sessions get woken
cc-bridge send loop-eng "status?" --as dsh-a8c82   # send as another peer identity
cc-bridge recv 60                        # wait up to 60s for replies
cc-bridge mcp                            # stdio MCP server (what DSH spawns)
```

## How it works

Reverse-engineered from the Claude Code binary and verified on the wire (full details in [PROTOCOL.md](PROTOCOL.md)):

1. Every CC session publishes a live record at `~/.claude/sessions/<pid>.json` (including its inbox pipe address) and writes a peer auth key to `<pid>.<sha256(lowercased pipe path)>.key`.
2. Sending = connect to the target's inbox pipe, write an auth line `{type:'auth', token:<target key's peerToken>}`, then a user frame (`cross-session-message` envelope), disconnect; idle targets get a `notify_when_idle` control frame to wake them.
3. cc-bridge itself registers as a peer, so CC replies with its own native SendMessage tool — the last hop is the genuine article, nothing forged.

## DSH integration (optional)

[`tools/dsh/`](tools/dsh/) adds push delivery into DeepSeek Harness (DSH) sessions: a per-session resident daemon injects incoming CC messages into the DSH conversation via its local web API within seconds (steer mode by default — mid-turn injection, no queueing), plus a supervisor that auto-bridges every DSH session and keeps the bridges alive. Details in [tools/dsh/README.md](tools/dsh/README.md).

## Environment

| Variable | Default | Description |
|---|---|---|
| `CC_BRIDGE_NAME` | `dsh-bridge` | Name registered in the CC peer list |
| `CC_BRIDGE_PIPE` | `\\.\pipe\cc-msg-<name>` | Inbox pipe |
| `CC_BRIDGE_SESSIONS_DIR` | `~/.claude/sessions` | Registry dir (for tests) |
| `CC_BRIDGE_INBOX_FILE` | `~/.cc-bridge/inbox.jsonl` | Persistent inbox; one JSON line per received message, tail-able by external programs |
| `PUSH_MODE` | `steer` | DSH daemon injection mode: `steer` (mid-turn, immediate) or `queue` (wait for turn end) |

## Compatibility

- Claude Code ≥ 2.1.327 (v2 protocol; verified against 2.1.329)
- Windows (named pipes). macOS/Linux use Unix domain sockets with a different path convention — untested.
- Node ≥ 14, zero dependencies.
- **Bypass-mode receivers (CC ≥ 2.1.329)**: sessions running without permission prompts hold external messages by default ("Held a message from an unidentified session…"). To deliver into them, add `"crossSessionInbound": "accept"` to `~/.claude/settings.json`. Prompting-mode sessions are not affected.

## Risks

The protocol is reverse-engineered, not an official commitment. If a CC upgrade changes fields, cc-bridge fails loudly (it never silently drops messages) — update the package then.

## License

[MIT](LICENSE)
