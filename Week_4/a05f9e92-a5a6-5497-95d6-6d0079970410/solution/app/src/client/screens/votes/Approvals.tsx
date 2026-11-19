import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import type { ApprovalCard } from "../../../server/changes.js";
import { useAnnounce } from "../../lib/announce.js";
import { Modal } from "../../lib/dialog.js";
import { failureText, get, post } from "../../lib/api.js";
import { useTopics } from "../../lib/live.js";
import { navigate } from "../../lib/router.js";
import { useSession } from "../../lib/session.js";
import { Button, Page, Rest, StatusBlock, loadingScreen, useLoad, useViewport } from "../../lib/ui.js";
import { pressFeedback, useCardGesture } from "./gesture.js";
import { formatLocalIso } from "../../../shared/tz.js";
import { useUndoQueue } from "./undo.js";

type Decision = "approve" | "reject";

interface Swiped {
  key: string;
  card: ApprovalCard;
  decision: Decision;
}

type Intent = { kind: "card"; key: string } | { kind: "empty" } | null;

const VERB: Record<Decision, string> = { approve: "Approving", reject: "Rejecting" };

function VoteCard({
  card,
  depth,
  stacked,
  zone,
  error,
  busy,
  onDecide,
  onSwipe,
  onSheet,
}: {
  card: ApprovalCard;
  depth: number;
  stacked: boolean;
  zone: string;
  error: string | undefined;
  busy: boolean;
  onDecide(decision: Decision): void;
  onSwipe(decision: Decision): void;
  onSheet(): void;
}): JSX.Element {
  const gesture = useCardGesture({
    enabled: stacked && depth === 0,
    directions: ["left", "right"],
    onSwipe: (direction) => onSwipe(direction === "right" ? "approve" : "reject"),
    onLongPress: onSheet,
  });
  const behind = stacked && depth > 0 ? { inert: "" } : {};
  return (
    <article
      aria-label={`${card.record}: ${card.title}`}
      className="vote-card"
      tabIndex={-1}
      data-card={card.id}
      data-press=""
      data-depth={stacked ? depth : undefined}
      style={{ "--depth": depth } as CSSProperties}
      {...behind}
      {...gesture}
    >
      <div className="vote-head">
        <p className="vote-number">{card.record}</p>
        <StatusBlock outlined={card.kind === "request_item"}>{card.kind === "change_step" ? "Change vote" : "Catalog approval"}</StatusBlock>
      </div>
      <h2 className="vote-title">{card.title}</h2>
      <dl className="vote-facts">
        {card.step ? (
          <>
            <div>
              <dt>Step</dt>
              <dd>{card.step.name}</dd>
            </div>
            <div>
              <dt>Closes</dt>
              <dd>{card.closes_at ? formatLocalIso(card.closes_at, zone) : "No deadline"}</dd>
            </div>
          </>
        ) : (
          <div>
            <dt>Item</dt>
            <dd>{card.title}</dd>
          </div>
        )}
      </dl>
      <div className="vote-actions">
        <Button busy={busy} onClick={() => onDecide("approve")}>
          Approve
        </Button>
        <Button variant="outline" busy={busy} onClick={() => onDecide("reject")}>
          Reject
        </Button>
      </div>
      {error ? <p className="form-error vote-error">{error}</p> : null}
    </article>
  );
}

function VoteSheet({ card, onClose, onDecide }: { card: ApprovalCard; onClose(): void; onDecide(decision: Decision): void }): JSX.Element {
  return (
    <Modal label="Vote actions" sheet onClose={onClose} className="votes-sheet">
      <p className="sheet-title">
        {card.record}: {card.title}
      </p>
      <div className="sheet-actions">
        <Button
          onClick={() => {
            onClose();
            onDecide("approve");
          }}
        >
          Approve
        </Button>
        <Button
          variant="outline"
          onClick={() => {
            onClose();
            onDecide("reject");
          }}
        >
          Reject
        </Button>
        {card.kind === "change_step" ? (
          <Button
            variant="outline"
            onClick={() => {
              onClose();
              navigate(`/desk/records/${card.record}`);
            }}
          >
            Open record
          </Button>
        ) : null}
        <Button variant="outline" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </Modal>
  );
}

