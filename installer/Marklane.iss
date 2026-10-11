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
#define AppFileVersion GetVersionNumbersString(PublishDir + "\Marklane.exe")
#define AppVersion Copy(AppFileVersion, 1, RPos(".", AppFileVersion) - 1)
#define AppPublisher GetStringFileInfo(PublishDir + "\Marklane.exe", "CompanyName")
#define AppCopyright GetStringFileInfo(PublishDir + "\Marklane.exe", "LegalCopyright")

[Setup]
; Keep this ID stable so subsequent releases upgrade the existing installation.
AppId={{92F02604-9167-4F7C-9FA7-AB16788F6E61}
AppName=Marklane
AppVersion={#AppVersion}
AppVerName=Marklane {#AppVersion}
AppPublisher={#AppPublisher}
AppCopyright={#AppCopyright}
VersionInfoVersion={#AppVersion}
VersionInfoTextVersion={#AppVersion}
VersionInfoProductVersion={#AppVersion}
VersionInfoProductTextVersion={#AppVersion}
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
ChangesAssociations=yes

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "Create a &desktop shortcut"; GroupDescription: "Additional shortcuts:"
Name: "markdownfiles"; Description: "Register Marklane for Markdown files (.md, .markdown, .mdown)"; GroupDescription: "File associations:"

[Files]
Source: "{#PublishDir}\*"; DestDir: "{app}"; Excludes: "*.pdb"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#PrerequisitesDir}\vc_redist.x64.exe"; Flags: dontcopy
Source: "{#PrerequisitesDir}\MicrosoftEdgeWebview2Setup.exe"; Flags: dontcopy

[Icons]
Name: "{commonprograms}\Marklane"; Filename: "{app}\Marklane.exe"; WorkingDir: "{app}"; IconFilename: "{app}\Marklane.exe"; Comment: "Write and edit Markdown"
Name: "{commondesktop}\Marklane"; Filename: "{app}\Marklane.exe"; WorkingDir: "{app}"; IconFilename: "{app}\Marklane.exe"; Comment: "Write and edit Markdown"; Tasks: desktopicon

[Registry]
; Register a handler without replacing Windows' protected per-user default choice.
Root: HKLM; Subkey: "Software\Classes\Marklane.Markdown"; ValueType: string; ValueData: "Markdown document"; Flags: uninsdeletekey; Tasks: markdownfiles
Root: HKLM; Subkey: "Software\Classes\Marklane.Markdown\DefaultIcon"; ValueType: string; ValueData: """{app}\Assets\MarklaneDocument.ico"",0"; Tasks: markdownfiles
Root: HKLM; Subkey: "Software\Classes\Marklane.Markdown\shell\open\command"; ValueType: string; ValueData: """{app}\Marklane.exe"" ""%1"""; Tasks: markdownfiles
; Windows uses this ProgID when Marklane.exe is chosen through "Open with > Choose another app".
Root: HKLM; Subkey: "Software\Classes\Applications\Marklane.exe"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "Marklane"; Flags: uninsdeletekey; Tasks: markdownfiles
Root: HKLM; Subkey: "Software\Classes\Applications\Marklane.exe\DefaultIcon"; ValueType: string; ValueData: """{app}\Assets\MarklaneDocument.ico"",0"; Tasks: markdownfiles
Root: HKLM; Subkey: "Software\Classes\Applications\Marklane.exe\shell\open\command"; ValueType: string; ValueData: """{app}\Marklane.exe"" ""%1"""; Tasks: markdownfiles
#sub RegisterMarkdownExtension
Root: HKLM; Subkey: "Software\Classes\{#MarkdownExtension}\OpenWithProgids"; ValueType: string; ValueName: "Marklane.Markdown"; ValueData: ""; Flags: uninsdeletevalue uninsdeletekeyifempty; Tasks: markdownfiles
Root: HKLM; Subkey: "Software\Marklane\Capabilities\FileAssociations"; ValueType: string; ValueName: "{#MarkdownExtension}"; ValueData: "Marklane.Markdown"; Tasks: markdownfiles
Root: HKLM; Subkey: "Software\Classes\Applications\Marklane.exe\SupportedTypes"; ValueType: string; ValueName: "{#MarkdownExtension}"; ValueData: ""; Tasks: markdownfiles
#endsub
#define MarkdownExtension ".md"
#emit RegisterMarkdownExtension
#define MarkdownExtension ".markdown"
#emit RegisterMarkdownExtension
#define MarkdownExtension ".mdown"
#emit RegisterMarkdownExtension
Root: HKLM; Subkey: "Software\Marklane\Capabilities"; ValueType: string; ValueName: "ApplicationName"; ValueData: "Marklane"; Flags: uninsdeletekey; Tasks: markdownfiles
Root: HKLM; Subkey: "Software\Marklane\Capabilities"; ValueType: string; ValueName: "ApplicationDescription"; ValueData: "Write and view Markdown documents with Marklane."; Tasks: markdownfiles
Root: HKLM; Subkey: "Software\Marklane\Capabilities"; ValueType: string; ValueName: "ApplicationIcon"; ValueData: """{app}\Marklane.exe"",0"; Tasks: markdownfiles
Root: HKLM; Subkey: "Software\RegisteredApplications"; ValueType: string; ValueName: "Marklane"; ValueData: "Software\Marklane\Capabilities"; Flags: uninsdeletevalue; Tasks: markdownfiles

[Run]
Filename: "{code:DefaultAppsUri}"; Description: "Choose Marklane as your default Markdown editor in Windows Settings"; Flags: shellexec postinstall skipifsilent unchecked runasoriginaluser; Tasks: markdownfiles
Filename: "{app}\Marklane.exe"; Description: "Launch Marklane"; Flags: nowait postinstall skipifsilent runasoriginaluser

[Code]
function DefaultAppsUri(Param: String): String;
var
    Version: TWindowsVersion;
begin
    Result := 'ms-settings:defaultapps';
    GetWindowsVersionEx(Version);
    if Version.Build >= 22000 then
        Result := Result + '?registeredAppMachine=Marklane';
end;

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
