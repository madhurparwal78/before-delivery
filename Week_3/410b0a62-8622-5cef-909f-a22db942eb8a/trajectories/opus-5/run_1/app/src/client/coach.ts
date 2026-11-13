import { api, ApiCallError } from './api.js';
import { app, navigate, type Screen } from './app.js';
import { el, keepFocus, openDialog } from './dom.js';
import { complianceLabel, dataNumber, formatTss, itemTitle, itemTss } from './format.js';
import type { AthleteSummary, CoachLink, PlanTemplate } from '../domain/types.js';

export async function createCoachDashboard(): Promise<Screen> {
  const body = el('tbody');
  const table = el('table', {
    class: 'athletes-table',
    attrs: { 'aria-label': 'Athletes' },
    children: [
      el('thead', {
        children: [
          el('tr', {
            children: ['Athlete', 'Planned', 'Completed', 'Latest session', 'Compliance'].map(
              (label) => el('th', { text: label, attrs: { scope: 'col' } }),
            ),
          }),
        ],
      }),
      body,
    ],
  });
  const element = el('main', {
    class: 'coach-dashboard',
    children: [el('h1', { class: 'page-title', text: 'Athletes' }), table],
  });

  function row(athlete: AthleteSummary): HTMLElement {
    const latest = athlete.latest;
    const latestText = latest
      ? `${itemTitle(latest)} · ${formatTss(itemTss(latest) ?? 0)} TSS`
      : 'No sessions yet';
    return el('tr', {
      attrs: { 'data-athlete-id': athlete.id },
      children: [
        el('th', {
          attrs: { scope: 'row' },
          children: [
            el('a', { text: athlete.name, attrs: { href: `/athletes/${athlete.id}` } }),
          ],
        }),
        el('td', {
          text: `${formatTss(athlete.week.planned_tss)} TSS`,
          attrs: { 'data-planned-tss': dataNumber(athlete.week.planned_tss, 1) },
        }),
        el('td', {
          text: `${formatTss(athlete.week.completed_tss)} TSS`,
          attrs: { 'data-completed-tss': dataNumber(athlete.week.completed_tss, 1) },
        }),
        el('td', {
          text: latestText,
          attrs: {
            'data-tss': latest && itemTss(latest) !== null ? dataNumber(itemTss(latest) as number, 1) : null,
          },
        }),
        el('td', {
          text: latest ? complianceLabel(latest.compliance) : '',
          attrs: { 'data-compliance': latest ? latest.compliance : null },
        }),
      ],
    });
  }

  async function refresh(): Promise<void> {
    const response = await api.athletes();
    body.replaceChildren(...response.athletes.map(row));
  }

  await refresh();

  return {
    element,
    onChange() {
      void refresh();
    },
  };
}

export async function createPlansScreen(): Promise<Screen> {
  const list = el('div', { class: 'plan-tiles' });
  const element = el('main', {
    class: 'plans',
    children: [el('h1', { class: 'page-title', text: 'Plans' }), list],
  });

  function openApply(plan: PlanTemplate, opener: HTMLElement, athletes: AthleteSummary[]): void {
    openDialog({
      label: 'Apply plan',
      className: 'sheet',
      opener,
      content: (handle) => {
        const status = el('p', {
          class: 'status-line',
          attrs: { role: 'status', 'aria-live': 'polite', 'aria-label': 'Plan status' },
        });
        const athleteSelect = el('select', {
          class: 'field',
          attrs: { 'aria-label': 'Athlete' },
          children: athletes.map((athlete) =>
            el('option', { text: athlete.name, attrs: { value: athlete.id } }),
          ),
        });
        const startRadio = el('input', {
          attrs: { type: 'radio', name: 'plan-mode', checked: true, 'aria-label': 'Start on' },
        });
        const eventRadio = el('input', {
          attrs: { type: 'radio', name: 'plan-mode', 'aria-label': 'Count back from event' },
        });
        const dateInput = el('input', {
          class: 'field',
          attrs: { type: 'text', value: app.me?.today ?? '', 'aria-label': 'Date' },
        });
        const eventInput = el('input', {
          class: 'field',
          attrs: { type: 'text', 'aria-label': 'Event name' },
        });
        const apply = el('button', {
          class: 'pill pill-accent',
          text: 'Apply plan',
          attrs: { type: 'button' },
        });
        apply.addEventListener('click', async () => {
          const mode = startRadio.checked ? 'start' : 'event';
          apply.disabled = true;
          apply.textContent = 'Applying…';
          status.textContent = 'Applying…';
          try {
            const payload: {
              athlete_id: string;
              mode: 'start' | 'event';
              date: string;
              event_name?: string;
            } = { athlete_id: athleteSelect.value, mode, date: dateInput.value.trim() };
            if (mode === 'event') payload.event_name = eventInput.value.trim();
            const result = await api.applyPlan(plan.id, payload);
            const name =
              athleteSelect.options[athleteSelect.selectedIndex]?.textContent ?? 'the athlete';
            const created = `${result.created} ${result.created === 1 ? 'workout' : 'workouts'}`;
            let text =
              `Added ${created} to ${name}'s calendar. ` +
              `Skipped ${result.skipped} on days that have already passed.`;
            if (result.kept > 0) {
              text += ` ${result.kept} ${result.kept === 1 ? 'day' : 'days'} already had workouts; they were kept alongside the plan.`;
            }
            status.textContent = text;
          } catch (error) {
            if (error instanceof ApiCallError) {
              status.textContent =
                Object.values(error.failure.errors ?? {})[0] ?? error.failure.message ?? '';
            }
          } finally {
            apply.disabled = false;
            apply.textContent = 'Apply plan';
            keepFocus(apply);
          }
        });
        return [
          el('h2', { class: 'dialog-title', text: `Apply ${plan.name}` }),
          el('label', {
            class: 'field-row',
            children: [el('span', { text: 'Athlete' }), athleteSelect],
          }),
          el('div', {
            class: 'radio-row',
            children: [
              el('label', { class: 'radio', children: [startRadio, el('span', { text: 'Start on' })] }),
              el('label', {
                class: 'radio',
                children: [eventRadio, el('span', { text: 'Count back from event' })],
              }),
            ],
          }),
          el('label', { class: 'field-row', children: [el('span', { text: 'Date' }), dateInput] }),
          el('label', {
            class: 'field-row',
            children: [el('span', { text: 'Event name' }), eventInput],
          }),
          apply,
          el('button', {
            class: 'pill pill-quiet',
            text: 'Cancel',
            attrs: { type: 'button' },
            on: { click: () => handle.close() },
          }),
          status,
        ];
      },
    });
  }

  async function refresh(): Promise<void> {
    const [plans, athletes] = await Promise.all([api.plans(), api.athletes()]);
    list.replaceChildren(
      ...plans.plans.map((plan) => {
        const button = el('button', {
          class: 'pill pill-accent',
          text: `Apply ${plan.name}`,
          attrs: { type: 'button' },
        });
        button.addEventListener('click', () => openApply(plan, button, athletes.athletes));
        return el('article', {
          class: 'tile plan-tile',
          children: [
            el('h2', { class: 'tile-label', text: plan.name }),
            el('p', {
              class: 'tile-value',
              text: `${plan.weeks} weeks · ${plan.entries.length} sessions`,
            }),
            button,
          ],
        });
      }),
    );
  }

  await refresh();
  return { element };
}

