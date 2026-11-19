import {
  categoricalColor,
  categoricalPattern,
  markShape,
  PATTERNS,
  rgbCss,
  sequentialColor,
  tickLabel,
  tickScale,
} from '../../shared/chart.js';
import { dataValue, displayNumber, displayShare, displayValue } from '../../shared/display.js';
import { isShareColumn } from '../../shared/twin.js';
import type { QueryResult } from '../../shared/types.js';
import type { PlanDim, PlanMeasure } from '../../shared/viewplan.js';
import { clear, el, isPhone, reducedMotion, svg } from '../dom.js';

export interface ChartPlan {
  dims: PlanDim[];
  measures: PlanMeasure[];
  primary: number;
}

export interface MarkInfo {
  key: string;
  dims: (string | number | boolean | null)[];
  values: (string | number | boolean | null)[];
  tooltip: string;
  index: number;
}

export interface ChartOptions {
  result: QueryResult;
  plan: ChartPlan;
  highlightValues?: { field: string; values: unknown[] } | null;
  onSelect?: (mark: MarkInfo | null) => void;
  onMarkDetails?: (mark: MarkInfo) => void;
  height?: number;
}

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

const PLUM = 'rgb(26, 10, 20)';

function dimensionCount(result: QueryResult): number {
  return result.columns.filter((c) => c.role === 'dimension').length;
}

function markDims(result: QueryResult, row: (string | number | boolean | null)[]): (string | number | boolean | null)[] {
  return row.slice(0, dimensionCount(result));
}

function markMeasures(result: QueryResult, row: (string | number | boolean | null)[]): (string | number | boolean | null)[] {
  return row.slice(dimensionCount(result));
}

function measureIsShare(result: QueryResult, index: number): boolean {
  const column = result.columns.filter((c) => c.role === 'measure')[index];
  return column !== undefined && isShareColumn(column.name);
}

export function markKey(dims: (string | number | boolean | null)[]): string {
  return dims.length === 0 ? 'all' : dims.map((d) => displayValue(d)).join(' | ');
}

export function tooltipText(result: QueryResult, row: (string | number | boolean | null)[]): string {
  return result.columns
    .map((column, index) => {
      const value = row[index];
      const share = column.role === 'measure' && isShareColumn(column.name);
      return `${column.name}: ${typeof value === 'number' && share ? displayShare(value) : displayValue(value)}`;
    })
    .join('; ');
}

function patternDef(defs: SVGDefsElement, color: string, pattern: string): string {
  const id = `pat-${pattern}-${color.replace(/[^0-9]/g, '-')}`;
  if (defs.querySelector(`[id="${id}"]`) !== null) return id;
  const node = svg('pattern', { id, width: 8, height: 8, patternUnits: 'userSpaceOnUse' });
  node.append(svg('rect', { x: 0, y: 0, width: 8, height: 8, fill: rgbCss(color) }));
  if (pattern === 'dots') node.append(svg('circle', { cx: 4, cy: 4, r: 1.6, fill: PLUM }));
  if (pattern === 'stripes') node.append(svg('path', { d: 'M0 8 L8 0', stroke: PLUM, 'stroke-width': 1.6, fill: 'none' }));
  if (pattern === 'checks') {
    node.append(svg('rect', { x: 0, y: 0, width: 4, height: 4, fill: PLUM }));
    node.append(svg('rect', { x: 4, y: 4, width: 4, height: 4, fill: PLUM }));
  }
  if (pattern === 'rings') node.append(svg('circle', { cx: 4, cy: 4, r: 2.4, fill: 'none', stroke: PLUM, 'stroke-width': 1.2 }));
  defs.append(node);
  return id;
}

export class ChartView {
  private tooltip: HTMLElement | null = null;
  private marks: SVGGraphicsElement[] = [];
  private geometry = new Map<string, Geometry>();
  private selectedKey: string | null = null;
  private focusKey: string | null = null;
  private options: ChartOptions | null = null;

  constructor(private readonly host: HTMLElement) {}

  get selected(): string | null {
    return this.selectedKey;
  }

