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

test("focus shortcuts reach the host and Escape closes search before exiting focus", async () => {
  await page.keyboard.press("Control+Shift+F");
  assert.ok(await page.evaluate(() => window.messages.some(message => message.command === "focus")));
  await page.evaluate(() => {
    window.messages.length = 0;
    window.marklane.receive({ type: "focus", enabled: true });
  });
  await page.keyboard.press("Control+f");
  await page.locator(".cm-search").waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.locator(".cm-search").count(), 0);
  assert.ok(await page.evaluate(() => !window.messages.some(message => message.command === "exitFocus")));
  await page.keyboard.press("Escape");
  assert.ok(await page.evaluate(() => window.messages.some(message => message.command === "exitFocus")));
  assert.equal(await page.evaluate(() => window.marklane.getText()), sample);
});

const csharpSample = [
  "# Night mode", "", "Readable notes, with color-coded code.", "", "```csharp",
  "using System;", "", "namespace Marklane.Notes;", "",
  "public sealed class Note", "{", "    // Keep your ideas close.",
  '    private readonly string title = "A fresh thought";',
  "    public int Count => 42;", "}", "```", "", "End."
].join("\n");

async function tokenColor(selector, text) {
  const token = page.locator(selector).filter({ hasText: text }).first();
  await token.waitFor();
  return token.evaluate(element => getComputedStyle(element).color);
}

test("night mode renders readable C# tokens on a charcoal code block", async () => {
  await page.evaluate(text => {
    window.marklane.receive({ type: "theme", dark: true });
    window.marklane.receive({ type: "load", text });
  }, csharpSample);
  assert.equal(await tokenColor(".md-code-line .syntax-keyword", /^using$/), "rgb(214, 163, 231)");
  assert.equal(await tokenColor(".md-code-line .syntax-type", /^string$/), "rgb(77, 224, 187)");
  assert.equal(await tokenColor(".md-code-line .syntax-definition", /^Note$/), "rgb(145, 167, 255)");
  assert.equal(await tokenColor(".md-code-line .syntax-string", /A fresh thought/), "rgb(255, 133, 122)");
  assert.equal(await tokenColor(".md-code-line .syntax-comment", /Keep your ideas/), "rgb(245, 163, 92)");
  assert.equal(await tokenColor(".md-code-line .syntax-literal", /^42$/), "rgb(245, 183, 115)");
  assert.equal(await page.locator("body").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(54, 59, 64)");
  assert.equal(await page.locator(".md-code-line").first().evaluate(element => getComputedStyle(element).backgroundColor), "rgb(48, 48, 48)");
  assert.equal(await page.evaluate(() => window.marklane.getText()), csharpSample);
  if (process.env.MARKLANE_NIGHT_SCREENSHOT) await page.screenshot({ path: process.env.MARKLANE_NIGHT_SCREENSHOT });
});

test("theme and source switches recolor code without changing text or undo history", async () => {
  await page.evaluate(text => window.marklane.receive({ type: "load", text }), csharpSample);
  const lightKeyword = await tokenColor(".syntax-keyword", /^using$/);
  assert.equal(lightKeyword, "rgb(128, 63, 160)");
  await page.evaluate(() => window.marklane.receive({ type: "theme", dark: true }));
  const darkKeyword = await tokenColor(".syntax-keyword", /^using$/);
  assert.notEqual(darkKeyword, lightKeyword);
  await page.evaluate(() => window.marklane.receive({ type: "source", enabled: true }));
  assert.equal(await tokenColor(".syntax-keyword", /^using$/), darkKeyword);
  assert.equal(await page.locator(".cm-gutters").evaluate(element => getComputedStyle(element).backgroundColor), "rgb(54, 59, 64)");
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText(" More.");
  await page.evaluate(() => {
    window.marklane.receive({ type: "source", enabled: false });
    window.marklane.receive({ type: "theme", dark: false });
  });
  assert.equal(await tokenColor(".syntax-keyword", /^using$/), lightKeyword);
  await page.keyboard.press("Control+z");
  assert.equal(await page.evaluate(() => window.marklane.getText()), csharpSample);
});

test("C# aliases, common languages and unknown labels are handled offline", async () => {
  const requests = [];
  page.on("request", request => requests.push(request.url()));
  for (const label of ["cs", "c#", "CSHARP"]) {
    const text = `Notes.\n\n\`\`\`${label}\npublic class Example {}\n\`\`\``;
    await page.evaluate(text => window.marklane.receive({ type: "load", text }), text);
    await page.locator(".md-code-line .syntax-keyword").first().waitFor();
    assert.equal(await page.evaluate(() => window.marklane.getText()), text);
  }
  for (const [label, code, selector] of [
    ["js", "const answer = 42;", ".syntax-keyword"],
    ["typescript", "const answer: number = 42;", ".syntax-keyword"],
    ["json", '{"answer": 42}', ".syntax-literal"],
    ["python", "def greet(): return 'Hello'", ".syntax-keyword"],
    ["sql", "SELECT * FROM notes;", ".syntax-keyword"],
    ["powershell", "# A PowerShell comment", ".syntax-comment"]
  ]) {
    const text = `Notes.\n\n\`\`\`${label}\n${code}\n\`\`\``;
    await page.evaluate(text => window.marklane.receive({ type: "load", text }), text);
    await page.locator(`.md-code-line ${selector}`).first().waitFor();
    assert.equal(await page.evaluate(() => window.marklane.getText()), text);
  }
  for (const label of ["", "not-csharp"]) {
    const text = `Notes.\n\n\`\`\`${label}\npublic class Example { string text = "literal"; }\n\`\`\``;
    await page.evaluate(text => window.marklane.receive({ type: "load", text }), text);
    assert.equal(await page.locator(".md-code-line .syntax-keyword, .md-code-line .syntax-string").count(), 0);
    assert.equal(await page.evaluate(() => window.marklane.getText()), text);
  }
  assert.deepEqual(requests, [], "Language parsers must be bundled; no runtime downloads");
});

test("typing into a C# fence updates highlighting and supports undo", async () => {
  const text = "Notes.\n\n```cs\n\n```";
  await page.evaluate(text => {
    window.marklane.receive({ type: "load", text });
    window.marklane.receive({ type: "jump", position: text.lastIndexOf("```") - 1 });
  }, text);
  await page.keyboard.insertText("public class NewNote {}");
  await page.locator(".md-code-line .syntax-definition").filter({ hasText: /^NewNote$/ }).waitFor();
  assert.match(await page.evaluate(() => window.marklane.getText()), /public class NewNote/);
  await page.keyboard.press("Control+z");
  assert.equal(await page.evaluate(() => window.marklane.getText()), text);
});
