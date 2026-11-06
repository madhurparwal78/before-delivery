export class RawHtml {
  readonly value: string;
  constructor(value: string) {
    this.value = value;
  }
}

export type Renderable =
  | string
  | number
  | null
  | undefined
  | false
  | RawHtml
  | readonly Renderable[];

export function raw(value: string): RawHtml {
  return new RawHtml(value);
}

export function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(value: Renderable): string {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof RawHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escape(String(value));
}

export function html(strings: TemplateStringsArray, ...values: readonly Renderable[]): RawHtml {
  let output = strings[0] ?? '';
  for (let index = 0; index < values.length; index += 1) {
    output += render(values[index]);
    output += strings[index + 1] ?? '';
  }
  return new RawHtml(output);
}

/** Builds an attribute list, leaving out attributes whose value is null or false. */
export function attrs(map: Record<string, string | number | boolean | null | undefined>): RawHtml {
  const parts: string[] = [];
  for (const [name, value] of Object.entries(map)) {
    if (value === null || value === undefined || value === false) continue;
    if (value === true) {
      parts.push(name);
      continue;
    }
    parts.push(`${name}="${escape(String(value))}"`);
  }
  return new RawHtml(parts.length === 0 ? '' : ` ${parts.join(' ')}`);
}

export function icon(name: string, label: string | null = null): RawHtml {
  return html`<svg class="icon" aria-hidden="${label === null ? 'true' : 'false'}"${
    label === null ? raw('') : html` role="img" aria-label="${label}"`
  }><use href="/assets/icons.svg#icon-${name}"></use></svg>`;
}
