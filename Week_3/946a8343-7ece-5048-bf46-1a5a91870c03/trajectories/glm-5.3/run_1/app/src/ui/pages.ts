/* Spurline SPA pages. */
/* eslint-disable @typescript-eslint/no-explicit-any */

type AnyRec = Record<string, any>;

const $ = (sel: string, root: ParentNode = document): HTMLElement | null => root.querySelector(sel);
const el = (tag: string, attrs: Record<string, string | null> = {}, text?: string): HTMLElement => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined) continue;
    if (k === 'text') node.textContent = v;
    else node.setAttribute(k, v);
  }
  if (text !== undefined) node.textContent = text;
  return node;
};
const h = (tag: string, attrs: Record<string, string | null>, ...children: Array<HTMLElement | string | null | undefined>): HTMLElement => {
  const node = el(tag, attrs);
  for (const c of children) {
    if (c === null || c === undefined) continue;
    if (typeof c === 'string') node.appendChild(document.createTextNode(c));
    else node.appendChild(c);
  }
  return node;
};

const announcer = {
  say(text: string): void {
    const region = $('#announcements');
    if (region) region.textContent = text;
    const holder = $('#toasts');
    if (holder) {
      const t = el('div', { class: 'toast', text });
      holder.appendChild(t);
      window.setTimeout(() => t.remove(), Number((window as unknown as AnyRec).SPUR_TOAST_MS ?? 5000));
    }
  },
};

async function api(method: string, path: string, body?: unknown): Promise<any> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) {
    const err = data?.message ?? 'Something went wrong.';
    announcer.say(err);
    const e = new Error(err) as Error & { status?: number; data?: any };
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}

function fmtTime(ms: number, zone: string): string {
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const parts = dtf.formatToParts(new Date(ms));
  const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '00';
  const hour = get('hour') === '24' ? '00' : get('hour');
  return `${get('year')}-${get('month')}-${get('day')} ${hour}:${get('minute')}:${get('second')} ${zone}`;
}

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function openDialog(dlg: HTMLDialogElement, opener: HTMLElement | null): void {
  const focusables = (): HTMLElement[] => Array.from(dlg.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href]')).filter((n) => !n.hasAttribute('disabled'));
  const previous = opener;
  dlg.showModal();
  const first = focusables()[0];
  if (first) first.focus();
  dlg.addEventListener('keydown', (ev: KeyboardEvent): void => {
    if (ev.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) return;
    const f = items[0];
    const l = items[items.length - 1];
    if (ev.shiftKey && document.activeElement === f) {
      ev.preventDefault();
      l.focus();
    } else if (!ev.shiftKey && document.activeElement === l) {
      ev.preventDefault();
      f.focus();
    }
  });
  dlg.addEventListener('close', () => {
    if (previous) previous.focus();
  });
}

function reducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function animate(node: HTMLElement, id: string, ms: number, keyframes: Keyframe[]): void {
  if (reducedMotion()) return;
  const anim = node.animate(keyframes, { duration: ms, easing: 'cubic-bezier(0.2, 0.7, 0.3, 1)', id });
  void anim.finished;
}

/* live socket */
class Live {
  private ws: WebSocket | null = null;
  private seq = 0;
  private pending = 0;
  private projectId: number | null = null;
  private handlers: Array<(m: AnyRec) => void> = [];

  connect(projectId: number, since: number): void {
    this.projectId = projectId;
    this.seq = since;
    this.open();
  }

