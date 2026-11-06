export type AttrValue = string | number | boolean | null | undefined;

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function esc(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/** Renders attributes; `true` renders the bare name and `false`/null are left out. */
export function attrs(record: Readonly<Record<string, AttrValue>>): string {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(record)) {
    if (value === false || value === null || value === undefined) continue;
    if (value === true) parts.push(name);
    else parts.push(`${name}="${esc(value)}"`);
  }
  return parts.length === 0 ? '' : ` ${parts.join(' ')}`;
}

export function tag(
  name: string,
  attributes: Readonly<Record<string, AttrValue>>,
  ...children: (string | null | undefined | false)[]
): string {
  const inner = children.filter((c): c is string => typeof c === 'string').join('');
  return `<${name}${attrs(attributes)}>${inner}</${name}>`;
}

/**
 * A data table inside a keyboard-focusable scroll region: a table wider than a
 * phone scrolls inside its own box and never widens the page.
 */
export function scrollTable(
  attributes: Readonly<Record<string, AttrValue>>,
  ...children: (string | null | undefined | false)[]
): string {
  const label = attributes['aria-label'];
  return tag(
    'div',
    { class: 'table-scroll', role: 'region', tabindex: 0, 'aria-label': typeof label === 'string' ? label : undefined },
    tag('table', attributes, ...children),
  );
}

/** Self-closed, so SVG shapes (`line`, `circle`) never swallow their siblings. */
export function voidTag(name: string, attributes: Readonly<Record<string, AttrValue>>): string {
  return `<${name}${attrs(attributes)} />`;
}

export function join(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => typeof p === 'string').join('');
}

export function jsonScript(id: string, value: unknown): string {
  const payload = JSON.stringify(value).replace(/</g, '\\u003c');
  return `<script type="application/json" id="${esc(id)}">${payload}</script>`;
}
