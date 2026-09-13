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
    Dim healthOutput
    Set oExec = oShell.Exec("curl -fsS http://127.0.0.1:8000/api/health")
    healthOutput = oExec.StdOut.ReadAll
    If oExec.ExitCode = 0 And InStr(healthOutput, "daily-plan") > 0 Then
        oShell.Run "http://localhost:8000/?desktop=" & Replace(CStr(Timer), ",", "-")
    Else
        MsgBox "Port 8000 is occupied by another program." & vbCrLf & _
               "Daily Plan was not started.", vbExclamation, "Daily Plan"
    End If
    WScript.Quit
End If

' Start uvicorn in a hidden window (style 0 = hidden, False = don't wait)
oShell.Run "cmd /c cd /d """ & backendDir & """ && uvicorn main:app --host 127.0.0.1 --port 8000", 0, False

' Poll until server is ready (max 20 seconds)
Dim i
For i = 1 To 20
    WScript.Sleep 1000
    Set oExec = oShell.Exec("curl -fsS http://127.0.0.1:8000/api/health")
    healthOutput = oExec.StdOut.ReadAll
    If oExec.ExitCode = 0 And InStr(healthOutput, "daily-plan") > 0 Then
        oShell.Run "http://localhost:8000/?desktop=" & Replace(CStr(Timer), ",", "-")
        WScript.Quit
    End If
Next

MsgBox "Server failed to start (20s timeout)." & vbCrLf & _
       "Check backend dir: " & backendDir, vbExclamation, "Daily Plan"
