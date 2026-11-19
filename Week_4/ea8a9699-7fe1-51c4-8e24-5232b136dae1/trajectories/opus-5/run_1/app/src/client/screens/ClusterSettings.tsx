import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiFailure, apiGet, apiSend } from '../lib/api.js';
import { useInterval } from '../lib/hooks.js';
import { useSession } from '../lib/session.js';
import { clusterCopy } from '../lib/copy.js';
import { takeAnnouncement } from '../lib/handoff.js';
import { TopBar } from '../components/TopBar.js';
import { Dialog } from '../components/Dialog.js';
import { LiveRegion, ReviewLinkTag, StatusLabel } from '../components/Bits.js';
import { ErrorSummary, FieldError, fieldProps, noFormErrors, type FormErrors } from '../components/ErrorSummary.js';
import { NotFound } from './NotFound.js';
import { isLocked } from '../../shared/status.js';
import type {
  Cluster,
  ClusterStatus,
  Comment,
  ReviewLinkSummary,
} from '../../shared/types.js';

const refreshMs = 10_000;

function liftInstantLabel(liftsAt: string): string {
  return `${liftsAt.slice(0, 16).replace('T', ' ')}`;
}

export function ClusterSettings({ slug, clusterId }: { slug: string; clusterId: string }): JSX.Element {
  const { account } = useSession();
  const [cluster, setCluster] = useState<Cluster | null>(null);
  const [missing, setMissing] = useState(false);
  const [comments, setComments] = useState<Comment[]>([]);
  const [links, setLinks] = useState<ReviewLinkSummary[]>([]);
  const [message, setMessage] = useState('');

  const [title, setTitle] = useState('');
  const [publicDescription, setPublicDescription] = useState('');
  const [internalNote, setInternalNote] = useState('');
  const [detailsErrors, setDetailsErrors] = useState<FormErrors>(noFormErrors);
  const [detailsPending, setDetailsPending] = useState(false);

  const [statusPending, setStatusPending] = useState<ClusterStatus | null>(null);
  const [embargoOpen, setEmbargoOpen] = useState(false);
  const [liftDate, setLiftDate] = useState('');
  const [liftTime, setLiftTime] = useState('');
  const [embargoErrors, setEmbargoErrors] = useState<FormErrors>(noFormErrors);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const [linkEmail, setLinkEmail] = useState('');
  const [linkExpires, setLinkExpires] = useState('');
  const [linkCanComment, setLinkCanComment] = useState(true);
  const [linkErrors, setLinkErrors] = useState<FormErrors>(noFormErrors);
  const [linkPending, setLinkPending] = useState(false);

  const [commentBody, setCommentBody] = useState('');
  const [commentErrors, setCommentErrors] = useState<FormErrors>(noFormErrors);
  const [commentPending, setCommentPending] = useState(false);

  const loaded = useRef(false);

  const focusStatus = (): void => {
    requestAnimationFrame(() => document.getElementById('cluster-status-label')?.focus());
  };

  const refresh = useCallback(async (): Promise<void> => {
    const fresh = await apiGet<Cluster>(`/api/clusters/${clusterId}`);
    setCluster(fresh);
    if (!loaded.current) {
      loaded.current = true;
      setTitle(fresh.title);
      setPublicDescription(fresh.publicDescription);
      setInternalNote(fresh.internalNote);
      const announcement = takeAnnouncement(fresh.id);
      if (announcement !== null) {
        setMessage(announcement);
      }
    }
    setLinks((await apiGet<{ links: ReviewLinkSummary[] }>(`/api/clusters/${clusterId}/review-links`)).links);
    setComments((await apiGet<{ comments: Comment[] }>(`/api/clusters/${clusterId}/comments`)).comments);
  }, [clusterId]);

  useEffect(() => {
    void refresh().catch(() => setMissing(true));
  }, [refresh]);

  useInterval(() => {
    void refresh().catch(() => undefined);
  }, refreshMs);

  if (missing) {
    return <NotFound />;
  }
  if (cluster === null) {
    return (
      <>
        <TopBar workspaceSlug={slug} />
        <div className="page" />
      </>
    );
  }

  const locked = isLocked(cluster.status);
  const shownStatus = statusPending ?? cluster.status;
  const seated =
    account !== null &&
    (account.role === 'ops_lead' ||
      account.workspaces.some((workspace) => workspace.slug === slug && workspace.hasSeat));
  const mayWithdraw =
    account !== null && (account.role === 'ops_lead' || account.handle === cluster.owner.handle);

  const changeStatus = async (next: ClusterStatus, extra: Record<string, unknown> = {}): Promise<void> => {
    const before = cluster.status;
    setStatusPending(next);
    try {
      const updated = await apiSend<Cluster>('POST', `/api/clusters/${clusterId}/status`, {
        status: next,
        ...extra,
      });
      setCluster(updated);
      setEmbargoErrors(noFormErrors);
      setMessage(
        next === 'in_review' && before === 'embargoed'
          ? clusterCopy.embargoCancelled()
          : next === 'in_review'
            ? clusterCopy.sentToReview()
            : next === 'draft'
              ? clusterCopy.backToDraft()
              : next === 'embargoed'
                ? clusterCopy.embargoSet(updated.liftLocal?.replace('T', ' ') ?? '', updated.timeZone)
                : clusterCopy.withdrawn(),
      );
      setStatusPending(null);
      setEmbargoOpen(false);
      setWithdrawOpen(false);
      focusStatus();
      await refresh().catch(() => undefined);
    } catch (error) {
      setStatusPending(null);
      if (error instanceof ApiFailure && error.code === 'illegal_transition') {
        const from = error.body.from ?? before;
        setCluster((current) => (current === null ? current : { ...current, status: from }));
        setMessage(clusterCopy.transitionRefused(from));
        setWithdrawOpen(false);
        focusStatus();
        return;
      }
      if (error instanceof ApiFailure && error.code === 'validation') {
        setEmbargoErrors({ fields: error.fieldErrors, token: Date.now() });
        return;
      }
      setMessage(clusterCopy.statusFailed());
      setWithdrawOpen(false);
      focusStatus();
    }
  };

  const saveDetails = async (): Promise<void> => {
    setDetailsPending(true);
    try {
      const updated = await apiSend<Cluster>('PATCH', `/api/clusters/${clusterId}`, {
        title,
        internalNote,
        ...(locked ? {} : { publicDescription }),
      });
      setCluster(updated);
      setDetailsErrors(noFormErrors);
      setMessage(clusterCopy.detailsSaved());
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'validation') {
        setDetailsErrors({ fields: error.fieldErrors, token: Date.now() });
      } else if (error instanceof ApiFailure && error.code === 'cluster_locked') {
        setMessage(clusterCopy.lockedEdit(cluster.status));
      } else {
        setMessage(clusterCopy.statusFailed());
      }
    } finally {
      setDetailsPending(false);
    }
  };

  const togglePrivacy = async (entryId: string, isPrivate: boolean): Promise<void> => {
    const before = cluster.entries;
    setCluster((current) =>
      current === null
        ? current
        : {
            ...current,
            entries: current.entries.map((entry) => (entry.id === entryId ? { ...entry, isPrivate } : entry)),
          },
    );
    try {
      await apiSend('PATCH', `/api/clusters/${clusterId}/entries/${entryId}`, { isPrivate });
      await refresh();
    } catch (error) {
      setCluster((current) => (current === null ? current : { ...current, entries: before }));
      if (error instanceof ApiFailure && error.code === 'cluster_locked') {
        setMessage(clusterCopy.lockedEdit(cluster.status));
      } else {
        setMessage(clusterCopy.statusFailed());
      }
    }
  };

  const createLink = async (): Promise<void> => {
    setLinkPending(true);
    try {
      await apiSend('POST', `/api/clusters/${clusterId}/review-links`, {
        email: linkEmail,
        expiresAt: linkExpires === '' ? '' : `${linkExpires}:00.000Z`,
        canComment: linkCanComment,
      });
      setLinkErrors(noFormErrors);
      setMessage(clusterCopy.reviewLinkSent(linkEmail));
      setLinkEmail('');
      await refresh();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'validation') {
        setLinkErrors({ fields: error.fieldErrors, token: Date.now() });
      } else if (error instanceof ApiFailure && error.code === 'mail_unavailable') {
        setMessage(clusterCopy.reviewLinkMailDown());
      } else {
        setMessage(clusterCopy.statusFailed());
      }
    } finally {
      setLinkPending(false);
    }
  };

  const revokeLink = async (link: ReviewLinkSummary): Promise<void> => {
    try {
      await apiSend('DELETE', `/api/review-links/${link.id}`);
      setMessage(clusterCopy.linkRevoked(link.email));
      await refresh();
    } catch {
      setMessage(clusterCopy.statusFailed());
    }
  };

  const regenerateLink = async (link: ReviewLinkSummary): Promise<void> => {
    try {
      await apiSend('POST', `/api/review-links/${link.id}/regenerate`);
      setMessage(clusterCopy.linkRegenerated(link.email));
      await refresh();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'mail_unavailable') {
        setMessage(clusterCopy.regenerateMailDown());
      } else {
        setMessage(clusterCopy.statusFailed());
      }
      await refresh().catch(() => undefined);
    }
  };

  const postComment = async (): Promise<void> => {
    setCommentPending(true);
    try {
      await apiSend('POST', `/api/clusters/${clusterId}/comments`, { body: commentBody });
      setCommentBody('');
      setCommentErrors(noFormErrors);
      setMessage(clusterCopy.commentPosted());
      await refresh();
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'validation') {
        setCommentErrors({ fields: error.fieldErrors, token: Date.now() });
      } else {
        setMessage(clusterCopy.statusFailed());
      }
    } finally {
      setCommentPending(false);
    }
  };

  const canCancelEmbargo = cluster.status === 'embargoed';

  return (
    <>
      <TopBar workspaceSlug={slug} />
      <div className="page">
        <div className="split">
          <div>
            <section className="panel">
              <h1>{cluster.title}</h1>
              <StatusLabel status={shownStatus} pending={statusPending !== null} />

              <ErrorSummary formName="details" errors={detailsErrors} />
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveDetails();
                }}
              >
                <div className="field">
                  <label htmlFor="details-title">Title</label>
                  <input
                    type="text"
                    value={title}
                    onChange={(event) => setTitle(event.target.value)}
                    {...fieldProps('details', 'title', detailsErrors)}
                  />
                  <FieldError formName="details" field="title" errors={detailsErrors} />
                </div>
                <div className="field">
                  <label htmlFor="details-publicDescription">Public description</label>
                  <textarea
                    value={publicDescription}
                    onChange={(event) => setPublicDescription(event.target.value)}
                    {...fieldProps('details', 'publicDescription', detailsErrors)}
                  />
                  <FieldError formName="details" field="publicDescription" errors={detailsErrors} />
                </div>
                <div className="field">
                  <label htmlFor="details-internalNote">Internal note</label>
                  <textarea
                    value={internalNote}
                    onChange={(event) => setInternalNote(event.target.value)}
                    {...fieldProps('details', 'internalNote', detailsErrors)}
                  />
                  <FieldError formName="details" field="internalNote" errors={detailsErrors} />
                </div>
                <button type="submit" disabled={detailsPending}>
                  Save details
                </button>
              </form>
            </section>

            <section className="panel">
              <h2>Status</h2>
              <div className="actions-row">
                {seated && cluster.status === 'draft' ? (
                  <button type="button" disabled={statusPending !== null} onClick={() => void changeStatus('in_review')}>
                    Send to review
                  </button>
                ) : null}
                {seated && cluster.status === 'in_review' ? (
                  <button type="button" disabled={statusPending !== null} onClick={() => void changeStatus('draft')}>
                    Back to draft
                  </button>
                ) : null}
                {seated && cluster.status === 'in_review' ? (
                  <button type="button" onClick={() => setEmbargoOpen(true)}>
                    Schedule embargo
                  </button>
                ) : null}
                {seated && canCancelEmbargo ? (
                  <button
                    type="button"
                    disabled={statusPending !== null}
                    onClick={() => void changeStatus('in_review')}
                  >
                    Cancel embargo
                  </button>
                ) : null}
                {seated && mayWithdraw && cluster.status === 'public' ? (
                  <button type="button" onClick={() => setWithdrawOpen(true)}>
                    Withdraw cluster
                  </button>
                ) : null}
              </div>

              {cluster.liftLocal !== null && cluster.liftsAt !== null ? (
                <p className="mono">
                  {`Goes public at ${cluster.liftLocal.replace('T', ' ')} ${cluster.timeZone} (${liftInstantLabel(
                    cluster.liftsAt,
                  )} UTC)`}
                </p>
              ) : null}

              {embargoOpen ? (
                <>
                  <ErrorSummary formName="embargo" errors={embargoErrors} />
                  <form
                    onSubmit={(event) => {
                      event.preventDefault();
                      void changeStatus('embargoed', { liftLocal: `${liftDate}T${liftTime}` });
                    }}
                  >
                    <p>{`Times are in ${cluster.timeZone}`}</p>
                    <div className="field">
                      <label htmlFor="embargo-liftLocal">Lift date</label>
                      <input
                        type="date"
                        value={liftDate}
                        onChange={(event) => setLiftDate(event.target.value)}
                        {...fieldProps('embargo', 'liftLocal', embargoErrors)}
                      />
                      <FieldError formName="embargo" field="liftLocal" errors={embargoErrors} />
                    </div>
                    <div className="field">
                      <label htmlFor="embargo-liftTime">Lift time</label>
                      <input
                        type="time"
                        id="embargo-liftTime"
                        value={liftTime}
                        aria-invalid={embargoErrors.fields.liftLocal === undefined ? undefined : 'true'}
                        aria-describedby={
                          embargoErrors.fields.liftLocal === undefined ? undefined : 'embargo-liftLocal-error'
                        }
                        onChange={(event) => setLiftTime(event.target.value)}
                      />
                    </div>
                    <button type="submit" disabled={statusPending !== null}>
                      Set embargo
                    </button>
                  </form>
                </>
              ) : null}

              <LiveRegion name="Cluster status" message={message} />
            </section>

            <section className="panel">
              <h2>Entries</h2>
              <ul className="entry-list">
                {cluster.entries.map((entry) => (
                  <li key={entry.id}>
                    <span className="slot">{entry.position}</span>
                    <img src={entry.reference.mediaUrl} alt="" />
                    <span style={{ flex: 1, minWidth: 0 }}>
                      {entry.reference.title}
                      {entry.reference.kind === 'still' ? (
                        <span className="order-sub">
                          {entry.reference.sourceClipTitle} · {entry.reference.timecode}
                        </span>
                      ) : null}
                      {entry.isPrivate ? <span className="tag">Private</span> : null}
                    </span>
                    <span className="checkrow">
                      <input
                        type="checkbox"
                        id={`private-${entry.id}`}
                        checked={entry.isPrivate}
                        onChange={(event) => void togglePrivacy(entry.id, event.target.checked)}
                      />
                      <label htmlFor={`private-${entry.id}`}>{`Keep ${entry.reference.title} private`}</label>
                    </span>
                  </li>
                ))}
              </ul>
              <p>
                <a href={`/api/clusters/${clusterId}/export.csv`} download>
                  Download cluster sheet
                </a>
              </p>
            </section>
          </div>

          <div>
            <section className="panel">
              <h2>Review links</h2>
              <ErrorSummary formName="review-link" errors={linkErrors} />
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void createLink();
                }}
              >
                <p>Expiry times are in UTC</p>
                <div className="field">
                  <label htmlFor="review-link-email">Freelancer email</label>
                  <input
                    type="email"
                    value={linkEmail}
                    onChange={(event) => setLinkEmail(event.target.value)}
                    {...fieldProps('review-link', 'email', linkErrors)}
                  />
                  <FieldError formName="review-link" field="email" errors={linkErrors} />
                </div>
                <div className="field">
                  <label htmlFor="review-link-expiresAt">Expires</label>
                  <input
                    type="datetime-local"
                    value={linkExpires}
                    onChange={(event) => setLinkExpires(event.target.value)}
                    {...fieldProps('review-link', 'expiresAt', linkErrors)}
                  />
                  <FieldError formName="review-link" field="expiresAt" errors={linkErrors} />
                </div>
                <div className="checkrow">
                  <input
                    type="checkbox"
                    id="review-link-canComment"
                    checked={linkCanComment}
                    onChange={(event) => setLinkCanComment(event.target.checked)}
                  />
                  <label htmlFor="review-link-canComment">Allow comments</label>
                </div>
                <button type="submit" disabled={linkPending}>
                  Create review link
                </button>
              </form>

              <ul className="entry-list">
                {links.map((link) => (
                  <li key={link.id}>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span className="mono">{link.email}</span> <ReviewLinkTag state={link.state} />
                    </span>
                    <button type="button" aria-label={`Revoke link for ${link.email}`} onClick={() => void revokeLink(link)}>
                      Revoke
                    </button>
                    {link.state === 'live' ? (
                      <button
                        type="button"
                        aria-label={`Regenerate link for ${link.email}`}
                        onClick={() => void regenerateLink(link)}
                      >
                        Regenerate
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>

            <section className="panel" aria-label="Comments">
              <h2>Comments</h2>
              {comments.map((comment) => (
                <div className="comment" key={comment.id}>
                  <div className="comment-author">{comment.authorName}</div>
                  <div>{comment.body}</div>
                </div>
              ))}
              <ErrorSummary formName="cluster-comment" errors={commentErrors} />
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void postComment();
                }}
              >
                <div className="field">
                  <label htmlFor="cluster-comment-body">Comment</label>
                  <textarea
                    value={commentBody}
                    onChange={(event) => setCommentBody(event.target.value)}
                    {...fieldProps('cluster-comment', 'body', commentErrors)}
                  />
                  <FieldError formName="cluster-comment" field="body" errors={commentErrors} />
                </div>
                <button type="submit" disabled={commentPending}>
                  Post comment
                </button>
              </form>
            </section>
          </div>
        </div>
      </div>

      {withdrawOpen ? (
        <Dialog name="Withdraw cluster" onClose={() => setWithdrawOpen(false)}>
          <h2>Withdraw cluster</h2>
          <p>Withdrawing removes the public page and feed entry now.</p>
          <div className="dialog-actions">
            <button type="button" onClick={() => setWithdrawOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary" onClick={() => void changeStatus('withdrawn')}>
              Withdraw
            </button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
