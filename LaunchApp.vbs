Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' 1. 定位資料夾並清理舊程序
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)
WshShell.Run "taskkill /f /im node.exe", 0, True

' 2. 啟動伺服器 (顯示視窗)
WshShell.Run "cmd /c cd /d """ & currentDir & """ && start ""FIM-92 Server"" cmd /k node server.js", 0, True
WScript.Sleep 3000

' 3. 獲取本機 IP
strIP = "127.0.0.1"
Set objWMIService = GetObject("winmgmts:\\.\root\cimv2")
Set colItems = objWMIService.ExecQuery("Select IPAddress from Win32_NetworkAdapterConfiguration Where IPEnabled = True")
For Each objItem In colItems
    If Not IsNull(objItem.IPAddress) Then
        For i = 0 To UBound(objItem.IPAddress)
            If InStr(objItem.IPAddress(i), ".") > 0 And Left(objItem.IPAddress(i), 3) <> "127" Then
                strIP = objItem.IPAddress(i)
                Exit For
            End If
        Next
    End If
Next

' 4. 顯示分享資訊 (ANSI 編碼下中文會正常顯示)
MsgBox "FIM-92 Server Started!" & vbCrLf & vbCrLf & _
       "Share this link to other devices:" & vbCrLf & _
       "http://" & strIP & ":3000", 64, "FIM-92 Control Center"

' 5. 本機開啟 App 模式 (使用偵測到的 IP)
WshShell.Run "chrome --app=http://" & strIP & ":3000", 1, False