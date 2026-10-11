# Marklane

A quiet Markdown editor for Windows, written in **C# and WinUI 3**, with a live-preview writing surface.

Copyright (c) 2026 Morten Aasheim.

## Features

- **Live Markdown:** headings, emphasis, links, lists, quotes, code, interactive tasks, and tables on one writing surface.
- **Source when you need it:** active lines reveal their syntax; source mode shows the whole document as Markdown.
- **Native Windows controls:** file pickers, recent files, menus, document outline, and unsaved-change dialogs.
- **A focused workspace:** light and dark themes, focus mode, word count, and reading time.
- **Code highlighting:** language-aware colors in live preview and source mode, with palettes for day and night.
- **Reliable file handling:** atomic saves and preservation of the detected encoding and newline convention.
- **Familiar editing:** undo/redo, formatting shortcuts, and find/replace.

The welcome page is editable and starts unmodified. It only asks to save after you change its content. Choose **File > New** for a blank document.

### Recent files

**File > Recent files** remembers the last 10 successfully opened or saved documents, newest first. Reopening a file moves it to the top without creating a duplicate. Entries show the filename and folder, with the full path available as a tooltip.

The list survives restarts. **Clear recent files** clears history without deleting documents. If a listed file has been moved or deleted, attempting to open it removes the stale entry and keeps the current document intact. Switching documents still asks about genuinely unsaved edits.

### Night mode and code blocks

Choose **View > Night mode** or click the moon/sun button in the toolbar. The charcoal palette applies to the editor, sidebar, window controls, and search panel. Your choice is remembered for the next launch.

Add a language name after the opening code fence to enable syntax highlighting:

````markdown
```csharp
// A small idea, ready to grow.
public sealed class Note
{
    private readonly string title = "A fresh thought";
    public int Count => 42;
}
```
````

Supported labels include `csharp` / `cs` / `c#`, `javascript` / `js`, `typescript` / `ts`, `json`, `html`, `css`, `python`, `sql`, `powershell`, `bash`, and `yaml`. Language parsers are bundled locally. Unknown or unlabelled fences remain plain text, and changing theme or editing mode preserves the Markdown and undo history.

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

Set the three-part release version (`1.0.0`) and author/copyright metadata in `src/Directory.Build.props`. The installer uses the same metadata and `x.x.x` version format.

Setup requires administrator access and installs to Program Files, with Start menu and desktop shortcuts and an uninstaller. The desktop shortcut is selected by default and can be deselected during setup. The Marklane icon is used for shortcuts, the executable, the app window/taskbar, and setup. It bundles .NET and the Windows App SDK, installs the Visual C++ runtime, and installs the machine-wide WebView2 runtime if missing. Building requires internet access; installing requires internet access only when WebView2 needs to be downloaded. Target PCs do not need the .NET SDK or Node.js.

Later installers upgrade the existing installation using a stable application ID. Uninstall preserves documents and the settings/WebView2 profile under `%LOCALAPPDATA%\Marklane`.

### Markdown file associations

Leave **Register Marklane for Markdown files** selected during setup to add Marklane to **Open with** and **Default apps** for `.md`, `.markdown`, and `.mdown`. On the final setup page, select **Choose Marklane as your default Markdown editor in Windows Settings**, then choose Marklane for the desired extensions. On Windows 10, search for the extensions in Default apps; recent Windows 11 versions open Marklane's settings directly.

Windows requires you to confirm the default-app choice. Once selected, double-clicking a Markdown file opens it in Marklane and Explorer uses the Marklane document icon. Uninstall removes Marklane's handler registration.

The editable icon artwork is in `src/Marklane/Assets/Marklane.svg` and `MarklaneDocument.svg`. After changing either, run `npm --prefix src/Marklane/Editor run icon` to regenerate the checked-in multi-resolution `.ico` files (requires Microsoft Edge and the editor's npm dependencies).

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

Themes, `recent-files.json`, and WebView2 profile data live in `%LOCALAPPDATA%\Marklane`. Runtime dependency license notices are included in `Editor/THIRD-PARTY-NOTICES.txt` beside the built app.

Editor bundles, installed npm dependencies, build outputs, and installer artifacts are generated locally and excluded from Git. The npm lockfile is committed to keep dependency versions reproducible.

## Tests

After building the app:

```powershell
dotnet test tests/Marklane.Core.Tests/Marklane.Core.Tests.csproj
npm --prefix src/Marklane/Editor test
```

Browser tests use the installed Microsoft Edge through Playwright. They validate live rendering, source round trips, table editing, task undo, typing, formatting, search, outline, theme/focus state, code-token colors, language aliases, offline highlighting, and editing inside code fences.

To exercise the actual desktop application after building:

```powershell
Push-Location src/Marklane/Editor
node tests/native-smoke.mjs
node tests/native-documents-smoke.mjs
Pop-Location
```

These checks launch separate test instances with scratch documents, settings/history isolated through `MARKLANE_DATA_DIRECTORY`, and isolated WebView2 profiles. They cover night/light mode, code highlighting, open/save, source-mode bridging, unchanged welcome documents, recent-file persistence and clearing, missing files, and save/cancel/discard behavior. Run the desktop checks sequentially because they share the Windows desktop. Their temporary debugging endpoints exist only for the test processes.

## Current scope

This is an initial single-document editor. Images, math, diagrams, HTML blocks and advanced Markdown extensions remain source text. There is no folder browser, PDF export, autosave/crash recovery, external-file-change detection, or rich-HTML clipboard conversion yet. Links are styled but do not navigate out of the editor. Large-file performance and IME/accessibility behavior beyond the checks above have not been comprehensively validated.

UTF-8 and BOM-marked UTF-16/UTF-32 documents are supported. Saves preserve the detected encoding and newline convention; mixed newline files are normalized to one convention.
