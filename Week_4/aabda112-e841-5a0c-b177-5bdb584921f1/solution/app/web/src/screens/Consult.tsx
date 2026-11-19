import { useEffect, useRef, useState } from 'react';
import { can } from '../../../shared/domain';
import { ApiError, errorText, get, mutate, post, put } from '../lib/api';
import { useMe } from '../lib/env';
import { useLive } from '../lib/live';
import { useRouter } from '../lib/router';
import type { Appointment } from '../lib/types';
import { SplitBand } from '../components/Shell';
import { Banner, Pill, Skeleton } from '../components/ui';
import { FilesPanel } from './Patients';
import { NotFound } from './Pages';

interface ServerParagraph {
  n: number;
  text: string;
  version: number;
  editedBy: string | null;
}

/** What one paragraph's editor knows: its text, the version that text was based on, and the save traffic. */
interface Paragraph {
  n: number;
  text: string;
  baseText: string;
  baseVersion: number;
  inflight: boolean;
  draft?: string;
  stale?: string;
}

/**
 * The consult note. Each paragraph saves about half a second after typing stops and when focus leaves it, with at most
 * one save in flight; text typed meanwhile stays in the box and is saved next on the version the last save returned.
 */
export function Consult({ id }: { id: string }) {
  const me = useMe();
  const { navigate } = useRouter();
  const canWrite = can(me.role, 'consult.run');
  const [appointment, setAppointment] = useState<Appointment | null>();
  const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const state = useRef<Paragraph[]>([]);
  const latest = useRef<ServerParagraph[]>([]);
  const timers = useRef(new Map<number, number>());
  const focusNext = useRef<number | null>(null);

  const commit = (next: Paragraph[]) => {
    state.current = next;
    setParagraphs(next);
  };
  const update = (n: number, change: Partial<Paragraph>) => commit(state.current.map((p) => (p.n === n ? { ...p, ...change } : p)));

  const fetchNote = async () => {
    const note = await get<{ appointment: Appointment; paragraphs: ServerParagraph[] }>(`/api/appointments/${id}/note`);
    latest.current = note.paragraphs;
    setAppointment(note.appointment);
    const active = document.activeElement;
    const merged = note.paragraphs.map((s): Paragraph => {
      const mine = state.current.find((p) => p.n === s.n);
      if (!mine) return { n: s.n, text: s.text, baseText: s.text, baseVersion: s.version, inflight: false };
      const clean = mine.text === mine.baseText && !mine.inflight;
      const editing = active instanceof HTMLTextAreaElement && active.dataset.paragraph === String(s.n);
      return clean && !editing ? { ...mine, text: s.text, baseText: s.text, baseVersion: s.version } : mine;
    });
    commit(merged);
    setLoaded(true);
  };

  useEffect(() => {
    fetchNote().catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) setAppointment(null);
    });
    const pending = timers.current;
    return () => pending.forEach((t) => window.clearTimeout(t));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  useLive(['note'], (event) => {
    if (event.t === '*' || (event.t === 'note' && event.appointmentId === id)) void fetchNote().catch(() => undefined);
  });

  const flush = (n: number) => {
    window.clearTimeout(timers.current.get(n));
    timers.current.delete(n);
    const p = state.current.find((x) => x.n === n);
    if (!p || p.inflight || p.text === p.baseText) return;
    const sent = p.text;
    update(n, { inflight: true });
    mutate(() => put<ServerParagraph>(`/api/appointments/${id}/note/paragraphs/${n}`, { text: sent, version: p.baseVersion })).then(
      (saved) => {
        update(n, { inflight: false, baseVersion: saved.version, baseText: sent });
        flush(n);
      },
      async (e: unknown) => {
        if (e instanceof ApiError && e.code === 'stale_paragraph') {
          const mine = state.current.find((x) => x.n === n)!;
          update(n, { inflight: false, draft: mine.text, stale: e.message });
          await fetchNote().catch(() => undefined);
          const winner = latest.current.find((x) => x.n === n);
          if (winner) update(n, { text: winner.text, baseText: winner.text, baseVersion: winner.version });
        } else {
          update(n, { inflight: false });
          setError(errorText(e));
        }
      },
    );
  };

  const typed = (n: number, text: string) => {
    update(n, { text });
    window.clearTimeout(timers.current.get(n));
    timers.current.set(n, window.setTimeout(() => flush(n), 500));
  };

  const blurred = (n: number) => {
    flush(n);
    const p = state.current.find((x) => x.n === n);
    if (p && p.text === p.baseText && !p.inflight) {
      const server = latest.current.find((x) => x.n === n);
      if (server && server.version !== p.baseVersion) update(n, { text: server.text, baseText: server.text, baseVersion: server.version });
    }
  };

  const addParagraph = () => {
    setError(null);
    mutate(() => post<ServerParagraph>(`/api/appointments/${id}/note/paragraphs`, { text: '' })).then(
      (made) => {
        commit([...state.current, { n: made.n, text: '', baseText: '', baseVersion: made.version, inflight: false }]);
        focusNext.current = made.n;
      },
      (e: unknown) => setError(errorText(e)),
    );
  };

  useEffect(() => {
    if (focusNext.current === null) return;
    document.querySelector<HTMLTextAreaElement>(`[data-paragraph="${focusNext.current}"]`)?.focus();
    focusNext.current = null;
  });

  const applyDraft = (n: number) => {
    const p = state.current.find((x) => x.n === n)!;
    update(n, { text: p.draft ?? '', draft: undefined, stale: undefined });
    flush(n);
  };

  const createInvoice = () => {
    if (!appointment) return;
    setError(null);
    mutate(() => post<{ id: string }>('/api/invoices', { patientId: appointment.patientId, appointmentId: appointment.id })).then(
      (made) => navigate(`/invoices/${made.id}`),
      (e: unknown) => setError(errorText(e)),
    );
  };

  if (appointment === null) return <NotFound />;
  if (!appointment || !loaded) return <Skeleton rows={4} />;
  const saving = paragraphs.some((p) => p.inflight || p.text !== p.baseText);

  return (
    <>
      <SplitBand title={`Consult: ${appointment.patientName}`}>
        <div className="record-summary">
          <p className="record-weight">{`${appointment.vetName}, ${appointment.roomName}`}</p>
          <p role="status" aria-label="Note status" className="note-status">
            {saving ? 'Saving' : 'Saved'}
          </p>
        </div>
      </SplitBand>
      <div className="consult-grid">
        <section className="note" aria-label="Consult paragraphs">
          <Banner message={error} />
          {paragraphs.map((p) => (
            <div key={p.n} className="paragraph">
              <textarea
                aria-label="Consult note"
                data-paragraph={p.n}
                rows={4}
                value={p.text}
                readOnly={!canWrite}
                onChange={(e) => typed(p.n, e.target.value)}
                onBlur={() => blurred(p.n)}
              />
              {p.stale && (
                <div className="draft-box">
                  <p role="alert" className="field-error">
                    {p.stale}
                  </p>
                  <textarea aria-label="Draft" rows={3} value={p.draft ?? ''} onChange={(e) => update(p.n, { draft: e.target.value })} />
                  <div className="modal-actions">
                    <Pill variant="blue" onClick={() => applyDraft(p.n)}>
                      Apply draft
                    </Pill>
                    <Pill variant="outline" className="on-light" onClick={() => update(p.n, { draft: undefined, stale: undefined })}>
                      Discard draft
                    </Pill>
                  </div>
                </div>
              )}
            </div>
          ))}
          {canWrite && (
            <Pill variant="outline" className="on-light" onClick={addParagraph}>
              Add paragraph
            </Pill>
          )}
        </section>
        <aside className="consult-side" aria-label="Consult side panel">
          <section aria-label="Files for this consult" className="side-card">
            <h2 className="section-title">Files</h2>
            <FilesPanel patientId={appointment.patientId} appointmentId={appointment.id} />
          </section>
          {can(me.role, 'invoices.write') && (
            <Pill variant="blue" onClick={createInvoice}>
              Create invoice
            </Pill>
          )}
        </aside>
      </div>
    </>
  );
}
