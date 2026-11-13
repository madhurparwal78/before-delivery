import { useState } from "react";
import { api, download, failureOf } from "../api.ts";
import { useDecimals, useFeedback, useLive, useSession } from "../state.tsx";
import { ActionButton, Fig, Labelled, Link, Mono, Price } from "../ui.tsx";
import { displayHealth, displaySharePrice } from "../../shared/format.ts";
import type { Settlement } from "../types.ts";
import { LegsTable } from "./parts.tsx";
import { STATE_LABEL } from "../types.ts";

const PENDING_LINE = "Funds have moved. This settlement is not final until its statement and its PDF are confirmed in storage.";
const KIND_LABEL: Record<Settlement["kind"], string> = { draw: "Draw", withdrawal: "Liquidity withdrawal", liquidation: "Liquidation fill" };

export function SettlementView({ settlementId }: { settlementId: string }) {
  const decimalsOf = useDecimals();
  const { wall } = useSession();
  const feedback = useFeedback();
  const [pending, setPending] = useState(true);
  // A receipt reading Pending statement or Webhook queued asks again every 5 seconds.
  const { data: settlement } = useLive(
    () =>
      api<Settlement>("GET", `/api/settlements/${encodeURIComponent(settlementId)}`).then((s) => {
        setPending(s.statement_status !== "stored" || s.webhook_status !== "delivered");
        return s;
      }),
    pending ? 5000 : null,
    [settlementId],
  );

  /** The PDF is fetched with the bearer token and handed to the browser as a file. */
  async function downloadPdf() {
    try {
      const blob = await download(`/api/settlements/${encodeURIComponent(settlementId)}/statement.pdf`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `statement-${settlementId}.pdf`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      feedback.reportFailure(failureOf(error));
    }
  }

  if (!settlement) {
    return (
      <section className="sheet-section">
        <h1>Settlement receipt</h1>
        <p className="muted">Reading the settlement from the ledger.</p>
      </section>
    );
  }
  const debt = settlement.asset;
  const collateral = settlement.legs.find((l) => l.account.startsWith("collateral:"))?.asset ?? debt;
  return (
    <section className="sheet-section receipt">
      <h1>Settlement receipt</h1>
      <dl className="ledger-box figures">
        <Labelled label="Kind">{KIND_LABEL[settlement.kind]}</Labelled>
        <Labelled label="Settlement">
          <Mono>{settlement.settlement_id}</Mono>
        </Labelled>
        <Labelled label="Time">
          <Mono>{wall(settlement.created_at, true)}</Mono>
        </Labelled>
        {settlement.position_id ? (
          <Labelled label="Position">
            <Link href={`/positions/${settlement.position_id}`} className="inline-link">
              {settlement.position_id}
            </Link>
          </Labelled>
        ) : null}
        <Labelled label={settlement.kind === "liquidation" ? "Repaid" : "Amount"}>
          <Fig minor={settlement.amount} decimals={decimalsOf(debt)} asset={debt} />
        </Labelled>
        {settlement.kind === "draw" ? (
          <>
            <Labelled label="Debt after">
              <Fig minor={settlement.debt_after ?? "0"} decimals={decimalsOf(debt)} asset={debt} />
            </Labelled>
            <Labelled label="Health factor after">
              <Mono>{displayHealth(settlement.health_factor_after ?? null)}</Mono>
            </Labelled>
          </>
        ) : null}
        {settlement.kind === "withdrawal" ? (
          <>
            <Labelled label="Shares burned">
              <Fig minor={settlement.shares_burned ?? "0"} decimals={0} />
            </Labelled>
            <Labelled label="Share price after">
              <Mono>{displaySharePrice(settlement.share_price_after ?? "")}</Mono>
            </Labelled>
          </>
        ) : null}
        {settlement.kind === "liquidation" ? (
          <>
            <Labelled label="Seized">
              <Fig minor={settlement.seized ?? "0"} decimals={decimalsOf(collateral)} asset={collateral} />
            </Labelled>
            <Labelled label="Bonus amount">
              <Fig minor={settlement.bonus_amount ?? "0"} decimals={decimalsOf(collateral)} asset={collateral} />
            </Labelled>
            <Labelled label="Written off">
              <Fig minor={settlement.written_off ?? "0"} decimals={decimalsOf(debt)} asset={debt} />
            </Labelled>
            <Labelled label="Round">
              <Mono>{settlement.round}</Mono>
            </Labelled>
            <Labelled label="Health factor">
              <Mono>{`${displayHealth(settlement.health_factor_before ?? null)} → ${displayHealth(settlement.health_factor_after ?? null)}`}</Mono>
            </Labelled>
            <Labelled label="State after">{settlement.state_after ? STATE_LABEL[settlement.state_after] : null}</Labelled>
            <Labelled label={`${collateral} price`}>
              <Price value={settlement.price_collateral ?? "0"} />
            </Labelled>
            <Labelled label={`${debt} price`}>
              <Price value={settlement.price_debt ?? "0"} />
            </Labelled>
            <Labelled label="Borrower notice">{settlement.notice_status === "sent" ? "Sent" : "Queued, not yet sent"}</Labelled>
          </>
        ) : null}
      </dl>
      <h2>Legs</h2>
      <LegsTable legs={settlement.legs} label="Settlement legs" />
      <dl className="ledger-box figures">
        <Labelled label="Statement">
          <Mono className="breakable">{settlement.statement_key}</Mono>
        </Labelled>
      </dl>
      <div role="status" aria-label="Statement status" className={`statement-status${settlement.statement_status === "stored" ? " is-settled" : ""}`}>
        {settlement.statement_status === "stored" ? (
          "Settled"
        ) : (
          <>
            <strong>Pending statement</strong> <span>{PENDING_LINE}</span>
          </>
        )}
      </div>
      <div role="status" aria-label="Integrator webhook" className="webhook-status">
        {settlement.webhook_status === "delivered" ? "Webhook delivered." : "Webhook queued, not yet delivered."}
      </div>
      {settlement.statement_status === "stored" ? (
        <div className="actions">
          <ActionButton onClick={() => void downloadPdf()}>Download PDF statement</ActionButton>
        </div>
      ) : null}
    </section>
  );
}
