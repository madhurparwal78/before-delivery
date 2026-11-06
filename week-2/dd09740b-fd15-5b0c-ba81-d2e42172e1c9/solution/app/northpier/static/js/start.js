// The inquiry composer: starter cards, live counter, a send control that waits for a valid form, one
// Idempotency-Key per form until a send succeeds, and the confirmation in place.
const composer = document.querySelector('.composer');
const form = composer.querySelector('.composer-form');
const sendStatus = composer.querySelector('.send-status');
const OUTAGE = 'The studio desk is unavailable. Try again shortly.';

// Characters as the server counts them: code points after trimming, a CR LF pair counting once.
const charCount = (value) => [...value.trim().replace(/\r\n/g, '\n')].length;
const UNSUPPORTED_LINE = /[\u0000-\u001f\u007f]/;
const EMAIL = /^[^\s@]+@[^\s@]*[^\s@.][.][^\s@.][^\s@]*$/;

function bindCopy(root) {
  const button = root.querySelector('.copy');
  const field = root.querySelector('#status-link');
  button.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(field.value);
      sendStatus.textContent = 'Link copied.';
    } catch {
      field.select();
      sendStatus.textContent = 'Copy the link from the field above.';
    }
  });
}

if (composer.querySelector('.confirm')) bindCopy(composer.querySelector('.confirm'));

if (form) {
  const field = (name) => form.elements[name];
  const send = form.querySelector('.send');
  const counter = form.querySelector('#counter');
  const message = field('message');
  const key = field('idempotency_key').value;
  const checkboxes = [...form.querySelectorAll('input[name="services"]')];
  let sending = false;

  const values = () => ({
    name: field('name').value, email: field('email').value, company: field('company').value,
    services: checkboxes.filter((box) => box.checked).map((box) => box.value),
    budget: field('budget').value, timeline: field('timeline').value, message: message.value,
  });

  const valid = () => {
    const v = values();
    const name = charCount(v.name);
    const email = v.email.trim();
    return name >= 1 && name <= 80 && !UNSUPPORTED_LINE.test(v.name)
      && email.length <= 254 && EMAIL.test(email)
      && charCount(v.company) <= 120 && v.services.length > 0 && v.budget !== '' && v.timeline !== ''
      && charCount(v.message) >= 20 && charCount(v.message) <= 2000;
  };

  const refresh = () => {
    counter.textContent = `${charCount(message.value)} / 2000`;
    send.disabled = sending || !valid();
  };

  const target = (name) => (name === 'services' ? checkboxes[0] : field(name));

  const clearError = (name) => {
    const msg = form.querySelector(`#msg-${name}`);
    if (msg) msg.textContent = '';
    target(name)?.removeAttribute('aria-invalid');
  };

  const showError = (name, text) => {
    const msg = form.querySelector(`#msg-${name}`);
    msg.textContent = text;
    if (name !== 'services') target(name).setAttribute('aria-invalid', 'true');
    target(name).focus();
    sendStatus.textContent = 'Check the highlighted field.';
  };

  const showConfirmation = (sent) => {
    const fragment = document.getElementById('confirm-template').content.cloneNode(true);
    fragment.querySelector('[data-slot="first"]').textContent = field('name').value.trim().split(' ')[0];
    fragment.querySelector('[data-slot="reference"]').textContent = sent.reference;
    fragment.querySelector('[data-slot="url"]').value = sent.status_url;
    fragment.querySelector('[data-slot="href"]').href = sent.status_url;
    const body = document.getElementById('composer-body');
    body.replaceChildren(fragment);
    const card = body.querySelector('.confirm');
    bindCopy(card);
    sendStatus.textContent = 'Inquiry sent.';
    if (!reduced()) card.animate([{ opacity: 0, transform: 'translateY(18px)' }, { opacity: 1, transform: 'none' }], { duration: MOTION_MS, easing: EASE });
    card.focus();
  };

  for (const starter of composer.querySelectorAll('.starter')) {
    starter.addEventListener('click', () => {
      const picks = starter.dataset.services.split(' ');
      for (const other of composer.querySelectorAll('.starter')) other.setAttribute('aria-pressed', String(other === starter));
      for (const box of checkboxes) box.checked = picks.includes(box.value);
      clearError('services');
      refresh();
      const empty = ['name', 'email', 'budget', 'timeline', 'message'].find((name) => field(name).value.trim() === '');
      if (empty) field(empty).focus();
    });
  }

  form.addEventListener('input', (event) => {
    clearError(event.target.name);
    refresh();
  });
  form.addEventListener('change', refresh);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (sending || !valid()) return;
    sending = true;
    send.setAttribute('aria-busy', 'true');
    refresh();
    sendStatus.textContent = 'Sending your inquiry...';
    let response;
    let payload;
    try {
      response = await fetch('/api/inquiries', {
        method: 'POST', body: JSON.stringify(values()),
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      });
      payload = await response.json();
    } catch {
      payload = null;
    }
    sending = false;
    send.removeAttribute('aria-busy');
    refresh();
    if (response && (response.status === 201 || response.status === 200)) {
      showConfirmation(payload);
    } else if (response && payload?.error?.field && form.querySelector(`#msg-${payload.error.field}`)) {
      showError(payload.error.field, payload.error.message);
    } else {
      sendStatus.textContent = payload?.error?.message || OUTAGE;
    }
  });

  refresh();
}
