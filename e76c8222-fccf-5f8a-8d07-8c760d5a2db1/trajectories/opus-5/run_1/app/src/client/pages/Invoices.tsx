import { Fragment, ReactElement, useCallback, useEffect, useState } from 'react';
import { ApiCallError, api } from '../api';
import { LiveRegion } from '../components/LiveRegion';
import { InvoicesPayload, SessionUser } from '../types';

interface OrgChoice {
  id: string;
  name: string;
}

export function Invoices({ user }: { user: SessionUser }): ReactElement {
  const [orgs, setOrgs] = useState<OrgChoice[]>([]);
  const [orgId, setOrgId] = useState(user.org_id ?? '');
  const [payload, setPayload] = useState<InvoicesPayload | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (user.role !== 'billing') return;
    void api.requests().then(({ requests }) => {
      const choices: OrgChoice[] = [];
      for (const request of requests) {
        if (!choices.some((choice) => choice.id === request.org_id)) {
          choices.push({ id: request.org_id, name: request.org_name });
        }
      }
      choices.sort((left, right) => left.name.localeCompare(right.name));
      setOrgs(choices);
      setOrgId((current) => current || choices[0]?.id || '');
    });
  }, [user.role]);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    setMessage('Loading invoices…');
    try {
      const next = await api.invoices(orgId);
      setPayload(next);
      setMessage(`${next.invoices.length} invoice(s), total $${next.total}.`);
    } catch (error) {
      const failure = error instanceof ApiCallError ? error.failure : null;
      setPayload(null);
      setMessage(
        failure?.code === 'billing_unavailable'
          ? 'Billing is unreachable, so invoices cannot be shown right now.'
          : 'Those invoices could not be shown.',
      );
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main className="column">
      <h1>Invoices</h1>
      {user.role === 'billing' ? (
        <div className="field">
          <label htmlFor="org">Organisation</label>
          <select id="org" value={orgId} onChange={(event) => setOrgId(event.target.value)}>
            {orgs.map((org) => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <table className="stack-rows" aria-label="Invoices">
        <thead>
          <tr>
            <th scope="col">Number</th>
            <th scope="col">Date</th>
            <th scope="col">Amount</th>
            <th scope="col">Balance</th>
          </tr>
        </thead>
        <tbody>
          {(payload?.invoices ?? []).map((invoice) => (
            <Fragment key={invoice.invoice_id}>
              <tr>
                <td data-label="Number" className="mono">
                  {invoice.invoice_number}
                </td>
                <td data-label="Date" className="mono">
                  {invoice.invoice_date}
                </td>
                <td data-label="Amount" className="amount">
                  ${invoice.amount}
                </td>
                <td data-label="Balance" className="amount">
                  ${invoice.balance}
                </td>
              </tr>
              <tr>
                <td data-label="Items" colSpan={4}>
                  <ul className="plain">
                    {invoice.items.map((item, index) => (
                      <li key={`${invoice.invoice_id}-${index}`}>
                        {item.description} — <span className="amount">${item.amount}</span>
                      </li>
                    ))}
                  </ul>
                </td>
              </tr>
            </Fragment>
          ))}
        </tbody>
      </table>

      <LiveRegion label="Invoice status" message={message} />
    </main>
  );
}
