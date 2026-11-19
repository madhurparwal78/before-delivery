// Form text -> the number the API expects. Text that is not a number is sent as typed so the server names the field.
export function parseNumber(text) {
  const trimmed = String(text).trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : trimmed;
}

// Unique per attempt: used as the Idempotency-Key of a batch submit.
export function newKey() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Lets a live region that lives on the page be read from inside an open dialog, then returns it.
export function lendRegion(region, home) {
  return {
    into(dialog) { dialog.body.append(region); },
    back() { home.append(region); },
  };
}

export function isTextEntry(element) {
  if (!element) return false;
  if (element.tagName === 'TEXTAREA' || element.tagName === 'SELECT' || element.isContentEditable) return true;
  return element.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'file'].includes(element.type);
}
