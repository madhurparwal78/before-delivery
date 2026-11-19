/**
 * Client behaviour: forms and actions, diff keyboard navigation, dialogs that
 * trap focus, the live update stream, and the rail walk. All rules, statuses
 * and times come from the server; the client only renders what it is given.
 */

const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T | null =>
  root.querySelector(sel) as T | null;
const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] =>
  [...root.querySelectorAll(sel)] as T[];

const BP = Number(document.documentElement.dataset.diffBreakpoint || 768);
const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

interface FetchOptions { method?: string; body?: unknown; busyOn?: HTMLElement | null }

async function api(path: string, opts: FetchOptions = {}): Promise<{ ok: boolean; status: number; body: any }> {
  const res = await fetch(path, {
    method: opts.method ?? 'GET',
    headers: opts.body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let body: any = null;
  const text = await res.text();
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { ok: res.ok, status: res.status, body };
}

function actionStatus(text: string): void {
  const el = $('#action-status');
  if (el) el.textContent = text;
}

function announce(text: string): void {
  const el = $('#review-updates');
  if (el) {
    const p = document.createElement('p');
    p.textContent = text;
    el.appendChild(p);
  }
  const stack = $('#toast-stack');
  if (stack) {
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.textContent = text;
    stack.appendChild(toast);
    const children = [...stack.children].slice(-3);
    [...stack.children].forEach((c) => { if (!children.includes(c)) c.remove(); });
    if (!reducedMotion()) {
      setTimeout(() => { toast.remove(); }, 6000);
    }
  }
}

function announcement(text: string): void {
  const el = $('#announcement');
  if (el) {
    el.textContent = text;
    if (text) el.removeAttribute('hidden');
    else el.setAttribute('hidden', '');
  }
}

async function busy<T>(button: HTMLElement | null, pending: string, fn: () => Promise<T>): Promise<T | undefined> {
  if (button) {
    button.setAttribute('aria-busy', 'true');
    (button as HTMLButtonElement).disabled = true;
  }
  actionStatus(pending);
  try {
    return await fn();
  } finally {
    if (button) {
      button.removeAttribute('aria-busy');
      (button as HTMLButtonElement).disabled = false;
    }
  }
}

/* ============ Auth pages ============ */

const authForm = $('#auth-form') as HTMLFormElement | null;
if (authForm) {
  const kind = authForm.dataset.kind;
  authForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const button = $('#auth-submit') as HTMLButtonElement;
    await busy(button, 'Working...', async () => {
      if (kind === 'signup') {
        const res = await api('/api/signup', {
          method: 'POST',
          body: {
            email: ($('#email') as HTMLInputElement).value,
            username: ($('#username') as HTMLInputElement).value,
            name: ($('#name') as HTMLInputElement).value,
            password: ($('#password') as HTMLInputElement).value,
          },
        });
        if (res.ok) {
          actionStatus('Your account is created. The confirmation email is on its way.');
        } else if (res.body?.errors) {
          const first = Object.entries(res.body.errors)[0] as [string, string];
          const errEl = $('#form-error');
          if (errEl) errEl.textContent = first[1];
        }
      } else {
        const res = await api('/api/login', {
          method: 'POST',
          body: {
            email: ($('#email') as HTMLInputElement).value,
            password: ($('#password') as HTMLInputElement).value,
          },
        });
        if (res.ok) {
          window.location.href = '/inbox';
        } else {
          const errEl = $('#form-error');
          const msg = res.body?.error === 'Confirm your email first' ? 'Confirm your email first' : 'Email or password is wrong';
          if (errEl) errEl.textContent = msg;
          actionStatus('');
        }
      }
    });
  });
}

const confirmBtn = $('#confirm-btn') as HTMLButtonElement | null;
if (confirmBtn) {
  confirmBtn.addEventListener('click', async () => {
    await busy(confirmBtn, 'Working...', async () => {
      const res = await api('/api/confirm', { method: 'POST', body: { token: confirmBtn.dataset.token } });
      if (res.ok) {
        actionStatus('Your email is confirmed.');
        const parent = confirmBtn.parentElement;
        if (parent) {
          const link = document.createElement('a');
          link.href = '/login';
          link.textContent = 'Log in';
          link.className = 'arrow-link';
          parent.appendChild(link);
          confirmBtn.remove();
        }
      } else if (res.status === 404) {
        window.location.href = '/';
      }
    });
  });
}

const logoutBtn = $('#logout') as HTMLButtonElement | null;
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    await api('/api/logout', { method: 'POST' });
    window.location.href = '/login';
  });
}

/* ============ Home page ============ */

const statusEl = $('#service-status');
if (statusEl) {
  api('/api/health').then((res) => {
    const dot = $('.dot', statusEl);
    const text = $('.status-text', statusEl);
    if (text) text.textContent = res.body?.status === 'ok' ? 'All services are running' : 'Some services are unavailable';
    if (dot) dot.classList.toggle('down', res.body?.status !== 'ok');
  });
}

const tiles = $$('.tile');
if (tiles.length > 0) {
  const stackEl = $('#player-stack');
  const sample: Array<Array<[string, string]>> = [
    [['#1 base layer', 'merged'], ['#2 ledger', 'open'], ['#3 rates', 'open']],
    [['#1 base layer', 'merged'], ['#2 ledger', 'open'], ['#3 rates', 'checking']],
    [['#1 base layer', 'merged'], ['#2 ledger', 'merged'], ['#3 rates', 'open']],
    [['#1 base layer', 'merged'], ['#2 ledger', 'merged'], ['#3 rates', 'checking']],
    [['#1 base layer', 'merged'], ['#2 ledger', 'merged'], ['#3 rates', 'merged']],
  ];
  let selected = 0;
  let played = false;
  const render = () => {
    if (!stackEl) return;
    stackEl.replaceChildren();
    for (const [title, state] of sample[selected]) {
      const slab = document.createElement('div');
      slab.className = `slab${state === 'merged' ? ' keep' : ''}`;
      const name = document.createElement('span');
      name.textContent = title;
      const st = document.createElement('span');
      st.textContent = state;
      slab.append(name, st);
      stackEl.appendChild(slab);
    }
    tiles.forEach((t, i) => t.setAttribute('aria-selected', String(i === selected)));
  };
  tiles.forEach((tile, i) => {
    tile.addEventListener('click', () => {
      selected = i;
      render();
    });
  });
  const play = $('#player-play');
  play?.addEventListener('click', () => {
    let i = 0;
    const step = () => {
      selected = i % 5;
      render();
      i++;
      if (i <= 5) setTimeout(step, 2000);
    };
    step();
  });
  render();
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting) && !played && !reducedMotion()) {
      played = true;
      let i = 0;
      const step = () => {
        selected = i % 5;
        render();
        i++;
        if (i <= 5) setTimeout(step, 2000);
      };
      step();
    }
  }, { threshold: 0.4 });
  observer.observe($('.player') ?? document.body);
}

