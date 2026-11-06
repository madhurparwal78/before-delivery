import { useEffect, useState } from 'react';
import { ShareViewDto } from '../../shared/api';
import { LIMITS } from '../../shared/limits';
import { columnLetter, formatCellRef } from '../../shared/refs';
import { api } from '../lib/api';
import { SHARE_EXPIRED_HEADING } from '../lib/copy';
import { formatStationStamp } from '../../shared/zone';
import { ChartFigure } from '../components/chart';

export function ShareScreen({ token }: { token: string }): JSX.Element {
  const [view, setView] = useState<ShareViewDto | null>(null);
  const [gone, setGone] = useState(false);
  const [sheetName, setSheetName] = useState<string | null>(null);

  useEffect(() => {
    const read = async () => {
      try {
        const result = await api<ShareViewDto>(`/api/share/${token}`);
        setView(result);
        setSheetName(result.workbook.sheets[0]?.name ?? null);
      } catch {
        setGone(true);
      }
    };
    void read();
  }, [token]);

  if (gone) {
    return (
      <main className="centre-screen">
        <h1>{SHARE_EXPIRED_HEADING}</h1>
      </main>
    );
  }
  if (!view) {
    return (
      <main className="share-screen">
        <p className="muted">Opening results…</p>
      </main>
    );
  }

  const workbook = view.workbook;
  const sheet = workbook.sheets.find((one) => one.name === sheetName) ?? workbook.sheets[0];
  const lastRow = Math.max(
    1,
    ...Object.keys(sheet?.cells ?? {}).map((ref) => Number(/\d+$/.exec(ref)?.[0] ?? '1')),
  );
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return (
    <main className="share-screen">
      <p className="share-strip numerals">
        Read-only results from {workbook.stationName}. This link expires{' '}
        {formatStationStamp(workbook.expiresAt, zone)}.
      </p>
      <h1>{workbook.name}</h1>
      <div className="grid-area share-grid">
        <div className="column-headings" aria-hidden="true">
          <div className="row-number" />
          {Array.from({ length: LIMITS.maxColumns }, (_unused, index) => (
            <div key={index} className="column-heading numerals">
              {columnLetter(index + 1)}
            </div>
          ))}
        </div>
        <div className="grid-scroll">
          <div role="grid" aria-label={`Sheet ${sheet?.name ?? ''}`} className="grid static">
            {Array.from({ length: Math.min(LIMITS.maxRows, lastRow + 2) }, (_unused, rowIndex) => {
              const row = rowIndex + 1;
              return (
                <div key={row} role="row" aria-rowindex={row} className="grid-row static-row">
                  <div className="row-number numerals" aria-hidden="true">
                    {row}
                  </div>
                  {Array.from({ length: LIMITS.maxColumns }, (_ignored, colIndex) => {
                    const ref = formatCellRef({ col: colIndex + 1, row });
                    const cell = sheet?.cells[ref];
                    const classes = ['grid-cell'];
                    if (cell?.format.bold) classes.push('bold');
                    if (typeof cell?.value === 'number') classes.push('numeric');
                    return (
                      <div
                        key={ref}
                        role="gridcell"
                        aria-colindex={colIndex + 1}
                        className={classes.join(' ')}
                      >
                        <span className="cell-text">{cell?.display ?? ''}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
      <div className="sheet-strip">
        <div className="sheet-tabs" role="tablist" aria-label="Sheets">
          {workbook.sheets.map((one) => (
            <button
              key={one.name}
              type="button"
              role="tab"
              aria-selected={one.name === sheet?.name}
              tabIndex={one.name === sheet?.name ? 0 : -1}
              className={`sheet-tab${one.name === sheet?.name ? ' current' : ''}`}
              onClick={() => setSheetName(one.name)}
            >
              {one.name}
            </button>
          ))}
        </div>
      </div>
      <div className="share-charts">
        {workbook.charts
          .filter((chart) => chart.sheetName === sheet?.name)
          .map((chart) => (
            <ChartFigure
              key={chart.title}
              title={chart.title}
              type={chart.type}
              categories={chart.categories}
              series={chart.series}
            />
          ))}
      </div>
    </main>
  );
}
