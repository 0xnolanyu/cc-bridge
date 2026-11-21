# cc-msg-bridge（CLI：`cc-bridge`）

[English](README.md) ｜ **简体中文**

让任意本地进程（DSH 会话、脚本、CI）成为 **Claude Code 的一等跨会话通信 peer**：原生直连 CC 内部 SendMessage 的 wire 协议。CC 侧零安装、零破解、零 UI 自动化、不需要 API key。

```
任意本地 agent ──(MCP / CLI)── cc-bridge ══(命名管道 + 认证)══ Claude Code 会话
（DSH、脚本、CI）                             （VS Code / CLI / headless / bg 一视同仁）
```

## 能做什么

| 工具 | 说明 |
|---|---|
| **cc_who** | 列出本机所有在线 CC 会话（名字、状态、cwd、sessionId） |
| **cc_send** | 把消息直接注入某个 CC 会话的对话队列，空闲会话自动唤醒；`as` 参数可指定回复路由到的 peer 身份 |
| **cc_recv** | 长阻塞收 CC 回信——CC 会话用 SendMessage 回的消息以推送到达，不是轮询 |
| **cc_status** | 桥接健康状态与投递日志 |

CC 侧零配置：会话在 peer 列表里看到 `dsh-bridge`，`SendMessage to="dsh-bridge"` 即可回信。

## 安装

```bash
# 1. CLI
npm i -g cc-msg-bridge

# 2. DSH 插件 bundle（plugin/ 目录）——在有完全权限的 DSH 会话里：
#    plugin_manager install_bundle → path/to/cc-bridge/plugin
#    工具以 mcp__cc-bridge__cc_send 等形式出现
```

## CLI 用法（不依赖 DSH）

```bash
cc-bridge who                             # 列 peer
cc-bridge send eng-agent "任务：跑测试"    # 按名字注入；空闲会话自动唤醒
cc-bridge send loop-eng "状态？" --as dsh-a8c82   # 以其它 peer 身份发送
cc-bridge recv 60                         # 最多等 60s 收消息
cc-bridge mcp                             # stdio MCP server（DSH 拉起的就是它）
```

## 机制

以下全部为对 CC 二进制逆向所得并经线上抓包验证（详见 [PROTOCOL.md](PROTOCOL.md)）：

1. 每个会话在注册表 `~/.claude/sessions/<pid>.json` 发布活记录（含收件箱管道地址），并把 peer 认证 key 按 `pid + sha256(管道路径小写)` 落盘。
2. 发送 = 连对方收件箱管道，写 auth 行 `{type:'auth', token:<对方 key 的 peerToken>}` + user 帧（`cross-session-message` 信封），断开；空闲对方另发 `notify_when_idle` 控制帧唤醒。
3. cc-bridge 自身也注册为 peer，CC 用它自己的 SendMessage 本尊回信——最后一跳零伪造。

## DSH 侧集成（可选）

[`tools/dsh/`](tools/dsh/) 把消息秒级推送进 DeepSeek Harness（DSH）会话：每会话常驻 daemon 经本地 web API 注入（默认 `steer` 模式——忙时下一步即插入，不排队），supervisor 自动给全部 DSH 会话上桥并守护。详见 [tools/dsh/README.md](tools/dsh/README.md)。

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `CC_BRIDGE_NAME` | `dsh-bridge` | 注册到 CC peer 列表的名字 |
| `CC_BRIDGE_PIPE` | `\\.\pipe\cc-msg-<name>` | 收件箱管道 |
| `CC_BRIDGE_SESSIONS_DIR` | `~/.claude/sessions` | 注册表目录（测试用） |
| `CC_BRIDGE_INBOX_FILE` | `~/.cc-bridge/inbox.jsonl` | 收件落盘，每行一条 JSON，外部程序可 tail |
| `PUSH_MODE` | `steer` | DSH daemon 注入模式：`steer`（忙时立即插入）或 `queue`（等回合结束） |

## 兼容性

- Claude Code ≥ 2.1.327（v2 协议；已对 2.1.329 验证）
- Windows（命名管道）。macOS/Linux 走 Unix domain socket、路径规则不同——未测试。
- Node ≥ 14，零依赖。
- **bypass 权限模式的收方（CC ≥ 2.1.329）**：免提示会话默认扣留外部消息（"Held a message from an unidentified session…"）。要投达它们，在 `~/.claude/settings.json` 加 `"crossSessionInbound": "accept"`。prompting 模式会话不受影响。

## 风险

协议为逆向所得，非官方承诺。CC 升级若改字段，cc-bridge 显式报错（绝不静默丢消息），届时更新本包。

## 许可

[MIT](LICENSE)
