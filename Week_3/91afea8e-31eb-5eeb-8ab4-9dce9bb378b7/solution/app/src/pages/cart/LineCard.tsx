import { Bookmark, Heart, Trash2 } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { rupees } from "../../../shared/format";
import { Button } from "../../components/Button";
import { useCart } from "../../lib/cart";
import type { QuoteLine } from "../../lib/types";
import { fieldMessage, useBusy, useCartActions } from "./actions";
import { LineBill } from "./BillLine";
import { formatRemaining, useCountdown } from "./countdown";

const GIFT_MESSAGE_MAX = 240;

export const quantityId = (lineId: string): string => `qty-${lineId}`;

function DealTimer({ endsAt, serverTime }: { endsAt: string; serverTime: string }): ReactNode {
  const { reload } = useCart();
  const remaining = useCountdown(endsAt, serverTime, () => void reload());
  return (
    <p className="line__deal">
      deal ends in{" "}
      <span role="timer" aria-label="Deal ends in">
        {formatRemaining(remaining)}
      </span>
    </p>
  );
}

interface QuantityProps {
  line: QuoteLine;
  onCommit: (quantity: number) => Promise<boolean>;
}

/** Applies on blur or Enter, and at once for the stepper keys and arrows. */
function QuantityField({ line, onCommit }: QuantityProps): ReactNode {
  const [draft, setDraft] = useState(String(line.quantity));
  const input = useRef<HTMLInputElement>(null);
  const sent = useRef<number | null>(null);

  useEffect(() => {
    sent.current = null;
    if (document.activeElement !== input.current) setDraft(String(line.quantity));
  }, [line.quantity]);

  const commit = (text: string): void => {
    const quantity = Number(text);
    if (text.trim() === "") {
      setDraft(String(line.quantity));
      return;
    }
    if (quantity === line.quantity || quantity === sent.current) return;
    sent.current = quantity;
    void onCommit(quantity).then((applied) => {
      if (!applied) sent.current = null;
    });
  };

  const change = (event: ChangeEvent<HTMLInputElement>): void => {
    setDraft(event.target.value);
    if ((event.nativeEvent as InputEvent).inputType === undefined) commit(event.target.value);
  };

  const key = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Enter") commit(event.currentTarget.value);
  };

  return (
    <div className="line__field">
      <label htmlFor={quantityId(line.line_id)}>qty</label>
      <input
        ref={input}
        id={quantityId(line.line_id)}
        type="number"
        inputMode="numeric"
        min={1}
        max={10}
        aria-label={`Quantity for ${line.title}`}
        value={draft}
        onChange={change}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={key}
      />
    </div>
  );
}

interface LineCardProps {
  line: QuoteLine;
  serverTime: string;
  cardClass: string;
  /** Called before a request that takes the line out of the cart, so focus can go to its neighbour. */
  onLeave: (lineId: string) => void;
  onLeaveFailed: () => void;
}

export function LineCard({ line, serverTime, cardClass, onLeave, onLeaveFailed }: LineCardProps): ReactNode {
  const actions = useCartActions();
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(line.selected);
  const [wrapped, setWrapped] = useState(line.gift_wrap);
  const [message, setMessage] = useState(line.gift_message);
  const note = useRef<HTMLTextAreaElement>(null);
  const [saving, save] = useBusy();
  const [moving, move] = useBusy();
  const [removing, remove] = useBusy();

  useEffect(() => setSelected(line.selected), [line.selected]);
  useEffect(() => setWrapped(line.gift_wrap), [line.gift_wrap]);
  useEffect(() => {
    if (document.activeElement !== note.current) setMessage(line.gift_message);
  }, [line.gift_message]);

  const attempt = async (work: () => Promise<unknown>): Promise<boolean> => {
    setError(null);
    try {
      await work();
      return true;
    } catch (failure) {
      setError(fieldMessage(failure));
      setSelected(line.selected);
      setWrapped(line.gift_wrap);
      return false;
    }
  };

  const leaving = (work: () => Promise<unknown>): Promise<void> => {
    onLeave(line.line_id);
    return attempt(work).then((done) => {
      if (!done) onLeaveFailed();
    });
  };

  const commitMessage = (): void => {
    if (message !== line.gift_message) void attempt(() => actions.patchLine(line.line_id, { gift_message: message }));
  };

  return (
    <li className={`card line ${cardClass}`}>
      <img className="line__art" src={line.image_url} alt={line.title} width={96} height={96} />
      <div className="line__main">
        <h3 className="line__title">
          <Link to={`/p/${line.product_id}`}>{line.title}</Link>
        </h3>
        <p className="line__price">
          <span className="amount">{rupees(line.unit_price_paise)}</span> each
        </p>
        {line.deal && <DealTimer endsAt={line.deal.ends_at} serverTime={serverTime} />}
        {!line.in_stock && <p className="line__soldout">Sold out. Remove it or save it for later.</p>}
      </div>
      <div className="line__controls">
        <label className="choice">
          <input
            type="checkbox"
            aria-label={`Select ${line.title}`}
            checked={selected}
            onChange={(event) => {
              setSelected(event.target.checked);
              void attempt(() => actions.patchLine(line.line_id, { selected: event.target.checked }));
            }}
          />
          select
        </label>
        <QuantityField line={line} onCommit={(quantity) => attempt(() => actions.patchLine(line.line_id, { quantity }))} />
        <label className="choice">
          <input
            type="checkbox"
            aria-label={`Gift wrap ${line.title}`}
            checked={wrapped}
            onChange={(event) => {
              setWrapped(event.target.checked);
              void attempt(() => actions.patchLine(line.line_id, { gift_wrap: event.target.checked }));
            }}
          />
          gift wrap
        </label>
      </div>
      {wrapped && (
        <div className="line__gift">
          <label htmlFor={`gift-${line.line_id}`}>gift message</label>
          <textarea
            ref={note}
            id={`gift-${line.line_id}`}
            aria-label={`Gift message for ${line.title}`}
            maxLength={GIFT_MESSAGE_MAX}
            rows={2}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onBlur={commitMessage}
          />
          <span className="line__counter">
            {message.length}/{GIFT_MESSAGE_MAX}
          </span>
        </div>
      )}
      {error && <p className="field-error line__error">{error}</p>}
      <LineBill line={line} />
      <div className="line__actions">
        <Button small busy={saving} aria-label={`Save ${line.title} for later`} onClick={() => void save(() => leaving(() => actions.saveForLater(line.line_id)))}>
          <Bookmark size={18} aria-hidden="true" />
          save for later
        </Button>
        <Button small busy={moving} aria-label={`Move ${line.title} to wishlist`} onClick={() => void move(() => leaving(() => actions.moveToWishlist(line.line_id)))}>
          <Heart size={18} aria-hidden="true" />
          wishlist
        </Button>
        <Button small busy={removing} aria-label={`Remove ${line.title}`} onClick={() => void remove(() => leaving(() => actions.removeLine(line.line_id)))}>
          <Trash2 size={18} aria-hidden="true" />
          remove
        </Button>
      </div>
    </li>
  );
}