const wordmarkFrame = $('.wordmark-frame');
if (wordmarkFrame) {
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) wordmarkFrame.classList.add('in-view');
  }, { threshold: 0.3 });
  observer.observe(wordmarkFrame);
}

/* ============ Repo forms ============ */

const orgForm = $('#org-form') as HTMLFormElement | null;
if (orgForm) {
  orgForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy($('#org-form button') as HTMLButtonElement, 'Working...', async () => {
      const res = await api('/api/orgs', {
        method: 'POST',
        body: {
          slug: ($('#org-address') as HTMLInputElement).value,
          name: ($('#org-name') as HTMLInputElement).value,
        },
      });
      if (res.ok) {
        actionStatus('Created.');
        window.location.reload();
      } else {
        const errEl = $('#org-error');
        const first = res.body?.errors ? Object.values(res.body.errors)[0] : res.body?.error;
        if (errEl) errEl.textContent = String(first ?? '');
      }
    });
  });
}

const repoForm = $('#repo-form') as HTMLFormElement | null;
if (repoForm) {
  api('/api/repos').then((res) => {
    const select = $('#repo-org') as HTMLSelectElement | null;
    if (select && Array.isArray(res.body)) {
      select.replaceChildren(...res.body.map((o: { org: string; name: string }) => {
        const opt = document.createElement('option');
        opt.value = o.org;
        opt.textContent = o.org;
        return opt;
      }));
    }
  });
  repoForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy($('#repo-form button') as HTMLButtonElement, 'Working...', async () => {
      const visibility = ($('#repo-visibility') as HTMLSelectElement).value === 'Public' ? 'public' : 'private';
      const res = await api(`/api/orgs/${($('#repo-org') as HTMLSelectElement).value}/repos`, {
        method: 'POST',
        body: { name: ($('#repo-name') as HTMLInputElement).value, visibility },
      });
      if (res.ok) {
        actionStatus('Created.');
        window.location.href = `/${($('#repo-org') as HTMLSelectElement).value}/${res.body.name}`;
      } else {
        const errEl = $('#repo-error');
        const first = res.body?.errors ? Object.values(res.body.errors)[0] : res.body?.error;
        if (errEl) errEl.textContent = String(first ?? '');
      }
    });
  });
}

const teamForm = $('#team-form') as HTMLFormElement | null;
if (teamForm) {
  teamForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    await busy($('#team-form button') as HTMLButtonElement, 'Working...', async () => {
      const org = window.location.pathname.split('/')[1];
      const res = await api(`/api/orgs/${org}/teams`, {
        method: 'POST',
        body: { name: ($('#team-name') as HTMLInputElement).value },
      });
      if (res.ok) {
        actionStatus('Created.');
        window.location.reload();
      } else {
        const first = res.body?.errors ? Object.values(res.body.errors)[0] : res.body?.error;
        actionStatus(String(first ?? ''));
      }
    });
  });
}

$$('form[data-team]').forEach((form) => {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const team = form.dataset.team;
    const username = ($('input', form) as HTMLInputElement).value;
    const org = window.location.pathname.split('/')[1];
    await busy($('button', form) as HTMLButtonElement, 'Working...', async () => {
      const res = await api(`/api/orgs/${org}/teams/${team}/members/${username}`, { method: 'PUT' });
      if (res.ok) {
        actionStatus('Created.');
        window.location.reload();
      } else {
        actionStatus(res.body?.error ?? '');
      }
    });
  });
});

/* ============ Change creation ============ */

const changeForm = $('#change-form') as HTMLFormElement | null;
if (changeForm) {
  changeForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const repoPath = changeForm.dataset.repo ?? '';
    await busy($('#change-form button') as HTMLButtonElement, 'Working...', async () => {
      const res = await api(`/api/orgs/${repoPath.split('/')[0]}/repos/${repoPath.split('/')[1]}/changes`, {
        method: 'POST',
        body: {
          title: ($('#title') as HTMLInputElement).value,
          description: ($('#description') as HTMLTextAreaElement).value,
          head: ($('#head-branch') as HTMLSelectElement).value,
          base: ($('#base-branch') as HTMLSelectElement).value,
          draft: ($('#draft') as HTMLInputElement).checked,
        },
      });
      if (res.ok) {
        actionStatus(`Change #${res.body.number} created.`);
        window.location.href = `/${repoPath}/changes/${res.body.number}`;
      } else {
        const errEl = $('#change-error');
        const first = res.body?.errors ? Object.values(res.body.errors)[0] : res.body?.error;
        if (errEl) errEl.textContent = String(first ?? '');
      }
    });
  });
}

/* ============ Settings ============ */

