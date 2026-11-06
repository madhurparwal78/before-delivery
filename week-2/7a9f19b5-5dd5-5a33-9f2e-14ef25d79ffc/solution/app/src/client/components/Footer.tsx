import { useId, useState, type FormEvent } from "react";
import { request } from "../lib/api";

const OCCUPATIONS = [
  { label: "Architect", value: "architect" },
  { label: "Trade", value: "trade" },
  { label: "Wholesaler", value: "wholesaler" },
  { label: "Other", value: "other" },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function Newsletter() {
  const id = useId();
  const [email, setEmail] = useState("");
  const [occupation, setOccupation] = useState("architect");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!EMAIL.test(email.trim())) return setStatus("Enter a valid email address.");
    if (!consent) return setStatus("Tick the box to agree to the newsletter.");
    setBusy(true);
    setStatus("");
    const reply = await request("/api/newsletter", { method: "POST", body: { email: email.trim(), occupation, consent } });
    setBusy(false);
    if (reply.ok) setStatus(`Check your inbox. We've sent a confirmation link to ${email.trim()}.`);
    else if (reply.error.errors?.consent) setStatus("Tick the box to agree to the newsletter.");
    else setStatus("Enter a valid email address.");
  };

  return (
    <section aria-label="Newsletter" className="newsletter">
      <h2 className="newsletter__title">Notes on light</h2>
      <p className="newsletter__lede">New fittings, clearance runs and lighting notes, a few times a year.</p>
      <form className="newsletter__form" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor={`${id}-email`}>Email</label>
          <input id={`${id}-email`} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor={`${id}-occupation`}>Occupation</label>
          <select id={`${id}-occupation`} value={occupation} onChange={(e) => setOccupation(e.target.value)}>
            {OCCUPATIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>Send me the Lightfall newsletter</span>
        </label>
        <button type="submit" className="button button--primary" disabled={busy}>
          {busy ? "Subscribing" : "Subscribe"}
        </button>
        <p role="status" aria-label="Newsletter status" className="form-status">
          {status}
        </p>
      </form>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="site-footer">
      <Newsletter />
      <p className="site-footer__line">Southerly Light Works · Ōtautahi Christchurch</p>
    </footer>
  );
}
