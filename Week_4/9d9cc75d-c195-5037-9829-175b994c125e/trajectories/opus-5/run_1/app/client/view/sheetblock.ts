import { type ApiErrorBody, send } from '../api.js';
import { el } from '../dom.js';
import { planFor, type ChartPlanFull } from '../plan.js';
import type { FilterSpec, QueryResult, SheetSpec, SourceField } from '../../shared/types.js';
import { fieldInfos } from '../plan.js';
import { ChartView, type MarkInfo } from './chart.js';
import { renderTwin } from './table.js';
import { openDialog } from '../ui/dialog.js';

export interface QueryBody {
  filters: FilterSpec[];
  parameters: Record<string, unknown>;
  sets: Record<string, unknown[]>;
}

export interface SheetBlockOptions {
  sheetId: string;
  name: string;
  spec: () => SheetSpec;
  fields: () => SourceField[] | null;
  regionLabel?: string | null;
  height?: number;
  twinBehindToggle?: boolean;
  onNotice?: (notice: string | null) => void;
  onResult?: (result: QueryResult, plan: ChartPlanFull) => void;
  onSelect?: (mark: MarkInfo | null) => void;
}

export class SheetBlock {
  readonly root: HTMLElement;
  readonly viewRegion: HTMLElement;
  readonly twinRegion: HTMLElement;
  private readonly viewHost: HTMLElement;
  private readonly twinHost: HTMLElement;
  private readonly busyText: HTMLElement;
  private readonly chart: ChartView;
  private newestGen = 0;
  private lastResult: QueryResult | null = null;
  private lastPlan: ChartPlanFull | null = null;
  private highlightValues: { field: string; values: unknown[] } | null = null;

  constructor(private readonly options: SheetBlockOptions) {
    this.viewHost = el('div', { class: 'chart-card' });
    this.busyText = el('p', { class: 'busy', hidden: true, text: 'Updating...' });
    this.twinHost = el('div', { class: 'twin-card' });
    this.viewRegion = el('section', { role: 'region', 'aria-label': 'View', class: 'view-region' }, [
      this.busyText,
      this.viewHost,
    ]);
    this.twinRegion = el('section', { role: 'region', 'aria-label': 'Data table', class: 'twin-region' }, [this.twinHost]);

    if (options.regionLabel != null) {
      const toggle = el('button', {
        type: 'button',
        class: 'pill-button small',
        'aria-expanded': 'false',
        text: `Table for ${options.name}`,
      });
      const twinWrap = el('div', { class: 'twin-tucked' }, [this.twinRegion]);
      toggle.addEventListener('click', () => {
        const open = toggle.getAttribute('aria-expanded') === 'true';
        toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
        twinWrap.classList.toggle('shown', !open);
      });
      this.root = el('section', { role: 'region', 'aria-label': options.regionLabel, class: 'sheet-region', 'aria-busy': 'false' }, [
        el('h3', { class: 'sheet-region-title', text: options.name }),
        this.busyText,
        this.viewHost,
        toggle,
        twinWrap,
      ]);
    } else {
      this.root = el('div', { class: 'sheet-block' }, [this.viewRegion, this.twinRegion]);
    }

    this.chart = new ChartView(this.viewHost);
  }

  get result(): QueryResult | null {
    return this.lastResult;
  }

  get plan(): ChartPlanFull | null {
    return this.lastPlan;
  }

  get chartView(): ChartView {
    return this.chart;
  }

  setBusy(busy: boolean): void {
    this.root.setAttribute('aria-busy', busy ? 'true' : 'false');
    this.busyText.hidden = !busy;
  }

  setHighlight(highlight: { field: string; values: unknown[] } | null): void {
    this.highlightValues = highlight;
    if (this.lastResult !== null && this.lastPlan !== null) this.paint(this.lastResult, this.lastPlan);
  }

  nextGen(): number {
    this.newestGen += 1;
    return this.newestGen;
  }

  async run(gen: number, body: QueryBody): Promise<boolean> {
    this.setBusy(true);
    const res = await send<QueryResult & ApiErrorBody>(
      'POST',
      `/api/sheets/${this.options.sheetId}/query?gen=${gen}`,
      body,
    );
    // Latest selection wins: an answer for an older generation is dropped and the block stays busy.
    if (gen < this.newestGen) return false;
    if (res.status === 422 && res.data.error === 'view_refused') {
      this.setBusy(false);
      this.options.onNotice?.(res.data.message ?? null);
      return true;
    }
    if (res.status !== 200) {
      this.setBusy(false);
      this.options.onNotice?.(res.status >= 500 ? 'Something went wrong. Try again.' : null);
      return true;
    }
    const result = res.data;
    const plan = planFor(this.options.spec(), fieldInfos(this.options.fields()), result.chart);
    this.lastResult = result;
    this.lastPlan = plan;
    this.paint(result, plan);
    this.setBusy(false);
    this.options.onNotice?.(result.notices[0] ?? null);
    this.options.onResult?.(result, plan);
    return true;
  }

  private paint(result: QueryResult, plan: ChartPlanFull): void {
    this.chart.draw({
      result,
      plan,
      highlightValues: this.highlightValues,
      height: this.options.height,
      onSelect: (mark) => this.options.onSelect?.(mark),
      onMarkDetails: (mark) => {
        const dialog = openDialog({ name: 'Mark details', opener: null, bottomSheet: true });
        dialog.body.append(el('p', { text: mark.tooltip }));
        const close = el('button', { type: 'button', class: 'pill-button', text: 'Close' });
        close.addEventListener('click', () => dialog.close(null));
        dialog.body.append(close);
        close.focus();
      },
    });
    const highlightKeys = new Set<string>();
    if (this.highlightValues !== null) {
      this.chart.markElements.forEach((mark) => {
        if (mark.getAttribute('data-dim') !== 'true') highlightKeys.add(mark.getAttribute('data-mark') ?? '');
      });
    }
    renderTwin(this.twinHost, this.options.name, result, plan.primary, highlightKeys);
  }

  focusFirstMark(): void {
    this.chart.focusFirstMark();
  }
}