const rulesForm = $('#rules-form') as HTMLFormElement | null;
if (rulesForm) {
  rulesForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const [org, name] = (rulesForm.dataset.repo ?? '').split('/');
    await busy($('#save-rules') as HTMLButtonElement, 'Saving...', async () => {
      const checks = ($('#required-checks') as HTMLInputElement).value
        .split(',').map((s) => s.trim()).filter(Boolean);
      const res = await api(`/api/orgs/${org}/repos/${name}/settings`, {
        method: 'PUT',
        body: {
          required_approvals: Number(($('#required-approvals') as HTMLInputElement).value),
          required_checks: checks,
          queue: ($('#use-queue') as HTMLInputElement).checked,
        },
      });
      if (res.ok) {
        actionStatus('Rules saved.');
      } else {
        const errEl = $('#rules-error');
        const first = res.body?.errors ? Object.values(res.body.errors)[0] : res.body?.error;
        if (errEl) errEl.textContent = String(first ?? '');
      }
    });
  });
}

const tokenForm = $('#token-form') as HTMLFormElement | null;
if (tokenForm) {
  tokenForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const [org, name] = (tokenForm.dataset.repo ?? '').split('/');
    await busy($('#token-form button') as HTMLButtonElement, 'Working...', async () => {
      const res = await api(`/api/orgs/${org}/repos/${name}/tokens`, {
        method: 'POST',
        body: {
          name: ($('#token-name') as HTMLInputElement).value,
          access: ($('#token-access') as HTMLSelectElement).value === 'Write' ? 'write' : 'read',
        },
      });
      if (res.ok) {
        actionStatus('Token created.');
        const region = $('#new-token');
        const value = $('#token-value') as HTMLInputElement | null;
        if (region && value) {
          region.removeAttribute('hidden');
          value.value = res.body.token;
        }
      } else {
        const errEl = $('#token-error');
        const first = res.body?.errors ? Object.values(res.body.errors)[0] : res.body?.error;
        if (errEl) errEl.textContent = String(first ?? '');
      }
    });
  });
}

$$('button[data-revoke]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const repo = (btn.closest('form') ?? document.body).dataset.repo ?? '';
    const [org, name] = repo ? repo.split('/') : window.location.pathname.split('/').slice(0, 2);
    await busy(btn, 'Working...', async () => {
      const res = await api(`/api/orgs/${org}/repos/${name}/tokens/${btn.dataset.revoke}`, { method: 'DELETE' });
      if (res.ok) {
        actionStatus('Role removed.');
        window.location.reload();
      } else actionStatus(res.body?.error ?? '');
    });
  });
});

const roleForm = $('#role-form') as HTMLFormElement | null;
if (roleForm) {
  roleForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const [org, name] = (roleForm.dataset.repo ?? '').split('/');
    await busy($('#role-form button') as HTMLButtonElement, 'Working...', async () => {
      const raw = ($('#role-subject') as HTMLInputElement).value.trim();
      const subject = raw.includes('/') ? `team:${raw.split('/')[1]}` : raw.startsWith('@') ? `user:${raw.slice(1)}` : `user:${raw}`;
      const role = ($('#role-role') as HTMLSelectElement).value.toLowerCase();
      const res = await api(`/api/orgs/${org}/repos/${name}/roles`, { method: 'PUT', body: { subject, role } });
      if (res.ok) {
        actionStatus('Role granted.');
        window.location.reload();
      } else {
        const errEl = $('#role-error');
        const first = res.body?.errors ? Object.values(res.body.errors)[0] : res.body?.error;
        if (errEl) errEl.textContent = String(first ?? '');
      }
    });
  });
}

$$('button[data-remove-role]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const [org, name] = window.location.pathname.split('/').slice(0, 2);
    await busy(btn, 'Working...', async () => {
      const res = await api(`/api/orgs/${org}/repos/${name}/roles/${encodeURIComponent(btn.dataset.removeRole ?? '')}`, { method: 'DELETE' });
      if (res.ok) {
        actionStatus('Role removed.');
        window.location.reload();
      } else actionStatus(res.body?.error ?? '');
    });
  });
});

/* ============ Editor ============ */

const editForm = $('#edit-form') as HTMLFormElement | null;
if (editForm) {
  const contentArea = $('#file-content') as HTMLTextAreaElement;
  const staleNotice = $('#stale-notice');
  editForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const [org, name] = (editForm.dataset.repo ?? '').split('/');
    const expectedHead = contentArea.dataset.expectedHead;
    await busy($('#save-file') as HTMLButtonElement, 'Saving...', async () => {
      const res = await api(`/api/orgs/${org}/repos/${name}/push`, {
        method: 'POST',
        body: {
          branch: editForm.dataset.branch,
          expected_head: expectedHead,
          message: ($('#revision-message') as HTMLInputElement).value,
          files: [{ path: editForm.dataset.path, content: contentArea.value }],
        },
      });
      if (res.ok) {
        actionStatus(`Saved as revision ${res.body.revision}.`);
        contentArea.dataset.expectedHead = res.body.revision;
        if (staleNotice) staleNotice.setAttribute('hidden', '');
      } else if (res.body?.error === 'Stale head') {
        announcement(`This file changed on ${editForm.dataset.branch} since you opened it. Your edit was not saved.`);
        if (staleNotice) staleNotice.removeAttribute('hidden');
      } else if (res.status === 503) {
        announcement(res.body.error);
      } else {
        const errEl = $('#edit-error');
        if (errEl) errEl.textContent = res.body?.error ?? '';
      }
    });
  });
  const loadLatest = $('#load-latest');
  loadLatest?.addEventListener('click', async () => {
    const [org, name] = (editForm.dataset.repo ?? '').split('/');
    const res = await api(`/api/orgs/${org}/repos/${name}/branches/${editForm.dataset.branch}`);
    if (res.ok) {
      contentArea.dataset.expectedHead = res.body.revision;
      const fileRes = await api(`/api/orgs/${org}/repos/${name}/revisions/${res.body.revision}/files/${editForm.dataset.path}`);
      if (fileRes.ok) {
        const region = $('#latest-region');
        const text = $('#latest-text');
        if (region && text) {
          region.removeAttribute('hidden');
          text.textContent = fileRes.body.raw ?? String(fileRes.body);
          text.dataset.byteLength = String(new TextEncoder().encode(String(fileRes.body.raw ?? '')).length);
        }
      }
      actionStatus('');
    }
  });
}

