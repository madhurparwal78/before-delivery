// Projects list, project tabs (keys/sessions/review/synthesis/settings), usage, members, plan.

import { el, getJson, navigate, statusRegion, setStatus, uuid, clear } from './lib';
import { renderConsoleShell, quotaMeter } from './console';
import type { Me } from './console';
import { closeDialog, fetchAudio } from './console';
import type { ApiKeySummary, ProjectSummary, Quota, Session, SynthesisJob, Correction, Member } from '../src-shared/protocol';
import { quotaHaltCopy, KEYS_STATUS, PROJECT_ERRORS, SETTINGS_STATUS, MEMBERS_STATUS, SYNTHESIS_STATUS, SEARCH_RESULTS } from '../src-shared/copy';
import { formatBillableMinutes, formatCostCents, type PlanId } from '../src-shared/billing';
import { formatWer } from '../src-shared/vtt';

const TAB_ROLES: Record<string, Member['role'][]> = {
  keys: ['admin', 'developer'],
  sessions: ['admin', 'developer', 'reviewer', 'approver'],
  review: ['admin', 'developer', 'reviewer', 'approver'],
  synthesis: ['admin', 'developer'],
  settings: ['admin'],
};

// ---------------- Projects list ----------------

export async function renderProjectsList(): Promise<void> {
  await renderConsoleShell(async (me) => {
    const section = el('section', { 'aria-label': 'Projects' });
    section.append(el('h1', {}, 'Projects'));
    if (me.user.role === 'admin') {
      const newBtn = el('button', { type: 'button', class: 'accent' }, 'New project');
      newBtn.addEventListener('click', () => openNewProjectDialog());
      section.append(newBtn);
    }
    const table = el('table', { 'aria-label': 'Projects' });
    const thead = el('thead');
    const headRow = el('tr');
    for (const h of ['Name', 'Quota used', 'Sessions']) headRow.append(el('th', {}, h));
    thead.append(headRow);
    const tbody = el('tbody');
    table.append(thead, tbody);
    const data = await getJson<{ projects: (ProjectSummary & { quota: Quota })[] }>('/api/projects');
    for (const p of data.projects) {
      const tr = el('tr');
      const nameA = el('a', { href: `/console/projects/${p.id}/sessions` }, p.name);
      nameA.addEventListener('click', (ev) => { ev.preventDefault(); void navigate(`/console/projects/${p.id}/${firstTab(me)}`); });
      tr.append(
        el('td', {}, nameA),
        el('td', { class: 'num' }, `${(p.quota.used_seconds / 60).toFixed(2)} / ${p.quota.limit_minutes} min`),
        el('td', { class: 'num' }, String(p.sessions)),
      );
      tbody.append(tr);
    }
    section.append(table);
    return section;
  }, { navRoute: 'projects' });
}

function firstTab(me: Me): string {
  return me.user.role === 'admin' || me.user.role === 'developer' ? 'keys' : me.user.role === 'approver' ? 'sessions' : 'sessions';
}

function openNewProjectDialog(): void {
  const dlg = el('dialog', { 'aria-label': 'New project' }) as HTMLDialogElement;
  const name = el('input', { type: 'text', id: 'np-name' });
  const quota = el('input', { type: 'text', inputmode: 'numeric', id: 'np-quota' });
  const status = statusRegion('New project status');
  const create = el('button', { type: 'submit', class: 'accent' }, 'Create project');
  const cancel = el('button', { type: 'button' }, 'Cancel');
  const form = el('form');
  const nf = el('div', { class: 'field' });
  nf.append(el('label', { for: 'np-name' }, 'Project name'), name);
  const qf = el('div', { class: 'field' });
  qf.append(el('label', { for: 'np-quota' }, 'Monthly quota (minutes)'), quota);
  form.append(nf, qf, status);
  const actions = el('div', { class: 'dialog-actions' });
  actions.append(cancel, create);
  form.append(actions);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    create.disabled = true;
    try {
      const res = await fetch('/api/projects', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.value, monthly_quota_minutes: Number(quota.value) }),
      });
      if (res.ok) {
        const data = (await res.json()) as { project: { id: string } };
        closeDialog(dlg);
        // The address bar becomes the project's Keys tab route; Keys status announces the creation.
        await navigate(`/console/projects/${data.project.id}/keys`, true);
        return;
      }
      const err = (await res.json()) as { fields?: Record<string, string> };
      const fields = err.fields ?? {};
      status.textContent = fields['name'] ?? fields['monthly_quota_minutes'] ?? fields['name_taken' as string] ?? 'Something went wrong. Try again.';
    } catch {
      setStatus(status, 'Something went wrong. Try again.');
    } finally {
      create.disabled = false;
    }
  });
  cancel.addEventListener('click', () => closeDialog(dlg));
  dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); closeDialog(dlg); });
  const body = el('div', { class: 'dialog-body' });
  body.append(el('h2', {}, 'New project'), form);
  dlg.append(body);
  document.body.append(dlg);
  dlg.showModal();
  name.focus();
}

