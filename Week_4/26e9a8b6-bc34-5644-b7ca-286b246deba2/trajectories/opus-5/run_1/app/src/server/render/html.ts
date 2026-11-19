/** Plain text is stored and shown exactly as typed, with no markup interpreted. */
export function escapeText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function attr(value: string | number | boolean): string {
  return escapeText(String(value));
}

export type Attributes = Record<string, string | number | boolean | null | undefined>;

export function attrs(values: Attributes): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(values)) {
    if (value === null || value === undefined || value === false) continue;
    if (value === true) parts.push(name);
    else parts.push(`${name}="${attr(value)}"`);
  }
  return parts.length > 0 ? ` ${parts.join(' ')}` : '';
}

export function tag(name: string, values: Attributes, ...children: string[]): string {
  return `<${name}${attrs(values)}>${children.join('')}</${name}>`;
}

export function voidTag(name: string, values: Attributes): string {
  return `<${name}${attrs(values)}>`;
}

/** Keeps line breaks in stored text without interpreting any markup. */
export function paragraphs(text: string): string {
  return escapeText(text).replace(/\r?\n/g, '<br>');
}

export function jsonScript(id: string, value: unknown): string {
  const payload = JSON.stringify(value).replace(/</g, '\\u003c').replace(/-->/g, '--\\u003e');
  return `<script type="application/json" id="${attr(id)}">${payload}</script>`;
}
