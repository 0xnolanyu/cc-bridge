'use strict';
// Peer: bind inbox + register in CC's session registry + heartbeat. One process = one peer.
const registry = require('./registry');
const { Inbox } = require('./inbox');
const sender = require('./sender');

class Peer {
  constructor(opts = {}) {
    this.pipePath = opts.pipePath || process.env.CC_BRIDGE_PIPE || '\\\\.\\pipe\\cc-msg-dsh-bridge';
    this.name = opts.name || process.env.CC_BRIDGE_NAME || 'dsh-bridge';
    this.inboxFile = opts.inboxFile || process.env.CC_BRIDGE_INBOX_FILE ||
      require('path').join(require('os').homedir(), '.cc-bridge', 'inbox.jsonl');
    this.inbox = null;
    this.hbTimer = null;
    this.status = 'idle';
  }

  async start() {
    const reg = registry.registerSelf({ pipePath: this.pipePath, name: this.name });
    this.peerToken = reg.peerToken;
    // Install cleanup immediately after registering, so a later start() failure cannot leak a record.
    const bye = () => this.stop();
    process.once('exit', bye);
    process.once('SIGINT', () => { bye(); process.exit(0); });
    process.once('SIGTERM', () => { bye(); process.exit(0); });
    this.inbox = new Inbox({ pipePath: this.pipePath, peerToken: reg.peerToken, inboxFile: this.inboxFile });
    await this.inbox.start();
    this.hbTimer = setInterval(() => registry.heartbeatSelf(this.pipePath, this.status), 30000);
    return this;
  }

  stop() {
    if (this.hbTimer) clearInterval(this.hbTimer);
    try { this.inbox && this.inbox.stop(); } catch (_) {}
    try { registry.unregisterSelf(this.pipePath); } catch (_) {}
  }

  who() {
    return registry.listPeers([process.pid]).map(r => ({
      name: r.name, sessionId: r.sessionId, status: r.status,
      cwd: r.cwd, version: r.version, pid: r.pid, alive: registry.pidAlive(r.pid),
      inbox: r.messagingSocketPath
    }));
  }

  // to: session name | sessionId | "uds:<pipe>" | bare pipe path
  async send(to, text) {
    const rec = registry.resolveTarget(to);
    if (!rec) throw new Error(`no live peer session matches "${to}" (see who())`);
    if (!registry.pidAlive(rec.pid)) throw new Error(`peer "${to}" (pid ${rec.pid}) is not alive`);
    const token = registry.peerTokenFor(rec); // receiver's key secret — sent as auth line when known
    return sender.sendUserMessage(rec, {
      text, fromPipe: this.pipePath, fromName: this.name, token
    });
  }

  recv(timeoutMs) { return this.inbox.recv(timeoutMs); }
  drain() { return this.inbox.drain(); }
}

module.exports = { Peer };
