import { useEffect, useState, type ReactNode } from 'react';

import type { Invoice } from '../../shared/api.js';
import { ApiError, NetworkError, api } from '../api.js';
import { UNREACHABLE, useApp } from '../app-state.js';

export function InvoicesScreen(): ReactNode {
  const app = useApp();
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);

  useEffect(() => {
    app.pending('Loading invoices…');
    void (async () => {
      try {
        const result = await api<{ invoices: Invoice[] }>('/api/invoices');
        setInvoices(result.invoices);
        app.clearMessages();
      } catch (error) {
        if (error instanceof NetworkError) app.report(UNREACHABLE);
        else if (error instanceof ApiError) {
          app.report('Invoices are unavailable while billing is unreachable.');
        } else throw error;
      }
    })();
    // Loaded once when the screen opens.
  }, []);

  return (
    <>
      <h1>Invoices</h1>
      <table>
        <caption>Invoices</caption>
        <thead>
          <tr>
            <th scope="col">Date</th>
            <th scope="col">Items</th>
            <th scope="col">Amount</th>
            <th scope="col">Balance</th>
          </tr>
        </thead>
        <tbody>
          {(invoices ?? []).map((invoice) => (
            <tr key={invoice.id}>
              <td data-label="Date" className="num">
                {invoice.date}
              </td>
              <td data-label="Items">
                {invoice.items.map((item) => (
                  <div key={`${item.description}-${item.amount}`}>
                    {item.description} — <span className="num">${item.amount}</span>
                  </div>
                ))}
              </td>
              <td data-label="Amount" className="num">
                ${invoice.amount}
              </td>
              <td data-label="Balance" className="num">
                ${invoice.balance}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
