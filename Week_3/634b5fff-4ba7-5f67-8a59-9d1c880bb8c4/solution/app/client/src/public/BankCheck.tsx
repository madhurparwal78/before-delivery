import { useEffect, useRef, useState, type FormEvent } from "react";
import { formatDkk } from "../../../shared/money.js";
import { Button, TextField } from "../ui.js";
import { LABELS } from "./copy.js";
import { useDialog } from "./useDialog.js";

interface BankCheckProps {
  lastFour: string;
  totalOre: number;
  expiresInMs: number;
  onApprove: (code: string) => void;
  onCancel: () => void;
  onExpire: () => void;
  returnTo: () => HTMLElement | null;
}

/** The bank's check, drawn by the app itself: a modal that ends when the server says the check does. */
export const BankCheck = ({ lastFour, totalOre, expiresInMs, onApprove, onCancel, onExpire, returnTo }: BankCheckProps) => {
  const root = useRef<HTMLDivElement>(null);
  const [code, setCode] = useState("");
  const onKeyDown = useDialog(root, { onEscape: onCancel, returnTo });
  const expire = useRef(onExpire);
  expire.current = onExpire;

  useEffect(() => {
    const timer = window.setTimeout(() => expire.current(), expiresInMs);
    return () => window.clearTimeout(timer);
  }, [expiresInMs]);

  const approve = (event: FormEvent): void => {
    event.preventDefault();
    onApprove(code.trim());
  };

  return (
    <div className="scrim scrim--sheet on-sheet" onKeyDown={onKeyDown}>
      <div ref={root} role="dialog" aria-modal="true" aria-label={LABELS.bankCheck.dialog} className="dialog dialog--sheet">
        <h2>{LABELS.bankCheck.dialog}</h2>
        <p>
          Your bank is checking a payment of <strong>{formatDkk(totalOre)}</strong> on the card ending <strong>{lastFour}</strong>. Enter the code it sent you.
        </p>
        <form onSubmit={approve} noValidate>
          <TextField label={LABELS.bankCheck.code} value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" />
          <div className="dialog__actions">
            <Button type="submit" variant="primary">{LABELS.bankCheck.approve}</Button>
            <Button variant="secondary" onClick={onCancel}>{LABELS.bankCheck.cancel}</Button>
          </div>
        </form>
      </div>
    </div>
  );
};
