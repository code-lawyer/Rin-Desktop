#ifndef SourceDir
  #error SourceDir must point to a fresh verified portable package
#endif
#ifndef ReleaseDir
  #error ReleaseDir must be supplied
#endif
#ifndef Version
  #define Version "0.5.0"
#endif
[Setup]
#ifdef TestBuild
AppId={{768217DB-EA93-4F63-930D-66001B45C188}
AppName=Rin Desktop Test
DefaultDirName={localappdata}\Programs\RinDesktop-Test
DefaultGroupName=Rin Desktop Test
OutputBaseFilename=Rin-Desktop-{#Version}-Test-{#TestBuild}-Setup
#else
AppId={{215174A1-C028-4225-947F-9B15787E578D}
AppName=Rin Desktop
DefaultDirName={localappdata}\Programs\RinDesktop
DefaultGroupName=Rin Desktop
#ifdef ReleasePreflight
OutputBaseFilename=Rin-Desktop-{#Version}-Preflight-Setup
#else
OutputBaseFilename=Rin-Desktop-{#Version}-Setup
#endif
#endif
#ifdef SignRelease
SignTool=RinRelease
SignedUninstaller=yes
#endif
AppVersion={#Version}
AppPublisher=code-lawyer
AppPublisherURL=https://github.com/code-lawyer/Rin-Desktop
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#ReleaseDir}
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
[InstallDelete]
; Retire only named files and folders owned by older application installers.
Type: files; Name: "{app}\resources\app\backend\custom-agents.mjs"
Type: files; Name: "{app}\resources\app\backend\agent-setup-prompt.mjs"
Type: files; Name: "{app}\resources\app\renderer\custom-agent-settings.mjs"
; Packages unique to the former bundled SDK in the previous installer manifest.
; Keep the SDK entry last so the legacy-install check stays true for its dependencies.
Type: filesandordirs; Name: "{app}\resources\app\node_modules\@anthropic-ai\sdk"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\@babel\runtime"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\@hono\node-server"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\@modelcontextprotocol\sdk"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\@opentelemetry\api"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\@stablelib\base64"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\accepts"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\ajv"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\ajv-formats"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\body-parser"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\bytes"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\call-bind-apply-helpers"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\call-bound"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\content-disposition"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\content-type"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\cookie"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\cookie-signature"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\cors"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\cross-spawn"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\debug"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\depd"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\dunder-proto"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\ee-first"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\encodeurl"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\es-define-property"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\es-errors"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\es-object-atoms"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\escape-html"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\etag"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\eventsource"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\eventsource-parser"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\express"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\express-rate-limit"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\fast-deep-equal"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\fast-sha256"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\fast-uri"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\finalhandler"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\forwarded"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\fresh"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\function-bind"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\get-intrinsic"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\get-proto"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\gopd"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\has-symbols"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\hasown"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\hono"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\http-errors"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\iconv-lite"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\inherits"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\ip-address"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\ipaddr.js"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\is-promise"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\isexe"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\jose"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\json-schema-to-ts"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\json-schema-traverse"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\json-schema-typed"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\math-intrinsics"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\media-typer"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\merge-descriptors"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\mime-db"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\mime-types"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\ms"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\negotiator"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\object-assign"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\object-inspect"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\on-finished"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\once"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\parseurl"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\path-key"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\path-to-regexp"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\pkce-challenge"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\proxy-addr"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\qs"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\range-parser"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\raw-body"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\require-from-string"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\router"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\safer-buffer"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\send"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\serve-static"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\setprototypeof"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\shebang-command"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\shebang-regex"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\side-channel"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\side-channel-list"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\side-channel-map"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\side-channel-weakmap"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\standardwebhooks"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\statuses"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\toidentifier"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\ts-algebra"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\type-is"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\unpipe"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\vary"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\which"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\wrappy"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\zod-to-json-schema"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\node_modules\@anthropic-ai\claude-agent-sdk"; Check: HasBundledClaudeSdk
Type: filesandordirs; Name: "{app}\resources\app\assets\rainy-window-male"
Type: filesandordirs; Name: "{app}\resources\app\assets\rainy-window-v2-4k"
Type: filesandordirs; Name: "{app}\resources\app\assets\stills"
Type: filesandordirs; Name: "{app}\resources\app\assets\character-previews"
Type: filesandordirs; Name: "{app}\resources\app\dist\chunks"
Type: files; Name: "{app}\resources\app\vendor\live2dcubismcore.min.js"
Type: files; Name: "{app}\resources\app\vendor\LICENSE-CubismCore.md"
Type: files; Name: "{app}\resources\app\vendor\LICENSE-AgentAvatar"
Type: dirifempty; Name: "{app}\resources\app\vendor"
Type: files; Name: "{app}\resources\app\backend\video-catalog.mjs"
Type: files; Name: "{app}\resources\app\backend\video-media.mjs"
Type: files; Name: "{app}\resources\app\backend\wallpaper-state.cjs"
Type: files; Name: "{app}\resources\app\renderer\action-assets.mjs"
Type: files; Name: "{app}\resources\app\renderer\action-motion.mjs"
Type: files; Name: "{app}\resources\app\renderer\action-rig.mjs"
Type: files; Name: "{app}\resources\app\renderer\avatar.js"
Type: files; Name: "{app}\resources\app\renderer\pixi-compat.js"
Type: files; Name: "{app}\resources\app\renderer\rig-warp.mjs"
Type: files; Name: "{app}\resources\app\renderer\scene-player.mjs"
Type: files; Name: "{app}\resources\app\renderer\still-preview.css"
Type: files; Name: "{app}\resources\app\renderer\still-preview.html"
Type: files; Name: "{app}\resources\app\renderer\still-preview.mjs"
Type: files; Name: "{app}\resources\app\renderer\still-scene-compose.mjs"
Type: files; Name: "{app}\resources\app\renderer\still-scene-preview.css"
Type: files; Name: "{app}\resources\app\renderer\still-scene-preview.html"
Type: files; Name: "{app}\resources\app\renderer\still-scene-preview.mjs"
Type: files; Name: "{app}\resources\app\renderer\typing-motion.mjs"
Type: files; Name: "{app}\resources\app\renderer\video-state.mjs"
Type: files; Name: "{app}\resources\app\renderer\video-wallpaper.js"
Type: files; Name: "{app}\resources\app\renderer\wallpaper-scenes.mjs"
Type: files; Name: "{app}\resources\app\renderer\wallpaper.js"
Type: files; Name: "{app}\resources\app\dist\avatar.js"
Type: files; Name: "{app}\licenses\live2d-proprietary-agreement.html"
Type: files; Name: "{app}\licenses\pixi-LICENSE"
Type: files; Name: "{app}\licenses\pixi-live2d-LICENSE"
[Icons]
#ifdef TestBuild
Name: "{group}\Rin Desktop Test"; Filename: "{app}\VibeVoice.exe"; Check: not IsPortableMode
Name: "{autodesktop}\Rin Desktop Test"; Filename: "{app}\VibeVoice.exe"; Tasks: desktopicon; Check: not IsPortableMode
#else
Name: "{group}\Rin Desktop"; Filename: "{app}\VibeVoice.exe"; Check: not IsPortableMode
Name: "{autodesktop}\Rin Desktop"; Filename: "{app}\VibeVoice.exe"; Tasks: desktopicon; Check: not IsPortableMode
#endif
[Run]
Filename: "{app}\VibeVoice.exe"; Description: "Open Rin Desktop"; Flags: nowait postinstall skipifsilent; Check: not IsPortableMode
[Code]
function HasBundledClaudeSdk: Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\resources\app\portable.json')) and
    FileExists(ExpandConstant('{app}\resources\app\node_modules\@anthropic-ai\claude-agent-sdk\package.json'));
end;

function IsPortableMode: Boolean;
begin
  Result := ExpandConstant('{param:PORTABLE|0}') = '1';
end;
// Data and downloaded voices are outside {app}; uninstall retains both.
