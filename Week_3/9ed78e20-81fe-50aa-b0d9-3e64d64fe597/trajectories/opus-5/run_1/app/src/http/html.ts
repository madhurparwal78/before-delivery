export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Markup already escaped by its producer. */
export class Raw {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }
}

export function raw(value: string): Raw {
  return new Raw(value);
}

export type Html = Raw;

type Interpolation = string | number | boolean | null | undefined | Raw | readonly unknown[];

function render(value: Interpolation): string {
  if (value === null || value === undefined || value === false || value === true) return '';
  if (value instanceof Raw) return value.value;
  if (Array.isArray(value)) return value.map((item) => render(item as Interpolation)).join('');
  if (typeof value === 'number') return escapeHtml(String(value));
  return escapeHtml(String(value));
}

export function html(strings: TemplateStringsArray, ...values: Interpolation[]): Raw {
  let output = strings[0] ?? '';
  for (let index = 0; index < values.length; index += 1) {
    output += render(values[index]);
    output += strings[index + 1] ?? '';
  }
  return new Raw(output);
}
