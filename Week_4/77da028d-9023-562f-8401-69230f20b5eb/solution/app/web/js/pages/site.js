import { h } from '../core/dom.js';
import { api } from '../core/api.js';
import { announce, liveRegion } from '../core/live.js';
import { CHECK_FIELDS, clearInvalid, createErrorSummary, field } from '../core/forms.js';
import { hhmm, UNSENT_PUSH } from '../core/format.js';
import { mountShell } from '../shell.js';
import { createHorizonPainter } from './horizon-painter.js';
import { parseNumber } from './values.js';

const REFRESH_MS = 60000;
const PUSH_LOG_UNAVAILABLE = 'The push log is unavailable right now.';
const PUSH_STATES = { queued: 'Queued', sent: 'Sent' };

function timeZoneOptions(current) {
  const zones = new Set([...Intl.supportedValuesOf('timeZone'), 'UTC', current]);
  return [...zones].sort().map((zone) => h('option', { value: zone, selected: zone === current }, zone));
}

function reminderItem(occurrence) {
  return h('li', {}, `${occurrence.remind_local.slice(0, 10)} ${hhmm(occurrence.remind_local)} before the new moon of ${occurrence.new_moon_local_date}`);
}

function pushRow(push) {
  return h('tr', {},
    h('td', {}, push.title),
    h('td', {}, push.status === 'unsent' ? UNSENT_PUSH : PUSH_STATES[push.status]),
    h('td', { class: 'num' }, String(push.attempts)),
    h('td', { class: 'num' }, push.sent_at ? `${push.sent_at.slice(0, 16).replace('T', ' ')} UTC` : '-'));
}

function siteForm({ site, updates, refreshCard }) {
  const summary = createErrorSummary();
  const inputs = {
    label: h('input', { type: 'text', maxlength: '60', value: site.label, 'data-field': 'label' }),
    latitude: h('input', { type: 'text', inputmode: 'decimal', value: String(site.latitude), 'data-field': 'latitude' }),
    longitude: h('input', { type: 'text', inputmode: 'decimal', value: String(site.longitude), 'data-field': 'longitude' }),
    elevation_m: h('input', { type: 'text', inputmode: 'decimal', value: String(site.elevation_m), 'data-field': 'elevation_m' }),
    time_zone: h('select', { 'data-field': 'time_zone' }, timeZoneOptions(site.time_zone)),
    push_topic: h('input', { type: 'text', maxlength: '64', value: site.push_topic ?? '', autocomplete: 'off', 'data-field': 'push_topic' }),
  };
  const save = h('button', { type: 'submit', class: 'btn btn--primary' }, 'Save site');
  const form = h('form', { class: 'card site-form', novalidate: true },
    h('h2', {}, 'Site'),
    summary.element,
    field({ label: 'Site label', input: inputs.label }),
    field({ label: 'Latitude', input: inputs.latitude }),
    field({ label: 'Longitude', input: inputs.longitude }),
    field({ label: 'Elevation (m)', input: inputs.elevation_m }),
    field({ label: 'Time zone', input: inputs.time_zone }),
    field({ label: 'Push topic', input: inputs.push_topic, hint: 'Where verdict and reminder pushes are sent. Leave blank for none.' }),
    save);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    summary.clear();
    clearInvalid(form);
    save.disabled = true;
    announce(updates, 'Saving site...');
    try {
      await api('PATCH', '/api/site', { body: {
        label: inputs.label.value.trim(),
        latitude: parseNumber(inputs.latitude.value),
        longitude: parseNumber(inputs.longitude.value),
        elevation_m: parseNumber(inputs.elevation_m.value),
        time_zone: inputs.time_zone.value,
        push_topic: inputs.push_topic.value.trim() || null,
      } });
      announce(updates, 'Site saved.');
      refreshCard();
    } catch (error) {
      if (error.fields) summary.showFields(error.fields, (name) => form.querySelector(`[data-field="${name}"]`));
      else summary.showMessage(error.message);
      announce(updates, error.fields ? CHECK_FIELDS : error.message);
    } finally {
      save.disabled = false;
    }
  });
  return form;
}

