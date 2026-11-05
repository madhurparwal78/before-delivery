import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { instrumentName, sizeLabel } from '../../shared/labels';
import { formatStoreDate } from '../../shared/time';
import { DELIVERY_STATUS_ORDER, type RosterResponse, type School } from '../../shared/types';
import { useSession } from '../app';
import { api } from '../lib/api';
import { useBand } from '../lib/motion';
import { DeliveryStatusCell } from '../components/figures';

export function Roster(): ReactNode {
  const { user } = useSession();
  const band = useBand();
  const [params] = useSearchParams();
  const [roster, setRoster] = useState<RosterResponse | null>(null);
  const [schoolId, setSchoolId] = useState('');

  useEffect(() => {
    void (async () => {
      let id = user?.role === 'director' ? user.school_id ?? '' : params.get('school') ?? '';
      if (id === '') {
        const answer = await api<{ schools: School[] }>('/schools');
        id = answer.schools[0]?.id ?? '';
      }
      setSchoolId(id);
      setRoster(await api<RosterResponse>(`/schools/${id}/roster`));
    })();
  }, [user, params]);

  if (roster === null) return <main className="page">Loading…</main>;

  const withInstrument =
    roster.counts.scheduled + roster.counts.delivered + roster.counts.owned;

  return (
    <main className="page">
      <h1>{`${roster.school.name} roster`}</h1>
      <p>{`Next delivery day: ${roster.next_delivery_date === null ? '—' : formatStoreDate(roster.next_delivery_date)}`}</p>
      <p>{`${withInstrument} of ${roster.students.length} students have an instrument`}</p>
      <ul className="roster-summary" aria-label="Roster summary">
        {DELIVERY_STATUS_ORDER.map((status) => (
          <li key={status}>
            <DeliveryStatusCell status={status} count={roster.counts[status]} />
          </li>
        ))}
      </ul>

      <table>
        <caption>Roster</caption>
        <thead>
          <tr>
            <th scope="col">Student</th>
            {band === 'wide' ? <th scope="col">Grade</th> : null}
            <th scope="col">Instrument</th>
            {band === 'narrow' ? null : <th scope="col">Size</th>}
            <th scope="col">Serial</th>
            {band === 'narrow' ? null : <th scope="col">Delivery day</th>}
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {roster.students.map((row) => (
            <tr key={row.student_id}>
              <td>{row.student_name}</td>
              {band === 'wide' ? <td className="figure">{row.grade}</td> : null}
              <td>{row.instrument_type === null ? '—' : instrumentName(row.instrument_type)}</td>
              {band === 'narrow' ? null : (
                <td>{row.instrument_type === null || row.size === null ? '—' : sizeLabel(row.instrument_type, row.size)}</td>
              )}
              <td className="mono">{row.serial ?? '—'}</td>
              {band === 'narrow' ? null : (
                <td className="figure">{row.delivery_date === null ? '—' : formatStoreDate(row.delivery_date)}</td>
              )}
              <td>
                <DeliveryStatusCell status={row.delivery_status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p>
        <a className="button" href={`/api/schools/${schoolId}/roster.csv`} download>
          Download roster CSV
        </a>
      </p>
    </main>
  );
}
