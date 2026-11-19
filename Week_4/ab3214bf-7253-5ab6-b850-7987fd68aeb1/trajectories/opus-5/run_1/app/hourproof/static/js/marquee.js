// The marquee of real sealed scores along the top edge of public pages.

import { get } from './api.js';
import { el } from './dom.js';
import { percent } from './format.js';
import { motionAttributes } from './motion.js';

export function marquee() {
  const track = el('div', { className: 'marquee__track' });
  const region = el(
    'div',
    {
      role: 'region',
      'aria-label': 'Sealed scores',
      className: 'marquee',
      dataset: { running: 'true' },
    },
    [track]
  );
  motionAttributes(region, 45000);
  const stop = el('button', { type: 'button', text: 'Stop scores' });
  stop.addEventListener('click', () => {
    const running = region.dataset.running === 'true';
    region.dataset.running = running ? 'false' : 'true';
    stop.textContent = running ? 'Run scores' : 'Stop scores';
  });
  const controls = el('div', { className: 'marquee__controls' }, [stop]);
  get('/api/public/sealed-scores').then(({ status, data }) => {
    if (status !== 200) return;
    const items = data.items || [];
    if (!items.length) {
      track.append(el('span', { className: 'marquee__item', text: 'NO SEALED HOURS YET.' }));
      return;
    }
    const line = items.map(
      (item) => `${item.site_name} ${item.month} HOUR ${percent(item.hour_bp)}%`
    );
    [...line, ...line].forEach((text) =>
      track.append(el('span', { className: 'marquee__item', text }))
    );
  });
  return el('div', {}, [region, controls]);
}