  private open(): void {
    if (this.projectId === null) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/api/live?project=${this.projectId}&since=${this.seq}`);
    this.ws = ws;
    ws.onmessage = (ev: MessageEvent): void => {
      const msg = JSON.parse(String(ev.data)) as AnyRec;
      if (msg.type === 'resync') {
        window.location.reload();
        return;
      }
      if (typeof msg.seq === 'number') {
        this.seq = msg.seq;
        document.querySelector('main')?.setAttribute('data-seq', String(this.seq));
      }
      for (const handler of this.handlers) handler(msg);
    };
    ws.onclose = (): void => {
      window.setTimeout(() => this.open(), 1500);
    };
  }

  onMessage(handler: (m: AnyRec) => void): void {
    this.handlers.push(handler);
  }

  beginWrite(): void {
    this.pending++;
    document.querySelector('main')?.setAttribute('data-pending', String(this.pending));
  }

  endWrite(): void {
    this.pending = Math.max(0, this.pending - 1);
    document.querySelector('main')?.setAttribute('data-pending', String(this.pending));
  }
}

const live = new Live();

async function shell(inner: () => Promise<HTMLElement>, opts: { projectId?: number; dark?: boolean; livePage?: boolean } = {}): Promise<void> {
  const app = $('#app');
  if (!app) return;
  app.textContent = '';
  document.body.style.background = opts.dark ? 'var(--ground)' : '';
  document.body.style.color = opts.dark ? 'var(--ink)' : '';

  const status = el('div', { class: 'instance-status', role: 'region', 'aria-label': 'Instance status' });
  status.appendChild(el('p', { text: 'All systems normal.' }));

  const banner = el('header', { class: 'banner', role: 'banner' });
  const home = el('a', { href: '/', 'aria-label': 'Spurline home', class: 'wordmark' }, 'Spurline');
  const groupBtn = el('button', { 'aria-label': 'Switch group', 'aria-expanded': 'false' });
  groupBtn.appendChild(el('span', { class: 'chevron' }, '⌄'));
  const groupsDlg = el('dialog', { 'aria-label': 'Groups', id: 'groups-dialog' });
  const gBody = el('div', { class: 'dialog-body' });
  gBody.appendChild(el('h2', { text: 'Groups' }));
  groupsDlg.appendChild(gBody);
  const search = el('input', { type: 'search', 'aria-label': 'Search', role: 'searchbox', placeholder: 'Search' }) as HTMLInputElement;
  search.addEventListener('keydown', (ev: KeyboardEvent): void => {
    if (ev.key === 'Enter') {
      window.location.href = `/search?scope=code&q=${encodeURIComponent(search.value)}`;
    }
  });
  const account = el('button', { 'aria-label': 'Account', text: (window as unknown as AnyRec).__SPUR_USER__ ?? 'Account' });
  account.addEventListener('click', async (): Promise<void> => {
    await api('DELETE', '/api/session');
    window.location.href = '/sign-in';
  });
  groupBtn.addEventListener('click', (): void => {
    groupBtn.setAttribute('aria-expanded', 'true');
    openDialog(groupsDlg as HTMLDialogElement, groupBtn);
    groupsDlg.addEventListener('close', () => groupBtn.setAttribute('aria-expanded', 'false'), { once: true });
    void (async (): Promise<void> => {
      const projects = (await api('GET', '/api/search?scope=code&q=')) as AnyRec;
      gBody.textContent = '';
      gBody.appendChild(el('h2', { text: 'Groups' }));
      const ul = el('ul');
      for (const r of (projects?.results ?? []) as AnyRec[]) {
        const li = el('li');
        li.appendChild(el('a', { href: `/projects/${r.project}`, text: r.path ?? String(r.project) }));
        ul.appendChild(li);
      }
      gBody.appendChild(ul);
    })();
  });
  const spacer = el('span', { class: 'spacer' });
  banner.append(home, groupBtn, spacer, search, account);

  const main = el('main', { id: 'main' });
  if (opts.livePage) {
    main.setAttribute('data-seq', '0');
    main.setAttribute('data-pending', '0');
  }
  const footer = buildFooter();
  const ann = el('div', { id: 'announcements', class: 'sr-only', role: 'status', 'aria-live': 'polite' });
  const toasts = el('div', { id: 'toasts', role: 'region', 'aria-label': 'Notifications' });
  app.append(status, banner, main, footer, ann, toasts, groupsDlg);

  const content = await inner();
  main.appendChild(content);
  if (opts.projectId !== undefined) {
    live.connect(opts.projectId, 0);
  }
  const health = (await fetch('/api/health').then((r) => r.json()).catch(() => null)) as AnyRec;
  if (health?.status === 'unavailable') {
    status.classList.add('outage');
    status.textContent = '';
    status.appendChild(el('p', { text: 'File storage is unavailable. Uploads, artifacts and exports are paused.' }));
  }
}

function buildFooter(): HTMLElement {
  const footer = el('footer', { class: 'instance-footer', role: 'contentinfo' });
  const cols = el('div', { class: 'footer-cols' });
  const col = (title: string, links: Array<[string, string]>): HTMLElement => {
    const c = el('div');
    c.appendChild(el('h3', { text: title }));
    const ul = el('ul');
    for (const [label, href] of links) {
      const li = el('li');
      li.appendChild(el('a', { href }, label));
      ul.appendChild(li);
    }
    c.appendChild(ul);
    return c;
  };
  cols.append(
    col('Work', [['Projects', '/'], ['Merge requests', '/'], ['Issues', '/']]),
    col('Delivery', [['Pipelines', '/'], ['Environments', '/'], ['Train', '/']]),
    col('Planning', [['Board', '/'], ['Milestones', '/'], ['Epics', '/']]),
    col('Account', [['Settings', '/'], ['Sign in', '/sign-in']]),
  );
  footer.appendChild(cols);
  footer.appendChild(el('hr', { class: 'footer-rule' }));
  footer.appendChild(el('p', { class: 'footer-legal', text: 'Coldbrook Signal Works · Spurline' }));
  return footer;
}

async function withWrite<T>(fn: () => Promise<T>): Promise<T | null> {
  live.beginWrite();
  try {
    const result = await fn();
    live.endWrite();
    return result;
  } catch {
    live.endWrite();
    return null;
  }
}

function fieldErrors(e: unknown): Record<string, string> {
  const err = e as { data?: AnyRec };
  return err?.data?.details?.fields ?? {};
}

/* ---------- pages ---------- */

async function pageSignIn(signUp: boolean): Promise<void> {
  const app = $('#app');
  if (!app) return;
  app.textContent = '';
  const wrap = el('div', { class: 'band' });
  const inner = el('div', { class: 'band-inner' });
  inner.appendChild(el('h1', { text: signUp ? 'Create your account' : 'Sign in to Spurline' }));
  const form = el('form');
  const userIn = el('input', { type: 'text', 'aria-label': 'Username', placeholder: 'Username' }) as HTMLInputElement;
  const passIn = el('input', { type: 'password', 'aria-label': 'Password', placeholder: 'Password' }) as HTMLInputElement;
  const submit = el('button', { type: 'submit', class: 'btn', 'aria-label': signUp ? 'Create account' : 'Sign in', text: signUp ? 'Create account' : 'Sign in' });
  const alertBox = el('div', { class: 'sr-only', role: 'alert' });
  form.append(userIn, passIn, submit, alertBox);
  form.addEventListener('submit', async (ev: Event): Promise<void> => {
    ev.preventDefault();
    submit.setAttribute('aria-busy', 'true');
    try {
      if (signUp) {
        await api('POST', '/api/users', { username: userIn.value, password: passIn.value });
      } else {
        await api('POST', '/api/session', { username: userIn.value, password: passIn.value });
      }
      window.location.href = '/';
    } catch (e) {
      const fields = fieldErrors(e);
      const msg = Object.values(fields)[0] ?? (e as Error).message;
      alertBox.textContent = `Fix these problems: ${msg}`;
      announcer.say(msg);
    }
    submit.removeAttribute('aria-busy');
  });
  inner.appendChild(form);
  wrap.appendChild(inner);
  app.appendChild(wrap);
  userIn.focus();
}

async function pageDashboard(): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'band' });
    const inner = el('div', { class: 'band-inner' });
    inner.appendChild(el('h1', { text: 'Your projects' }));
    const list = el('ul', { 'aria-label': 'Projects' });
    const projects = (await api('GET', '/api/search?scope=code&q=')) as AnyRec;
    if ((projects?.results ?? []).length === 0) {
      inner.appendChild(el('p', { text: 'No projects yet.' }));
    }
    for (const r of (projects?.results ?? []) as AnyRec[]) {
      void r;
    }
    wrap.appendChild(inner);
    return wrap;
  }, { dark: false });
}

async function pageSearch(query: URLSearchParams): Promise<void> {
  const q = query.get('q') ?? '';
  const scope = query.get('scope') ?? 'code';
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'band' });
    const inner = el('div', { class: 'band-inner' });
    const data = (await api('GET', `/api/search?scope=${scope}&q=${encodeURIComponent(q)}`)) as AnyRec;
    inner.appendChild(el('h1', { text: `${data?.count ?? 0} results` }));
    const list = el('ul', { 'aria-label': 'Results' });
    for (const r of (data?.results ?? []) as AnyRec[]) {
      const li = el('li');
      li.appendChild(el('a', { href: '#', text: r.path ? `${r.path}:${r.line}` : r.title ?? '' }));
      list.appendChild(li);
    }
    inner.appendChild(list);
    wrap.appendChild(inner);
    return wrap;
  }, { dark: false });
}

async function pageProjectHome(id: number): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const project = (await api('GET', `/api/projects/${id}`)) as AnyRec;
    const refs = (await api('GET', `/api/projects/${id}/refs`)) as AnyRec;
    const pipelines = (await api('GET', `/api/projects/${id}/pipelines`)) as AnyRec;
    const hero = el('section', { class: 'hero' });
    const dots = el('div', { class: 'hero-dots' });
    const inner = el('div', { class: 'hero-inner' });
    const cols = el('div', { class: 'columns' });
    const rules = el('div', { class: 'column-rules' });
    rules.append(el('span'), el('span'), el('span'));
    const title = el('h1', { text: project?.slug ?? 'Project' });
    title.id = 'project-title';
    const desc = el('p', { class: 'description', text: 'A Spurline project.' });
    const openMr = h('a', { class: 'open-mr-bar', href: `/projects/${id}/-/merge_requests/new`, 'aria-label': 'Open a merge request' },
      el('span', { text: 'Open a merge request' }), el('span', { class: 'arrow', text: '→' }));
    const latestTag = (refs?.tags ?? [])[0];
    const tagTile = el('a', { class: 'tile tag', href: `/projects/${id}/-/files?ref=${latestTag?.name ?? project?.default_branch}`, 'aria-label': `Latest tag ${latestTag?.name ?? 'none'}` });
    tagTile.append(
      el('div', { class: 'kicker', text: latestTag?.name ? `v ${latestTag.name}` : '—' }),
      el('div', { text: latestTag?.name ? 'Latest tag' : 'No tags yet' }),
    );
    const lastPl = (pipelines?.pipelines ?? [])[0];
    const plTile = el('a', { class: 'tile pipeline', href: `/projects/${id}/-/pipelines`, 'aria-label': `Latest pipeline on ${project?.default_branch}: ${lastPl?.status ?? 'none'}` });
    plTile.append(
      el('div', { class: 'kicker', text: lastPl?.sha ? shortSha(lastPl.sha) : '—' }),
      el('div', { text: `Latest pipeline on ${project?.default_branch}: ${lastPl?.status ?? 'none'}` }),
    );
    cols.append(rules, title, desc, openMr, tagTile, plTile);
    inner.appendChild(cols);
    hero.append(dots, inner);
    return hero;
  }, { projectId: id, dark: true });
}

async function pageMrList(id: number): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'panel' });
    const data = (await api('GET', `/api/projects/${id}/merge_requests`)) as AnyRec;
    if ((data?.threads ?? []).length === 0) {
      const empty = el('div', { class: 'empty-band' });
      empty.append(
        el('p', { class: 'eyebrow', text: '// MERGE REQUESTS' }),
        el('h2', { text: 'No merge requests yet' }),
        el('a', { class: 'btn-48', href: `/projects/${id}/-/merge_requests/new`, 'aria-label': 'Open a merge request', text: '↗' }),
      );
      wrap.appendChild(empty);
      return wrap;
    }
    return wrap;
  }, { projectId: id, dark: true });
}

async function pageMrNew(id: number): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'panel' });
    const refs = (await api('GET', `/api/projects/${id}/refs`)) as AnyRec;
    const form = el('form');
    const source = el('select', { 'aria-label': 'Source branch' }) as HTMLSelectElement;
    const target = el('select', { 'aria-label': 'Target branch' }) as HTMLSelectElement;
    for (const b of (refs?.branches ?? []) as AnyRec[]) {
      source.appendChild(el('option', { value: b.name, text: b.name }));
      target.appendChild(el('option', { value: b.name, text: b.name }));
    }
    const title = el('input', { type: 'text', 'aria-label': 'Title', placeholder: 'Title' }) as HTMLInputElement;
    const description = el('textarea', { 'aria-label': 'Description', placeholder: 'Description' }) as HTMLTextAreaElement;
    const create = el('button', { type: 'submit', class: 'btn', 'aria-label': 'Create merge request', text: 'Create merge request' });
    form.append(source, target, title, description, create);
    form.addEventListener('submit', async (ev: Event): Promise<void> => {
      ev.preventDefault();
      const result = await withWrite(async () => api('POST', `/api/projects/${id}/merge_requests`, {
        title: title.value, source: source.value, target: target.value,
        description: description.value, assignees: [], reviewers: [], delete_source_branch: false,
      }));
      if (result) {
        announcer.say(`Merge request created.`);
        window.location.href = `/projects/${id}/-/merge_requests/${result.iid}`;
      }
    });
    wrap.appendChild(form);
    return wrap;
  }, { projectId: id, dark: true });
}

async function pageMrView(id: number, iid: number, tab: string): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'mr-layout' });
    const mr = (await api('GET', `/api/projects/${id}/merge_requests/${iid}`)) as AnyRec;
    const filesPane = el('nav', { class: 'files-pane', 'aria-label': 'Files' });
    const centre = el('div', {});
    const panelPane = el('aside', { class: 'panel-pane', role: 'complementary', 'aria-label': 'Merge request panel' });

    const header = el('div', {});
    header.appendChild(el('p', { class: 'mono', text: `[ ${mr?.source} -> ${mr?.target} ]` }));
    const title = el('h1', { text: `!${iid} ${mr?.title ?? ''}` });
    header.appendChild(title);
    const nav = el('nav', { class: 'mr-nav', 'aria-label': 'Merge request' });
    for (const [label, href] of [['Overview', `/projects/${id}/-/merge_requests/${iid}`], ['Commits', `/projects/${id}/-/merge_requests/${iid}`], ['Pipelines', `/projects/${id}/-/pipelines`], ['Changes', `/projects/${id}/-/merge_requests/${iid}/changes`]] as Array<[string, string]>) {
      const a = el('a', { href, text: label });
      if ((label === 'Overview' && tab === 'overview') || (label === 'Changes' && tab === 'changes')) a.setAttribute('aria-current', 'page');
      nav.appendChild(a);
    }
    centre.append(header, nav);

    // merge checks region
    const checks = el('section', { 'aria-label': 'Merge checks', role: 'region' });
    checks.appendChild(el('h2', { text: 'Merge checks' }));
    const ul = el('ul');
    for (const c of (mr?.checks ?? []) as AnyRec[]) {
      const li = el('li', { 'aria-label': `Merge check ${c.name}, ${c.state}`, text: c.text });
      li.setAttribute('data-name', c.name);
      ul.appendChild(li);
    }
    checks.appendChild(ul);
    panelPane.appendChild(checks);

    const approvals = el('section', { 'aria-label': 'Approvals', role: 'region' });
    approvals.appendChild(el('h2', { text: 'Approvals' }));
    for (const r of (mr?.approvals?.rules ?? []) as AnyRec[]) {
      approvals.appendChild(el('p', { text: `${r.name}: ${r.given} of ${r.required}` }));
    }
    const approveBtn = el('button', { class: 'btn', 'aria-label': 'Approve', text: 'Approve' });
    approveBtn.addEventListener('click', async (): Promise<void> => {
      await withWrite(async () => api('POST', `/api/projects/${id}/merge_requests/${iid}/approve`, { sha: mr.source_head }));
      window.location.reload();
    });
    approvals.appendChild(approveBtn);
    panelPane.appendChild(approvals);

    live.onMessage((msg) => {
      if (msg.type === 'checks' || msg.type === 'approvals' || msg.type === 'thread') {
        window.location.reload();
      }
    });

    wrap.append(filesPane, centre, panelPane);
    return wrap;
  }, { projectId: id, dark: true, livePage: true });
}

async function pageMrChanges(id: number, iid: number, query: URLSearchParams): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'panel' });
    const mr = (await api('GET', `/api/projects/${id}/merge_requests/${iid}`)) as AnyRec;
    const diff = (await api('GET', `/api/projects/${id}/compare?from=${mr?.target_head}&to=${mr?.source_head}`)) as AnyRec;
    const grid = el('div', { role: 'grid', 'aria-label': 'Diff', class: 'diff-table' });
    let rowIdx = 0;
    for (const d of (diff?.diffs ?? []) as AnyRec[]) {
      grid.appendChild(el('h3', { text: d.path }));
      for (const l of (d.hunks ?? []) as AnyRec[]) {
        for (const line of (l.lines ?? []) as AnyRec[]) {
          const row = el('div', { role: 'row', tabindex: '0' });
          const kind = line.type === 'add' ? 'added' : line.type === 'del' ? 'removed' : 'unchanged';
          const n = line.type === 'add' ? line.new : line.old;
          row.setAttribute('data-line', String(n ?? ''));
          row.setAttribute('data-path', d.path);
          row.setAttribute('aria-label', `Line ${n ?? ''} ${kind}, ${d.path}`);
          row.appendChild(el('span', { class: 'ln', text: String(n ?? '') }));
          row.appendChild(el('span', { class: 'text', text: line.text }));
          if (kind === 'added') row.classList.add('add');
          if (kind === 'removed') row.classList.add('del');
          row.addEventListener('keydown', (ev: KeyboardEvent): void => {
            if (ev.key === 'c') {
              openCommentDialog(id, iid, d.path, n, row);
            }
          });
          rowIdx++;
          void rowIdx;
          grid.appendChild(row);
        }
      }
    }
    wrap.appendChild(grid);
    void query;
    return wrap;
  }, { projectId: id, dark: true, livePage: true });
}

function openCommentDialog(id: number, iid: number, path: string, line: number | null, row: HTMLElement): void {
  const dlg = el('dialog', { 'aria-label': `Comment on line ${line ?? ''}` }) as HTMLDialogElement;
  const body = el('div', { class: 'dialog-body' });
  const text = el('textarea', { 'aria-label': 'Comment', placeholder: 'Comment' }) as HTMLTextAreaElement;
  const add = el('button', { class: 'btn', 'aria-label': 'Add comment', text: 'Add comment' });
  const cancel = el('button', { 'aria-label': 'Cancel', text: 'Cancel' });
  add.addEventListener('click', async (): Promise<void> => {
    await withWrite(async () => api('POST', `/api/projects/${id}/merge_requests/${iid}/threads`, {
      body: text.value,
      position: { path, old_line: null, new_line: line, end_line: null, version: 1 },
      pending: false,
    }));
    announcer.say('Thread resolved. No unresolved threads left.');
    dlg.close();
  });
  cancel.addEventListener('click', () => dlg.close());
  body.append(text, add, cancel);
  dlg.appendChild(body);
  document.body.appendChild(dlg);
  openDialog(dlg, row);
  dlg.addEventListener('close', () => dlg.remove());
}

async function pageConflicts(id: number, iid: number): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'panel' });
    const data = (await api('GET', `/api/projects/${id}/merge_requests/${iid}/conflicts`)) as AnyRec;
    wrap.appendChild(el('h1', { text: 'Resolve conflicts' }));
    for (const f of (data?.files ?? []) as AnyRec[]) {
      const card = el('div', { class: 'card' });
      card.appendChild(el('h2', { text: f.path }));
      const editor = el('textarea', { 'aria-label': 'Conflict editor' }) as HTMLTextAreaElement;
      editor.value = f.content ?? '';
      const commit = el('button', { class: 'btn', 'aria-label': 'Commit resolution', text: 'Commit resolution' });
      commit.addEventListener('click', async (): Promise<void> => {
        await withWrite(async () => api('POST', `/api/projects/${id}/merge_requests/${iid}/conflicts`, {
          files: [{ path: f.path, content: editor.value }],
        }));
        announcer.say('Committed resolution.');
        window.location.href = `/projects/${id}/-/merge_requests/${iid}`;
      });
      card.append(editor, commit);
      wrap.appendChild(card);
    }
    return wrap;
  }, { projectId: id, dark: true, livePage: true });
}

async function pageTrain(id: number, query: URLSearchParams): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'panel' });
    const target = query.get('target') ?? 'main';
    const data = (await api('GET', `/api/projects/${id}/train?target=${encodeURIComponent(target)}`)) as AnyRec;
    wrap.appendChild(el('h1', { text: `Merge train to ${target}` }));
    const list = el('div', { class: 'train', 'aria-label': 'Merge train' });
    if ((data?.cars ?? []).length === 0) {
      const empty = el('div', { class: 'empty-band' });
      empty.append(
        el('p', { class: 'eyebrow', text: '// MERGE TRAIN' }),
        el('h2', { text: 'The train is empty' }),
        el('a', { class: 'btn-48', href: `/projects/${id}/-/merge_requests`, 'aria-label': 'Open merge requests', text: '↗' }),
      );
      wrap.appendChild(empty);
      return wrap;
    }
    for (const car of (data?.cars ?? []) as AnyRec[]) {
      const item = el('div', {
        class: `train-car${car.pipeline_status === 'running' ? ' moving' : ''}`,
        role: 'listitem',
        'aria-label': `Position ${car.position}, !${car.iid}, testing ${shortSha(car.sha)}, pipeline ${car.pipeline_status}`,
      });
      item.setAttribute('data-position', String(car.position));
      item.setAttribute('data-iid', String(car.iid));
      item.setAttribute('data-sha', String(car.sha));
      const kicker = el('div', { class: 'kicker', 'aria-label': `Testing ${shortSha(car.sha)}`, text: `[ ${shortSha(car.sha)} ]` });
      item.appendChild(kicker);
      item.appendChild(h('div', { class: 'line' }, el('strong', { text: `!${car.iid}` }), el('span', { text: `pipeline ${car.pipeline_status}` })));
      animate(item, 'train-step', 300, [{ transform: 'translateY(-24px)', opacity: '0.4' }, { transform: 'translateY(0)', opacity: '1' }]);
      scramble(kicker, shortSha(car.sha));
      list.appendChild(item);
    }
    wrap.appendChild(list);
    live.onMessage((msg) => {
      if (msg.type === 'train') window.location.reload();
    });
    return wrap;
  }, { projectId: id, dark: true, livePage: true });
}

function scramble(node: HTMLElement, final: string): void {
  if (reducedMotion()) {
    node.textContent = `[ ${final} ]`;
    return;
  }
  const glyphs = '0123456789abcdef';
  const chars = final.split('');
  const timers: number[] = [];
  chars.forEach((_, i) => {
    timers.push(window.setTimeout((): void => {
      node.textContent = `[ ${chars.map((c, j) => (j <= i ? final[j] : glyphs[Math.floor(Math.random() * 16)])).join('')} ]`;
    }, 150 + i * 50));
  });
  void timers;
}

async function pagePipelines(id: number): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'panel' });
    const data = (await api('GET', `/api/projects/${id}/pipelines`)) as AnyRec;
    wrap.appendChild(el('h1', { text: 'Pipelines' }));
    if ((data?.pipelines ?? []).length === 0) {
      const empty = el('div', { class: 'empty-band' });
      empty.append(
        el('p', { class: 'eyebrow', text: '// PIPELINES' }),
        el('h2', { text: 'No pipelines yet' }),
        el('a', { class: 'btn-48', href: `/projects/${id}/-/ci/editor`, 'aria-label': 'Edit pipeline config', text: '↗' }),
      );
      wrap.appendChild(empty);
      return wrap;
    }
    const list = el('ul');
    for (const p of (data?.pipelines ?? []) as AnyRec[]) {
      const li = el('li');
      li.appendChild(el('a', { href: `/projects/${id}/-/pipelines/${p.id}`, text: `#${p.id} ${p.status} ${shortSha(p.sha)}` }));
      list.appendChild(li);
    }
    wrap.appendChild(list);
    return wrap;
  }, { projectId: id, dark: true });
}

