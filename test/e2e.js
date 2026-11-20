'use strict';
// E2E: bridge <-> real Claude Code (bg session) roundtrip.
// 1) register bridge as "dsh-bridge-test"
// 2) spawn `claude --bg` scratch session instructed to reply to peer messages
// 3) bridge sends PING via the captured wire protocol
// 4) expect the bg session to SendMessage back PONG (name resolution both ways)
// 5) verify injection via `claude logs`
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { Peer } = require('../lib/peer');
const registry = require('../lib/registry');

const CLAUDE = 'claude (PATH)';
const NAME = 'dsh-bridge-test';
const PIPE = '\\\\.\\pipe\\cc-msg-dsh-bridge-test';
const OUT = path.join(__dirname, 'e2e-out');
fs.mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log('[e2e]', ...a);

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function main() {
  const peer = new Peer({ name: NAME, pipePath: PIPE });
  await peer.start();
  log('bridge registered:', NAME, PIPE);

  const who = peer.who();
  log('peers visible:', who.map(p => `${p.name}(${p.status})`).join(', ') || '(none)');

  // snapshot peers, then spawn bg CC session from a TRUSTED cwd
  const before = new Set(peer.who().map(p => p.pid));
  const cwd = 'E:/workspaces/dsh/dsh-conf';
  const PROMPT = 'Soon you will receive a peer message from a session named dsh-bridge-test. ' +
    'When it arrives, immediately use the SendMessage tool to reply to session name dsh-bridge-test ' +
    'with the exact text: PONG:<the message you received>. Do nothing else and use no other tools.';
  const bg = spawnSync(CLAUDE, ['--bg', '--dangerously-skip-permissions', PROMPT], { encoding: 'utf8', cwd, timeout: 120000 });
  fs.writeFileSync(path.join(OUT, 'bg-spawn.txt'), bg.stdout + '\n---STDERR---\n' + bg.stderr);
  const bgId = (bg.stdout.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [])[0];
  log('bg session id:', bgId, '(exit', bg.status + ')');

  // wait for its registry record: by sessionId, else by snapshot diff
  let target = null;
  for (let i = 0; i < 60 && !target; i++) {
    await sleep(2000);
    const peers = registry.listPeers([process.pid]);
    target = (bgId && peers.find(p => p.sessionId === bgId)) ||
             peers.find(p => !before.has(p.pid));
  }
  if (!target) throw new Error('bg session never registered an inbox');
  log('target found:', target.name, target.sessionId, target.messagingSocketPath);

  // send PING
  const stamp = Date.now();
  const sent = await peer.send(target.name, `PING:${stamp}`);
  log('sent:', JSON.stringify(sent));

  // wait for PONG
  const msgs = await peer.recv(120000);
  log('received:', JSON.stringify(msgs.map(m => ({ from: m.fromName || m.from, text: m.text }))));
  const ok = msgs.some(m => (m.text || '').includes(`PONG:PING:${stamp}`));

  // evidence from logs
  let logsTail = '';
  if (bgId) {
    const logs = spawnSync(CLAUDE, ['logs', bgId], { encoding: 'utf8', timeout: 60000 });
    logsTail = (logs.stdout || '').slice(-4000);
    fs.writeFileSync(path.join(OUT, 'bg-logs-tail.txt'), logs.stdout || logs.stderr);
  }
  log('logs contain PING:', logsTail.includes(`PING:${stamp}`), '| logs contain PONG:', logsTail.includes(`PONG:PING:${stamp}`));

  console.log('\nRESULT:', ok ? 'ROUNDTRIP OK' : 'ROUNDTRIP FAILED');
  // cleanup
  if (bgId) { spawnSync(CLAUDE, ['stop', bgId], { timeout: 30000 }); spawnSync(CLAUDE, ['rm', bgId], { timeout: 30000 }); }
  peer.stop();
  process.exit(ok ? 0 : 1);
}

main().catch(e => { console.error('[e2e] FATAL', e); process.exit(1); });
