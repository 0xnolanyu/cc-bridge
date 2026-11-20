'use strict';
// Exact Windows FILETIME (100ns) of a process start, via PowerShell.
// CC's registry liveness check compares this value byte-for-byte.
const { execSync } = require('child_process');

function filetimeOfPid(pid) {
  try {
    const out = execSync(
      `powershell -NoProfile -Command "(Get-Process -Id ${pid}).StartTime.ToFileTime()"`,
      { encoding: 'utf8', timeout: 15000 }
    ).trim();
    if (/^\d{15,20}$/.test(out)) return out;
  } catch (_) { /* fall through */ }
  return null;
}

function filetimeNow() {
  return ((BigInt(Date.now()) + 11644473600000n) * 10000n).toString();
}

function ownStartFiletime() {
  return filetimeOfPid(process.pid) || filetimeNow();
}

module.exports = { filetimeOfPid, filetimeNow, ownStartFiletime };
