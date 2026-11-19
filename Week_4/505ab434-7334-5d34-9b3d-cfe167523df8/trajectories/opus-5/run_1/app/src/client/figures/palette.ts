import { el } from '../dom.js';
import { FAMILY_ORDER, SWATCHES } from '../data/swatches.js';

/** The colour chapter's palette wheel and swatch table. */
export function paletteFigure(): HTMLElement {
  const status = el('p', { class: 'figure-readout', role: 'status', 'aria-live': 'polite', 'aria-label': 'Swatch filter' }, '20 swatches');
  const body = el('tbody');
  const buttons = new Map<string, HTMLButtonElement>();
  let selected: string | null = null;

  const paint = (): void => {
    const rows = selected === null ? SWATCHES : SWATCHES.filter((swatch) => swatch.family === selected);
    body.replaceChildren(
      ...rows.map((swatch) =>
        el(
          'tr',
          {},
          el('th', { scope: 'row' }, swatch.name),
          el('td', {}, el('span', { class: 'swatch-chip', style: `background:#${swatch.hex}` }), `#${swatch.hex}`),
          el('td', {}, swatch.onWhite),
          el('td', {}, swatch.onWhiteRating),
          el('td', {}, swatch.onInk),
          el('td', {}, swatch.onInkRating),
        ),
      ),
    );
    status.textContent = selected === null ? '20 swatches' : `${rows.length} swatches in ${selected}`;
    for (const [family, button] of buttons) {
      button.setAttribute('aria-pressed', String(family === selected));
      button.tabIndex = selected === family || (selected === null && family === FAMILY_ORDER[0]) ? 0 : -1;
    }
  };

  const select = (family: string): void => {
    selected = family;
    paint();
  };

  const wheel = el('div', { class: 'palette-wheel', role: 'group', 'aria-label': 'Palette wheel' });
  FAMILY_ORDER.forEach((family, index) => {
    const tone = SWATCHES.find((swatch) => swatch.family === family && swatch.name.endsWith('700'))!;
    const angle = (index / FAMILY_ORDER.length) * 2 * Math.PI;
    const button = el('button', {
      type: 'button',
      class: 'palette-disc',
      'aria-label': `${family} family`,
      'aria-pressed': 'false',
      style: `background:#${tone.hex}; left:${50 + 38 * Math.sin(angle)}%; top:${50 - 38 * Math.cos(angle)}%`,
      tabindex: index === 0 ? '0' : '-1',
      onclick: () => select(family),
      onkeydown: (event: Event) => {
        const key = (event as KeyboardEvent).key;
        if (key === 'ArrowRight' || key === 'ArrowDown') {
          event.preventDefault();
          move(index + 1);
        } else if (key === 'ArrowLeft' || key === 'ArrowUp') {
          event.preventDefault();
          move(index - 1);
        } else if (key === 'Enter' || key === ' ') {
          event.preventDefault();
          select(family);
        }
      },
    }) as HTMLButtonElement;
    buttons.set(family, button);
    wheel.appendChild(button);
  });

  const move = (index: number): void => {
    const count = FAMILY_ORDER.length;
    const family = FAMILY_ORDER[((index % count) + count) % count]!;
    const button = buttons.get(family)!;
    for (const candidate of buttons.values()) candidate.tabIndex = -1;
    button.tabIndex = 0;
    button.focus();
  };

  const clear = el(
    'button',
    {
      type: 'button',
      class: 'pill',
      onclick: () => {
        selected = null;
        paint();
      },
    },
    'Show all families',
  );

  const table = el(
    'table',
    { class: 'swatch-table' },
    el('caption', {}, 'Swatches'),
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', { scope: 'col' }, 'Name'),
        el('th', { scope: 'col' }, 'Hex'),
        el('th', { scope: 'col' }, 'On white'),
        el('th', { scope: 'col' }, 'Rating'),
        el('th', { scope: 'col' }, 'On ink'),
        el('th', { scope: 'col' }, 'Rating'),
      ),
    ),
    body,
  );

  paint();

  return el(
    'div',
    { class: 'figure' },
    wheel,
    clear,
    status,
    table,
    el('p', { class: 'figure-note' }, 'Ratings are measured against White #FFFFFF and Ink #17161C.'),
    el(
      'p',
      { class: 'figure-text' },
      'Choose a family on the wheel to show only its two tones. Arrow keys move around the wheel; Enter selects.',
    ),
  );
}