export async function createInboxScreen(): Promise<Screen> {
  const list = el('ul', { class: 'request-list', attrs: { 'aria-label': 'Link requests' } });
  const element = el('main', {
    class: 'inbox',
    children: [el('h1', { class: 'page-title', text: 'Inbox' }), list],
  });

  function item(link: CoachLink): HTMLElement {
    if (link.status === 'expired') {
      return el('li', { text: `${link.athlete_name} — Expired` });
    }
    const node = el('li', { class: 'request' });
    const accept = el('button', {
      class: 'pill pill-accent',
      text: `Accept ${link.athlete_name}`,
      attrs: { type: 'button' },
      on: {
        click: async () => {
          await api.acceptLink(link.id);
          node.replaceChildren(el('p', { text: `${link.athlete_name} is linked.` }));
        },
      },
    });
    const decline = el('button', {
      class: 'pill pill-quiet',
      text: `Decline ${link.athlete_name}`,
      attrs: { type: 'button' },
      on: {
        click: async () => {
          await api.declineLink(link.id);
          node.replaceChildren(el('p', { text: `${link.athlete_name} was declined.` }));
        },
      },
    });
    node.append(
      el('p', { text: `${link.athlete_name} wants to join` }),
      accept,
      decline,
    );
    return node;
  }

  async function refresh(): Promise<void> {
    const response = await api.links();
    const pending = response.links.filter(
      (link) => link.status === 'requested' || link.status === 'expired',
    );
    list.replaceChildren(
      ...(pending.length === 0
        ? [el('li', { text: 'No link requests' })]
        : pending.map(item)),
    );
  }

  await refresh();
  return { element, onChange: () => void refresh() };
}

export async function createCoachesScreen(): Promise<Screen> {
  const list = el('ul', { class: 'coach-list', attrs: { 'aria-label': 'Your coaches' } });
  const element = el('main', {
    class: 'coaches',
    children: [el('h1', { class: 'page-title', text: 'Coaches' }), list],
  });

  function item(link: CoachLink): HTMLElement {
    if (link.status === 'requested') {
      return el('li', { text: `${link.coach_name} — Pending` });
    }
    const node = el('li', { class: 'coach-row' });
    const remove = el('button', {
      class: 'pill pill-ink',
      text: `Remove ${link.coach_name}`,
      attrs: { type: 'button' },
    });
    remove.addEventListener('click', () => {
      openDialog({
        label: 'Remove coach?',
        opener: remove,
        content: (handle) => [
          el('h2', { class: 'dialog-title', text: 'Remove coach?' }),
          el('p', { text: `${link.coach_name} will lose access to your calendar.` }),
          el('button', {
            class: 'pill pill-accent',
            text: 'Remove',
            attrs: { type: 'button' },
            on: {
              click: async () => {
                await api.removeLink(link.id);
                handle.close();
                await refresh();
              },
            },
          }),
          el('button', {
            class: 'pill pill-quiet',
            text: 'Keep',
            attrs: { type: 'button' },
            on: { click: () => handle.close() },
          }),
        ],
      });
    });
    node.append(el('p', { text: link.coach_name }), remove);
    return node;
  }

  async function refresh(): Promise<void> {
    const response = await api.links();
    const visible = response.links.filter(
      (link) => link.status === 'accepted' || link.status === 'requested',
    );
    list.replaceChildren(
      ...(visible.length === 0 ? [el('li', { text: 'No coaches yet' })] : visible.map(item)),
    );
  }

  await refresh();
  return { element, onChange: () => void refresh() };
}

export async function createHomeRedirect(): Promise<Screen> {
  const me = app.me;
  if (me?.role === 'coach') return createCoachDashboard();
  navigate(`/athletes/${me?.id ?? ''}`, { replace: true });
  return { element: el('main', { children: [el('p', { text: 'Loading…' })] }) };
}
