// The pen condition card grid and the farms band.

import { api, ApiError, NetworkError } from '../api';
import { h, clear, utcStamp, setStatus, countWord } from '../ui';
import { openDialog, closeDialogOf, closeAllDialogs } from '../dialog';
import { onEvent, navigate, announce, copyForEvent, buildShell } from '../main';
import * as T from '../types';

/** A procedural canvas still of one pen's twin: net rings and its white pins on black water. */
function drawStill(canvas: HTMLCanvasElement, pen: T.Pen, w: number, hh: number) {
  canvas.width = w * 2;
  canvas.height = hh * 2;
  const g = canvas.getContext('2d')!;
  g.scale(2, 2);
  g.fillStyle = '#04070a';
  g.fillRect(0, 0, w, hh);

  const cx = w / 2;
  const cy = hh * 0.34;
  const r = Math.min(w, hh) * 0.30;
  const rows = 6;

  // collar ellipse
  g.strokeStyle = 'rgba(120, 200, 220, 0.75)';
  g.lineWidth = 1.4;
  g.beginPath();
  g.ellipse(cx, cy, r, r * 0.28, 0, 0, Math.PI * 2);
  g.stroke();

  // net rings fading into the dark
  for (let i = 1; i <= rows; i++) {
    const yy = cy + (i / rows) * hh * 0.5;
    g.strokeStyle = `rgba(20, 60, 72, ${0.55 - i * 0.07})`;
    g.lineWidth = 1;
    g.beginPath();
    g.ellipse(cx, yy, r * (1 - i * 0.02), r * (1 - i * 0.02) * 0.3, 0, 0, Math.PI * 2);
    g.stroke();
  }
  // vertical strands
  for (let i = 0; i <= 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const x0 = cx + Math.cos(a) * r;
    const y0 = cy + Math.sin(a) * r * 0.28;
    const x1 = cx + Math.cos(a) * r * 0.9;
    const y1 = cy + hh * 0.5 + Math.sin(a) * r * 0.24;
    g.strokeStyle = 'rgba(18, 48, 58, 0.5)';
    g.beginPath();
    g.moveTo(x0, y0);
    g.lineTo(x1, y1);
    g.stroke();
  }

  // this pen's pins
  for (const d of pen.defects ?? []) {
    if (!('bearing_deg' in d)) continue;
    const a = ((d.bearing_deg + 90) / 360) * Math.PI * 2;
    const dep = Math.min(1, d.depth_m / pen.net_depth_m);
    const x = cx + Math.cos(a) * r * (1 - dep * 0.08);
    const y = cy + dep * hh * 0.46 + Math.sin(a) * r * 0.24 * (1 - dep * 0.2);
    g.fillStyle = 'rgba(245, 247, 250, 0.95)';
    g.beginPath();
    g.arc(x, y, 2.1, 0, Math.PI * 2);
    g.fill();
  }
}

export function gradeLine(pen: T.Pen): string {
  return `Grade ${pen.grade.letter} — ${pen.grade.label} · ${countWord(pen.open_defects, 'open defect', 'open defects')}`;
}

export class PensPage {
  private pens: T.Pen[] = [];
  private farms: T.Farm[] = [];
  private root: HTMLElement;
  private grid!: HTMLElement;
  private band!: HTMLElement;
  private stopEvents: import("../main").EventUnsubscribe;

  constructor(app: HTMLElement) {
    const { main } = buildShell(app, '/');
    this.root = main;
    this.stopEvents = onEvent((e) => this.onEvent(e));
    this.render();
  }

  teardown() { this.stopEvents.clear(); }

  private onEvent(e: Record<string, unknown>) {
    const kind = e.kind as string;
    if (kind === 'farm_erased') {
      this.farms = this.farms.filter(f => f.id !== e.farm_id);
      this.pens = this.pens.filter(p => p.farm_id !== e.farm_id);
      this.redraw();
      return;
    }
    // pins and grades may have changed on another device: refresh in place
    this.refresh();
    const copy = copyForEvent(e);
    if (copy) announce(copy);
  }

  private async refresh() {
    try {
      const [p, f] = await Promise.all([
        api.get<{ pens: T.Pen[] }>('/api/pens'),
        api.get<{ farms: T.Farm[] }>('/api/farms'),
      ]);
      this.pens = p.pens;
      this.farms = f.farms;
      this.redraw();
    } catch {}
  }

  private async render() {
    this.root.append(h('div', { class: 'gutters', style: 'padding-top:24px' },
      h('h1', { class: 'display-l', text: 'Pens' }),
    ));
    this.grid = h('div', { class: 'gutters pens-grid', style: 'margin-top:16px' });
    this.band = h('div', { class: 'gutters farms-band', id: 'farms-band' });
    this.root.append(this.grid, this.band);
    await this.refresh();
  }

