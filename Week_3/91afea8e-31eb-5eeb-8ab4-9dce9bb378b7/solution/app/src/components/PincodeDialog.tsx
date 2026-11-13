import { useState, type FormEvent, type ReactNode } from "react";
import { ApiFailure } from "../lib/api";
import { usePincode } from "../lib/pincode";
import { Button } from "./Button";
import { Dialog } from "./Dialog";

export function PincodeDialog({ onClose }: { onClose: () => void }): ReactNode {
  const { pin, check } = usePincode();
  const [value, setValue] = useState(pin ?? "");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (!/^[1-9]\d{5}$/.test(value)) {
      setMessage("Enter a 6-digit pincode.");
      return;
    }
    setBusy(true);
    try {
      const found = await check(value);
      if (found.serviceable) onClose();
      else setMessage(`We don't deliver to ${value} yet.`);
    } catch (error) {
      setMessage(error instanceof ApiFailure ? error.body.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog title="Delivery pincode" onClose={onClose}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label htmlFor="dialog-pincode">Pincode</label>
          <input id="dialog-pincode" inputMode="numeric" autoComplete="postal-code" maxLength={6} value={value} onChange={(event) => setValue(event.target.value.trim())} />
        </div>
        <p className="status" role="status" style={{ marginTop: 12 }}>
          {message}
        </p>
        <div className="dialog__actions">
          <Button type="submit" variant="primary" busy={busy}>
            Check pincode
          </Button>
          <Button onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Dialog>
  );
}
