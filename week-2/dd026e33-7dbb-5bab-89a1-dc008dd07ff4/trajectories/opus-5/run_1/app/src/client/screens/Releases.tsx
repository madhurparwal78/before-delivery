import { useEffect, useRef, useState, type ReactNode } from 'react';
import { releaseActionAllowed, type ReleaseAction } from '../../shared/releasestates';
import type { Release } from '../../shared/types';
import { HOLD_ROW_LABEL } from '../copy';
import { api, errorCode } from '../lib/api';
import { useFirstLoad, useReread, useStatus, useSubmit, type StatusHandle } from '../lib/hooks';
import { AlertMark, StatusRegion } from '../components/Status';

const ACTION_LABEL: Record<ReleaseAction, string> = {
  book: 'Book release',
  stage: 'Car staged',
  complete: 'Complete release',
  cancel: 'Cancel release',
};

const ACTION_ORDER: ReleaseAction[] = ['book', 'stage', 'complete', 'cancel'];

export function ReleasesScreen(): ReactNode {
  const status = useStatus();
  const [releases, setReleases] = useState<Release[]>([]);
  const focusedRow = useRef<string | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);

  const load = async (): Promise<void> => {
    const active = document.activeElement;
    focusedRow.current =
      active instanceof HTMLElement ? (active.closest('tr')?.dataset.release ?? null) : null;
    const outcome = await api<{ releases: Release[] }>('/api/releases');
    if (outcome.kind === 'ok') setReleases(outcome.body.releases);
  };

  useFirstLoad(load);
  useReread(load, 10_000);

  useEffect(() => {
    const rowId = focusedRow.current;
    if (rowId === null) return;
    if (document.activeElement !== document.body) return;
    const row = tableRef.current?.querySelector<HTMLTableRowElement>(
      `[data-release="${rowId}"]`,
    );
    if (row === null || row === undefined) return;
    const next = row.querySelector<HTMLButtonElement>('button');
    if (next !== null) next.focus();
    else row.querySelector<HTMLElement>('th')?.focus();
  }, [releases]);

  return (
    <div className="screen releases-screen">
      <h1>Releases</h1>
      <table className="data-table" ref={tableRef}>
        <caption className="visually-hidden">Releases</caption>
        <thead>
          <tr>
            <th scope="col">Car</th>
            <th scope="col">Owner</th>
            <th scope="col">Slot</th>
            <th scope="col">Status</th>
            <th scope="col">Bay</th>
            <th scope="col">Hold</th>
            <th scope="col">Actions</th>
          </tr>
        </thead>
        <tbody>
          {releases.map((release) => (
            <tr
              key={release.id}
              data-release={release.id}
              className={release.status === 'staged' ? 'in-progress' : undefined}
            >
              <th scope="row" tabIndex={-1}>
                {release.car.name}
              </th>
              <td>{release.owner.name}</td>
              <td className="mono">{release.slot_label}</td>
              <td>{release.status}</td>
              <td className="mono">{release.bay_code ?? '—'}</td>
              <td>
                {release.held_by.length === 0 ? (
                  '—'
                ) : (
                  <span className="hold-label">
                    <AlertMark />
                    {HOLD_ROW_LABEL}
                  </span>
                )}
              </td>
              <td className="row-actions">
                {ACTION_ORDER.filter((action) =>
                  releaseActionAllowed(release.status, action, 'staff'),
                ).map((action) => (
                  <ReleaseActionButton
                    key={action}
                    release={release}
                    action={action}
                    status={status}
                    onDone={load}
                  />
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <StatusRegion name="Release updates" status={status} />
    </div>
  );
}

function ReleaseActionButton({
  release,
  action,
  status,
  onDone,
}: {
  release: Release;
  action: ReleaseAction;
  status: StatusHandle;
  onDone(): Promise<void>;
}): ReactNode {
  const submit = useSubmit<{ release: Release }>({
    status,
    pendingText: 'Saving...',
    onOk: (body) => {
      if (action === 'book') {
        status.success(
          `Release booked for ${body.release.car.name}, ${body.release.slot_label}. The owner will be emailed.`,
        );
      } else if (action === 'stage') {
        status.success(`${body.release.car.name} staged for handover.`);
      } else if (action === 'complete') {
        status.success(
          `${body.release.car.name} released. Bay ${body.release.bay_code ?? ''} is free.`,
        );
      } else {
        status.success('Release cancelled.');
      }
      void onDone();
    },
    onError: (outcome) => {
      const code = errorCode(outcome);
      if (code === 'invoice_unpaid') {
        const numbers = (outcome.kind === 'error' ? outcome.body.invoices ?? [] : []).map(
          (invoice) => invoice.number,
        );
        status.error(
          `Invoice ${numbers.join(', ')} is unpaid. Record the payment before release.`,
        );
      } else if (code === 'belongings_checked_in') {
        const labels = (outcome.kind === 'error' ? outcome.body.items ?? [] : []).map(
          (item) => item.label,
        );
        status.error(`Check out every item first: ${labels.join(', ')}.`);
      } else if (code === 'mail_unavailable') {
        status.error(
          'Email is unreachable, so the release was not completed. Nothing has changed.',
        );
      } else if (code === 'invalid_transition') {
        status.error('This release has moved on. Reload to see its current state.');
      } else {
        status.error('That could not be saved.');
      }
      void onDone();
    },
  });

  return (
    <button
      type="button"
      disabled={submit.busy}
      onClick={() => {
        void submit.run(() =>
          api<{ release: Release }>(`/api/releases/${release.id}/${action}`, { body: {} }),
        );
      }}
    >
      {ACTION_LABEL[action]}
    </button>
  );
}