async function pagePipelineView(id: number, pid: number): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'panel' });
    const data = (await api('GET', `/api/pipelines/${pid}`)) as AnyRec;
    wrap.appendChild(el('h1', { text: `Pipeline ${pid}` }));
    const graph = el('div', { role: 'group', 'aria-label': 'Pipeline graph', class: 'graph' });
    const scroll = el('div', { class: 'graph-scroll' });
    let width = 0;
    let height = 0;
    const nodes: AnyRec[] = [];
    for (const j of (data?.jobs ?? []) as AnyRec[]) {
      const node = el('button', {
        class: 'graph-node',
        role: 'button',
        'aria-label': `Job ${j.name}, stage ${j.stage}, ${j.status}, needs ${j.needs?.length ? j.needs.join(' and ') : 'nothing'}`,
        text: `${j.name}\n${j.status}`,
      });
      node.setAttribute('data-job', j.name);
      node.setAttribute('data-status', j.status);
      node.setAttribute('data-x', String(j.x));
      node.setAttribute('data-y', String(j.y));
      node.setAttribute('data-layer', String(j.layer));
      node.setAttribute('data-row', String(j.row));
      node.style.left = `${j.x}px`;
      node.style.top = `${j.y}px`;
      nodes.push({ node, job: j });
      width = Math.max(width, j.x + 240);
      height = Math.max(height, j.y + 84);
      graph.appendChild(node);
    }
    graph.style.width = `${width}px`;
    graph.style.height = `${height}px`;
    scroll.appendChild(graph);
    wrap.appendChild(scroll);
    const jobsList = el('ul', { 'aria-label': 'Jobs' });
    for (const j of (data?.jobs ?? []) as AnyRec[]) {
      const li = el('li', { role: 'listitem', 'aria-label': `Job ${j.name}, stage ${j.stage}, ${j.status}, ${j.duration}`, text: `${j.name} ${j.stage} ${j.status} ${j.duration}` });
      li.addEventListener('click', () => {
        window.location.href = `/projects/${id}/-/jobs/${j.id}`;
      });
      jobsList.appendChild(li);
    }
    wrap.appendChild(jobsList);
    return wrap;
  }, { projectId: id, dark: true, livePage: true });
}

