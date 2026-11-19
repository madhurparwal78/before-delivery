import { useEffect, useState } from 'preact/hooks';
import { api } from '../lib/api.js';
import { announce } from '../components/Announcements.tsx';
import { useStore } from '../lib/store.js';
import type { Handover } from '../lib/types.js';

export function HandoversScreen(): preact.JSX.Element {
  const person = useStore(s => s.person)!;
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const load = (): void => {
    void api.handovers().then(r => setHandovers(r.handovers)).catch(() => setHandovers([]));
  };
  useEffect(() => { load(); }, []);

  return (
    <div class="table-wrap">
      <table class="data-table" aria-label="Handovers">
        <thead>
          <tr><th>Folder</th><th>From</th><th>To</th><th>Offered</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
          {handovers.map(h => (
            <tr key={h.id}>
              <td>{h.folder.name}</td>
              <td>{h.from.name}</td>
              <td>{h.to.name}</td>
              <td class="numeric">{h.offeredDate}</td>
              <td>{h.status === 'offered' ? `Open until ${h.lapseDate}` : h.status.charAt(0).toUpperCase() + h.status.slice(1)}</td>
              <td class="actions-cell">
                {h.status === 'offered' && h.to.id === person.id && (
                  <>
                    <button type="button" class="rowbtn" aria-label={`Accept ${h.folder.name}`} onClick={async () => {
                      try {
                        await api.acceptHandover(h.id);
                        announce(`You now own ${h.folder.name}`);
                        load();
                      } catch (err) {
                        const code = (err as { code?: string }).code;
                        if (code === 'handover_lapsed') announce(`This handover lapsed at the end of ${h.lapseDate}.`);
                        else if (code === 'handover_accepted') announce('This handover was already accepted.');
                        else if (code === 'handover_declined') announce('This handover was already declined.');
                        else announce('Something went wrong. Nothing was changed.');
                      }
                    }}>Accept</button>
                    <button type="button" class="rowbtn" aria-label={`Decline ${h.folder.name}`} onClick={async () => {
                      try {
                        await api.declineHandover(h.id);
                        announce(`Declined ${h.folder.name}`);
                        load();
                      } catch (err) {
                        const code = (err as { code?: string }).code;
                        if (code === 'handover_lapsed') announce(`This handover lapsed at the end of ${h.lapseDate}.`);
                        else announce('Something went wrong. Nothing was changed.');
                      }
                    }}>Decline</button>
                  </>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