  private openPenId(): string {
    try {
      const id = localStorage.getItem('pensight-open-pen');
      if (id && this.pens.some(p => p.id === id)) return id;
    } catch {}
    return 'skv-01';
  }

  private redraw() {
    const openId = this.openPenId();
    const cols = this.grid.children;
    for (const c of Array.from(cols)) c.remove();

    const open = this.pens.find(p => p.id === openId) ?? this.pens[0];
    if (open) this.grid.append(this.card(open, true));

    for (const pen of this.pens) {
      if (pen.id === open?.id) continue;
      this.grid.append(this.card(pen, false));
    }

    for (const c of Array.from(this.band.children)) c.remove();
    for (const farm of this.farms) {
      const row = h('div', { class: 'farm-row', id: 'farm-' + farm.id },
        h('span', { class: 'display-m', text: farm.name }),
        h('span', { class: 'muted', text: farm.sites.map(s => s.name).join(', ') }),
        h('button', {
          class: 'btn', 'aria-label': `Farm details: ${farm.name}`, text: 'Farm details',
          onclick: (e: Event) => this.openFarm(farm, e.currentTarget as HTMLElement),
        }),
      );
      this.band.append(row);
    }
  }

  private card(pen: T.Pen, wide: boolean): HTMLElement {
    const label = wide ? `Open pen ${pen.name}` : pen.name;
    const a = h('a', { class: 'pen-card' + (wide ? ' wide' : ''), href: '/pens/' + pen.id, 'aria-label': label });
    const canvas = document.createElement('canvas');
    canvas.setAttribute('aria-hidden', 'true');
    a.append(canvas);
    const scrim = h('div', { class: 'scrim' });
    a.append(
      scrim,
      h('div', { class: 'grade num', text: gradeLine(pen) }),
      h('div', { class: 'name', text: pen.name }),
      h('div', { class: 'arrow', 'aria-hidden': 'true', text: '→' }),
    );
    a.addEventListener('click', (e) => {
      try { localStorage.setItem('pensight-open-pen', pen.id); } catch {}
      // let the router handle the href
    });
    requestAnimationFrame(() => {
      const rect = a.getBoundingClientRect();
      const w = wide ? Math.max(320, rect.width) : Math.max(240, rect.width);
      const hh = wide ? 260 : Math.max(240, rect.height);
      drawStill(canvas, pen, w, hh);
    });
    return a;
  }

  private openFarm(farm: T.Farm, opener: HTMLElement) {
    openDialog({
      title: 'Farm details',
      body: (root) => {
        root.append(h('div', { class: 'display-m', text: farm.name }));
        const sites = h('div', { style: 'margin:10px 0' });
        for (const s of farm.sites) {
          sites.append(h('div', { class: 'muted' }, `${s.code} — ${s.name} (${s.latitude.toFixed(4)}, ${s.longitude.toFixed(4)})`));
        }
        root.append(sites);
        root.append(h('div', { class: 'num', text: `${farm.day_rate.amount} ${farm.day_rate.currency} per day` }));
        root.append(h('div', { style: 'margin-top:14px' },
          h('button', { class: 'btn', text: 'Erase farm', 'aria-label': 'Erase farm', onclick: (e: Event) => this.openErase(farm, e.currentTarget as HTMLElement) }),
        ));
      },
    }, opener);
  }

  private openErase(farm: T.Farm, opener: HTMLElement) {
    openDialog({
      title: 'Erase farm',
      initialFocus: 'cancel',
      body: (root) => {
        const box = h('input', { type: 'text', 'aria-label': 'Type the farm name to confirm' }) as HTMLInputElement;
        const err = h('div', { class: 'status' });
        const dlg = root.closest('dialog')!;
        const actions = h('div', { class: 'dialog-actions' },
          h('button', { class: 'btn', 'data-cancel': 'true', text: 'Cancel', onclick: () => closeDialogOf(dlg) }),
          h('button', {
            class: 'btn', text: 'Erase',
            onclick: async (e: Event) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.disabled = true;
              setStatus(err, 'Erasing…');
              try {
                await api.del('/api/farms/' + farm.id, { confirm_name: box.value });
                announce(`Erased ${farm.name}`);
                closeAllDialogs();
                this.refresh();
              } catch (err2) {
                btn.disabled = false;
                if (err2 instanceof ApiError) setStatus(err, err2.message, true);
                else if (err2 instanceof NetworkError) setStatus(err, err2.message, true);
              }
            },
          }),
        );
        root.append(box, err, actions);
      },
    }, opener);
  }
}
