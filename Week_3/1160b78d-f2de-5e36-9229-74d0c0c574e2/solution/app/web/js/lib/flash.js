// A one-shot message that survives a page switch (sign-out, role change): shown as a plain full-width bar.
const KEY = 'flash';

export function flash(text) {
  sessionStorage.setItem(KEY, text);
}

export function takeFlash() {
  const text = sessionStorage.getItem(KEY);
  if (text) sessionStorage.removeItem(KEY);
  return text;
}