// ---------------- Project page ----------------

export async function renderProject(projectId: string, tab: string): Promise<void> {
  await renderConsoleShell(async (me) => {
    const allowed = TAB_ROLES[tab] ?? [];
    if (!allowed.includes(me.user.role)) {
      // Opening a route the role isn't allowed redirects to the role's landing route.
      await navigate(me.user.role === 'billing' ? '/console/usage' : '/console/projects', true);
      return el('section');
    }
    const section = el('section', { class: 'project-page', 'aria-label': me.org.name });
    const project = await getJson<{ project: ProjectSummary & { quota: Quota } }>(`/api/projects/${projectId}`);
    section.append(el('h1', {}, project.project.name));
    const meter = quotaMeter(project.project.quota);
    const quotaRegion = statusRegion('Quota status');
    quotaRegion.id = 'quota-status';
    if (project.project.quota.exhausted) {
      quotaRegion.append(el('div', { class: 'banner', role: 'alert' }, quotaHaltCopy(project.project.quota)));
    }
    const header = el('div', { class: 'project-header' });
    header.append(el('span', { class: 'num' }, meter.label), meter.progressbar);
    section.append(header, quotaRegion);

    const tabs = el('div', { role: 'tablist', 'aria-label': 'Project' });
    for (const t of ['keys', 'sessions', 'review', 'synthesis', 'settings']) {
      if (!(TAB_ROLES[t] ?? []).includes(me.user.role)) continue;
      const btn = el('button', { role: 'tab', type: 'button', 'aria-selected': t === tab ? 'true' : 'false', id: `tab-${t}` });
      btn.textContent = t.charAt(0).toUpperCase() + t.slice(1);
      btn.addEventListener('click', () => void navigate(`/console/projects/${projectId}/${t}`));
      tabs.append(btn);
    }
    section.append(tabs);

    const panel = el('div', { role: 'tabpanel', 'aria-labelledby': `tab-${tab}`, class: 'tab-panel' });
    if (tab === 'keys') panel.append(await keysPanel(projectId));
    else if (tab === 'sessions') panel.append(await sessionsPanel(projectId));
    else if (tab === 'review') panel.append(await reviewPanel(projectId));
    else if (tab === 'synthesis') panel.append(await synthesisPanel(projectId));
    else if (tab === 'settings') panel.append(await settingsPanel(projectId));
    section.append(panel);
    return section;
  }, { navRoute: 'projects' });
}

// ---------------- Keys tab ----------------

async function keysPanel(projectId: string): Promise<HTMLElement> {
  const wrap = el('div');
  const status = statusRegion('Keys status');
  status.id = 'keys-status';
  const issue = el('button', { type: 'button', class: 'accent' }, 'Issue key');
  issue.addEventListener('click', () => openIssueKeyDialog(projectId, status));
  const table = el('table', { 'aria-label': 'API keys' });
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['Name', 'Prefix', 'Created', '']) hr.append(el('th', {}, h));
  thead.append(hr);
  const tbody = el('tbody');
  table.append(thead, tbody);
  const refresh = async () => {
    const data = await getJson<{ keys: ApiKeySummary[] }>(`/api/projects/${projectId}/keys`);
    tbody.textContent = '';
    for (const k of data.keys) {
      const tr = el('tr');
      tr.append(
        el('td', {}, k.name),
        el('td', { class: 'num' }, k.prefix),
        el('td', { class: 'num' }, k.created_at),
      );
      const actions = el('td');
      if (!k.revoked_at) {
        const revoke = el('button', { type: 'button', 'aria-label': `Revoke ${k.name}` }, 'Revoke');
        revoke.addEventListener('click', () => openRevokeKeyDialog(projectId, k, status, tbody, refresh));
        actions.append(revoke);
      } else {
        actions.append(el('span', { class: 'num' }, k.revoked_at));
      }
      tr.append(actions);
      tbody.append(tr);
    }
  };
  await refresh();
  wrap.append(issue, status, table);
  return wrap;
}

