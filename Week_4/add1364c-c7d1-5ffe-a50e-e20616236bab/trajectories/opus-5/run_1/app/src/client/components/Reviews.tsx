import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiFailure, type Person, type Review, type ReviewHead, type ReviewLine } from '../api.js';
import { call } from '../guard.js';
import { REVIEW_STATUS, displayName } from '../format.js';
import { refuse, say, useLive } from '../live.js';
import { Dialog } from './Dialog.js';

export function Reviews(props: { me: Person }): React.ReactElement {
  const [heads, setHeads] = useState<ReviewHead[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [removing, setRemoving] = useState<ReviewLine | null>(null);
  const keepRefs = useRef(new Map<string, HTMLButtonElement>());
  const removeRefs = useRef(new Map<string, HTMLButtonElement>());
  const pastTabs = useRef(new Map<string, HTMLButtonElement>());
  const statusLine = useRef<HTMLParagraphElement>(null);
  const regionHeading = useRef<HTMLHeadingElement>(null);
  const moveFocusFrom = useRef<string | null>(null);

  const loadHeads = useCallback(() => {
    void call<{ reviews: ReviewHead[] }>('/api/reviews')
      .then((answer) => {
        setHeads(answer.reviews);
        setOpenId((current) => current ?? answer.reviews[0]?.id ?? null);
      })
      .catch(() => undefined);
  }, []);

  useEffect(loadHeads, [loadHeads]);

  /** A redraw never moves focus, unless the focused line itself was closed by a scope change. */
  const loadReview = useCallback((id: string) => {
    const focusedLine = [...keepRefs.current.entries()].find(([, node]) => node === document.activeElement)?.[0];
    void call<Review>(`/api/reviews/${id}`)
      .then((fresh) => {
        setReview(fresh);
        const closed = fresh.lines.find((line) => line.id === focusedLine);
        if (focusedLine !== undefined && closed !== undefined && closed.decision !== 'undecided') {
          moveFocusFrom.current = focusedLine;
        }
        setRemoving((open) =>
          open === null || fresh.lines.some((line) => line.id === open.id && line.decision === 'undecided')
            ? open
            : null,
        );
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (openId !== null) loadReview(openId);
  }, [openId, loadReview]);

  useLive(
    'review-changed',
    useCallback(
      (raw: unknown) => {
        const data = raw as { review_id: string };
        loadHeads();
        if (data.review_id === openId) loadReview(data.review_id);
      },
      [loadHeads, loadReview, openId],
    ),
  );

  useLive('review-opened', loadHeads);

  /** Focus moves to the Keep button of the next undecided line, wrapping to the first. */
  const focusNext = useCallback((lines: ReviewLine[], fromId: string): void => {
    const index = lines.findIndex((line) => line.id === fromId);
    const after = [...lines.slice(index + 1), ...lines.slice(0, Math.max(0, index + 1))];
    const next = after.find((line) => line.decision === 'undecided');
    if (next === undefined) {
      regionHeading.current?.focus();
      return;
    }
    keepRefs.current.get(next.id)?.focus();
  }, []);

  useEffect(() => {
    const from = moveFocusFrom.current;
    if (from === null || review === null) return;
    moveFocusFrom.current = null;
    focusNext(review.lines, from);
  }, [review, focusNext]);

  const decide = async (line: ReviewLine, decision: 'keep' | 'remove'): Promise<void> => {
    if (review === null) return;
    try {
      await call<ReviewLine>(`/api/reviews/${review.id}/lines/${line.id}`, { method: 'POST', body: { decision } });
      const fresh = await call<Review>(`/api/reviews/${review.id}`);
      setReview(fresh);
      say(
        `${line.person_name} ${decision === 'keep' ? 'kept on' : 'removed from'} ${line.vault_name}. ${fresh.decided} of ${fresh.total} lines decided.`,
      );
      moveFocusFrom.current = line.id;
    } catch (error) {
      if (error instanceof ApiFailure) refuse(error.message);
    }
  };

  const signOff = async (): Promise<void> => {
    if (review === null) return;
    try {
      const fresh = await call<Review>(`/api/reviews/${review.id}/sign-off`, { method: 'POST', body: {} });
      setReview(fresh);
      say('Review signed off.');
      statusLine.current?.focus();
    } catch (error) {
      if (error instanceof ApiFailure) refuse(error.message);
    }
  };

  const past = heads.filter((head) => head.id !== openId);

  return (
    <main>
      <h1>Access reviews</h1>
      {review === null ? null : (
        <section aria-label={`${review.quarter} access review`}>
          <div className="folder">
            <span className="folder-tab" aria-hidden="true">
              {review.quarter}
            </span>
            <div className="folder-band folder-band--surface">
              <h2 tabIndex={-1} ref={regionHeading}>
                {review.quarter} access review
              </h2>
              <p tabIndex={-1} ref={statusLine}>
                {REVIEW_STATUS[review.status]}
              </p>
              <p role="status" aria-label="Review progress">
                {review.decided} of {review.total} lines decided
              </p>
              <ul className="slips">
                {review.lines.map((line) => (
                  <li className="slip" key={line.id}>
                    <div className="slip-grid">
                      <span>
                        <strong>{line.person_name}</strong>
                        <br />
                        {displayName({ name: line.vault_name, formerly: line.vault_formerly })}
                      </span>
                      <span>
                        {line.vendors
                          .map((vendor) => displayName({ name: vendor.name, formerly: vendor.formerly }))
                          .join(', ')}
                      </span>
                      <span>
                        {line.decision === 'undecided' ? (
                          <span className="slip-actions">
                            <button
                              type="button"
                              ref={(node) => {
                                if (node === null) keepRefs.current.delete(line.id);
                                else keepRefs.current.set(line.id, node);
                              }}
                              onClick={() => void decide(line, 'keep')}
                            >
                              {`Keep ${line.person_name} on ${line.vault_name}`}
                            </button>
                            <button
                              type="button"
                              ref={(node) => {
                                if (node === null) removeRefs.current.delete(line.id);
                                else removeRefs.current.set(line.id, node);
                              }}
                              onClick={() => setRemoving(line)}
                            >
                              {`Remove ${line.person_name} from ${line.vault_name}`}
                            </button>
                          </span>
                        ) : (
                          <span>{line.decision === 'kept' ? 'Kept' : 'Removed'}</span>
                        )}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
              {props.me.role === 'managing_partner' ? (
                <button type="button" onClick={() => void signOff()}>
                  Sign off review
                </button>
              ) : null}
            </div>
          </div>
        </section>
      )}

      {past.length === 0 ? null : (
        <div className="closed-tabs" role="tablist" aria-label="Past reviews">
          {past.map((head, index) => (
            <button
              type="button"
              role="tab"
              className="folder-tab"
              key={head.id}
              aria-selected={false}
              tabIndex={index === 0 ? 0 : -1}
              ref={(node) => {
                if (node === null) pastTabs.current.delete(head.id);
                else pastTabs.current.set(head.id, node);
              }}
              onClick={() => setOpenId(head.id)}
              onKeyDown={(event) => {
                const move = (to: number): void => {
                  const target = past[Math.min(past.length - 1, Math.max(0, to))];
                  if (target !== undefined) pastTabs.current.get(target.id)?.focus();
                };
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  move(index + 1);
                } else if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  move(index - 1);
                } else if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  setOpenId(head.id);
                }
              }}
            >
              {head.quarter}
            </button>
          ))}
        </div>
      )}

      {removing === null ? null : (
        <Dialog
          title={`Remove ${removing.person_name} from ${removing.vault_name}`}
          onClose={() => {
            const line = removing;
            setRemoving(null);
            if (line !== null) removeRefs.current.get(line.id)?.focus();
          }}
        >
          <p>{`Their access to ${removing.vault_name} ends now.`}</p>
          <div className="dialog-actions">
            <button
              type="button"
              className="solid"
              onClick={() => {
                const line = removing;
                setRemoving(null);
                if (line !== null) void decide(line, 'remove');
              }}
            >
              Remove access
            </button>
            <button
              type="button"
              onClick={() => {
                const line = removing;
                setRemoving(null);
                if (line !== null) removeRefs.current.get(line.id)?.focus();
              }}
            >
              Cancel
            </button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