/* ============ Export archive ============ */

const exportBtn = $('#export-archive') as HTMLButtonElement | null;
if (exportBtn) {
  exportBtn.addEventListener('click', async () => {
    const [org, name] = (exportBtn.dataset.repo ?? '').split('/');
    await busy(exportBtn, 'Exporting...', async () => {
      const res = await api(`/api/orgs/${org}/repos/${name}/revisions/${exportBtn.dataset.revision ?? ''}/archive`, { method: 'POST' });
      if (res.ok) {
        actionStatus(`Archive saved to ${res.body.key}`);
      } else {
        announcement(res.body?.error ?? '');
      }
    });
  });
}

/* ============ Branch select on overview ============ */

const branchSelect = $('#branch-select') as HTMLSelectElement | null;
if (branchSelect) {
  branchSelect.addEventListener('change', () => {
    const params = new URLSearchParams(window.location.search);
    params.set('branch', branchSelect.value);
    window.location.search = params.toString();
  });
}

/* ============ Diff keyboard navigation ============ */

interface Cursor { row: HTMLElement; path: string; line: number | null }

const stage = $('#diff-stage');
const rows = (): HTMLElement[] => $$('.diff-row.line-row', stage ?? document);
const cursorAttr = 'data-cursor';

function setCursor(row: HTMLElement | null): void {
  $$('.diff-row').forEach((r) => r.removeAttribute(cursorAttr));
  if (!row) return;
  row.setAttribute(cursorAttr, 'true');
  row.focus({ preventScroll: false });
}

function rowPathLine(row: HTMLElement): { path: string; line: number | null; side: string } {
  return {
    path: row.dataset.path ?? '',
    line: Number(row.dataset.newLine || row.dataset.oldLine) || null,
    side: row.dataset.side ?? 'new',
  };
}

function nextFileCursor(from: HTMLElement | null, forward: boolean): HTMLElement | null {
  const all = rows();
  if (all.length === 0) return null;
  if (!from) return all[0];
  const idx = all.indexOf(from);
  const currentPath = from.dataset.path;
  for (let i = idx + (forward ? 1 : 0); forward ? i < all.length : i >= 0; forward ? i++ : i--) {
    const r = all[i];
    if (r.dataset.path !== currentPath) {
      // first (or last) row of the next file in that direction
      let candidate = r;
      if (!forward) {
        for (let j = i; j >= 0; j--) {
          if (all[j].dataset.path !== currentPath) candidate = all[j];
          else break;
        }
      }
      return candidate;
    }
  }
  return null;
}

function moveCursor(delta: 1 | -1): void {
  const all = rows();
  if (all.length === 0) return;
  const current = all.find((r) => r.getAttribute(cursorAttr) === 'true') ?? null;
  if (!current) {
    setCursor(all[0]);
    return;
  }
  const idx = all.indexOf(current);
  const next = all[idx + delta];
  if (next) setCursor(next);
}

function fileCursor(delta: 1 | -1): void {
  const all = rows();
  const current = all.find((r) => r.getAttribute(cursorAttr) === 'true') ?? null;
  const target = nextFileCursor(current, delta === 1);
  if (target) setCursor(target);
}

function threadTargets(): HTMLElement[] {
  const showOutdated = ($('#outdated-switch') as HTMLInputElement)?.checked ?? false;
  return $$('.thread')
    .filter((t) => t.dataset.state === 'unresolved')
    .filter((t) => showOutdated || t.dataset.outdated !== 'true')
    .filter((t) => reducedMotion() || true)
    .sort((a, b) => {
      const pa = anchorRow(a);
      const pb = anchorRow(b);
      return rows().indexOf(pa) - rows().indexOf(pb);
    });
}

function anchorRow(thread: HTMLElement): HTMLElement {
  const key = `${thread.dataset.path}:${thread.dataset.side}:${thread.dataset.line}`;
  const anchor = $$('.diff-row.line-row').find((r) => {
    const line = r.dataset.side === 'old' ? r.dataset.oldLine : r.dataset.newLine;
    return r.dataset.path === thread.dataset.path && line === thread.dataset.line && r.dataset.side === thread.dataset.side;
  });
  return anchor ?? $$('.diff-row.line-row')[0];
}

function moveThread(delta: 1 | -1): void {
  const threads = threadTargets();
  if (threads.length === 0) return;
  const current = $$('.thread').find((t) => t.getAttribute(cursorAttr) === 'true');
  const idx = current ? threads.indexOf(current) : -1;
  let target: HTMLElement;
  if (idx === -1) {
    const currentRow = rows().find((r) => r.getAttribute(cursorAttr) === 'true');
    const after = threads.find((t) => {
      const anchor = anchorRow(t);
      return currentRow && rows().indexOf(anchor) >= rows().indexOf(currentRow);
    });
    target = after ?? threads[0];
  } else if (idx + delta >= 0 && idx + delta < threads.length) {
    target = threads[idx + delta];
  } else {
    return;
  }
  setCursor(anchorRow(target));
  target.setAttribute(cursorAttr, 'true');
  setTimeout(() => target.removeAttribute(cursorAttr), 10);
  target.focus();
}

