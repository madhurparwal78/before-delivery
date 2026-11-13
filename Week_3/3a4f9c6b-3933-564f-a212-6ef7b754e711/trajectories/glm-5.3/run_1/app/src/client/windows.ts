// The Windows and freezes screen.

import { ApiError, ClusterInfo, Decision, FreezeVersion, Graph, Opening, api, clusterTime, utcTime } from './api.js';
import { DialogHost, Live, Refresher, every } from './shell.js';
import { el, esc } from './ui.js';

const DAYS: { key: string; label: string }[] = [
  { key: 'mon', label: 'Mon' }, { key: 'tue', label: 'Tue' }, { key: 'wed', label: 'Wed' },
  { key: 'thu', label: 'Thu' }, { key: 'fri', label: 'Fri' }, { key: 'sat', label: 'Sat' }, { key: 'sun', label: 'Sun' },
];

export class WindowsScreen {
  private refresher: Refresher | null = null;
  private clusters: ClusterInfo[] = [];
  private policy: { in_force_version: number; versions: FreezeVersion[] } | null = null;
  private graph: Graph | null = null;
  private root = document.getElementById('root')!;

  constructor(
    private readonly slug: string,
    private readonly role: string,
    private readonly live: Live,
    private readonly dialogs: DialogHost,
    private readonly onSessionEnded: () => void,
  ) {}

