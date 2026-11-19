import { api } from '../api.js';
import { announce, clear, el, textbox } from '../dom.js';
import { hhmm, isoDateOf, siteStamp } from '../format.js';
import { UNSENT_PUSH } from '../copy.js';
import { pushStateFor } from '../verdictcard.js';
import {
  BIN_COUNT,
  altitudeAt,
  binAt,
  paintHorizon,
  painterName,
} from '../painter.js';

const PUSH_LOG_DOWN = 'The push log is unavailable right now.';
const HORIZON_FAILED = 'The horizon was not saved. Try again.';
const KEY_SAVE_DELAY_MS = 500;

function zoneOptions(current) {
  const zones =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : [current, 'UTC', 'Europe/London', 'Europe/Madrid'];
  const unique = [...new Set([current, ...zones])];
  return unique.map((zone) =>
    el('option', { value: zone, text: zone, selected: zone === current }),
  );
}

export async function renderSite(main, context) {
  const site = await api('GET', '/api/site');
  const horizon = await api('GET', '/api/site/horizon');
  let mask = [...horizon.altitudes];
  let selected = 0;

  const label = textbox('Site label', { id: 'st-label', value: site.label });
  const latitude = textbox('Latitude', { id: 'st-lat', value: String(site.latitude) });
  const longitude = textbox('Longitude', {
    id: 'st-lon',
    value: String(site.longitude),
  });
  const elevation = textbox('Elevation (m)', {
    id: 'st-elev',
    value: String(site.elevation_m),
  });
  const timeZone = el(
    'select',
    { 'aria-label': 'Time zone', id: 'st-zone' },
    zoneOptions(site.time_zone),
  );
  const pushTopic = textbox('Push topic', {
    id: 'st-topic',
    value: site.push_topic || '',
  });
  const saveSite = el('button', { type: 'button', class: 'pill', text: 'Save site' });
  const updates = el('div', { role: 'status', 'aria-label': 'Site updates' });
  const summary = el('div', {
    role: 'alert',
    'aria-label': 'Error summary',
    class: 'error-summary',
    hidden: true,
  });

  const painter = el('canvas', {
    class: 'painter',
    role: 'img',
    tabindex: '0',
    'aria-label': painterName(mask, 0),
  });

  const reminderOn = el('input', {
    type: 'checkbox',
    id: 'rm-on',
    'aria-label': 'New-moon weekend reminder',
  });
  const reminderTime = textbox('Reminder time', { id: 'rm-time', placeholder: 'HH:MM' });
  const saveReminder = el('button', { type: 'button', text: 'Save reminder' });
  const upcoming = el('ul', { 'aria-label': 'Upcoming reminders' });
  const pushRegion = el('section', { 'aria-label': 'Pushes' });

  main.append(
    el('div', { class: 'stack' }, [
      el('h1', { text: 'Site' }),
      el('div', { class: 'two-up' }, [
        el('div', { class: 'card stack' }, [
          summary,
          el('div', { class: 'form-grid' }, [
            el('div', { class: 'field' }, [
              el('label', { for: 'st-label', text: 'Site label' }),
              label,
            ]),
            el('div', { class: 'field' }, [
              el('label', { for: 'st-lat', text: 'Latitude' }),
              latitude,
            ]),
            el('div', { class: 'field' }, [
              el('label', { for: 'st-lon', text: 'Longitude' }),
              longitude,
            ]),
            el('div', { class: 'field' }, [
              el('label', { for: 'st-elev', text: 'Elevation (m)' }),
              elevation,
            ]),
            el('div', { class: 'field' }, [
              el('label', { for: 'st-zone', text: 'Time zone' }),
              timeZone,
            ]),
            el('div', { class: 'field' }, [
              el('label', { for: 'st-topic', text: 'Push topic' }),
              pushTopic,
            ]),
          ]),
          saveSite,
          updates,
        ]),
        el('div', { class: 'card painter-frame stack' }, [
          el('h2', { text: 'Treeline' }),
          painter,
          el('p', {
            class: 'muted',
            text: 'Drag across the strip, or use the arrow keys, to paint the treeline.',
          }),
        ]),
      ]),
      context.card,
      el('div', { class: 'card stack' }, [
        el('h2', { text: 'New-moon weekend reminder' }),
        el('label', { for: 'rm-on' }, [reminderOn, ' New-moon weekend reminder']),
        el('div', { class: 'field' }, [
          el('label', { for: 'rm-time', text: 'Reminder time' }),
          reminderTime,
        ]),
        saveReminder,
        upcoming,
      ]),
      pushRegion,
    ]),
  );

  function repaint() {
    paintHorizon(painter, mask, selected);
    painter.setAttribute('aria-label', painterName(mask, selected));
  }

  async function saveHorizon() {
    try {
      await api('PUT', '/api/site/horizon', { altitudes: mask });
      announce(updates, 'Horizon saved.');
      await refreshVerdict();
    } catch (_) {
      announce(updates, HORIZON_FAILED);
    }
  }

  let dragging = false;
  painter.addEventListener('pointerdown', (event) => {
    dragging = true;
    painter.setPointerCapture(event.pointerId);
    selected = binAt(painter, event.clientX);
    mask[selected] = altitudeAt(painter, event.clientY);
    repaint();
  });
  painter.addEventListener('pointermove', (event) => {
    if (!dragging) return;
    selected = binAt(painter, event.clientX);
    mask[selected] = altitudeAt(painter, event.clientY);
    repaint();
  });
  painter.addEventListener('pointerup', () => {
    if (!dragging) return;
    dragging = false;
    saveHorizon();
  });

  let keyTimer = null;
  painter.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 5 : 1;
    let changed = true;
    if (event.key === 'ArrowLeft') selected = (selected - 1 + BIN_COUNT) % BIN_COUNT;
    else if (event.key === 'ArrowRight') selected = (selected + 1) % BIN_COUNT;
    else if (event.key === 'ArrowUp') mask[selected] = Math.min(90, mask[selected] + step);
    else if (event.key === 'ArrowDown') mask[selected] = Math.max(0, mask[selected] - step);
    else changed = false;
    if (!changed) return;
    event.preventDefault();
    repaint();
    if (keyTimer) clearTimeout(keyTimer);
    keyTimer = setTimeout(saveHorizon, KEY_SAVE_DELAY_MS);
  });

  saveSite.addEventListener('click', async () => {
    clear(summary);
    summary.hidden = true;
    announce(updates, 'Saving site...');
    try {
      await api('PATCH', '/api/site', {
        label: label.value.trim(),
        latitude: Number(latitude.value),
        longitude: Number(longitude.value),
        elevation_m: Number(elevation.value),
        time_zone: timeZone.value,
        push_topic: pushTopic.value.trim() || null,
      });
      announce(updates, 'Site saved.');
      await refreshVerdict();
    } catch (error) {
      announce(updates, error.message);
      summary.hidden = false;
      const controls = {
        label,
        latitude,
        longitude,
        elevation_m: elevation,
        time_zone: timeZone,
        push_topic: pushTopic,
      };
      summary.append(
        el('p', { text: error.message }),
        el(
          'ul',
          {},
          Object.entries(error.fields || {}).map(([name, message]) =>
            el('li', {}, [
              el('a', {
                href: '#',
                text: message,
                onclick: (click) => {
                  click.preventDefault();
                  if (controls[name]) controls[name].focus();
                },
              }),
            ]),
          ),
        ),
      );
    }
  });

  async function paintReminder() {
    const reminder = await api('GET', '/api/reminders/new-moon');
    reminderOn.checked = reminder.enabled;
    if (document.activeElement !== reminderTime) {
      reminderTime.value = reminder.local_time;
    }
    clear(upcoming);
    for (const occurrence of reminder.upcoming) {
      upcoming.append(
        el('li', {
          class: 'num',
          text:
            `${isoDateOf(occurrence.remind_local)} ${hhmm(occurrence.remind_local)} ` +
            `before the new moon of ${occurrence.new_moon_local_date}`,
        }),
      );
    }
  }

  saveReminder.addEventListener('click', async () => {
    try {
      await api('PUT', '/api/reminders/new-moon', {
        enabled: reminderOn.checked,
        local_time: reminderTime.value.trim(),
      });
      await paintReminder();
      announce(updates, 'Reminder saved.');
    } catch (error) {
      announce(updates, error.message);
    }
  });

  async function paintPushes() {
    clear(pushRegion);
    pushRegion.append(el('h2', { text: 'Pushes' }));
    let pushes;
    try {
      pushes = (await api('GET', '/api/pushes')).pushes;
    } catch (_) {
      pushRegion.append(el('p', { text: PUSH_LOG_DOWN }));
      return null;
    }
    pushRegion.append(
      el('div', { class: 'table-sheet' }, [
        el('table', { 'aria-label': 'Push log' }, [
          el('thead', {}, [
            el('tr', {}, [
              el('th', { text: 'Title' }),
              el('th', { text: 'State' }),
              el('th', { text: 'Attempts' }),
              el('th', { text: 'Sent time' }),
            ]),
          ]),
          el(
            'tbody',
            {},
            pushes.map((push) =>
              el('tr', {}, [
                el('td', { text: push.title }),
                el('td', {
                  text: push.status === 'unsent' ? UNSENT_PUSH : push.status,
                }),
                el('td', { class: 'num', text: String(push.attempts) }),
                el('td', {
                  class: 'num',
                  text: push.sent_at ? siteStamp(push.sent_at, site.time_zone) : '\u2014',
                }),
              ]),
            ),
          ),
        ]),
      ]),
    );
    return pushes;
  }

  async function refreshVerdict() {
    const [plan, pushes] = await Promise.all([
      api('GET', '/api/tonight'),
      paintPushes(),
    ]);
    context.paintCard(plan, pushStateFor(pushes, plan.date));
  }

  const resize = () => repaint();
  window.addEventListener('resize', resize);
  repaint();
  await paintReminder();
  await refreshVerdict();
  return () => {
    window.removeEventListener('resize', resize);
    if (keyTimer) clearTimeout(keyTimer);
  };
}
