import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { DeliveryState, PreviewStatus } from '../../shared/types';
import { focusIds } from '../state/focus';
import { useApp } from '../state/store';

const statusWords: Record<PreviewStatus, string> = {
  draft: 'Draft',
  scheduled: 'Scheduled',
  published: 'Live',
  withdrawn: 'Withdrawn',
};

const deliveryWords: Record<DeliveryState, string> = {
  sent: 'Sent',
  queued: 'Waiting for mail relay',
  cancelled: 'Not sent',
};

function countdownText(remainingMs: number): string {
  const seconds = Math.ceil(remainingMs / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function PreviewPanel(): ReactElement {
  const { preview, staff, schedulePreview, cancelPreview, withdrawPreview } = useApp();
  const [date, setDate] = useState('');
  const [, setTick] = useState(0);
  const sync = useRef<{ remainingMs: number; at: number }>({ remainingMs: 0, at: Date.now() });

  useEffect(() => {
    if (preview.remainingMs !== null) {
      sync.current = { remainingMs: preview.remainingMs, at: Date.now() };
      setTick((value) => value + 1);
    }
  }, [preview.remainingMs, preview.status, preview.publishAt]);

  useEffect(() => {
    const timer = window.setInterval(() => setTick((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, []);

  const remaining = Math.max(0, sync.current.remainingMs - (Date.now() - sync.current.at));
  const isCurator = staff?.role === 'curator';

  return (
    <section className="preview-panel" aria-label="Lender preview">
      <h2 id={focusIds.previewHeading} tabIndex={-1}>
        Lender preview
      </h2>
      <p className="preview-status">{statusWords[preview.status]}</p>
      {preview.status === 'scheduled' && preview.publishAtDisplay ? (
        <>
          <p>{`Publishes ${preview.publishAtDisplay}`}</p>
          <p>{remaining <= 0 ? 'Publishing now' : `Publishes in ${countdownText(remaining)}`}</p>
        </>
      ) : null}
      {preview.status === 'published' && preview.publishedAtDisplay ? (
        <p>{`Published ${preview.publishedAtDisplay}`}</p>
      ) : null}
      {preview.status === 'withdrawn' && preview.withdrawnAtDisplay ? (
        <p>{`Withdrawn ${preview.withdrawnAtDisplay}`}</p>
      ) : null}
      {isCurator && (preview.status === 'draft' || preview.status === 'withdrawn') ? (
        <div className="field">
          <label htmlFor={focusIds.previewDate}>Preview date</label>
          <input
            id={focusIds.previewDate}
            type="text"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
          <p className="field-hint">
            Publishes at 09:00 Europe/London time on the date you choose.
          </p>
          <button type="button" onClick={() => void schedulePreview(date)}>
            Schedule preview
          </button>
        </div>
      ) : null}
      {isCurator && preview.status === 'scheduled' ? (
        <button type="button" onClick={() => void cancelPreview()}>
          Cancel schedule
        </button>
      ) : null}
      {isCurator && preview.status === 'published' ? (
        <button type="button" onClick={() => void withdrawPreview()}>
          Withdraw preview
        </button>
      ) : null}
      <ul className="recipients" aria-label="Recipients">
        {preview.recipients.map((recipient) => (
          <li key={recipient.lenderId}>
            {`${recipient.lenderName}: ${deliveryWords[recipient.delivery]}`}
          </li>
        ))}
      </ul>
    </section>
  );
}
