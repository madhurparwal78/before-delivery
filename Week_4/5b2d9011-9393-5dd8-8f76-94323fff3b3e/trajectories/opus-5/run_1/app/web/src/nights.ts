// The Nights screen: upcoming nights in both zones, the sign-up form, and the
// founder's weekly series and ammo-station price schedule.

import { Night, PricesView, api } from './api';
import { App } from './app';
import { FuseClock, FuseGroup } from './fuseclock';
import {
  clear,
  clockTime,
  dayMonth,
  dayMonthYear,
  el,
  viewerZone,
  zoneAbbr,
  zoneNames,
} from './core';

const statusWords: Record<Night['status'], string> = {
  scheduled: 'Opens soon',
  signups_open: 'Sign-ups open',
  closed: 'Sign-ups closed',
  live: 'Live now',
  done: 'Done',
};

const itemNames: Record<string, string> = {
  ammo_pack: 'Ammo pack',
  grenade: 'Grenade',
  med_kit: 'Med kit',
};

const weekdays = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

let seq = 0;

function field(
  label: string,
  attrs: Record<string, string> = {},
): { wrap: HTMLElement; input: HTMLInputElement; setError: (message: string) => void } {
  seq += 1;
  const id = `night-field-${seq}`;
  const input = el('input', { type: attrs.type ?? 'text', ...attrs }) as HTMLInputElement;
  input.setAttribute('aria-label', label);
  const error = el('div', { class: 'field-error', id });
  const wrap = el('div', { class: 'field' }, el('label', {}, label), input, error);
  return {
    wrap,
    input,
    setError: (message: string) => {
      error.textContent = message;
      if (message) input.setAttribute('aria-describedby', id);
      else input.removeAttribute('aria-describedby');
    },
  };
}

function select(
  label: string,
  options: { value: string; text: string }[],
): { wrap: HTMLElement; input: HTMLSelectElement; setError: (message: string) => void } {
  seq += 1;
  const id = `night-select-${seq}`;
  const input = el('select', {}) as HTMLSelectElement;
  input.setAttribute('aria-label', label);
  for (const option of options) {
    input.appendChild(el('option', { value: option.value }, option.text));
  }
  const error = el('div', { class: 'field-error', id });
  const wrap = el('div', { class: 'field' }, el('label', {}, label), input, error);
  return {
    wrap,
    input,
    setError: (message: string) => {
      error.textContent = message;
      if (message) input.setAttribute('aria-describedby', id);
      else input.removeAttribute('aria-describedby');
    },
  };
}

const hhmm = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const isoDate = /^\d{4}-\d{2}-\d{2}$/;
const effectiveShape = /^\d{4}-\d{2}-\d{2}[T ]([01][0-9]|2[0-3]):[0-5][0-9]$/;

export function openNights(app: App): void {
  const opener = document.activeElement as HTMLElement | null;
  const root = el('div', {
    class: 'panel wide',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Nights',
  });

  const list = el('div', { role: 'list', 'aria-label': 'Upcoming nights' });
  const pricesHost = el('div', {});
  const founderBar = el('div', { class: 'row end' });

  root.append(
    el('div', { class: 'panel-head' }, el('h2', {}, 'Nights'), el('span', { class: 'panel-title' }, 'Calendar')),
    founderBar,
    list,
    pricesHost,
  );

  const clocks = new FuseGroup();
  let timer = 0;
  let ticker = 0;

  const panel = app.mountDialog(root, opener, () => {
    window.clearTimeout(timer);
    window.clearInterval(ticker);
  });
  app.openPanel(panel);

  const refresh = async () => {
    try {
      const { nights } = await api.nights(28);
      renderNights(app, list, nights, clocks, () => void refresh());
    } catch (error) {
      clear(list);
      list.appendChild(el('div', { class: 'empty' }, app.errorCopy(error)));
      const again = el('button', { class: 'btn-ghost', type: 'button' }, 'Try again');
      again.setAttribute('aria-label', 'Try again');
      again.addEventListener('click', () => void refresh());
      list.appendChild(again);
    }
    renderFounderTools(app, founderBar, pricesHost, clocks, () => void refresh());
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void refresh(), 10_000);
  };

  // Rows refresh every ten seconds, and again as soon as a timer reaches zero.
  ticker = window.setInterval(() => {
    clocks.tick();
    for (const entry of clocks.entries()) {
      if (entry.value === '0.0') {
        void refresh();
        break;
      }
    }
  }, 100);

  void refresh();
}