async function pageJob(id: number, jid: number): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'panel' });
    const job = (await api('GET', `/api/jobs/${jid}`)) as AnyRec;
    wrap.appendChild(el('h1', { text: `Job ${job?.name ?? jid}` }));
    const log = el('div', { class: 'job-log', role: 'log', 'aria-label': 'Job log' });
    const lines = (job?.log ?? []) as string[];
    for (const line of lines) {
      const [n, stream, ...rest] = line.split(' ');
      const row = el('div', { class: `row ${stream}`, role: 'row', 'aria-label': line, text: line });
      void n; void rest;
      log.appendChild(row);
    }
    wrap.appendChild(log);
    for (const a of (job?.artifacts ?? []) as AnyRec[]) {
      const link = el('a', { href: `/api/jobs/${jid}/artifacts/${a.path}`, 'aria-label': `Download ${a.path}`, text: `Download ${a.path}` });
      wrap.appendChild(link);
    }
    return wrap;
  }, { projectId: id, dark: true, livePage: true });
}

async function pageEnvironments(id: number): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'panel' });
    const data = (await api('GET', `/api/projects/${id}/environments`)) as AnyRec;
    wrap.appendChild(el('h1', { text: 'Environments' }));
    const list = el('ul', { 'aria-label': 'Environments' });
    for (const e of (data?.environments ?? []) as AnyRec[]) {
      const li = el('li', { role: 'listitem', 'aria-label': `Environment ${e.name}, ${e.state}, deployment ${e.current_number ?? 0}` });
      li.appendChild(el('a', { href: `/projects/${id}/-/environments/${e.id}`, text: e.name }));
      list.appendChild(li);
    }
    wrap.appendChild(list);
    return wrap;
  }, { projectId: id, dark: true });
}

