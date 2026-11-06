/**
 * Default styling of each node type, used verbatim by the editor frames (`.pl-page-surface`) and by every
 * published snapshot (`body`), so a node's computed style is the same in both places.
 */

const FONT_FACES = [
  ["Space Grotesk", 500, "space-grotesk-latin-500-normal"],
  ["Space Grotesk", 700, "space-grotesk-latin-700-normal"],
  ["IBM Plex Sans", 400, "ibm-plex-sans-latin-400-normal"],
  ["IBM Plex Sans", 500, "ibm-plex-sans-latin-500-normal"],
  ["IBM Plex Sans", 600, "ibm-plex-sans-latin-600-normal"],
  ["IBM Plex Mono", 400, "ibm-plex-mono-latin-400-normal"],
  ["IBM Plex Mono", 500, "ibm-plex-mono-latin-500-normal"],
] as const;

export const FONT_FACE_CSS = FONT_FACES.map(
  ([family, weight, file]) => `@font-face{font-family:"${family}";font-style:normal;font-weight:${weight};font-display:swap;src:url(/fonts/${file}.woff2) format("woff2")}`,
).join("\n");

const SURFACE = `font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:1rem;font-weight:400;line-height:1.5;color:#1d1b18;background-color:#ffffff;letter-spacing:normal;text-align:left;overflow-wrap:anywhere`;

/** `surface` is the selector standing for the page body: `body` on a snapshot, the frame in the editor. */
export function nodeCss(surface: string): string {
  return `
${surface}{${SURFACE}}
${surface} .pn{box-sizing:border-box;margin:0;min-width:0;max-width:100%;overflow-wrap:anywhere}
${surface} .pn-page{display:block;min-height:100%}
${surface} .pn-section{display:block;padding:32px 24px}
${surface} .pn-stack{display:flex;flex-direction:column;gap:12px}
${surface} .pn-heading{font-family:"Space Grotesk","IBM Plex Sans",system-ui,sans-serif;font-weight:700;line-height:1.15}
${surface} .pn-h1{font-size:2.074rem}
${surface} .pn-h2{font-size:1.728rem}
${surface} .pn-h3{font-size:1.44rem}
${surface} .pn-text{font-size:1rem;line-height:1.5}
${surface} .pn-text p,${surface} .pn-text ul,${surface} .pn-text ol{margin:0 0 .5em}
${surface} .pn-image{display:block;width:100%;aspect-ratio:3/2;object-fit:cover;background-color:#efeae0}
${surface} .pn-image img{display:block;width:100%;height:100%;object-fit:cover}
${surface} .pn-button{display:inline-block;padding:12px 20px;min-width:44px;min-height:44px;line-height:20px;border-radius:6px;background-color:#1d1b18;color:#ffffff;font-weight:600;text-align:center;text-decoration:none}
${surface} .pn-nav{display:flex;flex-direction:row;flex-wrap:wrap;align-items:center;gap:8px}
${surface} .pn-collection_list{display:flex;flex-direction:column;gap:16px;padding:0;list-style:none}
${surface} .pl-entry{display:block;margin:0;padding:0}
${surface} .pl-empty{display:block;margin:0;color:#5a544a}
`;
}

/** Turn a CSS property name into the camel-case key of a style object. */
export function camel(property: string): string {
  return property.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}
