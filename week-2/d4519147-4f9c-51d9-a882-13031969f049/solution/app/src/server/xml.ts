/**
 * A small, bounded XML reader for imports. It never expands an entity and never fetches anything.
 * Parse limits are judged while reading, before any safety check.
 */

/** The W3C SVG namespace (SVG 1.1 and SVG 2): the namespace the brief requires of an SVG import root and an export. */
export const SVG_NS = "http://www.w3.org/2000/svg";

const PARSE_LIMITS = { depth: 64, elements: 20_000, attributes: 64, text: 10_000 } as const;

export interface XmlAttr {
  qname: string;
  prefix: string | null;
  local: string;
  value: string;
}

export interface XmlElement {
  qname: string;
  prefix: string | null;
  local: string;
  ns: string | null;
  attrs: XmlAttr[];
  children: XmlNode[];
}

export type XmlNode = XmlElement | { text: string };

export interface ParsedXml {
  root: XmlElement;
  /** A DOCTYPE declaration was present (its subset is skipped, never expanded). */
  doctype: boolean;
  /** A processing instruction other than the opening XML declaration was present. */
  processingInstruction: boolean;
}

/** Not well-formed UTF-8 XML, or the root is neither `diagram` nor SVG `svg`. */
export class NotDiagramXml extends Error {}
/** A parse limit was exceeded. */
export class ParseLimitExceeded extends Error {}

const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

function splitName(qname: string): { prefix: string | null; local: string } {
  const colon = qname.indexOf(":");
  return colon > 0 ? { prefix: qname.slice(0, colon), local: qname.slice(colon + 1) } : { prefix: null, local: qname };
}

export function isElement(node: XmlNode): node is XmlElement {
  return "local" in node;
}

export function textOf(element: XmlElement): string {
  return element.children.map((c) => (isElement(c) ? textOf(c) : c.text)).join("");
}

export function parseXml(bytes: Buffer): ParsedXml {
  let source: string;
  try {
    source = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
  } catch {
    throw new NotDiagramXml();
  }
  return new Reader(source).document();
}

class Reader {
  private i = 0;
  private elements = 0;
  private doctype = false;
  private pi = false;

  constructor(private readonly s: string) {}

  private fail(): never {
    throw new NotDiagramXml();
  }

  private startsWith(token: string): boolean {
    return this.s.startsWith(token, this.i);
  }

  private skipSpace(): void {
    while (this.i < this.s.length && /\s/.test(this.s[this.i]!)) this.i++;
  }

  private skipPast(token: string): void {
    const at = this.s.indexOf(token, this.i);
    if (at === -1) this.fail();
    this.i = at + token.length;
  }