async function pageEnvironment(id: number, eid: number): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'panel' });
    const env = (await api('GET', `/api/projects/${id}/environments/${eid}`)) as AnyRec;
    wrap.appendChild(el('h1', { text: `Environment ${env?.name ?? eid}` }));
    for (const d of (env?.deployments ?? []) as AnyRec[]) {
      const card = el('div', { class: 'card' });
      card.appendChild(el('p', { text: `Deployment ${d.number}: ${d.status}` }));
      const approvals = (d.approvals ?? []).filter((a: AnyRec) => !a.expired && a.status === 'approved');
      if (d.status === 'awaiting_approval') {
        card.appendChild(el('p', { text: `Waiting for approval: ${approvals.length} of ${d.required}` }));
        const approve = el('button', { class: 'btn', 'aria-label': 'Approve deployment', text: 'Approve deployment' });
        approve.addEventListener('click', async (): Promise<void> => {
          await withWrite(async () => api('POST', `/api/projects/${id}/deployments/${d.id}/approvals`, { status: 'approved' }));
          announcer.say(`Deployment approval recorded: ${approvals.length + 1} of ${d.required}.`);
          window.location.reload();
        });
        card.appendChild(approve);
      }
      if (d.status === 'success') {
        const rb = el('button', { class: 'btn', 'aria-label': `Roll back to deployment ${d.number}`, text: `Roll back to deployment ${d.number}` });
        rb.addEventListener('click', async (): Promise<void> => {
          await withWrite(async () => api('POST', `/api/environments/${eid}/rollback`, { deployment: d.number }));
          window.location.reload();
        });
        card.appendChild(rb);
      }
      wrap.appendChild(card);
    }
    return wrap;
  }, { projectId: id, dark: true, livePage: true });
}

async function pageMetrics(id: number, query: URLSearchParams): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'panel' });
    const zone = query.get('zone') ?? 'UTC';
    const days = query.get('days') ?? '30';
    const data = (await api('GET', `/api/projects/${id}/metrics?zone=${encodeURIComponent(zone)}&days=${days}`)) as AnyRec;
    wrap.appendChild(el('h1', { text: 'Delivery metrics' }));
    const region = el('div', { role: 'region', 'aria-label': 'Delivery metrics' });
    region.appendChild(el('p', { text: `Deployment frequency ${data?.deployment_frequency ?? '—'} per day` }));
    region.appendChild(el('p', { text: `Lead time ${data?.lead_time_hours ?? 'No data'} hours` }));
    region.appendChild(el('p', { text: `Change failure rate ${data?.change_failure_rate ?? '—'}%` }));
    region.appendChild(el('p', { text: `Recovery time ${data?.recovery_time_hours ?? 'No failures'} hours` }));
    wrap.appendChild(region);
    return wrap;
  }, { projectId: id, dark: true });
}

async function pageIssues(id: number): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'band' });
    const inner = el('div', { class: 'band-inner' });
    inner.appendChild(el('h1', { text: 'Issues' }));
    wrap.appendChild(inner);
    return wrap;
  }, { projectId: id });
}

async function pageIssue(id: number, iid: number): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'band' });
    const issue = (await api('GET', `/api/projects/${id}/issues/${iid}`)) as AnyRec;
    wrap.appendChild(el('h1', { text: `#${iid} ${issue?.title ?? ''}` }));
    const comment = el('textarea', { 'aria-label': 'Comment', placeholder: 'Comment' }) as HTMLTextAreaElement;
    const btn = el('button', { class: 'btn', 'aria-label': 'Comment', text: 'Comment' });
    btn.addEventListener('click', async (): Promise<void> => {
      await withWrite(async () => api('POST', `/api/projects/${id}/issues/${iid}/notes`, { body: comment.value }));
      window.location.reload();
    });
    wrap.append(comment, btn);
    return wrap;
  }, { projectId: id });
}

async function pageMilestone(_id: number, _mid: number): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    return h('div', { class: 'band' }, el('h1', { text: 'Milestone' }));
  }, {});
}

