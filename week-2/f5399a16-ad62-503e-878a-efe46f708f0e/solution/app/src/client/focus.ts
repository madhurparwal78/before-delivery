// SR6: a control that takes focus by Tab or tap sits fully between the top bar and the bottom bar.

export function keepFocusInView(): void {
  let byPerson = false;
  addEventListener('keydown', (event) => { if (event.key === 'Tab') byPerson = true; }, true);
  addEventListener('pointerdown', () => { byPerson = true; }, true);
  addEventListener('keyup', () => { byPerson = false; }, true);
  addEventListener('pointerup', () => { byPerson = false; }, true);
  addEventListener('focusin', (event) => {
    if (!byPerson) return;
    const target = event.target as HTMLElement;
    if (target.closest('.panel, .menu, .bottom-bar, .top-bar, .site-header')) return;
    const box = target.getBoundingClientRect();
    if (box.height >= innerHeight * 0.6) return;
    const top = document.querySelector('.top-bar, .site-header')?.getBoundingClientRect().bottom ?? 0;
    const bar = document.querySelector('.bottom-bar');
    const barTop = bar && getComputedStyle(bar).position === 'fixed' ? bar.getBoundingClientRect().top : innerHeight;
    if (box.top < top) window.scrollBy({ top: box.top - top - 8, behavior: 'instant' });
    else if (box.bottom > barTop) window.scrollBy({ top: box.bottom - barTop + 8, behavior: 'instant' });
  });
}
