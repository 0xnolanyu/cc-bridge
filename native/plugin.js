// DSH native tool plugin: cc_send / cc_who / cc_status
// Registers native DSH tools so exec.agent.id (SessionId) is available inside
// execute() — the sender identity (`as`) is computed automatically from the
// calling session's bridge name. The model never needs to pass `as`.
//
// Load via cordis.patch.yml insert with an absolute path to this file, or
// publish the package and insert by package subpath 'cc-msg-bridge/native'.
'use strict';

const { Peer } = require('../lib/peer');
const registry = require('../lib/registry');

function shortOf(sessionId) {
  return String(sessionId || '').replace(/^session-/, '').slice(0, 5);
}

// Find this session's resident bridge peer. Order: (1) daemon-written session
// map ~/.cc-bridge/sessions/<sessionId>.json (covers pinned names like
// dsh-architect), (2) registry name-prefix match on the short id.
function bridgeFor(sessionId) {
  const short = shortOf(sessionId);
  if (!short) return null;
  try {
    const mapFile = require('path').join(require('os').homedir(), '.cc-bridge', 'sessions', sessionId + '.json');
    const m = JSON.parse(require('fs').readFileSync(mapFile, 'utf8'));
    const peer = registry.listPeers().find((p) => p.name === m.name);
    if (peer) return peer;
  } catch (_) {}
  const peers = registry.listPeers();
  return peers.find((p) => p.name === 'dsh-' + short)
    || peers.find((p) => p.name && p.name.startsWith('dsh-' + short))
    || null;
}

function renderJson(_args, value) {
  return [{ type: 'text', text: JSON.stringify(value) }];
}

const ccSend = {
  name: 'cc_send',
  description:
    'Send a message to a Claude Code session (peer) on this machine. ' +
    'The reply address (sender identity) is your own session bridge and is set automatically — do not pass `as` unless you explicitly need to impersonate another registered bridge. ' +
    'Use cc_who first to list live peer names. CC sessions answer via the DSH bridge, so replies arrive as injected messages in this conversation.',
  parameters: {
    type: 'object',
    properties: {
      to: { type: 'string', description: 'Peer name (or short id like dsh-a8c82), or an explicit uds:<pipe> address' },
      text: { type: 'string', description: 'Message body' },
      as: { type: 'string', description: 'Optional: send under another registered bridge name' },
    },
    required: ['to', 'text'],
    additionalProperties: false,
  },
  output: { schema: { type: 'object' }, render: renderJson },
  async execute(args, exec) {
    const a = args || {};
    let as = a.as;
    const sessionId = exec && exec.agent ? exec.agent.id : null;
    if (!as) {
      const bridge = sessionId && bridgeFor(sessionId);
      if (!bridge) {
        return {
          ok: false,
          error: 'no resident bridge registered for this session',
          sessionId: sessionId || null,
          hint: 'start it with: node tools/dsh/bridge-up.js --name dsh-' + shortOf(sessionId) + ' --session ' + sessionId,
        };
      }
      as = bridge.name;
    }
    const peer = new Peer();
    try {
      const r = await peer.send(a.to, a.text, { as });
      return { ok: true, as, ...r };
    } catch (e) {
      return { ok: false, as, error: String((e && e.message) || e) };
    }
  },
};

const ccWho = {
  name: 'cc_who',
  description: 'List live Claude Code sessions/peers visible on this machine (name, status, pid, version).',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: {
    schema: { type: 'object' },
    render: (_a, v) => [{ type: 'text', text: (v.peers || []).map((p) => `${p.name}  ${p.status || ''} pid=${p.pid} v=${p.version || ''}`).join('\n') || '(none)' }],
  },
  async execute() {
    const peers = registry.listPeers().map((p) => ({
      name: p.name, status: p.status, pid: p.pid, version: p.version, kind: p.kind,
    }));
    return { count: peers.length, peers };
  },
};

const ccStatus = {
  name: 'cc_status',
  description: 'Show this session\'s bridge status: which resident daemon receives peer replies for this conversation.',
  parameters: { type: 'object', properties: {}, additionalProperties: false },
  output: { schema: { type: 'object' }, render: renderJson },
  async execute(_args, exec) {
    const sessionId = exec && exec.agent ? exec.agent.id : null;
    const bridge = sessionId && bridgeFor(sessionId);
    return { sessionId, bridge: bridge ? { name: bridge.name, pid: bridge.pid, status: bridge.status, version: bridge.version } : null };
  },
};

module.exports = {
  name: 'cc-bridge-tools',
  inject: ['tools'],
  apply(ctx) {
    ctx.tools.register(ccSend);
    ctx.tools.register(ccWho);
    ctx.tools.register(ccStatus);
  },
};
