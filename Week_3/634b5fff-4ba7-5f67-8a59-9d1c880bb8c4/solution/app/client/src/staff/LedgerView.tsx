import { formatDkk } from "../../../shared/money.js";
import { formatInstant, formatPercent } from "./format.js";
import type { Ledger } from "./types.js";

const LEDGER_UNAVAILABLE = "Ledger unavailable";

const Figure = ({ label, ore }: { label: string; ore: number }) => (
  <div className="staff-figure"><dt>{label}</dt><dd>{formatDkk(ore)}</dd></div>
);

/** One order's books: the stored split lines and totals, the fee, the refunds, and Kill Bill's invoice when it answered. */
export const LedgerView = ({ ledger }: { ledger: Ledger | null }) => (
  <section className="staff-ledger" aria-label="Ledger">
    {ledger ? (
      <>
        <dl className="staff-figures">
          <Figure label="Gross" ore={ledger.grossOre} />
          <Figure label="Courier" ore={ledger.courierOre} />
          <Figure label="Order total" ore={ledger.totalOre} />
          <div className="staff-figure"><dt>Locked rate</dt><dd>{formatPercent(ledger.rateBasisPoints)}</dd></div>
          <Figure label="Gateway fee" ore={ledger.gatewayFeeOre} />
          <Figure label="Maker after fees" ore={ledger.makerAfterFeesOre} />
        </dl>
        <div className="staff-scroll" tabIndex={0} role="group" aria-label="Ledger lines, scrollable">
          <table className="staff-table staff-table--figures" aria-label="Ledger lines">
            <thead>
              <tr>
                <th scope="col">Line</th><th scope="col">Gross</th><th scope="col">Net</th><th scope="col">VAT</th>
                <th scope="col">Charity</th><th scope="col">Maker</th><th scope="col">Settled</th>
              </tr>
            </thead>
            <tbody>
              {ledger.lines.map((line) => (
                <tr key={`${line.kind}-${line.settledAt}-${line.grossOre}`}>
                  <th scope="row">{line.kind}</th>
                  <td>{formatDkk(line.grossOre)}</td><td>{formatDkk(line.netOre)}</td><td>{formatDkk(line.vatOre)}</td>
                  <td>{formatDkk(line.charityOre)}</td><td>{formatDkk(line.makerOre)}</td><td>{formatInstant(line.settledAt)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Totals</th>
                <td>{formatDkk(ledger.totals.grossOre)}</td><td>{formatDkk(ledger.totals.netOre)}</td><td>{formatDkk(ledger.totals.vatOre)}</td>
                <td>{formatDkk(ledger.totals.charityOre)}</td><td>{formatDkk(ledger.totals.makerOre)}</td><td />
              </tr>
            </tfoot>
          </table>
        </div>
        <h3>Refunds</h3>
        {ledger.refunds.length === 0 ? <p className="muted">None yet</p> : (
          <ul className="staff-plain">
            {ledger.refunds.map((refund) => <li key={refund.refundId}>{formatDkk(refund.amountOre)}, {refund.state}</li>)}
          </ul>
        )}
        <h3>Kill Bill</h3>
        {ledger.killbill === null ? <p className="muted">{LEDGER_UNAVAILABLE}</p> : (
          <>
            <p className="muted">Invoice <code>{ledger.killbill.invoiceId}</code></p>
            <ul className="staff-plain">
              {ledger.killbill.items.map((item, index) => <li key={`item-${index}`}>{item.description}: {formatDkk(item.amountOre)}</li>)}
              {ledger.killbill.transactions.map((transaction, index) => <li key={`transaction-${index}`}>{transaction.type}: {formatDkk(transaction.amountOre)}</li>)}
            </ul>
          </>
        )}
      </>
    ) : null}
  </section>
);
