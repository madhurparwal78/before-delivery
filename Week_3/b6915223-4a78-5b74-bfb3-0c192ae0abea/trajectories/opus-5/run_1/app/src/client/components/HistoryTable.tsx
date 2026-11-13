import { useState } from 'react';
import type { HistoryRow } from '../../shared/types.ts';
import {
  CHIP_NAMES,
  RECEIPT_PENDING,
  RECEIPT_PENDING_DOWNLOAD,
  RECEIPT_STORED,
  STORAGE_OUTAGE,
} from '../../shared/copy.ts';
import { RequestFailed } from '../api.ts';
import { useAnnounce } from '../live.tsx';

export interface HistoryTableProps {
  rows: HistoryRow[];
  names: Record<string, string>;
  snapshotHref: (gameweek: number) => string;
}

export const HistoryTable = ({ rows, names, snapshotHref }: HistoryTableProps) => {
  const announce = useAnnounce();
  const [pending, setPending] = useState<number | null>(null);

  const download = async (gameweek: number): Promise<void> => {
    setPending(gameweek);
    try {
      const response = await fetch(snapshotHref(gameweek), { credentials: 'same-origin' });
      if (!response.ok) {
        const body = (await response.json()) as { error: string; message: string };
        throw new RequestFailed(response.status, body);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download =
        response.headers
          .get('Content-Disposition')
          ?.match(/filename="([^"]+)"/)?.[1] ?? `elevens-gw${gameweek}.json`;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      announce('History updates', `Gameweek ${gameweek} snapshot downloaded.`);
    } catch (error) {
      if (!(error instanceof RequestFailed)) throw error;
      if (error.status === 409) announce('History updates', RECEIPT_PENDING_DOWNLOAD);
      else if (error.status === 503) announce('History updates', STORAGE_OUTAGE);
      else announce('History updates', error.body.message);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="table-frame">
      <table aria-label="Gameweek history" className="figures-table">
        <thead>
          <tr>
            <th scope="col">Gameweek</th>
            <th scope="col">Points</th>
            <th scope="col">Hit</th>
            <th scope="col">Net</th>
            <th scope="col">Total</th>
            <th scope="col">Chip</th>
            <th scope="col">Captain</th>
            <th scope="col">Receipt</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.gameweek}>
              <td className="mono">{row.gameweek}</td>
              <td className="mono">{row.points}</td>
              <td className="mono">{row.hit_points === 0 ? 0 : -row.hit_points}</td>
              <td className="mono">{row.net_points}</td>
              <td className="mono">{row.running_total ?? '—'}</td>
              <td>{row.chip === null ? '—' : CHIP_NAMES[row.chip]}</td>
              <td>{row.captain === null ? '—' : (names[row.captain] ?? row.captain)}</td>
              <td>
                {row.receipt === 'stored' ? (
                  <>
                    <span>{RECEIPT_STORED}</span>{' '}
                    <a
                      href={snapshotHref(row.gameweek)}
                      onClick={(event) => {
                        event.preventDefault();
                        void download(row.gameweek);
                      }}
                    >
                      {pending === row.gameweek
                        ? 'Preparing…'
                        : `Download gameweek ${row.gameweek} snapshot`}
                    </a>
                  </>
                ) : (
                  <span>{RECEIPT_PENDING}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
