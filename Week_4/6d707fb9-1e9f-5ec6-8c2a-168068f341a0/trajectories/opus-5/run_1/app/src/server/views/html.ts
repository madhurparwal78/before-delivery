export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export class Raw {
  readonly text: string;

  constructor(text: string) {
    this.text = text;
  }
}

export function raw(text: string): Raw {
  return new Raw(text);
}

type Hole = string | number | boolean | null | undefined | Raw | Hole[];

function render(value: Hole): string {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (value instanceof Raw) return value.text;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(String(value));
}

/** Everything interpolated is escaped unless it is already marked raw. */
export function html(parts: TemplateStringsArray, ...holes: Hole[]): Raw {
  let text = parts[0] ?? '';
  for (let index = 0; index < holes.length; index += 1) {
    text += render(holes[index] as Hole);
    text += parts[index + 1] ?? '';
  }
  return new Raw(text);
}

export function attribute(name: string, value: string | number | null | undefined): Raw {
  if (value === null || value === undefined) return new Raw('');
  return new Raw(` ${name}="${escapeHtml(String(value))}"`);
}

export function when(condition: boolean, value: Raw | string): Raw {
  return condition ? (value instanceof Raw ? value : new Raw(escapeHtml(value))) : new Raw('');
}

export function json(value: unknown): Raw {
  return new Raw(JSON.stringify(value).replace(/</g, '\\u003c'));
}
