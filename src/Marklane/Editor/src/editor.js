import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, drawSelection, highlightActiveLine, lineNumbers, placeholder } from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, undo, redo, indentWithTab } from "@codemirror/commands";
import { markdown, markdownKeymap } from "@codemirror/lang-markdown";
import { GFM } from "@lezer/markdown";
import { syntaxHighlighting, defaultHighlightStyle, bracketMatching } from "@codemirror/language";
import { search, searchKeymap, openSearchPanel } from "@codemirror/search";
import { sourceState, livePreview, setSource } from "./live-preview.js";
import { documentStats, wrapSelection } from "./markdown.js";

const mode = new Compartment();
let statsTimer;
let source = false;
const send = message => window.chrome?.webview?.postMessage(message);
const hostCommand = command => { send({ type: "command", command }); return true; };
const scheduleStats = () => {
  clearTimeout(statsTimer);
  statsTimer = setTimeout(() => send({ type: "stats", ...documentStats(view.state.doc.toString()) }), 180);
};

function wrap(marker, fallback) {
  const { from, to } = view.state.selection.main;
  const edit = wrapSelection(view.state.doc.toString(), from, to, marker, fallback);
  view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: { anchor: edit.anchor, head: edit.head }, userEvent: "input" });
  view.focus();
  return true;
}

function insert(value) {
  view.dispatch(view.state.replaceSelection(value), { userEvent: "input" });
  view.focus();
  return true;
}

function prefix(value) {
  const selection = view.state.selection.main;
  const first = view.state.doc.lineAt(selection.from).number;
  const last = view.state.doc.lineAt(selection.to).number;
  const changes = [];
  for (let n = first; n <= last; n++) changes.push({ from: view.state.doc.line(n).from, insert: value });
  view.dispatch({ changes, userEvent: "input" });
  view.focus();
  return true;
}

const commands = {
  undo: () => undo(view), redo: () => redo(view), find: () => openSearchPanel(view),
  bold: () => wrap("**", "bold text"), italic: () => wrap("*", "italic text"), code: () => wrap("`", "code"),
  heading: () => prefix("## "), bullet: () => prefix("- "), task: () => prefix("- [ ] "), quote: () => prefix("> "),
  link: () => {
    const { from, to } = view.state.selection.main;
    const label = view.state.sliceDoc(from, to) || "link text";
    const text = `[${label}](https://example.com)`;
    view.dispatch({ changes: { from, to, insert: text }, selection: { anchor: from + label.length + 3, head: from + text.length - 1 }, userEvent: "input" });
    view.focus();
    return true;
  },
  fence: () => insert("\n```\nYour code here\n```\n"),
  table: () => insert("\n| Heading | Heading |\n| --- | --- |\n| Cell | Cell |\n")
};

const bindings = [
  { key: "Mod-s", run: () => hostCommand("save") },
  { key: "Mod-Shift-s", run: () => hostCommand("saveAs") },
  { key: "Mod-o", run: () => hostCommand("open") },
  { key: "Mod-n", run: () => hostCommand("new") },
  { key: "Mod-/", run: () => hostCommand("source") },
  { key: "Mod-Shift-f", run: () => hostCommand("focus") },
  { key: "Mod-b", run: commands.bold }, { key: "Mod-i", run: commands.italic },
  { key: "Mod-k", run: commands.link },
  ...markdownKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab
];

function createState(text) {
  return EditorState.create({
    doc: text,
    extensions: [
      markdown({ extensions: GFM }), history(), drawSelection(), bracketMatching(),
      EditorView.lineWrapping, keymap.of(bindings), search({ top: true }),
      placeholder("A new page. A fresh thought."),
      sourceState.init(() => source), livePreview,
      mode.of(source ? [lineNumbers(), highlightActiveLine(), syntaxHighlighting(defaultHighlightStyle)] : []),
      EditorView.contentAttributes.of({ "aria-label": "Markdown document", spellcheck: "true" }),
      EditorView.updateListener.of(update => {
        if (update.docChanged) {
          send({ type: "change", text: update.state.doc.toString() });
          scheduleStats();
        }
      })
    ]
  });
}

const view = new EditorView({ state: createState(""), parent: document.getElementById("editor") });

function receive(message) {
  switch (message.type) {
    case "load":
      view.setState(createState(message.text));
      scheduleStats();
      view.focus();
      break;
    case "source":
      source = message.enabled;
      document.body.classList.toggle("source-mode", source);
      view.dispatch({ effects: [setSource.of(source), mode.reconfigure(source ? [lineNumbers(), highlightActiveLine(), syntaxHighlighting(defaultHighlightStyle)] : [])] });
      view.focus();
      break;
    case "theme": document.documentElement.dataset.theme = message.dark ? "dark" : "light"; break;
    case "focus": document.body.classList.toggle("focus-mode", message.enabled); view.focus(); break;
    case "jump": {
      const position = Math.max(0, Math.min(message.position, view.state.doc.length));
      view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: "start", yMargin: 32 }) });
      view.focus();
      break;
    }
    case "command": commands[message.command]?.(); break;
  }
}

window.chrome?.webview?.addEventListener("message", event => receive(event.data));
window.marklane = Object.freeze({ getText: () => view.state.doc.toString(), receive });
send({ type: "ready" });
