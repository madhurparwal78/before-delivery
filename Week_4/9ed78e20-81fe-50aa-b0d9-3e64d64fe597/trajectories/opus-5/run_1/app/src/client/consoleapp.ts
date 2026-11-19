import { startConsoleDialogs } from './nav.js';
import {
  UNREACHABLE,
  all,
  formatDateTime,
  newIdempotencyKey,
  one,
  readFailure,
  setStatus,
} from './dom.js';

const JSON_FIELDS = new Set(['claims']);
const LIST_FIELDS = new Set(['tags']);

function buildBody(form: HTMLFormElement): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const data = new FormData(form);
  for (const [name, value] of data.entries()) {
    const text = String(value);
    if (JSON_FIELDS.has(name)) {
      body[name] = JSON.parse(text === '' ? '[]' : text);
      continue;
    }
    if (LIST_FIELDS.has(name)) {
      body[name] = text
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry !== '');
      continue;
    }
    body[name] = text;
  }
  return body;
}

function successMessage(
  form: HTMLFormElement,
  payload: { content?: { release_at?: string | null } } | null,
): string {
  const template = form.dataset.success ?? 'Saved.';
  const releaseAt = payload?.content?.release_at;
  if (!template.includes('{release}')) return template;
  if (releaseAt === undefined || releaseAt === null) return template.replace('{release}', '');
  return template.replace('{release}', formatDateTime(new Date(releaseAt), 'Europe/London'));
}

/** Replaces the detail pane from the server, leaving the console status region in place. */
async function refreshMain(): Promise<void> {
  const response = await fetch(window.location.href, { headers: { Accept: 'text/html' } });
  const markup = await response.text();
  const parsed = new DOMParser().parseFromString(markup, 'text/html');
  const next = parsed.querySelector('main');
  const current = document.querySelector('main');
  if (next === null || current === null) return;
  current.innerHTML = next.innerHTML;
  bindConsoleForms();
  startConsoleDialogs();
}

function bindConsoleForms(): void {
  const status = one('[data-console-status]');
  for (const form of all<HTMLFormElement>('[data-console-form]')) {
    if (form.dataset.bound === 'true') continue;
    form.dataset.bound = 'true';
    const key = newIdempotencyKey();
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      setStatus(status, 'Saving…');
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        Accept: 'application/json',
        'Idempotency-Key': key,
      };
      const version = form.dataset.version;
      if (version !== undefined) headers['If-Match'] = `"${version}"`;
      void (async () => {
        try {
          const response = await fetch(form.dataset.path ?? form.action, {
            method: form.dataset.method ?? 'POST',
            headers,
            body: JSON.stringify(buildBody(form)),
          });
          if (response.ok) {
            const payload = (await response.json().catch(() => null)) as {
              content?: { id?: string; release_at?: string | null };
            } | null;
            setStatus(status, successMessage(form, payload));
            const created = payload?.content?.id;
            if (created !== undefined && window.location.pathname.endsWith('/content/new')) {
              window.location.assign(`/console/content/${created}`);
              return;
            }
            await refreshMain();
            return;
          }
          const failure = await readFailure(response);
          const detail =
            Object.keys(failure.fields).length === 0
              ? failure.message
              : `${failure.message} ${Object.entries(failure.fields)
                  .map(([field, message]) => `${field}: ${message}`)
                  .join(' ')}`;
          setStatus(status, detail);
          if (failure.status === 412 && status !== null) {
            const reload = document.createElement('button');
            reload.type = 'button';
            reload.textContent = 'Reload';
            reload.addEventListener('click', () => window.location.reload());
            status.append(' ', reload);
          }
        } catch {
          setStatus(status, UNREACHABLE);
        }
      })();
    });
  }
}

export function startConsoleActions(): void {
  bindConsoleForms();

  const signOut = one<HTMLButtonElement>('[data-sign-out]');
  if (signOut !== null) {
    signOut.addEventListener('click', () => {
      void (async () => {
        await fetch('/api/console/session', {
          method: 'DELETE',
          headers: { Accept: 'application/json' },
        }).catch(() => undefined);
        window.location.assign('/console/sign-in');
      })();
    });
  }

  const verify = one<HTMLFormElement>('[data-verify-chain]');
  if (verify !== null) {
    const verifyStatus = one('[data-verify-status]', verify);
    verify.addEventListener('submit', (event) => {
      event.preventDefault();
      setStatus(verifyStatus, 'Saving…');
      void (async () => {
        try {
          const response = await fetch('/api/console/audit/verify', {
            headers: { Accept: 'application/json' },
          });
          const payload = (await response.json()) as {
            valid?: boolean;
            entries?: number;
            first_invalid_seq?: number;
          };
          setStatus(
            verifyStatus,
            payload.valid === true
              ? `Audit chain verified: ${payload.entries ?? 0} entries.`
              : `Audit chain broken at entry ${payload.first_invalid_seq ?? 0}.`,
          );
        } catch {
          setStatus(verifyStatus, UNREACHABLE);
        }
      })();
    });
  }

  for (const field of all<HTMLInputElement>('input[name="release_at_local"], input[name="expires_at"]')) {
    const preview = one('[data-local-preview]', field.closest('form') ?? document);
    if (preview === null) continue;
    field.addEventListener('input', () => {
      const value = field.value.trim();
      if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) {
        preview.textContent = '';
        return;
      }
      const guess = new Date(`${value}Z`);
      if (Number.isNaN(guess.getTime())) {
        preview.textContent = '';
        return;
      }
      const londonGuess = new Date(
        guess.getTime() - londonOffsetMinutes(guess) * 60_000,
      );
      preview.textContent = `That is ${formatDateTime(londonGuess)} in your zone.`;
    });
  }
}

function londonOffsetMinutes(instant: Date): number {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  const read: Record<string, number> = {};
  for (const part of formatter.formatToParts(instant)) {
    if (part.type !== 'literal') read[part.type] = Number.parseInt(part.value, 10);
  }
  const asUtc = Date.UTC(
    read.year ?? 1970,
    (read.month ?? 1) - 1,
    read.day ?? 1,
    read.hour ?? 0,
    read.minute ?? 0,
    read.second ?? 0,
  );
  return (asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000;
}

export function startServiceStatus(): void {
  const banner = one('[data-service-status]');
  if (banner === null) return;
  const check = async (): Promise<void> => {
    try {
      const response = await fetch('/api/ready', { headers: { Accept: 'application/json' } });
      const payload = (await response.json()) as {
        dependencies?: { storage?: string; mail?: string };
      };
      const lines: string[] = [];
      if (payload.dependencies?.mail === 'down') {
        lines.push('Mail delivery is delayed. Messages are queued and will be sent when mail returns.');
      }
      if (payload.dependencies?.storage === 'down') {
        lines.push(
          'File storage is unreachable. Applications, résumé downloads and samples are paused.',
        );
      }
      banner.textContent = lines.join(' ');
    } catch {
      banner.textContent = '';
    }
  };
  void check();
  window.setInterval(() => void check(), 15_000);
}
