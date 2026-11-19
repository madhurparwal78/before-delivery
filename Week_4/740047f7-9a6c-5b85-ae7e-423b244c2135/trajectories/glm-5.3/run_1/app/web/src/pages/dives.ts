// The Dives page: planning, forecast clearance, the dive clock and the track.

import { api, ApiError, NetworkError } from '../api';
import { h, clear, setStatus, clockFromSeconds, utcDate, utcTime, pad2 } from '../ui';
import { openDialog, closeDialogOf } from '../dialog';
import { buildShell } from '../main';
import * as T from '../types';

export class DivesPage {
  private root: HTMLElement;
  private dives: T.Dive[] = [];
  private pens: T.Pen[] = [];
  private selected: string | null = null;
  private detail!: HTMLElement;
  private timer = 0;

  constructor(app: HTMLElement) {
    const { main } = buildShell(app, '/dives');
    this.root = main;
    this.build();
    this.load();
    this.timer = window.setInterval(() => this.load(), 30000);
  }

  teardown() { clearInterval(this.timer); }

  private build() {
    this.root.append(h('div', { class: 'gutters', style: 'padding-top:24px; display:flex; gap:10px; align-items:center' },
      h('h1', { class: 'display-l', text: 'Dives' }),
      h('button', { class: 'btn', text: 'Plan dive', onclick: (e: Event) => this.openPlan(e.currentTarget as HTMLElement) }),
    ));
    const grid = h('div', { class: 'gutters', style: 'display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:16px' });
    if (window.matchMedia('(max-width: 1099px)').matches) grid.style.gridTemplateColumns = '1fr';
    this.listHost = h('div', { class: 'panel panel-pad' });
    this.detail = h('div', { class: 'panel panel-pad' });
    grid.append(this.listHost, this.detail);
    this.root.append(grid);
  }

  private listHost!: HTMLElement;

  private async load() {
    try {
      const [d, p] = await Promise.all([
        api.get<{ dives: T.Dive[] }>('/api/dives'),
        api.get<{ pens: T.Pen[] }>('/api/pens'),
      ]);
      this.dives = d.dives;
      this.pens = p.pens;
      if (!this.selected && this.dives.length) this.selected = this.dives[0].id;
      this.renderList();
      this.renderDetail();
    } catch {}
  }

  private penName(id: string): string {
    return this.pens.find(p => p.id === id)?.name ?? id;
  }

  private renderList() {
    clear(this.listHost);
    this.listHost.append(h('h2', { class: 'display-m', text: 'Dives', style: 'margin-bottom:8px' }));
    const list = h('div', { class: 'list', role: 'list', 'aria-label': 'Dives' });
    if (!this.dives.length) {
      this.listHost.append(h('div', { class: 'muted', text: 'No dives yet.' }));
      return;
    }
    for (const d of this.dives) {
      const row = h('button', {
        class: 'row', role: 'listitem',
        'aria-label': `${d.id}, ${this.penName(d.pen_id)}`,
        'aria-pressed': d.id === this.selected ? 'true' : 'false',
        onclick: () => { this.selected = d.id; this.renderList(); this.renderDetail(); },
      });
      row.append(h('span', { text: `${d.id} ${this.penName(d.pen_id)}` }),
        h('span', { class: 'meta num', text: d.status }));
      list.append(row);
    }
    this.listHost.append(list);
  }

