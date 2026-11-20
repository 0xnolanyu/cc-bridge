'use strict';
// Send a user frame to a peer's inbox pipe.
const net = require('net');
const crypto = require('crypto');
const wire = require('./wire');

function sendFrame(pipePath, token, frameStr, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ path: pipePath }, () => {
      let payload = '';
      if (token) payload += wire.buildAuthLine(token);
      payload += frameStr;
      sock.write(payload);
      sock.end();
    });
    sock.setTimeout(timeoutMs, () => { sock.destroy(); reject(new Error(`timeout connecting/flushing ${pipePath}`)); });
    sock.on('error', (e) => { try { sock.destroy(); } catch (_) {} reject(e); });
    sock.on('close', () => resolve(true));
  });
}

async function sendUserMessage(rec, { text, fromPipe, fromName, token, msgId, notifyIdle = true }) {
  // Observed CC sender behavior (PoC capture):
  //  - one connection: [auth line if key known] + user frame, then end
  //  - wake-up control frame goes on its own connection afterwards
  const frame = wire.buildUserFrame({ fromPipe, fromName, text, msgId });
  const parsed = JSON.parse(frame);
  await sendFrame(rec.messagingSocketPath, token, frame);
  if (notifyIdle) {
    const ntf = wire.buildNotifyIdleFrame({ fromPipe, msgId: crypto.randomUUID(), origMsgId: parsed.msg_id });
    try { await sendFrame(rec.messagingSocketPath, token, ntf); } catch (_) { /* best-effort wake */ }
  }
  return { msgId: parsed.msg_id, to: rec.name || rec.sessionId, notifyIdleSent: notifyIdle };
}

async function sendStatusReceipt(senderPipe, senderToken, { status, origMsgId, fromPipe }) {
  // Best-effort: CC's sender half-closes after writing, so it may not read this socket;
  // real receipts are delivered to the sender's own inbox. Kept for protocol completeness.
  try {
    const frame = wire.buildStatusFrame({ status, origMsgId, fromPipe });
    await sendFrame(senderPipe, senderToken, frame, 2500);
    return true;
  } catch (_) { return false; }
}

module.exports = { sendFrame, sendUserMessage, sendStatusReceipt };