function openIssueKeyDialog(projectId: string, status: HTMLElement): void {
  const dlg = el('dialog', { 'aria-label': 'Issue key' }) as HTMLDialogElement;
  const name = el('input', { type: 'text', id: 'ik-name' });
  const create = el('button', { type: 'submit', class: 'accent' }, 'Create key');
  const cancel = el('button', { type: 'button' }, 'Cancel');
  const form = el('form');
  const nf = el('div', { class: 'field' });
  nf.append(el('label', { for: 'ik-name' }, 'Key name'), name);
  form.append(nf);
  const secretWrap = el('div', { class: 'field', hidden: 'true' });
  const secret = el('input', { type: 'text', readonly: 'true', id: 'ik-secret', 'aria-label': 'New key' });
  const copy = el('button', { type: 'button' }, 'Copy key');
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(secret.value);
  });
  secretWrap.append(el('label', { for: 'ik-secret' }, 'New key'), secret, copy);
  const actions = el('div', { class: 'dialog-actions' });
  actions.append(cancel, create);
  form.append(actions, secretWrap);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    create.disabled = true;
    try {
      const res = await fetch(`/api/projects/${projectId}/keys`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.value }),
      });
      if (res.ok) {
        const data = (await res.json()) as { key: ApiKeySummary; secret: string };
        // The secret is shown exactly once.
        secret.value = data.secret;
        secretWrap.hidden = false;
        create.hidden = true;
        name.disabled = true;
        copy.focus();
        return;
      }
      const err = (await res.json()) as { fields?: Record<string, string> };
      const f = document.createElement('p');
      f.className = 'field-error';
      f.textContent = err.fields?.['name'] ?? KEYS_STATUS.keyNameError;
      nf.append(f);
    } finally {
      create.disabled = false;
    }
  });
  cancel.addEventListener('click', () => closeDialog(dlg));
  dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); closeDialog(dlg); });
  const body = el('div', { class: 'dialog-body' });
  body.append(el('h2', {}, 'Issue key'), form);
  dlg.append(body);
  document.body.append(dlg);
  dlg.showModal();
  name.focus();
}

function openRevokeKeyDialog(projectId: string, key: ApiKeySummary, status: HTMLElement, _tbody: HTMLElement, refresh: () => Promise<void>): void {
  const dlg = el('dialog', { 'aria-label': 'Revoke key' }) as HTMLDialogElement;
  const revoke = el('button', { type: 'button', class: 'accent' }, 'Revoke key');
  const cancel = el('button', { type: 'button' }, 'Cancel');
  const p = el('p', {}, `Revoke ${key.name}? Live sessions on it end at once.`);
  const actions = el('div', { class: 'dialog-actions' });
  actions.append(cancel, revoke);
  revoke.addEventListener('click', async () => {
    revoke.disabled = true;
    try {
      const res = await fetch(`/api/projects/${projectId}/keys/${key.id}`, { method: 'DELETE', credentials: 'same-origin' });
      if (res.ok) {
        const data = (await res.json()) as { closed_sessions: string[] };
        closeDialog(dlg);
        // Focus returns to the key table and the result is announced in Keys status.
        setStatus(status, `Key revoked. Live sessions closed: ${data.closed_sessions.length}.`);
        await refresh();
      }
    } finally {
      revoke.disabled = false;
    }
  });
  cancel.addEventListener('click', () => closeDialog(dlg));
  dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); closeDialog(dlg); });
  const body = el('div', { class: 'dialog-body' });
  body.append(el('h2', {}, 'Revoke key'), p, actions);
  dlg.append(body);
  document.body.append(dlg);
  dlg.showModal();
  revoke.focus();
}

// ---------------- Sessions tab ----------------

async function sessionsPanel(projectId: string): Promise<HTMLElement> {
  const wrap = el('div');
  const start = el('button', { type: 'button', class: 'accent' }, 'Start session');
  start.addEventListener('click', () => openStartSessionDialog(projectId));
  const table = el('table', { 'aria-label': 'Sessions' });
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['', 'Label', 'Kind', 'State', 'Audio', 'Billable minutes', 'Started']) hr.append(el('th', {}, h));
  thead.append(hr);
  const tbody = el('tbody');
  table.append(thead, tbody);
  const refresh = async () => {
    const data = await getJson<{ sessions: Session[] }>(`/api/projects/${projectId}/sessions`);
    tbody.textContent = '';
    for (const s of data.sessions) {
      const tr = el('tr');
      const thumb = el('td');
      const img = el('canvas', { class: 'spectrum-thumb', role: 'img', 'aria-label': 'Spectrum thumbnail', 'data-morph': s.id, width: '64', height: '24' });
      void drawThumb(img as HTMLCanvasElement, s.id);
      thumb.append(img);
      tr.append(thumb);
      const label = el('a', { href: `/console/sessions/${s.id}` }, s.label || 'Untitled session');
      label.addEventListener('click', (ev) => {
        ev.preventDefault();
        // The list-to-detail morph source.
        void navigate(`/console/sessions/${s.id}`);
        lastMorphSource = { rect: (img as HTMLCanvasElement).getBoundingClientRect(), dataMorph: s.id };
      });
      tr.append(
        el('td', {}, label),
        el('td', {}, s.kind),
        el('td', {}, s.state.replace('_', ' ')),
        el('td', { class: 'num' }, `${(s.audio_ms / 1000).toFixed(3)} s`),
        el('td', { class: 'num' }, s.billable_seconds === null ? '—' : formatBillableMinutes(s.billable_seconds)),
        el('td', { class: 'num' }, s.started_at),
      );
      tbody.append(tr);
    }
  };
  await refresh();
  wrap.append(start, table);
  return wrap;
}

