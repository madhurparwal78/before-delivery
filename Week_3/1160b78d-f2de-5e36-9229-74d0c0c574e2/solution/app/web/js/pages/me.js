// /me: zone, quiet hours, notification delays and the calendar feed. A stakeholder sees nothing here but Sign out.
import { html, useState, useEffect } from '../lib/html.js';
import { api, fieldErrors } from '../lib/api.js';
import { boot } from '../lib/boot.js';
import { live } from '../lib/live.js';
import { fmtLocal } from '../lib/format.js';
import { Button, Problems, FieldError } from '../lib/ui.js';

const DELAYS_SENTENCE = 'Use 1 to 5 whole minutes from 0 to 60, separated by commas.';
const URGENCY_SENTENCE = 'Use a whole number of minutes from 0 to 60.';
const WHOLE = /^\d+$/;

// parseDelays reads "0, 5" as [0, 5], or null when it is not 1 to 5 whole minutes from 0 to 60.
function parseDelays(text) {
  const parts = text.split(',').map((part) => part.trim());
  if (parts.length < 1 || parts.length > 5 || !parts.every((part) => WHOLE.test(part))) return null;
  const minutes = parts.map(Number);
  return minutes.every((value) => value <= 60) ? minutes : null;
}

function Settings({ me, onSaved }) {
  const [zone, setZone] = useState(me.timezone);
  const [start, setStart] = useState(me.quiet_start ?? '');
  const [end, setEnd] = useState(me.quiet_end ?? '');
  const [delays, setDelays] = useState(me.notification_delays.join(', '));
  const [low, setLow] = useState(String(me.low_urgency_delay));
  const [errors, setErrors] = useState(null);

  const save = async () => {
    const problems = {};
    const minutes = parseDelays(delays);
    if (!minutes) problems.notification_delays = DELAYS_SENTENCE;
    const lowDelay = low.trim() === '' || !WHOLE.test(low.trim()) ? null : Number(low.trim());
    if (lowDelay === null || lowDelay > 60) problems.low_urgency_delay = URGENCY_SENTENCE;
    if (Object.keys(problems).length) {
      setErrors(problems);
      return;
    }
    const res = await api.patch('/api/me', {
      timezone: zone,
      quiet_start: start.trim() || null,
      quiet_end: end.trim() || null,
      notification_delays: minutes,
      low_urgency_delay: lowDelay,
    });
    if (!res.ok) {
      setErrors(fieldErrors(res) ?? { timezone: 'Your settings could not be saved.' });
      return;
    }
    setErrors(null);
    onSaved(res.data);
    live.announce('Saved.');
  };

  return html`<form class="settings" onSubmit=${(event) => event.preventDefault()} noValidate>
    <h2>Settings</h2>
    <${Problems} errors=${errors} />
    <div class="grid">
      <div class="field">
        <label for="timezone">Time zone</label>
        <select id="timezone" onChange=${(event) => setZone(event.target.value)}>
          ${boot.zones.map((name) => html`<option value=${name} selected=${name === zone}>${name}</option>`)}
        </select>
        <${FieldError} errors=${errors} name="timezone" />
      </div>
      <div class="field">
        <label for="quiet_start">Quiet hours start</label>
        <input id="quiet_start" type="text" inputmode="numeric" placeholder="HH:MM" value=${start}
          onInput=${(event) => setStart(event.target.value)} autocomplete="off" />
        <${FieldError} errors=${errors} name="quiet_start" />
      </div>
      <div class="field">
        <label for="quiet_end">Quiet hours end</label>
        <input id="quiet_end" type="text" inputmode="numeric" placeholder="HH:MM" value=${end}
          onInput=${(event) => setEnd(event.target.value)} autocomplete="off" />
        <${FieldError} errors=${errors} name="quiet_end" />
      </div>
      <div class="field">
        <label for="notification_delays">Notification delays</label>
        <input id="notification_delays" type="text" placeholder="0, 5" value=${delays}
          onInput=${(event) => setDelays(event.target.value)} autocomplete="off" />
        <p class="hint">Minutes after you become a holder, separated by commas.</p>
        <${FieldError} errors=${errors} name="notification_delays" />
      </div>
      <div class="field">
        <label for="low_urgency_delay">Low urgency delay</label>
        <input id="low_urgency_delay" type="number" min="0" max="60" step="1" value=${low}
          onInput=${(event) => setLow(event.target.value)} />
        <p class="hint">Minutes before a low urgency notice goes out.</p>
        <${FieldError} errors=${errors} name="low_urgency_delay" />
      </div>
    </div>
    <div class="toolbar"><${Button} type="submit" onClick=${save}>Save settings</${Button}></div>
  </form>`;
}

function CalendarFeed() {
  const [link, setLink] = useState(null);

  const issue = async () => {
    const res = await api.post('/api/me/calendar-token');
    if (res.ok) setLink({ url: res.data.url, expires: res.data.expires_at });
  };
  const revoke = async () => {
    const res = await api.del('/api/me/calendar-token');
    if (res.ok) {
      setLink(null);
      live.announce('Calendar link revoked.');
    }
  };

  return html`<section class="feed" aria-labelledby="feed-title">
    <h2 id="feed-title">Calendar feed</h2>
    <p>Your on-call shifts as a calendar feed. A new link replaces the old one at once.</p>
    ${link ? html`<p class="link"><a class="mono" href=${link.url}>${`${location.origin}${link.url}`}</a></p>
      <p class="hint">The link works until ${fmtLocal(link.expires, boot.user.timezone)}.</p>` : null}
    <div class="toolbar">
      <${Button} onClick=${issue}>Create calendar link</${Button}>
      <${Button} class="secondary" onClick=${issue}>Regenerate calendar link</${Button}>
      <${Button} class="secondary" onClick=${revoke}>Revoke calendar link</${Button}>
    </div>
  </section>`;
}

export default function Me() {
  const [me, setMe] = useState(null);
  const stakeholder = boot.user.role === 'stakeholder';

  useEffect(() => {
    if (stakeholder) return;
    api.get('/api/me').then((res) => res.ok && setMe(res.data));
  }, []);

  if (stakeholder) return null;
  if (!me) return html`<div class="me"></div>`;
  return html`<div class="me">
    <h1>${me.name}</h1>
    <p class="muted">${me.email}</p>
    <${Settings} me=${me} onSaved=${setMe} />
    <${CalendarFeed} />
  </div>`;
}
