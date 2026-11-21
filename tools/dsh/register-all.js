#!/usr/bin/env node
/**
 * register-all.js — 全量 DSH 会话动态注册桥（幂等；--watch=守护模式）
 *   node register-all.js [--dry] [--only <sessionId>] [--watch]
 * 规则:
 *   - 来源 ~/.dsh/storages/workspace.json tables.workspaces 的 sessionIds
 *   - peer 名 = 'dsh-<短id5>（<标题>）'（session/title 事件，fallback 工作区名），重名追加 id 尾4
 *   - 已在跑的桥（进程命令行含 --session <id>）跳过
 *   - spawn 分离 daemon；本脚本必须经 WMI/计划任务/Run键 之类【脱离 DSH 作业树】的途径启动
 *     （从 DSH bash 里直接跑，daemon 会进 job object，host 重启时被连坐——这就是昨晚断桥根因）
 *   - --watch: 每 30s 扫描——新会话自动上桥、死桥自动补拉、死 daemon 注册表幽灵清理
 */
'use strict';
const { spawn, execSync } = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { titleOf, sanitizeName } = require('./dsh-titles');

const HERE = __dirname;
const NODE = process.execPath;
const SESSIONS_DIR = path.join(os.homedir(), '.claude', 'sessions');
const LOG = path.join(os.homedir(), '.cc-bridge', 'supervisor.log');

function log(line) {
  try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`); } catch (_) {}
  console.log(line);
}

function runningBridges() {
  const out = execSync(
    `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | ForEach-Object { $_.CommandLine }"`,
    { encoding: 'utf8' }
  );
  const ids = new Set();
  for (const line of out.split('\n')) {
    const m = /--session\s+(\S+)/.exec(line || '');
    if (m) ids.add(m[1]);
  }
  return ids;
}

function pidAlive(pid) {
  try { process.kill(Number(pid), 0); return true; } catch (_) { return false; }
}

// 清理死 daemon 的注册表幽灵（只动 name 以 dsh- 开头的记录，不碰 CC 自己的会话）
function cleanGhosts() {
  let removed = 0;
  let entries = [];
  try { entries = fs.readdirSync(SESSIONS_DIR); } catch (_) { return 0; }
  const byPid = new Map();
  for (const f of entries) {
    const m = /^(\d+)\.(json|[0-9a-f]{64}\.key)$/.exec(f);
    if (m) { if (!byPid.has(m[1])) byPid.set(m[1], []); byPid.get(m[1]).push(f); }
  }
  for (const [pid, files] of byPid) {
    if (pidAlive(pid)) continue;
    const json = files.find(f => f.endsWith('.json'));
    let ours = false;
    if (json) {
      try { const rec = JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, json), 'utf8')); ours = typeof rec.name === 'string' && rec.name.startsWith('dsh-'); }
      catch (_) { ours = false; }
    }
    if (!ours) continue;
    for (const f of files) { try { fs.rmSync(path.join(SESSIONS_DIR, f)); removed++; } catch (_) {} }
  }
  if (removed) log(`ghost cleanup: removed ${removed} registry files`);
  return removed;
}

