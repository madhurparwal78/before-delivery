import { announce, api, qs, qsa } from './core';
import { initTheme } from './theme';

initTheme();

const meta = document.body.dataset;
const versionId = meta.versionId ?? '';

interface NavigationJson {
  tabs: unknown[];
  redirects: { from: string; to: string; kind: string }[];
}

function load(): void {
  void api<NavigationJson>('GET', `/api/versions/${versionId}/navigation`).then((res) => {
    if (!res.data) return;
    const body = qs<HTMLElement>('[data-redirects-body]');
    if (body) {
      body.textContent = '';
      for (const r of res.data.redirects) {
        const tr = document.createElement('tr');
        const from = document.createElement('td');
        from.textContent = r.from;
        const to = document.createElement('td');
        to.textContent = r.to;
        const kind = document.createElement('td');
        kind.textContent = r.kind;
        const actions = document.createElement('td');
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove redirect from ${r.from}`);
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
          void api<NavigationJson>('DELETE', `/api/versions/${versionId}/redirects?from=${encodeURIComponent(r.from)}`).then((res2) => {
            if (res2.data) { load(); announce(`Redirect removed from ${r.from}.`); }
            else if (res2.error) announce(res2.error.message);
          });
        });
        actions.append(remove);
        tr.append(from, to, kind, actions);
        body.append(tr);
      }
    }
  });
}

const form = qs<HTMLFormElement>('[data-add-redirect]');
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const from = form.querySelector<HTMLInputElement>('[data-from]')?.value ?? '';
    const to = form.querySelector<HTMLInputElement>('[data-to]')?.value ?? '';
    void api<NavigationJson>('POST', `/api/versions/${versionId}/redirects`, { from, to }).then((res) => {
      if (res.status === 201) {
        announce(`Redirect added from ${from} to ${to}.`);
        form.reset();
        load();
      } else if (res.error) {
        const fields = res.error.fields ?? {};
        const field = fields.from ? '[data-from]' : '[data-to]';
        const input = form.querySelector<HTMLInputElement>(field);
        const errEl = form.querySelector<HTMLElement>('[data-error]');
        if (errEl) errEl.textContent = res.error.message;
        announce(res.error.message);
        input?.focus();
      }
    });
  });
}

load();