function toggleViewed(): void {
  const current = rows().find((r) => r.getAttribute(cursorAttr) === 'true');
  if (!current) return;
  const path = current.dataset.path ?? '';
  const section = current.closest('.file-section') as HTMLElement | null;
  const box = section ? ($('.viewed-check', section) as HTMLInputElement | null) : null;
  if (box) {
    box.checked = !box.checked;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

/* Row clicks move the cursor; the row's comment button opens the dialog. */

function rowCommentButton(row: HTMLElement): HTMLButtonElement | null {
  return $('.row-comment-btn', row) as HTMLButtonElement | null;
}

function showRowCommentButton(row: HTMLElement): void {
  $$('.row-comment-btn').forEach((b) => b.remove());
  const info = rowPathLine(row);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn-secondary row-comment-btn';
  btn.textContent = `Comment on line ${info.line}`;
  const slot = $('.row-comment-slot', row);
  if (slot) slot.appendChild(btn);
  btn.addEventListener('click', () => openCommentDialog(row));
}

if (stage) {
  stage.addEventListener('click', (e) => {
    const row = (e.target as HTMLElement).closest('.diff-row.line-row') as HTMLElement | null;
    if (row) {
      setCursor(row);
      showRowCommentButton(row);
    }
  });
}

/* ============ Comment dialog ============ */

let dialogOpener: HTMLElement | null = null;
let dialogCursorRow: HTMLElement | null = null;

function trapFocus(dialog: HTMLElement): void {
  dialog.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const focusables = $$('button, input, textarea, select, [tabindex]:not([tabindex="-1"])', dialog)
      .filter((el) => !(el as HTMLButtonElement).disabled);
    if (focusables.length === 0) return;
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      (last as HTMLElement).focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      (first as HTMLElement).focus();
    }
  });
}

function openDialog(id: string, opener: HTMLElement | null, focusOn: string): HTMLElement {
  const dialog = $(`#${id}`) as HTMLElement;
  dialog.removeAttribute('hidden');
  dialogOpener = opener;
  const first = $(focusOn, dialog) as HTMLElement | null;
  if (first) first.focus();
  trapFocus(dialog);
  return dialog;
}

function closeDialog(dialog: HTMLElement): void {
  dialog.setAttribute('hidden', '');
  const target = dialogOpener ?? dialogCursorRow;
  if (target) (target as HTMLElement).focus();
}

function openCommentDialog(row: HTMLElement): void {
  const info = rowPathLine(row);
  dialogCursorRow = row;
  const existing = $('#comment-dialog');
  if (existing) existing.remove();
  const isNewSide = info.side === 'new' || row.dataset.kind !== 'removed';
  const dialog = document.createElement('div');
  dialog.className = 'dialog-backdrop';
  dialog.id = 'comment-dialog';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', `Comment on ${info.path} line ${info.line}`);
  dialog.innerHTML = `
    <div class="dialog">
      <h2 class="card-title">Comment on ${escapeHtml(info.path)} line ${info.line}</h2>
      <label class="label" for="comment-body">Comment</label>
      <textarea class="input" id="comment-body" rows="3"></textarea>
      ${isNewSide ? `
      <label class="checkline"><input type="checkbox" id="add-suggestion"> <span>Add a suggestion</span></label>
      <div id="suggestion-fields" hidden>
        <label class="label" for="suggested-lines">Suggested lines</label>
        <textarea class="input mono" id="suggested-lines" rows="2"></textarea>
        <label class="label" for="through-line">Through line</label>
        <input class="input" id="through-line" type="number" min="${info.line}" value="${info.line}">
      </div>` : ''}
      <p class="form-error" id="comment-error" role="alert"></p>
      <button class="btn-primary" id="add-comment" type="button">Add comment</button>
      <button class="btn-secondary" id="cancel-comment" type="button">Cancel</button>
    </div>`;
  document.body.appendChild(dialog);
  const suggestionToggle = $('#add-suggestion') as HTMLInputElement | null;
  suggestionToggle?.addEventListener('change', () => {
    const fields = $('#suggestion-fields');
    if (fields) {
      if (suggestionToggle.checked) fields.removeAttribute('hidden');
      else fields.setAttribute('hidden', '');
    }
  });
  $('#add-comment')?.addEventListener('click', () => submitComment(row));
  $('#cancel-comment')?.addEventListener('click', () => closeDialog(dialog));
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closeDialog(dialog);
    } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      submitComment(row);
    }
  });
  openDialog('comment-dialog', dialogOpener, '#comment-body');
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function submitComment(row: HTMLElement): void {
  const info = rowPathLine(row);
  const changeSection = document.querySelector('.change-screen') as HTMLElement | null;
  const repoPath = changeSection?.dataset.repo ?? '';
  const changeNumber = changeSection?.dataset.change ?? '';
  const body = ($('#comment-body') as HTMLTextAreaElement).value;
  const button = $('#add-comment') as HTMLButtonElement;
  const suggestionToggle = $('#add-suggestion') as HTMLInputElement | null;
  const doSubmit = async (): Promise<void> => {
    const payload: Record<string, unknown> = {
      path: info.path,
      side: info.side,
      line: info.line,
      body,
    };
    if (suggestionToggle?.checked) {
      const lines = ($('#suggested-lines') as HTMLTextAreaElement).value.split('\n');
      const end = Number(($('#through-line') as HTMLInputElement).value) || info.line;
      payload.suggestion = { lines };
      payload.end_line = end;
    }
    const [org, name] = repoPath.split('/');
    const res = await api(`/api/orgs/${org}/repos/${name}/changes/${changeNumber}/threads`, { method: 'POST', body: payload });
    if (res.ok) {
      actionStatus('Comment added.');
      const dialog = $('#comment-dialog');
      if (dialog) closeDialog(dialog);
      window.location.reload();
    } else {
      const errEl = $('#comment-error');
      if (errEl) errEl.textContent = res.body?.errors?.body ?? res.body?.error ?? '';
    }
  };
  busy(button, 'Submitting...', doSubmit);
}

/* ============ Review dialog ============ */

const reviewBtn = $('#review-btn') as HTMLButtonElement | null;
if (reviewBtn) {
  reviewBtn.addEventListener('click', () => {
    const dialog = openDialog('review-dialog', reviewBtn, 'input[name="review-type"]');
    const cancel = $('#cancel-review');
    cancel?.addEventListener('click', () => closeDialog(dialog));
    $('#submit-review')?.addEventListener('click', () => submitReview());
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeDialog(dialog);
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        submitReview();
      }
    });
  });
}