function renderNights(
  app: App,
  host: HTMLElement,
  nights: Night[],
  clocks: FuseGroup,
  refresh: () => void,
): void {
  clear(host);
  if (nights.length === 0) {
    host.appendChild(el('div', { class: 'empty' }, 'No nights scheduled.'));
    return;
  }

  const viewer = viewerZone();
  let heading = '';
  for (const night of nights) {
    const dateHeading = dayMonthYear(night.starts_at, app.studioZone);
    if (dateHeading !== heading) {
      heading = dateHeading;
      host.appendChild(el('h3', { class: 'date-heading' }, dateHeading));
    }

    const studioLine =
      `${night.local_start} ${night.zone_abbr} studio · Your time ` +
      `${dayMonth(night.starts_at, viewer)} ${clockTime(night.starts_at, viewer)} ` +
      `${zoneAbbr(night.starts_at, viewer)}`;

    const row = el('div', { class: 'night-row', role: 'listitem' });
    row.append(
      el('h3', {}, night.title),
      el('div', { class: 'note' }, studioLine),
      el(
        'div',
        { class: 'row wrap' },
        el('span', { class: 'label' }, statusWords[night.status]),
        el('span', { class: 'label' }, `Seats left ${night.seats_left}`),
        el('span', { class: 'label' }, night.mode === 'convoy' ? 'Convoy' : 'Siege'),
      ),
    );

    if (night.status === 'signups_open') {
      const clock = clocks.get(`signups:${night.id}`, 'Sign-ups close');
      clock.update(night.status_changes_in_ms);
      row.appendChild(el('div', { class: 'note' }, 'Sign-ups close ', clock.root));
    } else {
      clocks.drop(`signups:${night.id}`);
    }

    const label = `Sign up for ${night.title} on ${dayMonth(night.starts_at, app.studioZone)}`;
    const button = el('button', { class: 'btn-mint', type: 'button' }, label) as HTMLButtonElement;
    button.setAttribute('aria-label', label);
    button.disabled = night.status !== 'signups_open';
    button.addEventListener('click', () => openSignup(app, night, refresh));
    row.appendChild(el('div', { class: 'row end' }, button));

    host.appendChild(row);
  }
}

// ---------- Sign up ----------

function openSignup(app: App, night: Night, refresh: () => void): void {
  const opener = document.activeElement as HTMLElement | null;
  const root = el('div', {
    class: 'panel',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Sign up',
  });

  const name = field('Name', { maxlength: '40', autocomplete: 'name' });
  const email = field('Email', { type: 'email', autocomplete: 'email' });
  const zone = select(
    'Your time zone',
    zoneNames().map((value) => ({ value, text: value })),
  );
  zone.input.value = viewerZone();

  const clock = new FuseClock('Sign-ups close');
  clock.update(night.status_changes_in_ms);
  const deadline = el('div', { class: 'note' }, 'Sign-ups close ', clock.root);
  const ticker = window.setInterval(() => clock.tick(), 100);

  const submit = el('button', { class: 'btn-mint', type: 'button' }, 'Sign me up') as HTMLButtonElement;
  submit.setAttribute('aria-label', 'Sign me up');

  root.append(
    el('div', { class: 'panel-head' }, el('h2', {}, night.title), el('span', { class: 'panel-title' }, 'Sign up')),
    el(
      'div',
      { class: 'note' },
      `${night.local_start} ${night.zone_abbr} studio · ` +
        `Your time ${dayMonth(night.starts_at, viewerZone())} ${clockTime(night.starts_at, viewerZone())} ` +
        `${zoneAbbr(night.starts_at, viewerZone())}`,
    ),
    deadline,
    el('div', { class: 'panel-body' }, name.wrap, email.wrap, zone.wrap),
    el('div', { class: 'row end' }, submit),
  );

  const dialog = app.mountDialog(root, opener, () => window.clearInterval(ticker));

  submit.addEventListener('click', () => {
    name.setError('');
    email.setError('');
    zone.setError('');
    submit.disabled = true;
    app.notify('Signing you up…');

    void api
      .signup(night.id, name.input.value.trim(), email.input.value.trim(), zone.input.value)
      .then((result) => {
        const when = dayMonth(night.starts_at, app.studioZone);
        if (result.email_status === 'already_signed_up') {
          app.notify("You're already signed up for this night.");
        } else if (result.email_status === 'queued') {
          app.notify(
            `You're signed up for ${night.title} on ${when}. ` +
              'Confirmation email: queued — it sends when mail is back.',
          );
        } else {
          app.notify(`You're signed up for ${night.title} on ${when}. Confirmation email: sent.`);
        }
        dialog.close();
        refresh();
      })
      .catch((error) => {
        submit.disabled = false;
        const fields = (error as { fields?: Record<string, string> }).fields ?? {};
        if (fields.name || fields.email || fields.viewer_zone) {
          name.setError(fields.name ?? '');
          email.setError(fields.email ?? '');
          zone.setError(fields.viewer_zone ?? '');
          app.clearNotice();
          return;
        }
        app.notify(
          app.errorCopy(error, {
            signups_closed:
              `Sign-ups for this night closed at ${clockTime(night.signups_close_at, app.studioZone)} ` +
              `${zoneAbbr(night.signups_close_at, app.studioZone)} studio time.`,
            signups_not_open:
              `Sign-ups open ${dayMonth(night.signups_open_at, app.studioZone)} ` +
              `${clockTime(night.signups_open_at, app.studioZone)} ` +
              `${zoneAbbr(night.signups_open_at, app.studioZone)} studio time.`,
            night_full: 'This night is full.',
          }),
        );
      });
  });

  name.input.focus();
}

