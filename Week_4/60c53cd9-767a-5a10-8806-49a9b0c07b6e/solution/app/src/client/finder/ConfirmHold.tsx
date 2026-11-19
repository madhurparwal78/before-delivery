/** The Confirm hold alert dialog: sends the unit and the price version shown, and states every published outcome in place. */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PublicHold, PublicUnit } from "../../shared/api-types.js";
import { COPY, holdAttemptsMessage } from "../../shared/copy.js";
import { api, errorOf, NetworkError } from "../api.js";
import { Modal } from "../dialogs.js";
import { dollars } from "../format.js";
import { readUnit } from "../unit-cache.js";

interface Props {
  readonly code: string;
  readonly price: number;
  readonly priceVersion: number;
  readonly onPlaced: (hold: PublicHold) => void;
  readonly onLostRace: () => void;
  readonly onExpired: () => void;
  readonly onRepriced: (unit: PublicUnit) => void;
  readonly onCancel: () => void;
  readonly restoreFocus: () => HTMLElement | null;
}

const newKey = (): string => `hw-${crypto.randomUUID()}`;

export const ConfirmHold = ({ code, price, priceVersion, onPlaced, onLostRace, onExpired, onRepriced, onCancel, restoreFocus }: Props): ReactNode => {
  const [question, setQuestion] = useState({ price, priceVersion });
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState("");
  const [wait, setWait] = useState(0);
  const key = useRef(newKey());
  const keepKey = useRef(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const [replies, setReplies] = useState(0);

  // Focus stays on Confirm hold after every reply, even though the button was disabled while the request was in flight.
  useEffect(() => {
    confirmRef.current?.focus();
  }, [replies]);

  useEffect(() => {
    if (wait <= 0) return undefined;
    const tick = window.setInterval(() => setWait((previous) => Math.max(0, previous - 1)), 1000);
    return () => window.clearInterval(tick);
  }, [wait > 0]);

  const press = async (): Promise<void> => {
    if (sending || wait > 0) return;
    if (!keepKey.current) key.current = newKey();
    setSending(true);
    setMessage("");
    try {
      const result = await api<{ hold: PublicHold }>("POST", "/api/holds", {
        json: { unitCode: code, priceVersion: question.priceVersion },
        headers: { "idempotency-key": key.current },
      });
      keepKey.current = false;
      if (result.status === 201) {
        onPlaced(result.body.hold);
        return;
      }
      if (result.status === 401) {
        onExpired();
        return;
      }
      const error = errorOf(result);
      setMessage(error?.message ?? "");
      if (result.status === 429) setWait(Math.max(1, Number(result.headers.get("retry-after") ?? "1")));
      if (error?.code === "unit_unavailable") onLostRace();
      if (error?.code === "price_changed") {
        const read = await readUnit(code, true);
        if (read.unit) {
          setQuestion({ price: read.unit.price, priceVersion: read.unit.priceVersion });
          onRepriced(read.unit);
        }
      }
    } catch (error) {
      if (!(error instanceof NetworkError)) throw error;
      keepKey.current = true;
      setMessage(COPY.lostReply);
    } finally {
      setSending(false);
      setReplies((count) => count + 1);
    }
  };

  const shown = wait > 0 ? holdAttemptsMessage(wait) : message;

  return (
    <Modal label="Confirm hold" role="alertdialog" onClose={onCancel} className="modal-confirm" scrim restoreFocus={restoreFocus}>
      <h2>
        Hold {code} at {dollars(question.price)}?
      </h2>
      <p>{COPY.noPayment}</p>
      <p className="form-message" aria-live="polite">
        {shown}
      </p>
      <div className="actions">
        <button ref={confirmRef} type="button" className="button primary-solid" disabled={sending || wait > 0} onClick={() => void press()}>
          {sending ? "Holding..." : "Confirm hold"}
        </button>
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </Modal>
  );
};
