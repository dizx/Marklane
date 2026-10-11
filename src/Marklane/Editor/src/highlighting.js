import { HighlightStyle, LanguageDescription } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { tags } from "@lezer/highlight";

// Resolve explicit fence labels only. Unknown or unlabelled blocks remain plain text.
export function codeLanguage(info) {
  return LanguageDescription.matchLanguageName(languages, info, false);
}

// CSS variables keep the same parser tokens readable in either color theme.
export const codeHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword, class: "syntax-keyword" },
  { tag: [tags.typeName, tags.standard(tags.variableName)], class: "syntax-type" },
  { tag: [tags.className, tags.definition(tags.variableName), tags.function(tags.variableName), tags.function(tags.propertyName)], class: "syntax-definition" },
  { tag: [tags.string, tags.character], class: "syntax-string" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], class: "syntax-literal" },
  { tag: tags.comment, class: "syntax-comment" },
  { tag: [tags.meta, tags.annotation], class: "syntax-meta" },
  { tag: tags.tagName, class: "syntax-tag" },
  { tag: tags.attributeName, class: "syntax-attribute" },
  { tag: tags.regexp, class: "syntax-string" },
  { tag: tags.invalid, class: "syntax-invalid" }
]);

export const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, class: "syntax-heading" },
  { tag: [tags.link, tags.url], class: "syntax-link" },
  { tag: [tags.processingInstruction, tags.monospace], class: "syntax-markup" }
]);
