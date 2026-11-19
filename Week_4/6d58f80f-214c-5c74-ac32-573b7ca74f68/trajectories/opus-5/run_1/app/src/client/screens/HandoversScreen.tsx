import { useEffect, useState } from 'react';
import type { Handover, Person } from '../../shared/types.js';
import { ApiFailure, api } from '../lib/api.js';
import { GENERIC_FAILURE, handoverDecided, handoverLapsed } from '../../shared/copy.js';
import { announce } from '../lib/store.js';
import { onReconnect, onServerEvent } from '../lib/events.js';

export const HandoversScreen = ({ person }: { person: Person }): JSX.Element => {
  const [handovers, setHandovers] = useState<Handover[]>([]);

  const load = (): void => {
    void api
      .handovers()
      .then((result) => setHandovers(result.handovers))
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
    const stopEvents = onServerEvent((event) => {
      if (event.type === 'handovers_changed' || event.type === 'clock') load();
    });
    const stopReconnect = onReconnect(load);
    return () => {
      stopEvents();
      stopReconnect();
    };
  }, []);

  const decide = (handover: Handover, decision: 'accept' | 'decline'): void => {
    const call =
      decision === 'accept'
        ? api.acceptHandover(handover.id)
        : api.declineHandover(handover.id);
    void call
      .then(() => {
        announce(
          decision === 'accept'
            ? `You now own ${handover.folder.name}`
            : `Declined ${handover.folder.name}`,
        );
        load();
      })
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure && failure.code === 'handover_lapsed') {
          announce(handoverLapsed(handover.lapseDate));
          load();
          return;
        }
        if (
          failure instanceof ApiFailure &&
          (failure.code === 'handover_accepted' || failure.code === 'handover_declined')
        ) {
          announce(
            handoverDecided(failure.code === 'handover_accepted' ? 'accepted' : 'declined'),
          );
          load();
          return;
        }
        announce(GENERIC_FAILURE);
      });
  };

  return (
    <div className="screen-body">
      <h1>Handovers</h1>
      <table>
        <caption>Handovers</caption>
        <thead>
          <tr>
            <th scope="col">Folder</th>
            <th scope="col">From</th>
            <th scope="col">To</th>
            <th scope="col">Offered</th>
            <th scope="col">Status</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {handovers.map((handover) => (
            <tr key={handover.id}>
              <td>{handover.folder.name}</td>
              <td>{handover.from.name}</td>
              <td>{handover.to.name}</td>
              <td className="num">{handover.offeredDate}</td>
              <td className="num">
                {handover.status === 'offered'
                  ? `Open until ${handover.lapseDate}`
                  : handover.status}
              </td>
              <td>
                {handover.status === 'offered' && handover.to.id === person.id ? (
                  <>
                    <button type="button" onClick={() => decide(handover, 'accept')}>
                      Accept {handover.folder.name}
                    </button>
                    <button type="button" onClick={() => decide(handover, 'decline')}>
                      Decline {handover.folder.name}
                    </button>
                  </>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
