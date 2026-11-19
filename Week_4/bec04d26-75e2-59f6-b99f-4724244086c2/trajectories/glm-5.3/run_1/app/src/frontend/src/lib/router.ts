/** One place the app listens to the address bar; screens navigate through here. */
export function navigateTo(path: string): void {
  window.history.pushState({}, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}
