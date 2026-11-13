import { useEffect, useMemo, useRef, useState } from "react";
import { api, request } from "../api.ts";
import { liveError, parsePercent, parsePrice } from "../desk.ts";
import { useDecimals, useSession } from "../state.tsx";
import { ActionButton, amountCopy, amountError, counted, Field, Select, typedAmount, useAction } from "../ui.tsx";
import { ROLE_LABEL, type Member, type Role } from "../types.ts";
import { ShockRuler } from "./ShockRuler.tsx";
import { bpsPercent, displayAmount, displayPrice } from "../../shared/format.ts";
import { useChosenAsset } from "./chosen-asset.ts";

const RISK_FIELDS = [
  { field: "ltv_bps", id: "risk-ltv", label: "Loan-to-value (%)" },
  { field: "liquidation_threshold_bps", id: "risk-threshold", label: "Liquidation threshold (%)" },
  { field: "liquidation_bonus_bps", id: "risk-bonus", label: "Liquidation bonus (%)" },
  { field: "reserve_factor_bps", id: "risk-reserve", label: "Reserve factor (%)" },
] as const;
type RiskField = (typeof RISK_FIELDS)[number]["field"];
type RiskBody = Record<RiskField, number> & { asset: string };

/** A risk body as the form shows it: percentages with a comma and no `%`. */
function riskText(body: RiskBody): Record<RiskField, string> {
  return Object.fromEntries(RISK_FIELDS.map((f) => [f.field, bpsPercent(body[f.field])])) as Record<RiskField, string>;
}