function submitReview(): void {
  const changeSection = document.querySelector('.change-screen') as HTMLElement | null;
  const repoPath = changeSection?.dataset.repo ?? '';
  const changeNumber = changeSection?.dataset.change ?? '';
  const type = (document.querySelector('input[name="review-type"]:checked') as HTMLInputElement | null)?.value ?? 'comment';
  const summary = ($('#review-summary') as HTMLTextAreaElement).value;
  const button = $('#submit-review') as HTMLButtonElement;
  const doSubmit = async (): Promise<void> => {
    const [org, name] = repoPath.split('/');
    const res = await api(`/api/orgs/${org}/repos/${name}/changes/${changeNumber}/reviews`, {
      method: 'POST',
      body: { type, summary },
    });
    if (res.ok) {
      actionStatus('Review submitted.');
      const dialog = $('#review-dialog');
      if (dialog) closeDialog(dialog);
      window.location.reload();
    } else if (res.body?.errors?.summary) {
      const errEl = $('#review-error');
      if (errEl) errEl.textContent = res.body.errors.summary;
    } else {
      const errEl = $('#review-error');
      if (errEl) errEl.textContent = res.body?.error ?? '';
    }
  };
  busy(button, 'Submitting...', doSubmit);
}

/* ============ Keyboard shortcuts on the change page ============ */

const changeScreen = $('.change-screen') as HTMLElement | null;
if (changeScreen) {
  document.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement;
    const inField = target.matches('input[type="text"], input[type="number"], textarea, select');
    const dialogOpen = !$('#comment-dialog')?.hidden || !$('#review-dialog')?.hidden || !$('#dismiss-dialog')?.hidden;
    if (inField || dialogOpen) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    switch (e.key) {
      case 'j': e.preventDefault(); fileCursor(1); break;
      case 'k': e.preventDefault(); fileCursor(-1); break;
      case 'ArrowDown': e.preventDefault(); moveCursor(1); break;
      case 'ArrowUp': e.preventDefault(); moveCursor(-1); break;
      case 'n': e.preventDefault(); moveThread(1); break;
      case 'p': e.preventDefault(); moveThread(-1); break;
      case 'c': {
        e.preventDefault();
        const current = rows().find((r) => r.getAttribute(cursorAttr) === 'true');
        if (current) openCommentDialog(current);
        break;
      }
      case 'v': e.preventDefault(); toggleViewed(); break;
      case 'r': {
        e.preventDefault();
        reviewBtn?.click();
        break;
      }
      default: break;
    }
  });
}

/* ============ Merge and ready buttons ============ */

const mergeBtn = $('#merge-btn') as HTMLButtonElement | null;
if (mergeBtn) {
  mergeBtn.addEventListener('click', async () => {
    const repoPath = mergeBtn.dataset.repo ?? '';
    const change = mergeBtn.dataset.change ?? '';
    const [org, name] = repoPath.split('/');
    const isQueue = mergeBtn.textContent?.includes('queue');
    await busy(mergeBtn, 'Working...', async () => {
      const res = isQueue
        ? await api(`/api/orgs/${org}/repos/${name}/changes/${change}/queue`, { method: 'POST' })
        : await api(`/api/orgs/${org}/repos/${name}/changes/${change}/merge`, { method: 'POST' });
      if (res.ok) {
        if (isQueue) actionStatus(`Added to the merge queue at position ${res.body.position}.`);
        else actionStatus(`Change #${change} merged.`);
        window.location.reload();
      } else {
        announcement(res.body?.error ?? '');
      }
    });
  });
}

const readyBtn = $('#ready-btn') as HTMLButtonElement | null;
if (readyBtn) {
  readyBtn.addEventListener('click', async () => {
    const [org, name] = (readyBtn.dataset.repo ?? '').split('/');
    await busy(readyBtn, 'Working...', async () => {
      const res = await api(`/api/orgs/${org}/repos/${name}/changes/${readyBtn.dataset.change}/ready`, { method: 'PUT' });
      if (res.ok) {
        window.location.reload();
      } else {
        announcement(res.body?.error ?? '');
      }
    });
  });
}

/* ============ Request review ============ */

const requestForm = $('#request-review-form') as HTMLFormElement | null;
if (requestForm) {
  requestForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const [org, name] = (requestForm.dataset.repo ?? '').split('/');
    await busy($('button', requestForm) as HTMLButtonElement, 'Working...', async () => {
      const res = await api(`/api/orgs/${org}/repos/${name}/changes/${requestForm.dataset.change}/review-requests`, {
        method: 'POST',
        body: { username: ($('#reviewer-username') as HTMLInputElement).value },
      });
      if (res.ok) {
        actionStatus(`Review requested from ${res.body.username}.`);
        window.location.reload();
      } else {
        const errEl = $('#request-error');
        if (errEl) errEl.textContent = res.body?.error ?? '';
      }
    });
  });
}

/* ============ Suggestions ============ */

const batch = new Set<number>();
document.addEventListener('click', (e) => {
  const apply = (e.target as HTMLElement).closest('.apply-suggestion') as HTMLElement | null;
  if (apply) {
    applySuggestion(Number(apply.dataset.comment), apply.dataset.repo ?? '', apply.dataset.change ?? '', false);
    return;
  }
  const toggle = (e.target as HTMLElement).closest('.batch-suggestion') as HTMLElement | null;
  if (toggle) {
    const id = Number(toggle.dataset.comment);
    if (batch.has(id)) {
      batch.delete(id);
      toggle.textContent = 'Add to batch';
    } else {
      batch.add(id);
      toggle.textContent = 'Remove from batch';
    }
    const applyBatch = $('#apply-batch');
    if (applyBatch) {
      if (batch.size > 0) applyBatch.removeAttribute('hidden');
      else applyBatch.setAttribute('hidden', '');
    }
    return;
  }
  const applyBatchBtn = (e.target as HTMLElement).closest('#apply-batch') as HTMLElement | null;
  if (applyBatchBtn) {
    const screen = applyBatchBtn.closest('.change-screen') as HTMLElement | null;
    const repoPath = screen?.dataset.repo ?? '';
    const change = screen?.dataset.change ?? '';
    applySuggestion([...batch], repoPath, change, true);
  }
});

