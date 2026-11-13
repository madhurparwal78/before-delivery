import { useMemo, useState } from "react";
import { api, newKey } from "../api.ts";
import { useDecimals, useLive, useSession } from "../state.tsx";
import { ActionButton, amountCopy, amountError, Field, Fig, Labelled, Mono, Price, typedAmount, useAction } from "../ui.tsx";
import { displayHealth } from "../../shared/format.ts";
import type { Notice, Position, Settlement } from "../types.ts";
import { LIQUIDATION_STATES, PlumbLine, StateLabel } from "./parts.tsx";
import { ShockRuler } from "./ShockRuler.tsx";

const NOTICE_COPY: Record<Notice["kind"], Record<Notice["status"], string>> = {
  margin: { sent: "Margin notice sent.", queued: "Margin notice queued, not yet sent." },
  liquidation: { sent: "Liquidation notice sent.", queued: "Liquidation notice queued, not yet sent." },
};

interface Repayment {
  amount: string;
  health_factor_after: string | null;
}

export function PositionView({ positionId }: { positionId: string }) {
  const { market, member, wall } = useSession();
  const decimalsOf = useDecimals();
  const { data: position } = useLive(() => api<Position>("GET", `/api/positions/${encodeURIComponent(positionId)}`), 5000, [positionId]);
  const [drawTyped, setDrawTyped] = useState("");
  const [repayTyped, setRepayTyped] = useState("");
  const [changeTyped, setChangeTyped] = useState("");
  const [lostDraw, setLostDraw] = useState<{ body: { amount: string }; key: string } | null>(null);
  const drawAction = useAction(useMemo(() => ({ amount: { id: "draw-amount", label: "Draw amount" } }), []));
  const repayAction = useAction(useMemo(() => ({ amount: { id: "repay-amount", label: "Repay amount" } }), []));
  const collateralAction = useAction(useMemo(() => ({ amount: { id: "collateral-change", label: "Collateral change" } }), []));

  if (!position) {
    return (
      <section className="sheet-section">
        <h1>{`Position ${positionId}`}</h1>
        <p className="muted">Reading the position from the ledger.</p>
      </section>
    );
  }

  const pool = market?.pools.find((p) => p.asset === position.collateral_asset);
  const debtAsset = position.debt_asset;
  const debtDecimals = decimalsOf(debtAsset);
  const collateralDecimals = decimalsOf(position.collateral_asset);
  const owner = member?.actor_id === position.borrower_id;
  const busy = drawAction.busy !== null || repayAction.busy !== null || collateralAction.busy !== null;
  const base = `/api/positions/${encodeURIComponent(position.position_id)}`;

  async function sendDraw(body: { amount: string }, key: string) {
    const settlement = await drawAction.run("draw", {
      pending: "Drawing",
      call: () => api<Settlement>("POST", `${base}/draws`, body, key),
      done: (s) => ({
        text: `Drew ${amountCopy(s.amount, debtDecimals, s.asset)}. Health factor now ${displayHealth(s.health_factor_after ?? null)}.`,
        link: { href: `/settlements/${s.settlement_id}`, label: "View receipt" },
      }),
      failed: (failure) => setLostDraw(failure.kind === "network" ? { body, key } : null),
    });
    if (settlement) setLostDraw(null);
  }

  function draw() {
    const amount = typedAmount(drawTyped, debtDecimals);
    if ("error" in amount) {
      drawAction.showFieldErrors({ amount: amount.error });
      return;
    }
    void sendDraw({ amount: amount.minor }, newKey());
  }

  function repay() {
    const amount = typedAmount(repayTyped, debtDecimals);
    if ("error" in amount) {
      repayAction.showFieldErrors({ amount: amount.error });
      return;
    }
    sendRepayment(amount.minor);
  }

  /** "all" repays the debt accrued to the second of the request. */
  function repayAll() {
    sendRepayment("all");
  }

  function sendRepayment(amount: string) {
    void repayAction.run("repay", {
      pending: "Repaying",
      call: () => api<Repayment>("POST", `${base}/repayments`, { amount }),
      done: (r) => ({
        text:
          r.health_factor_after === null
            ? `Repaid ${amountCopy(r.amount, debtDecimals, debtAsset)}. No debt remains.`
            : `Repaid ${amountCopy(r.amount, debtDecimals, debtAsset)}. Health factor now ${displayHealth(r.health_factor_after)}.`,
      }),
    });
  }

  function changeCollateral(direction: "add" | "withdraw") {
    const amount = typedAmount(changeTyped, collateralDecimals);
    if ("error" in amount) {
      collateralAction.showFieldErrors({ amount: amount.error });
      return;
    }
    const verb = direction === "add" ? "added" : "withdrawn";
    void collateralAction.run(direction, {
        pending: direction === "add" ? "Adding collateral" : "Withdrawing collateral",
        call: () => api<Position>("POST", `${base}/${direction === "add" ? "collateral" : "collateral-withdrawals"}`, { amount: amount.minor }),
        done: (p) => ({
          text:
            p.state === "closed"
              ? `Collateral ${verb}. Position closed.`
              : p.health_factor === null
                ? `Collateral ${verb}. No debt is drawn.`
                : `Collateral ${verb}. Health factor now ${displayHealth(p.health_factor)}.`,
        }),
      });
  }

  return (
    <section className="sheet-section position-page">
      <div className="position-title">
        <h1>{`Position ${position.position_id}`}</h1>
        <StateLabel state={position.state} role="status" />
      </div>
      {pool ? <PlumbLine healthFactor={position.health_factor} warning={pool.params.warning_health_factor} below={LIQUIDATION_STATES.includes(position.state)} /> : null}
      <dl className="ledger-box figures position-figures">
        <Labelled label="Debt">
          <Fig minor={position.debt} decimals={debtDecimals} asset={position.debt_asset} />
        </Labelled>
        <Labelled label="Collateral">
          <Fig minor={position.collateral_amount} decimals={collateralDecimals} asset={position.collateral_asset} />
        </Labelled>
        <Labelled label="Health factor">
          <Mono className={LIQUIDATION_STATES.includes(position.state) ? "signal-figure" : undefined}>{displayHealth(position.health_factor)}</Mono>
        </Labelled>
        <Labelled label="Liquidation price">{position.liquidation_price === null ? <Mono>None</Mono> : <Price value={position.liquidation_price} />}</Labelled>
        {position.grace_ends_at ? (
          <Labelled label="Grace ends">
            <Mono>{wall(position.grace_ends_at)}</Mono>
          </Labelled>
        ) : null}
        <Labelled label="Round">
          <Mono>{position.round}</Mono>
        </Labelled>
        <Labelled label="Borrower">
          <Mono>{position.borrower_id}</Mono>
        </Labelled>
      </dl>

      {owner && position.state !== "closed" ? (
        <div className="position-actions">
          <div className="form-row">
            <Field id="draw-amount" label="Draw amount" value={drawTyped} onChange={setDrawTyped} error={drawAction.errors["draw-amount"] ?? amountError(drawTyped, debtDecimals)} enterButton="draw-button" />
            <ActionButton id="draw-button" busy={busy} onClick={draw}>
              Draw
            </ActionButton>
            {lostDraw ? (
              <ActionButton busy={busy} tone="quiet" onClick={() => void sendDraw(lostDraw.body, lostDraw.key)}>
                Retry
              </ActionButton>
            ) : null}
          </div>
          <div className="form-row">
            <Field id="repay-amount" label="Repay amount" value={repayTyped} onChange={setRepayTyped} error={repayAction.errors["repay-amount"] ?? amountError(repayTyped, debtDecimals)} enterButton="repay-button" />
            <ActionButton id="repay-button" busy={busy} onClick={repay}>
              Repay
            </ActionButton>
            <ActionButton busy={busy} tone="quiet" onClick={repayAll}>
              Repay all
            </ActionButton>
          </div>
          <div className="form-row">
            <Field id="collateral-change" label="Collateral change" value={changeTyped} onChange={setChangeTyped} error={collateralAction.errors["collateral-change"] ?? amountError(changeTyped, collateralDecimals)} enterButton="add-collateral-button" />
            <ActionButton id="add-collateral-button" busy={busy} onClick={() => changeCollateral("add")}>
              Add collateral
            </ActionButton>
            <ActionButton busy={busy} onClick={() => changeCollateral("withdraw")}>
              Withdraw collateral
            </ActionButton>
          </div>
        </div>
      ) : null}

      <h2>Notices</h2>
      {position.notices.length === 0 ? <p className="muted">No notices for this position.</p> : null}
      <ul aria-label="Notices" className="notice-list">
        {position.notices.map((n) => (
          <li key={n.notice_id}>
            <span>{NOTICE_COPY[n.kind][n.status]}</span> <Mono>{wall(n.created_at)}</Mono>
          </li>
        ))}
      </ul>
      {pool ? <ShockRuler pool={pool} ownPositionId={position.position_id} /> : null}
    </section>
  );
}
