import { useEffect, useState } from 'react';
import { send } from '../api.ts';
import { INVOICE_PENDING, money } from '../format.ts';
import { useInterval } from '../hooks.ts';
import type { Invoice } from '../types.ts';
import { NotFound } from './NotFound.tsx';

export function InvoiceScreen({ id }: { id: string }): JSX.Element {
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [missing, setMissing] = useState(false);

  const load = async (): Promise<void> => {
    const reply = await send<Invoice>('GET', `/api/invoices/${encodeURIComponent(id)}`).catch(
      () => null,
    );
    if (reply === null) return;
    if (!reply.ok) {
      if (reply.status === 404) setMissing(true);
      return;
    }
    setInvoice(reply.data);
  };

  useEffect(() => {
    void load();
  }, [id]);

  useInterval(() => {
    void load();
  }, 30_000);

  if (missing) return <NotFound />;
  if (invoice === null) return <p>Loading...</p>;

  return (
    <section className="pane" aria-label={`Invoice ${invoice.id}`}>
      <h1>{`Invoice ${invoice.id}`}</h1>
      <div className="rows">
        <div className="row">
          <span>{invoice.state === 'issued' ? 'issued' : INVOICE_PENDING}</span>
          <span className="mono">{`Number ${invoice.number ?? '-'}`}</span>
          <span className="mono">
            {invoice.balance_cents === null
              ? 'Balance -'
              : `Balance ${money(invoice.balance_cents)}`}
          </span>
          <span className="mono">{`Total ${money(invoice.total_cents)}`}</span>
          <a href={`/moves/${invoice.move_ref}`}>{`Open ${invoice.move_ref}`}</a>
        </div>
        {invoice.state === 'issued' && invoice.balance_confirmed_at !== null && (
          <div className="row dim mono">
            {`Balance last confirmed ${invoice.balance_confirmed_at.slice(11, 19)} port time`}
          </div>
        )}
      </div>
      <h3>Lines</h3>
      <div className="scroll-x">
        <table aria-label="Invoice lines">
        <thead>
          <tr>
            <th scope="col">Label</th>
            <th scope="col">Quantity</th>
            <th scope="col">Unit</th>
            <th scope="col">Amount</th>
            <th scope="col">Revision</th>
          </tr>
        </thead>
        <tbody>
          {invoice.lines.map((line, index) => (
            <tr key={`${line.label}-${index}`}>
              <th scope="row">{line.label}</th>
              <td>{line.quantity}</td>
              <td>{money(line.unit_cents)}</td>
              <td>{money(line.amount_cents)}</td>
              <td>{line.tariff_revision}</td>
            </tr>
          ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