function applySuggestion(commentIds: number | number[], repoPath: string, change: string, isBatch: boolean): void {
  const [org, name] = repoPath.split('/');
  const button = isBatch ? $('#apply-batch') : null;
  void busy(button, 'Working...', async () => {
    const res = await api(`/api/orgs/${org}/repos/${name}/changes/${change}/suggestions/apply`, {
      method: 'POST',
      body: { comments: Array.isArray(commentIds) ? commentIds : [commentIds] },
    });
    if (res.ok) {
      actionStatus(`Suggestions applied in revision ${res.body.revision}.`);
      window.location.reload();
    } else {
      announcement(res.body?.error ?? '');
    }
  });
}

/* ============ Threads: reply, resolve ============ */

document.addEventListener('click', (e) => {
  const reply = (e.target as HTMLElement).closest('.send-reply') as HTMLElement | null;
  if (reply) {
    const threadEl = reply.closest('.thread') as HTMLElement;
    const textarea = $('textarea', threadEl) as HTMLTextAreaElement;
    const [org, name] = (reply.dataset.repo ?? '').split('/');
    void busy(reply, 'Submitting...', async () => {
      const res = await api(`/api/orgs/${org}/repos/${name}/changes/${reply.dataset.change}/threads/${reply.dataset.thread}/replies`, {
        method: 'POST',
        body: { body: textarea.value },
      });
      if (res.ok) {
        actionStatus('Reply sent.');
        window.location.reload();
      } else {
        announcement(res.body?.errors?.body ?? res.body?.error ?? '');
      }
    });
    return;
  }
  const resolve = (e.target as HTMLElement).closest('.resolve-thread') as HTMLElement | null;
  if (resolve) {
    const newState = resolve.dataset.state === 'unresolved' ? 'resolved' : 'unresolved';
    const [org, name] = (resolve.dataset.repo ?? '').split('/');
    void busy(resolve, 'Working...', async () => {
      const res = await api(`/api/orgs/${org}/repos/${name}/changes/${resolve.dataset.change}/threads/${resolve.dataset.thread}/state`, {
        method: 'PUT',
        body: { state: newState },
      });
      if (res.ok) window.location.reload();
      else announcement(res.body?.error ?? '');
    });
  }
});

/* ============ Viewed checkbox ============ */

document.addEventListener('change', (e) => {
  const box = e.target as HTMLInputElement;
  if (!(box instanceof HTMLInputElement) || !box.classList.contains('viewed-check')) return;
  const section = box.closest('.file-section') as HTMLElement;
  const repoPath = ($('.change-screen') as HTMLElement)?.dataset.repo ?? '';
  const change = ($('.change-screen') as HTMLElement)?.dataset.change ?? '';
  const [org, name] = repoPath.split('/');
  section.dataset.viewed = String(box.checked);
  void api(`/api/orgs/${org}/repos/${name}/changes/${change}/viewed`, {
    method: 'PUT',
    body: { path: box.dataset.path, viewed: box.checked },
  }).then((res) => {
    if (res.ok) {
      const line = $('#files-viewed-line');
      if (line) line.textContent = `${res.body.files_viewed} of ${res.body.files_total} files viewed`;
      const header = $('.change-header');
      if (header) header.dataset.filesViewed = String(res.body.files_viewed);
    }
  });
});

/* ============ Outdated switch ============ */

const outdatedSwitch = $('#outdated-switch') as HTMLInputElement | null;
if (outdatedSwitch) {
  outdatedSwitch.addEventListener('change', () => {
    const region = $('#outdated-region');
    if (region) {
      if (outdatedSwitch.checked) region.removeAttribute('hidden');
      else region.setAttribute('hidden', '');
    }
  });
}

/* ============ Diff view radio ============ */

const diffViewRadios = $$<HTMLInputElement>('input[name="diff-view"]');
if (diffViewRadios.length > 0) {
  const saved: string | null = localStorage.getItem('diff-view');
  if (saved) {
    const radio = diffViewRadios.find((r) => r.value === saved);
    if (radio) radio.checked = true;
  }
  diffViewRadios.forEach((radio) => {
    radio.addEventListener('change', () => {
      localStorage.setItem('diff-view', radio.value);
      applyDiffView();
    });
  });
  applyDiffView();
}

function applyDiffView(): void {
  const stageEl = $('#diff-stage');
  if (!stageEl) return;
  const narrow = window.innerWidth < BP;
  const value = (document.querySelector('input[name="diff-view"]:checked') as HTMLInputElement | null)?.value ?? 'unified';
  const group = $('#diff-view-group') as HTMLElement | null;
  const tree = $('.wide-tree') as HTMLElement | null;
  const filesBtn = $('#files-btn') as HTMLButtonElement | null;
  if (group) {
    if (narrow) group.setAttribute('hidden', '');
    else group.removeAttribute('hidden');
  }
  if (tree && filesBtn) {
    if (narrow) {
      tree.setAttribute('hidden', '');
      filesBtn.removeAttribute('hidden');
    } else {
      tree.removeAttribute('hidden');
      filesBtn.setAttribute('hidden', '');
    }
  }
  if (narrow) {
    stageEl.classList.remove('split-view');
    return;
  }
  stageEl.classList.toggle('split-view', value === 'split');
}

window.addEventListener('resize', applyDiffView);

