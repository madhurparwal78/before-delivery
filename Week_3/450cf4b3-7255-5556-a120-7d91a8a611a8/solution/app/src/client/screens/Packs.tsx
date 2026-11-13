import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";
import { PACK_HOURS, type Pack, type PackDetail, type PackHours } from "../../shared/api.js";
import { dateLabel } from "../../shared/clock.js";
import { dollars, duration } from "../../shared/format.js";
import { api, newKey } from "../api.js";
import { Shell, type Session } from "../App.js";
import { usePasswordConfirm } from "../components/PasswordDialog.js";
import { buyCopy, GENERIC, MOVEMENT_LABEL, packReceiptLine, RETRY_TAG } from "../copy.js";
import { dayOf } from "../kitchen.js";
import { closeAttempt, keepAttempt, markSending, openAttempt, sendingAttempt, type PurchaseAttempt } from "../purchase.js";
import { useRefresh, REFRESH_MS } from "../refresh.js";
import type { Screen } from "../router.js";
import { Notice, ScreenHeading, show, tell, TicketStub, type NoticeState } from "../ui.js";


function balanceText(p: Pack): string {
  return `${duration(p.balanceMinutes)} left of ${duration(p.purchasedMinutes)}`;
}

function signed(minutes: number): string {
  return `${minutes < 0 ? "−" : "+"}${duration(Math.abs(minutes))}`;
}

function when(isoTime: string): string {
  return `${dateLabel(dayOf(isoTime))} ${isoTime.slice(11, 16)}`;
}

export const packHeadingId = (id: string): string => `pack-${id}`;

/** One pack: heading, price, status, balance, receipt email line and ledger table; `children` are the owner's refund controls. */
export function PackPanel({ pack, number, refundable = false, children }: {
  pack: PackDetail; number: number; refundable?: boolean; children?: ComponentChildren;
}): JSX.Element {
  const entries = pack.entries.filter((e) => e.side === "pack");
  const refunded = pack.status === "refunded" && pack.refundedCents !== null;
  return (
    <article class="panel pack" data-status={pack.status}>
      <header class="panel__head">
        <h2 id={packHeadingId(pack.id)} tabIndex={-1}>{pack.hours}-hour pack #{number}</h2>
        <p class="pack__price">${dollars(pack.priceCents)}</p>
        <p class="stamp">{refunded ? `Refunded $${dollars(pack.refundedCents ?? 0)}` : "Active"}</p>
      </header>
      <p class="pack__balance">
        <span>{balanceText(pack)}</span>
        {pack.heldMinutes > 0 ? <span class="held-text"> · {duration(pack.heldMinutes)} on hold</span> : null}
      </p>
      {refundable && !refunded ? <p class="pack__refundable">Refundable now ${dollars(pack.refundableCents)}</p> : null}
      <p class="email-line" data-status={pack.receiptEmail.status}>{packReceiptLine(pack.receiptEmail)}</p>
      <table class="table" aria-label={`Ledger ${pack.hours}-hour pack #${number} ${dateLabel(dayOf(pack.purchasedAt))}`}>
        <thead><tr><th scope="col">When</th><th scope="col">Movement</th><th scope="col">Hours</th><th scope="col">Booking</th></tr></thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id}>
              <td data-label="When">{when(e.createdAt)}</td>
              <td data-label="Movement">{MOVEMENT_LABEL[e.movement]}</td>
              <td data-label="Hours" class="num">{signed(e.minutes)}</td>
              <td data-label="Booking" class="num">{e.bookingId ? e.bookingId.slice(0, 8) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {children}
    </article>
  );
}

