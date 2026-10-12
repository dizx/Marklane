// Runs against the real WinUI executable with an isolated WebView2 profile and scratch document.
import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, writeFile, rename, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

const executable = resolve(process.argv[2] || "../bin/x64/Debug/net10.0-windows10.0.19041.0/win-x64/Marklane.exe");
const directory = await mkdtemp(join(process.env.LOCALAPPDATA, "Temp", "opencode", "marklane-smoke-"));
const documentPath = join(directory, "Smoke.md");
const initialText = "# Native smoke\r\n\r\nOriginal text.\r\n\r\n```csharp\r\npublic class Note { string title = \"Hello\"; }\r\n```\r\n";
await writeFile(documentPath, initialText);
const portServer = createServer();
await new Promise(resolve => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port;
await new Promise(resolve => portServer.close(resolve));
const app = spawn(executable, [documentPath], {
  env: { ...process.env, MARKLANE_DATA_DIRECTORY: join(directory, "settings"), WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, WEBVIEW2_USER_DATA_FOLDER: join(directory, "profile") },
  stdio: "ignore"
});
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const powershell = script => execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" });
let browser;
try {
  for (let attempt = 0; attempt < 60; attempt++) {
    try { if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break; } catch {}
    if (app.exitCode !== null) throw new Error(`Marklane exited with ${app.exitCode}`);
    await delay(250);
  }
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  page.setDefaultTimeout(15000);
  await page.waitForFunction(() => window.marklane?.getText().includes("Original text."));
  assert.equal(await page.evaluate(() => window.marklane.getText()), initialText.replaceAll("\r\n", "\n"));
  assert.deepEqual(JSON.parse(await readFile(join(directory, "settings", "recent-files.json"), "utf8")), [documentPath]);
  await page.locator(".md-code-line .syntax-keyword").first().waitFor();
  const automation = `Add-Type -AssemblyName UIAutomationClient; $root = [System.Windows.Automation.AutomationElement]::FromHandle((Get-Process -Id ${app.pid}).MainWindowHandle); `;
  const originalTheme = await page.locator("html").getAttribute("data-theme");
  const themePath = join(directory, "settings", "theme.txt");
  try {
    for (const desiredTheme of ["dark", "light"]) {
      if (await page.locator("html").getAttribute("data-theme") !== desiredTheme) {
        await page.evaluate(() => window.chrome.webview.postMessage({ type: "command", command: "theme" }));
        await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, desiredTheme);
      }
      const expectedColor = desiredTheme === "dark" ? "rgb(214, 163, 231)" : "rgb(128, 63, 160)";
      assert.equal(await page.locator(".syntax-keyword").first().evaluate(element => getComputedStyle(element).color), expectedColor);
      const names = powershell(automation + `$root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name }`);
      assert.ok(names.includes(desiredTheme === "dark" ? "Switch to light mode" : "Switch to night mode"));
      assert.equal(await readFile(themePath, "utf8"), desiredTheme);
      assert.equal(await page.evaluate(() => window.marklane.getText()), initialText.replaceAll("\r\n", "\n"));
    }
  } finally {
    if (await page.locator("html").getAttribute("data-theme") !== originalTheme) {
      await page.evaluate(() => window.chrome.webview.postMessage({ type: "command", command: "theme" }));
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, originalTheme);
    }
  }
  console.log("PASS native night/light mode, code highlighting, toolbar state and saved theme");
  const nativeNames = () => powershell(automation + `$root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name }`).split(/\r?\n/);
  const normalSize = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  // Enter through the native button to verify keyboard focus follows the disappearing toolbar.
  powershell(automation + `$button = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Focus mode'))); ([System.Windows.Automation.InvokePattern]$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke();`);
  await page.waitForFunction(() => document.body.classList.contains("focus-mode"));
  await page.waitForFunction(size => innerWidth > size.width && innerHeight > size.height + 32, normalSize);
  let names = nativeNames();
  for (const hidden of ["File", "Edit", "View", "Outline", "Live preview", "UTF-8 · CRLF"])
    assert.ok(!names.includes(hidden), `${hidden} must be hidden in focus mode`);
  await page.keyboard.press("Control+f");
  await page.locator(".cm-search").waitFor();
  await page.keyboard.press("Escape");
  await page.locator(".cm-search").waitFor({ state: "hidden" });
  assert.ok(await page.locator("body").evaluate(element => element.classList.contains("focus-mode")), "Closing search must keep focus mode active");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.body.classList.contains("focus-mode"));
  await page.waitForFunction(size => innerWidth === size.width && innerHeight === size.height, normalSize);
  names = nativeNames();
  for (const restored of ["File", "Outline"]) assert.ok(names.includes(restored), `${restored} must be restored: ${JSON.stringify(names)}`);
  assert.equal(await page.evaluate(() => window.marklane.getText()), initialText.replaceAll("\r\n", "\n"));
  console.log("PASS native focus hides chrome, expands canvas, and Escape restores controls after closing search");

  await page.evaluate(() => window.chrome.webview.postMessage({ type: "command", command: "outline" }));
  await page.waitForFunction(size => innerWidth > size.width, normalSize);
  await page.keyboard.press("Control+Shift+F");
  await page.waitForFunction(() => document.body.classList.contains("focus-mode"));
  await page.keyboard.press("Control+Shift+F");
  await page.waitForFunction(() => !document.body.classList.contains("focus-mode"));
  assert.ok(!nativeNames().includes("Outline"), "Focus mode must preserve the hidden outline preference");
  await page.evaluate(() => window.chrome.webview.postMessage({ type: "command", command: "outline" }));
  await page.waitForFunction(size => innerWidth === size.width, normalSize);
  await page.keyboard.press("Control+Shift+F");
  await page.waitForFunction(() => document.body.classList.contains("focus-mode"));
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("A native save.\n");
  await page.keyboard.press("Control+s");
  let saved;
  for (let attempt = 0; attempt < 40; attempt++) {
    saved = await readFile(documentPath, "utf8");
    if (saved.includes("A native save.")) break;
    await delay(100);
  }
  assert.equal(saved, initialText + "A native save.\r\n");
  await page.keyboard.press("Control+Shift+F");
  await page.waitForFunction(() => !document.body.classList.contains("focus-mode"));
  await page.keyboard.press("Control+z");
  assert.equal(await page.evaluate(() => window.marklane.getText()), initialText.replaceAll("\r\n", "\n"));
  await page.keyboard.press("Control+y");
  assert.equal(await page.evaluate(() => window.marklane.getText()), (initialText + "A native save.\r\n").replaceAll("\r\n", "\n"));
  console.log("PASS focus toggle preserves outline preference, editing, Ctrl+S and undo history");

  await page.keyboard.press("Control+/");
  await page.waitForFunction(() => document.body.classList.contains("source-mode"));
  await page.keyboard.press("Control+/");
  await page.waitForFunction(() => !document.body.classList.contains("source-mode"));
  console.log("PASS native source-mode command round trip");

  const invokeNative = name => powershell(automation + `$buttons = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, '${name}'))); $button = $buttons | Where-Object { $_.Current.AutomationId -ne 'Close' } | Select-Object -First 1; ([System.Windows.Automation.InvokePattern]$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke();`);
  const waitForNative = async (name, visible = true) => {
    for (let attempt = 0; attempt < 40; attempt++) {
      if (nativeNames().includes(name) === visible) return;
      await delay(150);
    }
    assert.fail(`Native control ${name} should be ${visible ? "visible" : "hidden"}`);
  };
  await delay(2200);
  assert.ok(!nativeNames().includes("File changed on disk"), "Marklane's own save must not trigger reload");
  await page.evaluate(() => window.chrome.webview.postMessage({ type: "command", command: "about" }));
  await waitForNative("About Marklane");
  const externalText = "# External edit\n\nReloaded version.\n";
  await writeFile(documentPath, externalText);
  await delay(2200);
  assert.ok(!nativeNames().includes("File changed on disk"), "File changes must wait for the existing dialog");
  invokeNative("Close");
  await waitForNative("File changed on disk");
  invokeNative("Reload");
  await page.waitForFunction(text => window.marklane.getText() === text, externalText);
  await waitForNative("File changed on disk", false);
  console.log("PASS external update waits for dialogs and reloads text");

  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("Local edits to keep\n");
  const localText = await page.evaluate(() => window.marklane.getText());
  const replacementPath = join(directory, "Replacement.tmp");
  const replacementText = "# Atomic replacement\n\nFrom another editor.\n";
  await writeFile(replacementPath, replacementText);
  await rename(replacementPath, documentPath);
  await waitForNative("File changed on disk");
  assert.ok(nativeNames().some(name => name.includes("Reloading will discard your unsaved changes.")));
  invokeNative("Keep my changes");
  await waitForNative("File changed on disk", false);
  assert.equal(await page.evaluate(() => window.marklane.getText()), localText);
  assert.equal(await readFile(documentPath, "utf8"), replacementText);
  await delay(2200);
  assert.ok(!nativeNames().includes("File changed on disk"), "Keeping text must acknowledge that disk version");
  await writeFile(documentPath, "# Another external edit\n");
  await waitForNative("File changed on disk");
  invokeNative("Reload");
  await page.waitForFunction(() => window.marklane.getText() === "# Another external edit\n");
  console.log("PASS atomic replacement, unsaved-change warning, keep without overwriting, and later reload");

  await rm(documentPath);
  await waitForNative("File removed from disk");
  invokeNative("Keep editing");
  await waitForNative("File removed from disk", false);
  assert.equal(await page.evaluate(() => window.marklane.getText()), "# Another external edit\n");
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+s");
  for (let attempt = 0; attempt < 40; attempt++) {
    try { if (await readFile(documentPath, "utf8") === "# Another external edit\n") break; } catch {}
    await delay(100);
  }
  assert.equal(await readFile(documentPath, "utf8"), "# Another external edit\n");
  await delay(2200);
  assert.ok(!nativeNames().includes("File changed on disk"));
  console.log("PASS deleted file preserves text and can be recreated with Save");

  // Save must also check immediately, even before the background timer observes a change.
  await writeFile(documentPath, "External update just before save\n");
  await page.evaluate(() => window.chrome.webview.postMessage({ type: "command", command: "save" }));
  await waitForNative("File changed on disk");
  assert.equal(await readFile(documentPath, "utf8"), "External update just before save\n");
  invokeNative("Keep my changes");
  await waitForNative("File changed on disk", false);
  assert.equal(await readFile(documentPath, "utf8"), "External update just before save\n");
  await page.evaluate(() => window.chrome.webview.postMessage({ type: "command", command: "save" }));
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await readFile(documentPath, "utf8") === "# Another external edit\n") break;
    await delay(100);
  }
  assert.equal(await readFile(documentPath, "utf8"), "# Another external edit\n");
  console.log("PASS Save detects pending disk updates before overwriting");

  await page.keyboard.insertText("Unsaved edit");
  powershell(`(Get-Process -Id ${app.pid}).CloseMainWindow() | Out-Null`);
  let prompt = false;
  for (let attempt = 0; attempt < 20; attempt++) {
    prompt = powershell(automation + `$root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name }`).includes("Save your changes?");
    if (prompt) break;
    await delay(100);
  }
  assert.ok(prompt, "Native close must present the unsaved-changes dialog");
  powershell(automation + `$button = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, 'Cancel'))); ([System.Windows.Automation.InvokePattern]$button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke();`);
  for (let attempt = 0; attempt < 20; attempt++) {
    const names = powershell(automation + `$root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name }`);
    if (!names.includes("Save your changes?")) break;
    await delay(100);
  }
  assert.match(await page.evaluate(() => window.marklane.getText()), /Unsaved edit/);
  console.log("PASS native unsaved-close prompt and cancel preserve edits");
  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+s");
  for (let attempt = 0; attempt < 40; attempt++) {
    if ((await readFile(documentPath, "utf8")).includes("Unsaved edit")) break;
    await delay(100);
  }
  assert.match(await readFile(documentPath, "utf8"), /Unsaved edit/);
  powershell(`(Get-Process -Id ${app.pid}).CloseMainWindow() | Out-Null`);
  await Promise.race([new Promise(resolve => app.once("exit", resolve)), delay(5000)]);
  assert.notEqual(app.exitCode, null, "Saved document should close without prompting");
  console.log("PASS saved document closes cleanly");
} finally {
  await browser?.close().catch(() => {});
  if (app.exitCode === null) app.kill();
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
