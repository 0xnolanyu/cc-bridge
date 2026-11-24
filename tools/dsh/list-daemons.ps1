# list-daemons.ps1 — 列出所有 cc-dsh-bridge-daemon 进程: pid | session | name
# 注意：桥名已改经 BRIDGE_NAME 环境变量传递（argv 里没有 --name 了），名字权威来源是
#       ~/.cc-bridge/sessions/<sessionId>.json（daemon 自己写的 UTF-8 映射文件）。
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
  Where-Object { $_.CommandLine -match 'cc-dsh-bridge-daemon' } |
  ForEach-Object {
    $sess = if ($_.CommandLine -match '--session\s+(\S+)') { $Matches[1] } else { '' }
    '{0}|{1}' -f $_.ProcessId, $sess
  }
