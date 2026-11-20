'use strict';
// Wire format for Claude Code uds-messaging (captured from claude.exe 2.1.328, probe 2026-11-20).
//
// connect -> write line1: {"type":"auth","token":"<RECEIVER's peerToken>"}\n
//         -> write line2: user frame\n
// user frame:
// {"msgV":1,"msg_id":"<uuid>","type":"user","priority":"next",
//  "message":{"role":"user","content":"<cross-session-message from=\"uds:<our pipe>\"
//    from-name=\"<our name>\" from-mode=\"bypass\">\n<text>\n</cross-session-message>"},
//  "from":"uds:<our pipe>"}
// status frame (sent back to the SENDER's inbox over a new connection):
// {"type":"control","action":"peer_message_status","status":"delivered","orig_msg_id":"<id>","from":"<our pipe>"}
const crypto = require('crypto');

function udsAddr(pipePath) { return 'uds:' + pipePath; }

function buildAuthLine(token) {
  return JSON.stringify({ type: 'auth', token }) + '\n';
}

function buildUserFrame({ fromPipe, fromName, text, msgId }) {
  const content =
    `<cross-session-message from="${udsAddr(fromPipe)}" from-name="${fromName}" from-mode="bypass">\n` +
    text.replace(/\r?\n$/, '') + '\n' +
    `</cross-session-message>`;
  return JSON.stringify({
    msgV: 1,
    msg_id: msgId || crypto.randomUUID(),
    type: 'user',
    message: { role: 'user', content },
    priority: 'next',
    from: udsAddr(fromPipe)
  }) + '\n';
}

function buildStatusFrame({ status, origMsgId, fromPipe }) {
  return JSON.stringify({
    type: 'control', action: 'peer_message_status',
    status, orig_msg_id: origMsgId, from: fromPipe
  }) + '\n';
}

// Wake-up subscription for an idle target, tied to the user frame it follows.
function buildNotifyIdleFrame({ fromPipe, msgId, origMsgId }) {
  return JSON.stringify({
    type: 'control', action: 'notify_when_idle', msgV: 1,
    msg_id: msgId, orig_msg_id: origMsgId, from: udsAddr(fromPipe)
  }) + '\n';
}

// Parse one newline-terminated line into {kind:'auth'|'user'|'control'|'unknown', frame}
function parseLine(line) {
  let f;
  try { f = JSON.parse(line); } catch (_) { return { kind: 'unknown' }; }
  if (f && f.type === 'auth') return { kind: 'auth', token: f.token };
  if (f && f.type === 'user') return { kind: 'user', frame: f };
  if (f && f.type === 'control') return { kind: 'control', frame: f };
  return { kind: 'unknown', frame: f };
}

// Extract the plain text body from a user frame's <cross-session-message> envelope.
function extractText(userFrame) {
  const c = userFrame && userFrame.message && userFrame.message.content;
  if (typeof c !== 'string') return null;
  const m = /<cross-session-message[^>]*>\n?([\s\S]*?)\n<\/cross-session-message>/.exec(c);
  return m ? m[1] : c;
}

module.exports = { udsAddr, buildAuthLine, buildUserFrame, buildStatusFrame, buildNotifyIdleFrame, parseLine, extractText };
