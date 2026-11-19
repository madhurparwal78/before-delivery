// The Reports page: revisions, revision bands with flat charts, restore, and report links.

import { api, ApiError, NetworkError } from '../api';
import { h, clear, setStatus, utcStamp, hoursMinutes, utcDate, utcTime, countWord } from '../ui';
import { openDialog, closeDialogOf } from '../dialog';
import { buildShell, onEvent, announce, copyForEvent } from '../main';
import * as T from '../types';

function drawChart(canvas: HTMLCanvasElement, pen: { grid: T.PenGrid; circumference_m: number; net_depth_m: number }, w: number, hh: number) {
  canvas.width = w * 2; canvas.height = hh * 2;
  const g = canvas.getContext('2d')!;
  g.scale(2, 2);
  g.fillStyle = '#0a0f14';
  g.fillRect(0, 0, w, hh);
  const cols = pen.grid.columns;
  const rows = pen.grid.rows;
  const pw = w / cols, ph = hh / rows;
  g.strokeStyle = 'rgba(140, 155, 170, 0.25)';
  g.lineWidth = 1;
  for (let c = 0; c <= cols; c++) {
    g.beginPath(); g.moveTo(c * pw, 0); g.lineTo(c * pw, hh); g.stroke();
  }
  for (let r = 0; r <= rows; r++) {
    g.beginPath(); g.moveTo(0, r * ph); g.lineTo(w, r * ph); g.stroke();
  }
  g.fillStyle = '#8a93a0';
  g.font = '10px Inter, sans-serif';
  for (let c = 0; c < cols; c++) {
    g.fillText(String.fromCharCode(65 + c), c * pw + 3, 10);
  }
  for (let r = 0; r < rows; r++) {
    g.fillText(String(r + 1), 3, r * ph + 20);
  }
}

export class ReportsPage {
  private root: HTMLElement;
  private pens: T.Pen[] = [];
  private penId = 'skv-01';
  private revisions: T.Revision[] = [];
  private links: T.Link[] = [];
  private status!: HTMLElement;
  private bandsHost!: HTMLElement;
  private linksHost!: HTMLElement;
  private latestHost!: HTMLElement;
  private refreshTimer = 0;
  private stopEvents: import("../main").EventUnsubscribe;

  constructor(app: HTMLElement) {
    const { main } = buildShell(app, '/reports');
    this.root = main;
    this.stopEvents = onEvent((e) => {
      const kind = e.kind as string;
      if (kind === 'revision_published' || kind === 'link_created' || kind === 'link_regenerated' || kind === 'link_revoked' || kind === 'revision_restored') {
        this.load();
        const copy = copyForEvent(e);
        if (copy) announce(copy);
      }
    });
    this.build();
    this.load();
    this.refreshTimer = window.setInterval(() => this.loadLinks(), 30000);
  }

  teardown() { clearInterval(this.refreshTimer); this.stopEvents.clear(); }

  private build() {
    const head = h('div', { class: 'gutters', style: 'padding-top:24px; display:flex;gap:10px;align-items:center;flex-wrap:wrap' });
    const penSel = h('select', { 'aria-label': 'Pen' }) as HTMLSelectElement;
    penSel.addEventListener('change', () => { this.penId = penSel.value; this.load(); });
    this.penSel = penSel;
    const publish = h('button', { class: 'btn', text: 'Publish revision', onclick: async (e: Event) => {
      const btn = e.currentTarget as HTMLButtonElement;
      btn.disabled = true;
      setStatus(this.status, 'Publishing…');
      try {
        const res = await api.post<{ revision: T.Revision }>(`/api/pens/${this.penId}/reports`);
        setStatus(this.status, `Published revision ${res.revision.number}`);
        await this.load();
      } catch (err) {
        if (err instanceof ApiError) setStatus(this.status, err.message, true);
        else if (err instanceof NetworkError) setStatus(this.status, err.message, true);
      } finally { btn.disabled = false; }
    }});
    this.status = h('div', { class: 'status num', role: 'status', 'aria-label': 'Report status' });
    head.append(h('h1', { class: 'display-l', text: 'Reports' }), penSel, publish, this.status);
    this.root.append(head);

    this.latestHost = h('div', { class: 'gutters', style: 'margin-top:18px' });
    this.root.append(this.latestHost);

    const counters = h('div', { class: 'gutters', style: 'display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px' });
    if (window.matchMedia('(max-width: 599px)').matches) counters.style.gridTemplateColumns = '1fr';
    this.gradePanel = h('div', { class: 'counter-panel olive', role: 'region', 'aria-label': 'Condition grade' });
    this.openPanel = h('div', { class: 'counter-panel stone', role: 'region', 'aria-label': 'Open defects' });
    counters.append(this.gradePanel, this.openPanel);
    this.root.append(counters);

    this.bandsHost = h('div', { class: 'gutters' });
    this.root.append(this.bandsHost);

    this.linksHost = h('div', { class: 'gutters', style: 'margin-top:26px' });
    this.root.append(this.linksHost);
  }