  clearSelection(): void {
    this.selectedKey = null;
    this.marks.forEach((mark) => mark.setAttribute('aria-pressed', 'false'));
    this.hideTooltip();
  }

  draw(options: ChartOptions): void {
    const previous = new Map(this.geometry);
    this.options = options;
    this.geometry = new Map();
    this.marks = [];
    this.tooltip = null;
    clear(this.host);

    const { result, plan } = options;
    if (result.chart === 'none') {
      this.host.append(el('p', { class: 'empty-headline', text: 'Place a field on Rows or Columns.' }));
      return;
    }

    const width = Math.max(260, this.host.clientWidth || 640);
    const rowsDims = plan.dims.filter((d) => d.shelf === 'rows');
    const horizontalBars = result.chart === 'bar' && rowsDims.length > 0;
    const banded = horizontalBars || result.chart === 'text_table' || result.chart === 'heat_map';
    const minBand = isPhone() ? 44 : 26;

    const colorDim = plan.dims.findIndex((d) => d.shelf === 'color');
    const colorMeasure = plan.measures.findIndex((m) => m.shelf === 'color');
    const stacked = result.chart === 'bar' && colorDim >= 0;

    const bandOf = (row: (string | number | boolean | null)[]): string => {
      const dims = markDims(result, row);
      return plan.dims
        .map((d, i) => (d.shelf === 'color' ? null : displayValue(dims[i])))
        .filter((v): v is string => v !== null)
        .join(' | ');
    };
    const bandKeys: string[] = [];
    for (const row of result.rows) {
      const key = bandOf(row);
      if (!bandKeys.includes(key)) bandKeys.push(key);
    }

    let height = options.height ?? 360;
    if (banded) height = Math.max(height, bandKeys.length * minBand + 72);

    const root = svg('svg', { class: 'chart', width, height, viewBox: `0 0 ${width} ${height}`, role: 'presentation' });
    const defs = svg('defs');
    root.append(defs);
    const plotLeft = banded ? 130 : 84;
    const plot = { x: plotLeft, y: 16, w: Math.max(80, width - plotLeft - 20), h: Math.max(60, height - 56) };
    root.append(
      svg('rect', {
        'data-plot': 'true',
        x: plot.x,
        y: plot.y,
        width: plot.w,
        height: plot.h,
        fill: 'rgba(255,255,255,0)',
        stroke: 'rgba(26,10,20,0.14)',
      }),
    );

    const primary = plan.primary;
    const values = result.rows.map((row) => {
      const v = markMeasures(result, row)[primary];
      return typeof v === 'number' ? v : null;
    });
    const colorValues = result.rows.map((row) => {
      const v = colorMeasure >= 0 ? markMeasures(result, row)[colorMeasure] : null;
      return typeof v === 'number' ? v : null;
    });
    const colorMembers: string[] = [];
    if (colorDim >= 0) {
      for (const row of result.rows) {
        const member = displayValue(markDims(result, row)[colorDim]);
        if (!colorMembers.includes(member)) colorMembers.push(member);
      }
    }

    const axisValues = stacked
      ? bandKeys.map((band) => result.rows.reduce((sum, row, i) => (bandOf(row) === band ? sum + (values[i] ?? 0) : sum), 0))
      : values;
    const scale = tickScale(axisValues);
    const span = scale.last - scale.first;
    const ratioOf = (v: number): number => (span === 0 ? 0 : (v - scale.first) / span);

    const columnsMeasure = plan.measures.findIndex((m) => m.shelf === 'columns');
    const xValues = result.rows.map((row) => {
      const v = columnsMeasure >= 0 ? markMeasures(result, row)[columnsMeasure] : null;
      return typeof v === 'number' ? v : null;
    });
    const xScale = tickScale(xValues);
    const xSpan = xScale.last - xScale.first;
    const xRatio = (v: number): number => (xSpan === 0 ? 0 : (v - xScale.first) / xSpan);

    const valueAxisAcross = horizontalBars || result.chart === 'scatter';
    if (result.chart === 'bar' || result.chart === 'line' || result.chart === 'scatter') {
      for (const tick of scale.ticks) {
        if (valueAxisAcross && horizontalBars) {
          const x = plot.x + ratioOf(tick) * plot.w;
          root.append(svg('line', { x1: x, y1: plot.y, x2: x, y2: plot.y + plot.h, stroke: 'rgba(26,10,20,0.1)' }));
          root.append(
            svg('text', { 'data-tick': tickLabel(tick), x, y: plot.y + plot.h + 20, 'text-anchor': 'middle', class: 'tick' }, [
              tickLabel(tick),
            ]),
          );
          continue;
        }
        const y = plot.y + plot.h - ratioOf(tick) * plot.h;
        root.append(svg('line', { x1: plot.x, y1: y, x2: plot.x + plot.w, y2: y, stroke: 'rgba(26,10,20,0.1)' }));
        root.append(
          svg('text', { 'data-tick': tickLabel(tick), x: plot.x - 10, y: y + 4, 'text-anchor': 'end', class: 'tick' }, [
            tickLabel(tick),
          ]),
        );
      }
      if (result.chart === 'scatter') {
        for (const tick of xScale.ticks) {
          const x = plot.x + xRatio(tick) * plot.w;
          root.append(
            svg('text', { 'data-tick': tickLabel(tick), x, y: plot.y + plot.h + 20, 'text-anchor': 'middle', class: 'tick' }, [
              tickLabel(tick),
            ]),
          );
        }
      }
    }

    const columnDimIndex = plan.dims.findIndex((d) => d.shelf === 'columns');
    const columnMembers: string[] = [];
    if (columnDimIndex >= 0) {
      for (const row of result.rows) {
        const member = displayValue(markDims(result, row)[columnDimIndex]);
        if (!columnMembers.includes(member)) columnMembers.push(member);
      }
    }
    const rowBandKeys: string[] = [];
    if (result.chart === 'heat_map' || result.chart === 'text_table') {
      for (const row of result.rows) {
        const dims = markDims(result, row);
        const key = plan.dims
          .map((d, i) => (d.shelf === 'rows' ? displayValue(dims[i]) : null))
          .filter((v): v is string => v !== null)
          .join(' | ');
        if (!rowBandKeys.includes(key)) rowBandKeys.push(key);
      }
    }

    const bandCount = Math.max(1, banded ? bandKeys.length : bandKeys.length);
    const bandSize = banded ? plot.h / bandCount : plot.w / bandCount;
    const shape = markShape(result.chart);
    const captions = plan.measures.map((m) => m.caption);
    const primaryCaption = primary >= 0 ? captions[primary] : '';
    const share = measureIsShare(result, primary);
    const stackOffsets = new Map<string, number>();
    const gridColumns = Math.max(1, columnMembers.length);
    const gridRows = Math.max(1, rowBandKeys.length);

    result.rows.forEach((row, index) => {
      const dims = markDims(result, row);
      const measures = markMeasures(result, row);
      const key = markKey(dims);
      const value = values[index];
      const band = bandKeys.indexOf(bandOf(row));
      const colorIndex = colorDim >= 0 ? colorMembers.indexOf(displayValue(dims[colorDim])) : 0;
      const present = colorValues.filter((v): v is number => v !== null);
      const color =
        colorMeasure >= 0
          ? sequentialColor(colorValues[index], present.length === 0 ? 0 : Math.min(...present), present.length === 0 ? 0 : Math.max(...present))
          : categoricalColor(colorIndex);
      const pattern = colorMeasure >= 0 ? PATTERNS[0] : categoricalPattern(colorIndex);
      const display = value === null ? '(null)' : share ? displayShare(value) : displayNumber(value);

      let node: SVGGraphicsElement;
      let geo: Geometry;
      if (result.chart === 'bar') {
        const thickness = Math.max(6, bandSize * 0.68);
        const base = stackOffsets.get(bandOf(row)) ?? 0;
        const from = stacked ? base : 0;
        const to = stacked ? base + (value ?? 0) : value ?? 0;
        if (stacked) stackOffsets.set(bandOf(row), to);
        if (horizontalBars) {
          const y = plot.y + band * bandSize + (bandSize - thickness) / 2;
          const x0 = plot.x + ratioOf(Math.min(from, to)) * plot.w;
          const x1 = plot.x + ratioOf(Math.max(from, to)) * plot.w;
          geo = { x: x0, y, w: Math.max(0, x1 - x0), h: thickness };
        } else {
          const x = plot.x + band * bandSize + (bandSize - thickness) / 2;
          const y0 = plot.y + plot.h - ratioOf(Math.max(from, to)) * plot.h;
          const y1 = plot.y + plot.h - ratioOf(Math.min(from, to)) * plot.h;
          geo = { x, y: y0, w: thickness, h: Math.max(0, y1 - y0) };
        }
        node = svg('rect', { x: geo.x, y: geo.y, width: geo.w, height: geo.h });
      } else if (result.chart === 'line' || result.chart === 'scatter') {
        const cx =
          result.chart === 'scatter'
            ? plot.x + xRatio(xValues[index] ?? xScale.first) * plot.w
            : plot.x + band * bandSize + bandSize / 2;
        const cy = plot.y + plot.h - ratioOf(value ?? scale.first) * plot.h;
        const radius = isPhone() ? 11 : 7;
        geo = { x: cx - radius, y: cy - radius, w: radius * 2, h: radius * 2 };
        node = svg('circle', { cx, cy, r: radius });
      } else if (result.chart === 'heat_map') {
        const dimsText = markDims(result, row);
        const column = columnDimIndex >= 0 ? columnMembers.indexOf(displayValue(dimsText[columnDimIndex])) : 0;
        const rowKey = plan.dims
          .map((d, i) => (d.shelf === 'rows' ? displayValue(dimsText[i]) : null))
          .filter((v): v is string => v !== null)
          .join(' | ');
        const rowBand = Math.max(0, rowBandKeys.indexOf(rowKey));
        const cellWidth = plot.w / gridColumns;
        const cellHeight = plot.h / gridRows;
        geo = {
          x: plot.x + column * cellWidth + 2,
          y: plot.y + rowBand * cellHeight + 2,
          w: Math.max(10, cellWidth - 4),
          h: Math.max(10, cellHeight - 4),
        };
        node = svg('rect', { x: geo.x, y: geo.y, width: geo.w, height: geo.h });
      } else {
        const y = plot.y + band * bandSize + bandSize / 2;
        geo = { x: plot.x + 8, y: y - 12, w: Math.max(44, plot.w - 16), h: Math.max(24, bandSize) };
        node = svg('text', { x: plot.x + 8, y: y + 5, class: 'mark-text' }, [display]);
      }

      if (result.chart === 'text_table') {
        node.setAttribute('fill', PLUM);
      } else if (color === '') {
        node.setAttribute('fill', 'none');
        node.setAttribute('stroke', PLUM);
        node.setAttribute('stroke-width', '1.5');
      } else {
        const patternId = pattern === 'solid' ? null : patternDef(defs, color, pattern);
        node.setAttribute('fill', patternId === null ? rgbCss(color) : `url(#${patternId})`);
        node.setAttribute('stroke', PLUM);
        node.setAttribute('stroke-width', '1.5');
      }

      const labelDims = dims.map((d) => displayValue(d)).join(', ');
      node.setAttribute('role', 'button');
      node.setAttribute('tabindex', '-1');
      node.setAttribute('data-mark', key);
      node.setAttribute('data-dims', key);
      node.setAttribute('data-measure', primaryCaption);
      node.setAttribute('data-value', value === null ? '' : dataValue(value));
      node.setAttribute('data-color', color);
      node.setAttribute('data-pattern', pattern);
      node.setAttribute('aria-pressed', 'false');
      node.setAttribute(
        'aria-label',
        `${labelDims === '' ? '' : `${labelDims}, `}${primaryCaption} ${display}, ${shape} ${index + 1} of ${result.rows.length}`,
      );
      node.classList.add('mark');

      const highlight = options.highlightValues ?? null;
      if (highlight !== null) {
        const dimIndex = plan.dims.findIndex((d) => d.field === highlight.field);
        const matches =
          dimIndex >= 0 &&
          highlight.values.some((v) => displayValue(v as string | number | boolean | null) === displayValue(dims[dimIndex]));
        if (!matches) node.setAttribute('data-dim', 'true');
      }

      const info: MarkInfo = { key, dims, values: measures, tooltip: tooltipText(result, row), index };
      this.bindMark(node, info);
      this.geometry.set(key, geo);
      this.marks.push(node);
      root.append(node);
    });

    if (result.chart === 'line' && this.marks.length > 1) {
      const points = this.marks.map((mark) => ({
        x: Number(mark.getAttribute('cx') ?? 0),
        y: Number(mark.getAttribute('cy') ?? 0),
      }));
      const path = svg('path', {
        d: points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join(' '),
        fill: 'none',
        stroke: rgbCss(categoricalColor(0)),
        'stroke-width': 2.5,
      });
      root.insertBefore(path, this.marks[0]);
    }

    for (const line of result.reference_lines) {
      if (line.value === null) continue;
      const ratio = ratioOf(line.value);
      if (horizontalBars) {
        const x = plot.x + ratio * plot.w;
        root.append(
          svg('line', { 'data-ref': line.type, x1: x, y1: plot.y, x2: x, y2: plot.y + plot.h, stroke: PLUM, 'stroke-dasharray': '6 4' }),
        );
      } else {
        const y = plot.y + plot.h - ratio * plot.h;
        root.append(
          svg('line', { 'data-ref': line.type, x1: plot.x, y1: y, x2: plot.x + plot.w, y2: y, stroke: PLUM, 'stroke-dasharray': '6 4' }),
        );
      }
    }

    if (result.trend !== null && result.rows.length > 1) {
      const trend = result.trend;
      const lastIndex = result.rows.length - 1;
      const atX = (i: number): number =>
        result.chart === 'scatter' ? plot.x + xRatio(xValues[i] ?? xScale.first) * plot.w : plot.x + i * bandSize + bandSize / 2;
      const atValue = (i: number): number =>
        result.chart === 'scatter'
          ? trend.intercept + trend.slope * (xValues[i] ?? 0)
          : trend.intercept + trend.slope * i;
      root.append(
        svg('line', {
          'data-trend': 'true',
          x1: atX(0),
          y1: plot.y + plot.h - ratioOf(atValue(0)) * plot.h,
          x2: atX(lastIndex),
          y2: plot.y + plot.h - ratioOf(atValue(lastIndex)) * plot.h,
          stroke: PLUM,
          'stroke-dasharray': '2 4',
        }),
      );
    }

    bandKeys.forEach((band, index) => {
      if (banded) {
        root.append(
          svg('text', { x: plot.x - 10, y: plot.y + index * bandSize + bandSize / 2 + 4, 'text-anchor': 'end', class: 'band-label' }, [
            band,
          ]),
        );
      } else if (result.chart !== 'scatter') {
        root.append(
          svg('text', { x: plot.x + index * bandSize + bandSize / 2, y: plot.y + plot.h + 20, 'text-anchor': 'middle', class: 'band-label' }, [
            band,
          ]),
        );
      }
    });

    root.addEventListener('pointerdown', (event) => {
      const target = event.target as Element;
      if (target.classList.contains('mark')) return;
      this.clearSelection();
      options.onSelect?.(null);
    });

    this.host.append(root);

    const legendItems: string[] = [];
    if (colorMeasure >= 0) {
      const present = colorValues.filter((v): v is number => v !== null);
      if (present.length > 0) legendItems.push(`${displayNumber(Math.min(...present))} to ${displayNumber(Math.max(...present))}`);
    } else if (colorDim >= 0) {
      legendItems.push(...colorMembers);
    }
    if (legendItems.length > 0) {
      const list = el('ul', { class: 'legend', 'aria-label': 'Legend' });
      legendItems.forEach((item, index) => {
        const swatch = el('span', { class: 'legend-swatch' });
        swatch.style.background = rgbCss(colorMeasure >= 0 ? categoricalColor(0) : categoricalColor(index));
        list.append(el('li', {}, [swatch, el('span', { text: item })]));
      });
      this.host.append(list);
    }

    if (this.marks.length > 0) {
      const selected = this.marks.find((mark) => mark.getAttribute('data-mark') === this.selectedKey);
      selected?.setAttribute('aria-pressed', 'true');
      const focusTarget = this.marks.find((mark) => mark.getAttribute('data-mark') === this.focusKey) ?? this.marks[0];
      focusTarget.setAttribute('tabindex', '0');
    }
    this.glide(previous);
  }

