; Pixelfront – Windows-Installer (NSIS 3, Modern UI 2)
; Gebaut von tools/build-windows-setup.sh; erwartet build/windows/Pixelfront.exe.

Unicode true
SetCompressor /SOLID lzma

!ifndef VERSION
  !define VERSION "1.0.0"
!endif
!define APP "Pixelfront"
!define PUBLISHER "Pixelfront"
!define UNINST_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP}"

Name "${APP}"
OutFile "..\..\build\${APP}-Setup-${VERSION}.exe"
InstallDir "$PROGRAMFILES64\${APP}"
InstallDirRegKey HKLM "Software\${APP}" "InstallDir"
RequestExecutionLevel admin
BrandingText "${APP} ${VERSION}"

VIProductVersion "${VERSION}.0"
VIAddVersionKey /LANG=1031 "ProductName" "${APP}"
VIAddVersionKey /LANG=1031 "FileDescription" "${APP} – Installation"
VIAddVersionKey /LANG=1031 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1031 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1031 "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=1031 "LegalCopyright" ""

!include "MUI2.nsh"

!define MUI_ICON "pixelfront.ico"
!define MUI_UNICON "pixelfront.ico"
!define MUI_HEADERIMAGE
!define MUI_HEADERIMAGE_RIGHT
!define MUI_HEADERIMAGE_BITMAP "header.bmp"
!define MUI_WELCOMEFINISHPAGE_BITMAP "wizard.bmp"
!define MUI_UNWELCOMEFINISHPAGE_BITMAP "wizard.bmp"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "Willkommen bei ${APP}"
!define MUI_WELCOMEPAGE_TEXT "Dieser Assistent installiert ${APP} ${VERSION} auf diesem Computer.$\r$\n$\r$\nIsometrische Echtzeit-Strategie in Pixelgrafik: NATO gegen Russland, mit Basenbau, Rohstoffen, Panzern, Hubschraubern, Jets und Marine.$\r$\n$\r$\nKlicken Sie auf Weiter, um fortzufahren."
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP}.exe"
!define MUI_FINISHPAGE_RUN_TEXT "${APP} jetzt starten"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_COMPONENTS
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "German"

Section "${APP} (erforderlich)" SecMain
  SectionIn RO
  SetOutPath "$INSTDIR"
  File "..\..\build\windows\${APP}.exe"
  File "pixelfront.ico"
  WriteUninstaller "$INSTDIR\Deinstallieren.exe"
  WriteRegStr HKLM "Software\${APP}" "InstallDir" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayName" "${APP}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKLM "${UNINST_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKLM "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\pixelfront.ico"
  WriteRegStr HKLM "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINST_KEY}" "UninstallString" '"$INSTDIR\Deinstallieren.exe"'
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINST_KEY}" "NoRepair" 1
SectionEnd

Section "Verknüpfung im Startmenü" SecStart
  CreateDirectory "$SMPROGRAMS\${APP}"
  CreateShortcut "$SMPROGRAMS\${APP}\${APP}.lnk" "$INSTDIR\${APP}.exe" "" "$INSTDIR\pixelfront.ico"
  CreateShortcut "$SMPROGRAMS\${APP}\${APP} deinstallieren.lnk" "$INSTDIR\Deinstallieren.exe"
SectionEnd

Section "Verknüpfung auf dem Desktop" SecDesk
  CreateShortcut "$DESKTOP\${APP}.lnk" "$INSTDIR\${APP}.exe" "" "$INSTDIR\pixelfront.ico"
SectionEnd

!insertmacro MUI_FUNCTION_DESCRIPTION_BEGIN
  !insertmacro MUI_DESCRIPTION_TEXT ${SecMain} "Das Spiel selbst."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecStart} "Einträge im Startmenü zum Starten und Deinstallieren."
  !insertmacro MUI_DESCRIPTION_TEXT ${SecDesk} "Ein Symbol auf dem Desktop."
!insertmacro MUI_FUNCTION_DESCRIPTION_END

Section "Uninstall"
  Delete "$INSTDIR\${APP}.exe"
  Delete "$INSTDIR\pixelfront.ico"
  Delete "$INSTDIR\Deinstallieren.exe"
  RMDir "$INSTDIR"
  Delete "$SMPROGRAMS\${APP}\${APP}.lnk"
  Delete "$SMPROGRAMS\${APP}\${APP} deinstallieren.lnk"
  RMDir "$SMPROGRAMS\${APP}"
  Delete "$DESKTOP\${APP}.lnk"
  DeleteRegKey HKLM "${UNINST_KEY}"
  DeleteRegKey HKLM "Software\${APP}"
SectionEnd
