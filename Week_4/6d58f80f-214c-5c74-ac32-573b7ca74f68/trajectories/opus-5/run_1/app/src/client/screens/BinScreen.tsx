import { useEffect, useState } from 'react';
import type { BinItem } from '../../shared/types.js';
import { ApiFailure, api } from '../lib/api.js';
import { BIN_EMPTY, GENERIC_FAILURE, binDaysLeftText } from '../../shared/copy.js';
import { announce } from '../lib/store.js';
import { onReconnect, onServerEvent } from '../lib/events.js';
import { DeleteConfirm } from '../components/Dialogs.js';

export const BinScreen = ({ canDelete }: { canDelete: boolean }): JSX.Element => {
  const [items, setItems] = useState<BinItem[]>([]);
  const [confirming, setConfirming] = useState<BinItem | null>(null);

  const load = (): void => {
    void api
      .bin()
      .then((result) => setItems(result.items))
      .catch(() => undefined);
  };

  useEffect(() => {
    load();
    const stopEvents = onServerEvent((event) => {
      if (event.type === 'bin_changed' || event.type === 'clock') load();
    });
    const stopReconnect = onReconnect(load);
    return () => {
      stopEvents();
      stopReconnect();
    };
  }, []);

  const restore = (item: BinItem): void => {
    void api
      .restore(item.file.id)
      .then(() => {
        announce(`Restored ${item.file.name} to ${item.fromFolder.name}`);
        load();
      })
      .catch(() => announce(GENERIC_FAILURE));
  };

  const deleteForever = (item: BinItem): void => {
    setConfirming(null);
    void api
      .deleteForever(item.file.id)
      .then(() => {
        announce(`Deleted ${item.file.name} forever`);
        load();
      })
      .catch((failure: unknown) => {
        if (failure instanceof ApiFailure && failure.code === 'storage_unavailable') {
          announce(`File storage is unreachable. ${item.file.name} was not deleted.`);
          return;
        }
        announce(GENERIC_FAILURE);
      });
  };

  return (
    <div className="screen-body">
      <h1>Bin</h1>
      {items.length === 0 ? (
        <p>{BIN_EMPTY}</p>
      ) : (
        <table>
          <caption>Binned files</caption>
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">From</th>
              <th scope="col">Binned</th>
              <th scope="col">Days left</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.file.id}>
                <td>{item.file.name}</td>
                <td>{item.fromFolder.name}</td>
                <td className="num">{item.binnedDate}</td>
                <td className="num">
                  {binDaysLeftText(item.daysLeft, item.retentionDays, item.purgePending)}
                </td>
                <td>
                  <button type="button" onClick={() => restore(item)}>
                    Restore {item.file.name}
                  </button>
                  {canDelete ? (
                    <button type="button" onClick={() => setConfirming(item)}>
                      Delete {item.file.name} forever
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {confirming === null ? null : (
        <DeleteConfirm
          name={confirming.file.name}
          onConfirm={() => deleteForever(confirming)}
          onClose={() => setConfirming(null)}
        />
      )}
    </div>
  );
};
