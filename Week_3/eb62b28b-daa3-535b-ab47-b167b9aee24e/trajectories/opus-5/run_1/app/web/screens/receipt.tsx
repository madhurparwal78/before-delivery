import { api } from '../app/api';
import { useLive } from '../app/shell';
import { BottomBar, Card, TableFrame } from '../components/pieces';
import { ReceiptView, displayDate, formatMoney } from '../app/types';

export function ReceiptScreen({ receiptId }: { receiptId: string }): JSX.Element {
  const { data: receipt } = useLive<ReceiptView>(async () => {
    const result = await api<{ receipt: ReceiptView }>(`/api/receipts/${receiptId}`);
    return result.data?.receipt ?? null;
  }, [receiptId]);

  return (
    <>
      <h1 tabIndex={-1}>Receipt {receipt?.number ?? ''}</h1>
      <Card>
        {receipt ? (
          <>
            <p>
              <strong>{receipt.practice.name}</strong>
            </p>
            <p>{receipt.practice.address}</p>
            <p>Tax number {receipt.practice.taxNumber}</p>
            <p>{receipt.memberName}</p>
            <p>Paid {displayDate(receipt.paidDate)}</p>
            <TableFrame name="Receipt items table">
              <table>
                <caption>Receipt items</caption>
                <thead>
                  <tr>
                    <th scope="col">Description</th>
                    <th scope="col">Period</th>
                    <th scope="col">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {receipt.items.map((item, index) => (
                    <tr key={`${item.description}-${index}`}>
                      <td>{item.description}</td>
                      <td>
                        {displayDate(item.periodStart)} – {displayDate(item.periodEnd)}
                      </td>
                      <td>{formatMoney(item.amountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableFrame>
            <p>
              <strong>Total {formatMoney(receipt.amountCents)}</strong>
            </p>
            <p>Paid</p>
          </>
        ) : null}
      </Card>
      <BottomBar>
        <button type="button" onClick={() => window.print()}>
          Print receipt
        </button>
      </BottomBar>
    </>
  );
}