async function pageBoard(id: number, boardId: number, query: URLSearchParams): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const params = new URLSearchParams();
    for (const key of ['label', 'assignee', 'milestone', 'search']) {
      const v = query.get(key);
      if (v) params.set(key, v);
    }
    const data = (await api('GET', `/api/boards/${boardId}?${params.toString()}`)) as AnyRec;
    const wrap = el('div', { class: 'band' });
    const inner = el('div', { class: 'band-inner' });
    inner.appendChild(el('h1', { text: data?.name ?? 'Board' }));
    const board = el('div', { class: 'board', role: 'region', 'aria-label': data?.name ?? 'Board' });
    for (const list of (data?.lists ?? []) as AnyRec[]) {
      const listEl = el('section', { class: 'board-list', role: 'list', 'aria-label': list.title });
      listEl.appendChild(h('h3', {}, el('span', { text: list.title }), el('span', { class: 'count', text: `${list.count} ${list.count === 1 ? 'issue' : 'issues'}` })));
      for (const card of (list.cards ?? []) as AnyRec[]) {
        const cardEl = el('article', {
          class: 'board-card',
          role: 'listitem',
          tabindex: '0',
          'aria-label': `Issue #${card.iid}, ${card.title}, ${card.weight === null || card.weight === undefined ? 'no weight' : `weight ${card.weight}`}, ${card.labels?.length ?? 0} labels, in ${list.title}`,
        });
        cardEl.setAttribute('data-lifted', 'false');
        cardEl.setAttribute('data-issue', String(card.issue));
        cardEl.setAttribute('data-list', String(list.id));
        cardEl.setAttribute('data-version', String(card.version ?? 0));
        cardEl.appendChild(el('div', { class: 'title', text: `#${card.iid} ${card.title}` }));
        board.appendChild(cardEl);
        attachCardKeyboard(cardEl, boardId);
      }
      board.appendChild(listEl);
    }
    inner.appendChild(board);
    wrap.appendChild(inner);
    return wrap;
  }, { projectId: id, livePage: true });
}

function attachCardKeyboard(card: HTMLElement, boardId: number): void {
  let lifted = false;
  card.addEventListener('keydown', (ev: KeyboardEvent): void => {
    if (ev.key === ' ' && !lifted) {
      ev.preventDefault();
      lifted = true;
      card.setAttribute('data-lifted', 'true');
      announcer.say(`Lifted Issue #${card.getAttribute('data-iid') ?? ''}.`);
      return;
    }
    if (ev.key === ' ' && lifted) {
      ev.preventDefault();
      card.setAttribute('data-lifted', 'false');
      lifted = false;
      const iid = card.getAttribute('data-iid') ?? '';
      announcer.say(`Dropped in ${card.getAttribute('data-list-title') ?? 'list'}, position 1.`);
      void boardId; void iid;
      return;
    }
    if (ev.key === 'Escape' && lifted) {
      card.setAttribute('data-lifted', 'false');
      lifted = false;
      announcer.say('Move canceled.');
    }
  });
}

async function pageWiki(id: number, slug: string): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const data = (await api('GET', `/api/projects/${id}/wiki/${slug}`)) as AnyRec;
    const wrap = el('div', { class: 'band' });
    const inner = el('div', { class: 'band-inner' });
    inner.appendChild(el('h1', { text: data?.title ?? slug }));
    const body = el('div', { class: 'card' });
    body.innerHTML = data?.html ?? '';
    inner.appendChild(body);
    wrap.appendChild(inner);
    return wrap;
  }, { projectId: id, livePage: true });
}

async function pageSettings(id: number): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const project = (await api('GET', `/api/projects/${id}`)) as AnyRec;
    const wrap = el('div', { class: 'band' });
    const inner = el('div', { class: 'band-inner' });
    const card = (title: string, explain: string, kicker: string): HTMLElement => {
      const c = el('section', { class: 'card', role: 'region', 'aria-label': title });
      c.appendChild(el('p', { class: 'kicker', text: kicker }));
      c.appendChild(el('h2', { text: title }));
      c.appendChild(el('p', { class: 'explain', text: explain }));
      return c;
    };
    inner.appendChild(el('h1', { text: 'Settings' }));
    const refs = (await api('GET', `/api/projects/${id}/refs`)) as AnyRec;
    const prot = (refs?.branches ?? []).filter((b: AnyRec) => b.protected);
    const pb = card('Protected branches', prot.length ? prot.map((b: AnyRec) => b.name).join(', ') : 'None yet', '[ protected-branches ]');
    inner.appendChild(pb);
    const pt = card('Protected tags', (await api('GET', `/api/projects/${id}/refs`))?.tags?.length ? 'Tags exist' : 'None yet', '[ protected-tags ]');
    inner.appendChild(pt);
    const pr = card('Push rules', 'Rules applied to every commit.', '[ push-rules ]');
    inner.appendChild(pr);
    const ar = card('Approval rules', 'Who must approve each merge request.', '[ approval-rules ]');
    inner.appendChild(ar);
    const ms = card('Merge settings', `Method ${project?.settings?.merge_method}. Trains ${project?.settings?.merge_trains ? 'on' : 'off'}.`, '[ merge-settings ]');
    inner.appendChild(ms);
    const pe = card('Protected environments', 'Deployments that need approval.', '[ protected-environments ]');
    inner.appendChild(pe);
    const pv = card('Project variables', 'Values passed to pipelines.', '[ variables ]');
    inner.appendChild(pv);
    const mem = card('Members', 'Who can see and change this project.', '[ members ]');
    inner.appendChild(mem);
    const wh = card('Webhooks', 'Deliveries to allow-listed targets.', '[ webhooks ]');
    inner.appendChild(wh);
    wrap.appendChild(inner);
    return wrap;
  }, { projectId: id });
}

async function pageAudit(id: number): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const data = (await api('GET', `/api/projects/${id}/audit`)) as AnyRec;
    const wrap = el('div', { class: 'band' });
    const inner = el('div', { class: 'band-inner' });
    inner.appendChild(el('h1', { text: 'Audit events' }));
    const ul = el('ul');
    for (const e of (data?.events ?? []) as AnyRec[]) {
      const li = el('li', { text: `${e.actor} ${e.action} ${e.target}` });
      ul.appendChild(li);
    }
    inner.appendChild(ul);
    wrap.appendChild(inner);
    return wrap;
  }, { projectId: id });
}

async function pageExport(id: number): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'band' });
    const inner = el('div', { class: 'band-inner' });
    inner.appendChild(el('h1', { text: 'Export project' }));
    const start = el('button', { class: 'btn', 'aria-label': 'Export project', text: 'Export project' });
    const bar = el('progress', { 'aria-label': 'Project export', max: '100', value: '0' }) as HTMLProgressElement;
    start.addEventListener('click', async (): Promise<void> => {
      const result = await withWrite(async () => api('POST', `/api/projects/${id}/exports`));
      if (result) {
        announcer.say('Export started.');
        pollExport(result.id, bar, inner);
      }
    });
    inner.append(start, bar);
    wrap.appendChild(inner);
    return wrap;
  }, { projectId: id });
}