export function StewardView() {
  const { market, members, reloadMembers } = useSession();
  const decimalsOf = useDecimals();
  const assets = market?.pools.map((p) => p.asset) ?? [];
  const [chosen, setChosen, chosenKnown] = useChosenAsset();
  const pool = market?.pools.find((p) => p.asset === chosen);
  const assetOptions = assets.map((a) => ({ value: a, label: a }));

  // ---- price post ----
  const [newPrice, setNewPrice] = useState("");
  const [confirmLarge, setConfirmLarge] = useState(false);
  const postButton = useRef<HTMLButtonElement>(null);
  const priceAction = useAction(useMemo(() => ({ price: { id: "new-price", label: "New price" }, asset: { id: "steward-asset", label: "Asset" } }), []));

  async function postPrice() {
    const price = parsePrice(newPrice);
    if (!price.ok) {
      priceAction.showFieldErrors({ price: price.error });
      return;
    }
    await priceAction.run("price", {
      pending: "Posting price",
      call: () => api<{ positions_below_one: number }>("POST", "/api/prices", { asset: chosen, price: price.value, confirm_large_move: confirmLarge }),
      done: (r) => ({ text: `Price posted. ${counted(r.positions_below_one, "position")} now below health factor 1.` }),
    });
  }

  // ---- risk parameters: read with their ETag, saved against it ----
  const [risk, setRisk] = useState<Record<RiskField, string> | null>(null);
  const [etag, setEtag] = useState("");
  const [stored, setStored] = useState<Record<RiskField, string> | null>(null);
  const riskAction = useAction(useMemo(() => Object.fromEntries(RISK_FIELDS.map((f) => [f.field, { id: f.id, label: f.label }])), []));

  async function readRisk(): Promise<{ text: Record<RiskField, string>; etag: string }> {
    const answer = await request<RiskBody>("GET", `/api/assets/${encodeURIComponent(chosen)}/risk`);
    return { text: riskText(answer.body), etag: answer.headers.get("ETag") ?? "" };
  }

  useEffect(() => {
    if (!chosen) return;
    setRisk(null);
    setStored(null);
    readRisk().then(
      (read) => {
        setRisk(read.text);
        setEtag(read.etag);
      },
      () => undefined,
    );
  }, [chosen]);

  async function saveRisk() {
    if (!risk) return;
    const body: Record<string, number> = {};
    const problems: Record<string, string> = {};
    for (const f of RISK_FIELDS) {
      const parsed = parsePercent(risk[f.field]);
      if (parsed.ok) body[f.field] = parsed.value;
      else problems[f.field] = parsed.error;
    }
    if (Object.keys(problems).length > 0) {
      riskAction.showFieldErrors(problems);
      return;
    }
    const saved = await riskAction.run("risk", {
      pending: "Saving risk parameters",
      call: () => request<RiskBody>("PATCH", `/api/assets/${encodeURIComponent(chosen)}/risk`, { body, headers: { "If-Match": etag } }),
      done: (answer) => ({ text: `Risk parameters saved for ${answer.body.asset}.` }),
      // The typed values stay; the stored ones are shown beside them and the remembered version moves on.
      failed: (failure) => {
        if (failure.kind === "error" && failure.status === 412) {
          readRisk().then(
            (read) => {
              setStored(read.text);
              setEtag(read.etag);
            },
            () => undefined,
          );
        }
      },
    });
    if (saved) {
      setRisk(riskText(saved.body));
      setEtag(saved.headers.get("ETag") ?? "");
      setStored(null);
    }
  }

  // ---- members and transfers ----
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("liquidity_provider");
  const memberAction = useAction(
    useMemo(() => ({ name: { id: "member-name", label: "Member name" }, email: { id: "member-email", label: "Member email" }, role: { id: "member-role", label: "Member role" } }), []),
  );

  async function addMember() {
    const added = await memberAction.run("member", {
      pending: "Adding member",
      call: () => api<Member>("POST", "/api/actors", { name, email, role }),
      done: (m) => ({ text: `Member added: ${m.name}.` }),
    });
    if (added) {
      reloadMembers();
      setName("");
      setEmail("");
    }
  }

  const [recipient, setRecipient] = useState<string | null>(null);
  const [transferAsset, setTransferAsset] = useState<string | null>(null);
  const [transferTyped, setTransferTyped] = useState("");
  const target = recipient ?? members[0]?.actor_id ?? "";
  const sendAsset = transferAsset ?? assets[0] ?? "";
  const transferAction = useAction(
    useMemo(
      () => ({ amount: { id: "transfer-amount", label: "Transfer amount" }, actor_id: { id: "transfer-member", label: "Member" }, asset: { id: "transfer-asset", label: "Transfer asset" } }),
      [],
    ),
  );

  async function recordTransfer() {
    const decimals = decimalsOf(sendAsset);
    const amount = typedAmount(transferTyped, decimals);
    if ("error" in amount) {
      transferAction.showFieldErrors({ amount: amount.error });
      return;
    }
    const memberName = members.find((m) => m.actor_id === target)?.name ?? target;
    await transferAction.run("transfer", {
      pending: "Recording transfer",
      call: () => api<{ amount: string; asset: string }>("POST", "/api/transfers", { actor_id: target, asset: sendAsset, amount: amount.minor }),
      done: (t) => ({ text: `Transfer recorded: ${amountCopy(t.amount, decimals, t.asset)} to ${memberName}.` }),
    });
  }

  if (!chosenKnown) return null;

  const priceHint = pool ? (
    <>
      Posted now: <span className="mono">{displayPrice(pool.price)}</span>
    </>
  ) : undefined;
  return (
    <section className="sheet-section">
      <h1>Steward</h1>
      <p className="lede">Post prices, set each asset's risk parameters and stress-test positions with a price shock before you post.</p>
      <div className="form-grid">
        <Select id="steward-asset" label="Asset" value={chosen} options={assetOptions} onChange={setChosen} />
      </div>

      <h2>Post a price</h2>
      <div className="form-row">
        <Field
          id="new-price"
          label="New price"
          value={newPrice}
          onChange={setNewPrice}
          error={priceAction.errors["new-price"] ?? liveError(newPrice, parsePrice)}
          hint={priceHint}
          enterButton="post-price"
        />
        <label className="check" htmlFor="confirm-large">
          <input id="confirm-large" type="checkbox" checked={confirmLarge} onChange={(event) => setConfirmLarge(event.target.checked)} />
          <span>Confirm large move</span>
        </label>
        <ActionButton id="post-price" buttonRef={postButton} busy={priceAction.busy !== null} onClick={() => void postPrice()}>
          Post price
        </ActionButton>
      </div>

      {pool ? (
        <ShockRuler
          pool={pool}
          onPostThisPrice={(units) => {
            setNewPrice(displayAmount(units, 8));
            postButton.current?.focus();
          }}
        />
      ) : null}

      <h2>Risk parameters</h2>
      <div className="form-grid risk-grid">
        {RISK_FIELDS.map((f) => (
          <Field
            key={f.field}
            id={f.id}
            label={f.label}
            inputMode="decimal"
            value={risk?.[f.field] ?? ""}
            onChange={(v) => setRisk((current) => (current ? { ...current, [f.field]: v } : current))}
            error={riskAction.errors[f.id] ?? liveError(risk?.[f.field] ?? "", parsePercent)}
            hint={stored ? `Now ${stored[f.field]}%` : undefined}
          />
        ))}
      </div>
      <div className="actions">
        <ActionButton busy={riskAction.busy !== null} onClick={() => void saveRisk()}>
          Save risk parameters
        </ActionButton>
      </div>

      <h2>Onboard a member</h2>
      <div className="form-grid">
        <Field id="member-name" label="Member name" inputMode="text" value={name} onChange={setName} error={memberAction.errors["member-name"]} />
        <Field id="member-email" label="Member email" inputMode="email" value={email} onChange={setEmail} error={memberAction.errors["member-email"]} />
        <Select
          id="member-role"
          label="Member role"
          value={role}
          options={(Object.keys(ROLE_LABEL) as Role[]).map((r) => ({ value: r, label: ROLE_LABEL[r] }))}
          onChange={(v) => setRole(v as Role)}
        />
      </div>
      <div className="actions">
        <ActionButton busy={memberAction.busy !== null} onClick={() => void addMember()}>
          Add member
        </ActionButton>
      </div>

      <h2>Record an inbound transfer</h2>
      <div className="form-grid">
        <Select id="transfer-member" label="Member" value={target} options={members.map((m) => ({ value: m.actor_id, label: `${m.name} (${ROLE_LABEL[m.role]})` }))} onChange={setRecipient} />
        <Select id="transfer-asset" label="Transfer asset" value={sendAsset} options={assetOptions} onChange={setTransferAsset} />
        <Field
          id="transfer-amount"
          label="Transfer amount"
          value={transferTyped}
          onChange={setTransferTyped}
          error={transferAction.errors["transfer-amount"] ?? amountError(transferTyped, decimalsOf(sendAsset))}
          enterButton="record-transfer"
        />
      </div>
      <div className="actions">
        <ActionButton id="record-transfer" busy={transferAction.busy !== null} onClick={() => void recordTransfer()}>
          Record transfer
        </ActionButton>
      </div>
    </section>
  );
}

