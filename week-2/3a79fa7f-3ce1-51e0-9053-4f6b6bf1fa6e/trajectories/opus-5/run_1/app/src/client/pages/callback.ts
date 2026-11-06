import { errorBody, get, post } from '../api.js';
import { el, formatCents } from '../dom.js';
import { loadCatalog } from '../store.js';
import { applyFieldErrors, field, type FieldHandle } from '../ui.js';
import { createViewer, parseViewParam } from '../viewer/index.js';
import type { Build } from '../types.js';

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Los_Angeles',
  'America/Puerto_Rico',
  'America/Toronto',
  'Europe/Berlin',
  'Europe/Paris',
  'Australia/Sydney',
];

const TOPICS = ['Choosing a board', 'Demo or lesson', 'Order or delivery', 'Trade-in', 'Protection plan'];

function halfHourTimes(): { value: string; label: string }[] {
  const times: { value: string; label: string }[] = [];
  for (let hour = 0; hour < 24; hour += 1) {
    for (const minute of ['00', '30']) {
      const value = `${String(hour).padStart(2, '0')}:${minute}`;
      times.push({ value, label: value });
    }
  }
  return times;
}

export async function renderCallback(main: HTMLElement): Promise<void> {
  const params = new URLSearchParams(window.location.search);
  const buildCode = params.get('build');

  const name = field('Name', 'text', { autocomplete: 'name' });
  const email = field('Email', 'text', { type: 'email', autocomplete: 'email' });
  const phone = field('Phone', 'text', { type: 'tel', autocomplete: 'tel' });
  const timezone = field('Timezone', 'select', { options: TIMEZONES.map((zone) => ({ value: zone, label: zone })) });
  const preferredDate = field('Preferred date', 'text', { type: 'date' });
  const preferredTime = field('Preferred time', 'select', { options: halfHourTimes(), value: '09:00' });
  const topic = field('Topic', 'select', { options: TOPICS.map((value) => ({ value, label: value })) });
  const message = field('Message', 'textarea');
  const submit = el('button', { class: 'btn', type: 'button' }, 'Request call');
  const alert = el('div', { class: 'alert-region', role: 'alert' });

  try {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (TIMEZONES.includes(browserZone)) timezone.control.value = browserZone;
  } catch {
    /* the default zone stays selected */
  }

  const handles: Record<string, FieldHandle> = {
    name,
    email,
    phone,
    timezone,
    preferred_start: preferredDate,
    topic,
    message,
  };

  const form = el('form', { novalidate: true }, [
    alert,
    name.wrapper,
    email.wrapper,
    phone.wrapper,
    timezone.wrapper,
    preferredDate.wrapper,
    preferredTime.wrapper,
    topic.wrapper,
    message.wrapper,
    submit,
  ]);

  const panel = el('div', { class: 'stack', role: 'region', 'aria-label': 'Build to discuss' });
  const layout = el('div', { class: 'checkout-layout' }, [panel, form]);
  main.replaceChildren(
    el('section', { class: 'band wrap stack' }, [el('h1', {}, 'Book a call with a rider advisor'), layout]),
  );

  if (buildCode) {
    panel.appendChild(el('h2', { style: 'font-size:1.2rem' }, 'Build to discuss'));
    const result = await get<Build>(`/api/builds/${encodeURIComponent(buildCode)}`);
    if (!result.ok) {
      panel.appendChild(el('p', {}, 'We could not find that build.'));
    } else {
      const catalog = await loadCatalog();
      const viewer = createViewer({ catalog, withControls: true });
      panel.append(viewer.shell, el('p', {}, `${result.body.board_name}, ${formatCents(result.body.total_cents)}`));
      viewer.setBuild(result.body, false);
      viewer.applyViewParam(parseViewParam(params));
    }
  } else {
    panel.remove();
  }

  submit.addEventListener('click', async () => {
    alert.textContent = '';
    for (const handle of Object.values(handles)) handle.setError(null);
    submit.disabled = true;
    submit.textContent = 'Sending...';
    const result = await post<{ reference: string }>('/api/callbacks', {
      name: name.control.value,
      email: email.control.value,
      phone: phone.control.value,
      timezone: timezone.control.value,
      preferred_start: `${preferredDate.control.value}T${preferredTime.control.value}`,
      topic: topic.control.value,
      message: message.control.value,
      build_code: buildCode ?? undefined,
    });
    submit.disabled = false;
    submit.textContent = 'Request call';
    if (!result.ok) {
      const body = errorBody(result);
      applyFieldErrors(handles, body.fields);
      if (!body.fields || Object.keys(body.fields).length === 0) alert.textContent = body.message;
      return;
    }
    const firstName = name.control.value.split(' ')[0] ?? name.control.value;
    form.replaceWith(
      el('div', { class: 'card', role: 'status' }, `Thanks, ${firstName}. Your reference is ${result.body.reference}.`),
    );
  });
}
