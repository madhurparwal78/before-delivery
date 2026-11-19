// Server-side HTML with every value escaped unless it is already markup.
export class Markup {
  constructor(public text: string) {}
  toString(): string {
    return this.text;
  }
}
export const escapeHtml = (value: unknown): string =>
  String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
type Piece = Markup | string | number | boolean | null | undefined | Piece[];
const render = (value: Piece): string => {
  if (value === null || value === undefined || value === false || value === true) return "";
  if (value instanceof Markup) return value.text;
  if (Array.isArray(value)) return value.map(render).join("");
  return escapeHtml(value);
};
export const html = (strings: TemplateStringsArray, ...values: Piece[]): Markup =>
  new Markup(strings.reduce((out, part, i) => out + part + (i < values.length ? render(values[i]) : ""), ""));
export const raw = (text: string): Markup => new Markup(text);