export function Packs({ session, screen }: { session: Session; screen: Screen }): JSX.Element {
  const userId = session.me.id;
  const [packs, setPacks] = useState<PackDetail[] | null>(null);
  const [busy, setBusy] = useState<PackHours | null>(() => sendingAttempt()?.hours ?? null);
  const [open, setOpen] = useState<PurchaseAttempt | null>(() => openAttempt(userId));
  const [notice, setNotice] = useState<NoticeState | null>(null);
  const { ask, dialog } = usePasswordConfirm();

  const reload = useRefresh(async (current) => {
    const list = await api<{ packs: Pack[] }>("GET", "/api/packs");
    if (!current() || !list.ok) return;
    const details = await Promise.all(list.data.packs.map((p) => api<PackDetail>("GET", `/api/packs/${p.id}`)));
    if (!current()) return;
    const fresh = details.flatMap((d) => (d.ok ? [d.data] : []));
    if (fresh.length !== details.length) return;
    setPacks((prev) => (prev && JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh));
  }, REFRESH_MS);

  // Each load that finds an open attempt says so once, in place of any earlier outcome copy.
  useEffect(() => {
    const found = openAttempt(userId);
    if (found && !sendingAttempt()) setNotice(tell(buyCopy.resume(found.hours)));
  }, []);

  const settle = (attempt: PurchaseAttempt, keep: boolean, copy: string, tone: NoticeState["tone"]): void => {
    markSending(null);
    setBusy(null);
    if (keep) {
      keepAttempt(userId, attempt);
      setOpen(attempt);
    } else {
      closeAttempt(userId);
      setOpen(null);
    }
    setNotice(tell(copy, tone));
  };

  const buy = async (hours: PackHours, opener: HTMLElement): Promise<void> => {
    if (sendingAttempt()) return;
    const stored = openAttempt(userId);
    if (stored && stored.hours !== hours) return;
    const attempt: PurchaseAttempt = stored ?? { hours, key: newKey() };
    markSending(attempt);
    keepAttempt(userId, attempt);
    setBusy(hours);
    setOpen(null);
    setNotice(show(buyCopy.pending));
    const send = (): ReturnType<typeof api<Pack>> => api<Pack>("POST", "/api/packs", { json: { hours }, key: attempt.key });
    let result = await send();
    if (sendingAttempt() !== attempt) return;
    if (!result.ok && result.error?.error === "reauth_required") {
      const confirmed = await ask(opener);
      if (sendingAttempt() !== attempt) return;
      if (!confirmed) {
        settle(attempt, false, buyCopy.dialogClosed(hours), "info");
        return;
      }
      result = await send();
      if (sendingAttempt() !== attempt) return;
    }
    if (result.ok) {
      settle(attempt, false, buyCopy.done(result.data.hours, session.me.email), "info");
      await reload();
      return;
    }
    const code = result.error?.error;
    if (result.status === 0) settle(attempt, true, buyCopy.network, "outage");
    else if (code === "purchase_pending") settle(attempt, true, buyCopy.pendingPayment, "outage");
    else if (code === "idempotency_in_progress") settle(attempt, true, buyCopy.inProgress, "outage");
    else if (code === "billing_unavailable") settle(attempt, false, buyCopy.billingDown, "outage");
    else if (result.status === 401) {
      markSending(null);
      setBusy(null);
    } else settle(attempt, false, GENERIC, "outage");
  };

  return (
    <Shell session={session} screen={screen}>
      <section class="screen" role="region" aria-label="Hour packs">
        <header class="screen__head">
          <ScreenHeading>Hour packs</ScreenHeading>
          <p class="lede">Prepaid station hours. Claims reserve hours on your earliest pack that covers them.</p>
        </header>
        <div class="buy-row">
          {PACK_HOURS.map((hours) => {
            const blocked = busy !== null || (open !== null && open.hours !== hours);
            return (
              <span key={hours} class="buy">
                <button type="button" class="button button--ink" aria-disabled={blocked ? "true" : undefined}
                  onMouseDown={(e) => { if (blocked) e.preventDefault(); }}
                  onClick={(e) => void buy(hours, e.currentTarget)}>
                  Buy {hours}-hour pack
                </button>
                {open?.hours === hours && busy === null ? <span class="retry-tag">{RETRY_TAG}</span> : null}
              </span>
            );
          })}
        </div>
        <Notice notice={notice} />
        <div class="packs">
          {packs === null ? null : packs.length === 0
            ? <TicketStub>No packs yet. Buy one above; the kitchen records payment at the counter.</TicketStub>
            : packs.map((p, i) => <PackPanel key={p.id} pack={p} number={i + 1} />)}
        </div>
      </section>
      {dialog}
    </Shell>
  );
}
