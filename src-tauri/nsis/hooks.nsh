; SoraFlux: wpis „Konwertuj w SoraFlux” w menu kontekstowym Eksploratora.
; Instalator dopisuje go dla bieżącego użytkownika (HKCU, bez uprawnień administratora),
; deinstalator usuwa. Klucz w SystemFileAssociations\video|audio|image obejmuje wszystkie
; pliki wideo, audio i obrazy (Windows sam zna ich typy), bez przejmowania skojarzeń.
; Kilka zaznaczonych plików = kilka uruchomień; single-instance przekazuje je do jednego okna.

!macro SORA_DODAJ_MENU TYP
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${TYP}\shell\SoraFlux" "" "$(SoraMenu)"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${TYP}\shell\SoraFlux" "Icon" '"$INSTDIR\${MAINBINARYNAME}.exe",0'
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${TYP}\shell\SoraFlux" "MultiSelectModel" "Player"
  WriteRegStr HKCU "Software\Classes\SystemFileAssociations\${TYP}\shell\SoraFlux\command" "" '"$INSTDIR\${MAINBINARYNAME}.exe" "%1"'
!macroend

!macro SORA_USUN_MENU TYP
  DeleteRegKey HKCU "Software\Classes\SystemFileAssociations\${TYP}\shell\SoraFlux"
!macroend

LangString SoraMenu ${LANG_POLISH} "Konwertuj w SoraFlux"
LangString SoraMenu ${LANG_ENGLISH} "Convert with SoraFlux"

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro SORA_DODAJ_MENU "video"
  !insertmacro SORA_DODAJ_MENU "audio"
  !insertmacro SORA_DODAJ_MENU "image"
  ; odśwież ikony/menu Eksploratora
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro SORA_USUN_MENU "video"
  !insertmacro SORA_USUN_MENU "audio"
  !insertmacro SORA_USUN_MENU "image"
  System::Call 'shell32::SHChangeNotify(i 0x08000000, i 0, p 0, p 0)'
!macroend
