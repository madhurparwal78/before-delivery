import { useEffect, useRef, useState } from 'react';
import { ApiFailure, apiGet, apiSend } from '../lib/api.js';
import { reviewCopy } from '../lib/copy.js';
import { TopBar } from '../components/TopBar.js';
import { LiveRegion } from '../components/Bits.js';
import { ErrorSummary, FieldError, fieldProps, noFormErrors, type FormErrors } from '../components/ErrorSummary.js';
import type { Comment, ReviewResponse } from '../../shared/types.js';

const formName = 'review-comment';

function messageFor(error: unknown): string {
  if (error instanceof ApiFailure) {
    switch (error.code) {
      case 'link_expired':
        return reviewCopy.expired();
      case 'link_revoked':
        return reviewCopy.revoked();
      case 'link_inactive':
        return reviewCopy.leftReview();
      default:
        return reviewCopy.unknown();
    }
  }
  return reviewCopy.unknown();
}

function utcLabel(instant: string): string {
  return instant.slice(0, 16).replace('T', ' ');
}

export function Review({ token }: { token: string }): JSX.Element {
  const [review, setReview] = useState<ReviewResponse | null>(null);
  const [dead, setDead] = useState<string | null>(null);
  const [authorName, setAuthorName] = useState('');
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState<FormErrors>(noFormErrors);
  const [message, setMessage] = useState('');
  const [waitingUntil, setWaitingUntil] = useState(0);
  const [pending, setPending] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const commentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void apiGet<ReviewResponse>(`/api/review/${encodeURIComponent(token)}`)
      .then(setReview)
      .catch((error: unknown) => setDead(messageFor(error)));
  }, [token]);

  useEffect(() => {
    if (waitingUntil <= now) {
      return undefined;
    }
    const timer = setTimeout(() => setNow(Date.now()), 250);
    return () => clearTimeout(timer);
  }, [waitingUntil, now]);

  if (dead !== null) {
    return (
      <>
        <TopBar bare />
        <div className="page">
          <h1>{dead}</h1>
          {body === '' ? null : (
            <section className="unsent" aria-label="Unsent comment">
              <p>{body}</p>
            </section>
          )}
        </div>
      </>
    );
  }

  if (review === null) {
    return (
      <>
        <TopBar bare />
        <div className="page" />
      </>
    );
  }

  const waiting = waitingUntil > now;

  const post = async (): Promise<void> => {
    setPending(true);
    try {
      const created = await apiSend<Comment>('POST', `/api/review/${encodeURIComponent(token)}/comments`, {
        authorName,
        body,
      });
      setReview((current) =>
        current === null ? current : { ...current, comments: [...current.comments, created] },
      );
      setBody('');
      setErrors(noFormErrors);
      setMessage(reviewCopy.commentPosted());
    } catch (error) {
      if (error instanceof ApiFailure && error.code === 'rate_limited') {
        const retryAfter = error.body.retryAfter ?? 1;
        setMessage(reviewCopy.rateLimited(retryAfter));
        setNow(Date.now());
        setWaitingUntil(Date.now() + retryAfter * 1000);
        commentRef.current?.focus();
      } else if (error instanceof ApiFailure && error.code === 'validation') {
        setErrors({ fields: error.fieldErrors, token: Date.now() });
      } else {
        setDead(messageFor(error));
      }
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <TopBar bare />
      <div className="page">
        <div className="banner">
          {`Review: ${review.cluster.title} · expires ${utcLabel(review.link.expiresAt)} UTC`}
        </div>
        <h1>{review.cluster.title}</h1>
        <p>{review.cluster.publicDescription}</p>
        <p>
          <span className="count">{review.cluster.itemCount}</span> items
        </p>
        <ul className="masonry" aria-label="Items">
          {review.cluster.entries.map((entry) => (
            <li key={entry.id}>
              <div className="card">
                {entry.kind === 'clip' ? (
                  <video src={entry.mediaUrl} muted playsInline preload="metadata" />
                ) : (
                  <img src={entry.mediaUrl} alt="" />
                )}
                <div className="card-body">
                  <h3 className="card-title">
                    <span className="slot">{entry.position}</span> {entry.title}
                  </h3>
                  {entry.kind === 'still' ? (
                    <p className="timecode">
                      {entry.sourceClipTitle} · {entry.timecode}
                    </p>
                  ) : null}
                </div>
              </div>
            </li>
          ))}
        </ul>

        <section className="panel" aria-label="Comments">
          <h2>Comments</h2>
          {review.comments.map((comment) => (
            <div className="comment" key={comment.id}>
              <div className="comment-author">{comment.authorName}</div>
              <div>{comment.body}</div>
            </div>
          ))}
          <LiveRegion name="Review status" message={message} />
          {review.link.canComment ? (
            <>
              <ErrorSummary formName={formName} errors={errors} />
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void post();
                }}
              >
                <div className="field">
                  <label htmlFor={`${formName}-authorName`}>Your name</label>
                  <input
                    type="text"
                    value={authorName}
                    onChange={(event) => setAuthorName(event.target.value)}
                    {...fieldProps(formName, 'authorName', errors)}
                  />
                  <FieldError formName={formName} field="authorName" errors={errors} />
                </div>
                <div className="field">
                  <label htmlFor={`${formName}-body`}>Comment</label>
                  <textarea
                    ref={commentRef}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    {...fieldProps(formName, 'body', errors)}
                  />
                  <FieldError formName={formName} field="body" errors={errors} />
                </div>
                <button type="submit" disabled={pending || waiting}>
                  Post comment
                </button>
              </form>
            </>
          ) : (
            <p>This link is view-only.</p>
          )}
        </section>
      </div>
    </>
  );
}
