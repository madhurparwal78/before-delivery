import { useState, type FormEvent } from "react";
import { ApiFailure, post } from "../api.js";
import { ERRORS } from "../../../shared/copy.js";
import { navigate } from "../router.js";
import { Alert, Button, TextField } from "../ui.js";
import { LABELS } from "./copy.js";
import { orderPath, rememberOrderToken } from "./orderToken.js";
import { PublicSheet } from "./PublicSheet.js";

interface LookupBody {
  reference: string;
  orderToken: string;
}

export const Lookup = () => {
  const [reference, setReference] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const find = async (event: FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const { body } = await post<LookupBody>("/api/orders/lookup", { reference: reference.trim(), email: email.trim() });
      rememberOrderToken(body.reference, body.orderToken);
      navigate(orderPath(body.reference, body.orderToken));
    } catch (failure) {
      setMessage(failure instanceof ApiFailure && failure.message ? failure.message : ERRORS.internal_error.message());
      setBusy(false);
    }
  };

  return (
    <PublicSheet>
      <h1>{LABELS.lookup.form}</h1>
      <p className="muted">Enter the reference from your receipt and the email you ordered with.</p>
      <form aria-label={LABELS.lookup.form} onSubmit={(event) => void find(event)} noValidate>
        <TextField label={LABELS.lookup.reference} value={reference} onChange={(event) => setReference(event.target.value)} autoComplete="off" autoCapitalize="characters" />
        <TextField label={LABELS.lookup.email} type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
        <Alert label={LABELS.lookup.message} className="form-message error">{message}</Alert>
        <Button type="submit" variant="primary" aria-busy={busy || undefined}>{LABELS.lookup.submit}</Button>
      </form>
    </PublicSheet>
  );
};
