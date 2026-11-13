import { api } from './api.js';
import type { AppCtx } from './shell.js';
import { h } from './dom.js';

interface PlanJson {
  id: string;
  name: string;
  weeks: number;
}

export async function renderPlans(main: HTMLElement, ctx: AppCtx): Promise<void> {
  if (ctx.me?.role !== 'coach') {
    main.append(notFoundView());
    return;
  }
  const container = h('div', { class: 'page plans-page' });
  main.append(container);
  let plans: PlanJson[] = [];
  try {
    plans = (await api.get<{ plans: PlanJson[] }>('/plans')).plans;
  } catch {
    container.append(notFoundView());
    return;
  }

  const status = h('div', { class: 'dialog-status', role: 'status', id: 'plan-status' });
  container.append(h('h1', { class: 'screen-title' }, 'Plans'), status);

  for (const plan of plans) {
    const tile = h('div', { class: 'tile plan-tile' }, h('p', { class: 'tile-label' }, plan.name), h('p', { class: 'tile-sub' }, `${plan.weeks} weeks`));
    const applyButton = h('button', { class: 'pill pill-primary' }, `Apply ${plan.name}`);

    applyButton.addEventListener('click', () => {
      const athleteSelect = h('select', { class: 'field', 'aria-label': 'Athlete' }) as HTMLSelectElement;
      for (const athlete of ctx.athletes) {
        const option = h('option', { value: athlete.id }, athlete.name);
        athleteSelect.append(option);
      }
      const modeStart = h('input', { type: 'radio', name: 'plan-mode', id: 'mode-start', value: 'start' }) as HTMLInputElement;
      const modeEvent = h('input', { type: 'radio', name: 'plan-mode', id: 'mode-event', value: 'event' }) as HTMLInputElement;
      modeStart.checked = true;
      const dateInput = h('input', { class: 'field', type: 'date', 'aria-label': 'Date' }) as HTMLInputElement;
      const eventName = h('input', { class: 'field', type: 'text', 'aria-label': 'Event name' }) as HTMLInputElement;
      const apply = h('button', { class: 'pill pill-primary' }, 'Apply plan');
      const cancel = h('button', { class: 'pill pill-ghost' }, 'Cancel');

      const dialog = h(
        'div',
        { class: 'dialog', role: 'dialog', 'aria-label': `Apply plan`, id: 'apply-plan-dialog' },
        h('h2', { class: 'dialog-title' }, `Apply ${plan.name}`),
        h('label', { class: 'field-label', for: 'athlete-select' }, 'Athlete'),
        athleteSelect,
        h('div', { class: 'radiogroup' },
          h('label', { class: 'radio-label', for: 'mode-start' }, modeStart, 'Start on'),
          h('label', { class: 'radio-label', for: 'mode-event' }, modeEvent, 'Count back from event')
        ),
        h('label', { class: 'field-label', for: 'plan-date' }, 'Date'),
        dateInput,
        h('label', { class: 'field-label', for: 'event-name' }, 'Event name'),
        eventName,
        h('div', { class: 'dialog-actions' }, apply, cancel),
        h('div', { class: 'dialog-status', role: 'status', id: 'apply-status' })
      );
      document.body.append(dialog);
      athleteSelect.focus();

      const close = (): void => dialog.remove();
      cancel.addEventListener('click', close);
      dialog.addEventListener('keydown', (event) => {
        const ke = event as KeyboardEvent;
        if (ke.key === 'Escape') close();
      });

      apply.addEventListener('click', async () => {
        apply.disabled = true;
        apply.textContent = 'Applying…';
        const dialogStatus = dialog.querySelector<HTMLElement>('#apply-status');
        try {
          const res = await api.post<{ created: number; skipped: number; kept: number }>(`/plans/${plan.id}/apply`, {
            athlete_id: athleteSelect.value,
            mode: modeEvent.checked ? 'event' : 'start',
            date: dateInput.value,
            event_name: modeEvent.checked ? eventName.value : undefined,
          });
          const workoutWord = res.created === 1 ? 'workout' : 'workouts';
          const athleteName = ctx.athletes.find((a) => a.id === athleteSelect.value)?.name ?? '';
          let text = `Added ${res.created} ${workoutWord} to ${athleteName}'s calendar. Skipped ${res.skipped} on days that have already passed.`;
          if (res.kept > 0) {
            const dayWord = res.kept === 1 ? 'day' : 'days';
            text += ` ${res.kept} ${dayWord} already had workouts; they were kept alongside the plan.`;
          }
          if (dialogStatus) dialogStatus.textContent = text;
          status.textContent = text;
          apply.textContent = 'Apply plan';
          apply.disabled = false;
          window.setTimeout(close, 900);
        } catch (err) {
          apply.disabled = false;
          apply.textContent = 'Apply plan';
          if (dialogStatus) dialogStatus.textContent = (err as Error).message;
        }
      });
    });

    tile.append(applyButton);
    container.append(tile);
  }
  void api;
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