  private penSel!: HTMLSelectElement;
  private gradePanel!: HTMLElement;
  private openPanel!: HTMLElement;

  private async load() {
    try {
      const p = await api.get<{ pens: T.Pen[] }>('/api/pens');
      this.pens = p.pens;
      clear(this.penSel);
      for (const pen of this.pens) {
        const o = h('option', { value: pen.id, text: pen.name }) as HTMLOptionElement;
        if (pen.id === this.penId) o.selected = true;
        this.penSel.append(o);
      }
      if (!this.pens.some(p => p.id === this.penId)) this.penId = this.pens[0]?.id ?? 'skv-01';

      const [penRes, revRes, linkRes] = await Promise.all([
        api.get<{ pen: T.Pen }>(`/api/pens/${this.penId}`),
        api.get<{ revisions: T.Revision[] }>(`/api/pens/${this.penId}/reports`),
        api.get<{ links: T.Link[] }>(`/api/pens/${this.penId}/links`),
      ]);
      this.pen = penRes.pen;
      this.revisions = revRes.revisions;
      this.links = linkRes.links;
      this.renderLatest();
      this.renderCounters();
      this.renderBands();
      this.renderLinks();
    } catch (e) {
      if (e instanceof NetworkError) setStatus(this.status, e.message, true);
    }
  }

  private pen: T.Pen | null = null;

  private renderLatest() {
    clear(this.latestHost);
    if (!this.pen) return;
    const latest = this.revisions[0];
    const band = h('div', { class: 'paper-band', role: 'region', 'aria-label': 'Latest report' });
    const textCol = h('div', {},
      h('div', { class: 'k', text: `Published ${latest ? utcDate(latest.published_at) : '—'}` }),
      h('div', { class: 'display-l', style: 'color:#101418', text: `${this.pen.name} — grade ${this.pen.grade.letter}` }),
      h('div', { class: 'k', text: countWord(this.pen.open_defects, 'open defect', 'open defects') }),
    );
    const chartCol = h('div', { class: 'chart-frame' });
    const canvas = document.createElement('canvas');
    canvas.style.aspectRatio = '1.6';
    canvas.style.width = '100%';
    canvas.style.display = 'block';
    chartCol.append(canvas);
    band.append(textCol, chartCol);
    this.latestHost.append(band);
    requestAnimationFrame(() => {
      const w = Math.max(200, chartCol.clientWidth);
      drawChart(canvas, this.pen!, w, w / 1.9);
    });
  }

  private renderCounters() {
    if (!this.pen) return;
    for (const host of [this.gradePanel, this.openPanel]) clear(host);
    this.gradePanel.append(
      h('div', { class: 'k', style: 'color:#d7e0d9', text: 'Condition grade' }),
      h('div', { class: 'big num', text: this.pen.grade.letter }),
    );
    this.openPanel.append(
      h('div', { class: 'k', text: 'Open defects' }),
      h('div', { class: 'big num', text: String(this.pen.open_defects) }),
    );
  }

  private renderedBands = new Set<number>();

