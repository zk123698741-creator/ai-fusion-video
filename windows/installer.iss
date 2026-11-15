#ifndef BundleDir
  #error BundleDir is required
#endif
#ifndef AppVersion
  #error AppVersion is required
#endif
#ifndef OutputDir
  #error OutputDir is required
#endif

[Setup]
AppId={{3B54EC3E-AC3F-4BE0-9B3B-203824432A6F}
AppName=FusionVideo
AppVersion={#AppVersion}
AppPublisher=FusionVideo Windows
DefaultDirName={localappdata}\FusionVideo
DefaultGroupName=FusionVideo
DisableProgramGroupPage=yes
DisableDirPage=no
UsePreviousAppDir=no
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputDir={#OutputDir}
OutputBaseFilename=FusionVideo-Windows-x64-{#AppVersion}-Setup
Compression=lzma2/fast
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\runtime\node\node.exe
CloseApplications=no
RestartApplications=no

[Files]
Source: "{#BundleDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\FusionVideo"; Filename: "{app}\Start.cmd"; WorkingDir: "{app}"
Name: "{group}\Update FusionVideo"; Filename: "{app}\Update.cmd"; WorkingDir: "{app}"
Name: "{group}\Stop FusionVideo"; Filename: "{app}\Stop.cmd"; WorkingDir: "{app}"
Name: "{autodesktop}\FusionVideo"; Filename: "{app}\Start.cmd"; WorkingDir: "{app}"

[Code]
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  InstallDir: String;
  I: Integer;
begin
  Result := '';
  InstallDir := ExpandConstant('{app}');
  for I := 1 to Length(InstallDir) do
    if (Ord(InstallDir[I]) < 33) or (Ord(InstallDir[I]) > 126) then
    begin
      Result := 'Choose an English path without spaces, for example D:\FusionVideo.';
      Exit;
    end;
  if FileExists(InstallDir + '\current.txt') or
     DirExists(InstallDir + '\data') or DirExists(InstallDir + '\config') then
    Result := 'This folder contains an existing installation or user data. Use Update.cmd to update it, or select a new empty folder.';
end;

function InitializeUninstall(): Boolean;
begin
  Result := not (FileExists(ExpandConstant('{app}\.runtime\instance.lock')) or
                 FileExists(ExpandConstant('{app}\.runtime\update.lock')) or
                 FileExists(ExpandConstant('{app}\.runtime\update-journal.json')));
  if not Result then
    SuppressibleMsgBox('Run Stop.cmd and finish or roll back any update before uninstalling. User data will be kept.', mbError, MB_OK, IDOK);
end;
