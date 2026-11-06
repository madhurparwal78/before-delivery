import { useEffect, useState } from "preact/hooks";
import { ApiFailure, get, patch } from "../api.js";
import { navigate, useAddress, withQuery } from "../router.js";
import { context, useStore } from "../store.js";
import { useBankMonth } from "../shell.js";
import { Button, Empty, Field, MonthField, NoteRow, useAction, useLatest } from "../ui.js";
import { CancelDialog, labelFor } from "./dialogs.js";
import type { Booking, Member } from "../types.js";
import { STATUS_WORDS, money } from "../../shared/format.js";
import { monthName } from "../../shared/time.js";

const BILLING: Record<Booking["billingStatus"], string> = { billed: "Billed", pending_billing: "Pending billing", not_billed: "Not billed" };

/** Month screens read `month` from the address; a missing one becomes the kitchen-local month. */
export function useMonthAddress(path: string): { month: string; set: (m: string) => void } {
  const ctx = useStore(context)!;
  const address = useAddress();
  const raw = address.query.get("month");
  useEffect(() => {
    if (raw === null) navigate(withQuery(path, { ...Object.fromEntries(address.query), month: ctx.kitchen.currentMonth }), true);
  }, [raw]);
  return {
    month: raw ?? ctx.kitchen.currentMonth,
    set: (m) => {
      if (m !== raw) navigate(withQuery(path, { ...Object.fromEntries(address.query), month: m }));
    },
  };
}

export function BookingsScreen() {
  const ctx = useStore(context)!;
  const member = ctx.session.user.role === "member";
  const { month, set } = useMonthAddress("/bookings");
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [monthError, setMonthError] = useState<string | undefined>();
  const [cancelling, setCancelling] = useState<{ booking: Booking; now: number } | null>(null);
  useBankMonth(monthError ? null : month);

  const begin = useLatest();
  /** Reads the address's month; only the latest request's answer is drawn. */
  const load = async (): Promise<void> => {
    const current = begin();
    try {
      const { data } = await get<{ bookings: Booking[] }>(`/api/bookings?month=${encodeURIComponent(month)}`);
      if (!current()) return;
      setMonthError(undefined);
      setBookings(data.bookings);
    } catch (error) {
      if (!current()) return;
      setBookings(null);
      if (error instanceof ApiFailure && error.fieldErrors.month) setMonthError(error.fieldErrors.month);
    }
  };
  useEffect(() => {
    setBookings(null);
    void load();
  }, [month]);

  const openCancel = async (b: Booking): Promise<void> => {
    const { data, serverMs } = await get<{ booking: Booking }>(`/api/bookings/${b.id}`);
    setCancelling({ booking: data.booking, now: serverMs });
  };
  const cancellable = (b: Booking): boolean => b.actions.includes("cancel");
  const rows = (bookings ?? []).filter((b) => member || b.confirmedAt !== null);
  const tableName = member ? "My bookings" : "Bookings";

  return (
    <div class="screen">
      <h1>Bookings</h1>
      <div class="grid">
        <section class={`panel ${member ? "span-8" : "span-12"}`}>
          <div class="toolbar"><MonthField label="Month" value={month} error={monthError} onCommit={set} /></div>
          <div role="region" aria-label="Booking list" aria-busy={!monthError && bookings === null ? "true" : "false"}>
          {!monthError && bookings === null && <p class="loading">Loading…</p>}
          {!monthError && bookings !== null && (
            <table class="table" aria-label={tableName}>
              <thead>
                <tr><th scope="col">Block</th>{!member && <th scope="col">Business</th>}<th scope="col">Status</th><th scope="col">Charge</th><th scope="col">Billing</th><th scope="col">Action</th></tr>
              </thead>
              <tbody>
                {rows.length === 0 && <NoteRow columns={member ? 5 : 6}><Empty>No bookings in {monthName(month)}.</Empty></NoteRow>}
                {rows.map((b) => (
                  <tr>
                    <td data-label="Block" class="wrap">{labelFor(b)}</td>
                    {!member && <td data-label="Business">{b.businessName}</td>}
                    <td data-label="Status">{STATUS_WORDS[b.status]}{b.conflict ? " · Conflict" : ""}</td>
                    <td data-label="Charge" class="num">{money(b.chargeCents)}{b.penaltyCents > 0 ? ` + fee ${money(b.penaltyCents)}${b.penaltyWaived ? " (waived)" : ""}` : ""}</td>
                    <td data-label="Billing">{b.billingStatus === "billed" ? <span class="billed">Billed</span> : BILLING[b.billingStatus]}</td>
                    <td data-label="Action">{cancellable(b) ? <Button aria-label={`Cancel ${labelFor(b)}`} onClick={() => void openCancel(b)}>Cancel</Button> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          </div>
        </section>
        {member && <BusinessDetails memberId={ctx.session.user.memberId!} onSaved={() => void load()} />}
      </div>
      {cancelling && (
        <CancelDialog
          booking={cancelling.booking}
          now={cancelling.now}
          returnTo={() => document.querySelector<HTMLElement>(".input-month")}
          onClose={() => setCancelling(null)}
          onDone={() => { setCancelling(null); void load(); }}
        />
      )}
    </div>
  );
}

function BusinessDetails({ memberId, onSaved }: { memberId: string; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | undefined>();
  const { busy, run } = useAction();
  useEffect(() => {
    get<{ member: Member }>(`/api/members/${memberId}`).then(({ data }) => setName(data.member.businessName), () => undefined);
  }, []);
  const save = (e: Event): void => {
    e.preventDefault();
    void run("save", "Saving…", async () => {
      await patch("/api/members/me", { businessName: name });
      setError(undefined);
      onSaved();
      return "Business name saved.";
    }, (err) => {
      if (err instanceof ApiFailure && err.fieldErrors.businessName) {
        setError(err.fieldErrors.businessName);
        return true;
      }
      return false;
    });
  };
  return (
    <section class="panel span-4" role="region" aria-label="Business details">
      <h2>Business details</h2>
      <form class="form" onSubmit={save} noValidate>
        <Field label="Business name" error={error}>{(p) => <input {...p} class="input" type="text" value={name} onInput={(e) => setName(e.currentTarget.value)} />}</Field>
        <div class="actions"><Button type="submit" variant="primary" busy={busy === "save"}>Save business name</Button></div>
      </form>
    </section>
  );
}
