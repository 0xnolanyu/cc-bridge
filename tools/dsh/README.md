# tools/dsh — DSH 侧集成（可选）

让 [DeepSeek Harness (DSH)](https://github.com/) 的每个会话与 Claude Code 会话**双向秒级互推**。
cc-bridge 本体只解决 CC 侧（注册表 peer + wire 协议）；本目录补齐 DSH 侧的三件事：

1. **dsh-push.js** — DSH 注入原语。读 `~/.dsh/.credentials.yaml` 里的 browser-session secret 铸 HMAC cookie，
   `POST /api/session/prompt` 把任意文本注入指定 DSH 会话（`mode:'queue'|'steer'`）。DSH host 的 web 端口
   每次重启会变，内置 `discoverUrl()` 用 `tasklist`+`netstat` 动态发现（60s 缓存，env `DSH_PUSH_URL` 可覆盖）。
2. **cc-dsh-bridge-daemon.js** — 每会话一个常驻桥：绑 peer 收件箱（`\\.\pipe\cc-msg-<name>`），
   收到 CC 的 peer 消息立即格式化成 `📡 cc·<from> → dsh·<self> · hh:mm｜正文` 并 push 注入该 DSH 会话；
   推送失败进重试队列不丢消息。env：`DSH_SESSION_ID`（必填）、`BRIDGE_NAME`、`DSH_PUSH_URL`（默认动态发现）。
3. **register-all.js --watch** — supervisor 守护：每 30s 扫描全部 DSH 会话
   （`~/.dsh/storages/workspace.json` + `session.v4.jsonl.zstd` 里的 `session/title` 事件取标题），
   自动为新会话上桥（命名 `dsh-<短id5>（<标题24字>）`）、补拉死桥、清理注册表幽灵记录。
   固定名桥用 env `PINNED_SESSIONS="session-xxx=dsh-architect"` 指定。
   单实例锁 `~/.cc-bridge/supervisor.lock`；daemon 经 PowerShell `Start-Process` 孤儿化拉起（脱离 supervisor 活树）。

辅助：**bridge-up.js** 单会话手动拉桥；**dsh-titles.js** 会话标题提取；**bridges-up.cmd + invisible.vbs** 无窗口启动链。

## 开机自启（Windows）

```cmd
reg add HKCU\Software\Microsoft\Windows\CurrentVersion\Run /v cc-bridge-supervisor /t REG_SZ /d "wscript.exe \"C:\path\to\cc-bridge\tools\dsh\invisible.vbs\""
```

> 重要：不要从 DSH/IDE 的终端里启动 supervisor —— 这些宿主重启时会连坐清理整个作业树
> （Windows job object），detached 子进程也逃不掉。用 Run 键/WMI/任务计划等系统级入口拉起。

## 使用

```bash
cd tools/dsh
node bridge-up.js --name dsh-architect --session session-xxxxxxxx          # 单会话
node register-all.js                                                        # 全量上桥（一次性）
node register-all.js --watch                                                # 常驻守护（推荐）
```

CC 侧即可 `SendMessage to "dsh-a8c82（战略研究）"` 或短 id `"dsh-a8c82"`；DSH 侧用 MCP `cc_send` / CLI `cc-bridge send`。

## 前提

- DSH ≥ 内置 web API 的版本（`~/.dsh/.credentials.yaml` 存在即支持）
- bypass 模式的 CC 收方需在 `~/.claude/settings.json` 设 `"crossSessionInbound": "accept"`（见主 README）