  private renderBands() {
    clear(this.bandsHost);
    this.renderedBands.clear();
    for (const rev of this.revisions) {
      const band = h('div', { class: 'revision-band', role: 'region', 'aria-label': `Revision ${rev.number}` });
      const left = h('div', {},
        h('div', { class: 'n num', text: `Revision ${rev.number}` }),
        h('div', { class: 'meta num' }, `Published ${utcStamp(rev.published_at)} · grade ${rev.grade} · ${rev.open_defects} open`),
        h('div', { class: 'actions' },
          h('a', { class: 'stone-btn', href: `/api/pens/${this.penId}/reports/${rev.number}/pack`, download: `revision-${rev.number}.json`, 'aria-label': 'Download pack', text: 'Download pack' }),
          h('button', {
            class: 'stone-btn', text: `Restore revision ${rev.number}`,
            onclick: (e: Event) => this.openRestore(rev.number, e.currentTarget as HTMLElement),
          }),
        ),
      );
      const chartCol = h('div', { class: 'chart-frame' });
      const canvas = document.createElement('canvas');
      canvas.style.width = '100%';
      canvas.style.display = 'block';
      chartCol.append(canvas);
      band.append(left, chartCol);
      this.bandsHost.append(band);
      requestAnimationFrame(() => {
        const w = Math.max(180, chartCol.clientWidth);
        drawChart(canvas, this.pen ?? { grid: { columns: 16, rows: 4, panel_width_m: 10, panel_height_m: 5 }, circumference_m: 160, net_depth_m: 20 }, w, w / 2.2);
      });
      // the rise-and-fade reveal, once per band, staggered about 80 ms
      if (!reducedMotionAvailable()) {
        band.style.opacity = '0';
        band.style.transform = 'translateY(12px)';
        const io = new IntersectionObserver((entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && !this.renderedBands.has(rev.number)) {
              this.renderedBands.add(rev.number);
              const delay = (this.renderedBands.size - 1) % 5 * 80;
              setTimeout(() => {
                band.style.transition = 'opacity 1s ease, transform 1s ease';
                band.style.opacity = '1';
                band.style.transform = 'none';
              }, delay);
              io.disconnect();
            }
          }
        }, { threshold: 0.15 });
        io.observe(band);
      }
    }
  }

  private openRestore(number: number, opener: HTMLElement) {
    openDialog({
      title: `Restore revision`,
      initialFocus: 'cancel',
      body: (root) => {
        const dlg = root.closest('dialog')!;
        root.append(h('p', { text: `Restore revision ${number}? The pen's defects become exactly the snapshot.` }));
        root.append(h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn', 'data-cancel': 'true', text: 'Cancel', onclick: () => closeDialogOf(dlg) }),
          h('button', { class: 'btn', text: 'Restore', onclick: async () => {
            setStatus(this.status, 'Restoring…');
            try {
              await api.post(`/api/pens/${this.penId}/restore`, { revision: number });
              setStatus(this.status, `Restored revision ${number}`);
              closeDialogOf(dlg);
              await this.load();
            } catch (err) {
              if (err instanceof ApiError) setStatus(this.status, err.message, true);
            }
          } })));
      },
    }, opener);
  }

  // ---------- links ----------

  private async loadLinks() {
    try {
      const res = await api.get<{ links: T.Link[] }>(`/api/pens/${this.penId}/links`);
      this.links = res.links;
      this.renderLinks();
    } catch {}
  }

  private renderLinks() {
    clear(this.linksHost);
    const region = h('div', { role: 'region', 'aria-label': 'Report links' });
    region.append(h('h2', { class: 'display-m', text: 'Report links', style: 'margin-bottom:8px' }));
    const create = h('button', { class: 'btn', text: 'Create report link', onclick: (e: Event) => this.openCreate(e.currentTarget as HTMLElement) });
    region.append(create);
    for (const link of this.links) {
      const row = h('div', { class: 'link-row' });
      const url = h('input', { class: 'url', readonly: 'readonly', 'aria-label': 'Report link URL', value: link.url }) as HTMLInputElement;
      const statusLine = h('div', { class: 'status num' });
      this.setLinkStatus(statusLine, link);
      const copy = h('button', { class: 'btn', text: 'Copy link', onclick: async () => {
        try { await navigator.clipboard.writeText(link.url); setStatus(this.status, 'Link copied'); } catch {}
      } });
      const regen = h('button', { class: 'btn', text: 'Regenerate link', onclick: async (e: Event) => {
        const btn = e.currentTarget as HTMLButtonElement;
        btn.disabled = true;
        setStatus(this.status, 'Working…');
        try {
          await api.post(`/api/links/${link.id}/regenerate`, { token: link.token });
          setStatus(this.status, 'Link regenerated — the old link no longer works');
          await this.loadLinks();
        } catch (err) {
          btn.disabled = false;
          if (err instanceof ApiError && err.status === 409) {
            setStatus(this.status, err.message, true);
            await this.loadLinks();   // the list refreshes in place
          } else if (err instanceof ApiError) {
            setStatus(this.status, err.message, true);
          }
        }
      } });
      const revoke = h('button', { class: 'btn', text: 'Revoke link', onclick: (e: Event) => this.openRevoke(link, e.currentTarget as HTMLElement) });
      row.append(
        h('div', { class: 'url-line' }, url, copy, regen, revoke),
        statusLine,
      );
      region.append(row);
    }
    this.linksHost.append(region);
  }

  private setLinkStatus(node: HTMLElement, link: T.Link) {
    if (link.status === 'revoked') { node.textContent = 'Revoked'; return; }
    if (link.status === 'expired') { node.textContent = 'Expired'; return; }
    const { h: hh, m } = hoursMinutes(link.expires_in_s);
    node.textContent = `Active — expires ${utcDate(link.expires_at)} ${utcTime(link.expires_at)} (in ${hh} h ${m} min)`;
  }

  private openCreate(opener: HTMLElement) {
    openDialog({
      title: 'Create report link',
      body: (root) => {
        const dlg = root.closest('dialog')!;
        const group = h('div', { role: 'radiogroup', 'aria-label': 'Expires in', style: 'display:flex;gap:12px;flex-direction:column' });
        const options: [string, string, number][] = [['24 hours', '24h', 86400], ['7 days', '7d', 604800], ['30 days', '30d', 2592000]];
        let chosen = 86400;
        for (const [label, value, secs] of options) {
          const id = 'exp-' + value;
          const input = h('input', { type: 'radio', name: 'expires', id, value }) as HTMLInputElement;
          if (secs === 86400) input.checked = true;
          input.addEventListener('change', () => { chosen = secs; });
          group.append(h('label', { for: id, style: 'display:flex;gap:8px;align-items:center' },
            input, h('span', { text: label })));
        }
        root.append(group);
        root.append(h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn', 'data-cancel': 'true', text: 'Cancel', onclick: () => closeDialogOf(dlg) }),
          h('button', { class: 'btn', text: 'Create link', onclick: async () => {
            setStatus(this.status, 'Working…');
            try {
              await api.post(`/api/pens/${this.penId}/links`, { expires_in_seconds: chosen });
              setStatus(this.status, 'Link created');
              closeDialogOf(dlg);
              await this.loadLinks();
            } catch (err) {
              if (err instanceof ApiError) setStatus(this.status, err.message, true);
            }
          } })));
      },
    }, opener);
  }

  private openRevoke(link: T.Link, opener: HTMLElement) {
    openDialog({
      title: 'Revoke link',
      initialFocus: 'cancel',
      body: (root) => {
        const dlg = root.closest('dialog')!;
        root.append(h('p', { text: 'Revoke this report link? Every token it ever had stops working at once.' }));
        root.append(h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn', 'data-cancel': 'true', text: 'Cancel', onclick: () => closeDialogOf(dlg) }),
          h('button', { class: 'btn', text: 'Revoke', onclick: async () => {
            setStatus(this.status, 'Working…');
            try {
              await api.post(`/api/links/${link.id}/revoke`);
              setStatus(this.status, 'Link revoked');
              closeDialogOf(dlg);
              await this.loadLinks();
            } catch (err) {
              if (err instanceof ApiError) setStatus(this.status, err.message, true);
            }
          } })));
      },
    }, opener);
  }
}

function reducedMotionAvailable(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