/** Approvals (`/approve`): the votes waiting on the signed-in person, as a phone stack or a column of cards. */
export function ApprovalsScreen(): JSX.Element {
  const session = useSession();
  const announce = useAnnounce();
  const phone = useViewport() === "phone";
  const zone = session.user?.time_zone ?? "UTC";
  const { state, reload, setData } = useLoad(async () => (await get<{ approvals: ApprovalCard[] }>("/api/approvals")).approvals, [session.accessVersion]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ApprovalCard | null>(null);
  const cardsRef = useRef<ApprovalCard[]>([]);
  const intent = useRef<Intent>(null);
  const emptyAction = useRef<HTMLDivElement>(null);
  cardsRef.current = state.status === "ready" ? state.data : [];

  const decide = useCallback(
    async (card: ApprovalCard, decision: Decision): Promise<void> => {
      setErrors((previous) => ({ ...previous, [card.id]: "" }));
      try {
        await post(`/api/approvals/${card.id}/decision`, { decision, comment: "" });
      } catch (error) {
        const message = failureText(error);
        setErrors((previous) => ({ ...previous, [card.id]: message }));
        announce(message);
        return;
      }
      announce(`Vote recorded: ${decision} on ${card.record}.`);
      const list = cardsRef.current;
      const at = list.findIndex((entry) => entry.id === card.id);
      if (at >= 0) {
        const neighbour = list[at + 1] ?? list[at - 1];
        intent.current = neighbour ? { kind: "card", key: neighbour.id } : { kind: "empty" };
        setData(list.filter((entry) => entry.id !== card.id));
      }
    },
    [announce, setData],
  );

  const swiped = useUndoQueue<Swiped>((entry) => decide(entry.card, entry.decision));
  const hiddenIds = new Set(swiped.held.map((entry) => entry.value.card.id));
  const cards = cardsRef.current.filter((card) => !hiddenIds.has(card.id));
  const waiting = swiped.held.filter((entry) => !entry.sent);

  const press = async (card: ApprovalCard, decision: Decision): Promise<void> => {
    setBusy(card.id);
    await decide(card, decision);
    setBusy(null);
  };

  useTopics(["approvals"], (message) => {
    if (message.event === "reset" && typeof message.data.number === "string") announce(`${message.data.number} changed and needs a new vote.`);
    reload();
  });

  useEffect(() => {
    const target = intent.current;
    if (!target) return;
    const node = target.kind === "card" ? document.querySelector<HTMLElement>(`[data-card="${CSS.escape(target.key)}"]`) : emptyAction.current?.querySelector("button") ?? null;
    if (!node) return;
    node.focus();
    intent.current = null;
  });

  const loading = loadingScreen(state, "Your votes", reload);
  if (loading) return loading;

  if (cards.length === 0 && swiped.held.length === 0) {
    return (
      <Page subject="Your votes">
        <div className="votes-empty">
          <p className="state-line">No votes waiting for you.</p>
          <div className="state-action" ref={emptyAction}>
            <Button onClick={() => navigate("/desk/changes/calendar")}>
              Open changes
            </Button>
          </div>
        </div>
      </Page>
    );
  }

  return (
    <Page subject="Your votes">
      <Rest narrow className="votes-rest">
        <div className="votes-body" onPointerDown={pressFeedback}>
          {waiting.map(({ value }) => (
            <div className="undo-bar" key={value.key}>
              <p>{`${VERB[value.decision]} ${value.card.record}. Undo within 5 seconds.`}</p>
              <Button
                onClick={() => {
                  swiped.undo(value.key);
                  announce("Vote undone.");
                  intent.current = { kind: "card", key: value.card.id };
                }}
              >
                Undo
              </Button>
            </div>
          ))}
          <div className={phone ? "vote-stack" : "vote-list"} data-count={cards.length}>
            {cards.map((card, depth) => (
              <VoteCard
                key={card.id}
                card={card}
                depth={depth}
                stacked={phone}
                zone={zone}
                error={errors[card.id]}
                busy={busy === card.id}
                onDecide={(decision) => void press(card, decision)}
                onSwipe={(decision) => {
                  announce(`${VERB[decision]} ${card.record}. Undo within 5 seconds.`);
                  swiped.hold({ key: card.id, card, decision });
                }}
                onSheet={() => setSheet(card)}
              />
            ))}
          </div>
          {phone && cards.length > 0 ? <p className="muted vote-hint">Swipe right to approve, left to reject, or hold a card for more.</p> : null}
        </div>
      </Rest>
      {sheet ? <VoteSheet card={sheet} onClose={() => setSheet(null)} onDecide={(decision) => void press(sheet, decision)} /> : null}
    </Page>
  );
}
