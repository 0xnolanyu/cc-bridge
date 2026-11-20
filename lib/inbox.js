'use strict';
// Named-pipe inbox: accepts CC peer connections, verifies auth, queues user messages,
// and supports long-blocking receive (push semantics for MCP callers).
const net = require('net');
const fs = require('fs');
const path = require('path');
const wire = require('./wire');

class Inbox {
  constructor({ pipePath, peerToken, requireAuth = true, onMessage, inboxFile }) {
    this.pipePath = pipePath;
    this.peerToken = peerToken;
    this.requireAuth = requireAuth;
    this.onMessage = onMessage || null;   // optional sync hook(msg)
    this.inboxFile = inboxFile || null;   // optional durable jsonl mailbox
    this.queue = [];                      // {msgId,from,fromName,text,raw,at}
    this.waiters = [];                    // {resolve, timer}
    this.server = null;
    this.log = [];
  }

  start() {
    return new Promise((resolve, reject) => {
      this.server = net.createServer({ allowHalfOpen: true }, (sock) => this._onConn(sock));
      this.server.once('error', reject);
      this.server.listen(this.pipePath, () => resolve(this.pipePath));
    });
  }

  stop() {
    for (const w of this.waiters) { clearTimeout(w.timer); w.resolve([]); }
    this.waiters = [];
    try { this.server && this.server.close(); } catch (_) {}
  }

  // Every raw newline-delimited line ever received (auth + frames), for capture/diagnosis.
  rawLines() { return this.log.slice(); }

  _onConn(sock) {
    let buf = '';
    let authed = !this.requireAuth;
    sock.on('data', (d) => {
      buf += d.toString('utf8');
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        this.log.push(line);
        if (this.log.length > 500) this.log.splice(0, this.log.length - 500);
        if (!line.trim()) continue;
        const { kind, token, frame } = wire.parseLine(line);
        if (kind === 'auth') {
          authed = token === this.peerToken;
          if (!authed) { this.log.push({ at: Date.now(), ev: 'auth-rejected' }); sock.destroy(); return; }
          continue;
        }
        if (!authed) { this.log.push({ at: Date.now(), ev: 'frame-without-auth (accepted: auth optional)' }); }
        if (kind === 'user') this._enqueue(frame);
        else if (kind === 'control') this._control(frame, sock);
      }
    });
    sock.on('error', () => {});
  }

  _enqueue(frame) {
    const msg = {
      msgId: frame.msg_id,
      from: frame.from,
      fromName: (/<cross-session-message[^>]*from-name="([^"]*)"/.exec(frame.message && frame.message.content) || [])[1] || null,
      text: wire.extractText(frame),
      raw: frame,
      at: Date.now()
    };
    this.queue.push(msg);
    this.log.push({ at: msg.at, ev: 'msg', from: msg.fromName || msg.from });
    if (this.inboxFile) {
      try {
        fs.mkdirSync(path.dirname(this.inboxFile), { recursive: true });
        fs.appendFileSync(this.inboxFile, JSON.stringify({
          at: msg.at, msgId: msg.msgId, from: msg.from, fromName: msg.fromName, text: msg.text
        }) + '\n', 'utf8');
      } catch (_) { /* durability best-effort */ }
    }
    if (this.onMessage) { try { this.onMessage(msg); } catch (_) {} }
    while (this.waiters.length && this.queue.length) {
      this.waiters.shift().resolve([this.queue.shift()]);
    }
  }

  _control(frame, sock) {
    if (frame.action === 'peer_message_status') {
      this.log.push({ at: Date.now(), ev: 'status', status: frame.status, orig: frame.orig_msg_id });
    }
    // Unknown control actions are ignored (CC drops unhandled actions the same way).
  }

  // Long-blocking receive. Resolves as soon as a message arrives, or with [] after timeoutMs.
  recv(timeoutMs) {
    if (this.queue.length) return Promise.resolve([this.queue.shift()]);
    return new Promise((resolve) => {
      const w = { resolve, timer: null };
      w.timer = setTimeout(() => {
        const idx = this.waiters.indexOf(w);
        if (idx >= 0) this.waiters.splice(idx, 1);
        resolve([]);
      }, Math.max(0, Math.min(timeoutMs, 120000)));
      this.waiters.push(w);
    });
  }

  drain() { const out = this.queue; this.queue = []; return out; }
}

module.exports = { Inbox };
