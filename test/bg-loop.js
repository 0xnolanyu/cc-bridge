'use strict';
// Full loop against a fresh bg CC receiver (TUI mode): spawn -> wait registry -> send -> await PONG.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { Peer } = require('../lib/peer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.error('[bg2]', ...a);
const CLAUDE = 'claude (PATH)';
const CWD = 'E:/workspaces/dsh/dsh-conf';
const OUT = path.join(__dirname, 'e2e-out');

async function main() {
  const peer = new Peer({ name: 'dsh-bridge-cap', pipePath: '\\\\.\\pipe\\cc-msg-captureB' });
  await peer.start();
  const before = new Set(peer.who().map(p => p.pid));

  const PROMPT = 'A peer session named dsh-bridge-cap will send you a message. When it arrives, immediately use the SendMessage tool to reply to session name dsh-bridge-cap with the exact text PONG:<the message text>. Then wait for further instructions. Do not do anything else before the message arrives.';
  const bg = spawn(CLAUDE, ['--bg', '--dangerously-skip-permissions', PROMPT], { cwd: CWD, stdio: ['ignore', 'pipe', 'pipe'] });
  let bgOut = '';
  bg.stdout.on('data', d => bgOut += d);
  bg.stderr.on('data', d => bgOut += d);
  log('bg spawned pid', bg.pid);
  await sleep(4000);

  let target = null;
  for (let i = 0; i < 45 && !target; i++) {
    target = peer.who().find(p => !before.has(p.pid) && p.pid !== process.pid);
    if (target) break;
    await sleep(2000);
  }
  if (!target) { console.log('RESULT: BG NEVER REGISTERED'); fs.writeFileSync(path.join(OUT, 'bg2-spawn.txt'), bgOut); return; }
  log('target:', target.name, target.sessionId, target.messagingSocketPath, target.status);

  const r = await peer.send(target.name, 'PING:' + Date.now());
  log('sent:', JSON.stringify(r));

  const msgs = await peer.recv(100_000);
  fs.writeFileSync(path.join(OUT, 'bg2-result.json'), JSON.stringify({ target, sent: r, msgs }, null, 2));
  log('inbox count:', msgs.length, msgs.map(m => m.text));
  console.log('RESULT:', msgs.length ? 'PONG RECEIVED: ' + msgs[0].text : 'TIMEOUT NO REPLY');
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