// ---------- Founder tools ----------

function renderFounderTools(
  app: App,
  bar: HTMLElement,
  pricesHost: HTMLElement,
  clocks: FuseGroup,
  refresh: () => void,
): void {
  clear(bar);
  if (app.player?.role !== 'founder') {
    clear(pricesHost);
    return;
  }

  const newNight = el('button', { class: 'btn-ghost', type: 'button' }, 'New weekly night');
  newNight.setAttribute('aria-label', 'New weekly night');
  newNight.addEventListener('click', () => openSeriesDialog(app, refresh));
  bar.appendChild(newNight);

  void renderPrices(app, pricesHost, clocks, refresh);
}

async function renderPrices(
  app: App,
  host: HTMLElement,
  clocks: FuseGroup,
  refresh: () => void,
): Promise<void> {
  let view: PricesView;
  try {
    view = await api.prices();
  } catch (error) {
    clear(host);
    host.appendChild(el('div', { class: 'empty' }, app.errorCopy(error)));
    return;
  }

  clear(host);
  const region = el('div', { role: 'region', 'aria-label': 'Ammo station prices' });
  const schedule = el('button', { class: 'btn-ghost', type: 'button' }, 'Schedule price change');
  schedule.setAttribute('aria-label', 'Schedule price change');
  schedule.addEventListener('click', () => openPriceDialog(app, refresh));

  const table = el('table', { 'aria-label': 'Price schedule' });
  const body = el('tbody', {});
  table.append(
    el(
      'thead',
      {},
      el('tr', {}, el('th', {}, 'Item'), el('th', {}, 'Price'), el('th', {}, 'Effective (studio)'), el('th', {}, 'Status')),
    ),
    body,
  );

  const statusLabel: Record<string, string> = {
    in_effect: 'In effect',
    pending: 'Pending',
    superseded: 'Superseded',
  };

  for (const row of view.schedule) {
    const itemName = itemNames[row.item] ?? row.item;
    const printed = row.effective_local.replace('T', ' ');
    const statusCell = el('td', {}, statusLabel[row.status]);

    if (row.status === 'pending') {
      const clock = clocks.get(`price:${row.id}`, `Price change ${itemName}`);
      const next = view.items.find((item) => item.next_change?.id === row.id)?.next_change;
      clock.update(next ? next.in_ms : null);
      statusCell.append(' ', clock.root);

      const label = `Remove ${itemName} change at ${printed}`;
      const remove = el('button', { class: 'btn-ghost', type: 'button' }, 'Remove');
      remove.setAttribute('aria-label', label);
      remove.addEventListener('click', () => {
        app.notify('Removing…');
        remove.disabled = true;
        void api
          .deletePriceChange(row.id)
          .then(() => {
            app.notify('Price change removed.');
            refresh();
          })
          .catch((error) => {
            remove.disabled = false;
            app.reportError(error);
          });
      });
      statusCell.appendChild(remove);
    } else {
      clocks.drop(`price:${row.id}`);
    }

    body.appendChild(
      el('tr', {}, el('td', {}, itemName), el('td', {}, `${row.price} cr`), el('td', {}, printed), statusCell),
    );
  }

  region.append(
    el('div', { class: 'panel-head' }, el('h3', {}, 'Ammo station prices'), schedule),
    table,
  );
  host.appendChild(region);
}