let lastMorphSource: { rect: DOMRect; dataMorph: string } | null = null;
export function consumeMorphSource(): { rect: DOMRect; dataMorph: string } | null {
  const s = lastMorphSource;
  lastMorphSource = null;
  return s;
}

async function drawThumb(canvas: HTMLCanvasElement, sessionId: string): Promise<void> {
  try {
    const spec = await getJson<{ mean: number[] }>(`/api/sessions/${sessionId}/spectrum`);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const W = canvas.width;
    const H = canvas.height;
    ctx.fillStyle = '#0c0e10';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#3ddc97';
    for (let i = 0; i < 64; i++) {
      const x0 = Math.floor((i * W) / 64);
      const x1 = Math.floor(((i + 1) * W) / 64) - 1;
      const lit = Math.round((spec.mean[i] ?? 0) * H);
      if (x1 >= x0 && lit > 0) ctx.fillRect(x0, H - lit, x1 - x0 + 1, lit);
    }
  } catch {
    // The thumbnail stays empty when the spectrum can't be read.
  }
}

function openStartSessionDialog(projectId: string): void {
  const dlg = el('dialog', { 'aria-label': 'Start session' }) as HTMLDialogElement;
  const keySelect = el('select', { id: 'ss-key' });
  const sourceGroup = el('fieldset');
  const toneRadio = el('input', { type: 'radio', name: 'source', value: 'tone', checked: 'true', id: 'ss-tone' });
  const uploadRadio = el('input', { type: 'radio', name: 'source', value: 'upload', id: 'ss-upload' });
  const audioInput = el('input', { type: 'file', accept: 'audio/wav,.wav', disabled: 'true', id: 'ss-audio' });
  const sidecarInput = el('input', { type: 'file', accept: '.vtt,text/vtt', disabled: 'true', id: 'ss-sidecar' });
  const label = el('input', { type: 'text', id: 'ss-label', maxlength: '80' });
  const startBtn = el('button', { type: 'submit', class: 'accent' }, 'Start');
  const status = statusRegion('Upload status');
  status.id = 'upload-status';
  const form = el('form');
  // Each time the dialog opens, it makes one fresh Idempotency-Key.
  let idempotencyKey = uuid();

  toneRadio.addEventListener('change', () => { audioInput.disabled = true; sidecarInput.disabled = true; audioInput.value = ''; sidecarInput.value = ''; });
  uploadRadio.addEventListener('change', () => { audioInput.disabled = false; sidecarInput.disabled = false; });

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    startBtn.disabled = true;
    setStatus(status, 'Uploading audio');
    const fd = new FormData();
    fd.append('key_id', keySelect.value);
    fd.append('source', toneRadio.checked ? 'tone' : 'upload');
    fd.append('label', label.value);
    if (uploadRadio.checked) {
      const audio = (audioInput.files ?? [])[0];
      const sidecar = (sidecarInput.files ?? [])[0];
      if (audio) fd.append('audio', audio);
      if (sidecar) fd.append('sidecar', sidecar);
    }
    try {
      const res = await fetch(`/api/projects/${projectId}/sessions`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Idempotency-Key': idempotencyKey }, body: fd,
      });
      if (res.status === 201) {
        const data = (await res.json()) as { session: Session };
        closeDialog(dlg);
        await navigate(`/console/sessions/${data.session.id}`, true);
        return;
      }
      const err = (await res.json()) as { fields?: Record<string, string>; error?: string };
      const fields = err.fields ?? {};
      if (fields['audio'] || fields['sidecar'] || fields['key_id'] || fields['label'] || fields['source'] || fields['idempotency_key']) {
        setStatus(status, fields['audio'] ?? fields['sidecar'] ?? fields['key_id'] ?? fields['label'] ?? fields['source'] ?? fields['idempotency_key'] ?? 'Something went wrong. Try again.');
      } else if (res.status === 429) {
        setStatus(status, '');
        status.append(el('div', { class: 'banner', role: 'alert' }, 'Quota reached. New sessions are refused until the quota resets or is raised.'));
      } else if (res.status === 503) {
        setStatus(status, 'Audio storage is unreachable. Playback and uploads will resume once it\u2019s back, and nothing you\u2019ve typed is lost.');
        markStorageOutage();
      } else if (res.status === 409 && err.error === 'idempotency_in_progress') {
        setStatus(status, 'Uploading audio');
      } else {
        setStatus(status, 'Something went wrong. Try again.');
      }
    } catch {
      setStatus(status, 'Something went wrong. Try again.');
    } finally {
      startBtn.disabled = false;
    }
  });

  void getJson<{ keys: ApiKeySummary[] }>(`/api/projects/${projectId}/keys`).then((data) => {
    for (const k of data.keys) {
      if (k.revoked_at) continue;
      const opt = el('option', { value: k.id }, k.name);
      keySelect.append(opt);
    }
  });

  const fields = el('div');
  const kf = el('div', { class: 'field' });
  kf.append(el('label', { for: 'ss-key' }, 'API key'), keySelect);
  const sf = el('fieldset', { class: 'field' });
  sf.append(el('legend', {}, 'Source'));
  const t1 = el('label', { class: 'radio' });
  t1.append(toneRadio, document.createTextNode(' Test tone (1 kHz)'));
  const t2 = el('label', { class: 'radio' });
  t2.append(uploadRadio, document.createTextNode(' Upload recording'));
  sf.append(t1, t2);
  const af = el('div', { class: 'field' });
  af.append(el('label', { for: 'ss-audio' }, 'Audio file'), audioInput);
  const vf = el('div', { class: 'field' });
  vf.append(el('label', { for: 'ss-sidecar' }, 'Sidecar (WebVTT)'), sidecarInput);
  const lf = el('div', { class: 'field' });
  lf.append(el('label', { for: 'ss-label' }, 'Label'), label);
  fields.append(kf, sf, af, vf, lf);
  const actions = el('div', { class: 'dialog-actions' });
  actions.append(startBtn);
  form.append(fields, status, actions);
  const body = el('div', { class: 'dialog-body' });
  body.append(el('h2', {}, 'Start session'), form);
  dlg.append(body);
  dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); closeDialog(dlg); });
  document.body.append(dlg);
  dlg.showModal();
  keySelect.focus();
}

