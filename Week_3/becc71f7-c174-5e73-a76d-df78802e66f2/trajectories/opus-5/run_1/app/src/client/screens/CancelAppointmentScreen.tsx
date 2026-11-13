import { useState } from 'preact/hooks';
import { ApiError, get, post } from '../lib/api.js';
import { usePolling } from '../lib/polling.js';
import { announce } from '../lib/announce.js';
import type { Appointment } from '../lib/types.js';
import { copy } from '../../shared/copy.js';
import { formatDateTime } from '../../shared/brussels.js';
import { ActionButton } from '../components/form.js';
import { PublicTopBar } from '../components/chrome.js';
import { BottomBar } from '../components/layout.js';
import { NotFoundScreen } from './NotFoundScreen.js';

export function CancelAppointmentScreen({ token }: { token: string }) {
  const page = usePolling(
    () => get<{ appointment: Appointment }>(`/api/appointments/by-token/${token}`),
    token,
  );
  const [pending, setPending] = useState(false);

  if (page.failure?.status === 404) return <NotFoundScreen />;

  const appointment = page.data?.appointment;

  const cancel = async (): Promise<void> => {
    setPending(true);
    try {
      await post(`/api/appointments/by-token/${token}/cancel`);
      announce(copy.appointmentCancelled);
      await page.reload();
    } catch (error) {
      if (error instanceof ApiError) announce(error.failure.message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div class="screen">
      <PublicTopBar />
      <main class="screen__main screen__main--narrow">
        <h1 class="heading heading--1">Your intake appointment</h1>
        {appointment === undefined ? (
          <p class="screen__loading">Reading your appointment…</p>
        ) : (
          <>
            <p class="tabular">{formatDateTime(Date.parse(appointment.startsAt))}</p>
            {appointment.status === 'cancelled' ? (
              <p class="state-note">{copy.appointmentCancelled}</p>
            ) : null}
            <BottomBar>
              <ActionButton
                label="Cancel appointment"
                pending={pending}
                onPress={() => void cancel()}
              />
            </BottomBar>
          </>
        )}
      </main>
    </div>
  );
}
