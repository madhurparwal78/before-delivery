import { useState } from 'preact/hooks';
import { get } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import type { Hold, Session } from '../lib/types.js';
import { formatDateTime } from '../../shared/brussels.js';
import { StaffShell } from '../components/StaffShell.js';
import { BottomBar, Link, TableFrame } from '../components/layout.js';

export function HoldsScreen({ session }: { session: Session }) {
  const holds = usePolling(() => get<{ holds: Hold[] }>('/api/holds'), 'holds');
  const [selected, setSelected] = useState<string | null>(null);
  const rows = holds.data?.holds ?? [];
  const chosen = rows.find((hold) => hold.id === selected) ?? rows[0];

  return (
    <StaffShell session={session} layout="split">
      <h1 class="heading heading--1">Holds</h1>
      <div class="split">
        <TableFrame name="Holds">
          <table class="table" aria-label="Holds">
            <thead>
              <tr>
                <th scope="col">Tag code</th>
                <th scope="col">Shopper</th>
                <th scope="col">Started</th>
                <th scope="col">Ends</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((hold) => (
                <tr
                  key={hold.id}
                  class={hold.id === chosen?.id ? 'is-selected' : ''}
                  onClick={() => setSelected(hold.id)}
                >
                  <td class="tabular">
                    <Link href={`/staff/holds/${hold.id}`}>{hold.tagCode ?? ''}</Link>
                  </td>
                  <td>{hold.shopperName ?? ''}</td>
                  <td class="tabular">{formatDateTime(Date.parse(hold.startsAt))}</td>
                  <td class="tabular">{formatDateTime(Date.parse(hold.endsAt))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
        <aside class="detail">
          {chosen === undefined ? (
            <p>No hold in place.</p>
          ) : (
            <>
              <h2 class="detail__heading tabular">{chosen.tagCode ?? ''}</h2>
              <p>{chosen.shopperName ?? ''}</p>
              <p class="tabular">{formatDateTime(Date.parse(chosen.endsAt))}</p>
              <Link href={`/staff/holds/${chosen.id}`}>Open this hold</Link>
            </>
          )}
        </aside>
      </div>
      <BottomBar>
        <Link href="/staff/till" class="button button--primary">
          Till
        </Link>
      </BottomBar>
    </StaffShell>
  );
}
