import { useEffect, useState, type KeyboardEvent } from "react";
import type { Address, AddressFields, AnyCase, AppNotification, CaseKind, ClaimCase, OrderSummary, ReturnCase, TrialCase } from "../../shared/api";
import { CLAIM_STATUS_WORDS, ORDER_STATUS_WORDS, RETURN_STATUS_WORDS, TRIAL_STATUS_WORDS, inr, shortDateTime } from "../../shared/format";
import { ADDRESS_KEYS, AddressFieldset, EMPTY_ADDRESS } from "../components/AddressFields";
import { TextField, focusField, sortKeys } from "../components/Fields";
import { Loading, Panel, ServerError } from "../components/Panel";
import { ApiFail, api } from "../lib/api";
import { useLive } from "../lib/live";
import { Link, navigate } from "../lib/router";
import { refreshCart, refreshMe, refreshWishlist, useApp } from "../lib/store";
import { useData } from "../lib/useData";
import "../styles/shop.css";

type TabId = "orders" | "returns" | "trials" | "warranty" | "addresses" | "notifications";
const TABS: { id: TabId; name: string }[] = [
  { id: "orders", name: "Orders" },
  { id: "returns", name: "Returns" },
  { id: "trials", name: "Trials" },
  { id: "warranty", name: "Warranty" },
  { id: "addresses", name: "Addresses" },
  { id: "notifications", name: "Notifications" },
];

const ORDER_TONE: Record<string, string> = { cancelled: "tone-red", delivered: "tone-teal", placed: "tone-blue" };
const CASE_TONE: Record<string, string> = { rejected: "tone-red", refunded: "tone-teal", exchanged: "tone-teal", resolved: "tone-teal", approved: "tone-teal" };

function OrdersTab() {
  const { data, error, loading, reload } = useData<OrderSummary[]>("/api/orders");
  useLive("order", () => void reload());
  if (loading && !data) return <Loading />;
  if (error || !data) return <ServerError />;
  if (data.length === 0) return <Panel tone="surface">No orders yet.</Panel>;
  return (
    <ul className="rows">
      {data.map((order) => (
        <li key={order.number} className="row">
          <Link href={`/orders/${order.number}`} className="row-main">
            {order.number}
          </Link>
          <span className={`block ${ORDER_TONE[order.status] ?? "tone-yellow"}`}>{ORDER_STATUS_WORDS[order.status]}</span>
          <span className="muted">{shortDateTime(order.placed_at)}</span>
          <span>{inr(order.total)}</span>
        </li>
      ))}
    </ul>
  );
}

const WORDS: Record<CaseKind, Record<string, string>> = { return: RETURN_STATUS_WORDS, trial: TRIAL_STATUS_WORDS, claim: CLAIM_STATUS_WORDS };

function caseMessage(kind: CaseKind, item: AnyCase): string | null {
  if (item.status === "rejected") return `Rejected: ${item.reason ?? ""}`;
  if (kind === "return" && item.status === "approved") return "Approved — ship it back within 14 days.";
  if (kind === "trial" && item.status === "approved") return "Trial return approved";
  if (kind !== "claim" && item.status === "refunded" && item.refund_amount !== null) return `Refund issued: ${inr(item.refund_amount)}.`;
  return null;
}

interface CasesProps {
  kind: CaseKind;
  path: string;
  live: "return" | "trial" | "warranty";
  empty: string;
}

function CasesTab({ kind, path, live, empty }: CasesProps) {
  const { data, error, loading, reload } = useData<(ReturnCase | TrialCase | ClaimCase)[]>(path);
  useLive(live, () => void reload());
  if (loading && !data) return <Loading />;
  if (error || !data) return <ServerError />;
  if (data.length === 0) return <Panel tone="surface">{empty}</Panel>;
  return (
    <ul className="rows">
      {data.map((item) => {
        const message = caseMessage(kind, item);
        return (
          <li key={item.number} className="row case-row">
            <div className="row-main">
              <p className="bag-line-name">{item.number}</p>
              <p className="muted">
                {item.product} · <Link href={`/orders/${item.order_number}`}>{item.order_number}</Link>
              </p>
              {message && <p>{message}</p>}
            </div>
            <span className={`block ${CASE_TONE[item.status] ?? "tone-yellow"}`}>{WORDS[kind][item.status]}</span>
          </li>
        );
      })}
    </ul>
  );
}

