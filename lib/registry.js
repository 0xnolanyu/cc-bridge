'use strict';
// Claude Code session registry (~/.claude/sessions) read/write helpers.
// Layout (reverse-engineered from claude.exe 2.1.327/2.328, verified on wire):
//   <pid>.json                          live record: {pid,sessionId,cwd,startedAt,procStart,version,
//                                                       peerProtocol,peerFeatures,kind,entrypoint,pidDomain,
//                                                       messagingSocketPath,name,nameSource,status,updatedAt,...}
//   <pid>.<sha256(pipeCanon)>.key       {peerToken,procStartFt,pidDomain}
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

function sessionsDir() {
  return process.env.CC_BRIDGE_SESSIONS_DIR ||
    path.join(process.env.USERPROFILE || os.homedir(), '.claude', 'sessions');
}

function pidDomain() {
  return `win32:${os.hostname().toLowerCase()}`;
}

function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }

function keyFileName(pid, pipePath) { return `${pid}.${sha256hex(pipePath)}.key`; }

function pidAlive(pid) {
  if (!Number.isInteger(pid)) return false;
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

function readRecord(file) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(sessionsDir(), file), 'utf8'));
    if (!raw || typeof raw.pid !== 'number' || typeof raw.messagingSocketPath !== 'string') return null;
    return raw;
  } catch (_) { return null; }
}

// List live peer sessions (excluding excludePids). Torn/truncated records are skipped,
// mirroring CC's rejectTornLiveRecord behavior.
function listPeers(excludePids = []) {
  let entries = [];
  try { entries = fs.readdirSync(sessionsDir()); } catch (_) { return []; }
  const excl = new Set(excludePids);
  const out = [];
  for (const f of entries) {
    if (!/^\d+\.json$/.test(f)) continue;
    const rec = readRecord(f);
    if (!rec || excl.has(rec.pid)) continue;
    out.push(rec);
  }
  return out;
}

// Resolve a target: session name, sessionId, explicit "uds:<pipe>" address, or bare pipe path.
function resolveTarget(spec) {
  const peers = listPeers(); // no self-exclusion: send-to-self by name is legal (tests, loops)
  const addr = spec.startsWith('uds:') ? spec.slice(4) : spec;
  const by = (fn) => peers.filter(fn);
  const aliveFirst = (cands) => cands.find(p => pidAlive(p.pid)) || cands[0] || null;
  const uniq = (arr) => { const seen = new Set(); return arr.filter(p => (p.name && !seen.has(p.name) && seen.add(p.name))); };
  return aliveFirst(by(p => p.name === spec)) ||
         aliveFirst(by(p => p.sessionId === spec)) ||
         aliveFirst(by(p => p.messagingSocketPath === addr)) ||
         // short-id addressing: "dsh-a8c82" → "dsh-a8c82（标题）"; require a unique prefix
         (() => { const m = uniq(by(p => p.name && p.name.startsWith(spec))); return m.length === 1 ? aliveFirst(m) : null; })() ||
         null;
}

// peerToken of a peer: read its key file matching its messagingSocketPath hash.
// CC canonicalizes the pipe path to LOWERCASE before hashing (verified: key filenames
// match sha256(pipePath.toLowerCase())).
function peerTokenFor(rec) {
  const dir = sessionsDir();
  const want = sha256hex(String(rec.messagingSocketPath).toLowerCase());
  let entries = [];
  try { entries = fs.readdirSync(dir); } catch (_) { return undefined; }
  for (const f of entries) {
    const m = /^(\d+)\.([0-9a-f]{64})\.key$/.exec(f);
    if (!m || m[1] !== String(rec.pid) || m[2] !== want) continue;
    try { return JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).peerToken; } catch (_) {}
  }
  return undefined;
}

// Register ourselves as a first-class peer.
function registerSelf({ pipePath, name, sessionId, cwd }) {
  const dir = sessionsDir();
  fs.mkdirSync(dir, { recursive: true });
  const { ownStartFiletime } = require('./filetime');
  const startFt = ownStartFiletime();
  const peerToken = crypto.randomBytes(16).toString('hex');
  const now = Date.now();
  const rec = {
    pid: process.pid,
    sessionId: sessionId || crypto.randomUUID(),
    cwd: cwd || process.cwd(),
    startedAt: now, procStart: startFt,
    version: 'cc-bridge-' + require('../package.json').version, peerProtocol: 1, peerFeatures: ['notify_idle', 'artifact_yield'],
    kind: 'interactive', entrypoint: 'claude-vscode', pidDomain: pidDomain(),
    messagingSocketPath: pipePath, name, nameSource: 'user', nameSince: now,
    updatedAt: now, status: 'idle', statusUpdatedAt: now
  };
  const recFile = path.join(dir, `${process.pid}.json`);
  const keyFile = path.join(dir, keyFileName(process.pid, pipePath));
  fs.writeFileSync(recFile, JSON.stringify(rec));
  fs.writeFileSync(keyFile, JSON.stringify({ peerToken, procStartFt: startFt, pidDomain: pidDomain() }));
  return { recFile, keyFile, peerToken, rec };
}

function heartbeatSelf(pipePath, status) {
  try {
    const recFile = path.join(sessionsDir(), `${process.pid}.json`);
    const rec = JSON.parse(fs.readFileSync(recFile, 'utf8'));
    rec.updatedAt = Date.now(); rec.statusUpdatedAt = Date.now();
    if (status) rec.status = status;
    fs.writeFileSync(recFile, JSON.stringify(rec));
  } catch (_) {}
}

function unregisterSelf(pipePath) {
  const dir = sessionsDir();
  for (const f of [`${process.pid}.json`, keyFileName(process.pid, pipePath)]) {
    try { fs.unlinkSync(path.join(dir, f)); } catch (_) {}
  }
}

module.exports = {
  sessionsDir, pidDomain, sha256hex, keyFileName, pidAlive,
  listPeers, resolveTarget, peerTokenFor,
  registerSelf, heartbeatSelf, unregisterSelf
};
