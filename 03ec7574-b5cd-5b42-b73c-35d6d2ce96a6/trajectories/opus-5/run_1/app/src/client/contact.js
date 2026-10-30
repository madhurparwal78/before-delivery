(() => {
  const holder = document.querySelector('[data-contact-holder]');
  if (!holder) return;
  const notifications = document.getElementById('notifications');
  const FIELD_ORDER = ['full_name', 'work_email', 'company', 'monthly_volume', 'message'];
  const THANKS = 'Thanks. Our team will reply within one business day.';

  function announce(text) {
    if (!notifications) return;
    const toast = document.createElement('p');
    toast.className = 'toast';
    toast.textContent = text;
    notifications.appendChild(toast);
    window.setTimeout(() => toast.remove(), 5000);
  }

  function busy(button, on) {
    button.disabled = on;
    button.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  holder.addEventListener('submit', async (event) => {
    const form = event.target.closest('[data-contact-form]');
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    busy(button, true);

    for (const field of FIELD_ORDER) {
      const message = form.querySelector(`[data-error-for="${field}"]`);
      const input = form.elements[field];
      if (message) message.textContent = '';
      if (input) input.removeAttribute('aria-invalid');
    }

    try {
      const response = await fetch('/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Corvo-Enhanced': '1' },
        body: new URLSearchParams(new FormData(form))
      });
      const payload = await response.json();
      if (payload.ok) {
        const thanks = document.createElement('p');
        thanks.className = 'result-line';
        thanks.setAttribute('tabindex', '-1');
        thanks.setAttribute('data-thanks', '');
        thanks.textContent = THANKS;
        holder.replaceChildren(thanks);
        thanks.focus();
        announce(THANKS);
        return;
      }
      for (const error of payload.errors || []) {
        const message = form.querySelector(`[data-error-for="${error.field}"]`);
        const input = form.elements[error.field];
        if (message) message.textContent = error.message;
        if (input) {
          input.setAttribute('aria-invalid', 'true');
          input.setAttribute('aria-describedby', message ? message.id : '');
        }
      }
      const first = (payload.errors || []).map((error) => error.field)
        .sort((a, b) => FIELD_ORDER.indexOf(a) - FIELD_ORDER.indexOf(b))[0];
      if (first && form.elements[first]) form.elements[first].focus();
      if (payload.errors && payload.errors.length) announce(payload.errors[0].message);
    } finally {
      busy(button, false);
    }
  });
})();
