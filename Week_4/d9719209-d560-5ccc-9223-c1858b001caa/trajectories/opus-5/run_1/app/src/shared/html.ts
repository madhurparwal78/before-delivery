export class Raw {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }
}

export function raw(value: string): Raw {
  return new Raw(value);
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function render(value: unknown): string {
  if (value === null || value === undefined || value === false) return '';
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map(render).join('');
  return escapeHtml(String(value));
}

/** Interpolations are escaped unless wrapped in raw(). */
export function html(strings: TemplateStringsArray, ...values: unknown[]): Raw {
  let output = strings[0];
  for (let index = 0; index < values.length; index += 1) {
    output += render(values[index]) + strings[index + 1];
  }
  return new Raw(output);
}

export function attribute(name: string, value: string | number | boolean | null): Raw {
  if (value === null || value === false) return raw('');
  if (value === true) return raw(` ${name}`);
  return raw(` ${name}="${escapeHtml(String(value))}"`);
}

export function classes(...values: Array<string | false | null | undefined>): string {
  return values.filter((value): value is string => typeof value === 'string' && value !== '').join(' ');
}
