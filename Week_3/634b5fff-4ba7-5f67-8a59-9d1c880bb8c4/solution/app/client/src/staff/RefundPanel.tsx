import { useCallback, useEffect, useRef, useState } from "react";
import { ERRORS, STAFF_COPY } from "../../../shared/copy.js";
import { parseKroner } from "../../../shared/money.js";
import { Button, TextField } from "../ui.js";
import { call, failureText, say, sleep } from "./desk.js";
import { LedgerView } from "./LedgerView.js";
import type { Ledger, Refund } from "./types.js";

const SETTLE_SECONDS = 60;

/** The refund form and the ledger of one order, open under its row. */
export const RefundPanel = ({ reference, onRefunded }: { reference: string; onRefunded: () => Promise<void> }) => {
  const [ledger, setLedger] = useState<Ledger | null>(null);
  const [amount, setAmount] = useState("");
  const [invalid, setInvalid] = useState("");
  const turn = useRef(0);

  const loadLedger = useCallback(async (): Promise<Ledger | null> => {
    try {
      const reply = await call<Ledger>("GET", `/api/staff/orders/${reference}/ledger`);
      setLedger(reply.body);
      return reply.body;
    } catch (error) {
      say(failureText(error), true);
      return null;
    }
  }, [reference]);

  useEffect(() => {
    void loadLedger();
    return () => {
      turn.current += 1;
    };
  }, [loadLedger]);

  /** A pending refund is watched until the ledger shows it settled. */
  const watch = async (refundId: string, mine: number): Promise<void> => {
    for (let second = 0; second < SETTLE_SECONDS; second += 1) {
      await sleep(1000);
      if (mine !== turn.current) return;
      const fresh = await loadLedger();
      if (fresh?.refunds.some((refund) => refund.refundId === refundId && refund.state === "settled")) {
        await onRefunded();
        say(STAFF_COPY.refundSettled);
        return;
      }
    }
  };

  const refund = async (amountOre: number): Promise<void> => {
    const mine = ++turn.current;
    setInvalid("");
    try {
      const reply = await call<Refund>("POST", `/api/staff/orders/${reference}/refunds`, {
        json: { amountOre }, headers: { "Idempotency-Key": crypto.randomUUID() },
      });
      setAmount("");
      await Promise.all([loadLedger(), onRefunded()]);
      if (reply.body.state === "settled") {
        say(STAFF_COPY.refundSettled);
        return;
      }
      say(STAFF_COPY.refundPending);
      await watch(reply.body.refundId, mine);
    } catch (error) {
      say(failureText(error), true);
    }
  };

  const refuse = (): void => {
    const message = ERRORS.refund_invalid.message();
    setInvalid(message);
    say(message, true);
  };

  const submit = (): void => {
    const amountOre = parseKroner(amount);
    if (amountOre === null || amountOre === 0) refuse();
    else void refund(amountOre);
  };

  const refundRest = async (): Promise<void> => {
    const fresh = await loadLedger();
    if (!fresh) return;
    const remainder = fresh.grossOre - fresh.refunds.reduce((total, each) => total + each.amountOre, 0);
    if (remainder <= 0) refuse();
    else await refund(remainder);
  };

  return (
    <div className="staff-panel">
      <form
        className="staff-refund"
        aria-label={`Refund ${reference}`}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <TextField
          label="Refund amount in DKK"
          id={`refund-${reference}`}
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          error={invalid}
          onChange={(event) => setAmount(event.target.value)}
        />
        <div className="staff-actions staff-actions--row">
          <Button variant="primary" type="submit">Refund</Button>
          <Button onClick={() => void refundRest()}>Refund the rest</Button>
        </div>
      </form>
      <LedgerView ledger={ledger} />
    </div>
  );
};
