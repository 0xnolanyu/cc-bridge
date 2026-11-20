#!/usr/bin/env node
'use strict';
// cc-bridge CLI: who | send | recv | status | mcp
const path = require('path');
const { Peer } = require('../lib/peer');
const registry = require('../lib/registry');

const [, , cmd, ...rest] = process.argv;
const args = {};
for (let i = 0; i < rest.length; i += 2) args[rest[i].replace(/^--/, '')] = rest[i + 1];

function fail(e) { console.error('cc-bridge:', e.message || e); process.exit(1); }

(async () => {
  if (cmd === 'who' || cmd === 'status') {
    const peers = registry.listPeers([process.pid]);
    for (const p of peers) {
      console.log(`${String(p.name).padEnd(20)} ${p.status.padEnd(6)} pid=${p.pid} alive=${registry.pidAlive(p.pid)} v=${p.version} cwd=${p.cwd}`);
    }
    console.log(`-- ${peers.length} live peer session(s) in ${registry.sessionsDir()}`);
    return;
  }

  if (cmd === 'send') {
    if (!args.to || args.text === undefined) { console.error('usage: cc-bridge send --to <name|uds:pipe> --text "..."'); process.exit(2); }
    const peer = new Peer();
    // one-shot send still needs a registered identity for the reply address to be vouched
    await peer.start();
    try {
      const r = await peer.send(args.to, args.text);
      console.log(JSON.stringify({ ok: true, ...r }));
    } finally { peer.stop(); }
    return;
  }

  if (cmd === 'recv') {
    const peer = new Peer();
    await peer.start();
    const t = parseInt(args.timeout || '120000', 10);
    console.log(`waiting up to ${t}ms on ${peer.pipePath} (name=${peer.name}) ...`);
    const msgs = await peer.recv(t);
    for (const m of msgs) console.log(JSON.stringify({ from: m.fromName || m.from, text: m.text, msgId: m.msgId, at: m.at }));
    peer.stop();
    return;
  }

  if (cmd === 'mcp') {
    require('../mcp/server')();
    return;
  }

  console.log('cc-bridge — DSH <-> Claude Code peer bridge\n' +
    'usage:\n' +
    '  cc-bridge who                                   list live Claude Code sessions\n' +
    '  cc-bridge send --to <name|uds:pipe> --text "…"  send a message (peer registers itself briefly)\n' +
    '  cc-bridge recv [--timeout ms]                   register + wait for one message\n' +
    '  cc-bridge mcp                                   run the stdio MCP server (bridge stays resident)');
})().catch(fail);
