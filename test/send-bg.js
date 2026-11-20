'use strict';
// Send to a LIVE bg CC session (TUI mode, idle) via the bridge and wait for its PONG.
const { Peer } = require('../lib/peer');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.error('[bg]', ...a);

async function main() {
  const targetName = process.argv[2] || 'dsh-bridge-test ping-pong';
  const pipe = process.argv[3] || '\\\\.\\pipe\\cc-msg-captureB';
  const peer = new Peer({ name: 'dsh-bridge-cap', pipePath: pipe });
  await peer.start();
  const who = peer.who();
  log('peers:', who.map(p => `${p.name}(${p.status})`).join(', '));
  const t = who.find(p => p.name && p.name.startsWith(targetName.slice(0, 20)));
  if (!t) { console.log('RESULT: TARGET NOT FOUND'); return; }
  log('target:', t.name, t.sessionId, t.messagingSocketPath, 'status=', t.status);

  const r = await peer.send(t.name, 'PING:' + Date.now());
  log('sent:', JSON.stringify(r));

  const msgs = await peer.recv(90_000);
  log('inbox:', JSON.stringify(msgs, null, 1));
  console.log('RESULT:', msgs.length ? 'PONG RECEIVED' : 'TIMEOUT NO REPLY');
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
