// The Imports page: farm picker, CSV upload, the five summary tables and past imports.

import { api, ApiError, NetworkError } from '../api';
import { h, clear, setStatus, utcStamp } from '../ui';
import { buildShell, onEvent } from '../main';
import * as T from '../types';

export class ImportsPage {
  private root: HTMLElement;
  private farms: T.Farm[] = [];
  private farmId = 'skarvholmen';
  private imports: T.Import[] = [];
  private status!: HTMLElement;
  private tablesHost!: HTMLElement;
  private listHost!: HTMLElement;
  private fileInput: HTMLInputElement;
  private stopEvents: import("../main").EventUnsubscribe;

  constructor(app: HTMLElement) {
    const { main } = buildShell(app, '/imports');
    this.root = main;
    this.fileInput = document.createElement('input');
    this.fileInput.type = 'file';
    this.fileInput.accept = '.csv,text/csv';
    this.stopEvents = onEvent((e) => {
      if (e.kind === 'imported' && e.farm_id === this.farmId) {
        // the other device's import joins the list in place within 3 seconds
        this.load(false);
      }
    });
    this.build();
    this.load(true);
  }

  teardown() { this.stopEvents.clear(); }

  private build() {
    const head = h('div', { class: 'gutters', style: 'padding-top:24px' },
      h('h1', { class: 'display-l', text: 'Imports' }));
    const bar = h('div', { class: 'gutters', style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;align-items:center' });
    const farmSel = h('select', { 'aria-label': 'Farm' }) as HTMLSelectElement;
    farmSel.addEventListener('change', () => { this.farmId = farmSel.value; this.load(true); });
    this.farmSel = farmSel;
    const choose = h('button', { class: 'btn', text: 'Choose legacy CSV', onclick: () => this.fileInput.click() });
    const importBtn = h('button', { class: 'btn primary', text: 'Import', onclick: () => this.runImport() });
    this.status = h('div', { class: 'status num', role: 'status', 'aria-label': 'Import status' });
    bar.append(farmSel, choose, importBtn, this.status);

    this.fileInput.addEventListener('change', () => {
      if (this.fileInput.files?.[0]) {
        setStatus(this.status, this.fileInput.files[0].name);
      }
    });

    this.root.append(head, bar);
    this.tablesHost = h('div', { class: 'gutters', style: 'display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-top:16px' });
    if (window.matchMedia('(max-width: 1099px)').matches) {
      this.tablesHost.style.gridTemplateColumns = 'repeat(2,1fr)';
    }
    if (window.matchMedia('(max-width: 599px)').matches) {
      this.tablesHost.style.gridTemplateColumns = '1fr';
    }
    this.root.append(this.tablesHost);
    this.listHost = h('div', { class: 'gutters', style: 'margin-top:20px' });
    this.root.append(this.listHost);
  }

  private farmSel!: HTMLSelectElement;

  private async load(withFarms: boolean) {
    try {
      if (withFarms) {
        const f = await api.get<{ farms: T.Farm[] }>('/api/farms');
        this.farms = f.farms;
        clear(this.farmSel);
        for (const farm of this.farms) {
          const o = h('option', { value: farm.id, text: farm.name }) as HTMLOptionElement;
          if (farm.id === this.farmId) o.selected = true;
          this.farmSel.append(o);
        }
      }
      const res = await api.get<{ imports: T.Import[] }>(`/api/farms/${this.farmId}/imports`);
      // newest first
      this.imports = res.imports;
      this.renderTables();
      this.renderList();
    } catch (e) {
      if (e instanceof NetworkError) setStatus(this.status, e.message, true);
    }
  }

  private renderTables() {
    clear(this.tablesHost);
    const latest = this.imports[0];
    const mk = (name: string, rows: T.ImportRow[]) => {
      const panel = h('div', { class: 'panel panel-pad' });
      panel.append(h('h3', { class: 'display-m', text: name, style: 'margin-bottom:6px' }));
      const table = h('table');
      table.append(h('tr', {}, h('th', { class: 'num', text: 'Row' }), h('th', { text: 'Defect' })));
      if (!rows.length) table.append(h('tr', {}, h('td', { colspan: '2', class: 'muted', text: '—' })));
      for (const r of rows) {
        table.append(h('tr', {},
          h('td', { class: 'num', text: String(r.row) }),
          h('td', { text: r.defect_id ?? r.site_code ?? r.reason ?? '' })));
      }
      panel.append(table);
      return panel;
    };
    if (!latest) {
      this.tablesHost.append(h('div', { class: 'muted', text: 'No imports yet.' }));
      return;
    }
    this.tablesHost.append(
      mk('Created', latest.created),
      mk('Merged', latest.merged),
      mk('Already imported', latest.already_imported),
      mk('Orphans', latest.orphans),
      mk('Invalid', latest.invalid),
    );
  }

  private renderList() {
    clear(this.listHost);
    this.listHost.append(h('h2', { class: 'display-m', text: 'Past imports', style: 'margin-bottom:8px' }));
    for (const imp of this.imports) {
      const row = h('div', { class: 'farm-row' },
        h('span', { class: 'num', text: `${utcStamp(imp.imported_at)} — ${imp.file_name} (${imp.rows} rows)` }),
        h('a', { href: `/api/imports/${imp.id}/raw`, download: imp.file_name, 'aria-label': `Download original ${imp.file_name}`, text: `Download original ${imp.file_name}` }),
      );
      this.listHost.append(row);
    }
  }

  private importSeq = 0;

  private async runImport() {
    const file = this.fileInput.files?.[0];
    if (!file) {
      setStatus(this.status, 'Choose a legacy CSV first', true);
      return;
    }
    const seq = ++this.importSeq;
    setStatus(this.status, 'Importing…');
    try {
      const res = await api.upload<{ import: T.Import; replayed: boolean }>(`/api/farms/${this.farmId}/imports`, file, file.name);
      if (seq !== this.importSeq) return;   // a newer press has finished
      if (res.replayed) {
        setStatus(this.status, 'Already imported — nothing new created');
      } else {
        const imp = res.import;
        setStatus(this.status, `Imported ${imp.file_name}: ${imp.created.length} created, ${imp.merged.length} merged, ${imp.already_imported.length} already imported, ${imp.orphans.length} orphans, ${imp.invalid.length} invalid`);
      }
      await this.load(false);
    } catch (err) {
      if (seq !== this.importSeq) return;
      if (err instanceof ApiError) setStatus(this.status, err.message, true);
      else if (err instanceof NetworkError) setStatus(this.status, err.message, true);
    }
  }
}
