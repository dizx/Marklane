# Marklane

A quiet Markdown editor for Windows, written in **C# and WinUI 3**, with a Typora-inspired live-preview writing surface.

## Run

Requirements: Windows 10 1809 or later (x64), .NET SDK 10.0.401, Node.js 22+ with npm, and Microsoft Edge WebView2 Runtime. Visual Studio is optional; use a current version with WinUI support to open `Marklane.slnx`.

From this folder:

```powershell
.\run.ps1
```

The script restores dependencies, bundles the editor and builds/starts the desktop application. The first build requires internet access for NuGet and npm; the editor itself runs locally without a CDN.

Manual build:

```powershell
dotnet build src/Marklane/Marklane.csproj -p:Platform=x64
```

Executable:

```text
src/Marklane/bin/x64/Debug/net10.0-windows10.0.19041.0/win-x64/Marklane.exe
```

Pass a Markdown path as the first argument to open it. Close the app before rebuilding, because WinUI holds its resource index open.

## Features

- One live-preview surface: headings, bold/italic/strikethrough, inline code, links, lists, interactive tasks, quotes, tables and fenced code.
- Active lines reveal Markdown. Click rendered tables to edit their source.
- Source mode, undo/redo, formatting commands and find/replace.
- Native file pickers, New/Open/Save/Save As and unsaved-change confirmation.
- Atomic file replacement; UTF-8 and BOM-marked UTF-16/UTF-32 support. Saves preserve the detected newline convention and encoding. Mixed newline files are normalized to one convention.
- Native outline navigation, word count, reading time, light/dark themes and focus mode.
- Keyboard and screen-reader labels for the editor and native controls.

| Shortcut | Action |
| --- | --- |
| Ctrl+N / Ctrl+O | New / open |
| Ctrl+S / Ctrl+Shift+S | Save / save as |
| Ctrl+/ | Live preview / source |
| Ctrl+Shift+F | Focus mode |
| Ctrl+B / Ctrl+I / Ctrl+K | Bold / italic / link |
| Ctrl+F | Find / replace |
| Ctrl+Z / Ctrl+Y | Undo / redo |

The welcome page is editable and initially unsaved. File > New starts an empty document.

## Architecture

- `src/Marklane`: WinUI window, native menus, dialogs, outline, theme, document lifecycle and WebView2 bridge.
- `src/Marklane.Core`: UI-independent document state and file persistence.
- `src/Marklane/Editor`: locally bundled CodeMirror 6 surface with parser-driven Markdown decorations. Markdown is the canonical document; live rendering never converts it through HTML. JavaScript is confined to the editor component; application/file management is C#.
- `tests/Marklane.Core.Tests`: encoding, save, dirty-state and failure-path tests.
- `docs/typora-reference.md`: reference findings, REA evidence and analysis boundaries.

Themes and WebView2 profile data live in `%LOCALAPPDATA%\Marklane`. Runtime dependency license notices are included in `Editor/THIRD-PARTY-NOTICES.txt` beside the built app.

## Verify

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
