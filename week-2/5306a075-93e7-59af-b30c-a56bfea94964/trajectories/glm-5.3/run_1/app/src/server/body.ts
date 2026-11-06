import { createDocument } from "domino";

const DROP_WITH_CONTENT = new Set([
  "script",
  "style",
  "iframe",
  "object",
  "embed",
  "template",
  "noscript",
  "svg",
  "math",
]);

const KEEP_ELEMENTS = new Set([
  "p",
  "br",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "ul",
  "ol",
  "li",
  "blockquote",
  "code",
  "pre",
  "a",
]);

const BLOCK_ELEMENTS = new Set(["p", "li", "blockquote", "pre"]);

function isAllowedHref(value: string): boolean {
  const v = value.toLowerCase();
  return v.startsWith("http://") || v.startsWith("https://") || v.startsWith("mailto:");
}

const LINK_REL = "noopener noreferrer nofollow";

function parseBody(html: string): Document {
  return createDocument(
    `<!doctype html><html><head></head><body>${html}</body></html>`,
    true,
  );
}

/** Reduce a submitted HTML fragment to the note allowlist (DP-02). */
export function allowlistBody(html: string): string {
  const doc = parseBody(html);
  const body = doc.body;
  if (!body) return "";

  const removeComments = (root: Node): void => {
    for (const child of Array.from(root.childNodes)) {
      if (child.nodeType === 8) {
        root.removeChild(child);
      } else if (child.nodeType === 1) {
        removeComments(child);
      }
    }
  };
  removeComments(body);

  const processSelf = (node: Node): void => {
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.localName?.toLowerCase() ?? "";
    if (DROP_WITH_CONTENT.has(tag)) {
      el.parentNode?.removeChild(el);
      return;
    }
    if (KEEP_ELEMENTS.has(tag)) {
      if (tag === "a") {
        const href = el.getAttribute("href");
        for (const attr of Array.from(el.attributes)) {
          el.removeAttribute(attr.name);
        }
        if (href !== null && isAllowedHref(href)) {
          el.setAttribute("href", href);
          el.setAttribute("rel", LINK_REL);
        }
      } else {
        for (const attr of Array.from(el.attributes)) {
          el.removeAttribute(attr.name);
        }
      }
      for (const child of Array.from(el.childNodes)) processSelf(child);
      return;
    }
    // Unwrap: hoist the children, keeping the text, and process them in place.
    const parent = el.parentNode;
    if (parent === null) return;
    const frag = doc.createDocumentFragment();
    const hoisted: Node[] = [];
    for (const n of Array.from(el.childNodes)) {
      frag.appendChild(n);
      hoisted.push(n);
    }
    parent.replaceChild(frag, el);
    for (const n of hoisted) processSelf(n);
  };
  for (const child of Array.from(body.childNodes)) processSelf(child);

  return body.innerHTML;
}

/** Escape a plain string as HTML body content. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const COLLAPSE_RE = /\s+/g;

function isBlock(el: Element): boolean {
  return BLOCK_ELEMENTS.has(el.localName.toLowerCase());
}

/**
 * The note's plain text: each line break and each boundary between block
 * elements becomes exactly one newline, runs of whitespace collapse outside
 * `pre`, blocks are trimmed, and there is no leading or trailing newline.
 */
export function bodyToText(body: string): string {
  const doc = parseBody(body);
  const bodyEl = doc.body;
  if (!bodyEl) return "";

  const out: string[] = [];
  let pendingBreak = false;
  let atBlockStart = true;

  const pushText = (s: string): void => {
    if (s.length === 0) return;
    if (pendingBreak) {
      out.push("\n");
      pendingBreak = false;
    }
    out.push(s);
  };

  const emit = (node: Node, inPre: boolean): void => {
    if (node.nodeType === 3) {
      const raw = node.nodeValue ?? "";
      if (inPre) {
        pushText(raw);
        return;
      }
      const collapsed = raw.replace(COLLAPSE_RE, " ");
      if (collapsed === " ") {
        if (!atBlockStart) pushText(" ");
        return;
      }
      if (collapsed === "") return;
      pushText(collapsed);
      atBlockStart = false;
      return;
    }
    if (node.nodeType !== 1) return;
    const el = node as Element;
    const tag = el.localName.toLowerCase();
    if (tag === "br") {
      if (!atBlockStart) pendingBreak = true;
      return;
    }
    const block = isBlock(el);
    if (block && !atBlockStart) pendingBreak = true;
    const nextInPre = inPre || tag === "pre";
    const before = out.length;
    for (const child of Array.from(el.childNodes)) emit(child, nextInPre);
    if (block) {
      atBlockStart = true;
      pendingBreak = false;
      if (el.nextSibling !== null && out.length > before) pendingBreak = true;
    }
  };

  for (const child of Array.from(bodyEl.childNodes)) emit(child, false);
  return out.join("").trim();
}

/** Wrap plain text as a single-paragraph body (used by the seed and the import). */
export function plainTextToBody(text: string): string {
  return `<p>${escapeHtml(text)}</p>`;
}
