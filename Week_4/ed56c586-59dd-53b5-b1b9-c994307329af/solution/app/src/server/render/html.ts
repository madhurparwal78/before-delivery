/** A small HTML template tag. Strings are escaped; only `Markup` built by this module is passed through unescaped. */

export class Markup {
  constructor(readonly text: string) {}

  toString(): string {
    return this.text;
  }
}

type Part = string | number | Markup | readonly Part[] | false | null | undefined;

const ESCAPES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

export function raw(text: string): Markup {
  return new Markup(text);
}

function render(part: Part): string {
  if (part === false || part === null || part === undefined) return "";
  if (typeof part === "number") return String(part);
  if (typeof part === "string") return escapeHtml(part);
  if (part instanceof Markup) return part.text;
  return part.map(render).join("");
}

export function html(strings: TemplateStringsArray, ...parts: readonly Part[]): Markup {
  return new Markup(strings.reduce((output, chunk, index) => output + chunk + (index < parts.length ? render(parts[index] as Part) : ""), ""));
}

/** An attribute that is present only when its condition holds, written as ` name` or ` name="value"`. */
export function flag(condition: boolean, name: string, value?: string): Markup {
  if (!condition) return new Markup("");
  return new Markup(value === undefined ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`);
}
