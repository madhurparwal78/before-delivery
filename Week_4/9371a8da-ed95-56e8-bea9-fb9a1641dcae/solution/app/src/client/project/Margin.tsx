import type { JSX } from "preact";
import type { Suggestion, Thread } from "../../shared/api.ts";
import { MentionField } from "../mention.tsx";
import { formatWhen } from "../text.ts";
import { foldCard, glide, glideOffset, stopGlide } from "./glide.ts";

export interface Named {
  displayName: string;
  handle?: string;
}

export type CardItem =
  | { kind: "suggestion"; id: string; item: Suggestion<Named>; line: number | null; stub: string | null }
  | { kind: "thread"; id: string; item: Thread<Named>; line: number | null; stub: string | null };

export interface CardActions {
  canResolve: boolean;
  canReply: boolean;
  shared: boolean;
  /** Resolutions waiting on their answers, by suggestion. */
  pending: ReadonlyMap<string, "accept" | "reject">;
  busy: Set<string>;
  replies: Map<string, string>;
  handles: string[];
  onReply: (id: string, text: string) => void;
  onPostReply: (thread: Thread<Named>) => void;
  onResolve: (thread: Thread<Named>) => void;
  onDecide: (suggestion: Suggestion<Named>, verb: "accept" | "reject") => void;
  onChoose: (card: CardItem) => void;
  onHover: (id: string | null) => void;
}

function Author({ person, shared }: { person: Named; shared: boolean }): JSX.Element {
  return (
    <p class="card-author">
      <span class="name">{person.displayName}</span>
      {!shared && person.handle ? <span class="handle">@{person.handle}</span> : null}
    </p>
  );
}

function cardName(card: CardItem): string {
  if (card.kind === "suggestion") return `Suggestion by ${card.item.author.displayName}`;
  const first = card.item.comments[0];
  return `Comment by ${first ? first.author.displayName : ""}`;
}

export function Card({ card, actions, orphan }: { card: CardItem; actions: CardActions; orphan: boolean }): JSX.Element {
  const common = {
    "data-card-id": card.id,
    "data-line": card.line === null ? undefined : String(card.line),
    "data-open": card.stub === null && !orphan ? "true" : undefined,
    "aria-label": cardName(card),
  };
  if (card.stub !== null) {
    return (
      <article class="card card-stub" {...common}>
        <p class="stub-text">{card.stub}</p>
      </article>
    );
  }
  const choose = (event: MouseEvent | KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, textarea, input, a, [role='listbox']")) return;
    if (event instanceof KeyboardEvent && (event.key !== "Enter" || target !== event.currentTarget)) return;
    actions.onChoose(card);
  };
  const hover = {
    onMouseEnter: () => actions.onHover(card.id),
    onMouseLeave: () => actions.onHover(null),
  };
  if (card.kind === "suggestion") {
    const s = card.item;
    const pending = actions.pending.get(s.id) ?? null;
    return (
      <article class={`card card-suggestion${orphan ? " card-orphan" : ""}`} tabIndex={0} {...common}
        onClick={choose} onKeyDown={choose} {...hover}>
        <Author person={s.author} shared={actions.shared} />
        {pending ? (
          <p class="card-pending">{pending === "accept" ? "Accepting suggestion…" : "Rejecting suggestion…"}</p>
        ) : (
          <>
            <p class="card-change">
              {s.deleted ? <del class="card-del">{s.deleted}</del> : null}
              {s.deleted && s.inserted ? " " : null}
              {s.inserted ? <ins class="card-ins">{s.inserted}</ins> : null}
            </p>
            <p class="card-time"><time dateTime={s.createdAt}>{formatWhen(s.createdAt)}</time></p>
            {orphan ? <p class="card-note">This suggestion lost its passage.</p> : null}
          </>
        )}
        {actions.canResolve && !orphan ? (
          <div class="card-actions">
            <button type="button" class="small" disabled={pending !== null} aria-busy={pending === "accept" ? "true" : undefined}
              onClick={() => actions.onDecide(s, "accept")}>
              Accept
            </button>
            <button type="button" class="small" disabled={pending !== null} aria-busy={pending === "reject" ? "true" : undefined}
              onClick={() => actions.onDecide(s, "reject")}>
              Reject
            </button>
          </div>
        ) : null}
      </article>
    );
  }
  const t = card.item;
  const reply = actions.replies.get(t.id) ?? "";
  const busy = actions.busy.has(t.id);
  return (
    <article class={`card card-thread${orphan ? " card-orphan" : ""}`} tabIndex={0} {...common}
      onClick={choose} onKeyDown={choose} {...hover}>
      <blockquote class="card-quote">{t.quote}</blockquote>
      <ol class="comments">
        {t.comments.map((comment) => (
          <li key={comment.id}>
            <Author person={comment.author} shared={actions.shared} />
            <p class="comment-body">{comment.body}</p>
            <p class="card-time"><time dateTime={comment.createdAt}>{formatWhen(comment.createdAt)}</time></p>
          </li>
        ))}
      </ol>
      {actions.canReply ? (
        <div class="reply">
          <MentionField id={`reply-${t.id}`} label="Reply" value={reply} rows={reply ? 3 : 1} handles={actions.handles}
            onValue={(text) => actions.onReply(t.id, text)} />
          <div class="card-actions">
            <button type="button" class="small" disabled={busy} aria-busy={busy ? "true" : undefined}
              onClick={() => actions.onPostReply(t)}>
              Post reply
            </button>
            {actions.canResolve ? (
              <button type="button" class="small" disabled={busy} onClick={() => actions.onResolve(t)}>
                Resolve thread
              </button>
            ) : null}
          </div>
        </div>
      ) : actions.canResolve ? (
        <div class="card-actions">
          <button type="button" class="small" disabled={busy} onClick={() => actions.onResolve(t)}>
            Resolve thread
          </button>
        </div>
      ) : null}
    </article>
  );
}

