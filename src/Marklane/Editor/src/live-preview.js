import { StateField, StateEffect } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";
import { syntaxTree } from "@codemirror/language";
import MarkdownIt from "markdown-it";

export const setSource = StateEffect.define();
export const sourceState = StateField.define({
  create: () => false,
  update(value, transaction) {
    for (const effect of transaction.effects) if (effect.is(setSource)) value = effect.value;
    return value;
  }
});

const renderer = new MarkdownIt({ html: false, linkify: false, typographer: false });

class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "md-bullet";
    span.textContent = "•";
    return span;
  }
}

class TaskWidget extends WidgetType {
  constructor(checked, position) { super(); this.checked = checked; this.position = position; }
  eq(other) { return this.checked === other.checked && this.position === other.position; }
  toDOM(view) {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "md-task";
    input.checked = this.checked;
    input.setAttribute("aria-label", "Toggle task");
    input.addEventListener("mousedown", event => event.preventDefault());
    input.addEventListener("change", () => {
      view.dispatch({ changes: { from: this.position, to: this.position + 3, insert: this.checked ? "[ ]" : "[x]" } });
    });
    return input;
  }
  ignoreEvent() { return true; }
}

class BlockWidget extends WidgetType {
  constructor(source, position, kind) { super(); this.source = source; this.position = position; this.kind = kind; }
  eq(other) { return this.source === other.source && this.position === other.position && this.kind === other.kind; }
  toDOM(view) {
    const container = document.createElement("div");
    container.className = `md-rendered-block md-${this.kind}`;
    container.innerHTML = this.kind === "rule" ? "<hr>" : renderer.render(this.source);
    container.title = "Click to edit Markdown";
    container.addEventListener("mousedown", event => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.position }, scrollIntoView: true });
      view.focus();
    });
    return container;
  }
  ignoreEvent() { return true; }
}

export function buildDecorations(state) {
  if (state.field(sourceState)) return Decoration.none;
  const ranges = [];
  const active = state.selection.ranges.map(range => ({
    from: state.doc.lineAt(range.from).from,
    to: state.doc.lineAt(range.to).to
  }));
  const isActive = (from, to) => active.some(range => from <= range.to && to >= range.from);
  const hide = (from, to) => { if (to > from) ranges.push(Decoration.replace({}).range(from, to)); };
  const mark = (from, to, name) => { if (to > from) ranges.push(Decoration.mark({ class: name }).range(from, to)); };
  const line = (position, name) => ranges.push(Decoration.line({ class: name }).range(state.doc.lineAt(position).from));
  syntaxTree(state).iterate({
    enter(node) {
      const { name, from, to } = node;
      const focused = isActive(from, to);
      const heading = /^(?:ATX|Setext)Heading([1-6])$/.exec(name);
      if (heading) line(from, `md-heading md-h${heading[1]}`);
      if (name === "StrongEmphasis") mark(from, to, "md-strong");
      if (name === "Emphasis") mark(from, to, "md-emphasis");
      if (name === "Strikethrough") mark(from, to, "md-strike");
      if (name === "InlineCode") mark(from, to, "md-inline-code");
      if (name === "Link") mark(from, to, "md-link");
      if ((name === "Table" || name === "HorizontalRule") && !focused) {
        ranges.push(Decoration.replace({ block: true, widget: new BlockWidget(state.doc.sliceString(from, to), from, name === "Table" ? "table" : "rule") }).range(from, to));
        return false;
      }
      if (name === "FencedCode" || name === "CodeBlock") {
        for (let n = state.doc.lineAt(from).number; n <= state.doc.lineAt(to).number; n++) line(state.doc.line(n).from, "md-code-line");
        // Keep code literal: Markdown-looking text inside code never gets rich-text decorations.
        if (name === "FencedCode" && !focused) {
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === "CodeMark" || child.name === "CodeInfo") hide(child.from, child.to);
          }
        }
        return false;
      }
      if (name === "QuoteMark") {
        line(from, "md-quote");
        if (!focused) hide(from, state.doc.sliceString(to, to + 1) === " " ? to + 1 : to);
      }
      if (name === "HeaderMark" && !focused) {
        hide(from, state.doc.sliceString(to, to + 1) === " " ? to + 1 : to);
      }
      if (["EmphasisMark", "StrikethroughMark", "CodeMark"].includes(name) && !focused) hide(from, to);
      if (name === "ListMark" && !focused && /^[-+*]$/.test(state.doc.sliceString(from, to))) {
        ranges.push(Decoration.replace({ widget: new BulletWidget() }).range(from, to));
      }
      if (name === "TaskMarker" && !focused) {
        ranges.push(Decoration.replace({ widget: new TaskWidget(/x/i.test(state.doc.sliceString(from, to)), from) }).range(from, to));
      }
      if (name === "Link" && !focused) {
        // Only inline links: references and their definitions remain editable source.
        const source = state.doc.sliceString(from, to);
        const boundary = source.lastIndexOf("](");
        if (source.startsWith("[") && boundary > 0 && source.endsWith(")")) {
          hide(from, from + 1);
          hide(from + boundary, to);
        }
        return false;
      }
    }
  });
  return Decoration.set(ranges, true);
}

export const livePreview = StateField.define({
  create: buildDecorations,
  update(value, transaction) {
    return transaction.docChanged || transaction.selection || transaction.effects.some(effect => effect.is(setSource)) || syntaxTree(transaction.startState) !== syntaxTree(transaction.state)
      ? buildDecorations(transaction.state) : value;
  },
  provide: field => EditorView.decorations.from(field)
});
