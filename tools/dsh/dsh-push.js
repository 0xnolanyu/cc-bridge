#!/usr/bin/env node
/**
 * dsh-push.js — inject a prompt into a running DSH session over its web API.
 *
 * Wire (all verified against @deepseek-ai/dsh-client-connection + dsh-api-gateway sources):
 *   POST http://127.0.0.1:<port>/api/session/prompt
 *   Cookie: dsh-auth-<base64url(sha256(authority))>=v1.<b64url(payload)>.<b64url(hmac)>
 *   Body: {"type":"client-request","rpcId":uuid,"method":"session/prompt",
 *          "payload":{"args":{requestId,sessionId,mode,content,clientTimeZone}}}
 * Secret: ~/.dsh/.credentials.yaml records["client-connection/browser-session"].payload.secret
 */
'use strict';
const { createHash, createHmac } = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

function b64u(buf) {
  return Buffer.from(buf).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}
function b64uDecode(s) {
  const pad = '='.repeat((4 - s.length % 4) % 4);
  return Buffer.from(s.replaceAll('-', '+').replaceAll('_', '/') + pad, 'base64');
}
function uuid() { return require('crypto').randomUUID(); }

function loadSecret() {
  const file = path.join(os.homedir(), '.dsh', '.credentials.yaml');
  const text = fs.readFileSync(file, 'utf8');
  const m = text.match(/client-connection\/browser-session:[\s\S]*?secret:\s*([A-Za-z0-9_-]+)/);
  if (!m) throw new Error('browser-session secret not found in ' + file);
  const buf = b64uDecode(m[1]);
  if (buf.length !== 32) throw new Error('secret has unexpected length ' + buf.length);
  return buf;
}

function mintCookie(secret, authority, ttlMs) {
  const name = 'dsh-auth-' + b64u(createHash('sha256').update(authority).digest());
  const now = Date.now();
  const payload = { version: 1, authority, issuedAt: now, expiresAt: now + ttlMs };
  const body = b64u(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = b64u(createHmac('sha256', secret).update(body).digest());
  return name + '=' + 'v1.' + body + '.' + sig;
}

let discoveredUrl = null, discoveredAt = 0;
/** 动态发现 DSH host web 端口（host 每次重启端口会变）：找 DeepSeek/Harness 进程在 127.0.0.1 上的 LISTEN 端口 */
function discoverUrl() {
  const now = Date.now();
  if (discoveredUrl && now - discoveredAt < 60_000) return discoveredUrl;
  try {
    const { execSync } = require('child_process');
    const task = execSync('tasklist /fi "IMAGENAME eq DeepSeek Harness.exe" /fo csv /nh', { encoding: 'utf8' });
    const pids = new Set();
    for (const line of task.split('\n')) { const m = /^"DeepSeek Harness\.exe","(\d+)"/.exec(line.trim()); if (m) pids.add(m[1]); }
    if (pids.size) {
      const net = execSync('netstat -ano', { encoding: 'utf8' });
      for (const line of net.split('\n')) {
        const m = /^\s*TCP\s+127\.0\.0\.1:(\d+)\s+\S+\s+LISTENING\s+(\d+)\s*$/.exec(line);
        if (m && pids.has(m[2])) { discoveredUrl = 'http://127.0.0.1:' + m[1]; discoveredAt = now; return discoveredUrl; }
      }
    }
  } catch (_) {}
  return discoveredUrl || 'http://127.0.0.1:64119'; // fallback: 老端口
}

async function push({ url, sessionId, text, mode = 'queue', ttlMs = 3600_000 }) {
  const base = new URL(url || process.env.DSH_PUSH_URL || discoverUrl());
  const authority = base.host; // host[:port] — matches requestAudience(host header)
  const cookie = mintCookie(loadSecret(), authority, ttlMs);
  const rpcId = uuid();
  const message = {
    type: 'client-request',
    rpcId,
    method: 'session/prompt',
    payload: {
      args: {
        request: {
          requestId: uuid(),
          sessionId,
          mode,
          content: [{ type: 'text', text }],
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
    },
  };
  const res = await fetch(new URL('api/session/prompt', base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, host: authority },
    body: JSON.stringify(message),
  });
  const raw = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${raw.slice(0, 300)}`);
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error('non-JSON reply: ' + raw.slice(0, 200)); }
  // reply envelope: {type:'client-reply'?, rpcId, result:{ok,...}} — print whole on mismatch
  if (parsed.rpcId !== rpcId) throw new Error('rpcId mismatch: ' + raw.slice(0, 300));
  return parsed.result ?? parsed;
}

module.exports = { push, mintCookie, loadSecret };

if (require.main === module) {
  const [,, cmd, ...rest] = process.argv;
  if (cmd === 'send') {
    const url = process.env.DSH_PUSH_URL || null; // null → push() 动态发现当前端口
    const sessionId = rest[0];
    const text = rest.slice(1).join(' ') || '[dsh-push] ping';
    push({ url, sessionId, text })
      .then(r => { console.log('PUSH OK', JSON.stringify(r)); })
      .catch(e => { console.error('PUSH FAILED:', e.message); process.exit(1); });
  } else {
    console.log('usage: node dsh-push.js send <sessionId> <text...>   (env DSH_PUSH_URL, default http://127.0.0.1:64119)');
  }
}