function markStorageOutage(): void {
  const ev = new CustomEvent('lowfield:storage-outage');
  window.dispatchEvent(ev);
}

// ---------------- Review tab ----------------

async function reviewPanel(projectId: string): Promise<HTMLElement> {
  const wrap = el('div');
  const table = el('table', { 'aria-label': 'Awaiting approval' });
  const thead = el('thead');
  const hr = el('tr');
  for (const h of ['Correction', 'State', 'Author', '']) hr.append(el('th', {}, h));
  thead.append(hr);
  const tbody = el('tbody');
  table.append(thead, tbody);
  const refresh = async () => {
    const [awaiting, mine] = await Promise.all([
      getJson<{ corrections: Correction[] }>(`/api/projects/${projectId}/corrections?state=submitted`),
      getJson<{ corrections: Correction[] }>(`/api/projects/${projectId}/corrections?state=draft`),
    ]);
    tbody.textContent = '';
    for (const c of [...awaiting.corrections, ...mine.corrections]) {
      const tr = el('tr');
      tr.append(
        el('td', {}, c.text),
        el('td', {}, c.state),
        el('td', {}, c.author.name),
      );
      const td = el('td');
      const link = el('a', { href: `/console/sessions/${c.session_id}?segment=${c.segment_id}` }, 'Open correction');
      link.addEventListener('click', (ev) => { ev.preventDefault(); void navigate(`/console/sessions/${c.session_id}?segment=${c.segment_id}`); });
      td.append(link);
      tr.append(td);
      tbody.append(tr);
    }
  };
  await refresh();
  wrap.append(el('h2', {}, 'Awaiting approval'), table);
  return wrap;
}

// ---------------- Synthesis tab ----------------

