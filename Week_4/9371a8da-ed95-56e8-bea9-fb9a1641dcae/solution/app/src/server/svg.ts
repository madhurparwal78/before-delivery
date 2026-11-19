// The SVG checks, run on the parsed XML: names by local name, values after decoding.
import { SaxesParser } from "saxes";

const FORBIDDEN_ELEMENTS = new Set(["script", "foreignobject"]);

/** Character references are already decoded by the parser; drop ASCII whitespace and controls, ignore case. */
function normalised(value: string): string {
  return value.replace(/[\u0000- \u007f]/g, "").toLowerCase();
}

function hasOutsideUrl(css: string): boolean {
  for (const match of css.matchAll(/url\(\s*(['"]?)([^)'"]*)/gi)) {
    if (!normalised(match[2] ?? "").startsWith("#")) return true;
  }
  return false;
}

/** True when the text is well-formed XML with an `svg` root and nothing the checks refuse. */
export function safeSvg(text: string): boolean {
  const parser = new SaxesParser({ xmlns: true });
  let safe = true;
  let root: string | null = null;
  let inStyle = 0;
  parser.on("doctype", () => {
    safe = false;
  });
  parser.on("opentag", (tag) => {
    const local = tag.local.toLowerCase();
    root ??= local;
    if (FORBIDDEN_ELEMENTS.has(local)) safe = false;
    if (local === "style") inStyle += 1;
    for (const attribute of Object.values(tag.attributes)) {
      if (attribute.name === "xmlns" || attribute.prefix === "xmlns") continue;
      const name = attribute.local.toLowerCase();
      const value = normalised(attribute.value);
      if (name.startsWith("on") || value.startsWith("javascript:")) safe = false;
      if ((name === "href" || name === "src") && !value.startsWith("#")) safe = false;
      if (name === "style" && hasOutsideUrl(attribute.value)) safe = false;
    }
  });
  parser.on("closetag", (tag) => {
    if (tag.local.toLowerCase() === "style") inStyle -= 1;
  });
  const styleText = (text: string): void => {
    if (inStyle > 0 && hasOutsideUrl(text)) safe = false;
  };
  parser.on("text", styleText);
  parser.on("cdata", styleText);
  try {
    parser.write(text).close();
  } catch {
    return false;
  }
  return safe && root === "svg";
}
