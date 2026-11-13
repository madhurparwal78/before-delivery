import { get } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import type { Appointment, Session } from '../lib/types.js';
import { formatDateTime } from '../../shared/brussels.js';
import { StaffShell } from '../components/StaffShell.js';
import { BottomBar, Link, TableFrame } from '../components/layout.js';

export function StaffAppointmentsScreen({ session }: { session: Session }) {
  const booked = usePolling(
    () => get<{ appointments: Appointment[] }>('/api/appointments'),
    'appointments',
  );
  const rows = booked.data?.appointments ?? [];

  return (
    <StaffShell session={session}>
      <h1 class="heading heading--1">Booked appointments</h1>
      <TableFrame name="Appointments">
        <table class="table" aria-label="Appointments">
          <thead>
            <tr>
              <th scope="col">Slot</th>
              <th scope="col">Name</th>
              <th scope="col">Email</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((appointment) => (
              <tr key={appointment.id}>
                <td class="tabular">{formatDateTime(Date.parse(appointment.startsAt))}</td>
                <td>{appointment.name ?? ''}</td>
                <td>{appointment.email ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableFrame>
      <BottomBar>
        <Link href="/appointments" class="button button--primary">
          Public appointment page
        </Link>
      </BottomBar>
    </StaffShell>
  );
}