const filesBtn = $('#files-btn') as HTMLButtonElement | null;
filesBtn?.addEventListener('click', () => {
  const existing = $('#files-drawer');
  if (existing) { existing.remove(); return; }
  const dialog = document.createElement('div');
  dialog.className = 'dialog-backdrop';
  dialog.id = 'files-drawer';
  dialog.setAttribute('role', 'dialog');
  dialog.setAttribute('aria-modal', 'true');
  dialog.setAttribute('aria-label', 'Files');
  const tree = $('.wide-tree') as HTMLElement | null;
  dialog.innerHTML = `<div class="dialog"><h2 class="card-title">Files</h2><ul class="file-list" role="navigation" aria-label="File tree">${
    (tree ? [...tree.querySelectorAll('a')].map((a) => `<li><a class="fl mono" href="#" data-path="${(a as HTMLElement).dataset.path}">${a.textContent}</a></li>`).join('') : '')
  }</ul><button class="btn-secondary" id="files-close" type="button">Close</button></div>`;
  document.body.appendChild(dialog);
  $('#files-close')?.addEventListener('click', () => dialog.remove());
  trapFocus(dialog);
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      dialog.remove();
      filesBtn.focus();
    }
  });
  $$('.fl', dialog).forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const path = link.dataset.path;
      const row = rows().find((r) => r.dataset.path === path);
      if (row) setCursor(row);
      dialog.remove();
      filesBtn.focus();
    });
  });
});

/* ============ Queue reorder ============ */

$$('.queue-entry').forEach((entry: HTMLElement) => {
  entry.addEventListener('keydown', (e) => {
    if (e.altKey && e.key === 'ArrowUp') {
      e.preventDefault();
      moveEntry(entry, -1);
    } else if (e.altKey && e.key === 'ArrowDown') {
      e.preventDefault();
      moveEntry(entry, 1);
    }
  });
});

function moveEntry(entry: HTMLElement, delta: number): void {
  const id = entry.dataset.queueEntryId;
  const position = Number(entry.dataset.position) + delta;
  const [org, name] = window.location.pathname.split('/').slice(1, 3);
  void api(`/api/orgs/${org}/repos/${name}/queue/${id}/position`, {
    method: 'PUT',
    body: { position },
  }).then((res) => {
    if (res.ok) window.location.reload();
  });
}

$$('button[data-move]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const entry = btn.closest('.queue-entry') as HTMLElement;
    moveEntry(entry, btn.dataset.move === 'up' ? -1 : 1);
  });
});

/* ============ Rail walk (approval carry-over) ============ */

let walkRunning = false;
let walkQueued = false;

function railWalk(fromPosition: number): void {
  if (walkRunning) {
    walkQueued = true;
    return;
  }
  walkRunning = true;
  const railRows = $$('.stack-row');
  const start = railRows.findIndex((r) => Number(r.dataset.stackPosition) >= fromPosition);
  if (start < 0) {
    walkRunning = false;
    return;
  }
  if (reducedMotion()) {
    for (const row of railRows.slice(start)) {
      row.dataset.anim = 'none';
    }
    const sentence = railRows
      .slice(start)
      .map((row) => railSentence(row))
      .join(' ');
    if (sentence) announce(sentence);
    walkRunning = false;
    return;
  }
  let index = start;
  const step = (): void => {
    railRows.forEach((row, i) => {
      if (i >= start && i < index) {
        row.classList.remove('expanded');
        row.dataset.anim = 'none';
      }
    });
    if (index >= railRows.length || index - start >= 8) {
      // Stay on the lowest row that needs action.
      const needsAction = railRows.slice(start).find((row) => row.dataset.restack === 'dismissed' || row.dataset.restack === 'conflicting');
      if (needsAction) needsAction.classList.add('expanded');
      walkRunning = false;
      if (walkQueued) {
        walkQueued = false;
        window.setTimeout(() => railWalk(fromPosition), 550);
      }
      return;
    }
    const row = railRows[index];
    row.classList.add('expanded');
    row.dataset.anim = 'walking';
    window.setTimeout(() => {
      row.dataset.anim = 'none';
      announce(railSentence(row));
      index++;
      step();
    }, 550);
  };
  step();
}

function railSentence(row: HTMLElement): string {
  const number = row.dataset.changeNumber;
  switch (row.dataset.restack) {
    case 'kept': return `#${number}: restack kept approvals`;
    case 'dismissed': return `#${number}: restack dismissed approvals`;
    case 'conflicting': return `#${number}: restack conflict`;
    case 'not_restacked': return `#${number}: not restacked`;
    default: return '';
  }
}

/* ============ Live updates ============ */

const liveTarget = changeScreen ?? $('.queue-entry')?.parentElement ?? null;
if (liveTarget || document.body.dataset.live === 'on' || true) {
  const source = new EventSource('/api/live');
  source.addEventListener('update', (event) => {
    try {
      const payload = JSON.parse((event as MessageEvent).data);
      handleUpdate(payload);
    } catch {
      // Ignore malformed events.
    }
  });
}

function handleUpdate(payload: any): void {
  switch (payload.kind) {
    case 'comment':
      announce(`#${payload.number}: new comment from ${payload.author}`);
      if (!payload.self) window.location.reload();
      break;
    case 'review':
      announce(payload.type === 'approve'
        ? `#${payload.number}: ${payload.reviewer} approved`
        : payload.type === 'request_changes'
          ? `#${payload.number}: ${payload.reviewer} requested changes`
          : `#${payload.number}: review from ${payload.reviewer}`);
      if (!payload.self) window.location.reload();
      break;
    case 'review_dismissed':
      announce(`#${payload.number}: review by ${payload.by} dismissed`);
      if (!payload.self) window.location.reload();
      break;
    case 'check':
      announce(`#${payload.number}: check ${payload.name} ${payload.stateWord}`);
      if (!payload.self) window.location.reload();
      break;
    case 'new_revision':
      announce(`#${payload.number}: new revision ${payload.revision} from ${payload.author}`);
      if (!payload.self) window.location.reload();
      break;
    case 'restack':
      announce(`#${payload.number}: restack ${payload.result}`);
      if (!payload.self) window.location.reload();
      break;
    case 'queue':
      announce(`#${payload.number}: queue position ${payload.position}`);
      if (!payload.self) window.location.reload();
      break;
    case 'queue_position':
      announce(`#${payload.number}: queue position ${payload.position}`);
      if (!payload.self) window.location.reload();
      break;
    case 'merged':
      announce(`#${payload.number} merged`);
      if (!payload.self) window.location.reload();
      break;
    case 'viewed':
      if (!payload.self) window.location.reload();
      break;
    default:
      break;
  }
}
