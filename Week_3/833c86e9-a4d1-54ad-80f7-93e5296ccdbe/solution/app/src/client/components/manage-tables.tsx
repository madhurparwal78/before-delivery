import { useCallback, useEffect, useState } from 'react'
import { localDate } from '../../shared/dates'
import { ApiFailure, get } from '../api'
import { useLive } from '../live'
import { Link } from '../router'
import { useApp } from '../state'
import { Money } from '../ui'
import { DocumentLink } from './outage'

interface Row { code: string; surname: string; arrival: string; departure: string; rooms: number; total_minor: number }
interface Statement {
  month: string; lines: { code: string; kind: 'stay' | 'cancellation'; base_minor: number; commission_minor: number }[]
  total_base_minor: number; total_commission_minor: number; downloadable: boolean; months: string[]
}

/** `table "Reservations"` with the CSV export link. */
export function Reservations({ code, zone, onMissing }: { code: string; zone: string; onMissing: () => void }) {
  const app = useApp()
  const [rows, setRows] = useState<Row[] | null>(null)
  const load = useCallback(() => {
    get<Row[]>(`/api/manage/${code}/reservations`).then(setRows, (error) => (error instanceof ApiFailure && error.status === 404 ? onMissing() : Promise.reject(error)))
  }, [code, onMissing])
  useEffect(load, [load])
  useLive('clock', load)
  useLive('availability', (event) => event.property === code && load())
  if (!rows) return null
  return (
    <section className="reservations">
      <p><a href={`/api/manage/${code}/reservations.csv`} download={`reservations-${code}.csv`} className="btn quiet no-print">{app.t('ui.exportCsv')}</a></p>
      <div className="table-frame" tabIndex={0}>
        <table aria-label={app.t('ui.reservations')}>
          <thead>
            <tr>
              <th scope="col">{app.t('ui.colCode')}</th>
              <th scope="col">{app.t('ui.surname')}</th>
              <th scope="col">{app.t('ui.colArrival')}</th>
              <th scope="col">{app.t('ui.colDeparture')}</th>
              <th scope="col" className="num">{app.t('ui.colRooms')}</th>
              <th scope="col" className="num">{app.t('ui.colTotal')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.code}>
                <td><Link to={`/bookings/${row.code}`}>{row.code}</Link></td>
                <td>{row.surname}</td>
                <td>{app.fmt.longDate(row.arrival, app.lang, zone)}</td>
                <td>{app.fmt.longDate(row.departure, app.lang, zone)}</td>
                <td className="num">{row.rooms}</td>
                <td className="num"><Money minor={row.total_minor} currency="EUR" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** `combobox "Month"` and `table "Statement"` with the 9 percent commission lines. */
export function Statements({ code, zone, onMissing }: { code: string; zone: string; onMissing: () => void }) {
  const app = useApp()
  const [month, setMonth] = useState<string | null>(null)
  const [data, setData] = useState<Statement | null>(null)

  const load = useCallback((which: string) => {
    get<Statement>(`/api/manage/${code}/statements/${which}`).then(setData, (error) => (error instanceof ApiFailure && error.status === 404 ? onMissing() : Promise.reject(error)))
  }, [code, onMissing])

  useEffect(() => {
    void get<{ now: string }>('/api/time').then((time) => setMonth(localDate(new Date(time.now), zone).slice(0, 7)))
  }, [zone])
  useEffect(() => {
    if (month) load(month)
  }, [month, load])
  useLive('clock', () => month && load(month))

  if (!data || !month) return null
  const label = (value: string): string => app.fmt.monthYear(`${value}-01`, app.lang, 'UTC')
  return (
    <section className="statements">
      <div className="statement-bar">
        <label className="stack month-field">
          <span>{app.t('ui.month')}</span>
          <select className="select" value={month} onChange={(event) => setMonth(event.target.value)}>
            {(data.months.includes(month) ? data.months : [month, ...data.months]).map((value) => <option key={value} value={value}>{label(value)}</option>)}
          </select>
        </label>
        {data.downloadable && <DocumentLink href={`/api/manage/${code}/statements/${month}.csv`} name={`statement-${code}-${month}.csv`} className="btn quiet">{app.t('ui.downloadStatement')}</DocumentLink>}
      </div>
      <div className="table-frame" tabIndex={0}>
        <table aria-label={app.t('ui.statement')} className="statement">
          <thead>
            <tr>
              <th scope="col">{app.t('ui.colCode')}</th>
              <th scope="col">{app.t('ui.colKind')}</th>
              <th scope="col" className="num">{app.t('ui.colBase')}</th>
              <th scope="col" className="num">{app.t('ui.colCommission')}</th>
            </tr>
          </thead>
          <tbody>
            {data.lines.map((line) => (
              <tr key={`${line.kind}|${line.code}`}>
                <td>{line.code}</td>
                <td>{app.t(`stmt.${line.kind}`)}</td>
                <td className="num"><Money minor={line.base_minor} currency="EUR" /></td>
                <td className="num"><Money minor={line.commission_minor} currency="EUR" /></td>
              </tr>
            ))}
            <tr className="statement-total">
              <th scope="row" colSpan={2}>{app.t('stmt.total')}</th>
              <td className="num"><Money minor={data.total_base_minor} currency="EUR" /></td>
              <td className="num"><Money minor={data.total_commission_minor} currency="EUR" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  )
}
