import { useMemo, useState } from "react";
import { api } from "../api.ts";
import { useDecimals, useLive, useSession } from "../state.tsx";
import { ActionButton, amountCopy, amountError, Field, Fig, Link, Mono, Select, typedAmount, useAction } from "../ui.tsx";
import type { Position } from "../types.ts";
import { displayHealth } from "../../shared/format.ts";
import { StateLabel } from "./parts.tsx";

export function BorrowView() {
  const { market, member } = useSession();
  const decimalsOf = useDecimals();
  const [collateralAsset, setCollateralAsset] = useState("MBTC");
  const [debtAsset, setDebtAsset] = useState("QUSD");
  const [typed, setTyped] = useState("");
  // The member's positions, newest first, so a position just opened is the next Tab stop after Open position.
  const { data: positions, reload } = useLive(
    member ? () => api<{ positions: Position[] }>("GET", "/api/positions?include_closed=true").then((b) => b.positions.filter((p) => p.borrower_id === member.actor_id).reverse()) : null,
    5000,
    [member?.actor_id],
  );
  const fields = useMemo(
    () => ({
      collateral_amount: { id: "collateral-amount", label: "Collateral amount" },
      collateral_asset: { id: "collateral-asset", label: "Collateral asset" },
      debt_asset: { id: "borrow-asset", label: "Borrow asset" },
    }),
    [],
  );
  const { busy, errors, run, showFieldErrors } = useAction(fields);
  const options = (market?.pools ?? []).map((p) => ({ value: p.asset, label: p.asset }));
  const decimals = decimalsOf(collateralAsset);

  async function open() {
    const amount = typedAmount(typed, decimals);
    if ("error" in amount) {
      showFieldErrors({ collateral_amount: amount.error });
      return;
    }
    await run("open", {
      pending: "Opening position",
      call: async () => {
        const opened = await api<Position>("POST", "/api/positions", { collateral_asset: collateralAsset, debt_asset: debtAsset, collateral_amount: amount.minor });
        await reload();
        return opened;
      },
      done: (p) => ({ text: `Position opened with ${amountCopy(p.collateral_amount, decimals, p.collateral_asset)} collateral.` }),
    });
  }

  return (
    <section className="sheet-section">
      <h1>Borrow</h1>
      <p className="lede">Lock collateral in one asset and borrow another against it. Keep the health factor above 1; the server decides every state.</p>
      <h2>Open a position</h2>
      <div className="form-grid">
        <Select id="collateral-asset" label="Collateral asset" value={collateralAsset} options={options} onChange={setCollateralAsset} />
        <Select id="borrow-asset" label="Borrow asset" value={debtAsset} options={options} onChange={setDebtAsset} />
        <Field id="collateral-amount" label="Collateral amount" value={typed} onChange={setTyped} error={errors["collateral-amount"] ?? amountError(typed, decimals)} enterButton="open-position" />
      </div>
      <div className="actions">
        <ActionButton id="open-position" busy={busy !== null} onClick={() => void open()}>
          Open position
        </ActionButton>
      </div>
      <h2 id="my-positions">My positions</h2>
      {positions && positions.length === 0 ? <p className="muted">No positions yet. Open one above.</p> : null}
      <ul aria-label="My positions" className="position-list">
        {(positions ?? []).map((p) => (
          <li key={p.position_id}>
            <Link href={`/positions/${p.position_id}`} className="position-link">
              {`Position ${p.position_id}`}
            </Link>
            <StateLabel state={p.state} />
            <span className="position-hf">
              <span className="sr-label">Health factor </span>
              <Mono>{displayHealth(p.health_factor)}</Mono>
            </span>
            <span className="position-pair">
              <Fig minor={p.collateral_amount} decimals={decimalsOf(p.collateral_asset)} asset={p.collateral_asset} />
              {" against "}
              <Fig minor={p.debt} decimals={decimalsOf(p.debt_asset)} asset={p.debt_asset} />
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
