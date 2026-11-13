import { Plus } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/Button";
import { failureMessage, get, put } from "../../lib/api";
import { useCart } from "../../lib/cart";
import type { Quote } from "../../lib/types";
import { fieldMessage } from "../cart/actions";
import { AddressDialog, type SavedAddress } from "./AddressDialog";
import { CheckoutShell } from "./Shell";
import { readChoice, writeChoice } from "./state";

function AddressStep({ quote }: { quote: Quote }): ReactNode {
  const navigate = useNavigate();
  const { run } = useCart();
  const [addresses, setAddresses] = useState<SavedAddress[] | null>(null);
  const [chosen, setChosen] = useState<string | null>(() => readChoice().addressId ?? quote.destination.address_id);
  const [adding, setAdding] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    get<{ addresses: SavedAddress[] }>("/api/account/addresses").then(
      (found) => setAddresses(found.addresses),
      (failure: unknown) => setProblem(failureMessage(failure)),
    );
  }, []);

  const added = (address: SavedAddress): void => {
    setAddresses((list) => [...(list ?? []), address]);
    setChosen(address.id);
    setProblem(null);
  };

  const next = async (): Promise<void> => {
    if (!chosen) {
      setProblem("Choose a delivery address.");
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await run(() => put<Quote>("/api/cart/destination", { address_id: chosen }));
      writeChoice({ addressId: chosen });
      navigate("/checkout/payment");
    } catch (failure) {
      setProblem(fieldMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <h2>address</h2>
      <p className="muted">Where should the parcels go?</p>
      <div role="radiogroup" aria-label="Delivery address" className="ck__choices">
        {addresses === null && !problem && <div className="skeleton" style={{ minHeight: 88 }} />}
        {addresses?.map((address) => (
          <label key={address.id} className="choice choice--card">
            <input type="radio" name="address" checked={chosen === address.id} onChange={() => setChosen(address.id)} />
            <span>
              <strong>{address.label}</strong>, {address.name}
              <br />
              {[address.line1, address.line2].filter(Boolean).join(", ")}, {address.city} {address.pincode}
            </span>
          </label>
        ))}
      </div>
      <div className="row ck__actions">
        <Button onClick={() => setAdding(true)}>
          <Plus size={20} aria-hidden="true" />
          Add address
        </Button>
        <Button variant="primary" busy={busy} onClick={() => void next()}>
          Continue
        </Button>
      </div>
      <div className="ck__problem" aria-live="polite">
        {problem && <p className="field-error">{problem}</p>}
      </div>
      {adding && <AddressDialog onClose={() => setAdding(false)} onAdded={added} />}
    </>
  );
}

export default function Address(): ReactNode {
  return <CheckoutShell step="address">{(quote) => <AddressStep quote={quote} />}</CheckoutShell>;
}
