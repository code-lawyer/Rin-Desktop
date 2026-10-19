#ifndef SourceDir
  #error SourceDir must point to a fresh verified portable package
#endif
#ifndef ReleaseDir
  #error ReleaseDir must be supplied
#endif
#ifndef Version
  #define Version "0.3.0"
#endif
[Setup]
AppId={{215174A1-C028-4225-947F-9B15787E578D}
AppName=Rin Desktop
AppVersion={#Version}
AppPublisher=code-lawyer
AppPublisherURL=https://github.com/code-lawyer/Rin-Desktop
DefaultDirName={localappdata}\Programs\RinDesktop
DefaultGroupName=Rin Desktop
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#ReleaseDir}
OutputBaseFilename=Rin-Desktop-{#Version}-Setup
Compression=zip/1
SolidCompression=no
WizardStyle=modern
DisableProgramGroupPage=yes
LicenseFile=license-agreement.txt
UninstallDisplayIcon={app}\VibeVoice.exe
CloseApplications=yes
RestartApplications=no
Uninstallable=not IsPortableMode
CreateUninstallRegKey=not IsPortableMode
[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: checkedonce
[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
[Icons]
Name: "{group}\Rin Desktop"; Filename: "{app}\VibeVoice.exe"; Check: not IsPortableMode
Name: "{autodesktop}\Rin Desktop"; Filename: "{app}\VibeVoice.exe"; Tasks: desktopicon; Check: not IsPortableMode
[Run]
Filename: "{app}\VibeVoice.exe"; Description: "Open Rin Desktop"; Flags: nowait postinstall skipifsilent; Check: not IsPortableMode
[Code]
function IsPortableMode: Boolean;
begin
  Result := ExpandConstant('{param:PORTABLE|0}') = '1';
end;
// Data and downloaded voices are outside {app}; uninstall retains both.