  private name(): string {
    const start = this.i;
    while (this.i < this.s.length && !/[\s/>=<"'?]/.test(this.s[this.i]!)) this.i++;
    const name = this.s.slice(start, this.i);
    if (!/^[\p{L}_:][\p{L}\p{N}._:\-·]*$/u.test(name)) this.fail();
    return name;
  }

  /** Skips a DOCTYPE, including its internal subset, without interpreting any declaration. */
  private skipDoctype(): void {
    this.doctype = true;
    let depth = 0;
    while (this.i < this.s.length) {
      const ch = this.s[this.i]!;
      if (ch === '"' || ch === "'") {
        const end = this.s.indexOf(ch, this.i + 1);
        if (end === -1) this.fail();
        this.i = end + 1;
        continue;
      }
      if (this.startsWith("<!--")) {
        this.skipPast("-->");
        continue;
      }
      if (ch === "[") depth++;
      else if (ch === "]") depth--;
      else if (ch === ">" && depth === 0) {
        this.i++;
        return;
      }
      this.i++;
    }
    this.fail();
  }

  private miscellany(): void {
    for (;;) {
      this.skipSpace();
      if (this.startsWith("<!--")) this.skipPast("-->");
      else if (this.startsWith("<?")) {
        this.pi = true;
        this.skipPast("?>");
      } else return;
    }
  }

  private decode(raw: string): string {
    if (!raw.includes("&")) return raw;
    return raw.replace(/&([^;&\s]*);?/g, (match, body: string) => {
      if (!match.endsWith(";")) this.fail();
      if (body.startsWith("#x") || body.startsWith("#X")) {
        const code = Number.parseInt(body.slice(2), 16);
        if (!/^[0-9a-fA-F]+$/.test(body.slice(2)) || code > 0x10ffff) this.fail();
        return String.fromCodePoint(code);
      }
      if (body.startsWith("#")) {
        const code = Number(body.slice(1));
        if (!/^[0-9]+$/.test(body.slice(1)) || code > 0x10ffff) this.fail();
        return String.fromCodePoint(code);
      }
      const known = PREDEFINED[body];
      if (known !== undefined) return known;
      if (this.doctype) return match;
      return this.fail();
    });
  }

  document(): ParsedXml {
    if (this.s.charCodeAt(0) === 0xfeff) this.i = 1;
    this.skipSpace();
    if (this.startsWith("<?xml") && /[\s?]/.test(this.s[this.i + 5] ?? "")) this.skipPast("?>");
    this.miscellany();
    if (this.startsWith("<!DOCTYPE")) {
      this.i += 9;
      this.skipDoctype();
      this.miscellany();
    }
    if (!this.startsWith("<") || this.startsWith("</") || this.startsWith("<!")) this.fail();
    const root = this.element();
    this.miscellany();
    if (this.i < this.s.length) this.fail();
    return { root, doctype: this.doctype, processingInstruction: this.pi };
  }

  private element(): XmlElement {
    type Frame = { el: XmlElement; scope: Map<string, string | null> };
    const stack: Frame[] = [];
    let root: XmlElement | null = null;
    let text = "";
    const flushText = () => {
      if (text && stack.length) stack[stack.length - 1]!.el.children.push({ text });
      text = "";
    };
    const addText = (chunk: string) => {
      text += chunk;
      if (text.length > PARSE_LIMITS.text) throw new ParseLimitExceeded();
    };
    do {
      if (this.i >= this.s.length) this.fail();
      if (this.s[this.i] !== "<") {
        const next = this.s.indexOf("<", this.i);
        const end = next === -1 ? this.s.length : next;
        const raw = this.s.slice(this.i, end);
        this.i = end;
        if (raw.length > PARSE_LIMITS.text * 12) throw new ParseLimitExceeded();
        addText(this.decode(raw));
        continue;
      }
      if (this.startsWith("<!--")) {
        flushText();
        this.skipPast("-->");
        continue;
      }
      if (this.startsWith("<![CDATA[")) {
        const end = this.s.indexOf("]]>", this.i + 9);
        if (end === -1) this.fail();
        addText(this.s.slice(this.i + 9, end));
        this.i = end + 3;
        continue;
      }
      if (this.startsWith("<?")) {
        flushText();
        this.pi = true;
        this.skipPast("?>");
        continue;
      }
      if (this.startsWith("<!")) this.fail();
      flushText();
      if (this.startsWith("</")) {
        this.i += 2;
        const qname = this.name();
        this.skipSpace();
        if (this.s[this.i] !== ">") this.fail();
        this.i++;
        const frame = stack.pop();
        if (!frame || frame.el.qname !== qname) this.fail();
        continue;
      }
      this.i++;
      const qname = this.name();
      if (stack.length + 1 > PARSE_LIMITS.depth) throw new ParseLimitExceeded();
      if (++this.elements > PARSE_LIMITS.elements) throw new ParseLimitExceeded();
      const attrs: XmlAttr[] = [];
      const seen = new Set<string>();
      let selfClosing = false;
      for (;;) {
        const before = this.i;
        this.skipSpace();
        if (this.startsWith("/>")) {
          this.i += 2;
          selfClosing = true;
          break;
        }
        if (this.startsWith(">")) {
          this.i++;
          break;
        }
        if (this.i === before) this.fail();
        const attrName = this.name();
        this.skipSpace();
        if (this.s[this.i] !== "=") this.fail();
        this.i++;
        this.skipSpace();
        const quote = this.s[this.i];
        if (quote !== '"' && quote !== "'") this.fail();
        const end = this.s.indexOf(quote, this.i + 1);
        if (end === -1) this.fail();
        const raw = this.s.slice(this.i + 1, end);
        if (raw.includes("<")) this.fail();
        this.i = end + 1;
        if (seen.has(attrName)) this.fail();
        seen.add(attrName);
        if (attrs.length + 1 > PARSE_LIMITS.attributes) throw new ParseLimitExceeded();
        if (raw.length > PARSE_LIMITS.text * 12) throw new ParseLimitExceeded();
        const value = this.decode(raw);
        if (value.length > PARSE_LIMITS.text) throw new ParseLimitExceeded();
        attrs.push({ qname: attrName, ...splitName(attrName), value });
      }
      const parentScope = stack.length ? stack[stack.length - 1]!.scope : new Map<string, string | null>([["xml", "http://www.w3.org/XML/1998/namespace"]]);
      let scope = parentScope;
      for (const a of attrs) {
        if (a.qname === "xmlns" || a.prefix === "xmlns") {
          if (scope === parentScope) scope = new Map(parentScope);
          scope.set(a.qname === "xmlns" ? "" : a.local, a.value || null);
        }
      }
      const { prefix, local } = splitName(qname);
      const key = prefix ?? "";
      if (prefix !== null && !scope.has(key)) this.fail();
      const el: XmlElement = { qname, prefix, local, ns: scope.get(key) ?? null, attrs, children: [] };
      if (stack.length) stack[stack.length - 1]!.el.children.push(el);
      else if (root) this.fail();
      else {
        root = el;
        if (!((local === "diagram" && el.ns === null) || (local === "svg" && el.ns === SVG_NS))) this.fail();
      }
      if (!selfClosing) stack.push({ el, scope });
    } while (stack.length);
    return root!;
  }
}
