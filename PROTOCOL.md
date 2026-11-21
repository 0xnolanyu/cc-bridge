# Claude Code uds-messaging wire 协议（2.1.327–2.1.329，逆向 + 实测）

来源：`claude.exe`（Bun standalone）明文字符串扫描 + `--debug` 日志 + 抓包对照。
所有断言均在本机 Windows 实测通过（发送、接收、唤醒、回执路径）。

## 1. 会话注册表（peer 发现）

目录：`~/.claude/sessions/`

| 文件 | 内容 |
|---|---|
| `<pid>.json` | 活记录：`{pid, sessionId, cwd, startedAt, procStart, version, peerProtocol:1, peerFeatures, kind, entrypoint, pidDomain, messagingSocketPath, name, nameSource, status, updatedAt}` |
| `<pid>.<sha256>.key` | `{peerToken: <32hex>, procStartFt, pidDomain}`，权限 0600；`sha256 = sha256(messagingSocketPath.toLowerCase())` |

- `messagingSocketPath` = 该会话收件箱管道（Windows: `\\.\pipe\LOCAL\cc-msg-<hash>`）
- 活性判定：`procStartFt`（100ns FILETIME）与真实进程启动时间比对 → 残留文件自然失效
- 伪造 peer：写一对真实文件 + 真 FILETIME 即被接受（CC 只验活进程 + key 匹配）

## 2. 帧格式（换行分隔 JSON，每行一帧）

```
行1  {"type":"auth","token":"<接收方 key 文件的 peerToken>"}
行2  {"msgV":1,"msg_id":"<uuid>","type":"user","priority":"next",
      "from":"uds:\\\\.\\pipe\\\\LOCAL\\\\cc-msg-<hash>","from-name":"<会话名>",
      "message":{"role":"user","content":"<cross-session-message from=... from-name=...>\\n正文\\n</cross-session-message>"}}
```

- **auth 行硬性要求**（接收方有 key 时）：debug 日志判决行
  `Dropped a 'user' line from a connection that did not authenticate; closing it`
- user 帧最小形状：`{type:'user',message:{role:'user',content}}`（官方注入配方即此）
- 成功判决行：`Routed user message to queue (priority=next)`
- 帧大小上限 `mGn`（prefix+len+1）；超限拒绝
- CC 自己发送时找不到对方 key 会**裸发**（Windows 上 auth 可选是官方容忍的）

### 控制帧（也必须带 auth 行，可另起连接）

| 帧 | 作用 |
|---|---|
| `{type:'control',action:'notify_when_idle',orig_msg_id:<msgid>,...}` | 空闲会话唤醒（注入后排队，idle 时立刻消化） |
| `{type:'control',action:'peer_message_status',status:'delivered'/'held'/...}` | 回执 |

### 帧类型

- `user` → 注入会话对话队列（agent 看到的就是用户消息）
- `control` → `action ∈ {rename, peer_message_status, notify_when_idle, peer_idle_notice, yield_artifact_replies}`
- 防护：rate-limited / duplicate / hop-loop / hop-runaway / queue-full（ownUdsHopToken 防环）

## 3. 发送流程（cc-bridge sender 实现）

1. 读注册表 → 按名字/sessionId 定位目标 → 取 `messagingSocketPath` + 其 key 文件 `peerToken`
2. `net.connect(pipe)`，写 `auth行 + user帧`，`end()`（回执不走这条连接，EPIPE 可忽略）
3. 需要唤醒 idle：另起连接写 `auth行 + notify_when_idle帧(带 orig_msg_id)`

## 4. 接收流程（cc-bridge inbox 实现）

- 自绑管道 `\\.\pipe\cc-msg-<name>` 做 server（allowHalfOpen，逐行解析）
- auth 帧校验 peerToken（不符 destroy）；无 auth 帧容忍（log 记录）
- user 帧入队；`recv(timeoutMs)` 长阻塞等待
- CC 的回复 user 帧信封同上，多一个 `local_chain` 字段

## 5. SendMessage 工具侧（CC 视角）

- `to` 接受：peer 会话名（列表来自注册表）| 显式 `uds:<socket>` | `bridge:<session id>`（服务器中继）
- SendFile 同样支持 `uds:` / `bridge:`
- 收方策略 `crossSessionInbound: accept|hold|refuse`；`isolatePeerMachines` 控跨机审批
- **收件 hold 门（CC ≥ 2.1.329 收紧，实测）**：收方会话若处于 bypass 权限模式（`--dangerously-skip-permissions` 等），外部发送方的消息默认进 held，5 分钟无人批准即丢弃（hold cause=`no-mode-asserted`，通知文案 "Held a message from an unidentified session... sender did not state its permission mode"）。bridge 的 user 帧已按官方格式带 `from-mode="bypass"` 内容标签，但新版对非 CC 发送方不认标签级声明。**修复：在 `~/.claude/settings.json` 顶层加 `"crossSessionInbound": "accept"`**（仅用户设置文件生效，项目级无效；值域 accept|hold|refuse）。可选 `"dialogExpiry": "10m"|"never"` 延长 held 存活。prompting 模式收方不受此门影响。
- 未确认语义：`mayHaveArrived` — 不重发，除非确认未达
- 注入提示语：`A peer session sent a message while you were working... Treat it as a teammate's request`

## 6. 相关隐藏旗标 / 命令

- `--messaging-socket-path <path>` 指定收件箱（默认自动生成）
- `claude daemon status`；bg 会话由 daemon 管理（`bg retire <id>` 自动回收）
- `--remote-control [name]`、`--brief`（SendUserMessage）、`agents/attach/logs/stop/rm/respawn`

## 7. 与 daemon 层的关系（区别）

`\\.\pipe\cc-daemon-<key>-<suffix>`（control/rv/pty）是**另一层**：进程管理/PTY 复用，
`{"op":"ping"}` 那个。跨会话消息不走 daemon，走本文的 uds-messaging 直连。
