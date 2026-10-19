var RuntimeDownload: TDownloadWizardPage;

function HasVoiceRuntime: Boolean;
var VersionMS, VersionLS: Cardinal;
begin
  Result := GetVersionNumbers(ExpandConstant('{sys}\msvcp140.dll'), VersionMS, VersionLS);
  if Result then Result := VersionMS >= ((14 shl 16) or 44);
end;

procedure InitializeWizard;
begin
  RuntimeDownload := CreateDownloadPage('Microsoft Visual C++ Runtime',
    'Qwen voice needs the official Microsoft runtime. Windows may ask for administrator approval.', nil);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var Code: Integer;
begin
  Result := '';
  if HasVoiceRuntime then Exit;
  RuntimeDownload.Clear;
  RuntimeDownload.Add('https://download.visualstudio.microsoft.com/download/pr/ebdab8e5-1d7b-4d9f-a11b-cbb1720c3b12/843068991DAAA1F73AD9F6239BCE4D0F6A07A51F18C37EA2A867E9BECA71295C/VC_redist.x64.exe',
    'VC_redist.x64.exe', '843068991daaa1f73ad9f6239bce4d0f6a07a51f18c37ea2a867e9beca71295c');
  RuntimeDownload.Show;
  try
    try RuntimeDownload.Download;
    except Result := 'Microsoft runtime download failed: ' + GetExceptionMessage; end;
  finally RuntimeDownload.Hide; end;
  if Result <> '' then Exit;
  if not ShellExec('runas', ExpandConstant('{tmp}\VC_redist.x64.exe'), '/install /passive /norestart', '', SW_SHOWNORMAL, ewWaitUntilTerminated, Code) then begin
    Result := 'The Microsoft runtime was not installed. Retry and approve Windows elevation, or go back and deselect Qwen voice.';
    Exit;
  end;
  if Code = 3010 then NeedsRestart := True
  else if (Code <> 0) and (Code <> 1638) then Result := 'Microsoft runtime installation failed. Code: ' + IntToStr(Code);
  if (Result = '') and not NeedsRestart and not HasVoiceRuntime then
    Result := 'Microsoft Visual C++ Runtime 14.44 or later was not detected. Install it from Microsoft, then retry.';
end;
// Data is outside {app}; upgrades and uninstall never delete user data.