async function synthesisPanel(projectId: string): Promise<HTMLElement> {
  const wrap = el('div');
  const keySelect = el('select', { id: 'syn-key' });
  const text = el('textarea', { id: 'syn-text', rows: '4' });
  const status = statusRegion('Synthesis status');
  status.id = 'synth-status';
  const lumen = el('input', { type: 'radio', name: 'voice', value: 'lumen', id: 'voice-lumen', checked: 'true' });
  const basalt = el('input', { type: 'radio', name: 'voice', value: 'basalt', id: 'voice-basalt' });
  const render = el('button', { type: 'submit', class: 'accent' }, 'Render');
  const form = el('form');
  const kf = el('div', { class: 'field' });
  kf.append(el('label', { for: 'syn-key' }, 'API key'), keySelect);
  const tf = el('div', { class: 'field' });
  tf.append(el('label', { for: 'syn-text' }, 'Text to speak'), text);
  const vf = el('fieldset', { class: 'field' });
  vf.append(el('legend', {}, 'Voice'));
  const v1 = el('label', { class: 'radio' });
  v1.append(lumen, document.createTextNode(' Lumen'));
  const v2 = el('label', { class: 'radio' });
  v2.append(basalt, document.createTextNode(' Basalt'));
  vf.append(v1, v2);
  const audioWrap = el('div', { class: 'field', hidden: 'true' });
  const audio = el('audio', { controls: 'true', id: 'rendered-audio' }) as HTMLAudioElement;
  audio.setAttribute('aria-label', 'Rendered audio');
  audioWrap.append(el('label', {}, 'Rendered audio'), audio);
  form.append(kf, tf, vf, status, render, audioWrap);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    render.disabled = true;
    setStatus(status, 'Rendering');
    try {
      const res = await fetch(`/api/projects/${projectId}/synthesis`, {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key_id: keySelect.value, text: text.value, voice: lumen.checked ? 'lumen' : 'basalt' }),
      });
      if (res.status === 201) {
        const data = (await res.json()) as { job: SynthesisJob };
        setStatus(status, `Rendered ${(data.job.duration_ms / 1000).toFixed(3)} seconds of audio.`);
        // The cookie-authorised console route.
        const audioRes = await fetchAudio(data.job.console_audio_url);
        if (audioRes.ok) {
          const blob = await audioRes.blob();
          audio.src = URL.createObjectURL(blob);
          audioWrap.hidden = false;
        }
      } else {
        const err = (await res.json()) as { fields?: Record<string, string> };
        setStatus(status, err.fields?.['text'] ?? err.fields?.['voice'] ?? err.fields?.['key_id'] ?? 'Something went wrong. Try again.');
      }
    } catch {
      setStatus(status, 'Something went wrong. Try again.');
    } finally {
      render.disabled = false;
    }
  });
  const data = await getJson<{ keys: ApiKeySummary[] }>(`/api/projects/${projectId}/keys`);
  for (const k of data.keys) {
    if (k.revoked_at) continue;
    keySelect.append(el('option', { value: k.id }, k.name));
  }
  wrap.append(el('h2', {}, 'Synthesis'), form);
  return wrap;
}

// ---------------- Settings tab ----------------

async function settingsPanel(projectId: string): Promise<HTMLElement> {
  const wrap = el('div');
  const project = await getJson<{ project: { quota: Quota } }>(`/api/projects/${projectId}`);
  const quota = el('input', { type: 'text', inputmode: 'numeric', id: 'q-min', value: String(project.project.quota.limit_minutes) });
  const status = statusRegion('Settings status');
  status.id = 'settings-status';
  const save = el('button', { type: 'submit', class: 'accent' }, 'Save quota');
  const form = el('form');
  const qf = el('div', { class: 'field' });
  qf.append(el('label', { for: 'q-min' }, 'Monthly quota (minutes)'), quota);
  form.append(qf, status, save);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    save.disabled = true;
    try {
      const res = await fetch(`/api/projects/${projectId}/quota`, {
        method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ monthly_quota_minutes: Number(quota.value) }),
      });
      if (res.ok) {
        setStatus(status, SETTINGS_STATUS.saved);
      } else {
        const err = (await res.json()) as { fields?: Record<string, string> };
        setStatus(status, err.fields?.['monthly_quota_minutes'] ?? 'Something went wrong. Try again.');
      }
    } catch {
      setStatus(status, 'Something went wrong. Try again.');
    } finally {
      save.disabled = false;
    }
  });
  wrap.append(el('h2', {}, 'Settings'), form);
  return wrap;
}

// ---------------- Usage ----------------

export async function renderUsage(): Promise<void> {
  await renderConsoleShell(async () => {
    const section = el('section', { 'aria-label': 'Usage' });
    section.append(el('h1', {}, 'Usage'));
    const data = await getJson<{
      month: string; billing_reachable: boolean; org_total_cents: number;
      projects: { project_id: string; name: string; sessions: number; billable_seconds: number; cost_cents: number; billing_state: 'confirmed' | 'pending' }[];
    }>('/api/usage');
    if (!data.billing_reachable) {
      window.dispatchEvent(new CustomEvent('lowfield:billing-outage'));
    }
    const table = el('table', { 'aria-label': 'Usage by project' });
    const thead = el('thead');
    const hr = el('tr');
    for (const h of ['Project', 'Sessions', 'Billable minutes', 'Cost', 'Status']) hr.append(el('th', {}, h));
    thead.append(hr);
    const tbody = el('tbody');
    for (const p of data.projects) {
      const tr = el('tr');
      tr.append(
        el('td', {}, p.name),
        el('td', { class: 'num' }, String(p.sessions)),
        el('td', { class: 'num' }, formatBillableMinutes(p.billable_seconds)),
        el('td', { class: 'num' }, formatCostCents(p.cost_cents)),
        el('td', {}, el('span', { class: `badge ${p.billing_state}` }, p.billing_state === 'confirmed' ? 'Confirmed' : 'Pending')),
      );
      tbody.append(tr);
    }
    table.append(thead, tbody);
    const total = el('div', { class: 'org-total', role: 'region', 'aria-label': 'Organisation total' });
    total.append(el('h2', {}, 'Organisation total'), el('p', { class: 'num' }, `${data.month} — ${formatCostCents(data.org_total_cents)}`));
    section.append(table, total);
    return section;
  }, { navRoute: 'usage' });
}