  private glide(previous: Map<string, Geometry>): void {
    if (reducedMotion()) return;
    for (const mark of this.marks) {
      const key = mark.getAttribute('data-mark') ?? '';
      const before = previous.get(key);
      const after = this.geometry.get(key);
      if (before === undefined || after === undefined) continue;
      if (before.x === after.x && before.y === after.y && before.w === after.w && before.h === after.h) continue;
      const scaleX = after.w === 0 ? 1 : before.w / after.w;
      const scaleY = after.h === 0 ? 1 : before.h / after.h;
      mark.animate(
        [
          { transform: `translate(${before.x - after.x}px, ${before.y - after.y}px) scale(${scaleX}, ${scaleY})` },
          { transform: 'translate(0px, 0px) scale(1, 1)' },
        ],
        { duration: 240, easing: 'cubic-bezier(0.2, 0.9, 0.3, 1)', id: 'mark-glide', fill: 'none' },
      );
    }
  }

  private bindMark(node: SVGGraphicsElement, info: MarkInfo): void {
    node.addEventListener('focus', () => {
      this.focusKey = info.key;
      this.showTooltip(node, info.tooltip);
    });
    node.addEventListener('blur', () => this.hideTooltip());
    node.addEventListener('mouseenter', () => this.showTooltip(node, info.tooltip));
    node.addEventListener('mouseleave', () => {
      if (document.activeElement !== (node as unknown as Element)) this.hideTooltip();
    });
    node.addEventListener('click', (event) => {
      event.stopPropagation();
      this.select(info);
      if (isPhone()) this.options?.onMarkDetails?.(info);
    });
    node.addEventListener('keydown', (event) => {
      const index = this.marks.indexOf(node);
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        this.select(info);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        this.clearSelection();
        this.options?.onSelect?.(null);
        return;
      }
      let next = -1;
      if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(this.marks.length - 1, index + 1);
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, index - 1);
      if (next < 0) return;
      event.preventDefault();
      this.marks.forEach((mark) => mark.setAttribute('tabindex', '-1'));
      const target = this.marks[next];
      target.setAttribute('tabindex', '0');
      (target as unknown as HTMLElement).focus();
    });
  }

  private select(info: MarkInfo): void {
    this.selectedKey = info.key;
    this.marks.forEach((mark) =>
      mark.setAttribute('aria-pressed', mark.getAttribute('data-mark') === info.key ? 'true' : 'false'),
    );
    const node = this.marks.find((mark) => mark.getAttribute('data-mark') === info.key);
    if (node !== undefined) this.showTooltip(node, info.tooltip);
    this.options?.onSelect?.(info);
  }

  private showTooltip(node: SVGGraphicsElement, text: string): void {
    this.hideTooltip();
    const box = node.getBoundingClientRect();
    const hostBox = this.host.getBoundingClientRect();
    const tip = el('div', { role: 'tooltip', class: 'tooltip', text });
    tip.style.left = `${Math.max(0, box.left - hostBox.left)}px`;
    tip.style.top = `${Math.max(0, box.top - hostBox.top - 34)}px`;
    this.host.append(tip);
    this.tooltip = tip;
  }

  hideTooltip(): void {
    this.tooltip?.remove();
    this.tooltip = null;
  }

  focusFirstMark(): void {
    const target = this.marks.find((mark) => mark.getAttribute('tabindex') === '0') ?? this.marks[0];
    if (target !== undefined) (target as unknown as HTMLElement).focus();
  }

  get markElements(): SVGGraphicsElement[] {
    return this.marks;
  }
}
