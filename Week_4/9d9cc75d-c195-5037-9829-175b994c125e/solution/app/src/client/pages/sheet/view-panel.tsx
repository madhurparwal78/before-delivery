import { useState } from 'react';
import { ChartView, DataTable, MarkDetails } from '../../chart/index.ts';
import type { MarkInfo } from '../../chart/index.ts';
import { EmptyState } from '../../ui/empty-state.tsx';
import { Status } from '../../ui/live.tsx';
import { usePhone } from '../../ui/phone.ts';
import type { SheetView } from './use-sheet-view.ts';

interface ViewPanelProps {
  name: string;
  view: SheetView;
  /** `status "View announcements"` */
  announcement: string;
}

/**
 * `region "View"` (the chart on a white card, its busy chip, `status "View notice"` and `status "View announcements"`)
 * and `region "Data table"` (the twin). A refused view keeps drawing the last good answer. A new chart kind is drawn
 * afresh: a text mark that becomes a bar is a new mark, so only marks of the same kind glide. Below 768 a tapped mark opens
 * `dialog "Mark details"`; on a sheet, selecting a mark only presses it.
 */
export function ViewPanel({ name, view, announcement }: ViewPanelProps) {
  const phone = usePhone();
  const [tapped, setTapped] = useState<MarkInfo | null>(null);
  const { shape, shown, notice, busy } = view;
  const empty = shown ? shown.result.chart === 'none' : shape.rows.length + shape.columns.length === 0;

  return (
    <>
      <section className="sheet-card view-card" aria-label="View" data-region="View" tabIndex={-1} aria-busy={busy}>
        <div className="card-head">
          <h2 className="panel-title" aria-hidden="true">
            View
          </h2>
          {busy ? <span className="busy-chip">Updating...</span> : null}
        </div>
        <Status name="View notice" text={notice} banner />
        {empty ? (
          <EmptyState headline="Place a field on Rows or Columns." sticker="pill" />
        ) : shown ? (
          <ChartView
            key={shown.result.chart}
            sheetName={name}
            sheet={shown.shape}
            result={shown.result}
            touch={phone}
            compact={phone}
            onTap={setTapped}
          />
        ) : null}
        <Status name="View announcements" text={announcement} />
      </section>
      <section className="sheet-card table-card" aria-label="Data table" data-region="Data table" tabIndex={-1}>
        <h2 className="panel-title" aria-hidden="true">
          Data table
        </h2>
        {shown ? <DataTable sheetName={name} result={shown.result} /> : null}
      </section>
      <MarkDetails mark={tapped} onClose={() => setTapped(null)} />
    </>
  );
}
