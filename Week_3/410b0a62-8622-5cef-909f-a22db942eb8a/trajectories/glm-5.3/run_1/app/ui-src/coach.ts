import { api, type AthleteJson } from './api.js';
import type { AppCtx } from './shell.js';
import { h, clear } from './dom.js';
import { fmtTss, dataAttr, dayLabel } from './format.js';
import { COMPLIANCE_LABELS } from './domain.js';
import { onLiveChange } from './main.js';

export async function renderCoach(main: HTMLElement, ctx: AppCtx): Promise<void> {
  if (ctx.me?.role !== 'coach') {
    main.append(notFoundView());
    return;
  }
  const container = h('div', { class: 'page coach-page' });
  main.append(container);
  const draw = async (): Promise<void> => {
    let athletes: AthleteJson[];
    try {
      athletes = (await api.get<{ athletes: AthleteJson[] }>('/athletes')).athletes;
    } catch {
      clear(container);
      container.append(notFoundView());
      return;
    }
    clear(container);
    const table = h('table', { class: 'athletes-table', role: 'table', 'aria-label': 'Athletes' });
    const thead = h(
      'thead',
      {},
      h('tr', {}, h('th', {}, 'Athlete'), h('th', {}, 'Planned'), h('th', {}, 'Completed'), h('th', {}, 'Latest session'), h('th', {}, 'Compliance'))
    );
    const tbody = h('tbody', {});
    for (const athlete of athletes) {
      const latest = athlete.latest;
      const row = h(
        'tr',
        { class: 'athlete-row', 'data-athlete-id': athlete.id, onclick: () => { window.location.href = `/athletes/${athlete.id}`; } },
        h('td', { class: 'athlete-name' }, athlete.name),
        h('td', { 'data-planned-tss': dataAttr(athlete.week.planned_tss, 1) }, fmtTss(athlete.week.planned_tss)),
        h('td', { 'data-completed-tss': dataAttr(athlete.week.completed_tss, 1) }, fmtTss(athlete.week.completed_tss)),
        h(
          'td',
          {
            'data-tss': latest?.completed?.tss === undefined ? '' : dataAttr(latest.completed.tss ?? 0, 1),
          },
          latest?.completed ? `${latest.completed.title} · ${dayLabel(latest.completed.date)}` : '—'
        ),
        h(
          'td',
          { 'data-compliance': latest?.compliance ?? '' },
          latest ? (COMPLIANCE_LABELS[latest.compliance] ?? '') : '—'
        )
      );
      tbody.append(row);
    }
    table.append(thead, tbody);
    container.append(h('h1', { class: 'screen-title' }, 'Athletes'), table);
  };
  await draw();
  onLiveChange(() => void draw());
}

function notFoundView(): HTMLElement {
  return h(
    'section',
    { class: 'notfound' },
    h('h1', { class: 'display' }, 'Not found'),
    h('p', {}, "This page isn't available to you."),
    h('a', { class: 'pill pill-primary', href: '/' }, 'Back to home')
  );
}
