import { useState, type FormEvent, type ReactNode } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { ApiFailure, failureMessage, post } from "../../lib/api";
import { useAuth } from "../../lib/auth";

export interface SavedAddress {
  id: string;
  label: string;
  name: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  pincode: string;
  phone: string;
}

type Field = "label" | "name" | "line1" | "line2" | "city" | "pincode" | "phone";

const FIELDS: { key: Field; label: string; mode?: "numeric" | "tel"; autoComplete: string }[] = [
  { key: "label", label: "Label", autoComplete: "off" },
  { key: "name", label: "Name", autoComplete: "name" },
  { key: "line1", label: "Address line 1", autoComplete: "address-line1" },
  { key: "line2", label: "Address line 2", autoComplete: "address-line2" },
  { key: "city", label: "City", autoComplete: "address-level2" },
  { key: "pincode", label: "Pincode", mode: "numeric", autoComplete: "postal-code" },
  { key: "phone", label: "Phone", mode: "tel", autoComplete: "tel" },
];

interface Props {
  onClose: () => void;
  onAdded: (address: SavedAddress) => void;
}

export function AddressDialog({ onClose, onAdded }: Props): ReactNode {
  const { account } = useAuth();
  const [values, setValues] = useState<Record<Field, string>>({ label: "Home", name: account?.name ?? "", line1: "", line2: "", city: "", pincode: "", phone: "" });
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [summary, setSummary] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setErrors({});
    setSummary(null);
    try {
      onAdded(await post<SavedAddress>("/api/account/addresses", values));
      onClose();
    } catch (failure) {
      if (failure instanceof ApiFailure && failure.body.errors) {
        setErrors(failure.body.errors);
        setSummary(failure.body.message);
      } else setSummary(failureMessage(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="New address" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} noValidate className="stack">
        {summary && (
          <p className="field-error" role="alert">
            {summary}
          </p>
        )}
        {FIELDS.map((field) => (
          <div className="field" key={field.key}>
            <label htmlFor={`address-${field.key}`}>{field.label}</label>
            <input
              id={`address-${field.key}`}
              value={values[field.key]}
              inputMode={field.mode}
              autoComplete={field.autoComplete}
              aria-invalid={errors[field.key] ? true : undefined}
              aria-describedby={errors[field.key] ? `address-${field.key}-error` : undefined}
              onChange={(event) => setValues({ ...values, [field.key]: event.target.value })}
            />
            {errors[field.key] && (
              <p id={`address-${field.key}-error`} className="field-error">
                {errors[field.key]}
              </p>
            )}
          </div>
        ))}
        <div className="dialog__actions">
          <Button type="submit" variant="primary" busy={busy}>
            Save address
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
