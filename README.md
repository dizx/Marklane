# Marklane

A quiet Markdown editor for Windows, written in **C# and WinUI 3**, with a live-preview writing surface.

## Features

- **Live Markdown:** headings, emphasis, links, lists, quotes, code, interactive tasks, and tables on one writing surface.
- **Source when you need it:** active lines reveal their syntax; source mode shows the whole document as Markdown.
- **Native Windows controls:** file pickers, menus, document outline, and unsaved-change dialogs.
- **A focused workspace:** light and dark themes, focus mode, word count, and reading time.
- **Reliable file handling:** atomic saves and preservation of the detected encoding and newline convention.
- **Familiar editing:** undo/redo, formatting shortcuts, and find/replace.

The welcome page is editable and initially unsaved. Choose **File > New** for a blank document.

## Getting started

### Requirements

To build from source:

| Requirement | Version |
| --- | --- |
| Windows | Windows 10 1809 or later, x64 |
| .NET SDK | 10.0.401 or a compatible patch, as configured in `global.json` |
| Node.js | 22 or later, with npm |
| WebView2 | Microsoft Edge WebView2 Runtime |

Visual Studio is optional. For IDE development, use a version supporting .NET 10, WinUI, and `.slnx` solutions, with the Windows development tools installed.

### Build and run

From this folder:

```powershell
.\run.ps1
```

The script restores dependencies, bundles the editor and builds/starts the desktop application. The first build requires internet access for NuGet and npm; the editor itself runs locally without a CDN.

Visual Studio builds install editor dependencies only when the package manifests change or the installation marker is missing, using `npm install` to preserve existing dependency folders. Editor assets are rebuilt only when their inputs change or an output is missing. Design-time builds run neither step.

Manual build:

```powershell
dotnet build src/Marklane/Marklane.csproj -p:Platform=x64
```

Executable:

```text
src/Marklane/bin/x64/Debug/net10.0-windows10.0.19041.0/win-x64/Marklane.exe
```

Pass a Markdown path as the first argument to open it. Close the app before rebuilding, because WinUI holds its resource index open.

### Visual Studio

1. Open `Marklane.slnx`.
2. Set **Marklane** as the startup project.
3. Select **Debug** and **x64**.
4. Build the solution, then start debugging with **F5**.

If a build reports a locked application DLL or resource file, stop debugging and close the running app before rebuilding. The npm restore step updates dependencies in place instead of deleting the entire `node_modules` directory.

## Windows installer

Install [Inno Setup 6.3 or later](https://jrsoftware.org/isdl.php), then run with the build requirements above:

```powershell
.\build-installer.ps1
```

This publishes a self-contained x64 Release build and compiles `installer/Marklane.iss`. The installer is written to `artifacts/installer/Marklane-<version>-win-x64-setup.exe`; its version comes from the published executable. If Inno Setup is installed in a custom location, pass `-IsccPath 'C:\path\to\ISCC.exe'`.

Setup requires administrator access and installs to Program Files, with Start menu and desktop shortcuts and an uninstaller. The desktop shortcut is selected by default and can be deselected during setup. The Marklane icon is used for shortcuts, the executable, the app window/taskbar, and setup. It bundles .NET and the Windows App SDK, installs the Visual C++ runtime, and installs the machine-wide WebView2 runtime if missing. Building requires internet access; installing requires internet access only when WebView2 needs to be downloaded. Target PCs do not need the .NET SDK or Node.js.

Later installers upgrade the existing installation using a stable application ID. Uninstall preserves documents and the settings/WebView2 profile under `%LOCALAPPDATA%\Marklane`.

The editable icon artwork is `src/Marklane/Assets/Marklane.svg`. After changing it, run `npm --prefix src/Marklane/Editor run icon` to regenerate the checked-in multi-resolution `.ico` (requires Microsoft Edge and the editor's npm dependencies).

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| Ctrl+N / Ctrl+O | New / open |
| Ctrl+S / Ctrl+Shift+S | Save / save as |
| Ctrl+/ | Live preview / source |
| Ctrl+Shift+F | Focus mode |
| Ctrl+B / Ctrl+I / Ctrl+K | Bold / italic / link |
| Ctrl+F | Find / replace |
| Ctrl+Z / Ctrl+Y | Undo / redo |

## Project structure

- `src/Marklane`: WinUI window, native menus, dialogs, outline, theme, document lifecycle and WebView2 bridge.
- `src/Marklane.Core`: UI-independent document state and file persistence.
- `src/Marklane/Editor`: locally bundled CodeMirror 6 surface with parser-driven Markdown decorations. Markdown is the canonical document; live rendering never converts it through HTML. JavaScript is confined to the editor component; application/file management is C#.
- `tests/Marklane.Core.Tests`: encoding, save, dirty-state and failure-path tests.
- `src/Marklane/Editor/tests`: browser, Markdown, and native desktop smoke tests.
- `installer/Marklane.iss`: Windows installer definition.
- `build-installer.ps1`: self-contained publishing and installer build.

Themes and WebView2 profile data live in `%LOCALAPPDATA%\Marklane`. Runtime dependency license notices are included in `Editor/THIRD-PARTY-NOTICES.txt` beside the built app.

Editor bundles, installed npm dependencies, build outputs, and installer artifacts are generated locally and excluded from Git. The npm lockfile is committed to keep dependency versions reproducible.

## Tests

After building the app:

```powershell
dotnet test tests/Marklane.Core.Tests/Marklane.Core.Tests.csproj
npm --prefix src/Marklane/Editor test
```

Browser tests use the installed Microsoft Edge through Playwright. They validate live rendering, source round trips, table editing, task undo, typing, formatting, search, outline and theme/focus state.

To exercise the actual desktop application after building:

```powershell
Push-Location src/Marklane/Editor
node tests/native-smoke.mjs
Pop-Location
```

This launches a separate test instance with a scratch document and isolated WebView2 profile. It checks native open/save, source-mode bridging, the unsaved-close dialog, cancel and clean close. Its temporary debugging endpoint exists only for that test process.

## Current scope

This is an initial single-document editor. Images, math, diagrams, HTML blocks and advanced Markdown extensions remain source text. There is no folder browser, PDF export, autosave/crash recovery, external-file-change detection, or rich-HTML clipboard conversion yet. Links are styled but do not navigate out of the editor. Large-file performance and IME/accessibility behavior beyond the checks above have not been comprehensively validated.

UTF-8 and BOM-marked UTF-16/UTF-32 documents are supported. Saves preserve the detected encoding and newline convention; mixed newline files are normalized to one convention.
