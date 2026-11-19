/** One polite announcement in the Box office updates region of this page. */
export function announce(text: string): void {
  const region = document.getElementById('box-office-updates');
  if (!region) return;
  region.textContent = '';
  window.setTimeout(() => {
    region.textContent = text;
  }, 30);
}
