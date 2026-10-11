// Runs against the real WinUI executable with an isolated WebView2 profile and scratch document.
import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

const executable = resolve(process.argv[2] || "../bin/x64/Debug/net10.0-windows10.0.19041.0/win-x64/Marklane.exe");
const directory = await mkdtemp(join(process.env.LOCALAPPDATA, "Temp", "opencode", "marklane-smoke-"));
const documentPath = join(directory, "Smoke.md");
await writeFile(documentPath, "# Native smoke\r\n\r\nOriginal text.\r\n");
const portServer = createServer();
await new Promise(resolve => portServer.listen(0, "127.0.0.1", resolve));
const port = portServer.address().port;
await new Promise(resolve => portServer.close(resolve));
const app = spawn(executable, [documentPath], {
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, WEBVIEW2_USER_DATA_FOLDER: join(directory, "profile") },
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
  await page.waitForFunction(() => window.marklane?.getText().includes("Original text."));
  assert.equal(await page.evaluate(() => window.marklane.getText()), "# Native smoke\n\nOriginal text.\n");
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
  assert.equal(saved, "# Native smoke\r\n\r\nOriginal text.\r\nA native save.\r\n");
  console.log("PASS native open → edit → Ctrl+S → CRLF file on disk");

  await page.keyboard.press("Control+/");
  await page.waitForFunction(() => document.body.classList.contains("source-mode"));
  await page.keyboard.press("Control+/");
  await page.waitForFunction(() => !document.body.classList.contains("source-mode"));
  console.log("PASS native source-mode command round trip");

  await page.keyboard.insertText("Unsaved edit");
  powershell(`(Get-Process -Id ${app.pid}).CloseMainWindow() | Out-Null`);
  const automation = `Add-Type -AssemblyName UIAutomationClient; $root = [System.Windows.Automation.AutomationElement]::FromHandle((Get-Process -Id ${app.pid}).MainWindowHandle); `;
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
