// Joining a sold-out tier's waitlist.
import type { JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import type { Entry, Tier } from "../../shared/types.js";
import { announce } from "../announce.js";
import { request } from "../api.js";
import { Dialog, ErrorSummary, Field, NoticeRegion } from "../components.js";
import { CHECK_DETAILS, SALES_CLOSED } from "../copy.js";

const FIELD_IDS = { name: "waitlist-name", email: "waitlist-email" };

interface Props {
  open: boolean;
  performanceId: string;
  tier: Tier;
  onClose: () => void;
}

export function WaitlistDialog({ open, performanceId, tier, onClose }: Props): JSX.Element {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErrors({});
    setMessage("");
    setJoined(false);
  }, [open]);

  const join = async (event: Event): Promise<void> => {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const result = await request<{ entry: Entry }>("POST",
      `/api/performances/${encodeURIComponent(performanceId)}/tiers/${encodeURIComponent(tier.id)}/waitlist`, { name, email });
    setPending(false);
    if (result.ok) {
      const copy = `You're on the waitlist for ${tier.name}. Your place is ${result.data.entry.position ?? 1}.`;
      setErrors({});
      setMessage(copy);
      setJoined(true);
      announce(copy);
      return;
    }
    const { error, fields } = result.error;
    const copy = error === "already_waiting" ? `This email is already on the waitlist for ${tier.name}.`
      : error === "tier_not_sold_out" ? `Seats are still on sale in ${tier.name}.`
        : error === "sales_closed" ? SALES_CLOSED : CHECK_DETAILS;
    setErrors(error === "validation" && fields ? fields : {});
    setMessage(error === "validation" ? "" : copy);
    announce(copy);
  };

  return (
    <Dialog label="Join the waitlist" open={open} busy={pending} onClose={onClose}>
      {joined ? (
        <div class="dialog-body">
          <h2>Join the waitlist</h2>
          <p class="receipt-line">{message}</p>
          <p>When a {tier.name} seat comes free, we e-mail you an offer and show it in My tickets.</p>
          <div class="dialog-actions">
            <button type="button" data-autofocus="" onClick={onClose}>Close</button>
          </div>
        </div>
      ) : (
        <form class="dialog-body" noValidate onSubmit={(event) => void join(event)}>
          <h2>Join the waitlist</h2>
          <p>{tier.name} is sold out. Seats that come free are offered in the order people joined.</p>
          <ErrorSummary errors={errors} fieldIds={FIELD_IDS} />
          <Field id={FIELD_IDS.name} label="Full name" value={name} error={errors.name} autoComplete="name" autofocus onInput={setName} />
          <Field id={FIELD_IDS.email} label="Email" value={email} error={errors.email} type="email" autoComplete="email" onInput={setEmail} />
          <NoticeRegion label="Waitlist notice" text={message} />
          <div class="dialog-actions">
            <button type="submit" disabled={pending}>{pending ? "Joining" : "Join waitlist"}</button>
            <button type="button" class="quiet" onClick={onClose}>Cancel</button>
          </div>
        </form>
      )}
    </Dialog>
  );
}
