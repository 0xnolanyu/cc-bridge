#!/usr/bin/env node
/**
 * cc-dsh-bridge-daemon.js — 常驻双向桥：
 *   CC 会话 --SendMessage--> peer "dsh-architect"（本进程收件箱）
 *        --秒级--> HTTP POST /api/session/prompt 注入指定 DSH 会话（dsh-push）
 *   DSH 侧反向发送继续用 mcp cc_send 工具（peer "dsh-bridge"，由 DSH host 拉起）。
 *
 * 环境变量：
 *   DSH_SESSION_ID  必填：注入目标 DSH 会话 id（session-xxxx）
 *   DSH_PUSH_URL    可选：web API 基址，默认 http://127.0.0.1:64119
 *   BRIDGE_NAME     可选：本 peer 名，默认 dsh-architect
 * 日志：~/.cc-bridge/daemon.log（每条转发一行）；收件兼容落盘 ~/.cc-bridge/inbox.jsonl
 */
'use strict';
const os = require('os');
const path = require('path');
const fs = require('fs');
const { Peer } = require('../../lib/peer');
const { push } = require('./dsh-push');

function arg(name, dflt) {
  const i = process.argv.indexOf('--' + name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
}
const SESSION_ID = arg('session', process.env.DSH_SESSION_ID);
const URL_BASE = arg('url', process.env.DSH_PUSH_URL) || null; // null = 每次 push 动态发现端口
const NAME = arg('name', process.env.BRIDGE_NAME) || 'dsh-bridge';
const SELF_TITLE = (NAME.match(/（(.+)）/) || [])[1] || NAME.replace(/^dsh-/, ''); // 桥名 dsh-2bc8c（宏观经济）→ 宏观经济
const LOG = path.join(os.homedir(), '.cc-bridge', `daemon-${NAME}.log`);

function log(line) {
  const t = new Date().toISOString();
  try { fs.appendFileSync(LOG, `[${t}] ${line}\n`); } catch (_) {}
  console.log(`[${t}] ${line}`);
}

async function forward(msg) {
  const from = msg.fromName || msg.from || 'cc-peer';
  const text = (msg.text || '').trim();
  if (!text) return;
  const hhmm = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai' });
  const body = `📡 **cc·${from} → dsh·${SELF_TITLE}** · ${hhmm}｜${text.replace(/\n+/g, ' ')}`;
  const r = await push({ url: URL_BASE || undefined, sessionId: SESSION_ID, text: body, mode: process.env.PUSH_MODE || 'steer' });
  log(`forwarded from=${from} push=${JSON.stringify(r)} len=${text.length}`);
}

// 会话映射表：~/.cc-bridge/sessions/<sessionId>.json → {name,pipe,pid,at}
// 供原生插件 bridgeFor() 反查"这个 DSH 会话用哪个桥名"（pinned 名也能查）。
const SESSION_MAP_DIR = path.join(os.homedir(), '.cc-bridge', 'sessions');
function writeSessionMap() {
  try {
    fs.mkdirSync(SESSION_MAP_DIR, { recursive: true });
    fs.writeFileSync(path.join(SESSION_MAP_DIR, SESSION_ID + '.json'), JSON.stringify({
      name: NAME, pipe: '\\\\.\\pipe\\cc-msg-' + NAME, pid: process.pid, at: Date.now(),
    }));
  } catch (_) {}
}
function clearSessionMap() {
  try { fs.unlinkSync(path.join(SESSION_MAP_DIR, SESSION_ID + '.json')); } catch (_) {}
}

async function main() {
  if (!SESSION_ID) { console.error('DSH_SESSION_ID or --session required'); process.exit(2); }
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  const peer = new Peer({ name: NAME, pipePath: '\\\\.\\pipe\\cc-msg-' + NAME });
  await peer.start();
  writeSessionMap();
  for (const sig of ['SIGINT', 'SIGTERM', 'exit']) {
    try { process.on(sig, () => { clearSessionMap(); if (sig !== 'exit') process.exit(0); }); } catch (_) {}
  }
  log(`daemon up: peer=${NAME} pipe=${peer.pipePath} pid=${process.pid} → auto-discover ${SESSION_ID}`);
  const retryQ = []; // push 失败不丢消息：下轮重试
  for (;;) {
    let msgs = [];
    try { msgs = await peer.recv(60000); } catch (e) { log('recv error: ' + e.message); }
    if (msgs.length) for (const m of msgs) retryQ.push(m);
    for (let i = retryQ.length - 1; i >= 0; i--) {
      const m = retryQ[i];
      try { await forward(m); retryQ.splice(i, 1); }
      catch (e) { log(`push FAILED (will retry): ${e.message.slice(0, 120)} from=${m.fromName || m.from}`); }
    }
  }
}

main().catch(e => { log('fatal: ' + (e.stack || e.message)); process.exit(1); });
