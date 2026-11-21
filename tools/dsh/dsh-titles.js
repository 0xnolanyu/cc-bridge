#!/usr/bin/env node
/**
 * dsh-titles.js — DSH 会话标题与清单（动态，无 API 依赖）
 *   title <sessionId>          → 打印标题（无标题事件时 fallback: 工作区名#id尾4）
 *   list                       → 列出 ~/.dsh/storages/workspace.json 登记的全部会话
 *   sessions                   → 扫盘列出所有 session 目录（含未登记）
 * 事件流: ~/.dsh/sessions/<munged-cwd>/session-<id>/session.v4.jsonl.zstd
 *   标题 = 最后一个 {"type":"session/title","data":{"title":...}} 事件
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const fzstd = require('fzstd'); // dsh-conf/node_modules

const DSH = path.join(os.homedir(), '.dsh');
const SESS = path.join(DSH, 'sessions');

function readTitleFromEventFile(file) {
  try {
    const buf = Buffer.from(fzstd.decompress(fs.readFileSync(file)));
    const lines = buf.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i];
      if (!l || l.indexOf('"session/title"') < 0) continue;
      try {
        const j = JSON.parse(l);
        if (j && j.type === 'session/title' && j.data && typeof j.data.title === 'string' && j.data.title) {
          return { title: j.data.title, source: (j.data.source && j.data.source.kind) || 'unknown' };
        }
      } catch (_) {}
    }
  } catch (_) {}
  return null;
}

function findEventFile(sessionId) {
  for (const ws of fs.readdirSync(SESS)) {
    const p = path.join(SESS, ws, 'session-' + sessionId, 'session.v4.jsonl.zstd');
    if (fs.existsSync(p)) return p;
  }
  // 直接以完整 id 命名兜底（sessionId 可能带 session- 前缀传入）
  for (const ws of fs.readdirSync(SESS)) {
    const p = path.join(SESS, ws, sessionId, 'session.v4.jsonl.zstd');
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function workspaces() {
  const f = path.join(DSH, 'storages', 'workspace.json');
  const raw = JSON.parse(fs.readFileSync(f, 'utf8'));
  return (raw && raw.tables && raw.tables.workspaces) || {}; // { <id>: {path,title,sessionIds,...} }
}

function titleOf(sessionId, wsMap) {
  const id = sessionId.replace(/^session-/, '');
  const ev = findEventFile(id);
  if (ev) {
    const t = readTitleFromEventFile(ev);
    if (t) return t;
  }
  // fallback: 工作区名
  for (const [wsId, w] of Object.entries(wsMap || workspaces())) {
    if ((w.sessionIds || []).some(s => s.replace(/^session-/, '') === id)) {
      return { title: w.title || wsId, source: 'workspace-fallback' };
    }
  }
  return { title: 'untitled-' + id.slice(-4), source: 'none' };
}

function sanitizeName(t) {
  return String(t).replace(/[\r\n\t"'`]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 40) || 'untitled';
}

if (require.main === module) {
  const cmd = process.argv[2];
  const wsMap = workspaces();
  if (cmd === 'title') {
    const t = titleOf(process.argv[3], wsMap);
    console.log(JSON.stringify(t));
  } else if (cmd === 'list') {
    const rows = [];
    for (const [wsId, w] of Object.entries(wsMap)) {
      for (const s of w.sessionIds || []) rows.push({ session: s, workspace: w.title || wsId, wsPath: w.path, ...titleOf(s, wsMap) });
    }
    console.log(JSON.stringify(rows, null, 1));
  } else if (cmd === 'sessions') {
    const out = [];
    for (const ws of fs.readdirSync(SESS)) {
      for (const d of fs.readdirSync(path.join(SESS, ws))) {
        if (d.startsWith('session-')) out.push(d.replace(/^session-/, ''));
      }
    }
    console.log(JSON.stringify(out));
  } else {
    console.log('usage: node dsh-titles.js title <sessionId> | list | sessions');
  }
}

module.exports = { titleOf, sanitizeName, findEventFile, workspaces };
