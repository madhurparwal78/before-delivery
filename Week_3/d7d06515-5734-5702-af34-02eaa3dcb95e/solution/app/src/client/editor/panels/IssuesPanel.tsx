// Issues tab: one issue per MTEXT of a submitted trace; the owner resolves them. Refreshes from the `issues` event.
import { useEffect, useRef, useState } from 'react';
import type { IssueView } from '../../../shared/types.ts';
import { ApiError, get, post } from '../../api.ts';
import { GENERIC_ERROR } from '../../pages/errors.ts';
import { useEditor } from '../store.ts';
import { EmptyState } from './EmptyState.tsx';
import { accessRefusal } from './refusals.ts';
import '../../styles/panels.css';

export function IssuesPanel() {
  const editor = useEditor();
  const drawingId = editor.drawing?.id;
  // The editor snapshot is rebuilt on every state change; the subscription must outlive that.
  const subscribe = useRef(editor.subscribe);
  subscribe.current = editor.subscribe;
  const [issues, setIssues] = useState<IssueView[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    if (drawingId) setIssues((await get<{ issues: IssueView[] }>(`/api/drawings/${drawingId}/issues`)).issues);
  };

  useEffect(() => {
    void refresh();
    return subscribe.current('issues', (data) => setIssues(data.issues));
  }, [drawingId]);

  const resolve = async (issue: IssueView): Promise<void> => {
    setError(null);
    try {
      await post(`/api/drawings/${drawingId}/issues/${issue.number}/resolve`);
    } catch (failure) {
      if (!(failure instanceof ApiError)) throw failure;
      if (failure.code !== 'issue_resolved') setError(accessRefusal(failure.code) ?? GENERIC_ERROR);
    }
    await refresh();
  };

  return (
    <div className="panel">
      <h3 className="panel-heading">Issues</h3>
      {error ? <p role="alert" className="panel-alert">{error}</p> : null}
      <ul className="panel-list" aria-label="Issues">
        {issues?.length === 0 ? <li><EmptyState>No issues yet.</EmptyState></li> : null}
        {(issues ?? []).map((issue) => (
          <li key={issue.number} className="panel-item">
            <p className="panel-item-text">{`#${issue.number} ${issue.text} · ${issue.status === 'open' ? 'Open' : 'Resolved'}`}</p>
            {issue.status === 'open' && editor.isOwner ? (
              <div className="panel-item-actions">
                <button type="button" className="btn btn-outline" aria-label={`Resolve issue ${issue.number}`} onClick={() => void resolve(issue)}>Resolve</button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
