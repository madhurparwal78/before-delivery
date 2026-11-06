/** Keeps a focused control clear of a sticky action bar or bottom sheet. */
export function startStickyClear(): void {
  document.addEventListener('focusin', (event) => {
    const control = event.target as HTMLElement | null;
    if (control === null || control.closest('.sticky-bar') !== null) return;
    const bar = control.closest('.dialog')?.querySelector('.sticky-bar') ?? document.querySelector('.sticky-bar');
    if (bar === null) return;
    const barBox = bar.getBoundingClientRect();
    if (barBox.height === 0) return;
    const box = control.getBoundingClientRect();
    if (box.bottom <= barBox.top) return;
    control.scrollIntoView({ block: 'center', inline: 'nearest' });
  });
}
