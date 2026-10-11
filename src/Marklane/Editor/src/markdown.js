import { parser, GFM } from "@lezer/markdown";

const markdownParser = parser.configure(GFM);

// An independent full parse makes the outline reliable even beyond the visible editor viewport.
export function documentStats(text) {
  const headings = [];
  markdownParser.parse(text).iterate({
    enter(node) {
      const match = /^(?:ATX|Setext)Heading([1-6])$/.exec(node.name);
      if (!match) return;
      const raw = text.slice(node.from, node.to);
      const title = raw.split("\n")[0].replace(/^#{1,6}\s+/, "").replace(/\s+#+\s*$/, "")
        .replace(/!?(?:\[([^\]]+)\])\([^)]*\)/g, "$1").replace(/[*_`~]/g, "").trim();
      headings.push({ title: title || "Untitled heading", position: node.from, level: Number(match[1]) });
    }
  });
  const words = [...new Intl.Segmenter(undefined, { granularity: "word" }).segment(text)]
    .filter(segment => segment.isWordLike).length;
  return { words, headings };
}

export function wrapSelection(text, from, to, marker, placeholder) {
  const selected = text.slice(from, to);
  if (from >= marker.length && text.slice(from - marker.length, from) === marker && text.slice(to, to + marker.length) === marker) {
    return { from: from - marker.length, to: to + marker.length, insert: selected, anchor: from - marker.length, head: to - marker.length };
  }
  const content = selected || placeholder;
  return { from, to, insert: marker + content + marker, anchor: from + marker.length, head: from + marker.length + content.length };
}