function scan({ dry = false, only = null } = {}) {
  let rows, running;
  try {
    rows = require('./dsh-titles').workspaces();
    running = runningBridges();
  } catch (e) {
    log(`scan aborted (transient): ${String(e && e.message || e).slice(0, 160)}`);
    return { spawned: 0, skipped: 0 };
  }
  // 固定地址桥（可选）：env PINNED_SESSIONS="session-xxxx=dsh-architect,session-yyyy=dsh-lead"
  // 固定名便于对端记忆/回信；未列出的会话用 dsh-<短id>（<标题>） 命名
  const PINNED = new Map(
    (process.env.PINNED_SESSIONS || '')
      .split(',').map(x => x.trim()).filter(Boolean)
      .map(x => { const i = x.indexOf('='); return i > 0 ? [x.slice(0, i), x.slice(i + 1)] : null; })
      .filter(Boolean)
  );
  const used = new Set();

  let spawned = 0, skipped = 0;
  const plan = [];
  for (const [wsId, w] of Object.entries(rows)) {
    for (const s of w.sessionIds || []) {
      if (/^import-/.test(s)) continue; // import 进来的会话不上桥（外部档案，非活会话）
      if (only && s !== only && s !== 'session-' + only) continue;
      let name;
      if (PINNED.has(s)) name = PINNED.get(s);
      else {
        const t = titleOf(s, rows);
        const short = s.replace(/^session-/, '').slice(0, 5);
        const cleanTitle = sanitizeName(t.title).replace(/[（）()]/g, '[]').slice(0, 24);
        name = `dsh-${short}（${cleanTitle}）`;
      }
      if (used.has(name)) name += '-' + s.slice(-4);
      used.add(name);
      if (running.has(s)) { skipped++; if (!WATCH) plan.push(['SKIP', name, s]); continue; }
      if (dry) { plan.push(['DRY ', name, s]); continue; }
      // 经 powershell Start-Process 间接拉起：中间进程立即退出，daemon 成为孤儿，
      // 不再是 supervisor 的活子孙——supervisor 被整树击杀时波及不到 daemon。
      // 参数走 PS 单引号字面量数组（名字含空格/中文/括号都安全）
      const q = (v) => "'" + String(v).replace(/'/g, "''") + "'";
      const argList = [path.join(HERE, 'cc-dsh-bridge-daemon.js'), '--session', s, '--name', name].map(q).join(',');
      try {
        execSync(
          'powershell -NoProfile -Command "$env:BRIDGE_NAME=' + q(name) + '; $env:DSH_SESSION_ID=' + q(s) + '; Start-Process -WindowStyle Hidden -FilePath ' + q(NODE) + ' -ArgumentList @(' + argList + ')"',
          { timeout: 15000 }
        );
      } catch (e) {
        log('spawn FAILED ' + name + ': ' + String(e && e.message || e).slice(0, 120));
        continue;
      }
      spawned++;
      plan.push(['NEW ', name, s]);
    }
  }
  if (spawned || !WATCH) {
    for (const [tag, name, s] of plan) log(`${tag} ${name.padEnd(36)} ${s}`);
    log(`--- spawned=${spawned} skippedRunning=${skipped}${WATCH ? ' [watch]' : ''}`);
  }
  cleanGhosts();
  return { spawned, skipped };
}

const WATCH = process.argv.includes('--watch');
if (WATCH) {
  // 单实例锁：多入口（Run键/WMI/手工）同时拉起时只留一个
  const lockFile = path.join(os.homedir(), '.cc-bridge', 'supervisor.lock');
  try {
    const old = parseInt(fs.readFileSync(lockFile, 'utf8').trim(), 10);
    if (Number.isFinite(old) && pidAlive(old)) {
      const out = execSync(`powershell -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${old}').CommandLine"`, { encoding: 'utf8' }).trim();
      if (out.includes('register-all')) { console.log('supervisor already running pid=' + old + ', exit'); process.exit(0); }
    }
  } catch (_) {}
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, String(process.pid));
  log(`supervisor up: pid=${process.pid} interval=30s`);
  process.on('uncaughtException', (e) => log(`uncaught(kept alive): ${String(e && e.stack || e).slice(0, 300)}`));
  let ticks = 0;
  const tick = () => { try { scan(); } catch (e) { log(`tick error(kept alive): ${String(e && e.message || e).slice(0, 160)}`); } if (++ticks % 20 === 0) log(`heartbeat: ${new Date().toISOString()} daemons=${runningBridges().size}`); };
  tick();
  setInterval(tick, 30_000);
} else {
  scan({ dry: process.argv.includes('--dry'), only: (() => { const i = process.argv.indexOf('--only'); return i > 0 ? process.argv[i + 1] : null; })() });
}
