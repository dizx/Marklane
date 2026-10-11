import test from "node:test";
import assert from "node:assert/strict";
import { documentStats, wrapSelection } from "../src/markdown.js";

test("outline recognizes ATX/setext but excludes headings inside code fences", () => {
  const text = "# Title\n\n```md\n# Not a heading\n```\n\nSecond\n------\n\n### **Third**\n";
  assert.deepEqual(documentStats(text).headings, [
    { title: "Title", level: 1, position: 0 },
    { title: "Second", level: 2, position: text.indexOf("Second") },
    { title: "Third", level: 3, position: text.indexOf("###") }
  ]);
});

test("formatting can be toggled without modifying surrounding content", () => {
  const text = "Before **hello** after";
  const edit = wrapSelection(text, 9, 14, "**", "bold");
  assert.equal(text.slice(0, edit.from) + edit.insert + text.slice(edit.to), "Before hello after");
  const add = wrapSelection("hello", 0, 5, "**", "bold");
  assert.equal(add.insert, "**hello**");
  assert.equal(add.anchor, 2);
  assert.equal(add.head, 7);
});

test("word counts include Unicode words and exclude punctuation", () => {
  assert.equal(documentStats("Hello, world! Æble 🌳").words, 3);
  assert.equal(documentStats("").words, 0);
});
