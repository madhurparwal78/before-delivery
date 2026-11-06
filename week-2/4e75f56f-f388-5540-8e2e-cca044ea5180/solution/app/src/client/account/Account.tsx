import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { call, newKey, type Benches, type Me, type MyReservation, type Offer } from "../api.js";
import { SEATS_TOTAL } from "../catalogue.js";
import { upgradeCharge } from "../../shared/prices.js";
import { LICENCE_LABEL, TIER_NAME, dollars, hhmmss, stateLabel } from "../format.js";
import { Dialog } from "../ui/Dialog.js";
import { ErrorSummary, Field, Icon, Live, Page, openLink } from "../ui/kit.js";
import { StaffSignIn } from "../ui/StaffSignIn.js";

const BILLING_OFFLINE = "Billing is offline right now. Your hold keeps running and no money has moved.";
const PAID = ["deposit_paid", "paid_in_full"];
const SOLD = ["deposit_paid", "paid_in_full", "checked_in_day1", "checked_in_day2", "certificate_issued"];

type Action =
  | { kind: "balance"; seat: MyReservation }
  | { kind: "upgrade"; seat: MyReservation }
  | { kind: "assign"; seat: MyReservation }
  | { kind: "licence"; seat: MyReservation }
  | { kind: "passport"; seat: MyReservation };

function useMe() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const load = async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      const reply = await call<Me>("GET", "/api/me");
      setMe(reply.ok ? reply.data : null);
    } catch {
      // Keep what is on screen; the next tick tries again.
    }
    timer.current = setTimeout(() => void load(), 2000);
  };
  useLayoutEffect(() => {
    void load();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  return { me, reload: load };
}

function paymentMessage(status: number, error: string | undefined, bench: string, fallback: string): string {
  if (status === 202) return `Payment for Bench ${bench} is being confirmed. We will update this page and email your receipt.`;
  if (error === "billing_unavailable") return BILLING_OFFLINE;
  return fallback;
}

function OfferRegion({ offer, onAccept, onDecline }: { offer: Offer; onAccept: () => void; onDecline: () => void }) {
  const [started] = useState(() => performance.now());
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);
  const left = offer.seconds_remaining - (performance.now() - started) / 1000;
  return (
    <section class="card card--offer" aria-label="Waitlist offer">
      <p class="eyebrow">Waitlist offer · {TIER_NAME[offer.tier]}</p>
      <h2 class="card__title">Bench {offer.bench} is waiting for you</h2>
      <p class="mono offer__left">{hhmmss(left)} left to accept</p>
      <div class="card__actions">
        <button type="button" class="button button--primary" onClick={onAccept}>
          Accept bench
        </button>
        <button type="button" class="button button--quiet" onClick={onDecline}>
          Decline
        </button>
      </div>
    </section>
  );
}

