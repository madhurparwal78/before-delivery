import { useMemo, useRef, useState } from "preact/hooks";
import { call, newKey, type Account, type ApiError } from "../api.js";
import { PRICES } from "../../shared/prices.js";
import { dollars } from "../format.js";
import { Dialog } from "../ui/Dialog.js";
import { ErrorSummary, Field } from "../ui/kit.js";
import { benchMapStop } from "./Lab.js";
import { BILLING_OFFLINE, store, useStore, type Outcome } from "./store.js";

// ---- Sign in and create account -----------------------------------------------------------------

export function AuthDialog({ returnFocus }: { returnFocus: () => HTMLElement | null }) {
  const [mode, setMode] = useState<"signin" | "create">("signin");
  const done = (signedIn: boolean) => store.closeSignIn(signedIn);
  return mode === "signin" ? (
    <SignIn key="signin" onCreate={() => setMode("create")} onDone={done} returnFocus={returnFocus} />
  ) : (
    <CreateAccount key="create" onDone={done} returnFocus={returnFocus} />
  );
}

function SignIn({ onCreate, onDone, returnFocus }: { onCreate: () => void; onDone: (ok: boolean) => void; returnFocus: () => HTMLElement | null }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    const reply = await call<{ account: Account }>("POST", "/api/auth/signin", { email, password });
    setBusy(false);
    if (reply.ok) onDone(true);
    else setError(reply.error.error === "invalid_credentials" ? "Email or password is incorrect." : reply.error.message);
  };
  return (
    <Dialog label="Sign in" onClose={() => onDone(false)} returnFocus={returnFocus} className="dialog--narrow">
      <form class="form" onSubmit={submit} noValidate>
        <h2 class="dialog__title">Sign in</h2>
        <p class="dialog__lead">Hold a bench, pay on the lab clock and find your seats later.</p>
        {error && (
          <p class="form__error" role="alert">
            {error}
          </p>
        )}
        <Field id="signin-email" label="Email" type="email" autocomplete="email" value={email} onInput={setEmail} />
        <Field id="signin-password" label="Password" type="password" autocomplete="current-password" value={password} onInput={setPassword} />
        <div class="form__actions">
          <button type="submit" class="button button--primary" disabled={busy}>
            Sign in
          </button>
          <button type="button" class="button button--quiet" onClick={onCreate}>
            Create an account
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const CREATE_IDS = { name: "create-name", email: "create-email", password: "create-password", clinic_name: "create-clinic", kind: "create-practitioner" };

function CreateAccount({ onDone, returnFocus }: { onDone: (ok: boolean) => void; returnFocus: () => HTMLElement | null }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [kind, setKind] = useState<"practitioner" | "clinic">("practitioner");
  const [clinicName, setClinicName] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (event: Event) => {
    event.preventDefault();
    setBusy(true);
    const reply = await call<{ account: Account }>("POST", "/api/auth/signup", {
      name,
      email,
      password,
      kind,
      ...(kind === "clinic" ? { clinic_name: clinicName } : {}),
    });
    setBusy(false);
    if (reply.ok) return onDone(true);
    setErrors(reply.error.errors ?? (reply.error.error === "email_taken" ? { email: "An account with this email already exists. Sign in instead." } : { name: reply.error.message }));
  };
  return (
    <Dialog label="Create account" onClose={() => onDone(false)} returnFocus={returnFocus} className="dialog--narrow">
      <form class="form" onSubmit={submit} noValidate>
        <h2 class="dialog__title">Create account</h2>
        <ErrorSummary errors={errors} ids={CREATE_IDS} />
        <Field id="create-name" label="Name" autocomplete="name" value={name} error={errors.name} onInput={setName} />
        <Field id="create-email" label="Email" type="email" autocomplete="email" value={email} error={errors.email} onInput={setEmail} />
        <Field id="create-password" label="Password" type="password" autocomplete="new-password" value={password} error={errors.password} onInput={setPassword} />
        <fieldset class="choice">
          <legend>I am booking as</legend>
          <label class="choice__option">
            <input id="create-practitioner" type="radio" name="kind" checked={kind === "practitioner"} onChange={() => setKind("practitioner")} />
            <span>Practitioner</span>
          </label>
          <label class="choice__option">
            <input type="radio" name="kind" checked={kind === "clinic"} onChange={() => setKind("clinic")} />
            <span>Clinic</span>
          </label>
        </fieldset>
        {kind === "clinic" && <Field id="create-clinic" label="Clinic name" value={clinicName} error={errors.clinic_name} onInput={setClinicName} />}
        <div class="form__actions">
          <button type="submit" class="button button--primary" disabled={busy}>
            Create account
          </button>
        </div>
      </form>
    </Dialog>
  );
}

// ---- Checkout -----------------------------------------------------------------------------------

function holdPanelHeading(): HTMLElement | null {
  return document.getElementById("hold-heading");
}

function useOutcome() {
  const [state, setState] = useState<{ outcome: Outcome | "idle" | "processing"; error?: ApiError | undefined }>({ outcome: "idle" });
  return [state, setState] as const;
}

export function Checkout({ kind, opener, onClose }: { kind: "deposit" | "full"; opener: HTMLElement | null; onClose: () => void }) {
  const s = useStore();
  const bench = s.hold?.labels[0] ?? s.confirmed[0] ?? "";
  const tier = /^[AB]/.test(bench) ? "atelier" : "bench";
  const amount = PRICES[tier][kind];
  const [name, setName] = useState(s.me?.account.name ?? "");
  const key = useMemo(() => newKey(), []);
  const [state, setState] = useOutcome();
  const done = useRef(false);
  const confirmed = state.outcome === "confirmed" || (state.outcome === "pending" && s.confirmed.includes(bench));
  const pay = async () => {
    setState({ outcome: "processing" });
    setState(await store.pay(kind, name, key));
  };
  const label = kind === "deposit" ? `Pay deposit $${dollars(amount)}` : `Pay in full $${dollars(amount)}`;
  return (
    <Dialog
      label="Checkout"
      onClose={onClose}
      initialFocus="#checkout-name"
      returnFocus={() => (done.current ? holdPanelHeading() : opener)}
    >
      {confirmed ? (
        <div class="confirm">
          <p class="eyebrow">Payment confirmed</p>
          <h2 class="dialog__title dialog__title--large">Bench {bench} is yours</h2>
          <p class="dialog__lead">We are emailing your receipt. Your seat, documents and balance live under My seats.</p>
          <div class="form__actions">
            <button
              type="button"
              class="button button--primary"
              onClick={() => {
                done.current = true;
                onClose();
              }}
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <form
          class="form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void pay();
          }}
        >
          <p class="eyebrow">Checkout · Bench {bench}</p>
          <h2 class="dialog__title">{kind === "deposit" ? "Pay the deposit" : "Pay in full"}</h2>
          <dl class="summary">
            <div>
              <dt>Bench {bench}</dt>
              <dd class="num">${dollars(amount)}</dd>
            </div>
          </dl>
          {state.outcome === "offline" && (
            <div class="banner" role="alert">
              {BILLING_OFFLINE}
            </div>
          )}
          {state.outcome === "pending" && (
            <p class="form__note" role="status">
              Payment for Bench {bench} is being confirmed. We will update this page and email your receipt.
            </p>
          )}
          {state.outcome === "refused" && state.error && <p class="form__error">{state.error.message}</p>}
          <Field id="checkout-name" label="Name for the receipt" autocomplete="name" value={name} onInput={setName} error={state.error?.errors?.billing_name} />
          <p class="form__note">Kill Bill records the payment against the external payment method; no card is charged here.</p>
          <div class="form__actions">
            <button type="submit" class="button button--primary" disabled={state.outcome === "processing" || state.outcome === "pending"}>
              {state.outcome === "processing" ? "Processing payment" : label}
            </button>
            <button type="button" class="button button--quiet" onClick={onClose}>
              Close
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function GroupCheckout({ opener, onClose }: { opener: HTMLElement | null; onClose: () => void }) {
  const s = useStore();
  const labels = s.hold?.labels ?? s.confirmed;
  const total = labels.reduce((sum, label) => sum + PRICES[/^[AB]/.test(label) ? "atelier" : "bench"].full, 0);
  const [name, setName] = useState(s.me?.account.name ?? "");
  const [mates, setMates] = useState<Record<string, { name: string; email: string }>>({});
  const key = useMemo(() => newKey(), []);
  const [state, setState] = useOutcome();
  const done = useRef(false);
  const confirmed = state.outcome === "confirmed" || (state.outcome === "pending" && s.confirmed.length > 0 && !s.pendingPayment);
  const pay = async () => {
    setState({ outcome: "processing" });
    const assignments = labels
      .map((bench) => ({ bench, name: mates[bench]?.name.trim() ?? "", email: mates[bench]?.email.trim() ?? "" }))
      .filter((a) => a.name || a.email);
    setState(await store.pay("group", name, key, assignments));
  };
  const setMate = (bench: string, field: "name" | "email", value: string) =>
    setMates((current) => ({ ...current, [bench]: { name: "", email: "", ...current[bench], [field]: value } }));
  return (
    <Dialog label="Group checkout" onClose={onClose} returnFocus={() => (done.current ? holdPanelHeading() : opener)}>
      {confirmed ? (
        <div class="confirm">
          <p class="eyebrow">Payment confirmed</p>
          <h2 class="dialog__title dialog__title--large">Group invoice confirmed: {labels.length} seats on one invoice</h2>
          <p class="dialog__lead">We are emailing the group receipt. Name the remaining colleagues from My seats.</p>
          <div class="form__actions">
            <button
              type="button"
              class="button button--primary"
              onClick={() => {
                done.current = true;
                onClose();
              }}
            >
              Done
            </button>
          </div>
        </div>
      ) : (
        <form
          class="form"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void pay();
          }}
        >
          <p class="eyebrow">Group checkout · {labels.length} benches</p>
          <h2 class="dialog__title">One invoice, one seat per colleague</h2>
          {state.outcome === "offline" && (
            <div class="banner" role="alert">
              {BILLING_OFFLINE}
            </div>
          )}
          {state.outcome === "pending" && (
            <p class="form__note" role="status">
              Payment for {labels.length} benches is being confirmed. We will update this page and email your receipt.
            </p>
          )}
          {state.outcome === "refused" && state.error && <p class="form__error">{state.error.errors?.assignments ?? state.error.message}</p>}
          <div class="seats">
            {labels.map((bench) => (
              <fieldset class="seat" key={bench}>
                <legend>
                  Bench {bench} <span class="num">${dollars(PRICES[/^[AB]/.test(bench) ? "atelier" : "bench"].full)}</span>
                </legend>
                <Field id={`mate-name-${bench}`} label={`Colleague name for Bench ${bench}`} value={mates[bench]?.name ?? ""} onInput={(v) => setMate(bench, "name", v)} />
                <Field id={`mate-email-${bench}`} label={`Colleague email for Bench ${bench}`} type="email" value={mates[bench]?.email ?? ""} onInput={(v) => setMate(bench, "email", v)} />
              </fieldset>
            ))}
          </div>
          <Field id="group-name" label="Name for the receipt" value={name} onInput={setName} error={state.error?.errors?.billing_name} />
          <div class="form__actions">
            <button type="submit" class="button button--primary" disabled={state.outcome === "processing" || state.outcome === "pending"}>
              {state.outcome === "processing" ? "Processing payment" : `Pay group invoice $${dollars(total)}`}
            </button>
            <button type="button" class="button button--quiet" onClick={onClose}>
              Close
            </button>
          </div>
        </form>
      )}
    </Dialog>
  );
}

export function HoldEnded() {
  const s = useStore();
  if (!s.holdEnded) return null;
  const labels = s.holdEnded.join(", ");
  return (
    <Dialog label="Hold ended" onClose={() => store.dismissHoldEnded()} initialFocus="[data-back]" returnFocus={benchMapStop} className="dialog--narrow">
      <h2 class="dialog__title">Your hold has ended</h2>
      <p class="dialog__lead">Bench {labels} is back on the map. Pick another bench or join the waitlist.</p>
      <div class="form__actions">
        <button type="button" class="button button--primary" data-back onClick={() => store.dismissHoldEnded()}>
          Back to the map
        </button>
      </div>
    </Dialog>
  );
}
