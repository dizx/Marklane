// Exercises welcome/dirty state and the real native recent-files menu in an isolated profile.
import { chromium } from "@playwright/test";
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

const executable = resolve(process.argv[2] || "../bin/x64/Debug/net10.0-windows10.0.19041.0/win-x64/Marklane.exe");
const directory = await mkdtemp(join(process.env.LOCALAPPDATA, "Temp", "opencode", "marklane-documents-"));
const settingsDirectory = join(directory, "settings");
const historyPath = join(settingsDirectory, "recent-files.json");
const firstPath = join(directory, "First.md");
const secondPath = join(directory, "Second.md");
const missingPath = join(directory, "Missing.md");
const firstText = "# First\n\nFirst document.\n";
const secondText = "# Second\n\nSecond document.\n";
await mkdir(settingsDirectory);
await writeFile(firstPath, firstText.replaceAll("\n", "\r\n"));
await writeFile(secondPath, secondText.replaceAll("\n", "\r\n"));
await writeFile(historyPath, JSON.stringify([firstPath, secondPath, missingPath]));
let app, browser, page;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const history = async () => JSON.parse(await readFile(historyPath, "utf8"));
const powershell = script => execFileSync("powershell.exe", ["-NoProfile", "-Command", script], { encoding: "utf8" });
const automation = () => `Add-Type -AssemblyName UIAutomationClient; $root = [System.Windows.Automation.AutomationElement]::FromHandle((Get-Process -Id ${app.pid}).MainWindowHandle); `;
const names = () => powershell(automation() + `$root.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition) | ForEach-Object { $_.Current.Name }`);

function invoke(value, property = "Name", expand = false) {
  const quoted = value.replaceAll("'", "''");
  const action = expand
    ? `([System.Windows.Automation.ExpandCollapsePattern]$item.GetCurrentPattern([System.Windows.Automation.ExpandCollapsePattern]::Pattern)).Expand()`
    : `([System.Windows.Automation.InvokePattern]$item.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)).Invoke()`;
  powershell(automation() + `$item = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, (New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::${property}Property, '${quoted}'))); if ($null -eq $item) { throw 'Control not found: ${quoted}' }; ${action};`);
}

async function waitFor(check, description) {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(description);
}

async function start() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  app = spawn(executable, [], {
    env: { ...process.env, MARKLANE_DATA_DIRECTORY: settingsDirectory, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`, WEBVIEW2_USER_DATA_FOLDER: join(directory, "profile") },
    stdio: "ignore"
  });
  await waitFor(async () => {
    if (app.exitCode !== null) throw new Error(`Marklane exited with ${app.exitCode}`);
    try { return (await fetch(`http://127.0.0.1:${port}/json/version`)).ok; } catch { return false; }
  }, "Native editor did not start");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => window.marklane?.getText().includes("Welcome to **Marklane**"));
}

async function recentMenu() {
  invoke("File", "Name", true);
  invoke("RecentFilesMenu", "AutomationId", true);
}

async function openRecent(index, expected) {
  await recentMenu();
  invoke(`RecentFile${index}`, "AutomationId");
  if (expected !== undefined) {
    await page.waitForFunction(text => window.marklane.getText() === text, expected);
    await waitFor(() => !names().includes("Recent files"), "Recent-files menu did not finish closing");
  }
}

async function dismissDialog(button) {
  invoke(button);
  await waitFor(() => {
    const visible = names();
    return !visible.includes("Save your changes?") && !visible.includes("Couldn't complete that action");
  }, "Dialog did not close");
  await page.locator(".cm-content").focus();
}

async function closeClean() {
  powershell(`(Get-Process -Id ${app.pid}).CloseMainWindow() | Out-Null`);
  await waitFor(() => app.exitCode !== null, "Unchanged document unexpectedly prevented closing");
  await browser.close().catch(() => {});
  browser = null;
}

try {
  await start();
  await openRecent(0, firstText);
  await openRecent(1, secondText);
  assert.deepEqual(await history(), [secondPath, firstPath, missingPath]);
  console.log("PASS untouched welcome and opened documents switch without a save prompt");

  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("Unsaved edit");
  await openRecent(1);
  await waitFor(() => names().includes("Save your changes?"), "Modified document did not prompt before opening a recent file");
  await dismissDialog("Cancel");
  assert.equal(await page.evaluate(() => window.marklane.getText()), secondText + "Unsaved edit");
  assert.deepEqual(await history(), [secondPath, firstPath, missingPath]);
  await page.keyboard.press("Control+z");
  await openRecent(1, firstText);
  console.log("PASS cancel preserves edits and undo restores a clean document");

  await openRecent(2);
  await waitFor(() => names().includes("Couldn't complete that action"), "Missing file did not show an error");
  await dismissDialog("OK");
  await waitFor(async () => (await history()).length === 2, "Missing recent file was not removed");
  assert.equal(await page.evaluate(() => window.marklane.getText()), firstText);
  console.log("PASS missing recent file is removed without replacing the current document");

  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("Saved addition");
  await page.keyboard.press("Control+s");
  await waitFor(async () => (await readFile(firstPath, "utf8")).includes("Saved addition"), "Save did not reach disk");
  assert.deepEqual(await history(), [firstPath, secondPath]);
  await closeClean();

  await start();
  await openRecent(1, secondText);
  assert.deepEqual(await history(), [secondPath, firstPath]);
  await recentMenu();
  invoke("Clear recent files");
  await waitFor(async () => (await history()).length === 0, "Clear recent files did not persist");
  assert.equal(await page.evaluate(() => window.marklane.getText()), secondText);
  assert.equal(await readFile(secondPath, "utf8"), secondText.replaceAll("\n", "\r\n"));
  console.log("PASS recent files survive restart and clearing history preserves documents");

  await page.locator(".cm-content").focus();
  await page.keyboard.press("Control+n");
  await page.waitForFunction(() => window.marklane.getText() === "");
  await page.keyboard.insertText("A new note");
  await page.keyboard.press("Control+n");
  await waitFor(() => names().includes("Save your changes?"), "New edited document did not prompt");
  await dismissDialog("Cancel");
  assert.equal(await page.evaluate(() => window.marklane.getText()), "A new note");
  await page.keyboard.press("Control+n");
  await waitFor(() => names().includes("Save your changes?"), "Discard prompt missing");
  await dismissDialog("Don't save");
  await page.waitForFunction(() => window.marklane.getText() === "");
  await closeClean();
  console.log("PASS genuinely edited new documents still require save/discard confirmation");
} finally {
  await browser?.close().catch(() => {});
  if (app && app.exitCode === null) app.kill();
  await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
}
