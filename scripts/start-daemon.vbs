Set shell = CreateObject("WScript.Shell")
shell.CurrentDirectory = CreateObject("Scripting.FileSystemObject").GetFolder(".").Path
shell.Run "powershell.exe -WindowStyle Hidden -Command ""node dist/main.js --daemon""", 0, False
