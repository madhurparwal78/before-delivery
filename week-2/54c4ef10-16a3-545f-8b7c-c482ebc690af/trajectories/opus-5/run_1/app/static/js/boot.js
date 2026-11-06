// The bootstrap the server hands the page: the aperture table and every copy string.
const data = JSON.parse(document.getElementById('bootstrap').textContent);

export const APERTURES = data.apertures;
export const LOG10_2 = data.log10_2;
export const COPY = data.copy;
export const FORMATS = data.formats;
export const LIMITS = data.limits;

export const FORMAT_LABELS = Object.fromEntries(
  FORMATS.map((item) => [item.value, item.label]),
);

export function fieldCopy(key) {
  return COPY.field[key];
}

export function errorCopy(code) {
  return COPY.error[code];
}

export function fill(template, values) {
  let out = template;
  for (const [key, value] of Object.entries(values)) {
    out = out.replace(`<${key}>`, value);
  }
  return out;
}
