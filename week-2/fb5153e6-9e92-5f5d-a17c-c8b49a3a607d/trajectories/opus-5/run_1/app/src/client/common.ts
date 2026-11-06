import { all, one } from './dom.js';
import { isReceiptPath } from '../shared/locale.js';

/**
 * Choosing a language rewrites `lang` in the address with a replace, keeps the
 * scroll position, and keeps focus on the picker.
 */
function wireLanguagePicker(): void {
  for (const picker of all<HTMLSelectElement>('[data-language-picker]')) {
    picker.addEventListener('change', () => {
      const url = new URL(window.location.href);
      // A receipt always states the choice, because its address without `lang`
      // reads in the order's checkout locale.
      if (picker.value === 'de' || isReceiptPath(url.pathname)) {
        url.searchParams.set('lang', picker.value);
      } else {
        url.searchParams.delete('lang');
      }
      sessionStorage.setItem('turnstone:scroll', String(window.scrollY));
      sessionStorage.setItem('turnstone:focus', 'language');
      window.location.replace(url.toString());
    });
  }
}

/**
 * Switching language keeps the reading position. The scroll is reapplied after
 * load because the page is still growing while its images arrive.
 */
function restorePosition(): void {
  const scroll = sessionStorage.getItem('turnstone:scroll');
  if (scroll !== null) {
    sessionStorage.removeItem('turnstone:scroll');
    history.scrollRestoration = 'manual';
    const target = Number.parseInt(scroll, 10);
    const apply = (): void => window.scrollTo(0, target);
    apply();
    window.addEventListener('load', apply, { once: true });
    window.setTimeout(apply, 300);
  }
  if (sessionStorage.getItem('turnstone:focus') === 'language') {
    sessionStorage.removeItem('turnstone:focus');
    one<HTMLSelectElement>('[data-language-picker]')?.focus();
  }
}

wireLanguagePicker();
restorePosition();
