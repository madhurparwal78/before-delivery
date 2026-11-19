import { useCallback, useEffect, useRef, useState, type JSX } from 'react';
import { api, get, RequestFailed } from '../api';
import { useLive } from '../live';
import { AlertBanner, InlineAlert, Pill } from '../ui';
import { NotFoundCard, SplitBand, useApp } from '../app';
import { messageOf } from './today';

type Paragraph = { n: number; text: string; version: number; editedBy: string | null };
type Note = {
  appointmentId: string;
  patientId: string;
  patientName: string;
  status: string;
  paragraphs: Paragraph[];
};
type Appointment = { id: string; patientId: string; patientName: string; status: string };
type PatientFile = { id: string; name: string; kind: string; contentType: string; url: string };

export function ConsultScreen({ appointmentId }: { appointmentId: string }): JSX.Element {
  const { navigate, session } = useApp();
  const canBuildInvoice = session?.role === 'vet' || session?.role === 'manager';
  const [appointment, setAppointment] = useState<Appointment | null>(null);
  const [missing, setMissing] = useState(false);
  const [paragraphs, setParagraphs] = useState<Paragraph[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [paragraphErrors, setParagraphErrors] = useState<Record<number, string>>({});
  const [files, setFiles] = useState<PatientFile[]>([]);
  const [alert, setAlert] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [focusParagraph, setFocusParagraph] = useState<number | null>(null);
  const dirty = useRef<Set<number>>(new Set());
  const inFlight = useRef(false);
  const inFlightSave = useRef<{ n: number; text: string } | null>(null);
  const editing = useRef<number | null>(null);
  const texts = useRef<Map<number, string>>(new Map());
  const versions = useRef<Map<number, number>>(new Map());
  const timers = useRef<Map<number, number>>(new Map());

  const applyServerNote = useCallback((note: Note) => {
    setParagraphs((current) => {
      const next = note.paragraphs.map((paragraph) => {
        versions.current.set(paragraph.n, paragraph.version);
        const keepLocal =
          dirty.current.has(paragraph.n) || inFlightSave.current?.n === paragraph.n;
        const localText = texts.current.get(paragraph.n);
        if (keepLocal && localText !== undefined) {
          return { ...paragraph, text: localText };
        }
        texts.current.set(paragraph.n, paragraph.text);
        return paragraph;
      });
      void current;
      return next;
    });
  }, []);

  const loadNote = useCallback(async () => {
    const note = await get<Note>(`/api/appointments/${appointmentId}/note`);
    setAppointment({
      id: note.appointmentId,
      patientId: note.patientId,
      patientName: note.patientName,
      status: note.status,
    });
    applyServerNote(note);
  }, [appointmentId, applyServerNote]);

  useEffect(() => {
    if (focusParagraph === null) return;
    const box = document.getElementById(`paragraph-${focusParagraph}`);
    if (!box) return;
    box.focus();
    setFocusParagraph(null);
  }, [focusParagraph, paragraphs.length]);

  useEffect(() => {
    void loadNote().catch((error) => {
      if (error instanceof RequestFailed && error.status === 404) setMissing(true);
    });
  }, [loadNote]);

  useEffect(() => {
    if (!appointment) return;
    void get<{ files: PatientFile[] }>(`/api/patients/${appointment.patientId}/files`).then((data) =>
      setFiles(data.files),
    );
  }, [appointment]);

  useLive((message) => {
    if (message.kind === 'changed' && message.topics.includes('note')) void loadNote();
  });

  const flush = useCallback(async () => {
    if (inFlight.current) return;
    const next = [...dirty.current][0];
    if (next === undefined) {
      setSaving(false);
      return;
    }
    dirty.current.delete(next);
    inFlight.current = true;
    setSaving(true);
    const sentText = texts.current.get(next) ?? '';
    inFlightSave.current = { n: next, text: sentText };
    const version = versions.current.get(next) ?? 1;
    try {
      const saved = await api<Paragraph>(
        'PUT',
        `/api/appointments/${appointmentId}/note/paragraphs/${next}`,
        { text: sentText, version },
      );
      versions.current.set(next, saved.version);
      setParagraphErrors((current) => {
        const copy = { ...current };
        delete copy[next];
        return copy;
      });
      setParagraphs((current) =>
        current.map((paragraph) =>
          paragraph.n === next
            ? { ...paragraph, version: saved.version, text: texts.current.get(next) ?? saved.text }
            : paragraph,
        ),
      );
    } catch (error) {
      if (error instanceof RequestFailed && error.code === 'stale_paragraph') {
        const keptText = dirty.current.has(next) ? texts.current.get(next) ?? sentText : sentText;
        setDrafts((current) => ({ ...current, [next]: keptText }));
        setParagraphErrors((current) => ({ ...current, [next]: error.message }));
        texts.current.delete(next);
        editing.current = null;
        await loadNote();
      } else {
        setAlert(messageOf(error));
      }
    } finally {
      inFlight.current = false;
      inFlightSave.current = null;
      if (dirty.current.size > 0) {
        void flush();
        return;
      }
      setSaving(false);
    }
  }, [appointmentId, loadNote]);

  const onType = (n: number, value: string): void => {
    texts.current.set(n, value);
    dirty.current.add(n);
    setSaving(true);
    setParagraphs((current) =>
      current.map((paragraph) => (paragraph.n === n ? { ...paragraph, text: value } : paragraph)),
    );
    const existing = timers.current.get(n);
    if (existing) window.clearTimeout(existing);
    timers.current.set(
      n,
      window.setTimeout(() => void flush(), 500),
    );
  };

  if (missing) return <NotFoundCard onNavigate={navigate} />;

  const patientName = appointment?.patientName ?? '';

  return (
    <div className="screen">
      <SplitBand
        headline={<h1>{`Consult: ${patientName}`}</h1>}
        right={
          <p className="band-count" role="status" aria-label="Note status">
            {saving ? 'Saving' : 'Saved'}
          </p>
        }
      />
      <div className="screen-body">
        <AlertBanner message={alert} />
        <div className="consult-layout">
          <div className="consult-note">
            {paragraphs.map((paragraph) => (
              <div className="paragraph-box" key={paragraph.n}>
                <label className="visually-hidden" htmlFor={`paragraph-${paragraph.n}`}>
                  Consult note
                </label>
                <textarea
                  id={`paragraph-${paragraph.n}`}
                  aria-label="Consult note"
                  data-paragraph={paragraph.n}
                  value={paragraph.text}
                  onFocus={() => {
                    editing.current = paragraph.n;
                  }}
                  onBlur={() => {
                    editing.current = null;
                    void flush();
                  }}
                  onChange={(event) => onType(paragraph.n, event.target.value)}
                />
                <InlineAlert message={paragraphErrors[paragraph.n] ?? null} />
                {drafts[paragraph.n] !== undefined ? (
                  <div className="draft-box">
                    <label htmlFor={`draft-${paragraph.n}`}>Draft</label>
                    <textarea
                      id={`draft-${paragraph.n}`}
                      aria-label="Draft"
                      value={drafts[paragraph.n]}
                      onChange={(event) =>
                        setDrafts((current) => ({ ...current, [paragraph.n]: event.target.value }))
                      }
                    />
                    <div className="dialog-actions">
                      <Pill
                        onClick={() => {
                          const draftText = drafts[paragraph.n];
                          setDrafts((current) => {
                            const copy = { ...current };
                            delete copy[paragraph.n];
                            return copy;
                          });
                          onType(paragraph.n, draftText);
                          void flush();
                        }}
                      >
                        Apply draft
                      </Pill>
                      <Pill
                        variant="secondary"
                        onClick={() =>
                          setDrafts((current) => {
                            const copy = { ...current };
                            delete copy[paragraph.n];
                            return copy;
                          })
                        }
                      >
                        Discard draft
                      </Pill>
                    </div>
                  </div>
                ) : null}
              </div>
            ))}
            <Pill
              variant="secondary"
              onClick={async () => {
                try {
                  const added = await api<Paragraph>(
                    'POST',
                    `/api/appointments/${appointmentId}/note/paragraphs`,
                    { text: '' },
                  );
                  versions.current.set(added.n, added.version);
                  texts.current.set(added.n, '');
                  setParagraphs((current) => [...current, added]);
                  setFocusParagraph(added.n);
                } catch (error) {
                  setAlert(messageOf(error));
                }
              }}
            >
              Add paragraph
            </Pill>
          </div>
          <aside className="consult-side">
            <section aria-label="Files for this consult" className="files-region">
              <h3 className="card-title">Files</h3>
              <ul>
                {files.map((file) => (
                  <li key={file.id}>
                    <a className="link" href={file.url}>
                      {file.name}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
            {canBuildInvoice ? (
              <Pill
                onClick={async () => {
                  if (!appointment) return;
                  try {
                    const invoice = await api<{ id: string }>('POST', '/api/invoices', {
                      patientId: appointment.patientId,
                      appointmentId: appointment.id,
                    });
                    navigate(`/invoices/${invoice.id}`);
                  } catch (error) {
                    setAlert(messageOf(error));
                  }
                }}
              >
                Create invoice
              </Pill>
            ) : null}
          </aside>
        </div>
      </div>
    </div>
  );
}