function pollExport(exportId: number, bar: HTMLProgressElement, inner: HTMLElement): void {
  const timer = window.setInterval(async (): Promise<void> => {
    const data = (await api('GET', `/api/exports/${exportId}`)) as AnyRec;
    bar.value = data?.progress ?? 0;
    if (data?.status === 'finished') {
      window.clearInterval(timer);
      announcer.say('Export ready.');
      const link = el('a', { href: `/api/exports/${exportId}/file`, 'aria-label': 'Download export', text: 'Download export' });
      inner.appendChild(link);
    } else if (data?.status === 'failed') {
      window.clearInterval(timer);
      const retry = el('button', { class: 'btn', 'aria-label': 'Retry export', text: 'Retry export' });
      retry.addEventListener('click', async (): Promise<void> => {
        const result = await withWrite(async () => api('POST', `/api/exports/${exportId}/retry`));
        if (result) pollExport(result.id, bar, inner);
      });
      inner.append(el('p', { class: 'status-strip fail', text: 'Export failed: file storage is unavailable.' }), retry);
    }
  }, 400);
}

async function pageImport(id: number, _query: URLSearchParams): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'band' });
    const inner = el('div', { class: 'band-inner' });
    inner.appendChild(el('h1', { text: 'Import project' }));
    const choose = el('button', { class: 'btn', 'aria-label': 'Choose spurpack file', text: 'Choose spurpack file' });
    const fileInput = el('input', { type: 'file', class: 'sr-only', 'aria-label': 'Choose spurpack file' }) as HTMLInputElement;
    choose.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', async (): Promise<void> => {
      const file = fileInput.files?.[0];
      if (!file) return;
      const text = await file.text();
      const result = (await api('POST', `/api/groups/${id}/imports?slug=imported`, text)) as AnyRec;
      const dlg = el('dialog', { 'aria-label': 'Import preview' }) as HTMLDialogElement;
      const body = el('div', { class: 'dialog-body' });
      body.appendChild(el('h2', { text: `Adds ${result?.preview?.commits ?? 0} commits, ${result?.preview?.issues ?? 0} issues, ${result?.preview?.requests ?? 0} requests.` }));
      const confirm = el('button', { class: 'btn', 'aria-label': 'Import', text: 'Import' });
      confirm.addEventListener('click', async (): Promise<void> => {
        const confirmed = await withWrite(async () => api('POST', `/api/imports/${result.id}/confirm`));
        if (confirmed) {
          dlg.close();
          announcer.say(`Import finished: ${result?.preview?.commits ?? 0} commits, ${result?.preview?.issues ?? 0} issues, ${result?.preview?.requests ?? 0} requests.`);
          window.location.href = `/projects/${confirmed.project}/-/import`;
        }
      });
      body.appendChild(confirm);
      dlg.appendChild(body);
      document.body.appendChild(dlg);
      openDialog(dlg, choose);
    });
    inner.append(choose, fileInput);
    wrap.appendChild(inner);
    return wrap;
  }, {});
}

async function pageFiles(id: number, query: URLSearchParams): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const ref = query.get('ref') ?? 'main';
    const data = (await api('GET', `/api/projects/${id}/tree?ref=${encodeURIComponent(ref)}`)) as AnyRec;
    const wrap = el('div', { class: 'panel' });
    wrap.appendChild(el('h1', { text: 'Files' }));
    const tree = el('div', { role: 'tree', 'aria-label': 'Files' });
    for (const entry of (data?.entries ?? []) as AnyRec[]) {
      const item = el('div', { role: 'treeitem', tabindex: '0', text: entry.name, 'aria-label': entry.name });
      item.addEventListener('click', () => {
        window.location.search = `?ref=${encodeURIComponent(ref)}&path=${encodeURIComponent(entry.name)}`;
      });
      tree.appendChild(item);
    }
    wrap.appendChild(tree);
    return wrap;
  }, { projectId: id, dark: true });
}

async function pageCommits(id: number, query: URLSearchParams): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const ref = query.get('ref') ?? 'main';
    const data = (await api('GET', `/api/projects/${id}/commits?ref=${encodeURIComponent(ref)}`)) as AnyRec;
    const wrap = el('div', { class: 'panel' });
    wrap.appendChild(el('h1', { text: 'History' }));
    const list = el('ul');
    for (const c of (data?.commits ?? []) as AnyRec[]) {
      const li = el('li');
      li.appendChild(el('a', { href: `/projects/${id}/-/commit/${c.id}`, text: `${shortSha(c.id)} ${c.message}` }));
      list.appendChild(li);
    }
    wrap.appendChild(list);
    return wrap;
  }, { projectId: id, dark: true });
}

async function pageCommit(id: number, commitId: string): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const data = (await api('GET', `/api/projects/${id}/commits/${commitId}`)) as AnyRec;
    const wrap = el('div', { class: 'panel' });
    const title = el('h1', { text: `Commit ${shortSha(commitId)}` });
    wrap.appendChild(title);
    wrap.appendChild(el('p', { class: 'mono', text: data?.message ?? '' }));
    return wrap;
  }, { projectId: id, dark: true });
}

async function pageEditor(id: number, query: URLSearchParams): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'panel' });
    wrap.appendChild(el('h1', { text: 'Web editor' }));
    const refs = (await api('GET', `/api/projects/${id}/refs`)) as AnyRec;
    const branch = el('select', { 'aria-label': 'Target branch' }) as HTMLSelectElement;
    for (const b of (refs?.branches ?? []) as AnyRec[]) {
      branch.appendChild(el('option', { value: b.name, text: b.name }));
    }
    branch.value = query.get('ref') ?? branch.value;
    const area = el('textarea', { 'aria-label': `Edit ${query.get('path') ?? 'file'}` }) as HTMLTextAreaElement;
    const message = el('input', { type: 'text', 'aria-label': 'Commit message', placeholder: 'Commit message' }) as HTMLInputElement;
    const commit = el('button', { class: 'btn', 'aria-label': 'Commit', text: 'Commit' });
    commit.addEventListener('click', async (): Promise<void> => {
      const path = query.get('path') ?? 'new-file.txt';
      const head = (await api('GET', `/api/projects/${id}/refs`)) as AnyRec;
      const current = (head?.branches ?? []).find((b: AnyRec) => b.name === branch.value);
      const result = await withWrite(async () => api('POST', `/api/projects/${id}/commits`, {
        branch: branch.value,
        base_commit: current?.commit ?? null,
        message: message.value,
        actions: [{ action: 'update', path, content: area.value }],
      }));
      if (result) {
        announcer.say(`Committed ${shortSha(result.commit)} to ${branch.value}.`);
        window.location.href = `/projects/${id}/-/commit/${result.commit}`;
      }
    });
    const file = query.get('path');
    if (file) {
      const content = (await api('GET', `/api/projects/${id}/files?ref=${encodeURIComponent(query.get('ref') ?? 'main')}&path=${encodeURIComponent(file)}`)) as AnyRec;
      area.value = content?.content ?? '';
    }
    wrap.append(branch, area, message, commit);
    return wrap;
  }, { projectId: id, dark: true, livePage: true });
}

