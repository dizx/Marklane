; Build with .\build-installer.ps1 from the repository root.
; Inno Setup 6.3 or later is required.
#ifndef PublishDir
  #define PublishDir SourcePath + "..\artifacts\publish\win-x64"
#endif
#ifndef PrerequisitesDir
  #define PrerequisitesDir SourcePath + "..\artifacts\prerequisites"
#endif
#ifndef InstallerOutputDir
  #define InstallerOutputDir SourcePath + "..\artifacts\installer"
#endif
#define AppVersion GetVersionNumbersString(PublishDir + "\Marklane.exe")

[Setup]
; Keep this ID stable so subsequent releases upgrade the existing installation.
AppId={{92F02604-9167-4F7C-9FA7-AB16788F6E61}
AppName=Marklane
AppVersion={#AppVersion}
AppVerName=Marklane {#AppVersion}
DefaultDirName={autopf}\Marklane
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
OutputDir={#InstallerOutputDir}
OutputBaseFilename=Marklane-{#AppVersion}-win-x64-setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#PublishDir}\Assets\Marklane.ico
UninstallDisplayIcon={app}\Marklane.exe
CloseApplications=yes
RestartApplications=no
SetupLogging=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Excludes: "*.pdb"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PrerequisitesDir}\vc_redist.x64.exe"; Flags: dontcopy
Source: "{#PrerequisitesDir}\MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy

[Icons]
Name: "{commonprograms}\Marklane"; Filename: "{app}\Marklane.exe"; WorkingDir: "{app}"; IconFilename: "{app}\Marklane.exe"; Comment: "Write and edit Markdown"
Name: "{commondesktop}\Marklane"; Filename: "{app}\Marklane.exe"; WorkingDir: "{app}"; IconFilename: "{app}\Marklane.exe"; Comment: "Write and edit Markdown"; Tasks: desktopicon

[Run]
Filename: "{app}\Marklane.exe"; Description: "Launch Marklane"; Flags: nowait postinstall skipifsilent runasoriginaluser

[Code]
function MachineWebView2Installed: Boolean;
var
    Version: String;
begin
    Result := RegQueryStringValue(HKLM32,
        'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}',
        'pv', Version);
    if Result then
        Result := (Version <> '') and (Version <> '0.0.0.0');
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
var
    ResultCode: Integer;
begin
    Result := '';
    ExtractTemporaryFile('vc_redist.x64.exe');
    if not Exec(ExpandConstant('{tmp}\vc_redist.x64.exe'),
        '/install /quiet /norestart', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
    begin
        Result := 'Could not start the Microsoft Visual C++ runtime installer.';
        Exit;
    end;
    { 1638 means a newer runtime is already installed. }
    if (ResultCode <> 0) and (ResultCode <> 1638) and (ResultCode <> 3010) then
    begin
        Result := Format('Microsoft Visual C++ runtime installation failed (exit code %d).', [ResultCode]);
        Exit;
    end;
    if ResultCode = 3010 then
        NeedsRestart := True;

    if not MachineWebView2Installed then
    begin
        ExtractTemporaryFile('MicrosoftEdgeWebview2Setup.exe');
        if not Exec(ExpandConstant('{tmp}\MicrosoftEdgeWebview2Setup.exe'),
            '/silent /install', '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
        begin
            Result := 'Could not start the Microsoft Edge WebView2 runtime installer.';
            Exit;
        end;
        if not MachineWebView2Installed then
            Result := Format('Microsoft Edge WebView2 runtime installation failed (exit code %d). ' +
                'Check your internet connection and try again.', [ResultCode]);
    end;
end;
