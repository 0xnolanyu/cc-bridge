'use strict';
// Decisive experiment:
// 1. Bridge peer owns \\.\pipe\cc-msg-captureB and registers dsh-bridge-cap.
// 2. Headless CC session A sends 'PING-FROM-A' to uds:\\.\pipe\cc-msg-captureB (ground-truth sender bytes).
// 3. We mirror A's exact byte template back to A's own inbox pipe (us->CC direction).
// 4. A is instructed to print RECEIVED:<text> when the peer message arrives (turn kept open via sleep).
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { Peer } = require('../lib/peer');
const registry = require('../lib/registry');
const sender = require('../lib/sender');
const wire = require('../lib/wire');

const CLAUDE = 'claude (PATH)';
const CWD = 'E:/workspaces/dsh/dsh-conf';
const OUT = path.join(__dirname, 'e2e-out');
fs.mkdirSync(OUT, { recursive: true });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.error('[cap]', ...a);

async function main() {
  const peer = new Peer({ name: 'dsh-bridge-cap', pipePath: '\\\\.\\pipe\\cc-msg-captureB' });
  await peer.start();
  log('bridge up:', peer.pipePath);

  const PROMPT = [
    'Step 1: Use the SendMessage tool to send the exact text PING-FROM-A to this address: uds:\\\\\\\\.\\\\pipe\\\\cc-msg-captureB',
    'Step 2: Then run: sleep 75  (keep working, do not exit)',
    'Step 3: When a peer message from dsh-bridge-cap arrives during or after the sleep, print RECEIVED:<its text> to stdout and you may exit.'
  ].join('\n');
  const { spawn } = require('child_process');
  const t0 = Date.now();
  const a = spawn(CLAUDE, ['-p', '--dangerously-skip-permissions', PROMPT], { cwd: CWD });
  let aOut = '', aErr = '';
  a.stdout.on('data', d => aOut += d);
  a.stderr.on('data', d => aErr += d);
  const aDone = new Promise(res => a.on('exit', (code, sig) => res({ code, sig })));
  log('A spawned, waiting for its PING to hit our pipe...');

  // wait for the captured user frame (A sends early in its turn)
  let raw = [];
  for (let i = 0; i < 90; i++) {
    await sleep(2000);
    raw = peer.inbox.rawLines().filter(l => typeof l === 'string');
    if (raw.some(l => l.includes('"type":"user"'))) break;
  }
  log('captured lines:', raw.length, 'after', ((Date.now() - t0) / 1000).toFixed(0) + 's');
  fs.writeFileSync(path.join(OUT, 'cap-a-stderr.txt'), aErr || '');
  fs.writeFileSync(path.join(OUT, 'cap-captured.json'), JSON.stringify(raw, null, 2));

  const parsed = raw.map(wire.parseLine).filter(Boolean);
  const userFrame = (parsed.find(f => f.kind === 'user') || {}).frame;
  if (!userFrame) { console.log('RESULT: NO USER FRAME CAPTURED'); console.log('A stdout tail:', (aOut || '').slice(-400)); return; }
  log('A from-address:', userFrame.from);

  // resolve A's registry record from its from address
  const fromPipe = userFrame.from.replace(/^uds:/, '');
  const rec = registry.resolveTarget(fromPipe);
  if (!rec) { console.log('RESULT: A NOT IN REGISTRY:', fromPipe); return; }
  log('A record:', rec.name, rec.sessionId, rec.messagingSocketPath);

  // mirror A's own user-frame template back (swap from/content/msg_id only)
  const tmpl = raw.find(l => typeof l === 'string' && l.includes('"type":"user"'));
  const mine = JSON.parse(tmpl);
  mine.msg_id = require('crypto').randomUUID();
  mine.message = { role: 'user', content: '<cross-session-message from="' + wire.udsAddr(peer.pipePath) + '" from-name="dsh-bridge-cap" from-mode="bypass">\nPING-FROM-A\n</cross-session-message>' };
  mine.from = wire.udsAddr(peer.pipePath);
  const token = registry.peerTokenFor(rec);
  log('A token found:', !!token, '(unused: Windows sends unauthenticated)');
  const payload = JSON.stringify(mine) + '\n';
  fs.writeFileSync(path.join(OUT, 'cap-mirror-frame.txt'), payload);
  // notify_when_idle mirror if A sent one
  const ntf = raw.find(l => typeof l === 'string' && l.includes('notify_when_idle'));
  if (ntf) {
    const n = JSON.parse(ntf); n.msg_id = require('crypto').randomUUID(); n.orig_msg_id = mine.msg_id; n.from = wire.udsAddr(peer.pipePath);
    payload += JSON.stringify(n) + '\n';
    log('mirroring notify_when_idle too');
  }
  await sender.sendFrame(rec.messagingSocketPath, null, payload);
  log('mirror sent, waiting for A to exit (prints RECEIVED on arrival)...');
  const res = await Promise.race([aDone, sleep(120000).then(() => ({ code: 'timeout' }))]);
  fs.writeFileSync(path.join(OUT, 'cap-a-stdout.txt'), aOut || '');
  log('A exit:', JSON.stringify(res), 'after', ((Date.now() - t0) / 1000).toFixed(0) + 's');

  const out = aOut || '';
  console.log('RESULT:', /RECEIVED:/.test(out) ? 'ROUNDTRIP OK' : 'NO RECEIVED IN A STDOUT');
  console.log('A stdout tail:', out.slice(-600));
}

main().then(() => process.exit(0)).catch(e => { console.error('FATAL', e); process.exit(1); });
