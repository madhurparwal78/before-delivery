// A small XML reader for the SpreadsheetML parts an import needs. No DTDs or entities beyond the five
// predefined ones and character references, so nothing external is ever resolved.

export interface XmlElement {
  name: string; // local name, without namespace prefix
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e.startsWith("#x")) return String.fromCodePoint(parseInt(e.slice(2), 16));
    if (e.startsWith("#")) return String.fromCodePoint(Number(e.slice(1)));
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[e] as string;
  });
}

const localName = (qualified: string): string => qualified.slice(qualified.indexOf(":") + 1);

export function parseXml(source: string): XmlElement {
  const root: XmlElement = { name: "#document", attrs: {}, children: [], text: "" };
  const stack = [root];
  const tag = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([^\s/>]+)((?:\s+[^\s=]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (let m = tag.exec(source); m; m = tag.exec(source)) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) top.text += m[1];
    else if (m[6] !== undefined) top.text += decode(m[6]);
    else if (m[3] !== undefined) {
      if (m[2] === "/") {
        if (stack.length > 1) stack.pop();
        continue;
      }
      const attrs: Record<string, string> = {};
      for (const a of (m[4] ?? "").matchAll(/([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) attrs[localName(a[1])] = decode(a[2] ?? a[3] ?? "");
      const el: XmlElement = { name: localName(m[3]), attrs, children: [], text: "" };
      top.children.push(el);
      if (m[5] !== "/") stack.push(el);
    }
  }
  return root;
}

export function child(el: XmlElement | undefined, name: string): XmlElement | undefined {
  return el?.children.find((c) => c.name === name);
}

export function children(el: XmlElement | undefined, name: string): XmlElement[] {
  return el ? el.children.filter((c) => c.name === name) : [];
}

/** All text below an element, as for a rich-text shared string. */
export function deepText(el: XmlElement): string {
  return el.name === "t" ? el.text : el.children.map(deepText).join("");
}

/** Escapes text for XML, dropping the control characters XML 1.0 cannot carry. */
export function escapeXml(text: string): string {
  return text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}