function openPriceDialog(app: App, refresh: () => void): void {
  const opener = document.activeElement as HTMLElement | null;
  const root = el('div', {
    class: 'panel',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Schedule price change',
  });

  const item = select('Item', [
    { value: 'ammo_pack', text: 'Ammo pack' },
    { value: 'grenade', text: 'Grenade' },
    { value: 'med_kit', text: 'Med kit' },
  ]);
  const price = field('New price', { type: 'number', min: '1', max: '5000', step: '1' });
  const effective = field('Effective (studio time)', { placeholder: '2026-11-20 19:30' });
  const save = el('button', { class: 'btn-mint', type: 'button' }, 'Save price change') as HTMLButtonElement;
  save.setAttribute('aria-label', 'Save price change');

  root.append(
    el(
      'div',
      { class: 'panel-head' },
      el('h2', {}, 'Schedule price change'),
      el('span', { class: 'panel-title' }, 'Prices'),
    ),
    el('div', { class: 'panel-body' }, item.wrap, price.wrap, effective.wrap),
    el('div', { class: 'row end' }, save),
  );

  const dialog = app.mountDialog(root, opener);

  save.addEventListener('click', () => {
    price.setError('');
    effective.setError('');

    // A value in any other shape shows its field error without sending.
    const typed = effective.input.value.trim();
    if (!effectiveShape.test(typed)) {
      effective.setError('Pick a time after now, in studio time.');
      return;
    }
    const amount = Number(price.input.value);
    if (!Number.isInteger(amount) || amount < 1 || amount > 5000) {
      price.setError('Use a whole number from 1 to 5000.');
      return;
    }

    save.disabled = true;
    app.notify('Saving price change…');
    void api
      .createPriceChange(item.input.value, amount, typed.replace(' ', 'T'))
      .then((row) => {
        const itemName = itemNames[row.item] ?? row.item;
        app.notify(
          `Price change saved: ${itemName} becomes ${row.price} cr at ` +
            `${row.effective_local.replace('T', ' ')} ${zoneAbbr(row.effective_at, app.studioZone)}.`,
        );
        dialog.close();
        refresh();
      })
      .catch((error) => {
        save.disabled = false;
        const fields = (error as { fields?: Record<string, string> }).fields ?? {};
        if (fields.price || fields.effective_local) {
          price.setError(fields.price ?? '');
          effective.setError(fields.effective_local ?? '');
          app.clearNotice();
          return;
        }
        app.notify(
          app.errorCopy(error, {
            price_change_exists: `A change for ${itemNames[item.input.value]} at that time already exists.`,
          }),
        );
      });
  });

  item.input.focus();
}

function openSeriesDialog(app: App, refresh: () => void): void {
  const opener = document.activeElement as HTMLElement | null;
  const root = el('div', {
    class: 'panel',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'New weekly night',
  });

  const title = field('Title', { maxlength: '60' });
  const mode = select('Mode', [
    { value: 'siege', text: 'Siege' },
    { value: 'convoy', text: 'Convoy' },
  ]);
  const weekday = select(
    'Weekday',
    weekdays.map((day) => ({ value: day.toLowerCase(), text: day })),
  );
  const startTime = field('Start time', { placeholder: '20:00' });
  const firstDate = field('First date', { placeholder: '2026-11-20' });
  const weeks = field('Weeks', { type: 'number', min: '1', max: '26', step: '1', value: '8' });
  const capacity = field('Capacity', { type: 'number', min: '1', max: '64', step: '1', value: '24' });
  const save = el('button', { class: 'btn-mint', type: 'button' }, 'Schedule nights') as HTMLButtonElement;
  save.setAttribute('aria-label', 'Schedule nights');

  root.append(
    el(
      'div',
      { class: 'panel-head' },
      el('h2', {}, 'New weekly night'),
      el('span', { class: 'panel-title' }, 'Series'),
    ),
    el(
      'div',
      { class: 'panel-body' },
      title.wrap,
      mode.wrap,
      weekday.wrap,
      startTime.wrap,
      firstDate.wrap,
      weeks.wrap,
      capacity.wrap,
    ),
    el('div', { class: 'row end' }, save),
  );

  const dialog = app.mountDialog(root, opener);

  save.addEventListener('click', () => {
    for (const entry of [title, startTime, firstDate, weeks, capacity]) entry.setError('');

    const weekdayName = weekday.input.options[weekday.input.selectedIndex].text;
    if (!hhmm.test(startTime.input.value.trim())) {
      startTime.setError('Use HH:MM, 24-hour.');
      return;
    }
    if (!isoDate.test(firstDate.input.value.trim())) {
      firstDate.setError(`Must be a ${weekdayName} after today, studio time.`);
      return;
    }

    save.disabled = true;
    app.notify('Scheduling…');
    void api
      .createSeries({
        title: title.input.value.trim(),
        mode: mode.input.value,
        weekday: weekday.input.value,
        local_time: startTime.input.value.trim(),
        first_date: firstDate.input.value.trim(),
        weeks: Number(weeks.input.value),
        capacity: Number(capacity.input.value),
      })
      .then((result) => {
        app.notify(`Scheduled ${result.nights.length} nights of ${result.series.title}.`);
        dialog.close();
        refresh();
      })
      .catch((error) => {
        save.disabled = false;
        const fields = (error as { fields?: Record<string, string> }).fields ?? {};
        if (Object.keys(fields).length > 0) {
          title.setError(fields.title ?? '');
          startTime.setError(fields.local_time ?? '');
          firstDate.setError(fields.first_date ?? '');
          weeks.setError(fields.weeks ?? '');
          capacity.setError(fields.capacity ?? '');
          app.clearNotice();
          return;
        }
        app.reportError(error);
      });
  });

  title.input.focus();
}