function AddressesTab() {
  const { data, error, loading, reload } = useData<Address[]>("/api/addresses");
  const [label, setLabel] = useState("");
  const [fields, setFields] = useState<AddressFields>(EMPTY_ADDRESS);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    if (focus) focusField(focus);
  }, [focus]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ServerError />;

  const add = async () => {
    if (pending) return;
    setPending(true);
    setErrors({});
    try {
      await api.post("/api/addresses", { label, ...fields });
      setLabel("");
      setFields(EMPTY_ADDRESS);
      await reload();
    } catch (failure) {
      if (failure instanceof ApiFail && failure.fields) {
        setErrors(failure.fields);
        setFocus(sortKeys(failure.fields, ["label", ...ADDRESS_KEYS])[0] ?? null);
      }
    } finally {
      setPending(false);
    }
  };

  const remove = async (address: Address) => {
    await api.delete(`/api/addresses/${address.id}`);
    await reload();
  };

  return (
    <div className="addresses">
      <ul className="rows">
        {data.map((address) => (
          <li key={address.id} className="row case-row">
            <div className="row-main">
              <p className="bag-line-name">{address.label}</p>
              <p className="muted">
                {address.name}, {address.line1}
                {address.line2 ? `, ${address.line2}` : ""}, {address.city}, {address.state} {address.postcode} · {address.phone}
              </p>
            </div>
            <button type="button" className="btn" onClick={() => void remove(address)}>
              Delete {address.label}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="case-form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void add();
        }}
      >
        <h2>New address</h2>
        <TextField name="label" label="Address label" value={label} onChange={setLabel} error={errors.label} />
        <AddressFieldset prefix="" value={fields} onChange={setFields} errors={errors} />
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "Saving" : "Save address"}
        </button>
      </form>
    </div>
  );
}

function NotificationsTab() {
  const { data, error, loading, reload } = useData<AppNotification[]>("/api/notifications");
  useLive("notification", () => void reload());
  if (loading && !data) return <Loading />;
  if (error || !data) return <ServerError />;
  return (
    <section aria-label="Notifications">
      {data.length === 0 ? (
        <Panel tone="surface">Nothing here yet.</Panel>
      ) : (
        <ul className="rows">
          {data.map((note) => (
            <li key={note.id} className="row case-row">
              <div className="row-main">
                <p>{note.text}</p>
                <p className="muted">{shortDateTime(note.at)}</p>
              </div>
              <span className={`block ${note.email_status === "emailed" ? "tone-teal" : "tone-yellow"}`}>{note.email_status === "emailed" ? "Emailed" : "Email pending"}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function Account(_props: object) {
  const { me } = useApp();
  const [tab, setTab] = useState<TabId>("orders");

  useEffect(() => {
    if (!me) navigate("/sign-in?next=/account", { replace: true });
  }, [me]);

  if (!me) return <Loading />;

  const move = (event: KeyboardEvent<HTMLButtonElement>) => {
    const index = TABS.findIndex((t) => t.id === tab);
    const last = TABS.length - 1;
    const target =
      event.key === "ArrowRight" ? (index + 1) % TABS.length : event.key === "ArrowLeft" ? (index + last) % TABS.length : event.key === "Home" ? 0 : event.key === "End" ? last : -1;
    const next = TABS[target];
    if (!next) return;
    event.preventDefault();
    setTab(next.id);
    document.getElementById(`tab-${next.id}`)?.focus();
  };

  const signOut = async () => {
    await api.delete("/api/session");
    await Promise.all([refreshMe(), refreshCart(), refreshWishlist()]);
    navigate("/");
  };

  return (
    <div className="page account-page">
      <div className="axis">
        <div className="zone">
          <p>{me.name}</p>
          <p className="muted">{me.email}</p>
          <p>
            <button type="button" className="btn" onClick={() => void signOut()}>
              Sign out
            </button>
          </p>
        </div>
        <div className="main">
          <h1>Account</h1>
          <div role="tablist" aria-label="Account" className="tabs">
            {TABS.map((t) => (
              <button
                key={t.id}
                id={`tab-${t.id}`}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                aria-controls={`panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                className="tab-button"
                onClick={() => setTab(t.id)}
                onKeyDown={move}
              >
                {t.name}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} tabIndex={0} className="tab-panel">
            {tab === "orders" && <OrdersTab />}
            {tab === "returns" && <CasesTab kind="return" path="/api/returns" live="return" empty="No returns yet." />}
            {tab === "trials" && <CasesTab kind="trial" path="/api/trials" live="trial" empty="No trial returns yet." />}
            {tab === "warranty" && <CasesTab kind="claim" path="/api/warranty/claims" live="warranty" empty="No warranty claims yet." />}
            {tab === "addresses" && <AddressesTab />}
            {tab === "notifications" && <NotificationsTab />}
          </div>
        </div>
      </div>
    </div>
  );
}
