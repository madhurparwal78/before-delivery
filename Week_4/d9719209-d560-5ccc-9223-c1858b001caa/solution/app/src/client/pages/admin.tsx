import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { CommentView, PostView, ReportView } from '../../shared/types.js';
import { deadlineLabel } from '../../shared/format.js';
import { ApiError, api, get } from '../api.js';
import { announce } from '../announce.js';
import { Link, navigate } from '../router.js';
import { useSession } from '../session.js';
import { Button, Empty, Field, Modal, Skeleton, pageTitle, useFocusFirstInvalid } from '../ui.js';
import './pages.css';

const REFRESH_MS = 5000;
const CATEGORY_LABEL: Record<string, string> = {
  hate: 'Hate speech or incitement', terrorism: 'Terrorist content', csam: 'Child sexual abuse material',
  ip: 'Intellectual property infringement', privacy: 'Privacy violation', other: 'Other illegal content',
};

/** The username of whoever wrote the reported post or comment (null when it is hidden from the viewer). */
async function authorOf(report: ReportView): Promise<string | null> {
  try {
    if (report.target.type === 'post') return (await get<PostView>(`/api/posts/${report.target.id}`)).author?.username ?? null;
    const thread = await get<{ tree: CommentView[] }>(`/api/comments/${report.target.id}/thread?depth=1`);
    return thread.tree[0]?.author?.username ?? null;
  } catch {
    return null;
  }
}

function SuspendDialog({ username, onClose, onDone }: { username: string; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [tries, setTries] = useState(0);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  useFocusFirstInvalid(form, tries);
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    try {
      await api('POST', `/api/admin/users/${encodeURIComponent(username)}/suspension`, { reason });
      announce(`Suspended ${username}`);
      onDone();
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 422) {
        setError(caught.fields.reason ?? 'Give a reason');
        setTries((n) => n + 1);
      } else {
        announce(caught instanceof ApiError && caught.code === 'CONFLICT' ? 'This account cannot be suspended' : "The suspension didn't go through", true);
        onClose();
      }
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal title="Suspend account" onClose={onClose}>
      <form ref={form} onSubmit={(e) => void submit(e)} noValidate>
        <p>Suspending {username} signs out every open session and blocks new sign-ins.</p>
        <Field label="Reason" error={error}>
          {(p) => <textarea {...p} rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
        <div className="form-actions">
          <Button type="submit" variant="danger" busy={busy}>Suspend</Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Modal>
  );
}

export function AdminReportsPage(_props: Record<string, unknown>): React.JSX.Element {
  pageTitle('Illegal-content reports');
  const { user, loading } = useSession();
  const [reports, setReports] = useState<ReportView[] | null>(null);
  const [authors, setAuthors] = useState<Record<string, string | null>>({});
  const [suspending, setSuspending] = useState<string | null>(null);
  const known = useRef<Set<string>>(new Set());

  const refetch = useCallback(async () => {
    try {
      const queue = await get<{ items: ReportView[] }>('/api/admin/reports?status=open');
      setReports(queue.items);
      for (const report of queue.items) {
        if (known.current.has(report.reference)) continue;
        known.current.add(report.reference);
        void authorOf(report).then((name) => setAuthors((all) => ({ ...all, [report.reference]: name })));
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === 'TOTP_REQUIRED') navigate('/settings/2fa?next=%2Fadmin%2Freports', true);
      else if (error instanceof ApiError && (error.status === 401 || error.status === 403)) setReports([]);
    }
  }, []);

  const isAdmin = user?.role === 'admin';
  useEffect(() => {
    if (loading) return undefined;
    if (!user) {
      navigate('/login?next=%2Fadmin%2Freports', true);
      return undefined;
    }
    if (!isAdmin) return undefined;
    void refetch();
    const timer = setInterval(() => void refetch(), REFRESH_MS);
    const visible = (): void => { if (document.visibilityState === 'visible') void refetch(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [loading, user, isAdmin, refetch]);

  const resolve = async (reference: string, outcome: 'actioned' | 'dismissed'): Promise<void> => {
    try {
      await api('POST', `/api/admin/reports/${reference}/resolve`, { outcome });
      announce(outcome === 'actioned' ? `Report ${reference} marked handled` : `Report ${reference} dismissed`);
      await refetch();
    } catch {
      announce("The report wasn't updated", true);
      await refetch();
    }
  };

  if (loading || !user) return <Skeleton rows={3} />;
  if (!isAdmin) return <Empty title="Admins only">Only site admins can work the report queue.</Empty>;
  return (
    <div className="page-wide">
      <h1>Illegal-content reports</h1>
      {reports === null ? <Skeleton rows={3} /> : (
        <div className="table-wrap">
          <table className="data" aria-label="Illegal-content reports">
            <thead>
              <tr>
                <th scope="col">Reference</th>
                <th scope="col">Target</th>
                <th scope="col">Type</th>
                <th scope="col">Explanation</th>
                <th scope="col">Deadline</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {reports.length === 0 && <tr><td colSpan={6} className="muted">No open reports. The queue is clear.</td></tr>}
              {reports.map((report) => {
                const author = authors[report.reference];
                return (
                  <tr key={report.reference} id={`report-${report.reference}`}>
                    <td className="num">{report.reference}</td>
                    <td><Link to={report.target.url}>{`${report.target.type === 'post' ? 'Post' : 'Comment'} ${report.target.id}`}</Link></td>
                    <td>{CATEGORY_LABEL[report.category] ?? report.category}</td>
                    <td>{report.explanation}</td>
                    <td id={`deadline-${report.reference}`} className={`num${report.overdue ? ' overdue' : ''}`}>{deadlineLabel(report.secondsRemaining, report.overdue)}</td>
                    <td>
                      <div className="row-actions">
                        {author && (
                          <Button onClick={() => setSuspending(author)}>{`Suspend ${author}`}</Button>
                        )}
                        <Button onClick={() => void resolve(report.reference, 'actioned')}>Mark handled</Button>
                        <Button onClick={() => void resolve(report.reference, 'dismissed')}>Dismiss</Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {suspending && <SuspendDialog username={suspending} onClose={() => setSuspending(null)} onDone={() => void refetch()} />}
    </div>
  );
}
