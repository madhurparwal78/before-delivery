import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LayoutMode } from '../layout.js';

export interface MarginCardModel {
  id: string;
  kind: 'suggestion' | 'thread';
  name: string;
  handle: string | null;
  createdAt: string | null;
  anchorLine: number | null;
  deleted: string | null;
  inserted: string | null;
  quote: string | null;
  comments: { id: string; name: string; handle: string | null; body: string }[];
  stub: string | null;
  pending: boolean;
  canResolve: boolean;
  canReply: boolean;
  orphaned: boolean;
}

interface Props {
  cards: MarginCardModel[];
  lineTops: number[];
  sourceTop: number;
  mode: LayoutMode;
  focusedId: string | null;
  reducedMotion: boolean;
  onFocusCard: (id: string) => void;
  onChooseCard: (id: string) => void;
  onAccept: (id: string) => void;
  onReject: (id: string) => void;
  onReply: (id: string, body: string) => void;
  onResolve: (id: string) => void;
  replyDrafts: Record<string, string>;
  onReplyDraft: (id: string, value: string) => void;
  onReplyKeyDown: (id: string, event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  mentionList: JSX.Element | null;
  mentionFor: string | null;
}

const GAP = 8;

export function Margin(props: Props): JSX.Element {
  const orphans = props.cards.filter((card) => card.orphaned);
  const anchored = props.cards.filter((card) => !card.orphaned);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cardsRef = useRef<HTMLDivElement | null>(null);
  const [tops, setTops] = useState<Record<string, number>>({});

  /** The viewport position of the card's anchor line, in container coordinates. */
  const trueTopOf = (card: MarginCardModel, containerTop: number): number => {
    if (card.anchorLine === null) return 0;
    const index = Math.min(Math.max(card.anchorLine, 1), props.lineTops.length) - 1;
    return props.sourceTop + (props.lineTops[index] ?? 0) - containerTop;
  };

  useLayoutEffect(() => {
    if (props.mode === 'phone') return;
    const host = hostRef.current;
    const container = cardsRef.current;
    if (host === null || container === null) return;
    const containerTop = container.getBoundingClientRect().top;
    const next: Record<string, number> = {};
    const heights = anchored.map((card) => {
      const element = host.querySelector<HTMLElement>(`[data-card="${card.id}"]`);
      return element === null ? 0 : element.offsetHeight;
    });
    const trueTops = anchored.map((card) => trueTopOf(card, containerTop));
    const focusIndex = Math.max(
      0,
      anchored.findIndex((card) => card.id === props.focusedId),
    );
    const placed = [...trueTops];
    for (let index = focusIndex + 1; index < placed.length; index += 1) {
      placed[index] = Math.max(placed[index], placed[index - 1] + heights[index - 1] + GAP);
    }
    for (let index = focusIndex - 1; index >= 0; index -= 1) {
      placed[index] = Math.min(placed[index], placed[index + 1] - heights[index] - GAP);
    }
    anchored.forEach((card, index) => {
      next[card.id] = placed[index];
    });
    setTops(next);
  }, [props.cards, props.lineTops, props.sourceTop, props.focusedId, props.mode]);

  const renderCard = (card: MarginCardModel, positioned: boolean): JSX.Element => {
    const label =
      card.kind === 'suggestion' ? `Suggestion by ${card.name}` : `Comment by ${card.name}`;
    const style =
      positioned && props.mode !== 'phone' ? { top: `${tops[card.id] ?? 0}px` } : undefined;
    return (
      <article
        key={card.id}
        data-card={card.id}
        className={[
          'card',
          card.stub === null ? '' : 'card-stub',
          props.focusedId === card.id ? 'card-focused' : '',
          positioned && props.mode !== 'phone' ? 'card-positioned' : '',
          props.reducedMotion ? 'card-still' : '',
        ]
          .filter((part) => part !== '')
          .join(' ')}
        style={style}
        aria-label={label}
        tabIndex={card.stub === null ? 0 : -1}
        onFocus={() => {
          if (card.stub === null) props.onFocusCard(card.id);
        }}
        onClick={(event) => {
          if (event.target instanceof HTMLElement && event.target.closest('button, textarea')) {
            return;
          }
          if (card.stub === null) props.onChooseCard(card.id);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && event.target === event.currentTarget) {
            props.onChooseCard(card.id);
          }
        }}
      >
        {positioned && props.mode !== 'phone' ? <span className="tether" aria-hidden="true" /> : null}
        {card.stub !== null ? (
          <p className="card-stub-text">{card.stub}</p>
        ) : (
          <>
            <p className="card-author">
              {card.name}
              {card.handle === null ? null : <span className="card-handle"> @{card.handle}</span>}
              {card.createdAt === null ? null : (
                <span className="card-time"> {new Date(card.createdAt).toLocaleString()}</span>
              )}
            </p>
            {card.kind === 'suggestion' ? (
              <p className="card-change">
                {card.deleted !== null && card.deleted !== '' ? (
                  <span className="mark-deleted">{card.deleted}</span>
                ) : null}
                {card.inserted !== null && card.inserted !== '' ? (
                  <span className="mark-inserted">{card.inserted}</span>
                ) : null}
              </p>
            ) : (
              <>
                {card.quote === null ? null : <p className="card-quote">{card.quote}</p>}
                {card.comments.map((comment) => (
                  <div key={comment.id} className="card-comment">
                    <span className="card-author">
                      {comment.name}
                      {comment.handle === null ? null : (
                        <span className="card-handle"> @{comment.handle}</span>
                      )}
                    </span>
                    <p>{comment.body}</p>
                  </div>
                ))}
              </>
            )}
            {card.kind === 'suggestion' && card.canResolve ? (
              <p className="card-actions">
                <button
                  type="button"
                  disabled={card.pending}
                  aria-busy={card.pending ? true : undefined}
                  onClick={() => props.onAccept(card.id)}
                >
                  Accept
                </button>
                <button
                  type="button"
                  disabled={card.pending}
                  aria-busy={card.pending ? true : undefined}
                  onClick={() => props.onReject(card.id)}
                >
                  Reject
                </button>
              </p>
            ) : null}
            {card.kind === 'thread' && card.canReply ? (
              <div className="card-reply">
                <label>
                  <span className="field-label">Reply</span>
                  <textarea
                    aria-label="Reply"
                    value={props.replyDrafts[card.id] ?? ''}
                    onChange={(event) => props.onReplyDraft(card.id, event.target.value)}
                    onKeyDown={(event) => props.onReplyKeyDown(card.id, event)}
                  />
                </label>
                {props.mentionFor === card.id ? props.mentionList : null}
                <button
                  type="button"
                  onClick={() => props.onReply(card.id, props.replyDrafts[card.id] ?? '')}
                >
                  Post reply
                </button>
                {card.canResolve ? (
                  <button type="button" onClick={() => props.onResolve(card.id)}>
                    Resolve thread
                  </button>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </article>
    );
  };

  return (
    <aside className="margin" aria-label="Margin" ref={hostRef}>
      {orphans.length > 0 ? (
        <section className="orphaned" aria-label="Orphaned">
          <h2>Orphaned</h2>
          {orphans.map((card) => renderCard(card, false))}
        </section>
      ) : null}
      <div className="margin-cards" ref={cardsRef}>
        {anchored.map((card) => renderCard(card, true))}
      </div>
    </aside>
  );
}

export function useCardFocusKeys(
  hostSelector: string,
  cards: MarginCardModel[],
): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return;
      const card = active.closest('[data-card]');
      if (card === null) return;
      const host = document.querySelector(hostSelector);
      if (host === null) return;
      const open = cards.filter((candidate) => candidate.stub === null);
      const index = open.findIndex((candidate) => candidate.id === card.getAttribute('data-card'));
      if (index < 0) return;
      event.preventDefault();
      const nextIndex = event.key === 'ArrowDown' ? index + 1 : index - 1;
      const next = open[nextIndex];
      if (next === undefined) return;
      const element = host.querySelector<HTMLElement>(`[data-card="${next.id}"]`);
      element?.focus();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cards, hostSelector]);
}