// ---------------- Members ----------------

export async function renderMembers(): Promise<void> {
  await renderConsoleShell(async (me) => {
    const section = el('section', { 'aria-label': 'Members' });
    section.append(el('h1', {}, 'Members'));
    const status = statusRegion('Members status');
    status.id = 'members-status';
    const invite = el('button', { type: 'button', class: 'accent' }, 'Invite teammate');
    invite.addEventListener('click', () => openInviteDialog(status, refresh));
    const table = el('table', { 'aria-label': 'Members' });
    const thead = el('thead');
    const hr = el('tr');
    for (const h of ['Name', 'Email', 'Role', '']) hr.append(el('th', {}, h));
    thead.append(hr);
    const tbody = el('tbody');
    table.append(thead, tbody);
    const refresh = async () => {
      const data = await getJson<{ members: Member[] }>('/api/org/members');
      tbody.textContent = '';
      for (const m of data.members) {
        const tr = el('tr');
        tr.append(el('td', {}, m.name), el('td', {}, m.email));
        const roleTd = el('td');
        if (m.id !== me.user.id) {
          const select = el('select', { 'aria-label': `Role for ${m.name}` });
          for (const r of ['admin', 'developer', 'reviewer', 'approver', 'billing']) {
            const opt = el('option', { value: r }, r);
            if (m.role === r) opt.selected = true;
            select.append(opt);
          }
          select.addEventListener('change', async () => {
            const res = await fetch(`/api/org/members/${m.id}`, {
              method: 'PATCH', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ role: select.value }),
            });
            if (res.ok) setStatus(status, MEMBERS_STATUS.updated);
            else if (res.status === 409) setStatus(status, MEMBERS_STATUS.selfChange);
            else setStatus(status, 'Something went wrong. Try again.');
          });
          roleTd.append(select);
        } else {
          roleTd.textContent = m.role;
        }
        tr.append(roleTd);
        const actions = el('td');
        if (m.id !== me.user.id) {
          const remove = el('button', { type: 'button', 'aria-label': `Remove ${m.name}` }, 'Remove');
          remove.addEventListener('click', async () => {
            const res = await fetch(`/api/org/members/${m.id}`, { method: 'DELETE', credentials: 'same-origin' });
            if (res.status === 204) setStatus(status, MEMBERS_STATUS.removed);
            else if (res.status === 409) setStatus(status, MEMBERS_STATUS.selfChange);
            else setStatus(status, 'Something went wrong. Try again.');
            await refresh();
          });
          actions.append(remove);
        }
        tr.append(actions);
        tbody.append(tr);
      }
    };
    await refresh();
    section.append(invite, status, table);
    return section;
  }, { navRoute: 'members' });
}

