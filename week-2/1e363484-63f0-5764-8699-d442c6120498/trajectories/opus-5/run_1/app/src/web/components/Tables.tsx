import type { Figure, LedgerEntry, MovedReading, Summary } from '../api';
import { checkedDisplay, intervalDisplay, signedTonnes } from '../format';
import { Link } from '../router';

export function BalanceStrip({ summary }: { summary: Summary }): React.ReactElement {
  const cells: [string, string | number][] = [
    ['Sealed net tCO2e', signedTonnes(summary.sealed_net_tco2e)],
    ['Buffer tCO2e', summary.buffer_tco2e],
    ['Intact figures', summary.intact_count],
    ['Broken figures', summary.broken_count],
    ['Superseded figures', summary.superseded_count],
  ];
  return (
    <section className="balance-strip" aria-label="Project balance" role="region">
      {cells.map(([label, value]) => (
        <div className="cell" key={label}>
          <span className="label">{label}</span>
          <span className="value">{value}</span>
        </div>
      ))}
    </section>
  );
}

const STATUS_LABEL: Record<Figure['status'], string> = {
  sealed: 'Sealed',
  broken: 'Broken',
  superseded: 'Superseded',
};

export function FiguresTable({
  figures,
  slug,
  figureLinkRef,
}: {
  figures: readonly Figure[];
  slug: string;
  figureLinkRef?: (id: string, element: HTMLAnchorElement | null) => void;
}): React.ReactElement {
  return (
    <table aria-label="Figures" className="stacked">
      <caption>Figures</caption>
      <thead>
        <tr>
          <th scope="col">Figure</th>
          <th scope="col">Interval</th>
          <th scope="col">Net tCO2e</th>
          <th scope="col">Buffer tCO2e</th>
          <th scope="col">Credited tCO2e</th>
          <th scope="col">Coverage</th>
          <th scope="col">Status</th>
          <th scope="col">Checked at</th>
        </tr>
      </thead>
      <tbody>
        {figures.map((figure) => (
          <tr key={figure.id}>
            <td data-label="Figure" className="num">
              <Link
                to={`/projects/${slug}/figures/${figure.id}`}
                ref={
                  figureLinkRef === undefined
                    ? undefined
                    : (element: HTMLAnchorElement | null) => figureLinkRef(figure.id, element)
                }
              >
                {figure.id}
              </Link>
            </td>
            <td data-label="Interval" className="num">
              {intervalDisplay(Date.parse(figure.start))} to{' '}
              {intervalDisplay(Date.parse(figure.end))}
            </td>
            <td data-label="Net tCO2e" className="num">
              {signedTonnes(figure.net_tco2e)}
            </td>
            <td data-label="Buffer tCO2e" className="num">
              {figure.buffer_tco2e}
            </td>
            <td data-label="Credited tCO2e" className="num">
              {signedTonnes(figure.credited_tco2e)}
            </td>
            <td data-label="Coverage" className="num">
              {figure.coverage_pct}%
            </td>
            <td data-label="Status" className={`status-${figure.status}`}>
              {STATUS_LABEL[figure.status]}
            </td>
            <td data-label="Checked at" className="num">
              {checkedDisplay(figure.checked_at)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const LEDGER_KIND: Record<LedgerEntry['kind'], string> = {
  issuance: 'Issuance',
  buffer: 'Buffer',
  reversal: 'Reversal',
};

export function LedgerTable({
  entries,
  balance,
}: {
  entries: readonly LedgerEntry[];
  balance: string;
}): React.ReactElement {
  return (
    <table aria-label="Sealed-tonnes ledger" className="stacked">
      <caption>Sealed-tonnes ledger</caption>
      <thead>
        <tr>
          <th scope="col">Entry</th>
          <th scope="col">Figure</th>
          <th scope="col">Kind</th>
          <th scope="col">tCO2e</th>
          <th scope="col">Recorded at</th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id}>
            <td data-label="Entry" className="num">
              {entry.id}
            </td>
            <td data-label="Figure" className="num">
              {entry.figure_id}
            </td>
            <td data-label="Kind">{LEDGER_KIND[entry.kind]}</td>
            <td data-label="tCO2e" className="num">
              {signedTonnes(entry.tco2e)}
            </td>
            <td data-label="Recorded at" className="num">
              {checkedDisplay(entry.recorded_at)}
            </td>
          </tr>
        ))}
        <tr>
          <td data-label="Entry">Balance</td>
          <td data-label="Figure" />
          <td data-label="Kind" />
          <td data-label="tCO2e" className="num">
            {signedTonnes(balance)}
          </td>
          <td data-label="Recorded at" />
        </tr>
      </tbody>
    </table>
  );
}

export function MovedReadingsTable({
  moved,
}: {
  moved: readonly MovedReading[];
}): React.ReactElement {
  return (
    <table aria-label="Moved readings" className="stacked">
      <caption>Moved readings</caption>
      <thead>
        <tr>
          <th scope="col">Sensor</th>
          <th scope="col">Interval start</th>
          <th scope="col">Old FC</th>
          <th scope="col">New FC</th>
          <th scope="col">Old FCH4</th>
          <th scope="col">New FCH4</th>
          <th scope="col">Old QC</th>
          <th scope="col">New QC</th>
          <th scope="col">Revised at</th>
        </tr>
      </thead>
      <tbody>
        {moved.map((reading) => (
          <tr key={`${reading.sensor_id}-${reading.interval_start}-${reading.revised_at}`}>
            <td data-label="Sensor" className="num">
              {reading.sensor_id}
            </td>
            <td data-label="Interval start" className="num">
              {intervalDisplay(Date.parse(reading.interval_start))}
            </td>
            <td data-label="Old FC" className="num">
              {reading.old === null ? '—' : reading.old.fc}
            </td>
            <td data-label="New FC" className="num">
              {reading.new.fc}
            </td>
            <td data-label="Old FCH4" className="num">
              {reading.old === null ? '—' : reading.old.fch4}
            </td>
            <td data-label="New FCH4" className="num">
              {reading.new.fch4}
            </td>
            <td data-label="Old QC" className="num">
              {reading.old === null ? '—' : reading.old.qc}
            </td>
            <td data-label="New QC" className="num">
              {reading.new.qc}
            </td>
            <td data-label="Revised at" className="num">
              {checkedDisplay(reading.revised_at)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
