// The note body allowlist (brief: Business rules › Note body allowlist), applied on every save.
import { parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { isNoteTag, layoutNote, type NoteNode } from "../../shared/noteText.js";

type ParsedNode = DefaultTreeAdapterMap["childNode"];

const REMOVED_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math"]);
const SAFE_HREF = /^(https?:|mailto:)/i;
const LINK_REL = "noopener noreferrer nofollow";

function reduce(nodes: readonly ParsedNode[]): NoteNode[] {
  const out: NoteNode[] = [];
  for (const node of nodes) {
    if (node.nodeName === "#text" && "value" in node) {
      out.push({ type: "text", value: node.value });
    } else if ("tagName" in node) {
      if (REMOVED_WITH_CONTENT.has(node.tagName)) continue;
      const children = reduce(node.childNodes);
      if (isNoteTag(node.tagName)) {
        const href = node.tagName === "a" ? node.attrs.find((a) => a.name === "href")?.value ?? null : null;
        out.push({
          type: "element",
          tag: node.tagName,
          href: href !== null && SAFE_HREF.test(href) ? href : null,
          children: node.tagName === "br" ? [] : children,
        });
      } else {
        out.push(...children);
      }
    }
  }
  return out;
}

const escapeText = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/ /g, "&nbsp;");
const escapeAttr = (value: string): string => value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");

function serialize(nodes: readonly NoteNode[]): string {
  return nodes.map((node) => {
    if (node.type === "text") return escapeText(node.value);
    if (node.tag === "br") return "<br>";
    const open = node.tag === "a" && node.href !== null ? `<a href="${escapeAttr(node.href)}" rel="${LINK_REL}">` : `<${node.tag}>`;
    const first = node.children[0];
    const lead = node.tag === "pre" && first?.type === "text" && first.value.startsWith("\n") ? "\n" : "";
    return `${open}${lead}${serialize(node.children)}</${node.tag}>`;
  }).join("");
}

export interface CleanBody { body: string; text: string }

/**
 * Reduces any HTML to the allowlist. The reduced markup is parsed once more so the stored body, the
 * plain text and the browser's own reading of the body all describe the same tree.
 */
export function cleanBody(html: string): CleanBody {
  const first = serialize(reduce(parseFragment(html).childNodes));
  const tree = reduce(parseFragment(first).childNodes);
  return { body: serialize(tree), text: layoutNote(tree).text };
}

/** Imported feedback is plain text placed in one paragraph. */
export function paragraphOf(plain: string): string {
  return `<p>${escapeText(plain)}</p>`;
}
