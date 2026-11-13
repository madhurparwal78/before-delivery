// Traces tab: markup traces and their lifecycle (open, submitted, closed). Traces never alter the base drawing.
import { useState } from 'react';
import type { TraceState, TraceSummary } from '../../../shared/types.ts';
import { ApiError, post } from '../../api.ts';
import { NewTraceDialog } from '../dialogs/NewTraceDialog.tsx';
import { useEditor } from '../store.ts';
import { EmptyState } from './EmptyState.tsx';
import { writeRefusal } from './refusals.ts';
import '../../styles/panels.css';

const STATE_WORDS: Record<TraceState, string> = { open: 'Open', submitted: 'Submitted', closed: 'Closed' };
const NOTICE_WORDS = { sent: 'Notice sent', not_sent: 'Notice not sent' } as const;

export function TracesPanel() {
  const editor = useEditor();
  const { drawing } = editor;
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const traces = drawing?.traces ?? [];

  // The author of an open trace is whoever is drawing in it; the owner also authors traces under their own name.
  const isAuthor = (trace: TraceSummary): boolean =>
    editor.activeTrace?.id === trace.id || (editor.isOwner && trace.author === drawing?.owner.name);

  const open = async (trace: TraceSummary): Promise<void> => {
    setError(null);
    try {
      if (trace.state === 'open' && isAuthor(trace)) await editor.activateTrace(trace.id);
      else await editor.playTrace(trace.id);
    } catch (failure) {
      setError(writeRefusal(failure));
    }
  };

  const move = async (trace: TraceSummary, step: 'submit' | 'close'): Promise<void> => {
    setError(null);
    setPending(trace.id);
    try {
      await post(`/api/traces/${trace.id}/${step}`);
      if (step === 'submit') await editor.activateTrace(null);
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      setError(writeRefusal(failure));
    } finally {
      await editor.reload();
      setPending(null);
    }
  };

  return (
    <div className="panel">
      <h3 className="panel-heading">Traces</h3>
      {error ? <p role="alert" className="panel-alert">{error}</p> : null}
      <ul className="panel-list" aria-label="Traces">
        <li className="panel-list-action">
          <button type="button" className="btn btn-outline" disabled={editor.access === 'view'} onClick={() => setCreating(true)}>New trace</button>
        </li>
        {traces.length === 0 ? <li><EmptyState>No traces yet.</EmptyState></li> : null}
        {traces.map((trace) => (
          <li key={trace.id} className="panel-item">
            <p className="panel-item-text">
              {[trace.name, STATE_WORDS[trace.state], ...(trace.notice ? [NOTICE_WORDS[trace.notice]] : [])].join(' · ')}
            </p>
            <div className="panel-item-actions">
              <button type="button" className="btn btn-outline" aria-label={`Open trace ${trace.name}`} onClick={() => void open(trace)}>Open</button>
              {trace.state === 'open' && isAuthor(trace) ? (
                <button type="button" className="btn btn-outline" aria-disabled={pending === trace.id} onClick={() => { if (pending !== trace.id) void move(trace, 'submit'); }}>
                  {pending === trace.id ? 'Submitting…' : 'Submit trace'}
                </button>
              ) : null}
              {trace.state === 'submitted' && editor.isOwner ? (
                <button type="button" className="btn btn-outline" aria-label={`Close trace ${trace.name}`} aria-disabled={pending === trace.id} onClick={() => { if (pending !== trace.id) void move(trace, 'close'); }}>Close</button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
      {creating ? <NewTraceDialog onClose={() => setCreating(false)} /> : null}
    </div>
  );
}