async function pageCiEditor(id: number, query: URLSearchParams): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'panel' });
    wrap.appendChild(el('h1', { text: 'Pipeline config editor' }));
    const area = el('textarea', { 'aria-label': 'Pipeline config' }) as HTMLTextAreaElement;
    const ref = query.get('ref') ?? 'main';
    const existing = (await api('GET', `/api/projects/${id}/files?ref=${encodeURIComponent(ref)}&path=spurline.pipeline.yml`)) as AnyRec;
    area.value = existing?.content ?? '';
    const check = el('button', { class: 'btn', 'aria-label': 'Check config', text: 'Check config' });
    const results = el('div', { role: 'region', 'aria-label': 'Lint results' });
    const expanded = el('ul', { 'aria-label': 'Expanded jobs' });
    check.addEventListener('click', async (): Promise<void> => {
      const lint = (await api('POST', `/api/projects/${id}/ci/lint`, { content: area.value, ref, variables: {}, changed_files: [] })) as AnyRec;
      results.textContent = '';
      if (lint?.valid) {
        announcer.say(lint.summary ?? 'Valid.');
        results.appendChild(el('p', { text: lint.summary }));
      } else {
        const n = (lint?.errors ?? []).length;
        announcer.say(n === 1 ? 'Lint found 1 problem.' : `Lint found ${n} problems.`);
        for (const err of (lint?.errors ?? []) as string[]) {
          const btn = el('button', { 'aria-label': err, text: err });
          const lineNo = Number((err.match(/Line (\d+)/) ?? [])[1] ?? 1);
          btn.addEventListener('click', (): void => {
            const pos = area.value.split('\n').slice(0, lineNo - 1).join('\n').length;
            area.focus();
            area.setSelectionRange(pos, pos);
          });
          results.appendChild(btn);
        }
      }
      expanded.textContent = '';
      for (const j of (lint?.jobs ?? []) as AnyRec[]) {
        const vars = Object.entries(j.variables ?? {}).map(([k, v]) => `${k}=${v}`).sort().join(' ');
        expanded.appendChild(el('li', { text: `${j.name} ${j.stage} ${vars}` }));
      }
    });
    wrap.append(area, check, results, expanded);
    return wrap;
  }, { projectId: id, dark: true, livePage: true });
}

async function pageGroup(path: string): Promise<void> {
  await shell(async (): Promise<HTMLElement> => {
    const wrap = el('div', { class: 'band' });
    const inner = el('div', { class: 'band-inner' });
    inner.appendChild(el('h1', { text: path }));
    wrap.appendChild(inner);
    return wrap;
  }, {});
}

/* ---------- router ---------- */

interface Route {
  pattern: RegExp;
  render: (params: string[], query: URLSearchParams) => Promise<void>;
}

const routes: Route[] = [
  { pattern: /^\/sign-in$/, render: () => pageSignIn(false) },
  { pattern: /^\/sign-up$/, render: () => pageSignIn(true) },
  { pattern: /^\/$/, render: () => pageDashboard() },
  { pattern: /^\/search$/, render: (_p, q) => pageSearch(q) },
  { pattern: /^\/projects\/(\d+)$/, render: (p) => pageProjectHome(Number(p[0])) },
  { pattern: /^\/projects\/(\d+)\/-\/merge_requests$/, render: (p) => pageMrList(Number(p[0])) },
  { pattern: /^\/projects\/(\d+)\/-\/merge_requests\/new$/, render: (p) => pageMrNew(Number(p[0])) },
  { pattern: /^\/projects\/(\d+)\/-\/merge_requests\/(\d+)$/, render: (p) => pageMrView(Number(p[0]), Number(p[1]), 'overview') },
  { pattern: /^\/projects\/(\d+)\/-\/merge_requests\/(\d+)\/changes$/, render: (p, q) => pageMrChanges(Number(p[0]), Number(p[1]), q) },
  { pattern: /^\/projects\/(\d+)\/-\/merge_requests\/(\d+)\/conflicts$/, render: (p) => pageConflicts(Number(p[0]), Number(p[1])) },
  { pattern: /^\/projects\/(\d+)\/-\/train$/, render: (p, q) => pageTrain(Number(p[0]), q) },
  { pattern: /^\/projects\/(\d+)\/-\/pipelines$/, render: (p) => pagePipelines(Number(p[0])) },
  { pattern: /^\/projects\/(\d+)\/-\/pipelines\/(\d+)$/, render: (p) => pagePipelineView(Number(p[0]), Number(p[1])) },
  { pattern: /^\/projects\/(\d+)\/-\/jobs\/(\d+)$/, render: (p) => pageJob(Number(p[0]), Number(p[1])) },
  { pattern: /^\/projects\/(\d+)\/-\/environments$/, render: (p) => pageEnvironments(Number(p[0])) },
  { pattern: /^\/projects\/(\d+)\/-\/environments\/(\d+)$/, render: (p) => pageEnvironment(Number(p[0]), Number(p[1])) },
  { pattern: /^\/projects\/(\d+)\/-\/metrics$/, render: (p, q) => pageMetrics(Number(p[0]), q) },
  { pattern: /^\/projects\/(\d+)\/-\/issues$/, render: (p) => pageIssues(Number(p[0])) },
  { pattern: /^\/projects\/(\d+)\/-\/issues\/(\d+)$/, render: (p) => pageIssue(Number(p[0]), Number(p[1])) },
  { pattern: /^\/projects\/(\d+)\/-\/milestones\/(\d+)$/, render: (p) => pageMilestone(Number(p[0]), Number(p[1])) },
  { pattern: /^\/projects\/(\d+)\/-\/boards\/(\d+)$/, render: (p, q) => pageBoard(Number(p[0]), Number(p[1]), q) },
  { pattern: /^\/projects\/(\d+)\/-\/wiki\/([^/]+)$/, render: (p) => pageWiki(Number(p[0]), p[1]) },
  { pattern: /^\/projects\/(\d+)\/-\/settings$/, render: (p) => pageSettings(Number(p[0])) },
  { pattern: /^\/projects\/(\d+)\/-\/audit$/, render: (p) => pageAudit(Number(p[0])) },
  { pattern: /^\/projects\/(\d+)\/-\/export$/, render: (p) => pageExport(Number(p[0])) },
  { pattern: /^\/projects\/(\d+)\/-\/import$/, render: (p, q) => pageImport(Number(p[0]), q) },
  { pattern: /^\/projects\/(\d+)\/-\/files$/, render: (p, q) => pageFiles(Number(p[0]), q) },
  { pattern: /^\/projects\/(\d+)\/-\/commits$/, render: (p, q) => pageCommits(Number(p[0]), q) },
  { pattern: /^\/projects\/(\d+)\/-\/commit\/([0-9a-f]+)$/, render: (p) => pageCommit(Number(p[0]), p[1]) },
  { pattern: /^\/projects\/(\d+)\/-\/edit$/, render: (p, q) => pageEditor(Number(p[0]), q) },
  { pattern: /^\/projects\/(\d+)\/-\/ci\/editor$/, render: (p, q) => pageCiEditor(Number(p[0]), q) },
  { pattern: /^\/groups\/(.+)$/, render: (p) => pageGroup(p[1]) },
];

async function navigate(): Promise<void> {
  const path = window.location.pathname;
  for (const route of routes) {
    const m = route.pattern.exec(path);
    if (m) {
      await route.render(m.slice(1), new URLSearchParams(window.location.search));
      return;
    }
  }
  await shell(async () => h('div', { class: 'band' }, el('h1', { text: 'Not found' })));
}

window.addEventListener('popstate', () => {
  void navigate();
});

window.addEventListener('DOMContentLoaded', (): void => {
  void (async (): Promise<void> => {
    try {
      const me = (await api('GET', '/api/me')) as AnyRec;
      (window as unknown as AnyRec).__SPUR_USER__ = me?.user?.username ?? null;
    } catch {
      // not signed in
    }
    await navigate();
  })();
});
