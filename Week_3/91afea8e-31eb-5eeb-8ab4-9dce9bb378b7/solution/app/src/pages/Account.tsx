import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Button } from "../components/Button";
import { ApiFailure, del, get, post } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useTitle } from "../lib/hooks";
import type { Account as AccountInfo } from "../lib/types";
import { rupees } from "../../shared/format";
import { COPY, StatusLine, TextField, errorMessage, useSubmit } from "./auth/parts";
import "../styles/account.css";

interface Address {
  id: string;
  label: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string | null;
  pincode: string;
  phone: string;
}

interface SavedCard {
  card_id: string;
  network: string;
  last4: string;
}

const cardLabel = (card: SavedCard): string => `${card.network} ending ${card.last4}`;

function Balance(): ReactNode {
  const auth = useAuth();
  const [code, setCode] = useState("");
  const [form, submit] = useSubmit();
  const [done, setDone] = useState("");

  const redeem = submit(async () => {
    setDone("");
    await post<{ balance_paise: number }>("/api/balance/redeem", { code });
    await auth.reload();
    setCode("");
    setDone("Gift card added.");
  });

  return (
    <section className="card card--yellow account__card" aria-labelledby="account-balance">
      <h2 id="account-balance">balance</h2>
      <p className="bill">Chauraha balance {rupees(auth.balancePaise)}</p>
      <form className="stack" onSubmit={redeem} noValidate>
        <TextField label="Gift card code" value={code} autoComplete="off" onChange={(event) => setCode(event.target.value)} error={form.errors.code} />
        <Button type="submit" busy={form.busy}>
          Redeem
        </Button>
        <p role="status" aria-label="Gift card status" className="status">
          {form.message.tone === "error" ? form.message.text : done}
        </p>
      </form>
    </section>
  );
}

function Addresses({ items, onRemove, busy }: { items: Address[]; onRemove: (address: Address) => void; busy: string | null }): ReactNode {
  return (
    <section className="card account__card" aria-labelledby="account-addresses">
      <h2 id="account-addresses">addresses</h2>
      {items.length === 0 ? (
        <p className="muted">No saved addresses yet. Add one at checkout.</p>
      ) : (
        <ul className="account__list">
          {items.map((address) => (
            <li key={address.id} className="account__item">
              <div>
                <p className="account__label">{address.label}</p>
                <p className="muted">
                  {address.name}, {address.line1}
                  {address.line2 ? `, ${address.line2}` : ""}, {address.city} {address.pincode}
                </p>
              </div>
              <Button small variant="dark" busy={busy === address.id} onClick={() => onRemove(address)} aria-label={`Delete ${address.label} address`}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Cards({ items, onRemove, busy }: { items: SavedCard[]; onRemove: (card: SavedCard) => void; busy: string | null }): ReactNode {
  return (
    <section className="card card--black account__card" aria-labelledby="account-cards">
      <h2 id="account-cards">saved cards</h2>
      {items.length === 0 ? (
        <p className="muted">No saved cards. Tick save at payment to keep one.</p>
      ) : (
        <ul className="account__list">
          {items.map((card) => (
            <li key={card.card_id} className="account__item">
              <p className="account__label">{cardLabel(card)}</p>
              <Button small busy={busy === card.card_id} onClick={() => onRemove(card)} aria-label={`Delete ${cardLabel(card)}`}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PasswordForm(): ReactNode {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [form, submit] = useSubmit();

  const change = submit(async () => {
    await post("/api/account/password", { current_password: current, new_password: next });
    setCurrent("");
    setNext("");
    return { tone: "info", text: COPY.passwordChanged };
  });

  return (
    <section className="card card--pink account__card" aria-labelledby="account-password">
      <h2 id="account-password">password</h2>
      <form className="stack" onSubmit={change} noValidate>
        <StatusLine message={form.message} />
        <TextField secret label="Current password" value={current} autoComplete="current-password" onChange={(event) => setCurrent(event.target.value)} error={form.errors.current_password} />
        <TextField secret label="New password" value={next} autoComplete="new-password" onChange={(event) => setNext(event.target.value)} error={form.errors.new_password} />
        <Button type="submit" busy={form.busy}>
          Change password
        </Button>
      </form>
    </section>
  );
}

function AccountBody({ account, onLeave }: { account: AccountInfo; onLeave: () => void }): ReactNode {
  const auth = useAuth();
  const navigate = useNavigate();
  const shopper = account.role === "shopper";
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [cards, setCards] = useState<SavedCard[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [updates, setUpdates] = useState("");
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (!shopper) return;
    get<{ addresses: Address[] }>("/api/account/addresses").then((reply) => setAddresses(reply.addresses), (error: unknown) => setUpdates(errorMessage(error).text));
    get<{ cards: SavedCard[] }>("/api/account/cards").then((reply) => setCards(reply.cards), (error: unknown) => setUpdates(errorMessage(error).text));
  }, [shopper]);

  const remove = useCallback(async (id: string, path: string, then: () => void, said: string): Promise<void> => {
    setBusy(id);
    try {
      await del(path);
      then();
      setUpdates(said);
    } catch (error) {
      if (!(error instanceof ApiFailure)) throw error;
      setUpdates(error.body.message);
    } finally {
      setBusy(null);
    }
  }, []);

  const signOut = async (): Promise<void> => {
    setLeaving(true);
    onLeave();
    await auth.signOut();
    navigate("/", { replace: true });
  };

  return (
    <div className="account">
      <section className="panel panel--raised account__head">
        <h1>{shopper ? `hello, ${account.first_name}.` : "account."}</h1>
        <Button variant="yellow" busy={leaving} onClick={() => void signOut()}>
          Sign out
        </Button>
      </section>
      <section className="panel panel--ground account__grid">
        {shopper && <Balance />}
        {shopper && (
          <Addresses
            items={addresses}
            busy={busy}
            onRemove={(address) => void remove(address.id, `/api/account/addresses/${address.id}`, () => setAddresses((list) => list.filter((entry) => entry.id !== address.id)), "Address deleted.")}
          />
        )}
        {shopper && (
          <Cards
            items={cards}
            busy={busy}
            onRemove={(card) => void remove(card.card_id, `/api/account/cards/${card.card_id}`, () => setCards((list) => list.filter((entry) => entry.card_id !== card.card_id)), "Card removed.")}
          />
        )}
        <PasswordForm />
        <p role="status" aria-label="Account updates" className="status account__updates">
          {updates}
        </p>
      </section>
    </div>
  );
}

export default function Account(): ReactNode {
  useTitle("account");
  const auth = useAuth();
  const [leaving, setLeaving] = useState(false);
  if (auth.status === "loading") {
    return (
      <section className="panel panel--ground" aria-busy="true">
        <div className="skeleton" style={{ minHeight: 240 }} />
      </section>
    );
  }
  if (auth.status === "signedOut" || !auth.account) return leaving ? null : <Navigate to="/signin?next=/account" replace />;
  return <AccountBody account={auth.account} onLeave={() => setLeaving(true)} />;
}
