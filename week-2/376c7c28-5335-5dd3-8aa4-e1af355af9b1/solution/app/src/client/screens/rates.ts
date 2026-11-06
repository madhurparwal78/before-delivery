import { get, post, RequestFailed } from '../api.ts';
import { studio, type ScreenRender } from '../app.ts';
import { el, field, replace, setFieldError } from '../dom.ts';
import { studioDateLabel } from '../format.ts';
import { failureCopy, Region, withPending } from '../feedback.ts';
import { onLive } from '../live.ts';
import type { RateSchedule } from '../types.ts';

const RATE_FIELDS = [
  { key: 'member_bisque_cents', label: 'Member bisque (¢/cu in)' },
  { key: 'member_glaze_cents', label: 'Member glaze (¢/cu in)' },
  { key: 'dropoff_bisque_cents', label: 'Drop-off bisque (¢/cu in)' },
  { key: 'dropoff_glaze_cents', label: 'Drop-off glaze (¢/cu in)' },
] as const;

export const renderRates: ScreenRender = ({ mount }) => {
  const region = new Region('Rates status');
  const tableBody = el('tbody');
  const dateInput = el('input', { type: 'date' });
  const dateField = field('Effective from', dateInput, 'rates-from');
  const inputs = RATE_FIELDS.map((entry) => {
    const input = el('input', { type: 'number', step: '1', min: '1', max: '100', 'aria-label': entry.label });
    return { entry, input, ...field(entry.label, input, `rates-${entry.key}`) };
  });
  const submit = el('button', { type: 'submit', class: 'btn primary', text: 'SCHEDULE RATES' });

  const form = el('form', { novalidate: true, class: 'stack' }, [
    dateField.wrap,
    ...inputs.map((item) => item.wrap),
    submit,
    region.node,
  ]);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setFieldError(dateInput, dateField.error, '');
    for (const item of inputs) setFieldError(item.input, item.error, '');
    void withPending(region, submit, 'Scheduling…', async () => {
      const body: Record<string, unknown> = { effective_from: dateInput.value };
      for (const item of inputs) body[item.entry.key] = Number(item.input.value);
      try {
        await post<RateSchedule>('/api/rate-schedules', body);
        region.say(`Rates scheduled from ${studioDateLabel(dateInput.value)}.`);
        await load();
      } catch (error) {
        if (!(error instanceof RequestFailed)) throw error;
        const errors = error.failure.errors ?? {};
        setFieldError(dateInput, dateField.error, errors['effective_from'] ?? '');
        for (const item of inputs) {
          setFieldError(item.input, item.error, errors[item.entry.key] ?? '');
        }
        region.say(failureCopy(error.failure, {}));
      }
    });
  });

  mount.appendChild(
    el('div', { class: 'split-half' }, [
      el('section', { class: 'panel' }, [
        el('h1', { class: 'heading', text: 'RATES' }),
        // the table scrolls inside its panel, so a narrow screen never scrolls sideways
        el('div', { class: 'table-scroll', tabindex: '0' }, [el('table', { class: 'table', 'aria-label': 'Rate schedules' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { scope: 'col', text: 'Effective from' }),
              el('th', { scope: 'col', text: 'Member bisque' }),
              el('th', { scope: 'col', text: 'Member glaze' }),
              el('th', { scope: 'col', text: 'Drop-off bisque' }),
              el('th', { scope: 'col', text: 'Drop-off glaze' }),
            ]),
          ]),
          tableBody,
        ])]),
      ]),
      el('section', { class: 'panel' }, [
        el('h2', { class: 'heading small', text: 'SCHEDULE RATES' }),
        form,
      ]),
    ]),
  );

  async function load(): Promise<void> {
    const schedules = await get<RateSchedule[]>('/api/rate-schedules').catch(() => null);
    if (!schedules) return;
    replace(
      tableBody,
      schedules.map((schedule) =>
        el('tr', {}, [
          el('td', { text: studioDateLabel(schedule.effective_from) }),
          el('td', { class: 'mono', text: `${schedule.member_bisque_cents}¢` }),
          el('td', { class: 'mono', text: `${schedule.member_glaze_cents}¢` }),
          el('td', { class: 'mono', text: `${schedule.dropoff_bisque_cents}¢` }),
          el('td', { class: 'mono', text: `${schedule.dropoff_glaze_cents}¢` }),
        ]),
      ),
    );
  }

  dateInput.value = studio()?.today ?? '';
  // hidden until the first schedules land, so the filling table never shifts the visible layout
  const screenRoot = mount.lastElementChild as HTMLElement | null;
  if (screenRoot) screenRoot.style.visibility = 'hidden';
  void load().finally(() => {
    if (screenRoot) screenRoot.style.visibility = '';
  });
  return onLive((message) => {
    if (message.kind === 'rates') void load();
  });
};