function reminderCard({ reminder, updates }) {
  const summary = createErrorSummary();
  const enabled = h('input', { type: 'checkbox', id: 'reminder-enabled', checked: reminder.enabled });
  const time = h('input', { type: 'text', value: reminder.local_time, placeholder: 'HH:MM', autocomplete: 'off', 'data-field': 'local_time' });
  const upcoming = h('ul', { 'aria-label': 'Upcoming reminders', role: 'list', class: 'reminder-list' }, reminder.upcoming.map(reminderItem));
  const save = h('button', { type: 'submit', class: 'btn' }, 'Save reminder');
  const form = h('form', { class: 'card reminder-card', novalidate: true },
    h('h2', {}, 'New-moon weekend reminder'),
    summary.element,
    h('div', { class: 'field' }, h('label', { class: 'check', for: 'reminder-enabled' }, enabled, 'New-moon weekend reminder')),
    field({ label: 'Reminder time', input: time, hint: 'Site time, HH:MM. Sent on the Friday before each new-moon weekend.' }),
    save,
    h('h3', {}, 'Upcoming reminders'),
    upcoming);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    summary.clear();
    clearInvalid(form);
    try {
      const saved = await api('PUT', '/api/reminders/new-moon', { body: { enabled: enabled.checked, local_time: time.value.trim() } });
      upcoming.replaceChildren(...saved.upcoming.map(reminderItem));
      announce(updates, 'Reminder saved.');
    } catch (error) {
      if (error.fields) summary.showFields(error.fields, (name) => form.querySelector(`[data-field="${name}"]`));
      else summary.showMessage(error.message);
    }
  });
  return form;
}

export async function mount() {
  const { main, refresh: refreshCard } = mountShell({ page: 'site' });
  const updates = liveRegion('Site updates');
  const [site, horizon, reminders] = await Promise.all([
    api('GET', '/api/site'),
    api('GET', '/api/site/horizon'),
    api('GET', '/api/reminders/new-moon').then(
      (reminder) => reminderCard({ reminder, updates }),
      (error) => h('section', { class: 'card reminder-card' }, h('h2', {}, 'New-moon weekend reminder'), h('p', {}, error.message))),
  ]);

  const painter = createHorizonPainter({
    altitudes: horizon.altitudes,
    onSave: async (altitudes) => {
      try {
        await api('PUT', '/api/site/horizon', { body: { altitudes } });
        announce(updates, 'Horizon saved.');
        refreshCard();
      } catch {
        announce(updates, 'The horizon was not saved. Try again.');
      }
    },
  });

  const pushHost = h('div');
  async function loadPushes() {
    try {
      const { pushes } = await api('GET', '/api/pushes');
      pushHost.replaceChildren(h('div', { class: 'sheet', tabindex: '0' },
        h('table', { 'aria-label': 'Push log' },
          h('thead', {}, h('tr', {}, ['Title', 'State', 'Attempts', 'Sent time'].map((label) => h('th', {}, label)))),
          h('tbody', {}, pushes.map(pushRow)))));
    } catch {
      pushHost.replaceChildren(h('p', {}, PUSH_LOG_UNAVAILABLE));
    }
    setTimeout(loadPushes, REFRESH_MS);
  }

  main.append(
    h('div', { class: 'page-head' }, h('h1', {}, 'Site')),
    updates,
    h('div', { class: 'site-top' },
      siteForm({ site, updates, refreshCard }),
      h('section', { class: 'card painter-card' },
        h('h2', {}, 'Horizon'),
        h('p', { class: 'muted' }, 'Paint the treeline by dragging across the strip, or focus it and use the arrow keys. Left to right is north through east, south and west; bottom to top is 0 to 90 degrees.'),
        painter.element)),
    reminders,
    h('section', { class: 'pushes', 'aria-label': 'Pushes' }, h('h2', {}, 'Pushes'), pushHost));
  await loadPushes();
}
