import { useCallback, useState, type ReactNode } from 'react';
import type { OutboxMessage } from '../../../shared/api';
import { api } from '../../lib/api';
import { useLiveUpdates } from '../../lib/live';
import { OwnerFrame } from './OwnerFrame';

export function OwnerOutbox(): ReactNode {
  const [messages, setMessages] = useState<OutboxMessage[]>([]);
  const load = useCallback(async () => {
    const result = await api.ownerOutbox();
    if (result.data !== undefined) setMessages(result.data.messages);
    return result.status;
  }, []);

  useLiveUpdates({ owner: true }, () => {
    void load();
  });

  return (
    <OwnerFrame load={load}>
      <h1>Outbox</h1>
      <div className="table-frame">
        <table aria-label="Outbox">
          <thead>
            <tr>
              <th scope="col">To</th>
              <th scope="col">Subject</th>
              <th scope="col">Kind</th>
              <th scope="col">Status</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => (
              <tr key={message.id}>
                <th scope="row">{message.to}</th>
                <td>{message.subject}</td>
                <td>{message.kind}</td>
                <td>{message.status === 'sent' ? 'Sent' : 'Queued'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </OwnerFrame>
  );
}
