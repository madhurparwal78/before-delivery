import { useLayoutEffect, useState } from "preact/hooks";
import type { Booking, CreditMovement, Membership } from "../../shared/api.ts";
import { CADENCE_LABELS, formatMoney, TIER_LABELS, type Locale } from "../../shared/domain.ts";
import { api } from "../api.ts";
import { useApp } from "../context.tsx";
import { localDate, localTime, type Strings } from "../i18n.ts";
import { Num } from "../ui.tsx";

export function MembershipFacts({ membership, number, locale, t }: { membership: Membership; number: string | null; locale: Locale; t: Strings }) {
  const cadence = membership.cadence === "gift" ? t.giftCadence : CADENCE_LABELS[membership.cadence][locale];
  return (
    <dl class="facts">
      {number ? <div><dt>{t.memberNumber}</dt><dd><Num>{number}</Num></dd></div> : null}
      <div><dt>{t.tier}</dt><dd>{TIER_LABELS[membership.tier][locale]}</dd></div>
      <div><dt>{t.billing}</dt><dd>{cadence}</dd></div>
      {membership.ends_on ? (
        <div><dt>{t.endsOn}</dt><dd><Num>{membership.ends_on}</Num></dd></div>
      ) : (
        <div><dt>{t.nextBilling}</dt><dd><Num>{membership.charged_through}</Num></dd></div>
      )}
      {membership.pending_change ? (
        <div class="wide-fact"><dt>{t.pendingChange(TIER_LABELS[membership.pending_change.tier][locale], CADENCE_LABELS[membership.pending_change.cadence][locale], membership.pending_change.effective_date)}</dt></div>
      ) : null}
    </dl>
  );
}

export function AccountPage() {
  const { locale, t, me, navigate } = useApp();
  const [bookings, setBookings] = useState<Booking[] | null>(null);
  const [credit, setCredit] = useState<{ balance_cents: number; movements: CreditMovement[] } | null>(null);

  useLayoutEffect(() => {
    if (me === null) navigate(`/${locale}/signin?next=${encodeURIComponent(location.pathname)}`);
    if (me && me.role !== "patron") navigate(`/${locale}/staff`);
    if (!me || me.role !== "patron") return;
    void api<{ bookings: Booking[] }>("GET", "/api/bookings").then((r) => r.ok && setBookings(r.data.bookings));
    void api<{ balance_cents: number; movements: CreditMovement[] }>("GET", "/api/me/credit").then((r) => r.ok && setCredit(r.data));
  }, [me]);

  const signOut = () => {
    void api("POST", "/api/auth/signout", {}).then(() => navigate(`/${locale}/`));
  };

  // The page appears once, with its data: content arriving piece by piece pushes the panels below it around.
  if (!me || bookings === null || credit === null) {
    return <section class="page account-page"><h1 tabIndex={-1} class="page-title">{t.account}</h1><p class="muted">{t.loading}</p></section>;
  }

  return (
    <section class="page account-page">
      <div class="page-head">
        <h1 tabIndex={-1} class="page-title">{t.account}</h1>
        <button type="button" class="button ghost" onClick={signOut}>{t.signOut}</button>
      </div>
      <p class="muted">{me.name} · <Num>{me.number ?? ""}</Num> · {me.email}</p>
      <div class="account-grid">
        <section class="panel" aria-labelledby="membership-heading">
          <h2 id="membership-heading" class="panel-title">{t.membership}</h2>
          {me.membership ? <MembershipFacts membership={me.membership} number={me.number} locale={locale} t={t} /> : (
            <p class="muted">{t.noMembership} <a href={`/${locale}/membership`}>{t.joinLink}</a></p>
          )}
        </section>
        <section class="panel" aria-labelledby="credit-heading">
          <h2 id="credit-heading" class="panel-title">{t.credit}</h2>
          <p class="credit-balance">{t.creditBalance("")}<Num>{formatMoney(credit.balance_cents, locale)}</Num></p>
          <div class="table-wrap">
            <table aria-label={t.creditMovements} class="data-table">
              <thead><tr><th scope="col">{t.date}</th><th scope="col">{t.kind}</th><th scope="col">{t.reference}</th><th scope="col">{t.amount}</th></tr></thead>
              <tbody>
                {credit.movements.length === 0 ? (
                  <tr><td colSpan={4} class="muted">{t.noMovements}</td></tr>
                ) : credit.movements.map((m) => (
                  <tr key={m.id}><td><Num>{localDate(m.at)}</Num></td><td>{t.movementKind[m.kind]}</td><td><Num>{m.reference}</Num></td><td><Num>{formatMoney(m.amount_cents, locale)}</Num></td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <section class="panel" aria-labelledby="bookings-heading">
        <h2 id="bookings-heading" class="panel-title">{t.myBookings}</h2>
        <div class="table-wrap">
          <table aria-label={t.myBookings} class="data-table">
            <thead><tr><th scope="col">{t.reference}</th><th scope="col">{t.film}</th><th scope="col">{t.showtime}</th><th scope="col">{t.status}</th><th scope="col">{t.total}</th></tr></thead>
            <tbody>
              {bookings.length === 0 ? (
                <tr><td colSpan={5} class="muted">{t.noBookings}</td></tr>
              ) : bookings.map((b) => (
                <tr key={b.ref}>
                  <td><a href={`/${locale}/account/bookings/${encodeURIComponent(b.ref)}`}><Num>{b.ref}</Num></a></td>
                  <td>{b.screening.film_title}</td>
                  <td><Num>{localDate(b.screening.starts_at)} {localTime(b.screening.starts_at)}</Num></td>
                  <td>{t.bookingState[b.state]}</td>
                  <td><Num>{formatMoney(b.total_cents, locale)}</Num></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  );
}