function openInviteDialog(status: HTMLElement, refresh: () => Promise<void>): void {
  const dlg = el('dialog', { 'aria-label': 'Invite teammate' }) as HTMLDialogElement;
  const name = el('input', { type: 'text', id: 'inv-name' });
  const email = el('input', { type: 'text', id: 'inv-email' });
  const role = el('select', { id: 'inv-role' });
  for (const r of ['admin', 'developer', 'reviewer', 'approver', 'billing']) role.append(el('option', { value: r }, r.charAt(0).toUpperCase() + r.slice(1)));
  const form = el('form');
  const projectsWrap = el('div', { class: 'field' });
  void getJson<{ projects: ProjectSummary[] }>('/api/projects').then((data) => {
    for (const p of data.projects) {
      const cb = el('input', { type: 'checkbox', value: p.id, id: `inv-p-${p.id}` });
      const lbl = el('label', { class: 'checkbox', for: `inv-p-${p.id}` });
      lbl.append(cb, document.createTextNode(` ${p.name}`));
      projectsWrap.append(lbl);
    }
  });
  const create = el('button', { type: 'submit', class: 'accent' }, 'Create invitation');
  const linkWrap = el('div', { class: 'field', hidden: 'true' });
  const link = el('input', { type: 'text', readonly: 'true', id: 'inv-link', 'aria-label': 'Invitation link' });
  linkWrap.append(el('label', { for: 'inv-link' }, 'Invitation link'), link);
  const nf = el('div', { class: 'field' });
  nf.append(el('label', { for: 'inv-name' }, 'Name'), name);
  const ef = el('div', { class: 'field' });
  ef.append(el('label', { for: 'inv-email' }, 'Email'), email);
  const rf = el('div', { class: 'field' });
  rf.append(el('label', { for: 'inv-role' }, 'Role'), role);
  const pf = el('div', { class: 'field' });
  pf.append(el('label', {}, 'Projects'), projectsWrap);
  form.append(nf, ef, rf, pf, create, linkWrap);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    create.disabled = true;
    const projectIds: string[] = [];
    projectsWrap.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked').forEach((cb) => projectIds.push(cb.value));
    try {
      const res = await fetch('/api/org/invitations', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.value, email: email.value, role: role.value, project_ids: projectIds }),
      });
      if (res.status === 201) {
        const data = (await res.json()) as { invite_url: string };
        link.value = `${location.origin}${data.invite_url}`;
        linkWrap.hidden = false;
        setStatus(status, `Invitation created. Share the link below with ${name.value.trim() || 'your teammate'}.`);
        await refresh();
        return;
      }
      const err = (await res.json()) as { fields?: Record<string, string>; error?: string };
      const msg = err.fields?.['name'] ?? err.fields?.['email'] ?? err.fields?.['role'] ?? err.fields?.['project_ids'] ?? 'Something went wrong. Try again.';
      setStatus(status, msg);
    } finally {
      create.disabled = false;
    }
  });
  const body = el('div', { class: 'dialog-body' });
  body.append(el('h2', {}, 'Invite teammate'), form);
  dlg.append(body);
  dlg.addEventListener('cancel', (ev) => { ev.preventDefault(); closeDialog(dlg); });
  document.body.append(dlg);
  dlg.showModal();
  name.focus();
}

// ---------------- Plan ----------------

export async function renderPlan(): Promise<void> {
  await renderConsoleShell(async () => {
    const section = el('section', { 'aria-label': 'Plan' });
    section.append(el('h1', {}, 'Plan'));
    const status = statusRegion('Plan status');
    status.id = 'plan-status';
    const current = el('div', { role: 'region', 'aria-label': 'Current plan' });
    const load = async () => {
      const data = await getJson<{ plan: PlanId; billing_reachable: boolean; change: { state: string; target: string } | null }>('/api/org/plan');
      current.textContent = '';
      const line = el('p');
      line.append(el('span', { class: 'num' }, data.plan), el('span', { class: 'badge active' }, 'Active'));
      current.append(el('h2', {}, 'Current plan'), line);
      if (data.change && data.change.state === 'requested') {
        current.append(el('p', {}, `Waiting for billing to confirm the ${data.change.target} plan.`));
      }
      let button: HTMLButtonElement | null = null;
      if (data.plan === 'pilot') button = el('button', { type: 'button', class: 'accent' }, 'Switch to Scale');
      else button = el('button', { type: 'button' }, 'Switch to Pilot');
      button.addEventListener('click', () => void switchPlan(data.plan === 'pilot' ? 'scale' : 'pilot', button!, status, load));
      current.append(button);
      return data;
    };
    let idempotencyKey: string | null = null;
    const switchPlan = async (target: PlanId, button: HTMLButtonElement, st: HTMLElement, reload: () => Promise<unknown>) => {
      // The first press makes one Idempotency-Key; every later press reuses it until 202/409.
      if (idempotencyKey === null) idempotencyKey = uuid();
      button.disabled = true;
      try {
        const res = await fetch('/api/org/plan-changes', {
          method: 'POST', credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
          body: JSON.stringify({ plan: target }),
        });
        if (res.status === 202 || res.status === 409) idempotencyKey = null;
        if (res.status === 202) {
          setStatus(st, `Waiting for billing to confirm the ${target} plan.`);
          setTimeout(load, 3000);
        } else if (res.status === 503) {
          setStatus(st, 'Billing is unreachable, so your plan hasn\u2019t changed. Try again in a minute.');
        } else if (res.status === 409) {
          const err = (await res.json()) as { error?: string };
          if (err.error === 'plan_unchanged') setStatus(st, '');
          else setStatus(st, 'A plan change is already waiting for billing.');
        } else {
          setStatus(st, 'Something went wrong. Try again.');
        }
      } catch {
        setStatus(st, 'Something went wrong. Try again.');
      } finally {
        button.disabled = false;
      }
    };
    const initial = await load();
    if (!initial.billing_reachable) window.dispatchEvent(new CustomEvent('lowfield:billing-outage'));
    section.append(current, status);
    return section;
  }, { navRoute: 'plan' });
}

export { SEARCH_RESULTS };