function SeatCard({ seat, depositsOpen, act, say }: { seat: MyReservation; depositsOpen: boolean; act: (action: Action) => void; say: (text: string) => void }) {
  const buyer = seat.relationship.includes("buyer");
  const attendee = seat.relationship.includes("attendee");
  const assignee = seat.relationship.includes("assignee");
  const sold = SOLD.includes(seat.state);
  const receipt = [...seat.documents].reverse().find((kind) => kind.endsWith("-receipt"));
  const download = async (path: string) => {
    const result = await openLink(path);
    if (!result.ok) say(result.status === 503 ? "Documents are unavailable right now. Try again shortly." : "That document is not ready yet.");
  };
  const cancel = async () => {
    const reply = await call<{ reservation: MyReservation }>("POST", `/api/reservations/${seat.id}/cancel`, {});
    if (reply.ok) say(`Bench ${seat.bench} is cancelled. Refund due: $${dollars(reply.data.reservation.refund_due_cents ?? 0)}. The registrar will send it.`);
    else if (reply.error.error === "no_refund_window") say("Refunds closed on 19 March 2027. You can assign this seat to a colleague instead.");
    else say(reply.error.message);
  };
  const accept = async () => {
    const reply = await call("POST", `/api/reservations/${seat.id}/accept`, {});
    say(reply.ok ? `Bench ${seat.bench} is now your seat.` : reply.error.message);
  };
  return (
    <section class={`card seat-card seat-card--${seat.tier}`} aria-label={`Bench ${seat.bench}`}>
      <header class="seat-card__head">
        <p class="eyebrow">
          {TIER_NAME[seat.tier]} tier{seat.group_id ? " · group seat" : ""}
        </p>
        <h2 class="card__title">
          Bench <span class="num">{seat.bench}</span>
        </h2>
        <p class={`badge badge--${seat.state}`}>{seat.payment_pending ? "Payment being confirmed" : stateLabel(seat.state, depositsOpen)}</p>
      </header>
      <dl class="facts-list">
        <div>
          <dt>Attendee</dt>
          <dd>{seat.attendee ? `${seat.attendee.name}${seat.attendee.accepted ? "" : " (not accepted yet)"}` : "Unassigned"}</dd>
        </div>
        {buyer && seat.attendee && (
          <div>
            <dt>Attendee email</dt>
            <dd>{seat.attendee.email}</dd>
          </div>
        )}
        {buyer && (
          <div>
            <dt>Paid</dt>
            <dd class="num">
              ${dollars(seat.paid_cents)} of ${dollars(seat.price_cents)}
            </dd>
          </div>
        )}
        {buyer && seat.refund_due_cents !== null && (
          <div>
            <dt>Refund due</dt>
            <dd class="num">${dollars(seat.refund_due_cents)}</dd>
          </div>
        )}
        <div>
          <dt>Licence</dt>
          <dd>{LICENCE_LABEL[seat.licence_status] ?? seat.licence_status}</dd>
        </div>
        <div>
          <dt>Passport scan</dt>
          <dd>{seat.passport_status === "submitted" ? "Received" : "None"}</dd>
        </div>
        <div>
          <dt>Check-in</dt>
          <dd>
            Day 1 {seat.checked_in.day1 ? "done" : "not yet"} · Day 2 {seat.checked_in.day2 ? "done" : "not yet"}
          </dd>
        </div>
      </dl>
      <div class="card__actions">
        {buyer && seat.state === "held" && (
          <a class="button button--primary" href="/#lab">
            Pay in the lab
          </a>
        )}
        {buyer && seat.state === "deposit_paid" && !seat.payment_pending && (
          <button type="button" class="button button--primary" onClick={() => act({ kind: "balance", seat })}>
            Pay balance ${dollars(seat.balance_cents)}
          </button>
        )}
        {buyer && seat.tier === "bench" && PAID.includes(seat.state) && !seat.payment_pending && (
          <button type="button" class="button" onClick={() => act({ kind: "upgrade", seat })}>
            Upgrade to Atelier
          </button>
        )}
        {buyer && PAID.includes(seat.state) && (
          <button type="button" class="button" onClick={() => act({ kind: "assign", seat })}>
            Assign to a colleague
          </button>
        )}
        {assignee && (
          <button type="button" class="button button--primary" onClick={() => void accept()}>
            Accept seat
          </button>
        )}
        {attendee && sold && seat.licence_status !== "matched" && (
          <button type="button" class="button" onClick={() => act({ kind: "licence", seat })}>
            <Icon name="upload" /> Upload licence
          </button>
        )}
        {attendee && sold && (
          <button type="button" class="button" onClick={() => act({ kind: "passport", seat })}>
            <Icon name="upload" /> Upload passport scan
          </button>
        )}
        {buyer && (receipt || seat.group_id) && sold && (
          <button
            type="button"
            class="button button--quiet"
            onClick={() => void download(seat.group_id && !receipt ? `/api/groups/${seat.group_id}/documents/invoice` : `/api/reservations/${seat.id}/documents/${receipt}`)}
          >
            <Icon name="download" /> Download receipt
          </button>
        )}
        {attendee && seat.documents.includes("visa-letter") && (
          <button type="button" class="button button--quiet" onClick={() => void download(`/api/reservations/${seat.id}/documents/visa-letter`)}>
            <Icon name="download" /> Download visa letter
          </button>
        )}
        {attendee && seat.documents.includes("certificate") && (
          <button type="button" class="button button--quiet" onClick={() => void download(`/api/reservations/${seat.id}/documents/certificate`)}>
            <Icon name="download" /> Download certificate
          </button>
        )}
        {buyer && PAID.includes(seat.state) && (
          <button type="button" class="button button--quiet button--danger" onClick={() => void cancel()}>
            Cancel seat
          </button>
        )}
      </div>
    </section>
  );
}

