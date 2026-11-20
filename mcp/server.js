'use strict';
// stdio MCP server exposing the bridge. The server process IS the resident peer:
// it binds the inbox pipe, registers in CC's session registry, and heartbeats while alive.
// Tools:
//   cc_who()                      -> live CC peer sessions
//   cc_send(to, text)             -> inject a user message into a CC session
//   cc_recv(timeout_ms?)          -> long-block until a peer message arrives (push)
//   cc_status()                   -> bridge health + recent inbox events
const readline = require('readline');
const { Peer } = require('../lib/peer');

module.exports = function startMcp() {
  const peer = new Peer();
  const PROTOCOL = '2025-06-18';

  const TOOLS = [
    { name: 'cc_who', description: 'List live Claude Code peer sessions on this machine (name, status, idle/busy, cwd, sessionId).', inputSchema: { type: 'object', properties: {} } },
    { name: 'cc_send', description: 'Send a message to a Claude Code session. The message is injected into its conversation; an idle session is woken. Use a session name from cc_who, a sessionId, or an explicit "uds:\\\\\\\\.\\\\pipe\\\\..." address.', inputSchema: { type: 'object', properties: { to: { type: 'string', description: 'peer session name | sessionId | uds:<pipe path>' }, text: { type: 'string', description: 'message body (plain text, first line should be self-contained)' } }, required: ['to', 'text'] } },
    { name: 'cc_recv', description: 'Block until a Claude Code session sends this bridge a message (push). Returns immediately if messages are already queued. Default timeout 55s returns an empty list.', inputSchema: { type: 'object', properties: { timeout_ms: { type: 'number', description: 'max wait, default 55000, cap 120000' } } } },
    { name: 'cc_status', description: 'Bridge health: registration, pipe, name, recent inbox events.', inputSchema: { type: 'object', properties: {} } }
  ];

  let started = null;
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  const write = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');

  async function ensureStarted() {
    if (!started) {
      started = peer.start().then(() => ({
        pipe: peer.pipePath, name: peer.name,
        sessionsDir: require('../lib/registry').sessionsDir()
      }));
    }
    return started;
  }

  async function callTool(name, args) {
    await ensureStarted();
    if (name === 'cc_who') {
      return JSON.stringify({ peers: peer.who() }, null, 2);
    }
    if (name === 'cc_send') {
      const r = await peer.send(args.to, String(args.text));
      return JSON.stringify({ ok: true, ...r }, null, 2);
    }
    if (name === 'cc_recv') {
      const t = Math.max(0, Math.min(Number(args.timeout_ms) || 55000, 120000));
      const msgs = await peer.recv(t);
      return JSON.stringify({ messages: msgs.map(m => ({ from: m.fromName || m.from, text: m.text, msgId: m.msgId, at: m.at })) }, null, 2);
    }
    if (name === 'cc_status') {
      const info = await started;
      return JSON.stringify({ ...info, registered: true, recentEvents: peer.inbox.log.slice(-20) }, null, 2);
    }
    throw new Error(`unknown tool ${name}`);
  }

  rl.on('line', (line) => {
    if (!line.trim()) return;
    let req;
    try { req = JSON.parse(line); } catch (_) { return; }
    const { id, method, params } = req;
    if (method === 'initialize') {
      write({ jsonrpc: '2.0', id, result: { protocolVersion: params && params.protocolVersion || PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: 'cc-bridge', version: '0.1.0' } } });
    } else if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      /* ignore */
    } else if (method === 'ping') {
      write({ jsonrpc: '2.0', id, result: {} });
    } else if (method === 'tools/list') {
      write({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    } else if (method === 'tools/call') {
      callTool(params.name, params.arguments || {})
        .then((text) => write({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text }] } }))
        .catch((e) => write({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: 'error: ' + (e.message || String(e)) }], isError: true } }));
    } else if (id !== undefined) {
      write({ jsonrpc: '2.0', id, error: { code: -32601, message: `method not found: ${method}` } });
    }
  });

  const bye = () => { try { peer.stop(); } catch (_) {} };
  process.on('SIGINT', () => { bye(); process.exit(0); });
  process.on('SIGTERM', () => { bye(); process.exit(0); });
  process.on('exit', bye);
  // MCP host closed stdin -> shut down cleanly (heartbeat would keep the loop alive)
  rl.on('close', () => { bye(); process.exit(0); });

  // start registering eagerly so CC peers see us before the first tool call
  ensureStarted().catch((e) => process.stderr.write(`cc-bridge startup: ${e.message}\n`));
};
