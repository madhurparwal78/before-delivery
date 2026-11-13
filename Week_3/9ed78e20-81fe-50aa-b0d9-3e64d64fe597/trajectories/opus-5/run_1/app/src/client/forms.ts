import {
  UNREACHABLE,
  all,
  newIdempotencyKey,
  one,
  readFailure,
  setStatus,
} from './dom.js';
import { manageDialog } from './nav.js';

function clearFieldErrors(form: HTMLFormElement): void {
  for (const slot of all('[data-field-error]', form)) slot.textContent = '';
}

function showFieldErrors(
  form: HTMLFormElement,
  fields: Readonly<Record<string, string>>,
): void {
  let first: HTMLElement | null = null;
  for (const [name, message] of Object.entries(fields)) {
    const slot = one(`[data-field-error="${name}"]`, form);
    if (slot !== null) slot.textContent = message;
    const field = form.elements.namedItem(name);
    if (first === null && field instanceof HTMLElement) first = field;
  }
  if (first !== null) first.focus();
}

export function startApplicationForm(): void {
  const form = one<HTMLFormElement>('[data-application-form]');
  if (form === null) return;
  const status = one('[data-application-status]');
  const submit = one<HTMLButtonElement>('[data-application-submit]', form);
  let pending = false;

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (pending) return;
    pending = true;
    if (submit !== null) submit.disabled = true;
    clearFieldErrors(form);
    setStatus(status, 'Sending your application…');
    const key = newIdempotencyKey();
    const data = new FormData(form);
    const email = String(data.get('email') ?? '').trim();

    void (async () => {
      try {
        const response = await fetch(form.action, {
          method: 'POST',
          body: data,
          headers: { Accept: 'application/json', 'Idempotency-Key': key },
        });
        if (response.ok) {
          setStatus(
            status,
            `Application received. Your receipt and tracking link are on their way to ${email}.`,
          );
          form.reset();
          return;
        }
        const failure = await readFailure(response);
        if (failure.status === 422) {
          setStatus(status, 'Please fix the highlighted fields.');
          showFieldErrors(form, failure.fields);
          return;
        }
        setStatus(status, failure.message);
      } catch {
        setStatus(status, UNREACHABLE);
      } finally {
        pending = false;
        if (submit !== null) submit.disabled = false;
      }
    })();
  });
}

export function startResendForm(): void {
  for (const form of all<HTMLFormElement>('[data-resend-form]')) {
    const status = one('[data-resend-status]', form);
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      clearFieldErrors(form);
      setStatus(status, 'Sending…');
      const email = String(new FormData(form).get('email') ?? '');
      void (async () => {
        try {
          const response = await fetch('/api/careers/tracking-links', {
            method: 'POST',
            headers: { 'content-type': 'application/json', Accept: 'application/json' },
            body: JSON.stringify({ email }),
          });
          const payload = (await response.json()) as {
            message?: string;
            fields?: Record<string, string>;
          };
          if (response.ok) {
            setStatus(status, payload.message ?? '');
            return;
          }
          if (response.status === 422 && payload.fields !== undefined) {
            setStatus(status, '');
            showFieldErrors(form, payload.fields);
            return;
          }
          setStatus(status, payload.message ?? UNREACHABLE);
        } catch {
          setStatus(status, UNREACHABLE);
        }
      })();
    });
  }
}

export function startTracking(): void {
  const article = one('.tracking');
  if (article === null) return;
  const token = article.dataset.token ?? '';
  const status = one('[data-tracking-status]');
  const opener = one<HTMLButtonElement>('[data-withdraw-open]');
  const dialog = one<HTMLDialogElement>('[data-withdraw-dialog]');
  if (opener === null || dialog === null) return;
  const confirm = one<HTMLButtonElement>('[data-withdraw-confirm]', dialog);
  const cancel = one<HTMLButtonElement>('[data-withdraw-cancel]', dialog);

  opener.addEventListener('click', () => manageDialog(dialog, opener, cancel));
  if (cancel !== null) cancel.addEventListener('click', () => dialog.close());
  if (confirm !== null) {
    confirm.addEventListener('click', () => {
      dialog.close();
      setStatus(status, 'Withdrawing…');
      void (async () => {
        try {
          const response = await fetch(`/api/track/${token}/withdraw`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', Accept: 'application/json' },
            body: '{}',
          });
          if (response.ok) {
            setStatus(status, 'Your application has been withdrawn.');
            window.setTimeout(() => window.location.reload(), 600);
            return;
          }
          const failure = await readFailure(response);
          setStatus(status, failure.message);
        } catch {
          setStatus(status, UNREACHABLE);
        }
      })();
    });
  }
}

export function startSignIn(): void {
  const form = one<HTMLFormElement>('[data-sign-in-form]');
  if (form === null) return;
  const status = one('[data-sign-in-status]');
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    setStatus(status, 'Signing in…');
    const data = new FormData(form);
    void (async () => {
      try {
        const response = await fetch('/api/console/session', {
          method: 'POST',
          headers: { 'content-type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify({
            email: String(data.get('email') ?? ''),
            password: String(data.get('password') ?? ''),
          }),
        });
        if (response.ok) {
          window.location.assign('/console');
          return;
        }
        const failure = await readFailure(response);
        setStatus(status, failure.message);
      } catch {
        setStatus(status, UNREACHABLE);
      }
    })();
  });
}

export function startSearchPage(): void {
  const form = one<HTMLFormElement>('.search-form');
  const status = one('[data-search-status]');
  if (status !== null) {
    const results = all('.results .result').length;
    if (one('.results') !== null) setStatus(status, `Showing ${results} results.`);
  }
  if (form !== null) {
    form.addEventListener('submit', () => setStatus(status, 'Searching…'));
  }
  document.addEventListener('keydown', (event) => {
    if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (
      target !== null &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
    ) {
      return;
    }
    const box = one<HTMLInputElement>('[data-search-box]');
    if (box === null) return;
    event.preventDefault();
    box.focus();
  });
}

export function startCareersFilters(): void {
  const form = one<HTMLFormElement>('[data-careers-filters]');
  if (form === null) return;
  for (const field of all<HTMLSelectElement>('select', form)) {
    field.addEventListener('change', () => form.requestSubmit());
  }
}