  private openPlan(opener: HTMLElement) {
    openDialog({
      title: 'Plan dive',
      body: (root) => {
        const status = h('div', { class: 'status' });
        const pen = h('select', { 'aria-label': 'Pen' }) as HTMLSelectElement;
        for (const p of this.pens) pen.append(h('option', { value: p.id, text: p.name }));
        // default: next whole hour on the server clock
        api.get<{ server_now: string }>('/api/dives').then(res => {
          const now = new Date(res.server_now);
          const next = new Date(now.getTime() + 3600_000);
          next.setUTCMinutes(0, 0, 0);
          start.value = `${next.getUTCFullYear()}-${pad2(next.getUTCMonth() + 1)}-${pad2(next.getUTCDate())} ${pad2(next.getUTCHours())}:00`;
        }).catch(() => {});
        const start = h('input', { type: 'text', 'aria-label': 'Planned start (UTC)' }) as HTMLInputElement;
        const minutes = h('input', { type: 'text', value: '90', inputmode: 'numeric', 'aria-label': 'Planned minutes' }) as HTMLInputElement;
        const cert = h('input', { type: 'text', 'aria-label': 'Diver certificate number' }) as HTMLInputElement;

        const toIso = (v: string): string => {
          const m = v.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/);
          if (!m) return v;
          return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00Z`;
        };

        const dlg = root.closest('dialog')!;
        const plan = h('button', { class: 'btn primary', text: 'Plan', onclick: async (e: Event) => {
          const btn = e.currentTarget as HTMLButtonElement;
          btn.disabled = true;
          try {
            const res = await api.post<{ dive: T.Dive }>('/api/dives', {
              pen_id: pen.value,
              planned_start: toIso(start.value),
              planned_minutes: parseInt(minutes.value, 10),
              diver_certificate_no: cert.value,
            });
            this.selected = res.dive.id;
            closeDialogOf(dlg);
            await this.load();
          } catch (err) {
            btn.disabled = false;
            if (err instanceof ApiError) setStatus(status, err.fields ? Object.values(err.fields)[0] : err.message, true);
            else if (err instanceof NetworkError) setStatus(status, err.message, true);
          }
        }});
        root.append(
          h('div', { class: 'field' }, h('span', { class: 'label', text: 'Pen' }), pen),
          h('div', { class: 'field' }, h('span', { class: 'label', text: 'Planned start (UTC)' }), start),
          h('div', { class: 'field' }, h('span', { class: 'label', text: 'Planned minutes' }), minutes),
          h('div', { class: 'field' }, h('span', { class: 'label', text: 'Diver certificate number' }), cert),
          status,
          h('div', { class: 'dialog-actions' },
            h('button', { class: 'btn', 'data-cancel': 'true', text: 'Cancel', onclick: () => closeDialogOf(dlg) }),
            plan),
        );
      },
    }, opener);
  }

  // ---------- detail ----------

  private renderDetail() {
    clear(this.detail);
    const dive = this.dives.find(d => d.id === this.selected);
    if (!dive) {
      this.detail.append(h('div', { class: 'muted', text: 'No dive selected.' }));
      return;
    }
    const diveStatus = h('div', { class: 'status num', role: 'status', 'aria-label': 'Dive status', text: `Dive status: ${dive.status}` });
    const clearanceStatus = h('div', { class: 'status num', role: 'status', 'aria-label': 'Clearance status' });

    this.detail.append(
      h('h2', { class: 'display-m', text: `${dive.id} — ${this.penName(dive.pen_id)}` }),
      diveStatus,
      h('div', { class: 'muted num' }, `Planned start ${utcDate(dive.planned_start)} ${utcTime(dive.planned_start)} · ${dive.planned_minutes} min`),
    );

    if (dive.clearance) {
      setStatus(clearanceStatus, dive.clearance.message);
      const table = h('table', { 'aria-label': 'Forecast hours' });
      table.append(h('tr', {}, h('th', { text: 'Time' }), h('th', { class: 'num', text: 'Current (m/s)' }), h('th', { class: 'num', text: 'Wave (m)' }), h('th', { text: 'Within limits' })));
      for (const hour of dive.clearance.hours) {
        table.append(h('tr', {},
          h('td', { class: 'num', text: hour.time }),
          h('td', { class: 'num', text: hour.current_m_s.toFixed(2) }),
          h('td', { class: 'num', text: hour.wave_m.toFixed(2) }),
          h('td', { text: hour.within_limits ? 'yes' : 'no' }),
        ));
      }
      this.detail.append(clearanceStatus, table);
    } else {
      this.detail.append(clearanceStatus);
    }

    // dive clock
    if (dive.status === 'started' && dive.started_at) {
      const clock = h('div', { class: 'display-l num', role: 'timer', 'aria-label': 'Dive clock' });
      const startMs = new Date(dive.started_at).getTime();
      const base = dive.elapsed_s ?? 0;
      const tick = () => {
        const elapsed = base + (Date.now() - (startMs + base * 1000)) / 1000;
        clock.textContent = clockFromSeconds(elapsed);
      };
      tick();
      this.clockTimer = window.setInterval(tick, 1000);
      this.detail.append(clock);
    }

    // actions
    const actions = h('div', { style: 'display:flex;gap:8px;flex-wrap:wrap;margin-top:12px' });
    const check = h('button', { class: 'btn', text: 'Check forecast' });
    const start = h('button', { class: 'btn', text: 'Start dive' });
    const finish = h('button', { class: 'btn', text: 'Finish dive' });
    const attach = h('button', { class: 'btn', text: 'Attach sonar capture' });
    start.disabled = dive.status !== 'cleared';
    finish.disabled = dive.status !== 'started';
    attach.disabled = !(dive.status === 'started' || dive.status === 'recorded');

    check.addEventListener('click', async () => {
      check.disabled = true;
      setStatus(clearanceStatus, 'Checking forecast…');
      try {
        await api.post(`/api/dives/${dive.id}/clearance`);
        await this.load();
      } catch (err) {
        check.disabled = false;
        if (err instanceof ApiError) setStatus(clearanceStatus, err.message, true);
        else if (err instanceof NetworkError) setStatus(clearanceStatus, err.message, true);
      }
    });
    start.addEventListener('click', async () => {
      start.disabled = true;
      setStatus(clearanceStatus, 'Starting dive…');
      try {
        await api.post(`/api/dives/${dive.id}/start`);
        await this.load();
      } catch (err) {
        start.disabled = false;
        if (err instanceof ApiError) setStatus(clearanceStatus, err.message, true);
      }
    });
    const track = h('textarea', { 'aria-label': 'Track samples', rows: 6, style: 'width:100%' }) as HTMLTextAreaElement;
    track.value = dive.track.map(s => `${s.t_s},${s.bearing_deg},${s.depth_m}`).join('\n');
    finish.addEventListener('click', async () => {
      finish.disabled = true;
      setStatus(clearanceStatus, 'Finishing dive…');
      const samples: { t_s: number; bearing_deg: number; depth_m: number }[] = [];
      let bad = false;
      for (const line of track.value.split('\n')) {
        if (!line.trim()) continue;
        const parts = line.split(',');
        if (parts.length !== 3) { bad = true; continue; }
        samples.push({ t_s: Number(parts[0]), bearing_deg: Number(parts[1]), depth_m: Number(parts[2]) });
      }
      if (bad) { finish.disabled = false; setStatus(clearanceStatus, 'Track row is invalid', true); return; }
      try {
        await api.post(`/api/dives/${dive.id}/finish`, { track: samples });
        await this.load();
      } catch (err) {
        finish.disabled = false;
        if (err instanceof ApiError) setStatus(clearanceStatus, err.message, true);
      }
    });
    attach.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.addEventListener('change', async () => {
        const file = input.files?.[0];
        if (!file) return;
        attach.disabled = true;
        setStatus(clearanceStatus, 'Uploading sonar capture…');
        try {
          const res = await api.upload<{ capture: T.SonarCapture }>(`/api/dives/${dive.id}/sonar`, file, file.name);
          setStatus(clearanceStatus, `Attached sonar capture ${res.capture.id}`);
          this.scheduleEditorStatusReset(clearanceStatus);
          await this.load();
        } catch (err) {
          attach.disabled = false;
          setStatus(clearanceStatus, err instanceof ApiError ? err.message : 'Upload failed', true);
        }
      });
      input.click();
    });
    actions.append(check, start, finish, attach);
    this.detail.append(actions, h('div', { class: 'field', style: 'margin-top:10px' }, h('span', { class: 'label', text: 'Track samples' }), track));

    // track table
    if (dive.track.length) {
      const ttable = h('table', { 'aria-label': 'Track' });
      ttable.append(h('tr', {}, h('th', { class: 'num', text: 't (s)' }), h('th', { class: 'num', text: 'Bearing (°)' }), h('th', { class: 'num', text: 'Depth (m)' })));
      for (const s of dive.track) {
        ttable.append(h('tr', {},
          h('td', { class: 'num', text: String(s.t_s) }),
          h('td', { class: 'num', text: s.bearing_deg.toFixed(1) }),
          h('td', { class: 'num', text: s.depth_m.toFixed(1) })));
      }
      this.detail.append(h('h3', { class: 'display-m', text: 'Track', style: 'margin-top:14px' }), ttable);
    }

    // sonar captures
    if (dive.sonar.length) {
      this.detail.append(h('h3', { class: 'display-m', text: 'Sonar captures', style: 'margin-top:14px' }));
      for (const s of dive.sonar) {
        this.detail.append(h('div', {},
          h('a', { href: `/api/sonar/${s.id}/raw`, download: s.file_name, 'aria-label': `Download sonar ${s.id}`, text: `Download sonar ${s.id}` })));
      }
    }
  }

  private clockTimer = 0;
  private toastTimer = 0;

  private scheduleEditorStatusReset(status: HTMLElement) {
    clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => { status.textContent = ''; }, 6000);
  }

  teardownExtra() { clearInterval(this.clockTimer); }
}