  mount(): void {
    this.root.innerHTML = '';
    const shell = el('div', { class: 'app-shell' });
    shell.innerHTML = `
      <aside class="rail">
        <div class="brand">Keelson</div>
        <nav aria-label="Projects">
          <a href="/projects/${esc(this.slug)}" aria-current="true">${esc(this.slug)}</a>
        </nav>
        <a href="/projects/${esc(this.slug)}/windows" aria-current="true">Windows and freezes</a>
      </aside>
      <main class="main">
        <div class="windows-screen">
          <h1>Windows and freezes</h1>
          <div id="clusters"></div>
          <form class="panel check-form" aria-label="Check an instant" id="check-form">
            <h3>Check an instant</h3>
            <div class="check-row">
              <div class="field">
                <label for="check-stage">Stage</label>
                <select id="check-stage" name="stage"></select>
              </div>
              <div class="field">
                <label for="check-time">Cluster local time</label>
                <input id="check-time" name="time" type="text" placeholder="YYYY-MM-DD HH:mm">
              </div>
              <button class="btn primary" type="submit">Check</button>
            </div>
            <p class="error" id="check-error" hidden></p>
            <p class="check-result" id="check-result" role="status" aria-live="polite"></p>
          </form>
          <section class="panel freeze-panel" aria-label="Freeze policy">
            <h3>Freeze policy</h3>
            <ul id="freeze-list"></ul>
            ${this.role === 'platform_engineer' ? '<button class="btn primary" id="new-freeze">New freeze version</button>' : ''}
          </section>
        </div>
      </main>`;
    shell.querySelectorAll('a[href^="/projects/"]:not([href$="/windows"])').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        window.history.pushState({}, '', (a as HTMLAnchorElement).getAttribute('href')!);
        window.dispatchEvent(new PopStateEvent('popstate'));
      });
    });
    this.root.appendChild(shell);
    document.getElementById('check-form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      void this.checkInstant();
    });
    const newBtn = document.getElementById('new-freeze');
    if (newBtn) newBtn.addEventListener('click', () => this.openNewFreezeDialog());
    this.refresher = every(30000, () => this.load());
    void this.load();
  }

  unmount(): void {
    this.refresher?.stop();
    this.root.innerHTML = '';
  }

  private async load(): Promise<void> {
    try {
      const [clusters, policy, graph] = await Promise.all([
        api.clusters(this.slug) as Promise<{ clusters: ClusterInfo[] }>,
        api.freezePolicy(this.slug) as Promise<{ in_force_version: number; versions: FreezeVersion[] }>,
        api.graph(this.slug) as Promise<Graph>,
      ]);
      this.clusters = clusters.clusters;
      this.policy = policy;
      this.graph = graph;
      this.renderClusters();
      this.renderFreeze();
      this.renderStageSelect();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'unauthenticated') this.onSessionEnded();
      else if (err instanceof Error) this.live.problem(err.message);
    }
  }

  private renderClusters(): void {
    const host = document.getElementById('clusters');
    if (!host) return;
    host.innerHTML = this.clusters.map((c) => `
      <section class="panel cluster-panel" aria-label="Cluster ${esc(c.name)}">
        <h3>${esc(c.name)}</h3>
        <p class="zone">${esc(c.time_zone)} · Cluster time ${esc(clusterTime(c.time_zone, new Date().toISOString()))}</p>
        <table aria-label="Sync windows ${esc(c.name)}">
          <thead><tr><th>Days</th><th>Opens</th><th>Closes</th><th>Label</th>${this.role === 'platform_engineer' ? '<th></th>' : ''}</tr></thead>
          <tbody>
            ${c.windows.length === 0 ? '<tr><td colspan="5">No windows. The cluster is always open.</td></tr>' : ''}
            ${c.windows.map((w) => `<tr>
              <td>${w.days.join(', ')}</td>
              <td class="mono">${esc(w.start)}</td>
              <td class="mono">${esc(w.end)}</td>
              <td>${esc(w.label)}</td>
              ${this.role === 'platform_engineer' ? `<td><button class="btn danger" data-delete-window="${esc(w.id)}" data-cluster="${esc(c.name)}" aria-label="Delete window ${esc(w.label)}">Delete</button></td>` : ''}
            </tr>`).join('')}
          </tbody>
        </table>
        <div>
          <h4>Next openings</h4>
          <ol aria-label="Next openings ${esc(c.name)}" id="openings-${esc(c.name)}" class="mono"></ol>
        </div>
        ${this.role === 'platform_engineer' ? `<button class="btn primary" data-add-window="${esc(c.name)}">Add window</button>` : ''}
      </section>`).join('');
    host.querySelectorAll('[data-add-window]').forEach((b) => {
      b.addEventListener('click', () => this.openAddWindowDialog((b as HTMLElement).dataset.addWindow!));
    });
    host.querySelectorAll('[data-delete-window]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = (b as HTMLElement).dataset.deleteWindow!;
        const cluster = (b as HTMLElement).dataset.cluster!;
        void this.deleteWindow(cluster, id);
      });
    });
    for (const c of this.clusters) {
      void this.loadOpenings(c.name);
    }
  }

  private async loadOpenings(cluster: string): Promise<void> {
    try {
      const r = await api.openings(this.slug, cluster, 5) as { time_zone: string; openings: Opening[] };
      const host = document.getElementById(`openings-${cluster}`);
      if (!host) return;
      host.innerHTML = r.openings.length
        ? r.openings.map((o) => `<li>${esc(o.local_opens)} → ${esc(o.local_closes)} · ${esc(o.label)}</li>`).join('')
        : '<li>No openings scheduled.</li>';
    } catch { /* transient */ }
  }

  private renderStageSelect(): void {
    const select = document.getElementById('check-stage') as HTMLSelectElement | null;
    if (!select || !this.graph) return;
    select.innerHTML = this.graph.nodes.map((n) => `<option value="${esc(n.stage)}">${esc(n.stage)}</option>`).join('');
  }

  private renderFreeze(): void {
    const list = document.getElementById('freeze-list');
    if (!list || !this.policy) return;
    list.innerHTML = this.policy.versions.map((v) => `
      <li class="${v.version === this.policy!.in_force_version ? 'in-force' : ''}">
        <span class="v">Version ${v.version}</span>
        ${v.version === this.policy!.in_force_version ? '<span class="pill approved">in force now</span>' : ''}
        <div class="row">
          <span>Effective from ${esc(utcTime(v.effective_from))}</span>
          <span>by ${esc(v.created_by)}</span>
        </div>
        ${v.freezes.length === 0
          ? '<p class="note">No freezes.</p>'
          : v.freezes.map((f) => `<div class="row"><span>${esc(f.name)}</span><span>${esc(f.stages.join(', '))}</span><span>${esc(utcTime(f.starts_at))} → ${esc(utcTime(f.ends_at))}</span></div>`).join('')}
      </li>`).join('');
  }

  private async checkInstant(): Promise<void> {
    const stage = (document.getElementById('check-stage') as HTMLSelectElement).value;
    const timeInput = (document.getElementById('check-time') as HTMLInputElement).value.trim();
    const error = document.getElementById('check-error')!;
    const result = document.getElementById('check-result')!;
    error.hidden = true;
    if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(timeInput)) {
      error.textContent = 'Use the YYYY-MM-DD HH:mm form.';
      error.hidden = false;
      return;
    }
    const node = this.graph?.nodes.find((n) => n.stage === stage);
    if (!node) return;
    // Convert the cluster-local time to an instant using the gap/overlap rule,
    // by asking the server: it applies the rule in one place.
    const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(timeInput)!;
    try {
      this.live.activity('Checking…');
      // Find the instant by binary probing the decision endpoint is not
      // possible; instead send the local time to the server via the date
      // parts and let the window-decision endpoint receive a UTC instant
      // computed with the browser's Intl in the cluster zone.
      const zone = node.time_zone;
      const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
      const probe = new Date(naive);
      const fmt = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit' });
      const parts = fmt.formatToParts(probe);
      const map: Record<string, string> = {};
      for (const p of parts) map[p.type] = p.value;
      const asUTC = Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), Number(map.hour) % 24, Number(map.minute));
      const offset = asUTC - probe.getTime();
      const guess = new Date(naive - offset);
      const guessParts = fmt.formatToParts(guess);
      const gm: Record<string, string> = {};
      for (const p of guessParts) gm[p.type] = p.value;
      const guessAsUTC = Date.UTC(Number(gm.year), Number(gm.month) - 1, Number(gm.day), Number(gm.hour) % 24, Number(gm.minute));
      const isExact = guessAsUTC === naive;
      const beforeOffsetProbe = new Date(guess.getTime() - 3 * 3600_000);
      const beforeOffset = (() => {
        const p2 = fmt.formatToParts(beforeOffsetProbe);
        const b: Record<string, string> = {};
        for (const p of p2) b[p.type] = p.value;
        return Date.UTC(Number(b.year), Number(b.month) - 1, Number(b.day), Number(b.hour) % 24, Number(b.minute)) - beforeOffsetProbe.getTime();
      })();
      let instant: Date;
      if (isExact) {
        instant = beforeOffset > offset ? new Date(naive - beforeOffset) : guess;
      } else {
        const gap = beforeOffset > offset ? beforeOffset - offset : offset - beforeOffset;
        instant = beforeOffset > offset ? new Date(naive - beforeOffset + gap) : guess;
      }
      const decision = await api.windowDecision(this.slug, stage, instant.toISOString()) as Decision;
      if (decision.open && decision.window) {
        result.textContent = `Open: ${decision.window.label}`;
      } else if (!decision.open && decision.reason === 'freeze' && decision.freeze) {
        result.textContent = `Closed: freeze "${decision.freeze.name}" (policy version ${decision.policy_version})`;
      } else {
        result.textContent = 'Closed: outside every sync window';
      }
    } catch (err) {
      if (err instanceof ApiError && err.fields?.at) {
        error.textContent = err.fields.at;
        error.hidden = false;
      } else if (err instanceof Error) {
        this.live.problem(err.message);
      }
    }
  }

  private openAddWindowDialog(cluster: string): void {
    this.dialogs.open({
      title: `Add window to ${cluster}`,
      checkboxes: DAYS.map((d) => ({ name: `day:${d.key}`, label: d.label })),
      fields: [
        { name: 'start', label: 'Opens', placeholder: '09:00' },
        { name: 'end', label: 'Closes', placeholder: '12:00' },
        { name: 'label', label: 'Label', placeholder: 'EU change window' },
      ],
      confirmLabel: 'Save window',
      onSubmit: async (values) => {
        const days = (values.__days ?? '').split(',').filter(Boolean);
        this.live.activity('Saving window…');
        await api.addWindow(this.slug, cluster, {
          label: values.label, days, start: values.start, end: values.end,
        });
        const openings = await api.openings(this.slug, cluster, 1) as { openings: Opening[] };
        const first = openings.openings[0];
        this.live.activity(first
          ? `Window added. Next opening ${first.local_opens} ${clusterZone(this.clusters, cluster)}.`
          : 'Window added. No openings scheduled.');
        await this.load();
      },
    });
  }

  private async deleteWindow(cluster: string, id: string): Promise<void> {
    this.live.activity('Removing window…');
    await api.deleteWindow(this.slug, cluster, id);
    this.live.activity('Window removed.');
    await this.load();
  }

  private openNewFreezeDialog(): void {
    if (!this.graph) return;
    const stages = this.graph.nodes.map((n) => n.stage);
    const bodyNode = el('div');
    bodyNode.style.display = 'flex';
    bodyNode.style.flexDirection = 'column';
    bodyNode.style.gap = '12px';

    const effectiveField = el('div', { class: 'field', 'data-field': 'effective_from' });
    effectiveField.innerHTML = `
      <label for="f-effective_from">Effective from (UTC)</label>
      <input id="f-effective_from" name="effective_from" type="text" placeholder="2026-11-26T00:00:00Z">
      <p class="error" hidden></p>`;
    bodyNode.appendChild(effectiveField);

    const rowsHost = el('div');
    rowsHost.style.display = 'flex';
    rowsHost.style.flexDirection = 'column';
    rowsHost.style.gap = '12px';
    bodyNode.appendChild(rowsHost);

    const makeRow = (): HTMLElement => {
      const row = el('div', { 'data-freeze-row': '' });
      row.style.display = 'flex';
      row.style.flexDirection = 'column';
      row.style.gap = '8px';
      row.innerHTML = `
        <input data-freeze-name placeholder="Freeze name" aria-label="Freeze name">
        <input data-freeze-starts placeholder="Starts (UTC)" aria-label="Starts (UTC)">
        <input data-freeze-ends placeholder="Ends (UTC)" aria-label="Ends (UTC)">
        <div class="checkbox-row">${stages.map((s) => `<label class="checkbox-pill"><input type="checkbox" value="${esc(s)}"> ${esc(s)}</label>`).join('')}</div>`;
      rowsHost.appendChild(row);
      return row;
    };
    makeRow();

    const addBtn = el('button', { class: 'btn', type: 'button' });
    addBtn.textContent = 'Add freeze';
    addBtn.addEventListener('click', () => makeRow());
    bodyNode.appendChild(addBtn);

    this.dialogs.open({
      title: 'New freeze policy version',
      bodyNode,
      confirmLabel: 'Schedule version',
      onSubmit: async () => {
        const freezes: { name: string; stages: string[]; starts_at: string; ends_at: string }[] = [];
        rowsHost.querySelectorAll<HTMLElement>('[data-freeze-row]').forEach((row) => {
          const name = (row.querySelector('[data-freeze-name]') as HTMLInputElement).value;
          const starts = (row.querySelector('[data-freeze-starts]') as HTMLInputElement).value;
          const ends = (row.querySelector('[data-freeze-ends]') as HTMLInputElement).value;
          const stageList = Array.from(row.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked')).map((c) => c.value);
          if (name || starts || ends || stageList.length) {
            freezes.push({ name, stages: stageList, starts_at: starts, ends_at: ends });
          }
        });
        const effectiveFrom = (effectiveField.querySelector('input') as HTMLInputElement).value;
        this.live.activity('Scheduling…');
        try {
          const created = await api.scheduleFreeze(this.slug, {
            based_on_version: this.policy?.versions[this.policy.versions.length - 1]?.version ?? 0,
            effective_from: effectiveFrom,
            freezes,
          }) as FreezeVersion;
          this.live.activity(`Freeze policy version ${created.version} takes effect at ${utcTime(created.effective_from)}.`);
          await this.load();
        } catch (err) {
          throw err;
        }
      },
    });
  }
}

function clusterZone(clusters: ClusterInfo[], name: string): string {
  return clusters.find((c) => c.name === name)?.time_zone ?? '';
}
