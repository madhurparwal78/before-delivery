import { useMemo, useRef, useState } from "react";
import { api, RetryKey } from "../api.ts";
import { useDecimals, useSession } from "../state.tsx";
import { ActionButton, amountCopy, amountError, Field, Fig, Labelled, Select, typedAmount, useAction } from "../ui.tsx";
import type { Settlement } from "../types.ts";
import { displayShares } from "../../shared/format.ts";

export function SupplyView() {
  const { market, wallet } = useSession();
  const decimalsOf = useDecimals();
  const [asset, setAsset] = useState("QUSD");
  const [supplyTyped, setSupplyTyped] = useState("");
  const [withdrawTyped, setWithdrawTyped] = useState("");
  const withdrawKey = useRef(new RetryKey());
  const supplyAction = useAction(useMemo(() => ({ amount: { id: "supply-amount", label: "Supply amount" } }), []));
  const withdrawAction = useAction(useMemo(() => ({ amount: { id: "withdraw-amount", label: "Withdraw amount" } }), []));
  const decimals = decimalsOf(asset);
  const holding = wallet?.lp_holdings.find((h) => h.asset === asset);
  const busy = supplyAction.busy !== null || withdrawAction.busy !== null;

  async function supply() {
    const amount = typedAmount(supplyTyped, decimals);
    if ("error" in amount) {
      supplyAction.showFieldErrors({ amount: amount.error });
      return;
    }
    await supplyAction.run("supply", {
      pending: "Supplying",
      call: () => api<{ amount: string; shares_minted: string }>("POST", `/api/pools/${asset}/supplies`, { amount: amount.minor }),
      done: (r) => ({ text: `Supplied ${amountCopy(r.amount, decimals, asset)} for ${displayShares(r.shares_minted)} shares.` }),
    });
  }

  async function withdraw() {
    const amount = typedAmount(withdrawTyped, decimals);
    if ("error" in amount) {
      withdrawAction.showFieldErrors({ amount: amount.error });
      return;
    }
    const body = { amount: amount.minor };
    const key = withdrawKey.current.forBody({ asset, ...body });
    await withdrawAction.run("withdraw", {
      pending: "Withdrawing",
      call: () => api<Settlement>("POST", `/api/pools/${asset}/withdrawals`, body, key),
      done: (s) => ({ text: `Withdrew ${amountCopy(s.amount, decimals, asset)}.`, link: { href: `/settlements/${s.settlement_id}`, label: "View receipt" } }),
    });
  }

  return (
    <section className="sheet-section">
      <h1>Supply</h1>
      <p className="lede">Supply an asset to its single-sided pool for shares. Shares grow in value as swap fees and borrow interest land in the pool.</p>
      <div className="form-grid">
        <Select id="pool" label="Pool" value={asset} options={(market?.pools ?? []).map((p) => ({ value: p.asset, label: `${p.asset} · ${p.name}` }))} onChange={setAsset} />
      </div>
      <dl className="ledger-box figures">
        <Labelled label="Your shares">{holding ? <Fig minor={holding.shares} decimals={0} /> : <span className="mono">—</span>}</Labelled>
        <Labelled label="Share value">{holding ? <Fig minor={holding.value} decimals={decimals} asset={asset} /> : <span className="mono">—</span>}</Labelled>
      </dl>
      <div className="form-row">
        <Field id="supply-amount" label="Supply amount" value={supplyTyped} onChange={setSupplyTyped} error={supplyAction.errors["supply-amount"] ?? amountError(supplyTyped, decimals)} enterButton="supply-button" />
        <ActionButton id="supply-button" busy={busy} onClick={() => void supply()}>
          Supply
        </ActionButton>
      </div>
      <div className="form-row">
        <Field id="withdraw-amount" label="Withdraw amount" value={withdrawTyped} onChange={setWithdrawTyped} error={withdrawAction.errors["withdraw-amount"] ?? amountError(withdrawTyped, decimals)} enterButton="withdraw-button" />
        <ActionButton id="withdraw-button" busy={busy} onClick={() => void withdraw()}>
          Withdraw
        </ActionButton>
      </div>
    </section>
  );
}
