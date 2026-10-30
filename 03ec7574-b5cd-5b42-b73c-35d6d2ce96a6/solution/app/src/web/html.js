// HTML templates as tagged template literals: every interpolated value is escaped unless it is
// already markup produced by html``.
class Markup {
  constructor(text) {
    this.text = text;
  }

  toString() {
    return this.text;
  }
}

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escape = (text) => text.replace(/[&<>"']/g, (ch) => ESCAPES[ch]);

function render(value) {
  if (value === null || value === undefined || value === false) return '';
  if (Array.isArray(value)) return value.map(render).join('');
  if (value instanceof Markup) return value.text;
  return escape(String(value));
}

export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1];
  });
  return new Markup(out);
}

// Markup the app itself wrote, such as a JSON island; never user input.
export const trusted = (text) => new Markup(text);

// An attribute that is present only when on.
export const attr = (name, on, value = '') => (on ? trusted(value === '' ? ` ${name}` : ` ${name}="${escape(String(value))}"`) : '');