function PayDialog({ seat, defaultName, onDone }: { seat: MyReservation; defaultName: string; onDone: (text: string | null) => void }) {
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const key = useMemo(() => newKey(), []);
  const pay = async () => {
    setBusy(true);
    const reply = await call("POST", `/api/reservations/${seat.id}/balance`, { billing_name: name }, key);
    setBusy(false);
    if (reply.ok && reply.status === 201) return onDone(`Bench ${seat.bench} is paid in full.`);
    const text = paymentMessage(reply.status, reply.ok ? undefined : reply.error.error, seat.bench, reply.ok ? "" : reply.error.message);
    if (reply.ok) return onDone(text);
    setNote(text);
  };
  return (
    <Dialog label="Checkout" onClose={() => onDone(null)} initialFocus="#balance-name">
      <form
        class="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void pay();
        }}
      >
        <p class="eyebrow">Balance · Bench {seat.bench}</p>
        <h2 class="dialog__title">Pay the balance</h2>
        {note && (
          <div class="banner" role="alert">
            {note}
          </div>
        )}
        <Field id="balance-name" label="Name for the receipt" value={name} onInput={setName} />
        <div class="form__actions">
          <button type="submit" class="button button--primary" disabled={busy}>
            {busy ? "Processing payment" : `Pay balance $${dollars(seat.balance_cents)}`}
          </button>
          <button type="button" class="button button--quiet" onClick={() => onDone(null)}>
            Close
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function UpgradeDialog({ seat, depositsOpen, defaultName, onDone }: { seat: MyReservation; depositsOpen: boolean; defaultName: string; onDone: (text: string | null) => void }) {
  const [benches, setBenches] = useState<Benches | null>(null);
  const [choice, setChoice] = useState("");
  const [name, setName] = useState(defaultName);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const key = useMemo(() => newKey(), []);
  useLayoutEffect(() => {
    void call<Benches>("GET", "/api/benches").then((reply) => reply.ok && setBenches(reply.data));
  }, []);
  const difference = upgradeCharge(seat.state, depositsOpen);
  const open = benches && !benches.tiers.atelier.sold_out ? benches.benches.filter((b) => b.tier === "atelier" && b.state === "open") : [];
  const pay = async () => {
    setBusy(true);
    const reply = await call("POST", `/api/reservations/${seat.id}/upgrade`, { bench: choice, billing_name: name }, key);
    setBusy(false);
    if (reply.ok && reply.status === 201) return onDone(`Bench ${choice} is now your Atelier bench.`);
    if (reply.ok) return onDone(paymentMessage(202, undefined, seat.bench, ""));
    setNote(paymentMessage(reply.status, reply.error.error, seat.bench, reply.error.errors?.bench ?? reply.error.message));
  };
  return (
    <Dialog label="Upgrade to Atelier" onClose={() => onDone(null)}>
      <form
        class="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void pay();
        }}
      >
        <p class="eyebrow">Upgrade · Bench {seat.bench}</p>
        <h2 class="dialog__title">Move to an Atelier bench</h2>
        <p class="dialog__lead">
          You pay only the difference now: <span class="num">${dollars(difference)}</span>.
        </p>
        {note && (
          <div class="banner" role="alert">
            {note}
          </div>
        )}
        <fieldset class="choice choice--grid">
          <legend>Open Atelier benches</legend>
          {benches && open.length === 0 && <p>Atelier is sold out.</p>}
          {open.map((bench) => (
            <label class="choice__option" key={bench.label}>
              <input type="radio" name="upgrade" checked={choice === bench.label} onChange={() => setChoice(bench.label)} />
              <span>Bench {bench.label}</span>
            </label>
          ))}
        </fieldset>
        <Field id="upgrade-name" label="Name for the receipt" value={name} onInput={setName} />
        <div class="form__actions">
          <button type="submit" class="button button--primary" disabled={busy || !choice}>
            {busy ? "Processing payment" : `Pay upgrade $${dollars(difference)}`}
          </button>
          <button type="button" class="button button--quiet" onClick={() => onDone(null)}>
            Close
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function AssignDialog({ seat, onDone }: { seat: MyReservation; onDone: (text: string | null) => void }) {
  const [name, setName] = useState(seat.attendee && !seat.relationship.includes("attendee") ? seat.attendee.name : "");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const submit = async () => {
    const reply = await call("PUT", `/api/reservations/${seat.id}/assignee`, { name, email });
    if (reply.ok) return onDone(`Bench ${seat.bench} is assigned to ${name.trim()}. We emailed them.`);
    setErrors(reply.error.errors ?? { email: reply.error.message });
  };
  return (
    <Dialog label="Assign to a colleague" onClose={() => onDone(null)}>
      <form
        class="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p class="eyebrow">Bench {seat.bench}</p>
        <h2 class="dialog__title">Assign to a colleague</h2>
        <p class="dialog__lead">They sign up with this email and accept the seat. Their licence and documents stay private to them.</p>
        <ErrorSummary errors={errors} ids={{ name: "assign-name", email: "assign-email" }} />
        <Field id="assign-name" label="Colleague name" value={name} error={errors.name} onInput={setName} />
        <Field id="assign-email" label="Colleague email" type="email" value={email} error={errors.email} onInput={setEmail} />
        <div class="form__actions">
          <button type="submit" class="button button--primary">
            Assign seat
          </button>
          <button type="button" class="button button--quiet" onClick={() => onDone(null)}>
            Close
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const UPLOAD_FIELDS = {
  licence: [
    { id: "licence_number", label: "Licence number" },
    { id: "licence_state", label: "Issuing state" },
  ],
  passport: [
    { id: "full_name", label: "Full name as in passport" },
    { id: "nationality", label: "Nationality" },
    { id: "passport_number", label: "Passport number" },
  ],
} as const;

function UploadDialog({ seat, kind, onDone }: { seat: MyReservation; kind: "licence" | "passport"; onDone: (text: string | null) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const submit = async () => {
    const form = new FormData();
    for (const field of UPLOAD_FIELDS[kind]) form.append(field.id, values[field.id] ?? "");
    const chosen = file.current?.files?.[0];
    if (chosen) form.append("file", chosen);
    setBusy(true);
    let reply;
    try {
      reply = await call("POST", `/api/reservations/${seat.id}/${kind}`, form);
    } catch {
      reply = { ok: false as const, status: 413, error: { error: "payload_too_large", message: "" } };
    }
    setBusy(false);
    if (reply.ok) return onDone(kind === "licence" ? "Licence received. The registrar will check it." : "Passport scan received. The registrar will prepare your letter.");
    const code = reply.error.error;
    if (code === "unsupported_file_type") setNote("Upload a PDF, JPEG or PNG file.");
    else if (code === "file_too_large" || code === "payload_too_large") setNote("Files must be 10,000,000 bytes or smaller.");
    else if (code === "storage_unavailable") setNote("Uploads are unavailable right now. Nothing was saved; try again shortly.");
    else if (reply.error.errors) setErrors(reply.error.errors);
    else setNote(reply.error.message);
  };
  const ids = Object.fromEntries([...UPLOAD_FIELDS[kind].map((f) => [f.id, `${kind}-${f.id}`]), ["file", `${kind}-file`]]);
  return (
    <Dialog label={kind === "licence" ? "Upload licence" : "Upload passport scan"} onClose={() => onDone(null)}>
      <form
        class="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <p class="eyebrow">Bench {seat.bench}</p>
        <h2 class="dialog__title">{kind === "licence" ? "Upload your licence" : "Upload your passport scan"}</h2>
        <p class="dialog__lead">PDF, JPEG or PNG, up to 10,000,000 bytes. Only you and the registrar can open it.</p>
        {note && (
          <div class="banner" role="alert">
            {note}
          </div>
        )}
        <ErrorSummary errors={errors} ids={ids} />
        {UPLOAD_FIELDS[kind].map((field) => (
          <Field
            key={field.id}
            id={`${kind}-${field.id}`}
            label={field.label}
            value={values[field.id] ?? ""}
            error={errors[field.id]}
            onInput={(value) => setValues((current) => ({ ...current, [field.id]: value }))}
          />
        ))}
        <div class={`field ${errors.file ? "field--error" : ""}`}>
          <label for={`${kind}-file`}>Scan</label>
          <input id={`${kind}-file`} type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" ref={file} />
          {errors.file && <p class="field__error">{errors.file}</p>}
        </div>
        <div class="form__actions">
          <button type="submit" class="button button--primary" disabled={busy}>
            Upload
          </button>
          <button type="button" class="button button--quiet" onClick={() => onDone(null)}>
            Close
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function Account() {
  const { me, reload } = useMe();
  const [message, setMessage] = useState("");
  const [action, setAction] = useState<Action | null>(null);
  const say = (text: string) => {
    setMessage(text);
    void reload();
  };
  if (me === undefined) {
    return (
      <Page title="My seats">
        <h1 class="page-title">My seats</h1>
        <p class="muted">Loading your seats…</p>
      </Page>
    );
  }
  if (me === null) {
    return (
      <Page title="My seats">
        <h1 class="page-title">My seats</h1>
        <StaffSignIn heading="Sign in to see your seats" onSignedIn={() => void reload()} />
      </Page>
    );
  }
  const seats = me.reservations.filter((r) => r.state !== "released");
  const offers = me.offers.filter((offer) => offer.state === "offered");
  const done = (text: string | null) => {
    setAction(null);
    if (text) say(text);
  };
  const acceptOffer = async (offer: Offer) => {
    const reply = await call<{ seats_remaining: number }>("POST", `/api/offers/${offer.id}/accept`, {});
    if (reply.ok) say(`Bench ${offer.bench} is held for you. ${reply.data.seats_remaining} of ${SEATS_TOTAL} seats remaining.`);
    else say(reply.error.error === "offer_lapsed" ? "This offer has passed to the next person on the waitlist." : reply.error.message);
  };
  const declineOffer = async (offer: Offer) => {
    await call("POST", `/api/offers/${offer.id}/decline`, {});
    say("This offer has passed to the next person on the waitlist.");
  };
  return (
    <Page title="My seats">
      <div class="account">
        <div class="account__head">
          <h1 class="page-title">My seats</h1>
          <p class="muted account__who">
            {me.account.name} · {me.account.email}
          </p>
        </div>
        <Live label="Account updates" message={message} />
        {message && <p class="echo">{message}</p>}
        {offers.map((offer) => (
          <OfferRegion key={offer.id} offer={offer} onAccept={() => void acceptOffer(offer)} onDecline={() => void declineOffer(offer)} />
        ))}
        {me.waitlist && (
          <section class="card" aria-label="Waitlist">
            <h2 class="card__title">
              You are number <span class="num">{me.waitlist.position}</span> on the {TIER_NAME[me.waitlist.tier]} waitlist.
            </h2>
            <p class="muted">When a bench opens we email you and hold it for you to accept.</p>
            <button type="button" class="button button--quiet" onClick={() => void call("DELETE", "/api/waitlist").then(() => say("You have left the waitlist."))}>
              Leave the waitlist
            </button>
          </section>
        )}
        {me.groups
          .filter((group) => group.invoice)
          .map((group) => (
            <p class="group-line" key={group.id}>
              Group invoice · <span class="num">{group.reservations.length}</span> seats ·{" "}
              <span class="num">${dollars(group.invoice?.total_cents ?? 0)}</span>
            </p>
          ))}
        <div class="seat-grid">
          {seats.map((seat) => (
            <SeatCard key={seat.id} seat={seat} depositsOpen={me.deposits_open} act={setAction} say={say} />
          ))}
        </div>
        {seats.length === 0 && offers.length === 0 && !me.waitlist && (
          <div class="empty">
            <svg viewBox="0 0 120 80" width="120" height="80" aria-hidden="true" class="empty__art">
              <rect x="14" y="26" width="92" height="40" rx="10" fill="none" stroke="currentColor" stroke-width="1.5" />
              <path d="M30 26V14h20" fill="none" stroke="currentColor" stroke-width="1.5" />
              <path d="M44 14l10 12" fill="none" stroke="var(--curing)" stroke-width="1.5" />
            </svg>
            <p>No seats yet. Pick a bench in the lab.</p>
            <a class="button button--primary" href="/#lab">
              Go to the lab
            </a>
          </div>
        )}
      </div>
      {action?.kind === "balance" && <PayDialog seat={action.seat} defaultName={me.account.name} onDone={done} />}
      {action?.kind === "upgrade" && <UpgradeDialog seat={action.seat} depositsOpen={me.deposits_open} defaultName={me.account.name} onDone={done} />}
      {action?.kind === "assign" && <AssignDialog seat={action.seat} onDone={done} />}
      {(action?.kind === "licence" || action?.kind === "passport") && <UploadDialog seat={action.seat} kind={action.kind} onDone={done} />}
    </Page>
  );
}
