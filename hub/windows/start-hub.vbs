' Starts the hub with no console window. Placed in the Startup folder by install.ps1.
Set sh = CreateObject("WScript.Shell")
sh.Run """" & CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName) & "\run-hub.bat""", 0, False
