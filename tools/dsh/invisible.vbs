' invisible.vbs — 无窗口启动 bridges-up.cmd（Run键/开机自启用，不闪console）
CreateObject("WScript.Shell").Run """" & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\bridges-up.cmd""" & "", 0, False
