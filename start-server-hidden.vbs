Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
baseDir = fso.GetParentFolderName(WScript.ScriptFullName)

shell.CurrentDirectory = baseDir
shell.Run Chr(34) & baseDir & "\start-server.bat" & Chr(34), 0, False
