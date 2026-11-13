import { Cur, NightState, PriceLine } from '../../shared/types';
import { frame } from '../app';
import { el, money, roving } from '../dom';
import { amount, isRtl, t, weekdayDayMonth } from '../i18n';
import { nightExpand } from '../motion';

export interface StripNight {
  date: string;
  minor: number;
  currency: Cur;
  state: NightState;
  lines: PriceLine[];
}

/** `group "Night Strip"`: one column per night, one roving tab stop. */
export function nightStrip(nights: StripNight[], zone: string): HTMLElement {
  const group = el('div', { role: 'group', 'aria-label': t('ui.night_strip'), class: 'night-strip' });
  const buttons: HTMLElement[] = [];
  const columns: HTMLElement[] = [];

  nights.slice(0, 30).forEach((night) => {
    const when = weekdayDayMonth(night.date, zone);
    const text = amount(night.minor, night.currency);
    const label = t('ui.night_button', { date: when, amount: text });
    const button = el(
      'button',
      {
        type: 'button',
        'data-date': night.date,
        'data-state': night.state,
        'aria-label': label,
        'aria-expanded': 'false',
        class: 'night',
        tabindex: '-1',
      },
      [el('span', { class: 'when' }, [when]), money(night.minor, night.currency, text, { class: 'night-amount' })],
    );
    const tag = el('span', { class: `state-tag state-${night.state}` }, [t(`ui.state.${night.state}`)]);
    const lines = el('ul', { role: 'list', 'aria-label': t('ui.price_lines'), class: 'price-lines', hidden: true });
    for (const line of night.lines) {
      const text2 = amount(line.minor, 'EUR');
      lines.append(
        el('li', { 'data-minor': line.minor, 'data-currency': 'EUR' }, [
          t('ui.price_line_item', { label: t(`ui.line.${line.key}`), amount: text2 }),
        ]),
      );
    }
    const column = el('div', { class: 'night-column' }, [button, tag, lines]);
    buttons.push(button);
    columns.push(column);
    group.append(column);

    const toggle = (): void => {
      const open = !lines.hidden;
      collapseAll();
      if (open) return;
      lines.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      column.classList.add('expanded');
      nightExpand(column);
    };

    button.addEventListener('click', toggle);
    button.addEventListener('keydown', (event) => {
      const forward = isRtl() ? 'ArrowLeft' : 'ArrowRight';
      const back = isRtl() ? 'ArrowRight' : 'ArrowLeft';
      const index = buttons.indexOf(button);
      let next = -1;
      if (event.key === forward) next = Math.min(buttons.length - 1, index + 1);
      else if (event.key === back) next = Math.max(0, index - 1);
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = buttons.length - 1;
      else if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        toggle();
        return;
      } else if (event.key === 'Escape' && !lines.hidden) {
        event.preventDefault();
        event.stopPropagation();
        collapseAll();
        button.focus();
        return;
      }
      if (next < 0) return;
      event.preventDefault();
      roving(buttons, next);
      buttons[next].focus();
      frame.regions.search.textContent = buttons[next].getAttribute('aria-label') ?? '';
    });
  });

  function collapseAll(): void {
    columns.forEach((column, index) => {
      const lines = column.querySelector<HTMLElement>('.price-lines');
      if (lines) lines.hidden = true;
      column.classList.remove('expanded');
      buttons[index].setAttribute('aria-expanded', 'false');
    });
  }

  roving(buttons, 0);
  return group;
}
