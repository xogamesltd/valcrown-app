!macro customInstall
  DetailPrint "Checking WebView2 Runtime..."
  ReadRegStr $0 HKLM "SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" "pv"
  StrCmp $0 "" 0 webview2_done
  DetailPrint "Installing WebView2 Runtime..."
  inetc::get "https://go.microsoft.com/fwlink/p/?LinkId=2124703" "$TEMP\WebView2Setup.exe"
  ExecWait '"$TEMP\WebView2Setup.exe" /silent /install'
  webview2_done:
  DetailPrint "Setup complete!"
!macroend

!macro customUnInstall
  ExecWait '"taskkill" /F /IM ValCrown.exe /T'
  Sleep 1000
!macroend
