#!/usr/bin/env node
/**
 * bridge-up.js — 给任意 DSH 会话拉起专属 CC 桥（方案1：每会话一个 daemon）。
 * 用法: node bridge-up.js --name <peer名> --session <DSH sessionId> [--url <base>]
 * 例:   node bridge-up.js --name dsh-architect --session session-18daa312-...
 * 效果: 分离启动常驻 daemon；CC 侧 SendMessage to <peer名> 即秒级注入该 DSH 会话。
 * 日志: ~/.cc-bridge/daemon-<name>.log
 */
'use strict';
const { spawn } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
function opt(k) { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : null; }
const NAME = opt('name'), SESSION = opt('session'), URL = opt('url') || 'http://127.0.0.1:64119';
if (!NAME || !SESSION) { console.error('usage: node bridge-up.js --name <peer> --session <sessionId> [--url <base>]'); process.exit(2); }

const DAEMON = path.join(__dirname, 'cc-dsh-bridge-daemon.js');
const LOGDIR = path.join(os.homedir(), '.cc-bridge');
fs.mkdirSync(LOGDIR, { recursive: true });
const LOG = path.join(LOGDIR, `daemon-${NAME}.log`);
const out = fs.openSync(LOG, 'a');

const env = Object.assign({}, process.env, {
  BRIDGE_NAME: NAME,
  DSH_SESSION_ID: SESSION,
  DSH_PUSH_URL: URL,
  CC_BRIDGE_INBOX_FILE: path.join(LOGDIR, `inbox-${NAME}.jsonl`),
});
const child = spawn(process.execPath, [DAEMON], { env, detached: true, stdio: ['ignore', out, out], windowsHide: true });
child.unref();
console.log(JSON.stringify({ ok: true, peer: NAME, pipe: '\\\\.\\pipe\\cc-msg-' + NAME, dshSession: SESSION, daemonPid: child.pid, log: LOG }));
process.exit(0); // 退出父进程（detached 子进程继续跑）
