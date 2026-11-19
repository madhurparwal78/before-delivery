import { useState, useEffect, useCallback } from 'react';
import { api, ApiError } from '../lib/api';
import type { MeJson, ReturnsEnvelope, ReturnJson } from '../../../shared/types';
import { OwnerTopBar } from '../components/TopBar';
import { Tile, EmptyTile } from '../components/Tile';
import { useLiveEvents } from '../lib/live';
import type { Session } from '../lib/session';
import { navigateTo } from '../lib/router';

export function OwnerHome({ me }: { me: MeJson }): React.ReactNode {
  const [envelope, setEnvelope] = useState<ReturnsEnvelope | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [announceLine, setAnnounceLine] = useState('');
  const session: Session = { me, signOut: async () => {} };
  const route = { path: '/home', navigate: () => {} };

  const load = useCallback(async () => {
    const next = await api.returns('');
    setEnvelope(next);
    return next;
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveEvents(() => {
    void load();
  });

  if (envelope === null) {
    return (
      <>
        <OwnerTopBar clientName={me.user.display_name} session={session} route={route} />
        <main className="page">Loading</main>
      </>
    );
  }

  const waiting = envelope.returns.filter((r) => r.awaiting_approval);
  const selected = envelope.returns.find((r) => r.id === selectedId) ?? waiting[0] ?? envelope.returns[0] ?? null;
  const stateCodes = [...new Set(envelope.returns.map((r) => r.state))].sort();

  const approve = async (ret: ReturnJson) => {
    if (saving) return;
    setSaving(true);
    try {
      await api.approve(ret.id, { version: ret.version });
      setAnnounceLine(`${ret.state} ${ret.period_label} approved.`);
      const next = await load();
      setSelectedId(next.returns.find((r) => r.awaiting_approval)?.id ?? null);
    } finally {
      setSaving(false);
    }
  };

  const sendBack = async (ret: ReturnJson) => {
    if (saving) return;
    setSaving(true);
    setErrors({});
    try {
      await api.sendBack(ret.id, { version: ret.version, reason });
      setSheetOpen(false);
      setReason('');
      setAnnounceLine(`${ret.state} ${ret.period_label} sent back.`);
      const next = await load();
      setSelectedId(next.returns.find((r) => r.awaiting_approval)?.id ?? null);
    } catch (error) {
      if (error instanceof ApiError) setErrors(error.errors);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <OwnerTopBar clientName={me.user.display_name} session={session} route={route} />
      <div role="status" aria-live="polite" aria-atomic="true" className="visually-hidden">{announceLine}</div>
      <main className="page owner-home">
        <h1>Awaiting your approval</h1>
        {waiting.length === 0 ? (
          <EmptyTile sentence="Nothing is waiting for your approval." />
        ) : (
          <>
            <div className="owner-tile-holder">
              {selected !== null ? <Tile ret={selected} stateCodes={stateCodes} size="phone" /> : null}
              {selected !== null ? <p className="due-line">{selected.due_line}</p> : null}
            </div>
            <ul aria-label="Your returns" className="owner-name-row">
              {waiting.map((ret) => (
                <li key={ret.id} className="owner-name-item">
                  <button
                    type="button"
                    aria-pressed={selected?.id === ret.id}
                    onClick={() => setSelectedId(ret.id)}
                  >
                    {`${ret.state} ${ret.period_label}`}
                  </button>
                </li>
              ))}
            </ul>
            {selected !== null ? (
              <div className="owner-actions">
                <button
                  type="button"
                  className="button button-primary owner-approve"
                  onClick={() => void approve(selected)}
                >
                  {`Approve ${selected.state} ${selected.period_label}`}
                </button>
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => setSheetOpen(true)}
                >
                  {`Send back ${selected.state} ${selected.period_label}`}
                </button>
              </div>
            ) : null}
          </>
        )}
        <section aria-label="All your returns" className="return-region">
          <h2>All your returns</h2>
          <ul>
            {envelope.returns.map((ret) => (
              <li key={ret.id}>
                <a
                  href={`/returns/${ret.id}`}
                  data-return-id={ret.id}
                  data-status={ret.status}
                  data-overdue={String(ret.overdue)}
                  data-due-at={ret.due_at}
                  data-state={ret.state}
                  data-version={ret.version}
                  data-rate={ret.edition.rate}
                  data-edition={ret.edition.effective_date}
                  onClick={(event) => {
                    event.preventDefault();
                    navigateTo(`/returns/${ret.id}`);
                  }}
                >
                  {`${ret.state} ${ret.period_label} · ${ret.status_label}${ret.overdue ? ' · Overdue' : ''}`}
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>
      {sheetOpen && selected !== null ? (
        <div className="bottom-sheet-backdrop" onPointerDown={(event) => {
          if (event.target === event.currentTarget) setSheetOpen(false);
        }}>
          <div role="dialog" aria-modal="true" aria-label="Send back" className="bottom-sheet">
            <h2>Send back</h2>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void sendBack(selected);
              }}
            >
              <label className="field">
                <span className="field-label">Reason</span>
                <textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} />
                {errors.reason !== undefined ? <span className="field-error">{errors.reason}</span> : null}
              </label>
              <div className="dialog-actions">
                <button type="submit" className="button button-primary">
                  {saving ? 'Saving' : 'Send back'}
                </button>
                <button type="button" className="button button-secondary" onClick={() => setSheetOpen(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </>
  );
}
