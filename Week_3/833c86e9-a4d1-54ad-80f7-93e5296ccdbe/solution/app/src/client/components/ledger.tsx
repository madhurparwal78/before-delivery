import type { Booking } from '../../shared/types'
import { useApp } from '../state'

/** `table "Ledger"`: every entry with its pair; Debit and Credit cells both carry data-minor in EUR, plus the one approximate figure outside the cells. */
export function Ledger({ booking }: { booking: Booking }) {
  const app = useApp()
  const cell = (minor: number) => <td className="num amount-cell" data-minor={minor} data-currency="EUR">{minor ? app.money(minor, 'EUR') : ''}</td>
  return (
    <section className="ledger" tabIndex={0}>
      <table aria-label={app.t('ui.ledger')} data-balance-minor={booking.balance_minor}>
        <thead>
          <tr>
            <th scope="col">{app.t('ui.colKind')}</th>
            <th scope="col">{app.t('ui.colAccount')}</th>
            <th scope="col" className="num">{app.t('ui.colDebit')}</th>
            <th scope="col" className="num">{app.t('ui.colCredit')}</th>
            <th scope="col">{app.t('ui.colTime')}</th>
          </tr>
        </thead>
        <tbody>
          {booking.ledger.map((entry) => (
            <tr key={entry.id} data-kind={entry.kind} data-account={entry.account} data-pair={entry.pair}>
              <td>{app.t(`kind.${entry.kind}`)}</td>
              <td>{app.t(`account.${entry.account}`)}</td>
              {cell(entry.debit_minor)}
              {cell(entry.credit_minor)}
              <td className="muted">{app.fmt.moment(entry.at, booking.property.zone, app.lang)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="approx num" data-minor={booking.approx_minor} data-currency={booking.quote_currency} data-approx="">{`≈ ${app.money(booking.approx_minor, booking.quote_currency)}`}</p>
    </section>
  )
}
