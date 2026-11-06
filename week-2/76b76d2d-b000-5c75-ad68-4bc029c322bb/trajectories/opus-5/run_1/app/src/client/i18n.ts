import type { Locale } from '../shared/money.ts';
import { t, type Args } from '../shared/strings.ts';

let current: Locale = 'en';

export function setLocale(locale: Locale): void {
  current = locale;
}

export function locale(): Locale {
  return current;
}

export function tr(key: string, args?: Args): string {
  return t(key, current, args);
}

function argsOf(element: Element): Args | undefined {
  const raw = element.getAttribute('data-i18n-args');
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw) as Args;
  } catch {
    return undefined;
  }
}

export function setFirstText(element: Element, value: string): void {
  const first = element.firstChild;
  if (first !== null && first.nodeType === Node.TEXT_NODE) {
    first.nodeValue = value;
    return;
  }
  element.insertBefore(document.createTextNode(value), element.firstChild);
}

export function applyTranslations(root: ParentNode = document): void {
  for (const element of root.querySelectorAll('[data-i18n]')) {
    setFirstText(element, t(element.getAttribute('data-i18n') ?? '', current, argsOf(element)));
  }
  for (const element of root.querySelectorAll('[data-i18n-aria]')) {
    element.setAttribute('aria-label', t(element.getAttribute('data-i18n-aria') ?? '', current, argsOf(element)));
  }
}

export function setI18n(element: Element, key: string, args?: Args): void {
  element.setAttribute('data-i18n', key);
  if (args === undefined) element.removeAttribute('data-i18n-args');
  else element.setAttribute('data-i18n-args', JSON.stringify(args));
  setFirstText(element, t(key, current, args));
}

export function setI18nAria(element: Element, key: string, args?: Args): void {
  element.setAttribute('data-i18n-aria', key);
  if (args !== undefined) element.setAttribute('data-i18n-args', JSON.stringify(args));
  element.setAttribute('aria-label', t(key, current, args));
}
