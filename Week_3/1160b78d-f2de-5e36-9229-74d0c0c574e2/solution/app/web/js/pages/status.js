// The public status page: hydrates the server-rendered page and keeps it current by polling /api/status with its
// ETag. Services, headline, banners, updates and the plate change in place; the page opens no socket.
import { api, fieldErrors } from '../lib/api.js';
import { fmtLocal } from '../lib/format.js';

export const socket = false;

const POLL_MS = 5000;
const PLATE_LABELS = { dusk: 'Freight yard at dusk', night: 'Freight yard at night' };
const SLOWER_NOTICE = 'Figures are coming straight from the record, so this page may load more slowly.';
const NO_UPDATES = 'No updates published.';
const SUBSCRIBED = 'You are subscribed to status updates.';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function serviceItem(service) {
  const item = element('li');
  item.dataset.status = service.status;
  item.append(element('span', 'service-name', service.name), ' ', element('span', 'service-word', service.status));
  return item;
}

function updateItem(update, zone) {
  const item = element('li');
  const meta = element('p', 'update-meta');
  const stamp = element('time', '', fmtLocal(update.published_at, zone));
  stamp.dateTime = update.published_at;
  meta.append(element('span', 'update-state', update.state.charAt(0).toUpperCase() + update.state.slice(1)), ' ', stamp);
  if (update.services.length > 0) meta.append(' ', element('span', 'update-services', update.services.join(', ')));
  item.append(element('h3', '', update.title), meta, element('p', 'update-body', update.body));
  return item;
}

function showPlate(frame, plate) {
  frame.dataset.plate = plate;
  for (const image of frame.querySelectorAll('.plate-view')) {
    const onView = image.dataset.view === plate;
    image.alt = onView ? PLATE_LABELS[plate] : '';
    if (onView) image.removeAttribute('aria-hidden');
    else image.setAttribute('aria-hidden', 'true');
  }
}

// subscribeForm sends the address and reports the answer beside the form.
function subscribeForm(form) {
  const input = form.querySelector('input');
  const button = form.querySelector('button');
  const fieldError = form.querySelector('.subscribe-error');
  const note = form.querySelector('.subscribe-note');
  const problems = form.querySelector('.subscribe-problems');

  function showProblem(sentence) {
    fieldError.textContent = sentence;
    input.setAttribute('aria-invalid', 'true');
    const link = element('a', '', sentence);
    link.href = `#${input.id}`;
    link.addEventListener('click', (event) => {
      event.preventDefault();
      input.focus();
    });
    const item = element('li');
    item.append(link);
    problems.querySelector('ul').replaceChildren(item);
    problems.hidden = false;
  }

  function clearProblems() {
    fieldError.textContent = '';
    input.removeAttribute('aria-invalid');
    problems.hidden = true;
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (button.disabled) return;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    const result = await api.post('/api/status/subscribers', { email: input.value }, { keepOn401: true });
    button.disabled = false;
    button.removeAttribute('aria-busy');
    const errors = fieldErrors(result);
    if (errors) {
      note.textContent = '';
      showProblem(errors.email);
    } else if (result.ok) {
      clearProblems();
      input.value = '';
      note.textContent = SUBSCRIBED;
    }
  });
}

// The server draws the page ahead of #root, so mount finds it by its own classes.
export function mount(_root, boot) {
  const zone = boot.params.zone;
  const page = document.querySelector('.entry-band');
  const frame = document.querySelector('[data-plate]');
  const now = page.querySelector('.status-now');
  const headline = now.querySelector('.status-headline');
  const banners = page.querySelector('.status-banners');
  const services = page.querySelector('.status-services');
  const updates = page.querySelector('.status-updates');
  const empty = page.querySelector('.status-empty');
  const shown = {};

  // section draws only when what it shows has changed since the last answer.
  function section(name, value, draw) {
    const key = JSON.stringify(value);
    if (shown[name] === key) return;
    shown[name] = key;
    draw(value);
  }

  function apply(status) {
    showPlate(frame, status.plate);
    headline.textContent = status.headline;
    section('slower', status.slower, (slower) => {
      now.querySelector('.status-bar')?.remove();
      if (slower) now.append(element('p', 'bar status-bar', SLOWER_NOTICE));
    });
    section('services', status.services, (list) => services.replaceChildren(...list.map(serviceItem)));
    section('maintenance', status.maintenance, (list) => {
      banners.replaceChildren(...list.map((m) => element('p', '', `Maintenance on ${m.service} until ${fmtLocal(m.ends_at, zone)}`)));
      banners.hidden = list.length === 0;
    });
    section('updates', status.updates, (list) => {
      updates.replaceChildren(...list.map((update) => updateItem(update, zone)));
      empty.textContent = NO_UPDATES;
      empty.hidden = list.length > 0;
    });
  }

  let etag = null;
  let polling = false;
  async function poll() {
    if (polling) return;
    polling = true;
    const result = await api.get('/api/status', { etag, keepOn401: true });
    polling = false;
    if (result.status === 200) {
      etag = result.etag;
      apply(result.data);
    }
  }

  subscribeForm(page.querySelector('.subscribe'));
  poll();
  setInterval(poll, POLL_MS);
}
