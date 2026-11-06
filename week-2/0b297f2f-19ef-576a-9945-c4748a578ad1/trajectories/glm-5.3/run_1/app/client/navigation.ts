/**
 * Same-app navigation without a page reload, so focus can be managed
 * precisely after each action.
 */
export function navigateTo(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new CustomEvent('hangline:navigate', { detail: { path } }));
}

/** Marks that the next mounted page should focus its main heading. */
export function requestHeadingFocus(): void {
  sessionStorage.setItem('hangline.focus-heading', '1');
}

export function consumeHeadingFocus(): boolean {
  const flag = sessionStorage.getItem('hangline.focus-heading');
  if (flag === '1') {
    sessionStorage.removeItem('hangline.focus-heading');
    return true;
  }
  return false;
}
