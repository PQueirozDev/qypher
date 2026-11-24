; Hooks do instalador NSIS do Qypher.
; Ao desinstalar (não em atualizações, que chamam o desinstalador com /UPDATE),
; remove o registro do host de Native Messaging da extensão de navegador, que o
; app grava apenas para o usuário atual quando a integração é ativada.

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    DeleteRegKey HKCU "Software\Google\Chrome\NativeMessagingHosts\org.qypher.native"
    DeleteRegKey HKCU "Software\Microsoft\Edge\NativeMessagingHosts\org.qypher.native"
    DeleteRegKey HKCU "Software\BraveSoftware\Brave-Browser\NativeMessagingHosts\org.qypher.native"
    DeleteRegKey HKCU "Software\Chromium\NativeMessagingHosts\org.qypher.native"
    DeleteRegKey HKCU "Software\Mozilla\NativeMessagingHosts\org.qypher.native"
    RMDir /r "$LOCALAPPDATA\Qypher\native-host"
  ${EndIf}
!macroend
