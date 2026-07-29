; Inno Setup script for Summer Classic.
; Built in CI via Minionguyjpro/Inno-Setup-Action against the pkg-built
; dist/summer-classic-win-x64.exe. Pass the version with:
;   ISCC.exe /DAppVersion=1.2.3 installer\windows\summer-classic.iss
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{50540FFF-9A34-4150-A3F5-9ECDFEC49E17}
AppName=Summer Classic
AppVersion={#AppVersion}
AppPublisher=Lumber Jill's
DefaultDirName={autopf}\SummerClassic
DefaultGroupName=Summer Classic
DisableProgramGroupPage=yes
SetupIconFile=..\icons\summer-classic.ico
OutputDir=..\..\dist
OutputBaseFilename=SummerClassicSetup
Compression=lzma2
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; GroupDescription: "Additional icons:"

[Files]
Source: "..\..\dist\summer-classic-win-x64.exe"; DestDir: "{app}"; DestName: "SummerClassic.exe"; Flags: ignoreversion

[Icons]
Name: "{group}\Summer Classic"; Filename: "{app}\SummerClassic.exe"
Name: "{group}\Uninstall Summer Classic"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Summer Classic"; Filename: "{app}\SummerClassic.exe"; Tasks: desktopicon

[Run]
Filename: "{app}\SummerClassic.exe"; Description: "Launch Summer Classic"; Flags: nowait postinstall skipifsilent
