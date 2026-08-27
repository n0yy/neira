; "Open in Neira" shell verbs for folders, folder backgrounds, and drives.
; HKCU matches installer currentUser scope. %V = clicked path.
; NoWorkingDirectory keeps Explorer from overriding %V (System32 on Drive).

!macro NSIS_HOOK_POSTINSTALL
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInNeira" "" "Open in Neira"
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInNeira" "Icon" '"$INSTDIR\neira.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInNeira" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\shell\OpenInNeira\command" "" '"$INSTDIR\neira.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInNeira" "" "Open in Neira"
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInNeira" "Icon" '"$INSTDIR\neira.exe",0'
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInNeira" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Directory\Background\shell\OpenInNeira\command" "" '"$INSTDIR\neira.exe" "%V"'

  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInNeira" "" "Open in Neira"
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInNeira" "Icon" '"$INSTDIR\neira.exe",0'
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInNeira" "NoWorkingDirectory" ""
  WriteRegStr HKCU "Software\Classes\Drive\shell\OpenInNeira\command" "" '"$INSTDIR\neira.exe" "%V"'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  DeleteRegKey HKCU "Software\Classes\Directory\shell\OpenInNeira"
  DeleteRegKey HKCU "Software\Classes\Directory\Background\shell\OpenInNeira"
  DeleteRegKey HKCU "Software\Classes\Drive\shell\OpenInNeira"
!macroend
