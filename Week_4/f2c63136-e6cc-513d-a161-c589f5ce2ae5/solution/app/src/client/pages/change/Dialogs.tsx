import { useState } from 'preact/hooks';
import { api, ApiError, refuse } from '../../api.ts';
import { actionStatus } from '../../store.ts';
import { Button, Dialog, Field } from '../../ui.tsx';
import type { ChangeView, ReviewView } from '../../../shared/types.ts';
import { commentLine, type RowRef } from './model.ts';

const base = (view: ChangeView) => `/api/repos/${view.repo.org}/${view.repo.name}/changes/${view.change.number}`;

export function CommentDialog({ view, row, onClose, returnFocus }: { view: ChangeView; row: RowRef; onClose: () => void; returnFocus: () => HTMLElement | null }) {
  const line = commentLine(row);
  const [text, setText] = useState('');
  const [suggest, setSuggest] = useState(false);
  const [lines, setLines] = useState(row.text);
  const [through, setThrough] = useState(String(line));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canSuggest = row.side === 'new';

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    actionStatus.set('Submitting...');
    try {
      await api('POST', `${base(view)}/threads`, {
        path: row.path,
        side: row.side,
        line,
        end_line: suggest ? Number(through) : line,
        body: text,
        suggestion: suggest ? { lines: lines.split('\n') } : undefined,
      });
      actionStatus.set('Comment added.');
      onClose();
    } catch (failure) {
      actionStatus.set('');
      if (failure instanceof ApiError && failure.fields.body) setError(failure.fields.body);
      else if (failure instanceof ApiError && (failure.fields.suggestion || failure.fields.line || failure.fields.end_line)) setError(failure.fields.suggestion ?? failure.fields.line ?? failure.fields.end_line);
      else if (!refuse(failure)) throw failure;
    } finally {
      setBusy(false);
    }
  };
  const ctrlEnter = (event: KeyboardEvent) => {
    if (event.key === 'Enter' && event.ctrlKey) {
      event.preventDefault();
      void submit();
    }
  };
  return (
    <Dialog title={`Comment on ${row.path} line ${line}`} onClose={onClose} returnFocus={returnFocus} initialFocus="textarea" className="comment-dialog">
      <div className="form-grid" onKeyDown={ctrlEnter}>
        <Field label="Comment" error={error}>
          <textarea value={text} onInput={(event) => setText(event.currentTarget.value)} rows={4} />
        </Field>
        {canSuggest ? (
          <>
            <label className="check">
              <input type="checkbox" checked={suggest} onChange={(event) => setSuggest(event.currentTarget.checked)} />
              <span>Add a suggestion</span>
            </label>
            {suggest ? (
              <>
                <Field label="Suggested lines">
                  <textarea value={lines} onInput={(event) => setLines(event.currentTarget.value)} rows={3} />
                </Field>
                <Field label="Through line">
                  <input type="number" min={line} value={through} onInput={(event) => setThrough(event.currentTarget.value)} />
                </Field>
              </>
            ) : null}
          </>
        ) : null}
      </div>
      <div className="dialog-actions">
        <Button kind="secondary" onClick={onClose}>Cancel</Button>
        <Button kind="primary" busy={busy} onClick={() => void submit()}>Add comment</Button>
      </div>
    </Dialog>
  );
}

export function ReviewDialog({ view, onClose, returnFocus }: { view: ChangeView; onClose: () => void; returnFocus: () => HTMLElement | null }) {
  const [type, setType] = useState<'comment' | 'approve' | 'request_changes'>('comment');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const approveBlock = view.viewer.approve_block;
  const requestBlock = view.viewer.request_block;

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    actionStatus.set('Submitting...');
    try {
      await api('POST', `${base(view)}/reviews`, { type, summary });
      actionStatus.set('Review submitted.');
      onClose();
    } catch (failure) {
      actionStatus.set('');
      if (failure instanceof ApiError && failure.fields.summary) setError(failure.fields.summary);
      else if (!refuse(failure)) throw failure;
    } finally {
      setBusy(false);
    }
  };
  const radio = (value: typeof type, label: string, block: string | null) => (
    <label className={`radio-row ${block ? 'is-disabled' : ''}`}>
      <input type="radio" name="review-type" checked={type === value} disabled={!!block} onChange={() => setType(value)} />
      <span>{label}</span>
    </label>
  );
  return (
    <Dialog title="Submit review" onClose={onClose} returnFocus={returnFocus} initialFocus="input[type=radio]" className="review-dialog">
      <div
        className="form-grid"
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.ctrlKey) {
            event.preventDefault();
            void submit();
          }
        }}
      >
        <div role="radiogroup" aria-label="Review type" className="radio-group">
          {radio('comment', 'Comment', null)}
          {radio('approve', 'Approve', approveBlock)}
          {radio('request_changes', 'Request changes', requestBlock)}
        </div>
        {approveBlock || requestBlock ? <p className="muted">{[...new Set([approveBlock, requestBlock].filter(Boolean))].join(' ')}</p> : null}
        <Field label="Review summary" error={error}>
          <textarea value={summary} onInput={(event) => setSummary(event.currentTarget.value)} rows={4} />
        </Field>
      </div>
      <div className="dialog-actions">
        <Button kind="secondary" onClick={onClose}>Cancel</Button>
        <Button kind="primary" busy={busy} onClick={() => void submit()}>Submit review</Button>
      </div>
    </Dialog>
  );
}

export function DismissDialog({ view, review, onClose, returnFocus }: { view: ChangeView; review: ReviewView; onClose: () => void; returnFocus: () => HTMLElement | null }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    actionStatus.set('Working...');
    try {
      await api('POST', `${base(view)}/reviews/${review.id}/dismiss`, { reason });
      actionStatus.set('Review dismissed.');
      onClose();
    } catch (failure) {
      actionStatus.set('');
      if (failure instanceof ApiError && failure.fields.reason) setError(failure.fields.reason);
      else if (!refuse(failure)) throw failure;
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title="Dismiss review" onClose={onClose} returnFocus={returnFocus} initialFocus="textarea">
      <div className="form-grid" onKeyDown={(event) => { if (event.key === 'Enter' && event.ctrlKey) { event.preventDefault(); void submit(); } }}>
        <p className="muted">Dismiss the {review.type === 'approve' ? 'approval' : 'request for changes'} by {review.reviewer_name}.</p>
        <Field label="Reason" error={error}>
          <textarea value={reason} onInput={(event) => setReason(event.currentTarget.value)} rows={3} />
        </Field>
      </div>
      <div className="dialog-actions">
        <Button kind="secondary" onClick={onClose}>Cancel</Button>
        <Button kind="primary" busy={busy} onClick={() => void submit()}>Confirm dismissal</Button>
      </div>
    </Dialog>
  );
}

export function FilesDialog({ files, onClose, returnFocus, onPick }: { files: { path: string; status: string }[]; onClose: () => void; returnFocus: () => HTMLElement | null; onPick: (path: string) => void }) {
  return (
    <Dialog title="Files" onClose={onClose} returnFocus={returnFocus} className="files-dialog">
      <ul className="file-list">
        {files.map((file) => (
          <li key={file.path} data-path={file.path} data-status={file.status}>
            <a
              href={`#file-${encodeURIComponent(file.path)}`}
              onClick={(event) => {
                event.preventDefault();
                onPick(file.path);
              }}
            >
              {file.path}
            </a>
          </li>
        ))}
      </ul>
      <div className="dialog-actions">
        <Button kind="secondary" onClick={onClose}>Close</Button>
      </div>
    </Dialog>
  );
}
