import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

let browser, server, page, url, errors;
const sample = "# Hello Marklane\n\nA **bold** idea and *italic* text with `code`.\n\n- [ ] A task\n\n| Name | Value |\n| --- | --- |\n| One | Two |\n\n```md\n# Literal code\n```\n\nEnd.\n";
before(async () => {
  server = createServer(async (request, response) => {
    const file = request.url === "/" ? "index.html" : request.url.slice(1);
    if (!["index.html", "editor.js", "editor.css"].includes(file)) { response.writeHead(404).end(); return; }
    response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
    response.end(await readFile(new URL(`../dist/${file}`, import.meta.url)));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  url = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: "msedge", headless: true });
});
after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });
beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 1000, height: 1100 } });
  errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(() => {
    window.messages = [];
    window.chrome = { webview: { postMessage: message => window.messages.push(message), addEventListener: () => {} } };
  });
  await page.goto(url);
  await page.waitForFunction(() => window.marklane);
  await page.evaluate(text => window.marklane.receive({ type: "load", text }), sample);
});
afterEach(async () => { await page.close(); assert.deepEqual(errors, []); });

test("live preview renders syntax, tasks and tables without rewriting Markdown", async () => {
  assert.equal(await page.locator(".md-strong").innerText(), "bold");
  assert.equal(await page.locator(".md-emphasis").innerText(), "italic");
  assert.equal(await page.locator(".md-task").count(), 1);
  assert.equal(await page.locator(".md-table td").first().innerText(), "One");
  assert.equal(await page.evaluate(() => window.marklane.getText()), sample);
  await page.evaluate(() => window.marklane.receive({ type: "source", enabled: true }));
  assert.equal(await page.locator(".md-table").count(), 0);
  assert.match(await page.locator(".cm-content").innerText(), /\*\*bold\*\*/);
  await page.evaluate(() => window.marklane.receive({ type: "source", enabled: false }));
  assert.equal(await page.evaluate(() => window.marklane.getText()), sample);
});

test("clicking a rendered table reveals editable source", async () => {
  await page.locator(".md-table td").first().click();
  assert.equal(await page.locator(".md-table").count(), 0);
  assert.match(await page.locator(".cm-content").innerText(), /\| Name \| Value \|/);
  assert.equal(await page.evaluate(() => window.marklane.getText()), sample);
});

test("task toggles change only the task marker and support undo", async () => {
  await page.locator(".md-task").check();
  assert.equal(await page.evaluate(() => window.marklane.getText()), sample.replace("[ ]", "[x]"));
  await page.evaluate(() => window.marklane.receive({ type: "command", command: "undo" }));
  assert.equal(await page.evaluate(() => window.marklane.getText()), sample);
});

test("typing, bold, undo, find and host shortcuts work", async () => {
  await page.evaluate(() => window.marklane.receive({ type: "load", text: "" }));
  await page.locator(".cm-content").pressSequentially("My thought");
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Control+b");
  assert.equal(await page.evaluate(() => window.marklane.getText()), "**My thought**");
  await page.keyboard.press("Control+z");
  assert.equal(await page.evaluate(() => window.marklane.getText()), "My thought");
  await page.keyboard.press("Control+f");
  assert.equal(await page.locator(".cm-search").count(), 1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+s");
  assert.equal(await page.evaluate(() => window.messages.some(message => message.command === "save")), true);
});

test("theme, focus and outline navigation preserve document and report real headings", async () => {
  await page.evaluate(() => {
    window.marklane.receive({ type: "theme", dark: true });
    window.marklane.receive({ type: "focus", enabled: true });
    window.marklane.receive({ type: "jump", position: 0 });
  });
  await page.waitForFunction(() => window.messages.some(message => message.type === "stats"));
  const headings = await page.evaluate(() => window.messages.findLast(message => message.type === "stats").headings);
  assert.deepEqual(headings.map(heading => heading.title), ["Hello Marklane"]);
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  assert.match(await page.locator("body").getAttribute("class"), /focus-mode/);
  assert.equal(await page.evaluate(() => window.marklane.getText()), sample);
});
