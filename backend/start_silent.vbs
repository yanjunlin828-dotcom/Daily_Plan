Set oFSO   = CreateObject("Scripting.FileSystemObject")
Set oShell = CreateObject("WScript.Shell")

' Resolve backend directory relative to this script's own location
Dim backendDir
backendDir = oFSO.GetParentFolderName(WScript.ScriptFullName)

' Check if port 8000 is already in use
Dim oExec
Set oExec = oShell.Exec("cmd /c netstat -ano | findstr "":8000 "" | findstr ""LISTENING""")
oExec.StdOut.ReadAll
If oExec.ExitCode = 0 Then
    oShell.Run "http://localhost:8000"
    WScript.Quit
End If

' Start uvicorn in a hidden window (style 0 = hidden, False = don't wait)
oShell.Run "cmd /c cd /d """ & backendDir & """ && uvicorn main:app --host 0.0.0.0 --port 8000", 0, False

' Poll until server is ready (max 20 seconds)
Dim i
For i = 1 To 20
    WScript.Sleep 1000
    Set oExec = oShell.Exec("curl -s http://localhost:8000/api/data")
    oExec.StdOut.ReadAll
    If oExec.ExitCode = 0 Then
        oShell.Run "http://localhost:8000"
        WScript.Quit
    End If
Next

MsgBox "Server failed to start (20s timeout)." & vbCrLf & _
       "Check backend dir: " & backendDir, vbExclamation, "Daily Plan"