const GAP = 8;

interface Placement {
  rail: HTMLElement;
  lineTop: (line: number) => number | null;
  focusedId: string | null;
  previous: Map<string, number>;
  glide: { delay: number } | null;
  fold: Map<string, { height: number; delay: number }>;
  motion: boolean;
  hovered: string | null;
  /** Cards already shown for this file; any other card is new and fades in at its line. */
  seen: Set<string> | null;
}

/**
 * Resting alignment: each card's top is level with its anchor line. Overlaps stack around
 * the focused card (or the first card) in document order with a fixed gap.
 */
export function placeCards(p: Placement): void {
  const { rail } = p;
  const cards = Array.from(rail.querySelectorAll<HTMLElement>(".cards > .card"));
  const desired = cards.map((card) => {
    const line = Number(card.dataset.line);
    const top = Number.isFinite(line) ? p.lineTop(line) : null;
    return Math.max(0, top ?? 0);
  });
  const heights = cards.map((card) => card.offsetHeight);
  const focus = cards.findIndex((card) => card.dataset.cardId === p.focusedId);
  const tops: number[] = new Array(cards.length).fill(0);
  const anchor = focus >= 0 ? focus : 0;
  if (cards.length) tops[anchor] = desired[anchor] as number;
  for (let i = anchor - 1; i >= 0; i -= 1) {
    tops[i] = Math.min(desired[i] as number, (tops[i + 1] as number) - GAP - (heights[i] as number));
  }
  for (let i = anchor + 1; i < cards.length; i += 1) {
    tops[i] = Math.max(desired[i] as number, (tops[i - 1] as number) + (heights[i - 1] as number) + GAP);
  }
  let bottom = 0;
  const tethers = rail.querySelector<SVGSVGElement>(".tethers");
  const paths: string[] = [];
  cards.forEach((card, i) => {
    const id = card.dataset.cardId as string;
    const top = tops[i] as number;
    card.style.top = `${top}px`;
    bottom = Math.max(bottom, top + (heights[i] as number));
    const before = p.previous.get(id);
    if (!p.motion) stopGlide(card);
    else if (p.glide && before !== undefined && Math.abs(before - top) > 0.5) glide(card, before + glideOffset(card) - top, p.glide.delay);
    if (p.seen && !p.seen.has(id) && p.motion) {
      card.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "cubic-bezier(.2,.7,.2,1)" });
    }
    const folding = p.fold.get(id);
    if (folding && p.motion) {
      foldCard(card, folding.height, folding.delay);
    }
    p.previous.set(id, top);
    const line = Number(card.dataset.line);
    const lineTop = Number.isFinite(line) ? p.lineTop(line) : null;
    if (lineTop !== null && card.dataset.open === "true") {
      const active = id === p.focusedId || id === p.hovered;
      const from = lineTop + 14;
      const to = top + 14;
      paths.push(`<path class="tether${active ? " tether-active" : ""}" d="M0 ${from} C 10 ${from}, 10 ${to}, 20 ${to}" />`);
    }
  });
  p.fold.clear();
  const box = rail.querySelector<HTMLElement>(".cards");
  if (box) box.style.minHeight = `${bottom + 24}px`;
  if (tethers) {
    tethers.setAttribute("height", String(bottom + 24));
    tethers.innerHTML = paths.join("");
  }
}
