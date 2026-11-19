import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, api } from '../api';
import { useConfig } from '../clock';
import { FieldEditor, type ScalarField } from '../components/jobs/FieldEditor';
import { NotAvailable } from '../components/jobs/NotAvailable';
import { ScreeningBuilder } from '../components/jobs/ScreeningBuilder';
import type { Question } from '../components/jobs/jobModel';
import { useEditorStream } from '../live';
import '../components/jobs/jobs.css';

interface EditorState {
  fields: Record<ScalarField, { value: string; version: number }> & { questions: { value: Question[]; version: number } };
  editing: Array<{ id: string; name: string }>;
}

interface Person {
  id: string;
  name: string;
}

const SCALAR_FIELDS: ScalarField[] = ['title', 'location', 'workplace', 'closes_at', 'description'];

/** The published Editing now text for the other admins who have this editor open. */
function presenceText(others: Person[]): string {
  const [first, second] = others;
  if (!first) return 'Only you are editing';
  if (others.length === 1) return `${first.name} is also editing`;
  if (others.length === 2 && second) return `${first.name} and ${second.name} are also editing`;
  return `${first.name} and ${others.length - 1} others are also editing`;
}

/** The job editor for company admins: presence, field-level saves with live values, and the screening builder. */
export default function JobEditor() {
  const { jobId = '' } = useParams();
  const { typing_timeout_ms: typingTimeout } = useConfig();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [denied, setDenied] = useState(false);
  const [others, setOthers] = useState<Person[]>([]);
  const [savedBy, setSavedBy] = useState<Partial<Record<string, string>>>({});
  const [typing, setTyping] = useState<Partial<Record<string, Person>>>({});
  const timers = useRef(new Map<string, number>());

  const load = (): void => {
    api
      .get<EditorState>(`/api/jobs/${jobId}/editor`)
      .then((state) => {
        setEditor(state);
        setOthers(state.editing);
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError) setDenied(true);
      });
  };

  useEffect(load, [jobId]);
  useEffect(() => {
    const running = timers.current;
    return () => running.forEach((timer) => window.clearTimeout(timer));
  }, []);

  const clearTyping = (field: string): void => {
    window.clearTimeout(timers.current.get(field));
    timers.current.delete(field);
    setTyping((current) => ({ ...current, [field]: undefined }));
  };

  useEditorStream(editor ? jobId : null, (event) => {
    if (event.type === 'job_presence') setOthers(event.editing);
    else if (event.type === 'job_typing') {
      const { field } = event;
      window.clearTimeout(timers.current.get(field));
      setTyping((current) => ({ ...current, [field]: event.member }));
      timers.current.set(field, window.setTimeout(() => clearTyping(field), typingTimeout));
    } else if (event.type === 'job_field') {
      const { field } = event;
      clearTyping(field);
      setSavedBy((current) => ({ ...current, [field]: event.by.name }));
      load();
    } else if (event.type === 'reconnected') load();
  });

  if (denied) return <NotAvailable />;
  if (!editor) return null;

  return (
    <div className="stack job-editor">
      <header className="stack-s">
        <h1 className="page-title">Edit job</h1>
        <p role="status" aria-label="Editing now" className="t-larger">
          {presenceText(others)}
        </p>
        <p>
          <Link to={`/jobs/${jobId}`}>Back to the job</Link>
        </p>
      </header>
      {SCALAR_FIELDS.map((field) => (
        <FieldEditor key={field} jobId={jobId} field={field} server={editor.fields[field]} savedBy={savedBy[field] ?? null} typing={typing[field]?.name ?? null} />
      ))}
      <ScreeningBuilder
        jobId={jobId}
        initial={editor.fields.questions}
        remote={{ ...editor.fields.questions, by: savedBy.questions ?? '' }}
      />
    </div>
  );
}
